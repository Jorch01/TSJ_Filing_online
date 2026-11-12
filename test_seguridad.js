/**
 * Candados de seguridad que no deben volver a abrirse.
 *
 *  - Ninguna hoja de Google publicada como CSV en el código: la de licencias
 *    dejaba a la vista de cualquiera los códigos, y con ellos los datos
 *    sincronizados (se cifran con el código).
 *  - Todo <script> de una CDN va fijado a una versión y con su huella
 *    (integrity), y el service worker guarda exactamente esa misma URL.
 *  - DOMPurify no puede ser una versión con fallas conocidas (< 3.2.4).
 *  - colorSeguro() solo deja pasar colores #RGB / #RRGGBB.
 *  - El proxy convierte una respuesta vacía del IMPI en un mensaje claro.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}

const DOCS = path.join(__dirname, 'docs');
const leer = (rel) => fs.readFileSync(path.join(DOCS, rel), 'utf8');
const archivosDe = (dir, ext) => fs.readdirSync(path.join(DOCS, dir)).filter(f => f.endsWith(ext)).map(f => path.join(dir, f));

(async () => {
    console.log('\nHojas de cálculo publicadas');
    {
        const fuentes = ['index.html', 'sw.js', ...archivosDe('js', '.js')];
        const conCSV = fuentes.filter(f => /docs\.google\.com\/spreadsheets\/d\/e\/[^'"\s]*\/pub/.test(leer(f)));
        verificar('ningún archivo de la app lee una hoja publicada en la web', conCSV.length === 0, conCSV.join(', '));
        verificar('el script viejo de licencias (con el id de la hoja) ya no se publica',
            !fs.existsSync(path.join(DOCS, 'google-apps-script.js')));
        verificar('la app ya no tiene el respaldo que verificaba licencias con el CSV',
            !/verificarConCSV|googleSheetUrl/.test(leer('js/app.js')));
    }

    console.log('\nScripts de CDN');
    {
        // Sin comentarios: un <script> comentado no se carga.
        const html = leer('index.html').replace(/<!--[\s\S]*?-->/g, '');
        const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>/g)].map(m => ({ etiqueta: m[0], url: m[1] }));
        verificar('hay al menos un script de CDN que revisar', scripts.length > 0);
        for (const s of scripts) {
            verificar(`${s.url.split('/npm/')[1] || s.url}: fijado a una versión exacta`, /@\d+\.\d+\.\d+\//.test(s.url), s.url);
            verificar(`${s.url.split('/npm/')[1] || s.url}: con integrity sha384`, /integrity="sha384-[A-Za-z0-9+/=]{64}"/.test(s.etiqueta), s.etiqueta);
            verificar(`${s.url.split('/npm/')[1] || s.url}: con crossorigin="anonymous"`, /crossorigin="anonymous"/.test(s.etiqueta), s.etiqueta);
        }
        const sw = leer('sw.js');
        const cdnSW = [...sw.matchAll(/'(https:\/\/cdn\.jsdelivr\.net\/[^']+)'/g)].map(m => m[1]);
        verificar('el service worker guarda las mismas URL que pide la página',
            cdnSW.every(u => scripts.some(s => s.url === u)), JSON.stringify(cdnSW));

        const dp = scripts.find(s => /dompurify@/.test(s.url));
        const v = dp && /dompurify@(\d+)\.(\d+)\.(\d+)/.exec(dp.url);
        const num = v ? (+v[1]) * 1e6 + (+v[2]) * 1e3 + (+v[3]) : 0;
        verificar('DOMPurify 3.2.4 o posterior (las anteriores tienen fallas públicas)', num >= 3002004, dp && dp.url);

        // Los que se cargan desde el JavaScript (EmailJS, Tesseract) siguen la
        // misma regla que los de index.html: con "@3" o "@5" la CDN sirve lo
        // último de esa serie sin que nadie lo haya revisado.
        for (const f of archivosDe('js', '.js')) {
            const fuente = leer(f);
            const cargas = [...fuente.matchAll(/(\w+)\.src = '(https:\/\/cdn\.jsdelivr\.net\/[^']+)';/g)];
            for (const [, variable, url] of cargas) {
                const corto = url.split('/npm/')[1] || url;
                verificar(`${f}: ${corto} fijado a una versión exacta`, /@\d+\.\d+\.\d+\//.test(url), url);
                const tras = fuente.slice(fuente.indexOf(url), fuente.indexOf(url) + 400);
                verificar(`${f}: ${corto} con integrity sha384`,
                    new RegExp(variable + "\\.integrity = 'sha384-[A-Za-z0-9+/=]{64}'").test(tras));
                verificar(`${f}: ${corto} con crossOrigin anonymous`,
                    new RegExp(variable + "\\.crossOrigin = 'anonymous'").test(tras));
            }
        }
    }

    console.log('\nPolítica de contenido');
    {
        const html = leer('index.html');
        const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
        verificar('index.html declara una CSP', !!csp);
        verificar("sin plugins: object-src 'none'", csp && /object-src 'none'/.test(csp[1]));
        verificar("sin <base> ajena: base-uri 'self'", csp && /base-uri 'self'/.test(csp[1]));
    }

    console.log('\nConfirmaciones del asistente de voz');
    {
        // El resumen lo escribe el modelo; lo que dicte o pegue el usuario
        // puede torcerlo. La confirmación tiene que nombrar la acción real.
        const voz = leer('js/voice-assistant.js');
        const ini = voz.indexOf('    const ETIQUETAS_CONFIRMACION');
        const fin = voz.indexOf('// ==================== EJECUTORES DE ACCIONES');
        verificar('existe la sección del texto de la confirmación', ini > 0 && fin > ini);
        const ctx = {};
        vm.createContext(ctx);
        vm.runInContext(voz.slice(ini, fin) + '\nthis.t = textoDeConfirmacion;', ctx);
        const r = ctx.t('archivar_expediente', 'Crear una nota de recordatorio', {});
        verificar('un resumen engañoso no esconde que se va a archivar', /^Archivar un expediente: /.test(r.resumen), r.resumen);
        const e = ctx.t('editar_expediente', 'Agregar comentario', { cambios: { nombre: 'Otro cliente', comentario: '' } });
        verificar('los cambios de un expediente salen de los parámetros',
            e.detalles.includes('nombre → Otro cliente') && e.detalles.includes('comentario → (vacío)'), JSON.stringify(e.detalles));
        verificar('sin resumen, queda la etiqueta de la app', ctx.t('crear_nota', '', {}).resumen === 'Crear una nota');
        const m = /const ACCIONES_MUTANTES = new Set\(\[([\s\S]*?)\]\);/.exec(voz);
        const mutantes = m ? [...m[1].matchAll(/'(\w+)'/g)].map(x => x[1]) : [];
        const sinEtiqueta = mutantes.filter(a => !['editar_evento', 'eliminar_evento'].includes(a) && !ctx.t(a, '', {}).resumen.indexOf('Ejecutar:'));
        verificar('toda acción que modifica datos tiene su etiqueta', mutantes.length > 0 && sinEtiqueta.length === 0, sinEtiqueta.join(', '));
        verificar('la confirmación usa textoDeConfirmacion', /textoDeConfirmacion\(accion, r\.resumen, p\)/.test(voz));
    }

    console.log('\nColores que vienen de los datos');
    {
        const app = leer('js/app.js');
        const ini = app.indexOf('function colorSeguro(');
        verificar('existe colorSeguro()', ini > 0);
        const fin = app.indexOf('\n}\n', ini) + 2;
        const ctx = {};
        vm.createContext(ctx);
        vm.runInContext(app.slice(ini, fin) + '\nthis.colorSeguro = colorSeguro;', ctx);
        const c = ctx.colorSeguro;
        verificar('acepta #RRGGBB', c('#1b312b') === '#1b312b');
        verificar('acepta #RGB', c('#abc') === '#abc');
        verificar('rechaza lo que rompe el atributo style', c('red;" onmouseover="alert(1)') === '#3788d8');
        verificar('rechaza url()', c('url(https://ejemplo.com/x)') === '#3788d8');
        verificar('sin color, el predeterminado', c(undefined) === '#3788d8' && c('', '#000') === '#000');
        verificar('ningún style de evento usa el color sin pasar por colorSeguro',
            !/style="[^"]*\$\{e\.color/.test(app) && !/\$\{escapeText\(e\.color/.test(app));
    }

    console.log('\nRespuestas vacías del IMPI');
    {
        const worker = fs.readFileSync(path.join(DOCS, 'proxy', 'impi-proxy-worker.js'), 'utf8');
        const seccion = worker.slice(worker.indexOf('// ==================== RESPUESTAS DEL IMPI (INICIO)'),
            worker.indexOf('// ==================== RESPUESTAS DEL IMPI (FIN)'));
        const ctx = { Response, JSON };
        vm.createContext(ctx);
        vm.runInContext(seccion + '\nthis.jsonDelIMPI = jsonDelIMPI;', ctx);
        const ok = await ctx.jsonDelIMPI(new Response('{"id":"abc"}', { status: 200 }), 'MARCia');
        verificar('un JSON bueno pasa tal cual', ok.data && ok.data.id === 'abc' && !ok.respuesta);
        const vacio = await ctx.jsonDelIMPI(new Response('', { status: 500 }), 'MARCia');
        verificar('un 500 vacío se vuelve un 502 con mensaje', vacio.respuesta && vacio.respuesta.status === 502);
        const cuerpo = vacio.respuesta ? await vacio.respuesta.json() : {};
        verificar('el mensaje dice qué servicio falló y que es temporal',
            /MARCia \(IMPI\) no está respondiendo \(error 500/.test(cuerpo.error) && /temporal/.test(cuerpo.error), cuerpo.error);
        verificar('y ya no deja pasar el texto técnico', !/Unexpected end of JSON/.test(cuerpo.error || ''));
        verificar('el área de SIGA viaja como texto', /IdArea: String\(body\.IdArea \|\| '2'\)/.test(worker));
    }

    console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
    if (fallos.length) {
        console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
        process.exit(1);
    }
})();
