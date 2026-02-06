/**
 * TSJ Filing - Sistema de Licencias con Sincronización
 * Google Apps Script para gestión de licencias y sincronización de datos
 *
 * SOLO NECESITAS PONER EL CÓDIGO EN COLUMNA A
 * Todo lo demás se genera automáticamente:
 *
 * A: codigo (TÚ LO PONES)
 * B: fecha_expiracion (auto: 1 año, o escribe "perpetua" para sin límite)
 * C: dispositivo_id (auto)
 * D: usuario (auto)
 * E: estado (auto: "activo")
 * F: fecha_registro_dispositivo (auto)
 * G: intentos_duplicacion (auto: 0)
 * H: ultimo_acceso (auto)
 * I: max_dispositivos (auto: 2, puedes cambiar manualmente)
 * J: dispositivos_json (auto)
 * K: datos_sync (auto)
 */

// ==================== CONFIGURACIÓN ====================
const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_AQUI'; // Reemplaza con tu ID
const SHEET_NAME = 'Licencias';
const DIAS_EXPIRACION_DEFAULT = 365; // 1 año por defecto

const COL = {
  CODIGO: 0,                    // A
  FECHA_EXP: 1,                 // B
  DISPOSITIVO_ID_LEGACY: 2,     // C
  USUARIO: 3,                   // D
  ESTADO: 4,                    // E
  FECHA_REGISTRO_DISP: 5,       // F
  INTENTOS_DUPLICACION: 6,      // G
  ULTIMO_ACCESO: 7,             // H
  MAX_DISPOSITIVOS: 8,          // I
  DISPOSITIVOS_JSON: 9,         // J
  DATOS_SYNC: 10                // K
};

// ==================== FUNCIONES PRINCIPALES ====================

function doGet(e) {
  return procesarSolicitud(e.parameter);
}

function doPost(e) {
  // Obtener parámetros de POST
  let params = {};

  // Si viene como form data
  if (e.parameter) {
    params = e.parameter;
  }

  // Si viene como JSON en el body
  if (e.postData && e.postData.contents) {
    try {
      const postParams = JSON.parse(e.postData.contents);
      params = { ...params, ...postParams };
    } catch (err) {
      // No es JSON, puede ser form-urlencoded que ya está en e.parameter
    }
  }

  return procesarSolicitud(params);
}

