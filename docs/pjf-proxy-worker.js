/**
 * Cloudflare Worker — Proxy CORS para la API del PJF
 *
 * Este worker reenvía peticiones a serviciosenlinea.pjf.gob.mx
 * y agrega los headers CORS necesarios para que la webapp pueda
 * consumir la API desde el navegador.
 *
 * === INSTRUCCIONES DE DESPLIEGUE ===
 *
 * 1. Ve a https://dash.cloudflare.com/ y crea una cuenta (gratis)
 * 2. Ve a Workers & Pages → Create Worker
 * 3. Pega este código completo y haz clic en "Deploy"
 * 4. Copia la URL del worker (ej: https://mi-pjf-proxy.tu-usuario.workers.dev)
 * 5. En la webapp, pega esa URL en el campo "URL del Proxy CORS" de la página PJF
 *
 * El worker reenviará las peticiones así:
 *   Tu app → https://mi-proxy.workers.dev/juicioenlinea/...
 *   Worker → https://www.serviciosenlinea.pjf.gob.mx/juicioenlinea/...
 *   Worker ← respuesta del PJF
 *   Tu app ← respuesta + headers CORS
 */

const PJF_ORIGIN = 'https://www.serviciosenlinea.pjf.gob.mx';

export default {
    async fetch(request) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders()
            });
        }

        const url = new URL(request.url);
        const targetUrl = PJF_ORIGIN + url.pathname + url.search;

        try {
            const headers = new Headers();
            headers.set('Content-Type', request.headers.get('Content-Type') || 'text/html');
            headers.set('X-Requested-With', 'XMLHttpRequest');

            const fetchOptions = {
                method: request.method,
                headers: headers
            };

            if (request.method === 'POST') {
                fetchOptions.body = await request.text();
            }

            const response = await fetch(targetUrl, fetchOptions);
            const body = await response.text();

            return new Response(body, {
                status: response.status,
                headers: {
                    'Content-Type': response.headers.get('Content-Type') || 'text/html; charset=utf-8',
                    ...corsHeaders()
                }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 502,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders()
                }
            });
        }
    }
};

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With'
    };
}
