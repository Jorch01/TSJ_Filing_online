<script lang="ts">
  import { onMount } from 'svelte';
  import { expedientesStore, expedientesPorCategoria } from '$lib/stores/expedientes';
  import { CATEGORIAS_JUZGADOS, obtenerIdJuzgado } from '$lib/data/juzgados';

  let tipoBusqueda: 'numero' | 'nombre' = 'numero';
  let valorBusqueda = '';
  let juzgadoSeleccionado = '';
  let comentario = '';
  let mensaje = { tipo: '', texto: '' };
  let filtroCategoria = '';
  let busquedaTexto = '';
  let mostrarFormulario = false;

  $: expedientesFiltrados = filtrarExpedientes($expedientesStore.expedientes, filtroCategoria, busquedaTexto);

  function filtrarExpedientes(expedientes: any[], categoria: string, texto: string) {
    let resultado = expedientes;

    if (categoria) {
      resultado = resultado.filter(e => e.categoria === categoria);
    }

    if (texto) {
      const busqueda = texto.toLowerCase();
      resultado = resultado.filter(e =>
        (e.numero && e.numero.toLowerCase().includes(busqueda)) ||
        (e.nombre && e.nombre.toLowerCase().includes(busqueda)) ||
        e.juzgado.toLowerCase().includes(busqueda) ||
        (e.comentario && e.comentario.toLowerCase().includes(busqueda))
      );
    }

    return resultado;
  }

  async function agregarExpediente() {
    if (!valorBusqueda.trim()) {
      mensaje = { tipo: 'danger', texto: 'Ingresa un número de expediente o nombre' };
      return;
    }

    if (!juzgadoSeleccionado) {
      mensaje = { tipo: 'danger', texto: 'Selecciona un juzgado' };
      return;
    }

    const datos = {
      juzgado: juzgadoSeleccionado,
      comentario: comentario.trim() || undefined
    };

    if (tipoBusqueda === 'numero') {
      (datos as any).numero = valorBusqueda.trim();
    } else {
      (datos as any).nombre = valorBusqueda.trim();
    }

    const resultado = await expedientesStore.agregar(datos);

    if (resultado.exito) {
      mensaje = { tipo: 'success', texto: resultado.mensaje };
      valorBusqueda = '';
      comentario = '';
      mostrarFormulario = false;
    } else {
      mensaje = { tipo: 'danger', texto: resultado.mensaje };
    }

    setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 3000);
  }

  async function eliminarExpediente(id: number) {
    if (confirm('¿Estás seguro de eliminar este expediente?')) {
      await expedientesStore.eliminar(id);
      mensaje = { tipo: 'success', texto: 'Expediente eliminado' };
      setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 3000);
    }
  }

  function limpiarFormulario() {
    valorBusqueda = '';
    juzgadoSeleccionado = '';
    comentario = '';
    tipoBusqueda = 'numero';
  }

  onMount(() => {
    expedientesStore.cargar();
  });
</script>

<svelte:head>
  <title>Expedientes - TSJ Filing Online</title>
</svelte:head>

