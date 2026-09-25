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
    // En CI omitirlas sería un verde falso: el candado daría por buenas 135
    // comprobaciones que no llegaron a ejecutarse.
    if (process.env.CI) {
        console.error('✗ Playwright no está instalado y estamos en CI. Instálalo antes de correr esto.');
        process.exit(1);
    }
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

/**
 * Abre Chromium venga de donde venga. En CI lo instala Playwright y su ruta
 * por omisión funciona; en un contenedor con los navegadores preinstalados la
 * versión suele no coincidir con la del paquete npm y hay que buscarla. Antes
 * había una ruta fija, que servía en un sitio y fallaba en el otro.
 */
async function abrirChromium() {
    if (process.env.CHROMIUM_PATH) {
        return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    }
    try {
        return await chromium.launch();
    } catch (e) {
        const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
        if (!base || !fs.existsSync(base)) throw e;

        // Cualquier chromium instalado sirve para estas pruebas.
        for (const dir of fs.readdirSync(base)) {
            if (!/^chromium/.test(dir)) continue;
            for (const rel of ['chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
                const ruta = path.join(base, dir, rel);
                if (fs.existsSync(ruta)) return chromium.launch({ executablePath: ruta });
            }
        }
        throw e;
    }
}

/**
 * El calendario y el asistente con el navegador en Cancún (UTC-5).
 *
 * Con el reloj en UTC —el de las máquinas de CI— los fallos de fechas no se
 * ven: el formulario de edición usaba la hora de Greenwich, y abrir una
 * audiencia de las 10:00 y guardarla sin tocar nada la movía a las 15:00.
 */
async function probarCalendarioEnCancun(navegador) {
    const contexto = await navegador.newContext({
        timezoneId: 'America/Cancun', locale: 'es-MX', viewport: { width: 1400, height: 900 }
    });
    const page = await contexto.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));

    try {
        await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof crearEventoCore === 'function' && typeof db !== 'undefined' && !!db,
            { timeout: 15000 });
        await page.waitForTimeout(800);

        // ---- El formulario de edición, en hora local ----
        const form = await page.evaluate(async () => {
            const r = {};
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            const diez = new Date(2026, 9, 1, 10).toISOString();
            const veinte = new Date(2026, 9, 1, 20).toISOString();
            const id10 = await crearEventoCore({ titulo: 'A las diez', tipo: 'audiencia', fechaInicio: diez });
            const id20 = await crearEventoCore({ titulo: 'A las ocho de la noche', tipo: 'audiencia', fechaInicio: veinte });
            navegarA('calendario');

            for (const [id, clave, original] of [[id10, 'diez', diez], [id20, 'veinte', veinte]]) {
                await editarEvento(id);
                r[clave + 'Formulario'] = document.getElementById('evento-fecha').value;
                document.getElementById('evento-form').requestSubmit();   // sin tocar nada
                await pausa(400);
                r[clave + 'Intacto'] = (await obtenerEventos()).find(e => e.id === id).fechaInicio === original;
            }

            seleccionarDia(new Date(2026, 9, 5).getTime());
            await mostrarFormularioEvento();
            r.nuevo = document.getElementById('evento-fecha').value;
            r.diaSeleccionadoIntacto = diaSeleccionado.getHours() === 0;
            cerrarModal();

            await editarEvento(id10);
            document.getElementById('evento-fecha').value = '2026-10-08T11:15';
            document.getElementById('evento-form').requestSubmit();
            await pausa(400);
            r.cambiado = (await obtenerEventos()).find(e => e.id === id10).fechaInicio === new Date(2026, 9, 8, 11, 15).toISOString();
            return r;
        });
        igual('cancún: una audiencia de las 10:00 se abre a las 10:00', form.diezFormulario, '2026-10-01T10:00');
        igual('cancún: guardarla sin tocar nada no la mueve', form.diezIntacto, true);
        igual('cancún: una de las 20:00 se abre en su día, no en el siguiente', form.veinteFormulario, '2026-10-01T20:00');
        igual('cancún: y guardarla tampoco la cambia de día', form.veinteIntacto, true);
        igual('cancún: un evento nuevo propone las 9:00', form.nuevo, '2026-10-05T09:00');
        igual('cancún: abrir el formulario no altera el día seleccionado', form.diaSeleccionadoIntacto, true);
        igual('cancún: cambiar la fecha en el formulario la guarda tal cual', form.cambiado, true);

        // ---- Cambiar la fecha y sincronizar ya no la regresa ----
        const sync = await page.evaluate(async () => {
            const nueva = new Date(2026, 9, 19, 9).toISOString();
            const id = await crearEventoCore({ titulo: 'Audiencia sync', tipo: 'audiencia',
                fechaInicio: new Date(2026, 9, 12, 9).toISOString() });
            // La nube tiene la versión de antes del cambio.
            const nube = JSON.parse(JSON.stringify(await obtenerTodosLosDatos()));
            nube.metadata = { ultimaModificacion: Date.now(), dispositivo: 'otro', version: '2.0' };

            await actualizarEventoCore(id, { fechaInicio: nueva });

            const local = await obtenerTodosLosDatos();
            local.metadata = { ultimaModificacion: Date.now(), dispositivo: 'este', version: '2.0' };
            const fusion = fusionarDatos(local, nube);
            await aplicarDatosLocalmente(fusion);
            const aqui = (await obtenerEventos()).filter(e => e.titulo === 'Audiencia sync');

            // Una nube que ya arrastra el duplicado que dejaba el fallo: la
            // versión vieja y la nueva, con el mismo id.
            const sucia = JSON.parse(JSON.stringify(nube));
            sucia.eventos = sucia.eventos.concat(fusion.eventos.filter(e => e.titulo === 'Audiencia sync'));
            const otraVez = await obtenerTodosLosDatos();
            otraVez.metadata = local.metadata;
            const limpia = fusionarDatos(otraVez, sucia);
            await aplicarDatosLocalmente(limpia);
            const despues = (await obtenerEventos()).filter(e => e.titulo === 'Audiencia sync');
            return {
                aqui: aqui.length,
                fechaNueva: !!aqui[0] && aqui[0].fechaInicio === nueva,
                subeALaNube: fusion.eventos.filter(e => e.titulo === 'Audiencia sync').length,
                duplicadoLimpio: limpia.eventos.filter(e => e.titulo === 'Audiencia sync').length,
                sigueNueva: despues.length === 1 && despues[0].fechaInicio === nueva
            };
        });
        igual('sync: tras sincronizar sigue habiendo un solo evento', sync.aqui, 1);
        igual('sync: con la fecha nueva (antes volvía la vieja)', sync.fechaNueva, true);
        igual('sync: y a la nube sube uno solo', sync.subeALaNube, 1);
        igual('sync: el duplicado que ya estuviera en la nube se limpia', sync.duplicadoLimpio, 1);
        igual('sync: y la fecha sigue siendo la nueva', sync.sigueNueva, true);

        // ---- Google Calendar y meses ----
        const varios = await page.evaluate(async () => {
            const id = await crearEventoCore({ titulo: 'Para Google', tipo: 'otro',
                fechaInicio: new Date(2026, 9, 1, 20).toISOString(), todoElDia: true });
            const ev = await obtenerEvento(id);

            navegarA('calendario');
            fechaCalendario = new Date(2026, 9, 31);
            mesSiguiente();
            await new Promise(res => setTimeout(res, 250));
            const siguiente = document.getElementById('mes-actual').textContent;
            fechaCalendario = new Date(2026, 9, 31);
            mesAnterior();
            await new Promise(res => setTimeout(res, 250));
            const anterior = document.getElementById('mes-actual').textContent;

            return {
                obtenerEvento: !!ev && ev.id === id,
                urlGoogle: decodeURIComponent(GCAL.urlAgregarGCal(ev)),
                siguiente, anterior
            };
        });
        igual('google: obtenerEvento existe y devuelve el evento (sin él no se guardaba el id de Google)',
            varios.obtenerEvento, true);
        verificar('google: todo el día en su día local, hasta el siguiente',
            varios.urlGoogle.includes('dates=20261001/20261002'), varios.urlGoogle);
        igual('meses: desde el 31 de octubre, "siguiente" es noviembre', varios.siguiente, 'Noviembre 2026');
        igual('meses: y "anterior" es septiembre', varios.anterior, 'Septiembre 2026');

        // ---- El evento de un pendiente ----
        const pend = await page.evaluate(async () => {
            const nueva = new Date(2026, 9, 9).toISOString();
            const idP = await crearPendienteCore({ titulo: 'Contestar demanda (UI)',
                fechaLimite: new Date(2026, 9, 5).toISOString(), todoElDia: true });
            const p = await obtenerPendiente(idP);
            await actualizarEventoCore(p.eventoId, { fechaInicio: nueva });
            await actualizarPendienteCore(idP, { prioridad: 'alta' });
            return {
                pendiente: (await obtenerPendiente(idP)).fechaLimite === nueva,
                evento: (await obtenerEvento(p.eventoId)).fechaInicio === nueva
            };
        });
        igual('pendiente: moverlo en el calendario lo mueve también en pendientes', pend.pendiente, true);
        igual('pendiente: y subirle la prioridad ya no lo regresa a la fecha vieja', pend.evento, true);

        // ---- El asistente de punta a punta, con el modelo simulado ----
        const voz = await page.evaluate(async () => {
            const r = {};
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            const esperar = async (condicion, ms = 5000) => {
                const hasta = Date.now() + ms;
                while (Date.now() < hasta) { if (condicion()) return true; await pausa(50); }
                return false;
            };
            const confirmacion = () => document.getElementById('voz-confirmacion');
            const confirmacionVisible = () => confirmacion() && confirmacion().style.display !== 'none';

            try { localStorage.setItem('voz_auto_escucha', '0'); } catch (e) { /* sin almacenamiento */ }
            await guardarConfig('ia_api_key', 'CLAVE-DE-PRUEBA');
            let respuesta = null;
            window.llamarIA = async () => JSON.stringify(respuesta);
            const abiertas = [];
            const openOriginal = window.open;
            window.open = (url, nombre) => { abiertas.push({ url, nombre }); return { focus() {} }; };

            const decir = async (texto, delModelo) => {
                respuesta = delModelo;
                const mensajes = document.querySelectorAll('#voz-chat .voz-msg').length;
                document.getElementById('voz-input').value = texto;
                document.getElementById('voz-enviar').click();
                // Hasta que conteste: con una confirmación o con un mensaje.
                await esperar(() => confirmacionVisible() || document.querySelectorAll('#voz-chat .voz-msg').length > mensajes + 1);
            };

            try {
                await VOZ.abrir();
                const tts = document.getElementById('voz-tts-toggle');
                if (tts && tts.textContent === '🔊') tts.click();

                // 1) La queja y el amparo directo: se confirma viendo la lista exacta.
                await decir('busca la queja y el amparo directo 486/2026 en el primer colegiado del 27', {
                    accion: 'buscar_pjf', faltan_datos: false, resumen: 'Buscar',
                    parametros: { numero: '486/2026', organismo: 'primer tribunal colegiado del 27 circuito',
                                  tiposAsunto: ['queja', 'amparo directo'] }
                });
                r.confirmaBusqueda = confirmacionVisible();
                r.listaBusqueda = [...document.querySelectorAll('#voz-confirmacion-texto li')].map(li => li.textContent);
                r.abiertasAntesDeConfirmar = abiertas.length;
                document.getElementById('voz-btn-confirmar').click();
                await esperar(() => abiertas.length >= 2, 3000);
                r.abiertas = abiertas.map(a => a.url);

                // 2) TSJ y PJF en la misma orden.
                abiertas.length = 0;
                await decir('busca el 123/2025 en el primero civil de Cancún y el amparo indirecto 45/2026 en el primero de distrito de Quintana Roo', {
                    accion: 'buscar_varios', faltan_datos: false, resumen: 'Buscar',
                    parametros: { busquedas: [
                        { accion: 'buscar_tsj', parametros: { valor: '123/2025', tipoBusqueda: 'numero', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' } },
                        { accion: 'buscar_pjf', parametros: { numero: '45/2026', organismo: 'juzgado primero de distrito en quintana roo', tiposAsunto: ['amparo indirecto'] } }
                    ] }
                });
                r.confirmaMixta = confirmacionVisible();
                document.getElementById('voz-btn-confirmar').click();
                await esperar(() => abiertas.length >= 2, 3000);
                r.mixtas = abiertas.map(a => a.url);

                // 3) Cambiar un evento: la confirmación dice el antes y el después.
                const id = await crearEventoCore({ titulo: 'Audiencia por voz', tipo: 'audiencia',
                    fechaInicio: new Date(2026, 9, 1, 10).toISOString(), descripcion: 'Sala 3' });
                await decir('cambia la audiencia por voz al viernes a las 12', {
                    accion: 'editar_evento', faltan_datos: false, resumen: 'Cambiar',
                    parametros: { ediciones: [{ eventoId: null, buscar: { texto: 'audiencia por voz' },
                        cambios: { fecha: '2026-10-02', hora: '12:00', descripcion: '' } }] }
                });
                r.textoConfirmacionEvento = document.getElementById('voz-confirmacion-texto').textContent;
                document.getElementById('voz-btn-confirmar').click();
                await pausa(600);
                const editado = await obtenerEvento(id);
                r.eventoMovido = editado.fechaInicio === new Date(2026, 9, 2, 12).toISOString();
                r.descripcionIntacta = editado.descripcion === 'Sala 3';

                // 4) Dos juntas el mismo día: se ofrecen para elegir.
                await crearEventoCore({ titulo: 'Junta A', tipo: 'otro', fechaInicio: new Date(2026, 9, 20, 9).toISOString() });
                const idB = await crearEventoCore({ titulo: 'Junta B', tipo: 'otro', fechaInicio: new Date(2026, 9, 20, 17).toISOString() });
                await decir('mueve la junta del 20 al 21', {
                    accion: 'editar_evento', faltan_datos: false, resumen: 'Mover',
                    parametros: { ediciones: [{ eventoId: null, buscar: { texto: 'junta', fecha: '2026-10-20' },
                        cambios: { fecha: '2026-10-21' } }] }
                });
                const filas = [...document.querySelectorAll('#voz-chat .voz-resultado')].filter(f => /Junta [AB]/.test(f.textContent));
                r.opciones = filas.length;
                const filaB = filas.find(f => /Junta B/.test(f.textContent));
                if (filaB) filaB.querySelector('button').click();
                await esperar(confirmacionVisible, 3000);
                r.confirmaLaElegida = /Junta B/.test(document.getElementById('voz-confirmacion-texto').textContent);
                document.getElementById('voz-btn-confirmar').click();
                await pausa(600);
                r.juntaB = (await obtenerEvento(idB)).fechaInicio === new Date(2026, 9, 21, 17).toISOString();
            } finally {
                window.open = openOriginal;
            }
            return r;
        });
        igual('voz: dos tipos de asunto piden confirmación', voz.confirmaBusqueda, true);
        igual('voz: enseñando las dos consultas', voz.listaBusqueda.length, 2);
        verificar('voz: con sus nombres', voz.listaBusqueda.some(t => /Queja 486\/2026/.test(t)) &&
            voz.listaBusqueda.some(t => /Amparo Directo 486\/2026/.test(t)), JSON.stringify(voz.listaBusqueda));
        igual('voz: nada se abre antes de confirmar', voz.abiertasAntesDeConfirmar, 0);
        igual('voz: al confirmar se abren las dos', voz.abiertas.length, 2);
        igual('voz: TSJ y PJF en una orden también se confirman', voz.confirmaMixta, true);
        verificar('voz: y se abren las dos, cada una en su portal',
            voz.mixtas.length === 2 && voz.mixtas.some(u => /tsjqroo/.test(u)) && voz.mixtas.some(u => /dgej\.cjf/.test(u)),
            JSON.stringify(voz.mixtas));
        verificar('voz: la confirmación del evento enseña el antes y el después en hora local',
            /1 de octubre( de 2026)?, 10:00 → viernes, 2 de octubre( de 2026)?, 12:00/.test(voz.textoConfirmacionEvento), voz.textoConfirmacionEvento);
        igual('voz: el evento queda donde se pidió', voz.eventoMovido, true);
        igual('voz: sin perder su descripción', voz.descripcionIntacta, true);
        igual('voz: con dos juntas ese día, ofrece las dos', voz.opciones, 2);
        igual('voz: al elegir una, confirma esa', voz.confirmaLaElegida, true);
        igual('voz: y mueve la elegida', voz.juntaB, true);

        igual('cancún: la página no lanza errores de JavaScript', errores, []);
    } finally {
        await contexto.close();
    }
}

