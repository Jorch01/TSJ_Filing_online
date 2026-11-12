/**
 * Base de Datos Local usando IndexedDB
 * Almacena todos los datos en el navegador del usuario
 */

const DB_NAME = 'TSJFilingDB';
const DB_VERSION = 6; // v6: agrega store de pendientes (tareas por expediente)

let db = null;

// ==================== RELOJ DE SINCRONIZACIÓN ====================
//
// Toda marca de tiempo que decide qué edición gana un conflicto sale de aquí,
// no de new Date() a secas. Dos motivos, los dos vistos en la práctica:
//
// 1. Los relojes de los dispositivos no coinciden. Si el teléfono va tres
//    minutos atrasado respecto al ordenador, una edición hecha DESPUÉS en el
//    teléfono lleva una hora ANTERIOR y al fusionar pierde contra la más
//    vieja: el usuario ve su último cambio deshacerse solo, sin ningún aviso.
//    Por eso se aprende el desfase contra el reloj del servidor y se corrige.
//
// 2. Los relojes saltan hacia atrás. Un ajuste de hora del sistema puede hacer
//    que dos ediciones seguidas en el MISMO dispositivo queden selladas en
//    orden invertido. Por eso este reloj nunca retrocede: como mucho se queda
//    quieto y avanza un milisegundo.

const CLAVE_DESFASE_RELOJ = 'sync_desfase_reloj_ms';
const CLAVE_ULTIMO_SELLO = 'sync_ultimo_sello_ms';

let _desfaseReloj = 0;
let _ultimoSello = 0;

try {
    _desfaseReloj = parseInt(localStorage.getItem(CLAVE_DESFASE_RELOJ), 10) || 0;
    // El último sello sobrevive a recargar la página: si no, un reloj que saltó
    // hacia atrás entre sesiones volvería a sellar en el pasado.
    _ultimoSello = parseInt(localStorage.getItem(CLAVE_ULTIMO_SELLO), 10) || 0;
} catch (e) {
    _desfaseReloj = 0;
    _ultimoSello = 0;
}

/**
 * Aprende cuánto se desvía este dispositivo del reloj del servidor. La llama
 * la sincronización con la hora que devuelve el Apps Script en cada respuesta.
 */
function ajustarRelojSync(horaServidorISO) {
    const servidor = Date.parse(horaServidorISO);
    if (!servidor) return _desfaseReloj;

    const desfase = servidor - Date.now();

    // Un par de segundos es el viaje de ida y vuelta de la petición, no un
    // reloj mal puesto: corregir por eso solo añadiría ruido.
    if (Math.abs(desfase - _desfaseReloj) < 2000) return _desfaseReloj;

    _desfaseReloj = desfase;
    try { localStorage.setItem(CLAVE_DESFASE_RELOJ, String(desfase)); } catch (e) { /* modo privado */ }

    if (Math.abs(desfase) > 60000) {
        console.warn('El reloj de este dispositivo va ' + Math.round(desfase / 1000) +
                     's respecto al servidor. Las marcas de sincronización se corrigen, ' +
                     'pero conviene poner la hora en automático.');
    }
    return _desfaseReloj;
}

/** La hora que se sella en los datos: corregida y monótona. */
function ahoraSync() {
    const t = Math.max(Date.now() + _desfaseReloj, _ultimoSello + 1);
    _ultimoSello = t;
    try { localStorage.setItem(CLAVE_ULTIMO_SELLO, String(t)); } catch (e) { /* modo privado */ }
    return new Date(t).toISOString();
}

function desfaseRelojSync() { return _desfaseReloj; }


/**
 * Aviso sobre el almacenamiento. Usa el toast de la app si ya está cargado
 * y, si no (la base se abre antes que nada), deja una franja fija arriba.
 */
function avisarAlmacenamiento(mensaje, tipo = 'warning') {
    console.warn('[almacenamiento] ' + mensaje);
    if (typeof mostrarToast === 'function') {
        try { mostrarToast(mensaje, tipo); return; } catch (e) { /* sin toast todavía */ }
    }
    if (typeof document === 'undefined' || !document.body) return;
    let franja = document.getElementById('aviso-almacenamiento');
    if (!franja) {
        franja = document.createElement('div');
        franja.id = 'aviso-almacenamiento';
        franja.setAttribute('role', 'alert');
        franja.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 16px;' +
            'background:#b45309;color:#fff;font:14px/1.4 system-ui,sans-serif;text-align:center';
        document.body.appendChild(franja);
    }
    franja.textContent = mensaje;
}

// ==================== ALMACENAMIENTO PERSISTENTE ====================
//
// Sin permiso de almacenamiento persistente, el navegador puede borrar los
// datos de la app cuando le falta espacio, y Safari los borra si el sitio no
// se abre en 7 días (salvo que esté instalado en la pantalla de inicio). Para
// un despacho eso es perder expedientes y plazos sin aviso. Se pide el
// permiso una vez; si el navegador lo niega se avisa —una vez por semana como
// mucho— de que conviene sincronizar o descargar respaldos.

const CLAVE_AVISO_PERSISTENCIA = 'aviso_almacenamiento_no_persistente';

/**
 * Pide almacenamiento persistente. Devuelve { soportado, persistente,
 * usado, cuota }. No lanza nunca: un navegador sin la API sigue funcionando.
 */
async function solicitarAlmacenamientoPersistente() {
    const estado = { soportado: false, persistente: false, usado: null, cuota: null };
    try {
        if (typeof navigator === 'undefined' || !navigator.storage) return estado;
        if (navigator.storage.persisted) {
            estado.soportado = true;
            estado.persistente = await navigator.storage.persisted();
        }
        if (!estado.persistente && navigator.storage.persist) {
            estado.soportado = true;
            estado.persistente = await navigator.storage.persist();
        }
        if (navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            estado.usado = est.usage ?? null;
            estado.cuota = est.quota ?? null;
        }
    } catch (e) {
        console.warn('No se pudo consultar el almacenamiento persistente:', e);
    }
    return estado;
}

/**
 * Pide la persistencia y avisa si se niega y hay algo que perder sin copia en
 * otro sitio (ni sincronización ni respaldo automático). La llama app.js
 * después de cargar.
 */
async function revisarAlmacenamientoPersistente({ haySync = false, hayRespaldoAuto = false } = {}) {
    const estado = await solicitarAlmacenamientoPersistente();
    if (!estado.soportado || estado.persistente) return estado;

    let hayDatos = false;
    try { hayDatos = db && (await contarRegistrosStore('expedientes')) > 0; } catch (e) { /* sin base */ }
    if (!hayDatos || haySync) return estado;

    let ultimoAviso = 0;
    try { ultimoAviso = parseInt(localStorage.getItem(CLAVE_AVISO_PERSISTENCIA), 10) || 0; } catch (e) { /* modo privado */ }
    if (Date.now() - ultimoAviso < 7 * 24 * 60 * 60 * 1000) return estado;
    try { localStorage.setItem(CLAVE_AVISO_PERSISTENCIA, String(Date.now())); } catch (e) { /* modo privado */ }

    avisarAlmacenamiento('Este navegador puede borrar los datos de la app por su cuenta ' +
        '(Safari lo hace si no la abres en 7 días). ' +
        (hayRespaldoAuto ? 'Tienes el respaldo automático activado; guarda esos archivos. '
                         : 'Descarga un respaldo en Configuración o activa la sincronización. ') +
        'Instalar la app en la pantalla de inicio también lo evita.', 'warning');
    estado.avisado = true;
    return estado;
}

