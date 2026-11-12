#!/usr/bin/env node
/**
 * Pruebas del Apps Script de sincronización, ejecutado de verdad.
 *
 *   node test_apps_script.js
 *
 * codigo.gs se carga tal cual y se ejecuta contra una hoja de cálculo
 * simulada, así que se comprueba el código que se despliega, no una copia.
 *
 * Cubre lo que puede romper datos de forma silenciosa: que un bloque grande se
 * reparta entre varias celdas y vuelva idéntico, que uno más corto no deje
 * cola del anterior, que el respaldo del borrado masivo se pueda restaurar, y
 * que un cliente antiguo —que solo manda "datos"— siga funcionando.
 */

const fs = require('fs'), vm = require('vm'), path = require('path');
// Relativo al propio archivo: una ruta absoluta solo funciona en la máquina
// donde se escribió, y en cualquier otra —CI incluida— la prueba ni arranca.
const GS = path.join(__dirname, 'docs', 'google-apps-script', 'codigo.gs');

// --- Hoja de cálculo simulada ---
function crearHoja(filas) {
  const datos = filas;
  return {
    _datos: datos,
    getDataRange: () => ({ getValues: () => datos.map(f => f.slice()) }),
    getRange(fila, col, nFilas, nCols) {
      nFilas = nFilas || 1; nCols = nCols || 1;
      return {
        getValues: () => {
          const out = [];
          for (let r = 0; r < nFilas; r++) {
            const f = datos[fila - 1 + r] || [];
            out.push(Array.from({length:nCols}, (_,c) => f[col - 1 + c] !== undefined ? f[col-1+c] : ''));
          }
          return out;
        },
        getValue: () => (datos[fila-1] || [])[col-1] ?? '',
        setValues: (v) => { v.forEach((f, r) => f.forEach((val, c) => {
          while (datos[fila-1+r].length < col-1+c) datos[fila-1+r].push('');
          datos[fila-1+r][col-1+c] = val; })); },
        setValue: (v) => { while (datos[fila-1].length < col-1) datos[fila-1].push('');
                           datos[fila-1][col-1] = v; }
      };
    }
  };
}

// Un id de Google Sheets son 44 caracteres de letras, números, guion y guion
// bajo. La prueba usa uno con esa forma porque el script distingue un id real
// de un texto de ejemplo justo por ahí.
const ID_PRUEBA = '1TESTtestTESTtestTESTtestTESTtestTESTtest123';

const CABECERA = ['codigo','fecha_exp','disp','usuario','estado','freg','intentos','ultimo','max','disp_json',
                  'datos_sync','datos_2','datos_3','datos_4','resp_1','resp_2','resp_3','resp_4','resp_fecha'];
// La licencia de prueba tiene un dispositivo registrado: la sincronización lo exige.
const DISP = 'DISP-REGISTRADO-0001';
const hoja = crearHoja([CABECERA, ['ABC123','perpetua','','','activo','',0,'',2,
  JSON.stringify([{ id: DISP, tipo: 'desktop', nombre: 'PC', fechaRegistro: '2026-01-01T00:00:00Z' }]),
  '','','','','','','','','']]);

// Propiedades del script: aquí vive la configuración que sobrevive a las
// actualizaciones del código.
const propiedades = { SPREADSHEET_ID: ID_PRUEBA, SHEET_NAME: 'Licencias' };

// Bandeja de salida de mentira: lo que el script "manda" acaba aquí.
const correosEnviados = [];

// El PropertiesService de Apps Script tiene las cuatro operaciones. El doble
// tenía solo getProperties/setProperties, así que nada de lo que usara
// getProperty se podía probar: el código fallaba y la prueba no lo veía venir.
function propiedadesFalsas(almacen) {
  return {
    getProperties: () => Object.assign({}, almacen),
    setProperties: (p) => Object.assign(almacen, p),
    getProperty: (k) => (k in almacen ? almacen[k] : null),
    setProperty: (k, v) => { almacen[k] = v; }
  };
}

