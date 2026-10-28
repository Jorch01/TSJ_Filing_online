#!/usr/bin/env node
/**
 * Pruebas de la paginación de la fonética de Marcanet en el proxy
 * (docs/proxy/impi-proxy-worker.js).
 *
 *   node test_marcanet_paginas.js
 *
 * Marcanet entrega 10 resultados: la primera página de una tabla de
 * PrimeFaces. Aquí se carga el worker tal cual, con un Marcanet simulado que
 * responde como PrimeFaces, y se fija:
 *   - sin maxResultados, todo como antes: 10 resultados y ninguna petición más;
 *   - con maxResultados, junta las páginas siguientes, sin repetir filas y con
 *     las columnas de la primera (las páginas llegan sin encabezados);
 *   - si PrimeFaces acepta otro tamaño de página, basta una petición; si no,
 *     página por página hasta que se acaben;
 *   - la paginación ejecuta solo la tabla (no @all) y usa el ViewState nuevo;
 *   - si la búsqueda llega vacía, se repite una vez;
 *   - si no se encuentra la tabla o la primera página no viene llena, no se
 *     pide nada más y se devuelve lo que había.
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

const FUENTE = fs.readFileSync(path.join(__dirname, 'docs', 'proxy', 'impi-proxy-worker.js'), 'utf8');
const TABLA = 'frmBsqFonetica:resultadoExpediente';

// ---- Marcanet simulado ----

function filaHTML(n) {
    const exp = String(100000 + n);
    return `<tr data-ri="${n}" class="ui-widget-content" role="row"><td>${n + 1}</td><td>M</td><td></td><td>TITULAR ${n}</td>` +
        `<td><a href="#" onclick="window.open('/marcanet/vistas/common/busquedas/detalleExpedienteParcial.pgi?tipo=1&amp;anio=1985&amp;expediente=${exp}', '', 'width=700px');;` +
        `PrimeFaces.ab({s:&quot;${TABLA}:${n}:j_idt54&quot;,f:&quot;frmBsqFonetica&quot;});return false;">${exp}</a></td>` +
        `<td>${n % 2 ? '' : String(900000 + n)}</td><td>LUNA ${n}</td><td>43</td><td></td></tr>`;
}

function marcanet(op) {
    const llamadas = [];
    let busquedas = 0;
    const total = op.total;
    const respuesta = (cuerpo, extra) => new Response(cuerpo, { status: 200, headers: Object.assign({ 'Content-Type': 'text/xml' }, extra || {}) });
    const parcial = (updates) => '<?xml version="1.0" encoding="UTF-8"?><partial-response><changes>' +
        Object.entries(updates).map(([id, html]) => `<update id="${id}"><![CDATA[${html}]]></update>`).join('') + '</changes></partial-response>';
    const fetch = async (url, init) => {
        const metodo = (init && init.method) || 'GET';
        const cuerpo = init && init.body ? new URLSearchParams(init.body) : null;
        llamadas.push({ url: String(url), metodo, cuerpo });
        if (/home\.pgi/.test(url)) return respuesta('<html></html>', { 'Set-Cookie': 'JSESSIONID=abc123; Path=/marcanet' });
        if (metodo === 'GET' && /bsqFonetica\.pgi/.test(url)) {
            return respuesta('<html><form id="frmBsqFonetica"><input type="text" name="frmBsqFonetica:denominacion"/>' +
                '<input type="hidden" name="javax.faces.ViewState" id="j_id1:javax.faces.ViewState:0" value="VS-FORM" /></form></html>');
        }
        if (metodo === 'POST' && cuerpo.get('javax.faces.source') === 'frmBsqFonetica:busquedaId2') {
            busquedas++;
            if (op.vaciaPrimero && busquedas === 1) {
                return respuesta(parcial({ 'frmBsqFonetica:pnlBsqFonetica': '<table><tr><td><input name="x"/></td><td>Denominación</td></tr></table>', 'j_id1:javax.faces.ViewState:0': 'VS-SEARCH' }));
            }
            const primeras = Math.min(10, total);
            const cw = op.sinConfig ? '' :
                `<script id="${TABLA}_s">$(function(){PrimeFaces.cw("DataTable","widget_frmBsqFonetica_resultadoExpediente",{id:"${TABLA}",widgetVar:"widget_frmBsqFonetica_resultadoExpediente",paginator:{id:['${TABLA}_paginator_bottom'],rows:10,rowCount:${total},page:0}});});</script>`;
            const tabla = `<div id="${TABLA}" class="ui-datatable ui-widget">` +
                (total > 10 ? `<div class="ui-paginator"><span class="ui-paginator-current">(1 de ${Math.ceil(total / 10)})</span></div>` : '') +
                '<table role="grid"><thead><tr><th>#</th><th>TS</th><th>TM</th><th>Titular</th><th>Expediente</th><th>Registro</th><th>Denominación</th><th>Clase</th><th>Logotipo</th></tr></thead><tbody>' +
                Array.from({ length: primeras }, (_, i) => filaHTML(i)).join('') + '</tbody></table></div>' + cw;
            return respuesta(parcial({
                'frmBsqFonetica:pnlBsqFonetica': '<table><tr><td><input name="frmBsqFonetica:denominacion"/></td></tr></table>',
                'frmBsqFonetica:dlgListaFoneticos': tabla,
                'j_id1:javax.faces.ViewState:0': 'VS-SEARCH'
            }));
        }
        if (metodo === 'POST' && cuerpo.get('javax.faces.source') === TABLA) {
            let primero = parseInt(cuerpo.get(TABLA + '_first'), 10);
            let filas = parseInt(cuerpo.get(TABLA + '_rows'), 10);
            if (op.solo10) { filas = 10; primero = Math.floor(primero / 10) * 10; }
            if (op.paginaFalla) throw new Error('Marcanet no respondió');
            const html = Array.from({ length: Math.max(0, Math.min(total, primero + filas) - primero) }, (_, i) => filaHTML(primero + i)).join('');
            return respuesta(parcial({ [TABLA]: html, 'j_id1:javax.faces.ViewState:0': 'VS-PAGINA' }));
        }
        throw new Error('Petición no simulada: ' + metodo + ' ' + url);
    };
    return { fetch, llamadas, busquedas: () => busquedas };
}

function cargarWorker(sim) {
    const ctx = {
        fetch: sim.fetch, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
        crypto: globalThis.crypto, btoa, atob, console: { log() {}, error() {}, warn() {} },
        setTimeout, clearTimeout, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Set, Map, Error,
        parseInt, parseFloat, encodeURIComponent, decodeURIComponent, escape, unescape
    };
    vm.createContext(ctx);
    vm.runInContext(FUENTE.replace(/^export default \{/m, 'globalThis.__worker = {') +
        '\nthis.handleMarcanetFonetica = handleMarcanetFonetica; this.tablaMarcanet = tablaMarcanet;', ctx);
    return ctx;
}

async function buscar(op, cuerpo) {
    const sim = marcanet(op);
    const w = cargarWorker(sim);
    const req = new Request('https://proxy.example/marcanet/fonetica', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-IMPI-Client': 'prueba-cliente-1234' },
        body: JSON.stringify(Object.assign({ denominacion: 'luna', clase: '43' }, cuerpo || {}))
    });
    const res = await w.handleMarcanetFonetica(req);
    const datos = await res.json();
    const paginas = sim.llamadas.filter(l => l.cuerpo && l.cuerpo.get('javax.faces.source') === TABLA);
    return { datos, paginas, sim, w };
}

const exps = (d) => (d.results || []).map(r => r['Expediente']);

(async () => {
    console.log('\nSin maxResultados, como siempre');
    {
        const { datos, paginas } = await buscar({ total: 23 });
        igual('trae la primera página: 10', datos.totalResults, 10);
        igual('y no pide más páginas', paginas.length, 0);
        igual('ni informa paginación', datos.paginacion, undefined);
        igual('las columnas de siempre', Object.keys(datos.results[0]).filter(k => !k.startsWith('_')),
            ['#', 'TS', 'TM', 'Titular', 'Expediente', 'Registro', 'Denominación', 'Clase', 'Logotipo']);
    }

    console.log('\nPrimeFaces acepta otro tamaño de página');
    {
        const { datos, paginas } = await buscar({ total: 23 }, { maxResultados: 60 });
        igual('junta las 23', datos.totalResults, 23);
        igual('sin repetir ninguna', new Set(exps(datos)).size, 23);
        igual('con una sola petición', [paginas.length, datos.paginacion.metodo], [1, 'una']);
        igual('pide hasta el total que dice la tabla', [paginas[0].cuerpo.get(TABLA + '_first'), paginas[0].cuerpo.get(TABLA + '_rows')], ['0', '23']);
        igual('la tabla y su tamaño salen de su configuración', [datos.paginacion.tabla, datos.paginacion.porPagina, datos.paginacion.total], [TABLA, 10, 23]);
        const r = datos.results[15];
        igual('las filas de las páginas siguientes llevan las columnas de la primera', [r['Denominación'], r['Expediente'], r['Titular'], r['Clase']],
            ['LUNA 15', '100015', 'TITULAR 15', '43']);
        verificar('y el enlace a su ficha', /detalleExpedienteParcial\.pgi\?tipo=1&anio=1985&expediente=100015$/.test(r._link_4 || ''), r._link_4);
        const p = paginas[0].cuerpo;
        igual('la paginación ejecuta solo la tabla, no @all', p.getAll('javax.faces.partial.execute'), [TABLA]);
        igual('con el ViewState que devolvió la búsqueda', p.get('javax.faces.ViewState'), 'VS-SEARCH');
        igual('como lo hace el paginador de la página', [p.get(TABLA + '_pagination'), p.get('javax.faces.partial.event'), p.get('frmBsqFonetica')], ['true', 'page', 'frmBsqFonetica']);
    }
    {
        const { datos } = await buscar({ total: 23 }, { maxResultados: 15 });
        igual('no junta más de lo pedido', datos.totalResults, 15);
    }
    {
        const { sim } = await buscar({ total: 23 }, { maxResultados: 60 });
        const busqueda = sim.llamadas.find(l => l.cuerpo && l.cuerpo.get('javax.faces.source') === 'frmBsqFonetica:busquedaId2');
        igual('la búsqueda en sí sigue ejecutando @all', busqueda.cuerpo.getAll('javax.faces.partial.execute'), ['@all']);
    }

    console.log('\nPrimeFaces solo da 10 por página');
    {
        const { datos, paginas } = await buscar({ total: 23, solo10: true }, { maxResultados: 60 });
        igual('junta las 23 página por página', [datos.totalResults, new Set(exps(datos)).size], [23, 23]);
        igual('primero intenta todo, luego la 2 y la 3', paginas.map(p => p.cuerpo.get(TABLA + '_first') + '/' + p.cuerpo.get(TABLA + '_rows')), ['0/23', '10/10', '20/10']);
        igual('y lo dice', datos.paginacion.metodo, 'paginas');
    }
    {
        const { datos, paginas } = await buscar({ total: 23, solo10: true, sinConfig: true }, { maxResultados: 60 });
        igual('sin la configuración de la tabla, la encuentra por sus filas y para cuando se acaban',
            [datos.totalResults, datos.paginacion.tabla, paginas.map(p => p.cuerpo.get(TABLA + '_first') + '/' + p.cuerpo.get(TABLA + '_rows'))],
            [23, TABLA, ['0/60', '10/10', '20/10', '30/10']]);
    }

    console.log('\nCuando no hay más');
    {
        const { datos, paginas } = await buscar({ total: 7 }, { maxResultados: 60 });
        igual('con la primera página incompleta no pide más', [datos.totalResults, paginas.length], [7, 0]);
    }
    {
        const { datos } = await buscar({ total: 23, paginaFalla: true }, { maxResultados: 60 });
        igual('si una página falla, devuelve lo que ya tenía', [datos.totalResults, !!datos.paginacion.error], [10, true]);
    }

    console.log('\nBúsqueda vacía');
    {
        const { datos, sim } = await buscar({ total: 23, vaciaPrimero: true });
        igual('si llega vacía se repite una vez', [sim.busquedas(), datos.totalResults], [2, 10]);
    }
    {
        const { datos, sim } = await buscar({ total: 0 });
        igual('si de verdad no hay nada, solo lo intenta dos veces', [sim.busquedas(), datos.totalResults], [2, 0]);
    }

    console.log('\nDepuración');
    {
        const { datos } = await buscar({ total: 23 }, { maxResultados: 60, depurar: true });
        verificar('con depurar devuelve lo que respondió Marcanet, para revisarlo en vivo',
            /partial-response/.test(datos.depuracion.busqueda) && /partial-response/.test(datos.depuracion.pagina));
        const sin = (await buscar({ total: 23 }, { maxResultados: 60 })).datos;
        igual('sin depurar no', sin.depuracion, undefined);
    }

    console.log('\nEn el proxy');
    {
        verificar('el worker anuncia la versión con paginación', /const WORKER_VERSION = '2026-10-28-paginas'/.test(FUENTE));
        const viab = fs.readFileSync(path.join(__dirname, 'docs', 'js', 'impi-viabilidad.js'), 'utf8');
        verificar('el estudio de viabilidad pide más resultados a Marcanet', /maxResultados: MAX_MARCANET/.test(viab));
        const pestaña = fs.readFileSync(path.join(__dirname, 'docs', 'js', 'impi-search.js'), 'utf8');
        verificar('la pestaña y la vigilancia no (cambiarían lo que cuentan como nuevo)', !/maxResultados/.test(pestaña));
    }

    console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
    if (fallos.length) {
        console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
        process.exit(1);
    }
})().catch(e => { console.error(e); process.exit(1); });
