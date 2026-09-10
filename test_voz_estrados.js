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
    const estado = { ventanas: [], navegado: [], resolverDevuelve: null, resolverLanza: null };

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
        construirURLPJF: (orgId, tipoId, numero) =>
            `https://www.dgej.cjf.gob.mx/consulta?org=${orgId}&tipo=${tipoId}&exp=${encodeURIComponent(numero)}`,
        ErrorAviso: (m) => { const e = new Error(m); e._esAviso = true; return e; },
        ErrorEleccion: (m) => { const e = new Error(m); e._esEleccion = true; return e; }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    // Resolutores reales del PJF.
    const pjf = fs.readFileSync(path.join(JS, 'pjf-search.js'), 'utf8');
    for (const n of ['normalizarTextoPJF', 'PJF_STOPWORDS', 'tokensPJF',
                     'PJF_ORDINAL_UNIDAD', 'PJF_ORDINAL_DECENA', 'PJF_ORDINAL_SUELTO', 'PJF_ROMANOS',
                     '_romanoANumero', 'canonizarOrdinalesPJF',
                     '_numeroCircuitoPJF', '_ordinalOrganoPJF',
                     'buscarOrganismoPJF', 'buscarTipoAsuntoPJF', 'tiposAsuntoDeOrgano']) {
        vm.runInContext(extraer(pjf, n, 'pjf-search.js'), sandbox, { filename: `pjf-search.js:${n}` });
    }

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

    // La acción del asistente, tal cual está escrita.
    const voz = fs.readFileSync(path.join(JS, 'voice-assistant.js'), 'utf8');
    vm.runInContext(extraerIndentado(voz, 'accBuscarPJF', 'voice-assistant.js'),
        sandbox, { filename: 'voice-assistant.js:accBuscarPJF' });

    return { sandbox, estado };
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
        /org=462(&|$)/.test(estado.ventanas[0]?.url || ''), estado.ventanas[0]?.url);
    verificar('acción: y con "Amparo Directo" (tipo 10)',
        /tipo=10(&|$)/.test(estado.ventanas[0]?.url || ''), estado.ventanas[0]?.url);
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
        /org=462.*tipo=10/.test(d.estado.ventanas[0]?.url || ''), d.estado.ventanas[0]?.url);
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
}

(async () => {
    const pruebas = [
        ['ordinales y romanos', pruebaOrdinales],
        ['resolver el órgano', pruebaOrgano],
        ['tipo de asunto', pruebaTipoAsunto],
        ['la acción del asistente', pruebaAccion],
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