function contarRegistrosStore(nombre) {
    return new Promise((resolve, reject) => {
        if (!db || !db.objectStoreNames.contains(nombre)) { resolve(0); return; }
        const req = db.transaction([nombre], 'readonly').objectStore(nombre).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Inicializar base de datos
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Error al abrir IndexedDB:', request.error);
            // Sin base de datos no se puede guardar nada. Se dice por qué en
            // vez de un "error al cargar": lo normal es un navegador en modo
            // privado o con el almacenamiento de sitios desactivado, y quien
            // lo ve debe saber que lo que escriba no se va a conservar.
            avisarAlmacenamiento('No se puede abrir la base de datos de este navegador ' +
                '(¿modo privado o almacenamiento de sitios desactivado?). ' +
                'Lo que captures no se guardará. Abre la app en una ventana normal.', 'error');
            reject(request.error);
        };

        // Otra pestaña con la versión anterior de la app tiene la base
        // abierta y no la suelta. Sin esto la promesa no se resolvía nunca y
        // la app se quedaba en blanco, que invita a "borrar datos del sitio"
        // para arreglarlo: justo lo que no hay que hacer.
        request.onblocked = () => {
            avisarAlmacenamiento('Hay otra pestaña de la app abierta con una versión anterior. ' +
                'Ciérrala (o recárgala) para terminar de actualizar; tus datos están a salvo.', 'warning');
        };

        request.onsuccess = () => {
            db = request.result;
            // Si otra pestaña trae una versión nueva de la base, esta suelta
            // la suya para no bloquearla y pide recargar. Seguir escribiendo
            // con la conexión vieja ya no sería posible de todos modos.
            db.onversionchange = () => {
                try { db.close(); } catch (e) { /* ya cerrada */ }
                db = null;
                avisarAlmacenamiento('La app se actualizó en otra pestaña. Recarga esta página para seguir; ' +
                    'lo que ya guardaste no se pierde.', 'warning');
            };
            console.log('IndexedDB inicializada correctamente');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Store: Expedientes
            if (!database.objectStoreNames.contains('expedientes')) {
                const expStore = database.createObjectStore('expedientes', { keyPath: 'id', autoIncrement: true });
                expStore.createIndex('numero', 'numero', { unique: false });
                expStore.createIndex('nombre', 'nombre', { unique: false });
                expStore.createIndex('juzgado', 'juzgado', { unique: false });
                expStore.createIndex('categoria', 'categoria', { unique: false });
                expStore.createIndex('activo', 'activo', { unique: false });
            }

            // Store: Notas
            if (!database.objectStoreNames.contains('notas')) {
                const notasStore = database.createObjectStore('notas', { keyPath: 'id', autoIncrement: true });
                notasStore.createIndex('expedienteId', 'expedienteId', { unique: false });
                notasStore.createIndex('fechaCreacion', 'fechaCreacion', { unique: false });
            }

            // Store: Eventos
            if (!database.objectStoreNames.contains('eventos')) {
                const eventosStore = database.createObjectStore('eventos', { keyPath: 'id', autoIncrement: true });
                eventosStore.createIndex('expedienteId', 'expedienteId', { unique: false });
                eventosStore.createIndex('fechaInicio', 'fechaInicio', { unique: false });
                eventosStore.createIndex('tipo', 'tipo', { unique: false });
            }

            // Store: Configuración
            if (!database.objectStoreNames.contains('config')) {
                database.createObjectStore('config', { keyPath: 'clave' });
            }

            // Store: Historial de cambios
            if (!database.objectStoreNames.contains('historial')) {
                const historialStore = database.createObjectStore('historial', { keyPath: 'id', autoIncrement: true });
                historialStore.createIndex('expedienteId', 'expedienteId', { unique: false });
                historialStore.createIndex('fecha', 'fecha', { unique: false });
                historialStore.createIndex('tipo', 'tipo', { unique: false });
            }

            // Store: Registro de eliminaciones (para sincronización)
            if (!database.objectStoreNames.contains('eliminados')) {
                const eliminadosStore = database.createObjectStore('eliminados', { keyPath: 'clave' });
                eliminadosStore.createIndex('fecha', 'fecha', { unique: false });
                eliminadosStore.createIndex('tipo', 'tipo', { unique: false });
            }

            // Store: Búsquedas guardadas SIGA (monitoreo de gacetas)
            if (!database.objectStoreNames.contains('sigaGuardadas')) {
                const sigaStore = database.createObjectStore('sigaGuardadas', { keyPath: 'id', autoIncrement: true });
                sigaStore.createIndex('query', 'query', { unique: false });
            }

            // Store: Carpetas (agrupación de expedientes que pertenecen al mismo caso)
            if (!database.objectStoreNames.contains('carpetas')) {
                const carpetasStore = database.createObjectStore('carpetas', { keyPath: 'id', autoIncrement: true });
                carpetasStore.createIndex('nombre', 'nombre', { unique: false });
                carpetasStore.createIndex('archivada', 'archivada', { unique: false });
            }

            // Store: Pendientes (tareas por expediente, con fecha opcional
            // vinculada al calendario)
            if (!database.objectStoreNames.contains('pendientes')) {
                const pendientesStore = database.createObjectStore('pendientes', { keyPath: 'id', autoIncrement: true });
                pendientesStore.createIndex('expedienteId', 'expedienteId', { unique: false });
                pendientesStore.createIndex('completado', 'completado', { unique: false });
                pendientesStore.createIndex('fechaLimite', 'fechaLimite', { unique: false });
            }

            console.log('Stores de IndexedDB creados');
        };
    });
}

// ==================== EXPEDIENTES ====================

async function agregarExpediente(expediente) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['expedientes'], 'readwrite');
        const store = transaction.objectStore('expedientes');

        const ahora = ahoraSync();
        expediente.fechaCreacion = ahora;
        expediente.fechaActualizacion = ahora;
        expediente.activo = true;

        // Timestamps por campo para merge granular (resuelve conflictos campo-a-campo
        // en sincronización: si editas comentario en iPhone y juzgado en PC, no se
        // pisan entre sí).
        expediente._fieldTimestamps = expediente._fieldTimestamps || {};
        for (const key of Object.keys(expediente)) {
            if (key === '_fieldTimestamps' || key === 'id' || key === 'orden') continue;
            expediente._fieldTimestamps[key] = ahora;
        }

        const request = store.add(expediente);

        request.onsuccess = async () => {
            const nuevoId = request.result;
            // Registrar creación en historial
            try {
                await registrarCambioExpediente(nuevoId, 'creacion', null, expediente, 'Expediente creado');
            } catch (e) {
                console.error('Error al registrar historial de creación:', e);
            }
            resolve(nuevoId);
        };
        request.onerror = () => reject(request.error);
    });
}

async function obtenerExpedientes() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['expedientes'], 'readonly');
        const store = transaction.objectStore('expedientes');
        const request = store.getAll();

        request.onsuccess = () => {
            const expedientes = request.result.filter(e => e.activo !== false && !e.archivado);
            resolve(expedientes);
        };
        request.onerror = () => reject(request.error);
    });
}

async function obtenerExpedientesArchivados() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['expedientes'], 'readonly');
        const store = transaction.objectStore('expedientes');
        const request = store.getAll();

        request.onsuccess = () => {
            const expedientes = request.result.filter(e => e.activo !== false && e.archivado === true);
            resolve(expedientes);
        };
        request.onerror = () => reject(request.error);
    });
}

// resultado: cómo terminó el asunto ('favorable', 'desfavorable'…). Solo se
// toca si se pasa; quien archiva sin preguntarlo (asistente, carpetas) no lo
// borra. Al desarchivar se quita: un asunto reabierto no tiene resultado final.
async function archivarExpedienteDB(id, archivado, motivoArchivo, etiquetaArchivo, resultado) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['expedientes'], 'readwrite');
        const store = transaction.objectStore('expedientes');
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const expediente = getRequest.result;
            if (!expediente) {
                reject(new Error('Expediente no encontrado'));
                return;
            }

            const ahora = ahoraSync();
            if (archivado) {
                expediente.archivado = true;
                expediente.motivoArchivo = motivoArchivo || 'concluido';
                expediente.etiquetaArchivo = etiquetaArchivo || '';
                expediente.fechaArchivo = ahora;
                if (resultado !== undefined) {
                    if (resultado) expediente.resultado = resultado;
                    else delete expediente.resultado;
                }
            } else {
                expediente.archivado = false;
                delete expediente.motivoArchivo;
                delete expediente.etiquetaArchivo;
                delete expediente.fechaArchivo;
                delete expediente.resultado;
            }
            expediente.fechaActualizacion = ahora;
            // Timestamps por campo para que el merge resuelva el estado de archivo
            // por campo y no por la fecha de actualización global del expediente.
            expediente._fieldTimestamps = expediente._fieldTimestamps || {};
            expediente._fieldTimestamps.archivado = ahora;
            expediente._fieldTimestamps.motivoArchivo = ahora;
            expediente._fieldTimestamps.etiquetaArchivo = ahora;
            expediente._fieldTimestamps.fechaArchivo = ahora;
            if (!archivado || resultado !== undefined) expediente._fieldTimestamps.resultado = ahora;

            store.put(expediente);
        };

        getRequest.onerror = () => reject(getRequest.error);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(new Error('Transacción abortada al archivar expediente'));
    });
}

