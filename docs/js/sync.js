// ==================== SINCRONIZACIÓN SIMPLE VIA GOOGLE SHEETS ====================
// Los datos se cifran localmente y se almacenan en tu Google Sheet
// El usuario solo necesita su código premium - nada más

// ==================== ESTADO ====================
let syncState = {
    lastSync: null,
    syncInProgress: false,
    // Versión (hash SHA-256) del blob remoto en la última descarga. Se envía en
    // la subida para que el servidor detecte si otro dispositivo escribió en
    // medio y nos responda con conflict en vez de sobrescribir.
    remoteVersion: null
};

// ==================== LOCK MULTI-PESTAÑA ====================
// localStorage es compartido entre pestañas del mismo origen. Una pestaña
// que va a sincronizar pone un token con timestamp; las demás lo respetan
// si es reciente. Evita que dos pestañas suban a la vez y se pisen el
// resultado del merge.
const SYNC_TAB_LOCK_KEY = 'sync_tab_lock';
const SYNC_TAB_LOCK_TTL_MS = 90 * 1000; // 90s: más que cualquier sync típica
const SYNC_TAB_ID = (() => {
    try {
        const k = 'sync_tab_id';
        let id = sessionStorage.getItem(k);
        if (!id) {
            id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            sessionStorage.setItem(k, id);
        }
        return id;
    } catch (e) {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
})();

function adquirirLockSync() {
    try {
        const raw = localStorage.getItem(SYNC_TAB_LOCK_KEY);
        if (raw) {
            const lock = JSON.parse(raw);
            if (lock && lock.tabId !== SYNC_TAB_ID && (Date.now() - (lock.ts || 0)) < SYNC_TAB_LOCK_TTL_MS) {
                return false;
            }
        }
        localStorage.setItem(SYNC_TAB_LOCK_KEY, JSON.stringify({ tabId: SYNC_TAB_ID, ts: Date.now() }));
        return true;
    } catch (e) {
        return true; // si localStorage falla, no bloquear
    }
}

function liberarLockSync() {
    try {
        const raw = localStorage.getItem(SYNC_TAB_LOCK_KEY);
        if (raw) {
            const lock = JSON.parse(raw);
            if (lock && lock.tabId === SYNC_TAB_ID) {
                localStorage.removeItem(SYNC_TAB_LOCK_KEY);
            }
        }
    } catch (e) {}
}

// Si la pestaña se cierra durante un sync, liberar el lock para no bloquear
// a las demás durante 90s.
window.addEventListener('beforeunload', () => {
    if (syncState.syncInProgress) liberarLockSync();
});

// ==================== TRACKING DE CAMBIOS PENDIENTES ====================
// Marca que hay cambios locales pendientes de subir al servidor. Sirve para
// recuperarse de syncs abortados (típicamente iOS Safari suspende fetch en
// segundo plano y la subida fire-and-forget se mata). Si un sync queda a medias,
// el flag persiste en localStorage y la siguiente carga o volver al foreground
// dispara el reintento.
function marcarPendienteSync() {
    try {
        localStorage.setItem('sync_pendiente', Date.now().toString());
    } catch (e) {}
    actualizarBadgePendiente();
}

function limpiarPendienteSync() {
    try {
        localStorage.removeItem('sync_pendiente');
    } catch (e) {}
    actualizarBadgePendiente();
}

function hayPendienteSync() {
    return !!localStorage.getItem('sync_pendiente');
}

function actualizarBadgePendiente() {
    const badge = document.getElementById('sync-pendiente-badge');
    if (badge) {
        badge.style.display = hayPendienteSync() ? 'inline-flex' : 'none';
    }
}

// Helper para usar desde app.js tras guardar/eliminar/archivar:
//   - Marca el cambio como pendiente.
//   - Dispara sincronizarDatos y AWAITEA para que el usuario vea el indicador
//     "Sincronizando…" hasta que termine.
//   - Si falla (red, iOS aborta), el flag de pendiente queda y se reintentará
//     al recargar la app o al volver la pestaña a primer plano.
async function marcarYSincronizar() {
    if (typeof estadoPremium === 'undefined' || !estadoPremium.activo || !estadoPremium.codigo) return;
    marcarPendienteSync();
    try {
        await sincronizarDatos();
    } catch (e) {
        console.warn('Sync falló, queda pendiente para reintento:', e && e.message ? e.message : e);
    }
}

// ==================== COMPRESIÓN GZIP (reduce el blob 60-70%) ====================
// Comprime antes de cifrar y descomprime después de descifrar.
// Esto evita que el blob supere el límite de 50 000 chars de la celda de Google Sheets
// incluso cuando los expedientes contienen _fieldTimestamps u otros campos extra.
// API disponible en Chrome 80+, Firefox 113+, Safari 16.4+.
// Si no está disponible, se cae silenciosamente a sin compresión.
async function _gzipEncode(str) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
        const bytes = new TextEncoder().encode(str);
        const cs = new CompressionStream('gzip');
        const writer = cs.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const buf = await new Response(cs.readable).arrayBuffer();
        return new Uint8Array(buf);
    } catch (e) {
        return null;
    }
}

async function _gzipDecode(bytes) {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(buf);
}

// Convierte Uint8Array → base64 en chunks para no reventar el call stack
// con el operador spread en arrays grandes (>100k bytes).
function _uint8ToBase64(bytes) {
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
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
        const salt = 'TSJ_Filing_Sync_v2';
        const clave = await generarClaveDesdePassword(codigoPremium, salt);

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const json = JSON.stringify(datos);

        // Comprimir antes de cifrar. Si el browser no soporta la API, se usa UTF-8 directo.
        const compressed = await _gzipEncode(json);
        const datosBytes = compressed || new TextEncoder().encode(json);

        const datosCifrados = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            clave,
            datosBytes
        );

        const resultado = new Uint8Array(iv.length + datosCifrados.byteLength);
        resultado.set(iv);
        resultado.set(new Uint8Array(datosCifrados), iv.length);

        return _uint8ToBase64(resultado);
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

        const bytes = new Uint8Array(datosDescifrados);

        // Intentar descomprimir (formato nuevo). Si falla, el blob es texto JSON
        // plano (formato antiguo) — decodificar como UTF-8 directo.
        let json;
        try {
            json = await _gzipDecode(bytes);
        } catch (e) {
            json = new TextDecoder().decode(bytes);
        }
        return JSON.parse(json);
    } catch (error) {
        console.error('Error al descifrar:', error);
        throw new Error('Error al descifrar. ¿Código incorrecto?');
    }
}

