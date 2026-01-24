/**
 * Servicio de Base de Datos Local usando IndexedDB (via Dexie.js)
 * Almacena todos los datos localmente en el navegador del usuario
 */

import Dexie, { type Table } from 'dexie';

// ============== INTERFACES ==============

export interface Expediente {
  id?: number;
  numero?: string;
  nombre?: string;
  juzgado: string;
  juzgadoId: number;
  comentario?: string;
  categoria: string;
  fechaCreacion: Date;
  fechaActualizacion: Date;
  activo: boolean;
}

export interface Publicacion {
  id?: number;
  expedienteId: number;
  idAcuerdo: string;
  documento: string;
  juicio: string;
  partes: string;
  fecha: Date;
  fechaConsulta: Date;
  esNuevo: boolean;
  leido: boolean;
}

export interface Nota {
  id?: number;
  expedienteId: number;
  titulo: string;
  contenido: string;
  color: string;
  fechaCreacion: Date;
  fechaActualizacion: Date;
  recordatorio?: Date;
  recordatorioEnviado: boolean;
}

export interface Evento {
  id?: number;
  expedienteId?: number;
  titulo: string;
  descripcion?: string;
  fechaInicio: Date;
  fechaFin?: Date;
  todoElDia: boolean;
  color: string;
  tipo: 'audiencia' | 'vencimiento' | 'recordatorio' | 'otro';
  alerta: boolean;
  alertaMinutosAntes: number;
  alertaEnviada: boolean;
  emailRecordatorio?: string;
  recurrente: boolean;
  recurrencia?: 'diaria' | 'semanal' | 'mensual' | 'anual';
}

export interface Configuracion {
  id?: number;
  clave: string;
  valor: string;
}

export interface BusquedaHistorial {
  id?: number;
  expedienteId: number;
  fechaBusqueda: Date;
  resultados: number;
  exitosa: boolean;
  error?: string;
}

// ============== BASE DE DATOS ==============

export class TSJDatabase extends Dexie {
  expedientes!: Table<Expediente>;
  publicaciones!: Table<Publicacion>;
  notas!: Table<Nota>;
  eventos!: Table<Evento>;
  configuracion!: Table<Configuracion>;
  historialBusquedas!: Table<BusquedaHistorial>;

  constructor() {
    super('TSJFilingDB');

    this.version(1).stores({
      expedientes: '++id, numero, nombre, juzgado, juzgadoId, categoria, activo, fechaCreacion',
      publicaciones: '++id, expedienteId, idAcuerdo, fecha, fechaConsulta, esNuevo, leido',
      notas: '++id, expedienteId, fechaCreacion, recordatorio',
      eventos: '++id, expedienteId, fechaInicio, tipo, alerta, alertaEnviada',
      configuracion: '++id, &clave',
      historialBusquedas: '++id, expedienteId, fechaBusqueda'
    });
  }
}

export const db = new TSJDatabase();

// ============== FUNCIONES DE EXPEDIENTES ==============

export async function agregarExpediente(expediente: Omit<Expediente, 'id' | 'fechaCreacion' | 'fechaActualizacion'>): Promise<number> {
  const ahora = new Date();
  return await db.expedientes.add({
    ...expediente,
    fechaCreacion: ahora,
    fechaActualizacion: ahora,
    activo: true
  });
}

export async function obtenerExpedientes(soloActivos = true): Promise<Expediente[]> {
  if (soloActivos) {
    return await db.expedientes.where('activo').equals(1).toArray();
  }
  return await db.expedientes.toArray();
}

export async function obtenerExpediente(id: number): Promise<Expediente | undefined> {
  return await db.expedientes.get(id);
}

export async function actualizarExpediente(id: number, cambios: Partial<Expediente>): Promise<void> {
  await db.expedientes.update(id, {
    ...cambios,
    fechaActualizacion: new Date()
  });
}

export async function eliminarExpediente(id: number, permanente = false): Promise<void> {
  if (permanente) {
    // Eliminar también publicaciones, notas y eventos relacionados
    await db.publicaciones.where('expedienteId').equals(id).delete();
    await db.notas.where('expedienteId').equals(id).delete();
    await db.eventos.where('expedienteId').equals(id).delete();
    await db.historialBusquedas.where('expedienteId').equals(id).delete();
    await db.expedientes.delete(id);
  } else {
    // Soft delete
    await db.expedientes.update(id, { activo: false, fechaActualizacion: new Date() });
  }
}