async function obtenerExpediente(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['expedientes'], 'readonly');
        const store = transaction.objectStore('expedientes');
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function actualizarExpediente(id, cambios) {
    return new Promise(async (resolve, reject) => {
        const expediente = await obtenerExpediente(id);
        if (!expediente) {
            reject(new Error('Expediente no encontrado'));
            return;
        }

        // Detectar qué campos cambiaron
        const camposModificados = {};
        const valoresAnteriores = {};
        for (const [key, value] of Object.entries(cambios)) {
            if (expediente[key] !== value && key !== 'fechaActualizacion' && key !== 'orden' && key !== '_fieldTimestamps') {
                valoresAnteriores[key] = expediente[key];
                camposModificados[key] = value;
            }
        }

        const ahora = ahoraSync();
        // Actualizar timestamps por campo solo para los campos que cambiaron.
        // Esto permite que la sync por campo gane el conflicto correcto: si el
        // usuario solo cambió el comentario, otro dispositivo que cambió juzgado
        // después no pisará el comentario.
        const fieldTimestamps = { ...(expediente._fieldTimestamps || {}) };
        for (const key of Object.keys(camposModificados)) {
            fieldTimestamps[key] = ahora;
        }

        const actualizado = { ...expediente, ...cambios, fechaActualizacion: ahora, _fieldTimestamps: fieldTimestamps };

        const transaction = db.transaction(['expedientes'], 'readwrite');
        const store = transaction.objectStore('expedientes');
        const request = store.put(actualizado);

        request.onsuccess = async () => {
            // Registrar cambio en historial (solo si hubo cambios significativos)
            if (Object.keys(camposModificados).length > 0) {
                try {
                    await registrarCambioExpediente(id, 'edicion', valoresAnteriores, camposModificados);
                } catch (e) {
                    console.error('Error al registrar historial:', e);
                }
            }
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });
}

async function eliminarExpediente(id, permanente = false) {
    // Obtener datos del expediente antes de eliminar para registrar
    const expediente = await obtenerExpediente(id);

    if (permanente) {
        return new Promise(async (resolve, reject) => {
            // Registrar eliminación para sincronización
            if (expediente) {
                await registrarEliminacion('expediente', expediente);
            }

            const transaction = db.transaction(['expedientes'], 'readwrite');
            const store = transaction.objectStore('expedientes');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } else {
        // Soft delete también se registra
        if (expediente) {
            await registrarEliminacion('expediente', expediente);
        }
        return actualizarExpediente(id, { activo: false });
    }
}

// Registrar eliminación para sincronización
async function registrarEliminacion(tipo, registro) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['eliminados'], 'readwrite');
        const store = transaction.objectStore('eliminados');

        // Generar clave única basada en contenido (no ID, porque cambia entre dispositivos).
        // Para notas/eventos normalizamos (lowercase + trim) para que coincida con
        // la clave usada por las funciones de fusión en sync.js.
        let clave;
        let datos = {};
        if (tipo === 'expediente') {
            const numero = (registro.numero || '').trim().toLowerCase();
            const nombre = (registro.nombre || '').trim().toLowerCase();
            const juzgado = (registro.juzgado || '').trim().toLowerCase();
            clave = `exp|${numero}|${nombre}|${juzgado}`;
            datos = { numero: registro.numero, nombre: registro.nombre, juzgado: registro.juzgado };
        } else if (tipo === 'nota') {
            clave = claveBorradoNota(registro);
            datos = { expedienteId: registro.expedienteId, titulo: registro.titulo };
        } else if (tipo === 'evento') {
            const titulo = (registro.titulo || '').trim().toLowerCase();
            const fechaInicio = (registro.fechaInicio || registro.fecha || '');
            const expedienteId = registro.expedienteId || 'sin-exp';
            clave = `evento|${titulo}|${fechaInicio}|${expedienteId}`;
            datos = { titulo: registro.titulo, fechaInicio: registro.fechaInicio, expedienteId: registro.expedienteId };
        } else if (tipo === 'pendiente') {
            // Identidad por expediente + título + fecha de creación, igual
            // criterio que usa fusionarPendientes en sync.js.
            const titulo = (registro.titulo || '').trim().toLowerCase();
            const expedienteId = registro.expedienteId || 'sin-exp';
            const fecha = (registro.fechaCreacion || '').substring(0, 10);
            clave = `pendiente|${expedienteId}|${titulo}|${fecha}`;
            datos = { expedienteId: registro.expedienteId, titulo: registro.titulo };
        } else if (tipo === 'carpeta') {
            // Identidad por nombre normalizado (debe coincidir con _claveCarpeta
            // en sync.js: lowercase, sin acentos, espacios colapsados).
            const nombre = (registro.nombre || '').trim().toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/\s+/g, ' ');
            clave = `carpeta|${nombre}`;
            datos = { nombre: registro.nombre };
        }

        const eliminado = {
            clave,
            tipo,
            fecha: new Date().toISOString(),
            datos
        };

        const request = store.put(eliminado);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Clave del borrado de una nota. Lleva el título al final: sin él, borrar una
 * nota se llevaba también a cualquier otra del mismo expediente y del mismo
 * día que empezara igual (o que no tuviera contenido), en todos los
 * dispositivos.
 */
function claveBorradoNota(nota) {
    const contenido = (nota.contenido || '').substring(0, 100).trim().toLowerCase();
    const expedienteId = nota.expedienteId || 'sin-exp';
    const fecha = (nota.fechaCreacion || '').substring(0, 10);
    const titulo = (nota.titulo || '').trim().toLowerCase();
    return `nota2|${expedienteId}|${contenido}|${fecha}|${titulo}`;
}

/** La clave de antes, sin título. Solo para borrados viejos que no lo guardaron. */
function claveBorradoNotaAntigua(nota) {
    const contenido = (nota.contenido || '').substring(0, 100).trim().toLowerCase();
    const expedienteId = nota.expedienteId || 'sin-exp';
    const fecha = (nota.fechaCreacion || '').substring(0, 10);
    return `nota|${expedienteId}|${contenido}|${fecha}`;
}

/**
 * La clave de un borrado en el formato de ahora. Los de notas escritos por
 * una versión anterior no llevan el título en la clave pero sí en sus datos:
 * se le añade, para que sigan borrando la nota que tocaba y solo esa.
 */
function claveBorradoNormalizada(eliminado) {
    if (!eliminado || eliminado.tipo !== 'nota' || typeof eliminado.clave !== 'string') return eliminado && eliminado.clave;
    if (!eliminado.clave.startsWith('nota|')) return eliminado.clave;   // ya es "nota2|…"
    const titulo = eliminado.datos && eliminado.datos.titulo !== undefined
        ? String(eliminado.datos.titulo || '').trim().toLowerCase() : null;
    // Sin título guardado no hay forma de afinar: se deja como estaba.
    return titulo === null ? eliminado.clave : `nota2|${eliminado.clave.slice(5)}|${titulo}`;
}

// Obtener todos los registros de eliminación
async function obtenerEliminados() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['eliminados'], 'readonly');
        const store = transaction.objectStore('eliminados');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

// Agregar eliminados desde sincronización remota
async function agregarEliminados(eliminados) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['eliminados'], 'readwrite');
        const store = transaction.objectStore('eliminados');

        for (const eliminado of eliminados) {
            store.put(eliminado);
        }

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/**
 * Cuándo se tocó por última vez un registro, mirando TODO lo que lleva sellado.
 *
 * No basta con fechaActualizacion: la fusión por campo puede traer un valor
 * más reciente de otro dispositivo sin que esa fecha se mueva.
 */
function ultimaEdicionDe(registro) {
    let ultima = registro.fechaActualizacion || registro.fechaCreacion || '';
    const sellos = registro._fieldTimestamps || {};
    for (const campo of Object.keys(sellos)) {
        if (sellos[campo] > ultima) ultima = sellos[campo];
    }
    return ultima;
}

/**
 * ¿Manda este borrado sobre el registro que tengo?
 *
 * Solo si el borrado es POSTERIOR a la última edición. Antes se aplicaban
 * todos sin mirar, y eso convertía un borrado viejo en una bomba: si un
 * dispositivo borraba un expediente el lunes y otro —sin conexión— lo editaba
 * el miércoles, al sincronizar el jueves ganaba el borrado del lunes y la
 * edición del miércoles desaparecía sin dejar rastro.
 *
 * Al comparar fechas, los dos dispositivos llegan a la misma conclusión, así
 * que la decisión es la misma en todos: o se borra en todos, o sobrevive en
 * todos.
 */
function _borradoMandaSobre(fechaBorrado, registro) {
    if (!fechaBorrado) return true;   // registro antiguo sin fecha: como antes
    return !(ultimaEdicionDe(registro) > fechaBorrado);
}