// ==================== SINCRONIZACIÓN ====================
// Ejecuta UN intento de ciclo descargar → fusionar → aplicar → subir.
// Si el servidor responde conflict (otro dispositivo escribió mientras tanto),
// la función externa sincronizarDatos llama de nuevo a este intento.
async function _intentoSincronizar() {
    // 1. Obtener datos remotos (si existen) y su versión
    let datosRemotos = null;
    let versionRemota = null;
    try {
        const respuestaRemota = await descargarDatosRemotos();
        if (respuestaRemota) {
            versionRemota = respuestaRemota.version || null;
            if (respuestaRemota.datos) {
                datosRemotos = await descifrarDatos(respuestaRemota.datos, estadoPremium.codigo);
            }
        }
    } catch (e) {
        console.log('No hay datos remotos o error:', e.message);
    }
    syncState.remoteVersion = versionRemota;

    // 2. Obtener datos locales
    const datosLocales = await obtenerTodosLosDatos();
    datosLocales.metadata = {
        ultimaModificacion: Date.now(),
        dispositivo: obtenerDeviceId(),
        version: '2.0'
    };

    // 3. Aplicar eliminaciones remotas primero (si hay datos remotos)
    let eliminadosAplicados = 0;
    if (datosRemotos && datosRemotos.eliminados && datosRemotos.eliminados.length > 0) {
        eliminadosAplicados = await aplicarEliminacionesRemotas(datosRemotos.eliminados);
        if (eliminadosAplicados > 0) {
            console.log(`Se eliminaron ${eliminadosAplicados} expediente(s) por sincronización remota`);
        }
    }

    // 4. Obtener datos locales actualizados (después de aplicar eliminaciones)
    const datosLocalesActualizados = await obtenerTodosLosDatos();
    datosLocalesActualizados.metadata = datosLocales.metadata;

    // 5. Fusionar datos
    let datosFinales;
    let huboDuplicados = false;
    if (datosRemotos && datosRemotos.metadata) {
        datosFinales = fusionarDatos(datosLocalesActualizados, datosRemotos);
        await aplicarDatosLocalmente(datosFinales);

        huboDuplicados = reporteFusionDuplicados.expedientesFusionados.length > 0;
    } else {
        datosFinales = datosLocalesActualizados;
    }

    // 6. Decidir si hay algo nuevo que subir.
    // Comparamos el CONTENIDO CLARO (no el cifrado): el cifrado usa IV aleatorio
    // y el hash del blob cambia en cada cifrado aunque los datos sean idénticos.
    // Si el cleartext fusionado es igual al remoto que descargamos, no hace
    // falta volver a subir — solo gastaríamos cuota de Apps Script.
    const huellaLocal = huellaContenido(datosFinales);
    const huellaRemota = datosRemotos ? huellaContenido(datosRemotos) : null;

    let subido = false;
    let conflictoServidor = false;

    if (huellaLocal !== huellaRemota) {
        const datosCifrados = await cifrarDatos(datosFinales, estadoPremium.codigo);
        const respSubida = await subirDatosRemotos(datosCifrados, versionRemota);
        if (respSubida && respSubida.conflict) {
            conflictoServidor = true;
        } else if (respSubida && respSubida.success) {
            subido = true;
            if (respSubida.version) {
                syncState.remoteVersion = respSubida.version;
            }
        }
    }
    // Si huellaLocal === huellaRemota: ya está alineado, no subimos nada.

    return {
        conflictoServidor,
        subido,
        eliminadosAplicados,
        huboDuplicados,
        habiaDatosRemotos: !!(datosRemotos && datosRemotos.metadata)
    };
}

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

    if (!adquirirLockSync()) {
        console.log('Otra pestaña está sincronizando, omitiendo en esta');
        return;
    }

    syncState.syncInProgress = true;
    actualizarUISync('syncing');

    try {
        // Hasta 3 ciclos en caso de conflict (otro dispositivo escribió mientras
        // estábamos fusionando). Cada reintento re-descarga y vuelve a fusionar.
        let resultado = null;
        for (let intento = 0; intento < 3; intento++) {
            resultado = await _intentoSincronizar();
            if (!resultado.conflictoServidor) break;
            console.log('Conflict de sync, reintentando con datos frescos…');
            await new Promise(r => setTimeout(r, 500));
        }

        if (resultado && resultado.conflictoServidor) {
            // Tras 3 intentos seguimos en conflict — el servidor está cambiando
            // muy rápido. Dejamos el flag pendiente para el próximo trigger.
            throw new Error('Conflictos repetidos con otro dispositivo. Se reintentará.');
        }

        if (resultado && resultado.habiaDatosRemotos) {
            if (resultado.eliminadosAplicados > 0) {
                mostrarToast(`Sincronización completada. ${resultado.eliminadosAplicados} expediente(s) eliminado(s)`, 'success');
            } else if (resultado.huboDuplicados) {
                mostrarToast('Sincronización completada con fusión de duplicados', 'success');
            } else if (resultado.subido) {
                mostrarToast('Datos sincronizados', 'success');
            }
        }

        syncState.lastSync = Date.now();
        localStorage.setItem('sync_last_sync', syncState.lastSync.toString());
        limpiarPendienteSync();

        actualizarUISync('success');

    } catch (error) {
        console.error('Error en sincronización:', error);
        actualizarUISync('error', error.message);
        mostrarToast('Error: ' + error.message, 'error');
    } finally {
        syncState.syncInProgress = false;
        liberarLockSync();
    }
}

// Huella estable del contenido de sincronización, omitiendo metadata volátil
// (timestamp de la ejecución actual, dispositivo). Sirve para detectar si los
// datos a subir son realmente nuevos vs lo que acabamos de descargar — el
// cifrado AES-GCM usa IV aleatorio por lo que comparar el blob cifrado no
// sirve. JSON.stringify es estable mientras las claves vengan en el mismo orden;
// como datosFinales y datosRemotos vienen del mismo fusionador / sheet, su
// orden de keys coincide.
function huellaContenido(datos) {
    if (!datos) return '';
    // Normalizar historial igual que obtenerTodosLosDatos: solo los campos
    // ligeros y los 200 más recientes. Esto hace que la huella del blob que
    // acabamos de descargar sea comparable con la huella de lo que subiríamos.
    const histNorm = (datos.historial || [])
        .sort((a, b) => (b.fecha || '') > (a.fecha || '') ? 1 : -1)
        .slice(0, MAX_HISTORIAL_SYNC)
        .map(({ id, expedienteId, tipo, descripcion, fecha }) =>
            ({ id, expedienteId, tipo, descripcion, fecha }));
    // Todo lo que se sube debe entrar en la huella: si un store queda fuera,
    // un cambio que solo lo afecte a él parece "sin novedades" y no se sube.
    const copia = {
        expedientes: datos.expedientes || [],
        notas: datos.notas || [],
        eventos: datos.eventos || [],
        pendientes: datos.pendientes || [],
        carpetas: datos.carpetas || [],
        eliminados: datos.eliminados || [],
        historial: histNorm,
        sigaGuardadas: datos.sigaGuardadas || []
    };
    try {
        return JSON.stringify(copia);
    } catch (e) {
        return Math.random().toString(); // forzar upload si no se puede serializar
    }
}

// Distingue por qué falló un fetch. Antes todo acababa en "verifica tu
// conexión a internet", incluidos los que no tienen nada que ver con la
// conexión: un servidor que tarda demasiado y un permiso mal puesto se veían
// exactamente igual, y eso manda a buscar el problema donde no está.
//
// - 'tiempo'    el servidor no contestó a tiempo (AbortError del AbortController)
// - 'red'       no se pudo alcanzar el servidor: sin conexión, CORS, o el
//               despliegue pide iniciar sesión en vez de responder
// - 'servidor'  contestó, pero con un error (HTTP 4xx/5xx)
// - 'otro'      cualquier otra cosa
function _clasificarErrorFetch(error) {
    if (error.name === 'AbortError') return 'tiempo';
    if (error.name === 'TypeError' ||
        /NetworkError|Failed to fetch|Load failed|network/i.test(error.message)) return 'red';
    if (/^HTTP \d{3}/.test(error.message)) return 'servidor';
    return 'otro';
}

function _mensajeErrorFetch(tipo, error, segundos) {
    switch (tipo) {
        case 'tiempo':
            return `El servidor no respondió en ${segundos} segundos. ` +
                   'Suele pasar cuando hay muchos datos que subir; vuelve a intentarlo ' +
                   'y si sigue igual, avisa: puede que el bloque de sincronización sea demasiado grande.';
        case 'red':
            return 'No se pudo contactar con el servidor de sincronización. ' +
                   'Puede ser tu conexión, o que el despliegue de Google Apps Script ya no sea público ' +
                   '(comprueba que su acceso siga siendo "cualquier persona con el enlace").';
        case 'servidor':
            return `El servidor respondió con un error (${error.message}).`;
        default:
            return error.message;
    }
}

// Función auxiliar para fetch con timeout y reintentos
async function fetchConReintentos(url, opciones = {}, maxReintentos = 3) {
    const timeout = opciones.timeout || 30000; // 30 segundos por defecto

    for (let intento = 0; intento <= maxReintentos; intento++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                ...opciones,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;
        } catch (error) {
            const tipo = _clasificarErrorFetch(error);
            const reintentable = tipo === 'red' || tipo === 'tiempo';

            if (reintentable && intento < maxReintentos) {
                // Esperar con backoff exponencial: 2s, 4s, 8s
                const espera = Math.pow(2, intento + 1) * 1000;
                console.log(`Reintentando en ${espera / 1000}s (intento ${intento + 1}/${maxReintentos}) ` +
                            `— causa: ${tipo} (${error.name}: ${error.message})`);
                await new Promise(r => setTimeout(r, espera));
                continue;
            }

            if (tipo === 'otro') throw error;

            const fallo = new Error(_mensajeErrorFetch(tipo, error, Math.round(timeout / 1000)));
            fallo.tipoFallo = tipo;
            fallo.causaOriginal = `${error.name}: ${error.message}`;
            throw fallo;
        }
    }
}

// Descargar datos del servidor
async function descargarDatosRemotos() {
    const url = `${PREMIUM_CONFIG.apiUrl}?action=obtener_sync&codigo=${encodeURIComponent(estadoPremium.codigo)}`;

    try {
        const response = await fetchConReintentos(url, {
            method: 'GET',
            timeout: 30000
        });
        const texto = await response.text();

        // Intentar parsear JSON
        let resultado;
        try {
            resultado = JSON.parse(texto);
        } catch (e) {
            console.error('Respuesta no es JSON:', texto);
            throw new Error('Respuesta inválida del servidor');
        }

        if (resultado.error) {
            throw new Error(resultado.mensaje || 'Error del servidor');
        }

        if (resultado.success && resultado.datos) {
            return { datos: resultado.datos, version: resultado.version || null };
        }
        if (resultado.success) {
            // Cuenta válida pero sin datos remotos todavía.
            return { datos: null, version: resultado.version || '' };
        }
        return null;
    } catch (error) {
        console.error('Error descargando datos:', error);
        throw error;
    }
}

