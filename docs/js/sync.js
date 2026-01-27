// ==================== MÓDULO DE SINCRONIZACIÓN MULTI-DISPOSITIVO ====================
// TSJ Filing - Sincronización con Google Drive
// Versión 1.0

// ==================== CONFIGURACIÓN ====================
const SYNC_CONFIG = {
    // Google OAuth Client ID (necesitas crear uno en Google Cloud Console)
    clientId: '', // Se configurará desde la UI

    // Scopes necesarios para Google Drive
    scopes: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file',

    // Nombre de la carpeta en Drive
    folderName: '.tsj_filing_sync',

    // Nombre del archivo de datos
    dataFileName: 'tsj_data.enc',

    // Intervalo de auto-sync (milisegundos) - 5 minutos
    autoSyncInterval: 5 * 60 * 1000,

    // Máximo de dispositivos por defecto (puede ser override por licencia)
    maxDispositivosDefault: 2
};

// ==================== ESTADO DE SINCRONIZACIÓN ====================
let syncState = {
    enabled: false,
    authenticated: false,
    accessToken: null,
    tokenExpiry: null,
    lastSync: null,
    syncInProgress: false,
    folderId: null,
    fileId: null,
    dispositivos: [], // Lista de dispositivos vinculados
    maxDispositivos: 2,
    tipoDispositivo: null // 'mobile' o 'desktop'
};

// ==================== DETECCIÓN DE TIPO DE DISPOSITIVO ====================
function detectarTipoDispositivo() {
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(ua);
    const isTablet = /tablet|ipad/i.test(ua);

    if (isMobile && !isTablet) {
        return 'mobile';
    }
    return 'desktop'; // PC, laptop, tablet
}

// ==================== CIFRADO AES-256-GCM ====================
async function generarClaveDesdePassword(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function cifrarDatos(datos, codigoPremium) {
    try {
        const salt = 'TSJ_Filing_Sync_Salt_v1';
        const clave = await generarClaveDesdePassword(codigoPremium, salt);

        // Generar IV aleatorio
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // Convertir datos a JSON y luego a bytes
        const encoder = new TextEncoder();
        const datosBytes = encoder.encode(JSON.stringify(datos));

        // Cifrar
        const datosCifrados = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            clave,
            datosBytes
        );

        // Combinar IV + datos cifrados y convertir a base64
        const resultado = new Uint8Array(iv.length + datosCifrados.byteLength);
        resultado.set(iv);
        resultado.set(new Uint8Array(datosCifrados), iv.length);

        return btoa(String.fromCharCode(...resultado));
    } catch (error) {
        console.error('Error al cifrar datos:', error);
        throw new Error('Error al cifrar datos para sincronización');
    }
}

async function descifrarDatos(datosCifradosBase64, codigoPremium) {
    try {
        const salt = 'TSJ_Filing_Sync_Salt_v1';
        const clave = await generarClaveDesdePassword(codigoPremium, salt);

        // Decodificar base64
        const datosCompletos = Uint8Array.from(atob(datosCifradosBase64), c => c.charCodeAt(0));

        // Separar IV y datos cifrados
        const iv = datosCompletos.slice(0, 12);
        const datosCifrados = datosCompletos.slice(12);

        // Descifrar
        const datosDescifrados = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            clave,
            datosCifrados
        );

        // Convertir a string y parsear JSON
        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(datosDescifrados));
    } catch (error) {
        console.error('Error al descifrar datos:', error);
        throw new Error('Error al descifrar datos. Verifica tu código de activación.');
    }
}

