/**
 * Asistente de Voz – TSJ Filing Online
 *
 * Botón flotante (micrófono) disponible en TODAS las páginas del sitio.
 * Permite dar instrucciones por voz (o texto) para que la app ejecute
 * acciones automáticamente:
 *
 *   - Agendar / editar / eliminar eventos del calendario (uno o varios a la
 *     vez: fecha, hora, título, descripción, expediente)
 *   - Crear / editar / archivar expedientes
 *   - Crear notas
 *   - Buscar en el catálogo local de expedientes
 *   - Abrir búsquedas en estrados del TSJ Quintana Roo (local)
 *   - Abrir búsquedas en el Poder Judicial de la Federación (federal)
 *   - Varias búsquedas en una orden: varios tipos de asunto, todos los
 *     tipos, varios órganos o juzgados, y TSJ y PJF mezclados
 *   - Consultar la agenda ("¿qué audiencias tengo esta semana?")
 *
 * Si falta información obligatoria, el asistente PREGUNTA por el dato
 * faltante (por voz y en pantalla) y continúa la conversación hasta
 * completar la acción. Toda acción que modifica datos requiere
 * confirmación explícita del usuario (botón o respondiendo "sí").
 *
 * Requisitos: API Key de Groq configurada (la misma del Análisis IA).
 * Reconocimiento de voz: Web Speech API (Chrome/Edge/Safari). En
 * navegadores sin soporte (Firefox) se graba el audio y se transcribe
 * con la propia IA cuando el navegador no reconoce la voz.
 *
 * Global expuesto: window.VOZ = { abrir, cerrar, ejecutar }
 */
