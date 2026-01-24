<script lang="ts">
  import { onMount } from 'svelte';
  import {
    eventosStore,
    eventosDelMes,
    COLORES_EVENTOS,
    ICONOS_EVENTOS,
    generarDiasDelMes,
    obtenerEventosDelDia,
    type TipoEvento
  } from '$lib/stores/eventos';
  import type { Evento } from '$lib/services/database';

  const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  let mostrarModal = false;
  let eventoEditando: Partial<Evento> = {};
  let mensaje = { tipo: '', texto: '' };
  let diaSeleccionado: Date | null = null;

  $: diasCalendario = generarDiasDelMes($eventosStore.fechaActual);
  $: mesActual = MESES[$eventosStore.fechaActual.getMonth()];
  $: anioActual = $eventosStore.fechaActual.getFullYear();

  function abrirModalNuevoEvento(fecha?: Date) {
    const fechaBase = fecha || new Date();
    fechaBase.setHours(9, 0, 0, 0);

    eventoEditando = {
      titulo: '',
      descripcion: '',
      fechaInicio: fechaBase,
      todoElDia: false,
      tipo: 'recordatorio',
      color: COLORES_EVENTOS.recordatorio.fondo,
      alerta: true,
      alertaMinutosAntes: 15,
      recurrente: false
    };
    mostrarModal = true;
  }

  function abrirModalEditarEvento(evento: Evento) {
    eventoEditando = { ...evento };
    mostrarModal = true;
  }

  function cerrarModal() {
    mostrarModal = false;
    eventoEditando = {};
  }

  async function guardarEvento() {
    if (!eventoEditando.titulo?.trim()) {
      mensaje = { tipo: 'danger', texto: 'El título es requerido' };
      return;
    }

    if (!eventoEditando.fechaInicio) {
      mensaje = { tipo: 'danger', texto: 'La fecha es requerida' };
      return;
    }

    // Asegurar que el color coincida con el tipo
    eventoEditando.color = COLORES_EVENTOS[eventoEditando.tipo as TipoEvento].fondo;

    if (eventoEditando.id) {
      // Actualizar
      await eventosStore.actualizar(eventoEditando.id, eventoEditando);
      mensaje = { tipo: 'success', texto: 'Evento actualizado' };
    } else {
      // Crear nuevo
      await eventosStore.agregar(eventoEditando as Omit<Evento, 'id' | 'alertaEnviada'>);
      mensaje = { tipo: 'success', texto: 'Evento creado' };
    }

    cerrarModal();
    setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 3000);
  }

  async function eliminarEvento() {
    if (eventoEditando.id && confirm('¿Eliminar este evento?')) {
      await eventosStore.eliminar(eventoEditando.id);
      cerrarModal();
      mensaje = { tipo: 'success', texto: 'Evento eliminado' };
      setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 3000);
    }
  }

  function seleccionarDia(fecha: Date) {
    diaSeleccionado = fecha;
  }

  function formatearFechaInput(fecha: Date): string {
    return fecha.toISOString().slice(0, 16);
  }

  function parsearFechaInput(valor: string): Date {
    return new Date(valor);
  }

  onMount(() => {
    eventosStore.cargarTodos();
  });
</script>

<svelte:head>
  <title>Calendario - TSJ Filing Online</title>
</svelte:head>

