/**
 * El Apps Script de sincronización, ejecutado de verdad fuera de Google.
 *
 * Carga docs/google-apps-script/codigo.gs tal cual en una máquina virtual de
 * Node, con una hoja de cálculo de mentira debajo, para que las pruebas de
 * navegador hablen con el mismo código que se despliega y no con una copia
 * que se queda atrás. Lo usa test_ui_navegador.js: cada contexto de Chromium
 * es un "dispositivo" y todos comparten esta misma hoja.
 *
 * No es un módulo de la app: vive en test_fixtures/ para que el bucle de CI
 * (test_*.js) no lo ejecute como si fuera una prueba.
 */

const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');

const GS = path.join(__dirname, '..', 'docs', 'google-apps-script', 'codigo.gs');
const ID_PRUEBA = '1TESTtestTESTtestTESTtestTESTtestTESTtest123';
const CABECERA = ['codigo', 'fecha_exp', 'disp', 'usuario', 'estado', 'freg', 'intentos', 'ultimo', 'max', 'disp_json',
                  'datos_sync', 'datos_2', 'datos_3', 'datos_4', 'resp_1', 'resp_2', 'resp_3', 'resp_4', 'resp_fecha'];

function crearHoja(datos) {
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
                        out.push(Array.from({ length: nCols }, (_, c) => f[col - 1 + c] !== undefined ? f[col - 1 + c] : ''));
                    }
                    return out;
                },
                getValue: () => (datos[fila - 1] || [])[col - 1] ?? '',
                setValues: (v) => {
                    v.forEach((f, r) => f.forEach((val, c) => {
                        // Como en Sheets: una celda no admite más de 50 000
                        // caracteres. Sin esto la prueba no vería el límite.
                        if (String(val).length > 50000) {
                            throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
                        }
                        while (datos[fila - 1 + r].length < col - 1 + c) datos[fila - 1 + r].push('');
                        datos[fila - 1 + r][col - 1 + c] = val;
                    }));
                },
                setValue: (v) => {
                    while (datos[fila - 1].length < col - 1) datos[fila - 1].push('');
                    datos[fila - 1][col - 1] = v;
                }
            };
        }
    };
}

/**
 * Crea un servidor simulado con una licencia perpetua `codigo`.
 * Devuelve { llamar(params), hoja, bloque() }.
 */
function crearAppsScriptSimulado(codigo = 'LIC-DATOS') {
    const hoja = crearHoja([CABECERA, [codigo, 'perpetua', '', '', 'activo', '', 0, '', 5, '[]',
                                       '', '', '', '', '', '', '', '', '']]);
    const propiedades = { SPREADSHEET_ID: ID_PRUEBA, SHEET_NAME: 'Licencias' };
    const sandbox = {
        PropertiesService: {
            getScriptProperties: () => ({
                getProperties: () => Object.assign({}, propiedades),
                setProperties: (p) => Object.assign(propiedades, p),
                getProperty: (k) => (k in propiedades ? propiedades[k] : null),
                setProperty: (k, v) => { propiedades[k] = v; }
            })
        },
        SpreadsheetApp: {
            openById: () => ({
                getName: () => 'Hoja de prueba',
                getSheetByName: (n) => (n === 'Licencias' ? hoja : null),
                getSheets: () => [{ getName: () => 'Licencias' }]
            }),
            flush: () => {}
        },
        // Una sola ejecución a la vez, como garantiza el candado real. Aquí
        // todo es síncrono, así que basta con contar que se pidió.
        LockService: {
            getScriptLock: () => ({
                waitLock: () => { sandbox.__candados = (sandbox.__candados || 0) + 1; },
                tryLock: () => { sandbox.__candados = (sandbox.__candados || 0) + 1; return true; },
                releaseLock: () => {}
            })
        },
        MailApp: { sendEmail: () => {} },
        Utilities: {
            computeDigest: (a, s) => Array.from(crypto.createHash('md5').update(String(s)).digest()),
            DigestAlgorithm: { MD5: 'MD5' }
        },
        ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
        Logger: { log: () => {} },
        Date, JSON, String, Number, Array, Object, isNaN, parseInt, parseFloat, console
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(GS, 'utf8'), sandbox);

    const llamar = (params) => JSON.parse(vm.runInContext(
        'procesarSolicitud(' + JSON.stringify(params) + ')', sandbox));

    // El bloque guardado ahora mismo en la nube, leído como lo lee el script
    // (todas sus columnas de datos unidas, no solo las cuatro primeras).
    const bloque = () => vm.runInContext('leerDatosSync(getSheet(), 2)', sandbox);

    return { llamar, hoja, bloque, sandbox };
}

module.exports = { crearAppsScriptSimulado };
