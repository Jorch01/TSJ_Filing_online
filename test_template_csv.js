#!/usr/bin/env node
/**
 * Pruebas del ciclo completo del template de expedientes TSJ:
 *
 *     descargarTemplateCSV()  ->  el usuario lo edita en Excel  ->  importarExpedientesCSV()
 *
 * Corre sin dependencias:  node test_template_csv.js
 *
 * El código real de docs/js/ se carga tal cual (no se copia aquí), así que si
 * alguien cambia el template o el parser sin ajustar la importación, esto falla.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, 'docs', 'js');

// ==================== ENTORNO SIMULADO ====================
// Navegador mínimo + una "base de datos" en memoria, para poder ejecutar la
// importación de principio a fin sin IndexedDB ni DOM reales.

function crearEntorno() {
    const estado = {
        expedientes: [],
        carpetas: [],
        siguienteId: 1,
        toasts: [],
        informes: [],
        confirmaciones: [],
        respuestaConfirm: true,
        csvGenerado: null
    };

    const sandbox = {
        console,
        estado,

        // --- DOM mínimo ---
        document: {
            getElementById: () => ({ set textContent(v) {}, set innerHTML(v) {}, value: '', style: {} }),
            createElement: () => ({ click() {}, set href(v) {}, set download(v) {}, innerHTML: '', set textContent(v) { this.innerHTML = String(v); } }),
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener: () => {}
        },
        Blob: class { constructor(partes) { estado.csvGenerado = partes.join(''); } },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
        Logger: { log: () => {}, warn: () => {}, error: () => {} },

        confirm: (mensaje) => { estado.confirmaciones.push(mensaje); return estado.respuestaConfirm; },
        mostrarToast: (mensaje, tipo) => { estado.toasts.push({ tipo, mensaje }); },
        abrirModal: () => {},
        cerrarModal: () => {},
        mostrarModalLimite: () => {},
        escapeText: (t) => String(t == null ? '' : t),

        // --- Capa de datos simulada (misma firma que docs/js/database.js) ---
        agregarExpediente: async (exp) => {
            const id = estado.siguienteId++;
            estado.expedientes.push({ ...exp, id, activo: true });
            return id;
        },
        obtenerExpedientes: async () => estado.expedientes.filter(e => e.activo !== false && !e.archivado),
        obtenerCarpetas: async () => estado.carpetas.slice(),
        agregarCarpeta: async (carpeta) => {
            const id = estado.siguienteId++;
            estado.carpetas.push({ ...carpeta, id });
            return id;
        },
        registrarCambioExpediente: async () => {},

        // --- Ganchos de UI/sync que el núcleo llama con guardas typeof ---
        cargarExpedientes: async () => { estado.refrescosUI = (estado.refrescosUI || 0) + 1; },
        marcarYSincronizar: async () => { estado.sincronizaciones = (estado.sincronizaciones || 0) + 1; },
        cargarCarpetasUI: async () => {},

        // --- Estado de plan ---
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
        '|^(?:const|let)\\s+' + nombre + '\\s*=');

    const inicio = lineas.findIndex(l => patron.test(l));
    if (inicio === -1) throw new Error(`No se encontró "${nombre}" en ${archivo} (¿se renombró?)`);

    // Declaración de una sola línea (p. ej. un const con un array corto)
    if (/;\s*$/.test(lineas[inicio])) return lineas[inicio];

    for (let i = inicio + 1; i < lineas.length; i++) {
        if (/^[}\])]/.test(lineas[i])) return lineas.slice(inicio, i + 1).join('\n');
    }
    throw new Error(`Declaración incompleta de "${nombre}" en ${archivo}`);
}

const NECESARIO_DE_APP = [
    'PREMIUM_CONFIG',
    'TEMPLATE_TSJ_EJEMPLOS', 'TEMPLATE_TSJ_COLUMNAS', '_csvCampo', 'descargarTemplateCSV',
    '_quitarBOM', '_detectarSeparador', '_lineasUtilesCSV', 'parseCSV', 'parseCSVLine',
    '_normalizarValorCSV', '_TIPOS_CSV_NUMERO', '_TIPOS_CSV_NOMBRE', '_tipoBusquedaDesdeCSV',
    '_esFilaEjemploTemplate', '_claveExpediente', '_claveNombreCarpetaLocal',
    '_resolverCarpetasDeImportacion', '_aplicarLimitePlanAImportacion',
    'mostrarInformeImportacion', 'importarExpedientesCSV'
];

function cargarCodigoReal(sandbox) {
    // juzgados.js y acciones-core.js se cargan completos: no tienen efectos
    // secundarios al evaluarse.
    for (const archivo of ['juzgados.js', 'acciones-core.js']) {
        vm.runInContext(fs.readFileSync(path.join(JS, archivo), 'utf8'), sandbox, { filename: archivo });
    }

    // De app.js solo el subsistema del template (el resto arrastraría media app).
    const app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    for (const nombre of NECESARIO_DE_APP) {
        vm.runInContext(extraerDeclaracion(app, nombre, 'app.js'), sandbox, { filename: `app.js:${nombre}` });
    }

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

// Ejecuta la importación con el contenido CSV dado.
async function importar(sandbox, estado, csv, opciones = {}) {
    estado.toasts = [];
    estado.informes = [];
    estado.confirmaciones = [];
    estado.respuestaConfirm = opciones.confirmar !== false;

    const evento = {
        target: {
            value: 'x',
            files: [{
                name: opciones.nombreArchivo || 'expedientes.csv',
                text: async () => csv
            }]
        }
    };
    await sandbox.importarExpedientesCSV(evento);
    return {
        expedientes: estado.expedientes,
        carpetas: estado.carpetas,
        toasts: estado.toasts,
        informes: estado.informes,
        confirmaciones: estado.confirmaciones
    };
}

function encabezadoYFilas(...filas) {
    return 'expediente,tipo,juzgado,carpeta,comentario\n' + filas.map(f => f + '\n').join('');
}

// ==================== PRUEBAS ====================

async function main() {
    // ---------- 1. Generación del template ----------
    {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);
        sandbox.descargarTemplateCSV();
        const csv = estado.csvGenerado;

        verificar('template: lleva BOM para que Excel lea UTF-8', csv.charCodeAt(0) === 0xFEFF);
        verificar('template: las tildes viajan intactas', csv.includes('Juan Pérez García'));
        verificar('template: documenta las columnas', /# COLUMNAS:/.test(csv));
        verificar('template: avisa de las filas de ejemplo', /filas de ejemplo/i.test(csv));
        verificar('template: indica cómo guardar desde Excel', /CSV UTF-8/.test(csv));

        const encabezado = csv.split('\n').find(l => l.startsWith('expediente'));
        igual('template: encabezado con las 5 columnas', encabezado, 'expediente,tipo,juzgado,carpeta,comentario');

        // Todo juzgado del catálogo aparece en la referencia
        const catalogo = vm.runInContext(
            'Object.keys(JUZGADOS).concat(Object.keys(SALAS_SEGUNDA_INSTANCIA))', sandbox);
        const ausentes = catalogo.filter(j => !csv.includes('# ' + j));
        igual(`template: los ${catalogo.length} juzgados del catálogo están listados`, ausentes, []);

        // ... y todo lo listado se puede resolver de vuelta
        const listados = csv.split('\n')
            .filter(l => /^# (JUZGADO|TRIBUNAL|PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|SEPTIMA|OCTAVA|NOVENA|DECIMA|SALA)/.test(l))
            .map(l => l.slice(2).trim());
        const irresolubles = listados.filter(j => !sandbox.resolverJuzgadoTSJ(j));
        igual('template: cada juzgado listado se resuelve al importar', irresolubles, []);
        verificar('template: la lista no está vacía', listados.length === catalogo.length,
            `listados ${listados.length}, catálogo ${catalogo.length}`);
    }

    // ---------- 2. El template recién descargado se importa sin dar de alta ejemplos ----------
    {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);
        sandbox.descargarTemplateCSV();
        const r = await importar(sandbox, estado, estado.csvGenerado);

        igual('ida y vuelta: no se importa ningún expediente de ejemplo', r.expedientes.length, 0);
        verificar('ida y vuelta: se informa que solo había ejemplos',
            r.informes.length === 1 && /ejemplo/i.test(JSON.stringify(r.informes[0])),
            JSON.stringify(r.informes));
    }

    // ---------- 3. Tolerancia del parser a lo que produce Excel ----------
    {
        const { sandbox } = crearEntorno();
        cargarCodigoReal(sandbox);

        const base = 'expediente,tipo,juzgado,comentario\n1234/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,ok\n';
        const esperado = [{ expediente: '1234/2025', tipo: 'numero', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', comentario: 'ok' }];

        igual('parser: CSV limpio', sandbox.parseCSV(base), esperado);
        igual('parser: BOM de Excel', sandbox.parseCSV('﻿' + base), esperado);
        igual('parser: saltos de línea CRLF', sandbox.parseCSV(base.replace(/\n/g, '\r\n')), esperado);
        igual('parser: separador punto y coma', sandbox.parseCSV(base.replace(/,/g, ';')), esperado);

        igual('parser: comillas escapadas ("")',
            sandbox.parseCSV('expediente,juzgado,comentario\n1/25,JUZGADO CIVIL COZUMEL,"dijo ""hola"", y se fue"\n')[0].comentario,
            'dijo "hola", y se fue');

        igual('parser: comas dentro de comillas no parten el campo',
            sandbox.parseCSV('expediente,juzgado,comentario\n1/25,JUZGADO CIVIL COZUMEL,"Actor: Ruiz, Ana"\n')[0].comentario,
            'Actor: Ruiz, Ana');

        igual('parser: archivo sin filas de datos', sandbox.parseCSV('expediente,tipo,juzgado\n'), []);

        let error = null;
        try { sandbox.parseCSV('foo,bar\n1,2\n'); } catch (e) { error = e.message; }
        verificar('parser: avisa de columnas faltantes', /Faltan columnas requeridas/.test(error || ''), String(error));
    }

    // ---------- 4. Resolución de juzgados ----------
    {
        const { sandbox } = crearEntorno();
        cargarCodigoReal(sandbox);
        const r = sandbox.resolverJuzgadoTSJ;

        igual('juzgado: nombre exacto', r('JUZGADO PRIMERO CIVIL CANCUN'), 'JUZGADO PRIMERO CIVIL CANCUN');
        igual('juzgado: con tilde ("CANCÚN")', r('JUZGADO PRIMERO CIVIL CANCÚN'), 'JUZGADO PRIMERO CIVIL CANCUN');
        igual('juzgado: en minúsculas', r('juzgado primero civil cancun'), 'JUZGADO PRIMERO CIVIL CANCUN');
        igual('juzgado: capitalizado con tilde', r('Juzgado Primero Civil Cancún'), 'JUZGADO PRIMERO CIVIL CANCUN');
        igual('juzgado: espacios de más', r('JUZGADO  PRIMERO   CIVIL  CANCUN '), 'JUZGADO PRIMERO CIVIL CANCUN');
        igual('juzgado: sala con tilde ("SÉPTIMA")', r('SÉPTIMA SALA PENAL TRADICIONAL'), 'SEPTIMA SALA PENAL TRADICIONAL');
        igual('juzgado: sala con tilde ("DÉCIMA")', r('DÉCIMA SALA CIVIL MERCANTIL Y FAMILIAR PLAYA'), 'DECIMA SALA CIVIL MERCANTIL Y FAMILIAR PLAYA');
        igual('juzgado: prefijo exacto no se confunde con el "ORAL"', r('JUZGADO CIVIL CHETUMAL'), 'JUZGADO CIVIL CHETUMAL');
        igual('juzgado: ambiguo no se adivina', r('SALA'), null);
        igual('juzgado: inexistente', r('JUZGADO QUE NO EXISTE'), null);
        igual('juzgado: vacío', r(''), null);
    }

    // ---------- 5. Columna "tipo" ----------
    {
        const { sandbox } = crearEntorno();
        cargarCodigoReal(sandbox);
        const t = sandbox._tipoBusquedaDesdeCSV;

        igual('tipo: "numero"', t('numero', '1/25'), 'numero');
        igual('tipo: "NÚMERO" con tilde', t('NÚMERO', '1/25'), 'numero');
        igual('tipo: "Número" capitalizado', t('Número', '1/25'), 'numero');
        igual('tipo: "nombre"', t('nombre', 'Ana Ruiz'), 'nombre');
        igual('tipo: sinónimo "actor"', t('actor', 'Ana Ruiz'), 'nombre');
        igual('tipo: sinónimo "demandado"', t('demandado', 'Ana Ruiz'), 'nombre');
        igual('tipo: vacío se deduce de un número', t('', '1234/2025'), 'numero');
        igual('tipo: vacío se deduce de un nombre', t('', 'Juan Pérez'), 'nombre');
        igual('tipo: columna ausente se deduce', t(undefined, '1234/2025'), 'numero');
        igual('tipo: valor sin sentido se rechaza', t('azul', '1/25'), null);
    }

    // ---------- 6. Importación normal ----------
    {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        const r = await importar(sandbox, estado, encabezadoYFilas(
            '9001/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,,Primero',
            'Ana Ruiz Solís,nombre,JUZGADO FAMILIAR ORAL PLAYA,,Segundo',
            '9003/2025,,SÉPTIMA SALA PENAL TRADICIONAL,,Tercero con tilde y sin tipo'
        ));

        igual('importar: se dan de alta las 3 filas', r.expedientes.length, 3);
        igual('importar: el número va en "numero"', r.expedientes[0].numero, '9001/2025');
        igual('importar: el nombre va en "nombre"', r.expedientes[1].nombre, 'Ana Ruiz Solís');
        igual('importar: se guarda el nombre canónico del juzgado',
            r.expedientes[2].juzgado, 'SEPTIMA SALA PENAL TRADICIONAL');
        igual('importar: se marca la institución TSJ',
            r.expedientes.map(e => e.institucion), ['TSJ', 'TSJ', 'TSJ']);
        igual('importar: se calcula la categoría',
            r.expedientes[0].categoria, 'CANCÚN - Civil');
        igual('importar: se conserva el comentario', r.expedientes[0].comentario, 'Primero');
        verificar('importar: se sincroniza con los otros dispositivos', estado.sincronizaciones >= 1);
        igual('importar: se sincroniza UNA vez, no una por fila', estado.sincronizaciones, 1);

        // Lo guardado debe servir para buscar en estrados
        const url = sandbox.construirUrlBusqueda(r.expedientes[0].juzgado, 'numero', r.expedientes[0].numero);
        verificar('importar: el expediente importado se puede buscar en estrados',
            typeof url === 'string' && url.includes('buscador_primera.php'), String(url));
        const urlSala = sandbox.construirUrlBusqueda(r.expedientes[2].juzgado, 'numero', '9003/2025');
        verificar('importar: la sala importada usa el buscador de segunda instancia',
            typeof urlSala === 'string' && urlSala.includes('buscador_segunda.php'), String(urlSala));
    }

    // ---------- 7. Duplicados ----------
    {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        const fila = '9001/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,,x';
        await importar(sandbox, estado, encabezadoYFilas(fila));
        const r = await importar(sandbox, estado, encabezadoYFilas(fila));

        igual('duplicados: importar dos veces no duplica', r.expedientes.length, 1);
        verificar('duplicados: se informa al usuario',
            r.informes.length === 1 && /ya estaban registrados/i.test(JSON.stringify(r.informes[0])),
            JSON.stringify(r.informes));

        // Repetido dentro del mismo archivo
        const { sandbox: s2, estado: e2 } = crearEntorno();
        cargarCodigoReal(s2);
        const r2 = await importar(s2, e2, encabezadoYFilas(fila, fila, fila));
        igual('duplicados: filas repetidas en el mismo archivo se colapsan', r2.expedientes.length, 1);
    }

    // ---------- 8. Filas inválidas ----------
    {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        const r = await importar(sandbox, estado, encabezadoYFilas(
            '9001/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,,válida',
            ',numero,JUZGADO PRIMERO CIVIL CANCUN,,sin expediente',
            '9002/2025,numero,JUZGADO INVENTADO DE NARNIA,,juzgado falso',
            '9003/2025,azul,JUZGADO PRIMERO CIVIL CANCUN,,tipo raro',
            '9004/2025,numero,,,sin juzgado'
        ));

        igual('inválidas: solo entra la fila buena', r.expedientes.length, 1);
        const informe = r.informes[0];
        verificar('inválidas: se muestra un informe', !!informe, JSON.stringify(r.informes));
        igual('inválidas: se listan los 4 errores', informe.errores.length, 4);
        verificar('inválidas: el error cita el número de fila real',
            informe.errores.some(e => /Fila 3/.test(e)), JSON.stringify(informe.errores));
        verificar('inválidas: el error dice qué juzgado no se reconoció',
            informe.errores.some(e => /JUZGADO INVENTADO DE NARNIA/.test(e)), JSON.stringify(informe.errores));
    }

    // ---------- 9. Carpetas ----------
    {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        const r = await importar(sandbox, estado, encabezadoYFilas(
            '9001/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,Caso Ruiz,principal',
            '9002/2025,numero,JUZGADO ORAL CIVIL CANCUN,Caso Ruiz,amparo',
            '9003/2025,numero,JUZGADO CIVIL COZUMEL,,suelto'
        ));

        igual('carpetas: se crea una sola para el mismo nombre', r.carpetas.length, 1);
        igual('carpetas: con el nombre escrito por el usuario', r.carpetas[0].nombre, 'Caso Ruiz');
        igual('carpetas: los dos expedientes quedan agrupados',
            [r.expedientes[0].carpetaId, r.expedientes[1].carpetaId], [r.carpetas[0].id, r.carpetas[0].id]);
        igual('carpetas: el suelto no queda en ninguna', r.expedientes[2].carpetaId, undefined);
        verificar('carpetas: no queda basura interna en el expediente',
            !('_carpetaNombre' in r.expedientes[0]), JSON.stringify(r.expedientes[0]));

        // Una carpeta que ya existe se reutiliza, no se duplica
        const r2 = await importar(sandbox, estado, encabezadoYFilas(
            '9004/2025,numero,JUZGADO CIVIL COZUMEL,caso ruiz,mismo caso en minúsculas'
        ));
        igual('carpetas: se reutiliza la existente aunque cambie mayúsculas', r2.carpetas.length, 1);
        igual('carpetas: el nuevo expediente entra en la carpeta existente',
            r2.expedientes[3].carpetaId, r2.carpetas[0].id);
    }

    // ---------- 10. Límite del plan gratuito ----------
    {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);
        sandbox.estadoPremium = { activo: false, codigo: '' };

        const limite = vm.runInContext('PREMIUM_CONFIG.limiteExpedientes', sandbox);
        const filas = [];
        for (let i = 1; i <= limite + 5; i++) {
            filas.push(`90${String(i).padStart(2, '0')}/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,,fila ${i}`);
        }
        const r = await importar(sandbox, estado, encabezadoYFilas(...filas));

        igual(`plan gratuito: no se pasa del límite de ${limite}`, r.expedientes.length, limite);
        verificar('plan gratuito: se avisa antes de importar',
            /CUENTA GRATUITA/.test(r.confirmaciones.join('\n')), r.confirmaciones.join('\n'));

        // Premium sí importa todo
        const { sandbox: sp, estado: ep } = crearEntorno();
        cargarCodigoReal(sp);
        const rp = await importar(sp, ep, encabezadoYFilas(...filas));
        igual('premium: se importan todos', rp.expedientes.length, limite + 5);

        // Sin cupo: se explica el límite en vez de preguntar "¿importar 0?"
        const { sandbox: s0, estado: e0 } = crearEntorno();
        cargarCodigoReal(s0);
        s0.estadoPremium = { activo: false, codigo: '' };
        e0.limitesMostrados = [];
        s0.mostrarModalLimite = (tipo) => e0.limitesMostrados.push(tipo);
        for (let i = 0; i < limite; i++) e0.expedientes.push({ id: 500 + i, numero: `ya${i}/2020`, juzgado: 'X', activo: true });

        const r0 = await importar(s0, e0,
            encabezadoYFilas('9999/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,,de más'));
        igual('sin cupo: no se importa nada', r0.expedientes.length, limite);
        igual('sin cupo: se muestra el modal de límite', e0.limitesMostrados, ['expedientes']);
        igual('sin cupo: no se pregunta nada al usuario', r0.confirmaciones.length, 0);
    }

    // ---------- 11. Cancelar y archivos Excel ----------
    {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);

        const r = await importar(sandbox, estado,
            encabezadoYFilas('9001/2025,numero,JUZGADO PRIMERO CIVIL CANCUN,,x'), { confirmar: false });
        igual('cancelar: no se guarda nada', r.expedientes.length, 0);

        const rx = await importar(sandbox, estado, 'da igual', { nombreArchivo: 'expedientes.xlsx' });
        igual('excel: no se guarda nada', rx.expedientes.length, 0);
        verificar('excel: se explica cómo convertirlo',
            rx.toasts.some(t => /CSV UTF-8/.test(t.mensaje)), JSON.stringify(rx.toasts));
    }

    // ---------- 12. El usuario borra las filas de ejemplo y escribe las suyas ----------
    {
        const { sandbox, estado } = crearEntorno();
        cargarCodigoReal(sandbox);
        sandbox.descargarTemplateCSV();

        // Simula Excel: conserva comentarios y ejemplos, añade dos filas propias
        const conFilasPropias = estado.csvGenerado.replace(
            /^(expediente,tipo,juzgado,carpeta,comentario\n(?:.*\n){3})/m,
            '$1' +
            '7777/2025,numero,Juzgado Segundo Mercantil Cancún,Cliente ACME,contrato\n' +
            'María Gómez,nombre,JUZGADO FAMILIAR ORAL TULUM,,divorcio\n');

        const r = await importar(sandbox, estado, conFilasPropias);

        igual('caso real: entran solo las filas del usuario', r.expedientes.length, 2);
        igual('caso real: el juzgado con tilde se normaliza',
            r.expedientes[0].juzgado, 'JUZGADO SEGUNDO MERCANTIL CANCUN');
        igual('caso real: la carpeta se crea', r.carpetas.map(c => c.nombre), ['Cliente ACME']);
        igual('caso real: la búsqueda por nombre se guarda como nombre',
            r.expedientes[1].nombre, 'María Gómez');
        verificar('caso real: se avisa de los ejemplos omitidos',
            /ejemplo/i.test(JSON.stringify(r.informes)), JSON.stringify(r.informes));
    }

    // ==================== RESULTADO ====================
    console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas\n`);
    if (fallidas > 0) {
        console.log('FALLOS:');
        fallos.forEach(f => console.log('  ✗ ' + f));
        process.exit(1);
    }
    console.log('✓ El template y la importación de expedientes funcionan correctamente.');
}

main().catch(e => { console.error(e); process.exit(1); });
