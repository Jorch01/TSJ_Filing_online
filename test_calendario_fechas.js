#!/usr/bin/env node
/**
 * Pruebas de lo que se rompía al cambiar la fecha de un evento.
 *
 *   node test_calendario_fechas.js
 *
 * Todo corre con el reloj en Cancún (UTC-5), que es donde se usa la app: con
 * el reloj en UTC —el de las máquinas de CI— los errores de zona horaria no se
 * ven, y por eso pasaron desapercibidos.
 *
 *   1. La sincronización reconocía un evento por título + fecha + expediente.
 *      Al cambiarle la fecha, la versión vieja que seguía en la nube pasaba por
 *      OTRO evento con el mismo id y, al aplicarlas, ganaba la última escrita:
 *      el cambio se deshacía solo. Ahora las versiones del mismo evento se
 *      reconocen por su id y su fecha de creación, y se funden.
 *   2. Mover en el calendario el evento de un pendiente no duraba: el siguiente
 *      cambio al pendiente lo reescribía con la fecha vieja.
 *   3. El análisis IA escribe la hora en el título ("10:00 — Audiencia"): al
 *      mover la hora, el calendario seguía diciendo las 10:00.
 *   4. Google Calendar recibía los eventos de todo el día con el fin igual al
 *      inicio (rango vacío, que rechaza) y con el día de Greenwich.
 *   5. El formulario de edición, los recordatorios y la navegación de meses
 *      leían mal las fechas.
 *
 * Se carga el código real de docs/js/, no una copia.
 */

process.env.TZ = 'America/Cancun';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, 'docs', 'js');
const leer = (archivo) => fs.readFileSync(path.join(JS, archivo), 'utf8');

/** Una declaración de nivel superior (function / const / let) tal cual está. */
function extraer(fuente, nombre, archivo) {
    const l = fuente.split('\n');
    const pat = new RegExp('^(?:async\\s+)?function\\s+' + nombre + '\\s*\\(' +
                           '|^(?:const|let|var)\\s+' + nombre + '\\s*=');
    const i = l.findIndex(x => pat.test(x));
    if (i === -1) throw new Error(`No se encontró "${nombre}" en ${archivo} (¿se renombró?)`);
    if (/;\s*$/.test(l[i])) return l[i];
    for (let j = i + 1; j < l.length; j++) if (/^[}\])]/.test(l[j])) return l.slice(i, j + 1).join('\n');
    throw new Error(`Declaración incompleta de "${nombre}" en ${archivo}`);
}

/** Una función dentro de un IIFE (indentada), tal cual está. */
function extraerIndentado(fuente, nombre, archivo) {
    const re = new RegExp('^([ \\t]*)(?:async )?function ' + nombre + '\\s*\\([\\s\\S]*?\\n\\1\\}', 'm');
    const m = re.exec(fuente);
    if (!m) throw new Error(`No se encontró "${nombre}" en ${archivo} (¿se renombró?)`);
    return m[0];
}