// ==================== GOOGLE OAUTH ====================
function iniciarAutenticacionGoogle() {
    return new Promise((resolve, reject) => {
        const clientId = localStorage.getItem('sync_client_id') || SYNC_CONFIG.clientId;

        if (!clientId) {
            reject(new Error('Client ID de Google no configurado'));
            return;
        }

        // Crear URL de autorización
        const redirectUri = window.location.origin + window.location.pathname;
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${encodeURIComponent(clientId)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&response_type=token` +
            `&scope=${encodeURIComponent(SYNC_CONFIG.scopes)}` +
            `&prompt=consent`;

        // Abrir popup de autenticación
        const popup = window.open(authUrl, 'googleAuth', 'width=500,height=600');

        // Escuchar el resultado
        const checkPopup = setInterval(() => {
            try {
                if (popup.closed) {
                    clearInterval(checkPopup);
                    reject(new Error('Autenticación cancelada'));
                    return;
                }

                const popupUrl = popup.location.href;
                if (popupUrl.includes('access_token')) {
                    clearInterval(checkPopup);

                    // Extraer token del hash
                    const hash = popup.location.hash.substring(1);
                    const params = new URLSearchParams(hash);
                    const accessToken = params.get('access_token');
                    const expiresIn = parseInt(params.get('expires_in')) || 3600;

                    popup.close();

                    if (accessToken) {
                        syncState.accessToken = accessToken;
                        syncState.tokenExpiry = Date.now() + (expiresIn * 1000);
                        syncState.authenticated = true;

                        // Guardar token temporalmente
                        sessionStorage.setItem('sync_token', accessToken);
                        sessionStorage.setItem('sync_token_expiry', syncState.tokenExpiry.toString());

                        resolve(accessToken);
                    } else {
                        reject(new Error('No se pudo obtener el token'));
                    }
                }
            } catch (e) {
                // Error de cross-origin, ignorar
            }
        }, 500);

        // Timeout después de 2 minutos
        setTimeout(() => {
            clearInterval(checkPopup);
            if (!popup.closed) popup.close();
            reject(new Error('Tiempo de espera agotado'));
        }, 120000);
    });
}

// Verificar si el token es válido
function tokenValido() {
    return syncState.accessToken && syncState.tokenExpiry && Date.now() < syncState.tokenExpiry;
}

// Restaurar token de sesión
function restaurarToken() {
    const token = sessionStorage.getItem('sync_token');
    const expiry = sessionStorage.getItem('sync_token_expiry');

    if (token && expiry && Date.now() < parseInt(expiry)) {
        syncState.accessToken = token;
        syncState.tokenExpiry = parseInt(expiry);
        syncState.authenticated = true;
        return true;
    }
    return false;
}

// ==================== GOOGLE DRIVE API ====================
async function apiRequest(endpoint, options = {}) {
    if (!tokenValido()) {
        throw new Error('Token no válido. Necesitas autenticarte.');
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3/${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${syncState.accessToken}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Error de API: ${response.status}`);
    }

    return response.json();
}

async function obtenerOcrearCarpeta() {
    // Buscar carpeta existente en appDataFolder
    const searchResponse = await apiRequest(
        `files?spaces=appDataFolder&q=name='${SYNC_CONFIG.folderName}'&fields=files(id,name)`
    );

    if (searchResponse.files && searchResponse.files.length > 0) {
        syncState.folderId = searchResponse.files[0].id;
        return syncState.folderId;
    }

    // Crear carpeta si no existe
    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${syncState.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: SYNC_CONFIG.folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['appDataFolder']
        })
    });

    const folder = await createResponse.json();
    syncState.folderId = folder.id;
    return folder.id;
}

async function buscarArchivoSync() {
    if (!syncState.folderId) {
        await obtenerOcrearCarpeta();
    }

    const searchResponse = await apiRequest(
        `files?spaces=appDataFolder&q=name='${SYNC_CONFIG.dataFileName}' and '${syncState.folderId}' in parents&fields=files(id,name,modifiedTime)`
    );

    if (searchResponse.files && searchResponse.files.length > 0) {
        syncState.fileId = searchResponse.files[0].id;
        return searchResponse.files[0];
    }

    return null;
}

async function subirDatosADrive(datosCifrados) {
    const metadata = {
        name: SYNC_CONFIG.dataFileName,
        parents: syncState.fileId ? undefined : [syncState.folderId]
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([datosCifrados], { type: 'application/octet-stream' }));

    const url = syncState.fileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${syncState.fileId}?uploadType=multipart`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    const response = await fetch(url, {
        method: syncState.fileId ? 'PATCH' : 'POST',
        headers: {
            'Authorization': `Bearer ${syncState.accessToken}`
        },
        body: form
    });

    if (!response.ok) {
        throw new Error('Error al subir datos a Drive');
    }

    const result = await response.json();
    syncState.fileId = result.id;
    return result;
}

async function descargarDatosDeDrive() {
    if (!syncState.fileId) {
        const archivo = await buscarArchivoSync();
        if (!archivo) return null;
    }

    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${syncState.fileId}?alt=media`,
        {
            headers: {
                'Authorization': `Bearer ${syncState.accessToken}`
            }
        }
    );

    if (!response.ok) {
        throw new Error('Error al descargar datos de Drive');
    }

    return await response.text();
}