// Aplicar eliminaciones remotas: eliminar expedientes, notas y eventos que están
// en la lista de eliminados remotos. Las claves deben coincidir con las generadas
// por registrarEliminacion() / claveNota() / claveEvento() / claveEliminacionExpediente().
async function aplicarEliminacionesRemotas(eliminadosRemotos) {
    if (!eliminadosRemotos || eliminadosRemotos.length === 0) return 0;

    let eliminadosCount = 0;
    let rescatados = 0;

    // Mapa clave → fecha del borrado. Antes era un Set: la fecha estaba en el
    // registro pero no se miraba, y sin ella no se puede decidir quién es más
    // reciente.
    const porTipo = (tipo) => new Map(eliminadosRemotos
        .filter(e => e.tipo === tipo)
        .map(e => [claveBorradoNormalizada(e), e.fecha || '']));

    const clavesExpediente = porTipo('expediente');
    const clavesNota = porTipo('nota');
    const clavesEvento = porTipo('evento');
    const clavesPendiente = porTipo('pendiente');

    // Expedientes
    if (clavesExpediente.size > 0) {
        const expedientes = await obtenerExpedientes();
        for (const exp of expedientes) {
            const numero = (exp.numero || '').trim().toLowerCase();
            const nombre = (exp.nombre || '').trim().toLowerCase();
            const juzgado = (exp.juzgado || '').trim().toLowerCase();
            const clave = `exp|${numero}|${nombre}|${juzgado}`;

            if (clavesExpediente.has(clave)) {
                if (!_borradoMandaSobre(clavesExpediente.get(clave), exp)) {
                    rescatados++;
                    continue;   // se editó después de borrarlo: la edición manda
                }
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction(['expedientes'], 'readwrite');
                    const store = transaction.objectStore('expedientes');
                    const request = store.delete(exp.id);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
                eliminadosCount++;
            }
        }
    }

    // Notas
    if (clavesNota.size > 0) {
        const notas = await obtenerNotas();
        for (const nota of notas) {
            const nueva = claveBorradoNota(nota);
            const clave = clavesNota.has(nueva) ? nueva : claveBorradoNotaAntigua(nota);

            if (clavesNota.has(clave)) {
                if (!_borradoMandaSobre(clavesNota.get(clave), nota)) {
                    rescatados++;
                    continue;   // se editó después de borrarlo: la edición manda
                }
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction(['notas'], 'readwrite');
                    const store = transaction.objectStore('notas');
                    const request = store.delete(nota.id);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
                eliminadosCount++;
            }
        }
    }

    // Eventos
    if (clavesEvento.size > 0) {
        const eventos = await obtenerEventos();
        for (const ev of eventos) {
            const titulo = (ev.titulo || '').trim().toLowerCase();
            const fechaInicio = (ev.fechaInicio || ev.fecha || '');
            const expedienteId = ev.expedienteId || 'sin-exp';
            const clave = `evento|${titulo}|${fechaInicio}|${expedienteId}`;

            if (clavesEvento.has(clave)) {
                if (!_borradoMandaSobre(clavesEvento.get(clave), ev)) {
                    rescatados++;
                    continue;   // se editó después de borrarlo: la edición manda
                }
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction(['eventos'], 'readwrite');
                    const store = transaction.objectStore('eventos');
                    const request = store.delete(ev.id);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
                eliminadosCount++;
            }
        }
    }

    // Pendientes
    if (clavesPendiente.size > 0) {
        const pendientes = await obtenerPendientes();
        for (const p of pendientes) {
            const titulo = (p.titulo || '').trim().toLowerCase();
            const expedienteId = p.expedienteId || 'sin-exp';
            const fecha = (p.fechaCreacion || '').substring(0, 10);
            const clave = `pendiente|${expedienteId}|${titulo}|${fecha}`;

            if (clavesPendiente.has(clave)) {
                if (!_borradoMandaSobre(clavesPendiente.get(clave), p)) {
                    rescatados++;
                    continue;   // se editó después de borrarlo: la edición manda
                }
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction(['pendientes'], 'readwrite');
                    const request = transaction.objectStore('pendientes').delete(p.id);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
                eliminadosCount++;
            }
        }
    }

    // Guardar los eliminados remotos localmente para conservar la "tombstone"
    await agregarEliminados(eliminadosRemotos);

    return eliminadosCount;
}

// ==================== DETECCIÓN Y ELIMINACIÓN DE DUPLICADOS ====================

// Borra lo que cuelga de un expediente: pendientes, eventos y notas. Sin esto
// quedan apuntando a un expediente inexistente —invisibles en la app pero
// vivos en la base y, los eventos, también en Google Calendar.
// Vive en esta capa porque la usan dos caminos: borrar un expediente y borrar
// una carpeta junto con sus expedientes.
async function eliminarDependenciasDeExpediente(expedienteId) {
    const [notas, eventos, pendientes] = await Promise.all([
        obtenerNotas().catch(() => []),
        obtenerEventos().catch(() => []),
        obtenerPendientes().catch(() => [])
    ]);

    // Los pendientes primero, anotando sus eventos vinculados. Normalmente el
    // evento ya lleva el mismo expedienteId, pero si el pendiente cambió de
    // expediente y su evento no alcanzó a actualizarse, sin esta anotación el
    // recordatorio sobreviviría al borrado.
    const eventosDePendientes = new Set();
    for (const p of pendientes.filter(x => x.expedienteId === expedienteId)) {
        if (p.eventoId) eventosDePendientes.add(p.eventoId);
        await eliminarPendiente(p.id).catch(() => {});
    }

    for (const e of eventos.filter(x => x.expedienteId === expedienteId || eventosDePendientes.has(x.id))) {
        await eliminarEvento(e.id).catch(() => {});
        // La copia en Google Calendar no se va sola.
        try {
            if (typeof GCAL !== 'undefined' && GCAL.estaConectado && GCAL.estaConectado() &&
                e.googleCalEventId && GCAL.hookEliminarEvento) {
                GCAL.hookEliminarEvento(e.googleCalEventId);
            }
        } catch (err) { /* que falle el calendario no debe frenar el borrado */ }
    }

    for (const n of notas.filter(x => x.expedienteId === expedienteId)) {
        await eliminarNota(n.id).catch(() => {});
    }
}

// Cuántos registros dependen de un expediente. Sirve para avisar al usuario
// antes de borrarlo: nada debe desaparecer en silencio.
async function contarRegistrosDeExpediente(id) {
    const [notas, eventos, pendientes] = await Promise.all([
        obtenerNotas().catch(() => []),
        obtenerEventos().catch(() => []),
        obtenerPendientes().catch(() => [])
    ]);
    return {
        notas: notas.filter(n => n.expedienteId === id).length,
        eventos: eventos.filter(e => e.expedienteId === id).length,
        pendientes: pendientes.filter(p => p.expedienteId === id).length
    };
}

// Traslada notas, eventos y pendientes de un expediente a otro. Lo usa la
// deduplicación automática: al fusionar dos expedientes iguales, lo que colgaba
// del descartado debe pasar al que sobrevive, no quedarse apuntando a un id
// que ya no existe.
async function reasignarRegistrosDeExpediente(idOrigen, idDestino) {
    const [notas, eventos, pendientes] = await Promise.all([
        obtenerNotas().catch(() => []),
        obtenerEventos().catch(() => []),
        obtenerPendientes().catch(() => [])
    ]);

    for (const n of notas.filter(x => x.expedienteId === idOrigen)) {
        await actualizarNota(n.id, { expedienteId: idDestino }).catch(() => {});
    }
    for (const e of eventos.filter(x => x.expedienteId === idOrigen)) {
        await actualizarEvento(e.id, { expedienteId: idDestino }).catch(() => {});
    }
    for (const p of pendientes.filter(x => x.expedienteId === idOrigen)) {
        await actualizarPendiente(p.id, { expedienteId: idDestino }).catch(() => {});
    }
}

