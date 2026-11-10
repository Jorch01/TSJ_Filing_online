/**
 * Íconos propios en lugar de emojis.
 *
 * La app arma sus textos con emojis en muchos lugares (botones, avisos,
 * tarjetas, el asistente de voz). Esos mismos textos también se leen en voz
 * alta o se mandan por WhatsApp y a Google Calendar, así que no se tocan en
 * el código: aquí, al pintarse en pantalla, cada emoji se cambia por su ícono
 * del juego de íconos de index.html (<symbol id="i-...">).
 *
 * - En texto visible: el emoji se vuelve <svg class="ico ico-emoji">.
 * - En <option>, <title> y atributos (title, aria-label, placeholder, alt),
 *   donde no cabe un ícono, el emoji se quita.
 * - Las flechas y signos de teclado (→ ← ⌘ ⇧ …) se quedan como están.
 */
(function () {
    'use strict';

    const GRUPOS = {
        buscar: '🔍🔎⌕',
        pendientes: '✅☑',
        check: '✓✔',
        alerta: '⚠🐞',
        portapapeles: '📋',
        mas: '➕',
        expedientes: '📁📂🗂',
        archivar: '🗄📦📭',
        tribunales: '🏛🏢',
        pjf: '⚖',
        calendario: '📅📆🗓',
        pin: '📌',
        editar: '✏',
        guardar: '💾',
        globo: '🌐',
        basura: '🗑',
        estrella: '⭐🚀',
        ia: '🤖🧪✨🎉',
        notas: '📝📒',
        acuerdo: '📄📜📰🧾',
        descargar: '📥⬇',
        subir: '📤',
        brujula: '🧭',
        sincronizar: '🔄🔁♻',
        foco: '💡',
        casco: '👷',
        reloj: '⏳⏱🕒🕘⏰⌛',
        avisos: '🔔📢',
        usuario: '👤🧑👨👩👧👦',
        candado: '🔒🔐',
        estadisticas: '📊📈',
        chat: '💬👋',
        laboral: '🧮',
        dinero: '💰💸💵',
        instalar: '📲📱💻',
        ojo: '👁',
        mic: '🎤🎙',
        hash: '🔢',
        trabajo: '💼',
        recomendar: '🤝',
        enlace: '🔗',
        prohibido: '⛔🚫',
        imagen: '🖼📷📸',
        ajustes: '⚙🎨',
        sonido: '🔊',
        silencio: '🔇',
        correo: '📧✉',
        etiqueta: '🏷',
        imprimir: '🖨',
        bandera: '🏁',
        impi: '🔰',
        ayuda: '❓❔',
        'sin-red': '📴',
        sol: '🏖🌴🏝',
        ubicacion: '📍',
        inicio: '🏠',
        rayo: '⚡',
        cerrar: '✕✖',
        menu: '☰'
    };
    // Los puntos de color dicen un estado: se pintan como punto, con su color.
    const PUNTOS = { '🔴': 'rojo', '🟡': 'amarillo', '🟢': 'verde', '🔵': 'azul', '⚪': 'gris', '🟠': 'naranja' };

    const MAPA = {};
    for (const [icono, emojis] of Object.entries(GRUPOS)) {
        for (const e of Array.from(emojis)) MAPA[e] = icono;
    }
    const todos = Object.keys(MAPA).concat(Object.keys(PUNTOS));
    // El selector de variante (U+FE0F) y el "joiner" que a veces los siguen.
    const RE = new RegExp('(' + todos.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')[\\uFE0F\\u200D]*', 'gu');
    const RE_PRUEBA = new RegExp(RE.source, 'u');

    const SVG = 'http://www.w3.org/2000/svg';
    const SIN_ICONO = 'script, style, textarea, title, option, optgroup, select, svg, [data-sin-iconos]';
    const ATRIBUTOS = ['title', 'aria-label', 'placeholder', 'alt'];

    function crearIcono(emoji) {
        const s = document.createElementNS(SVG, 'svg');
        const punto = PUNTOS[emoji];
        s.setAttribute('class', punto ? 'ico ico-emoji ico-punto ico-punto-' + punto : 'ico ico-emoji');
        s.setAttribute('aria-hidden', 'true');
        s.setAttribute('focusable', 'false');
        const u = document.createElementNS(SVG, 'use');
        u.setAttribute('href', '#i-' + (punto ? 'punto' : MAPA[emoji]));
        s.appendChild(u);
        return s;
    }

    /** Quita los emojis de un texto plano (y el espacio que los separaba). */
    function quitarEmojis(texto) {
        return texto.replace(new RegExp(RE.source + '\\s?', 'gu'), '').replace(/\s{2,}/g, ' ').trim();
    }

    function convertirTexto(nodo) {
        const texto = nodo.nodeValue;
        if (!texto || !RE_PRUEBA.test(texto)) return;
        const padre = nodo.parentElement;
        if (!padre) return;
        if (padre.closest(SIN_ICONO)) {
            // <option>, <title>: no admiten íconos; el emoji se quita.
            if (padre.closest('option, optgroup, title')) nodo.nodeValue = quitarEmojis(texto);
            return;
        }
        const frag = document.createDocumentFragment();
        let ultimo = 0;
        RE.lastIndex = 0;
        let m;
        while ((m = RE.exec(texto))) {
            if (m.index > ultimo) frag.appendChild(document.createTextNode(texto.slice(ultimo, m.index)));
            frag.appendChild(crearIcono(m[1]));
            ultimo = m.index + m[0].length;
        }
        if (ultimo < texto.length) frag.appendChild(document.createTextNode(texto.slice(ultimo)));
        padre.replaceChild(frag, nodo);
    }

    function convertirAtributos(el) {
        for (const a of ATRIBUTOS) {
            const v = el.getAttribute(a);
            if (v && RE_PRUEBA.test(v)) el.setAttribute(a, quitarEmojis(v));
        }
    }

    function convertir(raiz) {
        if (!raiz) return;
        if (raiz.nodeType === Node.TEXT_NODE) { convertirTexto(raiz); return; }
        if (raiz.nodeType !== Node.ELEMENT_NODE && raiz.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
        if (raiz.nodeType === Node.ELEMENT_NODE) {
            convertirAtributos(raiz);
            if (raiz.matches('option, optgroup')) { if (RE_PRUEBA.test(raiz.textContent)) raiz.textContent = quitarEmojis(raiz.textContent); return; }
        }
        // Primero se juntan los nodos y luego se cambian: cambiar mientras se
        // recorre saltaría nodos.
        const textos = [];
        const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = recorrido.nextNode())) {
            if (n.nodeType === Node.TEXT_NODE) {
                if (RE_PRUEBA.test(n.nodeValue)) textos.push(n);
            } else {
                convertirAtributos(n);
                if (n.matches('option, optgroup') && RE_PRUEBA.test(n.textContent)) n.textContent = quitarEmojis(n.textContent);
            }
        }
        textos.forEach(convertirTexto);
    }

    const observador = new MutationObserver((cambios) => {
        for (const c of cambios) {
            if (c.type === 'childList') c.addedNodes.forEach(convertir);
            else if (c.type === 'characterData') convertirTexto(c.target);
            else if (c.type === 'attributes') convertirAtributos(c.target);
        }
    });

    function iniciar() {
        convertir(document.body || document.documentElement);
        observador.observe(document.documentElement, {
            childList: true, subtree: true, characterData: true,
            attributes: true, attributeFilter: ATRIBUTOS
        });
    }

    // Se carga al principio del <body>: observa desde ya lo que el navegador
    // va leyendo de la página, así ningún emoji llega a pintarse.
    iniciar();

    window.IconosEmoji = { MAPA, PUNTOS, convertir, quitarEmojis };
})();