// Subir datos al servidor (usando POST para datos grandes)
// IMPORTANTE: usamos text/plain con body JSON (no URLSearchParams) para evitar:
//   1) Inflado ~3x del body por URL-encoding de base64 (+, /, = → %2B, %2F, %3D)
//   2) Que Apps Script rechace/timeoutee el POST y devuelva HTML sin CORS.
// text/plain es "simple request" (no dispara preflight) y el doPost del Apps Script
// ya soporta leer JSON desde e.postData.contents.
// version_expected es el hash que vimos en la última descarga. El servidor
// rechaza la subida con conflict si su cell tiene un hash distinto (alguien
// más escribió en medio).
// Una celda de Google Sheets no admite más de 50 000 caracteres. El bloque
// cifrado se reparte entre varias columnas (K a N), así que lo que cabe es esa
// cifra multiplicada por el número de columnas. Se deja algo de margen por
// celda para no jugarse el borde exacto.
const CELDAS_DATOS_SYNC = 4;
const TAMANO_POR_CELDA = 49000;
const LIMITE_CELDA_SHEETS = CELDAS_DATOS_SYNC * TAMANO_POR_CELDA;
const AVISO_CELDA_SHEETS = Math.round(LIMITE_CELDA_SHEETS * 0.9);

/**
 * Parte el bloque en los trozos que van a cada columna. Devuelve siempre
 * CELDAS_DATOS_SYNC elementos: los sobrantes van vacíos para que el servidor
 * limpie las columnas que ya no se usan (si no, quedaría cola de una
 * sincronización anterior más larga y el bloque se leería corrupto).
 */
function _partirParaCeldas(texto) {
    const partes = [];
    for (let i = 0; i < CELDAS_DATOS_SYNC; i++) {
        partes.push(texto.substr(i * TAMANO_POR_CELDA, TAMANO_POR_CELDA));
    }
    return partes;
}

/**
 * Mueve lo que hay en la nube a las columnas de respaldo y deja la
 * sincronización vacía. La llama SOLO el borrado masivo desde configuración:
 * en una sincronización normal el respaldo se sobrescribiría con cada guardado
 * y no serviría para recuperar nada.
 *
 * Devuelve { ok: true, respaldado } o { error: 'motivo' }. No lanza: quien
 * borra decide si sigue adelante aunque la nube no se haya podido limpiar.
 */
async function respaldarYLimpiarSyncRemoto() {
    if (typeof estadoPremium === 'undefined' || !estadoPremium.activo || !estadoPremium.codigo) {
        return { ok: true, respaldado: false, sinCuenta: true };
    }

    try {
        const response = await fetchConReintentos(PREMIUM_CONFIG.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'respaldar_sync', codigo: estadoPremium.codigo }),
            timeout: 60000
        });

        const resultado = JSON.parse(await response.text());
        if (!resultado.success) {
            return { error: resultado.mensaje || 'El servidor rechazó la petición' };
        }

        // La copia remota ya no existe: se olvida la versión conocida para que
        // la siguiente subida no choque contra un conflicto que no lo es.
        syncState.remoteVersion = null;
        limpiarPendienteSync();

        return { ok: true, respaldado: !!resultado.respaldado };
    } catch (error) {
        return { error: error.message };
    }
}

async function subirDatosRemotos(datosCifrados, versionExpected) {
    const url = PREMIUM_CONFIG.apiUrl;

    const tamano = datosCifrados.length;
    if (tamano > AVISO_CELDA_SHEETS) {
        console.warn(`[SYNC] El bloque ocupa ${tamano.toLocaleString('es')} de ` +
                     `${LIMITE_CELDA_SHEETS.toLocaleString('es')} caracteres que admite la celda ` +
                     `(${Math.round(tamano / LIMITE_CELDA_SHEETS * 100)}%).`);
    }
    if (tamano > LIMITE_CELDA_SHEETS) {
        const error = new Error(
            `Tus datos ya no caben en una sincronización: ocupan ${tamano.toLocaleString('es')} ` +
            `caracteres y el máximo que admite la hoja de cálculo es ${LIMITE_CELDA_SHEETS.toLocaleString('es')} ` +
            `(${CELDAS_DATOS_SYNC} celdas de ${TAMANO_POR_CELDA.toLocaleString('es')}). ` +
            'No es un problema de conexión y reintentar no va a servir. ' +
            'Archiva expedientes que ya no sigas, o pide que se amplíe el almacenamiento.');
        error.tipoFallo = 'tamano';
        error.tamanoBloque = tamano;
        throw error;
    }

    try {
        // El primer trozo viaja como "datos" para que un servidor antiguo
        // —sin las columnas nuevas— siga entendiendo la petición.
        const partes = _partirParaCeldas(datosCifrados);
        const body = {
            action: 'guardar_sync',
            codigo: estadoPremium.codigo,
            datos: partes[0],
            datos_2: partes[1],
            datos_3: partes[2],
            datos_4: partes[3]
        };
        if (versionExpected !== undefined && versionExpected !== null) {
            body.version_expected = versionExpected;
        }

        const response = await fetchConReintentos(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8'
            },
            body: JSON.stringify(body),
            timeout: 120000 // 2 minutos para datos grandes
        });

        const texto = await response.text();

        let resultado;
        try {
            resultado = JSON.parse(texto);
        } catch (e) {
            console.error('Respuesta no es JSON:', texto);
            throw new Error('Respuesta inválida del servidor');
        }

        // Conflict no es un error fatal: el caller lo maneja re-fusionando.
        if (resultado.conflict) {
            return { success: false, conflict: true, version: resultado.version || null };
        }

        if (!resultado.success) {
            throw new Error(resultado.mensaje || 'Error al guardar en servidor');
        }
        return resultado;
    } catch (error) {
        console.error('Error subiendo datos:', error);
        throw error;
    }
}

// Fusionar datos locales y remotos
function fusionarDatos(local, remoto) {
    // Fusionar eliminados primero (unir ambas listas)
    const eliminadosFusionados = fusionarEliminados(
        local.eliminados || [],
        remoto.eliminados || []
    );

    // Crear set de claves eliminadas para filtrar
    const clavesEliminadas = new Set(eliminadosFusionados.map(e => e.clave));

    // Carpetas: fusión por nombre (dedup) + remap de carpetaId solo en expedientes
    // REMOTOS, antes de fusionarlos. Aplicar el remap post-fusión sería incorrecto
    // porque podría reescribir locales cuyo carpetaId coincide numéricamente con
    // un id remoto reasignado pero apunta a otra carpeta local.
    const { carpetas: carpetasFusionadas, mapaRemap: mapaRemapCarpetas } =
        fusionarCarpetas(local.carpetas || [], remoto.carpetas || [], clavesEliminadas);

    const remotosConCarpetaRemapeada = (remoto.expedientes || []).map(exp => {
        if (exp.carpetaId !== undefined && exp.carpetaId !== null && mapaRemapCarpetas.has(exp.carpetaId)) {
            return { ...exp, carpetaId: mapaRemapCarpetas.get(exp.carpetaId) };
        }
        return exp;
    });

    const expedientesFusionados = fusionarExpedientes(
        local.expedientes || [],
        remotosConCarpetaRemapeada,
        clavesEliminadas
    );

    const resultado = {
        expedientes: expedientesFusionados,
        notas: fusionarNotas(local.notas || [], remoto.notas || [], clavesEliminadas),
        eventos: fusionarEventos(local.eventos || [], remoto.eventos || [], clavesEliminadas),
        pendientes: fusionarPendientes(local.pendientes || [], remoto.pendientes || [], clavesEliminadas),
        carpetas: carpetasFusionadas,
        // historial y sigaGuardadas son append-only / por-ID: no requieren merge
        // sofisticado, basta con la unión sin duplicados.
        historial: fusionarHistorial(local.historial || [], remoto.historial || []),
        sigaGuardadas: fusionarBusquedasGuardadas(local.sigaGuardadas || [], remoto.sigaGuardadas || []),
        eliminados: eliminadosFusionados,
        metadata: local.metadata
    };
    return resultado;
}

// Normalizar nombre de carpeta para dedup (case-insensitive, sin acentos,
// solo alfanumérico).
function _claveCarpeta(carpeta) {
    if (!carpeta || !carpeta.nombre) return '';
    return String(carpeta.nombre).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ');
}

