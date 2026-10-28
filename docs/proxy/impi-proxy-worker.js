// ============================================================
// IMPI CORS Proxy - Cloudflare Worker
// ============================================================
// Proxy que permite a TSJ Filing Online comunicarse con las APIs
// de MARCia y SIGA del IMPI, manejando CSRF tokens y sesiones.
//
// DESPLIEGUE (una sola vez, gratis):
//
// 1. Crea cuenta en https://dash.cloudflare.com/ (gratis, 100k req/día)
// 2. Ve a Workers & Pages → Create Application → Create Worker
// 3. Borra el código de ejemplo y pega TODO el contenido de este archivo
// 4. Click en "Deploy"
// 5. Copia la URL del worker (ej: https://impi-proxy.tu-cuenta.workers.dev)
// 6. Abre docs/js/impi-search.js y actualiza la variable IMPI_PROXY_URL:
//      var IMPI_PROXY_URL = 'https://impi-proxy.tu-cuenta.workers.dev';
// 7. Commit, push, y listo. Todos los usuarios tendrán búsqueda IMPI.
//
// NOTA: Los usuarios finales NO necesitan configurar nada.
//
// AL ACTUALIZAR: publica el worker y el sitio juntos. El cliente y el proxy se
// entienden por las cabeceras X-IMPI-Client y X-IMPI-Session; un cliente viejo
// contra este worker sigue funcionando (cae al Map en memoria, como antes),
// pero no gana la recuperación de sesión hasta que se publique el sitio.
// Las sesiones no necesitan recursos extra. Los límites del plan gratuito sí:
// un KV namespace enlazado como CUOTAS y el secreto CUOTA_SECRETO (ver la
// sección CUOTAS). Ambos caben en el plan gratuito de Cloudflare.
// ============================================================

// Sirve para confirmar, desde /health, que el worker publicado es el esperado.
// Actualízala cuando el cambio valga la pena verificar tras desplegar.
const WORKER_VERSION = '2026-10-28-paginas';

const ALLOWED_ORIGINS = [
    'https://jorch01.github.io',
    'https://tsjia.empirica.mx'
];

// Desarrollo local, en cualquier puerto.
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const MARCIA_BASE = 'https://marcia.impi.gob.mx';
const SIGA_BASE = 'https://siga.impi.gob.mx:5007';
const MARCANET_BASE = 'https://acervomarcas.impi.gob.mx:8181';

// Almacén de sesiones en memoria del isolate. SIGA y Marcanet lo usan como
// caché: si la entrada no está, ensureSigaSession/ensureMarcanetSession la
// vuelven a crear solas, así que perderla no rompe nada.
//
// MARCia no puede depender de esto: su sesión la crea el cliente con una
// llamada explícita a /marcia/csrf y la usa en llamadas posteriores. Como
// Cloudflare recicla los isolates y reparte las peticiones entre colos, la
// sesión podía no existir ya al paginar o al abrir un detalle, y la respuesta
// era "No active session". Por eso la sesión de MARCia viaja ahora con el
// cliente (ver más abajo) y el Map solo queda como respaldo para clientes que
// todavía no reenvían el token.
const sessions = new Map();

// ==================== SESIÓN MARCia SIN ESTADO EN EL SERVIDOR ====================
// El cliente conserva el token CSRF y las cookies de MARCia y los reenvía en
// cada petición. No es información privilegiada: cualquiera obtiene lo mismo
// visitando marcia.impi.gob.mx. La ventaja es que no hay estado que perder ni
// que compartir entre usuarios distintos.

const SESSION_HEADER = 'X-IMPI-Session';
const CLIENT_HEADER = 'X-IMPI-Client';
const CUOTA_HEADER = 'X-TSJ-Cuota';

// ==================== CUOTAS (INICIO) ====================
// Sin Premium, el IMPI se usa con límite: 2 estudios de viabilidad en total y
// 5 búsquedas al mes. La cuenta se lleva AQUÍ, no en el navegador: borrar los
// datos o abrir otro navegador no la reinicia.
//
// Cómo se reconoce a quien busca, sin cuentas ni registro:
//   - la IP junto con una "huella amplia" del equipo (pantalla, zona horaria,
//     núcleos, idioma, plataforma, pantalla táctil): es la misma en Chrome,
//     Safari o Firefox de la misma computadora;
//   - una "huella fina" (lo anterior más el navegador, la tarjeta gráfica y un
//     dibujo de prueba) y el id de dispositivo de la app.
// Se cuenta con cada una y manda la que más lleve. Nada de esto identifica a
// la persona: se guardan solo resúmenes SHA-256.
//
// Antes de cada búsqueda la app pide permiso a /cuota; si queda cupo, el
// proxy responde con un pase firmado y de vida corta (cabecera X-TSJ-Cuota)
// sin el cual las rutas de búsqueda no responden. Así no basta con llamar al
// proxy directamente para saltarse el límite.
//
// Necesita en Cloudflare (Settings → Variables / Bindings del worker):
//   - un KV namespace con el nombre de enlace CUOTAS;
//   - un secreto CUOTA_SECRETO (cualquier texto largo y aleatorio).
// Sin ellos el worker funciona como antes, sin límites del lado del servidor
// (la app sigue contando en el navegador).
const CUOTAS = {
    viabilidad: { limite: 2, periodo: 'siempre', vidaPase: 30 * 60 * 1000 },
    busqueda: { limite: 5, periodo: 'mes', vidaPase: 10 * 60 * 1000 },
    // Revisar las marcas vigiladas y las búsquedas guardadas en segundo plano:
    // no gasta búsquedas, pero tiene un tope diario por si alguien lo usa
    // para buscar sin límite.
    vigilancia: { limite: 60, periodo: 'dia', vidaPase: 10 * 60 * 1000 }
};
// Las rutas que hacen una búsqueda nueva necesitan pase; paginar, ver un
// detalle o pedir la sesión, no.
const RUTAS_CON_PASE = ['/marcia/search', '/siga/search', '/marcanet/fonetica', '/marcanet/expediente', '/marcanet/registro', '/marcanet/titular'];
const LICENCIAS_API = 'https://script.google.com/macros/s/AKfycbyK8kudH83BoBEN-NHLo7sPpdsIuqTdnusZcr08aRO_oXtv0frwzo8bpG9JWn9EoHbrLQ/exec';

function cuotasActivas(env) {
    return !!(env && env.CUOTAS && env.CUOTA_SECRETO);
}

async function sha256Hex(texto) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(texto)));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function firmar(secreto, texto) {
    const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(texto))));
}

async function crearPase(secreto, tipo, premium, ahora) {
    const datos = b64url(new TextEncoder().encode(JSON.stringify({ t: tipo, p: !!premium, e: ahora + CUOTAS[tipo].vidaPase })));
    return datos + '.' + await firmar(secreto, datos);
}

/** El pase si es auténtico y no ha vencido; si no, null. */
async function leerPase(secreto, pase, ahora) {
    if (!pase || typeof pase !== 'string' || pase.indexOf('.') < 0) return null;
    const [datos, firma] = pase.split('.');
    if (await firmar(secreto, datos) !== firma) return null;
    try {
        const s = atob(datos.replace(/-/g, '+').replace(/_/g, '/'));
        const json = JSON.parse(decodeURIComponent(escape(s)));
        return json.e > ahora && CUOTAS[json.t] ? json : null;
    } catch (e) { return null; }
}

function periodoDe(tipo, ahora) {
    const d = new Date(ahora);
    if (CUOTAS[tipo].periodo === 'mes') return d.toISOString().slice(0, 7);
    if (CUOTAS[tipo].periodo === 'dia') return d.toISOString().slice(0, 10);
    return 'siempre';
}

/** Los resúmenes con los que se cuenta a quien busca. */
async function identidades(ip, cuerpo) {
    const h = (cuerpo && cuerpo.huella) || {};
    const ids = [];
    if (ip && h.amplia) ids.push('a:' + await sha256Hex('ip+amplia|' + ip + '|' + h.amplia));
    if (h.fina) ids.push('f:' + await sha256Hex('fina|' + h.fina));
    if (cuerpo && cuerpo.dispositivo) ids.push('d:' + await sha256Hex('disp|' + cuerpo.dispositivo));
    // Sin ningún dato del equipo, al menos la IP.
    if (!ids.length && ip) ids.push('i:' + await sha256Hex('ip|' + ip));
    return ids;
}

/** ¿La licencia es Premium vigente? Se pregunta a la API de licencias y se recuerda unas horas. */
async function esPremium(env, licencia, consultar) {
    if (!licencia || !licencia.codigo || !licencia.dispositivoId) return false;
    const clave = 'lic:' + await sha256Hex(licencia.codigo + '|' + licencia.dispositivoId);
    const guardada = await env.CUOTAS.get(clave);
    if (guardada) return guardada === '1';
    let valido = false;
    try {
        const r = await consultar(LICENCIAS_API + '?action=verificar&codigo=' + encodeURIComponent(licencia.codigo) +
            '&dispositivo_id=' + encodeURIComponent(licencia.dispositivoId));
        const d = await r.json();
        valido = !!(d && d.valido);
    } catch (e) { valido = false; }
    await env.CUOTAS.put(clave, valido ? '1' : '0', { expirationTtl: valido ? 6 * 3600 : 600 });
    return valido;
}

/**
 * POST /cuota { tipo, huella: { amplia, fina }, dispositivo, licencia? }
 * → { servidor, permitido, premium, usados, limite, pase }
 */
async function atenderCuota(env, ip, cuerpo, ahora, consultar) {
    const tipo = cuerpo && cuerpo.tipo;
    if (!CUOTAS[tipo]) return { status: 400, datos: { error: 'Tipo de cuota desconocido' } };
    if (!cuotasActivas(env)) return { status: 200, datos: { servidor: false, permitido: true } };
    const { limite } = CUOTAS[tipo];
    if (await esPremium(env, cuerpo.licencia, consultar)) {
        return { status: 200, datos: { servidor: true, permitido: true, premium: true, limite: null, usados: null, pase: await crearPase(env.CUOTA_SECRETO, tipo, true, ahora) } };
    }
    const periodo = periodoDe(tipo, ahora);
    const claves = (await identidades(ip, cuerpo)).map(id => 'c:' + tipo + ':' + periodo + ':' + id);
    if (!claves.length) return { status: 400, datos: { error: 'Sin datos para contar' } };
    const valores = await Promise.all(claves.map(k => env.CUOTAS.get(k)));
    const usados = Math.max(0, ...valores.map(v => parseInt(v, 10) || 0));
    if (usados >= limite) return { status: 200, datos: { servidor: true, permitido: false, usados, limite } };
    const nuevo = usados + 1;
    const ttl = CUOTAS[tipo].periodo === 'mes' ? 40 * 86400 : CUOTAS[tipo].periodo === 'dia' ? 2 * 86400 : undefined;
    await Promise.all(claves.map(k => env.CUOTAS.put(k, String(nuevo), ttl ? { expirationTtl: ttl } : undefined)));
    return { status: 200, datos: { servidor: true, permitido: true, usados: nuevo, limite, pase: await crearPase(env.CUOTA_SECRETO, tipo, false, ahora) } };
}

