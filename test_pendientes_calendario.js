#!/usr/bin/env node
/**
 * Pruebas de que los pendientes NO van al calendario.
 *
 *   node test_pendientes_calendario.js
 *
 * El calendario es para las audiencias y las citas que agenda el usuario.
 * Antes cada pendiente con fecha llevaba un evento "espejo" en el calendario
 * y lo llenaba de recordatorios que no eran citas. Ahora:
 *
 *   - Dar de alta, editar o terminar un pendiente no agenda nada.
 *   - sacarPendientesDelCalendarioCore quita los espejos que ya había (con
 *     vínculo o sin él, como los restauraba un respaldo viejo), sin tocar las
 *     audiencias ni las citas, ni el pendiente más que su vínculo.
 *   - Lo que se borra sin conexión con Google Calendar se borra allá al
 *     conectar (gcal-sync.js).
 *
 * Corre sin dependencias: se carga el docs/js/acciones-core.js de verdad sobre
 * una base de datos simulada, así que si alguien cambia las reglas, falla.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, 'docs', 'js');

// ==================== BASE DE DATOS SIMULADA ====================
// Las mismas firmas que docs/js/database.js, lo justo para pendientes y eventos.

function crearSandbox() {
    let secuencia = 0;
    const nuevoId = () => ++secuencia;

    const estado = {
        pendientes: [],
        eventos: [],
        eliminaciones: [],
        gcalEliminados: [],
        refrescosUI: 0,
        sincronizaciones: 0
    };

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        Promise,
        Date,
        Map,
        Set,
        estado,
        nuevoId,

        // --- Capa de datos ---
        obtenerPendientes: async () => estado.pendientes.map(p => ({ ...p })),
        obtenerPendiente: async (id) => {
            const p = estado.pendientes.find(x => x.id === id);
            return p ? { ...p } : null;
        },
        agregarPendiente: async (p) => {
            const id = nuevoId();
            estado.pendientes.push({ ...p, id });
            return id;
        },
        actualizarPendiente: async (id, cambios) => {
            const p = estado.pendientes.find(x => x.id === id);
            if (!p) throw new Error('Pendiente no encontrado');
            Object.assign(p, cambios);
            return { ...p };
        },
        eliminarPendiente: async (id) => {
            estado.pendientes = estado.pendientes.filter(p => p.id !== id);
        },

        agregarEvento: async (ev) => {
            const id = nuevoId();
            estado.eventos.push({ ...ev, id });
            return id;
        },
        obtenerEventos: async () => estado.eventos.map(e => ({ ...e })),
        actualizarEvento: async (id, cambios) => {
            const e = estado.eventos.find(x => x.id === id);
            if (!e) throw new Error('Evento no encontrado');
            Object.assign(e, cambios);
            return { ...e };
        },
        eliminarEvento: async (id) => {
            estado.eliminaciones.push(id);
            estado.eventos = estado.eventos.filter(e => e.id !== id);
        },

        obtenerExpedientes: async () => [],
        obtenerExpediente: async () => null,

        // --- Ganchos de UI/sync (el núcleo los llama con guardas typeof) ---
        cargarPendientes: async () => { estado.refrescosUI++; },
        cargarExpedientes: async () => {},
        cargarEventos: async () => {},
        cargarNotas: async () => {},
        cargarEstadisticas: async () => {},
        renderizarCalendario: () => {},
        marcarYSincronizar: async () => { estado.sincronizaciones++; },

        // Google Calendar sin conectar: la copia de allá se anota para después.
        GCAL: {
            estaConectado: () => false,
            hookEliminarEvento: (id) => { estado.gcalEliminados.push(id); }
        }
    };

    sandbox.window = sandbox;
    vm.createContext(sandbox);

    vm.runInContext(fs.readFileSync(path.join(JS, 'acciones-core.js'), 'utf8'),
        sandbox, { filename: 'acciones-core.js' });

    return { sandbox, estado };
}

// Se saca de app.js la función real que decide si lo escrito lleva hora, para
// que renombrarla o cambiar su criterio se note aquí.
function cargarTieneHora() {
    const fuente = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    const lineas = fuente.split('\n');
    const inicio = lineas.findIndex(l => /^function _pendienteFechaTieneHora\s*\(/.test(l));
    if (inicio === -1) throw new Error('No se encontró _pendienteFechaTieneHora en app.js (¿se renombró?)');
    const fin = lineas.findIndex((l, i) => i > inicio && /^}/.test(l));
    const cuerpo = lineas.slice(inicio, fin + 1).join('\n');
    const ctx = { module: {} };
    vm.createContext(ctx);
    vm.runInContext(cuerpo + '\nmodule.exports = _pendienteFechaTieneHora;', ctx,
        { filename: 'app.js:_pendienteFechaTieneHora' });
    return ctx.module.exports;
}

// Saca de app.js varias funciones de nivel superior y las corre en el sandbox.
function cargarDeApp(sandbox, nombres) {
    const lineas = fs.readFileSync(path.join(JS, 'app.js'), 'utf8').split('\n');
    for (const nombre of nombres) {
        const inicio = lineas.findIndex(l => new RegExp(`^(async )?function ${nombre}\\s*\\(`).test(l));
        if (inicio === -1) throw new Error(`No se encontró ${nombre} en app.js (¿se renombró?)`);
        const fin = lineas.findIndex((l, i) => i > inicio && /^}/.test(l));
        vm.runInContext(lineas.slice(inicio, fin + 1).join('\n'), sandbox, { filename: 'app.js:' + nombre });
    }
}

// ==================== ARNÉS ====================

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

const EN_DOS_DIAS = new Date(Date.now() + 2 * 86400000);
const p2 = n => String(n).padStart(2, '0');
const fechaConHora = (h, m) => {
    const d = new Date(EN_DOS_DIAS);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
};

// ==================== PRUEBAS ====================

// La hora escrita en el formulario decide si el pendiente es de un día entero
// o de una hora. El <input type="datetime-local"> siempre devuelve hora, así
// que sin este criterio "para el 20" quedaba como algo a medianoche.
function pruebaLecturaDeLaHora() {
    const tieneHora = cargarTieneHora();
    igual('hora: "2026-09-20T10:30" lleva hora', tieneHora('2026-09-20T10:30'), true);
    igual('hora: "2026-09-20T00:00" es día completo', tieneHora('2026-09-20T00:00'), false);
    igual('hora: "2026-09-20T00:01" ya es una hora', tieneHora('2026-09-20T00:01'), true);
    igual('hora: con segundos también se lee', tieneHora('2026-09-20T09:15:00'), true);
    igual('hora: sin fecha no hay hora', tieneHora(''), false);
    igual('hora: un valor nulo no revienta', tieneHora(null), false);
}

// Lo que pidió el usuario: un pendiente con fecha ya no aparece en el calendario.
async function pruebaCrearNoAgenda() {
    const { sandbox, estado } = crearSandbox();

    const conHora = await sandbox.crearPendienteCore({
        titulo: 'Presentar pruebas', fechaLimite: fechaConHora(10, 30), todoElDia: false
    });
    await sandbox.crearPendienteCore({
        titulo: 'Vence el plazo', fechaLimite: fechaConHora(0, 0), todoElDia: true
    });

    igual('alta: no se crea ningún evento', estado.eventos.length, 0);
    igual('alta: ni queda vínculo', estado.pendientes.map(p => p.eventoId), [null, null]);
    const p = estado.pendientes.find(x => x.id === conHora);
    igual('alta: el pendiente conserva su fecha y hora', p.fechaLimite, fechaConHora(10, 30));
    igual('alta: y si es de un día o de una hora', p.todoElDia, false);
}

// Editar, terminar y reabrir tampoco agendan nada.
async function pruebaEditarNoAgenda() {
    const { sandbox, estado } = crearSandbox();
    const id = await sandbox.crearPendienteCore({ titulo: 'Sin fecha' });

    await sandbox.actualizarPendienteCore(id, { fechaLimite: fechaConHora(9, 0), todoElDia: false });
    igual('edición: ponerle fecha no lo agenda', estado.eventos.length, 0);
    await sandbox.completarPendienteCore(id, true);
    await sandbox.completarPendienteCore(id, false);
    igual('edición: terminarlo y reabrirlo tampoco', estado.eventos.length, 0);
    igual('edición: y la fecha sigue en el pendiente',
        estado.pendientes[0].fechaLimite, fechaConHora(9, 0));
}

// El caso de todos los días: pendientes agendados por versiones anteriores.
async function pruebaSacaLosEspejos() {
    const { sandbox, estado } = crearSandbox();

    const idP = await sandbox.agregarPendiente({
        titulo: 'Contestar demanda', descripcion: 'con pruebas', prioridad: 'alta',
        fechaLimite: fechaConHora(0, 0), completado: false, eventoId: null
    });
    const idE = await sandbox.agregarEvento({
        titulo: 'Contestar demanda', tipo: 'recordatorio', fechaInicio: fechaConHora(0, 0), todoElDia: true,
        descripcion: 'Pendiente del expediente.\n\ncon pruebas', pendienteId: idP, googleCalEventId: 'g-1'
    });
    await sandbox.actualizarPendiente(idP, { eventoId: idE });
    // Una audiencia y una cita de verdad, que se quedan.
    const idAud = await sandbox.agregarEvento({ titulo: 'Audiencia de pruebas', tipo: 'audiencia',
        fechaInicio: fechaConHora(10, 0), todoElDia: false });
    const idCita = await sandbox.agregarEvento({ titulo: 'Cita con el cliente', tipo: 'otro',
        fechaInicio: fechaConHora(17, 0), todoElDia: false });

    const r = await sandbox.sacarPendientesDelCalendarioCore();

    igual('limpieza: se quita el pendiente del calendario', r.retirados, 1);
    igual('limpieza: quedan la audiencia y la cita', estado.eventos.map(e => e.id), [idAud, idCita]);
    const p = estado.pendientes.find(x => x.id === idP);
    igual('limpieza: el pendiente sigue, sin vínculo', p.eventoId, null);
    igual('limpieza: con su fecha, prioridad y detalle',
        [p.fechaLimite, p.prioridad, p.descripcion], [fechaConHora(0, 0), 'alta', 'con pruebas']);
    igual('limpieza: y se cuenta como suelto', r.soltados, 1);
    igual('limpieza: su copia en Google Calendar también se borra (o se anota para borrarla)',
        estado.gcalEliminados, ['g-1']);
}

// Un respaldo viejo restauraba el espejo sin vínculo; y el de un pendiente
// ya terminado o borrado se quedaba huérfano. También se van.
async function pruebaSacaLosSueltos() {
    const { sandbox, estado } = crearSandbox();

    await sandbox.agregarEvento({ titulo: 'De un respaldo', tipo: 'recordatorio', fechaInicio: fechaConHora(0, 0),
        todoElDia: true, descripcion: 'Pendiente del expediente.' });
    await sandbox.agregarEvento({ titulo: 'De uno que ya no existe', tipo: 'recordatorio', fechaInicio: fechaConHora(0, 0),
        todoElDia: true, descripcion: 'Pendiente del expediente.', pendienteId: 999 });
    const idP = await sandbox.agregarPendiente({ titulo: 'Terminado', fechaLimite: fechaConHora(0, 0),
        completado: true, eventoId: null });
    await sandbox.agregarEvento({ titulo: 'Terminado', tipo: 'recordatorio', fechaInicio: fechaConHora(0, 0),
        todoElDia: true, descripcion: 'Pendiente del expediente.', pendienteId: idP });

    const r = await sandbox.sacarPendientesDelCalendarioCore();
    igual('sueltos: se van los tres', r.retirados, 3);
    igual('sueltos: el calendario queda vacío', estado.eventos.length, 0);
}

// Un eventoId heredado de un respaldo viejo puede apuntar a una audiencia
// real. Borrarla no tiene vuelta atrás; soltar el vínculo sí.
async function pruebaNoBorraLoQueNoEsSuEspejo() {
    const { sandbox, estado } = crearSandbox();

    const idAudiencia = await sandbox.agregarEvento({
        titulo: 'Audiencia de desahogo de pruebas', tipo: 'audiencia',
        fechaInicio: fechaConHora(0, 0), todoElDia: true
    });
    const idPendiente = await sandbox.agregarPendiente({
        titulo: 'Pendiente con un vínculo heredado', fechaLimite: fechaConHora(0, 0),
        completado: false, eventoId: idAudiencia
    });

    const r = await sandbox.sacarPendientesDelCalendarioCore();
    igual('prudencia: no se borra un evento que no es su espejo', r.retirados, 0);
    igual('prudencia: la audiencia sigue en el calendario', estado.eventos.map(e => e.id), [idAudiencia]);
    igual('prudencia: pero el vínculo equivocado se suelta',
        estado.pendientes.find(p => p.id === idPendiente).eventoId, null);

    // Lo mismo al editarlo o borrarlo.
    await sandbox.actualizarPendiente(idPendiente, { eventoId: idAudiencia });
    await sandbox.actualizarPendienteCore(idPendiente, { titulo: 'Otro título' });
    await sandbox.actualizarPendiente(idPendiente, { eventoId: idAudiencia });
    await sandbox.eliminarPendienteCore(idPendiente);
    igual('prudencia: editarlo o borrarlo tampoco se lleva la audiencia', estado.eventos.length, 1);
}

// El espejo que el usuario volvió audiencia con hora desde el calendario ya
// es una audiencia que él agendó: se queda, sin vínculo.
async function pruebaConservaLoQueSeVolvioAudiencia() {
    const { sandbox, estado } = crearSandbox();

    const idP = await sandbox.agregarPendiente({ titulo: 'Audiencia', fechaLimite: fechaConHora(0, 0),
        completado: false, eventoId: null });
    const idE = await sandbox.agregarEvento({ titulo: 'Audiencia inicial — sala 3', tipo: 'audiencia',
        fechaInicio: fechaConHora(11, 0), todoElDia: false, descripcion: 'Pendiente del expediente.', pendienteId: idP });
    await sandbox.actualizarPendiente(idP, { eventoId: idE });

    const r = await sandbox.sacarPendientesDelCalendarioCore();
    igual('audiencia: se queda en el calendario', estado.eventos.map(e => e.id), [idE]);
    igual('audiencia: tal como la dejó el usuario', estado.eventos[0].titulo, 'Audiencia inicial — sala 3');
    igual('audiencia: ya sin vínculo con el pendiente', [estado.eventos[0].pendienteId, estado.pendientes[0].eventoId], [null, null]);
    igual('audiencia: se cuenta como conservada', [r.retirados, r.conservados], [0, 1]);

    const otra = await sandbox.sacarPendientesDelCalendarioCore();
    igual('audiencia: la siguiente vuelta ya no la toca', otra, { retirados: 0, conservados: 0, soltados: 0 });
}

// Terminar o borrar un pendiente que trae su espejo de antes lo quita.
async function pruebaTerminarOBorrarQuitaElEspejo() {
    const { sandbox, estado } = crearSandbox();
    const espejoDe = async (idP) => {
        const idE = await sandbox.agregarEvento({ titulo: 'x', tipo: 'recordatorio', fechaInicio: fechaConHora(0, 0),
            todoElDia: true, descripcion: 'Pendiente del expediente.', pendienteId: idP });
        await sandbox.actualizarPendiente(idP, { eventoId: idE });
    };

    const a = await sandbox.agregarPendiente({ titulo: 'A', fechaLimite: fechaConHora(0, 0), completado: false, eventoId: null });
    const b = await sandbox.agregarPendiente({ titulo: 'B', fechaLimite: fechaConHora(0, 0), completado: false, eventoId: null });
    await espejoDe(a);
    await espejoDe(b);

    await sandbox.completarPendienteCore(a, true);
    igual('terminar: su espejo sale del calendario', estado.eventos.length, 1);
    igual('terminar: y queda sin vínculo', estado.pendientes.find(p => p.id === a).eventoId, null);
    await sandbox.eliminarPendienteCore(b);
    igual('borrar: su espejo también se va', estado.eventos.length, 0);
}

// Esto corre en CADA arranque y en cada sincronización: si no hay nada que
// limpiar, no se molesta a la UI ni a la nube, y dos vueltas seguidas no hacen nada más.
async function pruebaSilenciosaEIdempotente() {
    const { sandbox, estado } = crearSandbox();

    await sandbox.agregarPendiente({ titulo: 'Con fecha', fechaLimite: fechaConHora(0, 0), completado: false, eventoId: null });
    await sandbox.agregarEvento({ titulo: 'Audiencia', tipo: 'audiencia', fechaInicio: fechaConHora(9, 0), todoElDia: false });

    estado.sincronizaciones = 0;
    estado.refrescosUI = 0;
    const r = await sandbox.sacarPendientesDelCalendarioCore();
    igual('silencio: no hubo nada que quitar', r, { retirados: 0, conservados: 0, soltados: 0 });
    igual('silencio: no se repinta la interfaz', estado.refrescosUI, 0);
    igual('silencio: no se sube nada a la nube', estado.sincronizaciones, 0);
    igual('silencio: y no se crea nada', estado.eventos.length, 1);
}

// El sync ya está en mitad de una vuelta cuando llama: si la limpieza
// disparara otra subida, chocaría con la que está en curso.
async function pruebaNoSubeCuandoElSyncLoPide() {
    const conEspejo = async () => {
        const caja = crearSandbox();
        await caja.sandbox.agregarEvento({ titulo: 'Espejo', tipo: 'recordatorio', fechaInicio: fechaConHora(0, 0),
            todoElDia: true, descripcion: 'Pendiente del expediente.', pendienteId: 50 });
        caja.estado.sincronizaciones = 0;
        return caja;
    };

    const desdeSync = await conEspejo();
    const r = await desdeSync.sandbox.sacarPendientesDelCalendarioCore({ sincronizar: false });
    igual('desde sync: el espejo se quita igual', r.retirados, 1);
    igual('desde sync: pero no se dispara otra subida', desdeSync.estado.sincronizaciones, 0);

    const desdeArranque = await conEspejo();
    await desdeArranque.sandbox.sacarPendientesDelCalendarioCore();
    igual('desde el arranque: sí se sube la limpieza', desdeArranque.estado.sincronizaciones > 0, true);
}

// Que falle la base de datos no puede tumbar el arranque ni el sync.
async function pruebaNoTumbaNada() {
    const { sandbox } = crearSandbox();
    sandbox.obtenerPendientes = async () => { throw new Error('base caída'); };
    // El fallo se registra en consola a propósito; aquí se calla para no
    // ensuciar la salida de las pruebas con un error que estamos provocando.
    const quejas = [];
    sandbox.console = { ...console, error: (...a) => quejas.push(a) };

    let resumen = null;
    try {
        resumen = await sandbox.sacarPendientesDelCalendarioCore();
    } catch (e) {
        verificar('robustez: un fallo de la base no se propaga', false, e.message);
        return;
    }
    igual('robustez: un fallo de la base no se propaga', resumen, { retirados: 0, conservados: 0, soltados: 0 });
    verificar('robustez: pero queda anotado en la consola', quejas.length > 0);
}

// La conexión con Google dura lo que la sesión. Lo que se borra en la app
// mientras no hay conexión (como los pendientes que se sacan al arrancar)
// se anota y se borra allá en cuanto se conecta.
async function pruebaGoogleCalendarBorraAlConectar() {
    const guardado = {};
    const llamadas = [];
    let callbackToken = null;
    const sb = {
        console, Date, JSON, Promise, Array, String, setTimeout,
        location: { origin: 'https://ejemplo.test' },
        localStorage: {
            getItem: (k) => (k in guardado ? guardado[k] : null),
            setItem: (k, v) => { guardado[k] = String(v); },
            removeItem: (k) => { delete guardado[k]; }
        },
        document: { getElementById: () => ({}) },   // GSI "ya cargado"
        fetch: async (url, opts) => {
            llamadas.push(opts.method + ' ' + url.split('/').pop());
            if (url.endsWith('/ya-no-estaba')) return { status: 410, ok: false, json: async () => ({ error: { message: 'Resource has been deleted' } }) };
            if (url.endsWith('/falla')) return { status: 500, ok: false, json: async () => ({ error: { message: 'Backend Error' } }) };
            return { status: 204, ok: true, json: async () => null };
        }
    };
    sb.window = sb;
    sb.google = { accounts: { oauth2: { initTokenClient: (cfg) => {
        callbackToken = cfg.callback;
        return { requestAccessToken: () => cfg.callback({ access_token: 't', expires_in: 3600 }) };
    } } } };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(JS, 'gcal-sync.js'), 'utf8') + '\nthis.GCAL = GCAL;', sb, { filename: 'gcal-sync.js' });
    const GCAL = sb.GCAL;

    sb.localStorage.setItem('gcal_client_id', 'cliente.apps.googleusercontent.com');
    await GCAL.hookEliminarEvento('g-1');
    await GCAL.hookEliminarEvento('ya-no-estaba');
    await GCAL.hookEliminarEvento('falla');
    await GCAL.hookEliminarEvento('g-1');
    igual('google: sin conexión no se llama a Google', llamadas, []);
    igual('google: se anota cada copia una sola vez', JSON.parse(guardado.gcal_por_eliminar), ['g-1', 'ya-no-estaba', 'falla']);

    await GCAL.obtenerToken();
    for (let i = 0; i < 5 && llamadas.length < 3; i++) await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    igual('google: al conectar se borran allá', llamadas, ['DELETE g-1', 'DELETE ya-no-estaba', 'DELETE falla']);
    igual('google: lo que falló se reintenta la próxima vez; lo que ya no estaba, no',
        JSON.parse(guardado.gcal_por_eliminar || '[]'), ['falla']);

    // Ya conectado, se borra al momento.
    await GCAL.hookEliminarEvento('g-2');
    igual('google: conectado, se borra en el acto', llamadas[llamadas.length - 1], 'DELETE g-2');

    // Sin Google Calendar configurado no se anota nada.
    delete guardado.gcal_client_id;
    delete guardado.gcal_por_eliminar;
    await GCAL.hookEliminarEvento('g-3');
    igual('google: sin configurar no se anota nada', guardado.gcal_por_eliminar, undefined);
    verificar('google: se usó el flujo de token', typeof callbackToken === 'function');
}

// El análisis IA de un acuerdo: la audiencia va al calendario; un plazo o un
// "hay que hacer" va a Pendientes, con el contexto del acuerdo.
async function pruebaAnalisisIA() {
    const { sandbox, estado } = crearSandbox();
    cargarDeApp(sandbox, ['parsearHoraIA', 'construirEventoIA', 'construirPendienteIA', '_fechaIAVaAlCalendario', 'guardarFechaIA']);
    const ctx = { expedienteId: 7, expedienteTexto: '123/2025', expedienteLabel: '123/2025', institucion: 'TSJ',
        juzgadoOrigen: 'Juzgado Primero Civil', tipoAcuerdo: 'auto', resumen: 'Se admite la demanda' };

    const a = await sandbox.guardarFechaIA({ tipo: 'audiencia', fecha: '2026-12-03', hora: '10:30', descripcion: 'Audiencia de pruebas' }, ctx);
    const v = await sandbox.guardarFechaIA({ tipo: 'vencimiento', fecha: '2026-12-10', hora: null, descripcion: 'Contestar la demanda' }, ctx);
    const r = await sandbox.guardarFechaIA({ tipo: 'recordatorio', fecha: '2026-12-11', hora: '9:00', descripcion: '' }, ctx);

    igual('IA: la audiencia va al calendario; lo demás, a Pendientes', [a, v, r], ['evento', 'pendiente', 'pendiente']);
    igual('IA: en el calendario solo queda la audiencia', estado.eventos.map(e => e.tipo), ['audiencia']);
    igual('IA: con su hora', new Date(estado.eventos[0].fechaInicio).getHours(), 10);
    igual('IA: el plazo y el recordatorio son pendientes', estado.pendientes.length, 2);
    const plazo = estado.pendientes.find(p => p.titulo === 'Contestar la demanda');
    verificar('IA: el plazo es un pendiente con su título', !!plazo);
    igual('IA: de su expediente', plazo.expedienteId, 7);
    igual('IA: con la fecha límite, de día completo',
        [new Date(plazo.fechaLimite).getDate(), new Date(plazo.fechaLimite).getHours(), plazo.todoElDia], [10, 0, true]);
    verificar('IA: y el contexto del acuerdo', /Juzgado Primero Civil/.test(plazo.descripcion) && /Se admite la demanda/.test(plazo.descripcion),
        plazo.descripcion);
    const otro = estado.pendientes.find(p => p !== plazo);
    igual('IA: sin descripción se le pone un título', otro.titulo, 'Recordatorio del acuerdo');
    igual('IA: con hora no es de día completo', [new Date(otro.fechaLimite).getHours(), otro.todoElDia], [9, false]);

    let fallo = null;
    try { await sandbox.guardarFechaIA({ tipo: 'vencimiento', fecha: 'el lunes' }, ctx); } catch (e) { fallo = e; }
    verificar('IA: una fecha rota se avisa en vez de guardar basura', !!fallo && estado.pendientes.length === 2);
}

// El asistente: un "recordatorio" de algo que hay que hacer es un pendiente.
function pruebaAsistenteMandaRecordatoriosAPendientes() {
    const voz = fs.readFileSync(path.join(JS, 'voice-assistant.js'), 'utf8');
    verificar('asistente: sabe que el calendario es solo para audiencias y citas',
        /El CALENDARIO es solo para audiencias y citas/.test(voz));
    verificar('asistente: un recordatorio de hacer algo es crear_pendiente',
        /NO es un evento: es crear_pendiente/.test(voz));
    verificar('asistente: el ejemplo del grupo (AHO) crea pendientes, no eventos',
        /todos los asuntos de AHO" → acciones:\[\{accion:"crear_pendiente"/.test(voz));
    verificar('asistente: ya no promete agendar un pendiente', !/creado\$\{conPrioridad\} y agendado/.test(voz));
}

// ==================== EJECUCIÓN ====================

(async () => {
    console.log('\n  Los pendientes no van al calendario\n');

    pruebaLecturaDeLaHora();
    await pruebaCrearNoAgenda();
    await pruebaEditarNoAgenda();
    await pruebaSacaLosEspejos();
    await pruebaSacaLosSueltos();
    await pruebaNoBorraLoQueNoEsSuEspejo();
    await pruebaConservaLoQueSeVolvioAudiencia();
    await pruebaTerminarOBorrarQuitaElEspejo();
    await pruebaSilenciosaEIdempotente();
    await pruebaNoSubeCuandoElSyncLoPide();
    await pruebaNoTumbaNada();
    await pruebaGoogleCalendarBorraAlConectar();
    await pruebaAnalisisIA();
    pruebaAsistenteMandaRecordatoriosAPendientes();

    console.log(`  ${pasadas} pasadas, ${fallos.length} fallidas\n`);
    if (fallos.length > 0) {
        fallos.forEach(f => console.log('   ✗ ' + f));
        process.exit(1);
    }
    console.log('  ✓ En el calendario solo quedan audiencias y citas\n');
})();
