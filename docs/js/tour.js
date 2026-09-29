/**
 * Recorridos guiados.
 *
 * Nada invasivo:
 *  - A quien entra por primera vez (sin expedientes) se le OFRECE, en una
 *    tarjeta pequeña en una esquina, ver cómo empezar. No se abre solo.
 *  - Durante el recorrido la página sigue usable: el resaltado solo oscurece
 *    alrededor, no bloquea clics. Esc o ✕ lo cierran en cualquier momento.
 *  - Después queda el botón 🧭 con los demás recorridos, para cuando se quiera.
 *
 * Cada paso puede llevar a una página (`antes`) y señalar un elemento
 * (`objetivo`, un selector). Si el elemento no está a la vista, la tarjeta
 * sale centrada: un recorrido nunca se atora por un botón que no existe.
 */
(function () {
    'use strict';

    const CLAVE_VISTO = 'tour_bienvenida_visto';
    const pausa = (ms) => new Promise(res => setTimeout(res, ms));
    const medir = (e, p) => { if (typeof window.medir === 'function') window.medir(e, p); };

    function ir(pagina, despues) {
        return async () => {
            if (typeof navegarA === 'function') navegarA(pagina);
            if (despues) despues();
            await pausa(250);
        };
    }

    async function hayClaveIA() {
        try { return !!(typeof obtenerConfig === 'function' && await obtenerConfig('ia_api_key')); }
        catch (e) { return false; }
    }

    const instalada = () => typeof estaInstalada === 'function' && estaInstalada();
    const instrucciones = () => typeof instruccionesInstalacionHTML === 'function'
        ? instruccionesInstalacionHTML(true) : '';

    const RECORRIDOS = {
        instalar: {
            icono: '📲',
            titulo: 'Instalar en tu celular',
            duracion: '20 s',
            pasos: [
                {
                    titulo: '📲 Tenla a un toque en tu celular',
                    texto: 'Agrega TSJ Filing a tu pantalla de inicio: se abre con un toque, a pantalla completa y funciona aunque no haya señal.',
                    contenido: instrucciones
                }
            ]
        },
        primerosPasos: {
            icono: '🚀',
            titulo: 'Tu primer expediente con IA',
            duracion: '1 min',
            pasos: [
                {
                    titulo: '👋 Bienvenido a TSJ Filing Online',
                    texto: 'En un minuto: primero dejas la app a un toque en tu celular y luego das de alta tu primer expediente con la IA. Puedes salir cuando quieras con ✕ o Esc.'
                },
                {
                    // Lo primero: sin el ícono en la pantalla de inicio, la
                    // app se pierde entre las pestañas del navegador.
                    saltarSi: async () => instalada(),
                    titulo: '📲 Antes que nada: tenla a un toque',
                    texto: 'Agrégala a la pantalla de inicio de tu celular: se abre con un toque, a pantalla completa y sin internet.',
                    contenido: instrucciones
                },
                {
                    antes: ir('busqueda', () => typeof cambiarTabTSJ === 'function' && cambiarTabTSJ('ia')),
                    objetivo: '#tsj-tab-ia .card',
                    titulo: '1. Pega o fotografía el acuerdo',
                    texto: 'Copia el texto del acuerdo desde los estrados, o toma una foto con 📸. La IA encuentra el número de expediente, el juzgado, las audiencias y los plazos.'
                },
                {
                    saltarSi: hayClaveIA,
                    antes: ir('config'),
                    objetivo: '#ia-api-key',
                    titulo: '2. Una sola vez: tu clave gratuita de IA',
                    texto: 'La IA usa Gemini de Google. Crea tu clave gratis en aistudio.google.com/apikey y pégala aquí. Se guarda solo en tu dispositivo.'
                },
                {
                    antes: ir('busqueda', () => typeof cambiarTabTSJ === 'function' && cambiarTabTSJ('ia')),
                    objetivo: '#btn-analizar-ia',
                    titulo: '3. Analiza y guarda todo',
                    texto: 'Pulsa "Analizar con IA". Revisa lo que encontró y con "💾 Guardar Todo" se crean el expediente, sus audiencias en el calendario y sus notas.'
                },
                {
                    antes: ir('expedientes'),
                    objetivo: '#page-expedientes .page-header .btn-primary',
                    titulo: '¿Prefieres capturarlo tú?',
                    texto: 'Con "➕ Nuevo Expediente" lo das de alta en segundos: número, juzgado y listo. También puedes importar muchos a la vez con el template.'
                },
                {
                    antes: ir('inicio'),
                    objetivo: '.stats-grid',
                    titulo: 'Tu día de un vistazo',
                    texto: 'Aquí ves tus pendientes, próximas audiencias, expedientes y notas. Toca cualquier tarjeta para ver el detalle sin cambiar de página.'
                },
                {
                    objetivo: '#voz-fab',
                    titulo: 'O simplemente díctalo',
                    texto: 'El asistente entiende cosas como "agenda audiencia del 120/2026 el martes a las 10", "¿qué tengo esta semana?" o "calcula la liquidación de un trabajador que ganaba 12 mil al mes".'
                },
                {
                    objetivo: '#tour-fab',
                    titulo: '¡Listo para empezar!',
                    texto: 'Cuando quieras conocer más (estrados, agenda, calculadora laboral, marcas IMPI…), aquí tienes otros recorridos cortos.'
                }
            ]
        },
        estrados: {
            icono: '⚖️',
            titulo: 'Estrados del TSJ y del PJF',
            duracion: '40 s',
            pasos: [
                {
                    antes: ir('busqueda', () => typeof cambiarTabTSJ === 'function' && cambiarTabTSJ('busqueda')),
                    objetivo: '#tsj-tab-busqueda .card',
                    titulo: 'Consulta un expediente del TSJ',
                    texto: 'Elige el juzgado o la sala de Quintana Roo, escribe el número o el nombre y se abren sus estrados electrónicos. "Buscar y Guardar" además lo agrega a tus expedientes.'
                },
                {
                    antes: ir('busqueda', () => typeof cambiarTabTSJ === 'function' && cambiarTabTSJ('expedientes')),
                    objetivo: '#btn-toggle-seleccion-tsj',
                    titulo: 'Revisa varios a la vez',
                    texto: 'En "Expedientes TSJ", la selección masiva abre los estrados de todos los que marques, uno tras otro.'
                },
                {
                    objetivo: '#page-busqueda .tribunal-selector',
                    titulo: 'Y lo federal, en el mismo lugar',
                    texto: 'Cambia a "PJF Federal" para consultar expedientes de los juzgados de distrito y tribunales colegiados del Vigésimo Séptimo Circuito (Quintana Roo) y de todo el país.'
                }
            ]
        },
        agenda: {
            icono: '📅',
            titulo: 'Agenda, audiencias y pendientes',
            duracion: '40 s',
            pasos: [
                {
                    antes: ir('calendario'),
                    objetivo: '.calendario-container',
                    titulo: 'Tu calendario de audiencias',
                    texto: 'Toca un día para ver o agregar eventos. Los días inhábiles del TSJ ya vienen marcados.'
                },
                {
                    objetivo: '#filtro-tribunal-calendario',
                    titulo: 'Filtra por tribunal',
                    texto: 'Muestra solo lo del TSJ o solo lo federal cuando lo necesites.'
                },
                {
                    antes: ir('pendientes'),
                    objetivo: '#page-pendientes .page-header .btn-primary',
                    titulo: 'Pendientes con fecha límite',
                    texto: 'Cada pendiente se liga a su expediente; si le pones fecha, aparece también en el calendario.'
                }
            ]
        },
        laboral: {
            icono: '🧮',
            titulo: 'Calculadora de finiquito y liquidación',
            duracion: '40 s',
            pasos: [
                {
                    antes: ir('laboral'),
                    objetivo: '#lab-supuesto',
                    titulo: 'Elige cómo terminó la relación',
                    texto: 'Renuncia, despido justificado o injustificado, rescisión, cierre, incapacidad o muerte: cada supuesto aplica lo que marca la Ley Federal del Trabajo.'
                },
                {
                    objetivo: '#lab-ingreso',
                    titulo: 'Fechas y salario',
                    texto: 'Con la fecha de ingreso, la de terminación y el salario ya tienes el cálculo. Lo demás (vacaciones pendientes, prestaciones superiores) es opcional.'
                },
                {
                    objetivo: '.lab-resultado-card',
                    titulo: 'Cada peso, con su artículo',
                    texto: 'Verás cada concepto con su fórmula y fundamento, el ISR estimado y el neto. Guárdalo como nota en el expediente, cópialo o imprímelo.'
                },
                {
                    objetivo: '#voz-fab',
                    titulo: 'También se lo puedes pedir al asistente',
                    texto: 'Dile "calcula el finiquito de alguien que renunció hoy y ganaba 9,500 a la quincena". Si le falta un dato (cómo terminó, fechas, salario) te lo pregunta hasta poder calcular, y luego puedes ajustarlo: "¿y si el juicio duró 8 meses?".'
                }
            ]
        },
        impi: {
            icono: '🔰',
            titulo: 'Marcas y gacetas del IMPI',
            duracion: '30 s',
            pasos: [
                {
                    antes: ir('impi'),
                    objetivo: '.impi-tabs',
                    titulo: 'Busca marcas registradas',
                    texto: 'MARCia busca por denominación, titular o clase de Niza; SIGA revisa las gacetas del IMPI.'
                },
                {
                    objetivo: '#marcia-query',
                    titulo: 'Escribe la marca',
                    texto: 'Consulta antes de registrar o para vigilar marcas parecidas a las de tus clientes. Guarda búsquedas de SIGA y la app te avisa de publicaciones nuevas.'
                }
            ]
        },
        datos: {
            icono: '📴',
            titulo: 'Sin internet y tus datos',
            duracion: '20 s',
            pasos: [
                {
                    titulo: 'Funciona sin señal',
                    texto: 'Después de abrirla una vez, la app abre aunque no haya internet (en el juzgado, por ejemplo): tus expedientes, agenda y notas están en tu dispositivo.'
                },
                {
                    antes: ir('config'),
                    objetivo: '#sync-section',
                    titulo: 'Respaldo y varios dispositivos',
                    texto: 'Tus datos son tuyos y viven en tu navegador. Desde Configuración puedes exportar un respaldo o sincronizar entre computadora y celular.'
                }
            ]
        }
    };

    // ==================== MOTOR DEL RECORRIDO ====================

    let actual = null;          // { clave, indice }
    let elResaltado = null;
    let elTarjeta = null;

    function crearCapas() {
        if (elTarjeta) return;
        elResaltado = document.createElement('div');
        elResaltado.className = 'tour-resaltado';
        elResaltado.setAttribute('aria-hidden', 'true');
        elTarjeta = document.createElement('div');
        elTarjeta.className = 'tour-tarjeta';
        elTarjeta.setAttribute('role', 'dialog');
        elTarjeta.setAttribute('aria-live', 'polite');
        document.body.append(elResaltado, elTarjeta);
        window.addEventListener('resize', posicionar);
        window.addEventListener('scroll', posicionar, true);
    }

    function quitarCapas() {
        elResaltado?.remove();
        elTarjeta?.remove();
        elResaltado = elTarjeta = null;
        window.removeEventListener('resize', posicionar);
        window.removeEventListener('scroll', posicionar, true);
    }

    function objetivoVisible(sel) {
        if (!sel) return null;
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? el : null;
    }

    function posicionar() {
        if (!actual || !elTarjeta) return;
        const paso = RECORRIDOS[actual.clave].pasos[actual.indice];
        const el = objetivoVisible(paso.objetivo);
        const margen = 12;
        const vw = document.documentElement.clientWidth;
        const vh = window.innerHeight;
        const t = elTarjeta.getBoundingClientRect();

        if (!el) {
            elResaltado.classList.add('sin-objetivo');
            elTarjeta.classList.add('centrada');
            elTarjeta.style.left = Math.max(margen, (vw - t.width) / 2) + 'px';
            elTarjeta.style.top = Math.max(margen, (vh - t.height) / 2) + 'px';
            return;
        }
        elResaltado.classList.remove('sin-objetivo');
        elTarjeta.classList.remove('centrada');
        const r = el.getBoundingClientRect();
        const pad = 6;
        Object.assign(elResaltado.style, {
            left: (r.left - pad) + 'px', top: (r.top - pad) + 'px',
            width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px'
        });
        // Debajo si cabe; si no, arriba; si tampoco, pegada abajo de la pantalla.
        let top = r.bottom + margen;
        if (top + t.height > vh - margen) top = r.top - t.height - margen;
        if (top < margen) top = vh - t.height - margen;
        let left = r.left + r.width / 2 - t.width / 2;
        left = Math.min(Math.max(margen, left), vw - t.width - margen);
        elTarjeta.style.left = left + 'px';
        elTarjeta.style.top = Math.max(margen, top) + 'px';
    }

    function escapar(t) {
        return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    async function mostrarPaso(indice, direccion = 1) {
        const recorrido = RECORRIDOS[actual.clave];
        // Pasos que no aplican (p. ej. la clave de IA ya está puesta) se saltan.
        while (indice >= 0 && indice < recorrido.pasos.length &&
               recorrido.pasos[indice].saltarSi && await recorrido.pasos[indice].saltarSi()) {
            indice += direccion;
        }
        if (indice < 0) indice = 0;
        if (indice >= recorrido.pasos.length) { terminarTour(true); return; }
        actual.indice = indice;
        const paso = recorrido.pasos[indice];
        if (paso.antes) await paso.antes();
        if (!actual) return;   // se cerró mientras navegaba

        const el = objetivoVisible(paso.objetivo);
        if (el) {
            el.scrollIntoView({ block: 'center' });
            await pausa(60);
        }
        const total = recorrido.pasos.length;
        const ultimo = indice === total - 1;
        elTarjeta.innerHTML = `
            <button type="button" class="tour-cerrar" aria-label="Cerrar recorrido" onclick="terminarTour()">✕</button>
            <div class="tour-progreso">${recorrido.icono} ${escapar(recorrido.titulo)} · ${indice + 1} de ${total}</div>
            <h4 class="tour-titulo">${escapar(paso.titulo)}</h4>
            ${paso.contenido
                ? `<p class="tour-texto">${escapar(paso.texto)}</p><div class="tour-contenido">${paso.contenido()}</div>`
                : `<p class="tour-texto">${escapar(paso.texto)}</p>`}
            <div class="tour-botones">
                ${indice > 0 ? '<button type="button" class="btn btn-sm btn-secondary" onclick="pasoTour(-1)">Atrás</button>' : ''}
                <button type="button" class="btn btn-sm btn-primary tour-siguiente" onclick="pasoTour(1)">${ultimo ? 'Terminar' : 'Siguiente'}</button>
            </div>`;
        elTarjeta.setAttribute('aria-label', paso.titulo);
        posicionar();
        elTarjeta.querySelector('.tour-siguiente')?.focus({ preventScroll: true });
    }

    async function iniciarTour(clave = 'primerosPasos') {
        if (!RECORRIDOS[clave]) return;
        if (document.getElementById('tour-oferta')) medir('tour_oferta', { respuesta: 'aceptada' });
        medir('tour_iniciado', { recorrido: clave });
        cerrarMenuTour();
        cerrarOfertaTour(false);
        crearCapas();
        actual = { clave, indice: 0 };
        await mostrarPaso(0);
    }

    function pasoTour(delta) {
        if (!actual) return;
        mostrarPaso(actual.indice + delta, delta < 0 ? -1 : 1);
    }

    function terminarTour(completo) {
        if (!actual) return;
        const clave = actual.clave;
        medir(completo ? 'tour_completado' : 'tour_cerrado', { recorrido: clave, paso: actual.indice + 1 });
        actual = null;
        quitarCapas();
        try { localStorage.setItem(CLAVE_VISTO, '1'); } catch (e) { /* sin almacenamiento */ }
        if (completo && clave === 'primerosPasos' && typeof mostrarToast === 'function') {
            mostrarToast('¡Listo! Los demás recorridos están en el botón 🧭', 'success');
        }
    }

    document.addEventListener('keydown', (e) => {
        if (!actual) return;
        if (e.key === 'Escape') { terminarTour(); return; }
        // Las flechas son del campo que se esté escribiendo, no del recorrido.
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
        if (e.key === 'ArrowRight') pasoTour(1);
        else if (e.key === 'ArrowLeft') pasoTour(-1);
    });

    // ==================== BOTÓN 🧭 Y SU MENÚ ====================

    function crearBotonTour() {
        if (document.getElementById('tour-fab')) return;
        const fab = document.createElement('button');
        fab.id = 'tour-fab';
        fab.type = 'button';
        fab.title = 'Recorridos guiados: aprende a usar la app';
        fab.setAttribute('aria-label', 'Recorridos guiados');
        fab.setAttribute('aria-haspopup', 'menu');
        fab.textContent = '🧭';
        fab.addEventListener('click', (e) => { e.stopPropagation(); alternarMenuTour(); });
        document.body.appendChild(fab);
    }

    function alternarMenuTour() {
        if (document.getElementById('tour-menu')) { cerrarMenuTour(); return; }
        const menu = document.createElement('div');
        menu.id = 'tour-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = '<div class="tour-menu-titulo">🧭 Aprende a usar la app</div>' +
            Object.entries(RECORRIDOS).map(([clave, r]) => `
                <button type="button" role="menuitem" onclick="iniciarTour('${clave}')">
                    <span class="tour-menu-icono">${r.icono}</span>
                    <span class="tour-menu-texto">${escapar(r.titulo)}</span>
                    <span class="tour-menu-duracion">${r.duracion}</span>
                </button>`).join('');
        document.body.appendChild(menu);
        menu.querySelector('button')?.focus({ preventScroll: true });
    }

    function cerrarMenuTour() {
        document.getElementById('tour-menu')?.remove();
    }

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('tour-menu');
        if (menu && !menu.contains(e.target)) cerrarMenuTour();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenuTour(); });

    // ==================== OFERTA A QUIEN LLEGA POR PRIMERA VEZ ====================

    function ofrecerTour() {
        if (document.getElementById('tour-oferta') || actual) return;
        const oferta = document.createElement('div');
        oferta.id = 'tour-oferta';
        oferta.setAttribute('role', 'dialog');
        oferta.setAttribute('aria-label', 'Recorrido de bienvenida');
        oferta.innerHTML = `
            <button type="button" class="tour-cerrar" aria-label="Cerrar" onclick="cerrarOfertaTour(true)">✕</button>
            <strong>👋 ¿Primera vez por aquí?</strong>
            <p>Te muestro en 1 minuto cómo tenerla en la pantalla de inicio de tu celular y agregar tu primer expediente con ayuda de la IA.</p>
            <div class="tour-botones">
                <button type="button" class="btn btn-sm btn-secondary" onclick="cerrarOfertaTour(true)">Ahora no</button>
                <button type="button" class="btn btn-sm btn-primary" onclick="iniciarTour('primerosPasos')">Mostrarme</button>
            </div>`;
        document.body.appendChild(oferta);
    }

    function cerrarOfertaTour(recordar) {
        const oferta = document.getElementById('tour-oferta');
        if (!oferta) return;
        oferta.remove();
        if (recordar) {
            medir('tour_oferta', { respuesta: 'ahora_no' });
            try { localStorage.setItem(CLAVE_VISTO, '1'); } catch (e) { /* sin almacenamiento */ }
            if (typeof mostrarToast === 'function') mostrarToast('Cuando quieras, los recorridos están en el botón 🧭', 'info');
        }
    }

    async function decidirOferta() {
        let visto = false;
        try { visto = localStorage.getItem(CLAVE_VISTO) === '1'; } catch (e) { /* sin almacenamiento */ }
        const pedido = /[?&]tour=1\b/.test(location.search);
        if (visto && !pedido) return;
        if (!pedido) {
            // Solo a quien empieza de cero: si ya tiene expedientes, ya sabe.
            try {
                const exps = typeof obtenerExpedientes === 'function' ? await obtenerExpedientes() : [];
                if (exps.length > 0) return;
            } catch (e) { return; }
        }
        ofrecerTour();
    }

    window.addEventListener('load', () => {
        crearBotonTour();
        // Tras el arranque de la app (base de datos lista, avisos iniciales).
        setTimeout(() => { decidirOferta(); }, 1800);
    });

    Object.assign(window, {
        RECORRIDOS_TOUR: RECORRIDOS, iniciarTour, pasoTour, terminarTour,
        cerrarOfertaTour, ofrecerTour, alternarMenuTour, cerrarMenuTour
    });
})();
