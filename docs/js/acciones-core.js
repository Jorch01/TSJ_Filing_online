/**
 * Núcleo de Acciones – TSJ Filing Online
 *
 * Capa única de lógica de negocio para crear/editar/eliminar eventos,
 * expedientes y notas. La usan TANTO los formularios de la app (app.js)
 * como el Asistente de Voz (voice-assistant.js), de modo que ambos
 * caminos guardan siempre con las mismas reglas (colores, categorías,
 * refresco de UI, sincronización entre dispositivos y Google Calendar).
 *
 * Los formularios siguen siendo responsables de leer el DOM y validar;
 * este núcleo recibe objetos de datos ya construidos.
 *
 * Todas las referencias a funciones de otras capas (cargarEventos,
 * marcarYSincronizar, GCAL, obtenerCategoriaJuzgado…) se resuelven en
 * tiempo de ejecución con guardas typeof, así el orden de carga de
 * scripts no importa.
 */

// Colores por tipo de evento (fuente única; app.js los reutiliza)
const CORE_COLORES_EVENTOS = {
    audiencia: '#3788d8',
    vencimiento: '#dc3545',
    recordatorio: '#ffc107',
    otro: '#6c757d'
};

// ==================== HELPERS INTERNOS ====================

// Una operación puede componer varias (un pendiente con fecha crea además su
// evento). Mientras dure el lote, el refresco de UI y la sincronización se
// omiten para hacerlos una sola vez al final: si no, cada paso intermedio
// dispara su propia subida a la nube y su propio repintado.
let _coreEnLote = 0;

async function _coreEnLoteEjecutar(fn) {
    _coreEnLote++;
    try {
        return await fn();
    } finally {
        _coreEnLote--;
    }
}

async function _coreRefrescarUI() {
    if (_coreEnLote > 0) return;
    try {
        // Los pendientes van primero: la tarjeta del expediente muestra
        // cuántos tiene por hacer, así que su caché debe estar al día antes
        // de repintar los expedientes.
        if (typeof cargarPendientes === 'function') await cargarPendientes();
        if (typeof cargarExpedientes === 'function') await cargarExpedientes();
        if (typeof cargarEventos === 'function') await cargarEventos();
        if (typeof cargarNotas === 'function') await cargarNotas();
        if (typeof cargarEstadisticas === 'function') await cargarEstadisticas();
        if (typeof renderizarCalendario === 'function') renderizarCalendario();
    } catch (e) {
        console.error('[CORE] Error refrescando UI:', e);
    }
}

async function _coreSincronizar() {
    if (_coreEnLote > 0) return;
    try {
        if (typeof marcarYSincronizar === 'function') await marcarYSincronizar();
    } catch (e) {
        console.error('[CORE] Error al sincronizar:', e);
    }
}

async function _coreGcalGuardar(eventoId) {
    try {
        if (typeof GCAL !== 'undefined' && GCAL.estaConectado && GCAL.estaConectado()) {
            const ev = (await obtenerEventos()).find(e => e.id === eventoId);
            if (ev) GCAL.hookGuardarEvento(ev);
        }
    } catch (e) {
        console.error('[CORE] Error sincronizando con Google Calendar:', e);
    }
}

// ==================== EVENTOS ====================

/**
 * Crea un evento. Espera: { titulo, tipo, fechaInicio(ISO), todoElDia,
 * expedienteId, expedienteTexto, descripcion, alerta, color }.
 * Rellena color (según tipo) y alerta si no vienen. Devuelve el id nuevo.
 */
async function crearEventoCore(datos) {
    if (!datos || !datos.titulo || !datos.fechaInicio) {
        throw new Error('El evento requiere título y fecha');
    }
    const tipo = CORE_COLORES_EVENTOS[datos.tipo] ? datos.tipo : 'otro';
    const evento = {
        titulo: datos.titulo,
        tipo,
        fechaInicio: datos.fechaInicio,
        todoElDia: !!datos.todoElDia,
        expedienteId: datos.expedienteId != null ? parseInt(datos.expedienteId) : null,
        expedienteTexto: datos.expedienteTexto || null,
        descripcion: datos.descripcion || '',
        alerta: datos.alerta !== false,
        color: datos.color || CORE_COLORES_EVENTOS[tipo]
    };
    const nuevoId = await agregarEvento(evento);
    await _coreRefrescarUI();
    await _coreSincronizar();
    await _coreGcalGuardar(nuevoId);
    return nuevoId;
}

