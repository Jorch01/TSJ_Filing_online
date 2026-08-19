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
 * L, M, N: datos_sync_2/3/4 (auto) — el bloque no cabe en una sola celda
 * O, P, Q, R: respaldo_1..4 (auto) — copia que deja el borrado masivo
 * S: respaldo_fecha (auto)
 *
 * Las columnas L a S se crean solas al usarse: en una hoja que ya existe no
 * hay que añadir nada a mano, basta con que estén libres a la derecha de K.
 *
 * Para devolver a un usuario lo que borró: abrir este editor, ejecutar
 * restaurarRespaldoSync("SU-CODIGO") y pedirle que sincronice.
 */

// ==================== CONFIGURACIÓN ====================
//
// PARA CONFIGURARLO LA PRIMERA VEZ, o después de pegar una versión nueva de
// este archivo: baja a configurarAqui(), rellena sus dos líneas, selecciónala
// en el desplegable de arriba y pulsa ▶ Ejecutar. Una sola vez.
//
// (El botón ▶ no sabe pasarle datos a una función, por eso hay que dejarlos
// escritos dentro de configurarAqui en vez de llamar a configurar a mano.)
//
// Lo que escribas queda guardado en las propiedades del script, que NO se
// pierden al actualizar el código. Pegar este archivo encima vuelve a dejar
// las constantes de abajo en su valor de ejemplo, pero la configuración
// guardada sigue mandando y todo continúa funcionando.
//
// Las constantes solo se usan si no hay nada guardado.

const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_AQUI'; // Reemplaza con tu ID
const SHEET_NAME = 'Licencias';
const DIAS_EXPIRACION_DEFAULT = 365; // 1 año por defecto

// Textos de relleno que trae este archivo. Se listan aparte de SPREADSHEET_ID
// para que sustituirlos no sea lo mismo que configurar el script.
const IDS_DE_EJEMPLO = ['TU_SPREADSHEET_ID_AQUI', 'EL-ID-DE-TU-HOJA', 'EL-ID-CORRECTO', '1AbC...'];

/**
 * ¿Este id sigue siendo el texto de ejemplo, sin sustituir?
 *
 * Se mira la FORMA del id, no si coincide con una constante concreta: un id de
 * Google Sheets son treinta y tantos o cuarenta y tantos caracteres de letras,
 * números, guion y guion bajo, y ninguno de los textos de relleno lo es. Antes
 * esto era una comparación contra una constante que estaba justo debajo de
 * SPREADSHEET_ID, con el mismo valor: quien sustituía su id con "buscar y
 * reemplazar" cambiaba las dos, y el script quedaba convencido de que su id
 * real era el de ejemplo.
 */
function idSinConfigurar(id) {
  const limpio = String(id || '').trim();
  if (!limpio) return true;
  if (IDS_DE_EJEMPLO.indexOf(limpio) !== -1) return true;
  return !/^[A-Za-z0-9_-]{25,}$/.test(limpio);
}

/**
 * ▼▼▼ RELLENA ESTAS DOS LÍNEAS Y PULSA ▶ EJECUTAR ▼▼▼
 *
 * Es la forma de configurar el script desde el editor, porque el botón ▶
 * ejecuta la función sin pasarle nada. Solo hace falta una vez: lo que
 * escribas aquí se guarda en las propiedades del script y a partir de ese
 * momento estas dos líneas ya no pintan nada.
 */
function configurarAqui() {
  const ID_DE_MI_HOJA = 'TU_SPREADSHEET_ID_AQUI';  // la parte larga de la url, entre /d/ y /edit
  const NOMBRE_DE_MI_PESTANA = 'Hoja 1';           // el nombre de la pestaña, tal cual sale abajo

  return configurar(ID_DE_MI_HOJA, NOMBRE_DE_MI_PESTANA);
}

/**
 * Guarda el id de la hoja y el nombre de la pestaña donde no se pierdan al
 * actualizar el código. Ejecutar una sola vez desde el editor de Apps Script.
 */
