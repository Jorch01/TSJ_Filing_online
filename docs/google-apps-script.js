/**
 * TSJ Filing Online - API de Licencias Premium
 *
 * INSTRUCCIONES DE INSTALACIÓN:
 * 1. Ve a https://script.google.com
 * 2. Crea un nuevo proyecto
 * 3. Copia todo este código
 * 4. IMPORTANTE: Modifica SHEET_ID con tu ID de Google Sheet
 * 5. IMPORTANTE: Modifica SHEET_NAME con el nombre exacto de tu hoja (ej: "Hoja 1", "Sheet1", etc.)
 * 6. En el menú: Implementar > Nueva implementación
 * 7. Tipo: Aplicación web
 * 8. Ejecutar como: Yo
 * 9. Quién tiene acceso: Cualquier persona
 * 10. Copia la URL de la implementación
 *
 * FORMATO DEL SHEET (columnas A-H):
 * A: codigo
 * B: fecha_expiracion (YYYY-MM-DD)
 * C: dispositivo_id
 * D: usuario
 * E: estado (activo/inactivo/suspendido)
 * F: fecha_registro_dispositivo
 * G: intentos_duplicacion
 * H: ultimo_acceso
 *
 * NOTA: La primera fila debe ser el encabezado con estos nombres de columna.
 */

// ========== CONFIGURACIÓN ==========
const SHEET_ID = '18U5xEDwgHoI0IK1RZAEcG_j736Q12LFCM5ayGvQX00U';
const SHEET_NAME = 'Hoja 1';
// ====================================

/**
 * Obtiene la hoja de cálculo, con manejo de errores
 */
