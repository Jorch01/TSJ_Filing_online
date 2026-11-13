#!/usr/bin/env node
/**
 * Pruebas del verificador de viabilidad de marca del sitio público (empirica.mx)
 * en el Worker (docs/proxy/impi-proxy-worker.js, sección SITIO PÚBLICO).
 *
 *   node test_viabilidad_sitio.js
 *
 * Lo que se fija aquí:
 *   - CORS: el sitio (con y sin www) y la app pueden llamar; cualquier otro origen, no;
 *   - el estudio del sitio pide Turnstile, cuenta 1 al mes por IP y no se
 *     concede si falta el secreto, el KV o el origen;
 *   - un intento con Turnstile fallido no gasta el estudio;
 *   - el pase del sitio solo abre las 3 búsquedas del estudio y solo desde el
 *     sitio; no abre las rutas de la app ni las sesiones de tribunales;
 *   - la app sigue igual: sus pases, su CORS y sus rutas no cambian;
 *   - la caché corta es solo del sitio, repite lo idéntico sin volver al IMPI y
 *     nunca guarda vacíos ni errores.
 */

const fs = require('fs');
const os = require('os');
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

// ---------------------------------------------------------------- unidades (las secciones, en un contexto aislado)
const seccion = (a, b) => FUENTE.slice(FUENTE.indexOf(a), FUENTE.indexOf(b));
const W = { crypto: globalThis.crypto, TextEncoder, btoa, atob, escape, decodeURIComponent, encodeURIComponent, JSON, Math, Date, Promise, String, parseInt, Uint8Array, Object, Array };
vm.createContext(W);
vm.runInContext("const CUOTA_HEADER = 'X-TSJ-Cuota';\n" +
    seccion('// ==================== CUOTAS (INICIO)', '// ==================== SITIO PÚBLICO (FIN)') + '// ==================== SITIO PÚBLICO (FIN)' +
    '\nthis.atenderCuotaSitio = atenderCuotaSitio; this.atenderCuota = atenderCuota; this.verificarTurnstile = verificarTurnstile;' +
    ' this.respuestaCacheable = respuestaCacheable; this.esRutaCacheableSitio = esRutaCacheableSitio; this.paseSitioValido = paseSitioValido;' +
    ' this.revisarPase = revisarPase; this.leerPase = leerPase; this.crearPase = crearPase; this.CUOTAS = CUOTAS; this.SITIO_ORIGINS = SITIO_ORIGINS;', W);

function kv() {
    const m = new Map();
    return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } };
}
const SECRETO = 'secreto-de-prueba-largo';
const envCompleto = () => ({ CUOTAS: kv(), CUOTA_SECRETO: SECRETO, TURNSTILE_SECRET: 'turnstile-secreto' });
const SITIO = 'https://empirica.mx';
const SITIO_WWW = 'https://www.empirica.mx';
const MES1 = Date.parse('2026-11-15T12:00:00Z');
const MES2 = Date.parse('2026-12-02T12:00:00Z');

// Turnstile simulado: acepta el token "bueno" y guarda lo que se le mandó.
function turnstile() {
    const llamadas = [];
    const consultar = async (url, opts) => {
        llamadas.push({ url, opts });
        const bueno = /response=token-bueno(&|$)/.test(opts.body);
        return { json: async () => ({ success: bueno, 'error-codes': bueno ? [] : ['invalid-input-response'] }) };
    };
    consultar.llamadas = llamadas;
    return consultar;
}
const peticion = (pase, origen) => ({ headers: { get: (h) => (h === 'X-TSJ-Cuota' ? pase : h === 'Origin' ? origen : null) } });

