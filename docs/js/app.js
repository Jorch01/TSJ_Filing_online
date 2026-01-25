/**
 * TSJ Filing Online - Aplicación Principal
 */

// Estado global
let expedientesSeleccionados = [];
let fechaCalendario = new Date();
let diaSeleccionado = null;

// ==================== INICIALIZACIÓN ====================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        await inicializarApp();
        console.log('Aplicación inicializada correctamente');
    } catch (error) {
        console.error('Error al inicializar:', error);
        mostrarToast('Error al cargar la aplicación', 'error');
    }
});

async function inicializarApp() {
    // Poblar selects
    poblarSelectJuzgados('expediente-juzgado');
    poblarSelectCategorias('filtro-categoria');

    // Cargar datos
    await cargarEstadisticas();
    await cargarExpedientes();
    await cargarNotas();
    await cargarEventos();
    renderizarCalendario();

    // Configurar eventos de navegación
    configurarNavegacion();
    configurarFormularios();

    // Cargar configuración
    await cargarConfiguracion();
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
    const expedientes = await obtenerExpedientes();
    const lista = document.getElementById('lista-expedientes');
    const count = document.getElementById('count-expedientes');

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

    lista.innerHTML = expedientes.map(exp => `
        <div class="expediente-card" data-id="${exp.id}">
            <div class="expediente-header">
                <span class="expediente-tipo">${exp.numero ? '🔢' : '👤'}</span>
                <span class="expediente-categoria">${exp.categoria || 'General'}</span>
            </div>
            <div class="expediente-body">
                <h3 class="expediente-titulo">${exp.numero || exp.nombre}</h3>
                <p class="expediente-juzgado">${exp.juzgado}</p>
                ${exp.comentario ? `<p class="expediente-comentario">${exp.comentario}</p>` : ''}
            </div>
            <div class="expediente-footer">
                <span class="expediente-fecha">${formatearFecha(exp.fechaCreacion)}</span>
                <div class="expediente-actions">
                    <button class="btn btn-sm btn-secondary" onclick="editarExpediente(${exp.id})">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpediente(${exp.id}, event)">🗑️</button>
                </div>
            </div>
        </div>
    `).join('');

    count.textContent = `${expedientes.length} expediente${expedientes.length !== 1 ? 's' : ''}`;

    // Actualizar select de expedientes en notas
    actualizarSelectExpedientes();

    // Actualizar expedientes recientes en dashboard
    actualizarExpedientesRecientes(expedientes);
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
                <span class="list-item-title">${exp.numero || exp.nombre}</span>
                <span class="list-item-subtitle">${exp.juzgado}</span>
            </div>
        </div>
    `).join('');
}

function actualizarSelectExpedientes() {
    obtenerExpedientes().then(expedientes => {
        const select = document.getElementById('filtro-expediente-nota');
        if (select) {
            select.innerHTML = '<option value="">Todos los expedientes</option>' +
                expedientes.map(e => `<option value="${e.id}">${e.numero || e.nombre}</option>`).join('');
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
    document.getElementById('form-expediente').style.display = 'none';
}

async function editarExpediente(id) {
    const exp = await obtenerExpediente(id);
    if (!exp) return;

    document.getElementById('form-expediente').style.display = 'block';
    document.getElementById('form-expediente-titulo').textContent = 'Editar Expediente';
    document.getElementById('expediente-id').value = id;
    document.getElementById('expediente-valor').value = exp.numero || exp.nombre;
    document.getElementById('expediente-juzgado').value = exp.juzgado;
    document.getElementById('expediente-comentario').value = exp.comentario || '';

    const tipo = exp.numero ? 'numero' : 'nombre';
    document.querySelector(`input[name="tipo-busqueda"][value="${tipo}"]`).checked = true;
}

async function guardarExpediente(event) {
    event.preventDefault();

    const id = document.getElementById('expediente-id').value;
    const tipoBusqueda = document.querySelector('input[name="tipo-busqueda"]:checked').value;
    const valor = document.getElementById('expediente-valor').value.trim();
    const juzgado = document.getElementById('expediente-juzgado').value;
    const comentario = document.getElementById('expediente-comentario').value.trim();

    if (!valor || !juzgado) {
        mostrarToast('Completa todos los campos requeridos', 'error');
        return;
    }

    const expediente = {
        juzgado,
        categoria: obtenerCategoriaJuzgado(juzgado),
        comentario: comentario || undefined
    };

    if (tipoBusqueda === 'numero') {
        expediente.numero = valor;
    } else {
        expediente.nombre = valor;
    }

    try {
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
    } catch (error) {
        mostrarToast('Error al guardar: ' + error.message, 'error');
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
                return Promise.all([cargarExpedientes(), cargarEstadisticas()]);
            })
            .catch(err => {
                console.error('Error al eliminar expediente:', err);
                mostrarToast('Error al eliminar: ' + (err.message || 'Error desconocido'), 'error');
            });
    }
}

async function filtrarExpedientes() {
    const busqueda = document.getElementById('buscar-expediente').value.toLowerCase();
    const categoria = document.getElementById('filtro-categoria').value;

    let expedientes = await obtenerExpedientes();

    if (busqueda) {
        expedientes = expedientes.filter(e =>
            (e.numero && e.numero.toLowerCase().includes(busqueda)) ||
            (e.nombre && e.nombre.toLowerCase().includes(busqueda)) ||
            e.juzgado.toLowerCase().includes(busqueda)
        );
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
        lista.innerHTML = expedientes.map(exp => `
            <div class="expediente-card" data-id="${exp.id}">
                <div class="expediente-header">
                    <span class="expediente-tipo">${exp.numero ? '🔢' : '👤'}</span>
                    <span class="expediente-categoria">${exp.categoria || 'General'}</span>
                </div>
                <div class="expediente-body">
                    <h3 class="expediente-titulo">${exp.numero || exp.nombre}</h3>
                    <p class="expediente-juzgado">${exp.juzgado}</p>
                </div>
                <div class="expediente-footer">
                    <span class="expediente-fecha">${formatearFecha(exp.fechaCreacion)}</span>
                    <div class="expediente-actions">
                        <button class="btn btn-sm btn-secondary" onclick="editarExpediente(${exp.id})">✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="confirmarEliminarExpediente(${exp.id}, event)">🗑️</button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    count.textContent = `${expedientes.length} expediente${expedientes.length !== 1 ? 's' : ''}`;
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
        return `
            <div class="nota-card" style="background-color: ${nota.color || '#fff3cd'}" onclick="editarNota(${nota.id})">
                <div class="nota-header">
                    <h3 class="nota-titulo">${nota.titulo}</h3>
                    ${nota.recordatorio ? '<span class="nota-recordatorio">🔔</span>' : ''}
                </div>
                <p class="nota-contenido">${nota.contenido || 'Sin contenido'}</p>
                <div class="nota-footer">
                    <span class="nota-expediente">📁 ${exp ? (exp.numero || exp.nombre) : 'Sin expediente'}</span>
                    <span class="nota-fecha">${formatearFecha(nota.fechaCreacion)}</span>
                </div>
            </div>
        `;
    }).join('');

    count.textContent = `${notas.length} nota${notas.length !== 1 ? 's' : ''}`;
}