/** null si la ruta puede seguir; si no, el motivo para responder 402. */
async function revisarPase(env, path, request, ahora) {
    if (!cuotasActivas(env) || !RUTAS_CON_PASE.includes(path)) return null;
    const pase = await leerPase(env.CUOTA_SECRETO, request.headers.get(CUOTA_HEADER), ahora);
    return pase ? null : 'Se alcanzó el límite de búsquedas gratuitas o el permiso venció. Activa Premium para seguir buscando.';
}
// ==================== CUOTAS (FIN) ====================
const SESSION_TTL_MS = 30 * 60 * 1000;

// El token vuelve del cliente, así que se valida antes de reenviarlo al IMPI:
// nada de saltos de línea (inyección de cabeceras) ni tamaños desmedidos.
const CSRF_RE = /^[A-Za-z0-9._~+/=-]{1,256}$/;
const COOKIE_RE = /^[ -~]{0,4096}$/;   // ASCII imprimible: excluye CR y LF

// Las cookies se normalizan al extraerlas para que siempre sean serializables.
function sanearCookies(str) {
    return String(str || '').replace(/[^ -~]/g, '').slice(0, 4096);
}

function serializarSesion(session) {
    try {
        return btoa(JSON.stringify({
            c: session.csrf,
            k: sanearCookies(session.cookies),
            t: session.timestamp || Date.now()
        }));
    } catch (e) {
        return '';
    }
}

function deserializarSesion(token) {
    if (!token) return null;
    let raw;
    try { raw = JSON.parse(atob(token)); } catch (e) { return null; }
    if (!raw || typeof raw !== 'object') return null;

    const csrf = String(raw.c || '');
    const cookies = String(raw.k || '');
    const timestamp = Number(raw.t) || 0;

    if (!CSRF_RE.test(csrf)) return null;
    if (!COOKIE_RE.test(cookies)) return null;
    if (!timestamp || Date.now() - timestamp > SESSION_TTL_MS) return null;

    return { csrf, cookies, timestamp };
}

// La sesión que trae el cliente manda; si no trae (cliente viejo), se cae al
// Map en memoria.
function obtenerSesionMARCia(request) {
    const delCliente = deserializarSesion(request.headers.get(SESSION_HEADER));
    if (delCliente) return delCliente;
    return sessions.get(getSessionKey(request)) || null;
}