function getSheet() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);

    // Si no encuentra la hoja por nombre, usar la primera hoja
    if (!sheet) {
      console.log('Hoja "' + SHEET_NAME + '" no encontrada, usando primera hoja');
      sheet = spreadsheet.getSheets()[0];
    }

    if (!sheet) {
      throw new Error('No se encontró ninguna hoja en el documento');
    }

    return sheet;
  } catch (error) {
    console.error('Error al abrir el sheet:', error);
    throw new Error('No se pudo acceder al documento. Verifica el SHEET_ID.');
  }
}

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const params = e.parameter;
    const action = params.action;

    let result;

    switch(action) {
      case 'verificar':
        result = verificarCodigo(params.codigo, params.dispositivo_id, params.usuario);
        break;
      case 'registrar':
        result = registrarDispositivo(params.codigo, params.dispositivo_id, params.usuario);
        break;
      case 'transferir':
        result = transferirLicencia(params.codigo, params.dispositivo_id, params.usuario, params.motivo);
        break;
      case 'heartbeat':
        result = registrarHeartbeat(params.codigo, params.dispositivo_id);
        break;
      case 'info':
        result = obtenerInfoLicencia(params.codigo);
        break;
      default:
        result = { error: true, mensaje: 'Acción no válida' };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: true, mensaje: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Verifica un código de licencia
 */
function verificarCodigo(codigo, dispositivoId, usuario) {
  if (!codigo || !dispositivoId) {
    return { valido: false, mensaje: 'Código y dispositivo requeridos' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const codigoSheet = row[0]?.toString().trim();

    if (codigoSheet === codigo) {
      const fechaExp = row[1];
      const dispositivoRegistrado = row[2]?.toString().trim();
      const estado = row[4]?.toString().trim().toLowerCase();

      // Verificar estado (vacío o "activo" = válido)
      if (estado && estado !== 'activo' && estado !== '') {
        return {
          valido: false,
          mensaje: 'Licencia suspendida o inactiva',
          estado: estado
        };
      }

      // Verificar expiración
      if (fechaExp) {
        const fechaExpDate = new Date(fechaExp);
        if (fechaExpDate < new Date()) {
          return {
            valido: false,
            mensaje: 'Licencia expirada',
            fechaExpiracion: fechaExp
          };
        }
      }

      // Verificar dispositivo
      if (!dispositivoRegistrado || dispositivoRegistrado === '') {
        // No hay dispositivo registrado, se puede registrar
        return {
          valido: true,
          requiereRegistro: true,
          mensaje: 'Código válido, requiere registro de dispositivo'
        };
      }

      if (dispositivoRegistrado === dispositivoId) {
        // Dispositivo correcto
        // Actualizar último acceso
        sheet.getRange(i + 1, 8).setValue(new Date().toISOString());

        return {
          valido: true,
          mensaje: 'Licencia válida',
          usuario: row[3],
          fechaExpiracion: fechaExp
        };
      } else {
        // Dispositivo diferente - intento de duplicación
        const intentos = (parseInt(row[6]) || 0) + 1;
        sheet.getRange(i + 1, 7).setValue(intentos);

        return {
          valido: false,
          mensaje: 'Este código ya está registrado en otro dispositivo',
          dispositivoDiferente: true,
          intentosDuplicacion: intentos
        };
      }
    }
  }

  return { valido: false, mensaje: 'Código no encontrado' };
}

/**
 * Registra un dispositivo para una licencia
 */
function registrarDispositivo(codigo, dispositivoId, usuario) {
  if (!codigo || !dispositivoId) {
    return { exito: false, mensaje: 'Código y dispositivo requeridos' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const codigoSheet = row[0]?.toString().trim();

    if (codigoSheet === codigo) {
      const dispositivoRegistrado = row[2]?.toString().trim();
      const estado = row[4]?.toString().trim().toLowerCase();

      // Estado vacío o "activo" = válido
      if (estado && estado !== 'activo' && estado !== '') {
        return { exito: false, mensaje: 'Licencia no activa' };
      }

      if (dispositivoRegistrado && dispositivoRegistrado !== '') {
        if (dispositivoRegistrado === dispositivoId) {
          return { exito: true, mensaje: 'Dispositivo ya registrado' };
        }
        return {
          exito: false,
          mensaje: 'Ya hay un dispositivo registrado para este código',
          yaRegistrado: true
        };
      }

      // Registrar dispositivo
      sheet.getRange(i + 1, 3).setValue(dispositivoId); // Columna C
      sheet.getRange(i + 1, 4).setValue(usuario || 'Sin nombre'); // Columna D
      sheet.getRange(i + 1, 6).setValue(new Date().toISOString()); // Columna F
      sheet.getRange(i + 1, 8).setValue(new Date().toISOString()); // Columna H

      // Enviar notificación al admin
      enviarNotificacionAdmin('Nuevo registro', codigo, dispositivoId, usuario);

      return {
        exito: true,
        mensaje: 'Dispositivo registrado exitosamente',
        fechaExpiracion: row[1]
      };
    }
  }

  return { exito: false, mensaje: 'Código no encontrado' };
}

/**
 * Solicita transferencia de licencia a nuevo dispositivo
 * Incluye período de cooldown de 30 días
 */
function transferirLicencia(codigo, nuevoDispositivoId, usuario, motivo) {
  if (!codigo || !nuevoDispositivoId) {
    return { exito: false, mensaje: 'Código y nuevo dispositivo requeridos' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const codigoSheet = row[0]?.toString().trim();

    if (codigoSheet === codigo) {
      const fechaRegistro = row[5]; // Fecha de registro del dispositivo actual

      // Verificar cooldown de 30 días
      if (fechaRegistro) {
        const fechaReg = new Date(fechaRegistro);
        const ahora = new Date();
        const diasTranscurridos = Math.floor((ahora - fechaReg) / (1000 * 60 * 60 * 24));

        if (diasTranscurridos < 30) {
          const diasRestantes = 30 - diasTranscurridos;
          return {
            exito: false,
            mensaje: `Debes esperar ${diasRestantes} días para transferir la licencia`,
            diasRestantes: diasRestantes,
            cooldown: true
          };
        }
      }

      // Registrar transferencia
      const dispositivoAnterior = row[2];
      sheet.getRange(i + 1, 3).setValue(nuevoDispositivoId);
      sheet.getRange(i + 1, 6).setValue(new Date().toISOString());
      sheet.getRange(i + 1, 8).setValue(new Date().toISOString());

      // Log de transferencia (podrías agregar una hoja de logs)
      enviarNotificacionAdmin('Transferencia de licencia', codigo, nuevoDispositivoId, usuario,
        `Motivo: ${motivo || 'No especificado'}. Dispositivo anterior: ${dispositivoAnterior}`);

      return {
        exito: true,
        mensaje: 'Licencia transferida exitosamente',
        fechaExpiracion: row[1]
      };
    }
  }

  return { exito: false, mensaje: 'Código no encontrado' };
}

/**
 * Registra heartbeat para verificación periódica
 */
function registrarHeartbeat(codigo, dispositivoId) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0]?.toString().trim() === codigo) {
      const dispositivoRegistrado = row[2]?.toString().trim();
      const estado = row[4]?.toString().trim().toLowerCase();
      const fechaExp = row[1];

      // Verificar validez (vacío o "activo" = válido)
      if (estado && estado !== 'activo' && estado !== '') {
        return { valido: false, razon: 'inactivo' };
      }

      if (fechaExp && new Date(fechaExp) < new Date()) {
        return { valido: false, razon: 'expirado' };
      }

      if (dispositivoRegistrado !== dispositivoId) {
        return { valido: false, razon: 'dispositivo_diferente' };
      }

      // Actualizar último acceso
      sheet.getRange(i + 1, 8).setValue(new Date().toISOString());

      return {
        valido: true,
        fechaExpiracion: fechaExp,
        diasRestantes: fechaExp ? Math.ceil((new Date(fechaExp) - new Date()) / (1000 * 60 * 60 * 24)) : null
      };
    }
  }

  return { valido: false, razon: 'no_encontrado' };
}

/**
 * Obtiene información de una licencia (para admin)
 */
function obtenerInfoLicencia(codigo) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0]?.toString().trim() === codigo) {
      return {
        encontrado: true,
        codigo: row[0],
        fechaExpiracion: row[1],
        tieneDispositivo: !!row[2],
        usuario: row[3],
        estado: row[4],
        fechaRegistro: row[5],
        intentosDuplicacion: row[6] || 0,
        ultimoAcceso: row[7]
      };
    }
  }

  return { encontrado: false };
}

/**
 * Envía notificación por email al administrador
 */
function enviarNotificacionAdmin(tipo, codigo, dispositivo, usuario, detalles) {
  const adminEmail = 'jorge_clemente@empirica.mx';
  const subject = `[TSJ Filing] ${tipo} - ${codigo}`;
  const body = `
    Tipo: ${tipo}
    Código: ${codigo}
    Dispositivo: ${dispositivo}
    Usuario: ${usuario || 'No especificado'}
    Fecha: ${new Date().toLocaleString('es-MX')}
    ${detalles ? '\nDetalles: ' + detalles : ''}
  `;

  try {
    MailApp.sendEmail(adminEmail, subject, body);
  } catch (e) {
    console.log('Error enviando email:', e);
  }
}

/**
 * Función de prueba
 */
function testAPI() {
  const resultado = verificarCodigo('TEST123', 'device_abc123', 'Usuario Test');
  console.log(resultado);
}
