/**
 * TSJ Filing - Sistema de Licencias con Sincronización
 * Google Apps Script para gestión de licencias y sincronización de datos
 *
 * ESTRUCTURA DE TU HOJA (columnas existentes + nuevas):
 * A: codigo
 * B: fecha_expiracion
 * C: dispositivo_id (legacy - se mantiene por compatibilidad)
 * D: usuario
 * E: estado
 * F: fecha_registro_dispositivo
 * G: intentos_duplicacion
 * H: ultimo_acceso
 * I: max_dispositivos (número de dispositivos permitidos, default: 2)
 * J: dispositivos_json (array JSON de dispositivos)
 * K: datos_sync (datos cifrados del usuario para sincronización)
 *
 * INSTRUCCIONES:
 * 1. Agrega las columnas I, J y K a tu hoja existente
 * 2. En columna I pon el número de dispositivos permitidos (2 por defecto)
 * 3. Columnas J y K déjalas vacías (se llenan automáticamente)
 * 4. Actualiza SPREADSHEET_ID con el ID de tu hoja
 * 5. Despliega como aplicación web
 */

// ==================== CONFIGURACIÓN ====================
const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_AQUI'; // Reemplaza con tu ID
const SHEET_NAME = 'Licencias'; // Nombre de la hoja

// Columnas según TU estructura actual
const COL = {
  CODIGO: 0,                    // A
  FECHA_EXP: 1,                 // B
  DISPOSITIVO_ID_LEGACY: 2,     // C (campo antiguo, para compatibilidad)
  USUARIO: 3,                   // D
  ESTADO: 4,                    // E
  FECHA_REGISTRO_DISP: 5,       // F
  INTENTOS_DUPLICACION: 6,      // G
  ULTIMO_ACCESO: 7,             // H
  MAX_DISPOSITIVOS: 8,          // I
  DISPOSITIVOS_JSON: 9,         // J
  DATOS_SYNC: 10                // K (NUEVA - datos cifrados para sync)
};

// ==================== FUNCIONES PRINCIPALES ====================

