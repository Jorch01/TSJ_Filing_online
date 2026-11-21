/**
 * Causas penales del TSJ de Quintana Roo.
 *
 * Los juzgados penales de primera instancia (juzgados penales orales o de
 * control, tribunales de juicio oral, adolescentes, ejecución) NO publican
 * acuerdos en los estrados electrónicos: ahí solo publican las salas. Lo
 * público de una causa penal es:
 *
 *  - Los tocas de las salas penales (apelaciones, quejas…). Su buscador busca
 *    el número en la columna "Expediente", que es la causa del juzgado de
 *    origen ("339/2023"), no en el número del toca. Se busca número/año, sin
 *    prefijos: también encuentra lo escrito "C.A. 339/2023".
 *  - La agenda de audiencias de cada juzgado (tsjqroo.gob.mx/audiencias), con
 *    su propia numeración (JUZGADOS_PENALES[...].agenda). No trae número de
 *    causa ni partes: juez, delito, tipo de audiencia, fecha y hora.
 *
 * Aquí se arma la ventana que ofrece las dos cosas para una causa. Los datos
 * (juzgados, salas) viven en juzgados.js.
 */
(function (global) {
    'use strict';

    const URL_ESTRADOS = 'https://www.tsjqroo.gob.mx/estrados';
    const URL_AGENDA = 'https://www.tsjqroo.gob.mx/audiencias/index.php';

    /** El número de la causa (número/año) dentro de lo escrito, o el texto tal cual. */
    function causaDe(texto) {
        const t = String(texto || '').trim();
        const m = /(\d{1,6})\s*\/\s*(\d{4})\b/.exec(t);
        return m ? `${Number(m[1])}/${m[2]}` : t;
    }

    /**
     * Las búsquedas de la causa en las salas penales: [{ nombre, url, anterior }].
     * `tipo`: 'numero' (por defecto) o 'nombre'.
     */
    function busquedasEnSalas(valor, tipo = 'numero', opciones = {}) {
        const porNombre = tipo === 'nombre';
        const termino = porNombre ? String(valor || '').trim() : causaDe(valor);
        if (!termino) return [];
        const metodo = porNombre ? 2 : 1;
        const actuales = (typeof SALAS_PENALES !== 'undefined' ? SALAS_PENALES : [])
            .map(nombre => ({ nombre, url: construirUrlBusqueda(nombre, porNombre ? 'nombre' : 'numero', termino), anterior: false }))
            .filter(b => b.url);
        if (opciones.soloActuales) return actuales;
        const anteriores = (typeof SALAS_PENALES_ANTERIORES !== 'undefined' ? SALAS_PENALES_ANTERIORES : [])
            .map(s => ({
                nombre: s.nombre,
                url: `${URL_ESTRADOS}/buscador_segunda.php?findexp=${encodeURIComponent(termino)}&int=${s.int}&metodo=${metodo}`,
                anterior: true
            }));
        return actuales.concat(anteriores);
    }

    /** La agenda de audiencias de un juzgado penal del catálogo, o null. */
    function urlAgenda(juzgado, fecha) {
        const datos = typeof JUZGADOS_PENALES !== 'undefined' ? JUZGADOS_PENALES[juzgado] : null;
        if (!datos || !datos.agenda) return null;
        const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? `&fecha=${fecha}` : '';
        return `${URL_AGENDA}?juzgado=${datos.agenda}&area_id=1${f}`;
    }

    /** Los estrados propios del juzgado, solo si los tiene (Tulum), o null. */
    function urlEstradosJuzgado(juzgado, tipo, valor) {
        const datos = typeof JUZGADOS_PENALES !== 'undefined' ? JUZGADOS_PENALES[juzgado] : null;
        if (!datos || !datos.estrados || !valor) return null;
        const porNombre = tipo === 'nombre';
        const termino = porNombre ? String(valor).trim() : causaDe(valor);
        return `${URL_ESTRADOS}/buscador_primera.php?int=${datos.estrados}&metodo=${porNombre ? 2 : 1}&findexp=${encodeURIComponent(termino)}`;
    }

    /**
     * El juzgado penal del catálogo de un expediente del TSJ, o null. Se
     * reconoce también el nombre largo de un acuerdo ("Juzgado Penal Oral del
     * Distrito Judicial de Cancún").
     */
    function juzgadoPenalDeExpediente(exp) {
        if (!exp || (exp.institucion || 'TSJ') !== 'TSJ' || !exp.juzgado) return null;
        if (typeof esJuzgadoPenalTSJ !== 'function') return null;
        if (esJuzgadoPenalTSJ(exp.juzgado)) return exp.juzgado;
        const reconocido = typeof reconocerJuzgadoTSJ === 'function' ? reconocerJuzgadoTSJ(exp.juzgado) : null;
        return reconocido && esJuzgadoPenalTSJ(reconocido) ? reconocido : null;
    }

    const Motor = { URL_AGENDA, causaDe, busquedasEnSalas, urlAgenda, urlEstradosJuzgado, juzgadoPenalDeExpediente };
    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
    // Sin pantalla (las pruebas, el asistente en Node) basta con el motor.
    global.ESTRADOS_PENALES = Motor;
    if (typeof document === 'undefined') return;

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function enlace(b) {
        return `<a class="estp-sala" href="${esc(b.url)}" target="_blank" rel="noopener">🔍 ${esc(b.nombre)}</a>`;
    }

    /**
     * Abre la ventana. `datos`: { valor, tipo, juzgado } — lo que se busca y,
     * si se sabe, el juzgado penal de la causa (para su agenda).
     */
    function abrir(datos = {}) {
        const tipo = datos.tipo === 'nombre' ? 'nombre' : 'numero';
        const valor = tipo === 'nombre' ? String(datos.valor || '').trim() : causaDe(datos.valor);
        const juzgado = datos.juzgado && typeof esJuzgadoPenalTSJ === 'function' && esJuzgadoPenalTSJ(datos.juzgado) ? datos.juzgado : '';
        const hoy = new Date().toLocaleDateString('en-CA');
        const opciones = Object.keys(typeof JUZGADOS_PENALES !== 'undefined' ? JUZGADOS_PENALES : {})
            .map(j => `<option value="${esc(j)}"${j === juzgado ? ' selected' : ''}>${esc(j)}</option>`).join('');

        $('modal-titulo').textContent = valor
            ? `⚖️ ${tipo === 'nombre' ? 'Causa penal de' : 'Causa penal'} ${valor}`
            : '⚖️ Causas penales';
        $('modal-body').innerHTML =
            '<div class="estp">' +
                '<p class="estp-nota">Los juzgados penales del TSJ <strong>no publican acuerdos en los estrados electrónicos</strong>: ahí solo publican las salas. ' +
                'De una causa penal es público lo que llega a las salas penales (apelaciones, quejas…) y la agenda de audiencias del juzgado.</p>' +
                '<section class="estp-bloque">' +
                    '<h4>🏛️ Tocas de la causa en las salas penales</h4>' +
                    '<label class="estp-campo">' + (tipo === 'nombre' ? 'Nombre de la parte' : 'Número de la causa (número/año)') +
                        `<input id="estp-valor" value="${esc(valor)}" placeholder="${tipo === 'nombre' ? 'Juan Pérez López' : '339/2023'}"></label>` +
                    '<p class="estp-nota">Se busca en la columna «Expediente» de cada sala, que es la causa del juzgado de origen; el número del toca no sirve aquí.</p>' +
                    '<div class="estp-salas" id="estp-salas"></div>' +
                    '<details class="estp-anteriores"><summary>Salas anteriores (asuntos de años pasados)</summary><div class="estp-salas" id="estp-anteriores"></div></details>' +
                '</section>' +
                '<section class="estp-bloque">' +
                    '<h4>📅 Agenda de audiencias del juzgado</h4>' +
                    '<p class="estp-nota">Muestra unas dos semanas a partir de la fecha: juez, delito, tipo de audiencia, día y hora. <strong>No trae el número de la causa ni las partes</strong>; tu audiencia se reconoce por el delito y la hora.</p>' +
                    '<div class="estp-campos">' +
                        `<label class="estp-campo">Juzgado<select id="estp-juzgado"><option value="">Elige el juzgado…</option>${opciones}</select></label>` +
                        `<label class="estp-campo">A partir del<input type="date" id="estp-fecha" value="${esc(hoy)}"></label>` +
                    '</div>' +
                    '<div id="estp-estrados-juzgado"></div>' +
                '</section>' +
            '</div>';
        $('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>' +
            '<button class="btn btn-secondary" id="estp-agenda" type="button">📅 Abrir la agenda</button>' +
            '<button class="btn btn-primary" id="estp-todas" type="button">🔍 Buscar en las salas penales</button>';

        const pintarSalas = () => {
            const v = $('estp-valor').value;
            const todas = busquedasEnSalas(v, tipo);
            $('estp-salas').innerHTML = todas.filter(b => !b.anterior).map(enlace).join('') ||
                '<p class="estp-nota">Escribe el número de la causa.</p>';
            $('estp-anteriores').innerHTML = todas.filter(b => b.anterior).map(enlace).join('');
            $('estp-todas').disabled = !todas.length;
            const j = $('estp-juzgado').value;
            const propio = urlEstradosJuzgado(j, tipo, v);
            $('estp-estrados-juzgado').innerHTML = propio
                ? `<p class="estp-nota">Este juzgado sí aparece en los estrados electrónicos, aunque no se han visto publicaciones: <a href="${esc(propio)}" target="_blank" rel="noopener">🌐 Buscar en sus estrados</a></p>`
                : '';
            $('estp-agenda').disabled = !j;
        };
        $('estp-valor').addEventListener('input', pintarSalas);
        $('estp-juzgado').addEventListener('change', pintarSalas);

        $('estp-todas').addEventListener('click', () => {
            const actuales = busquedasEnSalas($('estp-valor').value, tipo, { soloActuales: true });
            if (!actuales.length) return;
            let espera = 0;
            for (const b of actuales) {
                setTimeout(() => {
                    if (typeof abrirBusquedaPopup === 'function') abrirBusquedaPopup(b.url, `${causaDe($('estp-valor').value)} en ${b.nombre}`);
                    else window.open(b.url, '_blank', 'noopener');
                }, espera);
                espera += 600;
            }
            if (typeof mostrarToast === 'function') mostrarToast(`Buscando en ${actuales.length} salas penales…`, 'info');
        });
        $('estp-agenda').addEventListener('click', () => {
            const url = urlAgenda($('estp-juzgado').value, $('estp-fecha').value);
            if (url) window.open(url, '_blank', 'noopener');
        });

        pintarSalas();
        if (typeof abrirModal === 'function') abrirModal(); else $('modal-overlay').classList.add('active');
    }

    /** Desde el botón de un expediente (también del archivo). */
    async function abrirDeExpediente(id, event) {
        if (event) { event.stopPropagation(); event.preventDefault(); }
        let exp = null;
        try {
            const todos = (await obtenerExpedientes()).concat(typeof obtenerExpedientesArchivados === 'function' ? await obtenerExpedientesArchivados() : []);
            exp = todos.find(e => e.id === id) || null;
        } catch (e) { /* sin base */ }
        if (!exp) {
            if (typeof mostrarToast === 'function') mostrarToast('El expediente ya no está disponible', 'warning');
            return;
        }
        abrir({ valor: exp.numero || exp.nombre, tipo: exp.numero ? 'numero' : 'nombre', juzgado: juzgadoPenalDeExpediente(exp) || '' });
    }

    global.ESTRADOS_PENALES = { ...Motor, abrir, abrirDeExpediente };
})(typeof window !== 'undefined' ? window : globalThis);
