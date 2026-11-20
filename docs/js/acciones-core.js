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
        // La página 📊 Estadísticas, solo si está a la vista.
        if (typeof refrescarEstadisticasSiVisible === 'function') await refrescarEstadisticasSiVisible();
        // Sesiones de los Tribunales Colegiados: un expediente nuevo o editado
        // puede cambiar lo que hay que buscar. No se espera: consulta a la red.
        if (typeof SESIONES_PJF !== 'undefined') SESIONES_PJF.revisar();
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
    // De dónde vino (p. ej. una audiencia del seguimiento semanal).
    if (datos.origen && typeof datos.origen === 'object') evento.origen = { ...datos.origen };
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
    const actual = (await obtenerEventos()).find(e => e.id === id);
    if (!actual) throw new Error('Evento no encontrado');
    _coreReajustarHoraEscrita(actual, aplicar);

    await actualizarEvento(id, aplicar);
    await _coreRefrescarUI();
    await _coreSincronizar();
    await _coreGcalGuardar(id);
}

// El análisis IA escribe la hora dentro del propio título ("10:00 — Audiencia
// …") y de la descripción ("🕒 Hora: 10:00"). Si luego se mueve la hora y el
// título sigue diciendo 10:00, en el calendario parece que el cambio no se
// aplicó. Solo se toca ese formato, solo si decía la hora que tenía el evento
// y solo si el texto no se reescribió en esta misma edición: un título escrito
// por el usuario se respeta tal cual.
const _CORE_RE_HORA_TITULO = /^(\d{1,2}:\d{2}) — /;
const _CORE_RE_HORA_DESCRIPCION = /^🕒 Hora: (\d{1,2}:\d{2})$/m;

