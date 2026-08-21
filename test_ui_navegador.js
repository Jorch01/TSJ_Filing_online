#!/usr/bin/env node
/**
 * Pruebas de la interfaz en un navegador de verdad (Chromium vía Playwright).
 *
 *   node test_ui_navegador.js
 *
 * Existen porque test_template_csv.js NO puede ver esta clase de fallos: allí
 * Blob y el DOM están simulados y no hay CSS, así que un botón que no descarga
 * o un tooltip que tapa el botón pasaban las 125 pruebas sin despeinarse.
 *
 * Requiere Playwright. Si no está instalado, la prueba se salta con aviso en
 * vez de fallar, para no romper a quien solo quiera correr las de Node.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
    ({ chromium } = require('playwright'));
} catch (e) {
    console.log('⚠ Playwright no está instalado; se omiten las pruebas de navegador.');
    console.log('  Para ejecutarlas:  npm install playwright');
    process.exit(0);
}

const RAIZ = path.join(__dirname, 'docs');
const PUERTO = 8123;
const TIPOS = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain'
};

function servidorEstatico(puerto) {
    return new Promise(resolve => {
        const s = http.createServer((req, res) => {
            const rel = decodeURIComponent(req.url.split('?')[0]);
            const archivo = path.join(RAIZ, rel === '/' ? 'index.html' : rel);
            if (!archivo.startsWith(RAIZ)) { res.writeHead(403); res.end(); return; }
            fs.readFile(archivo, (err, datos) => {
                if (err) { res.writeHead(404); res.end('404'); return; }
                res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
                res.end(datos);
            });
        });
        s.listen(puerto, () => resolve(s));
    });
}

let pasadas = 0, fallidas = 0;
const fallos = [];

function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; return; }
    fallidas++;
    fallos.push(descripcion + (detalle ? `\n      ${detalle}` : ''));
}

function igual(descripcion, real, esperado) {
    verificar(descripcion, JSON.stringify(real) === JSON.stringify(esperado),
        `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}

// ¿Se solapan dos rectángulos?
function seSolapan(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.width && a.x + a.width > b.x &&
           a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Comprueba el botón "Descargar Template" de una sección: tooltip y descarga. */
