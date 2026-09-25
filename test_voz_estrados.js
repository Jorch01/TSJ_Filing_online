#!/usr/bin/env node
/**
 * Pruebas de "ábreme los estrados de ..." dictado al asistente.
 *
 *   node test_voz_estrados.js
 *
 * Estas consultas se hacen sobre todo con asuntos que NO están dados de alta:
 * se dicta el órgano y el número y ya. Aquí se fijan las dos cosas que hacían
 * que la misma orden funcionara unas veces sí y otras no:
 *
 *   1. El catálogo escribe los circuitos con ordinales ("Vigésimo Séptimo")
 *      y nadie los dicta así; se dice "el 27". Sin traducción, el órgano no
 *      se resolvía y la orden moría.
 *   2. La acción resolvía primero el expediente en el catálogo del usuario y
 *      abortaba si no lo encontraba, sin llegar a usar el órgano dictado.
 *
 * Se carga el código real de docs/js/, no una copia.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = __dirname;
const JS = path.join(RAIZ, 'docs', 'js');
const CATALOGO = JSON.parse(
    fs.readFileSync(path.join(RAIZ, 'docs', 'data', 'pjf_catalogos_completos.json'), 'utf8'));

// Declaración de nivel superior (pjf-search.js).
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

// El asistente vive dentro de un IIFE, así que sus funciones van indentadas.
function extraerIndentado(fuente, nombre, archivo) {
    const re = new RegExp('^([ \\t]*)(?:async )?function ' + nombre + '\\s*\\([\\s\\S]*?\\n\\1\\}', 'm');
    const m = re.exec(fuente);
    if (!m) throw new Error(`No se encontró "${nombre}" en ${archivo} (¿se renombró?)`);
    return m[0];
}

function crearEntorno() {
    const estado = { ventanas: [], navegado: [], mensajes: [], resolverDevuelve: null, resolverLanza: null };

    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        estado,
        setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
        document: { getElementById: () => null },
        window: null,
        // Abrir la ventana se registra en vez de abrirse.
        open: (url, nombre) => { estado.ventanas.push({ url, nombre }); return { focus() {} }; },
        navegarA: (p) => estado.navegado.push(p),
        // El catálogo del usuario: por omisión no encuentra nada, que es el
        // caso que importa (asunto no dado de alta).
        resolverExpedienteDeParametros: async () => {
            if (estado.resolverLanza) throw estado.resolverLanza;
            return estado.resolverDevuelve;
        },
        asegurarCatalogosPJF: async () => true,
        ErrorAviso: (m) => { const e = new Error(m); e._esAviso = true; return e; },
        ErrorEleccion: (m) => { const e = new Error(m); e._esEleccion = true; return e; },
        // El chat del asistente: se anota lo que se pinta en vez de pintarlo.
        agregarMensaje: (rol, html) => { estado.mensajes.push(html); return null; },
        esc: (t) => String(t == null ? '' : t),
        // Estas llegan desde el resto del asistente; aquí no hacen falta.
        pedirConfirmacion: () => {}, ejecutarAccion: async () => {}, informarFallo: () => {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    // pjf-search.js entero. Extraer funciones sueltas obligaba a mantener una
    // lista a mano y se rompía en cuanto una de ellas ganaba una dependencia;
    // el archivo no hace nada al cargarse, así que cargarlo completo prueba lo
    // que se despliega y no una selección.
    vm.runInContext(fs.readFileSync(path.join(JS, 'pjf-search.js'), 'utf8'),
        sandbox, { filename: 'pjf-search.js' });

    // Catálogo oficial, montado igual que lo monta cargarCatalogosPJF().
    const porTipo = {};
    (CATALOGO.tiposOrgano || []).forEach(to => {
        const tid = to.TipoOrganismoId;
        if (!porTipo[tid]) porTipo[tid] = { nombre: to.TipoOrganismo, tiposAsunto: {} };
        (to.tiposAsunto || []).forEach(ta => {
            if (!porTipo[tid].tiposAsunto[ta.id]) porTipo[tid].tiposAsunto[ta.id] = ta.nombre;
        });
    });
    Object.keys(porTipo).forEach(tid => {
        const m = porTipo[tid].tiposAsunto;
        porTipo[tid].tiposAsuntoArr = Object.keys(m)
            .map(id => ({ id: Number(id), nombre: m[id] })).sort((a, b) => a.id - b.id);
    });
    vm.runInContext(
        `pjfOrganismos = ${JSON.stringify((CATALOGO.organos || []).map(o => ({
            id: o.id, nombre: o.nombre, circuito: o.circuito || '',
            ciudad: o.ciudad || '', estado: o.estado || '', tipoOrganismoId: o.tipoOrganismoId
        })))};
         pjfTiposOrgano = ${JSON.stringify(porTipo)};`, sandbox);

    // La sección de búsquedas del asistente, tal cual está escrita, con las
    // constantes y ayudantes que usa.
    const voz = fs.readFileSync(path.join(JS, 'voice-assistant.js'), 'utf8');
    for (const nombre of ['MAX_ORGANOS_PJF', 'MAX_VENTANAS_AUTO', 'MAX_CONSULTAS']) {
        const tope = new RegExp('^[ \\t]*const ' + nombre + ' = \\d+;', 'm').exec(voz);
        if (!tope) throw new Error(`No se encontró ${nombre} (¿se renombró?)`);
        vm.runInContext(tope[0].trim(), sandbox, { filename: 'voice-assistant.js:' + nombre });
    }
    for (const nombre of ['normalizar', 'matchJuzgadoTSJ']) {
        vm.runInContext(extraerIndentado(voz, nombre, 'voice-assistant.js'),
            sandbox, { filename: 'voice-assistant.js:' + nombre });
    }
    vm.runInContext(extraerSeccionVoz(voz, 'BÚSQUEDAS EN ESTRADOS'),
        sandbox, { filename: 'voice-assistant.js:búsquedas' });

    // El catálogo del TSJ, entero: tampoco hace nada al cargarse.
    vm.runInContext(fs.readFileSync(path.join(JS, 'juzgados.js'), 'utf8'),
        sandbox, { filename: 'juzgados.js' });

    return { sandbox, estado };
}

// Una sección entera del asistente, entre su separador "// ====" y el siguiente.
function extraerSeccionVoz(fuente, titulo) {
    const marca = fuente.indexOf('// ==================== ' + titulo);
    if (marca === -1) throw new Error(`No se encontró la sección "${titulo}" en voice-assistant.js`);
    const siguiente = fuente.indexOf('// ====================', marca + 30);
    return fuente.slice(marca, siguiente === -1 ? undefined : siguiente);
}

let pasadas = 0, fallidas = 0;
const fallos = [];
function verificar(d, c, det) {
    if (c) { pasadas++; return; }
    fallidas++; fallos.push(d + (det ? `\n      ${det}` : ''));
}
function igual(d, real, esperado) {
    verificar(d, JSON.stringify(real) === JSON.stringify(esperado),
        `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}

// ==================== ORDINALES ====================

function pruebaOrdinales() {
    const { sandbox } = crearEntorno();
    const c = sandbox.canonizarOrdinalesPJF;

    igual('ordinal: "vigésimo séptimo" es 27', c('vigésimo séptimo circuito'), '27 circuito');
    igual('ordinal: "primer" es 1', c('primer tribunal'), '1 tribunal');
    igual('ordinal: "décimo" solo es 10', c('décimo circuito'), '10 circuito');
    igual('ordinal: "décimo primero" es 11', c('décimo primero circuito'), '11 circuito');
    igual('ordinal: "undécimo" también es 11', c('undécimo circuito'), '11 circuito');
    igual('ordinal: "trigésimo segundo" es 32', c('trigésimo segundo circuito'), '32 circuito');
    igual('ordinal: los números romanos también', c('XXVII circuito'), '27 circuito');
    igual('ordinal: un número ya escrito se queda igual', c('27 circuito'), '27 circuito');
    igual('ordinal: lo que no es ordinal no se toca',
        c('juzgado de distrito en materia civil'), 'juzgado de distrito en materia civil');
    // Una "i" suelta es una letra, no un uno romano.
    verificar('ordinal: una "i" suelta no se convierte en número',
        !/\b1\b/.test(c('juzgado i de distrito')), c('juzgado i de distrito'));
}

// ==================== RESOLVER EL ÓRGANO ====================

function pruebaOrgano() {
    const { sandbox } = crearEntorno();
    const b = (t) => sandbox.buscarOrganismoPJF(t);
    const ID_PRIMERO_27 = 462;   // Primer Tribunal Colegiado del Vigésimo Séptimo Circuito

    // La misma orden dictada de todas las formas en que se dice.
    for (const frase of [
        'primer tribunal colegiado del 27 circuito',
        'primer tribunal colegiado del vigesimo septimo circuito',
        'Primer Tribunal Colegiado del Vigésimo Séptimo Circuito',
        'primer tribunal colegiado del XXVII circuito',
        'primer colegiado del 27',
        'primer tribunal colegiado de circuito del 27 en cancun'
    ]) {
        const o = b(frase);
        igual(`órgano: "${frase}"`, o && o.id, ID_PRIMERO_27);
    }

    // Y que NO se confunda de tribunal, que es lo grave.
    const segundo = b('segundo tribunal colegiado del 27 circuito');
    verificar('órgano: el Segundo no devuelve el Primero',
        segundo && segundo.id !== ID_PRIMERO_27 && /Segundo/i.test(segundo.nombre),
        segundo && segundo.nombre);
    const tercero = b('tercer tribunal colegiado del 27 circuito');
    verificar('órgano: el Tercero tampoco', tercero && /Tercer/i.test(tercero.nombre),
        tercero && tercero.nombre);

    // El número del órgano y el del circuito no se pueden intercambiar.
    const cruzado = b('primer tribunal colegiado del segundo circuito');
    verificar('órgano: no confunde el ordinal del órgano con el del circuito',
        cruzado && /Primer/i.test(cruzado.nombre) && /Segundo Circuito/i.test(cruzado.nombre),
        cruzado && cruzado.nombre);

    // Juzgados de distrito, que se dictan igual.
    const jd = b('juzgado segundo de distrito en quintana roo');
    verificar('órgano: los juzgados de distrito también',
        jd && /Segundo de Distrito/i.test(jd.nombre) && /Quintana Roo/i.test(jd.nombre),
        jd && jd.nombre);

    igual('órgano: lo que no existe sigue sin resolverse',
        b('tribunal inventado del circuito 99'), null);
}

// ==================== TIPO DE ASUNTO ====================

function pruebaTipoAsunto() {
    const { sandbox } = crearEntorno();
    const org = sandbox.buscarOrganismoPJF('primer tribunal colegiado del 27 circuito');
    verificar('tipo: hay órgano con el que probar', !!org);
    if (!org) return;

    igual('tipo: "amparo directo" se reconoce',
        (sandbox.buscarTipoAsuntoPJF(org, 'amparo directo') || {}).nombre, 'Amparo Directo');
    verificar('tipo: un colegiado ofrece amparo directo entre sus tipos',
        sandbox.tiposAsuntoDeOrgano(org).some(t => /Amparo Directo/i.test(t.nombre)));
    igual('tipo: lo que no aplica no se inventa',
        sandbox.buscarTipoAsuntoPJF(org, 'divorcio incausado'), null);
}

// ==================== LA ACCIÓN DEL ASISTENTE ====================

async function pruebaAccion() {
    // El caso real: el amparo NO está dado de alta en el catálogo.
    const { sandbox, estado } = crearEntorno();
    estado.resolverLanza = sandbox.ErrorAviso('No encontré ningún expediente que coincida con "486/2026".');

    const respuesta = await sandbox.accBuscarPJF({
        numero: '486/2026',
        organismo: 'primer tribunal colegiado del 27 circuito',
        tipoAsunto: 'amparo directo',
        expedienteRef: '486/2026'
    });

    igual('acción: se abre una ventana aunque el asunto no esté registrado', estado.ventanas.length, 1);
    verificar('acción: apunta al portal del PJF',
        /dgej\.cjf\.gob\.mx/.test(estado.ventanas[0]?.url || ''), estado.ventanas[0]?.url);
    verificar('acción: con el número dictado',
        (estado.ventanas[0]?.url || '').includes(encodeURIComponent('486/2026')),
        estado.ventanas[0]?.url);
    verificar('acción: con el órgano correcto (462)',
        /[?&]organismo=462(&|$)/.test(estado.ventanas[0]?.url || ''), estado.ventanas[0]?.url);
    verificar('acción: y con "Amparo Directo" (tipo 10)',
        /[?&]tipoasunto=10(&|$)/.test(estado.ventanas[0]?.url || ''), estado.ventanas[0]?.url);
    verificar('acción: lo dice en la respuesta', /486\/2026/.test(respuesta || ''), respuesta);
    igual('acción: no hizo falta desviar a la página del PJF', estado.navegado, []);

    // Elegir entre varios candidatos del catálogo sigue siendo útil: eso sí corta.
    const b = crearEntorno();
    b.estado.resolverLanza = b.sandbox.ErrorEleccion('¿Cuál de estos?');
    let corto = false;
    try {
        await b.sandbox.accBuscarPJF({ numero: '486/2026', organismo: 'primer tribunal colegiado del 27 circuito' });
    } catch (e) { corto = !!e._esEleccion; }
    verificar('acción: si hay varios expedientes suyos, sigue preguntando cuál', corto);

    // Sin órgano ni número no hay nada que hacer: el aviso debe llegar.
    const c = crearEntorno();
    c.estado.resolverLanza = c.sandbox.ErrorAviso('No encontré ningún expediente');
    let aviso = false;
    try {
        await c.sandbox.accBuscarPJF({ expedienteRef: 'lo de Ramírez' });
    } catch (e) { aviso = !!e._esAviso; }
    verificar('acción: sin datos que usar, el aviso sí llega al usuario', aviso);

    // Un expediente del catálogo con sus datos del PJF sigue funcionando.
    const d = crearEntorno();
    d.estado.resolverDevuelve = { id: 1, numero: '99/2025', pjfOrgId: 462, pjfTipoAsunto: 10 };
    await d.sandbox.accBuscarPJF({ expedienteRef: 'el 99' });
    igual('acción: un expediente ya registrado abre directo', d.estado.ventanas.length, 1);
    verificar('acción: con sus datos guardados',
        /[?&]organismo=462(&|$)/.test(d.estado.ventanas[0]?.url || '') &&
        /[?&]tipoasunto=10(&|$)/.test(d.estado.ventanas[0]?.url || ''), d.estado.ventanas[0]?.url);
}

// ==================== VARIOS ÓRGANOS A LA VEZ ====================
// Buscar el mismo asunto en los tres colegiados de un circuito, o en dos
// circuitos distintos, es trabajo de todos los días: el amparo se turna a uno
// de ellos y hasta que no se publica no se sabe a cuál.

function pruebaExpansion() {
    const { sandbox } = crearEntorno();
    const ids = (t) => sandbox.buscarOrganismosPJF(t).map(o => o.id);

    // Una frase concreta es uno solo; una genérica, todos los de ese circuito.
    igual('expansión: nombrar uno devuelve uno',
        ids('primer tribunal colegiado del 27 circuito'), [462]);
    igual('expansión: "tribunales colegiados del 27" son los tres',
        ids('tribunales colegiados del 27 circuito'), [462, 944, 1319]);
    igual('expansión: en plural coloquial, los mismos',
        ids('los colegiados del 27'), [462, 944, 1319]);
    igual('expansión: y vienen en orden (Primero, Segundo, Tercero)',
        ids('tribunales colegiados del 27 circuito'), [462, 944, 1319]);

    // Otro circuito da otros órganos, sin mezclarse.
    const c28 = ids('tribunales colegiados del 28 circuito');
    verificar('expansión: otro circuito devuelve los suyos', c28.length >= 2, JSON.stringify(c28));
    verificar('expansión: y ninguno del 27 se cuela',
        c28.every(id => ![462, 944, 1319].includes(id)), JSON.stringify(c28));

    // Solo tribunales: ni oficinas administrativas ni otro tipo de órgano.
    const nombres = sandbox.buscarOrganismosPJF('tribunales colegiados del 27 circuito').map(o => o.nombre);
    verificar('expansión: no se cuela la Oficina de Correspondencia Común',
        !nombres.some(n => /Oficina de Correspondencia/i.test(n)), JSON.stringify(nombres));
    verificar('expansión: ni un Tribunal Colegiado de Apelación, que es otro tipo',
        !nombres.some(n => /de Apelación/i.test(n)), JSON.stringify(nombres));
    const tipos = new Set(sandbox.buscarOrganismosPJF('juzgados de distrito en quintana roo')
        .map(o => o.tipoOrganismoId));
    igual('expansión: todos los devueltos son del mismo tipo de órgano', tipos.size, 1);
}

async function pruebaVariosOrganos() {
    // Los tres colegiados del 27, con un asunto que no está dado de alta.
    const { sandbox, estado } = crearEntorno();
    estado.resolverLanza = sandbox.ErrorAviso('No encontré ningún expediente');

    const r = await sandbox.accBuscarPJF({
        numero: '486/2026',
        organismos: ['tribunales colegiados del 27 circuito'],
        tipoAsunto: 'amparo directo'
    });

    igual('varios: se abre una ventana por tribunal', estado.ventanas.length, 3);
    igual('varios: y cada una en su propio hueco',
        new Set(estado.ventanas.map(v => v.nombre)).size, 3);
    verificar('varios: todas con el mismo número',
        estado.ventanas.every(v => v.url.includes(encodeURIComponent('486/2026'))),
        JSON.stringify(estado.ventanas.map(v => v.url)));
    igual('varios: a los tres órganos del circuito',
        estado.ventanas.map(v => Number(/[?&]organismo=(\d+)/.exec(v.url)[1])).sort((a, b) => a - b),
        [462, 944, 1319]);
    verificar('varios: la respuesta dice en cuántos buscó', /3 órganos/.test(r || ''), r);

    // Dos circuitos distintos en la misma orden.
    const dos = crearEntorno();
    dos.estado.resolverLanza = dos.sandbox.ErrorAviso('no está');
    await dos.sandbox.accBuscarPJF({
        numero: '100/2026',
        organismos: ['tribunales colegiados del 27 circuito', 'tribunales colegiados del 28 circuito'],
        tipoAsunto: 'amparo directo'
    });
    verificar('varios: dos circuitos abren los de ambos',
        dos.estado.ventanas.length >= 5, String(dos.estado.ventanas.length));

    // Enumerados a mano, sin repetir si se solapan.
    const enum_ = crearEntorno();
    enum_.estado.resolverLanza = enum_.sandbox.ErrorAviso('no está');
    await enum_.sandbox.accBuscarPJF({
        numero: '7/2026',
        organismos: ['primer tribunal colegiado del 27 circuito',
                     'segundo tribunal colegiado del 27 circuito',
                     'los colegiados del 27'],
        tipoAsunto: 'amparo directo'
    });
    igual('varios: un órgano repetido no abre dos ventanas', enum_.estado.ventanas.length, 3);

    // Una referencia que no existe no tumba las que sí.
    const mixto = crearEntorno();
    mixto.estado.resolverLanza = mixto.sandbox.ErrorAviso('no está');
    const rm = await mixto.sandbox.accBuscarPJF({
        numero: '8/2026',
        organismos: ['primer tribunal colegiado del 27 circuito', 'tribunal inventado del circuito 99'],
        tipoAsunto: 'amparo directo'
    });
    igual('varios: lo que sí se identificó se abre igual', mixto.estado.ventanas.length, 1);
    verificar('varios: y se avisa de lo que no se identificó',
        /no identifiqué/.test(rm || ''), rm);

    // Demasiados: mejor decirlo que abrir treinta ventanas que el navegador bloquea.
    const muchos = crearEntorno();
    muchos.estado.resolverLanza = muchos.sandbox.ErrorAviso('no está');
    let aviso = null;
    try {
        await muchos.sandbox.accBuscarPJF({
            numero: '9/2026',
            organismos: ['juzgados de distrito'],
            tipoAsunto: 'amparo indirecto'
        });
    } catch (e) { aviso = e; }
    verificar('varios: por encima del tope no se abre nada',
        muchos.estado.ventanas.length === 0, String(muchos.estado.ventanas.length));
    verificar('varios: y se explica por qué', aviso && /demasiadas ventanas/i.test(aviso.message),
        aviso && aviso.message);

    // Un solo órgano sigue funcionando igual que antes.
    const uno = crearEntorno();
    uno.estado.resolverLanza = uno.sandbox.ErrorAviso('no está');
    const ru = await uno.sandbox.accBuscarPJF({
        numero: '486/2026',
        organismo: 'primer tribunal colegiado del 27 circuito',
        tipoAsunto: 'amparo directo'
    });
    igual('varios: con "organismo" en singular se abre una sola', uno.estado.ventanas.length, 1);
    verificar('varios: y la respuesta nombra el tribunal',
        /Primer Tribunal Colegiado/.test(ru || ''), ru);
}

// ==================== VARIOS TIPOS DE ASUNTO ====================
// "La queja y el amparo directo 486/2026 en el primero del 27": el mismo número
// en varios tipos de asunto del mismo órgano. O en todos, cuando no se sabe de
// qué tipo es.

// Tipos que no son asuntos que alguien consulte por número. Es la regla que
// se espera, escrita aparte a propósito: si la del asistente cambia, se nota.
const TIPOS_ADMINISTRATIVOS = /comunicaciones oficiales|varios administrativo/i;
const tipoDe = (url) => Number(/[?&]tipoasunto=(\d+)/.exec(url)[1]);
const organoDe = (url) => Number(/[?&]organismo=(\d+)/.exec(url)[1]);

async function pruebaVariosTipos() {
    const { sandbox, estado } = crearEntorno();
    estado.resolverLanza = sandbox.ErrorAviso('No encontré ningún expediente');
    const r = await sandbox.accBuscarPJF({
        numero: '486/2026',
        organismo: 'primer tribunal colegiado del 27 circuito',
        tiposAsunto: ['queja', 'amparo directo']
    });
    igual('tipos: una ventana por tipo', estado.ventanas.length, 2);
    igual('tipos: la queja (15) y el amparo directo (10)', estado.ventanas.map(v => tipoDe(v.url)).sort((a, b) => a - b), [10, 15]);
    igual('tipos: las dos en el mismo órgano', estado.ventanas.map(v => organoDe(v.url)), [462, 462]);
    igual('tipos: cada una en su propia ventana (si no, la segunda tapaba a la primera)',
        new Set(estado.ventanas.map(v => v.nombre)).size, 2);
    verificar('tipos: la respuesta dice cuáles', /Queja/.test(r) && /Amparo Directo/.test(r), r);
    verificar('tipos: y deja la lista para reabrirlas', estado.mensajes.some(m => /2 consultas/.test(m)), JSON.stringify(estado.mensajes));

    // Un tipo que ese órgano no tiene no tumba al que sí.
    const parcial = crearEntorno();
    parcial.estado.resolverLanza = parcial.sandbox.ErrorAviso('no está');
    await parcial.sandbox.accBuscarPJF({
        numero: '486/2026', organismo: 'primer tribunal colegiado del 27 circuito',
        tiposAsunto: ['amparo directo', 'divorcio incausado']
    });
    igual('tipos: el que no existe en el órgano se salta', parcial.estado.ventanas.map(v => tipoDe(v.url)), [10]);

    // Un expediente guardado: su órgano, con los tipos que se dicten.
    const guardado = crearEntorno();
    guardado.estado.resolverDevuelve = { id: 1, numero: '99/2025', pjfOrgId: 462, pjfTipoAsunto: 10 };
    await guardado.sandbox.accBuscarPJF({ expedienteRef: 'el 99', tiposAsunto: ['queja'] });
    igual('tipos: con un expediente guardado se usa su órgano y el tipo dictado',
        guardado.estado.ventanas.map(v => [organoDe(v.url), tipoDe(v.url)]), [[462, 15]]);
}

async function pruebaTodosLosTipos() {
    const { sandbox, estado } = crearEntorno();
    estado.resolverLanza = sandbox.ErrorAviso('no está');
    const organo = sandbox.buscarOrganismoPJF('segundo tribunal colegiado del 27 circuito');
    const esperados = sandbox.tiposAsuntoDeOrgano(organo).filter(t => !TIPOS_ADMINISTRATIVOS.test(t.nombre)).map(t => t.id);

    await sandbox.accBuscarPJF({ numero: '55/2026', organismo: 'segundo tribunal colegiado del 27 circuito', tiposAsunto: ['todos'] });
    const abiertos = estado.ventanas.map(v => tipoDe(v.url)).sort((a, b) => a - b);
    igual('todos: se abre cada tipo de asunto del colegiado', abiertos, esperados.slice().sort((a, b) => a - b));
    verificar('todos: son bastantes (no se quedó en uno)', abiertos.length >= 10, String(abiertos.length));
    verificar('todos: sin las comunicaciones oficiales, que no son asuntos', !abiertos.includes(44) && !abiertos.includes(45),
        JSON.stringify(abiertos));
    verificar('todos: con el amparo directo, el amparo en revisión y la queja', [10, 11, 15].every(t => abiertos.includes(t)));
    igual('todos: todas en el mismo órgano', [...new Set(estado.ventanas.map(v => organoDe(v.url)))], [organo.id]);

    // Se dice de muchas formas.
    for (const dicho of ['Todos', 'todos los tipos de asunto', 'cualquiera', 'todas']) {
        verificar(`todos: "${dicho}" también quiere decir todos`, sandbox.pideTodosLosTipos([dicho]));
    }
    verificar('todos: "amparo directo" no', !sandbox.pideTodosLosTipos(['amparo directo']));

    // En los tres colegiados son demasiadas para abrirlas solas: se deja la
    // lista con un botón para abrirlas todas.
    const tres = crearEntorno();
    tres.estado.resolverLanza = tres.sandbox.ErrorAviso('no está');
    const r3 = await tres.sandbox.accBuscarPJF({
        numero: '55/2026', organismos: ['tribunales colegiados del 27 circuito'], tiposAsunto: ['todos']
    });
    igual('todos x3: no se abren solas', tres.estado.ventanas.length, 0);
    verificar('todos x3: se deja la lista para abrirlas', /lista/.test(r3) && tres.estado.mensajes.some(m => /consultas listas/.test(m)),
        r3 + ' | ' + JSON.stringify(tres.estado.mensajes));

    // Sin decir el tipo: se ofrecen los posibles, pero no se abre nada.
    const sinTipo = crearEntorno();
    sinTipo.estado.resolverLanza = sinTipo.sandbox.ErrorAviso('no está');
    const rs = await sinTipo.sandbox.accBuscarPJF({ numero: '486/2026', organismo: 'primer tribunal colegiado del 27 circuito' });
    igual('sin tipo: no abre nada por su cuenta', sinTipo.estado.ventanas.length, 0);
    verificar('sin tipo: lo dice y deja los tipos para elegir', /No me dijiste el tipo de asunto/.test(rs), rs);
    const plan = await sinTipo.sandbox.planBuscarPJF({ numero: '486/2026', organismo: 'primer tribunal colegiado del 27 circuito' });
    verificar('sin tipo: los que ofrece son los del órgano', plan.faltaTipo && plan.consultas.length >= 10, String(plan.consultas.length));
}

// ==================== VARIOS JUZGADOS DEL TSJ ====================

async function pruebaVariosJuzgadosTSJ() {
    const { sandbox, estado } = crearEntorno();
    const r = await sandbox.accBuscarTSJ({
        valor: '123/2025', tipoBusqueda: 'numero',
        juzgados: ['juzgado primero civil de cancún', 'JUZGADO SEGUNDO CIVIL CANCUN', 'juzgado inventado']
    });
    igual('tsj: una ventana por juzgado identificado', estado.ventanas.length, 2);
    verificar('tsj: al buscador de estrados del TSJ',
        estado.ventanas.every(v => /tsjqroo\.gob\.mx\/estrados\/buscador_primera\.php/.test(v.url)), JSON.stringify(estado.ventanas));
    verificar('tsj: con el número', estado.ventanas.every(v => v.url.includes(encodeURIComponent('123/2025'))));
    verificar('tsj: en dos juzgados distintos', new Set(estado.ventanas.map(v => /[?&]int=(\d+)/.exec(v.url)[1])).size === 2);
    verificar('tsj: y avisa del que no identificó', /no identifiqué "juzgado inventado"/.test(r), r);

    // Las salas de segunda instancia caben: se abren solas.
    const salas = crearEntorno();
    await salas.sandbox.accBuscarTSJ({ valor: '10/2026', ambito: 'segunda' });
    igual('tsj: las once salas se abren', salas.estado.ventanas.length, 11);
    verificar('tsj: con su buscador de segunda instancia',
        salas.estado.ventanas.every(v => /buscador_segunda\.php/.test(v.url)));

    // Todos los juzgados del estado son muchos: lista con botón.
    const todos = crearEntorno();
    const rt = await todos.sandbox.accBuscarTSJ({ valor: '10/2026' });
    igual('tsj: en todos los juzgados no se abren cincuenta ventanas solas', todos.estado.ventanas.length, 0);
    verificar('tsj: se dejan en una lista', /lista/.test(rt), rt);
}

// ==================== VARIOS ASUNTOS EN UNA ORDEN ====================

async function pruebaVariosAsuntos() {
    const { sandbox, estado } = crearEntorno();
    estado.resolverLanza = sandbox.ErrorAviso('no está');
    const juzgadoDistrito = sandbox.buscarOrganismoPJF('juzgado primero de distrito en quintana roo');

    await sandbox.accBuscarVarios({ busquedas: [
        { accion: 'buscar_tsj', parametros: { valor: '123/2025', tipoBusqueda: 'numero', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' } },
        { accion: 'buscar_pjf', parametros: { numero: '45/2026', organismo: 'juzgado primero de distrito en quintana roo', tiposAsunto: ['amparo indirecto'] } },
        { accion: 'buscar_pjf', parametros: { numero: '100/2026', organismo: 'primer tribunal colegiado del 27 circuito', tipoAsunto: 'amparo directo' } }
    ] });
    igual('varios asuntos: una ventana por asunto', estado.ventanas.length, 3);
    igual('varios asuntos: uno en el TSJ', estado.ventanas.filter(v => /tsjqroo/.test(v.url)).length, 1);
    igual('varios asuntos: dos en el PJF', estado.ventanas.filter(v => /dgej\.cjf\.gob\.mx/.test(v.url)).length, 2);
    for (const numero of ['123/2025', '45/2026', '100/2026']) {
        verificar(`varios asuntos: el ${numero} con su número`, estado.ventanas.some(v => v.url.includes(encodeURIComponent(numero))));
    }
    const amparo = estado.ventanas.find(v => v.url.includes(encodeURIComponent('45/2026')));
    verificar('varios asuntos: el amparo indirecto en el juzgado de distrito',
        amparo && juzgadoDistrito && organoDe(amparo.url) === juzgadoDistrito.id && tipoDe(amparo.url) === 1, amparo && amparo.url);

    // Uno que no se puede preparar no tumba a los demás.
    const mal = crearEntorno();
    mal.estado.resolverLanza = mal.sandbox.ErrorAviso('no está');
    const rm = await mal.sandbox.accBuscarVarios({ busquedas: [
        { accion: 'buscar_pjf', parametros: { numero: '100/2026', organismo: 'primer tribunal colegiado del 27 circuito', tipoAsunto: 'amparo directo' } },
        { accion: 'buscar_pjf', parametros: { numero: '1/2026', organismo: 'tribunal inventado del circuito 99', tipoAsunto: 'queja' } }
    ] });
    igual('varios asuntos: lo que sí se preparó se abre', mal.estado.ventanas.length, 1);
    verificar('varios asuntos: y se avisa del que no', /1\/2026/.test(rm) && /no identifiqué/.test(rm), rm);

    // El mismo asunto pedido dos veces se abre una.
    const doble = crearEntorno();
    doble.estado.resolverLanza = doble.sandbox.ErrorAviso('no está');
    const mismo = { accion: 'buscar_pjf', parametros: { numero: '7/2026', organismo: 'primer tribunal colegiado del 27 circuito', tipoAsunto: 'queja' } };
    await doble.sandbox.accBuscarVarios({ busquedas: [mismo, mismo] });
    igual('varios asuntos: repetido no abre dos ventanas', doble.estado.ventanas.length, 1);

    // Si no se pudo preparar ninguno, se dice.
    const nada = crearEntorno();
    nada.estado.resolverLanza = nada.sandbox.ErrorAviso('no está');
    let aviso = null;
    try {
        await nada.sandbox.accBuscarVarios({ busquedas: [
            { accion: 'buscar_tsj', parametros: { valor: '1/2026', juzgado: 'juzgado inventado' } }] });
    } catch (e) { aviso = e; }
    verificar('varios asuntos: sin nada que abrir, avisa', aviso && aviso._esAviso && /No pude preparar/.test(aviso.message),
        aviso && aviso.message);
}

// ==================== LAS INSTRUCCIONES AL MODELO ====================

function pruebaInstrucciones() {
    const voz = fs.readFileSync(path.join(JS, 'voice-assistant.js'), 'utf8');

    // El fallo de enrutado: "estrados" solo se nombraba en el TSJ, así que una
    // orden con "estrado" y "pjf" a la vez caía del lado equivocado.
    verificar('prompt: se explica cómo decidir entre TSJ y PJF',
        /CÓMO DECIDIR ENTRE ESTRADOS DEL TSJ Y DEL PJF/.test(voz));
    verificar('prompt: se dice que "estrados" vale para las dos',
        /NO deciden nada por sí solos/.test(voz));
    verificar('prompt: los órganos federales se enumeran',
        /tribunal colegiado.*juzgado de distrito|juzgado de distrito.*tribunal colegiado/i.test(voz));
    verificar('prompt: se avisa de que los ordinales dan igual',
        /vigésimo séptimo circuito.*XXVII|XXVII.*vigésimo séptimo/i.test(voz));
    verificar('prompt: se dice que el asunto no tiene que estar en el catálogo',
        /NO hace falta que el asunto esté en el catálogo/.test(voz));
    verificar('prompt: hay un ejemplo con la orden completa',
        /amparo directo 486\/2026 del primer tribunal colegiado del 27 circuito/.test(voz));
    verificar('prompt: se explica cómo pedir varios órganos',
        /VARIOS ÓRGANOS A LA VEZ/.test(voz));
    verificar('prompt: con ejemplo de circuitos distintos',
        /colegiados del 27 y del 28/.test(voz));
    verificar('prompt: y se le dice que no enumere él los órganos',
        /no los enumeres tú/i.test(voz));
    verificar('prompt: se explica cómo pedir varios tipos de asunto', /VARIOS TIPOS DE ASUNTO/.test(voz));
    verificar('prompt: y todos los tipos', /tiposAsunto:\["todos"\]/.test(voz));
    verificar('prompt: varios juzgados del TSJ', /VARIOS JUZGADOS/.test(voz) && /juzgados:\[/.test(voz));
    verificar('prompt: existe buscar_varios para asuntos distintos', /"buscar_varios": \{busquedas:/.test(voz));
    verificar('prompt: con un ejemplo que mezcla TSJ y PJF', /Ejemplo mixto/.test(voz));
}

(async () => {
    const pruebas = [
        ['ordinales y romanos', pruebaOrdinales],
        ['resolver el órgano', pruebaOrgano],
        ['tipo de asunto', pruebaTipoAsunto],
        ['la acción del asistente', pruebaAccion],
        ['expandir a varios órganos', pruebaExpansion],
        ['abrir varios a la vez', pruebaVariosOrganos],
        ['varios tipos de asunto', pruebaVariosTipos],
        ['todos los tipos de asunto', pruebaTodosLosTipos],
        ['varios juzgados del TSJ', pruebaVariosJuzgadosTSJ],
        ['varios asuntos en una orden', pruebaVariosAsuntos],
        ['las instrucciones al modelo', pruebaInstrucciones]
    ];
    for (const [nombre, fn] of pruebas) {
        try { await fn(); }
        catch (e) { fallidas++; fallos.push(`${nombre}: lanzó ${e && e.stack ? e.stack : e}`); }
    }
    console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
    if (fallos.length) {
        console.log('  Fallos:');
        fallos.forEach(f => console.log('   ✗ ' + f));
        console.log('');
        process.exit(1);
    }
    console.log('  ✓ Los estrados se abren como se dictan, estén o no dados de alta.\n');
})();