// Fusiona carpetas locales y remotas. Dedup por nombre normalizado. Devuelve:
//   { carpetas: [...], mapaRemap: Map(idOriginal → idCanonico) }
// El mapaRemap se aplica luego sobre exp.carpetaId para que dos dispositivos
// que crearon la misma carpeta independientemente queden apuntando a una sola.
// Devuelve { carpetas, mapaRemap } donde mapaRemap es Map<idRemotoOriginal, idCanónico>.
// IMPORTANTE: el mapaRemap aplica solo a los carpetaId de expedientes REMOTOS, nunca
// a los locales. Los expedientes locales ya apuntan a ids locales canónicos.
function fusionarCarpetas(locales, remotas, clavesEliminadas = new Set()) {
    // Las eliminaciones de carpetas se registran por nombre normalizado
    // (ver registrarEliminacion en database.js, caso 'carpeta'), igual que
    // el dedup. Así, eliminar una carpeta en un dispositivo la elimina en
    // todos los demás aunque tengan distinto id local.
    const keyEliminacion = c => 'carpeta|' + _claveCarpeta(c);
    const localesFiltradas = locales.filter(c => !clavesEliminadas.has(keyEliminacion(c)));
    const remotasFiltradas = remotas.filter(c => !clavesEliminadas.has(keyEliminacion(c)));

    const mapaPorClave = new Map(); // claveNombre → carpeta canónica
    const mapaRemap = new Map();    // idRemotoOriginal → idCanónico
    const idsTomados = new Set();   // ids ya en uso en el resultado
    let maxId = 0;

    // 1) Locales primero: sus ids son canónicos para este dispositivo.
    //    Los expedientes locales YA referencian estos ids; nunca los cambiamos.
    for (const c of localesFiltradas) {
        const clave = _claveCarpeta(c);
        if (!clave) continue;
        mapaPorClave.set(clave, { ...c });
        if (typeof c.id === 'number' && Number.isFinite(c.id)) {
            idsTomados.add(c.id);
            maxId = Math.max(maxId, c.id);
        }
    }

    // 2) Remotas: si coincide nombre, fusionar campo a campo (mantener id local
    //    y mapear idRemoto → idLocal). Si es nombre nuevo, agregar; si su id
    //    colisiona con un id local de otra carpeta, reasignar a maxId+1.
    for (const c of remotasFiltradas) {
        const clave = _claveCarpeta(c);
        if (!clave) continue;
        const existente = mapaPorClave.get(clave);
        if (existente) {
            const fusionada = _fusionarCarpetaCampoACampo(existente, c);
            // El id canónico es el del existente (local); el del remoto se mapea.
            fusionada.id = existente.id;
            mapaPorClave.set(clave, fusionada);
            if (c.id !== undefined && c.id !== null && c.id !== existente.id) {
                mapaRemap.set(c.id, existente.id);
            }
        } else {
            const copia = { ...c };
            // ¿Colisión de id con una carpeta local de nombre distinto?
            if (copia.id !== undefined && copia.id !== null && idsTomados.has(copia.id)) {
                const idRemotoOriginal = copia.id;
                maxId++;
                copia.id = maxId;
                mapaRemap.set(idRemotoOriginal, maxId);
            }
            if (typeof copia.id === 'number' && Number.isFinite(copia.id)) {
                idsTomados.add(copia.id);
                maxId = Math.max(maxId, copia.id);
            }
            mapaPorClave.set(clave, copia);
        }
    }

    return { carpetas: Array.from(mapaPorClave.values()), mapaRemap };
}

function _fusionarCarpetaCampoACampo(c1, c2) {
    const fusionada = { ...c1 };
    const ftsFusionados = { ...(c1._fieldTimestamps || {}) };

    const campos = ['nombre', 'comentario', 'color', 'orden',
                    'archivada', 'motivoArchivo', 'etiquetaArchivo', 'fechaArchivo'];

    for (const campo of campos) {
        const v1 = c1[campo];
        const v2 = c2[campo];
        const t1 = (c1._fieldTimestamps && c1._fieldTimestamps[campo]) || c1.fechaCreacion || c1.fechaActualizacion || '';
        const t2 = (c2._fieldTimestamps && c2._fieldTimestamps[campo]) || c2.fechaCreacion || c2.fechaActualizacion || '';

        if (t2 > t1) {
            if (v2 === undefined || v2 === null || v2 === '') {
                delete fusionada[campo];
            } else {
                fusionada[campo] = v2;
            }
            ftsFusionados[campo] = t2;
        } else if (t1 > t2) {
            ftsFusionados[campo] = t1;
        } else if ((v1 === undefined || v1 === null || v1 === '') && v2 !== undefined && v2 !== null && v2 !== '') {
            fusionada[campo] = v2;
            ftsFusionados[campo] = t2 || t1;
        }
    }

    // Fecha de creación: la más antigua. Fecha actualización: la más reciente.
    if (c1.fechaCreacion && c2.fechaCreacion) {
        fusionada.fechaCreacion = c1.fechaCreacion < c2.fechaCreacion ? c1.fechaCreacion : c2.fechaCreacion;
    }
    if (c1.fechaActualizacion && c2.fechaActualizacion) {
        fusionada.fechaActualizacion = c1.fechaActualizacion > c2.fechaActualizacion ? c1.fechaActualizacion : c2.fechaActualizacion;
    }

    fusionada._fieldTimestamps = ftsFusionados;
    return fusionada;
}

// Une listas de historial deduplicando por id+fecha+expedienteId (los IDs
// autoincrementales pueden chocar entre dispositivos, pero la combinación
// con fecha+expedienteId es prácticamente única).
// Tras la unión se limita a los MAX_HISTORIAL_SYNC más recientes para que
// el blob no supere el límite de la celda de Google Sheets.
const MAX_HISTORIAL_SYNC = 200;
function fusionarHistorial(locales, remotos) {
    const mapa = new Map();
    const todos = [...remotos, ...locales];
    for (const h of todos) {
        const clave = `${h.expedienteId || '0'}|${h.fecha || ''}|${h.tipo || ''}|${(h.descripcion || '').substring(0, 80)}`;
        if (!mapa.has(clave)) mapa.set(clave, h);
    }
    return Array.from(mapa.values())
        .sort((a, b) => (b.fecha || '') > (a.fecha || '') ? 1 : -1)
        .slice(0, MAX_HISTORIAL_SYNC);
}

// Identidad de una búsqueda guardada. El store sigaGuardadas ya no es solo de
// SIGA: guarda también MARCia y Marcanet, así que el término por sí solo no
// identifica nada. "nike" en MARCia, "nike" en Marcanet y "nike" en SIGA son
// tres búsquedas distintas, igual que el mismo término en Marcas y en Patentes.
// Debe coincidir con la detección de duplicados de impi-search.js
// (guardarBusqueda y guardarBusquedaSIGA).
function _claveBusquedaGuardada(s) {
    const herramienta = s.tool || 'siga';
    const subtipo = s.subtype || '';
    const area = herramienta === 'siga' ? (s.area || '') : '';
    const termino = (s.query || '').toLowerCase().trim();
    // Sin término no hay identidad estable: se cae al objeto completo para no
    // colapsar registros que no tienen nada que ver entre sí.
    if (!termino) return `${herramienta}|${subtipo}|${area}|${JSON.stringify(s)}`;
    return `${herramienta}|${subtipo}|${area}|${termino}`;
}

// Identidad de un pendiente: expediente + título + día de creación. Debe
// coincidir con registrarEliminacion('pendiente', ...) en database.js para que
// las tombstones encuentren el registro correcto.
function _clavePendiente(p) {
    const titulo = (p.titulo || '').trim().toLowerCase();
    const expedienteId = p.expedienteId || 'sin-exp';
    const fecha = (p.fechaCreacion || '').substring(0, 10);
    return `pendiente|${expedienteId}|${titulo}|${fecha}`;
}

// Une pendientes locales y remotos. Gana el más reciente por campo, igual que
// notas y eventos, para que marcar terminado en un dispositivo y editar el
// texto en otro no se pisen.
function fusionarPendientes(locales, remotos, clavesEliminadas = new Set()) {
    const mapa = new Map();

    // Locales primero como base, igual que en notas: una edición local
    // reciente gana sobre una versión remota más vieja del mismo campo.
    for (const p of [...locales, ...remotos]) {
        const clave = _clavePendiente(p);
        if (clavesEliminadas.has(clave)) continue;

        const existente = mapa.get(clave);
        if (!existente) {
            mapa.set(clave, p);
            continue;
        }
        // eventoId apunta a ids locales de cada dispositivo, así que no debe
        // viajar en la fusión: se conserva el del registro base.
        const fusionado = fusionarRegistroPorCampo(existente, p,
            new Set(['id', '_fieldTimestamps', 'eventoId']));
        mapa.set(clave, fusionado);
    }

    return Array.from(mapa.values());
}

