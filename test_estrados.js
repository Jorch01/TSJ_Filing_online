#!/usr/bin/env node
/**
 * Pruebas del atajo a los estrados electrónicos de un expediente.
 *
 *   node test_estrados.js
 *
 * Lo que se fija aquí es a dónde lleva el botón y, sobre todo, cuándo NO debe
 * estar: un expediente federal o uno cuyo juzgado no está en el catálogo del
 * TSJ no tiene estrados que abrir, y un botón que no lleva a ninguna parte es
 * peor que no tener botón.
 *
 * Se carga el código real de docs/js/, no una copia.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, 'docs', 'js');

function extraerDeclaracion(fuente, nombre, archivo) {
    const lineas = fuente.split('\n');
    const patron = new RegExp(
        '^(?:async\\s+)?function\\s+' + nombre + '\\s*\\(' +
        '|^(?:const|let|var)\\s+' + nombre + '\\s*=');
    const inicio = lineas.findIndex(l => patron.test(l));
    if (inicio === -1) throw new Error(`No se encontró "${nombre}" en ${archivo} (¿se renombró?)`);
    if (/;\s*$/.test(lineas[inicio])) return lineas[inicio];
    for (let i = inicio + 1; i < lineas.length; i++) {
        if (/^[}\])]/.test(lineas[i])) return lineas.slice(inicio, i + 1).join('\n');
    }
    throw new Error(`Declaración incompleta de "${nombre}" en ${archivo}`);
}

function crearEntorno(expedientes) {
    const estado = { toasts: [], popups: [] };

    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        estado,
        Logger: { log: () => {}, warn: () => {}, error: () => {} },
        escapeText: (t) => String(t == null ? '' : t),
        formatearFecha: (f) => String(f || ''),
        mostrarToast: (mensaje, tipo) => { estado.toasts.push({ tipo, mensaje }); },
        obtenerExpedientes: async () => (expedientes || []).slice(),
        // El popup real se sustituye por su registro: lo que importa es a dónde
        // apunta, no que se abra una ventana.
        abrirBusquedaPopup: (url, titulo) => { estado.popups.push({ url, titulo }); },

        // Lo que necesitan los renderizadores de tarjeta y fila.
        _badgeInstitucionHTML: () => '', _badgeCarpetaHTML: () => '',
        _labelInstitucionCorto: (i) => i,
        pendientesAbiertosDeExpediente: () => 0
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    // juzgados.js entero: de ahí sale el catálogo y construirUrlBusqueda.
    vm.runInContext(fs.readFileSync(path.join(JS, 'juzgados.js'), 'utf8'), sandbox,
        { filename: 'juzgados.js' });

    const app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    for (const n of ['urlEstradosExpediente', 'abrirEstradosExpediente',
                     'renderTarjetaExpedienteHTML', 'renderFilaExpedienteHTML']) {
        vm.runInContext(extraerDeclaracion(app, n, 'app.js'), sandbox, { filename: `app.js:${n}` });
    }
    return { sandbox, estado };
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

// Un juzgado de primera instancia, una sala de segunda y los casos sin estrados.
const TSJ       = { id: 1, numero: '615/2019', institucion: 'TSJ',
                    juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' };
const PJF       = { id: 2, numero: '777/2025', institucion: 'PJF',
                    juzgado: 'JUZGADO PRIMERO DE DISTRITO EN EL ESTADO DE QUINTANA ROO' };
const DESCONOC  = { id: 3, numero: '888/2025', institucion: 'TSJ',
                    juzgado: 'JUZGADO INVENTADO QUE NO EXISTE' };
const SIN_JUZG  = { id: 4, numero: '999/2025', institucion: 'TSJ', juzgado: '' };
const POR_NOMBRE= { id: 5, nombre: 'Pérez contra IMSS', institucion: 'TSJ',
                    juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' };
// Marcado como federal pero con el nombre de un juzgado del TSJ. Pasa cuando
// se importa mal una fila o se cambia la institución después de crearlo: la
// institución manda, porque sus publicaciones no están en estrados del TSJ.
const PJF_CON_JUZGADO_TSJ = { id: 7, numero: '333/2025', institucion: 'PJF',
                              juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' };
const TODOS = [TSJ, PJF, DESCONOC, SIN_JUZG, POR_NOMBRE, PJF_CON_JUZGADO_TSJ];

function pruebaURL() {
    const { sandbox } = crearEntorno(TODOS);

    const url = sandbox.urlEstradosExpediente(TSJ);
    verificar('la URL apunta al buscador de estrados del TSJ',
        /^https:\/\/www\.tsjqroo\.gob\.mx\/estrados\/buscador_primera\.php\?/.test(url || ''), url);
    verificar('lleva el id del juzgado', /[?&]int=\d+/.test(url || ''), url);
    verificar('busca por número (metodo=1)', /[?&]metodo=1(&|$)/.test(url || ''), url);
    verificar('y el número va codificado, con su diagonal',
        (url || '').includes('findexp=615%2F2019'), url);

    // Sin número se busca por nombre, que es el otro método del buscador.
    const porNombre = sandbox.urlEstradosExpediente(POR_NOMBRE);
    verificar('un expediente sin número se busca por nombre (metodo=2)',
        /[?&]metodo=2(&|$)/.test(porNombre || ''), porNombre);

    // La misma URL que ya generaba la página de Búsqueda en bloque: el atajo no
    // inventa un formato propio.
    igual('el atajo usa exactamente la URL de la búsqueda en bloque',
        url, sandbox.construirUrlBusqueda(TSJ.juzgado, 'numero', TSJ.numero));
}

function pruebaCuandoNoHayEstrados() {
    const { sandbox } = crearEntorno(TODOS);

    igual('un expediente federal no tiene estrados del TSJ',
        sandbox.urlEstradosExpediente(PJF), null);
    igual('un juzgado que no está en el catálogo tampoco',
        sandbox.urlEstradosExpediente(DESCONOC), null);
    // Manda la institución, no el nombre del juzgado: el mismo juzgado da URL
    // en el expediente del TSJ y no la da en el federal.
    verificar('ese juzgado sí da estrados cuando el expediente es del TSJ',
        !!sandbox.urlEstradosExpediente(TSJ));
    igual('pero no si el expediente está marcado como federal',
        sandbox.urlEstradosExpediente(PJF_CON_JUZGADO_TSJ), null);
    igual('ni uno sin juzgado', sandbox.urlEstradosExpediente(SIN_JUZG), null);
    igual('ni un expediente inexistente', sandbox.urlEstradosExpediente(null), null);
    igual('ni uno sin número ni nombre',
        sandbox.urlEstradosExpediente({ institucion: 'TSJ', juzgado: TSJ.juzgado }), null);

    // Sin institución declarada se asume TSJ, como en el resto de la app.
    verificar('sin institución declarada se trata como TSJ',
        !!sandbox.urlEstradosExpediente({ numero: '1/2025', juzgado: TSJ.juzgado }));
}

function pruebaBotonEnLaTarjetaYEnLaFila() {
    const { sandbox } = crearEntorno(TODOS);
    const tieneBoton = (html) => /onclick="abrirEstradosExpediente\(/.test(html);

    verificar('tarjeta: el expediente del TSJ trae su botón',
        tieneBoton(sandbox.renderTarjetaExpedienteHTML(TSJ)));
    verificar('tarjeta: el federal no lo trae',
        !tieneBoton(sandbox.renderTarjetaExpedienteHTML(PJF, { institucion: 'PJF' })));
    verificar('tarjeta: uno con juzgado desconocido tampoco',
        !tieneBoton(sandbox.renderTarjetaExpedienteHTML(DESCONOC)));
    verificar('tarjeta: ni uno federal con nombre de juzgado del TSJ',
        !tieneBoton(sandbox.renderTarjetaExpedienteHTML(PJF_CON_JUZGADO_TSJ,
            { institucion: 'PJF' })));
    verificar('tarjeta: en modo selección no salen acciones',
        !tieneBoton(sandbox.renderTarjetaExpedienteHTML(TSJ, { selectable: true })));

    verificar('fila: el expediente del TSJ trae su botón',
        tieneBoton(sandbox.renderFilaExpedienteHTML(TSJ)));
    verificar('fila: el federal no lo trae',
        !tieneBoton(sandbox.renderFilaExpedienteHTML(PJF, { institucion: 'PJF' })));
    verificar('fila: ni uno federal con nombre de juzgado del TSJ',
        !tieneBoton(sandbox.renderFilaExpedienteHTML(PJF_CON_JUZGADO_TSJ,
            { institucion: 'PJF' })));

    // El clic no debe abrir además el detalle: la fila entera es pulsable.
    const html = sandbox.renderTarjetaExpedienteHTML(TSJ);
    verificar('el botón recibe el evento para poder frenarlo',
        /abrirEstradosExpediente\(1, event\)/.test(html), html);
}

async function pruebaAbrir() {
    const { sandbox, estado } = crearEntorno(TODOS);

    await sandbox.abrirEstradosExpediente(1, null);
    igual('abrir: se abre una sola ventana', estado.popups.length, 1);
    igual('abrir: con la URL del expediente',
        estado.popups[0].url, sandbox.urlEstradosExpediente(TSJ));
    igual('abrir: y titulada con su número', estado.popups[0].titulo, '615/2019');

    // El clic frena la propagación para que no se abra también el detalle.
    let frenado = 0;
    const evento = { stopPropagation: () => frenado++, preventDefault: () => frenado++ };
    await sandbox.abrirEstradosExpediente(1, evento);
    igual('abrir: el clic no llega a la tarjeta que hay debajo', frenado, 2);

    // Casos en los que no hay nada que abrir: se avisa, no se abre en blanco.
    estado.popups = []; estado.toasts = [];
    await sandbox.abrirEstradosExpediente(3, null);
    igual('abrir: un juzgado desconocido no abre ninguna ventana', estado.popups.length, 0);
    verificar('abrir: y se explica por qué',
        estado.toasts.some(t => /estrados/i.test(t.mensaje) && /INVENTADO/.test(t.mensaje)),
        JSON.stringify(estado.toasts));

    estado.popups = []; estado.toasts = [];
    await sandbox.abrirEstradosExpediente(999, null);
    igual('abrir: un expediente borrado no abre nada', estado.popups.length, 0);
    verificar('abrir: y se avisa', estado.toasts.some(t => t.tipo === 'warning'),
        JSON.stringify(estado.toasts));
}

function pruebaSalaSegundaInstancia() {
    const { sandbox } = crearEntorno([]);

    // El nombre exacto sale del catálogo, no de aquí: así la prueba no se cae
    // si mañana se renombra una sala.
    const nombreSala = vm.runInContext('Object.keys(SALAS_SEGUNDA_INSTANCIA)[0]', sandbox);
    verificar('hay salas de segunda instancia en el catálogo', !!nombreSala);
    if (!nombreSala) return;

    // Las salas tienen su propio buscador y necesitan areaId: si el atajo
    // usara el de primera instancia, la búsqueda no devolvería nada.
    const url = sandbox.urlEstradosExpediente(
        { id: 6, numero: '615/2019', institucion: 'TSJ', juzgado: nombreSala });

    verificar('sala: usa el buscador de segunda instancia',
        /buscador_segunda\.php/.test(url || ''), `${nombreSala} → ${url}`);
    verificar('sala: y lleva su areaId', /[?&]areaId=\d+/.test(url || ''), url);
    verificar('sala: con el id de la sala',
        new RegExp('[?&]int=' + vm.runInContext(
            `SALAS_SEGUNDA_INSTANCIA[${JSON.stringify(nombreSala)}]`, sandbox) + '(&|$)').test(url || ''),
        url);
}

(async () => {
    const pruebas = [
        ['la URL de estrados', pruebaURL],
        ['cuándo no hay estrados', pruebaCuandoNoHayEstrados],
        ['el botón en la tarjeta y en la fila', pruebaBotonEnLaTarjetaYEnLaFila],
        ['abrir los estrados', pruebaAbrir],
        ['salas de segunda instancia', pruebaSalaSegundaInstancia]
    ];
    for (const [nombre, fn] of pruebas) {
        try { await fn(); }
        catch (e) { fallidas++; fallos.push(`${nombre}: lanzó ${e && e.stack ? e.stack : e}`); }
    }

    console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
    if (fallos.length) {
        console.log('  Fallos:');
        fallos.forEach(f => console.log('   ✗ ' + f));
        console.log('');
        process.exit(1);
    }
    console.log('  ✓ El atajo a estrados abre lo que debe, y solo cuando existe.\n');
})();
