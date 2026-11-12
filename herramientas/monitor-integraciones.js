#!/usr/bin/env node
/**
 * Monitor de integraciones: prueba EN VIVO, contra producción, cada sitio del
 * que depende la app, con una consulta conocida, y dice con claridad cuál falló.
 *
 *   node herramientas/monitor-integraciones.js
 *   node herramientas/monitor-integraciones.js --json salida.json --markdown informe.md
 *   node herramientas/monitor-integraciones.js --solo marcia-busqueda,siga-areas
 *   node herramientas/monitor-integraciones.js --lista
 *
 * Salida 0: nada falló (puede haber pruebas omitidas o avisos).
 * Salida 1: al menos una prueba falló.
 *
 * Cuatro estados por prueba:
 *   ok       respondió lo esperado;
 *   falla    no respondió o respondió otra cosa: es lo que abre un issue;
 *   omitida  no se probó (falta un secreto opcional o la prueba de la que
 *            depende falló). NO es una falla y no abre issue;
 *   aviso    funciona, pero algo merece verse (p. ej. el Worker publicado no es
 *            el del repo). Tampoco abre issue por sí solo.
 *
 * Secretos (variables de entorno; todos opcionales):
 *   MONITOR_LICENCIA_CODIGO       licencia Premium. Las rutas de búsqueda del
 *                                 Worker y /api/sesiones exigen el pase de
 *                                 /cuota y sin licencia se omiten.
 *   MONITOR_LICENCIA_DISPOSITIVO  id de dispositivo con el que se pide el pase
 *                                 (por defecto "monitor-integraciones").
 *   GEMINI_API_KEY                clave de Gemini; sin ella se omite.
 *   NODE_EXTRA_CA_CERTS           SISE (dgej.cjf.gob.mx) sirve su cadena de
 *                                 certificados incompleta (Let's Encrypt YR2 sin
 *                                 el cruzado de Root YR). Desde Node hay que
 *                                 agregar herramientas/certificados/root-yr-by-x1.pem
 *                                 ANTES de arrancar Node; el workflow lo hace.
 *
 * Privacidad: el informe se publica en un issue de un repositorio público. Las
 * consultas son fijas (marcas famosas, un expediente inventado) y todo texto
 * que entra al informe pasa por limpiar(), que quita secretos, claves, pases y
 * correos. Nunca se copian respuestas completas, solo códigos y mensajes cortos.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { RUTA_WORKER, URL_WORKER, versionDelRepo, compararVersion } = require('./verificar-worker.js');

const RAIZ = path.join(__dirname, '..');
const USER_AGENT = 'TSJ-Monitor-Integraciones/1.0 (+https://github.com/Jorch01/TSJ_Filing_online)';
const DISPOSITIVO_POR_DEFECTO = 'monitor-integraciones';

// ==================== CONSULTAS CONOCIDAS ====================
// Todo lo que se consulta está aquí, a la vista. Nada identifica a un cliente.
const CONSULTAS = {
    // Primera instancia: JUZGADO PRIMERO CIVIL CANCUN (docs/js/juzgados.js).
    tsjPrimera: { int: 111, expediente: '1/2020' },
    // Segunda instancia: PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR (id 170, areaId 145).
    tsjSala: { int: 170, areaId: 145, expediente: '1/2020' },
    // Expediente inventado: lo que se prueba es que el portal responde, no que exista.
    pjf: { tipoasunto: 10, organismo: 462, expediente: '1/2000', tipoprocedimiento: 0 },
    // Mismo tribunal; el Worker revisa listas de sesión de SISE para él.
    sesiones: '462:1/2000',
    marca: 'COCA COLA',
    clase: ''
};

const UNIDADES_LABORALES = ['20', '23', '27', '29', '33', '35'];
const CAMPOS_LABORALES = ['IdUR', 'FechaInicio', 'FechaFin', 'recaptcha_token'];
const ERRORES_DE_PAGINA = /Server Error in|Runtime Error|Fatal error|Parse error|Warning: |SQLSTATE|Service Unavailable|Bad Gateway|Application Error/i;
const ERRORES_DE_CERTIFICADO = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED'];

// ==================== UTILIDADES ====================

class Falla extends Error {}
class Omitida extends Error {}

/** Quita de un texto todo lo que no debe llegar a un issue público. */
function limpiar(texto, secretos) {
    let t = String(texto == null ? '' : texto);
    for (const s of (secretos || [])) {
        if (s && String(s).length >= 4) t = t.split(String(s)).join('[secreto]');
    }
    t = t.replace(/AIza[\w-]{20,}|AQ\.[\w-]{20,}/g, '[clave]')
        .replace(/\beyJ[\w-]{10,}(\.[\w-]{10,})?/g, '[pase]')
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
        .replace(/\s+/g, ' ').trim();
    return t.length > 300 ? t.slice(0, 297) + '…' : t;
}

