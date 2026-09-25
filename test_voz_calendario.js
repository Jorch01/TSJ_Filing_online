#!/usr/bin/env node
/**
 * Pruebas de "cambia la audiencia del jueves para el viernes a las 12" dictado
 * al asistente.
 *
 *   node test_voz_calendario.js
 *
 * Lo que fallaba al pedirle al asistente que cambiara un evento:
 *
 *   - La agenda que veía el modelo iba en UTC: una audiencia de las 10:00 en
 *     Cancún le aparecía a las 15:00, y una de las 20:00 al día siguiente, así
 *     que "la audiencia del jueves" podía ser la del viernes.
 *   - Solo veía una parte del calendario y, si el evento no estaba ahí, no había
 *     forma de nombrarlo.
 *   - Una descripción vacía que el modelo rellenaba "por si acaso" borraba la
 *     que había.
 *   - No se podían cambiar varios eventos de una vez ni añadir texto a la
 *     descripción sin reescribirla.
 *
 * Todo corre con el reloj en Cancún. Se carga el código real de docs/js/: el
 * núcleo de acciones completo y las partes del asistente que resuelven y
 * aplican los cambios, sobre una base de datos simulada.
 */

process.env.TZ = 'America/Cancun';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, 'docs', 'js');
const VOZ = fs.readFileSync(path.join(JS, 'voice-assistant.js'), 'utf8');

function extraerIndentado(fuente, nombre) {
    const re = new RegExp('^([ \\t]*)(?:async )?function ' + nombre + '\\s*\\([\\s\\S]*?\\n\\1\\}', 'm');
    const m = re.exec(fuente);
    if (!m) throw new Error(`No se encontró "${nombre}" en voice-assistant.js (¿se renombró?)`);
    return m[0];
}

function extraerConstante(fuente, nombre) {
    const m = new RegExp('^[ \\t]*const ' + nombre + ' = [^\\n]*;$', 'm').exec(fuente);
    if (!m) throw new Error(`No se encontró la constante ${nombre} en voice-assistant.js`);
    return m[0].trim();
}

function extraerSeccion(fuente, titulo) {
    const marca = fuente.indexOf('// ==================== ' + titulo);
    if (marca === -1) throw new Error(`No se encontró la sección "${titulo}" en voice-assistant.js`);
    const siguiente = fuente.indexOf('// ====================', marca + 30);
    return fuente.slice(marca, siguiente === -1 ? undefined : siguiente);
}

// Un instante en hora de Cancún, como lo guarda la app.
const iso = (anio, mes, dia, hora = 0, min = 0) => new Date(anio, mes - 1, dia, hora, min).toISOString();
// Relativo a hoy, para lo que depende de qué ya pasó.
const enDias = (dias, hora = 10) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    d.setHours(hora, 0, 0, 0);
    return d.toISOString();
};

function crearSandbox() {
    let secuencia = 100;
    const estado = { eventos: [], expedientes: [], archivados: [], mensajes: [] };
    const copia = (x) => JSON.parse(JSON.stringify(x));

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Map, Set, Promise, JSON, Object, Array, String, Number, isNaN, parseInt, setTimeout,
        estado,
        // --- Base de datos simulada, con las firmas de database.js ---
        obtenerEventos: async () => copia(estado.eventos),
        agregarEvento: async (ev) => { const id = ++secuencia; estado.eventos.push({ ...copia(ev), id }); return id; },
        actualizarEvento: async (id, cambios) => {
            const e = estado.eventos.find(x => x.id === id);
            if (!e) throw new Error('Evento no encontrado');
            Object.assign(e, copia(cambios));
        },
        eliminarEvento: async (id) => { estado.eventos = estado.eventos.filter(e => e.id !== id); },
        obtenerExpedientes: async () => copia(estado.expedientes),
        obtenerExpedientesArchivados: async () => copia(estado.archivados),
        obtenerExpediente: async (id) => copia(estado.expedientes.concat(estado.archivados).find(e => e.id === id) || null),
        obtenerCarpetas: async () => [],
        obtenerPendiente: async () => null,
        // --- Lo que el asistente pinta o dice: se anota ---
        agregarMensaje: (rol, html) => { estado.mensajes.push(html); return null; },
        esc: (t) => String(t == null ? '' : t),
        hablar: () => {},
        pedirConfirmacion: () => {},
        informarFallo: () => {}
    };
    sb.window = sb;
    vm.createContext(sb);

    // El núcleo de acciones de verdad: guarda, refleja en pendientes, ajusta.
    vm.runInContext(fs.readFileSync(path.join(JS, 'acciones-core.js'), 'utf8'), sb, { filename: 'acciones-core.js' });

    // Del asistente: estado, ayudantes, deshacer y la sección de eventos.
    vm.runInContext('var pilaDeshacer = []; var conversacion = [];', sb);
    for (const n of ['normalizar', 'pad', 'normalizarHora', 'fechaLocalISO', 'toast',
                     'registrarDeshacer', 'accDeshacer', 'ErrorAviso', 'agendaParaElModelo']) {
        vm.runInContext(extraerIndentado(VOZ, n), sb, { filename: 'voice-assistant.js:' + n });
    }
    for (const n of ['TOPE_AGENDA', 'DIAS_SEMANA']) {
        vm.runInContext(extraerConstante(VOZ, n), sb, { filename: 'voice-assistant.js:' + n });
    }
    vm.runInContext(extraerSeccion(VOZ, 'CAMBIOS A EVENTOS'), sb, { filename: 'voice-assistant.js:eventos' });

    return { sb, estado };
}

