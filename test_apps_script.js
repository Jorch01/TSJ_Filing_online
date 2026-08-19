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

const sandbox = {
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => hoja }) },
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

// ---------- Resultado ----------
console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas\n`);
if (fallidas > 0) {
    console.log('FALLOS:');
    fallos.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
}
console.log('✓ El Apps Script reparte, respalda y restaura sin perder datos.');