/** Actualiza un evento. Ajusta el color si cambia el tipo y no se indicó color. */
async function actualizarEventoCore(id, cambios) {
    const aplicar = { ...cambios };
    if (aplicar.tipo && !aplicar.color && CORE_COLORES_EVENTOS[aplicar.tipo]) {
        aplicar.color = CORE_COLORES_EVENTOS[aplicar.tipo];
    }
    await actualizarEvento(id, aplicar);
    await _coreRefrescarUI();
    await _coreSincronizar();
    await _coreGcalGuardar(id);
}

/** Elimina un evento (incluida su copia en Google Calendar si aplica). */
async function eliminarEventoCore(id) {
    const evento = (await obtenerEventos()).find(e => e.id === id);
    if (!evento) throw new Error('Evento no encontrado');
    await eliminarEvento(id);
    try {
        if (typeof GCAL !== 'undefined' && GCAL.estaConectado && GCAL.estaConectado() &&
            evento.googleCalEventId && GCAL.hookEliminarEvento) {
            GCAL.hookEliminarEvento(evento.googleCalEventId);
        }
    } catch (e) {
        console.error('[CORE] Error eliminando en Google Calendar:', e);
    }
    await _coreRefrescarUI();
    await _coreSincronizar();
    return evento;
}

// ==================== EXPEDIENTES ====================

/** Calcula la categoría según institución y juzgado (regla única). */
function categoriaExpedienteCore(institucion, juzgado) {
    if (institucion === 'PJF') return 'PJF Federal';
    if (institucion === 'OTRO') return 'Otros/Varios';
    return typeof obtenerCategoriaJuzgado === 'function' ? obtenerCategoriaJuzgado(juzgado) : 'OTROS';
}

/**
 * Crea un expediente. Espera: { numero | nombre, institucion, juzgado,
 * comentario?, carpetaId?, pjfOrgId?, pjfTipoAsunto? }. Calcula la
 * categoría si no viene. Devuelve el id nuevo.
 * NOTA: el límite de expedientes del plan lo valida cada llamador
 * (verificarLimiteExpedientes) porque implica UI propia.
 */
async function crearExpedienteCore(datos) {
    if (!datos || (!datos.numero && !datos.nombre)) {
        throw new Error('El expediente requiere número o nombre');
    }
    const institucion = ['TSJ', 'PJF', 'OTRO'].includes(datos.institucion) ? datos.institucion : 'TSJ';
    const expediente = {
        ...datos,
        institucion,
        categoria: datos.categoria || categoriaExpedienteCore(institucion, datos.juzgado)
    };
    const nuevoId = await agregarExpediente(expediente);
    await _coreRefrescarUI();
    await _coreSincronizar();
    return nuevoId;
}

/**
 * Crea varios expedientes de una sola vez (carga masiva por CSV). Aplica las
 * mismas reglas que crearExpedienteCore a cada uno, pero refresca la UI y
 * sincroniza UNA sola vez al final: hacerlo por expediente convertiría una
 * importación de 200 filas en 200 subidas a la nube y 200 repintados.
 *
 * No corta al primer fallo —una fila mala no debe tirar el resto de la
 * importación—; devuelve { ids, fallos } para que el llamador informe.
 */
async function crearExpedientesEnLoteCore(lista) {
    const ids = [];
    const fallos = [];

    await _coreEnLoteEjecutar(async () => {
        for (const datos of lista || []) {
            try {
                ids.push(await crearExpedienteCore(datos));
            } catch (e) {
                fallos.push({ datos, error: e && e.message ? e.message : String(e) });
            }
        }
    });

    await _coreRefrescarUI();
    await _coreSincronizar();
    return { ids, fallos };
}

/** Actualiza un expediente. Recalcula la categoría si cambia el juzgado o la institución. */
async function actualizarExpedienteCore(id, cambios) {
    const aplicar = { ...cambios };
    if ((aplicar.juzgado || aplicar.institucion) && !aplicar.categoria) {
        const exp = await obtenerExpediente(id);
        if (!exp) throw new Error('Expediente no encontrado');
        aplicar.categoria = categoriaExpedienteCore(
            aplicar.institucion || exp.institucion || 'TSJ',
            aplicar.juzgado || exp.juzgado
        );
    }
    await actualizarExpediente(id, aplicar);
    await _coreRefrescarUI();
    await _coreSincronizar();
}