function evento(id, titulo, fechaInicio, extra = {}) {
    return { id, titulo, fechaInicio, tipo: 'audiencia', todoElDia: false, descripcion: '', alerta: true, ...extra };
}

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
async function lanza(fn) {
    try { await fn(); return null; } catch (e) { return e; }
}

// ==================== FECHA, HORA Y DESCRIPCIÓN ====================

async function pruebaFechaYHora() {
    const { sb, estado } = crearSandbox();
    estado.expedientes.push({ id: 7, numero: '123/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' });
    estado.eventos.push(evento(1, 'Audiencia constitucional', iso(2026, 10, 1, 10), { expedienteId: 7, descripcion: 'Sala 3' }));

    const r = await sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { fecha: '2026-10-02', hora: '12:00' } }] });
    igual('fecha: la nueva fecha y hora, en hora de Cancún', estado.eventos[0].fechaInicio, iso(2026, 10, 2, 12));
    verificar('fecha: la respuesta dice cuándo queda, en hora local',
        /viernes, 2 de octubre/.test(r) && /12:00/.test(r), r);

    // La forma antigua de los parámetros sigue sirviendo.
    await sb.accEditarEvento({ eventoId: 1, cambios: { hora: '9:30' } });
    igual('fecha: {eventoId, cambios} a la antigua también', estado.eventos[0].fechaInicio, iso(2026, 10, 2, 9, 30));

    // Recorrer días lo calcula la app, sobre la fecha real, cruzando de mes.
    estado.eventos.push(evento(2, 'Vence plazo', iso(2026, 9, 28, 10), { tipo: 'vencimiento' }));
    await sb.accEditarEvento({ ediciones: [{ eventoId: 2, cambios: { moverDias: 7 } }] });
    igual('mover: una semana después, cruzando de mes y a la misma hora', estado.eventos[1].fechaInicio, iso(2026, 10, 5, 10));
    await sb.accEditarEvento({ ediciones: [{ eventoId: 2, cambios: { moverDias: -2 } }] });
    igual('mover: y dos días antes', estado.eventos[1].fechaInicio, iso(2026, 10, 3, 10));

    // Con hora deja de ser "todo el día", aunque el modelo diga lo contrario.
    estado.eventos.push(evento(3, 'Recordatorio', iso(2026, 10, 10, 9), { todoElDia: true }));
    await sb.accEditarEvento({ ediciones: [{ eventoId: 3, cambios: { hora: '16:00', todoElDia: true } }] });
    igual('hora: con hora ya no es de día completo', estado.eventos[2].todoElDia, false);
    igual('hora: y queda a esa hora del mismo día', estado.eventos[2].fechaInicio, iso(2026, 10, 10, 16));

    // Un evento de todo el día que solo cambia de día sigue siendo de todo el día.
    estado.eventos.push(evento(4, 'Feriado', iso(2026, 11, 2, 9), { todoElDia: true }));
    await sb.accEditarEvento({ ediciones: [{ eventoId: 4, cambios: { fecha: '2026-11-03' } }] });
    igual('todo el día: cambia de día y sigue siendo de todo el día',
        [estado.eventos[3].fechaInicio, estado.eventos[3].todoElDia], [iso(2026, 11, 3, 9), true]);
    // El modelo suele mandar todoElDia:false "de relleno": sin hora no manda.
    await sb.accEditarEvento({ ediciones: [{ eventoId: 4, cambios: { fecha: '2026-11-04', todoElDia: false } }] });
    igual('todo el día: un todoElDia:false sin hora no lo convierte en cita', estado.eventos[3].todoElDia, true);
    // Quitarle la hora a uno que la tiene, sí.
    await sb.accEditarEvento({ ediciones: [{ eventoId: 3, cambios: { todoElDia: true } }] });
    igual('todo el día: quitarle la hora a una cita sí se puede', estado.eventos[2].todoElDia, true);

    const antesDelIntento = estado.eventos[3].fechaInicio;
    const mala = await lanza(() => sb.accEditarEvento({ ediciones: [{ eventoId: 4, cambios: { fecha: 'el martes' } }] }));
    verificar('fecha: una fecha que no se entiende se avisa, sin tocar nada',
        mala && mala._esAviso && estado.eventos[3].fechaInicio === antesDelIntento, mala && mala.message);
}

