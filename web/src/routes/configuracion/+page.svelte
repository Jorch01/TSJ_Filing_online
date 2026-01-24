<script lang="ts">
  import { onMount } from 'svelte';
  import {
    obtenerConfiguracionEmail,
    guardarConfiguracionEmail,
    enviarEmailPrueba,
    INSTRUCCIONES_EMAILJS,
    type ConfiguracionEmail
  } from '$lib/services/email';
  import {
    obtenerEstadoPermiso,
    solicitarPermiso,
    guardarPreferenciaNotificaciones,
    obtenerPreferenciaNotificaciones,
    guardarPreferenciaSonido,
    obtenerPreferenciaSonido,
    reproducirSonidoAlerta
  } from '$lib/services/notificaciones';
  import { exportarDatos, importarDatos } from '$lib/services/database';
  import { exportarAJSON, importarDesdeJSON, abrirArchivoConDialogo } from '$lib/services/exportacion';

  let configEmail: ConfiguracionEmail = {
    serviceId: '',
    templateIdRecordatorio: '',
    templateIdAlerta: '',
    publicKey: '',
    emailDestino: '',
    nombreUsuario: '',
    configurado: false
  };

  let notificacionesActivadas = false;
  let sonidoActivado = true;
  let permisoNotificaciones = 'default';
  let mensaje = { tipo: '', texto: '' };
  let enviandoEmail = false;
  let tabActiva = 'general';

  async function cargarConfiguracion() {
    configEmail = await obtenerConfiguracionEmail();
    notificacionesActivadas = await obtenerPreferenciaNotificaciones();
    sonidoActivado = await obtenerPreferenciaSonido();
    permisoNotificaciones = obtenerEstadoPermiso();
  }

  async function guardarConfigEmail() {
    await guardarConfiguracionEmail(configEmail);
    mensaje = { tipo: 'success', texto: 'Configuración de email guardada' };
    setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 3000);
  }

  async function probarEmail() {
    enviandoEmail = true;
    const resultado = await enviarEmailPrueba();
    mensaje = { tipo: resultado.exito ? 'success' : 'danger', texto: resultado.mensaje };
    enviandoEmail = false;
    setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 5000);
  }

  async function toggleNotificaciones() {
    if (!notificacionesActivadas) {
      const permiso = await solicitarPermiso();
      if (!permiso) {
        mensaje = { tipo: 'warning', texto: 'Debes permitir las notificaciones en tu navegador' };
        return;
      }
    }
    notificacionesActivadas = !notificacionesActivadas;
    await guardarPreferenciaNotificaciones(notificacionesActivadas);
    permisoNotificaciones = obtenerEstadoPermiso();
  }

  async function toggleSonido() {
    sonidoActivado = !sonidoActivado;
    await guardarPreferenciaSonido(sonidoActivado);
    if (sonidoActivado) {
      reproducirSonidoAlerta('notificacion');
    }
  }

  async function exportarTodo() {
    try {
      const datos = await exportarDatos();
      const blob = new Blob([datos], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tsj_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      mensaje = { tipo: 'success', texto: 'Datos exportados correctamente' };
    } catch (error) {
      mensaje = { tipo: 'danger', texto: `Error al exportar: ${error}` };
    }
    setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 3000);
  }

  async function importarTodo() {
    const archivo = await abrirArchivoConDialogo([
      { description: 'Archivos JSON', accept: { 'application/json': ['.json'] } }
    ]);

    if (!archivo) return;

    const resultado = await importarDesdeJSON(archivo);
    if (resultado.exito && resultado.datos) {
      const importResult = await importarDatos(JSON.stringify(resultado.datos), false);
      mensaje = { tipo: importResult.exito ? 'success' : 'danger', texto: importResult.mensaje };
    } else {
      mensaje = { tipo: 'danger', texto: resultado.mensaje };
    }
    setTimeout(() => { mensaje = { tipo: '', texto: '' }; }, 5000);
  }

  onMount(() => {
    cargarConfiguracion();
  });
</script>

<svelte:head>
  <title>Configuración - TSJ Filing Online</title>
</svelte:head>

