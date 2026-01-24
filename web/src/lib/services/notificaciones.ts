/**
 * Servicio de Notificaciones Web
 * Gestiona notificaciones del navegador y alertas
 */

import { obtenerConfiguracion, guardarConfiguracion } from './database';

// ============== TIPOS ==============

export interface NotificacionOpciones {
  titulo: string;
  cuerpo: string;
  icono?: string;
  tag?: string;
  requireInteraction?: boolean;
  actions?: { action: string; title: string }[];
  data?: Record<string, unknown>;
}

// ============== ESTADO ==============

let permisoConcedido = false;
let intervalosActivos: number[] = [];

// ============== FUNCIONES PRINCIPALES ==============

/**
 * Verifica si las notificaciones están soportadas
 */
export function notificacionesSoportadas(): boolean {
  return 'Notification' in window;
}

/**
 * Obtiene el estado actual del permiso de notificaciones
 */
export function obtenerEstadoPermiso(): NotificationPermission | 'no-soportado' {
  if (!notificacionesSoportadas()) return 'no-soportado';
  return Notification.permission;
}

/**
 * Solicita permiso para mostrar notificaciones
 */
export async function solicitarPermiso(): Promise<boolean> {
  if (!notificacionesSoportadas()) {
    console.warn('Notificaciones no soportadas en este navegador');
    return false;
  }

  if (Notification.permission === 'granted') {
    permisoConcedido = true;
    return true;
  }

  if (Notification.permission === 'denied') {
    console.warn('El usuario ha denegado las notificaciones');
    return false;
  }

  try {
    const permiso = await Notification.requestPermission();
    permisoConcedido = permiso === 'granted';
    return permisoConcedido;
  } catch (error) {
    console.error('Error al solicitar permiso de notificaciones:', error);
    return false;
  }
}

/**
 * Muestra una notificación
 */
export async function mostrarNotificacion(opciones: NotificacionOpciones): Promise<Notification | null> {
  if (!notificacionesSoportadas()) {
    console.warn('Notificaciones no soportadas');
    return null;
  }

  if (Notification.permission !== 'granted') {
    const concedido = await solicitarPermiso();
    if (!concedido) return null;
  }

  try {
    const notificacion = new Notification(opciones.titulo, {
      body: opciones.cuerpo,
      icon: opciones.icono || '/favicon.png',
      tag: opciones.tag,
      requireInteraction: opciones.requireInteraction || false,
      data: opciones.data
    });

    // Cerrar automáticamente después de 10 segundos si no requiere interacción
    if (!opciones.requireInteraction) {
      setTimeout(() => notificacion.close(), 10000);
    }

    return notificacion;
  } catch (error) {
    console.error('Error al mostrar notificación:', error);
    return null;
  }
}

/**
 * Notificación para nuevo acuerdo/publicación
 */
export async function notificarNuevoAcuerdo(
  expediente: string,
  juzgado: string,
  documento: string
): Promise<Notification | null> {
  return mostrarNotificacion({
    titulo: '📋 Nuevo Acuerdo Publicado',
    cuerpo: `Expediente ${expediente}\n${juzgado}\n${documento}`,
    tag: `acuerdo-${expediente}`,
    requireInteraction: true
  });
}

/**
 * Notificación para evento próximo
 */
export async function notificarEventoProximo(
  titulo: string,
  descripcion: string,
  minutosRestantes: number
): Promise<Notification | null> {
  const tiempo = minutosRestantes <= 60
    ? `${minutosRestantes} minutos`
    : `${Math.round(minutosRestantes / 60)} horas`;

  return mostrarNotificacion({
    titulo: `⏰ Evento en ${tiempo}`,
    cuerpo: `${titulo}\n${descripcion}`,
    tag: `evento-${titulo}`,
    requireInteraction: true
  });
}

/**
 * Notificación para recordatorio de nota
 */
export async function notificarRecordatorioNota(
  titulo: string,
  contenido: string,
  expediente: string
): Promise<Notification | null> {
  return mostrarNotificacion({
    titulo: '📝 Recordatorio',
    cuerpo: `${titulo}\n${contenido}\nExpediente: ${expediente}`,
    tag: `nota-${titulo}`,
    requireInteraction: true
  });
}

