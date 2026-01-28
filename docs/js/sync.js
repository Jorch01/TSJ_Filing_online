// ==================== SINCRONIZACIÓN SIMPLE VIA GOOGLE SHEETS ====================
// Los datos se cifran localmente y se almacenan en tu Google Sheet
// El usuario solo necesita su código premium - nada más

// ==================== ESTADO ====================
let syncState = {
    lastSync: null,
    syncInProgress: false
};

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
        const salt = 'TSJ_Filing_Sync_v2';
        const clave = await generarClaveDesdePassword(codigoPremium, salt);

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();
        const datosBytes = encoder.encode(JSON.stringify(datos));

        const datosCifrados = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            clave,
            datosBytes
        );

        const resultado = new Uint8Array(iv.length + datosCifrados.byteLength);
        resultado.set(iv);
        resultado.set(new Uint8Array(datosCifrados), iv.length);

        return btoa(String.fromCharCode(...resultado));
    } catch (error) {
        console.error('Error al cifrar:', error);
        throw new Error('Error al cifrar datos');
    }
}

async function descifrarDatos(datosCifradosBase64, codigoPremium) {
    try {
        const salt = 'TSJ_Filing_Sync_v2';
        const clave = await generarClaveDesdePassword(codigoPremium, salt);

        const datosCompletos = Uint8Array.from(atob(datosCifradosBase64), c => c.charCodeAt(0));
        const iv = datosCompletos.slice(0, 12);
        const datosCifrados = datosCompletos.slice(12);

        const datosDescifrados = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            clave,
            datosCifrados
        );

        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(datosDescifrados));
    } catch (error) {
        console.error('Error al descifrar:', error);
        throw new Error('Error al descifrar. ¿Código incorrecto?');
    }
}

// ==================== SINCRONIZACIÓN ====================
async function sincronizarDatos() {
    // Verificar premium
    if (!estadoPremium.activo || !estadoPremium.codigo) {
        mostrarToast('Necesitas una licencia Premium activa', 'warning');
        return;
    }

    if (syncState.syncInProgress) {
        mostrarToast('Sincronización en progreso...', 'info');
        return;
    }

    syncState.syncInProgress = true;
    actualizarUISync('syncing');

    try {
        // 1. Obtener datos remotos (si existen)
        let datosRemotos = null;
        try {
            const remotos = await descargarDatosRemotos();
            if (remotos) {
                datosRemotos = await descifrarDatos(remotos, estadoPremium.codigo);
            }
        } catch (e) {
            console.log('No hay datos remotos o error:', e.message);
        }

        // 2. Obtener datos locales
        const datosLocales = await obtenerTodosLosDatos();
        datosLocales.metadata = {
            ultimaModificacion: Date.now(),
            dispositivo: obtenerDeviceId(),
            version: '2.0'
        };

        // 3. Fusionar datos
        let datosFinales;
        if (datosRemotos && datosRemotos.metadata) {
            datosFinales = fusionarDatos(datosLocales, datosRemotos);
            // Aplicar datos fusionados localmente
            await aplicarDatosLocalmente(datosFinales);
            mostrarToast('Datos sincronizados desde otro dispositivo', 'success');
        } else {
            datosFinales = datosLocales;
        }

        // 4. Subir datos cifrados
        const datosCifrados = await cifrarDatos(datosFinales, estadoPremium.codigo);
        await subirDatosRemotos(datosCifrados);

        syncState.lastSync = Date.now();
        localStorage.setItem('sync_last_sync', syncState.lastSync.toString());

        actualizarUISync('success');

    } catch (error) {
        console.error('Error en sincronización:', error);
        actualizarUISync('error', error.message);
        mostrarToast('Error: ' + error.message, 'error');
    } finally {
        syncState.syncInProgress = false;
    }
}

// Descargar datos del servidor
async function descargarDatosRemotos() {
    const url = `${PREMIUM_CONFIG.apiUrl}?action=obtener_sync&codigo=${encodeURIComponent(estadoPremium.codigo)}`;
    const response = await fetch(url);
    const resultado = await response.json();

    if (resultado.success && resultado.datos) {
        return resultado.datos;
    }
    return null;
}

// Subir datos al servidor
async function subirDatosRemotos(datosCifrados) {
    const url = `${PREMIUM_CONFIG.apiUrl}?action=guardar_sync&codigo=${encodeURIComponent(estadoPremium.codigo)}&datos=${encodeURIComponent(datosCifrados)}`;
    const response = await fetch(url);
    const resultado = await response.json();

    if (!resultado.success) {
        throw new Error(resultado.mensaje || 'Error al guardar en servidor');
    }
    return resultado;
}