export async function buscarExpedienteDuplicado(numero?: string, nombre?: string, juzgadoId?: number): Promise<Expediente | undefined> {
  if (numero) {
    return await db.expedientes
      .where('numero')
      .equals(numero)
      .and(e => e.juzgadoId === juzgadoId && e.activo)
      .first();
  }
  if (nombre) {
    return await db.expedientes
      .where('nombre')
      .equals(nombre)
      .and(e => e.juzgadoId === juzgadoId && e.activo)
      .first();
  }
  return undefined;
}

// ============== FUNCIONES DE PUBLICACIONES ==============

export async function agregarPublicaciones(publicaciones: Omit<Publicacion, 'id'>[]): Promise<void> {
  await db.publicaciones.bulkAdd(publicaciones);
}

export async function obtenerPublicaciones(expedienteId: number): Promise<Publicacion[]> {
  return await db.publicaciones
    .where('expedienteId')
    .equals(expedienteId)
    .reverse()
    .sortBy('fecha');
}

export async function obtenerPublicacionesNuevas(): Promise<Publicacion[]> {
  return await db.publicaciones
    .where('esNuevo')
    .equals(1)
    .and(p => !p.leido)
    .toArray();
}

export async function marcarPublicacionLeida(id: number): Promise<void> {
  await db.publicaciones.update(id, { leido: true });
}

export async function marcarTodasLeidas(expedienteId: number): Promise<void> {
  await db.publicaciones
    .where('expedienteId')
    .equals(expedienteId)
    .modify({ leido: true });
}

// ============== FUNCIONES DE NOTAS ==============

export async function agregarNota(nota: Omit<Nota, 'id' | 'fechaCreacion' | 'fechaActualizacion' | 'recordatorioEnviado'>): Promise<number> {
  const ahora = new Date();
  return await db.notas.add({
    ...nota,
    fechaCreacion: ahora,
    fechaActualizacion: ahora,
    recordatorioEnviado: false
  });
}

export async function obtenerNotas(expedienteId: number): Promise<Nota[]> {
  return await db.notas
    .where('expedienteId')
    .equals(expedienteId)
    .reverse()
    .sortBy('fechaCreacion');
}

export async function obtenerTodasLasNotas(): Promise<Nota[]> {
  return await db.notas.reverse().sortBy('fechaCreacion');
}

export async function actualizarNota(id: number, cambios: Partial<Nota>): Promise<void> {
  await db.notas.update(id, {
    ...cambios,
    fechaActualizacion: new Date()
  });
}

export async function eliminarNota(id: number): Promise<void> {
  await db.notas.delete(id);
}

export async function obtenerNotasConRecordatorio(): Promise<Nota[]> {
  return await db.notas
    .where('recordatorio')
    .above(new Date(0))
    .and(n => !n.recordatorioEnviado)
    .toArray();
}

// ============== FUNCIONES DE EVENTOS/CALENDARIO ==============

export async function agregarEvento(evento: Omit<Evento, 'id' | 'alertaEnviada'>): Promise<number> {
  return await db.eventos.add({
    ...evento,
    alertaEnviada: false
  });
}

export async function obtenerEventos(fechaInicio?: Date, fechaFin?: Date): Promise<Evento[]> {
  let query = db.eventos.toCollection();

  if (fechaInicio && fechaFin) {
    return await db.eventos
      .where('fechaInicio')
      .between(fechaInicio, fechaFin)
      .toArray();
  }

  return await query.toArray();
}

export async function obtenerEventosExpediente(expedienteId: number): Promise<Evento[]> {
  return await db.eventos
    .where('expedienteId')
    .equals(expedienteId)
    .sortBy('fechaInicio');
}

export async function actualizarEvento(id: number, cambios: Partial<Evento>): Promise<void> {
  await db.eventos.update(id, cambios);
}

export async function eliminarEvento(id: number): Promise<void> {
  await db.eventos.delete(id);
}

export async function obtenerEventosConAlertaPendiente(): Promise<Evento[]> {
  const ahora = new Date();
  return await db.eventos
    .where('alerta')
    .equals(1)
    .and(e => !e.alertaEnviada && new Date(e.fechaInicio) > ahora)
    .toArray();
}

export async function marcarAlertaEnviada(id: number): Promise<void> {
  await db.eventos.update(id, { alertaEnviada: true });
}

// ============== FUNCIONES DE CONFIGURACION ==============

export async function obtenerConfiguracion(clave: string): Promise<string | undefined> {
  const config = await db.configuracion.where('clave').equals(clave).first();
  return config?.valor;
}

export async function guardarConfiguracion(clave: string, valor: string): Promise<void> {
  const existente = await db.configuracion.where('clave').equals(clave).first();
  if (existente) {
    await db.configuracion.update(existente.id!, { valor });
  } else {
    await db.configuracion.add({ clave, valor });
  }
}

export async function obtenerTodasLasConfiguraciones(): Promise<Record<string, string>> {
  const configs = await db.configuracion.toArray();
  return Object.fromEntries(configs.map(c => [c.clave, c.valor]));
}

