#!/usr/bin/env node
/**
 * La calculadora pública de plazos de una marca (docs/js/plazos-marca.js),
 * con el motor de la cartera (docs/js/cartera-marcas.js):
 *
 *   node test_plazos_marca.js
 *
 * Reglas (texto vigente de la LFPPI, DOF 03-04-2026, y la LPI abrogada):
 *   - declaración de uso: tres meses desde el tercer aniversario del
 *     otorgamiento, para registros otorgados desde el 10/08/2018 (art. 233,
 *     transitorio décimo primero);
 *   - vigencia: diez años desde el otorgamiento (art. 178), o desde la
 *     presentación si la solicitud es anterior al 05/11/2020 (LPI art. 95);
 *   - renovación: seis meses antes del vencimiento y seis de gracia después
 *     (arts. 237 y 238).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);

// La página sin navegador: el motor de la cartera y la calculadora en un contexto aislado.
const ctx = { console, Date, JSON, Math, String, Number, Array, Object, RegExp, encodeURIComponent };
ctx.window = ctx;
ctx.document = { getElementById: () => null };
vm.createContext(ctx);
const leer = f => fs.readFileSync(path.join(__dirname, 'docs', 'js', f), 'utf8');
// Sin document.body, el motor de la cartera se queda solo con su parte pura.
vm.runInContext(leer('cartera-marcas.js').replace("if (typeof document === 'undefined') return;", 'return;'), ctx);
vm.runInContext(leer('plazos-marca.js'), ctx);
const calc = (e) => ctx.calcularPlazosMarca(e);
const resumen = r => r.plazos.map(p => [p.tipo, p.desde, p.hasta, p.estado, p.estimado]);

console.log('\nUn registro otorgado con la LFPPI');
{
    const r = calc({ concesion: '2023-03-15', hoy: '2026-04-01' });
    igual('declaración de uso en curso; renovación y gracia, estimadas desde el otorgamiento', resumen(r), [
        ['uso', '2026-03-15', '2026-06-15', 'en_curso', false],
        ['renovacion', '2032-09-15', '2033-03-15', 'futuro', true],
        ['gracia', '2033-03-16', '2033-09-15', 'futuro', true]]);
    verificar('avisa que la vigencia es estimada y por qué', r.notas.some(n => /diez años desde el otorgamiento \(LFPPI, art\. 178\)/.test(n.texto) && /antes del 5 de noviembre de 2020/.test(n.texto)));
    igual('con la presentación (posterior al 05/11/2020) ya no hay duda', calc({ concesion: '2023-03-15', presentacion: '2022-08-01', hoy: '2026-04-01' }).notas
        .some(n => /si la solicitud se presentó antes/.test(n.texto)), false);
}

console.log('\nUno anterior al 10 de agosto de 2018');
{
    const r = calc({ concesion: '2016-05-10', presentacion: '2015-11-02', hoy: '2026-01-10' });
    igual('sin declaración de uso; la vigencia corre desde la presentación y ya está en gracia', resumen(r), [
        ['gracia', '2025-11-03', '2026-05-02', 'en_curso', true]]);
    verificar('explica por qué no declara el uso a los tres años', r.notas.some(n => n.tipo === 'no_aplica' && /10 de agosto de 2018/.test(n.texto) && /transitorio décimo primero/.test(n.texto)));
    verificar('y de dónde sale la vigencia', r.notas.some(n => /desde la presentación de la solicitud/.test(n.texto)));
}

console.log('\nUno de 2019 (la reforma de 2018 ya pedía la declaración)');
{
    const r = calc({ concesion: '2019-06-01', presentacion: '2018-11-05', vigencia: '2028-11-05', hoy: '2026-01-10' });
    igual('su declaración de uso fue en 2022; la renovación, con la vigencia escrita', resumen(r), [
        ['uso', '2022-06-01', '2022-09-01', 'vencido', false],
        ['renovacion', '2028-05-05', '2028-11-05', 'futuro', false],
        ['gracia', '2028-11-06', '2029-05-05', 'futuro', false]]);
    verificar('dice que usó la vigencia escrita', r.notas.some(n => /fin de vigencia que escribiste/.test(n.texto)));
    const g = calc({ concesion: '2018-08-10', vigencia: '2028-01-01', hoy: '2026-01-10' });
    igual('el 10/08/2018 ya cuenta', g.plazos[0].tipo, 'uso');
    igual('el 09/08/2018, no', calc({ concesion: '2018-08-09', vigencia: '2028-01-01', hoy: '2026-01-10' }).plazos.map(p => p.tipo), ['renovacion', 'gracia']);
}

console.log('\nLo que falta');
{
    igual('sin fechas, nada', calc({}), null);
    const soloPresentacion = calc({ presentacion: '2015-01-10', hoy: '2026-01-10' });
    verificar('sin otorgamiento, pide la fecha para la declaración', soloPresentacion.notas.some(n => n.tipo === 'falta' && /otorgó el registro/.test(n.texto)));
    const viejaSinVigencia = calc({ concesion: '2010-01-01', hoy: '2026-01-10' });
    verificar('sin vigencia ni presentación de una marca vieja, pide los datos para la renovación', viejaSinVigencia.plazos.length === 0 &&
        viejaSinVigencia.notas.some(n => /hace falta el fin de la vigencia/.test(n.texto)));
}

console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
if (fallos.length) {
    console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
}