(function () {
    'use strict';

    // ==================== CONSTANTES ====================

    const TTS_KEY = 'voz_tts_activado';          // localStorage: respuestas habladas
    const RATE_KEY = 'voz_tts_velocidad';        // localStorage: velocidad de la voz
    const AUTO_KEY = 'voz_auto_escucha';         // localStorage: escuchar al abrir el panel
    // El modelo ya no se elige aquí: lo lleva llamarIA(), que lo lee de la
    // configuración y lo sustituye solo si el proveedor lo retira. Tener el
    // nombre escrito en este archivo fue lo que dejó mudo al asistente cuando
    // Groq retiró llama-3.3-70b-versatile.
    const MAX_TURNOS = 16;                        // tope de la conversación de slot-filling

    // Acciones que modifican datos → siempre piden confirmación.
    // "deshacer" es la excepción deliberada: se ejecuta directo porque es la
    // válvula de seguridad para revertir rápido una confirmación equivocada.
    const ACCIONES_MUTANTES = new Set([
        'crear_evento', 'editar_evento', 'eliminar_evento',
        'crear_expediente', 'editar_expediente', 'archivar_expediente',
        'crear_nota', 'mover_a_carpeta',
        'crear_pendiente', 'completar_pendiente'
    ]);

    // La negación se evalúa SIEMPRE antes que la afirmación: cancelar por
    // error es inofensivo, confirmar por error es destructivo.
    // Se evalúan sobre el texto SIN acentos (normalizar()): \b de JavaScript
    // no reconoce vocales acentuadas como letras, por lo que /sí\b/ jamás
    // haría match con el "sí" que transcribe el reconocimiento de voz.
    const RE_SI = /^\s*(si|confirmo|confirmar|confirmado|dale|adelante|correcto|asi es|ok|okey|hazlo|procede)\b/;
    const RE_NO = /^\s*(no|cancela|cancelar|cancelado|deten|olvidalo|mejor no|espera|por favor no|por favor cancela)\b/;

    // Cuántos órganos del PJF se abren de una vez como mucho. Por encima de
    // esto el navegador bloquea las ventanas y el resultado es inservible.
    const MAX_ORGANOS_PJF = 12;

    // Cuántas consultas se abren solas tras confirmar. Con más —todos los
    // tipos de asunto de varios órganos, todos los juzgados del TSJ— se deja
    // la lista con un botón por consulta y otro para abrirlas todas.
    const MAX_VENTANAS_AUTO = 20;

    // Tope de consultas que se preparan en una sola orden.
    const MAX_CONSULTAS = 80;

    const EJEMPLOS = [
        'Agenda audiencia del expediente 123/2025 el jueves a las 10',
        'Busca el 456/2024 en estrados del TSJ',
        'Busca la queja y el amparo directo 486/2026 en el primer colegiado del 27 circuito',
        'Cambia la audiencia del jueves para el viernes a las 12',
        '¿Qué audiencias tengo esta semana?',
        'Cambia el comentario del expediente 78/2025 a "pendiente de sentencia"'
    ];

    // Guía de referencia mostrada por el botón 💡 "Tips y comandos"
    const GUIA_COMANDOS = [
        {
            titulo: '📅 Calendario',
            items: [
                'Agenda audiencia del expediente 123/2025 el jueves a las 10',
                'Agenda un vencimiento el 15 de agosto: contestar demanda',
                'Cambia la audiencia del jueves para el viernes a las 12',
                'Pospón una semana la audiencia del 123/2025',
                'Agrégale a la descripción de la audiencia del viernes: llevar testigos',
                'Cambia la descripción del vencimiento del 15 a "presentar alegatos"',
                'Mueve las audiencias del lunes al martes a la misma hora',
                'Elimina el recordatorio del lunes',
                '¿Qué audiencias tengo esta semana?'
            ]
        },
        {
            titulo: '📁 Expedientes',
            items: [
                'Crea el expediente 456/2025 en el Juzgado Primero Civil de Cancún',
                'Abre el expediente 123/2025',
                'Cambia el comentario del 123/2025 a "pendiente de sentencia"',
                'Cambia el juzgado del 88/2024 al Segundo Mercantil de Cancún',
                'Mueve el 123/2025 a la carpeta del caso García',
                'Archiva el expediente 88/2024 como concluido',
                'Deshaz lo último'
            ]
        },
        {
            titulo: '📝 Notas',
            items: [
                'Agrega nota al 123/2025: llamar al perito el lunes',
                'Crea una nota: preparar alegatos del caso García'
            ]
        },
        {
            titulo: '🔍 Búsquedas',
            items: [
                'Busca mis expedientes de divorcio',
                '¿Tengo algo de Juan Pérez en mi catálogo?',
                'Busca el 456/2024 en estrados del TSJ',
                'Busca 789/2025 en todas las salas de segunda instancia',
                'Busca a María López por nombre en todos los juzgados',
                'Consulta el amparo indirecto 55/2025 en el Juzgado Segundo de Distrito de Cancún',
                'Abre el estrado del amparo directo 486/2026 del primer tribunal colegiado del 27 circuito',
                'Ábreme los estrados del amparo en revisión 12/2026 del segundo colegiado del XXVII circuito',
                'Busca el amparo directo 486/2026 en los tres colegiados del 27 circuito',
                'Busca el amparo directo 100/2026 en los colegiados del 27 y del 28 circuito',
                'Busca la queja y el amparo directo 486/2026 en el primer colegiado del 27 circuito',
                'Busca el 55/2026 en todos los tipos de asunto del segundo colegiado del 27 circuito',
                'Busca el 123/2025 en los juzgados primero y segundo civil de Cancún',
                'Busca el 123/2025 en el primero civil de Cancún y el amparo indirecto 45/2026 en el juzgado primero de distrito de Quintana Roo'
            ]
        },
        {
            titulo: '🧭 Navegación',
            items: [
                'Llévame al calendario',
                'Abre la búsqueda del PJF',
                'Ve a configuración'
            ]
        }
    ];

    const TIPS = [
        'Dicta los números de expediente como "123 diagonal 2025".',
        'Toda acción que modifica datos te pedirá confirmación: responde "sí" o "no" por voz, o usa los botones.',
        'Si propongo algo con un error, dime la corrección directamente: "mejor a las 11".',
        'Si falta un dato (hora, juzgado…), te lo preguntaré; puedes responder por voz o escribiendo.',
        'Si mencionas un expediente de tu catálogo, uso su juzgado guardado automáticamente en las búsquedas.',
        'Puedes pedir varias búsquedas en una sola orden: varios tipos de asunto ("la queja y el amparo directo"), "en todos los tipos de asunto", varios órganos, o asuntos del TSJ y del PJF juntos. Antes de abrir te enseño la lista.',
        'Para cambiar un evento basta con decir cuál y qué cambia: "pospón una semana la audiencia del 123/2025", "agrégale a la descripción…". Antes de guardar te enseño el antes y el después.',
        'Di "deshaz lo último" para revertir la acción más reciente hecha por el asistente.',
        'Con 🔊/🔇 activas o silencias mis respuestas habladas; en Configuración puedes ajustar la velocidad de la voz y la escucha automática.',
        'También puedes escribir la instrucción en el campo de texto de abajo.'
    ];

    // ==================== ESTADO ====================

    const Estado = {
        INACTIVO: 'inactivo',
        ESCUCHANDO: 'escuchando',       // Web Speech API activa
        GRABANDO: 'grabando',           // MediaRecorder (se transcribe con la IA)
        PROCESANDO: 'procesando',
        ESPERANDO_DATO: 'esperando_dato',
        ESPERANDO_CONFIRMACION: 'esperando_confirmacion'
    };

    let estado = Estado.INACTIVO;
    let conversacion = [];        // turnos user/assistant para el LLM (sin system)
    let accionPendiente = null;   // acción interpretada esperando confirmación
    let recognition = null;
    let descartarTranscript = false;  // true = el stop fue intencional (texto enviado,
                                      // panel cerrado, confirmación): ignorar el transcript
    let mediaRecorder = null;
    let chunksAudio = [];
    let ttsActivo = localStorage.getItem(TTS_KEY) !== '0';
    let pilaDeshacer = [];        // últimas acciones del asistente, para "deshaz lo último"

    // ==================== HELPERS ====================

    function esc(text) {
        const span = document.createElement('span');
        span.textContent = String(text == null ? '' : text);
        return span.innerHTML;
    }

    function normalizar(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    // "10" → "10:00", "9:5" → "09:05". null si no parece una hora.
    function normalizarHora(h) {
        if (!h) return null;
        const m = String(h).trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
        if (!m) return null;
        const hh = parseInt(m[1]), mm = parseInt(m[2] || '0');
        if (hh > 23 || mm > 59) return null;
        return pad(hh) + ':' + pad(mm);
    }

    function fechaLocalISO(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function toast(msg, tipo) {
        if (typeof mostrarToast === 'function') mostrarToast(msg, tipo || 'info');
    }

    // ==================== DESHACER ====================
    // Pila en memoria de las acciones ejecutadas por el asistente en esta
    // sesión. "Deshaz lo último" revierte la más reciente usando el núcleo
    // de acciones, así el revert también refresca UI y sincroniza.

    function registrarDeshacer(entrada) {
        pilaDeshacer.push(entrada);
        if (pilaDeshacer.length > 10) pilaDeshacer.shift();
    }

    async function accDeshacer() {
        const u = pilaDeshacer.pop();
        if (!u) throw new Error('No hay ninguna acción reciente del asistente que deshacer');
        switch (u.tipo) {
            case 'evento_creado':        await eliminarEventoCore(u.id); break;
            case 'evento_editado':       await actualizarEventoCore(u.id, u.antes); break;
            case 'evento_eliminado':     await crearEventoCore(u.evento); break;
            // Varios de una vez se deshacen juntos, en orden inverso.
            case 'eventos_editados':
                for (const x of u.eventos.slice().reverse()) await actualizarEventoCore(x.id, x.antes);
                break;
            case 'eventos_eliminados':
                for (const ev of u.eventos) await crearEventoCore(ev);
                break;
            case 'expediente_creado':    await eliminarExpedienteCore(u.id, true); break;
            case 'expediente_editado':   await actualizarExpedienteCore(u.id, u.antes); break;
            case 'expediente_archivado': await archivarExpedienteCore(u.id, false); break;
            case 'nota_creada':          await eliminarNotaCore(u.id); break;
            case 'pendiente_creado':     await eliminarPendienteCore(u.id); break;
            case 'pendiente_completado': await completarPendienteCore(u.id, false); break;
            default: throw new Error('No sé cómo deshacer esa acción');
        }
        toast('Acción deshecha', 'success');
        return `Deshecho: ${u.etiqueta}.`;
    }

    // ==================== UI: FAB + PANEL ====================

    function crearUI() {
        if (document.getElementById('voz-fab')) return;

        const fab = document.createElement('button');
        fab.id = 'voz-fab';
        fab.type = 'button';
        fab.title = 'Asistente de voz';
        fab.setAttribute('aria-label', 'Abrir asistente de voz');
        fab.innerHTML = '🎤';
        fab.addEventListener('click', alternarPanel);
        document.body.appendChild(fab);

        const panel = document.createElement('div');
        panel.id = 'voz-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Asistente de voz');
        panel.innerHTML =
            '<div class="voz-header">' +
                '<span class="voz-titulo">🎤 Asistente de voz</span>' +
                '<div class="voz-header-btns">' +
                    '<button type="button" id="voz-ayuda-toggle" title="Tips y comandos" aria-label="Tips y comandos">💡</button>' +
                    '<button type="button" id="voz-tts-toggle" title="Respuestas habladas"></button>' +
                    '<button type="button" id="voz-cerrar" title="Cerrar" aria-label="Cerrar">✕</button>' +
                '</div>' +
            '</div>' +
            '<div id="voz-ayuda" style="display:none;"></div>' +
            '<div id="voz-chat" aria-live="polite"></div>' +
            '<div id="voz-confirmacion" style="display:none;">' +
                '<div id="voz-confirmacion-texto"></div>' +
                '<div class="voz-confirmacion-btns">' +
                    '<button type="button" class="btn btn-secondary" id="voz-btn-cancelar">Cancelar</button>' +
                    '<button type="button" class="btn btn-primary" id="voz-btn-confirmar">✅ Confirmar</button>' +
                '</div>' +
            '</div>' +
            '<div id="voz-status"></div>' +
            '<div class="voz-footer">' +
                '<button type="button" id="voz-mic" title="Hablar" aria-label="Hablar">🎙️</button>' +
                '<input type="text" id="voz-input" placeholder="O escribe tu instrucción…" autocomplete="off">' +
                '<button type="button" id="voz-enviar" title="Enviar" aria-label="Enviar">➤</button>' +
            '</div>';
        document.body.appendChild(panel);

        document.getElementById('voz-cerrar').addEventListener('click', cerrarPanel);
        document.getElementById('voz-ayuda-toggle').addEventListener('click', alternarAyuda);
        document.getElementById('voz-mic').addEventListener('click', alternarMicrofono);
        document.getElementById('voz-enviar').addEventListener('click', enviarTexto);
        document.getElementById('voz-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); enviarTexto(); }
        });
        document.getElementById('voz-btn-confirmar').addEventListener('click', confirmarAccion);
        document.getElementById('voz-btn-cancelar').addEventListener('click', cancelarAccion);
        document.getElementById('voz-tts-toggle').addEventListener('click', () => {
            ttsActivo = !ttsActivo;
            localStorage.setItem(TTS_KEY, ttsActivo ? '1' : '0');
            if (!ttsActivo && 'speechSynthesis' in window) speechSynthesis.cancel();
            pintarTTSToggle();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panelAbierto()) cerrarPanel();
        });

        pintarTTSToggle();
    }

    function pintarTTSToggle() {
        const btn = document.getElementById('voz-tts-toggle');
        if (btn) {
            btn.textContent = ttsActivo ? '🔊' : '🔇';
            btn.title = ttsActivo ? 'Respuestas habladas: activadas' : 'Respuestas habladas: desactivadas';
        }
        // Mantener en sync el checkbox de la página de Configuración
        const cfg = document.getElementById('voz-cfg-tts');
        if (cfg) cfg.checked = ttsActivo;
    }

    // Conecta la tarjeta "Asistente de Voz" de la página de Configuración
    // (si existe) con los ajustes guardados en localStorage.
    function configurarAjustesUI() {
        const cfgTts = document.getElementById('voz-cfg-tts');
        const cfgAuto = document.getElementById('voz-cfg-auto');
        const cfgRate = document.getElementById('voz-cfg-rate');
        const cfgRateVal = document.getElementById('voz-cfg-rate-valor');
        if (!cfgTts && !cfgAuto && !cfgRate) return;

        const pintarRate = () => {
            if (cfgRate && cfgRateVal) cfgRateVal.textContent = parseFloat(cfgRate.value).toFixed(2) + 'x';
        };

        if (cfgTts) {
            cfgTts.checked = ttsActivo;
            cfgTts.addEventListener('change', () => {
                ttsActivo = cfgTts.checked;
                localStorage.setItem(TTS_KEY, ttsActivo ? '1' : '0');
                if (!ttsActivo && 'speechSynthesis' in window) speechSynthesis.cancel();
                pintarTTSToggle();
            });
        }
        if (cfgAuto) {
            cfgAuto.checked = localStorage.getItem(AUTO_KEY) !== '0';
            cfgAuto.addEventListener('change', () => {
                localStorage.setItem(AUTO_KEY, cfgAuto.checked ? '1' : '0');
            });
        }
        if (cfgRate) {
            cfgRate.value = parseFloat(localStorage.getItem(RATE_KEY)) || 1.05;
            pintarRate();
            cfgRate.addEventListener('input', () => {
                localStorage.setItem(RATE_KEY, cfgRate.value);
                pintarRate();
            });
        }
    }

    function panelAbierto() {
        const p = document.getElementById('voz-panel');
        return !!p && p.classList.contains('activo');
    }

    // ==================== AYUDA: TIPS Y COMANDOS ====================

    function ayudaAbierta() {
        const a = document.getElementById('voz-ayuda');
        return !!a && a.style.display !== 'none';
    }

    function construirAyuda() {
        const cont = document.getElementById('voz-ayuda');
        if (!cont || cont.childElementCount) return;

        const intro = document.createElement('div');
        intro.className = 'voz-ayuda-intro';
        intro.textContent = 'Esto es lo que puedo hacer. Toca un ejemplo para usarlo:';
        cont.appendChild(intro);

        GUIA_COMANDOS.forEach(seccion => {
            const h = document.createElement('div');
            h.className = 'voz-ayuda-titulo';
            h.textContent = seccion.titulo;
            cont.appendChild(h);
            seccion.items.forEach(texto => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'voz-ayuda-item';
                b.textContent = '“' + texto + '”';
                b.addEventListener('click', () => {
                    cerrarAyuda();
                    const input = document.getElementById('voz-input');
                    if (input) { input.value = texto; input.focus(); }
                });
                cont.appendChild(b);
            });
        });

        const ht = document.createElement('div');
        ht.className = 'voz-ayuda-titulo';
        ht.textContent = '💡 Tips';
        cont.appendChild(ht);
        const ul = document.createElement('ul');
        ul.className = 'voz-ayuda-tips';
        TIPS.forEach(tip => {
            const li = document.createElement('li');
            li.textContent = tip;
            ul.appendChild(li);
        });
        cont.appendChild(ul);
    }

    function abrirAyuda() {
        construirAyuda();
        const ayuda = document.getElementById('voz-ayuda');
        const chat = document.getElementById('voz-chat');
        const btn = document.getElementById('voz-ayuda-toggle');
        if (ayuda) ayuda.style.display = 'block';
        if (chat) chat.style.display = 'none';
        if (btn) btn.classList.add('activo');
    }

    function cerrarAyuda() {
        const ayuda = document.getElementById('voz-ayuda');
        const chat = document.getElementById('voz-chat');
        const btn = document.getElementById('voz-ayuda-toggle');
        if (ayuda) ayuda.style.display = 'none';
        if (chat) chat.style.display = 'flex';
        if (btn) btn.classList.remove('activo');
    }

    function alternarAyuda() {
        if (ayudaAbierta()) cerrarAyuda();
        else abrirAyuda();
    }

    function alternarPanel() {
        if (panelAbierto()) { cerrarPanel(); return; }
        abrirPanel();
    }

    async function abrirPanel() {
        crearUI();
        document.getElementById('voz-panel').classList.add('activo');

        const apiKey = await obtenerApiKey();
        if (!apiKey) {
            mostrarMensajeSinApiKey();
            return;
        }

        // Si quedó el aviso de "falta API key" de una apertura anterior, limpiarlo
        const chat = document.getElementById('voz-chat');
        if (chat.querySelector('.voz-btn-config')) chat.innerHTML = '';
        if (!chat.childElementCount) {
            mostrarBienvenida();
        }
        // Arrancar escucha de inmediato (configurable en Configuración)
        if (localStorage.getItem(AUTO_KEY) !== '0') iniciarEscucha();
    }

    function cerrarPanel() {
        detenerEscucha();
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        const p = document.getElementById('voz-panel');
        if (p) p.classList.remove('activo');
    }

    function mostrarBienvenida() {
        const chat = document.getElementById('voz-chat');
        const cont = document.createElement('div');
        cont.className = 'voz-msg voz-msg-asistente';
        cont.innerHTML = 'Dime qué necesitas: agendar, editar expedientes, notas o búsquedas.<div class="voz-ejemplos"></div>';
        chat.appendChild(cont);

        const ej = cont.querySelector('.voz-ejemplos');
        EJEMPLOS.forEach(texto => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'voz-chip';
            chip.textContent = texto;
            chip.addEventListener('click', () => {
                const input = document.getElementById('voz-input');
                input.value = texto;
                input.focus();
            });
            ej.appendChild(chip);
        });
        const chipAyuda = document.createElement('button');
        chipAyuda.type = 'button';
        chipAyuda.className = 'voz-chip voz-chip-ayuda';
        chipAyuda.textContent = '💡 Ver todos los tips y comandos';
        chipAyuda.addEventListener('click', abrirAyuda);
        ej.appendChild(chipAyuda);
        chat.scrollTop = chat.scrollHeight;
    }

    function mostrarMensajeSinApiKey() {
        const chat = document.getElementById('voz-chat');
        chat.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'voz-msg voz-msg-asistente';
        div.innerHTML = 'Para usar el asistente de voz necesitas configurar tu <strong>API Key de Groq</strong> ' +
            '(la misma del Análisis IA, es gratuita).';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary voz-btn-config';
        btn.textContent = '⚙️ Ir a Configuración';
        btn.addEventListener('click', () => {
            cerrarPanel();
            if (typeof navegarA === 'function') navegarA('config');
        });
        div.appendChild(btn);
        chat.appendChild(div);
        setStatus('');
    }

    function agregarMensaje(rol, htmlSeguro) {
        const chat = document.getElementById('voz-chat');
        if (!chat) return null;
        const div = document.createElement('div');
        div.className = 'voz-msg ' + (rol === 'usuario' ? 'voz-msg-usuario' : 'voz-msg-asistente');
        div.innerHTML = htmlSeguro;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
        return div;
    }

    function setStatus(texto, escuchando) {
        const st = document.getElementById('voz-status');
        if (st) st.innerHTML = texto ? esc(texto) : '';
        const mic = document.getElementById('voz-mic');
        const fab = document.getElementById('voz-fab');
        const activo = !!escuchando;
        if (mic) mic.classList.toggle('escuchando', activo);
        if (fab) fab.classList.toggle('escuchando', activo);
    }

    // ==================== TTS (respuestas habladas) ====================

    function hablar(texto, alTerminar) {
        if (!ttsActivo || !('speechSynthesis' in window) || !texto) {
            if (alTerminar) setTimeout(alTerminar, 200);
            return;
        }
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = 'es-MX';
        u.rate = parseFloat(localStorage.getItem(RATE_KEY)) || 1.05;
        if (alTerminar) {
            u.onend = alTerminar;
            u.onerror = alTerminar;
        }
        speechSynthesis.speak(u);
    }

    // ==================== RECONOCIMIENTO DE VOZ ====================

    function claseWebSpeech() {
        return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }

    function alternarMicrofono() {
        // Tocar el micrófono mientras escucha = "ya terminé de hablar":
        // se detiene PROCESANDO lo dicho hasta ahora.
        if (estado === Estado.ESCUCHANDO) { detenerEscucha(true); return; }
        if (estado === Estado.GRABANDO) { detenerGrabacion(); return; }
        if (estado === Estado.PROCESANDO) return;
        iniciarEscucha();
    }

    function iniciarEscucha() {
        if (estado === Estado.ESCUCHANDO || estado === Estado.GRABANDO || estado === Estado.PROCESANDO) return;
        const RC = claseWebSpeech();
        if (RC) {
            iniciarWebSpeech(RC);
        } else {
            iniciarGrabacion();
        }
    }

    function iniciarWebSpeech(RC) {
        try {
            recognition = new RC();
        } catch (e) {
            iniciarGrabacion();
            return;
        }
        recognition.lang = 'es-MX';
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        let transcriptFinal = '';

        recognition.onstart = () => {
            estado = Estado.ESCUCHANDO;
            setStatus('🔴 Escuchando… habla ahora', true);
        };
        recognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const r = event.results[i];
                if (r.isFinal) transcriptFinal += r[0].transcript;
                else interim += r[0].transcript;
            }
            if (interim) setStatus('🔴 ' + interim, true);
        };
        recognition.onerror = (event) => {
            estado = Estado.INACTIVO;
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                setStatus('Permiso de micrófono denegado. Puedes escribir tu instrucción abajo.', false);
            } else if (event.error === 'no-speech') {
                setStatus('No escuché nada. Toca el micrófono para reintentar o escribe abajo.', false);
            } else {
                setStatus('Error de micrófono (' + event.error + '). Escribe tu instrucción abajo.', false);
            }
        };
        recognition.onend = () => {
            recognition = null;
            if (estado === Estado.ESCUCHANDO) estado = Estado.INACTIVO;
            if (descartarTranscript) {
                // Detención intencional (texto enviado, panel cerrado, confirmación):
                // no procesar el transcript parcial ni mostrar avisos.
                descartarTranscript = false;
                return;
            }
            const texto = transcriptFinal.trim();
            if (texto) {
                setStatus('', false);
                procesarEntradaUsuario(texto);
            } else if (estado === Estado.INACTIVO) {
                setStatus('No escuché nada. Toca el micrófono para reintentar o escribe abajo.', false);
            }
        };

        try {
            descartarTranscript = false;
            recognition.start();
        } catch (e) {
            recognition = null;
            estado = Estado.INACTIVO;
            setStatus('No se pudo iniciar el micrófono. Escribe tu instrucción abajo.', false);
        }
    }

    /**
     * Detiene la escucha. Por defecto DESCARTA el transcript acumulado
     * (detenciones programáticas: texto enviado, panel cerrado, confirmación).
     * Con procesarPendiente=true lo procesa (el usuario tocó el micrófono
     * para indicar que terminó de hablar).
     */
    function detenerEscucha(procesarPendiente) {
        if (recognition) {
            descartarTranscript = !procesarPendiente;
            try { recognition.stop(); } catch (e) { /* ignorar */ }
        }
        if (estado === Estado.GRABANDO) {
            detenerGrabacion();
            return;
        }
        if (estado === Estado.ESCUCHANDO) estado = Estado.INACTIVO;
        setStatus('', false);
    }

    // --- Fallback: grabar y mandar el audio a la IA para transcribirlo ---

    function tipoAudioSoportado() {
        if (typeof MediaRecorder === 'undefined') return null;
        const tipos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
        for (const t of tipos) {
            if (MediaRecorder.isTypeSupported(t)) return t;
        }
        return '';
    }

    async function iniciarGrabacion() {
        const tipo = tipoAudioSoportado();
        if (tipo === null || !navigator.mediaDevices?.getUserMedia) {
            setStatus('Tu navegador no soporta dictado por voz. Escribe tu instrucción abajo.', false);
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            chunksAudio = [];
            mediaRecorder = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
            mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunksAudio.push(e.data); };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(chunksAudio, { type: mediaRecorder.mimeType || 'audio/webm' });
                mediaRecorder = null;
                if (blob.size < 1000) {
                    estado = Estado.INACTIVO;
                    setStatus('Grabación muy corta. Intenta de nuevo.', false);
                    return;
                }
                estado = Estado.PROCESANDO;
                setStatus('Transcribiendo audio…', false);
                try {
                    const texto = await transcribirAudio(blob);
                    estado = Estado.INACTIVO;
                    if (texto) {
                        setStatus('', false);
                        procesarEntradaUsuario(texto);
                    } else {
                        setStatus('No se entendió el audio. Intenta de nuevo.', false);
                    }
                } catch (err) {
                    estado = Estado.INACTIVO;
                    setStatus('Error al transcribir: ' + err.message, false);
                }
            };
            mediaRecorder.start();
            estado = Estado.GRABANDO;
            setStatus('🔴 Grabando… toca el micrófono para detener', true);
        } catch (e) {
            estado = Estado.INACTIVO;
            setStatus('Permiso de micrófono denegado. Puedes escribir tu instrucción abajo.', false);
        }
    }

    function detenerGrabacion() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch (e) { /* ignorar */ }
        }
    }

    // fetch con timeout: sin esto, una red colgada dejaría el asistente
    // atascado en "Procesando…" indefinidamente.
    async function fetchConTimeout(url, opciones, ms) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms || 45000);
        try {
            return await fetch(url, { ...opciones, signal: ctrl.signal });
        } catch (e) {
            if (e.name === 'AbortError') throw new Error('La petición tardó demasiado. Revisa tu conexión e intenta de nuevo.');
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }

    async function transcribirAudio(blob) {
        const apiKey = await obtenerApiKey();
        if (!apiKey) throw new Error('Configura tu API Key de Gemini en Configuración');
        return transcribirAudioIA(blob, 'español de México');
    }

    // ==================== ENTRADA DE TEXTO ====================

    function enviarTexto() {
        const input = document.getElementById('voz-input');
        const texto = input.value.trim();
        if (!texto) return;
        input.value = '';
        detenerEscucha();
        procesarEntradaUsuario(texto);
    }

    // ==================== FLUJO PRINCIPAL ====================

    async function procesarEntradaUsuario(texto) {
        cerrarAyuda();
        agregarMensaje('usuario', esc(texto));

        // Respondiendo a una confirmación pendiente. Nota: se detecta por
        // accionPendiente (no por `estado`) porque el estado del micrófono
        // puede cambiar (reintentos, errores) sin que la confirmación caduque.
        if (accionPendiente) {
            const t = normalizar(texto);
            if (RE_NO.test(t)) { cancelarAccion(); return; }
            if (RE_SI.test(t)) { confirmarAccion(); return; }
            // Cualquier otra cosa se trata como corrección a la acción propuesta
            ocultarConfirmacion();
            accionPendiente = null;
            conversacion.push({ role: 'user', content: 'Quiero corregir la acción propuesta: ' + texto });
            await interpretar();
            return;
        }

        conversacion.push({ role: 'user', content: texto });
        await interpretar();
    }

    async function interpretar() {
        const apiKey = await obtenerApiKey();
        if (!apiKey) { mostrarMensajeSinApiKey(); return; }

        if (conversacion.length > MAX_TURNOS) {
            conversacion = [];
            accionPendiente = null;
            agregarMensaje('asistente', 'La conversación se hizo muy larga y la reinicié. Repite tu instrucción, por favor.');
            return;
        }

        estado = Estado.PROCESANDO;
        setStatus('🤖 Procesando…', false);

        try {
            const sistema = await construirPromptSistema();
            const respuesta = await llamarModelo(sistema, conversacion);
            conversacion.push({ role: 'assistant', content: JSON.stringify(respuesta) });
            estado = Estado.INACTIVO;
            setStatus('', false);
            await procesarRespuestaIA(respuesta);
        } catch (e) {
            estado = Estado.INACTIVO;
            setStatus('', false);
            console.error('[VOZ] Error interpretando:', e);
            agregarMensaje('asistente', '⚠️ ' + esc(e.message || 'No pude procesar la instrucción. Intenta de nuevo.'));
        }
    }

    async function procesarRespuestaIA(r) {
        const accion = r.accion || 'responder';
        const p = r.parametros || {};

        // 1) Falta información → preguntar y seguir escuchando
        if (r.faltan_datos && r.pregunta) {
            estado = Estado.ESPERANDO_DATO;
            agregarMensaje('asistente', '❓ ' + esc(r.pregunta));
            hablar(r.pregunta, () => { if (panelAbierto()) iniciarEscucha(); });
            return;
        }

        // 2) Búsquedas y cambios a eventos: se resuelven ANTES de confirmar, para
        //    enseñar exactamente qué se va a abrir o qué evento cambia y cómo,
        //    en vez del resumen que redactó el modelo.
        if (ACCIONES_BUSQUEDA.has(accion)) {
            await prepararBusqueda(r);
            return;
        }
        if (accion === 'editar_evento' || accion === 'eliminar_evento') {
            await prepararCambioDeEventos(r);
            return;
        }

        // 3) Acción que modifica datos → confirmar
        if (ACCIONES_MUTANTES.has(accion)) {
            pedirConfirmacion(r, r.resumen || 'Ejecutar: ' + accion);
            return;
        }

        // 4) Acción no destructiva → ejecutar directo
        await ejecutarAccion(r);
    }

    function pedirConfirmacion(r, resumen, detalles) {
        accionPendiente = r;
        estado = Estado.ESPERANDO_CONFIRMACION;
        mostrarConfirmacion(resumen, detalles);
        // La flecha del "antes → después" no se lee bien en voz alta.
        hablar(resumen.replace(/\s*→\s*/g, ', pasa a ') + '. ¿Confirmas?', () => { if (panelAbierto()) iniciarEscucha(); });
    }

    function mostrarConfirmacion(resumen, detalles) {
        const cont = document.getElementById('voz-confirmacion');
        const txt = document.getElementById('voz-confirmacion-texto');
        let lista = '';
        if (detalles && detalles.length) {
            lista = '<ul class="voz-lista voz-confirmacion-lista">' +
                detalles.map(d => '<li>' + esc(d) + '</li>').join('') + '</ul>';
        }
        if (txt) txt.innerHTML = '⚡ <strong>Acción propuesta:</strong><br>' + esc(resumen) + (lista || '<br>') +
            '<span class="voz-hint">Di "sí" para confirmar o "no" para cancelar.</span>';
        if (cont) cont.style.display = 'block';
    }

    function ocultarConfirmacion() {
        const cont = document.getElementById('voz-confirmacion');
        if (cont) cont.style.display = 'none';
    }

    async function confirmarAccion() {
        const r = accionPendiente;
        accionPendiente = null;
        ocultarConfirmacion();
        estado = Estado.INACTIVO;
        detenerEscucha();
        if (!r) return;
        await ejecutarAccion(r);
    }

    function cancelarAccion() {
        accionPendiente = null;
        ocultarConfirmacion();
        estado = Estado.INACTIVO;
        conversacion = [];
        agregarMensaje('asistente', 'Acción cancelada. ¿Algo más?');
        hablar('Cancelado');
    }

    async function ejecutarAccion(r) {
        const accion = r.accion || 'responder';
        const p = r.parametros || {};
        if (accion === 'responder') {
            const mensajeFinal = r.respuesta || r.resumen || 'Listo.';
            agregarMensaje('asistente', esc(mensajeFinal));
            hablar(mensajeFinal);
            conversacion = [];
            return;
        }
        await ejecutarAccionResuelta(accion, p, r._plan);
    }

    // Ejecuta una acción ya identificada. Vive aparte de ejecutarAccion para
    // poder reanudarla tal cual cuando el usuario elige el expediente entre
    // varias posibilidades. "plan" es lo ya resuelto antes de confirmar
    // (búsquedas y cambios a eventos): se ejecuta tal cual se enseñó.
    async function ejecutarAccionResuelta(accion, p, plan) {
        try {
            let mensajeFinal = '';
            switch (accion) {
                case 'crear_evento':        mensajeFinal = await accCrearEvento(p); break;
                case 'editar_evento':       mensajeFinal = plan ? await aplicarEdicionesEventos(plan) : await accEditarEvento(p); break;
                case 'eliminar_evento':     mensajeFinal = plan ? await aplicarEliminacionEventos(plan) : await accEliminarEvento(p); break;
                case 'consultar_agenda':    mensajeFinal = await accConsultarAgenda(p); break;
                case 'crear_expediente':    mensajeFinal = await accCrearExpediente(p); break;
                case 'editar_expediente':   mensajeFinal = await accEditarExpediente(p); break;
                case 'archivar_expediente': mensajeFinal = await accArchivarExpediente(p); break;
                case 'crear_nota':          mensajeFinal = await accCrearNota(p); break;
                case 'crear_pendiente':     mensajeFinal = await accCrearPendiente(p); break;
                case 'completar_pendiente': mensajeFinal = await accCompletarPendiente(p); break;
                case 'consultar_pendientes': mensajeFinal = await accConsultarPendientes(p); break;
                case 'mover_a_carpeta':     mensajeFinal = await accMoverACarpeta(p); break;
                case 'abrir_expediente':    mensajeFinal = await accAbrirExpediente(p); break;
                case 'deshacer':            mensajeFinal = await accDeshacer(); break;
                case 'buscar_local':        mensajeFinal = await accBuscarLocal(p); break;
                case 'buscar_tsj':          mensajeFinal = plan ? ejecutarPlanBusqueda(plan) : await accBuscarTSJ(p); break;
                case 'buscar_pjf':          mensajeFinal = plan ? ejecutarPlanBusqueda(plan) : await accBuscarPJF(p); break;
                case 'buscar_varios':       mensajeFinal = plan ? ejecutarPlanBusqueda(plan) : await accBuscarVarios(p); break;
                case 'navegar':             mensajeFinal = accNavegar(p); break;
                default:
                    mensajeFinal = 'Listo.';
                    agregarMensaje('asistente', esc(mensajeFinal));
                    hablar(mensajeFinal);
                    conversacion = [];
                    return;
            }
            if (mensajeFinal) {
                agregarMensaje('asistente', '✅ ' + esc(mensajeFinal));
                hablar(mensajeFinal);
            }
            conversacion = [];
        } catch (e) {
            informarFallo(e);
        }
    }

    function informarFallo(e) {
        // Pedir que se elija un expediente no es un fallo: las opciones ya
        // están en pantalla y la acción sigue esperando.
        if (e._esEleccion) {
            agregarMensaje('asistente', esc(e.message));
            hablar(e.message);
            return;
        }
        if (e._esAviso) {
            agregarMensaje('asistente', esc(e.message));
            hablar(e.message);
            conversacion = [];
            return;
        }
        console.error('[VOZ] Error ejecutando acción:', e);
        agregarMensaje('asistente', '⚠️ Error: ' + esc(e.message));
        hablar('Ocurrió un error: ' + e.message);
        conversacion = [];
    }

    // ==================== EJECUTORES DE ACCIONES ====================

    async function accCrearEvento(p) {
        if (!p.titulo || !p.fecha) throw new Error('Faltan título o fecha del evento');
        const tipo = ['audiencia', 'vencimiento', 'recordatorio', 'otro'].includes(p.tipo) ? p.tipo : 'otro';
        const hora = normalizarHora(p.hora);
        const todoElDia = hora ? false : (p.todoElDia !== false);
        const fechaInicio = new Date(p.fecha + 'T' + (hora || '09:00'));
        if (isNaN(fechaInicio.getTime())) throw new Error('Fecha inválida: ' + p.fecha);

        const expEvento = await resolverExpedienteDeParametros(p, 'crear_evento');
        const nuevoId = await crearEventoCore({
            titulo: p.titulo,
            tipo,
            fechaInicio: fechaInicio.toISOString(),
            todoElDia,
            expedienteId: expEvento ? expEvento.id : null,
            expedienteTexto: expEvento ? null : (p.expedienteTexto || null),
            descripcion: p.descripcion || ''
        });
        registrarDeshacer({ tipo: 'evento_creado', id: nuevoId, etiqueta: `evento "${p.titulo}"` });
        toast('Evento creado', 'success');
        const cuando = fechaInicio.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) +
            (hora ? ' a las ' + hora : '');
        return `Evento "${p.titulo}" agendado para el ${cuando}.`;
    }

    // ==================== CAMBIOS A EVENTOS ====================
    // Editar o borrar va en dos pasos: primero se resuelve QUÉ evento y QUÉ
    // cambia exactamente, y solo después se aplica. Así la confirmación enseña
    // el antes y el después reales —no el resumen que redactó el modelo, que a
    // veces se equivocaba de día— y caben varios cambios en una sola orden.

    // Palabras con las que se nombra un evento pero que no están en ningún
    // título: exigirlas dejaba la búsqueda sin resultados.
    const PALABRAS_RUIDO_EVENTO = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'un', 'una', 'que', 'con', 'para', 'por', 'al', 'a', 'y', 'en', 'mi', 'mis', 'evento', 'eventos', 'cita', 'citas', 'calendario', 'agenda', 'expediente', 'exp']);

    // Llegan como lista; la forma antigua {eventoId, cambios} cuenta como una.
    function edicionesDe(p) {
        if (Array.isArray(p.ediciones) && p.ediciones.length) return p.ediciones.map(e => ({ ...(e || {}) }));
        return [{ eventoId: p.eventoId, buscar: p.buscar, eventoRef: p.eventoRef, cambios: p.cambios || {} }];
    }

    function eventosAEliminarDe(p) {
        if (Array.isArray(p.eventos) && p.eventos.length) return p.eventos.map(e => ({ ...(e || {}) }));
        return [{ eventoId: p.eventoId, buscar: p.buscar, eventoRef: p.eventoRef }];
    }

    function textoLimpio(v) {
        return typeof v === 'string' ? v.trim() : '';
    }

    function horaLocalDe(fechaISO) {
        const d = new Date(fechaISO);
        return isNaN(d.getTime()) ? null : pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // "jueves, 1 de octubre, 10:00" o "jueves, 1 de octubre (todo el día)",
    // siempre en la hora local: es la que tiene en la cabeza quien habla.
    function cuandoEsEvento(fechaISO, todoElDia) {
        const d = new Date(fechaISO);
        if (isNaN(d.getTime())) return 'sin fecha';
        const opciones = { weekday: 'long', day: 'numeric', month: 'long' };
        if (d.getFullYear() !== new Date().getFullYear()) opciones.year = 'numeric';
        const dia = d.toLocaleDateString('es-MX', opciones);
        return todoElDia ? `${dia} (todo el día)` : `${dia}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    async function mapaDeExpedientes() {
        const activos = await obtenerExpedientes().catch(() => []);
        const archivados = typeof obtenerExpedientesArchivados === 'function'
            ? await obtenerExpedientesArchivados().catch(() => []) : [];
        return new Map(activos.concat(archivados).map(e => [e.id, e]));
    }

    function expedienteDeEvento(ev, expedientesPorId) {
        const exp = ev.expedienteId != null ? expedientesPorId.get(ev.expedienteId) : null;
        return (exp && (exp.numero || exp.nombre)) || ev.expedienteTexto || ev.numeroExpediente || '';
    }

    // "123/2025", "0123/2025" y "el 123" apuntan al mismo expediente; un nombre
    // ("Ramírez") basta con que aparezca. Un número no se busca como subcadena:
    // "23/2025" no es el "123/2025".
    function mismoExpediente(etiqueta, buscado) {
        const e = normalizar(etiqueta).replace(/\s+/g, '');
        const b = normalizar(buscado).replace(/\b(diagonal|barra)\b/g, '/').replace(/\s+/g, '');
        if (!e || !b) return false;
        const sinCeros = (s) => s.replace(/^0+(?=\d)/, '');
        // Dicho con número: "123/2025", "exp. 0123/2025", "el 123".
        const m = b.match(/(\d+)\/(\d{2,4})/) ||
                  b.replace(/^(el|del|exp|expediente|num|numero)\.?/, '').match(/^(\d+)$/);
        if (!m) return e.includes(b);
        return (e.match(/\d+\/\d{2,4}/g) || []).some(x => {
            const [n, anio] = x.split('/');
            return sinCeros(n) === sinCeros(m[1]) && (!m[2] || anio === m[2]);
        });
    }

    function buscarEventosPorCriterios(criterios, eventos, expedientesPorId) {
        const tokens = normalizar(criterios.texto || '')
            .replace(/\s*\b(diagonal|barra)\b\s*/g, '/')    // "123 diagonal 2025" dictado
            .split(/[\s,;:"“”]+/)
            .filter(t => t && !PALABRAS_RUIDO_EVENTO.has(t));
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(textoLimpio(criterios.fecha)) ? textoLimpio(criterios.fecha) : null;
        const hora = normalizarHora(criterios.hora);
        const tipo = CORE_COLORES_EVENTOS[criterios.tipo] ? criterios.tipo : null;
        const expediente = textoLimpio(criterios.expediente);

        return eventos.filter(ev => {
            const d = new Date(ev.fechaInicio);
            if (fecha && (isNaN(d.getTime()) || fechaLocalISO(d) !== fecha)) return false;
            if (hora && (ev.todoElDia || horaLocalDe(ev.fechaInicio) !== hora)) return false;
            if (tipo && ev.tipo !== tipo) return false;
            const suExpediente = expedienteDeEvento(ev, expedientesPorId);
            if (expediente && !mismoExpediente(suExpediente, expediente)) return false;
            if (tokens.length) {
                const blob = normalizar([ev.titulo, ev.descripcion, ev.tipo, suExpediente].filter(Boolean).join(' '));
                if (!tokens.every(t => blob.includes(t))) return false;
            }
            return true;
        });
    }

    function describirCriterios(c) {
        const partes = [];
        if (textoLimpio(c.texto)) partes.push(`con “${textoLimpio(c.texto)}”`);
        if (textoLimpio(c.expediente)) partes.push(`del expediente ${textoLimpio(c.expediente)}`);
        if (c.tipo) partes.push(`de tipo ${c.tipo}`);
        if (/^\d{4}-\d{2}-\d{2}$/.test(textoLimpio(c.fecha))) {
            partes.push('del ' + new Date(textoLimpio(c.fecha) + 'T12:00')
                .toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }));
        }
        if (normalizarHora(c.hora)) partes.push(`a las ${normalizarHora(c.hora)}`);
        return partes.join(' ');
    }

    // Hacen falta datos del usuario, no es un fallo: varios eventos encajan.
    function ErrorEleccionEvento(candidatos, descripcion, indice) {
        const e = new Error(`Hay ${candidatos.length} eventos ${descripcion}. ¿Cuál?`);
        e._eleccionEvento = { candidatos, indice };
        return e;
    }

    /**
     * El evento del que habla el usuario. Por id si el modelo lo vio en la
     * agenda; si no —la agenda del prompt es parcial—, por lo que dijo: palabras
     * del título, su fecha, su hora, su expediente o su tipo, contra TODO el
     * calendario. Lanza un aviso si no hay ninguno y una elección si hay varios.
     */
    function resolverEventoReferido(ref, eventos, expedientesPorId, indice) {
        const id = parseInt(ref.eventoId);
        if (id) {
            const ev = eventos.find(e => e.id === id);
            if (ev) return ev;
        }
        const b = ref.buscar || {};
        const criterios = {
            texto: b.texto || ref.eventoRef || '',
            fecha: b.fecha, hora: b.hora, tipo: b.tipo, expediente: b.expediente
        };
        if (!Object.values(criterios).some(v => v && String(v).trim())) {
            throw ErrorAviso('No identifiqué qué evento. Dime su título, su fecha o su expediente.');
        }

        let candidatos = buscarEventosPorCriterios(criterios, eventos, expedientesPorId);
        if (candidatos.length > 1) {
            // Entre varios, lo que todavía no pasa: "la audiencia del 123" es
            // la que viene, no la del mes pasado.
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            const proximos = candidatos.filter(e => new Date(e.fechaInicio) >= hoy);
            if (proximos.length) candidatos = proximos;
        }
        if (candidatos.length === 1) return candidatos[0];

        const descripcion = describirCriterios(criterios);
        if (!candidatos.length) throw ErrorAviso(`No encontré ningún evento ${descripcion}.`);
        candidatos.sort((a, b2) => new Date(a.fechaInicio) - new Date(b2.fechaInicio));
        throw ErrorEleccionEvento(candidatos, descripcion, indice);
    }

    // El expediente al que se quiere pasar un evento. Si encajan varios se
    // pide precisarlo, en vez de escoger uno.
    async function expedienteParaEvento(c) {
        if (c.expedienteId != null && c.expedienteId !== '') {
            const exp = await obtenerExpediente(parseInt(c.expedienteId)).catch(() => null);
            if (exp) return exp;
        }
        const ref = textoLimpio(c.expedienteRef);
        if (!ref || typeof resolverExpedientePorReferencia !== 'function') throw ErrorAviso('¿A qué expediente lo paso?');
        const r = await resolverExpedientePorReferencia(ref);
        if (r.estado === 'unico') return r.expediente;
        if (r.estado === 'ninguno') throw ErrorAviso(`No encontré el expediente "${ref}".`);
        throw ErrorAviso(`"${ref}" coincide con varios expedientes: ` +
            r.candidatos.slice(0, 4).map(x => etiquetaExpediente(x.expediente)).join('; ') + '. Dímelo completo.');
    }

    /** Los campos que cambian de verdad, a partir de lo que se pidió. */
    async function calcularCambiosEvento(evento, c) {
        c = c || {};
        const cambios = {};

        const titulo = textoLimpio(c.titulo);
        if (titulo && titulo !== evento.titulo) cambios.titulo = titulo;
        if (c.tipo && CORE_COLORES_EVENTOS[c.tipo] && c.tipo !== evento.tipo) cambios.tipo = c.tipo; // el color lo ajusta el núcleo

        // Descripción: reemplazar, añadir al final o borrar. Una cadena vacía
        // NO borra: el modelo a veces rellena todos los campos del esquema, y
        // así se perdía la descripción entera al pedir solo otra fecha.
        const descripcionActual = evento.descripcion || '';
        let descripcion = descripcionActual;
        if (c.borrarDescripcion === true) descripcion = '';
        if (textoLimpio(c.descripcion)) descripcion = textoLimpio(c.descripcion);
        const agregado = textoLimpio(c.agregarDescripcion);
        if (agregado) descripcion = descripcion ? descripcion + '\n' + agregado : agregado;
        if (descripcion !== descripcionActual) cambios.descripcion = descripcion;

        // Fecha y hora, siempre en hora local. "moverDias" se calcula aquí,
        // sobre la fecha real del evento: la suma que hacía el modelo fallaba
        // en los cambios de mes.
        const base = new Date(evento.fechaInicio);
        const fechaPedida = textoLimpio(c.fecha);
        let fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaPedida) ? fechaPedida : null;
        if (fechaPedida && !fecha) throw ErrorAviso(`No entendí la fecha "${fechaPedida}".`);
        const dias = parseInt(c.moverDias, 10);
        if (!fecha && Number.isFinite(dias) && dias !== 0 && !isNaN(base.getTime())) {
            fecha = fechaLocalISO(new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias));
        }
        const hora = normalizarHora(c.hora);
        if (c.hora && !hora) throw ErrorAviso(`No entendí la hora "${c.hora}".`);
        if (fecha || hora) {
            const f = fecha || fechaLocalISO(base);
            const h = hora || horaLocalDe(evento.fechaInicio) || '09:00';
            const nueva = new Date(f + 'T' + h);
            if (isNaN(nueva.getTime())) throw ErrorAviso('Fecha u hora inválida: ' + [c.fecha, c.hora].filter(Boolean).join(' '));
            if (nueva.toISOString() !== evento.fechaInicio) cambios.fechaInicio = nueva.toISOString();
        }
        // Con hora deja de ser "todo el día". Sin hora solo cabe quitársela:
        // para ponérsela hay que decir cuál, y un todoElDia:false que el
        // modelo rellenó de paso convertía el día completo en una cita a las 9.
        if (hora) {
            if (evento.todoElDia) cambios.todoElDia = false;
        } else if (c.todoElDia === true && !evento.todoElDia) {
            cambios.todoElDia = true;
        }

        if (typeof c.alerta === 'boolean' && c.alerta !== !!evento.alerta) cambios.alerta = c.alerta;

        if (c.sinExpediente === true) {
            if (evento.expedienteId != null || evento.expedienteTexto) {
                cambios.expedienteId = null;
                cambios.expedienteTexto = null;
            }
        } else if ((c.expedienteId != null && c.expedienteId !== '') || textoLimpio(c.expedienteRef)) {
            const exp = await expedienteParaEvento(c);
            if (exp.id !== evento.expedienteId || evento.expedienteTexto) {
                cambios.expedienteId = exp.id;
                cambios.expedienteTexto = null;
            }
        }
        return cambios;
    }

    function describirCambiosEvento(evento, cambios, expedientesPorId) {
        const partes = [];
        if (cambios.fechaInicio !== undefined || cambios.todoElDia !== undefined) {
            const fecha = cambios.fechaInicio !== undefined ? cambios.fechaInicio : evento.fechaInicio;
            const todoElDia = cambios.todoElDia !== undefined ? cambios.todoElDia : !!evento.todoElDia;
            partes.push(`${cuandoEsEvento(evento.fechaInicio, evento.todoElDia)} → ${cuandoEsEvento(fecha, todoElDia)}`);
        }
        if (cambios.titulo !== undefined) partes.push(`título → “${cambios.titulo}”`);
        if (cambios.tipo !== undefined) partes.push(`tipo → ${cambios.tipo}`);
        if (cambios.descripcion !== undefined) {
            const d = cambios.descripcion;
            partes.push(d ? `descripción → “${d.length > 90 ? d.slice(0, 90) + '…' : d}”` : 'sin descripción');
        }
        if (cambios.expedienteId !== undefined) {
            const exp = cambios.expedienteId != null ? expedientesPorId.get(cambios.expedienteId) : null;
            partes.push(cambios.expedienteId == null ? 'sin expediente'
                : `expediente → ${exp ? (exp.numero || exp.nombre) : '#' + cambios.expedienteId}`);
        }
        if (cambios.alerta !== undefined) partes.push(cambios.alerta ? 'con alerta' : 'sin alerta');
        return partes.join('; ');
    }

    async function planEditarEventos(p) {
        const [eventos, expedientesPorId] = await Promise.all([obtenerEventos(), mapaDeExpedientes()]);

        // Dos órdenes sobre el mismo evento se juntan en una.
        const porEvento = new Map();
        edicionesDe(p).forEach((ed, i) => {
            const evento = resolverEventoReferido(ed, eventos, expedientesPorId, i);
            const previo = porEvento.get(evento.id);
            porEvento.set(evento.id, { evento, pedidos: { ...(previo ? previo.pedidos : {}), ...(ed.cambios || {}) } });
        });

        const items = [];
        let pidioAlgo = false;
        for (const { evento, pedidos } of porEvento.values()) {
            if (Object.values(pedidos).some(v => v !== undefined && v !== null && v !== '' && v !== false)) pidioAlgo = true;
            const cambios = await calcularCambiosEvento(evento, pedidos);
            if (!Object.keys(cambios).length) continue;
            items.push({ evento, cambios, detalle: `“${evento.titulo}”: ${describirCambiosEvento(evento, cambios, expedientesPorId)}` });
        }
        if (!items.length) {
            throw ErrorAviso(pidioAlgo ? 'Eso ya está así en el calendario: no hay nada que cambiar.'
                                       : '¿Qué quieres cambiar del evento: la fecha, la hora, el título o la descripción?');
        }
        return {
            items,
            resumen: items.length === 1 ? `Cambiar ${items[0].detalle}` : `Cambiar ${items.length} eventos`,
            detalles: items.length === 1 ? [] : items.map(x => x.detalle)
        };
    }

    async function aplicarEdicionesEventos(plan) {
        const hechos = [];
        for (const { evento, cambios } of plan.items) {
            // Lo de antes, campo por campo, para poder deshacer.
            const antes = {};
            for (const k of Object.keys(cambios)) antes[k] = evento[k] !== undefined ? evento[k] : null;
            await actualizarEventoCore(evento.id, cambios);
            hechos.push({ id: evento.id, antes, titulo: evento.titulo });
        }
        if (hechos.length === 1) {
            registrarDeshacer({ tipo: 'evento_editado', id: hechos[0].id, antes: hechos[0].antes, etiqueta: `edición del evento "${hechos[0].titulo}"` });
            toast('Evento actualizado', 'success');
            const ev = (await obtenerEventos()).find(e => e.id === hechos[0].id);
            return ev ? `Listo: “${ev.titulo}” queda el ${cuandoEsEvento(ev.fechaInicio, ev.todoElDia)}.` : 'Evento actualizado.';
        }
        registrarDeshacer({ tipo: 'eventos_editados', eventos: hechos, etiqueta: `edición de ${hechos.length} eventos` });
        toast(`${hechos.length} eventos actualizados`, 'success');
        return `Listo: actualicé ${hechos.length} eventos.`;
    }

    async function planEliminarEventos(p) {
        const [eventos, expedientesPorId] = await Promise.all([obtenerEventos(), mapaDeExpedientes()]);
        const elegidos = new Map();
        eventosAEliminarDe(p).forEach((ref, i) => {
            const ev = resolverEventoReferido(ref, eventos, expedientesPorId, i);
            elegidos.set(ev.id, ev);
        });
        const items = [...elegidos.values()].map(evento => ({
            evento,
            detalle: `“${evento.titulo}” (${cuandoEsEvento(evento.fechaInicio, evento.todoElDia)})`
        }));
        return {
            items,
            resumen: items.length === 1 ? `Eliminar ${items[0].detalle}` : `Eliminar ${items.length} eventos`,
            detalles: items.length === 1 ? [] : items.map(x => x.detalle)
        };
    }

    async function aplicarEliminacionEventos(plan) {
        const copias = [];
        for (const { evento } of plan.items) {
            const eliminado = await eliminarEventoCore(evento.id);
            const copia = { ...eliminado };
            delete copia.id;
            delete copia.googleCalEventId;
            copias.push(copia);
        }
        if (copias.length === 1) {
            registrarDeshacer({ tipo: 'evento_eliminado', evento: copias[0], etiqueta: `eliminación del evento "${copias[0].titulo}"` });
            toast('Evento eliminado', 'success');
            return `Evento "${copias[0].titulo}" eliminado.`;
        }
        registrarDeshacer({ tipo: 'eventos_eliminados', eventos: copias, etiqueta: `eliminación de ${copias.length} eventos` });
        toast(`${copias.length} eventos eliminados`, 'success');
        return `Eliminé ${copias.length} eventos.`;
    }

    // Sin confirmación: para dispararlas desde otra parte de la app (VOZ.ejecutar).
    async function accEditarEvento(p) {
        return aplicarEdicionesEventos(await planEditarEventos(p));
    }

    async function accEliminarEvento(p) {
        return aplicarEliminacionEventos(await planEliminarEventos(p));
    }

    async function prepararCambioDeEventos(r) {
        let plan;
        try {
            plan = r.accion === 'editar_evento'
                ? await planEditarEventos(r.parametros || {})
                : await planEliminarEventos(r.parametros || {});
        } catch (e) {
            if (e._eleccionEvento) { ofrecerEventos(e, r); return; }
            informarFallo(e);
            return;
        }
        pedirConfirmacion({ ...r, _plan: plan }, plan.resumen, plan.detalles);
    }

    // Varios eventos encajan: se enseñan para elegir, y al elegir se vuelve a
    // preparar la misma orden con ese evento ya fijado.
    function ofrecerEventos(e, r) {
        const { candidatos, indice } = e._eleccionEvento;
        const visibles = candidatos.slice(0, 8);
        const div = agregarMensaje('asistente', '🔎 <strong>' + esc(e.message) + '</strong>');
        hablar(e.message);

        // Para que también pueda contestar hablando ("el de las diez").
        const ultimo = conversacion[conversacion.length - 1];
        if (ultimo && ultimo.role === 'assistant') {
            ultimo.content += '\nOpciones: ' + visibles.map(ev =>
                `[eventoId ${ev.id}] "${ev.titulo}" ${cuandoEsEvento(ev.fechaInicio, ev.todoElDia)}`).join('; ');
        }
        if (!div) return;

        visibles.forEach(ev => {
            const fila = document.createElement('div');
            fila.className = 'voz-resultado';
            fila.innerHTML =
                '<div class="voz-resultado-info">' +
                    '<strong>' + esc(ev.titulo) + '</strong>' +
                    '<br><small>' + esc(cuandoEsEvento(ev.fechaInicio, ev.todoElDia)) + '</small>' +
                '</div>';
            const btns = document.createElement('div');
            btns.className = 'voz-resultado-btns';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'voz-chip';
            b.textContent = 'Este';
            b.addEventListener('click', () => {
                const editar = r.accion === 'editar_evento';
                const lista = editar ? edicionesDe(r.parametros || {}) : eventosAEliminarDe(r.parametros || {});
                lista[indice] = { ...lista[indice], eventoId: ev.id };
                agregarMensaje('usuario', esc(ev.titulo));
                prepararCambioDeEventos({ ...r, parametros: { ...(r.parametros || {}), [editar ? 'ediciones' : 'eventos']: lista } });
            });
            btns.appendChild(b);
            fila.appendChild(btns);
            div.appendChild(fila);
        });
        if (candidatos.length > visibles.length) {
            const mas = document.createElement('div');
            mas.className = 'voz-mas';
            mas.textContent = `y ${candidatos.length - visibles.length} más — dime la fecha o la hora para acotar.`;
            div.appendChild(mas);
        }
    }

    async function accConsultarAgenda(p) {
        const hoy = fechaLocalISO(new Date());
        const fi = new Date((p.fechaInicio || hoy) + 'T00:00:00');
        const ff = new Date((p.fechaFin || p.fechaInicio || hoy) + 'T23:59:59');
        const eventos = (await obtenerEventosPorFecha(fi, ff))
            .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

        if (!eventos.length) {
            const msg = 'No tienes eventos en ese periodo.';
            agregarMensaje('asistente', esc(msg));
            hablar(msg);
            conversacion = [];
            return '';
        }

        let html = `📅 <strong>${eventos.length} evento(s):</strong><ul class="voz-lista">`;
        for (const e of eventos.slice(0, 15)) {
            const f = new Date(e.fechaInicio);
            const cuando = f.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }) +
                (e.todoElDia ? '' : ' ' + pad(f.getHours()) + ':' + pad(f.getMinutes()));
            html += `<li><strong>${esc(cuando)}</strong> — ${esc(e.titulo)}${e.tipo ? ' (' + esc(e.tipo) + ')' : ''}</li>`;
        }
        html += '</ul>';
        agregarMensaje('asistente', html);

        const habladas = eventos.slice(0, 4).map(e => {
            const f = new Date(e.fechaInicio);
            return e.titulo + ' el ' + f.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
        }).join('. ');
        hablar(`Tienes ${eventos.length} eventos. ${habladas}`);
        conversacion = [];
        return '';
    }

    // La resolución vive en juzgados.js (misma regla que usa la carga masiva
    // por CSV), para que voz y CSV acepten exactamente los mismos nombres.
    function matchJuzgadoTSJ(nombre) {
        if (typeof resolverJuzgadoTSJ !== 'function') return null;
        return resolverJuzgadoTSJ(nombre);
    }

    async function accCrearExpediente(p) {
        if (!p.valor) throw new Error('Falta el número o nombre del expediente');
        const institucion = ['TSJ', 'PJF', 'OTRO'].includes(p.institucion) ? p.institucion : 'TSJ';

        let juzgado = p.juzgado || '';
        if (institucion === 'TSJ') {
            const match = matchJuzgadoTSJ(juzgado);
            if (!match) throw new Error('No identifiqué el juzgado "' + juzgado + '" en el catálogo del TSJ');
            juzgado = match;
        } else if (institucion === 'PJF') {
            juzgado = juzgado || 'PJF - Por determinar';
        } else {
            juzgado = juzgado || 'Autoridad no especificada';
        }

        if (typeof verificarLimiteExpedientes === 'function') {
            const permitido = await verificarLimiteExpedientes();
            if (!permitido) throw new Error('Alcanzaste el límite de expedientes de tu plan');
        }

        const expediente = { juzgado, institucion, comentario: p.comentario || undefined };
        if (p.carpetaId != null) expediente.carpetaId = parseInt(p.carpetaId);
        if (p.tipoRegistro === 'nombre') expediente.nombre = p.valor;
        else expediente.numero = p.valor;

        const nuevoId = await crearExpedienteCore(expediente);
        registrarDeshacer({ tipo: 'expediente_creado', id: nuevoId, etiqueta: `expediente ${p.valor}` });
        toast('Expediente agregado', 'success');
        return `Expediente ${p.valor} (${institucion}) agregado en ${juzgado}.`;
    }

    async function accEditarExpediente(p) {
        const expRef = await resolverExpedienteDeParametros(p, 'editar_expediente', { obligatorio: true });
        const id = expRef ? expRef.id : parseInt(p.expedienteId);
        if (!id) throw new Error('No identifiqué qué expediente editar');
        const exp = await obtenerExpediente(id);
        if (!exp) throw new Error('Expediente no encontrado');

        const c = p.cambios || {};
        const cambios = {};
        if (c.numero) cambios.numero = c.numero;
        if (c.nombre) cambios.nombre = c.nombre;
        if (c.comentario != null) cambios.comentario = c.comentario;
        if (c.institucion && ['TSJ', 'PJF', 'OTRO'].includes(c.institucion)) cambios.institucion = c.institucion;
        if (c.juzgado) {
            const institucion = cambios.institucion || exp.institucion || 'TSJ';
            if (institucion === 'TSJ') {
                const match = matchJuzgadoTSJ(c.juzgado);
                if (!match) throw new Error('No identifiqué el juzgado "' + c.juzgado + '" en el catálogo del TSJ');
                cambios.juzgado = match;
                if (typeof obtenerCategoriaJuzgado === 'function') cambios.categoria = obtenerCategoriaJuzgado(match);
            } else {
                cambios.juzgado = c.juzgado;
            }
        }
        if (!Object.keys(cambios).length) throw new Error('No hay cambios que aplicar');

        // Valores previos de los campos que cambian, para poder deshacer
        const antes = {};
        for (const k of Object.keys(cambios)) antes[k] = exp[k];

        await actualizarExpedienteCore(id, cambios);
        registrarDeshacer({ tipo: 'expediente_editado', id, antes, etiqueta: `edición del expediente ${exp.numero || exp.nombre}` });
        toast('Expediente actualizado', 'success');
        return `Expediente ${exp.numero || exp.nombre} actualizado.`;
    }

    async function accArchivarExpediente(p) {
        const exp = await resolverExpedienteDeParametros(p, 'archivar_expediente', { obligatorio: true });
        if (!exp) throw new Error('No identifiqué qué expediente archivar');
        const id = exp.id;
        await archivarExpedienteCore(id, true, p.motivo || 'concluido', '');
        registrarDeshacer({ tipo: 'expediente_archivado', id, etiqueta: `archivo del expediente ${exp.numero || exp.nombre}` });
        toast('Expediente archivado', 'success');
        return `Expediente ${exp.numero || exp.nombre} archivado (${p.motivo || 'concluido'}).`;
    }

    async function accMoverACarpeta(p) {
        const expMover = await resolverExpedienteDeParametros(p, 'mover_a_carpeta', { obligatorio: true });
        const id = expMover ? expMover.id : parseInt(p.expedienteId);
        const carpetaId = p.carpetaId != null ? parseInt(p.carpetaId) : null;
        if (!id) throw new Error('No identifiqué qué expediente mover');
        const exp = await obtenerExpediente(id);
        if (!exp) throw new Error('Expediente no encontrado');
        let nombreCarpeta = 'sin carpeta';
        if (carpetaId != null) {
            const carpeta = await obtenerCarpeta(carpetaId).catch(() => null);
            if (!carpeta) throw new Error('No encontré esa carpeta');
            nombreCarpeta = 'la carpeta "' + (carpeta.nombre || carpetaId) + '"';
        }
        const antes = { carpetaId: exp.carpetaId !== undefined ? exp.carpetaId : null };
        await actualizarExpedienteCore(id, { carpetaId });
        registrarDeshacer({ tipo: 'expediente_editado', id, antes, etiqueta: `mover ${exp.numero || exp.nombre} de carpeta` });
        toast('Expediente movido', 'success');
        return `Expediente ${exp.numero || exp.nombre} movido a ${nombreCarpeta}.`;
    }

    async function accCrearNota(p) {
        if (!p.titulo) throw new Error('Falta el título de la nota');
        const expNota = await resolverExpedienteDeParametros(p, 'crear_nota');
        const nuevoId = await crearNotaCore({
            expedienteId: expNota ? expNota.id : null,
            expedienteTexto: expNota ? null : (p.expedienteTexto || null),
            titulo: p.titulo,
            contenido: p.contenido || ''
        });
        registrarDeshacer({ tipo: 'nota_creada', id: nuevoId, etiqueta: `nota "${p.titulo}"` });
        toast('Nota creada', 'success');
        return `Nota "${p.titulo}" creada.`;
    }

    // Un pendiente con fecha queda además agendado: el núcleo mantiene su
    // evento de calendario.
    async function accCrearPendiente(p) {
        if (!p.titulo) throw new Error('Falta qué hay que hacer');

        // La fecha es opcional. Si viene sin hora se asume media mañana, igual
        // criterio que un evento dictado sin hora.
        let fechaLimite = null;
        if (p.fecha) {
            const hora = normalizarHora(p.hora);
            const d = new Date(p.fecha + 'T' + (hora || '09:00'));
            if (isNaN(d.getTime())) throw new Error('Fecha inválida: ' + p.fecha);
            fechaLimite = d.toISOString();
        }
        const expPend = await resolverExpedienteDeParametros(p, 'crear_pendiente');
        const nuevoId = await crearPendienteCore({
            expedienteId: expPend ? expPend.id : null,
            expedienteTexto: expPend ? null : (p.expedienteTexto || null),
            titulo: p.titulo,
            descripcion: p.descripcion || '',
            prioridad: p.prioridad || '',
            fechaLimite
        });
        registrarDeshacer({ tipo: 'pendiente_creado', id: nuevoId, etiqueta: `pendiente "${p.titulo}"` });
        toast('Pendiente creado', 'success');
        const conPrioridad = p.prioridad ? ` con prioridad ${p.prioridad}` : '';
        return fechaLimite
            ? `Pendiente "${p.titulo}" creado${conPrioridad} y agendado.`
            : `Pendiente "${p.titulo}" creado${conPrioridad}.`;
    }

    async function accCompletarPendiente(p) {
        const pendiente = await _resolverPendiente(p);
        if (pendiente.completado) return `El pendiente "${pendiente.titulo}" ya estaba terminado.`;
        await completarPendienteCore(pendiente.id, true);
        registrarDeshacer({ tipo: 'pendiente_completado', id: pendiente.id, etiqueta: `pendiente "${pendiente.titulo}"` });
        toast('Pendiente terminado', 'success');
        return `Marqué "${pendiente.titulo}" como terminado.`;
    }

    async function accConsultarPendientes(p) {
        const todos = await obtenerPendientes().catch(() => []);
        let abiertos = todos.filter(x => !x.completado);
        const expFiltro = await resolverExpedienteDeParametros(p, 'consultar_pendientes');
        if (expFiltro) abiertos = abiertos.filter(x => x.expedienteId === expFiltro.id);
        if (abiertos.length === 0) return 'No tienes pendientes por hacer.';

        // Primero lo que tiene fecha, y de eso lo más cercano.
        abiertos.sort((a, b) => {
            const fa = a.fechaLimite ? new Date(a.fechaLimite).getTime() : Infinity;
            const fb = b.fechaLimite ? new Date(b.fechaLimite).getTime() : Infinity;
            return fa - fb;
        });
        const lista = abiertos.slice(0, 8).map(x => {
            const dias = typeof diasParaPendiente === 'function' ? diasParaPendiente(x) : null;
            if (dias === null) return x.titulo;
            if (dias < 0) return `${x.titulo} (vencido)`;
            if (dias === 0) return `${x.titulo} (hoy)`;
            if (dias === 1) return `${x.titulo} (mañana)`;
            return `${x.titulo} (en ${dias} días)`;
        }).join('; ');
        const resto = abiertos.length > 8 ? ` y ${abiertos.length - 8} más` : '';
        return `Tienes ${abiertos.length} pendiente${abiertos.length !== 1 ? 's' : ''}: ${lista}${resto}.`;
    }

    // Identifica el pendiente del que habla el usuario: por id, o por título
    // entre los que están por hacer.
    async function _resolverPendiente(p) {
        const todos = await obtenerPendientes().catch(() => []);
        if (p && p.pendienteId != null) {
            const porId = todos.find(x => x.id === parseInt(p.pendienteId));
            if (porId) return porId;
        }
        const texto = normalizar(p && p.titulo ? p.titulo : '');
        if (!texto) throw new Error('¿Cuál pendiente marco como terminado?');

        const abiertos = todos.filter(x => !x.completado);
        const coincidencias = abiertos.filter(x => normalizar(x.titulo || '').includes(texto));
        if (coincidencias.length === 1) return coincidencias[0];
        if (coincidencias.length === 0) throw new Error(`No encontré un pendiente que diga "${p.titulo}"`);
        throw new Error(`Tengo ${coincidencias.length} pendientes que coinciden: ${coincidencias.slice(0, 4).map(x => x.titulo).join('; ')}. ¿Cuál?`);
    }

    // ==================== REFERENCIAS A EXPEDIENTES ====================
    // El modelo acierta el id cuando el expediente está en el catálogo y el
    // usuario fue preciso. Cuando no —dijo un fragmento, un apellido, o el
    // expediente quedó fuera del catálogo—, manda expedienteRef con lo que oyó
    // y aquí se resuelve contra la base completa, archivados incluidos.

    // Acción a la espera de que el usuario elija entre varios expedientes.
    let eleccionPendiente = null;

    function limpiarEleccionPendiente() { eleccionPendiente = null; }

    // Error que no es un fallo: significa "hacen falta datos del usuario".
    function ErrorEleccion(mensaje) {
        const e = new Error(mensaje);
        e._esEleccion = true;
        return e;
    }

    // Desenlace esperado, no un fallo del programa: "no encontré ese
    // expediente" es información para el usuario y no debe ensuciar la consola
    // donde se buscan errores de verdad.
    function ErrorAviso(mensaje) {
        const e = new Error(mensaje);
        e._esAviso = true;
        return e;
    }

    /**
     * Devuelve el expediente al que se refiere el usuario.
     * - Si el modelo dio un id válido, ese manda.
     * - Si dio una referencia, se resuelve contra toda la base.
     * - Si hay varias posibilidades reales, se muestran para elegir y se deja
     *   la acción en espera, en vez de escoger una al azar.
     * opciones.obligatorio: si no, devuelve null cuando no hay referencia.
     */
    async function resolverExpedienteDeParametros(p, accion, opciones = {}) {
        if (p && p.expedienteId != null && p.expedienteId !== '') {
            const exp = await obtenerExpediente(parseInt(p.expedienteId)).catch(() => null);
            if (exp) return exp;
            // Un id que ya no existe no debe hacer fallar todo: si además vino
            // una referencia, se intenta con ella.
        }

        const ref = (p && (p.expedienteRef || p.expedienteTexto || p.consulta)) || '';
        if (!ref.trim()) {
            if (opciones.obligatorio) throw new Error('¿De qué expediente?');
            return null;
        }

        if (typeof resolverExpedientePorReferencia !== 'function') {
            throw new Error('No pude buscar el expediente en este momento');
        }
        const r = await resolverExpedientePorReferencia(ref);

        if (r.estado === 'unico') return r.expediente;

        if (r.estado === 'ninguno') {
            throw ErrorAviso(`No encontré ningún expediente que coincida con "${ref}". Revisa el dato o dime otro.`);
        }

        // Varias posibilidades: se ofrecen y la acción queda esperando.
        mostrarOpcionesExpediente(r.candidatos, ref, accion, p);
        throw ErrorEleccion(`Encontré ${r.candidatos.length} expedientes que coinciden con "${ref}". ¿Cuál de estos?`);
    }

    // Pinta los candidatos como botones y deja anotado qué hacer al elegir.
    function mostrarOpcionesExpediente(candidatos, ref, accion, parametros) {
        eleccionPendiente = { accion, parametros };

        const div = agregarMensaje('asistente',
            `🔎 <strong>${esc(String(candidatos.length))} expedientes coinciden con “${esc(ref)}”.</strong> Elige uno:`);
        if (!div) return;

        candidatos.slice(0, 6).forEach(c => {
            const exp = c.expediente;
            const fila = document.createElement('div');
            fila.className = 'voz-resultado';
            fila.innerHTML =
                '<div class="voz-resultado-info">' +
                    '<strong>' + esc(exp.numero || exp.nombre || 'Expediente') + '</strong>' +
                    (c.archivado ? ' <span class="voz-tag">archivado</span>' : '') +
                    '<br><small>' + esc([exp.juzgado, exp.institucion !== 'TSJ' ? exp.institucion : ''].filter(Boolean).join(' · ')) + '</small>' +
                    (exp.comentario ? '<br><small>💬 ' + esc(exp.comentario) + '</small>' : '') +
                    '<br><small class="voz-motivo">' + esc(c.motivo) + '</small>' +
                '</div>';

            const btns = document.createElement('div');
            btns.className = 'voz-resultado-btns';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'voz-chip';
            b.textContent = 'Usar este';
            b.onclick = () => continuarConExpediente(exp);
            btns.appendChild(b);
            fila.appendChild(btns);
            div.appendChild(fila);
        });

        if (candidatos.length > 6) {
            const mas = document.createElement('div');
            mas.className = 'voz-mas';
            mas.textContent = `y ${candidatos.length - 6} más — afina el dato para acotar.`;
            div.appendChild(mas);
        }
    }

    // El usuario eligió: se repite la acción original con el id ya resuelto.
    async function continuarConExpediente(exp) {
        const pend = eleccionPendiente;
        limpiarEleccionPendiente();
        if (!pend) return;

        agregarMensaje('usuario', esc(exp.numero || exp.nombre || 'ese expediente'));
        const parametros = { ...pend.parametros, expedienteId: exp.id };
        delete parametros.expedienteRef;

        try {
            await ejecutarAccionResuelta(pend.accion, parametros);
        } catch (e) {
            if (!e._esEleccion) {
                agregarMensaje('asistente', esc('No se pudo completar: ' + e.message));
                hablar('No se pudo completar: ' + e.message);
            }
        }
    }

    async function accAbrirExpediente(p) {
        const exp = await resolverExpedienteDeParametros(p, 'abrir_expediente', { obligatorio: true });
        if (!exp) throw new Error('No identifiqué qué expediente abrir');
        const id = exp.id;
        if (typeof mostrarExpediente === 'function') await mostrarExpediente(id);
        else if (typeof navegarA === 'function') navegarA('expedientes');
        return `Abrí el expediente ${exp.numero || exp.nombre}.`;
    }

    async function accBuscarLocal(p) {
        const consulta = (p.consulta || p.expedienteRef || '').trim();
        if (!consulta) throw new Error('¿Qué expediente busco?');

        // Mismo resolvedor que usa todo lo demás: ordena por qué tan bien
        // encaja y entiende el dictado ("123 diagonal 2025") y los fragmentos.
        const candidatos = await buscarExpedientesPorReferencia(consulta);
        const resultados = candidatos.map(c => ({ ...c.expediente, _arch: c.archivado, _motivo: c.motivo }));

        if (!resultados.length) {
            const msg = 'No encontré expedientes que coincidan con "' + p.consulta + '".';
            agregarMensaje('asistente', esc(msg));
            hablar(msg);
            conversacion = [];
            return '';
        }

        const chat = document.getElementById('voz-chat');
        const div = document.createElement('div');
        div.className = 'voz-msg voz-msg-asistente';
        div.innerHTML = `📁 <strong>${resultados.length} expediente(s) encontrado(s):</strong>`;
        resultados.slice(0, 8).forEach(exp => {
            const fila = document.createElement('div');
            fila.className = 'voz-resultado';
            fila.innerHTML =
                '<div class="voz-resultado-info">' +
                    '<strong>' + esc(exp.numero || exp.nombre) + '</strong>' +
                    (exp._arch ? ' <span class="voz-tag">archivado</span>' : '') +
                    '<br><small>' + esc(exp.institucion || 'TSJ') + ' · ' + esc(exp.juzgado || '') + '</small>' +
                    (exp.comentario ? '<br><small>💬 ' + esc(exp.comentario) + '</small>' : '') +
                '</div>';
            const btns = document.createElement('div');
            btns.className = 'voz-resultado-btns';

            const puedeTSJ = (exp.institucion || 'TSJ') === 'TSJ' && exp.juzgado && typeof construirUrlBusqueda === 'function';
            const puedePJF = exp.institucion === 'PJF' && exp.pjfOrgId && exp.pjfTipoAsunto && typeof construirURLPJF === 'function';
            if (puedeTSJ || puedePJF) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'voz-chip';
                b.textContent = '🌐 Estrados';
                b.addEventListener('click', () => {
                    if (puedeTSJ) {
                        const url = construirUrlBusqueda(exp.juzgado, exp.numero ? 'numero' : 'nombre', exp.numero || exp.nombre);
                        if (typeof abrirBusquedaPopup === 'function') abrirBusquedaPopup(url, exp.numero || exp.nombre);
                        else if (url) window.open(url, '_blank');
                    } else {
                        const url = construirURLPJF(exp.pjfOrgId, exp.pjfTipoAsunto, exp.numero || '', 0);
                        window.open(url, 'pjf_expediente', 'width=1024,height=700,scrollbars=yes,resizable=yes');
                    }
                });
                btns.appendChild(b);
            }
            const bVer = document.createElement('button');
            bVer.type = 'button';
            bVer.className = 'voz-chip';
            bVer.textContent = '📂 Abrir';
            bVer.addEventListener('click', () => {
                if (typeof mostrarExpediente === 'function') mostrarExpediente(exp.id);
                else if (typeof navegarA === 'function') navegarA('expedientes');
            });
            btns.appendChild(bVer);
            fila.appendChild(btns);
            div.appendChild(fila);
        });
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
        hablar('Encontré ' + resultados.length + ' expedientes.');
        conversacion = [];
        return '';
    }

    // ==================== BÚSQUEDAS EN ESTRADOS ====================
    // Cada búsqueda se resuelve primero a "consultas" —una por ventana: un
    // órgano, un tipo de asunto y un número— y solo después se abre algo.
    // Separarlo es lo que permite pedir varias a la vez (la queja y el amparo
    // directo del mismo número, todos los tipos de asunto de un órgano, varios
    // órganos o juzgados, el TSJ y el PJF en la misma orden) y enseñar, antes
    // de abrir nada, la lista exacta de lo que se va a abrir.

    const ACCIONES_BUSQUEDA = new Set(['buscar_tsj', 'buscar_pjf', 'buscar_varios']);

    // "Todos los tipos de asunto": no hay que elegir uno.
    const RE_TODOS_LOS_TIPOS = /^(todos?|todas?|cualquiera|cualquier tipo|todos los tipos( de asunto)?|todos los asuntos|todo)$/;

    // Tipos que no son asuntos que alguien consulte por número.
    const RE_TIPO_NO_BUSCABLE = /comunicaciones oficiales|varios administrativo/i;

    // Una lista de lo dictado: la lista si viene, si no el valor suelto.
    function textosDe(lista, suelto) {
        const base = Array.isArray(lista) && lista.length ? lista : (suelto ? [suelto] : []);
        return base.map(x => String(x == null ? '' : x).trim()).filter(Boolean);
    }

    function pideTodosLosTipos(tipos) {
        return tipos.some(t => RE_TODOS_LOS_TIPOS.test(normalizar(t)));
    }

    function tiposBuscablesDeOrgano(org) {
        const todos = typeof tiposAsuntoDeOrgano === 'function' ? tiposAsuntoDeOrgano(org) : [];
        return todos.filter(t => !RE_TIPO_NO_BUSCABLE.test(t.nombre));
    }

    function consultaPJF(org, tipo, numero) {
        return {
            institucion: 'PJF',
            numero,
            organo: org.nombre,
            tipo: tipo.nombre,
            etiqueta: `${tipo.nombre} ${numero} — ${org.nombre}`,
            url: construirURLPJF(org.id, tipo.id, numero, 0),
            // Una ventana por órgano Y tipo: con el mismo nombre, la queja
            // cargaría encima del amparo y solo quedaría una.
            ventana: `pjf_${org.id}_${tipo.id}`
        };
    }

    function consultaTSJ(juzgado, tipoBusqueda, valor) {
        const url = construirUrlBusqueda(juzgado, tipoBusqueda, valor);
        if (!url) return null;
        return { institucion: 'TSJ', numero: valor, organo: juzgado, tipo: '', etiqueta: `${valor} — ${juzgado}`, url, ventana: null };
    }

    // El órgano y el tipo guardados en un expediente del catálogo.
    function organoDeExpediente(exp) {
        const org = typeof organismoPJFPorId === 'function' ? organismoPJFPorId(exp.pjfOrgId) : null;
        return org || { id: exp.pjfOrgId, nombre: exp.juzgado || `órgano ${exp.pjfOrgId}`, tipoOrganismoId: null };
    }

    function tipoDeExpediente(org, exp) {
        const tipos = typeof tiposAsuntoDeOrgano === 'function' ? tiposAsuntoDeOrgano(org) : [];
        return tipos.find(t => String(t.id) === String(exp.pjfTipoAsunto)) ||
            { id: exp.pjfTipoAsunto, nombre: 'Tipo ' + exp.pjfTipoAsunto };
    }

    /**
     * Consultas del PJF. Admite uno o varios órganos (organismo / organismos),
     * uno o varios tipos de asunto (tipoAsunto / tiposAsunto, o "todos") y el
     * número dictado, o un expediente del catálogo con sus datos del PJF.
     */
    async function planBuscarPJF(p) {
        const refsOrganos = textosDe(p.organismos, p.organismo);
        const tiposPedidos = textosDe(p.tiposAsunto, p.tipoAsunto);

        // Aquí la referencia también sirve: "busca en el PJF lo de Ramírez".
        // Pero estas consultas se hacen sobre todo con asuntos que NO están
        // dados de alta —para eso se dicta el órgano—, así que no encontrarlo
        // en el catálogo no puede abortar la acción: antes cortaba aquí y el
        // órgano dictado no llegaba a usarse nunca.
        let exp = null;
        try {
            exp = await resolverExpedienteDeParametros(p, 'buscar_pjf');
        } catch (e) {
            // Elegir entre varios candidatos sí es útil y se respeta. Lo que no
            // vale es rendirse teniendo el órgano o el número que dictó.
            if (e._esEleccion || !(refsOrganos.length || p.numero)) throw e;
        }
        const numero = String((exp && exp.numero) || p.numero || '').trim();
        const plan = { consultas: [], avisos: [], numero };
        if (typeof construirURLPJF !== 'function') throw new Error('El buscador del PJF no está disponible');
        if (typeof asegurarCatalogosPJF === 'function') await asegurarCatalogosPJF();

        // Órganos: los dictados. Si no dictó ninguno, el del expediente guardado.
        // Cada referencia puede abarcar varios: "los colegiados del 27" son tres.
        const organos = [];
        const vistos = new Set();
        const agregar = (o) => {
            if (o && !vistos.has(String(o.id))) { vistos.add(String(o.id)); organos.push(o); }
        };
        const sinResolver = [];
        if (refsOrganos.length) {
            for (const ref of refsOrganos) {
                const encontrados = (typeof buscarOrganismosPJF === 'function' ? buscarOrganismosPJF(ref) : null) || [];
                if (!encontrados.length) sinResolver.push(ref);
                encontrados.forEach(agregar);
            }
        } else if (exp && exp.pjfOrgId) {
            agregar(organoDeExpediente(exp));
        }
        if (sinResolver.length) plan.avisos.push(`no identifiqué "${sinResolver.join('", "')}"`);

        // Sin órgano no hay consulta que armar: quien ejecuta decide qué hacer.
        if (!organos.length) {
            plan.sinOrgano = true;
            return plan;
        }
        if (!numero) throw new Error('Falta el número de expediente para consultar en el PJF');

        // Abrir treinta ventanas no ayuda a nadie y el navegador las bloquea
        // igual: mejor decir cuántas salieron y que acote.
        if (organos.length > MAX_ORGANOS_PJF) {
            throw ErrorAviso(`Eso abarca ${organos.length} órganos (${organos.slice(0, 3).map(o => o.nombre).join('; ')}...). ` +
                `Son demasiadas ventanas: acota el circuito o dime cuáles.`);
        }

        // El tipo de asunto se resuelve por órgano: "amparo directo" no existe
        // en todos los tipos de órgano.
        const todos = pideTodosLosTipos(tiposPedidos);
        const sinTipo = [];
        for (const org of organos) {
            let tipos = [];
            if (todos) {
                tipos = tiposBuscablesDeOrgano(org);
            } else if (tiposPedidos.length) {
                for (const texto of tiposPedidos) {
                    const ta = buscarTipoAsuntoPJF(org, texto);
                    if (ta && !tipos.some(t => t.id === ta.id)) tipos.push(ta);
                }
            } else if (exp && exp.pjfTipoAsunto && String(exp.pjfOrgId) === String(org.id)) {
                tipos = [tipoDeExpediente(org, exp)];
            } else {
                // No dijo el tipo de asunto. Si el órgano solo tiene uno, es
                // ese; si tiene varios, se ofrecen todos para que elija, sin
                // abrir nada por su cuenta.
                tipos = tiposBuscablesDeOrgano(org);
                if (tipos.length > 1) plan.faltaTipo = true;
            }
            if (!tipos.length) { sinTipo.push(org); continue; }
            tipos.forEach(ta => plan.consultas.push(consultaPJF(org, ta, numero)));
        }

        if (!plan.consultas.length) {
            const muestra = sinTipo[0] || organos[0];
            const validos = tiposBuscablesDeOrgano(muestra).map(t => t.nombre).slice(0, 14).join(', ');
            throw ErrorAviso(`Identifiqué ${organos.length === 1 ? `el órgano "${organos[0].nombre}"` : `${organos.length} órganos`} ` +
                `pero no el tipo de asunto${tiposPedidos.length ? ` "${tiposPedidos.join('", "')}"` : ''}. ` +
                (validos ? `Los válidos son: ${validos}. ` : '') + 'Repite indicando el tipo de asunto.');
        }
        if (sinTipo.length) plan.avisos.push(`${sinTipo.length} sin ese tipo de asunto`);
        if (plan.consultas.length > MAX_CONSULTAS) {
            throw ErrorAviso(`Eso son ${plan.consultas.length} consultas. Son demasiadas: acota los órganos o los tipos de asunto.`);
        }
        return plan;
    }

    /**
     * Consultas del TSJ de Quintana Roo: en un juzgado, en varios (juzgados) o
     * en todos los de un ámbito. Aquí no hay tipos de asunto: el buscador de
     * estrados encuentra el número en cualquiera.
     */
    async function planBuscarTSJ(p) {
        const refsJuzgados = textosDe(p.juzgados, p.juzgado);
        let valor = String(p.valor || '').trim();
        let tipo = p.tipoBusqueda === 'nombre' ? 'nombre' : 'numero';

        // Si mencionó un expediente, se usa su juzgado y su número en vez de
        // abrir una ventana por cada juzgado del estado.
        if (!refsJuzgados.length && (p.expedienteId != null || p.expedienteRef)) {
            let expTSJ = null;
            try {
                expTSJ = await resolverExpedienteDeParametros(p, 'buscar_tsj');
            } catch (e) {
                // Igual que en el PJF: un estrado se consulta muchas veces de
                // un asunto que todavía no está registrado.
                if (e._esEleccion || !valor) throw e;
            }
            if (expTSJ) {
                if (expTSJ.juzgado) refsJuzgados.push(expTSJ.juzgado);
                if (!valor && expTSJ.numero) { valor = expTSJ.numero; tipo = 'numero'; }
            }
        }
        if (!valor) throw new Error('Falta el número o nombre a buscar');
        if (typeof construirUrlBusqueda !== 'function') throw new Error('El buscador TSJ no está disponible');

        const plan = { consultas: [], avisos: [], numero: valor };
        let juzgados = [];
        if (refsJuzgados.length) {
            const sinResolver = [];
            for (const ref of refsJuzgados) {
                const match = matchJuzgadoTSJ(ref);
                if (!match) sinResolver.push(ref);
                else if (!juzgados.includes(match)) juzgados.push(match);
            }
            if (!juzgados.length) throw new Error('No identifiqué el juzgado "' + sinResolver.join('", "') + '"');
            if (sinResolver.length) plan.avisos.push(`no identifiqué "${sinResolver.join('", "')}"`);
        } else {
            // En todos los juzgados de un ámbito (se confirma antes de abrir).
            const ambito = ['todos', 'primera', 'segunda'].includes(p.ambito) ? p.ambito : 'todos';
            if ((ambito === 'todos' || ambito === 'primera') && typeof JUZGADOS !== 'undefined') {
                juzgados = juzgados.concat(Object.keys(JUZGADOS));
            }
            if ((ambito === 'todos' || ambito === 'segunda') && typeof SALAS_SEGUNDA_INSTANCIA !== 'undefined') {
                juzgados = juzgados.concat(Object.keys(SALAS_SEGUNDA_INSTANCIA));
            }
            if (!juzgados.length) throw new Error('No hay juzgados disponibles para ese ámbito');
        }
        for (const juzgado of juzgados) {
            const c = consultaTSJ(juzgado, tipo, valor);
            if (c) plan.consultas.push(c);
        }
        return plan;
    }

    /**
     * Varios asuntos en una orden: números distintos, o unos del TSJ y otros
     * del PJF. Cada búsqueda lleva los parámetros de su acción; lo que no se
     * pueda preparar se avisa sin tumbar al resto.
     */
    async function planBuscarVarios(p) {
        const busquedas = Array.isArray(p.busquedas) ? p.busquedas : [];
        const plan = { consultas: [], avisos: [], numero: '' };
        const vistas = new Set();
        let numeros = [];

        for (const b of busquedas) {
            const accion = b && b.accion;
            const params = (b && b.parametros) || {};
            if (accion !== 'buscar_pjf' && accion !== 'buscar_tsj') continue;
            const cual = params.numero || params.valor || 'una búsqueda';

            let parcial;
            try {
                parcial = accion === 'buscar_pjf' ? await planBuscarPJF(params) : await planBuscarTSJ(params);
            } catch (e) {
                // Si hay que elegir expediente, las opciones ya están en
                // pantalla y se pueden usar aparte; el resto sigue.
                plan.avisos.push(e._esEleccion ? `${cual}: elige el expediente arriba` : `${cual}: ${e.message}`);
                continue;
            }
            if (parcial.sinOrgano) plan.avisos.push(`${cual}: no identifiqué el órgano`);
            parcial.avisos.forEach(a => plan.avisos.push(`${cual}: ${a}`));
            if (parcial.faltaTipo) plan.faltaTipo = true;
            for (const c of parcial.consultas) {
                if (vistas.has(c.url)) continue;
                vistas.add(c.url);
                plan.consultas.push(c);
            }
            if (parcial.consultas.length && !numeros.includes(parcial.numero)) numeros.push(parcial.numero);
        }

        if (!plan.consultas.length) {
            throw ErrorAviso('No pude preparar ninguna de las búsquedas' + (plan.avisos.length ? ': ' + plan.avisos.join('; ') : '') + '.');
        }
        if (plan.consultas.length > MAX_CONSULTAS) {
            throw ErrorAviso(`Eso son ${plan.consultas.length} consultas. Son demasiadas: divídelo en varias órdenes.`);
        }
        plan.numero = numeros.join(', ');
        return plan;
    }

    async function planificarBusqueda(accion, p) {
        if (accion === 'buscar_pjf') return planBuscarPJF(p);
        if (accion === 'buscar_tsj') return planBuscarTSJ(p);
        return planBuscarVarios(p);
    }

    function abrirConsulta(c) {
        if (c.institucion === 'TSJ' && typeof abrirBusquedaPopup === 'function') {
            abrirBusquedaPopup(c.url, c.etiqueta);
            return;
        }
        window.open(c.url, c.ventana || '_blank', 'width=1024,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no');
    }

    function abrirConsultas(consultas) {
        consultas.forEach((c, i) => {
            // La primera en el acto: si viene de un clic, el navegador la deja
            // pasar. Las demás espaciadas, porque bloquea las ráfagas.
            if (i === 0) abrirConsulta(c);
            else setTimeout(() => abrirConsulta(c), i * 600);
        });
    }

    // La lista de consultas en el chat, con un botón por cada una: sirve para
    // reabrir la que el navegador bloqueó y para elegir cuando no se abren solas.
    function mostrarListaConsultas(consultas, abiertas) {
        const div = agregarMensaje('asistente', abiertas
            ? `🌐 <strong>${consultas.length} consultas.</strong> Si alguna no se abrió, ábrela desde aquí:`
            : `🌐 <strong>${consultas.length} consultas listas.</strong> Ábrelas una por una o todas de una vez:`);
        if (!div) return;
        if (!abiertas) {
            const todas = document.createElement('button');
            todas.type = 'button';
            todas.className = 'voz-chip voz-chip-todas';
            todas.textContent = `🌐 Abrir las ${consultas.length}`;
            todas.addEventListener('click', () => abrirConsultas(consultas));
            div.appendChild(todas);
        }
        consultas.forEach(c => {
            const fila = document.createElement('div');
            fila.className = 'voz-resultado';
            fila.innerHTML =
                '<div class="voz-resultado-info">' +
                    '<strong>' + esc(c.tipo ? `${c.tipo} ${c.numero}` : c.numero) + '</strong>' +
                    ' <span class="voz-tag voz-tag-inst">' + esc(c.institucion) + '</span>' +
                    '<br><small>' + esc(c.organo) + '</small>' +
                '</div>';
            const btns = document.createElement('div');
            btns.className = 'voz-resultado-btns';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'voz-chip';
            b.textContent = '🌐 Abrir';
            b.addEventListener('click', () => abrirConsulta(c));
            btns.appendChild(b);
            fila.appendChild(btns);
            div.appendChild(fila);
        });
        const chat = document.getElementById('voz-chat');
        if (chat) chat.scrollTop = chat.scrollHeight;
    }

    // Sin órgano resuelto: a la página del PJF con el número precargado.
    function irABusquedaPJF(numero, cola) {
        if (typeof navegarA === 'function') navegarA('pjf');
        if (numero) {
            setTimeout(() => {
                const input = document.getElementById('pjf-num-expediente');
                if (input) input.value = numero;
            }, 400);
        }
        return numero
            ? `Te llevé a la búsqueda PJF con el expediente ${numero} precargado. Selecciona circuito y organismo para consultar.${cola}`
            : `Te llevé a la búsqueda del PJF. Selecciona circuito, organismo y número de expediente.${cola}`;
    }

    // Abre lo planeado. Hasta MAX_VENTANAS_AUTO se abren solas; con más, o si
    // no dijo el tipo de asunto, se deja la lista para que elija.
    function ejecutarPlanBusqueda(plan) {
        const consultas = plan.consultas;
        const cola = plan.avisos.length ? ` (${plan.avisos.join('; ')})` : '';

        if (!consultas.length) {
            if (plan.sinOrgano) return irABusquedaPJF(plan.numero, cola);
            throw ErrorAviso('No hay nada que abrir' + cola + '.');
        }

        const soloLista = !!plan.faltaTipo || consultas.length > MAX_VENTANAS_AUTO;
        if (!soloLista) abrirConsultas(consultas);
        if (consultas.length > 1) mostrarListaConsultas(consultas, !soloLista);

        if (soloLista) {
            return plan.faltaTipo
                ? `No me dijiste el tipo de asunto del ${plan.numero}: te dejé los ${consultas.length} posibles para que abras el que quieras, o todos.${cola}`
                : `Son ${consultas.length} consultas: te las dejé en una lista para abrirlas una por una o todas de una vez.${cola}`;
        }

        const c = consultas[0];
        if (consultas.length === 1) {
            return c.institucion === 'PJF'
                ? `Abrí la consulta del ${c.numero} (${c.tipo}) en ${c.organo}.${cola}`
                : `Abrí la búsqueda de "${c.numero}" en ${c.organo}.${cola}`;
        }

        const organos = [...new Set(consultas.map(x => x.organo))];
        const tipos = [...new Set(consultas.map(x => x.tipo))];
        const numeros = [...new Set(consultas.map(x => x.numero))];
        let que;
        if (numeros.length === 1 && tipos.length === 1 && consultas.every(x => x.institucion === 'TSJ')) {
            que = `la búsqueda de "${c.numero}" en ${organos.length} juzgados del TSJ`;
        } else if (numeros.length === 1 && tipos.length === 1) {
            que = `el ${c.numero} en ${organos.length} órganos: ${organos.join('; ')}`;
        } else if (numeros.length === 1 && organos.length === 1) {
            que = `el ${c.numero} como ${tipos.join(', ')} en ${c.organo}`;
        } else {
            que = `${consultas.length} consultas`;
        }
        return `Abriendo ${que}.${cola} Permite las ventanas emergentes.`;
    }

    async function accBuscarPJF(p) {
        return ejecutarPlanBusqueda(await planBuscarPJF(p));
    }

    async function accBuscarTSJ(p) {
        return ejecutarPlanBusqueda(await planBuscarTSJ(p));
    }

    async function accBuscarVarios(p) {
        return ejecutarPlanBusqueda(await planBuscarVarios(p));
    }

    // Se prepara antes de confirmar: si va a abrir varias ventanas, se enseña
    // la lista exacta; una sola, o una lista para elegir, no necesita permiso.
    async function prepararBusqueda(r) {
        let plan;
        try {
            plan = await planificarBusqueda(r.accion, r.parametros || {});
        } catch (e) {
            informarFallo(e);
            return;
        }
        const abriraVarias = plan.consultas.length > 1 && !plan.faltaTipo && plan.consultas.length <= MAX_VENTANAS_AUTO;
        if (!abriraVarias) {
            await ejecutarAccion({ ...r, _plan: plan });
            return;
        }
        pedirConfirmacion({ ...r, _plan: plan }, `Abrir ${plan.consultas.length} consultas`,
            plan.consultas.map(c => c.etiqueta).concat(plan.avisos.map(a => '⚠️ ' + a)));
    }

    function accNavegar(p) {
        const paginas = ['inicio', 'expedientes', 'calendario', 'pendientes', 'notas', 'tribunales', 'busqueda', 'pjf', 'impi', 'config'];
        const pagina = paginas.includes(p.pagina) ? p.pagina : null;
        if (!pagina) throw new Error('No identifiqué a qué sección navegar');
        if (typeof navegarA === 'function') navegarA(pagina);
        return 'Listo, estás en ' + pagina + '.';
    }

    // ==================== LLM ====================

    async function obtenerApiKey() {
        try {
            return (await obtenerConfig('ia_api_key')) || '';
        } catch (e) {
            return '';
        }
    }

    const TOPE_AGENDA = 150;
    const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

    /**
     * La agenda que ve el modelo, en fecha y hora LOCALES. Antes iba el
     * fechaInicio en UTC ("2026-10-01T15:00:00.000Z" para una audiencia a las
     * 10:00 en Cancún): el modelo tenía que convertirlo solo, se equivocaba de
     * hora y una audiencia de las 20:00 le aparecía al día siguiente.
     * Van primero los próximos: son los que se cambian. Del pasado, los recientes.
     */
    function agendaParaElModelo(eventos, expedientesPorId, ahoraMs) {
        const hoy = new Date(ahoraMs);
        hoy.setHours(0, 0, 0, 0);
        const desde = hoy.getTime() - 30 * 864e5;
        const hasta = hoy.getTime() + 366 * 864e5;
        const t = (e) => new Date(e.fechaInicio).getTime();

        const enRango = eventos.filter(e => t(e) >= desde && t(e) <= hasta).sort((a, b) => t(a) - t(b));
        const futuros = enRango.filter(e => t(e) >= hoy.getTime());
        const pasados = enRango.filter(e => t(e) < hoy.getTime()).reverse();
        const cupoPasados = Math.min(pasados.length, 30);
        const elegidos = pasados.slice(0, cupoPasados)
            .concat(futuros.slice(0, TOPE_AGENDA - cupoPasados))
            .sort((a, b) => t(a) - t(b));

        return {
            total: eventos.length,
            lista: elegidos.map(e => {
                const d = new Date(e.fechaInicio);
                const item = {
                    id: e.id,
                    titulo: e.titulo,
                    tipo: e.tipo,
                    fecha: fechaLocalISO(d),
                    dia: DIAS_SEMANA[d.getDay()],
                    hora: e.todoElDia ? null : horaLocalDe(e.fechaInicio)
                };
                const expediente = expedienteDeEvento(e, expedientesPorId);
                if (expediente) item.expediente = expediente;
                if (e.descripcion) item.descripcion = e.descripcion.length > 80 ? e.descripcion.slice(0, 80) + '…' : e.descripcion;
                return item;
            })
        };
    }

    async function construirPromptSistema() {
        const ahora = new Date();
        const fechaLegible = ahora.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const horaLegible = pad(ahora.getHours()) + ':' + pad(ahora.getMinutes());

        // Catálogo local de expedientes (compacto)
        // El catálogo va recortado por tamaño de prompt, así que NO es la
        // fuente de verdad: cuando el modelo no encuentra el expediente aquí,
        // manda expedienteRef y la app lo resuelve contra toda la base.
        const TOPE_CATALOGO = 250;
        let catalogo = [];
        let totalExpedientes = 0;
        try {
            const activos = await obtenerExpedientes();
            const archivados = typeof obtenerExpedientesArchivados === 'function'
                ? await obtenerExpedientesArchivados().catch(() => []) : [];
            totalExpedientes = activos.length + archivados.length;
            const todos = activos.concat(archivados.map(e => ({ ...e, _arch: true })));
            catalogo = todos.slice(0, TOPE_CATALOGO).map(e => ({
                id: e.id,
                numero: e.numero || null,
                nombre: e.nombre || null,
                institucion: e.institucion || 'TSJ',
                juzgado: e.juzgado || '',
                carpetaId: e.carpetaId != null ? e.carpetaId : null,
                tienePJF: !!(e.pjfOrgId && e.pjfTipoAsunto),
                // Las partes son como el abogado suele referirse a un caso.
                actor: e.actor || undefined,
                demandado: e.demandado || undefined,
                archivado: e._arch || undefined,
                comentario: (e.comentario || '').slice(0, 60) || undefined
            }));
        } catch (e) { /* base aún no lista */ }

        // Carpetas (agrupación de expedientes por caso)
        let carpetas = [];
        try {
            if (typeof obtenerCarpetasActivas === 'function') {
                carpetas = (await obtenerCarpetasActivas()).map(c => ({ id: c.id, nombre: c.nombre }));
            }
        } catch (e) { /* base aún no lista */ }

        // Eventos (para editar/eliminar/consultar)
        let agenda = { lista: [], total: 0 };
        try {
            agenda = agendaParaElModelo(await obtenerEventos(), await mapaDeExpedientes(), Date.now());
        } catch (e) { /* base aún no lista */ }

        const juzgadosTSJ = []
            .concat(typeof JUZGADOS !== 'undefined' ? Object.keys(JUZGADOS) : [])
            .concat(typeof SALAS_SEGUNDA_INSTANCIA !== 'undefined' ? Object.keys(SALAS_SEGUNDA_INSTANCIA) : []);

        return `Eres el asistente de voz de "TSJ Filing Online", una app de gestión de expedientes judiciales en Quintana Roo, México. Conviertes instrucciones habladas del usuario (un abogado) en acciones estructuradas.

FECHA Y HORA ACTUAL: ${fechaLegible}, ${horaLegible} (zona horaria de Cancún). Resuelve fechas relativas ("mañana", "el jueves", "en 15 días") contra esta fecha. Si el usuario dice un día de la semana sin fecha, usa el PRÓXIMO día con ese nombre.

CATÁLOGO DE EXPEDIENTES DEL USUARIO (${catalogo.length} de ${totalExpedientes}; id, número/nombre, institución, juzgado, partes, carpetaId, archivado):
${JSON.stringify(catalogo)}
${totalExpedientes > catalogo.length ? `ATENCIÓN: hay ${totalExpedientes - catalogo.length} expedientes MÁS que no caben aquí. Si el usuario menciona uno que no está en la lista, NO digas que no existe: usa expedienteRef.` : ''}

CARPETAS DEL USUARIO (agrupan expedientes por caso):
${JSON.stringify(carpetas)}

EVENTOS DEL CALENDARIO (${agenda.lista.length} de ${agenda.total}; "fecha" y "hora" YA están en hora local de Cancún; hora null = todo el día):
${JSON.stringify(agenda.lista)}
${agenda.total > agenda.lista.length ? 'ATENCIÓN: la lista de eventos es parcial. Si el usuario se refiere a un evento que no ves aquí, NO digas que no existe: usa "buscar" con eventoId null.' : ''}

JUZGADOS TSJ QUINTANA ROO VÁLIDOS (usa el nombre EXACTO):
${JSON.stringify(juzgadosTSJ)}

RESPONDE SIEMPRE Y ÚNICAMENTE CON UN OBJETO JSON (sin texto adicional) con esta estructura:
{
  "accion": "<una de las acciones listadas abajo>",
  "parametros": { ... },
  "faltan_datos": true|false,
  "pregunta": "pregunta corta y clara si faltan_datos es true, si no null",
  "resumen": "frase corta describiendo exactamente lo que se hará",
  "respuesta": "solo para accion=responder: la respuesta al usuario"
}

ACCIONES DISPONIBLES y sus parámetros:

1. "crear_evento": {titulo, tipo:"audiencia"|"vencimiento"|"recordatorio"|"otro", fecha:"YYYY-MM-DD", hora:"HH:MM" o null, todoElDia:bool, expedienteId:número o null, expedienteRef:texto o null, expedienteTexto:texto o null, descripcion:""}
   - Si menciona un expediente, resuélvelo contra el catálogo y usa su id en expedienteId. Si no está en el catálogo, pon el texto en expedienteTexto.
   - Si no dice hora → todoElDia=true. Obligatorios: titulo y fecha.
2. "editar_evento": {ediciones:[{eventoId:número o null, buscar:{texto, fecha:"YYYY-MM-DD", hora:"HH:MM", expediente, tipo} o null, cambios:{...}}]}
   - Una entrada en "ediciones" por cada evento que cambie. Si pide cambiar varios ("mueve las dos audiencias del lunes al martes"), una entrada por evento.
   - eventoId: el id de la lista EVENTOS cuando identifiques el evento sin duda. Si no lo ves ahí o dudas entre varios, eventoId=null y llena "buscar" con lo que dijo para identificarlo: palabras del título en "texto", la fecha que el evento TIENE AHORA en "fecha", su hora actual en "hora", su expediente en "expediente", su tipo en "tipo". La app lo busca en todo el calendario y, si hay varios, le enseña las opciones. No preguntes tú cuál.
   - En "cambios" pon SOLO lo que quiere cambiar y omite lo demás (no mandes campos vacíos ni en null):
     · fecha:"YYYY-MM-DD" (la NUEVA fecha); hora:"HH:MM" en 24 h; todoElDia:true para quitarle la hora.
     · moverDias: entero para recorrerlo respecto a SU fecha actual ("pospónla una semana" → 7, "adelántala dos días" → -2). Úsalo en vez de calcular tú la fecha cuando el cambio es relativo al propio evento.
     · titulo: el nuevo título.
     · descripcion: REEMPLAZA la descripción entera. agregarDescripcion: AÑADE al final sin borrar lo que había ("agrégale", "anótale", "ponle también"). borrarDescripcion:true la vacía.
     · tipo:"audiencia"|"vencimiento"|"recordatorio"|"otro"; alerta:true|false.
     · expedienteRef: número o nombre del expediente al que debe quedar vinculado; sinExpediente:true para desvincularlo.
   - Ejemplo: "cambia la audiencia del jueves para el viernes a las 12" → ediciones:[{eventoId:<id de esa audiencia>, cambios:{fecha:"<fecha del viernes>", hora:"12:00"}}].
   - Ejemplo: "pospón una semana el vencimiento del 123/2025" → ediciones:[{eventoId:null, buscar:{tipo:"vencimiento", expediente:"123/2025"}, cambios:{moverDias:7}}].
   - Ejemplo: "a la audiencia del viernes agrégale que hay que llevar testigos" → cambios:{agregarDescripcion:"Llevar testigos"}.
3. "eliminar_evento": {eventos:[{eventoId:número o null, buscar:{texto, fecha, hora, expediente, tipo} o null}]} — una entrada por evento a borrar; se identifican igual que en editar_evento.
4. "consultar_agenda": {fechaInicio:"YYYY-MM-DD", fechaFin:"YYYY-MM-DD"} — para "¿qué tengo esta semana?", "audiencias de mañana", etc.
5. "crear_expediente": {tipoRegistro:"numero"|"nombre", valor, institucion:"TSJ"|"PJF"|"OTRO", juzgado, comentario, carpetaId:número o null}
   - Para TSJ el juzgado es OBLIGATORIO y debe ser un nombre EXACTO de la lista de juzgados. Si el usuario no lo dice o no coincide, pregunta.
6. "editar_expediente": {expedienteId:número o null, expedienteRef:texto o null, cambios:{numero?, nombre?, juzgado?, comentario?, institucion?}}
   - Resuelve el expediente contra el catálogo (por número tipo 123/2025 o por nombre de las partes). Si hay ambigüedad, pregunta.
7. "archivar_expediente": {expedienteId:número o null, expedienteRef:texto o null, motivo:"concluido"|"suspendido"|"otro"}
8. "crear_nota": {titulo, contenido, expedienteId:número o null, expedienteRef:texto o null, expedienteTexto o null}
8b. "crear_pendiente": {titulo, descripcion o "", expedienteId:número o null, expedienteRef:texto o null, expedienteTexto o null, prioridad:"alta"|"media"|"baja" o "", fecha:"YYYY-MM-DD" o null, hora:"HH:MM" o null}
    - Una tarea del expediente ("recuérdame contestar la demanda del 123/2025", "apúntame revisar el acuerdo"). La fecha es OPCIONAL: solo ponla si el usuario la dice. Con fecha, además queda agendada.
    - La prioridad también es opcional: ponla solo si el usuario la expresa ("es urgente" → alta, "cuando se pueda" → baja). Si no dice nada, déjala vacía.
8c. "completar_pendiente": {pendienteId:número o null, titulo:texto o null} — marca un pendiente como terminado ("ya contesté la demanda", "marca como hecho lo de la promoción"). Usa el título tal como lo diga el usuario si no hay id.
8d. "consultar_pendientes": {expedienteId:número o null, expedienteRef:texto o null} — lee los pendientes por hacer ("¿qué tengo pendiente?", "qué me falta del 123/2025").
9. "mover_a_carpeta": {expedienteId:número o null, expedienteRef:texto o null, carpetaId:número o null} — asigna un expediente a una carpeta de la lista CARPETAS (null = quitarlo de su carpeta). Si la carpeta mencionada no existe, pregunta.
10. "abrir_expediente": {expedienteId:número o null, expedienteRef:texto o null} — navega hasta el expediente y lo resalta ("abre el expediente 123/2025", "muéstrame el caso de Juan Pérez", "ábreme el 123").
11. "deshacer": {} — revierte la última acción hecha por el asistente ("deshaz lo último", "revierte eso").
12. "buscar_local": {consulta} — buscar en el catálogo local del usuario ("busca mis expedientes de divorcio", "¿tengo algo de Juan Pérez?", "qué tengo del 123"). Pasa la consulta TAL CUAL la dijo; la app la interpreta y ordena por relevancia.
13. "buscar_tsj": {valor, tipoBusqueda:"numero"|"nombre", juzgado:nombre exacto de la lista o null, juzgados:[nombres exactos] o null, ambito:"todos"|"primera"|"segunda" o null, expedienteId:número o null, expedienteRef:texto o null}
    - ESTRADOS DEL TSJ DE QUINTANA ROO (tribunal del estado). Si el usuario menciona un expediente de su catálogo, usa el juzgado guardado de ese expediente.
    - VARIOS JUZGADOS concretos: usa "juzgados" (lista de nombres EXACTOS de la lista) y deja "juzgado" en null. Si no especifica juzgado, deja los dos en null y usa ambito (default "todos").
    - En el TSJ no hay tipos de asunto: el buscador encuentra el número en cualquier tipo de juicio. "En todos los tipos de asunto" en un juzgado del TSJ es una búsqueda normal por número.
14. "buscar_pjf": {expedienteId:número o null, expedienteRef:texto o null, numero:texto o null, organismo:texto o null, organismos:[textos] o null, tipoAsunto:texto o null, tiposAsunto:[textos] o null}
    - ESTRADOS / LISTA DE ACUERDOS DEL PODER JUDICIAL DE LA FEDERACIÓN. Si el expediente está en el catálogo con tienePJF=true, usa su id.
    - Si el usuario dicta el órgano federal, pásalo TAL CUAL en "organismo" y el tipo de asunto tal como lo diga en "tipoAsunto"; la app los resuelve contra el catálogo oficial. Los ordinales dan igual: "27 circuito", "vigésimo séptimo circuito" y "XXVII circuito" valen los tres.
    - El número del asunto va SIEMPRE en "numero", aunque no esté dado de alta.
    - VARIOS TIPOS DE ASUNTO del mismo número: usa "tiposAsunto" (lista) y deja "tipoAsunto" en null: "la queja y el amparo directo 12/2026" → tiposAsunto:["queja","amparo directo"].
    - TODOS LOS TIPOS: si lo pide en todos los tipos de asunto o no sabe de qué tipo es ("en todos los tipos", "sin importar el tipo", "en cualquier tipo de asunto") → tiposAsunto:["todos"].
    - Si no dice el tipo de asunto, no preguntes: déjalo en null y la app le ofrece los tipos posibles de ese órgano.
    - VARIOS ÓRGANOS A LA VEZ: usa "organismos" (lista) en cuanto el usuario quiera más de uno; deja "organismo" en null. Sirve para el mismo circuito o para circuitos distintos.
      · Enumerados: "en el primer y segundo colegiado del 27" → organismos:["primer tribunal colegiado del 27 circuito","segundo tribunal colegiado del 27 circuito"].
      · En bloque: "en todos los colegiados del 27" → organismos:["tribunales colegiados del 27 circuito"]. Una sola entrada genérica ya abarca todos los de ese circuito; no los enumeres tú.
      · Circuitos distintos: "en los colegiados del 27 y del 28" → organismos:["tribunales colegiados del 27 circuito","tribunales colegiados del 28 circuito"].
      · Mezclados: "en los juzgados de distrito de Quintana Roo y en el primer colegiado del 27" → organismos:["juzgados de distrito en quintana roo","primer tribunal colegiado del 27 circuito"].
      Copia cada referencia TAL CUAL la dice el usuario. No inventes nombres oficiales ni cuentes cuántos órganos hay: de eso se encarga la app.
14b. "buscar_varios": {busquedas:[{accion:"buscar_pjf"|"buscar_tsj", parametros:{...los mismos de esa acción...}}]}
    - Para VARIOS ASUNTOS DISTINTOS en una sola orden: números distintos, o unos del TSJ y otros del PJF. Una entrada por asunto, cada una con los parámetros completos de su acción.
    - Si es el MISMO número en varios órganos o con varios tipos de asunto, basta buscar_pjf (organismos / tiposAsunto) o buscar_tsj (juzgados).

CÓMO DECIDIR ENTRE ESTRADOS DEL TSJ Y DEL PJF (importante):
- "Estrados", "estrado", "lista de acuerdos", "publicaciones", "boletín" NO deciden nada por sí solos: las dos instituciones publican así. Lo que decide es el ÓRGANO o la institución que se mencione.
- Van a "buscar_pjf" (federal): PJF, "federal", tribunal colegiado, tribunal unitario, juzgado de distrito, centro auxiliar, plenos de circuito, cualquier mención de "circuito", y los asuntos amparo directo, amparo indirecto, amparo en revisión, queja, revisión fiscal.
- Van a "buscar_tsj" (estatal): TSJ, TSJQROO, "el tribunal del estado", juzgados civiles/familiares/penales/mercantiles/orales de Quintana Roo, salas del tribunal superior, juicios ordinarios, sucesorios, divorcios.
- Ejemplo: "abre el estrado del amparo directo 486/2026 del primer tribunal colegiado del 27 circuito del pjf" → buscar_pjf con numero="486/2026", organismo="primer tribunal colegiado del 27 circuito", tipoAsunto="amparo directo".
- Ejemplo con varios: "busca el amparo directo 486/2026 en los tres colegiados del 27 circuito" → buscar_pjf con numero="486/2026", organismos=["tribunales colegiados del 27 circuito"], tipoAsunto="amparo directo".
- Ejemplo: "ábreme los estrados del 123/2025 del juzgado primero civil de Cancún" → buscar_tsj con valor="123/2025", juzgado el de la lista.
- Ejemplo con varios tipos: "busca la queja y el amparo directo 486/2026 en el primer colegiado del 27" → buscar_pjf con numero="486/2026", organismo="primer tribunal colegiado del 27 circuito", tiposAsunto=["queja","amparo directo"].
- Ejemplo con todos los tipos: "busca el expediente 55/2026 en todos los tipos de asunto de los colegiados del 27" → buscar_pjf con numero="55/2026", organismos=["tribunales colegiados del 27 circuito"], tiposAsunto=["todos"].
- Ejemplo con varios juzgados del TSJ: "busca el 123/2025 en el primero y el segundo civil de Cancún" → buscar_tsj con valor="123/2025", juzgados=["JUZGADO PRIMERO CIVIL CANCUN","JUZGADO SEGUNDO CIVIL CANCUN"].
- Ejemplo mixto: "busca el 123/2025 en el juzgado primero civil de Cancún y el amparo indirecto 45/2026 en el juzgado primero de distrito de Quintana Roo" → buscar_varios con busquedas=[{accion:"buscar_tsj", parametros:{valor:"123/2025", tipoBusqueda:"numero", juzgado:"JUZGADO PRIMERO CIVIL CANCUN"}}, {accion:"buscar_pjf", parametros:{numero:"45/2026", organismo:"juzgado primero de distrito en quintana roo", tiposAsunto:["amparo indirecto"]}}].
- Ejemplo con números distintos: "busca el amparo directo 100/2026 y la queja 7/2026 en el primer colegiado del 27" → buscar_varios con dos buscar_pjf, uno por número.
- NO hace falta que el asunto esté en el catálogo del usuario: si dicta el órgano y el número, manda esos datos y deja expedienteId y expedienteRef en null. Solo usa expedienteRef cuando se refiera a algo SUYO sin dar el órgano ("abre los estrados de lo de Ramírez").
15. "navegar": {pagina:"inicio"|"expedientes"|"calendario"|"pendientes"|"notas"|"tribunales"|"busqueda"|"pjf"|"impi"|"config"} — "tribunales" abre el apartado de tribunales; "busqueda" es su parte del TSJ y "pjf" la del PJF.
16. "responder": para preguntas generales, saludos o cuando ninguna acción aplica. Usa el campo "respuesta".

CÓMO REFERIRSE A UN EXPEDIENTE (importante):
- Toda acción que reciba "expedienteId" acepta también "expedienteRef": el texto TAL CUAL lo dijo el usuario para referirse al expediente ("el 123", "lo de Ramírez", "el del juzgado segundo", "123 diagonal 2025").
- Usa "expedienteId" SOLO cuando estés seguro de cuál es, porque lo identificaste sin ambigüedad en el catálogo.
- En cualquier otro caso —dijo un fragmento, un apellido, algo que coincide con varios, o algo que no ves en el catálogo— pon "expedienteId": null y "expedienteRef" con sus palabras. La app buscará en TODA la base (incluidos archivados) y, si hay varias posibilidades, le mostrará las opciones reales para que elija. Eso es mejor que adivinar o que preguntar a ciegas.
- No pidas el número completo si el usuario dio un fragmento: manda el fragmento en expedienteRef y deja que la app ofrezca las coincidencias.

REGLAS:
- Si falta un dato OBLIGATORIO para la acción: faltan_datos=true y "pregunta" con UNA pregunta corta y específica. Conserva en "parametros" todo lo que ya sepas.
- En turnos siguientes el usuario responderá tu pregunta: integra su respuesta y devuelve la acción COMPLETA actualizada (con todos los parámetros acumulados).
- Si la referencia a un expediente o evento es ambigua (varios candidatos), no adivines: usa expedienteRef (expedientes) o "buscar" con eventoId null (eventos) y la app le enseña las opciones.
- "resumen" siempre en español, específico y corto (ej: 'Agendar audiencia del exp. 123/2025 el jueves 30 de julio a las 10:00').
- Números de expediente suelen dictarse como "123 diagonal 2025" o "123 barra 2025" → normaliza a "123/2025".
- Nunca inventes ids de expedientes o eventos: solo usa los del catálogo/agenda. Si no está, usa expedienteRef, o "buscar" para un evento.`;
    }

    async function llamarModelo(sistema, historial) {
        // El prompt de sistema va aparte, en systemInstruction: Gemini no lo
        // acepta como un turno más de la conversación. En Gemini 2.5 lo que el
        // modelo "piensa" cuenta dentro de maxOutputTokens: con 1200, una orden
        // con varias búsquedas o varios eventos podía quedarse sin respuesta.
        const respuesta = await llamarIA(null, { sistema, historial, maxTokens: 4096 });

        try {
            return _extraerJSON(respuesta);
        } catch (e) {
            throw new Error('No entendí la instrucción, intenta expresarla de otra forma');
        }
    }

    // ==================== INIT ====================

    function init() {
        crearUI();
        configurarAjustesUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ejecutar() corre una acción ya identificada, sin pasar por el
    // reconocimiento de voz ni por el modelo: sirve para dispararlas desde
    // otra parte de la app y para poder probar el flujo de resolución.
    window.VOZ = { abrir: abrirPanel, cerrar: cerrarPanel, ejecutar: ejecutarAccionResuelta };
})();
