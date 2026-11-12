#!/usr/bin/env node
/**
 * Monitor de integraciones, su issue y el despliegue del Worker.
 *
 *   node test_monitor_integraciones.js     sin red: lo que corre en CI
 *
 * Lo que se fija aquí (todo con un "internet" falso; nada sale de la máquina):
 *   - con producción sana, cada prueba da ok; sin los secretos opcionales se
 *     OMITEN las que los necesitan, se dice por qué y eso no es una falla;
 *   - cada tipo de ruptura se reporta como falla y con una frase que dice qué
 *     fue: SISE incompleto, la página laboral sin sus campos, cuotas apagadas,
 *     el Apps Script devolviendo HTML, la licencia rechazada, un certificado
 *     que no se puede verificar, un sitio que no contesta;
 *   - un Worker desfasado del repo es un AVISO, no una falla;
 *   - ningún secreto (licencia, clave de Gemini, pase) llega al informe, aunque
 *     un sitio los devuelva dentro de un mensaje de error; la licencia solo
 *     viaja en el cuerpo de /cuota;
 *   - el issue se abre, se actualiza (con comentario solo si cambia QUÉ falla)
 *     y se cierra al recuperarse; omitidas y avisos no lo abren;
 *   - el despliegue con wrangler no hace nada sin CLOUDFLARE_API_TOKEN, conserva
 *     el KV CUOTAS y avisa si /health no coincide con WORKER_VERSION;
 *   - el certificado de Root YR que necesita SISE desde Node es el correcto.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const M = require('./herramientas/monitor-integraciones.js');
const V = require('./herramientas/verificar-worker.js');
const I = require('./herramientas/monitor-issue.js');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);
const leer = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

const WORKER = leer('docs', 'proxy', 'impi-proxy-worker.js');
const APP = leer('docs', 'js', 'app.js');
const VERSION = V.versionDelRepo();
const LICENCIA = 'LIC-SECRETA-12345';
const CLAVE_GEMINI = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE1234567';
const PASE = 'eyJ0IjoiYnVzcXVlZGEiLCJwIjp0cnVlfQ.firmafirmafirmafirma';

// ==================== UN INTERNET FALSO ====================

const HTML_LABORAL = '<html><body>' + 'x'.repeat(2000) +
    '<input id="recaptcha_token"><input id="FechaInicio"><input id="FechaFin"><select id="IdUR">' +
    ['20', '23', '27', '29', '33', '35'].map(v => '<option value="' + v + '">u</option>').join('') +
    '</select><script src="https://www.google.com/recaptcha/enterprise.js?render=x"></script></body></html>';
const HTML = (t) => new Response('<html><body>' + (t || 'página') + 'x'.repeat(400) + '</body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const JSON_ = (o, status, cab) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json' }, cab || {}) });

/** Producción sana. `rompe(url, init)` puede devolver otra respuesta (o lanzar) para romper algo. */
function internet(rompe, bitacora) {
    return async (url, init) => {
        init = init || {};
        if (bitacora) bitacora.push({ url: String(url), init });
        if (rompe) { const r = await rompe(String(url), init); if (r) return r; }
        const u = new URL(url);
        const h = u.host;
        const cuerpo = init.body ? JSON.parse(init.body) : null;
        if (h === 'www.tsjqroo.gob.mx') return HTML('estrados');
        if (h === 'sag-styps.qroo.gob.mx') return new Response(HTML_LABORAL, { status: 200, headers: { 'content-type': 'text/html' } });
        if (h === 'www.dgej.cjf.gob.mx') return HTML('vercaptura');
        if (h === 'script.google.com') return JSON_({ valido: false, mensaje: 'Código no encontrado' });
        if (h === 'generativelanguage.googleapis.com') {
            if (u.pathname.endsWith('/models')) return JSON_({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] });
            return JSON_({ candidates: [{ content: { parts: [{ text: 'listo' }] } }] });
        }
        if (h === 'throbbing-scene-1c2b.enlilh.workers.dev') {
            const p = u.pathname;
            if (p === '/health') return JSON_({ status: 'ok', version: VERSION, services: ['marcia', 'siga', 'marcanet', 'sesiones'], cuotas: true });
            if (p === '/cuota') return JSON_({ servidor: true, permitido: true, premium: true, pase: PASE });
            if (p === '/marcia/csrf') return JSON_({ csrf: 'tok', sessionActive: true }, 200, { 'x-impi-session': 'sesion-1' });
            if (p === '/marcia/search') return JSON_({ id: 'busqueda-1', count: 120 }, 200, { 'x-impi-session': 'sesion-2' });
            if (p === '/marcia/results') return JSON_({ totalResults: 120, resultPage: [{ id: 1 }] });
            if (p === '/siga/areas') return JSON_({ successed: true, data: [{ idArea: 1 }, { idArea: 2 }, { idArea: 3 }] });
            if (p === '/siga/search') return JSON_({ successed: true, data: [{ datos: [] }] });
            if (p === '/marcanet/session') return JSON_({ sessionActive: true });
            if (p === '/marcanet/fonetica') return JSON_({ results: [{ Expediente: '1' }] });
            if (p === '/api/sesiones') return JSON_({ version: 2, desde: '2026-11-09', hasta: '2026-11-20', completo: true, errores: [], sesiones: [] });
        }
        return new Response('no existe en el internet falso: ' + url, { status: 404 });
    };
}

