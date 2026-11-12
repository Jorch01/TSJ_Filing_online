#!/usr/bin/env node
/**
 * Pruebas de los límites del plan gratuito en el IMPI.
 *
 *   node test_cuotas_impi.js
 *
 * Sin Premium: 2 estudios de viabilidad en total y 5 búsquedas al mes. Lo que
 * se fija aquí:
 *   - el proxy (docs/proxy/impi-proxy-worker.js, sección CUOTAS) cuenta por
 *     IP + huella amplia, huella fina e id de dispositivo, y manda la mayor:
 *     otro navegador en el mismo equipo, o el mismo navegador desde otra red,
 *     no reinicia la cuenta;
 *   - el mes nuevo sí reinicia las búsquedas, pero no los estudios;
 *   - una licencia Premium vigente no cuenta; una inválida, sí;
 *   - las rutas de búsqueda exigen un pase firmado y vigente; uno alterado o
 *     vencido no sirve; sin KV ni secreto el proxy funciona como antes;
 *   - la cuenta local (cuotas-impi.js) junta sus copias y manda la mayor.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Q = require('./docs/js/cuotas-impi.js');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);

// La sección CUOTAS del worker, tal cual, en un contexto aislado.
const WORKER = fs.readFileSync(path.join(__dirname, 'docs', 'proxy', 'impi-proxy-worker.js'), 'utf8');
const seccion = WORKER.slice(WORKER.indexOf('// ==================== CUOTAS (INICIO)'), WORKER.indexOf('// ==================== CUOTAS (FIN)'));
const W = { crypto: globalThis.crypto, TextEncoder, btoa, atob, escape, decodeURIComponent, JSON, Math, Date, Promise, String, parseInt, encodeURIComponent, Uint8Array };
vm.createContext(W);
vm.runInContext("const CUOTA_HEADER = 'X-TSJ-Cuota';\n" + seccion +
    '\nthis.atenderCuota = atenderCuota; this.revisarPase = revisarPase; this.leerPase = leerPase; this.crearPase = crearPase; this.CUOTAS = CUOTAS;', W);

function kv() {
    const m = new Map();
    return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } };
}
const env = () => ({ CUOTAS: kv(), CUOTA_SECRETO: 'secreto-de-prueba-largo' });
const MES1 = Date.parse('2026-10-15T12:00:00Z');
const MES2 = Date.parse('2026-11-02T12:00:00Z');
const chrome = { huella: { amplia: 'equipo-1', fina: 'chrome-1' }, dispositivo: 'disp-chrome' };
const safari = { huella: { amplia: 'equipo-1', fina: 'safari-1' }, dispositivo: 'disp-safari' };
const otroEquipo = { huella: { amplia: 'equipo-2', fina: 'chrome-2' }, dispositivo: 'disp-2' };
const sinLicencia = async () => { throw new Error('no debería consultarse'); };
const peticion = (pase) => ({ headers: { get: (h) => (h === 'X-TSJ-Cuota' ? pase : null) } });

(async () => {
    console.log('\nEl proxy cuenta las búsquedas');
    {
        const e = env();
        const pedir = (quien, ip, ahora) => W.atenderCuota(e, ip, { tipo: 'busqueda', ...quien }, ahora || MES1, sinLicencia);
        const r = [];
        for (let i = 0; i < 5; i++) r.push((await pedir(chrome, '1.1.1.1')).datos);
        igual('las 5 del mes se permiten', r.map(x => x.permitido), [true, true, true, true, true]);
        igual('y cuenta 1 a 5', r.map(x => x.usados), [1, 2, 3, 4, 5]);
        verificar('cada una trae su pase', r.every(x => typeof x.pase === 'string' && x.pase.includes('.')));
        const sexta = (await pedir(chrome, '1.1.1.1')).datos;
        igual('la sexta, no', [sexta.permitido, sexta.usados, sexta.limite, sexta.pase], [false, 5, 5, undefined]);
        igual('en Safari del mismo equipo y la misma red, tampoco', (await pedir(safari, '1.1.1.1')).datos.permitido, false);
        igual('el mismo Chrome desde otra red, tampoco', (await pedir(chrome, '9.9.9.9')).datos.permitido, false);
        igual('otro equipo tiene sus propias 5', (await pedir(otroEquipo, '1.1.1.1')).datos.usados, 1);
        igual('el mes siguiente se vuelve a poder', (await pedir(chrome, '1.1.1.1', MES2)).datos.usados, 1);
    }

    console.log('\nLos estudios de viabilidad, 2 para siempre');
    {
        const e = env();
        const pedir = (quien, ahora) => W.atenderCuota(e, '1.1.1.1', { tipo: 'viabilidad', ...quien }, ahora, sinLicencia);
        igual('dos sí', [(await pedir(chrome, MES1)).datos.permitido, (await pedir(chrome, MES1)).datos.permitido], [true, true]);
        igual('el tercero no', (await pedir(chrome, MES1)).datos.permitido, false);
        igual('ni el mes siguiente', (await pedir(chrome, MES2)).datos.permitido, false);
        igual('ni desde otro navegador', (await pedir(safari, MES2)).datos.permitido, false);
        igual('los estudios no gastan búsquedas', (await W.atenderCuota(e, '1.1.1.1', { tipo: 'busqueda', ...chrome }, MES1, sinLicencia)).datos.usados, 1);
    }

    console.log('\nPremium');
    {
        const e = env();
        let consultas = 0;
        const api = (valido) => async (url, o) => { consultas++; const c = JSON.parse((o && o.body) || '{}'); verificar('se consulta la API de licencias por POST, sin el código en la URL', o && o.method === 'POST' && c.action === 'verificar' && c.codigo === 'LIC-1' && c.dispositivo_id === 'D1' && !/LIC-1/.test(url)); return { json: async () => ({ valido }) }; };
        const prem = { tipo: 'busqueda', ...chrome, licencia: { codigo: 'LIC-1', dispositivoId: 'D1' } };
        for (let i = 0; i < 8; i++) {
            const r = (await W.atenderCuota(e, '1.1.1.1', prem, MES1, api(true))).datos;
            if (!r.permitido || !r.premium || !r.pase) { verificar('con licencia vigente no hay límite', false, JSON.stringify(r)); break; }
        }
        igual('con licencia vigente no hay límite y se consulta una sola vez (se recuerda)', consultas, 1);
        const e2 = env();
        const falsa = (await W.atenderCuota(e2, '1.1.1.1', { ...prem, licencia: { codigo: 'LIC-1', dispositivoId: 'D1' } }, MES1, api(false))).datos;
        igual('una licencia inválida cuenta como gratuita', [falsa.premium, falsa.usados], [undefined, 1]);
    }

    console.log('\nLa IP cuenta aunque el navegador invente huellas nuevas');
    {
        const e = env();
        let n = 0;
        const inventado = () => ({ huella: { amplia: 'h-' + (++n), fina: 'f-' + n }, dispositivo: 'd-' + n });
        const r = [];
        for (let i = 0; i < 16; i++) r.push((await W.atenderCuota(e, '5.5.5.5', { tipo: 'busqueda', ...inventado() }, MES1, sinLicencia)).datos.permitido);
        igual('con huellas nuevas en cada intento, la IP se detiene en 3 veces el límite (15)', r.filter(Boolean).length, 15);
        igual('y el intento 16 ya no', r[15], false);
        igual('otra IP no se ve afectada', (await W.atenderCuota(e, '6.6.6.6', { tipo: 'busqueda', ...chrome }, MES1, sinLicencia)).datos.permitido, true);
        const s = [];
        for (let i = 0; i < 8; i++) s.push((await W.atenderCuota(e, '5.5.5.5', { tipo: 'sesiones', ...inventado() }, MES1, sinLicencia)).datos.permitido);
        igual('las consultas de prueba de sesiones: 6 por IP, aunque cambie la huella', s.filter(Boolean).length, 6);
        const e2 = env();
        const sinHuella = [];
        for (let i = 0; i < 6; i++) sinHuella.push((await W.atenderCuota(e2, '7.7.7.7', { tipo: 'busqueda' }, MES1, sinLicencia)).datos.permitido);
        igual('sin datos del equipo, la IP lleva el límite normal (5)', sinHuella.filter(Boolean).length, 5);
    }

    console.log('\nPremium solo en un dispositivo registrado');
    {
        const e = env();
        const prem = { tipo: 'busqueda', ...chrome, licencia: { codigo: 'LIC-2', dispositivoId: 'NUEVO' } };
        const r = (await W.atenderCuota(e, '1.1.1.1', prem, MES1, async () => ({ json: async () => ({ valido: true, requiereRegistro: true }) }))).datos;
        igual('un código válido en un dispositivo sin registrar cuenta como gratuito', [r.premium, r.usados], [undefined, 1]);
    }

    console.log('\nLa ficha completa de Marcanet');
    {
        const ruta = WORKER.slice(WORKER.indexOf("path === '/marcanet/full-detail'"), WORKER.indexOf('// ===== Sesiones de los Tribunales Colegiados'));
        verificar('la búsqueda por denominación solo corre con un pase vigente', /leerPase\(env\.CUOTA_SECRETO/.test(ruta) && /buscarPorNombre: conPase/.test(ruta));
        const manejador = WORKER.slice(WORKER.indexOf('async function handleMarcanetFullDetail'), WORKER.indexOf('// ==================== SESIONES SISE (INICIO)'));
        verificar('sin pase no se busca por nombre', /if \(searchNum \|\| \(denominacion && buscarPorNombre\)\)/.test(manejador));
        verificar('la respuesta ya no lleva diagnósticos internos (debugSnippets)', !/debug:\s*debugSnippets/.test(manejador));
    }

    console.log('\nLos pases');
    {
        const e = env();
        const pase = (await W.atenderCuota(e, '1.1.1.1', { tipo: 'busqueda', ...chrome }, MES1, sinLicencia)).datos.pase;
        igual('una búsqueda con pase pasa', await W.revisarPase(e, '/marcia/search', peticion(pase), MES1), null);
        verificar('sin pase no', !!(await W.revisarPase(e, '/siga/search', peticion(null), MES1)));
        const [datos, firma] = pase.split('.');
        verificar('un pase alterado no', !!(await W.revisarPase(e, '/marcanet/fonetica', peticion(datos + 'x.' + firma), MES1)));
        verificar('uno firmado con otro secreto no', !!(await W.revisarPase(e, '/marcanet/fonetica',
            peticion(await W.crearPase('otro-secreto', 'busqueda', false, MES1)), MES1)));
        verificar('uno vencido no', !!(await W.revisarPase(e, '/marcia/search', peticion(pase), MES1 + 11 * 60 * 1000)));
        igual('paginar o ver un detalle no necesita pase', await W.revisarPase(e, '/marcia/results', peticion(null), MES1), null);
        igual('sin KV ni secreto el proxy funciona como antes', await W.revisarPase({}, '/marcia/search', peticion(null), MES1), null);
        igual('y /cuota dice que no lleva la cuenta', (await W.atenderCuota({}, '1.1.1.1', { tipo: 'busqueda', ...chrome }, MES1, sinLicencia)).datos, { servidor: false, permitido: true });
        igual('un tipo desconocido se rechaza', (await W.atenderCuota(e, '1.1.1.1', { tipo: 'otra' }, MES1, sinLicencia)).status, 400);
        verificar('las revisiones automáticas tienen tope diario', W.CUOTAS.vigilancia.periodo === 'dia' && W.CUOTAS.vigilancia.limite > 0);
    }

    console.log('\nLa cuenta en el navegador');
    {
        igual('límites: 2 estudios para siempre y 5 búsquedas al mes',
            [Q.LIMITES.viabilidad.limite, Q.LIMITES.viabilidad.periodo, Q.LIMITES.busqueda.limite, Q.LIMITES.busqueda.periodo], [2, 'siempre', 5, 'mes']);
        const a = { busqueda: { mes: '2026-10', n: 2 }, viabilidad: { n: 1 } };
        const b = { busqueda: { mes: '2026-10', n: 4 }, sesiones: { n: 1 } };
        const c = { busqueda: { mes: '2026-09', n: 5 }, viabilidad: { n: 2 } };
        igual('de varias copias manda la mayor del mes en curso', Q.combinar([a, b, c], MES1), { viabilidad: { n: 2 }, busqueda: { mes: '2026-10', n: 4 }, sesiones: { n: 1 } });
        igual('lo de un mes anterior no cuenta', Q.usadosEn(c, 'busqueda', MES1), 0);
        igual('el estado dice cuántas quedan', Q.estado(Q.combinar([a, b], MES1), MES1),
            { viabilidad: { usados: 1, limite: 2, restantes: 1 }, busqueda: { usados: 4, limite: 5, restantes: 1 }, sesiones: { usados: 1, limite: 2, restantes: 1 } });
        igual('las consultas de prueba de las sesiones de colegiados: 2 en total, las mismas en la app y en el proxy',
            [Q.LIMITES.sesiones.limite, Q.LIMITES.sesiones.periodo, W.CUOTAS.sesiones.limite, W.CUOTAS.sesiones.periodo], [2, 'siempre', 2, 'siempre']);
    }

    console.log('\nEn la app');
    {
        const leer = (f) => fs.readFileSync(path.join(__dirname, 'docs', f), 'utf8');
        const html = leer('index.html');
        verificar('el script se carga antes del estudio de viabilidad',
            html.indexOf('<script src="js/cuotas-impi.js"></script>') > -1 &&
            html.indexOf('<script src="js/cuotas-impi.js"></script>') < html.indexOf('<script src="js/impi-viabilidad.js"></script>'));
        verificar('funciona sin internet', /'js\/cuotas-impi\.js'/.test(leer('sw.js')));
        const impi = leer('js/impi-search.js');
        for (const f of ['buscarMARCia', 'buscarSIGA', 'buscarMarcanet', 'buscarEnLas3']) {
            const cuerpo = impi.slice(impi.indexOf('async function ' + f + '('), impi.indexOf('\n}\n', impi.indexOf('async function ' + f + '(')));
            verificar(`${f} pide permiso antes de buscar`, /autorizarBusquedaIMPI\(/.test(cuerpo));
        }
        verificar('buscar en las 3 cuenta una sola vez', /buscarMARCia\(\{ silencioso: true, cuotaAutorizada: true \}\)/.test(impi));
        verificar('el proxy recibe el pase en cada petición', /headers\['X-TSJ-Cuota'\] = paseCuota/.test(impi));
        verificar('el estudio de viabilidad pide permiso', /CUOTAS_IMPI\.autorizar\('viabilidad'\)/.test(leer('js/impi-viabilidad.js')));
        const cq = leer('js/cuotas-impi.js');
        verificar('la app sabe cuándo vence su pase (para reintentar sin gastar otro estudio)',
            /function vencePase\(\)/.test(cq) && /pase: \(\) => pase, vencePase,/.test(cq) && /Q\.vencePase\(\)/.test(leer('js/impi-viabilidad.js')));
        verificar('el proxy expone /cuota y deja pasar la cabecera del pase', WORKER.includes("path === '/cuota'") && /CLIENT_HEADER \+ ', ' \+ CUOTA_HEADER/.test(WORKER));
    }

    console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
    if (fallos.length) {
        console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
        process.exit(1);
    }
})();
