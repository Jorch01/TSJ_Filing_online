// ============================================================
// TSJ Estrados — Cloudflare Worker (prueba técnica + base del aviso de acuerdos)
// ============================================================
// Para qué: la app no puede leer los estrados del TSJ desde el navegador
// (el sitio del tribunal no lo permite). Este worker hace la consulta del
// lado del servidor y devuelve los acuerdos ya separados: número de acuerdo,
// tipo de documento, juicio, partes, extracto y fecha de publicación.
//
// PRUEBA TÉCNICA — publicar (una sola vez, gratis):
//   1. https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
//   2. Nombre: tsj-estrados → Deploy → Edit code
//   3. Borra el código de ejemplo, pega TODO este archivo y pulsa Deploy
//   4. Abre la URL del worker (https://tsj-estrados.<tu-cuenta>.workers.dev)
//   5. Pega la URL de estrados de uno de tus expedientes (en la app:
//      Tribunales → Expedientes TSJ → Selección masiva → 📋 Copiar URLs) o usa
//      el ejemplo, y pulsa "Probar". Copia el informe que aparece.
//
// Solo consulta www.tsjqroo.gob.mx/estrados: no es un proxy abierto.
// No guarda nada: cada consulta se hace y se olvida.
// ============================================================

const WORKER_VERSION = '2026-09-28-prueba-estrados-2';

const TSJ_BASE = 'https://www.tsjqroo.gob.mx/estrados/';
const RUTAS_PERMITIDAS = ['buscador_primera.php', 'buscador_segunda.php'];

const ALLOWED_ORIGINS = ['https://jorch01.github.io', 'https://tsjia.empirica.mx'];
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Se presenta con nombre propio: si el TSJ quiere saber quién consulta, lo sabe.
const USER_AGENT = 'Mozilla/5.0 (compatible; TSJFilingOnline/1.0; +https://tsjia.empirica.mx/)';

// ==================== URL DE CONSULTA ====================

/**
 * Arma la URL de estrados a partir de sus partes (como la app:
 * construirUrlBusqueda en docs/js/juzgados.js) o valida una URL completa.
 * Devuelve null si no es una consulta de estrados del TSJ.
 */
export function urlDeConsulta(params) {
    // Si se pegaron varias URLs (al copiar todas de la app), se usa la primera.
    const url = (params.get('url') || '').trim().split(/\s+/)[0];
    if (url) {
        let u;
        try { u = new URL(url); } catch (e) { return null; }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        if (!/^(www\.)?tsjqroo\.gob\.mx$/.test(u.hostname)) return null;
        const archivo = u.pathname.replace(/^\/estrados\//, '');
        if (!u.pathname.startsWith('/estrados/') || !RUTAS_PERMITIDAS.includes(archivo)) return null;
        return TSJ_BASE + archivo + u.search;
    }
    const int = params.get('int');
    const findexp = params.get('findexp');
    const metodo = params.get('metodo') === '2' ? '2' : '1';
    if (!/^\d{1,5}$/.test(int || '') || !findexp || findexp.length > 120) return null;
    const areaId = params.get('areaId');
    if (areaId) {
        if (!/^\d{1,5}$/.test(areaId)) return null;
        return `${TSJ_BASE}buscador_segunda.php?findexp=${encodeURIComponent(findexp)}&int=${int}&areaId=${areaId}&metodo=${metodo}`;
    }
    return `${TSJ_BASE}buscador_primera.php?int=${int}&metodo=${metodo}&findexp=${encodeURIComponent(findexp)}`;
}

// ==================== LECTURA DE LA PÁGINA ====================

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü' };

export function textoPlano(html) {
    return String(html)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
            if (e[0] === '#') {
                const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
                return Number.isFinite(n) ? String.fromCodePoint(n) : m;
            }
            return ENTIDADES[e] !== undefined ? ENTIDADES[e] : m;
        })
        .replace(/\s+/g, ' ')
        .trim();
}