// ============== FUNCIONES DE HISTORIAL ==============

export async function registrarBusqueda(expedienteId: number, resultados: number, exitosa: boolean, error?: string): Promise<void> {
  await db.historialBusquedas.add({
    expedienteId,
    fechaBusqueda: new Date(),
    resultados,
    exitosa,
    error
  });
}

export async function obtenerHistorialBusquedas(expedienteId: number, limite = 10): Promise<BusquedaHistorial[]> {
  return await db.historialBusquedas
    .where('expedienteId')
    .equals(expedienteId)
    .reverse()
    .limit(limite)
    .sortBy('fechaBusqueda');
}

// ============== FUNCIONES DE EXPORTACION/IMPORTACION ==============

export async function exportarDatos(): Promise<string> {
  const datos = {
    version: 1,
    fechaExportacion: new Date().toISOString(),
    expedientes: await db.expedientes.toArray(),
    publicaciones: await db.publicaciones.toArray(),
    notas: await db.notas.toArray(),
    eventos: await db.eventos.toArray(),
    configuracion: await db.configuracion.toArray()
  };
  return JSON.stringify(datos, null, 2);
}

export async function importarDatos(jsonString: string, sobrescribir = false): Promise<{ exito: boolean; mensaje: string }> {
  try {
    const datos = JSON.parse(jsonString);

    if (!datos.version || !datos.expedientes) {
      return { exito: false, mensaje: 'Formato de archivo inválido' };
    }

    if (sobrescribir) {
      await db.expedientes.clear();
      await db.publicaciones.clear();
      await db.notas.clear();
      await db.eventos.clear();
      await db.configuracion.clear();
    }

    // Importar con nuevos IDs
    const expedientesMap = new Map<number, number>();

    for (const exp of datos.expedientes) {
      const oldId = exp.id;
      delete exp.id;
      exp.fechaCreacion = new Date(exp.fechaCreacion);
      exp.fechaActualizacion = new Date(exp.fechaActualizacion);
      const newId = await db.expedientes.add(exp);
      expedientesMap.set(oldId, newId);
    }

    for (const pub of datos.publicaciones) {
      delete pub.id;
      pub.expedienteId = expedientesMap.get(pub.expedienteId) || pub.expedienteId;
      pub.fecha = new Date(pub.fecha);
      pub.fechaConsulta = new Date(pub.fechaConsulta);
      await db.publicaciones.add(pub);
    }

    for (const nota of datos.notas) {
      delete nota.id;
      nota.expedienteId = expedientesMap.get(nota.expedienteId) || nota.expedienteId;
      nota.fechaCreacion = new Date(nota.fechaCreacion);
      nota.fechaActualizacion = new Date(nota.fechaActualizacion);
      if (nota.recordatorio) nota.recordatorio = new Date(nota.recordatorio);
      await db.notas.add(nota);
    }

    for (const evento of datos.eventos) {
      delete evento.id;
      if (evento.expedienteId) {
        evento.expedienteId = expedientesMap.get(evento.expedienteId) || evento.expedienteId;
      }
      evento.fechaInicio = new Date(evento.fechaInicio);
      if (evento.fechaFin) evento.fechaFin = new Date(evento.fechaFin);
      await db.eventos.add(evento);
    }

    for (const config of datos.configuracion) {
      await guardarConfiguracion(config.clave, config.valor);
    }

    return {
      exito: true,
      mensaje: `Importados: ${datos.expedientes.length} expedientes, ${datos.publicaciones?.length || 0} publicaciones, ${datos.notas?.length || 0} notas, ${datos.eventos?.length || 0} eventos`
    };
  } catch (error) {
    return { exito: false, mensaje: `Error al importar: ${error}` };
  }
}

// ============== ESTADISTICAS ==============

export async function obtenerEstadisticas(): Promise<{
  totalExpedientes: number;
  expedientesActivos: number;
  totalPublicaciones: number;
  publicacionesNuevas: number;
  totalNotas: number;
  totalEventos: number;
  eventosProximos: number;
}> {
  const ahora = new Date();
  const enUnaSemana = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);

  return {
    totalExpedientes: await db.expedientes.count(),
    expedientesActivos: await db.expedientes.where('activo').equals(1).count(),
    totalPublicaciones: await db.publicaciones.count(),
    publicacionesNuevas: await db.publicaciones.where('esNuevo').equals(1).and(p => !p.leido).count(),
    totalNotas: await db.notas.count(),
    totalEventos: await db.eventos.count(),
    eventosProximos: await db.eventos.where('fechaInicio').between(ahora, enUnaSemana).count()
  };
}