// Une búsquedas guardadas (SIGA, MARCia y Marcanet) deduplicando por
// herramienta + modo + área + término, no por id.
function fusionarBusquedasGuardadas(locales, remotos) {
    const mapa = new Map();
    const todos = [...remotos, ...locales];
    for (const s of todos) {
        const clave = _claveBusquedaGuardada(s);
        const existente = mapa.get(clave);
        if (!existente) {
            mapa.set(clave, s);
        } else {
            // Mantener el de timestamp más reciente
            const fNueva = new Date(s.fechaActualizacion || s.fechaCreacion || 0);
            const fVieja = new Date(existente.fechaActualizacion || existente.fechaCreacion || 0);
            if (fNueva > fVieja) mapa.set(clave, s);
        }
    }
    return Array.from(mapa.values());
}

// Fusionar listas de eliminados
function fusionarEliminados(locales, remotos) {
    const mapa = new Map();

    // Agregar remotos primero
    for (const e of remotos) {
        mapa.set(e.clave, e);
    }

    // Agregar/actualizar con locales (los más recientes ganan)
    for (const e of locales) {
        const existente = mapa.get(e.clave);
        if (!existente || new Date(e.fecha) > new Date(existente.fecha)) {
            mapa.set(e.clave, e);
        }
    }

    return Array.from(mapa.values());
}

// Generar clave única para expediente (basada en contenido, no ID)
function claveExpediente(exp) {
    const numero = (exp.numero || '').trim().toLowerCase();
    const nombre = (exp.nombre || '').trim().toLowerCase();
    const juzgado = (exp.juzgado || '').trim().toLowerCase();
    return `${numero}|${nombre}|${juzgado}`;
}

// ==================== DETECCIÓN Y FUSIÓN INTELIGENTE DE DUPLICADOS ====================

// Normalizar texto para comparación
function normalizarTexto(texto) {
    if (!texto) return '';
    return texto.toString().trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quitar acentos
        .replace(/[^a-z0-9]/g, ''); // Solo alfanuméricos
}

// Normalizar número de expediente (extraer solo dígitos y año)
function normalizarNumeroExpediente(numero) {
    if (!numero) return '';
    // Extraer patrón común: números/año o números-año
    const match = numero.match(/(\d+)[\/\-]?(\d{2,4})?/);
    if (match) {
        const num = match[1];
        const year = match[2] || '';
        return `${num}${year}`;
    }
    return numero.replace(/[^0-9]/g, '');
}

// Calcular similitud entre dos strings (algoritmo de Dice coefficient)
function calcularSimilitud(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = normalizarTexto(str1);
    const s2 = normalizarTexto(str2);

    if (s1 === s2) return 1;
    if (s1.length < 2 || s2.length < 2) return 0;

    const bigrams1 = new Set();
    for (let i = 0; i < s1.length - 1; i++) {
        bigrams1.add(s1.substring(i, i + 2));
    }

    let matches = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        if (bigrams1.has(s2.substring(i, i + 2))) {
            matches++;
        }
    }

    return (2 * matches) / (s1.length - 1 + s2.length - 1);
}

// Detectar si dos expedientes son potencialmente duplicados
function sonExpedientesDuplicados(exp1, exp2) {
    // Misma clave exacta = definitivamente duplicados
    if (claveExpediente(exp1) === claveExpediente(exp2)) {
        return { esDuplicado: true, confianza: 1, razon: 'clave_exacta' };
    }

    const num1 = normalizarNumeroExpediente(exp1.numero);
    const num2 = normalizarNumeroExpediente(exp2.numero);
    const nombre1 = normalizarTexto(exp1.nombre);
    const nombre2 = normalizarTexto(exp2.nombre);
    const juzgado1 = normalizarTexto(exp1.juzgado);
    const juzgado2 = normalizarTexto(exp2.juzgado);

    // Mismo número de expediente y mismo juzgado = duplicados
    if (num1 && num2 && num1 === num2 && juzgado1 === juzgado2) {
        return { esDuplicado: true, confianza: 0.95, razon: 'numero_juzgado' };
    }

    // Mismo nombre exacto y mismo juzgado = duplicados
    if (nombre1 && nombre2 && nombre1 === nombre2 && juzgado1 === juzgado2) {
        return { esDuplicado: true, confianza: 0.9, razon: 'nombre_juzgado' };
    }

    // Nombre muy similar (>85%) y mismo juzgado
    if (nombre1 && nombre2 && juzgado1 === juzgado2) {
        const similitud = calcularSimilitud(nombre1, nombre2);
        if (similitud > 0.85) {
            return { esDuplicado: true, confianza: similitud * 0.9, razon: 'nombre_similar' };
        }
    }

    // Mismo número y nombre similar
    if (num1 && num2 && num1 === num2) {
        const similitudNombre = calcularSimilitud(nombre1, nombre2);
        if (similitudNombre > 0.7) {
            return { esDuplicado: true, confianza: 0.85, razon: 'numero_nombre_similar' };
        }
    }

    return { esDuplicado: false, confianza: 0, razon: null };
}

// Obtener el timestamp de un campo concreto: usa _fieldTimestamps si existe,
// y cae a fechaActualizacion/fechaCreacion para datos antiguos sin tracking
// por campo. Permite que datos antiguos sigan funcionando con merge por
// expediente, mientras los nuevos ganan por campo.
function obtenerTimestampCampo(exp, campo) {
    if (exp._fieldTimestamps && exp._fieldTimestamps[campo]) {
        return exp._fieldTimestamps[campo];
    }
    // Sin timestamp explícito → el campo no se ha modificado desde la creación.
    // Usamos fechaCreacion (NO fechaActualizacion) a propósito: fechaActualizacion
    // refleja el último cambio a CUALQUIER campo del expediente, así que un campo
    // que nunca se tocó heredaría una recencia falsa y podría pisar por error la
    // edición explícita del mismo campo hecha en otro dispositivo (p.ej. perder un
    // comentario o un "archivado" porque el otro device editó otra cosa después).
    return exp.fechaCreacion || exp.fechaActualizacion || '';
}

// Fusionar dos expedientes conservando la información más completa.
// Ahora el merge gana por CAMPO, no por expediente: si editas el comentario en
// iPhone y luego el juzgado en PC, cada campo conserva su edición más reciente
// según su timestamp individual. Además permite vaciar campos a propósito
// (el "borrado" con timestamp más nuevo gana sobre el valor antiguo).
function fusionarExpedientesInteligente(exp1, exp2) {
    const fusionado = { ...exp1 };
    const cambios = [];
    const fieldTimestampsFusionados = { ...(exp1._fieldTimestamps || {}) };

    // Campos sujetos a merge por timestamp individual
    const camposPorCampo = ['numero', 'nombre', 'juzgado', 'tipo', 'actor', 'demandado',
                    'materia', 'estado', 'abogado', 'observaciones',
                    'comentario', 'categoria', 'color',
                    'institucion', 'pjfOrgId', 'pjfTipoAsunto', 'pjfTipoProcedimiento',
                    'archivado', 'motivoArchivo', 'etiquetaArchivo', 'fechaArchivo',
                    'carpetaId', '_archivadoPorCarpeta'];

    camposPorCampo.forEach(campo => {
        const val1 = exp1[campo];
        const val2 = exp2[campo];
        const ts1 = obtenerTimestampCampo(exp1, campo);
        const ts2 = obtenerTimestampCampo(exp2, campo);

        // Si exp2 tiene timestamp más nuevo para este campo, usar su valor
        // (incluso si está vacío — eso permite "vaciado intencional").
        if (ts2 > ts1) {
            if (val2 === undefined || val2 === null || val2 === '') {
                delete fusionado[campo];
            } else {
                fusionado[campo] = val2;
            }
            fieldTimestampsFusionados[campo] = ts2;
            if (val1 !== val2) {
                cambios.push({ campo, de: val1, a: val2, origen: 'exp2_ts_mas_reciente' });
            }
        } else if (ts1 > ts2) {
            // exp1 ya está en fusionado por el spread inicial; solo registramos timestamp
            fieldTimestampsFusionados[campo] = ts1;
        } else {
            // Empate de timestamps: si uno tiene valor y el otro no, preferir el que tiene
            if ((val1 === undefined || val1 === null || val1 === '') && val2 !== undefined && val2 !== null && val2 !== '') {
                fusionado[campo] = val2;
                cambios.push({ campo, de: val1, a: val2, origen: 'exp2_lleno' });
            }
            fieldTimestampsFusionados[campo] = ts1 || ts2;
        }

        // Limpiar timestamp si el campo terminó vacío y no había timestamp previo
        if (!fieldTimestampsFusionados[campo]) {
            delete fieldTimestampsFusionados[campo];
        }
    });

    // etiquetas: caso especial — siempre unión (los arrays no se "pisan",
    // se suman, manteniendo etiquetas agregadas desde cualquier dispositivo)
    const etiq1 = Array.isArray(exp1.etiquetas) ? exp1.etiquetas : [];
    const etiq2 = Array.isArray(exp2.etiquetas) ? exp2.etiquetas : [];
    if (etiq1.length > 0 || etiq2.length > 0) {
        fusionado.etiquetas = [...new Set([...etiq1, ...etiq2])];
        const tsE1 = obtenerTimestampCampo(exp1, 'etiquetas');
        const tsE2 = obtenerTimestampCampo(exp2, 'etiquetas');
        fieldTimestampsFusionados.etiquetas = tsE1 > tsE2 ? tsE1 : tsE2;
    }

    fusionado._fieldTimestamps = fieldTimestampsFusionados;

    // Combinar historial si existe
    if (exp1.historial || exp2.historial) {
        const historial1 = exp1.historial || [];
        const historial2 = exp2.historial || [];
        fusionado.historial = [...historial1, ...historial2]
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    }

    // Usar la fecha de creación más antigua
    if (exp1.fechaCreacion && exp2.fechaCreacion) {
        fusionado.fechaCreacion = exp1.fechaCreacion < exp2.fechaCreacion
            ? exp1.fechaCreacion : exp2.fechaCreacion;
    }

    // Usar la fecha de actualización más reciente
    if (exp1.fechaActualizacion && exp2.fechaActualizacion) {
        fusionado.fechaActualizacion = exp1.fechaActualizacion > exp2.fechaActualizacion
            ? exp1.fechaActualizacion : exp2.fechaActualizacion;
    } else {
        fusionado.fechaActualizacion = new Date().toISOString();
    }

    // Conservar IDs originales para reasignar notas/eventos
    fusionado._idsOriginales = [exp1.id, exp2.id].filter(Boolean);
    fusionado._cambiosFusion = cambios;

    return fusionado;
}

