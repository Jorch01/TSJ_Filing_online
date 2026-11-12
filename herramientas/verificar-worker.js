#!/usr/bin/env node
/**
 * ¿El Worker publicado es el del repositorio?
 *
 * El Worker se publicaba pegándolo a mano en el panel de Cloudflare y se fue
 * desfasando del repo sin que nadie lo notara. WORKER_VERSION (en
 * docs/proxy/impi-proxy-worker.js) existe para eso: /health la devuelve y aquí
 * se compara.
 *
 *   node herramientas/verificar-worker.js                 una comprobación
 *   node herramientas/verificar-worker.js --intentos 6 --espera 10
 *       reintenta (tras un despliegue la versión nueva tarda unos segundos en
 *       llegar a todos los puntos de Cloudflare)
 *
 * Un desfase es un AVISO (::warning:: en GitHub Actions), no un fallo: el
 * Worker sigue sirviendo. Que /health no responda sí es un fallo (salida 1),
 * y con --exigir-cuotas también lo es que las cuotas estén inactivas (un
 * despliegue que pierde el KV CUOTAS o el secreto CUOTA_SECRETO deja el plan
 * gratuito sin límite del lado del servidor).
 * Lo usan el workflow de despliegue y el monitor de integraciones.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RUTA_WORKER = path.join(__dirname, '..', 'docs', 'proxy', 'impi-proxy-worker.js');
const URL_WORKER = 'https://throbbing-scene-1c2b.enlilh.workers.dev';

/** WORKER_VERSION tal como está escrita en el código del Worker. */
function versionDelRepo(texto) {
    const m = /const WORKER_VERSION\s*=\s*'([^']+)'/.exec(texto === undefined ? fs.readFileSync(RUTA_WORKER, 'utf8') : texto);
    return m ? m[1] : null;
}

/** { estado: 'ok' | 'aviso', mensaje } al comparar la versión del repo con la de /health. */
function compararVersion(repo, publicada) {
    if (!repo) return { estado: 'aviso', mensaje: 'No se encontró WORKER_VERSION en el código del repo' };
    if (!publicada) return { estado: 'aviso', mensaje: '/health no informa versión: el Worker publicado es anterior a WORKER_VERSION' };
    if (repo === publicada) return { estado: 'ok', mensaje: 'versión ' + publicada };
    return {
        estado: 'aviso',
        mensaje: 'El Worker publicado (' + publicada + ') no coincide con el del repo (' + repo + '): falta desplegarlo'
    };
}

async function leerHealth(fetchFn, base) {
    const r = await fetchFn(base.replace(/\/+$/, '') + '/health', { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('/health respondió HTTP ' + r.status);
    const datos = await r.json();
    if (!datos || datos.status !== 'ok') throw new Error('/health no dice status "ok"');
    return datos;
}

/**
 * Comprueba hasta `intentos` veces (con `espera` segundos entre una y otra)
 * que /health ya trae la versión del repo.
 * Devuelve { estado, mensaje, health }; lanza si /health nunca respondió.
 */
async function verificar({ fetchFn = fetch, base = URL_WORKER, repo = versionDelRepo(), intentos = 1, espera = 10, esperar = (s) => new Promise(r => setTimeout(r, s * 1000)) } = {}) {
    let ultimo = null;
    let errorFinal = null;
    for (let i = 0; i < Math.max(1, intentos); i++) {
        if (i > 0) await esperar(espera);
        try {
            const health = await leerHealth(fetchFn, base);
            errorFinal = null;
            ultimo = Object.assign(compararVersion(repo, health.version), { health });
            if (ultimo.estado === 'ok') return ultimo;
        } catch (e) {
            errorFinal = e;
        }
    }
    if (errorFinal && !ultimo) throw errorFinal;
    return ultimo;
}

async function main(argv) {
    const num = (nombre, defecto) => {
        const i = argv.indexOf(nombre);
        return i >= 0 ? Math.max(1, parseInt(argv[i + 1], 10) || defecto) : defecto;
    };
    try {
        const r = await verificar({ intentos: num('--intentos', 1), espera: num('--espera', 10) });
        if (argv.includes('--exigir-cuotas') && r.health.cuotas !== true) {
            const m = 'Las cuotas del Worker están inactivas: falta el KV CUOTAS o el secreto CUOTA_SECRETO';
            console.log('::error title=Cuotas inactivas::' + m);
            console.log('✗ ' + m);
            return 1;
        }
        if (r.estado === 'ok') {
            console.log('✓ ' + r.mensaje);
        } else {
            console.log('::warning title=Worker desfasado::' + r.mensaje);
            console.log('⚠ ' + r.mensaje);
        }
        return 0;
    } catch (e) {
        console.log('::error title=Worker sin respuesta::' + e.message);
        console.log('✗ ' + e.message);
        return 1;
    }
}

module.exports = { RUTA_WORKER, URL_WORKER, versionDelRepo, compararVersion, verificar };

if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c));