/** Archiva (archivado=true) o desarchiva (archivado=false) un expediente. */
async function archivarExpedienteCore(id, archivado, motivo, etiqueta) {
    await archivarExpedienteDB(id, archivado, motivo || 'concluido', etiqueta || '');
    await _coreRefrescarUI();
    await _coreSincronizar();
}

/**
 * Elimina un expediente (permanente=true borra definitivo y propaga a sync).
 * En el borrado permanente arrastra lo que colgaba de él —notas, eventos y
 * pendientes—, incluidas las copias en Google Calendar. Antes se quedaban
 * apuntando a un expediente inexistente: invisibles en la app pero vivos en la
 * base y en el calendario. El borrado suave no toca nada, porque es
 * reversible.
 */
async function eliminarExpedienteCore(id, permanente) {
    await _coreEnLoteEjecutar(async () => {
        if (permanente && typeof eliminarDependenciasDeExpediente === 'function') {
            await eliminarDependenciasDeExpediente(id);
        }
        await eliminarExpediente(id, !!permanente);
    });

    await _coreRefrescarUI();
    await _coreSincronizar();
}

// ==================== NOTAS ====================

/**
 * Crea una nota. Espera: { titulo, contenido?, expedienteId?,
 * expedienteTexto?, color?, recordatorio? }. Devuelve el id nuevo.
 */
async function crearNotaCore(datos) {
    if (!datos || !datos.titulo) throw new Error('La nota requiere título');
    const nota = {
        expedienteId: datos.expedienteId != null ? parseInt(datos.expedienteId) : null,
        expedienteTexto: datos.expedienteTexto || null,
        titulo: datos.titulo,
        contenido: datos.contenido || '',
        color: datos.color || '#fff3cd',
        recordatorio: datos.recordatorio || null
    };
    const nuevoId = await agregarNota(nota);
    await _coreRefrescarUI();
    await _coreSincronizar();
    return nuevoId;
}

/** Actualiza una nota. */
async function actualizarNotaCore(id, cambios) {
    await actualizarNota(id, cambios);
    await _coreRefrescarUI();
    await _coreSincronizar();
}

/** Elimina una nota. */
async function eliminarNotaCore(id) {
    await eliminarNota(id);
    await _coreRefrescarUI();
    await _coreSincronizar();
}

// ==================== PENDIENTES ====================
// Un pendiente es una tarea de un expediente. La fecha límite es opcional;
// cuando existe, se mantiene un evento de calendario vinculado para que el
// pendiente aparezca en el calendario, dispare alerta y viaje a Google
// Calendar sin duplicar esa maquinaria. El vínculo va en pendiente.eventoId,
// y el evento lleva pendienteId de vuelta.

/** Tipo de evento con el que se refleja un pendiente en el calendario. */
const CORE_TIPO_EVENTO_PENDIENTE = 'recordatorio';

// Prioridades válidas, de más a menos urgente. Cualquier otro valor (incluida
// la cadena vacía) significa "sin asignar", que es un estado legítimo: no todo
// pendiente merece que se decida su urgencia.
const CORE_PRIORIDADES_PENDIENTE = ['alta', 'media', 'baja'];

function normalizarPrioridadCore(valor) {
    return CORE_PRIORIDADES_PENDIENTE.includes(valor) ? valor : '';
}

function _corePendienteDescripcionEvento(datos) {
    const base = 'Pendiente del expediente.';
    return datos.descripcion ? base + '\n\n' + datos.descripcion : base;
}

/**
 * Crea, actualiza o elimina el evento de calendario que refleja un pendiente,
 * según tenga o no fecha límite. Devuelve el eventoId resultante (o null).
 * Nunca propaga errores: que falle el calendario no debe impedir guardar el
 * pendiente, que es lo que el usuario pidió.
 */
