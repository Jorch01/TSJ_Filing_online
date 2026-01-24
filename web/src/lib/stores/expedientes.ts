/**
 * Store de Svelte para gestión de expedientes
 */

import { writable, derived, get } from 'svelte/store';
import {
  type Expediente,
  type Publicacion,
  agregarExpediente as dbAgregarExpediente,
  obtenerExpedientes,
  obtenerExpediente,
  actualizarExpediente as dbActualizarExpediente,
  eliminarExpediente as dbEliminarExpediente,
  buscarExpedienteDuplicado,
  obtenerPublicaciones,
  agregarPublicaciones as dbAgregarPublicaciones
} from '$lib/services/database';
import { obtenerIdJuzgado, esSalaSegundaInstancia, obtenerCategoriaJuzgado } from '$lib/data/juzgados';

// ============== TIPOS ==============

interface ExpedientesState {
  expedientes: Expediente[];
  cargando: boolean;
  error: string | null;
  expedienteSeleccionado: number | null;
}

interface PublicacionesState {
  publicaciones: Map<number, Publicacion[]>;
  cargando: boolean;
}

// ============== STORES ==============

function crearExpedientesStore() {
  const { subscribe, set, update } = writable<ExpedientesState>({
    expedientes: [],
    cargando: false,
    error: null,
    expedienteSeleccionado: null
  });

  return {
    subscribe,

    // Cargar expedientes desde IndexedDB
    async cargar() {
      update(state => ({ ...state, cargando: true, error: null }));
      try {
        const expedientes = await obtenerExpedientes(true);
        update(state => ({ ...state, expedientes, cargando: false }));
      } catch (error) {
        update(state => ({
          ...state,
          cargando: false,
          error: `Error al cargar expedientes: ${error}`
        }));
      }
    },

    // Agregar nuevo expediente
    async agregar(datos: {
      numero?: string;
      nombre?: string;
      juzgado: string;
      comentario?: string;
    }): Promise<{ exito: boolean; mensaje: string; id?: number }> {
      const juzgadoId = obtenerIdJuzgado(datos.juzgado);
      if (!juzgadoId) {
        return { exito: false, mensaje: 'Juzgado no válido' };
      }

      // Verificar duplicado
      const duplicado = await buscarExpedienteDuplicado(
        datos.numero,
        datos.nombre,
        juzgadoId
      );
      if (duplicado) {
        return { exito: false, mensaje: 'Este expediente ya existe' };
      }

      try {
        const id = await dbAgregarExpediente({
          numero: datos.numero,
          nombre: datos.nombre,
          juzgado: datos.juzgado,
          juzgadoId,
          comentario: datos.comentario,
          categoria: obtenerCategoriaJuzgado(datos.juzgado),
          activo: true
        });

        // Recargar expedientes
        await this.cargar();

        return { exito: true, mensaje: 'Expediente agregado correctamente', id };
      } catch (error) {
        return { exito: false, mensaje: `Error al agregar: ${error}` };
      }
    },

    // Actualizar expediente
    async actualizar(id: number, cambios: Partial<Expediente>): Promise<boolean> {
      try {
        await dbActualizarExpediente(id, cambios);
        await this.cargar();
        return true;
      } catch (error) {
        console.error('Error al actualizar expediente:', error);
        return false;
      }
    },

    // Eliminar expediente
    async eliminar(id: number, permanente = false): Promise<boolean> {
      try {
        await dbEliminarExpediente(id, permanente);
        await this.cargar();
        return true;
      } catch (error) {
        console.error('Error al eliminar expediente:', error);
        return false;
      }
    },

    // Seleccionar expediente
    seleccionar(id: number | null) {
      update(state => ({ ...state, expedienteSeleccionado: id }));
    },

    // Limpiar todos los expedientes (soft delete)
    async limpiarTodos(): Promise<boolean> {
      try {
        const state = get({ subscribe });
        for (const exp of state.expedientes) {
          if (exp.id) await dbEliminarExpediente(exp.id, false);
        }
        await this.cargar();
        return true;
      } catch (error) {
        console.error('Error al limpiar expedientes:', error);
        return false;
      }
    }
  };
}

function crearPublicacionesStore() {
  const { subscribe, set, update } = writable<PublicacionesState>({
    publicaciones: new Map(),
    cargando: false
  });

  return {
    subscribe,

    // Cargar publicaciones de un expediente
    async cargar(expedienteId: number) {
      update(state => ({ ...state, cargando: true }));
      try {
        const pubs = await obtenerPublicaciones(expedienteId);
        update(state => {
          const nuevas = new Map(state.publicaciones);
          nuevas.set(expedienteId, pubs);
          return { ...state, publicaciones: nuevas, cargando: false };
        });
      } catch (error) {
        console.error('Error al cargar publicaciones:', error);
        update(state => ({ ...state, cargando: false }));
      }
    },

    // Agregar publicaciones desde búsqueda
    async agregar(expedienteId: number, publicaciones: Omit<Publicacion, 'id'>[]) {
      try {
        await dbAgregarPublicaciones(publicaciones);
        await this.cargar(expedienteId);
      } catch (error) {
        console.error('Error al agregar publicaciones:', error);
      }
    },

    // Obtener publicaciones de un expediente
    obtener(expedienteId: number): Publicacion[] {
      const state = get({ subscribe });
      return state.publicaciones.get(expedienteId) || [];
    }
  };
}

// ============== INSTANCIAS ==============

export const expedientesStore = crearExpedientesStore();
export const publicacionesStore = crearPublicacionesStore();

// ============== STORES DERIVADOS ==============

// Expediente seleccionado actualmente
export const expedienteActual = derived(
  expedientesStore,
  $store => {
    if (!$store.expedienteSeleccionado) return null;
    return $store.expedientes.find(e => e.id === $store.expedienteSeleccionado) || null;
  }
);

// Estadísticas rápidas
export const estadisticasExpedientes = derived(
  expedientesStore,
  $store => ({
    total: $store.expedientes.length,
    porCategoria: $store.expedientes.reduce((acc, exp) => {
      acc[exp.categoria] = (acc[exp.categoria] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  })
);

// Expedientes agrupados por categoría
export const expedientesPorCategoria = derived(
  expedientesStore,
  $store => {
    const grupos: Record<string, Expediente[]> = {};
    for (const exp of $store.expedientes) {
      if (!grupos[exp.categoria]) grupos[exp.categoria] = [];
      grupos[exp.categoria].push(exp);
    }
    return grupos;
  }
);