const candado = { pedidos: 0, tomado: false };

const sandbox = {
  PropertiesService: {
    getScriptProperties: () => propiedadesFalsas(propiedades)
  },
  SpreadsheetApp: {
    openById: (id) => {
      if (!id || id === 'TU_SPREADSHEET_ID_AQUI') throw new Error('Illegal spreadsheet id or key: ' + id);
      // La hoja real solo tiene estas pestañas, mire quien mire: si el stub
      // devolviera lo que le pidan, no se podría probar el caso de una
      // pestaña mal escrita, que es justo uno de los que rompió.
      const PESTANAS = ['Licencias', 'Otra'];
      return {
        getName: () => 'Hoja de prueba',
        getSheetByName: (n) => (PESTANAS.indexOf(n) !== -1 ? hoja : null),
        getSheets: () => PESTANAS.map(n => ({ getName: () => n }))
      };
    }
  },
  // El candado real deja pasar una ejecución a la vez. Aquí todo corre en
  // fila, así que basta con anotar que se pidió y que se soltó.
  LockService: { getScriptLock: () => ({
      waitLock: () => { candado.pedidos++; candado.tomado = true; },
      releaseLock: () => { candado.tomado = false; } }) },
  MailApp: { sendEmail: (destino, asunto, cuerpo, opciones) =>
      correosEnviados.push({ destino, asunto, cuerpo, opciones: opciones || {} }) },
  Utilities: { computeDigest: (a, s) => Array.from(require('crypto').createHash('md5').update(String(s)).digest()),
               DigestAlgorithm: { MD5: 'MD5' } },
  ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
  Logger: { log: () => {} },
  Date, JSON, String, Number, Array, Object, isNaN, parseInt, parseFloat, console
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(GS, 'utf8'), sandbox);

// Como la app: todo por POST y, en la sincronización, con su dispositivo.
const llamarCrudo = (params, metodo) => JSON.parse(vm.runInContext(
  'procesarSolicitud(' + JSON.stringify(params) + ',' + JSON.stringify(metodo || 'POST') + ')', sandbox));
const llamar = (params) => llamarCrudo(/_sync$/.test(params.action || '') && !('dispositivo_id' in params)
  ? Object.assign({ dispositivo_id: DISP }, params) : params);