// Reporte de fusión de duplicados
let reporteFusionDuplicados = {
    expedientesFusionados: [],
    notasReasignadas: 0,
    eventosReasignados: 0
};

function limpiarReporteFusion() {
    reporteFusionDuplicados = {
        expedientesFusionados: [],
        notasReasignadas: 0,
        eventosReasignados: 0
    };
}

// Generar clave única para nota
function claveNota(nota) {
    const contenido = (nota.contenido || '').substring(0, 100).trim().toLowerCase();
    const expedienteId = nota.expedienteId || 'sin-exp';
    const fecha = nota.fechaCreacion || '';
    return `${expedienteId}|${contenido}|${fecha.substring(0, 10)}`;
}

// Generar clave única para evento.
// IMPORTANTE: incluimos la fechaInicio completa (no solo el día). De lo contrario
// dos audiencias del mismo expediente el mismo día (p.ej. 10:00 y 14:00) colisionan
// y la sincronización las funde en una sola.
function claveEvento(evento) {
    const titulo = (evento.titulo || '').trim().toLowerCase();
    const fechaInicio = (evento.fechaInicio || evento.fecha || '');
    const expedienteId = evento.expedienteId || 'sin-exp';
    return `${titulo}|${fechaInicio}|${expedienteId}`;
}

// Generar clave de eliminación de evento (debe coincidir con la de
// registrarEliminacion('evento', ...) en database.js).
function claveEliminacionEvento(ev) {
    const titulo = (ev.titulo || '').trim().toLowerCase();
    const fechaInicio = (ev.fechaInicio || ev.fecha || '');
    const expedienteId = ev.expedienteId || 'sin-exp';
    return `evento|${titulo}|${fechaInicio}|${expedienteId}`;
}

// Generar clave de eliminación de nota.
function claveEliminacionNota(n) {
    const contenido = (n.contenido || '').substring(0, 100).trim().toLowerCase();
    const expedienteId = n.expedienteId || 'sin-exp';
    const fecha = (n.fechaCreacion || '').substring(0, 10);
    return `nota|${expedienteId}|${contenido}|${fecha}`;
}

// Generar clave de eliminación para un expediente
function claveEliminacionExpediente(exp) {
    const numero = (exp.numero || '').trim().toLowerCase();
    const nombre = (exp.nombre || '').trim().toLowerCase();
    const juzgado = (exp.juzgado || '').trim().toLowerCase();
    return `exp|${numero}|${nombre}|${juzgado}`;
}

// Fusionar expedientes con detección inteligente de duplicados
function fusionarExpedientes(locales, remotos, clavesEliminadas = new Set()) {
    limpiarReporteFusion();

    // Filtrar expedientes que han sido eliminados
    const localesFiltrados = locales.filter(exp => !clavesEliminadas.has(claveEliminacionExpediente(exp)));
    const remotosFiltrados = remotos.filter(exp => !clavesEliminadas.has(claveEliminacionExpediente(exp)));

    // Locales primero: el expediente local es la base (exp1) en la fusión,
    // garantizando que los cambios locales recientes no se pierdan ante una versión remota más vieja.
    const todosExpedientes = [...localesFiltrados, ...remotosFiltrados];
    const expedientesProcesados = [];
    const indicesUsados = new Set();

    // Comparar cada expediente con los demás para detectar duplicados
    for (let i = 0; i < todosExpedientes.length; i++) {
        if (indicesUsados.has(i)) continue;

        let expedienteBase = { ...todosExpedientes[i] };
        const duplicadosEncontrados = [];

        for (let j = i + 1; j < todosExpedientes.length; j++) {
            if (indicesUsados.has(j)) continue;

            const resultado = sonExpedientesDuplicados(expedienteBase, todosExpedientes[j]);

            if (resultado.esDuplicado) {
                duplicadosEncontrados.push({
                    indice: j,
                    expediente: todosExpedientes[j],
                    confianza: resultado.confianza,
                    razon: resultado.razon
                });
                indicesUsados.add(j);
            }
        }

        // Si hay duplicados, fusionarlos
        if (duplicadosEncontrados.length > 0) {
            const nombresOriginales = [expedienteBase.nombre || expedienteBase.numero];

            duplicadosEncontrados.forEach(dup => {
                nombresOriginales.push(dup.expediente.nombre || dup.expediente.numero);
                expedienteBase = fusionarExpedientesInteligente(expedienteBase, dup.expediente);
            });

            reporteFusionDuplicados.expedientesFusionados.push({
                expedienteFinal: expedienteBase.numero || expedienteBase.nombre,
                cantidadFusionados: duplicadosEncontrados.length + 1,
                originales: nombresOriginales,
                idsOriginales: expedienteBase._idsOriginales || [],
                cambios: expedienteBase._cambiosFusion || []
            });

            // Limpiar campos temporales
            delete expedienteBase._cambiosFusion;
        }

        indicesUsados.add(i);
        expedientesProcesados.push(expedienteBase);
    }

    return expedientesProcesados;
}

// Crear mapa de IDs originales a ID final (para reasignar notas/eventos)
function crearMapaReasignacion() {
    const mapa = new Map();
    reporteFusionDuplicados.expedientesFusionados.forEach(fusion => {
        if (fusion.idsOriginales && fusion.idsOriginales.length > 1) {
            const idFinal = fusion.idsOriginales[0]; // El primer ID será el principal
            fusion.idsOriginales.forEach(idOriginal => {
                if (idOriginal !== idFinal) {
                    mapa.set(idOriginal, idFinal);
                }
            });
        }
    });
    return mapa;
}

// Merge genérico por campo: aplica la misma lógica que fusionarExpedientesInteligente
// pero sin la parte específica de etiquetas/historial de expediente. Si dos
// dispositivos editan campos distintos de la misma nota o evento, ninguno pisa
// al otro: cada campo conserva el valor con el timestamp más reciente.
function fusionarRegistroPorCampo(a, b, omitirKeys = new Set(['id', '_fieldTimestamps', '_reasignada', '_reasignado'])) {
    const fusionado = { ...a };
    const fieldTimestamps = { ...(a._fieldTimestamps || {}) };

    const todasLasKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    todasLasKeys.forEach(campo => {
        if (omitirKeys.has(campo)) return;
        const valA = a[campo];
        const valB = b[campo];
        const tsA = obtenerTimestampCampo(a, campo);
        const tsB = obtenerTimestampCampo(b, campo);

        if (tsB > tsA) {
            if (valB === undefined || valB === null || valB === '') {
                delete fusionado[campo];
            } else {
                fusionado[campo] = valB;
            }
            fieldTimestamps[campo] = tsB;
        } else if (tsA > tsB) {
            // a ya está por el spread inicial
            fieldTimestamps[campo] = tsA;
        } else {
            // Empate: si uno tiene valor y el otro no, preferir el lleno
            if ((valA === undefined || valA === null || valA === '') && valB !== undefined && valB !== null && valB !== '') {
                fusionado[campo] = valB;
            }
            fieldTimestamps[campo] = tsA || tsB;
        }

        if (!fieldTimestamps[campo]) delete fieldTimestamps[campo];
    });

    // fechaActualizacion = la más reciente de ambas
    const fechaA = a.fechaActualizacion || a.fechaCreacion;
    const fechaB = b.fechaActualizacion || b.fechaCreacion;
    if (fechaA && fechaB) {
        fusionado.fechaActualizacion = fechaA > fechaB ? fechaA : fechaB;
    } else if (fechaA || fechaB) {
        fusionado.fechaActualizacion = fechaA || fechaB;
    }

    // fechaCreacion = la más antigua de ambas
    if (a.fechaCreacion && b.fechaCreacion) {
        fusionado.fechaCreacion = a.fechaCreacion < b.fechaCreacion ? a.fechaCreacion : b.fechaCreacion;
    }

    fusionado._fieldTimestamps = fieldTimestamps;
    return fusionado;
}