<div class="expedientes-page">
  <header class="page-header">
    <div class="header-content">
      <h1>📁 Expedientes</h1>
      <p class="subtitle">Gestiona tus expedientes del TSJ</p>
    </div>
    <button class="btn btn-primary btn-lg" on:click={() => mostrarFormulario = !mostrarFormulario}>
      {mostrarFormulario ? '✕ Cerrar' : '➕ Nuevo Expediente'}
    </button>
  </header>

  {#if mensaje.texto}
    <div class="alert alert-{mensaje.tipo}">
      {mensaje.texto}
    </div>
  {/if}

  <!-- Formulario de nuevo expediente -->
  {#if mostrarFormulario}
    <section class="card form-section">
      <div class="card-header">
        <h2>Agregar Nuevo Expediente</h2>
      </div>
      <div class="card-body">
        <form on:submit|preventDefault={agregarExpediente}>
          <div class="form-row">
            <div class="form-group">
              <label>Tipo de búsqueda</label>
              <div class="radio-group">
                <label class="radio-label">
                  <input type="radio" bind:group={tipoBusqueda} value="numero" />
                  <span>Por Número</span>
                </label>
                <label class="radio-label">
                  <input type="radio" bind:group={tipoBusqueda} value="nombre" />
                  <span>Por Nombre</span>
                </label>
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-2">
              <label for="valor">
                {tipoBusqueda === 'numero' ? 'Número de Expediente' : 'Nombre del Actor'}
              </label>
              <input
                type="text"
                id="valor"
                bind:value={valorBusqueda}
                placeholder={tipoBusqueda === 'numero' ? 'Ej: 1234/2025' : 'Ej: Juan Pérez'}
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-2">
              <label for="juzgado">Juzgado</label>
              <select id="juzgado" bind:value={juzgadoSeleccionado}>
                <option value="">Selecciona un juzgado...</option>
                {#each CATEGORIAS_JUZGADOS as categoria}
                  <optgroup label="{categoria.icono} {categoria.nombre}">
                    {#each categoria.juzgados as juzgado}
                      <option value={juzgado}>{juzgado}</option>
                    {/each}
                  </optgroup>
                {/each}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-2">
              <label for="comentario">Comentario (opcional)</label>
              <input
                type="text"
                id="comentario"
                bind:value={comentario}
                placeholder="Notas adicionales..."
              />
            </div>
          </div>

          <div class="form-actions">
            <button type="button" class="btn btn-secondary" on:click={limpiarFormulario}>
              🔄 Limpiar
            </button>
            <button type="submit" class="btn btn-success">
              ➕ Agregar Expediente
            </button>
          </div>
        </form>
      </div>
    </section>
  {/if}

  <!-- Filtros -->
  <section class="filters-section">
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input
        type="text"
        placeholder="Buscar expedientes..."
        bind:value={busquedaTexto}
      />
    </div>

    <select class="filter-select" bind:value={filtroCategoria}>
      <option value="">Todas las categorías</option>
      {#each CATEGORIAS_JUZGADOS as categoria}
        <option value={categoria.nombre}>{categoria.icono} {categoria.nombre}</option>
      {/each}
    </select>

    <span class="results-count">
      {expedientesFiltrados.length} expediente{expedientesFiltrados.length !== 1 ? 's' : ''}
    </span>
  </section>

  <!-- Lista de expedientes -->
  <section class="expedientes-list">
    {#if $expedientesStore.cargando}
      <div class="loading-state">
        <div class="loader"></div>
        <p>Cargando expedientes...</p>
      </div>
    {:else if expedientesFiltrados.length === 0}
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <h3>No hay expedientes</h3>
        <p>
          {#if busquedaTexto || filtroCategoria}
            No se encontraron expedientes con los filtros aplicados.
          {:else}
            Comienza agregando tu primer expediente.
          {/if}
        </p>
        {#if !mostrarFormulario}
          <button class="btn btn-primary" on:click={() => mostrarFormulario = true}>
            ➕ Agregar Expediente
          </button>
        {/if}
      </div>
    {:else}
      <div class="expedientes-grid">
        {#each expedientesFiltrados as expediente (expediente.id)}
          <div class="expediente-card">
            <div class="expediente-header">
              <span class="expediente-tipo">
                {expediente.numero ? '🔢' : '👤'}
              </span>
              <span class="expediente-categoria">{expediente.categoria}</span>
            </div>

            <div class="expediente-body">
              <h3 class="expediente-titulo">
                {expediente.numero || expediente.nombre}
              </h3>
              <p class="expediente-juzgado">{expediente.juzgado}</p>
              {#if expediente.comentario}
                <p class="expediente-comentario">{expediente.comentario}</p>
              {/if}
            </div>

            <div class="expediente-footer">
              <span class="expediente-fecha">
                {new Date(expediente.fechaCreacion).toLocaleDateString('es-MX')}
              </span>
              <div class="expediente-actions">
                <a href="/expedientes/{expediente.id}" class="btn btn-sm btn-secondary">
                  Ver
                </a>
                <button
                  class="btn btn-sm btn-danger"
                  on:click={() => eliminarExpediente(expediente.id)}
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .expedientes-page {
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

  /* Form Section */
  .form-section {
    animation: slideDown 0.3s ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .card-header h2 {
    font-size: var(--font-size-lg);
    margin: 0;
  }

  .form-row {
    display: flex;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }

  .form-group {
    flex: 1;
  }

  .form-group.flex-2 {
    flex: 2;
  }

  .form-group label {
    display: block;
    margin-bottom: var(--spacing-xs);
    font-weight: 500;
    color: var(--text-secondary);
  }

  .radio-group {
    display: flex;
    gap: var(--spacing-lg);
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    cursor: pointer;
  }

  .radio-label input {
    width: auto;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-lg);
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

  /* Expedientes Grid */
  .expedientes-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: var(--spacing-md);
  }

  .expediente-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    transition: var(--transition-fast);
  }

  .expediente-card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }

  .expediente-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
  }

  .expediente-tipo {
    font-size: 1.25rem;
  }

  .expediente-categoria {
    font-size: var(--font-size-xs);
    padding: 2px 8px;
    background: var(--color-primary);
    color: white;
    border-radius: var(--border-radius-sm);
  }

  .expediente-body {
    padding: var(--spacing-md);
    flex: 1;
  }

  .expediente-titulo {
    font-size: var(--font-size-lg);
    margin: 0 0 var(--spacing-sm);
    word-break: break-word;
  }

  .expediente-juzgado {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0 0 var(--spacing-sm);
  }

  .expediente-comentario {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    font-style: italic;
    margin: 0;
  }

  .expediente-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md);
    border-top: 1px solid var(--border-color);
    background: var(--bg-secondary);
  }

  .expediente-fecha {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  .expediente-actions {
    display: flex;
    gap: var(--spacing-xs);
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

    .expedientes-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
