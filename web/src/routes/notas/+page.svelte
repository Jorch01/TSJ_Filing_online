<script lang="ts">
  import { onMount } from 'svelte';
  import { notasStore, COLORES_NOTAS } from '$lib/stores/notas';
  import { expedientesStore } from '$lib/stores/expedientes';
  import type { Nota } from '$lib/services/database';

  let mostrarModal = false;
  let notaEditando: Partial<Nota> = {};
  let mensaje = { tipo: '', texto: '' };
  let filtroExpediente = 0;
  let busquedaTexto = '';

  $: notasFiltradas = filtrarNotas($notasStore.notas, filtroExpediente, busquedaTexto);

  function filtrarNotas(notas: Nota[], expedienteId: number, texto: string) {
    let resultado = notas;

    if (expedienteId > 0) {
      resultado = resultado.filter(n => n.expedienteId === expedienteId);
    }

    if (texto) {
      const busqueda = texto.toLowerCase();
      resultado = resultado.filter(n =>
        n.titulo.toLowerCase().includes(busqueda) ||
        n.contenido.toLowerCase().includes(busqueda)
      );
    }

    return resultado;
  }

  function abrirModalNuevaNota() {
    notaEditando = {
      titulo: '',
      contenido: '',
      color: COLORES_NOTAS[0].valor,
      expedienteId: filtroExpediente > 0 ? filtroExpediente : $expedientesStore.expedientes[0]?.id || 0
    };
    mostrarModal = true;
  }

  function abrirModalEditarNota(nota: Nota) {
    notaEditando = { ...nota };
    mostrarModal = true;
  }

  function cerrarModal() {
    mostrarModal = false;
    notaEditando = {};
  }

  async function guardarNota() {
    if (!notaEditando.titulo?.trim()) {
      mensaje = { tipo: 'danger', texto: 'El título es requerido' };
      return;
    }

    if (!notaEditando.expedienteId) {
      mensaje = { tipo: 'danger', texto: 'Selecciona un expediente' };
      return;
    }

    if (notaEditando.id) {
      await notasStore.actualizar(notaEditando.id, notaEditando);
      mensaje = { tipo: 'success', texto: 'Nota actualizada' };
    } else {
      await notasStore.agregar({
        expedienteId: notaEditando.expedienteId,
        titulo: notaEditando.titulo,
        contenido: notaEditando.contenido || '',
        color: notaEditando.color,
        recordatorio: notaEditando.recordatorio
      });
      mensaje = { tipo: 'success', texto: 'Nota creada' };
    }

    cerrarModal();
    setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 3000);
  }

  async function eliminarNota() {
    if (notaEditando.id && confirm('¿Eliminar esta nota?')) {
      await notasStore.eliminar(notaEditando.id);
      cerrarModal();
      mensaje = { tipo: 'success', texto: 'Nota eliminada' };
      setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 3000);
    }
  }

  function obtenerNombreExpediente(expedienteId: number): string {
    const exp = $expedientesStore.expedientes.find(e => e.id === expedienteId);
    return exp ? (exp.numero || exp.nombre || 'Sin nombre') : 'Expediente no encontrado';
  }

  function formatearFecha(fecha: Date): string {
    return new Date(fecha).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  onMount(() => {
    notasStore.cargarTodas();
    expedientesStore.cargar();
  });
</script>

<svelte:head>
  <title>Notas - TSJ Filing Online</title>
</svelte:head>

<div class="notas-page">
  <header class="page-header">
    <div class="header-content">
      <h1>📝 Notas</h1>
      <p class="subtitle">Organiza tus notas por expediente</p>
    </div>
    <button class="btn btn-primary btn-lg" on:click={abrirModalNuevaNota}>
      ➕ Nueva Nota
    </button>
  </header>

  {#if mensaje.texto}
    <div class="alert alert-{mensaje.tipo}">
      {mensaje.texto}
    </div>
  {/if}

  <!-- Filtros -->
  <section class="filters-section">
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input
        type="text"
        placeholder="Buscar notas..."
        bind:value={busquedaTexto}
      />
    </div>

    <select class="filter-select" bind:value={filtroExpediente}>
      <option value={0}>Todos los expedientes</option>
      {#each $expedientesStore.expedientes as exp}
        <option value={exp.id}>{exp.numero || exp.nombre}</option>
      {/each}
    </select>

    <span class="results-count">
      {notasFiltradas.length} nota{notasFiltradas.length !== 1 ? 's' : ''}
    </span>
  </section>

  <!-- Lista de notas -->
  <section class="notas-grid">
    {#if $notasStore.cargando}
      <div class="loading-state">
        <div class="loader"></div>
        <p>Cargando notas...</p>
      </div>
    {:else if notasFiltradas.length === 0}
      <div class="empty-state">
        <span class="empty-icon">📒</span>
        <h3>No hay notas</h3>
        <p>
          {#if busquedaTexto || filtroExpediente}
            No se encontraron notas con los filtros aplicados.
          {:else}
            Comienza creando tu primera nota.
          {/if}
        </p>
        <button class="btn btn-primary" on:click={abrirModalNuevaNota}>
          ➕ Crear Nota
        </button>
      </div>
    {:else}
      {#each notasFiltradas as nota (nota.id)}
        <button
          class="nota-card"
          style="background-color: {nota.color}"
          on:click={() => abrirModalEditarNota(nota)}
        >
          <div class="nota-header">
            <h3 class="nota-titulo">{nota.titulo}</h3>
            {#if nota.recordatorio}
              <span class="nota-recordatorio" title="Recordatorio: {formatearFecha(nota.recordatorio)}">
                🔔
              </span>
            {/if}
          </div>

          <p class="nota-contenido">{nota.contenido || 'Sin contenido'}</p>

          <div class="nota-footer">
            <span class="nota-expediente">
              📁 {obtenerNombreExpediente(nota.expedienteId)}
            </span>
            <span class="nota-fecha">
              {formatearFecha(nota.fechaCreacion)}
            </span>
          </div>
        </button>
      {/each}
    {/if}
  </section>
</div>

<!-- Modal de nota -->
{#if mostrarModal}
  <div class="modal-overlay" on:click={cerrarModal} on:keydown={cerrarModal}>
    <div class="modal" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="modal-header">
        <h3>{notaEditando.id ? 'Editar Nota' : 'Nueva Nota'}</h3>
        <button class="modal-close" on:click={cerrarModal}>✕</button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label for="expediente">Expediente *</label>
          <select id="expediente" bind:value={notaEditando.expedienteId}>
            <option value={0}>Selecciona un expediente...</option>
            {#each $expedientesStore.expedientes as exp}
              <option value={exp.id}>{exp.numero || exp.nombre} - {exp.juzgado}</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label for="titulo">Título *</label>
          <input
            type="text"
            id="titulo"
            bind:value={notaEditando.titulo}
            placeholder="Título de la nota..."
          />
        </div>

        <div class="form-group">
          <label for="contenido">Contenido</label>
          <textarea
            id="contenido"
            bind:value={notaEditando.contenido}
            rows="6"
            placeholder="Escribe aquí el contenido de tu nota..."
          ></textarea>
        </div>

        <div class="form-group">
          <label>Color</label>
          <div class="color-picker">
            {#each COLORES_NOTAS as color}
              <button
                type="button"
                class="color-option"
                class:selected={notaEditando.color === color.valor}
                style="background-color: {color.valor}; color: {color.texto}"
                on:click={() => notaEditando.color = color.valor}
                title={color.nombre}
              >
                {#if notaEditando.color === color.valor}✓{/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="form-group">
          <label for="recordatorio">Recordatorio (opcional)</label>
          <input
            type="datetime-local"
            id="recordatorio"
            value={notaEditando.recordatorio ? new Date(notaEditando.recordatorio).toISOString().slice(0, 16) : ''}
            on:change={(e) => notaEditando.recordatorio = e.currentTarget.value ? new Date(e.currentTarget.value) : undefined}
          />
        </div>
      </div>

      <div class="modal-footer">
        {#if notaEditando.id}
          <button class="btn btn-danger" on:click={eliminarNota}>
            🗑️ Eliminar
          </button>
        {/if}
        <div class="modal-footer-right">
          <button class="btn btn-secondary" on:click={cerrarModal}>
            Cancelar
          </button>
          <button class="btn btn-primary" on:click={guardarNota}>
            {notaEditando.id ? 'Guardar Cambios' : 'Crear Nota'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .notas-page {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xl);
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--spacing-md);
  }

  .header-content h1 {
    margin-bottom: var(--spacing-xs);
  }

  .subtitle {
    color: var(--text-secondary);
    margin: 0;
  }

  /* Filters */
  .filters-section {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    flex-wrap: wrap;
  }

  .search-box {
    position: relative;
    flex: 1;
    min-width: 200px;
  }

  .search-icon {
    position: absolute;
    left: var(--spacing-md);
    top: 50%;
    transform: translateY(-50%);
  }

  .search-box input {
    padding-left: 2.5rem;
  }

  .filter-select {
    min-width: 200px;
  }

  .results-count {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }

  /* Loading & Empty States */
  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-2xl);
    background: var(--bg-primary);
    border-radius: var(--border-radius-lg);
    text-align: center;
    grid-column: 1 / -1;
  }

  .empty-icon {
    font-size: 4rem;
    margin-bottom: var(--spacing-md);
    opacity: 0.5;
  }

  .empty-state h3 {
    margin-bottom: var(--spacing-sm);
  }

  .empty-state p {
    color: var(--text-secondary);
    margin-bottom: var(--spacing-lg);
  }

  /* Notas Grid */
  .notas-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--spacing-md);
  }

  .nota-card {
    display: flex;
    flex-direction: column;
    padding: var(--spacing-md);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    border: none;
    text-align: left;
    transition: var(--transition-fast);
    min-height: 180px;
  }

  .nota-card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }

  .nota-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--spacing-sm);
  }

  .nota-titulo {
    font-size: var(--font-size-md);
    margin: 0;
    word-break: break-word;
  }

  .nota-recordatorio {
    font-size: 1.25rem;
  }

  .nota-contenido {
    flex: 1;
    font-size: var(--font-size-sm);
    color: inherit;
    opacity: 0.8;
    margin: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
  }

  .nota-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-sm);
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    font-size: var(--font-size-xs);
    opacity: 0.7;
  }

  .nota-expediente {
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Modal */
  .modal {
    width: 100%;
    max-width: 500px;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    color: var(--text-secondary);
  }

  .form-group {
    margin-bottom: var(--spacing-md);
  }

  .form-group label {
    display: block;
    margin-bottom: var(--spacing-xs);
    font-weight: 500;
  }

  textarea {
    resize: vertical;
  }

  .color-picker {
    display: flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .color-option {
    width: 36px;
    height: 36px;
    border: 2px solid transparent;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    transition: var(--transition-fast);
  }

  .color-option:hover {
    transform: scale(1.1);
  }

  .color-option.selected {
    border-color: var(--text-primary);
  }

  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-footer-right {
    display: flex;
    gap: var(--spacing-sm);
  }

  /* Responsive */
  @media (max-width: 768px) {
    .page-header {
      flex-direction: column;
      align-items: stretch;
    }

    .filters-section {
      flex-direction: column;
      align-items: stretch;
    }

    .filter-select {
      width: 100%;
    }

    .notas-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
