/**
 * TSJ Filing Online - Background Script
 *
 * Gestiona la comunicación entre el content script y la aplicación web.
 * Compatible con Chrome, Firefox y Safari (Manifest V3).
 */

const TSJ_DOMAIN = 'tsjqroo.gob.mx';
const APP_ORIGIN = 'https://jorch01.github.io'; // Cambiar al dominio real de GitHub Pages
const APP_PATH = '/TSJ_Filing_online';

// Estado de las pestañas activas
const pestanasActivas = new Map();
const busquedasPendientes = new Map();

/**
 * Maneja mensajes del content script y la aplicación web
 */
chrome.runtime.onMessage.addListener((mensaje, sender, responder) => {
  console.log('[TSJ Background] Mensaje recibido:', mensaje, 'de:', sender);

  switch (mensaje.tipo) {
    case 'content_script_listo':
      handleContentScriptListo(sender.tab, mensaje);
      break;

    case 'resultados_cargados':
      handleResultadosCargados(sender.tab, mensaje);
      break;

    case 'iniciar_busqueda':
      handleIniciarBusqueda(mensaje, responder);
      return true; // Respuesta asíncrona

    case 'obtener_estado':
      responder({
        pestanasActivas: pestanasActivas.size,
        busquedasPendientes: busquedasPendientes.size
      });
      break;

    case 'abrir_popup':
      // Abrir el popup de la extensión
      chrome.action.openPopup();
      break;

    default:
      console.log('[TSJ Background] Mensaje no manejado:', mensaje.tipo);
  }
});

/**
 * Maneja cuando un content script está listo
 */
function handleContentScriptListo(tab, mensaje) {
  if (!tab) return;

  pestanasActivas.set(tab.id, {
    url: mensaje.url,
    esBusqueda: mensaje.esBusqueda,
    timestamp: Date.now()
  });

  // Verificar si hay una búsqueda pendiente para esta pestaña
  const busqueda = busquedasPendientes.get(tab.id);
  if (busqueda && mensaje.esBusqueda) {
    // Extraer resultados después de un breve delay
    setTimeout(() => {
      extraerResultadosDeTab(tab.id, busqueda);
    }, 2000);
  }
}

/**
 * Maneja cuando se cargan resultados
 */
function handleResultadosCargados(tab, mensaje) {
  console.log('[TSJ Background] Resultados cargados:', mensaje.cantidad);

  const busqueda = busquedasPendientes.get(tab?.id);
  if (busqueda) {
    extraerResultadosDeTab(tab.id, busqueda);
  }
}

/**
 * Inicia una nueva búsqueda
 */
async function handleIniciarBusqueda(mensaje, responder) {
  const { url, expedienteId, callback } = mensaje;

  try {
    // Crear nueva pestaña con la URL de búsqueda
    const tab = await chrome.tabs.create({
      url: url,
      active: false
    });

    // Registrar búsqueda pendiente
    busquedasPendientes.set(tab.id, {
      expedienteId,
      callback,
      timestamp: Date.now()
    });

    responder({ exito: true, tabId: tab.id });
  } catch (error) {
    console.error('[TSJ Background] Error al iniciar búsqueda:', error);
    responder({ exito: false, error: error.message });
  }
}

/**
 * Extrae resultados de una pestaña
 */
async function extraerResultadosDeTab(tabId, busqueda) {
  try {
    const resultados = await chrome.tabs.sendMessage(tabId, {
      accion: 'extraer_resultados'
    });

    // Enviar resultados a la aplicación web
    enviarResultadosAApp(busqueda.expedienteId, resultados);

    // Limpiar
    busquedasPendientes.delete(tabId);

    // Cerrar pestaña después de extraer
    setTimeout(() => {
      chrome.tabs.remove(tabId).catch(() => {});
    }, 1000);

  } catch (error) {
    console.error('[TSJ Background] Error al extraer resultados:', error);
  }
}

/**
 * Envía resultados a la aplicación web
 */
async function enviarResultadosAApp(expedienteId, resultados) {
  // Buscar la pestaña de la aplicación
  const tabs = await chrome.tabs.query({
    url: `${APP_ORIGIN}${APP_PATH}/*`
  });

  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        tipo: 'resultados_busqueda',
        expedienteId,
        resultados
      });
    } catch (error) {
      console.warn('[TSJ Background] No se pudo enviar a pestaña:', tab.id);
    }
  }
}

/**
 * Escucha conexiones desde la aplicación web
 */
chrome.runtime.onConnectExternal.addListener((port) => {
  console.log('[TSJ Background] Conexión externa desde:', port.sender);

  port.onMessage.addListener((mensaje) => {
    switch (mensaje.tipo) {
      case 'ping':
        port.postMessage({ tipo: 'pong', version: '1.0.0' });
        break;

      case 'buscar':
        handleBusquedaExterna(port, mensaje);
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[TSJ Background] Conexión externa cerrada');
  });
});

/**
 * Maneja búsquedas desde la aplicación web externa
 */
async function handleBusquedaExterna(port, mensaje) {
  const { expedientes } = mensaje;

  for (const exp of expedientes) {
    try {
      // Crear pestaña de búsqueda
      const tab = await chrome.tabs.create({
        url: exp.url,
        active: false
      });

      // Esperar a que cargue
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Extraer resultados
      const resultados = await chrome.tabs.sendMessage(tab.id, {
        accion: 'extraer_resultados'
      });

      // Enviar al puerto
      port.postMessage({
        tipo: 'resultado',
        expedienteId: exp.id,
        resultados
      });

      // Cerrar pestaña
      await chrome.tabs.remove(tab.id);

    } catch (error) {
      port.postMessage({
        tipo: 'error',
        expedienteId: exp.id,
        error: error.message
      });
    }
  }

  port.postMessage({ tipo: 'completado' });
}

/**
 * Limpieza periódica de búsquedas antiguas
 */
setInterval(() => {
  const ahora = Date.now();
  const TIMEOUT = 5 * 60 * 1000; // 5 minutos

  for (const [tabId, busqueda] of busquedasPendientes) {
    if (ahora - busqueda.timestamp > TIMEOUT) {
      busquedasPendientes.delete(tabId);
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}, 60000);

/**
 * Al instalar la extensión
 */
chrome.runtime.onInstalled.addListener((detalles) => {
  console.log('[TSJ Extension] Instalada:', detalles.reason);

  // Mostrar página de bienvenida si es nueva instalación
  if (detalles.reason === 'install') {
    chrome.tabs.create({
      url: `${APP_ORIGIN}${APP_PATH}/configuracion#extension`
    });
  }
});

console.log('[TSJ Background] Service Worker iniciado');