function _coreHoraLocal(fechaISO) {
    const d = new Date(fechaISO);
    if (isNaN(d.getTime())) return null;
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function _coreMismaHora(a, b) {
    const n = (h) => (h || '').replace(/^(\d):/, '0$1:');
    return !!a && n(a) === n(b);
}

function _coreReajustarHoraEscrita(actual, aplicar) {
    const fechaNueva = aplicar.fechaInicio !== undefined ? aplicar.fechaInicio : actual.fechaInicio;
    const todoElDiaNuevo = aplicar.todoElDia !== undefined ? !!aplicar.todoElDia : !!actual.todoElDia;
    if (fechaNueva === actual.fechaInicio && todoElDiaNuevo === !!actual.todoElDia) return;

    const horaAntes = actual.todoElDia ? null : _coreHoraLocal(actual.fechaInicio);
    const horaAhora = todoElDiaNuevo ? null : _coreHoraLocal(fechaNueva);
    if (!horaAntes) return;   // no había hora escrita que pudiera quedar vieja

    const tituloIntacto = aplicar.titulo === undefined || aplicar.titulo === actual.titulo;
    const mTitulo = _CORE_RE_HORA_TITULO.exec(actual.titulo || '');
    if (tituloIntacto && mTitulo && _coreMismaHora(mTitulo[1], horaAntes)) {
        const resto = actual.titulo.slice(mTitulo[0].length);
        aplicar.titulo = horaAhora ? `${horaAhora} — ${resto}` : resto;
    }

    const descripcionIntacta = aplicar.descripcion === undefined || aplicar.descripcion === actual.descripcion;
    const mDesc = _CORE_RE_HORA_DESCRIPCION.exec(actual.descripcion || '');
    if (descripcionIntacta && mDesc && _coreMismaHora(mDesc[1], horaAntes)) {
        aplicar.descripcion = horaAhora
            ? actual.descripcion.replace(_CORE_RE_HORA_DESCRIPCION, `🕒 Hora: ${horaAhora}`)
            : actual.descripcion.replace(/^🕒 Hora: \d{1,2}:\d{2}\n?/m, '');
    }
}

/** Elimina un evento (incluida su copia en Google Calendar si aplica). */
async function eliminarEventoCore(id) {
    const evento = (await obtenerEventos()).find(e => e.id === id);
    if (!evento) throw new Error('Evento no encontrado');
    await eliminarEvento(id);
    try {
        // Sin conexión con Google, GCAL lo anota y lo borra allá al conectar.
        if (typeof GCAL !== 'undefined' && evento.googleCalEventId && GCAL.hookEliminarEvento) {
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
 * Ejecuta varias operaciones del núcleo como si fueran una sola: mientras dura
 * el lote se omiten el refresco de UI y la subida a la nube, y al terminar se
 * hacen una única vez.
 *
 * Hay que envolver la operación COMPLETA. Agrupar solo una parte no basta:
 * una importación crea expedientes, pendientes y eventos, y cada una de esas
 * funciones sincroniza por su cuenta al terminar, así que lo que quede fuera
 * del lote dispara su propia subida. Los lotes se pueden anidar sin problema
 * (se llevan con un contador), de modo que envolver de más nunca hace daño.
 *
 * @param {Function} fn Operación a ejecutar; se devuelve lo que ella devuelva.
 */
async function enLoteCore(fn) {
    const resultado = await _coreEnLoteEjecutar(fn);
    await _coreRefrescarUI();
    await _coreSincronizar();
    return resultado;
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
// Un pendiente es una tarea de un expediente, con fecha límite opcional.
//
// Los pendientes NO van al calendario: el calendario es para las audiencias y
// las citas que agenda el usuario. La fecha límite de un pendiente se ve en
// Pendientes, entra en el resumen del asistente y avisa por correo como
// cualquier evento (verificarRecordatoriosPendientes, en app.js).
//
// Antes cada pendiente con fecha llevaba un evento "espejo" en el calendario
// (pendiente.eventoId ↔ evento.pendienteId, con la descripción "Pendiente del
// expediente."). Llenaban el calendario de recordatorios amarillos que no
// eran citas; sacarPendientesDelCalendarioCore los retira, y los vínculos que
// todavía traiga un pendiente se sueltan al tocarlo.

// Prioridades válidas, de más a menos urgente. Cualquier otro valor (incluida
// la cadena vacía) significa "sin asignar", que es un estado legítimo: no todo
// pendiente merece que se decida su urgencia.
const CORE_PRIORIDADES_PENDIENTE = ['alta', 'media', 'baja'];

function normalizarPrioridadCore(valor) {
    return CORE_PRIORIDADES_PENDIENTE.includes(valor) ? valor : '';
}

// Con esto empezaba la descripción de todo espejo. Sirve para reconocer los
// que perdieron el vínculo (un respaldo viejo los restauraba sueltos).
const _CORE_BASE_DESCRIPCION_PENDIENTE = 'Pendiente del expediente.';

/** ¿El evento es el reflejo en el calendario de un pendiente? */
function esEventoDePendienteCore(evento) {
    if (!evento) return false;
    if (evento.pendienteId != null) return true;
    return String(evento.descripcion || '').trim().startsWith(_CORE_BASE_DESCRIPCION_PENDIENTE);
}

// Un espejo al que el usuario cambió a mano el tipo a audiencia y le puso
// hora ya no es el reflejo de una tarea: es una audiencia que él agendó. Se
// queda en el calendario, sin vínculo; borrarlo no tendría vuelta atrás.
function _coreEspejoVueltoAudiencia(evento) {
    return evento.tipo === 'audiencia' && !evento.todoElDia;
}

/**
 * Quita del calendario el evento que un pendiente traía de antes. Solo toca
 * lo que es DEMOSTRABLEMENTE su reflejo: un eventoId heredado de un respaldo
 * viejo puede apuntar a una audiencia real, y esa se queda. No propaga
 * errores: que falle el calendario no debe impedir guardar el pendiente.
 * El llamador pone eventoId:null en el pendiente.
 */
async function _coreRetirarEventoDePendiente(pendiente) {
    if (!pendiente || pendiente.eventoId == null) return;
    try {
        const evento = (await obtenerEventos()).find(e => e.id === pendiente.eventoId);
        if (!evento) return;
        const esSuyo = evento.pendienteId === pendiente.id ||
            (evento.pendienteId == null && esEventoDePendienteCore(evento));
        if (!esSuyo) return;
        if (_coreEspejoVueltoAudiencia(evento)) {
            await actualizarEvento(evento.id, { pendienteId: null });
        } else {
            await eliminarEventoCore(evento.id);
        }
    } catch (e) {
        console.error('[CORE] No se pudo quitar del calendario el evento del pendiente:', e);
    }
}

/**
 * Crea un pendiente. Espera: { titulo, descripcion?, expedienteId?,
 * expedienteTexto?, fechaLimite?(ISO), todoElDia?, prioridad?, origen? }.
 * Devuelve el id nuevo.
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
    // De dónde vino (p. ej. el seguimiento semanal): con eso la siguiente
    // importación lo reconoce y lo actualiza en vez de duplicarlo.
    if (datos.origen && typeof datos.origen === 'object') pendiente.origen = { ...datos.origen };

    const nuevoId = await agregarPendiente(pendiente);
    await _coreRefrescarUI();
    await _coreSincronizar();
    return nuevoId;
}

/** Actualiza un pendiente. */
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
        if (actual.eventoId != null) {
            await _coreRetirarEventoDePendiente(actual);
            aplicar.eventoId = null;
        }
        await actualizarPendiente(id, aplicar);
    });

    await _coreRefrescarUI();
    await _coreSincronizar();
}

/** Marca un pendiente como terminado (o lo reabre). */
async function completarPendienteCore(id, completado = true) {
    const actual = await obtenerPendiente(id);
    if (!actual) throw new Error('Pendiente no encontrado');

    await _coreEnLoteEjecutar(async () => {
        const aplicar = {
            completado: !!completado,
            fechaCompletado: completado ? new Date().toISOString() : null
        };
        if (actual.eventoId != null) {
            await _coreRetirarEventoDePendiente(actual);
            aplicar.eventoId = null;
        }
        await actualizarPendiente(id, aplicar);
    });

    await _coreRefrescarUI();
    await _coreSincronizar();
}

/** Elimina un pendiente (y el evento que traía de antes, si lo tiene). */
async function eliminarPendienteCore(id) {
    const actual = await obtenerPendiente(id);
    if (!actual) throw new Error('Pendiente no encontrado');

    await _coreEnLoteEjecutar(async () => {
        await _coreRetirarEventoDePendiente(actual);
        await eliminarPendiente(id);
    });

    await _coreRefrescarUI();
    await _coreSincronizar();
    return actual;
}

/**
 * Saca del calendario los eventos que reflejaban pendientes y suelta los
 * vínculos que queden. Corre al arrancar, al restaurar un respaldo y en cada
 * sincronización, porque un espejo puede volver por cualquiera de esos
 * caminos (un respaldo viejo, o un dispositivo que todavía no se actualizó y
 * lo vuelve a crear). Los pendientes no se tocan más que para soltar el
 * vínculo: su fecha, prioridad y detalle siguen en Pendientes.
 *
 * Se queda el espejo que el usuario convirtió a mano en audiencia con hora
 * (ver _coreEspejoVueltoAudiencia), sin vínculo, y cualquier evento al que un
 * pendiente apuntara sin ser su espejo.
 *
 * No propaga errores: es una puesta a punto de fondo, y que falle no puede
 * tumbar el arranque ni una sincronización.
 *
 * @param {{sincronizar?: boolean}} [opciones] sincronizar:false no dispara la
 *        subida a la nube al terminar. Lo usa el propio sync, que ya está en
 *        mitad de una vuelta y sube lo repasado en esa misma vuelta.
 * @returns {Promise<{retirados:number, conservados:number, soltados:number}>}
 *        retirados: eventos quitados del calendario; conservados: espejos
 *        vueltos audiencia que se quedan; soltados: pendientes desvinculados.
 */
async function sacarPendientesDelCalendarioCore(opciones = {}) {
    const resumen = { retirados: 0, conservados: 0, soltados: 0 };
    if (typeof obtenerPendientes !== 'function' || typeof obtenerEventos !== 'function') {
        return resumen;
    }

    let pendientes, eventos;
    try {
        [pendientes, eventos] = await Promise.all([obtenerPendientes(), obtenerEventos()]);
    } catch (e) {
        console.error('[CORE] No se pudo revisar el calendario de los pendientes:', e);
        return resumen;
    }

    try {
        await _coreEnLoteEjecutar(async () => {
            for (const e of eventos || []) {
                if (!esEventoDePendienteCore(e)) continue;
                if (_coreEspejoVueltoAudiencia(e)) {
                    if (e.pendienteId != null) {
                        await actualizarEvento(e.id, { pendienteId: null }).catch(() => {});
                        resumen.conservados++;
                    }
                    continue;
                }
                try {
                    await eliminarEventoCore(e.id);
                    resumen.retirados++;
                } catch (err) {
                    console.error('[CORE] No se pudo quitar del calendario un pendiente:', err);
                }
            }
            for (const p of pendientes || []) {
                if (p.eventoId == null) continue;
                await actualizarPendiente(p.id, { eventoId: null }).catch(() => {});
                resumen.soltados++;
            }
        });
    } catch (e) {
        console.error('[CORE] Error sacando los pendientes del calendario:', e);
    }

    // Solo se molesta a la UI y a la nube si de verdad cambió algo: esto
    // corre en cada arranque y en cada sincronización.
    if (resumen.retirados || resumen.conservados || resumen.soltados) {
        await _coreRefrescarUI();
        if (opciones.sincronizar !== false) await _coreSincronizar();
    }
    return resumen;
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
        exp.actor, exp.demandado, exp.institucion, nombreCarpeta,
        exp.cliente, exp.abogado, exp.tipo
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

// Palabras con las que se nombra el tipo de grupo pero que no están en ningún
// dato: "los de la carpeta AHO", "los del cliente AHO". Exigirlas dejaba la
// búsqueda sin resultados.
const _PALABRAS_RUIDO_GRUPO = new Set([
    'carpeta', 'carpetas', 'cliente', 'clientes', 'categoria', 'categorias', 'tipo', 'tipos',
    'grupo', 'responsable', 'abogado', 'asuntos', 'casos', 'juicios', 'todos', 'todas', 'ese', 'esa'
]);

/**
 * Los expedientes ACTIVOS de un grupo: lo que el usuario llama "los de AHO" y
 * puede ser una carpeta, un cliente, un tipo de asunto, un responsable o la
 * categoría. A diferencia de buscarExpedientesPorReferencia, que escoge UN
 * expediente, aquí interesan TODOS los que pertenecen al grupo.
 *
 * Cada palabra de la referencia debe aparecer COMPLETA en esos datos: "AHO" no
 * es "ahorro". Solo cuentan datos de clasificación y de las partes, no el
 * número del expediente, que identifica a uno y no a un grupo.
 * Devuelve [{ expediente, motivo }] en el orden de la lista de expedientes.
 */
async function buscarExpedientesDeGrupo(referencia) {
    const tokens = _tokensUtiles(referencia).filter(t => !_PALABRAS_RUIDO_GRUPO.has(t));
    if (!tokens.length) return [];

    const activos = await obtenerExpedientes().catch(() => []);
    let carpetas = [];
    try {
        if (typeof obtenerCarpetas === 'function') carpetas = await obtenerCarpetas();
    } catch (e) { /* sin carpetas */ }
    const nombreCarpeta = (id) => (carpetas.find(c => c.id === id) || {}).nombre || '';

    const palabras = (texto) => new Set(_normRef(texto).split(/[^a-z0-9]+/).filter(Boolean));
    const resultado = [];
    for (const exp of activos) {
        const origenes = [
            ['carpeta', nombreCarpeta(exp.carpetaId)], ['cliente', exp.cliente], ['tipo de asunto', exp.tipo],
            ['responsable', exp.abogado], ['categoría', exp.categoria], ['comentario', exp.comentario],
            ['partes', [exp.actor, exp.demandado, exp.nombre].filter(Boolean).join(' ')], ['autoridad', exp.juzgado]
        ];
        const conjuntos = origenes.map(([nombre, texto]) => [nombre, palabras(texto)]);
        // Todas las palabras, aunque cada una venga de un dato distinto.
        const cubiertas = tokens.every(t => conjuntos.some(([, set]) => set.has(t)));
        if (!cubiertas) continue;
        const motivo = conjuntos.filter(([, set]) => tokens.some(t => set.has(t))).map(([nombre]) => nombre);
        resultado.push({ expediente: exp, motivo: motivo.join(', ') });
    }
    return resultado;
}

/** Etiqueta corta y reconocible de un expediente, para listas y avisos. */
function etiquetaExpediente(exp) {
    const principal = exp.numero || exp.nombre || 'Expediente';
    const detalle = [exp.juzgado, exp.institucion && exp.institucion !== 'TSJ' ? exp.institucion : '']
        .filter(Boolean).join(' · ');
    return detalle ? `${principal} (${detalle})` : principal;
}