function leerJson(texto) {
    try { return JSON.parse(texto); } catch (e) { return null; }
}

/** Convierte lo que lanza fetch en una frase que diga qué pasó. */
function describirErrorDeRed(e, url) {
    const host = (() => { try { return new URL(url).host; } catch (x) { return url; } })();
    const codigo = (e && e.cause && e.cause.code) || (e && e.code) || '';
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return host + ' no respondió a tiempo';
    if (ERRORES_DE_CERTIFICADO.includes(codigo)) {
        return host + ': certificado no verificable (' + codigo + '). Si es SISE, falta la cadena: ' +
            'NODE_EXTRA_CA_CERTS=herramientas/certificados/root-yr-by-x1.pem';
    }
    return host + ' no se pudo alcanzar (' + (codigo || (e && e.message) || 'error de red') + ')';
}

/** GET/POST con tiempo límite; devuelve { status, headers, texto, json }. */
async function pedir(ctx, url, opciones) {
    const o = opciones || {};
    let r;
    try {
        r = await ctx.fetch(url, {
            method: o.metodo || 'GET',
            headers: Object.assign({ 'User-Agent': USER_AGENT, 'Accept': '*/*' }, o.cabeceras || {}),
            body: o.cuerpo,
            redirect: 'follow',
            signal: AbortSignal.timeout(o.timeoutMs || 40000)
        });
    } catch (e) {
        throw new Falla(describirErrorDeRed(e, url));
    }
    let texto = '';
    try { texto = await r.text(); } catch (e) { throw new Falla(describirErrorDeRed(e, url)); }
    return { status: r.status, headers: r.headers, texto, json: leerJson(texto) };
}

