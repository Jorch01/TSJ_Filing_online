/**
 * Servicio de Exportación
 * Permite exportar datos a Excel, CSV y JSON
 */

import * as XLSX from 'xlsx';
import type { Expediente, Publicacion, Nota, Evento } from './database';

// ============== TIPOS ==============

export interface DatosExportacion {
  expedientes: Expediente[];
  publicaciones?: Publicacion[];
  notas?: Nota[];
  eventos?: Evento[];
}

export type FormatoExportacion = 'xlsx' | 'csv' | 'json';

// ============== FUNCIONES DE EXPORTACIÓN ==============

/**
 * Exporta expedientes y publicaciones a Excel
 */
export function exportarAExcel(datos: DatosExportacion, nombreArchivo = 'expedientes'): void {
  const wb = XLSX.utils.book_new();

  // Hoja de expedientes
  const datosExpedientes = datos.expedientes.map(exp => ({
    'ID': exp.id,
    'Tipo': exp.numero ? 'Número' : 'Nombre',
    'Expediente/Nombre': exp.numero || exp.nombre,
    'Juzgado': exp.juzgado,
    'Categoría': exp.categoria,
    'Comentario': exp.comentario || '',
    'Fecha Creación': formatearFecha(exp.fechaCreacion),
    'Última Actualización': formatearFecha(exp.fechaActualizacion),
    'Estado': exp.activo ? 'Activo' : 'Inactivo'
  }));

  const wsExpedientes = XLSX.utils.json_to_sheet(datosExpedientes);
  ajustarAnchoColumnas(wsExpedientes, datosExpedientes);
  XLSX.utils.book_append_sheet(wb, wsExpedientes, 'Expedientes');

  // Hoja de publicaciones si existen
  if (datos.publicaciones && datos.publicaciones.length > 0) {
    const datosPublicaciones = datos.publicaciones.map(pub => ({
      'ID Acuerdo': pub.idAcuerdo,
      'Expediente ID': pub.expedienteId,
      'Documento': pub.documento,
      'Juicio': pub.juicio,
      'Partes': pub.partes,
      'Fecha Publicación': formatearFecha(pub.fecha),
      'Fecha Consulta': formatearFecha(pub.fechaConsulta),
      'Es Nuevo': pub.esNuevo ? 'Sí' : 'No',
      'Leído': pub.leido ? 'Sí' : 'No'
    }));

    const wsPublicaciones = XLSX.utils.json_to_sheet(datosPublicaciones);
    ajustarAnchoColumnas(wsPublicaciones, datosPublicaciones);
    XLSX.utils.book_append_sheet(wb, wsPublicaciones, 'Publicaciones');
  }

  // Hoja de notas si existen
  if (datos.notas && datos.notas.length > 0) {
    const datosNotas = datos.notas.map(nota => ({
      'ID': nota.id,
      'Expediente ID': nota.expedienteId,
      'Título': nota.titulo,
      'Contenido': nota.contenido,
      'Fecha Creación': formatearFecha(nota.fechaCreacion),
      'Recordatorio': nota.recordatorio ? formatearFecha(nota.recordatorio) : ''
    }));

    const wsNotas = XLSX.utils.json_to_sheet(datosNotas);
    ajustarAnchoColumnas(wsNotas, datosNotas);
    XLSX.utils.book_append_sheet(wb, wsNotas, 'Notas');
  }

  // Hoja de eventos si existen
  if (datos.eventos && datos.eventos.length > 0) {
    const datosEventos = datos.eventos.map(evento => ({
      'ID': evento.id,
      'Expediente ID': evento.expedienteId || '',
      'Título': evento.titulo,
      'Descripción': evento.descripcion || '',
      'Tipo': evento.tipo,
      'Fecha Inicio': formatearFecha(evento.fechaInicio),
      'Fecha Fin': evento.fechaFin ? formatearFecha(evento.fechaFin) : '',
      'Todo el Día': evento.todoElDia ? 'Sí' : 'No',
      'Alerta': evento.alerta ? 'Sí' : 'No'
    }));

    const wsEventos = XLSX.utils.json_to_sheet(datosEventos);
    ajustarAnchoColumnas(wsEventos, datosEventos);
    XLSX.utils.book_append_sheet(wb, wsEventos, 'Eventos');
  }

  // Descargar
  XLSX.writeFile(wb, `${nombreArchivo}_${obtenerFechaArchivo()}.xlsx`);
}

/**
 * Exporta datos a CSV
 */