// ==================== SINCRONIZACIÓN ====================
async function sincronizarDatos(forzar = false) {
    if (syncState.syncInProgress) {
        console.log('Sincronización ya en progreso');
        return { success: false, reason: 'in_progress' };
    }

    if (!estadoPremium.activo || !estadoPremium.codigo) {
        return { success: false, reason: 'no_premium' };
    }

    if (!syncState.authenticated || !tokenValido()) {
        return { success: false, reason: 'no_auth' };
    }

    syncState.syncInProgress = true;
    actualizarUISync('syncing');

    try {
        // 1. Obtener datos locales
        const datosLocales = await obtenerTodosLosDatos();
        datosLocales.metadata = {
            ultimaModificacion: Date.now(),
            dispositivo: obtenerDeviceId(),
            tipoDispositivo: syncState.tipoDispositivo || detectarTipoDispositivo(),
            version: '1.0'
        };

        // 2. Intentar descargar datos remotos
        let datosRemotos = null;
        try {
            const datosCifradosRemotos = await descargarDatosDeDrive();
            if (datosCifradosRemotos) {
                datosRemotos = await descifrarDatos(datosCifradosRemotos, estadoPremium.codigo);
            }
        } catch (e) {
            console.log('No hay datos remotos o error al descifrar:', e.message);
        }

        // 3. Resolver conflictos y fusionar
        let datosFinales;
        if (datosRemotos) {
            datosFinales = fusionarDatos(datosLocales, datosRemotos);
        } else {
            datosFinales = datosLocales;
        }

        // 4. Cifrar y subir
        const datosCifrados = await cifrarDatos(datosFinales, estadoPremium.codigo);
        await subirDatosADrive(datosCifrados);

        // 5. Aplicar datos fusionados localmente si hay cambios remotos
        if (datosRemotos) {
            await aplicarDatosLocalmente(datosFinales);
        }

        syncState.lastSync = Date.now();
        localStorage.setItem('sync_last_sync', syncState.lastSync.toString());

        actualizarUISync('success');
        return { success: true, timestamp: syncState.lastSync };

    } catch (error) {
        console.error('Error en sincronización:', error);
        actualizarUISync('error', error.message);
        return { success: false, reason: 'error', message: error.message };
    } finally {
        syncState.syncInProgress = false;
    }
}

// Fusionar datos locales y remotos
function fusionarDatos(local, remoto) {
    const resultado = {
        expedientes: [],
        notas: [],
        eventos: [],
        config: {},
        metadata: local.metadata
    };

    // Fusionar expedientes (usar timestamp más reciente)
    resultado.expedientes = fusionarColeccion(
        local.expedientes || [],
        remoto.expedientes || [],
        'id'
    );

    // Fusionar notas
    resultado.notas = fusionarColeccion(
        local.notas || [],
        remoto.notas || [],
        'id'
    );

    // Fusionar eventos
    resultado.eventos = fusionarColeccion(
        local.eventos || [],
        remoto.eventos || [],
        'id'
    );

    // Config: usar el más reciente
    if (remoto.metadata?.ultimaModificacion > local.metadata?.ultimaModificacion) {
        resultado.config = { ...local.config, ...remoto.config };
    } else {
        resultado.config = { ...remoto.config, ...local.config };
    }

    return resultado;
}

function fusionarColeccion(local, remoto, idField) {
    const mapa = new Map();

    // Agregar todos los elementos remotos
    remoto.forEach(item => {
        mapa.set(item[idField], item);
    });

    // Sobrescribir con locales más recientes o agregar nuevos
    local.forEach(item => {
        const existente = mapa.get(item[idField]);
        if (!existente) {
            mapa.set(item[idField], item);
        } else {
            // Usar el más reciente
            const fechaLocal = new Date(item.fechaModificacion || item.fechaCreacion || 0);
            const fechaRemoto = new Date(existente.fechaModificacion || existente.fechaCreacion || 0);
            if (fechaLocal >= fechaRemoto) {
                mapa.set(item[idField], item);
            }
        }
    });

    return Array.from(mapa.values());
}

// Obtener todos los datos de IndexedDB
async function obtenerTodosLosDatos() {
    const expedientes = await obtenerExpedientes();
    const notas = await obtenerNotas();
    const eventos = await obtenerEventos();

    return {
        expedientes,
        notas,
        eventos,
        config: {
            notificaciones: await obtenerConfig('notificaciones'),
            email_destino: await obtenerConfig('email_destino')
        }
    };
}

