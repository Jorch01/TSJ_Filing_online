/**
 * "Recomiéndala a un colega": entre abogados, el boca a boca pesa más que
 * cualquier buscador.
 *
 * - En el celular abre el menú de compartir del teléfono (WhatsApp, correo,
 *   Telegram…); en la computadora, una ventanita con WhatsApp, copiar el
 *   enlace o correo.
 * - Se ofrece UNA sola vez sin que se pida: después de guardar el primer
 *   expediente, que es cuando ya se vio para qué sirve. Si hay un recorrido
 *   en curso, espera a la siguiente ocasión.
 * - Los enlaces llevan utm_* para que las estadísticas distingan a quien
 *   llega por recomendación.
 */
(function () {
    'use strict';

    const SITIO = 'https://tsjia.empirica.mx/';
    const CLAVE_OFRECIDO = 'recomendar_ofrecido';
    const medir = (e, p) => { if (typeof window.medir === 'function') window.medir(e, p); };

    const MENSAJES = {
        general: {
            titulo: 'TSJ Filing Online',
            texto: 'Te recomiendo TSJ Filing Online: estrados del TSJ de Quintana Roo y del PJF, agenda de audiencias, IA que lee los acuerdos y calculadora de finiquito. Gratis y sin registro.',
            ruta: ''
        },
        calculadora: {
            titulo: 'Calculadora de finiquito y liquidación 2026',
            texto: 'Mira esta calculadora de finiquito y liquidación 2026 (LFT): cada concepto con su fórmula y su artículo, e ISR estimado.',
            ruta: 'calculadora-finiquito-liquidacion/'
        }
    };

    function enlace(tipo, canal) {
        const m = MENSAJES[tipo] || MENSAJES.general;
        return `${SITIO}${m.ruta}?utm_source=recomendacion&utm_medium=${canal}&utm_campaign=colega`;
    }

    function textoCompleto(tipo, canal) {
        const m = MENSAJES[tipo] || MENSAJES.general;
        return `${m.texto} ${enlace(tipo, canal)}`;
    }

    // El menú de compartir del sistema solo en pantallas táctiles: en la
    // computadora suele ofrecer pocas opciones y sin WhatsApp.
    function usarCompartirNativo() {
        return typeof navigator.share === 'function' &&
            window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    }

    async function recomendarApp(origen = 'menu', tipo = 'general') {
        cerrarOfertaRecomendar(false);
        if (usarCompartirNativo()) {
            const m = MENSAJES[tipo] || MENSAJES.general;
            try {
                await navigator.share({ title: m.titulo, text: m.texto, url: enlace(tipo, 'nativo') });
                medir('compartir', { canal: 'nativo', origen });
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;   // lo cerró: no insistir
            }
        }
        mostrarModalRecomendar(origen, tipo);
    }

    function mostrarModalRecomendar(origen, tipo) {
        cerrarModalRecomendar();
        const fondo = document.createElement('div');
        fondo.id = 'modal-recomendar';
        fondo.className = 'inst-fondo';
        const wa = 'https://wa.me/?text=' + encodeURIComponent(textoCompleto(tipo, 'whatsapp'));
        const m = MENSAJES[tipo] || MENSAJES.general;
        const correo = 'mailto:?subject=' + encodeURIComponent(m.titulo) + '&body=' + encodeURIComponent(textoCompleto(tipo, 'correo'));
        fondo.innerHTML = `
            <div class="inst-modal" role="dialog" aria-modal="true" aria-labelledby="rec-titulo">
                <button type="button" class="tour-cerrar" aria-label="Cerrar" onclick="cerrarModalRecomendar()">✕</button>
                <h3 id="rec-titulo">🤝 Recomiéndala a un colega</h3>
                <p class="rec-mensaje">${m.texto}</p>
                <div class="rec-opciones">
                    <a class="btn rec-whatsapp" href="${wa}" target="_blank" rel="noopener" data-canal="whatsapp">💬 WhatsApp</a>
                    <button type="button" class="btn btn-secondary" data-canal="copiar">🔗 Copiar enlace</button>
                    <a class="btn btn-secondary" href="${correo}" data-canal="correo">✉️ Correo</a>
                </div>
            </div>`;
        fondo.addEventListener('click', async (e) => {
            if (e.target === fondo) { cerrarModalRecomendar(); return; }
            const opcion = e.target.closest('[data-canal]');
            if (!opcion) return;
            const canal = opcion.dataset.canal;
            medir('compartir', { canal, origen });
            if (canal === 'copiar') {
                try {
                    await navigator.clipboard.writeText(textoCompleto(tipo, 'copiar'));
                    if (typeof mostrarToast === 'function') mostrarToast('Enlace copiado: pégalo donde quieras', 'success');
                    else opcion.textContent = '✓ Copiado';
                } catch (err) {
                    if (typeof mostrarToast === 'function') mostrarToast('No se pudo copiar', 'error');
                }
            }
            if (canal !== 'copiar') setTimeout(cerrarModalRecomendar, 300);
        });
        document.body.appendChild(fondo);
    }

    function cerrarModalRecomendar() {
        document.getElementById('modal-recomendar')?.remove();
    }

    // ==================== LA OFERTA, UNA SOLA VEZ ====================

    function yaOfrecido() {
        try { return localStorage.getItem(CLAVE_OFRECIDO) === '1'; } catch (e) { return true; }
    }

    function ofrecerRecomendar() {
        if (yaOfrecido() || document.getElementById('rec-oferta')) return;
        // No encima de un recorrido o de otra tarjeta: ya habrá otra ocasión.
        if (document.querySelector('.tour-tarjeta, #tour-oferta, #modal-instalar, .modal-overlay.active')) return;
        try { localStorage.setItem(CLAVE_OFRECIDO, '1'); } catch (e) { /* sin almacenamiento */ }
        medir('recomendar_oferta');
        const oferta = document.createElement('div');
        oferta.id = 'rec-oferta';
        oferta.setAttribute('role', 'dialog');
        oferta.setAttribute('aria-label', 'Recomendar a un colega');
        oferta.innerHTML = `
            <button type="button" class="tour-cerrar" aria-label="Cerrar" onclick="cerrarOfertaRecomendar(true)">✕</button>
            <strong>🤝 ¿Le serviría a un colega?</strong>
            <p>Si conoces a alguien que litigue en Quintana Roo, compártele TSJ Filing. Es gratis.</p>
            <div class="tour-botones">
                <button type="button" class="btn btn-sm btn-secondary" onclick="cerrarOfertaRecomendar(true)">Ahora no</button>
                <button type="button" class="btn btn-sm btn-primary" onclick="recomendarApp('primer_expediente')">Recomendar</button>
            </div>`;
        document.body.appendChild(oferta);
    }

    function cerrarOfertaRecomendar(rechazada) {
        const oferta = document.getElementById('rec-oferta');
        if (!oferta) return;
        oferta.remove();
        if (rechazada) medir('recomendar_oferta_cerrada');
    }

    // Tras el primer expediente guardado. Se envuelve la función de alta de
    // la base de datos, por donde pasan todos: a mano, con IA o importados.
    window.addEventListener('load', () => {
        setTimeout(() => {
            const original = window.agregarExpediente;
            if (typeof original !== 'function' || yaOfrecido()) return;
            window.agregarExpediente = function (...args) {
                const r = original.apply(this, args);
                Promise.resolve(r).then(() => setTimeout(ofrecerRecomendar, 2500), () => {});
                return r;
            };
        }, 0);
    });

    Object.assign(window, {
        recomendarApp, mostrarModalRecomendar, cerrarModalRecomendar,
        ofrecerRecomendar, cerrarOfertaRecomendar, _textoRecomendacion: textoCompleto
    });
})();
