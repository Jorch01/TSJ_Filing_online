/**
 * Asistente de Voz – TSJ Filing Online
 *
 * Botón flotante (micrófono) disponible en TODAS las páginas del sitio.
 * Permite dar instrucciones por voz (o texto) para que la app ejecute
 * acciones automáticamente:
 *
 *   - Agendar / editar / eliminar eventos del calendario
 *   - Crear / editar / archivar expedientes
 *   - Crear notas
 *   - Buscar en el catálogo local de expedientes
 *   - Abrir búsquedas en estrados del TSJ Quintana Roo (local)
 *   - Abrir búsquedas en el Poder Judicial de la Federación (federal)
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
 * con Whisper vía Groq.
 *
 * Global expuesto: window.VOZ = { abrir, cerrar, ejecutar }
 */
(function () {
    'use strict';

    // ==================== CONSTANTES ====================

    const TTS_KEY = 'voz_tts_activado';          // localStorage: respuestas habladas
    const RATE_KEY = 'voz_tts_velocidad';        // localStorage: velocidad de la voz
    const AUTO_KEY = 'voz_auto_escucha';         // localStorage: escuchar al abrir el panel
    const MODELO_DEFAULT = 'llama-3.3-70b-versatile';
    const WHISPER_MODEL = 'whisper-large-v3-turbo';
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

    const EJEMPLOS = [
        'Agenda audiencia del expediente 123/2025 el jueves a las 10',
        'Busca el 456/2024 en estrados del TSJ',
        'Agrega nota al expediente de Juan Pérez: llamar al perito',
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
                'Consulta el amparo indirecto 55/2025 en el Juzgado Segundo de Distrito de Cancún'
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
        'Di "deshaz lo último" para revertir la acción más reciente hecha por el asistente.',
        'Con 🔊/🔇 activas o silencias mis respuestas habladas; en Configuración puedes ajustar la velocidad de la voz y la escucha automática.',
        'También puedes escribir la instrucción en el campo de texto de abajo.'
    ];

    // ==================== ESTADO ====================

    const Estado = {
        INACTIVO: 'inactivo',
        ESCUCHANDO: 'escuchando',       // Web Speech API activa
        GRABANDO: 'grabando',           // MediaRecorder (fallback Whisper)
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

    // --- Fallback: grabar y transcribir con Whisper (Groq) ---

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
                    const texto = await transcribirConGroq(blob);
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

    async function transcribirConGroq(blob) {
        const apiKey = await obtenerApiKey();
        if (!apiKey) throw new Error('Configura tu API Key de Groq');
        const ext = (blob.type.includes('mp4')) ? 'mp4' : (blob.type.includes('ogg')) ? 'ogg' : 'webm';
        const fd = new FormData();
        fd.append('file', blob, 'audio.' + ext);
        fd.append('model', WHISPER_MODEL);
        fd.append('language', 'es');
        const resp = await fetchConTimeout('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey },
            body: fd
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error?.message || 'Error en la transcripción');
        }
        const data = await resp.json();
        return (data.text || '').trim();
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
            const respuesta = await llamarGroq(sistema, conversacion);
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

        // 2) Acción destructiva o múltiples popups → confirmar
        const multiPopupTSJ = accion === 'buscar_tsj' && !p.juzgado;
        if (ACCIONES_MUTANTES.has(accion) || multiPopupTSJ) {
            accionPendiente = r;
            estado = Estado.ESPERANDO_CONFIRMACION;
            mostrarConfirmacion(r.resumen || 'Ejecutar: ' + accion);
            hablar((r.resumen || '') + '. ¿Confirmas?', () => { if (panelAbierto()) iniciarEscucha(); });
            return;
        }

        // 3) Acción no destructiva → ejecutar directo
        await ejecutarAccion(r);
    }

    function mostrarConfirmacion(resumen) {
        const cont = document.getElementById('voz-confirmacion');
        const txt = document.getElementById('voz-confirmacion-texto');
        if (txt) txt.innerHTML = '⚡ <strong>Acción propuesta:</strong><br>' + esc(resumen) +
            '<br><span class="voz-hint">Di "sí" para confirmar o "no" para cancelar.</span>';
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
        await ejecutarAccionResuelta(accion, p);
    }

    // Ejecuta una acción ya identificada. Vive aparte de ejecutarAccion para
    // poder reanudarla tal cual cuando el usuario elige el expediente entre
    // varias posibilidades.
    async function ejecutarAccionResuelta(accion, p) {
        try {
            let mensajeFinal = '';
            switch (accion) {
                case 'crear_evento':        mensajeFinal = await accCrearEvento(p); break;
                case 'editar_evento':       mensajeFinal = await accEditarEvento(p); break;
                case 'eliminar_evento':     mensajeFinal = await accEliminarEvento(p); break;
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
                case 'buscar_tsj':          mensajeFinal = await accBuscarTSJ(p); break;
                case 'buscar_pjf':          mensajeFinal = await accBuscarPJF(p); break;
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

    async function accEditarEvento(p) {
        const id = parseInt(p.eventoId);
        if (!id) throw new Error('No identifiqué qué evento editar');
        const evento = (await obtenerEventos()).find(e => e.id === id);
        if (!evento) throw new Error('Evento no encontrado');

        const c = p.cambios || {};
        const cambios = {};
        if (c.titulo) cambios.titulo = c.titulo;
        if (c.descripcion != null) cambios.descripcion = c.descripcion;
        if (c.tipo && CORE_COLORES_EVENTOS[c.tipo]) cambios.tipo = c.tipo; // el color lo ajusta el núcleo
        if (c.fecha || c.hora) {
            const base = new Date(evento.fechaInicio);
            const fecha = c.fecha || fechaLocalISO(base);
            const horaNueva = normalizarHora(c.hora);
            const hora = horaNueva || (pad(base.getHours()) + ':' + pad(base.getMinutes()));
            const nueva = new Date(fecha + 'T' + hora);
            if (isNaN(nueva.getTime())) throw new Error('Fecha u hora inválida');
            cambios.fechaInicio = nueva.toISOString();
            if (horaNueva) cambios.todoElDia = false;
        }
        if (typeof c.todoElDia === 'boolean') cambios.todoElDia = c.todoElDia;
        if (!Object.keys(cambios).length) throw new Error('No hay cambios que aplicar');

        // Valores previos de los campos que cambian, para poder deshacer
        const antes = {};
        for (const k of Object.keys(cambios)) antes[k] = evento[k];

        await actualizarEventoCore(id, cambios);
        registrarDeshacer({ tipo: 'evento_editado', id, antes, etiqueta: `edición del evento "${evento.titulo}"` });
        toast('Evento actualizado', 'success');
        return `Evento "${evento.titulo}" actualizado.`;
    }

    async function accEliminarEvento(p) {
        const id = parseInt(p.eventoId);
        if (!id) throw new Error('No identifiqué qué evento eliminar');
        const eliminado = await eliminarEventoCore(id);
        const copia = { ...eliminado };
        delete copia.id;
        delete copia.googleCalEventId;
        registrarDeshacer({ tipo: 'evento_eliminado', evento: copia, etiqueta: `eliminación del evento "${eliminado.titulo}"` });
        toast('Evento eliminado', 'success');
        return `Evento "${eliminado.titulo}" eliminado.`;
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

    function matchJuzgadoTSJ(nombre) {
        if (!nombre) return null;
        const todos = []
            .concat(typeof JUZGADOS !== 'undefined' ? Object.keys(JUZGADOS) : [])
            .concat(typeof SALAS_SEGUNDA_INSTANCIA !== 'undefined' ? Object.keys(SALAS_SEGUNDA_INSTANCIA) : []);
        if (todos.includes(nombre)) return nombre;
        const objetivo = normalizar(nombre);
        return todos.find(j => normalizar(j) === objetivo) ||
               todos.find(j => normalizar(j).includes(objetivo) || objetivo.includes(normalizar(j))) ||
               null;
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

    async function accBuscarTSJ(p) {
        // Si mencionó un expediente, se usa su juzgado y su número en vez de
        // abrir una ventana por cada juzgado del estado.
        if (!p.juzgado && (p.expedienteId != null || p.expedienteRef)) {
            const expTSJ = await resolverExpedienteDeParametros(p, 'buscar_tsj');
            if (expTSJ) {
                if (expTSJ.juzgado) p = { ...p, juzgado: expTSJ.juzgado };
                if (!p.valor && expTSJ.numero) p = { ...p, valor: expTSJ.numero, tipoBusqueda: 'numero' };
            }
        }
        if (!p.valor) throw new Error('Falta el número o nombre a buscar');
        const tipo = p.tipoBusqueda === 'nombre' ? 'nombre' : 'numero';
        if (typeof construirUrlBusqueda !== 'function') throw new Error('El buscador TSJ no está disponible');

        if (p.juzgado) {
            const match = matchJuzgadoTSJ(p.juzgado);
            if (!match) throw new Error('No identifiqué el juzgado "' + p.juzgado + '"');
            const url = construirUrlBusqueda(match, tipo, p.valor);
            if (typeof abrirBusquedaPopup === 'function') abrirBusquedaPopup(url, p.valor + ' en ' + match);
            else if (url) window.open(url, '_blank');
            return `Abrí la búsqueda de "${p.valor}" en ${match}.`;
        }

        // Búsqueda en múltiples juzgados (ya confirmada por el usuario)
        const ambito = ['todos', 'primera', 'segunda'].includes(p.ambito) ? p.ambito : 'todos';
        let lista = [];
        if (ambito === 'todos' || ambito === 'primera') {
            if (typeof JUZGADOS !== 'undefined') lista = lista.concat(Object.keys(JUZGADOS));
        }
        if (ambito === 'todos' || ambito === 'segunda') {
            if (typeof SALAS_SEGUNDA_INSTANCIA !== 'undefined') lista = lista.concat(Object.keys(SALAS_SEGUNDA_INSTANCIA));
        }
        if (!lista.length) throw new Error('No hay juzgados disponibles para ese ámbito');

        let delay = 0;
        for (const juzgado of lista) {
            const url = construirUrlBusqueda(juzgado, tipo, p.valor);
            if (!url) continue;
            setTimeout(() => {
                if (typeof abrirBusquedaPopup === 'function') abrirBusquedaPopup(url, p.valor + ' en ' + juzgado.substring(0, 30));
                else window.open(url, '_blank');
            }, delay);
            delay += 600;
        }
        return `Abriendo búsqueda de "${p.valor}" en ${lista.length} juzgados del TSJ. Permite las ventanas emergentes.`;
    }

    async function accBuscarPJF(p) {
        // Aquí la referencia también sirve: "busca en el PJF lo de Ramírez".
        const exp = await resolverExpedienteDeParametros(p, 'buscar_pjf');
        const numero = (exp && exp.numero) || p.numero || '';

        if (exp && exp.pjfOrgId && exp.pjfTipoAsunto && numero && typeof construirURLPJF === 'function') {
            const url = construirURLPJF(exp.pjfOrgId, exp.pjfTipoAsunto, numero, 0);
            window.open(url, 'pjf_expediente', 'width=1024,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no');
            return `Abrí la consulta del expediente ${numero} en el portal del PJF.`;
        }

        // Organismo dictado por nombre → resolver contra el catálogo PJF
        if (p.organismo && typeof buscarOrganismoPJF === 'function' && typeof construirURLPJF === 'function') {
            if (typeof asegurarCatalogosPJF === 'function') await asegurarCatalogosPJF();
            const org = buscarOrganismoPJF(p.organismo);
            if (org) {
                if (!numero) throw new Error('Falta el número de expediente para consultar en el PJF');
                const ta = p.tipoAsunto ? buscarTipoAsuntoPJF(org, p.tipoAsunto) : null;
                if (ta) {
                    const url = construirURLPJF(org.id, ta.id, numero, 0);
                    window.open(url, 'pjf_expediente', 'width=1024,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no');
                    return `Abrí la consulta del ${numero} (${ta.nombre}) en ${org.nombre}.`;
                }
                const tipos = (typeof tiposAsuntoDeOrgano === 'function' ? tiposAsuntoDeOrgano(org) : [])
                    .map(t => t.nombre).slice(0, 12).join(', ');
                throw new Error(`Identifiqué el órgano "${org.nombre}" pero no el tipo de asunto. ` +
                    (tipos ? `Los válidos son: ${tipos}. ` : '') + 'Repite indicando el tipo de asunto.');
            }
            // Si el órgano no se resolvió, caer al plan B de abajo
        }

        // Sin organismo resuelto: llevar a la página PJF con el número precargado
        if (typeof navegarA === 'function') navegarA('pjf');
        if (numero) {
            setTimeout(() => {
                const input = document.getElementById('pjf-num-expediente');
                if (input) input.value = numero;
            }, 400);
        }
        return numero
            ? `Te llevé a la búsqueda PJF con el expediente ${numero} precargado. Selecciona circuito y organismo para consultar.`
            : 'Te llevé a la búsqueda del PJF. Selecciona circuito, organismo y número de expediente.';
    }

    function accNavegar(p) {
        const paginas = ['inicio', 'expedientes', 'calendario', 'pendientes', 'notas', 'busqueda', 'pjf', 'impi', 'config'];
        const pagina = paginas.includes(p.pagina) ? p.pagina : null;
        if (!pagina) throw new Error('No identifiqué a qué sección navegar');
        if (typeof navegarA === 'function') navegarA(pagina);
        return 'Listo, estás en ' + pagina + '.';
    }

    // ==================== LLM (GROQ) ====================

    async function obtenerApiKey() {
        try {
            return (await obtenerConfig('groq_api_key')) || '';
        } catch (e) {
            return '';
        }
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

        // Eventos cercanos (para editar/eliminar/consultar)
        let agenda = [];
        try {
            const desde = Date.now() - 7 * 864e5;
            const hasta = Date.now() + 120 * 864e5;
            agenda = (await obtenerEventos())
                .filter(e => {
                    const t = new Date(e.fechaInicio).getTime();
                    return t >= desde && t <= hasta;
                })
                .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio))
                .slice(0, 80)
                .map(e => ({ id: e.id, titulo: e.titulo, tipo: e.tipo, fechaInicio: e.fechaInicio, expedienteId: e.expedienteId || null }));
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

EVENTOS DEL CALENDARIO (recientes y próximos):
${JSON.stringify(agenda)}

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
2. "editar_evento": {eventoId:número, cambios:{titulo?, tipo?, fecha?:"YYYY-MM-DD", hora?:"HH:MM", todoElDia?, descripcion?}}
   - Resuelve el evento contra la lista de EVENTOS. Si hay varios candidatos, pregunta cuál.
3. "eliminar_evento": {eventoId:número}
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
13. "buscar_tsj": {valor, tipoBusqueda:"numero"|"nombre", juzgado:nombre exacto de la lista o null, ambito:"todos"|"primera"|"segunda" o null, expedienteId:número o null, expedienteRef:texto o null}
    - Busca en los estrados en línea del TSJ Quintana Roo. Si el usuario menciona un expediente de su catálogo, usa el juzgado guardado de ese expediente. Si no especifica juzgado, deja juzgado=null y usa ambito (default "todos"; abre muchas ventanas).
14. "buscar_pjf": {expedienteId:número o null, expedienteRef:texto o null, numero:texto o null, organismo:texto o null, tipoAsunto:texto o null}
    - Consulta en el portal del Poder Judicial de la Federación. Si el expediente está en el catálogo con tienePJF=true, usa su id.
    - Si el usuario dicta el órgano federal ("Juzgado Segundo de Distrito de Cancún", "Tribunal Colegiado del Vigésimo Séptimo Circuito"), pásalo TAL CUAL en "organismo" y el tipo de asunto tal como lo diga ("amparo indirecto", "juicio de amparo") en "tipoAsunto"; la app los resuelve contra el catálogo oficial.
15. "navegar": {pagina:"inicio"|"expedientes"|"calendario"|"pendientes"|"notas"|"busqueda"|"pjf"|"impi"|"config"}
16. "responder": para preguntas generales, saludos o cuando ninguna acción aplica. Usa el campo "respuesta".

CÓMO REFERIRSE A UN EXPEDIENTE (importante):
- Toda acción que reciba "expedienteId" acepta también "expedienteRef": el texto TAL CUAL lo dijo el usuario para referirse al expediente ("el 123", "lo de Ramírez", "el del juzgado segundo", "123 diagonal 2025").
- Usa "expedienteId" SOLO cuando estés seguro de cuál es, porque lo identificaste sin ambigüedad en el catálogo.
- En cualquier otro caso —dijo un fragmento, un apellido, algo que coincide con varios, o algo que no ves en el catálogo— pon "expedienteId": null y "expedienteRef" con sus palabras. La app buscará en TODA la base (incluidos archivados) y, si hay varias posibilidades, le mostrará las opciones reales para que elija. Eso es mejor que adivinar o que preguntar a ciegas.
- No pidas el número completo si el usuario dio un fragmento: manda el fragmento en expedienteRef y deja que la app ofrezca las coincidencias.

REGLAS:
- Si falta un dato OBLIGATORIO para la acción: faltan_datos=true y "pregunta" con UNA pregunta corta y específica. Conserva en "parametros" todo lo que ya sepas.
- En turnos siguientes el usuario responderá tu pregunta: integra su respuesta y devuelve la acción COMPLETA actualizada (con todos los parámetros acumulados).
- Si la referencia a un expediente o evento es ambigua (varios candidatos), pregunta cuál, listando las opciones brevemente en la pregunta.
- "resumen" siempre en español, específico y corto (ej: 'Agendar audiencia del exp. 123/2025 el jueves 30 de julio a las 10:00').
- Números de expediente suelen dictarse como "123 diagonal 2025" o "123 barra 2025" → normaliza a "123/2025".
- Nunca inventes ids de expedientes o eventos: solo usa los del catálogo/agenda. Si no está, usa expedienteRef.`;
    }

    async function llamarGroq(sistema, historial) {
        const apiKey = await obtenerApiKey();
        const modelo = (await obtenerConfig('groq_model').catch(() => null)) || MODELO_DEFAULT;

        const response = await fetchConTimeout('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model: modelo,
                messages: [{ role: 'system', content: sistema }].concat(historial),
                max_tokens: 1200,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Error en la API de Groq');
        }

        const data = await response.json();
        const contenido = data.choices?.[0]?.message?.content || '';
        const jsonMatch = contenido.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No entendí la instrucción, intenta expresarla de otra forma');
        return JSON.parse(jsonMatch[0]);
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