async function _corePendienteSincronizarEvento(pendiente, eventoIdActual) {
    const debeExistir = !!pendiente.fechaLimite && !pendiente.completado;

    try {
        if (!debeExistir) {
            if (eventoIdActual) await eliminarEventoCore(eventoIdActual).catch(() => {});
            return null;
        }

        const datosEvento = {
            titulo: pendiente.titulo,
            tipo: CORE_TIPO_EVENTO_PENDIENTE,
            fechaInicio: pendiente.fechaLimite,
            todoElDia: !!pendiente.todoElDia,
            expedienteId: pendiente.expedienteId != null ? pendiente.expedienteId : null,
            expedienteTexto: pendiente.expedienteTexto || null,
            descripcion: _corePendienteDescripcionEvento(pendiente),
            alerta: true
        };

        if (eventoIdActual) {
            // El evento pudo haberse borrado desde el calendario: si ya no
            // está, se crea uno nuevo en vez de fallar.
            const existe = (await obtenerEventos()).some(e => e.id === eventoIdActual);
            if (existe) {
                await actualizarEventoCore(eventoIdActual, datosEvento);
                return eventoIdActual;
            }
        }

        return await crearEventoCore(datosEvento);
    } catch (e) {
        console.error('[CORE] Error sincronizando el evento del pendiente:', e);
        return eventoIdActual || null;
    }
}

/**
 * Crea un pendiente. Espera: { titulo, descripcion?, expedienteId?,
 * expedienteTexto?, fechaLimite?(ISO), todoElDia? }. Devuelve el id nuevo.
 */
async function crearPendienteCore(datos) {
    if (!datos || !datos.titulo || !datos.titulo.trim()) {
        throw new Error('El pendiente requiere un título');
    }

    const pendiente = {
        titulo: datos.titulo.trim(),
        descripcion: datos.descripcion || '',
        expedienteId: datos.expedienteId != null && datos.expedienteId !== '' ? parseInt(datos.expedienteId) : null,
        expedienteTexto: datos.expedienteTexto || null,
        fechaLimite: datos.fechaLimite || null,
        todoElDia: datos.todoElDia !== false,
        prioridad: normalizarPrioridadCore(datos.prioridad),
        completado: false,
        fechaCompletado: null,
        eventoId: null
    };

    const nuevoId = await _coreEnLoteEjecutar(async () => {
        const id = await agregarPendiente(pendiente);
        const eventoId = await _corePendienteSincronizarEvento(pendiente, null);
        if (eventoId) {
            await actualizarPendiente(id, { eventoId });
            await actualizarEvento(eventoId, { pendienteId: id }).catch(() => {});
        }
        return id;
    });

    await _coreRefrescarUI();
    await _coreSincronizar();
    return nuevoId;
}

/** Actualiza un pendiente y reajusta su evento de calendario. */
async function actualizarPendienteCore(id, cambios) {
    const actual = await obtenerPendiente(id);
    if (!actual) throw new Error('Pendiente no encontrado');

    const aplicar = { ...cambios };
    if (aplicar.titulo !== undefined) aplicar.titulo = String(aplicar.titulo).trim();
    if (aplicar.prioridad !== undefined) aplicar.prioridad = normalizarPrioridadCore(aplicar.prioridad);
    if (aplicar.expedienteId !== undefined) {
        aplicar.expedienteId = aplicar.expedienteId != null && aplicar.expedienteId !== ''
            ? parseInt(aplicar.expedienteId) : null;
    }

    await _coreEnLoteEjecutar(async () => {
        const actualizado = await actualizarPendiente(id, aplicar);
        const eventoId = await _corePendienteSincronizarEvento(actualizado, actual.eventoId || null);
        if (eventoId !== (actual.eventoId || null)) {
            await actualizarPendiente(id, { eventoId });
            if (eventoId) await actualizarEvento(eventoId, { pendienteId: id }).catch(() => {});
        }
    });

    await _coreRefrescarUI();
    await _coreSincronizar();
}

/**
 * Marca un pendiente como terminado (o lo reabre). Al terminarlo se retira su
 * evento del calendario; al reabrirlo se vuelve a crear si conserva fecha.
 */
