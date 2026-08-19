#!/usr/bin/env node
/**
 * Pruebas del diagnóstico de fallos de sincronización.
 *
 *   node test_sync_errores.js
 *
 * Durante mucho tiempo TODO fallo de subida se reportaba igual —"verifica tu
 * conexión a internet"— incluidos los que no tenían nada que ver con la
 * conexión. Eso mandó a buscar el problema donde no estaba en más de una
 * ocasión. Estas pruebas fijan que cada causa se distinga de las demás.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const SYNC = path.join(__dirname, 'docs', 'js', 'sync.js');

// ==================== CARGA DEL CÓDIGO REAL ====================

function extraerDeclaracion(fuente, nombre) {
    const lineas = fuente.split('\n');
    const patron = new RegExp(
        '^(?:async\\s+)?function\\s+' + nombre + '\\s*\\(' +
        '|^(?:const|let|var)\\s+' + nombre + '\\s*=');
    const inicio = lineas.findIndex(l => patron.test(l));
    if (inicio === -1) throw new Error(`No se encontró "${nombre}" en sync.js (¿se renombró?)`);
    if (/;\s*$/.test(lineas[inicio])) return lineas[inicio];
    for (let i = inicio + 1; i < lineas.length; i++) {
        if (/^[}\])]/.test(lineas[i])) return lineas.slice(inicio, i + 1).join('\n');
    }
    throw new Error(`Declaración incompleta de "${nombre}" en sync.js`);
}

function cargar() {
    const estado = { toasts: [], avisosConsola: [] };
    const sandbox = {
        console: {
            log: () => {},
            warn: (m) => estado.avisosConsola.push(String(m)),
            error: () => {}
        },
        estado,
        PREMIUM_CONFIG: { apiUrl: 'https://ejemplo.invalido/exec' },
        estadoPremium: { activo: true, codigo: 'TEST' },
        setTimeout, clearTimeout, AbortController,
        fetch: async () => { throw new Error('fetch no debería llegar a usarse aquí'); }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    const src = fs.readFileSync(SYNC, 'utf8');
    for (const n of ['_clasificarErrorFetch', '_mensajeErrorFetch',
                     'LIMITE_CELDA_SHEETS', 'AVISO_CELDA_SHEETS', 'subirDatosRemotos']) {
        vm.runInContext(extraerDeclaracion(src, n), sandbox, { filename: `sync.js:${n}` });
    }

    // subirDatosRemotos llama a fetchConReintentos cuando el tamaño sí cabe.
    // Aquí no interesa la red: se sustituye para que el fallo sea reconocible.
    vm.runInContext(
        'function fetchConReintentos() { throw new Error("__llego_a_la_red__"); }', sandbox);
    // Las declaraciones const/let no se cuelgan del objeto sandbox (no son
    // propiedades de globalThis), así que se leen evaluando en el contexto.
    const leer = (expr) => vm.runInContext(expr, sandbox);
    return { sandbox, estado, leer };
}

// ==================== UTILIDADES ====================

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

function errorCon(nombre, mensaje) {
    const e = new Error(mensaje);
    e.name = nombre;
    return e;
}

// ==================== PRUEBAS ====================

async function main() {
    const { sandbox, estado, leer } = cargar();

    // ---------- Cada causa se distingue ----------
    const clasificar = sandbox._clasificarErrorFetch;

    igual('el servidor no contesta a tiempo -> "tiempo"',
        clasificar(errorCon('AbortError', 'The operation was aborted')), 'tiempo');
    igual('no se alcanza el servidor -> "red"',
        clasificar(errorCon('TypeError', 'Failed to fetch')), 'red');
    igual('CORS bloqueado -> "red"',
        clasificar(errorCon('TypeError', 'NetworkError when attempting to fetch resource')), 'red');
    igual('Safari: "Load failed" -> "red"',
        clasificar(errorCon('Error', 'Load failed')), 'red');
    igual('el servidor responde con error -> "servidor"',
        clasificar(errorCon('Error', 'HTTP 500: Internal Server Error')), 'servidor');
    igual('el despliegue redirige a login -> "servidor"',
        clasificar(errorCon('Error', 'HTTP 401: Unauthorized')), 'servidor');
    igual('cualquier otra cosa -> "otro"',
        clasificar(errorCon('Error', 'Respuesta inválida del servidor')), 'otro');

    // ---------- Los mensajes no se confunden entre sí ----------
    const mensaje = sandbox._mensajeErrorFetch;

    const porTiempo = mensaje('tiempo', errorCon('AbortError', 'x'), 120);
    verificar('el mensaje por tiempo dice cuántos segundos esperó',
        /120 segundos/.test(porTiempo), porTiempo);
    verificar('el mensaje por tiempo NO culpa a la conexión a internet',
        !/conexión a internet/i.test(porTiempo), porTiempo);

    const porRed = mensaje('red', errorCon('TypeError', 'Failed to fetch'), 120);
    verificar('el mensaje de red menciona el despliegue de Apps Script',
        /Apps Script/.test(porRed), porRed);

    const porServidor = mensaje('servidor', errorCon('Error', 'HTTP 500: Internal Server Error'), 120);
    verificar('el mensaje de servidor incluye el código HTTP',
        /HTTP 500/.test(porServidor), porServidor);

    verificar('los tres mensajes son distintos entre sí',
        new Set([porTiempo, porRed, porServidor]).size === 3);

    // ---------- El límite de la celda se avisa antes de romper ----------
    const limite = leer('LIMITE_CELDA_SHEETS');
    igual('el límite es el de una celda de Google Sheets', limite, 50000);
    verificar('el umbral de aviso deja margen', leer('AVISO_CELDA_SHEETS') < limite);

    // Por debajo del límite ni siquiera se comprueba la red aquí: se deja pasar
    // y falla al hacer fetch, que es lo que queremos distinguir.
    let fallo = null;
    try {
        await sandbox.subirDatosRemotos('x'.repeat(limite + 1), null);
    } catch (e) { fallo = e; }

    verificar('pasado el límite, falla antes de intentar la subida', !!fallo);
    igual('y se marca como problema de tamaño', fallo && fallo.tipoFallo, 'tamano');
    verificar('el mensaje dice cuánto ocupa y cuánto cabe',
        /50\.001/.test(fallo.message) && /50\.000/.test(fallo.message), fallo.message);
    verificar('el mensaje deja claro que NO es la conexión',
        /no es un problema de conexión/i.test(fallo.message), fallo.message);
    verificar('y que reintentar no sirve',
        /reintentar no va a servir/i.test(fallo.message), fallo.message);

    // Cerca del límite avisa en consola, pero deja subir
    estado.avisosConsola = [];
    try {
        await sandbox.subirDatosRemotos('x'.repeat(leer('AVISO_CELDA_SHEETS') + 100), null);
    } catch (e) { /* falla al hacer fetch, que aquí no existe: da igual */ }
    verificar('cerca del límite avisa en consola sin bloquear',
        estado.avisosConsola.some(a => /caracteres que admite la celda/.test(a)),
        JSON.stringify(estado.avisosConsola));

    // ---------- Con cuántos datos se llega al límite ----------
    // No es una aserción sobre el código, sino una red de seguridad: si alguien
    // engorda el registro de un expediente, este número baja y conviene verlo.
    const ahora = new Date().toISOString();
    const expediente = (i) => {
        const e = {
            id: i, numero: `${1000 + i}/2025`, juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
            categoria: 'CANCÚN - Civil', institucion: 'TSJ',
            comentario: 'Juicio ordinario mercantil por incumplimiento de contrato',
            actor: 'Comercializadora del Caribe SA de CV',
            demandado: 'Constructora Peninsular SA de CV',
            activo: true, fechaCreacion: ahora, fechaActualizacion: ahora
        };
        e._fieldTimestamps = {};
        for (const k of Object.keys(e)) if (k !== '_fieldTimestamps' && k !== 'id') e._fieldTimestamps[k] = ahora;
        return e;
    };
    const tamanoDe = (n) => {
        const datos = {
            expedientes: Array.from({ length: n }, (_, i) => expediente(i + 1)),
            notas: [], eventos: [], pendientes: [], carpetas: [],
            config: [], eliminados: [], historial: [], sigaGuardadas: []
        };
        const gz = zlib.gzipSync(Buffer.from(JSON.stringify(datos), 'utf8'));
        return Math.ceil((gz.length + 28) / 3) * 4;   // + IV y tag de AES-GCM, luego base64
    };

    let cabenSinExtras = 0;
    for (let n = 500; n <= 20000; n += 500) {
        if (tamanoDe(n) > limite) break;
        cabenSinExtras = n;
    }
    verificar(`caben al menos 1000 expedientes sencillos (medido: ${cabenSinExtras})`,
        cabenSinExtras >= 1000, `solo caben ${cabenSinExtras}`);

    console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas`);
    console.log(`(referencia: entran ~${cabenSinExtras.toLocaleString('es')} expedientes sin pendientes ni eventos)\n`);
    if (fallidas > 0) {
        console.log('FALLOS:');
        fallos.forEach(f => console.log('  ✗ ' + f));
        process.exit(1);
    }
    console.log('✓ Cada fallo de sincronización se distingue de los demás.');
}

main().catch(e => { console.error(e); process.exit(1); });
