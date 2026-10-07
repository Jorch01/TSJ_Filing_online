#!/usr/bin/env node
/**
 * Pruebas de cómo se sabe, por el nombre, a qué tribunal pertenece un
 * expediente que dio de alta la IA.
 *
 *   node test_datos_tribunal.js
 *
 * La IA copia el nombre del órgano tal como viene en el encabezado del
 * acuerdo: "JUZGADO SEGUNDO DE DISTRITO EN EL ESTADO DE QUINTANA ROO, CON
 * RESIDENCIA EN CANCÚN", "Juzgado Primero Civil de Primera Instancia del
 * Distrito Judicial de Cancún". Con ese nombre la búsqueda del PJF pedía el
 * "ID de Organismo" y el tipo de asunto, y el expediente del TSJ se quedaba
 * sin estrados. Aquí se fija que:
 *
 *   1. Del nombre sale el órgano del catálogo, y nunca uno equivocado: entre
 *      dos que encajan igual no se adivina.
 *   2. El tipo de asunto sale de lo que dice el acuerdo o, si no dice nada,
 *      es el más común para esa clase de órgano.
 *   3. Lo mismo para los juzgados y salas del TSJ.
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

function crearEntorno() {
    const sandbox = { console: { log: () => {}, warn: () => {}, error: () => {} },
                      document: { getElementById: () => null } };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    // Los dos archivos enteros: no hacen nada al cargarse.
    vm.runInContext(fs.readFileSync(path.join(JS, 'pjf-search.js'), 'utf8'), sandbox, { filename: 'pjf-search.js' });
    vm.runInContext(fs.readFileSync(path.join(JS, 'juzgados.js'), 'utf8'), sandbox, { filename: 'juzgados.js' });

    // El catálogo oficial, montado igual que lo monta cargarCatalogosPJF(),
    // sin los órganos de prueba del portal.
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
    const organos = (CATALOGO.organos || []).filter(o => !/prueba/i.test(o.nombre)).map(o => ({
        id: o.id, nombre: o.nombre, circuito_id: Number(o.circuitoId), circuito: o.circuito || '',
        tipoOrganismoId: o.tipoOrganismoId, tipoOrganismo: o.tipoOrganismo || '',
        ciudad: o.ciudad || '', estado: o.estado || ''
    }));
    vm.runInContext(`pjfOrganismos = ${JSON.stringify(organos)}; pjfTiposOrgano = ${JSON.stringify(porTipo)};`, sandbox);
    return sandbox;
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

const sb = crearEntorno();
// pjf-search.js lo declara con let: no es propiedad del sandbox.
const ORGANOS_PJF = vm.runInContext('pjfOrganismos', sb);
const idDe = (texto) => { const o = sb.resolverOrganismoPJF(texto); return o ? o.id : null; };

// ==================== EL ÓRGANO FEDERAL ====================

function pruebaOrganoComoLoEscribeElAcuerdo() {
    // Juzgados de Distrito de Quintana Roo, como vienen en los acuerdos.
    igual('PJF: el nombre exacto del catálogo', idDe('Juzgado Segundo de Distrito en el Estado de Quintana Roo'), 790);
    igual('PJF: en mayúsculas y con la sede',
        idDe('JUZGADO SEGUNDO DE DISTRITO EN EL ESTADO DE QUINTANA ROO, CON RESIDENCIA EN CANCÚN'), 790);
    igual('PJF: con "con sede en"', idDe('Juzgado Tercero de Distrito en el Estado de Quintana Roo, con sede en Cancún'), 425);
    igual('PJF: con el número abreviado ("2o.")', idDe('Juzgado 2o. de Distrito en el Estado de Quintana Roo'), 790);
    igual('PJF: con palabras de más que el catálogo no lleva',
        idDe('Juzgado Primero de Distrito de Amparo y Juicios Federales en el Estado de Quintana Roo'), 419);
    igual('PJF: el catálogo lleva la sede y el acuerdo no',
        idDe('Juzgado Séptimo de Distrito en el Estado de Quintana Roo'), 1350);
    igual('PJF: por la ciudad', idDe('Juzgado Sexto de Distrito en Chetumal'), 1236);
    igual('PJF: el especializado en juicios orales mercantiles',
        idDe('Juzgado de Distrito Especializado en Juicios Orales Mercantiles en Quintana Roo'), 1239);

    // Tribunales colegiados y demás órganos del circuito.
    igual('PJF: un colegiado con el circuito en ordinales',
        idDe('PRIMER TRIBUNAL COLEGIADO DE CIRCUITO DEL VIGÉSIMO SÉPTIMO CIRCUITO'), 462);
    igual('PJF: con el circuito en números romanos', idDe('Tercer Tribunal Colegiado del XXVII Circuito'), 1319);
    igual('PJF: el Colegiado de Apelación', idDe('Tribunal Colegiado de Apelación del Vigésimo Séptimo Circuito'), 4372);
    igual('PJF: el Centro de Justicia Penal Federal',
        idDe('Centro de Justicia Penal Federal en el Estado de Quintana Roo'), 1516);
    igual('PJF: un tribunal laboral federal',
        idDe('Primer Tribunal Laboral Federal de Asuntos Individuales en el Estado de Quintana Roo'), 4136);

    // Dictado al asistente.
    igual('PJF: dictado, "el primer colegiado del 27"', idDe('primer colegiado del 27'), 462);
    igual('PJF: dictado, "juzgado tercero de distrito de cancún"', idDe('juzgado tercero de distrito de cancun'), 425);

    // Sin estado dicho se queda con el de Quintana Roo, que es para quien es la app.
    igual('PJF: "Juzgado Segundo de Distrito" a secas es el de Quintana Roo', idDe('Juzgado Segundo de Distrito'), 790);
    // Pero si el acuerdo dice otro lugar, manda el acuerdo.
    const merida = sb.resolverOrganismoPJF('Juzgado Segundo de Distrito con residencia en Mérida');
    igual('PJF: si dice otra ciudad, el de esa ciudad', merida && merida.estado, 'Yucatán');
}

function pruebaOrganoNoSeAdivina() {
    // Entre varios que encajan igual, ninguno: abrir otro tribunal es peor.
    igual('PJF: "Tribunal Colegiado del 27" son tres', idDe('Tribunal Colegiado del Vigésimo Séptimo Circuito'), null);
    igual('PJF: "Juzgado de Distrito en Quintana Roo" son nueve', idDe('Juzgado de Distrito en el Estado de Quintana Roo'), null);
    igual('PJF: "tribunal laboral federal de Cancún" son dos', idDe('tribunal laboral federal de cancun'), null);
    igual('PJF: un número que no existe', idDe('Juzgado Décimo de Distrito en Quintana Roo'), null);
    igual('PJF: lo que se guarda sin órgano', idDe('PJF - Por determinar'), null);
    igual('PJF: ni "Por determinar"', idDe('Por determinar'), null);
    igual('PJF: ni vacío', idDe(''), null);
    // Un juzgado del TSJ no es federal aunque se parezca: el "Juzgado Segundo
    // de lo Familiar" no es el Juzgado Segundo de Distrito.
    igual('PJF: un juzgado del TSJ no se confunde con uno federal',
        idDe('Juzgado Segundo de lo Familiar en Quintana Roo'), null);
    igual('PJF: ni el nombre de catálogo del TSJ', idDe('JUZGADO PRIMERO CIVIL CANCUN'), null);
    // El Juzgado Primero de Distrito de Baja California no es el Juzgado
    // Primero de Distrito *en Materia Mercantil* de Baja California.
    const bc = sb.resolverOrganismoPJF('Juzgado Primero de Distrito en el Estado de Baja California, con residencia en Mexicali');
    verificar('PJF: no se queda con uno que tiene una materia que no se escribió',
        bc && !/Mercantil/.test(bc.nombre), bc && bc.nombre);
}

// Todo el catálogo: el nombre de cada órgano, también en mayúsculas y con su
// sede añadida como la añade un acuerdo, lleva a ese órgano y a ningún otro.
function pruebaCatalogoCompleto() {
    const repetidos = {};
    ORGANOS_PJF.forEach(o => {
        const k = sb.normalizarTextoPJF(o.nombre);
        repetidos[k] = (repetidos[k] || 0) + 1;
    });
    const equivocados = [];
    let sinResolver = 0, total = 0;
    for (const o of ORGANOS_PJF) {
        if (repetidos[sb.normalizarTextoPJF(o.nombre)] > 1) continue;   // dos órganos con el mismo nombre
        const conSede = /residencia|sede/i.test(o.nombre) ? o.nombre : `${o.nombre}, con residencia en ${o.ciudad}`;
        for (const v of [o.nombre, o.nombre.toUpperCase(), conSede]) {
            total++;
            const r = sb.resolverOrganismoPJF(v);
            if (!r) sinResolver++;
            else if (r.id !== o.id) equivocados.push(`"${v}" → ${r.nombre}`);
        }
    }
    verificar('catálogo PJF: hay órganos que probar', total > 3000, String(total));
    igual('catálogo PJF: ningún nombre lleva a otro órgano', equivocados.slice(0, 5), []);
    igual('catálogo PJF: y todos se reconocen', sinResolver, 0);
}

// ==================== EL TIPO DE ASUNTO ====================

function pruebaTipoAsunto() {
    const tipo = (idOrgano, pistas) => {
        const t = sb.deducirTipoAsuntoPJF(sb.organismoPJFPorId(idOrgano), pistas);
        return t ? t.nombre : null;
    };

    // Lo que dice el acuerdo.
    igual('tipo: "Juicio de Amparo Indirecto" en un juzgado de distrito', tipo(790, ['Juicio de Amparo Indirecto']), 'Amparo Indirecto');
    igual('tipo: "Causa Penal"', tipo(790, ['Causa Penal']), 'Causa Penal');
    igual('tipo: "Juicio Oral Mercantil"', tipo(790, ['Juicio Oral Mercantil']), 'Juicio Oral Mercantil');
    igual('tipo: "Amparo en revisión" en un colegiado', tipo(462, ['Amparo en revisión']), 'Amparo en revisión');
    igual('tipo: "Recurso de queja"', tipo(462, ['Recurso de queja']), 'Queja');
    igual('tipo: "Revisión fiscal"', tipo(462, ['Revisión fiscal']), 'Revisión Fiscal');
    igual('tipo: una apelación penal en el de apelación', tipo(4372, ['Apelación penal']),
        'Procedimientos federales penales en segunda instancia.');
    igual('tipo: un procedimiento laboral', tipo(4136, ['Procedimiento especial individual']), 'Procedimiento especial individual');

    // Las abreviaturas del número de expediente.
    igual('tipo: "A.D. 486/2026" es amparo directo', tipo(462, [null, 'A.D. 486/2026']), 'Amparo Directo');
    igual('tipo: "A.R. 33/2025" es amparo en revisión', tipo(462, [null, 'A.R. 33/2025']), 'Amparo en revisión');
    igual('tipo: "Q.C. 12/2026" es queja', tipo(462, [null, 'Q.C. 12/2026']), 'Queja');
    igual('tipo: "J.A. 123/2025" en un juzgado es amparo indirecto', tipo(790, [null, 'J.A. 123/2025']), 'Amparo Indirecto');

    // El mismo asunto cambia de id según la clase de órgano.
    igual('tipo: el amparo indirecto en el de apelación es el suyo', tipo(4372, ['Amparo indirecto']), 'Amparo indirecto.');
    igual('tipo: y ante un colegiado llega en revisión', tipo(462, ['amparo indirecto']), 'Amparo en revisión');

    // Sin nada que lo diga, lo más común en cada clase de órgano.
    igual('tipo: juzgado de distrito sin pistas → Amparo Indirecto', tipo(790, []), 'Amparo Indirecto');
    igual('tipo: colegiado sin pistas → Amparo Directo', tipo(462, []), 'Amparo Directo');
    igual('tipo: centro de justicia penal → Proceso Penal Acusatorio', tipo(1516, []), 'Proceso Penal Acusatorio');
    igual('tipo: tribunal laboral → Procedimiento ordinario', tipo(4136, []), 'Procedimiento ordinario');
    igual('tipo: el nombre del órgano también cuenta (juicios orales mercantiles)', tipo(1239, []), 'Juicio Oral Mercantil');
    igual('tipo: lo que no aplica a ese órgano no se elige', tipo(790, ['Recurso de queja']), 'Amparo Indirecto');

    // Ningún órgano con tipos se queda sin uno que se pueda consultar.
    const sinTipo = ORGANOS_PJF.filter(o => {
        const tipos = sb.tiposAsuntoDeOrgano(o).filter(t => !sb.PJF_TIPO_NO_CONSULTABLE.test(t.nombre));
        return tipos.length && !sb.deducirTipoAsuntoPJF(o, []);
    });
    igual('tipo: todo órgano con tipos consultables recibe uno', sinTipo.map(o => o.nombre), []);
}

// ==================== LO QUE SE GUARDA EN EL EXPEDIENTE ====================

function pruebaCompletarDatos() {
    igual('completar: un expediente de la IA recibe órgano, tipo y nombre oficial',
        sb.completarDatosPJF({ institucion: 'PJF', numero: '321/2026',
            juzgado: 'JUZGADO SEGUNDO DE DISTRITO EN EL ESTADO DE QUINTANA ROO, CON RESIDENCIA EN CANCÚN' },
        { pistas: ['Amparo Indirecto'], renombrar: true }),
        { pjfOrgId: '790', juzgado: 'Juzgado Segundo de Distrito en el Estado de Quintana Roo', pjfTipoAsunto: '1' });
    igual('completar: al buscar uno guardado no se le cambia el nombre',
        sb.completarDatosPJF({ institucion: 'PJF', numero: '486/2026',
            juzgado: 'Primer Tribunal Colegiado del Vigésimo Séptimo Circuito, con residencia en Cancún' }),
        { pjfOrgId: '462', pjfTipoAsunto: '10' });
    igual('completar: si ya tiene el órgano, solo falta el tipo',
        sb.completarDatosPJF({ institucion: 'PJF', numero: '5/2026', juzgado: 'X', pjfOrgId: '462' }),
        { pjfTipoAsunto: '10' });
    igual('completar: lo que ya tiene no se toca',
        sb.completarDatosPJF({ institucion: 'PJF', numero: '5/2026', juzgado: 'X', pjfOrgId: '462', pjfTipoAsunto: '15' }), {});
    igual('completar: sin órgano reconocible no se inventa nada',
        sb.completarDatosPJF({ institucion: 'PJF', numero: '1/2026', juzgado: 'PJF - Por determinar' }), {});
    igual('completar: un id que el catálogo no conoce se respeta',
        sb.completarDatosPJF({ institucion: 'PJF', numero: '1/2026', juzgado: 'X', pjfOrgId: '987654' }), {});
    igual('completar: a uno del TSJ no se le ponen datos federales',
        sb.completarDatosPJF({ institucion: 'TSJ', numero: '1/2026', juzgado: 'Juzgado Segundo de Distrito' }), {});
    igual('completar: el tipo también sale del comentario del usuario',
        sb.completarDatosPJF({ institucion: 'PJF', numero: '15/2025', comentario: 'Amparo en revisión contra la sentencia',
            juzgado: 'Tercer Tribunal Colegiado del Vigésimo Séptimo Circuito' }),
        { pjfOrgId: '1319', pjfTipoAsunto: '11' });
}

// ==================== LOS JUZGADOS DEL TSJ ====================

function pruebaJuzgadoTSJ() {
    const r = (t) => sb.reconocerJuzgadoTSJ(t);
    igual('TSJ: el nombre largo de un acuerdo',
        r('Juzgado Primero Civil de Primera Instancia del Distrito Judicial de Cancún'), 'JUZGADO PRIMERO CIVIL CANCUN');
    igual('TSJ: en mayúsculas y con el estado',
        r('JUZGADO PRIMERO CIVIL DE PRIMERA INSTANCIA DEL DISTRITO JUDICIAL DE CANCÚN, QUINTANA ROO'),
        'JUZGADO PRIMERO CIVIL CANCUN');
    igual('TSJ: con "en Materia Civil"',
        r('Juzgado Primero de Primera Instancia en Materia Civil del Distrito Judicial de Cancún'), 'JUZGADO PRIMERO CIVIL CANCUN');
    igual('TSJ: el oral se distingue del tradicional',
        r('Juzgado Primero Familiar Oral de Primera Instancia del Distrito Judicial de Cancún'), 'JUZGADO PRIMERO FAMILIAR ORAL CANCUN');
    igual('TSJ: "de lo Familiar"',
        r('Juzgado Segundo de lo Familiar de Primera Instancia del Distrito Judicial de Cancún'), 'JUZGADO SEGUNDO DE LO FAMILIAR CANCUN');
    igual('TSJ: "de Oralidad Mercantil"', r('Juzgado de Oralidad Mercantil de Cancún'), 'JUZGADO ORAL MERCANTIL CANCUN');
    igual('TSJ: por el municipio, Solidaridad es Playa del Carmen',
        r('Juzgado Primero Civil de Primera Instancia del Distrito Judicial de Solidaridad'), 'JUZGADO PRIMERO CIVIL PLAYA');
    igual('TSJ: Othón P. Blanco es Chetumal',
        r('Juzgado Civil de Primera Instancia del Distrito Judicial de Othón P. Blanco'), 'JUZGADO CIVIL CHETUMAL');
    igual('TSJ: Benito Juárez es Cancún',
        r('Juzgado Segundo Familiar Oral de Primera Instancia del Distrito Judicial de Benito Juárez'),
        'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN');
    igual('TSJ: "Primera Instancia" no es el número del juzgado',
        r('Juzgado Familiar de Primera Instancia del Distrito Judicial de Cancún'), 'JUZGADO FAMILIAR DE PRIMERA INSTANCIA CANCUN');
    igual('TSJ: una sala con todo su nombre',
        r('Primera Sala Civil, Mercantil y Familiar del Tribunal Superior de Justicia del Estado de Quintana Roo'),
        'PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR');
    igual('TSJ: la Décima, que es de Playa',
        r('Décima Sala Civil, Mercantil y Familiar con sede en Playa del Carmen'), 'DECIMA SALA CIVIL MERCANTIL Y FAMILIAR PLAYA');
    igual('TSJ: un tribunal laboral', r('Tribunal Laboral del Distrito Judicial de Playa del Carmen'), 'TRIBUNAL LABORAL PLAYA');

    // Lo que no se puede saber no se adivina.
    igual('TSJ: "Juzgado Civil de Cancún" son cinco', r('Juzgado Civil de Cancún'), null);
    igual('TSJ: "Juzgado Mercantil de Cancún" son cuatro', r('Juzgado Mercantil de Cancún'), null);
    igual('TSJ: un número que no hay en esa ciudad', r('Juzgado Tercero Civil de Chetumal'), null);
    igual('TSJ: oral o tradicional, si no lo dice y hay los dos',
        r('Juzgado Primero Familiar de Primera Instancia de Cancún'), null);
    igual('TSJ: sin materia', r('Tribunal Superior de Justicia del Estado de Quintana Roo'), null);
    igual('TSJ: un juzgado federal no es del TSJ', r('Juzgado Primero de Distrito en el Estado de Quintana Roo'), null);
    igual('TSJ: ni un juzgado penal que no está en el catálogo',
        r('Juzgado de Control del Sistema Penal Acusatorio de Cancún'), null);
    igual('TSJ: ni otra autoridad', r('Fiscalía Especializada Cancún'), null);
}

// Todo el catálogo del TSJ, con su nombre largo como lo escribe un acuerdo
// (y por el municipio): cada uno lleva a sí mismo y a ningún otro.
function pruebaCatalogoTSJCompleto() {
    const ORD = { 1: ['Primero', 'Primera'], 2: ['Segundo', 'Segunda'], 3: ['Tercero', 'Tercera'], 4: ['Cuarto', 'Cuarta'],
                  5: ['Quinto', 'Quinta'], 6: ['Sexto', 'Sexta'], 7: ['Séptimo', 'Séptima'], 8: ['Octavo', 'Octava'],
                  9: ['Noveno', 'Novena'], 10: ['Décimo', 'Décima'] };
    const CIUDAD = { cancun: ['Cancún', 'Benito Juárez'], playa: ['Playa del Carmen', 'Solidaridad'],
                     chetumal: ['Chetumal', 'Othón P. Blanco'], cozumel: ['Cozumel'],
                     'carrillo puerto': ['Felipe Carrillo Puerto'], 'isla mujeres': ['Isla Mujeres'],
                     tulum: ['Tulum'], bacalar: ['Bacalar'] };
    const cap = (t) => t[0].toUpperCase() + t.slice(1);
    const nombres = vm.runInContext('Object.keys(JUZGADOS).concat(Object.keys(SALAS_SEGUNDA_INSTANCIA))', sb);

    const equivocados = [];
    let sinResolver = 0, total = 0;
    for (const nombre of nombres) {
        const x = sb.rasgosJuzgadoTSJ(nombre);
        const variantes = [];
        if (x.sala) {
            variantes.push(`${x.ordinal ? ORD[x.ordinal][1] + ' ' : ''}Sala ${x.materias.map(cap).join(', ')}` +
                `${x.oral ? ' Oral' : ''}${x.tradicional ? ' Tradicional' : ''} del Tribunal Superior de Justicia` +
                `${x.ciudad ? ', con sede en ' + CIUDAD[x.ciudad][0] : ''}`);
        } else {
            const clase = /^TRIBUNAL/.test(nombre) ? 'Tribunal' : 'Juzgado';
            const deLo = /DE LO FAMILIAR/.test(nombre) ? 'de lo ' : '';
            for (const ciudad of CIUDAD[x.ciudad]) {
                variantes.push(`${clase} ${x.ordinal ? ORD[x.ordinal][0] + ' ' : ''}${deLo}${x.materias.map(cap).join(' ')}` +
                    `${x.oral ? ' Oral' : ''} de Primera Instancia del Distrito Judicial de ${ciudad}, Quintana Roo`);
            }
        }
        for (const v of variantes) {
            total++;
            const r = sb.reconocerJuzgadoTSJ(v);
            if (!r) sinResolver++;
            else if (r !== nombre) equivocados.push(`"${v}" → ${r}`);
        }
    }
    verificar('catálogo TSJ: hay juzgados que probar', total > 60, String(total));
    igual('catálogo TSJ: ningún nombre largo lleva a otro juzgado', equivocados.slice(0, 5), []);
    igual('catálogo TSJ: y todos se reconocen', sinResolver, 0);
}

const pruebas = [
    ['el órgano como lo escribe el acuerdo', pruebaOrganoComoLoEscribeElAcuerdo],
    ['el órgano no se adivina', pruebaOrganoNoSeAdivina],
    ['todo el catálogo del PJF', pruebaCatalogoCompleto],
    ['el tipo de asunto', pruebaTipoAsunto],
    ['lo que se guarda en el expediente', pruebaCompletarDatos],
    ['los juzgados del TSJ', pruebaJuzgadoTSJ],
    ['todo el catálogo del TSJ', pruebaCatalogoTSJCompleto]
];
for (const [nombre, fn] of pruebas) {
    try { fn(); }
    catch (e) { fallidas++; fallos.push(`${nombre}: lanzó ${e && e.stack ? e.stack : e}`); }
}

console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
if (fallos.length) {
    console.log('  Fallos:');
    fallos.forEach(f => console.log('   ✗ ' + f));
    console.log('');
    process.exit(1);
}
console.log('  ✓ Del nombre que escribe el acuerdo sale el tribunal, y nunca uno equivocado.\n');