// Normaliza un dato del expediente para comparar identidad: sin acentos, sin
// mayúsculas y sin espacios de más.
function _normalizarIdentidadExpediente(valor) {
    return String(valor == null ? '' : valor)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Clave de identidad de un expediente para el barrido de duplicados.
 *
 * Dos registros son el mismo solo si coinciden en TODO lo que los identifica.
 * Antes la clave era `(numero || nombre) | juzgado | categoria`, y eso mezclaba
 * dos campos distintos: un asunto dado de alta por NOMBRE chocaba con otro,
 * completamente distinto, cuyo NÚMERO era ese mismo texto. El barrido borraba
 * uno de los dos sin avisar, así que al crear el tercer asunto de un caso
 * desaparecía otro y siempre quedaban los mismos.
 *
 * La categoría no entra: se calcula a partir del juzgado, así que no distingue
 * nada. La institución sí, porque un expediente del TSJ y uno federal son
 * registros separados aunque compartan número.
 */
function _claveIdentidadExpediente(exp) {
    return [
        _normalizarIdentidadExpediente(exp.numero),
        _normalizarIdentidadExpediente(exp.nombre),
        _normalizarIdentidadExpediente(exp.juzgado),
        _normalizarIdentidadExpediente(exp.institucion || 'TSJ')
    ].join('|');
}

/**
 * Quita los expedientes que están repetidos de forma literal, conservando el
 * más completo. Devuelve la lista de lo que quitó —{ conservado, eliminado }—
 * para que quien lo llame pueda decírselo al usuario: borrar un expediente en
 * silencio se vive como que la app pierde asuntos.
 */
async function eliminarExpedientesDuplicados() {
    const expedientes = await obtenerExpedientes();
    const duplicadosAEliminar = [];
    const expedientesPorClave = new Map();

    for (const exp of expedientes) {
        // Sin número ni nombre no hay forma de saber si dos registros son el
        // mismo: se dejan en paz antes que borrar por una coincidencia de
        // juzgado.
        if (!_normalizarIdentidadExpediente(exp.numero) &&
            !_normalizarIdentidadExpediente(exp.nombre)) continue;

        const clave = _claveIdentidadExpediente(exp);
        if (!expedientesPorClave.has(clave)) {
            expedientesPorClave.set(clave, []);
        }
        expedientesPorClave.get(clave).push(exp);
    }

    // Identificar duplicados y mantener el más completo/reciente
    for (const [clave, grupo] of expedientesPorClave) {
        if (grupo.length > 1) {
            // Ordenar: primero el que tiene más datos, luego el más reciente
            grupo.sort((a, b) => {
                // Contar campos con datos
                const contarCampos = (e) => {
                    let count = 0;
                    if (e.numero) count++;
                    if (e.nombre) count++;
                    if (e.comentario) count++;
                    if (e.categoria) count++;
                    return count;
                };
                const camposA = contarCampos(a);
                const camposB = contarCampos(b);
                if (camposA !== camposB) return camposB - camposA;

                // Si tienen igual número de campos, el más reciente
                const fechaA = new Date(a.fechaModificacion || a.fechaCreacion || 0);
                const fechaB = new Date(b.fechaModificacion || b.fechaCreacion || 0);
                return fechaB - fechaA;
            });

            // El primero se mantiene, los demás son duplicados
            for (let i = 1; i < grupo.length; i++) {
                duplicadosAEliminar.push({
                    id: grupo[i].id,
                    sobreviviente: grupo[0].id,
                    etiqueta: grupo[i].numero || grupo[i].nombre || `#${grupo[i].id}`
                });
            }
        }
    }

    // Eliminar duplicados. Antes se traslada al superviviente lo que colgaba
    // del duplicado: si no, sus notas, eventos y pendientes quedan apuntando a
    // un expediente que ya no existe.
    const quitados = [];
    for (const { id, sobreviviente, etiqueta } of duplicadosAEliminar) {
        await reasignarRegistrosDeExpediente(id, sobreviviente);
        await eliminarExpediente(id, true);
        quitados.push({ etiqueta, sobreviviente });
    }

    return quitados;
}

// ==================== CARPETAS ====================
// Una carpeta agrupa múltiples expedientes que pertenecen al mismo caso (por
// ejemplo: principal + amparo + recursos). El expediente.carpetaId apunta a
// carpeta.id (relación 1:N — un expediente en una sola carpeta).

async function agregarCarpeta(carpeta) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['carpetas'], 'readwrite');
        const store = transaction.objectStore('carpetas');

        const ahora = ahoraSync();
        carpeta.fechaCreacion = ahora;
        carpeta.fechaActualizacion = ahora;
        carpeta.archivada = !!carpeta.archivada;

        // Timestamps por campo para merge granular en sync.
        carpeta._fieldTimestamps = carpeta._fieldTimestamps || {};
        for (const key of Object.keys(carpeta)) {
            if (key === '_fieldTimestamps' || key === 'id') continue;
            carpeta._fieldTimestamps[key] = ahora;
        }

        const request = store.add(carpeta);

        request.onsuccess = () => {
            if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });
}

async function obtenerCarpetas() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['carpetas'], 'readonly');
        const store = transaction.objectStore('carpetas');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function obtenerCarpetasActivas() {
    const todas = await obtenerCarpetas();
    return todas.filter(c => !c.archivada);
}

async function obtenerCarpetasArchivadas() {
    const todas = await obtenerCarpetas();
    return todas.filter(c => !!c.archivada);
}

async function obtenerCarpeta(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['carpetas'], 'readonly');
        const store = transaction.objectStore('carpetas');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function actualizarCarpeta(id, cambios) {
    return new Promise(async (resolve, reject) => {
        const carpeta = await obtenerCarpeta(id);
        if (!carpeta) { reject(new Error('Carpeta no encontrada')); return; }

        const camposModificados = {};
        for (const [key, value] of Object.entries(cambios)) {
            if (carpeta[key] !== value && key !== 'fechaActualizacion' && key !== '_fieldTimestamps') {
                camposModificados[key] = value;
            }
        }

        const ahora = ahoraSync();
        const fieldTimestamps = { ...(carpeta._fieldTimestamps || {}) };
        for (const key of Object.keys(camposModificados)) {
            fieldTimestamps[key] = ahora;
        }

        const actualizada = { ...carpeta, ...cambios, fechaActualizacion: ahora, _fieldTimestamps: fieldTimestamps };

        const transaction = db.transaction(['carpetas'], 'readwrite');
        const store = transaction.objectStore('carpetas');
        const request = store.put(actualizada);
        request.onsuccess = () => {
            if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });
}

// Eliminar carpeta. Si conExpedientes=true, también elimina (soft-delete) los
// expedientes asignados. Si false, los expedientes quedan sin carpeta (carpetaId
// borrado).
async function eliminarCarpeta(id, conExpedientes = false) {
    const carpeta = await obtenerCarpeta(id);
    if (!carpeta) return;

    // Buscar expedientes de esta carpeta (TSJ + PJF + OTROS + archivados)
    const todosExpedientes = await new Promise((resolve, reject) => {
        const tx = db.transaction(['expedientes'], 'readonly');
        const req = tx.objectStore('expedientes').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
    const expedientesEnCarpeta = todosExpedientes.filter(e => e.carpetaId === id);

    if (conExpedientes) {
        // Eliminar cada expediente (registra eliminación para sync) junto con
        // sus pendientes, notas y eventos; si no, quedan huérfanos.
        for (const exp of expedientesEnCarpeta) {
            await eliminarDependenciasDeExpediente(exp.id);
            await eliminarExpediente(exp.id, true);
        }
    } else {
        // Solo quitar la referencia a la carpeta
        for (const exp of expedientesEnCarpeta) {
            await actualizarExpediente(exp.id, { carpetaId: undefined });
        }
    }

    // Registrar eliminación de la carpeta para sync
    await registrarEliminacion('carpeta', carpeta);

    // Borrar la carpeta
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['carpetas'], 'readwrite');
        const req = tx.objectStore('carpetas').delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });

    if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
}

