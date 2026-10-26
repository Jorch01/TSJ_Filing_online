/**
 * Estrados laborales de Quintana Roo: Tribunal de Conciliación y Arbitraje
 * (TCA), Junta Local y Juntas Especiales.
 *
 * Se publican en el sitio de la Secretaría del Trabajo
 * (sag-styps.qroo.gob.mx/sitio/TramitesServicios/Estrados/). Ese sitio no
 * busca por número de expediente: pide una unidad (TCA, JLCA, JECA…) y un
 * rango de fechas de 15 días como máximo, y cada consulta pasa por
 * reCAPTCHA. Tampoco lee parámetros de la URL, así que no hay enlace directo
 * a los estrados de un expediente.
 *
 * Lo que sí se puede: un marcador del navegador (bookmarklet) que, ya en esa
 * página, llena el formulario oficial tramo por tramo —la página ejecuta su
 * propio reCAPTCHA en cada consulta, como si se pulsara "Consultar" a mano—,
 * junta lo publicado en todo el periodo y deja en la tabla del sitio solo lo
 * de los expedientes que se buscan. No se salta ninguna protección ni manda
 * datos a ningún lado.
 *
 * Dos partes:
 *  - el núcleo (`nucleo`), funciones puras sin referencias externas: lo usa
 *    la app y va copiado tal cual dentro del marcador, así que es uno solo y
 *    se prueba en Node;
 *  - la ventana de la app que arma el marcador para el navegador elegido.
 */