<div class="config-page">
  <header class="page-header">
    <h1>⚙️ Configuración</h1>
    <p class="subtitle">Personaliza tu experiencia</p>
  </header>

  {#if mensaje.texto}
    <div class="alert alert-{mensaje.tipo}">
      {mensaje.texto}
    </div>
  {/if}

  <!-- Tabs -->
  <div class="tabs">
    <button
      class="tab"
      class:active={tabActiva === 'general'}
      on:click={() => tabActiva = 'general'}
    >
      🔔 General
    </button>
    <button
      class="tab"
      class:active={tabActiva === 'email'}
      on:click={() => tabActiva = 'email'}
    >
      📧 Email
    </button>
    <button
      class="tab"
      class:active={tabActiva === 'extension'}
      on:click={() => tabActiva = 'extension'}
    >
      🧩 Extensión
    </button>
    <button
      class="tab"
      class:active={tabActiva === 'datos'}
      on:click={() => tabActiva = 'datos'}
    >
      💾 Datos
    </button>
  </div>

  <!-- Tab Content -->
  <div class="tab-content">
    <!-- General -->
    {#if tabActiva === 'general'}
      <section class="config-section">
        <h2>Notificaciones</h2>

        <div class="config-item">
          <div class="config-info">
            <h3>Notificaciones del navegador</h3>
            <p>Recibe alertas cuando haya eventos próximos o recordatorios</p>
            <span class="config-status">
              Estado del permiso: <strong>{permisoNotificaciones}</strong>
            </span>
          </div>
          <label class="switch">
            <input type="checkbox" checked={notificacionesActivadas} on:change={toggleNotificaciones} />
            <span class="slider"></span>
          </label>
        </div>

        <div class="config-item">
          <div class="config-info">
            <h3>Sonidos de alerta</h3>
            <p>Reproduce un sonido cuando llegue una notificación</p>
          </div>
          <label class="switch">
            <input type="checkbox" checked={sonidoActivado} on:change={toggleSonido} />
            <span class="slider"></span>
          </label>
        </div>
      </section>

      <section class="config-section">
        <h2>Acerca de</h2>
        <div class="about-info">
          <p><strong>TSJ Filing Online</strong> v1.0.0</p>
          <p>Sistema de Gestión de Expedientes del TSJ Quintana Roo</p>
          <p class="text-muted">
            Desarrollado para facilitar el seguimiento de expedientes judiciales.
            Todos los datos se almacenan localmente en tu navegador.
          </p>
        </div>
      </section>
    {/if}

    <!-- Email -->
    {#if tabActiva === 'email'}
      <section class="config-section">
        <h2>Configuración de EmailJS</h2>
        <p class="section-desc">
          Configura EmailJS para recibir recordatorios por correo electrónico.
          Es un servicio gratuito que permite enviar hasta 200 emails/mes.
        </p>

        <form on:submit|preventDefault={guardarConfigEmail}>
          <div class="form-group">
            <label for="serviceId">Service ID</label>
            <input
              type="text"
              id="serviceId"
              bind:value={configEmail.serviceId}
              placeholder="service_xxxxxxx"
            />
          </div>

          <div class="form-group">
            <label for="publicKey">Public Key</label>
            <input
              type="text"
              id="publicKey"
              bind:value={configEmail.publicKey}
              placeholder="Tu clave pública de EmailJS"
            />
          </div>

          <div class="form-group">
            <label for="templateId">Template ID (Recordatorios)</label>
            <input
              type="text"
              id="templateId"
              bind:value={configEmail.templateIdRecordatorio}
              placeholder="template_xxxxxxx"
            />
          </div>

          <div class="form-group">
            <label for="emailDestino">Email de destino</label>
            <input
              type="email"
              id="emailDestino"
              bind:value={configEmail.emailDestino}
              placeholder="tu@email.com"
            />
          </div>

          <div class="form-group">
            <label for="nombreUsuario">Tu nombre</label>
            <input
              type="text"
              id="nombreUsuario"
              bind:value={configEmail.nombreUsuario}
              placeholder="Tu nombre para los emails"
            />
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">
              💾 Guardar Configuración
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              on:click={probarEmail}
              disabled={!configEmail.configurado || enviandoEmail}
            >
              {#if enviandoEmail}
                Enviando...
              {:else}
                📧 Enviar Email de Prueba
              {/if}
            </button>
          </div>
        </form>

        <details class="instructions">
          <summary>📖 Instrucciones de configuración</summary>
          <div class="instructions-content">
            {@html INSTRUCCIONES_EMAILJS.replace(/\n/g, '<br>').replace(/##/g, '<h3>').replace(/###/g, '<h4>')}
          </div>
        </details>
      </section>
    {/if}

    <!-- Extensión -->
    {#if tabActiva === 'extension'}
      <section class="config-section" id="extension">
        <h2>Extensión de Navegador</h2>
        <p class="section-desc">
          La extensión de navegador permite realizar búsquedas automáticas en el sitio del TSJ
          directamente desde esta aplicación.
        </p>

        <div class="extension-info">
          <div class="extension-card">
            <div class="extension-icon chrome">🌐</div>
            <div class="extension-details">
              <h3>Chrome / Edge / Brave</h3>
              <p>Compatible con navegadores basados en Chromium</p>
              <a href="/extension/chrome.zip" class="btn btn-primary btn-sm" download>
                📥 Descargar para Chrome
              </a>
            </div>
          </div>

          <div class="extension-card">
            <div class="extension-icon firefox">🦊</div>
            <div class="extension-details">
              <h3>Firefox</h3>
              <p>Compatible con Firefox 109+</p>
              <a href="/extension/firefox.xpi" class="btn btn-primary btn-sm" download>
                📥 Descargar para Firefox
              </a>
            </div>
          </div>

          <div class="extension-card">
            <div class="extension-icon safari">🧭</div>
            <div class="extension-details">
              <h3>Safari</h3>
              <p>Compatible con Safari 16.4+</p>
              <a href="/extension/safari.zip" class="btn btn-primary btn-sm" download>
                📥 Descargar para Safari
              </a>
            </div>
          </div>
        </div>

        <div class="install-instructions">
          <h3>Cómo instalar la extensión</h3>
          <ol>
            <li>Descarga el archivo correspondiente a tu navegador</li>
            <li>
              <strong>Chrome/Edge:</strong> Ve a <code>chrome://extensions</code>,
              activa "Modo desarrollador" y arrastra el archivo .zip
            </li>
            <li>
              <strong>Firefox:</strong> Ve a <code>about:addons</code>,
              haz clic en el engranaje y selecciona "Instalar complemento desde archivo"
            </li>
            <li>
              <strong>Safari:</strong> Descomprime el archivo y sigue las instrucciones
              en el README incluido
            </li>
            <li>Una vez instalada, la extensión se conectará automáticamente con esta página</li>
          </ol>
        </div>
      </section>
    {/if}

    <!-- Datos -->
    {#if tabActiva === 'datos'}
      <section class="config-section">
        <h2>Exportar / Importar Datos</h2>
        <p class="section-desc">
          Guarda una copia de seguridad de todos tus datos o restáuralos desde un archivo anterior.
        </p>

        <div class="data-actions">
          <div class="data-card">
            <div class="data-icon">📤</div>
            <div class="data-info">
              <h3>Exportar Datos</h3>
              <p>Descarga todos tus expedientes, notas y eventos en un archivo JSON</p>
            </div>
            <button class="btn btn-primary" on:click={exportarTodo}>
              Exportar Todo
            </button>
          </div>

          <div class="data-card">
            <div class="data-icon">📥</div>
            <div class="data-info">
              <h3>Importar Datos</h3>
              <p>Restaura tus datos desde un archivo de respaldo</p>
            </div>
            <button class="btn btn-secondary" on:click={importarTodo}>
              Importar Archivo
            </button>
          </div>
        </div>

        <div class="warning-box">
          <span class="warning-icon">⚠️</span>
          <div>
            <strong>Importante:</strong> Todos los datos se almacenan localmente en tu navegador
            usando IndexedDB. Si limpias los datos de navegación, perderás toda la información.
            Te recomendamos hacer respaldos periódicos.
          </div>
        </div>
      </section>

      <section class="config-section danger-zone">
        <h2>Zona de Peligro</h2>
        <div class="danger-item">
          <div class="danger-info">
            <h3>Eliminar todos los datos</h3>
            <p>Esta acción eliminará permanentemente todos tus expedientes, notas y eventos.</p>
          </div>
          <button class="btn btn-danger" on:click={() => {
            if (confirm('¿Estás seguro? Esta acción no se puede deshacer.')) {
              if (confirm('¿REALMENTE seguro? Se eliminarán TODOS los datos.')) {
                // Implementar eliminación total
                mensaje = { tipo: 'success', texto: 'Datos eliminados' };
              }
            }
          }}>
            🗑️ Eliminar Todo
          </button>
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .config-page {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
    max-width: 800px;
    margin: 0 auto;
  }

  .page-header h1 {
    margin-bottom: var(--spacing-xs);
  }

  .subtitle {
    color: var(--text-secondary);
    margin: 0;
  }

  /* Tabs */
  .tabs {
    display: flex;
    gap: var(--spacing-xs);
    border-bottom: 2px solid var(--border-color);
    overflow-x: auto;
  }

  .tab {
    padding: var(--spacing-sm) var(--spacing-lg);
    background: transparent;
    border: none;
    cursor: pointer;
    font-weight: 500;
    color: var(--text-secondary);
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    white-space: nowrap;
    transition: var(--transition-fast);
  }

  .tab:hover {
    color: var(--color-primary);
  }

  .tab.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
  }

  .tab-content {
    animation: fadeIn 0.3s ease;
  }

  /* Config Section */
  .config-section {
    background: var(--bg-primary);
    border-radius: var(--border-radius-lg);
    padding: var(--spacing-lg);
    margin-bottom: var(--spacing-lg);
  }

  .config-section h2 {
    font-size: var(--font-size-lg);
    margin: 0 0 var(--spacing-sm);
  }

  .section-desc {
    color: var(--text-secondary);
    margin-bottom: var(--spacing-lg);
  }

  /* Config Item */
  .config-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-md) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .config-item:last-child {
    border-bottom: none;
  }

  .config-info h3 {
    font-size: var(--font-size-md);
    margin: 0 0 var(--spacing-xs);
  }

  .config-info p {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  .config-status {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  /* Switch */
  .switch {
    position: relative;
    display: inline-block;
    width: 52px;
    height: 28px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background-color: var(--border-color);
    transition: var(--transition-fast);
    border-radius: 28px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 4px;
    bottom: 4px;
    background-color: white;
    transition: var(--transition-fast);
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: var(--color-primary);
  }

  input:checked + .slider:before {
    transform: translateX(24px);
  }

  /* Form */
  .form-group {
    margin-bottom: var(--spacing-md);
  }

  .form-group label {
    display: block;
    margin-bottom: var(--spacing-xs);
    font-weight: 500;
  }

  .form-actions {
    display: flex;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-lg);
  }

  /* Instructions */
  .instructions {
    margin-top: var(--spacing-lg);
    padding: var(--spacing-md);
    background: var(--bg-secondary);
    border-radius: var(--border-radius);
  }

  .instructions summary {
    cursor: pointer;
    font-weight: 500;
  }

  .instructions-content {
    margin-top: var(--spacing-md);
    font-size: var(--font-size-sm);
    line-height: 1.8;
  }

  /* Extension */
  .extension-info {
    display: grid;
    gap: var(--spacing-md);
  }

  .extension-card {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-md);
    background: var(--bg-secondary);
    border-radius: var(--border-radius);
  }

  .extension-icon {
    font-size: 2.5rem;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--border-radius);
  }

  .extension-icon.chrome { background: #e3f2fd; }
  .extension-icon.firefox { background: #fff3e0; }
  .extension-icon.safari { background: #e8f5e9; }

  .extension-details {
    flex: 1;
  }

  .extension-details h3 {
    font-size: var(--font-size-md);
    margin: 0 0 var(--spacing-xs);
  }

  .extension-details p {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0 0 var(--spacing-sm);
  }

  .install-instructions {
    margin-top: var(--spacing-xl);
    padding: var(--spacing-lg);
    background: var(--bg-secondary);
    border-radius: var(--border-radius);
  }

  .install-instructions h3 {
    margin: 0 0 var(--spacing-md);
  }

  .install-instructions ol {
    margin: 0;
    padding-left: var(--spacing-lg);
  }

  .install-instructions li {
    margin-bottom: var(--spacing-sm);
  }

  .install-instructions code {
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-sm);
  }

  /* Data */
  .data-actions {
    display: grid;
    gap: var(--spacing-md);
  }

  .data-card {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-lg);
    background: var(--bg-secondary);
    border-radius: var(--border-radius);
  }

  .data-icon {
    font-size: 2.5rem;
  }

  .data-info {
    flex: 1;
  }

  .data-info h3 {
    font-size: var(--font-size-md);
    margin: 0 0 var(--spacing-xs);
  }

  .data-info p {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  .warning-box {
    display: flex;
    gap: var(--spacing-md);
    padding: var(--spacing-md);
    background: #fff3cd;
    border-radius: var(--border-radius);
    margin-top: var(--spacing-lg);
    color: #856404;
  }

  .warning-icon {
    font-size: 1.5rem;
  }

  /* Danger Zone */
  .danger-zone {
    border: 2px solid var(--color-danger);
  }

  .danger-zone h2 {
    color: var(--color-danger);
  }

  .danger-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--spacing-md);
  }

  .danger-info h3 {
    font-size: var(--font-size-md);
    margin: 0 0 var(--spacing-xs);
  }

  .danger-info p {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  /* About */
  .about-info p {
    margin: var(--spacing-xs) 0;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .config-item {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-md);
    }

    .form-actions {
      flex-direction: column;
    }

    .extension-card {
      flex-direction: column;
      text-align: center;
    }

    .data-card {
      flex-direction: column;
      text-align: center;
    }

    .danger-item {
      flex-direction: column;
      text-align: center;
    }
  }
</style>