// Archivar carpeta = marcar carpeta archivada Y archivar todos sus expedientes
// con el mismo motivo. Cada expediente afectado queda marcado con
// _archivadoPorCarpeta=<id de la carpeta> para poder distinguirlos al desarchivar
// y no resucitar expedientes que el usuario ya había archivado por su cuenta.
async function archivarCarpeta(id, motivo, etiqueta) {
    const ahora = ahoraSync();
    await actualizarCarpeta(id, {
        archivada: true,
        motivoArchivo: motivo,
        etiquetaArchivo: etiqueta || '',
        fechaArchivo: ahora
    });

    const todosExpedientes = await new Promise((resolve, reject) => {
        const tx = db.transaction(['expedientes'], 'readonly');
        const req = tx.objectStore('expedientes').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
    const expedientesEnCarpeta = todosExpedientes.filter(e => e.carpetaId === id && !e.archivado);

    for (const exp of expedientesEnCarpeta) {
        // Marcar primero el flag para que el desarchivado de carpeta sepa cuáles
        // restaurar (vs. los que estaban archivados manualmente desde antes).
        await actualizarExpediente(exp.id, { _archivadoPorCarpeta: id });
        await archivarExpedienteDB(exp.id, true, motivo, etiqueta);
    }
}

// Desarchiva la carpeta Y los expedientes que se archivaron por ella (los que
// tienen _archivadoPorCarpeta === id). Los que el usuario archivó manualmente
// antes/independientemente del archivo de carpeta quedan archivados.
async function desarchivarCarpeta(id) {
    await actualizarCarpeta(id, {
        archivada: false,
        motivoArchivo: undefined,
        etiquetaArchivo: undefined,
        fechaArchivo: undefined
    });

    const todosExpedientes = await new Promise((resolve, reject) => {
        const tx = db.transaction(['expedientes'], 'readonly');
        const req = tx.objectStore('expedientes').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
    const afectados = todosExpedientes.filter(e =>
        e.carpetaId === id && e.archivado && e._archivadoPorCarpeta === id
    );

    for (const exp of afectados) {
        await archivarExpedienteDB(exp.id, false);
        // Limpiar la marca
        await actualizarExpediente(exp.id, { _archivadoPorCarpeta: undefined });
    }
}

// ==================== NOTAS ====================

async function agregarNota(nota) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['notas'], 'readwrite');
        const store = transaction.objectStore('notas');

        const ahora = ahoraSync();
        nota.fechaCreacion = ahora;
        nota.fechaActualizacion = ahora;

        // Timestamps por campo para merge granular en sync (ganador por campo,
        // no por nota completa). Si dos dispositivos editan campos distintos,
        // ninguno pisa al otro.
        nota._fieldTimestamps = nota._fieldTimestamps || {};
        for (const key of Object.keys(nota)) {
            if (key === '_fieldTimestamps' || key === 'id') continue;
            nota._fieldTimestamps[key] = ahora;
        }

        const request = store.add(nota);

        request.onsuccess = () => {
            if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });
}

async function obtenerNotas() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['notas'], 'readonly');
        const store = transaction.objectStore('notas');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function obtenerNotasPorExpediente(expedienteId) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['notas'], 'readonly');
        const store = transaction.objectStore('notas');
        const index = store.index('expedienteId');
        const request = index.getAll(expedienteId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function actualizarNota(id, cambios) {
    return new Promise(async (resolve, reject) => {
        const transaction = db.transaction(['notas'], 'readwrite');
        const store = transaction.objectStore('notas');
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const nota = getRequest.result;
            if (!nota) {
                reject(new Error('Nota no encontrada'));
                return;
            }

            const ahora = ahoraSync();
            // Marcar timestamp solo para campos que cambiaron, así el merge por
            // campo no pisa ediciones independientes hechas en otro dispositivo.
            const fieldTimestamps = { ...(nota._fieldTimestamps || {}) };
            for (const [key, value] of Object.entries(cambios)) {
                if (key === '_fieldTimestamps' || key === 'id' || key === 'fechaActualizacion') continue;
                if (nota[key] !== value) fieldTimestamps[key] = ahora;
            }

            const actualizada = { ...nota, ...cambios, fechaActualizacion: ahora, _fieldTimestamps: fieldTimestamps };
            const putRequest = store.put(actualizada);

            putRequest.onsuccess = () => {
                if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
                resolve();
            };
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

async function eliminarNota(id) {
    // Registrar la eliminación antes de borrar localmente, así la sincronización
    // propaga el "borrado" a otros dispositivos y la nota no resucita.
    const nota = await new Promise((resolve) => {
        const tx = db.transaction(['notas'], 'readonly');
        const req = tx.objectStore('notas').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });

    if (nota) {
        try { await registrarEliminacion('nota', nota); } catch (e) { console.error('No se pudo registrar eliminación de nota:', e); }
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['notas'], 'readwrite');
        const store = transaction.objectStore('notas');
        const request = store.delete(id);

        request.onsuccess = () => {
            if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

// ==================== EVENTOS ====================

// ==================== PENDIENTES ====================
// Tareas por expediente. La fecha límite es opcional; cuando existe, el núcleo
// de acciones mantiene un evento de calendario vinculado (pendiente.eventoId).

async function agregarPendiente(pendiente) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pendientes'], 'readwrite');
        const store = transaction.objectStore('pendientes');

        const ahora = ahoraSync();
        pendiente.fechaCreacion = ahora;
        pendiente.fechaActualizacion = ahora;
        if (pendiente.completado === undefined) pendiente.completado = false;

        // Timestamps por campo para merge granular en sync, igual que notas y
        // eventos: dos dispositivos que editan campos distintos no se pisan.
        pendiente._fieldTimestamps = pendiente._fieldTimestamps || {};
        for (const key of Object.keys(pendiente)) {
            if (key === '_fieldTimestamps' || key === 'id') continue;
            pendiente._fieldTimestamps[key] = ahora;
        }

        const request = store.add(pendiente);
        request.onsuccess = () => {
            if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });
}

async function obtenerPendientes() {
    return new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains('pendientes')) { resolve([]); return; }
        const transaction = db.transaction(['pendientes'], 'readonly');
        const request = transaction.objectStore('pendientes').getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function obtenerPendientesPorExpediente(expedienteId) {
    return new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains('pendientes')) { resolve([]); return; }
        const transaction = db.transaction(['pendientes'], 'readonly');
        const index = transaction.objectStore('pendientes').index('expedienteId');
        const request = index.getAll(expedienteId);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function obtenerPendiente(id) {
    return new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains('pendientes')) { resolve(null); return; }
        const transaction = db.transaction(['pendientes'], 'readonly');
        const request = transaction.objectStore('pendientes').get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function actualizarPendiente(id, cambios) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pendientes'], 'readwrite');
        const store = transaction.objectStore('pendientes');
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const pendiente = getRequest.result;
            if (!pendiente) { reject(new Error('Pendiente no encontrado')); return; }

            const ahora = ahoraSync();
            const fieldTimestamps = { ...(pendiente._fieldTimestamps || {}) };
            for (const [key, value] of Object.entries(cambios)) {
                if (key === '_fieldTimestamps' || key === 'id' || key === 'fechaActualizacion') continue;
                if (pendiente[key] !== value) fieldTimestamps[key] = ahora;
            }

            const actualizado = { ...pendiente, ...cambios, fechaActualizacion: ahora, _fieldTimestamps: fieldTimestamps };
            const putRequest = store.put(actualizado);
            putRequest.onsuccess = () => {
                if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
                resolve(actualizado);
            };
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

async function eliminarPendiente(id) {
    // Se registra la eliminación antes de borrar para que la sincronización la
    // propague y el pendiente no reviva desde otro dispositivo.
    const pendiente = await obtenerPendiente(id);
    if (pendiente) {
        try { await registrarEliminacion('pendiente', pendiente); }
        catch (e) { console.error('Error registrando eliminación de pendiente:', e); }
    }
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pendientes'], 'readwrite');
        const request = transaction.objectStore('pendientes').delete(id);
        request.onsuccess = () => {
            if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
            resolve(pendiente);
        };
        request.onerror = () => reject(request.error);
    });
}

async function reemplazarPendientes(items) {
    if (!db.objectStoreNames.contains('pendientes')) return;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pendientes'], 'readwrite');
        const store = transaction.objectStore('pendientes');
        const clear = store.clear();
        clear.onsuccess = () => {
            for (const item of items || []) store.put(item);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

// ==================== EVENTOS ====================

async function agregarEvento(evento) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['eventos'], 'readwrite');
        const store = transaction.objectStore('eventos');

        const ahora = ahoraSync();
        evento.fechaCreacion = ahora;
        evento.fechaActualizacion = ahora;
        evento.alertaEnviada = false;

        // Timestamps por campo para merge granular en sync (ganador por campo).
        evento._fieldTimestamps = evento._fieldTimestamps || {};
        for (const key of Object.keys(evento)) {
            if (key === '_fieldTimestamps' || key === 'id') continue;
            evento._fieldTimestamps[key] = ahora;
        }

        const request = store.add(evento);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function obtenerEventos() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['eventos'], 'readonly');
        const store = transaction.objectStore('eventos');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function obtenerEventosPorFecha(fechaInicio, fechaFin) {
    const eventos = await obtenerEventos();
    return eventos.filter(e => {
        const fecha = new Date(e.fechaInicio);
        return fecha >= fechaInicio && fecha <= fechaFin;
    });
}

async function obtenerEvento(id) {
    return new Promise((resolve, reject) => {
        const request = db.transaction(['eventos'], 'readonly').objectStore('eventos').get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function actualizarEvento(id, cambios) {
    return new Promise(async (resolve, reject) => {
        const transaction = db.transaction(['eventos'], 'readwrite');
        const store = transaction.objectStore('eventos');
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const evento = getRequest.result;
            if (!evento) {
                reject(new Error('Evento no encontrado'));
                return;
            }

            const ahora = ahoraSync();
            // Timestamp por campo solo para los que cambiaron — así la sync
            // por campo deja el cambio más reciente de cada lado sin pisarse.
            const fieldTimestamps = { ...(evento._fieldTimestamps || {}) };
            for (const [key, value] of Object.entries(cambios)) {
                if (key === '_fieldTimestamps' || key === 'id' || key === 'fechaActualizacion' || key === 'alertaEnviada') continue;
                if (evento[key] !== value) fieldTimestamps[key] = ahora;
            }

            const actualizado = { ...evento, ...cambios, fechaActualizacion: ahora, _fieldTimestamps: fieldTimestamps };
            const putRequest = store.put(actualizado);

            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

async function eliminarEvento(id) {
    // Registrar la eliminación antes de borrar localmente, así la sincronización
    // propaga el "borrado" a otros dispositivos y el evento no resucita.
    const evento = await new Promise((resolve) => {
        const tx = db.transaction(['eventos'], 'readonly');
        const req = tx.objectStore('eventos').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });

    if (evento) {
        try { await registrarEliminacion('evento', evento); } catch (e) { console.error('No se pudo registrar eliminación de evento:', e); }
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['eventos'], 'readwrite');
        const store = transaction.objectStore('eventos');
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ==================== CONFIGURACIÓN ====================

async function guardarConfig(clave, valor) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['config'], 'readwrite');
        const store = transaction.objectStore('config');
        const request = store.put({ clave, valor });

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function obtenerConfig(clave) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['config'], 'readonly');
        const store = transaction.objectStore('config');
        const request = store.get(clave);

        request.onsuccess = () => resolve(request.result?.valor);
        request.onerror = () => reject(request.error);
    });
}

// ==================== EXPORTAR / IMPORTAR ====================

async function exportarTodosDatos() {
    // Activos Y archivados. Antes solo iban los activos (obtenerExpedientes
    // filtra el archivo): un respaldo restaurado perdía todos los asuntos
    // archivados, y sus notas y eventos quedaban sueltos, sin expediente.
    const activos = await obtenerExpedientes();
    const archivados = await obtenerExpedientesArchivados();
    const expedientes = [...activos, ...archivados];
    const notas = await obtenerNotas();
    const eventos = await obtenerEventos();
    const pendientes = await obtenerPendientes().catch(() => []);
    // Sin las carpetas, un respaldo pierde la agrupación por caso y los
    // carpetaId de los expedientes quedan apuntando a nada.
    const carpetas = typeof obtenerCarpetas === 'function'
        ? await obtenerCarpetas().catch(() => []) : [];

    // Búsquedas guardadas de las herramientas de marcas.
    const sigaGuardadas = await obtenerBusquedasGuardadas();

    // Lo demás que también se sincroniza: las cuentas del despacho (gastos y
    // cobros) y lo descartado del seguimiento semanal. Sin ellos, restaurar
    // en un dispositivo sin sincronización perdía las cuentas enteras.
    const opcional = async (fn) => (typeof fn === 'function' ? await fn().catch(() => []) : []);
    const cuentas = await opcional(typeof obtenerCuentasCompartidas === 'function' ? obtenerCuentasCompartidas : null);
    const seguimientoDescartados = await opcional(typeof obtenerSeguimientoDescartados === 'function' ? obtenerSeguimientoDescartados : null);
    const seguimientoOmitidos = await opcional(typeof obtenerSeguimientoOmitidos === 'function' ? obtenerSeguimientoOmitidos : null);

    return {
        version: 2,
        fechaExportacion: new Date().toISOString(),
        expedientes,
        carpetas,
        notas,
        eventos,
        pendientes,
        sigaGuardadas,
        cuentas,
        seguimientoDescartados,
        seguimientoOmitidos
    };
}

/** ¿Hay algo en este dispositivo que una importación con reemplazo borraría? */
async function hayDatosLocales() {
    for (const nombre of ['expedientes', 'notas', 'eventos', 'pendientes', 'carpetas']) {
        if ((await contarRegistrosStore(nombre).catch(() => 0)) > 0) return true;
    }
    return false;
}

/**
 * Devuelve a un registro recién importado las fechas que traía el respaldo.
 *
 * agregarExpediente y compañía sellan todo con la hora actual, que es lo
 * correcto al crear algo nuevo pero no al restaurar: un respaldo de hace un
 * mes quedaba marcado como "editado ahora" y, al sincronizar, ganaba campo a
 * campo contra lo que se había cambiado después en otro dispositivo. El
 * abogado veía volver la fecha de audiencia vieja.
 */
async function _restaurarSellos(storeName, id, original) {
    if (!original || id === undefined || id === null) return;
    const sellos = {};
    for (const campo of ['fechaCreacion', 'fechaActualizacion', '_fieldTimestamps']) {
        if (original[campo] !== undefined) sellos[campo] = original[campo];
    }
    if (!Object.keys(sellos).length) return;
    await new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.get(id);
        req.onsuccess = () => {
            if (req.result) {
                const registro = req.result;
                // Los sellos por campo del respaldo, más los de los campos que
                // se añadieron al importar (carpetaId traducido, etc.), que
                // conservan el de ahora.
                if (sellos._fieldTimestamps && typeof sellos._fieldTimestamps === 'object') {
                    sellos._fieldTimestamps = { ...(registro._fieldTimestamps || {}), ...sellos._fieldTimestamps };
                }
                store.put({ ...registro, ...sellos });
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** Una copia profunda de los sellos antes de que agregar* los sobrescriba. */
function _sellosDe(registro) {
    if (!registro) return null;
    return {
        fechaCreacion: registro.fechaCreacion,
        fechaActualizacion: registro.fechaActualizacion,
        _fieldTimestamps: registro._fieldTimestamps ? { ...registro._fieldTimestamps } : undefined
    };
}

/**
 * Importa un respaldo. Con sobrescribir, lo de este dispositivo se reemplaza;
 * si algo falla a medias (sin espacio, un registro dañado), se devuelve lo
 * que había antes en vez de dejar la base vacía o a medio llenar.
 */
async function importarTodosDatos(datos, sobrescribir = false) {
    if (!sobrescribir) return _importarTodosDatos(datos, false);

    const previo = await exportarTodosDatos();
    try {
        await _importarTodosDatos(datos, true);
    } catch (error) {
        console.error('La importación falló a medias; se restaura lo que había:', error);
        try {
            await _importarTodosDatos(previo, true);
        } catch (e2) {
            console.error('Tampoco se pudo restaurar lo anterior:', e2);
            error.message += ' (y no se pudo restaurar lo anterior: ' + e2.message + ')';
            throw error;
        }
        error.message += '. No se cambió nada: tus datos siguen como estaban.';
        throw error;
    }
}

async function _importarTodosDatos(datos, sobrescribir = false) {
    // Se trabaja sobre una copia: los bucles de abajo quitan ids y traducen
    // referencias, y si la importación falla hay que poder reintentar con el
    // respaldo intacto.
    datos = JSON.parse(JSON.stringify(datos || {}));
    if (sobrescribir) {
        // Limpiar stores
        await limpiarStore('expedientes');
        await limpiarStore('notas');
        await limpiarStore('eventos');
        if (db.objectStoreNames.contains('pendientes')) await limpiarStore('pendientes');
        if (db.objectStoreNames.contains('carpetas')) await limpiarStore('carpetas');
    }

    // Las carpetas van primero: los expedientes guardan carpetaId y hay que
    // poder traducirlo al id nuevo, igual que con expedienteId más abajo.
    const mapaCarpetas = new Map();
    const traeCarpetas = Array.isArray(datos.carpetas);
    if (traeCarpetas && typeof agregarCarpeta === 'function' && db.objectStoreNames.contains('carpetas')) {
        for (const carpeta of datos.carpetas || []) {
            const idOriginal = carpeta.id;
            delete carpeta.id;
            try {
                const sellos = _sellosDe(carpeta);
                const nuevoId = await agregarCarpeta(carpeta);
                await _restaurarSellos('carpetas', nuevoId, sellos);
                if (idOriginal !== undefined && idOriginal !== null) {
                    mapaCarpetas.set(idOriginal, nuevoId);
                }
            } catch (e) { /* una carpeta que falle no debe abortar el respaldo */ }
        }
    }

    // Al importar, cada expediente recibe un id nuevo: se descarta el del
    // respaldo y autoIncrement sigue su cuenta (clear() no la reinicia). Las
    // notas, eventos y pendientes guardan expedienteId, así que sin traducir
    // esas referencias quedan colgando del expediente equivocado o de
    // ninguno. Este mapa lleva id original → id nuevo.
    const mapaExpedientes = new Map();

    // Importar expedientes primero, para poder traducir lo que los referencia.
    for (const exp of datos.expedientes || []) {
        const idOriginal = exp.id;
        delete exp.id;
        // Solo se traduce si el respaldo traía carpetas. Un respaldo viejo no
        // las incluye: ahí no hay nada que traducir y anular el carpetaId
        // borraría una agrupación que puede seguir siendo válida.
        if (traeCarpetas && exp.carpetaId !== undefined && exp.carpetaId !== null) {
            exp.carpetaId = mapaCarpetas.has(exp.carpetaId) ? mapaCarpetas.get(exp.carpetaId) : null;
        }
        const sellos = _sellosDe(exp);
        const nuevoId = await agregarExpediente(exp);
        await _restaurarSellos('expedientes', nuevoId, sellos);
        if (idOriginal !== undefined && idOriginal !== null) {
            mapaExpedientes.set(idOriginal, nuevoId);
        }
    }

    // Traduce expedienteId. Si el expediente no venía en el respaldo, el
    // registro queda como general en vez de apuntar a uno ajeno.
    const remapearExpediente = (registro) => {
        if (registro.expedienteId === undefined || registro.expedienteId === null) return registro;
        registro.expedienteId = mapaExpedientes.has(registro.expedienteId)
            ? mapaExpedientes.get(registro.expedienteId)
            : null;
        return registro;
    };

    // Importar notas
    for (const nota of datos.notas || []) {
        delete nota.id;
        const sellos = _sellosDe(nota);
        const nuevoId = await agregarNota(remapearExpediente(nota));
        await _restaurarSellos('notas', nuevoId, sellos);
    }

    // Importar eventos. Cada uno recibe un id nuevo, así que se anota la
    // traducción: los pendientes con fecha apuntan al suyo y hay que poder
    // rehacer ese vínculo con los ids de aquí.
    const mapaEventos = new Map();
    for (const evento of datos.eventos || []) {
        const idOriginal = evento.id;
        delete evento.id;
        // El pendiente al que espeja aún no existe; se reengancha más abajo.
        delete evento.pendienteId;
        const sellos = _sellosDe(evento);
        const nuevoId = await agregarEvento(remapearExpediente(evento));
        await _restaurarSellos('eventos', nuevoId, sellos);
        if (idOriginal !== undefined && idOriginal !== null) {
            mapaEventos.set(idOriginal, nuevoId);
        }
    }

    // Importar pendientes. Un pendiente con fecha lleva un evento espejo en el
    // calendario; ese vínculo se traduce a los ids nuevos en vez de tirarlo.
    // Tirándolo, el respaldo se restauraba a medias: el evento quedaba suelto
    // en el calendario y el pendiente, sin nada agendado, hasta que alguien lo
    // editara a mano.
    for (const pendiente of datos.pendientes || []) {
        delete pendiente.id;
        const eventoOriginal = pendiente.eventoId;
        pendiente.eventoId = mapaEventos.has(eventoOriginal)
            ? mapaEventos.get(eventoOriginal)
            : null;
        const sellos = _sellosDe(pendiente);
        const nuevoId = await agregarPendiente(remapearExpediente(pendiente));
        await _restaurarSellos('pendientes', nuevoId, sellos);
        if (pendiente.eventoId != null) {
            await actualizarEvento(pendiente.eventoId, { pendienteId: nuevoId }).catch(() => {});
        }
    }

    // Importar búsquedas guardadas SIGA
    if (datos.sigaGuardadas && datos.sigaGuardadas.length > 0) {
        try {
            if (db.objectStoreNames.contains('sigaGuardadas')) {
                if (sobrescribir) {
                    await limpiarStore('sigaGuardadas');
                }
                for (const saved of datos.sigaGuardadas) {
                    delete saved.id;
                    await new Promise((resolve, reject) => {
                        const tx = db.transaction(['sigaGuardadas'], 'readwrite');
                        const store = tx.objectStore('sigaGuardadas');
                        const req = store.add(saved);
                        req.onsuccess = () => resolve();
                        req.onerror = () => resolve(); // skip duplicates
                    });
                }
            }
        } catch (e) { /* store may not exist */ }
    }

    // Cuentas del despacho y seguimiento: se juntan con lo que haya, igual
    // que al sincronizar, así que importar dos veces no duplica nada.
    const juntar = async (fn, lista) => {
        if (typeof fn === 'function' && Array.isArray(lista) && lista.length) await fn(lista);
    };
    await juntar(typeof aplicarCuentasCompartidas === 'function' ? aplicarCuentasCompartidas : null, datos.cuentas);
    await juntar(typeof aplicarSeguimientoDescartados === 'function' ? aplicarSeguimientoDescartados : null, datos.seguimientoDescartados);
    await juntar(typeof aplicarSeguimientoOmitidos === 'function' ? aplicarSeguimientoOmitidos : null, datos.seguimientoOmitidos);
}

async function limpiarStore(storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Búsquedas guardadas de las herramientas de marcas (IMPI, SIGA, Marcanet).
 * El store puede no existir en bases antiguas, así que se comprueba antes.
 */
async function obtenerBusquedasGuardadas() {
    if (!db || !db.objectStoreNames.contains('sigaGuardadas')) return [];
    return new Promise(resolve => {
        try {
            const request = db.transaction(['sigaGuardadas'], 'readonly')
                .objectStore('sigaGuardadas').getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        } catch (e) {
            resolve([]);
        }
    });
}

// Claves de localStorage que dejan de tener sentido cuando ya no hay datos:
// apuntan a eventos, búsquedas o sincronizaciones que acaban de desaparecer.
// NO se tocan las de la licencia (_tsjp, _tsjprem, _tsjdid…) ni las
// preferencias de la interfaz: borrar todo el contenido no es cerrar sesión ni
// reconfigurar la aplicación.
const CLAVES_LOCALES_A_LIMPIAR = [
    'recordatorios_enviados',
    'ultima_verificacion_recordatorios',
    'siga_last_auto_check',
    'sync_pendiente',
    'sync_last_sync'
];

/**
 * Borra TODO el contenido del usuario: expedientes, notas, eventos,
 * pendientes, carpetas, historial, búsquedas guardadas del IMPI y ajustes.
 *
 * Los stores se recorren desde la propia base y no desde una lista escrita a
 * mano: esa lista es justo lo que falló antes, porque se fueron añadiendo
 * stores (pendientes, carpetas, sigaGuardadas…) y aquí seguían borrándose
 * solo cuatro, así que los pendientes y las búsquedas del IMPI sobrevivían al
 * "eliminar todo".
 *
 * @returns {Promise<string[]>} nombres de los stores vaciados.
 */
async function eliminarTodosLosDatos() {
    const stores = Array.from(db.objectStoreNames);

    for (const store of stores) {
        await limpiarStore(store);
    }

    for (const clave of CLAVES_LOCALES_A_LIMPIAR) {
        try { localStorage.removeItem(clave); } catch (e) { /* modo privado */ }
    }

    if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
    return stores;
}

// ==================== ESTADÍSTICAS ====================

async function obtenerEstadisticas() {
    const expedientes = await obtenerExpedientes();
    const notas = await obtenerNotas();
    const eventos = await obtenerEventos();

    const ahora = new Date();
    const enUnaSemana = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);

    const eventosProximos = eventos.filter(e => {
        const fecha = new Date(e.fechaInicio);
        return fecha >= ahora && fecha <= enUnaSemana;
    });

    const eventosConAlerta = eventos.filter(e => {
        if (!e.alerta || e.alertaEnviada) return false;
        const fecha = new Date(e.fechaInicio);
        return fecha >= ahora;
    });

    return {
        expedientes: expedientes.length,
        notas: notas.length,
        eventos: eventosProximos.length,
        alertas: eventosConAlerta.length
    };
}

// ==================== HISTORIAL DE CAMBIOS ====================

async function agregarHistorial(registro) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['historial'], 'readwrite');
        const store = transaction.objectStore('historial');

        registro.fecha = new Date().toISOString();

        const request = store.add(registro);

        request.onsuccess = () => {
            if (typeof invalidarIndiceBusqueda === 'function') invalidarIndiceBusqueda();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });
}

async function obtenerHistorialExpediente(expedienteId) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['historial'], 'readonly');
        const store = transaction.objectStore('historial');
        const index = store.index('expedienteId');
        const request = index.getAll(expedienteId);

        request.onsuccess = () => {
            // Ordenar por fecha descendente (más reciente primero)
            const historial = request.result.sort((a, b) =>
                new Date(b.fecha) - new Date(a.fecha)
            );
            resolve(historial);
        };
        request.onerror = () => reject(request.error);
    });
}