async function completarPendienteCore(id, completado = true) {
    const actual = await obtenerPendiente(id);
    if (!actual) throw new Error('Pendiente no encontrado');

    await _coreEnLoteEjecutar(async () => {
        const actualizado = await actualizarPendiente(id, {
            completado: !!completado,
            fechaCompletado: completado ? new Date().toISOString() : null
        });
        const eventoId = await _corePendienteSincronizarEvento(actualizado, actual.eventoId || null);
        if (eventoId !== (actual.eventoId || null)) {
            await actualizarPendiente(id, { eventoId });
            if (eventoId) await actualizarEvento(eventoId, { pendienteId: id }).catch(() => {});
        }
    });

    await _coreRefrescarUI();
    await _coreSincronizar();
}

/** Elimina un pendiente y, con él, su evento de calendario. */
async function eliminarPendienteCore(id) {
    const actual = await obtenerPendiente(id);
    if (!actual) throw new Error('Pendiente no encontrado');

    await _coreEnLoteEjecutar(async () => {
        if (actual.eventoId) await eliminarEventoCore(actual.eventoId).catch(() => {});
        await eliminarPendiente(id);
    });

    await _coreRefrescarUI();
    await _coreSincronizar();
    return actual;
}

// ==================== RESOLUCIÓN DE REFERENCIAS A EXPEDIENTES ====================
// Cuando el usuario menciona un expediente —dictado o escrito— casi nunca da el
// dato exacto: dice "el 123", "lo de Ramírez", "el del juzgado segundo". Esto
// convierte esa referencia en candidatos reales, ordenados por qué tan bien
// encajan, para poder ofrecer opciones en vez de adivinar una.

