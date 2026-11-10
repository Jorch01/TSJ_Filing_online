/**
 * Recorridos guiados.
 *
 * Nada invasivo:
 *  - A quien entra por primera vez (sin expedientes) se le OFRECE, en una
 *    tarjeta pequeña en una esquina, ver cómo empezar. No se abre solo.
 *  - Durante el recorrido la página sigue usable: el resaltado solo oscurece
 *    alrededor, no bloquea clics. Esc o ✕ lo cierran en cualquier momento.
 *  - Después queda el botón 🧭 con todos los recorridos, por grupos, el de la
 *    página en la que se está primero y una ✓ en los que ya se vieron.
 *
 * Cada paso puede llevar a una página (`antes`) y señalar un elemento
 * (`objetivo`: un selector, una lista de selectores —el primero que se vea—
 * o una función que lo devuelve). Si el elemento tarda en aparecer (una
 * página que se pinta al abrirla) se le espera un momento; si no está a la
 * vista, la tarjeta sale centrada: un recorrido nunca se atora por un botón
 * que no existe. Los pasos que no aplican (`saltarSi`) no se muestran ni se
 * cuentan.
 */
(function () {
    'use strict';

    const CLAVE_VISTO = 'tour_bienvenida_visto';
    const CLAVE_COMPLETADOS = 'tour_completados';
    const ESPERA_OBJETIVO_MS = 1500;
    const pausa = (ms) => new Promise(res => setTimeout(res, ms));
    const medir = (e, p) => { if (typeof window.medir === 'function') window.medir(e, p); };

    // ==================== AYUDAS PARA LOS PASOS ====================

    function ir(pagina, despues) {
        return async () => {
            cerrarVentana();
            if (typeof navegarA === 'function') navegarA(pagina);
            if (despues) despues();
            await pausa(250);
        };
    }
    const irTSJ = (tab) => ir('busqueda', () => typeof cambiarTabTSJ === 'function' && cambiarTabTSJ(tab));
    const irIMPI = (tab) => ir('impi', () => typeof cambiarTabIMPI === 'function' && cambiarTabIMPI(tab));

    /** La ventana (modal) de la app, si un recorrido la dejó abierta. */
    function cerrarVentana() {
        const m = document.getElementById('modal-overlay');
        if (m && m.classList.contains('active') && typeof cerrarModal === 'function') cerrarModal();
    }

    /** La fila de configuración que contiene un control (los interruptores no se ven solos). */
    const filaDe = (id) => () => {
        const el = document.getElementById(id);
        return el ? el.closest('.config-item, .form-group, .data-card') || el : null;
    };
    const seccionDe = (id) => () => {
        const el = document.getElementById(id);
        return el ? el.closest('.config-section') || el : null;
    };
    /** El contenedor (`cerca`) del primer elemento que coincide con un selector. */
    const bloqueDe = (sel, cerca) => () => {
        const el = document.querySelector(sel);
        return el ? (cerca ? el.closest(cerca) : el.parentElement) || el : null;
    };

    async function hayClaveIA() {
        try { return !!(typeof obtenerConfig === 'function' && await obtenerConfig('ia_api_key')); }
        catch (e) { return false; }
    }
    async function cuantos(fn) {
        try { return typeof window[fn] === 'function' ? (await window[fn]()).length : 0; }
        catch (e) { return 0; }
    }
    const sinExpedientes = async () => (await cuantos('obtenerExpedientes')) === 0;
    const sinNotas = async () => (await cuantos('obtenerNotas')) === 0;
    const enCelular = () => window.matchMedia('(max-width: 768px)').matches;
    const esPremium = () => !!(window.estadoPremium && window.estadoPremium.activo);

    const instalada = () => typeof estaInstalada === 'function' && estaInstalada();
    const instrucciones = () => typeof instruccionesInstalacionHTML === 'function'
        ? instruccionesInstalacionHTML(true) : '';

    // ==================== LOS RECORRIDOS ====================

    const GRUPOS = [
        ['empezar', 'Para empezar'],
        ['despacho', 'Tu despacho'],
        ['tribunales', 'Tribunales'],
        ['herramientas', 'Herramientas'],
        ['app', 'La app']
    ];

    const RECORRIDOS = {
        primerosPasos: {
            grupo: 'empezar',
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
                    antes: irTSJ('ia'),
                    objetivo: '#ia-texto-acuerdo',
                    titulo: '1. Pega o fotografía el acuerdo',
                    texto: 'Copia aquí el texto del acuerdo desde los estrados, o súbelo con 🖼️ Álbum o 📸 Tomar foto. La IA encuentra el número de expediente, el juzgado, las audiencias y los plazos.'
                },
                {
                    saltarSi: hayClaveIA,
                    antes: ir('config'),
                    objetivo: '#ia-api-key',
                    titulo: '2. Una sola vez: tu clave gratuita de IA',
                    texto: 'La IA usa Gemini de Google. Crea tu clave gratis en aistudio.google.com/apikey y pégala aquí. Se guarda solo en tu dispositivo.'
                },
                {
                    antes: irTSJ('ia'),
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
                    texto: 'Aquí tienes recorridos cortos de todo lo demás: expedientes, agenda, estrados, calculadora laboral, marcas del IMPI, estadísticas… El de la página en la que estés sale primero.'
                }
            ]
        },
        instalar: {
            grupo: 'empezar',
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

        inicio: {
            grupo: 'despacho',
            paginas: ['inicio'],
            icono: '🏠',
            titulo: 'Tu panel de inicio',
            duracion: '30 s',
            pasos: [
                {
                    antes: ir('inicio'),
                    objetivo: '.stats-grid',
                    titulo: 'Lo urgente, primero',
                    texto: 'Pendientes urgentes, eventos de la semana, expedientes y notas fijadas. Toca una tarjeta y se despliega debajo la lista, con acceso directo a cada uno.'
                },
                {
                    saltarSi: async () => !enCelular(),
                    objetivo: '#busqueda-rapida-input',
                    titulo: 'Busca sin cambiar de página',
                    texto: 'Escribe el número, el nombre, el cliente o la carpeta y abre el expediente desde aquí.'
                },
                {
                    saltarSi: async () => enCelular(),
                    titulo: '⌨️ Ctrl+K: búscalo todo',
                    texto: 'En la computadora, Ctrl+K (⌘K en Mac) abre un buscador de expedientes, notas, pendientes y eventos desde cualquier página. Enter abre el que elijas.'
                },
                {
                    objetivo: '.quick-actions',
                    titulo: 'Acciones rápidas',
                    texto: 'Lo de todos los días a un toque: nuevo expediente, buscar en el TSJ o el PJF, marcas del IMPI, calendario y nueva nota.'
                },
                {
                    objetivo: bloqueDe('#eventos-hoy', '.card'),
                    titulo: 'Hoy y los próximos 7 días',
                    texto: 'Tus audiencias, vencimientos y recordatorios de la semana, en orden. Abajo, los expedientes en los que trabajaste hace poco.'
                }
            ]
        },
        expedientes: {
            grupo: 'despacho',
            paginas: ['expedientes'],
            icono: '📁',
            titulo: 'Expedientes: alta, carpetas y archivo',
            duracion: '1 min',
            pasos: [
                {
                    antes: ir('expedientes'),
                    objetivo: '#page-expedientes .page-header .btn-primary',
                    titulo: 'Da de alta un expediente',
                    texto: 'Del TSJ, federal o de otra autoridad. Con el cliente, el responsable, el tipo de asunto y la fecha de inicio (opcionales) tus estadísticas se arman solas.'
                },
                {
                    objetivo: '#page-expedientes .filters-section .search-box',
                    titulo: 'Encuéntralo con lo que recuerdes',
                    texto: 'Busca por número, nombre, partes, juzgado, cliente, responsable o carpeta. También encuentra lo que escribiste en sus notas y pendientes.'
                },
                {
                    objetivo: '#filtro-carpeta',
                    titulo: 'Carpetas para tus casos',
                    texto: 'Un caso con varios expedientes (el juicio, el amparo, la denuncia) va en una carpeta. Créalas con "📁 Carpetas" y filtra por ellas aquí y en Pendientes.'
                },
                {
                    objetivo: '#page-expedientes .view-toggle',
                    titulo: 'Tarjetas o tabla',
                    texto: 'Cambia de vista: en tabla ves muchos a la vez, con todas sus acciones en la fila.'
                },
                {
                    saltarSi: sinExpedientes,
                    objetivo: '#lista-expedientes .expediente-card',
                    titulo: 'Toca un expediente para ver su ficha',
                    texto: 'Ves de un vistazo sus pendientes y su calendario, y desde ahí abres sus estrados, su timeline o lo editas.'
                },
                {
                    saltarSi: sinExpedientes,
                    objetivo: '#lista-expedientes .acciones-mas',
                    titulo: 'Más acciones en ⋯',
                    texto: 'El historial de cambios, el timeline (notas, audiencias y cambios en orden) y archivar. Al archivar anota el resultado: así ves en estadísticas cuántos asuntos ganas.'
                },
                {
                    objetivo: '#archivo-toggle',
                    titulo: 'Lo concluido se archiva, no se borra',
                    texto: 'En el archivo lo consultas cuando quieras y, si el asunto revive, lo restauras con ♻️.'
                },
                {
                    objetivo: '#page-expedientes .page-header .header-buttons .tooltip-container',
                    titulo: '¿Muchos a la vez?',
                    texto: 'Descarga el template, llénalo en Excel y súbelo con "📥 Importar CSV": TSJ, federales y otras autoridades en un solo archivo, y cada fila puede traer su pendiente y su audiencia.'
                }
            ]
        },
        agenda: {
            grupo: 'despacho',
            paginas: ['calendario', 'pendientes'],
            icono: '📅',
            titulo: 'Agenda, audiencias y pendientes',
            duracion: '50 s',
            pasos: [
                {
                    antes: ir('calendario'),
                    objetivo: '#calendario-dias',
                    titulo: 'Tu calendario de audiencias',
                    texto: 'Toca un día para ver o agregar eventos. Los días inhábiles del TSJ ya vienen marcados.'
                },
                {
                    objetivo: '#page-calendario .page-header .btn-primary',
                    titulo: 'Audiencias, vencimientos y recordatorios',
                    texto: 'Cada evento se liga a su expediente y aparece en su ficha. Si conectas Google Calendar (en Configuración), llega solo a tu calendario.'
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
                },
                {
                    objetivo: '#page-pendientes .filters-section',
                    titulo: 'Lo que toca hoy',
                    texto: 'Filtra por estado, prioridad, expediente o carpeta, y agrúpalos por expediente para ver de un vistazo qué falta en cada asunto.'
                },
                {
                    objetivo: '#btn-toggle-seleccion-pendientes',
                    titulo: 'Varios a la vez',
                    texto: 'Con la selección múltiple marcas varios pendientes (o todos los que ves) y los eliminas de una vez.'
                }
            ]
        },
        notas: {
            grupo: 'despacho',
            paginas: ['notas'],
            icono: '📝',
            titulo: 'Notas',
            duracion: '30 s',
            pasos: [
                {
                    antes: ir('notas'),
                    objetivo: '#page-notas .page-header .btn-primary',
                    titulo: 'Apunta lo que no puede perderse',
                    texto: 'Una nota puede ir ligada a un expediente y aparece en su timeline. La calculadora laboral y el estudio de viabilidad también guardan aquí su resultado.'
                },
                {
                    objetivo: ['#page-notas .filters-section', '#filtro-expediente-nota'],
                    titulo: 'Las notas de un asunto',
                    texto: 'Busca por texto o elige un expediente para ver solo sus notas.'
                },
                {
                    saltarSi: sinNotas,
                    objetivo: '#lista-notas .nota-fijar',
                    titulo: '📌 Fija lo importante',
                    texto: 'Una nota fijada queda arriba de todas y a mano en "Notas fijadas" del inicio.'
                },
                {
                    saltarSi: async () => !(await sinNotas()),
                    titulo: '📌 Lo importante, siempre arriba',
                    texto: 'Cada nota trae una 📌: al fijarla queda arriba de todas y a mano en "Notas fijadas" del inicio.'
                }
            ]
        },
        estadisticas: {
            grupo: 'despacho',
            paginas: ['estadisticas'],
            icono: '📊',
            titulo: 'Estadísticas del despacho',
            duracion: '40 s',
            pasos: [
                {
                    antes: ir('estadisticas'),
                    objetivo: '.est-filtros',
                    titulo: 'Elige el periodo y filtra',
                    texto: 'Los últimos 30 días, este año, todo el historial o un rango tuyo, y solo una institución, materia, cliente o responsable. Las altas y los cierres se comparan con el periodo anterior.'
                },
                {
                    saltarSi: sinExpedientes,
                    objetivo: '.est-kpis',
                    titulo: 'Cómo va el despacho',
                    texto: 'Activos y los que llevan 60 días sin movimiento, altas y cierres, cuánto dura un asunto, pendientes vencidos y a tiempo, audiencias próximas y resultados favorables.'
                },
                {
                    saltarSi: async () => !(await sinExpedientes()),
                    objetivo: '.est-vacio',
                    titulo: 'Se llena con tus expedientes',
                    texto: 'En cuanto des de alta expedientes verás cuántos tienes activos y cuáles llevan 60 días sin movimiento, altas y cierres, cuánto dura un asunto, pendientes a tiempo, audiencias próximas y resultados favorables.'
                },
                {
                    saltarSi: sinExpedientes,
                    objetivo: '.est-indice',
                    titulo: 'Todo por secciones',
                    texto: 'Tiempos, flujo, tipos de asunto, resultados, clientes, responsables, pendientes y agenda. Cada tarjeta cambia entre gráfica y tabla, se ordena y se descarga en CSV.'
                },
                {
                    objetivo: '.est-filtros [data-acc="csv-todo"]',
                    titulo: 'Llévatelo a Excel',
                    texto: 'Todas las tablas en un solo archivo. Mientras más datos captures (cliente, responsable, tipo de asunto, resultado al archivar), más te dicen.'
                }
            ]
        },

        estrados: {
            grupo: 'tribunales',
            paginas: ['busqueda', 'pjf'],
            icono: '⚖️',
            titulo: 'Estrados del TSJ y del PJF',
            duracion: '50 s',
            pasos: [
                {
                    antes: irTSJ('busqueda'),
                    objetivo: '#tsj-juzgado-search',
                    titulo: 'Consulta un expediente del TSJ',
                    texto: 'Escribe parte del nombre del juzgado o la sala para encontrarlo en la lista, y luego el número o el nombre de la parte.'
                },
                {
                    objetivo: bloqueDe('#tsj-tab-busqueda [onclick="ejecutarBusquedaTSJyGuardar()"]', '.card-footer'),
                    titulo: 'Abre sus estrados (y guárdalo)',
                    texto: '"Buscar" abre sus estrados electrónicos. "Buscar y Guardar" además lo agrega a tus expedientes, para abrirlos después con un toque.'
                },
                {
                    objetivo: '#busqueda-global-valor',
                    titulo: 'Búsqueda global',
                    texto: 'Un número o un nombre en todos los juzgados y salas a la vez: sirve para encontrar todas las causas de una persona. Abre varias ventanas, así que permite las ventanas emergentes.'
                },
                {
                    antes: irTSJ('expedientes'),
                    objetivo: '#btn-toggle-seleccion-tsj',
                    titulo: 'Revisa varios a la vez',
                    texto: 'En "Expedientes TSJ", la selección masiva abre los estrados de todos los que marques, uno tras otro, o copia sus enlaces.'
                },
                {
                    objetivo: '#page-busqueda .tribunal-selector',
                    titulo: 'Y lo federal, en el mismo lugar',
                    texto: 'Cambia a "PJF Federal" para consultar expedientes de los juzgados de distrito y tribunales colegiados del Vigésimo Séptimo Circuito (Quintana Roo) y de todo el país. Los laborales tienen su propio recorrido.'
                },
                {
                    antes: ir('pjf', () => typeof cambiarTabPJF === 'function' && cambiarTabPJF('busqueda')),
                    objetivo: '#pjf-circuito',
                    titulo: 'Un expediente federal',
                    texto: 'Elige el circuito, el órgano y el tipo de asunto, escribe el número y consulta sus publicaciones en el portal del PJF. También aquí "Buscar y Guardar" lo agrega a tus expedientes.'
                }
            ]
        },
        laborales: {
            grupo: 'tribunales',
            icono: '👷',
            titulo: 'Estrados laborales (TCA y Juntas)',
            duracion: '50 s',
            alTerminar: cerrarVentana,
            pasos: [
                {
                    antes: irTSJ('busqueda'),
                    objetivo: '#btn-estrados-laborales-tsj',
                    titulo: 'El Tribunal de Conciliación y Arbitraje y las Juntas',
                    texto: 'Sus estrados se publican en el sitio de la Secretaría del Trabajo, que no busca por número de expediente: pide la unidad y periodos de 15 días. La app te arma un marcador que hace esas consultas por ti.'
                },
                {
                    antes: async () => {
                        if (!document.querySelector('#modal-overlay.active .estl') && window.ESTRADOS_LABORALES) {
                            await window.ESTRADOS_LABORALES.abrir();
                        }
                        await pausa(150);
                    },
                    objetivo: '.estl-campos',
                    titulo: 'Qué revisar',
                    texto: 'La unidad (TCA, Junta Local o Especial), tus expedientes o los nombres de las partes, y cuántos periodos de 15 días hacia atrás o hacia adelante.'
                },
                {
                    objetivo: '.estl-navegadores',
                    titulo: 'Dónde lo vas a usar',
                    texto: 'Elige tu navegador o tu teléfono y te dice paso a paso cómo instalar el marcador. Solo se instala una vez.'
                },
                {
                    objetivo: '.estl-marcador',
                    titulo: 'El marcador',
                    texto: 'En la computadora, arrastra 📌 a tu barra de marcadores; en el teléfono, copia el código y guárdalo como marcador.'
                },
                {
                    objetivo: '#estl-abrir',
                    titulo: 'Abre los estrados y púlsalo',
                    texto: 'Ya en el sitio, el marcador consulta periodo por periodo y deja en la tabla solo tus expedientes. Desde la tarjeta de un expediente laboral, el botón 👷 lo abre con su unidad y su número.'
                }
            ]
        },

        laboral: {
            grupo: 'herramientas',
            paginas: ['laboral'],
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
            grupo: 'herramientas',
            paginas: ['impi'],
            icono: '🔰',
            titulo: 'Marcas del IMPI y estudio de viabilidad',
            duracion: '50 s',
            pasos: [
                {
                    antes: irIMPI('viabilidad'),
                    objetivo: '.impi-tabs',
                    titulo: 'Las herramientas del IMPI, juntas',
                    texto: 'Viabilidad junta MARCia, Marcanet y SIGA en un estudio; cada una sigue a mano en su pestaña para buscar por separado.'
                },
                {
                    objetivo: '#vb-denominacion',
                    titulo: '¿Se puede registrar?',
                    texto: 'Escribe la marca que quieres registrar. La app busca idénticas y parecidas, y compara cómo se escriben y cómo suenan.'
                },
                {
                    objetivo: '#vb-clase-agregar',
                    titulo: 'Sus clases de Niza',
                    texto: 'Elige las clases de los productos o servicios. Se revisan también las relacionadas, donde una marca parecida igual puede estorbar.'
                },
                {
                    objetivo: '#vb-ejecutar',
                    titulo: 'El dictamen',
                    texto: 'Sale la viabilidad con cada antecedente, su clase, su estatus y el porqué, más recomendaciones. Guárdalo como nota, expórtalo a CSV o vigila la marca para enterarte de solicitudes nuevas.'
                },
                {
                    objetivo: '#impi-unified-query',
                    titulo: 'Una búsqueda en las tres',
                    texto: 'Escribe una marca o un titular y busca a la vez en MARCia, Marcanet y SIGA. Las búsquedas que guardes se revisan solas y te avisan de publicaciones nuevas.'
                },
                {
                    saltarSi: async () => esPremium(),
                    titulo: 'Plan gratuito y Premium',
                    texto: 'Sin Premium tienes 2 estudios de viabilidad y 5 búsquedas al mes en las herramientas del IMPI. Con Premium, sin límite.'
                }
            ]
        },

        asistente: {
            grupo: 'app',
            icono: '🎤',
            titulo: 'El asistente de voz',
            duracion: '40 s',
            pasos: [
                {
                    objetivo: '#voz-fab',
                    titulo: 'Háblale o escríbele',
                    texto: 'Toca 🎤 y di lo que necesitas; si no puedes hablar, escríbelo. Entiende fechas como "el jueves a las 10" o "mañana".'
                },
                {
                    objetivo: '#voz-fab',
                    titulo: 'Qué le puedes pedir',
                    texto: 'Agendar o mover audiencias, crear y editar expedientes y notas, buscar en estrados del TSJ y del PJF, preguntar "¿qué audiencias tengo esta semana?" o calcular un finiquito. Con 💡 ves todos los comandos.'
                },
                {
                    objetivo: '#voz-fab',
                    titulo: 'Nada cambia sin tu sí',
                    texto: 'Antes de crear, editar o borrar algo te muestra qué va a hacer y lo confirmas. Si te equivocaste, dile "deshacer".'
                },
                {
                    antes: ir('config'),
                    objetivo: seccionDe('voz-cfg-tts'),
                    titulo: 'A tu gusto',
                    texto: 'Elige si te contesta en voz alta, si empieza a escuchar en cuanto lo abres y qué tan rápido habla.'
                }
            ]
        },
        avisos: {
            grupo: 'app',
            icono: '🔔',
            titulo: 'Recordatorios y avisos',
            duracion: '40 s',
            pasos: [
                {
                    antes: ir('config'),
                    objetivo: filaDe('config-notificaciones'),
                    titulo: 'Avisos en tu dispositivo',
                    texto: 'Actívalos y el navegador te avisa de tus audiencias y eventos próximos.'
                },
                {
                    objetivo: filaDe('reminder-1day'),
                    titulo: 'Recordatorios por correo',
                    texto: 'Te llegan 1 día, 3 días o 1 semana antes de cada evento. Usa tu cuenta gratuita de EmailJS: los pasos vienen en el botón ? de la sección.'
                },
                {
                    objetivo: filaDe('config-busquedas-auto'),
                    titulo: 'Búsquedas programadas',
                    texto: 'Cada cierto tiempo, mientras la app esté abierta, vuelve a abrir los estrados de tus expedientes para que veas si hay algo nuevo.'
                },
                {
                    objetivo: bloqueDe('[onclick="GCAL.mostrarConfigGCal()"]', '.data-card'),
                    titulo: 'Tu agenda en Google Calendar',
                    texto: 'Exporta tus eventos o activa la sincronización: cada audiencia que agregues, muevas o borres aquí se refleja sola en tu Google Calendar.'
                }
            ]
        },
        datos: {
            grupo: 'app',
            icono: '📴',
            titulo: 'Sin internet, respaldos y varios dispositivos',
            duracion: '40 s',
            pasos: [
                {
                    titulo: 'Funciona sin señal',
                    texto: 'Después de abrirla una vez, la app abre aunque no haya internet (en el juzgado, por ejemplo): tus expedientes, agenda y notas están en tu dispositivo.'
                },
                {
                    antes: ir('config'),
                    objetivo: bloqueDe('#page-config [onclick="exportarDatos()"]', '.data-card'),
                    titulo: 'Tus datos son tuyos',
                    texto: 'Viven en tu navegador, no en un servidor. Exporta un respaldo de vez en cuando: si borras los datos del navegador o cambias de equipo, con él los recuperas.'
                },
                {
                    objetivo: filaDe('config-auto-backup'),
                    titulo: 'Respaldo diario, solo',
                    texto: 'Actívalo y cada día que abras la app se descarga un respaldo, sin que te acuerdes.'
                },
                {
                    objetivo: '#sync-section',
                    titulo: 'La misma información en tu celular y tu computadora',
                    texto: 'Con Premium, la sincronización lleva tus expedientes, agenda y notas entre todos tus dispositivos, cifrados.'
                }
            ]
        },
        plan: {
            grupo: 'app',
            icono: '⭐',
            titulo: 'Tu plan: límites y Premium',
            duracion: '30 s',
            pasos: [
                {
                    saltarSi: async () => esPremium(),
                    antes: ir('config'),
                    objetivo: '#plan-limits',
                    titulo: 'Lo que llevas del plan gratuito',
                    texto: 'Expedientes, búsquedas globales, búsquedas en el IMPI y estudios de viabilidad: aquí ves cuánto has usado de cada uno.'
                },
                {
                    saltarSi: async () => esPremium(),
                    objetivo: '#pricing-planes',
                    titulo: 'Premium por 3, 6 o 12 meses',
                    texto: 'Sin límites, sin anuncios y con sincronización. Al elegir un plan se abre WhatsApp para pedir los datos de pago.'
                },
                {
                    saltarSi: async () => esPremium(),
                    objetivo: '#premium-activation',
                    titulo: 'Actívalo con tu código',
                    texto: 'Cuando confirmen tu pago te llega un código: escríbelo aquí junto con tu nombre y listo.'
                },
                {
                    saltarSi: async () => !esPremium(),
                    antes: ir('config'),
                    objetivo: '#premium-active',
                    titulo: 'Tu plan Premium',
                    texto: 'Aquí ves hasta cuándo está vigente. Antes de que venza, renuévalo desde WhatsApp.'
                }
            ]
        }
    };

    // ==================== MOTOR DEL RECORRIDO ====================

    let actual = null;          // { clave, indice, visibles, ocupado }
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

    function visible(el) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? el : null;
    }

    /** El elemento que señala un paso: un selector, varios (el primero visible) o una función. */
    function objetivoVisible(objetivo) {
        if (!objetivo) return null;
        if (typeof objetivo === 'function') {
            try { return visible(objetivo()); } catch (e) { return null; }
        }
        for (const sel of [].concat(objetivo)) {
            const el = visible(document.querySelector(sel));
            if (el) return el;
        }
        return null;
    }

    /** Hay páginas que se pintan al abrirlas: se les da un momento antes de rendirse. */
    async function esperarObjetivo(objetivo) {
        if (!objetivo) return null;   // un paso sin elemento que señalar no espera nada
        const limite = Date.now() + ESPERA_OBJETIVO_MS;
        let el = objetivoVisible(objetivo);
        while (!el && actual && Date.now() < limite) {
            await pausa(100);
            el = objetivoVisible(objetivo);
        }
        return el;
    }

    /** Lo que tapa la barra fija de arriba. En escritorio el encabezado es
     *  una barra lateral: no tapa nada por arriba. */
    function altoEncabezado() {
        const h = document.querySelector('.app-header');
        if (!h) return 0;
        const r = h.getBoundingClientRect();
        if (r.width < document.documentElement.clientWidth / 2) return 0;
        return getComputedStyle(h).position === 'fixed' || getComputedStyle(h).position === 'sticky' ? Math.max(0, r.bottom) : 0;
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
        // Debajo si cabe; si no, arriba; si no, a un lado; si tampoco, abajo
        // de la pantalla (lo que se señala es más alto que la pantalla).
        const centrarEn = (x) => Math.min(Math.max(margen, x - t.width / 2), vw - t.width - margen);
        const acotarAlto = (y) => Math.min(Math.max(margen, y), vh - t.height - margen);
        let left, top;
        if (r.bottom + pad + margen + t.height <= vh - margen) {
            top = r.bottom + pad + margen;
            left = centrarEn(r.left + r.width / 2);
        } else if (r.top - pad - margen - t.height >= margen + altoEncabezado()) {
            top = r.top - pad - margen - t.height;
            left = centrarEn(r.left + r.width / 2);
        } else if (vw - r.right - pad - margen >= t.width + margen) {
            left = r.right + pad + margen;
            top = acotarAlto(r.top + r.height / 2 - t.height / 2);
        } else if (r.left - pad - margen >= t.width + margen) {
            left = r.left - pad - margen - t.width;
            top = acotarAlto(r.top + r.height / 2 - t.height / 2);
        } else {
            top = vh - t.height - margen;
            left = centrarEn(r.left + r.width / 2);
        }
        elTarjeta.style.left = left + 'px';
        elTarjeta.style.top = top + 'px';
    }

    /** Lleva el elemento a la vista: al centro, o arriba si es más alto que media pantalla. */
    async function mostrarEnPantalla(el) {
        const r = el.getBoundingClientRect();
        const alto = window.innerHeight;
        if (r.height > alto * 0.45) {
            el.scrollIntoView({ block: 'start' });
            const tapa = altoEncabezado();
            if (tapa && el.getBoundingClientRect().top < tapa + 8) window.scrollBy(0, el.getBoundingClientRect().top - tapa - 8);
        } else {
            el.scrollIntoView({ block: 'center' });
        }
        await pausa(60);
    }

    function escapar(t) {
        return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    async function seSalta(paso) {
        if (!paso.saltarSi) return false;
        try { return !!(await paso.saltarSi()); } catch (e) { return false; }
    }

    async function mostrarPaso(indice, direccion = 1) {
        // Un paso a la vez: armar uno lleva su tiempo (cambiar de página,
        // esperar lo que se pinta) y un segundo clic en "Siguiente" en ese
        // lapso lo pondría a competir con el anterior.
        const sesion = actual;
        sesion.ocupado = true;
        try {
            await armarPaso(sesion, indice, direccion);
        } finally {
            sesion.ocupado = false;
        }
    }

    async function armarPaso(sesion, indice, direccion) {
        const sigue = () => actual === sesion;
        const recorrido = RECORRIDOS[sesion.clave];
        // Pasos que no aplican (p. ej. la clave de IA ya está puesta) se saltan.
        while (indice >= 0 && indice < recorrido.pasos.length && await seSalta(recorrido.pasos[indice])) {
            indice += direccion;
        }
        if (!sigue()) return;
        if (indice < 0) {
            // Atrás desde el primero que se ve: se queda en el primero que se ve.
            indice = 0;
            while (indice < recorrido.pasos.length && await seSalta(recorrido.pasos[indice])) indice++;
            if (!sigue()) return;
        }
        if (indice >= recorrido.pasos.length) { terminarTour(true); return; }
        sesion.indice = indice;
        const paso = recorrido.pasos[indice];
        if (paso.antes) await paso.antes();
        if (!sigue()) return;   // se cerró mientras navegaba

        const el = await esperarObjetivo(paso.objetivo);
        if (!sigue()) return;
        if (el) await mostrarEnPantalla(el);
        if (!sigue()) return;

        // La cuenta es de los pasos que se ven, no de los que se saltan.
        const visibles = actual.visibles;
        const posicion = Math.max(1, visibles.indexOf(indice) + 1 || visibles.filter(i => i < indice).length + 1);
        const total = Math.max(visibles.length, posicion);
        const ultimo = !recorrido.pasos.slice(indice + 1).some((p, i) => visibles.includes(indice + 1 + i));
        const primero = !visibles.some(i => i < indice);
        elTarjeta.innerHTML = `
            <button type="button" class="tour-cerrar" aria-label="Cerrar recorrido" onclick="terminarTour()">✕</button>
            <div class="tour-progreso">${recorrido.icono} ${escapar(recorrido.titulo)} · ${posicion} de ${total}</div>
            <h4 class="tour-titulo">${escapar(paso.titulo)}</h4>
            <p class="tour-texto">${escapar(paso.texto)}</p>
            ${paso.contenido ? `<div class="tour-contenido">${paso.contenido()}</div>` : ''}
            <div class="tour-botones">
                ${primero ? '' : '<button type="button" class="btn btn-sm btn-secondary" onclick="pasoTour(-1)">Atrás</button>'}
                <button type="button" class="btn btn-sm btn-primary tour-siguiente" onclick="pasoTour(1)">${ultimo ? 'Terminar' : 'Siguiente'}</button>
            </div>`;
        elTarjeta.setAttribute('aria-label', paso.titulo);
        posicionar();
        elTarjeta.querySelector('.tour-siguiente')?.focus({ preventScroll: true });
    }

    async function iniciarTour(clave = 'primerosPasos') {
        const recorrido = RECORRIDOS[clave];
        if (!recorrido) return;
        if (actual) terminarTour();
        if (document.getElementById('tour-oferta')) medir('tour_oferta', { respuesta: 'aceptada' });
        medir('tour_iniciado', { recorrido: clave });
        cerrarMenuTour();
        cerrarOfertaTour(false);
        crearCapas();
        actual = { clave, indice: 0, visibles: recorrido.pasos.map((_, i) => i), ocupado: true };
        // Qué pasos se van a ver, para contar "2 de 5" sin los que se saltan.
        const visibles = [];
        for (let i = 0; i < recorrido.pasos.length; i++) if (!(await seSalta(recorrido.pasos[i]))) visibles.push(i);
        if (!actual || actual.clave !== clave) return;
        actual.visibles = visibles;
        await mostrarPaso(0);
    }

    function pasoTour(delta) {
        if (!actual || actual.ocupado) return;
        mostrarPaso(actual.indice + delta, delta < 0 ? -1 : 1);
    }

    function leerCompletados() {
        try { return JSON.parse(localStorage.getItem(CLAVE_COMPLETADOS) || '[]'); } catch (e) { return []; }
    }

    function terminarTour(completo) {
        if (!actual) return;
        const clave = actual.clave;
        medir(completo ? 'tour_completado' : 'tour_cerrado', { recorrido: clave, paso: actual.indice + 1 });
        actual = null;
        quitarCapas();
        const recorrido = RECORRIDOS[clave];
        if (recorrido && recorrido.alTerminar) { try { recorrido.alTerminar(); } catch (e) { /* nada que limpiar */ } }
        try {
            localStorage.setItem(CLAVE_VISTO, '1');
            if (completo) {
                const hechos = leerCompletados();
                if (!hechos.includes(clave)) localStorage.setItem(CLAVE_COMPLETADOS, JSON.stringify(hechos.concat(clave)));
            }
        } catch (e) { /* sin almacenamiento */ }
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
        fab.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-brujula"></use></svg>';
        fab.addEventListener('click', (e) => { e.stopPropagation(); alternarMenuTour(); });
        document.body.appendChild(fab);
    }

    /** El recorrido de la página que está abierta, si tiene uno. */
    function recorridoDeEstaPagina() {
        const pagina = (document.querySelector('.page.active')?.id || '').replace(/^page-/, '');
        return Object.keys(RECORRIDOS).find(c => (RECORRIDOS[c].paginas || []).includes(pagina)) || null;
    }

    function itemMenu(clave, hechos, etiqueta) {
        const r = RECORRIDOS[clave];
        const hecho = hechos.includes(clave);
        return `
            <button type="button" role="menuitem" onclick="iniciarTour('${clave}')"${hecho ? ' class="tour-hecho"' : ''}>
                <span class="tour-menu-icono">${r.icono}</span>
                <span class="tour-menu-texto">${etiqueta ? `<small>${escapar(etiqueta)}</small>` : ''}${escapar(r.titulo)}</span>
                <span class="tour-menu-duracion">${hecho ? '<span class="tour-check" title="Ya lo viste">✓</span> ' : ''}${r.duracion}</span>
            </button>`;
    }

    function alternarMenuTour() {
        if (document.getElementById('tour-menu')) { cerrarMenuTour(); return; }
        const hechos = leerCompletados();
        const aqui = recorridoDeEstaPagina();
        const menu = document.createElement('div');
        menu.id = 'tour-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = '<div class="tour-menu-titulo">🧭 Aprende a usar la app</div>' +
            (aqui ? itemMenu(aqui, hechos, 'En esta página') : '') +
            GRUPOS.map(([grupo, nombre]) => {
                const claves = Object.keys(RECORRIDOS).filter(c => RECORRIDOS[c].grupo === grupo && c !== aqui);
                if (!claves.length) return '';
                return `<div class="tour-menu-grupo" role="presentation">${escapar(nombre)}</div>` + claves.map(c => itemMenu(c, hechos)).join('');
            }).join('');
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
        RECORRIDOS_TOUR: RECORRIDOS, GRUPOS_TOUR: GRUPOS, iniciarTour, pasoTour, terminarTour,
        cerrarOfertaTour, ofrecerTour, alternarMenuTour, cerrarMenuTour
    });
})();
