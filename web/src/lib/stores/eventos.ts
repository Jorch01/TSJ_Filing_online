/**
 * Store de Svelte para gestión de eventos/calendario
 */

import { writable, derived, get } from 'svelte/store';
import {
  type Evento,
  agregarEvento as dbAgregarEvento,
  obtenerEventos,
  obtenerEventosExpediente,
  actualizarEvento as dbActualizarEvento,
  eliminarEvento as dbEliminarEvento,
  obtenerEventosConAlertaPendiente,
  marcarAlertaEnviada
} from '$lib/services/database';

// ============== TIPOS ==============

interface EventosState {
  eventos: Evento[];
  eventosPorExpediente: Map<number, Evento[]>;
  cargando: boolean;
  error: string | null;
  eventoEditando: number | null;
  vistaActual: 'mes' | 'semana' | 'dia' | 'lista';
  fechaActual: Date;
}

export type TipoEvento = 'audiencia' | 'vencimiento' | 'recordatorio' | 'otro';

// Colores por tipo de evento
export const COLORES_EVENTOS: Record<TipoEvento, { fondo: string; texto: string; borde: string }> = {
  audiencia: { fondo: '#3788d8', texto: '#ffffff', borde: '#2c6cb0' },
  vencimiento: { fondo: '#dc3545', texto: '#ffffff', borde: '#b02a37' },
  recordatorio: { fondo: '#ffc107', texto: '#212529', borde: '#d39e00' },
  otro: { fondo: '#6c757d', texto: '#ffffff', borde: '#545b62' }
};

// Iconos por tipo de evento
export const ICONOS_EVENTOS: Record<TipoEvento, string> = {
  audiencia: '⚖️',
  vencimiento: '⚠️',
  recordatorio: '🔔',
  otro: '📌'
};

// ============== STORE ==============

function crearEventosStore() {
  const { subscribe, set, update } = writable<EventosState>({
    eventos: [],
    eventosPorExpediente: new Map(),
    cargando: false,
    error: null,
    eventoEditando: null,
    vistaActual: 'mes',
    fechaActual: new Date()
  });

  return {
    subscribe,

    // Cargar todos los eventos
    async cargarTodos() {
      update(state => ({ ...state, cargando: true, error: null }));
      try {
        const eventos = await obtenerEventos();
        update(state => ({ ...state, eventos, cargando: false }));
      } catch (error) {
        update(state => ({
          ...state,
          cargando: false,
          error: `Error al cargar eventos: ${error}`
        }));
      }
    },

    // Cargar eventos de un rango de fechas
    async cargarPorRango(fechaInicio: Date, fechaFin: Date) {
      update(state => ({ ...state, cargando: true }));
      try {
        const eventos = await obtenerEventos(fechaInicio, fechaFin);
        update(state => ({ ...state, eventos, cargando: false }));
      } catch (error) {
        update(state => ({ ...state, cargando: false }));
        console.error('Error al cargar eventos por rango:', error);
      }
    },

    // Cargar eventos de un expediente
    async cargarPorExpediente(expedienteId: number) {
      update(state => ({ ...state, cargando: true }));
      try {
        const eventos = await obtenerEventosExpediente(expedienteId);
        update(state => {
          const nuevos = new Map(state.eventosPorExpediente);
          nuevos.set(expedienteId, eventos);
          return { ...state, eventosPorExpediente: nuevos, cargando: false };
        });
      } catch (error) {
        update(state => ({ ...state, cargando: false }));
        console.error('Error al cargar eventos del expediente:', error);
      }
    },

    // Agregar nuevo evento
    async agregar(datos: Omit<Evento, 'id' | 'alertaEnviada'>): Promise<{ exito: boolean; mensaje: string; id?: number }> {
      try {
        const id = await dbAgregarEvento(datos);

        if (datos.expedienteId) {
          await this.cargarPorExpediente(datos.expedienteId);
        }
        await this.cargarTodos();

        return { exito: true, mensaje: 'Evento creado correctamente', id };
      } catch (error) {
        return { exito: false, mensaje: `Error al crear evento: ${error}` };
      }
    },

    // Actualizar evento
    async actualizar(id: number, cambios: Partial<Evento>): Promise<boolean> {
      try {
        await dbActualizarEvento(id, cambios);

        const state = get({ subscribe });
        const evento = state.eventos.find(e => e.id === id);
        if (evento?.expedienteId) {
          await this.cargarPorExpediente(evento.expedienteId);
        }
        await this.cargarTodos();

        return true;
      } catch (error) {
        console.error('Error al actualizar evento:', error);
        return false;
      }
    },

    // Eliminar evento
    async eliminar(id: number): Promise<boolean> {
      try {
        const state = get({ subscribe });
        const evento = state.eventos.find(e => e.id === id);

        await dbEliminarEvento(id);

        if (evento?.expedienteId) {
          await this.cargarPorExpediente(evento.expedienteId);
        }
        await this.cargarTodos();

        return true;
      } catch (error) {
        console.error('Error al eliminar evento:', error);
        return false;
      }
    },

    // Establecer evento en edición
    editando(id: number | null) {
      update(state => ({ ...state, eventoEditando: id }));
    },

    // Cambiar vista del calendario
    cambiarVista(vista: 'mes' | 'semana' | 'dia' | 'lista') {
      update(state => ({ ...state, vistaActual: vista }));
    },

    // Cambiar fecha actual
    cambiarFecha(fecha: Date) {
      update(state => ({ ...state, fechaActual: fecha }));
    },

    // Navegar mes anterior
    mesAnterior() {
      update(state => {
        const nuevaFecha = new Date(state.fechaActual);
        nuevaFecha.setMonth(nuevaFecha.getMonth() - 1);
        return { ...state, fechaActual: nuevaFecha };
      });
    },

    // Navegar mes siguiente
    mesSiguiente() {
      update(state => {
        const nuevaFecha = new Date(state.fechaActual);
        nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);
        return { ...state, fechaActual: nuevaFecha };
      });
    },

    // Ir a hoy
    irAHoy() {
      update(state => ({ ...state, fechaActual: new Date() }));
    },

    // Obtener eventos con alertas pendientes
    async obtenerAlertasPendientes(): Promise<Evento[]> {
      return await obtenerEventosConAlertaPendiente();
    },

    // Marcar alerta como enviada
    async marcarAlertaComoEnviada(id: number): Promise<void> {
      await marcarAlertaEnviada(id);
      await this.cargarTodos();
    },

    // Obtener eventos de un expediente (sincrónico)
    obtenerPorExpediente(expedienteId: number): Evento[] {
      const state = get({ subscribe });
      return state.eventosPorExpediente.get(expedienteId) || [];
    }
  };
}