// Aplicar datos fusionados a IndexedDB
async function aplicarDatosLocalmente(datos) {
    // Limpiar y recargar expedientes
    const db = await abrirDB();
    const tx = db.transaction(['expedientes', 'notas', 'eventos'], 'readwrite');

    // Limpiar stores
    await tx.objectStore('expedientes').clear();
    await tx.objectStore('notas').clear();
    await tx.objectStore('eventos').clear();

    // Insertar datos fusionados
    for (const exp of datos.expedientes || []) {
        await tx.objectStore('expedientes').put(exp);
    }
    for (const nota of datos.notas || []) {
        await tx.objectStore('notas').put(nota);
    }
    for (const evento of datos.eventos || []) {
        await tx.objectStore('eventos').put(evento);
    }

    await tx.done;

    // Recargar UI
    await cargarExpedientes();
    await cargarNotas();
    await cargarEventos();
    await cargarEstadisticas();
    renderizarCalendario();
}

// Helper para abrir DB
function abrirDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('TSJFilingDB');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ==================== GESTIÓN DE DISPOSITIVOS ====================
async function registrarDispositivo() {
    if (!estadoPremium.activo || !estadoPremium.codigo) {
        return { success: false, message: 'No hay licencia activa' };
    }

    const deviceId = obtenerDeviceId();
    const tipoDispositivo = detectarTipoDispositivo();
    const nombreDispositivo = obtenerNombreDispositivo();

    try {
        // Verificar con la API cuántos dispositivos permite esta licencia
        const url = `${PREMIUM_CONFIG.apiUrl}?action=registrar_dispositivo` +
            `&codigo=${encodeURIComponent(estadoPremium.codigo)}` +
            `&dispositivo_id=${encodeURIComponent(deviceId)}` +
            `&tipo_dispositivo=${encodeURIComponent(tipoDispositivo)}` +
            `&nombre_dispositivo=${encodeURIComponent(nombreDispositivo)}`;

        const response = await fetch(url);
        const resultado = await response.json();

        if (resultado.success) {
            syncState.dispositivos = resultado.dispositivos || [];
            syncState.maxDispositivos = resultado.maxDispositivos || 2;
            syncState.tipoDispositivo = tipoDispositivo;

            localStorage.setItem('sync_dispositivos', JSON.stringify(syncState.dispositivos));
            localStorage.setItem('sync_max_dispositivos', syncState.maxDispositivos.toString());

            return { success: true, dispositivos: syncState.dispositivos };
        } else {
            return { success: false, message: resultado.mensaje };
        }
    } catch (error) {
        console.error('Error al registrar dispositivo:', error);
        return { success: false, message: 'Error de conexión' };
    }
}

async function desvincularDispositivo(dispositivoId) {
    if (!estadoPremium.activo || !estadoPremium.codigo) {
        return { success: false, message: 'No hay licencia activa' };
    }

    try {
        const url = `${PREMIUM_CONFIG.apiUrl}?action=desvincular_dispositivo` +
            `&codigo=${encodeURIComponent(estadoPremium.codigo)}` +
            `&dispositivo_id=${encodeURIComponent(dispositivoId)}`;

        const response = await fetch(url);
        const resultado = await response.json();

        if (resultado.success) {
            syncState.dispositivos = resultado.dispositivos || [];
            localStorage.setItem('sync_dispositivos', JSON.stringify(syncState.dispositivos));
            return { success: true };
        } else {
            return { success: false, message: resultado.mensaje };
        }
    } catch (error) {
        console.error('Error al desvincular dispositivo:', error);
        return { success: false, message: 'Error de conexión' };
    }
}

function obtenerNombreDispositivo() {
    const ua = navigator.userAgent;
    let nombre = 'Dispositivo desconocido';

    if (/iPhone/i.test(ua)) nombre = 'iPhone';
    else if (/iPad/i.test(ua)) nombre = 'iPad';
    else if (/Android/i.test(ua)) nombre = 'Android';
    else if (/Windows/i.test(ua)) nombre = 'Windows PC';
    else if (/Mac/i.test(ua)) nombre = 'Mac';
    else if (/Linux/i.test(ua)) nombre = 'Linux PC';

    return nombre;
}

