/**
 * Revisor de acuerdos: servicio que consulta los estrados del TSJ de
 * Quintana Roo y la lista de autos del PJF y devuelve las publicaciones de
 * un expediente, para que la app sepa qué hay de nuevo.
 *
 * Vive en una máquina Always Free de Oracle Cloud en Querétaro: el TSJ solo
 * acepta conexiones con dirección mexicana (desde Cloudflare y GitHub no
 * responde ni su página principal). Detrás de Caddy, que pone el HTTPS.
 *
 * Buen vecino de los tribunales:
 *  - una consulta a la vez por tribunal y una pausa mínima entre consultas;
 *  - caché de 10 minutos: diez abogados con el mismo expediente = 1 consulta;
 *  - se presenta con nombre propio (User-Agent con la dirección del sitio).
 * Privacidad: no guarda ni registra qué expedientes se consultan.
 *
 * Rutas:
 *   GET /salud                     estado del servicio y de cada tribunal
 *   GET /api/tsj?int=&metodo=&findexp=[&areaId=]
 *   GET /api/pjf?organismo=&tipoasunto=&expediente=[&tipoprocedimiento=]
 */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { leerTSJ, sinResultadosTSJ, leerPJF, esConsultaPJF } from './lectores.mjs';

export const VERSION = '2026-09-29-revisor-1';

const ORIGENES = ['https://tsjia.empirica.mx', 'https://jorch01.github.io'];
const ORIGEN_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const USER_AGENT = 'Mozilla/5.0 (compatible; TSJFilingOnline/1.0; +https://tsjia.empirica.mx/)';

const TSJ_BASE = 'https://www.tsjqroo.gob.mx/estrados/';
const PJF_BASE = 'https://www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx';

// ==================== CONSULTAS VÁLIDAS ====================
// Solo se arman URLs de estos dos tribunales: no es un proxy abierto.

export function urlTSJ(q) {
    const int = q.get('int');
    const findexp = (q.get('findexp') || '').trim();
    const metodo = q.get('metodo') === '2' ? '2' : '1';
    const areaId = q.get('areaId');
    if (!/^\d{1,5}$/.test(int || '') || !findexp || findexp.length > 120) return null;
    if (areaId && !/^\d{1,5}$/.test(areaId)) return null;
    return areaId
        ? `${TSJ_BASE}buscador_segunda.php?findexp=${encodeURIComponent(findexp)}&int=${int}&areaId=${areaId}&metodo=${metodo}`
        : `${TSJ_BASE}buscador_primera.php?int=${int}&metodo=${metodo}&findexp=${encodeURIComponent(findexp)}`;
}

export function urlPJF(q) {
    const organismo = q.get('organismo');
    const tipoasunto = q.get('tipoasunto');
    const expediente = (q.get('expediente') || '').trim();
    const tipoprocedimiento = q.get('tipoprocedimiento') || '0';
    if (!/^\d{1,6}$/.test(organismo || '') || !/^\d{1,6}$/.test(tipoasunto || '') ||
        !/^\d{1,4}$/.test(tipoprocedimiento) || !/^[\w\-/. ]{1,40}$/.test(expediente)) return null;
    return `${PJF_BASE}?tipoasunto=${tipoasunto}&organismo=${organismo}&expediente=${encodeURIComponent(expediente)}&tipoprocedimiento=${tipoprocedimiento}`;
}

// ==================== DESCARGA ====================
// Los dos servidores (TSJ y PJF) omiten su certificado intermedio. Como hace
// el navegador, se agregan los intermedios oficiales (los descarga el
// instalador de su dirección "CA Issuers") sin desactivar la verificación.

function cargarCA(dir) {
    const extra = [];
    try {
        for (const f of fs.readdirSync(dir)) if (f.endsWith('.pem')) extra.push(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) { /* sin intermedios: se usan solo las raíces */ }
    return [...tls.rootCertificates, ...extra];
}

export function crearDescargador({ dirIntermedios = '/opt/revisor/intermedios', esperaMs = 30000 } = {}) {
    const ca = cargarCA(dirIntermedios);
    return function descargar(url) {
        return new Promise((resolve) => {
            const t0 = Date.now();
            const req = https.get(url, { ca, headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html', 'Accept-Language': 'es-MX,es;q=0.9' }, timeout: esperaMs }, (res) => {
                const partes = [];
                res.on('data', d => partes.push(d));
                res.on('end', () => resolve({ status: res.statusCode, html: Buffer.concat(partes).toString('utf8'), ms: Date.now() - t0 }));
            });
            req.on('timeout', () => req.destroy(new Error('sin respuesta')));
            req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Date.now() - t0 }));
        });
    };
}

// ==================== TURNOS Y CACHÉ ====================

