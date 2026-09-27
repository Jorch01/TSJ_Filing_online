/**
 * Service worker: que la app abra sin internet.
 *
 * Con conexión, todo se pide a la red como siempre (así cada publicación
 * llega sin pasos extra) y cada respuesta se guarda. Sin conexión —o si la
 * red tarda más de unos segundos, como pasa en los juzgados— se sirve la
 * copia guardada. Los datos del usuario ya viven en el navegador
 * (IndexedDB), no hay que guardarlos aquí.
 *
 * Lo que no es de la app —sincronización, IA, tribunales, IMPI— pasa directo
 * a la red: sin conexión falla como siempre y la app lo avisa.
 */
const CACHE = 'tsj-app-v1';
const CACHE_CDN = 'tsj-cdn-v1';
// Pasado este tiempo sin respuesta de la red se usa la copia guardada.
const ESPERA_RED_MS = 4000;

// Si se agrega un script o estilo a index.html, va también aquí
// (test_offline.js lo comprueba).
const ARCHIVOS_APP = [
    './',
    'index.html',
    'manifest.json',
    'css/styles.css',
    'js/juzgados.js',
    'js/database.js',
    'js/acciones-core.js',
    'js/pjf-search.js',
    'js/impi-search.js',
    'js/app.js',
    'js/sync.js',
    'js/timeline.js',
    'js/gcal-sync.js',
    'js/command-palette.js',
    'js/voice-assistant.js',
    'js/calculadora-laboral.js',
    'data/pjf_catalogos_completos.json'
];

// Librerías de CDN que la app necesita para arrancar. Tesseract (OCR) no se
// guarda por adelantado: pesa varios MB y sin internet no hay OCR que hacer.
const CDN_ESENCIALES = [
    'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js'
];

self.addEventListener('install', (event) => {
    // Sin estrategia de versiones que esperar: se activa en cuanto instala.
    self.skipWaiting();
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // cache: 'reload' evita guardar una copia vieja del caché HTTP.
        await cache.addAll(ARCHIVOS_APP.map(u => new Request(u, { cache: 'reload' })));
        const cdn = await caches.open(CACHE_CDN);
        await Promise.all(CDN_ESENCIALES.map(u =>
            cdn.match(u).then(ya => ya || cdn.add(u)).catch(() => { /* sin CDN no se detiene la instalación */ })));
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const nombres = await caches.keys();
        await Promise.all(nombres
            .filter(n => n.startsWith('tsj-') && n !== CACHE && n !== CACHE_CDN)
            .map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Librerías del CDN: primero la copia guardada.
    if (url.hostname === 'cdn.jsdelivr.net') {
        event.respondWith((async () => {
            const cdn = await caches.open(CACHE_CDN);
            const guardada = await cdn.match(req);
            if (guardada) return guardada;
            const resp = await fetch(req);
            if (resp.ok && CDN_ESENCIALES.includes(req.url)) cdn.put(req, resp.clone());
            return resp;
        })());
        return;
    }

    // Solo lo de la app misma; el resto (APIs) va directo a la red.
    if (url.origin !== self.location.origin) return;
    const base = new URL('./', self.location).pathname;
    if (!url.pathname.startsWith(base)) return;

    // Abrir la app (con o sin #expedientes/12 o ?algo) es abrir index.html.
    const esPagina = req.mode === 'navigate' &&
        (url.pathname === base || url.pathname === base + 'index.html');
    const clave = esPagina ? 'index.html' : req;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const deLaRed = fetch(req).then(resp => {
            if (resp.ok && resp.type === 'basic') cache.put(clave, resp.clone());
            return resp;
        });
        const guardada = () => cache.match(clave, { ignoreSearch: true });
        try {
            return await Promise.race([
                deLaRed,
                new Promise((_, no) => setTimeout(() => no(new Error('lenta')), ESPERA_RED_MS))
            ]);
        } catch (e) {
            // Sin red o red lenta: la copia guardada; si no hay, se espera a la red.
            const copia = await guardada();
            if (copia) {
                deLaRed.catch(() => {});   // que termine y actualice la copia
                return copia;
            }
            return deLaRed;
        }
    })());
});