async function probarBotonTemplate(page, zona, indice) {
    const contenedor = page.locator('.tooltip-container')
        .filter({ hasText: 'Descargar Template' }).nth(indice);
    const boton = contenedor.locator('button').first();
    const tooltip = contenedor.locator('.tooltip-content').first();
    const caja = await boton.boundingBox().catch(() => null);
    verificar(`${zona}: el botón se ve`, !!caja, 'el botón no tiene caja (oculto)');
    if (!caja) return;

    // ---- El tooltip no debe tapar el botón ----
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    await boton.hover();
    await page.waitForTimeout(400);

    const cajaTooltip = await tooltip.boundingBox().catch(() => null);
    const visibilidad = await tooltip.evaluate(el => getComputedStyle(el).visibility);

    igual(`${zona}: el tooltip aparece al pasar el ratón`, visibilidad, 'visible');
    verificar(`${zona}: el tooltip NO tapa el botón`, !seSolapan(caja, cajaTooltip),
        `botón ${JSON.stringify(caja)} vs tooltip ${JSON.stringify(cajaTooltip)}`);

    if (cajaTooltip) {
        const alto = await page.evaluate(() => document.documentElement.clientHeight);
        const ancho = await page.evaluate(() => document.documentElement.clientWidth);
        verificar(`${zona}: el tooltip cabe en la pantalla`,
            cajaTooltip.y >= -1 && cajaTooltip.y + cajaTooltip.height <= alto + 1 &&
            cajaTooltip.x >= -1 && cajaTooltip.x + cajaTooltip.width <= ancho + 1,
            `tooltip ${JSON.stringify(cajaTooltip)} en ventana ${ancho}x${alto}`);
    }

    // ---- El botón descarga de verdad, con un clic normal ----
    let descarga = null;
    let errorClic = null;
    const espera = page.waitForEvent('download', { timeout: 10000 })
        .then(d => { descarga = d; }).catch(() => {});
    try {
        await boton.click({ timeout: 5000 });   // sin force: como lo pulsa el usuario
    } catch (e) {
        errorClic = e.message.split('\n')[0];
    }
    await espera;

    verificar(`${zona}: el clic llega al botón`, !errorClic, errorClic);
    verificar(`${zona}: el botón descarga el archivo`, !!descarga,
        'no llegó ningún evento de descarga');

    if (descarga) {
        igual(`${zona}: el archivo se llama como toca`,
            descarga.suggestedFilename(), 'template_expedientes.csv');

        const ruta = await descarga.path();
        const contenido = ruta ? fs.readFileSync(ruta, 'utf8') : '';
        verificar(`${zona}: el archivo no llega vacío`, contenido.length > 10000,
            `${contenido.length} bytes`);
        verificar(`${zona}: lleva el BOM para Excel`, contenido.charCodeAt(0) === 0xFEFF);
        verificar(`${zona}: trae el encabezado de columnas`,
            contenido.includes('expediente,tipo,institucion,juzgado'));
        verificar(`${zona}: trae el catálogo del TSJ`,
            contenido.includes('JUZGADO PRIMERO CIVIL CANCUN'));
        verificar(`${zona}: trae el catálogo federal`,
            /# ID=\d+ \| "/.test(contenido));
    }
}

async function main() {
    const servidor = await servidorEstatico(PUERTO);
    const navegador = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    });
    const contexto = await navegador.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
    const page = await contexto.newPage();

    const erroresPagina = [];
    page.on('pageerror', e => erroresPagina.push(e.message));

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof descargarTemplateExpedientes === 'function', { timeout: 15000 });
        await page.waitForTimeout(1200);

        // ---- Sección de Expedientes (TSJ) ----
        await page.evaluate(() => navegarA('expedientes'));
        await page.waitForTimeout(600);
        await probarBotonTemplate(page, 'TSJ', 0);

        // ---- Sección federal (PJF) ----
        await page.evaluate(() => navegarA('pjf'));
        await page.waitForTimeout(600);
        // Dentro de PJF hay pestañas; abrir la de expedientes
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('[onclick]')]
                .find(el => /pjf-tab-expedientes|cambiarTabPJF\('expedientes'\)/.test(el.getAttribute('onclick') || ''));
            if (tab) tab.click();
        });
        await page.waitForTimeout(600);
        await probarBotonTemplate(page, 'PJF', 1);

        // ---- La descarga cumple lo que Safari y Firefox exigen ----
        // Chromium se traga un <a> suelto y un revoke inmediato, así que este
        // fallo no se ve mirando si descarga: hay que comprobar la mecánica.
        const mecanica = await page.evaluate(() => {
            const resultado = { enElDocumento: null, revocadoEnElActo: false, nombre: null };

            const clickOriginal = HTMLAnchorElement.prototype.click;
            const revokeOriginal = URL.revokeObjectURL;
            let urlUsada = null;

            HTMLAnchorElement.prototype.click = function () {
                if (this.download) {
                    resultado.enElDocumento = document.body.contains(this);
                    resultado.nombre = this.download;
                    urlUsada = this.href;
                }
                // No se llama al original: no queremos descargar de verdad aquí.
            };
            URL.revokeObjectURL = function (u) {
                if (u === urlUsada) resultado.revocadoEnElActo = true;
                return revokeOriginal.call(URL, u);
            };

            try {
                descargarArchivo('prueba.txt', 'hola', 'text/plain');
            } finally {
                HTMLAnchorElement.prototype.click = clickOriginal;
                URL.revokeObjectURL = revokeOriginal;
            }
            return resultado;
        });

        igual('descarga: el enlace está en el documento al pulsarlo',
            mecanica.enElDocumento, true);
        igual('descarga: la URL del blob no se revoca en el mismo turno',
            mecanica.revocadoEnElActo, false);
        igual('descarga: el enlace lleva el nombre del archivo', mecanica.nombre, 'prueba.txt');

        // ---- Ningún tooltip debe quedar sin colocar ----
        const sinColocar = await page.evaluate(() => {
            const malos = [];
            document.querySelectorAll('.tooltip-container').forEach((c, i) => {
                const t = c.querySelector('.tooltip-content');
                if (!t) return;
                const disparador = c.querySelector('.help-btn') || c.querySelector('button, a');
                if (!disparador) return;
                disparador.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
                if (!t.style.top || !t.style.left) {
                    malos.push(i + ': ' + (disparador.textContent || '').trim().slice(0, 30));
                }
            });
            return malos;
        });
        igual('todos los tooltips quedan colocados al hacer hover', sinColocar, []);

        // ---- Borrar todo debe vaciar TODOS los stores ----
        // El fallo original: se limpiaban 4 de 9, y los pendientes y las
        // búsquedas del IMPI sobrevivían a "eliminar todos los datos".
        page.on('dialog', d => d.accept());
        await page.evaluate(async () => {
            const carpetaId = await agregarCarpeta({ nombre: 'Caso de prueba', color: '#3b82f6' });
            const id = await crearExpedienteCore({
                numero: '1/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                institucion: 'TSJ', carpetaId });
            await crearPendienteCore({ titulo: 'Tarea', expedienteId: id,
                fechaLimite: new Date(2026, 2, 15).toISOString() });
            await crearNotaCore({ titulo: 'Nota', expedienteId: id });
            await guardarConfig('email_destino', 'x@y.z');
            await new Promise(r => {
                const q = db.transaction(['sigaGuardadas'], 'readwrite')
                    .objectStore('sigaGuardadas').add({ query: 'nike', tool: 'impi' });
                q.onsuccess = () => r(); q.onerror = () => r();
            });
        });

        const contarStores = () => page.evaluate(async () => {
            const leer = (store) => new Promise(r => {
                const q = db.transaction([store], 'readonly').objectStore(store).getAll();
                q.onsuccess = () => r((q.result || []).length);
                q.onerror = () => r(0);
            });
            const out = {};
            for (const s of Array.from(db.objectStoreNames)) out[s] = await leer(s);
            return out;
        });

        const antes = await contarStores();
        verificar('borrar todo: había datos que borrar',
            Object.values(antes).some(n => n > 0), JSON.stringify(antes));
        verificar('borrar todo: había pendientes antes', antes.pendientes > 0, JSON.stringify(antes));
        verificar('borrar todo: había búsquedas del IMPI antes',
            antes.sigaGuardadas > 0, JSON.stringify(antes));

        await page.evaluate(() => eliminarTodosDatos());
        await page.waitForTimeout(2000);

        const despues = await contarStores();
        igual('borrar todo: no sobrevive nada en ningún store',
            Object.entries(despues).filter(([, n]) => n > 0), []);

        // ---- Selección múltiple en Pendientes ----
        await page.evaluate(async () => {
            const id = await crearExpedienteCore({
                numero: '9/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', institucion: 'TSJ' });
            for (let i = 1; i <= 4; i++) {
                await crearPendienteCore({ titulo: 'Tarea ' + i, expedienteId: id,
                    fechaLimite: i === 1 ? new Date(2026, 2, 15).toISOString() : null });
            }
            navegarA('pendientes');
        });
        await page.waitForTimeout(800);

        igual('selección: la barra empieza oculta',
            await page.locator('#bulk-actions-pendientes').isVisible(), false);

        await page.click('#btn-toggle-seleccion-pendientes');
        await page.waitForTimeout(400);
        igual('selección: al activarla aparece la barra',
            await page.locator('#bulk-actions-pendientes').isVisible(), true);
        igual('selección: cada pendiente recibe su casilla',
            await page.locator('.pendiente-seleccion input').count(), 4);

        await page.click('#check-todos-pendientes');
        await page.waitForTimeout(300);
        igual('selección: "todos" marca los 4',
            (await page.locator('#conteo-seleccion-pendientes').textContent()).trim(), '4 seleccionados');

        await page.locator('.pendiente-seleccion input').first().uncheck();
        await page.waitForTimeout(300);
        igual('selección: al desmarcar uno quedan 3',
            (await page.locator('#conteo-seleccion-pendientes').textContent()).trim(), '3 seleccionados');
        igual('selección: la casilla de cabecera queda a medias',
            await page.locator('#check-todos-pendientes').evaluate(el => el.indeterminate), true);

        const eventosAntes = await page.evaluate(async () => (await obtenerEventos()).length);
        await page.click('button:has-text("Eliminar seleccionados")');
        await page.waitForTimeout(1500);

        igual('selección: quedan los pendientes no seleccionados',
            await page.evaluate(async () => (await obtenerPendientes()).length), 1);
        igual('selección: el modo se cierra al terminar',
            await page.locator('#bulk-actions-pendientes').isVisible(), false);
        verificar('selección: los eventos de los borrados se van con ellos',
            await page.evaluate(async () => (await obtenerEventos()).length) <= eventosAntes);

        // ---- Anuncio de edictos ----
        // El sanitizador de anuncios convierte en "#" todo lo que no empiece
        // por http, así que un enlace mal formado se pierde en silencio.
        const anuncio = await page.evaluate(() => {
            const ad = ANUNCIOS_CONFIG.find(a => a.id === 'edictos');
            if (!ad) return null;
            const contenedor = document.querySelector('#page-expedientes .ad-banner');
            if (contenedor) {
                contenedor.style.display = 'block';
                contenedor.querySelector('.ad-body').innerHTML = generarHTMLAnuncio(ad);
            }
            const a = document.querySelector('#page-expedientes .ad-detallado');
            return a ? { href: a.getAttribute('href'), target: a.getAttribute('target'),
                         rel: a.getAttribute('rel'),
                         titulo: (a.querySelector('.ad-titulo') || {}).textContent || '',
                         llamada: (a.querySelector('.ad-llamada') || {}).textContent || '' } : null;
        });

        verificar('anuncio: el de edictos está configurado y se pinta', !!anuncio);
        if (anuncio) {
            verificar('anuncio: enlaza a WhatsApp con el número correcto',
                anuncio.href.startsWith('https://wa.me/529981399930?text='), anuncio.href);
            verificar('anuncio: el enlace no lo descarta el sanitizador',
                anuncio.href !== '#', anuncio.href);
            igual('anuncio: se abre en otra pestaña', anuncio.target, '_blank');
            verificar('anuncio: sin dejar acceso a la ventana de origen',
                /noopener/.test(anuncio.rel || ''), anuncio.rel);
            verificar('anuncio: tiene titular', anuncio.titulo.includes('Edictos'), anuncio.titulo);
            verificar('anuncio: y llamada a la acción',
                anuncio.llamada.includes('WhatsApp'), anuncio.llamada);
        }

        // ---- ...y que además se vea ----
        // La comprobación de arriba pinta el anuncio a mano, así que pasaba
        // aunque en la página no saliera nunca: el reparto sorteaba entre los
        // cuatro anuncios por igual y el de pago caía una de cada cuatro veces.
        // Esto ejecuta el reparto de verdad y mira lo que queda en pantalla.
        const reparto = await page.evaluate(() => {
            mostrarAnuncios();
            const cuerpos = [...document.querySelectorAll('.ad-banner .ad-body')];
            return {
                huecos: cuerpos.length,
                conEdictos: cuerpos.filter(b => /Edictos/.test(b.textContent)).length,
                conRelleno: cuerpos.filter(b => /anunciarte aquí|Espacio/.test(b.textContent)).length
            };
        });

        verificar('anuncio: hay huecos de anuncio en la página', reparto.huecos > 0,
            JSON.stringify(reparto));
        verificar('anuncio: el reparto real lo saca en pantalla, no una vez de cada cuatro',
            reparto.conEdictos >= reparto.huecos - 1, JSON.stringify(reparto));
        verificar('anuncio: queda un hueco para la invitación a anunciarse',
            reparto.conRelleno >= 1, JSON.stringify(reparto));

        // Y no depende de la suerte: diez repartos seguidos, siempre igual.
        const constante = await page.evaluate(() => {
            const cuenta = [];
            for (let i = 0; i < 10; i++) {
                mostrarAnuncios();
                cuenta.push([...document.querySelectorAll('.ad-banner .ad-body')]
                    .filter(b => /Edictos/.test(b.textContent)).length);
            }
            return cuenta;
        });
        igual('anuncio: sale siempre, no según el sorteo',
            [...new Set(constante)].length, 1);

        // ---- El anuncio cubre también Yucatán ----
        const cobertura = await page.evaluate(() => {
            const ad = ANUNCIOS_CONFIG.find(a => a.id === 'edictos');
            return { titulo: ad.titulo, contenido: ad.contenido, enlace: ad.enlace };
        });
        verificar('anuncio: el titular nombra los dos estados',
            /Quintana Roo/.test(cobertura.titulo) && /Yucatán/.test(cobertura.titulo), cobertura.titulo);
        verificar('anuncio: el texto también lo dice', /Yucatán/.test(cobertura.contenido), cobertura.contenido);
        verificar('anuncio: y el mensaje de WhatsApp que se manda',
            /Yucat%C3%A1n/.test(cobertura.enlace), cobertura.enlace);

        // ---- Detalle de un expediente ----
        // Pulsar la tarjeta tiene que reunir en un sitio los pendientes y las
        // fechas del expediente, que antes había que ir a buscar a dos
        // pantallas distintas.
        await page.evaluate(async () => {
            const id = await crearExpedienteCore({
                numero: '77/2026', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', institucion: 'TSJ',
                actor: 'Pérez', demandado: 'García', comentario: 'Contestación presentada' });
            await crearPendienteCore({ titulo: 'Presentar pruebas', expedienteId: id,
                fechaLimite: new Date(2027, 4, 10).toISOString(), prioridad: 'alta' });
            await crearPendienteCore({ titulo: 'Ya hecho', expedienteId: id });
            await crearEventoCore({ titulo: 'Audiencia de ley', tipo: 'audiencia',
                fechaInicio: new Date(2027, 4, 20, 10, 0).toISOString(), expedienteId: id });
            // Otro expediente con sus cosas: no deben aparecer en el detalle del primero.
            const otro = await crearExpedienteCore({
                numero: '88/2026', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', institucion: 'TSJ' });
            await crearPendienteCore({ titulo: 'De otro expediente', expedienteId: otro });
            await crearEventoCore({ titulo: 'Audiencia ajena', tipo: 'audiencia',
                fechaInicio: new Date(2027, 5, 1).toISOString(), expedienteId: otro });
            navegarA('expedientes');
        });
        await page.waitForTimeout(900);

        await page.locator('.expediente-card', { hasText: '77/2026' }).first().click();
        await page.waitForTimeout(700);

        const detalle = await page.evaluate(() => {
            const cuerpo = document.getElementById('modal-body');
            return {
                abierto: document.getElementById('modal-overlay').classList.contains('active'),
                titulo: document.getElementById('modal-titulo').textContent,
                texto: cuerpo.textContent,
                pendientes: cuerpo.querySelectorAll('.detalle-bloque')[1].querySelectorAll('.detalle-item').length,
                eventos: cuerpo.querySelectorAll('.detalle-bloque')[2].querySelectorAll('.detalle-item').length
            };
        });

        igual('detalle: pulsar la tarjeta abre el detalle', detalle.abierto, true);
        igual('detalle: con el número del expediente por título', detalle.titulo, '77/2026');
        verificar('detalle: muestra actor y demandado',
            /Pérez/.test(detalle.texto) && /García/.test(detalle.texto));
        igual('detalle: lista sus dos pendientes', detalle.pendientes, 2);
        igual('detalle: y su fecha del calendario', detalle.eventos, 1);
        verificar('detalle: nombra el pendiente', /Presentar pruebas/.test(detalle.texto));
        verificar('detalle: y la audiencia', /Audiencia de ley/.test(detalle.texto));
        verificar('detalle: sin colar lo de otro expediente',
            !/De otro expediente/.test(detalle.texto) && !/Audiencia ajena/.test(detalle.texto),
            detalle.texto.slice(0, 200));

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

        // Pulsar un botón de la tarjeta hace lo del botón y NADA más: si el
        // detalle se abriera también, cada botón tendría dos efectos.
        const guardas = await page.evaluate(() => {
            const original = verDetalleExpediente;
            let llamadas = 0;
            window.verDetalleExpediente = () => { llamadas++; };

            const tarjeta = [...document.querySelectorAll('.expediente-card')]
                .find(c => c.textContent.includes('77/2026'));
            window.getSelection().removeAllRanges();

            // Se llama a la guarda directamente. Un clic real no probaría nada:
            // los botones de hoy frenan la propagación por su cuenta, así que
            // el detalle no se abriría aunque la guarda no existiese — y el día
            // que se añada un botón que no la frene, esto lo cubre.
            _clicEnTarjetaExpediente(
                { target: tarjeta.querySelector('button[title="Ver historial"]'), currentTarget: tarjeta }, 1);
            const trasBoton = llamadas;

            _clicEnTarjetaExpediente(
                { target: tarjeta.querySelector('.expediente-titulo'), currentTarget: tarjeta }, 1);
            const trasCuerpo = llamadas;

            window.verDetalleExpediente = original;
            return { trasBoton, trasCuerpo };
        });

        igual('detalle: pulsar un botón de la tarjeta no abre además el detalle',
            guardas.trasBoton, 0);
        igual('detalle: pulsar el cuerpo de la tarjeta sí lo abre',
            guardas.trasCuerpo, 1);

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

        // ---- Reporte de errores ----
        await page.evaluate(() => navegarA('config'));
        await page.waitForTimeout(500);
        await page.click('button:has-text("🐞 Reportar")');
        await page.waitForTimeout(600);

        const formulario = await page.evaluate(() => {
            const cuerpo = document.getElementById('modal-body');
            return {
                hayTextarea: !!document.getElementById('reporte-descripcion'),
                obligatorio: document.getElementById('reporte-descripcion')?.required,
                contexto: document.getElementById('form-reporte-bug')?.dataset.contexto || '',
                muestraLoQueEnvia: /datos técnicos/i.test(cuerpo.textContent)
            };
        });

        igual('reporte: el botón abre el formulario', formulario.hayTextarea, true);
        igual('reporte: la descripción es obligatoria', formulario.obligatorio, true);
        igual('reporte: se enseña lo que se va a mandar', formulario.muestraLoQueEnvia, true);
        verificar('reporte: el contexto lleva navegador y versión',
            /Navegador:/.test(formulario.contexto) && /Versión:/.test(formulario.contexto),
            formulario.contexto);
        verificar('reporte: y cuántos registros hay',
            /expedientes=\d+/.test(formulario.contexto), formulario.contexto);

        // Lo importante: el contexto NO puede llevar datos de los expedientes.
        // Son asuntos de clientes y no tienen por qué salir del navegador.
        verificar('reporte: sin números de expediente ni nombres de las partes',
            !/77\/2026/.test(formulario.contexto) && !/Pérez/.test(formulario.contexto) &&
            !/Presentar pruebas/.test(formulario.contexto) && !/CANCUN/.test(formulario.contexto),
            formulario.contexto);

        // Se envía sin llegar a Google: se intercepta y se mira qué manda.
        const envio = await page.evaluate(async () => {
            const original = window.fetch;
            let capturado = null;
            window.fetch = (url, opciones) => {
                capturado = { url, cuerpo: JSON.parse(opciones.body) };
                return Promise.resolve(new Response('{"success":true}', { status: 200 }));
            };
            document.getElementById('reporte-descripcion').value = 'El botón X no responde';
            document.getElementById('reporte-contacto').value = 'yo@ejemplo.mx';
            try {
                await enviarReporteBug(new Event('submit'));
            } finally {
                window.fetch = original;
            }
            return { capturado, cerrado: !document.getElementById('modal-overlay').classList.contains('active') };
        });

        verificar('reporte: se envía al script de Apps Script',
            /script\.google\.com/.test(envio.capturado?.url || ''), envio.capturado?.url);
        igual('reporte: con la acción correcta', envio.capturado?.cuerpo.action, 'reportar_bug');
        igual('reporte: y el texto que se escribió',
            envio.capturado?.cuerpo.descripcion, 'El botón X no responde');
        igual('reporte: con el correo de contacto', envio.capturado?.cuerpo.contacto, 'yo@ejemplo.mx');
        igual('reporte: al enviar se cierra el formulario', envio.cerrado, true);

        // Si falla el envío, el texto no se pierde.
        await page.evaluate(() => mostrarModalReporteBug());
        await page.waitForTimeout(500);
        const respaldo = await page.evaluate(async () => {
            const original = window.fetch;
            window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
            document.getElementById('reporte-descripcion').value = 'no hay red';
            try { await enviarReporteBug(new Event('submit')); } finally { window.fetch = original; }
            const campo = document.getElementById('reporte-respaldo');
            const enlace = document.querySelector('#modal-footer a[href^="mailto:"]');
            return { texto: campo ? campo.value : null, destino: enlace ? enlace.getAttribute('href') : null };
        });

        verificar('reporte: si falla el envío, el texto sigue ahí',
            /no hay red/.test(respaldo.texto || ''), respaldo.texto);
        verificar('reporte: y se ofrece mandarlo al correo de soporte',
            (respaldo.destino || '').startsWith('mailto:jorge_clemente@empirica.mx'), respaldo.destino);

        await page.evaluate(() => cerrarModal());

        // ---- Capa de IA (Gemini) ----
        // Todo con la red simulada: no se llama a Google en una prueba.
        const ia = await page.evaluate(async () => {
            const resultados = {};

            // Traducción del historial: Gemini llama "model" a lo que la API
            // de Groq llamaba "assistant".
            const contenidos = _contenidosGemini(null, { historial: [
                { role: 'user', content: 'hola' },
                { role: 'assistant', content: 'qué tal' }
            ]});
            resultados.roles = contenidos.map(c => c.role);
            resultados.textos = contenidos.map(c => c.parts[0].text);

            // Al tener que elegir solos, Flash antes que Pro.
            resultados.elegido = _elegirModelo(['gemini-9.9-pro', 'gemini-9.9-flash']);
            resultados.elegidoSinFlash = _elegirModelo(['gemini-9.9-pro']);

            // El mensaje exacto que dio el fallo que rompió el asistente.
            resultados.reconoceGroq = _esModeloInexistente(
                'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.');
            resultados.reconoceGemini = _esModeloInexistente(
                'models/gemini-2.5-flash is not found for API version v1beta');
            resultados.noConfundeOtros = _esModeloInexistente('Quota exceeded for this project');

            // JSON con los adornos que suelen venir alrededor.
            resultados.json = _extraerJSON('```json\n{"a":1}\n```');

            return resultados;
        });

        igual('ia: el historial se traduce a los roles de Gemini', ia.roles, ['user', 'model']);
        igual('ia: sin perder el texto', ia.textos, ['hola', 'qué tal']);
        igual('ia: se prefiere Flash sobre Pro', ia.elegido, 'gemini-9.9-flash');
        igual('ia: pero se coge Pro si es lo único', ia.elegidoSinFlash, 'gemini-9.9-pro');
        igual('ia: reconoce el error que rompió el asistente', ia.reconoceGroq, true);
        igual('ia: y el equivalente de Gemini', ia.reconoceGemini, true);
        igual('ia: sin confundirlo con otros errores', ia.noConfundeOtros, false);
        igual('ia: extrae el JSON de entre los adornos', ia.json, { a: 1 });

        // La petición que se manda de verdad.
        const peticion = await page.evaluate(async () => {
            await guardarConfig('ia_api_key', 'CLAVE-DE-PRUEBA');
            await guardarConfig('ia_modelo', 'gemini-de-prueba');

            const original = window.fetch;
            let capturada = null;
            window.fetch = (url, opciones) => {
                capturada = { url, cuerpo: JSON.parse(opciones.body), cabeceras: opciones.headers };
                return Promise.resolve(new Response(JSON.stringify({
                    candidates: [{ content: { parts: [{ text: 'OK' }] } }]
                }), { status: 200 }));
            };
            let texto;
            try { texto = await llamarIA('hola', { sistema: 'eres útil' }); }
            finally { window.fetch = original; }
            return { capturada, texto };
        });

        verificar('ia: llama al modelo configurado',
            /models\/gemini-de-prueba:generateContent/.test(peticion.capturada.url), peticion.capturada.url);
        igual('ia: la clave viaja en la cabecera',
            peticion.capturada.cabeceras['x-goog-api-key'], 'CLAVE-DE-PRUEBA');
        verificar('ia: y NUNCA en la url, que acaba en historiales y registros',
            !/CLAVE-DE-PRUEBA/.test(peticion.capturada.url), peticion.capturada.url);
        igual('ia: el prompt de sistema va aparte, no como un turno más',
            peticion.capturada.cuerpo.systemInstruction.parts[0].text, 'eres útil');
        igual('ia: y devuelve el texto del modelo', peticion.texto, 'OK');

        // ---- Lo que rompió el asistente no puede volver a romperlo ----
        // Si el proveedor retira el modelo guardado, la app busca uno vivo,
        // lo guarda y sigue, sin que nadie tenga que tocar el código.
        const recuperacion = await page.evaluate(async () => {
            await guardarConfig('ia_modelo', 'modelo-retirado');

            const original = window.fetch;
            const urls = [];
            window.fetch = (url, opciones) => {
                urls.push(url);
                if (/\/models\?/.test(url)) {
                    return Promise.resolve(new Response(JSON.stringify({ models: [
                        { name: 'models/gemini-nuevo-pro', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/gemini-nuevo-flash', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/solo-embeddings', supportedGenerationMethods: ['embedContent'] }
                    ]}), { status: 200 }));
                }
                if (/modelo-retirado/.test(url)) {
                    // 404 con el cuerpo vacío: así llegó el que dejó al
                    // asistente sin recuperarse. Fiarse solo del texto del
                    // mensaje no bastaba.
                    return Promise.resolve(new Response('', { status: 404 }));
                }
                return Promise.resolve(new Response(JSON.stringify({
                    candidates: [{ content: { parts: [{ text: 'respuesta buena' }] } }]
                }), { status: 200 }));
            };

            let texto, error = null;
            try { texto = await llamarIA('hola'); }
            catch (e) { error = e.message; }
            finally { window.fetch = original; }

            return { texto, error, urls, guardado: await obtenerConfig('ia_modelo') };
        });

        igual('ia: si retiran el modelo, la respuesta llega igual',
            recuperacion.texto, 'respuesta buena');
        verificar('ia: preguntando a la API qué modelos quedan',
            recuperacion.urls.some(u => /\/models\?/.test(u)), JSON.stringify(recuperacion.urls));
        igual('ia: se queda con uno que existe y descarta el de embeddings',
            recuperacion.guardado, 'gemini-nuevo-flash');
        igual('ia: sin dar error al usuario', recuperacion.error, null);

        // "Probar conexión" no debe guardar nada.
        const prueba = await page.evaluate(async () => {
            await guardarConfig('ia_api_key', 'LA-GUARDADA');
            await guardarConfig('ia_modelo', 'EL-GUARDADO');
            document.getElementById('ia-api-key').value = 'ESCRITA-EN-PANTALLA';
            const select = document.getElementById('ia-modelo');
            select.add(new Option('ESCRITO-EN-PANTALLA', 'ESCRITO-EN-PANTALLA'));
            select.value = 'ESCRITO-EN-PANTALLA';

            const original = window.fetch;
            let urlUsada = null, cabecerasUsadas = null;
            window.fetch = (url, opciones) => {
                urlUsada = url;
                cabecerasUsadas = (opciones || {}).headers || {};
                return Promise.resolve(new Response(JSON.stringify({
                    candidates: [{ content: { parts: [{ text: 'OK' }] } }]
                }), { status: 200 }));
            };
            try { await probarIA(); } finally { window.fetch = original; }

            return { urlUsada, cabecerasUsadas,
                     key: await obtenerConfig('ia_api_key'),
                     modelo: await obtenerConfig('ia_modelo') };
        });

        verificar('ia: probar usa el modelo escrito en pantalla',
            /ESCRITO-EN-PANTALLA/.test(prueba.urlUsada), prueba.urlUsada);
        igual('ia: y la clave escrita en pantalla',
            prueba.cabecerasUsadas['x-goog-api-key'], 'ESCRITA-EN-PANTALLA');
        igual('ia: probar no pisa la clave guardada', prueba.key, 'LA-GUARDADA');

        // Una clave rechazada tiene que decirse como lo que es, no como
        // "modelo no encontrado": son dos problemas con arreglos distintos.
        const claveMala = await page.evaluate(async () => {
            const original = window.fetch;
            window.fetch = () => Promise.resolve(new Response(JSON.stringify({
                error: { message: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' } }), { status: 401 }));
            let mensaje = null;
            try { await listarModelosIA('CLAVE-QUE-NO-VALE'); }
            catch (e) { mensaje = e.message; }
            finally { window.fetch = original; }
            return mensaje;
        });

        verificar('ia: una clave rechazada dice que el problema es la clave',
            /clave no fue aceptada/.test(claveMala || ''), claveMala);
        verificar('ia: y dónde se saca una buena',
            /aistudio\.google\.com/.test(claveMala || ''), claveMala);
        igual('ia: ni el modelo guardado', prueba.modelo, 'EL-GUARDADO');

        igual('la página no lanza errores de JavaScript', erroresPagina, []);

    } finally {
        await navegador.close();
        servidor.close();
    }

    console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas\n`);
    if (fallidas > 0) {
        console.log('FALLOS:');
        fallos.forEach(f => console.log('  ✗ ' + f));
        process.exit(1);
    }
    console.log('✓ El botón de template descarga y el tooltip no lo tapa, en TSJ y en PJF.');
}

main().catch(e => { console.error(e); process.exit(1); });