function configurar(idHoja, nombrePestana) {
  if (idHoja === undefined) {
    throw new Error('El botón ▶ Ejecutar no le pasa datos a esta función. ' +
      'Rellena las dos líneas de configurarAqui() y ejecuta esa en su lugar.');
  }

  if (idSinConfigurar(idHoja)) {
    throw new Error('Esto no parece el id de una hoja de cálculo: "' + idHoja + '". ' +
      'El id es la parte larga de la url de tu hoja, entre /d/ y /edit.');
  }

  // Se comprueba antes de guardar: mejor fallar aquí, con el editor delante,
  // que dejar guardada una configuración que no abre nada.
  const hoja = SpreadsheetApp.openById(idHoja);
  const pestana = nombrePestana || SHEET_NAME;
  if (!hoja.getSheetByName(pestana)) {
    throw new Error('La hoja existe pero no tiene ninguna pestaña llamada "' + pestana +
                    '". Las que tiene son: ' +
                    hoja.getSheets().map(function (h) { return h.getName(); }).join(', '));
  }

  PropertiesService.getScriptProperties().setProperties({
    SPREADSHEET_ID: idHoja,
    SHEET_NAME: pestana
  });

  Logger.log('Configuración guardada: "' + hoja.getName() + '" / pestaña "' + pestana + '".');
  Logger.log('Sobrevive a futuras actualizaciones del código.');
  return { success: true, hoja: hoja.getName(), pestana: pestana };
}

/** Muestra la configuración en uso. Útil para comprobar tras actualizar. */
function verConfiguracion() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const id = props.SPREADSHEET_ID || SPREADSHEET_ID;
  Logger.log('id de la hoja : ' + id + (props.SPREADSHEET_ID ? '  (guardado)' : '  (de la constante)'));
  Logger.log('pestaña       : ' + (props.SHEET_NAME || SHEET_NAME));
  if (!props.SPREADSHEET_ID && idSinConfigurar(id)) {
    Logger.log('⚠ Sin configurar. Rellena configurarAqui() y ejecútala.');
  }
  return props;
}

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
  DATOS_SYNC: 10,               // K  ─┐
  DATOS_SYNC_2: 11,             // L   │ el bloque se reparte entre estas
  DATOS_SYNC_3: 12,             // M   │ cuatro; se leen concatenadas
  DATOS_SYNC_4: 13,             // N  ─┘
  RESPALDO_1: 14,               // O  ─┐
  RESPALDO_2: 15,               // P   │ copia que deja el borrado masivo,
  RESPALDO_3: 16,               // Q   │ por si hay que recuperar
  RESPALDO_4: 17,               // R  ─┘
  RESPALDO_FECHA: 18            // S
};

// Una celda de Google Sheets admite 50 000 caracteres. Repartir el bloque
// entre cuatro columnas multiplica por cuatro lo que cabe, sin cambiar nada
// más de la estructura de la hoja.
const COLUMNAS_DATOS = [COL.DATOS_SYNC, COL.DATOS_SYNC_2, COL.DATOS_SYNC_3, COL.DATOS_SYNC_4];
const COLUMNAS_RESPALDO = [COL.RESPALDO_1, COL.RESPALDO_2, COL.RESPALDO_3, COL.RESPALDO_4];

/**
 * Lee el bloque de sincronización completo de una fila, uniendo las columnas.
 * Una hoja antigua solo tiene la primera con datos y las demás vacías, así que
 * la unión devuelve exactamente lo mismo que antes: no hay que migrar nada.
 */
function leerDatosSync(sheet, rowNum) {
  const valores = sheet.getRange(rowNum, COLUMNAS_DATOS[0] + 1, 1, COLUMNAS_DATOS.length).getValues()[0];
  return valores.map(function (v) { return v === null || v === undefined ? '' : String(v); }).join('');
}

/**
 * Escribe el bloque repartido entre las columnas de datos. Las que sobran se
 * vacían siempre: si no, un bloque más corto dejaría cola de la escritura
 * anterior y al concatenar saldría un blob corrupto.
 */
function escribirDatosSync(sheet, rowNum, partes) {
  const fila = COLUMNAS_DATOS.map(function (_, i) { return partes[i] || ''; });
  sheet.getRange(rowNum, COLUMNAS_DATOS[0] + 1, 1, COLUMNAS_DATOS.length).setValues([fila]);
}

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
      case 'respaldar_sync':
        resultado = respaldarYLimpiarSync(params);
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

/**
 * La hoja de licencias, con la configuración guardada por delante de las
 * constantes del archivo.
 *
 * Los errores explican qué falta y cómo arreglarlo. Antes, un id sin sustituir
 * salía como "Illegal spreadsheet id or key: TU_SPREADSHEET_ID_AQUI" y una
 * pestaña mal nombrada como "Cannot read properties of null", que no le dicen
 * nada a quien acaba de pegar una versión nueva del script.
 */