let pasadas = 0, fallidas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; return; }
    fallidas++;
    fallos.push(descripcion + (detalle ? `\n      ${detalle}` : ''));
}
function igual(descripcion, real, esperado) {
    verificar(descripcion, JSON.stringify(real) === JSON.stringify(esperado),
        `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}

// Una excepción aquí no debe tumbar la ejecución: se anota como fallo y se
// sigue, para ver el alcance real en vez de solo el primer tropiezo.
try {
    // ---------- Un bloque que no cabe en una sola celda ----------
    const bloque = 'A'.repeat(120000);
    const partes = [bloque.substr(0, 49000), bloque.substr(49000, 49000), bloque.substr(98000, 49000), ''];

    let r = llamar({ action: 'guardar_sync', codigo: 'ABC123',
                     datos: partes[0], datos_2: partes[1], datos_3: partes[2], datos_4: partes[3] });
    verificar('guardar un bloque de 120 000 caracteres', r.success, r.mensaje);

    const fila = hoja._datos[1];
    const largos = [10, 11, 12, 13].map(i => String(fila[i] || '').length);
    igual('se reparte entre las celdas sin perder nada',
        largos.reduce((a, b) => a + b, 0), bloque.length);
    verificar('ninguna celda supera el límite de Google Sheets',
        largos.every(n => n <= 50000), largos.join(' + '));

    // ---------- Vuelve entero ----------
    r = llamar({ action: 'obtener_sync', codigo: 'ABC123' });
    igual('al leerlo vuelve idéntico al original', r.datos, bloque);

    // ---------- Un bloque corto no deja cola del anterior ----------
    // Este es el fallo que corrompería datos en silencio: si las celdas sobrantes
    // no se vacían, el bloque leído sale más largo de lo que se guardó.
    llamar({ action: 'guardar_sync', codigo: 'ABC123', datos: 'corto' });
    r = llamar({ action: 'obtener_sync', codigo: 'ABC123' });
    igual('sobrescribir con algo más corto no arrastra cola', r.datos, 'corto');

    // ---------- Respaldo del borrado masivo ----------
    llamar({ action: 'guardar_sync', codigo: 'ABC123',
             datos: partes[0], datos_2: partes[1], datos_3: partes[2] });
    r = llamar({ action: 'respaldar_sync', codigo: 'ABC123' });
    verificar('respaldar responde bien', r.success, r.mensaje);
    igual('y avisa de que había algo que respaldar', r.respaldado, true);

    verificar('las columnas de datos quedan vacías',
        [10, 11, 12, 13].every(i => !fila[i]), JSON.stringify([10,11,12,13].map(i => String(fila[i]||'').length)));
    verificar('las de respaldo quedan con el contenido',
        [14, 15, 16, 17].some(i => fila[i]));
    verificar('se guarda la fecha del respaldo', !!fila[18]);

    r = llamar({ action: 'obtener_sync', codigo: 'ABC123' });
    verificar('tras respaldar, la nube se lee vacía', !r.datos, String(r.datos).slice(0, 40));

    // ---------- Restaurar ----------
    const restaurado = vm.runInContext('restaurarRespaldoSync("ABC123")', sandbox);
    r = llamar({ action: 'obtener_sync', codigo: 'ABC123' });
    verificar('restaurar responde bien', restaurado.success, restaurado.mensaje);
    igual('y recupera el bloque original entero', r.datos, bloque);

    // ---------- Compatibilidad con el cliente anterior ----------
    // Un navegador con la versión vieja en caché solo manda "datos".
    llamar({ action: 'guardar_sync', codigo: 'ABC123', datos: 'solo-datos-antiguo' });
    r = llamar({ action: 'obtener_sync', codigo: 'ABC123' });
    igual('un cliente antiguo sigue guardando y leyendo', r.datos, 'solo-datos-antiguo');

    // ---------- La configuración sobrevive a actualizar el código ----------
    // Pegar una versión nueva de codigo.gs deja las constantes en su valor de
    // ejemplo. Si eso bastara para romperlo, cada actualización tumbaría la
    // sincronización de todo el mundo, que es justo lo que pasó.
    propiedades.SPREADSHEET_ID = '';
    propiedades.SHEET_NAME = '';
    let errorConfig = null;
    try { vm.runInContext('getSheet()', sandbox); } catch (e) { errorConfig = e.message; }

    verificar('sin configurar, el error dice dónde escribirlo',
        /SPREADSHEET_ID/.test(errorConfig || '') && /SHEET_NAME/.test(errorConfig || ''), errorConfig);
    verificar('y no suelta el error críptico de Google',
        !/Illegal spreadsheet id/.test(errorConfig || ''), errorConfig);

    // Una pestaña que no existe: el otro error que se veía como "reading null"
    propiedades.SPREADSHEET_ID = ID_PRUEBA;
    propiedades.SHEET_NAME = 'PestanaQueNoExiste';
    let errorPestana = null;
    try { vm.runInContext('getSheet()', sandbox); } catch (e) { errorPestana = e.message; }

    verificar('una pestaña inexistente se explica con nombre',
        /PestanaQueNoExiste/.test(errorPestana || ''), errorPestana);
    verificar('y enumera las pestañas que sí existen',
        /Licencias/.test(errorPestana || ''), errorPestana);
    verificar('sin el "Cannot read properties of null"',
        !/Cannot read properties/.test(errorPestana || ''), errorPestana);

    // configurar() valida antes de guardar
    propiedades.SHEET_NAME = 'Licencias';
    let errorConfigurar = null;
    try { vm.runInContext('configurar("' + ID_PRUEBA + '", "NoExiste")', sandbox); }
    catch (e) { errorConfigurar = e.message; }
    verificar('configurar() rechaza una pestaña que no existe',
        /NoExiste/.test(errorConfigurar || ''), errorConfigurar);

    let errorEjemplo = null;
    try { vm.runInContext('configurar("TU_SPREADSHEET_ID_AQUI")', sandbox); }
    catch (e) { errorEjemplo = e.message; }
    verificar('configurar() rechaza el id de ejemplo',
        /no parece el id/.test(errorEjemplo || ''), errorEjemplo);

    // El editor de Apps Script ejecuta la función seleccionada SIN pasarle
    // argumentos. Antes eso caía en el mismo mensaje que un id mal escrito
    // ("pasa el id real de tu hoja") y no había forma de adivinar que el
    // problema era el botón y no el id.
    let errorSinArgumentos = null;
    try { vm.runInContext('configurar()', sandbox); }
    catch (e) { errorSinArgumentos = e.message; }
    verificar('ejecutar configurar desde el botón ▶ manda a configurarAqui',
        /configurarAqui/.test(errorSinArgumentos || ''), errorSinArgumentos);
    verificar('y no culpa al id, que no es el problema',
        !/no parece el id/.test(errorSinArgumentos || ''), errorSinArgumentos);

    const guardado = vm.runInContext('configurar("' + ID_PRUEBA + '", "Licencias")', sandbox);
    verificar('configurar() guarda cuando todo es correcto', guardado.success, JSON.stringify(guardado));
    igual('y queda registrado en las propiedades del script',
        propiedades.SPREADSHEET_ID, ID_PRUEBA);

    // ---------- El fallo que dejó la app sin sincronizar ----------
    // SPREADSHEET_ID y el id de ejemplo estaban una línea debajo de la otra
    // con el mismo valor. Al sustituir "el id de tu hoja" se cambiaban las
    // dos, y entonces el id REAL pasaba a ser "el id de ejemplo": el script se
    // declaraba sin configurar y configurar() rechazaba el id bueno.
    const REAL = '18U5xEDwgHoI0IK1RZAEcG_j736Q12LFCM5ayGvQX00U';
    verificar('un id real no se confunde con un texto de ejemplo',
        vm.runInContext('idSinConfigurar("' + REAL + '")', sandbox) === false);
    verificar('el texto de ejemplo sí se detecta',
        vm.runInContext('idSinConfigurar("TU_SPREADSHEET_ID_AQUI")', sandbox) === true);
    verificar('y un id vacío también',
        vm.runInContext('idSinConfigurar("")', sandbox) === true);

    // Con configuración guardada la constante del archivo da igual: es lo que
    // permite pegar una versión nueva de codigo.gs sin romper nada.
    propiedades.SPREADSHEET_ID = ID_PRUEBA;
    propiedades.SHEET_NAME = 'Licencias';
    let errorConGuardado = null;
    try { vm.runInContext('getSheet()', sandbox); } catch (e) { errorConGuardado = e.message; }
    verificar('con la configuración guardada, getSheet() no protesta', !errorConGuardado, errorConGuardado);

    // ---------- configurarAqui() ----------
    verificar('configurarAqui() existe para ejecutarla desde el botón ▶',
        vm.runInContext('typeof configurarAqui', sandbox) === 'function');

    const antesDeAqui = propiedades.SPREADSHEET_ID;
    let errorAqui = null;
    try { vm.runInContext('configurarAqui()', sandbox); } catch (e) { errorAqui = e.message; }
    verificar('con las constantes sin rellenar, configurarAqui avisa en vez de guardar basura',
        /no parece el id/.test(errorAqui || ''), errorAqui);
    igual('y deja intacta la configuración que ya había',
        propiedades.SPREADSHEET_ID, antesDeAqui);

    // configurarAqui NO tiene copia propia del id: lo toma de las constantes.
    // Tenerlo escrito en dos sitios es una copia que se desincroniza el día
    // que cambie uno de los dos.
    const fuenteAqui = fs.readFileSync(GS, 'utf8')
        .match(/function configurarAqui\(\)[\s\S]*?\n\}/)[0];
    verificar('configurarAqui toma el id de SPREADSHEET_ID, no de una copia suya',
        /configurar\(SPREADSHEET_ID, SHEET_NAME\)/.test(fuenteAqui), fuenteAqui);

    // ---------- limpiarCeldaSync no puede dejar cola ----------
    // Vaciaba solo la columna K; las otras tres se quedaban con su parte y al
    // concatenarlas salía un bloque corrupto.
    llamar({ action: 'guardar_sync', codigo: 'ABC123',
             datos: partes[0], datos_2: partes[1], datos_3: partes[2] });
    vm.runInContext('limpiarCeldaSync("ABC123")', sandbox);
    r = llamar({ action: 'obtener_sync', codigo: 'ABC123' });
    verificar('limpiarCeldaSync vacía las cuatro columnas, no solo la primera',
        !r.datos, 'quedaron ' + String(r.datos || '').length + ' caracteres');


    // ---------- Rellenar solo las constantes tiene que bastar ----------
    // Es lo que hace todo el mundo: pegar el script y sustituir el id en
    // SPREADSHEET_ID. Si eso no funcionara sin ejecutar además una función,
    // el script estaría pidiendo un paso que nadie adivina.
    const codigoDelUsuario = fs.readFileSync(GS, 'utf8')
        .replace("const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_AQUI';",
                 "const SPREADSHEET_ID = '" + ID_PRUEBA + "';")
        .replace("const SHEET_NAME = 'Licencias';", "const SHEET_NAME = 'Otra';");

    const sinGuardar = {};
    const sandbox2 = Object.assign({}, sandbox, {
        PropertiesService: { getScriptProperties: () => propiedadesFalsas(sinGuardar) }
    });
    vm.createContext(sandbox2);
    vm.runInContext(codigoDelUsuario, sandbox2);

    let errorSoloConstantes = null;
    try { vm.runInContext('getSheet()', sandbox2); } catch (e) { errorSoloConstantes = e.message; }
    verificar('con las constantes rellenas, funciona sin ejecutar nada',
        !errorSoloConstantes, errorSoloConstantes);

    // Y configurarAqui las pasa a las propiedades sin volver a escribirlas.
    const paso = vm.runInContext('configurarAqui()', sandbox2);
    verificar('configurarAqui las guarda sin pedir el id otra vez', paso.success, JSON.stringify(paso));
    igual('guarda el id de la constante', sinGuardar.SPREADSHEET_ID, ID_PRUEBA);
    igual('y la pestaña de la constante', sinGuardar.SHEET_NAME, 'Otra');

    // ---------- La hora del servidor ----------
    // Es el único reloj que comparten los dispositivos. Sin ella, el que lleve
    // la hora atrasada sella sus ediciones en el pasado y las pierde al
    // fusionar contra otras más viejas.
    r = llamar({ action: 'obtener_sync', codigo: 'ABC123' });
    verificar('toda respuesta trae la hora del servidor',
        !!r.servidorAhora && !isNaN(Date.parse(r.servidorAhora)), JSON.stringify(r.servidorAhora));

    r = llamar({ action: 'accion_que_no_existe' });
    verificar('incluso cuando la acción no existe',
        !!r.servidorAhora, JSON.stringify(r));

    // ---------- Reporte de errores ----------
    correosEnviados.length = 0;

    r = llamar({ action: 'reportar_bug', descripcion: '' });
    verificar('un reporte vacío no manda nada', !r.success && correosEnviados.length === 0,
        JSON.stringify(r));

    r = llamar({ action: 'reportar_bug', descripcion: 'La importación duplica expedientes',
                 contexto: 'Versión: v8.0\nRegistros: expedientes=900', contacto: 'abogado@ejemplo.mx' });
    verificar('un reporte con texto se manda', r.success, JSON.stringify(r));
    igual('llega un solo correo', correosEnviados.length, 1);
    igual('al buzón de soporte', correosEnviados[0].destino, 'jorge_clemente@empirica.mx');
    verificar('el asunto lleva la primera línea',
        /La importación duplica expedientes/.test(correosEnviados[0].asunto), correosEnviados[0].asunto);
    verificar('el cuerpo trae la descripción y los datos técnicos',
        /duplica expedientes/.test(correosEnviados[0].cuerpo) &&
        /expedientes=900/.test(correosEnviados[0].cuerpo));
    igual('y se puede responder al que reporta',
        correosEnviados[0].opciones.replyTo, 'abogado@ejemplo.mx');
    verificar('nunca como html: lo escribe un desconocido',
        !correosEnviados[0].opciones.htmlBody);

    // Este endpoint es público —su url está en el javascript de la web—, así
    // que si el destinatario saliera de la petición, cualquiera podría usarlo
    // para mandar correo a quien quisiera desde esta cuenta.
    correosEnviados.length = 0;
    llamar({ action: 'reportar_bug', descripcion: 'intento de relé',
             destinatario: 'victima@ejemplo.com', to: 'victima@ejemplo.com',
             CORREO_REPORTES: 'victima@ejemplo.com' });
    igual('no se puede redirigir el correo a otra dirección',
        correosEnviados.map(c => c.destino), ['jorge_clemente@empirica.mx']);

    // Un salto de línea en replyTo permitiría colar cabeceras extra.
    correosEnviados.length = 0;
    llamar({ action: 'reportar_bug', descripcion: 'con cabecera colada',
             contacto: 'a@b.com\nBcc: otro@ejemplo.com' });
    verificar('un contacto con salto de línea se descarta entero',
        !correosEnviados[0].opciones.replyTo,
        JSON.stringify(correosEnviados[0].opciones));

    // El tope diario evita que una tarde de insistencia agote el cupo de
    // correo de la cuenta.
    correosEnviados.length = 0;
    propiedades.REPORTES_DIA = new Date().toISOString().substring(0, 10) + '|40';
    r = llamar({ action: 'reportar_bug', descripcion: 'uno más' });
    verificar('pasado el tope diario deja de mandar', !r.success && correosEnviados.length === 0,
        JSON.stringify(r));
    verificar('y dice a dónde escribir mientras tanto',
        /jorge_clemente@empirica\.mx/.test(r.mensaje || ''), r.mensaje);
    delete propiedades.REPORTES_DIA;

    // Reportar un fallo no puede depender de que la hoja esté bien: un error
    // de configuración de la hoja es justo de lo que la gente querrá avisar.
    correosEnviados.length = 0;
    const idBueno = propiedades.SPREADSHEET_ID;
    propiedades.SPREADSHEET_ID = '';
    r = llamar({ action: 'reportar_bug', descripcion: 'no me sincroniza' });
    verificar('se puede reportar aunque la hoja no esté configurada',
        r.success && correosEnviados.length === 1, JSON.stringify(r));
    propiedades.SPREADSHEET_ID = idBueno;

    // ---------- Versión esperada: también la vacía ----------
    // Dos dispositivos que sincronizan por primera vez a la vez: los dos vieron
    // la nube vacía (versión ''). Antes '' contaba como "sin versión" y el
    // segundo borraba lo que acababa de subir el primero.
    llamar({ action: 'guardar_sync', codigo: 'ABC123', datos: '' });   // dejarla vacía
    vm.runInContext('limpiarCeldaSync("ABC123")', sandbox);
    r = llamar({ action: 'obtener_sync', codigo: 'ABC123' });
    igual('la nube vacía tiene versión vacía', r.version, '');
    r = llamar({ action: 'guardar_sync', codigo: 'ABC123', datos: 'del teléfono', version_expected: '' });
    verificar('el primero en subir sobre la nube vacía entra', r.success, JSON.stringify(r));
    r = llamar({ action: 'guardar_sync', codigo: 'ABC123', datos: 'de la computadora', version_expected: '' });
    verificar('el segundo, que también la vio vacía, recibe conflicto en vez de pisar',
        r.conflict === true && !r.success, JSON.stringify(r));
    igual('y la nube conserva lo del primero', llamar({ action: 'obtener_sync', codigo: 'ABC123' }).datos, 'del teléfono');

    // ---------- Una escritura a la vez ----------
    const pedidosAntes = candado.pedidos;
    llamar({ action: 'guardar_sync', codigo: 'ABC123', datos: 'x' });
    llamar({ action: 'respaldar_sync', codigo: 'ABC123' });
    igual('guardar y respaldar toman el candado', candado.pedidos - pedidosAntes, 2);
    igual('y lo sueltan al terminar', candado.tomado, false);

    // ---------- Miles de expedientes: más de cuatro celdas ----------
    r = llamar({ action: 'obtener_sync', codigo: 'ABC123' });
    igual('el servidor dice cuántos trozos admite', r.celdas, 20);

    // Una hoja real empieza con 26 columnas (A a Z): las de datos nuevas que
    // pasen de ahí deben crearse solas, y pedir un rango fuera es un error.
    let ancho = 26;
    const getRangeOriginal = hoja.getRange.bind(hoja);
    hoja.getMaxColumns = () => ancho;
    hoja.insertColumnsAfter = (despues, cuantas) => { ancho += cuantas; };
    hoja.getRange = (fila, col, nFilas, nCols) => {
        if (col + (nCols || 1) - 1 > ancho) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
        return getRangeOriginal(fila, col, nFilas, nCols);
    };
    try {
        // Con una hoja de 26 columnas, el bloque corto se lee sin tocar nada.
        llamar({ action: 'guardar_sync', codigo: 'ABC123', datos: 'pequeño' });
        igual('un bloque pequeño no ensancha la hoja', ancho, 26);
        igual('y se lee bien aunque la hoja no tenga las columnas nuevas',
            llamar({ action: 'obtener_sync', codigo: 'ABC123' }).datos, 'pequeño');

        const enorme = 'B'.repeat(49000 * 14 + 123);   // 15 celdas: llega a la columna AD
        const trozos = {};
        for (let i = 0; i < 20; i++) trozos[i === 0 ? 'datos' : 'datos_' + (i + 1)] = enorme.substr(i * 49000, 49000);
        r = llamar(Object.assign({ action: 'guardar_sync', codigo: 'ABC123' }, trozos));
        verificar('un bloque de quince celdas se guarda', r.success, JSON.stringify(r).slice(0, 200));
        verificar('la hoja se ensancha lo justo', ancho === 30, String(ancho));
        igual('vuelve idéntico', (llamar({ action: 'obtener_sync', codigo: 'ABC123' }).datos || '').length, enorme.length);
        verificar('las columnas de respaldo (O a S) no se tocan al escribir en T en adelante',
            [14, 15, 16, 17].every(i => !String(hoja._datos[1][i] || '').startsWith('B')));

        r = llamar({ action: 'respaldar_sync', codigo: 'ABC123' });
        verificar('el respaldo guarda el bloque grande entero', r.respaldado === true, JSON.stringify(r));
        vm.runInContext('restaurarRespaldoSync("ABC123")', sandbox);
        igual('y se restaura entero', (llamar({ action: 'obtener_sync', codigo: 'ABC123' }).datos || '').length, enorme.length);

        llamar({ action: 'guardar_sync', codigo: 'ABC123', datos: 'corto otra vez' });
        igual('un bloque corto vacía también las columnas nuevas',
            llamar({ action: 'obtener_sync', codigo: 'ABC123' }).datos, 'corto otra vez');
    } finally {
        delete hoja.getMaxColumns; delete hoja.insertColumnsAfter;
        hoja.getRange = getRangeOriginal;
    }


    // ---------- La sincronización exige un dispositivo registrado ----------
    llamar({ action: 'guardar_sync', codigo: 'ABC123', datos: 'privado' });
    r = llamarCrudo({ action: 'obtener_sync', codigo: 'ABC123' });
    verificar('sin dispositivo no se entregan los datos', r.success === false && r.datos === undefined && r.razon === 'dispositivo_no_registrado', JSON.stringify(r));
    r = llamarCrudo({ action: 'obtener_sync', codigo: 'ABC123', dispositivo_id: 'OTRO-DISPOSITIVO' });
    verificar('con un dispositivo que no está en la licencia, tampoco', r.success === false && r.datos === undefined && r.razon === 'dispositivo_no_registrado', JSON.stringify(r));
    r = llamarCrudo({ action: 'guardar_sync', codigo: 'ABC123', dispositivo_id: 'OTRO-DISPOSITIVO', datos: 'pisado' });
    verificar('ni se pueden pisar', r.success === false);
    r = llamarCrudo({ action: 'respaldar_sync', codigo: 'ABC123', dispositivo_id: 'OTRO-DISPOSITIVO' });
    verificar('ni vaciar', r.success === false);
    igual('los datos siguen intactos', llamar({ action: 'obtener_sync', codigo: 'ABC123' }).datos, 'privado');

    // ---------- Por GET (código en la URL) la sincronización no responde ----------
    r = llamarCrudo({ action: 'obtener_sync', codigo: 'ABC123', dispositivo_id: DISP }, 'GET');
    verificar('obtener_sync por GET no entrega datos y pide actualizar la app', r.success === false && r.datos === undefined && r.razon === 'actualizar_app', JSON.stringify(r));
    r = llamarCrudo({ action: 'guardar_sync', codigo: 'ABC123', dispositivo_id: DISP, datos: 'por get' }, 'GET');
    verificar('guardar_sync por GET tampoco', r.success === false && r.razon === 'actualizar_app');
    r = llamarCrudo({ action: 'verificar', codigo: 'NO-EXISTE', dispositivo_id: 'x' }, 'GET');
    igual('verificar sigue respondiendo por GET (apps y Worker anteriores)', r.mensaje, 'Código no encontrado');

    // ---------- Los ids de dispositivo no se entregan completos ----------
    r = llamar({ action: 'obtener_dispositivos', codigo: 'ABC123' });
    verificar('obtener_dispositivos recorta los ids', r.success && r.dispositivos.length === 1 && r.dispositivos[0].id !== DISP && r.dispositivos[0].id.endsWith('...'), JSON.stringify(r.dispositivos));

    // ---------- Tope de transferencias ----------
    const transferir = (id) => llamar({ action: 'transferir', codigo: 'ABC123', nuevo_dispositivo_id: id });
    r = transferir('NUEVO-1');
    verificar('la primera transferencia pasa', r.success === true, JSON.stringify(r));
    r = transferir(DISP);
    verificar('la segunda (el dueño la recupera) también', r.success === true, JSON.stringify(r));
    r = transferir('NUEVO-2');
    verificar('la tercera en 30 días, no: manda a soporte', r.success === false && r.razon === 'tope_transferencias' && /soporte/.test(r.mensaje), JSON.stringify(r));
    verificar('y la licencia sigue en el dispositivo del dueño', JSON.parse(hoja._datos[1][9]).map(d => d.id).join() === DISP, hoja._datos[1][9]);
    verificar('el tope se guarda sin el código en claro', Object.keys(propiedades).some(k => /^transf_/.test(k)) && !Object.keys(propiedades).some(k => /ABC123/.test(k)));

} catch (e) {
    fallidas++;
    fallos.push('la prueba reventó — ' + e.message);
}

// ---------- Resultado ----------
console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas\n`);
if (fallidas > 0) {
    console.log('FALLOS:');
    fallos.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
}
console.log('✓ El Apps Script reparte, respalda y restaura sin perder datos.');
