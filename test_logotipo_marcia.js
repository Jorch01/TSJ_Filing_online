#!/usr/bin/env node
/**
 * La búsqueda por logotipo de MARCia en el proxy (docs/proxy/impi-proxy-worker.js):
 *
 *   node test_logotipo_marcia.js
 *
 * Lo que se fija aquí:
 *   - /marcia/imagen sube a MARCia solo imágenes de verdad (PNG, JPG, GIF o
 *     BMP por sus primeros bytes, hasta 5 MB), en un formulario nuevo con el
 *     campo «files», con el token y las cookies de la sesión del cliente;
 *   - lo que responde MARCia se reduce a { imagenes: [{ id, width, height,
 *     autoSegmentCrop }] }; su 404 (sin sesión) se vuelve «No active session»
 *     para que la app la rehaga, y su 500 vacío, un mensaje que se entiende;
 *   - la subida es una búsqueda nueva: pide pase, y el del sitio público no sirve;
 *   - /marcia/csrf dice la fecha de indexación que declara MARCia;
 *   - /marcia/miniatura/{id} trae la imagen de una marca (para el PDF) solo
 *     con un id de marca válido y solo si lo que llega es una imagen.
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
const MARCIA = 'https://marcia.impi.gob.mx';
const APP = 'https://tsjia.empirica.mx';

// Imágenes mínimas: solo importan sus primeros bytes.
const PNG = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4]);
const JPG = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
const BMP = Uint8Array.from([0x42, 0x4D, 70, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 36, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const TEXTO = new TextEncoder().encode('esto no es una imagen, aunque se llame logo.png');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');

// La respuesta real de MARCia al subir (revisada en su sitio).
const SUBIDA_REAL = [{
    id: '5969cfc2-f555-4f53-aac6-f7bc6620077d', width: 400, height: 400,
    autoSegmentCrop: { mode: 1, polygon: [[46, 46], [355, 46], [355, 355], [46, 355], [46, 46]] },
    autoSegmentLasso: null
}];
// La página de MARCia, recortada: lo que lee /marcia/csrf.
const HTML_MARCIA = '<!DOCTYPE html><html><head><meta name="_csrf_header" content="X-XSRF-TOKEN"/>' +
    '<meta name="_csrf" content="0b5c1d2e-1111-2222-3333-444455556666"/></head><body><div id="vue-app"></div>' +
    "<script>\nwindow.VARS = {\nbaseUrl: '/marcas',\ncdnUrl: 'https://prod.impi.static.tmv.io/lm/tmimage_trim96/MX/',\n" +
    "appMode: 'DEFAULT',\ndeploymentEnvironment: 'prod',\nlastIndexingDate: '02 Feb 2020',\n};\n</script></body></html>";

// ---------------------------------------------------------------- la sección, en un contexto aislado
console.log('\nLa sección LOGOTIPO MARCia');
const W = { Uint8Array, Array, Math, Number, String, isFinite };
vm.createContext(W);
vm.runInContext(FUENTE.slice(FUENTE.indexOf('// ==================== LOGOTIPO MARCia (INICIO)'), FUENTE.indexOf('// ==================== LOGOTIPO MARCia (FIN)')) +
    '\nthis.formatoDeImagen = formatoDeImagen; this.revisarImagen = revisarImagen; this.segmentoValido = segmentoValido;' +
    ' this.leerSubidaImagen = leerSubidaImagen; this.fechaIndexacion = fechaIndexacion; this.tipoDeMiniatura = tipoDeMiniatura;' +
    ' this.IMAGEN_MAX_BYTES = IMAGEN_MAX_BYTES; this.ID_MARCA_RE = ID_MARCA_RE;', W);
{
    const tipo = (b) => { const f = W.formatoDeImagen(b); return f ? f.tipo : null; };
    igual('reconoce PNG, JPG, GIF y BMP por sus primeros bytes', [tipo(PNG), tipo(JPG), tipo(GIF), tipo(BMP)], ['image/png', 'image/jpeg', 'image/gif', 'image/bmp']);
    igual('WEBP y SVG no (MARCia les da error 500)', [tipo(WEBP), tipo(SVG)], [null, null]);
    igual('ni un texto ni nada', [tipo(TEXTO), tipo(new Uint8Array(0)), tipo(null)], [null, null, null]);
    igual('sin imagen: 400', W.revisarImagen(new Uint8Array(0)).status, 400);
    const grande = new Uint8Array(W.IMAGEN_MAX_BYTES + 1); grande.set(PNG);
    igual('más de 5 MB: 413, aunque sea PNG', [W.IMAGEN_MAX_BYTES, W.revisarImagen(grande).status], [5 * 1024 * 1024, 413]);
    igual('un texto con nombre de .png: 415', W.revisarImagen(TEXTO).status, 415);
    verificar('el mensaje dice qué formatos sirven', /PNG, JPG, GIF o BMP/.test(W.revisarImagen(TEXTO).error));
    igual('un PNG pasa, con su extensión', W.revisarImagen(PNG).formato.ext, 'png');

    igual('el recorte de MARCia es válido', W.segmentoValido(SUBIDA_REAL[0].autoSegmentCrop), true);
    igual('un lazo (mode 0) también', W.segmentoValido({ mode: 0, polygon: [[1, 1], [5, 1], [3, 4]] }), true);
    igual('recortes raros, no', [
        W.segmentoValido(null), W.segmentoValido({ mode: 2, polygon: [[0, 0], [1, 0], [1, 1]] }),
        W.segmentoValido({ mode: 1, polygon: [[0, 0], [1, 0]] }), W.segmentoValido({ mode: 1, polygon: [[0, 0], [1, 'x'], [1, 1]] }),
        W.segmentoValido({ mode: 1, polygon: [[0, 0], [-1, 0], [1, 1]] }), W.segmentoValido({ mode: 1, polygon: 'nada' })
    ], [false, false, false, false, false, false]);

    igual('la respuesta real se reduce a lo que sirve', JSON.parse(JSON.stringify(W.leerSubidaImagen(SUBIDA_REAL))), [{
        id: '5969cfc2-f555-4f53-aac6-f7bc6620077d', width: 400, height: 400,
        autoSegmentCrop: { mode: 1, polygon: [[46, 46], [355, 46], [355, 355], [46, 355], [46, 46]] }
    }]);
    igual('sin recorte válido, queda en null (la app usa la imagen completa)',
        W.leerSubidaImagen([{ id: 'abc', width: 10, height: 20, autoSegmentCrop: { mode: 1 } }])[0].autoSegmentCrop, null);
    igual('respuestas que no sirven: null', [
        W.leerSubidaImagen(null), W.leerSubidaImagen({ id: 'x' }), W.leerSubidaImagen([]),
        W.leerSubidaImagen([{ id: 'con espacios y "comillas"' }]), W.leerSubidaImagen([{ id: 42 }])
    ], [null, null, null, null, null]);

    igual('la fecha de indexación que declara la página', W.fechaIndexacion(HTML_MARCIA), '02 Feb 2020');
    igual('con comillas dobles también', W.fechaIndexacion('lastIndexingDate: "15 Mar 2026",'), '15 Mar 2026');
    igual('sin la fecha: null', [W.fechaIndexacion('<html></html>'), W.fechaIndexacion(null), W.fechaIndexacion("lastIndexingDate: '<script>'")], [null, null, null]);

    igual('ids de marca válidos', ['RM202002404330', 'RM1999', 'AC20200001'].map(x => W.ID_MARCA_RE.test(x)), [true, true, true]);
    igual('ids que no', ['rm202002404330', 'RM', '../RM1234', 'RM1234/../x', 'RM1234?x=1', 'https://otro.com/RM1234', 'RM12%2F34'].map(x => W.ID_MARCA_RE.test(x)), [false, false, false, false, false, false, false]);
    igual('el tipo de la miniatura: el declarado si es de imagen', W.tipoDeMiniatura('image/jpeg; charset=binary', PNG), 'image/jpeg');
    igual('si no, por sus bytes', [W.tipoDeMiniatura('application/octet-stream', PNG), W.tipoDeMiniatura('', WEBP)], ['image/png', 'image/webp']);
    igual('una página HTML no es miniatura', W.tipoDeMiniatura('text/html', new TextEncoder().encode('<html>error</html>')), null);
}

// ---------------------------------------------------------------- el Worker completo (el router)
function kv() {
    const m = new Map();
    return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } };
}

(async () => {
    const archivo = path.join(os.tmpdir(), 'worker-logotipo-prueba-' + process.pid + '.mjs');
    fs.writeFileSync(archivo, FUENTE);
    const worker = (await import('file://' + archivo)).default;
    fs.unlinkSync(archivo);

    // MARCia simulada. «subida» decide qué responde el upload.
    const llamadas = [];
    let subida = () => new Response(JSON.stringify(SUBIDA_REAL), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'SESSION=rotada; Path=/marcas' } });
    let miniatura = () => new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
    globalThis.fetch = async (url, opts) => {
        const u = String(url);
        llamadas.push({ url: u, opts: opts || {} });
        if (u.indexOf('challenges.cloudflare.com') >= 0) {
            return new Response(JSON.stringify({ success: /response=token-bueno(&|$)/.test(String(opts.body)) }), { status: 200 });
        }
        if (u === MARCIA + '/marcas/search/quick') {
            return new Response(HTML_MARCIA, { status: 200, headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'SESSION=abc123; Path=/marcas; HttpOnly' } });
        }
        if (u === MARCIA + '/marcas/search/internal/image/upload/bulk') return subida(opts);
        if (u.indexOf(MARCIA + '/marcas/image/') === 0) return miniatura(u);
        throw new Error('fetch inesperado: ' + u);
    };
    const ctx = { waitUntil: (p) => p };
    const sinCuotas = {};
    const pedir = (ruta, { metodo, cuerpo, sesion, pase, origen, env, cabeceras } = {}) => worker.fetch(new Request('https://proxy.test' + ruta, {
        method: metodo || 'GET',
        headers: Object.assign({ Origin: origen || APP, 'X-IMPI-Client': 'cliente-de-prueba-1' },
            sesion ? { 'X-IMPI-Session': sesion } : {}, pase ? { 'X-TSJ-Cuota': pase } : {}, cabeceras || {}),
        body: cuerpo
    }), env || sinCuotas, ctx);
    const formulario = (bytes, nombre, tipo, campo) => {
        const f = new FormData();
        f.append(campo || 'files', new Blob([bytes], { type: tipo || 'image/png' }), nombre || 'mi logo.png');
        return f;
    };
    const json = async (r) => { try { return await r.json(); } catch (e) { return null; } };

    console.log('\n/health y /marcia/csrf');
    let sesion;
    {
        const h = await json(await pedir('/health'));
        igual('la versión nueva del worker', h.version, '2026-11-22-logotipo-marcia');
        verificar('anuncia la búsqueda por logotipo', h.services.includes('marcia-logotipo'), JSON.stringify(h.services));
        const r = await pedir('/marcia/csrf');
        const d = await json(r);
        sesion = r.headers.get('X-IMPI-Session');
        igual('/marcia/csrf: 200, sesión y la fecha de indexación', [r.status, d.sessionActive, d.indexacion, !!sesion], [200, true, '02 Feb 2020', true]);
        verificar('la cabecera de la sesión se puede leer desde la app (CORS)', /X-IMPI-Session/.test(r.headers.get('Access-Control-Expose-Headers') || ''));
    }

    console.log('\nSubir el logotipo');
    {
        llamadas.length = 0;
        // Otro navegador: el proxy guarda en memoria la sesión de cada cliente
        // como respaldo, así que «sin sesión» es un cliente que no la abrió.
        const sin = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG), cabeceras: { 'X-IMPI-Client': 'cliente-sin-sesion-2' } });
        igual('sin sesión: 401 «No active session» (la app la rehace)', [sin.status, /No active session/.test((await json(sin)).error)], [401, true]);
        igual('y no se llama a MARCia', llamadas.length, 0);

        const r = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG, 'Logotipo de mi cliente.png'), sesion });
        const d = await json(r);
        igual('con sesión y un PNG: 200 con la imagen subida', [r.status, d.imagenes.length, d.imagenes[0].id, d.imagenes[0].width, d.imagenes[0].autoSegmentCrop.mode],
            [200, 1, '5969cfc2-f555-4f53-aac6-f7bc6620077d', 400, 1]);
        igual('no pasa autoSegmentLasso ni nada más', Object.keys(d.imagenes[0]).sort(), ['autoSegmentCrop', 'height', 'id', 'width']);
        verificar('devuelve la sesión con la cookie que rotó MARCia', (() => {
            const t = r.headers.get('X-IMPI-Session');
            try { return JSON.parse(Buffer.from(t, 'base64').toString('utf8')).k.indexOf('SESSION=rotada') >= 0; } catch (e) { return false; }
        })());
        const subidas = llamadas.filter(l => l.url.indexOf('/upload/bulk') > 0);
        igual('una sola llamada a upload/bulk, por POST', [subidas.length, subidas[0] && subidas[0].opts.method], [1, 'POST']);
        const h = (subidas[0] && subidas[0].opts.headers) || {};
        igual('con el token y la cookie de la sesión', [h['X-XSRF-TOKEN'], /SESSION=abc123/.test(h.Cookie || '')], ['0b5c1d2e-1111-2222-3333-444455556666', true]);
        igual('y el Origin y Referer de MARCia', [h.Origin, h.Referer], [MARCIA, MARCIA + '/marcas/search/quick']);
        verificar('sin Content-Type propio (el boundary lo pone fetch)', !Object.keys(h).some(k => k.toLowerCase() === 'content-type'), JSON.stringify(Object.keys(h)));
        const cuerpo = subidas[0] && subidas[0].opts.body;
        const enviado = cuerpo && typeof cuerpo.get === 'function' ? cuerpo.get('files') : null;
        verificar('el cuerpo es un formulario con el campo «files»', !!enviado && typeof enviado.arrayBuffer === 'function');
        const campos = cuerpo && typeof cuerpo.keys === 'function' ? Array.from(cuerpo.keys()) : [];
        igual('y nada más', campos, ['files']);
        if (enviado) {
            igual('con un nombre neutro y el tipo real', [enviado.name, enviado.type], ['logotipo.png', 'image/png']);
            igual('y los mismos bytes', Array.from(new Uint8Array(await enviado.arrayBuffer())), Array.from(PNG));
        }

        llamadas.length = 0;
        const jpg = await json(await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(JPG, 'foto.jpeg', 'image/jpeg'), sesion }));
        verificar('un JPG también se sube', jpg && jpg.imagenes && jpg.imagenes.length === 1);
        const enviadoJpg = llamadas[0] && llamadas[0].opts.body.get('files');
        igual('como logotipo.jpg', enviadoJpg && [enviadoJpg.name, enviadoJpg.type], ['logotipo.jpg', 'image/jpeg']);
        llamadas.length = 0;
        const dicePng = await json(await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(GIF, 'x.png', 'image/png'), sesion }));
        const enviadoGif = llamadas[0] && llamadas[0].opts.body.get('files');
        igual('el tipo sale de los bytes, no de lo que declara el navegador', [!!dicePng.imagenes, enviadoGif && enviadoGif.type], [true, 'image/gif']);
    }

    console.log('\nLo que no se sube');
    {
        llamadas.length = 0;
        const texto = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(TEXTO, 'logo.png'), sesion });
        igual('un texto con nombre de .png: 415', texto.status, 415);
        const webp = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(WEBP, 'logo.webp', 'image/webp'), sesion });
        igual('un WEBP: 415 (la app lo convierte antes)', webp.status, 415);
        const grande = new Uint8Array(5 * 1024 * 1024 + 10); grande.set(PNG);
        const pesada = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(grande), sesion });
        igual('más de 5 MB: 413', pesada.status, 413);
        const otroCampo = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG, 'a.png', 'image/png', 'imagen'), sesion });
        igual('sin el campo «files»: 400', otroCampo.status, 400);
        const json1 = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: JSON.stringify({ files: 'x' }), sesion, cabeceras: { 'Content-Type': 'application/json' } });
        igual('un JSON en vez de formulario: 400', json1.status, 400);
        const get = await pedir('/marcia/imagen', { sesion });
        igual('por GET: 405', get.status, 405);
        igual('nada de eso llegó a MARCia', llamadas.length, 0);
    }

    console.log('\nCuando MARCia responde mal');
    {
        subida = () => new Response('<html><body>404</body></html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
        const r404 = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG), sesion });
        igual('su 404 (sesión vencida): 401 «No active session»', [r404.status, /No active session/.test((await json(r404)).error)], [401, true]);
        subida = () => new Response('', { status: 500 });
        const r500 = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG), sesion });
        const d500 = await json(r500);
        igual('su 500 vacío: 502 con un mensaje que se entiende', [r500.status, /no pudo procesar la imagen/.test(d500.error), /error 500/.test(d500.error)], [502, true, true]);
        subida = () => new Response('<html>413 Request Entity Too Large</html>', { status: 413 });
        igual('su 413: 413', (await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG), sesion })).status, 413);
        subida = () => new Response(JSON.stringify({ algo: 'distinto' }), { status: 200 });
        const raro = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG), sesion });
        igual('un 200 sin imágenes: 502', [raro.status, /inesperado/.test((await json(raro)).error)], [502, true]);
        subida = () => new Response(JSON.stringify(SUBIDA_REAL), { status: 200 });
    }

    console.log('\nCuotas: subir el logotipo es una búsqueda nueva');
    {
        const env = { CUOTAS: kv(), CUOTA_SECRETO: 'secreto-de-prueba-largo', TURNSTILE_SECRET: 'turnstile-secreto' };
        const sinPase = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG), sesion, env });
        igual('sin pase: 402', [sinPase.status, (await json(sinPase)).cuota], [402, true]);
        const cuota = await json(await pedir('/cuota', { metodo: 'POST', env, cuerpo: JSON.stringify({ tipo: 'busqueda', huella: { amplia: 'x' }, dispositivo: 'd1' }), cabeceras: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' } }));
        verificar('la app recibe su pase de búsqueda', cuota && cuota.permitido && typeof cuota.pase === 'string');
        const conPase = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG), sesion, env, pase: cuota.pase });
        igual('con el pase de la app: 200', conPase.status, 200);
        const sitio = await json(await pedir('/cuota', { metodo: 'POST', env, origen: 'https://empirica.mx', cuerpo: JSON.stringify({ tipo: 'viabilidad_sitio', turnstile: 'token-bueno' }), cabeceras: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '5.5.5.5' } }));
        verificar('el sitio recibe su pase', sitio && sitio.permitido && typeof sitio.pase === 'string');
        const desdeSitio = await pedir('/marcia/imagen', { metodo: 'POST', cuerpo: formulario(PNG), sesion, env, pase: sitio.pase, origen: 'https://empirica.mx' });
        igual('el pase del sitio no sirve para subir logotipos: 402', desdeSitio.status, 402);
        const mini = await pedir('/marcia/miniatura/RM202002404330', { env });
        igual('la miniatura no pide pase (se usa al hacer el PDF, días después)', mini.status, 200);
    }

    console.log('\nMiniaturas');
    {
        llamadas.length = 0;
        const r = await pedir('/marcia/miniatura/RM202002404330');
        const bytes = new Uint8Array(await r.arrayBuffer());
        igual('200, imagen PNG, con caché de un día', [r.status, r.headers.get('Content-Type'), r.headers.get('Cache-Control')], [200, 'image/png', 'public, max-age=86400']);
        igual('con permiso para la app (CORS)', r.headers.get('Access-Control-Allow-Origin'), APP);
        igual('los bytes de MARCia', Array.from(bytes), Array.from(PNG));
        igual('pedida a /marcas/image/{id}', llamadas.map(l => l.url), [MARCIA + '/marcas/image/RM202002404330']);
        llamadas.length = 0;
        const malos = await Promise.all(['rm202002404330', 'RM1234%2F..%2Fx', 'RM12.34', 'X'].map(id => pedir('/marcia/miniatura/' + id)));
        igual('ids que no son de marca: 400', malos.map(x => x.status), [400, 400, 400, 400]);
        igual('y no se llama a MARCia', llamadas.length, 0);
        miniatura = () => new Response(PNG, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
        igual('sin tipo de imagen pero con bytes de PNG: image/png', (await pedir('/marcia/miniatura/RM1999')).headers.get('Content-Type'), 'image/png');
        miniatura = () => new Response('<html>Error</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
        igual('una página HTML: 502', (await pedir('/marcia/miniatura/RM1999')).status, 502);
        miniatura = () => new Response('', { status: 404 });
        igual('si MARCia no la tiene: 404', (await pedir('/marcia/miniatura/RM1999')).status, 404);
        igual('por POST: 405', (await pedir('/marcia/miniatura/RM1999', { metodo: 'POST', cuerpo: 'x' })).status, 405);
    }

    console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
    if (fallos.length) {
        console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
        process.exit(1);
    }
})().catch(e => { console.error(e); process.exit(1); });
