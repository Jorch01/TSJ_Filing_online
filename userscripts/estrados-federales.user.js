// ==UserScript==
// @name         Estrados federales (DGEJ/CJF) — enlace directo
// @namespace    tsj-filing-online
// @version      0.1.0
// @description  Abre la lista de acuerdos de un órgano federal desde un enlace. El portal del CJF no lo permite por URL: es ASP.NET WebForms y el filtro vive en el __VIEWSTATE. Este script rellena los desplegables desde el fragmento #tsjfo=<circuito>/<organo>, que el servidor nunca ve.
// @author       TSJ Filing Online
// @match        https://www.dgej.cjf.gob.mx/SiseInternet/consulta/busquedaacuerdos.aspx*
// @match        https://www.dgej.cjf.gob.mx/siseinternet/consulta/busquedaacuerdos.aspx*
// @match        https://www.dgej.cjf.gob.mx/paginas/serviciosTramites.htm*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * USO
 *   https://www.dgej.cjf.gob.mx/paginas/serviciosTramites.htm?pageName=servicios%2FlistaAcuerdos.htm#tsjfo=54/462
 *                                                                                                    ^^  ^^^
 *                                                                                       circuito ────┘   └──── órgano
 *
 *   Los dos números salen del catálogo del repo:
 *     circuito → catalogo_circuitos.csv          (columna id_sise: el 27º Circuito es 54)
 *     órgano   → pjf_catalogos_completos.json    (campo id: el Primer Colegiado del 27º es 462)
 *
 * POR QUÉ HACE FALTA
 *   busquedaacuerdos.aspx es un asistente de varios pasos dentro de un solo .aspx.
 *   Elegir circuito dispara un postback que recarga la página para poblar los órganos,
 *   así que el objetivo tiene que sobrevivir a esa recarga: de ahí el sessionStorage.
 */

(function () {
  'use strict';

  var CLAVE = 'tsjfo_estrado_pendiente';
  var PREFIJO = '%c[estrados-federales]';
  var ESTILO = 'color:#0a7;font-weight:bold';

  function log() {
    var args = [PREFIJO, ESTILO].concat([].slice.call(arguments));
    console.log.apply(console, args);
  }

  // ── Objetivo: #tsjfo=<circuitoId>/<organoId> ────────────────────────────
  // El hash puede estar en esta ventana o en el marco exterior: el portal
  // envuelve el .aspx dentro de serviciosTramites.htm. Los dos son del mismo
  // origen, así que se puede leer el de arriba.
  function leerObjetivo() {
    var fuentes = [];
    try { fuentes.push(location.hash); } catch (e) {}
    try { if (window.top !== window) fuentes.push(window.top.location.hash); } catch (e) {}

    for (var i = 0; i < fuentes.length; i++) {
      var m = /tsjfo=(\d+)\/(\d+)/.exec(fuentes[i] || '');
      if (m) return { circuito: m[1], organo: m[2] };
    }
    return null;
  }

  // El onchange que ASP.NET cuelga del desplegable ya lleva el postback, y un
  // evento despachado sí dispara los manejadores en línea. Si aun así no se
  // mueve nada, lo lanzamos a mano: el temporizador muere con la navegación
  // cuando el primer camino funcionó.
  function forzarPostback(el) {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(function () {
      if (typeof window.__doPostBack === 'function') {
        log('el onchange no llevaba postback; lo lanzo a mano para', el.name);
        window.__doPostBack(el.name, '');
      }
    }, 1500);
  }

  function pulsarBuscar() {
    var cands = [].slice.call(document.querySelectorAll('input[type=submit],input[type=button],button'));
    var btn = null;
    for (var i = 0; i < cands.length; i++) {
      var etiqueta = cands[i].value || cands[i].textContent || '';
      if (/buscar|consultar|aceptar/i.test(etiqueta) && !/regresar|limpiar|volver/i.test(etiqueta)) {
        btn = cands[i];
        break;
      }
    }
    if (btn) {
      log('pulsando', btn.id || btn.value);
      btn.click();
      return;
    }
    // Sin botón reconocible: dejamos en consola lo que hay, para afinar el script.
    log('no encontré el botón de buscar. Candidatos:',
        cands.map(function (b) { return { id: b.id, etiqueta: b.value || b.textContent }; }));
  }

  // ── Máquina de dos pasos ────────────────────────────────────────────────
  var nuevo = leerObjetivo();
  if (nuevo) {
    nuevo.paso = 'circuito';
    sessionStorage.setItem(CLAVE, JSON.stringify(nuevo));
    log('objetivo recibido: circuito', nuevo.circuito, '/ órgano', nuevo.organo);
  }

  var crudo = sessionStorage.getItem(CLAVE);
  if (!crudo) return;

  var estado;
  try { estado = JSON.parse(crudo); } catch (e) { sessionStorage.removeItem(CLAVE); return; }

  var selCircuito = document.querySelector('select[id$="ddlCircuito"]');
  var selOrgano = document.querySelector('select[id$="ddlOrgano"]');

  if (!selCircuito) return;  // pantalla de resultados u otra página del portal

  if (estado.paso === 'circuito') {
    if (selCircuito.value !== estado.circuito) {
      var existeCircuito = [].some.call(selCircuito.options, function (o) { return o.value === estado.circuito; });
      if (!existeCircuito) {
        log('el circuito', estado.circuito, 'no está en la lista; abandono');
        sessionStorage.removeItem(CLAVE);
        return;
      }
      selCircuito.value = estado.circuito;
      estado.paso = 'organo';
      sessionStorage.setItem(CLAVE, JSON.stringify(estado));
      log('circuito puesto; esperando el postback que carga los órganos');
      forzarPostback(selCircuito);
      return;
    }
    estado.paso = 'organo';  // ya venía en ese circuito
  }

  if (estado.paso === 'organo') {
    if (!selOrgano || selOrgano.options.length <= 1) {
      log('los órganos aún no cargan; lo intento en la siguiente pasada');
      return;
    }
    var existeOrgano = [].some.call(selOrgano.options, function (o) { return o.value === estado.organo; });
    if (!existeOrgano) {
      log('el órgano', estado.organo, 'no aparece en el circuito', estado.circuito);
      sessionStorage.removeItem(CLAVE);
      return;
    }
    selOrgano.value = estado.organo;
    sessionStorage.removeItem(CLAVE);
    log('órgano puesto; lanzo la búsqueda');
    // Sin disparar change: si el desplegable tuviera postback propio, la
    // navegación pisaría el clic de buscar. WebForms envía el valor igual.
    pulsarBuscar();
  }
})();