/** Una consulta a la vez por tribunal, con una pausa mínima entre ellas. */
export function crearTurno(pausaMs) {
    let cola = Promise.resolve();
    let ultima = 0;
    return (tarea) => {
        const turno = cola.then(async () => {
            const espera = ultima + pausaMs - Date.now();
            if (espera > 0) await new Promise(r => setTimeout(r, espera));
            try { return await tarea(); } finally { ultima = Date.now(); }
        });
        cola = turno.catch(() => {});
        return turno;
    };
}

export function crearCache(ttlMs, maximo = 2000) {
    const m = new Map();
    return {
        get(k) { const e = m.get(k); if (!e) return null; if (Date.now() - e.t > ttlMs) { m.delete(k); return null; } return e.v; },
        set(k, v) { if (m.size >= maximo) m.delete(m.keys().next().value); m.set(k, { t: Date.now(), v }); }
    };
}

// ==================== SERVICIO ====================

export function crearServicio({ descargar = crearDescargador(), pausaMs = 400, cacheMs = 10 * 60 * 1000, limitePorMinuto = 60 } = {}) {
    const turnos = { tsj: crearTurno(pausaMs), pjf: crearTurno(pausaMs) };
    const cache = crearCache(cacheMs);
    const estado = { tsj: { ultima: null, ok: null }, pjf: { ultima: null, ok: null } };
    const peticiones = new Map();   // ip → [marcas de tiempo del último minuto]

    function permitido(ip) {
        const ahora = Date.now();
        const lista = (peticiones.get(ip) || []).filter(t => ahora - t < 60000);
        lista.push(ahora);
        peticiones.set(ip, lista);
        if (peticiones.size > 5000) peticiones.clear();
        return lista.length <= limitePorMinuto;
    }

    async function consultar(tribunal, url) {
        const enCache = cache.get(url);
        if (enCache) return { ...enCache, cache: true };
        const r = await turnos[tribunal](() => descargar(url));
        let resultado;
        if (r.error || r.status !== 200) {
            resultado = { ok: false, error: r.error || `El ${tribunal.toUpperCase()} respondió ${r.status}` };
        } else if (tribunal === 'tsj') {
            const publicaciones = leerTSJ(r.html);
            const valida = publicaciones.length > 0 || sinResultadosTSJ(r.html) || /list_acuerdos|IdAcuerdo/i.test(r.html);
            resultado = valida ? { ok: true, publicaciones } : { ok: false, error: 'La página del TSJ cambió de forma' };
        } else {
            const publicaciones = leerPJF(r.html);
            resultado = esConsultaPJF(r.html) ? { ok: true, publicaciones } : { ok: false, error: 'La página del PJF cambió de forma o el expediente no existe' };
        }
        estado[tribunal] = { ultima: new Date().toISOString(), ok: resultado.ok, ms: r.ms };
        if (resultado.ok) cache.set(url, resultado);
        return resultado;
    }

    function cabeceras(req) {
        const origen = req.headers.origin || '';
        const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        if (ORIGENES.includes(origen) || ORIGEN_LOCAL.test(origen)) {
            Object.assign(h, { 'Access-Control-Allow-Origin': origen, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin' });
        }
        return h;
    }

    return http.createServer(async (req, res) => {
        const responder = (status, datos) => { res.writeHead(status, cabeceras(req)); res.end(JSON.stringify(datos)); };
        try {
            const url = new URL(req.url, 'http://revisor');
            if (req.method === 'OPTIONS') { res.writeHead(204, cabeceras(req)); res.end(); return; }
            if (req.method !== 'GET') return responder(405, { error: 'Solo GET' });
            if (url.pathname === '/salud' || url.pathname === '/') return responder(200, { ok: true, version: VERSION, tribunales: estado });

            const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
            if (!permitido(ip)) return responder(429, { error: 'Demasiadas consultas; espera un minuto.' });

            if (url.pathname === '/api/tsj' || url.pathname === '/api/pjf') {
                const tribunal = url.pathname.slice(5);
                const destino = tribunal === 'tsj' ? urlTSJ(url.searchParams) : urlPJF(url.searchParams);
                if (!destino) return responder(400, { error: 'Consulta no válida' });
                const r = await consultar(tribunal, destino);
                return responder(r.ok ? 200 : 502, r);
            }
            responder(404, { error: 'Ruta no encontrada' });
        } catch (e) {
            responder(500, { error: 'Error interno' });
        }
    });
}

// Arranque directo: node servidor/revisor.mjs
if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href) {
    const puerto = parseInt(process.env.PORT || '8080', 10);
    crearServicio({ descargar: crearDescargador({ dirIntermedios: process.env.DIR_INTERMEDIOS || '/opt/revisor/intermedios' }) })
        .listen(puerto, '127.0.0.1', () => console.log(`Revisor ${VERSION} en 127.0.0.1:${puerto}`));
}