async function pruebaDescripcion() {
    const { sb, estado } = crearSandbox();
    estado.eventos.push(evento(1, 'Audiencia', iso(2026, 10, 1, 10), { descripcion: 'Sala 3' }));
    const desc = () => estado.eventos[0].descripcion;

    // El caso que borraba descripciones: el modelo manda todos los campos.
    await sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { fecha: '2026-10-02', descripcion: '', titulo: '' } }] });
    igual('descripción: un campo vacío del modelo NO la borra', desc(), 'Sala 3');
    igual('descripción: ni el título vacío lo borra', estado.eventos[0].titulo, 'Audiencia');

    await sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { agregarDescripcion: 'Llevar testigos' } }] });
    igual('descripción: agregar la conserva y añade al final', desc(), 'Sala 3\nLlevar testigos');

    await sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { descripcion: 'Presentar alegatos' } }] });
    igual('descripción: reemplazar la cambia entera', desc(), 'Presentar alegatos');

    await sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { borrarDescripcion: true } }] });
    igual('descripción: y borrarla la deja vacía', desc(), '');

    await sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { titulo: 'Audiencia de pruebas', tipo: 'vencimiento' } }] });
    igual('título y tipo: también se cambian', [estado.eventos[0].titulo, estado.eventos[0].tipo], ['Audiencia de pruebas', 'vencimiento']);

    const nada = await lanza(() => sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { titulo: 'Audiencia de pruebas' } }] }));
    verificar('sin cambios: si ya está así, se dice', nada && nada._esAviso && /ya está así/.test(nada.message), nada && nada.message);
    const vacio = await lanza(() => sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: {} }] }));
    verificar('sin cambios: si no pidió nada, pregunta qué', vacio && vacio._esAviso && /Qué quieres cambiar/.test(vacio.message),
        vacio && vacio.message);
}

// ==================== CUÁL EVENTO ====================

