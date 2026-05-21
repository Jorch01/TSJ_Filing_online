// ==================== TIMELINE DE EXPEDIENTE ====================
// Cronología visual unificada: historial de cambios + notas + eventos
// en una sola línea de tiempo ordenada por fecha.
// Solo lectura — no modifica ningún dato.

async function verTimelineExpediente(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const expediente = await obtenerExpediente(id);
    if (!expediente) {
        mostrarToast('Expediente no encontrado', 'error');
        return;
    }

    // Obtener todos los datos relacionados en paralelo
    const [historial, todasNotas, todosEventos] = await Promise.all([
        obtenerHistorialExpediente(id).catch(() => []),
        obtenerNotas().catch(() => []),
        obtenerEventos().catch(() => [])
    ]);

    const notas = todasNotas.filter(n => n.expedienteId === id);
    const eventos = todosEventos.filter(ev => ev.expedienteId === id);

    // Construir lista unificada
    const items = [];

    historial.forEach(h => {
        const iconos = { creacion: '🆕', edicion: '✏️', eliminacion: '🗑️' };
        const titulos = { creacion: 'Expediente creado', edicion: 'Editado', eliminacion: 'Eliminado' };
        items.push({
            tipo: 'historial',
            clase: `tl-historial tl-${h.tipo || 'edicion'}`,
            fecha: h.fecha,
            icono: iconos[h.tipo] || '📋',
            titulo: titulos[h.tipo] || 'Cambio',
            descripcion: h.descripcion || '',
            accionLabel: null,
            accionFn: null
        });
    });

    notas.forEach(n => {
        items.push({
            tipo: 'nota',
            clase: 'tl-nota',
            fecha: n.fechaActualizacion || n.fechaCreacion,
            icono: '📝',
            titulo: n.titulo || 'Nota',
            descripcion: (n.contenido || '').substring(0, 150),
            accionLabel: 'Abrir nota',
            accionFn: `cerrarModal(); setTimeout(() => { navegarA('notas'); setTimeout(() => editarNota(${n.id}), 150); }, 80)`
        });
    });

    eventos.forEach(ev => {
        items.push({
            tipo: 'evento',
            clase: 'tl-evento',
            fecha: ev.fechaInicio,
            icono: '📅',
            titulo: ev.titulo || 'Evento',
            descripcion: ev.descripcion || '',
            accionLabel: 'Abrir evento',
            accionFn: `cerrarModal(); setTimeout(() => { navegarA('calendario'); setTimeout(() => editarEvento(${ev.id}), 250); }, 80)`
        });
    });

    // Ordenar por fecha, más reciente primero
    items.sort((a, b) => {
        const da = a.fecha ? new Date(a.fecha) : new Date(0);
        const db = b.fecha ? new Date(b.fecha) : new Date(0);
        return db - da;
    });

    const nombreExpediente = expediente.numero || expediente.nombre || 'Expediente';

    const esc = (str) => {
        if (!str) return '';
        const d = document.createElement('span');
        d.textContent = String(str);
        return d.innerHTML;
    };

    const fmtFecha = (f) => {
        if (!f) return '';
        if (typeof formatearFechaHora === 'function') return formatearFechaHora(f);
        try { return new Date(f).toLocaleString('es-MX'); } catch { return f; }
    };

    let contenidoHTML;

    if (items.length === 0) {
        contenidoHTML = `
            <div class="empty-state small" style="padding:2.5rem;text-align:center">
                <div style="font-size:2rem;margin-bottom:0.5rem">📅</div>
                <p style="color:var(--text-secondary,#6c757d)">No hay actividad registrada aún</p>
            </div>`;
    } else {
        contenidoHTML = `
            <div class="tl-resumen">
                <span class="tl-badge tl-badge-historial">✏️ ${historial.length} cambios</span>
                <span class="tl-badge tl-badge-nota">📝 ${notas.length} nota${notas.length !== 1 ? 's' : ''}</span>
                <span class="tl-badge tl-badge-evento">📅 ${eventos.length} evento${eventos.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="tl-lista">
                ${items.map(item => `
                    <div class="${item.clase} tl-item">
                        <div class="tl-linea">
                            <div class="tl-punto">${item.icono}</div>
                        </div>
                        <div class="tl-contenido">
                            <div class="tl-header">
                                <span class="tl-titulo">${esc(item.titulo)}</span>
                                <span class="tl-fecha">${esc(fmtFecha(item.fecha))}</span>
                            </div>
                            ${item.descripcion ? `<p class="tl-desc">${esc(item.descripcion)}</p>` : ''}
                            ${item.accionLabel ? `<button class="btn btn-sm btn-outline-secondary tl-btn-abrir"
                                onclick="${item.accionFn}">${esc(item.accionLabel)} →</button>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    document.getElementById('modal-titulo').textContent = `📅 Timeline: ${nombreExpediente}`;
    document.getElementById('modal-body').innerHTML = contenidoHTML;
    document.getElementById('modal-footer').innerHTML =
        `<button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>`;
    document.getElementById('modal-overlay').classList.add('active');
}

window.verTimelineExpediente = verTimelineExpediente;
