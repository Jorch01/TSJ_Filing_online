#!/usr/bin/env node
/**
 * Pruebas de las causas penales del TSJ de Quintana Roo.
 *
 *   node test_estrados_penales.js
 *
 * Los juzgados penales de primera instancia no publican acuerdos en los
 * estrados electrónicos. De una causa es público:
 *   - sus tocas en las salas penales, que se buscan por el número de la causa
 *     (la columna "Expediente" del buscador de segunda instancia), y
 *   - la agenda de audiencias del juzgado, con su propia numeración.
 *
 * Se cargan docs/js/juzgados.js y docs/js/estrados-penales.js de verdad.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, 'docs', 'js');

function cargar() {
    const sb = { console };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(JS, 'juzgados.js'), 'utf8') +
        '\n;this.JUZGADOS = JUZGADOS; this.JUZGADOS_PENALES = JUZGADOS_PENALES; this.SALAS_PENALES = SALAS_PENALES;' +
        ' this.SALAS_SEGUNDA_INSTANCIA = SALAS_SEGUNDA_INSTANCIA; this.CATEGORIAS_JUZGADOS = CATEGORIAS_JUZGADOS;',
        sb, { filename: 'juzgados.js' });
    vm.runInContext(fs.readFileSync(path.join(JS, 'estrados-penales.js'), 'utf8'), sb, { filename: 'estrados-penales.js' });
    return sb;
}

let pasadas = 0;
const fallos = [];
function verificar(d, c, det) { if (c) { pasadas++; return; } fallos.push(d + (det ? `\n      ${det}` : '')); }
function igual(d, real, esperado) {
    verificar(d, JSON.stringify(real) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}
const param = (url, nombre) => new URL(url).searchParams.get(nombre);

const sb = cargar();
const P = sb.ESTRADOS_PENALES;

// ---- El catálogo ----
const penales = Object.keys(sb.JUZGADOS_PENALES);
igual('catálogo: los juzgados penales de los 9 distritos, más adolescentes y ejecución en Chetumal', penales.length, 21);
verificar('catálogo: ninguno se confunde con un juzgado con estrados',
    penales.every(n => !(n in sb.JUZGADOS) && !(n in sb.SALAS_SEGUNDA_INSTANCIA)));
igual('catálogo: cada uno con su número de agenda, sin repetirse',
    new Set(penales.map(n => sb.JUZGADOS_PENALES[n].agenda)).size, penales.length);
const cat = sb.CATEGORIAS_JUZGADOS.find(c => c.sinEstrados);
verificar('catálogo: están en su propia categoría, marcada sin estrados', !!cat && penales.every(n => cat.juzgados.includes(n)));
igual('catálogo: un expediente penal toma esa categoría', sb.obtenerCategoriaJuzgado('JUZGADO PENAL ORAL CANCUN'), cat && cat.nombre);
igual('catálogo: no tienen estrados que construir', sb.construirUrlBusqueda('JUZGADO PENAL ORAL CANCUN', 'numero', '339/2023'), null);
verificar('catálogo: se reconocen como penales', sb.esJuzgadoPenalTSJ('TRIBUNAL DE JUICIO ORAL CHETUMAL') && !sb.esJuzgadoPenalTSJ('JUZGADO PRIMERO CIVIL CANCUN'));
igual('catálogo: lo que se teclea se resuelve al nombre del catálogo',
    [sb.resolverJuzgadoTSJ('Juzgado Penal Oral de Cancún'), sb.resolverJuzgadoTSJ('tribunal de juicio oral tulum')],
    ['JUZGADO PENAL ORAL CANCUN', 'TRIBUNAL DE JUICIO ORAL TULUM']);
verificar('catálogo: entra en la lista completa del TSJ', sb.nombresCatalogoTSJ().includes('JUZGADO PENAL ORAL KANTUNILKIN'));
verificar('catálogo: las salas penales existen en el catálogo de salas', sb.SALAS_PENALES.every(s => s in sb.SALAS_SEGUNDA_INSTANCIA));

// ---- El número de la causa ----
igual('causa: número/año tal cual', P.causaDe('339/2023'), '339/2023');
igual('causa: sin prefijos (C.A., CP, causa penal)', [P.causaDe('C.A. 339/2023'), P.causaDe('CP-12/2025'), P.causaDe('Causa penal 7 / 2026')], ['339/2023', '12/2025', '7/2026']);
igual('causa: sin ceros a la izquierda', P.causaDe('0045/2024'), '45/2024');
igual('causa: si no hay número/año, el texto tal cual', P.causaDe('  Juan Pérez '), 'Juan Pérez');

// ---- Las salas ----
const todas = P.busquedasEnSalas('C.A. 339/2023');
const actuales = todas.filter(b => !b.anterior);
const anteriores = todas.filter(b => b.anterior);
igual('salas: las cinco penales que publican hoy', actuales.map(b => param(b.url, 'int')).sort(), ['171', '173', '177', '178', '179']);
verificar('salas: en su buscador de segunda instancia, por número, con la causa limpia',
    actuales.every(b => /\/estrados\/buscador_segunda\.php\?/.test(b.url) && param(b.url, 'findexp') === '339/2023' && param(b.url, 'metodo') === '1'),
    JSON.stringify(actuales));
igual('salas: y las anteriores, aparte', anteriores.map(b => param(b.url, 'int')), ['142', '135', '116', '102']);
verificar('salas: las anteriores sin areaId (no lo necesitan)', anteriores.every(b => param(b.url, 'areaId') === null));
igual('salas: soloActuales deja fuera las anteriores', P.busquedasEnSalas('339/2023', 'numero', { soloActuales: true }).length, 5);
const porNombre = P.busquedasEnSalas('Juan Pérez', 'nombre');
verificar('salas: por nombre de la parte, con metodo=2 y el nombre tal cual',
    porNombre.length === 9 && porNombre.every(b => param(b.url, 'metodo') === '2' && param(b.url, 'findexp') === 'Juan Pérez'), JSON.stringify(porNombre));
igual('salas: sin nada que buscar, nada', P.busquedasEnSalas('   '), []);

// ---- La agenda de audiencias ----
const agenda = P.urlAgenda('JUZGADO PENAL ORAL CANCUN', '2026-11-24');
igual('agenda: con su numeración, primera instancia y la fecha',
    [new URL(agenda).origin + new URL(agenda).pathname, param(agenda, 'juzgado'), param(agenda, 'area_id'), param(agenda, 'fecha')],
    ['https://www.tsjqroo.gob.mx/audiencias/index.php', '154', '1', '2026-11-24']);
igual('agenda: sin fecha válida, sin fecha', param(P.urlAgenda('TRIBUNAL DE JUICIO ORAL PLAYA', 'mañana'), 'fecha'), null);
igual('agenda: el de juicio oral de Playa no es el de Tulum (otra numeración)',
    [param(P.urlAgenda('TRIBUNAL DE JUICIO ORAL PLAYA'), 'juzgado'), param(P.urlAgenda('JUZGADO PENAL ORAL TULUM'), 'juzgado')], ['146', '166']);
igual('agenda: un juzgado que no es penal no tiene', P.urlAgenda('JUZGADO PRIMERO CIVIL CANCUN'), null);

// ---- Los estrados propios (solo Tulum) ----
const tulum = P.urlEstradosJuzgado('JUZGADO PENAL ORAL TULUM', 'numero', 'C.A. 1/2025');
igual('estrados: Tulum sí está en los estrados, con su propio id',
    [param(tulum, 'int'), param(tulum, 'findexp'), /buscador_primera\.php/.test(tulum)], ['146', '1/2025', true]);
igual('estrados: los demás penales no', P.urlEstradosJuzgado('JUZGADO PENAL ORAL CANCUN', 'numero', '1/2025'), null);

// ---- El juzgado penal de un expediente ----
igual('expediente: guardado con el nombre del catálogo', P.juzgadoPenalDeExpediente({ institucion: 'TSJ', juzgado: 'JUZGADO PENAL ORAL CHETUMAL' }), 'JUZGADO PENAL ORAL CHETUMAL');
igual('expediente: sin institución es del TSJ', P.juzgadoPenalDeExpediente({ juzgado: 'TRIBUNAL DE JUICIO ORAL COZUMEL' }), 'TRIBUNAL DE JUICIO ORAL COZUMEL');
igual('expediente: con el nombre largo de un acuerdo',
    P.juzgadoPenalDeExpediente({ institucion: 'TSJ', juzgado: 'Juzgado de Control del Distrito Judicial de Tulum' }), 'JUZGADO PENAL ORAL TULUM');
igual('expediente: uno civil no es penal', P.juzgadoPenalDeExpediente({ institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' }), null);
igual('expediente: uno federal tampoco, aunque diga penal',
    P.juzgadoPenalDeExpediente({ institucion: 'PJF', juzgado: 'Centro de Justicia Penal Federal en el Estado de Quintana Roo' }), null);
igual('expediente: sin juzgado, nada', P.juzgadoPenalDeExpediente({ institucion: 'TSJ' }), null);

console.log(`\n  ${pasadas} pasadas, ${fallos.length} fallidas\n`);
if (fallos.length) {
    fallos.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
}
console.log('  ✓ De una causa penal se abren sus tocas en las salas y la agenda del juzgado\n');
