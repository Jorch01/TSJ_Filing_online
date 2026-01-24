<script lang="ts">
  import { onMount } from 'svelte';
  import { expedientesStore, estadisticasExpedientes } from '$lib/stores/expedientes';
  import { eventosProximos, eventosHoy } from '$lib/stores/eventos';
  import { notasRecientes, totalNotas } from '$lib/stores/notas';
  import { obtenerEstadisticas } from '$lib/services/database';

  let estadisticas = {
    totalExpedientes: 0,
    expedientesActivos: 0,
    totalPublicaciones: 0,
    publicacionesNuevas: 0,
    totalNotas: 0,
    totalEventos: 0,
    eventosProximos: 0
  };

  let cargando = true;

  onMount(async () => {
    estadisticas = await obtenerEstadisticas();
    cargando = false;
  });
</script>

<svelte:head>
  <title>Inicio - TSJ Filing Online</title>
</svelte:head>

<div class="dashboard">
  <header class="page-header">
    <h1>Panel de Control</h1>
    <p class="subtitle">Bienvenido al Sistema de Gestión de Expedientes</p>
  </header>

  <!-- Tarjetas de estadísticas -->
  <section class="stats-grid">
    <div class="stat-card">
      <div class="stat-icon expedientes">📁</div>
      <div class="stat-content">
        <span class="stat-value">{estadisticas.expedientesActivos}</span>
        <span class="stat-label">Expedientes Activos</span>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-icon publicaciones">📋</div>
      <div class="stat-content">
        <span class="stat-value">{estadisticas.totalPublicaciones}</span>
        <span class="stat-label">Publicaciones</span>
        {#if estadisticas.publicacionesNuevas > 0}
          <span class="stat-badge new">{estadisticas.publicacionesNuevas} nuevas</span>
        {/if}
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-icon eventos">📅</div>
      <div class="stat-content">
        <span class="stat-value">{estadisticas.eventosProximos}</span>
        <span class="stat-label">Eventos Próximos</span>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-icon notas">📝</div>
      <div class="stat-content">
        <span class="stat-value">{estadisticas.totalNotas}</span>
        <span class="stat-label">Notas</span>
      </div>
    </div>
  </section>

  <!-- Acciones rápidas -->
  <section class="quick-actions">
    <h2>Acciones Rápidas</h2>
    <div class="actions-grid">
      <a href="/expedientes" class="action-card">
        <span class="action-icon">➕</span>
        <span class="action-label">Nuevo Expediente</span>
      </a>
      <a href="/busqueda" class="action-card primary">
        <span class="action-icon">🔍</span>
        <span class="action-label">Iniciar Búsqueda</span>
      </a>
      <a href="/calendario" class="action-card">
        <span class="action-icon">📅</span>
        <span class="action-label">Ver Calendario</span>
      </a>
      <a href="/notas" class="action-card">
        <span class="action-icon">📝</span>
        <span class="action-label">Nueva Nota</span>
      </a>
    </div>
  </section>

  <div class="dashboard-grid">
    <!-- Eventos de hoy -->
    <section class="card">
      <div class="card-header">
        <h3>📅 Eventos de Hoy</h3>
        <a href="/calendario" class="card-link">Ver todos</a>
      </div>
      <div class="card-body">
        {#if $eventosHoy.length === 0}
          <div class="empty-state">
            <span class="empty-icon">🎉</span>
            <p>No hay eventos programados para hoy</p>
          </div>
        {:else}
          <ul class="event-list">
            {#each $eventosHoy as evento}
              <li class="event-item" style="border-left-color: {evento.color}">
                <span class="event-time">
                  {new Date(evento.fechaInicio).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <div class="event-details">
                  <span class="event-title">{evento.titulo}</span>
                  {#if evento.descripcion}
                    <span class="event-desc">{evento.descripcion}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>

    <!-- Próximos eventos -->
    <section class="card">
      <div class="card-header">
        <h3>⏰ Próximos Eventos</h3>
        <a href="/calendario" class="card-link">Ver todos</a>
      </div>
      <div class="card-body">
        {#if $eventosProximos.length === 0}
          <div class="empty-state">
            <span class="empty-icon">📭</span>
            <p>No hay eventos próximos</p>
          </div>
        {:else}
          <ul class="event-list">
            {#each $eventosProximos.slice(0, 5) as evento}
              <li class="event-item" style="border-left-color: {evento.color}">
                <span class="event-date">
                  {new Date(evento.fechaInicio).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
                <div class="event-details">
                  <span class="event-title">{evento.titulo}</span>
                  <span class="event-type badge badge-{evento.tipo}">{evento.tipo}</span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>

    <!-- Notas recientes -->
    <section class="card">
      <div class="card-header">
        <h3>📝 Notas Recientes</h3>
        <a href="/notas" class="card-link">Ver todas</a>
      </div>
      <div class="card-body">
        {#if $notasRecientes.length === 0}
          <div class="empty-state">
            <span class="empty-icon">📒</span>
            <p>No hay notas</p>
            <a href="/notas" class="btn btn-sm btn-outline">Crear nota</a>
          </div>
        {:else}
          <ul class="notes-list">
            {#each $notasRecientes as nota}
              <li class="note-item" style="background-color: {nota.color}">
                <span class="note-title">{nota.titulo}</span>
                <span class="note-date">
                  {new Date(nota.fechaCreacion).toLocaleDateString('es-MX')}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>

    <!-- Expedientes recientes -->
    <section class="card">
      <div class="card-header">
        <h3>📁 Expedientes Recientes</h3>
        <a href="/expedientes" class="card-link">Ver todos</a>
      </div>
      <div class="card-body">
        {#if $expedientesStore.expedientes.length === 0}
          <div class="empty-state">
            <span class="empty-icon">📂</span>
            <p>No hay expedientes</p>
            <a href="/expedientes" class="btn btn-sm btn-outline">Agregar expediente</a>
          </div>
        {:else}
          <ul class="expediente-list">
            {#each $expedientesStore.expedientes.slice(0, 5) as exp}
              <li class="expediente-item">
                <div class="expediente-info">
                  <span class="expediente-numero">{exp.numero || exp.nombre}</span>
                  <span class="expediente-juzgado">{exp.juzgado}</span>
                </div>
                <span class="expediente-badge">{exp.categoria}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  </div>

  <!-- Información del sistema -->
  <section class="info-banner">
    <div class="info-icon">💡</div>
    <div class="info-content">
      <h4>Extensión de Navegador</h4>
      <p>
        Para realizar búsquedas automáticas en el TSJ, instala la extensión del navegador.
        <a href="/configuracion#extension">Configurar extensión</a>
      </p>
    </div>
  </section>
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xl);
  }

  .page-header {
    margin-bottom: var(--spacing-md);
  }

  .page-header h1 {
    margin-bottom: var(--spacing-xs);
  }

  .subtitle {
    color: var(--text-secondary);
    margin: 0;
  }

  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--spacing-md);
  }

  .stat-card {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-lg);
    background: var(--bg-primary);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-md);
  }

  .stat-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: var(--border-radius);
    font-size: 1.75rem;
  }

  .stat-icon.expedientes { background: #e3f2fd; }
  .stat-icon.publicaciones { background: #e8f5e9; }
  .stat-icon.eventos { background: #fff3e0; }
  .stat-icon.notas { background: #fce4ec; }

  .stat-content {
    display: flex;
    flex-direction: column;
  }

  .stat-value {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
  }

  .stat-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-top: var(--spacing-xs);
  }

  .stat-badge {
    font-size: var(--font-size-xs);
    padding: 2px 8px;
    border-radius: 9999px;
    margin-top: var(--spacing-xs);
    width: fit-content;
  }

  .stat-badge.new {
    background: var(--color-success);
    color: white;
  }

  /* Quick Actions */
  .quick-actions h2 {
    font-size: var(--font-size-lg);
    margin-bottom: var(--spacing-md);
  }

  .actions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--spacing-md);
  }

  .action-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-lg);
    background: var(--bg-primary);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-sm);
    text-decoration: none;
    color: var(--text-primary);
    transition: var(--transition-fast);
    border: 2px solid transparent;
  }

  .action-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    border-color: var(--color-primary);
    text-decoration: none;
  }

  .action-card.primary {
    background: var(--color-primary);
    color: white;
  }

  .action-card.primary:hover {
    background: var(--color-primary-dark);
    border-color: var(--color-primary-dark);
  }

  .action-icon {
    font-size: 2rem;
  }

  .action-label {
    font-weight: 500;
    text-align: center;
  }

  /* Dashboard Grid */
  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--spacing-lg);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .card-header h3 {
    font-size: var(--font-size-md);
    margin: 0;
  }

  .card-link {
    font-size: var(--font-size-sm);
    color: var(--color-primary);
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--spacing-xl);
    text-align: center;
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: var(--spacing-md);
    opacity: 0.5;
  }

  .empty-state p {
    color: var(--text-muted);
    margin-bottom: var(--spacing-md);
  }

  /* Event List */
  .event-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .event-item {
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-md);
    padding: var(--spacing-sm);
    border-left: 3px solid var(--color-primary);
    background: var(--bg-secondary);
    border-radius: 0 var(--border-radius-sm) var(--border-radius-sm) 0;
  }

  .event-time,
  .event-date {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    min-width: 60px;
  }

  .event-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .event-title {
    font-weight: 500;
  }

  .event-desc {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .event-type {
    font-size: var(--font-size-xs);
  }

  /* Notes List */
  .notes-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .note-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--border-radius-sm);
  }

  .note-title {
    font-weight: 500;
  }

  .note-date {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  /* Expediente List */
  .expediente-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .expediente-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm);
    background: var(--bg-secondary);
    border-radius: var(--border-radius-sm);
  }

  .expediente-info {
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

  .expediente-badge {
    font-size: var(--font-size-xs);
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-sm);
    color: var(--text-secondary);
  }

  /* Info Banner */
  .info-banner {
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-md);
    padding: var(--spacing-lg);
    background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
    border-radius: var(--border-radius-lg);
    border-left: 4px solid var(--color-primary);
  }

  .info-icon {
    font-size: 2rem;
  }

  .info-content h4 {
    margin: 0 0 var(--spacing-xs);
    font-size: var(--font-size-md);
  }

  .info-content p {
    margin: 0;
    color: var(--text-secondary);
  }

  .info-content a {
    font-weight: 500;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .actions-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .dashboard-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
