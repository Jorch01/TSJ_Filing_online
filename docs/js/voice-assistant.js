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
 * Global expuesto: window.VOZ = { abrir, cerrar }
 */
(function () {
    'use strict';

    // ==================== CONSTANTES ====================

    const TTS_KEY = 'voz_tts_activado';          // localStorage: respuestas habladas
    const MODELO_DEFAULT = 'llama-3.3-70b-versatile';
    const WHISPER_MODEL = 'whisper-large-v3-turbo';
    const MAX_TURNOS = 16;                        // tope de la conversación de slot-filling

    // Acciones que modifican datos → siempre piden confirmación
    const ACCIONES_MUTANTES = new Set([
        'crear_evento', 'editar_evento', 'eliminar_evento',
        'crear_expediente', 'editar_expediente', 'archivar_expediente',
        'crear_nota'
    ]);

    const RE_SI = /^\s*(s[ií]|confirmo|confirmar|confirmado|dale|adelante|correcto|as[ií] es|ok|okey|hazlo|procede|por favor)\b/i;
    const RE_NO = /^\s*(no|cancela|cancelar|cancelado|det[eé]n|olv[ií]dalo|mejor no|espera)\b/i;

    const COLORES_EVT = { audiencia: '#3788d8', vencimiento: '#dc3545', recordatorio: '#ffc107', otro: '#6c757d' };

    const EJEMPLOS = [
        'Agenda audiencia del expediente 123/2025 el jueves a las 10',
        'Busca el 456/2024 en estrados del TSJ',
        'Agrega nota al expediente de Juan Pérez: llamar al perito',
        '¿Qué audiencias tengo esta semana?',
        'Cambia el comentario del expediente 78/2025 a "pendiente de sentencia"'
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
    let mediaRecorder = null;
    let chunksAudio = [];
    let ttsActivo = localStorage.getItem(TTS_KEY) !== '0';

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

    function fechaLocalISO(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function toast(msg, tipo) {
        if (typeof mostrarToast === 'function') mostrarToast(msg, tipo || 'info');
    }

    async function refrescarUI() {
        try {
            if (typeof cargarExpedientes === 'function') await cargarExpedientes();
            if (typeof cargarEventos === 'function') await cargarEventos();
            if (typeof cargarNotas === 'function') await cargarNotas();
            if (typeof cargarEstadisticas === 'function') await cargarEstadisticas();
            if (typeof renderizarCalendario === 'function') renderizarCalendario();
        } catch (e) {
            console.error('[VOZ] Error refrescando UI:', e);
        }
    }

    async function sincronizar() {
        try {
            if (typeof marcarYSincronizar === 'function') await marcarYSincronizar();
        } catch (e) {
            console.error('[VOZ] Error al sincronizar:', e);
        }
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
                    '<button type="button" id="voz-tts-toggle" title="Respuestas habladas"></button>' +
                    '<button type="button" id="voz-cerrar" title="Cerrar" aria-label="Cerrar">✕</button>' +
                '</div>' +
            '</div>' +
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
    }

    function panelAbierto() {
        const p = document.getElementById('voz-panel');
        return !!p && p.classList.contains('activo');
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
        // Arrancar escucha de inmediato: ese es el punto del botón
        iniciarEscucha();
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
        u.rate = 1.05;
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
        if (estado === Estado.ESCUCHANDO) { detenerEscucha(); return; }
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
            const texto = transcriptFinal.trim();
            if (texto) {
                setStatus('', false);
                procesarEntradaUsuario(texto);
            } else if (estado === Estado.INACTIVO) {
                setStatus('No escuché nada. Toca el micrófono para reintentar o escribe abajo.', false);
            }
        };

        try {
            recognition.start();
        } catch (e) {
            recognition = null;
            estado = Estado.INACTIVO;
            setStatus('No se pudo iniciar el micrófono. Escribe tu instrucción abajo.', false);
        }
    }

    function detenerEscucha() {
        if (recognition) {
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

    async function transcribirConGroq(blob) {
        const apiKey = await obtenerApiKey();
        if (!apiKey) throw new Error('Configura tu API Key de Groq');
        const ext = (blob.type.includes('mp4')) ? 'mp4' : (blob.type.includes('ogg')) ? 'ogg' : 'webm';
        const fd = new FormData();
        fd.append('file', blob, 'audio.' + ext);
        fd.append('model', WHISPER_MODEL);
        fd.append('language', 'es');
        const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
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
        agregarMensaje('usuario', esc(texto));

        // Respondiendo a una confirmación pendiente. Nota: se detecta por
        // accionPendiente (no por `estado`) porque el estado del micrófono
        // puede cambiar (reintentos, errores) sin que la confirmación caduque.
        if (accionPendiente) {
            if (RE_SI.test(texto)) { confirmarAccion(); return; }
            if (RE_NO.test(texto)) { cancelarAccion(); return; }
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
                case 'buscar_local':        mensajeFinal = await accBuscarLocal(p); break;
                case 'buscar_tsj':          mensajeFinal = await accBuscarTSJ(p); break;
                case 'buscar_pjf':          mensajeFinal = await accBuscarPJF(p); break;
                case 'navegar':             mensajeFinal = accNavegar(p); break;
                case 'responder':
                default:
                    mensajeFinal = r.respuesta || r.resumen || 'Listo.';
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
        const todoElDia = p.hora ? false : (p.todoElDia !== false);
        const fechaInicio = new Date(p.fecha + 'T' + (p.hora || '09:00'));
        if (isNaN(fechaInicio.getTime())) throw new Error('Fecha inválida: ' + p.fecha);

        const evento = {
            titulo: p.titulo,
            tipo,
            fechaInicio: fechaInicio.toISOString(),
            todoElDia,
            expedienteId: p.expedienteId != null ? parseInt(p.expedienteId) : null,
            expedienteTexto: p.expedienteTexto || null,
            descripcion: p.descripcion || '',
            alerta: true,
            color: COLORES_EVT[tipo]
        };
        const nuevoId = await agregarEvento(evento);
        await refrescarUI();
        await sincronizar();
        if (typeof GCAL !== 'undefined' && GCAL.estaConectado && GCAL.estaConectado()) {
            const guardado = (await obtenerEventos()).find(e => e.id === nuevoId);
            if (guardado) GCAL.hookGuardarEvento(guardado);
        }
        toast('Evento creado', 'success');
        const cuando = fechaInicio.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) +
            (p.hora ? ' a las ' + p.hora : '');
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
        if (c.tipo && COLORES_EVT[c.tipo]) { cambios.tipo = c.tipo; cambios.color = COLORES_EVT[c.tipo]; }
        if (c.fecha || c.hora) {
            const base = new Date(evento.fechaInicio);
            const fecha = c.fecha || fechaLocalISO(base);
            const hora = c.hora || (pad(base.getHours()) + ':' + pad(base.getMinutes()));
            const nueva = new Date(fecha + 'T' + hora);
            if (isNaN(nueva.getTime())) throw new Error('Fecha u hora inválida');
            cambios.fechaInicio = nueva.toISOString();
            if (c.hora) cambios.todoElDia = false;
        }
        if (typeof c.todoElDia === 'boolean') cambios.todoElDia = c.todoElDia;
        if (!Object.keys(cambios).length) throw new Error('No hay cambios que aplicar');

        await actualizarEvento(id, cambios);
        await refrescarUI();
        await sincronizar();
        if (typeof GCAL !== 'undefined' && GCAL.estaConectado && GCAL.estaConectado()) {
            const actualizado = (await obtenerEventos()).find(e => e.id === id);
            if (actualizado) GCAL.hookGuardarEvento(actualizado);
        }
        toast('Evento actualizado', 'success');
        return `Evento "${evento.titulo}" actualizado.`;
    }

    async function accEliminarEvento(p) {
        const id = parseInt(p.eventoId);
        if (!id) throw new Error('No identifiqué qué evento eliminar');
        const evento = (await obtenerEventos()).find(e => e.id === id);
        if (!evento) throw new Error('Evento no encontrado');
        await eliminarEvento(id);
        if (typeof GCAL !== 'undefined' && GCAL.estaConectado && GCAL.estaConectado() &&
            evento.googleCalEventId && GCAL.hookEliminarEvento) {
            GCAL.hookEliminarEvento(evento.googleCalEventId);
        }
        await refrescarUI();
        await sincronizar();
        toast('Evento eliminado', 'success');
        return `Evento "${evento.titulo}" eliminado.`;
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

        const expediente = {
            juzgado,
            categoria: institucion === 'PJF' ? 'PJF Federal'
                     : institucion === 'OTRO' ? 'Otros/Varios'
                     : (typeof obtenerCategoriaJuzgado === 'function' ? obtenerCategoriaJuzgado(juzgado) : 'OTROS'),
            institucion,
            comentario: p.comentario || undefined
        };
        if (p.tipoRegistro === 'nombre') expediente.nombre = p.valor;
        else expediente.numero = p.valor;

        await agregarExpediente(expediente);
        await refrescarUI();
        await sincronizar();
        toast('Expediente agregado', 'success');
        return `Expediente ${p.valor} (${institucion}) agregado en ${juzgado}.`;
    }

    async function accEditarExpediente(p) {
        const id = parseInt(p.expedienteId);
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

        await actualizarExpediente(id, cambios);
        await refrescarUI();
        await sincronizar();
        toast('Expediente actualizado', 'success');
        return `Expediente ${exp.numero || exp.nombre} actualizado.`;
    }

    async function accArchivarExpediente(p) {
        const id = parseInt(p.expedienteId);
        if (!id) throw new Error('No identifiqué qué expediente archivar');
        const exp = await obtenerExpediente(id);
        if (!exp) throw new Error('Expediente no encontrado');
        await archivarExpedienteDB(id, true, p.motivo || 'concluido', '');
        await refrescarUI();
        await sincronizar();
        toast('Expediente archivado', 'success');
        return `Expediente ${exp.numero || exp.nombre} archivado (${p.motivo || 'concluido'}).`;
    }

    async function accCrearNota(p) {
        if (!p.titulo) throw new Error('Falta el título de la nota');
        const nota = {
            expedienteId: p.expedienteId != null ? parseInt(p.expedienteId) : null,
            expedienteTexto: p.expedienteTexto || null,
            titulo: p.titulo,
            contenido: p.contenido || '',
            color: '#fff3cd',
            recordatorio: null
        };
        await agregarNota(nota);
        await refrescarUI();
        await sincronizar();
        toast('Nota creada', 'success');
        return `Nota "${p.titulo}" creada.`;
    }

    async function accBuscarLocal(p) {
        const consulta = normalizar(p.consulta || '');
        if (!consulta) throw new Error('¿Qué expediente busco?');
        const activos = await obtenerExpedientes();
        const archivados = await obtenerExpedientesArchivados().catch(() => []);
        const todos = activos.map(e => ({ ...e, _arch: false }))
            .concat(archivados.map(e => ({ ...e, _arch: true })));

        const tokens = consulta.split(/\s+/).filter(Boolean);
        const resultados = todos.filter(e => {
            const blob = normalizar([e.numero, e.nombre, e.juzgado, e.categoria, e.comentario, e.institucion].join(' '));
            return tokens.every(t => blob.includes(t));
        });

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
            bVer.textContent = '📁 Ver lista';
            bVer.addEventListener('click', () => {
                if (typeof navegarA === 'function') navegarA('expedientes');
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
        let exp = null;
        if (p.expedienteId != null) exp = await obtenerExpediente(parseInt(p.expedienteId));
        const numero = (exp && exp.numero) || p.numero || '';

        if (exp && exp.pjfOrgId && exp.pjfTipoAsunto && typeof construirURLPJF === 'function') {
            const url = construirURLPJF(exp.pjfOrgId, exp.pjfTipoAsunto, numero, 0);
            window.open(url, 'pjf_expediente', 'width=1024,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no');
            return `Abrí la consulta del expediente ${numero} en el portal del PJF.`;
        }

        // Sin organismo guardado: llevar a la página PJF con el número precargado
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
        const paginas = ['inicio', 'expedientes', 'calendario', 'notas', 'busqueda', 'pjf', 'impi', 'config'];
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
        let catalogo = [];
        try {
            const activos = await obtenerExpedientes();
            catalogo = activos.slice(0, 200).map(e => ({
                id: e.id,
                numero: e.numero || null,
                nombre: e.nombre || null,
                institucion: e.institucion || 'TSJ',
                juzgado: e.juzgado || '',
                tienePJF: !!(e.pjfOrgId && e.pjfTipoAsunto),
                comentario: (e.comentario || '').slice(0, 60) || undefined
            }));
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

CATÁLOGO DE EXPEDIENTES DEL USUARIO (id, número/nombre, institución, juzgado):
${JSON.stringify(catalogo)}

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

1. "crear_evento": {titulo, tipo:"audiencia"|"vencimiento"|"recordatorio"|"otro", fecha:"YYYY-MM-DD", hora:"HH:MM" o null, todoElDia:bool, expedienteId:número o null, expedienteTexto:texto o null, descripcion:""}
   - Si menciona un expediente, resuélvelo contra el catálogo y usa su id en expedienteId. Si no está en el catálogo, pon el texto en expedienteTexto.
   - Si no dice hora → todoElDia=true. Obligatorios: titulo y fecha.
2. "editar_evento": {eventoId:número, cambios:{titulo?, tipo?, fecha?:"YYYY-MM-DD", hora?:"HH:MM", todoElDia?, descripcion?}}
   - Resuelve el evento contra la lista de EVENTOS. Si hay varios candidatos, pregunta cuál.
3. "eliminar_evento": {eventoId:número}
4. "consultar_agenda": {fechaInicio:"YYYY-MM-DD", fechaFin:"YYYY-MM-DD"} — para "¿qué tengo esta semana?", "audiencias de mañana", etc.
5. "crear_expediente": {tipoRegistro:"numero"|"nombre", valor, institucion:"TSJ"|"PJF"|"OTRO", juzgado, comentario}
   - Para TSJ el juzgado es OBLIGATORIO y debe ser un nombre EXACTO de la lista de juzgados. Si el usuario no lo dice o no coincide, pregunta.
6. "editar_expediente": {expedienteId:número, cambios:{numero?, nombre?, juzgado?, comentario?, institucion?}}
   - Resuelve el expediente contra el catálogo (por número tipo 123/2025 o por nombre de las partes). Si hay ambigüedad, pregunta.
7. "archivar_expediente": {expedienteId:número, motivo:"concluido"|"suspendido"|"otro"}
8. "crear_nota": {titulo, contenido, expedienteId:número o null, expedienteTexto o null}
9. "buscar_local": {consulta} — buscar en el catálogo local del usuario ("busca mis expedientes de divorcio", "¿tengo algo de Juan Pérez?").
10. "buscar_tsj": {valor, tipoBusqueda:"numero"|"nombre", juzgado:nombre exacto de la lista o null, ambito:"todos"|"primera"|"segunda" o null}
    - Busca en los estrados en línea del TSJ Quintana Roo. Si el usuario menciona un expediente de su catálogo, usa el juzgado guardado de ese expediente. Si no especifica juzgado, deja juzgado=null y usa ambito (default "todos"; abre muchas ventanas).
11. "buscar_pjf": {expedienteId:número o null, numero:texto o null} — consulta en el portal del Poder Judicial de la Federación. Si el expediente está en el catálogo con tienePJF=true, usa su id.
12. "navegar": {pagina:"inicio"|"expedientes"|"calendario"|"notas"|"busqueda"|"pjf"|"impi"|"config"}
13. "responder": para preguntas generales, saludos o cuando ninguna acción aplica. Usa el campo "respuesta".

REGLAS:
- Si falta un dato OBLIGATORIO para la acción: faltan_datos=true y "pregunta" con UNA pregunta corta y específica. Conserva en "parametros" todo lo que ya sepas.
- En turnos siguientes el usuario responderá tu pregunta: integra su respuesta y devuelve la acción COMPLETA actualizada (con todos los parámetros acumulados).
- Si la referencia a un expediente o evento es ambigua (varios candidatos), pregunta cuál, listando las opciones brevemente en la pregunta.
- "resumen" siempre en español, específico y corto (ej: 'Agendar audiencia del exp. 123/2025 el jueves 30 de julio a las 10:00').
- Números de expediente suelen dictarse como "123 diagonal 2025" o "123 barra 2025" → normaliza a "123/2025".
- Nunca inventes ids de expedientes o eventos: solo usa los del catálogo/agenda.`;
    }

    async function llamarGroq(sistema, historial) {
        const apiKey = await obtenerApiKey();
        const modelo = (await obtenerConfig('groq_model').catch(() => null)) || MODELO_DEFAULT;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.VOZ = { abrir: abrirPanel, cerrar: cerrarPanel };
})();