async function pruebaIdentificarElEvento() {
    const { sb, estado } = crearSandbox();
    estado.expedientes.push({ id: 7, numero: '123/2025' }, { id: 8, numero: '1123/2025' });
    estado.eventos.push(
        evento(1, 'Audiencia constitucional', enDias(-20), { expedienteId: 7 }),
        evento(2, 'Audiencia constitucional', enDias(10), { expedienteId: 7 }),
        evento(3, 'Vencimiento contestación', enDias(12), { expedienteId: 8, tipo: 'vencimiento' }),
        evento(4, 'Junta con el cliente', iso(2026, 10, 1, 20), { tipo: 'otro' }),
        evento(5, 'Junta con el perito', iso(2026, 10, 1, 9), { tipo: 'otro' })
    );
    const resolver = async (ref) => {
        const expedientes = await sb.mapaDeExpedientes();
        return sb.resolverEventoReferido(ref, await sb.obtenerEventos(), expedientes, 0);
    };

    // Por el expediente, dictado como se dicta. Y "123" no es "1123".
    const porExp = await resolver({ buscar: { expediente: '123 diagonal 2025', tipo: 'audiencia' } });
    igual('cuál: por expediente dictado, la audiencia que viene (no la pasada)', porExp.id, 2);
    const conCeros = await resolver({ buscar: { expediente: '0123/2025' } });
    igual('cuál: los ceros a la izquierda dan igual', conCeros.id, 2);
    const conPalabra = await resolver({ buscar: { expediente: 'expediente 123/2025' } });
    igual('cuál: "expediente 123/2025" también', conPalabra.id, 2);
    const sinAnio = await resolver({ buscar: { expediente: 'el 1123' } });
    igual('cuál: y "el 1123", sin el año', sinAnio.id, 3);
    const enElTexto = await resolver({ buscar: { texto: 'vencimiento 1123 diagonal 2025' } });
    igual('cuál: el número dictado dentro del texto también sirve', enElTexto.id, 3);
    const porNumero = await resolver({ buscar: { expediente: '1123/2025' } });
    igual('cuál: "1123/2025" no se confunde con "123/2025"', porNumero.id, 3);

    // Por la fecha que tiene AHORA, en hora local: la junta de las 20:00 es del 1.
    const porFecha = await resolver({ buscar: { texto: 'junta', fecha: '2026-10-01', hora: '20:00' } });
    igual('cuál: por fecha y hora locales (las 20:00 siguen siendo el día 1)', porFecha.id, 4);

    // Varios que encajan: se ofrecen, ordenados, en vez de escoger uno.
    const varios = await lanza(() => resolver({ buscar: { texto: 'junta', fecha: '2026-10-01' } }));
    verificar('cuál: si encajan varios, se pregunta', varios && varios._eleccionEvento, varios && varios.message);
    igual('cuál: con los candidatos en orden', varios && varios._eleccionEvento.candidatos.map(e => e.id), [5, 4]);

    const ninguno = await lanza(() => resolver({ buscar: { texto: 'mediación' } }));
    verificar('cuál: si no hay ninguno, se avisa', ninguno && ninguno._esAviso && /No encontré/.test(ninguno.message),
        ninguno && ninguno.message);

    // Un id que no existe no manda: se busca con lo demás.
    const idViejo = await resolver({ eventoId: 999, buscar: { texto: 'perito' } });
    igual('cuál: un id que ya no existe cae a la búsqueda', idViejo.id, 5);

    // Y la orden completa, sin id, con la elección resuelta al llegar.
    await sb.accEditarEvento({ ediciones: [{ eventoId: null, buscar: { expediente: '123/2025', tipo: 'audiencia' }, cambios: { moverDias: 1 } }] });
    igual('cuál: la orden sin id cambia el evento correcto',
        estado.eventos.find(e => e.id === 2).fechaInicio, new Date(new Date(enDias(10)).getTime() + 864e5).toISOString());
    igual('cuál: y deja la pasada como estaba', estado.eventos.find(e => e.id === 1).fechaInicio, enDias(-20));
}

// ==================== VARIOS A LA VEZ Y DESHACER ====================