function getSheet() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const id = props.SPREADSHEET_ID || SPREADSHEET_ID;
  const pestana = props.SHEET_NAME || SHEET_NAME;

  // Si hay configuración guardada se usa tal cual: solo se juzga la forma del
  // id cuando viene de la constante del archivo, que es la que puede haberse
  // quedado sin sustituir.
  if (!props.SPREADSHEET_ID && idSinConfigurar(id)) {
    throw new Error('El script no tiene configurada la hoja de cálculo. ' +
      'Abre el editor de Apps Script, rellena las dos líneas de configurarAqui() ' +
      'y ejecuta esa función una vez.');
  }

  let hoja;
  try {
    hoja = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('No se pudo abrir la hoja de cálculo con id "' + id + '". ' +
      'Comprueba que el id sea correcto y que la cuenta del script tenga acceso. ' +
      'Para corregirlo, cambia el id en configurarAqui() y ejecútala.');
  }

  const sheet = hoja.getSheetByName(pestana);
  if (!sheet) {
    throw new Error('La hoja "' + hoja.getName() + '" no tiene ninguna pestaña llamada "' +
      pestana + '". Las que tiene son: ' +
      hoja.getSheets().map(function (h) { return h.getName(); }).join(', ') +
      '. Para corregirlo, pon ese nombre en configurarAqui() y ejecútala.');
  }

  return sheet;
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

// Hash ligero del blob de sync para detectar conflictos entre dispositivos.
// Usamos MD5 (disponible en todas las versiones de Apps Script) en vez de
// SHA-256 para evitar problemas con el parámetro Charset que en algunos
// entornos de Apps Script lanza excepción. MD5 es suficiente para detectar
// si el cell cambió — no es criptográfico aquí, solo comparativo.
function computeSyncHash(str) {
  try {
    if (!str) return '';
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(str));
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      const h = b.toString(16);
      hex += h.length === 1 ? '0' + h : h;
    }
    return hex;
  } catch (e) {
    // Si computeDigest falla, usar longitud+prefijo como fallback mínimo.
    const s = String(str);
    return s.length + '_' + s.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');
  }
}

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

      const datosSync = leerDatosSync(sheet, i + 1) || null;
      sheet.getRange(i + 1, COL.ULTIMO_ACCESO + 1).setValue(new Date());

      return {
        success: true,
        datos: datosSync,
        version: computeSyncHash(datosSync || '')
      };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

function guardarDatosSync(params) {
  const codigo = params.codigo;
  const datos = params.datos;
  // Hash que el cliente recibió en su última descarga. Si difiere del hash
  // actual del cell, otro dispositivo escribió en medio y devolvemos conflict
  // para que el cliente re-descargue, re-fusione y reintente.
  const versionExpected = params.version_expected;
  const forzar = params.forzar === true || params.forzar === 'true';

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

      // Verificar versión solo cuando el cliente la envió explícitamente.
      if (!forzar && versionExpected !== undefined && versionExpected !== null && versionExpected !== '') {
        const datosActuales = leerDatosSync(sheet, rowNum);
        const versionActual = computeSyncHash(String(datosActuales));
        if (String(versionExpected) !== versionActual) {
          return {
            success: false,
            conflict: true,
            mensaje: 'Otro dispositivo actualizó los datos. Re-sincroniza.',
            version: versionActual
          };
        }
      }

      // El cliente manda el bloque partido en datos, datos_2, datos_3 y
      // datos_4. Un cliente antiguo manda solo "datos": las demás llegan
      // vacías y se escriben vacías, que es justo lo que hace falta.
      const partes = [datos, params.datos_2, params.datos_3, params.datos_4]
        .map(function (p) { return p === null || p === undefined ? '' : String(p); });
      escribirDatosSync(sheet, rowNum, partes);
      sheet.getRange(rowNum, COL.ULTIMO_ACCESO + 1).setValue(new Date());

      return {
        success: true,
        mensaje: 'Datos sincronizados correctamente',
        version: computeSyncHash(partes.join(''))
      };
    }
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

