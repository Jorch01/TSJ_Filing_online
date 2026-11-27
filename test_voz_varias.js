#!/usr/bin/env node
/**
 * Pruebas de las órdenes múltiples al asistente: "crea un recordatorio para el
 * viernes en los tres asuntos de AHO".
 *
 *   node test_voz_varias.js
 *
 * Lo que pasaba: el modelo solo podía devolver UNA acción por orden, así que
 * pedirle el mismo recordatorio para varios expedientes terminaba en "no puedo
 * manejar esa petición". Ahora existe la acción "varias":
 *
 *   - una entrada por expediente, o una con paraTodosLosDe para un grupo entero
 *     (una carpeta, un cliente, un tipo de asunto, un responsable…);
 *   - TODO se prepara antes de confirmar: si un expediente no se identifica, o
 *     falta el título o la fecha, no se hace nada a medias;
 *   - se aplica como un lote (un repintado, una subida a la nube) y un solo
 *     "deshaz lo último" revierte todo.
 *
 * Se carga el código real de docs/js/: el núcleo de acciones completo y las
 * partes del asistente que preparan y aplican el lote, sobre una base de datos
 * simulada y con el reloj en Cancún.
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

function extraerSeccion(fuente, titulo) {
    const marca = fuente.indexOf('// ==================== ' + titulo);
    if (marca === -1) throw new Error(`No se encontró la sección "${titulo}" en voice-assistant.js`);
    const siguiente = fuente.indexOf('// ====================', marca + 30);
    return fuente.slice(marca, siguiente === -1 ? undefined : siguiente);
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

// Una base con lo que tendría un despacho: tres asuntos de AHO (por carpeta, por
// cliente y por tipo de asunto), uno de "Ahorro Popular" que NO es AHO, uno
// archivado de AHO, y otros dos sin relación.
function crearSandbox({ falla } = {}) {
    let secuencia = 1000;
    const estado = { eventos: [], expedientes: [], archivados: [], notas: [], pendientes: [], carpetas: [], mensajes: [], confirmaciones: [], refrescos: 0, sincronizaciones: 0 };
    const copia = (x) => JSON.parse(JSON.stringify(x));

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Map, Set, Promise, JSON, Object, Array, String, Number, isNaN, parseInt, setTimeout, Math,
        estado,
        // --- Base de datos simulada, con las firmas de database.js ---
        obtenerEventos: async () => copia(estado.eventos),
        agregarEvento: async (ev) => { const id = ++secuencia; estado.eventos.push({ ...copia(ev), id }); return id; },
        actualizarEvento: async (id, cambios) => { Object.assign(estado.eventos.find(x => x.id === id), copia(cambios)); },
        eliminarEvento: async (id) => { estado.eventos = estado.eventos.filter(e => e.id !== id); },
        obtenerExpedientes: async () => copia(estado.expedientes),
        obtenerExpedientesArchivados: async () => copia(estado.archivados),
        obtenerExpediente: async (id) => copia(estado.expedientes.concat(estado.archivados).find(e => e.id === id) || null),
        actualizarExpediente: async (id, cambios) => { Object.assign(estado.expedientes.find(e => e.id === id), copia(cambios)); },
        archivarExpedienteDB: async (id, archivado) => {
            const origen = archivado ? estado.expedientes : estado.archivados;
            const destino = archivado ? estado.archivados : estado.expedientes;
            const i = origen.findIndex(e => e.id === id);
            if (i === -1) throw new Error('Expediente no encontrado');
            destino.push(origen.splice(i, 1)[0]);
        },
        obtenerCarpetas: async () => copia(estado.carpetas),
        obtenerCarpeta: async (id) => copia(estado.carpetas.find(c => c.id === id) || null),
        agregarNota: async (n) => {
            if (falla && falla.nota && n.expedienteId === falla.nota) throw new Error('la base no respondió');
            const id = ++secuencia; estado.notas.push({ ...copia(n), id }); return id;
        },
        eliminarNota: async (id) => { estado.notas = estado.notas.filter(n => n.id !== id); },
        agregarPendiente: async (pe) => { const id = ++secuencia; estado.pendientes.push({ ...copia(pe), id }); return id; },
        obtenerPendiente: async (id) => copia(estado.pendientes.find(x => x.id === id) || null),
        actualizarPendiente: async (id, c) => { const x = estado.pendientes.find(y => y.id === id); Object.assign(x, copia(c)); return copia(x); },
        eliminarPendiente: async (id) => { estado.pendientes = estado.pendientes.filter(x => x.id !== id); },
        // Cuántas veces se repinta la pantalla y se sube a la nube.
        cargarExpedientes: async () => { estado.refrescos++; },
        marcarYSincronizar: async () => { estado.sincronizaciones++; },
        // --- Lo que el asistente pinta o dice: se anota ---
        agregarMensaje: (rol, html) => { estado.mensajes.push(html); return null; },
        esc: (t) => String(t == null ? '' : t),
        hablar: () => {},
        panelAbierto: () => false,
        iniciarEscucha: () => {},
        seguirEscuchando: () => {},
        pedirConfirmacion: (r, resumen, detalles) => { estado.confirmaciones.push({ r, resumen, detalles }); },
        informarFallo: (e) => { estado.mensajes.push('FALLO: ' + e.message); }
    };
    sb.window = sb;
    vm.createContext(sb);

    vm.runInContext(fs.readFileSync(path.join(JS, 'acciones-core.js'), 'utf8'), sb, { filename: 'acciones-core.js' });

    vm.runInContext(`var pilaDeshacer = []; var loteDeshacer = null; var conversacion = [];
                     var estado = ''; var Estado = { ESPERANDO_DATO: 'esperando_dato' };`, sb);
    for (const n of ['normalizar', 'pad', 'normalizarHora', 'fechaLocalISO', 'textoLimpio', 'toast',
                     'registrarDeshacer', 'accDeshacer', 'revertirEntrada', 'enLote', 'ErrorAviso', 'ErrorEleccion',
                     'resolverExpedienteDeParametros', 'accCrearEvento', 'accCrearPendiente', 'accCrearNota',
                     'accMoverACarpeta', 'accArchivarExpediente']) {
        vm.runInContext(extraerIndentado(VOZ, n), sb, { filename: 'voice-assistant.js:' + n });
    }
    vm.runInContext(extraerSeccion(VOZ, 'VARIAS ACCIONES A LA VEZ'), sb, { filename: 'voice-assistant.js:varias' });
    // Cómo se acomoda lo que contesta el modelo, y qué acciones son búsquedas.
    vm.runInContext(extraerSeccion(VOZ, 'ÓRDENES DEL MODELO'), sb, { filename: 'voice-assistant.js:órdenes' });
    const busquedas = /^[ \t]*const ACCIONES_BUSQUEDA = new Set\(\[[^\]]*\]\);/m.exec(VOZ);
    if (!busquedas) throw new Error('No se encontró ACCIONES_BUSQUEDA (¿se renombró?)');
    vm.runInContext(busquedas[0].trim(), sb, { filename: 'voice-assistant.js:ACCIONES_BUSQUEDA' });
    // Las búsquedas de estrados se prueban en test_voz_estrados.js; aquí basta
    // ver que el lote las prepara y las abre, con lo que se le pasó.
    estado.busquedasPlaneadas = [];
    estado.busquedasAbiertas = [];
    sb.planBuscarVarios = async (p) => {
        estado.busquedasPlaneadas.push(copia(p));
        const consultas = p.busquedas.map(b => ({ etiqueta: (b.parametros.numero || b.parametros.valor) + ' — ' + (b.parametros.organismo || b.parametros.juzgado), url: 'https://estrados/' + (b.parametros.numero || b.parametros.valor) }));
        if (p.busquedas.some(b => b.parametros.organismo === 'inventado')) throw sb.ErrorAviso('No pude preparar ninguna de las búsquedas: no identifiqué "inventado".');
        return { consultas, avisos: [], numero: '' };
    };
    sb.ejecutarPlanBusqueda = (plan) => { estado.busquedasAbiertas.push(plan.consultas.map(c => c.url)); return `Abriendo ${plan.consultas.length} consultas.`; };

    // Los expedientes.
    const exp = (id, numero, extra = {}) => ({ id, numero, institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', ...extra });
    estado.carpetas.push({ id: 1, nombre: 'AHO' }, { id: 2, nombre: 'García' }, { id: 3, nombre: 'Ahorro Popular' });
    estado.expedientes.push(
        exp(10, '123/2025', { carpetaId: 1 }),                               // AHO por carpeta
        exp(11, '45/2026', { cliente: 'AHO' }),                              // AHO por cliente
        exp(12, '78/2024', { tipo: 'AHO', comentario: 'Cobro' }),            // AHO por tipo de asunto
        exp(13, '9/2026', { carpetaId: 3, cliente: 'Ahorro Popular' }),      // NO es AHO
        exp(14, '210/2025', { carpetaId: 2, cliente: 'García' }),
        exp(15, '66/2023', { nombre: 'Pérez vs Ruiz', numero: '66/2023' })
    );
    estado.archivados.push(exp(16, '5/2020', { carpetaId: 1, archivado: true }));  // AHO, pero archivado
    return { sb, estado };
}

const correr = (sb, codigo) => vm.runInContext(codigo, sb);
const ids = (arr) => arr.map(x => x.expedienteId).sort((a, b) => a - b);
const crearEvento = (extra) => ({ accion: 'crear_evento', parametros: { titulo: 'Enviar el escrito', tipo: 'recordatorio', fecha: '2026-12-03', ...extra } });

// ==================== EL GRUPO ====================

async function pruebaGrupo() {
    const { sb } = crearSandbox();
    const grupo = async (ref) => (await correr(sb, `buscarExpedientesDeGrupo(${JSON.stringify(ref)})`)).map(m => m.expediente.id).sort((a, b) => a - b);

    igual('AHO: junta la carpeta, el cliente y el tipo de asunto', await grupo('AHO'), [10, 11, 12]);
    verificar('AHO no es "Ahorro": la palabra va completa', !(await grupo('AHO')).includes(13));
    verificar('un archivado no entra al grupo', !(await grupo('AHO')).includes(16));
    igual('"la carpeta AHO" o "el cliente AHO" valen lo mismo', [await grupo('la carpeta AHO'), await grupo('el cliente aho')], [[10, 11, 12], [10, 11, 12]]);
    igual('mayúsculas y acentos dan igual', [await grupo('garcia'), await grupo('GARCÍA')], [[14], [14]]);
    igual('un grupo de varias palabras las exige todas', await grupo('Ahorro Popular'), [13]);
    igual('lo que no existe no devuelve nada', await grupo('Inexistente'), []);
    igual('sin palabras útiles tampoco', await grupo('la carpeta'), []);
    const motivos = (await correr(sb, 'buscarExpedientesDeGrupo("AHO")')).map(m => m.motivo);
    verificar('dice por qué entra cada uno', motivos.some(m => /carpeta/.test(m)) && motivos.some(m => /cliente/.test(m)) && motivos.some(m => /tipo de asunto/.test(m)), JSON.stringify(motivos));
}

// ==================== LA ORDEN: ENUMERADA Y POR GRUPO ====================

async function pruebaEnumerada() {
    const { sb, estado } = crearSandbox();
    sb.__orden = { acciones: [10, 11, 12].map(id => crearEvento({ expedienteId: id })) };
    const plan = await correr(sb, 'planVarias(__orden)');
    igual('tres expedientes: tres cosas por hacer', plan.items.length, 3);
    igual('el resumen lo pone la app', plan.resumen, 'Agendar 3 eventos');
    verificar('la lista nombra cada expediente', ['123/2025', '45/2026', '78/2024'].every(n => plan.detalles.some(d => d.includes(n))), JSON.stringify(plan.detalles));
    verificar('y qué se agenda y cuándo', plan.detalles.every(d => /Recordatorio “Enviar el escrito” — .*diciembre/.test(d)), JSON.stringify(plan.detalles));
    igual('preparar no crea nada', estado.eventos.length, 0);

    sb.__plan = plan;
    const msg = await correr(sb, 'aplicarVarias(__plan)');
    igual('queda un recordatorio por expediente', ids(estado.eventos), [10, 11, 12]);
    verificar('con el título, el tipo y el día', estado.eventos.every(e => e.titulo === 'Enviar el escrito' && e.tipo === 'recordatorio' && /^2026-12-03/.test(new Date(e.fechaInicio).toLocaleDateString('sv-SE'))));
    verificar('se dice cuántos', /3 eventos agendados/.test(msg), msg);
    igual('un solo repintado de la pantalla para los tres', estado.refrescos, 1);
    igual('y una sola subida a la nube', estado.sincronizaciones, 1);
    igual('un solo "deshaz" para todo el lote', correr(sb, 'pilaDeshacer.length'), 1);

    await correr(sb, 'accDeshacer()');
    igual('"deshaz lo último" quita los tres', estado.eventos.length, 0);
    igual('deshacer tampoco repinta tres veces', estado.refrescos, 2);
}

async function pruebaPorGrupo() {
    const { sb, estado } = crearSandbox();
    sb.__orden = { acciones: [crearEvento({ paraTodosLosDe: 'AHO' })] };
    const plan = await correr(sb, 'planVarias(__orden)');
    igual('"todos los de AHO": los tres activos, no el archivado ni "Ahorro Popular"', plan.items.map(i => i.parametros.expedienteId).sort(), [10, 11, 12]);
    verificar('la lista de confirmación los enseña', plan.detalles.length === 3 && plan.detalles.every(d => /Recordatorio/.test(d)));
    sb.__plan = plan;
    await correr(sb, 'aplicarVarias(__plan)');
    igual('un recordatorio en cada uno', ids(estado.eventos), [10, 11, 12]);

    // El modelo no tiene que saber ids: el grupo lo resuelve la app.
    const { sb: sb2 } = crearSandbox();
    sb2.__orden = { acciones: [{ accion: 'crear_nota', parametros: { titulo: 'Revisar', paraTodosLosDe: 'la carpeta García' } }] };
    igual('una nota en cada uno del grupo', (await correr(sb2, 'planVarias(__orden)')).items.map(i => i.parametros.expedienteId), [14]);
}

async function pruebaMezclada() {
    const { sb, estado } = crearSandbox();
    sb.__orden = { acciones: [
        crearEvento({ expedienteId: 10 }),
        { accion: 'crear_nota', parametros: { titulo: 'Llamar al perito', expedienteRef: '210/2025' } },
        { accion: 'crear_pendiente', parametros: { titulo: 'Contestar la demanda', expedienteId: 12, fecha: '2026-12-10', prioridad: 'alta' } }
    ] };
    const plan = await correr(sb, 'planVarias(__orden)');
    igual('cosas distintas en una orden', plan.resumen, 'Hacer 3 acciones');
    sb.__plan = plan;
    const msg = await correr(sb, 'aplicarVarias(__plan)');
    igual('el evento', ids(estado.eventos.filter(e => !e.pendienteId)), [10]);
    igual('la nota, con el expediente resuelto por referencia', estado.notas.map(n => n.expedienteId), [14]);
    igual('el pendiente', estado.pendientes.map(x => x.expedienteId), [12]);
    verificar('el mensaje cuenta cada tipo', /1 evento agendado/.test(msg) && /1 nota creada/.test(msg) && /1 pendiente creado/.test(msg), msg);
    await correr(sb, 'accDeshacer()');
    igual('un solo deshacer revierte las tres cosas', [estado.eventos.length, estado.notas.length, estado.pendientes.length], [0, 0, 0]);
}

async function pruebaCarpetaYArchivo() {
    const { sb, estado } = crearSandbox();
    sb.__orden = { acciones: [{ accion: 'mover_a_carpeta', parametros: { carpetaId: 2, paraTodosLosDe: 'AHO' } }] };
    const plan = await correr(sb, 'planVarias(__orden)');
    igual('mover a una carpeta', plan.resumen, 'Mover 3 expedientes de carpeta');
    verificar('dice a cuál', plan.detalles.every(d => /→ la carpeta “García”/.test(d)), JSON.stringify(plan.detalles));
    sb.__plan = plan;
    await correr(sb, 'aplicarVarias(__plan)');
    igual('quedan en la carpeta', [10, 11, 12].map(id => estado.expedientes.find(e => e.id === id).carpetaId), [2, 2, 2]);
    await correr(sb, 'accDeshacer()');
    igual('deshacer los regresa a donde estaban', [10, 11, 12].map(id => estado.expedientes.find(e => e.id === id).carpetaId), [1, undefined, undefined]);

    sb.__orden = { acciones: [{ accion: 'archivar_expediente', parametros: { motivo: 'concluido', expedienteId: 14 } }, { accion: 'archivar_expediente', parametros: { motivo: 'concluido', expedienteRef: '66/2023' } }] };
    sb.__plan = await correr(sb, 'planVarias(__orden)');
    await correr(sb, 'aplicarVarias(__plan)');
    verificar('archivar varios', estado.archivados.some(e => e.id === 14) && estado.archivados.some(e => e.id === 15));
    await correr(sb, 'accDeshacer()');
    verificar('y se desarchivan juntos', !estado.archivados.some(e => e.id === 14 || e.id === 15));
}

// ==================== NADA A MEDIAS ====================

async function pruebaNadaAMedias() {
    const { sb, estado } = crearSandbox();
    const planear = async (acciones) => { sb.__orden = { acciones }; return lanza(() => correr(sb, 'planVarias(__orden)')); };

    let e = await planear([crearEvento({ expedienteId: 10 }), crearEvento({ expedienteRef: 'Inexistente 999' })]);
    verificar('un expediente que no existe frena TODA la orden', e && e._esLote && /no encontré ningún expediente/.test(e.message), e && e.message);
    verificar('y avisa que no se hizo nada', /no hice nada/.test(e.message));

    e = await planear([crearEvento({ expedienteId: 10 }), crearEvento({ expedienteRef: '2025' })]);
    verificar('una referencia ambigua dice cuáles son las opciones', e && e._esLote && /coincide con \d+ expedientes/.test(e.message) && /123\/2025/.test(e.message), e && e.message);

    e = await planear([crearEvento({ expedienteId: 10, titulo: '' })]);
    verificar('sin título no se agenda', e && /falta el título/.test(e.message), e && e.message);
    e = await planear([crearEvento({ expedienteId: 10, fecha: '' })]);
    verificar('sin fecha tampoco', e && /falta la fecha/.test(e.message), e && e.message);
    e = await planear([crearEvento({ expedienteId: 10, fecha: '2026-13-45' })]);
    verificar('una fecha inválida se dice', e && /no es válida/.test(e.message), e && e.message);

    e = await planear([{ accion: 'editar_evento', parametros: {} }]);
    verificar('lo que no se puede combinar se dice', e && /no se puede combinar/.test(e.message), e && e.message);
    e = await planear([crearEvento({ paraTodosLosDe: 'Inexistente' })]);
    verificar('un grupo sin expedientes se dice', e && /no encontré expedientes de “Inexistente”/.test(e.message), e && e.message);
    e = await planear([{ accion: 'mover_a_carpeta', parametros: { carpetaId: 2 } }]);
    verificar('mover sin expediente pide cuál', e && /falta saber de qué expediente/.test(e.message), e && e.message);
    e = await planear([{ accion: 'mover_a_carpeta', parametros: { carpetaId: 99, expedienteId: 10 } }]);
    verificar('una carpeta que no existe se dice', e && /no encontré esa carpeta/.test(e.message), e && e.message);
    e = await planear([]);
    verificar('una orden vacía se dice', e && e._esLote, e && e.message);
    sb.__orden = {};
    verificar('sin lista de acciones tampoco truena', (await lanza(() => correr(sb, 'planVarias(__orden)')))._esLote === true);

    // Varios problemas: se dicen todos juntos, para corregir de una vez.
    e = await planear([crearEvento({ expedienteRef: 'Nada uno' }), crearEvento({ expedienteRef: 'Nada dos' })]);
    verificar('si hay varios problemas se dicen todos', e && /Nada uno/.test(e.message) && /Nada dos/.test(e.message), e && e.message);

    igual('nada de eso creó algo', [estado.eventos.length, estado.notas.length], [0, 0]);

    // Tope y repetidos.
    estado.expedientes = Array.from({ length: 45 }, (_, i) => ({ id: 2000 + i, numero: `${i + 1}/2026`, institucion: 'TSJ', juzgado: 'X', cliente: 'Muchos' }));
    e = await planear([crearEvento({ paraTodosLosDe: 'Muchos' })]);
    verificar('hay un tope por orden', e && /el máximo por orden es 40/.test(e.message), e && e.message);

    const { sb: sb2 } = crearSandbox();
    sb2.__orden = { acciones: [crearEvento({ expedienteId: 10 }), crearEvento({ expedienteId: 10 }), crearEvento({ paraTodosLosDe: 'AHO' })] };
    igual('lo repetido se junta', (await correr(sb2, 'planVarias(__orden)')).items.length, 3);
}

async function pruebaFalloParcial() {
    const { sb, estado } = crearSandbox({ falla: { nota: 11 } });
    sb.__orden = { acciones: [10, 11, 12].map(id => ({ accion: 'crear_nota', parametros: { titulo: 'Revisar', expedienteId: id } })) };
    sb.__plan = await correr(sb, 'planVarias(__orden)');
    const msg = await correr(sb, 'aplicarVarias(__plan)');
    igual('un fallo suelto no tira el resto', estado.notas.map(n => n.expedienteId).sort(), [10, 12]);
    verificar('se dice cuál falló y por qué', /No pude hacer una/.test(msg) && /45\/2026/.test(msg) && /la base no respondió/.test(msg), msg);
    await correr(sb, 'accDeshacer()');
    igual('y deshacer quita lo que sí se hizo', estado.notas.length, 0);

    const { sb: sb3 } = crearSandbox({ falla: { nota: 10 } });
    sb3.__orden = { acciones: [{ accion: 'crear_nota', parametros: { titulo: 'Revisar', expedienteId: 10 } }] };
    sb3.__plan = await correr(sb3, 'planVarias(__orden)');
    const e = await lanza(() => correr(sb3, 'aplicarVarias(__plan)'));
    verificar('si no se pudo ninguna, es un error', e && /No pude hacer ninguna/.test(e.message), e && e.message);
}

// ==================== LO QUE VE EL USUARIO ====================

async function pruebaPreparar() {
    const { sb, estado } = crearSandbox();
    correr(sb, 'conversacion.push({ role: "assistant", content: "{}" })');
    sb.__r = { accion: 'varias', parametros: { acciones: [crearEvento({ paraTodosLosDe: 'AHO' })] }, resumen: 'lo que diga el modelo' };
    await correr(sb, 'prepararVarias(__r)');
    igual('se pide confirmar, una vez', estado.confirmaciones.length, 1);
    igual('con el resumen de la app, no el del modelo', estado.confirmaciones[0].resumen, 'Agendar 3 eventos');
    igual('y la lista completa', estado.confirmaciones[0].detalles.length, 3);
    igual('el plan viaja con la orden para ejecutarse tal cual se enseñó', estado.confirmaciones[0].r._plan.items.length, 3);
    igual('mientras no se confirma no se crea nada', estado.eventos.length, 0);

    // Con un problema: se dice, se sigue escuchando y el modelo lo ve.
    estado.confirmaciones.length = 0;
    sb.__r = { accion: 'varias', parametros: { acciones: [crearEvento({ expedienteRef: 'Inexistente' })] } };
    await correr(sb, 'prepararVarias(__r)');
    igual('con un problema no se pide confirmar', estado.confirmaciones.length, 0);
    verificar('se le dice al usuario', estado.mensajes.some(m => /no hice nada/.test(m)), JSON.stringify(estado.mensajes));
    igual('y se queda esperando su respuesta', correr(sb, 'estado'), 'esperando_dato');
    verificar('el modelo ve qué pasó, para rehacer la orden completa', /No se ejecutó nada/.test(correr(sb, 'conversacion[conversacion.length - 1].content')));
}

// ==================== BÚSQUEDAS DE ESTRADOS EN EL LOTE ====================
// El modelo a veces mete las búsquedas de estrados en "varias". Antes eso
// tumbaba la orden entera («“buscar_tsj” no se puede combinar con otras en
// una sola orden»); ahora se preparan juntas y se abren al confirmar.

const BUSCA_TSJ = { accion: 'buscar_tsj', parametros: { valor: '120/2026', juzgado: 'JUZGADO PRIMERO FAMILIAR ORAL CANCUN' } };
const BUSCA_PJF = { accion: 'buscar_pjf', parametros: { numero: '486/2026', organismo: 'primer tribunal colegiado del 27 circuito', tipoAsunto: 'amparo directo' } };

async function pruebaBusquedasEnElLote() {
    // Solo búsquedas: nada que guardar, y se abren.
    let { sb, estado } = crearSandbox();
    sb.__orden = { acciones: [BUSCA_TSJ, BUSCA_PJF] };
    let plan = await correr(sb, 'planVarias(__orden)');
    igual('solo búsquedas: ya no se rechazan', [plan.items.length, plan.busqueda && plan.busqueda.consultas.length], [0, 2]);
    igual('solo búsquedas: el resumen dice cuántas abre', plan.resumen, 'Abrir 2 consultas');
    igual('se preparan juntas, como en buscar_varios', estado.busquedasPlaneadas.map(p => p.busquedas.map(b => b.accion)), [['buscar_tsj', 'buscar_pjf']]);
    sb.__plan = plan;
    let msg = await correr(sb, 'aplicarVarias(__plan)');
    igual('solo búsquedas: se abren al confirmar', estado.busquedasAbiertas, [['https://estrados/120/2026', 'https://estrados/486/2026']]);
    igual('solo búsquedas: y se dice', msg, 'Abriendo 2 consultas.');

    // Mezclado: una nota y dos búsquedas en la misma orden.
    ({ sb, estado } = crearSandbox());
    sb.__orden = { acciones: [{ accion: 'crear_nota', parametros: { titulo: 'Revisar acuerdos', expedienteId: 10 } }, BUSCA_TSJ, BUSCA_PJF] };
    plan = await correr(sb, 'planVarias(__orden)');
    verificar('mezclado: el resumen dice las dos cosas', /^Nota “Revisar acuerdos” — 123\/2025 .* y abrir 2 consultas$/.test(plan.resumen), plan.resumen);
    verificar('mezclado: la lista enseña la nota y cada consulta', plan.detalles.length === 3 && /Nota “Revisar acuerdos”/.test(plan.detalles[0]) &&
        /120\/2026/.test(plan.detalles[1]) && /486\/2026/.test(plan.detalles[2]), JSON.stringify(plan.detalles));
    igual('mezclado: preparar no guarda ni abre nada', [estado.notas.length, estado.busquedasAbiertas.length], [0, 0]);
    sb.__plan = plan;
    msg = await correr(sb, 'aplicarVarias(__plan)');
    igual('mezclado: se guarda la nota', estado.notas.map(n => n.expedienteId), [10]);
    igual('mezclado: y se abren las búsquedas', estado.busquedasAbiertas.length, 1);
    igual('mezclado: el mensaje cuenta las dos cosas', msg, 'Listo: 1 nota creada. Abriendo 2 consultas.');
    await correr(sb, 'accDeshacer()');
    igual('mezclado: «deshaz lo último» quita la nota', estado.notas.length, 0);

    // Si la nota falla, las búsquedas abiertas se dicen igual.
    ({ sb, estado } = crearSandbox({ falla: { nota: 10 } }));
    sb.__orden = { acciones: [{ accion: 'crear_nota', parametros: { titulo: 'Revisar', expedienteId: 10 } }, BUSCA_TSJ] };
    sb.__plan = await correr(sb, 'planVarias(__orden)');
    msg = await correr(sb, 'aplicarVarias(__plan)');
    verificar('si lo demás falla, se dice lo que sí se abrió', /^Abriendo 1 consultas\. No pude hacer ninguna de las acciones/.test(msg), msg);

    // Una búsqueda imposible frena toda la orden, como cualquier otro problema.
    ({ sb, estado } = crearSandbox());
    sb.__orden = { acciones: [{ accion: 'crear_nota', parametros: { titulo: 'Revisar', expedienteId: 10 } }, { accion: 'buscar_pjf', parametros: { numero: '1/2026', organismo: 'inventado' } }] };
    const e = await lanza(() => correr(sb, 'planVarias(__orden)'));
    verificar('una búsqueda que no se puede preparar frena la orden y lo dice', e && e._esLote && /no identifiqué "inventado"/.test(e.message), e && e.message);
    igual('y no se guarda nada a medias', estado.notas.length, 0);

    // Lo que ve el usuario: la confirmación con todo.
    ({ sb, estado } = crearSandbox());
    correr(sb, 'conversacion.push({ role: "assistant", content: "{}" })');
    sb.__r = { accion: 'varias', parametros: { acciones: [{ accion: 'crear_nota', parametros: { titulo: 'Revisar', expedienteId: 10 } }, BUSCA_TSJ, BUSCA_PJF] } };
    await correr(sb, 'prepararVarias(__r)');
    verificar('se confirma la nota y las dos búsquedas juntas', estado.confirmaciones.length === 1 && /y abrir 2 consultas$/.test(estado.confirmaciones[0].resumen),
        JSON.stringify(estado.confirmaciones.map(c => c.resumen)));

    // problemaDeOrden: las búsquedas ya no son un problema; editar eventos sí.
    sb.__o = { accion: 'varias', parametros: { acciones: [BUSCA_TSJ, { accion: 'crear_nota', parametros: { titulo: 'x' } }] } };
    igual('búsquedas y una nota en "varias" se pueden hacer', correr(sb, 'problemaDeOrden(normalizarOrden(__o))'), null);
    sb.__o = { accion: 'varias', parametros: { acciones: [{ accion: 'editar_evento', parametros: {} }, { accion: 'crear_nota', parametros: { titulo: 'x' } }] } };
    verificar('editar eventos dentro de "varias" se le devuelve al modelo', /no caben "editar_evento"/.test(correr(sb, 'problemaDeOrden(normalizarOrden(__o))') || ''));
}

function pruebaProtocolo() {
    const prompt = extraerIndentado(VOZ, 'construirPromptSistema');
    verificar('el modelo conoce la acción', /18\. "varias"/.test(prompt) && /paraTodosLosDe/.test(prompt));
    verificar('y sabe que NUNCA debe decir que no puede', /NUNCA digas que no puedes hacer algo para varios expedientes/.test(prompt) && /No respondas "no puedo manejar varias peticiones"/.test(prompt));
    verificar('ve el cliente, el tipo y el responsable de cada expediente', /cliente: e\.cliente/.test(prompt) && /tipo: e\.tipo/.test(prompt) && /responsable: e\.abogado/.test(prompt));
    verificar('la orden se prepara antes de confirmar', /accion === 'varias'[\s\S]{0,80}prepararVarias/.test(extraerIndentado(VOZ, 'procesarRespuestaIA')));
    verificar('y se aplica el plan ya enseñado', /case 'varias':\s+mensajeFinal = plan \? await aplicarVarias\(plan\) : await accVarias\(p\)/.test(extraerIndentado(VOZ, 'ejecutarAccionResuelta')));
    verificar('el tip lo cuenta', /varios expedientes en una sola orden/.test(VOZ));
    verificar('navegar llega a "otros"', /'otros'/.test(extraerIndentado(VOZ, 'accNavegar')) && /"otros"/.test(prompt));
}

(async () => {
    console.log('Órdenes múltiples al asistente');
    for (const prueba of [pruebaGrupo, pruebaEnumerada, pruebaPorGrupo, pruebaMezclada, pruebaCarpetaYArchivo,
                          pruebaNadaAMedias, pruebaFalloParcial, pruebaPreparar, pruebaBusquedasEnElLote, pruebaProtocolo]) {
        try { await prueba(); } catch (e) { fallos.push(`${prueba.name} reventó: ${e.stack || e.message}`); }
    }
    console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas\n`);
    if (fallos.length) {
        fallos.forEach(f => console.log('  ✗ ' + f));
        process.exit(1);
    }
    console.log('✓ El asistente maneja varias peticiones en una sola orden.');
})();
