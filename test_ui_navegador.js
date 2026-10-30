#!/usr/bin/env node
/**
 * Pruebas de la interfaz en un navegador de verdad (Chromium vía Playwright).
 *
 *   node test_ui_navegador.js
 *
 * Existen porque test_template_csv.js NO puede ver esta clase de fallos: allí
 * Blob y el DOM están simulados y no hay CSS, así que un botón que no descarga
 * o un tooltip que tapa el botón pasaban las 125 pruebas sin despeinarse.
 *
 * Requiere Playwright. Si no está instalado, la prueba se salta con aviso en
 * vez de fallar, para no romper a quien solo quiera correr las de Node.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
    ({ chromium } = require('playwright'));
} catch (e) {
    // En CI omitirlas sería un verde falso: el candado daría por buenas 135
    // comprobaciones que no llegaron a ejecutarse.
    if (process.env.CI) {
        console.error('✗ Playwright no está instalado y estamos en CI. Instálalo antes de correr esto.');
        process.exit(1);
    }
    console.log('⚠ Playwright no está instalado; se omiten las pruebas de navegador.');
    console.log('  Para ejecutarlas:  npm install playwright');
    process.exit(0);
}

const RAIZ = path.join(__dirname, 'docs');
const PUERTO = 8123;
const TIPOS = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.png': 'image/png',
    '.webmanifest': 'application/manifest+json'
};

// raiz: docs/ para la app; la del repositorio para las páginas públicas.
function servidorEstatico(puerto, raiz = RAIZ) {
    return new Promise(resolve => {
        const s = http.createServer((req, res) => {
            const rel = decodeURIComponent(req.url.split('?')[0]);
            const archivo = path.join(raiz, rel.endsWith('/') ? rel + 'index.html' : rel);
            if (!archivo.startsWith(raiz)) { res.writeHead(403); res.end(); return; }
            fs.readFile(archivo, (err, datos) => {
                if (err) { res.writeHead(404); res.end('404'); return; }
                res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
                res.end(datos);
            });
        });
        s.listen(puerto, () => resolve(s));
    });
}

let pasadas = 0, fallidas = 0;
const fallos = [];

function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; return; }
    fallidas++;
    fallos.push(descripcion + (detalle ? `\n      ${detalle}` : ''));
}

function igual(descripcion, real, esperado) {
    verificar(descripcion, JSON.stringify(real) === JSON.stringify(esperado),
        `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}

// ¿Se solapan dos rectángulos?
function seSolapan(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.width && a.x + a.width > b.x &&
           a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Comprueba el botón "Descargar Template" de una sección: tooltip y descarga. */
async function probarBotonTemplate(page, zona, indice) {
    const contenedor = page.locator('.tooltip-container')
        .filter({ hasText: 'Descargar Template' }).nth(indice);
    const boton = contenedor.locator('button').first();
    const tooltip = contenedor.locator('.tooltip-content').first();
    const caja = await boton.boundingBox().catch(() => null);
    verificar(`${zona}: el botón se ve`, !!caja, 'el botón no tiene caja (oculto)');
    if (!caja) return;

    // ---- El tooltip no debe tapar el botón ----
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    await boton.hover();
    await page.waitForTimeout(400);

    const cajaTooltip = await tooltip.boundingBox().catch(() => null);
    const visibilidad = await tooltip.evaluate(el => getComputedStyle(el).visibility);

    igual(`${zona}: el tooltip aparece al pasar el ratón`, visibilidad, 'visible');
    verificar(`${zona}: el tooltip NO tapa el botón`, !seSolapan(caja, cajaTooltip),
        `botón ${JSON.stringify(caja)} vs tooltip ${JSON.stringify(cajaTooltip)}`);

    if (cajaTooltip) {
        const alto = await page.evaluate(() => document.documentElement.clientHeight);
        const ancho = await page.evaluate(() => document.documentElement.clientWidth);
        verificar(`${zona}: el tooltip cabe en la pantalla`,
            cajaTooltip.y >= -1 && cajaTooltip.y + cajaTooltip.height <= alto + 1 &&
            cajaTooltip.x >= -1 && cajaTooltip.x + cajaTooltip.width <= ancho + 1,
            `tooltip ${JSON.stringify(cajaTooltip)} en ventana ${ancho}x${alto}`);
    }

    // ---- El botón descarga de verdad, con un clic normal ----
    let descarga = null;
    let errorClic = null;
    const espera = page.waitForEvent('download', { timeout: 10000 })
        .then(d => { descarga = d; }).catch(() => {});
    try {
        await boton.click({ timeout: 5000 });   // sin force: como lo pulsa el usuario
    } catch (e) {
        errorClic = e.message.split('\n')[0];
    }
    await espera;

    verificar(`${zona}: el clic llega al botón`, !errorClic, errorClic);
    verificar(`${zona}: el botón descarga el archivo`, !!descarga,
        'no llegó ningún evento de descarga');

    if (descarga) {
        igual(`${zona}: el archivo se llama como toca`,
            descarga.suggestedFilename(), 'template_expedientes.csv');

        const ruta = await descarga.path();
        const contenido = ruta ? fs.readFileSync(ruta, 'utf8') : '';
        verificar(`${zona}: el archivo no llega vacío`, contenido.length > 10000,
            `${contenido.length} bytes`);
        verificar(`${zona}: lleva el BOM para Excel`, contenido.charCodeAt(0) === 0xFEFF);
        verificar(`${zona}: trae el encabezado de columnas`,
            contenido.includes('expediente,tipo,institucion,juzgado'));
        verificar(`${zona}: trae el catálogo del TSJ`,
            contenido.includes('JUZGADO PRIMERO CIVIL CANCUN'));
        verificar(`${zona}: trae el catálogo federal`,
            /# ID=\d+ \| "/.test(contenido));
    }
}

// DOMPurify llega de jsdelivr con un <script> que detiene la carga de la
// página hasta que la CDN contesta. Si la CDN se atasca, page.goto se agota a
// los 30 s y la prueba falla sin que la app tenga nada mal: pasó en CI. CI
// instala la misma versión desde npm y aquí se sirve esa copia; si no está
// instalada, las páginas la piden a la CDN como antes.
const URL_DOMPURIFY = 'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js';

function copiaLocalDOMPurify() {
    try {
        const ruta = require.resolve('dompurify/dist/purify.min.js');
        const version = require(require.resolve('dompurify/package.json')).version;
        if (!URL_DOMPURIFY.includes('@' + version + '/')) {
            console.log(`⚠ DOMPurify ${version} instalado, pero la página pide otra versión: se usará la CDN.`);
            return null;
        }
        return fs.readFileSync(ruta, 'utf8');
    } catch (e) {
        return null;
    }
}

function servirDOMPurifyLocal(navegador) {
    const copia = copiaLocalDOMPurify();
    if (!copia) {
        if (process.env.CI) console.log('⚠ DOMPurify no está instalado: las páginas dependerán de jsdelivr.');
        return navegador;
    }
    const nuevoContexto = navegador.newContext.bind(navegador);
    navegador.newContext = async (opciones) => {
        const contexto = await nuevoContexto(opciones);
        await contexto.route(URL_DOMPURIFY, r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: copia }));
        return contexto;
    };
    return navegador;
}

async function abrirChromium() {
    return servirDOMPurifyLocal(await lanzarChromium());
}

/**
 * Abre Chromium venga de donde venga. En CI lo instala Playwright y su ruta
 * por omisión funciona; en un contenedor con los navegadores preinstalados la
 * versión suele no coincidir con la del paquete npm y hay que buscarla. Antes
 * había una ruta fija, que servía en un sitio y fallaba en el otro.
 */
