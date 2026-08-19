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