async function obtenerTodoHistorial() {
    return new Promise((resolve) => {
        // Tolerante a DBs antiguas sin el store 'historial'
        try {
            if (!db.objectStoreNames.contains('historial')) return resolve([]);
            const transaction = db.transaction(['historial'], 'readonly');
            const store = transaction.objectStore('historial');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        } catch (e) {
            resolve([]);
        }
    });
}

async function registrarCambioExpediente(expedienteId, tipo, cambiosAnteriores, cambiosNuevos, descripcion = '') {
    const registro = {
        expedienteId,
        tipo, // 'creacion', 'edicion', 'eliminacion'
        cambiosAnteriores,
        cambiosNuevos,
        descripcion
    };

    return agregarHistorial(registro);
}

// ==================== SIGA: BÚSQUEDAS GUARDADAS ====================
// Helpers usados por la sincronización para incluir las búsquedas SIGA
// guardadas en el blob remoto. El store puede no existir en DBs antiguas,
// así que toda la familia tolera ausencia silenciosa.

async function obtenerBusquedasSIGA() {
    return new Promise((resolve) => {
        try {
            if (!db.objectStoreNames.contains('sigaGuardadas')) return resolve([]);
            const tx = db.transaction(['sigaGuardadas'], 'readonly');
            const req = tx.objectStore('sigaGuardadas').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch (e) {
            resolve([]);
        }
    });
}

async function reemplazarBusquedasSIGA(items) {
    if (!Array.isArray(items)) return;
    return new Promise((resolve) => {
        try {
            if (!db.objectStoreNames.contains('sigaGuardadas')) return resolve();
            const tx = db.transaction(['sigaGuardadas'], 'readwrite');
            const store = tx.objectStore('sigaGuardadas');
            const clearReq = store.clear();
            clearReq.onsuccess = () => {
                for (const item of items) {
                    // Mantener el ID si viene; si no, autoIncrement le pondrá uno.
                    try { store.put(item); } catch (e) {}
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        } catch (e) {
            resolve();
        }
    });
}

async function reemplazarHistorial(items) {
    if (!Array.isArray(items)) return;
    return new Promise((resolve) => {
        try {
            if (!db.objectStoreNames.contains('historial')) return resolve();
            const tx = db.transaction(['historial'], 'readwrite');
            const store = tx.objectStore('historial');
            const clearReq = store.clear();
            clearReq.onsuccess = () => {
                for (const item of items) {
                    try { store.put(item); } catch (e) {}
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        } catch (e) {
            resolve();
        }
    });
}