// Fusionar notas sin duplicar, con merge por campo, reasignación de
// expedientes fusionados y filtrado de notas eliminadas remotamente.
function fusionarNotas(locales, remotas, clavesEliminadas = new Set()) {
    const mapa = new Map();
    const mapaReasignacion = crearMapaReasignacion();

    // Locales primero como base, para que ediciones locales recientes ganen
    // sobre versiones remotas más viejas en el mismo campo.
    const todasNotas = [...locales, ...remotas];

    todasNotas.forEach(nota => {
        // Filtrar si está en la lista de eliminados
        if (clavesEliminadas.has(claveEliminacionNota(nota))) return;

        // Reasignar expedienteId si el expediente fue fusionado
        let notaProcesada = { ...nota };
        if (nota.expedienteId && mapaReasignacion.has(nota.expedienteId)) {
            notaProcesada.expedienteId = mapaReasignacion.get(nota.expedienteId);
            notaProcesada._reasignada = true;
            reporteFusionDuplicados.notasReasignadas++;
        }

        const clave = claveNota(notaProcesada);
        if (!clave) return;

        const existente = mapa.get(clave);
        if (!existente) {
            mapa.set(clave, notaProcesada);
        } else {
            // Merge por campo: ninguna edición se pierde si afectó campos distintos
            mapa.set(clave, fusionarRegistroPorCampo(existente, notaProcesada));
        }
    });

    return Array.from(mapa.values()).map(nota => {
        delete nota._reasignada;
        return nota;
    });
}

// Fusionar eventos sin duplicar, con merge por campo, reasignación de
// expedientes fusionados y filtrado de eventos eliminados remotamente.
function fusionarEventos(locales, remotos, clavesEliminadas = new Set()) {
    const mapa = new Map();
    const mapaReasignacion = crearMapaReasignacion();

    const todosEventos = [...locales, ...remotos];

    todosEventos.forEach(evento => {
        if (clavesEliminadas.has(claveEliminacionEvento(evento))) return;

        let eventoProcesado = { ...evento };
        if (evento.expedienteId && mapaReasignacion.has(evento.expedienteId)) {
            eventoProcesado.expedienteId = mapaReasignacion.get(evento.expedienteId);
            eventoProcesado._reasignado = true;
            reporteFusionDuplicados.eventosReasignados++;
        }

        const clave = claveEvento(eventoProcesado);
        if (!clave) return;

        const existente = mapa.get(clave);
        if (!existente) {
            mapa.set(clave, eventoProcesado);
        } else {
            mapa.set(clave, fusionarRegistroPorCampo(existente, eventoProcesado));
        }
    });

    return Array.from(mapa.values()).map(evento => {
        delete evento._reasignado;
        return evento;
    });
}

// Obtener todos los datos locales
async function obtenerTodosLosDatos() {
    // Incluir tanto activos como archivados para no perder datos en sync
    const expedientes = await obtenerExpedientes();
    const archivados = typeof obtenerExpedientesArchivados === 'function' ? await obtenerExpedientesArchivados() : [];
    const notas = await obtenerNotas();
    const eventos = await obtenerEventos();
    const eliminados = await obtenerEliminados();

    // historial y sigaGuardadas son opcionales (DB antigua puede no tenerlos)
    const historialCompleto = typeof obtenerTodoHistorial === 'function'
        ? await obtenerTodoHistorial().catch(() => []) : [];

    // Sólo sincronizar los 200 registros más recientes y sin los diffs completos
    // (cambiosAnteriores / cambiosNuevos pueden ser objetos expediente completos
    // de varios KB cada uno; incluirlos explota el blob más allá del límite de 50k
    // chars de la celda de Google Sheets y provoca un error 200-sin-CORS al POST).
    const historial = historialCompleto
        .sort((a, b) => (b.fecha || '') > (a.fecha || '') ? 1 : -1)
        .slice(0, MAX_HISTORIAL_SYNC)
        .map(({ id, expedienteId, tipo, descripcion, fecha }) =>
            ({ id, expedienteId, tipo, descripcion, fecha }));

    const sigaGuardadas = typeof obtenerBusquedasSIGA === 'function'
        ? await obtenerBusquedasSIGA().catch(() => []) : [];

    // Carpetas: opcional (DB v4 o anterior puede no tener el store)
    const carpetas = typeof obtenerCarpetas === 'function'
        ? await obtenerCarpetas().catch(() => []) : [];

    // Pendientes: opcional (DB v5 o anterior no tiene el store)
    const pendientes = typeof obtenerPendientes === 'function'
        ? await obtenerPendientes().catch(() => []) : [];

    return {
        expedientes: [...expedientes, ...archivados],
        notas,
        eventos,
        pendientes,
        eliminados,
        historial,
        sigaGuardadas,
        carpetas
    };
}

// Escape HTML para evitar XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Aplicar datos a IndexedDB
async function aplicarDatosLocalmente(datos) {
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('TSJFilingDB');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    // Incluir 'carpetas' en la tx solo si el store existe (compat con DB v4)
    const stores = ['expedientes', 'notas', 'eventos', 'eliminados'];
    if (db.objectStoreNames.contains('carpetas')) stores.push('carpetas');
    const tx = db.transaction(stores, 'readwrite');

    // Limpiar y repoblar
    const storeExp = tx.objectStore('expedientes');
    const storeNotas = tx.objectStore('notas');
    const storeEventos = tx.objectStore('eventos');
    const storeEliminados = tx.objectStore('eliminados');
    const storeCarpetas = stores.includes('carpetas') ? tx.objectStore('carpetas') : null;

    const clears = [
        new Promise(r => { storeExp.clear().onsuccess = r; }),
        new Promise(r => { storeNotas.clear().onsuccess = r; }),
        new Promise(r => { storeEventos.clear().onsuccess = r; }),
        new Promise(r => { storeEliminados.clear().onsuccess = r; })
    ];
    if (storeCarpetas) {
        clears.push(new Promise(r => { storeCarpetas.clear().onsuccess = r; }));
    }
    await Promise.all(clears);

    for (const exp of datos.expedientes || []) {
        storeExp.put(exp);
    }
    for (const nota of datos.notas || []) {
        storeNotas.put(nota);
    }
    for (const evento of datos.eventos || []) {
        storeEventos.put(evento);
    }
    for (const eliminado of datos.eliminados || []) {
        storeEliminados.put(eliminado);
    }
    if (storeCarpetas) {
        for (const carpeta of datos.carpetas || []) {
            storeCarpetas.put(carpeta);
        }
    }

    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    // Aplicar historial y sigaGuardadas en transacciones separadas
    // (sus stores pueden no existir en DBs antiguas; las helpers son tolerantes)
    if (typeof reemplazarHistorial === 'function' && datos.historial) {
        try { await reemplazarHistorial(datos.historial); } catch (e) { console.warn('No se pudo aplicar historial sincronizado:', e); }
    }
    if (typeof reemplazarBusquedasSIGA === 'function' && datos.sigaGuardadas) {
        try { await reemplazarBusquedasSIGA(datos.sigaGuardadas); } catch (e) { console.warn('No se pudieron aplicar búsquedas SIGA sincronizadas:', e); }
    }
    if (typeof reemplazarPendientes === 'function' && datos.pendientes) {
        try { await reemplazarPendientes(datos.pendientes); } catch (e) { console.warn('No se pudieron aplicar pendientes sincronizados:', e); }
    }

    // El blob remoto trae nuevas notas e historial: invalidar el caché de
    // búsqueda para que la próxima consulta lo reconstruya.
    if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();

    // Recargar UI
    if (typeof cargarCarpetasUI === 'function') await cargarCarpetasUI();
    await cargarExpedientes();
    await cargarNotas();
    await cargarEventos();
    await cargarEstadisticas();
    renderizarCalendario();
    if (typeof cargarExpedientesPJF === 'function') await cargarExpedientesPJF();

    // Actualizar badges de archivo
    if (typeof actualizarBadgeArchivo === 'function') actualizarBadgeArchivo();
    if (typeof actualizarBadgeArchivoPJF === 'function') actualizarBadgeArchivoPJF();

    // Si alguna sección de archivo está visible, recargarla
    const archivoTSJ = document.getElementById('archivo-section');
    if (archivoTSJ && archivoTSJ.style.display === 'block' && typeof cargarArchivo === 'function') {
        await cargarArchivo();
    }
    const archivoPJF = document.getElementById('archivo-section-pjf');
    if (archivoPJF && archivoPJF.style.display === 'block' && typeof cargarArchivoPJF === 'function') {
        await cargarArchivoPJF();
    }

    // Refrescar listas dependientes de los nuevos stores sincronizados
    if (typeof cargarBusquedasGuardadas === 'function') {
        try { await cargarBusquedasGuardadas(); } catch (e) {}
    }
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

    // Reflejar inmediatamente el badge de pendiente (si quedó un sync abortado)
    actualizarBadgePendiente();

    // Si había cambios pendientes de un sync que se cortó (clásico de iOS:
    // background, tab matada, fetch abortada), reintentar ahora que la app
    // está cargando en primer plano.
    if (hayPendienteSync()) {
        setTimeout(() => {
            if (syncState.syncInProgress) return;
            if (typeof estadoPremium === 'undefined' || !estadoPremium.activo || !estadoPremium.codigo) return;
            sincronizarDatos().catch(e => console.warn('Reintento de sync pendiente falló:', e && e.message ? e.message : e));
        }, 1500);
    }
}