/**
 * Mueve el bloque de sincronización a las columnas de respaldo y deja vacías
 * las de datos. Está pensada EXCLUSIVAMENTE para el borrado masivo desde la
 * aplicación: una sincronización normal nunca la llama, porque sobrescribiría
 * el respaldo anterior con cada guardado y dejaría de servir para recuperar.
 *
 * El respaldo es de un solo nivel: guarda el último borrado, no un historial.
 * Si se borra todo dos veces, la segunda pisa la copia de la primera.
 */
function respaldarYLimpiarSync(params) {
  const codigo = params.codigo;
  if (!codigo) {
    return { success: false, mensaje: 'Código requerido' };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] !== codigo) continue;

    const row = data[i];
    if (!esEstadoActivo(row[COL.ESTADO])) {
      return { success: false, mensaje: 'Licencia inactiva' };
    }

    const rowNum = i + 1;
    const actuales = sheet.getRange(rowNum, COLUMNAS_DATOS[0] + 1, 1, COLUMNAS_DATOS.length).getValues()[0];
    const tenia = actuales.some(function (v) { return v !== null && v !== undefined && String(v) !== ''; });

    if (tenia) {
      // Copia tal cual, columna a columna: así el respaldo se puede devolver a
      // su sitio sin volver a partirlo.
      sheet.getRange(rowNum, COLUMNAS_RESPALDO[0] + 1, 1, COLUMNAS_RESPALDO.length).setValues([actuales]);
      sheet.getRange(rowNum, COL.RESPALDO_FECHA + 1).setValue(new Date());
    }

    escribirDatosSync(sheet, rowNum, ['', '', '', '']);
    sheet.getRange(rowNum, COL.ULTIMO_ACCESO + 1).setValue(new Date());

    return {
      success: true,
      respaldado: tenia,
      mensaje: tenia
        ? 'Datos movidos al respaldo y sincronización vaciada'
        : 'No había datos en la nube; sincronización vaciada',
      version: ''
    };
  }

  return { success: false, mensaje: 'Código no encontrado' };
}

/**
 * Devuelve a las columnas de datos lo que guardó el último borrado masivo.
 * No hay botón para esto en la aplicación a propósito: se ejecuta a mano desde
 * el editor de Apps Script cuando alguien pide recuperar su información, para
 * que una recuperación sea siempre una decisión consciente.
 *
 * Uso: cambiar el código y ejecutar la función desde el editor.
 */
function restaurarRespaldoSync(codigo) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.CODIGO] !== codigo) continue;

    const rowNum = i + 1;
    const respaldo = sheet.getRange(rowNum, COLUMNAS_RESPALDO[0] + 1, 1, COLUMNAS_RESPALDO.length).getValues()[0];
    const tiene = respaldo.some(function (v) { return v !== null && v !== undefined && String(v) !== ''; });

    if (!tiene) {
      Logger.log('No hay respaldo para el código ' + codigo);
      return { success: false, mensaje: 'No hay respaldo para ese código' };
    }

    escribirDatosSync(sheet, rowNum, respaldo.map(function (v) { return String(v || ''); }));
    Logger.log('Respaldo restaurado para ' + codigo +
               ' (' + String(respaldo.join('')).length + ' caracteres)');
    return { success: true, mensaje: 'Respaldo restaurado' };
  }

  Logger.log('Código no encontrado: ' + codigo);
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

/**
 * Limpia la celda de sincronización de un código.
 * Usar cuando el blob guardado está corrupto (p.ej. si testDoPost lo sobreescribió
 * con datos de prueba). Después de ejecutar, el dispositivo principal debe
 * sincronizar para volver a subir los datos cifrados correctos.
 *
 * Cambia CODIGO_A_LIMPIAR por el código premium que quieres resetear.
 */
function limpiarCeldaSync(codigo) {
  const CODIGO_A_LIMPIAR = codigo || 'PONER_CODIGO_AQUI'; // <-- cambia esto
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.CODIGO]).trim() === CODIGO_A_LIMPIAR) {
      // Las cuatro, no solo la K: vaciar una sola dejaría la cola de las otras
      // tres y al concatenarlas saldría un bloque corrupto.
      escribirDatosSync(sheet, i + 1, ['', '', '', '']);
      Logger.log('Celdas de sync limpiadas para: ' + CODIGO_A_LIMPIAR);
      return 'OK - celda limpiada para ' + CODIGO_A_LIMPIAR;
    }
  }
  Logger.log('Código no encontrado: ' + CODIGO_A_LIMPIAR);
  return 'Código no encontrado';
}
