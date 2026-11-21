/**
 * Anuncio contextual de Empírica Legal Lab (el despacho del desarrollador).
 *
 * Una barra discreta, fija en la parte de abajo de la pantalla (a la izquierda
 * de los botones flotantes), que sale cada vez que se abre la app. Si se cierra,
 * no vuelve en esa visita. Nunca sale a quien tiene Premium ni a quien ocultó
 * los anuncios. Convive con el anuncio rotativo de arriba, que no se toca.
 *
 * Qué anuncio sale se decide AQUÍ, en el dispositivo:
 *   - ¿abogado o parte? Por cuántos expedientes activos hay (3 o más: abogado);
 *   - la materia que más se repite en sus juzgados (o PJF: amparo);
 *   - la sección donde está (IMPI: marcas; PJF: amparo; laboral).
 * Ningún dato de los expedientes sale del dispositivo. A Analytics solo va el
 * nombre del anuncio mostrado (p. ej. "parte_familiar"), con medir().
 *
 * Si algo falla, no se muestra nada: la app sigue igual.
 */
(function (raiz) {
    'use strict';

    const WHATSAPP = '529982570828';
    const SITIO = 'https://empirica.mx/';
    const MARCA = 'Empírica Legal Lab · despacho del desarrollador de esta app';
    const CLAVE_CERRADO = 'anuncio_ctx_cerrado';      // sessionStorage: solo esta visita
    const UMBRAL_ABOGADO = 3;                          // expedientes activos
    const RETRASO_MS = 4000;                           // no compite con el arranque
    const CLAVE_GRUPO = 'anuncio_ctx_grupo';          // localStorage: prueba A/B, fija por dispositivo

    function whatsapp(texto) { return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(texto); }

    function pagina(ruta, campana) {
        const [base, ancla] = ruta.split('#');
        return SITIO + base + '?utm_source=tsjfiling&utm_medium=anuncio_contextual&utm_campaign=' + campana + (ancla ? '#' + ancla : '');
    }

    const VARIANTES = {
        abogado_general: {
            texto: '¿Un asunto en Cancún fuera de tu materia o de tu agenda? Lo llevamos contigo como corresponsales.',
            llamada: 'Platicarlo por WhatsApp',
            enlace: () => whatsapp('Hola, soy abogado y vengo de TSJ Filing. Me interesa colaborar con ustedes como corresponsales en Cancún.')
        },
        // Prueba A/B (desde el 21 nov 2026): a quien aún no tiene expedientes —casi
        // siempre llega desde los estrados, que usan sobre todo litigantes— la mitad
        // ve esto en vez de parte_general. Mismo texto que abogado_general, otro
        // nombre para distinguirlo en Analytics.
        abogado_nuevo: {
            texto: '¿Un asunto en Cancún fuera de tu materia o de tu agenda? Lo llevamos contigo como corresponsales.',
            llamada: 'Platicarlo por WhatsApp',
            enlace: () => whatsapp('Hola, soy abogado y vengo de TSJ Filing. Me interesa colaborar con ustedes como corresponsales en Cancún.')
        },
        abogado_amparo: {
            texto: '¿Tu cliente necesita un amparo? Colaboramos contigo en amparo directo e indirecto.',
            llamada: 'Ver cómo trabajamos',
            enlace: () => pagina('landing-amparo-cancun.html', 'abogado_amparo')
        },
        abogado_marcas: {
            texto: '¿Tu cliente quiere registrar una marca? Revisa su viabilidad gratis antes de solicitarla.',
            llamada: 'Revisar viabilidad',
            enlace: () => pagina('landing-registro-marcas-cancun.html#verificador', 'abogado_marcas')
        },
        parte_marcas: {
            texto: '¿Vas a registrar una marca? Revisa su viabilidad gratis antes de solicitarla.',
            llamada: 'Revisar viabilidad',
            enlace: () => pagina('landing-registro-marcas-cancun.html#verificador', 'parte_marcas')
        },
        parte_familiar: {
            texto: 'Orientación en asuntos familiares: divorcio, pensión, guarda y custodia. Despacho en Cancún.',
            llamada: 'Consultar por WhatsApp',
            enlace: () => whatsapp('Hola, vengo de TSJ Filing y necesito orientación en materia familiar.')
        },
        parte_civil: {
            texto: '¿Dudas sobre tu juicio civil o mercantil? Una segunda opinión puede ayudarte.',
            llamada: 'Conocer el despacho',
            enlace: () => pagina('landing-abogados-cancun.html', 'parte_civil')
        },
        parte_penal: {
            texto: 'Orientación en materia penal, en Cancún y Quintana Roo.',
            llamada: 'Consultar por WhatsApp',
            enlace: () => whatsapp('Hola, vengo de TSJ Filing y necesito orientación en materia penal.')
        },
        parte_laboral: {
            texto: 'Orientación en materia laboral para trabajadores y empresas.',
            llamada: 'Consultar por WhatsApp',
            enlace: () => whatsapp('Hola, vengo de TSJ Filing y necesito orientación en materia laboral.')
        },
        parte_amparo: {
            texto: 'Asesoría en juicio de amparo: plazos y suspensión.',
            llamada: 'Ver más',
            enlace: () => pagina('landing-amparo-cancun.html', 'parte_amparo')
        },
        parte_general: {
            texto: '¿Necesitas orientación legal? Despacho de abogados en Cancún, en todas las materias.',
            llamada: 'Consultar por WhatsApp',
            enlace: () => whatsapp('Hola, vengo de TSJ Filing y necesito orientación legal.')
        }
    };

    /** La materia de un expediente, sacada del juzgado. null si no se sabe. */
    function materiaDeExpediente(exp) {
        if (!exp) return null;
        if (exp.institucion === 'PJF') return 'amparo';
        if (typeof raiz.rasgosJuzgadoTSJ !== 'function' || !exp.juzgado) return null;
        let materias = [];
        try { materias = raiz.rasgosJuzgadoTSJ(String(exp.juzgado)).materias || []; } catch (e) { return null; }
        if (materias.includes('constitucional')) return 'amparo';
        if (materias.includes('mercantil')) return 'civil';
        return materias[0] || null;
    }

    function materiaPredominante(expedientes) {
        const cuenta = {};
        for (const e of expedientes) { const m = materiaDeExpediente(e); if (m) cuenta[m] = (cuenta[m] || 0) + 1; }
        let mejor = null;
        for (const m of Object.keys(cuenta)) if (!mejor || cuenta[m] > cuenta[mejor]) mejor = m;
        return mejor;
    }

    /** Qué anuncio toca. Función pura: expedientes activos, la sección actual y el grupo de la prueba A/B. */
    function elegirVariante({ expedientes = [], pagina: seccion = '', grupo = 'a' } = {}) {
        const abogado = expedientes.length >= UMBRAL_ABOGADO;
        if (seccion === 'impi') return abogado ? 'abogado_marcas' : 'parte_marcas';
        if (seccion === 'pjf') return abogado ? 'abogado_amparo' : 'parte_amparo';
        if (seccion === 'laboral' && !abogado) return 'parte_laboral';
        if (expedientes.length === 0) return grupo === 'b' ? 'abogado_nuevo' : 'parte_general';
        const materia = materiaPredominante(expedientes);
        if (abogado) return materia === 'amparo' ? 'abogado_amparo' : 'abogado_general';
        return VARIANTES['parte_' + materia] ? 'parte_' + materia : 'parte_general';
    }

    // ==================== EN LA APP ====================

    let expedientesCache = [];
    let barra = null;
    let actual = null;

    function excluido() {
        try { if (typeof estadoPremium !== 'undefined' && estadoPremium && estadoPremium.activo) return true; } catch (e) {}
        if (document.body.classList.contains('ads-hidden')) return true;
        try { if (sessionStorage.getItem(CLAVE_CERRADO) === '1') return true; } catch (e) {}
        return false;
    }

    // Lo que ocupa ese mismo rincón en ese momento: el aviso de privacidad y las ofertas del recorrido.
    function hayAlgoAbajo() {
        return [...document.querySelectorAll('.aviso-privacidad-pie, #tour-oferta, #rec-oferta, .tour-tarjeta')]
            .some(el => !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
    }

    function grupoAB() {
        try {
            let g = localStorage.getItem(CLAVE_GRUPO);
            if (g !== 'a' && g !== 'b') { g = Math.random() < 0.5 ? 'a' : 'b'; localStorage.setItem(CLAVE_GRUPO, g); }
            return g;
        } catch (e) { return 'a'; }
    }

    function seccionActual() {
        const p = document.querySelector('.page.active');
        return p && p.id ? p.id.replace(/^page-/, '') : '';
    }

    function medirSiSePuede(evento, anuncio) {
        try { if (typeof raiz.medir === 'function') raiz.medir(evento, { anuncio }); } catch (e) {}
    }

    function construir() {
        const aside = document.createElement('aside');
        aside.id = 'anuncio-contextual';
        aside.className = 'anuncio-ctx';
        aside.setAttribute('aria-label', 'Anuncio de Empírica Legal Lab');
        const a = document.createElement('a');
        a.className = 'anuncio-ctx-enlace';
        a.target = '_blank';
        a.rel = 'noopener';
        const marca = document.createElement('span'); marca.className = 'anuncio-ctx-marca'; marca.textContent = MARCA;
        const texto = document.createElement('span'); texto.className = 'anuncio-ctx-texto';
        const llamada = document.createElement('span'); llamada.className = 'anuncio-ctx-llamada';
        a.append(marca, texto, llamada);
        a.addEventListener('click', () => medirSiSePuede('anuncio_contextual_clic', actual));
        const cerrar = document.createElement('button');
        cerrar.type = 'button';
        cerrar.className = 'anuncio-ctx-cerrar';
        cerrar.setAttribute('aria-label', 'Cerrar anuncio');
        cerrar.textContent = '×';
        cerrar.addEventListener('click', () => {
            try { sessionStorage.setItem(CLAVE_CERRADO, '1'); } catch (e) {}
            medirSiSePuede('anuncio_contextual_cerrado', actual);
            ocultar();
        });
        aside.append(a, cerrar);
        document.body.appendChild(aside);
        return aside;
    }

    function pintar() {
        if (excluido()) { ocultar(); return; }
        const id = elegirVariante({ expedientes: expedientesCache, pagina: seccionActual(), grupo: grupoAB() });
        if (id === actual && barra) return;
        const v = VARIANTES[id];
        if (!barra) barra = construir();
        barra.querySelector('.anuncio-ctx-texto').textContent = v.texto;
        barra.querySelector('.anuncio-ctx-llamada').textContent = v.llamada + ' →';
        barra.querySelector('.anuncio-ctx-enlace').href = v.enlace();
        barra.dataset.variante = id;
        actual = id;
        document.body.classList.add('con-anuncio-ctx');
        medirSiSePuede('anuncio_contextual_visto', id);
        vigilarRincon();
    }

    // Si después se abre algo en ese rincón (la oferta de recomendar a un colega,
    // un recorrido, el aviso de privacidad), el anuncio se aparta y vuelve al cerrarse.
    let vigilancia = null;
    function vigilarRincon() {
        if (vigilancia) return;
        vigilancia = setInterval(() => {
            if (!barra) { clearInterval(vigilancia); vigilancia = null; return; }
            barra.hidden = hayAlgoAbajo();
        }, 1000);
    }

    function ocultar() {
        if (barra) { barra.remove(); barra = null; }
        if (vigilancia) { clearInterval(vigilancia); vigilancia = null; }
        actual = null;
        document.body.classList.remove('con-anuncio-ctx');
    }

    async function leerExpedientes() {
        try { if (typeof raiz.obtenerExpedientes === 'function') expedientesCache = await raiz.obtenerExpedientes() || []; }
        catch (e) { expedientesCache = []; }
    }

    async function arrancar(intentos = 0) {
        if (excluido()) return;
        if (hayAlgoAbajo()) {
            if (intentos < 60) setTimeout(() => arrancar(intentos + 1), 3000);
            return;
        }
        await leerExpedientes();
        pintar();
    }

    function iniciar() {
        if (!document.getElementById('page-inicio')) return;      // solo en la app
        // Al cambiar de sección se ajusta (marcas, amparo, laboral) y se revisa si ya es Premium.
        const original = raiz.navegarA;
        if (typeof original === 'function' && !original.__anuncioCtx) {
            const envuelta = function (...args) {
                const r = original.apply(this, args);
                setTimeout(() => { try { if (barra) pintar(); } catch (e) {} }, 0);
                return r;
            };
            Object.keys(original).forEach(k => { envuelta[k] = original[k]; });
            envuelta.__anuncioCtx = true;
            raiz.navegarA = envuelta;
        }
        // Si se activa Premium o se ocultan los anuncios, desaparece.
        new MutationObserver(() => { if (barra && excluido()) ocultar(); })
            .observe(document.body, { attributes: true, attributeFilter: ['class'] });
        setTimeout(() => arrancar(), RETRASO_MS);
    }

    const API = { elegirVariante, materiaDeExpediente, VARIANTES, UMBRAL_ABOGADO };
    raiz.AnuncioContextual = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.addEventListener('load', () => { try { setTimeout(iniciar, 0); } catch (e) {} });
    }
})(typeof window !== 'undefined' ? window : globalThis);
