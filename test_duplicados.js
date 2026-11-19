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
    for (const n of ['_normalizarIdentidadExpediente', '_discriminanteAsunto', '_claveIdentidadExpediente',
                     'eliminarExpedientesDuplicados']) {
        vm.runInContext(extraerDeclaracion(db, n, 'database.js'), sandbox, { filename: `database.js:${n}` });
    }

    const app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    vm.runInContext(extraerDeclaracion(app, '_esMismoAsuntoPJF', 'app.js'), sandbox, { filename: 'app.js:_esMismoAsuntoPJF' });

    const sync = fs.readFileSync(path.join(JS, 'sync.js'), 'utf8');
    for (const n of ['normalizarTexto', 'normalizarNumeroExpediente',
                     'claveExpediente', 'discriminanteAsunto', 'sonExpedientesDuplicados']) {
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

    // El caso real: en el PJF cada tipo de asunto lleva su propia numeración, así
    // que un mismo órgano puede tener a la vez un "Amparo directo 577/2026" y un
    // "Recurso de revisión 577/2026". Son asuntos distintos con el mismo número y
    // el mismo órgano; solo los distingue el tipo de asunto. El barrido no lo
    // miraba: al dar de alta el segundo, borraba uno de los dos.
    const TCA = 'Tribunal Colegiado en Materia Administrativa del Vigésimo Circuito';
    const pjf = (id, campos) => exp(id, { numero: '577/2026', institucion: 'PJF', juzgado: TCA, pjfOrgId: '321', ...campos });
    r = await barrer([
        pjf(1, { pjfTipoAsunto: '4', comentario: 'Amparo directo' }),
        pjf(2, { pjfTipoAsunto: '9' })
    ]);
    igual('PJF: mismo número y órgano con otro tipo de asunto es otro asunto', r.quedan, [1, 2]);
    igual('PJF: y no se anuncia ningún borrado', r.quitados, []);

    r = await barrer([pjf(1, { pjfTipoAsunto: '4' }), pjf(2, {})]);
    igual('PJF: con tipo de asunto y sin él tampoco se borra: no se sabe que son el mismo', r.quedan, [1, 2]);

    r = await barrer([pjf(1, { pjfTipoAsunto: '4' }), pjf(2, { pjfTipoAsunto: '4', pjfOrgId: '999' })]);
    igual('PJF: otro órgano con el mismo nombre (otro id) es otro asunto', r.quedan, [1, 2]);

    // Fuera del PJF no hay catálogo de tipos: el que el usuario escribe distingue.
    const imss = (id, campos) => exp(id, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS', ...campos });
    r = await barrer([imss(1, { tipo: 'Queja' }), imss(2, { tipo: 'Revisión' })]);
    igual('Otros: mismo número y autoridad con otro tipo de asunto es otro asunto', r.quedan, [1, 2]);

    // Mientras que el tipo de asunto de un expediente del TSJ es solo una etiqueta
    // y el juzgado ya numera todos sus juicios: ahí no distingue nada.
    r = await barrer([exp(1, { numero: '12/2026', tipo: 'Divorcio' }), exp(2, { numero: '12/2026', tipo: 'Familiar' })]);
    igual('TSJ: la etiqueta de tipo no salva a un duplicado real', r.quedan, [1]);
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

    r = await barrer([
        exp(1, { numero: '577/2026', institucion: 'PJF', juzgado: 'Tribunal X', pjfOrgId: '321', pjfTipoAsunto: '9', comentario: 'con datos' }),
        exp(2, { numero: '577/2026', institucion: 'PJF', juzgado: 'Tribunal X', pjfOrgId: '321', pjfTipoAsunto: '9' })
    ]);
    igual('PJF: dos altas idénticas (mismo órgano y mismo tipo de asunto) siguen siendo una', r.quedan, [1]);

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

    // El mismo número y órgano con otro tipo de asunto son dos asuntos del PJF.
    const pjf = (id, campos) => exp(id, { numero: '577/2026', institucion: 'PJF', juzgado: 'Tribunal X', pjfOrgId: '321', ...campos });
    verificar('sync: PJF, mismo número y órgano con otro tipo de asunto NO se fusionan',
        !dup(pjf(1, { pjfTipoAsunto: '4' }), pjf(2, { pjfTipoAsunto: '9' })));
    verificar('sync: ni uno con tipo de asunto y otro sin él, si se dieron de alta por separado',
        !dup(pjf(1, { pjfTipoAsunto: '4', fechaCreacion: '2026-01-01T10:00:00Z' }), pjf(2, { fechaCreacion: '2026-02-02T10:00:00Z' })));
    verificar('sync: Otros, mismo número y autoridad con otro tipo de asunto, tampoco',
        !dup(exp(1, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS', tipo: 'Queja' }),
             exp(2, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS', tipo: 'Revisión' })));
    // Pero el MISMO registro editado en dos dispositivos (se le puso el tipo de
    // asunto en uno) sigue siendo uno: lo delata su fecha de alta.
    verificar('sync: el mismo expediente al que se le puso tipo de asunto en otro dispositivo sigue siendo uno',
        dup(pjf(1, { fechaCreacion: '2026-03-03T10:00:00Z' }), pjf(2, { pjfTipoAsunto: '4', fechaCreacion: '2026-03-03T10:00:00Z' })));
    verificar('sync: y dos altas idénticas del PJF siguen uniéndose',
        dup(pjf(1, { pjfTipoAsunto: '4' }), pjf(2, { pjfTipoAsunto: '4' })));

    // El barrido local (database.js) y la fusión (sync.js) tienen cada uno su copia
    // de la regla: si una cambiara sin la otra, un dispositivo borraría lo que el
    // otro conserva.
    const casos = [
        exp(1, { numero: '1/2026' }),
        exp(2, { numero: '1/2026', tipo: 'Divorcio' }),
        pjf(3, { pjfTipoAsunto: '4' }), pjf(4, { pjfTipoAsunto: '9' }), pjf(5, {}), pjf(6, { pjfTipoAsunto: '4', pjfOrgId: '999' }),
        exp(7, { numero: '2/2026', institucion: 'OTRO', juzgado: 'IMSS', tipo: 'Queja' }),
        exp(8, { numero: '2/2026', institucion: 'OTRO', juzgado: 'IMSS', tipo: 'Revisión' }),
        exp(9, { numero: '2/2026', institucion: 'OTRO', juzgado: 'IMSS' })
    ];
    let coinciden = true;
    for (const a of casos) for (const b of casos) {
        const local = sandbox._discriminanteAsunto(a) === sandbox._discriminanteAsunto(b);
        const nube = sandbox.discriminanteAsunto(a) === sandbox.discriminanteAsunto(b);
        if (local !== nube) { coinciden = false; }
    }
    verificar('las dos copias de la regla (database.js y sync.js) coinciden', coinciden);
}

// ==================== "BUSCAR Y GUARDAR" DEL PJF ====================

function pruebaGuardarPJF() {
    const { sandbox } = crearEntorno([]);
    const mismo = (guardado, nuevo) => sandbox._esMismoAsuntoPJF(guardado, nuevo);
    const TCA = 'Tribunal Colegiado en Materia Administrativa del Vigésimo Circuito';
    const guardado = { numero: '577/2026', institucion: 'PJF', juzgado: TCA, pjfOrgId: '321', pjfTipoAsunto: '4' };
    const nuevo = (extra) => ({ numero: '577/2026', orgId: '321', orgNombre: TCA, tipoAsunto: '4', ...extra });

    verificar('guardar PJF: el mismo asunto (número, órgano y tipo) ya está guardado', mismo(guardado, nuevo()));
    verificar('guardar PJF: el número escrito con otras mayúsculas o espacios también', mismo(guardado, nuevo({ numero: ' 577/2026 ' })));
    verificar('guardar PJF: otro tipo de asunto en el mismo órgano NO es el mismo (recurso de revisión vs amparo directo)',
        !mismo(guardado, nuevo({ tipoAsunto: '9' })));
    verificar('guardar PJF: el mismo número en otro órgano NO es el mismo', !mismo(guardado, nuevo({ orgId: '999', orgNombre: 'Otro tribunal' })));
    verificar('guardar PJF: otro número tampoco', !mismo(guardado, nuevo({ numero: '578/2026' })));
    verificar('guardar PJF: un expediente del TSJ con ese número no cuenta', !mismo({ ...guardado, institucion: 'TSJ' }, nuevo()));
    verificar('guardar PJF: sin elegir tipo no se duplica lo ya guardado', mismo(guardado, nuevo({ tipoAsunto: '' })));
    verificar('guardar PJF: lo guardado sin tipo tampoco se duplica', mismo({ ...guardado, pjfTipoAsunto: undefined }, nuevo()));
    verificar('guardar PJF: sin ids de órgano se compara el nombre',
        mismo({ ...guardado, pjfOrgId: undefined }, nuevo({ orgId: '' })) &&
        !mismo({ ...guardado, pjfOrgId: undefined }, nuevo({ orgId: '', orgNombre: 'Otro tribunal' })));
}

(async () => {
    const pruebas = [
        ['no borrar asuntos distintos', pruebaNoBorraAsuntosDistintos],
        ['sí borrar duplicados reales', pruebaSiBorraDuplicadosReales],
        ['la fusión de la sincronización', pruebaFusionSync],
        ['"Buscar y guardar" del PJF', pruebaGuardarPJF]
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