async function pruebaVariosYDeshacer() {
    const { sb, estado } = crearSandbox();
    estado.eventos.push(
        evento(1, 'Audiencia A', iso(2026, 10, 5, 10)),
        evento(2, 'Audiencia B', iso(2026, 10, 5, 12)),
        evento(3, '10:00 — Audiencia C [Exp. 9/2026]', iso(2026, 10, 7, 10))
    );

    const plan = await sb.planEditarEventos({ ediciones: [
        { eventoId: 1, cambios: { fecha: '2026-10-06' } },
        { eventoId: 2, cambios: { fecha: '2026-10-06' } }
    ] });
    igual('varios: el plan trae los dos', plan.items.length, 2);
    verificar('varios: y la confirmación enseña el antes y el después en hora local',
        plan.detalles.some(d => /lunes, 5 de octubre, 10:00 → martes, 6 de octubre, 10:00/.test(d)), JSON.stringify(plan.detalles));
    verificar('varios: el resumen dice cuántos', /Cambiar 2 eventos/.test(plan.resumen), plan.resumen);

    await sb.aplicarEdicionesEventos(plan);
    igual('varios: los dos quedan el martes a su hora',
        [estado.eventos[0].fechaInicio, estado.eventos[1].fechaInicio], [iso(2026, 10, 6, 10), iso(2026, 10, 6, 12)]);

    await sb.accDeshacer();
    igual('deshacer: vuelven los dos a su fecha',
        [estado.eventos[0].fechaInicio, estado.eventos[1].fechaInicio], [iso(2026, 10, 5, 10), iso(2026, 10, 5, 12)]);

    // Dos órdenes para el mismo evento se juntan en una.
    const junto = await sb.planEditarEventos({ ediciones: [
        { eventoId: 1, cambios: { hora: '11:00' } },
        { eventoId: 1, cambios: { agregarDescripcion: 'Traer INE' } }
    ] });
    igual('varios: dos órdenes sobre el mismo evento son un solo cambio', junto.items.length, 1);

    // El título con la hora escrita (análisis IA) se pone al día, y deshacer lo regresa.
    await sb.accEditarEvento({ ediciones: [{ eventoId: 3, cambios: { hora: '13:30' } }] });
    igual('hora escrita: el título pasa a decir 13:30', estado.eventos[2].titulo, '13:30 — Audiencia C [Exp. 9/2026]');
    await sb.accDeshacer();
    igual('deshacer: regresa la hora y el título', [estado.eventos[2].fechaInicio, estado.eventos[2].titulo],
        [iso(2026, 10, 7, 10), '10:00 — Audiencia C [Exp. 9/2026]']);
}

// ==================== EXPEDIENTE DEL EVENTO ====================

async function pruebaExpedienteDelEvento() {
    const { sb, estado } = crearSandbox();
    estado.expedientes.push({ id: 7, numero: '123/2025' }, { id: 8, numero: '456/2025' }, { id: 9, numero: '456/2024' });
    estado.eventos.push(evento(1, 'Audiencia', iso(2026, 10, 5, 10), { expedienteId: 7 }));

    await sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { expedienteRef: '456/2025' } }] });
    igual('expediente: se pasa el evento al que se nombra', estado.eventos[0].expedienteId, 8);

    const ambiguo = await lanza(() => sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { expedienteRef: 'el 456' } }] }));
    verificar('expediente: si encajan varios, pide precisarlo', ambiguo && ambiguo._esAviso && /456\/2024/.test(ambiguo.message),
        ambiguo && ambiguo.message);
    igual('expediente: sin tocar el evento', estado.eventos[0].expedienteId, 8);

    await sb.accEditarEvento({ ediciones: [{ eventoId: 1, cambios: { sinExpediente: true } }] });
    igual('expediente: y se puede desvincular', estado.eventos[0].expedienteId, null);
}

// ==================== ELIMINAR ====================

async function pruebaEliminar() {
    const { sb, estado } = crearSandbox();
    estado.eventos.push(
        evento(1, 'Recordatorio pagar copias', iso(2026, 10, 5, 9), { tipo: 'recordatorio' }),
        evento(2, 'Recordatorio llamar perito', iso(2026, 10, 5, 11), { tipo: 'recordatorio' }),
        evento(3, 'Audiencia', iso(2026, 10, 5, 12))
    );
    const plan = await sb.planEliminarEventos({ eventos: [
        { buscar: { texto: 'copias' } }, { buscar: { texto: 'perito', fecha: '2026-10-05' } }
    ] });
    igual('eliminar: identifica los dos por lo que se dijo', plan.items.map(x => x.evento.id), [1, 2]);
    await sb.aplicarEliminacionEventos(plan);
    igual('eliminar: se van los dos y queda la audiencia', estado.eventos.map(e => e.titulo), ['Audiencia']);
    await sb.accDeshacer();
    igual('deshacer: vuelven los dos', estado.eventos.length, 3);
}

// ==================== LA AGENDA QUE VE EL MODELO ====================