/** Los bytes a texto, respetando el juego de caracteres que declare la página. */
export function decodificar(bytes, contentType) {
    const cabecera = /charset=([\w-]+)/i.exec(contentType || '');
    const inicio = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
    const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(inicio);
    const charset = (cabecera && cabecera[1]) || (meta && meta[1]) || 'utf-8';
    try {
        return { texto: new TextDecoder(charset.toLowerCase()).decode(bytes), charset };
    } catch (e) {
        return { texto: new TextDecoder('utf-8').decode(bytes), charset: charset + ' (no soportado; se usó utf-8)' };
    }
}

/**
 * Saca los acuerdos de la tabla de estrados. Las columnas son las que usaba
 * el programa de escritorio (buscar_expedientes.py): acuerdo, documento,
 * juicio, promoventes, demandados, extracto y fecha de publicación.
 */
export function extraerAcuerdos(html) {
    const filas = [];
    for (const m of String(html).matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
        const celdas = [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => textoPlano(c[1]));
        if (celdas.length < 7) continue;
        const [idAcuerdo, documento, juicio, promoventes, demandados, extracto, fecha] = celdas;
        if (!idAcuerdo && !extracto) continue;
        filas.push({ idAcuerdo, documento, juicio, promoventes, demandados, extracto, fecha, extra: celdas.slice(7) });
    }
    return filas;
}

export function sinResultados(html) {
    const t = textoPlano(html).toLowerCase();
    return /no se encontr|ningun resultado|ningún resultado|sin resultados|no existen registros/.test(t);
}

/**
 * Si la tabla no viene en el HTML, la página la pide aparte (por JavaScript).
 * Esto junta las pistas para saber a qué dirección llamar.
 */
export function pistasDeCargaDinamica(html) {
    const scripts = [...String(html).matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]);
    const endpoints = new Set();
    for (const m of String(html).matchAll(/["'`]([^"'`\s]*\.(?:php|aspx|json)(?:\?[^"'`\s]*)?)["'`]/gi)) endpoints.add(m[1]);
    const t = String(html);
    return {
        usaDataTables: /DataTable|dataTable\(/.test(t),
        usaAjax: /\$\.(ajax|post|get)\(|fetch\(|XMLHttpRequest|sAjaxSource|"ajax"\s*:|ajax\s*:/.test(t),
        scripts: scripts.slice(0, 15),
        posiblesEndpoints: [...endpoints].slice(0, 20),
        formularios: [...t.matchAll(/<form\b[^>]*action=["']([^"']*)["'][^>]*>/gi)].map(m => m[1]).slice(0, 5)
    };
}

// ==================== CONSULTA ====================

async function consultar(url, esperaMs = 25000) {
    const t0 = Date.now();
    let resp;
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), esperaMs);
    try {
        resp = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-MX,es;q=0.9' },
            redirect: 'follow',
            signal: control.signal,
            cf: { cacheTtl: 0 }
        });
    } catch (e) {
        clearTimeout(temporizador);
        const motivo = e && e.name === 'AbortError' ? `sin respuesta en ${Math.round(esperaMs / 1000)} s` : (e && e.message ? e.message : String(e));
        return { ok: false, error: 'No se pudo conectar con el TSJ: ' + motivo, ms: Date.now() - t0 };
    }
    clearTimeout(temporizador);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const { texto, charset } = decodificar(bytes, resp.headers.get('content-type'));
    const acuerdos = extraerAcuerdos(texto);
    return {
        ok: resp.ok,
        status: resp.status,
        urlFinal: resp.url,
        contentType: resp.headers.get('content-type'),
        charset,
        bytes: bytes.length,
        ms: Date.now() - t0,
        sinResultados: sinResultados(texto),
        acuerdos,
        html: texto
    };
}

// ==================== RESPUESTAS ====================

