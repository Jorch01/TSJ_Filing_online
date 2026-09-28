/**
 * Instalar la app en la pantalla de inicio del celular (o como app de
 * escritorio): un ícono que la abre directo, a pantalla completa y sin la
 * barra del navegador.
 *
 * Cada plataforma lo hace distinto:
 *  - Android / Chrome / Edge: el navegador avisa que se puede instalar
 *    (evento `beforeinstallprompt`); lo guardamos y el botón "Instalar" abre
 *    su ventana nativa, un solo toque.
 *  - iPhone / iPad: no hay ventana que abrir. Solo se puede desde el botón
 *    Compartir de Safari → "Agregar a pantalla de inicio", así que se enseña
 *    paso a paso, con los mismos íconos que verá en su pantalla.
 *  - Otros navegadores: se enseña el menú correspondiente.
 */
(function () {
    'use strict';

    let promptDiferido = null;
    const medir = (e, p) => { if (typeof window.medir === 'function') window.medir(e, p); };

    window.addEventListener('beforeinstallprompt', (e) => {
        // Sin esto Chrome muestra su propia barrita; la instalación la
        // ofrecemos nosotros, en el momento en que tiene sentido.
        e.preventDefault();
        promptDiferido = e;
        document.documentElement.classList.add('instalable');
    });

    window.addEventListener('appinstalled', () => {
        medir('app_instalada', { plataforma: plataformaInstalacion() });
        promptDiferido = null;
        document.documentElement.classList.remove('instalable');
        try { localStorage.setItem('app_instalada', '1'); } catch (e) { /* sin almacenamiento */ }
        cerrarModalInstalar();
        if (typeof mostrarToast === 'function') mostrarToast('¡Listo! Ya tienes TSJ Filing en tu pantalla de inicio 📲', 'success');
    });

    /** ¿Se está usando ya como app instalada (abierta desde el ícono)? */
    function estaInstalada() {
        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            window.navigator.standalone === true;
    }

    /** 'ios-safari' | 'ios-otro' | 'android' | 'escritorio' */
    function plataformaInstalacion() {
        const ua = navigator.userAgent || '';
        // iPadOS se presenta como Mac; se reconoce por la pantalla táctil.
        const esIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
        if (esIOS) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-otro' : 'ios-safari';
        if (/Android/.test(ua)) return 'android';
        return 'escritorio';
    }

    // Íconos dibujados como los del sistema, para reconocerlos en pantalla.
    const ICONO_COMPARTIR = '<svg class="inst-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const ICONO_AGREGAR = '<svg class="inst-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const ICONO_MENU = '<svg class="inst-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>';

    function pasos(lista) {
        return '<ol class="inst-pasos">' + lista.map(p => `<li>${p}</li>`).join('') + '</ol>';
    }

    /**
     * Instrucciones para la plataforma actual. `compacto` es para la tarjeta
     * del recorrido guiado; sin él, para el modal.
     */
    function instruccionesInstalacionHTML(compacto) {
        if (estaInstalada()) {
            return '<p class="inst-ok">✅ Ya la estás usando como app instalada. Ábrela siempre desde su ícono.</p>';
        }
        const plat = plataformaInstalacion();
        const icono = '<img class="inst-app" src="icons/icono-192.png" alt="" width="28" height="28">';
        let html = '';
        if (promptDiferido) {
            html += `<button type="button" class="btn btn-primary inst-boton" onclick="instalarApp()">📲 Instalar la app</button>`;
            html += `<p class="inst-nota">Queda un ícono ${icono} en tu ${plat === 'escritorio' ? 'computadora' : 'pantalla de inicio'} que la abre directo, a pantalla completa.</p>`;
            return html;
        }
        if (plat === 'ios-safari') {
            html += pasos([
                `Toca el botón <strong>Compartir</strong> ${ICONO_COMPARTIR} en la barra de Safari (abajo en el iPhone, arriba en el iPad).`,
                `Desliza y elige <strong>Agregar a pantalla de inicio</strong> ${ICONO_AGREGAR}.`,
                `Toca <strong>Agregar</strong>. Aparecerá el ícono ${icono} <strong>TSJ Filing</strong> junto a tus apps.`
            ]);
        } else if (plat === 'ios-otro') {
            html += pasos([
                `Toca <strong>Compartir</strong> ${ICONO_COMPARTIR} (en Chrome está junto a la barra de direcciones).`,
                `Elige <strong>Agregar a pantalla de inicio</strong> ${ICONO_AGREGAR}.`,
                `Si no aparece, abre <strong>tsjia.empirica.mx/docs</strong> en <strong>Safari</strong> y hazlo desde ahí.`
            ]);
        } else if (plat === 'android') {
            html += pasos([
                `Toca el menú ${ICONO_MENU} del navegador (arriba a la derecha).`,
                `Elige <strong>Instalar app</strong> o <strong>Agregar a pantalla principal</strong>.`,
                `Confirma con <strong>Instalar</strong>. El ícono ${icono} queda con tus apps.`
            ]);
        } else {
            html += pasos([
                `En Chrome o Edge, toca el ícono de instalar <strong>⊕</strong> al final de la barra de direcciones, o el menú ${ICONO_MENU} → <strong>Instalar TSJ Filing</strong>.`,
                `En el celular, abre <strong>tsjia.empirica.mx/docs</strong> y sigue los pasos que te aparecerán ahí.`
            ]);
        }
        if (!compacto) {
            html += `<p class="inst-nota">Así la abres con un toque, a pantalla completa y funciona aunque no haya señal.</p>`;
        }
        return html;
    }

    async function instalarApp() {
        if (promptDiferido) {
            const evento = promptDiferido;
            promptDiferido = null;
            evento.prompt();
            try {
                const { outcome } = await evento.userChoice;
                medir('instalar_ventana', { respuesta: outcome === 'accepted' ? 'aceptada' : 'rechazada' });
                if (outcome !== 'accepted' && typeof mostrarToast === 'function') {
                    mostrarToast('Cuando quieras, la instalas desde 🧭 → Instalar en tu celular', 'info');
                }
            } catch (e) { /* el navegador cerró la ventana */ }
            document.documentElement.classList.remove('instalable');
            return;
        }
        mostrarModalInstalar();
    }

    function mostrarModalInstalar() {
        medir('instalar_instrucciones', { plataforma: plataformaInstalacion() });
        cerrarModalInstalar();
        const fondo = document.createElement('div');
        fondo.id = 'modal-instalar';
        fondo.className = 'inst-fondo';
        fondo.innerHTML = `
            <div class="inst-modal" role="dialog" aria-modal="true" aria-labelledby="inst-titulo">
                <button type="button" class="tour-cerrar" aria-label="Cerrar" onclick="cerrarModalInstalar()">✕</button>
                <h3 id="inst-titulo">📲 Tenla a un toque en tu celular</h3>
                ${instruccionesInstalacionHTML(false)}
            </div>`;
        fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrarModalInstalar(); });
        document.body.appendChild(fondo);
    }

    function cerrarModalInstalar() {
        document.getElementById('modal-instalar')?.remove();
    }

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModalInstalar(); });

    // Instalada, el botón "Instalar" del menú sobra.
    const marcarInstalada = () => document.documentElement.classList.toggle('app-instalada', estaInstalada());
    marcarInstalada();
    window.matchMedia && window.matchMedia('(display-mode: standalone)').addEventListener?.('change', marcarInstalada);

    Object.assign(window, {
        estaInstalada, plataformaInstalacion, instruccionesInstalacionHTML,
        instalarApp, mostrarModalInstalar, cerrarModalInstalar,
        hayInstalacionNativa: () => !!promptDiferido
    });
})();