function _normRef(texto) {
    return String(texto || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().trim();
}

// Al dictar, la diagonal se pronuncia. También se cuelan muletillas que no
// existen en ningún expediente y que, exigidas como palabra, matan la búsqueda.
const _PALABRAS_RUIDO = new Set([
    'el', 'la', 'los', 'las', 'del', 'de', 'lo', 'un', 'una', 'mi', 'mis',
    'expediente', 'expedientes', 'asunto', 'caso', 'juicio', 'numero', 'num',
    'que', 'con', 'para', 'por', 'sobre', 'al', 'y'
]);

function _limpiarReferencia(texto) {
    let t = _normRef(texto)
        .replace(/\b(diagonal|barra|slash)\b/g, '/')
        .replace(/\b(guion|guion medio)\b/g, '-')
        .replace(/\s*\/\s*/g, '/')
        .replace(/\s+/g, ' ')
        .trim();
    return t;
}

function _tokensUtiles(texto) {
    return _limpiarReferencia(texto)
        .split(/[\s,;]+/)
        .filter(t => t && !_PALABRAS_RUIDO.has(t));
}

// "0123/2025" y "123/2025" son el mismo expediente dictado de dos formas.
function _numeroComparable(numero) {
    const n = _normRef(numero).replace(/\s+/g, '');
    const m = n.match(/^0*(\d+)\s*\/\s*(\d{2,4})$/);
    if (m) return m[1] + '/' + m[2];
    return n.replace(/^0+/, '');
}

// Todo el texto por el que un expediente puede ser reconocido.
function _blobExpediente(exp, nombreCarpeta) {
    return _normRef([
        exp.numero, exp.nombre, exp.juzgado, exp.categoria, exp.comentario,
        exp.actor, exp.demandado, exp.institucion, nombreCarpeta
    ].filter(Boolean).join(' '));
}

/**
 * Busca expedientes que encajen con una referencia libre.
 * Devuelve [{ expediente, puntaje, motivo, archivado }] de mayor a menor.
 * opciones.incluirArchivados (por omisión true): los archivados también se
 * ofrecen, marcados — decir "no lo encuentro" cuando existe archivado es peor
 * que ofrecerlo con su etiqueta.
 */
async function buscarExpedientesPorReferencia(referencia, opciones = {}) {
    const ref = _limpiarReferencia(referencia);
    if (!ref) return [];

    const incluirArchivados = opciones.incluirArchivados !== false;
    const activos = await obtenerExpedientes().catch(() => []);
    const archivados = incluirArchivados
        ? await (typeof obtenerExpedientesArchivados === 'function'
            ? obtenerExpedientesArchivados().catch(() => []) : Promise.resolve([]))
        : [];

    let carpetas = [];
    try {
        if (typeof obtenerCarpetas === 'function') carpetas = await obtenerCarpetas();
    } catch (e) { /* sin carpetas */ }
    const nombreCarpeta = (id) => (carpetas.find(c => c.id === id) || {}).nombre || '';

    const tokens = _tokensUtiles(referencia);
    const soloDigitos = ref.replace(/[^\d]/g, '');
    const refNum = _numeroComparable(ref);

    const candidatos = [];
    const evaluar = (exp, archivado) => {
        const numero = _normRef(exp.numero);
        const numeroCmp = _numeroComparable(exp.numero);
        const nombre = _normRef(exp.nombre);
        const blob = _blobExpediente(exp, nombreCarpeta(exp.carpetaId));

        let puntaje = 0;
        let motivo = '';

        if (numero && numeroCmp === refNum) { puntaje = 100; motivo = 'número exacto'; }
        else if (numero && numero === ref) { puntaje = 100; motivo = 'número exacto'; }
        else if (nombre && nombre === ref) { puntaje = 95; motivo = 'nombre exacto'; }
        else if (numero && numeroCmp.startsWith(refNum) && refNum) { puntaje = 80; motivo = 'el número empieza así'; }
        else if (numero && soloDigitos && numeroCmp.split('/')[0] === soloDigitos.replace(/^0+/, '')) {
            // "el 123" cuando el expediente es 123/2025: el año no se dijo.
            puntaje = 85; motivo = 'coincide el número, sin el año';
        }
        else if (numero && ref && numero.includes(ref)) { puntaje = 70; motivo = 'el número lo contiene'; }
        else if (nombre && ref && nombre.startsWith(ref)) { puntaje = 75; motivo = 'el nombre empieza así'; }
        else if (nombre && ref && nombre.includes(ref)) { puntaje = 60; motivo = 'aparece en el nombre'; }
        else if (tokens.length && tokens.every(t => blob.includes(t))) {
            // Todas las palabras útiles aparecen en algún dato del expediente.
            puntaje = 50; motivo = 'coincide con sus datos';
        }
        else if (tokens.length > 1) {
            const encontrados = tokens.filter(t => blob.includes(t)).length;
            if (encontrados > 0) {
                puntaje = 20 + Math.round((encontrados / tokens.length) * 20);
                motivo = 'coincidencia parcial';
            }
        }

        if (puntaje <= 0) return;
        // Entre dos igual de buenos, el archivado va después.
        if (archivado) puntaje -= 5;
        candidatos.push({ expediente: exp, puntaje, motivo, archivado });
    };

    activos.forEach(e => evaluar(e, false));
    archivados.forEach(e => evaluar(e, true));

    candidatos.sort((a, b) => {
        if (b.puntaje !== a.puntaje) return b.puntaje - a.puntaje;
        const na = (a.expediente.numero || a.expediente.nombre || '');
        const nb = (b.expediente.numero || b.expediente.nombre || '');
        return na.localeCompare(nb, 'es');
    });
    return candidatos;
}

/**
 * Resuelve una referencia a UN expediente.
 * Devuelve { estado: 'unico'|'ambiguo'|'ninguno', expediente?, candidatos }.
 * Se considera resuelto cuando hay un solo candidato, o cuando el mejor gana
 * por margen claro a partir de una coincidencia fuerte: si dos empatan, es el
 * usuario quien debe decidir, no el sistema.
 */
async function resolverExpedientePorReferencia(referencia, opciones = {}) {
    const candidatos = await buscarExpedientesPorReferencia(referencia, opciones);
    if (candidatos.length === 0) return { estado: 'ninguno', candidatos: [] };
    if (candidatos.length === 1) return { estado: 'unico', expediente: candidatos[0].expediente, candidatos };

    const mejor = candidatos[0];
    const segundo = candidatos[1];
    if (mejor.puntaje >= 80 && mejor.puntaje - segundo.puntaje >= 15) {
        return { estado: 'unico', expediente: mejor.expediente, candidatos };
    }
    return { estado: 'ambiguo', candidatos };
}

/** Etiqueta corta y reconocible de un expediente, para listas y avisos. */
function etiquetaExpediente(exp) {
    const principal = exp.numero || exp.nombre || 'Expediente';
    const detalle = [exp.juzgado, exp.institucion && exp.institucion !== 'TSJ' ? exp.institucion : '']
        .filter(Boolean).join(' · ');
    return detalle ? `${principal} (${detalle})` : principal;
}
