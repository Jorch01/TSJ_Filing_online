// ==================== GOOGLE CALENDAR SYNC ====================
// Sincronización automática de eventos con Google Calendar.
//
// CONFIGURACIÓN NECESARIA (una sola vez):
//   1. Ir a https://console.cloud.google.com
//   2. Crear un proyecto → Habilitar "Google Calendar API"
//   3. Credenciales → Crear ID de cliente OAuth 2.0 (Aplicación web)
//   4. Añadir tu dominio a "Orígenes de JavaScript autorizados"
//   5. Copiar el Client ID y pegarlo en Configuración → Google Calendar
//
// Una vez configurado, los eventos se crean / actualizan / eliminan
// automáticamente en tu Google Calendar cuando cambias en la app.

const GCAL = (() => {
    'use strict';

    const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
    const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const STORE_KEY = 'gcal_client_id';
    const TOKEN_KEY = 'gcal_token';

    let _token = null;          // { access_token, expiry_ms }
    let _tokenClient = null;    // Google Identity Services token client
    let _gsiLoaded = false;

    // ── Config ──────────────────────────────────────────────────────────────

    function getClientId() {
        return localStorage.getItem(STORE_KEY) || '';
    }

    function setClientId(id) {
        localStorage.setItem(STORE_KEY, id.trim());
    }

    function estaConfigurado() {
        return !!getClientId();
    }

    function estaConectado() {
        return !!_token && Date.now() < _token.expiry_ms;
    }

    // ── Google Identity Services ─────────────────────────────────────────────

    function cargarGSI() {
        if (_gsiLoaded || document.getElementById('gsi-script')) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.id = 'gsi-script';
            s.src = 'https://accounts.google.com/gsi/client';
            s.async = true;
            s.onload = () => { _gsiLoaded = true; resolve(); };
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    async function obtenerToken() {
        if (estaConectado()) return _token.access_token;
        if (!estaConfigurado()) throw new Error('Google Calendar no configurado. Ingresa tu Client ID en Configuración.');

        await cargarGSI();

        return new Promise((resolve, reject) => {
            if (!window.google?.accounts?.oauth2) {
                reject(new Error('No se pudo cargar Google Identity Services.'));
                return;
            }
            _tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: getClientId(),
                scope: SCOPE,
                callback: (resp) => {
                    if (resp.error) { reject(new Error(resp.error)); return; }
                    _token = {
                        access_token: resp.access_token,
                        expiry_ms: Date.now() + (resp.expires_in - 60) * 1000
                    };
                    resolve(_token.access_token);
                }
            });
            _tokenClient.requestAccessToken({ prompt: '' });
        });
    }

    // ── Formato de evento ────────────────────────────────────────────────────

    function appEventoAGCal(evento) {
        const inicio = new Date(evento.fechaInicio);
        const fin = new Date(inicio.getTime() + 60 * 60 * 1000); // +1h por defecto

        let start, end;
        if (evento.todoElDia) {
            const fechaStr = inicio.toISOString().substring(0, 10);
            start = { date: fechaStr };
            end = { date: fechaStr };
        } else {
            start = { dateTime: inicio.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
            end = { dateTime: fin.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
        }

        const descripcionBase = evento.descripcion || '';
        const expTexto = evento.expedienteTexto || '';
        const descripcion = [descripcionBase, expTexto ? `Expediente: ${expTexto}` : ''].filter(Boolean).join('\n');

        return {
            summary: evento.titulo,
            description: descripcion || undefined,
            start,
            end,
            source: { title: 'TSJ Filing', url: location.origin }
        };
    }

    // ── API calls ────────────────────────────────────────────────────────────

    async function apiCall(method, url, body) {
        const token = await obtenerToken();
        const opts = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        if (body) opts.body = JSON.stringify(body);
        const resp = await fetch(url, opts);
        if (resp.status === 204) return null;
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error?.message || `Error ${resp.status}`);
        return json;
    }

    // ── Sincronización ───────────────────────────────────────────────────────

    async function sincronizarEvento(evento) {
        if (!estaConfigurado()) return;
        try {
            const gcalEvento = appEventoAGCal(evento);
            let gcalId = evento.googleCalEventId;
            let resultado;

            if (gcalId) {
                // Actualizar evento existente
                resultado = await apiCall('PUT', `${API_BASE}/${gcalId}`, gcalEvento).catch(async (err) => {
                    // Si el evento ya no existe en GCal, crearlo de nuevo
                    if (err.message.includes('404') || err.message.includes('Not Found')) {
                        return apiCall('POST', API_BASE, gcalEvento);
                    }
                    throw err;
                });
            } else {
                // Crear nuevo evento
                resultado = await apiCall('POST', API_BASE, gcalEvento);
            }

            if (resultado?.id) {
                // Persistir el Google Calendar event ID en el evento local
                const { actualizarEvento, obtenerEvento } = window;
                if (typeof actualizarEvento === 'function' && evento.id) {
                    const eventoActual = typeof obtenerEvento === 'function'
                        ? await obtenerEvento(evento.id).catch(() => null)
                        : null;
                    if (eventoActual) {
                        await actualizarEvento(evento.id, {
                            ...eventoActual,
                            googleCalEventId: resultado.id
                        });
                    }
                }
            }
        } catch (err) {
            console.warn('[GCal] No se pudo sincronizar evento:', err.message);
            // No lanzar: el error de GCal no debe romper el flujo de la app
        }
    }

    async function eliminarEventoGCal(gcalEventId) {
        if (!estaConfigurado() || !gcalEventId) return;
        try {
            await apiCall('DELETE', `${API_BASE}/${gcalEventId}`);
        } catch (err) {
            console.warn('[GCal] No se pudo eliminar evento de Google Calendar:', err.message);
        }
    }

    // ── URL para agregar manualmente (sin OAuth) ─────────────────────────────

    function urlAgregarGCal(evento) {
        const inicio = new Date(evento.fechaInicio);
        const fin = new Date(inicio.getTime() + 60 * 60 * 1000);
        const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const dates = evento.todoElDia
            ? inicio.toISOString().substring(0, 10).replace(/-/g, '') + '/' + inicio.toISOString().substring(0, 10).replace(/-/g, '')
            : `${fmt(inicio)}/${fmt(fin)}`;
        const params = new URLSearchParams({
            text: evento.titulo || '',
            dates,
            details: evento.descripcion || '',
            ctz: Intl.DateTimeFormat().resolvedOptions().timeZone
        });
        return `https://calendar.google.com/calendar/r/eventedit?${params}`;
    }

    // ── Exportar .ics ────────────────────────────────────────────────────────

    function eventoAICS(evento) {
        const uid = `tsj-${evento.id || Date.now()}@tsjfiling`;
        const ahora = new Date().toISOString().replace(/[-:.]/g, '').substring(0, 15) + 'Z';
        const inicio = new Date(evento.fechaInicio);
        const fin = new Date(inicio.getTime() + 60 * 60 * 1000);

        const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const fmtFecha = (d) => d.toISOString().substring(0, 10).replace(/-/g, '');

        const icsEsc = (s) => (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

        if (evento.todoElDia) {
            return [
                'BEGIN:VEVENT',
                `UID:${uid}`,
                `DTSTAMP:${ahora}`,
                `DTSTART;VALUE=DATE:${fmtFecha(inicio)}`,
                `DTEND;VALUE=DATE:${fmtFecha(inicio)}`,
                `SUMMARY:${icsEsc(evento.titulo)}`,
                evento.descripcion ? `DESCRIPTION:${icsEsc(evento.descripcion)}` : '',
                'END:VEVENT'
            ].filter(Boolean).join('\r\n');
        }

        return [
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${ahora}`,
            `DTSTART:${fmt(inicio)}`,
            `DTEND:${fmt(fin)}`,
            `SUMMARY:${icsEsc(evento.titulo)}`,
            evento.descripcion ? `DESCRIPTION:${icsEsc(evento.descripcion)}` : '',
            'END:VEVENT'
        ].filter(Boolean).join('\r\n');
    }

    async function exportarICS() {
        try {
            const eventos = await obtenerEventos();
            if (eventos.length === 0) {
                mostrarToast('No hay eventos para exportar', 'info');
                return;
            }

            const lineas = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//TSJ Filing//ES',
                'CALSCALE:GREGORIAN',
                'METHOD:PUBLISH',
                ...eventos.map(ev => eventoAICS(ev)),
                'END:VCALENDAR'
            ];

            const blob = new Blob([lineas.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `TSJ-Filing-eventos-${new Date().toISOString().substring(0, 10)}.ics`;
            a.click();
            URL.revokeObjectURL(url);
            mostrarToast(`${eventos.length} evento(s) exportados`, 'success');
        } catch (err) {
            mostrarToast('Error al exportar: ' + err.message, 'error');
        }
    }

    // ── UI: modal de configuración ───────────────────────────────────────────

    function mostrarConfigGCal() {
        const clientId = getClientId();
        const conectado = estaConectado();

        document.getElementById('modal-titulo').textContent = '📅 Sincronización con Google Calendar';
        document.getElementById('modal-body').innerHTML = `
            <div style="display:flex;flex-direction:column;gap:1.2rem;">
                <div class="gcal-status ${conectado ? 'gcal-ok' : clientId ? 'gcal-warn' : 'gcal-off'}">
                    ${conectado ? '🟢 Conectado a Google Calendar' : clientId ? '🟡 Client ID configurado — haz clic en Conectar' : '⚪ No configurado'}
                </div>

                <div>
                    <label style="font-weight:600;display:block;margin-bottom:0.4rem">
                        Google OAuth Client ID
                    </label>
                    <input id="gcal-client-id-input" type="text"
                           class="form-control"
                           placeholder="xxxx.apps.googleusercontent.com"
                           value="${clientId}"
                           style="width:100%;font-size:0.85rem">
                    <p style="font-size:0.8rem;color:var(--text-secondary,#6c757d);margin-top:0.4rem">
                        Necesitas un proyecto en <a href="https://console.cloud.google.com" target="_blank" rel="noopener">Google Cloud Console</a>
                        con la API de Calendar habilitada y un Client ID OAuth 2.0 (Aplicación web).
                        Añade <strong>${location.origin}</strong> como origen autorizado.
                    </p>
                </div>

                <div style="display:flex;flex-direction:column;gap:0.8rem">
                    <p style="font-weight:600;margin:0">Exportar sin configuración OAuth:</p>
                    <button class="btn btn-secondary" onclick="GCAL.exportarICS()">
                        📥 Descargar todos los eventos como .ics
                    </button>
                    <p style="font-size:0.8rem;color:var(--text-secondary,#6c757d);margin:0">
                        El archivo .ics se puede importar en Google Calendar, Apple Calendar, Outlook, etc.
                        Para <strong>sincronización automática</strong> configura el Client ID arriba.
                    </p>
                </div>
            </div>
        `;
        document.getElementById('modal-footer').innerHTML = `
            <button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>
            <button class="btn btn-primary" onclick="GCAL._guardarYConectar()">
                ${conectado ? '🔄 Reconectar' : '🔗 Guardar y Conectar'}
            </button>
        `;
        document.getElementById('modal-overlay').classList.add('active');
    }

    async function _guardarYConectar() {
        const input = document.getElementById('gcal-client-id-input');
        if (!input) return;
        const nuevoId = input.value.trim();
        if (!nuevoId) {
            mostrarToast('Ingresa un Client ID válido', 'error');
            return;
        }
        setClientId(nuevoId);
        _token = null; // forzar re-autenticación
        try {
            await obtenerToken();
            mostrarToast('✅ Conectado a Google Calendar', 'success');
            mostrarConfigGCal(); // refrescar estado en el modal
        } catch (err) {
            mostrarToast('Error al conectar: ' + err.message, 'error');
        }
    }

    // ── Hook: llamar desde guardarEvento / confirmarEliminarEvento ───────────
    // En app.js, después de guardar un evento, llamar:
    //   if (typeof GCAL !== 'undefined') GCAL.hookGuardarEvento(evento);
    // Y antes de eliminar:
    //   if (typeof GCAL !== 'undefined') GCAL.hookEliminarEvento(evento.googleCalEventId);

    async function hookGuardarEvento(evento) {
        if (!estaConfigurado() || !estaConectado()) return;
        await sincronizarEvento(evento);
    }

    async function hookEliminarEvento(gcalEventId) {
        if (!estaConfigurado() || !estaConectado() || !gcalEventId) return;
        await eliminarEventoGCal(gcalEventId);
    }

    // ── Exponer API pública ──────────────────────────────────────────────────
    return {
        estaConfigurado,
        estaConectado,
        obtenerToken,
        sincronizarEvento,
        hookGuardarEvento,
        hookEliminarEvento,
        exportarICS,
        urlAgregarGCal,
        mostrarConfigGCal,
        _guardarYConectar
    };
})();

window.GCAL = GCAL;