function cabecerasCORS(request) {
    const origen = request.headers.get('Origin') || '';
    const permitido = ALLOWED_ORIGINS.includes(origen) || LOCAL_ORIGIN_RE.test(origen);
    return permitido ? {
        'Access-Control-Allow-Origin': origen,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin'
    } : {};
}

function json(datos, request, status = 200) {
    return new Response(JSON.stringify(datos, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cabecerasCORS(request) }
    });
}

/** Informe para la prueba técnica: lo que hace falta para decidir, sin datos de más. */
async function diagnostico(url, repeticiones) {
    const intentos = [];
    let ultima = null;
    for (let i = 0; i < repeticiones; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 1500));   // sin prisas: somos visita
        ultima = await consultar(url);
        intentos.push({ status: ultima.status, ms: ultima.ms, bytes: ultima.bytes, acuerdos: ultima.acuerdos ? ultima.acuerdos.length : 0, error: ultima.error });
        // Si ni siquiera conecta, repetir solo hace esperar: se pasa a revisar el sitio.
        if (ultima.error || ultima.status >= 500) break;
    }
    // Si no hubo respuesta útil: ¿es esta página o todo el sitio? El 522 de
    // Cloudflare significa que el servidor del TSJ no aceptó la conexión.
    let conectividad = null;
    if (!ultima || ultima.error || ultima.status >= 500) {
        conectividad = [];
        for (const variante of ['https://www.tsjqroo.gob.mx/', 'http://www.tsjqroo.gob.mx/',
            'https://tsjqroo.gob.mx/', 'https://www.tsjqroo.gob.mx/estrados/']) {
            const v = await consultar(variante, 12000);
            conectividad.push({ url: variante, status: v.status || null, ms: v.ms, bytes: v.bytes || 0, error: v.error });
        }
    }
    const html = (ultima && ultima.html) || '';
    const sitioInalcanzable = conectividad && conectividad.every(c => c.error || !c.status || c.status >= 500);
    const conclusion = !ultima || ultima.error ? 'NO_CONECTA'
        : sitioInalcanzable ? 'SITIO_INALCANZABLE_DESDE_CLOUDFLARE'
        : ultima.status >= 400 ? 'BLOQUEADO_O_ERROR'
        : ultima.acuerdos.length > 0 ? 'LEE_ACUERDOS'
        : ultima.sinResultados ? 'SIN_RESULTADOS_PARA_ESTE_EXPEDIENTE'
        : 'TABLA_NO_ENCONTRADA';
    return {
        worker: WORKER_VERSION,
        fecha: new Date().toISOString(),
        consulta: url,
        conclusion,
        explicacion: {
            LEE_ACUERDOS: '✅ El TSJ responde y los acuerdos se leen directo del HTML. La etapa 1 es viable tal cual.',
            SIN_RESULTADOS_PARA_ESTE_EXPEDIENTE: '🟡 El TSJ responde, pero este expediente no tiene publicaciones. Prueba con uno que sí tenga acuerdos.',
            TABLA_NO_ENCONTRADA: '🟠 El TSJ responde pero la tabla no viene en el HTML: la carga aparte. Las "pistas" dicen de dónde.',
            SITIO_INALCANZABLE_DESDE_CLOUDFLARE: '🔴 Ninguna página del TSJ responde a Cloudflare (ni la principal). Si en tu navegador sí abre, el TSJ bloquea las conexiones desde Cloudflare.',
            BLOQUEADO_O_ERROR: '🔴 El TSJ respondió con error a Cloudflare. Puede estar bloqueando estas consultas.',
            NO_CONECTA: '🔴 Cloudflare no pudo conectarse con el TSJ (certificado, bloqueo o sitio caído).'
        }[conclusion],
        intentos,
        conectividad,
        respuesta: ultima && !ultima.error ? {
            status: ultima.status, urlFinal: ultima.urlFinal, contentType: ultima.contentType,
            charset: ultima.charset, bytes: ultima.bytes
        } : { error: ultima && ultima.error },
        acuerdosEncontrados: ultima && ultima.acuerdos ? ultima.acuerdos.length : 0,
        // Muestra de la estructura: tres filas bastan para ajustar el lector.
        muestraAcuerdos: ultima && ultima.acuerdos ? ultima.acuerdos.slice(0, 3) : [],
        pistas: pistasDeCargaDinamica(html),
        filasDeTabla: (html.match(/<tr\b/gi) || []).length,
        fragmentoHTML: textoPlano(html).slice(0, 1500),
        htmlCrudoInicio: html.replace(/\s+/g, ' ').slice(0, 2500)
    };
}

