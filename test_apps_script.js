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

const fs = require('fs'), vm = require('vm');
const GS = '/home/user/TSJ_Filing_online/docs/google-apps-script/codigo.gs';

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

const CABECERA = ['codigo','fecha_exp','disp','usuario','estado','freg','intentos','ultimo','max','disp_json',
                  'datos_sync','datos_2','datos_3','datos_4','resp_1','resp_2','resp_3','resp_4','resp_fecha'];
const hoja = crearHoja([CABECERA, ['ABC123','perpetua','','','activo','',0,'',2,'[]','','','','','','','','','']]);

// Propiedades del script: aquí vive la configuración que sobrevive a las
// actualizaciones del código.
const propiedades = { SPREADSHEET_ID: 'ID-DE-PRUEBA', SHEET_NAME: 'Licencias' };

const sandbox = {
  PropertiesService: {
    getScriptProperties: () => ({
      getProperties: () => Object.assign({}, propiedades),
      setProperties: (p) => Object.assign(propiedades, p)
    })
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
  Utilities: { computeDigest: (a, s) => Array.from(require('crypto').createHash('md5').update(String(s)).digest()),
               DigestAlgorithm: { MD5: 'MD5' } },
  ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
  Logger: { log: () => {} },
  Date, JSON, String, Number, Array, Object, isNaN, parseInt, parseFloat, console
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(GS, 'utf8'), sandbox);

const llamar = (params) => JSON.parse(vm.runInContext(
  'procesarSolicitud(' + JSON.stringify(params) + ')', sandbox));

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

    verificar('sin configurar, el error dice qué ejecutar',
        /configurar\(/.test(errorConfig || ''), errorConfig);
    verificar('y no suelta el error críptico de Google',
        !/Illegal spreadsheet id/.test(errorConfig || ''), errorConfig);

    // Una pestaña que no existe: el otro error que se veía como "reading null"
    propiedades.SPREADSHEET_ID = 'ID-DE-PRUEBA';
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
    try { vm.runInContext('configurar("ID-DE-PRUEBA", "NoExiste")', sandbox); }
    catch (e) { errorConfigurar = e.message; }
    verificar('configurar() rechaza una pestaña que no existe',
        /NoExiste/.test(errorConfigurar || ''), errorConfigurar);

    let errorEjemplo = null;
    try { vm.runInContext('configurar("TU_SPREADSHEET_ID_AQUI")', sandbox); }
    catch (e) { errorEjemplo = e.message; }
    verificar('configurar() rechaza el id de ejemplo',
        /id real/.test(errorEjemplo || ''), errorEjemplo);

    const guardado = vm.runInContext('configurar("ID-DE-PRUEBA", "Licencias")', sandbox);
    verificar('configurar() guarda cuando todo es correcto', guardado.success, JSON.stringify(guardado));
    igual('y queda registrado en las propiedades del script',
        propiedades.SPREADSHEET_ID, 'ID-DE-PRUEBA');


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