// ============== SISTEMA DE ALERTAS ==============

interface AlertaCallback {
  id: string;
  fechaActivacion: Date;
  callback: () => void;
  ejecutada: boolean;
}

const alertasProgramadas: Map<string, AlertaCallback> = new Map();

/**
 * Programa una alerta para una fecha específica
 */
export function programarAlerta(
  id: string,
  fecha: Date,
  callback: () => void
): void {
  // Cancelar alerta existente con el mismo ID
  cancelarAlerta(id);

  const ahora = new Date();
  const tiempoRestante = fecha.getTime() - ahora.getTime();

  if (tiempoRestante <= 0) {
    // La fecha ya pasó, ejecutar inmediatamente
    callback();
    return;
  }

  alertasProgramadas.set(id, {
    id,
    fechaActivacion: fecha,
    callback,
    ejecutada: false
  });

  // Programar el timeout
  const timeoutId = window.setTimeout(() => {
    const alerta = alertasProgramadas.get(id);
    if (alerta && !alerta.ejecutada) {
      alerta.ejecutada = true;
      alerta.callback();
      alertasProgramadas.delete(id);
    }
  }, tiempoRestante);

  intervalosActivos.push(timeoutId);
}

/**
 * Cancela una alerta programada
 */
export function cancelarAlerta(id: string): void {
  alertasProgramadas.delete(id);
}

/**
 * Cancela todas las alertas
 */
export function cancelarTodasLasAlertas(): void {
  alertasProgramadas.clear();
  intervalosActivos.forEach(id => window.clearTimeout(id));
  intervalosActivos = [];
}

/**
 * Obtiene las alertas programadas
 */
export function obtenerAlertasProgramadas(): AlertaCallback[] {
  return Array.from(alertasProgramadas.values());
}

// ============== SONIDOS DE ALERTA ==============

let audioContext: AudioContext | null = null;

/**
 * Inicializa el contexto de audio
 */
function inicializarAudio(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioContext;
}

/**
 * Reproduce un sonido de alerta
 */
export function reproducirSonidoAlerta(tipo: 'notificacion' | 'alerta' | 'urgente' = 'notificacion'): void {
  try {
    const ctx = inicializarAudio();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Diferentes tonos según el tipo
    switch (tipo) {
      case 'urgente':
        oscillator.frequency.value = 880; // La5
        oscillator.type = 'square';
        break;
      case 'alerta':
        oscillator.frequency.value = 660; // Mi5
        oscillator.type = 'triangle';
        break;
      default:
        oscillator.frequency.value = 440; // La4
        oscillator.type = 'sine';
    }

    gainNode.gain.value = 0.3;
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.5);
  } catch (error) {
    console.warn('No se pudo reproducir el sonido:', error);
  }
}

// ============== CONFIGURACIÓN ==============

/**
 * Guarda la preferencia de notificaciones del usuario
 */
export async function guardarPreferenciaNotificaciones(activadas: boolean): Promise<void> {
  await guardarConfiguracion('notificaciones_activadas', activadas ? 'true' : 'false');
}

/**
 * Obtiene la preferencia de notificaciones del usuario
 */
export async function obtenerPreferenciaNotificaciones(): Promise<boolean> {
  const valor = await obtenerConfiguracion('notificaciones_activadas');
  return valor === 'true';
}

/**
 * Guarda la preferencia de sonido
 */
export async function guardarPreferenciaSonido(activado: boolean): Promise<void> {
  await guardarConfiguracion('sonido_activado', activado ? 'true' : 'false');
}

/**
 * Obtiene la preferencia de sonido
 */
export async function obtenerPreferenciaSonido(): Promise<boolean> {
  const valor = await obtenerConfiguracion('sonido_activado');
  return valor !== 'false'; // Por defecto activado
}

// ============== VIBRACIÓN ==============

/**
 * Vibra el dispositivo (si está soportado)
 */
export function vibrar(patron: number | number[] = 200): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(patron);
  }
}

/**
 * Vibra con patrón de alerta
 */
export function vibrarAlerta(): void {
  vibrar([100, 50, 100, 50, 200]);
}