/** Llamada al Worker. `sesion` es el token X-IMPI-Session de MARCia. */
async function worker(ctx, ruta, o) {
    const op = o || {};
    const cabeceras = { 'Accept': 'application/json', 'X-IMPI-Client': 'monitor-integraciones' };
    if (op.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
    if (op.sesion) cabeceras['X-IMPI-Session'] = op.sesion;
    if (op.conPase && ctx.pase) cabeceras['X-TSJ-Cuota'] = ctx.pase;
    const r = await pedir(ctx, ctx.urlWorker + ruta, {
        metodo: op.metodo || (op.cuerpo !== undefined ? 'POST' : 'GET'),
        cabeceras,
        cuerpo: op.cuerpo === undefined ? undefined : JSON.stringify(op.cuerpo),
        timeoutMs: op.timeoutMs
    });
    r.sesion = r.headers.get('x-impi-session') || op.sesion || '';
    if (r.status === 402) {
        throw new Falla('El Worker exigió pase (HTTP 402) en ' + ruta + ': ' + ((r.json && r.json.error) || 'sin detalle'));
    }
    if (r.status >= 400) {
        throw new Falla('El Worker respondió HTTP ' + r.status + ' en ' + ruta + ': ' + ((r.json && r.json.error) || r.texto || 'sin cuerpo'));
    }
    if (!r.json) throw new Falla('El Worker no devolvió JSON en ' + ruta + ' (HTTP ' + r.status + ')');
    return r;
}

function paginaHtml(r, nombre, minimo) {
    if (r.status !== 200) throw new Falla(nombre + ' respondió HTTP ' + r.status);
    const tipo = (r.headers.get('content-type') || '').toLowerCase();
    if (!tipo.includes('html')) throw new Falla(nombre + ' no devolvió HTML (content-type "' + tipo + '")');
    if (r.texto.length < (minimo || 300)) throw new Falla(nombre + ' devolvió una página casi vacía (' + r.texto.length + ' bytes)');
    const e = ERRORES_DE_PAGINA.exec(r.texto);
    if (e) throw new Falla(nombre + ' devolvió una página de error ("' + e[0].trim() + '")');
    return r.texto;
}

// ==================== LAS PRUEBAS ====================
// Cada una devuelve un texto (ok), { aviso } o lanza Falla / Omitida.

/**
 * El sitio del TSJ no contesta a los servidores de GitHub (fuera de México):
 * la conexión se corta antes de llegar a la página. Desde México la app entra
 * directo, así que eso no es una caída: se marca como aviso. Una respuesta
 * que sí llega pero viene mal (error HTTP, página vacía o de error) sigue
 * siendo falla.
 */
async function desdeFueraDeMexico(prueba) {
    try {
        return await prueba();
    } catch (e) {
        if (e instanceof Falla && /no se pudo alcanzar/.test(e.message)) {
            return { aviso: e.message + '. El sitio del TSJ no responde desde los servidores de GitHub, que están fuera de México; desde México la app entra directo. Esta prueba no puede confirmarlo.' };
        }
        throw e;
    }
}

async function tsjPrimera(ctx) {
    const q = CONSULTAS.tsjPrimera;
    const url = 'https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=' + q.int +
        '&metodo=1&findexp=' + encodeURIComponent(q.expediente);
    return desdeFueraDeMexico(async () => {
        paginaHtml(await pedir(ctx, url), 'Estrados del TSJ (primera instancia)');
        return 'buscador_primera.php responde con una página HTML válida';
    });
}

async function tsjSegunda(ctx) {
    const q = CONSULTAS.tsjSala;
    const url = 'https://www.tsjqroo.gob.mx/estrados/buscador_segunda.php?findexp=' + encodeURIComponent(q.expediente) +
        '&int=' + q.int + '&areaId=' + q.areaId + '&metodo=1';
    return desdeFueraDeMexico(async () => {
        paginaHtml(await pedir(ctx, url), 'Estrados del TSJ (salas)');
        return 'buscador_segunda.php responde con una página HTML válida';
    });
}

async function estradosLaborales(ctx) {
    const url = 'https://sag-styps.qroo.gob.mx/sitio/TramitesServicios/Estrados/';
    const html = paginaHtml(await pedir(ctx, url), 'Estrados laborales', 2000);
    // El marcador de la app llena este formulario por id y por valor de la unidad.
    const faltan = CAMPOS_LABORALES.filter(id => !new RegExp('id="' + id + '"').test(html))
        .concat(UNIDADES_LABORALES.filter(v => !new RegExp('<option value="' + v + '"').test(html)).map(v => 'unidad ' + v));
    if (!/recaptcha\/enterprise\.js/.test(html)) faltan.push('reCAPTCHA Enterprise');
    if (faltan.length) {
        throw new Falla('La página de estrados laborales cambió: ya no tiene ' + faltan.join(', ') +
            ' (el marcador de la app los necesita)');
    }
    return 'formulario con las ' + UNIDADES_LABORALES.length + ' unidades y los campos que usa el marcador';
}

async function pjfConsulta(ctx) {
    const q = CONSULTAS.pjf;
    const url = 'https://www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx?tipoasunto=' + q.tipoasunto +
        '&organismo=' + q.organismo + '&expediente=' + encodeURIComponent(q.expediente) +
        '&tipoprocedimiento=' + q.tipoprocedimiento;
    paginaHtml(await pedir(ctx, url, { timeoutMs: 60000 }), 'Portal del PJF (vercaptura.aspx)');
    return 'vercaptura.aspx responde con una página HTML válida';
}

async function workerSalud(ctx) {
    const r = await pedir(ctx, ctx.urlWorker + '/health');
    if (r.status !== 200 || !r.json) throw new Falla('/health del Worker respondió HTTP ' + r.status + (r.json ? '' : ' sin JSON'));
    const h = r.json;
    if (h.status !== 'ok') throw new Falla('/health del Worker no dice status "ok"');
    const faltan = ['marcia', 'siga', 'marcanet', 'sesiones'].filter(s => !(h.services || []).includes(s));
    if (faltan.length) throw new Falla('El Worker publicado no ofrece: ' + faltan.join(', ') + ' (versión vieja)');
    if (h.cuotas !== true) {
        throw new Falla('Las cuotas del Worker están INACTIVAS: se perdió el KV CUOTAS o el secreto CUOTA_SECRETO, ' +
            'y el plan gratuito dejó de tener límite del lado del servidor');
    }
    const v = compararVersion(ctx.versionRepo, h.version);
    return v.estado === 'ok' ? { ok: v.mensaje + ', cuotas activas' } : { aviso: v.mensaje };
}

/** URL de la API de licencias que usa cada pieza (la app y el Worker deben coincidir). */
function urlLicencias(ctx) {
    const worker_ = /const LICENCIAS_API\s*=\s*'([^']+)'/.exec(ctx.codigoWorker || '');
    const app = /apiUrl:\s*'([^']+)'/.exec(ctx.codigoApp || '');
    return { worker: worker_ && worker_[1], app: app && app[1] };
}

