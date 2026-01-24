<script lang="ts">
  import { onMount } from 'svelte';
  import { expedientesStore } from '$lib/stores/expedientes';
  import { publicacionesStore } from '$lib/stores/expedientes';
  import { construirUrlBusqueda, esSalaSegundaInstancia, obtenerIdJuzgado } from '$lib/data/juzgados';
  import { exportarResultadosBusqueda } from '$lib/services/exportacion';
  import type { Expediente, Publicacion } from '$lib/services/database';

  let buscando = false;
  let progreso = 0;
  let mensaje = { tipo: '', texto: '' };
  let expedientesSeleccionados: number[] = [];
  let resultadosBusqueda: Map<number, any[]> = new Map();
  let extensionConectada = false;
  let modoManual = false;
  let urlActual = '';

  // Verificar conexión con extensión
  async function verificarExtension() {
    try {
      // Intentar conectar con la extensión
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        const EXTENSION_ID = 'tu-extension-id'; // Reemplazar con ID real
        const port = chrome.runtime.connect(EXTENSION_ID);
        port.postMessage({ tipo: 'ping' });
        port.onMessage.addListener((msg) => {
          if (msg.tipo === 'pong') {
            extensionConectada = true;
          }
        });
      }
    } catch (e) {
      extensionConectada = false;
    }
  }

  function seleccionarTodos() {
    if (expedientesSeleccionados.length === $expedientesStore.expedientes.length) {
      expedientesSeleccionados = [];
    } else {
      expedientesSeleccionados = $expedientesStore.expedientes.map(e => e.id!);
    }
  }

  function toggleExpediente(id: number) {
    if (expedientesSeleccionados.includes(id)) {
      expedientesSeleccionados = expedientesSeleccionados.filter(e => e !== id);
    } else {
      expedientesSeleccionados = [...expedientesSeleccionados, id];
    }
  }

  async function iniciarBusqueda() {
    if (expedientesSeleccionados.length === 0) {
      mensaje = { tipo: 'warning', texto: 'Selecciona al menos un expediente' };
      return;
    }

    if (!extensionConectada) {
      // Modo manual: mostrar URLs
      modoManual = true;
      return;
    }

    buscando = true;
    progreso = 0;
    resultadosBusqueda = new Map();

    const total = expedientesSeleccionados.length;
    let completados = 0;

    for (const id of expedientesSeleccionados) {
      const exp = $expedientesStore.expedientes.find(e => e.id === id);
      if (!exp) continue;

      try {
        // Construir URL de búsqueda
        const juzgadoId = obtenerIdJuzgado(exp.juzgado);
        if (!juzgadoId) continue;

        const esSala = esSalaSegundaInstancia(exp.juzgado);
        const url = construirUrlBusqueda(
          juzgadoId,
          exp.numero ? 'numero' : 'nombre',
          exp.numero || exp.nombre || '',
          esSala
        );

        // Enviar a la extensión
        // Esta parte se completa cuando la extensión está conectada

      } catch (error) {
        console.error('Error en búsqueda:', error);
      }

      completados++;
      progreso = Math.round((completados / total) * 100);
    }

    buscando = false;
    mensaje = { tipo: 'success', texto: `Búsqueda completada: ${completados} expedientes procesados` };
  }

  function obtenerUrlBusqueda(exp: Expediente): string {
    const juzgadoId = obtenerIdJuzgado(exp.juzgado);
    if (!juzgadoId) return '';

    const esSala = esSalaSegundaInstancia(exp.juzgado);
    return construirUrlBusqueda(
      juzgadoId,
      exp.numero ? 'numero' : 'nombre',
      exp.numero || exp.nombre || '',
      esSala
    );
  }

  function copiarUrl(url: string) {
    navigator.clipboard.writeText(url);
    mensaje = { tipo: 'success', texto: 'URL copiada al portapapeles' };
    setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 2000);
  }

  function abrirUrl(url: string) {
    window.open(url, '_blank');
  }

  function exportarResultados() {
    const expedientes = $expedientesStore.expedientes.filter(e =>
      expedientesSeleccionados.includes(e.id!)
    );
    exportarResultadosBusqueda(expedientes, resultadosBusqueda);
  }

  onMount(() => {
    expedientesStore.cargar();
    verificarExtension();

    // Escuchar mensajes de la extensión
    window.addEventListener('message', (event) => {
      if (event.data.tipo === 'resultados_busqueda') {
        resultadosBusqueda.set(event.data.expedienteId, event.data.resultados);
        resultadosBusqueda = resultadosBusqueda;
      }
    });
  });