async function lanzarChromium() {
    if (process.env.CHROMIUM_PATH) {
        return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    }
    try {
        return await chromium.launch();
    } catch (e) {
        const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
        if (!base || !fs.existsSync(base)) throw e;

        // Cualquier chromium instalado sirve para estas pruebas.
        for (const dir of fs.readdirSync(base)) {
            if (!/^chromium/.test(dir)) continue;
            for (const rel of ['chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
                const ruta = path.join(base, dir, rel);
                if (fs.existsSync(ruta)) return chromium.launch({ executablePath: ruta });
            }
        }
        throw e;
    }
}

/**
 * Estadísticas y "recomendar a un colega", en un navegador de verdad.
 * Con un ID de prueba (TSJ_GA_ID) y el script de Google interceptado: se
 * revisa lo que la app pondría en dataLayer, sin que salga nada a internet.
 */
async function probarAnaliticaYRecomendar(navegador) {
    const contexto = await navegador.newContext({ viewport: { width: 1400, height: 900 } });
    await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PUERTO}` });
    await contexto.route('**/googletagmanager.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await contexto.addInitScript(() => { window.TSJ_GA_ID = 'G-PRUEBA'; });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof medir === 'function' && typeof crearExpedienteCore === 'function' &&
            typeof db !== 'undefined' && !!db, { timeout: 15000 });
        await page.waitForTimeout(600);
        const r = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            try { localStorage.setItem('tour_bienvenida_visto', '1'); } catch (e) {}
            document.getElementById('tour-oferta')?.remove();
            const eventos = () => (window.dataLayer || []).filter(a => a[0] === 'event').map(a => [a[1], a[2]]);
            const out = {};
            out.abierta = eventos().some(e => e[0] === 'app_abierta');
            navegarA('calendario');
            out.seccion = eventos().some(e => e[0] === 'seccion_vista' && e[1].seccion === 'calendario');

            // Primer expediente: se cuenta (sin datos) y se ofrece recomendar una vez.
            await crearExpedienteCore({ numero: '9876/2026', nombre: 'Rosa Canul Pech', institucion: 'TSJ',
                juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', comentario: 'Cliente confidencial' });
            await pausa(3000);
            out.alta = eventos().find(e => e[0] === 'expediente_creado');
            out.oferta = !!document.getElementById('rec-oferta');
            [...document.querySelectorAll('#rec-oferta button')].find(b => /Ahora no/.test(b.textContent))?.click();
            await crearExpedienteCore({ numero: '9877/2026', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' });
            await pausa(3000);
            out.unaVez = !document.getElementById('rec-oferta');

            // La calculadora se mide por tipo de cálculo, sin importes.
            navegarA('laboral');
            const fijar = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
            fijar('lab-ingreso', '2020-01-15'); fijar('lab-baja', '2026-09-26'); fijar('lab-salario', '15000');
            await pausa(100);
            out.calculo = eventos().find(e => e[0] === 'calculo_laboral');

            // Recomendar en la computadora: ventanita con WhatsApp y copiar.
            await recomendarApp('menu');
            const modal = document.getElementById('modal-recomendar');
            out.modal = !!modal;
            out.whatsapp = modal?.querySelector('a[data-canal="whatsapp"]')?.href || '';
            modal.querySelector('[data-canal="copiar"]').click();
            await pausa(300);
            out.copiado = await navigator.clipboard.readText().catch(() => '');
            out.compartir = eventos().find(e => e[0] === 'compartir');
            cerrarModalRecomendar();

            // Nada de lo que se envía lleva datos del expediente.
            out.todo = JSON.stringify(window.dataLayer);

            // Desactivar desde Configuración: deja de enviar.
            navegarA('config');
            const casilla = document.getElementById('config-analitica');
            out.casillaMarcada = casilla.checked;
            casilla.click();
            const antes = eventos().length;
            navegarA('notas');
            out.apagada = eventos().length === antes;
            casilla.click();
            return out;
        });
        igual('estadísticas: registra que se abrió la app', r.abierta, true);
        igual('estadísticas: registra la sección visitada', r.seccion, true);
        igual('estadísticas: cuenta el alta de expediente sin datos', r.alta, ['expediente_creado', { cantidad: 1 }]);
        verificar('estadísticas: nunca envía número, nombre, juzgado ni notas',
            !/9876|Rosa|Canul|JUZGADO|confidencial|15000/i.test(r.todo), r.todo.slice(0, 300));
        igual('estadísticas: la calculadora cuenta el tipo de cálculo', r.calculo, ['calculo_laboral', { supuesto: 'despidoInjustificado', origen: 'app' }]);
        igual('estadísticas: Configuración empieza con ellas activadas', r.casillaMarcada, true);
        igual('estadísticas: desactivarlas deja de enviar', r.apagada, true);
        igual('recomendar: se ofrece tras el primer expediente', r.oferta, true);
        igual('recomendar: solo una vez', r.unaVez, true);
        igual('recomendar: en la computadora abre sus opciones', r.modal, true);
        verificar('recomendar: WhatsApp con el mensaje y el enlace medible',
            /^https:\/\/wa\.me\/\?text=/.test(r.whatsapp) && /utm_source%3Drecomendacion/.test(r.whatsapp), r.whatsapp);
        verificar('recomendar: copiar deja el mensaje con el enlace',
            /TSJ Filing Online/.test(r.copiado) && /tsjia\.empirica\.mx\/\?utm_source=recomendacion&utm_medium=copiar/.test(r.copiado), r.copiado);
        igual('recomendar: se mide por canal', r.compartir, ['compartir', { canal: 'copiar', origen: 'menu' }]);
        igual('estadísticas y recomendar: sin errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
    }

    // En el celular: el menú de compartir del teléfono.
    const movil = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await movil.addInitScript(() => {
        window.__compartido = null;
        navigator.share = async (datos) => { window.__compartido = datos; };
    });
    const pm = await movil.newPage();
    try {
        await pm.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await pm.waitForFunction(() => typeof recomendarApp === 'function' && typeof db !== 'undefined' && !!db, { timeout: 15000 });
        const m = await pm.evaluate(async () => {
            document.getElementById('menuToggle').click();
            await new Promise(res => setTimeout(res, 100));
            const boton = document.querySelector('#mobileNav .nav-recomendar');
            boton.click();
            await new Promise(res => setTimeout(res, 200));
            return { compartido: window.__compartido, modal: !!document.getElementById('modal-recomendar'),
                pagina: !!document.querySelector('.page.active') };
        });
        verificar('recomendar celular: abre el menú de compartir del teléfono',
            !!m.compartido && /utm_medium=nativo/.test(m.compartido.url) && /Quintana Roo/.test(m.compartido.text), JSON.stringify(m.compartido));
        igual('recomendar celular: sin ventanita extra', m.modal, false);
        igual('recomendar celular: sin dejar la página en blanco', m.pagina, true);
    } finally {
        await movil.close();
    }
}

/**
 * Instalar en el celular: es lo primero que enseña el recorrido, con los
 * pasos de cada plataforma, y la app tiene lo que los sistemas piden para
 * ponerla en la pantalla de inicio con su ícono.
 */
async function probarInstalacion(navegador) {
    const UA = {
        iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    };
    const abrir = async (opciones = {}, antes) => {
        const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...opciones });
        if (antes) await contexto.addInitScript(antes);
        const page = await contexto.newPage();
        const errores = [];
        page.on('pageerror', e => errores.push(e.message));
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof iniciarTour === 'function' && typeof instalarApp === 'function' &&
            typeof db !== 'undefined' && !!db, { timeout: 15000 });
        await page.evaluate(() => { try { localStorage.setItem('tour_bienvenida_visto', '1'); } catch (e) {} document.getElementById('tour-oferta')?.remove(); });
        return { contexto, page, errores };
    };
    // El segundo paso del primer recorrido (el primero tras la bienvenida).
    const pasoInstalar = (page) => page.evaluate(async () => {
        await iniciarTour('primerosPasos');
        await new Promise(res => setTimeout(res, 300));
        pasoTour(1);
        await new Promise(res => setTimeout(res, 500));
        const t = document.querySelector('.tour-tarjeta');
        const r = { titulo: t?.querySelector('.tour-titulo')?.textContent || '', texto: t?.textContent || '',
            progreso: t?.querySelector('.tour-progreso')?.textContent || '' };
        terminarTour();
        return r;
    });

    // Lo que piden Android/Chrome y el iPhone.
    let { contexto, page, errores } = await abrir();
    const manifiesto = await page.evaluate(async () => {
        const href = document.querySelector('link[rel="manifest"]').href;
        const m = await (await fetch(href)).json();
        const cargan = async (src) => {
            const img = new Image();
            img.src = new URL(src, href).href;
            try { await img.decode(); return [img.naturalWidth, img.naturalHeight]; } catch (e) { return null; }
        };
        const apple = document.querySelector('link[rel="apple-touch-icon"]');
        return {
            nombre: m.short_name, display: m.display, inicio: m.start_url, alcance: m.scope,
            i192: await cargan(m.icons.find(i => i.sizes === '192x192').src),
            i512: await cargan(m.icons.find(i => i.sizes === '512x512' && i.purpose === 'any').src),
            maskable: !!m.icons.find(i => i.purpose === 'maskable'),
            apple: apple ? await cargan(apple.getAttribute('href')) : null,
            titulo: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content
        };
    });
    igual('instalar: el manifiesto la abre como app a pantalla completa', [manifiesto.display, manifiesto.alcance], ['standalone', '/docs/']);
    verificar('instalar: arranca dentro de la app', manifiesto.inicio.startsWith('/docs/'), manifiesto.inicio);
    igual('instalar: ícono de 192 px para Android', manifiesto.i192, [192, 192]);
    igual('instalar: ícono de 512 px para Android', manifiesto.i512, [512, 512]);
    igual('instalar: ícono adaptable (maskable)', manifiesto.maskable, true);
    igual('instalar: ícono para la pantalla de inicio del iPhone', manifiesto.apple, [180, 180]);
    igual('instalar: nombre corto bajo el ícono', manifiesto.titulo, 'TSJ Filing');

    // Instalación nativa (Android/Chrome): el botón abre la ventana del navegador.
    const nativo = await page.evaluate(async () => {
        let pedida = false;
        const evento = new Event('beforeinstallprompt');
        evento.prompt = () => { pedida = true; };
        evento.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(evento);
        await iniciarTour('instalar');
        await new Promise(res => setTimeout(res, 300));
        const boton = [...document.querySelectorAll('.tour-tarjeta button')].find(b => /Instalar la app/.test(b.textContent));
        boton?.click();
        await new Promise(res => setTimeout(res, 100));
        terminarTour();
        return { boton: !!boton, pedida };
    });
    igual('instalar: con Chrome, un botón "Instalar la app"', nativo.boton, true);
    igual('instalar: que abre la ventana de instalación del navegador', nativo.pedida, true);
    // El botón del menú abre las instrucciones sin dejar la página en blanco.
    const menu = await page.evaluate(async () => {
        document.getElementById('menuToggle').click();
        await new Promise(res => setTimeout(res, 100));
        const boton = document.querySelector('#mobileNav .nav-instalar');
        const visible = !!boton && boton.getBoundingClientRect().height > 0;
        boton.click();
        await new Promise(res => setTimeout(res, 150));
        const r = { visible, modal: !!document.getElementById('modal-instalar'),
            pagina: !!document.querySelector('.page.active') };
        cerrarModalInstalar();
        return r;
    });
    igual('instalar: está en el menú del celular', menu.visible, true);
    igual('instalar: el menú abre las instrucciones', menu.modal, true);
    igual('instalar: sin dejar la página en blanco', menu.pagina, true);
    igual('instalar: sin errores de JavaScript', errores, []);
    await contexto.close();

    // iPhone: los pasos de Safari, justo después de la bienvenida.
    ({ contexto, page, errores } = await abrir({ userAgent: UA.iphone }));
    const ios = await pasoInstalar(page);
    verificar('instalar iPhone: es lo primero tras la bienvenida', /Antes que nada/.test(ios.titulo) && /2 de/.test(ios.progreso), `${ios.titulo} · ${ios.progreso}`);
    verificar('instalar iPhone: enseña Compartir → Agregar a pantalla de inicio',
        /Compartir/.test(ios.texto) && /Agregar a pantalla de inicio/.test(ios.texto), ios.texto);
    await contexto.close();

    // Android sin ventana nativa: el menú ⋮.
    ({ contexto, page, errores } = await abrir({ userAgent: UA.android }));
    const android = await pasoInstalar(page);
    verificar('instalar Android: enseña Instalar app desde el menú',
        /Instalar app/.test(android.texto) && /Agregar a pantalla principal/.test(android.texto), android.texto);
    await contexto.close();

    // Ya instalada: el paso se salta y el botón del menú desaparece.
    ({ contexto, page, errores } = await abrir({ userAgent: UA.iphone },
        () => Object.defineProperty(navigator, 'standalone', { get: () => true })));
    const yaInstalada = await pasoInstalar(page);
    igual('instalar: si ya está instalada, el recorrido no lo pide', /Antes que nada/.test(yaInstalada.titulo), false);
    igual('instalar: y el menú ya no lo ofrece', await page.evaluate(() =>
        getComputedStyle(document.querySelector('#mobileNav .nav-instalar')).display), 'none');
    await contexto.close();
}

/**
 * Recorrido guiado: se ofrece (no se impone) a quien llega sin expedientes,
 * no se repite, y cada paso señala un elemento que existe.
 */
async function probarRecorridoGuiado(navegador) {
    const contexto = await navegador.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof iniciarTour === 'function' && typeof db !== 'undefined' && !!db, { timeout: 15000 });
        const oferta = await page.waitForSelector('#tour-oferta', { timeout: 6000 }).then(() => true).catch(() => false);
        igual('recorrido: se ofrece a quien llega por primera vez', oferta, true);
        const r = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            const out = {};
            const o = document.getElementById('tour-oferta').getBoundingClientRect();
            const fabs = ['voz-fab', 'fab-feedback', 'tour-fab'].map(id => document.getElementById(id)?.getBoundingClientRect()).filter(Boolean);
            out.noTapaBotones = fabs.every(f => o.right <= f.left || o.left >= f.right || o.bottom <= f.top || o.top >= f.bottom);
            out.sinOscurecer = !document.querySelector('.tour-resaltado');
            [...document.querySelectorAll('#tour-oferta button')].find(b => /Ahora no/.test(b.textContent)).click();
            await pausa(100);
            out.cierra = !document.getElementById('tour-oferta');
            out.recuerda = localStorage.getItem('tour_bienvenida_visto') === '1';

            // El botón 🧭 abre los recorridos.
            document.getElementById('tour-fab').click();
            await pausa(100);
            out.menu = [...document.querySelectorAll('#tour-menu button')].length;
            document.body.click();
            await pausa(50);
            out.menuCierra = !document.getElementById('tour-menu');

            // Cada recorrido, paso por paso: el elemento señalado existe.
            out.sinObjetivo = [];
            out.pasos = 0;
            for (const [clave, rec] of Object.entries(RECORRIDOS_TOUR)) {
                await iniciarTour(clave);
                for (let i = 0; i < rec.pasos.length; i++) {
                    await pausa(350);
                    const tarjeta = document.querySelector('.tour-tarjeta');
                    if (!tarjeta) break;
                    const paso = rec.pasos.find(p => tarjeta.querySelector('.tour-titulo')?.textContent === p.titulo);
                    if (paso && paso.objetivo && tarjeta.classList.contains('centrada')) out.sinObjetivo.push(`${clave}: ${paso.objetivo}`);
                    out.pasos++;
                    const sig = tarjeta.querySelector('.tour-siguiente');
                    if (/Terminar/.test(sig.textContent)) { sig.click(); break; }
                    sig.click();
                }
                await pausa(200);
                if (document.querySelector('.tour-tarjeta')) terminarTour();
            }

            // Durante el recorrido la página se sigue usando y Esc lo cierra.
            await iniciarTour('laboral');
            await pausa(400);
            const campo = document.getElementById('lab-ingreso');
            const c = campo.getBoundingClientRect();
            const debajo = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
            out.noBloquea = debajo === campo || campo.contains(debajo);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            await pausa(100);
            out.escCierra = !document.querySelector('.tour-tarjeta') && !document.querySelector('.tour-resaltado');
            return out;
        });
        igual('recorrido: la oferta no tapa los botones flotantes', r.noTapaBotones, true);
        igual('recorrido: ofrecer no oscurece la pantalla', r.sinOscurecer, true);
        igual('recorrido: "Ahora no" la cierra', r.cierra, true);
        igual('recorrido: y se recuerda', r.recuerda, true);
        igual('recorrido: el botón 🧭 lista los recorridos', r.menu, 7);
        igual('recorrido: el menú se cierra al tocar fuera', r.menuCierra, true);
        igual('recorrido: cada paso señala un elemento que existe', r.sinObjetivo, []);
        verificar('recorrido: se recorren todos los pasos', r.pasos >= 20, String(r.pasos));
        igual('recorrido: no bloquea la página', r.noBloquea, true);
        igual('recorrido: Esc lo cierra', r.escCierra, true);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        igual('recorrido: no se vuelve a ofrecer', await page.evaluate(() => !!document.getElementById('tour-oferta')), false);
        await page.goto(`http://localhost:${PUERTO}/?tour=1`, { waitUntil: 'domcontentloaded' });
        const pedido = await page.waitForSelector('#tour-oferta', { timeout: 6000 }).then(() => true).catch(() => false);
        igual('recorrido: ?tour=1 (desde las páginas públicas) lo ofrece de nuevo', pedido, true);
        await page.goto(`http://localhost:${PUERTO}/#laboral`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        igual('enlace directo: #laboral abre la calculadora',
            await page.evaluate(() => document.getElementById('page-laboral').classList.contains('active')), true);
        igual('recorrido: sin errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
    }
}

/** Páginas públicas: se ven, la calculadora calcula y llevan a la app. */
async function probarSitioPublico(navegador) {
    const servidor = await servidorEstatico(PUERTO + 1, __dirname);
    const contexto = await navegador.newContext({ viewport: { width: 1300, height: 900 } });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    try {
        for (const ruta of ['/', '/estrados-tsj-quintana-roo/', '/expedientes-pjf-quintana-roo/', '/calculadora-finiquito-liquidacion/']) {
            const resp = await page.goto(`http://localhost:${PUERTO + 1}${ruta}`, { waitUntil: 'load' });
            const r = await page.evaluate(() => ({
                h1: document.querySelector('h1')?.textContent || '',
                estilos: getComputedStyle(document.querySelector('.sitio-header')).position === 'sticky',
                cta: [...document.querySelectorAll('a[href^="/docs/"]')].length,
                ancho: document.documentElement.scrollWidth <= window.innerWidth
            }));
            igual(`sitio ${ruta}: responde`, resp.status(), 200);
            verificar(`sitio ${ruta}: tiene título principal`, r.h1.length > 10, r.h1);
            igual(`sitio ${ruta}: con sus estilos`, r.estilos, true);
            verificar(`sitio ${ruta}: invita a abrir la app`, r.cta >= 2, String(r.cta));
            igual(`sitio ${ruta}: botón para recomendar por WhatsApp`,
                await page.evaluate(() => /^https:\/\/wa\.me\/\?text=.*utm_source%3Drecomendacion/.test(document.querySelector('.sitio-recomendar')?.href || '')), true);
            igual(`sitio ${ruta}: sin desbordarse a lo ancho`, r.ancho, true);
        }
        // La calculadora pública calcula de verdad.
        await page.goto(`http://localhost:${PUERTO + 1}/calculadora-finiquito-liquidacion/`, { waitUntil: 'load' });
        const calc = await page.evaluate(async () => {
            const fijar = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
            fijar('lab-ingreso', '2020-01-15'); fijar('lab-baja', '2026-09-26'); fijar('lab-salario', '15000');
            await new Promise(res => setTimeout(res, 100));
            const esperado = CalculadoraLaboral.calcular({ supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-15',
                fechaBaja: '2026-09-26', salario: 15000, periodo: 'mensual', calcularISR: true });
            return {
                total: document.getElementById('lab-total-bruto')?.textContent,
                esperado: CalculadoraLaboral.dinero(esperado.totales.bruto),
                guardar: !!document.querySelector('#lab-acciones a[href*="/docs/"]')
            };
        });
        igual('sitio calculadora: calcula igual que la app', calc.total, calc.esperado);
        igual('sitio calculadora: guardar lleva a la app', calc.guardar, true);
        // En el celular tampoco se desborda.
        await page.setViewportSize({ width: 390, height: 844 });
        for (const ruta of ['/', '/calculadora-finiquito-liquidacion/']) {
            await page.goto(`http://localhost:${PUERTO + 1}${ruta}`, { waitUntil: 'load' });
            igual(`sitio ${ruta} en celular: sin desbordarse`,
                await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        }
        igual('sitio: sin errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
        servidor.close();
    }
}

/**
 * Sin internet: con la app ya visitada una vez, cortar la red y recargar
 * debe abrirla igual, con los datos guardados y el aviso de sin conexión.
 */
async function probarSinConexion(navegador) {
    const contexto = await navegador.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof crearExpedienteCore === 'function' && typeof db !== 'undefined' && !!db,
            { timeout: 15000 });
        const listo = await page.evaluate(async () => {
            const reg = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise(res => setTimeout(() => res(null), 10000))
            ]);
            return !!reg;
        });
        igual('sin conexión: el service worker se instala', listo, true);
        // Que controle la página (la primera visita la controla tras activarse).
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 10000 }).catch(() => {});
        await page.evaluate(() => crearExpedienteCore({ numero: '404/2026', institucion: 'TSJ',
            juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', comentario: 'Guardado antes de perder la señal' }));
        await page.waitForTimeout(500);

        await contexto.setOffline(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        const abre = await page.waitForFunction(() => typeof navegarA === 'function' && typeof db !== 'undefined' && !!db,
            { timeout: 15000 }).then(() => true).catch(() => false);
        igual('sin conexión: la app abre sin internet', abre, true);
        if (!abre) return;
        await page.waitForTimeout(800);
        const r = await page.evaluate(async () => {
            navegarA('expedientes');
            await new Promise(res => setTimeout(res, 400));
            const titulos = [...document.querySelectorAll('#lista-expedientes .expediente-titulo')].map(h => h.textContent);
            const aviso = document.getElementById('aviso-sin-conexion');
            navegarA('laboral');
            await new Promise(res => setTimeout(res, 300));
            document.getElementById('lab-ingreso').value = '2024-01-01';
            document.getElementById('lab-baja').value = '2026-01-01';
            document.getElementById('lab-salario').value = '9000';
            const calc = recalcularLaboral();
            return {
                datos: titulos.includes('404/2026'),
                aviso: !!aviso && !aviso.hidden && getComputedStyle(aviso).display !== 'none' && aviso.getBoundingClientRect().height > 0,
                estilos: getComputedStyle(document.querySelector('.card')).borderRadius !== '0px',
                calculadora: calc.ok && calc.totales.bruto > 0,
                cierra: (() => { aviso.querySelector('.aviso-cerrar').click(); return aviso.hidden; })()
            };
        });
        igual('sin conexión: los expedientes guardados siguen ahí', r.datos, true);
        igual('sin conexión: avisa que no hay internet', r.aviso, true);
        igual('sin conexión: con sus estilos', r.estilos, true);
        igual('sin conexión: la calculadora laboral funciona', r.calculadora, true);
        igual('sin conexión: el aviso se puede cerrar', r.cierra, true);

        await contexto.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.waitForTimeout(300);
        igual('sin conexión: el aviso se quita al volver la red',
            await page.evaluate(() => document.getElementById('aviso-sin-conexion').hidden), true);
        igual('sin conexión: sin errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
    }
}

/**
 * El calendario y el asistente con el navegador en Cancún (UTC-5).
 *
 * Con el reloj en UTC —el de las máquinas de CI— los fallos de fechas no se
 * ven: el formulario de edición usaba la hora de Greenwich, y abrir una
 * audiencia de las 10:00 y guardarla sin tocar nada la movía a las 15:00.
 */
async function probarCalendarioEnCancun(navegador) {
    const contexto = await navegador.newContext({
        timezoneId: 'America/Cancun', locale: 'es-MX', viewport: { width: 1400, height: 900 }
    });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof crearEventoCore === 'function' && typeof db !== 'undefined' && !!db,
            { timeout: 15000 });
        await page.waitForTimeout(800);

        // ---- El formulario de edición, en hora local ----
        const form = await page.evaluate(async () => {
            const r = {};
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            const diez = new Date(2026, 9, 1, 10).toISOString();
            const veinte = new Date(2026, 9, 1, 20).toISOString();
            const id10 = await crearEventoCore({ titulo: 'A las diez', tipo: 'audiencia', fechaInicio: diez });
            const id20 = await crearEventoCore({ titulo: 'A las ocho de la noche', tipo: 'audiencia', fechaInicio: veinte });
            navegarA('calendario');

            for (const [id, clave, original] of [[id10, 'diez', diez], [id20, 'veinte', veinte]]) {
                await editarEvento(id);
                r[clave + 'Formulario'] = document.getElementById('evento-fecha').value;
                document.getElementById('evento-form').requestSubmit();   // sin tocar nada
                await pausa(400);
                r[clave + 'Intacto'] = (await obtenerEventos()).find(e => e.id === id).fechaInicio === original;
            }

            seleccionarDia(new Date(2026, 9, 5).getTime());
            await mostrarFormularioEvento();
            r.nuevo = document.getElementById('evento-fecha').value;
            r.diaSeleccionadoIntacto = diaSeleccionado.getHours() === 0;
            cerrarModal();

            await editarEvento(id10);
            document.getElementById('evento-fecha').value = '2026-10-08T11:15';
            document.getElementById('evento-form').requestSubmit();
            await pausa(400);
            r.cambiado = (await obtenerEventos()).find(e => e.id === id10).fechaInicio === new Date(2026, 9, 8, 11, 15).toISOString();
            return r;
        });
        igual('cancún: una audiencia de las 10:00 se abre a las 10:00', form.diezFormulario, '2026-10-01T10:00');
        igual('cancún: guardarla sin tocar nada no la mueve', form.diezIntacto, true);
        igual('cancún: una de las 20:00 se abre en su día, no en el siguiente', form.veinteFormulario, '2026-10-01T20:00');
        igual('cancún: y guardarla tampoco la cambia de día', form.veinteIntacto, true);
        igual('cancún: un evento nuevo propone las 9:00', form.nuevo, '2026-10-05T09:00');
        igual('cancún: abrir el formulario no altera el día seleccionado', form.diaSeleccionadoIntacto, true);
        igual('cancún: cambiar la fecha en el formulario la guarda tal cual', form.cambiado, true);

        // ---- Cambiar la fecha y sincronizar ya no la regresa ----
        const sync = await page.evaluate(async () => {
            const nueva = new Date(2026, 9, 19, 9).toISOString();
            const id = await crearEventoCore({ titulo: 'Audiencia sync', tipo: 'audiencia',
                fechaInicio: new Date(2026, 9, 12, 9).toISOString() });
            // La nube tiene la versión de antes del cambio.
            const nube = JSON.parse(JSON.stringify(await obtenerTodosLosDatos()));
            nube.metadata = { ultimaModificacion: Date.now(), dispositivo: 'otro', version: '2.0' };

            await actualizarEventoCore(id, { fechaInicio: nueva });

            const local = await obtenerTodosLosDatos();
            local.metadata = { ultimaModificacion: Date.now(), dispositivo: 'este', version: '2.0' };
            const fusion = fusionarDatos(local, nube);
            await aplicarDatosLocalmente(fusion);
            const aqui = (await obtenerEventos()).filter(e => e.titulo === 'Audiencia sync');

            // Una nube que ya arrastra el duplicado que dejaba el fallo: la
            // versión vieja y la nueva, con el mismo id.
            const sucia = JSON.parse(JSON.stringify(nube));
            sucia.eventos = sucia.eventos.concat(fusion.eventos.filter(e => e.titulo === 'Audiencia sync'));
            const otraVez = await obtenerTodosLosDatos();
            otraVez.metadata = local.metadata;
            const limpia = fusionarDatos(otraVez, sucia);
            await aplicarDatosLocalmente(limpia);
            const despues = (await obtenerEventos()).filter(e => e.titulo === 'Audiencia sync');
            return {
                aqui: aqui.length,
                fechaNueva: !!aqui[0] && aqui[0].fechaInicio === nueva,
                subeALaNube: fusion.eventos.filter(e => e.titulo === 'Audiencia sync').length,
                duplicadoLimpio: limpia.eventos.filter(e => e.titulo === 'Audiencia sync').length,
                sigueNueva: despues.length === 1 && despues[0].fechaInicio === nueva
            };
        });
        igual('sync: tras sincronizar sigue habiendo un solo evento', sync.aqui, 1);
        igual('sync: con la fecha nueva (antes volvía la vieja)', sync.fechaNueva, true);
        igual('sync: y a la nube sube uno solo', sync.subeALaNube, 1);
        igual('sync: el duplicado que ya estuviera en la nube se limpia', sync.duplicadoLimpio, 1);
        igual('sync: y la fecha sigue siendo la nueva', sync.sigueNueva, true);

        // ---- Google Calendar y meses ----
        const varios = await page.evaluate(async () => {
            const id = await crearEventoCore({ titulo: 'Para Google', tipo: 'otro',
                fechaInicio: new Date(2026, 9, 1, 20).toISOString(), todoElDia: true });
            const ev = await obtenerEvento(id);

            navegarA('calendario');
            fechaCalendario = new Date(2026, 9, 31);
            mesSiguiente();
            await new Promise(res => setTimeout(res, 250));
            const siguiente = document.getElementById('mes-actual').textContent;
            fechaCalendario = new Date(2026, 9, 31);
            mesAnterior();
            await new Promise(res => setTimeout(res, 250));
            const anterior = document.getElementById('mes-actual').textContent;

            return {
                obtenerEvento: !!ev && ev.id === id,
                urlGoogle: decodeURIComponent(GCAL.urlAgregarGCal(ev)),
                siguiente, anterior
            };
        });
        igual('google: obtenerEvento existe y devuelve el evento (sin él no se guardaba el id de Google)',
            varios.obtenerEvento, true);
        verificar('google: todo el día en su día local, hasta el siguiente',
            varios.urlGoogle.includes('dates=20261001/20261002'), varios.urlGoogle);
        igual('meses: desde el 31 de octubre, "siguiente" es noviembre', varios.siguiente, 'Noviembre 2026');
        igual('meses: y "anterior" es septiembre', varios.anterior, 'Septiembre 2026');

        // ---- El evento de un pendiente ----
        const pend = await page.evaluate(async () => {
            const nueva = new Date(2026, 9, 9).toISOString();
            const idP = await crearPendienteCore({ titulo: 'Contestar demanda (UI)',
                fechaLimite: new Date(2026, 9, 5).toISOString(), todoElDia: true });
            const p = await obtenerPendiente(idP);
            await actualizarEventoCore(p.eventoId, { fechaInicio: nueva });
            await actualizarPendienteCore(idP, { prioridad: 'alta' });
            return {
                pendiente: (await obtenerPendiente(idP)).fechaLimite === nueva,
                evento: (await obtenerEvento(p.eventoId)).fechaInicio === nueva
            };
        });
        igual('pendiente: moverlo en el calendario lo mueve también en pendientes', pend.pendiente, true);
        igual('pendiente: y subirle la prioridad ya no lo regresa a la fecha vieja', pend.evento, true);

        // ---- El asistente de punta a punta, con el modelo simulado ----
        const voz = await page.evaluate(async () => {
            const r = {};
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            const esperar = async (condicion, ms = 5000) => {
                const hasta = Date.now() + ms;
                while (Date.now() < hasta) { if (await condicion()) return true; await pausa(50); }
                return false;
            };
            const confirmacion = () => document.getElementById('voz-confirmacion');
            const confirmacionVisible = () => confirmacion() && confirmacion().style.display !== 'none';

            try { localStorage.setItem('voz_auto_escucha', '0'); } catch (e) { /* sin almacenamiento */ }
            await guardarConfig('ia_api_key', 'CLAVE-DE-PRUEBA');
            let respuesta = null;
            const historiales = [];
            window.llamarIA = async (_, opciones) => {
                historiales.push(JSON.parse(JSON.stringify((opciones && opciones.historial) || [])));
                return JSON.stringify(respuesta);
            };
            const abiertas = [];
            const openOriginal = window.open;
            window.open = (url, nombre) => { abiertas.push({ url, nombre }); return { focus() {} }; };

            const decir = async (texto, delModelo) => {
                respuesta = delModelo;
                const mensajes = document.querySelectorAll('#voz-chat .voz-msg').length;
                document.getElementById('voz-input').value = texto;
                document.getElementById('voz-enviar').click();
                // Hasta que conteste: con una confirmación o con un mensaje.
                await esperar(() => confirmacionVisible() || document.querySelectorAll('#voz-chat .voz-msg').length > mensajes + 1);
            };

            try {
                await VOZ.abrir();
                const tts = document.getElementById('voz-tts-toggle');
                if (tts && tts.textContent === '🔊') tts.click();

                // 1) La queja y el amparo directo: se confirma viendo la lista exacta.
                await decir('busca la queja y el amparo directo 486/2026 en el primer colegiado del 27', {
                    accion: 'buscar_pjf', faltan_datos: false, resumen: 'Buscar',
                    parametros: { numero: '486/2026', organismo: 'primer tribunal colegiado del 27 circuito',
                                  tiposAsunto: ['queja', 'amparo directo'] }
                });
                r.confirmaBusqueda = confirmacionVisible();
                r.listaBusqueda = [...document.querySelectorAll('#voz-confirmacion-texto li')].map(li => li.textContent);
                r.abiertasAntesDeConfirmar = abiertas.length;
                document.getElementById('voz-btn-confirmar').click();
                await esperar(() => abiertas.length >= 2, 3000);
                r.abiertas = abiertas.map(a => a.url);

                // 2) TSJ y PJF en la misma orden.
                abiertas.length = 0;
                await decir('busca el 123/2025 en el primero civil de Cancún y el amparo indirecto 45/2026 en el primero de distrito de Quintana Roo', {
                    accion: 'buscar_varios', faltan_datos: false, resumen: 'Buscar',
                    parametros: { busquedas: [
                        { accion: 'buscar_tsj', parametros: { valor: '123/2025', tipoBusqueda: 'numero', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' } },
                        { accion: 'buscar_pjf', parametros: { numero: '45/2026', organismo: 'juzgado primero de distrito en quintana roo', tiposAsunto: ['amparo indirecto'] } }
                    ] }
                });
                r.confirmaMixta = confirmacionVisible();
                document.getElementById('voz-btn-confirmar').click();
                await esperar(() => abiertas.length >= 2, 3000);
                r.mixtas = abiertas.map(a => a.url);

                // 3) Cambiar un evento: la confirmación dice el antes y el después.
                const id = await crearEventoCore({ titulo: 'Audiencia por voz', tipo: 'audiencia',
                    fechaInicio: new Date(2026, 9, 1, 10).toISOString(), descripcion: 'Sala 3' });
                await decir('cambia la audiencia por voz al viernes a las 12', {
                    accion: 'editar_evento', faltan_datos: false, resumen: 'Cambiar',
                    parametros: { ediciones: [{ eventoId: null, buscar: { texto: 'audiencia por voz' },
                        cambios: { fecha: '2026-10-02', hora: '12:00', descripcion: '' } }] }
                });
                r.textoConfirmacionEvento = document.getElementById('voz-confirmacion-texto').textContent;
                document.getElementById('voz-btn-confirmar').click();
                await pausa(600);
                const editado = await obtenerEvento(id);
                r.eventoMovido = editado.fechaInicio === new Date(2026, 9, 2, 12).toISOString();
                r.descripcionIntacta = editado.descripcion === 'Sala 3';

                // 4) Dos juntas el mismo día: se ofrecen para elegir.
                await crearEventoCore({ titulo: 'Junta A', tipo: 'otro', fechaInicio: new Date(2026, 9, 20, 9).toISOString() });
                const idB = await crearEventoCore({ titulo: 'Junta B', tipo: 'otro', fechaInicio: new Date(2026, 9, 20, 17).toISOString() });
                await decir('mueve la junta del 20 al 21', {
                    accion: 'editar_evento', faltan_datos: false, resumen: 'Mover',
                    parametros: { ediciones: [{ eventoId: null, buscar: { texto: 'junta', fecha: '2026-10-20' },
                        cambios: { fecha: '2026-10-21' } }] }
                });
                const filas = [...document.querySelectorAll('#voz-chat .voz-resultado')].filter(f => /Junta [AB]/.test(f.textContent));
                r.opciones = filas.length;
                const filaB = filas.find(f => /Junta B/.test(f.textContent));
                if (filaB) filaB.querySelector('button').click();
                await esperar(confirmacionVisible, 3000);
                r.confirmaLaElegida = /Junta B/.test(document.getElementById('voz-confirmacion-texto').textContent);
                document.getElementById('voz-btn-confirmar').click();
                await pausa(600);
                r.juntaB = (await obtenerEvento(idB)).fechaInicio === new Date(2026, 9, 21, 17).toISOString();

                // 5) Cálculo laboral: pide lo que falta, de uno en uno, y calcula.
                const ultimoMensaje = () => { const m = document.querySelectorAll('#voz-chat .voz-msg'); return m[m.length - 1].textContent; };
                await decir('calcula la liquidación de un trabajador que despidieron hoy', {
                    accion: 'calcular_laboral', faltan_datos: false, resumen: 'Calcular',
                    parametros: { supuesto: 'despidoInjustificado', fechaBaja: '2026-09-26' }
                });
                r.laboralPide1 = ultimoMensaje();
                await decir('entró el 15 de enero de 2020 y ganaba 15 mil', {
                    accion: 'calcular_laboral', faltan_datos: false, resumen: 'Calcular',
                    parametros: { supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-15', fechaBaja: '2026-09-26', salario: '15,000' }
                });
                r.laboralHistorial = historiales[historiales.length - 1].map(t => t.content).join('\n');
                r.laboralPide2 = ultimoMensaje();
                await decir('al mes', {
                    accion: 'calcular_laboral', faltan_datos: false, resumen: 'Calcular',
                    parametros: { supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-15', fechaBaja: '2026-09-26', salario: 15000, periodo: 'al mes' }
                });
                const esperado = CalculadoraLaboral.calcular({ supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-15',
                    fechaBaja: '2026-09-26', salario: 15000, periodo: 'mensual' });
                r.laboralTotalEsperado = CalculadoraLaboral.dinero(esperado.totales.bruto);
                r.laboralResultado = ultimoMensaje();
                const botones = [...document.querySelectorAll('#voz-chat .voz-laboral-btns button')];
                r.laboralBotones = botones.map(b => b.textContent);
                const notasAntes = (await obtenerNotas()).length;
                botones.find(b => /Guardar/.test(b.textContent)).click();
                await esperar(async () => (await obtenerNotas()).length > notasAntes, 3000);
                const nota = (await obtenerNotas()).find(n => /TOTAL BRUTO/.test(n.contenido) && n.titulo.includes(r.laboralTotalEsperado));
                r.laboralNota = !!nota;
                if (nota) await eliminarNotaCore(nota.id);
                botones.find(b => /calculadora/.test(b.textContent)).click();
                await esperar(() => document.getElementById('page-laboral').classList.contains('active') &&
                    document.getElementById('lab-total-bruto')?.textContent === r.laboralTotalEsperado, 3000);
                r.laboralFormulario = [document.getElementById('lab-supuesto').value, document.getElementById('lab-ingreso').value,
                    document.getElementById('lab-salario').value, document.getElementById('lab-periodo').value,
                    document.getElementById('lab-total-bruto')?.textContent];
            } finally {
                window.open = openOriginal;
            }
            return r;
        });
        igual('voz: dos tipos de asunto piden confirmación', voz.confirmaBusqueda, true);
        igual('voz: enseñando las dos consultas', voz.listaBusqueda.length, 2);
        verificar('voz: con sus nombres', voz.listaBusqueda.some(t => /Queja 486\/2026/.test(t)) &&
            voz.listaBusqueda.some(t => /Amparo Directo 486\/2026/.test(t)), JSON.stringify(voz.listaBusqueda));
        igual('voz: nada se abre antes de confirmar', voz.abiertasAntesDeConfirmar, 0);
        igual('voz: al confirmar se abren las dos', voz.abiertas.length, 2);
        igual('voz: TSJ y PJF en una orden también se confirman', voz.confirmaMixta, true);
        verificar('voz: y se abren las dos, cada una en su portal',
            voz.mixtas.length === 2 && voz.mixtas.some(u => /tsjqroo/.test(u)) && voz.mixtas.some(u => /dgej\.cjf/.test(u)),
            JSON.stringify(voz.mixtas));
        verificar('voz: la confirmación del evento enseña el antes y el después en hora local',
            /1 de octubre( de 2026)?, 10:00 → viernes, 2 de octubre( de 2026)?, 12:00/.test(voz.textoConfirmacionEvento), voz.textoConfirmacionEvento);
        igual('voz: el evento queda donde se pidió', voz.eventoMovido, true);
        igual('voz: sin perder su descripción', voz.descripcionIntacta, true);
        igual('voz: con dos juntas ese día, ofrece las dos', voz.opciones, 2);
        igual('voz: al elegir una, confirma esa', voz.confirmaLaElegida, true);
        igual('voz: y mueve la elegida', voz.juntaB, true);
        verificar('voz laboral: sin fecha de ingreso, la pide', /¿En qué fecha entró a trabajar\?/.test(voz.laboralPide1), voz.laboralPide1);
        verificar('voz laboral: enseña lo que ya lleva', /Llevo: Despido injustificado/.test(voz.laboralPide1), voz.laboralPide1);
        verificar('voz laboral: el modelo ve la pregunta que se hizo', /En qué fecha entró a trabajar/.test(voz.laboralHistorial), voz.laboralHistorial);
        verificar('voz laboral: con salario sin periodo, pregunta cada cuándo', /\$15,000\.00 eran por día, por semana, por quincena o por mes/.test(voz.laboralPide2), voz.laboralPide2);
        verificar('voz laboral: completo, calcula con el motor', voz.laboralResultado.includes('Total bruto: ' + voz.laboralTotalEsperado), voz.laboralResultado);
        verificar('voz laboral: sugiere sumar el juicio', /cuántos meses duró/.test(voz.laboralResultado), voz.laboralResultado);
        igual('voz laboral: ofrece abrir, guardar y copiar', voz.laboralBotones.length, 3);
        igual('voz laboral: guardar crea la nota', voz.laboralNota, true);
        igual('voz laboral: abre la calculadora con los datos',
            voz.laboralFormulario, ['despidoInjustificado', '2020-01-15', '15000', 'mensual', voz.laboralTotalEsperado]);

        igual('cancún: la página no lanza errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
    }
}

/**
 * Lo que da de alta la IA tiene que poder consultarse en su tribunal sin que
 * nadie teclee ids: el expediente federal con su órgano y su tipo de asunto,
 * el del TSJ con el nombre del catálogo. Antes la búsqueda pedía "ID de
 * Organismo" y un tipo de asunto en un selector que solo ofrecía "Otro" y no
 * dejaba escribir. Y los anuncios destacados se turnan al cambiar de pantalla.
 */
async function probarAltaConIAyConsulta(navegador) {
    const contexto = await navegador.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof guardarResultadosIA === 'function' && typeof db !== 'undefined' && !!db,
            { timeout: 15000 });
        await page.waitForTimeout(1200);   // los anuncios se pintan a los 500 ms

        // ---- Alta desde el análisis de un acuerdo ----
        const alta = await page.evaluate(async () => {
            const guardar = async (resultado) => {
                resultadosIAActuales = { expedienteId: null, expedienteTexto: null, fechas: [],
                    puntos_importantes: [], acciones_requeridas: [], montos: [], ...resultado };
                await guardarResultadosIA();
                return (await obtenerExpedientes()).find(e => e.numero === resultado.numero_expediente) || null;
            };
            return {
                federal: await guardar({ numero_expediente: '321/2026', institucion: 'PJF',
                    juzgado_origen: 'JUZGADO SEGUNDO DE DISTRITO EN EL ESTADO DE QUINTANA ROO, CON RESIDENCIA EN CANCÚN',
                    tipo_asunto: 'Juicio de Amparo Indirecto' }),
                colegiado: await guardar({ numero_expediente: '486/2026', institucion: 'PJF',
                    juzgado_origen: 'Primer Tribunal Colegiado del Vigésimo Séptimo Circuito', tipo_asunto: null }),
                estatal: await guardar({ numero_expediente: '654/2026', institucion: 'TSJ',
                    juzgado_origen: 'Juzgado Primero Civil de Primera Instancia del Distrito Judicial de Cancún, Quintana Roo' }),
                malEtiquetado: await guardar({ numero_expediente: '777/2026', institucion: 'TSJ',
                    juzgado_origen: 'Juzgado Tercero de Distrito en el Estado de Quintana Roo' }),
                sinOrgano: await guardar({ numero_expediente: '888/2026', institucion: 'PJF', juzgado_origen: null })
            };
        });

        const f = alta.federal || {};
        igual('alta IA: el federal queda con su órgano del catálogo', f.pjfOrgId, '790');
        igual('alta IA: y con el tipo de asunto que dice el acuerdo (Amparo Indirecto)', f.pjfTipoAsunto, '1');
        igual('alta IA: con el nombre oficial del órgano',
            f.juzgado, 'Juzgado Segundo de Distrito en el Estado de Quintana Roo');
        igual('alta IA: y en la categoría federal', f.categoria, 'PJF Federal');
        igual('alta IA: un colegiado sin tipo dicho queda como Amparo Directo',
            [alta.colegiado && alta.colegiado.pjfOrgId, alta.colegiado && alta.colegiado.pjfTipoAsunto], ['462', '10']);
        igual('alta IA: el del TSJ queda con el nombre del catálogo',
            alta.estatal && alta.estatal.juzgado, 'JUZGADO PRIMERO CIVIL CANCUN');
        igual('alta IA: y en su categoría', alta.estatal && alta.estatal.categoria, 'CANCÚN - Civil');
        igual('alta IA: un Juzgado de Distrito marcado como TSJ se guarda como federal',
            [alta.malEtiquetado && alta.malEtiquetado.institucion, alta.malEtiquetado && alta.malEtiquetado.pjfOrgId],
            ['PJF', '425']);
        igual('alta IA: sin órgano en el acuerdo no se inventa uno',
            [alta.sinOrgano && alta.sinOrgano.institucion, alta.sinOrgano && alta.sinOrgano.pjfOrgId],
            ['PJF', undefined]);

        // ---- Buscar en el PJF: directo, sin preguntar nada ----
        const consulta = await page.evaluate(async (idFederal) => {
            const abiertas = [];
            const openOriginal = window.open;
            window.open = (url) => { abiertas.push(url); return { focus() {} }; };
            try {
                await abrirBusquedaPJFGuardado(idFederal);
                const modalFederal = document.getElementById('modal-overlay').classList.contains('active');
                // Uno guardado antes de este arreglo, sin los datos: se deducen al buscarlo.
                const idViejo = await agregarExpediente({ numero: '15/2025', institucion: 'PJF', categoria: 'PJF Federal',
                    juzgado: 'Tercer Tribunal Colegiado del Vigésimo Séptimo Circuito, con residencia en Cancún, Quintana Roo',
                    comentario: 'Amparo en revisión contra la sentencia' });
                await abrirBusquedaPJFGuardado(idViejo);
                const modalViejo = document.getElementById('modal-overlay').classList.contains('active');
                return { abiertas, modalFederal, modalViejo, viejo: await obtenerExpediente(idViejo) };
            } finally {
                window.open = openOriginal;
            }
        }, f.id);

        igual('buscar PJF: no se abre ningún cuadro que pida datos', [consulta.modalFederal, consulta.modalViejo], [false, false]);
        verificar('buscar PJF: abre el portal con el órgano y el tipo de asunto guardados',
            /[?&]tipoasunto=1&organismo=790&expediente=321%2F2026/.test(consulta.abiertas[0] || ''), consulta.abiertas[0]);
        verificar('buscar PJF: uno viejo sin datos también abre directo, con lo deducido',
            /[?&]tipoasunto=11&organismo=1319&/.test(consulta.abiertas[1] || ''), consulta.abiertas[1]);
        igual('buscar PJF: y lo deducido se queda guardado',
            [consulta.viejo.pjfOrgId, consulta.viejo.pjfTipoAsunto], ['1319', '11']);
        verificar('buscar PJF: sin cambiarle el nombre que tenía',
            /con residencia en Cancún/.test(consulta.viejo.juzgado), consulta.viejo.juzgado);

        // ---- Cuando el nombre no basta: se elige de listas, no se teclean ids ----
        const selector = await page.evaluate(async (id) => {
            await abrirBusquedaPJFGuardado(id);
            const $ = (x) => document.getElementById(x);
            const visible = (x) => getComputedStyle($(x)).display !== 'none';
            const r = {
                modal: $('modal-overlay').classList.contains('active'),
                pideId: /ID de Organismo/i.test($('modal-body').textContent),
                organoEs: $('_pjf-pick-org') && $('_pjf-pick-org').tagName,
                circuito: $('_pjf-pick-circuito') && $('_pjf-pick-circuito').value,
                organos: [...$('_pjf-pick-org').options].map(o => o.value).filter(Boolean),
                tipoSinOrgano: $('_pjf-pick-tipo').disabled,
                manualSinOrgano: visible('_pjf-pick-manual-wrap')
            };
            $('_pjf-pick-org').value = '790';
            $('_pjf-pick-org').dispatchEvent(new Event('change'));
            const tipo = $('_pjf-pick-tipo');
            r.tipoSugerido = tipo.options[tipo.selectedIndex] && tipo.options[tipo.selectedIndex].text;
            r.manualConOrgano = visible('_pjf-pick-manual-wrap');
            tipo.value = '__manual__';
            tipo.dispatchEvent(new Event('change'));
            r.manualAlElegirOtro = visible('_pjf-pick-manual-wrap');
            tipo.value = '1';
            tipo.dispatchEvent(new Event('change'));

            const abiertas = [];
            const openOriginal = window.open;
            window.open = (url) => { abiertas.push(url); return { focus() {} }; };
            try { await _confirmarAbrirPJF(); } finally { window.open = openOriginal; }
            r.abiertas = abiertas;
            r.cerrado = !$('modal-overlay').classList.contains('active');
            r.guardado = await obtenerExpediente(id);
            return r;
        }, alta.sinOrgano.id);

        igual('selector: se abre solo cuando el nombre no basta', selector.modal, true);
        igual('selector: ya no pide el "ID de Organismo"', selector.pideId, false);
        igual('selector: el órgano se elige de una lista', selector.organoEs, 'SELECT');
        igual('selector: empezando por el circuito de Quintana Roo', selector.circuito, '54');
        verificar('selector: con los órganos de ese circuito',
            selector.organos.includes('790') && selector.organos.includes('462'), JSON.stringify(selector.organos));
        igual('selector: el tipo espera a que haya órgano', [selector.tipoSinOrgano, selector.manualSinOrgano], [true, false]);
        igual('selector: con el órgano, el tipo más probable ya viene elegido', selector.tipoSugerido, 'Amparo Indirecto');
        igual('selector: sin campo de id a la vista', selector.manualConOrgano, false);
        igual('selector: "Otro" sí deja escribir', selector.manualAlElegirOtro, true);
        verificar('selector: abre el portal con lo elegido',
            /[?&]tipoasunto=1&organismo=790&expediente=888%2F2026/.test(selector.abiertas[0] || ''), selector.abiertas[0]);
        igual('selector: y lo guarda, con el nombre del órgano en lugar de "Por determinar"',
            [selector.guardado.pjfOrgId, selector.guardado.pjfTipoAsunto, selector.guardado.juzgado],
            ['790', '1', 'Juzgado Segundo de Distrito en el Estado de Quintana Roo']);

        // ---- El fallo de "solo sale Otro y no deja escribir" ----
        // Un órgano que el catálogo no conoce no tiene tipos: "Otro" es la única
        // opción y viene ya elegida, así que el campo nunca aparecía.
        const soloOtro = await page.evaluate(async () => {
            const id = await agregarExpediente({ numero: '99/2026', institucion: 'PJF', categoria: 'PJF Federal',
                juzgado: 'Órgano de una importación', pjfOrgId: '987654' });
            await abrirBusquedaPJFGuardado(id);
            const tipo = document.getElementById('_pjf-pick-tipo');
            const r = {
                organo: document.getElementById('_pjf-pick-org').value,
                opciones: [...tipo.options].map(o => o.value),
                campoVisible: getComputedStyle(document.getElementById('_pjf-pick-manual-wrap')).display !== 'none'
            };
            document.getElementById('_pjf-pick-tipo-manual').value = '27';
            const abiertas = [];
            const openOriginal = window.open;
            window.open = (url) => { abiertas.push(url); return { focus() {} }; };
            try { await _confirmarAbrirPJF(); } finally { window.open = openOriginal; }
            r.abiertas = abiertas;
            return r;
        });
        igual('solo "Otro": se respeta el órgano guardado', soloOtro.organo, '987654');
        igual('solo "Otro": es la única opción', soloOtro.opciones, ['__manual__']);
        igual('solo "Otro": y el campo para escribirlo se ve sin tener que cambiar nada', soloOtro.campoVisible, true);
        verificar('solo "Otro": lo escrito llega al portal',
            /[?&]tipoasunto=27&organismo=987654&/.test(soloOtro.abiertas[0] || ''), soloOtro.abiertas[0]);

        // ---- El del TSJ, con su botón de estrados en la tarjeta ----
        const tarjeta = await page.evaluate(async (id) => {
            navegarA('expedientes');
            await cargarExpedientes();
            await new Promise(r => setTimeout(r, 400));
            const card = document.querySelector(`#lista-expedientes [data-id="${id}"]`);
            return { hay: !!card, estrados: !!card && /abrirEstradosExpediente\(/.test(card.innerHTML) };
        }, alta.estatal.id);
        igual('alta IA: el del TSJ sale en Expedientes con su botón de estrados', tarjeta, { hay: true, estrados: true });

        // ---- Anuncios: uno y otro, al cambiar de pantalla ----
        const anuncios = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(r => setTimeout(r, ms));
            const visto = (pagina) => {
                const cuerpo = document.querySelector(`#page-${pagina} .ad-banner .ad-body`);
                const t = cuerpo ? cuerpo.textContent : '';
                return /Edictos/.test(t) ? 'edictos' : /asociarte/.test(t) ? 'socio'
                    : /anunciarte|Espacio/.test(t) ? 'relleno' : '?';
            };
            const ir = async (p) => { navegarA(p); await pausa(30); return visto(p); };

            const recorrido = [];
            for (const p of ['inicio', 'expedientes', 'calendario', 'notas', 'expedientes']) recorrido.push(await ir(p));
            await ir('pendientes');                      // sin anuncio: no gasta turno
            const trasPendientes = await ir('calendario');
            const enConfig = await ir('config');         // solo el de relleno: tampoco
            const trasConfig = await ir('notas');
            const mismaPantalla = await ir('notas');     // pulsar donde ya se está no es cambiar

            document.body.classList.add('ads-hidden');   // premium sin anuncios
            const turno = _turnoAnuncio;
            await ir('expedientes');
            await ir('calendario');
            const ocultosNoGiran = _turnoAnuncio === turno;
            document.body.classList.remove('ads-hidden');

            const enlace = document.querySelector('#page-notas .ad-detallado');
            const ad = ANUNCIOS_CONFIG.find(a => a.id === 'socio-desarrollador');
            return {
                recorrido, ultimo: recorrido[recorrido.length - 1], trasPendientes, enConfig, trasConfig,
                mismaPantalla, ocultosNoGiran,
                ad: ad ? { titulo: ad.titulo, contenido: ad.contenido, llamada: ad.llamada, enlace: ad.enlace } : null,
                pintado: enlace ? { href: enlace.getAttribute('href'), target: enlace.getAttribute('target'),
                                    rel: enlace.getAttribute('rel') } : null
            };
        });

        verificar('anuncios: cada pantalla enseña uno de los dos destacados',
            anuncios.recorrido.every(a => a === 'edictos' || a === 'socio'), JSON.stringify(anuncios.recorrido));
        verificar('anuncios: y al cambiar de pantalla sale el otro',
            anuncios.recorrido.every((a, i, l) => i === 0 || a !== l[i - 1]), JSON.stringify(anuncios.recorrido));
        verificar('anuncios: una pantalla sin anuncio no se salta el turno',
            anuncios.trasPendientes !== anuncios.ultimo, JSON.stringify(anuncios));
        igual('anuncios: Configuración conserva la invitación a anunciarse', anuncios.enConfig, 'relleno');
        verificar('anuncios: y tampoco se salta el turno',
            anuncios.trasConfig !== anuncios.trasPendientes, JSON.stringify(anuncios));
        igual('anuncios: volver a pulsar la misma pantalla no lo cambia', anuncios.mismaPantalla, anuncios.trasConfig);
        igual('anuncios: con los anuncios ocultos no se gira nada', anuncios.ocultosNoGiran, true);

        const ad = anuncios.ad || {};
        verificar('asociarse: pregunta si quiere asociarse con el desarrollador',
            /asociarte con el desarrollador/.test(ad.titulo || ''), ad.titulo);
        verificar('asociarse: el texto no es largo', (ad.contenido || '').length <= 350, `${(ad.contenido || '').length} caracteres`);
        verificar('asociarse: dice a quién busca y qué se ofrece',
            /socios/.test(ad.contenido || '') && /experiencia, clientes o capital/.test(ad.contenido || ''), ad.contenido);
        verificar('asociarse: invita a consultar por WhatsApp', /WhatsApp/.test(ad.llamada || ''), ad.llamada);
        verificar('asociarse: con el número de WhatsApp y el mensaje escrito',
            (ad.enlace || '').startsWith('https://wa.me/529981399930?text=') &&
            /asociarme/.test(decodeURIComponent((ad.enlace || '').split('text=')[1] || '')), ad.enlace);
        if (anuncios.pintado) {
            verificar('asociarse: el enlace no lo descarta el sanitizador', anuncios.pintado.href !== '#', anuncios.pintado.href);
            igual('asociarse: se abre en otra pestaña', anuncios.pintado.target, '_blank');
            verificar('asociarse: sin acceso a la ventana de origen', /noopener/.test(anuncios.pintado.rel || ''),
                anuncios.pintado.rel);
        }

        igual('alta IA y anuncios: sin errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
    }
}

/**
 * Cuentas compartidas del despacho: una función que no está en ningún menú y
 * se abre solo pidiéndosela al asistente. Se recorre como la usaría el
 * despacho: crear la cuenta, el caso de 1,000 y 600, liquidar, anular,
 * archivar de común acuerdo, PIN, exportar, y lo que llega de otro
 * dispositivo de la misma licencia.
 */
async function probarCuentasCompartidas(navegador) {
    const contexto = await navegador.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 860 },
        locale: 'es-MX', timezoneId: 'America/Cancun' });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    const pausa = (ms) => page.waitForTimeout(ms);
    const saldos = () => page.$$eval('.cta-saldo', els => els.map(e =>
        e.querySelector('.cta-saldo-nombre').textContent.replace(' (tú)', '') + ' ' +
        (e.classList.contains('positivo') ? '+' : e.classList.contains('negativo') ? '-' : '') +
        e.querySelector('.cta-saldo-monto').textContent));
    const decirAlAsistente = async (texto) => {
        await page.fill('#voz-input', texto);
        await page.press('#voz-input', 'Enter');
        await pausa(400);
    };
    const responderDialogo = async (valor) => {
        if (valor !== undefined) await page.fill('#cta-dialogo input[name="valor"]', valor);
        await page.click('#cta-dialogo button[type="submit"]');
        await pausa(350);
    };
    const registrarGasto = async (concepto, monto, pagoNombre, categoria) => {
        await page.click('[data-acc="nuevo-gasto"]');
        await pausa(250);
        await page.fill('#cta-cuerpo input[name="concepto"]', concepto);
        await page.fill('#cta-cuerpo input[name="monto"]', monto);
        await page.selectOption('#cta-cuerpo select[name="pagadoPor"]', { label: pagoNombre });
        if (categoria) await page.fill('#cta-cuerpo input[name="categoria"]', categoria);
        await page.click('#cta-cuerpo button[type="submit"]');
        await pausa(600);
    };

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.CUENTAS && window.VOZ && typeof db !== 'undefined' && !!db, { timeout: 15000 });
        await pausa(1200);

        // ---- Oculta ----
        const oculta = await page.evaluate(() => ({
            texto: /cuentas compartidas/i.test(document.body.innerText),
            enMenu: [...document.querySelectorAll('nav a, nav button, .mobile-nav a, .mobile-nav button')]
                .some(el => /cuentas/i.test(el.textContent)),
            ventana: !!document.getElementById('cta-overlay')
        }));
        igual('cuentas: no aparecen en ningún lado de la app', oculta, { texto: false, enMenu: false, ventana: false });

        // ---- Se piden al asistente ----
        await page.evaluate(() => VOZ.abrir());
        await pausa(400);
        await decirAlAsistente('abre las cuentas');
        const chat = await page.textContent('#voz-chat');
        verificar('cuentas: el asistente las abre aunque no haya API key', /Todavía no hay cuentas compartidas/.test(chat), chat.slice(-200));
        await page.click('#voz-chat .voz-chip:has-text("Nueva cuenta")');
        await pausa(500);
        igual('cuentas: al elegir se cierra el asistente', await page.evaluate(() => document.getElementById('voz-panel').classList.contains('activo')), false);
        igual('cuentas: y se abre la ventana de cuentas', await page.isVisible('#cta-overlay'), true);
        igual('cuentas: con el formulario de cuenta nueva', (await page.textContent('#cta-titulo')).trim(), 'Nueva cuenta compartida');
        igual('cuentas: el botón del asistente no tapa la ventana', await page.isVisible('#voz-fab'), false);

        // ---- Crear: de 2 a 20 participantes ----
        verificar('cuentas: con dos participantes no se puede quitar ninguno',
            await page.$$eval('#cta-nuevos [data-acc="quitar-fila"]', bs => bs.every(b => b.disabled)));
        const agregar = page.locator('[data-acc="agregar-fila"]');
        for (let i = 0; i < 25 && !(await agregar.isDisabled()); i++) await agregar.click();
        igual('cuentas: se pueden agregar hasta 20 participantes, no más', await page.locator('#cta-nuevos .cta-nuevo').count(), 20);
        igual('cuentas: con 20 el botón de agregar se apaga', await agregar.isDisabled(), true);
        while (await page.locator('#cta-nuevos .cta-nuevo').count() > 2) {
            await page.locator('#cta-nuevos [data-acc="quitar-fila"]').last().click();
        }
        await page.fill('#cta-cuerpo input[name="nombre"]', 'Gastos de oficina');
        const nombres = page.locator('#cta-nuevos input[name="p-nombre"]');
        await nombres.nth(0).fill('Jorge');
        await nombres.nth(1).fill('Frida');
        await page.selectOption('#cta-cuerpo select[name="yo"]', 'Jorge');
        await page.click('#cta-cuerpo button[type="submit"]');
        await pausa(700);
        igual('cuentas: creada, se abre', (await page.textContent('#cta-titulo')).trim(), 'Gastos de oficina');
        verificar('cuentas: dice que soy Jorge', /Estás como\s+Jorge/.test(await page.textContent('.cta-yo')));

        // ---- El caso con el que se pidió ----
        await registrarGasto('Renta de octubre', '1,000', 'Jorge', 'Renta');
        igual('cuentas: Jorge paga 1,000 mitad y mitad: 500 a su favor', await saldos(), ['Jorge +$500.00', 'Frida -$500.00']);
        await registrarGasto('Papelería', '600', 'Frida', 'Papelería');
        igual('cuentas: Frida paga 600: se descuentan 300 y queda la diferencia', await saldos(), ['Jorge +$200.00', 'Frida -$200.00']);
        verificar('cuentas: dice cómo quedar a mano', /Frida paga \$200\.00 a Jorge/.test(await page.textContent('.cta-pagos')));
        igual('cuentas: el histórico tiene los dos', await page.locator('.cta-mov').count(), 2);

        // Un 70-30 en un gasto suelto.
        await page.click('[data-acc="nuevo-gasto"]');
        await pausa(250);
        await page.fill('#cta-cuerpo input[name="concepto"]', 'Luz');
        await page.fill('#cta-cuerpo input[name="monto"]', '100');
        const pcts = page.locator('#cta-cuerpo .cta-reparto-fila input[type="text"]');
        await pcts.nth(0).fill('70');
        await pcts.nth(1).fill('20');
        await page.click('#cta-cuerpo button[type="submit"]');
        await pausa(300);
        verificar('cuentas: un reparto que no suma 100% no se guarda',
            /suman 90%/.test(await page.textContent('#cta-error')));
        await pcts.nth(1).fill('30');
        await pausa(150);
        igual('cuentas: se ve cuánto le toca a cada quien', (await page.textContent('[data-cuota]')).trim(), '$70.00');
        await page.click('#cta-cuerpo button[type="submit"]');
        await pausa(600);
        igual('cuentas: 70-30 sobre 100 pagados por Jorge', await saldos(), ['Jorge +$230.00', 'Frida -$230.00']);

        // ---- Liquidar y anular ----
        await page.click('[data-acc="liquidar"]');
        await pausa(300);
        igual('cuentas: "registrar este pago" propone el monto', await page.inputValue('#cta-cuerpo input[name="monto"]'), '230.00');
        await page.click('#cta-cuerpo button[type="submit"]');
        await pausa(600);
        igual('cuentas: tras el pago quedan a mano', await saldos(), ['Jorge $0.00', 'Frida $0.00']);
        verificar('cuentas: lo dice', /Todos están a mano/.test(await page.textContent('#cta-cuerpo')));

        await page.locator('.cta-mov').first().locator('[data-acc="anular"]').click();
        await pausa(300);
        await responderDialogo('');
        verificar('cuentas: anular pide el motivo', /Escribe el motivo/.test(await page.textContent('#cta-dialogo')));
        await responderDialogo('Se registró por error');
        igual('cuentas: el pago anulado deja de contar', await saldos(), ['Jorge +$230.00', 'Frida -$230.00']);
        verificar('cuentas: pero sigue en el histórico con su motivo',
            /Se registró por error/.test(await page.textContent('.cta-anulado')));

        // ---- Exportar ----
        const espera = page.waitForEvent('download', { timeout: 8000 });
        await page.click('[data-acc="csv"]');
        const descarga = await espera.catch(() => null);
        verificar('cuentas: exporta el estado de cuenta en CSV', !!descarga && /^cuenta-gastos-de-oficina-\d{4}-\d{2}-\d{2}\.csv$/.test(descarga.suggestedFilename()),
            descarga && descarga.suggestedFilename());
        if (descarga) {
            const csv = fs.readFileSync(await descarga.path(), 'utf8');
            verificar('cuentas: el CSV trae cada movimiento con la parte de cada quien',
                csv.includes('Renta de octubre') && csv.includes('Parte de Frida') && csv.includes('Anulado'), csv.slice(0, 300));
        }

        // ---- Archivar de común acuerdo ----
        await page.click('[data-acc="solicitar-archivo"]');
        await pausa(300);
        verificar('cuentas: al pedir archivo avisa que hay saldo pendiente', /saldos pendientes/.test(await page.textContent('#cta-dialogo')));
        await responderDialogo('Cerramos el trimestre');
        verificar('cuentas: pedirlo no la archiva: falta Frida', /pidió archivar/.test(await page.textContent('.cta-banner')));
        verificar('cuentas: y se sigue pudiendo registrar', await page.isVisible('[data-acc="nuevo-gasto"]'));

        await page.click('[data-acc="cambiar-yo"]');
        await pausa(300);
        await page.click('#cta-dialogo [data-dialogo]:has-text("Frida")');
        await pausa(400);
        await page.click('[data-acc="confirmar-archivo"]');
        await pausa(300);
        await responderDialogo();
        verificar('cuentas: con la conformidad de los dos queda archivada', /Cuenta archivada/.test(await page.textContent('.cta-banner')));
        igual('cuentas: archivada ya no admite movimientos', await page.isVisible('[data-acc="nuevo-gasto"]'), false);
        igual('cuentas: los saldos se conservan', await saldos(), ['Jorge +$230.00', 'Frida -$230.00']);

        await page.click('[data-acc="reactivar"]');
        await pausa(300);
        await responderDialogo('Falta un recibo');
        igual('cuentas: reactivada vuelve a admitir movimientos', await page.isVisible('[data-acc="nuevo-gasto"]'), true);

        // ---- PIN ----
        await page.click('[data-acc="ajustes"]');
        await pausa(300);
        await page.click('[data-acc="pin-poner"]');
        await pausa(300);
        await responderDialogo('12');
        verificar('cuentas: el PIN pide de 4 a 8 dígitos', /de 4 a 8 dígitos/.test(await page.textContent('#cta-dialogo')));
        await responderDialogo('2468');
        await responderDialogo('2468');
        verificar('cuentas: el PIN queda puesto', /Cambiar mi PIN/.test(await page.textContent('#cta-cuerpo')));
        // Ningún valor guardado es el PIN; lo que se guarda es su huella. (Buscar
        // "2468" en el texto daba falsos fallos: una huella SHA-256 contiene esos
        // dígitos por casualidad una de cada ~800 veces.)
        const pinGuardado = await page.evaluate(async () => {
            const valores = [];
            const recorrer = (v) => {
                if (v && typeof v === 'object') Object.values(v).forEach(recorrer);
                else valores.push(String(v));
            };
            const cuentas = await obtenerCuentasCompartidas();
            recorrer(cuentas);
            const huellas = cuentas.flatMap(c => c.eventos).filter(e => e.tipo === 'pin' && e.pinHash).map(e => e.pinHash);
            return { enClaro: valores.some(v => v === '2468'), huellas };
        });
        verificar('cuentas: el PIN no se guarda en claro',
            !pinGuardado.enClaro && pinGuardado.huellas.length > 0 && pinGuardado.huellas.every(h => /^[0-9a-f]{64}$/.test(h)), JSON.stringify(pinGuardado));
        await page.click('[data-acc="volver"]');
        await pausa(300);
        await page.click('[data-acc="cambiar-yo"]');
        await pausa(300);
        await page.click('#cta-dialogo [data-dialogo]:has-text("Jorge")');
        await pausa(300);
        await page.click('[data-acc="cambiar-yo"]');
        await pausa(300);
        await page.click('#cta-dialogo [data-dialogo]:has-text("Frida")');
        await pausa(300);
        await responderDialogo('0000');
        verificar('cuentas: con otro PIN no se puede actuar como Frida', /PIN incorrecto/.test(await page.textContent('#cta-dialogo')));
        await responderDialogo('2468');
        verificar('cuentas: con el suyo sí', /Estás como\s+Frida/.test(await page.textContent('.cta-yo')));

        // ---- Lo que llega de otro dispositivo de la licencia ----
        const otro = await page.evaluate(async () => {
            const local = await obtenerTodosLosDatos();
            local.metadata = { ultimaModificacion: Date.now(), dispositivo: 'este', version: '2.0' };
            const nube = JSON.parse(JSON.stringify(local));
            const c = nube.cuentas[0];
            const ids = c.eventos[0].participantes.map(p => p.id);
            c.eventos.push({ id: 'ev_zzzotro', fecha: new Date(Date.now() + 1000).toISOString(), dispositivo: 'otro', tipo: 'gasto', por: ids[1],
                mov: { concepto: 'Internet (desde otro dispositivo)', monto: 50000, pagadoPor: ids[1], reparto: { [ids[0]]: 50, [ids[1]]: 50 }, fechaMov: '2026-10-22' } });
            const fusion = fusionarDatos(local, nube);
            const subeAlgo = huellaContenido(fusion) !== huellaContenido(local);
            await aplicarDatosLocalmente(fusion);
            await new Promise(r => setTimeout(r, 400));
            return { subeAlgo, cuentas: fusion.cuentas.length };
        });
        igual('cuentas: lo de otro dispositivo se junta, sin duplicar la cuenta', otro.cuentas, 1);
        verificar('cuentas: y la ventana abierta se actualiza sola',
            /Internet \(desde otro dispositivo\)/.test(await page.textContent('#cta-historial')));
        igual('cuentas: con el saldo nuevo', await saldos(), ['Jorge -$20.00', 'Frida +$20.00']);

        // ---- El catálogo desde el asistente, eligiendo por número ----
        await page.keyboard.press('Escape');
        await pausa(200);
        igual('cuentas: Escape la cierra', await page.isVisible('#cta-overlay'), false);
        await page.evaluate(() => VOZ.abrir());
        await pausa(300);
        await decirAlAsistente('muéstrame las cuentas');
        verificar('cuentas: el catálogo enseña la cuenta con su saldo',
            /1\. Gastos de oficina[\s\S]*Jorge debe \$20\.00 a Frida/.test(await page.textContent('#voz-chat')));
        await decirAlAsistente('la 1');
        await pausa(400);
        igual('cuentas: "la 1" abre la primera', (await page.textContent('#cta-titulo')).trim(), 'Gastos de oficina');

        // ---- Corregir, repetir y ajustes ----
        await page.locator('.cta-mov:has-text("Papelería")').locator('[data-acc="corregir"]').click();
        await pausa(300);
        igual('cuentas: corregir abre el gasto con sus datos', await page.inputValue('#cta-cuerpo input[name="monto"]'), '600.00');
        await page.fill('#cta-cuerpo input[name="monto"]', '800');
        await page.click('#cta-cuerpo button[type="submit"]');
        // Frida tiene PIN y corregir anula el original: se lo pide.
        await responderDialogo('2468');
        await pausa(400);
        igual('cuentas: la corrección sustituye al original', await saldos(), ['Jorge -$120.00', 'Frida +$120.00']);
        verificar('cuentas: y el original queda anulado en el histórico',
            /Corregido: se registró de nuevo/.test(await page.textContent('#cta-historial')));

        await page.locator('.cta-mov:has-text("Renta de octubre")').first().locator('[data-acc="repetir"]').click();
        await pausa(300);
        igual('cuentas: repetir propone el mismo concepto', await page.inputValue('#cta-cuerpo input[name="concepto"]'), 'Renta de octubre');
        await page.click('[data-acc="volver"]');
        await pausa(300);

        // ---- Pagaron varios: un café de 190 mitad y mitad, Jorge 50 y Frida 140 ----
        await page.click('[data-acc="nuevo-gasto"]');
        await pausa(250);
        igual('cuentas: «¿Cuánto puso cada quien?» no aparece si pagó una sola persona', await page.isVisible('#cta-aportes'), false);
        await page.fill('#cta-cuerpo input[name="concepto"]', 'Café');
        await page.fill('#cta-cuerpo input[name="monto"]', '190');
        await page.selectOption('#cta-cuerpo select[name="pagadoPor"]', { label: 'Pagaron varios' });
        await pausa(150);
        igual('cuentas: al elegir «varios» pide cuánto puso cada quien', await page.isVisible('#cta-aportes'), true);
        const aporteDe = (nombre) => page.locator(`#cta-aportes .cta-aporte-fila:has-text("${nombre}") input`);
        await aporteDe('Jorge').fill('50');
        await pausa(150);
        igual('cuentas: con dos que pagaron, lo del otro se completa solo', await aporteDe('Frida').inputValue(), '140.00');
        verificar('cuentas: y dice que cuadra con el monto', /Suman \$190\.00 ✓/.test(await page.textContent('#cta-aportes-suma')));
        igual('cuentas: antes de guardar dice cómo queda el gasto', (await page.textContent('#cta-efecto')).trim(), 'Con este gasto, Jorge te debe $45.00.');
        await aporteDe('Frida').fill('130');
        await pausa(150);
        verificar('cuentas: si no cuadra dice cuánto falta', /faltan \$10\.00/.test(await page.textContent('#cta-aportes-suma')));
        await page.click('#cta-cuerpo button[type="submit"]');
        await pausa(300);
        verificar('cuentas: y no lo guarda', /faltan \$10\.00/.test(await page.textContent('#cta-error')));
        await page.locator('#cta-aportes .cta-aporte-fila:has-text("Frida") [data-acc="aporte-resto"]').click();
        await pausa(150);
        igual('cuentas: «El resto» pone lo que falta', await aporteDe('Frida').inputValue(), '140.00');
        await page.click('#cta-cuerpo button[type="submit"]');
        await pausa(600);
        igual('cuentas: el café deja a Jorge debiendo 45 más', await saldos(), ['Jorge -$165.00', 'Frida +$165.00']);
        verificar('cuentas: el histórico dice cuánto puso cada quien',
            /Pagaron Jorge \(\$50\.00\) y Frida \(\$140\.00\)/.test(await page.textContent('.cta-mov:has-text("Café")')));
        await page.locator('.cta-mov:has-text("Café")').locator('[data-acc="repetir"]').click();
        await pausa(300);
        igual('cuentas: repetir un gasto de varios conserva lo que puso cada quien',
            [await page.inputValue('#cta-cuerpo select[name="pagadoPor"]'), await aporteDe('Jorge').inputValue(), await aporteDe('Frida').inputValue()],
            ['__varios', '50.00', '140.00']);
        await page.click('[data-acc="volver"]');
        await pausa(300);

        await page.click('[data-acc="ajustes"]');
        await pausa(300);
        await page.fill('#cta-cuerpo form[data-form="agregar-participante"] input[name="nombre"]', 'Ana');
        await page.click('#cta-cuerpo form[data-form="agregar-participante"] button[type="submit"]');
        await pausa(500);
        verificar('cuentas: se puede sumar a alguien más', /Ana/.test(await page.textContent('.cta-participantes')));
        const repartoAjustes = page.locator('#cta-cuerpo form[data-form="reparto"] .cta-reparto-fila input[type="text"]');
        await repartoAjustes.nth(0).fill('70');
        await repartoAjustes.nth(1).fill('30');
        await repartoAjustes.nth(2).fill('0');
        await page.click('#cta-cuerpo form[data-form="reparto"] button[type="submit"]');
        await pausa(500);
        await page.locator('[data-acc="renombrar"]').nth(2).click();
        await pausa(300);
        await responderDialogo('Ana López');
        verificar('cuentas: se puede renombrar', /Ana López/.test(await page.textContent('.cta-participantes')));
        await page.click('[data-acc="volver"]');
        await pausa(300);
        igual('cuentas: quien se suma no hereda saldo', (await saldos())[2], 'Ana López $0.00');
        await page.click('[data-acc="nuevo-gasto"]');
        await pausa(300);
        igual('cuentas: el gasto nuevo propone el reparto habitual guardado (70-30, Ana fuera)',
            await page.$$eval('#cta-cuerpo .cta-reparto-fila input[type="text"]', ins => ins.map(i => i.value)), ['70', '30', '0']);
        await page.click('[data-acc="volver"]');
        await pausa(300);

        // Una cuenta vacía se puede eliminar.
        await page.evaluate(() => CUENTAS.abrirNueva());
        await pausa(300);
        await page.fill('#cta-cuerpo input[name="nombre"]', 'Por error');
        await page.locator('#cta-nuevos input[name="p-nombre"]').nth(0).fill('Uno');
        await page.locator('#cta-nuevos input[name="p-nombre"]').nth(1).fill('Dos');
        await page.click('#cta-cuerpo button[type="submit"]');
        await pausa(600);
        await page.click('[data-acc="ajustes"]');
        await pausa(300);
        await page.click('[data-acc="eliminar-cuenta"]');
        await pausa(300);
        await responderDialogo();
        await pausa(300);
        verificar('cuentas: la cuenta vacía desaparece del catálogo',
            !/Por error/.test(await page.textContent('#cta-cuerpo')) && /Gastos de oficina/.test(await page.textContent('#cta-cuerpo')));
        await page.click('.cta-tarjeta:has-text("Gastos de oficina")');
        await pausa(400);

        // ---- En el teléfono ----
        await page.setViewportSize({ width: 390, height: 844 });
        await pausa(300);
        const anchoCuenta = await page.evaluate(() => { const c = document.getElementById('cta-cuerpo'); return c.scrollWidth - c.clientWidth; });
        igual('cuentas: en el teléfono la cuenta no se sale a lo ancho', anchoCuenta, 0);
        await page.click('[data-acc="nuevo-gasto"]');
        await pausa(300);
        const anchoGasto = await page.evaluate(() => { const c = document.getElementById('cta-cuerpo'); return c.scrollWidth - c.clientWidth; });
        igual('cuentas: ni el formulario de gasto', anchoGasto, 0);

        igual('cuentas: sin errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
    }
}