const EJEMPLO = TSJ_BASE + 'buscador_primera.php?int=1&metodo=1&findexp=100%2F2025';

function paginaPrueba() {
    return new Response(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prueba de estrados TSJ</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#16202c}
 h1{font-size:1.4rem} input{width:100%;padding:.6rem;font-size:.95rem;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box}
 button{margin-top:.6rem;padding:.6rem 1.1rem;font-size:.95rem;border:0;border-radius:8px;background:#2563a8;color:#fff;cursor:pointer}
 button.sec{background:#e8ecf2;color:#16202c} pre{background:#0f1b2b;color:#d6e3f3;padding:1rem;border-radius:8px;overflow:auto;font-size:.8rem;max-height:60vh}
 .con{font-size:1.1rem;font-weight:700;margin:1rem 0 .5rem} small{color:#5a6a7d}
</style></head><body>
<h1>🔎 Prueba técnica: estrados del TSJ desde Cloudflare</h1>
<p><small>Versión ${WORKER_VERSION}. Pega la URL de estrados de un expediente que <b>sí tenga acuerdos publicados</b> (en la app: Tribunales → Expedientes TSJ → Selección masiva → 📋 Copiar URLs).</small></p>
<input id="url" value="${EJEMPLO}">
<p><small>Si pegas varias URLs, se prueba la primera.</small></p>
<button onclick="probar()">Probar</button> <button class="sec" onclick="copiar()">📋 Copiar informe</button>
<div class="con" id="con"></div><pre id="out">—</pre>
<script>
async function probar(){
  document.getElementById('con').textContent='Consultando… (puede tardar hasta un minuto)';
  const r=await fetch('/api/diagnostico?repeticiones=3&url='+encodeURIComponent(document.getElementById('url').value));
  const d=await r.json(); document.getElementById('con').textContent=(d.explicacion||d.error||'')+(d.intentos&&d.intentos[0]&&d.intentos[0].status===522?' (tarda cerca de un minuto en revisar el resto del sitio)':'');
  document.getElementById('out').textContent=JSON.stringify(d,null,2);
}
function copiar(){navigator.clipboard.writeText(document.getElementById('out').textContent);}
</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default {
    async fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecerasCORS(request) });
        if (request.method !== 'GET') return json({ error: 'Solo GET' }, request, 405);

        if (url.pathname === '/' || url.pathname === '') return paginaPrueba();
        if (url.pathname === '/health') return json({ ok: true, worker: WORKER_VERSION }, request);

        if (url.pathname === '/api/diagnostico' || url.pathname === '/api/acuerdos') {
            const destino = urlDeConsulta(url.searchParams);
            if (!destino) return json({ error: 'Consulta no válida: solo estrados del TSJ (buscador_primera.php o buscador_segunda.php).' }, request, 400);
            if (url.pathname === '/api/diagnostico') {
                const rep = Math.min(3, Math.max(1, parseInt(url.searchParams.get('repeticiones') || '1', 10) || 1));
                return json(await diagnostico(destino, rep), request);
            }
            // Lo que usará la app en la etapa 1: solo los acuerdos.
            const r = await consultar(destino);
            if (r.error) return json({ error: r.error }, request, 502);
            return json({ ok: r.ok, status: r.status, sinResultados: r.sinResultados, acuerdos: r.acuerdos }, request, r.ok ? 200 : 502);
        }
        return json({ error: 'Ruta no encontrada' }, request, 404);
    }
};
