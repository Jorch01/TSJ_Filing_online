/**
 * Estadísticas de uso anónimas (Google Analytics 4).
 *
 * Para qué: saber si el sitio atrae gente, cuántos instalan la app, terminan
 * el recorrido o usan la calculadora. Nada más.
 *
 * Privacidad, como regla y no como promesa:
 *  - Solo se mandan NOMBRES de eventos y categorías genéricas (la sección,
 *    el tipo de cálculo, la plataforma). Nunca números de expediente,
 *    nombres, juzgados, notas, importes ni textos de acuerdos:
 *    `limpiar()` descarta cualquier parámetro que no esté en la lista blanca.
 *  - Sin señales publicitarias ni personalización de anuncios.
 *  - Se desactiva desde Configuración (queda en este dispositivo).
 *
 * Mientras GA_ID esté vacío, todo esto no hace nada: ni carga el script de
 * Google ni envía eventos. Para activarlo basta poner aquí el ID de la
 * propiedad GA4 (formato G-XXXXXXXXXX).
 */
(function () {
    'use strict';

    const GA_ID = 'G-YHSKT7WH3Q';

    const CLAVE_DESACTIVADA = 'analitica_desactivada';
    // Los únicos parámetros que pueden salir, y sus valores permitidos.
    const PERMITIDOS = {
        seccion: /^[a-z_-]{1,30}$/,
        recorrido: /^[a-zA-Z]{1,30}$/,
        supuesto: /^[a-zA-Z]{1,40}$/,
        plataforma: /^[a-z-]{1,20}$/,
        modo: /^[a-z]{1,20}$/,
        respuesta: /^[a-z_]{1,20}$/,
        canal: /^[a-z_]{1,20}$/,
        origen: /^[a-z_]{1,30}$/,
        pagina: /^[a-z0-9_/-]{1,60}$/,
        cantidad: /^\d{1,4}$/,
        paso: /^\d{1,2}$/
    };

    function idConfigurado() {
        return (typeof window !== 'undefined' && window.TSJ_GA_ID) || GA_ID;
    }

    function desactivadaPorUsuario() {
        try { return localStorage.getItem(CLAVE_DESACTIVADA) === '1'; } catch (e) { return false; }
    }

    // En pruebas locales no se mide, salvo que la prueba lo pida (TSJ_GA_ID).
    function entornoLocal() {
        return !window.TSJ_GA_ID && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    }

    function activa() {
        return !!idConfigurado() && !desactivadaPorUsuario() && !entornoLocal() && location.protocol !== 'file:';
    }

    function limpiar(params) {
        const limpio = {};
        for (const [k, v] of Object.entries(params || {})) {
            const re = PERMITIDOS[k];
            if (re && re.test(String(v))) limpio[k] = typeof v === 'number' ? v : String(v);
        }
        return limpio;
    }

    let cargado = false;
    function cargar() {
        if (cargado || !activa()) return;
        cargado = true;
        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', idConfigurado(), {
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
            // La app cambia de sección sin cambiar de página: esas vistas las
            // manda medir('seccion_vista').
            send_page_view: !document.getElementById('page-inicio')
        });
        const s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(idConfigurado());
        document.head.appendChild(s);
    }

    /** Registra un evento. Sin ID, desactivada o en local: no hace nada. */
    function medir(evento, params) {
        if (!activa() || !/^[a-z_]{2,40}$/.test(evento)) return;
        cargar();
        window.gtag('event', evento, limpiar(params));
    }

    function desactivarAnalitica(desactivar) {
        try {
            if (desactivar) localStorage.setItem(CLAVE_DESACTIVADA, '1');
            else localStorage.removeItem(CLAVE_DESACTIVADA);
        } catch (e) { /* sin almacenamiento */ }
        // Deja de enviar de inmediato aunque el script ya esté cargado.
        if (idConfigurado()) window['ga-disable-' + idConfigurado()] = !!desactivar;
        if (!desactivar) cargar();
    }

    // ==================== LO QUE SE MIDE DE LA APP ====================
    // Se envuelven las funciones globales en vez de sembrar llamadas por todo
    // el código: todo lo que se mide está aquí, a la vista.

    function envolver(nombre, antes, despues) {
        const original = window[nombre];
        if (typeof original !== 'function' || original.__medida) return;
        const envuelta = function (...args) {
            try { antes && antes(...args); } catch (e) { /* medir nunca rompe la app */ }
            const r = original.apply(this, args);
            if (despues) Promise.resolve(r).then(v => { try { despues(v, ...args); } catch (e) {} }, () => {});
            return r;
        };
        envuelta.__medida = true;
        window[nombre] = envuelta;
    }

    // Altas de expedientes: una importación crea muchos de golpe, así que se
    // agrupan en un solo evento con la cantidad.
    let altasPendientes = 0;
    let temporizadorAltas = null;
    function contarAlta() {
        altasPendientes++;
        clearTimeout(temporizadorAltas);
        temporizadorAltas = setTimeout(() => {
            medir('expediente_creado', { cantidad: altasPendientes });
            altasPendientes = 0;
        }, 1500);
    }

    const calculosMedidos = new Set();

    function instrumentarApp() {
        const enApp = !!document.getElementById('page-inicio');
        if (enApp) {
            const instalada = typeof estaInstalada === 'function' && estaInstalada();
            medir('app_abierta', { modo: instalada ? 'instalada' : 'navegador' });
            envolver('navegarA', (pagina) => medir('seccion_vista', { seccion: pagina }));
            envolver('agregarExpediente', null, contarAlta);
            envolver('guardarResultadosIA', () => medir('ia_guardado', { origen: 'tsj' }));
            envolver('guardarResultadosIAPJF', () => medir('ia_guardado', { origen: 'pjf' }));
            envolver('analizarAcuerdoConIA', () => medir('ia_analisis', { origen: 'tsj' }));
            envolver('analizarAcuerdoConIAPJF', () => medir('ia_analisis', { origen: 'pjf' }));
            envolver('abrirBusquedaPopup', () => medir('estrados_abiertos'));
            envolver('ejecutarBusquedaPJF', () => medir('pjf_consulta'));
            envolver('guardarCalculoComoNota', () => medir('calculo_guardado'));
        }
        // La calculadora (en la app y en su página pública): un evento por tipo
        // de cálculo y visita, cuando ya hay un resultado.
        envolver('recalcularLaboral', null, (r) => {
            if (!r || !r.ok || calculosMedidos.has(r.supuesto.clave)) return;
            calculosMedidos.add(r.supuesto.clave);
            medir('calculo_laboral', { supuesto: r.supuesto.clave, origen: enApp ? 'app' : 'sitio' });
        });
        // Páginas públicas: qué botón lleva a la app.
        if (!enApp) {
            document.addEventListener('click', (e) => {
                const a = e.target.closest && e.target.closest('a[href^="/docs/"]');
                if (a) medir('cta_probar', { pagina: location.pathname.slice(0, 60) });
            });
        }
    }

    window.addEventListener('load', () => {
        cargar();
        // Después de que la app definió sus funciones.
        setTimeout(instrumentarApp, 0);
        const casilla = document.getElementById('config-analitica');
        if (casilla) casilla.checked = !desactivadaPorUsuario();
    });

    Object.assign(window, { medir, desactivarAnalitica, analiticaActiva: activa, _limpiarParametrosAnalitica: limpiar });
})();
