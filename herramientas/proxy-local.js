#!/usr/bin/env node
/**
 * El proxy (docs/proxy/impi-proxy-worker.js) corriendo en esta computadora,
 * para probar sin publicar nada en Cloudflare.
 *
 *   node herramientas/proxy-local.js          → http://localhost:8787
 *   node herramientas/proxy-local.js 9000     → en otro puerto
 *
 * Sirve para las rutas que no necesitan nada de Cloudflare, como
 * /api/sesiones y /health. No hay KV: lo recordado vive en memoria y se
 * pierde al cerrar.
 *
 * Para que la app abierta en localhost use este proxy en la consulta de
 * sesiones, en la consola del navegador:
 *
 *   localStorage.setItem('sesiones_pjf_proxy_local', 'http://localhost:8787')
 *
 * (y localStorage.removeItem('sesiones_pjf_proxy_local') para volver al de
 * siempre). Fuera de localhost ese ajuste no hace nada.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PUERTO = parseInt(process.argv[2], 10) || 8787;
const WORKER = path.join(__dirname, '..', 'docs', 'proxy', 'impi-proxy-worker.js');

(async () => {
    // El worker es un módulo ES y el repositorio no: Node lo importa desde
    // una copia con extensión .mjs.
    const copia = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-local-')), 'worker.mjs');
    fs.copyFileSync(WORKER, copia);
    const worker = (await import(pathToFileURL(copia).href)).default;

    const servidor = http.createServer(async (req, res) => {
        try {
            const trozos = [];
            for await (const trozo of req) trozos.push(trozo);
            const cabeceras = {};
            for (const [nombre, valor] of Object.entries(req.headers)) {
                if (typeof valor === 'string' && !/^(host|connection|content-length|transfer-encoding)$/i.test(nombre)) cabeceras[nombre] = valor;
            }
            const resp = await worker.fetch(new Request('http://localhost:' + PUERTO + req.url, {
                method: req.method,
                headers: cabeceras,
                body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(trozos)
            }), {});
            const cuerpo = Buffer.from(await resp.arrayBuffer());
            console.log(req.method + ' ' + req.url.slice(0, 120) + ' → ' + resp.status);
            res.writeHead(resp.status, Object.fromEntries(resp.headers));
            res.end(cuerpo);
        } catch (e) {
            console.error(e);
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(String((e && e.message) || e));
        }
    });
    servidor.listen(PUERTO, '127.0.0.1', () => {
        console.log('Proxy local en http://localhost:' + PUERTO);
        console.log('Prueba: http://localhost:' + PUERTO + '/health');
    });
})().catch(e => { console.error(e); process.exit(1); });