/**
 * Estadísticas del despacho, en un navegador de verdad: el formulario guarda
 * los datos nuevos (cliente, responsable, tipo, inicio, resultado), la página
 * los cuenta, los filtros y las tablas responden, se exporta, y nada se sale
 * de la pantalla en el teléfono.
 */
// Importar el seguimiento semanal (indice_asuntos.json) dos veces: la segunda
// no duplica, actualiza lo que cambió y propone terminar lo que ya no aparece.
async function probarSeguimientoSemanal(navegador) {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-MX', timezoneId: 'America/Cancun' });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    const pausa = (ms) => page.waitForTimeout(ms);
    // Las fechas se escribieron para la revisión del viernes 23-oct-2026 (semana
    // del 26 al 30). Se recorren a la semana que toca hoy, para que lo que entra
    // en el reporte siga entrando corra cuando corra la prueba.
    const SEG = require('./docs/js/seguimiento.js');
    const ahora = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Cancun' });
    const corrimiento = Math.round((Date.parse(SEG.semanaDelReporte(ahora).lunes) - Date.parse('2026-10-26')) / 864e5);
    const F = (f) => { const d = new Date(Date.parse(f) + corrimiento * 864e5); return d.toISOString().slice(0, 10); };
    const indice = [
        { carpeta: 'asunto laboral perez', asunto: 'Juan Pérez Ruiz vs. Fiscalía General del Estado', cliente: 'Juan Pérez Ruiz',
          expedientes: ['DIT-021/2026 (también DIT-21/2026)'], estado: 'EN ESPERA', prioridad: 'MEDIA',
          pendientes: [
              { accion: 'Revisar la lista de estrados para detectar la interlocutoria del incidente', tipo: 'SEGUIMIENTO', fecha_limite: F('2026-10-27'), nota: '' },
              { accion: 'Si declara la incompetencia, preparar amparo indirecto', tipo: 'ESCRITO', fecha_limite: null, nota: 'Inferido' }
          ] },
        { carpeta: 'asuntos lopez / vs arquitectos', asunto: 'Ana López Mar vs Constructora Alfa', cliente: 'Ana López Mar',
          expedientes: ['Exp. 174/2026 (juicio ordinario civil)'], estado: 'ACTIVO', prioridad: 'ALTA',
          audiencias: [{ fecha: F('2027-03-15'), hora: '10:00', descripcion: 'Audiencia de desahogo de pruebas', lugar: 'Juzgado Primero Civil, Cancún' }],
          pendientes: [
              { accion: 'Revisar acuerdo recaído al escrito de 29-sep en el exp. 174/2026', tipo: 'SEGUIMIENTO', fecha_limite: F('2026-10-23'), nota: 'No consta acuerdo' },
              { accion: 'Coordinar con el actuario la nueva diligencia de emplazamiento', tipo: 'AUDIENCIA/DILIGENCIA', fecha_limite: F('2026-10-30'), nota: '' }
          ] },
        { carpeta: 'fit and more', asunto: 'Gimnasio Fit and More — subarriendo del local', cliente: 'Persona Sin Expediente',
          expedientes: [], estado: 'ACTIVO', prioridad: 'MEDIA',
          pendientes: [{ accion: 'Enviar a la clienta el contrato de subarriendo revisado', tipo: 'ENTREGABLE', fecha_limite: F('2026-10-26') }] },
        { carpeta: 'asunto concluido', asunto: 'Algo que ya terminó', cliente: 'X', expedientes: [], estado: 'CONCLUIDO',
          pendientes: [{ accion: 'Archivar', tipo: 'SEGUIMIENTO', fecha_limite: F('2026-10-26') }] }
    ];
    const elegirArchivo = async (datos) => {
        // Sin botón: se pide al asistente.
        await page.evaluate(() => VOZ.abrir());
        await pausa(300);
        await page.fill('#voz-input', 'actualiza mis pendientes');
        await page.press('#voz-input', 'Enter');
        await pausa(500);
        await page.setInputFiles('#seg-archivo', { name: 'indice_asuntos.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(datos)) });
        await pausa(500);
    };
    const cifras = () => page.$$eval('.seg-cifras li', ls => ls.map(l => l.textContent.trim()));
    const importados = () => page.evaluate(async () => (await obtenerPendientes())
        .filter(p => p.origen && p.origen.tipo === 'seguimiento')
        .map(p => ({ titulo: p.titulo, exp: p.expedienteId, dia: p.fechaLimite ? p.fechaLimite.slice(0, 10) : null, local: p.fechaLimite ? new Date(p.fechaLimite).toLocaleDateString('en-CA') : null,
            prioridad: p.prioridad, completado: !!p.completado, eventoId: p.eventoId, texto: p.expedienteTexto }))
        .sort((a, b) => a.titulo.localeCompare(b.titulo)));

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.SEGUIMIENTO && typeof crearExpedienteCore === 'function' && typeof db !== 'undefined' && !!db, { timeout: 15000 });
        await pausa(1000);
        const ids = await page.evaluate(async () => ({
            perez: await crearExpedienteCore({ numero: 'DIT-21/2026', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', nombre: 'Pérez vs FGE', cliente: 'Juan Pérez Ruiz' }),
            lopez: await crearExpedienteCore({ numero: '174/2026', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', nombre: 'López vs Alfa', cliente: 'Ana López Mar' })
        }));
        verificar('seguimiento: no hay botón a la vista', !(await page.evaluate(() => /seguimiento semanal/i.test(document.body.innerText))));

        // ---- Primera importación ----
        await elegirArchivo(indice);
        igual('seguimiento: "actualiza mis pendientes" lleva a Pendientes y abre la importación',
            [await page.evaluate(() => document.getElementById('page-pendientes').classList.contains('active')), (await page.textContent('#modal-titulo')).trim()],
            [true, '📥 Seguimiento semanal']);
        igual('seguimiento: la vista previa dice qué va a pasar', await cifras(), ['5 nuevos', '0 se actualizan', '0 sin cambios', '0 ya no aparecen']);
        verificar('seguimiento: avisa que el concluido no se importa', /1 concluidos no se importan/.test(await page.textContent('.seg-resumen')));
        const porAsignar = await page.$$eval('.seg-asignar strong', s => s.map(x => x.textContent));
        igual('seguimiento: solo pregunta por el asunto que no se pudo unir por número', porAsignar, ['Gimnasio Fit and More — subarriendo del local']);
        // Uno se desmarca: no se crea y no debe volver la semana siguiente.
        await page.locator('.seg-p:has-text("contrato de subarriendo") input[type="checkbox"]').uncheck();
        await page.click('#seg-aplicar');
        await pausa(1500);
        let lista = await importados();
        igual('seguimiento: se crean los cuatro que quedaron marcados', lista.length, 4);
        igual('seguimiento: el desmarcado no se creó', lista.some(p => /subarriendo/.test(p.titulo)), false);
        const revisar = lista.find(p => /29-sep/.test(p.titulo));
        igual('seguimiento: cuelgan de su expediente, con fecha y prioridad',
            [revisar.exp, revisar.local, revisar.prioridad], [ids.lopez, F('2026-10-23'), 'alta']);
        verificar('seguimiento: y con fecha quedan en el calendario', !!revisar.eventoId);
        const audiencias = () => page.evaluate(async () => (await obtenerEventos())
            .filter(e => e.titulo === 'Audiencia de desahogo de pruebas')
            .map(e => ({ tipo: e.tipo, exp: e.expedienteId, hora: new Date(e.fechaInicio).getHours() })));
        igual('seguimiento: la audiencia futura queda en el calendario, a su hora y en su expediente',
            await audiencias(), [{ tipo: 'audiencia', exp: ids.lopez, hora: 10 }]);
        verificar('seguimiento: aparecen en la lista de pendientes', /Coordinar con el actuario/.test(await page.textContent('#lista-pendientes')));

        // ---- El viernes siguiente ----
        const siguiente = JSON.parse(JSON.stringify(indice));
        siguiente[0].pendientes[0].fecha_limite = F('2026-11-03');
        siguiente[0].pendientes.splice(1, 1);
        await page.setViewportSize({ width: 390, height: 844 });
        await elegirArchivo(siguiente);
        igual('seguimiento: la segunda vez no duplica ni vuelve a proponer lo desmarcado', await cifras(), ['0 nuevos', '1 se actualizan', '2 sin cambios', '1 ya no aparecen']);
        verificar('seguimiento: avisa cuántos desmarcados se saltaron', /1 que desmarcaste antes no se proponen/.test(await page.textContent('.seg-resumen')));
        const desborde = await page.evaluate(() => {
            const b = document.getElementById('modal-body');
            return b.scrollWidth - b.clientWidth;
        });
        verificar('seguimiento: la vista previa cabe en un celular', desborde <= 1, 'desborde de ' + desborde + 'px');
        // Este asunto ya no se quiere importar: desde la próxima vez no se muestra.
        await page.click('#seg-asignacion summary');
        await page.selectOption('.seg-exp[data-asunto="fit and more"]', 'omitir');
        await pausa(200);
        await page.click('#seg-aplicar');
        await pausa(1500);
        lista = await importados();
        igual('seguimiento: siguen siendo cuatro', lista.length, 4);
        igual('seguimiento: la fecha nueva se aplicó', lista.find(p => /estrados/.test(p.titulo)).local, F('2026-11-03'));
        igual('seguimiento: el que ya no aparece quedó terminado', lista.find(p => /amparo/.test(p.titulo)).completado, true);
        igual('seguimiento: la audiencia no se duplica', (await audiencias()).length, 1);
        igual('seguimiento: el asunto que no se importa queda anotado para los demás dispositivos',
            await page.evaluate(async () => (await obtenerSeguimientoOmitidos()).map(o => [o.asunto, o.omitir])), [['fit and more', true]]);

        // ---- La semana siguiente, con el asunto que se pidió no importar ----
        await elegirArchivo(siguiente);
        const asignar = () => page.$$eval('.seg-asignar strong', s => s.map(x => x.textContent));
        igual('seguimiento: el asunto que no se importa ya no se muestra aunque venga en el índice', await asignar(), []);
        verificar('seguimiento: solo se cuenta', /1 que pediste no importar/.test(await page.textContent('.seg-resumen')));
        verificar('seguimiento: y se puede recuperar desde su bloque', /Asuntos que pediste no importar \(1\)/.test(await page.textContent('#seg-omitidos summary')));
        verificar('seguimiento: sin nada que traer, no hay qué importar', await page.isDisabled('#seg-aplicar'));
        await page.click('#seg-omitidos summary');
        // Marcarla vuelve a pintar la vista: se hace clic, sin esperar a que siga marcada.
        await page.click('[data-restaurar="fit and more"]');
        await pausa(200);
        igual('seguimiento: al recuperarlo vuelve a la lista', await asignar(), ['Gimnasio Fit and More — subarriendo del local']);
        verificar('seguimiento: y recuperarlo se puede guardar', !(await page.isDisabled('#seg-aplicar')));
        await page.click('#seg-aplicar');
        await pausa(1000);
        igual('seguimiento: ya no queda como "no importar"',
            await page.evaluate(() => Object.prototype.hasOwnProperty.call(JSON.parse(localStorage.getItem('seguimiento_asignaciones') || '{}'), 'fit and more')), false);
        igual('seguimiento: y la recuperación queda anotada para sincronizarse',
            await page.evaluate(async () => (await obtenerSeguimientoOmitidos()).map(o => [o.asunto, o.omitir])), [['fit and more', false]]);

        // ---- Otro dispositivo lo deja de importar después: la sincronización lo trae ----
        await page.evaluate(() => aplicarSeguimientoOmitidos([{ asunto: 'fit and more', omitir: true, el: new Date(Date.now() + 60000).toISOString() }]));
        await elegirArchivo(siguiente);
        igual('seguimiento: lo que se dejó de importar en otro dispositivo tampoco se muestra aquí', await asignar(), []);
        verificar('seguimiento: y se puede recuperar aquí', /Asuntos que pediste no importar \(1\)/.test(await page.textContent('#seg-omitidos summary')));
        await page.evaluate(() => cerrarModal());
        igual('seguimiento: sin errores en la página', errores, []);
    } finally {
        await contexto.close();
    }
}

// Estrados laborales: desde un expediente del TCA se arma el marcador y, en una
// copia simulada de la página de la Secretaría del Trabajo (mismos ids:
// formulario, unidad, fechas con calendario y tabla de DataTables), el
// marcador consulta periodo por periodo y deja en la tabla solo el expediente.
async function probarEstradosLaborales(navegador) {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-MX', timezoneId: 'America/Cancun' });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    const pausa = (ms) => page.waitForTimeout(ms);
    const EL = require('./docs/js/estrados-laborales.js');
    const N = EL.nucleo();
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Cancun' });
    const periodos = N.periodos(hoy, 'fin', 3, hoy, EL.MINIMO);
    // Lo publicado: en cada periodo una del expediente y una de otro; una del
    // mismo número en otra unidad; y una de antes del primer periodo.
    const filas = [];
    periodos.forEach(([a], i) => {
        filas.push({ u: '20', FECHA_ESTRADO: a, TIPO_EXP_DESC: 'DIT', NUM_EXP: 'DIT-21/2026', ACTOR: 'JUAN PÉREZ RUIZ', DEMANDADO: 'FGE', TIPO_ACUERDO_DESC: 'Acuerdo ' + (i + 1), RESOLUCION: '' });
        filas.push({ u: '20', FECHA_ESTRADO: a, TIPO_EXP_DESC: 'DIT', NUM_EXP: '55/2026', ACTOR: 'OTRA PERSONA', DEMANDADO: 'MUNICIPIO', TIPO_ACUERDO_DESC: 'Otro', RESOLUCION: '' });
    });
    filas.push({ u: '23', FECHA_ESTRADO: periodos[0][0], NUM_EXP: '21/2026', ACTOR: 'X', DEMANDADO: 'Y', TIPO_ACUERDO_DESC: 'De la Junta' });
    filas.push({ u: '20', FECHA_ESTRADO: N.sumar(periodos[0][0], -20), NUM_EXP: 'DIT-21/2026', ACTOR: 'JUAN PÉREZ RUIZ', DEMANDADO: 'FGE', TIPO_ACUERDO_DESC: 'Antiguo' });
    const simulada = `<!doctype html><meta charset="utf-8"><title>Estrados</title>
        <form id="formBusquedaEstrados"><select id="IdUR"><option value="20">TCA</option><option value="23">JLCA</option></select>
        <input id="FechaInicio"><input id="FechaFin"><button type="submit">Consultar</button></form><table id="tablaEstrados"></table>
        <script>
        const FILAS = ${JSON.stringify(filas)};
        window.consultas = [];
        for (const id of ['FechaInicio', 'FechaFin']) { const el = document.getElementById(id); el._flatpickr = { setDate(v) { el.value = v; }, clear() { el.value = ''; } }; }
        let datos = [], json, iniciada = false;
        const api = { ajax: { json: () => json }, clear() { datos = []; return api; }, draw() { return api; },
            rows: Object.assign(() => ({ data: () => ({ toArray: () => datos.slice() }) }), { add(r) { datos = datos.concat(r); return api; } }) };
        window.jQuery = () => ({ DataTable: () => api }); jQuery.fn = { DataTable: { isDataTable: () => iniciada } };
        window.tabla = () => datos;
        document.getElementById('formBusquedaEstrados').addEventListener('submit', (e) => {
            e.preventDefault();
            const q = { u: IdUR.value, i: FechaInicio.value, f: FechaFin.value };
            consultas.push(q);
            setTimeout(() => { iniciada = true; datos = FILAS.filter(r => r.u === q.u && r.FECHA_ESTRADO >= q.i && r.FECHA_ESTRADO <= q.f); json = { data: datos.slice() }; }, 120);
        });
        </script>`;
    await contexto.route(EL.URL_ESTRADOS + '**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: simulada }));

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.ESTRADOS_LABORALES && typeof crearExpedienteCore === 'function' && typeof db !== 'undefined' && !!db, { timeout: 15000 });
        await pausa(1000);
        const id = await page.evaluate(() => crearExpedienteCore({ numero: 'DIT-021/2026', institucion: 'OTRO', juzgado: 'Tribunal de Conciliación y Arbitraje', nombre: 'Pérez vs FGE' }));
        await page.evaluate(() => navegarA('expedientes'));
        await pausa(600);
        verificar('estrados laborales: el expediente del TCA tiene su botón', await page.locator(`button[onclick^="ESTRADOS_LABORALES.abrirDeExpediente(${id}"]`).count() > 0);
        await page.evaluate((i) => ESTRADOS_LABORALES.abrirDeExpediente(i), id);
        await pausa(400);
        verificar('estrados laborales: explica que el sitio solo deja periodos de 15 días', /periodo de 15 días como máximo/.test(await page.textContent('#modal-body')));
        igual('estrados laborales: propone el TCA y el número del expediente',
            [await page.inputValue('#estl-unidad'), await page.inputValue('#estl-buscar')], ['20', '21/2026']);
        await page.fill('#estl-cuantos', '3');
        await pausa(150);
        verificar('estrados laborales: enseña los tres periodos que se revisarán', /Se revisarán 3 periodos/.test(await page.textContent('#estl-lista')));
        await page.click('.estl-nav[data-nav="safari"]');
        verificar('estrados laborales: las instrucciones cambian por navegador', /Editar dirección/.test(await page.textContent('#estl-pasos')));
        await page.click('.estl-nav[data-nav="iphone"]');
        verificar('estrados laborales: en iPhone se abre desde el libro de Marcadores, no desde la barra',
            /libro de Marcadores/.test(await page.textContent('#estl-pasos')) && /No lo escribas en la barra/.test(await page.textContent('#estl-pasos')));
        igual('estrados laborales: en el teléfono no se ofrece arrastrar, sino copiar', await page.isVisible('#estl-enlace'), false);
        await page.click('.estl-nav[data-nav="android"]');
        verificar('estrados laborales: en Android se elige desde la barra de direcciones', /barra de direcciones/.test(await page.textContent('#estl-pasos')));
        verificar('estrados laborales: el código está a la vista para copiarlo a mano', /^javascript:/.test(await page.inputValue('#estl-codigo')));
        await page.click('.estl-nav[data-nav="safari"]');
        const href = await page.getAttribute('#estl-enlace', 'href');
        verificar('estrados laborales: el marcador es un javascript:', /^javascript:/.test(href || ''));
        await page.click('#estl-enlace');
        await pausa(200);
        verificar('estrados laborales: pulsarlo en la app no lo corre ahí', !(await page.evaluate(() => !!document.getElementById('tsjf-estrados'))));

        // En la página de estrados: se pulsa el marcador.
        const sitio = await contexto.newPage();
        sitio.on('pageerror', e => errores.push('sitio: ' + e.message));
        await sitio.goto(EL.URL_ESTRADOS, { waitUntil: 'domcontentloaded' });
        await sitio.evaluate((codigo) => { (0, eval)(codigo); }, decodeURIComponent(href.slice('javascript:'.length)));
        await sitio.waitForSelector('#tsjf-estrados');
        verificar('estrados laborales: el panel también explica los 15 días y los periodos', /periodos de 15 días/.test(await sitio.textContent('#tsjf-estrados')) &&
            /Se revisarán 3 periodos/.test(await sitio.textContent('#tsjf-estrados [data-lista]')));
        await sitio.click('#tsjf-estrados [data-ir]');
        await sitio.waitForFunction(() => /publicaciones de tus expedientes/.test(document.querySelector('#tsjf-estrados [data-estado]').textContent), null, { timeout: 30000 });
        const consultas = await sitio.evaluate(() => window.consultas);
        igual('estrados laborales: consulta los tres periodos en el TCA, con las fechas armadas',
            consultas, periodos.map(([i, f]) => ({ u: '20', i, f })));
        const enTabla = await sitio.evaluate(() => window.tabla().map(f => f.TIPO_ACUERDO_DESC));
        igual('estrados laborales: la tabla queda solo con lo del expediente, de todos los periodos', enTabla, ['Acuerdo 1', 'Acuerdo 2', 'Acuerdo 3']);
        verificar('estrados laborales: el panel lo resume', /3 publicaciones de tus expedientes/.test(await sitio.textContent('#tsjf-estrados')));

        // Pulsado fuera de la página de estrados, ofrece ir a ella.
        const otra = await contexto.newPage();
        await otra.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        otra.once('dialog', d => d.accept());
        await Promise.all([
            otra.waitForURL(EL.URL_ESTRADOS + '**', { timeout: 10000 }).catch(() => {}),
            otra.evaluate((codigo) => { (0, eval)(codigo); }, decodeURIComponent(href.slice('javascript:'.length)))
        ]);
        verificar('estrados laborales: fuera de la página de estrados, lleva a ella', otra.url().startsWith(EL.URL_ESTRADOS), otra.url());

        // Desde un teléfono, la ventana elige sola sus pasos.
        for (const [nombre, ua, esperado] of [
            ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'iphone'],
            ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 'android']
        ]) {
            const movil = await navegador.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, isMobile: true, hasTouch: true });
            const pm = await movil.newPage();
            await pm.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
            await pm.waitForFunction(() => window.ESTRADOS_LABORALES && typeof db !== 'undefined' && !!db, { timeout: 15000 });
            await pm.evaluate(() => ESTRADOS_LABORALES.abrir());
            await pm.waitForSelector('.estl-nav.activa');
            igual(`estrados laborales: en ${nombre} se eligen solos sus pasos`, await pm.getAttribute('.estl-nav.activa', 'data-nav'), esperado);
            const desborde = await pm.evaluate(() => { const b = document.getElementById('modal-body'); return b.scrollWidth - b.clientWidth; });
            verificar(`estrados laborales: la ventana cabe en la pantalla de ${nombre}`, desborde <= 1, 'desborde de ' + desborde + 'px');
            await movil.close();
        }
        igual('estrados laborales: sin errores', errores, []);
    } finally {
        await contexto.close();
    }
}