(function (global) {
    'use strict';

    const URL_ESTRADOS = 'https://sag-styps.qroo.gob.mx/sitio/TramitesServicios/Estrados/';
    // Las unidades tal como las ofrece el sitio (value del select #IdUR).
    const UNIDADES = [
        { id: '20', clave: 'TCA', nombre: 'Tribunal de Conciliación y Arbitraje' },
        { id: '23', clave: 'JLCA', nombre: 'Junta Local de Conciliación y Arbitraje' },
        { id: '27', clave: 'JECA 1 BJ', nombre: 'Junta Especial 1 Benito Juárez' },
        { id: '29', clave: 'JECA 2 BJ', nombre: 'Junta Especial 2 Benito Juárez' },
        { id: '33', clave: 'JECA Cozumel', nombre: 'Junta Especial Cozumel' },
        { id: '35', clave: 'JECA Playa', nombre: 'Junta Especial Playa del Carmen' }
    ];
    // El sitio no publica antes de esta fecha (data-fp-min-date).
    const MINIMO = '2024-01-01';

    /**
     * Funciones puras que también viajan dentro del marcador: no pueden
     * tocar nada de fuera de ellas mismas.
     */
    function nucleo() {
        const DIA = 864e5;
        const aFecha = (f) => { const [y, m, d] = f.split('-').map(Number); return new Date(y, m - 1, d); };
        const aTexto = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const sumar = (f, n) => { const d = aFecha(f); d.setDate(d.getDate() + n); return aTexto(d); };
        const finDeSemana = (f) => { const w = aFecha(f).getDay(); return w === 0 || w === 6; };
        const habilAdelante = (f) => { while (finDeSemana(f)) f = sumar(f, 1); return f; };
        const habilAtras = (f) => { while (finDeSemana(f)) f = sumar(f, -1); return f; };

        /**
         * Los periodos a consultar. El sitio solo admite periodos de menos de
         * 15 días y sin fines de semana en sus extremos (su calendario no los
         * deja elegir). Se parte de una fecha que es el inicio o el final del
         * primer periodo y, si se piden varios, se encadenan hacia adelante
         * (desde un inicio) o hacia atrás (desde un final), sin huecos.
         * No pasan de hoy ni de la fecha mínima del sitio. Salen en orden.
         */
        function periodos(fecha, tipo, cuantos, hoy, minimo) {
            const lista = [];
            const n = Math.max(1, Math.min(52, parseInt(cuantos, 10) || 1));
            if (tipo === 'fin') {
                let fin = habilAtras(fecha > hoy ? hoy : fecha);
                for (let i = 0; i < n; i++) {
                    let inicio = habilAdelante(sumar(fin, -14));
                    if (minimo && inicio < minimo) inicio = habilAdelante(minimo);
                    if (inicio > fin) break;
                    lista.unshift([inicio, fin]);
                    if (minimo && inicio <= habilAdelante(minimo)) break;
                    fin = habilAtras(sumar(inicio, -1));
                }
            } else {
                let inicio = habilAdelante(minimo && fecha < minimo ? minimo : fecha);
                for (let i = 0; i < n && inicio <= hoy; i++) {
                    let fin = sumar(inicio, 14);
                    if (fin > hoy) fin = hoy;
                    fin = habilAtras(fin);
                    if (fin < inicio) break;
                    lista.push([inicio, fin]);
                    inicio = habilAdelante(sumar(fin, 1));
                }
            }
            return lista;
        }

        function normalizar(s) {
            return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
        }

        /** "DIT-021/2026", "Exp. 21/2026-II" → "21/2026". */
        function numeros(texto) {
            const s = [];
            const re = /(\d{1,7})\s*\/\s*(\d{4})(?!\d)/g;
            let m;
            while ((m = re.exec(String(texto || '')))) s.push(parseInt(m[1], 10) + '/' + m[2]);
            return s;
        }

        /** "021/2026, Pérez" → términos de búsqueda. */
        function terminos(texto) {
            return String(texto || '').split(/[,;\n]+/).map(t => t.trim()).filter(Boolean);
        }

        /**
         * ¿Esta publicación es de alguno de los expedientes buscados? Un
         * término con número se compara por número (021/2026 = 21/2026); uno
         * sin número, como texto en el expediente, el actor o el demandado.
         */
        function coincide(fila, lista) {
            if (!lista || !lista.length) return true;
            const nums = numeros(fila.NUM_EXP);
            const texto = normalizar([fila.NUM_EXP, fila.ACTOR, fila.DEMANDADO].join(' '));
            return lista.some(t => {
                const n = numeros(t);
                if (n.length) return n.some(x => nums.includes(x));
                const tt = normalizar(t);
                return !!tt && texto.includes(tt);
            });
        }

        return { DIA, sumar, finDeSemana, periodos, normalizar, numeros, terminos, coincide };
    }

    /**
     * El marcador. Corre dentro de la página de estrados del sitio, con la
     * configuración que arma la app. No puede usar nada de fuera: lleva el
     * núcleo pegado.
     */
    function marcador(cfg, N) {
        const doc = document;
        const form = doc.getElementById('formBusquedaEstrados');
        if (!form) {
            if (confirm('Este marcador funciona en la página de estrados laborales. ¿Abrirla ahora? Cuando cargue, vuelve a pulsar el marcador.')) {
                location.href = cfg.url;
            }
            return;
        }
        const viejo = doc.getElementById('tsjf-estrados');
        if (viejo) viejo.remove();

        const CLAVE = 'tsjfiling_estrados';
        let previo = {};
        try { previo = JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch (e) { /* sin almacenamiento */ }
        const hoy = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

        const caja = doc.createElement('div');
        caja.id = 'tsjf-estrados';
        caja.setAttribute('style', 'position:fixed;z-index:99999;top:12px;right:12px;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;' +
            'background:#fff;color:#1f2937;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:14px/1.45 system-ui,sans-serif;padding:14px');
        const campo = 'display:block;width:100%;box-sizing:border-box;margin:3px 0 9px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit';
        const opciones = cfg.unidades.map(u => '<option value="' + u.id + '">' + u.clave + ' — ' + u.nombre + '</option>').join('');
        caja.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>Estrados · TSJ Filing</strong>' +
                '<button type="button" data-x style="border:0;background:none;font-size:18px;cursor:pointer" aria-label="Cerrar">×</button></div>' +
            '<label>Unidad<select data-c="unidad" style="' + campo + '">' + opciones + '</select></label>' +
            '<label>Expedientes o nombres (separados por coma)<input data-c="buscar" style="' + campo + '" placeholder="021/2026, Pérez"></label>' +
            '<p style="margin:0 0 8px;color:#475569;font-size:13px">El sitio solo deja consultar <strong>periodos de 15 días</strong> como máximo. Elige una fecha y cuántos periodos seguidos revisar: se arman solos.</p>' +
            '<div style="display:flex;gap:8px"><label style="flex:1">Fecha<input type="date" data-c="fecha" style="' + campo + '"></label>' +
                '<label style="flex:1">Esa fecha es<select data-c="tipo" style="' + campo + '"><option value="fin">el final (hacia atrás)</option><option value="inicio">el inicio (hacia adelante)</option></select></label></div>' +
            '<label>Periodos de 15 días a revisar<input type="number" min="1" max="52" data-c="cuantos" style="' + campo + '"></label>' +
            '<div data-lista style="margin:-4px 0 10px;color:#475569;font-size:12.5px"></div>' +
            '<button type="button" data-ir style="width:100%;padding:8px;border:0;border-radius:6px;background:#2563a8;color:#fff;font:600 14px system-ui;cursor:pointer">Consultar</button>' +
            '<div data-estado style="margin-top:10px"></div>';
        doc.body.appendChild(caja);
        const $c = (n) => caja.querySelector('[data-c="' + n + '"]');
        const estado = caja.querySelector('[data-estado]');
        $c('unidad').value = previo.unidad || cfg.unidad || '20';
        $c('buscar').value = (cfg.terminos && cfg.terminos.length ? cfg.terminos.join(', ') : '') || previo.buscar || '';
        $c('fecha').value = cfg.fecha && cfg.fecha <= hoy ? cfg.fecha : hoy;
        $c('tipo').value = cfg.tipo === 'inicio' ? 'inicio' : 'fin';
        $c('cuantos').value = cfg.cuantos || 1;
        const corta = (f) => f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4);
        const calcular = () => N.periodos($c('fecha').value || hoy, $c('tipo').value, $c('cuantos').value, hoy, cfg.minimo);
        const mostrarLista = () => {
            const ps = calcular();
            caja.querySelector('[data-lista]').textContent = ps.length
                ? 'Se revisarán ' + ps.length + ' periodo' + (ps.length === 1 ? '' : 's') + ': ' + ps.map(p => corta(p[0]) + '–' + corta(p[1])).join(' · ')
                : 'Con esa fecha no hay periodos que revisar.';
        };
        ['fecha', 'tipo', 'cuantos'].forEach(n => { $c(n).oninput = mostrarLista; $c(n).onchange = mostrarLista; });
        mostrarLista();
        caja.querySelector('[data-x]').onclick = () => caja.remove();

        const esperar = (ms) => new Promise(r => setTimeout(r, ms));
        const api = () => {
            const jq = window.jQuery;
            if (!jq || !jq.fn || !jq.fn.DataTable || !jq.fn.DataTable.isDataTable('#tablaEstrados')) return null;
            return jq('#tablaEstrados').DataTable();
        };
        const fijar = (id, valor) => {
            const el = doc.getElementById(id);
            const fp = el && el._flatpickr;
            if (fp) fp.setDate(valor, true);
            if (el && el.value !== valor) { el.value = valor; el.dispatchEvent(new Event('change', { bubbles: true })); }
        };
        const limpiar = (id) => {
            const fp = doc.getElementById(id) && doc.getElementById(id)._flatpickr;
            if (fp) { if (typeof fp.resetRange === 'function') fp.resetRange(); else fp.clear(); }
        };

        // Una consulta del sitio: se llena el formulario y se envía; la
        // página corre su reCAPTCHA y llena su tabla. Se espera a que llegue
        // la respuesta nueva.
        async function consultar(unidad, inicio, fin) {
            const antes = api() && api().ajax.json();
            doc.getElementById('IdUR').value = unidad;
            doc.getElementById('IdUR').dispatchEvent(new Event('change', { bubbles: true }));
            limpiar('FechaInicio'); limpiar('FechaFin');
            fijar('FechaInicio', inicio);
            fijar('FechaFin', fin);
            if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            for (let t = 0; t < 120; t++) {
                await esperar(250);
                const a = api();
                const json = a && a.ajax.json();
                if (json && json !== antes) return (json.data || []).slice();
            }
            throw new Error('sin respuesta');
        }

        caja.querySelector('[data-ir]').onclick = async () => {
            const unidad = $c('unidad').value;
            const lista = N.terminos($c('buscar').value);
            const partes = calcular();
            if (!partes.length) { estado.textContent = 'Revisa la fecha: no hay periodos que revisar.'; return; }
            const desde = partes[0][0], hasta = partes[partes.length - 1][1];
            try { localStorage.setItem(CLAVE, JSON.stringify({ unidad, buscar: $c('buscar').value })); } catch (e) { /* sin almacenamiento */ }
            const boton = caja.querySelector('[data-ir]');
            boton.disabled = true;
            const todas = [];
            const fallidos = [];
            for (let i = 0; i < partes.length; i++) {
                const [a, b] = partes[i];
                estado.textContent = 'Consultando ' + (i + 1) + ' de ' + partes.length + ' (' + a + ' a ' + b + ')…';
                try {
                    todas.push(...await consultar(unidad, a, b));
                } catch (e) {
                    fallidos.push(a + ' a ' + b);
                }
                // Entre consulta y consulta, una pausa: es un sitio público.
                if (i < partes.length - 1) await esperar(cfg.pausa == null ? 1200 : cfg.pausa);
            }
            const vistas = new Set();
            const unicas = todas.filter(f => { const k = JSON.stringify(f); if (vistas.has(k)) return false; vistas.add(k); return true; });
            const halladas = unicas.filter(f => N.coincide(f, lista));
            const tabla = api();
            if (tabla) tabla.clear().rows.add(lista.length ? halladas : unicas).draw();
            boton.disabled = false;
            const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            estado.innerHTML =
                '<p style="margin:0 0 6px"><strong>' + (lista.length ? halladas.length + ' publicaciones de tus expedientes' : unicas.length + ' publicaciones') + '</strong> ' +
                'entre ' + desde + ' y ' + hasta + ' (' + unicas.length + ' en total, ' + partes.length + ' consultas).</p>' +
                (fallidos.length ? '<p style="margin:0 0 6px;color:#b45309">Sin respuesta: ' + esc(fallidos.join('; ')) + '. Vuelve a consultar esos días.</p>' : '') +
                (lista.length && halladas.length ? '<ol style="margin:0;padding-left:18px">' + halladas.map(f =>
                    '<li style="margin-bottom:4px"><strong>' + esc(f.FECHA_ESTRADO) + ' · ' + esc(f.NUM_EXP) + '</strong> ' + esc(f.TIPO_ACUERDO_DESC || '') +
                    '<br><small>' + esc(f.ACTOR) + ' vs ' + esc(f.DEMANDADO) + (f.RESOLUCION ? ' — ' + esc(f.RESOLUCION) : '') + '</small></li>').join('') + '</ol>' : '') +
                (lista.length && !halladas.length ? '<p style="margin:0">No hay publicaciones de esos expedientes en el periodo.</p>' : '') +
                '<p style="margin:8px 0 0;color:#64748b"><small>La tabla de la página quedó con ' + (lista.length ? 'esas publicaciones' : 'todo el periodo') + '.</small></p>';
        };
    }

    /** El código del marcador (javascript:…) con su configuración. */
    function generarMarcador(cfg) {
        const conf = {
            url: URL_ESTRADOS, minimo: MINIMO, unidades: UNIDADES,
            unidad: cfg.unidad || '20', terminos: cfg.terminos || [],
            fecha: cfg.fecha || '', tipo: cfg.tipo === 'inicio' ? 'inicio' : 'fin',
            cuantos: Math.max(1, Math.min(52, parseInt(cfg.cuantos, 10) || 1)), pausa: cfg.pausa
        };
        // Sin comentarios ni sangrías para que quepa cómodo en un marcador.
        // Los saltos de línea se conservan (no se depende de quitarlos) y
        // solo se codifica lo que una URL no admite tal cual.
        const compacto = (fn) => fn.toString()
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//')).join('\n');
        const codigo = '(' + compacto(marcador) + ')(' + JSON.stringify(conf) + ',(' + compacto(nucleo) + ')())';
        return 'javascript:' + codigo.replace(/%/g, '%25').replace(/\n/g, '%0A').replace(/#/g, '%23')
            .replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/ /g, '%20');
    }

    /**
     * ¿El expediente es de un tribunal laboral de Quintana Roo, y de cuál?
     * Se reconoce por lo capturado: "Tribunal de Conciliación y Arbitraje",
     * "TCA", el prefijo DIT- de sus expedientes, la Junta Local o una Junta
     * Especial y su ciudad.
     */
    function unidadDeExpediente(exp) {
        if (!exp || exp.institucion === 'PJF') return null;
        const t = nucleo().normalizar([exp.juzgado, exp.nombre, exp.numero, exp.comentario, exp.institucionOtra, exp.organo].filter(Boolean).join(' '));
        if (/junta especial|\bjeca\b/.test(t)) {
            if (/cozumel/.test(t)) return UNIDADES[4];
            if (/playa del carmen|solidaridad/.test(t)) return UNIDADES[5];
            if (/\b(2|dos|segunda)\b/.test(t)) return UNIDADES[3];
            return UNIDADES[2];
        }
        if (/junta local|\bjlca\b/.test(t)) return UNIDADES[1];
        if (/conciliacion y arbitraje|\btca\b|\bdit-?\s*\d/.test(t)) return UNIDADES[0];
        return null;
    }

    const Motor = { URL_ESTRADOS, UNIDADES, MINIMO, nucleo, marcador, generarMarcador, unidadDeExpediente };
    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
    if (typeof document === 'undefined') return;

    // ==================== VENTANA DE LA APP ====================

    const CLAVE_NAVEGADOR = 'estrados_laborales_navegador';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function navegadorProbable() {
        try { const g = localStorage.getItem(CLAVE_NAVEGADOR); if (g) return g; } catch (e) { /* sin almacenamiento */ }
        const ua = navigator.userAgent || '';
        if (/Firefox\//.test(ua)) return 'firefox';
        if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'safari';
        return 'chrome';
    }

    const INSTRUCCIONES = {
        chrome: [
            'Muestra la barra de marcadores: <kbd>⌘</kbd> + <kbd>⇧</kbd> + <kbd>B</kbd> (en Windows, <kbd>Ctrl</kbd> + <kbd>⇧</kbd> + <kbd>B</kbd>).',
            'Arrastra el botón azul <strong>📌 Estrados laborales</strong> a esa barra.',
            'Pulsa <strong>Abrir estrados</strong>; cuando cargue la página, pulsa el marcador.'
        ],
        firefox: [
            'Muestra la barra de marcadores: <kbd>⌘</kbd> + <kbd>⇧</kbd> + <kbd>B</kbd> (en Windows, <kbd>Ctrl</kbd> + <kbd>⇧</kbd> + <kbd>B</kbd>).',
            'Arrastra el botón azul <strong>📌 Estrados laborales</strong> a esa barra.',
            'Pulsa <strong>Abrir estrados</strong>; cuando cargue la página, pulsa el marcador.'
        ],
        safari: [
            'Muestra la barra de favoritos: <kbd>⌘</kbd> + <kbd>⇧</kbd> + <kbd>B</kbd>.',
            'Arrastra el botón azul <strong>📌 Estrados laborales</strong> a esa barra. Si Safari no lo deja: pulsa <strong>Copiar código</strong>, añade cualquier página a Favoritos (<kbd>⌘</kbd> + <kbd>D</kbd>), y en <em>Marcadores → Editar marcadores</em> haz clic derecho sobre él → <em>Editar dirección</em> y pega el código.',
            'Pulsa <strong>Abrir estrados</strong>; cuando cargue la página, pulsa el marcador.'
        ]
    };

    const ui = { navegador: 'chrome' };

    /**
     * Abre la ventana. `exp` (opcional): el expediente desde el que se llegó;
     * si no, se buscan todos los laborales capturados.
     */
    async function abrir(exp) {
        let lista = [];
        try {
            const todos = await obtenerExpedientes();
            lista = todos.filter(e => unidadDeExpediente(e));
        } catch (e) { /* sin base */ }
        const unidad = (exp && unidadDeExpediente(exp)) || (lista[0] && unidadDeExpediente(lista[0])) || UNIDADES[0];
        const deLaUnidad = exp ? [exp] : lista.filter(e => unidadDeExpediente(e).id === unidad.id);
        const terminos = deLaUnidad.map(e => (nucleo().numeros(e.numero)[0] || e.numero || e.nombre)).filter(Boolean);
        const hoy = new Date().toLocaleDateString('en-CA');
        ui.navegador = navegadorProbable();

        $('modal-titulo').textContent = '👷 Estrados laborales';
        $('modal-body').innerHTML =
            '<div class="estl">' +
                '<p class="estl-nota">Los estrados laborales se publican en el sitio de la Secretaría del Trabajo, que <strong>no busca por número de expediente</strong>: ' +
                'pide la unidad (TCA, Junta…) y un <strong>periodo de 15 días como máximo</strong>, y cada consulta pasa por reCAPTCHA. ' +
                'Por eso no hay un enlace directo a tu expediente. Lo que sí se puede: un marcador en tu navegador que, en esa página, hace por ti las consultas de los periodos que elijas y deja en la tabla solo tus expedientes.</p>' +
                '<div class="estl-campos">' +
                    '<label>Unidad<select id="estl-unidad">' + UNIDADES.map(u => '<option value="' + u.id + '"' + (u.id === unidad.id ? ' selected' : '') + '>' + esc(u.clave + ' — ' + u.nombre) + '</option>').join('') + '</select></label>' +
                    '<label>Expedientes o nombres a buscar<input id="estl-buscar" value="' + esc(terminos.join(', ')) + '" placeholder="021/2026, Pérez"></label>' +
                    '<label>Fecha<input type="date" id="estl-fecha" min="' + MINIMO + '" max="' + esc(hoy) + '" value="' + esc(hoy) + '"></label>' +
                    '<label>Esa fecha es<select id="estl-tipo"><option value="fin">el final del periodo (revisa hacia atrás)</option><option value="inicio">el inicio del periodo (revisa hacia adelante)</option></select></label>' +
                    '<label>¿Cuántos periodos de 15 días?<input type="number" id="estl-cuantos" min="1" max="52" value="1"></label>' +
                '</div>' +
                '<p class="estl-nota estl-lista" id="estl-lista"></p>' +
                '<p class="estl-nota">El marcador recuerda lo que elijas aquí y, al pulsarlo, todavía puedes cambiarlo. Cada periodo es una consulta al sitio (unos 3 segundos).</p>' +
                '<div class="estl-navegadores" role="tablist">' +
                    ['chrome', 'safari', 'firefox'].map(n => '<button type="button" class="estl-nav' + (n === ui.navegador ? ' activa' : '') + '" data-nav="' + n + '">' +
                        { chrome: 'Chrome', safari: 'Safari', firefox: 'Firefox' }[n] + '</button>').join('') +
                '</div>' +
                '<ol class="estl-pasos" id="estl-pasos"></ol>' +
                '<div class="estl-marcador"><a id="estl-enlace" class="btn btn-primary" draggable="true" title="Arrástralo a tu barra de marcadores">📌 Estrados laborales</a>' +
                    '<button type="button" class="btn btn-secondary" id="estl-copiar">Copiar código</button></div>' +
            '</div>';
        $('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>' +
            '<button class="btn btn-primary" id="estl-abrir">🌐 Abrir estrados</button>';

        const actualizar = () => {
            const enlace = $('estl-enlace');
            const cfg = {
                unidad: $('estl-unidad').value,
                terminos: nucleo().terminos($('estl-buscar').value),
                fecha: $('estl-fecha').value || hoy, tipo: $('estl-tipo').value, cuantos: $('estl-cuantos').value
            };
            enlace.href = generarMarcador(cfg);
            const ps = nucleo().periodos(cfg.fecha, cfg.tipo, cfg.cuantos, hoy, MINIMO);
            const corta = (f) => new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
            $('estl-lista').textContent = ps.length
                ? 'Se revisarán ' + ps.length + ' periodo' + (ps.length === 1 ? '' : 's') + ': ' + ps.map(p => corta(p[0]) + ' – ' + corta(p[1])).join(' · ')
                : 'Con esa fecha no hay periodos que revisar (el sitio publica desde el 1 de enero de 2024 y hasta hoy).';
            $('estl-pasos').innerHTML = INSTRUCCIONES[ui.navegador].map(p => '<li>' + p + '</li>').join('');
            document.querySelectorAll('.estl-nav').forEach(b => b.classList.toggle('activa', b.dataset.nav === ui.navegador));
        };
        ['estl-unidad', 'estl-buscar', 'estl-fecha', 'estl-tipo', 'estl-cuantos'].forEach(id => {
            $(id).addEventListener('input', actualizar);
            $(id).addEventListener('change', actualizar);
        });
        document.querySelectorAll('.estl-nav').forEach(b => b.addEventListener('click', () => {
            ui.navegador = b.dataset.nav;
            try { localStorage.setItem(CLAVE_NAVEGADOR, ui.navegador); } catch (e) { /* sin almacenamiento */ }
            actualizar();
        }));
        // Pulsarlo aquí lo correría en la app: hay que arrastrarlo o copiarlo.
        $('estl-enlace').addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof mostrarToast === 'function') mostrarToast('Arrástralo a tu barra de marcadores; luego púlsalo en la página de estrados', 'info');
        });
        $('estl-copiar').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText($('estl-enlace').href);
                if (typeof mostrarToast === 'function') mostrarToast('Código del marcador copiado', 'success');
            } catch (e) {
                if (typeof mostrarToast === 'function') mostrarToast('No se pudo copiar: arrastra el botón azul a tu barra de marcadores', 'warning');
            }
        });
        $('estl-abrir').addEventListener('click', () => window.open(URL_ESTRADOS, '_blank', 'noopener'));
        actualizar();
        if (typeof abrirModal === 'function') abrirModal(); else $('modal-overlay').classList.add('active');
    }

    /** Desde el botón de un expediente. */
    async function abrirDeExpediente(id, event) {
        if (event) { event.stopPropagation(); event.preventDefault(); }
        let exp = null;
        try {
            const todos = (await obtenerExpedientes()).concat(typeof obtenerExpedientesArchivados === 'function' ? await obtenerExpedientesArchivados() : []);
            exp = todos.find(e => e.id === id) || null;
        } catch (e) { /* sin base */ }
        return abrir(exp);
    }

    global.ESTRADOS_LABORALES = { ...Motor, abrir, abrirDeExpediente };
})(typeof window !== 'undefined' ? window : globalThis);
