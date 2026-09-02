#!/usr/bin/env node
/**
 * Pruebas de qué encuentra el buscador.
 *
 *   node test_busqueda.js
 *
 * La app tiene cinco buscadores locales —expedientes TSJ, expedientes PJF,
 * archivo, notas y pendientes— y cada uno llevaba su propia lista de campos
 * escrita a mano. Se fueron separando: la carpeta (el nombre con el que el
 * usuario llama a sus casos) se encontraba en el de pendientes y en ninguno
 * más. Esto fija que los cinco busquen por lo mismo.
 *
 * Se carga el código real de docs/js/, no una copia.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, 'docs', 'js');

// ==================== ENTORNO ====================

function crearEntorno(datos) {
    const estado = {
        expedientes: datos.expedientes || [],
        archivados: datos.archivados || [],
        notas: datos.notas || [],
        pendientes: datos.pendientes || [],
        carpetas: datos.carpetas || [],
        historial: datos.historial || [],
        // Lo que quedó pintado en cada lista, para leer los resultados.
        pintado: {}
    };

    const campos = {};   // valores de los inputs de búsqueda y filtros

    const elemento = (id) => ({
        id,
        get value() { return campos[id] || ''; },
        set value(v) { campos[id] = v; },
        set innerHTML(v) { estado.pintado[id] = String(v); },
        get innerHTML() { return estado.pintado[id] || ''; },
        set textContent(v) { estado.pintado[id] = String(v); },
        get textContent() { return estado.pintado[id] || ''; },
        style: {}, dataset: {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }
    });
    const elementos = new Map();
    const obtenerEl = (id) => {
        if (!elementos.has(id)) elementos.set(id, elemento(id));
        return elementos.get(id);
    };

    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        estado, campos,
        document: {
            getElementById: obtenerEl,
            querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {}
        },
        setTimeout: (fn) => { fn(); return 0; },
        clearTimeout: () => {},
        escapeText: (t) => String(t == null ? '' : t),
        formatearFecha: (f) => String(f || ''),
        mostrarToast: () => {},
        Logger: { log: () => {}, warn: () => {}, error: () => {} },

        obtenerExpedientes: async () => estado.expedientes.slice(),
        obtenerExpedientesArchivados: async () => estado.archivados.slice(),
        obtenerNotas: async () => estado.notas.slice(),
        obtenerPendientes: async () => estado.pendientes.slice(),
        obtenerCarpetas: async () => estado.carpetas.slice(),
        obtenerTodoHistorial: async () => estado.historial.slice(),
        obtenerEventos: async () => [],

        // Ganchos de render que no interesan aquí.
        inicializarDragAndDrop: () => {}, inicializarDragAndDropPJF: () => {},
        renderCardArchivado: (exp) => `[archivado:${exp.numero || exp.nombre}]`,
        renderTarjetaExpedienteHTML: (exp) => `[tarjeta:${exp.numero || exp.nombre}]`,
        renderFilaExpedienteHTML: (exp) => `[fila:${exp.numero || exp.nombre}]`,
        renderNotaHTML: (nota) => `[nota:${nota.titulo}]`,
        vistaExpedientes: 'cards', vistaExpedientesPJF: 'cards',
        aplicarVistaExpedientes: () => {}, aplicarVistaExpedientesPJF: () => {},
        actualizarBadgeArchivo: () => {}, actualizarBadgeArchivoPJF: () => {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    return { sandbox, estado, campos };
}

// ==================== CARGA DEL CÓDIGO REAL ====================

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

const NECESARIO = [
    '_carpetasCache', '_carpetasPorId', 'refrescarCarpetasCache', 'obtenerCarpetasDeCache',
    'carpetaDeCache', '_normalizarBusqueda', 'textoBuscableExpediente',
    'expedienteCoincideBusqueda', '_coincideTexto', '_expedienteEncajaEnBusqueda',
    '_searchIndexCache', '_searchIndexVersion', '_dataMutationCounter',
    'obtenerIndiceBusqueda', 'invalidarIndiceBusqueda',
    '_filtrarArchivoComun', 'filtrarArchivo', 'filtrarArchivoPJF',
    'filtrarExpedientes', 'filtrarExpedientesPJF', 'filtrarNotas'
];

function cargarCodigoReal(sandbox) {
    const app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    for (const nombre of NECESARIO) {
        vm.runInContext(extraerDeclaracion(app, nombre, 'app.js'), sandbox,
            { filename: `app.js:${nombre}` });
    }
}

// La paleta de comandos es un módulo cerrado: se prueba su criterio tal cual
// está escrito, extrayendo la parte que decide si un expediente entra.
function cargarPaleta(sandbox) {
    const fuente = fs.readFileSync(path.join(JS, 'command-palette.js'), 'utf8');
    const bloque = /matches\(exp\.numero,\s*q\)[\s\S]*?matches\(datosCache\.carpetas\.get\(exp\.carpetaId\), q\)/
        .exec(fuente);
    if (!bloque) throw new Error('La paleta ya no filtra expedientes como se esperaba (¿se reescribió?)');
    for (const n of ['normalizar', 'matches']) {
        const decl = new RegExp('^([ \\t]*)function ' + n + '\\s*\\([\\s\\S]*?\\n\\1\\}', 'm')
            .exec(fuente);
        if (!decl) throw new Error(`No se encontró "${n}" en command-palette.js (¿se renombró?)`);
        vm.runInContext(decl[0], sandbox, { filename: `command-palette.js:${n}` });
    }
    vm.runInContext(`function paletaEncuentra(exp, q) { return (${bloque[0]}); }`,
        sandbox, { filename: 'command-palette.js:buscar' });
}

// ==================== UTILIDADES ====================

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

// Los expedientes que quedaron pintados en una lista.
function pintados(estado, id) {
    return (estado.pintado[id] || '').match(/\[(?:tarjeta|fila|archivado):([^\]]+)\]/g)?.
        map(x => x.replace(/\[[a-z]+:|\]/g, '')) || [];
}
function notasPintadas(estado, id) {
    const ids = (estado.pintado[id] || '').match(/editarNota\((\d+)\)/g) || [];
    return ids.map(x => Number(x.replace(/\D/g, '')));
}

// ==================== DATOS DE PRUEBA ====================
// Dos expedientes del mismo caso agrupados en una carpeta, uno suelto, y uno
// archivado. La palabra "Pérez" SOLO aparece en el nombre de la carpeta: si
// el buscador no mira la carpeta, buscarla no devuelve nada.

const DATOS = {
    carpetas: [
        { id: 10, nombre: 'Caso Pérez vs IMSS', color: '#3b82f6' },
        { id: 11, nombre: 'Caso Maya', color: '#22c55e' }
    ],
    expedientes: [
        { id: 1, numero: '111/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
          institucion: 'TSJ', categoria: 'CIVIL', carpetaId: 10 },
        { id: 2, numero: '222/2025', juzgado: 'JUZGADO SEGUNDO CIVIL CANCUN',
          institucion: 'PJF', categoria: 'PJF Federal', carpetaId: 10 },
        { id: 3, numero: '333/2025', juzgado: 'JUZGADO TERCERO CIVIL CANCUN',
          institucion: 'TSJ', categoria: 'CIVIL', carpetaId: 11 },
        { id: 4, numero: '444/2025', juzgado: 'JUZGADO CUARTO CIVIL CANCUN',
          institucion: 'TSJ', categoria: 'CIVIL' }
    ],
    archivados: [
        { id: 5, numero: '555/2024', juzgado: 'JUZGADO QUINTO CIVIL CANCUN',
          institucion: 'TSJ', archivado: true, carpetaId: 10, etiquetaArchivo: 'Desistimiento' }
    ],
    notas: [
        { id: 20, titulo: 'Acuerdo', contenido: 'lo que sea', expedienteId: 1 },
        { id: 21, titulo: 'Suelta', contenido: 'nada que ver', expedienteId: 4 }
    ],
    pendientes: [],
    historial: []
};

async function preparar() {
    const ctx = crearEntorno(JSON.parse(JSON.stringify(DATOS)));
    cargarCodigoReal(ctx.sandbox);
    await vm.runInContext('refrescarCarpetasCache()', ctx.sandbox);
    return ctx;
}

// ==================== PRUEBAS ====================

async function pruebaExpedientesTSJ() {
    const { sandbox, estado, campos } = await preparar();

    campos['buscar-expediente'] = 'Pérez';
    await sandbox.filtrarExpedientes();
    igual('lista: buscar el nombre de la carpeta trae los expedientes del caso',
        pintados(estado, 'lista-expedientes'), ['111/2025', '222/2025']);

    // Sin acentos debe dar lo mismo: nadie escribe "Pérez" en el buscador.
    campos['buscar-expediente'] = 'perez';
    await sandbox.filtrarExpedientes();
    igual('lista: y sin acentos encuentra igual',
        pintados(estado, 'lista-expedientes'), ['111/2025', '222/2025']);

    campos['buscar-expediente'] = 'CASO MAYA';
    await sandbox.filtrarExpedientes();
    igual('TSJ: cada carpeta trae los suyos, no los de otra',
        pintados(estado, 'lista-expedientes'), ['333/2025']);

    // Lo que ya funcionaba tiene que seguir funcionando.
    campos['buscar-expediente'] = '444';
    await sandbox.filtrarExpedientes();
    igual('TSJ: el número sigue encontrándose',
        pintados(estado, 'lista-expedientes'), ['444/2025']);

    campos['buscar-expediente'] = 'CUARTO';
    await sandbox.filtrarExpedientes();
    igual('TSJ: el juzgado sigue encontrándose',
        pintados(estado, 'lista-expedientes'), ['444/2025']);

    campos['buscar-expediente'] = 'no existe nada así';
    await sandbox.filtrarExpedientes();
    igual('TSJ: lo que no está no aparece',
        pintados(estado, 'lista-expedientes'), []);
}

async function pruebaExpedientesPJF() {
    const { sandbox, estado, campos } = await preparar();

    campos['buscar-expediente-pjf'] = 'Pérez';
    await sandbox.filtrarExpedientesPJF();
    igual('PJF: la carpeta también se busca en la lista federal',
        pintados(estado, 'lista-expedientes-pjf'), ['222/2025']);

    campos['buscar-expediente-pjf'] = 'maya';
    await sandbox.filtrarExpedientesPJF();
    igual('PJF: y no se cuela un expediente de otra carpeta que no es federal',
        pintados(estado, 'lista-expedientes-pjf'), []);
}

async function pruebaArchivo() {
    const { sandbox, estado, campos } = await preparar();

    campos['buscar-archivo'] = 'perez';
    await sandbox.filtrarArchivo();
    igual('archivo: un expediente archivado se encuentra por su carpeta',
        pintados(estado, 'lista-archivo'), ['555/2024']);

    // El motivo del archivo seguía siendo buscable y debe seguir siéndolo.
    campos['buscar-archivo'] = 'desistimiento';
    await sandbox.filtrarArchivo();
    igual('archivo: y sigue encontrándose por el motivo con que se archivó',
        pintados(estado, 'lista-archivo'), ['555/2024']);
}

async function pruebaNotas() {
    const { sandbox, estado, campos } = await preparar();

    campos['buscar-nota'] = 'perez';
    await sandbox.filtrarNotas();
    igual('notas: buscar el caso trae las notas de sus expedientes',
        notasPintadas(estado, 'lista-notas'), [20]);

    campos['buscar-nota'] = 'acuerdo';
    await sandbox.filtrarNotas();
    igual('notas: el título de la nota sigue encontrándose',
        notasPintadas(estado, 'lista-notas'), [20]);

    campos['buscar-nota'] = 'nada que ver';
    await sandbox.filtrarNotas();
    igual('notas: el contenido también',
        notasPintadas(estado, 'lista-notas'), [21]);
}

async function pruebaPaletaDeComandos() {
    const { sandbox } = await preparar();
    cargarPaleta(sandbox);

    vm.runInContext(`datosCache = { carpetas: new Map([[10, 'Caso Pérez vs IMSS']]) };`, sandbox);

    const conCarpeta = { numero: '111/2025', juzgado: 'JUZGADO PRIMERO', carpetaId: 10 };
    const sinCarpeta = { numero: '444/2025', juzgado: 'JUZGADO CUARTO' };

    const q = (texto) => sandbox.normalizar(texto);
    igual('paleta: encuentra por el nombre del caso',
        sandbox.paletaEncuentra(conCarpeta, q('caso pérez')), true);
    igual('paleta: no arrastra a los que no son de ese caso',
        sandbox.paletaEncuentra(sinCarpeta, q('caso pérez')), false);
    igual('paleta: el número sigue encontrándose',
        sandbox.paletaEncuentra(sinCarpeta, q('444')), true);
    // La paleta buscaba sin quitar acentos mientras el resto sí: escribir
    // "perez" no encontraba "Caso Pérez".
    igual('paleta: y encuentra sin acentos, como el resto de la app',
        sandbox.paletaEncuentra(conCarpeta, q('perez')), true);
}

async function pruebaCriterioCompartido() {
    const { sandbox } = await preparar();

    const exp = { id: 1, numero: '111/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                  actor: 'Juana Ramírez', demandado: 'IMSS', carpetaId: 10 };

    const texto = sandbox.textoBuscableExpediente(exp);
    verificar('criterio: el texto buscable incluye la carpeta',
        /Caso Pérez vs IMSS/.test(texto), texto);
    verificar('criterio: y las partes', /Juana Ramírez/.test(texto) && /IMSS/.test(texto), texto);

    igual('criterio: una consulta vacía no descarta nada',
        sandbox.expedienteCoincideBusqueda(exp, ''), true);
    igual('criterio: encuentra por la parte actora',
        sandbox.expedienteCoincideBusqueda(exp, 'ramirez'), true);

    // Una carpeta que ya no existe no debe reventar ni inventar coincidencias.
    const huerfano = { id: 9, numero: '999/2025', carpetaId: 777 };
    igual('criterio: un expediente con carpeta borrada no rompe la búsqueda',
        sandbox.expedienteCoincideBusqueda(huerfano, 'perez'), false);
    igual('criterio: y se sigue encontrando por su número',
        sandbox.expedienteCoincideBusqueda(huerfano, '999'), true);

    igual('criterio: carpetaDeCache devuelve null sin id',
        sandbox.carpetaDeCache(undefined), null);
    igual('criterio: y la carpeta correcta con id',
        sandbox.carpetaDeCache(10).nombre, 'Caso Pérez vs IMSS');
}

// ==================== EJECUCIÓN ====================

(async () => {
    const pruebas = [
        ['expedientes TSJ', pruebaExpedientesTSJ],
        ['expedientes PJF', pruebaExpedientesPJF],
        ['archivo', pruebaArchivo],
        ['notas', pruebaNotas],
        ['paleta de comandos', pruebaPaletaDeComandos],
        ['criterio compartido', pruebaCriterioCompartido]
    ];

    for (const [nombre, fn] of pruebas) {
        try {
            await fn();
        } catch (e) {
            fallidas++;
            fallos.push(`${nombre}: lanzó ${e && e.stack ? e.stack : e}`);
        }
    }

    console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
    if (fallos.length) {
        console.log('  Fallos:');
        fallos.forEach(f => console.log('   ✗ ' + f));
        console.log('');
        process.exit(1);
    }
    console.log('  ✓ Los cinco buscadores encuentran por carpeta.\n');
})();
