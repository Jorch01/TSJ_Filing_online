#!/usr/bin/env node
/**
 * Pruebas de qué cuenta como expediente duplicado.
 *
 *   node test_duplicados.js
 *
 * Esto existe porque la app borraba expedientes sola. El barrido corre en cada
 * repintado —también tras crear o editar—, así que una regla de más se lleva
 * por delante asuntos de verdad y el usuario solo ve que "se pierden": creaba
 * tres asuntos de un caso y siempre quedaban dos.
 *
 * Aquí se fija la línea: se quita lo que está repetido de forma literal, y no
 * se toca lo que solo se PARECE. Se carga el código real de docs/js/.
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
    const estado = { expedientes: (expedientes || []).slice(), reasignados: [] };

    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        estado,
        obtenerExpedientes: async () => estado.expedientes.filter(e => e.activo !== false && !e.archivado),
        eliminarExpediente: async (id) => {
            estado.expedientes = estado.expedientes.filter(e => e.id !== id);
        },
        reasignarRegistrosDeExpediente: async (origen, destino) => {
            estado.reasignados.push({ origen, destino });
        }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    const db = fs.readFileSync(path.join(JS, 'database.js'), 'utf8');
    for (const n of ['_normalizarIdentidadExpediente', '_claveIdentidadExpediente',
                     'eliminarExpedientesDuplicados']) {
        vm.runInContext(extraerDeclaracion(db, n, 'database.js'), sandbox, { filename: `database.js:${n}` });
    }

    const sync = fs.readFileSync(path.join(JS, 'sync.js'), 'utf8');
    for (const n of ['normalizarTexto', 'normalizarNumeroExpediente',
                     'claveExpediente', 'sonExpedientesDuplicados']) {
        vm.runInContext(extraerDeclaracion(sync, n, 'sync.js'), sandbox, { filename: `sync.js:${n}` });
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

const J = 'JUZGADO PRIMERO CIVIL CANCUN';
const exp = (id, campos) => ({ id, institucion: 'TSJ', juzgado: J, activo: true, ...campos });

// Qué queda tras el barrido, en orden de id.
async function barrer(expedientes) {
    const { sandbox, estado } = crearEntorno(expedientes);
    const quitados = await sandbox.eliminarExpedientesDuplicados();
    return {
        quedan: estado.expedientes.map(e => e.id).sort((a, b) => a - b),
        quitados,
        reasignados: estado.reasignados
    };
}

// ==================== LO QUE NO SE DEBE BORRAR ====================

async function pruebaNoBorraAsuntosDistintos() {
    // El fallo original: la clave era `(numero || nombre) | juzgado`, así que un
    // asunto dado de alta por NOMBRE chocaba con otro cuyo NÚMERO era ese
    // mismo texto. Eran dos expedientes y quedaba uno.
    let r = await barrer([
        exp(1, { numero: '201/2025' }),
        exp(2, { nombre: '201/2025' }),
        exp(3, { numero: '202/2025' })
    ]);
    igual('un asunto por nombre no es duplicado de otro por número', r.quedan, [1, 2, 3]);
    igual('y no se anuncia ningún borrado', r.quitados, []);

    r = await barrer([
        exp(1, { numero: '301/2025' }),
        exp(2, { numero: '301/2025 BIS' }),
        exp(3, { numero: '301/2025-II' })
    ]);
    igual('un número con sufijo es otro asunto', r.quedan, [1, 2, 3]);

    r = await barrer([
        exp(1, { nombre: 'Pérez vs IMSS' }),
        exp(2, { nombre: 'Pérez vs IMSS II' })
    ]);
    igual('dos nombres parecidos no son el mismo asunto', r.quedan, [1, 2]);

    r = await barrer([
        exp(1, { numero: '401/2025' }),
        exp(2, { numero: '401/2025', juzgado: 'JUZGADO SEGUNDO CIVIL CANCUN' })
    ]);
    igual('el mismo número en otro juzgado es otro asunto', r.quedan, [1, 2]);

    r = await barrer([
        exp(1, { numero: '501/2025' }),
        exp(2, { numero: '501/2025', institucion: 'PJF', juzgado: J })
    ]);
    igual('el mismo número en otra institución es otro asunto', r.quedan, [1, 2]);

    // La categoría se calcula a partir del juzgado, así que no debe decidir
    // nada: dos copias del mismo expediente con categoría distinta seguían
    // siendo dos porque la clave la incluía.
    r = await barrer([
        exp(1, { numero: '601/2025', categoria: 'CANCÚN - Civil' }),
        exp(2, { numero: '601/2025', categoria: 'OTROS' })
    ]);
    igual('una categoría distinta no salva a un duplicado real', r.quedan, [1]);

    // Sin número ni nombre no hay forma de distinguirlos: no se borra nada.
    r = await barrer([exp(1, {}), exp(2, {})]);
    igual('sin número ni nombre no se borra nada', r.quedan, [1, 2]);
}

// ==================== LO QUE SÍ SE DEBE BORRAR ====================

async function pruebaSiBorraDuplicadosReales() {
    let r = await barrer([
        exp(1, { numero: '701/2025', comentario: 'con datos' }),
        exp(2, { numero: '701/2025' }),
        exp(3, { numero: '702/2025' })
    ]);
    igual('dos altas idénticas se quedan en una', r.quedan, [1, 3]);
    igual('sobrevive la más completa', r.quitados.map(q => q.etiqueta), ['701/2025']);
    igual('y lo que colgaba del borrado se pasa al superviviente',
        r.reasignados, [{ origen: 2, destino: 1 }]);

    r = await barrer([
        exp(1, { nombre: 'Pérez  vs  IMSS' }),
        exp(2, { nombre: 'perez vs imss' })
    ]);
    igual('acentos, mayúsculas y espacios de más no crean un asunto nuevo', r.quedan, [1]);

    // Se informa de lo que se quitó: borrar en silencio es lo que hacía que
    // pareciera que la app pierde expedientes.
    verificar('se dice qué expediente se quitó',
        r.quitados.length === 1 && !!r.quitados[0].etiqueta, JSON.stringify(r.quitados));
    verificar('y con cuál se quedó',
        r.quitados[0].sobreviviente === 1, JSON.stringify(r.quitados));
}

// ==================== LA FUSIÓN DE LA SINCRONIZACIÓN ====================

function pruebaFusionSync() {
    const { sandbox } = crearEntorno([]);
    const dup = (a, b) => sandbox.sonExpedientesDuplicados(a, b).esDuplicado;
    const razon = (a, b) => sandbox.sonExpedientesDuplicados(a, b).razon;

    // El mismo número escrito de dos formas sí debe unirse: es lo que pasa
    // cuando dos dispositivos dan de alta el mismo expediente.
    igual('sync: los ceros a la izquierda no crean un expediente nuevo',
        sandbox.normalizarNumeroExpediente('0601/2025'),
        sandbox.normalizarNumeroExpediente('601/2025'));
    verificar('sync: y se fusionan',
        dup(exp(1, { numero: '0601/2025' }), exp(2, { numero: '601/2025' })));

    // Pero un sufijo distingue asuntos y no se puede tirar.
    verificar('sync: "301/2025" y "301/2025 BIS" NO son el mismo',
        sandbox.normalizarNumeroExpediente('301/2025') !==
        sandbox.normalizarNumeroExpediente('301/2025 BIS'),
        `${sandbox.normalizarNumeroExpediente('301/2025')} vs ${sandbox.normalizarNumeroExpediente('301/2025 BIS')}`);
    verificar('sync: y no se fusionan',
        !dup(exp(1, { numero: '301/2025' }), exp(2, { numero: '301/2025 BIS' })));
    verificar('sync: tampoco con el sufijo romano',
        !dup(exp(1, { numero: '301/2025' }), exp(2, { numero: '301/2025-II' })));

    // Parecerse no basta: fusionar destruye uno de los dos.
    verificar('sync: dos nombres parecidos no se fusionan',
        !dup(exp(1, { nombre: 'Pérez vs IMSS' }), exp(2, { nombre: 'Pérez vs IMSS II' })));
    verificar('sync: ni un mismo número con nombres parecidos',
        !dup(exp(1, { numero: '801/2025', nombre: 'Juan Pérez' }),
             exp(2, { numero: '801/2025', nombre: 'Juana Pérez', juzgado: 'JUZGADO SEGUNDO CIVIL CANCUN' })));

    // Lo que sí sigue uniéndose.
    igual('sync: dos altas idénticas siguen siendo el mismo',
        razon(exp(1, { numero: '901/2025' }), exp(2, { numero: '901/2025' })), 'clave_exacta');
    igual('sync: mismo nombre exacto y mismo juzgado también',
        razon(exp(1, { nombre: 'Caso Uno' }), exp(2, { nombre: 'Caso Uno', comentario: 'x' })),
        'clave_exacta');
    verificar('sync: el mismo número en otro juzgado no se fusiona',
        !dup(exp(1, { numero: '902/2025' }),
             exp(2, { numero: '902/2025', juzgado: 'JUZGADO SEGUNDO CIVIL CANCUN' })));
}

(async () => {
    const pruebas = [
        ['no borrar asuntos distintos', pruebaNoBorraAsuntosDistintos],
        ['sí borrar duplicados reales', pruebaSiBorraDuplicadosReales],
        ['la fusión de la sincronización', pruebaFusionSync]
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
    console.log('  ✓ Se quita lo repetido; lo que solo se parece se queda.\n');
})();