async function licenciasApi(ctx) {
    const u = urlLicencias(ctx);
    if (!u.worker || !u.app) throw new Falla('No se encontró la URL de licencias en el código del Worker o de la app');
    if (u.worker !== u.app) throw new Falla('La API de licencias es distinta en el Worker y en la app: una de las dos quedó desactualizada');
    const url = u.app + '?action=verificar&codigo=MONITOR-SIN-LICENCIA&dispositivo_id=' + DISPOSITIVO_POR_DEFECTO;
    const r = await pedir(ctx, url, { timeoutMs: 60000 });
    if (r.status !== 200) throw new Falla('El Apps Script de licencias respondió HTTP ' + r.status);
    if (!r.json || typeof r.json !== 'object') throw new Falla('El Apps Script de licencias no devolvió JSON (¿cambió la publicación o falló el script?)');
    if (r.json.valido !== false) throw new Falla('El Apps Script aceptó un código inexistente (valido=' + r.json.valido + ')');
    return 'verificar rechaza un código inexistente: "' + limpiar(r.json.mensaje, ctx.secretos) + '"';
}

async function licenciaPremium(ctx) {
    const codigo = ctx.env.MONITOR_LICENCIA_CODIGO;
    if (!codigo) throw new Omitida('sin el secreto MONITOR_LICENCIA_CODIGO');
    const dispositivoId = ctx.env.MONITOR_LICENCIA_DISPOSITIVO || DISPOSITIVO_POR_DEFECTO;
    const r = await worker(ctx, '/cuota', {
        cuerpo: {
            tipo: 'busqueda',
            huella: { amplia: 'monitor-integraciones' },
            dispositivo: dispositivoId,
            licencia: { codigo, dispositivoId }
        }
    });
    const d = r.json;
    if (d.servidor === false) throw new Falla('El Worker tiene las cuotas inactivas (falta el KV CUOTAS o el secreto CUOTA_SECRETO)');
    if (!d.premium || !d.pase) {
        // Para decir por qué, se le pregunta a la API de licencias (su mensaje es genérico).
        let motivo = '';
        try {
            const u = urlLicencias(ctx).app;
            const v = await pedir(ctx, u + '?action=verificar&codigo=' + encodeURIComponent(codigo) +
                '&dispositivo_id=' + encodeURIComponent(dispositivoId), { timeoutMs: 60000 });
            motivo = v.json && v.json.mensaje ? ' Motivo según la API de licencias: ' + limpiar(v.json.mensaje, ctx.secretos) : '';
        } catch (e) { /* el motivo es un extra */ }
        throw new Falla('El Worker no reconoce la licencia del monitor como Premium (vencida, suspendida o sin lugar de dispositivo).' + motivo);
    }
    ctx.pase = d.pase;
    ctx.secretos.push(d.pase);
    return 'el Worker reconoce la licencia Premium y entrega el pase';
}

async function sesionMarcia(ctx) {
    const r = await worker(ctx, '/marcia/csrf');
    if (!r.json.csrf || !r.json.sessionActive) throw new Falla('/marcia/csrf no devolvió token CSRF ni sesión activa');
    if (!r.sesion) throw new Falla('/marcia/csrf no devolvió la cabecera X-IMPI-Session');
    return 'sesión CSRF de MARCia creada';
}

