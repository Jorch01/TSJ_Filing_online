#!/usr/bin/env node
/**
 * Pruebas de los estrados laborales (docs/js/estrados-laborales.js).
 *
 *   node test_estrados_laborales.js
 *
 * El sitio de la Secretaría del Trabajo solo consulta por unidad y por
 * periodos de menos de 15 días sin fines de semana en los extremos. Lo que se
 * fija aquí:
 *   - los periodos que se arman desde una fecha de inicio (hacia adelante) o
 *     de final (hacia atrás) cumplen esas reglas, van seguidos y no pasan de
 *     hoy ni del 1-ene-2024;
 *   - la búsqueda reconoce un expediente escrito de cualquier forma
 *     (021/2026 = DIT-21/2026) o por nombre;
 *   - se reconoce qué expedientes son del TCA o de una Junta;
 *   - el marcador lleva su configuración y es código válido.
 */

const fs = require('fs');
const path = require('path');
const E = require('./docs/js/estrados-laborales.js');
const N = E.nucleo();

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

console.log('\nPeriodos de 15 días');
{
    const hoy = '2026-10-26'; // lunes
    igual('uno, terminando hoy', N.periodos(hoy, 'fin', 1, hoy, E.MINIMO), [['2026-10-12', '2026-10-26']]);
    igual('tres hacia atrás desde hoy, en orden y sin huecos', N.periodos(hoy, 'fin', 3, hoy, E.MINIMO),
        [['2026-09-10', '2026-09-24'], ['2026-09-25', '2026-10-09'], ['2026-10-12', '2026-10-26']]);
    igual('tres hacia adelante desde el 1-sep', N.periodos('2026-09-01', 'inicio', 3, hoy, E.MINIMO),
        [['2026-09-01', '2026-09-15'], ['2026-09-16', '2026-09-30'], ['2026-10-01', '2026-10-15']]);
    igual('hacia adelante no pasa de hoy', N.periodos('2026-10-01', 'inicio', 5, hoy, E.MINIMO),
        [['2026-10-01', '2026-10-15'], ['2026-10-16', '2026-10-26']]);
    igual('hacia atrás no pasa del 1-ene-2024', N.periodos('2024-01-20', 'fin', 4, hoy, E.MINIMO),
        [['2024-01-01', '2024-01-04'], ['2024-01-05', '2024-01-19']]);
    igual('una fecha final en sábado termina el viernes', N.periodos('2026-10-24', 'fin', 1, hoy, E.MINIMO), [['2026-10-09', '2026-10-23']]);
    igual('una fecha de inicio en domingo empieza el lunes', N.periodos('2026-10-04', 'inicio', 1, hoy, E.MINIMO)[0][0], '2026-10-05');
    igual('una fecha futura se toma como hoy', N.periodos('2027-01-10', 'fin', 1, hoy, E.MINIMO), [['2026-10-12', '2026-10-26']]);

    // Muchas combinaciones: siempre cumplen las reglas del sitio.
    let mal = 0, detalle = '';
    for (let k = 0; k < 400; k++) {
        const base = N.sumar('2024-01-01', (k * 37) % 1030);
        const tipo = k % 2 ? 'inicio' : 'fin';
        const n = 1 + (k % 26);
        const ps = N.periodos(base, tipo, n, hoy, E.MINIMO);
        ps.forEach(([a, b], i) => {
            const mala = dias(a, b) >= 15 || dias(a, b) < 0 || N.finDeSemana(a) || N.finDeSemana(b) || a < E.MINIMO || b > hoy ||
                (i > 0 && dias(ps[i - 1][1], a) > 3) || (i > 0 && a <= ps[i - 1][1]);
            if (mala) { mal++; detalle = JSON.stringify([base, tipo, n, ps]); }
        });
        if (ps.length > n) { mal++; detalle = 'más periodos de los pedidos'; }
    }
    igual('400 combinaciones: menos de 15 días, sin fines de semana, seguidos y dentro de lo que publica el sitio', mal, 0);
    if (mal) console.log('      ' + detalle);
}

