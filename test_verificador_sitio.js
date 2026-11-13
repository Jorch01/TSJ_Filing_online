#!/usr/bin/env node
/**
 * Pruebas del módulo del verificador de marca para el sitio del despacho
 * (herramientas/generar-verificador-sitio.js).
 *
 *   node test_verificador_sitio.js
 *
 * Lo que se fija aquí:
 *   - el módulo se genera de docs/js/impi-viabilidad.js sin tocarlo, sin
 *     depender de la interfaz ni de la app (base de datos, sync, cuentas);
 *   - si alguien mete algo de la interfaz en las regiones que se extraen, el
 *     generador falla con un mensaje claro en vez de producir un módulo roto;
 *   - el módulo expone el mismo motor que la app y corre un estudio completo
 *     (las tres fuentes y las fichas) en Node puro, sin navegador;
 *   - un estudio con respuestas del IMPI da el semáforo esperado, y si el IMPI
 *     no responde dice "no concluyente" en vez de inventar un resultado.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { generar, FUENTE } = require('./herramientas/generar-verificador-sitio.js');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);

const original = fs.readFileSync(FUENTE, 'utf8');
const App = require('./docs/js/impi-viabilidad.js');

function cargar(codigo) {
    // Un contexto sin navegador: nada de window ni document.
    const ctx = { console, setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {}, Date, JSON, Math, Promise, Set, Map, Array, Object, String, Number, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, Intl };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(codigo, ctx);
    return ctx.VerificadorMarca;
}

(async () => {
    console.log('\nLa generación');
    const codigo = generar(original);
    verificar('se genera de la app sin errores', typeof codigo === 'string' && codigo.length > 50000);
    verificar('es determinista: dos veces, lo mismo', generar(original) === codigo);
    verificar('trae su huella de lo extraído', /Huella de lo extraído: [0-9a-f]{16}/.test(codigo));
    verificar('no usa el navegador ni la app', !/\bdocument\.|\bwindow\.|localStorage|\btoast\(|guardarBusqueda|syncManager/.test(codigo.replace(/\/\*\*[\s\S]*?\*\//g, '')));
    verificar('la app no se toca: el generador solo lee su archivo', original === fs.readFileSync(FUENTE, 'utf8'));
    verificar('el archivo de la app sigue siendo el de siempre (motor + interfaz)', /global\.VIABILIDAD = Object\.assign/.test(original));

    console.log('\nSi la app cambia de forma que rompa la extracción');
    {
        const conUI = original.replace('async function consultarSIGA(entrada, crudo) {', "async function consultarSIGA(entrada, crudo) {\n        document.getElementById('x');");
        let msg = '';
        try { generar(conUI); } catch (e) { msg = e.message; }
        verificar('document dentro de la orquestación: el generador falla y dice qué', /orquestación.*usa document/.test(msg), msg);
        const conToast = original.replace('async function consultarSIGA(entrada, crudo) {', "async function consultarSIGA(entrada, crudo) {\n        toast('hola');");
        msg = '';
        try { generar(conToast); } catch (e) { msg = e.message; }
        verificar('toast() también', /toast\(\)/.test(msg), msg);
        const conDB = original.replace('const AVISO_VIABILIDAD =', "const x = db.guardar(1);\n    const AVISO_VIABILIDAD =");
        msg = '';
        try { generar(conDB); } catch (e) { msg = e.message; }
        verificar('y la base de datos de la app dentro del motor', /motor.*base de datos/.test(msg), msg);
        msg = '';
        try { generar(original.replace('    function consultaMARCia(titulo, opcion) {', '    function consultaMARCiaRenombrada(titulo, opcion) {')); } catch (e) { msg = e.message; }
        verificar('si cambia un marcador, lo dice', /No encontré la región/.test(msg), msg);
    }

    console.log('\nEl módulo');
    const V = cargar(codigo);
    verificar('corre sin navegador', V && typeof V.estudiar === 'function' && typeof V.reintentar === 'function');
    verificar('expone todo lo que expone el motor de la app', Object.keys(App).every(k => k in V), Object.keys(App).filter(k => !(k in V)).join(', '));
    {
        const entrada = { denominacion: 'Luna Azul', clases: [25], tipo: 'nominativa', productos: '', solicitante: '' };
        const crudo = { marcia: [], marcanet: [], siga: [], fuentes: { MARCia: { ok: true, total: 0 }, Marcanet: { ok: true, total: 0 }, SIGA: { ok: true, total: 0 } } };
        const ahora = Date.parse('2026-11-13T12:00:00Z');
        igual('el motor da el mismo resultado que el de la app', JSON.stringify(V.analizar(entrada, crudo, ahora)), JSON.stringify(App.analizar(entrada, crudo, ahora)));
        igual('el aviso de la app viene incluido', V.AVISO_VIABILIDAD, App.AVISO_VIABILIDAD);
    }

    console.log('\nUn estudio completo, con respuestas simuladas del IMPI');
    const marcia = (id, title, status) => ({
        id, applicationNumber: id.replace(/\D/g, '').slice(-6), registrationNumber: status === 'REGISTRADO' ? '8' + id.replace(/\D/g, '').slice(-5) : '',
        title, status, appType: 'REGISTRO DE MARCA', owners: ['TITULAR DE ' + title], dates: { application: '10/02/2019', expiry: '10/02/2029' }, goodsAndServices: '', classes: [], images: ''
    });
    function proxy(marcas, opciones) {
        opciones = opciones || {};
        const llamadas = [];
        const f = async (ruta, init) => {
            llamadas.push(ruta);
            if (opciones.caido) throw new Error('El servicio de búsqueda IMPI no está disponible');
            if (ruta === '/marcia/csrf') return {};
            if (ruta === '/marcia/search') return { id: 'S1', count: marcas.length };
            if (ruta === '/marcia/results') return { resultPage: marcas, totalResults: marcas.length, aggregates: { NICE_CLASSES: [{ key: '25', docCount: marcas.length }, { key: '35', docCount: marcas.length }] } };
            if (ruta === '/marcanet/fonetica') return { results: [{ 'Denominación': 'MAR ABIERTO', Expediente: '9100001', Clase: '25', Titular: 'OTRO', 'Situación': 'REGISTRADA' }] };
            if (ruta === '/marcanet/full-detail') return { detail: null };
            if (ruta.indexOf('/marcia/view/') === 0) return {};
            if (ruta === '/siga/search') return { successed: true, data: [] };
            throw new Error('ruta inesperada ' + ruta);
        };
        f.llamadas = llamadas;
        return f;
    }
    {
        const eventos = [];
        const pf = proxy([marcia('RM201900111111', 'LUNA AZUL', 'REGISTRADO')]);
        const { reporte, crudo } = await V.estudiar({ denominacion: 'Luna Azul', tipo: 'nominativa', clases: [25], productos: '', solicitante: '', porPalabra: true },
            { proxyFetch: pf, clientId: () => 'cliente-1', progreso: (e) => eventos.push(e) });
        igual('una marca idéntica registrada en la misma clase: viabilidad baja', reporte.dictamen.nivel, 'baja');
        verificar('con al menos un antecedente de riesgo alto', reporte.conteo.alto >= 1, JSON.stringify(reporte.conteo));
        igual('las tres fuentes respondieron', reporte.fuentes.map(x => [x.nombre, x.ok]), [['MARCia', true], ['Marcanet', true], ['SIGA', true]]);
        verificar('se consultaron las tres fuentes por el proxy', ['/marcia/search', '/marcanet/fonetica', '/siga/search'].every(r => pf.llamadas.includes(r)), pf.llamadas.join(' '));
        verificar('avisa su progreso paso a paso', eventos.some(e => e.tipo === 'paso') && eventos.some(e => e.tipo === 'marca' && e.estado === 'ok'));
        verificar('el crudo queda para poder reintentar', crudo && Array.isArray(crudo.marcia) && crudo.fuentes.MARCia);
        verificar('el reporte trae observaciones, antecedentes y recomendaciones para el dictamen',
            Array.isArray(reporte.observaciones) && reporte.antecedentes.length >= 1 && reporte.recomendaciones.length >= 1);
    }
    {
        const pf = proxy([marcia('RM201900222222', 'SOL ROJO', 'REGISTRADO')]);
        const { reporte } = await V.estudiar({ denominacion: 'Luna Azul', tipo: 'nominativa', clases: [25], productos: '', solicitante: '', porPalabra: true }, { proxyFetch: pf });
        igual('sin parecidos: viabilidad alta', reporte.dictamen.nivel, 'alta');
        igual('sin antecedentes de riesgo', [reporte.conteo.alto, reporte.conteo.medio], [0, 0]);
    }
    {
        const pf = proxy([], { caido: true });
        const { reporte } = await V.estudiar({ denominacion: 'Luna Azul', tipo: 'nominativa', clases: [25], productos: '', solicitante: '', porPalabra: true }, { proxyFetch: pf });
        igual('si el IMPI no responde: no concluyente, no un resultado inventado', reporte.dictamen.nivel, 'incompleta');
        verificar('y se puede reintentar lo que faltó', V.faltantes(reporte).length >= 1, JSON.stringify(V.faltantes(reporte)));
    }
    {
        let error = '';
        try { await V.estudiar({ denominacion: 'X', clases: [25] }, {}); } catch (e) { error = e.message; }
        igual('sin proxyFetch avisa claramente', error, 'Falta proxyFetch');
    }

    console.log('\n' + pasadas + ' pasadas, ' + fallos.length + ' fallidas');
    if (fallos.length) { console.log('\nFallaron:\n  - ' + fallos.join('\n  - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