// ==================== UI DE SINCRONIZACIÓN ====================
function actualizarUISync(estado, mensaje = '') {
    const statusEl = document.getElementById('sync-status');
    const btnSync = document.getElementById('btn-sync');

    if (!statusEl) return;

    switch (estado) {
        case 'disabled':
            statusEl.innerHTML = '<span class="sync-dot offline"></span> Sincronización desactivada';
            if (btnSync) btnSync.disabled = false;
            break;
        case 'offline':
            statusEl.innerHTML = '<span class="sync-dot offline"></span> Sin conexión';
            if (btnSync) btnSync.disabled = true;
            break;
        case 'syncing':
            statusEl.innerHTML = '<span class="sync-dot syncing"></span> Sincronizando...';
            if (btnSync) btnSync.disabled = true;
            break;
        case 'success':
            const tiempo = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
            statusEl.innerHTML = `<span class="sync-dot online"></span> Sincronizado (${tiempo})`;
            if (btnSync) btnSync.disabled = false;
            break;
        case 'error':
            statusEl.innerHTML = `<span class="sync-dot error"></span> Error: ${mensaje}`;
            if (btnSync) btnSync.disabled = false;
            break;
        case 'ready':
            statusEl.innerHTML = '<span class="sync-dot online"></span> Listo para sincronizar';
            if (btnSync) btnSync.disabled = false;
            break;
    }
}

