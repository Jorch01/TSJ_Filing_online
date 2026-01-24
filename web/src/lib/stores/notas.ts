/**
 * Store de Svelte para gestión de notas
 */

import { writable, derived, get } from 'svelte/store';
import {
  type Nota,
  agregarNota as dbAgregarNota,
  obtenerNotas,
  obtenerTodasLasNotas,
  actualizarNota as dbActualizarNota,
  eliminarNota as dbEliminarNota,
  obtenerNotasConRecordatorio
} from '$lib/services/database';

// ============== TIPOS ==============

interface NotasState {
  notas: Nota[];
  notasPorExpediente: Map<number, Nota[]>;
  cargando: boolean;
  error: string | null;
  notaEditando: number | null;
}

// Colores disponibles para notas
export const COLORES_NOTAS = [
  { nombre: 'Amarillo', valor: '#fff3cd', texto: '#856404' },
  { nombre: 'Verde', valor: '#d4edda', texto: '#155724' },
  { nombre: 'Azul', valor: '#cce5ff', texto: '#004085' },
  { nombre: 'Rosa', valor: '#f8d7da', texto: '#721c24' },
  { nombre: 'Morado', valor: '#e2d5f1', texto: '#4a235a' },
  { nombre: 'Naranja', valor: '#ffeaa7', texto: '#9c6500' },
  { nombre: 'Gris', valor: '#e2e3e5', texto: '#383d41' },
  { nombre: 'Blanco', valor: '#ffffff', texto: '#212529' }
];

// ============== STORE ==============

function crearNotasStore() {
  const { subscribe, set, update } = writable<NotasState>({
    notas: [],
    notasPorExpediente: new Map(),
    cargando: false,
    error: null,
    notaEditando: null
  });

  return {
    subscribe,

    // Cargar todas las notas
    async cargarTodas() {
      update(state => ({ ...state, cargando: true, error: null }));
      try {
        const notas = await obtenerTodasLasNotas();
        update(state => ({ ...state, notas, cargando: false }));
      } catch (error) {
        update(state => ({
          ...state,
          cargando: false,
          error: `Error al cargar notas: ${error}`
        }));
      }
    },

    // Cargar notas de un expediente específico
    async cargarPorExpediente(expedienteId: number) {
      update(state => ({ ...state, cargando: true }));
      try {
        const notas = await obtenerNotas(expedienteId);
        update(state => {
          const nuevas = new Map(state.notasPorExpediente);
          nuevas.set(expedienteId, notas);
          return { ...state, notasPorExpediente: nuevas, cargando: false };
        });
      } catch (error) {
        update(state => ({ ...state, cargando: false }));
        console.error('Error al cargar notas del expediente:', error);
      }
    },

    // Agregar nueva nota
    async agregar(datos: {
      expedienteId: number;
      titulo: string;
      contenido: string;
      color?: string;
      recordatorio?: Date;
    }): Promise<{ exito: boolean; mensaje: string; id?: number }> {
      try {
        const id = await dbAgregarNota({
          expedienteId: datos.expedienteId,
          titulo: datos.titulo,
          contenido: datos.contenido,
          color: datos.color || COLORES_NOTAS[0].valor,
          recordatorio: datos.recordatorio
        });

        await this.cargarPorExpediente(datos.expedienteId);
        await this.cargarTodas();

        return { exito: true, mensaje: 'Nota creada correctamente', id };
      } catch (error) {
        return { exito: false, mensaje: `Error al crear nota: ${error}` };
      }
    },

    // Actualizar nota
    async actualizar(id: number, cambios: Partial<Nota>): Promise<boolean> {
      try {
        await dbActualizarNota(id, cambios);

        // Obtener la nota para saber a qué expediente pertenece
        const state = get({ subscribe });
        const nota = state.notas.find(n => n.id === id);
        if (nota) {
          await this.cargarPorExpediente(nota.expedienteId);
        }
        await this.cargarTodas();

        return true;
      } catch (error) {
        console.error('Error al actualizar nota:', error);
        return false;
      }
    },

    // Eliminar nota
    async eliminar(id: number): Promise<boolean> {
      try {
        // Obtener la nota antes de eliminar
        const state = get({ subscribe });
        const nota = state.notas.find(n => n.id === id);

        await dbEliminarNota(id);

        if (nota) {
          await this.cargarPorExpediente(nota.expedienteId);
        }
        await this.cargarTodas();

        return true;
      } catch (error) {
        console.error('Error al eliminar nota:', error);
        return false;
      }
    },

    // Establecer nota en edición
    editando(id: number | null) {
      update(state => ({ ...state, notaEditando: id }));
    },

    // Obtener notas de un expediente (sincrónico)
    obtenerPorExpediente(expedienteId: number): Nota[] {
      const state = get({ subscribe });
      return state.notasPorExpediente.get(expedienteId) || [];
    },

    // Obtener notas con recordatorios pendientes
    async obtenerConRecordatorios(): Promise<Nota[]> {
      return await obtenerNotasConRecordatorio();
    }
  };
}

// ============== INSTANCIA ==============

export const notasStore = crearNotasStore();

// ============== STORES DERIVADOS ==============

// Notas recientes (últimas 5)
export const notasRecientes = derived(
  notasStore,
  $store => $store.notas.slice(0, 5)
);

// Total de notas
export const totalNotas = derived(
  notasStore,
  $store => $store.notas.length
);

// Notas con recordatorio próximo (próximos 7 días)
export const notasConRecordatorioProximo = derived(
  notasStore,
  $store => {
    const ahora = new Date();
    const enUnaSemana = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);
    return $store.notas.filter(n =>
      n.recordatorio &&
      new Date(n.recordatorio) >= ahora &&
      new Date(n.recordatorio) <= enUnaSemana &&
      !n.recordatorioEnviado
    );
  }
);
