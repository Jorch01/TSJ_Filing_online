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
// ============================================================

const ALLOWED_ORIGINS = [
    'https://jorch01.github.io',
    'https://tsjia.empirica.mx',
    'http://localhost',
    'http://127.0.0.1'
];

const MARCIA_BASE = 'https://marcia.impi.gob.mx';
const SIGA_BASE = 'https://siga.impi.gob.mx:5007';

// Almacén de sesiones MARCia (CSRF token + cookies) por IP/origen
// En producción considerar KV o Durable Objects para persistencia
const sessions = new Map();

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
            // ===== Health check =====
            else if (path === '/health') {
                response = new Response(JSON.stringify({
                    status: 'ok',
                    services: ['marcia', 'siga'],
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

    // Extraer cookies de la respuesta
    const cookies = resp.headers.getAll ? resp.headers.getAll('set-cookie') : [];
    const cookieHeader = extractCookies(resp);

    // Guardar sesión
    sessions.set(sessionKey, {
        csrf: csrfMatch[1],
        cookies: cookieHeader,
        timestamp: Date.now()
    });

    return new Response(JSON.stringify({
        csrf: csrfMatch[1],
        sessionActive: true
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleMarciaSearch(request) {
    const sessionKey = getSessionKey(request);
    const session = sessions.get(sessionKey);

    if (!session) {
        return new Response(JSON.stringify({ error: 'No active session. Call /marcia/csrf first.' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

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

    // Actualizar cookies si cambiaron
    updateSessionCookies(sessionKey, resp);

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleMarciaResults(request) {
    const sessionKey = getSessionKey(request);
    const session = sessions.get(sessionKey);

    if (!session) {
        return new Response(JSON.stringify({ error: 'No active session' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

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

    updateSessionCookies(sessionKey, resp);

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleMarciaView(request, markId) {
    const sessionKey = getSessionKey(request);
    const session = sessions.get(sessionKey);

    if (!session) {
        return new Response(JSON.stringify({ error: 'No active session' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

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

    updateSessionCookies(sessionKey, resp);

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' }
    });
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

// ==================== HELPERS ====================

function isOriginAllowed(origin) {
    if (!origin) return true; // Allow non-browser requests (testing)
    return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));
}

function getSessionKey(request) {
    // Usar IP del cliente como clave de sesión
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
            'Access-Control-Allow-Headers': 'Content-Type, Accept',
            'Access-Control-Max-Age': '86400'
        }
    });
}

function addCORSHeaders(response, origin) {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', origin || '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Accept');

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