const base = (extra) => Object.assign({ esperar: async () => {}, pausaMs: 0 }, extra);
const conTodo = { MONITOR_LICENCIA_CODIGO: LICENCIA, GEMINI_API_KEY: CLAVE_GEMINI };
const por = (r, id) => r.chequeos.find(c => c.id === id);
const estados = (r) => Object.fromEntries(r.chequeos.map(c => [c.id, c.estado]));

(async () => {
    console.log('\n── Producción sana, con todos los secretos');
    const bit = [];
    const sana = await M.correr(base({ fetch: internet(null, bit), env: conTodo }));
    verificar('todas las pruebas dan ok', sana.chequeos.every(c => c.estado === 'ok'), JSON.stringify(estados(sana)));
    verificar('son 15 pruebas, con ids únicos', sana.chequeos.length === 15 && new Set(sana.chequeos.map(c => c.id)).size === 15);
    verificar('el pase viaja en X-TSJ-Cuota a las rutas que lo exigen',
        ['/api/sesiones', '/marcia/search', '/siga/search', '/marcanet/fonetica'].every(r =>
            bit.some(b => b.url.includes(r) && b.init.headers['X-TSJ-Cuota'] === PASE)));
    verificar('/api/sesiones se pide con refresh=1 (sin caché) y un expediente inventado',
        bit.some(b => /\/api\/sesiones\?refresh=1&exp=462%3A1%2F2000/.test(b.url)));
    verificar('la licencia solo viaja en el cuerpo de /cuota, nunca en una URL',
        !bit.some(b => b.url.includes(LICENCIA)) && bit.filter(b => String(b.init.body || '').includes(LICENCIA)).every(b => b.url.endsWith('/cuota')));
    verificar('la clave de Gemini va en la cabecera x-goog-api-key, no en la URL',
        !bit.some(b => b.url.includes(CLAVE_GEMINI)) && bit.filter(b => b.url.includes('generativelanguage')).every(b => b.init.headers['x-goog-api-key'] === CLAVE_GEMINI));
    verificar('el monitor se identifica con un User-Agent propio y no manda Origin',
        bit.every(b => b.init.headers['User-Agent'] === M.USER_AGENT && !('Origin' in b.init.headers)) && /TSJ-Monitor/.test(M.USER_AGENT));
    verificar('MARCia reenvía la sesión que devolvió el Worker',
        bit.some(b => b.url.includes('/marcia/search') && b.init.headers['X-IMPI-Session'] === 'sesion-1') &&
        bit.some(b => b.url.includes('/marcia/results') && b.init.headers['X-IMPI-Session'] === 'sesion-2'));

    console.log('\n── Sin los secretos opcionales');
    const sinNada = await M.correr(base({ fetch: internet(), env: {} }));
    igual('se omiten solo las que necesitan licencia o clave',
        sinNada.chequeos.filter(c => c.estado === 'omitida').map(c => c.id).sort(),
        ['gemini', 'licencia-premium', 'marcanet-busqueda', 'marcia-busqueda', 'sesiones-sise', 'siga-busqueda']);
    verificar('omitir NO es fallar', sinNada.resumen.falla === 0 && sinNada.resumen.omitida === 6 && sinNada.resumen.ok === 9);
    verificar('el resultado dice qué secreto falta', /MONITOR_LICENCIA_CODIGO/.test(por(sinNada, 'sesiones-sise').detalle) && /GEMINI_API_KEY/.test(por(sinNada, 'gemini').detalle));
    verificar('lo que no necesita pase se prueba igual (sesiones de MARCia, SIGA y Marcanet)',
        ['marcia-sesion', 'siga-areas', 'marcanet-sesion', 'worker-salud', 'licencias-api', 'estrados-laborales'].every(id => por(sinNada, id).estado === 'ok'));

    console.log('\n── Rupturas: cada una se reporta con su causa');
    const con = (rompe, env) => M.correr(base({ fetch: internet(rompe), env: env || conTodo }));

    let r = await con((u) => u.includes('/api/sesiones') ? JSON_({ completo: false, errores: [{ etapa: 'reporte', mensaje: 'SISE no respondió' }, {}] }) : null);
    verificar('SISE incompleto → falla con la etapa y el mensaje',
        por(r, 'sesiones-sise').estado === 'falla' && /completo=false, 2 errores/.test(por(r, 'sesiones-sise').detalle) && /reporte: SISE no respondió/.test(por(r, 'sesiones-sise').detalle), por(r, 'sesiones-sise').detalle);
    r = await con((u) => u.includes('/api/sesiones') ? JSON_({ completo: true, errores: [{ mensaje: 'x' }] }) : null);
    verificar('SISE "completo" pero con errores → falla', por(r, 'sesiones-sise').estado === 'falla');

    r = await con((u) => u.includes('sag-styps') ? HTML('<select id="IdUR"></select>' + 'y'.repeat(2500)) : null);
    verificar('estrados laborales sin sus campos → falla y dice cuáles',
        por(r, 'estrados-laborales').estado === 'falla' && /FechaInicio/.test(por(r, 'estrados-laborales').detalle) && /unidad 20/.test(por(r, 'estrados-laborales').detalle), por(r, 'estrados-laborales').detalle);

    r = await con((u) => u.endsWith('/health') ? JSON_({ status: 'ok', version: VERSION, services: ['marcia', 'siga', 'marcanet', 'sesiones'], cuotas: false }) : null);
    verificar('cuotas apagadas en el Worker → falla', por(r, 'worker-salud').estado === 'falla' && /CUOTA_SECRETO/.test(por(r, 'worker-salud').detalle));

    r = await con((u) => u.endsWith('/health') ? JSON_({ status: 'ok', version: '2020-01-01-vieja', services: ['marcia', 'siga', 'marcanet', 'sesiones'], cuotas: true }) : null);
    verificar('Worker desfasado del repo → AVISO, no falla',
        por(r, 'worker-salud').estado === 'aviso' && r.resumen.falla === 0 && /2020-01-01-vieja/.test(por(r, 'worker-salud').detalle) && new RegExp(VERSION).test(por(r, 'worker-salud').detalle), por(r, 'worker-salud').detalle);

    r = await con((u) => u.endsWith('/health') ? JSON_({ status: 'ok', services: ['marcia'], cuotas: true }) : null);
    verificar('un Worker viejo que no ofrece sesiones → falla', por(r, 'worker-salud').estado === 'falla' && /siga, marcanet, sesiones/.test(por(r, 'worker-salud').detalle));

    r = await con((u) => u.includes('script.google.com') ? HTML('Error de Apps Script') : null);
    verificar('el Apps Script devuelve HTML en vez de JSON → falla', por(r, 'licencias-api').estado === 'falla' && /no devolvió JSON/.test(por(r, 'licencias-api').detalle));
    r = await con((u) => u.includes('script.google.com') ? JSON_({ valido: true }) : null);
    verificar('el Apps Script acepta un código inexistente → falla', por(r, 'licencias-api').estado === 'falla');

    r = await con((u) => u.endsWith('/cuota') ? JSON_({ servidor: true, permitido: true, premium: false, usados: 1, limite: 5, pase: 'otro' }) : (u.includes('script.google.com') ? JSON_({ valido: false, mensaje: 'Licencia expirada' }) : null));
    verificar('licencia que el Worker no reconoce → falla con el motivo de la API de licencias',
        por(r, 'licencia-premium').estado === 'falla' && /Licencia expirada/.test(por(r, 'licencia-premium').detalle), por(r, 'licencia-premium').detalle);
    verificar('si falla la licencia, lo que depende de su pase queda "no probada" (no suma fallas)',
        ['sesiones-sise', 'marcia-busqueda', 'siga-busqueda', 'marcanet-busqueda'].every(id => por(r, id).estado === 'omitida' && /licencia-premium/.test(por(r, id).detalle)) && r.resumen.falla === 1);

    r = await con((u) => u.includes('/marcanet/fonetica') ? JSON_({ isFormPage: true }) : null);
    verificar('Marcanet devuelve el formulario → falla', por(r, 'marcanet-busqueda').estado === 'falla' && /formulario/.test(por(r, 'marcanet-busqueda').detalle));
    r = await con((u) => u.includes('/siga/search') ? JSON_({ successed: true, data: [] }) : null);
    verificar('SIGA sin fichas para una marca famosa → falla', por(r, 'siga-busqueda').estado === 'falla');
    r = await con((u) => u.includes('/marcia/results') ? JSON_({ totalResults: 0, resultPage: [] }) : null);
    verificar('MARCia sin resultados para una marca famosa → falla', por(r, 'marcia-busqueda').estado === 'falla');
    r = await con((u) => u.includes('/marcia/csrf') ? JSON_({ error: 'MARCia no respondió' }, 502) : null);
    verificar('MARCia caído (502 del Worker) → falla en sesión y en búsqueda, con el HTTP',
        por(r, 'marcia-sesion').estado === 'falla' && /HTTP 502/.test(por(r, 'marcia-sesion').detalle) && por(r, 'marcia-busqueda').estado === 'falla');
    r = await con((u) => u.includes('/siga/search') ? JSON_({ error: 'Se alcanzó el límite', cuota: true }, 402) : null);
    verificar('un 402 del Worker se explica como pase rechazado', por(r, 'siga-busqueda').estado === 'falla' && /pase \(HTTP 402\)/.test(por(r, 'siga-busqueda').detalle));

    r = await con((u) => { if (u.includes('www.tsjqroo.gob.mx')) { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNRESET' }; throw e; } });
    verificar('el TSJ corta la conexión a GitHub (fuera de México) → aviso, no falla, con el host y el código',
        por(r, 'tsj-estrados-primera').estado === 'aviso' && /www\.tsjqroo\.gob\.mx.*ECONNRESET/.test(por(r, 'tsj-estrados-primera').detalle) && por(r, 'tsj-estrados-segunda').estado === 'aviso', por(r, 'tsj-estrados-primera').detalle);
    r = await con((u) => { if (u.includes('sag-styps')) { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNRESET' }; throw e; } });
    verificar('otro sitio que corta la conexión → sigue siendo falla', por(r, 'estrados-laborales').estado === 'falla' && /ECONNRESET/.test(por(r, 'estrados-laborales').detalle));
    r = await con((u) => { if (u.includes('dgej.cjf.gob.mx')) { const e = new TypeError('fetch failed'); e.cause = { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }; throw e; } });
    verificar('SISE con la cadena incompleta → falla y dice cómo arreglarlo (NODE_EXTRA_CA_CERTS)',
        por(r, 'pjf-consulta').estado === 'falla' && /NODE_EXTRA_CA_CERTS=herramientas\/certificados\/root-yr-by-x1\.pem/.test(por(r, 'pjf-consulta').detalle), por(r, 'pjf-consulta').detalle);
    r = await con((u) => { if (u.includes('sag-styps')) { const e = new Error('se acabó el tiempo'); e.name = 'TimeoutError'; throw e; } });
    verificar('un sitio que no responde a tiempo → falla', por(r, 'estrados-laborales').estado === 'falla' && /no respondió a tiempo/.test(por(r, 'estrados-laborales').detalle));
    r = await con((u) => u.includes('www.tsjqroo.gob.mx') ? new Response('<html>Fatal error: Uncaught PDOException ' + 'x'.repeat(400), { status: 200, headers: { 'content-type': 'text/html' } }) : null);
    verificar('una página de error de PHP con HTTP 200 → falla', por(r, 'tsj-estrados-primera').estado === 'falla' && /página de error/.test(por(r, 'tsj-estrados-primera').detalle));
    r = await con((u) => u.includes('www.dgej.cjf.gob.mx') ? new Response('mantenimiento', { status: 503 }) : null);
    verificar('HTTP 503 del PJF → falla', por(r, 'pjf-consulta').estado === 'falla' && /HTTP 503/.test(por(r, 'pjf-consulta').detalle));

    r = await con((u) => u.includes('/models') ? JSON_({ error: { message: 'API key not valid' } }, 400) : null);
    verificar('Gemini rechaza la clave → falla', por(r, 'gemini').estado === 'falla' && /HTTP 400/.test(por(r, 'gemini').detalle));
    r = await con((u) => u.includes(':generateContent') ? JSON_({ error: { message: 'quota exceeded' } }, 429) : null);
    verificar('Gemini sin cuota (429) → falla', por(r, 'gemini').estado === 'falla' && /HTTP 429/.test(por(r, 'gemini').detalle));
    r = await con((u) => u.endsWith('/models?pageSize=200') ? JSON_({ models: [{ name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] }] }) : null);
    verificar('si el modelo por defecto de la app ya no existe → aviso', por(r, 'gemini').estado === 'aviso' && /gemini-3-flash/.test(por(r, 'gemini').detalle));
    {
        const probados = [];
        r = await con((u) => {
            if (u.endsWith('/models?pageSize=200')) return JSON_({ models: ['gemini-2.5-flash', 'gemini-9.0-flash', 'gemini-8.0-flash', 'gemini-9.0-flash-preview-tts']
                .map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) });
            const m = /models\/([^:]+):generateContent/.exec(u);
            if (m) { probados.push(m[1]); if (m[1] !== 'gemini-8.0-flash') return JSON_({ error: { message: 'This model is no longer available to new users.' } }, 404); }
            return null;
        });
        verificar('el modelo por defecto aparece en la lista pero ya no responde → prueba los demás como la app y avisa',
            por(r, 'gemini').estado === 'aviso' && /gemini-8\.0-flash/.test(por(r, 'gemini').detalle), por(r, 'gemini').detalle);
        igual('en el orden de la app: el de la app, luego el más nuevo, sin el de voz', probados.slice(0, 3), ['gemini-2.5-flash', 'gemini-9.0-flash', 'gemini-8.0-flash']);
    }

    console.log('\n── Reintentos');
    let intentos = 0;
    r = await con((u) => { if (u.includes('/siga/areas') && ++intentos === 1) return JSON_({ error: 'tropezón' }, 503); });
    verificar('un tropiezo pasajero se reintenta una vez y no es falla', por(r, 'siga-areas').estado === 'ok' && intentos === 2);
    intentos = 0;
    r = await con((u) => { if (u.includes('/siga/areas')) { intentos++; return JSON_({ error: 'caído' }, 503); } });
    verificar('si sigue mal tras el reintento, es falla', por(r, 'siga-areas').estado === 'falla' && intentos === 2);
    r = await M.correr(base({ fetch: internet((u) => u.includes('/siga/areas') ? JSON_({}, 500) : null), env: {}, reintentos: 0 }));
    verificar('con reintentos en 0 se prueba una sola vez', por(r, 'siga-areas').estado === 'falla');

    console.log('\n── Nada sensible llega al informe');
    r = await M.correr(base({
        env: conTodo,
        fetch: internet((u) => {
            const eco = ' licencia ' + LICENCIA + ' clave ' + CLAVE_GEMINI + ' pase ' + PASE + ' correo cliente@despacho.mx';
            if (u.includes('/marcia/results') || u.includes('/siga/search') || u.includes('/marcanet/fonetica') || u.includes('/api/sesiones')) return JSON_({ error: 'falló' + eco }, 500);
            if (u.includes('generativelanguage') && u.includes(':generate')) return JSON_({ error: { message: 'mal' + eco } }, 500);
        })
    }));
    const todo = JSON.stringify(r) + M.informeMarkdown(r, { urlEjecucion: 'https://github.com/x/y/actions/runs/1' }) + M.textoPlano(r);
    verificar('hay fallas que contenían secretos y correos…', r.resumen.falla >= 4, JSON.stringify(estados(r)));
    verificar('…y ninguno aparece en el JSON, el Markdown ni el texto',
        !todo.includes(LICENCIA) && !todo.includes(CLAVE_GEMINI) && !todo.includes('firmafirma') && !todo.includes('despacho.mx') && !/AIza/.test(todo), todo.match(/.{30}(LIC-SECRETA|AIza|firmafirma|despacho\.mx).{10}/));
    igual('limpiar() quita secretos, claves, pases y correos',
        M.limpiar('a LIC-SECRETA-12345 b AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE1234567 c ' + PASE + ' d x@y.mx', [LICENCIA]),
        'a [secreto] b [clave] c [pase] d [correo]');
    verificar('limpiar() recorta lo largo', M.limpiar('a'.repeat(1000)).length <= 300);
    verificar('las consultas del monitor son fijas e inventadas (ni un cliente ni un expediente real)',
        M.CONSULTAS.sesiones === '462:1/2000' && M.CONSULTAS.pjf.expediente === '1/2000' && M.CONSULTAS.marca === 'COCA COLA');

    console.log('\n── Informe y --solo');
    const md = M.informeMarkdown(r, {});
    verificar('el Markdown pone primero las fallas', md.indexOf('❌') < md.indexOf('✅'));
    const sola = await M.correr(base({ fetch: internet(), env: {}, soloIds: ['siga-areas'] }));
    verificar('--solo corre únicamente lo pedido', sola.chequeos.length === 1 && sola.chequeos[0].id === 'siga-areas');

    console.log('\n── Las URLs que prueba el monitor son las que usa la app');
    const juz = leer('docs', 'js', 'juzgados.js');
    verificar('el juzgado y la sala de las consultas existen en juzgados.js',
        new RegExp(`'JUZGADO PRIMERO CIVIL CANCUN': ${M.CONSULTAS.tsjPrimera.int}\\b`).test(juz) &&
        new RegExp(`'PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR': ${M.CONSULTAS.tsjSala.int}\\b`).test(juz) &&
        new RegExp(`${M.CONSULTAS.tsjSala.int}: ${M.CONSULTAS.tsjSala.areaId}\\b`).test(juz));
    verificar('el Worker y la app usan la misma API de licencias',
        (/const LICENCIAS_API = '([^']+)'/.exec(WORKER) || [])[1] === (/apiUrl: '([^']+)'/.exec(APP) || [])[1]);
    const lab = require('./docs/js/estrados-laborales.js');
    igual('las unidades laborales del monitor son las del marcador de la app', lab.UNIDADES.map(u => u.id).sort(), ['20', '23', '27', '29', '33', '35']);
    verificar('el monitor usa la misma página de estrados laborales que la app', M.CHEQUEOS.length > 0 && leer('herramientas', 'monitor-integraciones.js').includes(lab.URL_ESTRADOS));
    verificar('la ruta de PJF es la que arma la app', leer('docs', 'js', 'pjf-search.js').includes('www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx') &&
        leer('herramientas', 'monitor-integraciones.js').includes('www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx'));

    console.log('\n── El Worker publicado contra el del repo');
    verificar('WORKER_VERSION se lee del código', /^\d{4}-\d{2}-\d{2}/.test(VERSION || ''), VERSION);
    igual('misma versión → ok', V.compararVersion('a', 'a').estado, 'ok');
    igual('versión distinta → aviso', V.compararVersion('a', 'b').estado, 'aviso');
    verificar('un Worker sin versión en /health (anterior a WORKER_VERSION) → aviso', V.compararVersion('a', undefined).estado === 'aviso');
    let llamadas = 0;
    const tarda = async () => JSON_({ status: 'ok', version: ++llamadas < 3 ? 'vieja' : 'nueva', cuotas: true });
    let v = await V.verificar({ fetchFn: tarda, repo: 'nueva', intentos: 6, espera: 0, esperar: async () => {} });
    verificar('tras desplegar reintenta hasta que /health trae la versión nueva', v.estado === 'ok' && llamadas === 3);
    v = await V.verificar({ fetchFn: async () => JSON_({ status: 'ok', version: 'vieja' }), repo: 'nueva', intentos: 3, espera: 0, esperar: async () => {} });
    verificar('si nunca coincide, termina en aviso (no lanza)', v.estado === 'aviso');
    let cayo = false;
    try { await V.verificar({ fetchFn: async () => { throw new Error('sin red'); }, repo: 'x', intentos: 2, espera: 0, esperar: async () => {} }); } catch (e) { cayo = true; }
    verificar('si /health no responde nunca, lanza', cayo);

    console.log('\n── El issue: abrir, actualizar, cerrar');
    function github(abiertos) {
        const llamadas = [];
        const f = async (url, init) => {
            const metodo = (init && init.method) || 'GET';
            llamadas.push({ metodo, ruta: url.replace('https://api.github.com/repos/o/r', ''), cuerpo: init && init.body ? JSON.parse(init.body) : null });
            if (metodo === 'GET') return JSON_(abiertos);
            if (url.endsWith('/issues') && metodo === 'POST') return JSON_({ number: 7 }, 201);
            if (url.endsWith('/labels')) return JSON_({}, 201);
            return JSON_({}, 200);
        };
        return { f, llamadas };
    }
    const deps = (g) => ({ fetch: g.f, repo: 'o/r', token: 't' });
    const informe = 'informe de prueba';
    const conFalla = { generado: 'hoy', resumen: { ok: 1, falla: 2, omitida: 0, aviso: 0 }, chequeos: [{ id: 'siga-areas', estado: 'falla' }, { id: 'marcia-sesion', estado: 'falla' }, { id: 'x', estado: 'ok' }] };
    const sinFalla = { generado: 'hoy', resumen: { ok: 1, falla: 0, omitida: 3, aviso: 1 }, chequeos: [{ id: 'x', estado: 'ok' }, { id: 'y', estado: 'omitida' }, { id: 'z', estado: 'aviso' }] };

    let g = github([]);
    let res = await I.sincronizar(deps(g), conFalla, informe);
    verificar('con fallas y sin issue abierto → lo abre, con etiqueta y las fallas en el título',
        res.accion === 'abierto' && res.numero === 7 && g.llamadas.some(l => l.metodo === 'POST' && l.ruta === '/issues' && l.cuerpo.labels[0] === 'monitor-integraciones' && /marcia-sesion, siga-areas/.test(l.cuerpo.title) && l.cuerpo.body.includes(I.MARCA) && l.cuerpo.body.includes(informe)));

    const abierto = { number: 7, body: I.cuerpoDelIssue('viejo', ['marcia-sesion', 'siga-areas']) };
    g = github([abierto]);
    res = await I.sincronizar(deps(g), conFalla, informe);
    verificar('con las mismas fallas → actualiza y NO comenta (sin ruido diario)',
        res.accion === 'actualizado' && g.llamadas.some(l => l.metodo === 'PATCH' && l.ruta === '/issues/7') && !g.llamadas.some(l => l.ruta.endsWith('/comments')));

    g = github([{ number: 7, body: I.cuerpoDelIssue('viejo', ['marcia-sesion']) }]);
    res = await I.sincronizar(deps(g), conFalla, informe);
    const com = g.llamadas.find(l => l.ruta === '/issues/7/comments');
    verificar('si cambia QUÉ falla → actualiza y comenta lo nuevo', res.accion === 'actualizado' && com && /Nuevas: `siga-areas`/.test(com.cuerpo.body));

    g = github([abierto]);
    res = await I.sincronizar(deps(g), sinFalla, informe);
    verificar('sin fallas y con issue abierto → comenta la recuperación y lo cierra',
        res.accion === 'cerrado' && g.llamadas.some(l => l.ruta === '/issues/7/comments' && /Recuperado/.test(l.cuerpo.body)) &&
        g.llamadas.some(l => l.metodo === 'PATCH' && l.cuerpo.state === 'closed' && l.cuerpo.state_reason === 'completed'));

    g = github([]);
    res = await I.sincronizar(deps(g), sinFalla, informe);
    verificar('omitidas y avisos, sin fallas, NO abren issue', res.accion === 'nada' && g.llamadas.every(l => l.metodo === 'GET'));

    g = github([{ number: 9, body: 'otro issue con la misma etiqueta', pull_request: undefined }, { number: 10, body: 'x', pull_request: {} }]);
    res = await I.sincronizar(deps(g), conFalla, informe);
    verificar('solo toma como suyo un issue con su marca (no cualquiera con la etiqueta)', res.accion === 'abierto');

    console.log('\n── Los workflows');
    const mon = leer('.github', 'workflows', 'monitor-integraciones.yml');
    const dep = leer('.github', 'workflows', 'desplegar-worker.yml');
    const toml = leer('docs', 'proxy', 'wrangler.toml');
    verificar('el monitor corre cada día y a mano', /schedule:\s*\n\s*- cron:/.test(mon) && /workflow_dispatch:/.test(mon));
    verificar('el monitor solo pide permiso para leer y para issues', /permissions:\s*\n\s*contents: read\s*\n\s*issues: write/.test(mon));
    verificar('el monitor lee los dos secretos opcionales y ninguno obligatorio',
        mon.includes('secrets.MONITOR_LICENCIA_CODIGO') && mon.includes('secrets.GEMINI_API_KEY') && !/secrets\.(?!MONITOR_LICENCIA_CODIGO|GEMINI_API_KEY|GITHUB_TOKEN)/.test(mon));
    verificar('el monitor agrega el certificado de Root YR para SISE',
        /NODE_EXTRA_CA_CERTS: \$\{\{ github\.workspace \}\}\/herramientas\/certificados\/root-yr-by-x1\.pem/.test(mon));
    verificar('el issue se maneja aunque el monitor falle, y el trabajo se pone en rojo al final',
        /continue-on-error: true/.test(mon) && /if: always\(\) && steps\.monitor\.outcome != 'skipped'/.test(mon) && /outcome == 'failure'/.test(mon));
    verificar('el monitor no corre en forks', mon.includes("github.repository == 'Jorch01/TSJ_Filing_online'"));

    const pasos = dep.split(/\n      - name: /).slice(1);
    const sinPuerta = pasos.filter(p => !/^(Checkout|¿Hay token de Cloudflare\?)/.test(p) && !/if: steps\.token\.outputs\.hay == 'true'/.test(p)).map(p => p.split('\n')[0]);
    igual('TODOS los pasos del despliegue (salvo el aviso) esperan a que exista CLOUDFLARE_API_TOKEN', sinPuerta, []);
    verificar('sin el token avisa y termina en verde (sin exit 1 en ese paso)',
        /if \[ -z "\$CLOUDFLARE_API_TOKEN" \]; then[\s\S]*?hay=false[\s\S]*?::notice[\s\S]*?else/.test(dep) && !/hay=false[^\n]*\n[^\n]*\n?[^\n]*exit 1/.test(dep.split('else')[0]));
    verificar('el token y el despliegue solo se leen de secrets.CLOUDFLARE_API_TOKEN', (dep.match(/secrets\.[A-Z_]+/g) || []).every(s => s === 'secrets.CLOUDFLARE_API_TOKEN'));
    verificar('despliega con wrangler fijo en una versión y conservando las variables', /wrangler@\d+\.\d+\.\d+ deploy --config "\$CONFIG" --keep-vars/.test(dep));
    verificar('antes de desplegar exige que exista CUOTA_SECRETO y el id del KV', dep.includes('CUOTA_SECRETO') && dep.includes('CUOTAS_KV_ID') && /secret list/.test(dep));
    verificar('después verifica /health contra WORKER_VERSION y exige cuotas', /verificar-worker\.js --intentos \d+ --espera \d+ --exigir-cuotas/.test(dep));
    verificar('solo despliega desde main y cuando cambia el Worker o su configuración',
        /branches: \[main\]/.test(dep) && dep.includes("'docs/proxy/impi-proxy-worker.js'") && dep.includes("'docs/proxy/wrangler.toml'"));
    verificar('wrangler.toml: el worker publicado, su código y el KV CUOTAS',
        /^name = "throbbing-scene-1c2b"/m.test(toml) && V.URL_WORKER.includes('throbbing-scene-1c2b') &&
        fs.existsSync(path.join(__dirname, 'docs', 'proxy', /^main = "([^"]+)"/m.exec(toml)[1])) &&
        /\[\[kv_namespaces\]\]\s*\nbinding = "CUOTAS"\s*\n(#[^\n]*\n)*id = "REEMPLAZAR_CON_CUOTAS_KV_ID"/.test(toml) && /^workers_dev = true/m.test(toml));
    verificar('el nombre del KV y del secreto que declara el toml son los que lee el Worker', WORKER.includes('env.CUOTAS') && WORKER.includes('env.CUOTA_SECRETO'));
    verificar('el repo no guarda el id del KV ni ningún secreto', !/^\s*(secret|CUOTA_SECRETO)\s*=/m.test(toml) && /REEMPLAZAR_CON_CUOTAS_KV_ID/.test(toml));
    verificar('el despliegue lo sustituye en la copia de trabajo, no en el repo', dep.includes('sed -i "s/REEMPLAZAR_CON_CUOTAS_KV_ID/$CUOTAS_KV_ID/"'));

    console.log('\n── El certificado de Root YR (SISE desde Node)');
    const pem = leer('herramientas', 'certificados', 'root-yr-by-x1.pem');
    const cert = new crypto.X509Certificate(pem);
    verificar('es Root YR firmado por ISRG Root X1', /CN=Root YR/.test(cert.subject) && /CN=ISRG Root X1/.test(cert.issuer), cert.subject + ' / ' + cert.issuer);
    igual('su huella SHA-256 es la publicada por Let\'s Encrypt', cert.fingerprint256, '07:26:39:D0:B1:40:D5:BF:FA:E1:6A:D9:C3:F6:CC:60:86:04:06:21:F5:1E:E6:1A:6D:46:A8:91:5C:07:CF:76');
    verificar('es un solo certificado público, sin llaves privadas', (pem.match(/BEGIN CERTIFICATE/g) || []).length === 1 && !/PRIVATE KEY/.test(pem));

    console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
    if (fallos.length) {
        console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
        process.exit(1);
    }
})();
