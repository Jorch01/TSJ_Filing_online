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
    await cargarEstadisticas();
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
        const helpBtn = container.querySelector('.help-btn');
        const tooltip = container.querySelector('.tooltip-content');

        if (!helpBtn || !tooltip) return;

        // Posicionar tooltip al hacer hover
        const posicionarTooltip = () => {
            const btnRect = helpBtn.getBoundingClientRect();
            const tooltipWidth = 320;
            const tooltipHeight = tooltip.offsetHeight || 200;
            const padding = 10;

            // Calcular posición ideal (arriba del botón)
            let top = btnRect.top - tooltipHeight - padding;
            let left = btnRect.left + (btnRect.width / 2) - (tooltipWidth / 2);

            // Si no hay espacio arriba, mostrar abajo
            if (top < padding) {
                top = btnRect.bottom + padding;
            }

            // Ajustar si se sale por la izquierda
            if (left < padding) {
                left = padding;
            }

            // Ajustar si se sale por la derecha
            if (left + tooltipWidth > window.innerWidth - padding) {
                left = window.innerWidth - tooltipWidth - padding;
            }

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
        };

        helpBtn.addEventListener('mouseenter', posicionarTooltip);
        helpBtn.addEventListener('focus', posicionarTooltip);

        // Reposicionar en scroll
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if (tooltip.style.visibility === 'visible' ||
                    tooltip.style.opacity === '1') {
                    posicionarTooltip();
                }
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
    } else if (pagina === 'busqueda') {
        cargarExpedientesParaBusqueda();
    } else if (pagina === 'pjf') {
        cargarCatalogosPJF();
    }
}

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

    lista.innerHTML = advertenciaHTML + expedientes.map((exp, index) => {
        const instBadge = exp.institucion === 'PJF'
            ? '<span class="institucion-badge pjf">🏛️ PJF</span>'
            : exp.institucion === 'OTRO'
            ? '<span class="institucion-badge otro">📋 Varios</span>'
            : '<span class="institucion-badge tsj">⚖️ TSJ</span>';
        return `
        <div class="expediente-card" data-id="${exp.id}" data-orden="${exp.orden || index}" draggable="true">
            <div class="drag-handle" title="Arrastra para reordenar">⋮⋮</div>
            <div class="expediente-header">
                <span class="expediente-tipo">${exp.numero ? '🔢' : '👤'}</span>
                ${instBadge}
                <span class="expediente-categoria">${escapeText(exp.categoria || 'General')}</span>
            </div>
            <div class="expediente-body">
                <h3 class="expediente-titulo">${escapeText(exp.numero || exp.nombre)}</h3>
                <p class="expediente-juzgado">${escapeText(exp.juzgado)}</p>
                ${exp.comentario ? `<p class="expediente-comentario">${escapeText(exp.comentario)}</p>` : ''}
            </div>
            <div class="expediente-footer">
                <span class="expediente-fecha">${formatearFecha(exp.fechaCreacion)}</span>
                <div class="expediente-actions">
                    <button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Ver historial">📜</button>
                    <button class="btn btn-sm btn-secondary" onclick="editarExpediente(${exp.id}, event)">✏️</button>
                    <button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>
                    <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpediente(${exp.id}, event)">🗑️</button>
                </div>
            </div>
        </div>
    `;
    }).join('');

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
        tablaBody.innerHTML = expedientes.map(exp => {
            const instLabel = exp.institucion === 'PJF' ? '🏛️ PJF'
                           : exp.institucion === 'OTRO' ? '📋 Varios'
                           : '⚖️ TSJ';
            return `
            <tr data-id="${exp.id}">
                <td class="tipo-cell">${exp.numero ? '🔢' : '👤'}</td>
                <td><strong>${escapeText(exp.numero || exp.nombre)}</strong></td>
                <td>${escapeText(exp.juzgado)}</td>
                <td><span class="categoria-badge">${escapeText(exp.categoria || 'General')}</span></td>
                <td>${instLabel}</td>
                <td class="comentario-cell" title="${escapeText(exp.comentario || '')}">${escapeText(exp.comentario || '-')}</td>
                <td>${formatearFecha(exp.fechaCreacion)}</td>
                <td class="acciones-cell">
                    <button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Historial">📜</button>
                    <button class="btn btn-sm btn-secondary" onclick="editarExpediente(${exp.id}, event)">✏️</button>
                    <button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>
                    <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpediente(${exp.id}, event)">🗑️</button>
                </td>
            </tr>
        `;
        }).join('');
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
    localStorage.setItem('vistaExpedientes', vista);

    // Actualizar solo botones de TSJ (excluir PJF view buttons)
    document.querySelectorAll('#page-expedientes .view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === vista);
    });

    aplicarVistaExpedientes();
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
        const expediente = await obtenerExpedientePorId(id);
        if (expediente) {
            expediente.orden = i;
            await actualizarExpediente(expediente);
        }
    }
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

