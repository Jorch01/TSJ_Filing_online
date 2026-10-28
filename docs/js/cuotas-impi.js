/**
 * Límites del plan gratuito en las herramientas del IMPI.
 *
 *   - Estudio de viabilidad de marca: 2 en total.
 *   - Búsquedas en MARCia, Marcanet, SIGA y "buscar en las 3": 5 al mes.
 *   - Con Premium, sin límite.
 *
 * La cuenta que vale es la del proxy del IMPI (docs/proxy/impi-proxy-worker.js,
 * sección CUOTAS): ahí se reconoce el equipo por la IP y una huella que es la
 * misma en Chrome, Safari o Firefox, así que abrir otro navegador o borrar los
 * datos no la reinicia, y sin el pase que da el proxy las búsquedas no salen.
 *
 * Aquí se lleva además una cuenta local, guardada en tres lugares (almacén
 * del navegador, cookie y una base propia que "eliminar todos los datos" no
 * toca), y manda la mayor. Sirve cuando el proxy todavía no tiene activados
 * los límites y para avisar sin esperar a la red.
 *
 * Dos partes: el motor (puro, se prueba en Node) y lo del navegador.
 */
(function (global) {
    'use strict';

    // ==================== MOTOR ====================

    const LIMITES = {
        viabilidad: { limite: 2, periodo: 'siempre', nombre: 'estudios de viabilidad' },
        busqueda: { limite: 5, periodo: 'mes', nombre: 'búsquedas en el IMPI este mes' }
    };

    function mesDe(ahora) {
        const d = new Date(ahora);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    /** Lo usado de un tipo en el periodo de `ahora`, según una copia guardada. */
    function usadosEn(copia, tipo, ahora) {
        const c = copia && copia[tipo];
        if (!c) return 0;
        if (LIMITES[tipo].periodo === 'mes') return c.mes === mesDe(ahora) ? (parseInt(c.n, 10) || 0) : 0;
        return parseInt(c.n, 10) || 0;
    }

    /** Junta varias copias (almacén, cookie, base): manda la mayor de cada tipo. */
    function combinar(copias, ahora) {
        const r = {};
        for (const tipo of Object.keys(LIMITES)) {
            const n = Math.max(0, ...copias.map(c => usadosEn(c, tipo, ahora)));
            r[tipo] = LIMITES[tipo].periodo === 'mes' ? { mes: mesDe(ahora), n } : { n };
        }
        return r;
    }

    function conUsados(copia, tipo, n, ahora) {
        const r = JSON.parse(JSON.stringify(copia || {}));
        r[tipo] = LIMITES[tipo].periodo === 'mes' ? { mes: mesDe(ahora), n } : { n };
        return r;
    }

    /** Cuánto queda de cada tipo. */
    function estado(copia, ahora) {
        const r = {};
        for (const tipo of Object.keys(LIMITES)) {
            const usados = usadosEn(copia, tipo, ahora);
            r[tipo] = { usados, limite: LIMITES[tipo].limite, restantes: Math.max(0, LIMITES[tipo].limite - usados) };
        }
        return r;
    }

    const Motor = { LIMITES, mesDe, usadosEn, combinar, conUsados, estado };
    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
    if (typeof document === 'undefined') return;

    // ==================== NAVEGADOR ====================

    const CLAVE = 'tsj_cuotas_impi';
    const COOKIE = 'tsj_cq';
    let pase = null;
    let huellaCache = null;

    // ---- Huella del equipo ----
    async function sha256(texto) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function rendererWebGL() {
        try {
            const gl = document.createElement('canvas').getContext('webgl');
            const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
        } catch (e) { return ''; }
    }

    function dibujoDePrueba() {
        try {
            const c = document.createElement('canvas');
            c.width = 220; c.height = 30;
            const x = c.getContext('2d');
            x.textBaseline = 'top'; x.font = '16px Arial'; x.fillStyle = '#f60'; x.fillRect(0, 0, 100, 20);
            x.fillStyle = '#069'; x.fillText('TSJ Filing · IMPI ñ 2026', 2, 4);
            return c.toDataURL();
        } catch (e) { return ''; }
    }

    /**
     * Amplia: lo que es igual en todos los navegadores de un mismo equipo.
     * Fina: además lo propio del navegador. Se mandan solo sus resúmenes.
     */
    async function huella() {
        if (huellaCache) return huellaCache;
        const s = global.screen || {};
        const lados = [s.width || 0, s.height || 0].sort((a, b) => b - a).join('x');
        let zona = '';
        try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* sin Intl */ }
        const plataforma = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'apple'
            : /Win/.test(navigator.platform || '') ? 'windows' : /Android/.test(navigator.userAgent) ? 'android' : /Linux/.test(navigator.platform || '') ? 'linux' : 'otra';
        const amplia = [lados, s.colorDepth || 0, zona, navigator.hardwareConcurrency || 0, plataforma,
            (navigator.maxTouchPoints || 0) > 0 ? 't' : 'nt', String(navigator.language || '').slice(0, 2)].join('|');
        const fina = [amplia, navigator.userAgent, global.devicePixelRatio || 1, navigator.deviceMemory || 0, rendererWebGL(), await sha256(dibujoDePrueba())].join('|');
        huellaCache = { amplia: await sha256(amplia), fina: await sha256(fina) };
        return huellaCache;
    }

    // ---- Cuenta local en tres lugares ----
    function leerAlmacen() { try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch (e) { return {}; } }
    function leerCookie() {
        try {
            const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
            return m ? JSON.parse(decodeURIComponent(m[1])) : {};
        } catch (e) { return {}; }
    }
    function baseCuotas() {
        return new Promise((resolve) => {
            try {
                const req = indexedDB.open('TSJCuotas', 1);
                req.onupgradeneeded = () => req.result.createObjectStore('c');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    async function leerBase() {
        const db = await baseCuotas();
        if (!db) return {};
        return new Promise((resolve) => {
            try {
                const r = db.transaction('c').objectStore('c').get(CLAVE);
                r.onsuccess = () => resolve(r.result || {});
                r.onerror = () => resolve({});
            } catch (e) { resolve({}); }
        });
    }
    async function guardar(copia) {
        try { localStorage.setItem(CLAVE, JSON.stringify(copia)); } catch (e) { /* sin almacenamiento */ }
        try { document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify(copia)) + '; max-age=' + 400 * 86400 + '; path=/; SameSite=Lax'; } catch (e) { /* sin cookies */ }
        const db = await baseCuotas();
        if (db) { try { db.transaction('c', 'readwrite').objectStore('c').put(copia, CLAVE); } catch (e) { /* sin base */ } }
    }
    async function local() {
        return combinar([leerAlmacen(), leerCookie(), await leerBase()], Date.now());
    }

    // ---- Premium y servidor ----
    function premium() {
        return typeof estadoPremium !== 'undefined' && !!(estadoPremium && estadoPremium.activo);
    }

    async function pedirAlServidor(tipo) {
        const url = typeof getProxyUrl === 'function' ? getProxyUrl() : '';
        if (!url) return null;
        const control = typeof AbortController === 'function' ? new AbortController() : null;
        const reloj = control ? setTimeout(() => control.abort(), 8000) : null;
        try {
            const cuerpo = {
                tipo, huella: await huella(),
                dispositivo: typeof obtenerDeviceId === 'function' ? obtenerDeviceId() : (typeof obtenerClientId === 'function' ? obtenerClientId() : ''),
                licencia: premium() ? { codigo: estadoPremium.codigo, dispositivoId: estadoPremium.dispositivoId } : null
            };
            const r = await fetch(url + '/cuota', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpo), signal: control ? control.signal : undefined
            });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            return null;
        } finally {
            if (reloj) clearTimeout(reloj);
        }
    }

    /**
     * ¿Se puede hacer una búsqueda (o un estudio) más? Si sí, deja listo el
     * pase para el proxy y la cuenta al día. Si no, avisa con la ventana de
     * Premium (salvo `silencioso`). tipo: 'busqueda', 'viabilidad' o
     * 'vigilancia' (revisiones automáticas, que no gastan búsquedas).
     */
    async function autorizar(tipo, opciones) {
        const silencioso = !!(opciones && opciones.silencioso);
        if (tipo === 'vigilancia' || premium()) {
            const r = await pedirAlServidor(tipo);
            if (r && r.pase) pase = r.pase;
            if (r && r.servidor && !r.permitido) { if (!silencioso && tipo !== 'vigilancia') avisar(tipo); return false; }
            return true;
        }
        const ahora = Date.now();
        let copia = await local();
        const { limite } = LIMITES[tipo];
        if (usadosEn(copia, tipo, ahora) >= limite) {
            if (!silencioso) avisar(tipo);
            return false;
        }
        const r = await pedirAlServidor(tipo);
        if (r && r.servidor) {
            const usados = Math.max(usadosEn(copia, tipo, ahora), parseInt(r.usados, 10) || 0);
            await guardar(conUsados(copia, tipo, usados, ahora));
            if (!r.permitido) { if (!silencioso) avisar(tipo); return false; }
            pase = r.pase || null;
            refrescarPantalla();
            return true;
        }
        // El proxy no lleva cuenta (o no respondió): cuenta solo la local.
        await guardar(conUsados(copia, tipo, usadosEn(copia, tipo, ahora) + 1, ahora));
        refrescarPantalla();
        return true;
    }

    /** Cuándo vence el pase que se tiene (ms), o null si no hay. Su vigencia viene a la vista en él. */
    function vencePase() {
        if (!pase || typeof pase !== 'string' || pase.indexOf('.') < 0) return null;
        try {
            const datos = pase.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
            const json = JSON.parse(decodeURIComponent(escape(atob(datos))));
            return typeof json.e === 'number' ? json.e : null;
        } catch (e) { return null; }
    }

    /** El proxy rechazó por falta de pase o de cupo (respuesta 402). */
    function agotado() {
        avisar('busqueda');
    }

    function avisar(tipo) {
        const t = LIMITES[tipo] || LIMITES.busqueda;
        const $ = (id) => document.getElementById(id);
        if (!$('modal-titulo')) return;
        const precio = typeof textoPrecioDesde === 'function' ? textoPrecioDesde() : '';
        $('modal-titulo').textContent = '⚠️ Límite gratuito alcanzado';
        $('modal-body').innerHTML =
            '<div class="limit-warning">' +
                '<div class="limit-warning-icon">🔒</div>' +
                '<h3>' + (tipo === 'viabilidad' ? 'Ya usaste tus 2 estudios de viabilidad gratuitos' : 'Ya usaste tus 5 búsquedas del IMPI de este mes') + '</h3>' +
                '<p>' + (tipo === 'viabilidad'
                    ? 'El estudio de viabilidad de marca incluye 2 estudios sin costo. Para hacer más, activa Premium.'
                    : 'El plan gratuito incluye 5 búsquedas al mes en MARCia, Marcanet y SIGA. El mes próximo vuelves a tener 5; con Premium no hay límite.') + '</p>' +
                (precio ? '<p>Premium ' + precio + '.</p>' : '') +
                '<p class="text-muted" style="font-size:0.8rem">El límite se cuenta por equipo: cambiar de navegador o borrar los datos no lo reinicia.</p>' +
            '</div>';
        $('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>' +
            '<button class="btn btn-success" onclick="cerrarModal(); navegarA(\'config\'); setTimeout(() => document.getElementById(\'premium-section\')?.scrollIntoView({behavior: \'smooth\'}), 300);">⭐ Ver planes Premium</button>';
        $('modal-overlay').classList.add('active');
    }

    /** Para la sección de Premium: cuánto lleva cada límite. */
    async function resumen() {
        return estado(await local(), Date.now());
    }

    function refrescarPantalla() {
        if (typeof actualizarLimitesIMPIEnPantalla === 'function') actualizarLimitesIMPIEnPantalla();
    }

    global.CUOTAS_IMPI = { ...Motor, autorizar, agotado, resumen, huella, pase: () => pase, vencePase, premium };
})(typeof window !== 'undefined' ? window : globalThis);