// Cuando el usuario vuelve a la pestaña/app después de tenerla en segundo
// plano, si hay un sync pendiente lo reintentamos. Esto cubre iOS Safari que
// aborta fetch en background pero conserva el estado de la app.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!hayPendienteSync()) return;
    if (syncState.syncInProgress) return;
    if (typeof estadoPremium === 'undefined' || !estadoPremium.activo || !estadoPremium.codigo) return;
    sincronizarDatos().catch(e => console.warn('Sync al volver a foreground falló:', e && e.message ? e.message : e));
});

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

// ==================== CONFIGURACIÓN DE AUTO-SYNC ====================

// Guardar configuración de sincronización
async function guardarConfigSync() {
    const syncOnLoad = document.getElementById('sync-on-load')?.checked || false;
    const syncOnSave = document.getElementById('sync-on-save')?.checked || false;

    localStorage.setItem('sync_on_load', syncOnLoad ? 'true' : 'false');
    localStorage.setItem('sync_on_save', syncOnSave ? 'true' : 'false');

    mostrarToast('Configuración de sincronización guardada', 'success');
}

// Cargar configuración de sincronización
function cargarConfigSync() {
    const syncOnLoad = localStorage.getItem('sync_on_load') === 'true';
    const syncOnSave = localStorage.getItem('sync_on_save') === 'true';

    const checkOnLoad = document.getElementById('sync-on-load');
    const checkOnSave = document.getElementById('sync-on-save');

    if (checkOnLoad) checkOnLoad.checked = syncOnLoad;
    if (checkOnSave) checkOnSave.checked = syncOnSave;
}

// Verificar si debe sincronizar al cargar.
// Cuando el usuario activó "Sincronizar al iniciar" en Configuración, el sync
// debe ser silencioso: no tiene sentido pedirle confirmación cada vez. El
// usuario ya consintió globalmente activando la opción.
async function verificarSyncAlCargar() {
    if (!estadoPremium.activo) return;

    const syncOnLoad = localStorage.getItem('sync_on_load') === 'true';
    if (!syncOnLoad) return;

    // Esperar un poco para que la app termine de cargar
    setTimeout(async () => {
        try {
            if (syncState.syncInProgress) return;
            await sincronizarDatos();
        } catch (error) {
            console.log('Sync al iniciar falló:', error.message);
        }
    }, 2000);
}

// Verificar si hay datos remotos (sin descargar todo)
async function verificarDatosRemotos() {
    const url = `${PREMIUM_CONFIG.apiUrl}?action=obtener_sync&codigo=${encodeURIComponent(estadoPremium.codigo)}`;

    try {
        const response = await fetchConReintentos(url, {
            method: 'GET',
            timeout: 15000 // 15 segundos para verificación rápida
        }, 2); // Solo 2 reintentos para verificación

        const resultado = await response.json();

        if (resultado.success && resultado.datos) {
            return true;
        }
        return false;
    } catch (error) {
        console.log('Error verificando datos remotos:', error.message);
        return false;
    }
}

// Sincronizar después de guardar (delegado a sincronización bidireccional completa)
async function sincronizarDespuesDeGuardar() {
    if (!estadoPremium.activo || !estadoPremium.codigo) return;
    // Delegar a sincronización bidireccional completa para garantizar que todos los dispositivos reciban los cambios
    return sincronizarDatos();
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        inicializarSync();
        cargarConfigSync();
    });
} else {
    setTimeout(() => {
        inicializarSync();
        cargarConfigSync();
    }, 100);
}

// Verificar sync al cargar (después de que premium esté verificado)
setTimeout(() => {
    if (typeof estadoPremium !== 'undefined' && estadoPremium.activo) {
        verificarSyncAlCargar();
    }
}, 3000);

// Mostrar reporte de fusión de duplicados en un modal
function mostrarReporteFusion() {
    const reporte = reporteFusionDuplicados;
    if (!reporte || reporte.expedientesFusionados.length === 0) {
        mostrarToast('No hubo duplicados fusionados en la última sincronización', 'info');
        return;
    }

    let html = '<div class="fusion-reporte">';
    html += '<div class="fusion-resumen">';
    html += '<div class="fusion-stat"><span class="fusion-numero">' + reporte.expedientesFusionados.length + '</span><span class="fusion-label">Expedientes fusionados</span></div>';
    html += '<div class="fusion-stat"><span class="fusion-numero">' + reporte.notasReasignadas + '</span><span class="fusion-label">Notas reasignadas</span></div>';
    html += '<div class="fusion-stat"><span class="fusion-numero">' + reporte.eventosReasignados + '</span><span class="fusion-label">Eventos reasignados</span></div>';
    html += '</div>';

    html += '<div class="fusion-lista">';
    reporte.expedientesFusionados.forEach(function(fusion) {
        html += '<div class="fusion-item">';
        html += '<div class="fusion-item-header">';
        html += '<strong>' + (fusion.numero || fusion.nombre || 'Expediente') + '</strong>';
        if (fusion.idsOriginales) {
            html += '<span class="fusion-badge">' + fusion.idsOriginales.length + ' duplicados</span>';
        }
        html += '</div>';
        if (fusion.idsOriginales && fusion.idsOriginales.length > 1) {
            html += '<div class="fusion-item-originales">IDs originales: ' + fusion.idsOriginales.join(', ') + '</div>';
        }
        if (fusion._cambiosFusion) {
            html += '<div class="fusion-item-cambios">Cambios: ' + fusion._cambiosFusion + '</div>';
        }
        html += '</div>';
    });
    html += '</div>';

    html += '<div class="fusion-nota">Los expedientes duplicados fueron fusionados automáticamente conservando los datos más recientes.</div>';
    html += '</div>';

    // Usar el sistema de modales existente
    if (typeof mostrarModal === 'function') {
        mostrarModal('Reporte de Fusión de Duplicados', html);
    } else {
        // Fallback: mostrar en alert
        var texto = 'Expedientes fusionados: ' + reporte.expedientesFusionados.length +
            '\nNotas reasignadas: ' + reporte.notasReasignadas +
            '\nEventos reasignados: ' + reporte.eventosReasignados;
        alert(texto);
    }
}

// Exportar funciones globales
window.sincronizarDatos = sincronizarDatos;
window.marcarYSincronizar = marcarYSincronizar;
window.marcarPendienteSync = marcarPendienteSync;
window.limpiarPendienteSync = limpiarPendienteSync;
window.hayPendienteSync = hayPendienteSync;
window.actualizarBadgePendiente = actualizarBadgePendiente;
window.guardarConfigSync = guardarConfigSync;
window.sincronizarDespuesDeGuardar = sincronizarDespuesDeGuardar;
window.actualizarVisibilidadSync = actualizarVisibilidadSync;
window.cargarConfigSync = cargarConfigSync;
window.mostrarReporteFusion = mostrarReporteFusion;
window.sonExpedientesDuplicados = sonExpedientesDuplicados;