function procesarSolicitud(params) {
  const action = params.action;
  let resultado;

  try {
    switch (action) {
      case 'verificar':
        resultado = verificarCodigo(params);
        break;
      case 'registrar_dispositivo':
        resultado = registrarDispositivo(params);
        break;
      case 'desvincular_dispositivo':
        resultado = desvincularDispositivo(params);
        break;
      case 'heartbeat':
        resultado = verificarHeartbeat(params);
        break;
      case 'transferir':
        resultado = transferirLicencia(params);
        break;
      case 'obtener_dispositivos':
        resultado = obtenerDispositivos(params);
        break;
      case 'obtener_sync':
        resultado = obtenerDatosSync(params);
        break;
      case 'guardar_sync':
        resultado = guardarDatosSync(params);
        break;
      default:
        resultado = { error: true, mensaje: 'Acción no válida: ' + (action || 'ninguna') };
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
  if (!estado) return true; // Si está vacío, se considera activo (nuevo código)
  const estadoNormalizado = String(estado).toLowerCase().trim();
  if (estadoNormalizado === '') return true;
  return estadoNormalizado === 'activo' || estadoNormalizado === 'active';
}

// Verificar si la licencia es perpetua (sin expiración)
function esLicenciaPerpetua(valor) {
  if (!valor) return false;
  const str = String(valor).toLowerCase().trim();
  return str === 'perpetua' || str === 'ilimitada' || str === 'never' || str === 'unlimited' || str === 'perpetual' || str === 'sin limite';
}

// Inicializar campos vacíos de una fila (auto-genera todo excepto el código)
function inicializarCamposVacios(sheet, rowIndex, row) {
  const rowNum = rowIndex + 1;
  let huboCambios = false;

  // Estado: default "activo"
  if (!row[COL.ESTADO] || String(row[COL.ESTADO]).trim() === '') {
    sheet.getRange(rowNum, COL.ESTADO + 1).setValue('activo');
    huboCambios = true;
  }

  // Fecha expiración: default 1 año desde hoy (si no es perpetua y está vacío)
  if (!row[COL.FECHA_EXP] || String(row[COL.FECHA_EXP]).trim() === '') {
    const fechaExp = new Date();
    fechaExp.setDate(fechaExp.getDate() + DIAS_EXPIRACION_DEFAULT);
    sheet.getRange(rowNum, COL.FECHA_EXP + 1).setValue(fechaExp);
    huboCambios = true;
  }

  // Max dispositivos: default 2
  if (!row[COL.MAX_DISPOSITIVOS] || isNaN(parseInt(row[COL.MAX_DISPOSITIVOS]))) {
    sheet.getRange(rowNum, COL.MAX_DISPOSITIVOS + 1).setValue(2);
    huboCambios = true;
  }

  // Intentos duplicacion: default 0
  if (row[COL.INTENTOS_DUPLICACION] === '' || row[COL.INTENTOS_DUPLICACION] === null || row[COL.INTENTOS_DUPLICACION] === undefined) {
    sheet.getRange(rowNum, COL.INTENTOS_DUPLICACION + 1).setValue(0);
    huboCambios = true;
  }

  // Dispositivos JSON: default []
  if (!row[COL.DISPOSITIVOS_JSON] || String(row[COL.DISPOSITIVOS_JSON]).trim() === '') {
    sheet.getRange(rowNum, COL.DISPOSITIVOS_JSON + 1).setValue('[]');
    huboCambios = true;
  }

  return huboCambios;
}

// Obtener fecha de expiración con soporte para perpetua
function obtenerFechaExpiracion(row) {
  const valor = row[COL.FECHA_EXP];

  // Si es licencia perpetua
  if (esLicenciaPerpetua(valor)) {
    return { perpetua: true, fecha: null };
  }

  // Si es un objeto Date válido
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return { perpetua: false, fecha: valor };
  }

  // Si es string, intentar parsear
  if (valor) {
    const str = String(valor).trim();
    if (str) {
      let fecha = new Date(str);
      if (!isNaN(fecha.getTime())) {
        return { perpetua: false, fecha: fecha };
      }

      // Intentar formato DD/MM/YYYY
      const partes = str.split(/[\/\-]/);
      if (partes.length === 3) {
        fecha = new Date(partes[2], partes[1] - 1, partes[0]);
        if (!isNaN(fecha.getTime())) {
          return { perpetua: false, fecha: fecha };
        }
      }
    }
  }

  // Fecha no válida - será inicializada por inicializarCamposVacios
  return { perpetua: false, fecha: null, necesitaInicializar: true };
}

// Verificar si la licencia está expirada
function licenciaExpirada(infoFecha) {
  if (infoFecha.perpetua) return false; // Perpetua nunca expira
  if (!infoFecha.fecha) return true; // Sin fecha válida = expirada
  return infoFecha.fecha < new Date();
}

// Convertir fecha a ISO string
function fechaAISOString(fecha) {
  if (!fecha) return null;
  if (fecha instanceof Date) {
    if (isNaN(fecha.getTime())) return null;
    return fecha.toISOString();
  }
  const parsed = new Date(fecha);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function getDispositivos(row) {
  let dispositivos = [];

  try {
    const jsonStr = row[COL.DISPOSITIVOS_JSON];
    if (jsonStr && String(jsonStr).trim()) {
      dispositivos = JSON.parse(jsonStr);
    }
  } catch (e) {
    dispositivos = [];
  }

  // Migrar dispositivo legacy si existe
  if (dispositivos.length === 0 && row[COL.DISPOSITIVO_ID_LEGACY]) {
    const fechaRegDisp = fechaAISOString(row[COL.FECHA_REGISTRO_DISP]) || new Date().toISOString();
    dispositivos = [{
      id: row[COL.DISPOSITIVO_ID_LEGACY],
      tipo: 'desktop',
      nombre: 'Dispositivo (migrado)',
      fechaRegistro: fechaRegDisp
    }];
  }

  return dispositivos;
}

function getMaxDispositivos(row) {
  const max = parseInt(row[COL.MAX_DISPOSITIVOS]);
  return isNaN(max) || max < 1 ? 2 : max;
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

      // Auto-inicializar campos vacíos
      inicializarCamposVacios(sheet, i, row);

      // Recargar la fila después de inicializar
      const rowActualizada = sheet.getRange(i + 1, 1, 1, 11).getValues()[0];

      const infoFecha = obtenerFechaExpiracion(rowActualizada);
      const maxDispositivos = getMaxDispositivos(rowActualizada);
      const dispositivos = getDispositivos(rowActualizada);

      // Verificar estado
      if (!esEstadoActivo(rowActualizada[COL.ESTADO])) {
        return { valido: false, mensaje: 'Licencia inactiva o suspendida' };
      }

      // Verificar expiración
      if (licenciaExpirada(infoFecha)) {
        return { valido: false, mensaje: 'Licencia expirada', razon: 'expirado' };
      }

      // Actualizar último acceso y usuario si se proporcionó
      actualizarUltimoAcceso(sheet, i);
      if (usuario && !rowActualizada[COL.USUARIO]) {
        sheet.getRange(i + 1, COL.USUARIO + 1).setValue(usuario);
      }

      // Verificar si el dispositivo ya está registrado
      const dispositivoExistente = dispositivos.find(d => d.id === dispositivoId);
      if (dispositivoExistente) {
        return {
          valido: true,
          mensaje: 'Dispositivo verificado',
          fechaExpiracion: infoFecha.perpetua ? 'perpetua' : infoFecha.fecha.toISOString(),
          perpetua: infoFecha.perpetua,
          diasRestantes: infoFecha.perpetua ? 9999 : Math.ceil((infoFecha.fecha - new Date()) / (1000 * 60 * 60 * 24)),
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

      // Código válido, hay espacio para más dispositivos
      return {
        valido: true,
        requiereRegistro: true,
        mensaje: 'Código válido, registrar dispositivo',
        fechaExpiracion: infoFecha.perpetua ? 'perpetua' : infoFecha.fecha.toISOString(),
        perpetua: infoFecha.perpetua,
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
      const rowNum = i + 1;

      // Auto-inicializar campos vacíos
      inicializarCamposVacios(sheet, i, row);
      const rowActualizada = sheet.getRange(rowNum, 1, 1, 11).getValues()[0];

      const infoFecha = obtenerFechaExpiracion(rowActualizada);
      const maxDispositivos = getMaxDispositivos(rowActualizada);
      let dispositivos = getDispositivos(rowActualizada);

      // Verificaciones
      if (!esEstadoActivo(rowActualizada[COL.ESTADO])) {
        return { success: false, mensaje: 'Licencia inactiva' };
      }

      if (licenciaExpirada(infoFecha)) {
        return { success: false, mensaje: 'Licencia expirada' };
      }

      // Verificar si ya está registrado
      const existente = dispositivos.find(d => d.id === dispositivoId);
      if (existente) {
        return {
          success: true,
          mensaje: 'Dispositivo ya registrado',
          fechaExpiracion: infoFecha.perpetua ? 'perpetua' : infoFecha.fecha.toISOString(),
          perpetua: infoFecha.perpetua,
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
      sheet.getRange(rowNum, COL.DISPOSITIVOS_JSON + 1).setValue(JSON.stringify(dispositivos));
      sheet.getRange(rowNum, COL.ULTIMO_ACCESO + 1).setValue(new Date());

      // Actualizar campo legacy con el primer dispositivo
      if (dispositivos.length === 1) {
        sheet.getRange(rowNum, COL.DISPOSITIVO_ID_LEGACY + 1).setValue(dispositivoId);
        sheet.getRange(rowNum, COL.FECHA_REGISTRO_DISP + 1).setValue(new Date());
      }

      return {
        success: true,
        mensaje: 'Dispositivo registrado correctamente',
        fechaExpiracion: infoFecha.perpetua ? 'perpetua' : infoFecha.fecha.toISOString(),
        perpetua: infoFecha.perpetua,
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

      dispositivos.splice(index, 1);

      const rowNum = i + 1;
      sheet.getRange(rowNum, COL.DISPOSITIVOS_JSON + 1).setValue(JSON.stringify(dispositivos));

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

// ==================== HEARTBEAT ====================

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
      const infoFecha = obtenerFechaExpiracion(row);
      const dispositivos = getDispositivos(row);

      if (!esEstadoActivo(row[COL.ESTADO])) {
        return { valido: false, razon: 'inactivo' };
      }

      if (licenciaExpirada(infoFecha)) {
        return { valido: false, razon: 'expirado' };
      }

      const dispositivoRegistrado = dispositivos.find(d => d.id === dispositivoId);
      if (!dispositivoRegistrado) {
        return { valido: false, razon: 'dispositivo_no_registrado' };
      }

      actualizarUltimoAcceso(sheet, i);

      return {
        valido: true,
        fechaExpiracion: infoFecha.perpetua ? 'perpetua' : infoFecha.fecha.toISOString(),
        perpetua: infoFecha.perpetua,
        diasRestantes: infoFecha.perpetua ? 9999 : Math.ceil((infoFecha.fecha - new Date()) / (1000 * 60 * 60 * 24))
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
      const infoFecha = obtenerFechaExpiracion(row);
      const maxDispositivos = getMaxDispositivos(row);

      if (!esEstadoActivo(row[COL.ESTADO]) || licenciaExpirada(infoFecha)) {
        return { success: false, mensaje: 'Licencia no válida' };
      }

      const dispositivos = [{
        id: nuevoDispositivoId,
        tipo: tipoDispositivo,
        nombre: nombreDispositivo,
        fechaRegistro: new Date().toISOString()
      }];

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

// ==================== SINCRONIZACIÓN DE DATOS ====================

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
      const infoFecha = obtenerFechaExpiracion(row);

      if (!esEstadoActivo(row[COL.ESTADO])) {
        return { success: false, mensaje: 'Licencia inactiva' };
      }

      if (licenciaExpirada(infoFecha)) {
        return { success: false, mensaje: 'Licencia expirada' };
      }

      const datosSync = row[COL.DATOS_SYNC] || null;
      sheet.getRange(i + 1, COL.ULTIMO_ACCESO + 1).setValue(new Date());

      return {
        success: true,
        datos: datosSync
      };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

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
      const infoFecha = obtenerFechaExpiracion(row);

      if (!esEstadoActivo(row[COL.ESTADO])) {
        return { success: false, mensaje: 'Licencia inactiva' };
      }

      if (licenciaExpirada(infoFecha)) {
        return { success: false, mensaje: 'Licencia expirada' };
      }

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

// ==================== FUNCIONES DE ADMINISTRACIÓN ====================

function generarCodigoLicencia() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let codigo = '';
  for (let i = 0; i < 16; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

/**
 * Crea una nueva licencia programáticamente
 */
function crearLicencia(usuario, diasValidez, maxDispositivos) {
  const sheet = getSheet();
  const codigo = generarCodigoLicencia();
  const fechaExp = new Date();
  fechaExp.setDate(fechaExp.getDate() + diasValidez);

  sheet.appendRow([
    codigo,
    fechaExp,
    '',
    usuario,
    'activo',
    '',
    0,
    '',
    maxDispositivos || 2,
    '[]',
    ''
  ]);

  return {
    codigo: codigo,
    fechaExpiracion: fechaExp.toISOString(),
    maxDispositivos: maxDispositivos || 2
  };
}

/**
 * Inicializa todos los códigos existentes que solo tienen el código en columna A
 * Ejecutar una vez si ya tienes códigos sin los demás campos
 */
function inicializarTodosLosCodigos() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  let inicializados = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[COL.CODIGO] && String(row[COL.CODIGO]).trim()) {
      if (inicializarCamposVacios(sheet, i, row)) {
        inicializados++;
      }
    }
  }

  Logger.log(`Inicialización completada: ${inicializados} licencias actualizadas`);
  return { success: true, inicializados: inicializados };
}