function mostrarFormularioNota() {
    const expedientes = obtenerExpedientes().then(exps => {
        const selectHtml = exps.map(e =>
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
                    <label>Expediente</label>
                    <select id="nota-expediente" required>
                        <option value="">Selecciona un expediente...</option>
                        ${selectHtml}
                    </select>
                </div>
                <div class="form-group">
                    <label>Título</label>
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
    const expedienteId = parseInt(document.getElementById('nota-expediente').value);
    const titulo = document.getElementById('nota-titulo').value.trim();
    const contenido = document.getElementById('nota-contenido').value.trim();
    const color = document.getElementById('nota-color').value;
    const recordatorio = document.getElementById('nota-recordatorio').value;

    if (!expedienteId || !titulo) {
        mostrarToast('Completa los campos requeridos', 'error');
        return;
    }

    const nota = {
        expedienteId,
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
        document.getElementById('nota-expediente').value = nota.expedienteId;
        document.getElementById('nota-titulo').value = nota.titulo;
        document.getElementById('nota-contenido').value = nota.contenido || '';
        document.getElementById('nota-color').value = nota.color || '#fff3cd';
        if (nota.recordatorio) {
            document.getElementById('nota-recordatorio').value = nota.recordatorio.slice(0, 16);
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
    const expedienteId = document.getElementById('filtro-expediente-nota').value;

    let notas = await obtenerNotas();
    const expedientes = await obtenerExpedientes();
    const expMap = Object.fromEntries(expedientes.map(e => [e.id, e]));

    if (busqueda) {
        notas = notas.filter(n =>
            n.titulo.toLowerCase().includes(busqueda) ||
            (n.contenido && n.contenido.toLowerCase().includes(busqueda))
        );
    }

    if (expedienteId) {
        notas = notas.filter(n => n.expedienteId === parseInt(expedienteId));
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
            return `
                <div class="nota-card" style="background-color: ${nota.color || '#fff3cd'}" onclick="editarNota(${nota.id})">
                    <div class="nota-header">
                        <h3 class="nota-titulo">${nota.titulo}</h3>
                    </div>
                    <p class="nota-contenido">${nota.contenido || 'Sin contenido'}</p>
                    <div class="nota-footer">
                        <span class="nota-expediente">📁 ${exp ? (exp.numero || exp.nombre) : 'Sin expediente'}</span>
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
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    const eventosHoy = eventos.filter(e => {
        const fecha = new Date(e.fechaInicio);
        return fecha >= hoy && fecha < manana;
    });

    const container = document.getElementById('eventos-hoy');

    if (eventosHoy.length === 0) {
        container.innerHTML = `
            <div class="empty-state small">
                <span>🎉</span>
                <p>No hay eventos para hoy</p>
            </div>
        `;
    } else {
        container.innerHTML = eventosHoy.map(e => `
            <div class="list-item" style="border-left: 3px solid ${e.color || '#3788d8'}">
                <div class="list-item-info">
                    <span class="list-item-title">${e.titulo}</span>
                    <span class="list-item-subtitle">${new Date(e.fechaInicio).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            </div>
        `).join('');
    }
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

        let clases = 'dia-cell';
        if (esHoy) clases += ' es-hoy';
        if (diaSeleccionado && dia.getTime() === diaSeleccionado.getTime()) clases += ' seleccionado';

        let dotsHtml = '';
        if (eventosDelDia.length > 0) {
            dotsHtml = `<div class="dia-eventos">
                ${eventosDelDia.slice(0, 3).map(e => `<span class="evento-dot" style="background:${e.color || '#3788d8'}"></span>`).join('')}
                ${eventosDelDia.length > 3 ? `<span class="eventos-mas">+${eventosDelDia.length - 3}</span>` : ''}
            </div>`;
        }

        diasHtml.push(`
            <div class="${clases}" onclick="seleccionarDia(${dia.getTime()})" ondblclick="crearEventoEnDia(${dia.getTime()})">
                <span class="dia-numero">${i}</span>
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

    if (eventosAMostrar.length === 0) {
        panel.innerHTML = `
            <div class="empty-state small">
                <span>📭</span>
                <p>No hay eventos</p>
                <button class="btn btn-sm btn-outline" onclick="mostrarFormularioEvento()">Crear evento</button>
            </div>
        `;
    } else {
        panel.innerHTML = eventosAMostrar.map(e => `
            <div class="evento-item" onclick="editarEvento(${e.id})" style="border-left: 3px solid ${e.color || '#3788d8'}">
                <div class="evento-info">
                    <span class="evento-titulo">${e.titulo}</span>
                    <span class="evento-hora">${e.todoElDia ? 'Todo el día' : new Date(e.fechaInicio).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                ${e.alerta ? '<span class="evento-alerta">🔔</span>' : ''}
            </div>
        `).join('');
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
                <select id="evento-expediente">${selectHtml}</select>
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
    const expedienteId = document.getElementById('evento-expediente').value;
    const descripcion = document.getElementById('evento-descripcion').value.trim();
    const alerta = document.getElementById('evento-alerta').checked;

    if (!titulo || !fechaInicio) {
        mostrarToast('Completa los campos requeridos', 'error');
        return;
    }

    const evento = {
        titulo,
        tipo,
        fechaInicio: new Date(fechaInicio).toISOString(),
        todoElDia,
        expedienteId: expedienteId ? parseInt(expedienteId) : null,
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
        document.getElementById('evento-expediente').value = evento.expedienteId || '';
        document.getElementById('evento-descripcion').value = evento.descripcion || '';
        document.getElementById('evento-alerta').checked = evento.alerta;

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
    const expedientes = await obtenerExpedientes();
    const container = document.getElementById('expedientes-busqueda');

    if (expedientes.length === 0) {
        container.innerHTML = `
            <div class="empty-state small">
                <span>📂</span>
                <p>No hay expedientes. Agrega algunos primero.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = expedientes.map(exp => `
        <label class="expediente-seleccion-item ${expedientesSeleccionados.includes(exp.id) ? 'selected' : ''}">
            <input type="checkbox" ${expedientesSeleccionados.includes(exp.id) ? 'checked' : ''} onchange="toggleExpedienteSeleccion(${exp.id})">
            <div class="exp-info">
                <span class="exp-numero">${exp.numero || exp.nombre}</span>
                <span class="exp-juzgado">${exp.juzgado}</span>
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
    if (expedientesSeleccionados.length === expedientes.length) {
        expedientesSeleccionados = [];
    } else {
        expedientesSeleccionados = expedientes.map(e => e.id);
    }
    cargarExpedientesParaBusqueda();
}

async function generarURLsBusqueda() {
    if (expedientesSeleccionados.length === 0) {
        mostrarToast('Selecciona al menos un expediente', 'warning');
        return;
    }

    const expedientes = await obtenerExpedientes();
    const seleccionados = expedientes.filter(e => expedientesSeleccionados.includes(e.id));

    const urlsContainer = document.getElementById('urls-generadas');
    const listaUrls = document.getElementById('lista-urls');

    listaUrls.innerHTML = seleccionados.map(exp => {
        const tipoBusqueda = exp.numero ? 'numero' : 'nombre';
        const valor = exp.numero || exp.nombre;
        const url = construirUrlBusqueda(exp.juzgado, tipoBusqueda, valor);

        return `
            <div class="url-item">
                <div class="url-info">
                    <span class="url-expediente">${exp.numero || exp.nombre}</span>
                    <span class="url-juzgado">${exp.juzgado}</span>
                </div>
                <div class="url-actions">
                    <button class="btn btn-sm btn-secondary" onclick="copiarURL('${url}')" title="Copiar">📋</button>
                    <a href="${url}" target="_blank" class="btn btn-sm btn-primary">🔗 Abrir</a>
                </div>
            </div>
        `;
    }).join('');

    urlsContainer.style.display = 'block';
    mostrarToast(`${seleccionados.length} URLs generadas`, 'success');
}

function copiarURL(url) {
    navigator.clipboard.writeText(url);
    mostrarToast('URL copiada', 'success');
}

async function copiarTodasURLs() {
    const expedientes = await obtenerExpedientes();
    const seleccionados = expedientes.filter(e => expedientesSeleccionados.includes(e.id));

    const urls = seleccionados.map(exp => {
        const tipoBusqueda = exp.numero ? 'numero' : 'nombre';
        const valor = exp.numero || exp.nombre;
        return construirUrlBusqueda(exp.juzgado, tipoBusqueda, valor);
    }).join('\n');

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
}

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
    mostrarToast('Función de prueba de email pendiente', 'info');
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

        if (confirm(`¿Importar ${datos.expedientes?.length || 0} expedientes, ${datos.notas?.length || 0} notas y ${datos.eventos?.length || 0} eventos?`)) {
            await importarTodosDatos(datos, true);
            await cargarExpedientes();
            await cargarNotas();
            await cargarEventos();
            await cargarEstadisticas();
            renderizarCalendario();
            mostrarToast('Datos importados correctamente', 'success');
        }
    } catch (error) {
        mostrarToast('Error al importar: ' + error.message, 'error');
    }

    event.target.value = '';
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

// ==================== IMPORTACIÓN CSV/EXCEL ====================

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
            console.warn('Errores en importación:', errores);
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
                console.error('Error al agregar expediente:', e);
            }
        }

        await cargarExpedientes();
        await cargarEstadisticas();

        mostrarToast(`${importados} expedientes importados correctamente`, 'success');

    } catch (error) {
        console.error('Error al importar:', error);
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