async function busquedaMarcia(ctx) {
    const sesion0 = await worker(ctx, '/marcia/csrf');
    const registro = await worker(ctx, '/marcia/search', {
        sesion: sesion0.sesion, conPase: true,
        cuerpo: { _type: 'Search$Quick', query: CONSULTAS.marca, images: [] }
    });
    if (!registro.json.id) throw new Falla('MARCia no devolvió el id de la búsqueda: ' + limpiar(registro.texto, ctx.secretos));
    const resultados = await worker(ctx, '/marcia/results', {
        sesion: registro.sesion,
        cuerpo: { searchId: registro.json.id, pageSize: 10, pageNumber: 0, statusFilter: [], viennaCodeFilter: [], niceClassFilter: [] }
    });
    const d = resultados.json;
    if (!Array.isArray(d.resultPage)) throw new Falla('MARCia ya no devuelve resultPage (cambió el formato de resultados)');
    if (!(d.totalResults > 0) || d.resultPage.length === 0) throw new Falla('MARCia no encontró nada para una marca famosa: ' + (d.totalResults || 0) + ' resultados');
    return d.totalResults + ' resultados para una marca conocida';
}

async function areasSiga(ctx) {
    const r = await worker(ctx, '/siga/areas');
    const d = r.json;
    if (d.successed === false) throw new Falla('SIGA respondió con error: ' + limpiar(d.message, ctx.secretos));
    if (!Array.isArray(d.data) || !d.data.some(a => a && a.idArea === 2)) throw new Falla('SIGA ya no lista el área de Marcas (idArea 2)');
    return d.data.length + ' áreas, entre ellas Marcas';
}

async function busquedaSiga(ctx) {
    const r = await worker(ctx, '/siga/search', {
        conPase: true, timeoutMs: 60000,
        cuerpo: { Busqueda: CONSULTAS.marca, IdArea: '2', IdGaceta: [], FechaDesde: '', FechaHasta: '' }
    });
    const d = r.json;
    if (d.successed === false) throw new Falla('SIGA respondió con error: ' + limpiar(d.message, ctx.secretos));
    if (!Array.isArray(d.data)) throw new Falla('SIGA ya no devuelve la lista "data" de fichas');
    if (d.data.length === 0) throw new Falla('SIGA no encontró ninguna ficha para una marca famosa');
    return d.data.length + ' fichas para una marca conocida';
}

async function sesionMarcanet(ctx) {
    const r = await worker(ctx, '/marcanet/session', { timeoutMs: 90000 });
    if (!r.json.sessionActive) throw new Falla('Marcanet no abrió sesión');
    return 'sesión de Marcanet abierta';
}

async function busquedaMarcanet(ctx) {
    const r = await worker(ctx, '/marcanet/fonetica', {
        conPase: true, timeoutMs: 120000,
        cuerpo: { denominacion: CONSULTAS.marca, clase: CONSULTAS.clase }
    });
    const d = r.json;
    if (d.isFormPage) throw new Falla('Marcanet devolvió el formulario en vez de resultados (cambió la página o la sesión)');
    if (!Array.isArray(d.results) || d.results.length === 0) throw new Falla('Marcanet no encontró nada en la búsqueda fonética de una marca famosa');
    return d.results.length + ' resultados fonéticos para una marca conocida';
}

async function sesionesSise(ctx) {
    const r = await worker(ctx, '/api/sesiones?refresh=1&exp=' + encodeURIComponent(CONSULTAS.sesiones), {
        conPase: true, timeoutMs: 180000
    });
    const d = r.json;
    if (d.completo !== true) {
        const errores = Array.isArray(d.errores) ? d.errores : [];
        const ejemplo = errores.slice(0, 2).map(e => (e.etapa || '?') + ': ' + limpiar(e.mensaje, ctx.secretos)).join(' | ');
        throw new Falla('SISE no se pudo revisar completo (completo=' + d.completo + ', ' + errores.length + ' errores)' + (ejemplo ? ': ' + ejemplo : ''));
    }
    if (Array.isArray(d.errores) && d.errores.length) {
        throw new Falla('SISE respondió completo pero con ' + d.errores.length + ' errores: ' + limpiar(d.errores[0].mensaje, ctx.secretos));
    }
    return 'listas de sesión revisadas completas y sin errores (' + d.desde + ' a ' + d.hasta + ')';
}

