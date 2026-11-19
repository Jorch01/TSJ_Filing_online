#!/usr/bin/env node
/**
 * Pruebas del resumen de pendientes del asistente y de cuándo se enciende el
 * micrófono.
 *
 *   node test_voz_pendientes.js
 *
 * Lo que pasaba:
 *   - "Dame un resumen de mis pendientes" no tenía respuesta: la consulta daba
 *     una lista plana de ocho títulos, sin expediente ni fecha, y el modelo
 *     (que no ve los pendientes) contestaba que no podía resumirlos.
 *   - El micrófono se encendía solo al abrir el asistente y después de cada
 *     pregunta. Ahora solo al tocarlo, salvo que se elija «manos libres».
 *
 * Se carga el código real de docs/js/ (el núcleo de acciones y la sección del
 * resumen del asistente) sobre una base simulada, con el reloj en Cancún.
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

// Un día a mediodía, en hora de Cancún, a `n` días de "hoy".
const HOY = new Date(2026, 10, 19, 10, 0).getTime();
const dia = (n, hora = 12) => new Date(2026, 10, 19 + n, hora, 0).toISOString();

function crearSandbox() {
    const estado = { pendientes: [], expedientes: [], archivados: [], carpetas: [], mensajes: [], dichos: [] };
    const copia = (x) => JSON.parse(JSON.stringify(x));
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Map, Set, Promise, JSON, Object, Array, String, Number, isNaN, parseInt, setTimeout, Math, Infinity,
        estado,
        obtenerPendientes: async () => copia(estado.pendientes),
        obtenerExpedientes: async () => copia(estado.expedientes),
        obtenerExpedientesArchivados: async () => copia(estado.archivados),
        obtenerExpediente: async (id) => copia(estado.expedientes.concat(estado.archivados).find(e => e.id === id) || null),
        obtenerCarpetas: async () => copia(estado.carpetas),
        agregarMensaje: (rol, html) => { estado.mensajes.push(html); return null; },
        hablar: (texto) => { estado.dichos.push(texto); },
        esc: (t) => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
        mostrarOpcionesExpediente: () => {}
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(JS, 'acciones-core.js'), 'utf8'), sb, { filename: 'acciones-core.js' });
    vm.runInContext('var conversacion = [];', sb);
    for (const n of ['textoLimpio', 'ErrorAviso', 'ErrorEleccion', 'resolverExpedienteDeParametros', 'mapaDeExpedientes']) {
        vm.runInContext(extraerIndentado(VOZ, n), sb, { filename: 'voice-assistant.js:' + n });
    }
    vm.runInContext(extraerSeccion(VOZ, 'RESUMEN DE PENDIENTES'), sb, { filename: 'voice-assistant.js:pendientes' });

    estado.carpetas.push({ id: 1, nombre: 'AHO' });
    estado.expedientes.push(
        { id: 10, numero: '123/2025', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', carpetaId: 1 },
        { id: 11, numero: '45/2026', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', cliente: 'AHO' },
        { id: 12, numero: '78/2024', institucion: 'TSJ', juzgado: 'JUZGADO SEGUNDO CIVIL CANCUN' }
    );
    let id = 100;
    const pend = (titulo, extra) => estado.pendientes.push({ id: ++id, titulo, completado: false, ...extra });
    pend('Contestar la demanda', { expedienteId: 10, fechaLimite: dia(-2), prioridad: 'alta' });
    pend('Pagar derechos', { expedienteId: 12, fechaLimite: dia(-1) });
    pend('Presentar alegatos', { expedienteId: 11, fechaLimite: dia(0), prioridad: 'media' });
    pend('Llamar al perito', { expedienteId: 12, fechaLimite: dia(1) });
    pend('Revisar acuerdo', { expedienteId: 10, fechaLimite: dia(5) });
    pend('Preparar audiencia', { expedienteId: 12, fechaLimite: dia(20) });
    pend('Pedir copias certificadas', { expedienteTexto: 'Exp. 9/2020', prioridad: 'alta' });
    pend('Ya hecho', { expedienteId: 10, fechaLimite: dia(-5), completado: true });
    return { sb, estado };
}

const correr = (sb, codigo) => vm.runInContext(codigo, sb);

function pruebaMotor() {
    const { sb, estado } = crearSandbox();
    sb.__p = estado.pendientes;
    const etiqueta = '(p) => ({ 10: "123/2025", 11: "45/2026", 12: "78/2024" })[p.expedienteId] || p.expedienteTexto || ""';
    const r = correr(sb, `resumirPendientes(__p, ${etiqueta}, ${HOY}, {})`);

    igual('lo terminado no cuenta', r.total, 7);
    igual('se cuenta cuántos hay de cada urgencia', r.conteos, { vencidos: 2, hoy: 1, semana: 2, despues: 1, sinFecha: 1, alta: 2 });
    igual('las secciones salen por urgencia', r.secciones.map(s => s.titulo), ['Vencidos', 'Para hoy', 'Esta semana', 'Más adelante', 'Sin fecha']);
    igual('dentro de una sección, lo de prioridad alta primero', r.secciones[0].items.map(x => x.titulo), ['Contestar la demanda', 'Pagar derechos']);
    igual('cada pendiente dice su expediente', r.secciones[0].items.map(x => x.expediente), ['123/2025', '78/2024']);
    igual('y un pendiente con expediente escrito a mano, el texto', r.secciones[4].items[0].expediente, 'Exp. 9/2020');
    igual('y cuándo vence, dicho como se dice', [r.secciones[0].items[0].cuando, r.secciones[1].items[0].cuando, r.secciones[2].items[0].cuando],
        ['venció hace 2 días', 'vence hoy', 'vence mañana']);
    verificar('a unos días se dice en cuántos y qué día', /^vence en 5 días \(.+\)$/.test(r.secciones[2].items[1].cuando), r.secciones[2].items[1].cuando);
    igual('un día vencido en singular', correr(sb, 'cuandoVence(-1, "")'), 'venció hace 1 día');

    const filtrar = (f) => correr(sb, `resumirPendientes(__p, ${etiqueta}, ${HOY}, ${JSON.stringify(f)})`);
    igual('"esta semana": lo vencido, lo de hoy y lo de los próximos 7 días', filtrar({ periodo: 'semana' }).total, 5);
    igual('"para hoy": lo de hoy y lo vencido', filtrar({ periodo: 'hoy' }).total, 3);
    igual('"vencidos": solo lo vencido', filtrar({ periodo: 'vencidos' }).secciones.map(s => s.clave), ['vencidos']);
    igual('"este mes": no entra lo que no tiene fecha', filtrar({ periodo: 'mes' }).conteos.sinFecha, 0);
    igual('prioridad alta', filtrar({ prioridad: 'alta' }).secciones.flatMap(s => s.items).map(x => x.titulo), ['Contestar la demanda', 'Pedir copias certificadas']);
    sb.__ids = new Set([10]);
    igual('de un expediente', correr(sb, `resumirPendientes(__p, ${etiqueta}, ${HOY}, { expedienteIds: __ids })`).total, 2);
    igual('sin pendientes, todo en cero', correr(sb, `resumirPendientes([], null, ${HOY}, {})`), { total: 0, conteos: { vencidos: 0, hoy: 0, semana: 0, despues: 0, sinFecha: 0, alta: 0 }, secciones: [] });

    // Lo que se dice y lo que se ve.
    sb.__r = r;
    const dicho = correr(sb, 'textoHabladoResumen(__r, "")');
    verificar('en voz: las cifras', dicho.startsWith('Tienes 7 pendientes: 2 vencidos, 1 para hoy, 2 para esta semana, 1 más adelante y 1 sin fecha.'), dicho);
    verificar('en voz: cuántos son urgentes', /2 son de prioridad alta\./.test(dicho), dicho);
    verificar('en voz: lo tres más urgentes, con su expediente', /Lo más urgente: Contestar la demanda, del 123\/2025, venció hace 2 días; Pagar derechos, del 78\/2024, venció hace 1 día; Presentar alegatos, del 45\/2026, vence hoy\./.test(dicho), dicho);
    const html = correr(sb, 'htmlResumenPendientes(__r, "")');
    verificar('en pantalla: el total y las cifras', /7 pendientes por hacer/.test(html) && /2 vencidos · 1 para hoy · 2 esta semana · 1 más adelante · 1 sin fecha · 2 de prioridad alta/.test(html), html.slice(0, 300));
    verificar('en pantalla: cada sección con su cuenta', /Vencidos \(2\)/.test(html) && /Sin fecha \(1\)/.test(html));
    verificar('en pantalla: la prioridad alta se marca', /🔴 Contestar la demanda/.test(html));

    // El título lo escribe el usuario (o lo dicta): se escapa.
    sb.__p2 = [{ titulo: '<img src=x onerror=alert(1)>', fechaLimite: dia(0) }];
    const peligroso = correr(sb, `htmlResumenPendientes(resumirPendientes(__p2, () => '<b>x</b>', ${HOY}, {}), '')`);
    verificar('el texto del usuario se escapa', !/<img/.test(peligroso) && /&lt;img/.test(peligroso) && !/<b>x<\/b>/.test(peligroso), peligroso);

    // Muchos: se muestran seis por sección y se dice cuántos más.
    sb.__muchos = Array.from({ length: 9 }, (_, i) => ({ titulo: 'Tarea ' + i, fechaLimite: dia(-1) }));
    const largo = correr(sb, `htmlResumenPendientes(resumirPendientes(__muchos, null, ${HOY}, {}), '')`);
    verificar('muchos: seis a la vista y "y N más"', (largo.match(/<li>/g) || []).length === 6 && /y 3 más/.test(largo));
}

async function pruebaAccion() {
    const { sb, estado } = crearSandbox();
    const consultar = async (p) => {
        estado.mensajes.length = 0; estado.dichos.length = 0;
        sb.__p = p;
        await correr(sb, 'accConsultarPendientes(__p)');
        return { html: estado.mensajes.join('\n'), dicho: estado.dichos.join('\n') };
    };

    let r = await consultar({});
    verificar('sin filtros: el resumen de todo', /7 pendientes por hacer/.test(r.html) && /^Tienes 7 pendientes:/.test(r.dicho), r.dicho);

    r = await consultar({ expedienteRef: '123/2025' });
    verificar('de un expediente: solo los suyos, y lo dice', /2 pendientes por hacer del 123\/2025/.test(r.html) && /^Tienes 2 pendientes del 123\/2025:/.test(r.dicho), r.dicho);

    r = await consultar({ paraTodosLosDe: 'AHO' });
    verificar('de un grupo (carpeta y cliente AHO): los de sus expedientes', /3 pendientes por hacer de AHO/.test(r.html), r.html.slice(0, 200));

    r = await consultar({ periodo: 'semana', prioridad: 'alta' });
    verificar('los filtros se combinan y se dicen', /1 pendiente por hacer con prioridad alta, para esta semana/.test(r.html), r.html.slice(0, 200));

    r = await consultar({ prioridad: 'baja' });
    igual('sin nada que mostrar se dice con los filtros pedidos', r.dicho, 'No tienes pendientes por hacer con prioridad baja.');

    r = await consultar({ prioridad: 'urgentísima', periodo: 'siempre' });
    verificar('un filtro desconocido no rompe nada: se ignora', /7 pendientes por hacer/.test(r.html));

    const e = await lanza(() => consultar({ paraTodosLosDe: 'Inexistente' }));
    verificar('un grupo que no existe se dice', e && e._esAviso && /No encontré expedientes de “Inexistente”/.test(e.message), e && e.message);

    estado.pendientes.length = 0;
    r = await consultar({});
    igual('sin ningún pendiente', r.dicho, 'No tienes pendientes por hacer.');
}

function pruebaProtocoloYMicrofono() {
    const prompt = extraerIndentado(VOZ, 'construirPromptSistema');
    verificar('el modelo sabe que puede resumir los pendientes', /RESUMEN de los pendientes por hacer/.test(prompt) && /NUNCA digas que no puedes resumir o consultar los pendientes/.test(prompt));
    verificar('y conoce los filtros', /periodo:"vencidos"\|"hoy"\|"semana"\|"mes"/.test(prompt) && /paraTodosLosDe:texto o null, prioridad/.test(prompt));
    verificar('la acción se ejecuta', /case 'consultar_pendientes':\s+mensajeFinal = await accConsultarPendientes\(p\)/.test(extraerIndentado(VOZ, 'ejecutarAccionResuelta')));
    verificar('la guía de comandos tiene su sección de pendientes', /titulo: '✅ Pendientes'/.test(VOZ) && /'Dame un resumen de mis pendientes'/.test(VOZ));

    // El micrófono: solo al tocarlo, salvo «manos libres».
    const llamadas = [...VOZ.matchAll(/^.*\biniciarEscucha\(\);.*$/gm)].map(m => m[0].trim());
    igual('el micrófono solo se enciende en tres lugares: el botón, y con «manos libres» al abrir o tras una pregunta',
        llamadas, ['if (escuchaManosLibres()) iniciarEscucha();', 'if (escuchaManosLibres()) { iniciarEscucha(); return; }', 'iniciarEscucha();']);
    verificar('el tercero es el botón del micrófono', /function alternarMicrofono\(\)[\s\S]*?iniciarEscucha\(\);\n    \}/.test(VOZ));
    verificar('«manos libres» solo cuenta si se eligió (apagado por omisión)', /localStorage\.getItem\(AUTO_KEY\) === '1'/.test(extraerIndentado(VOZ, 'escuchaManosLibres')));
    verificar('y la opción vieja, que venía encendida, se descarta', /removeItem\('voz_auto_escucha'\)/.test(VOZ));
    verificar('tras una pregunta sin «manos libres» se dice cómo contestar', /Toca el micrófono para contestar/.test(extraerIndentado(VOZ, 'seguirEscuchando')));
    verificar('nadie vuelve a escuchar por su cuenta tras hablar', !/hablar\([^;]*iniciarEscucha/.test(VOZ));
}

(async () => {
    console.log('Resumen de pendientes y micrófono del asistente');
    for (const prueba of [pruebaMotor, pruebaAccion, pruebaProtocoloYMicrofono]) {
        try { await prueba(); } catch (e) { fallos.push(`${prueba.name} reventó: ${e.stack || e.message}`); }
    }
    console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas\n`);
    if (fallos.length) {
        fallos.forEach(f => console.log('  ✗ ' + f));
        process.exit(1);
    }
    console.log('✓ El asistente resume los pendientes y el micrófono solo se enciende al tocarlo.');
})();
