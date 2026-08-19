#!/usr/bin/env node
/**
 * Pruebas del ciclo completo del template único de expedientes:
 *
 *   descargarTemplateExpedientes()  ->  el usuario lo edita en Excel  ->  importarExpedientes()
 *
 * Corre sin dependencias:  node test_template_csv.js
 *
 * El código real de docs/js/ se carga tal cual (no se copia aquí), así que si
 * alguien cambia el template o el parser sin ajustar la importación, esto falla.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = __dirname;
const JS = path.join(RAIZ, 'docs', 'js');

// Catálogo federal real, el mismo que la app descarga por fetch.
const CATALOGO_PJF = JSON.parse(
    fs.readFileSync(path.join(RAIZ, 'docs', 'data', 'pjf_catalogos_completos.json'), 'utf8'));

// ==================== ENTORNO SIMULADO ====================
// Navegador mínimo + una "base de datos" en memoria, para poder ejecutar la
// importación de principio a fin sin IndexedDB ni DOM reales.

function crearEntorno() {
    const estado = {
        expedientes: [], carpetas: [], pendientes: [], eventos: [],
        siguienteId: 1,
        toasts: [], informes: [], confirmaciones: [], limitesMostrados: [], descargas: [],
        respuestaConfirm: true, csvGenerado: null,
        sincronizaciones: 0
    };

    const nuevoId = () => estado.siguienteId++;

    const sandbox = {
        console, estado,

        // --- DOM mínimo ---
        document: {
            getElementById: () => ({ set textContent(v) {}, set innerHTML(v) {}, value: '', style: {} }),
            // Suficiente para descargarArchivo(): el enlace se mete en el
            // documento, se pulsa y se retira.
            createElement: () => ({
                style: {}, href: '', download: '', rel: '',
                click() { estado.descargas.push({ nombre: this.download, enDocumento: this._enDocumento }); },
                remove() { this._enDocumento = false; }
            }),
            body: { appendChild: (el) => { el._enDocumento = true; } },
            querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {}
        },
        setTimeout: (fn, ms) => 0,   // la limpieza diferida no interesa aquí
        Blob: class { constructor(partes) { estado.csvGenerado = partes.join(''); } },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
        Logger: { log: () => {}, warn: () => {}, error: () => {} },

        confirm: (m) => { estado.confirmaciones.push(m); return estado.respuestaConfirm; },
        mostrarToast: (mensaje, tipo) => { estado.toasts.push({ tipo, mensaje }); },
        abrirModal: () => {}, cerrarModal: () => {},
        mostrarModalLimite: (t) => estado.limitesMostrados.push(t),
        escapeText: (t) => String(t == null ? '' : t),

        // --- Capa de datos simulada (mismas firmas que docs/js/database.js) ---
        agregarExpediente: async (exp) => {
            const id = nuevoId(); estado.expedientes.push({ ...exp, id, activo: true }); return id;
        },
        obtenerExpedientes: async () => estado.expedientes.filter(e => e.activo !== false && !e.archivado),
        obtenerExpedientesArchivados: async () => estado.expedientes.filter(e => e.activo !== false && e.archivado === true),
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
        registrarCambioExpediente: async () => {},

        // --- Ganchos de UI/sync (el núcleo los llama con guardas typeof) ---
        cargarExpedientes: async () => {},
        cargarExpedientesPJF: async () => {},
        cargarCarpetasUI: async () => {},
        marcarYSincronizar: async () => { estado.sincronizaciones++; },

        estadoPremium: { activo: true, codigo: 'TEST' }
    };

    sandbox.window = sandbox;
    vm.createContext(sandbox);
    return { sandbox, estado };
}

// ==================== CARGA DEL CÓDIGO REAL ====================

// Extrae una declaración de nivel superior (function / const / let). Se apoya
// en el formato del archivo: las declaraciones empiezan en la columna 0 y su
// llave de cierre también. Falla ruidosamente si no la encuentra: un rename que
// deje la prueba mirando a un stub sería peor que no tener prueba.
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

const NECESARIO_DE_APP = [
    'PREMIUM_CONFIG',
    // Template
    'TEMPLATE_EJEMPLOS', 'TEMPLATE_COLUMNAS', '_csvCampo',
    '_catalogoTSJParaTemplate', '_catalogoTiposAsuntoParaTemplate',
    '_catalogoOrganosPJFParaTemplate', 'descargarArchivo', 'descargarTemplateExpedientes',
    // Parser CSV
    '_quitarBOM', '_detectarSeparador', '_lineasUtilesCSV', 'parseCSV', 'parseCSVLine',
    // Fechas
    '_MESES_CSV', '_mesDesdeTexto', '_fechaDesdeCSV',
    // Institución
    '_normalizarValorCSV', '_INSTITUCIONES_CSV', '_PALABRAS_VACIAS_JUZGADO',
    '_tokensJuzgado', '_sugerirJuzgadoTSJ', '_PARECIDO_MINIMO_SUGERENCIA',
    '_buscarOrganoPJFPorNombre', '_resolverDestinoFila',
    // Importación
    '_TIPOS_CSV_NUMERO', '_TIPOS_CSV_NOMBRE', '_tipoBusquedaDesdeCSV',
    '_esFilaEjemploTemplate', '_claveExpediente', '_claveNombreCarpetaLocal',
    '_resolverCarpetasDeImportacion', '_aplicarLimitePlanAImportacion',
    'mostrarInformeImportacion', '_PRIORIDADES_CSV', '_TIPOS_EVENTO_CSV',
    '_extrasDeFila', 'importarExpedientes', '_contarPorInstitucion',
    '_crearExtrasDeImportacion'
];

function cargarCodigoReal(sandbox) {
    // juzgados.js y acciones-core.js se cargan completos: no tienen efectos
    // secundarios al evaluarse.
    for (const archivo of ['juzgados.js', 'acciones-core.js']) {
        vm.runInContext(fs.readFileSync(path.join(JS, archivo), 'utf8'), sandbox, { filename: archivo });
    }

    // De pjf-search.js solo los ayudantes de texto (el resto toca la red y el DOM).
    const pjf = fs.readFileSync(path.join(JS, 'pjf-search.js'), 'utf8');
    for (const n of ['normalizarTextoPJF', 'PJF_STOPWORDS', 'tokensPJF', 'buscarOrganismoPJF']) {
        vm.runInContext(extraerDeclaracion(pjf, n, 'pjf-search.js'), sandbox, { filename: `pjf-search.js:${n}` });
    }

    // De app.js, el subsistema del template (cargarlo entero arrastraría media app).
    const app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    for (const nombre of NECESARIO_DE_APP) {
        vm.runInContext(extraerDeclaracion(app, nombre, 'app.js'), sandbox, { filename: `app.js:${nombre}` });
    }

    // Catálogo federal ya cargado (en la app lo trae cargarCatalogosPJF por fetch).
    vm.runInContext(`
        pjfOrganismos = ${JSON.stringify(CATALOGO_PJF.organos.map(o => ({
            id: o.id, nombre: o.nombre, circuito_id: Number(o.circuitoId), circuito: o.circuito || '',
            tipoOrganismoId: o.tipoOrganismoId, tipoOrganismo: o.tipoOrganismo || '',
            ciudad: o.ciudad || '', estado: o.estado || ''
        })))};
        pjfCircuitos = ${JSON.stringify(
            [...new Map(CATALOGO_PJF.organos.map(o => [Number(o.circuitoId), o.circuito])).entries()]
                .map(([numero_circuito, nombre]) => ({ numero_circuito, nombre }))
                .sort((a, b) => a.numero_circuito - b.numero_circuito))};
        pjfTiposOrgano = {};
        cargarCatalogosPJF = async function () {};
    `, sandbox);

    // El informe de importación se captura en vez de pintarse.
    vm.runInContext(
        'mostrarInformeImportacion = function (titulo, resumen, errores) {' +
        '  estado.informes.push({ titulo, resumen, errores });' +
        '};', sandbox);
}

// ==================== UTILIDADES DE PRUEBA ====================

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

async function importar(sandbox, estado, csv, opciones = {}) {
    estado.toasts = []; estado.informes = []; estado.confirmaciones = [];
    estado.respuestaConfirm = opciones.confirmar !== false;

    await sandbox.importarExpedientes({
        target: {
            value: 'x',
            files: [{ name: opciones.nombreArchivo || 'expedientes.csv', text: async () => csv }]
        }
    });
    return estado;
}

const COLUMNAS = 'expediente,tipo,institucion,juzgado,organismo_id,tipo_asunto_id,actor,demandado,carpeta,comentario,pendiente,pendiente_fecha,pendiente_prioridad,audiencia,audiencia_fecha,audiencia_tipo';

// Construye una fila del CSV a partir de un objeto, en el orden de COLUMNAS.
function fila(campos) {
    return COLUMNAS.split(',').map(c => {
        const v = String(campos[c] == null ? '' : campos[c]);
        return /[",;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(',');
}

function csvCon(...filas) {
    return COLUMNAS + '\n' + filas.map(f => (typeof f === 'string' ? f : fila(f)) + '\n').join('');
}


// Ejecuta un bloque de pruebas aislado: si revienta, se anota como fallo y se
// sigue con los demás. Sin esto, una regresión que lance una excepción dejaba
// sin ejecutar todo lo que venía después y no se veía el alcance real.
async function bloque(nombre, fn) {
    try {
        await fn();
    } catch (e) {
        fallidas++;
        fallos.push(`${nombre}: la prueba reventó — ${e.message}`);
    }
}

// ==================== PRUEBAS ====================

async function main() {
    // ---------- 1. Generación del template ----------
    await bloque('1. Generación del template', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);
        await sandbox.descargarTemplateExpedientes();
        const csv = estado.csvGenerado;

        verificar('template: lleva BOM para que Excel lea UTF-8', csv.charCodeAt(0) === 0xFEFF);
        verificar('template: las tildes viajan intactas', csv.includes('Juan Pérez García'));
        igual('template: un solo encabezado con las 16 columnas',
            csv.split('\n').find(l => l.startsWith('expediente')), COLUMNAS);

        verificar('template: documenta el expediente', /EL EXPEDIENTE/.test(csv));
        verificar('template: documenta los pendientes', /PENDIENTE \(tarea del expediente\)/.test(csv));
        verificar('template: documenta las audiencias', /AUDIENCIA \/ FECHA DEL CALENDARIO/.test(csv));
        verificar('template: avisa de que el día va primero', /DÍA VA PRIMERO/.test(csv));
        verificar('template: dice que la institución se deduce', /se deduce del juzgado/.test(csv));

        // Los dos catálogos, en el mismo archivo
        const catalogoTSJ = Object.keys(vm.runInContext('JUZGADOS', sandbox))
            .concat(Object.keys(vm.runInContext('SALAS_SEGUNDA_INSTANCIA', sandbox)));
        igual(`template: están los ${catalogoTSJ.length} juzgados del TSJ`,
            catalogoTSJ.filter(j => !csv.includes('# ' + j)), []);

        const organos = vm.runInContext('pjfOrganismos', sandbox);
        verificar(`template: están los ${organos.length} órganos federales`,
            organos.every(o => csv.includes(`ID=${o.id} |`)),
            'falta al menos un órgano del catálogo federal');
        verificar('template: los órganos vienen agrupados por circuito', /---- CIRCUITO \d+:/.test(csv));
    });

    // ---------- 2. El template recién descargado no da de alta ejemplos ----------
    await bloque('2. El template recién descargado no da de alta ejemplos', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);
        await sandbox.descargarTemplateExpedientes();
        await importar(sandbox, estado, estado.csvGenerado);

        igual('ida y vuelta: no se importa ningún expediente de ejemplo', estado.expedientes.length, 0);
        igual('ida y vuelta: tampoco sus pendientes', estado.pendientes.length, 0);
        igual('ida y vuelta: tampoco sus audiencias', estado.eventos.length, 0);
        verificar('ida y vuelta: se informa que solo había ejemplos',
            /ejemplo/i.test(JSON.stringify(estado.informes)), JSON.stringify(estado.informes));
    });

    // ---------- 3. Enrutamiento: cada expediente a su sección ----------
    await bloque('3. Enrutamiento: cada expediente a su sección', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        await importar(sandbox, estado, csvCon(
            { expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' },
            { expediente: '9002/2025', juzgado: 'Juzgado Primero de Distrito en el Estado de Aguascalientes' },
            { expediente: '9003/2025', juzgado: '', organismo_id: '394' },
            { expediente: '9004/2025', juzgado: 'IMSS Subdelegación Cancún' },
            { expediente: '9005/2025', juzgado: 'SÉPTIMA SALA PENAL TRADICIONAL' }
        ));

        const porNumero = n => estado.expedientes.find(e => e.numero === n);
        igual('enrutar: juzgado del TSJ → sección TSJ', porNumero('9001/2025').institucion, 'TSJ');
        igual('enrutar: órgano federal por nombre → sección PJF', porNumero('9002/2025').institucion, 'PJF');
        igual('enrutar: solo con organismo_id → sección PJF', porNumero('9003/2025').institucion, 'PJF');
        igual('enrutar: autoridad desconocida → Otros/Varios', porNumero('9004/2025').institucion, 'OTRO');
        igual('enrutar: sala con tilde → sección TSJ', porNumero('9005/2025').institucion, 'TSJ');

        igual('enrutar: el órgano federal se guarda con su nombre del catálogo',
            porNumero('9002/2025').juzgado, 'Juzgado Primero de Distrito en el Estado de Aguascalientes');
        igual('enrutar: y con su id, para poder buscarlo en el portal',
            porNumero('9002/2025').pjfOrgId, '394');
        igual('enrutar: el id suelto también resuelve el nombre',
            porNumero('9003/2025').juzgado, 'Juzgado Primero de Distrito en el Estado de Aguascalientes');
        igual('enrutar: la sala se guarda sin tilde, como el catálogo',
            porNumero('9005/2025').juzgado, 'SEPTIMA SALA PENAL TRADICIONAL');
        igual('enrutar: la categoría del federal', porNumero('9002/2025').categoria, 'PJF Federal');
        igual('enrutar: la categoría del otro', porNumero('9004/2025').categoria, 'Otros/Varios');

        verificar('enrutar: el informe dice cuántos van a cada sección',
            /del TSJ/.test(JSON.stringify(estado.informes)) && /federales/.test(JSON.stringify(estado.informes)),
            JSON.stringify(estado.informes));

        // Declarar institucion=PJF: el nombre del órgano basta, sin id, y un
        // órgano que el catálogo aún no tenga se respeta como federal en vez
        // de acabar en "Otros/Varios".
        const { sandbox: sp, estado: ep } = crearEntorno();
        cargarCodigoReal(sp);
        await importar(sp, ep, csvCon(
            { expediente: '9101/2025', institucion: 'PJF',
              juzgado: 'Juzgado Primero de Distrito en el Estado de Aguascalientes' },
            { expediente: '9102/2025', institucion: 'PJF',
              juzgado: 'Juzgado Vigésimo de Distrito Inexistente de Prueba' }
        ));

        const porNum = n => ep.expedientes.find(e => e.numero === n);
        igual('enrutar: institucion=PJF con solo el nombre resuelve el id',
            porNum('9101/2025').pjfOrgId, '394');
        igual('enrutar: y queda en la sección federal', porNum('9101/2025').institucion, 'PJF');
        igual('enrutar: un órgano fuera del catálogo sigue siendo federal si se declara',
            porNum('9102/2025').institucion, 'PJF');
        igual('enrutar: conservando el nombre tal como se escribió',
            porNum('9102/2025').juzgado, 'Juzgado Vigésimo de Distrito Inexistente de Prueba');
        igual('enrutar: y sin inventarle un id', porNum('9102/2025').pjfOrgId, undefined);
    });

    // ---------- 4. Un dedazo en el juzgado no se archiva callando ----------
    await bloque('4. Un dedazo en el juzgado no se archiva callando', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        await importar(sandbox, estado, csvCon(
            { expediente: '9001/2025', juzgado: 'JUZGADO PRMERO CIVIL CANCUN' },
            { expediente: '9002/2025', juzgado: 'Notaría Pública 12 de Cancún' }
        ));

        igual('dedazo: el juzgado mal escrito no entra', estado.expedientes.length, 1);
        igual('dedazo: la autoridad legítima sí entra', estado.expedientes[0].numero, '9002/2025');
        const errores = estado.informes[0].errores;
        verificar('dedazo: se propone el juzgado correcto',
            errores.some(e => e.includes('quisiste decir "JUZGADO PRIMERO CIVIL CANCUN"')),
            JSON.stringify(errores));

        // Declarar la institución permite forzar el destino
        const { sandbox: s2, estado: e2 } = crearEntorno();
        cargarCodigoReal(s2);
        await importar(s2, e2, csvCon(
            { expediente: '9003/2025', institucion: 'OTRO', juzgado: 'Juzgado Municipal de Otro Estado' }
        ));
        igual('dedazo: con institucion=OTRO se respeta lo escrito', e2.expedientes.length, 1);
        igual('dedazo: y va a Otros/Varios', e2.expedientes[0].institucion, 'OTRO');
    });

    // ---------- 5. Fechas ----------
    await bloque('5. Fechas', async () => {
        const { sandbox } = crearEntorno();
        cargarCodigoReal(sandbox);
        const f = sandbox._fechaDesdeCSV;
        const dia = (v) => { const r = f(v); return r && r.iso ? new Date(r.iso).getDate() + '/' + (new Date(r.iso).getMonth() + 1) : r; };

        igual('fecha: dd/mm/aaaa', dia('15/03/2026'), '15/3');
        igual('fecha: dd-mm-aaaa', dia('15-03-2026'), '15/3');
        igual('fecha: ISO aaaa-mm-dd', dia('2026-03-15'), '15/3');
        igual('fecha: año de dos cifras', dia('15/3/26'), '15/3');
        igual('fecha: "15 de marzo de 2026"', dia('15 de marzo de 2026'), '15/3');
        igual('fecha: el día va primero, no el mes', dia('03/04/2026'), '3/4');

        const conHora = f('15/03/2026 09:30');
        igual('fecha: con hora no es de todo el día', conHora.todoElDia, false);
        igual('fecha: la hora se respeta', new Date(conHora.iso).getHours(), 9);
        igual('fecha: pm se convierte a 24h', new Date(f('15/03/2026 2:00 pm').iso).getHours(), 14);
        igual('fecha: sin hora es de todo el día', f('15/03/2026').todoElDia, true);

        igual('fecha: celda vacía no es error', f(''), null);
        verificar('fecha: el 31 de febrero se rechaza', !!(f('31/02/2026') || {}).error);
        verificar('fecha: mes 13 se rechaza', !!(f('13/13/2026') || {}).error);
        verificar('fecha: texto libre se rechaza', !!(f('la próxima semana') || {}).error);
    });

    // ---------- 6. Pendientes y su reflejo en el calendario ----------
    await bloque('6. Pendientes y su reflejo en el calendario', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        await importar(sandbox, estado, csvCon(
            {
                expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                pendiente: 'Contestar la demanda', pendiente_fecha: '15/03/2026', pendiente_prioridad: 'alta'
            },
            {
                expediente: '9002/2025', juzgado: 'JUZGADO ORAL CIVIL CANCUN',
                pendiente: 'Revisar acuerdo'   // sin fecha
            }
        ));

        igual('pendientes: se crean los dos', estado.pendientes.length, 2);
        const conFecha = estado.pendientes.find(p => p.titulo === 'Contestar la demanda');
        const sinFecha = estado.pendientes.find(p => p.titulo === 'Revisar acuerdo');

        igual('pendientes: la prioridad se guarda', conFecha.prioridad, 'alta');
        igual('pendientes: queda ligado a su expediente',
            conFecha.expedienteId, estado.expedientes.find(e => e.numero === '9001/2025').id);
        verificar('pendientes: el que tiene fecha llega al calendario', !!conFecha.eventoId);
        igual('pendientes: el que no tiene fecha no ocupa el calendario', sinFecha.eventoId, null);
        igual('pendientes: solo un evento en el calendario', estado.eventos.length, 1);

        const evento = estado.eventos[0];
        igual('pendientes: el evento apunta de vuelta al pendiente', evento.pendienteId, conFecha.id);
        igual('pendientes: el evento cae en la fecha límite', new Date(evento.fechaInicio).getDate(), 15);
    });

    // ---------- 7. Audiencias ----------
    await bloque('7. Audiencias', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        await importar(sandbox, estado, csvCon(
            {
                expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                audiencia: 'Audiencia preliminar', audiencia_fecha: '02/04/2026 09:30', audiencia_tipo: 'audiencia'
            },
            {
                expediente: '9002/2025', juzgado: 'JUZGADO ORAL CIVIL CANCUN',
                audiencia: 'Vence el plazo', audiencia_fecha: '10/03/2026', audiencia_tipo: 'vencimiento'
            }
        ));

        igual('audiencias: se agendan las dos', estado.eventos.length, 2);
        const audiencia = estado.eventos.find(e => e.titulo === 'Audiencia preliminar');
        const vencimiento = estado.eventos.find(e => e.titulo === 'Vence el plazo');

        igual('audiencias: el tipo se respeta', audiencia.tipo, 'audiencia');
        igual('audiencias: el vencimiento también', vencimiento.tipo, 'vencimiento');
        igual('audiencias: la hora se agenda', new Date(audiencia.fechaInicio).getHours(), 9);
        igual('audiencias: con hora no es de todo el día', audiencia.todoElDia, false);
        igual('audiencias: sin hora es de todo el día', vencimiento.todoElDia, true);
        igual('audiencias: queda ligada a su expediente',
            audiencia.expedienteId, estado.expedientes.find(e => e.numero === '9001/2025').id);
        igual('audiencias: el color lo pone el núcleo según el tipo', audiencia.color, '#3788d8');
    });

    // ---------- 8. Varias filas del mismo expediente ----------
    await bloque('8. Varias filas del mismo expediente', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        await importar(sandbox, estado, csvCon(
            { expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', pendiente: 'Contestar' },
            { expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', pendiente: 'Ofrecer pruebas' },
            { expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', audiencia: 'Audiencia', audiencia_fecha: '02/04/2026' }
        ));

        igual('repetir fila: el expediente se crea una sola vez', estado.expedientes.length, 1);
        igual('repetir fila: se acumulan sus dos pendientes', estado.pendientes.length, 2);
        igual('repetir fila: y su audiencia', estado.eventos.length, 1);
        igual('repetir fila: todo cuelga del mismo expediente',
            [...new Set(estado.pendientes.map(p => p.expedienteId).concat(estado.eventos.map(e => e.expedienteId)))],
            [estado.expedientes[0].id]);
    });

    // ---------- 9. Añadir pendientes a expedientes ya registrados ----------
    await bloque('9. Añadir pendientes a expedientes ya registrados', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        await importar(sandbox, estado, csvCon(
            { expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' }));
        const idOriginal = estado.expedientes[0].id;

        await importar(sandbox, estado, csvCon(
            { expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
              pendiente: 'Nuevo pendiente', pendiente_fecha: '15/03/2026' }));

        igual('ya registrado: no se duplica el expediente', estado.expedientes.length, 1);
        igual('ya registrado: el pendiente sí se agrega', estado.pendientes.length, 1);
        igual('ya registrado: y cuelga del expediente que ya existía',
            estado.pendientes[0].expedienteId, idOriginal);
        verificar('ya registrado: se explica en el informe',
            /ya existían/.test(JSON.stringify(estado.informes)), JSON.stringify(estado.informes));

        // Repetir sin aportar nada nuevo sí es un duplicado a secas
        await importar(sandbox, estado, csvCon(
            { expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' }));
        igual('ya registrado: repetir sin extras no cambia nada', estado.expedientes.length, 1);
        igual('ya registrado: ni crea pendientes de más', estado.pendientes.length, 1);
    });

    // ---------- 10. Información que antes no se podía cargar ----------
    await bloque('10. Información que antes no se podía cargar', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        await importar(sandbox, estado, csvCon({
            expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
            actor: 'Comercializadora del Caribe SA de CV', demandado: 'Juan Pérez García',
            carpeta: 'Caso Caribe', comentario: 'Contrato de arrendamiento'
        }));

        const exp = estado.expedientes[0];
        igual('campos nuevos: se guarda el actor', exp.actor, 'Comercializadora del Caribe SA de CV');
        igual('campos nuevos: se guarda el demandado', exp.demandado, 'Juan Pérez García');
        igual('campos nuevos: se guarda el comentario', exp.comentario, 'Contrato de arrendamiento');
        igual('campos nuevos: la carpeta se crea', estado.carpetas.map(c => c.nombre), ['Caso Caribe']);
        igual('campos nuevos: y el expediente queda dentro', exp.carpetaId, estado.carpetas[0].id);
    });

    // ---------- 11. Errores por fila ----------
    await bloque('11. Errores por fila', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        await importar(sandbox, estado, csvCon(
            { expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', comentario: 'buena' },
            { expediente: '', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', comentario: 'sin expediente' },
            { expediente: '9003/2025', juzgado: '' },
            { expediente: '9004/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', tipo: 'azul' },
            { expediente: '9005/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
              pendiente: 'Con fecha rota', pendiente_fecha: '99/99/9999' },
            { expediente: '9006/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
              audiencia: 'Sin fecha' }
        ));

        const informe = estado.informes[0];
        verificar('errores: se muestra un informe', !!informe, JSON.stringify(estado.informes));
        const txt = JSON.stringify(informe.errores);

        verificar('errores: se cita el número de fila', /Fila 3/.test(txt), txt);
        verificar('errores: falta el expediente', /falta el expediente/.test(txt), txt);
        verificar('errores: falta el juzgado', /falta el juzgado/.test(txt), txt);
        verificar('errores: tipo inválido', /tipo inválido/.test(txt), txt);
        verificar('errores: la fecha rota del pendiente se avisa', /sin fecha/.test(txt), txt);
        verificar('errores: la audiencia sin fecha se avisa', /necesita fecha/.test(txt), txt);

        // Un dato malo no debe tumbar el expediente entero
        igual('errores: el pendiente con fecha rota se crea igual, sin fecha',
            estado.pendientes.filter(p => p.titulo === 'Con fecha rota').length, 1);
        igual('errores: y no ocupa el calendario',
            estado.pendientes.find(p => p.titulo === 'Con fecha rota').eventoId, null);
        igual('errores: entran los 3 expedientes válidos', estado.expedientes.length, 3);
        igual('errores: y son los que se esperaba',
            estado.expedientes.map(e => e.numero), ['9001/2025', '9005/2025', '9006/2025']);
    });

    // ---------- 12. Compatibilidad con los templates anteriores ----------
    await bloque('12. Compatibilidad con los templates anteriores', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        // Template TSJ viejo
        await importar(sandbox, estado,
            'expediente,tipo,juzgado,comentario\n1111/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,viejo TSJ\n');
        igual('compatibilidad: se importa el template TSJ anterior', estado.expedientes.length, 1);
        igual('compatibilidad: y va a la sección TSJ', estado.expedientes[0].institucion, 'TSJ');

        // Template PJF viejo (columna "organo", sin "juzgado")
        await importar(sandbox, estado,
            'expediente,organo,organismo_id,tipo_asunto_id,comentario\n' +
            '67/2021,"Juzgado Primero de Distrito en el Estado de Aguascalientes",394,1,viejo PJF\n');
        igual('compatibilidad: se importa el template PJF anterior', estado.expedientes.length, 2);
        const federal = estado.expedientes[1];
        igual('compatibilidad: y va a la sección federal', federal.institucion, 'PJF');
        igual('compatibilidad: conserva el organismo_id', federal.pjfOrgId, '394');
        igual('compatibilidad: y el tipo de asunto', federal.pjfTipoAsunto, '1');
    });

    // ---------- 13. Lo que Excel produce ----------
    await bloque('13. Lo que Excel produce', async () => {
        const { sandbox } = crearEntorno();
        cargarCodigoReal(sandbox);
        const base = 'expediente,juzgado,comentario\n1234/2025,JUZGADO PRIMERO CIVIL CANCUN,ok\n';
        const esperado = [{ expediente: '1234/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', comentario: 'ok' }];

        igual('parser: CSV limpio', sandbox.parseCSV(base), esperado);
        igual('parser: BOM de Excel', sandbox.parseCSV('﻿' + base), esperado);
        igual('parser: saltos CRLF', sandbox.parseCSV(base.replace(/\n/g, '\r\n')), esperado);
        igual('parser: separador punto y coma', sandbox.parseCSV(base.replace(/,/g, ';')), esperado);
        igual('parser: comillas escapadas',
            sandbox.parseCSV('expediente,juzgado,comentario\n1/25,JUZGADO CIVIL COZUMEL,"dijo ""hola"", y se fue"\n')[0].comentario,
            'dijo "hola", y se fue');
        igual('parser: sin filas de datos', sandbox.parseCSV('expediente,juzgado\n'), []);

        let err = null;
        try { sandbox.parseCSV('cuenta,importe\n1,2\n'); } catch (e) { err = e.message; }
        verificar('parser: avisa si el archivo no es el template', /Falta la columna/.test(err || ''), String(err));
    });

    // ---------- 14. Límite del plan gratuito ----------
    await bloque('14. Límite del plan gratuito', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);
        sandbox.estadoPremium = { activo: false, codigo: '' };
        const limite = vm.runInContext('PREMIUM_CONFIG.limiteExpedientes', sandbox);

        const filas = [];
        for (let i = 1; i <= limite + 5; i++) {
            filas.push({ expediente: `90${String(i).padStart(2, '0')}/2025`, juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' });
        }
        await importar(sandbox, estado, csvCon(...filas));

        igual(`plan gratuito: no se pasa del límite de ${limite}`, estado.expedientes.length, limite);
        verificar('plan gratuito: se avisa antes de importar',
            /CUENTA GRATUITA/.test(estado.confirmaciones.join('\n')), estado.confirmaciones.join('\n'));

        // Sin cupo: se explica el límite en vez de preguntar "¿importar 0?"
        estado.limitesMostrados = [];
        await importar(sandbox, estado, csvCon(
            { expediente: '9999/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' }));
        igual('sin cupo: no se importa nada más', estado.expedientes.length, limite);
        igual('sin cupo: se muestra el modal de límite', estado.limitesMostrados, ['expedientes']);

        // Aun sin cupo para expedientes nuevos, los pendientes de los que ya
        // están registrados sí deben entrar: no cuestan un expediente más.
        estado.limitesMostrados = [];
        const yaRegistrado = estado.expedientes[0];
        await importar(sandbox, estado, csvCon(
            { expediente: yaRegistrado.numero, juzgado: yaRegistrado.juzgado,
              pendiente: 'Cabe aunque no haya cupo', pendiente_fecha: '15/03/2026' }));

        igual('sin cupo: el pendiente de un expediente ya registrado sí entra',
            estado.pendientes.filter(p => p.titulo === 'Cabe aunque no haya cupo').length, 1);
        igual('sin cupo: sin crear expedientes de más', estado.expedientes.length, limite);
        igual('sin cupo: y sin apilar el modal de límite sobre la confirmación',
            estado.limitesMostrados, []);
    });

    // ---------- 15. Cancelar y archivos de Excel ----------
    await bloque('15. Cancelar y archivos de Excel', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        await importar(sandbox, estado,
            csvCon({ expediente: '9001/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                     pendiente: 'No debería crearse', pendiente_fecha: '15/03/2026' }),
            { confirmar: false });
        igual('cancelar: no se guarda el expediente', estado.expedientes.length, 0);
        igual('cancelar: ni el pendiente', estado.pendientes.length, 0);
        igual('cancelar: ni el evento', estado.eventos.length, 0);

        await importar(sandbox, estado, 'da igual', { nombreArchivo: 'expedientes.xlsx' });
        igual('excel: no se guarda nada', estado.expedientes.length, 0);
        verificar('excel: se explica cómo convertirlo',
            estado.toasts.some(t => /CSV UTF-8/.test(t.mensaje)), JSON.stringify(estado.toasts));
    });

    // ---------- 16. Caso real: el despacho entero en un archivo ----------
    await bloque('16. Caso real: el despacho entero en un archivo', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);
        await sandbox.descargarTemplateExpedientes();

        // Simula Excel: conserva comentarios y ejemplos, añade filas propias
        const propias = [
            fila({ expediente: '7777/2025', juzgado: 'Juzgado Segundo Mercantil Cancún',
                   actor: 'ACME SA', demandado: 'Beta SA', carpeta: 'Cliente ACME',
                   pendiente: 'Presentar alegatos', pendiente_fecha: '20/03/2026', pendiente_prioridad: 'alta' }),
            fila({ expediente: '888/2025', juzgado: 'Juzgado Segundo de Distrito en el Estado de Aguascalientes',
                   tipo_asunto_id: '1', carpeta: 'Cliente ACME',
                   audiencia: 'Audiencia constitucional', audiencia_fecha: '05/04/2026 10:00' }),
            fila({ expediente: 'REC-55/2025', juzgado: 'SAT Administración Desconcentrada Cancún',
                   comentario: 'Recurso de revocación' })
        ].join('\n') + '\n';

        const conFilasPropias = estado.csvGenerado.replace(
            new RegExp('^(' + COLUMNAS + '\\n(?:.*\\n){5})', 'm'), '$1' + propias);

        await importar(sandbox, estado, conFilasPropias);

        igual('caso real: entran las 3 filas propias y ninguna de ejemplo', estado.expedientes.length, 3);
        igual('caso real: cada una en su sección',
            estado.expedientes.map(e => e.institucion).sort(), ['OTRO', 'PJF', 'TSJ']);
        igual('caso real: el juzgado con tilde se normaliza',
            estado.expedientes.find(e => e.numero === '7777/2025').juzgado, 'JUZGADO SEGUNDO MERCANTIL CANCUN');
        igual('caso real: se crea una sola carpeta compartida',
            estado.carpetas.map(c => c.nombre), ['Cliente ACME']);
        igual('caso real: el pendiente se crea', estado.pendientes.length, 1);
        igual('caso real: y llegan 2 fechas al calendario (pendiente + audiencia)', estado.eventos.length, 2);
        igual('caso real: se sincroniza con los otros dispositivos',
            estado.sincronizaciones > 0, true);
    });

    // ---------- 17. Una importación = una sola subida a la nube ----------
    await bloque('17. Una importación = una sola subida', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        // 30 asuntos, cada uno con su pendiente y su audiencia. Como el
        // pendiente con fecha genera además su evento, son 120 objetos.
        const filas = [];
        for (let i = 1; i <= 30; i++) {
            filas.push({
                expediente: `90${String(i).padStart(2, '0')}/2025`,
                juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                pendiente: `Contestar ${i}`, pendiente_fecha: '15/03/2026', pendiente_prioridad: 'alta',
                audiencia: `Audiencia ${i}`, audiencia_fecha: '02/04/2026 09:30', audiencia_tipo: 'audiencia'
            });
        }
        await importar(sandbox, estado, csvCon(...filas));

        igual('lote: se crean los 30 expedientes', estado.expedientes.length, 30);
        igual('lote: y sus 30 pendientes', estado.pendientes.length, 30);
        igual('lote: y sus 60 eventos (audiencia + reflejo del pendiente)', estado.eventos.length, 60);

        // Lo que importa: cada crearPendienteCore y cada crearEventoCore
        // sincroniza al terminar. Sin agrupar toda la importación en un lote,
        // esto eran 61 subidas seguidas; con la red caída, cada una gasta 14 s
        // en reintentos y la app se queda minutos en una tormenta de errores.
        igual('lote: toda la importación sube a la nube UNA sola vez',
            estado.sincronizaciones, 1);
    });

    // ---------- 18. Los números del informe cuadran con el archivo ----------
    await bloque('18. Los números cuadran con el archivo', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        // 10 expedientes distintos + 4 filas que repiten alguno de ellos
        const filas = [];
        for (let i = 1; i <= 10; i++) {
            filas.push({ expediente: `${i}/2025`, juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' });
        }
        for (let i = 1; i <= 4; i++) {
            filas.push({ expediente: `${i}/2025`, juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
                         pendiente: `Tarea extra ${i}` });
        }
        await importar(sandbox, estado, csvCon(...filas));

        igual('cuadrar: se crean 10 expedientes, no 14', estado.expedientes.length, 10);
        igual('cuadrar: las 4 filas repetidas aportan sus pendientes', estado.pendientes.length, 4);

        const informe = JSON.stringify(estado.informes[0]);
        verificar('cuadrar: el informe dice cuántas filas traía el archivo',
            /14 filas de datos/.test(informe), informe);
        verificar('cuadrar: y explica las 4 que se fusionaron',
            /4 filas repetían un expediente/.test(informe), informe);
        verificar('cuadrar: la confirmación también lo avisa antes de importar',
            /14 filas/.test(estado.confirmaciones[0] || ''), estado.confirmaciones[0]);
    });

    // ---------- 19. Los archivados cuentan como ya registrados ----------
    await bloque('19. Los archivados cuentan como ya registrados', async () => {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        const fila = { expediente: '555/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' };
        await importar(sandbox, estado, csvCon(fila));
        igual('archivados: se crea la primera vez', estado.expedientes.length, 1);

        const id = estado.expedientes[0].id;
        estado.expedientes[0].archivado = true;      // el usuario lo archiva

        await importar(sandbox, estado, csvCon(fila));
        igual('archivados: reimportarlo NO lo duplica', estado.expedientes.length, 1);
        verificar('archivados: el informe explica que está en el archivo',
            /archivados/i.test(JSON.stringify(estado.informes)), JSON.stringify(estado.informes));

        // Y sus pendientes deben colgar del expediente archivado, no de uno nuevo
        await importar(sandbox, estado, csvCon(
            { ...fila, pendiente: 'Algo por hacer', pendiente_fecha: '15/03/2026' }));
        igual('archivados: sigue sin duplicarse', estado.expedientes.length, 1);
        igual('archivados: el pendiente cuelga del expediente que ya existía',
            estado.pendientes[0].expedienteId, id);
    });

    // ==================== RESULTADO ====================
    console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas\n`);
    if (fallidas > 0) {
        console.log('FALLOS:');
        fallos.forEach(f => console.log('  ✗ ' + f));
        process.exit(1);
    }
    console.log('✓ El template único y la importación funcionan correctamente.');
}

main().catch(e => { console.error(e); process.exit(1); });
