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
    for (const n of ['_normalizarIdentidadExpediente', '_discriminanteAsunto', '_RE_ORGANO_SIN_DETERMINAR', '_organoSinDeterminar',
                     '_asuntoSinIdentificar', '_claveIdentidadExpediente', 'eliminarExpedientesDuplicados']) {
        vm.runInContext(extraerDeclaracion(db, n, 'database.js'), sandbox, { filename: `database.js:${n}` });
    }

    const app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    for (const n of ['_esMismoAsuntoPJF', '_mismoOrganoParaIA', '_elegirExpedienteDeIA']) {
        vm.runInContext(extraerDeclaracion(app, n, 'app.js'), sandbox, { filename: `app.js:${n}` });
    }

    const sync = fs.readFileSync(path.join(JS, 'sync.js'), 'utf8');
    for (const n of ['normalizarTexto', 'normalizarNumeroExpediente',
                     'claveExpediente', 'discriminanteAsunto', 'organoSinDeterminar', 'asuntoSinIdentificar', 'sonExpedientesDuplicados']) {
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

    // Cuando el órgano no se sabe, el expediente se guarda con un texto de relleno
    // («PJF - Por determinar», «Autoridad no especificada»). Ese texto es el mismo
    // para todos, así que dos asuntos sin relación que comparten número parecían
    // el mismo y el barrido borraba uno. Sin órgano no hay forma de saberlo.
    r = await barrer([
        exp(1, { numero: '45/2026', institucion: 'PJF', juzgado: 'PJF - Por determinar', comentario: 'Asunto de Pérez' }),
        exp(2, { numero: '45/2026', institucion: 'PJF', juzgado: 'PJF - Por determinar' })
    ]);
    igual('PJF sin órgano: dos asuntos con el mismo número no se toman por uno', r.quedan, [1, 2]);
    r = await barrer([
        exp(1, { numero: '123/2026', institucion: 'OTRO', juzgado: 'Autoridad no especificada', comentario: 'IMSS' }),
        exp(2, { numero: '123/2026', institucion: 'OTRO', juzgado: 'Autoridad no especificada', comentario: 'SAT' })
    ]);
    igual('Otros sin autoridad: dos asuntos con el mismo número no se toman por uno', r.quedan, [1, 2]);
    r = await barrer([
        exp(1, { numero: '77/2026', institucion: 'TSJ', juzgado: 'Por determinar' }),
        exp(2, { numero: '77/2026', institucion: 'TSJ', juzgado: 'Por determinar' })
    ]);
    igual('TSJ creado por la IA sin órgano: tampoco', r.quedan, [1, 2]);
    r = await barrer([exp(1, { numero: '88/2026', institucion: 'OTRO', juzgado: '' }), exp(2, { numero: '88/2026', institucion: 'OTRO', juzgado: '' })]);
    igual('un juzgado vacío tampoco identifica', r.quedan, [1, 2]);

    // El formulario deja el tipo de asunto federal en blanco si no se elige. Un
    // asunto federal sin tipo y otro del mismo número y tribunal —también sin
    // tipo— pueden ser un amparo directo y un recurso de revisión: no hay cómo
    // asegurar que son el mismo, así que ninguno se borra.
    r = await barrer([pjf(1, { comentario: 'Expediente federal - Buscar y Guardar' }), pjf(2, {})]);
    igual('PJF sin tipo de asunto en ninguno: no se borra ninguno (podrían ser tipos distintos)', r.quedan, [1, 2]);
    igual('PJF sin tipo: y no se anuncia ningún borrado', r.quitados, []);
    // Otras autoridades: sin tipo ni cliente el nombre tecleado de la autoridad no basta.
    r = await barrer([exp(1, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS' }), exp(2, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS' })]);
    igual('Otros sin tipo ni cliente: no se borra ninguno', r.quedan, [1, 2]);

    // Fuera del PJF no hay catálogo de tipos: el que el usuario escribe distingue.
    const imss = (id, campos) => exp(id, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS', ...campos });
    r = await barrer([imss(1, { tipo: 'Queja' }), imss(2, { tipo: 'Revisión' })]);
    igual('Otros: mismo número y autoridad con otro tipo de asunto es otro asunto', r.quedan, [1, 2]);
    r = await barrer([imss(1, { cliente: 'Constructora Alfa' }), imss(2, { cliente: 'Hotel Beta' })]);
    igual('Otros: mismo número y autoridad pero de otro cliente es otro asunto (el «IMSS» de Cancún y el de Mérida)', r.quedan, [1, 2]);
    r = await barrer([imss(1, { cliente: 'Constructora Alfa', comentario: 'con datos' }), imss(2, { cliente: 'Constructora Alfa' })]);
    igual('Otros: dos altas idénticas (mismo cliente) siguen siendo una', r.quedan, [1]);

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
    r = await barrer([exp(1, { numero: '801/2025', comentario: 'con datos' }), exp(2, { numero: '801/2025' })]);
    igual('TSJ: dos altas idénticas siguen siendo una (el juzgado del catálogo numera en una sola serie)', r.quedan, [1]);

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

    // Sin órgano conocido (texto de relleno), dos altas con el mismo número no son el mismo asunto.
    verificar('sync: PJF sin órgano, dos altas por separado con el mismo número NO se fusionan',
        !dup(exp(1, { numero: '45/2026', institucion: 'PJF', juzgado: 'PJF - Por determinar', fechaCreacion: '2026-01-01T10:00:00Z' }),
             exp(2, { numero: '45/2026', institucion: 'PJF', juzgado: 'PJF - Por determinar', fechaCreacion: '2026-02-02T10:00:00Z' })));
    verificar('sync: Otros sin autoridad, tampoco',
        !dup(exp(1, { numero: '123/2026', institucion: 'OTRO', juzgado: 'Autoridad no especificada', fechaCreacion: '2026-01-01T10:00:00Z' }),
             exp(2, { numero: '123/2026', institucion: 'OTRO', juzgado: 'Autoridad no especificada', fechaCreacion: '2026-02-02T10:00:00Z' })));
    verificar('sync: pero el MISMO registro sin órgano en dos dispositivos sigue siendo uno',
        dup(exp(1, { numero: '45/2026', institucion: 'PJF', juzgado: 'PJF - Por determinar', fechaCreacion: '2026-03-03T10:00:00Z' }),
            exp(2, { numero: '45/2026', institucion: 'PJF', juzgado: 'PJF - Por determinar', comentario: 'editado', fechaCreacion: '2026-03-03T10:00:00Z' })));
    verificar('sync: Otros, mismo número y autoridad de otro cliente, no se fusionan',
        !dup(exp(1, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS', cliente: 'Alfa' }),
             exp(2, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS', cliente: 'Beta' })));

    verificar('sync: PJF sin tipo de asunto en ninguno, dos altas por separado NO se fusionan',
        !dup(exp(1, { numero: '577/2026', institucion: 'PJF', juzgado: 'Tribunal X', pjfOrgId: '321', fechaCreacion: '2026-01-01T10:00:00Z' }),
             exp(2, { numero: '577/2026', institucion: 'PJF', juzgado: 'Tribunal X', pjfOrgId: '321', fechaCreacion: '2026-02-02T10:00:00Z' })));
    verificar('sync: pero el mismo registro federal sin tipo en dos dispositivos sigue siendo uno',
        dup(exp(1, { numero: '577/2026', institucion: 'PJF', juzgado: 'Tribunal X', pjfOrgId: '321', fechaCreacion: '2026-03-03T10:00:00Z' }),
            exp(2, { numero: '577/2026', institucion: 'PJF', juzgado: 'Tribunal X', pjfOrgId: '321', comentario: 'editado', fechaCreacion: '2026-03-03T10:00:00Z' })));
    verificar('sync: Otros sin tipo ni cliente, dos altas por separado NO se fusionan',
        !dup(exp(1, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS', fechaCreacion: '2026-01-01T10:00:00Z' }),
             exp(2, { numero: '45/2026', institucion: 'OTRO', juzgado: 'IMSS', fechaCreacion: '2026-02-02T10:00:00Z' })));
    verificar('sync: en el TSJ, dos altas del mismo número y juzgado sí siguen uniéndose',
        dup(exp(1, { numero: '902/2025', fechaCreacion: '2026-01-01T10:00:00Z' }), exp(2, { numero: '902/2025', fechaCreacion: '2026-02-02T10:00:00Z' })));

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
        exp(9, { numero: '2/2026', institucion: 'OTRO', juzgado: 'IMSS' }),
        exp(10, { numero: '2/2026', institucion: 'OTRO', juzgado: 'IMSS', cliente: 'Alfa' }),
        exp(11, { numero: '3/2026', institucion: 'PJF', juzgado: 'PJF - Por determinar' }),
        exp(12, { numero: '3/2026', institucion: 'OTRO', juzgado: 'Autoridad no especificada' }),
        exp(13, { numero: '3/2026', institucion: 'TSJ', juzgado: 'Por determinar' }),
        exp(14, { numero: '3/2026', institucion: 'OTRO', juzgado: '' }),
        pjf(15, { juzgado: 'PJF - Por determinar' })
    ];
    let coinciden = true;
    for (const a of casos) for (const b of casos) {
        const local = sandbox._discriminanteAsunto(a) === sandbox._discriminanteAsunto(b);
        const nube = sandbox.discriminanteAsunto(a) === sandbox.discriminanteAsunto(b);
        if (local !== nube) { coinciden = false; }
    }
    verificar('las dos copias de la regla de lo que distingue un asunto (database.js y sync.js) coinciden', coinciden);
    let coincidenOrgano = true;
    for (const a of casos) {
        if (sandbox._organoSinDeterminar(a) !== sandbox.organoSinDeterminar(a)) coincidenOrgano = false;
    }
    verificar('las dos copias de la regla de órgano sin determinar coinciden', coincidenOrgano);
    const casosSinId = casos.concat([
        pjf(20, {}), pjf(21, { pjfTipoAsunto: '4' }), exp(22, { numero: '9/2026', institucion: 'OTRO', juzgado: 'IMSS', tipo: 'Queja' }),
        exp(23, { numero: '9/2026', institucion: 'OTRO', juzgado: 'IMSS', cliente: 'Alfa' }), exp(24, { numero: '9/2026', institucion: 'OTRO', juzgado: 'IMSS' }),
        exp(25, { numero: '9/2026' })
    ]);
    let coincidenSinId = true;
    for (const a of casosSinId) {
        if (sandbox._asuntoSinIdentificar(a) !== sandbox.asuntoSinIdentificar(a)) coincidenSinId = false;
    }
    verificar('las dos copias de la regla de asunto sin identificar coinciden', coincidenSinId);
    verificar('federal con órgano y tipo está identificado', !sandbox._asuntoSinIdentificar(pjf(26, { pjfTipoAsunto: '4' })));
    verificar('federal sin tipo no', sandbox._asuntoSinIdentificar(pjf(27, {})));
    verificar('un expediente del TSJ con juzgado del catálogo siempre', !sandbox._asuntoSinIdentificar(exp(28, { numero: '1/2026' })));
    verificar('un órgano federal con id no es "sin determinar" aunque el texto lo diga', !sandbox._organoSinDeterminar(pjf(16, { juzgado: 'PJF - Por determinar' })));
    verificar('y sin id sí', sandbox._organoSinDeterminar(exp(17, { institucion: 'PJF', juzgado: 'PJF - Por determinar' })));
    verificar('un juzgado del catálogo del TSJ nunca', !sandbox._organoSinDeterminar(exp(18, { numero: '1/2026' })));
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

// ==================== A QUÉ EXPEDIENTE PERTENECE UN ACUERDO LEÍDO POR LA IA ====================

function pruebaVinculoIA() {
    const { sandbox } = crearEntorno([]);
    const elegir = (guardados, candidato, soloInstitucion) => {
        const r = sandbox._elegirExpedienteDeIA(guardados, candidato, soloInstitucion);
        return { existente: r.existente ? r.existente.id : null, ambiguos: r.ambiguos.map(e => e.id) };
    };
    const PRIMERO = 'JUZGADO PRIMERO CIVIL CANCUN', SEGUNDO = 'JUZGADO SEGUNDO FAMILIAR CANCUN';
    const tsj = (id, num, juz) => exp(id, { numero: num, institucion: 'TSJ', juzgado: juz });
    const cand = (num, juz, extra) => ({ numero: num, institucion: 'TSJ', juzgado: juz, ...extra });

    // Cada juzgado numera desde 1 cada año: el 123/2025 del Segundo no es el del Primero.
    igual('IA: el mismo número de otro juzgado NO se vincula (es otro asunto)',
        elegir([tsj(1, '123/2025', PRIMERO)], cand('123/2025', SEGUNDO)), { existente: null, ambiguos: [] });
    igual('IA: el mismo número del mismo juzgado sí', elegir([tsj(1, '123/2025', PRIMERO)], cand('123/2025', PRIMERO)), { existente: 1, ambiguos: [] });
    igual('IA: entre dos juzgados con el mismo número, el del acuerdo',
        elegir([tsj(1, '123/2025', PRIMERO), tsj(2, '123/2025', SEGUNDO)], cand('123/2025', SEGUNDO)), { existente: 2, ambiguos: [] });
    igual('IA: mayúsculas y acentos no importan',
        elegir([tsj(1, '123/2025', PRIMERO)], cand('123/2025', 'Juzgado Primero Civil Cancún')), { existente: 1, ambiguos: [] });

    // El acuerdo no siempre dice el órgano.
    igual('IA: sin órgano en el acuerdo y un solo expediente con ese número, se vincula (como siempre)',
        elegir([tsj(1, '123/2025', PRIMERO)], cand('123/2025', 'Por determinar')), { existente: 1, ambiguos: [] });
    igual('IA: sin órgano y varios con ese número, no se adivina',
        elegir([tsj(1, '123/2025', PRIMERO), tsj(2, '123/2025', SEGUNDO)], cand('123/2025', 'Por determinar')), { existente: null, ambiguos: [1, 2] });
    igual('IA: con órgano y un expediente que se dio de alta sin él, se vincula a ese',
        elegir([tsj(1, '123/2025', 'Por determinar')], cand('123/2025', PRIMERO)), { existente: 1, ambiguos: [] });
    igual('IA: pero si hay uno del mismo órgano, manda ese sobre el que no tiene órgano',
        elegir([tsj(1, '123/2025', 'Por determinar'), tsj(2, '123/2025', PRIMERO)], cand('123/2025', PRIMERO)), { existente: 2, ambiguos: [] });
    igual('IA: sin ningún expediente con ese número no hay nada que vincular',
        elegir([tsj(1, '999/2025', PRIMERO)], cand('123/2025', PRIMERO)), { existente: null, ambiguos: [] });

    // Federal: órgano por id y tipo de asunto.
    const TCA = 'Tribunal Colegiado en Materia Administrativa del Vigésimo Circuito';
    const pjf = (id, tipo, org) => exp(id, { numero: '577/2026', institucion: 'PJF', juzgado: TCA, pjfOrgId: org || '321', pjfTipoAsunto: tipo });
    const candPjf = (extra) => ({ numero: '577/2026', institucion: 'PJF', juzgado: TCA, pjfOrgId: '321', ...extra });
    igual('IA PJF: el recurso de revisión se vincula al recurso, no al amparo del mismo número y tribunal',
        elegir([pjf(1, '4'), pjf(2, '9')], candPjf({ pjfTipoAsunto: '9' })), { existente: 2, ambiguos: [] });
    igual('IA PJF: un tipo que no tengo en ese tribunal es otro asunto',
        elegir([pjf(1, '4')], candPjf({ pjfTipoAsunto: '9' })), { existente: null, ambiguos: [] });
    igual('IA PJF: sin tipo en el acuerdo y dos asuntos del mismo número y tribunal, no se adivina',
        elegir([pjf(1, '4'), pjf(2, '9')], candPjf({})), { existente: null, ambiguos: [1, 2] });
    igual('IA PJF: el mismo número en otro órgano es otro asunto',
        elegir([pjf(1, '4', '999')], candPjf({ pjfTipoAsunto: '4' })), { existente: null, ambiguos: [] });
    igual('IA PJF: sin tipo en el acuerdo y un solo asunto, se vincula',
        elegir([pjf(1, '4')], candPjf({})), { existente: 1, ambiguos: [] });
    igual('IA PJF: el tipo guardado como nada se vincula con cualquiera (podía ser el mismo)',
        elegir([pjf(1, undefined)], candPjf({ pjfTipoAsunto: '9' })), { existente: 1, ambiguos: [] });

    // Instituciones distintas con el mismo número no son el mismo asunto.
    igual('IA: un expediente del TSJ y uno federal con el mismo número son distintos',
        elegir([tsj(1, '577/2026', PRIMERO)], candPjf({})), { existente: null, ambiguos: [] });
    igual('IA: la pestaña del PJF solo mira los federales',
        elegir([tsj(1, '577/2026', 'Por determinar'), pjf(2, '4')], candPjf({ pjfTipoAsunto: '4' }), 'PJF'), { existente: 2, ambiguos: [] });
    // Por nombre de las partes.
    igual('IA: también por el nombre de las partes',
        elegir([exp(1, { nombre: 'Juan Pérez', juzgado: PRIMERO })], cand('juan pérez', PRIMERO)), { existente: 1, ambiguos: [] });
}

(async () => {
    const pruebas = [
        ['no borrar asuntos distintos', pruebaNoBorraAsuntosDistintos],
        ['sí borrar duplicados reales', pruebaSiBorraDuplicadosReales],
        ['la fusión de la sincronización', pruebaFusionSync],
        ['"Buscar y guardar" del PJF', pruebaGuardarPJF],
        ['a qué expediente pertenece un acuerdo leído por la IA', pruebaVinculoIA]
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