</script>

<svelte:head>
  <title>Búsqueda - TSJ Filing Online</title>
</svelte:head>

<div class="busqueda-page">
  <header class="page-header">
    <div class="header-content">
      <h1>🔍 Búsqueda de Expedientes</h1>
      <p class="subtitle">Busca publicaciones en el TSJ de Quintana Roo</p>
    </div>
  </header>

  {#if mensaje.texto}
    <div class="alert alert-{mensaje.tipo}">
      {mensaje.texto}
    </div>
  {/if}

  <!-- Estado de la extensión -->
  <div class="extension-status" class:connected={extensionConectada}>
    <span class="status-icon">
      {extensionConectada ? '🟢' : '🟡'}
    </span>
    <div class="status-info">
      <span class="status-title">
        {extensionConectada ? 'Extensión conectada' : 'Modo manual'}
      </span>
      <span class="status-desc">
        {extensionConectada
          ? 'Las búsquedas se realizarán automáticamente'
          : 'Instala la extensión o usa las URLs directamente'}
      </span>
    </div>
    {#if !extensionConectada}
      <a href="/configuracion#extension" class="btn btn-sm btn-outline">
        Instalar extensión
      </a>
    {/if}
  </div>

  <!-- Selección de expedientes -->
  <section class="card">
    <div class="card-header">
      <h2>Selecciona los expedientes a buscar</h2>
      <div class="header-actions">
        <button class="btn btn-sm btn-secondary" on:click={seleccionarTodos}>
          {expedientesSeleccionados.length === $expedientesStore.expedientes.length ? '✕ Deseleccionar' : '✓ Seleccionar'} todos
        </button>
        <span class="selection-count">
          {expedientesSeleccionados.length} de {$expedientesStore.expedientes.length} seleccionados
        </span>
      </div>
    </div>

    <div class="card-body">
      {#if $expedientesStore.expedientes.length === 0}
        <div class="empty-state">
          <span class="empty-icon">📂</span>
          <p>No hay expedientes. Agrega algunos primero.</p>
          <a href="/expedientes" class="btn btn-primary">
            ➕ Agregar Expedientes
          </a>
        </div>
      {:else}
        <div class="expedientes-list">
          {#each $expedientesStore.expedientes as exp (exp.id)}
            <label class="expediente-item" class:selected={expedientesSeleccionados.includes(exp.id!)}>
              <input
                type="checkbox"
                checked={expedientesSeleccionados.includes(exp.id!)}
                on:change={() => toggleExpediente(exp.id!)}
              />
              <div class="expediente-info">
                <span class="expediente-numero">{exp.numero || exp.nombre}</span>
                <span class="expediente-juzgado">{exp.juzgado}</span>
              </div>
              {#if resultadosBusqueda.has(exp.id!)}
                <span class="resultado-badge">
                  {resultadosBusqueda.get(exp.id!)?.length || 0} resultados
                </span>
              {/if}
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <div class="card-footer">
      <button
        class="btn btn-primary btn-lg"
        on:click={iniciarBusqueda}
        disabled={buscando || expedientesSeleccionados.length === 0}
      >
        {#if buscando}
          <span class="loader-sm"></span>
          Buscando... {progreso}%
        {:else}
          🚀 Iniciar Búsqueda
        {/if}
      </button>

      {#if resultadosBusqueda.size > 0}
        <button class="btn btn-success" on:click={exportarResultados}>
          📥 Exportar Resultados
        </button>
      {/if}
    </div>
  </section>

  <!-- Modo manual (URLs) -->
  {#if modoManual && expedientesSeleccionados.length > 0}
    <section class="card">
      <div class="card-header">
        <h2>🔗 URLs de Búsqueda (Modo Manual)</h2>
        <button class="btn btn-sm btn-secondary" on:click={() => modoManual = false}>
          Cerrar
        </button>
      </div>
      <div class="card-body">
        <p class="manual-instructions">
          Haz clic en cada enlace para abrir la búsqueda en el sitio del TSJ.
          Los resultados se mostrarán en una nueva pestaña.
        </p>

        <div class="urls-list">
          {#each $expedientesStore.expedientes.filter(e => expedientesSeleccionados.includes(e.id!)) as exp}
            {@const url = obtenerUrlBusqueda(exp)}
            <div class="url-item">
              <div class="url-info">
                <span class="url-expediente">{exp.numero || exp.nombre}</span>
                <span class="url-juzgado">{exp.juzgado}</span>
              </div>
              <div class="url-actions">
                <button class="btn btn-sm btn-secondary" on:click={() => copiarUrl(url)} title="Copiar URL">
                  📋
                </button>
                <button class="btn btn-sm btn-primary" on:click={() => abrirUrl(url)} title="Abrir en TSJ">
                  🔗 Abrir
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <!-- Barra de progreso -->
  {#if buscando}
    <div class="progress-bar">
      <div class="progress-fill" style="width: {progreso}%"></div>
    </div>
  {/if}
</div>

<style>
  .busqueda-page {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-content h1 {
    margin-bottom: var(--spacing-xs);
  }

  .subtitle {
    color: var(--text-secondary);
    margin: 0;
  }

  /* Extension Status */
  .extension-status {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-md) var(--spacing-lg);
    background: #fff3cd;
    border-radius: var(--border-radius);
    border-left: 4px solid #ffc107;
  }

  .extension-status.connected {
    background: #d4edda;
    border-left-color: #28a745;
  }

  .status-icon {
    font-size: 1.5rem;
  }

  .status-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .status-title {
    font-weight: 600;
  }

  .status-desc {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  /* Card Header */
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--spacing-md);
  }

  .card-header h2 {
    font-size: var(--font-size-lg);
    margin: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
  }

  .selection-count {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--spacing-2xl);
    text-align: center;
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: var(--spacing-md);
    opacity: 0.5;
  }

  .empty-state p {
    color: var(--text-muted);
    margin-bottom: var(--spacing-lg);
  }

  /* Expedientes List */
  .expedientes-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    max-height: 400px;
    overflow-y: auto;
  }

  .expediente-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-secondary);
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: var(--transition-fast);
    border: 2px solid transparent;
  }

  .expediente-item:hover {
    background: var(--bg-tertiary);
  }

  .expediente-item.selected {
    border-color: var(--color-primary);
    background: #e3f2fd;
  }

  .expediente-item input {
    width: auto;
  }

  .expediente-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .expediente-numero {
    font-weight: 500;
  }

  .expediente-juzgado {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .resultado-badge {
    font-size: var(--font-size-xs);
    padding: 2px 8px;
    background: var(--color-success);
    color: white;
    border-radius: var(--border-radius-sm);
  }

  /* Card Footer */
  .card-footer {
    display: flex;
    gap: var(--spacing-md);
    flex-wrap: wrap;
  }

  /* Manual Mode */
  .manual-instructions {
    color: var(--text-secondary);
    margin-bottom: var(--spacing-lg);
  }

  .urls-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .url-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-secondary);
    border-radius: var(--border-radius-sm);
  }

  .url-info {
    display: flex;
    flex-direction: column;
  }

  .url-expediente {
    font-weight: 500;
  }

  .url-juzgado {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .url-actions {
    display: flex;
    gap: var(--spacing-xs);
  }

  /* Progress Bar */
  .progress-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--bg-tertiary);
  }

  .progress-fill {
    height: 100%;
    background: var(--color-primary);
    transition: width 0.3s ease;
  }

  /* Loader */
  .loader-sm {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Responsive */
  @media (max-width: 768px) {
    .card-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-actions {
      width: 100%;
      justify-content: space-between;
    }

    .url-item {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-sm);
    }

    .url-actions {
      width: 100%;
      justify-content: flex-end;
    }
  }
</style>