// ============== INSTANCIA ==============

export const eventosStore = crearEventosStore();

// ============== STORES DERIVADOS ==============

// Eventos de hoy
export const eventosHoy = derived(
  eventosStore,
  $store => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    return $store.eventos.filter(e => {
      const fechaEvento = new Date(e.fechaInicio);
      return fechaEvento >= hoy && fechaEvento < manana;
    });
  }
);

// Eventos próximos (próximos 7 días)
export const eventosProximos = derived(
  eventosStore,
  $store => {
    const ahora = new Date();
    const enUnaSemana = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);

    return $store.eventos
      .filter(e => {
        const fechaEvento = new Date(e.fechaInicio);
        return fechaEvento >= ahora && fechaEvento <= enUnaSemana;
      })
      .sort((a, b) => new Date(a.fechaInicio).getTime() - new Date(b.fechaInicio).getTime());
  }
);

// Eventos del mes actual
export const eventosDelMes = derived(
  eventosStore,
  $store => {
    const fecha = $store.fechaActual;
    const inicioMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    const finMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0, 23, 59, 59);

    return $store.eventos.filter(e => {
      const fechaEvento = new Date(e.fechaInicio);
      return fechaEvento >= inicioMes && fechaEvento <= finMes;
    });
  }
);

// Contador de eventos por tipo
export const contadorEventosPorTipo = derived(
  eventosStore,
  $store => {
    const contador: Record<TipoEvento, number> = {
      audiencia: 0,
      vencimiento: 0,
      recordatorio: 0,
      otro: 0
    };

    for (const evento of $store.eventos) {
      contador[evento.tipo]++;
    }

    return contador;
  }
);

// Eventos con alertas pendientes que deben mostrarse ahora
export const alertasPendientes = derived(
  eventosStore,
  $store => {
    const ahora = new Date();

    return $store.eventos.filter(e => {
      if (!e.alerta || e.alertaEnviada) return false;

      const fechaEvento = new Date(e.fechaInicio);
      const minutosAntes = e.alertaMinutosAntes || 15;
      const fechaAlerta = new Date(fechaEvento.getTime() - minutosAntes * 60 * 1000);

      return ahora >= fechaAlerta && ahora < fechaEvento;
    });
  }
);

// ============== UTILIDADES ==============

// Obtener eventos de un día específico
export function obtenerEventosDelDia(eventos: Evento[], fecha: Date): Evento[] {
  const inicioDia = new Date(fecha);
  inicioDia.setHours(0, 0, 0, 0);
  const finDia = new Date(fecha);
  finDia.setHours(23, 59, 59, 999);

  return eventos.filter(e => {
    const fechaEvento = new Date(e.fechaInicio);
    return fechaEvento >= inicioDia && fechaEvento <= finDia;
  });
}

// Generar días del mes para el calendario
export function generarDiasDelMes(fecha: Date): { fecha: Date; esDelMes: boolean; esHoy: boolean }[] {
  const dias: { fecha: Date; esDelMes: boolean; esHoy: boolean }[] = [];
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const inicioMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  const finMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);

  // Días del mes anterior para completar la primera semana
  const primerDiaSemana = inicioMes.getDay();
  for (let i = primerDiaSemana - 1; i >= 0; i--) {
    const dia = new Date(inicioMes);
    dia.setDate(dia.getDate() - i - 1);
    dias.push({ fecha: dia, esDelMes: false, esHoy: dia.getTime() === hoy.getTime() });
  }

  // Días del mes actual
  for (let i = 1; i <= finMes.getDate(); i++) {
    const dia = new Date(fecha.getFullYear(), fecha.getMonth(), i);
    dias.push({ fecha: dia, esDelMes: true, esHoy: dia.getTime() === hoy.getTime() });
  }

  // Días del mes siguiente para completar la última semana
  const diasRestantes = 42 - dias.length; // 6 semanas * 7 días
  for (let i = 1; i <= diasRestantes; i++) {
    const dia = new Date(finMes);
    dia.setDate(dia.getDate() + i);
    dias.push({ fecha: dia, esDelMes: false, esHoy: dia.getTime() === hoy.getTime() });
  }

  return dias;
}
