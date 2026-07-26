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

async function _coreRefrescarUI() {
    try {
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

/** Elimina un expediente (permanente=true borra definitivo y propaga a sync). */
async function eliminarExpedienteCore(id, permanente) {
    await eliminarExpediente(id, !!permanente);
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
