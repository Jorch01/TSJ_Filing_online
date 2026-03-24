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
const MARCANET_BASE = 'https://acervomarcas.impi.gob.mx:8181';

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
                    services: ['marcia', 'siga', 'marcanet'],
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
    // Buscar javax.faces.ViewState en inputs hidden
    const match = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/i) ||
                  html.match(/id="j_id1:javax\.faces\.ViewState:0"[^>]*value="([^"]*)"/i) ||
                  html.match(/javax\.faces\.ViewState[^>]*value="([^"]*)"/i);
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
    formData.append('javax.faces.partial.execute', '@all');
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

function parseMarcanetTable(tableHTML) {
    const results = [];
    // Extraer encabezados
    const headers = [];
    const thMatches = tableHTML.match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
    for (const th of thMatches) {
        const text = th.replace(/<[^>]+>/g, '').trim();
        headers.push(text);
    }

    // Extraer filas de datos
    const rows = tableHTML.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const row of rows) {
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (!cells || cells.length < 2) continue;

        const rowData = {};
        cells.forEach(function(cell, idx) {
            // Extraer texto limpio y también enlaces
            const linkMatch = cell.match(/href="([^"]*?)"/i);
            const text = cell.replace(/<[^>]+>/g, '').trim();
            const headerName = headers[idx] || ('col' + idx);
            rowData[headerName] = text;
            if (linkMatch) rowData['_link_' + idx] = linkMatch[1];

            // Capturar onclick con JavaScript (ej: onclick="verDetalle('123')" o location.href='...')
            const onclickMatch = cell.match(/onclick="([^"]*)"/i);
            if (onclickMatch) {
                rowData['_onclick_' + idx] = onclickMatch[1];
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

    // Labels de formulario que NO son datos de marcas
    const detailBlacklist = ['tipo de búsqueda', 'tipo de busqueda', 'buscar', 'limpiar',
        'seleccione', 'ingrese', 'escriba', 'captur', 'acción', 'accion'];

    // Extraer todos los pares campo/valor de tablas
    const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const row of rows) {
        // Saltar filas que contienen elementos de formulario
        if (/<(?:input|select|textarea|button)\b/i.test(row)) continue;

        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (!cells || cells.length < 2) continue;
        const label = cells[0].replace(/<[^>]+>/g, '').trim();
        const value = cells[1].replace(/<[^>]+>/g, '').trim();
        if (label && value) {
            // Verificar que no es un label de formulario
            const labelLower = label.toLowerCase();
            const isBlacklisted = detailBlacklist.some(function(bl) { return labelLower.indexOf(bl) >= 0; });
            if (!isBlacklisted) {
                detail[label] = value;
            }
        }
    }

    // También extraer datos de tablas con 3+ columnas (filas de datos tabulares)
    for (const row of rows) {
        if (/<(?:input|select|textarea|button)\b/i.test(row)) continue;
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (!cells || cells.length < 3) continue;
        // Tablas de 3+ cols: podría ser datos como "Campo | Valor | Extra"
        // Ya procesadas arriba para pares de 2, aquí capturar más columnas
        for (let i = 0; i < cells.length - 1; i += 2) {
            const label = cells[i].replace(/<[^>]+>/g, '').trim();
            const value = cells[i + 1].replace(/<[^>]+>/g, '').trim();
            if (label && value && !detail[label]) {
                const labelLower = label.toLowerCase();
                const isBlacklisted = detailBlacklist.some(function(bl) { return labelLower.indexOf(bl) >= 0; });
                if (!isBlacklisted) {
                    detail[label] = value;
                }
            }
        }
    }

    // Extraer datos de listas de definición <dl><dt>/<dd>
    const dtMatches = html.match(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi) || [];
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
    const labelValueDivs = html.match(/<(?:span|label|strong|b)[^>]*class="[^"]*label[^"]*"[^>]*>([\s\S]*?)<\/(?:span|label|strong|b)>\s*:?\s*<(?:span|div)[^>]*>([\s\S]*?)<\/(?:span|div)>/gi) || [];
    for (const lv of labelValueDivs) {
        const parts = lv.replace(/<[^>]+>/g, '|').split('|').map(function(s) { return s.trim(); }).filter(Boolean);
        if (parts.length >= 2 && !detail[parts[0]]) {
            detail[parts[0]] = parts.slice(1).join(' ').trim();
        }
    }

    // Intentar extraer imagen si existe
    const imgMatches = html.match(/<img[^>]*src="([^"]*?)"[^>]*>/gi) || [];
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

    // PASO 1: Obtener la página del formulario para extraer ViewState
    let viewState;
    try {
        const formPage = await getMarcanetFormPage(session, sessionKey, formUrl);
        viewState = formPage.viewState;
    } catch (e) {
        return new Response(JSON.stringify({ error: 'No se pudo acceder al formulario de Marcanet: ' + e.message }),
            { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    if (!viewState) {
        return new Response(JSON.stringify({ error: 'No se encontró ViewState en formulario Marcanet' }),
            { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    // PASO 2: Enviar búsqueda PrimeFaces AJAX
    // Simular: PrimeFaces.ab({s:"frmBsqFonetica:busquedaId2", f:"frmBsqFonetica",
    //   u:"frmBsqFonetica:pnlBsqFonetica frmBsqFonetica:dlgListaFoneticos"})
    const ajaxParams = {
        'javax.faces.source': 'frmBsqFonetica:busquedaId2',
        'javax.faces.partial.render': 'frmBsqFonetica:pnlBsqFonetica frmBsqFonetica:dlgListaFoneticos',
        'frmBsqFonetica:busquedaId2': 'frmBsqFonetica:busquedaId2',
        'frmBsqFonetica': 'frmBsqFonetica',
        'frmBsqFonetica:denominacion': denominacion,
        'javax.faces.ViewState': viewState
    };

    // Agregar clase si se seleccionó
    if (clase) {
        ajaxParams['frmBsqFonetica:idClase'] = clase;
        ajaxParams['frmBsqFonetica:clase'] = clase;
    }

    const ajaxResp = await sendPrimeFacesAjax(session, sessionKey, formUrl, ajaxParams);
    const updates = ajaxResp.updates;

    // PASO 3: Extraer resultados del HTML de la respuesta AJAX
    // Los resultados deberían estar en el update de dlgListaFoneticos o pnlBsqFonetica
    let resultsHtml = '';
    let results = [];
    const debugInfo = { updateKeys: Object.keys(updates), rawLength: ajaxResp.text.length };

    for (const [updateId, updateHtml] of Object.entries(updates)) {
        if (updateId.includes('dlgListaFoneticos') || updateId.includes('pnlBsqFonetica') || updateId.includes('tblResultados')) {
            resultsHtml += updateHtml + '\n';
        }
    }

    // Si no se encontraron en updates específicos, buscar en todo el response
    if (!resultsHtml) {
        resultsHtml = ajaxResp.text;
    }

    results = parseMarcanetResultsHTML(resultsHtml);

    // Filtrar resultados que son leyendas de formulario (como "TM = Tipo de marca")
    results = results.filter(function(r) {
        const vals = Object.values(r).filter(v => typeof v === 'string' && !v.startsWith('_'));
        // Si todos los valores contienen " = " son leyendas, no resultados
        const isLegend = vals.every(v => /^\w+ = /.test(v) || v.length < 3);
        return !isLegend;
    });

    // Debug snippet
    const rawSnippet = resultsHtml.substring(0, 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    debugInfo.rawSnippet = rawSnippet.substring(0, 800);
    debugInfo.fullResponseSnippet = ajaxResp.text.substring(0, 1500).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);

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
    // Formato observado: tipo|número|modo|número
    const infoStr = '3|' + expediente + '|1|' + expediente;
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

    // UCMServlet con tipo 4 para registro
    const infoStr = '4|' + registro + '|2';
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
    const formUrl = MARCANET_BASE + '/marcanet/vistas/common/datos/bsqTitularCompleta.pgi';

    // PASO 1: Obtener ViewState del formulario
    let viewState;
    try {
        const formPage = await getMarcanetFormPage(session, sessionKey, formUrl);
        viewState = formPage.viewState;
    } catch (e) {
        return new Response(JSON.stringify({ error: 'No se pudo acceder al formulario: ' + e.message }),
            { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    if (!viewState) {
        return new Response(JSON.stringify({ error: 'No se encontró ViewState en formulario Marcanet' }),
            { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    // PASO 2: Enviar búsqueda PrimeFaces AJAX
    // El formulario de titular probablemente usa un patrón similar al de fonética
    const ajaxParams = {
        'javax.faces.source': 'frmBsqTitular:busquedaId2',
        'javax.faces.partial.render': 'frmBsqTitular:pnlBsqTitular frmBsqTitular:dlgListaTitulares',
        'frmBsqTitular:busquedaId2': 'frmBsqTitular:busquedaId2',
        'frmBsqTitular': 'frmBsqTitular',
        'frmBsqTitular:titular': titular,
        'frmBsqTitular:nombre': titular,
        'javax.faces.ViewState': viewState
    };

    const ajaxResp = await sendPrimeFacesAjax(session, sessionKey, formUrl, ajaxParams);
    const updates = ajaxResp.updates;

    // Extraer resultados
    let resultsHtml = '';
    let results = [];
    const debugInfo = { updateKeys: Object.keys(updates), rawLength: ajaxResp.text.length };

    for (const [updateId, updateHtml] of Object.entries(updates)) {
        if (updateId.includes('dlgLista') || updateId.includes('pnlBsq') || updateId.includes('tblResultados')) {
            resultsHtml += updateHtml + '\n';
        }
    }

    if (!resultsHtml) resultsHtml = ajaxResp.text;

    results = parseMarcanetResultsHTML(resultsHtml);

    // Filtrar leyendas
    results = results.filter(function(r) {
        const vals = Object.values(r).filter(v => typeof v === 'string' && !v.startsWith('_'));
        return !vals.every(v => /^\w+ = /.test(v) || v.length < 3);
    });

    const rawSnippet = resultsHtml.substring(0, 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

        // === PRIORIDAD 1: detalleExpedienteParcial.pgi (la página más completa) ===
        // Intentar con POST y GET, probando varios nombres de parámetro
        if (expediente || registro || jsParam) {
            const numToTry = expediente || jsParam || registro;
            const detailUrls = [
                // POST con form data - múltiples variantes de parámetros
                { method: 'POST', url: MARCANET_BASE + '/marcanet/vistas/common/busquedas/detalleExpedienteParcial.pgi',
                  body: 'expediente=' + numToTry + '&p_expediente=' + numToTry + '&idExpediente=' + numToTry + '&folio=' + numToTry },
                // GET con query params
                { method: 'GET', url: MARCANET_BASE + '/marcanet/vistas/common/busquedas/detalleExpedienteParcial.pgi?expediente=' + numToTry },
                { method: 'GET', url: MARCANET_BASE + '/marcanet/vistas/common/busquedas/detalleExpedienteParcial.pgi?idExpediente=' + numToTry },
                { method: 'GET', url: MARCANET_BASE + '/marcanet/vistas/common/busquedas/detalleExpedienteParcial.pgi?folio=' + numToTry },
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

        // === PRIORIDAD 2: Link directo del resultado ===
        if (link) {
            try {
                const url = link.startsWith('http') ? link : MARCANET_BASE + (link.startsWith('/') ? '' : '/marcanet/') + link;
                const resp = await fetch(url, { headers: hdrs, redirect: 'follow' });
                updateSessionCookies(sessionKey, resp);
                const html = await resp.text();
                const detail = parseMarcanetDetailHTML(html);
                mergeDetail(detail, 'marcanet-link');
                if (Object.keys(detail).filter(k => !k.startsWith('_')).length > 0) {
                    debugSnippets['link'] = html.substring(0, 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);
                }
            } catch (e) { /* ignorar */ }
        }

        // === PRIORIDAD 3: UCMServlet con expediente ===
        if (expediente) {
            try {
                const infoStr = '3|' + expediente + '|1|' + expediente;
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
                const infoStr = '4|' + registro + '|2';
                const resp = await fetch(MARCANET_BASE + '/marcanet/UCMServlet?info=' + encodeURIComponent(btoa(infoStr)), {
                    headers: hdrs, redirect: 'follow'
                });
                updateSessionCookies(sessionKey, resp);
                const html = await resp.text();
                const detail = parseMarcanetDetailHTML(html);
                mergeDetail(detail, 'marcanet-ucm-reg');
            } catch (e) { /* ignorar */ }
        }

        // === PRIORIDAD 5: Búsqueda por expediente en formulario ===
        if (expediente && Object.keys(allDetail).filter(k => !k.startsWith('_')).length < 3) {
            try {
                const formData = new URLSearchParams();
                formData.append('expediente', expediente);
                formData.append('p_expediente', expediente);
                formData.append('buscar', 'Buscar');

                const resp = await fetch(MARCANET_BASE + '/marcanet/vistas/common/datos/bsqExpediente.pgi', {
                    method: 'POST',
                    headers: Object.assign({}, hdrs, { 'Content-Type': 'application/x-www-form-urlencoded' }),
                    body: formData.toString(),
                    redirect: 'follow'
                });

                updateSessionCookies(sessionKey, resp);
                const html = await resp.text();
                const detail = parseMarcanetDetailHTML(html);
                mergeDetail(detail, 'marcanet-bsq');
            } catch (e) { /* ignorar */ }
        }
    }

    // 2. Intentar enriquecer con MARCia (tiene datos más estructurados)
    let marciaData = null;
    const marciaSessionKey = getSessionKey(request);
    const marciaSession = sessions.get(marciaSessionKey);

    if (marciaSession && marciaSession.csrf) {
        const searchNum = expediente || registro || '';
        // Buscar por número O por denominación
        if (searchNum || denominacion) {
            try {
                const marciaHdrs = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-XSRF-TOKEN': marciaSession.csrf,
                    'Cookie': marciaSession.cookies,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': MARCIA_BASE + '/marcas/search/result',
                    'Origin': MARCIA_BASE
                };

                let searchBody;
                if (searchNum) {
                    // Búsqueda estructurada por número de expediente/registro
                    searchBody = {
                        _type: 'Search$Structured',
                        images: [],
                        query: {
                            title: '', titleOption: '',
                            name: { name: '', types: [] },
                            number: { name: searchNum, types: expediente ? ['APPLICATION'] : ['REGISTRATION'] },
                            date: { date: { from: null, to: null }, types: [] },
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
                    method: 'POST', headers: marciaHdrs, body: JSON.stringify(searchBody)
                });
                updateSessionCookies(marciaSessionKey, searchResp);
                const searchData = await searchResp.json();

                if (searchData.id) {
                    const resultResp = await fetch(MARCIA_BASE + '/marcas/search/internal/result', {
                        method: 'POST', headers: marciaHdrs,
                        body: JSON.stringify({
                            searchId: searchData.id,
                            pageSize: searchNum ? 1 : 5, pageNumber: 0,
                            statusFilter: [], viennaCodeFilter: [], niceClassFilter: []
                        })
                    });
                    updateSessionCookies(marciaSessionKey, resultResp);
                    const resultData = await resultResp.json();

                    if (resultData.resultPage && resultData.resultPage.length > 0) {
                        // Si buscamos por denominación, tratar de encontrar el match exacto
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
                            headers: marciaHdrs
                        });
                        updateSessionCookies(marciaSessionKey, viewResp);
                        marciaData = await viewResp.json();
                        sources.push('marcia');
                    }
                }
            } catch (e) { /* MARCia no disponible, continuar solo con Marcanet */ }
        }
    }

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
