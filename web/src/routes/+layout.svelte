<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { expedientesStore } from '$lib/stores/expedientes';
  import { notasStore } from '$lib/stores/notas';
  import { eventosStore } from '$lib/stores/eventos';
  import { solicitarPermiso as solicitarPermisoNotificaciones } from '$lib/services/notificaciones';
  import { inicializarEmail } from '$lib/services/email';

  let menuAbierto = false;
  let rutaActual = '/';

  // Navegación
  const rutas = [
    { path: '/', label: 'Inicio', icon: '🏠' },
    { path: '/expedientes', label: 'Expedientes', icon: '📁' },
    { path: '/calendario', label: 'Calendario', icon: '📅' },
    { path: '/notas', label: 'Notas', icon: '📝' },
    { path: '/busqueda', label: 'Búsqueda', icon: '🔍' },
    { path: '/configuracion', label: 'Configuración', icon: '⚙️' }
  ];

  onMount(async () => {
    // Cargar datos iniciales
    await Promise.all([
      expedientesStore.cargar(),
      notasStore.cargarTodas(),
      eventosStore.cargarTodos()
    ]);

    // Solicitar permiso de notificaciones
    await solicitarPermisoNotificaciones();

    // Inicializar servicio de email
    await inicializarEmail();

    // Obtener ruta actual
    if (typeof window !== 'undefined') {
      rutaActual = window.location.pathname;
    }
  });

  function toggleMenu() {
    menuAbierto = !menuAbierto;
  }

  function cerrarMenu() {
    menuAbierto = false;
  }
</script>

<div class="app-container">
  <!-- Header -->
  <header class="app-header">
    <button class="menu-toggle" on:click={toggleMenu} aria-label="Menú">
      <span class="hamburger" class:open={menuAbierto}></span>
    </button>

    <div class="header-brand">
      <span class="brand-icon">⚖️</span>
      <div class="brand-text">
        <h1>TSJ Filing Online</h1>
        <span class="brand-subtitle">Quintana Roo</span>
      </div>
    </div>

    <div class="header-actions">
      <a href="/busqueda" class="header-btn" title="Nueva búsqueda">
        🔍
      </a>
      <a href="/configuracion" class="header-btn" title="Configuración">
        ⚙️
      </a>
    </div>
  </header>

  <!-- Sidebar -->
  <nav class="sidebar" class:open={menuAbierto}>
    <div class="sidebar-overlay" on:click={cerrarMenu} on:keydown={cerrarMenu}></div>
    <div class="sidebar-content">
      <ul class="nav-list">
        {#each rutas as ruta}
          <li>
            <a
              href={ruta.path}
              class="nav-link"
              class:active={rutaActual === ruta.path}
              on:click={cerrarMenu}
            >
              <span class="nav-icon">{ruta.icon}</span>
              <span class="nav-label">{ruta.label}</span>
            </a>
          </li>
        {/each}
      </ul>

      <div class="sidebar-footer">
        <p class="version">v1.0.0</p>
        <p class="copyright">TSJ Q. Roo 2025</p>
      </div>
    </div>
  </nav>

  <!-- Main Content -->
  <main class="app-main">
    <slot />
  </main>
</div>

<style>
  .app-container {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  /* Header */
  .app-header {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--spacing-lg);
    height: 64px;
    background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
    color: var(--text-light);
    box-shadow: var(--shadow-md);
  }

  .menu-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .hamburger {
    position: relative;
    width: 24px;
    height: 2px;
    background: white;
    transition: var(--transition-normal);
  }

  .hamburger::before,
  .hamburger::after {
    content: '';
    position: absolute;
    left: 0;
    width: 24px;
    height: 2px;
    background: white;
    transition: var(--transition-normal);
  }

  .hamburger::before {
    top: -8px;
  }

  .hamburger::after {
    top: 8px;
  }

  .hamburger.open {
    background: transparent;
  }

  .hamburger.open::before {
    top: 0;
    transform: rotate(45deg);
  }

  .hamburger.open::after {
    top: 0;
    transform: rotate(-45deg);
  }

  .header-brand {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .brand-icon {
    font-size: 2rem;
  }

  .brand-text h1 {
    font-size: var(--font-size-lg);
    font-weight: 700;
    margin: 0;
    line-height: 1.2;
  }

  .brand-subtitle {
    font-size: var(--font-size-xs);
    opacity: 0.8;
  }

  .header-actions {
    display: flex;
    gap: var(--spacing-sm);
  }

  .header-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--border-radius);
    background: rgba(255, 255, 255, 0.1);
    color: white;
    text-decoration: none;
    font-size: 1.25rem;
    transition: var(--transition-fast);
  }

  .header-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    text-decoration: none;
  }

  /* Sidebar */
  .sidebar {
    position: fixed;
    top: 64px;
    left: 0;
    bottom: 0;
    width: 280px;
    z-index: 99;
    transform: translateX(-100%);
    transition: transform var(--transition-normal);
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .sidebar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    visibility: hidden;
    transition: var(--transition-normal);
  }

  .sidebar.open .sidebar-overlay {
    opacity: 1;
    visibility: visible;
  }

  .sidebar-content {
    position: relative;
    height: 100%;
    background: var(--bg-primary);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    z-index: 1;
  }

  .nav-list {
    list-style: none;
    padding: var(--spacing-md);
    flex: 1;
  }

  .nav-link {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-md);
    border-radius: var(--border-radius);
    color: var(--text-primary);
    text-decoration: none;
    transition: var(--transition-fast);
  }

  .nav-link:hover {
    background: var(--bg-secondary);
    text-decoration: none;
  }

  .nav-link.active {
    background: var(--color-primary);
    color: var(--text-light);
  }

  .nav-icon {
    font-size: 1.25rem;
    width: 28px;
    text-align: center;
  }

  .nav-label {
    font-weight: 500;
  }

  .sidebar-footer {
    padding: var(--spacing-md);
    border-top: 1px solid var(--border-color);
    text-align: center;
  }

  .version {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    margin: 0;
  }

  .copyright {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    margin: var(--spacing-xs) 0 0;
  }

  /* Main */
  .app-main {
    flex: 1;
    padding: var(--spacing-lg);
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
  }

  /* Desktop */
  @media (min-width: 1024px) {
    .menu-toggle {
      display: none;
    }

    .sidebar {
      transform: translateX(0);
    }

    .sidebar-overlay {
      display: none;
    }

    .app-main {
      margin-left: 280px;
      width: calc(100% - 280px);
    }
  }

  /* Tablet */
  @media (max-width: 768px) {
    .brand-text h1 {
      font-size: var(--font-size-md);
    }

    .brand-subtitle {
      display: none;
    }

    .app-main {
      padding: var(--spacing-md);
    }
  }
</style>
