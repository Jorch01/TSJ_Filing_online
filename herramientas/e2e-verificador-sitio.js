#!/usr/bin/env node
/**
 * Prueba de punta a punta del verificador de marca del sitio, en un navegador real (Chromium).
 *
 *   node herramientas/e2e-verificador-sitio.js <carpeta-del-sitio>
 *   (ej.: node herramientas/e2e-verificador-sitio.js ../empirica.mx-nuevo-feb-2026)
 *
 * Qué corre de verdad: la landing, el widget, el módulo generado y el Worker COMPLETO
 * (docs/proxy/impi-proxy-worker.js, en memoria): Turnstile, cuota de 1 al mes por IP, pase y caché.
 * Qué se simula: la verificación de Cloudflare (acepta «token-bueno»), las respuestas del IMPI y el
 * Apps Script de contacto. Ninguna petición sale a Internet con datos reales.
 *
 * Necesita Playwright (require('playwright')). No forma parte de las pruebas de CI.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITIO = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(SITIO, 'landing-registro-marcas-cancun.html'))) {
    console.error('Uso: node herramientas/e2e-verificador-sitio.js <carpeta-del-sitio>');
    process.exit(2);
}
const { chromium } = require('playwright');

let pasadas = 0; const fallos = [];
const verificar = (d, c, det) => { if (c) { pasadas++; console.log('  ✓ ' + d); } else { fallos.push(d); console.log('  ✗ ' + d + (det !== undefined ? '\n      ' + det : '')); } };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'application/xml', '.webp': 'image/webp' };
const marcia = (id, title, status) => ({
    id, applicationNumber: id.replace(/\D/g, '').slice(-6), registrationNumber: status === 'REGISTRADO' ? '8' + id.replace(/\D/g, '').slice(-5) : '',
    title, status, appType: 'REGISTRO DE MARCA', owners: ['TITULAR DE ' + title], dates: { application: '10/02/2019', expiry: '10/02/2029' }, goodsAndServices: '', classes: [], images: ''
});

(async () => {
    // El Worker completo, en memoria.
    const archivo = path.join(os.tmpdir(), 'worker-e2e-' + process.pid + '.mjs');
    fs.writeFileSync(archivo, fs.readFileSync(path.join(__dirname, '..', 'docs', 'proxy', 'impi-proxy-worker.js'), 'utf8'));
    const worker = (await import('file://' + archivo)).default;
    fs.unlinkSync(archivo);
    const kv = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };
    const env = { CUOTAS: kv(), CUOTA_SECRETO: 'secreto-e2e-largo', TURNSTILE_SECRET: 'secreto-turnstile-e2e' };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {   // solo lo que el Worker pide hacia afuera: Turnstile
        if (String(url).includes('challenges.cloudflare.com')) {
            const bueno = /response=token-bueno(&|$)/.test(String(opts.body));
            return { ok: true, status: 200, json: async () => ({ success: bueno }) };
        }
        throw new Error('El Worker intentó salir a Internet: ' + url);
    };
    const cachesMem = new Map();
    globalThis.caches = { default: { match: async (r) => (cachesMem.has(r.url) ? new Response(cachesMem.get(r.url)) : undefined), put: async (r, res) => { cachesMem.set(r.url, await res.text()); } } };

    const estadisticas = { cuota: [], impi: 0, sinPase: 0, leads: [], cache: 0, collect: [] };
    const MARCAS = { 'luna azul': [marcia('RM201900111111', 'LUNA AZUL', 'REGISTRADO')], 'sol naciente': [marcia('RM201900222222', 'MAR ABIERTO', 'REGISTRADO')] };
    let denominacionActual = 'luna azul';

    async function atender(page, ruta) {
        const req = ruta.request(); const url = new URL(req.url());
        const origen = req.headers()['origin'] || '';
        const ip = '203.0.113.' + (page.__ipFinal || 7);
        // Rutas del IMPI (simuladas) tras comprobar que traen el pase
        const IMPI = ['/marcia/csrf', '/marcia/search', '/marcia/results', '/marcanet/fonetica', '/marcanet/full-detail', '/siga/search'];
        if (req.method() !== 'OPTIONS' && (IMPI.includes(url.pathname) || url.pathname.startsWith('/marcia/view/'))) {
            const exigen = ['/marcia/search', '/marcanet/fonetica', '/siga/search'];
            if (exigen.includes(url.pathname) && !req.headers()['x-tsj-cuota']) { estadisticas.sinPase++; return ruta.fulfill({ status: 402, headers: cors(origen), body: JSON.stringify({ error: 'sin pase', cuota: true }) }); }
            estadisticas.impi++;
            const marcas = MARCAS[denominacionActual];
            let cuerpo = {};
            if (url.pathname === '/marcia/search') cuerpo = { id: 'S1', count: marcas.length };
            else if (url.pathname === '/marcia/results') cuerpo = { resultPage: marcas, totalResults: marcas.length, aggregates: { NICE_CLASSES: [{ key: '25', docCount: 1 }, { key: '35', docCount: 1 }] } };
            else if (url.pathname === '/marcanet/fonetica') cuerpo = { results: [{ 'Denominación': 'MAR ABIERTO', Expediente: '9100001', Clase: '25', Titular: 'OTRO', 'Situación': 'REGISTRADA' }] };
            else if (url.pathname === '/marcanet/full-detail') cuerpo = { detail: null };
            else if (url.pathname === '/siga/search') cuerpo = { successed: true, data: [] };
            return ruta.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors(origen)), body: JSON.stringify(cuerpo) });
        }
        // El resto (/cuota, preflight…): el Worker de verdad
        const r = await worker.fetch(new Request('https://proxy.test' + url.pathname, {
            method: req.method(), headers: Object.assign({ 'CF-Connecting-IP': ip }, origen ? { Origin: origen } : {}, { 'Content-Type': 'application/json' }),
            body: req.method() === 'POST' ? req.postData() : undefined
        }), env, { waitUntil: (p) => p });
        const texto = await r.text();
        if (url.pathname === '/cuota' && req.method() === 'POST') { try { estadisticas.cuota.push({ status: r.status, permitido: JSON.parse(texto).permitido }); } catch (e) { /* */ } }
        const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
        return ruta.fulfill({ status: r.status, headers: h, body: texto });
    }
    const cors = (o) => ({ 'Access-Control-Allow-Origin': o || '*', 'Access-Control-Expose-Headers': 'X-IMPI-Session' });

    async function contexto(browser, opts, config) {
        const ctx = await browser.newContext(opts);
        const page = await ctx.newPage();
        const consola = []; page.__consola = consola;
        page.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' && !/Failed to load resource: net::ERR_FAILED/.test(t)) || /Cannot find Widget|Nothing to remove/.test(t)) consola.push(t); }); // lo abortado a propósito (GTM, GA, fuentes, iconos) no cuenta
        page.on('pageerror', (e) => consola.push('pageerror: ' + e.message));
        await ctx.route('https://empirica.mx/**', async (ruta) => {
            const u = new URL(ruta.request().url());
            if (u.pathname === '/js/verificador-config.js' && config !== undefined) {
                return ruta.fulfill({ status: 200, contentType: MIME['.js'], body: 'window.VERIFICADOR_MARCA_CONFIG=' + JSON.stringify(config) + ';' });
            }
            const f = path.join(SITIO, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
            if (!f.startsWith(SITIO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return ruta.fulfill({ status: 404, body: 'no' });
            return ruta.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
        });
        await ctx.route('https://proxy.test/**', (ruta) => atender(page, ruta));
        await ctx.route('https://challenges.cloudflare.com/**', (ruta) => ruta.fulfill({ status: 200, contentType: MIME['.js'],
            body: "window.__tw={n:0,vivos:{}};window.turnstile={render:function(el,o){var id='w'+(++__tw.n);__tw.vivos[id]=el;setTimeout(function(){o.callback('token-bueno')},60);return id},reset:function(id){if(!__tw.vivos[id]||!document.contains(__tw.vivos[id]))console.warn('Cannot find Widget '+id)},remove:function(id){if(!__tw.vivos[id]||!document.contains(__tw.vivos[id]))console.warn('Nothing to remove found for the provided container '+id);delete __tw.vivos[id]}};" }));
        await ctx.route('https://script.google.com/**', async (ruta) => {
            const rq = ruta.request();
            if (rq.method() === 'POST') estadisticas.leads.push(JSON.parse(rq.postData()));
            return ruta.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ status: 'ok' }) });
        });
        await ctx.route(/fonts\.g|cdnjs\.cloudflare\.com/, (ruta) => ruta.abort());
        // Condición mala a propósito: el gtag.js en línea llega tarde y gana la instancia del Google tag del contenedor de GTM.
        // Con las dos instancias, un gtag('event') sin destino explícito se perdía (0 de 6); con send_to llega siempre.
        await ctx.route(/googletagmanager\.com\/gtag\/js\?id=G-YHSKT7WH3Q$/, async (ruta) => { await new Promise((r) => setTimeout(r, 2500)); ruta.continue(); });
        // La analítica carga de verdad (gtag.js y GTM), pero lo que enviaría a Google se intercepta y se cuenta: no ensucia los datos reales.
        await ctx.route(/google-analytics\.com|analytics\.google\.com|doubleclick\.net|\/g\/collect|\/j\/collect/, (ruta) => { estadisticas.collect.push(ruta.request().url() + '\n' + (ruta.request().postData() || '')); return ruta.fulfill({ status: 204, body: '' }); });
        return { ctx, page };
    }
    const CONFIG_OK = { turnstileSiteKey: '1x00000000000000000000AA', proxy: 'https://proxy.test', whatsapp: '529982570828' };
    const URL_LANDING = 'https://empirica.mx/landing-registro-marcas-cancun.html';

    async function llenar(page, denominacion, clases, giro) {
        await page.fill('#vm-denominacion', denominacion);
        for (const c of clases) await page.selectOption('#vm-clase', String(c));
        if (giro) await page.fill('#vm-giro', giro);
    }
    async function eventosGA(page) {
        return page.evaluate(() => (window.dataLayer || []).filter(x => x && x[0] === 'event').map(x => ({ nombre: x[1], params: x[2] })));
    }

    const browser = await chromium.launch();
    try {
        console.log('\nSin la clave de Turnstile en la configuración');
        {
            const { ctx, page } = await contexto(browser, { viewport: { width: 1280, height: 900 } }, { turnstileSiteKey: '', proxy: 'https://proxy.test', whatsapp: '529982570828' });
            await page.goto(URL_LANDING); await page.waitForSelector('#vm-form');
            const txt = await page.textContent('#vm-mensaje');
            verificar('el verificador avisa que no está disponible y manda a WhatsApp', /no está disponible/.test(txt) && (await page.$$('#vm-mensaje a[href*="wa.me/529982570828"]')).length === 1, txt);
            await llenar(page, 'Luna Azul', [25]); await page.click('#vm-ejecutar');
            await page.waitForTimeout(300);
            verificar('y no llama a ningún servicio', estadisticas.cuota.length === 0 && estadisticas.impi === 0);
            await ctx.close();
        }

        const PRUEBAS = [['escritorio', { viewport: { width: 1280, height: 900 } }, 21], ['móvil', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 22]];
        for (const [nombre, opts, ipFinal] of PRUEBAS) {
            console.log('\nEstudio completo en ' + nombre);
            const { ctx, page } = await contexto(browser, opts, CONFIG_OK);
            page.__ipFinal = ipFinal;
            const collectAntes = estadisticas.collect.length;   // lo de este recorrido, no lo de las cargas anteriores
            // En el móvil, el botón ES/EN del menú ya quedó en inglés en este navegador (como en el de una persona que lo probó antes);
            // en escritorio la visita llega con parámetros de campaña.
            if (nombre === 'móvil') await ctx.addInitScript(() => { try { localStorage.setItem('empirica_lang', 'en'); } catch (e) { /* sin storage */ } });
            await page.goto(URL_LANDING + (nombre === 'escritorio' ? '?utm_source=e2e&utm_medium=prueba' : '')); await page.waitForSelector('#vm-form');
            if (nombre === 'móvil') verificar('(escenario) la página quedó con lang="en" por el botón ES/EN guardado', (await page.evaluate(() => document.documentElement.lang)) === 'en');
            verificar('la landing carga y el formulario aparece', !!(await page.$('#vm-denominacion')));
            verificar('el selector de clases trae descripción', /25 — Ropa, calzado/.test(await page.textContent('#vm-clase')));

            // Validaciones
            await page.click('#vm-ejecutar');
            verificar('sin denominación: pide escribirla', /Escribe la denominación/.test(await page.textContent('#vm-mensaje')));
            await page.fill('#vm-denominacion', 'Luna Azul'); await page.click('#vm-ejecutar');
            verificar('sin clase: pide elegirla', /al menos una clase/.test(await page.textContent('#vm-mensaje')));
            await llenar(page, 'Luna Azul', [25, 35, 5]);
            await page.selectOption('#vm-clase', '9');
            verificar('más de 3 clases: no las deja', /hasta 3 clases/.test(await page.textContent('#vm-mensaje')) && (await page.$$('.vm-chip')).length === 3);
            await page.click('button[data-clase="5"]');
            verificar('se puede quitar una clase', (await page.$$('.vm-chip')).length === 2);
            await page.fill('#vm-giro', 'tienda de ropa de playa en Cancún');

            // Estudio
            await page.waitForFunction(() => document.querySelector('#vm-turnstile') && window.turnstile, null, { timeout: 5000 }).catch(() => {});
            denominacionActual = 'luna azul';
            await page.waitForTimeout(250);
            await page.click('#vm-ejecutar');
            await page.waitForSelector('#vm-titulo-res', { timeout: 30000 });
            const veredicto = (await page.textContent('#vm-titulo-res')).trim();
            verificar('muestra el semáforo en rojo para una marca idéntica ya registrada', veredicto === 'Riesgo alto' && (await page.$('.vm-semaforo.rojo .vm-luz.rojo.on')) !== null, veredicto);
            const conteo = (await page.textContent('.vm-conteo')).trim();
            verificar('da el número de antecedentes encontrados, con el desglose por riesgo (sin cifras que no cuadren)', /^[\d,.]+\s*antecedentes? parecidos? encontrados? · \d+ de riesgo alto/.test(conteo), conteo);
            verificar('el disclaimer se ve con el sentido del de la app (orientativo, sistemas externos del IMPI, no concluyente, no afiliado, especialista)',
                ['orientativos', 'sistemas externos del Instituto Mexicano de la Propiedad Industrial', 'No son concluyentes', 'no está afiliado al IMPI', 'especialista en propiedad industrial'].every(f => (document => document)(true) && true) &&
                await page.evaluate(() => { const t = document.querySelector('.vm-aviso').textContent; return ['orientativos', 'sistemas externos del Instituto Mexicano de la Propiedad Industrial', 'No son concluyentes', 'no está afiliado al IMPI', 'especialista en propiedad industrial'].every(f => t.includes(f)); }));
            verificar('hay CTA directo a WhatsApp', (await page.$$('a.vm-btn-wa[href*="wa.me/529982570828"]')).length === 1);
            const antes = await page.content();
            verificar('el detalle sigue bloqueado: no está en la página ningún antecedente concreto (titular, expediente ni tabla)',
                !/TITULAR DE LUNA AZUL/.test(antes) && !/vm-tabla/.test(antes.replace(/\.vm-tabla[^{]*\{/g, '')) && !(await page.$('#vm-titulo-detalle')));
            verificar('y se ve el formulario de desbloqueo con nombre, correo y WhatsApp', !!(await page.$('#vm-nombre')) && !!(await page.$('#vm-correo')) && !!(await page.$('#vm-whats')));
            verificar('sin errores en la consola hasta aquí', page.__consola.length === 0, page.__consola.join(' | '));

            // Desbloqueo
            await page.fill('#vm-nombre', 'Persona de Prueba');
            await page.fill('#vm-correo', 'correo-malo');
            await page.fill('#vm-whats', '998 123 4567');
            await page.click('#vm-enviar-lead');
            verificar('un correo inválido se rechaza', /correo válido/.test(await page.textContent('#vm-mensaje-lead')));
            await page.fill('#vm-correo', 'prueba@example.com');
            const leadsAntes = estadisticas.leads.length;
            await page.click('#vm-enviar-lead');
            verificar('sin aceptar el aviso de privacidad no se envía', /aviso de privacidad/.test(await page.textContent('#vm-mensaje-lead')) && estadisticas.leads.length === leadsAntes);
            await page.check('#vm-consent');
            await page.click('#vm-enviar-lead');
            await page.waitForSelector('#vm-titulo-detalle', { timeout: 10000 });
            const lead = estadisticas.leads[estadisticas.leads.length - 1];
            verificar('el lead llega al formulario de contacto del sitio con sus datos', lead && lead.nombre === 'Persona de Prueba' && lead.correo === 'prueba@example.com' && lead.telefono === '998 123 4567' && lead.perfil === 'verificador-marca', JSON.stringify(lead));
            verificar('con el resumen del estudio para el abogado', /Denominación: Luna Azul/.test(lead.mensaje) && /Clases: 25, 35/.test(lead.mensaje) && /Semáforo: rojo/.test(lead.mensaje) && /LUNA AZUL/.test(lead.mensaje), lead.mensaje);
            verificar('la trampa para robots va vacía', lead.sitio_web === '');
            verificar('el idioma del contacto es el de la página (es), aunque el botón ES/EN esté en inglés', lead.idioma === 'es', 'idioma: ' + lead.idioma);
            verificar('el semáforo del correo se llama igual que en la página ("Riesgo alto")', /Semáforo: rojo \(Riesgo alto\)/.test(lead.mensaje), lead.mensaje);
            verificar('cada antecedente del correo trae su número de registro (para no confundir dos iguales)', /«LUNA AZUL» \(reg\. 811111, clase 25/.test(lead.mensaje), lead.mensaje);
            if (nombre === 'escritorio') verificar('la campaña de la visita llega al contacto (utm_source y utm_medium)', /utm_source=e2e/.test(lead.campana) && /utm_medium=prueba/.test(lead.campana), 'campana: ' + lead.campana);
            const detalle = await page.textContent('#vm-detalle');
            verificar('desbloquea el dictamen: antecedentes concretos, titular y recomendaciones', /LUNA AZUL/.test(detalle) && /TITULAR DE LUNA AZUL/.test(detalle) && /Recomendaciones/.test(detalle), detalle.slice(0, 300));
            verificar('y las clases relacionadas, dichas como orientativas', /Clases relacionadas/.test(detalle) && /orientativo/.test(detalle));
            verificar('el dictamen dice cuántos muestra de cuántos y los números cuadran con los del resultado', /Se encontraron 1 antecedentes parecidos \(1 de riesgo alto\)\. Aquí van los 1 principales/.test(detalle), detalle.slice(0, 400));

            // Eventos de GA4
            const ga = await eventosGA(page); const nombres = ga.map(e => e.nombre);
            verificar('GA4: estudio iniciado, resultado mostrado y lead enviado', ['marca_estudio_iniciado', 'marca_resultado_mostrado', 'generate_lead'].every(n => nombres.includes(n)), nombres.join(', '));
            const gl = ga.find(e => e.nombre === 'generate_lead');
            verificar('el lead se mide como generate_lead del verificador, sin datos personales', gl && gl.params.method === 'verificador_marca' && !JSON.stringify(ga).match(/prueba@example|Persona de Prueba|998 123|Luna Azul/i), JSON.stringify(ga));

            // Lo que de verdad saldría hacia Google Analytics (interceptado): cada evento propio, una sola vez
            if (nombre === 'escritorio') {
                // GA4 junta los eventos y los envía en lotes unos segundos después (a veces más con el equipo cargado):
                // se espera activamente a que salgan los tres (máximo 30 s) y, ya salidos, 2 s más para ver si se duplican.
                const contar = () => { const c = {}; for (const x of estadisticas.collect.slice(collectAntes)) for (const m of x.matchAll(/[?&\n]en=([a-z_]+)/g)) c[m[1]] = (c[m[1]] || 0) + 1; return c; };
                const propios = ['marca_estudio_iniciado', 'marca_resultado_mostrado', 'generate_lead'];
                for (let i = 0; i < 30 && !propios.every(e => contar()[e]); i++) await page.waitForTimeout(1000);
                await page.waitForTimeout(2000);
                const cuenta = contar();
                console.log('    (eventos hacia Google Analytics: ' + JSON.stringify(cuenta) + ')');
                if (!estadisticas.collect.length) console.log('    (la analítica no cargó en este entorno: se omite la comprobación de envío)');
                else {
                    verificar('una carga de página manda un solo page_view (no hay doble conteo de Analytics)', cuenta.page_view === 1, 'page_view: ' + cuenta.page_view);
                    for (const e of ['marca_estudio_iniciado', 'marca_resultado_mostrado', 'generate_lead']) verificar('GA4 recibe ' + e + ' (llega a la red) exactamente una vez', cuenta[e] === 1, 'veces: ' + (cuenta[e] || 0));
                }
            }

            // Pantalla: sin desplazamiento horizontal
            const anchos = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
            verificar('sin desplazamiento horizontal', anchos.sw <= anchos.cw, JSON.stringify(anchos));
            await page.locator('#vm-detalle').screenshot({ path: path.join(os.tmpdir(), 'vm-detalle-' + nombre + '.png') }).catch(() => {});

            // Segundo estudio desde la misma IP: ya se usó el del mes
            await page.click('#vm-otro');
            await page.waitForSelector('#vm-form');
            denominacionActual = 'sol naciente';
            await llenar(page, 'Sol Naciente', [35]);
            await page.waitForTimeout(250);
            await page.click('#vm-ejecutar');
            await page.waitForFunction(() => /ya se hizo el estudio gratuito de este mes/.test(document.getElementById('vm-mensaje').textContent), null, { timeout: 15000 });
            verificar('un segundo estudio del mes desde esa conexión: avisa y ofrece WhatsApp', (await page.$$('#vm-mensaje a[href*="wa.me"]')).length === 1);
            verificar('el formulario conserva lo que escribió', (await page.inputValue('#vm-denominacion')) === 'Sol Naciente');
            await page.click('#vm-ultimo');
            await page.waitForSelector('#vm-titulo-res');
            verificar('puede volver a ver su último resultado (y el dictamen ya desbloqueado)', /Riesgo alto/.test(await page.textContent('#vm-titulo-res')) && !!(await page.$('#vm-titulo-detalle')));
            verificar('sin errores en la consola', page.__consola.length === 0, page.__consola.join(' | '));
            await page.screenshot({ path: path.join(os.tmpdir(), 'vm-final-' + nombre + '.png') });
            await ctx.close();
        }

        console.log('\nEl generate_lead que ya existía (clic al teléfono) también llega a Analytics');
        {
            const { ctx, page } = await contexto(browser, { viewport: { width: 1280, height: 900 } }, CONFIG_OK);
            const antes = estadisticas.collect.length;
            await page.goto('https://empirica.mx/'); await page.waitForSelector('a[href^="tel:"]');
            await page.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a[href^="tel:"]')) e.preventDefault(); }, true));
            await page.click('a[href^="tel:"]');
            const cuantos = () => estadisticas.collect.slice(antes).filter((x) => /[?&\n]en=generate_lead/.test(x) && /method=telefono|epn?\.?method|telefono/.test(x)).length;
            for (let i = 0; i < 30 && !cuantos(); i++) await page.waitForTimeout(1000);
            await page.waitForTimeout(2000);
            verificar('el clic al teléfono manda generate_lead a Analytics exactamente una vez', cuantos() === 1, 'veces: ' + cuantos());
            await ctx.close();
        }

        console.log('\nSemáforo en verde, sin parecidos (otra conexión)');
        {
            const { ctx, page } = await contexto(browser, { viewport: { width: 1280, height: 900 } }, CONFIG_OK);
            page.__ipFinal = 31;
            await page.goto(URL_LANDING); await page.waitForSelector('#vm-form');
            denominacionActual = 'sol naciente';
            await llenar(page, 'Sol Naciente', [35]);
            await page.waitForTimeout(250);
            await page.click('#vm-ejecutar');
            await page.waitForSelector('#vm-titulo-res', { timeout: 30000 });
            verificar('verde: panorama favorable, y sin antecedentes de riesgo', (await page.textContent('#vm-titulo-res')).trim() === 'Panorama favorable' && (await page.$('.vm-semaforo.verde .vm-luz.verde.on')) !== null);
            await ctx.close();
        }

        console.log('\nCuando el servicio no está');
        {
            const { ctx, page } = await contexto(browser, { viewport: { width: 1280, height: 900 } }, Object.assign({}, CONFIG_OK, { proxy: 'https://proxy-caido.test' }));
            await ctx.route('https://proxy-caido.test/**', (r) => r.abort());
            await page.goto(URL_LANDING); await page.waitForSelector('#vm-form');
            await llenar(page, 'Luna Azul', [25]);
            await page.waitForTimeout(250);
            await page.click('#vm-ejecutar');
            await page.waitForFunction(() => /no está disponible en este momento/.test(document.getElementById('vm-mensaje').textContent), null, { timeout: 15000 });
            verificar('avisa con claridad y ofrece WhatsApp, sin quedarse colgado', (await page.$$('#vm-mensaje a[href*="wa.me"]')).length === 1 && (await page.inputValue('#vm-denominacion')) === 'Luna Azul');
            await ctx.close();
        }
    } finally {
        await browser.close();
        globalThis.fetch = realFetch;
    }

    verificar('el Worker nunca recibió una búsqueda sin pase del sitio', estadisticas.sinPase === 0, 'sin pase: ' + estadisticas.sinPase);
    console.log('\n' + pasadas + ' pasadas, ' + fallos.length + ' fallidas');
    if (fallos.length) { console.log('\nFallaron:\n  - ' + fallos.join('\n  - ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
