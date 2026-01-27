/**
 * TSJ Filing - Sistema de Licencias Multi-Dispositivo
 * Google Apps Script para gestión de licencias y dispositivos
 *
 * INSTRUCCIONES DE CONFIGURACIÓN:
 * 1. Crea un Google Sheet con las siguientes columnas:
 *    A: codigo | B: fecha_expiracion | C: estado | D: usuario | E: max_dispositivos | F: dispositivos_json
 *
 * 2. Copia este código en Apps Script (Extensiones > Apps Script)
 * 3. Configura SPREADSHEET_ID con el ID de tu hoja
 * 4. Despliega como aplicación web (Implementar > Nueva implementación > Aplicación web)
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquiera
 * 5. Copia la URL de la implementación y úsala como apiUrl en tu app
 */

// ==================== CONFIGURACIÓN ====================
const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_AQUI'; // Reemplaza con tu ID
const SHEET_NAME = 'Licencias'; // Nombre de la hoja

// Columnas (ajusta según tu estructura)
const COL = {
  CODIGO: 0,           // A
  FECHA_EXP: 1,        // B
  ESTADO: 2,           // C (activo, inactivo, suspendido)
  USUARIO: 3,          // D
  MAX_DISPOSITIVOS: 4, // E (número: 1-99)
  DISPOSITIVOS_JSON: 5 // F (JSON array de dispositivos)
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

// ==================== VERIFICACIÓN DE CÓDIGO ====================

function verificarCodigo(params) {
  const codigo = params.codigo;
  const dispositivoId = params.dispositivo_id;
  const usuario = params.usuario || '';

  if (!codigo || !dispositivoId) {
    return { valido: false, mensaje: 'Parámetros incompletos' };
  }

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) { // Empezar en 1 para saltar encabezado
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const fechaExp = new Date(row[COL.FECHA_EXP]);
      const estado = row[COL.ESTADO];
      const maxDispositivos = parseInt(row[COL.MAX_DISPOSITIVOS]) || 2;
      let dispositivos = [];

      try {
        dispositivos = JSON.parse(row[COL.DISPOSITIVOS_JSON] || '[]');
      } catch (e) {
        dispositivos = [];
      }

      // Verificar estado
      if (estado !== 'activo') {
        return { valido: false, mensaje: 'Licencia inactiva o suspendida' };
      }

      // Verificar expiración
      if (fechaExp < new Date()) {
        return { valido: false, mensaje: 'Licencia expirada', razon: 'expirado' };
      }

      // Verificar si el dispositivo ya está registrado
      const dispositivoExistente = dispositivos.find(d => d.id === dispositivoId);
      if (dispositivoExistente) {
        return {
          valido: true,
          mensaje: 'Dispositivo ya registrado',
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
          mensaje: `Límite de ${maxDispositivos} dispositivos alcanzado`,
          dispositivoDiferente: true,
          requiereDesvincular: true,
          dispositivos: dispositivos.map(d => ({
            id: d.id.substring(0, 8) + '...',
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

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const fechaExp = new Date(row[COL.FECHA_EXP]);
      const estado = row[COL.ESTADO];
      const maxDispositivos = parseInt(row[COL.MAX_DISPOSITIVOS]) || 2;
      let dispositivos = [];

      try {
        dispositivos = JSON.parse(row[COL.DISPOSITIVOS_JSON] || '[]');
      } catch (e) {
        dispositivos = [];
      }

      // Verificaciones
      if (estado !== 'activo') {
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
          mensaje: 'Dispositivo ya estaba registrado',
          dispositivos: dispositivos,
          maxDispositivos: maxDispositivos
        };
      }

      // Verificar límite
      if (dispositivos.length >= maxDispositivos) {
        return {
          success: false,
          mensaje: `Límite de ${maxDispositivos} dispositivos alcanzado`
        };
      }

      // Registrar nuevo dispositivo
      dispositivos.push({
        id: dispositivoId,
        tipo: tipoDispositivo,
        nombre: nombreDispositivo,
        fechaRegistro: new Date().toISOString()
      });

      // Actualizar la hoja
      sheet.getRange(i + 1, COL.DISPOSITIVOS_JSON + 1).setValue(JSON.stringify(dispositivos));

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

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      let dispositivos = [];

      try {
        dispositivos = JSON.parse(data[i][COL.DISPOSITIVOS_JSON] || '[]');
      } catch (e) {
        dispositivos = [];
      }

      const index = dispositivos.findIndex(d => d.id === dispositivoId);
      if (index === -1) {
        return { success: false, mensaje: 'Dispositivo no encontrado' };
      }

      // Eliminar dispositivo
      dispositivos.splice(index, 1);

      // Actualizar la hoja
      sheet.getRange(i + 1, COL.DISPOSITIVOS_JSON + 1).setValue(JSON.stringify(dispositivos));

      return {
        success: true,
        mensaje: 'Dispositivo desvinculado',
        dispositivos: dispositivos
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

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const fechaExp = new Date(row[COL.FECHA_EXP]);
      const estado = row[COL.ESTADO];
      let dispositivos = [];

      try {
        dispositivos = JSON.parse(row[COL.DISPOSITIVOS_JSON] || '[]');
      } catch (e) {
        dispositivos = [];
      }

      // Verificar estado
      if (estado !== 'activo') {
        return { valido: false, razon: 'inactivo' };
      }

      // Verificar expiración
      if (fechaExp < new Date()) {
        return { valido: false, razon: 'expirado' };
      }

      // Verificar que el dispositivo esté registrado
      const dispositivoRegistrado = dispositivos.find(d => d.id === dispositivoId);
      if (!dispositivoRegistrado) {
        return { valido: false, razon: 'dispositivo_diferente' };
      }

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

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] === codigo) {
      const row = data[i];
      const fechaExp = new Date(row[COL.FECHA_EXP]);
      const estado = row[COL.ESTADO];
      const maxDispositivos = parseInt(row[COL.MAX_DISPOSITIVOS]) || 2;

      if (estado !== 'activo' || fechaExp < new Date()) {
        return { success: false, mensaje: 'Licencia no válida' };
      }

      // Crear nuevo array con solo el nuevo dispositivo
      const dispositivos = [{
        id: nuevoDispositivoId,
        tipo: tipoDispositivo,
        nombre: nombreDispositivo,
        fechaRegistro: new Date().toISOString()
      }];

      // Actualizar
      sheet.getRange(i + 1, COL.DISPOSITIVOS_JSON + 1).setValue(JSON.stringify(dispositivos));

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

// ==================== FUNCIONES AUXILIARES ====================

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
 * Crea una nueva licencia (usar desde la hoja o un trigger)
 */
function crearLicencia(usuario, diasValidez, maxDispositivos = 2) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);

  const codigo = generarCodigoLicencia();
  const fechaExp = new Date();
  fechaExp.setDate(fechaExp.getDate() + diasValidez);

  sheet.appendRow([
    codigo,
    fechaExp,
    'activo',
    usuario,
    maxDispositivos,
    '[]' // dispositivos_json vacío
  ]);

  return {
    codigo: codigo,
    fechaExpiracion: fechaExp,
    maxDispositivos: maxDispositivos
  };
}

/**
 * Función de prueba
 */
function test() {
  // Crear licencia de prueba con 3 dispositivos permitidos
  const licencia = crearLicencia('usuario_prueba@email.com', 30, 3);
  Logger.log('Licencia creada: ' + JSON.stringify(licencia));
}
