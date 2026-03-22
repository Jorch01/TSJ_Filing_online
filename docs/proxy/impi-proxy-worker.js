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

async function handleSigaCsrf(request) {
    const sessionKey = 'siga_' + getSessionKey(request);

    // Fetch SIGA para obtener la cookie XSRF-TOKEN
    const resp = await fetch('https://siga.impi.gob.mx/', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html'
        },
        redirect: 'follow'
    });

    const cookieHeader = extractCookies(resp);

    // Buscar XSRF-TOKEN en cookies
    const xsrfMatch = cookieHeader.match(/XSRF-TOKEN=([^;]+)/);
    const xsrfToken = xsrfMatch ? decodeURIComponent(xsrfMatch[1]) : null;

    if (!xsrfToken) {
        return new Response(JSON.stringify({ error: 'No XSRF token found in SIGA cookies' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    sessions.set(sessionKey, {
        xsrf: xsrfToken,
        cookies: cookieHeader,
        timestamp: Date.now()
    });

    return new Response(JSON.stringify({
        xsrf: xsrfToken,
        sessionActive: true,
        note: 'reCAPTCHA token must be provided by client'
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleSigaSearch(request) {
    const sessionKey = 'siga_' + getSessionKey(request);
    const session = sessions.get(sessionKey);

    if (!session) {
        return new Response(JSON.stringify({ error: 'No active SIGA session. Call /siga/csrf first.' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const body = await request.json();

    // El cliente debe enviar el ReCaptchaToken
    if (!body.ReCaptchaToken) {
        return new Response(JSON.stringify({
            error: 'ReCaptchaToken is required. Generate it client-side with grecaptcha.execute().'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const resp = await fetch(SIGA_BASE + '/api/BusquedaFicha/GetFichas', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-XSRF-TOKEN': session.xsrf,
            'Cookie': session.cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://siga.impi.gob.mx/',
            'Origin': 'https://siga.impi.gob.mx'
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

async function handleSigaFicha(request) {
    const sessionKey = 'siga_' + getSessionKey(request);
    const session = sessions.get(sessionKey);

    if (!session) {
        return new Response(JSON.stringify({ error: 'No active SIGA session' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const body = await request.json();

    const resp = await fetch(SIGA_BASE + '/api/BusquedaFicha/GetFichaInfo', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-XSRF-TOKEN': session.xsrf,
            'Cookie': session.cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://siga.impi.gob.mx/',
            'Origin': 'https://siga.impi.gob.mx'
        },
        body: JSON.stringify(body)
    });

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
        status: resp.status,
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
    // Cloudflare Workers: getAll puede no existir en todos los contextos
    const cookies = [];
    // Iterar headers buscando set-cookie
    for (const [key, value] of response.headers.entries()) {
        if (key.toLowerCase() === 'set-cookie') {
            // Extraer nombre=valor de la cookie
            const cookiePart = value.split(';')[0];
            cookies.push(cookiePart);
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

// Limpiar sesiones viejas (> 30 min) periódicamente
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions.entries()) {
        if (now - session.timestamp > 30 * 60 * 1000) {
            sessions.delete(key);
        }
    }
}, 5 * 60 * 1000);
