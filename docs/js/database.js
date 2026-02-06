/**
 * Base de Datos Local usando IndexedDB
 * Almacena todos los datos en el navegador del usuario
 */

const DB_NAME = 'TSJFilingDB';
const DB_VERSION = 3; // Incrementado para agregar store de eliminados

let db = null;

// Inicializar base de datos
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Error al abrir IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
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

            console.log('Stores de IndexedDB creados');
        };
    });
}

// ==================== EXPEDIENTES ====================

async function agregarExpediente(expediente) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['expedientes'], 'readwrite');
        const store = transaction.objectStore('expedientes');

        expediente.fechaCreacion = new Date().toISOString();
        expediente.fechaActualizacion = new Date().toISOString();
        expediente.activo = true;

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
            const expedientes = request.result.filter(e => e.activo !== false);
            resolve(expedientes);
        };
        request.onerror = () => reject(request.error);
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
            if (expediente[key] !== value && key !== 'fechaActualizacion' && key !== 'orden') {
                valoresAnteriores[key] = expediente[key];
                camposModificados[key] = value;
            }
        }

        const actualizado = { ...expediente, ...cambios, fechaActualizacion: new Date().toISOString() };

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

        // Generar clave única basada en contenido (no ID, porque cambia entre dispositivos)
        let clave;
        if (tipo === 'expediente') {
            const numero = (registro.numero || '').trim().toLowerCase();
            const nombre = (registro.nombre || '').trim().toLowerCase();
            const juzgado = (registro.juzgado || '').trim().toLowerCase();
            clave = `exp|${numero}|${nombre}|${juzgado}`;
        } else if (tipo === 'nota') {
            clave = `nota|${registro.expedienteId}|${(registro.contenido || '').substring(0, 50)}`;
        } else if (tipo === 'evento') {
            clave = `evento|${registro.expedienteId}|${registro.titulo}|${registro.fecha || registro.fechaInicio}`;
        }

        const eliminado = {
            clave,
            tipo,
            fecha: new Date().toISOString(),
            datos: {
                numero: registro.numero,
                nombre: registro.nombre,
                juzgado: registro.juzgado
            }
        };

        const request = store.put(eliminado);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
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

// ==================== DETECCIÓN Y ELIMINACIÓN DE DUPLICADOS ====================

async function eliminarExpedientesDuplicados() {
    const expedientes = await obtenerExpedientes();
    const duplicadosAEliminar = [];
    const expedientesPorClave = new Map();

    // Agrupar expedientes por clave (número/nombre + juzgado + categoría)
    for (const exp of expedientes) {
        const identificador = (exp.numero || exp.nombre || '').toLowerCase().trim();
        const juzgado = (exp.juzgado || '').toLowerCase().trim();
        const categoria = (exp.categoria || 'general').toLowerCase().trim();
        const clave = `${identificador}|${juzgado}|${categoria}`;

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
                duplicadosAEliminar.push(grupo[i].id);
            }
        }
    }

    // Eliminar duplicados
    for (const id of duplicadosAEliminar) {
        await eliminarExpediente(id, true);
    }

    return duplicadosAEliminar.length;
}

// ==================== NOTAS ====================

async function agregarNota(nota) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['notas'], 'readwrite');
        const store = transaction.objectStore('notas');

        nota.fechaCreacion = new Date().toISOString();
        nota.fechaActualizacion = new Date().toISOString();

        const request = store.add(nota);

        request.onsuccess = () => resolve(request.result);
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

            const actualizada = { ...nota, ...cambios, fechaActualizacion: new Date().toISOString() };
            const putRequest = store.put(actualizada);

            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

async function eliminarNota(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['notas'], 'readwrite');
        const store = transaction.objectStore('notas');
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ==================== EVENTOS ====================

async function agregarEvento(evento) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['eventos'], 'readwrite');
        const store = transaction.objectStore('eventos');

        evento.fechaCreacion = new Date().toISOString();
        evento.alertaEnviada = false;

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

            const actualizado = { ...evento, ...cambios };
            const putRequest = store.put(actualizado);

            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

async function eliminarEvento(id) {
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
    const expedientes = await obtenerExpedientes();
    const notas = await obtenerNotas();
    const eventos = await obtenerEventos();

    return {
        version: 1,
        fechaExportacion: new Date().toISOString(),
        expedientes,
        notas,
        eventos
    };
}

async function importarTodosDatos(datos, sobrescribir = false) {
    if (sobrescribir) {
        // Limpiar stores
        await limpiarStore('expedientes');
        await limpiarStore('notas');
        await limpiarStore('eventos');
    }

    // Importar expedientes
    for (const exp of datos.expedientes || []) {
        delete exp.id;
        await agregarExpediente(exp);
    }

    // Importar notas
    for (const nota of datos.notas || []) {
        delete nota.id;
        await agregarNota(nota);
    }

    // Importar eventos
    for (const evento of datos.eventos || []) {
        delete evento.id;
        await agregarEvento(evento);
    }
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

async function eliminarTodosLosDatos() {
    await limpiarStore('expedientes');
    await limpiarStore('notas');
    await limpiarStore('eventos');
    await limpiarStore('config');
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

    const eventosConAlerta = eventos.filter(e => e.alerta && !e.alertaEnviada);

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

        request.onsuccess = () => resolve(request.result);
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