// Fusionar datos locales y remotos
function fusionarDatos(local, remoto) {
    const resultado = {
        expedientes: fusionarColeccion(local.expedientes || [], remoto.expedientes || []),
        notas: fusionarColeccion(local.notas || [], remoto.notas || []),
        eventos: fusionarColeccion(local.eventos || [], remoto.eventos || []),
        metadata: local.metadata
    };
    return resultado;
}

function fusionarColeccion(local, remoto) {
    const mapa = new Map();

    // Agregar remotos
    remoto.forEach(item => {
        if (item.id) mapa.set(item.id, item);
    });

    // Sobrescribir con locales más recientes
    local.forEach(item => {
        if (!item.id) return;
        const existente = mapa.get(item.id);
        if (!existente) {
            mapa.set(item.id, item);
        } else {
            const fechaLocal = new Date(item.fechaModificacion || item.fechaCreacion || 0);
            const fechaRemoto = new Date(existente.fechaModificacion || existente.fechaCreacion || 0);
            if (fechaLocal >= fechaRemoto) {
                mapa.set(item.id, item);
            }
        }
    });

    return Array.from(mapa.values());
}

// Obtener todos los datos locales
async function obtenerTodosLosDatos() {
    const expedientes = await obtenerExpedientes();
    const notas = await obtenerNotas();
    const eventos = await obtenerEventos();

    return { expedientes, notas, eventos };
}

// Aplicar datos a IndexedDB
async function aplicarDatosLocalmente(datos) {
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('TSJFilingDB');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    const tx = db.transaction(['expedientes', 'notas', 'eventos'], 'readwrite');

    // Limpiar y repoblar
    const storeExp = tx.objectStore('expedientes');
    const storeNotas = tx.objectStore('notas');
    const storeEventos = tx.objectStore('eventos');

    await Promise.all([
        new Promise(r => { storeExp.clear().onsuccess = r; }),
        new Promise(r => { storeNotas.clear().onsuccess = r; }),
        new Promise(r => { storeEventos.clear().onsuccess = r; })
    ]);

    for (const exp of datos.expedientes || []) {
        storeExp.put(exp);
    }
    for (const nota of datos.notas || []) {
        storeNotas.put(nota);
    }
    for (const evento of datos.eventos || []) {
        storeEventos.put(evento);
    }

    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    // Recargar UI
    await cargarExpedientes();
    await cargarNotas();
    await cargarEventos();
    await cargarEstadisticas();
    renderizarCalendario();
}

// ==================== UI ====================
function actualizarUISync(estado, mensaje = '') {
    const statusEl = document.getElementById('sync-status');
    const btnSync = document.getElementById('btn-sync');
    const lastSyncEl = document.getElementById('sync-last-time');

    if (statusEl) {
        switch (estado) {
            case 'syncing':
                statusEl.innerHTML = '<span class="sync-dot syncing"></span> Sincronizando...';
                break;
            case 'success':
                statusEl.innerHTML = '<span class="sync-dot online"></span> Sincronizado';
                break;
            case 'error':
                statusEl.innerHTML = '<span class="sync-dot error"></span> Error';
                break;
            default:
                statusEl.innerHTML = '<span class="sync-dot offline"></span> No sincronizado';
        }
    }

    if (btnSync) {
        btnSync.disabled = estado === 'syncing';
    }

    if (lastSyncEl && syncState.lastSync) {
        const fecha = new Date(syncState.lastSync);
        lastSyncEl.textContent = fecha.toLocaleString('es-MX');
    }
}

function inicializarSync() {
    // Cargar última sincronización
    const lastSync = localStorage.getItem('sync_last_sync');
    if (lastSync) {
        syncState.lastSync = parseInt(lastSync);
    }

    // Actualizar UI inicial
    if (syncState.lastSync) {
        actualizarUISync('success');
    }

    // Mostrar/ocultar sección según estado premium
    actualizarVisibilidadSync();
}

function actualizarVisibilidadSync() {
    const syncSection = document.getElementById('sync-section');
    if (syncSection) {
        // Siempre visible pero con mensaje si no es premium
        const content = syncSection.querySelector('.sync-content');
        const noPremium = syncSection.querySelector('.sync-no-premium');

        if (estadoPremium.activo) {
            if (content) content.style.display = 'block';
            if (noPremium) noPremium.style.display = 'none';
        } else {
            if (content) content.style.display = 'none';
            if (noPremium) noPremium.style.display = 'block';
        }
    }
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarSync);
} else {
    setTimeout(inicializarSync, 100);
}

// Exportar funciones globales
window.sincronizarDatos = sincronizarDatos;