function respuestaSinSesionMARCia() {
    // El texto importa: el cliente lo reconoce para rehacer la sesión y
    // reintentar una vez.
    return new Response(JSON.stringify({ error: 'No active session. Call /marcia/csrf first.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
    });
}

// Devuelve una sesión nueva con las cookies que haya rotado el IMPI, sin mutar
// la recibida.
function conCookiesActualizadas(session, response) {
    const nuevas = extractCookies(response);
    if (!nuevas) return session;
    const mezcla = Object.assign(parseCookies(session.cookies), parseCookies(nuevas));
    return {
        csrf: session.csrf,
        cookies: sanearCookies(Object.entries(mezcla).map(([k, v]) => k + '=' + v).join('; ')),
        timestamp: Date.now()
    };
}

// Responde adjuntando la sesión actualizada para que el cliente la guarde.
function respuestaConSesion(data, status, session, request) {
    const headers = { 'Content-Type': 'application/json' };
    const token = serializarSesion(session);
    if (token) headers[SESSION_HEADER] = token;

    // Mantener al día también la copia en memoria, que es lo único que tienen
    // los clientes que aún no reenvían el token.
    if (request) {
        const key = getSessionKey(request);
        if (sessions.has(key)) sessions.set(key, session);
    }
    return new Response(JSON.stringify(data), { status, headers });
}

export default {
    async fetch(request, env) {
        // Manejar preflight CORS
        if (request.method === 'OPTIONS') {
            return handleCORS(request);
        }

        const url = new URL(request.url);
        const origin = request.headers.get('Origin') || '';

        // Limpiar sesiones expiradas
        limpiarSesionesViejas();

        // Verificar origen permitido
        if (!isOriginAllowed(origin)) {
            return new Response('Forbidden', { status: 403 });
        }

        const path = url.pathname;

        try {
            let response;

            // ===== Cuotas =====
            if (path === '/cuota' && request.method === 'POST') {
                let cuerpo = {};
                try { cuerpo = await request.json(); } catch (e) { /* cuerpo vacío */ }
                const r = await atenderCuota(env, request.headers.get('CF-Connecting-IP') || '', cuerpo, Date.now(), (u) => fetch(u, { redirect: 'follow' }));
                return addCORSHeaders(new Response(JSON.stringify(r.datos), { status: r.status, headers: { 'Content-Type': 'application/json' } }), origin);
            }
            const sinPase = await revisarPase(env, path, request, Date.now());
            if (sinPase) {
                return addCORSHeaders(new Response(JSON.stringify({ error: sinPase, cuota: true }), { status: 402, headers: { 'Content-Type': 'application/json' } }), origin);
            }

            // ===== Rutas MARCia =====
            if (path === '/marcia/csrf') {
                response = await handleMarciaCsrf(request);
            } else if (path === '/marcia/search') {
                response = await handleMarciaSearch(request);
            } else if (path === '/marcia/results') {
                response = await handleMarciaResults(request);
            } else if (path.startsWith('/marcia/view/')) {
                const markId = path.replace('/marcia/view/', '');
                response = await handleMarciaView(request, markId);
            }
            // ===== Rutas SIGA =====
            else if (path === '/siga/csrf') {
                response = await handleSigaCsrf(request);
            } else if (path === '/siga/search') {
                response = await handleSigaSearch(request);
            } else if (path === '/siga/ficha') {
                response = await handleSigaFicha(request);
            } else if (path === '/siga/areas') {
                response = await handleSigaAreas(request);
            }
            // ===== Rutas Marcanet =====
            else if (path === '/marcanet/session') {
                response = await handleMarcanetSession(request);
            } else if (path === '/marcanet/fonetica') {
                response = await handleMarcanetFonetica(request);
            } else if (path === '/marcanet/expediente') {
                response = await handleMarcanetExpediente(request);
            } else if (path === '/marcanet/registro') {
                response = await handleMarcanetRegistro(request);
            } else if (path === '/marcanet/titular') {
                response = await handleMarcanetTitular(request);
            } else if (path === '/marcanet/detail-link') {
                response = await handleMarcanetDetailLink(request);
            } else if (path === '/marcanet/full-detail') {
                response = await handleMarcanetFullDetail(request);
            }
            // ===== Health check =====
            else if (path === '/health') {
                response = new Response(JSON.stringify({
                    status: 'ok',
                    version: WORKER_VERSION,
                    services: ['marcia', 'siga', 'marcanet'],
                    cuotas: cuotasActivas(env),
                    timestamp: new Date().toISOString()
                }), { headers: { 'Content-Type': 'application/json' } });
            }
            else {
                response = new Response('Not Found', { status: 404 });
            }

            // Agregar headers CORS a la respuesta
            return addCORSHeaders(response, origin);

        } catch (error) {
            const errResponse = new Response(JSON.stringify({
                error: error.message,
                service: path.split('/')[1] || 'unknown'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
            return addCORSHeaders(errResponse, origin);
        }
    }
};

// ==================== MARCia HANDLERS ====================

async function handleMarciaCsrf(request) {
    const sessionKey = getSessionKey(request);

    // Fetch la página de MARCia para obtener CSRF token y cookies
    const resp = await fetch(MARCIA_BASE + '/marcas/search/quick', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml'
        },
        redirect: 'follow'
    });

    const html = await resp.text();

    // Extraer CSRF token
    const csrfMatch = html.match(/<meta\s+name="_csrf"\s+content="([^"]+)"/);
    if (!csrfMatch) {
        return new Response(JSON.stringify({ error: 'No CSRF token found' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const session = {
        csrf: csrfMatch[1],
        cookies: sanearCookies(extractCookies(resp)),
        timestamp: Date.now()
    };

    // Se guarda también en memoria para los clientes que todavía no reenvían
    // el token de sesión.
    sessions.set(sessionKey, session);

    // La sesión viaja en la cabecera; el cuerpo se mantiene igual que antes.
    return respuestaConSesion({ csrf: session.csrf, sessionActive: true }, 200, session, null);
}

async function handleMarciaSearch(request) {
    const session = obtenerSesionMARCia(request);
    if (!session) return respuestaSinSesionMARCia();

    const body = await request.json();

    const resp = await fetch(MARCIA_BASE + '/marcas/search/internal/record', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-XSRF-TOKEN': session.csrf,
            'Cookie': session.cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': MARCIA_BASE + '/marcas/search/quick',
            'Origin': MARCIA_BASE
        },
        body: JSON.stringify(body)
    });

    const data = await resp.json();
    return respuestaConSesion(data, resp.status, conCookiesActualizadas(session, resp), request);
}

async function handleMarciaResults(request) {
    const session = obtenerSesionMARCia(request);
    if (!session) return respuestaSinSesionMARCia();

    const body = await request.json();

    const resp = await fetch(MARCIA_BASE + '/marcas/search/internal/result', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-XSRF-TOKEN': session.csrf,
            'Cookie': session.cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': MARCIA_BASE + '/marcas/search/result',
            'Origin': MARCIA_BASE
        },
        body: JSON.stringify(body)
    });

    const data = await resp.json();
    return respuestaConSesion(data, resp.status, conCookiesActualizadas(session, resp), request);
}

async function handleMarciaView(request, markId) {
    const session = obtenerSesionMARCia(request);
    if (!session) return respuestaSinSesionMARCia();

    const resp = await fetch(MARCIA_BASE + '/marcas/search/internal/view/' + encodeURIComponent(markId), {
        headers: {
            'Accept': 'application/json',
            'X-XSRF-TOKEN': session.csrf,
            'Cookie': session.cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': MARCIA_BASE + '/marcas/search/result',
            'Origin': MARCIA_BASE
        }
    });

    const data = await resp.json();
    return respuestaConSesion(data, resp.status, conCookiesActualizadas(session, resp), request);
}

// ==================== SIGA HANDLERS ====================

const SIGA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Obtiene sesión SIGA: llama /antiforgery/token para obtener XSRF-TOKEN cookie
async function ensureSigaSession(request) {
    const sessionKey = 'siga_' + getSessionKey(request);
    let session = sessions.get(sessionKey);

    // Reusar sesión si tiene menos de 10 min
    if (session && session.xsrfToken && (Date.now() - session.timestamp < 10 * 60 * 1000)) {
        return session;
    }

    // GET /antiforgery/token → sets .AspNetCore.Antiforgery + XSRF-TOKEN cookies
    const afResp = await fetch(SIGA_BASE + '/antiforgery/token', {
        headers: {
            'User-Agent': SIGA_UA,
            'Accept': 'application/json',
            'Origin': 'https://siga.impi.gob.mx',
            'Referer': 'https://siga.impi.gob.mx/'
        }
    });

    if (!afResp.ok) {
        throw new Error('SIGA antiforgery endpoint no disponible. Status: ' + afResp.status);
    }

    // Extraer cookies del Set-Cookie header
    let xsrfToken = '';
    let allCookies = '';

    // Method 1: getSetCookie() (standard in CF Workers)
    const setCookies = (typeof afResp.headers.getSetCookie === 'function')
        ? afResp.headers.getSetCookie() : [];

    for (const sc of setCookies) {
        const match = sc.match(/XSRF-TOKEN=([^;]+)/i);
        if (match) xsrfToken = match[1];
        const cookiePart = sc.split(';')[0];
        allCookies += (allCookies ? '; ' : '') + cookiePart;
    }

    // Method 2: fallback via raw set-cookie header
    if (!xsrfToken) {
        const raw = afResp.headers.get('set-cookie') || '';
        const xsrfMatch = raw.match(/XSRF-TOKEN=([^;,]+)/i);
        if (xsrfMatch) xsrfToken = xsrfMatch[1];
        if (!allCookies && raw) {
            // Extract cookie name=value pairs from raw header
            const parts = raw.split(/,(?=\s*[A-Za-z._-]+=)/);
            allCookies = parts.map(p => p.split(';')[0].trim()).filter(Boolean).join('; ');
        }
    }

    if (!xsrfToken) {
        throw new Error('No se pudo obtener XSRF-TOKEN de SIGA');
    }

    session = { cookies: allCookies, xsrfToken: xsrfToken, timestamp: Date.now() };
    sessions.set(sessionKey, session);
    return session;
}

// Build standard SIGA headers with CSRF credentials
function sigaHeaders(session, contentType) {
    const h = {
        'Accept': 'application/json',
        'User-Agent': SIGA_UA,
        'Origin': 'https://siga.impi.gob.mx',
        'Referer': 'https://siga.impi.gob.mx/',
        'X-XSRF-TOKEN': session.xsrfToken,
        'Cookie': session.cookies
    };
    if (contentType) h['Content-Type'] = contentType;
    return h;
}

async function handleSigaCsrf(request) {
    try {
        await ensureSigaSession(request);
        return new Response(JSON.stringify({ sessionActive: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function handleSigaSearch(request) {
    const body = await request.json();

    const sigaPayload = {
        Busqueda: body.Busqueda || '',
        IdArea: body.IdArea || '2',
        IdGaceta: body.IdGaceta || [],
        FechaDesde: body.FechaDesde || '',
        FechaHasta: body.FechaHasta || '',
        ReCaptchaToken: ''
    };

    // Intentar con sesión existente, reintentar con tokens frescos si falla CSRF
    for (let attempt = 0; attempt < 2; attempt++) {
        let session;
        try {
            if (attempt > 0) {
                // Invalidar sesión vieja para forzar tokens frescos
                const sk = 'siga_' + getSessionKey(request);
                sessions.delete(sk);
            }
            session = await ensureSigaSession(request);
        } catch (e) {
            return new Response(JSON.stringify({ error: 'No se pudo conectar a SIGA: ' + e.message }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const resp = await fetch(SIGA_BASE + '/api/BusquedaFicha/GetFichas', {
            method: 'POST',
            headers: sigaHeaders(session, 'application/json'),
            body: JSON.stringify(sigaPayload)
        });

        // Si 400 con error CSRF, reintentar con sesión fresca
        if (resp.status === 400 && attempt === 0) {
            const text = await resp.text();
            if (text.includes('CSRF') || text.includes('error_code')) {
                continue; // retry
            }
            // 400 por otra razón, devolver
            return sigaJsonResponseFromText(resp.status, text);
        }

        const sessionKey = 'siga_' + getSessionKey(request);
        updateSessionCookies(sessionKey, resp);

        return sigaJsonResponse(resp);
    }
}

async function handleSigaFicha(request) {
    const body = await request.json();

    for (let attempt = 0; attempt < 2; attempt++) {
        let session;
        try {
            if (attempt > 0) {
                sessions.delete('siga_' + getSessionKey(request));
            }
            session = await ensureSigaSession(request);
        } catch (e) {
            return new Response(JSON.stringify({ error: 'No se pudo conectar a SIGA: ' + e.message }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const resp = await fetch(SIGA_BASE + '/api/BusquedaFicha/GetFichaInfo', {
            method: 'POST',
            headers: sigaHeaders(session, 'application/json'),
            body: JSON.stringify(body)
        });

        if (resp.status === 400 && attempt === 0) {
            const text = await resp.text();
            if (text.includes('CSRF') || text.includes('error_code')) {
                continue;
            }
            return sigaJsonResponseFromText(resp.status, text);
        }

        const sessionKey = 'siga_' + getSessionKey(request);
        updateSessionCookies(sessionKey, resp);

        return sigaJsonResponse(resp);
    }
}

async function handleSigaAreas(request) {
    let session;
    try {
        session = await ensureSigaSession(request);
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const resp = await fetch(SIGA_BASE + '/api/BusquedaEstructurada/GetAreas', {
        headers: sigaHeaders(session)
    });

    return sigaJsonResponse(resp);
}

// Parse SIGA JSON response from already-fetched Response object
async function sigaJsonResponse(resp) {
    const respText = await resp.text();
    return sigaJsonResponseFromText(resp.status, respText);
}

// Parse SIGA JSON response from status + text (used when body already consumed)
function sigaJsonResponseFromText(status, respText) {
    let data;
    try {
        data = JSON.parse(respText);
    } catch (e) {
        return new Response(JSON.stringify({
            error: 'Respuesta no-JSON de SIGA',
            status: status,
            body: respText.substring(0, 1000)
        }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // If SIGA returned an error response, normalize it for the frontend
    if (status >= 400) {
        return new Response(JSON.stringify({
            error: data.message || data.error || ('SIGA error ' + status),
            error_code: data.error_code,
            status: status
        }), {
            status: status,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify(data), {
        status: status,
        headers: { 'Content-Type': 'application/json' }
    });
}

// ==================== MARCANET HANDLERS ====================

const MARCANET_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function marcanetHeaders(session) {
    return {
        'User-Agent': MARCANET_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
        'Cookie': session.cookies || '',
        'Referer': MARCANET_BASE + '/marcanet/vistas/common/home.pgi',
        'Origin': MARCANET_BASE
    };
}

// Inicializar sesión Marcanet (obtener cookies del home)
async function ensureMarcanetSession(request) {
    const sessionKey = 'marcanet_' + getSessionKey(request);
    let session = sessions.get(sessionKey);

    if (session && session.cookies && (Date.now() - session.timestamp < 15 * 60 * 1000)) {
        return session;
    }

    const resp = await fetch(MARCANET_BASE + '/marcanet/vistas/common/home.pgi', {
        headers: {
            'User-Agent': MARCANET_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
        },
        redirect: 'follow'
    });

    const cookies = extractCookies(resp);
    session = { cookies, timestamp: Date.now() };
    sessions.set(sessionKey, session);
    return session;
}

// Obtener ViewState de una página PrimeFaces/JSF
function extractViewState(html) {
    // Buscar javax.faces.ViewState en inputs hidden - multiple patterns
    const match = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/i) ||
                  html.match(/id="j_id1:javax\.faces\.ViewState:0"[^>]*value="([^"]*)"/i) ||
                  html.match(/javax\.faces\.ViewState[^>]*value="([^"]*)"/i) ||
                  // value before name order
                  html.match(/value="([^"]*)"[^>]*name="javax\.faces\.ViewState"/i) ||
                  // ViewState in any hidden input near "ViewState" text
                  html.match(/ViewState[^>]*value="([^"]+)"/i);
    return match ? match[1] : null;
}

// Parsear respuesta PrimeFaces AJAX (XML partial-response)
function parsePrimeFacesResponse(xmlText) {
    const updates = {};
    // Extraer bloques <update id="..."><![CDATA[...]]></update>
    const updateMatches = xmlText.match(/<update\s+id="([^"]*)">([\s\S]*?)<\/update>/gi) || [];
    for (const upd of updateMatches) {
        const idMatch = upd.match(/<update\s+id="([^"]*)"/i);
        const cdataMatch = upd.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
        if (idMatch) {
            updates[idMatch[1]] = cdataMatch ? cdataMatch[1] : upd.replace(/<\/?update[^>]*>/gi, '');
        }
    }
    return updates;
}

// Obtener página de formulario PrimeFaces y extraer ViewState
async function getMarcanetFormPage(session, sessionKey, formUrl) {
    const resp = await fetch(formUrl, {
        headers: marcanetHeaders(session),
        redirect: 'follow'
    });
    updateSessionCookies(sessionKey, resp);
    const html = await resp.text();
    const viewState = extractViewState(html);
    return { html, viewState };
}

// Enviar AJAX PrimeFaces
async function sendPrimeFacesAjax(session, sessionKey, formUrl, params) {
    const formData = new URLSearchParams();
    formData.append('javax.faces.partial.ajax', 'true');
    // JSF toma el primer valor: si la petición trae su propio execute (la
    // paginación ejecuta solo la tabla), no se antepone @all.
    if (!('javax.faces.partial.execute' in params)) formData.append('javax.faces.partial.execute', '@all');
    for (const [k, v] of Object.entries(params)) {
        formData.append(k, v);
    }

    const resp = await fetch(formUrl, {
        method: 'POST',
        headers: Object.assign({}, marcanetHeaders(session), {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Faces-Request': 'partial/ajax',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/xml, text/xml, */*; q=0.01'
        }),
        body: formData.toString(),
        redirect: 'follow'
    });

    updateSessionCookies(sessionKey, resp);
    const text = await resp.text();
    return { text, updates: parsePrimeFacesResponse(text) };
}

// Handler: inicializar sesión
async function handleMarcanetSession(request) {
    try {
        const session = await ensureMarcanetSession(request);
        return new Response(JSON.stringify({ sessionActive: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'No se pudo iniciar sesión con Marcanet: ' + e.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Palabras clave que indican que una tabla es un formulario, no datos
const FORM_LABEL_BLACKLIST = [
    'tipo de búsqueda', 'tipo de busqueda', 'buscar', 'limpiar',
    'seleccione', 'ingrese', 'escriba', 'captur'
];

// Detectar si una tabla contiene elementos de formulario
function isFormTable(tableHTML) {
    return /<(?:input|select|textarea|button)\b/i.test(tableHTML);
}

// Detectar si un row parece ser un label de formulario
function isFormLabelRow(rowData) {
    const keys = Object.keys(rowData).filter(function(k) { return !k.startsWith('_'); });
    const vals = keys.map(function(k) { return (rowData[k] || '').toLowerCase(); });
    const allText = keys.concat(vals).join(' ').toLowerCase();
    return FORM_LABEL_BLACKLIST.some(function(bl) { return allText.indexOf(bl) >= 0; });
}

// Parsear tabla HTML de resultados Marcanet a JSON
function parseMarcanetResultsHTML(html) {
    // Extraer todas las tablas
    const allTables = html.match(/<table[\s\S]*?<\/table>/gi) || [];

    // Filtrar tablas que son formularios (contienen <input>, <select>, etc.)
    const dataTables = allTables.filter(function(t) { return !isFormTable(t); });

    // Si no hay tablas sin formularios, intentar con todas pero con filtrado estricto
    const candidates = dataTables.length > 0 ? dataTables : allTables;

    // Buscar la mejor tabla candidata (más filas de datos, no de formulario)
    let bestResults = [];
    for (const t of candidates) {
        const parsed = parseMarcanetTable(t);
        // Filtrar filas que parecen ser labels de formulario
        const realData = parsed.filter(function(row) { return !isFormLabelRow(row); });
        if (realData.length > bestResults.length) {
            bestResults = realData;
        }
    }

    return bestResults;
}

function parseMarcanetTable(tableHTML, encabezadosRespaldo) {
    const results = [];
    // Extraer encabezados
    let headers = [];
    const thMatches = tableHTML.match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
    for (const th of thMatches) {
        const text = th.replace(/<[^>]+>/g, '').trim();
        headers.push(text);
    }
    // Las páginas siguientes de una tabla llegan sin encabezados: se usan
    // los de la primera.
    if (!headers.length && encabezadosRespaldo) headers = encabezadosRespaldo;

    // Extraer filas de datos
    const rows = tableHTML.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const row of rows) {
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (!cells || cells.length < 2) continue;

        const rowData = {};
        cells.forEach(function(cell, idx) {
            // Extraer texto limpio y también enlaces
            const linkMatch = cell.match(/href="([^"]*?)"/i);
            // Strip <script> blocks before removing tags to avoid script content leaking into text
            const cleanCell = cell.replace(/<script[\s\S]*?<\/script>/gi, '');
            const text = cleanCell.replace(/<[^>]+>/g, '').trim();
            const headerName = headers[idx] || ('col' + idx);
            rowData[headerName] = text;
            if (linkMatch) rowData['_link_' + idx] = linkMatch[1];

            // Capturar onclick con JavaScript (ej: onclick="verDetalle('123')" o location.href='...')
            const onclickMatch = cell.match(/onclick="([^"]*)"/i);
            if (onclickMatch) {
                rowData['_onclick_' + idx] = onclickMatch[1];
                // Extraer URL de window.open('...') - common in PrimeFaces Marcanet
                const winOpenMatch = onclickMatch[1].match(/window\.open\s*\(\s*'([^']*)'/i);
                if (winOpenMatch) {
                    // Decode HTML entities (&amp; → &)
                    rowData['_link_' + idx] = winOpenMatch[1].replace(/&amp;/g, '&');
                }
                // Extraer URL de location.href='...'
                const locMatch = onclickMatch[1].match(/location\.href\s*=\s*'([^']*)'/i);
                if (locMatch) rowData['_link_' + idx] = locMatch[1];
                // Extraer parámetros de funciones JS como verDetalle('123')
                const funcMatch = onclickMatch[1].match(/\w+\s*\(\s*'([^']*)'/i);
                if (funcMatch && !rowData['_link_' + idx]) rowData['_js_param_' + idx] = funcMatch[1];
            }

            // Capturar onclick en <a> tags dentro del cell
            const aOnclickMatch = cell.match(/<a[^>]*onclick="([^"]*)"/i);
            if (aOnclickMatch) {
                rowData['_onclick_' + idx] = aOnclickMatch[1];
                const winOpenMatch2 = aOnclickMatch[1].match(/window\.open\s*\(\s*'([^']*)'/i);
                if (winOpenMatch2) rowData['_link_' + idx] = winOpenMatch2[1].replace(/&amp;/g, '&');
                const locMatch2 = aOnclickMatch[1].match(/location\.href\s*=\s*'([^']*)'/i);
                if (locMatch2) rowData['_link_' + idx] = locMatch2[1];
            }
        });

        // También capturar onclick en el <tr> mismo
        const trOnclick = row.match(/<tr[^>]*onclick="([^"]*)"/i);
        if (trOnclick) {
            rowData['_tr_onclick'] = trOnclick[1];
            const locMatch3 = trOnclick[1].match(/location\.href\s*=\s*'([^']*)'/i);
            if (locMatch3) rowData['_link_tr'] = locMatch3[1];
        }

        // Solo agregar filas con datos significativos
        const values = Object.values(rowData).filter(function(v) { return v && !String(v).startsWith('_'); });
        if (values.length >= 2) results.push(rowData);
    }
    return results;
}

// Parsear detalle de expediente HTML a JSON
function parseMarcanetDetailHTML(html) {
    const detail = {};

    // Strip <script> blocks to avoid script content leaking into text
    const cleanHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');

    // Labels de formulario que NO son datos de marcas
    const detailBlacklist = ['tipo de búsqueda', 'tipo de busqueda', 'buscar', 'limpiar',
        'seleccione', 'ingrese', 'escriba', 'captur', 'acción', 'accion'];

    function isBlacklisted(label) {
        const l = label.toLowerCase();
        return detailBlacklist.some(function(bl) { return l.indexOf(bl) >= 0; });
    }

    // PrimeFaces ui-outputlabel + value pattern
    // <label class="ui-outputlabel">Expediente:</label> <span>123456</span>
    const pfLabelMatches = cleanHtml.match(/<label[^>]*class="[^"]*ui-outputlabel[^"]*"[^>]*>[\s\S]*?<\/label>\s*(?:<[^>]*>)?\s*[\s\S]*?(?=<label|<\/div|<\/td|$)/gi) || [];
    for (const lv of pfLabelMatches) {
        const labelMatch = lv.match(/<label[^>]*>([\s\S]*?)<\/label>/i);
        if (!labelMatch) continue;
        const label = labelMatch[1].replace(/<[^>]+>/g, '').replace(/[:\s*]+$/, '').trim();
        const valueText = lv.substring(lv.indexOf('</label>') + 8).replace(/<[^>]+>/g, '').trim();
        if (label && valueText && !isBlacklisted(label) && !detail[label]) {
            detail[label] = valueText;
        }
    }

    // PrimeFaces control_label_impi pattern
    // <span class="control_label_impi">Label</span> ... <span>Value</span>
    const impiLabelMatches = cleanHtml.match(/<span[^>]*class="[^"]*control_label_impi[^"]*"[^>]*>[\s\S]*?<\/span>[\s\S]*?(?=<span[^>]*class="[^"]*control_label_impi|<\/tr|<\/div|$)/gi) || [];
    for (const lv of impiLabelMatches) {
        const parts = lv.replace(/<[^>]+>/g, '|').split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2 && !isBlacklisted(parts[0]) && !detail[parts[0]]) {
            const label = parts[0].replace(/[:\s*]+$/, '').trim();
            const value = parts.slice(1).join(' ').trim();
            if (label && value) detail[label] = value;
        }
    }

    // Extraer todos los pares campo/valor de tablas
    const rows = cleanHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const row of rows) {
        // Saltar filas que contienen elementos de formulario
        if (/<(?:input|select|textarea|button)\b/i.test(row)) continue;

        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (!cells || cells.length < 2) continue;
        const label = cells[0].replace(/<[^>]+>/g, '').trim();
        const value = cells[1].replace(/<[^>]+>/g, '').trim();
        if (label && value) {
            if (!isBlacklisted(label) && !detail[label]) {
                detail[label] = value;
            }
        }
    }

    // También extraer datos de tablas con 3+ columnas (filas de datos tabulares)
    for (const row of rows) {
        if (/<(?:input|select|textarea|button)\b/i.test(row)) continue;
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (!cells || cells.length < 3) continue;
        for (let i = 0; i < cells.length - 1; i += 2) {
            const label = cells[i].replace(/<[^>]+>/g, '').trim();
            const value = cells[i + 1].replace(/<[^>]+>/g, '').trim();
            if (label && value && !detail[label] && !isBlacklisted(label)) {
                detail[label] = value;
            }
        }
    }

    // Extraer datos de listas de definición <dl><dt>/<dd>
    const dtMatches = cleanHtml.match(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi) || [];
    for (const dtdd of dtMatches) {
        const dtMatch = dtdd.match(/<dt[^>]*>([\s\S]*?)<\/dt>/i);
        const ddMatch = dtdd.match(/<dd[^>]*>([\s\S]*?)<\/dd>/i);
        if (dtMatch && ddMatch) {
            const label = dtMatch[1].replace(/<[^>]+>/g, '').trim();
            const value = ddMatch[1].replace(/<[^>]+>/g, '').trim();
            if (label && value && !detail[label]) {
                detail[label] = value;
            }
        }
    }

    // Extraer datos de divs con label/value pattern
    const labelValueDivs = cleanHtml.match(/<(?:span|label|strong|b)[^>]*class="[^"]*label[^"]*"[^>]*>([\s\S]*?)<\/(?:span|label|strong|b)>\s*:?\s*<(?:span|div)[^>]*>([\s\S]*?)<\/(?:span|div)>/gi) || [];
    for (const lv of labelValueDivs) {
        const parts = lv.replace(/<[^>]+>/g, '|').split('|').map(function(s) { return s.trim(); }).filter(Boolean);
        if (parts.length >= 2 && !detail[parts[0]]) {
            detail[parts[0]] = parts.slice(1).join(' ').trim();
        }
    }

    // Intentar extraer imagen si existe
    const imgMatches = cleanHtml.match(/<img[^>]*src="([^"]*?)"[^>]*>/gi) || [];
    for (const img of imgMatches) {
        const srcMatch = img.match(/src="([^"]*?)"/i);
        if (srcMatch && srcMatch[1] && !srcMatch[1].includes('logo') && !srcMatch[1].includes('banner') && !srcMatch[1].includes('icon')) {
            detail._imagen = srcMatch[1].startsWith('http') ? srcMatch[1] : MARCANET_BASE + srcMatch[1];
            break;
        }
    }

    // Extraer título si existe en un h1/h2/h3
    const titleMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    if (titleMatch) {
        detail._titulo = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    return detail;
}

// Handler: búsqueda fonética
async function handleMarcanetFonetica(request) {
    let session;
    try { session = await ensureMarcanetSession(request); } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json();
    const denominacion = body.denominacion || '';
    const clase = body.clase || '';

    if (!denominacion) {
        return new Response(JSON.stringify({ error: 'Denominación requerida' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const sessionKey = 'marcanet_' + getSessionKey(request);
    const formUrl = MARCANET_BASE + '/marcanet/vistas/common/datos/bsqFonetica.pgi';

    // Hasta cuántos resultados juntar leyendo las páginas siguientes (10 es
    // la primera página, lo de siempre). Solo el estudio de viabilidad pide más.
    const maxResultados = Math.max(0, Math.min(100, parseInt(body.maxResultados, 10) || 0));
    const depurar = body.depurar === true;

    // Una búsqueda: formulario nuevo (ViewState) y el AJAX de PrimeFaces.
    // Simular: PrimeFaces.ab({s:"frmBsqFonetica:busquedaId2", f:"frmBsqFonetica",
    //   u:"frmBsqFonetica:pnlBsqFonetica frmBsqFonetica:dlgListaFoneticos"})
    const buscar = async () => {
        const formPage = await getMarcanetFormPage(session, sessionKey, formUrl);
        const viewState = formPage.viewState;
        if (!viewState) throw new Error('No se encontró ViewState en formulario Marcanet');
        const ajaxParams = {
            'javax.faces.source': 'frmBsqFonetica:busquedaId2',
            'javax.faces.partial.render': 'frmBsqFonetica:pnlBsqFonetica frmBsqFonetica:dlgListaFoneticos',
            'frmBsqFonetica:busquedaId2': 'frmBsqFonetica:busquedaId2',
            'frmBsqFonetica': 'frmBsqFonetica',
            'frmBsqFonetica:denominacion': denominacion,
            'javax.faces.ViewState': viewState
        };
        if (clase) {
            ajaxParams['frmBsqFonetica:idClase'] = clase;
            ajaxParams['frmBsqFonetica:clase'] = clase;
        }
        const ajaxResp = await sendPrimeFacesAjax(session, sessionKey, formUrl, ajaxParams);
        const updates = ajaxResp.updates;

        // Los resultados deberían estar en el update de dlgListaFoneticos o pnlBsqFonetica
        let resultsHtml = '';
        for (const [updateId, updateHtml] of Object.entries(updates)) {
            if (updateId.includes('dlgListaFoneticos') || updateId.includes('pnlBsqFonetica') || updateId.includes('tblResultados')) {
                resultsHtml += updateHtml + '\n';
            }
        }
        // Si no se encontraron en updates específicos, buscar en todo el response
        if (!resultsHtml) resultsHtml = ajaxResp.text;

        // Filtrar resultados que son leyendas de formulario (como "TM = Tipo de marca")
        const results = parseMarcanetResultsHTML(resultsHtml).filter(function(r) {
            const vals = Object.values(r).filter(v => typeof v === 'string' && !v.startsWith('_'));
            // Si todos los valores contienen " = " son leyendas, no resultados
            const isLegend = vals.every(v => /^\w+ = /.test(v) || v.length < 3);
            return !isLegend;
        });
        return { ajaxResp, updates, resultsHtml, results, viewState };
    };

    let busqueda;
    try {
        busqueda = await buscar();
        // Marcanet a veces responde vacía (sesión recién abierta, o una
        // búsqueda sí y la siguiente no): una vez más antes de creerle.
        if (!busqueda.results.length) busqueda = await buscar();
    } catch (e) {
        return new Response(JSON.stringify({ error: 'No se pudo acceder al formulario de Marcanet: ' + e.message }),
            { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    let results = busqueda.results;
    const debugInfo = { updateKeys: Object.keys(busqueda.updates), rawLength: busqueda.ajaxResp.text.length };

    // Las páginas siguientes, si se pidieron y la primera vino llena.
    let paginacion = null;
    let primeraPagina = '';
    if (maxResultados > results.length) {
        const t = tablaMarcanet(busqueda.ajaxResp.text, results);
        if (t.id && results.length >= (t.porPagina || 10)) {
            const pag = await paginarMarcanet(params => sendPrimeFacesAjax(session, sessionKey, formUrl, params), {
                tabla: t.id, porPagina: t.porPagina || results.length, total: t.total, max: maxResultados, primeras: results,
                viewState: viewStateDe(busqueda.updates) || busqueda.viewState,
                encabezados: Object.keys(results[0]).filter(k => !k.startsWith('_')),
                extra: { 'frmBsqFonetica:denominacion': denominacion },
                alPedir: depurar ? (r => { if (!primeraPagina) primeraPagina = r.text; }) : null
            });
            results = results.concat(pag.filas);
            paginacion = pag.info;
        } else {
            paginacion = { tabla: t.id, porPagina: t.porPagina, total: t.total, leidas: 1, metodo: t.id ? 'una sola página' : 'sin tabla', error: '' };
        }
    }

    // Debug snippet
    const rawSnippet = busqueda.resultsHtml.substring(0, 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    debugInfo.rawSnippet = rawSnippet.substring(0, 800);
    debugInfo.fullResponseSnippet = busqueda.ajaxResp.text.substring(0, 1500).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);

    const salida = {
        results: results,
        totalResults: results.length,
        rawLength: busqueda.ajaxResp.text.length,
        status: 200,
        debug: debugInfo
    };
    if (paginacion) salida.paginacion = paginacion;
    // Para revisar en vivo cómo responde Marcanet (lo pide quien mantiene el proxy).
    if (depurar) salida.depuracion = { busqueda: busqueda.ajaxResp.text.substring(0, 40000), pagina: primeraPagina.substring(0, 20000) };
    return new Response(JSON.stringify(salida), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// ==================== MARCANET PÁGINAS (INICIO) ====================
// La fonética de Marcanet entrega 10 resultados: es la primera página de una
// tabla de PrimeFaces. Las demás se piden como lo hace su paginador, con un
// AJAX "page" sobre la tabla. Primero se intenta todo de una vez (pidiendo
// más filas por página) y, si no lo acepta, página por página. Si algo no
// cuadra se devuelve lo que ya se tenía: nunca menos que antes.

/** id de la tabla, filas por página y total, de la respuesta de la búsqueda. */
function tablaMarcanet(html, filas) {
    let id = null;
    const cw = /PrimeFaces\.cw\(\s*["']DataTable["']\s*,\s*["'][^"']*["']\s*,\s*\{\s*id\s*:\s*["']([^"']+)["']/.exec(html || '');
    if (cw) id = cw[1];
    if (!id) {
        // Del onclick de las filas: s:"frmBsqFonetica:resultadoExpediente:0:j_idt54"
        const texto = (filas || []).map(f => Object.keys(f).filter(k => k.startsWith('_onclick')).map(k => f[k]).join(' ')).join(' ') + ' ' + (html || '');
        const m = /s:(?:&quot;|")([A-Za-z0-9_]+:[A-Za-z0-9_]+):\d+:/.exec(texto);
        if (m) id = m[1];
    }
    let porPagina = null, total = null;
    if (cw) {
        const config = html.slice(cw.index, cw.index + 4000);
        const r = /\brows\s*:\s*(\d+)/.exec(config);
        const t = /\browCount\s*:\s*(\d+)/.exec(config);
        if (r) porPagina = parseInt(r[1], 10);
        if (t) total = parseInt(t[1], 10);
    }
    if (total == null) {
        // "(1 de 7)" o "1 - 10 de 63" en el paginador
        const m = /ui-paginator-current[^>]*>[^<]*?(\d+)\s*(?:de|of)\s*(\d+)\s*\)?\s*</i.exec(html || '');
        if (m && porPagina) total = /\(/.test(m[0]) ? parseInt(m[2], 10) * porPagina : parseInt(m[2], 10);
    }
    return { id, porPagina, total, paginador: /ui-paginator/.test(html || '') };
}

function claveFilaMarcanet(f) {
    return f['Expediente'] || f['Registro'] || JSON.stringify(Object.keys(f).filter(k => !k.startsWith('_')).map(k => f[k]));
}

function viewStateDe(updates) {
    for (const [id, v] of Object.entries(updates || {})) if (/javax\.faces\.ViewState/.test(id) && v && v.trim()) return v.trim();
    return null;
}

function parametrosPaginaMarcanet(tabla, primero, filas, viewState, extra) {
    const form = tabla.split(':')[0];
    return Object.assign({}, extra || {}, {
        'javax.faces.source': tabla,
        'javax.faces.partial.execute': tabla,
        'javax.faces.partial.render': tabla,
        'javax.faces.behavior.event': 'page',
        'javax.faces.partial.event': 'page',
        [tabla]: tabla,
        [tabla + '_pagination']: 'true',
        [tabla + '_first']: String(primero),
        [tabla + '_rows']: String(filas),
        [tabla + '_skipChildren']: 'true',
        [tabla + '_encodeFeature']: 'true',
        [form]: form,
        'javax.faces.ViewState': viewState
    });
}

/** Las filas de la respuesta de una página: llegan solas (<tr>…) o con la tabla. */
function filasDePaginaMarcanet(updates, tabla, encabezados) {
    let html = (updates || {})[tabla];
    if (html == null) html = Object.values(updates || {}).find(v => /<tr[\s>]/i.test(v)) || '';
    if (/<table[\s>]/i.test(html)) return parseMarcanetResultsHTML(html);
    return parseMarcanetTable('<table>' + html + '</table>', encabezados)
        .filter(r => !isFormLabelRow(r));
}

/**
 * enviar(params) → { text, updates }: el AJAX a Marcanet, ya con la sesión.
 * Devuelve las filas nuevas (sin las de la primera página) y qué pasó.
 */
async function paginarMarcanet(enviar, op) {
    const info = { tabla: op.tabla, porPagina: op.porPagina, total: op.total, leidas: 1, metodo: '', error: '' };
    const vistos = new Set(op.primeras.map(claveFilaMarcanet));
    const nuevas = [];
    const agregar = (filas) => {
        let n = 0;
        for (const f of filas) {
            const k = claveFilaMarcanet(f);
            if (!vistos.has(k)) { vistos.add(k); nuevas.push(f); n++; }
        }
        return n;
    };
    const objetivo = Math.min(op.max, op.total || op.max);
    const tengo = () => op.primeras.length + nuevas.length;
    let viewState = op.viewState;
    const pedir = async (primero, filas) => {
        info.leidas++;
        const r = await enviar(parametrosPaginaMarcanet(op.tabla, primero, filas, viewState, op.extra));
        viewState = viewStateDe(r.updates) || viewState;
        if (op.alPedir) op.alPedir(r);
        return filasDePaginaMarcanet(r.updates, op.tabla, op.encabezados);
    };
    try {
        // 1) Todo de una vez: PrimeFaces suele aceptar otro tamaño de página.
        if (agregar(await pedir(0, objetivo)) > 0) info.metodo = 'una';
        // 2) Lo que falte, página por página, hasta que una llegue vacía o repetida.
        if (tengo() < objetivo) {
            if (!info.metodo) info.metodo = 'paginas';
            const paso = op.porPagina || op.primeras.length || 10;
            for (let primero = Math.ceil(tengo() / paso) * paso; tengo() < objetivo && info.leidas < 12; primero += paso) {
                if (!agregar(await pedir(primero, paso))) break;
            }
        }
    } catch (e) {
        info.error = e.message;
    }
    if (!nuevas.length && !info.error) info.metodo = info.metodo || 'sin más páginas';
    return { filas: nuevas, info };
}
// ==================== MARCANET PÁGINAS (FIN) ====================

// Handler: búsqueda por número de expediente
async function handleMarcanetExpediente(request) {
    let session;
    try { session = await ensureMarcanetSession(request); } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json();
    const expediente = body.expediente || '';

    if (!expediente) {
        return new Response(JSON.stringify({ error: 'Número de expediente requerido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Intentar UCMServlet con el número de expediente codificado en Base64
    // Formato correcto: 1|1|1985|expediente (observado en URLs de Marcanet)
    const infoStr = '1|1|1985|' + expediente;
    const infoB64 = btoa(infoStr);

    const resp = await fetch(MARCANET_BASE + '/marcanet/UCMServlet?info=' + encodeURIComponent(infoB64), {
        headers: marcanetHeaders(session),
        redirect: 'follow'
    });

    const sessionKey = 'marcanet_' + getSessionKey(request);
    updateSessionCookies(sessionKey, resp);

    const html = await resp.text();
    const detail = parseMarcanetDetailHTML(html);

    // Si no hay datos suficientes del UCMServlet, intentar con la página de búsqueda
    if (Object.keys(detail).length < 3) {
        const formData = new URLSearchParams();
        formData.append('expediente', expediente);
        formData.append('p_expediente', expediente);
        formData.append('buscar', 'Buscar');

        const resp2 = await fetch(MARCANET_BASE + '/marcanet/vistas/common/datos/bsqExpediente.pgi', {
            method: 'POST',
            headers: Object.assign(marcanetHeaders(session), {
                'Content-Type': 'application/x-www-form-urlencoded'
            }),
            body: formData.toString(),
            redirect: 'follow'
        });

        updateSessionCookies(sessionKey, resp2);
        const html2 = await resp2.text();
        const detail2 = parseMarcanetDetailHTML(html2);
        Object.assign(detail, detail2);
    }

    const rawSnippet = html.substring(0, 1500).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return new Response(JSON.stringify({
        detail: detail,
        fieldCount: Object.keys(detail).length,
        rawSnippet: rawSnippet.substring(0, 500)
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// Handler: búsqueda por número de registro
async function handleMarcanetRegistro(request) {
    let session;
    try { session = await ensureMarcanetSession(request); } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json();
    const registro = body.registro || '';

    if (!registro) {
        return new Response(JSON.stringify({ error: 'Número de registro requerido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // UCMServlet con formato correcto: 1|1|1985|registro
    const infoStr = '1|1|1985|' + registro;
    const infoB64 = btoa(infoStr);

    const resp = await fetch(MARCANET_BASE + '/marcanet/UCMServlet?info=' + encodeURIComponent(infoB64), {
        headers: marcanetHeaders(session),
        redirect: 'follow'
    });

    const sessionKey = 'marcanet_' + getSessionKey(request);
    updateSessionCookies(sessionKey, resp);

    const html = await resp.text();
    const detail = parseMarcanetDetailHTML(html);

    // Fallback a la página de búsqueda por registro
    if (Object.keys(detail).length < 3) {
        const formData = new URLSearchParams();
        formData.append('registro', registro);
        formData.append('p_registro', registro);
        formData.append('buscar', 'Buscar');

        const resp2 = await fetch(MARCANET_BASE + '/marcanet/vistas/common/datos/bsqRegistroCompleto.pgi', {
            method: 'POST',
            headers: Object.assign(marcanetHeaders(session), {
                'Content-Type': 'application/x-www-form-urlencoded'
            }),
            body: formData.toString(),
            redirect: 'follow'
        });

        updateSessionCookies(sessionKey, resp2);
        const html2 = await resp2.text();
        const detail2 = parseMarcanetDetailHTML(html2);
        Object.assign(detail, detail2);
    }

    const rawSnippet2 = html.substring(0, 1500).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return new Response(JSON.stringify({
        detail: detail,
        fieldCount: Object.keys(detail).length,
        rawSnippet: rawSnippet2.substring(0, 500)
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// Handler: búsqueda por titular
async function handleMarcanetTitular(request) {
    let session;
    try { session = await ensureMarcanetSession(request); } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json();
    const titular = body.titular || '';

    if (!titular) {
        return new Response(JSON.stringify({ error: 'Nombre de titular requerido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const sessionKey = 'marcanet_' + getSessionKey(request);

    // Intentar múltiples URLs de formulario de titular
    const formUrls = [
        MARCANET_BASE + '/marcanet/vistas/common/datos/bsqTitularCompleta.pgi',
        MARCANET_BASE + '/marcanet/vistas/common/datos/bsqTitular.pgi'
    ];

    let viewState = null;
    let formHtml = '';
    let formUrl = formUrls[0];

    for (const url of formUrls) {
        try {
            const formPage = await getMarcanetFormPage(session, sessionKey, url);
            formHtml = formPage.html;
            if (formPage.viewState) {
                viewState = formPage.viewState;
                formUrl = url;
                break;
            }
        } catch (e) { /* intentar siguiente */ }
    }

    if (!viewState) {
        // Debug: extraer nombres de forms e inputs del HTML
        const formIds = (formHtml.match(/id="(frm[^"]*)"/gi) || []).map(m => m.match(/id="([^"]*)"/i)[1]);
        const inputNames = (formHtml.match(/name="([^"]*ViewState[^"]*)"/gi) || []).map(m => m.match(/name="([^"]*)"/i)[1]);
        const htmlSnippet = formHtml.substring(0, 3000).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);
        return new Response(JSON.stringify({
            error: 'No se encontró ViewState en formulario de titular Marcanet',
            debug: { formIds, inputNames, htmlSnippet, htmlLength: formHtml.length }
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    // Descubrir IDs del formulario desde PrimeFaces widget definitions y HTML
    // PrimeFaces generates: PrimeFaces.cw("CommandButton","widget_formId_btnId",{id:"formId:btnId"})
    // and: PrimeFaces.cw("InputText","widget_formId_inputId",{id:"formId:inputId"})
    const pfWidgets = {};
    const widgetRegex = /PrimeFaces\.cw\("(\w+)","[^"]*",\{id:"([^"]*)"/g;
    let wm;
    while ((wm = widgetRegex.exec(formHtml)) !== null) {
        pfWidgets[wm[2]] = wm[1]; // e.g. "frmBsqTitular:nombre" -> "InputText"
    }

    // Find the form ID from <form> tags
    const formTagMatch = formHtml.match(/<form[^>]*id="(frm[^"]*)"/i);
    const formId = formTagMatch ? formTagMatch[1] : 'frmBsqTitular';

    // Find input fields (InputText widgets within our form)
    const inputIds = Object.entries(pfWidgets)
        .filter(([id, type]) => type === 'InputText' && id.startsWith(formId + ':'))
        .map(([id]) => id);

    // Find command buttons (for search)
    const buttonIds = Object.entries(pfWidgets)
        .filter(([id, type]) => (type === 'CommandButton' || type === 'CommandLink') && id.startsWith(formId + ':'))
        .map(([id]) => id);

    // Also look for submit buttons via HTML pattern
    const htmlBtnMatches = formHtml.match(/id="([^"]*)"[^>]*(?:type="submit"|class="[^"]*ui-button[^"]*")[^>]*/gi) || [];
    for (const btnHtml of htmlBtnMatches) {
        const btnIdMatch = btnHtml.match(/id="([^"]*)"/);
        if (btnIdMatch && btnIdMatch[1].startsWith(formId + ':') && !buttonIds.includes(btnIdMatch[1])) {
            buttonIds.push(btnIdMatch[1]);
        }
    }

    // Also look for PrimeFaces.ab() calls which reveal AJAX source/process/update
    const abCalls = [];
    const abRegex = /PrimeFaces\.ab\(\{([^}]+)\}\)/g;
    let abm;
    while ((abm = abRegex.exec(formHtml)) !== null) {
        const parts = abm[1];
        const sMatch = parts.match(/s:"([^"]*)"/);
        const uMatch = parts.match(/u:"([^"]*)"/);
        if (sMatch) abCalls.push({ source: sMatch[1], update: uMatch ? uMatch[1] : '' });
    }

    // Determine the best search button - prefer one with an ab() call, then busquedaId
    let searchBtn = formId + ':busquedaId2';
    let renderTargets = formId;
    if (abCalls.length > 0) {
        searchBtn = abCalls[0].source;
        if (abCalls[0].update) renderTargets = abCalls[0].update;
    } else if (buttonIds.length > 0) {
        // Prefer button with "busqueda" in name
        searchBtn = buttonIds.find(id => /busqueda/i.test(id)) || buttonIds[0];
    }

    // Find the titular input - prefer field with "titular" or "nombre" in id
    const titularInput = inputIds.find(id => /titular/i.test(id)) ||
                          inputIds.find(id => /nombre/i.test(id)) ||
                          inputIds[0] ||
                          formId + ':titular';

    // Build AJAX params
    const ajaxParams = {
        'javax.faces.source': searchBtn,
        'javax.faces.partial.render': renderTargets,
        [searchBtn]: searchBtn,
        [formId]: formId,
        'javax.faces.ViewState': viewState
    };
    // Set all discovered input fields - the titular value goes to the right input
    for (const inputId of inputIds) {
        ajaxParams[inputId] = (inputId === titularInput) ? titular : '';
    }
    // If no inputs discovered, set explicit titular fields
    if (inputIds.length === 0) {
        ajaxParams[formId + ':titular'] = titular;
        ajaxParams[formId + ':nombre'] = titular;
    }

    const ajaxResp = await sendPrimeFacesAjax(session, sessionKey, formUrl, ajaxParams);
    const updates = ajaxResp.updates;

    let resultsHtml = '';
    let results = [];
    const debugInfo = {
        updateKeys: Object.keys(updates), rawLength: ajaxResp.text.length,
        formId, searchBtn, titularInput, renderTargets,
        pfWidgets, inputIds, buttonIds, abCalls,
        formHtmlSnippet: formHtml.substring(0, 4000).replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1000)
    };

    for (const [updateId, updateHtml] of Object.entries(updates)) {
        if (updateId.includes('dlgLista') || updateId.includes('pnlBsq') ||
            updateId.includes('tblResultados') || updateId.includes('resultadoTitular') ||
            updateId.includes('resultado')) {
            resultsHtml += updateHtml + '\n';
        }
    }

    if (!resultsHtml) resultsHtml = ajaxResp.text;

    results = parseMarcanetResultsHTML(resultsHtml);

    // Filtrar leyendas y filas de encabezado del formulario
    results = results.filter(function(r) {
        const vals = Object.values(r).filter(v => typeof v === 'string' && !v.startsWith('_'));
        // Filtrar filas que son solo labels del formulario
        if (vals.some(v => /^Por\s+(Titular|Fonética|Expediente)/i.test(v))) return false;
        if (vals.every(v => /^\w+ = /.test(v) || v.length < 3)) return false;
        return true;
    });

    const rawSnippet = resultsHtml.substring(0, 2000).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    debugInfo.rawSnippet = rawSnippet.substring(0, 800);

    return new Response(JSON.stringify({
        results: results,
        totalResults: results.length,
        rawLength: ajaxResp.text.length,
        status: 200,
        debug: debugInfo
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// Handler: seguir un enlace directo de resultados Marcanet
async function handleMarcanetDetailLink(request) {
    let session;
    try { session = await ensureMarcanetSession(request); } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json();
    const link = body.link || '';

    if (!link) {
        return new Response(JSON.stringify({ error: 'Link requerido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Construir URL completa si es relativa
    const url = link.startsWith('http') ? link : MARCANET_BASE + (link.startsWith('/') ? '' : '/marcanet/') + link;

    const resp = await fetch(url, {
        headers: marcanetHeaders(session),
        redirect: 'follow'
    });

    const sessionKey = 'marcanet_' + getSessionKey(request);
    updateSessionCookies(sessionKey, resp);

    const html = await resp.text();
    const detail = parseMarcanetDetailHTML(html);

    return new Response(JSON.stringify({
        detail: detail,
        fieldCount: Object.keys(detail).length,
        rawSnippet: html.substring(0, 1500).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500)
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// Handler: obtener detalle completo combinando Marcanet + MARCia
async function handleMarcanetFullDetail(request) {
    const body = await request.json();
    const expediente = body.expediente || '';
    const registro = body.registro || '';
    const link = body.link || '';
    const jsParam = body.jsParam || '';
    const denominacion = body.denominacion || '';

    if (!expediente && !registro && !link && !denominacion) {
        return new Response(JSON.stringify({ error: 'Se requiere expediente, registro, link o denominación' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const allDetail = {};
    const sources = [];
    const debugSnippets = {};

    // Helper: merge sin sobreescribir
    function mergeDetail(newData, sourceName) {
        let added = 0;
        for (const k in newData) {
            if (!allDetail[k] || (typeof allDetail[k] === 'string' && !allDetail[k].trim())) {
                allDetail[k] = newData[k];
                added++;
            }
        }
        if (added > 0) sources.push(sourceName);
    }

    // 1. Obtener datos de Marcanet
    let session;
    try { session = await ensureMarcanetSession(request); } catch (e) { /* ignorar */ }

    if (session) {
        const sessionKey = 'marcanet_' + getSessionKey(request);
        const hdrs = marcanetHeaders(session);

        // === PRIORIDAD 1: Link directo del resultado (tiene URL completa con tipo/anio/expediente) ===
        if (link) {
            try {
                const url = link.startsWith('http') ? link : MARCANET_BASE + (link.startsWith('/') ? '' : '/marcanet/') + link;
                const resp = await fetch(url, { headers: hdrs, redirect: 'follow' });
                updateSessionCookies(sessionKey, resp);
                const html = await resp.text();
                const detail = parseMarcanetDetailHTML(html);
                const nonInternal = Object.keys(detail).filter(k => !k.startsWith('_'));
                if (nonInternal.length > 0) {
                    Object.assign(allDetail, detail);
                    sources.push('marcanet-link');
                    debugSnippets['link'] = html.substring(0, 3000).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 800);
                }
            } catch (e) { /* ignorar */ }
        }

        // === PRIORIDAD 2: detalleExpedienteParcial.pgi con parámetros conocidos ===
        if ((expediente || registro || jsParam) && Object.keys(allDetail).filter(k => !k.startsWith('_')).length < 3) {
            const numToTry = expediente || jsParam || registro;
            const detailUrls = [
                // GET con query params - formato Marcanet PrimeFaces: tipo=1&anio=1985&expediente=XXXXX
                { method: 'GET', url: MARCANET_BASE + '/marcanet/vistas/common/busquedas/detalleExpedienteParcial.pgi?tipo=1&anio=1985&expediente=' + numToTry },
                { method: 'GET', url: MARCANET_BASE + '/marcanet/vistas/common/busquedas/detalleExpedienteParcial.pgi?expediente=' + numToTry },
            ];

            for (const attempt of detailUrls) {
                try {
                    const fetchOpts = { headers: Object.assign({}, hdrs), redirect: 'follow' };
                    if (attempt.method === 'POST') {
                        fetchOpts.method = 'POST';
                        fetchOpts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                        fetchOpts.body = attempt.body;
                    }
                    const resp = await fetch(attempt.url, fetchOpts);
                    updateSessionCookies(sessionKey, resp);
                    const html = await resp.text();

                    // Solo procesar si no es un formulario vacío
                    const isForm = /<form[\s\S]{0,500}buscar/i.test(html);
                    const detail = parseMarcanetDetailHTML(html);
                    const nonInternalKeys = Object.keys(detail).filter(k => !k.startsWith('_'));

                    if (nonInternalKeys.length >= 3) {
                        // Encontramos datos reales
                        Object.assign(allDetail, detail);
                        sources.push('detalle-expediente');
                        debugSnippets['detalle'] = html.substring(0, 3000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 800);
                        break;
                    } else if (nonInternalKeys.length > 0 && !isForm) {
                        mergeDetail(detail, 'detalle-parcial');
                        debugSnippets['detalle-parcial'] = html.substring(0, 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);
                    }
                } catch (e) { /* siguiente intento */ }
            }
        }

        // === PRIORIDAD 3: UCMServlet con expediente ===
        if (expediente) {
            try {
                const infoStr = '1|1|1985|' + expediente;
                const resp = await fetch(MARCANET_BASE + '/marcanet/UCMServlet?info=' + encodeURIComponent(btoa(infoStr)), {
                    headers: hdrs, redirect: 'follow'
                });
                updateSessionCookies(sessionKey, resp);
                const html = await resp.text();
                const detail = parseMarcanetDetailHTML(html);
                mergeDetail(detail, 'marcanet-ucm');
            } catch (e) { /* ignorar */ }
        }

        // === PRIORIDAD 4: UCMServlet con registro ===
        if (registro) {
            try {
                const infoStr = '1|1|1985|' + registro;
                const resp = await fetch(MARCANET_BASE + '/marcanet/UCMServlet?info=' + encodeURIComponent(btoa(infoStr)), {
                    headers: hdrs, redirect: 'follow'
                });
                updateSessionCookies(sessionKey, resp);
                const html = await resp.text();
                const detail = parseMarcanetDetailHTML(html);
                mergeDetail(detail, 'marcanet-ucm-reg');
            } catch (e) { /* ignorar */ }
        }

        // === PRIORIDAD 5: Búsqueda por expediente via PrimeFaces AJAX ===
        if (expediente && Object.keys(allDetail).filter(k => !k.startsWith('_')).length < 3) {
            try {
                const bsqExpUrl = MARCANET_BASE + '/marcanet/vistas/common/datos/bsqExpediente.pgi';
                const formPage = await getMarcanetFormPage(session, sessionKey, bsqExpUrl);
                if (formPage.viewState) {
                    const ajaxResp = await sendPrimeFacesAjax(session, sessionKey, bsqExpUrl, {
                        'javax.faces.source': 'frmBsqExpediente:busquedaId2',
                        'javax.faces.partial.render': 'frmBsqExpediente:pnlBsqExpediente frmBsqExpediente:dlgListaExpedientes',
                        'frmBsqExpediente:busquedaId2': 'frmBsqExpediente:busquedaId2',
                        'frmBsqExpediente': 'frmBsqExpediente',
                        'frmBsqExpediente:expediente': expediente,
                        'javax.faces.ViewState': formPage.viewState
                    });
                    const detail = parseMarcanetDetailHTML(ajaxResp.text);
                    mergeDetail(detail, 'marcanet-bsq-exp');
                }
            } catch (e) { /* ignorar */ }
        }
    }

    // 2. Intentar enriquecer con MARCia (tiene datos más estructurados)
    let marciaData = null;
    const marciaSessionKey = getSessionKey(request);
    const marciaSession = sessions.get(marciaSessionKey);
    debugSnippets['marciaSessionExists'] = !!marciaSession;
    debugSnippets['marciaHasCsrf'] = !!(marciaSession && marciaSession.csrf);
    debugSnippets['marciaSessionKey'] = marciaSessionKey;

    // Siempre crear sesión MARCia fresca para enrichment
    // La sesión existente pudo haber sido modificada por /marcia/search y /marcia/results del cliente
    const enrichSessionKey = 'enrich_' + marciaSessionKey + '_' + Date.now();
    try {
        const csrfResp = await fetch(MARCIA_BASE + '/marcas/search/quick', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml'
            },
            redirect: 'follow'
        });
        const csrfHtml = await csrfResp.text();
        const csrfMatch = csrfHtml.match(/<meta\s+name="_csrf"\s+content="([^"]+)"/);
        if (csrfMatch) {
            const freshSession = {
                csrf: csrfMatch[1],
                cookies: extractCookies(csrfResp),
                timestamp: Date.now()
            };
            sessions.set(enrichSessionKey, freshSession);
            debugSnippets['marciaFreshSession'] = true;
        } else {
            debugSnippets['marciaFreshSessionNoCsrf'] = true;
        }
    } catch (e) { debugSnippets['marciaSessionError'] = e.message; }

    const activeMarciaSession = sessions.get(enrichSessionKey);

    if (activeMarciaSession && activeMarciaSession.csrf) {
        const searchNum = expediente || registro || '';
        // Buscar por número O por denominación
        if (searchNum || denominacion) {
            try {
                // Helper to get fresh headers (cookies may update between calls)
                const getMarciaHdrs = () => {
                    const s = sessions.get(enrichSessionKey);
                    return {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-XSRF-TOKEN': s.csrf,
                        'Cookie': s.cookies,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': MARCIA_BASE + '/marcas/search/quick',
                        'Origin': MARCIA_BASE
                    };
                };

                let searchBody;
                if (searchNum) {
                    // Búsqueda estructurada por número - match client format exactly
                    searchBody = {
                        _type: 'Search$Structured',
                        images: [],
                        query: {
                            title: '', titleOption: '',
                            name: null,
                            number: { name: searchNum, types: expediente ? ['APPLICATION'] : ['REGISTRATION'] },
                            date: null,
                            status: [], classes: [], codes: [], indicators: [],
                            markType: [], appType: [],
                            goodsAndServices: '',
                            wordSet: { l: null, op: 'AND', r: null }
                        }
                    };
                } else {
                    // Búsqueda por denominación (similar) - cuando no tenemos números
                    searchBody = {
                        _type: 'Search$Quick',
                        query: denominacion,
                        images: []
                    };
                }

                const searchResp = await fetch(MARCIA_BASE + '/marcas/search/internal/record', {
                    method: 'POST', headers: getMarciaHdrs(), body: JSON.stringify(searchBody)
                });
                debugSnippets['marciaSearchStatus'] = searchResp.status;

                if (!searchResp.ok) {
                    const errText = await searchResp.text();
                    debugSnippets['marciaSearchError'] = errText.substring(0, 300);
                } else {
                    updateSessionCookies(enrichSessionKey, searchResp);
                    const searchData = await searchResp.json();
                    debugSnippets['marciaSearchId'] = searchData.id || 'none';

                    if (searchData.id) {
                        const resultResp = await fetch(MARCIA_BASE + '/marcas/search/internal/result', {
                            method: 'POST', headers: getMarciaHdrs(),
                            body: JSON.stringify({
                                searchId: searchData.id,
                                pageSize: searchNum ? 1 : 5, pageNumber: 0,
                                statusFilter: [], viennaCodeFilter: [], niceClassFilter: []
                            })
                        });
                        debugSnippets['marciaResultStatus'] = resultResp.status;

                        if (resultResp.ok) {
                            updateSessionCookies(enrichSessionKey, resultResp);
                            const resultData = await resultResp.json();
                            debugSnippets['marciaResultCount'] = resultData.resultPage ? resultData.resultPage.length : 0;

                            if (resultData.resultPage && resultData.resultPage.length > 0) {
                                let bestMatch = resultData.resultPage[0];
                                if (!searchNum && denominacion) {
                                    const denomLower = denominacion.toLowerCase().trim();
                                    for (const rp of resultData.resultPage) {
                                        if (rp.title && rp.title.toLowerCase().trim() === denomLower) {
                                            bestMatch = rp;
                                            break;
                                        }
                                    }
                                }

                                const markId = bestMatch.id;
                                const viewResp = await fetch(MARCIA_BASE + '/marcas/search/internal/view/' + encodeURIComponent(markId), {
                                    headers: getMarciaHdrs()
                                });
                                debugSnippets['marciaViewStatus'] = viewResp.status;

                                if (viewResp.ok) {
                                    updateSessionCookies(enrichSessionKey, viewResp);
                                    marciaData = await viewResp.json();
                                    sources.push('marcia');
                                } else {
                                    debugSnippets['marciaViewError'] = (await viewResp.text()).substring(0, 300);
                                }
                            }
                        } else {
                            debugSnippets['marciaResultError'] = (await resultResp.text()).substring(0, 300);
                        }
                    }
                }
            } catch (e) {
                debugSnippets['marciaError'] = e.message;
            }
        }
    }

    // Limpiar sesión temporal de enrichment
    sessions.delete(enrichSessionKey);

    return new Response(JSON.stringify({
        detail: allDetail,
        marcia: marciaData,
        fieldCount: Object.keys(allDetail).filter(k => !k.startsWith('_')).length,
        sources: sources,
        debug: debugSnippets
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// ==================== HELPERS ====================

function isOriginAllowed(origin) {
    if (!origin) return true; // Peticiones no-navegador (pruebas con curl)
    if (LOCAL_ORIGIN_RE.test(origin)) return true;
    // Comparación exacta: con startsWith, un origen como
    // "http://localhost.dominio-ajeno.com" pasaba el filtro.
    return ALLOWED_ORIGINS.includes(origin);
}

// Solo se acepta un id de cliente con forma conocida, porque se usa para
// componer la clave del Map de sesiones.
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function getSessionKey(request) {
    // El id que manda el navegador separa a cada usuario. Antes la clave era
    // la IP, así que dos personas detrás de la misma salida a internet
    // compartían la sesión de MARCia, Marcanet y SIGA, y se pisaban las
    // cookies y el searchId entre sí.
    const clientId = request.headers.get(CLIENT_HEADER) || '';
    if (CLIENT_ID_RE.test(clientId)) return 'c:' + clientId;

    // Clientes viejos que aún no mandan el id: se conserva el comportamiento
    // anterior para no romperlos.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const origin = request.headers.get('Origin') || 'direct';
    return ip + ':' + origin;
}

function extractCookies(response) {
    const cookies = [];

    // Método 1: getSetCookie() - estándar en Cloudflare Workers
    if (typeof response.headers.getSetCookie === 'function') {
        const setCookies = response.headers.getSetCookie();
        for (const sc of setCookies) {
            const cookiePart = sc.split(';')[0].trim();
            if (cookiePart) cookies.push(cookiePart);
        }
    }

    // Método 2: getAll (legacy Workers)
    if (cookies.length === 0 && typeof response.headers.getAll === 'function') {
        try {
            const all = response.headers.getAll('set-cookie');
            for (const sc of all) {
                const cookiePart = sc.split(';')[0].trim();
                if (cookiePart) cookies.push(cookiePart);
            }
        } catch (e) { /* ignorar si no soporta */ }
    }

    // Método 3: get() puede devolver múltiples cookies separadas por coma
    if (cookies.length === 0) {
        const raw = response.headers.get('set-cookie');
        if (raw) {
            // Split por coma pero cuidando no partir valores de cookies que contengan comas
            const parts = raw.split(/,(?=\s*[A-Za-z_-]+=)/);
            for (const part of parts) {
                const cookiePart = part.split(';')[0].trim();
                if (cookiePart) cookies.push(cookiePart);
            }
        }
    }

    return cookies.join('; ');
}

function updateSessionCookies(sessionKey, response) {
    const session = sessions.get(sessionKey);
    if (!session) return;

    const newCookies = extractCookies(response);
    if (newCookies) {
        // Merge cookies
        const existing = parseCookies(session.cookies);
        const fresh = parseCookies(newCookies);
        Object.assign(existing, fresh);
        session.cookies = Object.entries(existing).map(([k, v]) => k + '=' + v).join('; ');
        session.timestamp = Date.now();
    }
}

function parseCookies(cookieStr) {
    const cookies = {};
    if (!cookieStr) return cookies;
    cookieStr.split(';').forEach(function(part) {
        const [key, ...rest] = part.trim().split('=');
        if (key && rest.length > 0) {
            cookies[key.trim()] = rest.join('=').trim();
        }
    });
    return cookies;
}

function handleCORS(request) {
    const origin = request.headers.get('Origin') || '';
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': isOriginAllowed(origin) ? origin : '',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Accept, ' + SESSION_HEADER + ', ' + CLIENT_HEADER + ', ' + CUOTA_HEADER,
            'Access-Control-Max-Age': '86400'
        }
    });
}

function addCORSHeaders(response, origin) {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', origin || '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Accept, ' + SESSION_HEADER + ', ' + CLIENT_HEADER + ', ' + CUOTA_HEADER);
    // Sin esto el navegador no deja al cliente leer la sesión actualizada.
    newHeaders.set('Access-Control-Expose-Headers', SESSION_HEADER);

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
    });
}

// Limpiar sesiones viejas (> 30 min) en cada request
function limpiarSesionesViejas() {
    const now = Date.now();
    for (const [key, session] of sessions.entries()) {
        if (now - session.timestamp > 30 * 60 * 1000) {
            sessions.delete(key);
        }
    }
}
