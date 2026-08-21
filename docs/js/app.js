/**
 * TSJ Filing Online - Aplicación Principal
 */

// ==================== LOGGING SEGURO ====================

/**
 * Sistema de logging seguro que oculta logs en producción
 * Evita exponer información sensible en la consola del navegador
 */
const Logger = {
    // Modo debug: true en desarrollo, false en producción (GitHub Pages)
    isDebug: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',

    log: function(...args) {
        if (this.isDebug) console.log('[TSJ]', ...args);
    },

    warn: function(...args) {
        if (this.isDebug) console.warn('[TSJ]', ...args);
    },

    error: function(...args) {
        // Los errores siempre se muestran pero sin detalles sensibles en producción
        if (this.isDebug) {
            console.error('[TSJ]', ...args);
        } else {
            // En producción, solo mostrar mensaje genérico
            console.error('[TSJ] Ha ocurrido un error. Contacta soporte si persiste.');
        }
    }
};

// ==================== SEGURIDAD ====================

/**
 * Sanitiza HTML para prevenir ataques XSS
 * Usa DOMPurify si está disponible, de lo contrario escapa caracteres peligrosos
 * @param {string} dirty - HTML sin sanitizar
 * @returns {string} HTML sanitizado
 */
function sanitizeHTML(dirty) {
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(dirty, {
            ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'small', 'code', 'pre'],
            ALLOWED_ATTR: ['href', 'target', 'class', 'id', 'style'],
            ALLOW_DATA_ATTR: false
        });
    }
    // Fallback: escapar caracteres HTML peligrosos
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(dirty).replace(/[&<>"']/g, m => map[m]);
}

/**
 * Escapa texto para inserción segura (sin permitir HTML)
 * @param {string} text - Texto a escapar
 * @returns {string} Texto escapado
 */
function escapeText(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text || '').replace(/[&<>"']/g, m => map[m]);
}

// ==================== ESTADO GLOBAL ====================

// Estado global
let expedientesSeleccionados = [];
let fechaCalendario = new Date();
let diaSeleccionado = null;
let vistaExpedientes = localStorage.getItem('vistaExpedientes') || 'cards'; // 'cards' o 'table'
let diasInhabilesTSJ = []; // Días inhábiles del tribunal

// Días inhábiles fijos del TSJQROO (formato MM-DD) - Calendario 2026
const DIAS_INHABILES_FIJOS = [
    { fecha: '01-01', nombre: 'Año Nuevo' },
    { fecha: '02-02', nombre: 'Aniversario de la Constitución' },
    { fecha: '02-16', nombre: 'Fiestas Carnestolendas' },
    { fecha: '02-17', nombre: 'Fiestas Carnestolendas' },
    { fecha: '02-18', nombre: 'Fiestas Carnestolendas' },
    { fecha: '03-16', nombre: 'Natalicio de Benito Juárez' },
    { fecha: '03-30', nombre: 'Semana Santa' },
    { fecha: '03-31', nombre: 'Semana Santa' },
    { fecha: '04-01', nombre: 'Semana Santa' },
    { fecha: '04-02', nombre: 'Semana Santa' },
    { fecha: '04-03', nombre: 'Semana Santa' },
    { fecha: '05-01', nombre: 'Día del Trabajo' },
    { fecha: '05-04', nombre: 'Batalla de Puebla' },
    { fecha: '06-12', nombre: 'Día del Empleado Estatal' },
    { fecha: '09-16', nombre: 'Independencia de México' },
    { fecha: '11-16', nombre: 'Revolución Mexicana' },
    { fecha: '12-25', nombre: 'Navidad' },
];

// Períodos de vacaciones judiciales del TSJQROO (formato: { inicio: 'MM-DD', fin: 'MM-DD' })
const VACACIONES_JUDICIALES = [
    { inicio: '01-01', fin: '01-07', nombre: 'Primer período vacacional (continuación)' },
    { inicio: '01-19', fin: '01-30', nombre: 'Segundo período vacacional (primer semestre)' },
    { inicio: '07-16', fin: '07-31', nombre: 'Primer período vacacional' },
    { inicio: '12-22', fin: '12-31', nombre: 'Primer período vacacional (segundo semestre)' },
];

// Verificar si una fecha es día inhábil
function esDiaInhabil(fecha) {
    const mesdia = `${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
    const year = fecha.getFullYear();

    // Verificar fines de semana
    if (fecha.getDay() === 0 || fecha.getDay() === 6) {
        return { inhabil: true, razon: fecha.getDay() === 0 ? 'Domingo' : 'Sábado' };
    }

    // Verificar días fijos
    const diaFijo = DIAS_INHABILES_FIJOS.find(d => d.fecha === mesdia);
    if (diaFijo) {
        return { inhabil: true, razon: diaFijo.nombre };
    }

    // Verificar vacaciones
    for (const vac of VACACIONES_JUDICIALES) {
        const [iniMes, iniDia] = vac.inicio.split('-').map(Number);
        const [finMes, finDia] = vac.fin.split('-').map(Number);
        const inicio = new Date(year, iniMes - 1, iniDia);
        const fin = new Date(year, finMes - 1, finDia);

        if (fecha >= inicio && fecha <= fin) {
            return { inhabil: true, razon: vac.nombre };
        }
    }

    // Verificar días inhábiles dinámicos (cargados de configuración)
    const diaPersonalizado = diasInhabilesTSJ.find(d => {
        const fechaInhabil = new Date(d.fecha);
        return fechaInhabil.toDateString() === fecha.toDateString();
    });
    if (diaPersonalizado) {
        return { inhabil: true, razon: diaPersonalizado.nombre };
    }

    return { inhabil: false };
}

// ==================== INICIALIZACIÓN ====================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        await inicializarApp();
        Logger.log('Aplicación inicializada correctamente');
    } catch (error) {
        Logger.error('Error al inicializar:', error);
        mostrarToast('Error al cargar la aplicación', 'error');
    }
});

async function inicializarApp() {
    // Poblar selects
    poblarSelectJuzgados('expediente-juzgado');
    poblarSelectCategorias('filtro-categoria');

    // Inicializar vista de expedientes (solo TSJ)
    document.querySelectorAll('#page-expedientes .view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === vistaExpedientes);
    });

    // Cargar datos
    // Carpetas primero: el render de las tarjetas necesita el caché poblado
    // para mostrar los badges, y los selects de filtro/formulario también.
    if (typeof cargarCarpetasUI === 'function') {
        try { await cargarCarpetasUI(); } catch (e) { console.warn('No se cargaron carpetas:', e); }
    }
    await cargarEstadisticas();
    // Los pendientes van antes que los expedientes: la tarjeta de cada
    // expediente pinta cuántos tiene por hacer leyendo pendientesCache, así
    // que si se cargan después, las tarjetas quedan sin distintivo.
    await cargarPendientes();
    await cargarExpedientes();
    await cargarNotas();
    await cargarEventos();
    renderizarCalendario();

    // Configurar eventos de navegación
    configurarNavegacion();
    configurarFormularios();

    // Configurar tooltips de ayuda
    configurarTooltips();

    // Cargar configuración
    await cargarConfiguracion();
}

// ==================== TOOLTIPS DE AYUDA ====================

function configurarTooltips() {
    const tooltipContainers = document.querySelectorAll('.tooltip-container');

    tooltipContainers.forEach(container => {
        const tooltip = container.querySelector('.tooltip-content');
        if (!tooltip) return;

        // El disparador no siempre es un ".help-btn": algunos contenedores
        // envuelven un botón normal. Buscando solo .help-btn se salía de aquí
        // sin colocar el tooltip, y como es position:fixed sin top/left se
        // quedaba dibujado justo encima del botón, tapándolo.
        const disparador = container.querySelector('.help-btn')
            || container.querySelector('button, a, input, select')
            || container;

        const posicionarTooltip = () => {
            const btn = disparador.getBoundingClientRect();
            const margen = 10;
            const anchoVentana = document.documentElement.clientWidth;
            const altoVentana = document.documentElement.clientHeight;

            // Se mide con el tooltip ya visible; si aún no lo está, se fuerza
            // una medición temporal para no colocarlo a ciegas.
            const habiaMedida = tooltip.offsetHeight > 0;
            if (!habiaMedida) {
                tooltip.style.visibility = 'hidden';
                tooltip.style.display = 'block';
            }
            const ancho = tooltip.offsetWidth || 320;
            const alto = tooltip.offsetHeight || 200;
            if (!habiaMedida) {
                tooltip.style.display = '';
                tooltip.style.visibility = '';
            }

            // Se elige el lado con más sitio y se limita la altura a ese hueco,
            // para que el tooltip nunca invada el botón ni se salga de pantalla.
            const huecoArriba = btn.top - margen * 2;
            const huecoAbajo = altoVentana - btn.bottom - margen * 2;
            const arriba = huecoArriba >= alto || huecoArriba > huecoAbajo;

            tooltip.style.maxHeight = `${Math.max(120, Math.floor(arriba ? huecoArriba : huecoAbajo))}px`;
            const altoFinal = Math.min(alto, arriba ? huecoArriba : huecoAbajo);

            const top = arriba
                ? Math.max(margen, btn.top - altoFinal - margen)
                : Math.min(altoVentana - altoFinal - margen, btn.bottom + margen);

            let left = btn.left + (btn.width / 2) - (ancho / 2);
            left = Math.max(margen, Math.min(left, anchoVentana - ancho - margen));

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
        };

        // El CSS muestra el tooltip al pasar por el contenedor, así que hay que
        // colocarlo en ese mismo momento y no solo al entrar en el botón.
        container.addEventListener('mouseenter', posicionarTooltip);
        disparador.addEventListener('mouseenter', posicionarTooltip);
        disparador.addEventListener('focus', posicionarTooltip);

        // Reposicionar en scroll
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if (container.matches(':hover')) posicionarTooltip();
            }, 50);
        }, { passive: true });
    });
}

// ==================== NAVEGACIÓN ====================

function configurarNavegacion() {
    // Botones de navegación
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pagina = btn.dataset.page;
            navegarA(pagina);
        });
    });

    // Menú móvil
    const menuToggle = document.getElementById('menuToggle');
    const mobileNav = document.getElementById('mobileNav');

    menuToggle?.addEventListener('click', () => {
        mobileNav.classList.toggle('active');
    });

    // Cerrar menú al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (!mobileNav?.contains(e.target) && !menuToggle?.contains(e.target)) {
            mobileNav?.classList.remove('active');
        }
    });
}

function navegarA(pagina) {
    // Ocultar todas las páginas
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    // Mostrar página seleccionada
    const paginaEl = document.getElementById(`page-${pagina}`);
    if (paginaEl) {
        paginaEl.classList.add('active');
    }

    // Actualizar botones de navegación
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === pagina);
    });

    // Cerrar menú móvil
    document.getElementById('mobileNav')?.classList.remove('active');

    // Acciones específicas por página
    if (pagina === 'calendario') {
        renderizarCalendario();
    } else if (pagina === 'pendientes') {
        cargarPendientes();
    } else if (pagina === 'busqueda') {
        cargarExpedientesParaBusqueda();
    } else if (pagina === 'pjf') {
        cargarCatalogosPJF();
    } else if (pagina === 'impi') {
        // IMPI page - no initialization needed
    }
}

/**
 * Deep-link a un expediente: navega a la página de expedientes, hace
 * scroll a la tarjeta/fila y la resalta. Actualiza el hash de la URL
 * (#expedientes/<id>) para poder compartir/recargar el enlace.
 */
async function mostrarExpediente(id) {
    navegarA('expedientes');
    try { history.replaceState(null, '', '#expedientes/' + id); } catch (e) { /* file:// */ }

    // Dar tiempo a que la lista esté renderizada
    let el = null;
    for (let intento = 0; intento < 10 && !el; intento++) {
        el = document.querySelector(`#page-expedientes [data-id="${id}"]`);
        if (!el) await new Promise(r => setTimeout(r, 200));
    }
    if (!el) {
        mostrarToast('El expediente no está visible en la lista actual (¿archivado o en otra vista?)', 'warning');
        return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('expediente-destacado');
    setTimeout(() => el.classList.remove('expediente-destacado'), 2800);
}

// Al cargar con #expedientes/<id> en la URL, abrir ese expediente
window.addEventListener('load', () => {
    const m = (location.hash || '').match(/^#expedientes\/(\d+)$/);
    if (m) setTimeout(() => mostrarExpediente(parseInt(m[1])), 900);
});

// ==================== ESTADÍSTICAS ====================

async function cargarEstadisticas() {
    const stats = await obtenerEstadisticas();

    document.getElementById('stat-expedientes').textContent = stats.expedientes;
    document.getElementById('stat-eventos').textContent = stats.eventos;
    document.getElementById('stat-notas').textContent = stats.notas;
    document.getElementById('stat-alertas').textContent = stats.alertas;
}

// ==================== EXPEDIENTES ====================

async function cargarExpedientes() {
    // Eliminar duplicados automáticamente
    const duplicadosEliminados = await eliminarExpedientesDuplicados();
    if (duplicadosEliminados > 0) {
        Logger.log(`Se eliminaron ${duplicadosEliminados} expediente(s) duplicado(s)`);
    }

    let expedientes = await obtenerExpedientes();
    const lista = document.getElementById('lista-expedientes');
    const count = document.getElementById('count-expedientes');
    const totalExpedientes = expedientes.length;

    // Ordenar por orden personalizado (si existe) o por fecha
    expedientes = [...expedientes].sort((a, b) => {
        // Si ambos tienen orden, usar orden
        if (a.orden !== undefined && b.orden !== undefined) {
            return a.orden - b.orden;
        }
        // Si solo uno tiene orden, ese va primero
        if (a.orden !== undefined) return -1;
        if (b.orden !== undefined) return 1;
        // Si ninguno tiene orden, ordenar por fecha
        return new Date(b.fechaModificacion || b.fechaCreacion || 0) - new Date(a.fechaModificacion || a.fechaCreacion || 0);
    });

    // Verificar si usuario NO es premium y tiene más de 10 expedientes
    const esPremium = estadoPremium && estadoPremium.activo;
    let mostrandoLimitados = false;

    if (!esPremium && totalExpedientes > PREMIUM_CONFIG.limiteExpedientes) {
        // Tomar solo los primeros 10 (ya ordenados)
        expedientes = expedientes.slice(0, PREMIUM_CONFIG.limiteExpedientes);
        mostrandoLimitados = true;
    }

    if (expedientes.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📂</span>
                <h3>No hay expedientes</h3>
                <p>Comienza agregando tu primer expediente</p>
                <button class="btn btn-primary" onclick="mostrarFormularioExpediente()">
                    ➕ Agregar Expediente
                </button>
            </div>
        `;
        count.textContent = '0 expedientes';
        return;
    }

    // Mostrar advertencia si está limitado
    let advertenciaHTML = '';
    if (mostrandoLimitados) {
        advertenciaHTML = `
            <div class="info-banner warning" style="margin-bottom: 1rem;">
                <div class="info-icon">⚠️</div>
                <div class="info-content">
                    <h4>Licencia requerida</h4>
                    <p>Tienes ${totalExpedientes} expedientes pero solo puedes ver los 10 más recientes.
                    <a href="#" onclick="mostrarSeccion('configuracion'); return false;">Activa Premium</a> para acceso completo.</p>
                </div>
            </div>
        `;
    }

    lista.innerHTML = advertenciaHTML + expedientes.map((exp, index) =>
        renderTarjetaExpedienteHTML(exp, { draggable: true, orden: exp.orden || index })
    ).join('');

    // Inicializar drag and drop
    inicializarDragAndDrop();

    // Mostrar conteo real vs visible
    if (mostrandoLimitados) {
        count.textContent = `${expedientes.length} de ${totalExpedientes} expedientes (limitado)`;
    } else {
        count.textContent = `${expedientes.length} expediente${expedientes.length !== 1 ? 's' : ''}`;
    }

    // Poblar tabla
    const tablaBody = document.getElementById('tabla-expedientes-body');
    if (tablaBody) {
        tablaBody.innerHTML = expedientes.map(exp => renderFilaExpedienteHTML(exp)).join('');
    }

    // Aplicar vista actual
    aplicarVistaExpedientes();

    // Actualizar badge de archivo
    actualizarBadgeArchivo();

    // Actualizar select de expedientes en notas
    actualizarSelectExpedientes();

    // Actualizar expedientes recientes en dashboard
    actualizarExpedientesRecientes(expedientes);
}

// Cambiar vista de expedientes
function cambiarVistaExpedientes(vista) {
    vistaExpedientes = vista;
    try { localStorage.setItem('vistaExpedientes', vista); } catch (e) {}

    // Actualizar solo botones de TSJ (excluir PJF view buttons)
    document.querySelectorAll('#page-expedientes .view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === vista);
    });

    aplicarVistaExpedientes();
    // Re-renderizar el contenido para la nueva vista (ya que solo renderizamos
    // la vista activa por rendimiento; al cambiar, la otra está vacía).
    filtrarExpedientes();
}

// Aplicar vista actual
function aplicarVistaExpedientes() {
    const listaCards = document.getElementById('lista-expedientes');
    const tablaContainer = document.getElementById('tabla-expedientes');

    if (vistaExpedientes === 'table') {
        listaCards.style.display = 'none';
        if (tablaContainer) tablaContainer.style.display = 'block';
    } else {
        listaCards.style.display = 'grid';
        if (tablaContainer) tablaContainer.style.display = 'none';
    }
}

// ==================== DRAG AND DROP EXPEDIENTES ====================

let draggedElement = null;

function inicializarDragAndDrop() {
    const lista = document.getElementById('lista-expedientes');
    const cards = lista.querySelectorAll('.expediente-card');

    cards.forEach(card => {
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
        card.addEventListener('dragover', handleDragOver);
        card.addEventListener('dragenter', handleDragEnter);
        card.addEventListener('dragleave', handleDragLeave);
        card.addEventListener('drop', handleDrop);
    });
}

function handleDragStart(e) {
    draggedElement = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.id);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.expediente-card').forEach(card => {
        card.classList.remove('drag-over');
    });
    draggedElement = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    if (this !== draggedElement) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

async function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');

    if (this === draggedElement) return;

    const lista = document.getElementById('lista-expedientes');
    const cards = [...lista.querySelectorAll('.expediente-card')];
    const draggedIndex = cards.indexOf(draggedElement);
    const targetIndex = cards.indexOf(this);

    // Reordenar visualmente
    if (draggedIndex < targetIndex) {
        this.parentNode.insertBefore(draggedElement, this.nextSibling);
    } else {
        this.parentNode.insertBefore(draggedElement, this);
    }

    // Guardar nuevo orden
    await guardarOrdenExpedientes();
    mostrarToast('Orden actualizado', 'success');
}

async function guardarOrdenExpedientes() {
    const lista = document.getElementById('lista-expedientes');
    const cards = lista.querySelectorAll('.expediente-card');

    for (let i = 0; i < cards.length; i++) {
        const id = parseInt(cards[i].dataset.id);
        // Antes llamaba a obtenerExpedientePorId (no existe) y a
        // actualizarExpediente(expediente) con firma incorrecta — el reorden
        // TSJ fallaba silenciosamente. Se usa la misma firma que la versión PJF.
        await actualizarExpediente(id, { orden: i });
    }

    // Propagar el nuevo orden a los demás dispositivos vinculados
    if (typeof marcarYSincronizar === 'function') await marcarYSincronizar();
}

function actualizarExpedientesRecientes(expedientes) {
    const container = document.getElementById('expedientes-recientes');
    const recientes = expedientes.slice(0, 5);

    if (recientes.length === 0) {
        container.innerHTML = `
            <div class="empty-state small">
                <span>📂</span>
                <p>No hay expedientes</p>
            </div>
        `;
        return;
    }

    container.innerHTML = recientes.map(exp => `
        <div class="list-item">
            <div class="list-item-info">
                <span class="list-item-title">${escapeText(exp.numero || exp.nombre)}</span>
                <span class="list-item-subtitle">${escapeText(exp.juzgado)}</span>
            </div>
        </div>
    `).join('');
}

function actualizarSelectExpedientes() {
    obtenerExpedientes().then(expedientes => {
        const select = document.getElementById('filtro-expediente-nota');
        if (select) {
            select.innerHTML = '<option value="">Todos</option>' +
                '<option value="__general__">📋 Generales (sin expediente)</option>' +
                '<option value="__custom__">✏️ Personalizados</option>' +
                expedientes.map(e => `<option value="${e.id}">${escapeText(e.numero || e.nombre)}</option>`).join('');
        }
    });
}

// ==================== CARPETAS (AGRUPACIÓN DE CASOS) ====================
// Una carpeta agrupa expedientes del mismo caso (principal + amparo + recursos).
// Relación 1:N — un expediente pertenece a una sola carpeta (o ninguna).
// Una carpeta puede mezclar instituciones (TSJ + PJF + OTRO).

let _carpetasCache = null;

async function refrescarCarpetasCache() {
    _carpetasCache = await obtenerCarpetas();
    return _carpetasCache;
}

function obtenerCarpetasDeCache() {
    return _carpetasCache || [];
}

// Devuelve un color válido (#RRGGBB) o el default. Sanitiza el valor para evitar
// inyección CSS/HTML cuando el color viene de sync remoto (un blob manipulado
// podría intentar romper la cadena de estilo inline).
// Normaliza un nombre de carpeta para comparación (debe coincidir con
// _claveCarpeta de sync.js: trim, lowercase, sin acentos, espacios colapsados).
function _claveNombreCarpetaLocal(nombre) {
    if (!nombre) return '';
    return String(nombre).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ');
}

function colorCarpeta(carpeta) {
    const c = carpeta && carpeta.color;
    if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
    return '#6c757d';
}

// Refrescar todos los selects/filtros/forms que muestran carpetas. Llamar tras
// crear, editar o eliminar carpetas.
async function cargarCarpetasUI() {
    await refrescarCarpetasCache();
    const activas = obtenerCarpetasDeCache().filter(c => !c.archivada)
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    // Filtro carpetas en TSJ y PJF
    const optsHTML = '<option value="">Todas las carpetas</option>' +
        '<option value="__sin__">📂 Sin carpeta</option>' +
        activas.map(c =>
            `<option value="${c.id}">📁 ${escapeText(c.nombre)}</option>`
        ).join('');

    const ftTSJ = document.getElementById('filtro-carpeta');
    if (ftTSJ) {
        const prev = ftTSJ.value;
        ftTSJ.innerHTML = optsHTML;
        if (prev) ftTSJ.value = prev;
    }
    const ftPJF = document.getElementById('filtro-carpeta-pjf');
    if (ftPJF) {
        const prev = ftPJF.value;
        ftPJF.innerHTML = optsHTML;
        if (prev) ftPJF.value = prev;
    }

    // Select en el formulario de crear/editar expediente
    const formSelect = document.getElementById('expediente-carpeta');
    if (formSelect) {
        const prev = formSelect.value;
        formSelect.innerHTML = '<option value="">— Sin carpeta —</option>' +
            activas.map(c =>
                `<option value="${c.id}">📁 ${escapeText(c.nombre)}</option>`
            ).join('');
        if (prev) formSelect.value = prev;
    }
}

// ==================== MODAL DE GESTIÓN DE CARPETAS ====================

async function abrirGestionCarpetas() {
    await refrescarCarpetasCache();
    const carpetas = obtenerCarpetasDeCache()
        .sort((a, b) => {
            // Archivadas al final
            if (!!a.archivada !== !!b.archivada) return a.archivada ? 1 : -1;
            return (a.nombre || '').localeCompare(b.nombre || '');
        });

    // Para cada carpeta, contar cuántos expedientes tiene asignados (activos)
    const todosExpedientes = await obtenerExpedientes();
    const archivados = typeof obtenerExpedientesArchivados === 'function' ? await obtenerExpedientesArchivados() : [];
    const todos = [...todosExpedientes, ...archivados];
    const conteoPorCarpeta = new Map();
    for (const exp of todos) {
        if (exp.carpetaId !== undefined && exp.carpetaId !== null) {
            conteoPorCarpeta.set(exp.carpetaId, (conteoPorCarpeta.get(exp.carpetaId) || 0) + 1);
        }
    }

    document.getElementById('modal-titulo').textContent = '📁 Gestión de carpetas';

    let html = `
        <div style="padding: 10px 0;">
            <p style="margin-bottom: 1rem; color:#555;">Agrupa expedientes que pertenecen al mismo caso (principal + amparo + recursos, etc.).</p>

            <div style="border:1px solid #ddd; border-radius:6px; padding:0.75rem; margin-bottom:1rem; background:#fafafa;">
                <h4 style="margin:0 0 0.5rem; font-size:0.95rem;">Crear nueva carpeta</h4>
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:flex-end;">
                    <div style="flex:1; min-width:180px;">
                        <label for="nueva-carpeta-nombre" style="display:block; font-size:0.85rem; color:#555;">Nombre</label>
                        <input type="text" id="nueva-carpeta-nombre" class="form-control" placeholder="Ej. Caso Pérez vs IMSS">
                    </div>
                    <div>
                        <label for="nueva-carpeta-color" style="display:block; font-size:0.85rem; color:#555;">Color</label>
                        <input type="color" id="nueva-carpeta-color" value="#3b82f6" style="width:48px; height:38px; border:1px solid #ccc; border-radius:4px; padding:2px; cursor:pointer;">
                    </div>
                    <button class="btn btn-primary" onclick="crearCarpetaDesdeModal()">➕ Crear</button>
                </div>
            </div>
    `;

    if (carpetas.length === 0) {
        html += '<p style="text-align:center; color:#888; padding:1rem;">No hay carpetas todavía. Crea la primera arriba.</p>';
    } else {
        html += '<div style="display:flex; flex-direction:column; gap:0.5rem;">';
        for (const c of carpetas) {
            const cnt = conteoPorCarpeta.get(c.id) || 0;
            const archivedStyle = c.archivada ? 'opacity:0.6;' : '';
            html += `
                <div style="border:1px solid #ddd; border-radius:6px; padding:0.6rem; display:flex; gap:0.5rem; align-items:center; ${archivedStyle}">
                    <div style="width:18px; height:36px; border-radius:3px; background:${colorCarpeta(c)}; flex-shrink:0;" title="Color"></div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600;">${escapeText(c.nombre || 'Sin nombre')} ${c.archivada ? '<span style="font-size:0.75rem; color:#888;">(archivada)</span>' : ''}</div>
                        <div style="font-size:0.8rem; color:#666;">${cnt} expediente${cnt !== 1 ? 's' : ''} ${c.comentario ? '· ' + escapeText(c.comentario) : ''}</div>
                    </div>
                    <div style="display:flex; gap:0.25rem; flex-shrink:0;">
                        <button class="btn btn-sm btn-secondary" onclick="editarCarpetaDesdeModal(${c.id})" title="Editar">✏️</button>
                        ${c.archivada
                            ? `<button class="btn btn-sm btn-info" onclick="desarchivarCarpetaDesdeModal(${c.id})" title="Restaurar">♻️</button>`
                            : `<button class="btn btn-sm btn-warning" onclick="archivarCarpetaDesdeModal(${c.id})" title="Archivar carpeta y sus expedientes">📦</button>`
                        }
                        <button class="btn btn-sm btn-danger" onclick="eliminarCarpetaDesdeModal(${c.id}, ${cnt})" title="Eliminar carpeta">🗑️</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
    }

    html += '</div>';
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>';
    abrirModal();

    setTimeout(() => {
        const input = document.getElementById('nueva-carpeta-nombre');
        if (input) input.focus();
    }, 100);
}

async function crearCarpetaDesdeModal() {
    const nombre = document.getElementById('nueva-carpeta-nombre')?.value?.trim();
    const color = document.getElementById('nueva-carpeta-color')?.value || '#3b82f6';
    if (!nombre) {
        mostrarToast('El nombre es obligatorio', 'warning');
        return;
    }
    // Validar duplicado por nombre normalizado para evitar que el sync luego
    // las "fusione" en una sola (perdiendo color/comentario de la duplicada).
    const claveNueva = _claveNombreCarpetaLocal(nombre);
    const existente = obtenerCarpetasDeCache().find(c => _claveNombreCarpetaLocal(c.nombre) === claveNueva);
    if (existente) {
        mostrarToast(`Ya existe una carpeta llamada "${existente.nombre}"`, 'warning');
        return;
    }
    try {
        await agregarCarpeta({ nombre, color, comentario: '' });
        mostrarToast('Carpeta creada', 'success');
        await cargarCarpetasUI();
        await abrirGestionCarpetas();
        if (typeof marcarYSincronizar === 'function') marcarYSincronizar();
    } catch (e) {
        mostrarToast('Error al crear carpeta: ' + e.message, 'error');
    }
}

async function editarCarpetaDesdeModal(id) {
    const carpeta = await obtenerCarpeta(id);
    if (!carpeta) return;

    document.getElementById('modal-titulo').textContent = '✏️ Editar carpeta';
    document.getElementById('modal-body').innerHTML = `
        <div style="padding:10px 0; display:flex; flex-direction:column; gap:0.75rem;">
            <div class="form-group">
                <label for="edit-carpeta-nombre">Nombre</label>
                <input type="text" id="edit-carpeta-nombre" class="form-control" value="${escapeText(carpeta.nombre || '')}">
            </div>
            <div class="form-group">
                <label for="edit-carpeta-comentario">Comentario / descripción del caso (opcional)</label>
                <textarea id="edit-carpeta-comentario" class="form-control" rows="3">${escapeText(carpeta.comentario || '')}</textarea>
            </div>
            <div class="form-group">
                <label for="edit-carpeta-color">Color</label>
                <input type="color" id="edit-carpeta-color" value="${escapeText(colorCarpeta(carpeta))}" style="width:60px; height:38px; border:1px solid #ccc; border-radius:4px; padding:2px; cursor:pointer;">
            </div>
        </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="abrirGestionCarpetas()">Cancelar</button>
        <button class="btn btn-primary" onclick="guardarCarpetaDesdeModal(${id})">💾 Guardar</button>
    `;
}

async function guardarCarpetaDesdeModal(id) {
    const nombre = document.getElementById('edit-carpeta-nombre')?.value?.trim();
    const comentario = document.getElementById('edit-carpeta-comentario')?.value?.trim() || '';
    const color = document.getElementById('edit-carpeta-color')?.value || '#3b82f6';
    if (!nombre) {
        mostrarToast('El nombre es obligatorio', 'warning');
        return;
    }
    // Si el nombre cambió, verificar que no choque con otra carpeta existente.
    const claveNueva = _claveNombreCarpetaLocal(nombre);
    const choque = obtenerCarpetasDeCache().find(c =>
        c.id !== id && _claveNombreCarpetaLocal(c.nombre) === claveNueva
    );
    if (choque) {
        mostrarToast(`Ya existe otra carpeta llamada "${choque.nombre}"`, 'warning');
        return;
    }
    try {
        await actualizarCarpeta(id, { nombre, comentario, color });
        mostrarToast('Carpeta actualizada', 'success');
        await cargarCarpetasUI();
        await cargarExpedientes();
        if (typeof cargarExpedientesPJF === 'function') await cargarExpedientesPJF();
        await abrirGestionCarpetas();
        if (typeof marcarYSincronizar === 'function') marcarYSincronizar();
    } catch (e) {
        mostrarToast('Error al guardar: ' + e.message, 'error');
    }
}

async function archivarCarpetaDesdeModal(id) {
    const motivo = prompt('Motivo del archivo (concluido / abandonado / otro):', 'concluido');
    if (!motivo) return;
    const etiqueta = motivo === 'otro' ? (prompt('Describe el motivo:') || 'Sin especificar') : '';
    try {
        await archivarCarpeta(id, motivo, etiqueta);
        mostrarToast('Carpeta archivada con sus expedientes', 'success');
        await cargarCarpetasUI();
        await cargarExpedientes();
        if (typeof cargarExpedientesPJF === 'function') await cargarExpedientesPJF();
        if (typeof actualizarBadgeArchivo === 'function') actualizarBadgeArchivo();
        if (typeof actualizarBadgeArchivoPJF === 'function') actualizarBadgeArchivoPJF();
        await abrirGestionCarpetas();
        if (typeof marcarYSincronizar === 'function') marcarYSincronizar();
    } catch (e) {
        mostrarToast('Error al archivar: ' + e.message, 'error');
    }
}

async function desarchivarCarpetaDesdeModal(id) {
    try {
        await desarchivarCarpeta(id);
        mostrarToast('Carpeta restaurada', 'success');
        await cargarCarpetasUI();
        await abrirGestionCarpetas();
        if (typeof marcarYSincronizar === 'function') marcarYSincronizar();
    } catch (e) {
        mostrarToast('Error al restaurar: ' + e.message, 'error');
    }
}

async function eliminarCarpetaDesdeModal(id, conteo) {
    let conExpedientes = false;
    if (conteo > 0) {
        // Dos preguntas en serie para que "Cancelar" siempre aborte y "Aceptar"
        // pida confirmación explícita de si los expedientes deben borrarse también.
        if (!confirm(
            `La carpeta tiene ${conteo} expediente${conteo !== 1 ? 's' : ''} asignado${conteo !== 1 ? 's' : ''}.\n\n` +
            '¿Eliminar la carpeta? (esta acción no se puede deshacer)'
        )) return;
        conExpedientes = confirm(
            '¿Borrar también los expedientes asignados a la carpeta?\n\n' +
            'Aceptar: borra carpeta + expedientes.\n' +
            'Cancelar: borra solo la carpeta, los expedientes quedan sueltos.'
        );
    } else {
        if (!confirm('¿Eliminar la carpeta?')) return;
    }

    try {
        await eliminarCarpeta(id, conExpedientes);
        mostrarToast(conExpedientes ? 'Carpeta y expedientes eliminados' : 'Carpeta eliminada', 'success');
        await cargarCarpetasUI();
        await cargarExpedientes();
        if (typeof cargarExpedientesPJF === 'function') await cargarExpedientesPJF();
        await abrirGestionCarpetas();
        if (typeof marcarYSincronizar === 'function') marcarYSincronizar();
    } catch (e) {
        mostrarToast('Error al eliminar: ' + e.message, 'error');
    }
}

window.abrirGestionCarpetas = abrirGestionCarpetas;
window.crearCarpetaDesdeModal = crearCarpetaDesdeModal;
window.editarCarpetaDesdeModal = editarCarpetaDesdeModal;
window.guardarCarpetaDesdeModal = guardarCarpetaDesdeModal;
window.archivarCarpetaDesdeModal = archivarCarpetaDesdeModal;
window.desarchivarCarpetaDesdeModal = desarchivarCarpetaDesdeModal;
window.eliminarCarpetaDesdeModal = eliminarCarpetaDesdeModal;
window.cargarCarpetasUI = cargarCarpetasUI;

function mostrarFormularioExpediente() {
    document.getElementById('form-expediente').style.display = 'block';
    document.getElementById('form-expediente-titulo').textContent = 'Agregar Nuevo Expediente';
    document.getElementById('expediente-id').value = '';
    document.getElementById('expediente-form').reset();
    // Repoblar select de carpetas (form.reset() lo deja con sus options actuales,
    // pero queremos asegurar que estén al día por si se acabaron de crear nuevas).
    if (typeof cargarCarpetasUI === 'function') cargarCarpetasUI();
}

function cerrarFormularioExpediente() {
    const formContainer = document.getElementById('form-expediente');
    const form = document.getElementById('expediente-form');
    const submitBtn = form?.querySelector('button[type="submit"]');

    // Restaurar botón si estaba deshabilitado
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '💾 Guardar';
    }

    // Resetear formulario
    if (form) form.reset();
    document.getElementById('expediente-id').value = '';

    // Ocultar formulario
    formContainer.style.display = 'none';
}

async function editarExpediente(id, event) {
    // Prevenir propagación del evento (fix para Firefox)
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    try {
        const exp = await obtenerExpediente(id);
        if (!exp) {
            mostrarToast('Expediente no encontrado', 'error');
            return;
        }

        const formContainer = document.getElementById('form-expediente');
        if (!formContainer) {
            Logger.error('Formulario no encontrado');
            return;
        }

        formContainer.style.display = 'block';
        document.getElementById('form-expediente-titulo').textContent = 'Editar Expediente';
        document.getElementById('expediente-id').value = id;
        document.getElementById('expediente-valor').value = exp.numero || exp.nombre;
        document.getElementById('expediente-comentario').value = exp.comentario || '';
        // Refrescar el select de carpetas y seleccionar la del expediente
        if (typeof cargarCarpetasUI === 'function') await cargarCarpetasUI();
        const selCarpeta = document.getElementById('expediente-carpeta');
        if (selCarpeta) selCarpeta.value = exp.carpetaId !== undefined && exp.carpetaId !== null ? String(exp.carpetaId) : '';

        // Set institution
        const institucion = exp.institucion || 'TSJ';
        const instRadio = document.querySelector(`input[name="expediente-institucion"][value="${institucion}"]`);
        if (instRadio) {
            instRadio.checked = true;
            cambiarInstitucionExpediente();
        }

        if (institucion === 'PJF') {
            document.getElementById('expediente-juzgado').value = '';
            // Restore PJF cascade: find the organ by name and set circuit + organ + tipo de asunto
            await restaurarCascadaPJFParaEdicion(exp.juzgado, exp.pjfTipoAsunto);
        } else if (institucion === 'OTRO') {
            const autoridadInput = document.getElementById('expediente-autoridad');
            if (autoridadInput) autoridadInput.value = exp.juzgado || '';
        } else {
            document.getElementById('expediente-juzgado').value = exp.juzgado;
        }

        const tipo = exp.numero ? 'numero' : 'nombre';
        document.querySelector(`input[name="tipo-busqueda"][value="${tipo}"]`).checked = true;

        // Scroll al formulario
        formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        Logger.error('Error al editar expediente:', error);
        mostrarToast('Error al cargar expediente', 'error');
    }
}

async function guardarExpediente(event) {
    event.preventDefault();

    // Prevenir múltiples clicks
    const form = document.getElementById('expediente-form');
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn && submitBtn.disabled) return;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="loading-spinner"></span> Guardando...';
    }

    try {
        const id = document.getElementById('expediente-id').value;
        const tipoBusqueda = document.querySelector('input[name="tipo-busqueda"]:checked').value;
        const valor = document.getElementById('expediente-valor').value.trim();
        const comentario = document.getElementById('expediente-comentario').value.trim();
        const carpetaSel = document.getElementById('expediente-carpeta')?.value || '';
        const carpetaId = carpetaSel ? parseInt(carpetaSel, 10) : undefined;
        const institucion = document.querySelector('input[name="expediente-institucion"]:checked')?.value || 'TSJ';

        let juzgado = '';
        if (institucion === 'PJF') {
            const organoSelect = document.getElementById('expediente-organo-pjf');
            juzgado = organoSelect?.options[organoSelect.selectedIndex]?.text || '';
            if (!juzgado || organoSelect.value === '') {
                // Allow manual text if no organ selected
                juzgado = 'PJF - Por determinar';
            }
        } else if (institucion === 'OTRO') {
            juzgado = document.getElementById('expediente-autoridad').value.trim() || 'Autoridad no especificada';
        } else {
            juzgado = document.getElementById('expediente-juzgado').value;
        }

        if (!valor || (!juzgado && institucion === 'TSJ')) {
            mostrarToast('Completa todos los campos requeridos', 'error');
            return;
        }

        // Verificar límite si es nuevo expediente
        if (!id) {
            const permitido = await verificarLimiteExpedientes();
            if (!permitido) return;
        }

        // La categoría la calcula el núcleo de acciones (regla única)
        const expediente = {
            juzgado,
            institucion: institucion,
            comentario: comentario || undefined,
            carpetaId: carpetaId
        };

        if (institucion === 'PJF') {
            const orgId = document.getElementById('expediente-organo-pjf')?.value;
            if (orgId) expediente.pjfOrgId = orgId;

            const tipoSelect = document.getElementById('expediente-tipo-asunto-pjf');
            if (tipoSelect && tipoSelect.value && tipoSelect.value !== '__manual__') {
                expediente.pjfTipoAsunto = tipoSelect.value;
            } else {
                const tipoManual = document.getElementById('expediente-tipo-asunto-manual')?.value?.trim();
                if (tipoManual) expediente.pjfTipoAsunto = tipoManual;
            }
        }

        if (tipoBusqueda === 'numero') {
            expediente.numero = valor;
        } else {
            expediente.nombre = valor;
        }

        // Guardado, refresco y sync centralizados en el núcleo de acciones
        // (mismo camino que el asistente de voz).
        if (id) {
            await actualizarExpedienteCore(parseInt(id), expediente);
            mostrarToast('Expediente actualizado', 'success');
        } else {
            await crearExpedienteCore(expediente);
            mostrarToast('Expediente agregado', 'success');
        }

        cerrarFormularioExpediente();
    } catch (error) {
        mostrarToast('Error al guardar: ' + error.message, 'error');
    } finally {
        // Restaurar botón
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '💾 Guardar';
        }
    }
}

// Texto que enumera lo que se irá junto con el expediente. Borrar en silencio
// las notas y pendientes de un caso sería una sorpresa desagradable.
async function _avisoDependientesExpediente(id) {
    if (typeof contarRegistrosDeExpediente !== 'function') return '';
    const c = await contarRegistrosDeExpediente(id).catch(() => null);
    if (!c) return '';
    const partes = [];
    if (c.pendientes) partes.push(`${c.pendientes} pendiente${c.pendientes !== 1 ? 's' : ''}`);
    if (c.notas) partes.push(`${c.notas} nota${c.notas !== 1 ? 's' : ''}`);
    if (c.eventos) partes.push(`${c.eventos} evento${c.eventos !== 1 ? 's' : ''} de calendario`);
    if (partes.length === 0) return '';
    return `\n\nTambién se eliminará: ${partes.join(', ')}.`;
}

async function confirmarEliminarExpediente(id, event) {
    // Prevenir propagación del evento
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const aviso = await _avisoDependientesExpediente(id);
    if (!confirm('¿Estás seguro de eliminar este expediente?' + aviso)) return;

    try {
        // Por el núcleo, que arrastra notas, eventos y pendientes en cascada.
        await eliminarExpedienteCore(id, true);
        mostrarToast('Expediente eliminado', 'success');
        const archivoVisible = document.getElementById('archivo-section')?.style.display === 'block';
        if (archivoVisible) await cargarArchivo();
    } catch (err) {
        Logger.error('Error al eliminar expediente:', err);
        mostrarToast('Error al eliminar: ' + (err.message || 'Error desconocido'), 'error');
    }
}

// ==================== ARCHIVO DE EXPEDIENTES ====================

function mostrarDialogoArchivar(id, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }

    document.getElementById('modal-titulo').textContent = '📦 Archivar Expediente';
    document.getElementById('modal-body').innerHTML = `
        <div style="padding: 10px 0;">
            <p style="margin-bottom: 15px;">Selecciona el motivo para archivar este expediente:</p>
            <div class="form-group">
                <label for="motivo-archivo">Motivo</label>
                <select id="motivo-archivo" class="form-control" onchange="toggleEtiquetaArchivo()">
                    <option value="concluido">Concluido</option>
                    <option value="abandonado">Abandonado</option>
                    <option value="otro">Otro</option>
                </select>
            </div>
            <div class="form-group" id="grupo-etiqueta-archivo" style="display: none;">
                <label for="etiqueta-archivo">Describe el motivo</label>
                <input type="text" id="etiqueta-archivo" class="form-control" placeholder="Ej: Desistimiento, acumulado a otro expediente...">
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
                <button class="btn btn-warning" onclick="ejecutarArchivar(${id})">📦 Archivar</button>
            </div>
        </div>
    `;
    document.getElementById('modal-footer').innerHTML = '';
    abrirModal();
}

function toggleEtiquetaArchivo() {
    const motivo = document.getElementById('motivo-archivo').value;
    const grupo = document.getElementById('grupo-etiqueta-archivo');
    if (grupo) {
        grupo.style.display = motivo === 'otro' ? 'block' : 'none';
    }
}

async function ejecutarArchivar(id) {
    const motivo = document.getElementById('motivo-archivo').value;
    const etiqueta = motivo === 'otro' ? (document.getElementById('etiqueta-archivo')?.value?.trim() || 'Sin especificar') : '';

    try {
        await archivarExpedienteDB(id, true, motivo, etiqueta);
        cerrarModal();
        mostrarToast('Expediente archivado', 'success');
        await Promise.all([cargarExpedientes(), cargarExpedientesPJF(), cargarEstadisticas()]);
        // Sincronizar cambio con otros dispositivos
        if (typeof marcarYSincronizar === 'function') await marcarYSincronizar();
    } catch (err) {
        mostrarToast('Error al archivar: ' + (err.message || 'Error desconocido'), 'error');
    }
}

async function desarchivarExpediente(id, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }

    if (!confirm('¿Restaurar este expediente al listado activo?')) return;

    try {
        await archivarExpedienteDB(id, false);
        mostrarToast('Expediente restaurado', 'success');
        // Refrescar ambos archivos y listas
        const archivoTSJVisible = document.getElementById('archivo-section')?.style.display === 'block';
        const archivoPJFVisible = document.getElementById('archivo-section-pjf')?.style.display === 'block';
        if (archivoTSJVisible) await cargarArchivo();
        if (archivoPJFVisible) await cargarArchivoPJF();
        await Promise.all([cargarExpedientes(), cargarExpedientesPJF(), cargarEstadisticas()]);
        // Sincronizar cambio con otros dispositivos
        if (typeof marcarYSincronizar === 'function') await marcarYSincronizar();
    } catch (err) {
        mostrarToast('Error al restaurar: ' + (err.message || 'Error desconocido'), 'error');
    }
}

function abrirArchivo() {
    // Ocultar contenido normal de expedientes
    document.getElementById('lista-expedientes').style.display = 'none';
    document.getElementById('tabla-expedientes').style.display = 'none';
    document.querySelector('#page-expedientes .filters-section').style.display = 'none';
    document.getElementById('archivo-toggle').style.display = 'none';

    // Ocultar formulario si está abierto
    const formContainer = document.getElementById('formulario-expediente');
    if (formContainer) formContainer.style.display = 'none';

    // Mostrar sección de archivo
    document.getElementById('archivo-section').style.display = 'block';
    cargarArchivo();
}

function cerrarArchivo() {
    document.getElementById('archivo-section').style.display = 'none';
    document.getElementById('archivo-toggle').style.display = 'block';
    document.querySelector('#page-expedientes .filters-section').style.display = '';
    aplicarVistaExpedientes();
}

// Núcleo compartido de carga de archivo (usado por TSJ y PJF)
async function _cargarArchivoComun({ listaId, countId, soloPJF, mensajeVacio }) {
    let archivados = await obtenerExpedientesArchivados();
    if (soloPJF) archivados = archivados.filter(e => e.institucion === 'PJF');

    const lista = document.getElementById(listaId);
    const count = document.getElementById(countId);
    if (!lista) return;

    if (archivados.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📦</span>
                <h3>Archivo vacío</h3>
                <p>${mensajeVacio}</p>
            </div>
        `;
    } else {
        lista.innerHTML = archivados.map(exp => renderCardArchivado(exp)).join('');
    }

    if (count) count.textContent = `${archivados.length} archivado${archivados.length !== 1 ? 's' : ''}`;
}

async function cargarArchivo() {
    return _cargarArchivoComun({
        listaId: 'lista-archivo',
        countId: 'count-archivo',
        soloPJF: false,
        mensajeVacio: 'No hay expedientes archivados'
    });
}

function renderCardArchivado(exp) {
    const motivoLabel = exp.motivoArchivo === 'concluido' ? 'Concluido'
                      : exp.motivoArchivo === 'abandonado' ? 'Abandonado'
                      : exp.etiquetaArchivo || 'Otro';
    const motivoClass = exp.motivoArchivo === 'concluido' ? 'motivo-concluido'
                      : exp.motivoArchivo === 'abandonado' ? 'motivo-abandonado'
                      : 'motivo-otro';

    const instBadge = exp.institucion === 'PJF'
        ? '<span class="institucion-badge pjf">🏛️ PJF</span>'
        : exp.institucion === 'OTRO'
        ? '<span class="institucion-badge otro">📋 Varios</span>'
        : '<span class="institucion-badge tsj">⚖️ TSJ</span>';

    return `
    <div class="expediente-card archivo-card" data-id="${exp.id}">
        <div class="expediente-header">
            <span class="expediente-tipo">${exp.numero ? '🔢' : '👤'}</span>
            ${instBadge}
            ${_badgeCarpetaHTML(exp.carpetaId)}
            <span class="archivo-motivo-badge ${motivoClass}">${motivoLabel}</span>
        </div>
        <div class="expediente-body">
            <h3 class="expediente-titulo">${escapeText(exp.numero || exp.nombre)}</h3>
            <p class="expediente-juzgado">${escapeText(exp.juzgado)}</p>
            ${exp.comentario ? `<p class="expediente-comentario">${escapeText(exp.comentario)}</p>` : ''}
            <p class="expediente-fecha-archivo">Archivado: ${formatearFecha(exp.fechaArchivo)}</p>
        </div>
        <div class="expediente-footer">
            <span class="expediente-fecha">Creado: ${formatearFecha(exp.fechaCreacion)}</span>
            <div class="expediente-actions">
                <button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Ver historial">📜</button>
                <button class="btn btn-sm btn-success" onclick="desarchivarExpediente(${exp.id}, event)" title="Restaurar">♻️</button>
                <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpediente(${exp.id}, event)">🗑️</button>
            </div>
        </div>
    </div>
    `;
}

// ==================== RENDERERS COMPARTIDOS TSJ/PJF ====================
// Helpers para no duplicar las plantillas de tarjetas y filas entre TSJ y PJF.
// Antes había 4 copias del template (cargarExpedientes, filtrarExpedientes y
// los dos gemelos PJF), todas con riesgo de divergir al editar.

function _badgeInstitucionHTML(institucion) {
    if (institucion === 'PJF') return '<span class="institucion-badge pjf">🏛️ PJF</span>';
    if (institucion === 'OTRO') return '<span class="institucion-badge otro">📋 Varios</span>';
    return '<span class="institucion-badge tsj">⚖️ TSJ</span>';
}

function _labelInstitucionCorto(institucion) {
    if (institucion === 'PJF') return '🏛️ PJF';
    if (institucion === 'OTRO') return '📋 Varios';
    return '⚖️ TSJ';
}

// Badge de carpeta para mostrar en la tarjeta / fila si el expediente
// pertenece a una. Usa el caché de carpetas para no leer la DB en cada render.
function _badgeCarpetaHTML(carpetaId) {
    if (carpetaId === undefined || carpetaId === null) return '';
    const carpetas = obtenerCarpetasDeCache();
    const carpeta = carpetas.find(c => c.id === carpetaId);
    if (!carpeta) return '';
    const color = colorCarpeta(carpeta); // sanitizado: #RRGGBB válido o default
    return `<span class="carpeta-badge" style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:10px; background:${color}22; border:1px solid ${color}; color:${color}; font-size:0.75rem; font-weight:500;" title="Carpeta: ${escapeText(carpeta.nombre || '')}">📁 ${escapeText(carpeta.nombre || '')}</span>`;
}

// Render de una tarjeta de expediente activo.
// opciones:
//   institucion: 'TSJ' | 'PJF' | 'OTRO' (default: exp.institucion || 'TSJ')
//   draggable: muestra drag-handle y atributo draggable. Default false.
//   orden: número para data-orden (cuando se permite reordenar).
//   selectable / selected: modo selección PJF.
//   showSearchBtn: incluye botón "🔍 Buscar en PJF".
//   editarFn / eliminarFn: nombre de la función JS a invocar.
//   categoriaDefault: texto cuando exp.categoria está vacío.
function renderTarjetaExpedienteHTML(exp, opciones = {}) {
    const institucion = opciones.institucion || exp.institucion || 'TSJ';
    const draggable = !!opciones.draggable;
    const orden = opciones.orden;
    const selectable = !!opciones.selectable;
    const selected = !!opciones.selected;
    const showSearchBtn = !!opciones.showSearchBtn;
    const editarFn = opciones.editarFn || 'editarExpediente';
    const eliminarFn = opciones.eliminarFn || 'confirmarEliminarExpediente';
    const categoriaDefault = opciones.categoriaDefault || (institucion === 'PJF' ? 'PJF Federal' : 'General');

    // Distintivo con los pendientes sin terminar del expediente.
    const abiertos = typeof pendientesAbiertosDeExpediente === 'function'
        ? pendientesAbiertosDeExpediente(exp.id) : 0;
    const badgePendientes = abiertos > 0
        ? `<span class="expediente-pendientes-badge" title="${abiertos} pendiente${abiertos !== 1 ? 's' : ''} por hacer" onclick="verPendientesDeExpediente(${exp.id}, event)">✅ ${abiertos}</span>`
        : '';

    const ordenAttr = orden !== undefined ? ` data-orden="${orden}"` : '';
    const draggableAttr = draggable && !selectable ? ' draggable="true"' : (selectable ? ' draggable="false"' : '');
    const cardClasses = `expediente-card${selectable ? ' selection-mode' : ''}`;

    let leadingControl = '';
    if (selectable) {
        leadingControl = `
            <div class="pjf-checkbox-wrap" onclick="event.stopPropagation()" style="display:flex;align-items:center;padding:0.4rem 0.5rem 0;">
                <input type="checkbox" class="pjf-check" data-exp-id="${exp.id}"
                    ${selected ? 'checked' : ''}
                    onchange="toggleSeleccionExpedientePJF(${exp.id}, this)"
                    style="width:1.2rem;height:1.2rem;cursor:pointer;accent-color:var(--primary,#366092);">
                <span style="font-size:0.8rem;margin-left:0.4rem;color:var(--text-secondary,#6c757d);">Seleccionar</span>
            </div>`;
    } else if (draggable) {
        leadingControl = '<div class="drag-handle" title="Arrastra para reordenar">⋮⋮</div>';
    }

    let actionsHTML = '';
    if (!selectable) {
        if (showSearchBtn) {
            actionsHTML += `<button class="btn btn-sm btn-primary" onclick="abrirBusquedaPJFGuardado(${exp.id}, event)" title="Buscar en PJF">🔍 Buscar</button>`;
        }
        actionsHTML += `<button class="btn btn-sm btn-info" onclick="verPendientesDeExpediente(${exp.id}, event)" title="Ver pendientes">✅</button>`;
        actionsHTML += `<button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Ver historial">📜</button>`;
        actionsHTML += `<button class="btn btn-sm btn-info" onclick="verTimelineExpediente(${exp.id}, event)" title="Ver timeline">📅</button>`;
        actionsHTML += `<button class="btn btn-sm btn-secondary" onclick="${editarFn}(${exp.id}, event)">✏️</button>`;
        actionsHTML += `<button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>`;
        actionsHTML += `<button class="btn btn-sm btn-danger" onclick="${eliminarFn}(${exp.id}, event)">🗑️</button>`;
    }

    return `
        <div class="${cardClasses}" data-id="${exp.id}"${ordenAttr}${draggableAttr}
             onclick="_clicEnTarjetaExpediente(event, ${exp.id})">
            ${leadingControl}
            <div class="expediente-header">
                <span class="expediente-tipo">${exp.numero ? '🔢' : '👤'}</span>
                ${_badgeInstitucionHTML(institucion)}
                ${_badgeCarpetaHTML(exp.carpetaId)}
                ${badgePendientes}
                <span class="expediente-categoria">${escapeText(exp.categoria || categoriaDefault)}</span>
            </div>
            <div class="expediente-body">
                <h3 class="expediente-titulo">${escapeText(exp.numero || exp.nombre)}</h3>
                <p class="expediente-juzgado">${escapeText(exp.juzgado)}</p>
                ${exp.comentario ? `<p class="expediente-comentario">${escapeText(exp.comentario)}</p>` : ''}
            </div>
            <div class="expediente-footer">
                <span class="expediente-fecha">${formatearFecha(exp.fechaCreacion)}</span>
                <div class="expediente-actions">${actionsHTML}</div>
            </div>
        </div>`;
}

// Render de una fila de tabla.
// opciones:
//   institucion: igual que en tarjeta.
//   showInstColumn: incluir columna de institución (TSJ la usa, PJF no — todas son PJF).
//   showSearchBtn: incluir botón "🔍 Buscar en PJF".
//   editarFn / eliminarFn: función JS a invocar.
//   categoriaDefault.
function renderFilaExpedienteHTML(exp, opciones = {}) {
    const institucion = opciones.institucion || exp.institucion || 'TSJ';
    const showInstColumn = opciones.showInstColumn !== false;
    const showSearchBtn = !!opciones.showSearchBtn;
    const editarFn = opciones.editarFn || 'editarExpediente';
    const eliminarFn = opciones.eliminarFn || 'confirmarEliminarExpediente';
    const categoriaDefault = opciones.categoriaDefault || (institucion === 'PJF' ? 'PJF Federal' : 'General');

    const instCell = showInstColumn ? `<td>${_labelInstitucionCorto(institucion)}</td>` : '';

    let actionsHTML = '';
    if (showSearchBtn) {
        actionsHTML += `<button class="btn btn-sm btn-primary" onclick="abrirBusquedaPJFGuardado(${exp.id}, event)" title="Buscar en PJF">🔍</button>`;
    }
    actionsHTML += `<button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Historial">📜</button>`;
    actionsHTML += `<button class="btn btn-sm btn-info" onclick="verTimelineExpediente(${exp.id}, event)" title="Timeline">📅</button>`;
    actionsHTML += `<button class="btn btn-sm btn-secondary" onclick="${editarFn}(${exp.id}, event)">✏️</button>`;
    actionsHTML += `<button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>`;
    actionsHTML += `<button class="btn btn-sm btn-danger" onclick="${eliminarFn}(${exp.id}, event)">🗑️</button>`;

    const carpetaBadge = _badgeCarpetaHTML(exp.carpetaId);
    return `
        <tr data-id="${exp.id}" onclick="_clicEnTarjetaExpediente(event, ${exp.id})">
            <td class="tipo-cell">${exp.numero ? '🔢' : '👤'}</td>
            <td><strong>${escapeText(exp.numero || exp.nombre)}</strong>${carpetaBadge ? ' ' + carpetaBadge : ''}</td>
            <td>${escapeText(exp.juzgado)}</td>
            <td><span class="categoria-badge">${escapeText(exp.categoria || categoriaDefault)}</span></td>
            ${instCell}
            <td class="comentario-cell" title="${escapeText(exp.comentario || '')}">${escapeText(exp.comentario || '-')}</td>
            <td>${formatearFecha(exp.fechaCreacion)}</td>
            <td class="acciones-cell">${actionsHTML}</td>
        </tr>`;
}

// Núcleo compartido de filtro de archivo (usado por TSJ y PJF)
async function _filtrarArchivoComun({ listaId, countId, soloPJF, busquedaId, motivoId, mensajeSinResultados }) {
    const busqueda = (document.getElementById(busquedaId)?.value || '').toLowerCase();
    const motivo = document.getElementById(motivoId)?.value || '';

    let archivados = await obtenerExpedientesArchivados();
    if (soloPJF) archivados = archivados.filter(e => e.institucion === 'PJF');

    if (busqueda) {
        archivados = archivados.filter(e =>
            (e.numero && e.numero.toLowerCase().includes(busqueda)) ||
            (e.nombre && e.nombre.toLowerCase().includes(busqueda)) ||
            (e.juzgado && e.juzgado.toLowerCase().includes(busqueda)) ||
            (e.comentario && e.comentario.toLowerCase().includes(busqueda)) ||
            (e.etiquetaArchivo && e.etiquetaArchivo.toLowerCase().includes(busqueda))
        );
    }

    if (motivo) {
        archivados = archivados.filter(e => e.motivoArchivo === motivo);
    }

    const lista = document.getElementById(listaId);
    const count = document.getElementById(countId);
    if (!lista) return;

    if (archivados.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🔍</span>
                <h3>Sin resultados</h3>
                <p>${mensajeSinResultados}</p>
            </div>
        `;
    } else {
        lista.innerHTML = archivados.map(exp => renderCardArchivado(exp)).join('');
    }

    if (count) count.textContent = `${archivados.length} archivado${archivados.length !== 1 ? 's' : ''}`;
}

async function filtrarArchivo() {
    return _filtrarArchivoComun({
        listaId: 'lista-archivo',
        countId: 'count-archivo',
        soloPJF: false,
        busquedaId: 'buscar-archivo',
        motivoId: 'filtro-motivo-archivo',
        mensajeSinResultados: 'No se encontraron expedientes archivados con esos filtros'
    });
}

// Núcleo compartido del badge de archivo
async function _actualizarBadgeArchivoComun(badgeId, soloPJF) {
    try {
        let archivados = await obtenerExpedientesArchivados();
        if (soloPJF) archivados = archivados.filter(e => e.institucion === 'PJF');
        const badge = document.getElementById(badgeId);
        if (badge) {
            if (archivados.length > 0) {
                badge.textContent = archivados.length;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (e) { /* ignorar */ }
}

async function actualizarBadgeArchivo() {
    return _actualizarBadgeArchivoComun('count-archivo-badge', false);
}

// ==================== ÍNDICE DE BÚSQUEDA EN CACHÉ ====================
// La búsqueda en notas e historial requiere indexar todos los registros por
// expedienteId. Antes se rehacía en CADA keystroke (re-leer IndexedDB + rearmar
// Maps), causando lag visible en iPhone con muchos expedientes. Ahora cacheamos
// los índices y solo los invalidamos cuando notas o historial cambian.
let _searchIndexCache = null;
let _searchIndexVersion = -1;
let _dataMutationCounter = 0;

function invalidarIndiceBusqueda() {
    _dataMutationCounter++;
}
window.invalidarIndiceBusqueda = invalidarIndiceBusqueda;

async function obtenerIndiceBusqueda() {
    if (_searchIndexCache && _searchIndexVersion === _dataMutationCounter) {
        return _searchIndexCache;
    }
    const [notas, historial, pendientes] = await Promise.all([
        obtenerNotas(),
        obtenerTodoHistorial(),
        typeof obtenerPendientes === 'function' ? obtenerPendientes().catch(() => []) : Promise.resolve([])
    ]);
    const notasPorExp = new Map();
    for (const n of notas) {
        const lst = notasPorExp.get(n.expedienteId);
        if (lst) lst.push(n);
        else notasPorExp.set(n.expedienteId, [n]);
    }
    const historialPorExp = new Map();
    for (const h of historial) {
        const lst = historialPorExp.get(h.expedienteId);
        if (lst) lst.push(h);
        else historialPorExp.set(h.expedienteId, [h]);
    }
    const pendientesPorExp = new Map();
    for (const p of pendientes) {
        const lst = pendientesPorExp.get(p.expedienteId);
        if (lst) lst.push(p);
        else pendientesPorExp.set(p.expedienteId, [p]);
    }
    _searchIndexCache = { notasPorExp, historialPorExp, pendientesPorExp };
    _searchIndexVersion = _dataMutationCounter;
    return _searchIndexCache;
}

// Debounce: no filtra en cada keystroke, espera 150ms tras la última pulsación.
let _filtrarTSJTimer = null;
function filtrarExpedientesDebounced() {
    clearTimeout(_filtrarTSJTimer);
    _filtrarTSJTimer = setTimeout(() => filtrarExpedientes(), 150);
}
let _filtrarPJFTimer = null;
function filtrarExpedientesPJFDebounced() {
    clearTimeout(_filtrarPJFTimer);
    _filtrarPJFTimer = setTimeout(() => filtrarExpedientesPJF(), 150);
}
window.filtrarExpedientesDebounced = filtrarExpedientesDebounced;
window.filtrarExpedientesPJFDebounced = filtrarExpedientesPJFDebounced;

async function filtrarExpedientes() {
    const busqueda = document.getElementById('buscar-expediente').value.toLowerCase();
    const categoria = document.getElementById('filtro-categoria').value;
    const carpetaFiltro = document.getElementById('filtro-carpeta')?.value || '';

    let expedientes = await obtenerExpedientes();

    if (carpetaFiltro === '__sin__') {
        expedientes = expedientes.filter(e => e.carpetaId === undefined || e.carpetaId === null);
    } else if (carpetaFiltro) {
        const cid = parseInt(carpetaFiltro, 10);
        expedientes = expedientes.filter(e => e.carpetaId === cid);
    }

    if (busqueda) {
        const { notasPorExp, historialPorExp, pendientesPorExp } = await obtenerIndiceBusqueda();

        expedientes = expedientes.filter(e => {
            // Búsqueda en campos directos del expediente
            if ((e.numero && e.numero.toLowerCase().includes(busqueda)) ||
                (e.nombre && e.nombre.toLowerCase().includes(busqueda)) ||
                (e.juzgado && e.juzgado.toLowerCase().includes(busqueda)) ||
                (e.comentario && e.comentario.toLowerCase().includes(busqueda)) ||
                (e.categoria && e.categoria.toLowerCase().includes(busqueda))) {
                return true;
            }
            // Búsqueda en notas del expediente
            const notas = notasPorExp.get(e.id);
            if (notas) {
                for (const n of notas) {
                    if ((n.titulo && n.titulo.toLowerCase().includes(busqueda)) ||
                        (n.contenido && n.contenido.toLowerCase().includes(busqueda))) {
                        return true;
                    }
                }
            }
            // Búsqueda en pendientes del expediente
            const pendientes = pendientesPorExp.get(e.id);
            if (pendientes) {
                for (const p of pendientes) {
                    if ((p.titulo && p.titulo.toLowerCase().includes(busqueda)) ||
                        (p.descripcion && p.descripcion.toLowerCase().includes(busqueda))) {
                        return true;
                    }
                }
            }
            // Búsqueda en historial/actualizaciones del expediente
            const historial = historialPorExp.get(e.id);
            if (historial) {
                for (const h of historial) {
                    if ((h.descripcion && h.descripcion.toLowerCase().includes(busqueda)) ||
                        (h.detalle && h.detalle.toLowerCase().includes(busqueda))) {
                        return true;
                    }
                }
            }
            return false;
        });
    }

    if (categoria) {
        expedientes = expedientes.filter(e => e.categoria === categoria);
    }

    const lista = document.getElementById('lista-expedientes');
    const count = document.getElementById('count-expedientes');

    if (expedientes.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🔍</span>
                <h3>Sin resultados</h3>
                <p>No se encontraron expedientes con esos filtros</p>
            </div>
        `;
    } else {
        // Renderizar solo la vista activa para no duplicar trabajo.
        if (vistaExpedientes === 'table') {
            const tablaBody = document.getElementById('tabla-expedientes-body');
            if (tablaBody) {
                tablaBody.innerHTML = expedientes.map(exp => renderFilaExpedienteHTML(exp)).join('');
            }
        } else {
            lista.innerHTML = expedientes.map((exp, index) =>
                renderTarjetaExpedienteHTML(exp, { draggable: true, orden: exp.orden || index })
            ).join('');
            // Re-attach drag listeners (innerHTML replacement discards them).
            inicializarDragAndDrop();
        }
    }

    count.textContent = `${expedientes.length} expediente${expedientes.length !== 1 ? 's' : ''}`;
    aplicarVistaExpedientes();
}

// ==================== HISTORIAL DE EXPEDIENTES ====================

async function verHistorialExpediente(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const expediente = await obtenerExpediente(id);
    if (!expediente) {
        mostrarToast('Expediente no encontrado', 'error');
        return;
    }

    const historial = await obtenerHistorialExpediente(id);

    const nombreExpediente = expediente.numero || expediente.nombre;

    let contenidoHTML = '';

    if (historial.length === 0) {
        contenidoHTML = `
            <div class="empty-state small" style="padding: 2rem;">
                <span>📜</span>
                <p>No hay cambios registrados</p>
            </div>
        `;
    } else {
        contenidoHTML = `
            <div class="historial-lista">
                ${historial.map(h => `
                    <div class="historial-item ${escapeText(h.tipo)}">
                        <div class="historial-header">
                            <span class="historial-tipo">${obtenerIconoHistorial(h.tipo)} ${obtenerTextoTipo(h.tipo)}</span>
                            <span class="historial-fecha">${formatearFechaHora(h.fecha)}</span>
                        </div>
                        ${h.tipo === 'edicion' ? generarDetallesCambios(h.cambiosAnteriores, h.cambiosNuevos) : ''}
                        ${h.descripcion ? `<p class="historial-descripcion">${escapeText(h.descripcion)}</p>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }

    document.getElementById('modal-titulo').textContent = `📜 Historial: ${nombreExpediente}`;
    document.getElementById('modal-body').innerHTML = contenidoHTML;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

function obtenerIconoHistorial(tipo) {
    const iconos = {
        'creacion': '✨',
        'edicion': '✏️',
        'eliminacion': '🗑️'
    };
    return iconos[tipo] || '📝';
}

function obtenerTextoTipo(tipo) {
    const textos = {
        'creacion': 'Creación',
        'edicion': 'Modificación',
        'eliminacion': 'Eliminación'
    };
    return textos[tipo] || tipo;
}

function generarDetallesCambios(anteriores, nuevos) {
    if (!anteriores || !nuevos) return '';

    const etiquetas = {
        'numero': 'Número',
        'nombre': 'Nombre',
        'juzgado': 'Juzgado',
        'categoria': 'Categoría',
        'comentario': 'Comentario'
    };

    let html = '<div class="cambios-detalle">';

    for (const campo of Object.keys(nuevos)) {
        const nombreCampo = etiquetas[campo] || campo;
        const valorAnterior = anteriores[campo] || '(vacío)';
        const valorNuevo = nuevos[campo] || '(vacío)';

        html += `
            <div class="cambio-item">
                <span class="cambio-campo">${nombreCampo}:</span>
                <span class="cambio-anterior">${valorAnterior}</span>
                <span class="cambio-flecha">→</span>
                <span class="cambio-nuevo">${valorNuevo}</span>
            </div>
        `;
    }

    html += '</div>';
    return html;
}

function formatearFechaHora(fechaISO) {
    const fecha = new Date(fechaISO);
    return fecha.toLocaleString('es-MX', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ==================== NOTAS ====================

async function cargarNotas() {
    const notas = await obtenerNotas();
    const lista = document.getElementById('lista-notas');
    const count = document.getElementById('count-notas');

    if (notas.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📒</span>
                <h3>No hay notas</h3>
                <p>Comienza creando tu primera nota</p>
                <button class="btn btn-primary" onclick="mostrarFormularioNota()">
                    ➕ Crear Nota
                </button>
            </div>
        `;
        count.textContent = '0 notas';
        return;
    }

    const expedientes = await obtenerExpedientes();
    const expMap = Object.fromEntries(expedientes.map(e => [e.id, e]));

    lista.innerHTML = notas.map(nota => {
        const exp = expMap[nota.expedienteId];
        const instInst = (exp && exp.institucion) || nota.institucion || 'TSJ';
        const instBadge = instInst === 'PJF'
            ? '<span class="institucion-badge pjf" style="font-size: 0.65rem;">🏛️ PJF</span>'
            : instInst === 'OTRO'
            ? '<span class="institucion-badge otro" style="font-size: 0.65rem;">📋 Varios</span>'
            : '';
        return `
            <div class="nota-card" style="background-color: ${escapeText(nota.color || '#fff3cd')}" onclick="editarNota(${nota.id})">
                <div class="nota-header">
                    <h3 class="nota-titulo">${escapeText(nota.titulo)}</h3>
                    ${instBadge}
                    ${nota.recordatorio ? '<span class="nota-recordatorio">🔔</span>' : ''}
                </div>
                <p class="nota-contenido">${escapeText(nota.contenido || 'Sin contenido')}</p>
                <div class="nota-footer">
                    <span class="nota-expediente">📁 ${exp ? escapeText(exp.numero || exp.nombre) : (nota.expedienteTexto || 'Sin expediente')}</span>
                    <span class="nota-fecha">${formatearFecha(nota.fechaCreacion)}</span>
                </div>
            </div>
        `;
    }).join('');

    count.textContent = `${notas.length} nota${notas.length !== 1 ? 's' : ''}`;
}

// ==================== PENDIENTES ====================
// Tareas por expediente. La fecha límite es opcional; cuando existe, el núcleo
// de acciones mantiene el evento de calendario vinculado (ver acciones-core.js).

let pendientesCache = [];
// Los expedientes se leen una vez por carga y no en cada tecla del buscador:
// re-consultar IndexedDB por keystroke se notaba con muchos expedientes.
let expedientesCachePendientes = [];

// Prioridades de más a menos urgente. Un pendiente sin prioridad es válido y
// va al final: no todo merece que se decida su urgencia.
const PRIORIDADES_PENDIENTE = {
    alta:  { etiqueta: 'Alta',  icono: '🔴', orden: 0 },
    media: { etiqueta: 'Media', icono: '🟡', orden: 1 },
    baja:  { etiqueta: 'Baja',  icono: '🔵', orden: 2 }
};
const ORDEN_SIN_PRIORIDAD = 3;

function ordenPrioridadPendiente(pendiente) {
    const info = PRIORIDADES_PENDIENTE[pendiente && pendiente.prioridad];
    return info ? info.orden : ORDEN_SIN_PRIORIDAD;
}

// La preferencia de agrupación se restaura una sola vez: después manda la
// casilla, que es lo que el usuario está viendo.
let _agrupacionRestaurada = false;
function restaurarPreferenciaAgrupacion() {
    if (_agrupacionRestaurada) return;
    _agrupacionRestaurada = true;
    const el = document.getElementById('agrupar-pendientes');
    if (!el) return;
    try {
        const guardado = localStorage.getItem('pendientesAgrupados');
        if (guardado !== null) el.checked = guardado === '1';
    } catch (e) { /* storage bloqueado: se queda el valor por omisión */ }
}

async function cargarPendientes() {
    if (typeof obtenerPendientes !== 'function') return;
    restaurarPreferenciaAgrupacion();
    pendientesCache = await obtenerPendientes().catch(() => []);
    expedientesCachePendientes = await obtenerExpedientes().catch(() => []);
    actualizarSelectExpedientesPendientes();
    renderizarPendientes();
    actualizarBadgePendientes();
}

// Días que faltan para la fecha límite (negativo = vencido), o null si no tiene.
function diasParaPendiente(pendiente) {
    if (!pendiente.fechaLimite) return null;
    const limite = new Date(pendiente.fechaLimite);
    if (isNaN(limite.getTime())) return null;
    limite.setHours(0, 0, 0, 0);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.round((limite - hoy) / 86400000);
}

function _etiquetaVencimientoPendiente(pendiente) {
    const dias = diasParaPendiente(pendiente);
    if (dias === null) return { texto: '', clase: '' };
    if (dias < 0) return { texto: `Venció hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`, clase: 'vencido' };
    if (dias === 0) return { texto: 'Vence hoy', clase: 'vencido' };
    if (dias === 1) return { texto: 'Vence mañana', clase: 'proximo' };
    if (dias <= 7) return { texto: `Vence en ${dias} días`, clase: 'proximo' };
    return { texto: formatearFecha(pendiente.fechaLimite), clase: '' };
}

function _expedienteDePendiente(pendiente) {
    if (pendiente.expedienteId == null) return null;
    return expedientesCachePendientes.find(e => e.id === pendiente.expedienteId) || null;
}

// Nombre legible del expediente al que pertenece un pendiente.
function _nombreExpedientePendiente(pendiente) {
    if (pendiente.expedienteTexto) return pendiente.expedienteTexto;
    if (pendiente.expedienteId == null) return 'General';
    const exp = _expedienteDePendiente(pendiente);
    return exp ? (exp.numero || exp.nombre || 'Expediente') : 'Expediente eliminado';
}

// Todo el texto por el que se puede encontrar un expediente: número, nombre,
// juzgado, partes, categoría, comentario y su carpeta.
function textoBuscableExpediente(exp) {
    const carpetas = typeof obtenerCarpetasDeCache === 'function' ? obtenerCarpetasDeCache() : [];
    const carpeta = (carpetas.find(c => c.id === exp.carpetaId) || {}).nombre || '';
    return [
        exp.numero, exp.nombre, exp.juzgado, exp.categoria, exp.comentario,
        exp.actor, exp.demandado, exp.institucion, carpeta
    ].filter(Boolean).join(' ');
}

function _normalizarBusqueda(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ==================== PENDIENTES: ORDEN Y AGRUPACIÓN ====================

// Orden: primero lo que falta, luego por prioridad (alta → media → baja → sin
// asignar) y dentro de cada una por cercanía de la fecha límite. Es el orden
// que el usuario pidió y es predecible: la prioridad manda, la fecha desempata.
function compararPendientes(a, b) {
    if (!!a.completado !== !!b.completado) return a.completado ? 1 : -1;

    const pa = ordenPrioridadPendiente(a);
    const pb = ordenPrioridadPendiente(b);
    if (pa !== pb) return pa - pb;

    const da = a.fechaLimite ? new Date(a.fechaLimite).getTime() : Infinity;
    const dbb = b.fechaLimite ? new Date(b.fechaLimite).getTime() : Infinity;
    if (da !== dbb) return da - dbb;

    return new Date(b.fechaCreacion || 0) - new Date(a.fechaCreacion || 0);
}

// Agrupa por expediente. Cada grupo se ordena por urgencia, y los grupos entre
// sí por su pendiente más urgente, para que el caso que más apremia quede
// arriba. "Sin expediente" siempre al final.
function agruparPendientesPorExpediente(lista) {
    const grupos = new Map();

    for (const p of lista) {
        let clave, titulo, subtitulo, expedienteId = null;
        if (p.expedienteId != null) {
            clave = 'exp:' + p.expedienteId;
            const exp = _expedienteDePendiente(p);
            titulo = exp ? (exp.numero || exp.nombre || 'Expediente') : 'Expediente eliminado';
            subtitulo = exp ? (exp.juzgado || '') : 'El expediente ya no existe';
            expedienteId = p.expedienteId;
        } else if (p.expedienteTexto) {
            clave = 'txt:' + p.expedienteTexto.toLowerCase();
            titulo = p.expedienteTexto;
            subtitulo = 'Referencia libre';
        } else {
            clave = 'zz:general';
            titulo = 'Sin expediente';
            subtitulo = '';
        }

        if (!grupos.has(clave)) {
            grupos.set(clave, { clave, titulo, subtitulo, expedienteId, items: [] });
        }
        grupos.get(clave).items.push(p);
    }

    const arreglo = Array.from(grupos.values());
    for (const g of arreglo) {
        g.items.sort(compararPendientes);
        // El conteo es de todo el expediente, no de lo que dejó ver el filtro:
        // "2 por hacer" debe seguir diciendo 2 aunque el filtro muestre uno.
        g.abiertos = g.expedienteId != null
            ? pendientesCache.filter(x => !x.completado && x.expedienteId === g.expedienteId).length
            : g.items.filter(x => !x.completado).length;
        g.ocultos = g.abiertos - g.items.filter(x => !x.completado).length;
        // items ya está ordenado por urgencia: el primero es el más apremiante.
        g.masUrgente = g.items[0] || null;
    }

    arreglo.sort((a, b) => {
        // "Sin expediente" siempre al final, sin competir por urgencia.
        const ga = a.clave === 'zz:general' ? 1 : 0;
        const gb = b.clave === 'zz:general' ? 1 : 0;
        if (ga !== gb) return ga - gb;
        if (!a.masUrgente || !b.masUrgente) return 0;
        return compararPendientes(a.masUrgente, b.masUrgente);
    });
    return arreglo;
}

// ==================== PENDIENTES: RENDER ====================

// El chip es un botón y siempre está: si solo apareciera cuando ya hay
// prioridad, no habría dónde hacer clic para ponérsela a los que no la tienen.
function _chipPrioridadHTML(pendiente) {
    const info = PRIORIDADES_PENDIENTE[pendiente.prioridad];
    const clase = info ? `prioridad-${pendiente.prioridad}` : 'prioridad-ninguna';
    const texto = info ? `${info.icono} ${info.etiqueta}` : '○ Prioridad';
    return `<button type="button" class="pendiente-prioridad ${clase}"
                    onclick="menuPrioridadPendiente(this, ${pendiente.id}, event)"
                    title="Cambiar prioridad">${texto}</button>`;
}

function _pendienteItemHTML(p, mostrarExpediente) {
    const venc = _etiquetaVencimientoPendiente(p);
    const vencido = venc.clase === 'vencido' && !p.completado;
    // "Posponer" no describe bien ponerle la primera fecha a algo que no tenía.
    const tituloPosponer = p.fechaLimite ? 'Posponer' : 'Ponerle fecha';
    return `
        <div class="pendiente-item${p.completado ? ' completado' : ''}${vencido ? ' vencido' : ''} prio-${p.prioridad || 'ninguna'}" data-id="${p.id}">
            ${modoSeleccionPendientes ? `
            <label class="pendiente-seleccion" title="Seleccionar para eliminar">
                <input type="checkbox" ${pendientesSeleccionados.has(p.id) ? 'checked' : ''}
                       onchange="togglePendienteSeleccionado(${p.id}, this.checked)">
            </label>` : ''}
            <label class="pendiente-check" title="${p.completado ? 'Reabrir' : 'Marcar como terminado'}">
                <input type="checkbox" ${p.completado ? 'checked' : ''} onchange="togglePendiente(${p.id}, this.checked)">
            </label>
            <div class="pendiente-cuerpo">
                <div class="pendiente-titulo">${escapeText(p.titulo)}</div>
                ${p.descripcion ? `<div class="pendiente-descripcion">${escapeText(p.descripcion)}</div>` : ''}
                <div class="pendiente-meta">
                    ${_chipPrioridadHTML(p)}
                    ${mostrarExpediente ? `<span class="pendiente-expediente">📁 ${escapeText(_nombreExpedientePendiente(p))}</span>` : ''}
                    ${venc.texto ? `<span class="pendiente-fecha ${venc.clase}">📅 ${escapeText(venc.texto)}</span>` : ''}
                    ${p.completado && p.fechaCompletado ? `<span class="pendiente-hecho">✔️ ${formatearFecha(p.fechaCompletado)}</span>` : ''}
                </div>
            </div>
            <div class="pendiente-acciones">
                ${p.completado ? '' : `<button class="btn btn-sm btn-outline" onclick="menuPosponerPendiente(this, ${p.id}, event)" title="${tituloPosponer}">⏰</button>`}
                <button class="btn btn-sm btn-secondary" onclick="mostrarFormularioPendiente(${p.id})" title="Editar">✏️</button>
                <button class="btn btn-sm btn-danger" onclick="confirmarEliminarPendiente(${p.id})" title="Eliminar">🗑️</button>
            </div>
        </div>`;
}

function agrupacionActiva() {
    const el = document.getElementById('agrupar-pendientes');
    return el ? el.checked : true;
}

function toggleAgrupacionPendientes() {
    try { localStorage.setItem('pendientesAgrupados', agrupacionActiva() ? '1' : '0'); } catch (e) {}
    renderizarPendientes();
}

// El buscador repinta y reagrupa toda la lista; con muchos pendientes hacerlo
// en cada tecla se nota. Mismo criterio que el buscador de expedientes.
let _filtrarPendientesTimer = null;
function renderizarPendientesDebounced() {
    clearTimeout(_filtrarPendientesTimer);
    _filtrarPendientesTimer = setTimeout(() => renderizarPendientes(), 150);
}

function renderizarPendientes() {
    const lista = document.getElementById('lista-pendientes');
    const count = document.getElementById('count-pendientes');
    if (!lista) return;

    // El menú flotante se ancla a una fila; si la lista se repinta por detrás
    // (una sincronización, por ejemplo) quedaría flotando sobre nada.
    cerrarMenuPendiente();

    const texto = _normalizarBusqueda(document.getElementById('buscar-pendiente')?.value || '');
    const filtroExp = document.getElementById('filtro-expediente-pendiente')?.value || '';
    const estado = document.getElementById('filtro-estado-pendiente')?.value || 'abiertos';
    const filtroPrioridad = document.getElementById('filtro-prioridad-pendiente')?.value || '';

    const visibles = pendientesCache.filter(p => {
        if (estado === 'abiertos' && p.completado) return false;
        if (estado === 'completados' && !p.completado) return false;
        if (filtroExp && String(p.expedienteId ?? '') !== filtroExp) return false;
        if (filtroPrioridad === '__sin__') {
            if (PRIORIDADES_PENDIENTE[p.prioridad]) return false;
        } else if (filtroPrioridad && p.prioridad !== filtroPrioridad) {
            return false;
        }
        if (texto) {
            const exp = _expedienteDePendiente(p);
            const heno = _normalizarBusqueda(
                `${p.titulo || ''} ${p.descripcion || ''} ${_nombreExpedientePendiente(p)} ` +
                (exp ? textoBuscableExpediente(exp) : '')
            );
            if (!heno.includes(texto)) return false;
        }
        return true;
    });

    if (count) {
        const vencidos = visibles.filter(p => !p.completado && (diasParaPendiente(p) ?? 1) < 0).length;
        count.textContent = `${visibles.length} pendiente${visibles.length !== 1 ? 's' : ''}` +
            (vencidos > 0 ? ` · ${vencidos} vencido${vencidos !== 1 ? 's' : ''}` : '');
    }

    if (visibles.length === 0) {
        const vacioPorFiltro = pendientesCache.length > 0;
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">✅</span>
                <h3>${vacioPorFiltro ? 'Sin resultados' : 'No hay pendientes'}</h3>
                <p>${vacioPorFiltro ? 'Ningún pendiente coincide con los filtros.' : 'Comienza creando tu primer pendiente'}</p>
                ${vacioPorFiltro ? '' : `<button class="btn btn-primary" onclick="mostrarFormularioPendiente()">➕ Crear Pendiente</button>`}
            </div>`;
        return;
    }

    // Agrupado por expediente, o lista plana ordenada solo por urgencia cuando
    // lo que interesa es "qué es lo más apremiante de todo".
    if (!agrupacionActiva()) {
        lista.innerHTML = visibles.slice().sort(compararPendientes)
            .map(p => _pendienteItemHTML(p, true)).join('');
        if (modoSeleccionPendientes) _actualizarBarraSeleccionPendientes();
        return;
    }

    lista.innerHTML = agruparPendientesPorExpediente(visibles).map(g => `
        <div class="pendiente-grupo${gruposPlegados.has(g.clave) ? ' plegado' : ''}" data-clave="${escapeText(g.clave)}">
            <div class="pendiente-grupo-header" onclick="togglePendienteGrupo(this)"
                 onkeydown="tecladoPendienteGrupo(event, this)"
                 role="button" tabindex="0" aria-expanded="${gruposPlegados.has(g.clave) ? 'false' : 'true'}">
                <span class="pendiente-grupo-flecha">▾</span>
                <div class="pendiente-grupo-titulo">
                    📁 ${escapeText(g.titulo)}
                    ${g.subtitulo ? `<small>${escapeText(g.subtitulo)}</small>` : ''}
                </div>
                <span class="pendiente-grupo-conteo">${g.abiertos > 0 ? `${g.abiertos} por hacer` : 'al día'}${g.ocultos > 0 ? ` · ${g.ocultos} fuera del filtro` : ''}</span>
                ${g.expedienteId != null ? `<button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); mostrarFormularioPendiente(null, ${g.expedienteId})" title="Agregar pendiente a este expediente">➕</button>` : ''}
            </div>
            <div class="pendiente-grupo-items">
                ${g.items.map(p => _pendienteItemHTML(p, false)).join('')}
            </div>
        </div>`).join('');

    // El repintado rehace las casillas: hay que recalcular cuántas quedan
    // marcadas y el estado de "seleccionar todos".
    if (modoSeleccionPendientes) _actualizarBarraSeleccionPendientes();
}

// Qué grupos están plegados. Vive fuera del DOM porque renderizarPendientes
// reconstruye el HTML: si el estado viviera solo en la clase CSS, buscar algo
// o terminar un pendiente volvería a desplegarlo todo.
let gruposPlegados = new Set();

function togglePendienteGrupo(header) {
    const grupo = header.closest('.pendiente-grupo');
    if (!grupo) return;
    const clave = grupo.dataset.clave;
    const plegado = grupo.classList.toggle('plegado');
    if (plegado) gruposPlegados.add(clave); else gruposPlegados.delete(clave);
}

// El encabezado es enfocable, así que también debe poder accionarse con el
// teclado y no solo con el ratón.
function tecladoPendienteGrupo(event, header) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    togglePendienteGrupo(header);
}

// Cuenta de pendientes sin terminar, para los badges de navegación.
function actualizarBadgePendientes() {
    const abiertos = pendientesCache.filter(p => !p.completado).length;
    const vencidos = pendientesCache.filter(p => !p.completado && (diasParaPendiente(p) ?? 1) < 0).length;
    ['nav-badge-pendientes', 'nav-badge-pendientes-movil'].forEach(id => {
        const badge = document.getElementById(id);
        if (!badge) return;
        badge.style.display = abiertos > 0 ? '' : 'none';
        badge.textContent = abiertos;
        // Rojo si algo ya venció: no es lo mismo tener tareas que ir tarde.
        badge.classList.toggle('vencido', vencidos > 0);
        badge.title = vencidos > 0 ? `${vencidos} pendiente(s) vencido(s)` : `${abiertos} pendiente(s) por hacer`;
    });
}

// Pendientes abiertos de un expediente, para el distintivo de su tarjeta.
function pendientesAbiertosDeExpediente(expedienteId) {
    return pendientesCache.filter(p => !p.completado && p.expedienteId === expedienteId).length;
}

function actualizarSelectExpedientesPendientes() {
    const select = document.getElementById('filtro-expediente-pendiente');
    if (!select) return;
    const previo = select.value;
    select.innerHTML = '<option value="">Todos los expedientes</option>' +
        expedientesCachePendientes.map(e => `<option value="${e.id}">${escapeText(e.numero || e.nombre)}</option>`).join('');
    if (previo) select.value = previo;
}

// ==================== PENDIENTES: SELECTOR DE EXPEDIENTE BUSCABLE ====================
// Un <select> con cientos de expedientes es inservible. Este combo filtra por
// cualquier dato del expediente: número, nombre, juzgado, partes, categoría,
// comentario o carpeta.

let comboExpedienteOpciones = [];
let comboExpedienteIndice = -1;

function _opcionesComboExpediente() {
    const opciones = [
        { valor: '', etiqueta: 'General (sin expediente)', detalle: 'El pendiente no se liga a ningún expediente', buscable: 'general sin expediente' }
    ];
    for (const e of expedientesCachePendientes) {
        opciones.push({
            valor: String(e.id),
            etiqueta: e.numero || e.nombre || 'Expediente',
            detalle: [e.nombre && e.numero ? e.nombre : '', e.juzgado, e.categoria].filter(Boolean).join(' · '),
            buscable: _normalizarBusqueda(textoBuscableExpediente(e))
        });
    }
    opciones.push({ valor: '__custom__', etiqueta: '✏️ Otro (escribir manualmente)', detalle: 'Una referencia libre, sin expediente registrado', buscable: 'otro manual libre' });
    return opciones;
}

function filtrarComboExpediente() {
    const input = document.getElementById('pendiente-exp-buscar');
    const cont = document.getElementById('pendiente-combo-lista');
    if (!input || !cont) return;

    const q = _normalizarBusqueda(input.value);
    // Se muestran todas las opciones cuando no hay texto, para que el combo
    // también sirva como lista desplegable normal.
    const coincidencias = q
        ? comboExpedienteOpciones.filter(o => _normalizarBusqueda(o.etiqueta).includes(q) || o.buscable.includes(q))
        : comboExpedienteOpciones;

    comboExpedienteIndice = -1;
    cont.innerHTML = coincidencias.length === 0
        ? '<div class="combo-vacio">Ningún expediente coincide</div>'
        : coincidencias.slice(0, 50).map((o, i) => `
            <div class="combo-opcion" data-valor="${escapeText(o.valor)}" data-indice="${i}"
                 onmousedown="event.preventDefault(); seleccionarComboExpediente(this.dataset.valor)">
                <div class="combo-etiqueta">${escapeText(o.etiqueta)}</div>
                ${o.detalle ? `<div class="combo-detalle">${escapeText(o.detalle)}</div>` : ''}
            </div>`).join('');
    cont.style.display = 'block';
}

function abrirComboExpediente() {
    filtrarComboExpediente();
}

function cerrarComboExpediente() {
    const cont = document.getElementById('pendiente-combo-lista');
    if (cont) cont.style.display = 'none';
}

function seleccionarComboExpediente(valor) {
    const oculto = document.getElementById('pendiente-expediente');
    const input = document.getElementById('pendiente-exp-buscar');
    const opcion = comboExpedienteOpciones.find(o => o.valor === valor);
    if (!oculto || !input || !opcion) return;

    oculto.value = valor;
    input.value = valor === '' ? '' : opcion.etiqueta;
    cerrarComboExpediente();

    const grupoLibre = document.getElementById('pendiente-expediente-custom-group');
    if (grupoLibre) grupoLibre.style.display = valor === '__custom__' ? 'block' : 'none';
    if (valor === '__custom__') {
        const libre = document.getElementById('pendiente-expediente-custom');
        if (libre) libre.focus();
    }
}

// Traduce lo que quedó escrito en el combo a una opción concreta. Se llama al
// guardar: si el usuario escribió el expediente y no llegó a elegirlo de la
// lista, lo escrito debe valer, no perderse en silencio.
// Devuelve { ok: true, valor } o { ok: false, mensaje }.
function resolverComboExpediente() {
    const input = document.getElementById('pendiente-exp-buscar');
    const oculto = document.getElementById('pendiente-expediente');
    if (!input || !oculto) return { ok: true, valor: '' };

    // Referencia libre: manda el campo de abajo, no lo que diga el buscador.
    if (oculto.value === '__custom__') return { ok: true, valor: '__custom__' };

    const escrito = input.value.trim();
    if (!escrito) return { ok: true, valor: '' };   // vacío = General

    // Si lo escrito es exactamente la opción ya elegida, no hay nada que hacer.
    const elegida = comboExpedienteOpciones.find(o => o.valor === oculto.value);
    if (elegida && elegida.valor !== '' && elegida.etiqueta === escrito) {
        return { ok: true, valor: oculto.value };
    }

    const q = _normalizarBusqueda(escrito);
    const coincidencias = comboExpedienteOpciones.filter(o =>
        o.valor !== '' && (_normalizarBusqueda(o.etiqueta).includes(q) || o.buscable.includes(q)));

    // Una sola coincidencia: es evidente a qué se refería.
    if (coincidencias.length === 1) return { ok: true, valor: coincidencias[0].valor };

    if (coincidencias.length === 0) {
        return { ok: false, mensaje: `No hay ningún expediente que coincida con "${escrito}". Elígelo de la lista, usa "Otro" para una referencia libre, o deja el campo vacío.` };
    }
    return { ok: false, mensaje: `"${escrito}" coincide con ${coincidencias.length} expedientes. Elige uno de la lista.` };
}

// Flechas para recorrer, Enter para elegir, Escape para cerrar.
function navegarComboExpediente(event) {
    const cont = document.getElementById('pendiente-combo-lista');
    if (!cont) return;
    const opciones = Array.from(cont.querySelectorAll('.combo-opcion'));

    if (event.key === 'Escape') { cerrarComboExpediente(); return; }
    if (event.key === 'Enter') {
        if (cont.style.display !== 'none' && comboExpedienteIndice >= 0 && opciones[comboExpedienteIndice]) {
            event.preventDefault();
            seleccionarComboExpediente(opciones[comboExpedienteIndice].dataset.valor);
        }
        return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    if (cont.style.display === 'none') filtrarComboExpediente();
    if (opciones.length === 0) return;

    comboExpedienteIndice += event.key === 'ArrowDown' ? 1 : -1;
    if (comboExpedienteIndice < 0) comboExpedienteIndice = opciones.length - 1;
    if (comboExpedienteIndice >= opciones.length) comboExpedienteIndice = 0;

    opciones.forEach((o, i) => o.classList.toggle('activa', i === comboExpedienteIndice));
    opciones[comboExpedienteIndice].scrollIntoView({ block: 'nearest' });
}

// ==================== PENDIENTES: ACCIONES RÁPIDAS ====================
// Cambiar prioridad y posponer sin abrir el formulario. Un solo menú flotante
// anclado al botón que lo abrió: meter un menú por fila haría pesada una lista
// larga, y un ciclo de clics obligaría a adivinar cuántos faltan.

let _menuPendienteEl = null;

function cerrarMenuPendiente() {
    if (_menuPendienteEl) { _menuPendienteEl.remove(); _menuPendienteEl = null; }
    document.removeEventListener('mousedown', _cerrarMenuSiFuera, true);
    document.removeEventListener('keydown', _cerrarMenuConEscape, true);
    window.removeEventListener('scroll', cerrarMenuPendiente, true);
}

function _cerrarMenuSiFuera(e) {
    if (_menuPendienteEl && !_menuPendienteEl.contains(e.target)) cerrarMenuPendiente();
}

function _cerrarMenuConEscape(e) {
    if (e.key === 'Escape') { e.stopPropagation(); cerrarMenuPendiente(); }
}

// opciones: [{ etiqueta, activa?, alAccionar }]
function abrirMenuPendiente(boton, opciones) {
    cerrarMenuPendiente();

    const menu = document.createElement('div');
    menu.className = 'menu-pendiente';
    menu.setAttribute('role', 'menu');
    opciones.forEach((op, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'menu-pendiente-opcion' + (op.activa ? ' activa' : '');
        item.textContent = op.etiqueta;
        item.setAttribute('role', 'menuitem');
        item.onclick = () => { cerrarMenuPendiente(); op.alAccionar(); };
        menu.appendChild(item);
        if (op.separadorDespues && i < opciones.length - 1) {
            menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-pendiente-separador' }));
        }
    });

    document.body.appendChild(menu);
    _menuPendienteEl = menu;

    // Se ancla al botón y se mantiene dentro de la ventana.
    const r = boton.getBoundingClientRect();
    const ancho = menu.offsetWidth;
    const alto = menu.offsetHeight;
    let izq = r.right - ancho;
    let arr = r.bottom + 4;
    if (izq < 8) izq = 8;
    if (izq + ancho > window.innerWidth - 8) izq = window.innerWidth - ancho - 8;
    if (arr + alto > window.innerHeight - 8) arr = Math.max(8, r.top - alto - 4);
    menu.style.left = izq + 'px';
    menu.style.top = arr + 'px';

    const primera = menu.querySelector('.menu-pendiente-opcion');
    if (primera) primera.focus();

    document.addEventListener('mousedown', _cerrarMenuSiFuera, true);
    document.addEventListener('keydown', _cerrarMenuConEscape, true);
    window.addEventListener('scroll', cerrarMenuPendiente, true);
}

function menuPrioridadPendiente(boton, id, event) {
    if (event) event.stopPropagation();
    const p = pendientesCache.find(x => x.id === id);
    if (!p) return;

    const opciones = ['alta', 'media', 'baja'].map(v => ({
        etiqueta: `${PRIORIDADES_PENDIENTE[v].icono} ${PRIORIDADES_PENDIENTE[v].etiqueta}`,
        activa: p.prioridad === v,
        alAccionar: () => cambiarPrioridadPendiente(id, v)
    }));
    opciones[opciones.length - 1].separadorDespues = true;
    opciones.push({
        etiqueta: 'Sin prioridad',
        activa: !PRIORIDADES_PENDIENTE[p.prioridad],
        alAccionar: () => cambiarPrioridadPendiente(id, '')
    });
    abrirMenuPendiente(boton, opciones);
}

async function cambiarPrioridadPendiente(id, prioridad) {
    try {
        await actualizarPendienteCore(id, { prioridad });
        const info = PRIORIDADES_PENDIENTE[prioridad];
        mostrarToast(info ? `Prioridad ${info.etiqueta.toLowerCase()}` : 'Prioridad quitada', 'success');
    } catch (e) {
        mostrarToast('Error: ' + e.message, 'error');
    }
}

// Posponer parte de hoy cuando el pendiente ya venció o no tenía fecha; si la
// fecha aún no llega, se corre desde ella. Aplazar por un día algo vencido
// hace dos semanas debería dejarlo para mañana, no para hace trece días.
function calcularNuevaFechaPendiente(pendiente, dias) {
    const ahora = new Date();
    let base = pendiente.fechaLimite ? new Date(pendiente.fechaLimite) : null;
    if (!base || isNaN(base.getTime()) || base.getTime() < ahora.getTime()) {
        base = new Date(ahora.getTime());
        // Sin hora previa se usa media mañana, igual criterio que el asistente.
        if (!pendiente.fechaLimite) base.setHours(9, 0, 0, 0);
    }
    base.setDate(base.getDate() + dias);
    return base.toISOString();
}

function menuPosponerPendiente(boton, id, event) {
    if (event) event.stopPropagation();
    const p = pendientesCache.find(x => x.id === id);
    if (!p) return;

    const opciones = [
        { etiqueta: '1 día más', alAccionar: () => posponerPendiente(id, 1) },
        { etiqueta: '3 días más', alAccionar: () => posponerPendiente(id, 3) },
        { etiqueta: '1 semana más', alAccionar: () => posponerPendiente(id, 7) },
        { etiqueta: '1 mes más', alAccionar: () => posponerPendiente(id, 30), separadorDespues: !!p.fechaLimite }
    ];
    if (p.fechaLimite) {
        opciones.push({ etiqueta: 'Quitar la fecha', alAccionar: () => quitarFechaPendiente(id) });
    }
    abrirMenuPendiente(boton, opciones);
}

async function posponerPendiente(id, dias) {
    const p = pendientesCache.find(x => x.id === id);
    if (!p) return;
    try {
        const nueva = calcularNuevaFechaPendiente(p, dias);
        await actualizarPendienteCore(id, { fechaLimite: nueva });
        mostrarToast('Pospuesto para el ' + formatearFecha(nueva), 'success');
    } catch (e) {
        mostrarToast('Error: ' + e.message, 'error');
    }
}

async function quitarFechaPendiente(id) {
    try {
        await actualizarPendienteCore(id, { fechaLimite: null });
        mostrarToast('Fecha quitada; sale del calendario', 'success');
    } catch (e) {
        mostrarToast('Error: ' + e.message, 'error');
    }
}

// ==================== PENDIENTES: FORMULARIO ====================

async function mostrarFormularioPendiente(id = null, expedienteIdPrefijado = null) {
    const pendiente = id ? await obtenerPendiente(id) : null;
    // Se relee por si la caché quedó atrás respecto a un expediente recién creado.
    expedientesCachePendientes = await obtenerExpedientes().catch(() => expedientesCachePendientes);
    comboExpedienteOpciones = _opcionesComboExpediente();

    const expedienteSel = pendiente
        ? (pendiente.expedienteTexto ? '__custom__' : (pendiente.expedienteId != null ? String(pendiente.expedienteId) : ''))
        : (expedienteIdPrefijado != null ? String(expedienteIdPrefijado) : '');

    const opcionSel = comboExpedienteOpciones.find(o => o.valor === expedienteSel);
    // Si el expediente ya no existe se avisa, en vez de caer en silencio a
    // "General" y perder la relación al guardar.
    const expedienteHuerfano = !opcionSel && expedienteSel !== '';
    // En una referencia libre se muestra el texto real, no la etiqueta genérica
    // "Otro", que no le dice nada al usuario sobre qué guardó.
    const textoCombo = (pendiente && pendiente.expedienteTexto)
        ? pendiente.expedienteTexto
        : (opcionSel && opcionSel.valor !== '' ? opcionSel.etiqueta : '');

    // El input datetime-local espera hora local sin zona; el valor guardado es ISO.
    let valorFecha = '';
    if (pendiente && pendiente.fechaLimite) {
        const d = new Date(pendiente.fechaLimite);
        if (!isNaN(d.getTime())) {
            const p2 = n => String(n).padStart(2, '0');
            valorFecha = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
        }
    }

    const prioridadSel = (pendiente && pendiente.prioridad) || '';
    const opcionesPrioridad = ['', 'alta', 'media', 'baja'].map(v => {
        const info = PRIORIDADES_PENDIENTE[v];
        const etiqueta = info ? `${info.icono} ${info.etiqueta}` : '— Sin prioridad —';
        return `<option value="${v}"${prioridadSel === v ? ' selected' : ''}>${etiqueta}</option>`;
    }).join('');

    document.getElementById('modal-titulo').textContent = pendiente ? 'Editar Pendiente' : 'Nuevo Pendiente';
    document.getElementById('modal-body').innerHTML = `
        <form id="pendiente-form" onsubmit="guardarPendiente(event)">
            <input type="hidden" id="pendiente-id" value="${pendiente ? pendiente.id : ''}">
            <div class="form-group">
                <label for="pendiente-exp-buscar">Expediente (opcional)</label>
                <div class="combo-expediente">
                    <input type="text" id="pendiente-exp-buscar" autocomplete="off"
                           placeholder="Busca por número, nombre, juzgado, parte..."
                           value="${escapeText(textoCombo)}"
                           oninput="filtrarComboExpediente()"
                           onfocus="abrirComboExpediente()"
                           onblur="cerrarComboExpediente()"
                           onkeydown="navegarComboExpediente(event)">
                    <input type="hidden" id="pendiente-expediente" value="${escapeText(expedienteHuerfano ? '' : expedienteSel)}">
                    <div class="combo-lista" id="pendiente-combo-lista" style="display:none;"></div>
                </div>
                ${expedienteHuerfano ? '<small class="form-hint aviso">El expediente de este pendiente ya no existe. Elige otro o déjalo como general.</small>' : '<small class="form-hint">Escribe cualquier dato del expediente: número, nombre, juzgado, parte o carpeta.</small>'}
            </div>
            <div class="form-group" id="pendiente-expediente-custom-group" style="display: ${pendiente && pendiente.expedienteTexto ? 'block' : 'none'};">
                <label>Número de expediente o tema</label>
                <input type="text" id="pendiente-expediente-custom" placeholder="Ej: 123/2025, Reunión cliente, etc."
                       value="${pendiente ? escapeText(pendiente.expedienteTexto || '') : ''}">
            </div>
            <div class="form-group">
                <label for="pendiente-titulo">¿Qué hay que hacer? *</label>
                <input type="text" id="pendiente-titulo" placeholder="Ej: Presentar contestación de demanda" required
                       value="${pendiente ? escapeText(pendiente.titulo || '') : ''}">
            </div>
            <div class="form-group">
                <label for="pendiente-descripcion">Detalle (opcional)</label>
                <textarea id="pendiente-descripcion" rows="3" placeholder="Notas sobre este pendiente...">${pendiente ? escapeText(pendiente.descripcion || '') : ''}</textarea>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="pendiente-prioridad">Prioridad</label>
                    <select id="pendiente-prioridad">${opcionesPrioridad}</select>
                </div>
                <div class="form-group">
                    <label for="pendiente-fecha">Fecha límite (opcional)</label>
                    <input type="datetime-local" id="pendiente-fecha" value="${valorFecha}">
                </div>
            </div>
            <small class="form-hint">Con fecha, el pendiente aparece en el calendario y te avisa. Sin ella, es solo una tarea del expediente.</small>
        </form>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="document.getElementById('pendiente-form').requestSubmit()">💾 Guardar</button>
    `;

    abrirModal();
    // Si ya se sabe el expediente (se edita, o se creó desde su grupo), el
    // cursor va a lo que falta escribir; si no, al buscador de expediente.
    setTimeout(() => {
        const yaHayExpediente = !!pendiente || expedienteSel !== '';
        const foco = document.getElementById(yaHayExpediente ? 'pendiente-titulo' : 'pendiente-exp-buscar');
        if (foco) foco.focus();
    }, 60);
}

async function guardarPendiente(event) {
    event.preventDefault();

    const id = document.getElementById('pendiente-id').value;
    const titulo = document.getElementById('pendiente-titulo').value.trim();
    const descripcion = document.getElementById('pendiente-descripcion').value.trim();
    const fecha = document.getElementById('pendiente-fecha').value;
    const prioridad = document.getElementById('pendiente-prioridad').value;
    const expedienteCustom = document.getElementById('pendiente-expediente-custom')?.value?.trim() || '';

    if (!titulo) {
        mostrarToast('Escribe qué hay que hacer', 'error');
        return;
    }

    // Lo escrito en el buscador manda: si no se eligió de la lista, se resuelve
    // aquí en vez de guardar el pendiente como general sin avisar.
    const resuelto = resolverComboExpediente();
    if (!resuelto.ok) {
        mostrarToast(resuelto.mensaje, 'error');
        document.getElementById('pendiente-exp-buscar')?.focus();
        return;
    }
    const expedienteSelect = resuelto.valor;

    if (expedienteSelect === '__custom__' && !expedienteCustom) {
        mostrarToast('Escribe la referencia del expediente o elige uno de la lista', 'error');
        document.getElementById('pendiente-expediente-custom')?.focus();
        return;
    }

    let expedienteId = null;
    let expedienteTexto = null;
    if (expedienteSelect === '__custom__') {
        expedienteTexto = expedienteCustom;
    } else if (expedienteSelect) {
        expedienteId = parseInt(expedienteSelect);
    }

    const datos = {
        titulo,
        descripcion,
        prioridad,
        expedienteId,
        expedienteTexto,
        fechaLimite: fecha ? new Date(fecha).toISOString() : null
    };

    try {
        if (id) {
            await actualizarPendienteCore(parseInt(id), datos);
            mostrarToast('Pendiente actualizado', 'success');
        } else {
            await crearPendienteCore(datos);
            mostrarToast(datos.fechaLimite ? 'Pendiente creado y agendado' : 'Pendiente creado', 'success');
        }
        cerrarModal();
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'error');
    }
}

async function togglePendiente(id, completado) {
    try {
        await completarPendienteCore(id, completado);
        mostrarToast(completado ? 'Pendiente terminado' : 'Pendiente reabierto', 'success');
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'error');
        await cargarPendientes();
    }
}

async function confirmarEliminarPendiente(id) {
    const pendiente = await obtenerPendiente(id);
    if (!pendiente) return;
    if (!confirm(`¿Eliminar el pendiente "${pendiente.titulo}"?\n\nSi tiene fecha, también se quitará del calendario.`)) return;
    try {
        await eliminarPendienteCore(id);
        mostrarToast('Pendiente eliminado', 'success');
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'error');
    }
}

// ==================== PENDIENTES: SELECCIÓN MÚLTIPLE ====================
// Depurar una lista larga de uno en uno es un suplicio: cada borrado pide su
// confirmación y repinta. Con selección, una sola confirmación y una sola
// subida a la nube.

let modoSeleccionPendientes = false;
const pendientesSeleccionados = new Set();

function toggleModoSeleccionPendientes() {
    modoSeleccionPendientes = !modoSeleccionPendientes;
    pendientesSeleccionados.clear();

    const barra = document.getElementById('bulk-actions-pendientes');
    if (barra) barra.style.display = modoSeleccionPendientes ? 'flex' : 'none';

    const boton = document.getElementById('btn-toggle-seleccion-pendientes');
    if (boton) {
        boton.textContent = modoSeleccionPendientes ? '✕ Cancelar selección' : '☑️ Selección múltiple';
        boton.classList.toggle('btn-warning', modoSeleccionPendientes);
        boton.classList.toggle('btn-secondary', !modoSeleccionPendientes);
    }

    renderizarPendientes();
}

/** Ids de los pendientes que el filtro actual deja a la vista. */
function _pendientesVisiblesIds() {
    return Array.from(document.querySelectorAll('#lista-pendientes .pendiente-item'))
        .map(el => parseInt(el.dataset.id, 10))
        .filter(id => !isNaN(id));
}

function togglePendienteSeleccionado(id, seleccionado) {
    if (seleccionado) pendientesSeleccionados.add(id);
    else pendientesSeleccionados.delete(id);
    _actualizarBarraSeleccionPendientes();
}

/** "Todos" son los que se ven ahora, no los que hay: respeta los filtros. */
function alternarTodosPendientes(seleccionar) {
    const visibles = _pendientesVisiblesIds();
    visibles.forEach(id => {
        if (seleccionar) pendientesSeleccionados.add(id);
        else pendientesSeleccionados.delete(id);
    });
    document.querySelectorAll('#lista-pendientes .pendiente-seleccion input')
        .forEach(cb => { cb.checked = seleccionar; });
    _actualizarBarraSeleccionPendientes();
}

function _actualizarBarraSeleccionPendientes() {
    const n = pendientesSeleccionados.size;
    const conteo = document.getElementById('conteo-seleccion-pendientes');
    if (conteo) conteo.textContent = `${n} seleccionado${n !== 1 ? 's' : ''}`;

    // La casilla de cabecera refleja el estado real: marcada si están todos los
    // visibles, indeterminada si solo algunos.
    const todos = document.getElementById('check-todos-pendientes');
    if (todos) {
        const visibles = _pendientesVisiblesIds();
        const marcados = visibles.filter(id => pendientesSeleccionados.has(id)).length;
        todos.checked = visibles.length > 0 && marcados === visibles.length;
        todos.indeterminate = marcados > 0 && marcados < visibles.length;
    }
}

async function eliminarPendientesSeleccionados() {
    const ids = Array.from(pendientesSeleccionados);
    if (ids.length === 0) {
        mostrarToast('No hay pendientes seleccionados', 'warning');
        return;
    }

    const conFecha = pendientesCache.filter(p => ids.includes(p.id) && p.fechaLimite).length;
    const aviso = conFecha > 0
        ? `\n\n${conFecha} tiene${conFecha !== 1 ? 'n' : ''} fecha: también se quitará${conFecha !== 1 ? 'n' : ''} del calendario.`
        : '';

    if (!confirm(`¿Eliminar ${ids.length} pendiente${ids.length !== 1 ? 's' : ''}?${aviso}`)) return;

    let borrados = 0;
    const errores = [];

    // En lote: sin esto, cada pendiente dispararía su propio repintado y su
    // propia subida a la nube.
    await enLoteCore(async () => {
        for (const id of ids) {
            try {
                await eliminarPendienteCore(id);
                borrados++;
            } catch (e) {
                errores.push(`${id}: ${e.message}`);
            }
        }
    });

    pendientesSeleccionados.clear();
    if (modoSeleccionPendientes) toggleModoSeleccionPendientes();

    if (errores.length > 0) {
        Logger.error('Errores al eliminar pendientes:', errores);
        mostrarToast(`${borrados} eliminados, ${errores.length} con error`, 'warning');
    } else {
        mostrarToast(`${borrados} pendiente${borrados !== 1 ? 's' : ''} eliminado${borrados !== 1 ? 's' : ''}`, 'success');
    }
}

// Abre la página de pendientes filtrada por un expediente concreto.
function verPendientesDeExpediente(expedienteId, event) {
    if (event) event.stopPropagation();
    navegarA('pendientes');
    const select = document.getElementById('filtro-expediente-pendiente');
    if (select) select.value = String(expedienteId);
    const estado = document.getElementById('filtro-estado-pendiente');
    if (estado) estado.value = 'abiertos';
    renderizarPendientes();
}

function mostrarFormularioNota() {
    const expedientes = obtenerExpedientes().then(exps => {
        const selectHtml = '<option value="">General (sin expediente)</option>' +
            '<option value="__custom__">✏️ Otro (escribir manualmente)</option>' +
            exps.map(e =>
                `<option value="${e.id}">${e.numero || e.nombre} - ${e.juzgado}</option>`
            ).join('');

        const colores = [
            { nombre: 'Amarillo', valor: '#fff3cd' },
            { nombre: 'Verde', valor: '#d4edda' },
            { nombre: 'Azul', valor: '#cce5ff' },
            { nombre: 'Rosa', valor: '#f8d7da' },
            { nombre: 'Morado', valor: '#e2d5f1' }
        ];

        const coloresHtml = colores.map(c =>
            `<button type="button" class="color-btn" style="background:${c.valor}" onclick="seleccionarColorNota('${c.valor}')" title="${c.nombre}"></button>`
        ).join('');

        document.getElementById('modal-titulo').textContent = 'Nueva Nota';
        document.getElementById('modal-body').innerHTML = `
            <form id="nota-form" onsubmit="guardarNota(event)">
                <input type="hidden" id="nota-id">
                <input type="hidden" id="nota-color" value="#fff3cd">
                <div class="form-group">
                    <label>Expediente o tema (opcional)</label>
                    <select id="nota-expediente" onchange="toggleExpedienteCustom('nota')">
                        ${selectHtml}
                    </select>
                </div>
                <div class="form-group" id="nota-expediente-custom-group" style="display: none;">
                    <label>Número de expediente o tema</label>
                    <input type="text" id="nota-expediente-custom" placeholder="Ej: 123/2025, Reunión cliente, etc.">
                </div>
                <div class="form-group">
                    <label>Título *</label>
                    <input type="text" id="nota-titulo" placeholder="Título de la nota" required>
                </div>
                <div class="form-group">
                    <label>Contenido</label>
                    <textarea id="nota-contenido" rows="4" placeholder="Escribe aquí..."></textarea>
                </div>
                <div class="form-group">
                    <label>Color</label>
                    <div class="color-picker">${coloresHtml}</div>
                </div>
                <div class="form-group">
                    <label>Recordatorio (opcional)</label>
                    <input type="datetime-local" id="nota-recordatorio">
                </div>
            </form>
        `;
        document.getElementById('modal-footer').innerHTML = `
            <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
            <button class="btn btn-primary" onclick="document.getElementById('nota-form').requestSubmit()">💾 Guardar</button>
        `;

        abrirModal();
    });
}

function seleccionarColorNota(color) {
    document.getElementById('nota-color').value = color;
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.style.background === color);
    });
}

async function guardarNota(event) {
    event.preventDefault();

    const id = document.getElementById('nota-id').value;
    const expedienteSelect = document.getElementById('nota-expediente').value;
    const expedienteCustom = document.getElementById('nota-expediente-custom')?.value?.trim() || '';
    const titulo = document.getElementById('nota-titulo').value.trim();
    const contenido = document.getElementById('nota-contenido').value.trim();
    const color = document.getElementById('nota-color').value;
    const recordatorio = document.getElementById('nota-recordatorio').value;

    if (!titulo) {
        mostrarToast('El título es requerido', 'error');
        return;
    }

    // Manejar expediente: puede ser ID numérico, personalizado, o ninguno (general)
    let expedienteId = null;
    let expedienteTexto = null;

    if (expedienteSelect === '__custom__' && expedienteCustom) {
        expedienteTexto = expedienteCustom;
    } else if (expedienteSelect && expedienteSelect !== '__custom__' && expedienteSelect !== '') {
        expedienteId = parseInt(expedienteSelect);
    }

    const nota = {
        expedienteId,
        expedienteTexto, // Nuevo campo para expedientes/temas personalizados
        titulo,
        contenido,
        color,
        recordatorio: recordatorio || null
    };

    try {
        // Guardado, refresco y sync centralizados en el núcleo de acciones
        // (mismo camino que el asistente de voz).
        if (id) {
            await actualizarNotaCore(parseInt(id), nota);
            mostrarToast('Nota actualizada', 'success');
        } else {
            await crearNotaCore(nota);
            mostrarToast('Nota creada', 'success');
        }
        cerrarModal();
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'error');
    }
}

async function editarNota(id) {
    const notas = await obtenerNotas();
    const nota = notas.find(n => n.id === id);
    if (!nota) return;

    await mostrarFormularioNota();

    setTimeout(() => {
        document.getElementById('modal-titulo').textContent = 'Editar Nota';
        document.getElementById('nota-id').value = id;
        document.getElementById('nota-titulo').value = nota.titulo;
        document.getElementById('nota-contenido').value = nota.contenido || '';
        document.getElementById('nota-color').value = nota.color || '#fff3cd';
        if (nota.recordatorio) {
            document.getElementById('nota-recordatorio').value = nota.recordatorio.slice(0, 16);
        }

        // Manejar expediente personalizado
        if (nota.expedienteTexto) {
            document.getElementById('nota-expediente').value = '__custom__';
            toggleExpedienteCustom('nota');
            document.getElementById('nota-expediente-custom').value = nota.expedienteTexto;
        } else if (nota.expedienteId) {
            document.getElementById('nota-expediente').value = nota.expedienteId;
        } else {
            document.getElementById('nota-expediente').value = '';
        }

        document.getElementById('modal-footer').innerHTML = `
            <button class="btn btn-danger" onclick="confirmarEliminarNota(${id})">🗑️ Eliminar</button>
            <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
            <button class="btn btn-primary" onclick="document.getElementById('nota-form').requestSubmit()">💾 Guardar</button>
        `;
    }, 100);
}

function confirmarEliminarNota(id) {
    if (confirm('¿Eliminar esta nota?')) {
        eliminarNota(id).then(async () => {
            cerrarModal();
            await cargarNotas();
            await cargarEstadisticas();
            mostrarToast('Nota eliminada', 'success');
            // Propagar el borrado: eliminarNota registró la tombstone para
            // que no resucite en otros dispositivos al sincronizar.
            if (typeof marcarYSincronizar === 'function') await marcarYSincronizar();
        });
    }
}

async function filtrarNotas() {
    const busqueda = document.getElementById('buscar-nota').value.toLowerCase();
    const filtroValue = document.getElementById('filtro-expediente-nota').value;

    let notas = await obtenerNotas();
    const expedientes = await obtenerExpedientes();
    const expMap = Object.fromEntries(expedientes.map(e => [e.id, e]));

    if (busqueda) {
        notas = notas.filter(n =>
            n.titulo.toLowerCase().includes(busqueda) ||
            (n.contenido && n.contenido.toLowerCase().includes(busqueda)) ||
            (n.expedienteTexto && n.expedienteTexto.toLowerCase().includes(busqueda))
        );
    }

    // Filtrar por tipo de expediente
    if (filtroValue === '__general__') {
        // Solo notas sin expediente (ni ID ni texto)
        notas = notas.filter(n => !n.expedienteId && !n.expedienteTexto);
    } else if (filtroValue === '__custom__') {
        // Solo notas con expediente/tema personalizado
        notas = notas.filter(n => n.expedienteTexto);
    } else if (filtroValue) {
        // Expediente específico por ID
        notas = notas.filter(n => n.expedienteId === parseInt(filtroValue));
    }

    const lista = document.getElementById('lista-notas');
    const count = document.getElementById('count-notas');

    if (notas.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🔍</span>
                <h3>Sin resultados</h3>
            </div>
        `;
    } else {
        lista.innerHTML = notas.map(nota => {
            const exp = expMap[nota.expedienteId];
            // Determinar qué mostrar como expediente
            let expedienteLabel;
            if (nota.expedienteTexto) {
                expedienteLabel = `✏️ ${nota.expedienteTexto}`;
            } else if (exp) {
                expedienteLabel = `📁 ${exp.numero || exp.nombre}`;
            } else {
                expedienteLabel = '📋 General';
            }
            return `
                <div class="nota-card" style="background-color: ${nota.color || '#fff3cd'}" onclick="editarNota(${nota.id})">
                    <div class="nota-header">
                        <h3 class="nota-titulo">${nota.titulo}</h3>
                    </div>
                    <p class="nota-contenido">${nota.contenido || 'Sin contenido'}</p>
                    <div class="nota-footer">
                        <span class="nota-expediente">${expedienteLabel}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    count.textContent = `${notas.length} nota${notas.length !== 1 ? 's' : ''}`;
}

// ==================== CALENDARIO ====================

async function cargarEventos() {
    const eventos = await obtenerEventos();
    actualizarEventosHoy(eventos);
}

function actualizarEventosHoy(eventos) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Mostrar eventos de los próximos 8 días (hoy + 7 días)
    const limiteFecha = new Date(hoy);
    limiteFecha.setDate(limiteFecha.getDate() + 8);

    const eventosProximos = eventos.filter(e => {
        const fecha = new Date(e.fechaInicio);
        return fecha >= hoy && fecha < limiteFecha;
    }).sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

    const container = document.getElementById('eventos-hoy');

    if (eventosProximos.length === 0) {
        container.innerHTML = `
            <div class="empty-state small">
                <span>🎉</span>
                <p>No hay eventos próximos</p>
            </div>
        `;
    } else {
        container.innerHTML = eventosProximos.map(e => {
            const fecha = new Date(e.fechaInicio);
            const esHoy = fecha.toDateString() === hoy.toDateString();
            const manana = new Date(hoy);
            manana.setDate(manana.getDate() + 1);
            const esManana = fecha.toDateString() === manana.toDateString();

            let fechaTexto;
            if (esHoy) {
                fechaTexto = 'Hoy';
            } else if (esManana) {
                fechaTexto = 'Mañana';
            } else {
                fechaTexto = fecha.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
            }

            const horaTexto = e.todoElDia ? 'Todo el día' :
                fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

            // Preparar información para el tooltip
            const tipoLabel = {
                audiencia: 'Audiencia',
                vencimiento: 'Vencimiento',
                recordatorio: 'Recordatorio',
                otro: 'Otro'
            }[e.tipo] || e.tipo || 'Evento';

            const fechaCompleta = fecha.toLocaleDateString('es-MX', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            const horaCompleta = e.todoElDia ? 'Todo el día' :
                fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

            const instPrefix = e.institucion === 'PJF' ? '[PJF] ' : '';
            const expedienteInfo = instPrefix + (e.expedienteTexto || e.numeroExpediente ||
                (e.expedienteId ? `Expediente #${e.expedienteId}` : 'Sin expediente'));

            const descripcionCorta = e.descripcion ?
                (e.descripcion.length > 80 ? e.descripcion.substring(0, 80) + '...' : e.descripcion) :
                'Sin descripción';

            const filasContextoIA = e.origenIA ? `
                        ${e.tipoAcuerdo ? `<div class="event-tooltip-row"><span class="event-tooltip-label">Acuerdo:</span><span class="event-tooltip-value">${escapeText(e.tipoAcuerdo)}</span></div>` : ''}
                        ${e.juzgadoOrigen ? `<div class="event-tooltip-row"><span class="event-tooltip-label">Órgano:</span><span class="event-tooltip-value">${escapeText(e.juzgadoOrigen)}</span></div>` : ''}
                        ${e.resumen ? `<div class="event-tooltip-row"><span class="event-tooltip-label">Resumen:</span><span class="event-tooltip-value">${escapeText(e.resumen.length > 120 ? e.resumen.substring(0, 120) + '…' : e.resumen)}</span></div>` : ''}
            ` : '';

            return `
                <div class="list-item list-item-with-tooltip" style="border-left: 3px solid ${e.color || '#3788d8'}">
                    <div class="list-item-info">
                        <span class="list-item-title">${e.titulo}${e.origenIA ? ' <span style="background:#e0e7ff;color:#3730a3;font-size:0.65rem;padding:1px 6px;border-radius:8px;margin-left:4px;">🤖 IA</span>' : ''}</span>
                        <span class="list-item-subtitle">${fechaTexto} • ${horaTexto}</span>
                    </div>
                    <div class="event-tooltip">
                        <div class="event-tooltip-title">${e.titulo}</div>
                        <div class="event-tooltip-row">
                            <span class="event-tooltip-label">Tipo:</span>
                            <span class="event-tooltip-value">
                                <span class="event-tooltip-badge" style="background: ${e.color || '#3788d8'}; color: white;">
                                    ${tipoLabel}
                                </span>
                            </span>
                        </div>
                        <div class="event-tooltip-row">
                            <span class="event-tooltip-label">Fecha:</span>
                            <span class="event-tooltip-value">${fechaCompleta}</span>
                        </div>
                        <div class="event-tooltip-row">
                            <span class="event-tooltip-label">Hora:</span>
                            <span class="event-tooltip-value">${horaCompleta}</span>
                        </div>
                        <div class="event-tooltip-row">
                            <span class="event-tooltip-label">Expediente:</span>
                            <span class="event-tooltip-value">${expedienteInfo}</span>
                        </div>
                        ${filasContextoIA}
                        <div class="event-tooltip-row">
                            <span class="event-tooltip-label">Detalles:</span>
                            <span class="event-tooltip-value">${descripcionCorta}</span>
                        </div>
                        ${e.alerta ? '<div class="event-tooltip-row"><span class="event-tooltip-label">🔔</span><span class="event-tooltip-value">Tiene recordatorio</span></div>' : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Inicializar event listeners para tooltips
        initEventTooltips();
    }
}

function initEventTooltips() {
    const items = document.querySelectorAll('.list-item-with-tooltip');
    items.forEach(item => {
        const tooltip = item.querySelector('.event-tooltip');
        if (!tooltip) return;

        item.addEventListener('mouseenter', (e) => {
            // Primero hacer visible para medir dimensiones reales
            tooltip.style.visibility = 'hidden';
            tooltip.style.display = 'block';
            const tooltipRect = tooltip.getBoundingClientRect();
            const tooltipWidth = tooltipRect.width || 300;
            const tooltipHeight = tooltipRect.height || 180;
            tooltip.style.display = '';
            tooltip.style.visibility = '';

            const rect = item.getBoundingClientRect();
            const margin = 15;

            // Posicionar a la derecha del elemento por defecto
            let left = rect.right + 10;

            // Si no cabe a la derecha, mostrar a la izquierda
            if (left + tooltipWidth > window.innerWidth - margin) {
                left = rect.left - tooltipWidth - 10;
                // Si tampoco cabe a la izquierda, centrar en la pantalla
                if (left < margin) {
                    left = Math.max(margin, (window.innerWidth - tooltipWidth) / 2);
                }
            }

            // Calcular posición vertical - alineado con el centro del item
            let top = rect.top + (rect.height / 2) - (tooltipHeight / 2);

            // Asegurar que no se salga por arriba
            if (top < margin) {
                top = margin;
            }

            // Asegurar que no se salga por abajo
            if (top + tooltipHeight > window.innerHeight - margin) {
                top = window.innerHeight - tooltipHeight - margin;
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            tooltip.style.transform = 'none';
            tooltip.classList.add('visible');
        });

        item.addEventListener('mouseleave', () => {
            tooltip.classList.remove('visible');
        });
    });
}

async function renderizarCalendario() {
    const eventos = await obtenerEventos();
    const diasContainer = document.getElementById('calendario-dias');
    const mesActual = document.getElementById('mes-actual');

    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    mesActual.textContent = `${meses[fechaCalendario.getMonth()]} ${fechaCalendario.getFullYear()}`;

    const dias = generarDiasDelMes(fechaCalendario, eventos);
    diasContainer.innerHTML = dias;

    // Actualizar panel de eventos
    actualizarPanelEventos(eventos);

    // Inicializar soporte touch para el calendario
    inicializarTouchCalendario();
}

// Variables para el soporte touch del calendario
let touchStartX = 0;
let touchEndX = 0;
let touchStartY = 0;
let touchEndY = 0;
let isSwiping = false;

function inicializarTouchCalendario() {
    const calendario = document.querySelector('.calendario');
    if (!calendario || calendario.dataset.touchInit === 'true') return;

    calendario.dataset.touchInit = 'true';

    calendario.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
        isSwiping = true;
    }, { passive: true });

    calendario.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;
        const currentX = e.changedTouches[0].screenX;
        const currentY = e.changedTouches[0].screenY;
        const diffX = Math.abs(currentX - touchStartX);
        const diffY = Math.abs(currentY - touchStartY);

        // Si el movimiento es más horizontal que vertical, es un swipe para cambiar mes
        if (diffX > diffY && diffX > 30) {
            e.preventDefault();
        }
    }, { passive: false });

    calendario.addEventListener('touchend', (e) => {
        if (!isSwiping) return;
        isSwiping = false;

        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;

        const diffX = touchEndX - touchStartX;
        const diffY = Math.abs(touchEndY - touchStartY);

        // Solo procesar swipe si es más horizontal que vertical
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > diffY) {
            if (diffX < 0) {
                // Swipe izquierda → siguiente mes
                mesSiguiente();
            } else {
                // Swipe derecha → mes anterior
                mesAnterior();
            }
        }
    }, { passive: true });
}

function generarDiasDelMes(fecha, eventos) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const inicioMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    const finMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);

    const diasHtml = [];

    // Días del mes anterior
    const primerDia = inicioMes.getDay();
    for (let i = primerDia - 1; i >= 0; i--) {
        const dia = new Date(inicioMes);
        dia.setDate(dia.getDate() - i - 1);
        diasHtml.push(`<div class="dia-cell otro-mes">${dia.getDate()}</div>`);
    }

    // Días del mes actual
    for (let i = 1; i <= finMes.getDate(); i++) {
        const dia = new Date(fecha.getFullYear(), fecha.getMonth(), i);
        const esHoy = dia.getTime() === hoy.getTime();
        const eventosDelDia = eventos.filter(e => {
            const fechaEvento = new Date(e.fechaInicio);
            return fechaEvento.toDateString() === dia.toDateString();
        });
        const infoInhabil = esDiaInhabil(dia);

        let clases = 'dia-cell';
        if (esHoy) clases += ' es-hoy';
        if (diaSeleccionado && dia.getTime() === diaSeleccionado.getTime()) clases += ' seleccionado';
        if (infoInhabil.inhabil) clases += ' dia-inhabil';

        let dotsHtml = '';
        if (eventosDelDia.length > 0) {
            dotsHtml = `<div class="dia-eventos">
                ${eventosDelDia.slice(0, 3).map(e => `<span class="evento-dot" style="background:${e.color || '#3788d8'}"></span>`).join('')}
                ${eventosDelDia.length > 3 ? `<span class="eventos-mas">+${eventosDelDia.length - 3}</span>` : ''}
            </div>`;
        }

        const tooltipInhabil = infoInhabil.inhabil ? ` title="${infoInhabil.razon}"` : '';

        // Etiqueta visible del día inhábil
        let inhabilLabelHtml = '';
        if (infoInhabil.inhabil) {
            inhabilLabelHtml = `<span class="dia-inhabil-label">${infoInhabil.razon}</span>`;
        }

        diasHtml.push(`
            <div class="${clases}"${tooltipInhabil} onclick="seleccionarDia(${dia.getTime()})" ondblclick="crearEventoEnDia(${dia.getTime()})">
                <div class="dia-header">
                    <span class="dia-numero">${i}</span>
                    ${infoInhabil.inhabil ? '<span class="dia-inhabil-icon">⛔</span>' : ''}
                </div>
                ${inhabilLabelHtml}
                ${dotsHtml}
            </div>
        `);
    }

    // Días del mes siguiente
    const diasRestantes = 42 - diasHtml.length;
    for (let i = 1; i <= diasRestantes; i++) {
        diasHtml.push(`<div class="dia-cell otro-mes">${i}</div>`);
    }

    return diasHtml.join('');
}

function seleccionarDia(timestamp) {
    diaSeleccionado = new Date(timestamp);
    renderizarCalendario();
}

async function actualizarPanelEventos(eventos) {
    const panel = document.getElementById('lista-eventos-panel');
    const titulo = document.getElementById('eventos-panel-titulo');

    let eventosAMostrar;

    if (diaSeleccionado) {
        titulo.textContent = diaSeleccionado.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
        eventosAMostrar = eventos.filter(e => {
            const fecha = new Date(e.fechaInicio);
            return fecha.toDateString() === diaSeleccionado.toDateString();
        });
    } else {
        titulo.textContent = 'Eventos del Mes';
        const inicioMes = new Date(fechaCalendario.getFullYear(), fechaCalendario.getMonth(), 1);
        const finMes = new Date(fechaCalendario.getFullYear(), fechaCalendario.getMonth() + 1, 0);
        eventosAMostrar = eventos.filter(e => {
            const fecha = new Date(e.fechaInicio);
            return fecha >= inicioMes && fecha <= finMes;
        });
    }

    // Botón para agregar evento (siempre visible)
    const btnAgregar = diaSeleccionado
        ? `<button class="btn btn-sm btn-primary btn-agregar-evento" onclick="crearEventoEnDia(${diaSeleccionado.getTime()})">➕ Agregar evento</button>`
        : `<button class="btn btn-sm btn-primary btn-agregar-evento" onclick="mostrarFormularioEvento()">➕ Agregar evento</button>`;

    if (eventosAMostrar.length === 0) {
        panel.innerHTML = `
            <div class="empty-state small">
                <span>📭</span>
                <p>No hay eventos</p>
                ${btnAgregar}
            </div>
        `;
    } else {
        panel.innerHTML = eventosAMostrar.map(e => {
            const instBadgeEvt = e.institucion === 'PJF'
                ? '<span class="institucion-badge pjf" style="font-size: 0.6rem; margin-left: 0.3rem;">PJF</span>'
                : e.institucion === 'OTRO'
                ? '<span class="institucion-badge otro" style="font-size: 0.6rem; margin-left: 0.3rem;">Varios</span>'
                : '';
            const iaBadge = e.origenIA
                ? '<span class="ia-badge" style="font-size:0.6rem; margin-left:0.3rem; background:#e0e7ff; color:#3730a3; padding:1px 6px; border-radius:8px;" title="Creado desde análisis IA">🤖 IA</span>'
                : '';
            const expLabel = e.numeroExpediente || e.expedienteTexto || (e.expedienteId ? `#${e.expedienteId}` : '');
            const expLinea = expLabel
                ? `<span class="evento-expediente" style="font-size:0.72rem; color:#555; display:block; margin-top:2px;">📂 Exp. ${escapeText(expLabel)}</span>`
                : '';
            const horaTexto = e.todoElDia
                ? 'Todo el día'
                : new Date(e.fechaInicio).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
            return `
            <div class="evento-item" onclick="editarEvento(${e.id})" style="border-left: 3px solid ${escapeText(e.color || '#3788d8')}">
                <div class="evento-info">
                    <span class="evento-titulo">${escapeText(e.titulo)}${instBadgeEvt}${iaBadge}</span>
                    <span class="evento-hora">${horaTexto}</span>
                    ${expLinea}
                </div>
                ${e.alerta ? '<span class="evento-alerta">🔔</span>' : ''}
            </div>
        `;
        }).join('') + `<div class="panel-agregar-evento">${btnAgregar}</div>`;
    }
}

function mesAnterior() {
    fechaCalendario.setMonth(fechaCalendario.getMonth() - 1);
    diaSeleccionado = null;
    renderizarCalendario();
}

function mesSiguiente() {
    fechaCalendario.setMonth(fechaCalendario.getMonth() + 1);
    diaSeleccionado = null;
    renderizarCalendario();
}

function irAHoy() {
    fechaCalendario = new Date();
    diaSeleccionado = new Date();
    diaSeleccionado.setHours(0, 0, 0, 0);
    renderizarCalendario();
}

function crearEventoEnDia(timestamp) {
    const fecha = new Date(timestamp);
    mostrarFormularioEvento(fecha);
}

async function mostrarFormularioEvento(fecha = null) {
    const expedientes = await obtenerExpedientes();
    const selectHtml = '<option value="">Sin expediente</option>' +
        '<option value="__custom__">✏️ Otro (escribir manualmente)</option>' +
        expedientes.map(e => `<option value="${e.id}">${e.numero || e.nombre}</option>`).join('');

    const fechaDefault = fecha || diaSeleccionado || new Date();
    fechaDefault.setHours(9, 0, 0, 0);

    document.getElementById('modal-titulo').textContent = 'Nuevo Evento';
    document.getElementById('modal-body').innerHTML = `
        <form id="evento-form" onsubmit="guardarEvento(event)">
            <input type="hidden" id="evento-id">
            <div class="form-group">
                <label>Título *</label>
                <input type="text" id="evento-titulo" placeholder="Ej: Audiencia de pruebas" required>
            </div>
            <div class="form-group">
                <label>Tipo</label>
                <select id="evento-tipo">
                    <option value="audiencia">⚖️ Audiencia</option>
                    <option value="vencimiento">⚠️ Vencimiento</option>
                    <option value="recordatorio">🔔 Recordatorio</option>
                    <option value="otro">📌 Otro</option>
                </select>
            </div>
            <div class="form-group">
                <label>Fecha y hora *</label>
                <input type="datetime-local" id="evento-fecha" value="${fechaDefault.toISOString().slice(0, 16)}" required>
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="evento-todo-dia">
                    <span>Todo el día</span>
                </label>
            </div>
            <div class="form-group">
                <label>Expediente (opcional)</label>
                <select id="evento-expediente" onchange="toggleExpedienteCustom('evento')">${selectHtml}</select>
            </div>
            <div class="form-group" id="evento-expediente-custom-group" style="display: none;">
                <label>Número de expediente o tema</label>
                <input type="text" id="evento-expediente-custom" placeholder="Ej: 123/2025, Junta de socios, etc.">
            </div>
            <div class="form-group">
                <label>Descripción</label>
                <textarea id="evento-descripcion" rows="2" placeholder="Detalles..."></textarea>
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="evento-alerta" checked>
                    <span>Activar alerta</span>
                </label>
            </div>
        </form>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="document.getElementById('evento-form').requestSubmit()">💾 Guardar</button>
    `;

    abrirModal();
}

// Toggle para mostrar campo de expediente personalizado
function toggleExpedienteCustom(prefix) {
    const select = document.getElementById(`${prefix}-expediente`);
    const customGroup = document.getElementById(`${prefix}-expediente-custom-group`);
    if (select && customGroup) {
        customGroup.style.display = select.value === '__custom__' ? 'block' : 'none';
    }
}

// Fuente única de colores por tipo de evento: acciones-core.js
const COLORES_EVENTOS = CORE_COLORES_EVENTOS;

async function guardarEvento(event) {
    event.preventDefault();

    const id = document.getElementById('evento-id').value;
    const titulo = document.getElementById('evento-titulo').value.trim();
    const tipo = document.getElementById('evento-tipo').value;
    const fechaInicio = document.getElementById('evento-fecha').value;
    const todoElDia = document.getElementById('evento-todo-dia').checked;
    const expedienteSelect = document.getElementById('evento-expediente').value;
    const expedienteCustom = document.getElementById('evento-expediente-custom')?.value?.trim() || '';
    const descripcion = document.getElementById('evento-descripcion').value.trim();
    const alerta = document.getElementById('evento-alerta').checked;

    if (!titulo || !fechaInicio) {
        mostrarToast('Completa los campos requeridos', 'error');
        return;
    }

    // Manejar expediente: puede ser ID numérico, personalizado, o ninguno
    let expedienteId = null;
    let expedienteTexto = null;

    if (expedienteSelect === '__custom__' && expedienteCustom) {
        expedienteTexto = expedienteCustom; // Guardar como texto personalizado
    } else if (expedienteSelect && expedienteSelect !== '__custom__') {
        expedienteId = parseInt(expedienteSelect);
    }

    const evento = {
        titulo,
        tipo,
        fechaInicio: new Date(fechaInicio).toISOString(),
        todoElDia,
        expedienteId,
        expedienteTexto, // Nuevo campo para expedientes personalizados
        descripcion,
        alerta,
        color: COLORES_EVENTOS[tipo]
    };

    try {
        // Guardado, refresco, sync y Google Calendar van por el núcleo de
        // acciones (acciones-core.js), el mismo camino que el asistente de voz.
        if (id) {
            await actualizarEventoCore(parseInt(id), evento);
            mostrarToast('Evento actualizado', 'success');
        } else {
            await crearEventoCore(evento);
            mostrarToast('Evento creado', 'success');
        }
        cerrarModal();
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'error');
    }
}

async function editarEvento(id) {
    const eventos = await obtenerEventos();
    const evento = eventos.find(e => e.id === id);
    if (!evento) return;

    await mostrarFormularioEvento(new Date(evento.fechaInicio));

    setTimeout(() => {
        document.getElementById('modal-titulo').textContent = 'Editar Evento';
        document.getElementById('evento-id').value = id;
        document.getElementById('evento-titulo').value = evento.titulo;
        document.getElementById('evento-tipo').value = evento.tipo;
        document.getElementById('evento-fecha').value = new Date(evento.fechaInicio).toISOString().slice(0, 16);
        document.getElementById('evento-todo-dia').checked = evento.todoElDia;
        document.getElementById('evento-descripcion').value = evento.descripcion || '';
        document.getElementById('evento-alerta').checked = evento.alerta;

        // Manejar expediente personalizado
        if (evento.expedienteTexto) {
            document.getElementById('evento-expediente').value = '__custom__';
            toggleExpedienteCustom('evento');
            document.getElementById('evento-expediente-custom').value = evento.expedienteTexto;
        } else {
            document.getElementById('evento-expediente').value = evento.expedienteId || '';
        }

        // Si el evento viene de un análisis IA, mostrar contexto del acuerdo
        // por encima del formulario para que el usuario lo vea al editar.
        const formBody = document.getElementById('modal-body');
        if (formBody && evento.origenIA) {
            const ya = formBody.querySelector('.evento-contexto-acuerdo');
            if (ya) ya.remove();
            const ctxLineas = [];
            if (evento.tipoAcuerdo) ctxLineas.push(`<div><strong>📝 Tipo de acuerdo:</strong> ${escapeText(evento.tipoAcuerdo)}</div>`);
            if (evento.juzgadoOrigen) ctxLineas.push(`<div><strong>🏛️ Órgano:</strong> ${escapeText(evento.juzgadoOrigen)}</div>`);
            if (evento.resumen) ctxLineas.push(`<div style="margin-top:0.5rem;"><strong>📄 Resumen:</strong> ${escapeText(evento.resumen)}</div>`);
            if (ctxLineas.length > 0) {
                const ctxHtml = `<div class="evento-contexto-acuerdo" style="background:#f0f9ff;border-left:3px solid #3788d8;padding:0.6rem 0.8rem;margin-bottom:0.75rem;border-radius:4px;font-size:0.85rem;">
                    <div style="font-weight:600;margin-bottom:0.3rem;">🤖 Contexto del acuerdo (análisis IA)</div>
                    ${ctxLineas.join('')}
                </div>`;
                formBody.insertAdjacentHTML('afterbegin', ctxHtml);
            }
        }

        const verExpBtn = evento.expedienteId
            ? `<button class="btn btn-info" onclick="verExpedienteDesdeEvento(${evento.expedienteId})" title="Abrir el expediente relacionado">📂 Ver expediente</button>`
            : '';

        const gcalUrl = (typeof GCAL !== 'undefined') ? GCAL.urlAgregarGCal(evento) : null;
        const gcalBtn = gcalUrl
            ? `<a class="btn btn-secondary" href="${gcalUrl}" target="_blank" rel="noopener" title="Agregar a Google Calendar">📅 GCal</a>`
            : '';

        document.getElementById('modal-footer').innerHTML = `
            <button class="btn btn-danger" onclick="confirmarEliminarEvento(${id})">🗑️ Eliminar</button>
            ${verExpBtn}
            ${gcalBtn}
            <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
            <button class="btn btn-primary" onclick="document.getElementById('evento-form').requestSubmit()">💾 Guardar</button>
        `;
    }, 100);
}

// Navegar al expediente relacionado desde el modal de evento.
// Detecta si es PJF para mostrar la sección PJF correcta, y abre el modo
// edición para que el usuario vea todos los datos del expediente.
async function verExpedienteDesdeEvento(expedienteId) {
    try {
        const exp = await obtenerExpediente(expedienteId);
        if (!exp) {
            mostrarToast('El expediente vinculado ya no existe', 'warning');
            return;
        }
        cerrarModal();
        if (exp.institucion === 'PJF' && typeof editarExpedientePJF === 'function') {
            await editarExpedientePJF(expedienteId);
        } else {
            navegarA('expedientes');
            setTimeout(() => editarExpediente(expedienteId), 150);
        }
    } catch (e) {
        Logger.error('No se pudo abrir el expediente vinculado:', e);
        mostrarToast('No se pudo abrir el expediente vinculado', 'error');
    }
}

function confirmarEliminarEvento(id) {
    if (confirm('¿Eliminar este evento?')) {
        eliminarEvento(id).then(async () => {
            cerrarModal();
            await cargarEventos();
            await cargarEstadisticas();
            renderizarCalendario();
            mostrarToast('Evento eliminado', 'success');
            // Propagar el borrado: eliminarEvento ya registró la tombstone,
            // así que la próxima sync evita que el evento resucite en otros
            // dispositivos.
            if (typeof marcarYSincronizar === 'function') await marcarYSincronizar();
        });
    }
}

// ==================== BÚSQUEDA ====================

async function cargarExpedientesParaBusqueda() {
    const todosExpedientes = await obtenerExpedientes();
    // Solo mostrar expedientes del TSJQROO en la sección de búsqueda TSJ
    let expedientes = todosExpedientes.filter(exp => (exp.institucion || 'TSJ') === 'TSJ');
    // Limpiar seleccionados que sean de PJF (por si quedaron de una sesión anterior)
    expedientesSeleccionados = expedientesSeleccionados.filter(id => expedientes.some(e => e.id === id));
    const container = document.getElementById('expedientes-busqueda');
    const totalExpedientes = expedientes.length;

    // Límite compartido: el cupo disponible para TSJ = total límite - cuántos PJF hay
    const esPremium = estadoPremium && estadoPremium.activo;
    let mostrandoLimitados = false;

    if (!esPremium) {
        const noTSJCount = todosExpedientes.filter(exp => (exp.institucion || 'TSJ') !== 'TSJ').length;
        const limiteDisponibleTSJ = Math.max(0, PREMIUM_CONFIG.limiteExpedientes - noTSJCount);
        if (totalExpedientes > limiteDisponibleTSJ) {
            expedientes = [...expedientes]
                .sort((a, b) => new Date(b.fechaModificacion || b.fechaCreacion || 0) - new Date(a.fechaModificacion || a.fechaCreacion || 0))
                .slice(0, limiteDisponibleTSJ);
            mostrandoLimitados = true;
            // Limpiar seleccionados que ya no están visibles
            expedientesSeleccionados = expedientesSeleccionados.filter(id => expedientes.some(e => e.id === id));
        }
    }

    if (expedientes.length === 0) {
        container.innerHTML = `
            <div class="empty-state small">
                <span>📂</span>
                <p>No hay expedientes. Agrega algunos primero.</p>
            </div>
        `;
        return;
    }

    let advertenciaHTML = '';
    if (mostrandoLimitados) {
        advertenciaHTML = `
            <div style="background: #fff3cd; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.5rem; font-size: 0.8rem;">
                ⚠️ Mostrando solo ${expedientes.length} de ${totalExpedientes} expedientes TSJ (límite compartido de ${PREMIUM_CONFIG.limiteExpedientes} entre TSJ y PJF).
                <a href="#" onclick="mostrarSeccion('configuracion'); return false;">Activar Premium</a>
            </div>
        `;
    }

    container.innerHTML = advertenciaHTML + expedientes.map(exp => `
        <label class="expediente-seleccion-item ${expedientesSeleccionados.includes(exp.id) ? 'selected' : ''}">
            <input type="checkbox" ${expedientesSeleccionados.includes(exp.id) ? 'checked' : ''} onchange="toggleExpedienteSeleccion(${exp.id})">
            <div class="exp-info">
                <span class="exp-numero">${exp.numero || exp.nombre}</span>
                <span class="exp-juzgado">${exp.juzgado}</span>
                ${exp.comentario ? `<span class="exp-comentario">${exp.comentario}</span>` : ''}
            </div>
        </label>
    `).join('');

    document.getElementById('count-seleccionados').textContent = `${expedientesSeleccionados.length} seleccionados`;
}

function toggleExpedienteSeleccion(id) {
    if (expedientesSeleccionados.includes(id)) {
        expedientesSeleccionados = expedientesSeleccionados.filter(e => e !== id);
    } else {
        expedientesSeleccionados.push(id);
    }
    cargarExpedientesParaBusqueda();
}

async function seleccionarTodosExpedientes() {
    const expedientes = await obtenerExpedientes();
    // Solo operar sobre expedientes TSJ (excluir PJF)
    const tsjExpedientes = expedientes.filter(exp => (exp.institucion || 'TSJ') === 'TSJ');
    const todosSeleccionados = tsjExpedientes.every(e => expedientesSeleccionados.includes(e.id));
    if (todosSeleccionados) {
        expedientesSeleccionados = [];
    } else {
        expedientesSeleccionados = tsjExpedientes.map(e => e.id);
    }
    cargarExpedientesParaBusqueda();
}

async function generarURLsBusqueda() {
    if (expedientesSeleccionados.length === 0) {
        mostrarToast('Selecciona al menos un expediente', 'warning');
        return;
    }

    const expedientes = await obtenerExpedientes();
    // Solo generar URLs de TSJQROO para expedientes TSJ
    const seleccionados = expedientes.filter(e => expedientesSeleccionados.includes(e.id) && (e.institucion || 'TSJ') === 'TSJ');

    const urlsContainer = document.getElementById('urls-generadas');
    const listaUrls = document.getElementById('lista-urls');

    listaUrls.innerHTML = seleccionados.map(exp => {
        const tipoBusqueda = exp.numero ? 'numero' : 'nombre';
        const valor = exp.numero || exp.nombre;
        const url = construirUrlBusqueda(exp.juzgado, tipoBusqueda, valor);

        if (!url) {
            // Expediente PJF u órgano no reconocido — no tiene URL de búsqueda TSJQROO
            return `
                <div class="url-item url-item-unavailable">
                    <div class="url-info">
                        <span class="url-expediente">${exp.numero || exp.nombre}</span>
                        <span class="url-juzgado">${exp.juzgado}</span>
                    </div>
                    <div class="url-actions">
                        <span class="url-unavailable-msg" title="Este expediente no pertenece a un juzgado del TSJQROO">⚠️ Sin URL (PJF/no TSJQROO)</span>
                    </div>
                </div>
            `;
        }

        const urlEscaped = url.replace(/'/g, "\\'");
        const valorEscaped = valor.replace(/'/g, "\\'");

        return `
            <div class="url-item">
                <div class="url-info">
                    <span class="url-expediente">${exp.numero || exp.nombre}</span>
                    <span class="url-juzgado">${exp.juzgado}</span>
                </div>
                <div class="url-actions">
                    <button class="btn btn-sm btn-secondary" onclick="copiarURL('${urlEscaped}')" title="Copiar">📋</button>
                    <button class="btn btn-sm btn-primary" onclick="abrirBusquedaPopup('${urlEscaped}', '${valorEscaped}')">👁️ Ver</button>
                </div>
            </div>
        `;
    }).join('');

    urlsContainer.style.display = 'block';
    mostrarToast(`${seleccionados.length} URLs generadas`, 'success');
}

// Abrir búsqueda en popup window
function abrirBusquedaPopup(url, titulo) {
    if (!url) {
        mostrarToast('Sin URL de búsqueda para este expediente (PJF/no TSJQROO)', 'warning');
        return;
    }
    // Calcular posición del popup (a la derecha de la pantalla)
    const width = Math.min(900, window.screen.width * 0.5);
    const height = Math.min(700, window.screen.height * 0.8);
    const left = window.screen.width - width - 50;
    const top = (window.screen.height - height) / 2;

    const popup = window.open(
        url,
        'TSJ_Busqueda_' + Date.now(),
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes,toolbar=no,menubar=no,location=no,status=no`
    );

    if (popup) {
        popup.focus();
        mostrarToast(`Buscando: ${titulo}`, 'info');
    } else {
        // Si el popup fue bloqueado, abrir en nueva pestaña
        mostrarToast('Popup bloqueado. Abriendo en nueva pestaña...', 'warning');
        window.open(url, '_blank');
    }
}

// Abrir todas las búsquedas en popups secuenciales
async function abrirTodasBusquedas() {
    const expedientes = await obtenerExpedientes();
    // Solo abrir búsquedas TSJ para expedientes TSJ
    const seleccionados = expedientes.filter(e => expedientesSeleccionados.includes(e.id) && (e.institucion || 'TSJ') === 'TSJ');

    if (seleccionados.length === 0) {
        mostrarToast('Selecciona al menos un expediente', 'warning');
        return;
    }

    if (seleccionados.length > 5) {
        if (!confirm(`Vas a abrir ${seleccionados.length} ventanas. ¿Continuar?`)) {
            return;
        }
    }

    let delay = 0;
    seleccionados.forEach((exp, index) => {
        const tipoBusqueda = exp.numero ? 'numero' : 'nombre';
        const valor = exp.numero || exp.nombre;
        const url = construirUrlBusqueda(exp.juzgado, tipoBusqueda, valor);

        setTimeout(() => {
            abrirBusquedaPopup(url, valor);
        }, delay);

        delay += 500; // 500ms entre cada ventana
    });

    mostrarToast(`Abriendo ${seleccionados.length} búsquedas...`, 'success');
}

function copiarURL(url) {
    navigator.clipboard.writeText(url);
    mostrarToast('URL copiada', 'success');
}

async function copiarTodasURLs() {
    const expedientes = await obtenerExpedientes();
    // Solo copiar URLs de expedientes TSJ
    const seleccionados = expedientes.filter(e => expedientesSeleccionados.includes(e.id) && (e.institucion || 'TSJ') === 'TSJ');

    const urls = seleccionados.map(exp => {
        const tipoBusqueda = exp.numero ? 'numero' : 'nombre';
        const valor = exp.numero || exp.nombre;
        return construirUrlBusqueda(exp.juzgado, tipoBusqueda, valor);
    }).filter(url => url !== null).join('\n');

    navigator.clipboard.writeText(urls);
    mostrarToast('Todas las URLs copiadas', 'success');
}

// ==================== CONFIGURACIÓN ====================

async function cargarConfiguracion() {
    const notificaciones = await obtenerConfig('notificaciones');
    document.getElementById('config-notificaciones').checked = notificaciones === 'true';

    const emailServiceId = await obtenerConfig('email_service_id');
    const emailPublicKey = await obtenerConfig('email_public_key');
    const emailTemplateId = await obtenerConfig('email_template_id');
    const emailDestino = await obtenerConfig('email_destino');

    if (emailServiceId) document.getElementById('email-service-id').value = emailServiceId;
    if (emailPublicKey) document.getElementById('email-public-key').value = emailPublicKey;
    if (emailTemplateId) document.getElementById('email-template-id').value = emailTemplateId;
    if (emailDestino) document.getElementById('email-destino').value = emailDestino;

    // Cargar tema
    const temaOscuro = await obtenerConfig('tema_oscuro');
    const checkTema = document.getElementById('config-tema-oscuro');
    if (checkTema) {
        checkTema.checked = temaOscuro === 'true';
    }
    aplicarTema();

    // Cargar preferencia de anuncios (para premium, ocultos por defecto)
    const ocultarAnuncios = await obtenerConfig('ocultar_anuncios');
    const checkAnuncios = document.getElementById('config-ocultar-anuncios');
    if (checkAnuncios) {
        // Para premium: checked por defecto a menos que explícitamente quiera ver anuncios
        checkAnuncios.checked = ocultarAnuncios !== 'false';
    }

    // Cargar configuración de recordatorios
    await cargarConfigRecordatorios();

    // Verificar recordatorios automáticamente
    verificarRecordatoriosAutomatico();
}

// ==================== TEMA OSCURO ====================

function aplicarTema() {
    const temaOscuro = localStorage.getItem('tema_oscuro') === 'true';
    document.documentElement.setAttribute('data-theme', temaOscuro ? 'dark' : 'light');
}

async function toggleTemaOscuro() {
    const activado = document.getElementById('config-tema-oscuro').checked;
    localStorage.setItem('tema_oscuro', activado ? 'true' : 'false');
    await guardarConfig('tema_oscuro', activado ? 'true' : 'false');
    aplicarTema();
    mostrarToast(`Tema ${activado ? 'oscuro' : 'claro'} activado`, 'success');
}

// Aplicar tema al cargar (antes de que el DOM esté listo para evitar flash)
(function() {
    const temaOscuro = localStorage.getItem('tema_oscuro') === 'true';
    if (temaOscuro) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

async function toggleNotificaciones() {
    const activado = document.getElementById('config-notificaciones').checked;

    if (activado && 'Notification' in window) {
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') {
            document.getElementById('config-notificaciones').checked = false;
            mostrarToast('Debes permitir las notificaciones en tu navegador', 'warning');
            return;
        }
    }

    await guardarConfig('notificaciones', activado ? 'true' : 'false');
    mostrarToast(`Notificaciones ${activado ? 'activadas' : 'desactivadas'}`, 'success');
}

async function guardarConfigEmail(event) {
    event.preventDefault();

    await guardarConfig('email_service_id', document.getElementById('email-service-id').value);
    await guardarConfig('email_public_key', document.getElementById('email-public-key').value);
    await guardarConfig('email_template_id', document.getElementById('email-template-id').value);
    await guardarConfig('email_destino', document.getElementById('email-destino').value);

    mostrarToast('Configuración de email guardada', 'success');
}

async function probarEmail() {
    const serviceId = document.getElementById('email-service-id').value.trim();
    const publicKey = document.getElementById('email-public-key').value.trim();
    const templateId = document.getElementById('email-template-id').value.trim();
    const emailDestino = document.getElementById('email-destino').value.trim();

    if (!serviceId || !publicKey || !templateId || !emailDestino) {
        mostrarToast('Completa todos los campos de configuración', 'warning');
        return;
    }

    // Verificar si EmailJS está cargado
    if (typeof emailjs === 'undefined') {
        mostrarToast('Cargando EmailJS...', 'info');
        await cargarEmailJS();
    }

    try {
        // Inicializar EmailJS
        emailjs.init(publicKey);

        // Enviar email de prueba
        const templateParams = {
            to_email: emailDestino,
            subject: '✅ Prueba de TSJ Filing Online',
            message: `¡Tu configuración de EmailJS funciona correctamente!\n\nFecha: ${new Date().toLocaleString('es-MX')}\n\nYa puedes recibir notificaciones de eventos y recordatorios.`,
            from_name: 'TSJ Filing Online'
        };

        mostrarToast('Enviando email de prueba...', 'info');

        const response = await emailjs.send(serviceId, templateId, templateParams);

        if (response.status === 200) {
            mostrarToast('✅ Email enviado correctamente. Revisa tu bandeja de entrada.', 'success');
        } else {
            mostrarToast('Error al enviar email', 'error');
        }
    } catch (error) {
        Logger.error('Error EmailJS:', error);
        mostrarToast(`Error: ${error.text || error.message || 'Verifica tu configuración'}`, 'error');
    }
}

// Cargar SDK de EmailJS dinámicamente
function cargarEmailJS() {
    return new Promise((resolve, reject) => {
        if (typeof emailjs !== 'undefined') {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// ==================== SISTEMA DE RECORDATORIOS ====================

// Guardar configuración de recordatorios
async function guardarConfigRecordatorios() {
    const config = {
        unDia: document.getElementById('reminder-1day')?.checked || false,
        tresDias: document.getElementById('reminder-3days')?.checked || false,
        unaSemana: document.getElementById('reminder-1week')?.checked || false,
        suscripcion: document.getElementById('reminder-suscripcion')?.checked || false
    };

    await guardarConfig('recordatorios_config', JSON.stringify(config));
    mostrarToast('Configuración de recordatorios guardada', 'success');
}

// Cargar configuración de recordatorios
async function cargarConfigRecordatorios() {
    const configStr = await obtenerConfig('recordatorios_config');
    if (configStr) {
        try {
            const config = JSON.parse(configStr);
            const el1day = document.getElementById('reminder-1day');
            const el3days = document.getElementById('reminder-3days');
            const el1week = document.getElementById('reminder-1week');
            const elSuscripcion = document.getElementById('reminder-suscripcion');

            if (el1day) el1day.checked = config.unDia || false;
            if (el3days) el3days.checked = config.tresDias || false;
            if (el1week) el1week.checked = config.unaSemana || false;
            if (elSuscripcion) elSuscripcion.checked = config.suscripcion || false;
        } catch (e) {
            Logger.error('Error cargando config de recordatorios:', e);
        }
    }
}

// Parsear fecha de evento de forma local (evitar desfase UTC)
function _parsearFechaLocal(fechaStr) {
    if (!fechaStr) return null;
    // Si tiene formato YYYY-MM-DD, parsear como fecha local para evitar desfase UTC
    var partes = String(fechaStr).split('T')[0].split('-');
    if (partes.length === 3) {
        return new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
    }
    return new Date(fechaStr);
}

// Verificar y enviar recordatorios pendientes
// silencioso: si true, no muestra toasts cuando no hay nada que hacer (para verificación automática)
async function verificarRecordatoriosPendientes(silencioso) {
    // Verificar que EmailJS está configurado
    const serviceId = await obtenerConfig('email_service_id');
    const publicKey = await obtenerConfig('email_public_key');
    const templateId = await obtenerConfig('email_template_id');
    const emailDestino = await obtenerConfig('email_destino');

    if (!serviceId || !publicKey || !templateId || !emailDestino) {
        if (!silencioso) mostrarToast('Configura EmailJS primero para recibir recordatorios', 'warning');
        return;
    }

    const configStr = await obtenerConfig('recordatorios_config');
    if (!configStr) {
        if (!silencioso) mostrarToast('Configura los recordatorios primero', 'warning');
        return;
    }

    const config = JSON.parse(configStr);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Obtener eventos
    const eventos = await obtenerEventos();
    const recordatoriosEnviados = JSON.parse(localStorage.getItem('recordatorios_enviados') || '{}');

    let pendientes = [];
    let enviados = 0;

    for (const evento of eventos) {
        // Solo procesar eventos con alerta activada
        if (!evento.alerta) continue;

        // Parsear fecha como local para evitar desfase por zona horaria UTC
        const fechaEvento = _parsearFechaLocal(evento.fechaInicio || evento.fecha);
        if (!fechaEvento) continue;
        fechaEvento.setHours(0, 0, 0, 0);
        const diasRestantes = Math.round((fechaEvento - hoy) / (1000 * 60 * 60 * 24));

        // Solo eventos futuros o de hoy
        if (diasRestantes < 0) continue;

        // Usar umbrales en lugar de comparación exacta para no perder ventanas
        // La clave incluye el tipo de umbral (no el número exacto de días) para deduplicar
        if (config.unDia && diasRestantes <= 1 && !recordatoriosEnviados[`${evento.id}_umbral1`]) {
            pendientes.push({ evento, diasRestantes, clave: `${evento.id}_umbral1` });
        } else if (config.tresDias && diasRestantes <= 3 && !recordatoriosEnviados[`${evento.id}_umbral3`]) {
            pendientes.push({ evento, diasRestantes, clave: `${evento.id}_umbral3` });
        } else if (config.unaSemana && diasRestantes <= 7 && !recordatoriosEnviados[`${evento.id}_umbral7`]) {
            pendientes.push({ evento, diasRestantes, clave: `${evento.id}_umbral7` });
        }
    }

    // Verificar recordatorio de suscripción
    if (config.suscripcion && estadoPremium.activo && estadoPremium.expiracion) {
        const fechaExp = _parsearFechaLocal(estadoPremium.expiracion);
        if (fechaExp) {
            fechaExp.setHours(0, 0, 0, 0);
            const diasParaExpirar = Math.round((fechaExp - hoy) / (1000 * 60 * 60 * 24));
            if (diasParaExpirar <= 7 && diasParaExpirar >= 0 && !recordatoriosEnviados['suscripcion_7dias']) {
                pendientes.push({
                    tipo: 'suscripcion',
                    diasRestantes: diasParaExpirar,
                    clave: 'suscripcion_7dias'
                });
            }
        }
    }

    if (pendientes.length === 0) {
        if (!silencioso) mostrarToast('No hay recordatorios pendientes', 'info');
        return;
    }

    // Enviar recordatorios
    if (!silencioso) mostrarToast(`Enviando ${pendientes.length} recordatorio(s)...`, 'info');

    for (const item of pendientes) {
        try {
            if (item.tipo === 'suscripcion') {
                await enviarRecordatorioSuscripcion(serviceId, publicKey, templateId, emailDestino);
            } else {
                await enviarRecordatorioEvento(item.evento, item.diasRestantes, serviceId, publicKey, templateId, emailDestino);
            }

            recordatoriosEnviados[item.clave] = Date.now();
            enviados++;
        } catch (error) {
            Logger.error('Error enviando recordatorio:', error);
            if (!silencioso) mostrarToast(`Error al enviar recordatorio: ${error.text || error.message || ''}`, 'error');
        }
    }

    localStorage.setItem('recordatorios_enviados', JSON.stringify(recordatoriosEnviados));
    if (enviados > 0) mostrarToast(`✅ ${enviados} recordatorio(s) enviado(s)`, 'success');
}

// Enviar recordatorio de evento por email
async function enviarRecordatorioEvento(evento, diasRestantes, serviceId, publicKey, templateId, emailDestino) {
    if (typeof emailjs === 'undefined') {
        await cargarEmailJS();
    }

    emailjs.init(publicKey);

    const diasTexto = diasRestantes === 1 ? '1 día' : `${diasRestantes} días`;
    const fechaObj = new Date(evento.fechaInicio || evento.fecha);
    const fechaEvento = fechaObj.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Hora solo si el evento NO es de todo el día. La hora viene en fechaInicio,
    // que es un ISO con tz local. Para IA-generated, parsearHoraIA ya validó.
    let horaTexto = '';
    if (!evento.todoElDia && !isNaN(fechaObj.getTime())) {
        const horas = String(fechaObj.getHours()).padStart(2, '0');
        const minutos = String(fechaObj.getMinutes()).padStart(2, '0');
        horaTexto = `${horas}:${minutos}`;
    }

    const lineasMensaje = [
        'RECORDATORIO DE EVENTO',
        '',
        `Evento: ${evento.titulo}`,
        `Fecha: ${fechaEvento}`
    ];
    if (horaTexto) lineasMensaje.push(`Hora: ${horaTexto}`);
    lineasMensaje.push(`Faltan: ${diasTexto}`);
    lineasMensaje.push('');
    if (evento.descripcion) lineasMensaje.push(evento.descripcion);
    lineasMensaje.push('');
    lineasMensaje.push('---');
    lineasMensaje.push('TSJ Filing Online');

    const asuntoHora = horaTexto ? ` ${horaTexto}` : '';
    const templateParams = {
        to_email: emailDestino,
        subject: `📅 Recordatorio: ${evento.titulo}${asuntoHora} en ${diasTexto}`,
        message: lineasMensaje.join('\n').trim(),
        from_name: 'TSJ Filing Online'
    };

    await emailjs.send(serviceId, templateId, templateParams);
}

// Enviar recordatorio de suscripción
async function enviarRecordatorioSuscripcion(serviceId, publicKey, templateId, emailDestino) {
    if (typeof emailjs === 'undefined') {
        await cargarEmailJS();
    }

    emailjs.init(publicKey);

    const fechaExp = new Date(estadoPremium.expiracion).toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const templateParams = {
        to_email: emailDestino,
        subject: '⚠️ Tu suscripción Premium vence pronto',
        message: `
RECORDATORIO DE SUSCRIPCIÓN

Tu suscripción Premium de TSJ Filing Online vence el ${fechaExp}.

Renueva antes de esa fecha para no perder acceso a:
- Expedientes ilimitados
- Búsquedas ilimitadas
- Sin anuncios
- Soporte prioritario

Contacta para renovar tu suscripción.

---
TSJ Filing Online
        `.trim(),
        from_name: 'TSJ Filing Online'
    };

    await emailjs.send(serviceId, templateId, templateParams);
}

// Verificar recordatorios automáticamente al cargar
async function verificarRecordatoriosAutomatico() {
    const ultimaVerificacion = localStorage.getItem('ultima_verificacion_recordatorios');
    const hoy = new Date().toDateString();

    // Solo verificar una vez al día
    if (ultimaVerificacion === hoy) return;

    // Verificar que EmailJS está configurado
    const serviceId = await obtenerConfig('email_service_id');
    if (!serviceId) return;

    const configStr = await obtenerConfig('recordatorios_config');
    if (!configStr) return;

    // Verificar en segundo plano (silencioso: sin toasts innecesarios)
    setTimeout(async () => {
        await verificarRecordatoriosPendientes(true);
        localStorage.setItem('ultima_verificacion_recordatorios', hoy);
    }, 5000);
}

async function exportarDatos() {
    try {
        const datos = await exportarTodosDatos();
        const json = JSON.stringify(datos, null, 2);
        descargarArchivo(
            `tsj_backup_${new Date().toISOString().split('T')[0]}.json`,
            json, 'application/json');
        mostrarToast('Datos exportados correctamente', 'success');
    } catch (error) {
        mostrarToast('Error al exportar: ' + error.message, 'error');
    }
}

async function importarDatos(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const texto = await file.text();
        const datos = JSON.parse(texto);

        if (!datos.expedientes) {
            throw new Error('Archivo inválido');
        }

        const totalExpedientes = datos.expedientes?.length || 0;
        const totalNotas = datos.notas?.length || 0;
        const totalEventos = datos.eventos?.length || 0;

        // Verificar si es usuario Premium
        const esPremium = estadoPremium && estadoPremium.activo;
        let expedientesAImportar = datos.expedientes;
        let advertenciaPremium = '';

        // Si NO es premium y hay más de 10 expedientes, limitar
        if (!esPremium && totalExpedientes > PREMIUM_CONFIG.limiteExpedientes) {
            // Ordenar por fecha de modificación (más recientes primero) y tomar los últimos 10
            expedientesAImportar = [...datos.expedientes]
                .sort((a, b) => new Date(b.fechaModificacion || b.fechaCreacion || 0) - new Date(a.fechaModificacion || a.fechaCreacion || 0))
                .slice(0, PREMIUM_CONFIG.limiteExpedientes);

            advertenciaPremium = `\n\n⚠️ CUENTA GRATUITA: Solo se importarán los ${PREMIUM_CONFIG.limiteExpedientes} expedientes más recientes de ${totalExpedientes} totales.\n\nActiva Premium ($${PREMIUM_CONFIG.precioMensual} MXN/mes) para importar todos tus expedientes.`;
        }

        const mensajeConfirm = esPremium
            ? `¿Importar ${totalExpedientes} expedientes, ${totalNotas} notas y ${totalEventos} eventos?`
            : `¿Importar ${expedientesAImportar.length} expedientes, ${totalNotas} notas y ${totalEventos} eventos?${advertenciaPremium}`;

        if (confirm(mensajeConfirm)) {
            // Crear copia de datos con expedientes limitados si no es premium
            const datosAImportar = {
                ...datos,
                expedientes: expedientesAImportar
            };

            await importarTodosDatos(datosAImportar, true);
            await cargarExpedientes();
            await cargarNotas();
            await cargarEventos();
            await cargarEstadisticas();
            renderizarCalendario();

            if (!esPremium && totalExpedientes > PREMIUM_CONFIG.limiteExpedientes) {
                mostrarModalAdvertenciaPremium(totalExpedientes, expedientesAImportar.length);
            } else {
                mostrarToast('Datos importados correctamente', 'success');
            }
        }
    } catch (error) {
        mostrarToast('Error al importar: ' + error.message, 'error');
    }

    event.target.value = '';
}

// Modal de advertencia para importación limitada
function mostrarModalAdvertenciaPremium(totalOriginal, totalImportado) {
    document.getElementById('modal-titulo').textContent = '⚠️ Importación Limitada';
    document.getElementById('modal-body').innerHTML = `
        <div class="limit-warning">
            <div class="limit-warning-icon">📁</div>
            <h3>Datos importados parcialmente</h3>
            <p>Tu archivo contenía <strong>${totalOriginal} expedientes</strong>, pero la cuenta gratuita solo permite <strong>${totalImportado} expedientes</strong>.</p>
            <p>Se importaron los <strong>${totalImportado} expedientes más recientes</strong>.</p>
            <div class="premium-cta" style="margin-top: 15px; padding: 15px; background: linear-gradient(135deg, #ffd700, #ffaa00); border-radius: 8px;">
                <p style="margin: 0; color: #333;"><strong>¿Necesitas todos tus expedientes?</strong></p>
                <p style="margin: 5px 0 0; color: #333;">Activa Premium por solo <strong>$${PREMIUM_CONFIG.precioMensual} MXN/mes</strong></p>
            </div>
            <p style="margin-top: 15px; font-size: 12px; color: #888;">
                Cada licencia es válida para <strong>un dispositivo</strong>.<br>
                Contacto: jorge_clemente@empirica.mx
            </p>
        </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Entendido</button>
        <button class="btn btn-success" onclick="cerrarModal(); navegarA('config'); setTimeout(() => document.getElementById('premium-section')?.scrollIntoView({behavior: 'smooth'}), 300);">
            ⭐ Activar Premium
        </button>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

async function eliminarTodosDatos() {
    // Se enumera qué se va exactamente: antes decía "TODOS los datos" y en
    // realidad dejaba atrás los pendientes y las búsquedas del IMPI.
    const resumen = await _resumenDatosAEliminar();

    if (!confirm('Esto eliminará permanentemente:\n\n' + resumen +
                 '\n\nTu licencia y las preferencias de la aplicación se conservan.')) return;
    if (!confirm('¿REALMENTE seguro? No se puede deshacer desde la aplicación.')) return;

    try {
        // El respaldo en la nube va ANTES de tocar nada local: si falla, se
        // avisa y se decide, en vez de quedarse sin datos en los dos sitios.
        if (typeof respaldarYLimpiarSyncRemoto === 'function') {
            const resultado = await respaldarYLimpiarSyncRemoto();
            if (resultado && resultado.error && !confirm(
                    'No se pudo respaldar ni limpiar la copia en la nube:\n\n' + resultado.error +
                    '\n\n¿Borrar igualmente los datos de este dispositivo?')) {
                return;
            }
        }

        await eliminarTodosLosDatos();

        await Promise.all([
            cargarExpedientes(),
            typeof cargarExpedientesPJF === 'function' ? cargarExpedientesPJF() : null,
            cargarNotas(),
            cargarEventos(),
            typeof cargarPendientes === 'function' ? cargarPendientes() : null,
            typeof cargarCarpetasUI === 'function' ? cargarCarpetasUI() : null,
            cargarEstadisticas()
        ].filter(Boolean));
        renderizarCalendario();

        mostrarToast('Se eliminaron todos los datos', 'success');
    } catch (error) {
        Logger.error('Error al eliminar todos los datos:', error);
        mostrarToast('Error al eliminar: ' + error.message, 'error');
    }
}

/** Cuenta lo que hay para que el aviso diga qué se va a perder, no "todo". */
async function _resumenDatosAEliminar() {
    const contar = async (fn) => {
        if (typeof fn !== 'function') return 0;
        try { return (await fn()).length; } catch (e) { return 0; }
    };

    const [expedientes, archivados, notas, eventos, pendientes, carpetas, busquedas] = await Promise.all([
        contar(typeof obtenerExpedientes === 'function' ? obtenerExpedientes : null),
        contar(typeof obtenerExpedientesArchivados === 'function' ? obtenerExpedientesArchivados : null),
        contar(typeof obtenerNotas === 'function' ? obtenerNotas : null),
        contar(typeof obtenerEventos === 'function' ? obtenerEventos : null),
        contar(typeof obtenerPendientes === 'function' ? obtenerPendientes : null),
        contar(typeof obtenerCarpetas === 'function' ? obtenerCarpetas : null),
        contar(typeof obtenerBusquedasGuardadas === 'function' ? obtenerBusquedasGuardadas : null)
    ]);

    const lineas = [];
    const agregar = (n, singular, plural) => { if (n > 0) lineas.push(`• ${n} ${n === 1 ? singular : plural}`); };
    agregar(expedientes + archivados, 'expediente (incluido el archivo)', 'expedientes (incluido el archivo)');
    agregar(notas, 'nota', 'notas');
    agregar(eventos, 'evento del calendario', 'eventos del calendario');
    agregar(pendientes, 'pendiente', 'pendientes');
    agregar(carpetas, 'carpeta', 'carpetas');
    agregar(busquedas, 'búsqueda guardada del IMPI', 'búsquedas guardadas del IMPI');
    lineas.push('• El historial de cambios y los ajustes de la aplicación');

    return lineas.join('\n');
}

// ==================== RESPALDO AUTOMÁTICO DIARIO ====================

async function toggleAutoBackup() {
    const activado = document.getElementById('config-auto-backup').checked;
    await guardarConfig('auto_backup', activado ? 'true' : 'false');

    if (activado) {
        mostrarToast('Respaldo automático activado', 'success');
        // Verificar si debe hacer respaldo hoy
        await verificarRespaldoDiario();
    } else {
        mostrarToast('Respaldo automático desactivado', 'info');
    }

    actualizarInfoUltimoRespaldo();
}

async function verificarRespaldoDiario() {
    const ultimoRespaldo = await obtenerConfig('ultimo_respaldo_auto');
    const hoy = new Date().toISOString().split('T')[0];

    if (ultimoRespaldo !== hoy) {
        // No se ha hecho respaldo hoy, hacerlo ahora
        await realizarRespaldoAutomatico();
    }
}

async function realizarRespaldoAutomatico() {
    try {
        const datos = await exportarTodosDatos();

        // Verificar si hay datos para respaldar
        if (!datos.expedientes?.length && !datos.notas?.length && !datos.eventos?.length) {
            Logger.log('No hay datos para respaldar');
            return;
        }

        const json = JSON.stringify(datos, null, 2);
        const fechaHora = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        descargarArchivo(`tsj_auto_backup_${fechaHora}.json`, json, 'application/json');

        // Guardar fecha del último respaldo
        await guardarConfig('ultimo_respaldo_auto', new Date().toISOString().split('T')[0]);
        await guardarConfig('ultimo_respaldo_timestamp', new Date().toISOString());

        actualizarInfoUltimoRespaldo();
        mostrarToast('📦 Respaldo automático descargado', 'success');
    } catch (error) {
        Logger.error('Error en respaldo automático:', error);
    }
}

async function actualizarInfoUltimoRespaldo() {
    const infoEl = document.getElementById('ultimo-respaldo-info');
    if (!infoEl) return;

    const ultimoTimestamp = await obtenerConfig('ultimo_respaldo_timestamp');

    if (ultimoTimestamp) {
        const fecha = new Date(ultimoTimestamp);
        infoEl.textContent = `Último respaldo: ${fecha.toLocaleString('es-MX')}`;
    } else {
        infoEl.textContent = 'Nunca se ha realizado un respaldo automático';
    }
}

async function cargarConfigAutoBackup() {
    const activado = await obtenerConfig('auto_backup') === 'true';
    const checkbox = document.getElementById('config-auto-backup');

    if (checkbox) {
        checkbox.checked = activado;
    }

    actualizarInfoUltimoRespaldo();

    // Si está activado, verificar si necesita hacer respaldo
    if (activado) {
        await verificarRespaldoDiario();
    }
}

// ==================== IMPORTACIÓN CSV ====================

// ---- Template único de carga masiva (TSJ + PJF + otras autoridades) ----
//
// Un solo archivo para todo el despacho: cada fila declara dónde está radicado
// el asunto y la importación lo manda a su sección (la lista del TSJ filtra por
// institucion === 'TSJ' y la federal por 'PJF'). Además de dar de alta el
// expediente, una fila puede traer un pendiente y una audiencia, que es como
// llega realmente el trabajo: "este asunto, en este juzgado, con esta
// contestación que vence tal día y audiencia tal otro".

// Filas de ejemplo del template. Se listan aquí —y no sueltas dentro del
// generador— porque la importación las reconoce para saltárselas: si el usuario
// no las borra, no queremos darle de alta un expediente de "Juan Pérez García".
const TEMPLATE_EJEMPLOS = [
    {
        expediente: '1234/2025', tipo: 'numero', institucion: 'TSJ',
        juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
        actor: 'Comercializadora del Caribe SA de CV', demandado: 'Juan Pérez García',
        carpeta: 'Caso Caribe', comentario: 'Ejemplo: juicio estatal con pendiente y audiencia',
        pendiente: 'Contestar la demanda', pendiente_fecha: '15/03/2026', pendiente_prioridad: 'alta',
        audiencia: 'Audiencia preliminar', audiencia_fecha: '02/04/2026 09:30', audiencia_tipo: 'audiencia'
    },
    {
        expediente: 'María López Sánchez', tipo: 'nombre', institucion: 'TSJ',
        juzgado: 'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN',
        comentario: 'Ejemplo: búsqueda por nombre del actor'
    },
    {
        expediente: '5678/2024', tipo: 'numero', institucion: 'TSJ',
        juzgado: 'PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR',
        carpeta: 'Caso Caribe', comentario: 'Ejemplo: apelación del mismo caso, en Segunda Instancia'
    },
    {
        expediente: '67/2021', tipo: 'numero', institucion: 'PJF',
        juzgado: 'Juzgado Primero de Distrito en el Estado de Aguascalientes',
        organismo_id: '394', tipo_asunto_id: '1',
        comentario: 'Ejemplo: amparo indirecto federal',
        pendiente: 'Revisar acuerdo', pendiente_fecha: '20/03/2026', pendiente_prioridad: 'media'
    },
    {
        expediente: 'ABC-123/2025', tipo: 'numero', institucion: 'OTRO',
        juzgado: 'IMSS Subdelegación Cancún',
        comentario: 'Ejemplo: trámite ante otra autoridad',
        audiencia: 'Vence plazo para desahogar requerimiento',
        audiencia_fecha: '10/03/2026', audiencia_tipo: 'vencimiento'
    }
];

const TEMPLATE_COLUMNAS = [
    'expediente', 'tipo', 'institucion', 'juzgado', 'organismo_id', 'tipo_asunto_id',
    'actor', 'demandado', 'carpeta', 'comentario',
    'pendiente', 'pendiente_fecha', 'pendiente_prioridad',
    'audiencia', 'audiencia_fecha', 'audiencia_tipo'
];

// Envuelve entre comillas si el valor lleva coma, comillas o salto de línea.
function _csvCampo(valor) {
    const s = String(valor == null ? '' : valor);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Catálogo del TSJ como comentarios, agrupado por categoría. */
function _catalogoTSJParaTemplate() {
    let csv = '# ================================================================\n';
    csv += '# CATALOGO TSJ QUINTANA ROO — juzgados y salas\n';
    csv += '# Copia el nombre completo en la columna "juzgado"\n';
    csv += '# ================================================================\n';
    CATEGORIAS_JUZGADOS.forEach(cat => {
        csv += `#\n# --- ${cat.nombre} (${cat.juzgados.length}) ---\n`;
        cat.juzgados.forEach(j => { csv += `# ${j}\n`; });
    });
    return csv;
}

/** Tipos de asunto federales agrupados por tipo de órgano. */
function _catalogoTiposAsuntoParaTemplate() {
    let csv = '#\n# ================================================================\n';
    csv += '# CATALOGO PJF — tipos de asunto (columna "tipo_asunto_id")\n';
    csv += '# ================================================================\n';

    Object.keys(pjfTiposOrgano)
        .map(tid => ({ id: Number(tid), nombre: pjfTiposOrgano[tid].nombre, tipos: pjfTiposOrgano[tid].tiposAsuntoArr || [] }))
        .filter(to => to.tipos.length > 0)
        .sort((a, b) => a.id - b.id)
        .forEach(to => {
            csv += `#\n# --- ${to.nombre} ---\n`;
            to.tipos.forEach(t => { csv += `#   tipo_asunto_id=${t.id}  ->  ${t.nombre}\n`; });
        });
    return csv;
}

/** Órganos federales agrupados por circuito. */
function _catalogoOrganosPJFParaTemplate() {
    let csv = '#\n# ================================================================\n';
    csv += '# CATALOGO PJF — órganos jurisdiccionales\n';
    csv += '# Usa el nombre en "juzgado" o el ID en "organismo_id"\n';
    csv += '# Formato: # ID | Nombre | Tipo de órgano | Ciudad\n';
    csv += '# ================================================================\n';

    pjfCircuitos.forEach(c => {
        const organos = pjfOrganismos
            .filter(o => o.circuito_id === c.numero_circuito)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        if (organos.length === 0) return;
        csv += `#\n# ---- CIRCUITO ${c.numero_circuito}: ${c.nombre} (${organos.length} órganos) ----\n`;
        organos.forEach(o => {
            csv += `# ID=${o.id} | "${o.nombre}" | ${o.tipoOrganismo}${o.ciudad ? ' | ' + o.ciudad : ''}\n`;
        });
    });
    return csv;
}

/**
 * Descarga el template único. Incluye los catálogos completos del TSJ y del
 * PJF como comentarios, para que el usuario no tenga que salir del archivo a
 * buscar cómo se llama su juzgado.
 */
async function descargarTemplateExpedientes() {
    await cargarCatalogosPJF();

    const fecha = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const totalTSJ = Object.keys(JUZGADOS).length + Object.keys(SALAS_SEGUNDA_INSTANCIA).length;
    const totalPJF = pjfOrganismos.length;

    let csv = '';
    csv += '# ================================================================\n';
    csv += '# TEMPLATE DE CARGA MASIVA DE EXPEDIENTES\n';
    csv += '# TSJ Quintana Roo + Poder Judicial de la Federación + otras autoridades\n';
    csv += `# Generado: ${fecha}\n`;
    csv += `# Catálogos: ${totalTSJ} juzgados del TSJ | ${totalPJF} órganos federales\n`;
    csv += '# ================================================================\n';
    csv += '#\n';
    csv += '# Un solo archivo para todo. Cada expediente va a su sección según\n';
    csv += '# dónde esté radicado; no hace falta separar archivos por institución.\n';
    csv += '#\n';
    csv += '# ---------- EL EXPEDIENTE ----------\n';
    csv += '#   expediente     - Número (ej: 1234/2025) o nombre del actor      [OBLIGATORIO]\n';
    csv += '#   tipo           - "numero" o "nombre"          [opcional: se deduce del valor]\n';
    csv += '#   institucion    - TSJ | PJF | OTRO             [opcional: se deduce del juzgado]\n';
    csv += '#   juzgado        - Juzgado del TSJ, órgano federal o autoridad     [OBLIGATORIO]\n';
    csv += '#   organismo_id   - ID del órgano federal        [opcional, solo PJF]\n';
    csv += '#   tipo_asunto_id - ID del tipo de asunto        [opcional, solo PJF]\n';
    csv += '#   actor          - Parte actora                 [opcional]\n';
    csv += '#   demandado      - Parte demandada              [opcional]\n';
    csv += '#   carpeta        - Agrupa expedientes del mismo caso; se crea sola [opcional]\n';
    csv += '#   comentario     - Nota libre                   [opcional]\n';
    csv += '#\n';
    csv += '# ---------- PENDIENTE (tarea del expediente) ----------\n';
    csv += '#   pendiente            - Qué hay que hacer      [opcional]\n';
    csv += '#   pendiente_fecha      - Fecha límite; si la pones, aparece en el calendario\n';
    csv += '#   pendiente_prioridad  - alta | media | baja    [opcional]\n';
    csv += '#\n';
    csv += '# ---------- AUDIENCIA / FECHA DEL CALENDARIO ----------\n';
    csv += '#   audiencia       - Título de la cita           [opcional]\n';
    csv += '#   audiencia_fecha - Cuándo                      [obligatorio si pones audiencia]\n';
    csv += '#   audiencia_tipo  - audiencia | vencimiento | recordatorio | otro\n';
    csv += '#\n';
    csv += '# ---------- FORMATO DE LAS FECHAS ----------\n';
    csv += '#   El DÍA VA PRIMERO: 15/03/2026 es el 15 de marzo, no el 3 de mayo.\n';
    csv += '#   Se aceptan: 15/03/2026 | 15-03-2026 | 2026-03-15 | 15 de marzo de 2026\n';
    csv += '#   Con hora:   15/03/2026 09:30 | 15/03/2026 2:00 pm\n';
    csv += '#   Sin hora se guarda como evento de todo el día.\n';
    csv += '#\n';
    csv += '# ---------- NOTAS ----------\n';
    csv += '#   - Las filas que empiezan con # son comentarios y se ignoran al importar\n';
    csv += '#   - Las filas de ejemplo se detectan y se omiten, pero puedes borrarlas\n';
    csv += '#   - Los nombres de juzgado no distinguen mayúsculas ni acentos\n';
    csv += '#   - Si un juzgado no está en los catálogos se registra como "Otros/Varios";\n';
    csv += '#     si se parece a uno conocido, la importación te avisa por si es un dedazo\n';
    csv += '#   - Los expedientes que ya tengas registrados se omiten, no se duplican\n';
    csv += '#   - Para varios pendientes de un mismo expediente, repite la fila del\n';
    csv += '#     expediente cambiando solo las columnas de pendiente/audiencia\n';
    csv += '#   - Guarda desde Excel como "CSV UTF-8 (delimitado por comas)"\n';
    csv += '#\n';

    csv += TEMPLATE_COLUMNAS.join(',') + '\n';
    TEMPLATE_EJEMPLOS.forEach(ej => {
        csv += TEMPLATE_COLUMNAS.map(col => _csvCampo(ej[col])).join(',') + '\n';
    });

    csv += '\n' + _catalogoTSJParaTemplate();
    csv += _catalogoTiposAsuntoParaTemplate();
    csv += _catalogoOrganosPJFParaTemplate();
    csv += '#\n# ================================================================\n';
    csv += '# FIN DE LOS CATALOGOS\n';
    csv += '# ================================================================\n';

    // El BOM es lo que hace que Excel lea el archivo como UTF-8; sin él las
    // tildes de los catálogos y los comentarios salen como "PÃ©rez".
    descargarArchivo('template_expedientes.csv', '﻿' + csv, 'text/csv;charset=utf-8;');

    mostrarToast(`Template descargado: ${totalTSJ} juzgados del TSJ y ${totalPJF} órganos federales`, 'success');
}

// Nombres anteriores del generador y del importador. Se conservan porque la
// página y el JavaScript se cachean por separado: con un index.html viejo en
// caché y este archivo ya nuevo, los botones llamarían a funciones que ya no
// existen y no harían absolutamente nada, sin más pista que un error en
// consola que el usuario no ve.
const descargarTemplateCSV = descargarTemplateExpedientes;
const descargarTemplatePJF = descargarTemplateExpedientes;

// Normaliza para comparar valores del CSV: sin tildes, minúsculas, sin espacios
// de sobra. "NÚMERO", "Numero" y "numero" son lo mismo para quien llena el CSV.
function _normalizarValorCSV(valor) {
    return String(valor || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

// ==================== FECHAS DEL CSV ====================
// El día va primero (15/03/2026 = 15 de marzo), que es como se escribe una
// fecha en México y como la exporta Excel en español. Se admite también el
// formato ISO (2026-03-15) porque es lo que sale de Google Sheets.

const _MESES_CSV = {
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
    jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12
};

function _mesDesdeTexto(txt) {
    const clave = _normalizarValorCSV(txt).slice(0, 3);
    return _MESES_CSV[clave] || null;
}

/**
 * Convierte lo que se escribió en una celda de fecha a ISO.
 * Acepta "15/03/2026", "15-03-2026", "2026-03-15", "15 mar 2026" y cualquiera
 * de ellas con hora ("15/03/2026 09:30", "… 9:30 am").
 *
 * @returns {{iso: string, todoElDia: boolean}|{error: string}|null} null si la
 *          celda venía vacía (una fecha ausente no es un error).
 */
// Cuando una celda tiene formato de fecha, Excel no exporta texto sino el
// número de días transcurridos desde el 1/1/1900. Un "46096" en la columna de
// fechas no es un error de quien llenó el archivo: es Excel haciendo su
// trabajo, y hay que entenderlo.
//
// El desfase de dos días sale de dos cosas que se compensan a medias: Excel
// cuenta el 1/1/1900 como día 1 (no como 0) y además cree que 1900 fue
// bisiesto, un error que arrastra desde Lotus 1-2-3 y que nunca corrigió.
function _fechaDesdeSerieExcel(numero) {
    if (!isFinite(numero) || numero < 1 || numero > 2958465) return null;   // hasta el año 9999
    const dias = Math.floor(numero);
    const fraccion = numero - dias;

    const base = new Date(1899, 11, 30);
    base.setDate(base.getDate() + dias);

    const segundosDelDia = Math.round(fraccion * 86400);
    base.setHours(Math.floor(segundosDelDia / 3600),
                  Math.floor((segundosDelDia % 3600) / 60),
                  segundosDelDia % 60, 0);

    return { fecha: base, tieneHora: fraccion > 0 };
}

function _fechaDesdeCSV(valor) {
    let txt = String(valor || '').trim();
    if (!txt) return null;

    // Formato largo: "domingo, 15 de marzo de 2026". El día de la semana no
    // aporta nada y estorba a todo lo demás, así que se quita de entrada.
    txt = txt.replace(/^(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)\s*,?\s*/i, '');

    // Número suelto: Excel exportando una celda con formato de fecha.
    if (/^\d+([.,]\d+)?$/.test(txt)) {
        const serie = _fechaDesdeSerieExcel(parseFloat(txt.replace(',', '.')));
        if (!serie) return { error: `no entiendo la fecha "${txt}"` };
        return { iso: serie.fecha.toISOString(), todoElDia: !serie.tieneHora };
    }

    // Separar la parte de hora. El "a. m." de es-MX lleva espacios y puntos.
    const conHora = txt.match(
        /^(.*?)[\s,]+(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm|hrs?\.?|horas)?$/i);
    const parteFecha = (conHora ? conHora[1] : txt).trim();

    let hora = 0, minuto = 0, tieneHora = false;
    if (conHora) {
        hora = parseInt(conHora[2], 10);
        minuto = parseInt(conHora[3] || '0', 10);
        const sufijo = _normalizarValorCSV(conHora[4] || '').replace(/[.\s]/g, '');
        if (sufijo === 'pm' && hora < 12) hora += 12;
        if (sufijo === 'am' && hora === 12) hora = 0;
        if (hora > 23 || minuto > 59) return { error: `hora inválida en "${txt}"` };
        // "15/03/2026 0:00" es lo que escribe Excel para una fecha sin hora:
        // tratarla como cita a medianoche sería inventarse un dato.
        tieneHora = !(hora === 0 && minuto === 0);
    }

    let anio, mes, dia;

    const iso = parteFecha.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    const latino = parteFecha.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    // El mes en letra, con año de dos o cuatro cifras y el punto que Excel
    // pone en las abreviaturas en español ("15-mar.-26").
    const conMes = parteFecha.match(/^(\d{1,2})[\s.\-]+(?:de[\s.\-]+)?([a-záéíóúñ]+)\.?[\s.\-]+(?:de[\s.\-]+)?(\d{2,4})$/i);
    // Estilo inglés: "mar 15, 2026".
    const mesPrimero = parteFecha.match(/^([a-záéíóúñ]+)\.?[\s.\-]+(\d{1,2})\s*,?\s*(\d{2,4})$/i);

    if (iso) {
        anio = +iso[1]; mes = +iso[2]; dia = +iso[3];
    } else if (latino) {
        dia = +latino[1]; mes = +latino[2]; anio = +latino[3];
        // Un mes mayor que 12 solo puede ser un día: la fecha viene en formato
        // de EE. UU. (mm/dd). Se acepta únicamente cuando leerla como dd/mm es
        // imposible; en cuanto ambos números caben como mes, manda el día
        // primero, que es como se escribe aquí.
        if (mes > 12 && dia <= 12) { const t = dia; dia = mes; mes = t; }
        if (anio < 100) anio += 2000;   // "26" → 2026
    } else if (conMes) {
        dia = +conMes[1]; mes = _mesDesdeTexto(conMes[2]); anio = +conMes[3];
        if (!mes) return { error: `no entiendo el mes de "${txt}"` };
        if (anio < 100) anio += 2000;
    } else if (mesPrimero) {
        mes = _mesDesdeTexto(mesPrimero[1]); dia = +mesPrimero[2]; anio = +mesPrimero[3];
        if (!mes) return { error: `no entiendo el mes de "${txt}"` };
        if (anio < 100) anio += 2000;
    } else {
        return { error: `fecha no reconocida: "${txt}" (usa dd/mm/aaaa)` };
    }

    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
        return { error: `fecha fuera de rango: "${txt}" (el día va primero: dd/mm/aaaa)` };
    }

    const fecha = new Date(anio, mes - 1, dia, hora, minuto, 0, 0);
    // Rechaza el 31 de febrero y demás fechas que el constructor "arregla" solo.
    if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
        return { error: `esa fecha no existe: "${txt}"` };
    }

    return { iso: fecha.toISOString(), todoElDia: !tieneHora };
}

// ==================== DETECCIÓN DE INSTITUCIÓN ====================
// La sección en la que acaba un expediente la decide su campo "institucion"
// (la lista del TSJ filtra por 'TSJ' y la federal por 'PJF'). Por eso el
// template no obliga a declararla: se deduce de dónde esté radicado el asunto,
// que es el dato que el abogado sí tiene a la mano.

const _INSTITUCIONES_CSV = {
    tsj: 'TSJ', tsjqroo: 'TSJ', 'tsj qroo': 'TSJ', estatal: 'TSJ', local: 'TSJ',
    'tsj quintana roo': 'TSJ', 'poder judicial del estado': 'TSJ',
    pjf: 'PJF', federal: 'PJF', cjf: 'PJF', 'poder judicial de la federacion': 'PJF',
    otro: 'OTRO', otros: 'OTRO', varios: 'OTRO', 'otros/varios': 'OTRO',
    autoridad: 'OTRO', dependencia: 'OTRO', administrativo: 'OTRO'
};

// Palabras que no distinguen a un juzgado de otro y solo ensucian el parecido.
const _PALABRAS_VACIAS_JUZGADO = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'y', 'lo']);

function _tokensJuzgado(texto) {
    return _normalizarValorCSV(texto).split(/[^a-z0-9]+/)
        .filter(t => t && !_PALABRAS_VACIAS_JUZGADO.has(t));
}

/**
 * Juzgado del TSJ más parecido a lo escrito, con su grado de parecido (0-1)
 * medido como proporción de palabras compartidas. Sirve para dos cosas:
 * proponer "¿quisiste decir…?" y distinguir un juzgado mal escrito de una
 * autoridad legítima que simplemente no está en ningún catálogo.
 */
function _sugerirJuzgadoTSJ(texto) {
    const tokens = _tokensJuzgado(texto);
    if (tokens.length === 0) return null;

    let mejor = null;
    for (const candidato of Object.keys(JUZGADOS).concat(Object.keys(SALAS_SEGUNDA_INSTANCIA))) {
        const suyos = new Set(_tokensJuzgado(candidato));
        if (suyos.size === 0) continue;
        const comunes = tokens.filter(t => suyos.has(t)).length;
        // Se divide entre el mayor de los dos para que un texto corto no
        // "acierte" por accidente con un nombre largo.
        const parecido = comunes / Math.max(tokens.length, suyos.size);
        if (!mejor || parecido > mejor.parecido) mejor = { nombre: candidato, parecido };
    }
    return mejor;
}

// Por encima de esto, un nombre que no está en el catálogo se trata como un
// juzgado mal escrito (se avisa) y no como una autoridad distinta.
const _PARECIDO_MINIMO_SUGERENCIA = 0.55;

/** Busca un órgano del PJF por nombre exacto (sin tildes) y si no, aproximado. */
function _buscarOrganoPJFPorNombre(nombre) {
    if (!nombre || typeof pjfOrganismos === 'undefined' || !pjfOrganismos.length) return null;
    const objetivo = _normalizarValorCSV(nombre);
    const exacto = pjfOrganismos.find(o => _normalizarValorCSV(o.nombre) === objetivo);
    if (exacto) return exacto;
    return typeof buscarOrganismoPJF === 'function' ? buscarOrganismoPJF(nombre) : null;
}

/**
 * Decide a qué institución pertenece una fila y deja el juzgado con el nombre
 * canónico que esa institución usa. Devuelve
 * { institucion, juzgado, pjfOrgId?, pjfTipoAsunto? } o { error }.
 *
 * Sin columna "institucion" se deduce así: primero el catálogo del TSJ,
 * después el federal, y lo que no esté en ninguno se toma por una autoridad
 * distinta (IMSS, SAT, una notaría…) — salvo que se parezca demasiado a un
 * juzgado conocido, en cuyo caso es casi seguro un dedazo y se avisa en vez de
 * archivarlo callando en "Otros/Varios".
 */
function _resolverDestinoFila(fila) {
    const declarada = _INSTITUCIONES_CSV[_normalizarValorCSV(fila.institucion)];
    const texto = (fila.juzgado || fila.organo || fila.autoridad || '').trim();
    const organismoId = (fila.organismo_id || '').trim();
    const tipoAsunto = (fila.tipo_asunto_id || '').trim();

    // Un id de órgano o de tipo de asunto solo existe en el portal federal.
    const pareceFederal = declarada === 'PJF' || (!declarada && (organismoId || tipoAsunto));

    // ---- Federal ----
    if (pareceFederal) {
        const porId = organismoId && typeof pjfOrganismos !== 'undefined'
            ? pjfOrganismos.find(o => String(o.id) === organismoId) : null;
        const organo = porId || _buscarOrganoPJFPorNombre(texto);

        if (!organo && !organismoId && !texto) {
            return { error: 'falta el órgano federal (columna "juzgado" u "organismo_id")' };
        }

        const destino = {
            institucion: 'PJF',
            juzgado: organo ? organo.nombre : (texto || `Organismo ID: ${organismoId}`)
        };
        if (organo) destino.pjfOrgId = String(organo.id);
        else if (organismoId) destino.pjfOrgId = organismoId;
        if (tipoAsunto) destino.pjfTipoAsunto = tipoAsunto;
        return destino;
    }

    // ---- Estatal ----
    const juzgadoTSJ = resolverJuzgadoTSJ(texto);
    if (juzgadoTSJ && declarada !== 'OTRO') {
        return { institucion: 'TSJ', juzgado: juzgadoTSJ };
    }

    if (declarada === 'TSJ') {
        const sug = _sugerirJuzgadoTSJ(texto);
        return {
            error: texto
                ? `juzgado del TSJ no reconocido: "${texto}"` +
                  (sug && sug.parecido >= _PARECIDO_MINIMO_SUGERENCIA ? ` — ¿quisiste decir "${sug.nombre}"?` : '')
                : 'falta el juzgado'
        };
    }

    // ---- Otras autoridades ----
    if (declarada === 'OTRO') {
        return { institucion: 'OTRO', juzgado: texto || 'Autoridad no especificada' };
    }

    if (!texto) return { error: 'falta el juzgado o autoridad' };

    // Sin institución declarada: quizá sea un órgano federal escrito a mano.
    const organoPJF = _buscarOrganoPJFPorNombre(texto);
    if (organoPJF) {
        return { institucion: 'PJF', juzgado: organoPJF.nombre, pjfOrgId: String(organoPJF.id) };
    }

    const sugerencia = _sugerirJuzgadoTSJ(texto);
    if (sugerencia && sugerencia.parecido >= _PARECIDO_MINIMO_SUGERENCIA) {
        return { error: `juzgado no reconocido: "${texto}" — ¿quisiste decir "${sugerencia.nombre}"?` };
    }

    return { institucion: 'OTRO', juzgado: texto };
}

// Sinónimos de la columna "tipo". Un abogado escribe "actor" o "demandado"
// cuando busca por nombre, no la palabra "nombre".
const _TIPOS_CSV_NUMERO = ['numero', 'num', 'no', 'expediente', 'exp', 'numero de expediente'];
const _TIPOS_CSV_NOMBRE = ['nombre', 'actor', 'demandado', 'parte', 'persona', 'nombre del actor'];

/**
 * Interpreta la columna "tipo". Si viene vacía la deduce del valor: algo como
 * "1234/2025" es un número de expediente y "Juan Pérez" no lo es. Devuelve
 * 'numero', 'nombre' o null si se escribió algo que no se entiende.
 */
function _tipoBusquedaDesdeCSV(tipoCrudo, valor) {
    const tipo = _normalizarValorCSV(tipoCrudo);
    if (!tipo) return /^\d[\d\s./-]*$/.test(String(valor || '').trim()) ? 'numero' : 'nombre';
    if (_TIPOS_CSV_NUMERO.includes(tipo)) return 'numero';
    if (_TIPOS_CSV_NOMBRE.includes(tipo)) return 'nombre';
    return null;
}

/**
 * ¿Es una fila de ejemplo del template que el usuario no borró?
 *
 * Se exige que coincidan expediente, juzgado Y comentario, los tres tal como
 * salieron del template. Con menos que eso acabaríamos descartando el
 * expediente de alguien: "67/2021" en un Juzgado de Distrito es un número
 * perfectamente real. En cuanto se toca cualquiera de los tres campos —que es
 * lo que hace quien aprovecha la fila de ejemplo para escribir la suya— deja
 * de considerarse ejemplo y se importa.
 */
function _esFilaEjemploTemplate(expediente, juzgadoCanonico, comentario) {
    return TEMPLATE_EJEMPLOS.some(ej =>
        _normalizarValorCSV(ej.expediente) === _normalizarValorCSV(expediente) &&
        _normalizarValorCSV(ej.juzgado) === _normalizarValorCSV(juzgadoCanonico) &&
        _normalizarValorCSV(ej.comentario) === _normalizarValorCSV(comentario)
    );
}

// Clave de identidad de un expediente, para no volver a dar de alta lo que ya
// está registrado. Es más estricta que la de eliminarExpedientesDuplicados()
// —ignora la categoría— porque aquí conviene omitir de más antes que crear un
// duplicado que un barrido posterior borre en silencio.
function _claveExpediente(exp) {
    const identificador = _normalizarValorCSV(exp.numero || exp.nombre || '');
    const juzgado = _normalizarValorCSV(exp.juzgado || '');
    return `${identificador}|${juzgado}`;
}

/**
 * Resuelve los nombres de carpeta del CSV a carpetaId, creando las que no
 * existan. Devuelve { mapa: Map(claveNormalizada -> id), creadas: n }.
 */
async function _resolverCarpetasDeImportacion(nombres) {
    const mapa = new Map();
    let creadas = 0;
    if (nombres.length === 0) return { mapa, creadas };

    const existentes = await obtenerCarpetas();
    existentes.forEach(c => mapa.set(_claveNombreCarpetaLocal(c.nombre), c.id));

    for (const nombre of nombres) {
        const clave = _claveNombreCarpetaLocal(nombre);
        if (mapa.has(clave)) continue;
        try {
            const id = await agregarCarpeta({ nombre, color: '#3b82f6', comentario: '' });
            mapa.set(clave, id);
            creadas++;
        } catch (e) {
            Logger.error('Error al crear carpeta durante la importación:', e);
        }
    }

    if (creadas > 0 && typeof cargarCarpetasUI === 'function') await cargarCarpetasUI();
    return { mapa, creadas };
}

// Informe visible de las filas que no se pudieron importar. Antes solo iban a
// la consola: el usuario veía "3 filas con errores" sin saber cuáles ni por qué.
function mostrarInformeImportacion(titulo, resumen, errores) {
    const listaHTML = errores.length === 0 ? '' : `
        <p style="margin:0.75rem 0 0.35rem; font-weight:600;">Filas no importadas (${errores.length}):</p>
        <div style="max-height:260px; overflow:auto; border:1px solid var(--border-color, #dee2e6); border-radius:6px; padding:0.5rem;">
            ${errores.map(e => `<div style="font-size:0.85rem; padding:0.15rem 0;">• ${escapeText(e)}</div>`).join('')}
        </div>`;

    document.getElementById('modal-titulo').textContent = titulo;
    document.getElementById('modal-body').innerHTML = `
        <div style="padding:10px 0;">
            ${resumen.map(r => `<p style="margin:0.2rem 0;">${escapeText(r)}</p>`).join('')}
            ${listaHTML}
        </div>`;
    document.getElementById('modal-footer').innerHTML =
        '<button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>';
    abrirModal();
}

/**
 * Recorta la lista al límite del plan gratuito. Devuelve { lista, aviso }.
 * Sin esto, la importación era la puerta trasera del límite: se guardaban
 * todos y luego la pantalla solo mostraba los primeros 10, dejando el resto
 * invisible pero ocupando espacio.
 */
async function _aplicarLimitePlanAImportacion(lista) {
    if (estadoPremium && estadoPremium.activo) return { lista, aviso: '' };

    const yaRegistrados = (await obtenerExpedientes()).length;
    const cupo = Math.max(0, PREMIUM_CONFIG.limiteExpedientes - yaRegistrados);

    if (lista.length <= cupo) return { lista, aviso: '' };

    // Quién avisa del límite lo decide el llamador: si el archivo además trae
    // pendientes para expedientes ya registrados, la importación sigue adelante
    // y sacar aquí el modal dejaría dos diálogos encima del otro.
    if (cupo === 0) return { lista: [], aviso: '', sinCupo: true };

    return {
        lista: lista.slice(0, cupo),
        aviso: `\n\n⚠️ CUENTA GRATUITA: solo se importarán ${cupo} de ${lista.length} expedientes ` +
               `(límite de ${PREMIUM_CONFIG.limiteExpedientes} y ya tienes ${yaRegistrados}).\n\n` +
               `Activa Premium ($${PREMIUM_CONFIG.precioMensual} MXN/mes) para importar todos.`
    };
}

// Prioridades que se aceptan en la columna pendiente_prioridad.
const _PRIORIDADES_CSV = { alta: 'alta', urgente: 'alta', media: 'media', normal: 'media', baja: 'baja', low: 'baja' };

// Tipos de evento del calendario y sus sinónimos.
const _TIPOS_EVENTO_CSV = {
    audiencia: 'audiencia', vista: 'audiencia', comparecencia: 'audiencia', diligencia: 'audiencia',
    vencimiento: 'vencimiento', plazo: 'vencimiento', termino: 'vencimiento',
    recordatorio: 'recordatorio', aviso: 'recordatorio',
    otro: 'otro'
};

/**
 * Lee de una fila el pendiente y la audiencia, si los trae. Devuelve
 * { pendiente?, evento?, errores[] }. Una fecha mal escrita se reporta pero no
 * tumba el expediente: es preferible dar de alta el asunto y avisar de la
 * fecha, que perder ambos.
 */
function _extrasDeFila(fila, numeroFila) {
    const errores = [];
    const extras = {};
    // Se cuentan aparte: un pendiente que entra sin su fecha no llega al
    // calendario, y perdido entre los demás avisos no se ve. Es justo lo que
    // pasó con las fechas que Excel exporta en formatos que no se aceptaban.
    let fechasDescartadas = 0;

    // ---- Pendiente ----
    const tituloPendiente = (fila.pendiente || '').trim();
    if (tituloPendiente) {
        const pendiente = {
            titulo: tituloPendiente,
            prioridad: _PRIORIDADES_CSV[_normalizarValorCSV(fila.pendiente_prioridad)] || ''
        };
        const fecha = _fechaDesdeCSV(fila.pendiente_fecha);
        if (fecha && fecha.error) {
            fechasDescartadas++;
            errores.push(`Fila ${numeroFila}: el pendiente "${tituloPendiente}" se creará SIN FECHA ` +
                         `y no aparecerá en el calendario — ${fecha.error}`);
        } else if (fecha) {
            pendiente.fechaLimite = fecha.iso;
            pendiente.todoElDia = fecha.todoElDia;
        }
        extras.pendiente = pendiente;
    } else if ((fila.pendiente_fecha || '').trim()) {
        errores.push(`Fila ${numeroFila}: hay fecha de pendiente pero falta la columna "pendiente" con lo que hay que hacer`);
    }

    // ---- Audiencia / fecha del calendario ----
    const tituloEvento = (fila.audiencia || '').trim();
    const fechaEventoCruda = (fila.audiencia_fecha || '').trim();
    if (tituloEvento || fechaEventoCruda) {
        const fecha = _fechaDesdeCSV(fechaEventoCruda);
        if (!tituloEvento) {
            errores.push(`Fila ${numeroFila}: hay fecha de audiencia pero falta la columna "audiencia" con el título`);
        } else if (!fecha) {
            errores.push(`Fila ${numeroFila}: la audiencia "${tituloEvento}" necesita fecha en "audiencia_fecha"`);
        } else if (fecha.error) {
            fechasDescartadas++;
            errores.push(`Fila ${numeroFila}: la audiencia "${tituloEvento}" NO se agendó — ${fecha.error}`);
        } else {
            extras.evento = {
                titulo: tituloEvento,
                tipo: _TIPOS_EVENTO_CSV[_normalizarValorCSV(fila.audiencia_tipo)] || 'audiencia',
                fechaInicio: fecha.iso,
                todoElDia: fecha.todoElDia
            };
        }
    }

    return { ...extras, errores, fechasDescartadas };
}

/**
 * Importa expedientes, pendientes y fechas de calendario desde un solo CSV.
 *
 * Cada fila se enruta sola: el expediente acaba en la sección del TSJ, en la
 * federal o en "Otros/Varios" según dónde esté radicado, sin que haya que
 * separar archivos por institución.
 *
 * Repetir el mismo expediente en varias filas no lo duplica: las filas
 * siguientes solo aportan sus pendientes y audiencias. Eso permite cargar
 * varias tareas de un mismo asunto, y también añadir pendientes a expedientes
 * que ya estaban dados de alta.
 */
async function importarExpedientes(event) {
    const file = event.target.files[0];
    if (!file) return;

    const extension = file.name.split('.').pop().toLowerCase();

    try {
        if (extension === 'xlsx' || extension === 'xls') {
            mostrarToast('Excel no se lee directamente: en Excel usa "Guardar como" → ' +
                         '"CSV UTF-8 (delimitado por comas)" y vuelve a importar', 'warning');
            event.target.value = '';
            return;
        }

        const texto = await file.text();
        const datos = parseCSV(texto);

        if (!datos || datos.length === 0) {
            mostrarToast('No se encontraron datos válidos', 'error');
            event.target.value = '';
            return;
        }

        // El catálogo federal hace falta para reconocer los órganos del PJF.
        await cargarCatalogosPJF().catch(() => {});

        // ── Un "asunto" por expediente distinto, con sus extras acumulados ──
        const asuntos = new Map();
        const errores = [];
        let ejemplosOmitidos = 0;
        let filasFusionadas = 0;
        let fechasDescartadas = 0;

        // Los archivados cuentan como ya registrados. obtenerExpedientes() los
        // deja fuera, así que mirando solo ahí un expediente archivado se
        // volvía a dar de alta como nuevo: el usuario acababa con el mismo
        // asunto dos veces, uno en el archivo y otro en la lista.
        const activos = await obtenerExpedientes();
        const archivados = typeof obtenerExpedientesArchivados === 'function'
            ? await obtenerExpedientesArchivados().catch(() => []) : [];

        const idPorClave = new Map();
        const clavesArchivadas = new Set();
        activos.forEach(e => idPorClave.set(_claveExpediente(e), e.id));
        archivados.forEach(e => {
            const clave = _claveExpediente(e);
            if (!idPorClave.has(clave)) {
                idPorClave.set(clave, e.id);
                clavesArchivadas.add(clave);
            }
        });

        datos.forEach((fila, index) => {
            const numeroFila = index + 2;
            const expediente = (fila.expediente || '').trim();

            if (!expediente) {
                // Una fila sin expediente pero con datos sueltos suele ser una
                // fila vacía que Excel dejó al final: solo molesta avisar si
                // realmente traía algo.
                if (Object.values(fila).some(v => (v || '').trim())) {
                    errores.push(`Fila ${numeroFila}: falta el expediente`);
                }
                return;
            }

            const destino = _resolverDestinoFila(fila);
            if (destino.error) {
                errores.push(`Fila ${numeroFila}: ${destino.error}`);
                return;
            }

            const tipo = _tipoBusquedaDesdeCSV(fila.tipo, expediente);
            if (!tipo) {
                errores.push(`Fila ${numeroFila}: tipo inválido "${(fila.tipo || '').trim()}" (usa "numero" o "nombre")`);
                return;
            }

            if (_esFilaEjemploTemplate(expediente, destino.juzgado, fila.comentario)) {
                ejemplosOmitidos++;
                return;
            }

            const clave = _claveExpediente({
                numero: tipo === 'numero' ? expediente : '',
                nombre: tipo === 'nombre' ? expediente : '',
                juzgado: destino.juzgado
            });

            if (!asuntos.has(clave)) {
                const nuevo = {
                    juzgado: destino.juzgado,
                    institucion: destino.institucion,
                    categoria: categoriaExpedienteCore(destino.institucion, destino.juzgado),
                    comentario: (fila.comentario || '').trim() || undefined,
                    actor: (fila.actor || '').trim() || undefined,
                    demandado: (fila.demandado || '').trim() || undefined
                };
                if (tipo === 'numero') nuevo.numero = expediente;
                else nuevo.nombre = expediente;
                if (destino.pjfOrgId) nuevo.pjfOrgId = destino.pjfOrgId;
                if (destino.pjfTipoAsunto) nuevo.pjfTipoAsunto = destino.pjfTipoAsunto;

                asuntos.set(clave, {
                    expediente: nuevo,
                    etiqueta: expediente,
                    carpetaNombre: (fila.carpeta || '').trim(),
                    idExistente: idPorClave.has(clave) ? idPorClave.get(clave) : null,
                    estaArchivado: clavesArchivadas.has(clave),
                    pendientes: [],
                    eventos: []
                });
            } else {
                // Otra fila del mismo expediente: aporta sus pendientes y sus
                // audiencias, pero no es un expediente más. Se cuenta para que
                // el informe explique por qué salen menos expedientes que filas
                // tiene el archivo.
                filasFusionadas++;
            }

            const asunto = asuntos.get(clave);
            const extras = _extrasDeFila(fila, numeroFila);
            errores.push(...extras.errores);
            fechasDescartadas += extras.fechasDescartadas;
            if (extras.pendiente) asunto.pendientes.push(extras.pendiente);
            if (extras.evento) asunto.eventos.push(extras.evento);
        });

        const todos = [...asuntos.values()];
        const nuevos = todos.filter(a => a.idExistente === null);
        const yaRegistrados = todos.filter(a => a.idExistente !== null);
        const extrasSobreExistentes = yaRegistrados.filter(a => a.pendientes.length || a.eventos.length);
        const duplicadosSinAporte = yaRegistrados.length - extrasSobreExistentes.length;
        const archivadosEnArchivo = yaRegistrados.filter(a => a.estaArchivado).length;

        if (todos.length === 0) {
            const motivo = ejemplosOmitidos > 0 && errores.length === 0
                ? 'El archivo solo contenía las filas de ejemplo del template.'
                : 'Ninguna fila del archivo se pudo importar.';
            mostrarInformeImportacion('📥 Importación sin cambios', [motivo], errores);
            event.target.value = '';
            return;
        }

        // ── Límite del plan (solo cuentan los expedientes nuevos) ──────────
        const { lista: nuevosAImportar, aviso, sinCupo } = await _aplicarLimitePlanAImportacion(nuevos);
        if (sinCupo && extrasSobreExistentes.length === 0) {
            // Nada que hacer: se explica el límite con el mismo modal que el
            // formulario, en vez de preguntar "¿importar 0 expedientes?".
            mostrarModalLimite('expedientes');
            event.target.value = '';
            return;
        }

        const aProcesar = nuevosAImportar.concat(extrasSobreExistentes);
        if (aProcesar.length === 0) {
            const sinCambios = [
                `📄 El archivo tenía ${datos.length} filas de datos.`,
                'Todos sus expedientes ya estaban registrados y no traían pendientes ni audiencias nuevas.'
            ];
            if (archivadosEnArchivo > 0) {
                // Si no se dice, el usuario ve que "no pasó nada" y no encuentra
                // los expedientes en la lista, porque están en el Archivo.
                sinCambios.push(`📦 ${archivadosEnArchivo} de ellos están archivados: por eso no aparecen en la lista de expedientes.`);
            }
            if (filasFusionadas > 0) {
                sinCambios.push(`🔁 ${filasFusionadas} filas repetían un expediente ya presente en el archivo.`);
            }
            mostrarInformeImportacion('📥 Importación sin cambios', sinCambios, errores);
            event.target.value = '';
            return;
        }

        // ── Confirmación ───────────────────────────────────────────────────
        const totalPendientes = aProcesar.reduce((n, a) => n + a.pendientes.length, 0);
        const totalEventos = aProcesar.reduce((n, a) => n + a.eventos.length, 0);
        const porInstitucion = _contarPorInstitucion(nuevosAImportar);

        const partes = [];
        if (nuevosAImportar.length > 0) partes.push(`${nuevosAImportar.length} expedientes (${porInstitucion})`);
        if (totalPendientes > 0) partes.push(`${totalPendientes} pendientes`);
        if (totalEventos > 0) partes.push(`${totalEventos} fechas de calendario`);

        // Se parte del total de filas y se desglosa todo, para que los números
        // cuadren siempre. Un "689 expedientes" a secas frente a un archivo de
        // 900 filas no dice si faltan datos o si simplemente se agruparon.
        const desglose = [`El archivo tiene ${datos.length} filas de datos.`];
        if (filasFusionadas > 0) {
            desglose.push(`${filasFusionadas} son filas repetidas del mismo expediente (aportan sus pendientes y fechas, no cuentan como expediente aparte).`);
        }
        if (duplicadosSinAporte > 0) desglose.push(`${duplicadosSinAporte} ya los tenías registrados.`);
        if (archivadosEnArchivo > 0) desglose.push(`${archivadosEnArchivo} ya existen pero están archivados.`);
        if (ejemplosOmitidos > 0) desglose.push(`${ejemplosOmitidos} son filas de ejemplo del template.`);
        if (fechasDescartadas > 0) {
            desglose.push(`⚠️ ${fechasDescartadas} fecha${fechasDescartadas !== 1 ? 's' : ''} no se entendieron y ` +
                          `${fechasDescartadas !== 1 ? 'esos pendientes entrarán' : 'ese pendiente entrará'} sin fecha.`);
        }
        if (errores.length > 0) desglose.push(`${errores.length} tienen algún problema (se detallan al terminar).`);

        const mensaje = `¿Importar ${partes.join(', ')}?\n\n` +
            desglose.join('\n') + aviso;

        if (!confirm(mensaje)) {
            event.target.value = '';
            return;
        }

        // ── Carpetas ───────────────────────────────────────────────────────
        const { mapa: carpetasPorClave, creadas: carpetasCreadas } =
            await _resolverCarpetasDeImportacion([...new Set(aProcesar.map(a => a.carpetaNombre).filter(Boolean))]);

        nuevosAImportar.forEach(a => {
            if (a.carpetaNombre) {
                const id = carpetasPorClave.get(_claveNombreCarpetaLocal(a.carpetaNombre));
                if (id != null) a.expediente.carpetaId = id;
            }
        });

        // ── Expedientes, pendientes y fechas de calendario ─────────────────
        // Todo dentro de un mismo lote: cada expediente, cada pendiente y cada
        // evento sincroniza por su cuenta al crearse, así que sin agrupar, una
        // importación de 30 asuntos con su pendiente y su audiencia lanzaba 61
        // subidas a la nube en fila.
        const { ids, fallos, pendientes, eventos } = await enLoteCore(async () => {
            const alta = await crearExpedientesEnLoteCore(nuevosAImportar.map(a => a.expediente));

            // crearExpedientesEnLoteCore devuelve los ids en orden y omite los
            // que fallaron, así que se emparejan recorriendo ambas listas a la vez.
            const fallidos = new Set(alta.fallos.map(f => f.datos));
            let cursor = 0;
            nuevosAImportar.forEach(a => {
                if (fallidos.has(a.expediente)) { a.id = null; return; }
                a.id = alta.ids[cursor++];
            });
            extrasSobreExistentes.forEach(a => { a.id = a.idExistente; });

            const extras = await _crearExtrasDeImportacion(aProcesar, errores);
            return { ...alta, ...extras };
        });

        fallos.forEach(f => errores.push(
            `${f.datos.numero || f.datos.nombre}: no se pudo guardar el expediente (${f.error})`));

        // ── Informe ────────────────────────────────────────────────────────
        // Arranca por el total de filas del archivo y da cuenta de todas, para
        // que se pueda cuadrar sin tener que adivinar dónde fue a parar cada una.
        const resumen = [`📄 El archivo tenía ${datos.length} filas de datos.`];
        resumen.push(`✅ ${ids.length} expedientes nuevos${ids.length ? ` (${porInstitucion})` : ''}.`);
        if (pendientes > 0) resumen.push(`📌 ${pendientes} pendientes creados.`);
        if (eventos > 0) resumen.push(`📅 ${eventos} fechas agendadas en el calendario.`);
        if (carpetasCreadas > 0) resumen.push(`📁 ${carpetasCreadas} carpetas creadas.`);
        if (filasFusionadas > 0) {
            resumen.push(`🔁 ${filasFusionadas} filas repetían un expediente ya presente en el archivo: aportaron sus pendientes y fechas, sin crear un expediente aparte.`);
        }
        if (extrasSobreExistentes.length > 0) {
            resumen.push(`🔗 ${extrasSobreExistentes.length} expedientes ya existían: se les añadieron sus pendientes y fechas.`);
        }
        if (duplicadosSinAporte > 0) resumen.push(`↩️ ${duplicadosSinAporte} omitidos por estar ya registrados.`);
        if (archivadosEnArchivo > 0) {
            resumen.push(`📦 ${archivadosEnArchivo} de ellos están archivados: no se volvieron a crear, míralos en el Archivo.`);
        }
        if (ejemplosOmitidos > 0) resumen.push(`ℹ️ ${ejemplosOmitidos} filas de ejemplo del template omitidas.`);
        if (fechasDescartadas > 0) {
            resumen.push(`📆 ${fechasDescartadas} fecha${fechasDescartadas !== 1 ? 's no se entendieron' : ' no se entendió'}: ` +
                `${fechasDescartadas !== 1 ? 'esos pendientes están' : 'ese pendiente está'} creado${fechasDescartadas !== 1 ? 's' : ''} ` +
                `pero sin fecha, así que no aparece${fechasDescartadas !== 1 ? 'n' : ''} en el calendario. Revisa el detalle de abajo.`);
        }
        if (errores.length > 0) resumen.push(`⚠️ ${errores.length} filas con algún problema (abajo el detalle).`);
        if (aviso) aviso.trim().split('\n').filter(Boolean).forEach(l => resumen.push(l));

        // El informe se muestra cuando hay algo que cuadrar. Si cada fila del
        // archivo se convirtió en un expediente y no se omitió nada, no hay
        // nada que explicar y basta un aviso; en cuanto los números dejan de
        // coincidir —filas fusionadas, ya registrados, errores, o expedientes
        // repartidos entre varias secciones— hace falta el desglose, porque un
        // "689 importados" que se desvanece no deja manera de reconciliar el
        // archivo con lo que acabó en la aplicación.
        const cuadraSinExplicacion =
            ids.length === datos.length &&
            filasFusionadas === 0 && duplicadosSinAporte === 0 &&
            extrasSobreExistentes.length === 0 && archivadosEnArchivo === 0 &&
            ejemplosOmitidos === 0 && errores.length === 0 && !aviso &&
            new Set(nuevosAImportar.map(a => a.expediente.institucion)).size <= 1;

        if (cuadraSinExplicacion) {
            mostrarToast(`${ids.length} expedientes importados correctamente`, 'success');
        } else {
            mostrarInformeImportacion('📥 Resultado de la importación', resumen, errores);
        }

        // Repintar la lista federal, que tiene su propio render.
        if (typeof cargarExpedientesPJF === 'function') await cargarExpedientesPJF();

    } catch (error) {
        Logger.error('Error al importar:', error);
        mostrarToast('Error al procesar el archivo: ' + error.message, 'error');
    }

    event.target.value = '';
}

/** "3 del TSJ, 2 federales" — para que el usuario vea a dónde va cada cosa. */
function _contarPorInstitucion(asuntos) {
    const cuenta = { TSJ: 0, PJF: 0, OTRO: 0 };
    asuntos.forEach(a => { cuenta[a.expediente.institucion] = (cuenta[a.expediente.institucion] || 0) + 1; });
    const partes = [];
    if (cuenta.TSJ) partes.push(`${cuenta.TSJ} del TSJ`);
    if (cuenta.PJF) partes.push(`${cuenta.PJF} federales`);
    if (cuenta.OTRO) partes.push(`${cuenta.OTRO} de otras autoridades`);
    return partes.join(', ');
}

/**
 * Da de alta los pendientes y las fechas de calendario de cada asunto, ya con
 * el id del expediente al que cuelgan. Un pendiente con fecha límite genera
 * además su evento en el calendario: de eso se encarga crearPendienteCore.
 */
async function _crearExtrasDeImportacion(asuntos, errores) {
    let pendientes = 0, eventos = 0;

    for (const asunto of asuntos) {
        if (asunto.id == null) continue;   // su expediente no se pudo guardar

        for (const p of asunto.pendientes) {
            try {
                await crearPendienteCore({ ...p, expedienteId: asunto.id, expedienteTexto: asunto.etiqueta });
                pendientes++;
            } catch (e) {
                errores.push(`${asunto.etiqueta}: no se pudo crear el pendiente "${p.titulo}" (${e.message})`);
            }
        }

        for (const ev of asunto.eventos) {
            try {
                await crearEventoCore({ ...ev, expedienteId: asunto.id, expedienteTexto: asunto.etiqueta });
                eventos++;
            } catch (e) {
                errores.push(`${asunto.etiqueta}: no se pudo agendar "${ev.titulo}" (${e.message})`);
            }
        }
    }

    return { pendientes, eventos };
}

const importarExpedientesCSV = importarExpedientes;
const importarExpedientesPJFCSV = importarExpedientes;

// Quita el BOM inicial que Excel escribe al guardar como "CSV UTF-8". Sin esto
// el primer encabezado se llama "﻿expediente" y la columna no se reconoce.
function _quitarBOM(texto) {
    return String(texto || '').replace(/^﻿/, '');
}

// Excel usa el separador de listas de la configuración regional: en varias
// (España, buena parte de Europa) guarda con punto y coma en vez de coma. Se
// elige el que produzca más columnas en el encabezado.
function _detectarSeparador(lineaEncabezado) {
    const comas = (lineaEncabezado.match(/,/g) || []).length;
    const puntoYComa = (lineaEncabezado.match(/;/g) || []).length;
    return puntoYComa > comas ? ';' : ',';
}

// Separa las líneas útiles: sin vacías y sin comentarios (#).
function _lineasUtilesCSV(texto) {
    return _quitarBOM(texto).split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
}

function parseCSV(texto) {
    const lineas = _lineasUtilesCSV(texto);

    if (lineas.length < 2) return [];

    const separador = _detectarSeparador(lineas[0]);

    // Obtener encabezados
    const encabezados = parseCSVLine(lineas[0], separador).map(h => h.trim().toLowerCase());

    // Validar encabezados requeridos. La columna del órgano admite varios
    // nombres porque los templates anteriores la llamaban "organo" (PJF) y
    // el formulario de otras autoridades, "autoridad".
    if (!encabezados.includes('expediente')) {
        throw new Error('Falta la columna requerida: expediente');
    }
    if (!['juzgado', 'organo', 'autoridad'].some(c => encabezados.includes(c))) {
        throw new Error('Falta la columna del juzgado (o "organo" / "autoridad")');
    }

    // Parsear filas
    const datos = [];
    for (let i = 1; i < lineas.length; i++) {
        const valores = parseCSVLine(lineas[i], separador);

        const fila = {};
        encabezados.forEach((encabezado, index) => {
            fila[encabezado] = valores[index] || '';
        });

        datos.push(fila);
    }

    return datos;
}

function parseCSVLine(linea, separador) {
    const sep = separador || ',';
    const valores = [];
    let valorActual = '';
    let dentroComillas = false;

    for (let i = 0; i < linea.length; i++) {
        const char = linea[i];

        if (char === '"') {
            // "" dentro de un campo entrecomillado es una comilla literal
            // (así escribe Excel un texto con comillas).
            if (dentroComillas && linea[i + 1] === '"') {
                valorActual += '"';
                i++;
            } else {
                dentroComillas = !dentroComillas;
            }
        } else if (char === sep && !dentroComillas) {
            valores.push(valorActual.trim());
            valorActual = '';
        } else {
            valorActual += char;
        }
    }

    valores.push(valorActual.trim());
    return valores;
}

// ==================== UTILIDADES ====================

/**
 * Descarga un archivo generado en el navegador.
 *
 * Dos detalles que parecen adorno y no lo son:
 *
 *  - El enlace tiene que estar EN el documento cuando se pulsa. Chrome acepta
 *    un <a> suelto, pero Safari y Firefox ignoran el click y no descarga nada,
 *    sin ningún error en consola.
 *  - Revocar la URL del blob en el mismo turno corta la descarga antes de que
 *    el navegador llegue a leerla. Se revoca después, ya con el archivo tomado.
 *
 * @param {string} nombreArchivo  Nombre con el que se guarda.
 * @param {string|Blob} contenido Texto o un Blob ya construido.
 * @param {string} [tipoMime]     Tipo MIME cuando el contenido es texto.
 */
function descargarArchivo(nombreArchivo, contenido, tipoMime) {
    const blob = contenido instanceof Blob
        ? contenido
        : new Blob([contenido], { type: tipoMime || 'application/octet-stream' });

    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivo;
    enlace.rel = 'noopener';
    enlace.style.display = 'none';

    document.body.appendChild(enlace);
    enlace.click();

    setTimeout(() => {
        enlace.remove();
        URL.revokeObjectURL(url);
    }, 10000);
}

function configurarFormularios() {
    // Cambiar label según tipo de búsqueda
    document.querySelectorAll('input[name="tipo-busqueda"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const label = document.getElementById('label-valor');
            const input = document.getElementById('expediente-valor');
            if (radio.value === 'numero') {
                label.textContent = 'Número de Expediente';
                input.placeholder = 'Ej: 1234/2025';
            } else {
                label.textContent = 'Nombre del Actor';
                input.placeholder = 'Ej: Juan Pérez';
            }
        });
    });
}

function formatearFecha(fecha) {
    return new Date(fecha).toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

// ==================== MODAL ====================

function abrirModal() {
    document.getElementById('modal-overlay').classList.add('active');
}

function cerrarModal() {
    document.getElementById('modal-overlay').classList.remove('active');
}

// ==================== TOAST ====================

function mostrarToast(mensaje, tipo = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.textContent = mensaje;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== INTEGRACIÓN CON IA (GEMINI) ====================
//
// Antes esto llamaba a Groq con "llama-3.3-70b-versatile" escrito en el
// código. El día que Groq retiró ese modelo, el asistente dejó de funcionar y
// hubo que tocar el código para revivirlo.
//
// Los proveedores retiran modelos constantemente —el propio gemini-2.5-flash
// tiene fecha de apagado—, así que aquí el modelo no está clavado: se guarda
// en la configuración, se puede elegir de la lista real que devuelve la API, y
// si el guardado desaparece, la aplicación busca uno vivo y sigue sola.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * La clave va en una cabecera, nunca en la url.
 *
 * Con ?key=... la clave acaba en el historial del navegador, en el panel de
 * red, en los registros de cualquier proxy y en cualquier captura de pantalla
 * de la consola. Es la forma que Google recomienda, y además las claves
 * nuevas con prefijo "AQ." se llevan mal con el parámetro de la url.
 */
function _cabecerasIA(apiKey) {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

/** Error de la API con el código HTTP a cuestas, que hace falta para decidir. */
async function _errorDeLaAPI(respuesta) {
    const detalle = await respuesta.json().catch(() => ({}));
    const error = new Error(detalle.error?.message || `La API respondió ${respuesta.status}`);
    error.status = respuesta.status;
    return error;
}

// Solo se usa la primera vez, antes de que el usuario elija. Que esté aquí no
// vuelve a ser un problema: si deja de existir, buscarModeloVivo() lo sustituye.
const GEMINI_MODELO_POR_DEFECTO = 'gemini-2.5-flash';

// Orden de preferencia al tener que elegir solos. Flash antes que Pro: el
// análisis de un acuerdo no necesita el modelo caro, y en el plan gratuito
// Flash admite bastantes más peticiones al día.
const GEMINI_PREFERENCIAS = ['flash-lite', 'flash', 'pro'];

let resultadosIAActuales = null;

async function guardarConfigIA(event) {
    event.preventDefault();

    await guardarConfig('ia_api_key', document.getElementById('ia-api-key').value.trim());
    await guardarConfig('ia_modelo', document.getElementById('ia-modelo').value.trim());

    mostrarToast('Configuración de IA guardada', 'success');
}

async function cargarConfigIA() {
    const apiKey = await obtenerConfig('ia_api_key');
    const modelo = await obtenerConfig('ia_modelo');
    const campoKey = document.getElementById('ia-api-key');
    const campoModelo = document.getElementById('ia-modelo');

    if (campoKey && apiKey) campoKey.value = apiKey;
    if (campoModelo) _ponerOpcionModelo(campoModelo, modelo || GEMINI_MODELO_POR_DEFECTO);
}

/** Deja el select con ese modelo seleccionado, añadiéndolo si no estaba. */
function _ponerOpcionModelo(select, modelo) {
    if (!modelo) return;
    if (![...select.options].some(o => o.value === modelo)) {
        select.add(new Option(modelo, modelo));
    }
    select.value = modelo;
}

/**
 * Los modelos que esta clave puede usar hoy, según la propia API.
 *
 * Es la única fuente fiable: una lista escrita a mano en el código envejece y
 * acaba ofreciendo modelos que ya no existen, que es exactamente lo que rompió
 * el asistente.
 */
async function listarModelosIA(apiKey) {
    const respuesta = await fetch(`${GEMINI_BASE}/models?pageSize=200`,
        { headers: _cabecerasIA(apiKey) });
    if (!respuesta.ok) {
        const error = await _errorDeLaAPI(respuesta);
        if (respuesta.status === 401 || respuesta.status === 403) {
            throw new Error('Tu clave no fue aceptada. Comprueba que sea una clave de la API de ' +
                            'Gemini creada en aistudio.google.com/apikey. (' + error.message + ')');
        }
        throw error;
    }

    const datos = await respuesta.json();
    return (datos.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean);
}

/** De una lista de modelos, el que mejor encaja con lo que hace esta app. */
function _elegirModelo(modelos) {
    for (const preferencia of GEMINI_PREFERENCIAS) {
        const encontrado = modelos.find(m => m.includes(preferencia));
        if (encontrado) return encontrado;
    }
    return modelos[0] || null;
}

/** Rellena el select de modelos con lo que la API diga que hay. */
async function cargarModelosIA() {
    const apiKey = document.getElementById('ia-api-key').value.trim();
    if (!apiKey) {
        mostrarToast('Escribe primero tu API Key', 'warning');
        return;
    }

    const select = document.getElementById('ia-modelo');
    const elegido = select.value;

    try {
        mostrarToast('Consultando modelos disponibles...', 'info');
        const modelos = await listarModelosIA(apiKey);
        if (!modelos.length) throw new Error('La API no devolvió ningún modelo utilizable');

        select.innerHTML = '';
        modelos.forEach(m => select.add(new Option(m, m)));
        _ponerOpcionModelo(select, modelos.includes(elegido) ? elegido : _elegirModelo(modelos));

        mostrarToast(`${modelos.length} modelos disponibles`, 'success');
    } catch (error) {
        mostrarToast('No se pudieron cargar los modelos: ' + error.message, 'error');
    }
}

/**
 * Busca un modelo que exista, lo guarda y lo devuelve.
 *
 * Se usa cuando el guardado ya no existe. Es lo que hace que la retirada de un
 * modelo por parte de Google sea un contratiempo de un segundo en vez de una
 * app rota hasta que alguien toque el código.
 */
async function buscarModeloVivo(apiKey, guardar = true) {
    const modelos = await listarModelosIA(apiKey);
    const elegido = _elegirModelo(modelos);
    if (!elegido) throw new Error('Tu clave no tiene acceso a ningún modelo');

    // Solo se guarda cuando el modelo que falló era el de la configuración. Si
    // venía suelto —una prueba desde el formulario— no se toca lo guardado.
    if (guardar) {
        await guardarConfig('ia_modelo', elegido);
        const select = document.getElementById('ia-modelo');
        if (select) _ponerOpcionModelo(select, elegido);
    }

    return elegido;
}

/**
 * ¿El fallo es "ese modelo no está ahí"? Es el único que sabemos arreglar solos.
 *
 * Se mira también el código HTTP: un 404 en la ruta del modelo significa
 * exactamente eso, y hay respuestas que llegan sin cuerpo legible. Fiarse solo
 * del texto dejó pasar el 404 que devolvió gemini-2.5-flash, y la recuperación
 * automática —que existía justo para eso— no llegó a dispararse.
 */
function _esModeloInexistente(mensaje, status) {
    if (status === 404) return true;
    return /not found|does not exist|no tiene acceso|is not supported/i.test(String(mensaje || ''));
}

/**
 * Le manda un prompt al modelo y devuelve su respuesta en texto.
 *
 * Toda la aplicación pasa por aquí. Antes había tres copias de la misma
 * llamada repartidas por el archivo, así que cambiar de proveedor —o de
 * modelo— era cambiar la misma cosa en tres sitios y olvidarse de uno.
 */
async function llamarIA(prompt, opciones = {}) {
    // Se pueden pasar clave y modelo a mano: es lo que usa "Probar conexión"
    // para comprobar lo que hay escrito en pantalla sin llegar a guardarlo.
    const apiKey = opciones.apiKey || await obtenerConfig('ia_api_key');
    if (!apiKey) {
        throw new Error('Configura tu API Key de Gemini en Configuración');
    }

    let modelo = opciones.modelo || await obtenerConfig('ia_modelo') || GEMINI_MODELO_POR_DEFECTO;

    const cuerpo = {
        contents: _contenidosGemini(prompt, opciones),
        generationConfig: {
            temperature: opciones.temperatura ?? 0.1,
            maxOutputTokens: opciones.maxTokens ?? 2000
        }
    };
    if (opciones.sistema) {
        cuerpo.systemInstruction = { parts: [{ text: opciones.sistema }] };
    }

    const pedir = async (queModelo) => {
        const respuesta = await fetch(
            `${GEMINI_BASE}/models/${encodeURIComponent(queModelo)}:generateContent`,
            {
                method: 'POST',
                headers: _cabecerasIA(apiKey),
                body: JSON.stringify(cuerpo)
            }
        );

        if (!respuesta.ok) throw await _errorDeLaAPI(respuesta);
        return respuesta.json();
    };

    let datos;
    try {
        datos = await pedir(modelo);
    } catch (error) {
        if (!_esModeloInexistente(error.message, error.status)) throw error;

        // El modelo guardado ya no existe: se busca uno vivo y se reintenta.
        // Al usuario se le dice cuál, porque su asistente acaba de cambiar de
        // motor y merece enterarse.
        const anterior = modelo;
        modelo = await buscarModeloVivo(apiKey, !opciones.modelo);
        mostrarToast(`El modelo "${anterior}" ya no existe. Cambiado a "${modelo}".`, 'info');
        datos = await pedir(modelo);
    }

    const texto = (datos.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '').join('').trim();

    if (!texto) {
        const motivo = datos.candidates?.[0]?.finishReason || datos.promptFeedback?.blockReason;
        throw new Error(motivo ? `La IA no devolvió texto (${motivo})` : 'La IA no devolvió texto');
    }

    return texto;
}

/**
 * Los "contents" de la petición.
 *
 * Gemini llama "model" a lo que el resto del mundo llama "assistant", así que
 * un historial copiado de la API de Groq hay que traducirlo o la conversación
 * se le presenta al modelo como si la hubiera dicho toda el usuario.
 */
function _contenidosGemini(prompt, opciones) {
    if (Array.isArray(opciones.historial) && opciones.historial.length) {
        return opciones.historial.map(m => ({
            role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
            parts: [{ text: String(m.content ?? '') }]
        }));
    }

    const partes = [];
    if (prompt) partes.push({ text: prompt });
    if (opciones.audio) {
        partes.push({ inlineData: { mimeType: opciones.audio.mimeType, data: opciones.audio.datos } });
    }
    return [{ role: 'user', parts: partes }];
}

/**
 * Pasa un audio a texto.
 *
 * Groq tenía un endpoint aparte para esto (Whisper); en Gemini el audio entra
 * por la misma puerta que el texto, así que es una llamada normal con el audio
 * metido en la petición.
 */
async function transcribirAudioIA(blob, idioma = 'español') {
    const datos = await new Promise((resolver, rechazar) => {
        const lector = new FileReader();
        lector.onload = () => resolver(String(lector.result).split(',')[1] || '');
        lector.onerror = () => rechazar(new Error('No se pudo leer el audio'));
        lector.readAsDataURL(blob);
    });

    const texto = await llamarIA(
        `Transcribe literalmente este audio en ${idioma}. ` +
        'Responde solo con la transcripción, sin comillas ni comentarios.',
        { audio: { mimeType: blob.type || 'audio/webm', datos }, maxTokens: 1000, temperatura: 0 }
    );

    return texto.trim();
}

/** El JSON que viene dentro de la respuesta de la IA, que suele traer adornos. */
function _extraerJSON(texto) {
    const limpio = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const bloque = limpio.match(/\{[\s\S]*\}/);
    if (!bloque) throw new Error('No se pudo parsear la respuesta de la IA');
    return JSON.parse(bloque[0]);
}

async function probarIA() {
    const apiKey = document.getElementById('ia-api-key').value.trim();
    const modelo = document.getElementById('ia-modelo').value.trim() || GEMINI_MODELO_POR_DEFECTO;

    if (!apiKey) {
        mostrarToast('Ingresa tu API Key de Gemini', 'warning');
        return;
    }

    mostrarToast('Probando conexión...', 'info');

    try {
        // Con lo que hay escrito en pantalla, no con lo guardado: la gracia de
        // "probar" es comprobar lo que estás a punto de guardar.
        await llamarIA('Responde solo con: OK', { apiKey, modelo, maxTokens: 10 });
        mostrarToast('✅ Conexión correcta con Gemini', 'success');
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'error');
    }
}

// ==================== PROCESAMIENTO DE IMÁGENES PARA IA ====================

let imagenAcuerdoActual = null;

// Procesar imagen seleccionada
async function procesarImagenAcuerdo(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validar tipo de archivo
    if (!file.type.startsWith('image/')) {
        mostrarToast('Por favor selecciona una imagen válida', 'error');
        return;
    }

    // Validar tamaño (máx 10MB)
    if (file.size > 10 * 1024 * 1024) {
        mostrarToast('La imagen es muy grande. Máximo 10MB', 'error');
        return;
    }

    // Mostrar preview
    const reader = new FileReader();
    reader.onload = async function(e) {
        const previewContainer = document.getElementById('ia-imagen-preview');
        const previewImg = document.getElementById('ia-imagen-preview-img');

        previewImg.src = e.target.result;
        previewContainer.style.display = 'block';
        imagenAcuerdoActual = e.target.result;

        // Extraer texto de la imagen usando IA
        await extraerTextoDeImagen(e.target.result);
    };
    reader.readAsDataURL(file);

    // Limpiar el input para permitir seleccionar el mismo archivo de nuevo
    event.target.value = '';
}

// Seleccionar imagen del álbum de fotos (sin capture - abre galería)
function seleccionarImagenAlbum() {
    document.getElementById('ia-imagen-album').click();
}

// Capturar foto con la cámara (con capture - abre cámara)
function capturarFotoAcuerdo() {
    document.getElementById('ia-imagen-camara').click();
}

// ==================== OCR CON TESSERACT.JS (NAVEGADOR) ====================

// Extraer texto usando Tesseract.js (OCR en el navegador)
async function extraerTextoConTesseract(imagenBase64, textareaId = 'ia-texto-acuerdo', statusElId = 'ia-ocr-status') {
    const statusEl = document.getElementById(statusElId);
    const statusText = statusEl?.querySelector('span:not(.loading-spinner)') || statusEl;

    try {
        // Verificar que Tesseract esté disponible
        if (typeof Tesseract === 'undefined') {
            throw new Error('Tesseract.js no está cargado');
        }

        Logger.log('Iniciando OCR con Tesseract.js...');

        // Actualizar mensaje de estado
        if (statusText) {
            statusText.textContent = ' Extrayendo texto con OCR del navegador...';
        }

        // Ejecutar OCR con Tesseract.js
        const result = await Tesseract.recognize(
            imagenBase64,
            'spa', // Idioma español
            {
                logger: info => {
                    if (info.status === 'recognizing text') {
                        const progress = Math.round(info.progress * 100);
                        if (statusText) {
                            statusText.textContent = ` Extrayendo texto... ${progress}%`;
                        }
                    }
                }
            }
        );

        const textoExtraido = result.data.text?.trim();

        if (textoExtraido && textoExtraido.length > 10) {
            // Éxito - agregar texto extraído al textarea correspondiente
            const textarea = document.getElementById(textareaId);
            if (textarea) textarea.value = textoExtraido;
            mostrarToast('Texto extraído correctamente con OCR del navegador', 'success');
            Logger.log('OCR Tesseract exitoso, caracteres extraídos:', textoExtraido.length);
            return true;
        } else {
            Logger.warn('Tesseract no pudo extraer texto significativo');
            return false;
        }
    } catch (error) {
        Logger.error('Error en Tesseract OCR:', error);
        return false;
    }
}

// Extraer texto de imagen usando Tesseract.js (OCR del navegador)
async function extraerTextoDeImagen(imagenBase64) {
    const statusEl = document.getElementById('ia-ocr-status');

    if (statusEl) {
        statusEl.style.display = 'flex';
        const statusText = statusEl.querySelector('span:not(.loading-spinner)');
        if (statusText) statusText.textContent = ' Extrayendo texto con OCR...';
    }

    Logger.log('Extrayendo texto con Tesseract.js...');
    mostrarToast('Procesando imagen con OCR...', 'info');

    const tesseractSuccess = await extraerTextoConTesseract(imagenBase64);

    if (!tesseractSuccess) {
        mostrarToast('No se pudo extraer texto. Intenta con una imagen más clara o copia el texto manualmente.', 'warning');

        const textarea = document.getElementById('ia-texto-acuerdo');
        if (textarea && !textarea.value) {
            textarea.placeholder = 'No se pudo extraer texto automáticamente. Pega aquí el texto del acuerdo manualmente...';
        }
    }

    if (statusEl) statusEl.style.display = 'none';
}

// Eliminar imagen seleccionada
function eliminarImagenAcuerdo() {
    const previewContainer = document.getElementById('ia-imagen-preview');
    const inputAlbum = document.getElementById('ia-imagen-album');
    const inputCamara = document.getElementById('ia-imagen-camara');

    previewContainer.style.display = 'none';
    if (inputAlbum) inputAlbum.value = '';
    if (inputCamara) inputCamara.value = '';
    imagenAcuerdoActual = null;
}

// ==================== ANÁLISIS CON IA ====================

// Construye un objeto evento a partir de una fecha detectada por IA, ya con
// la hora normalizada, título que muestra la hora cuando existe, y todo el
// contexto del acuerdo (tipo, resumen, órgano) para que abrir el evento desde
// el calendario te diga exactamente de qué acuerdo viene y a qué expediente
// está vinculado.
function construirEventoIA(fecha, contexto) {
    const {
        expedienteId,
        expedienteTexto,
        expedienteLabel,
        institucion,
        juzgadoOrigen,
        tipoAcuerdo,
        resumen
    } = contexto;

    const horaNormalizada = parsearHoraIA(fecha.hora);
    const tieneHora = !!horaNormalizada;

    // Si el LLM dio un día sin hora válida, programamos a las 09:00 local
    // pero marcamos todoElDia=true para que la UI muestre "Todo el día".
    const dateTimeStr = `${fecha.fecha}T${tieneHora ? horaNormalizada : '09:00'}`;
    const fechaInicio = new Date(dateTimeStr);
    if (isNaN(fechaInicio.getTime())) {
        throw new Error(`Fecha inválida del análisis IA: ${fecha.fecha} ${fecha.hora || ''}`);
    }

    const tipoEvento = fecha.tipo === 'audiencia' ? 'audiencia'
        : fecha.tipo === 'vencimiento' ? 'vencimiento'
        : 'recordatorio';

    const instLabel = institucion === 'PJF' ? 'PJF Federal'
        : institucion === 'TSJ' ? 'TSJ Quintana Roo'
        : institucion || '';

    // El título lleva la hora al inicio cuando se detectó, para que en la
    // lista del calendario veas la hora sin tener que abrir el evento.
    const prefijoHora = tieneHora ? `${horaNormalizada} — ` : '';
    const expedienteInfo = expedienteLabel
        ? ` [${institucion === 'PJF' ? 'PJF ' : ''}Exp. ${expedienteLabel}]`
        : (institucion === 'PJF' ? ' [PJF]' : '');
    const titulo = `${prefijoHora}${fecha.descripcion || tipoEvento}${expedienteInfo}`;

    // Descripcion estructurada para el detalle del evento. Incluye todo el
    // contexto del acuerdo, no sólo el expediente, así desde el calendario se
    // puede leer el resumen sin volver a la pantalla de análisis.
    const descripcionLineas = [];
    descripcionLineas.push(`📋 Expediente: ${expedienteLabel || 'N/A'}`);
    if (juzgadoOrigen) descripcionLineas.push(`🏛️ Órgano: ${juzgadoOrigen}`);
    if (instLabel) descripcionLineas.push(`📌 Institución: ${instLabel}`);
    if (tipoAcuerdo) descripcionLineas.push(`📝 Tipo de acuerdo: ${tipoAcuerdo}`);
    if (tieneHora) descripcionLineas.push(`🕒 Hora: ${horaNormalizada}`);
    if (resumen) {
        descripcionLineas.push('');
        descripcionLineas.push(`📄 Resumen: ${resumen}`);
    }
    descripcionLineas.push('');
    descripcionLineas.push('— Extraído automáticamente del análisis IA');

    return {
        titulo,
        tipo: tipoEvento,
        fechaInicio: fechaInicio.toISOString(),
        todoElDia: !tieneHora,
        expedienteId: expedienteId || null,
        expedienteTexto: expedienteTexto || null,
        numeroExpediente: expedienteLabel,
        institucion: institucion,
        // Contexto del acuerdo persistido en el evento para mostrarlo al abrirlo
        tipoAcuerdo: tipoAcuerdo || null,
        resumen: resumen || null,
        juzgadoOrigen: juzgadoOrigen || null,
        origenIA: true,
        descripcion: descripcionLineas.join('\n'),
        alerta: true,
        color: tipoEvento === 'audiencia' ? '#3788d8'
             : tipoEvento === 'vencimiento' ? '#dc3545'
             : '#ffc107'
    };
}

// Normaliza la hora que devuelve el LLM a formato 24h "HH:MM".
// Acepta variaciones comunes ("10:30", "10:30 AM", "10:30:00", "10", "10:30hrs",
// "14h00") y descarta basura. Devuelve null si no hay hora válida — eso permite
// caer al comportamiento "todo el día" sin meter una hora inventada.
function parsearHoraIA(horaInput) {
    if (horaInput === null || horaInput === undefined) return null;
    let s = String(horaInput).trim();
    if (!s) return null;

    // "null" / "n/a" literales que a veces devuelve el LLM
    const sLower = s.toLowerCase();
    if (sLower === 'null' || sLower === 'n/a' || sLower === 'na' || sLower === 'no especifica' || sLower === 'no aplica') return null;

    // Detectar AM/PM
    let pm = false, am = false;
    if (/\bp\.?\s*m\.?\b/i.test(s)) pm = true;
    if (/\ba\.?\s*m\.?\b/i.test(s)) am = true;
    s = s.replace(/\b[ap]\.?\s*m\.?\b/ig, '').trim();
    s = s.replace(/h(rs?|oras)?$/i, '').trim();

    // Reemplazar separadores tipo "14h00" → "14:00"
    s = s.replace(/[h\.]/g, ':');

    const match = s.match(/^(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?$/);
    if (!match) return null;

    let h = parseInt(match[1], 10);
    let m = match[2] !== undefined ? parseInt(match[2], 10) : 0;
    if (isNaN(h) || isNaN(m)) return null;

    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;

    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function analizarAcuerdoConIA() {
    const texto = document.getElementById('ia-texto-acuerdo').value.trim();
    const expedienteSelect = document.getElementById('ia-expediente').value;
    const expedienteCustom = document.getElementById('ia-expediente-custom')?.value?.trim() || '';
    const apiKey = await obtenerConfig('ia_api_key');

    // Determinar expediente: ID, personalizado, o ninguno
    let expedienteId = null;
    let expedienteTexto = null;

    if (expedienteSelect === '__custom__' && expedienteCustom) {
        expedienteTexto = expedienteCustom;
    } else if (expedienteSelect && expedienteSelect !== '__custom__' && expedienteSelect !== '') {
        expedienteId = expedienteSelect;
    }

    if (!texto) {
        mostrarToast('Pega el texto del acuerdo a analizar', 'warning');
        return;
    }

    if (!apiKey) {
        mostrarToast('Configura tu API Key de Gemini en Configuración', 'warning');
        return;
    }

    const btn = document.getElementById('btn-analizar-ia');
    btn.innerHTML = '<span class="loading-spinner"></span> Analizando...';
    btn.classList.add('loading');

    const prompt = `Analiza el siguiente acuerdo judicial y extrae la información importante.

TEXTO DEL ACUERDO:
${texto}

Responde ÚNICAMENTE en formato JSON con la siguiente estructura (sin explicaciones adicionales):
{
    "numero_expediente": "Número de expediente mencionado en el acuerdo (ej: 123/2025) o null si no se encuentra",
    "juzgado_origen": "Nombre del juzgado, sala u órgano jurisdiccional que emite el acuerdo, o null si no se identifica",
    "institucion": "TSJ|PJF|OTRO - identifica si es del Tribunal Superior de Justicia estatal (TSJ), del Poder Judicial de la Federación (PJF), o de otra autoridad/dependencia (OTRO)",
    "resumen": "Resumen breve del acuerdo en 1-2 oraciones",
    "tipo_acuerdo": "admisión|sentencia|auto|citación|notificación|otro",
    "fechas": [
        {
            "tipo": "audiencia|vencimiento|cita|otro",
            "fecha": "YYYY-MM-DD",
            "hora": "HH:MM o null si no aplica",
            "descripcion": "Descripción del evento"
        }
    ],
    "puntos_importantes": [
        "Punto importante 1",
        "Punto importante 2"
    ],
    "acciones_requeridas": [
        "Acción que debe tomar el usuario"
    ],
    "montos": [
        {
            "concepto": "Descripción",
            "cantidad": "Monto en formato $X,XXX.XX"
        }
    ]
}

IMPORTANTE: Siempre intenta extraer el número de expediente del texto del acuerdo. Busca patrones como "Expediente:", "Exp.", "Causa:", "Toca:", seguidos de un número con formato número/año (ej: 123/2025, 45/2024). También identifica el juzgado u órgano que emite el acuerdo y si es del TSJ estatal o del PJF federal.
Si algún campo no tiene información, usa un array vacío [] o null según corresponda.`;

    try {
        const resultado = _extraerJSON(await llamarIA(prompt));
        resultado.expedienteId = expedienteId ? parseInt(expedienteId) : null;
        resultado.expedienteTexto = expedienteTexto || null;

        mostrarResultadosIA(resultado);
        resultadosIAActuales = resultado;

        mostrarToast('Análisis completado', 'success');

    } catch (error) {
        Logger.error('Error al analizar:', error);
        mostrarToast('Error: ' + error.message, 'error');
    } finally {
        btn.innerHTML = '🤖 Analizar con IA';
        btn.classList.remove('loading');
    }
}

function mostrarResultadosIA(resultado) {
    const container = document.getElementById('resultados-ia-contenido');
    let html = '';

    // Número de expediente extraído por IA
    if (resultado.numero_expediente) {
        const institucionLabel = resultado.institucion === 'PJF' ? '🏛️ PJF Federal' :
                                 resultado.institucion === 'TSJ' ? '⚖️ TSJ Quintana Roo' : '📋 ' + (resultado.institucion || 'No identificada');
        html += `
            <div class="ia-resultado-item" style="background: #e8f5e9; border-left: 4px solid #4caf50; padding: 0.75rem;">
                <h4>🔢 Expediente Detectado</h4>
                <p><strong>Número:</strong> ${escapeText(resultado.numero_expediente)}</p>
                ${resultado.juzgado_origen ? `<p><strong>Órgano:</strong> ${escapeText(resultado.juzgado_origen)}</p>` : ''}
                <p><strong>Institución:</strong> ${institucionLabel}</p>
            </div>
        `;
    }

    // Resumen (sanitizar respuesta de API externa)
    if (resultado.resumen) {
        html += `
            <div class="ia-resultado-item">
                <h4>📋 Resumen</h4>
                <p>${escapeText(resultado.resumen)}</p>
                <p><small>Tipo: ${escapeText(resultado.tipo_acuerdo || 'No especificado')}</small></p>
            </div>
        `;
    }

    // Fechas/Eventos
    if (resultado.fechas && resultado.fechas.length > 0) {
        html += `<div class="ia-resultado-item">
            <h4>📅 Fechas y Eventos Detectados</h4>`;

        resultado.fechas.forEach((fecha, i) => {
            const fechaStr = escapeText(fecha.fecha) + (fecha.hora ? ` a las ${escapeText(fecha.hora)}` : '');
            html += `
                <div class="ia-resultado-check">
                    <input type="checkbox" id="ia-fecha-${i}" checked>
                    <label for="ia-fecha-${i}">
                        <strong>${escapeText(fecha.tipo?.toUpperCase() || '')}:</strong> ${escapeText(fecha.descripcion)}
                        <br><small>📆 ${fechaStr}</small>
                    </label>
                </div>
            `;
        });
        html += `</div>`;
    }

    // Puntos importantes
    if (resultado.puntos_importantes && resultado.puntos_importantes.length > 0) {
        html += `<div class="ia-resultado-item">
            <h4>⚠️ Puntos Importantes</h4>`;

        resultado.puntos_importantes.forEach((punto, i) => {
            html += `
                <div class="ia-resultado-check">
                    <input type="checkbox" id="ia-punto-${i}" checked>
                    <label for="ia-punto-${i}">${escapeText(punto)}</label>
                </div>
            `;
        });
        html += `</div>`;
    }

    // Acciones requeridas
    if (resultado.acciones_requeridas && resultado.acciones_requeridas.length > 0) {
        html += `<div class="ia-resultado-item">
            <h4>✅ Acciones Requeridas</h4>`;

        resultado.acciones_requeridas.forEach((accion, i) => {
            html += `
                <div class="ia-resultado-check">
                    <input type="checkbox" id="ia-accion-${i}" checked>
                    <label for="ia-accion-${i}">${escapeText(accion)}</label>
                </div>
            `;
        });
        html += `</div>`;
    }

    // Montos
    if (resultado.montos && resultado.montos.length > 0) {
        html += `<div class="ia-resultado-item">
            <h4>💰 Montos Mencionados</h4>`;

        resultado.montos.forEach(monto => {
            html += `<p><strong>${escapeText(monto.concepto)}:</strong> ${escapeText(monto.cantidad)}</p>`;
        });
        html += `</div>`;
    }

    container.innerHTML = html || '<p>No se encontró información relevante en el texto.</p>';
    document.getElementById('resultados-ia').style.display = 'block';
}

async function guardarResultadosIA() {
    if (!resultadosIAActuales) return;

    const resultado = resultadosIAActuales;
    let guardados = 0;

    // Determinar el número de expediente: priorizar el extraído por IA, luego el seleccionado manualmente
    const numExpExtraido = resultado.numero_expediente || null;
    const juzgadoExtraido = resultado.juzgado_origen || null;
    const institucionExtraida = resultado.institucion || 'TSJ';

    // Si la IA extrajo un número de expediente y no se seleccionó uno manualmente, usarlo
    if (numExpExtraido && !resultado.expedienteId && !resultado.expedienteTexto) {
        resultado.expedienteTexto = numExpExtraido;
    }

    // Si hay un expediente (personalizado o extraído por IA), crearlo/vincularlo automáticamente
    if (resultado.expedienteTexto && !resultado.expedienteId) {
        try {
            // Verificar si ya existe un expediente con ese número
            const expedientes = await obtenerExpedientes();
            const existente = expedientes.find(e =>
                (e.numero && e.numero.toLowerCase() === resultado.expedienteTexto.toLowerCase()) ||
                (e.nombre && e.nombre.toLowerCase() === resultado.expedienteTexto.toLowerCase())
            );

            if (existente) {
                // Ya existe, usar su ID
                resultado.expedienteId = existente.id;
                mostrarToast(`Expediente "${resultado.expedienteTexto}" ya existe, vinculando...`, 'info');
            } else {
                // Crear nuevo expediente con datos extraídos por IA
                const nuevoExp = {
                    numero: resultado.expedienteTexto,
                    juzgado: juzgadoExtraido || 'Por determinar',
                    categoria: 'General',
                    institucion: institucionExtraida,
                    comentario: `Creado automáticamente desde análisis IA${juzgadoExtraido ? ' - ' + juzgadoExtraido : ''}`
                };
                const idNuevo = await agregarExpediente(nuevoExp);
                resultado.expedienteId = idNuevo;
                guardados++;
                mostrarToast(`Expediente "${resultado.expedienteTexto}" creado automáticamente`, 'success');
            }
        } catch (e) {
            Logger.error('Error al crear expediente:', e);
        }
    }

    // Resolver la etiqueta de expediente para usar en eventos y notas
    let expedienteLabel = '';
    if (resultado.expedienteId) {
        const exp = await obtenerExpediente(resultado.expedienteId);
        if (exp) expedienteLabel = exp.numero || exp.nombre || '';
    } else if (resultado.expedienteTexto) {
        expedienteLabel = resultado.expedienteTexto;
    } else if (numExpExtraido) {
        expedienteLabel = numExpExtraido;
    }

    // Guardar eventos/fechas seleccionados con hora normalizada y todo el
    // contexto del acuerdo (tipo, resumen, órgano) — así al abrir el evento
    // desde el calendario se ve de qué expediente y acuerdo proviene.
    if (resultado.fechas) {
        for (let i = 0; i < resultado.fechas.length; i++) {
            const checkbox = document.getElementById(`ia-fecha-${i}`);
            if (checkbox && checkbox.checked) {
                const fecha = resultado.fechas[i];
                try {
                    const evento = construirEventoIA(fecha, {
                        expedienteId: resultado.expedienteId,
                        expedienteTexto: resultado.expedienteTexto || numExpExtraido,
                        expedienteLabel,
                        institucion: institucionExtraida,
                        juzgadoOrigen: juzgadoExtraido,
                        tipoAcuerdo: resultado.tipo_acuerdo,
                        resumen: resultado.resumen
                    });
                    await agregarEvento(evento);
                    guardados++;
                } catch (e) {
                    Logger.error('Error al guardar evento:', e);
                    mostrarToast('Una fecha del acuerdo no se pudo guardar (fecha inválida)', 'warning');
                }
            }
        }
    }

    // Guardar notas de puntos importantes y acciones
    const notasTexto = [];

    // Incluir número de expediente al inicio de la nota
    if (expedienteLabel) {
        notasTexto.push(`📋 Expediente: ${expedienteLabel}`);
        if (juzgadoExtraido) notasTexto.push(`🏛️ Órgano: ${juzgadoExtraido}`);
        if (institucionExtraida) notasTexto.push(`📌 Institución: ${institucionExtraida === 'PJF' ? 'PJF Federal' : institucionExtraida === 'TSJ' ? 'TSJ Quintana Roo' : institucionExtraida}`);
        notasTexto.push('---');
    }

    if (resultado.puntos_importantes) {
        resultado.puntos_importantes.forEach((punto, i) => {
            const checkbox = document.getElementById(`ia-punto-${i}`);
            if (checkbox && checkbox.checked) {
                notasTexto.push(`⚠️ ${punto}`);
            }
        });
    }

    if (resultado.acciones_requeridas) {
        resultado.acciones_requeridas.forEach((accion, i) => {
            const checkbox = document.getElementById(`ia-accion-${i}`);
            if (checkbox && checkbox.checked) {
                notasTexto.push(`✅ TODO: ${accion}`);
            }
        });
    }

    if (resultado.montos && resultado.montos.length > 0) {
        notasTexto.push('');
        notasTexto.push('💰 MONTOS:');
        resultado.montos.forEach(m => {
            notasTexto.push(`  - ${m.concepto}: ${m.cantidad}`);
        });
    }

    // Guardar nota si hay contenido (con o sin expediente)
    if (notasTexto.length > 0) {
        const nota = {
            expedienteId: resultado.expedienteId,
            expedienteTexto: resultado.expedienteTexto || numExpExtraido,
            numeroExpediente: expedienteLabel,
            institucion: institucionExtraida,
            titulo: `Análisis IA${expedienteLabel ? ' - Exp. ' + expedienteLabel : ''} - ${new Date().toLocaleDateString('es-MX')}`,
            contenido: notasTexto.join('\n'),
            color: '#cce5ff',
            recordatorio: null
        };

        try {
            await agregarNota(nota);
            guardados++;
        } catch (e) {
            Logger.error('Error al guardar nota:', e);
        }
    }

    // Actualizar UI
    await cargarExpedientes(); // También actualizar expedientes por si se creó uno nuevo
    await cargarEventos();
    await cargarNotas();
    await cargarEstadisticas();
    renderizarCalendario();

    document.getElementById('resultados-ia').style.display = 'none';
    document.getElementById('ia-texto-acuerdo').value = '';
    eliminarImagenAcuerdo(); // Limpiar imagen si había
    resultadosIAActuales = null;

    mostrarToast(`${guardados} elementos guardados`, 'success');

    // Sincronizar automáticamente con otros dispositivos
    if (typeof marcarYSincronizar === 'function') await marcarYSincronizar();
}

// Actualizar select de expedientes para IA
async function actualizarSelectExpedientesIA() {
    const expedientes = await obtenerExpedientes();
    const select = document.getElementById('ia-expediente');
    if (select) {
        select.innerHTML = '<option value="">Sin expediente específico</option>' +
            '<option value="__custom__">✏️ Otro (escribir manualmente)</option>' +
            expedientes.map(e => `<option value="${e.id}">${e.numero || e.nombre} - ${e.juzgado}</option>`).join('');
    }
}

// Filtrar opciones del select de expediente en los paneles de IA
function filtrarIAExpediente(prefix) {
    var searchId = prefix + '-expediente-search';
    var selectId = prefix + '-expediente';
    var input = document.getElementById(searchId);
    var select = document.getElementById(selectId);
    if (!input || !select) return;

    var query = input.value.toLowerCase().trim();
    Array.from(select.options).forEach(function(opt) {
        // Siempre mostrar opción vacía y la de escribir manualmente
        if (opt.value === '' || opt.value === '__custom__') {
            opt.style.display = '';
            return;
        }
        var texto = (opt.textContent || '').toLowerCase();
        opt.style.display = (!query || texto.includes(query)) ? '' : 'none';
    });
}

// ==================== BÚSQUEDAS PROGRAMADAS ====================

let busquedaAutoInterval = null;

async function toggleBusquedasAuto() {
    const activado = document.getElementById('config-busquedas-auto').checked;
    const opciones = document.getElementById('config-busquedas-opciones');

    await guardarConfig('busquedas_auto', activado ? 'true' : 'false');
    opciones.style.display = activado ? 'block' : 'none';

    if (activado) {
        iniciarBusquedasAuto();
        mostrarToast('Búsquedas automáticas activadas', 'success');
    } else {
        detenerBusquedasAuto();
        mostrarToast('Búsquedas automáticas desactivadas', 'info');
    }
}

async function guardarFrecuenciaBusqueda() {
    const frecuencia = document.getElementById('busqueda-frecuencia').value;
    await guardarConfig('busqueda_frecuencia', frecuencia);

    // Reiniciar intervalo con nueva frecuencia
    const activado = document.getElementById('config-busquedas-auto').checked;
    if (activado) {
        detenerBusquedasAuto();
        iniciarBusquedasAuto();
    }

    mostrarToast('Frecuencia actualizada', 'success');
}

async function iniciarBusquedasAuto() {
    const frecuenciaMin = parseInt(await obtenerConfig('busqueda_frecuencia') || '60');
    const frecuenciaMs = frecuenciaMin * 60 * 1000;

    busquedaAutoInterval = setInterval(async () => {
        await ejecutarBusquedaAhora();
    }, frecuenciaMs);

    Logger.log(`Búsquedas automáticas iniciadas: cada ${frecuenciaMin} minutos`);
}

function detenerBusquedasAuto() {
    if (busquedaAutoInterval) {
        clearInterval(busquedaAutoInterval);
        busquedaAutoInterval = null;
    }
}

async function ejecutarBusquedaAhora() {
    const todosExpedientes = await obtenerExpedientes();
    // Solo buscar en TSJQROO los expedientes TSJ (excluir PJF)
    const expedientes = todosExpedientes.filter(exp => (exp.institucion || 'TSJ') === 'TSJ');

    if (expedientes.length === 0) {
        mostrarToast('No hay expedientes TSJ para buscar', 'warning');
        return;
    }

    // Guardar timestamp de última búsqueda
    await guardarConfig('ultima_busqueda_auto', new Date().toISOString());
    actualizarUltimaBusqueda();

    // Abrir búsquedas en popups
    let delay = 0;
    expedientes.forEach(exp => {
        const tipoBusqueda = exp.numero ? 'numero' : 'nombre';
        const valor = exp.numero || exp.nombre;
        const url = construirUrlBusqueda(exp.juzgado, tipoBusqueda, valor);

        setTimeout(() => {
            abrirBusquedaPopup(url, valor);
        }, delay);

        delay += 800;
    });

    mostrarToast(`Buscando ${expedientes.length} expedientes...`, 'success');
}

async function actualizarUltimaBusqueda() {
    const ultima = await obtenerConfig('ultima_busqueda_auto');
    const elemento = document.getElementById('ultima-busqueda-auto');

    if (ultima && elemento) {
        const fecha = new Date(ultima);
        elemento.textContent = fecha.toLocaleString('es-MX');
    }
}

async function cargarConfigBusquedasAuto() {
    const activado = await obtenerConfig('busquedas_auto') === 'true';
    const frecuencia = await obtenerConfig('busqueda_frecuencia') || '60';

    document.getElementById('config-busquedas-auto').checked = activado;
    document.getElementById('busqueda-frecuencia').value = frecuencia;
    document.getElementById('config-busquedas-opciones').style.display = activado ? 'block' : 'none';

    actualizarUltimaBusqueda();

    if (activado) {
        iniciarBusquedasAuto();
    }
}

// ==================== BÚSQUEDA GLOBAL ====================

function toggleJuzgadosEspecificos() {
    const ambito = document.getElementById('busqueda-global-ambito').value;
    const container = document.getElementById('juzgados-especificos-container');
    if (ambito === 'especificos') {
        container.style.display = 'block';
        poblarCheckboxesJuzgados();
    } else {
        container.style.display = 'none';
    }
}

function poblarCheckboxesJuzgados() {
    const container = document.getElementById('juzgados-checkboxes');
    if (container.children.length > 0) return; // ya poblado
    let html = '';
    for (const cat of CATEGORIAS_JUZGADOS) {
        html += `<div class="juzgado-grupo" style="margin-bottom:8px;">
            <div style="font-weight:600; font-size:0.85rem; color:var(--primary-color,#2563eb); margin-bottom:4px; cursor:pointer;" onclick="toggleGrupoJuzgados(this)">
                ${cat.icono} ${cat.nombre} <span style="font-size:0.75rem; color:#888;">(${cat.juzgados.length})</span>
            </div>`;
        for (const juzgado of cat.juzgados) {
            html += `<label class="juzgado-check-item" style="display:flex; align-items:center; gap:5px; font-size:0.8rem; padding:2px 0 2px 16px; cursor:pointer;">
                <input type="checkbox" class="juzgado-global-cb" value="${juzgado}">
                <span class="juzgado-check-label">${juzgado}</span>
            </label>`;
        }
        html += '</div>';
    }
    container.innerHTML = html;
}

function toggleGrupoJuzgados(headerEl) {
    const grupo = headerEl.closest('.juzgado-grupo');
    const checkboxes = grupo.querySelectorAll('.juzgado-global-cb');
    const todosChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !todosChecked);
}

function toggleTodosJuzgadosGlobal(checked) {
    document.querySelectorAll('.juzgado-global-cb').forEach(cb => {
        if (cb.closest('.juzgado-check-item').style.display !== 'none') {
            cb.checked = checked;
        }
    });
}

function filtrarJuzgadosGlobal() {
    const filtro = document.getElementById('filtro-juzgados-global').value.toLowerCase();
    document.querySelectorAll('#juzgados-checkboxes .juzgado-check-item').forEach(item => {
        const texto = item.querySelector('.juzgado-check-label').textContent.toLowerCase();
        item.style.display = texto.includes(filtro) ? '' : 'none';
    });
    // Ocultar grupos vacíos
    document.querySelectorAll('#juzgados-checkboxes .juzgado-grupo').forEach(grupo => {
        const visibles = grupo.querySelectorAll('.juzgado-check-item:not([style*="display: none"])');
        grupo.style.display = visibles.length > 0 ? '' : 'none';
    });
}

async function ejecutarBusquedaGlobal() {
    const tipoBusqueda = document.querySelector('input[name="tipo-busqueda-global"]:checked').value;
    const valor = document.getElementById('busqueda-global-valor').value.trim();
    const ambito = document.getElementById('busqueda-global-ambito').value;

    if (!valor) {
        mostrarToast('Ingresa un valor para buscar', 'warning');
        return;
    }

    // Determinar qué juzgados buscar
    let juzgadosABuscar = [];

    if (ambito === 'especificos') {
        const checked = document.querySelectorAll('.juzgado-global-cb:checked');
        juzgadosABuscar = Array.from(checked).map(cb => cb.value);
        if (juzgadosABuscar.length === 0) {
            mostrarToast('Selecciona al menos un juzgado', 'warning');
            return;
        }
    } else {
        if (ambito === 'todos' || ambito === 'primera') {
            juzgadosABuscar = juzgadosABuscar.concat(Object.keys(JUZGADOS));
        }
        if (ambito === 'todos' || ambito === 'segunda') {
            juzgadosABuscar = juzgadosABuscar.concat(Object.keys(SALAS_SEGUNDA_INSTANCIA));
        }
    }

    const totalBusquedas = juzgadosABuscar.length;

    if (!confirm(`Esto abrirá ${totalBusquedas} búsquedas en ventanas popup.\n\n¿Continuar?`)) {
        return;
    }

    mostrarToast(`Iniciando búsqueda global en ${totalBusquedas} juzgados...`, 'info');

    // Abrir búsquedas con delay para no saturar
    let delay = 0;
    let abiertas = 0;

    for (const juzgado of juzgadosABuscar) {
        const url = construirUrlBusqueda(juzgado, tipoBusqueda, valor);

        setTimeout(() => {
            abrirBusquedaPopup(url, `${valor} en ${juzgado.substring(0, 30)}...`);
            abiertas++;

            if (abiertas === totalBusquedas) {
                mostrarToast(`${totalBusquedas} búsquedas completadas`, 'success');
            }
        }, delay);

        delay += 600; // 600ms entre cada ventana
    }
}

// ==================== INICIALIZACIÓN EXTENDIDA ====================

// Extender la función de inicialización original
const inicializarAppOriginal = inicializarApp;
inicializarApp = async function() {
    await inicializarAppOriginal();

    // Cargar configuraciones adicionales
    await cargarConfigIA();
    await cargarConfigBusquedasAuto();
    await actualizarSelectExpedientesIA();
};

// Actualizar select de IA cuando se cargan expedientes
const cargarExpedientesOriginal = cargarExpedientes;
cargarExpedientes = async function() {
    await cargarExpedientesOriginal();
    await actualizarSelectExpedientesIA();
    await actualizarLimitesPremium();
};

// ==================== SISTEMA PREMIUM ====================

// ==================== CONFIGURACIÓN PREMIUM ====================
// IMPORTANTE: Esta configuración es del lado del servidor/código
// NO debe ser modificable por usuarios desde la interfaz
const PREMIUM_CONFIG = {
    limiteExpedientes: 10,
    limiteBusquedasGlobales: 10,

    // URL del Google Sheet publicado como CSV (solo lectura - fallback)
    // Formato columnas: codigo, fecha_expiracion, dispositivo_id, usuario, estado
    googleSheetUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRxXuxjhz56UvZcCZTnCJcmSCpkEm-CZAap4lW3RweeSqSuMVRU4Dp-2NLVeYu9fev2kh7tr1d5wB_y/pub?output=csv',

    // ============ API DE LICENCIAS ============
    // URL de la API de Google Apps Script (permite lectura Y escritura)
    apiUrl: 'https://script.google.com/macros/s/AKfycbyK8kudH83BoBEN-NHLo7sPpdsIuqTdnusZcr08aRO_oXtv0frwzo8bpG9JWn9EoHbrLQ/exec',
    // =========================================

    precioMensual: 35,
    verificacionIntervalo: 7 // Días entre verificaciones periódicas
};

// Estado Premium
let estadoPremium = {
    activo: false,
    codigo: null,
    usuario: null,
    dispositivoId: null,
    fechaExpiracion: null,
    busquedasGlobalesUsadas: 0
};

// Función de ofuscación simple para almacenar datos
function _encode(str) {
    return btoa(encodeURIComponent(str).split('').reverse().join(''));
}

function _decode(str) {
    try {
        return decodeURIComponent(atob(str).split('').reverse().join(''));
    } catch {
        return null;
    }
}

// Parsear fecha de forma segura (evita "Invalid time value")
function parsearFechaSegura(valor) {
    if (!valor) return null;
    try {
        const fecha = new Date(valor);
        if (isNaN(fecha.getTime())) return null;
        return fecha;
    } catch {
        return null;
    }
}

// ==================== FINGERPRINT DE DISPOSITIVO ====================

// Generar ID único de dispositivo basado en características del navegador
function generarDeviceFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('TSJ Filing Premium 🔒', 2, 2);
    const canvasData = canvas.toDataURL();

    const datos = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 'unknown',
        navigator.platform,
        canvasData.slice(-50) // últimos 50 chars del canvas
    ];

    // Crear hash simple
    const str = datos.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    // Convertir a string hexadecimal y tomar los primeros 12 caracteres
    const hexHash = Math.abs(hash).toString(16).toUpperCase();
    const deviceId = 'TSJ-' + hexHash.padStart(8, '0').slice(0, 8);

    return deviceId;
}

// Obtener o generar ID de dispositivo (se guarda para persistencia)
function obtenerDeviceId() {
    let deviceId = localStorage.getItem('_tsjdid');

    if (!deviceId) {
        deviceId = generarDeviceFingerprint();
        localStorage.setItem('_tsjdid', deviceId);
    }

    return deviceId;
}

// Mostrar ID de dispositivo en la UI
function mostrarDeviceId() {
    const deviceId = obtenerDeviceId();
    const displayEl = document.getElementById('device-id-display');
    if (displayEl) {
        displayEl.textContent = `ID de dispositivo: ${deviceId}`;
    }
    return deviceId;
}

// Cargar estado premium
async function cargarEstadoPremium() {
    try {
        // Mostrar ID de dispositivo
        mostrarDeviceId();

        // Cargar datos guardados
        const datosGuardados = localStorage.getItem('_tsjp');
        if (datosGuardados) {
            const decoded = _decode(datosGuardados);
            if (decoded) {
                const datos = JSON.parse(decoded);
                estadoPremium = { ...estadoPremium, ...datos };

                // Verificar que el dispositivo coincida
                const deviceIdActual = obtenerDeviceId();
                if (estadoPremium.dispositivoId && estadoPremium.dispositivoId !== deviceIdActual) {
                    // Dispositivo diferente, invalidar premium
                    Logger.warn('Premium inválido: dispositivo diferente');
                    estadoPremium.activo = false;
                    estadoPremium.codigo = null;
                    estadoPremium.fechaExpiracion = null;
                    estadoPremium.dispositivoId = null;
                    estadoPremium.usuario = null;
                    guardarEstadoPremium();
                }

                // Verificar si expiró
                if (estadoPremium.fechaExpiracion) {
                    const expira = parsearFechaSegura(estadoPremium.fechaExpiracion);
                    if (!expira || expira < new Date()) {
                        estadoPremium.activo = false;
                        estadoPremium.codigo = null;
                        estadoPremium.fechaExpiracion = null;
                        guardarEstadoPremium();
                    }
                }
            }
        }

        // Cargar contador de búsquedas globales
        const busquedas = await obtenerConfig('busquedas_globales_usadas');
        estadoPremium.busquedasGlobalesUsadas = parseInt(busquedas) || 0;

        actualizarUIPremium();
    } catch (error) {
        Logger.error('Error al cargar estado premium:', error);
    }
}

// Guardar estado premium
function guardarEstadoPremium() {
    const datos = {
        activo: estadoPremium.activo,
        codigo: estadoPremium.codigo,
        usuario: estadoPremium.usuario,
        dispositivoId: estadoPremium.dispositivoId,
        fechaExpiracion: estadoPremium.fechaExpiracion
    };
    localStorage.setItem('_tsjp', _encode(JSON.stringify(datos)));
}

// Actualizar UI del panel premium
async function actualizarUIPremium() {
    const expedientes = await obtenerExpedientes();
    const numExpedientes = expedientes.length;
    const numBusquedas = estadoPremium.busquedasGlobalesUsadas;

    // Badge del plan
    const badge = document.getElementById('plan-badge');
    const planLimits = document.getElementById('plan-limits');
    const premiumBuy = document.getElementById('premium-buy');
    const premiumActive = document.getElementById('premium-active');
    const premiumActivation = document.getElementById('premium-activation');

    if (estadoPremium.activo) {
        // Plan Premium activo
        if (badge) {
            badge.className = 'plan-badge premium';
            badge.innerHTML = '<span class="badge-icon">⭐</span><span class="badge-text">Plan Premium</span>';
        }
        if (planLimits) planLimits.style.display = 'none';
        if (premiumBuy) premiumBuy.style.display = 'none';
        if (premiumActivation) premiumActivation.style.display = 'none';
        if (premiumActive) {
            premiumActive.style.display = 'block';
            const expiry = document.getElementById('premium-expiry');
            if (expiry && estadoPremium.fechaExpiracion) {
                const fechaExp = parsearFechaSegura(estadoPremium.fechaExpiracion);
                expiry.textContent = fechaExp
                    ? `Válido hasta: ${fechaExp.toLocaleDateString('es-MX')}`
                    : 'Fecha no disponible';
            }
        }
    } else {
        // Plan gratuito
        if (badge) {
            badge.className = 'plan-badge free';
            badge.innerHTML = '<span class="badge-icon">🆓</span><span class="badge-text">Plan Gratuito</span>';
        }
        if (planLimits) planLimits.style.display = 'grid';
        if (premiumBuy) premiumBuy.style.display = 'block';
        if (premiumActivation) premiumActivation.style.display = 'block';
        if (premiumActive) premiumActive.style.display = 'none';

        // Actualizar barras de límite
        actualizarBarrasLimite(numExpedientes, numBusquedas);
    }
}

// Actualizar barras de límite
function actualizarBarrasLimite(numExpedientes, numBusquedas) {
    const limiteExp = PREMIUM_CONFIG.limiteExpedientes;
    const limiteBus = PREMIUM_CONFIG.limiteBusquedasGlobales;

    // Expedientes
    const limitExpEl = document.getElementById('limit-expedientes');
    const fillExp = document.getElementById('limit-fill-exp');
    if (limitExpEl) {
        limitExpEl.textContent = `${numExpedientes} / ${limiteExp}`;
        if (numExpedientes >= limiteExp) limitExpEl.classList.add('limit-reached');
        else limitExpEl.classList.remove('limit-reached');
    }
    if (fillExp) {
        const pctExp = Math.min((numExpedientes / limiteExp) * 100, 100);
        fillExp.style.width = `${pctExp}%`;
        fillExp.className = 'limit-fill' + (pctExp >= 100 ? ' danger' : pctExp >= 70 ? ' warning' : '');
    }

    // Búsquedas
    const limitBusEl = document.getElementById('limit-busquedas');
    const fillBus = document.getElementById('limit-fill-bus');
    if (limitBusEl) {
        limitBusEl.textContent = `${numBusquedas} / ${limiteBus}`;
        if (numBusquedas >= limiteBus) limitBusEl.classList.add('limit-reached');
        else limitBusEl.classList.remove('limit-reached');
    }
    if (fillBus) {
        const pctBus = Math.min((numBusquedas / limiteBus) * 100, 100);
        fillBus.style.width = `${pctBus}%`;
        fillBus.className = 'limit-fill' + (pctBus >= 100 ? ' danger' : pctBus >= 70 ? ' warning' : '');
    }
}

// Actualizar límites al cargar expedientes
async function actualizarLimitesPremium() {
    await actualizarUIPremium();
}

// Verificar límite de expedientes
async function verificarLimiteExpedientes() {
    if (estadoPremium.activo) return true;

    const expedientes = await obtenerExpedientes();
    if (expedientes.length >= PREMIUM_CONFIG.limiteExpedientes) {
        mostrarModalLimite('expedientes');
        return false;
    }
    return true;
}

// Verificar límite de búsquedas globales
async function verificarLimiteBusquedasGlobales() {
    if (estadoPremium.activo) return true;

    if (estadoPremium.busquedasGlobalesUsadas >= PREMIUM_CONFIG.limiteBusquedasGlobales) {
        mostrarModalLimite('busquedas');
        return false;
    }
    return true;
}

// Incrementar contador de búsquedas globales
async function incrementarBusquedasGlobales() {
    estadoPremium.busquedasGlobalesUsadas++;
    await guardarConfig('busquedas_globales_usadas', estadoPremium.busquedasGlobalesUsadas.toString());
    await actualizarUIPremium();
}

// Mostrar modal de límite alcanzado
function mostrarModalLimite(tipo) {
    const titulo = tipo === 'expedientes' ?
        'Límite de Expedientes Alcanzado' :
        'Límite de Búsquedas Globales Alcanzado';

    const limite = tipo === 'expedientes' ?
        PREMIUM_CONFIG.limiteExpedientes :
        PREMIUM_CONFIG.limiteBusquedasGlobales;

    document.getElementById('modal-titulo').textContent = '⚠️ ' + titulo;
    document.getElementById('modal-body').innerHTML = `
        <div class="limit-warning">
            <div class="limit-warning-icon">🔒</div>
            <h3>Has alcanzado el límite gratuito</h3>
            <p>El plan gratuito permite hasta ${limite} ${tipo === 'expedientes' ? 'expedientes' : 'búsquedas globales'}.</p>
            <p>Actualiza a Premium por solo <strong>$${PREMIUM_CONFIG.precioMensual} MXN/mes</strong> para disfrutar de acceso ilimitado.</p>
        </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>
        <button class="btn btn-success" onclick="cerrarModal(); navegarA('config'); document.getElementById('premium-section').scrollIntoView({behavior: 'smooth'});">
            ⭐ Ver Planes
        </button>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

// Activar Premium con código
async function activarPremium() {
    const codigoInput = document.getElementById('premium-code');
    const usernameInput = document.getElementById('premium-username');
    const codigo = codigoInput.value.trim();
    const username = usernameInput ? usernameInput.value.trim() : '';

    if (!username) {
        mostrarToast('Ingresa tu nombre o identificador', 'warning');
        if (usernameInput) usernameInput.focus();
        return;
    }

    if (!codigo) {
        mostrarToast('Ingresa un código de activación', 'warning');
        codigoInput.focus();
        return;
    }

    const deviceId = obtenerDeviceId();
    mostrarToast('Verificando código...', 'info');

    try {
        // Verificar contra Google Sheets (incluye verificación de dispositivo)
        const resultado = await verificarCodigoPremium(codigo, deviceId);

        if (resultado.valido) {
            // Usar la fecha de expiración de la API, o 30 días como fallback
            let fechaExpISO;
            if (resultado.fechaExpiracion) {
                fechaExpISO = resultado.fechaExpiracion;
            } else {
                const fechaExp = new Date();
                fechaExp.setDate(fechaExp.getDate() + 30);
                fechaExpISO = fechaExp.toISOString();
            }

            estadoPremium.activo = true;
            estadoPremium.codigo = codigo;
            estadoPremium.usuario = username;
            estadoPremium.dispositivoId = deviceId;
            estadoPremium.fechaExpiracion = fechaExpISO;

            guardarEstadoPremium();
            await actualizarUIPremium();

            codigoInput.value = '';
            if (usernameInput) usernameInput.value = '';
            mostrarToast('¡Premium activado exitosamente!', 'success');
        } else {
            mostrarToast(resultado.mensaje || 'Código inválido o ya utilizado', 'error');
        }
    } catch (error) {
        Logger.error('Error al verificar código:', error);
        mostrarToast('Error al verificar. Intenta de nuevo.', 'error');
    }
}

// Verificar código contra API o Google Sheets
async function verificarCodigoPremium(codigo, deviceId, usuario) {
    // Si hay API configurada, usar API (permite registro de dispositivo)
    if (PREMIUM_CONFIG.apiUrl) {
        return await verificarConAPI(codigo, deviceId, usuario);
    }

    // Fallback a CSV (solo lectura, no puede registrar dispositivos)
    if (PREMIUM_CONFIG.googleSheetUrl) {
        return await verificarConCSV(codigo, deviceId);
    }

    // Sin API ni CSV configurado
    return { valido: false, mensaje: 'Sistema de licencias no configurado' };
}

// Verificar usando la API de Google Apps Script
async function verificarConAPI(codigo, deviceId, usuario) {
    try {
        const url = `${PREMIUM_CONFIG.apiUrl}?action=verificar&codigo=${encodeURIComponent(codigo)}&dispositivo_id=${encodeURIComponent(deviceId)}&usuario=${encodeURIComponent(usuario || '')}`;
        const response = await fetch(url);
        const resultado = await response.json();

        if (resultado.requiereRegistro) {
            // El código es válido pero necesita registrar este dispositivo
            return await registrarDispositivoEnAPI(codigo, deviceId, usuario);
        }

        if (resultado.dispositivoDiferente) {
            // Ofrecer opción de transferencia
            return {
                valido: false,
                mensaje: resultado.mensaje,
                puedeTransferir: true,
                intentosDuplicacion: resultado.intentosDuplicacion
            };
        }

        return resultado;
    } catch (error) {
        Logger.error('Error al verificar con API:', error);
        // Fallback a CSV si la API falla
        return await verificarConCSV(codigo, deviceId);
    }
}

// Registrar dispositivo en la API
async function registrarDispositivoEnAPI(codigo, deviceId, usuario) {
    try {
        const tipoDispositivo = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        const nombreDispositivo = navigator.userAgent.split(/[()]/)[1] || 'Dispositivo';

        const url = `${PREMIUM_CONFIG.apiUrl}?action=registrar_dispositivo&codigo=${encodeURIComponent(codigo)}&dispositivo_id=${encodeURIComponent(deviceId)}&usuario=${encodeURIComponent(usuario || '')}&tipo_dispositivo=${encodeURIComponent(tipoDispositivo)}&nombre_dispositivo=${encodeURIComponent(nombreDispositivo)}`;
        const response = await fetch(url);
        const resultado = await response.json();

        if (resultado.success) {
            return {
                valido: true,
                fechaExpiracion: resultado.fechaExpiracion,
                perpetua: resultado.perpetua,
                dispositivos: resultado.dispositivos,
                maxDispositivos: resultado.maxDispositivos
            };
        }

        return { valido: false, mensaje: resultado.mensaje };
    } catch (error) {
        Logger.error('Error al registrar dispositivo:', error);
        return { valido: false, mensaje: 'Error de conexión al registrar dispositivo' };
    }
}

// Transferir licencia a nuevo dispositivo
async function transferirLicencia(codigo, nuevoDeviceId, usuario, motivo) {
    if (!PREMIUM_CONFIG.apiUrl) {
        return { success: false, mensaje: 'Transferencia no disponible sin API configurada. Contacta soporte: jorge_clemente@empirica.mx' };
    }

    try {
        const tipoDispositivo = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        const nombreDispositivo = navigator.userAgent.split(/[()]/)[1] || 'Dispositivo';

        const url = `${PREMIUM_CONFIG.apiUrl}?action=transferir&codigo=${encodeURIComponent(codigo)}&nuevo_dispositivo_id=${encodeURIComponent(nuevoDeviceId)}&usuario=${encodeURIComponent(usuario || '')}&tipo_dispositivo=${encodeURIComponent(tipoDispositivo)}&nombre_dispositivo=${encodeURIComponent(nombreDispositivo)}`;
        const response = await fetch(url);
        const resultado = await response.json();

        return resultado;
    } catch (error) {
        Logger.error('Error al transferir licencia:', error);
        return { success: false, mensaje: 'Error de conexión' };
    }
}

// Verificación periódica de licencia (heartbeat)
async function verificarLicenciaPeriodica() {
    if (!estadoPremium.activo || !estadoPremium.codigo) return;

    // Verificar si ha pasado el intervalo desde la última verificación
    const ultimaVerificacion = localStorage.getItem('_tsjLastVerif');
    if (ultimaVerificacion) {
        const diasTranscurridos = (Date.now() - parseInt(ultimaVerificacion)) / (1000 * 60 * 60 * 24);
        if (diasTranscurridos < PREMIUM_CONFIG.verificacionIntervalo) {
            return; // No ha pasado suficiente tiempo
        }
    }

    if (PREMIUM_CONFIG.apiUrl) {
        try {
            const url = `${PREMIUM_CONFIG.apiUrl}?action=heartbeat&codigo=${encodeURIComponent(estadoPremium.codigo)}&dispositivo_id=${encodeURIComponent(estadoPremium.dispositivoId)}`;
            const response = await fetch(url);
            const resultado = await response.json();

            if (!resultado.valido) {
                // Licencia ya no es válida
                Logger.warn('Verificación periódica falló:', resultado.razon);

                if (resultado.razon === 'dispositivo_diferente') {
                    mostrarToast('Tu licencia fue transferida a otro dispositivo', 'warning');
                } else if (resultado.razon === 'expirado') {
                    mostrarToast('Tu licencia ha expirado', 'warning');
                } else if (resultado.razon === 'inactivo') {
                    mostrarToast('Tu licencia ha sido desactivada', 'warning');
                }

                // Desactivar premium localmente
                await desactivarPremium(false); // false = no mostrar toast adicional
            } else {
                // Actualizar fecha de expiración si cambió
                if (resultado.fechaExpiracion) {
                    estadoPremium.fechaExpiracion = resultado.fechaExpiracion;
                    guardarEstadoPremium();
                }

                // Mostrar aviso si quedan pocos días
                if (resultado.diasRestantes && resultado.diasRestantes <= 7) {
                    mostrarToast(`Tu licencia expira en ${resultado.diasRestantes} días`, 'warning');
                }
            }

            localStorage.setItem('_tsjLastVerif', Date.now().toString());
        } catch (error) {
            Logger.error('Error en verificación periódica:', error);
        }
    }
}

// Desactivar premium
async function desactivarPremium(mostrarMensaje = true) {
    estadoPremium.activo = false;
    estadoPremium.codigo = null;
    estadoPremium.usuario = null;
    estadoPremium.dispositivoId = null;
    estadoPremium.fechaExpiracion = null;

    localStorage.removeItem('_tsjprem');
    localStorage.removeItem('_tsjLastVerif');

    await actualizarUIPremium();

    if (mostrarMensaje) {
        mostrarToast('Suscripción Premium desactivada', 'info');
    }
}

// Verificar usando CSV (solo lectura - fallback)
async function verificarConCSV(codigo, deviceId) {
    try {
        const response = await fetch(PREMIUM_CONFIG.googleSheetUrl);
        const csvText = await response.text();

        const lineas = csvText.split('\n').slice(1);

        for (const linea of lineas) {
            const campos = linea.split(',').map(s => s.trim());
            const [codigoSheet, fechaExp, dispositivoRegistrado, usuarioRegistrado, estado] = campos;

            if (codigoSheet && codigoSheet.toUpperCase() === codigo.toUpperCase()) {
                const fechaExpiracion = parsearFechaSegura(fechaExp);
                if (!fechaExpiracion || fechaExpiracion < new Date()) {
                    return { valido: false, mensaje: 'Este código ha expirado' };
                }

                if (dispositivoRegistrado && dispositivoRegistrado !== '' && dispositivoRegistrado !== deviceId) {
                    return {
                        valido: false,
                        mensaje: 'Este código ya está vinculado a otro dispositivo. Contacta soporte para transferir tu licencia.',
                        puedeTransferir: true
                    };
                }

                if (estado && estado.toLowerCase() === 'revocado') {
                    return { valido: false, mensaje: 'Este código ha sido revocado' };
                }

                // Código válido - Advertir que sin API no se puede registrar
                if (!dispositivoRegistrado || dispositivoRegistrado === '') {
                    Logger.warn('Advertencia: Sin API configurada, no se puede vincular el dispositivo');
                }

                return { valido: true };
            }
        }

        return { valido: false, mensaje: 'Código no encontrado' };
    } catch (error) {
        Logger.error('Error al verificar con Google Sheets:', error);
        return { valido: false, mensaje: 'Error de conexión. Intenta de nuevo.' };
    }
}

// Configurar URL de Google Sheets (llamar desde consola para configurar)
function configurarGoogleSheet(url) {
    PREMIUM_CONFIG.googleSheetUrl = url;
    localStorage.setItem('_tsjgs', _encode(url));
    Logger.log('URL de Google Sheet configurada');
}

// Cargar URL de Google Sheets
function cargarConfigGoogleSheet() {
    const urlGuardada = localStorage.getItem('_tsjgs');
    if (urlGuardada) {
        const url = _decode(urlGuardada);
        if (url) {
            PREMIUM_CONFIG.googleSheetUrl = url;
        }
    }
}

// Modificar ejecutarBusquedaGlobal para verificar límite y contar uso
const ejecutarBusquedaGlobalOriginal = ejecutarBusquedaGlobal;
ejecutarBusquedaGlobal = async function() {
    const permitido = await verificarLimiteBusquedasGlobales();
    if (!permitido) return;

    await ejecutarBusquedaGlobalOriginal();
    await incrementarBusquedasGlobales();
};

// Extender inicialización para cargar premium
const inicializarAppConPremium = inicializarApp;
inicializarApp = async function() {
    cargarConfigGoogleSheet();
    await inicializarAppConPremium();
    await cargarEstadoPremium();
    await cargarConfigAutoBackup();
    // Verificar licencia periódicamente
    await verificarLicenciaPeriodica();
};

// UI para solicitar transferencia de licencia
function mostrarModalTransferencia() {
    const deviceId = generarDeviceFingerprint();

    document.getElementById('modal-titulo').textContent = '🔄 Transferir Licencia';
    document.getElementById('modal-body').innerHTML = `
        <div class="transfer-form">
            <p>Si cambiaste de dispositivo, puedes solicitar una transferencia de licencia.</p>
            <p style="color: #ff9800; font-size: 13px;"><strong>Nota:</strong> Solo puedes transferir cada 30 días.</p>

            <div class="form-group" style="margin-top: 15px;">
                <label>Código de licencia:</label>
                <input type="text" id="transfer-codigo" class="form-control" placeholder="Ej: f9KQ7mR2ZxP4A8Wc">
            </div>

            <div class="form-group">
                <label>Tu nombre/identificador:</label>
                <input type="text" id="transfer-usuario" class="form-control" placeholder="Para identificar la solicitud">
            </div>

            <div class="form-group">
                <label>Motivo de transferencia:</label>
                <select id="transfer-motivo" class="form-control">
                    <option value="nuevo_dispositivo">Cambié de computadora/dispositivo</option>
                    <option value="reinstalacion">Reinstalé el sistema operativo</option>
                    <option value="otro">Otro motivo</option>
                </select>
            </div>

            <p style="font-size: 11px; color: #888; margin-top: 10px;">
                ID de este dispositivo: <code style="font-size: 10px;">${deviceId.substring(0, 20)}...</code>
            </p>
        </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ejecutarTransferencia()">Solicitar Transferencia</button>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

// Ejecutar transferencia de licencia
async function ejecutarTransferencia() {
    const codigo = document.getElementById('transfer-codigo').value.trim();
    const usuario = document.getElementById('transfer-usuario').value.trim();
    const motivo = document.getElementById('transfer-motivo').value;
    const deviceId = generarDeviceFingerprint();

    if (!codigo) {
        mostrarToast('Ingresa el código de licencia', 'error');
        return;
    }

    const resultado = await transferirLicencia(codigo, deviceId, usuario, motivo);

    if (resultado.exito) {
        cerrarModal();
        mostrarToast('¡Licencia transferida! Ahora activa tu código.', 'success');

        // Limpiar estado anterior y activar
        estadoPremium.activo = false;
        await actualizarUIPremium();
    } else {
        mostrarToast(resultado.mensaje, 'error');
    }
}

// ==================== EVENT DELEGATION (FIX FIREFOX) ====================
// Delegación de eventos para botones en contenido dinámico
document.addEventListener('click', function(event) {
    // Buscar si el click fue en un botón de editar expediente
    const editBtn = event.target.closest('.expediente-actions .btn-secondary');
    if (editBtn && !event.defaultPrevented) {
        const card = editBtn.closest('.expediente-card');
        if (card) {
            const id = parseInt(card.dataset.id);
            if (!isNaN(id)) {
                event.preventDefault();
                event.stopPropagation();
                // Verificar si el card está dentro de la sección PJF
                const enPaginaPJF = !!card.closest('#page-pjf');
                if (enPaginaPJF) {
                    editarExpedientePJF(id, event);
                } else {
                    editarExpediente(id, event);
                }
            }
        }
    }

    // Buscar si el click fue en un botón de eliminar expediente
    const deleteBtn = event.target.closest('.expediente-actions .btn-danger');
    if (deleteBtn && !event.defaultPrevented) {
        const card = deleteBtn.closest('.expediente-card');
        if (card) {
            const id = parseInt(card.dataset.id);
            if (!isNaN(id)) {
                event.preventDefault();
                event.stopPropagation();
                // Verificar si el card está dentro de la sección PJF
                const enPaginaPJF = !!card.closest('#page-pjf');
                if (enPaginaPJF) {
                    confirmarEliminarExpedientePJF(id, event);
                } else {
                    confirmarEliminarExpediente(id, event);
                }
            }
        }
    }
}, true); // Usar capture phase para mejor compatibilidad con Firefox

// ==================== HOURLY SUBSCRIPTION CHECK ====================
// Verificar suscripción cada hora
setInterval(async () => {
    if (estadoPremium.activo && estadoPremium.codigo) {
        Logger.log('Verificando estado de suscripción...');
        await verificarLicenciaPeriodica();
    }
}, 60 * 60 * 1000); // Cada hora

// ==================== DETALLE DE UN EXPEDIENTE ====================

/**
 * Abre el detalle al pulsar la tarjeta, salvo cuando el clic iba a otra cosa.
 *
 * Los botones de la tarjeta ya hacen lo suyo y las casillas de selección
 * seleccionan: abrir además el detalle sería un segundo efecto que nadie pidió.
 */
function _clicEnTarjetaExpediente(event, expedienteId) {
    if (event.target.closest('button, input, select, a, label, .drag-handle')) return;
    if (event.currentTarget.classList.contains('selection-mode')) return;
    if (window.getSelection && String(window.getSelection()).length > 0) return;  // estaba copiando texto
    verDetalleExpediente(expedienteId);
}

/** Los eventos del calendario que cuelgan de un expediente, del más próximo al más lejano. */
async function eventosDeExpediente(expedienteId) {
    const todos = await obtenerEventos();
    return todos
        .filter(e => e.expedienteId === expedienteId)
        .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));
}

/**
 * Todo lo de un expediente en un sitio: sus datos, sus pendientes y sus fechas
 * del calendario. Antes había que ir a Pendientes y filtrar, y al calendario a
 * buscar, para reunir lo que pasa en un asunto.
 */
async function verDetalleExpediente(expedienteId) {
    const exp = await obtenerExpediente(expedienteId);
    if (!exp) {
        mostrarToast('Ese expediente ya no existe', 'warning');
        return;
    }

    const [pendientes, todosLosEventos] = await Promise.all([
        obtenerPendientesPorExpediente(expedienteId),
        eventosDeExpediente(expedienteId)
    ]);

    // Un pendiente con fecha lleva su propio evento en el calendario. Aquí el
    // pendiente ya sale arriba con su fecha, así que repetirlo abajo sería
    // contar dos veces la misma cosa en la misma ventana.
    const espejos = new Set(pendientes.map(p => p.eventoId).filter(id => id != null));
    const eventos = todosLosEventos.filter(e => !espejos.has(e.id));

    const abiertos = pendientes.filter(p => !p.completado);
    const hechos = pendientes.filter(p => p.completado);
    const ahora = new Date();
    const proximos = eventos.filter(e => new Date(e.fechaInicio) >= ahora);
    const pasados = eventos.filter(e => new Date(e.fechaInicio) < ahora);

    document.getElementById('modal-titulo').textContent = exp.numero || exp.nombre || 'Expediente';
    document.getElementById('modal-body').innerHTML = `
        <div class="detalle-expediente">
            ${_detalleDatosHTML(exp)}

            <section class="detalle-bloque">
                <h4>✅ Pendientes <span class="detalle-cuenta">${abiertos.length} por hacer</span></h4>
                ${abiertos.length || hechos.length
                    ? `<ul class="detalle-lista">
                         ${abiertos.map(_detallePendienteHTML).join('')}
                         ${hechos.map(_detallePendienteHTML).join('')}
                       </ul>`
                    : '<p class="detalle-vacio">Sin pendientes en este expediente.</p>'}
                <button class="btn btn-sm btn-secondary" onclick="cerrarModal(); mostrarFormularioPendiente(null, ${exp.id});">
                    ➕ Nuevo pendiente
                </button>
            </section>

            <section class="detalle-bloque">
                <h4>📅 Calendario <span class="detalle-cuenta">${proximos.length} por venir</span></h4>
                ${proximos.length || pasados.length
                    ? `<ul class="detalle-lista">
                         ${proximos.map(e => _detalleEventoHTML(e, false)).join('')}
                         ${pasados.slice(-5).reverse().map(e => _detalleEventoHTML(e, true)).join('')}
                       </ul>`
                    : '<p class="detalle-vacio">Sin fechas en el calendario para este expediente.</p>'}
                ${pasados.length > 5
                    ? `<p class="detalle-vacio">y ${pasados.length - 5} fecha${pasados.length - 5 !== 1 ? 's' : ''} más ya pasada${pasados.length - 5 !== 1 ? 's' : ''}.</p>`
                    : ''}
            </section>
        </div>
    `;

    const editarFn = exp.institucion === 'PJF' && typeof editarExpedientePJF === 'function'
        ? 'editarExpedientePJF' : 'editarExpediente';
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>
        <button class="btn btn-info" onclick="cerrarModal(); verTimelineExpediente(${exp.id});">📜 Timeline</button>
        <button class="btn btn-primary" onclick="cerrarModal(); ${editarFn}(${exp.id});">✏️ Editar</button>
    `;

    abrirModal();
}

function _detalleDatosHTML(exp) {
    const filas = [
        ['Juzgado', exp.juzgado],
        ['Institución', exp.institucion === 'PJF' ? 'Federal (PJF)' : 'TSJ Quintana Roo'],
        ['Actor', exp.actor],
        ['Demandado', exp.demandado],
        ['Categoría', exp.categoria],
        ['Comentario', exp.comentario]
    ].filter(([, valor]) => valor);

    return `
        <section class="detalle-bloque detalle-datos">
            ${filas.map(([etiqueta, valor]) => `
                <div class="detalle-dato">
                    <span class="detalle-etiqueta">${escapeText(etiqueta)}</span>
                    <span class="detalle-valor">${escapeText(valor)}</span>
                </div>`).join('')}
        </section>`;
}

function _detallePendienteHTML(p) {
    const vence = p.fechaLimite ? formatearFecha(p.fechaLimite) : '';
    const atrasado = p.fechaLimite && !p.completado && new Date(p.fechaLimite) < new Date();
    return `
        <li class="detalle-item${p.completado ? ' hecho' : ''}${atrasado ? ' atrasado' : ''}">
            <span class="detalle-item-marca">${p.completado ? '☑' : '☐'}</span>
            <span class="detalle-item-texto">
                ${escapeText(p.titulo)}
                ${vence ? `<span class="detalle-item-fecha">${escapeText(vence)}${atrasado ? ' · vencido' : ''}</span>` : ''}
            </span>
            <span class="detalle-item-prioridad prioridad-${escapeText(p.prioridad || 'media')}">${escapeText(p.prioridad || 'media')}</span>
        </li>`;
}

function _detalleEventoHTML(evento, pasado) {
    const cuando = evento.todoElDia ? formatearFecha(evento.fechaInicio) : formatearFechaHora(evento.fechaInicio);
    return `
        <li class="detalle-item${pasado ? ' hecho' : ''}">
            <span class="detalle-item-marca" style="color: ${escapeText(evento.color || '#888')}">●</span>
            <span class="detalle-item-texto">
                ${escapeText(evento.titulo)}
                <span class="detalle-item-fecha">${escapeText(cuando)}</span>
            </span>
            <span class="detalle-item-prioridad">${escapeText(evento.tipo || 'otro')}</span>
        </li>`;
}

// ==================== REPORTE DE ERRORES ====================

const CORREO_SOPORTE = 'jorge_clemente@empirica.mx';

/**
 * Datos técnicos que acompañan al reporte.
 *
 * Van CUENTAS de registros, nunca su contenido: saber que alguien tenía 900
 * expedientes cuando falló la importación ayuda a reproducirlo, y no dice nada
 * de ningún expediente. Aquí no entra ni un número de expediente, ni un
 * nombre, ni una nota — es información de clientes y no tiene por qué salir
 * del navegador de quien reporta.
 */
async function contextoTecnicoReporte() {
    const lineas = [];
    const acerca = document.querySelector('.about-info');

    lineas.push('Versión: ' + (acerca ? (acerca.textContent.match(/v[\d.]+/) || ['?'])[0] : '?'));
    lineas.push('Navegador: ' + navigator.userAgent);
    lineas.push('Idioma: ' + navigator.language +
                ' · Pantalla: ' + window.screen.width + '×' + window.screen.height);

    const pagina = document.querySelector('.page.active');
    lineas.push('Sección abierta: ' + (pagina ? pagina.id.replace('page-', '') : 'ninguna'));

    const premium = typeof estadoPremium !== 'undefined' && estadoPremium && estadoPremium.activo;
    lineas.push('Licencia: ' + (premium ? 'premium activa' : 'gratuita'));

    if (typeof syncState !== 'undefined' && syncState) {
        const pendiente = typeof hayPendienteSync === 'function' && hayPendienteSync();
        lineas.push('Última sincronización: ' + (syncState.lastSync || 'nunca') +
                    (pendiente ? ' (quedan cambios sin subir)' : ''));
    }

    try {
        const conteos = [];
        for (const almacen of Array.from(db.objectStoreNames)) {
            const n = await new Promise(resolver => {
                const peticion = db.transaction([almacen], 'readonly').objectStore(almacen).count();
                peticion.onsuccess = () => resolver(peticion.result);
                peticion.onerror = () => resolver('?');
            });
            conteos.push(almacen + '=' + n);
        }
        lineas.push('Registros: ' + conteos.join(', '));
    } catch (error) {
        lineas.push('Registros: no se pudieron contar (' + error.message + ')');
    }

    return lineas.join('\n');
}

async function mostrarModalReporteBug() {
    const contexto = await contextoTecnicoReporte();

    document.getElementById('modal-titulo').textContent = '🐞 Reportar un problema';
    document.getElementById('modal-body').innerHTML = `
        <form id="form-reporte-bug" onsubmit="enviarReporteBug(event)">
            <p style="margin-bottom: 1rem;">
                Cuéntame qué pasó y qué esperabas que pasara. Cuanto más concreto,
                antes lo puedo reproducir y arreglar.
            </p>

            <div class="form-group">
                <label for="reporte-descripcion">¿Qué ha pasado?</label>
                <textarea id="reporte-descripcion" rows="7" required maxlength="5000"
                          placeholder="Ejemplo: al importar el template con 200 expedientes, los pendientes se crean pero no aparecen en el calendario. Uso Chrome en Windows."></textarea>
            </div>

            <div class="form-group">
                <label for="reporte-contacto">Tu correo <span class="text-muted">(opcional, para poder responderte)</span></label>
                <input type="email" id="reporte-contacto" placeholder="tucorreo@ejemplo.com">
            </div>

            <details style="margin-top: 0.75rem;">
                <summary style="cursor: pointer; font-size: 0.85rem; color: var(--text-muted);">
                    Se adjuntan estos datos técnicos (sin ningún dato de tus expedientes)
                </summary>
                <pre style="white-space: pre-wrap; word-break: break-word; font-size: 0.75rem;
                            background: var(--bg-secondary, #f6f6f6); padding: 0.75rem;
                            border-radius: 6px; margin-top: 0.5rem;">${escapeText(contexto)}</pre>
            </details>
        </form>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="btn-enviar-reporte"
                onclick="document.getElementById('form-reporte-bug').requestSubmit()">Enviar reporte</button>
    `;

    // El contexto se guarda ya calculado: recalcularlo al enviar daría un
    // retrato distinto del que el usuario vio y aceptó mandar.
    document.getElementById('form-reporte-bug').dataset.contexto = contexto;

    abrirModal();
}

async function enviarReporteBug(event) {
    event.preventDefault();

    const formulario = document.getElementById('form-reporte-bug');
    const descripcion = document.getElementById('reporte-descripcion').value.trim();
    const contacto = document.getElementById('reporte-contacto').value.trim();
    const contexto = formulario.dataset.contexto || '';

    if (!descripcion) {
        mostrarToast('Escribe qué ha pasado antes de enviar', 'error');
        return;
    }

    const boton = document.getElementById('btn-enviar-reporte');
    boton.disabled = true;
    boton.textContent = 'Enviando...';

    try {
        // Un solo reintento: quien reporta un fallo ya está molesto, y no le
        // vamos a tener catorce segundos mirando un botón deshabilitado.
        const respuesta = await fetchConReintentos(PREMIUM_CONFIG.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'reportar_bug', descripcion, contacto, contexto }),
            timeout: 20000
        }, 1);

        const resultado = JSON.parse(await respuesta.text());
        if (!resultado.success) throw new Error(resultado.mensaje || 'El servidor rechazó el reporte');

        cerrarModal();
        mostrarToast('Reporte enviado. Gracias por avisar.', 'success');
    } catch (error) {
        // El reporte no se pierde: se ofrece mandarlo por correo normal, con
        // todo ya escrito. Perder lo que alguien acaba de redactar por un fallo
        // de red sería la peor forma de estrenar el formulario de fallos.
        mostrarRespaldoReporteBug(descripcion, contexto, error.message);
    } finally {
        boton.disabled = false;
        boton.textContent = 'Enviar reporte';
    }
}

/** Plan B cuando el envío automático falla: el mismo texto, por correo. */
function mostrarRespaldoReporteBug(descripcion, contexto, motivo) {
    const cuerpo = descripcion + '\n\n────────────\n' + contexto;
    const enlace = 'mailto:' + CORREO_SOPORTE +
        '?subject=' + encodeURIComponent('[TSJ Filing] ' + descripcion.split('\n')[0].slice(0, 70)) +
        '&body=' + encodeURIComponent(cuerpo.slice(0, 1800));

    document.getElementById('modal-titulo').textContent = 'No se pudo enviar';
    document.getElementById('modal-body').innerHTML = `
        <p>El reporte no salió: <strong>${escapeText(motivo)}</strong></p>
        <p style="margin-top: 0.75rem;">
            No se ha perdido nada. Puedes mandarlo por correo con todo ya escrito,
            o copiarlo y pegarlo donde prefieras.
        </p>
        <textarea id="reporte-respaldo" rows="8" readonly
                  style="width: 100%; margin-top: 0.75rem; font-size: 0.8rem;">${escapeText(cuerpo)}</textarea>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="copiarTextoReporte()">📋 Copiar</button>
        <a class="btn btn-primary" href="${escapeText(enlace)}">✉️ Abrir en mi correo</a>
    `;
}

function copiarTextoReporte() {
    const campo = document.getElementById('reporte-respaldo');
    if (!campo) return;
    campo.select();
    navigator.clipboard.writeText(campo.value)
        .then(() => mostrarToast('Reporte copiado', 'success'))
        .catch(() => mostrarToast('Selecciónalo y cópialo con Ctrl+C', 'info'));
}

// ==================== SISTEMA DE ANUNCIOS ====================

// Configuración de anuncios (pueden ser cargados de un servidor o configurados manualmente)
const WHATSAPP_EDICTOS = '529981399930';

const ANUNCIOS_CONFIG = [
    {
        id: 'edictos',
        tipo: 'texto',
        titulo: '📰 Publicación de Edictos en Quintana Roo y Yucatán',
        contenido: 'Judiciales, sucesorios, de remate, notariales y corporativos en periódico de ' +
                   'circulación estatal. Revisamos que el texto coincida con el acuerdo, controlamos ' +
                   'las fechas y los intervalos entre publicaciones, y te entregamos los ejemplares ' +
                   'originales donde aparece tu edicto. Cancún, Chetumal, Playa del Carmen, Cozumel, ' +
                   'Tulum y el resto de Quintana Roo, y también en el estado de Yucatán.',
        llamada: '💬 Consultar por WhatsApp',
        enlace: `https://wa.me/${WHATSAPP_EDICTOS}?text=` + encodeURIComponent(
            'Hola, necesito publicar un edicto en Quintana Roo o Yucatán. ¿Me pueden dar informes?'),
        activo: true
    },
    {
        id: 'ad1',
        tipo: 'texto',
        contenido: '📢 ¿Quieres anunciarte aquí? Contáctanos',
        enlace: 'mailto:frida@empirica.mx?subject=Publicidad en TSJ Filing Online',
        relleno: true,
        activo: true
    },
    {
        id: 'ad2',
        tipo: 'texto',
        contenido: '💼 Espacio publicitario disponible - Llega a abogados de Quintana Roo',
        enlace: 'mailto:frida@empirica.mx?subject=Solicitud de espacio publicitario en TSJ Filing',
        relleno: true,
        activo: true
    },
    {
        id: 'placeholder',
        tipo: 'placeholder',
        contenido: '📢 Espacio disponible para anunciantes',
        enlace: 'mailto:frida@empirica.mx?subject=Anuncio en TSJ Filing Online',
        relleno: true,
        activo: true
    }
];

// Inicializar sistema de anuncios
async function inicializarAnuncios() {
    const ocultarAnuncios = await obtenerConfig('ocultar_anuncios');
    const esPremium = estadoPremium && estadoPremium.activo;

    if (esPremium) {
        // Premium: ocultar anuncios por defecto, mostrar solo si explícitamente quiere
        if (ocultarAnuncios === 'false') {
            // Usuario premium que quiere ver anuncios (raro pero posible)
            document.body.classList.remove('ads-hidden');
            mostrarAnuncios();
        } else {
            // Por defecto, premium no ve anuncios
            document.body.classList.add('ads-hidden');
        }
    } else {
        // No premium: siempre mostrar anuncios
        document.body.classList.remove('ads-hidden');
        mostrarAnuncios();
    }
}

// Mostrar anuncios en los contenedores
function mostrarAnuncios() {
    const anunciosActivos = ANUNCIOS_CONFIG.filter(a => a.activo);
    if (anunciosActivos.length === 0) return;

    const contenedores = Array.from(document.querySelectorAll('.ad-banner'));
    contenedores.forEach((contenedor, i) => {
        contenedor.style.display = 'block';
        const bodyEl = contenedor.querySelector('.ad-body');
        if (bodyEl) {
            bodyEl.innerHTML = generarHTMLAnuncio(
                elegirAnuncio(anunciosActivos, i, contenedores.length));
        }
    });
}

/**
 * Qué anuncio le toca a cada contenedor.
 *
 * Los anuncios de verdad van por delante de los de relleno ("¿quieres
 * anunciarte aquí?"). Antes cada hueco sorteaba entre todos por igual, así que
 * con un anunciante real y tres rellenos el anuncio de pago salía una de cada
 * cuatro veces y daba la impresión de no estar puesto.
 *
 * El último hueco se reserva para el relleno: es de donde salen los
 * anunciantes nuevos y conviene que la invitación siga estando en algún sitio.
 * Si no hay anuncios reales, todos los huecos son de relleno, que es como se
 * comportaba antes.
 */
function elegirAnuncio(anunciosActivos, indice, total) {
    const reales = anunciosActivos.filter(a => !a.relleno);
    const relleno = anunciosActivos.filter(a => a.relleno);

    if (reales.length === 0) return relleno[indice % relleno.length];
    if (relleno.length === 0) return reales[indice % reales.length];

    return indice === total - 1
        ? relleno[Math.floor(Math.random() * relleno.length)]
        : reales[indice % reales.length];
}

// Generar HTML para un anuncio (con sanitización)
function generarHTMLAnuncio(anuncio) {
    // Sanitizar URLs para prevenir javascript: y data: schemes
    const enlaceSanitizado = anuncio.enlace && anuncio.enlace.match(/^https?:\/\//) ? escapeText(anuncio.enlace) : '#';
    const imagenSanitizada = anuncio.imagen && anuncio.imagen.match(/^https?:\/\//) ? escapeText(anuncio.imagen) : '';

    if (anuncio.tipo === 'imagen' && imagenSanitizada) {
        return `
            <a href="${enlaceSanitizado}" target="_blank" rel="noopener noreferrer" class="ad-image-link">
                <img src="${imagenSanitizada}" alt="${escapeText(anuncio.contenido || '')}">
            </a>
        `;
    } else {
        // Un anuncio con titular y llamada a la acción se lee muchísimo mejor
        // que un párrafo largo en una sola línea; los que no los traen siguen
        // saliendo exactamente igual que antes.
        const abrirFuera = enlaceSanitizado.startsWith('http')
            ? 'target="_blank" rel="noopener noreferrer"' : '';
        return `
            <a href="${enlaceSanitizado}" ${abrirFuera} class="ad-text-link${anuncio.titulo ? ' ad-detallado' : ''}">
                ${anuncio.titulo ? `<span class="ad-titulo">${escapeText(anuncio.titulo)}</span>` : ''}
                <span class="ad-text">${escapeText(anuncio.contenido || '')}</span>
                ${anuncio.llamada ? `<span class="ad-llamada">${escapeText(anuncio.llamada)}</span>` : ''}
            </a>
        `;
    }
}

// Mostrar opción de quitar anuncios
function mostrarOpcionQuitarAnuncios(event) {
    event.preventDefault();

    if (estadoPremium && estadoPremium.activo) {
        // Usuario premium - puede quitar anuncios
        if (confirm('¿Deseas ocultar los anuncios? Puedes reactivarlos en Configuración.')) {
            guardarConfig('ocultar_anuncios', 'true');
            document.body.classList.add('ads-hidden');
            mostrarToast('Anuncios ocultados. Puedes reactivarlos en Configuración.', 'success');
        }
    } else {
        // Usuario gratuito - mostrar info de premium
        document.getElementById('modal-titulo').textContent = '⭐ Quitar Anuncios';
        document.getElementById('modal-body').innerHTML = `
            <div style="text-align: center; padding: 1rem;">
                <p style="font-size: 1.1rem; margin-bottom: 1rem;">
                    Los anuncios ayudan a mantener este servicio gratuito.
                </p>
                <p style="margin-bottom: 1.5rem;">
                    Con <strong>Premium</strong> puedes quitar los anuncios y disfrutar de todas las funciones sin límites.
                </p>
                <button class="btn btn-primary btn-lg" onclick="cerrarModal(); mostrarSeccion('configuracion');">
                    ⭐ Ver planes Premium
                </button>
            </div>
        `;
        document.getElementById('modal-footer').innerHTML = `
            <button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>
        `;
        document.getElementById('modal-overlay').classList.add('active');
    }
}

// Toggle anuncios para usuarios premium
async function toggleAnunciosPremium() {
    const checkbox = document.getElementById('config-ocultar-anuncios');
    const ocultar = checkbox.checked;

    await guardarConfig('ocultar_anuncios', ocultar ? 'true' : 'false');

    if (ocultar) {
        document.body.classList.add('ads-hidden');
        mostrarToast('Anuncios ocultados', 'success');
    } else {
        document.body.classList.remove('ads-hidden');
        mostrarAnuncios();
        mostrarToast('Anuncios visibles', 'success');
    }
}

// Inicializar anuncios cuando cambia el estado premium
const actualizarUIPremiumOriginal2 = actualizarUIPremium;
actualizarUIPremium = async function() {
    await actualizarUIPremiumOriginal2();
    await inicializarAnuncios();

    // Mostrar/ocultar opción de quitar anuncios según estado premium
    const opcionAnuncios = document.getElementById('config-anuncios-section');
    if (opcionAnuncios) {
        opcionAnuncios.style.display = estadoPremium.activo ? 'block' : 'none';
    }

    // Actualizar visibilidad de sincronización
    if (typeof actualizarVisibilidadSync === 'function') {
        actualizarVisibilidadSync();
    }

    // Debug: mostrar estado de sync
    Logger.log('Estado Premium:', estadoPremium.activo, '- Sync visible:', estadoPremium.activo);
};

// Inicializar al cargar
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(inicializarAnuncios, 500);
});

// ==================== INTEGRACIÓN PJF FEDERAL ====================

// Restaurar cascada PJF al editar un expediente federal
async function restaurarCascadaPJFParaEdicion(juzgadoNombre, pjfTipoAsunto) {
    if (!juzgadoNombre) return;

    // Ensure PJF catalogs are loaded
    if (!pjfDatosCargados) {
        await cargarCatalogosPJF();
    }

    // Find the organ by name
    const organo = pjfOrganismos.find(o => o.nombre === juzgadoNombre);
    if (!organo) return;

    // Set circuit
    const circuitoSelect = document.getElementById('expediente-circuito-pjf');
    if (circuitoSelect) {
        circuitoSelect.value = organo.circuito_id;
        // Trigger cascade to populate organs
        onExpCircuitoPjfChange();

        // Wait for DOM update, then set organ and populate tipos
        setTimeout(() => {
            const organoSelect = document.getElementById('expediente-organo-pjf');
            if (organoSelect) {
                organoSelect.value = organo.id;
                // Populate tipo de asunto dropdown for this organ
                onExpOrganoPjfChange();

                // Restore tipo de asunto selection if available
                if (pjfTipoAsunto) {
                    setTimeout(() => {
                        const tipoSelect = document.getElementById('expediente-tipo-asunto-pjf');
                        if (tipoSelect) {
                            tipoSelect.value = String(pjfTipoAsunto);
                            if (tipoSelect.value !== String(pjfTipoAsunto)) {
                                // Value not found in options — fall back to manual entry
                                tipoSelect.value = '__manual__';
                                const manualWrap = document.getElementById('expediente-tipo-asunto-manual-wrap');
                                const manualInput = document.getElementById('expediente-tipo-asunto-manual');
                                if (manualWrap) manualWrap.style.display = 'block';
                                if (manualInput) manualInput.value = pjfTipoAsunto;
                            }
                        }
                    }, 50);
                }
            }
        }, 50);
    }
}

// Cambiar institución en el formulario de expediente
function cambiarInstitucionExpediente() {
    const institucion = document.querySelector('input[name="expediente-institucion"]:checked')?.value || 'TSJ';
    const tsjGroup = document.getElementById('juzgado-tsj-group');
    const pjfGroup = document.getElementById('juzgado-pjf-group');
    const otroGroup = document.getElementById('juzgado-otro-group');
    const tsjSelect = document.getElementById('expediente-juzgado');

    // Ocultar todos los grupos primero
    if (tsjGroup) tsjGroup.style.display = 'none';
    if (pjfGroup) pjfGroup.style.display = 'none';
    if (otroGroup) otroGroup.style.display = 'none';
    if (tsjSelect) tsjSelect.removeAttribute('required');
    const tipoAsuntoRow = document.getElementById('tipo-asunto-pjf-row');
    if (tipoAsuntoRow) tipoAsuntoRow.style.display = 'none';

    if (institucion === 'TSJ') {
        if (tsjGroup) tsjGroup.style.display = 'flex';
        if (tsjSelect) tsjSelect.setAttribute('required', '');
    } else if (institucion === 'PJF') {
        if (pjfGroup) pjfGroup.style.display = 'flex';
        poblarCircuitosExpediente();
    } else { // OTRO
        if (otroGroup) otroGroup.style.display = 'flex';
    }
}

// Populate PJF circuits in expediente form
function poblarCircuitosExpediente() {
    const select = document.getElementById('expediente-circuito-pjf');
    if (!select || select.options.length > 1) return;

    // Wait for PJF data to load
    if (!pjfDatosCargados) {
        cargarCatalogosPJF().then(() => {
            llenarCircuitosExpediente(select);
        });
    } else {
        llenarCircuitosExpediente(select);
    }
}

function llenarCircuitosExpediente(select) {
    select.innerHTML = '<option value="">Selecciona un circuito...</option>';
    pjfCircuitos.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.numero_circuito;
        opt.textContent = c.numero_circuito + '. ' + c.nombre;
        select.appendChild(opt);
    });
}

function onExpCircuitoPjfChange() {
    const numCircuito = parseInt(document.getElementById('expediente-circuito-pjf').value);
    const selectOrg = document.getElementById('expediente-organo-pjf');

    selectOrg.innerHTML = '<option value="">Selecciona un órgano...</option>';
    selectOrg.disabled = true;

    // Reset search input
    const orgSearch = document.getElementById('expediente-organo-pjf-search');
    if (orgSearch) { orgSearch.value = ''; orgSearch.style.display = 'none'; }

    // Reset tipo de asunto
    const selectTipo = document.getElementById('expediente-tipo-asunto-pjf');
    if (selectTipo) { selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>'; selectTipo.disabled = true; }
    const tipoRow = document.getElementById('tipo-asunto-pjf-row');
    if (tipoRow) tipoRow.style.display = 'none';
    const manualWrap = document.getElementById('expediente-tipo-asunto-manual-wrap');
    if (manualWrap) manualWrap.style.display = 'none';

    if (!numCircuito) return;

    const organos = pjfOrganismos
        .filter(o => o.circuito_id === numCircuito)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    organos.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.nombre;
        selectOrg.appendChild(opt);
    });

    // Show search input if there are many organs
    if (organos.length > 5 && orgSearch) orgSearch.style.display = 'block';

    selectOrg.disabled = false;
}

function onExpOrganoPjfChange() {
    const orgId = document.getElementById('expediente-organo-pjf').value;
    const selectTipo = document.getElementById('expediente-tipo-asunto-pjf');
    const tipoRow = document.getElementById('tipo-asunto-pjf-row');
    const manualWrap = document.getElementById('expediente-tipo-asunto-manual-wrap');
    const manualInput = document.getElementById('expediente-tipo-asunto-manual');

    if (selectTipo) { selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>'; selectTipo.disabled = true; }
    if (tipoRow) tipoRow.style.display = 'none';
    if (manualWrap) manualWrap.style.display = 'none';
    if (manualInput) manualInput.value = '';

    if (!orgId) return;

    const organo = pjfOrganismos.find(o => String(o.id) === String(orgId));
    if (!organo) return;

    const tipoOrgData = pjfTiposOrgano[organo.tipoOrganismoId];
    const tipos = (tipoOrgData && tipoOrgData.tiposAsuntoArr) ? tipoOrgData.tiposAsuntoArr : [];

    if (selectTipo) {
        if (tipos.length > 0) {
            tipos.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.nombre;
                selectTipo.appendChild(opt);
            });
            const optManual = document.createElement('option');
            optManual.value = '__manual__';
            optManual.textContent = '-- Otro (ID manual) --';
            selectTipo.appendChild(optManual);
            selectTipo.disabled = false;
            selectTipo.onchange = function() {
                if (manualWrap) manualWrap.style.display = this.value === '__manual__' ? 'block' : 'none';
            };
        } else {
            // No catalog for this organ type — show manual entry directly
            if (manualWrap) manualWrap.style.display = 'block';
        }
    }

    if (tipoRow) tipoRow.style.display = 'flex';
}

// Set institution when creating from PJF page
function cambiarInstitucionACrear(inst) {
    setTimeout(() => {
        mostrarFormularioExpediente();
        setTimeout(() => {
            const radio = document.querySelector(`input[name="expediente-institucion"][value="${inst}"]`);
            if (radio) {
                radio.checked = true;
                cambiarInstitucionExpediente();
            }
        }, 100);
    }, 200);
}

// ==================== PJF TABS ====================

function cambiarTabPJF(tab) {
    // Deactivate all tabs
    document.querySelectorAll('.pjf-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pjf-tab-content').forEach(c => c.classList.remove('active'));

    // Activate selected tab
    const tabBtn = document.querySelector(`.pjf-tab[data-pjf-tab="${tab}"]`);
    const tabContent = document.getElementById(`pjf-tab-${tab}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabContent) tabContent.classList.add('active');

    // Load data for the tab
    if (tab === 'expedientes') {
        cargarExpedientesPJF();
    } else if (tab === 'notas') {
        cargarNotasPJF();
    } else if (tab === 'calendario') {
        cargarEventosPJF();
    } else if (tab === 'ia') {
        actualizarSelectExpedientesIAPJF();
    }
}

// ==================== PJF EXPEDIENTES ====================

let vistaExpedientesPJF = localStorage.getItem('vistaExpedientesPJF') || 'cards';

async function cargarExpedientesPJF() {
    const todosExpedientes = await obtenerExpedientes();
    let pjfExps = todosExpedientes.filter(e => e.institucion === 'PJF');
    const lista = document.getElementById('lista-expedientes-pjf');
    const count = document.getElementById('count-expedientes-pjf');

    if (!lista) return;

    // Sort by custom order or date
    pjfExps = [...pjfExps].sort((a, b) => {
        if (a.orden !== undefined && b.orden !== undefined) return a.orden - b.orden;
        if (a.orden !== undefined) return -1;
        if (b.orden !== undefined) return 1;
        return new Date(b.fechaModificacion || b.fechaCreacion || 0) - new Date(a.fechaModificacion || a.fechaCreacion || 0);
    });

    const totalPJF = pjfExps.length;

    // Límite compartido: cupo disponible para PJF = total límite - cuántos TSJ hay
    const esPremium = estadoPremium && estadoPremium.activo;
    let mostrandoLimitadosPJF = false;

    if (!esPremium) {
        const noPJFCount = todosExpedientes.filter(exp => exp.institucion !== 'PJF').length;
        const limiteDisponiblePJF = Math.max(0, PREMIUM_CONFIG.limiteExpedientes - noPJFCount);
        if (totalPJF > limiteDisponiblePJF) {
            pjfExps = pjfExps.slice(0, limiteDisponiblePJF);
            mostrandoLimitadosPJF = true;
        }
    }

    if (pjfExps.length === 0 && totalPJF === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🏛️</span>
                <h3>No hay expedientes federales</h3>
                <p>Busca un expediente en el PJF y guárdalo, o crea uno desde la pestaña de Expedientes.</p>
                <button class="btn btn-primary" onclick="navegarA('expedientes'); cambiarInstitucionACrear('PJF')">
                    ➕ Agregar Expediente PJF
                </button>
            </div>
        `;
        if (count) count.textContent = '0 expedientes';
        return;
    }

    if (pjfExps.length === 0 && mostrandoLimitadosPJF) {
        lista.innerHTML = `
            <div style="background: #fff3cd; padding: 0.75rem; border-radius: 6px; font-size: 0.875rem;">
                ⚠️ El límite gratuito de ${PREMIUM_CONFIG.limiteExpedientes} expedientes compartidos ya está completo con expedientes TSJ.
                <a href="#" onclick="mostrarSeccion('configuracion'); return false;">Activar Premium</a> para expedientes ilimitados.
            </div>
        `;
        if (count) count.textContent = `0 / ${PREMIUM_CONFIG.limiteExpedientes} disponibles`;
        return;
    }

    let advertenciaPJFHTML = '';
    if (mostrandoLimitadosPJF) {
        advertenciaPJFHTML = `
            <div style="background: #fff3cd; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.5rem; font-size: 0.8rem;">
                ⚠️ Mostrando solo ${pjfExps.length} de ${totalPJF} expedientes PJF (límite compartido de ${PREMIUM_CONFIG.limiteExpedientes} entre TSJ y PJF).
                <a href="#" onclick="mostrarSeccion('configuracion'); return false;">Activar Premium</a>
            </div>
        `;
    }

    lista.innerHTML = advertenciaPJFHTML + pjfExps.map((exp, index) =>
        renderTarjetaExpedienteHTML(exp, {
            institucion: 'PJF',
            draggable: true,
            orden: exp.orden || index,
            selectable: !!modoSeleccionPJF,
            selected: expedientesPJFSeleccionados.has(exp.id),
            showSearchBtn: true,
            editarFn: 'editarExpedientePJF',
            eliminarFn: 'confirmarEliminarExpedientePJF'
        })
    ).join('');

    // Populate table view
    const tablaBody = document.getElementById('tabla-expedientes-body-pjf');
    if (tablaBody) {
        tablaBody.innerHTML = pjfExps.map(exp =>
            renderFilaExpedienteHTML(exp, {
                institucion: 'PJF',
                showInstColumn: false,
                showSearchBtn: true,
                editarFn: 'editarExpedientePJF',
                eliminarFn: 'confirmarEliminarExpedientePJF'
            })
        ).join('');
    }

    // Initialize drag and drop for PJF
    inicializarDragAndDropPJF();

    if (count) count.textContent = mostrandoLimitadosPJF
        ? `${pjfExps.length} de ${totalPJF} expediente${totalPJF !== 1 ? 's' : ''} (limitado)`
        : `${totalPJF} expediente${totalPJF !== 1 ? 's' : ''}`;

    // Apply current view
    aplicarVistaExpedientesPJF();

    // Actualizar badge de archivo PJF
    actualizarBadgeArchivoPJF();
}

// Edit PJF expediente - navigate to main form and restore cascade
async function editarExpedientePJF(id, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }

    // Navigate to expedientes page to access the form
    navegarA('expedientes');

    // Small delay to let the page render
    setTimeout(async () => {
        await editarExpediente(id);
    }, 150);
}

// Delete PJF expediente and refresh PJF view
async function confirmarEliminarExpedientePJF(id, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }

    const aviso = await _avisoDependientesExpediente(id);
    if (!confirm('¿Estás seguro de eliminar este expediente federal?' + aviso)) return;

    try {
        await eliminarExpedienteCore(id, true);
        mostrarToast('Expediente PJF eliminado', 'success');
        await cargarExpedientesPJF();
    } catch (err) {
        Logger.error('Error al eliminar expediente PJF:', err);
        mostrarToast('Error al eliminar: ' + (err.message || 'Error desconocido'), 'error');
    }
}

// ==================== ARCHIVO PJF ====================

function abrirArchivoPJF() {
    document.getElementById('lista-expedientes-pjf').style.display = 'none';
    document.getElementById('tabla-expedientes-pjf').style.display = 'none';
    document.getElementById('archivo-toggle-pjf').style.display = 'none';

    // Ocultar barra de selección masiva si existe
    const selBar = document.getElementById('pjf-seleccion-bar');
    if (selBar) selBar.style.display = 'none';

    document.getElementById('archivo-section-pjf').style.display = 'block';
    cargarArchivoPJF();
}

function cerrarArchivoPJF() {
    document.getElementById('archivo-section-pjf').style.display = 'none';
    document.getElementById('archivo-toggle-pjf').style.display = 'block';
    aplicarVistaExpedientesPJF();
}

async function cargarArchivoPJF() {
    return _cargarArchivoComun({
        listaId: 'lista-archivo-pjf',
        countId: 'count-archivo-pjf',
        soloPJF: true,
        mensajeVacio: 'No hay expedientes PJF archivados'
    });
}

async function filtrarArchivoPJF() {
    return _filtrarArchivoComun({
        listaId: 'lista-archivo-pjf',
        countId: 'count-archivo-pjf',
        soloPJF: true,
        busquedaId: 'buscar-archivo-pjf',
        motivoId: 'filtro-motivo-archivo-pjf',
        mensajeSinResultados: 'No se encontraron expedientes PJF archivados con esos filtros'
    });
}

async function actualizarBadgeArchivoPJF() {
    return _actualizarBadgeArchivoComun('count-archivo-badge-pjf', true);
}

// Abrir búsqueda en PJF para un expediente guardado
// Estado temporal para el picker de tipo de asunto PJF
let _pendingPJFExp = null;

async function abrirBusquedaPJFGuardado(id, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }

    // Asegurar catálogos cargados para resolver orgId por nombre
    await cargarCatalogosPJF();

    const expedientes = await obtenerExpedientes();
    const exp = expedientes.find(e => e.id === id);
    if (!exp || !exp.numero) {
        mostrarToast('Este expediente no tiene número registrado', 'warning');
        return;
    }

    // Resolver orgId: usar el guardado o buscar por nombre en el catálogo
    let orgId = exp.pjfOrgId;
    if (!orgId && exp.juzgado) {
        const organo = pjfOrganismos.find(o => o.nombre === exp.juzgado);
        orgId = organo ? String(organo.id) : '';
    }

    // Si tenemos todo, abrir popup directamente
    if (orgId && exp.pjfTipoAsunto) {
        _abrirPopupPJF(orgId, exp.pjfTipoAsunto, exp.numero);
        return;
    }

    // Falta algún dato: mostrar picker usando el modal existente
    _pendingPJFExp = { ...exp, _resolvedOrgId: orgId };

    // Resolver tipos de asunto: por tipoOrganismoId del órgano (catálogo completo)
    let tiposDisponibles = [];
    if (orgId) {
        const organoEncontrado = pjfOrganismos.find(o => String(o.id) === String(orgId));
        if (organoEncontrado && organoEncontrado.tipoOrganismoId) {
            const tipoOrgData = pjfTiposOrgano[organoEncontrado.tipoOrganismoId];
            if (tipoOrgData) {
                // tiposAsuntoArr es el array fusionado (unión) por TipoOrganismoId
                tiposDisponibles = tipoOrgData.tiposAsuntoArr || [];
            }
        }
    }
    // Fallback: buscar por nombre si todavía está vacío
    if (tiposDisponibles.length === 0 && exp.juzgado) {
        const organoNombre = pjfOrganismos.find(o => o.nombre === exp.juzgado);
        if (organoNombre) {
            const tipoOrgData = pjfTiposOrgano[organoNombre.tipoOrganismoId];
            if (tipoOrgData) tiposDisponibles = tipoOrgData.tiposAsuntoArr || [];
        }
    }

    const tiposOptionsHTML = [
        ...tiposDisponibles.map(t => `<option value="${t.id}">${escapeText(t.nombre)}</option>`),
        '<option value="__manual__">Otro (ingresar ID manualmente)</option>'
    ].join('');

    const needsOrgId = !orgId;

    document.getElementById('modal-titulo').textContent = '🔍 Abrir Expediente en PJF';
    document.getElementById('modal-body').innerHTML = `
        <p style="margin-bottom:1rem;">
            <strong>${escapeText(exp.numero)}</strong><br>
            <small style="color:var(--text-secondary);">${escapeText(exp.juzgado || '')}</small>
        </p>
        ${needsOrgId ? `
        <div class="form-group">
            <label for="_pjf-pick-org">ID de Organismo</label>
            <input type="number" id="_pjf-pick-org" class="form-control" placeholder="Ej: 12345" min="1">
            <span class="form-help">ID numérico del órgano en el portal SISE/DGEJ</span>
        </div>` : ''}
        <div class="form-group">
            <label for="_pjf-pick-tipo">Tipo de Asunto</label>
            <select id="_pjf-pick-tipo" class="form-control"
                onchange="document.getElementById('_pjf-pick-manual-wrap').style.display=this.value==='__manual__'?'block':'none'">
                ${tiposOptionsHTML}
            </select>
            <div id="_pjf-pick-manual-wrap" style="display:none;margin-top:0.5rem;">
                <input type="number" id="_pjf-pick-tipo-manual" class="form-control"
                    placeholder="ID numérico del tipo de asunto" min="1">
            </div>
        </div>
        <p class="form-help" style="margin-top:0.5rem;">El valor se guardará para búsquedas futuras.</p>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="_confirmarAbrirPJF()">🔍 Abrir en PJF</button>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

function _abrirPopupPJF(orgId, tipoAsunto, expediente) {
    const url = (typeof construirURLPJF === 'function')
        ? construirURLPJF(orgId, tipoAsunto, expediente, 0)
        : PJF_VERCAPTURA_URL +
          '?tipoasunto=' + encodeURIComponent(tipoAsunto) +
          '&organismo=' + encodeURIComponent(orgId) +
          '&expediente=' + encodeURIComponent(expediente) +
          '&tipoprocedimiento=0';
    window.open(url, '_blank', 'width=1024,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no');
    mostrarToast(`Abriendo ${expediente} en PJF...`, 'success');
}

async function _confirmarAbrirPJF() {
    if (!_pendingPJFExp) return;

    const tipoSelect = document.getElementById('_pjf-pick-tipo');
    const tipoManual = document.getElementById('_pjf-pick-tipo-manual');
    const orgInput = document.getElementById('_pjf-pick-org');

    let tipoAsunto = tipoSelect?.value || '';
    if (tipoAsunto === '__manual__') tipoAsunto = tipoManual?.value.trim() || '';
    const orgId = _pendingPJFExp._resolvedOrgId || orgInput?.value.trim() || '';

    if (!tipoAsunto || !orgId) {
        mostrarToast('Completa todos los campos requeridos', 'warning');
        return;
    }

    // Guardar para no preguntar de nuevo
    try {
        await actualizarExpediente(_pendingPJFExp.id, { pjfTipoAsunto: tipoAsunto, pjfOrgId: orgId });
    } catch (e) {
        Logger.warn('No se pudo guardar metadatos PJF:', e);
    }

    cerrarModal();
    _abrirPopupPJF(orgId, tipoAsunto, _pendingPJFExp.numero);
    _pendingPJFExp = null;
}

// PJF view toggle
function cambiarVistaExpedientesPJF(vista) {
    vistaExpedientesPJF = vista;
    try { localStorage.setItem('vistaExpedientesPJF', vista); } catch (e) {}

    document.querySelectorAll('.pjf-view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === vista);
    });

    aplicarVistaExpedientesPJF();
    // Re-renderizar el contenido para la nueva vista.
    filtrarExpedientesPJF();
}

function aplicarVistaExpedientesPJF() {
    const listaCards = document.getElementById('lista-expedientes-pjf');
    const tablaContainer = document.getElementById('tabla-expedientes-pjf');

    if (vistaExpedientesPJF === 'table') {
        if (listaCards) listaCards.style.display = 'none';
        if (tablaContainer) tablaContainer.style.display = 'block';
    } else {
        if (listaCards) listaCards.style.display = 'grid';
        if (tablaContainer) tablaContainer.style.display = 'none';
    }
}

// PJF search/filter
async function filtrarExpedientesPJF() {
    const busqueda = (document.getElementById('buscar-expediente-pjf')?.value || '').toLowerCase();
    const carpetaFiltro = document.getElementById('filtro-carpeta-pjf')?.value || '';
    const expedientes = await obtenerExpedientes();
    let pjfExps = expedientes.filter(e => e.institucion === 'PJF');

    if (carpetaFiltro === '__sin__') {
        pjfExps = pjfExps.filter(e => e.carpetaId === undefined || e.carpetaId === null);
    } else if (carpetaFiltro) {
        const cid = parseInt(carpetaFiltro, 10);
        pjfExps = pjfExps.filter(e => e.carpetaId === cid);
    }

    if (busqueda) {
        const { notasPorExp, historialPorExp, pendientesPorExp } = await obtenerIndiceBusqueda();

        pjfExps = pjfExps.filter(e => {
            if ((e.numero && e.numero.toLowerCase().includes(busqueda)) ||
                (e.nombre && e.nombre.toLowerCase().includes(busqueda)) ||
                (e.juzgado && e.juzgado.toLowerCase().includes(busqueda)) ||
                (e.comentario && e.comentario.toLowerCase().includes(busqueda)) ||
                (e.categoria && e.categoria.toLowerCase().includes(busqueda))) {
                return true;
            }
            const notas = notasPorExp.get(e.id);
            if (notas) {
                for (const n of notas) {
                    if ((n.titulo && n.titulo.toLowerCase().includes(busqueda)) ||
                        (n.contenido && n.contenido.toLowerCase().includes(busqueda))) {
                        return true;
                    }
                }
            }
            const pendientes = pendientesPorExp.get(e.id);
            if (pendientes) {
                for (const p of pendientes) {
                    if ((p.titulo && p.titulo.toLowerCase().includes(busqueda)) ||
                        (p.descripcion && p.descripcion.toLowerCase().includes(busqueda))) {
                        return true;
                    }
                }
            }
            const historial = historialPorExp.get(e.id);
            if (historial) {
                for (const h of historial) {
                    if ((h.descripcion && h.descripcion.toLowerCase().includes(busqueda)) ||
                        (h.detalle && h.detalle.toLowerCase().includes(busqueda))) {
                        return true;
                    }
                }
            }
            return false;
        });
    }

    const lista = document.getElementById('lista-expedientes-pjf');
    const count = document.getElementById('count-expedientes-pjf');

    if (pjfExps.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🔍</span>
                <h3>Sin resultados</h3>
                <p>No se encontraron expedientes PJF con esos filtros</p>
            </div>
        `;
        // Also clear table
        const tablaBody = document.getElementById('tabla-expedientes-body-pjf');
        if (tablaBody) tablaBody.innerHTML = '';
    } else {
        // Renderizar solo la vista activa (cards o tabla) para no duplicar trabajo.
        if (vistaExpedientesPJF === 'table') {
            const tablaBody = document.getElementById('tabla-expedientes-body-pjf');
            if (tablaBody) {
                tablaBody.innerHTML = pjfExps.map(exp =>
                    renderFilaExpedienteHTML(exp, {
                        institucion: 'PJF',
                        showInstColumn: false,
                        showSearchBtn: true,
                        editarFn: 'editarExpedientePJF',
                        eliminarFn: 'confirmarEliminarExpedientePJF'
                    })
                ).join('');
            }
        } else {
            lista.innerHTML = pjfExps.map((exp, index) =>
                renderTarjetaExpedienteHTML(exp, {
                    institucion: 'PJF',
                    draggable: true,
                    orden: exp.orden || index,
                    showSearchBtn: true,
                    editarFn: 'editarExpedientePJF',
                    eliminarFn: 'confirmarEliminarExpedientePJF'
                })
            ).join('');

            inicializarDragAndDropPJF();
        }
    }

    if (count) count.textContent = `${pjfExps.length} expediente${pjfExps.length !== 1 ? 's' : ''}`;
}

// Drag and Drop for PJF expedientes
let draggedElementPJF = null;

function inicializarDragAndDropPJF() {
    const lista = document.getElementById('lista-expedientes-pjf');
    if (!lista) return;
    const cards = lista.querySelectorAll('.expediente-card');

    cards.forEach(card => {
        card.addEventListener('dragstart', handleDragStartPJF);
        card.addEventListener('dragend', handleDragEndPJF);
        card.addEventListener('dragover', handleDragOverPJF);
        card.addEventListener('dragenter', handleDragEnterPJF);
        card.addEventListener('dragleave', handleDragLeavePJF);
        card.addEventListener('drop', handleDropPJF);
    });
}

function handleDragStartPJF(e) {
    draggedElementPJF = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEndPJF() {
    this.classList.remove('dragging');
    document.querySelectorAll('#lista-expedientes-pjf .expediente-card').forEach(c => c.classList.remove('drag-over'));
    draggedElementPJF = null;
}

function handleDragOverPJF(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnterPJF(e) {
    e.preventDefault();
    if (this !== draggedElementPJF) this.classList.add('drag-over');
}

function handleDragLeavePJF() {
    this.classList.remove('drag-over');
}

async function handleDropPJF(e) {
    e.preventDefault();
    this.classList.remove('drag-over');

    if (draggedElementPJF && draggedElementPJF !== this) {
        const lista = document.getElementById('lista-expedientes-pjf');
        const cards = [...lista.querySelectorAll('.expediente-card')];
        const fromIndex = cards.indexOf(draggedElementPJF);
        const toIndex = cards.indexOf(this);

        if (fromIndex < toIndex) {
            this.parentNode.insertBefore(draggedElementPJF, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedElementPJF, this);
        }

        // Save new order
        const nuevasCards = [...lista.querySelectorAll('.expediente-card')];
        for (let i = 0; i < nuevasCards.length; i++) {
            const id = parseInt(nuevasCards[i].dataset.id);
            await actualizarExpediente(id, { orden: i });
        }
    }
}

// ==================== PJF SEARCH AND SAVE ====================

async function ejecutarBusquedaPJFyGuardar() {
    const orgSelect = document.getElementById('pjf-organismo');
    const orgId = orgSelect.value;
    const orgNombre = orgSelect.options[orgSelect.selectedIndex]?.text || '';
    const expediente = document.getElementById('pjf-num-expediente').value.trim();

    if (!orgId || !expediente) {
        mostrarToast('Completa el organismo y número de expediente', 'warning');
        return;
    }

    // Check if this expediente already exists
    const expedientes = await obtenerExpedientes();
    const existente = expedientes.find(e =>
        e.numero && e.numero.toLowerCase() === expediente.toLowerCase() &&
        e.institucion === 'PJF'
    );

    if (existente) {
        mostrarToast(`El expediente PJF "${expediente}" ya está guardado`, 'info');
    } else {
        // Create new PJF expediente
        const selectTipo = document.getElementById('pjf-tipo-asunto');
        const manualTipo = document.getElementById('pjf-tipo-asunto-manual-input');
        let tipoAsuntoGuardado = selectTipo?.value || '';
        if (tipoAsuntoGuardado === '__manual__' || !tipoAsuntoGuardado) {
            tipoAsuntoGuardado = manualTipo?.value.trim() || '';
        }

        const nuevoExp = {
            numero: expediente,
            juzgado: orgNombre,
            pjfOrgId: orgId,
            pjfTipoAsunto: tipoAsuntoGuardado || undefined,
            categoria: 'PJF Federal',
            institucion: 'PJF',
            comentario: `Expediente federal - ${orgNombre}`
        };

        await agregarExpediente(nuevoExp);
        mostrarToast(`Expediente PJF "${expediente}" guardado`, 'success');
        await cargarExpedientes();
        await cargarExpedientesPJF();
        await cargarEstadisticas();
    }

    // Also execute the search
    ejecutarBusquedaPJF();
}

// ==================== PJF NOTAS ====================

async function cargarNotasPJF() {
    const notas = await obtenerNotas();
    const expedientes = await obtenerExpedientes();
    const pjfExpIds = new Set(expedientes.filter(e => e.institucion === 'PJF').map(e => e.id));

    // Filter notes linked to PJF expedientes or with PJF institution
    const notasPJF = notas.filter(n =>
        n.institucion === 'PJF' ||
        (n.expedienteId && pjfExpIds.has(n.expedienteId))
    );

    const lista = document.getElementById('lista-notas-pjf');
    if (!lista) return;

    const expMap = Object.fromEntries(expedientes.map(e => [e.id, e]));

    if (notasPJF.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📒</span>
                <h3>No hay notas federales</h3>
                <p>Las notas de expedientes PJF aparecerán aquí.</p>
            </div>
        `;
        return;
    }

    lista.innerHTML = notasPJF.map(nota => {
        const exp = expMap[nota.expedienteId];
        return `
            <div class="nota-card" style="background-color: ${escapeText(nota.color || '#fff3cd')}" onclick="editarNota(${nota.id})">
                <div class="nota-header">
                    <h3 class="nota-titulo">${escapeText(nota.titulo)}</h3>
                    <span class="institucion-badge pjf" style="font-size: 0.7rem;">🏛️ PJF</span>
                </div>
                <p class="nota-contenido">${escapeText(nota.contenido || 'Sin contenido')}</p>
                <div class="nota-footer">
                    <span class="nota-expediente">📁 ${exp ? escapeText(exp.numero || exp.nombre) : (nota.expedienteTexto || 'Sin expediente')}</span>
                    <span class="nota-fecha">${formatearFecha(nota.fechaCreacion)}</span>
                </div>
            </div>
        `;
    }).join('');
}

function mostrarFormularioNotaPJF() {
    // Use the same nota form but pre-filter PJF expedientes
    mostrarFormularioNota();
    // The form is loaded async, so we need to wait
    setTimeout(() => {
        document.getElementById('modal-titulo').textContent = 'Nueva Nota PJF';
    }, 200);
}

// ==================== PJF EVENTOS ====================

async function cargarEventosPJF() {
    const eventos = await obtenerEventos();
    const expedientes = await obtenerExpedientes();
    const pjfExpIds = new Set(expedientes.filter(e => e.institucion === 'PJF').map(e => e.id));

    // Filter events linked to PJF expedientes or with PJF institution
    const eventosPJF = eventos.filter(e =>
        e.institucion === 'PJF' ||
        (e.expedienteId && pjfExpIds.has(e.expedienteId))
    ).sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

    const lista = document.getElementById('lista-eventos-pjf');
    if (!lista) return;

    if (eventosPJF.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📭</span>
                <h3>No hay eventos federales</h3>
                <p>Los eventos de expedientes PJF aparecerán aquí y en el calendario principal.</p>
            </div>
        `;
        return;
    }

    lista.innerHTML = eventosPJF.map(e => {
        const fecha = new Date(e.fechaInicio);
        const fechaTexto = fecha.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        const horaTexto = e.todoElDia ? 'Todo el día' :
            fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        const iaBadge = e.origenIA
            ? '<span style="font-size:0.6rem; margin-left:0.3rem; background:#e0e7ff; color:#3730a3; padding:1px 6px; border-radius:8px;" title="Creado desde análisis IA">🤖 IA</span>'
            : '';
        const expLabel = e.numeroExpediente || e.expedienteTexto || (e.expedienteId ? `#${e.expedienteId}` : '');
        const expLinea = expLabel
            ? `<span style="font-size:0.72rem; color:#555; display:block; margin-top:2px;">📂 Exp. ${escapeText(expLabel)}</span>`
            : '';

        return `
            <div class="evento-item" onclick="editarEvento(${e.id})" style="border-left: 3px solid ${escapeText(e.color || '#3788d8')}">
                <div class="evento-info">
                    <span class="evento-titulo">${escapeText(e.titulo)}${iaBadge}</span>
                    <span class="evento-hora">${fechaTexto} - ${horaTexto}</span>
                    ${expLinea}
                </div>
                <span class="institucion-badge pjf" style="font-size: 0.65rem;">🏛️ PJF</span>
            </div>
        `;
    }).join('');
}

// ==================== PJF IA ANALYSIS ====================

let resultadosIAPJFActuales = null;
let imagenAcuerdoPJFActual = null;

async function procesarImagenAcuerdoPJF(event) {
    const file = event.target.files[0];
    if (!file) return;

    const previewContainer = document.getElementById('ia-imagen-preview-pjf');
    const previewImg = document.getElementById('ia-imagen-preview-img-pjf');

    const reader = new FileReader();
    reader.onload = async (e) => {
        previewImg.src = e.target.result;
        previewContainer.style.display = 'block';
        imagenAcuerdoPJFActual = e.target.result;

        // Extract text using OCR directly into PJF textarea
        const statusEl = document.getElementById('ia-ocr-status-pjf');
        if (statusEl) statusEl.style.display = 'flex';

        await extraerTextoConTesseract(e.target.result, 'ia-texto-acuerdo-pjf', 'ia-ocr-status-pjf');

        if (statusEl) statusEl.style.display = 'none';
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

function eliminarImagenAcuerdoPJF() {
    const previewContainer = document.getElementById('ia-imagen-preview-pjf');
    const input = document.getElementById('ia-imagen-album-pjf');
    previewContainer.style.display = 'none';
    if (input) input.value = '';
    imagenAcuerdoPJFActual = null;
}

async function actualizarSelectExpedientesIAPJF() {
    const expedientes = await obtenerExpedientes();
    const pjfExps = expedientes.filter(e => e.institucion === 'PJF');
    const select = document.getElementById('iapjf-expediente');
    if (select) {
        select.innerHTML = '<option value="">Sin expediente específico</option>' +
            '<option value="__custom__">✏️ Otro (escribir manualmente)</option>' +
            pjfExps.map(e => `<option value="${e.id}">${e.numero || e.nombre} - ${e.juzgado}</option>`).join('');
    }
}

async function analizarAcuerdoConIAPJF() {
    const texto = document.getElementById('ia-texto-acuerdo-pjf').value.trim();
    const expedienteSelect = document.getElementById('iapjf-expediente').value;
    const expedienteCustom = document.getElementById('iapjf-expediente-custom')?.value?.trim() || '';
    const apiKey = await obtenerConfig('ia_api_key');

    let expedienteId = null;
    let expedienteTexto = null;

    if (expedienteSelect === '__custom__' && expedienteCustom) {
        expedienteTexto = expedienteCustom;
    } else if (expedienteSelect && expedienteSelect !== '__custom__' && expedienteSelect !== '') {
        expedienteId = expedienteSelect;
    }

    if (!texto) {
        mostrarToast('Pega el texto del acuerdo federal a analizar', 'warning');
        return;
    }

    if (!apiKey) {
        mostrarToast('Configura tu API Key de Gemini en Configuración', 'warning');
        return;
    }

    const btn = document.getElementById('btn-analizar-ia-pjf');
    btn.innerHTML = '<span class="loading-spinner"></span> Analizando...';
    btn.classList.add('loading');

    const prompt = `Analiza el siguiente acuerdo judicial del Poder Judicial de la Federación (PJF) y extrae la información importante.

TEXTO DEL ACUERDO:
${texto}

Responde ÚNICAMENTE en formato JSON con la siguiente estructura (sin explicaciones adicionales):
{
    "numero_expediente": "Número de expediente mencionado en el acuerdo (ej: 67/2021, Amparo 123/2024) o null",
    "juzgado_origen": "Nombre del juzgado, tribunal o órgano federal que emite el acuerdo, o null",
    "institucion": "PJF",
    "resumen": "Resumen breve del acuerdo en 1-2 oraciones",
    "tipo_acuerdo": "admisión|sentencia|auto|citación|notificación|amparo|otro",
    "fechas": [
        {
            "tipo": "audiencia|vencimiento|cita|otro",
            "fecha": "YYYY-MM-DD",
            "hora": "HH:MM o null si no aplica",
            "descripcion": "Descripción del evento"
        }
    ],
    "puntos_importantes": ["Punto importante 1"],
    "acciones_requeridas": ["Acción requerida"],
    "montos": [{"concepto": "Descripción", "cantidad": "$X,XXX.XX"}]
}

IMPORTANTE: Siempre intenta extraer el número de expediente del texto. Busca patrones como "Expediente:", "Exp.", "Amparo:", "Juicio:", "Toca:", seguidos de un número. También identifica el órgano jurisdiccional federal.
Si algún campo no tiene información, usa un array vacío [] o null.`;

    try {
        const resultado = _extraerJSON(await llamarIA(prompt));
        resultado.expedienteId = expedienteId ? parseInt(expedienteId) : null;
        resultado.expedienteTexto = expedienteTexto || null;
        resultado.institucion = 'PJF'; // Force PJF

        // Show results using the same display function
        mostrarResultadosIAPJF(resultado);
        resultadosIAPJFActuales = resultado;

        mostrarToast('Análisis PJF completado', 'success');
    } catch (error) {
        Logger.error('Error al analizar PJF:', error);
        mostrarToast('Error: ' + error.message, 'error');
    } finally {
        btn.innerHTML = '🤖 Analizar con IA';
        btn.classList.remove('loading');
    }
}

function mostrarResultadosIAPJF(resultado) {
    const container = document.getElementById('resultados-ia-contenido-pjf');
    // Reuse the same display logic
    let html = '';

    if (resultado.numero_expediente) {
        html += `
            <div class="ia-resultado-item" style="background: #e3f2fd; border-left: 4px solid #1976d2; padding: 0.75rem;">
                <h4>🔢 Expediente Federal Detectado</h4>
                <p><strong>Número:</strong> ${escapeText(resultado.numero_expediente)}</p>
                ${resultado.juzgado_origen ? `<p><strong>Órgano:</strong> ${escapeText(resultado.juzgado_origen)}</p>` : ''}
                <p><strong>Institución:</strong> 🏛️ PJF Federal</p>
            </div>
        `;
    }

    if (resultado.resumen) {
        html += `
            <div class="ia-resultado-item">
                <h4>📋 Resumen</h4>
                <p>${escapeText(resultado.resumen)}</p>
                <p><small>Tipo: ${escapeText(resultado.tipo_acuerdo || 'No especificado')}</small></p>
            </div>
        `;
    }

    if (resultado.fechas && resultado.fechas.length > 0) {
        html += `<div class="ia-resultado-item"><h4>📅 Fechas y Eventos Detectados</h4>`;
        resultado.fechas.forEach((fecha, i) => {
            const fechaStr = escapeText(fecha.fecha) + (fecha.hora ? ` a las ${escapeText(fecha.hora)}` : '');
            html += `
                <div class="ia-resultado-check">
                    <input type="checkbox" id="ia-pjf-fecha-${i}" checked>
                    <label for="ia-pjf-fecha-${i}">
                        <strong>${escapeText(fecha.tipo?.toUpperCase() || '')}:</strong> ${escapeText(fecha.descripcion)}
                        <br><small>📆 ${fechaStr}</small>
                    </label>
                </div>
            `;
        });
        html += `</div>`;
    }

    if (resultado.puntos_importantes && resultado.puntos_importantes.length > 0) {
        html += `<div class="ia-resultado-item"><h4>⚠️ Puntos Importantes</h4>`;
        resultado.puntos_importantes.forEach((punto, i) => {
            html += `
                <div class="ia-resultado-check">
                    <input type="checkbox" id="ia-pjf-punto-${i}" checked>
                    <label for="ia-pjf-punto-${i}">${escapeText(punto)}</label>
                </div>
            `;
        });
        html += `</div>`;
    }

    if (resultado.acciones_requeridas && resultado.acciones_requeridas.length > 0) {
        html += `<div class="ia-resultado-item"><h4>✅ Acciones Requeridas</h4>`;
        resultado.acciones_requeridas.forEach((accion, i) => {
            html += `
                <div class="ia-resultado-check">
                    <input type="checkbox" id="ia-pjf-accion-${i}" checked>
                    <label for="ia-pjf-accion-${i}">${escapeText(accion)}</label>
                </div>
            `;
        });
        html += `</div>`;
    }

    if (resultado.montos && resultado.montos.length > 0) {
        html += `<div class="ia-resultado-item"><h4>💰 Montos</h4>`;
        resultado.montos.forEach(m => {
            html += `<p><strong>${escapeText(m.concepto)}:</strong> ${escapeText(m.cantidad)}</p>`;
        });
        html += `</div>`;
    }

    container.innerHTML = html || '<p>No se encontró información relevante.</p>';
    document.getElementById('resultados-ia-pjf').style.display = 'block';
}

async function guardarResultadosIAPJF() {
    if (!resultadosIAPJFActuales) return;

    const resultado = resultadosIAPJFActuales;
    resultado.institucion = 'PJF';
    let guardados = 0;

    const numExpExtraido = resultado.numero_expediente || null;
    const juzgadoExtraido = resultado.juzgado_origen || null;

    if (numExpExtraido && !resultado.expedienteId && !resultado.expedienteTexto) {
        resultado.expedienteTexto = numExpExtraido;
    }

    // Create/link PJF expediente
    if (resultado.expedienteTexto && !resultado.expedienteId) {
        try {
            const expedientes = await obtenerExpedientes();
            const existente = expedientes.find(e =>
                e.institucion === 'PJF' &&
                ((e.numero && e.numero.toLowerCase() === resultado.expedienteTexto.toLowerCase()) ||
                 (e.nombre && e.nombre.toLowerCase() === resultado.expedienteTexto.toLowerCase()))
            );

            if (existente) {
                resultado.expedienteId = existente.id;
                mostrarToast(`Expediente PJF "${resultado.expedienteTexto}" ya existe, vinculando...`, 'info');
            } else {
                const nuevoExp = {
                    numero: resultado.expedienteTexto,
                    juzgado: juzgadoExtraido || 'PJF - Por determinar',
                    categoria: 'PJF Federal',
                    institucion: 'PJF',
                    comentario: `Creado desde análisis IA PJF${juzgadoExtraido ? ' - ' + juzgadoExtraido : ''}`
                };
                const idNuevo = await agregarExpediente(nuevoExp);
                resultado.expedienteId = idNuevo;
                guardados++;
                mostrarToast(`Expediente PJF "${resultado.expedienteTexto}" creado`, 'success');
            }
        } catch (e) {
            Logger.error('Error al crear expediente PJF:', e);
        }
    }

    let expedienteLabel = '';
    if (resultado.expedienteId) {
        const exp = await obtenerExpediente(resultado.expedienteId);
        if (exp) expedienteLabel = exp.numero || exp.nombre || '';
    } else if (resultado.expedienteTexto) {
        expedienteLabel = resultado.expedienteTexto;
    } else if (numExpExtraido) {
        expedienteLabel = numExpExtraido;
    }

    // Save events con hora normalizada y contexto completo del acuerdo PJF
    if (resultado.fechas) {
        for (let i = 0; i < resultado.fechas.length; i++) {
            const checkbox = document.getElementById(`ia-pjf-fecha-${i}`);
            if (checkbox && checkbox.checked) {
                const fecha = resultado.fechas[i];
                try {
                    const evento = construirEventoIA(fecha, {
                        expedienteId: resultado.expedienteId,
                        expedienteTexto: resultado.expedienteTexto || numExpExtraido,
                        expedienteLabel,
                        institucion: 'PJF',
                        juzgadoOrigen: juzgadoExtraido,
                        tipoAcuerdo: resultado.tipo_acuerdo,
                        resumen: resultado.resumen
                    });
                    await agregarEvento(evento);
                    guardados++;
                } catch (e) {
                    Logger.error('Error al guardar evento PJF:', e);
                    mostrarToast('Una fecha del acuerdo PJF no se pudo guardar (fecha inválida)', 'warning');
                }
            }
        }
    }

    // Save notes
    const notasTexto = [];
    if (expedienteLabel) {
        notasTexto.push(`📋 Expediente PJF: ${expedienteLabel}`);
        if (juzgadoExtraido) notasTexto.push(`🏛️ Órgano: ${juzgadoExtraido}`);
        notasTexto.push('📌 Institución: PJF Federal');
        notasTexto.push('---');
    }

    if (resultado.puntos_importantes) {
        resultado.puntos_importantes.forEach((punto, i) => {
            const checkbox = document.getElementById(`ia-pjf-punto-${i}`);
            if (checkbox && checkbox.checked) notasTexto.push(`⚠️ ${punto}`);
        });
    }

    if (resultado.acciones_requeridas) {
        resultado.acciones_requeridas.forEach((accion, i) => {
            const checkbox = document.getElementById(`ia-pjf-accion-${i}`);
            if (checkbox && checkbox.checked) notasTexto.push(`✅ TODO: ${accion}`);
        });
    }

    if (resultado.montos && resultado.montos.length > 0) {
        notasTexto.push('');
        notasTexto.push('💰 MONTOS:');
        resultado.montos.forEach(m => notasTexto.push(`  - ${m.concepto}: ${m.cantidad}`));
    }

    if (notasTexto.length > 0) {
        const nota = {
            expedienteId: resultado.expedienteId,
            expedienteTexto: resultado.expedienteTexto || numExpExtraido,
            numeroExpediente: expedienteLabel,
            institucion: 'PJF',
            titulo: `Análisis IA PJF${expedienteLabel ? ' - Exp. ' + expedienteLabel : ''} - ${new Date().toLocaleDateString('es-MX')}`,
            contenido: notasTexto.join('\n'),
            color: '#cce5ff',
            recordatorio: null
        };

        try {
            await agregarNota(nota);
            guardados++;
        } catch (e) {
            Logger.error('Error al guardar nota PJF:', e);
        }
    }

    // Update UI
    await cargarExpedientes();
    await cargarExpedientesPJF();
    await cargarEventos();
    await cargarNotas();
    await cargarEstadisticas();
    renderizarCalendario();

    document.getElementById('resultados-ia-pjf').style.display = 'none';
    document.getElementById('ia-texto-acuerdo-pjf').value = '';
    eliminarImagenAcuerdoPJF();
    resultadosIAPJFActuales = null;

    mostrarToast(`${guardados} elementos PJF guardados`, 'success');

    // Sincronizar automáticamente con otros dispositivos
    if (typeof marcarYSincronizar === 'function') await marcarYSincronizar();
}


// ==================== BÚSQUEDA DE TEXTO EN CATÁLOGOS DE ÓRGANOS ====================

/**
 * Muestra el campo de búsqueda de texto sobre un <select> cuando el usuario
 * va a desplegarlo (onmousedown).  El input se muestra si el select tiene
 * más de 15 opciones para no entorpecer selects pequeños.
 */
function mostrarBuscadorOrganos(searchInputId, selectId) {
    var searchInput = document.getElementById(searchInputId);
    var select = document.getElementById(selectId);
    if (!searchInput || !select) return;
    // Mostrar solo si hay opciones significativas
    if (select.options.length > 3) {
        searchInput.style.display = 'block';
        // No hacer focus automático para no interferir con el click del select
    }
}

/**
 * Filtra las opciones del selector de juzgados TSJ según texto libre.
 */
function filtrarJuzgadosSelect(searchInputId, selectId) {
    var input = document.getElementById(searchInputId);
    var select = document.getElementById(selectId);
    if (!input || !select) return;

    var query = input.value.toLowerCase().trim();

    Array.from(select.options).forEach(function(opt) {
        if (opt.value === '') {
            opt.style.display = '';
            return;
        }
        var texto = (opt.textContent || '').toLowerCase();
        opt.style.display = (!query || texto.includes(query)) ? '' : 'none';
    });
}

// ==================== SELECCIÓN MASIVA PJF ====================

let modoSeleccionPJF = false;
let expedientesPJFSeleccionados = new Set();

/**
 * Activa o desactiva el modo de selección masiva en la pestaña Expedientes PJF.
 */
function toggleModoSeleccionPJF() {
    modoSeleccionPJF = !modoSeleccionPJF;
    expedientesPJFSeleccionados.clear();

    const bulkBar = document.getElementById('bulk-actions-pjf');
    const toggleBtn = document.getElementById('btn-toggle-seleccion-pjf');

    if (bulkBar) bulkBar.style.display = modoSeleccionPJF ? 'flex' : 'none';
    const bulkNotice = document.getElementById('bulk-open-notice-pjf');
    if (bulkNotice) bulkNotice.style.display = modoSeleccionPJF ? 'block' : 'none';
    if (toggleBtn) {
        toggleBtn.textContent = modoSeleccionPJF ? '✕ Cancelar selección' : '☑️ Selección masiva';
        toggleBtn.classList.toggle('btn-warning', modoSeleccionPJF);
        toggleBtn.classList.toggle('btn-secondary', !modoSeleccionPJF);
    }

    // Redraw cards to show/hide checkboxes
    cargarExpedientesPJF();
}

/**
 * Marca el checkbox de un expediente PJF y actualiza el contador.
 */
function toggleSeleccionExpedientePJF(id, checkbox) {
    if (checkbox.checked) {
        expedientesPJFSeleccionados.add(id);
    } else {
        expedientesPJFSeleccionados.delete(id);
    }
    actualizarContadorSeleccionPJF();
}

function actualizarContadorSeleccionPJF() {
    var count = expedientesPJFSeleccionados.size;
    var countEl = document.getElementById('count-pjf-seleccionados');
    if (countEl) countEl.textContent = count + ' seleccionado' + (count !== 1 ? 's' : '');

    var btnAbrir = document.getElementById('btn-abrir-pjf-seleccionados');
    if (btnAbrir) btnAbrir.disabled = count === 0;
}

/**
 * Selecciona todos los expedientes PJF visibles.
 */
function seleccionarTodosExpedientesPJF() {
    document.querySelectorAll('#lista-expedientes-pjf .pjf-check').forEach(function(cb) {
        cb.checked = true;
        var id = parseInt(cb.dataset.expId);
        if (id) expedientesPJFSeleccionados.add(id);
    });
    actualizarContadorSeleccionPJF();
}

/**
 * Deselecciona todos los expedientes PJF.
 */
function deseleccionarTodosExpedientesPJF() {
    document.querySelectorAll('#lista-expedientes-pjf .pjf-check').forEach(function(cb) {
        cb.checked = false;
    });
    expedientesPJFSeleccionados.clear();
    actualizarContadorSeleccionPJF();
}

/**
 * Abre una ventana de búsqueda PJF para cada expediente seleccionado.
 * Los que tengan orgId + tipoAsunto guardados se abren directamente;
 * los que falten datos se omiten con un aviso.
 */
async function abrirExpedientesPJFSeleccionados() {
    if (expedientesPJFSeleccionados.size === 0) {
        mostrarToast('No hay expedientes seleccionados', 'warning');
        return;
    }

    await cargarCatalogosPJF();
    const todosExpedientes = await obtenerExpedientes();
    const seleccionados = todosExpedientes.filter(e => expedientesPJFSeleccionados.has(e.id));

    let abiertos = 0;
    let sinDatos = 0;

    seleccionados.forEach(function(exp) {
        if (!exp.numero) { sinDatos++; return; }

        // Resolver orgId
        let orgId = exp.pjfOrgId;
        if (!orgId && exp.juzgado) {
            const organo = pjfOrganismos.find(o => o.nombre === exp.juzgado);
            if (organo) orgId = String(organo.id);
        }

        const tipoAsunto = exp.pjfTipoAsunto;

        if (orgId && tipoAsunto) {
            const url = (typeof construirURLPJF === 'function')
                ? construirURLPJF(orgId, tipoAsunto, exp.numero, 0)
                : PJF_VERCAPTURA_URL +
                  '?tipoasunto=' + encodeURIComponent(tipoAsunto) +
                  '&organismo=' + encodeURIComponent(orgId) +
                  '&expediente=' + encodeURIComponent(exp.numero) +
                  '&tipoprocedimiento=0';
            window.open(url, '_blank', 'width=1024,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no');
            abiertos++;
        } else {
            sinDatos++;
        }
    });

    if (abiertos > 0) {
        mostrarToast(
            abiertos + ' ventana' + (abiertos !== 1 ? 's' : '') + ' abierta' + (abiertos !== 1 ? 's' : '') +
            (sinDatos > 0 ? '. ' + sinDatos + ' sin datos PJF completos.' : '') +
            ' (Permite ventanas emergentes si el navegador las bloquea)',
            'success'
        );
    } else {
        mostrarToast(
            'Ningún expediente tiene ID de organismo y tipo de asunto guardados. ' +
            'Abre cada expediente manualmente primero para guardar esos datos.',
            'warning'
        );
    }
}