function doGet(e) {
  const action = e.parameter.action;
  let resultado;

  try {
    switch (action) {
      case 'verificar':
        resultado = verificarCodigo(e.parameter);
        break;
      case 'registrar_dispositivo':
        resultado = registrarDispositivo(e.parameter);
        break;
      case 'desvincular_dispositivo':
        resultado = desvincularDispositivo(e.parameter);
        break;
      case 'heartbeat':
        resultado = verificarHeartbeat(e.parameter);
        break;
      case 'transferir':
        resultado = transferirLicencia(e.parameter);
        break;
      case 'obtener_dispositivos':
        resultado = obtenerDispositivos(e.parameter);
        break;
      case 'obtener_sync':
        resultado = obtenerDatosSync(e.parameter);
        break;
      case 'guardar_sync':
        resultado = guardarDatosSync(e.parameter);
        break;
      default:
        resultado = { error: true, mensaje: 'Acción no válida' };
    }
  } catch (error) {
    resultado = { error: true, mensaje: error.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(resultado))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== HELPERS ====================

function getSheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
}

// Verificar si el estado es activo (case-insensitive)
function esEstadoActivo(estado) {
  if (!estado) return false;
  const estadoNormalizado = String(estado).toLowerCase().trim();
  return estadoNormalizado === 'activo' || estadoNormalizado === 'active';
}

function getDispositivos(row) {
  let dispositivos = [];

  // Intentar parsear dispositivos_json
  try {
    const jsonStr = row[COL.DISPOSITIVOS_JSON];
    if (jsonStr && jsonStr.trim()) {
      dispositivos = JSON.parse(jsonStr);
    }
  } catch (e) {
    dispositivos = [];
  }

  // Si está vacío pero hay un dispositivo legacy, migrarlo
  if (dispositivos.length === 0 && row[COL.DISPOSITIVO_ID_LEGACY]) {
    dispositivos = [{
      id: row[COL.DISPOSITIVO_ID_LEGACY],
      tipo: 'desktop',
      nombre: 'Dispositivo (migrado)',
      fechaRegistro: row[COL.FECHA_REGISTRO_DISP] || new Date().toISOString()
    }];
  }

  return dispositivos;
}

function getMaxDispositivos(row) {
  const max = parseInt(row[COL.MAX_DISPOSITIVOS]);
  return isNaN(max) || max < 1 ? 2 : max; // Default: 2 dispositivos
}

function actualizarUltimoAcceso(sheet, rowIndex) {
  sheet.getRange(rowIndex + 1, COL.ULTIMO_ACCESO + 1).setValue(new Date());
}

// ==================== VERIFICACIÓN DE CÓDIGO ====================

function verificarCodigo(params) {
  const codigo = params.codigo;
  const dispositivoId = params.dispositivo_id;
  const usuario = params.usuario || '';

  if (!codigo || !dispositivoId) {
    return { valido: false, mensaje: 'Parámetros incompletos' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const fechaExp = new Date(row[COL.FECHA_EXP]);
      const estado = row[COL.ESTADO];
      const maxDispositivos = getMaxDispositivos(row);
      const dispositivos = getDispositivos(row);

      // Verificar estado (case-insensitive)
      if (!esEstadoActivo(estado)) {
        return { valido: false, mensaje: 'Licencia inactiva o suspendida' };
      }

      // Verificar expiración
      if (fechaExp < new Date()) {
        return { valido: false, mensaje: 'Licencia expirada', razon: 'expirado' };
      }

      // Actualizar último acceso
      actualizarUltimoAcceso(sheet, i);

      // Verificar si el dispositivo ya está registrado
      const dispositivoExistente = dispositivos.find(d => d.id === dispositivoId);
      if (dispositivoExistente) {
        return {
          valido: true,
          mensaje: 'Dispositivo verificado',
          fechaExpiracion: fechaExp.toISOString(),
          diasRestantes: Math.ceil((fechaExp - new Date()) / (1000 * 60 * 60 * 24)),
          dispositivos: dispositivos,
          maxDispositivos: maxDispositivos
        };
      }

      // Verificar límite de dispositivos
      if (dispositivos.length >= maxDispositivos) {
        return {
          valido: false,
          mensaje: `Límite de ${maxDispositivos} dispositivo(s) alcanzado. Desvincula uno para continuar.`,
          dispositivoDiferente: true,
          requiereDesvincular: true,
          dispositivos: dispositivos.map(d => ({
            id: d.id.substring(0, 12) + '...',
            tipo: d.tipo,
            nombre: d.nombre,
            fechaRegistro: d.fechaRegistro
          })),
          maxDispositivos: maxDispositivos
        };
      }

      // El código es válido y hay espacio para más dispositivos
      return {
        valido: true,
        requiereRegistro: true,
        mensaje: 'Código válido, registrar dispositivo',
        fechaExpiracion: fechaExp.toISOString(),
        maxDispositivos: maxDispositivos,
        dispositivosActuales: dispositivos.length
      };
    }
  }

  return { valido: false, mensaje: 'Código no encontrado' };
}

// ==================== REGISTRO DE DISPOSITIVO ====================

function registrarDispositivo(params) {
  const codigo = params.codigo;
  const dispositivoId = params.dispositivo_id;
  const tipoDispositivo = params.tipo_dispositivo || 'desktop';
  const nombreDispositivo = params.nombre_dispositivo || 'Dispositivo';

  if (!codigo || !dispositivoId) {
    return { success: false, mensaje: 'Parámetros incompletos' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const fechaExp = new Date(row[COL.FECHA_EXP]);
      const estado = row[COL.ESTADO];
      const maxDispositivos = getMaxDispositivos(row);
      let dispositivos = getDispositivos(row);

      // Verificaciones
      if (!esEstadoActivo(estado)) {
        return { success: false, mensaje: 'Licencia inactiva' };
      }

      if (fechaExp < new Date()) {
        return { success: false, mensaje: 'Licencia expirada' };
      }

      // Verificar si ya está registrado
      const existente = dispositivos.find(d => d.id === dispositivoId);
      if (existente) {
        return {
          success: true,
          mensaje: 'Dispositivo ya registrado',
          dispositivos: dispositivos,
          maxDispositivos: maxDispositivos
        };
      }

      // Verificar límite
      if (dispositivos.length >= maxDispositivos) {
        return {
          success: false,
          mensaje: `Límite de ${maxDispositivos} dispositivo(s) alcanzado`
        };
      }

      // Registrar nuevo dispositivo
      const nuevoDispositivo = {
        id: dispositivoId,
        tipo: tipoDispositivo,
        nombre: nombreDispositivo,
        fechaRegistro: new Date().toISOString()
      };
      dispositivos.push(nuevoDispositivo);

      // Actualizar la hoja
      const rowNum = i + 1;
      sheet.getRange(rowNum, COL.DISPOSITIVOS_JSON + 1).setValue(JSON.stringify(dispositivos));
      sheet.getRange(rowNum, COL.ULTIMO_ACCESO + 1).setValue(new Date());

      // También actualizar el campo legacy con el primer dispositivo (compatibilidad)
      if (dispositivos.length === 1) {
        sheet.getRange(rowNum, COL.DISPOSITIVO_ID_LEGACY + 1).setValue(dispositivoId);
        sheet.getRange(rowNum, COL.FECHA_REGISTRO_DISP + 1).setValue(new Date());
      }

      return {
        success: true,
        mensaje: 'Dispositivo registrado correctamente',
        dispositivos: dispositivos,
        maxDispositivos: maxDispositivos
      };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

// ==================== DESVINCULAR DISPOSITIVO ====================

function desvincularDispositivo(params) {
  const codigo = params.codigo;
  const dispositivoId = params.dispositivo_id;

  if (!codigo || !dispositivoId) {
    return { success: false, mensaje: 'Parámetros incompletos' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      let dispositivos = getDispositivos(data[i]);

      const index = dispositivos.findIndex(d => d.id === dispositivoId);
      if (index === -1) {
        return { success: false, mensaje: 'Dispositivo no encontrado en esta licencia' };
      }

      // Eliminar dispositivo
      dispositivos.splice(index, 1);

      // Actualizar la hoja
      const rowNum = i + 1;
      sheet.getRange(rowNum, COL.DISPOSITIVOS_JSON + 1).setValue(JSON.stringify(dispositivos));

      // Si se eliminó el dispositivo legacy, limpiar ese campo también
      if (data[i][COL.DISPOSITIVO_ID_LEGACY] === dispositivoId) {
        sheet.getRange(rowNum, COL.DISPOSITIVO_ID_LEGACY + 1).setValue('');
      }

      return {
        success: true,
        mensaje: 'Dispositivo desvinculado correctamente',
        dispositivos: dispositivos
      };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

// ==================== OBTENER DISPOSITIVOS ====================

function obtenerDispositivos(params) {
  const codigo = params.codigo;

  if (!codigo) {
    return { success: false, mensaje: 'Código requerido' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const dispositivos = getDispositivos(row);
      const maxDispositivos = getMaxDispositivos(row);

      return {
        success: true,
        dispositivos: dispositivos,
        maxDispositivos: maxDispositivos,
        disponibles: maxDispositivos - dispositivos.length
      };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

// ==================== HEARTBEAT (VERIFICACIÓN PERIÓDICA) ====================

function verificarHeartbeat(params) {
  const codigo = params.codigo;
  const dispositivoId = params.dispositivo_id;

  if (!codigo || !dispositivoId) {
    return { valido: false, razon: 'parametros_incompletos' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const fechaExp = new Date(row[COL.FECHA_EXP]);
      const estado = row[COL.ESTADO];
      const dispositivos = getDispositivos(row);

      // Verificar estado
      if (!esEstadoActivo(estado)) {
        return { valido: false, razon: 'inactivo' };
      }

      // Verificar expiración
      if (fechaExp < new Date()) {
        return { valido: false, razon: 'expirado' };
      }

      // Verificar que el dispositivo esté registrado
      const dispositivoRegistrado = dispositivos.find(d => d.id === dispositivoId);
      if (!dispositivoRegistrado) {
        return { valido: false, razon: 'dispositivo_no_registrado' };
      }

      // Actualizar último acceso
      actualizarUltimoAcceso(sheet, i);

      const diasRestantes = Math.ceil((fechaExp - new Date()) / (1000 * 60 * 60 * 24));

      return {
        valido: true,
        fechaExpiracion: fechaExp.toISOString(),
        diasRestantes: diasRestantes
      };
    }
  }

  return { valido: false, razon: 'codigo_no_encontrado' };
}

// ==================== TRANSFERENCIA DE LICENCIA ====================

function transferirLicencia(params) {
  const codigo = params.codigo;
  const nuevoDispositivoId = params.nuevo_dispositivo_id;
  const tipoDispositivo = params.tipo_dispositivo || 'desktop';
  const nombreDispositivo = params.nombre_dispositivo || 'Dispositivo';

  if (!codigo || !nuevoDispositivoId) {
    return { success: false, mensaje: 'Parámetros incompletos' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const fechaExp = new Date(row[COL.FECHA_EXP]);
      const estado = row[COL.ESTADO];
      const maxDispositivos = getMaxDispositivos(row);

      if (!esEstadoActivo(estado) || fechaExp < new Date()) {
        return { success: false, mensaje: 'Licencia no válida' };
      }

      // Limpiar todos los dispositivos y registrar solo el nuevo
      const dispositivos = [{
        id: nuevoDispositivoId,
        tipo: tipoDispositivo,
        nombre: nombreDispositivo,
        fechaRegistro: new Date().toISOString()
      }];

      // Actualizar
      const rowNum = i + 1;
      sheet.getRange(rowNum, COL.DISPOSITIVOS_JSON + 1).setValue(JSON.stringify(dispositivos));
      sheet.getRange(rowNum, COL.DISPOSITIVO_ID_LEGACY + 1).setValue(nuevoDispositivoId);
      sheet.getRange(rowNum, COL.FECHA_REGISTRO_DISP + 1).setValue(new Date());
      sheet.getRange(rowNum, COL.ULTIMO_ACCESO + 1).setValue(new Date());

      return {
        success: true,
        mensaje: 'Licencia transferida correctamente',
        dispositivos: dispositivos,
        maxDispositivos: maxDispositivos
      };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

// ==================== FUNCIONES DE ADMINISTRACIÓN ====================

/**
 * Genera un código de licencia aleatorio
 */
function generarCodigoLicencia() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let codigo = '';
  for (let i = 0; i < 16; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

/**
 * Crea una nueva licencia
 * @param {string} usuario - Email o nombre del usuario
 * @param {number} diasValidez - Días de validez (ej: 30)
 * @param {number} maxDispositivos - Dispositivos permitidos (1-99)
 */
function crearLicencia(usuario, diasValidez, maxDispositivos) {
  const sheet = getSheet();

  const codigo = generarCodigoLicencia();
  const fechaExp = new Date();
  fechaExp.setDate(fechaExp.getDate() + diasValidez);

  // Columnas: codigo, fecha_exp, disp_id, usuario, estado, fecha_reg, intentos, ultimo_acceso, max_disp, disp_json
  sheet.appendRow([
    codigo,
    fechaExp,
    '',  // dispositivo_id (vacío, se llena al registrar)
    usuario,
    'activo',
    '',  // fecha_registro_dispositivo
    0,   // intentos_duplicacion
    '',  // ultimo_acceso
    maxDispositivos || 2,
    '[]' // dispositivos_json
  ]);

  return {
    codigo: codigo,
    fechaExpiracion: fechaExp.toISOString(),
    maxDispositivos: maxDispositivos || 2
  };
}

/**
 * Actualiza el máximo de dispositivos para una licencia existente
 * @param {string} codigo - Código de la licencia
 * @param {number} nuevoMax - Nuevo límite de dispositivos
 */
function actualizarMaxDispositivos(codigo, nuevoMax) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      sheet.getRange(i + 1, COL.MAX_DISPOSITIVOS + 1).setValue(nuevoMax);
      return { success: true, mensaje: `Límite actualizado a ${nuevoMax} dispositivos` };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

/**
 * Migra licencias existentes al nuevo formato multi-dispositivo
 * Ejecutar UNA VEZ después de agregar las columnas I y J
 */
function migrarLicenciasExistentes() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  let migradas = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const dispositivoLegacy = row[COL.DISPOSITIVO_ID_LEGACY];
    const dispositivosJson = row[COL.DISPOSITIVOS_JSON];
    const maxDispositivos = row[COL.MAX_DISPOSITIVOS];

    const rowNum = i + 1;

    // Si no tiene max_dispositivos, poner 2 por defecto
    if (!maxDispositivos) {
      sheet.getRange(rowNum, COL.MAX_DISPOSITIVOS + 1).setValue(2);
    }

    // Si tiene dispositivo legacy pero no tiene dispositivos_json, migrar
    if (dispositivoLegacy && (!dispositivosJson || dispositivosJson === '[]')) {
      const dispositivos = [{
        id: dispositivoLegacy,
        tipo: 'desktop',
        nombre: 'Dispositivo (migrado)',
        fechaRegistro: row[COL.FECHA_REGISTRO_DISP] || new Date().toISOString()
      }];
      sheet.getRange(rowNum, COL.DISPOSITIVOS_JSON + 1).setValue(JSON.stringify(dispositivos));
      migradas++;
    }
  }

  Logger.log(`Migración completada: ${migradas} licencias migradas`);
  return { success: true, migradas: migradas };
}

// ==================== SINCRONIZACIÓN DE DATOS ====================

/**
 * Obtiene los datos sincronizados (cifrados) para un código
 */
function obtenerDatosSync(params) {
  const codigo = params.codigo;

  if (!codigo) {
    return { success: false, mensaje: 'Código requerido' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const estado = row[COL.ESTADO];
      const fechaExp = new Date(row[COL.FECHA_EXP]);

      // Verificar licencia válida
      if (!esEstadoActivo(estado)) {
        return { success: false, mensaje: 'Licencia inactiva' };
      }

      if (fechaExp < new Date()) {
        return { success: false, mensaje: 'Licencia expirada' };
      }

      // Obtener datos sync (pueden estar vacíos)
      const datosSync = row[COL.DATOS_SYNC] || null;

      // Actualizar último acceso
      sheet.getRange(i + 1, COL.ULTIMO_ACCESO + 1).setValue(new Date());

      return {
        success: true,
        datos: datosSync
      };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

/**
 * Guarda los datos sincronizados (cifrados) para un código
 */
function guardarDatosSync(params) {
  const codigo = params.codigo;
  const datos = params.datos;

  if (!codigo) {
    return { success: false, mensaje: 'Código requerido' };
  }

  if (!datos) {
    return { success: false, mensaje: 'Datos requeridos' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const estado = row[COL.ESTADO];
      const fechaExp = new Date(row[COL.FECHA_EXP]);

      // Verificar licencia válida
      if (!esEstadoActivo(estado)) {
        return { success: false, mensaje: 'Licencia inactiva' };
      }

      if (fechaExp < new Date()) {
        return { success: false, mensaje: 'Licencia expirada' };
      }

      // Guardar datos sync
      const rowNum = i + 1;
      sheet.getRange(rowNum, COL.DATOS_SYNC + 1).setValue(datos);
      sheet.getRange(rowNum, COL.ULTIMO_ACCESO + 1).setValue(new Date());

      return {
        success: true,
        mensaje: 'Datos sincronizados correctamente'
      };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

// ==================== FUNCIONES DE PRUEBA ====================

function testCrearLicencia() {
  const resultado = crearLicencia('test@example.com', 30, 3);
  Logger.log('Licencia creada: ' + JSON.stringify(resultado));
}

function testMigrar() {
  const resultado = migrarLicenciasExistentes();
  Logger.log('Resultado migración: ' + JSON.stringify(resultado));
}