export function exportarACSV(datos: DatosExportacion, nombreArchivo = 'expedientes'): void {
  const datosExpedientes = datos.expedientes.map(exp => ({
    'ID': exp.id,
    'Tipo': exp.numero ? 'Número' : 'Nombre',
    'Expediente/Nombre': exp.numero || exp.nombre,
    'Juzgado': exp.juzgado,
    'Categoría': exp.categoria,
    'Comentario': exp.comentario || '',
    'Fecha Creación': formatearFecha(exp.fechaCreacion),
    'Estado': exp.activo ? 'Activo' : 'Inactivo'
  }));

  const ws = XLSX.utils.json_to_sheet(datosExpedientes);
  const csv = XLSX.utils.sheet_to_csv(ws);

  descargarArchivo(csv, `${nombreArchivo}_${obtenerFechaArchivo()}.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Exporta datos a JSON
 */
export function exportarAJSON(datos: DatosExportacion, nombreArchivo = 'expedientes'): void {
  const datosExportar = {
    version: 1,
    fechaExportacion: new Date().toISOString(),
    ...datos
  };

  const json = JSON.stringify(datosExportar, null, 2);
  descargarArchivo(json, `${nombreArchivo}_${obtenerFechaArchivo()}.json`, 'application/json');
}

/**
 * Exporta resultados de búsqueda con formato especial
 */
export function exportarResultadosBusqueda(
  expedientes: Expediente[],
  publicaciones: Map<number, Publicacion[]>,
  nombreArchivo = 'resultados_busqueda'
): void {
  const wb = XLSX.utils.book_new();

  // Crear una hoja por cada expediente con publicaciones
  for (const exp of expedientes) {
    const pubs = publicaciones.get(exp.id!) || [];
    if (pubs.length === 0) continue;

    const nombreHoja = (exp.numero || exp.nombre || 'Expediente').substring(0, 31);

    const datos = pubs.map(pub => ({
      'ID Acuerdo': pub.idAcuerdo,
      'Documento': pub.documento,
      'Juicio': pub.juicio,
      'Partes': pub.partes,
      'Fecha': formatearFecha(pub.fecha),
      'Nuevo': pub.esNuevo ? '⭐' : ''
    }));

    const ws = XLSX.utils.json_to_sheet(datos);
    ajustarAnchoColumnas(ws, datos);

    // Agregar información del expediente en la parte superior
    XLSX.utils.sheet_add_aoa(ws, [
      [`Expediente: ${exp.numero || exp.nombre}`],
      [`Juzgado: ${exp.juzgado}`],
      [`Total publicaciones: ${pubs.length}`],
      []
    ], { origin: 'A1' });

    XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  }

  // Hoja resumen
  const resumen = expedientes.map(exp => ({
    'Expediente': exp.numero || exp.nombre,
    'Juzgado': exp.juzgado,
    'Total Publicaciones': (publicaciones.get(exp.id!) || []).length,
    'Publicaciones Nuevas': (publicaciones.get(exp.id!) || []).filter(p => p.esNuevo).length
  }));

  const wsResumen = XLSX.utils.json_to_sheet(resumen);
  ajustarAnchoColumnas(wsResumen, resumen);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  XLSX.writeFile(wb, `${nombreArchivo}_${obtenerFechaArchivo()}.xlsx`);
}

// ============== FUNCIONES DE IMPORTACIÓN ==============

/**
 * Importa expedientes desde un archivo JSON
 */
export async function importarDesdeJSON(archivo: File): Promise<{ exito: boolean; datos?: DatosExportacion; mensaje: string }> {
  try {
    const contenido = await archivo.text();
    const datos = JSON.parse(contenido);

    if (!datos.expedientes || !Array.isArray(datos.expedientes)) {
      return { exito: false, mensaje: 'El archivo no contiene expedientes válidos' };
    }

    // Convertir fechas
    datos.expedientes = datos.expedientes.map((exp: any) => ({
      ...exp,
      fechaCreacion: new Date(exp.fechaCreacion),
      fechaActualizacion: new Date(exp.fechaActualizacion)
    }));

    if (datos.publicaciones) {
      datos.publicaciones = datos.publicaciones.map((pub: any) => ({
        ...pub,
        fecha: new Date(pub.fecha),
        fechaConsulta: new Date(pub.fechaConsulta)
      }));
    }

    if (datos.notas) {
      datos.notas = datos.notas.map((nota: any) => ({
        ...nota,
        fechaCreacion: new Date(nota.fechaCreacion),
        fechaActualizacion: new Date(nota.fechaActualizacion),
        recordatorio: nota.recordatorio ? new Date(nota.recordatorio) : undefined
      }));
    }

    if (datos.eventos) {
      datos.eventos = datos.eventos.map((evento: any) => ({
        ...evento,
        fechaInicio: new Date(evento.fechaInicio),
        fechaFin: evento.fechaFin ? new Date(evento.fechaFin) : undefined
      }));
    }

    return {
      exito: true,
      datos: datos as DatosExportacion,
      mensaje: `Archivo procesado: ${datos.expedientes.length} expedientes encontrados`
    };
  } catch (error) {
    return { exito: false, mensaje: `Error al procesar archivo: ${error}` };
  }
}

/**
 * Importa expedientes desde un archivo Excel
 */
export async function importarDesdeExcel(archivo: File): Promise<{ exito: boolean; datos?: DatosExportacion; mensaje: string }> {
  try {
    const buffer = await archivo.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });

    const expedientes: Expediente[] = [];

    // Buscar hoja de expedientes
    const hojaExpedientes = wb.Sheets['Expedientes'] || wb.Sheets[wb.SheetNames[0]];
    if (!hojaExpedientes) {
      return { exito: false, mensaje: 'No se encontró la hoja de expedientes' };
    }

    const datosHoja = XLSX.utils.sheet_to_json(hojaExpedientes);

    for (const fila of datosHoja as any[]) {
      const expediente: Partial<Expediente> = {
        juzgado: fila['Juzgado'] || fila['juzgado'] || '',
        categoria: fila['Categoría'] || fila['categoria'] || 'OTROS',
        comentario: fila['Comentario'] || fila['comentario'] || '',
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date()
      };

      const valorExpediente = fila['Expediente/Nombre'] || fila['Numero'] || fila['Nombre'] || fila['expediente'];
      const tipo = fila['Tipo'] || 'Número';

      if (tipo === 'Nombre' || (typeof valorExpediente === 'string' && valorExpediente.length > 20)) {
        expediente.nombre = valorExpediente;
      } else {
        expediente.numero = valorExpediente;
      }

      if (expediente.juzgado) {
        expedientes.push(expediente as Expediente);
      }
    }

    return {
      exito: true,
      datos: { expedientes },
      mensaje: `${expedientes.length} expedientes encontrados`
    };
  } catch (error) {
    return { exito: false, mensaje: `Error al procesar archivo: ${error}` };
  }
}

// ============== UTILIDADES ==============

function formatearFecha(fecha: Date | string): string {
  const f = typeof fecha === 'string' ? new Date(fecha) : fecha;
  return f.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function obtenerFechaArchivo(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}`;
}

function descargarArchivo(contenido: string, nombreArchivo: string, tipo: string): void {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nombreArchivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ajustarAnchoColumnas(ws: XLSX.WorkSheet, datos: any[]): void {
  if (datos.length === 0) return;

  const anchos: { wch: number }[] = [];
  const columnas = Object.keys(datos[0]);

  for (const col of columnas) {
    let maxAncho = col.length;
    for (const fila of datos) {
      const valor = String(fila[col] || '');
      maxAncho = Math.max(maxAncho, valor.length);
    }
    anchos.push({ wch: Math.min(maxAncho + 2, 50) });
  }

  ws['!cols'] = anchos;
}

// ============== FILE SYSTEM ACCESS API ==============

/**
 * Guarda archivo usando File System Access API (si está disponible)
 */
export async function guardarArchivoConDialogo(
  contenido: string | Blob,
  sugerenciaNombre: string,
  tipos: { description: string; accept: Record<string, string[]> }[]
): Promise<boolean> {
  // Verificar si la API está disponible
  if (!('showSaveFilePicker' in window)) {
    // Fallback: descargar directamente
    if (typeof contenido === 'string') {
      descargarArchivo(contenido, sugerenciaNombre, tipos[0]?.accept ? Object.keys(tipos[0].accept)[0] : 'text/plain');
    } else {
      const url = URL.createObjectURL(contenido);
      const link = document.createElement('a');
      link.href = url;
      link.download = sugerenciaNombre;
      link.click();
      URL.revokeObjectURL(url);
    }
    return true;
  }

  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: sugerenciaNombre,
      types
    });

    const writable = await handle.createWritable();
    await writable.write(contenido);
    await writable.close();

    return true;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      // Usuario canceló
      return false;
    }
    console.error('Error al guardar archivo:', error);
    return false;
  }
}

/**
 * Abre archivo usando File System Access API
 */
export async function abrirArchivoConDialogo(
  tipos: { description: string; accept: Record<string, string[]> }[]
): Promise<File | null> {
  // Verificar si la API está disponible
  if (!('showOpenFilePicker' in window)) {
    // Fallback: usar input file
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = Object.values(tipos[0]?.accept || {}).flat().join(',');

      input.onchange = () => {
        resolve(input.files?.[0] || null);
      };

      input.click();
    });
  }

  try {
    const [handle] = await (window as any).showOpenFilePicker({
      types,
      multiple: false
    });

    return await handle.getFile();
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return null;
    }
    console.error('Error al abrir archivo:', error);
    return null;
  }
}