/** Copia del orden de _candidatosModelo (docs/js/app.js), para probar lo mismo que hará la app. */
function ordenarModelosComoLaApp(modelos) {
    const grupo = (m) => /(tts|image|embedding|live|audio|aqa|learnlm|robotics|computer-use)/i.test(m) ? 99
        : m.includes('flash-lite') ? 0 : m.includes('flash') ? 1 : m.includes('pro') ? 2 : 3;
    const prueba = (m) => (/(preview|exp)/i.test(m) ? 1 : 0);
    const version = (m) => { const v = /(\d+(?:\.\d+)*)/.exec(m); return v ? v[1].split('.').map(Number) : [0]; };
    const comparar = (a, b) => {
        const va = version(a), vb = version(b);
        for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
        return 0;
    };
    return [...new Set(modelos)].sort((a, b) => grupo(a) - grupo(b) || prueba(a) - prueba(b) || comparar(a, b) || a.localeCompare(b));
}

async function gemini(ctx) {
    const clave = ctx.env.GEMINI_API_KEY;
    if (!clave) throw new Omitida('sin el secreto GEMINI_API_KEY');
    const base = 'https://generativelanguage.googleapis.com/v1beta';
    const cabeceras = { 'Content-Type': 'application/json', 'x-goog-api-key': clave };
    const lista = await pedir(ctx, base + '/models?pageSize=200', { cabeceras });
    if (lista.status !== 200 || !lista.json) {
        throw new Falla('Gemini (lista de modelos) respondió HTTP ' + lista.status + ': ' + limpiar((lista.json && lista.json.error && lista.json.error.message) || lista.texto, ctx.secretos));
    }
    const modelos = (lista.json.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//, ''));
    if (!modelos.length) throw new Falla('Gemini no ofrece ningún modelo con generateContent');
    const porDefecto = (/const GEMINI_MODELO_POR_DEFECTO\s*=\s*'([^']+)'/.exec(ctx.codigoApp || '') || [])[1];
    // El mismo orden que usa la app para reemplazar un modelo (_candidatosModelo).
    const candidatos = ordenarModelosComoLaApp(modelos);
    const orden = (porDefecto && modelos.includes(porDefecto) ? [porDefecto] : []).concat(candidatos.filter(m => m !== porDefecto)).slice(0, 6);
    const generar = (modelo) => pedir(ctx, base + '/models/' + encodeURIComponent(modelo) + ':generateContent', {
        metodo: 'POST', cabeceras, timeoutMs: 60000,
        cuerpo: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo con la palabra: listo' }] }], generationConfig: { maxOutputTokens: 16 } })
    });
    let elegido = null, r = null;
    const descartados = [];
    for (const modelo of orden) {
        r = await generar(modelo);
        if (r.status === 404) { descartados.push(modelo); continue; }
        elegido = modelo;
        break;
    }
    if (!elegido) {
        throw new Falla('Gemini: ningún modelo respondió (' + descartados.join(', ') + '): ' + limpiar((r && r.json && r.json.error && r.json.error.message) || (r && r.texto) || '', ctx.secretos));
    }
    if (r.status !== 200 || !r.json) {
        throw new Falla('Gemini (generateContent con ' + elegido + ') respondió HTTP ' + r.status + ': ' + limpiar((r.json && r.json.error && r.json.error.message) || r.texto, ctx.secretos));
    }
    if (!Array.isArray(r.json.candidates) || !r.json.candidates.length) throw new Falla('Gemini respondió sin candidatos');
    if (porDefecto && elegido !== porDefecto) {
        return { aviso: 'El modelo por defecto de la app (' + porDefecto + ') ya no responde; la app cambia sola a otro. Funciona con ' + elegido };
    }
    return 'responde con ' + elegido + ' (' + modelos.length + ' modelos disponibles)';
}

/**
 * id, nombre, requiere ('pase' = necesita el pase de licencia-premium) y correr.
 * El orden importa: licencia-premium va antes de lo que usa su pase.
 */