console.log('\nBuscar los expedientes en lo publicado');
{
    const fila = { NUM_EXP: 'DIT-21/2026', ACTOR: 'JUAN PÉREZ RUIZ', DEMANDADO: 'FISCALÍA GENERAL DEL ESTADO' };
    verificar('"021/2026" encuentra DIT-21/2026', N.coincide(fila, ['021/2026']));
    verificar('"DIT-021/2026" también', N.coincide(fila, ['DIT-021/2026']));
    verificar('otro número no', !N.coincide(fila, ['21/2025']));
    verificar('por el actor, sin acentos ni mayúsculas', N.coincide(fila, ['perez ruiz']));
    verificar('por el demandado', N.coincide(fila, ['fiscalia']));
    verificar('basta con uno de varios', N.coincide(fila, ['99/2026', 'Pérez']));
    verificar('sin términos, todo', N.coincide(fila, []));
    igual('los términos se separan por coma o punto y coma', N.terminos('021/2026, Pérez; 3/2025'), ['021/2026', 'Pérez', '3/2025']);
}

console.log('\nExpedientes laborales en la app');
{
    const u = (exp) => (E.unidadDeExpediente(exp) || {}).clave || null;
    igual('Tribunal de Conciliación y Arbitraje → TCA', u({ institucion: 'OTRO', juzgado: 'Tribunal de Conciliación y Arbitraje del Estado de Quintana Roo', numero: '021/2026' }), 'TCA');
    igual('el prefijo DIT- también es del TCA', u({ institucion: 'OTRO', numero: 'DIT-21/2026' }), 'TCA');
    igual('Junta Local', u({ juzgado: 'Junta Local de Conciliación y Arbitraje', numero: '100/2025' }), 'JLCA');
    igual('Junta Especial de Cozumel', u({ juzgado: 'Junta Especial de Conciliación y Arbitraje Cozumel' }), 'JECA Cozumel');
    igual('Junta Especial de Playa del Carmen', u({ juzgado: 'JECA Playa del Carmen' }), 'JECA Playa');
    igual('Junta Especial 2 de Benito Juárez', u({ juzgado: 'Junta Especial 2 Benito Juárez' }), 'JECA 2 BJ');
    igual('un juzgado civil no', u({ institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', numero: '174/2026' }), null);
    igual('un expediente federal no', u({ institucion: 'PJF', juzgado: 'Tribunal Colegiado en Materia de Trabajo' }), null);
}

console.log('\nEl marcador');
{
    const m = E.generarMarcador({ unidad: '20', terminos: ['021/2026', 'Pérez & "Hijos" 100%'], fecha: '2026-10-26', tipo: 'fin', cuantos: 3 });
    verificar('es un javascript:', m.startsWith('javascript:'));
    const codigo = decodeURIComponent(m.slice(11));
    let compila = true;
    try { new Function(codigo); } catch (e) { compila = false; }
    verificar('es código válido', compila);
    verificar('lleva la unidad, lo que se busca y los periodos', /"unidad":"20"/.test(codigo) && codigo.includes('021/2026') && /"tipo":"fin"/.test(codigo) && /"cuantos":3/.test(codigo));
    verificar('aguanta comillas, & y % en lo que se busca', codigo.includes('Pérez & \\"Hijos\\" 100%'));
    verificar('cabe en un marcador (menos de 20 KB)', m.length < 20000, m.length);
    verificar('no lleva espacios ni saltos de línea sin codificar', !/[ \n#"<>]/.test(m.slice(11)));
    verificar('cuantos fuera de rango se acota', /"cuantos":52/.test(decodeURIComponent(E.generarMarcador({ cuantos: 500 }).slice(11))));
}

console.log('\nEn la app');
{
    const html = fs.readFileSync(path.join(__dirname, 'docs', 'index.html'), 'utf8');
    verificar('el script se carga', html.includes('<script src="js/estrados-laborales.js"></script>'));
    verificar('Tribunales tiene la opción laboral', (html.match(/ESTRADOS_LABORALES\.abrir\(\)/g) || []).length === 2);
    verificar('funciona sin internet', /'js\/estrados-laborales\.js'/.test(fs.readFileSync(path.join(__dirname, 'docs', 'sw.js'), 'utf8')));
    const fuente = fs.readFileSync(path.join(__dirname, 'docs', 'js', 'estrados-laborales.js'), 'utf8');
    verificar('la ventana explica el límite de 15 días', /periodo de 15 días como máximo/.test(fuente) && /periodos de 15 días<\/strong> como máximo/.test(fuente));
}

console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
if (fallos.length) {
    console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
}