function mostrarFormularioExpediente() {
    document.getElementById('form-expediente').style.display = 'block';
    document.getElementById('form-expediente-titulo').textContent = 'Agregar Nuevo Expediente';
    document.getElementById('expediente-id').value = '';
    document.getElementById('expediente-form').reset();
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

        const expediente = {
            juzgado,
            categoria: institucion === 'PJF' ? 'PJF Federal'
                     : institucion === 'OTRO' ? 'Otros/Varios'
                     : obtenerCategoriaJuzgado(juzgado),
            institucion: institucion,
            comentario: comentario || undefined
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

        if (id) {
            await actualizarExpediente(parseInt(id), expediente);
            mostrarToast('Expediente actualizado', 'success');
        } else {
            await agregarExpediente(expediente);
            mostrarToast('Expediente agregado', 'success');
        }

        cerrarFormularioExpediente();
        await cargarExpedientes();
        await cargarEstadisticas();
        // Sincronizar con otros dispositivos
        if (typeof sincronizarDespuesDeGuardar === 'function') sincronizarDespuesDeGuardar();
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

function confirmarEliminarExpediente(id, event) {
    // Prevenir propagación del evento
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    if (confirm('¿Estás seguro de eliminar este expediente?')) {
        eliminarExpediente(id, true)
            .then(() => {
                mostrarToast('Expediente eliminado', 'success');
                const archivoVisible = document.getElementById('archivo-section')?.style.display === 'block';
                const tareas = [cargarExpedientes(), cargarEstadisticas()];
                if (archivoVisible) tareas.push(cargarArchivo());
                return Promise.all(tareas);
            })
            .then(() => {
                if (typeof sincronizarDespuesDeGuardar === 'function') sincronizarDespuesDeGuardar();
            })
            .catch(err => {
                Logger.error('Error al eliminar expediente:', err);
                mostrarToast('Error al eliminar: ' + (err.message || 'Error desconocido'), 'error');
            });
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
        if (typeof sincronizarDespuesDeGuardar === 'function') sincronizarDespuesDeGuardar();
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
        if (typeof sincronizarDespuesDeGuardar === 'function') sincronizarDespuesDeGuardar();
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

async function cargarArchivo() {
    const archivados = await obtenerExpedientesArchivados();
    const lista = document.getElementById('lista-archivo');
    const count = document.getElementById('count-archivo');

    if (archivados.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📦</span>
                <h3>Archivo vacío</h3>
                <p>No hay expedientes archivados</p>
            </div>
        `;
    } else {
        lista.innerHTML = archivados.map(exp => renderCardArchivado(exp)).join('');
    }

    count.textContent = `${archivados.length} archivado${archivados.length !== 1 ? 's' : ''}`;
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

async function filtrarArchivo() {
    const busqueda = (document.getElementById('buscar-archivo')?.value || '').toLowerCase();
    const motivo = document.getElementById('filtro-motivo-archivo')?.value || '';

    let archivados = await obtenerExpedientesArchivados();

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

    const lista = document.getElementById('lista-archivo');
    const count = document.getElementById('count-archivo');

    if (archivados.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🔍</span>
                <h3>Sin resultados</h3>
                <p>No se encontraron expedientes archivados con esos filtros</p>
            </div>
        `;
    } else {
        lista.innerHTML = archivados.map(exp => renderCardArchivado(exp)).join('');
    }

    count.textContent = `${archivados.length} archivado${archivados.length !== 1 ? 's' : ''}`;
}

async function actualizarBadgeArchivo() {
    try {
        const archivados = await obtenerExpedientesArchivados();
        const badge = document.getElementById('count-archivo-badge');
        if (badge) {
            if (archivados.length > 0) {
                badge.textContent = archivados.length;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (e) {
        // Ignorar errores silenciosamente
    }
}

async function filtrarExpedientes() {
    const busqueda = document.getElementById('buscar-expediente').value.toLowerCase();
    const categoria = document.getElementById('filtro-categoria').value;

    let expedientes = await obtenerExpedientes();

    if (busqueda) {
        // Obtener notas e historial para búsqueda profunda
        const todasNotas = await obtenerNotas();
        const todosHistorial = await obtenerTodoHistorial();

        // Indexar por expedienteId para búsqueda rápida
        const notasPorExp = {};
        for (const n of todasNotas) {
            if (!notasPorExp[n.expedienteId]) notasPorExp[n.expedienteId] = [];
            notasPorExp[n.expedienteId].push(n);
        }
        const historialPorExp = {};
        for (const h of todosHistorial) {
            if (!historialPorExp[h.expedienteId]) historialPorExp[h.expedienteId] = [];
            historialPorExp[h.expedienteId].push(h);
        }

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
            const notas = notasPorExp[e.id] || [];
            for (const n of notas) {
                if ((n.titulo && n.titulo.toLowerCase().includes(busqueda)) ||
                    (n.contenido && n.contenido.toLowerCase().includes(busqueda))) {
                    return true;
                }
            }
            // Búsqueda en historial/actualizaciones del expediente
            const historial = historialPorExp[e.id] || [];
            for (const h of historial) {
                if ((h.descripcion && h.descripcion.toLowerCase().includes(busqueda)) ||
                    (h.detalle && h.detalle.toLowerCase().includes(busqueda))) {
                    return true;
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
        // Renderizar cards con comentarios
        const instBadgeFor = (exp) => exp.institucion === 'PJF'
            ? '<span class="institucion-badge pjf">🏛️ PJF</span>'
            : exp.institucion === 'OTRO'
            ? '<span class="institucion-badge otro">📋 Varios</span>'
            : '<span class="institucion-badge tsj">⚖️ TSJ</span>';

        lista.innerHTML = expedientes.map(exp => `
            <div class="expediente-card" data-id="${exp.id}">
                <div class="expediente-header">
                    <span class="expediente-tipo">${exp.numero ? '🔢' : '👤'}</span>
                    ${instBadgeFor(exp)}
                    <span class="expediente-categoria">${escapeText(exp.categoria || 'General')}</span>
                </div>
                <div class="expediente-body">
                    <h3 class="expediente-titulo">${escapeText(exp.numero || exp.nombre)}</h3>
                    <p class="expediente-juzgado">${escapeText(exp.juzgado)}</p>
                    ${exp.comentario ? `<p class="expediente-comentario">${escapeText(exp.comentario)}</p>` : ''}
                </div>
                <div class="expediente-footer">
                    <span class="expediente-fecha">${formatearFecha(exp.fechaCreacion)}</span>
                    <div class="expediente-actions">
                        <button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Ver historial">📜</button>
                        <button class="btn btn-sm btn-secondary" onclick="editarExpediente(${exp.id}, event)">✏️</button>
                        <button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>
                        <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpediente(${exp.id}, event)">🗑️</button>
                    </div>
                </div>
            </div>
        `).join('');

        // Actualizar tabla (vista lista) con los mismos resultados filtrados
        const tablaBody = document.getElementById('tabla-expedientes-body');
        if (tablaBody) {
            tablaBody.innerHTML = expedientes.map(exp => {
                const instLabel = exp.institucion === 'PJF' ? '🏛️ PJF'
                               : exp.institucion === 'OTRO' ? '📋 Varios'
                               : '⚖️ TSJ';
                return `
                <tr data-id="${exp.id}">
                    <td class="tipo-cell">${exp.numero ? '🔢' : '👤'}</td>
                    <td><strong>${escapeText(exp.numero || exp.nombre)}</strong></td>
                    <td>${escapeText(exp.juzgado)}</td>
                    <td><span class="categoria-badge">${escapeText(exp.categoria || 'General')}</span></td>
                    <td>${instLabel}</td>
                    <td class="comentario-cell" title="${escapeText(exp.comentario || '')}">${escapeText(exp.comentario || '-')}</td>
                    <td>${formatearFecha(exp.fechaCreacion)}</td>
                    <td class="acciones-cell">
                        <button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Historial">📜</button>
                        <button class="btn btn-sm btn-secondary" onclick="editarExpediente(${exp.id}, event)">✏️</button>
                        <button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>
                        <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpediente(${exp.id}, event)">🗑️</button>
                    </td>
                </tr>
            `;
            }).join('');
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
        if (id) {
            await actualizarNota(parseInt(id), nota);
            mostrarToast('Nota actualizada', 'success');
        } else {
            await agregarNota(nota);
            mostrarToast('Nota creada', 'success');
        }

        cerrarModal();
        await cargarNotas();
        await cargarEstadisticas();
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
        eliminarNota(id).then(() => {
            cerrarModal();
            cargarNotas();
            cargarEstadisticas();
            mostrarToast('Nota eliminada', 'success');
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

            return `
                <div class="list-item list-item-with-tooltip" style="border-left: 3px solid ${e.color || '#3788d8'}">
                    <div class="list-item-info">
                        <span class="list-item-title">${e.titulo}</span>
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
            return `
            <div class="evento-item" onclick="editarEvento(${e.id})" style="border-left: 3px solid ${escapeText(e.color || '#3788d8')}">
                <div class="evento-info">
                    <span class="evento-titulo">${escapeText(e.titulo)}${instBadgeEvt}</span>
                    <span class="evento-hora">${e.todoElDia ? 'Todo el día' : new Date(e.fechaInicio).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
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

const COLORES_EVENTOS = {
    audiencia: '#3788d8',
    vencimiento: '#dc3545',
    recordatorio: '#ffc107',
    otro: '#6c757d'
};

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
        if (id) {
            await actualizarEvento(parseInt(id), evento);
            mostrarToast('Evento actualizado', 'success');
        } else {
            await agregarEvento(evento);
            mostrarToast('Evento creado', 'success');
        }

        cerrarModal();
        await cargarEventos();
        await cargarEstadisticas();
        renderizarCalendario();
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

        document.getElementById('modal-footer').innerHTML = `
            <button class="btn btn-danger" onclick="confirmarEliminarEvento(${id})">🗑️ Eliminar</button>
            <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
            <button class="btn btn-primary" onclick="document.getElementById('evento-form').requestSubmit()">💾 Guardar</button>
        `;
    }, 100);
}

function confirmarEliminarEvento(id) {
    if (confirm('¿Eliminar este evento?')) {
        eliminarEvento(id).then(() => {
            cerrarModal();
            cargarEventos();
            cargarEstadisticas();
            renderizarCalendario();
            mostrarToast('Evento eliminado', 'success');
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
    const fechaEvento = new Date(evento.fechaInicio || evento.fecha).toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const templateParams = {
        to_email: emailDestino,
        subject: `📅 Recordatorio: ${evento.titulo} en ${diasTexto}`,
        message: `
RECORDATORIO DE EVENTO

Evento: ${evento.titulo}
Fecha: ${fechaEvento}
Faltan: ${diasTexto}

${evento.descripcion || ''}

---
TSJ Filing Online
        `.trim(),
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
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `tsj_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();

        URL.revokeObjectURL(url);
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
    if (confirm('¿Estás seguro? Esta acción eliminará TODOS los datos permanentemente.')) {
        if (confirm('¿REALMENTE seguro? No se puede deshacer.')) {
            await eliminarTodosLosDatos();
            await cargarExpedientes();
            await cargarNotas();
            await cargarEventos();
            await cargarEstadisticas();
            renderizarCalendario();
            mostrarToast('Todos los datos han sido eliminados', 'success');
        }
    }
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
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const fechaHora = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tsj_auto_backup_${fechaHora}.json`;
        a.click();

        URL.revokeObjectURL(url);

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

// ==================== IMPORTACIÓN CSV/EXCEL ====================

// ---- PJF: Template y carga masiva ----

async function descargarTemplatePJF() {
    await cargarCatalogosPJF();

    const fecha = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const totalOrganos = pjfOrganismos.length;
    const totalCircuitos = pjfCircuitos.length;
    const totalTiposOrgano = Object.keys(pjfTiposOrgano).length;

    let csv = '';

    // ── Encabezado informativo ─────────────────────────────────────────────
    csv += '# ================================================================\n';
    csv += '# TEMPLATE DE CARGA MASIVA - EXPEDIENTES PJF\n';
    csv += '# Poder Judicial de la Federación - Portal DGEJ/CJF\n';
    csv += `# Generado: ${fecha}\n`;
    csv += `# Catálogo: ${totalOrganos} órganos | ${totalCircuitos} circuitos | ${totalTiposOrgano} tipos de órgano\n`;
    csv += '# ================================================================\n';
    csv += '#\n';
    csv += '# COLUMNAS:\n';
    csv += '#   expediente     - Número de expediente (ej: 67/2021)              [OBLIGATORIO]\n';
    csv += '#   organo         - Nombre EXACTO del órgano (ver catálogo abajo)   [obligatorio si no hay organismo_id]\n';
    csv += '#   organismo_id   - ID numérico del órgano (preferido)              [obligatorio si no hay organo]\n';
    csv += '#   tipo_asunto_id - ID numérico del tipo de asunto                  [recomendado para búsqueda directa]\n';
    csv += '#   comentario     - Nota libre                                       [opcional]\n';
    csv += '#\n';
    csv += '# NOTAS:\n';
    csv += '#   - Proporciona "organo" (nombre) O "organismo_id" (ID), o ambos\n';
    csv += '#   - Con organismo_id + tipo_asunto_id el boton [Buscar] abre el portal PJF directamente\n';
    csv += '#   - El nombre en "organo" debe coincidir EXACTAMENTE con el catálogo (incluyendo tildes)\n';
    csv += '#   - Las filas que empiezan con # son comentarios y se ignoran al importar\n';
    csv += '#\n';

    // ── Encabezado CSV y filas de ejemplo ─────────────────────────────────
    csv += 'expediente,organo,organismo_id,tipo_asunto_id,comentario\n';

    // Ejemplos con organos reales del catalogo
    const ejemplos = [
        { num: '67/2021', orgId: 394, tipoId: 1,  nota: 'Ejemplo: Amparo Indirecto en Juzgado de Distrito' },
        { num: '123/2023', orgId: 394, tipoId: 68, nota: 'Ejemplo: Juicio Oral Mercantil' },
        { num: '456/2024', orgId: 395, tipoId: 10, nota: 'Ejemplo: Amparo Directo en Tribunal Colegiado' },
        { num: '789/2022', orgId: '',  tipoId: 74, nota: 'Ejemplo: solo organismo_id vacio, llena con el ID real' },
    ];
    ejemplos.forEach(function(ej) {
        const org = ej.orgId ? pjfOrganismos.find(function(o) { return o.id === ej.orgId; }) : null;
        const nombre = org ? org.nombre : '';
        csv += `${ej.num},"${nombre}",${ej.orgId || ''},${ej.tipoId},"${ej.nota}"\n`;
    });

    csv += '\n';

    // ── Sección: Tipos de Asunto por Tipo de Órgano ───────────────────────
    csv += '# ================================================================\n';
    csv += '# CATALOGO: TIPOS DE ASUNTO POR TIPO DE ORGANO\n';
    csv += '# Usa el ID en la columna tipo_asunto_id\n';
    csv += '# ================================================================\n';

    // Ordenar por TipoOrganismoId y mostrar tipos de asunto (union)
    const tiposOrganoOrdenados = Object.keys(pjfTiposOrgano)
        .map(function(tid) {
            return { id: Number(tid), nombre: pjfTiposOrgano[tid].nombre, tipos: pjfTiposOrgano[tid].tiposAsuntoArr || [] };
        })
        .filter(function(to) { return to.tipos.length > 0; })
        .sort(function(a, b) { return a.id - b.id; });

    tiposOrganoOrdenados.forEach(function(to) {
        csv += `#\n# --- TipoOrganismo ${to.id}: ${to.nombre} ---\n`;
        to.tipos.forEach(function(t) {
            csv += `#   tipo_asunto_id=${t.id}  ->  ${t.nombre}\n`;
        });
    });

    csv += '#\n';

    // ── Sección: Catálogo de Circuitos y Órganos ──────────────────────────
    csv += '# ================================================================\n';
    csv += '# CATALOGO: CIRCUITOS Y ORGANOS\n';
    csv += '# Usa el nombre EXACTO en "organo" o el ID en "organismo_id"\n';
    csv += '# Formato: # ID | Nombre del organo | Tipo de organo | Ciudad\n';
    csv += '# ================================================================\n';

    pjfCircuitos.forEach(function(c) {
        const organosPorCircuito = pjfOrganismos
            .filter(function(o) { return o.circuito_id === c.numero_circuito; })
            .sort(function(a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });

        if (organosPorCircuito.length === 0) return;

        csv += `#\n# ---- CIRCUITO ${c.numero_circuito}: ${c.nombre} (${organosPorCircuito.length} órganos) ----\n`;
        organosPorCircuito.forEach(function(o) {
            const ciudad = o.ciudad ? ' | ' + o.ciudad : '';
            csv += `# ID=${o.id} | "${o.nombre}" | ${o.tipoOrganismo}${ciudad}\n`;
        });
    });

    csv += '#\n# ================================================================\n';
    csv += '# FIN DEL CATALOGO\n';
    csv += '# ================================================================\n';

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'template_expedientes_pjf.csv';
    a.click();
    URL.revokeObjectURL(url);

    mostrarToast(
        `Template PJF descargado: ${totalOrganos} órganos, ${totalCircuitos} circuitos, tipos de asunto completos`,
        'success'
    );
}

function parsePJFCSV(texto) {
    const lineas = texto.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    if (lineas.length < 2) return [];

    const encabezados = lineas[0].split(',').map(h => h.trim().toLowerCase());

    if (!encabezados.includes('expediente')) {
        throw new Error('Falta la columna requerida: expediente');
    }

    const datos = [];
    for (let i = 1; i < lineas.length; i++) {
        const linea = lineas[i].trim();
        if (!linea || linea.startsWith('#')) continue;
        const valores = parseCSVLine(linea);
        const fila = {};
        encabezados.forEach((enc, idx) => { fila[enc] = valores[idx] || ''; });
        datos.push(fila);
    }
    return datos;
}

async function importarExpedientesPJFCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const texto = await file.text();
        const datos = parsePJFCSV(texto);

        if (!datos || datos.length === 0) {
            mostrarToast('No se encontraron datos válidos en el archivo', 'error');
            event.target.value = '';
            return;
        }

        await cargarCatalogosPJF();

        const expedientesValidos = [];
        const errores = [];

        datos.forEach((fila, index) => {
            const expediente = fila.expediente?.trim();
            const organoNombre = fila.organo?.trim() || '';
            const organismoId = fila.organismo_id?.trim() || '';
            const tipoAsuntoId = fila.tipo_asunto_id?.trim() || '';
            const comentario = fila.comentario?.trim() || '';

            if (!expediente) {
                errores.push(`Fila ${index + 2}: Falta el número de expediente`);
                return;
            }

            // Resolver organismo
            let resolvedOrgId = organismoId;
            let resolvedOrgNombre = organoNombre;

            if (!resolvedOrgId && organoNombre) {
                const org = pjfOrganismos.find(o =>
                    o.nombre.toLowerCase() === organoNombre.toLowerCase()
                );
                if (org) {
                    resolvedOrgId = String(org.id);
                    resolvedOrgNombre = org.nombre;
                }
            } else if (resolvedOrgId && !organoNombre) {
                const org = pjfOrganismos.find(o => String(o.id) === resolvedOrgId);
                if (org) resolvedOrgNombre = org.nombre;
            }

            if (!resolvedOrgNombre && !resolvedOrgId) {
                errores.push(`Fila ${index + 2}: Falta el órgano (columna "organo" o "organismo_id")`);
                return;
            }

            const nuevoExp = {
                numero: expediente,
                juzgado: resolvedOrgNombre || `Organismo ID: ${resolvedOrgId}`,
                categoria: 'PJF Federal',
                institucion: 'PJF',
                comentario: comentario || undefined
            };
            if (resolvedOrgId) nuevoExp.pjfOrgId = resolvedOrgId;
            if (tipoAsuntoId) nuevoExp.pjfTipoAsunto = tipoAsuntoId;

            expedientesValidos.push(nuevoExp);
        });

        if (errores.length > 0 && expedientesValidos.length === 0) {
            mostrarToast(`Error: ${errores[0]}`, 'error');
            event.target.value = '';
            return;
        }

        const mensaje = errores.length > 0
            ? `Se importarán ${expedientesValidos.length} expedientes (${errores.length} filas con errores ignoradas). ¿Continuar?`
            : `¿Importar ${expedientesValidos.length} expedientes PJF?`;

        if (!confirm(mensaje)) {
            event.target.value = '';
            return;
        }

        let importados = 0;
        for (const exp of expedientesValidos) {
            try {
                await agregarExpediente(exp);
                importados++;
            } catch (e) {
                Logger.error('Error al agregar expediente PJF:', e);
            }
        }

        await Promise.all([cargarExpedientesPJF(), cargarExpedientes(), cargarEstadisticas()]);
        mostrarToast(`${importados} expedientes PJF importados correctamente`, 'success');

    } catch (error) {
        Logger.error('Error al importar PJF:', error);
        mostrarToast('Error al procesar el archivo: ' + error.message, 'error');
    }

    event.target.value = '';
}

// ---- TSJ QROO: Template y carga masiva ----

function descargarTemplateCSV() {
    // Encabezados
    let csv = 'expediente,tipo,juzgado,comentario\n';

    // Filas de ejemplo
    csv += '1234/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,Ejemplo de expediente por número\n';
    csv += 'Juan Pérez García,nombre,JUZGADO SEGUNDO FAMILIAR ORAL CANCUN,Ejemplo de búsqueda por nombre\n';
    csv += '5678/2024,numero,PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR,Ejemplo en Segunda Instancia\n';

    // Agregar sección de referencia con todos los juzgados
    csv += '\n# ==================== REFERENCIA DE JUZGADOS ====================\n';
    csv += '# Copia el nombre exacto del juzgado de esta lista:\n';
    csv += '# TIPOS VÁLIDOS: numero, nombre\n';
    csv += '#\n';

    // Generar lista automáticamente desde CATEGORIAS_JUZGADOS
    CATEGORIAS_JUZGADOS.forEach(cat => {
        csv += `# --- ${cat.nombre} ---\n`;
        cat.juzgados.forEach(juzgado => {
            csv += `# ${juzgado}\n`;
        });
        csv += '#\n';
    });

    // Descargar archivo
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template_expedientes_tsj.csv';
    a.click();
    URL.revokeObjectURL(url);

    mostrarToast('Template descargado', 'success');
}

async function importarExpedientesCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const extension = file.name.split('.').pop().toLowerCase();

    try {
        let datos;

        if (extension === 'csv') {
            const texto = await file.text();
            datos = parseCSV(texto);
        } else if (extension === 'xlsx' || extension === 'xls') {
            // Para Excel, necesitamos leerlo de forma diferente
            mostrarToast('Para archivos Excel, primero expórtalos a CSV', 'warning');
            event.target.value = '';
            return;
        }

        if (!datos || datos.length === 0) {
            mostrarToast('No se encontraron datos válidos', 'error');
            event.target.value = '';
            return;
        }

        // Validar y procesar datos
        const expedientesValidos = [];
        const errores = [];

        datos.forEach((fila, index) => {
            const expediente = fila.expediente?.trim();
            const tipo = fila.tipo?.trim().toLowerCase();
            const juzgado = fila.juzgado?.trim().toUpperCase();
            const comentario = fila.comentario?.trim() || '';

            // Validar campos requeridos
            if (!expediente) {
                errores.push(`Fila ${index + 2}: Falta el expediente`);
                return;
            }

            if (!tipo || (tipo !== 'numero' && tipo !== 'nombre')) {
                errores.push(`Fila ${index + 2}: Tipo inválido (debe ser 'numero' o 'nombre')`);
                return;
            }

            // Validar juzgado
            const juzgadoValido = JUZGADOS[juzgado] || SALAS_SEGUNDA_INSTANCIA[juzgado];
            if (!juzgadoValido) {
                errores.push(`Fila ${index + 2}: Juzgado no reconocido: ${juzgado}`);
                return;
            }

            const nuevoExpediente = {
                juzgado: juzgado,
                categoria: obtenerCategoriaJuzgado(juzgado),
                comentario: comentario || undefined
            };

            if (tipo === 'numero') {
                nuevoExpediente.numero = expediente;
            } else {
                nuevoExpediente.nombre = expediente;
            }

            expedientesValidos.push(nuevoExpediente);
        });

        // Mostrar errores si hay
        if (errores.length > 0) {
            Logger.warn('Errores en importación:', errores);
            if (expedientesValidos.length === 0) {
                mostrarToast(`Error: ${errores[0]}`, 'error');
                event.target.value = '';
                return;
            }
        }

        // Confirmar importación
        const mensaje = errores.length > 0
            ? `Se importarán ${expedientesValidos.length} expedientes (${errores.length} filas con errores ignoradas). ¿Continuar?`
            : `¿Importar ${expedientesValidos.length} expedientes?`;

        if (!confirm(mensaje)) {
            event.target.value = '';
            return;
        }

        // Importar expedientes
        let importados = 0;
        for (const exp of expedientesValidos) {
            try {
                await agregarExpediente(exp);
                importados++;
            } catch (e) {
                Logger.error('Error al agregar expediente:', e);
            }
        }

        await cargarExpedientes();
        await cargarEstadisticas();

        mostrarToast(`${importados} expedientes importados correctamente`, 'success');

    } catch (error) {
        Logger.error('Error al importar:', error);
        mostrarToast('Error al procesar el archivo: ' + error.message, 'error');
    }

    event.target.value = '';
}

function parseCSV(texto) {
    const lineas = texto.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    if (lineas.length < 2) return [];

    // Obtener encabezados
    const encabezados = lineas[0].split(',').map(h => h.trim().toLowerCase());

    // Validar encabezados requeridos
    const requeridos = ['expediente', 'tipo', 'juzgado'];
    const faltantes = requeridos.filter(r => !encabezados.includes(r));
    if (faltantes.length > 0) {
        throw new Error(`Faltan columnas requeridas: ${faltantes.join(', ')}`);
    }

    // Parsear filas
    const datos = [];
    for (let i = 1; i < lineas.length; i++) {
        const linea = lineas[i].trim();
        if (!linea || linea.startsWith('#')) continue;

        // Parsear CSV considerando comillas
        const valores = parseCSVLine(linea);

        const fila = {};
        encabezados.forEach((encabezado, index) => {
            fila[encabezado] = valores[index] || '';
        });

        datos.push(fila);
    }

    return datos;
}

function parseCSVLine(linea) {
    const valores = [];
    let valorActual = '';
    let dentroComillas = false;

    for (let i = 0; i < linea.length; i++) {
        const char = linea[i];

        if (char === '"') {
            dentroComillas = !dentroComillas;
        } else if (char === ',' && !dentroComillas) {
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

// ==================== INTEGRACIÓN CON IA (GROQ) ====================

let resultadosIAActuales = null;

async function guardarConfigIA(event) {
    event.preventDefault();

    const apiKey = document.getElementById('groq-api-key').value.trim();
    const modelo = document.getElementById('groq-model').value;

    await guardarConfig('groq_api_key', apiKey);
    await guardarConfig('groq_model', modelo);

    mostrarToast('Configuración de IA guardada', 'success');
}

async function cargarConfigIA() {
    const apiKey = await obtenerConfig('groq_api_key');
    const modelo = await obtenerConfig('groq_model');

    if (apiKey) document.getElementById('groq-api-key').value = apiKey;
    if (modelo) document.getElementById('groq-model').value = modelo;
}

async function probarIA() {
    const apiKey = document.getElementById('groq-api-key').value.trim();

    if (!apiKey) {
        mostrarToast('Ingresa tu API Key de Groq', 'warning');
        return;
    }

    mostrarToast('Probando conexión...', 'info');

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: document.getElementById('groq-model').value,
                messages: [{ role: 'user', content: 'Responde solo con: OK' }],
                max_tokens: 10
            })
        });

        if (response.ok) {
            mostrarToast('✅ Conexión exitosa con Groq', 'success');
        } else {
            const error = await response.json();
            mostrarToast('Error: ' + (error.error?.message || 'API Key inválida'), 'error');
        }
    } catch (error) {
        mostrarToast('Error de conexión: ' + error.message, 'error');
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

// Modelos de visión disponibles en Groq (intentar en orden)
const GROQ_VISION_MODELS = [
    'llama-3.2-11b-vision-preview',
    'llama-3.2-90b-vision-preview',
    'llava-v1.5-7b-4096-preview'
];

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

async function analizarAcuerdoConIA() {
    const texto = document.getElementById('ia-texto-acuerdo').value.trim();
    const expedienteSelect = document.getElementById('ia-expediente').value;
    const expedienteCustom = document.getElementById('ia-expediente-custom')?.value?.trim() || '';
    const apiKey = await obtenerConfig('groq_api_key');
    const modelo = await obtenerConfig('groq_model') || 'llama-3.3-70b-versatile';

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
        mostrarToast('Configura tu API Key de Groq en Configuración', 'warning');
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
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelo,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 2000,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Error en la API');
        }

        const data = await response.json();
        const contenido = data.choices[0].message.content;

        // Extraer JSON de la respuesta
        const jsonMatch = contenido.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No se pudo parsear la respuesta de la IA');
        }

        const resultado = JSON.parse(jsonMatch[0]);
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

    // Guardar eventos/fechas seleccionados
    if (resultado.fechas) {
        for (let i = 0; i < resultado.fechas.length; i++) {
            const checkbox = document.getElementById(`ia-fecha-${i}`);
            if (checkbox && checkbox.checked) {
                const fecha = resultado.fechas[i];
                const expedienteInfo = expedienteLabel ? ` [Exp. ${expedienteLabel}]` : '';

                const evento = {
                    titulo: `${fecha.descripcion}${expedienteInfo}`,
                    tipo: fecha.tipo === 'audiencia' ? 'audiencia' :
                          fecha.tipo === 'vencimiento' ? 'vencimiento' : 'recordatorio',
                    fechaInicio: new Date(fecha.fecha + (fecha.hora ? `T${fecha.hora}` : 'T09:00')).toISOString(),
                    todoElDia: !fecha.hora,
                    expedienteId: resultado.expedienteId,
                    expedienteTexto: resultado.expedienteTexto || numExpExtraido,
                    numeroExpediente: expedienteLabel,
                    institucion: institucionExtraida,
                    descripcion: `Expediente: ${expedienteLabel || 'N/A'}${juzgadoExtraido ? '\nÓrgano: ' + juzgadoExtraido : ''}${institucionExtraida ? '\nInstitución: ' + institucionExtraida : ''}\nExtraído automáticamente por IA`,
                    alerta: true,
                    color: fecha.tipo === 'audiencia' ? '#3788d8' :
                           fecha.tipo === 'vencimiento' ? '#dc3545' : '#ffc107'
                };

                try {
                    await agregarEvento(evento);
                    guardados++;
                } catch (e) {
                    Logger.error('Error al guardar evento:', e);
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

    if (ambito === 'todos' || ambito === 'primera') {
        juzgadosABuscar = juzgadosABuscar.concat(Object.keys(JUZGADOS));
    }

    if (ambito === 'todos' || ambito === 'segunda') {
        juzgadosABuscar = juzgadosABuscar.concat(Object.keys(SALAS_SEGUNDA_INSTANCIA));
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

// ==================== SISTEMA DE ANUNCIOS ====================

// Configuración de anuncios (pueden ser cargados de un servidor o configurados manualmente)
const ANUNCIOS_CONFIG = [
    {
        id: 'ad1',
        tipo: 'texto',
        contenido: '📢 ¿Quieres anunciarte aquí? Contáctanos',
        enlace: 'mailto:frida@empirica.mx?subject=Publicidad en TSJ Filing Online',
        activo: true
    },
    {
        id: 'ad2',
        tipo: 'texto',
        contenido: '💼 Espacio publicitario disponible - Llega a abogados de Quintana Roo',
        enlace: 'mailto:frida@empirica.mx?subject=Solicitud de espacio publicitario en TSJ Filing',
        activo: true
    },
    {
        id: 'placeholder',
        tipo: 'placeholder',
        contenido: '📢 Espacio disponible para anunciantes',
        enlace: 'mailto:frida@empirica.mx?subject=Anuncio en TSJ Filing Online',
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

    // Rotar anuncios aleatoriamente
    const anuncioAleatorio = () => anunciosActivos[Math.floor(Math.random() * anunciosActivos.length)];

    // Mostrar en cada contenedor de anuncios
    const contenedores = document.querySelectorAll('.ad-banner');
    contenedores.forEach(contenedor => {
        contenedor.style.display = 'block';
        const bodyEl = contenedor.querySelector('.ad-body');
        if (bodyEl) {
            const anuncio = anuncioAleatorio();
            bodyEl.innerHTML = generarHTMLAnuncio(anuncio);
        }
    });
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
        return `
            <a href="${enlaceSanitizado}" ${enlaceSanitizado.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''} class="ad-text-link">
                <span class="ad-text">${escapeText(anuncio.contenido || '')}</span>
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

    lista.innerHTML = advertenciaPJFHTML + pjfExps.map((exp, index) => `
        <div class="expediente-card${modoSeleccionPJF ? ' selection-mode' : ''}" data-id="${exp.id}" data-orden="${exp.orden || index}" draggable="${!modoSeleccionPJF}">
            ${modoSeleccionPJF ? `
            <div class="pjf-checkbox-wrap" onclick="event.stopPropagation()" style="display:flex;align-items:center;padding:0.4rem 0.5rem 0;">
                <input type="checkbox" class="pjf-check" data-exp-id="${exp.id}"
                    ${expedientesPJFSeleccionados.has(exp.id) ? 'checked' : ''}
                    onchange="toggleSeleccionExpedientePJF(${exp.id}, this)"
                    style="width:1.2rem;height:1.2rem;cursor:pointer;accent-color:var(--primary,#366092);">
                <span style="font-size:0.8rem;margin-left:0.4rem;color:var(--text-secondary,#6c757d);">Seleccionar</span>
            </div>` : '<div class="drag-handle" title="Arrastra para reordenar">⋮⋮</div>'}
            <div class="expediente-header">
                <span class="expediente-tipo">${exp.numero ? '🔢' : '👤'}</span>
                <span class="institucion-badge pjf">🏛️ PJF</span>
                <span class="expediente-categoria">${escapeText(exp.categoria || 'PJF Federal')}</span>
            </div>
            <div class="expediente-body">
                <h3 class="expediente-titulo">${escapeText(exp.numero || exp.nombre)}</h3>
                <p class="expediente-juzgado">${escapeText(exp.juzgado)}</p>
                ${exp.comentario ? `<p class="expediente-comentario">${escapeText(exp.comentario)}</p>` : ''}
            </div>
            <div class="expediente-footer">
                <span class="expediente-fecha">${formatearFecha(exp.fechaCreacion)}</span>
                <div class="expediente-actions">
                    ${!modoSeleccionPJF ? `<button class="btn btn-sm btn-primary" onclick="abrirBusquedaPJFGuardado(${exp.id}, event)" title="Buscar en PJF">🔍 Buscar</button>` : ''}
                    ${!modoSeleccionPJF ? `<button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Ver historial">📜</button>` : ''}
                    ${!modoSeleccionPJF ? `<button class="btn btn-sm btn-secondary" onclick="editarExpedientePJF(${exp.id}, event)">✏️</button>` : ''}
                    ${!modoSeleccionPJF ? `<button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>` : ''}
                    ${!modoSeleccionPJF ? `<button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpedientePJF(${exp.id}, event)">🗑️</button>` : ''}
                </div>
            </div>
        </div>
    `).join('');

    // Populate table view
    const tablaBody = document.getElementById('tabla-expedientes-body-pjf');
    if (tablaBody) {
        tablaBody.innerHTML = pjfExps.map(exp => `
            <tr data-id="${exp.id}">
                <td class="tipo-cell">${exp.numero ? '🔢' : '👤'}</td>
                <td><strong>${escapeText(exp.numero || exp.nombre)}</strong></td>
                <td>${escapeText(exp.juzgado)}</td>
                <td><span class="categoria-badge">${escapeText(exp.categoria || 'PJF Federal')}</span></td>
                <td class="comentario-cell" title="${escapeText(exp.comentario || '')}">${escapeText(exp.comentario || '-')}</td>
                <td>${formatearFecha(exp.fechaCreacion)}</td>
                <td class="acciones-cell">
                    <button class="btn btn-sm btn-primary" onclick="abrirBusquedaPJFGuardado(${exp.id}, event)" title="Buscar en PJF">🔍</button>
                    <button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Historial">📜</button>
                    <button class="btn btn-sm btn-secondary" onclick="editarExpedientePJF(${exp.id}, event)">✏️</button>
                    <button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>
                    <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpedientePJF(${exp.id}, event)">🗑️</button>
                </td>
            </tr>
        `).join('');
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
function confirmarEliminarExpedientePJF(id, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }

    if (confirm('¿Estás seguro de eliminar este expediente federal?')) {
        eliminarExpediente(id, true)
            .then(() => {
                mostrarToast('Expediente PJF eliminado', 'success');
                return Promise.all([cargarExpedientesPJF(), cargarExpedientes(), cargarEstadisticas()]);
            })
            .then(() => {
                if (typeof sincronizarDespuesDeGuardar === 'function') sincronizarDespuesDeGuardar();
            })
            .catch(err => {
                Logger.error('Error al eliminar expediente PJF:', err);
                mostrarToast('Error al eliminar: ' + (err.message || 'Error desconocido'), 'error');
            });
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
    const archivados = await obtenerExpedientesArchivados();
    const pjfArchivados = archivados.filter(e => e.institucion === 'PJF');
    const lista = document.getElementById('lista-archivo-pjf');
    const count = document.getElementById('count-archivo-pjf');

    if (pjfArchivados.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📦</span>
                <h3>Archivo vacío</h3>
                <p>No hay expedientes PJF archivados</p>
            </div>
        `;
    } else {
        lista.innerHTML = pjfArchivados.map(exp => renderCardArchivado(exp)).join('');
    }

    count.textContent = `${pjfArchivados.length} archivado${pjfArchivados.length !== 1 ? 's' : ''}`;
}

async function filtrarArchivoPJF() {
    const busqueda = (document.getElementById('buscar-archivo-pjf')?.value || '').toLowerCase();
    const motivo = document.getElementById('filtro-motivo-archivo-pjf')?.value || '';

    const archivados = await obtenerExpedientesArchivados();
    let pjfArchivados = archivados.filter(e => e.institucion === 'PJF');

    if (busqueda) {
        pjfArchivados = pjfArchivados.filter(e =>
            (e.numero && e.numero.toLowerCase().includes(busqueda)) ||
            (e.nombre && e.nombre.toLowerCase().includes(busqueda)) ||
            (e.juzgado && e.juzgado.toLowerCase().includes(busqueda)) ||
            (e.comentario && e.comentario.toLowerCase().includes(busqueda)) ||
            (e.etiquetaArchivo && e.etiquetaArchivo.toLowerCase().includes(busqueda))
        );
    }

    if (motivo) {
        pjfArchivados = pjfArchivados.filter(e => e.motivoArchivo === motivo);
    }

    const lista = document.getElementById('lista-archivo-pjf');
    const count = document.getElementById('count-archivo-pjf');

    if (pjfArchivados.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🔍</span>
                <h3>Sin resultados</h3>
                <p>No se encontraron expedientes PJF archivados con esos filtros</p>
            </div>
        `;
    } else {
        lista.innerHTML = pjfArchivados.map(exp => renderCardArchivado(exp)).join('');
    }

    count.textContent = `${pjfArchivados.length} archivado${pjfArchivados.length !== 1 ? 's' : ''}`;
}

async function actualizarBadgeArchivoPJF() {
    try {
        const archivados = await obtenerExpedientesArchivados();
        const pjfArchivados = archivados.filter(e => e.institucion === 'PJF');
        const badge = document.getElementById('count-archivo-badge-pjf');
        if (badge) {
            if (pjfArchivados.length > 0) {
                badge.textContent = pjfArchivados.length;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (e) {
        // Ignorar errores silenciosamente
    }
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
    localStorage.setItem('vistaExpedientesPJF', vista);

    document.querySelectorAll('.pjf-view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === vista);
    });

    aplicarVistaExpedientesPJF();
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
    const expedientes = await obtenerExpedientes();
    let pjfExps = expedientes.filter(e => e.institucion === 'PJF');

    if (busqueda) {
        // Obtener notas e historial para búsqueda profunda
        const todasNotas = await obtenerNotas();
        const todosHistorial = await obtenerTodoHistorial();

        const notasPorExp = {};
        for (const n of todasNotas) {
            if (!notasPorExp[n.expedienteId]) notasPorExp[n.expedienteId] = [];
            notasPorExp[n.expedienteId].push(n);
        }
        const historialPorExp = {};
        for (const h of todosHistorial) {
            if (!historialPorExp[h.expedienteId]) historialPorExp[h.expedienteId] = [];
            historialPorExp[h.expedienteId].push(h);
        }

        pjfExps = pjfExps.filter(e => {
            if ((e.numero && e.numero.toLowerCase().includes(busqueda)) ||
                (e.nombre && e.nombre.toLowerCase().includes(busqueda)) ||
                (e.juzgado && e.juzgado.toLowerCase().includes(busqueda)) ||
                (e.comentario && e.comentario.toLowerCase().includes(busqueda)) ||
                (e.categoria && e.categoria.toLowerCase().includes(busqueda))) {
                return true;
            }
            const notas = notasPorExp[e.id] || [];
            for (const n of notas) {
                if ((n.titulo && n.titulo.toLowerCase().includes(busqueda)) ||
                    (n.contenido && n.contenido.toLowerCase().includes(busqueda))) {
                    return true;
                }
            }
            const historial = historialPorExp[e.id] || [];
            for (const h of historial) {
                if ((h.descripcion && h.descripcion.toLowerCase().includes(busqueda)) ||
                    (h.detalle && h.detalle.toLowerCase().includes(busqueda))) {
                    return true;
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
        lista.innerHTML = pjfExps.map((exp, index) => `
            <div class="expediente-card" data-id="${exp.id}" data-orden="${exp.orden || index}" draggable="true">
                <div class="drag-handle" title="Arrastra para reordenar">⋮⋮</div>
                <div class="expediente-header">
                    <span class="expediente-tipo">${exp.numero ? '🔢' : '👤'}</span>
                    <span class="institucion-badge pjf">🏛️ PJF</span>
                    <span class="expediente-categoria">${escapeText(exp.categoria || 'PJF Federal')}</span>
                </div>
                <div class="expediente-body">
                    <h3 class="expediente-titulo">${escapeText(exp.numero || exp.nombre)}</h3>
                    <p class="expediente-juzgado">${escapeText(exp.juzgado)}</p>
                    ${exp.comentario ? `<p class="expediente-comentario">${escapeText(exp.comentario)}</p>` : ''}
                </div>
                <div class="expediente-footer">
                    <span class="expediente-fecha">${formatearFecha(exp.fechaCreacion)}</span>
                    <div class="expediente-actions">
                        <button class="btn btn-sm btn-primary" onclick="abrirBusquedaPJFGuardado(${exp.id}, event)" title="Buscar en PJF">🔍 Buscar</button>
                        <button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Ver historial">📜</button>
                        <button class="btn btn-sm btn-secondary" onclick="editarExpedientePJF(${exp.id}, event)">✏️</button>
                        <button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>
                        <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpedientePJF(${exp.id}, event)">🗑️</button>
                    </div>
                </div>
            </div>
        `).join('');

        const tablaBody = document.getElementById('tabla-expedientes-body-pjf');
        if (tablaBody) {
            tablaBody.innerHTML = pjfExps.map(exp => `
                <tr data-id="${exp.id}">
                    <td class="tipo-cell">${exp.numero ? '🔢' : '👤'}</td>
                    <td><strong>${escapeText(exp.numero || exp.nombre)}</strong></td>
                    <td>${escapeText(exp.juzgado)}</td>
                    <td><span class="categoria-badge">${escapeText(exp.categoria || 'PJF Federal')}</span></td>
                    <td class="comentario-cell" title="${escapeText(exp.comentario || '')}">${escapeText(exp.comentario || '-')}</td>
                    <td>${formatearFecha(exp.fechaCreacion)}</td>
                    <td class="acciones-cell">
                        <button class="btn btn-sm btn-primary" onclick="abrirBusquedaPJFGuardado(${exp.id}, event)" title="Buscar en PJF">🔍</button>
                        <button class="btn btn-sm btn-info" onclick="verHistorialExpediente(${exp.id}, event)" title="Historial">📜</button>
                        <button class="btn btn-sm btn-secondary" onclick="editarExpedientePJF(${exp.id}, event)">✏️</button>
                        <button class="btn btn-sm btn-warning" onclick="mostrarDialogoArchivar(${exp.id}, event)" title="Archivar">📦</button>
                        <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpedientePJF(${exp.id}, event)">🗑️</button>
                    </td>
                </tr>
            `).join('');
        }

        inicializarDragAndDropPJF();
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

        return `
            <div class="evento-item" onclick="editarEvento(${e.id})" style="border-left: 3px solid ${escapeText(e.color || '#3788d8')}">
                <div class="evento-info">
                    <span class="evento-titulo">${escapeText(e.titulo)}</span>
                    <span class="evento-hora">${fechaTexto} - ${horaTexto}</span>
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
    const apiKey = await obtenerConfig('groq_api_key');
    const modelo = await obtenerConfig('groq_model') || 'llama-3.3-70b-versatile';

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
        mostrarToast('Configura tu API Key de Groq en Configuración', 'warning');
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
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelo,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 2000,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Error en la API');
        }

        const data = await response.json();
        const contenido = data.choices[0].message.content;

        const jsonMatch = contenido.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No se pudo parsear la respuesta de la IA');

        const resultado = JSON.parse(jsonMatch[0]);
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

    // Save events
    if (resultado.fechas) {
        for (let i = 0; i < resultado.fechas.length; i++) {
            const checkbox = document.getElementById(`ia-pjf-fecha-${i}`);
            if (checkbox && checkbox.checked) {
                const fecha = resultado.fechas[i];
                const expedienteInfo = expedienteLabel ? ` [PJF Exp. ${expedienteLabel}]` : ' [PJF]';

                const evento = {
                    titulo: `${fecha.descripcion}${expedienteInfo}`,
                    tipo: fecha.tipo === 'audiencia' ? 'audiencia' :
                          fecha.tipo === 'vencimiento' ? 'vencimiento' : 'recordatorio',
                    fechaInicio: new Date(fecha.fecha + (fecha.hora ? `T${fecha.hora}` : 'T09:00')).toISOString(),
                    todoElDia: !fecha.hora,
                    expedienteId: resultado.expedienteId,
                    expedienteTexto: resultado.expedienteTexto || numExpExtraido,
                    numeroExpediente: expedienteLabel,
                    institucion: 'PJF',
                    descripcion: `Expediente PJF: ${expedienteLabel || 'N/A'}${juzgadoExtraido ? '\nÓrgano: ' + juzgadoExtraido : ''}\nExtraído automáticamente por IA`,
                    alerta: true,
                    color: fecha.tipo === 'audiencia' ? '#3788d8' :
                           fecha.tipo === 'vencimiento' ? '#dc3545' : '#ffc107'
                };

                try {
                    await agregarEvento(evento);
                    guardados++;
                } catch (e) {
                    Logger.error('Error al guardar evento PJF:', e);
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