const CHEQUEOS = [
    { id: 'tsj-estrados-primera', nombre: 'Estrados del TSJ: juzgados de primera instancia', correr: tsjPrimera },
    { id: 'tsj-estrados-segunda', nombre: 'Estrados del TSJ: salas de segunda instancia', correr: tsjSegunda },
    { id: 'estrados-laborales', nombre: 'Estrados laborales (Secretaría del Trabajo)', correr: estradosLaborales },
    { id: 'pjf-consulta', nombre: 'Portal del PJF: consulta de expedientes (SISE)', correr: pjfConsulta },
    { id: 'worker-salud', nombre: 'Worker de Cloudflare: /health, cuotas y versión', correr: workerSalud },
    { id: 'licencias-api', nombre: 'Apps Script de licencias', correr: licenciasApi },
    { id: 'licencia-premium', nombre: 'Pase Premium del Worker (/cuota)', correr: licenciaPremium },
    { id: 'sesiones-sise', nombre: 'Listas de sesión de SISE (vía Worker, /api/sesiones)', requiere: 'pase', correr: sesionesSise },
    { id: 'marcia-sesion', nombre: 'MARCia (IMPI): sesión', correr: sesionMarcia },
    { id: 'marcia-busqueda', nombre: 'MARCia (IMPI): búsqueda', requiere: 'pase', correr: busquedaMarcia },
    { id: 'siga-areas', nombre: 'SIGA (IMPI): áreas', correr: areasSiga },
    { id: 'siga-busqueda', nombre: 'SIGA (IMPI): búsqueda', requiere: 'pase', correr: busquedaSiga },
    { id: 'marcanet-sesion', nombre: 'Marcanet (IMPI): sesión', correr: sesionMarcanet },
    { id: 'marcanet-busqueda', nombre: 'Marcanet (IMPI): búsqueda fonética', requiere: 'pase', correr: busquedaMarcanet },
    { id: 'gemini', nombre: 'API de Gemini', correr: gemini }
];

// ==================== EJECUCIÓN ====================

/**
 * Corre las pruebas. `deps` permite inyectar todo lo de fuera para probarlo:
 * { fetch, env, esperar, ahora, urlWorker, codigoWorker, codigoApp, soloIds, reintentos, pausaMs }.
 */
async function correr(deps) {
    const d = deps || {};
    const ctx = {
        fetch: d.fetch || fetch,
        env: d.env || process.env,
        urlWorker: (d.urlWorker || URL_WORKER).replace(/\/+$/, ''),
        codigoWorker: d.codigoWorker !== undefined ? d.codigoWorker : fs.readFileSync(RUTA_WORKER, 'utf8'),
        codigoApp: d.codigoApp !== undefined ? d.codigoApp : fs.readFileSync(path.join(RAIZ, 'docs', 'js', 'app.js'), 'utf8'),
        pase: null,
        secretos: []
    };
    ctx.versionRepo = versionDelRepo(ctx.codigoWorker);
    for (const k of ['MONITOR_LICENCIA_CODIGO', 'GEMINI_API_KEY']) if (ctx.env[k]) ctx.secretos.push(ctx.env[k]);
    const esperar = d.esperar || ((ms) => new Promise(r => setTimeout(r, ms)));
    const ahora = d.ahora || (() => Date.now());
    const intentos = 1 + (d.reintentos === undefined ? 1 : d.reintentos);
    const pausaMs = d.pausaMs === undefined ? 5000 : d.pausaMs;

    const elegidos = CHEQUEOS.filter(c => !d.soloIds || d.soloIds.includes(c.id));
    const chequeos = [];
    const estadoDe = (id) => (chequeos.find(c => c.id === id) || {}).estado;

    for (const c of elegidos) {
        const t0 = ahora();
        const r = { id: c.id, nombre: c.nombre, estado: 'ok', detalle: '', ms: 0 };
        if (c.requiere === 'pase' && !ctx.pase) {
            r.estado = 'omitida';
            r.detalle = ctx.env.MONITOR_LICENCIA_CODIGO
                ? (estadoDe('licencia-premium') === 'falla' ? 'no probada: depende de licencia-premium, que falló' : 'no probada: no hay pase de Premium')
                : 'omitida: sin el secreto MONITOR_LICENCIA_CODIGO (las búsquedas del Worker exigen el pase de una licencia Premium)';
            chequeos.push(r);
            continue;
        }
        let ultimo = null;
        for (let i = 0; i < intentos; i++) {
            if (i > 0) await esperar(pausaMs);
            try {
                const salida = await c.correr(ctx);
                ultimo = null;
                if (salida && typeof salida === 'object' && salida.aviso) { r.estado = 'aviso'; r.detalle = salida.aviso; }
                else r.detalle = salida && typeof salida === 'object' ? salida.ok : salida;
                break;
            } catch (e) {
                ultimo = e;
                if (e instanceof Omitida) break;
            }
        }
        if (ultimo instanceof Omitida) { r.estado = 'omitida'; r.detalle = 'omitida: ' + ultimo.message; }
        else if (ultimo) { r.estado = 'falla'; r.detalle = ultimo instanceof Falla ? ultimo.message : 'error inesperado en el monitor: ' + ultimo.message; }
        r.detalle = limpiar(r.detalle, ctx.secretos);
        r.ms = ahora() - t0;
        chequeos.push(r);
    }

    const cuenta = (e) => chequeos.filter(c => c.estado === e).length;
    return {
        generado: new Date(ahora()).toISOString(),
        resumen: { ok: cuenta('ok'), falla: cuenta('falla'), omitida: cuenta('omitida'), aviso: cuenta('aviso') },
        chequeos
    };
}