(async () => {
    console.log('\nEl estudio del sitio: Turnstile y 1 al mes por IP');
    {
        const e = envCompleto(), t = turnstile();
        const pedir = (ip, origen, token, ahora) => W.atenderCuotaSitio(e, ip, origen, { tipo: 'viabilidad_sitio', turnstile: token }, ahora || MES1, t);
        igual('la cuota del sitio es 1 al mes', [W.CUOTAS.viabilidad_sitio.limite, W.CUOTAS.viabilidad_sitio.periodo], [1, 'mes']);
        const primero = await pedir('1.1.1.1', SITIO, 'token-bueno');
        igual('el primero se permite y cuenta 1 de 1', [primero.status, primero.datos.permitido, primero.datos.usados, primero.datos.limite], [200, true, 1, 1]);
        verificar('trae un pase firmado', typeof primero.datos.pase === 'string' && primero.datos.pase.includes('.'));
        const pase = await W.leerPase(SECRETO, primero.datos.pase, MES1 + 60000);
        igual('el pase es del tipo del sitio y dura 30 minutos', [pase && pase.t, pase && pase.e - MES1], ['viabilidad_sitio', 30 * 60 * 1000]);
        const segundo = await pedir('1.1.1.1', SITIO, 'token-bueno');
        igual('el segundo del mes, desde la misma IP, no', [segundo.status, segundo.datos.permitido, segundo.datos.usados, segundo.datos.pase], [200, false, 1, undefined]);
        igual('tampoco entrando por www', (await pedir('1.1.1.1', SITIO_WWW, 'token-bueno')).datos.permitido, false);
        igual('otra IP tiene su propio estudio', (await pedir('2.2.2.2', SITIO, 'token-bueno')).datos.permitido, true);
        igual('el mes siguiente se vuelve a poder', (await pedir('1.1.1.1', SITIO, 'token-bueno', MES2)).datos.usados, 1);
        const llamada = t.llamadas[0];
        verificar('se verifica con el secreto, el token y la IP, por POST a Cloudflare',
            llamada.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && llamada.opts.method === 'POST' &&
            llamada.opts.body === 'secret=turnstile-secreto&response=token-bueno&remoteip=1.1.1.1', llamada.opts.body);
        verificar('la IP no se guarda en claro en el KV', [...e.CUOTAS.m.keys()].every(k => !k.includes('1.1.1.1')), [...e.CUOTAS.m.keys()].join(', '));
    }

    {
        const e = envCompleto(), t = turnstile();
        const pedir = (token) => W.atenderCuotaSitio(e, '3.3.3.3', SITIO, { tipo: 'viabilidad_sitio', turnstile: token }, MES1, t);
        const malo = await pedir('token-malo');
        igual('con Turnstile fallido: 403 y sin pase', [malo.status, malo.datos.turnstile, malo.datos.pase], [403, false, undefined]);
        igual('sin token: 403', (await pedir(undefined)).status, 403);
        igual('con token enorme: 403 sin consultar a Cloudflare (solo el token malo lo hizo)', [(await pedir('x'.repeat(3000))).status, t.llamadas.length], [403, 1]);
        verificar('los intentos fallidos no gastan el estudio', e.CUOTAS.m.size === 0);
        igual('y después uno bueno sí se permite', (await pedir('token-bueno')).datos.permitido, true);
    }

    {
        const t = turnstile();
        const sinSecreto = { CUOTAS: kv(), CUOTA_SECRETO: SECRETO };
        igual('sin TURNSTILE_SECRET: apagado (503), no se concede nada',
            (await W.atenderCuotaSitio(sinSecreto, '1.1.1.1', SITIO, { turnstile: 'token-bueno' }, MES1, t)).status, 503);
        const sinKV = { TURNSTILE_SECRET: 'x' };
        igual('sin KV ni secreto de cuotas: apagado (503)',
            (await W.atenderCuotaSitio(sinKV, '1.1.1.1', SITIO, { turnstile: 'token-bueno' }, MES1, t)).status, 503);
        const e = envCompleto();
        igual('desde otro origen: 403', (await W.atenderCuotaSitio(e, '1.1.1.1', 'https://tsjia.empirica.mx', { turnstile: 'token-bueno' }, MES1, t)).status, 403);
        igual('sin Origin (curl): 403', (await W.atenderCuotaSitio(e, '1.1.1.1', '', { turnstile: 'token-bueno' }, MES1, t)).status, 403);
        igual('sin IP no se puede contar: 400', (await W.atenderCuotaSitio(e, '', SITIO, { turnstile: 'token-bueno' }, MES1, t)).status, 400);
        const caida = async () => { throw new Error('sin red'); };
        igual('si Cloudflare no responde, no se concede (403)', (await W.atenderCuotaSitio(e, '1.1.1.1', SITIO, { turnstile: 'token-bueno' }, MES1, caida)).status, 403);
        igual('el camino general de la app no concede el tipo del sitio',
            (await W.atenderCuota(e, '1.1.1.1', { tipo: 'viabilidad_sitio', huella: { amplia: 'a' } }, MES1, async () => { throw new Error('no'); })).status, 400);
    }

    console.log('\nEl pase del sitio solo abre lo del estudio, y solo desde el sitio');
    {
        const e = envCompleto();
        const paseSitio = await W.crearPase(SECRETO, 'viabilidad_sitio', false, Date.now());
        const paseApp = await W.crearPase(SECRETO, 'viabilidad', false, Date.now());
        for (const ruta of ['/marcia/search', '/siga/search', '/marcanet/fonetica']) {
            igual('pase del sitio + origen del sitio abre ' + ruta, await W.revisarPase(e, ruta, peticion(paseSitio, SITIO), Date.now()), null);
        }
        igual('desde www también', await W.revisarPase(e, '/siga/search', peticion(paseSitio, SITIO_WWW), Date.now()), null);
        for (const ruta of ['/marcanet/titular', '/marcanet/expediente', '/marcanet/registro']) {
            verificar('no abre ' + ruta, typeof await W.revisarPase(e, ruta, peticion(paseSitio, SITIO), Date.now()) === 'string');
        }
        verificar('desde la app no sirve', typeof await W.revisarPase(e, '/siga/search', peticion(paseSitio, 'https://tsjia.empirica.mx'), Date.now()) === 'string');
        verificar('sin Origin (curl) no sirve', typeof await W.revisarPase(e, '/siga/search', peticion(paseSitio, ''), Date.now()) === 'string');
        igual('el pase de la app sigue abriendo sus rutas, como antes', await W.revisarPase(e, '/marcanet/titular', peticion(paseApp, 'https://tsjia.empirica.mx'), Date.now()), null);
        verificar('sin pase, nada', typeof await W.revisarPase(e, '/siga/search', peticion(null, SITIO), Date.now()) === 'string');
        igual('con las cuotas apagadas, el comportamiento anterior', await W.revisarPase({}, '/siga/search', peticion(null, SITIO), Date.now()), null);
    }

    console.log('\nQué se recuerda en la caché corta');
    {
        igual('fonética, SIGA y ficha de Marcanet, por POST', ['/marcanet/fonetica', '/siga/search', '/marcanet/full-detail'].map(p => W.esRutaCacheableSitio(p, 'POST')), [true, true, true]);
        igual('la ficha de MARCia, por GET', W.esRutaCacheableSitio('/marcia/view/RM202300012345', 'GET'), true);
        igual('las búsquedas de MARCia (con sesión) no', [W.esRutaCacheableSitio('/marcia/search', 'POST'), W.esRutaCacheableSitio('/marcia/results', 'POST'), W.esRutaCacheableSitio('/marcia/csrf', 'GET')], [false, false, false]);
        igual('ni las otras rutas', [W.esRutaCacheableSitio('/api/sesiones', 'GET'), W.esRutaCacheableSitio('/cuota', 'POST'), W.esRutaCacheableSitio('/marcanet/titular', 'POST')], [false, false, false]);
        igual('fonética con resultados, sí', W.respuestaCacheable('/marcanet/fonetica', { results: [{ a: 1 }] }), true);
        igual('fonética vacía, no', W.respuestaCacheable('/marcanet/fonetica', { results: [] }), false);
        igual('fonética que devolvió el formulario, no', W.respuestaCacheable('/marcanet/fonetica', { isFormPage: true, results: [{ a: 1 }] }), false);
        igual('SIGA bien, sí (aunque no encuentre nada)', W.respuestaCacheable('/siga/search', { successed: true, data: [] }), true);
        igual('SIGA que rechazó, no', W.respuestaCacheable('/siga/search', { successed: false, data: [] }), false);
        igual('ficha de Marcanet sin detalle, no', W.respuestaCacheable('/marcanet/full-detail', { detail: null }), false);
        igual('ficha de MARCia con error, no', W.respuestaCacheable('/marcia/view/RM1', { error: 'No active session' }), false);
        igual('ficha de MARCia con datos, sí', W.respuestaCacheable('/marcia/view/RM1', { markId: 'RM1' }), true);
    }

    // ---------------------------------------------------------------- el Worker completo (el router)
    const archivo = path.join(os.tmpdir(), 'worker-sitio-prueba-' + process.pid + '.mjs');
    fs.writeFileSync(archivo, FUENTE);
    const worker = (await import('file://' + archivo)).default;
    fs.unlinkSync(archivo);

    // fetch simulado: Turnstile y SIGA; cuenta cuántas veces se fue al IMPI.
    let sigaConsultas = 0, sigaRespuesta = { successed: true, data: [{ fichaId: 1, denominacion: 'LUNA' }] };
    const respuesta = (cuerpo, status) => ({
        ok: (status || 200) < 400, status: status || 200,
        headers: { get: () => null, getSetCookie: () => ['XSRF-TOKEN=tok123; path=/'] },
        json: async () => cuerpo, text: async () => JSON.stringify(cuerpo)
    });
    globalThis.fetch = async (url, opts) => {
        const u = String(url);
        if (u.indexOf('challenges.cloudflare.com') >= 0) {
            return respuesta({ success: /response=token-bueno(&|$)/.test(String(opts.body)) });
        }
        if (u.indexOf('/antiforgery/token') >= 0) return respuesta({});
        if (u.indexOf('/api/BusquedaFicha/GetFichas') >= 0) { sigaConsultas++; return respuesta(sigaRespuesta); }
        throw new Error('fetch inesperado: ' + u);
    };
    const almacen = new Map();
    globalThis.caches = { default: {
        match: async (req) => (almacen.has(req.url) ? new Response(almacen.get(req.url), { status: 200 }) : undefined),
        put: async (req, res) => { almacen.set(req.url, await res.text()); }
    } };
    const ctx = { waitUntil: (p) => p };
    const env = envCompleto();
    const llamar = (ruta, { origen, metodo, cuerpo, pase, ip } = {}) => worker.fetch(new Request('https://proxy.test' + ruta, {
        method: metodo || 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '8.8.8.8' },
            origen ? { Origin: origen } : {}, pase ? { 'X-TSJ-Cuota': pase } : {}),
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
    }), env, ctx);
    const json = async (r) => { try { return await r.json(); } catch (e) { return null; } };

    console.log('\nCORS y orígenes');
    {
        for (const o of [SITIO, SITIO_WWW, 'https://tsjia.empirica.mx', 'https://jorch01.github.io']) {
            const r = await llamar('/cuota', { origen: o, metodo: 'OPTIONS' });
            igual('preflight desde ' + o, [r.status, r.headers.get('Access-Control-Allow-Origin')], [204, o]);
        }
        const ajeno = await llamar('/cuota', { origen: 'https://sitio-ajeno.com', metodo: 'OPTIONS' });
        igual('preflight desde un sitio ajeno: sin permiso', ajeno.headers.get('Access-Control-Allow-Origin'), '');
        igual('petición desde un sitio ajeno: 403', (await llamar('/health', { origen: 'https://sitio-ajeno.com' })).status, 403);
        igual('un origen que solo empieza igual no pasa', (await llamar('/health', { origen: 'https://empirica.mx.ajeno.com' })).status, 403);
        const h = await json(await llamar('/health', { origen: SITIO }));
        igual('/health desde el sitio: ok y dice si Turnstile está configurado', [h.status, h.cuotas, h.sitio.turnstile], ['ok', true, true]);
        const h2 = await json(await new Promise(async (res) => res(await worker.fetch(new Request('https://proxy.test/health'), { CUOTAS: kv(), CUOTA_SECRETO: 'x' }, ctx))));
        igual('sin el secreto de Turnstile, /health lo avisa', h2.sitio.turnstile, false);
    }

    console.log('\nEl estudio del sitio por el Worker completo');
    let paseSitio;
    {
        const r = await llamar('/cuota', { origen: SITIO, metodo: 'POST', cuerpo: { tipo: 'viabilidad_sitio', turnstile: 'token-bueno' }, ip: '5.5.5.5' });
        const d = await json(r);
        igual('con Turnstile bueno: 200, permitido, CORS del sitio', [r.status, d.permitido, r.headers.get('Access-Control-Allow-Origin')], [200, true, SITIO]);
        paseSitio = d.pase;
        const otra = await json(await llamar('/cuota', { origen: SITIO, metodo: 'POST', cuerpo: { tipo: 'viabilidad_sitio', turnstile: 'token-bueno' }, ip: '5.5.5.5' }));
        igual('el segundo del mes desde esa IP: no', [otra.permitido, otra.usados, otra.limite], [false, 1, 1]);
        const malo = await llamar('/cuota', { origen: SITIO, metodo: 'POST', cuerpo: { tipo: 'viabilidad_sitio', turnstile: 'token-malo' }, ip: '6.6.6.6' });
        igual('con Turnstile malo: 403', malo.status, 403);
        const sinOrigen = await llamar('/cuota', { metodo: 'POST', cuerpo: { tipo: 'viabilidad_sitio', turnstile: 'token-bueno' }, ip: '7.7.7.7' });
        igual('sin Origin: 403', sinOrigen.status, 403);
        const app = await json(await llamar('/cuota', { origen: 'https://tsjia.empirica.mx', metodo: 'POST', cuerpo: { tipo: 'busqueda', huella: { amplia: 'x' }, dispositivo: 'd1' }, ip: '9.9.9.9' }));
        igual('la app sigue pidiendo su cuota como antes', [app.servidor, app.permitido, app.usados, app.limite], [true, true, 1, 5]);
        const intruso = await llamar('/cuota', { origen: 'https://tsjia.empirica.mx', metodo: 'POST', cuerpo: { tipo: 'viabilidad_sitio', turnstile: 'token-bueno' }, ip: '9.9.9.9' });
        igual('y la app no puede pedir el estudio del sitio', intruso.status, 403);
    }

    console.log('\nEl pase del sitio en las rutas del IMPI');
    {
        const titular = await llamar('/marcanet/titular', { origen: SITIO, metodo: 'POST', cuerpo: { titular: 'X' }, pase: paseSitio });
        igual('/marcanet/titular con pase del sitio: 402 (no es del estudio)', titular.status, 402);
        const desdeApp = await llamar('/siga/search', { origen: 'https://tsjia.empirica.mx', metodo: 'POST', cuerpo: { Busqueda: 'LUNA' }, pase: paseSitio });
        igual('/siga/search con pase del sitio pero desde la app: 402', desdeApp.status, 402);
        const sesiones = await llamar('/api/sesiones', { origen: SITIO, pase: paseSitio });
        const ds = await json(sesiones);
        igual('el pase del sitio no abre las sesiones de tribunales (Premium)', [sesiones.status, ds && ds.premium], [402, true]);
        const sinPase = await llamar('/siga/search', { origen: SITIO, metodo: 'POST', cuerpo: { Busqueda: 'LUNA' } });
        igual('sin pase: 402', sinPase.status, 402);
    }

    console.log('\nCaché corta');
    {
        sigaConsultas = 0;
        const buscar = (cuerpo, o) => llamar('/siga/search', Object.assign({ origen: SITIO, metodo: 'POST', cuerpo, pase: paseSitio }, o || {}));
        const r1 = await buscar({ Busqueda: 'LUNA' });
        const d1 = await json(r1);
        igual('la primera va al IMPI', [r1.status, d1.successed, sigaConsultas, r1.headers.get('X-Cache')], [200, true, 1, null]);
        const r2 = await buscar({ Busqueda: 'LUNA' });
        const d2 = await json(r2);
        igual('la idéntica sale de la caché, sin volver al IMPI', [r2.status, r2.headers.get('X-Cache'), sigaConsultas, JSON.stringify(d2) === JSON.stringify(d1)], [200, 'HIT', 1, true]);
        verificar('con los encabezados CORS del sitio', r2.headers.get('Access-Control-Allow-Origin') === SITIO);
        const r3 = await buscar({ Busqueda: 'SOL' });
        igual('otra denominación no usa la caché', [r3.headers.get('X-Cache'), sigaConsultas], [null, 2]);
        const r4 = await buscar({ Busqueda: 'LUNA' }, { origen: SITIO_WWW });
        igual('desde www se comparte la caché', [r4.headers.get('X-Cache'), sigaConsultas], ['HIT', 2]);
        // la app no usa la caché: sus búsquedas siguen siendo en vivo
        const paseApp = (await json(await llamar('/cuota', { origen: 'https://tsjia.empirica.mx', metodo: 'POST', cuerpo: { tipo: 'busqueda', huella: { amplia: 'z' }, dispositivo: 'd2' }, ip: '4.4.4.4' }))).pase;
        const app1 = await llamar('/siga/search', { origen: 'https://tsjia.empirica.mx', metodo: 'POST', cuerpo: { Busqueda: 'LUNA' }, pase: paseApp });
        const app2 = await llamar('/siga/search', { origen: 'https://tsjia.empirica.mx', metodo: 'POST', cuerpo: { Busqueda: 'LUNA' }, pase: paseApp });
        igual('la app no usa la caché: va al IMPI las dos veces', [app1.status, app2.status, app2.headers.get('X-Cache'), sigaConsultas], [200, 200, null, 4]);
        // lo que falla no se recuerda
        sigaRespuesta = { successed: false, message: 'SIGA rechazó la búsqueda', data: [] };
        sigaConsultas = 0;
        await buscar({ Busqueda: 'FALLA' }); await buscar({ Busqueda: 'FALLA' });
        igual('un rechazo de SIGA no se guarda: las dos van al IMPI', sigaConsultas, 2);
    }

    try { fs.unlinkSync(archivo); } catch (e) { /* ya borrado */ }
    console.log('\n' + pasadas + ' pasadas, ' + fallos.length + ' fallidas');
    if (fallos.length) { console.log('\nFallaron:\n  - ' + fallos.join('\n  - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
