/**
 * Command Palette (Cmd/Ctrl+K) – TSJ Filing Online
 *
 * Exposed global: window.abrirPaletaComandos
 * Everything else is private to the IIFE.
 */
(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const MAX_RESULTS = 12;
  const OVERLAY_ID  = 'cmd-paleta-overlay';

  // ── XSS-safe text → HTML ───────────────────────────────────────────────────
  function esc(text) {
    const span = document.createElement('span');
    span.textContent = String(text == null ? '' : text);
    return span.innerHTML;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let datosCache      = null;   // { expedientes, notas, eventos, pendientes }
  let resultadosActuales = [];  // array of result objects shown right now
  let seleccionIdx    = -1;     // keyboard-selected index (-1 = none)

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function overlay()   { return document.getElementById(OVERLAY_ID); }
  function paleta()    { return document.getElementById('cmd-paleta'); }
  function inputEl()   { return document.getElementById('cmd-input'); }
  function resultsEl() { return document.getElementById('cmd-results'); }

  // ── Inject HTML (once) ─────────────────────────────────────────────────────
  function asegurarDOM() {
    if (overlay()) return;

    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Paleta de comandos');
    el.innerHTML =
      '<div id="cmd-paleta">' +
        '<div class="cmd-input-wrap">' +
          '<span class="cmd-search-icon" aria-hidden="true">⌕</span>' +
          '<input id="cmd-input" type="text" autocomplete="off" autocorrect="off"' +
          ' autocapitalize="off" spellcheck="false"' +
          ' placeholder="Buscar expedientes, pendientes, notas, eventos…" aria-label="Buscar">' +
          '<kbd title="Cerrar">Esc</kbd>' +
        '</div>' +
        '<div id="cmd-results" role="listbox" aria-label="Resultados"></div>' +
        '<div class="cmd-footer">' +
          '<span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>' +
          '<span><kbd>↵</kbd> abrir</span>' +
          '<span><kbd>Esc</kbd> cerrar</span>' +
        '</div>' +
      '</div>';

    document.body.appendChild(el);

    // Close on backdrop click (not on the card itself)
    el.addEventListener('mousedown', function (e) {
      if (e.target === el) cerrar();
    });
  }

  // ── Open ───────────────────────────────────────────────────────────────────
  async function abrir() {
    asegurarDOM();

    const ov = overlay();
    const inp = inputEl();

    // Reset state
    inp.value       = '';
    seleccionIdx    = -1;
    datosCache      = null;

    mostrarCargando();
    ov.classList.add('activo');
    inp.focus();

    // Bind events (idempotent via named handlers stored on el)
    inp.removeEventListener('input',   onInput);
    inp.addEventListener('input',      onInput);

    ov.removeEventListener('keydown',  onKeyDown);
    ov.addEventListener('keydown',     onKeyDown);

    // Load data fresh
    try {
      const [expedientes, notas, eventos, pendientes] = await Promise.all([
        (typeof obtenerExpedientes === 'function') ? obtenerExpedientes() : Promise.resolve([]),
        (typeof obtenerNotas       === 'function') ? obtenerNotas()       : Promise.resolve([]),
        (typeof obtenerEventos     === 'function') ? obtenerEventos()     : Promise.resolve([]),
        (typeof obtenerPendientes  === 'function') ? obtenerPendientes()  : Promise.resolve([]),
      ]);
      datosCache = {
        expedientes: expedientes || [], notas: notas || [],
        eventos: eventos || [], pendientes: pendientes || []
      };
    } catch (err) {
      datosCache = { expedientes: [], notas: [], eventos: [], pendientes: [] };
      console.warn('[CmdPalette] Error cargando datos', err);
    }

    // Show initial state (empty query → no results yet, just placeholder)
    renderResultados('');
  }

  // ── Close ──────────────────────────────────────────────────────────────────
  function cerrar() {
    const ov = overlay();
    if (ov) ov.classList.remove('activo');
    seleccionIdx = -1;
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  function mostrarCargando() {
    const r = resultsEl();
    if (!r) return;
    r.innerHTML = '<div class="cmd-loading">Cargando…</div>';
  }

  // ── Search & filter ────────────────────────────────────────────────────────
  function matches(texto, query) {
    if (!texto) return false;
    return String(texto).toLowerCase().includes(query);
  }

  function buscar(query) {
    if (!datosCache) return [];

    const q = query.toLowerCase().trim();
    const resultados = [];

    // ── Expedientes ──
    for (const exp of datosCache.expedientes) {
      if (resultados.length >= MAX_RESULTS) break;
      if (
        !q ||
        matches(exp.numero,     q) ||
        matches(exp.nombre,     q) ||
        matches(exp.juzgado,    q) ||
        matches(exp.actor,      q) ||
        matches(exp.demandado,  q) ||
        matches(exp.comentario, q)
      ) {
        const esPJF = exp.institucion === 'PJF';
        resultados.push({
          tipo:    esPJF ? 'pjf' : 'expediente',
          icono:   esPJF ? '🏛️' : '📂',
          tipoLabel: esPJF ? 'PJF' : 'Expediente',
          titulo:  exp.numero || exp.nombre || '(sin número)',
          subtitulo: [exp.actor, exp.demandado].filter(Boolean).join(' / ') ||
                     exp.juzgado || '',
          id:      exp.id,
          accion:  esPJF ? 'expedientePJF' : 'expediente',
        });
      }
    }

    // ── Notas ──
    for (const nota of datosCache.notas) {
      if (resultados.length >= MAX_RESULTS) break;
      if (
        !q ||
        matches(nota.titulo,    q) ||
        matches(nota.contenido, q)
      ) {
        resultados.push({
          tipo:     'nota',
          icono:    '📝',
          tipoLabel: 'Nota',
          titulo:   nota.titulo || '(sin título)',
          subtitulo: nota.contenido
            ? String(nota.contenido).slice(0, 80)
            : '',
          id:       nota.id,
          accion:   'nota',
        });
      }
    }

    // ── Pendientes ──
    // Los que están por hacer van antes que los terminados: buscar un
    // pendiente casi siempre es buscar algo que falta.
    const pendientesOrdenados = (datosCache.pendientes || []).slice().sort(function (a, b) {
      return (a.completado ? 1 : 0) - (b.completado ? 1 : 0);
    });
    for (const p of pendientesOrdenados) {
      if (resultados.length >= MAX_RESULTS) break;
      if (
        !q ||
        matches(p.titulo,          q) ||
        matches(p.descripcion,     q) ||
        matches(p.expedienteTexto, q)
      ) {
        resultados.push({
          tipo:     'pendiente',
          icono:    p.completado ? '☑️' : '✅',
          tipoLabel: p.completado ? 'Pendiente terminado' : 'Pendiente',
          titulo:   p.titulo || '(sin título)',
          subtitulo: p.descripcion
            ? String(p.descripcion).slice(0, 80)
            : (p.expedienteTexto || ''),
          id:       p.id,
          accion:   'pendiente',
        });
      }
    }

    // ── Eventos ──
    for (const ev of datosCache.eventos) {
      if (resultados.length >= MAX_RESULTS) break;
      if (
        !q ||
        matches(ev.titulo,           q) ||
        matches(ev.descripcion,      q) ||
        matches(ev.expedienteTexto,  q)
      ) {
        resultados.push({
          tipo:     'evento',
          icono:    '📅',
          tipoLabel: 'Evento',
          titulo:   ev.titulo || '(sin título)',
          subtitulo: ev.expedienteTexto || ev.fecha || '',
          id:       ev.id,
          accion:   'evento',
        });
      }
    }

    return resultados;
  }

  // ── Render results ─────────────────────────────────────────────────────────
  function renderResultados(query) {
    const r = resultsEl();
    if (!r) return;

    if (!datosCache) {
      mostrarCargando();
      return;
    }

    resultadosActuales = buscar(query);
    seleccionIdx = -1;

    if (resultadosActuales.length === 0) {
      if (!query.trim()) {
        r.innerHTML = '<div class="cmd-empty">Escribe para buscar…</div>';
      } else {
        r.innerHTML = '<div class="cmd-empty">Sin resultados para <strong>' + esc(query) + '</strong></div>';
      }
      return;
    }

    // Group by tipo for section headers
    const groups = [];
    let lastTipo = null;
    for (const res of resultadosActuales) {
      if (res.tipo !== lastTipo) {
        groups.push({ headerTipo: res.tipo, headerLabel: res.tipoLabel, items: [] });
        lastTipo = res.tipo;
      }
      groups[groups.length - 1].items.push(res);
    }

    let html = '';
    let globalIdx = 0;
    for (const g of groups) {
      html += '<div class="cmd-group">';
      html += '<div class="cmd-group-header">' + esc(g.headerLabel + 's') + '</div>';
      for (const item of g.items) {
        const idx = globalIdx++;
        html +=
          '<div class="cmd-result-item" role="option" aria-selected="false"' +
          ' data-idx="' + idx + '">' +
            '<span class="cmd-result-icon" aria-hidden="true">' + item.icono + '</span>' +
            '<span class="cmd-result-text">' +
              '<span class="cmd-result-titulo">' + esc(item.titulo) + '</span>' +
              (item.subtitulo
                ? '<span class="cmd-result-subtitulo">' + esc(item.subtitulo) + '</span>'
                : '') +
            '</span>' +
            '<span class="cmd-result-tipo">' + esc(item.tipoLabel) + '</span>' +
          '</div>';
      }
      html += '</div>';
    }

    r.innerHTML = html;

    // Bind click on each row
    r.querySelectorAll('.cmd-result-item').forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault(); // prevent input blur
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        seleccionar(idx);
      });
    });
  }

  // ── Selection / activation ─────────────────────────────────────────────────
  function setSeleccion(idx) {
    const r = resultsEl();
    if (!r) return;

    const items = r.querySelectorAll('.cmd-result-item');
    items.forEach(function (el) {
      el.classList.remove('seleccionado');
      el.setAttribute('aria-selected', 'false');
    });

    if (idx >= 0 && idx < items.length) {
      seleccionIdx = idx;
      items[idx].classList.add('seleccionado');
      items[idx].setAttribute('aria-selected', 'true');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else {
      seleccionIdx = -1;
    }
  }

  function seleccionar(idx) {
    const item = resultadosActuales[idx];
    if (!item) return;

    cerrar();

    // Small timeout so DOM settles before navigation/modal open
    setTimeout(function () {
      switch (item.accion) {
        case 'expediente':
          if (typeof navegarA === 'function') navegarA('expedientes');
          setTimeout(function () {
            if (typeof editarExpediente === 'function') editarExpediente(item.id);
          }, 150);
          break;

        case 'expedientePJF':
          if (typeof navegarA === 'function') navegarA('pjf');
          setTimeout(function () {
            if (typeof editarExpedientePJF === 'function') editarExpedientePJF(item.id);
          }, 150);
          break;

        case 'nota':
          if (typeof navegarA === 'function') navegarA('notas');
          setTimeout(function () {
            if (typeof editarNota === 'function') editarNota(item.id);
          }, 150);
          break;

        case 'pendiente':
          if (typeof navegarA === 'function') navegarA('pendientes');
          setTimeout(function () {
            if (typeof mostrarFormularioPendiente === 'function') mostrarFormularioPendiente(item.id);
          }, 150);
          break;

        case 'evento':
          if (typeof navegarA === 'function') navegarA('calendario');
          setTimeout(function () {
            if (typeof editarEvento === 'function') editarEvento(item.id);
          }, 150);
          break;

        default:
          if (typeof mostrarToast === 'function') {
            mostrarToast('Acción no reconocida', 'warning');
          }
      }
    }, 80);
  }

  // ── Event handlers ─────────────────────────────────────────────────────────
  function onInput() {
    renderResultados(inputEl().value);
  }

  function onKeyDown(e) {
    const total = resultadosActuales.length;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        cerrar();
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (total > 0) {
          setSeleccion(seleccionIdx < total - 1 ? seleccionIdx + 1 : 0);
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (total > 0) {
          setSeleccion(seleccionIdx > 0 ? seleccionIdx - 1 : total - 1);
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (seleccionIdx >= 0) {
          seleccionar(seleccionIdx);
        } else if (total === 1) {
          // Auto-select only result
          seleccionar(0);
        }
        break;

      default:
        break;
    }
  }

  // ── Global keyboard shortcut (Cmd/Ctrl+K) ──────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const ov = overlay();
      if (ov && ov.classList.contains('activo')) {
        cerrar();
      } else {
        abrir();
      }
    }
  });

  // ── Public API ─────────────────────────────────────────────────────────────
  window.abrirPaletaComandos = abrir;

}());