// ==================== INFORMES ====================

const ICONO = { ok: '✅', falla: '❌', omitida: '⏭️', aviso: '⚠️' };

function textoPlano(resultado) {
    const l = resultado.chequeos.map(c => {
        const marca = { ok: '✓', falla: '✗', omitida: '–', aviso: '!' }[c.estado];
        return marca + ' ' + c.id.padEnd(22) + ' ' + c.detalle;
    });
    const r = resultado.resumen;
    l.push('', r.ok + ' bien, ' + r.falla + ' con falla, ' + r.omitida + ' omitidas, ' + r.aviso + ' avisos');
    return l.join('\n');
}

/** El informe en Markdown: cuerpo del issue y resumen del job. Sin datos de clientes ni secretos. */
function informeMarkdown(resultado, opciones) {
    const o = opciones || {};
    const r = resultado.resumen;
    const fila = (c) => '| ' + ICONO[c.estado] + ' | `' + c.id + '` | ' + c.nombre + ' | ' + String(c.detalle).replace(/\|/g, '\\|') + ' |';
    const orden = { falla: 0, aviso: 1, omitida: 2, ok: 3 };
    const lineas = [];
    lineas.push('Monitor de integraciones · ' + resultado.generado);
    if (o.urlEjecucion) lineas.push('', '[Ver la ejecución](' + o.urlEjecucion + ')');
    lineas.push('', '**' + r.ok + '** bien · **' + r.falla + '** con falla · **' + r.omitida + '** omitidas · **' + r.aviso + '** avisos', '');
    lineas.push('| | Prueba | Integración | Detalle |', '|---|---|---|---|');
    resultado.chequeos.slice().sort((a, b) => orden[a.estado] - orden[b.estado]).forEach(c => lineas.push(fila(c)));
    if (r.omitida) {
        lineas.push('', '_Las pruebas omitidas no son una falla: falta un secreto opcional o dependen de una prueba que falló._');
    }
    return lineas.join('\n') + '\n';
}

// ==================== LÍNEA DE COMANDOS ====================

async function main(argv) {
    const valor = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
    if (argv.includes('--lista')) {
        CHEQUEOS.forEach(c => console.log(c.id.padEnd(22) + c.nombre));
        return 0;
    }
    const solo = valor('--solo');
    const resultado = await correr({ soloIds: solo ? solo.split(',').map(s => s.trim()) : null });
    console.log(textoPlano(resultado));

    const urlEjecucion = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID : '';
    const md = informeMarkdown(resultado, { urlEjecucion });
    if (valor('--json')) fs.writeFileSync(valor('--json'), JSON.stringify(resultado, null, 2));
    if (valor('--markdown')) fs.writeFileSync(valor('--markdown'), md);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Monitor de integraciones\n\n' + md);
    return resultado.resumen.falla > 0 ? 1 : 0;
}

module.exports = { CHEQUEOS, CONSULTAS, USER_AGENT, limpiar, correr, textoPlano, informeMarkdown, describirErrorDeRed };

if (require.main === module) {
    main(process.argv.slice(2)).then(c => process.exit(c), e => { console.error('Error del monitor:', e.message); process.exit(2); });
}