async function main() {
    const servidor = await servidorEstatico(PUERTO);
    const navegador = await abrirChromium();
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

        // ---- La carpeta del expediente se exige desde el pendiente ----
        // El campo de carpeta se pinta al vuelo según el expediente elegido:
        // con el DOM simulado de las pruebas de Node eso no se ve, y un
        // selector que no llegue a existir pasaría por "no hace falta carpeta".
        const expSinCarpeta = await page.evaluate(async () =>
            (await obtenerExpedientes()).find(e => e.numero === '9/2025').id);

        await page.evaluate(() => navegarA('pendientes'));
        await page.waitForTimeout(600);
        igual('carpeta: el pendiente de un expediente sin carpeta lo avisa',
            await page.locator('.pendiente-carpeta.sin-carpeta').count() > 0, true);

        await page.evaluate((id) => mostrarFormularioPendiente(null, id), expSinCarpeta);
        await page.waitForTimeout(500);

        igual('carpeta: el campo aparece al haber expediente',
            await page.locator('#pendiente-carpeta-group').isVisible(), true);
        igual('carpeta: se marca obligatoria',
            (await page.locator('#pendiente-carpeta-obligatoria').textContent()).trim(), '*');

        await page.fill('#pendiente-titulo', 'Presentar promoción');
        await page.click('#modal-footer .btn-primary');
        await page.waitForTimeout(700);

        igual('carpeta: sin elegirla no se guarda el pendiente',
            await page.evaluate(async () => (await obtenerPendientes()).length), 1);
        igual('carpeta: el formulario sigue abierto para arreglarlo',
            await page.locator('#pendiente-carpeta-group').isVisible(), true);

        await page.selectOption('#pendiente-carpeta', '__nueva__');
        await page.waitForTimeout(300);
        igual('carpeta: "crear nueva" abre su campo',
            await page.locator('#pendiente-carpeta-nueva').isVisible(), true);
        await page.fill('#pendiente-carpeta-nueva', 'Caso desde el pendiente');
        await page.click('#modal-footer .btn-primary');
        await page.waitForTimeout(1200);

        const trasCarpeta = await page.evaluate(async (id) => ({
            pendientes: (await obtenerPendientes()).length,
            carpetas: (await obtenerCarpetas()).map(c => c.nombre),
            carpetaDelExpediente: (await obtenerExpediente(id)).carpetaId
        }), expSinCarpeta);

        igual('carpeta: con ella puesta, el pendiente se guarda', trasCarpeta.pendientes, 2);
        verificar('carpeta: la carpeta nueva se crea',
            trasCarpeta.carpetas.includes('Caso desde el pendiente'), JSON.stringify(trasCarpeta.carpetas));
        verificar('carpeta: el expediente queda etiquetado',
            trasCarpeta.carpetaDelExpediente != null, JSON.stringify(trasCarpeta));

        await page.waitForTimeout(400);
        igual('carpeta: ya no queda ningún aviso de "sin carpeta"',
            await page.locator('.pendiente-carpeta.sin-carpeta').count(), 0);
        igual('carpeta: la etiqueta se ve en la lista',
            await page.locator('.pendiente-carpeta:has-text("Caso desde el pendiente")').count() > 0, true);

        // Un pendiente general no tiene expediente al que ponerle carpeta, así
        // que no debe pedirla: es la mitad de la regla que se olvida.
        await page.evaluate(() => mostrarFormularioPendiente());
        await page.waitForTimeout(500);
        igual('carpeta: un pendiente general no la pide',
            await page.locator('#pendiente-carpeta-group').isVisible(), false);
        await page.fill('#pendiente-titulo', 'Llamar al cliente');
        await page.click('#modal-footer .btn-primary');
        await page.waitForTimeout(1000);
        igual('carpeta: el pendiente general se guarda sin ella',
            await page.evaluate(async () => (await obtenerPendientes()).length), 3);

        // ---- Botón flotante de mejoras y fallos ----
        // Vive fuera de las secciones para estar en todas; eso solo se puede
        // comprobar navegando de verdad, y hay otro flotante (el micrófono)
        // con el que no debe chocar.
        const seccionesFAB = ['inicio', 'expedientes', 'calendario', 'pendientes',
                              'notas', 'busqueda', 'pjf', 'config'];
        const sinBoton = [];
        for (const seccion of seccionesFAB) {
            await page.evaluate(s => navegarA(s), seccion);
            await page.waitForTimeout(200);
            if (!(await page.locator('#fab-feedback').isVisible().catch(() => false))) {
                sinBoton.push(seccion);
            }
        }
        igual('feedback: el botón se ve en todas las secciones', sinBoton, []);

        const cajaFB = await page.locator('#fab-feedback').boundingBox().catch(() => null);
        const cajaVoz = await page.locator('#voz-fab').boundingBox().catch(() => null);
        verificar('feedback: no se solapa con el micrófono del asistente',
            !seSolapan(cajaFB, cajaVoz),
            `feedback ${JSON.stringify(cajaFB)} vs voz ${JSON.stringify(cajaVoz)}`);
        verificar('feedback: queda dentro de la pantalla',
            !!cajaFB && cajaFB.y >= 0 && cajaFB.x >= 0, JSON.stringify(cajaFB));

        // Un solo formulario para las dos cosas: se abre en "mejora" y se
        // puede cambiar sin perder lo escrito.
        await page.click('#fab-feedback');
        await page.waitForTimeout(500);
        igual('feedback: abre como sugerencia de mejora',
            (await page.locator('#modal-titulo').textContent()).trim(), '💡 Sugerir una mejora');

        await page.fill('#reporte-descripcion', 'texto que no se debe perder');
        await page.click('.reporte-tipo-btn[data-tipo="problema"]');
        await page.waitForTimeout(300);
        igual('feedback: cambia a reporte de problema',
            (await page.locator('#modal-titulo').textContent()).trim(), '🐞 Reportar un problema');
        igual('feedback: cambiar de tipo no borra lo escrito',
            await page.inputValue('#reporte-descripcion'), 'texto que no se debe perder');

        const contextoFB = await page.locator('#modal-body pre').textContent();
        verificar('feedback: adjunta la sección donde estaba el usuario',
            /Sección abierta:/.test(contextoFB), contextoFB.slice(0, 120));
        verificar('feedback: adjunta si la licencia es premium o gratuita',
            /Licencia:/.test(contextoFB), contextoFB.slice(0, 120));
        verificar('feedback: adjunta cuántos registros hay',
            /Registros:/.test(contextoFB), contextoFB.slice(0, 200));

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

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
        verificar('reporte: y el texto que se escribió',
            (envio.capturado?.cuerpo.descripcion || '').includes('El botón X no responde'),
            envio.capturado?.cuerpo.descripcion);
        // El tipo va marcado dentro del texto: así se distingue una mejora de
        // un fallo en la hoja sin volver a desplegar el Apps Script.
        verificar('reporte: el texto dice de qué tipo es',
            /^\[(PROBLEMA|MEJORA)\] /.test(envio.capturado?.cuerpo.descripcion || ''),
            envio.capturado?.cuerpo.descripcion);
        igual('reporte: y el tipo viaja también en su propio campo',
            envio.capturado?.cuerpo.tipo, 'problema');
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

        // ---- Enlaces #expedientes/<id> ----
        // El aviso "no está visible en la lista actual (¿archivado o en otra
        // vista?)" salía en cada arranque: el hash se quedaba en la url y el
        // enlace roto se volvía a disparar para siempre.
        await page.evaluate(() => navegarA('expedientes'));
        await page.waitForTimeout(500);

        const enlaceRoto = await page.evaluate(async () => {
            history.replaceState(null, '', '#expedientes/999999');
            const avisos = [];
            const originalToast = window.mostrarToast;
            window.mostrarToast = (m, t) => avisos.push({ m, t });
            try { await mostrarExpediente(999999); } finally { window.mostrarToast = originalToast; }
            return { avisos, hash: location.hash };
        });

        verificar('enlace: uno a un expediente inexistente lo dice claro',
            /ya no existe/.test(enlaceRoto.avisos[0]?.m || ''), JSON.stringify(enlaceRoto.avisos));
        verificar('enlace: sin encogerse de hombros con "¿archivado o en otra vista?"',
            !/otra vista/.test(enlaceRoto.avisos[0]?.m || ''), enlaceRoto.avisos[0]?.m);
        igual('enlace: y se olvida, para no repetirse en cada arranque',
            enlaceRoto.hash, '');

        // Uno archivado: existe, así que se abre su detalle en vez de dejarlo
        // en un aviso que no lleva a ningún sitio.
        const enlaceArchivado = await page.evaluate(async () => {
            const id = await crearExpedienteCore({
                numero: '55/2026', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', institucion: 'TSJ' });
            await archivarExpedienteDB(id, true, 'concluido', 'Archivo 2026');
            await cargarExpedientes();
            await new Promise(r => setTimeout(r, 400));

            history.replaceState(null, '', '#expedientes/' + id);
            const avisos = [];
            const originalToast = window.mostrarToast;
            window.mostrarToast = (m, t) => avisos.push({ m, t });
            try { await mostrarExpediente(id); } finally { window.mostrarToast = originalToast; }

            return {
                avisos,
                hash: location.hash,
                detalleAbierto: document.getElementById('modal-overlay').classList.contains('active'),
                tituloDetalle: document.getElementById('modal-titulo').textContent
            };
        });

        verificar('enlace: uno archivado dice que está archivado',
            /archivado/.test(enlaceArchivado.avisos[0]?.m || ''), JSON.stringify(enlaceArchivado.avisos));
        igual('enlace: y abre su detalle igualmente', enlaceArchivado.detalleAbierto, true);
        igual('enlace: con el expediente correcto', enlaceArchivado.tituloDetalle, '55/2026');
        igual('enlace: el hash tampoco se queda', enlaceArchivado.hash, '');

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

        // Uno que sí está en la lista: se resalta y el enlace SÍ se conserva,
        // que para eso está —compartirlo o recargarlo.
        const enlaceBueno = await page.evaluate(async () => {
            const tarjeta = [...document.querySelectorAll('#page-expedientes .expediente-card')]
                .find(c => c.textContent.includes('77/2026'));
            const id = parseInt(tarjeta.dataset.id);
            await mostrarExpediente(id);
            return {
                hash: location.hash,
                resaltado: tarjeta.classList.contains('expediente-destacado'),
                esperado: '#expedientes/' + id
            };
        });

        igual('enlace: uno que sí está en la lista se resalta', enlaceBueno.resaltado, true);
        igual('enlace: y se conserva para poder compartirlo',
            enlaceBueno.hash, enlaceBueno.esperado);

        await page.evaluate(() => { history.replaceState(null, '', location.pathname); });

        // ---- Un pendiente con hora se agenda A SU HORA ----
        // El <input type="datetime-local"> siempre devuelve hora, y el
        // formulario no la pasaba: todo pendiente acababa en el calendario
        // como "todo el día", también el que se puso para las 11:45.
        await page.evaluate(() => navegarA('pendientes'));
        await page.waitForTimeout(400);
        await page.evaluate(() => mostrarFormularioPendiente());
        await page.waitForTimeout(400);
        await page.fill('#pendiente-titulo', 'Audiencia con hora');
        await page.fill('#pendiente-fecha', '2027-06-15T11:45');
        await page.evaluate(() => document.getElementById('pendiente-form').requestSubmit());
        await page.waitForTimeout(700);

        const conHora = await page.evaluate(async () => {
            const ev = (await obtenerEventos()).find(e => e.titulo === 'Audiencia con hora');
            const p = (await obtenerPendientes()).find(x => x.titulo === 'Audiencia con hora');
            if (!ev || !p) return null;
            const f = new Date(ev.fechaInicio);
            return {
                todoElDia: ev.todoElDia,
                hora: f.getHours(), minutos: f.getMinutes(),
                vinculado: p.eventoId === ev.id,
                deVuelta: ev.pendienteId === p.id
            };
        });

        verificar('pendiente con hora: se agenda en el calendario', !!conHora, 'no se creó el evento');
        igual('pendiente con hora: NO se agenda como día completo', conHora && conHora.todoElDia, false);
        igual('pendiente con hora: se agenda a las 11:45',
            conHora && [conHora.hora, conHora.minutos], [11, 45]);
        igual('pendiente con hora: queda vinculado a su evento', conHora && conHora.vinculado, true);
        igual('pendiente con hora: y el evento sabe de quién es', conHora && conHora.deVuelta, true);

        // Y el mismo formulario sin hora sigue agendando el día entero.
        await page.evaluate(() => mostrarFormularioPendiente());
        await page.waitForTimeout(400);
        await page.fill('#pendiente-titulo', 'Vence el plazo');
        await page.fill('#pendiente-fecha', '2027-06-16T00:00');
        await page.evaluate(() => document.getElementById('pendiente-form').requestSubmit());
        await page.waitForTimeout(700);

        const sinHora = await page.evaluate(async () =>
            (await obtenerEventos()).find(e => e.titulo === 'Vence el plazo') || null);
        igual('pendiente sin hora: se agenda como día completo',
            sinHora && sinHora.todoElDia, true);

        // ---- Ninguna fecha se queda fuera del calendario ----
        // Un pendiente puede entrar a la base sin pasar por el formulario (un
        // respaldo importado, lo que baja de otro dispositivo). El repaso del
        // arranque tiene que recogerlo.
        const rescatado = await page.evaluate(async () => {
            const id = await agregarPendiente({
                titulo: 'Llegó de un respaldo',
                fechaLimite: new Date(2027, 6, 8, 0, 0).toISOString(),
                completado: false,
                eventoId: null
            });
            const antes = (await obtenerEventos()).some(e => e.titulo === 'Llegó de un respaldo');
            const resumen = await sincronizarPendientesConCalendarioCore();
            const ev = (await obtenerEventos()).find(e => e.titulo === 'Llegó de un respaldo');
            const p = (await obtenerPendiente(id));

            // Repasar otra vez no puede duplicarlo.
            await sincronizarPendientesConCalendarioCore();
            const cuantos = (await obtenerEventos())
                .filter(e => e.titulo === 'Llegó de un respaldo').length;

            return { antes, creados: resumen.creados, agendado: !!ev, vinculado: p.eventoId === (ev || {}).id, cuantos };
        });

        igual('rescate: sin repaso no estaba en el calendario', rescatado.antes, false);
        igual('rescate: el repaso lo agenda', rescatado.creados >= 1, true);
        igual('rescate: y aparece en el calendario', rescatado.agendado, true);
        igual('rescate: con su vínculo puesto', rescatado.vinculado, true);
        igual('rescate: repasar dos veces no lo duplica', rescatado.cuantos, 1);

        // ---- Búsqueda rápida de expedientes en Inicio (SOLO MÓVIL) ----
        // En escritorio no debe aparecer: ahí el menú está a la vista y hay
        // Ctrl+K. Si se colara, ocuparía sitio en el panel sin aportar nada.
        await page.evaluate(() => navegarA('inicio'));
        await page.waitForTimeout(400);

        igual('rápida: en escritorio no se ve',
            await page.locator('#busqueda-rapida').isVisible(), false);

        // A partir de aquí, un teléfono.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(400);

        igual('rápida: en el móvil sí se ve',
            await page.locator('#busqueda-rapida-input').isVisible(), true);

        // "Visible al abrir" quiere decir sin tener que bajar: si cae por
        // debajo del primer pantallazo, no sirve de nada.
        const caja = await page.locator('#busqueda-rapida-input').boundingBox();
        verificar('rápida: está a la vista sin bajar la página',
            caja && caja.y >= 0 && caja.y < 844, JSON.stringify(caja));

        // Buscar por número, aunque se escriba solo la parte de antes del año.
        await page.fill('#busqueda-rapida-input', '77');
        await page.waitForTimeout(500);

        const porNumero = await page.evaluate(() => ({
            abierto: !document.getElementById('busqueda-rapida-resultados').hidden,
            titulos: [...document.querySelectorAll('.busqueda-rapida-item .bri-titulo')]
                .map(e => e.textContent.trim())
        }));
        igual('rápida: buscar "77" abre resultados', porNumero.abierto, true);
        verificar('rápida: y encuentra el 77/2026 sin escribir el año',
            porNumero.titulos.includes('77/2026'), JSON.stringify(porNumero.titulos));

        // Por una parte del expediente, no solo por el número.
        await page.fill('#busqueda-rapida-input', 'perez');
        await page.waitForTimeout(500);
        const porParte = await page.evaluate(() =>
            [...document.querySelectorAll('.busqueda-rapida-item .bri-titulo')].map(e => e.textContent.trim()));
        verificar('rápida: encuentra por el nombre de la parte, y sin acentos',
            porParte.includes('77/2026'), JSON.stringify(porParte));

        // Tocar un resultado abre su ficha: es a lo que se venía.
        await page.click('.busqueda-rapida-item');
        await page.waitForTimeout(700);
        const fichaAbierta = await page.evaluate(() => ({
            abierta: document.getElementById('modal-overlay').classList.contains('active'),
            titulo: document.getElementById('modal-titulo').textContent,
            panelCerrado: document.getElementById('busqueda-rapida-resultados').hidden
        }));
        igual('rápida: tocar el resultado abre la ficha del expediente', fichaAbierta.abierta, true);
        igual('rápida: y es la del expediente que se tocó', fichaAbierta.titulo, '77/2026');
        igual('rápida: el desplegable se cierra al abrirla', fichaAbierta.panelCerrado, true);

        await page.evaluate(() => cerrarModal());
        await page.waitForTimeout(300);

        // Un archivado se ofrece igual, pero marcado: decir "no existe" sobre
        // algo que sí está es peor que ofrecerlo con su etiqueta.
        await page.fill('#busqueda-rapida-input', '55/2026');
        await page.waitForTimeout(500);
        const archivado = await page.evaluate(() => {
            const item = document.querySelector('.busqueda-rapida-item');
            return item ? { texto: item.textContent, chip: !!item.querySelector('.bri-chip.archivado') } : null;
        });
        verificar('rápida: un expediente archivado también sale',
            archivado && /55\/2026/.test(archivado.texto), JSON.stringify(archivado));
        igual('rápida: y sale marcado como archivado', archivado && archivado.chip, true);

        // Lo que no existe se dice, no se deja el desplegable en blanco.
        await page.fill('#busqueda-rapida-input', 'zzzzzz');
        await page.waitForTimeout(500);
        const sinNada = await page.evaluate(() => ({
            abierto: !document.getElementById('busqueda-rapida-resultados').hidden,
            texto: (document.querySelector('.busqueda-rapida-vacio') || {}).textContent || ''
        }));
        igual('rápida: sin resultados el desplegable sigue abierto', sinNada.abierto, true);
        verificar('rápida: y lo dice con la consulta delante',
            /zzzzzz/.test(sinNada.texto), sinNada.texto);

        // La ✕ limpia y cierra.
        igual('rápida: con texto aparece la ✕',
            await page.locator('#busqueda-rapida-limpiar').isVisible(), true);
        await page.click('#busqueda-rapida-limpiar');
        await page.waitForTimeout(300);
        const limpio = await page.evaluate(() => ({
            valor: document.getElementById('busqueda-rapida-input').value,
            cerrado: document.getElementById('busqueda-rapida-resultados').hidden
        }));
        igual('rápida: la ✕ vacía el campo', limpio.valor, '');
        igual('rápida: y cierra el desplegable', limpio.cerrado, true);

        // El teclado del móvil trae "buscar": entrar abre el primer resultado.
        await page.fill('#busqueda-rapida-input', '88');
        await page.waitForTimeout(500);
        await page.press('#busqueda-rapida-input', 'Enter');
        await page.waitForTimeout(700);
        const conEnter = await page.evaluate(() => ({
            abierta: document.getElementById('modal-overlay').classList.contains('active'),
            titulo: document.getElementById('modal-titulo').textContent
        }));
        igual('rápida: entrar abre el primer resultado', conEnter.abierta, true);
        igual('rápida: y es el que se buscaba', conEnter.titulo, '88/2026');

        await page.evaluate(() => { cerrarModal(); limpiarBusquedaRapida(); });
        await page.waitForTimeout(300);

        // Con una consulta amplia no caben todos: hay que poder llegar a la
        // lista completa en vez de quedarse con los primeros ocho.
        await page.evaluate(async () => {
            for (let i = 1; i <= 10; i++) {
                await crearExpedienteCore({
                    numero: `${600 + i}/2026`, institucion: 'TSJ',
                    juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                    comentario: 'asuntoamplio'
                });
            }
            await cargarExpedientes();
        });
        await page.fill('#busqueda-rapida-input', 'asuntoamplio');
        await page.waitForTimeout(600);

        const conMuchos = await page.evaluate(() => ({
            mostrados: document.querySelectorAll('.busqueda-rapida-item').length,
            hayMas: !!document.querySelector('.busqueda-rapida-mas'),
            textoMas: (document.querySelector('.busqueda-rapida-mas') || {}).textContent || ''
        }));
        igual('rápida: no vuelca la lista entera en el desplegable', conMuchos.mostrados, 8);
        igual('rápida: y avisa de los que no caben', conMuchos.hayMas, true);
        verificar('rápida: diciendo cuántos faltan', /2 más/.test(conMuchos.textoMas), conMuchos.textoMas);

        await page.click('.busqueda-rapida-mas');
        await page.waitForTimeout(700);
        const enLaLista = await page.evaluate(() => ({
            pagina: document.querySelector('.page.active').id,
            filtro: document.getElementById('buscar-expediente').value,
            encontrados: document.querySelectorAll('#lista-expedientes .expediente-card').length
        }));
        igual('rápida: "ver los demás" lleva a Expedientes', enLaLista.pagina, 'page-expedientes');
        igual('rápida: con la búsqueda ya puesta', enLaLista.filtro, 'asuntoamplio');
        igual('rápida: y la lista filtrada, con los diez', enLaLista.encontrados, 10);

        await page.evaluate(() => {
            document.getElementById('buscar-expediente').value = '';
            filtrarExpedientes();
            navegarA('inicio');
        });
        await page.waitForTimeout(500);

        // De vuelta al escritorio: sigue sin aparecer.
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.waitForTimeout(400);
        igual('rápida: al volver al escritorio se esconde otra vez',
            await page.locator('#busqueda-rapida').isVisible(), false);

        // ---- Notas fijadas arriba ----
        const fijadas = await page.evaluate(async () => {
            const pausa = (ms) => new Promise(res => setTimeout(res, ms));
            cerrarModal();
            for (const t of ['Nota uno', 'Nota dos', 'Nota tres']) await crearNotaCore({ titulo: t, contenido: 'x' });
            navegarA('notas');
            await cargarNotas();
            const titulos = () => [...document.querySelectorAll('#lista-notas .nota-card .nota-titulo')].map(h => h.textContent)
                .filter(t => /^Nota (uno|dos|tres)$/.test(t));
            const boton = (titulo) => [...document.querySelectorAll('#lista-notas .nota-card')]
                .find(c => c.querySelector('.nota-titulo').textContent === titulo).querySelector('.nota-fijar');
            const r = { antes: titulos() };
            boton('Nota tres').click();
            await pausa(500);
            r.abrioEditor = document.getElementById('modal-overlay').classList.contains('active');
            r.despues = titulos();
            r.marcada = [...document.querySelectorAll('#lista-notas .nota-card.fijada .nota-titulo')].map(h => h.textContent);
            // Filtrar sigue respetando las fijadas.
            document.getElementById('buscar-nota').value = 'nota';
            await filtrarNotas();
            r.filtrada = titulos();
            document.getElementById('buscar-nota').value = '';
            await cargarNotas();
            boton('Nota tres').click();
            await pausa(500);
            r.desfijada = titulos();
            return r;
        });
        igual('notas: sin fijar, en su orden de siempre', fijadas.antes, ['Nota uno', 'Nota dos', 'Nota tres']);
        igual('notas: la fijada pasa hasta arriba', fijadas.despues, ['Nota tres', 'Nota uno', 'Nota dos']);
        igual('notas: y se ve marcada', fijadas.marcada, ['Nota tres']);
        igual('notas: fijar no abre el editor de la nota', fijadas.abrioEditor, false);
        igual('notas: al buscar sigue arriba', fijadas.filtrada, ['Nota tres', 'Nota uno', 'Nota dos']);
        igual('notas: desfijada vuelve a su sitio', fijadas.desfijada, ['Nota uno', 'Nota dos', 'Nota tres']);

        igual('la página no lanza errores de JavaScript', erroresPagina, []);

        // ---- El calendario y el asistente, con el reloj en Cancún ----
        await probarCalendarioEnCancun(navegador);

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
    console.log('✓ La interfaz responde: template, pendientes y carpetas se comportan en un navegador de verdad.');
}

main().catch(e => { console.error(e); process.exit(1); });