function mostrarModalDispositivos() {
    const dispositivos = syncState.dispositivos || [];
    const maxDisp = syncState.maxDispositivos || 2;
    const currentDeviceId = obtenerDeviceId();

    const dispositivosHTML = dispositivos.length > 0
        ? dispositivos.map(d => `
            <div class="dispositivo-item ${d.id === currentDeviceId ? 'current' : ''}">
                <div class="dispositivo-info">
                    <span class="dispositivo-icon">${d.tipo === 'mobile' ? '📱' : '💻'}</span>
                    <div>
                        <strong>${d.nombre || 'Dispositivo'}</strong>
                        ${d.id === currentDeviceId ? '<span class="badge-current">Este dispositivo</span>' : ''}
                        <br>
                        <small class="text-muted">
                            Vinculado: ${new Date(d.fechaRegistro).toLocaleDateString('es-MX')}
                        </small>
                    </div>
                </div>
                ${d.id !== currentDeviceId ? `
                    <button class="btn btn-sm btn-danger" onclick="confirmarDesvincular('${d.id}')">
                        🗑️ Desvincular
                    </button>
                ` : ''}
            </div>
        `).join('')
        : '<p class="text-muted">No hay dispositivos vinculados</p>';

    document.getElementById('modal-titulo').textContent = '📱 Dispositivos Vinculados';
    document.getElementById('modal-body').innerHTML = `
        <div class="dispositivos-info">
            <p>Dispositivos: <strong>${dispositivos.length}</strong> de <strong>${maxDisp}</strong> permitidos</p>
            <div class="progress-bar" style="margin-bottom: 1rem;">
                <div class="progress-fill" style="width: ${(dispositivos.length / maxDisp) * 100}%"></div>
            </div>
        </div>
        <div class="dispositivos-lista">
            ${dispositivosHTML}
        </div>
        ${dispositivos.length < maxDisp ? `
            <div class="info-banner" style="margin-top: 1rem;">
                <div class="info-icon">💡</div>
                <div class="info-content">
                    <p>Puedes vincular ${maxDisp - dispositivos.length} dispositivo(s) más.</p>
                </div>
            </div>
        ` : ''}
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

async function confirmarDesvincular(dispositivoId) {
    if (confirm('¿Estás seguro de desvincular este dispositivo? Perderá acceso a la sincronización.')) {
        mostrarToast('Desvinculando dispositivo...', 'info');
        const resultado = await desvincularDispositivo(dispositivoId);

        if (resultado.success) {
            mostrarToast('Dispositivo desvinculado', 'success');
            mostrarModalDispositivos(); // Refrescar modal
        } else {
            mostrarToast(resultado.message || 'Error al desvincular', 'error');
        }
    }
}

// ==================== CONFIGURACIÓN DE SYNC ====================
async function configurarSync() {
    const clientId = document.getElementById('sync-client-id')?.value.trim();

    if (clientId) {
        localStorage.setItem('sync_client_id', clientId);
        SYNC_CONFIG.clientId = clientId;
    }

    mostrarToast('Configuración guardada', 'success');
}

async function activarSync() {
    if (!estadoPremium.activo) {
        mostrarToast('Necesitas una licencia Premium activa', 'warning');
        return;
    }

    // Leer el Client ID del input y guardarlo
    const inputClientId = document.getElementById('sync-client-id');
    let clientId = inputClientId ? inputClientId.value.trim() : '';

    // Si hay valor en el input, guardarlo
    if (clientId) {
        localStorage.setItem('sync_client_id', clientId);
        SYNC_CONFIG.clientId = clientId;
    } else {
        // Intentar recuperar de localStorage
        clientId = localStorage.getItem('sync_client_id') || SYNC_CONFIG.clientId;
    }

    if (!clientId) {
        mostrarToast('Ingresa el Client ID de Google en el campo de arriba', 'warning');
        if (inputClientId) inputClientId.focus();
        return;
    }

    try {
        mostrarToast('Conectando con Google...', 'info');

        // 1. Autenticar con Google
        await iniciarAutenticacionGoogle();

        // 2. Registrar dispositivo
        const regResult = await registrarDispositivo();
        if (!regResult.success) {
            mostrarToast(regResult.message || 'Error al registrar dispositivo', 'error');
            return;
        }

        // 3. Crear carpeta si no existe
        await obtenerOcrearCarpeta();

        // 4. Buscar archivo existente
        await buscarArchivoSync();

        syncState.enabled = true;
        localStorage.setItem('sync_enabled', 'true');

        // 5. Sincronizar
        await sincronizarDatos();

        mostrarToast('¡Sincronización activada!', 'success');
        actualizarUISyncPanel();

    } catch (error) {
        console.error('Error al activar sync:', error);
        mostrarToast('Error: ' + error.message, 'error');
    }
}

function desactivarSync() {
    syncState.enabled = false;
    syncState.authenticated = false;
    syncState.accessToken = null;

    localStorage.removeItem('sync_enabled');
    sessionStorage.removeItem('sync_token');
    sessionStorage.removeItem('sync_token_expiry');

    actualizarUISync('disabled');
    actualizarUISyncPanel();
    mostrarToast('Sincronización desactivada', 'info');
}

function actualizarUISyncPanel() {
    const panelAuth = document.getElementById('sync-panel-auth');
    const panelActive = document.getElementById('sync-panel-active');

    if (!panelAuth || !panelActive) return;

    if (syncState.enabled && syncState.authenticated) {
        panelAuth.style.display = 'none';
        panelActive.style.display = 'block';
    } else {
        panelAuth.style.display = 'block';
        panelActive.style.display = 'none';
    }
}

// ==================== AUTO-SYNC ====================
let autoSyncTimer = null;

function iniciarAutoSync() {
    if (autoSyncTimer) clearInterval(autoSyncTimer);

    autoSyncTimer = setInterval(async () => {
        if (syncState.enabled && syncState.authenticated && navigator.onLine) {
            await sincronizarDatos();
        }
    }, SYNC_CONFIG.autoSyncInterval);
}

function detenerAutoSync() {
    if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
    }
}

// ==================== INICIALIZACIÓN ====================
async function inicializarSync() {
    // Detectar tipo de dispositivo
    syncState.tipoDispositivo = detectarTipoDispositivo();

    // Cargar configuración guardada
    const syncEnabled = localStorage.getItem('sync_enabled') === 'true';
    const lastSync = localStorage.getItem('sync_last_sync');
    const dispositivos = localStorage.getItem('sync_dispositivos');
    const maxDisp = localStorage.getItem('sync_max_dispositivos');
    const savedClientId = localStorage.getItem('sync_client_id');

    if (lastSync) syncState.lastSync = parseInt(lastSync);
    if (dispositivos) syncState.dispositivos = JSON.parse(dispositivos);
    if (maxDisp) syncState.maxDispositivos = parseInt(maxDisp);

    // Restaurar Client ID al input si existe
    if (savedClientId) {
        SYNC_CONFIG.clientId = savedClientId;
        const inputClientId = document.getElementById('sync-client-id');
        if (inputClientId) {
            inputClientId.value = savedClientId;
        }
    }

    // Restaurar token si existe
    if (syncEnabled && restaurarToken()) {
        syncState.enabled = true;
        actualizarUISync('ready');
        iniciarAutoSync();
    } else {
        actualizarUISync('disabled');
    }

    actualizarUISyncPanel();

    // Escuchar cambios de conexión
    window.addEventListener('online', () => {
        if (syncState.enabled) {
            sincronizarDatos();
        }
    });

    window.addEventListener('offline', () => {
        actualizarUISync('offline');
    });
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarSync);
} else {
    inicializarSync();
}

// ==================== EXPORTAR FUNCIONES GLOBALES ====================
window.sincronizarDatos = sincronizarDatos;
window.activarSync = activarSync;
window.desactivarSync = desactivarSync;
window.mostrarModalDispositivos = mostrarModalDispositivos;
window.confirmarDesvincular = confirmarDesvincular;
window.configurarSync = configurarSync;