// Límites del plan gratuito en el IMPI (cuotas-impi.js): 5 búsquedas al mes y
// 2 estudios de viabilidad. Primero sin cuotas en el proxy (cuenta local que
// no se borra), luego con un proxy que lleva la cuenta (otro navegador del
// mismo equipo) y que exige el pase.
async function probarCuotasIMPI(navegador) {
    let servidor = { servidor: false, permitido: true };
    const recibidos = [];
    const preparar = async (contexto) => {
        await contexto.route('**/cuota', async (r) => {
            recibidos.push(JSON.parse(r.request().postData() || '{}'));
            r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(servidor) });
        });
    };
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-MX' });
    await preparar(contexto);
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    const listo = (p) => p.waitForFunction(() => window.CUOTAS_IMPI && typeof db !== 'undefined' && !!db, { timeout: 15000 });
    const autorizar = (p, tipo) => p.evaluate((t) => CUOTAS_IMPI.autorizar(t), tipo);
    const modal = (p) => p.evaluate(() => document.getElementById('modal-overlay').classList.contains('active') ? document.getElementById('modal-body').textContent : '');
    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await listo(page);
        await page.waitForTimeout(800);
        const cinco = [];
        for (let i = 0; i < 5; i++) cinco.push(await autorizar(page, 'busqueda'));
        igual('cuotas: las 5 búsquedas del mes se permiten', cinco, [true, true, true, true, true]);
        igual('cuotas: la sexta no', await autorizar(page, 'busqueda'), false);
        verificar('cuotas: y avisa con la ventana de Premium', /5 búsquedas del IMPI de este mes/.test(await modal(page)) && /desde \$300 MXN por 3 meses/.test(await modal(page)));
        verificar('cuotas: la huella del equipo viaja al proxy', recibidos.length === 5 && recibidos.every(c => /^[0-9a-f]{64}$/.test(c.huella.amplia) && /^[0-9a-f]{64}$/.test(c.huella.fina) && c.tipo === 'busqueda'));
        await page.evaluate(() => cerrarModal());

        // Borrar el almacén del navegador no reinicia la cuenta.
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: 'domcontentloaded' });
        await listo(page);
        igual('cuotas: borrar el almacén del navegador no reinicia la cuenta', await autorizar(page, 'busqueda'), false);
        await page.evaluate(() => cerrarModal());

        // La búsqueda bloqueada no llega al proxy.
        const llamadas = await page.evaluate(async () => {
            window.__llamadas = [];
            window.proxyFetch = async (ruta) => { window.__llamadas.push(ruta); return { results: [], items: [] }; };
            navegarA('impi');
            document.getElementById('siga-query').value = 'nike';
            await buscarSIGA();
            cerrarModal();
            return window.__llamadas;
        });
        igual('cuotas: sin cupo, la búsqueda no sale', llamadas, []);

        // Viabilidad: 2 para siempre.
        igual('cuotas: dos estudios de viabilidad', [await autorizar(page, 'viabilidad'), await autorizar(page, 'viabilidad')], [true, true]);
        igual('cuotas: el tercero no', await autorizar(page, 'viabilidad'), false);
        verificar('cuotas: y lo explica', /2 estudios de viabilidad gratuitos/.test(await modal(page)));
        await page.evaluate(() => cerrarModal());

        // En Configuración se ve lo usado.
        await page.evaluate(() => { navegarA('config'); actualizarUIPremium(); });
        await page.waitForTimeout(500);
        igual('cuotas: Configuración muestra lo usado', [await page.textContent('#limit-impi'), await page.textContent('#limit-viabilidad')], ['5 / 5', '2 / 2']);
        verificar('cuotas: y los planes nuevos', /3 meses[\s\S]*\$300 MXN[\s\S]*6 meses[\s\S]*\$530 MXN[\s\S]*1 año[\s\S]*\$1,000 MXN/.test(await page.textContent('#pricing-planes')));
        // Se contrata por WhatsApp: el mensaje pide los datos de pago del plan
        // elegido y lleva el ID de dispositivo para dar de alta la licencia.
        const pedido = await page.evaluate(() => {
            const a = document.querySelectorAll('#pricing-planes a')[1];
            const u = new URL(a.href);
            return { destino: u.origin + u.pathname, texto: u.searchParams.get('text'), dispositivo: obtenerDeviceId(), nueva: a.target };
        });
        igual('planes: el botón abre WhatsApp de ventas', [pedido.destino, pedido.nueva], ['https://wa.me/529981399930', '_blank']);
        verificar('planes: con el plan elegido y la petición de datos de pago',
            /plan Premium de 6 meses \(\$530 MXN\)/.test(pedido.texto) && /datos para el pago/.test(pedido.texto) && /comprobante/.test(pedido.texto), pedido.texto);
        verificar('planes: y el ID de dispositivo', pedido.texto.includes('ID de dispositivo: ' + pedido.dispositivo), pedido.texto);

        // Términos y condiciones: hay que aceptarlos antes de contratar.
        await page.evaluate(() => { localStorage.removeItem('tsj_terminos_aceptados'); window.__abiertas = []; window.open = (u) => { window.__abiertas.push(u); return null; }; renderizarPlanesPremium(); });
        await page.click('#pricing-planes a >> nth=1');
        await page.waitForTimeout(300);
        verificar('términos: elegir un plan sin aceptarlos los muestra primero', /Términos y condiciones/.test(await page.textContent('#modal-titulo')) &&
            /Sin devoluciones/.test(await page.textContent('#modal-body')) && /caso fortuito o fuerza mayor/.test(await page.textContent('#modal-body')));
        igual('términos: sin la casilla no se puede continuar, ni se abre WhatsApp',
            [await page.isDisabled('#terminos-aceptar'), await page.evaluate(() => window.__abiertas.length)], [true, 0]);
        await page.check('#terminos-check');
        await page.click('#terminos-aceptar');
        await page.waitForTimeout(300);
        const abierta = await page.evaluate(() => window.__abiertas[0] || '');
        verificar('términos: al aceptar, se abre WhatsApp con el plan y la aceptación en el mensaje',
            /^https:\/\/wa\.me\/529981399930\?/.test(abierta) && /plan Premium de 6 meses/.test(decodeURIComponent(abierta)) &&
            /Acepto los Términos y condiciones de TSJ Filing Online \(versión \d{4}-\d{2}-\d{2}\)/.test(decodeURIComponent(abierta)), decodeURIComponent(abierta));
        verificar('términos: se recuerda la versión y la fecha', await page.evaluate(() => {
            const t = JSON.parse(localStorage.getItem('tsj_terminos_aceptados') || '{}');
            return t.version === TERMINOS.VERSION && !isNaN(Date.parse(t.fecha));
        }));
        verificar('términos: ya aceptados, el enlace del plan lleva la aceptación', /Acepto%20los%20T%C3%A9rminos/.test(await page.getAttribute('#pricing-planes a >> nth=0', 'href')));
        await page.evaluate(() => { localStorage.removeItem('tsj_terminos_aceptados'); document.getElementById('premium-username').value = 'Prueba'; document.getElementById('premium-code').value = 'CODIGO-1'; });
        await page.evaluate(() => activarPremium());
        await page.waitForTimeout(300);
        verificar('términos: activar un código también los pide', /Términos y condiciones/.test(await page.textContent('#modal-titulo')) && await page.isVisible('#terminos-check'));
        await page.evaluate(() => { localStorage.setItem('tsj_terminos_aceptados', JSON.stringify({ version: TERMINOS.VERSION, fecha: new Date().toISOString() })); cerrarModal(); });

        // Con Premium no hay límite.
        igual('cuotas: con Premium no hay límite', await page.evaluate(async () => {
            estadoPremium.activo = true; estadoPremium.codigo = 'LIC'; estadoPremium.dispositivoId = 'D';
            const r = await CUOTAS_IMPI.autorizar('busqueda');
            estadoPremium.activo = false;
            return r;
        }), true);
        verificar('cuotas: y el proxy recibe la licencia para verificarla', recibidos[recibidos.length - 1].licencia && recibidos[recibidos.length - 1].licencia.codigo === 'LIC');

        // Otro navegador del mismo equipo: el proxy ya lleva 5.
        const otro = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-MX' });
        await preparar(otro);
        const p2 = await otro.newPage();
        await p2.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await listo(p2);
        servidor = { servidor: true, permitido: false, usados: 5, limite: 5 };
        igual('cuotas: en otro navegador, si el proxy ya lleva 5, no se permite', await autorizar(p2, 'busqueda'), false);
        await p2.evaluate(() => cerrarModal());
        igual('cuotas: y la cuenta local se pone al día', await p2.evaluate(async () => (await CUOTAS_IMPI.resumen()).busqueda.usados), 5);

        // Con cupo, el pase viaja en las búsquedas; un 402 del proxy avisa.
        servidor = { servidor: true, permitido: true, usados: 1, limite: 5, pase: 'PASE.FIRMA' };
        const cabeceras = [];
        await otro.route('**/siga/search', (r) => { cabeceras.push(r.request().headers()['x-tsj-cuota']); r.fulfill({ status: 402, contentType: 'application/json', body: '{"error":"sin pase","cuota":true}' }); });
        await p2.evaluate(async () => { await CUOTAS_IMPI.autorizar('viabilidad'); try { await proxyFetch('/siga/search', { method: 'POST', body: '{}' }); } catch (e) { /* 402 */ } });
        igual('cuotas: el pase del proxy viaja en la búsqueda', cabeceras, ['PASE.FIRMA']);
        verificar('cuotas: si el proxy dice que no hay cupo (402), se avisa', /Límite gratuito|búsquedas del IMPI/.test(await p2.textContent('#modal-titulo') + await modal(p2)));
        await otro.close();
        igual('cuotas: sin errores', errores, []);
    } finally {
        await contexto.close();
    }
}

