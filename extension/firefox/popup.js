/**
 * TSJ Filing Online - Popup Script
 */

const APP_ORIGIN = 'https://jorch01.github.io';
const APP_PATH = '/TSJ_Filing_online';
const TSJ_DOMAIN = 'tsjqroo.gob.mx';

document.addEventListener('DOMContentLoaded', async () => {
  const appStatus = document.getElementById('app-status');
  const tsjStatus = document.getElementById('tsj-status');
  const btnBuscar = document.getElementById('btn-buscar');
  const errorMessage = document.getElementById('error-message');

  // Verificar estado de la pestaña actual
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
      const url = new URL(tab.url);

      // Verificar si es página TSJ
      if (url.hostname.includes(TSJ_DOMAIN)) {
        tsjStatus.textContent = 'Conectado';
        tsjStatus.className = 'status-value connected';
        btnBuscar.disabled = false;

        // Verificar si es página de búsqueda
        if (tab.url.includes('buscador_primera') || tab.url.includes('buscador_segunda')) {
          btnBuscar.textContent = '🔍 Extraer Resultados';
        }
      } else {
        tsjStatus.textContent = 'No en TSJ';
        tsjStatus.className = 'status-value disconnected';
      }
    }
  } catch (error) {
    console.error('Error al verificar pestaña:', error);
    tsjStatus.textContent = 'Error';
    tsjStatus.className = 'status-value disconnected';
  }

  // Verificar conexión con la aplicación web
  try {
    const tabs = await chrome.tabs.query({ url: `${APP_ORIGIN}${APP_PATH}/*` });

    if (tabs.length > 0) {
      appStatus.textContent = 'Conectada';
      appStatus.className = 'status-value connected';
    } else {
      appStatus.textContent = 'No abierta';
      appStatus.className = 'status-value disconnected';
    }
  } catch (error) {
    appStatus.textContent = 'Error';
    appStatus.className = 'status-value disconnected';
  }

  // Botón de buscar
  btnBuscar.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url.includes(TSJ_DOMAIN)) {
        showError('Debes estar en una página del TSJ para usar esta función');
        return;
      }

      // Enviar mensaje al content script
      const resultados = await chrome.tabs.sendMessage(tab.id, {
        accion: 'extraer_resultados'
      });

      if (resultados.exito && resultados.resultados.length > 0) {
        // Enviar resultados a la aplicación web
        const appTabs = await chrome.tabs.query({ url: `${APP_ORIGIN}${APP_PATH}/*` });

        if (appTabs.length > 0) {
          await chrome.tabs.sendMessage(appTabs[0].id, {
            tipo: 'resultados_manuales',
            resultados: resultados.resultados
          });

          btnBuscar.textContent = '✅ Enviado';
          setTimeout(() => {
            btnBuscar.textContent = '🔍 Extraer Resultados';
          }, 2000);
        } else {
          // Copiar al portapapeles como alternativa
          await navigator.clipboard.writeText(JSON.stringify(resultados.resultados, null, 2));
          showError('Aplicación no abierta. Resultados copiados al portapapeles.');
        }
      } else {
        showError(resultados.mensaje || 'No se encontraron resultados');
      }
    } catch (error) {
      console.error('Error:', error);
      showError('Error al extraer resultados: ' + error.message);
    }
  });

  function showError(mensaje) {
    errorMessage.textContent = mensaje;
    errorMessage.classList.add('show');
    setTimeout(() => {
      errorMessage.classList.remove('show');
    }, 5000);
  }
});