function pruebaAgendaParaElModelo() {
    const { sb } = crearSandbox();
    const hoy = new Date(2026, 8, 25, 12).getTime();   // 25 de septiembre de 2026, mediodía
    const expedientes = new Map([[7, { id: 7, numero: '123/2025' }]]);
    const eventos = [
        evento(1, 'Junta', iso(2026, 10, 1, 20), { expedienteId: 7, descripcion: 'x'.repeat(200) }),
        evento(2, 'Vence', iso(2026, 10, 2, 0), { todoElDia: true, tipo: 'vencimiento' })
    ];
    const { lista, total } = sb.agendaParaElModelo(eventos, expedientes, hoy);
    igual('agenda: van los dos', total, 2);
    const junta = lista.find(e => e.id === 1);
    igual('agenda: la fecha es la local (las 20:00 del 1 no son el día 2)', junta.fecha, '2026-10-01');
    igual('agenda: con su hora local', junta.hora, '20:00');
    igual('agenda: y el día de la semana', junta.dia, 'jueves');
    igual('agenda: con el número del expediente, no solo su id', junta.expediente, '123/2025');
    verificar('agenda: la descripción va recortada', junta.descripcion.length <= 81, String(junta.descripcion.length));
    verificar('agenda: sin el instante en UTC que confundía al modelo', !('fechaInicio' in junta));
    igual('agenda: un evento de todo el día va sin hora', lista.find(e => e.id === 2).hora, null);

    // Muchos: van los próximos primero y algunos recientes; lo de hace meses no.
    const muchos = [];
    for (let i = 0; i < 200; i++) muchos.push(evento(1000 + i, 'Futuro ' + i, new Date(hoy + (i + 1) * 864e5).toISOString()));
    for (let i = 0; i < 50; i++) muchos.push(evento(2000 + i, 'Pasado ' + i, new Date(hoy - (i + 1) * 864e5 / 2).toISOString()));
    muchos.push(evento(3000, 'Muy viejo', new Date(hoy - 200 * 864e5).toISOString()));
    const recorte = sb.agendaParaElModelo(muchos, new Map(), hoy);
    igual('agenda: se recorta al tope', recorte.lista.length, 150);
    igual('agenda: y dice cuántos hay en total', recorte.total, 251);
    verificar('agenda: el próximo evento está', recorte.lista.some(e => e.id === 1000));
    verificar('agenda: el más reciente del pasado también', recorte.lista.some(e => e.id === 2000));
    verificar('agenda: lo de hace meses no ocupa sitio', !recorte.lista.some(e => e.id === 3000));
    verificar('agenda: va en orden', recorte.lista.every((e, i, a) => i === 0 || (a[i - 1].fecha + (a[i - 1].hora || '')) <= (e.fecha + (e.hora || ''))));
}

// ==================== LAS INSTRUCCIONES AL MODELO ====================

function pruebaInstrucciones() {
    verificar('prompt: editar_evento admite varias ediciones', /"editar_evento": \{ediciones:\[/.test(VOZ));
    verificar('prompt: se explica cómo nombrar un evento que no está en la lista', /llena "buscar"/.test(VOZ));
    verificar('prompt: se pide mandar solo lo que cambia', /pon SOLO lo que quiere cambiar/.test(VOZ));
    verificar('prompt: se explica moverDias', /moverDias: entero/.test(VOZ));
    verificar('prompt: y agregar a la descripción sin borrarla', /agregarDescripcion: AÑADE/.test(VOZ));
    verificar('prompt: se avisa de que la agenda ya va en hora local', /YA están en hora local de Cancún/.test(VOZ));
    verificar('prompt: la agenda ya no manda fechaInicio en UTC', !/fechaInicio: e\.fechaInicio, expedienteId/.test(VOZ));
}

(async () => {
    const pruebas = [
        ['fecha y hora', pruebaFechaYHora],
        ['descripción', pruebaDescripcion],
        ['identificar el evento', pruebaIdentificarElEvento],
        ['varios a la vez y deshacer', pruebaVariosYDeshacer],
        ['expediente del evento', pruebaExpedienteDelEvento],
        ['eliminar', pruebaEliminar],
        ['la agenda que ve el modelo', pruebaAgendaParaElModelo],
        ['las instrucciones al modelo', pruebaInstrucciones]
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
    console.log('  ✓ El asistente cambia el evento que se le dice, como se le dice.\n');
})();