async function probarEstadisticas(navegador) {
    const contexto = await navegador.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 },
        locale: 'es-MX', timezoneId: 'America/Cancun' });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    const pausa = (ms) => page.waitForTimeout(ms);
    const kpi = (etiqueta) => page.evaluate((t) => {
        const k = [...document.querySelectorAll('#est-raiz .est-kpi')].find(x => x.querySelector('.est-kpi-etiqueta').textContent === t);
        return k ? k.querySelector('.est-kpi-valor').textContent : null;
    }, etiqueta);

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.ESTADISTICAS && typeof db !== 'undefined' && !!db, { timeout: 15000 });
        await pausa(1000);

        // ---- El formulario guarda lo nuevo ----
        await page.evaluate(() => { navegarA('expedientes'); mostrarFormularioExpediente(); });
        await pausa(400);
        await page.fill('#expediente-valor', '501/2025');
        await page.selectOption('#expediente-juzgado', 'JUZGADO PRIMERO FAMILIAR ORAL CANCUN');
        await page.fill('#expediente-cliente', 'Grupo Hotelero Caribe');
        await page.fill('#expediente-abogado', 'Frida');
        await page.fill('#expediente-tipo', 'Divorcio');
        await page.fill('#expediente-inicio', '2025-01-15');
        await page.click('#expediente-form button[type="submit"]');
        await pausa(700);
        const guardado = await page.evaluate(async () => {
            const e = (await obtenerExpedientes()).find(x => x.numero === '501/2025');
            return e && { id: e.id, cliente: e.cliente, abogado: e.abogado, tipo: e.tipo, inicio: e.fechaInicioAsunto };
        });
        igual('estadísticas: el expediente guarda cliente, responsable, tipo e inicio',
            guardado && [guardado.cliente, guardado.abogado, guardado.tipo, guardado.inicio], ['Grupo Hotelero Caribe', 'Frida', 'Divorcio', '2025-01-15']);
        verificar('estadísticas: la tarjeta muestra cliente y responsable',
            /Grupo Hotelero Caribe[\s\S]*Frida/.test(await page.textContent('#lista-expedientes')));
        await page.evaluate((id) => editarExpediente(id), guardado.id);
        await pausa(500);
        igual('estadísticas: al editar, el formulario trae lo guardado',
            [await page.inputValue('#expediente-cliente'), await page.inputValue('#expediente-inicio')], ['Grupo Hotelero Caribe', '2025-01-15']);
        verificar('estadísticas: el formulario sugiere los clientes ya capturados',
            await page.$$eval('#lista-clientes-expediente option', os => os.some(o => o.value === 'Grupo Hotelero Caribe')));
        await page.evaluate(() => cerrarFormularioExpediente());

        // Un despacho de prueba, con fechas fijas respecto a hoy.
        await page.evaluate(async () => {
            const dia = 864e5, ahora = Date.now();
            const hace = (d) => new Date(ahora - d * dia).toISOString();
            await enLoteCore(async () => {
                const a = await crearExpedienteCore({ numero: '502/2025', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', cliente: 'María López', abogado: 'Jorge', tipo: 'Juicio ordinario civil' });
                const b = await crearExpedienteCore({ numero: '503/2025', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO MERCANTIL CANCUN', cliente: 'maria lopez', abogado: 'Jorge' });
                await crearExpedienteCore({ numero: '50/2026', institucion: 'PJF', juzgado: 'Juzgado Segundo de Distrito en el Estado de Quintana Roo', pjfTipoAsunto: 'Amparo Indirecto' });
                await crearPendienteCore({ titulo: 'Contestar vista', expedienteId: a, fechaLimite: hace(3) });
                await crearPendienteCore({ titulo: 'Ofrecer pruebas', expedienteId: b, fechaLimite: hace(-3) });
                await crearEventoCore({ titulo: 'Audiencia', tipo: 'audiencia', expedienteId: a, fechaInicio: hace(-6) });
            });
        });
        // Se archiva con resultado desde el diálogo.
        await page.evaluate((id) => mostrarDialogoArchivar(id), guardado.id);
        await pausa(300);
        await page.selectOption('#resultado-archivo', 'favorable');
        await page.click('#modal-body .btn-warning');
        await pausa(700);
        igual('estadísticas: archivar guarda el resultado', await page.evaluate(async (id) => (await obtenerExpediente(id)).resultado, guardado.id), 'favorable');

        // ---- La página ----
        await page.click('.header-nav .nav-btn[data-page="estadisticas"]');
        await pausa(900);
        igual('estadísticas: el menú abre la página', await page.isVisible('#page-estadisticas'), true);
        igual('estadísticas: activos', await kpi('Expedientes activos'), '3');
        igual('estadísticas: cerrados en el periodo', await kpi('Cerrados en el periodo'), '1');
        igual('estadísticas: pendientes abiertos', await kpi('Pendientes abiertos'), '2');
        igual('estadísticas: audiencias próximas', await kpi('Audiencias próximas'), '1');
        igual('estadísticas: resultados favorables', await kpi('Resultados favorables'), '100%');
        verificar('estadísticas: la duración sale del inicio capturado (enero de 2025), no del alta de hoy',
            /meses|años/.test(await kpi('Duración típica')), await kpi('Duración típica'));
        verificar('estadísticas: "María López" y "maria lopez" son un cliente',
            /María López[\s\S]{0,40}2/.test(await page.textContent('[data-tarjeta="clientes"]')) &&
            !/maria lopez/.test(await page.textContent('[data-tarjeta="clientes"]')));
        igual('estadísticas: la tendencia tiene una columna por mes', await page.locator('[data-tarjeta="tendencia"] .est-grupo').count(), 13);

        // Descripción emergente al pasar el ratón.
        await page.locator('[data-tarjeta="tendencia"] .est-grupo').last().hover();
        await pausa(200);
        const emergente = await page.evaluate(() => { const t = document.getElementById('est-tip'); return t && !t.hidden ? t.textContent : ''; });
        verificar('estadísticas: al pasar sobre un mes se ven sus cifras', /Nuevos/.test(emergente) && /Cerrados/.test(emergente), emergente);

        // Filtros.
        await page.selectOption('[data-filtro="cliente"]', 'María López');
        await pausa(700);
        igual('estadísticas: filtrar por cliente', await kpi('Expedientes activos'), '2');
        igual('estadísticas: y sus pendientes', await kpi('Pendientes abiertos'), '2');
        await page.click('[data-acc="limpiar"]');
        await pausa(700);
        igual('estadísticas: quitar filtros', await kpi('Expedientes activos'), '3');
        await page.selectOption('[data-filtro="periodo"]', 'rango');
        await pausa(600);
        igual('estadísticas: "otro rango" pide las fechas', await page.locator('[data-filtro="desde"]').count(), 1);
        await page.selectOption('[data-filtro="periodo"]', '12m');
        await pausa(600);

        // Toda gráfica se puede ver como tabla, y las tablas se ordenan.
        await page.click('[data-tarjeta="materia"] [data-acc="alternar"]');
        await pausa(500);
        verificar('estadísticas: la gráfica se puede ver como tabla',
            await page.locator('[data-tarjeta="materia"] table').count() === 1);
        await page.click('[data-tarjeta="materia"] th button:has-text("Total")');
        await pausa(500);
        igual('estadísticas: ordenar por una columna', await page.getAttribute('[data-tarjeta="materia"] th[aria-sort]', 'aria-sort'), 'descending');

        // Exportar.
        const espera = page.waitForEvent('download', { timeout: 8000 });
        await page.click('[data-acc="csv-todo"]');
        const descarga = await espera.catch(() => null);
        verificar('estadísticas: exporta todo a CSV', !!descarga && /^estadisticas-\d{4}-\d{2}-\d{2}\.csv$/.test(descarga.suggestedFilename()), descarga && descarga.suggestedFilename());
        if (descarga) {
            const csv = fs.readFileSync(await descarga.path(), 'utf8');
            verificar('estadísticas: el CSV trae las tablas con sus datos',
                csv.includes('Expedientes y pendientes por cliente') && csv.includes('María López') && csv.includes('Carga por responsable'), csv.slice(0, 200));
        }

        // Un cambio en los datos se ve sin salir de la página.
        await page.evaluate(async () => { await crearExpedienteCore({ numero: '504/2025', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' }); });
        await pausa(900);
        igual('estadísticas: se actualiza sola al cambiar los datos', await kpi('Expedientes activos'), '4');

        // El asistente sabe llevar aquí.
        await page.evaluate(() => navegarA('inicio'));
        await page.evaluate(() => VOZ.ejecutar('navegar', { pagina: 'estadisticas' }));
        await pausa(600);
        igual('estadísticas: el asistente lleva a la página', await page.isVisible('#page-estadisticas'), true);

        // En el teléfono.
        await page.setViewportSize({ width: 390, height: 844 });
        await pausa(500);
        igual('estadísticas: en el teléfono nada se sale a lo ancho',
            await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);

        igual('estadísticas: sin errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
    }
}

/**
 * Estudio de viabilidad de marca, en un navegador de verdad. El IMPI no se
 * consulta: proxyFetch se sustituye por un simulador que responde con la
 * forma documentada de cada API (docs/data/) y que puede fallar a propósito.
 * Se prueba lo que hace la app con esas respuestas: el formulario, las
 * consultas que lanza, el reporte y sus acciones.
 */
async function probarViabilidadMarca(navegador) {
    const contexto = await navegador.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, locale: 'es-MX' });
    // Las cuotas se piden al proxy real: aquí se simula uno sin límites activados.
    let pedidasCuota = 0;
    await contexto.route('**/cuota', r => { pedidasCuota++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ servidor: false, permitido: true }) }); });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    const pausa = (ms) => page.waitForTimeout(ms);

    const simulador = (modo) => {
        const fallaSIGA = modo === true;
        window.__marcanetVacia = modo === 'marcanet-vacia';
        // En el primer estudio, MARCia falla una vez su búsqueda principal (como hace a veces).
        window.__marciaFallaUna = modo === false;
        window.__marciaFallaClase = modo === 'marcia-clase' ? '43' : null;
        // Con Marcanet vacía, tampoco se dejan leer las fichas de MARCia.
        window.__marciaVistaFalla = modo === 'marcanet-vacia';
        window.__llamadas = [];
        window.__fonetica = 0;
        const marca = (id, title, status, owners, classes) => ({ id, applicationNumber: id.slice(-6), registrationNumber: status === 'REGISTRADO' ? '9' + id.slice(-5) : '',
            title, status, appType: 'REGISTRO DE MARCA', owners, dates: { application: '10/02/2019', expiry: '10/02/2029' }, goodsAndServices: '', classes: classes || [], images: '' });
        window.proxyFetch = async (ruta, opciones) => {
            const body = opciones && opciones.body ? JSON.parse(opciones.body) : null;
            window.__llamadas.push({ ruta, body, cliente: ((opciones && opciones.headers) || {})['X-IMPI-Client'] || null });
            if (ruta === '/marcia/csrf') return {};
            if (ruta === '/marcia/search') return { id: (body.query.titleOption || 'identica') + ':' + body.query.title.toUpperCase(), count: 5 };
            if (ruta === '/marcia/results') {
                const [opcion, titulo] = body.searchId.split(':');
                const clase = body.niceClassFilter[0];
                if (window.__marciaFallaUna && opcion === 'similar' && clase === '30') { window.__marciaFallaUna = false; throw new Error('Unexpected end of JSON input'); }
                if (window.__marciaFallaClase && clase === window.__marciaFallaClase) throw new Error('Unexpected end of JSON input');
                let r = [];
                if (opcion === 'similar' && titulo === 'LUNA AZUL' && clase === '30') {
                    r = [marca('RM201900111111', 'LUNA AZUL', 'REGISTRADO', ['CAFES DEL SURESTE SA DE CV']),
                         marca('RM201500333333', 'LUNA ROJA', 'REGISTRADO', ['ALIMENTOS ROJOS SA']),
                         marca('RM201700888888', 'LUNA ASUL', 'REGISTRADO', ['TOSTADORES DEL GOLFO  '])];
                }
                if (opcion === 'similar' && titulo === 'LUNA AZUL' && clase === '43') {
                    // Otro expediente de LUNA AZUL del mismo titular: una sola marca.
                    r = [marca('RM201800444444', 'LA LUNA AZUL CAFETERIA', 'REGISTRADO', ['JUAN LOPEZ']),
                         marca('RM201000555555', 'SOL Y MAR', 'REGISTRADO', ['MARISCOS SA']),
                         marca('RM201900222222', 'LUNA AZUL', 'REGISTRADO', ['CAFES DEL SURESTE SA DE CV'])];
                }
                if (opcion === 'identica' && !clase) r = [marca('RM202000777777', 'LUNA AZUL', 'REGISTRADO', ['MODAS LUNA AZUL SA'], [25]),
                    marca('RM202100999999', 'LUNARES', 'REGISTRADO', ['BOUTIQUE LUNARES'], [25])];
                return { resultPage: r, totalResults: r.length, aggregates: { NICE_CLASSES: [{ key: '30', docCount: 2 }, { key: '43', docCount: 1 }] } };
            }
            // La ficha de MARCia de cada expediente: su clase y lo que ampara.
            if (ruta.startsWith('/marcia/view/')) {
                if (window.__marciaVistaFalla) throw new Error('HTTP 500');
                const id = ruta.slice('/marcia/view/'.length);
                const fichas = { RM201900111111: [30, 'CAFÉ EN GRANO; CAFÉ MOLIDO.'], RM201900222222: [43, 'SERVICIOS DE CAFETERÍA.'], RM201700888888: [30, 'CAFÉ TOSTADO.'],
                    RM201500333333: [30, 'CAFÉ.'], RM201800444444: [43, 'CAFETERÍA.'], RM202000777777: [25, 'ROPA.'], RM202100999999: [25, 'ROPA.'], RM202000123456: [3, 'COSMÉTICOS.'] };
                if (!fichas[id]) throw new Error('HTTP 404');
                return { details: { generalInformation: { applicationNumber: id.slice(-6) }, productsAndServices: [{ classes: fichas[id][0], goodsAndServices: fichas[id][1] }] },
                    result: { id, applicationNumber: id.slice(-6), status: 'REGISTRADO' } };
            }
            if (ruta === '/marcanet/fonetica') {
                // La primera llega vacía, como hace Marcanet con la sesión recién abierta.
                window.__fonetica = (window.__fonetica || 0) + 1;
                // LUNAZUL solo está en Marcanet, sin fecha: su año sale de su ficha.
                return { results: window.__fonetica === 1 || window.__marcanetVacia ? [] : [{ 'Denominación': 'LUNA AZUL', 'Expediente': '111111', 'Clase': '30', 'Titular': 'CAFES DEL SURESTE', 'Situación': 'REGISTRADA' },
                    { 'Denominación': 'LUNAZUL', 'Expediente': '123456', 'Clase': '3', 'Titular': 'COSMETICOS  LUNAZUL SA' }] };
            }
            // La ficha de cada expediente: LUNA ROJA resulta abandonada.
            if (ruta === '/marcanet/full-detail') {
                if (body.expediente === '333333') return { detail: { 'Fecha de presentación': '01/03/2015', 'Denominación': 'LUNA ROJA', '1': 'Publicado en la Gaceta, Solicitudes Abandonadas' } };
                if (body.expediente === '111111') return { detail: { 'Fecha de presentación': '10/02/2019', 'Número de registro': '911111', 'Fecha de vigencia': '10/02/2029', 'Denominación': 'LUNA AZUL' } };
                if (body.expediente === '123456') return { detail: { 'Fecha de presentación': '05/05/2020 10:00:00 AM', 'Denominación': 'LUNAZUL' } };
                return { detail: {} };
            }
            if (ruta === '/siga/search') {
                if (fallaSIGA) throw new Error('HTTP 502');
                // El historial de un antecedente, buscado por su nombre.
                if (body.Busqueda === 'LUNA ASUL') return { successed: true, data: [{ fichaId: 31, gaceta: 'Conservación de los Derechos', seccion: 'Marcas Renovadas en el Mes',
                    fechaPuestaCirculacion: '15/03/2024', datos: [{ descripcion: 'Expediente', datoTxt: '888888' }, { descripcion: 'Denominación', datoTxt: 'LUNA ASUL' }] }] };
                return { successed: true, data: [{ fichaId: 7, gaceta: 'Solicitudes', seccion: 'Solicitudes publicadas', ejemplar: 'Octubre de 2026',
                    datos: [{ descripcion: 'Denominación', datoTxt: 'LUNA AZUL CAFÉ' }, { descripcion: 'Clase', datoTxt: '43' }] }] };
            }
            throw new Error('Ruta no simulada: ' + ruta);
        };
    };

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.VIABILIDAD && typeof db !== 'undefined' && !!db, { timeout: 15000 });
        await pausa(800);
        await page.evaluate(() => navegarA('impi'));
        await page.evaluate(simulador, false);
        await pausa(200);

        igual('viabilidad: es la pestaña que abre IMPI', await page.isVisible('#vb-form'), true);
        verificar('viabilidad: el aviso de que los resultados no son concluyentes, a la vista antes de buscar',
            /dependen por completo de búsquedas en sistemas externos/.test(await page.textContent('#vb-form')) && /nunca son concluyentes/.test(await page.textContent('#vb-form')) &&
            /consulta siempre a un especialista/.test(await page.textContent('#vb-form')));
        igual('viabilidad: las otras herramientas siguen ahí', await page.locator('.impi-tab').count(), 4);

        // Sin clase no se hace nada.
        await page.fill('#vb-denominacion', 'Luna Azul');
        await page.click('#vb-ejecutar');
        await pausa(300);
        igual('viabilidad: sin clase no consulta al IMPI', await page.evaluate(() => window.__llamadas.length), 0);

        await page.selectOption('#vb-clase-agregar', '30');
        await page.selectOption('#vb-clase-agregar', '43');
        await page.selectOption('#vb-clase-agregar', '30');
        igual('viabilidad: las clases elegidas, sin repetir', await page.locator('#vb-clases-elegidas .vb-chip').count(), 2);
        await page.fill('#vb-solicitante', 'Juan López');
        await page.click('#vb-ejecutar');
        await page.waitForSelector('.vb-reporte', { timeout: 15000 });
        await pausa(300);

        const llamadas = await page.evaluate(() => window.__llamadas.map(l => l.ruta + ' ' + JSON.stringify(l.body ? (l.body.niceClassFilter || l.body.clase || (l.body.query && l.body.query.titleOption) || l.body.Busqueda || '') : '')));
        verificar('viabilidad: consulta las tres fuentes', ['/marcia/search', '/marcanet/fonetica', '/siga/search'].every(r => llamadas.some(l => l.startsWith(r))), llamadas.join(' | '));
        igual('viabilidad: si MARCia falla una clase, la repite y el estudio sale completo',
            [await page.evaluate(() => window.__llamadas.filter(l => l.ruta === '/marcia/results' && l.body.searchId === 'similar:LUNA AZUL' && l.body.niceClassFilter[0] === '30').length),
             /MARCia 8 resultados revisados/.test((await page.textContent('.vb-fuentes')).replace(/\s+/g, ' '))], [2, true]);
        verificar('viabilidad: MARCia busca parecidas y también idénticas', llamadas.includes('/marcia/search "similar"') && llamadas.includes('/marcia/search ""'), llamadas.join(' | '));
        verificar('viabilidad: pide a MARCia cada clase que tiene resultados', llamadas.includes('/marcia/results ["30"]') && llamadas.includes('/marcia/results ["43"]'));
        const foneticas = await page.evaluate(() => window.__llamadas.filter(l => l.ruta === '/marcanet/fonetica').map(l => l.body));
        igual('viabilidad: Marcanet no filtra por clase: una sola búsqueda (repetida una vez si llega vacía)',
            foneticas.map(b => b.clase + '/' + b.maxResultados), ['30/60', '30/60']);
        const fichas = await page.evaluate(() => window.__llamadas.filter(l => l.ruta === '/marcanet/full-detail').map(l => l.body.expediente));
        verificar('viabilidad: confirma en Marcanet el estatus de los de riesgo alto y medio', fichas.includes('111111') && fichas.includes('333333'), fichas.join(', '));
        verificar('viabilidad: y lo dice en los pasos', /estatus y vigencia/.test(await page.textContent('#vb-progreso')));
        const vistas = await page.evaluate(() => window.__llamadas.filter(l => l.ruta.startsWith('/marcia/view/')).map(l => l.ruta.slice('/marcia/view/'.length)));
        igual('viabilidad: lee en MARCia la clase y los productos de todos los que se parecen, primero los de riesgo alto y medio',
            [vistas.slice(0, 3).sort(), vistas.slice().sort()], [['RM201700888888', 'RM201900111111', 'RM201900222222'],
                ['RM201500333333', 'RM201700888888', 'RM201800444444', 'RM201900111111', 'RM201900222222', 'RM202000123456', 'RM202000777777', 'RM202100999999']]);
        const progreso = (await page.textContent('#vb-progreso')).replace(/\s+/g, ' ');
        verificar('viabilidad: y lo dice en los pasos y en las fuentes', /MARCia: clase y productos de los 3 antecedentes principales/.test(progreso) &&
            /Marcanet: fecha y estatus de 1 antecedente más/.test(progreso) && /MARCia: clase y productos de 5 antecedentes más/.test(progreso) &&
            /Fichas de MARCia 8 de 8 \(clase y productos\)/.test((await page.textContent('.vb-fuentes')).replace(/\s+/g, ' ')),
            progreso + ' | ' + (await page.textContent('.vb-fuentes')).replace(/\s+/g, ' '));
        igual('viabilidad: al que solo está en Marcanet se le pide su ficha para saber su año (y su estatus)',
            await page.evaluate(() => window.__llamadas.filter(l => l.ruta === '/marcanet/full-detail' && l.body.expediente === '123456').length), 1);
        const historial = await page.evaluate(() => window.__llamadas.filter(l => l.ruta === '/siga/search').map(l => l.body.Busqueda));
        igual('viabilidad: busca en SIGA la denominación y el nombre de los antecedentes principales', historial, ['Luna Azul', 'LUNA ASUL']);
        verificar('viabilidad: busca también cada palabra distintiva', llamadas.includes('/marcia/search "similar"') && await page.evaluate(() =>
            window.__llamadas.some(l => l.ruta === '/marcia/search' && l.body.query.title === 'LUNA') && window.__llamadas.some(l => l.ruta === '/marcia/search' && l.body.query.title === 'AZUL')));

        const dictamen = await page.textContent('.vb-dictamen');
        verificar('viabilidad: el dictamen es "baja" por la idéntica en la misma clase', /Viabilidad baja/.test(dictamen), dictamen);
        const filas = await page.$$eval('.vb-tabla tbody tr', trs => trs.map(tr => tr.innerText.replace(/\s+/g, ' ')));
        verificar('viabilidad: la marca que vieron MARCia y Marcanet sale una vez, con las dos fuentes',
            filas.filter(f => /^⛔ Alto LUNA AZUL/.test(f)).length === 1 && filas.some(f => /LUNA AZUL.*MARCia, Marcanet/.test(f)), filas.join('\n'));
        const azul = filas.find(f => /^⛔ Alto LUNA AZUL/.test(f)) || '';
        verificar('viabilidad: los dos expedientes de LUNA AZUL de un mismo titular van en una fila', /Reg\. 911111 y 1 más/.test(azul) && /Sus 2 expedientes/.test(azul) && /30, 43/.test(azul), azul);
        verificar('viabilidad: con lo que ampara, según su ficha en MARCia', /Ampara: 30: CAFÉ EN GRANO; CAFÉ MOLIDO\./.test(azul) && /Misma clase, según MARCia/.test(azul), azul);
        await page.click('.vb-miembros summary');
        const deLaMarca = (await page.textContent('.vb-miembros')).replace(/\s+/g, ' ');
        verificar('viabilidad: y se ven sus expedientes, cada uno con su clase', /Reg\. 911111 · clase 30/.test(deLaMarca) && /Reg\. 922222 · clase 43/.test(deLaMarca), deLaMarca);
        verificar('viabilidad: la del mismo solicitante no es obstáculo', filas.some(f => /Propia LA LUNA AZUL CAFETERIA/.test(f)), filas.join('\n'));
        verificar('viabilidad: la idéntica en otra clase sale como riesgo bajo', filas.some(f => /Bajo LUNA AZUL.*25/.test(f)), filas.join('\n'));
        verificar('viabilidad: el historial en Gaceta del antecedente', filas.some(f => /LUNA ASUL.*En Gaceta: Renovada 15\/03\/2024/.test(f)), filas.join('\n'));
        verificar('viabilidad: el titular sin espacios de más', filas.some(f => /TOSTADORES DEL GOLFO(?! {2})/.test(f)), filas.join('\n'));
        verificar('viabilidad: lo que no se parece no se muestra', !filas.some(f => /SOL Y MAR/.test(f)), filas.join('\n'));
        verificar('viabilidad: pero se cuenta como descartado', /1 descartado por no parecerse/.test(await page.textContent('.vb-conteo')) &&
            /Se descartaron 1 resultado/.test(await page.textContent('.vb-reporte')), await page.textContent('.vb-conteo'));
        verificar('viabilidad: y las publicaciones en Gaceta', /LUNA AZUL CAFÉ/.test(await page.textContent('.vb-reporte')));

        // Acciones del reporte.
        const espera = page.waitForEvent('download', { timeout: 8000 });
        await page.click('[data-vb="csv"]');
        const descarga = await espera.catch(() => null);
        verificar('viabilidad: exporta a CSV', !!descarga && /^viabilidad-luna-azul-\d{4}-\d{2}-\d{2}\.csv$/.test(descarga.suggestedFilename()), descarga && descarga.suggestedFilename());
        if (descarga) {
            const csv = fs.readFileSync(await descarga.path(), 'utf8');
            verificar('viabilidad: el CSV trae dictamen y antecedentes', /Viabilidad baja/.test(csv) && /LUNA ROJA/.test(csv), csv.slice(0, 200));
            verificar('viabilidad: y el aviso', /Aviso,.*nunca son concluyentes/.test(csv));
            verificar('viabilidad: y también los descartados, marcados', /\ndescartado,SOL Y MAR,/.test(csv), csv);
            verificar('viabilidad: con su historial en Gaceta', /Renovada 15\/03\/2024/.test(csv));
            verificar('viabilidad: y de qué fichas salió cada dato', /,Fichas leídas\r?\n/.test(csv) && /,LUNA AZUL,111111,.*,Marcanet MARCia\r?\n/.test(csv), csv.split('\n').slice(4, 7).join('\n'));
        }
        await page.click('[data-vb="nota"]');
        await pausa(700);
        verificar('viabilidad: se guarda como nota', await page.evaluate(async () => (await obtenerNotas()).some(n => /Viabilidad de marca: Luna Azul/.test(n.titulo) && /DICTAMEN/.test(n.contenido))));
        await page.click('[data-vb="vigilar"]');
        await pausa(700);
        const vigiladas = await page.evaluate(() => savedSearchesState.searches.map(s => (s.tool || 'siga') + ':' + (s.subtype || '') + ':' + s.query));
        verificar('viabilidad: vigila la denominación en Gaceta y la marca de riesgo alto',
            vigiladas.includes('siga::Luna Azul') && vigiladas.some(v => v.startsWith('marcia:marca:')), vigiladas.join(' | '));
        igual('viabilidad: lo ya publicado no llegará como novedad en la primera revisión',
            await page.evaluate(() => (savedSearchesState.searches.find(s => s.query === 'Luna Azul') || {}).lastFichaIds), [7]);
        await page.click('[data-vb="ver-bajos"]');
        await pausa(200);
        verificar('viabilidad: se pueden ver también los de riesgo bajo', /Ocultar/.test(await page.textContent('[data-vb="ver-bajos"]')));
        const conBajos = await page.$$eval('.vb-tabla tbody tr', trs => trs.map(tr => tr.innerText.replace(/\s+/g, ' ')));
        verificar('viabilidad: la abandonada, según su ficha, ya no estorba', conBajos.some(f => /Bajo LUNA ROJA.*ABANDONADA.*ficha en Marcanet/.test(f)), conBajos.join('\n'));
        verificar('viabilidad: los bajos que sí se parecen aparecen al pedirlos', conBajos.some(f => /Bajo LUNARES/.test(f)) && !conBajos.some(f => /SOL Y MAR/.test(f)), conBajos.join('\n'));
        verificar('viabilidad: también con su clase según MARCia y su titular sin espacios de más',
            conBajos.some(f => /Bajo LUNAZUL Exp\. 123456 3 Otra clase, según MARCia EN TRÁMITE según su ficha en Marcanet COSMETICOS LUNAZUL SA/.test(f)), conBajos.join('\n'));

        // Estudios recientes.
        verificar('viabilidad: queda en los estudios recientes', /Luna Azul/.test(await page.textContent('#vb-recientes')));

        // Si una fuente no responde, el resultado lo dice.
        await page.evaluate(simulador, true);
        await page.click('[data-vb="repetir-reciente"]');
        await page.waitForFunction(() => /no respondió/.test((document.querySelector('.vb-dictamen') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
        verificar('viabilidad: si SIGA falla, el dictamen avisa que es parcial', /SIGA no respondió/.test(await page.textContent('.vb-dictamen')));
        verificar('viabilidad: y la fuente aparece sin respuesta', /SIGA sin respuesta/.test((await page.textContent('.vb-fuentes')).replace(/\s+/g, ' ')));

        // Marcanet a veces responde vacía: se espera y se repite; si sigue
        // vacía, no se da por hecho que "no hay nada".
        await page.evaluate(simulador, 'marcanet-vacia');
        // Es el tercer estudio y el plan gratuito da dos: este va con Premium.
        await page.evaluate(() => { estadoPremium.activo = true; estadoPremium.codigo = 'LIC-PRUEBA'; estadoPremium.dispositivoId = 'D'; });
        await page.click('[data-vb="repetir-reciente"]');
        await page.waitForFunction(() => /Marcanet no respondió/.test((document.querySelector('.vb-dictamen') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
        verificar('viabilidad: Marcanet vacía tres veces cuenta como sin respuesta, no como "no hay nada"',
            /Marcanet no respondió/.test(await page.textContent('.vb-dictamen')) &&
            /Marcanet sin respuesta: respondió vacía tres veces/.test((await page.textContent('.vb-fuentes')).replace(/\s+/g, ' ')),
            (await page.textContent('.vb-fuentes')).replace(/\s+/g, ' '));
        igual('viabilidad: antes la pidió tres veces, con pausas', await page.evaluate(() => window.__fonetica), 3);
        const clientes = await page.evaluate(() => window.__llamadas.filter(l => l.ruta === '/marcanet/fonetica').map(l => l.cliente));
        verificar('viabilidad: la tercera, con una sesión nueva en el proxy (otro identificador de cliente)',
            clientes.length === 3 && clientes[0] === null && clientes[1] === null && /-m[0-9a-z]+$/.test(clientes[2] || ''), JSON.stringify(clientes));
        verificar('viabilidad: el reporte ofrece reintentar lo que faltó', await page.isVisible('[data-vb="reintentar"]'));
        verificar('viabilidad: y avisa que no se leyó ninguna ficha de MARCia', /Fichas de MARCia 0 de \d/.test((await page.textContent('.vb-fuentes')).replace(/\s+/g, ' ')),
            (await page.textContent('.vb-fuentes')).replace(/\s+/g, ' '));

        // Reintentar: Marcanet ya responde. Solo se pide lo que faltó y no
        // cuenta como otro estudio.
        const cuotasAntes = pedidasCuota;
        const recientesAntes = await page.evaluate(() => JSON.parse(localStorage.getItem('impi_estudios_viabilidad') || '[]').length);
        await page.evaluate(() => { window.__llamadas = []; window.__marcanetVacia = false; window.__marciaVistaFalla = false; window.__fonetica = 1; });   // la siguiente ya trae resultados
        await page.click('[data-vb="reintentar"]');
        await page.waitForFunction(() => !/no respondió/.test((document.querySelector('.vb-dictamen') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
        const rutas = await page.evaluate(() => window.__llamadas.map(l => l.ruta));
        verificar('reintentar: completa el estudio (Marcanet ya cuenta)', !/no respondió/.test(await page.textContent('.vb-dictamen')) &&
            /Marcanet 2 resultados revisados/.test((await page.textContent('.vb-fuentes')).replace(/\s+/g, ' ')), (await page.textContent('.vb-fuentes')).replace(/\s+/g, ' '));
        verificar('reintentar: solo vuelve a pedir lo que faltó (no MARCia ni SIGA de nuevo)',
            rutas.includes('/marcanet/fonetica') && !rutas.includes('/marcia/search') && !rutas.includes('/siga/search'), rutas.join(', '));
        verificar('reintentar: también vuelve a pedir las fichas de MARCia que no se leyeron', rutas.some(r => r.startsWith('/marcia/view/')) &&
            /Fichas de MARCia (\d) de \1/.test((await page.textContent('.vb-fuentes')).replace(/\s+/g, ' ')), (await page.textContent('.vb-fuentes')).replace(/\s+/g, ' '));
        igual('reintentar: no cuenta como otro estudio', pedidasCuota, cuotasAntes);
        igual('reintentar: completa el estudio reciente, no agrega otro',
            await page.evaluate(() => JSON.parse(localStorage.getItem('impi_estudios_viabilidad') || '[]').length), recientesAntes);
        verificar('reintentar: ya completo, el botón desaparece', !(await page.isVisible('[data-vb="reintentar"]')));

        // MARCia falla una clase aunque se repita: lo de las otras clases se
        // queda, y el estudio dice que MARCia respondió a medias.
        await page.evaluate(simulador, 'marcia-clase');
        await page.evaluate(() => { window.__fonetica = 1; });
        await page.click('[data-vb="repetir-reciente"]');
        await page.waitForFunction(() => /a medias/.test((document.querySelector('.vb-dictamen') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
        const fuentesMedias = (await page.textContent('.vb-fuentes')).replace(/\s+/g, ' ');
        verificar('MARCia a medias: conserva las otras clases y dice cuál faltó',
            /MARCia respondió a medias; el resultado es parcial/.test(await page.textContent('.vb-dictamen')) && /faltaron las clases 43/.test(fuentesMedias) &&
            (await page.$$eval('.vb-tabla tbody tr', trs => trs.map(t => t.innerText))).some(t => /LUNA AZUL/.test(t)), fuentesMedias);
        verificar('MARCia a medias: se puede reintentar', await page.isVisible('[data-vb="reintentar"]'));

        // En el teléfono.
        await page.setViewportSize({ width: 390, height: 844 });
        await pausa(400);
        igual('viabilidad: en el teléfono nada se sale a lo ancho',
            await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
        const ancho = await page.evaluate(() => { const r = document.querySelector('.vb-reporte').getBoundingClientRect(); return r.right <= document.documentElement.clientWidth + 1; });
        igual('viabilidad: ni el reporte se sale de su tarjeta', ancho, true);

        igual('viabilidad: sin errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
    }
}

async function main() {
    verificar('la copia local de DOMPurify es la que pide la página',
        fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8').includes(`<script src="${URL_DOMPURIFY}"></script>`),
        'index.html cambió la versión de DOMPurify: actualiza URL_DOMPURIFY y el workflow');
    const servidor = await servidorEstatico(PUERTO);
    const navegador = await abrirChromium();
    const contexto = await navegador.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
    const page = await contexto.newPage();

    const erroresPagina = [];
    page.on('pageerror', e => erroresPagina.push(e.message));

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof descargarTemplateExpedientes === 'function', { timeout: 15000 });
        await page.waitForTimeout(1200);

        // ---- Sección de Expedientes (TSJ) ----
        await page.evaluate(() => navegarA('expedientes'));
        await page.waitForTimeout(600);
        await probarBotonTemplate(page, 'TSJ', 0);

        // ---- Sección federal (PJF) ----
        await page.evaluate(() => navegarA('pjf'));
        await page.waitForTimeout(600);
        // Dentro de PJF hay pestañas; abrir la de expedientes
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('[onclick]')]
                .find(el => /pjf-tab-expedientes|cambiarTabPJF\('expedientes'\)/.test(el.getAttribute('onclick') || ''));
            if (tab) tab.click();
        });
        await page.waitForTimeout(600);
        await probarBotonTemplate(page, 'PJF', 2);

        // ---- Tribunales TSJ: su pestaña de expedientes lleva el mismo botón ----
        await page.evaluate(() => { navegarA('busqueda'); cambiarTabTSJ('expedientes'); });
        await page.waitForTimeout(600);
        await probarBotonTemplate(page, 'Tribunales TSJ', 1);
        await page.evaluate(() => cambiarTabTSJ('busqueda'));

        // ---- La descarga cumple lo que Safari y Firefox exigen ----
        // Chromium se traga un <a> suelto y un revoke inmediato, así que este
        // fallo no se ve mirando si descarga: hay que comprobar la mecánica.
        const mecanica = await page.evaluate(() => {
            const resultado = { enElDocumento: null, revocadoEnElActo: false, nombre: null };

            const clickOriginal = HTMLAnchorElement.prototype.click;
            const revokeOriginal = URL.revokeObjectURL;
            let urlUsada = null;

            HTMLAnchorElement.prototype.click = function () {
                if (this.download) {
                    resultado.enElDocumento = document.body.contains(this);
                    resultado.nombre = this.download;
                    urlUsada = this.href;
                }
                // No se llama al original: no queremos descargar de verdad aquí.
            };
            URL.revokeObjectURL = function (u) {
                if (u === urlUsada) resultado.revocadoEnElActo = true;
                return revokeOriginal.call(URL, u);
            };

            try {
                descargarArchivo('prueba.txt', 'hola', 'text/plain');
            } finally {
                HTMLAnchorElement.prototype.click = clickOriginal;
                URL.revokeObjectURL = revokeOriginal;
            }
            return resultado;
        });

        igual('descarga: el enlace está en el documento al pulsarlo',
            mecanica.enElDocumento, true);
        igual('descarga: la URL del blob no se revoca en el mismo turno',
            mecanica.revocadoEnElActo, false);
        igual('descarga: el enlace lleva el nombre del archivo', mecanica.nombre, 'prueba.txt');

        // ---- Ningún tooltip debe quedar sin colocar ----
        const sinColocar = await page.evaluate(() => {
            const malos = [];
            document.querySelectorAll('.tooltip-container').forEach((c, i) => {
                const t = c.querySelector('.tooltip-content');
                if (!t) return;
                const disparador = c.querySelector('.help-btn') || c.querySelector('button, a');
                if (!disparador) return;
                disparador.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
                if (!t.style.top || !t.style.left) {
                    malos.push(i + ': ' + (disparador.textContent || '').trim().slice(0, 30));
                }
            });
            return malos;
        });
        igual('todos los tooltips quedan colocados al hacer hover', sinColocar, []);

        // ---- Borrar todo debe vaciar TODOS los stores ----
        // El fallo original: se limpiaban 4 de 9, y los pendientes y las
        // búsquedas del IMPI sobrevivían a "eliminar todos los datos".
        page.on('dialog', d => d.accept());
        await page.evaluate(async () => {
            const carpetaId = await agregarCarpeta({ nombre: 'Caso de prueba', color: '#3b82f6' });
            const id = await crearExpedienteCore({
                numero: '1/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                institucion: 'TSJ', carpetaId });
            await crearPendienteCore({ titulo: 'Tarea', expedienteId: id,
                fechaLimite: new Date(2026, 2, 15).toISOString() });
            await crearNotaCore({ titulo: 'Nota', expedienteId: id });
            await guardarConfig('email_destino', 'x@y.z');
            await new Promise(r => {
                const q = db.transaction(['sigaGuardadas'], 'readwrite')
                    .objectStore('sigaGuardadas').add({ query: 'nike', tool: 'impi' });
                q.onsuccess = () => r(); q.onerror = () => r();
            });
        });

        const contarStores = () => page.evaluate(async () => {
            const leer = (store) => new Promise(r => {
                const q = db.transaction([store], 'readonly').objectStore(store).getAll();
                q.onsuccess = () => r((q.result || []).length);
                q.onerror = () => r(0);
            });
            const out = {};
            for (const s of Array.from(db.objectStoreNames)) out[s] = await leer(s);
            return out;
        });

        const antes = await contarStores();
        verificar('borrar todo: había datos que borrar',
            Object.values(antes).some(n => n > 0), JSON.stringify(antes));
        verificar('borrar todo: había pendientes antes', antes.pendientes > 0, JSON.stringify(antes));
        verificar('borrar todo: había búsquedas del IMPI antes',
            antes.sigaGuardadas > 0, JSON.stringify(antes));

        await page.evaluate(() => eliminarTodosDatos());
        await page.waitForTimeout(2000);

        const despues = await contarStores();
        igual('borrar todo: no sobrevive nada en ningún store',
            Object.entries(despues).filter(([, n]) => n > 0), []);

        // ---- Selección múltiple en Pendientes ----
        await page.evaluate(async () => {
            const id = await crearExpedienteCore({
                numero: '9/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', institucion: 'TSJ' });
            for (let i = 1; i <= 4; i++) {
                await crearPendienteCore({ titulo: 'Tarea ' + i, expedienteId: id,
                    fechaLimite: i === 1 ? new Date(2026, 2, 15).toISOString() : null });
            }
            navegarA('pendientes');
        });
        await page.waitForTimeout(800);

        igual('selección: la barra empieza oculta',
            await page.locator('#bulk-actions-pendientes').isVisible(), false);

        await page.click('#btn-toggle-seleccion-pendientes');
        await page.waitForTimeout(400);
        igual('selección: al activarla aparece la barra',
            await page.locator('#bulk-actions-pendientes').isVisible(), true);
        igual('selección: cada pendiente recibe su casilla',
            await page.locator('.pendiente-seleccion input').count(), 4);

        await page.click('#check-todos-pendientes');
        await page.waitForTimeout(300);
        igual('selección: "todos" marca los 4',
            (await page.locator('#conteo-seleccion-pendientes').textContent()).trim(), '4 seleccionados');

        await page.locator('.pendiente-seleccion input').first().uncheck();
        await page.waitForTimeout(300);
        igual('selección: al desmarcar uno quedan 3',
            (await page.locator('#conteo-seleccion-pendientes').textContent()).trim(), '3 seleccionados');
        igual('selección: la casilla de cabecera queda a medias',
            await page.locator('#check-todos-pendientes').evaluate(el => el.indeterminate), true);

        const eventosAntes = await page.evaluate(async () => (await obtenerEventos()).length);
        await page.click('button:has-text("Eliminar seleccionados")');
        await page.waitForTimeout(1500);

        igual('selección: quedan los pendientes no seleccionados',
            await page.evaluate(async () => (await obtenerPendientes()).length), 1);
        igual('selección: el modo se cierra al terminar',
            await page.locator('#bulk-actions-pendientes').isVisible(), false);
        verificar('selección: los eventos de los borrados se van con ellos',
            await page.evaluate(async () => (await obtenerEventos()).length) <= eventosAntes);

        // ---- La carpeta del expediente se exige desde el pendiente ----
        // El campo de carpeta se pinta al vuelo según el expediente elegido:
        // con el DOM simulado de las pruebas de Node eso no se ve, y un
        // selector que no llegue a existir pasaría por "no hace falta carpeta".
        const expSinCarpeta = await page.evaluate(async () =>
            (await obtenerExpedientes()).find(e => e.numero === '9/2025').id);

        await page.evaluate(() => navegarA('pendientes'));
        await page.waitForTimeout(600);
        igual('carpeta: el pendiente de un expediente sin carpeta lo avisa',
            await page.locator('.pendiente-carpeta.sin-carpeta').count() > 0, true);

        await page.evaluate((id) => mostrarFormularioPendiente(null, id), expSinCarpeta);
        await page.waitForTimeout(500);

        igual('carpeta: el campo aparece al haber expediente',
            await page.locator('#pendiente-carpeta-group').isVisible(), true);
        igual('carpeta: se marca obligatoria',
            (await page.locator('#pendiente-carpeta-obligatoria').textContent()).trim(), '*');

        await page.fill('#pendiente-titulo', 'Presentar promoción');
        await page.click('#modal-footer .btn-primary');
        await page.waitForTimeout(700);

        igual('carpeta: sin elegirla no se guarda el pendiente',
            await page.evaluate(async () => (await obtenerPendientes()).length), 1);
        igual('carpeta: el formulario sigue abierto para arreglarlo',
            await page.locator('#pendiente-carpeta-group').isVisible(), true);

        await page.selectOption('#pendiente-carpeta', '__nueva__');
        await page.waitForTimeout(300);
        igual('carpeta: "crear nueva" abre su campo',
            await page.locator('#pendiente-carpeta-nueva').isVisible(), true);
        await page.fill('#pendiente-carpeta-nueva', 'Caso desde el pendiente');
        await page.click('#modal-footer .btn-primary');
        await page.waitForTimeout(1200);

        const trasCarpeta = await page.evaluate(async (id) => ({
            pendientes: (await obtenerPendientes()).length,
            carpetas: (await obtenerCarpetas()).map(c => c.nombre),
            carpetaDelExpediente: (await obtenerExpediente(id)).carpetaId
        }), expSinCarpeta);

        igual('carpeta: con ella puesta, el pendiente se guarda', trasCarpeta.pendientes, 2);
        verificar('carpeta: la carpeta nueva se crea',
            trasCarpeta.carpetas.includes('Caso desde el pendiente'), JSON.stringify(trasCarpeta.carpetas));
        verificar('carpeta: el expediente queda etiquetado',
            trasCarpeta.carpetaDelExpediente != null, JSON.stringify(trasCarpeta));

        await page.waitForTimeout(400);
        igual('carpeta: ya no queda ningún aviso de "sin carpeta"',
            await page.locator('.pendiente-carpeta.sin-carpeta').count(), 0);
        igual('carpeta: la etiqueta se ve en la lista',
            await page.locator('.pendiente-carpeta:has-text("Caso desde el pendiente")').count() > 0, true);

        // Un pendiente general no tiene expediente al que ponerle carpeta, así
        // que no debe pedirla: es la mitad de la regla que se olvida.
        await page.evaluate(() => mostrarFormularioPendiente());
        await page.waitForTimeout(500);
        igual('carpeta: un pendiente general no la pide',
            await page.locator('#pendiente-carpeta-group').isVisible(), false);
        await page.fill('#pendiente-titulo', 'Llamar al cliente');
        await page.click('#modal-footer .btn-primary');
        await page.waitForTimeout(1000);
        igual('carpeta: el pendiente general se guarda sin ella',
            await page.evaluate(async () => (await obtenerPendientes()).length), 3);

        // ---- Botón flotante de mejoras y fallos ----
        // Vive fuera de las secciones para estar en todas; eso solo se puede
        // comprobar navegando de verdad, y hay otro flotante (el micrófono)
        // con el que no debe chocar.
        const seccionesFAB = ['inicio', 'expedientes', 'calendario', 'pendientes',
                              'notas', 'busqueda', 'pjf', 'config'];
        const sinBoton = [];
        for (const seccion of seccionesFAB) {
            await page.evaluate(s => navegarA(s), seccion);
            await page.waitForTimeout(200);
            if (!(await page.locator('#fab-feedback').isVisible().catch(() => false))) {
                sinBoton.push(seccion);
            }
        }
        igual('feedback: el botón se ve en todas las secciones', sinBoton, []);

        const cajaFB = await page.locator('#fab-feedback').boundingBox().catch(() => null);
        const cajaVoz = await page.locator('#voz-fab').boundingBox().catch(() => null);
        verificar('feedback: no se solapa con el micrófono del asistente',
            !seSolapan(cajaFB, cajaVoz),
            `feedback ${JSON.stringify(cajaFB)} vs voz ${JSON.stringify(cajaVoz)}`);
        verificar('feedback: queda dentro de la pantalla',
            !!cajaFB && cajaFB.y >= 0 && cajaFB.x >= 0, JSON.stringify(cajaFB));

        // Un solo formulario para las dos cosas: se abre en "mejora" y se
        // puede cambiar sin perder lo escrito.
        await page.click('#fab-feedback');
        await page.waitForTimeout(500);
        igual('feedback: abre como sugerencia de mejora',
            (await page.locator('#modal-titulo').textContent()).trim(), '💡 Sugerir una mejora');

        await page.fill('#reporte-descripcion', 'texto que no se debe perder');
        await page.click('.reporte-tipo-btn[data-tipo="problema"]');
        await page.waitForTimeout(300);
        igual('feedback: cambia a reporte de problema',
            (await page.locator('#modal-titulo').textContent()).trim(), '🐞 Reportar un problema');
        igual('feedback: cambiar de tipo no borra lo escrito',
            await page.inputValue('#reporte-descripcion'), 'texto que no se debe perder');

        const contextoFB = await page.locator('#modal-body pre').textContent();
        verificar('feedback: adjunta la sección donde estaba el usuario',
            /Sección abierta:/.test(contextoFB), contextoFB.slice(0, 120));
        verificar('feedback: adjunta si la licencia es premium o gratuita',
            /Licencia:/.test(contextoFB), contextoFB.slice(0, 120));
        verificar('feedback: adjunta cuántos registros hay',
            /Registros:/.test(contextoFB), contextoFB.slice(0, 200));

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

        // ---- Anuncio de edictos ----
        // El sanitizador de anuncios convierte en "#" todo lo que no empiece
        // por http, así que un enlace mal formado se pierde en silencio.
        const anuncio = await page.evaluate(() => {
            const ad = ANUNCIOS_CONFIG.find(a => a.id === 'edictos');
            if (!ad) return null;
            const contenedor = document.querySelector('#page-expedientes .ad-banner');
            if (contenedor) {
                contenedor.style.display = 'block';
                contenedor.querySelector('.ad-body').innerHTML = generarHTMLAnuncio(ad);
            }
            const a = document.querySelector('#page-expedientes .ad-detallado');
            return a ? { href: a.getAttribute('href'), target: a.getAttribute('target'),
                         rel: a.getAttribute('rel'),
                         titulo: (a.querySelector('.ad-titulo') || {}).textContent || '',
                         llamada: (a.querySelector('.ad-llamada') || {}).textContent || '' } : null;
        });

        verificar('anuncio: el de edictos está configurado y se pinta', !!anuncio);
        if (anuncio) {
            verificar('anuncio: enlaza a WhatsApp con el número correcto',
                anuncio.href.startsWith('https://wa.me/529981399930?text='), anuncio.href);
            verificar('anuncio: el enlace no lo descarta el sanitizador',
                anuncio.href !== '#', anuncio.href);
            igual('anuncio: se abre en otra pestaña', anuncio.target, '_blank');
            verificar('anuncio: sin dejar acceso a la ventana de origen',
                /noopener/.test(anuncio.rel || ''), anuncio.rel);
            verificar('anuncio: tiene titular', anuncio.titulo.includes('Edictos'), anuncio.titulo);
            verificar('anuncio: y llamada a la acción',
                anuncio.llamada.includes('WhatsApp'), anuncio.llamada);
        }

        // ---- ...y que además se vea ----
        // La comprobación de arriba pinta el anuncio a mano, así que pasaba
        // aunque en la página no saliera nunca: el reparto sorteaba entre los
        // cuatro anuncios por igual y el de pago caía una de cada cuatro veces.
        // Esto ejecuta el reparto de verdad y mira lo que queda en pantalla.
        // Los destacados (edictos y la invitación a asociarse) se turnan: en
        // un turno salen unos, en el siguiente los otros, y entre los dos
        // turnos el de edictos ocupa todos los huecos destacados.
        const reparto = await page.evaluate(() => {
            const contar = () => {
                mostrarAnuncios();
                const cuerpos = [...document.querySelectorAll('.ad-banner .ad-body')];
                return {
                    huecos: cuerpos.length,
                    conEdictos: cuerpos.filter(b => /Edictos/.test(b.textContent)).length,
                    conSocio: cuerpos.filter(b => /asociarte/.test(b.textContent)).length,
                    conRelleno: cuerpos.filter(b => /anunciarte aquí|Espacio/.test(b.textContent)).length
                };
            };
            const turno = _turnoAnuncio;
            const uno = contar();
            _turnoAnuncio++;
            const otro = contar();
            _turnoAnuncio = turno;
            mostrarAnuncios();
            return { uno, otro };
        });
        const { uno, otro } = reparto;

        verificar('anuncio: hay huecos de anuncio en la página', uno.huecos > 0,
            JSON.stringify(reparto));
        verificar('anuncio: el reparto real lo saca en pantalla, no una vez de cada cuatro',
            Math.max(uno.conEdictos, otro.conEdictos) >= uno.huecos - 1, JSON.stringify(reparto));
        verificar('anuncio: y en el turno siguiente sale la invitación a asociarse',
            Math.max(uno.conSocio, otro.conSocio) >= uno.huecos - 1 &&
            Math.min(uno.conEdictos, otro.conEdictos) === 0, JSON.stringify(reparto));
        verificar('anuncio: queda un hueco para la invitación a anunciarse',
            uno.conRelleno >= 1 && otro.conRelleno >= 1, JSON.stringify(reparto));

        // Y no depende de la suerte: diez repartos seguidos, siempre igual.
        const constante = await page.evaluate(() => {
            const cuenta = [];
            for (let i = 0; i < 10; i++) {
                mostrarAnuncios();
                cuenta.push([...document.querySelectorAll('.ad-banner .ad-body')]
                    .filter(b => /Edictos/.test(b.textContent)).length);
            }
            return cuenta;
        });
        igual('anuncio: sale siempre, no según el sorteo',
            [...new Set(constante)].length, 1);

        // ---- El anuncio cubre también Yucatán ----
        const cobertura = await page.evaluate(() => {
            const ad = ANUNCIOS_CONFIG.find(a => a.id === 'edictos');
            return { titulo: ad.titulo, contenido: ad.contenido, enlace: ad.enlace };
        });
        verificar('anuncio: el titular nombra los dos estados',
            /Quintana Roo/.test(cobertura.titulo) && /Yucatán/.test(cobertura.titulo), cobertura.titulo);
        verificar('anuncio: el texto también lo dice', /Yucatán/.test(cobertura.contenido), cobertura.contenido);
        verificar('anuncio: y el mensaje de WhatsApp que se manda',
            /Yucat%C3%A1n/.test(cobertura.enlace), cobertura.enlace);

        // ---- Detalle de un expediente ----
        // Pulsar la tarjeta tiene que reunir en un sitio los pendientes y las
        // fechas del expediente, que antes había que ir a buscar a dos
        // pantallas distintas.
        await page.evaluate(async () => {
            const id = await crearExpedienteCore({
                numero: '77/2026', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', institucion: 'TSJ',
                actor: 'Pérez', demandado: 'García', comentario: 'Contestación presentada' });
            await crearPendienteCore({ titulo: 'Presentar pruebas', expedienteId: id,
                fechaLimite: new Date(2027, 4, 10).toISOString(), prioridad: 'alta' });
            await crearPendienteCore({ titulo: 'Ya hecho', expedienteId: id });
            await crearEventoCore({ titulo: 'Audiencia de ley', tipo: 'audiencia',
                fechaInicio: new Date(2027, 4, 20, 10, 0).toISOString(), expedienteId: id });
            // Otro expediente con sus cosas: no deben aparecer en el detalle del primero.
            const otro = await crearExpedienteCore({
                numero: '88/2026', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', institucion: 'TSJ' });
            await crearPendienteCore({ titulo: 'De otro expediente', expedienteId: otro });
            await crearEventoCore({ titulo: 'Audiencia ajena', tipo: 'audiencia',
                fechaInicio: new Date(2027, 5, 1).toISOString(), expedienteId: otro });
            navegarA('expedientes');
        });
        await page.waitForTimeout(900);

        await page.locator('.expediente-card', { hasText: '77/2026' }).first().click();
        await page.waitForTimeout(700);

        const detalle = await page.evaluate(() => {
            const cuerpo = document.getElementById('modal-body');
            return {
                abierto: document.getElementById('modal-overlay').classList.contains('active'),
                titulo: document.getElementById('modal-titulo').textContent,
                texto: cuerpo.textContent,
                pendientes: cuerpo.querySelectorAll('.detalle-bloque')[1].querySelectorAll('.detalle-item').length,
                eventos: cuerpo.querySelectorAll('.detalle-bloque')[2].querySelectorAll('.detalle-item').length
            };
        });

        igual('detalle: pulsar la tarjeta abre el detalle', detalle.abierto, true);
        igual('detalle: con el número del expediente por título', detalle.titulo, '77/2026');
        verificar('detalle: muestra actor y demandado',
            /Pérez/.test(detalle.texto) && /García/.test(detalle.texto));
        igual('detalle: lista sus dos pendientes', detalle.pendientes, 2);
        igual('detalle: y su fecha del calendario', detalle.eventos, 1);
        verificar('detalle: nombra el pendiente', /Presentar pruebas/.test(detalle.texto));
        verificar('detalle: y la audiencia', /Audiencia de ley/.test(detalle.texto));
        verificar('detalle: sin colar lo de otro expediente',
            !/De otro expediente/.test(detalle.texto) && !/Audiencia ajena/.test(detalle.texto),
            detalle.texto.slice(0, 200));

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

        // Pulsar un botón de la tarjeta hace lo del botón y NADA más: si el
        // detalle se abriera también, cada botón tendría dos efectos.
        const guardas = await page.evaluate(() => {
            const original = verDetalleExpediente;
            let llamadas = 0;
            window.verDetalleExpediente = () => { llamadas++; };

            const tarjeta = [...document.querySelectorAll('.expediente-card')]
                .find(c => c.textContent.includes('77/2026'));
            window.getSelection().removeAllRanges();

            // Se llama a la guarda directamente. Un clic real no probaría nada:
            // los botones de hoy frenan la propagación por su cuenta, así que
            // el detalle no se abriría aunque la guarda no existiese — y el día
            // que se añada un botón que no la frene, esto lo cubre.
            _clicEnTarjetaExpediente(
                { target: tarjeta.querySelector('button[title="Ver pendientes"]'), currentTarget: tarjeta }, 1);
            const trasBoton = llamadas;

            _clicEnTarjetaExpediente(
                { target: tarjeta.querySelector('.expediente-titulo'), currentTarget: tarjeta }, 1);
            const trasCuerpo = llamadas;

            window.verDetalleExpediente = original;
            return { trasBoton, trasCuerpo };
        });

        igual('detalle: pulsar un botón de la tarjeta no abre además el detalle',
            guardas.trasBoton, 0);
        igual('detalle: pulsar el cuerpo de la tarjeta sí lo abre',
            guardas.trasCuerpo, 1);

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

        // Editar desde el detalle abierto en el inicio (lo que sale al buscar):
        // el formulario vive en Expedientes, y se llenaba oculto. El modal se
        // cerraba y en el iPhone parecía que Editar no hacía nada.
        await page.evaluate(async () => {
            navegarA('inicio');
            const id = (await obtenerExpedientes()).find(e => e.numero === '77/2026').id;
            await verDetalleExpediente(id);
        });
        await page.waitForTimeout(400);
        await page.click('#modal-footer button:has-text("Editar")');
        await page.waitForTimeout(500);
        const edicion = await page.evaluate(() => ({
            pagina: document.querySelector('.page.active')?.id,
            formularioVisible: document.getElementById('form-expediente').offsetParent !== null,
            valor: document.getElementById('expediente-valor').value
        }));
        igual('editar desde el inicio: lleva a Expedientes', edicion.pagina, 'page-expedientes');
        igual('editar desde el inicio: el formulario se ve', edicion.formularioVisible, true);
        igual('editar desde el inicio: con el expediente cargado', edicion.valor, '77/2026');
        await page.evaluate(() => cerrarFormularioExpediente());

        // ---- Reporte de errores ----
        await page.evaluate(() => navegarA('config'));
        await page.waitForTimeout(500);
        await page.click('button:has-text("🐞 Reportar")');
        await page.waitForTimeout(600);

        const formulario = await page.evaluate(() => {
            const cuerpo = document.getElementById('modal-body');
            return {
                hayTextarea: !!document.getElementById('reporte-descripcion'),
                obligatorio: document.getElementById('reporte-descripcion')?.required,
                contexto: document.getElementById('form-reporte-bug')?.dataset.contexto || '',
                muestraLoQueEnvia: /datos técnicos/i.test(cuerpo.textContent)
            };
        });

        igual('reporte: el botón abre el formulario', formulario.hayTextarea, true);
        igual('reporte: la descripción es obligatoria', formulario.obligatorio, true);
        igual('reporte: se enseña lo que se va a mandar', formulario.muestraLoQueEnvia, true);
        verificar('reporte: el contexto lleva navegador y versión',
            /Navegador:/.test(formulario.contexto) && /Versión:/.test(formulario.contexto),
            formulario.contexto);
        verificar('reporte: y cuántos registros hay',
            /expedientes=\d+/.test(formulario.contexto), formulario.contexto);

        // Lo importante: el contexto NO puede llevar datos de los expedientes.
        // Son asuntos de clientes y no tienen por qué salir del navegador.
        verificar('reporte: sin números de expediente ni nombres de las partes',
            !/77\/2026/.test(formulario.contexto) && !/Pérez/.test(formulario.contexto) &&
            !/Presentar pruebas/.test(formulario.contexto) && !/CANCUN/.test(formulario.contexto),
            formulario.contexto);

        // Se envía sin llegar a Google: se intercepta y se mira qué manda.
        const envio = await page.evaluate(async () => {
            const original = window.fetch;
            let capturado = null;
            window.fetch = (url, opciones) => {
                capturado = { url, cuerpo: JSON.parse(opciones.body) };
                return Promise.resolve(new Response('{"success":true}', { status: 200 }));
            };
            document.getElementById('reporte-descripcion').value = 'El botón X no responde';
            document.getElementById('reporte-contacto').value = 'yo@ejemplo.mx';
            try {
                await enviarReporteBug(new Event('submit'));
            } finally {
                window.fetch = original;
            }
            return { capturado, cerrado: !document.getElementById('modal-overlay').classList.contains('active') };
        });

        verificar('reporte: se envía al script de Apps Script',
            /script\.google\.com/.test(envio.capturado?.url || ''), envio.capturado?.url);
        igual('reporte: con la acción correcta', envio.capturado?.cuerpo.action, 'reportar_bug');
        verificar('reporte: y el texto que se escribió',
            (envio.capturado?.cuerpo.descripcion || '').includes('El botón X no responde'),
            envio.capturado?.cuerpo.descripcion);
        // El tipo va marcado dentro del texto: así se distingue una mejora de
        // un fallo en la hoja sin volver a desplegar el Apps Script.
        verificar('reporte: el texto dice de qué tipo es',
            /^\[(PROBLEMA|MEJORA)\] /.test(envio.capturado?.cuerpo.descripcion || ''),
            envio.capturado?.cuerpo.descripcion);
        igual('reporte: y el tipo viaja también en su propio campo',
            envio.capturado?.cuerpo.tipo, 'problema');
        igual('reporte: con el correo de contacto', envio.capturado?.cuerpo.contacto, 'yo@ejemplo.mx');
        igual('reporte: al enviar se cierra el formulario', envio.cerrado, true);

        // Si falla el envío, el texto no se pierde.
        await page.evaluate(() => mostrarModalReporteBug());
        await page.waitForTimeout(500);
        const respaldo = await page.evaluate(async () => {
            const original = window.fetch;
            window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
            document.getElementById('reporte-descripcion').value = 'no hay red';
            try { await enviarReporteBug(new Event('submit')); } finally { window.fetch = original; }
            const campo = document.getElementById('reporte-respaldo');
            const enlace = document.querySelector('#modal-footer a[href^="mailto:"]');
            return { texto: campo ? campo.value : null, destino: enlace ? enlace.getAttribute('href') : null };
        });

        verificar('reporte: si falla el envío, el texto sigue ahí',
            /no hay red/.test(respaldo.texto || ''), respaldo.texto);
        verificar('reporte: y se ofrece mandarlo al correo de soporte',
            (respaldo.destino || '').startsWith('mailto:jorge_clemente@empirica.mx'), respaldo.destino);

        await page.evaluate(() => cerrarModal());

        // ---- Capa de IA (Gemini) ----
        // Todo con la red simulada: no se llama a Google en una prueba.
        const ia = await page.evaluate(async () => {
            const resultados = {};

            // Traducción del historial: Gemini llama "model" a lo que la API
            // de Groq llamaba "assistant".
            const contenidos = _contenidosGemini(null, { historial: [
                { role: 'user', content: 'hola' },
                { role: 'assistant', content: 'qué tal' }
            ]});
            resultados.roles = contenidos.map(c => c.role);
            resultados.textos = contenidos.map(c => c.parts[0].text);

            // Al tener que elegir solos, Flash antes que Pro.
            resultados.elegido = _elegirModelo(['gemini-9.9-pro', 'gemini-9.9-flash']);
            resultados.elegidoSinFlash = _elegirModelo(['gemini-9.9-pro']);

            // El mensaje exacto que dio el fallo que rompió el asistente.
            resultados.reconoceGroq = _esModeloInexistente(
                'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.');
            resultados.reconoceGemini = _esModeloInexistente(
                'models/gemini-2.5-flash is not found for API version v1beta');
            resultados.noConfundeOtros = _esModeloInexistente('Quota exceeded for this project');

            // JSON con los adornos que suelen venir alrededor.
            resultados.json = _extraerJSON('```json\n{"a":1}\n```');

            return resultados;
        });

        igual('ia: el historial se traduce a los roles de Gemini', ia.roles, ['user', 'model']);
        igual('ia: sin perder el texto', ia.textos, ['hola', 'qué tal']);
        igual('ia: se prefiere Flash sobre Pro', ia.elegido, 'gemini-9.9-flash');
        igual('ia: pero se coge Pro si es lo único', ia.elegidoSinFlash, 'gemini-9.9-pro');
        igual('ia: reconoce el error que rompió el asistente', ia.reconoceGroq, true);
        igual('ia: y el equivalente de Gemini', ia.reconoceGemini, true);
        igual('ia: sin confundirlo con otros errores', ia.noConfundeOtros, false);
        igual('ia: extrae el JSON de entre los adornos', ia.json, { a: 1 });

        // La petición que se manda de verdad.
        const peticion = await page.evaluate(async () => {
            await guardarConfig('ia_api_key', 'CLAVE-DE-PRUEBA');
            await guardarConfig('ia_modelo', 'gemini-de-prueba');

            const original = window.fetch;
            let capturada = null;
            window.fetch = (url, opciones) => {
                capturada = { url, cuerpo: JSON.parse(opciones.body), cabeceras: opciones.headers };
                return Promise.resolve(new Response(JSON.stringify({
                    candidates: [{ content: { parts: [{ text: 'OK' }] } }]
                }), { status: 200 }));
            };
            let texto;
            try { texto = await llamarIA('hola', { sistema: 'eres útil' }); }
            finally { window.fetch = original; }
            return { capturada, texto };
        });

        verificar('ia: llama al modelo configurado',
            /models\/gemini-de-prueba:generateContent/.test(peticion.capturada.url), peticion.capturada.url);
        igual('ia: la clave viaja en la cabecera',
            peticion.capturada.cabeceras['x-goog-api-key'], 'CLAVE-DE-PRUEBA');
        verificar('ia: y NUNCA en la url, que acaba en historiales y registros',
            !/CLAVE-DE-PRUEBA/.test(peticion.capturada.url), peticion.capturada.url);
        igual('ia: el prompt de sistema va aparte, no como un turno más',
            peticion.capturada.cuerpo.systemInstruction.parts[0].text, 'eres útil');
        igual('ia: y devuelve el texto del modelo', peticion.texto, 'OK');

        // ---- Lo que rompió el asistente no puede volver a romperlo ----
        // Si el proveedor retira el modelo guardado, la app busca uno vivo,
        // lo guarda y sigue, sin que nadie tenga que tocar el código.
        const recuperacion = await page.evaluate(async () => {
            await guardarConfig('ia_modelo', 'modelo-retirado');

            const original = window.fetch;
            const urls = [];
            window.fetch = (url, opciones) => {
                urls.push(url);
                if (/\/models\?/.test(url)) {
                    return Promise.resolve(new Response(JSON.stringify({ models: [
                        { name: 'models/gemini-nuevo-pro', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/gemini-nuevo-flash', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/solo-embeddings', supportedGenerationMethods: ['embedContent'] }
                    ]}), { status: 200 }));
                }
                if (/modelo-retirado/.test(url)) {
                    // 404 con el cuerpo vacío: así llegó el que dejó al
                    // asistente sin recuperarse. Fiarse solo del texto del
                    // mensaje no bastaba.
                    return Promise.resolve(new Response('', { status: 404 }));
                }
                return Promise.resolve(new Response(JSON.stringify({
                    candidates: [{ content: { parts: [{ text: 'respuesta buena' }] } }]
                }), { status: 200 }));
            };

            let texto, error = null;
            try { texto = await llamarIA('hola'); }
            catch (e) { error = e.message; }
            finally { window.fetch = original; }

            return { texto, error, urls, guardado: await obtenerConfig('ia_modelo') };
        });

        igual('ia: si retiran el modelo, la respuesta llega igual',
            recuperacion.texto, 'respuesta buena');
        verificar('ia: preguntando a la API qué modelos quedan',
            recuperacion.urls.some(u => /\/models\?/.test(u)), JSON.stringify(recuperacion.urls));
        igual('ia: se queda con uno que existe y descarta el de embeddings',
            recuperacion.guardado, 'gemini-nuevo-flash');
        igual('ia: sin dar error al usuario', recuperacion.error, null);

        // "Probar conexión" no debe guardar nada.
        const prueba = await page.evaluate(async () => {
            await guardarConfig('ia_api_key', 'LA-GUARDADA');
            await guardarConfig('ia_modelo', 'EL-GUARDADO');
            document.getElementById('ia-api-key').value = 'ESCRITA-EN-PANTALLA';
            const select = document.getElementById('ia-modelo');
            select.add(new Option('ESCRITO-EN-PANTALLA', 'ESCRITO-EN-PANTALLA'));
            select.value = 'ESCRITO-EN-PANTALLA';

            const original = window.fetch;
            let urlUsada = null, cabecerasUsadas = null;
            window.fetch = (url, opciones) => {
                urlUsada = url;
                cabecerasUsadas = (opciones || {}).headers || {};
                return Promise.resolve(new Response(JSON.stringify({
                    candidates: [{ content: { parts: [{ text: 'OK' }] } }]
                }), { status: 200 }));
            };
            try { await probarIA(); } finally { window.fetch = original; }

            return { urlUsada, cabecerasUsadas,
                     key: await obtenerConfig('ia_api_key'),
                     modelo: await obtenerConfig('ia_modelo') };
        });

        verificar('ia: probar usa el modelo escrito en pantalla',
            /ESCRITO-EN-PANTALLA/.test(prueba.urlUsada), prueba.urlUsada);
        igual('ia: y la clave escrita en pantalla',
            prueba.cabecerasUsadas['x-goog-api-key'], 'ESCRITA-EN-PANTALLA');
        igual('ia: probar no pisa la clave guardada', prueba.key, 'LA-GUARDADA');

        // Una clave rechazada tiene que decirse como lo que es, no como
        // "modelo no encontrado": son dos problemas con arreglos distintos.
        const claveMala = await page.evaluate(async () => {
            const original = window.fetch;
            window.fetch = () => Promise.resolve(new Response(JSON.stringify({
                error: { message: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' } }), { status: 401 }));
            let mensaje = null;
            try { await listarModelosIA('CLAVE-QUE-NO-VALE'); }
            catch (e) { mensaje = e.message; }
            finally { window.fetch = original; }
            return mensaje;
        });

        verificar('ia: una clave rechazada dice que el problema es la clave',
            /clave no fue aceptada/.test(claveMala || ''), claveMala);
        verificar('ia: y dónde se saca una buena',
            /aistudio\.google\.com/.test(claveMala || ''), claveMala);
        igual('ia: ni el modelo guardado', prueba.modelo, 'EL-GUARDADO');

        // ---- Enlaces #expedientes/<id> ----
        // El aviso "no está visible en la lista actual (¿archivado o en otra
        // vista?)" salía en cada arranque: el hash se quedaba en la url y el
        // enlace roto se volvía a disparar para siempre.
        await page.evaluate(() => navegarA('expedientes'));
        await page.waitForTimeout(500);

        const enlaceRoto = await page.evaluate(async () => {
            history.replaceState(null, '', '#expedientes/999999');
            const avisos = [];
            const originalToast = window.mostrarToast;
            window.mostrarToast = (m, t) => avisos.push({ m, t });
            try { await mostrarExpediente(999999); } finally { window.mostrarToast = originalToast; }
            return { avisos, hash: location.hash };
        });

        verificar('enlace: uno a un expediente inexistente lo dice claro',
            /ya no existe/.test(enlaceRoto.avisos[0]?.m || ''), JSON.stringify(enlaceRoto.avisos));
        verificar('enlace: sin encogerse de hombros con "¿archivado o en otra vista?"',
            !/otra vista/.test(enlaceRoto.avisos[0]?.m || ''), enlaceRoto.avisos[0]?.m);
        igual('enlace: y se olvida, para no repetirse en cada arranque',
            enlaceRoto.hash, '');

        // Uno archivado: existe, así que se abre su detalle en vez de dejarlo
        // en un aviso que no lleva a ningún sitio.
        const enlaceArchivado = await page.evaluate(async () => {
            const id = await crearExpedienteCore({
                numero: '55/2026', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', institucion: 'TSJ' });
            await archivarExpedienteDB(id, true, 'concluido', 'Archivo 2026');
            await cargarExpedientes();
            await new Promise(r => setTimeout(r, 400));

            history.replaceState(null, '', '#expedientes/' + id);
            const avisos = [];
            const originalToast = window.mostrarToast;
            window.mostrarToast = (m, t) => avisos.push({ m, t });
            try { await mostrarExpediente(id); } finally { window.mostrarToast = originalToast; }

            return {
                avisos,
                hash: location.hash,
                detalleAbierto: document.getElementById('modal-overlay').classList.contains('active'),
                tituloDetalle: document.getElementById('modal-titulo').textContent
            };
        });

        verificar('enlace: uno archivado dice que está archivado',
            /archivado/.test(enlaceArchivado.avisos[0]?.m || ''), JSON.stringify(enlaceArchivado.avisos));
        igual('enlace: y abre su detalle igualmente', enlaceArchivado.detalleAbierto, true);
        igual('enlace: con el expediente correcto', enlaceArchivado.tituloDetalle, '55/2026');
        igual('enlace: el hash tampoco se queda', enlaceArchivado.hash, '');

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

        // Uno que sí está en la lista: se resalta y el enlace SÍ se conserva,
        // que para eso está —compartirlo o recargarlo.
        const enlaceBueno = await page.evaluate(async () => {
            const tarjeta = [...document.querySelectorAll('#page-expedientes .expediente-card')]
                .find(c => c.textContent.includes('77/2026'));
            const id = parseInt(tarjeta.dataset.id);
            await mostrarExpediente(id);
            return {
                hash: location.hash,
                resaltado: tarjeta.classList.contains('expediente-destacado'),
                esperado: '#expedientes/' + id
            };
        });

        igual('enlace: uno que sí está en la lista se resalta', enlaceBueno.resaltado, true);
        igual('enlace: y se conserva para poder compartirlo',
            enlaceBueno.hash, enlaceBueno.esperado);

        await page.evaluate(() => { history.replaceState(null, '', location.pathname); });

        // ---- Un pendiente con hora se agenda A SU HORA ----
        // El <input type="datetime-local"> siempre devuelve hora, y el
        // formulario no la pasaba: todo pendiente acababa en el calendario
        // como "todo el día", también el que se puso para las 11:45.
        await page.evaluate(() => navegarA('pendientes'));
        await page.waitForTimeout(400);
        await page.evaluate(() => mostrarFormularioPendiente());
        await page.waitForTimeout(400);
        await page.fill('#pendiente-titulo', 'Audiencia con hora');
        await page.fill('#pendiente-fecha', '2027-06-15T11:45');
        await page.evaluate(() => document.getElementById('pendiente-form').requestSubmit());
        await page.waitForTimeout(700);

        const conHora = await page.evaluate(async () => {
            const ev = (await obtenerEventos()).find(e => e.titulo === 'Audiencia con hora');
            const p = (await obtenerPendientes()).find(x => x.titulo === 'Audiencia con hora');
            if (!ev || !p) return null;
            const f = new Date(ev.fechaInicio);
            return {
                todoElDia: ev.todoElDia,
                hora: f.getHours(), minutos: f.getMinutes(),
                vinculado: p.eventoId === ev.id,
                deVuelta: ev.pendienteId === p.id
            };
        });

        verificar('pendiente con hora: se agenda en el calendario', !!conHora, 'no se creó el evento');
        igual('pendiente con hora: NO se agenda como día completo', conHora && conHora.todoElDia, false);
        igual('pendiente con hora: se agenda a las 11:45',
            conHora && [conHora.hora, conHora.minutos], [11, 45]);
        igual('pendiente con hora: queda vinculado a su evento', conHora && conHora.vinculado, true);
        igual('pendiente con hora: y el evento sabe de quién es', conHora && conHora.deVuelta, true);

        // Y el mismo formulario sin hora sigue agendando el día entero.
        await page.evaluate(() => mostrarFormularioPendiente());
        await page.waitForTimeout(400);
        await page.fill('#pendiente-titulo', 'Vence el plazo');
        await page.fill('#pendiente-fecha', '2027-06-16T00:00');
        await page.evaluate(() => document.getElementById('pendiente-form').requestSubmit());
        await page.waitForTimeout(700);

        const sinHora = await page.evaluate(async () =>
            (await obtenerEventos()).find(e => e.titulo === 'Vence el plazo') || null);
        igual('pendiente sin hora: se agenda como día completo',
            sinHora && sinHora.todoElDia, true);

        // ---- Ninguna fecha se queda fuera del calendario ----
        // Un pendiente puede entrar a la base sin pasar por el formulario (un
        // respaldo importado, lo que baja de otro dispositivo). El repaso del
        // arranque tiene que recogerlo.
        const rescatado = await page.evaluate(async () => {
            const id = await agregarPendiente({
                titulo: 'Llegó de un respaldo',
                fechaLimite: new Date(2027, 6, 8, 0, 0).toISOString(),
                completado: false,
                eventoId: null
            });
            const antes = (await obtenerEventos()).some(e => e.titulo === 'Llegó de un respaldo');
            const resumen = await sincronizarPendientesConCalendarioCore();
            const ev = (await obtenerEventos()).find(e => e.titulo === 'Llegó de un respaldo');
            const p = (await obtenerPendiente(id));

            // Repasar otra vez no puede duplicarlo.
            await sincronizarPendientesConCalendarioCore();
            const cuantos = (await obtenerEventos())
                .filter(e => e.titulo === 'Llegó de un respaldo').length;

            return { antes, creados: resumen.creados, agendado: !!ev, vinculado: p.eventoId === (ev || {}).id, cuantos };
        });

        igual('rescate: sin repaso no estaba en el calendario', rescatado.antes, false);
        igual('rescate: el repaso lo agenda', rescatado.creados >= 1, true);
        igual('rescate: y aparece en el calendario', rescatado.agendado, true);
        igual('rescate: con su vínculo puesto', rescatado.vinculado, true);
        igual('rescate: repasar dos veces no lo duplica', rescatado.cuantos, 1);

        // ---- Búsqueda rápida de expedientes en Inicio (SOLO MÓVIL) ----
        // En escritorio no debe aparecer: ahí el menú está a la vista y hay
        // Ctrl+K. Si se colara, ocuparía sitio en el panel sin aportar nada.
        await page.evaluate(() => navegarA('inicio'));
        await page.waitForTimeout(400);

        igual('rápida: en escritorio no se ve',
            await page.locator('#busqueda-rapida').isVisible(), false);

        // A partir de aquí, un teléfono.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(400);

        igual('rápida: en el móvil sí se ve',
            await page.locator('#busqueda-rapida-input').isVisible(), true);

        // "Visible al abrir" quiere decir sin tener que bajar: si cae por
        // debajo del primer pantallazo, no sirve de nada.
        const caja = await page.locator('#busqueda-rapida-input').boundingBox();
        verificar('rápida: está a la vista sin bajar la página',
            caja && caja.y >= 0 && caja.y < 844, JSON.stringify(caja));

        // Buscar por número, aunque se escriba solo la parte de antes del año.
        await page.fill('#busqueda-rapida-input', '77');
        await page.waitForTimeout(500);

        const porNumero = await page.evaluate(() => ({
            abierto: !document.getElementById('busqueda-rapida-resultados').hidden,
            titulos: [...document.querySelectorAll('.busqueda-rapida-item .bri-titulo')]
                .map(e => e.textContent.trim())
        }));
        igual('rápida: buscar "77" abre resultados', porNumero.abierto, true);
        verificar('rápida: y encuentra el 77/2026 sin escribir el año',
            porNumero.titulos.includes('77/2026'), JSON.stringify(porNumero.titulos));

        // Por una parte del expediente, no solo por el número.
        await page.fill('#busqueda-rapida-input', 'perez');
        await page.waitForTimeout(500);
        const porParte = await page.evaluate(() =>
            [...document.querySelectorAll('.busqueda-rapida-item .bri-titulo')].map(e => e.textContent.trim()));
        verificar('rápida: encuentra por el nombre de la parte, y sin acentos',
            porParte.includes('77/2026'), JSON.stringify(porParte));

        // Tocar un resultado abre su ficha: es a lo que se venía.
        await page.click('.busqueda-rapida-item');
        await page.waitForTimeout(700);
        const fichaAbierta = await page.evaluate(() => ({
            abierta: document.getElementById('modal-overlay').classList.contains('active'),
            titulo: document.getElementById('modal-titulo').textContent,
            panelCerrado: document.getElementById('busqueda-rapida-resultados').hidden
        }));
        igual('rápida: tocar el resultado abre la ficha del expediente', fichaAbierta.abierta, true);
        igual('rápida: y es la del expediente que se tocó', fichaAbierta.titulo, '77/2026');
        igual('rápida: el desplegable se cierra al abrirla', fichaAbierta.panelCerrado, true);

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

        // Un archivado se ofrece igual, pero marcado: decir "no existe" sobre
        // algo que sí está es peor que ofrecerlo con su etiqueta.
        await page.fill('#busqueda-rapida-input', '55/2026');
        await page.waitForTimeout(500);
        const archivado = await page.evaluate(() => {
            const item = document.querySelector('.busqueda-rapida-item');
            return item ? { texto: item.textContent, chip: !!item.querySelector('.bri-chip.archivado') } : null;
        });
        verificar('rápida: un expediente archivado también sale',
            archivado && /55\/2026/.test(archivado.texto), JSON.stringify(archivado));
        igual('rápida: y sale marcado como archivado', archivado && archivado.chip, true);

        // Lo que no existe se dice, no se deja el desplegable en blanco.
        await page.fill('#busqueda-rapida-input', 'zzzzzz');
        await page.waitForTimeout(500);
        const sinNada = await page.evaluate(() => ({
            abierto: !document.getElementById('busqueda-rapida-resultados').hidden,
            texto: (document.querySelector('.busqueda-rapida-vacio') || {}).textContent || ''
        }));
        igual('rápida: sin resultados el desplegable sigue abierto', sinNada.abierto, true);
        verificar('rápida: y lo dice con la consulta delante',
            /zzzzzz/.test(sinNada.texto), sinNada.texto);

        // La ✕ limpia y cierra.
        igual('rápida: con texto aparece la ✕',
            await page.locator('#busqueda-rapida-limpiar').isVisible(), true);
        await page.click('#busqueda-rapida-limpiar');
        await page.waitForTimeout(300);
        const limpio = await page.evaluate(() => ({
            valor: document.getElementById('busqueda-rapida-input').value,
            cerrado: document.getElementById('busqueda-rapida-resultados').hidden
        }));
        igual('rápida: la ✕ vacía el campo', limpio.valor, '');
        igual('rápida: y cierra el desplegable', limpio.cerrado, true);

        // El teclado del móvil trae "buscar": entrar abre el primer resultado.
        await page.fill('#busqueda-rapida-input', '88');
        await page.waitForTimeout(500);
        await page.press('#busqueda-rapida-input', 'Enter');
        await page.waitForTimeout(700);
        const conEnter = await page.evaluate(() => ({
            abierta: document.getElementById('modal-overlay').classList.contains('active'),
            titulo: document.getElementById('modal-titulo').textContent
        }));
        igual('rápida: entrar abre el primer resultado', conEnter.abierta, true);
        igual('rápida: y es el que se buscaba', conEnter.titulo, '88/2026');

        await page.evaluate(() => { cerrarModal(); limpiarBusquedaRapida(); });
        await page.waitForTimeout(300);

        // Con una consulta amplia no caben todos: hay que poder llegar a la
        // lista completa en vez de quedarse con los primeros ocho.
        await page.evaluate(async () => {
            for (let i = 1; i <= 10; i++) {
                await crearExpedienteCore({
                    numero: `${600 + i}/2026`, institucion: 'TSJ',
                    juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                    comentario: 'asuntoamplio'
                });
            }
            await cargarExpedientes();
        });
        await page.fill('#busqueda-rapida-input', 'asuntoamplio');
        await page.waitForTimeout(600);

        const conMuchos = await page.evaluate(() => ({
            mostrados: document.querySelectorAll('.busqueda-rapida-item').length,
            hayMas: !!document.querySelector('.busqueda-rapida-mas'),
            textoMas: (document.querySelector('.busqueda-rapida-mas') || {}).textContent || ''
        }));
        igual('rápida: no vuelca la lista entera en el desplegable', conMuchos.mostrados, 8);
        igual('rápida: y avisa de los que no caben', conMuchos.hayMas, true);
        verificar('rápida: diciendo cuántos faltan', /2 más/.test(conMuchos.textoMas), conMuchos.textoMas);

        await page.click('.busqueda-rapida-mas');
        await page.waitForTimeout(700);
        const enLaLista = await page.evaluate(() => ({
            pagina: document.querySelector('.page.active').id,
            filtro: document.getElementById('buscar-expediente').value,
            encontrados: document.querySelectorAll('#lista-expedientes .expediente-card').length
        }));
        igual('rápida: "ver los demás" lleva a Expedientes', enLaLista.pagina, 'page-expedientes');
        igual('rápida: con la búsqueda ya puesta', enLaLista.filtro, 'asuntoamplio');
        igual('rápida: y la lista filtrada, con los diez', enLaLista.encontrados, 10);

        await page.evaluate(() => {
            document.getElementById('buscar-expediente').value = '';
            filtrarExpedientes();
            navegarA('inicio');
        });
        await page.waitForTimeout(500);

        // De vuelta al escritorio: sigue sin aparecer.
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.waitForTimeout(400);
        igual('rápida: al volver al escritorio se esconde otra vez',
            await page.locator('#busqueda-rapida').isVisible(), false);

        // ---- Notas fijadas arriba ----
        const fijadas = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            cerrarModal();
            for (const t of ['Nota uno', 'Nota dos', 'Nota tres']) await crearNotaCore({ titulo: t, contenido: 'x' });
            navegarA('notas');
            await cargarNotas();
            const titulos = () => [...document.querySelectorAll('#lista-notas .nota-card .nota-titulo')].map(h => h.textContent)
                .filter(t => /^Nota (uno|dos|tres)$/.test(t));
            const boton = (titulo) => [...document.querySelectorAll('#lista-notas .nota-card')]
                .find(c => c.querySelector('.nota-titulo').textContent === titulo).querySelector('.nota-fijar');
            const r = { antes: titulos() };
            boton('Nota tres').click();
            await pausa(500);
            r.abrioEditor = document.getElementById('modal-overlay').classList.contains('active');
            r.despues = titulos();
            r.marcada = [...document.querySelectorAll('#lista-notas .nota-card.fijada .nota-titulo')].map(h => h.textContent);
            // Filtrar sigue respetando las fijadas.
            document.getElementById('buscar-nota').value = 'nota';
            await filtrarNotas();
            r.filtrada = titulos();
            document.getElementById('buscar-nota').value = '';
            await cargarNotas();
            boton('Nota tres').click();
            await pausa(500);
            r.desfijada = titulos();
            return r;
        });
        igual('notas: sin fijar, en su orden de siempre', fijadas.antes, ['Nota uno', 'Nota dos', 'Nota tres']);
        igual('notas: la fijada pasa hasta arriba', fijadas.despues, ['Nota tres', 'Nota uno', 'Nota dos']);
        igual('notas: y se ve marcada', fijadas.marcada, ['Nota tres']);
        igual('notas: fijar no abre el editor de la nota', fijadas.abrioEditor, false);
        igual('notas: al buscar sigue arriba', fijadas.filtrada, ['Nota tres', 'Nota uno', 'Nota dos']);
        igual('notas: desfijada vuelve a su sitio', fijadas.desfijada, ['Nota uno', 'Nota dos', 'Nota tres']);

        // ---- Inicio: las tarjetas se tocan y abren su vista rápida ----
        const inicio = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            cerrarModal();
            const dia = (n, h = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
            const idVencido = await crearPendienteCore({ titulo: 'Inicio: vencido', fechaLimite: dia(-1), todoElDia: true });
            await crearPendienteCore({ titulo: 'Inicio: esta semana', fechaLimite: dia(3), todoElDia: true });
            await crearEventoCore({ titulo: 'Inicio: audiencia', tipo: 'audiencia', fechaInicio: dia(1, 10) });
            navegarA('inicio');
            await cargarEstadisticas();
            const valor = (id) => Number(document.getElementById(id).textContent);
            const panel = () => document.getElementById('panel-rapido');
            const filas = () => [...panel().querySelectorAll('.panel-rapido-fila strong')].map(s => s.textContent);
            const r = {};
            r.urgentesAntes = valor('stat-pendientes');

            document.getElementById('stat-card-pendientes').click();
            await pausa(200);
            r.abierto = !panel().hidden;
            r.expandido = document.getElementById('stat-card-pendientes').getAttribute('aria-expanded');
            r.filasPendientes = filas();
            // Terminarlo desde el propio inicio.
            const fila = [...panel().querySelectorAll('.panel-rapido-fila')].find(f => /Inicio: vencido/.test(f.textContent));
            fila.querySelector('.panel-rapido-hecho').click();
            await pausa(700);
            r.urgentesDespues = valor('stat-pendientes');
            r.terminado = (await obtenerPendiente(idVencido)).completado;
            r.siguePanel = !panel().hidden && !filas().includes('Inicio: vencido');

            document.getElementById('stat-card-eventos').click();
            await pausa(200);
            r.filasEventos = filas();
            r.soloUnoExpandido = [...document.querySelectorAll('.stat-interactiva[aria-expanded="true"]')].length;
            const filaEvento = [...panel().querySelectorAll('.panel-rapido-abrir')].find(b => /Inicio: audiencia/.test(b.textContent));
            filaEvento.click();
            await pausa(400);
            r.enCalendario = document.getElementById('page-calendario').classList.contains('active');
            r.editorAbierto = document.getElementById('modal-overlay').classList.contains('active') &&
                document.getElementById('evento-titulo').value === 'Inicio: audiencia';
            r.panelCerrado = panel().hidden;
            cerrarModal();

            const nota = (await obtenerNotas()).find(n => n.titulo === 'Nota uno');
            await actualizarNotaCore(nota.id, { fijada: true, fijadaEn: new Date().toISOString() });
            navegarA('inicio');
            r.contadorFijadas = Number(document.getElementById('stat-notas').textContent);
            document.getElementById('stat-card-notas').click();
            await pausa(200);
            r.filasNotas = filas();
            document.getElementById('stat-card-notas').click();
            await pausa(100);
            r.cerradoConOtroClic = panel().hidden;
            document.getElementById('stat-card-expedientes').click();
            await pausa(200);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            r.cerradoConEscape = panel().hidden;
            return r;
        });
        verificar('inicio: cuenta los pendientes vencidos o de hoy', inicio.urgentesAntes >= 1, String(inicio.urgentesAntes));
        igual('inicio: tocar la tarjeta abre su vista rápida', inicio.abierto, true);
        igual('inicio: y lo anuncia a los lectores de pantalla', inicio.expandido, 'true');
        verificar('inicio: con lo vencido y lo de la semana', inicio.filasPendientes.includes('Inicio: vencido') &&
            inicio.filasPendientes.includes('Inicio: esta semana'), JSON.stringify(inicio.filasPendientes));
        igual('inicio: un pendiente se termina desde ahí', inicio.terminado, true);
        igual('inicio: y el contador baja al momento', inicio.urgentesDespues, inicio.urgentesAntes - 1);
        igual('inicio: la lista abierta se actualiza sola', inicio.siguePanel, true);
        verificar('inicio: la vista de eventos trae la audiencia de mañana', inicio.filasEventos.includes('Inicio: audiencia'),
            JSON.stringify(inicio.filasEventos));
        igual('inicio: solo una tarjeta abierta a la vez', inicio.soloUnoExpandido, 1);
        igual('inicio: tocar un evento lleva al calendario', inicio.enCalendario, true);
        igual('inicio: con el evento abierto para editar', inicio.editorAbierto, true);
        igual('inicio: y la vista rápida se cierra', inicio.panelCerrado, true);
        igual('inicio: la tarjeta cuenta las notas fijadas', inicio.contadorFijadas, 1);
        igual('inicio: y su vista las muestra', inicio.filasNotas, ['Nota uno']);
        igual('inicio: tocar otra vez la tarjeta la cierra', inicio.cerradoConOtroClic, true);
        igual('inicio: y Esc también', inicio.cerradoConEscape, true);

        // ---- Tribunales: un solo apartado para TSJ y PJF ----
        const trib = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            const visible = (id) => document.getElementById(id).classList.contains('active');
            const botonMenu = () => document.querySelector('.main-nav .nav-btn[data-page="tribunales"], nav .nav-btn[data-page="tribunales"]');
            const r = {};
            r.entradasMenu = [...document.querySelectorAll('.nav-btn')].map(b => b.dataset.page)
                .filter(p => ['busqueda', 'pjf', 'tribunales'].includes(p));
            try { localStorage.removeItem('tribunal_actual'); } catch (e) {}
            botonMenu().click();
            await pausa(200);
            r.abreTSJ = visible('page-busqueda');
            r.menuMarcado = botonMenu().classList.contains('active');
            // Cambiar al PJF desde el selector.
            document.querySelector('#page-busqueda .tribunal-opcion:not(.activa)').click();
            await pausa(200);
            r.pasaAPJF = visible('page-pjf');
            r.menuSigueMarcado = botonMenu().classList.contains('active');
            r.pestanasPJF = [...document.querySelectorAll('#page-pjf .pjf-tab')].map(t => t.textContent.trim());
            navegarA('inicio');
            botonMenu().click();
            await pausa(200);
            r.recuerdaPJF = visible('page-pjf');
            // Pestañas del TSJ.
            navegarA('busqueda');
            const pjfAntes = document.querySelector('#page-pjf .pjf-tab.active')?.dataset.pjfTab;
            cambiarTabTSJ('ia');
            r.tsjIA = visible('tsj-tab-ia') && !visible('tsj-tab-busqueda');
            r.pjfIntacto = document.querySelector('#page-pjf .pjf-tab.active')?.dataset.pjfTab === pjfAntes;
            cambiarTabTSJ('busqueda');

            // Notas y calendario filtrados por tribunal.
            const idPJF = await crearExpedienteCore({ numero: '9/2026', institucion: 'PJF', juzgado: 'Primer Tribunal Colegiado' });
            const idTSJ = await crearExpedienteCore({ numero: '8/2026', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' });
            await crearNotaCore({ titulo: 'Nota federal', expedienteId: idPJF });
            await crearNotaCore({ titulo: 'Nota estatal', expedienteId: idTSJ });
            navegarA('notas');
            actualizarSelectExpedientes();
            await pausa(200);
            const select = document.getElementById('filtro-expediente-nota');
            select.value = '__pjf__';
            await filtrarNotas();
            const titulos = () => [...document.querySelectorAll('#lista-notas .nota-titulo')].map(h => h.textContent);
            r.notasPJF = titulos().filter(t => /^Nota (federal|estatal)$/.test(t));
            select.value = '__tsj__';
            await filtrarNotas();
            r.notasTSJ = titulos().filter(t => /^Nota (federal|estatal)$/.test(t));
            select.value = '';
            await filtrarNotas();

            const hoy = new Date(); hoy.setHours(11, 0, 0, 0);
            await crearEventoCore({ titulo: 'Evento federal', tipo: 'audiencia', fechaInicio: hoy.toISOString(), expedienteId: idPJF });
            await crearEventoCore({ titulo: 'Evento estatal', tipo: 'audiencia', fechaInicio: hoy.toISOString(), expedienteId: idTSJ });
            navegarA('calendario');
            irAHoy();
            await pausa(300);
            const eventosPanel = () => [...document.querySelectorAll('#lista-eventos-panel .evento-titulo')]
                .map(e => e.textContent).filter(t => /Evento (federal|estatal)/.test(t));
            r.calTodos = eventosPanel().length;
            cambiarFiltroTribunalCalendario('PJF');
            await pausa(300);
            r.calPJF = eventosPanel().map(t => t.replace(/PJF$/, '').trim());
            r.selectRefleja = document.getElementById('filtro-tribunal-calendario').value;
            cambiarFiltroTribunalCalendario('');
            await pausa(300);
            r.calDeVuelta = eventosPanel().length;
            return r;
        });
        igual('tribunales: una sola entrada en cada menú', trib.entradasMenu, ['tribunales', 'tribunales']);
        igual('tribunales: abre el TSJ la primera vez', trib.abreTSJ, true);
        igual('tribunales: y marca su botón del menú', trib.menuMarcado, true);
        igual('tribunales: el selector cambia al PJF', trib.pasaAPJF, true);
        igual('tribunales: sin dejar de marcar el menú', trib.menuSigueMarcado, true);
        verificar('tribunales: el PJF ya no duplica notas ni calendario',
            !trib.pestanasPJF.some(t => /Notas PJF|Calendario PJF/.test(t)), JSON.stringify(trib.pestanasPJF));
        igual('tribunales: recuerda el último tribunal', trib.recuerdaPJF, true);
        igual('tribunales: el TSJ tiene sus pestañas', trib.tsjIA, true);
        igual('tribunales: cambiarlas no mueve las del PJF', trib.pjfIntacto, true);
        igual('notas: filtro "Solo PJF"', trib.notasPJF, ['Nota federal']);
        igual('notas: filtro "Solo TSJ"', trib.notasTSJ, ['Nota estatal']);
        igual('calendario: sin filtro se ven los dos', trib.calTodos, 2);
        igual('calendario: "Solo PJF" deja el federal', trib.calPJF, ['Evento federal']);
        igual('calendario: y el selector lo refleja', trib.selectRefleja, 'PJF');
        igual('calendario: quitar el filtro los devuelve', trib.calDeVuelta, 2);

        // ---- Tribunales TSJ: las mismas tres pestañas y el mismo formato que el PJF ----
        const tsj = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            const visible = (el) => !!el && el.offsetParent !== null;
            const r = {};
            const premiumAntes = estadoPremium.activo;
            estadoPremium.activo = true;          // que el límite gratuito no esconda nada
            const abiertas = [];
            const openOriginal = window.open;
            window.open = (url) => { abiertas.push(url); return { focus() {} }; };
            try {
                navegarA('busqueda');
                await pausa(200);
                const pestanas = (sel) => [...document.querySelectorAll(sel)].map(t => t.textContent.trim().split(' ')[0]);
                r.pestanasTSJ = [...document.querySelectorAll('#page-busqueda .pjf-tab')].map(t => t.textContent.trim());
                r.mismosIconos = JSON.stringify(pestanas('#page-busqueda .pjf-tab')) === JSON.stringify(pestanas('#page-pjf .pjf-tab'));

                // Búsqueda: una consulta como la del PJF.
                cambiarTabTSJ('busqueda');
                const select = document.getElementById('tsj-juzgado');
                r.juzgadosCargados = select.options.length > 10;
                const buscador = document.getElementById('tsj-juzgado-search');
                buscador.value = 'familiar';
                buscador.dispatchEvent(new Event('input'));
                const opcionesVisibles = [...select.options].filter(o => o.value && o.style.display !== 'none');
                r.filtraJuzgados = opcionesVisibles.length > 0 &&
                    opcionesVisibles.every(o => /familiar/i.test(o.textContent));
                const juzgado = opcionesVisibles[0].value;
                select.value = juzgado;
                document.getElementById('tsj-valor').value = '612/2026';
                r.botonesPie = [...document.querySelectorAll('#tsj-tab-busqueda .card-footer')[0].querySelectorAll('button')]
                    .map(b => b.textContent.trim());
                ejecutarBusquedaTSJ();
                r.abreEstrados = abiertas.length === 1 && /tsjqroo\.gob\.mx\/estrados\/.*findexp=612%2F2026/.test(abiertas[0]);
                const antes = (await obtenerExpedientes()).filter(e => e.numero === '612/2026').length;
                await ejecutarBusquedaTSJyGuardar();
                await ejecutarBusquedaTSJyGuardar();   // la segunda no lo repite
                const guardados = (await obtenerExpedientes()).filter(e => e.numero === '612/2026');
                r.guardaUnaVez = antes === 0 && guardados.length === 1 &&
                    guardados[0].institucion === 'TSJ' && guardados[0].juzgado === juzgado;
                limpiarFormularioTSJ();
                r.limpia = select.value === '' && document.getElementById('tsj-valor').value === '' && buscador.value === '';
                document.querySelector('input[name="tsj-tipo-busqueda"][value="nombre"]').click();
                r.placeholderNombre = /Juan/.test(document.getElementById('tsj-valor').placeholder);
                limpiarFormularioTSJ();

                // Expedientes TSJ: la lista de "Mis Expedientes Federales", con los del TSJ.
                document.querySelector('#page-busqueda .pjf-tab[data-tsj-tab="expedientes"]').click();
                await pausa(300);
                r.pestanaExpedientes = document.getElementById('tsj-tab-expedientes').classList.contains('active');
                const titulos = (sel) => [...document.querySelectorAll(sel)].map(h => h.textContent.trim());
                const enLista = titulos('#lista-expedientes-tsj .expediente-titulo');
                r.soloTSJ = enLista.includes('8/2026') && enLista.includes('612/2026') && !enLista.includes('9/2026');
                r.conEstrados = !!document.querySelector('#lista-expedientes-tsj .expediente-card[data-id="' +
                    guardados[0].id + '"] button[onclick^="abrirEstradosExpediente"]');
                r.contador = document.getElementById('count-expedientes-tsj').textContent;

                const buscar = document.getElementById('buscar-expediente-tsj');
                buscar.value = '612/2026';
                await filtrarExpedientesTSJ();
                r.filtra = titulos('#lista-expedientes-tsj .expediente-titulo');
                buscar.value = '';
                await filtrarExpedientesTSJ();

                cambiarVistaExpedientesTSJ('table');
                r.vistaTabla = visible(document.getElementById('tabla-expedientes-tsj')) &&
                    !visible(document.getElementById('lista-expedientes-tsj')) &&
                    document.querySelectorAll('#tabla-expedientes-body-tsj tr').length === enLista.length;
                cambiarVistaExpedientesTSJ('cards');

                // Selección masiva: abre los estrados de los elegidos.
                toggleModoSeleccionTSJ();
                await pausa(200);
                r.barraSeleccion = visible(document.getElementById('bulk-actions-tsj'));
                r.casillas = document.querySelectorAll('#lista-expedientes-tsj .pjf-check').length === enLista.length;
                const casilla = document.querySelector(`#lista-expedientes-tsj .pjf-check[data-exp-id="${guardados[0].id}"]`);
                casilla.click();
                r.contadorSeleccion = document.getElementById('count-tsj-seleccionados').textContent;
                abiertas.length = 0;
                await abrirExpedientesTSJSeleccionados();
                await pausa(100);
                r.abreSeleccionados = abiertas.length === 1 && /findexp=612%2F2026/.test(abiertas[0]);
                toggleModoSeleccionTSJ();
                await pausa(200);
                r.seleccionCerrada = !visible(document.getElementById('bulk-actions-tsj')) &&
                    document.querySelectorAll('#lista-expedientes-tsj .pjf-check').length === 0;

                // Archivo del TSJ.
                await archivarExpedienteDB(guardados[0].id, true, 'concluido');
                await cargarExpedientes();
                await pausa(200);
                r.salioDeLaLista = !titulos('#lista-expedientes-tsj .expediente-titulo').includes('612/2026');
                r.badgeArchivo = document.getElementById('count-archivo-badge-tsj').style.display !== 'none';
                abrirArchivoTSJ();
                await pausa(200);
                r.archivoTSJ = titulos('#lista-archivo-tsj .expediente-titulo').includes('612/2026') &&
                    !visible(document.getElementById('lista-expedientes-tsj'));
                cerrarArchivoTSJ();
                r.archivoCerrado = visible(document.getElementById('lista-expedientes-tsj')) &&
                    !visible(document.getElementById('archivo-section-tsj'));
                await eliminarExpedienteCore(guardados[0].id, true);
                cambiarTabTSJ('busqueda');
            } finally {
                window.open = openOriginal;
                estadoPremium.activo = premiumAntes;
            }
            return r;
        });
        igual('tribunales TSJ: tres pestañas como el PJF', tsj.pestanasTSJ,
            ['🔍 Búsqueda', '📁 Expedientes TSJ', '🤖 Análisis IA']);
        igual('tribunales TSJ: con los mismos iconos y orden que las del PJF', tsj.mismosIconos, true);
        igual('tribunales TSJ: la consulta trae el catálogo de juzgados', tsj.juzgadosCargados, true);
        igual('tribunales TSJ: y se filtra escribiendo', tsj.filtraJuzgados, true);
        igual('tribunales TSJ: los botones de la consulta son los del PJF', tsj.botonesPie,
            ['🗑️ Limpiar', '📁 Buscar y Guardar Expediente', '🔍 Buscar en TSJ']);
        igual('tribunales TSJ: "Buscar en TSJ" abre los estrados', tsj.abreEstrados, true);
        igual('tribunales TSJ: "Buscar y Guardar" lo guarda una sola vez', tsj.guardaUnaVez, true);
        igual('tribunales TSJ: "Limpiar" vacía la consulta', tsj.limpia, true);
        igual('tribunales TSJ: buscar por nombre cambia la pista', tsj.placeholderNombre, true);
        igual('tribunales TSJ: la pestaña Expedientes se abre', tsj.pestanaExpedientes, true);
        igual('tribunales TSJ: con los del TSJ y sin los federales', tsj.soloTSJ, true);
        igual('tribunales TSJ: cada tarjeta abre sus estrados', tsj.conEstrados, true);
        verificar('tribunales TSJ: cuenta los expedientes', /^\d+ expedientes?$/.test(tsj.contador), tsj.contador);
        igual('tribunales TSJ: el buscador filtra la lista', tsj.filtra, ['612/2026']);
        igual('tribunales TSJ: la vista de tabla', tsj.vistaTabla, true);
        igual('tribunales TSJ: la selección masiva muestra su barra', tsj.barraSeleccion, true);
        igual('tribunales TSJ: y una casilla por expediente', tsj.casillas, true);
        igual('tribunales TSJ: cuenta los elegidos', tsj.contadorSeleccion, '1 seleccionado');
        igual('tribunales TSJ: y abre los estrados de los elegidos', tsj.abreSeleccionados, true);
        igual('tribunales TSJ: cancelar la selección quita las casillas', tsj.seleccionCerrada, true);
        igual('tribunales TSJ: archivar lo saca de la lista', tsj.salioDeLaLista, true);
        igual('tribunales TSJ: y lo cuenta en el botón del archivo', tsj.badgeArchivo, true);
        igual('tribunales TSJ: el archivo del TSJ lo muestra', tsj.archivoTSJ, true);
        igual('tribunales TSJ: y volver regresa a la lista', tsj.archivoCerrado, true);

        // ---- Tarjetas: las acciones caben, el anuncio va al pie y el encabezado respira en el celular ----
        const ajustes = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            const r = {};
            const premiumAntes = estadoPremium.activo;
            estadoPremium.activo = true;
            const id = await crearExpedienteCore({ numero: '733/2026', institucion: 'TSJ',
                juzgado: 'JUZGADO PRIMERO FAMILIAR ORAL CANCUN', comentario: 'Prueba de acciones' });
            try {
                navegarA('busqueda');
                cambiarTabTSJ('expedientes');
                await pausa(300);
                const tarjeta = () => document.querySelector(`#lista-expedientes-tsj .expediente-card[data-id="${id}"]`);
                const caja = tarjeta().getBoundingClientRect();
                const botones = [...tarjeta().querySelectorAll('.expediente-actions > .btn, .expediente-actions > .acciones-mas > .btn')];
                r.nadaSeSale = botones.length > 0 && botones.every(b => {
                    const c = b.getBoundingClientRect();
                    return c.right <= caja.right + 0.5 && c.left >= caja.left - 0.5;
                });
                const fecha = tarjeta().querySelector('.expediente-fecha');
                r.fechaUnaLinea = fecha.getBoundingClientRect().height < 24;

                // El menú "⋯": cerrado no se ve; abierto muestra las cuatro acciones.
                const menu = tarjeta().querySelector('.acciones-mas');
                const boton = menu.querySelector(':scope > button');
                const abierto = () => menu.classList.contains('abierto');
                const lista = menu.querySelector('.acciones-mas-lista');
                r.cerradoOculto = lista.getBoundingClientRect().height === 0;
                boton.click();
                await pausa(100);
                r.abierto = abierto() && lista.getBoundingClientRect().height > 0 &&
                    boton.getAttribute('aria-expanded') === 'true';
                r.opciones = [...lista.querySelectorAll('button')].map(b => b.textContent.trim());
                r.noAbreDetalle = !document.getElementById('modal-overlay').classList.contains('active');
                document.body.click();
                await pausa(50);
                r.cierraFuera = !abierto();
                boton.click();
                await pausa(50);
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                r.cierraEsc = !abierto();
                // Elegir una opción la ejecuta y cierra el menú.
                boton.click();
                await pausa(50);
                [...lista.querySelectorAll('button')].find(b => /Historial/.test(b.textContent)).click();
                await pausa(300);
                r.historialAbre = document.getElementById('modal-overlay').classList.contains('active');
                r.cierraAlElegir = !abierto();
                cerrarModal();

                // El anuncio del TSJ va después del contenido.
                const pagina = document.getElementById('page-busqueda');
                const anuncio = document.getElementById('ad-banner-busqueda');
                const ultimaPestana = document.getElementById('tsj-tab-ia');
                r.anuncioAlPie = anuncio.parentElement === pagina &&
                    !!(ultimaPestana.compareDocumentPosition(anuncio) & Node.DOCUMENT_POSITION_FOLLOWING);
            } finally {
                await eliminarExpedienteCore(id, true);
                estadoPremium.activo = premiumAntes;
                cambiarTabTSJ('busqueda');
            }
            return r;
        });
        igual('tarjetas: ningún botón se sale de la tarjeta', ajustes.nadaSeSale, true);
        igual('tarjetas: la fecha cabe en una línea', ajustes.fechaUnaLinea, true);
        igual('tarjetas: el menú ⋯ empieza cerrado', ajustes.cerradoOculto, true);
        igual('tarjetas: y se abre al tocarlo', ajustes.abierto, true);
        igual('tarjetas: con las acciones de uso ocasional', ajustes.opciones,
            ['📜 Historial', '📅 Timeline', '📦 Archivar', '🗑️ Eliminar']);
        igual('tarjetas: abrir el menú no abre el detalle del expediente', ajustes.noAbreDetalle, true);
        igual('tarjetas: el menú se cierra al tocar fuera', ajustes.cierraFuera, true);
        igual('tarjetas: y con Esc', ajustes.cierraEsc, true);
        igual('tarjetas: elegir "Historial" lo abre', ajustes.historialAbre, true);
        igual('tarjetas: y cierra el menú', ajustes.cierraAlElegir, true);
        igual('tribunales TSJ: el anuncio va al pie', ajustes.anuncioAlPie, true);

        // En el celular, el título de la lista no se aplasta con los botones.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        const movil = await page.evaluate(async () => {
            navegarA('busqueda');
            cambiarTabTSJ('expedientes');
            await new Promise(res => setTimeout(res, 300));
            const r = {};
            for (const [nombre, sel] of [['TSJ', '#tsj-tab-expedientes'], ['PJF', '#pjf-tab-expedientes']]) {
                if (nombre === 'PJF') { navegarA('pjf'); cambiarTabPJF('expedientes'); await new Promise(res => setTimeout(res, 300)); }
                const h3 = document.querySelector(`${sel} .card-header h3`);
                const botones = document.querySelector(`${sel} .card-header .header-buttons`);
                const t = h3.getBoundingClientRect(), b = botones.getBoundingClientRect();
                const cabecera = document.querySelector(`${sel} .card-header`).getBoundingClientRect();
                const ultimoBoton = Math.max(...[...botones.querySelectorAll('.btn')]
                    .map(x => x.getBoundingClientRect().right));
                const buscador = document.querySelector(`${sel} .filters-section .search-box`).getBoundingClientRect();
                r[nombre] = { unaLinea: t.height < 30, arribaDeLosBotones: t.bottom <= b.top + 1,
                    dentro: ultimoBoton <= cabecera.right + 0.5,
                    buscadorNormal: buscador.height < 60 };
            }
            navegarA('busqueda');
            cambiarTabTSJ('busqueda');
            return r;
        });
        await page.setViewportSize({ width: 1400, height: 900 });
        for (const z of ['TSJ', 'PJF']) {
            igual(`celular ${z}: el título de la lista cabe en una línea`, movil[z].unaLinea, true);
            igual(`celular ${z}: y queda arriba de los botones`, movil[z].arribaDeLosBotones, true);
            igual(`celular ${z}: sin salirse de la tarjeta`, movil[z].dentro, true);
            igual(`celular ${z}: el buscador de la lista tiene su altura normal`, movil[z].buscadorNormal, true);
        }

        // ---- Calculadora laboral ----
        const lab = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            const r = {};
            const botonMenu = document.querySelector('.main-nav .nav-btn[data-page="laboral"], nav .nav-btn[data-page="laboral"]');
            r.enMenu = !!botonMenu;
            botonMenu.click();
            await pausa(300);
            r.pagina = document.getElementById('page-laboral').classList.contains('active');
            r.bajaHoy = !!document.getElementById('lab-baja').value;
            const fijar = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
            fijar('lab-ingreso', '2020-01-15');
            fijar('lab-baja', '2026-09-26');
            fijar('lab-salario', '15000');
            await pausa(100);
            const esperado = CalculadoraLaboral.calcular({ supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-15',
                fechaBaja: '2026-09-26', salario: 15000, periodo: 'mensual', calcularISR: true });
            r.totalPintado = document.getElementById('lab-total-bruto')?.textContent;
            r.totalEsperado = CalculadoraLaboral.dinero(esperado.totales.bruto);
            r.filas = document.querySelectorAll('#lab-resultados .lab-tabla tbody tr').length;
            r.ayudaVacaciones = document.getElementById('lab-vac-pendientes-ayuda').textContent;
            const visible = (id) => document.getElementById(id).style.display !== 'none';
            r.camposDespido = [visible('lab-grupo-veinte'), visible('lab-grupo-juicio'), visible('lab-grupo-incapacidad')];
            const bases = () => document.querySelector('#lab-resultados .lab-bases')?.textContent.replace(/\s+/g, ' ') || '';
            const formulas = () => [...document.querySelectorAll('#lab-resultados .lab-formula')].map(f => f.textContent);
            r.basesDespido = bases();
            r.primaDespido = formulas().find(t => /^12 días/.test(t)) || '';
            r.ayudaZona = document.getElementById('lab-zona').parentElement.querySelector('.form-help')?.textContent || '';
            const sel = document.getElementById('lab-supuesto');
            sel.value = 'renuncia'; sel.dispatchEvent(new Event('change'));
            await pausa(50);
            r.camposRenuncia = [visible('lab-grupo-veinte'), visible('lab-grupo-juicio'), visible('lab-grupo-incapacidad')];
            r.basesRenuncia = bases();
            r.formulasRenuncia = formulas();
            sel.value = 'incapacidadParcial'; sel.dispatchEvent(new Event('change'));
            await pausa(50);
            r.campoPorcentaje = visible('lab-grupo-incapacidad');
            sel.value = 'despidoInjustificado'; sel.dispatchEvent(new Event('change'));
            document.getElementById('lab-veinte').click();
            await pausa(50);
            r.conVeinte = [...document.querySelectorAll('#lab-resultados .lab-tabla td strong')].some(s => /20 días por año/.test(s.textContent));
            document.getElementById('lab-veinte').click();

            // Guardar como nota ligada a nada.
            const antes = (await obtenerNotas()).length;
            await guardarCalculoComoNota();
            const notas = await obtenerNotas();
            const nueva = notas.find(n => /Despido injustificado/.test(n.titulo) && /TOTAL BRUTO/.test(n.contenido));
            r.nota = notas.length === antes + 1 && !!nueva;
            if (nueva) await eliminarNotaCore(nueva.id);
            return r;
        });
        igual('laboral: está en el menú', lab.enMenu, true);
        igual('laboral: abre su página', lab.pagina, true);
        igual('laboral: la fecha de terminación empieza en hoy', lab.bajaHoy, true);
        igual('laboral: el total pintado es el del motor', lab.totalPintado, lab.totalEsperado);
        verificar('laboral: desglosa los conceptos', lab.filas >= 5, String(lab.filas));
        verificar('laboral: recuerda las vacaciones del último año cumplido',
            /año 6 de servicio, son 22 días/.test(lab.ayudaVacaciones), lab.ayudaVacaciones);
        igual('laboral: el despido muestra 20 días opcionales y juicio', lab.camposDespido, [true, true, false]);
        igual('laboral: la renuncia los oculta', lab.camposRenuncia, [false, false, false]);
        igual('laboral: la renuncia no enseña salario integrado', /integrado/i.test(lab.basesRenuncia), false);
        verificar('laboral: enseña el salario base del finiquito', /Salario base \(finiquito\): \$500\.00/.test(lab.basesRenuncia), lab.basesRenuncia);
        verificar('laboral: y cada fórmula del finiquito va con el salario base',
            lab.formulasRenuncia.length >= 3 && lab.formulasRenuncia.every(f => /\(salario base\)/.test(f)), JSON.stringify(lab.formulasRenuncia));
        verificar('laboral: el despido sí enseña el integrado, para las indemnizaciones',
            /Salario integrado \(indemnizaciones\): \$528\.\d\d/.test(lab.basesDespido), lab.basesDespido);
        verificar('laboral: y el salario mínimo de la zona con su tope',
            /Salario mínimo \(zona general\): \$315\.04, tope de 2: \$630\.08/.test(lab.basesDespido), lab.basesDespido);
        verificar('laboral: la prima de antigüedad dice su tope de la zona',
            /no rebasa el tope de 2 veces el salario mínimo de la zona general: \$630\.08/.test(lab.primaDespido), lab.primaDespido);
        verificar('laboral: la zona explica qué topes fija', /tope de 2 salarios mínimos/.test(lab.ayudaZona), lab.ayudaZona);
        igual('laboral: la incapacidad parcial pide el porcentaje', lab.campoPorcentaje, true);
        igual('laboral: sumar los 20 días los agrega al desglose', lab.conVeinte, true);
        igual('laboral: guardar el cálculo crea una nota', lab.nota, true);

        igual('la página no lanza errores de JavaScript', erroresPagina, []);

        // ---- El calendario y el asistente, con el reloj en Cancún ----
        await probarCalendarioEnCancun(navegador);

        // ---- Sin internet ----
        await probarSinConexion(navegador);

        // ---- Alta con IA, consulta en su tribunal y anuncios ----
        await probarAltaConIAyConsulta(navegador);

        // ---- Cuentas compartidas (solo desde el asistente) ----
        await probarCuentasCompartidas(navegador);

        // ---- Estadísticas del despacho ----
        await probarEstadisticas(navegador);

        // ---- Seguimiento semanal (indice_asuntos.json) ----
        await probarSeguimientoSemanal(navegador);

        // ---- Estrados laborales (TCA y Juntas) ----
        await probarEstradosLaborales(navegador);

        // ---- Estudio de viabilidad de marca (IMPI) ----
        await probarViabilidadMarca(navegador);

        // ---- Límites del plan gratuito en el IMPI ----
        await probarCuotasIMPI(navegador);

        // ---- Recorrido guiado y páginas públicas ----
        await probarRecorridoGuiado(navegador);
        await probarInstalacion(navegador);
        await probarAnaliticaYRecomendar(navegador);
        await probarSitioPublico(navegador);

    } finally {
        await navegador.close();
        servidor.close();
    }

    console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas\n`);
    if (fallidas > 0) {
        console.log('FALLOS:');
        fallos.forEach(f => console.log('  ✗ ' + f));
        process.exit(1);
    }
    console.log('✓ La interfaz responde: template, pendientes y carpetas se comportan en un navegador de verdad.');
}

main().catch(e => { console.error(e); process.exit(1); });
