/**
 * Calculadora pública de plazos de una marca (página
 * /calculadora-declaracion-uso-renovacion-marca/): la declaración de uso a los
 * tres años y la renovación, con su periodo de gracia.
 *
 * El cálculo es el de la cartera de marcas de la app (CARTERA_MARCAS.plazosDe,
 * en cartera-marcas.js): un solo motor para los dos lados, así que lo que dice
 * esta página y lo que avisa la app no pueden diferir.
 *
 * Nada de lo que se escribe aquí sale del navegador. La analítica solo cuenta
 * que se hizo un cálculo (calcularPlazosMarca, en analitica.js).
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ESTADO = { en_curso: 'En curso', vencido: 'Ya pasó', proximo: 'Empieza pronto', futuro: 'Por venir' };

    function corta(f) {
        return f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : '';
    }

    function hoyTexto() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    /**
     * Calcula los plazos con las fechas del formulario. Devuelve
     * { plazos, notas } o null si falta lo mínimo. Es global para que la
     * analítica cuente el cálculo (una vez por visita).
     */
    function calcularPlazosMarca(entrada) {
        const C = window.CARTERA_MARCAS;
        if (!C || typeof C.plazosDe !== 'function') return null;
        const e = entrada || leer();
        const conc = C.fecha(e.concesion), pres = C.fecha(e.presentacion), vig = C.fecha(e.vigencia);
        if (!conc && !vig && !pres) return null;
        const hoy = e.hoy || hoyTexto();
        const marca = { denominacion: 'Tu marca', registro: '1', estatus: 'REGISTRADA', fechaConcesion: conc, fechaPresentacion: pres, vigencia: vig };
        // La declaración, la renovación y su periodo de gracia; vencida la
        // renovación, queda la gracia (que es la misma renovación, tardía).
        const plazos = C.plazosDe(marca, hoy).filter(p => !(p.tipo === 'renovacion' && p.estado === 'vencido'));
        const notas = [];
        if (!conc) notas.push({ tipo: 'falta', texto: 'Para la declaración de uso hace falta la fecha en que se otorgó el registro.' });
        else if (conc < C.DECLARACION_USO_DESDE) {
            notas.push({ tipo: 'no_aplica', texto: 'Registro otorgado antes del 10 de agosto de 2018: no presenta la declaración de uso a los tres años (LFPPI, transitorio décimo primero). Al renovar sí se declara el uso (art. 237).' });
        }
        const ren = plazos.find(p => p.tipo === 'renovacion' || p.tipo === 'gracia');
        if (vig) notas.push({ tipo: 'vigencia', texto: 'La renovación se calculó con el fin de vigencia que escribiste.' });
        else if (ren) {
            notas.push({ tipo: 'vigencia', texto: pres && pres < C.INICIO_LFPPI
                ? 'Vigencia estimada: diez años desde la presentación de la solicitud, porque se presentó antes del 5 de noviembre de 2020 (ley anterior, art. 95). Confírmala en el título o en Marcanet.'
                : 'Vigencia estimada: diez años desde el otorgamiento (LFPPI, art. 178)' + (pres ? '' : '; si la solicitud se presentó antes del 5 de noviembre de 2020, se cuenta desde la presentación') + '. Confírmala en el título o en Marcanet.' });
        } else if (conc || pres) {
            notas.push({ tipo: 'falta', texto: 'Para la renovación hace falta el fin de la vigencia (viene en el título y en Marcanet) o la fecha de presentación de la solicitud.' });
        }
        return { plazos, notas, hoy };
    }

    function leer() {
        return {
            concesion: ($('pm-concesion') || {}).value || '',
            presentacion: ($('pm-presentacion') || {}).value || '',
            vigencia: ($('pm-vigencia') || {}).value || ''
        };
    }

    function mensajeAyuda(p) {
        const que = p.tipo === 'uso' ? 'la declaración de uso' : 'la renovación';
        return 'Hola, Empírica Legal Lab. Usé la calculadora de plazos de marca: ' + que + ' de mi marca va del ' + corta(p.desde) + ' al ' + corta(p.hasta) +
            (p.estimado ? ' (fecha estimada)' : '') + '. Quiero ayuda para presentarla.';
    }

    function pintar() {
        const caja = $('pm-resultado');
        if (!caja) return;
        // Por el nombre global: así la analítica cuenta el cálculo.
        const r = window.calcularPlazosMarca(leer());
        if (!r) {
            caja.innerHTML = '<p class="pm-vacio">Escribe la fecha en que se otorgó el registro (y, si la tienes, la de presentación o el fin de la vigencia).</p>';
            return;
        }
        const whatsapp = ($('pm-form') && $('pm-form').dataset.whatsapp) || '';
        const fila = p => {
            const titulo = p.tipo === 'uso' ? 'Declaración de uso' : p.tipo === 'gracia' ? 'Renovación con periodo de gracia' : 'Renovación';
            const consecuencia = p.estado === 'vencido'
                ? (p.tipo === 'uso' ? 'Si no se presentó, el registro caducó de pleno derecho (art. 233).' : p.tipo === 'gracia' ? 'Si no se pidió la renovación, el registro caducó de pleno derecho (art. 238).' : 'Aún puede pedirse en el periodo de gracia.')
                : '';
            const ayuda = whatsapp && p.estado !== 'vencido'
                ? '<a class="btn btn-sm btn-secondary" href="https://wa.me/' + esc(whatsapp) + '?text=' + esc(encodeURIComponent(mensajeAyuda(p))) + '" target="_blank" rel="noopener" data-medir="servicio_sitio" data-medir-origen="' +
                  (p.tipo === 'uso' ? 'declaracion_uso' : 'renovacion') + '">🤝 ¿Te ayudamos a ' + (p.tipo === 'uso' ? 'presentarla' : 'renovarla') + '?</a>'
                : '';
            return '<li class="pm-plazo pm-' + esc(p.estado) + '"><div><strong>' + esc(titulo) + '</strong> <span class="pm-estado">' + esc(ESTADO[p.estado] || '') + '</span>' +
                '<span class="pm-fechas">Del ' + esc(corta(p.desde)) + ' al ' + esc(corta(p.hasta)) + (p.estimado ? ' · fecha estimada' : '') + '</span>' +
                (consecuencia ? '<small>' + esc(consecuencia) + '</small>' : '') + '</div>' + ayuda + '</li>';
        };
        caja.innerHTML =
            (r.plazos.length ? '<ul class="pm-plazos">' + r.plazos.map(fila).join('') + '</ul>' : '') +
            (r.notas.length ? '<ul class="pm-notas">' + r.notas.map(n => '<li>' + esc(n.texto) + '</li>').join('') + '</ul>' : '') +
            '<p class="pm-hoy">Calculado al ' + esc(corta(r.hoy)) + '. Cada renovación da otros diez años de vigencia, con su propia ventana de renovación.</p>';
    }

    function preparar() {
        const form = $('pm-form');
        if (!form) return;
        form.addEventListener('input', pintar);
        form.addEventListener('submit', (e) => { e.preventDefault(); pintar(); });
        pintar();
    }

    window.calcularPlazosMarca = calcularPlazosMarca;
    window.prepararPlazosMarca = preparar;
})();