// Un instante en hora de Cancún, como lo guarda la app (ISO en UTC).
const iso = (anio, mes, dia, hora = 0, min = 0) => new Date(anio, mes - 1, dia, hora, min).toISOString();

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; return; }
    fallos.push(descripcion + (detalle ? `\n      ${detalle}` : ''));
}
function igual(descripcion, real, esperado) {
    verificar(descripcion, JSON.stringify(real) === JSON.stringify(esperado),
        `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}

// ==================== 1. SINCRONIZACIÓN ====================

function crearSandboxSync() {
    const sb = { console: { log() {}, warn() {}, error() {} }, Map, Set, JSON, Object, Array, String, Date };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(extraer(leer('database.js'), 'ultimaEdicionDe', 'database.js'), sb, { filename: 'database.js:ultimaEdicionDe' });
    const sync = leer('sync.js');
    for (const n of ['reporteFusionDuplicados', 'crearMapaReasignacion', '_ultimaEdicionDe', '_eliminadoGana',
                     'obtenerTimestampCampo', 'fusionarRegistroPorCampo', 'claveEvento', 'claveEliminacionEvento',
                     'claveOrigen', 'unirVersiones', 'fusionarEventos', '_clavePendiente', 'fusionarPendientes']) {
        vm.runInContext(extraer(sync, n, 'sync.js'), sb, { filename: 'sync.js:' + n });
    }
    return sb;
}

function pruebaSyncCambioDeFecha() {
    const sb = crearSandboxSync();
    const t0 = '2026-09-20T10:00:00.000Z';
    const t1 = '2026-09-25T10:00:00.000Z';
    const original = {
        id: 5, titulo: 'Audiencia', fechaInicio: iso(2026, 10, 1, 10), expedienteId: 3,
        fechaCreacion: t0, fechaActualizacion: t0,
        _fieldTimestamps: { titulo: t0, fechaInicio: t0, expedienteId: t0 }
    };
    const editado = {
        ...original, fechaInicio: iso(2026, 10, 8, 10), fechaActualizacion: t1,
        _fieldTimestamps: { ...original._fieldTimestamps, fechaInicio: t1 }
    };

    // Este dispositivo cambió la fecha y la nube aún tiene la de antes.
    const aqui = sb.fusionarEventos([editado], [original]);
    igual('sync: tras cambiar la fecha queda UN evento (antes quedaban dos con el mismo id)', aqui.length, 1);
    igual('sync: y con la fecha nueva', aqui[0].fechaInicio, editado.fechaInicio);

    // El otro dispositivo aún tiene la vieja; la nube ya trae la nueva.
    const alla = sb.fusionarEventos([original], [editado]);
    igual('otro dispositivo: también uno', alla.length, 1);
    igual('otro dispositivo: y se queda con la nueva, no con la suya', alla[0].fechaInicio, editado.fechaInicio);

    // Los duplicados que dejó el fallo en la nube se limpian solos.
    const sucia = sb.fusionarEventos([original], [editado, original]);
    igual('nube con el duplicado del fallo: se limpia', sucia.map(e => e.fechaInicio), [editado.fechaInicio]);

    // Cambiar el título es lo mismo: también es parte de la clave.
    const renombrado = { ...original, titulo: 'Audiencia constitucional', fechaActualizacion: t1,
        _fieldTimestamps: { ...original._fieldTimestamps, titulo: t1 } };
    igual('sync: renombrarlo tampoco lo duplica', sb.fusionarEventos([original], [renombrado]).map(e => e.titulo),
        ['Audiencia constitucional']);

    // Otro dispositivo le cambió la descripción, antes o después: no se pierde
    // ninguno de los dos cambios.
    for (const [cuando, tx] of [['antes', '2026-09-22T10:00:00.000Z'], ['después', '2026-09-27T10:00:00.000Z']]) {
        const ajena = { ...original, descripcion: 'llevar testigos', fechaActualizacion: tx,
            _fieldTimestamps: { ...original._fieldTimestamps, descripcion: tx } };
        const juntos = sb.fusionarEventos([editado], [ajena]);
        igual(`concurrente (${cuando}): un solo evento con la fecha de uno y la descripción del otro`,
            juntos.map(e => [e.fechaInicio, e.descripcion]), [[editado.fechaInicio, 'llevar testigos']]);
    }

    // Dos eventos distintos que comparten id (creados a la vez en dos
    // dispositivos) no son versiones uno del otro: no se funden.
    const otro = { id: 5, titulo: 'Junta', fechaInicio: iso(2026, 11, 3, 9), fechaCreacion: '2026-09-21T08:00:00.000Z',
        fechaActualizacion: '2026-09-21T08:00:00.000Z' };
    igual('sync: dos eventos distintos con el mismo id siguen siendo dos', sb.fusionarEventos([editado], [otro]).length, 2);

    // Un evento NUEVO con el título y la fecha que otro tenía antes de moverse
    // es otro evento: no puede tragárselo la versión vieja del que se movió.
    const nuevoEnSuLugar = { id: 6, titulo: 'Audiencia', fechaInicio: original.fechaInicio, expedienteId: 3,
        fechaCreacion: '2026-09-26T10:00:00.000Z', fechaActualizacion: '2026-09-26T10:00:00.000Z' };
    const ocupado = sb.fusionarEventos([original], [editado, nuevoEnSuLugar]);
    igual('sync: un evento nuevo en el hueco del que se movió no se funde con él',
        ocupado.map(e => e.id).sort(), [5, 6]);
    igual('sync: y el que se movió conserva su fecha nueva',
        ocupado.find(e => e.id === 5).fechaInicio, editado.fechaInicio);

    // El mismo evento dado de alta en dos dispositivos se sigue juntando.
    const gemelo = { ...editado, id: 9, fechaCreacion: '2026-09-23T10:00:00.000Z' };
    igual('sync: el mismo evento creado en dos lados se sigue juntando', sb.fusionarEventos([editado], [gemelo]).length, 1);
    // ...y si después uno de los dos lo mueve, sigue siendo uno.
    const gemeloMovido = { ...gemelo, fechaInicio: iso(2026, 10, 15, 10), fechaActualizacion: '2026-09-28T10:00:00.000Z',
        _fieldTimestamps: { ...gemelo._fieldTimestamps, fechaInicio: '2026-09-28T10:00:00.000Z' } };
    igual('sync: si luego lo mueve uno de los dos, sigue siendo uno, con la fecha nueva',
        sb.fusionarEventos([editado], [gemelo, gemeloMovido]).map(e => e.fechaInicio), [iso(2026, 10, 15, 10)]);

    // Datos muy antiguos, sin fecha de creación: como antes.
    const antiguo = { id: 7, titulo: 'Legado', fechaInicio: iso(2026, 10, 1, 9) };
    igual('sync: sin fecha de creación se comporta como antes',
        sb.fusionarEventos([{ ...antiguo, fechaInicio: iso(2026, 10, 2, 9) }], [antiguo]).length, 2);

    // Un borrado posterior se sigue respetando.
    const borrado = new Map([[sb.claveEliminacionEvento(editado), '2026-09-30T00:00:00.000Z']]);
    igual('sync: un borrado posterior sigue mandando', sb.fusionarEventos([editado], [], borrado).length, 0);

    // Pendientes: renombrarlo le cambia la clave, igual que la fecha a un evento.
    const pViejo = { id: 9, titulo: 'Contestar', expedienteId: 1, eventoId: 40, fechaCreacion: t0, fechaActualizacion: t0,
        _fieldTimestamps: { titulo: t0 } };
    const pNuevo = { ...pViejo, titulo: 'Contestar la demanda', eventoId: 41, fechaActualizacion: t1, _fieldTimestamps: { titulo: t1 } };
    const pendientes = sb.fusionarPendientes([pViejo], [pNuevo]);
    igual('sync: un pendiente renombrado no reaparece con el nombre viejo', pendientes.map(p => p.titulo), ['Contestar la demanda']);
    igual('sync: y conserva el vínculo con su evento de este dispositivo', pendientes[0].eventoId, 40);
}

// ==================== 2 y 3. NÚCLEO DE ACCIONES ====================

function crearSandboxCore() {
    let secuencia = 0;
    const estado = { pendientes: [], eventos: [] };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Map, Set, Promise, setTimeout, estado,
        obtenerPendientes: async () => estado.pendientes.map(p => ({ ...p })),
        obtenerPendiente: async (id) => { const p = estado.pendientes.find(x => x.id === id); return p ? { ...p } : null; },
        agregarPendiente: async (p) => { const id = ++secuencia; estado.pendientes.push({ ...p, id }); return id; },
        actualizarPendiente: async (id, cambios) => {
            const p = estado.pendientes.find(x => x.id === id);
            if (!p) throw new Error('Pendiente no encontrado');
            Object.assign(p, cambios);
            return { ...p };
        },
        eliminarPendiente: async (id) => { estado.pendientes = estado.pendientes.filter(p => p.id !== id); },
        agregarEvento: async (ev) => { const id = ++secuencia; estado.eventos.push({ ...ev, id }); return id; },
        obtenerEventos: async () => estado.eventos.map(e => ({ ...e })),
        actualizarEvento: async (id, cambios) => {
            const e = estado.eventos.find(x => x.id === id);
            if (!e) throw new Error('Evento no encontrado');
            Object.assign(e, cambios);
        },
        eliminarEvento: async (id) => { estado.eventos = estado.eventos.filter(e => e.id !== id); },
        obtenerExpedientes: async () => [],
        obtenerExpediente: async () => null
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(leer('acciones-core.js'), sb, { filename: 'acciones-core.js' });
    return { sb, estado };
}

async function pruebaEventoDePendiente() {
    const { sb, estado } = crearSandboxCore();
    const idP = await sb.crearPendienteCore({
        titulo: 'Contestar demanda', fechaLimite: iso(2026, 10, 5), todoElDia: true, prioridad: 'media'
    });
    const eventoId = estado.pendientes[0].eventoId;
    const evento = () => estado.eventos.find(e => e.id === eventoId);
    verificar('pendiente: tiene su evento en el calendario', !!evento());

    // Se mueve el evento en el calendario...
    await sb.actualizarEventoCore(eventoId, { fechaInicio: iso(2026, 10, 9) });
    igual('pendiente: toma la fecha nueva de su evento', estado.pendientes[0].fechaLimite, iso(2026, 10, 9));

    // ...y después se toca el pendiente: antes esto regresaba el evento al día 5.
    await sb.actualizarPendienteCore(idP, { prioridad: 'alta' });
    igual('pendiente: cambiarle la prioridad ya no regresa el evento a la fecha vieja',
        evento().fechaInicio, iso(2026, 10, 9));

    // Tipo y alerta puestos a mano en el calendario sobreviven a una edición del pendiente.
    await sb.actualizarEventoCore(eventoId, { tipo: 'vencimiento', alerta: false });
    await sb.actualizarPendienteCore(idP, { descripcion: 'con pruebas' });
    igual('pendiente: el tipo puesto en el calendario se respeta', evento().tipo, 'vencimiento');
    igual('pendiente: y la alerta también', evento().alerta, false);
    igual('pendiente: su detalle sí llega a la descripción del evento',
        evento().descripcion, 'Pendiente del expediente.\n\ncon pruebas');

    // Título y descripción editados en el evento llegan al pendiente.
    await sb.actualizarEventoCore(eventoId, { titulo: 'Contestar la demanda (urgente)' });
    igual('pendiente: el título cambiado en el calendario llega al pendiente',
        estado.pendientes[0].titulo, 'Contestar la demanda (urgente)');
    await sb.actualizarEventoCore(eventoId, { descripcion: 'Pendiente del expediente.\n\nllevar copias' });
    igual('pendiente: y la descripción, sin el encabezado automático', estado.pendientes[0].descripcion, 'llevar copias');

    // Con hora deja de ser de día completo, en los dos lados.
    await sb.actualizarEventoCore(eventoId, { fechaInicio: iso(2026, 10, 9, 11, 30), todoElDia: false });
    igual('pendiente: la hora puesta en el calendario llega al pendiente',
        [estado.pendientes[0].fechaLimite, estado.pendientes[0].todoElDia], [iso(2026, 10, 9, 11, 30), false]);

    // Un vínculo roto no autoriza a tocar un pendiente ajeno.
    const idAjeno = await sb.agregarPendiente({ titulo: 'Ajeno', fechaLimite: iso(2026, 11, 1), eventoId: 999 });
    const idSuelto = await sb.crearEventoCore({ titulo: 'Suelto', tipo: 'otro', fechaInicio: iso(2026, 10, 20) });
    await sb.actualizarEvento(idSuelto, { pendienteId: idAjeno });
    await sb.actualizarEventoCore(idSuelto, { fechaInicio: iso(2026, 10, 21) });
    igual('pendiente: uno que no apunta de vuelta al evento no se toca',
        estado.pendientes.find(p => p.id === idAjeno).fechaLimite, iso(2026, 11, 1));
}

async function pruebaHoraEscritaEnElTitulo() {
    const { sb, estado } = crearSandboxCore();
    const ev = (id) => estado.eventos.find(e => e.id === id);

    const id = await sb.crearEventoCore({
        titulo: '10:00 — Audiencia constitucional [Exp. 123/2025]', tipo: 'audiencia',
        fechaInicio: iso(2026, 10, 1, 10),
        descripcion: '📋 Expediente: 123/2025\n🕒 Hora: 10:00\n\n📄 Resumen: fija fecha'
    });
    await sb.actualizarEventoCore(id, { fechaInicio: iso(2026, 10, 2, 12) });
    igual('hora escrita: el título dice la hora nueva', ev(id).titulo, '12:00 — Audiencia constitucional [Exp. 123/2025]');
    verificar('hora escrita: y la descripción también', /🕒 Hora: 12:00/.test(ev(id).descripcion), ev(id).descripcion);
    verificar('hora escrita: sin tocar el resto', /📄 Resumen: fija fecha/.test(ev(id).descripcion));

    // Como lo manda el formulario: el título de siempre junto con la hora nueva.
    await sb.actualizarEventoCore(id, { titulo: ev(id).titulo, fechaInicio: iso(2026, 10, 2, 13) });
    igual('hora escrita: también al guardar desde el formulario', ev(id).titulo, '13:00 — Audiencia constitucional [Exp. 123/2025]');

    // Un título reescrito en la misma edición manda.
    await sb.actualizarEventoCore(id, { fechaInicio: iso(2026, 10, 2, 16), titulo: 'Audiencia (reprogramada)' });
    igual('hora escrita: un título escrito a mano se respeta', ev(id).titulo, 'Audiencia (reprogramada)');

    // Si el título no decía la hora que tenía el evento, no es la hora del evento.
    const id2 = await sb.crearEventoCore({ titulo: '09:00 — Llamar al perito', tipo: 'otro', fechaInicio: iso(2026, 10, 1, 10) });
    await sb.actualizarEventoCore(id2, { fechaInicio: iso(2026, 10, 1, 11) });
    igual('hora escrita: no se toca si no coincidía con la del evento', ev(id2).titulo, '09:00 — Llamar al perito');

    // Pasar a todo el día quita la hora escrita.
    const id3 = await sb.crearEventoCore({
        titulo: '10:00 — Vence plazo', tipo: 'vencimiento', fechaInicio: iso(2026, 10, 1, 10),
        descripcion: '🕒 Hora: 10:00\nOtra línea'
    });
    await sb.actualizarEventoCore(id3, { todoElDia: true });
    igual('hora escrita: de día completo, el título se queda sin hora', ev(id3).titulo, 'Vence plazo');
    igual('hora escrita: y la descripción sin la línea de la hora', ev(id3).descripcion, 'Otra línea');

    // Cambiar solo el día conserva la hora escrita, que sigue siendo cierta.
    const id4 = await sb.crearEventoCore({ titulo: '10:00 — Junta', tipo: 'otro', fechaInicio: iso(2026, 10, 1, 10) });
    await sb.actualizarEventoCore(id4, { fechaInicio: iso(2026, 10, 7, 10) });
    igual('hora escrita: mover solo de día no la cambia', ev(id4).titulo, '10:00 — Junta');
}

// ==================== 4. GOOGLE CALENDAR ====================

function pruebaGoogleCalendar() {
    const gcal = leer('gcal-sync.js');
    const sb = { console, Date, Intl, URLSearchParams, location: { origin: 'https://tsjia.empirica.mx' } };
    vm.createContext(sb);
    for (const n of ['fechaLocal', 'diaSiguiente', 'appEventoAGCal', 'urlAgregarGCal', 'eventoAICS']) {
        vm.runInContext(extraerIndentado(gcal, n, 'gcal-sync.js'), sb, { filename: 'gcal-sync.js:' + n });
    }

    // Todo el día, guardado a las 20:00 del 1 de octubre: en UTC ya es el 2.
    const ev = { id: 1, titulo: 'Vence plazo', fechaInicio: iso(2026, 10, 1, 20), todoElDia: true };
    const g = sb.appEventoAGCal(ev);
    igual('google: el día es el local, no el de Greenwich', g.start, { date: '2026-10-01' });
    igual('google: y termina al día siguiente (el fin es exclusivo)', g.end, { date: '2026-10-02' });
    igual('google: fin de año incluido', sb.appEventoAGCal({ titulo: 'x', fechaInicio: iso(2026, 12, 31, 9), todoElDia: true }).end,
        { date: '2027-01-01' });

    const conHora = sb.appEventoAGCal({ titulo: 'Audiencia', fechaInicio: iso(2026, 10, 1, 10), todoElDia: false });
    igual('google: con hora va el instante exacto', conHora.start.dateTime, iso(2026, 10, 1, 10));

    const url = decodeURIComponent(sb.urlAgregarGCal(ev));
    verificar('google: el enlace manual lleva el día local y el siguiente', url.includes('dates=20261001/20261002'), url);

    const ics = sb.eventoAICS(ev);
    verificar('ics: empieza el día local', /DTSTART;VALUE=DATE:20261001/.test(ics), ics);
    verificar('ics: y termina al día siguiente', /DTEND;VALUE=DATE:20261002/.test(ics), ics);

    // Sin obtenerEvento, gcal-sync.js nunca guardaba el id del evento en Google:
    // cada edición creaba uno NUEVO allá y el viejo se quedaba en la fecha vieja.
    verificar('google: database.js define obtenerEvento, que usa gcal-sync.js',
        /^async function obtenerEvento\(/m.test(leer('database.js')) && /obtenerEvento\(evento\.id\)/.test(gcal));
}

// ==================== 5. FORMULARIO, RECORDATORIOS Y MESES ====================

function pruebaFormularioYRecordatorios() {
    const app = leer('app.js');
    const sb = { Date, isNaN, parseInt, String };
    vm.createContext(sb);
    for (const n of ['valorFechaHoraLocal', '_parsearFechaLocal', '_diaLocalDeEvento', '_avisoSigueVigente']) {
        vm.runInContext(extraer(app, n, 'app.js'), sb, { filename: 'app.js:' + n });
    }

    igual('formulario: una audiencia de las 10:00 se muestra a las 10:00',
        sb.valorFechaHoraLocal(iso(2026, 10, 1, 10)), '2026-10-01T10:00');
    igual('formulario: una de las 20:00 sigue en su día',
        sb.valorFechaHoraLocal(iso(2026, 10, 1, 20)), '2026-10-01T20:00');
    igual('formulario: abrir y guardar sin tocar nada deja el mismo instante',
        new Date(sb.valorFechaHoraLocal(iso(2026, 10, 1, 20))).toISOString(), iso(2026, 10, 1, 20));
    igual('formulario: una fecha rota no revienta', sb.valorFechaHoraLocal('no es fecha'), '');

    const dia = sb._diaLocalDeEvento({ fechaInicio: iso(2026, 10, 1, 20) });
    igual('recordatorio: una audiencia de las 20:00 cuenta para su propio día',
        [dia.getFullYear(), dia.getMonth() + 1, dia.getDate()], [2026, 10, 1]);
    igual('recordatorio: una fecha sin hora se lee tal cual', sb._diaLocalDeEvento({ fecha: '2026-10-01' }).getDate(), 1);

    const cambio = Date.parse('2026-09-20T10:00:00.000Z');
    const pospuesto = { _fieldTimestamps: { fechaInicio: '2026-09-20T10:00:00.000Z' } };
    igual('recordatorio: el aviso mandado después del último cambio de fecha vale',
        sb._avisoSigueVigente(cambio + 1000, pospuesto), true);
    igual('recordatorio: si luego se pospuso, hay que volver a avisar',
        sb._avisoSigueVigente(cambio - 1000, pospuesto), false);
    igual('recordatorio: lo que nunca se mandó no vale', sb._avisoSigueVigente(undefined, pospuesto), false);
    igual('recordatorio: un evento viejo sin sellos se comporta como antes', sb._avisoSigueVigente(123, {}), true);
    // Nunca se movió: su fecha es la de creación. Aunque el reloj del
    // dispositivo vaya atrasado respecto al sello, el aviso vale y no se repite.
    const sinMover = { fechaCreacion: '2026-09-20T10:00:00.000Z', _fieldTimestamps: { fechaInicio: '2026-09-20T10:00:00.000Z' } };
    igual('recordatorio: un evento que nunca se movió no repite el aviso', sb._avisoSigueVigente(cambio - 60000, sinMover), true);
}

function pruebaNavegacionDeMeses() {
    const app = leer('app.js');
    const sb = { Date, renderizarCalendario: () => {} };
    vm.createContext(sb);
    vm.runInContext('var fechaCalendario = null; var diaSeleccionado = null;', sb);
    for (const n of ['mesAnterior', 'mesSiguiente']) {
        vm.runInContext(extraer(app, n, 'app.js'), sb, { filename: 'app.js:' + n });
    }
    const mes = () => vm.runInContext('[fechaCalendario.getFullYear(), fechaCalendario.getMonth() + 1]', sb);

    vm.runInContext('fechaCalendario = new Date(2026, 9, 31)', sb);
    sb.mesSiguiente();
    igual('meses: desde el 31 de octubre, "siguiente" es noviembre', mes(), [2026, 11]);
    vm.runInContext('fechaCalendario = new Date(2026, 9, 31)', sb);
    sb.mesAnterior();
    igual('meses: y "anterior" es septiembre', mes(), [2026, 9]);
    vm.runInContext('fechaCalendario = new Date(2026, 0, 31)', sb);
    sb.mesSiguiente();
    igual('meses: del 31 de enero se pasa a febrero', mes(), [2026, 2]);
    vm.runInContext('fechaCalendario = new Date(2026, 11, 15)', sb);
    sb.mesSiguiente();
    igual('meses: de diciembre a enero del año siguiente', mes(), [2027, 1]);
}

(async () => {
    const pruebas = [
        ['cambiar la fecha y sincronizar', pruebaSyncCambioDeFecha],
        ['el evento de un pendiente', pruebaEventoDePendiente],
        ['la hora escrita en el título', pruebaHoraEscritaEnElTitulo],
        ['Google Calendar', pruebaGoogleCalendar],
        ['formulario y recordatorios', pruebaFormularioYRecordatorios],
        ['navegación de meses', pruebaNavegacionDeMeses]
    ];
    for (const [nombre, fn] of pruebas) {
        try { await fn(); }
        catch (e) { fallos.push(`${nombre}: lanzó ${e && e.stack ? e.stack : e}`); }
    }
    console.log(`\n  ${pasadas} pasadas, ${fallos.length} fallidas\n`);
    if (fallos.length) {
        console.log('  Fallos:');
        fallos.forEach(f => console.log('   ✗ ' + f));
        console.log('');
        process.exit(1);
    }
    console.log('  ✓ Cambiar la fecha de un evento se queda cambiada, aquí, en la nube y en Google.\n');
})();