<div class="calendario-page">
  <header class="page-header">
    <div class="header-content">
      <h1>📅 Calendario</h1>
      <p class="subtitle">Gestiona tus eventos y recordatorios</p>
    </div>
    <button class="btn btn-primary btn-lg" on:click={() => abrirModalNuevoEvento()}>
      ➕ Nuevo Evento
    </button>
  </header>

  {#if mensaje.texto}
    <div class="alert alert-{mensaje.tipo}">
      {mensaje.texto}
    </div>
  {/if}

  <!-- Navegación del calendario -->
  <div class="calendario-nav">
    <button class="btn btn-secondary" on:click={() => eventosStore.mesAnterior()}>
      ◀ Anterior
    </button>
    <h2 class="mes-titulo">{mesActual} {anioActual}</h2>
    <button class="btn btn-secondary" on:click={() => eventosStore.irAHoy()}>
      Hoy
    </button>
    <button class="btn btn-secondary" on:click={() => eventosStore.mesSiguiente()}>
      Siguiente ▶
    </button>
  </div>

  <div class="calendario-container">
    <!-- Calendario -->
    <div class="calendario">
      <div class="calendario-header">
        {#each DIAS_SEMANA as dia}
          <div class="dia-semana">{dia}</div>
        {/each}
      </div>

      <div class="calendario-body">
        {#each diasCalendario as dia}
          {@const eventosDelDia = obtenerEventosDelDia($eventosStore.eventos, dia.fecha)}
          <button
            class="dia-cell"
            class:otro-mes={!dia.esDelMes}
            class:es-hoy={dia.esHoy}
            class:seleccionado={diaSeleccionado?.getTime() === dia.fecha.getTime()}
            on:click={() => seleccionarDia(dia.fecha)}
            on:dblclick={() => abrirModalNuevoEvento(dia.fecha)}
          >
            <span class="dia-numero">{dia.fecha.getDate()}</span>
            {#if eventosDelDia.length > 0}
              <div class="dia-eventos">
                {#each eventosDelDia.slice(0, 3) as evento}
                  <div
                    class="evento-dot"
                    style="background-color: {evento.color}"
                    title={evento.titulo}
                  ></div>
                {/each}
                {#if eventosDelDia.length > 3}
                  <span class="eventos-mas">+{eventosDelDia.length - 3}</span>
                {/if}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- Panel lateral -->
    <div class="eventos-panel">
      <h3>
        {#if diaSeleccionado}
          {diaSeleccionado.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
        {:else}
          Eventos del Mes
        {/if}
      </h3>

      <div class="eventos-lista">
        {@const eventosAMostrar = diaSeleccionado
          ? obtenerEventosDelDia($eventosStore.eventos, diaSeleccionado)
          : $eventosDelMes}

        {#if eventosAMostrar.length === 0}
          <div class="empty-eventos">
            <span>📭</span>
            <p>No hay eventos</p>
            <button class="btn btn-sm btn-outline" on:click={() => abrirModalNuevoEvento(diaSeleccionado || undefined)}>
              Crear evento
            </button>
          </div>
        {:else}
          {#each eventosAMostrar as evento}
            <button class="evento-item" on:click={() => abrirModalEditarEvento(evento)}>
              <div class="evento-icono" style="background-color: {evento.color}">
                {ICONOS_EVENTOS[evento.tipo]}
              </div>
              <div class="evento-info">
                <span class="evento-titulo">{evento.titulo}</span>
                <span class="evento-hora">
                  {#if evento.todoElDia}
                    Todo el día
                  {:else}
                    {new Date(evento.fechaInicio).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  {/if}
                </span>
              </div>
              {#if evento.alerta}
                <span class="evento-alerta">🔔</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <!-- Leyenda -->
      <div class="leyenda">
        <h4>Tipos de Evento</h4>
        <div class="leyenda-items">
          {#each Object.entries(COLORES_EVENTOS) as [tipo, colores]}
            <div class="leyenda-item">
              <span class="leyenda-color" style="background-color: {colores.fondo}"></span>
              <span class="leyenda-texto">{ICONOS_EVENTOS[tipo]} {tipo}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Modal de evento -->
{#if mostrarModal}
  <div class="modal-overlay" on:click={cerrarModal} on:keydown={cerrarModal}>
    <div class="modal" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="modal-header">
        <h3>{eventoEditando.id ? 'Editar Evento' : 'Nuevo Evento'}</h3>
        <button class="modal-close" on:click={cerrarModal}>✕</button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label for="titulo">Título *</label>
          <input
            type="text"
            id="titulo"
            bind:value={eventoEditando.titulo}
            placeholder="Ej: Audiencia de pruebas"
          />
        </div>

        <div class="form-group">
          <label for="tipo">Tipo de evento</label>
          <select id="tipo" bind:value={eventoEditando.tipo}>
            <option value="audiencia">⚖️ Audiencia</option>
            <option value="vencimiento">⚠️ Vencimiento</option>
            <option value="recordatorio">🔔 Recordatorio</option>
            <option value="otro">📌 Otro</option>
          </select>
        </div>

        <div class="form-group">
          <label for="fecha">Fecha y hora *</label>
          <input
            type="datetime-local"
            id="fecha"
            value={eventoEditando.fechaInicio ? formatearFechaInput(new Date(eventoEditando.fechaInicio)) : ''}
            on:change={(e) => eventoEditando.fechaInicio = parsearFechaInput(e.currentTarget.value)}
          />
        </div>

        <div class="form-group checkbox-group">
          <label>
            <input type="checkbox" bind:checked={eventoEditando.todoElDia} />
            Todo el día
          </label>
        </div>

        <div class="form-group">
          <label for="descripcion">Descripción</label>
          <textarea
            id="descripcion"
            bind:value={eventoEditando.descripcion}
            rows="3"
            placeholder="Detalles adicionales..."
          ></textarea>
        </div>

        <div class="form-group checkbox-group">
          <label>
            <input type="checkbox" bind:checked={eventoEditando.alerta} />
            Activar alerta
          </label>
        </div>

        {#if eventoEditando.alerta}
          <div class="form-group">
            <label for="alertaMinutos">Alertar antes de</label>
            <select id="alertaMinutos" bind:value={eventoEditando.alertaMinutosAntes}>
              <option value={5}>5 minutos</option>
              <option value={15}>15 minutos</option>
              <option value={30}>30 minutos</option>
              <option value={60}>1 hora</option>
              <option value={120}>2 horas</option>
              <option value={1440}>1 día</option>
            </select>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        {#if eventoEditando.id}
          <button class="btn btn-danger" on:click={eliminarEvento}>
            🗑️ Eliminar
          </button>
        {/if}
        <div class="modal-footer-right">
          <button class="btn btn-secondary" on:click={cerrarModal}>
            Cancelar
          </button>
          <button class="btn btn-primary" on:click={guardarEvento}>
            {eventoEditando.id ? 'Guardar Cambios' : 'Crear Evento'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .calendario-page {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
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

  /* Navegación */
  .calendario-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-md);
    flex-wrap: wrap;
  }

  .mes-titulo {
    font-size: var(--font-size-xl);
    min-width: 200px;
    text-align: center;
    margin: 0;
  }

  /* Container */
  .calendario-container {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: var(--spacing-lg);
  }

  /* Calendario */
  .calendario {
    background: var(--bg-primary);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }

  .calendario-header {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    background: var(--color-primary);
    color: white;
  }

  .dia-semana {
    padding: var(--spacing-md);
    text-align: center;
    font-weight: 600;
    font-size: var(--font-size-sm);
  }

  .calendario-body {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }

  .dia-cell {
    aspect-ratio: 1;
    padding: var(--spacing-sm);
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    transition: var(--transition-fast);
    min-height: 80px;
  }

  .dia-cell:hover {
    background: var(--bg-secondary);
  }

  .dia-cell.otro-mes {
    background: var(--bg-tertiary);
    color: var(--text-muted);
  }

  .dia-cell.es-hoy {
    background: #e3f2fd;
  }

  .dia-cell.es-hoy .dia-numero {
    background: var(--color-primary);
    color: white;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dia-cell.seleccionado {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
  }

  .dia-numero {
    font-weight: 500;
    font-size: var(--font-size-sm);
  }

  .dia-eventos {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-top: auto;
  }

  .evento-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .eventos-mas {
    font-size: 10px;
    color: var(--text-muted);
  }

  /* Panel lateral */
  .eventos-panel {
    background: var(--bg-primary);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-md);
    padding: var(--spacing-lg);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .eventos-panel h3 {
    font-size: var(--font-size-md);
    margin: 0;
    text-transform: capitalize;
  }

  .eventos-lista {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    overflow-y: auto;
    max-height: 400px;
  }

  .empty-eventos {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--spacing-xl);
    color: var(--text-muted);
  }

  .empty-eventos span {
    font-size: 2rem;
    margin-bottom: var(--spacing-sm);
  }

  .evento-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm);
    background: var(--bg-secondary);
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    border: none;
    width: 100%;
    text-align: left;
    transition: var(--transition-fast);
  }

  .evento-item:hover {
    background: var(--bg-tertiary);
  }

  .evento-icono {
    width: 32px;
    height: 32px;
    border-radius: var(--border-radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
  }

  .evento-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .evento-titulo {
    font-weight: 500;
    font-size: var(--font-size-sm);
  }

  .evento-hora {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .evento-alerta {
    font-size: 0.875rem;
  }

  /* Leyenda */
  .leyenda {
    border-top: 1px solid var(--border-color);
    padding-top: var(--spacing-md);
  }

  .leyenda h4 {
    font-size: var(--font-size-sm);
    margin: 0 0 var(--spacing-sm);
    color: var(--text-secondary);
  }

  .leyenda-items {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-xs);
  }

  .leyenda-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-size: var(--font-size-xs);
  }

  .leyenda-color {
    width: 12px;
    height: 12px;
    border-radius: 2px;
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

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    cursor: pointer;
  }

  .checkbox-group input {
    width: auto;
  }

  textarea {
    resize: vertical;
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
  @media (max-width: 1024px) {
    .calendario-container {
      grid-template-columns: 1fr;
    }

    .eventos-panel {
      order: -1;
    }
  }

  @media (max-width: 768px) {
    .dia-cell {
      min-height: 60px;
      padding: var(--spacing-xs);
    }

    .dia-semana {
      padding: var(--spacing-sm);
      font-size: var(--font-size-xs);
    }

    .calendario-nav {
      flex-direction: column;
    }
  }
</style>
