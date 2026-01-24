/**
 * TSJ Filing Online - Content Script
 *
 * Este script se ejecuta en las páginas del TSJ y extrae la información de los expedientes.
 * Compatible con Chrome, Firefox y Safari.
 */

(function() {
  'use strict';

  const TSJ_BASE_URL = 'https://www.tsjqroo.gob.mx';

  /**
   * Extrae los resultados de la tabla de búsqueda
   */
  function extraerResultados() {
    const resultados = [];

    // Buscar la tabla de resultados
    const tabla = document.querySelector('table.table, table#resultados, .tabla-resultados');
    if (!tabla) {
      return { exito: false, mensaje: 'No se encontró tabla de resultados', resultados: [] };
    }

    const filas = tabla.querySelectorAll('tr.odd, tr.even, tbody tr');

    for (const fila of filas) {
      const celdas = fila.querySelectorAll('td');
      if (celdas.length < 4) continue;

      const resultado = {
        idAcuerdo: celdas[0]?.textContent?.trim() || '',
        documento: celdas[1]?.textContent?.trim() || '',
        juicio: celdas[2]?.textContent?.trim() || '',
        partes: celdas[3]?.textContent?.trim() || '',
        fecha: celdas[4]?.textContent?.trim() || new Date().toISOString().split('T')[0]
      };

      // Verificar que tiene datos válidos
      if (resultado.idAcuerdo || resultado.documento) {
        resultados.push(resultado);
      }
    }

    return {
      exito: true,
      mensaje: `${resultados.length} resultados encontrados`,
      resultados
    };
  }

  /**
   * Verifica si estamos en una página de resultados del TSJ
   */
  function esPaginaTSJ() {
    return window.location.hostname.includes('tsjqroo.gob.mx');
  }

  /**
   * Verifica si estamos en una página de búsqueda
   */
  function esPaginaBusqueda() {
    const url = window.location.href;
    return url.includes('buscador_primera') || url.includes('buscador_segunda');
  }

  /**
   * Obtiene los parámetros de la URL actual
   */
  function obtenerParametrosURL() {
    const params = new URLSearchParams(window.location.search);
    return {
      expediente: params.get('expediente'),
      actor: params.get('actor'),
      juzgadoId: params.get('juzgadoId'),
      areaId: params.get('areaId')
    };
  }

  /**
   * Escucha mensajes de la aplicación web o popup
   */
  function inicializarListeners() {
    // Escuchar mensajes del background script
    chrome.runtime.onMessage.addListener((mensaje, sender, responder) => {
      console.log('[TSJ Extension] Mensaje recibido:', mensaje);

      switch (mensaje.accion) {
        case 'extraer_resultados':
          const resultados = extraerResultados();
          responder(resultados);
          break;

        case 'verificar_pagina':
          responder({
            esTSJ: esPaginaTSJ(),
            esBusqueda: esPaginaBusqueda(),
            parametros: obtenerParametrosURL()
          });
          break;

        case 'obtener_estado':
          responder({
            url: window.location.href,
            titulo: document.title,
            esTSJ: esPaginaTSJ()
          });
          break;

        default:
          responder({ error: 'Acción no reconocida' });
      }

      return true; // Indica respuesta asíncrona
    });

    // Notificar que el content script está listo
    if (esPaginaTSJ()) {
      chrome.runtime.sendMessage({
        tipo: 'content_script_listo',
        url: window.location.href,
        esBusqueda: esPaginaBusqueda()
      });
    }
  }

  /**
   * Inyecta indicador visual cuando la extensión está activa
   */
  function mostrarIndicador() {
    if (!esPaginaTSJ()) return;

    const indicador = document.createElement('div');
    indicador.id = 'tsj-extension-indicator';
    indicador.innerHTML = '⚖️ TSJ Filing';
    indicador.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #366092;
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 12px;
      font-weight: 500;
      z-index: 9999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      cursor: pointer;
      transition: transform 0.2s, opacity 0.2s;
    `;

    indicador.addEventListener('mouseenter', () => {
      indicador.style.transform = 'scale(1.05)';
    });

    indicador.addEventListener('mouseleave', () => {
      indicador.style.transform = 'scale(1)';
    });

    indicador.addEventListener('click', () => {
      chrome.runtime.sendMessage({ tipo: 'abrir_popup' });
    });

    document.body.appendChild(indicador);

    // Auto-ocultar después de 5 segundos
    setTimeout(() => {
      indicador.style.opacity = '0.5';
    }, 5000);
  }

  /**
   * Observa cambios en la página (para páginas dinámicas)
   */
  function observarCambios() {
    if (!esPaginaTSJ()) return;

    const observer = new MutationObserver((mutations) => {
      // Detectar si se cargaron nuevos resultados
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const tabla = document.querySelector('table.table, table#resultados');
          if (tabla && tabla.querySelectorAll('tr').length > 1) {
            chrome.runtime.sendMessage({
              tipo: 'resultados_cargados',
              cantidad: tabla.querySelectorAll('tr.odd, tr.even, tbody tr').length
            });
            break;
          }
        }
      }
    });

    // Observar cambios en el contenido principal
    const contenedor = document.querySelector('#content, .main-content, main, body');
    if (contenedor) {
      observer.observe(contenedor, {
        childList: true,
        subtree: true
      });
    }
  }

  // Inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      inicializarListeners();
      mostrarIndicador();
      observarCambios();
    });
  } else {
    inicializarListeners();
    mostrarIndicador();
    observarCambios();
  }

  console.log('[TSJ Extension] Content script cargado');
})();
