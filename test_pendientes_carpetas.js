#!/usr/bin/env node
/**
 * Pruebas de la etiqueta de carpeta en los pendientes:
 *
 *   un pendiente de un expediente sin carpeta no se guarda hasta ponerle una,
 *   y uno general o de referencia libre se guarda sin pedirla.
 *
 * Corre sin dependencias:  node test_pendientes_carpetas.js
 *
 * El código real de docs/js/ se carga tal cual (no se copia aquí), así que si
 * alguien afloja la exigencia o renombra un campo, esto falla.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = __dirname;
const JS = path.join(RAIZ, 'docs', 'js');

// ==================== DOM SIMULADO ====================
// Lo justo para el formulario del pendiente: elementos por id, y un innerHTML
// que registra los campos que el HTML inyectado declara. Sin eso no se podría
// probar el selector de carpeta, que se pinta al vuelo según el expediente.

function crearDocumento() {
    const elementos = new Map();
    const focos = [];

    function registrarDesdeHTML(html) {
        const selects = /<select id="([^"]+)"[\s\S]*?>([\s\S]*?)<\/select>/g;
        let m;
        while ((m = selects.exec(html)) !== null) {
            const opciones = [];
            const re = /<option value="([^"]*)"( selected)?>/g;
            let o;
            while ((o = re.exec(m[2])) !== null) opciones.push({ valor: o[1], sel: !!o[2] });
            const el = obtener(m[1]);
            el.opciones = opciones.map(x => x.valor);
            const elegida = opciones.find(x => x.sel) || opciones[0];
            el.value = elegida ? elegida.valor : '';
        }

        const inputs = /<input [^>]*id="([^"]+)"[^>]*>/g;
        while ((m = inputs.exec(html)) !== null) {
            const valor = /value="([^"]*)"/.exec(m[0]);
            obtener(m[1]).value = valor ? valor[1] : '';
        }

        const divs = /<div id="([^"]+)"([^>]*)>/g;
        while ((m = divs.exec(html)) !== null) {
            const estilo = /style="([^"]*)"/.exec(m[2]);
            if (estilo) obtener(m[1]).style.display = /display:\s*none/.test(estilo[1]) ? 'none' : '';
        }
    }

    function obtener(id) {
        if (elementos.has(id)) return elementos.get(id);
        const el = {
            id, value: '', textContent: '', className: '',
            dataset: {}, style: {}, opciones: [], _html: '',
            get innerHTML() { return this._html; },
            set innerHTML(v) { this._html = String(v == null ? '' : v); registrarDesdeHTML(this._html); },
            focus() { focos.push(id); }
        };
        elementos.set(id, el);
        return el;
    }

    return {
        elementos, focos,
        getElementById: (id) => (elementos.has(id) ? elementos.get(id) : null),
        // Los ids que el formulario ya trae en su HTML existen desde el principio.
        declarar: (...ids) => ids.forEach(obtener),
        crear: obtener,
        querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {}
    };
}

// ==================== ENTORNO ====================

function crearEntorno() {
    const estado = {
        expedientes: [], carpetas: [], pendientes: [], eventos: [],
        siguienteId: 1, toasts: [], modalCerrado: 0, sincronizaciones: 0, refrescosCarpetas: 0
    };
    const nuevoId = () => estado.siguienteId++;
    const doc = crearDocumento();

    const sandbox = {
        console, estado, doc,
        document: doc,
        setTimeout: (fn) => 0,
        Logger: { log: () => {}, warn: () => {}, error: () => {} },
        escapeText: (t) => String(t == null ? '' : t),
        mostrarToast: (mensaje, tipo) => { estado.toasts.push({ tipo, mensaje }); },
        abrirModal: () => {}, cerrarModal: () => { estado.modalCerrado++; },
        confirm: () => true,

        // --- Capa de datos (mismas firmas que docs/js/database.js) ---
        obtenerExpedientes: async () => estado.expedientes.filter(e => !e.archivado),
        obtenerExpediente: async (id) => estado.expedientes.find(e => e.id === id) || null,
        actualizarExpediente: async (id, cambios) => {
            const e = estado.expedientes.find(x => x.id === id);
            if (!e) throw new Error('Expediente no encontrado');
            Object.assign(e, cambios);
            return e;
        },
        obtenerCarpetas: async () => estado.carpetas.slice(),
        agregarCarpeta: async (c) => { const id = nuevoId(); estado.carpetas.push({ ...c, id }); return id; },
        agregarPendiente: async (p) => { const id = nuevoId(); estado.pendientes.push({ ...p, id }); return id; },
        obtenerPendiente: async (id) => estado.pendientes.find(p => p.id === id) || null,
        actualizarPendiente: async (id, cambios) => {
            const p = estado.pendientes.find(x => x.id === id);
            if (p) Object.assign(p, cambios);
            return p;
        },
        agregarEvento: async (ev) => { const id = nuevoId(); estado.eventos.push({ ...ev, id }); return id; },
        obtenerEventos: async () => estado.eventos.slice(),
        actualizarEvento: async (id, cambios) => {
            const e = estado.eventos.find(x => x.id === id);
            if (e) Object.assign(e, cambios);
            return e;
        },
        eliminarEvento: async (id) => { estado.eventos = estado.eventos.filter(e => e.id !== id); },
        registrarCambioExpediente: async () => {},

        // --- Ganchos de UI/sync (el núcleo los llama con guardas typeof) ---
        cargarExpedientes: async () => {},
        cargarExpedientesPJF: async () => {},
        cargarEventos: async () => {},
        cargarNotas: async () => {},
        cargarEstadisticas: async () => {},
        renderizarCalendario: () => {},
        marcarYSincronizar: async () => { estado.sincronizaciones++; }
    };

    sandbox.window = sandbox;
    vm.createContext(sandbox);
    return { sandbox, estado, doc };
}

// ==================== CARGA DEL CÓDIGO REAL ====================

// Igual que en test_template_csv.js: se apoya en que las declaraciones empiezan
// en la columna 0. Falla ruidosamente si no encuentra la que busca.
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

// Las variables de módulo van primero: las funciones las leen al ejecutarse.
const NECESARIO_DE_APP = [
    '_carpetasCache', '_carpetasPorId', 'pendientesCache', 'expedientesCachePendientes',
    'comboExpedienteOpciones', 'refrescarCarpetasCache', 'obtenerCarpetasDeCache', 'carpetaDeCache',
    '_claveNombreCarpetaLocal', 'colorCarpeta',
    '_normalizarBusqueda', 'textoBuscableExpediente',
    '_expedienteDePendiente', '_nombreExpedientePendiente',
    '_carpetaDePendiente', 'pendienteExigeCarpeta', 'pendienteSinCarpeta', '_chipCarpetaPendienteHTML',
    '_opcionesComboExpediente', 'resolverComboExpediente',
    '_opcionesCarpetaHTML', 'alternarCarpetaNueva', '_camposCarpetaHTML', '_leerCarpetaElegida',
    '_aplicarCarpetaAExpediente', '_refrescarTrasCambioDeCarpeta',
    'asignarCarpetaDesdePendiente', 'guardarCarpetaDesdePendiente',
    'sincronizarCarpetaPendiente', 'guardarPendiente'
];

function cargarCodigoReal(sandbox) {
    vm.runInContext(fs.readFileSync(path.join(JS, 'acciones-core.js'), 'utf8'), sandbox,
        { filename: 'acciones-core.js' });

    const app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    for (const nombre of NECESARIO_DE_APP) {
        vm.runInContext(extraerDeclaracion(app, nombre, 'app.js'), sandbox, { filename: `app.js:${nombre}` });
    }

    // cargarCarpetasUI y cargarPendientes viven en app.js entre medio tablero de
    // DOM; aquí basta con que dejen las cachés al día, que es lo que la app
    // consigue con ellas.
    vm.runInContext(`
        cargarCarpetasUI = async function () { estado.refrescosCarpetas++; await refrescarCarpetasCache(); };
        cargarPendientes = async function () {
            pendientesCache = estado.pendientes.slice();
            expedientesCachePendientes = (await obtenerExpedientes());
        };
    `, sandbox);
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

// Deja el entorno como justo después de abrir el formulario del pendiente.
async function abrirFormulario(ctx, { expedienteSel = '', textoCombo = '', titulo = 'Hacer algo' } = {}) {
    const { sandbox, doc, estado } = ctx;
    estado.toasts = [];
    doc.elementos.clear();
    doc.focos.length = 0;

    doc.declarar('pendiente-id', 'pendiente-titulo', 'pendiente-descripcion', 'pendiente-fecha',
        'pendiente-prioridad', 'pendiente-expediente-custom', 'pendiente-exp-buscar',
        'pendiente-expediente', 'pendiente-carpeta-group', 'pendiente-carpeta-campos',
        'pendiente-carpeta-obligatoria', 'pendiente-carpeta-hint');

    doc.crear('pendiente-titulo').value = titulo;
    doc.crear('pendiente-expediente').value = expedienteSel;
    doc.crear('pendiente-exp-buscar').value = textoCombo;

    await vm.runInContext(`(async () => {
        expedientesCachePendientes = await obtenerExpedientes();
        pendientesCache = estado.pendientes.slice();
        await refrescarCarpetasCache();
        comboExpedienteOpciones = _opcionesComboExpediente();
        sincronizarCarpetaPendiente(${JSON.stringify(expedienteSel)});
    })()`, sandbox);
}

const guardar = (sandbox) => sandbox.guardarPendiente({ preventDefault: () => {} });

// ==================== PRUEBAS ====================

async function pruebaSinCarpetaNoGuarda() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });

    await abrirFormulario(ctx, { expedienteSel: '1', textoCombo: '123/2025' });

    verificar('el campo de carpeta se muestra cuando hay expediente',
        doc.getElementById('pendiente-carpeta-group').style.display === 'block');
    verificar('se marca obligatoria si al expediente le falta carpeta',
        doc.getElementById('pendiente-carpeta-obligatoria').style.display === '');
    verificar('el aviso explica que sin carpeta no se guarda',
        /no se guarda el pendiente/.test(doc.getElementById('pendiente-carpeta-hint').textContent),
        doc.getElementById('pendiente-carpeta-hint').textContent);
    verificar('el aviso se pinta como aviso, no como pista normal',
        doc.getElementById('pendiente-carpeta-hint').className === 'form-hint aviso');
    verificar('sin carpetas creadas, la opción vacía sale seleccionada',
        doc.getElementById('pendiente-carpeta').value === '');

    await guardar(sandbox);

    igual('no se crea el pendiente sin carpeta', estado.pendientes.length, 0);
    verificar('el aviso dice qué falta',
        estado.toasts.some(t => t.tipo === 'error' && /carpeta/i.test(t.mensaje)),
        JSON.stringify(estado.toasts));
    verificar('el foco va al campo de carpeta', doc.focos.includes('pendiente-carpeta'), JSON.stringify(doc.focos));
    igual('el modal sigue abierto', estado.modalCerrado, 0);
}

async function pruebaCrearCarpetaDesdeElPendiente() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });
    await abrirFormulario(ctx, { expedienteSel: '1', textoCombo: '123/2025', titulo: 'Contestar demanda' });

    doc.getElementById('pendiente-carpeta').value = '__nueva__';
    sandbox.alternarCarpetaNueva('pendiente-carpeta', 'pendiente-carpeta-nueva-group', 'pendiente-carpeta-nueva');
    verificar('al elegir "crear nueva" aparecen sus campos',
        doc.getElementById('pendiente-carpeta-nueva-group').style.display === 'block');

    doc.getElementById('pendiente-carpeta-nueva').value = '  Caso Pérez vs IMSS  ';
    doc.getElementById('pendiente-carpeta-nueva-color').value = '#ff0000';

    await guardar(sandbox);

    igual('se crea la carpeta', estado.carpetas.length, 1);
    igual('con el nombre sin espacios sobrantes', estado.carpetas[0].nombre, 'Caso Pérez vs IMSS');
    igual('y con el color elegido', estado.carpetas[0].color, '#ff0000');
    igual('el expediente queda en la carpeta nueva', estado.expedientes[0].carpetaId, estado.carpetas[0].id);
    igual('el pendiente se crea', estado.pendientes.length, 1);
    igual('colgado de su expediente', estado.pendientes[0].expedienteId, 1);
    igual('el modal se cierra', estado.modalCerrado, 1);
    verificar('se avisa de que se creó', estado.toasts.some(t => t.tipo === 'success'), JSON.stringify(estado.toasts));
    verificar('el caché de carpetas se refresca para que salga el distintivo',
        estado.refrescosCarpetas > 0);
    igual('carpeta y pendiente suben en una sola sincronización', estado.sincronizaciones, 1);
}

async function pruebaCarpetaExistente() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.carpetas.push({ id: 10, nombre: 'Caso Caribe', color: '#3b82f6' });
    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });

    await abrirFormulario(ctx, { expedienteSel: '1', textoCombo: '123/2025' });
    doc.getElementById('pendiente-carpeta').value = '10';
    await guardar(sandbox);

    igual('se reutiliza la carpeta, no se duplica', estado.carpetas.length, 1);
    igual('el expediente queda etiquetado', estado.expedientes[0].carpetaId, 10);
    igual('el pendiente se crea', estado.pendientes.length, 1);
}

async function pruebaNombreRepetidoReutiliza() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.carpetas.push({ id: 10, nombre: 'Caso Caribe', color: '#3b82f6' });
    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });

    await abrirFormulario(ctx, { expedienteSel: '1', textoCombo: '123/2025' });
    doc.getElementById('pendiente-carpeta').value = '__nueva__';
    // Mismo nombre con otro acento/caja: es la misma carpeta.
    doc.getElementById('pendiente-carpeta-nueva').value = 'caso caribe';
    await guardar(sandbox);

    igual('no se crea una carpeta duplicada', estado.carpetas.length, 1);
    igual('el expediente va a la que ya existía', estado.expedientes[0].carpetaId, 10);
    igual('y el pendiente se guarda igual', estado.pendientes.length, 1);
}

async function pruebaExpedienteConCarpetaNoEstorba() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.carpetas.push({ id: 10, nombre: 'Caso Caribe', color: '#3b82f6' });
    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ', carpetaId: 10 });

    await abrirFormulario(ctx, { expedienteSel: '1', textoCombo: '123/2025' });

    igual('la carpeta del expediente viene elegida', doc.getElementById('pendiente-carpeta').value, '10');
    verificar('no se ofrece dejarlo sin carpeta',
        !doc.getElementById('pendiente-carpeta').opciones.includes(''),
        JSON.stringify(doc.getElementById('pendiente-carpeta').opciones));
    verificar('no se marca como obligatoria',
        doc.getElementById('pendiente-carpeta-obligatoria').style.display === 'none');
    verificar('la pista deja de ser aviso',
        doc.getElementById('pendiente-carpeta-hint').className === 'form-hint');

    await guardar(sandbox);
    igual('el pendiente se guarda sin más trámite', estado.pendientes.length, 1);
    igual('y el expediente no se mueve de carpeta', estado.expedientes[0].carpetaId, 10);
}

async function pruebaCambiarDeCarpetaMueveElExpediente() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.carpetas.push({ id: 10, nombre: 'Caso Caribe', color: '#3b82f6' });
    estado.carpetas.push({ id: 11, nombre: 'Caso Maya', color: '#22c55e' });
    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ', carpetaId: 10 });

    await abrirFormulario(ctx, { expedienteSel: '1', textoCombo: '123/2025' });
    doc.getElementById('pendiente-carpeta').value = '11';
    await guardar(sandbox);

    igual('el expediente cambia de carpeta', estado.expedientes[0].carpetaId, 11);
    igual('el pendiente se guarda', estado.pendientes.length, 1);
}

async function pruebaCarpetaBorradaSeVuelveAPedir() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    // El expediente apunta a una carpeta que ya no está (se borró en otro
    // dispositivo): cuenta como que le falta.
    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ', carpetaId: 99 });

    await abrirFormulario(ctx, { expedienteSel: '1', textoCombo: '123/2025' });
    verificar('se vuelve a exigir carpeta',
        doc.getElementById('pendiente-carpeta-obligatoria').style.display === '');
    igual('y no queda ninguna elegida', doc.getElementById('pendiente-carpeta').value, '');

    await guardar(sandbox);
    igual('no se guarda con la carpeta rota', estado.pendientes.length, 0);
}

async function pruebaGeneralNoExigeCarpeta() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });
    await abrirFormulario(ctx, { expedienteSel: '', textoCombo: '', titulo: 'Llamar al cliente' });

    verificar('el campo de carpeta ni se muestra',
        doc.getElementById('pendiente-carpeta-group').style.display === 'none');

    await guardar(sandbox);

    igual('el pendiente general se guarda', estado.pendientes.length, 1);
    igual('sin expediente', estado.pendientes[0].expedienteId, null);
    igual('y sin haber creado carpetas', estado.carpetas.length, 0);
    verificar('sin ningún error', !estado.toasts.some(t => t.tipo === 'error'), JSON.stringify(estado.toasts));
}

async function pruebaReferenciaLibreNoExigeCarpeta() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });
    await abrirFormulario(ctx, { expedienteSel: '__custom__', textoCombo: '', titulo: 'Reunión con el cliente' });
    doc.getElementById('pendiente-expediente-custom').value = 'Asunto nuevo, sin registrar';

    verificar('el campo de carpeta ni se muestra',
        doc.getElementById('pendiente-carpeta-group').style.display === 'none');

    await guardar(sandbox);

    igual('el pendiente de referencia libre se guarda', estado.pendientes.length, 1);
    igual('con su texto', estado.pendientes[0].expedienteTexto, 'Asunto nuevo, sin registrar');
    igual('y sin carpetas', estado.carpetas.length, 0);
}

async function pruebaExpedienteEscritoSinElegir() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });

    // Se escribe el expediente y se guarda sin elegirlo de la lista: el campo
    // de carpeta todavía no se había mostrado.
    await abrirFormulario(ctx, { expedienteSel: '', textoCombo: '123/2025' });
    verificar('mientras no se resuelve, el campo está oculto',
        doc.getElementById('pendiente-carpeta-group').style.display === 'none');

    await guardar(sandbox);

    igual('no se cuela un pendiente sin carpeta', estado.pendientes.length, 0);
    verificar('y el campo aparece ya apuntando al expediente resuelto',
        doc.getElementById('pendiente-carpeta-group').style.display === 'block' &&
        doc.getElementById('pendiente-carpeta-group').dataset.expediente === '1');

    // Ahora sí: se crea la carpeta y se vuelve a guardar.
    doc.getElementById('pendiente-carpeta').value = '__nueva__';
    doc.getElementById('pendiente-carpeta-nueva').value = 'Caso Pérez';
    await guardar(sandbox);

    igual('a la segunda se guarda', estado.pendientes.length, 1);
    igual('con el expediente que se había escrito', estado.pendientes[0].expedienteId, 1);
    igual('y su carpeta puesta', estado.expedientes[0].carpetaId, estado.carpetas[0].id);
}

async function pruebaEdicionTambienExige() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });
    estado.pendientes.push({
        id: 5, titulo: 'Viejo', descripcion: '', expedienteId: 1, expedienteTexto: null,
        fechaLimite: null, completado: false, prioridad: '', eventoId: null
    });

    await abrirFormulario(ctx, { expedienteSel: '1', textoCombo: '123/2025', titulo: 'Viejo, corregido' });
    doc.getElementById('pendiente-id').value = '5';

    await guardar(sandbox);
    igual('editar tampoco pasa sin carpeta', estado.pendientes[0].titulo, 'Viejo');

    doc.getElementById('pendiente-carpeta').value = '__nueva__';
    doc.getElementById('pendiente-carpeta-nueva').value = 'Caso Pérez';
    await guardar(sandbox);

    igual('con carpeta sí se guarda la edición', estado.pendientes[0].titulo, 'Viejo, corregido');
    igual('y el expediente queda etiquetado', estado.expedientes[0].carpetaId, estado.carpetas[0].id);
}

async function pruebaAtajoDesdeLaLista() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });
    estado.pendientes.push({ id: 5, titulo: 'Algo', expedienteId: 1, completado: false });

    doc.declarar('modal-titulo', 'modal-body', 'modal-footer');
    await vm.runInContext(`(async () => {
        expedientesCachePendientes = await obtenerExpedientes();
        pendientesCache = estado.pendientes.slice();
        await refrescarCarpetasCache();
        await asignarCarpetaDesdePendiente(5);
    })()`, sandbox);

    verificar('el atajo explica de qué expediente se trata',
        /123\/2025/.test(doc.getElementById('modal-body').innerHTML));

    doc.getElementById('asignar-carpeta').value = '__nueva__';
    doc.getElementById('asignar-carpeta-nueva').value = 'Caso Caribe';
    await sandbox.guardarCarpetaDesdePendiente(1);

    igual('se crea la carpeta desde la lista', estado.carpetas.length, 1);
    igual('y el expediente queda etiquetado', estado.expedientes[0].carpetaId, estado.carpetas[0].id);
    igual('el modal se cierra', estado.modalCerrado, 1);

    // Sin elegir nada no debe aplicar nada.
    estado.expedientes.push({ id: 2, numero: '999/2025', juzgado: 'Juzgado Segundo Civil', institucion: 'TSJ' });
    estado.pendientes.push({ id: 6, titulo: 'Otro', expedienteId: 2, completado: false });
    estado.toasts = [];
    await vm.runInContext(`(async () => {
        expedientesCachePendientes = await obtenerExpedientes();
        pendientesCache = estado.pendientes.slice();
        await asignarCarpetaDesdePendiente(6);
    })()`, sandbox);
    doc.getElementById('asignar-carpeta').value = '';
    await sandbox.guardarCarpetaDesdePendiente(2);

    verificar('sin elegir carpeta, el atajo avisa',
        estado.toasts.some(t => t.tipo === 'error'), JSON.stringify(estado.toasts));
    verificar('y no toca el expediente', estado.expedientes[1].carpetaId === undefined);
}

async function pruebaEtiquetasEnLaLista() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado } = ctx;

    estado.carpetas.push({ id: 10, nombre: 'Caso Caribe', color: '#3b82f6' });
    estado.expedientes.push({ id: 1, numero: '123/2025', institucion: 'TSJ', carpetaId: 10 });
    estado.expedientes.push({ id: 2, numero: '999/2025', institucion: 'TSJ' });

    await vm.runInContext(`(async () => {
        expedientesCachePendientes = await obtenerExpedientes();
        await refrescarCarpetasCache();
    })()`, sandbox);

    const conCarpeta = { id: 1, titulo: 'A', expedienteId: 1 };
    const sinCarpeta = { id: 2, titulo: 'B', expedienteId: 2 };
    const general = { id: 3, titulo: 'C', expedienteId: null };
    const libre = { id: 4, titulo: 'D', expedienteId: null, expedienteTexto: 'Reunión' };
    const huerfano = { id: 5, titulo: 'E', expedienteId: 77 };

    igual('el pendiente con carpeta no está "sin carpeta"', sandbox.pendienteSinCarpeta(conCarpeta), false);
    igual('el pendiente cuyo expediente no tiene carpeta sí', sandbox.pendienteSinCarpeta(sinCarpeta), true);
    igual('el general no exige carpeta', sandbox.pendienteExigeCarpeta(general), false);
    igual('la referencia libre tampoco', sandbox.pendienteExigeCarpeta(libre), false);
    igual('ni uno cuyo expediente ya no está', sandbox.pendienteExigeCarpeta(huerfano), false);

    verificar('la etiqueta muestra el nombre de la carpeta',
        /Caso Caribe/.test(sandbox._chipCarpetaPendienteHTML(conCarpeta)));
    verificar('y su color',
        /#3b82f6/.test(sandbox._chipCarpetaPendienteHTML(conCarpeta)));
    verificar('el que no tiene ofrece ponerla',
        /asignarCarpetaDesdePendiente\(2/.test(sandbox._chipCarpetaPendienteHTML(sinCarpeta)),
        sandbox._chipCarpetaPendienteHTML(sinCarpeta));
    igual('el general no pinta etiqueta', sandbox._chipCarpetaPendienteHTML(general), '');
    igual('la referencia libre tampoco', sandbox._chipCarpetaPendienteHTML(libre), '');
    igual('ni el huérfano', sandbox._chipCarpetaPendienteHTML(huerfano), '');
}

async function pruebaPendienteConFechaSigueAgendando() {
    const ctx = crearEntorno();
    cargarCodigoReal(ctx.sandbox);
    const { sandbox, estado, doc } = ctx;

    estado.expedientes.push({ id: 1, numero: '123/2025', juzgado: 'Juzgado Primero Civil', institucion: 'TSJ' });
    await abrirFormulario(ctx, { expedienteSel: '1', textoCombo: '123/2025', titulo: 'Audiencia' });
    doc.getElementById('pendiente-fecha').value = '2026-03-10T09:00';
    doc.getElementById('pendiente-carpeta').value = '__nueva__';
    doc.getElementById('pendiente-carpeta-nueva').value = 'Caso Pérez';

    await guardar(sandbox);

    igual('el pendiente se crea', estado.pendientes.length, 1);
    igual('y sigue creando su evento de calendario', estado.eventos.length, 1);
    verificar('el evento queda vinculado', estado.pendientes[0].eventoId === estado.eventos[0].id);
    igual('todo sube en una sola sincronización', estado.sincronizaciones, 1);
}

// ==================== EJECUCIÓN ====================

(async () => {
    const pruebas = [
        ['un expediente sin carpeta no deja guardar', pruebaSinCarpetaNoGuarda],
        ['crear la carpeta desde el pendiente', pruebaCrearCarpetaDesdeElPendiente],
        ['elegir una carpeta existente', pruebaCarpetaExistente],
        ['un nombre repetido reutiliza la carpeta', pruebaNombreRepetidoReutiliza],
        ['un expediente ya etiquetado no estorba', pruebaExpedienteConCarpetaNoEstorba],
        ['cambiar la carpeta mueve el expediente', pruebaCambiarDeCarpetaMueveElExpediente],
        ['una carpeta borrada se vuelve a pedir', pruebaCarpetaBorradaSeVuelveAPedir],
        ['un pendiente general no exige carpeta', pruebaGeneralNoExigeCarpeta],
        ['una referencia libre no exige carpeta', pruebaReferenciaLibreNoExigeCarpeta],
        ['el expediente escrito sin elegir también la exige', pruebaExpedienteEscritoSinElegir],
        ['editar un pendiente también la exige', pruebaEdicionTambienExige],
        ['atajo para etiquetar desde la lista', pruebaAtajoDesdeLaLista],
        ['etiquetas en la lista de pendientes', pruebaEtiquetasEnLaLista],
        ['un pendiente con fecha sigue agendándose', pruebaPendienteConFechaSigueAgendando]
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
    console.log('  ✓ Todo en orden\n');
})();
