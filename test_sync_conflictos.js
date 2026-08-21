#!/usr/bin/env node
/**
 * Pruebas de las reglas que deciden qué edición gana al sincronizar.
 *
 *   node test_sync_conflictos.js
 *
 * Aquí se fija lo único que de verdad importa de una sincronización: que
 * trabajo ya hecho no desaparezca. Se cubren las tres formas en que se perdía:
 *
 *   1. Relojes que no coinciden entre dispositivos. Una edición hecha más
 *      tarde en un teléfono atrasado quedaba marcada como más antigua y perdía
 *      contra la anterior.
 *   2. Relojes que saltan hacia atrás. Dos ediciones seguidas en el MISMO
 *      dispositivo podían quedar selladas en orden invertido.
 *   3. Borrados sin fecha. Un borrado de cualquier antigüedad se llevaba por
 *      delante ediciones posteriores hechas en otro dispositivo.
 *
 * Se carga el código real de database.js y sync.js: se prueba lo que se
 * despliega, no una copia.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DB = path.join(__dirname, 'docs', 'js', 'database.js');
const SYNC = path.join(__dirname, 'docs', 'js', 'sync.js');

// ==================== CARGA DEL CÓDIGO REAL ====================

/** Una declaración suelta (function / const / let) tal cual está en el archivo. */
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

/** Una sección entera entre dos separadores "// ====". */
function extraerSeccion(fuente, titulo) {
    const marca = fuente.indexOf('// ==================== ' + titulo);
    if (marca === -1) throw new Error(`No se encontró la sección "${titulo}"`);
    const siguiente = fuente.indexOf('// ====================', marca + 30);
    return fuente.slice(marca, siguiente === -1 ? undefined : siguiente);
}

// Reloj falso que podemos mover a mano, incluso hacia atrás.
let horaFalsa = Date.parse('2026-08-21T12:00:00.000Z');

function crearEntorno() {
    const almacen = {};
    class FechaFalsa extends Date {
        constructor(...args) { super(...(args.length ? args : [horaFalsa])); }
        static now() { return horaFalsa; }
        static parse(s) { return Date.parse(s); }
    }

    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        localStorage: {
            getItem: (k) => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); },
            removeItem: (k) => { delete almacen[k]; }
        },
        Date: FechaFalsa,
        Math, JSON, Set, Map, Object, Array, String, Number, isNaN, parseInt, parseFloat
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    const fuenteDB = fs.readFileSync(DB, 'utf8');
    const fuenteSync = fs.readFileSync(SYNC, 'utf8');

    vm.runInContext(extraerSeccion(fuenteDB, 'RELOJ DE SINCRONIZACIÓN'), sandbox,
        { filename: 'database.js:reloj' });

    for (const n of ['ultimaEdicionDe', '_borradoMandaSobre']) {
        vm.runInContext(extraerDeclaracion(fuenteDB, n, 'database.js'), sandbox,
            { filename: `database.js:${n}` });
    }
    for (const n of ['_ultimaEdicionDe', '_eliminadoGana', 'obtenerTimestampCampo',
                     'fusionarExpedientesInteligente', 'fusionarRegistroPorCampo']) {
        vm.runInContext(extraerDeclaracion(fuenteSync, n, 'sync.js'), sandbox,
            { filename: `sync.js:${n}` });
    }

    return { sandbox, almacen, correr: (expr) => vm.runInContext(expr, sandbox) };
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

// Una excepción no debe tumbar la ejecución: se anota y se sigue, para ver el
// alcance real en vez de solo el primer tropiezo.
try {

// ---------- 1. Relojes que no coinciden ----------
{
    const { sandbox, correr } = crearEntorno();

    // El teléfono va tres minutos ATRASADO respecto al servidor.
    horaFalsa = Date.parse('2026-08-21T12:00:00.000Z');
    const horaServidor = '2026-08-21T12:03:00.000Z';

    const selloSinCorregir = correr('ahoraSync()');
    verificar('reloj: sin corregir, el sello sale con la hora del dispositivo',
        selloSinCorregir.startsWith('2026-08-21T12:00'), selloSinCorregir);

    correr(`ajustarRelojSync(${JSON.stringify(horaServidor)})`);
    igual('reloj: se aprende el desfase contra el servidor',
        correr('desfaseRelojSync()'), 180000);

    const selloCorregido = correr('ahoraSync()');
    verificar('reloj: a partir de ahí los sellos van con la hora del servidor',
        selloCorregido.startsWith('2026-08-21T12:03'), selloCorregido);

    // El escenario completo: PC edita a las 12:01 (hora real), el teléfono
    // atrasado edita a las 12:02 (hora real). Antes el teléfono sellaba 11:59 y
    // su edición, siendo la más nueva, perdía.
    horaFalsa = Date.parse('2026-08-21T12:02:00.000Z');   // hora del teléfono
    const selloTelefono = correr('ahoraSync()');           // debería ser ~12:05
    const selloPC = '2026-08-21T12:04:00.000Z';            // el PC, en hora, editó antes

    verificar('reloj: la edición posterior del teléfono queda por delante de la del PC',
        selloTelefono > selloPC, `teléfono ${selloTelefono} vs PC ${selloPC}`);

    // Y el desfase sobrevive a recargar: se guarda.
    verificar('reloj: el desfase se guarda para las siguientes sesiones',
        sandbox.localStorage.getItem('sync_desfase_reloj_ms') === '180000',
        sandbox.localStorage.getItem('sync_desfase_reloj_ms'));

    // Un desfase de milisegundos es el viaje de la petición, no un reloj malo.
    const antes = correr('desfaseRelojSync()');
    horaFalsa = Date.parse('2026-08-21T12:02:00.000Z');
    correr('ajustarRelojSync("2026-08-21T12:05:00.400Z")');
    igual('reloj: no se reajusta por el retardo normal de la red',
        correr('desfaseRelojSync()'), antes);
}

// ---------- 2. Relojes que saltan hacia atrás ----------
{
    const { correr } = crearEntorno();

    horaFalsa = Date.parse('2026-08-21T15:00:00.000Z');
    const primero = correr('ahoraSync()');

    // El sistema corrige la hora y la echa media hora atrás.
    horaFalsa = Date.parse('2026-08-21T14:30:00.000Z');
    const segundo = correr('ahoraSync()');
    const tercero = correr('ahoraSync()');

    verificar('reloj: un salto hacia atrás no invierte el orden de dos ediciones',
        segundo > primero, `${primero} → ${segundo}`);
    verificar('reloj: y el siguiente sello sigue avanzando',
        tercero > segundo, `${segundo} → ${tercero}`);
}

// ---------- 3. Un borrado viejo no mata una edición nueva ----------
{
    const { correr, sandbox } = crearEntorno();

    const expediente = {
        numero: '123/2025',
        comentario: 'Contestación presentada el miércoles',
        fechaCreacion: '2026-08-01T10:00:00.000Z',
        fechaActualizacion: '2026-08-19T10:00:00.000Z',
        _fieldTimestamps: { comentario: '2026-08-19T10:00:00.000Z' }
    };

    igual('borrado: la última edición se calcula mirando todos los sellos',
        sandbox.ultimaEdicionDe(expediente), '2026-08-19T10:00:00.000Z');

    // Borrado del LUNES contra edición del MIÉRCOLES.
    igual('borrado: uno anterior a la edición no manda',
        sandbox._borradoMandaSobre('2026-08-17T09:00:00.000Z', expediente), false);

    // Borrado del JUEVES contra edición del MIÉRCOLES.
    igual('borrado: uno posterior a la edición sí manda',
        sandbox._borradoMandaSobre('2026-08-20T09:00:00.000Z', expediente), true);

    // Un registro antiguo sin fecha de borrado se comporta como antes.
    igual('borrado: sin fecha, se aplica como se hacía antes',
        sandbox._borradoMandaSobre('', expediente), true);

    // Y lo mismo en el filtro de la fusión, que es el segundo sitio donde un
    // borrado podía deshacer el rescate del primero.
    const mapa = new Map([['exp|123/2025||', '2026-08-17T09:00:00.000Z']]);
    igual('fusión: el filtro también respeta la edición posterior',
        sandbox._eliminadoGana(mapa, 'exp|123/2025||', expediente), false);

    const mapaNuevo = new Map([['exp|123/2025||', '2026-08-20T09:00:00.000Z']]);
    igual('fusión: y descarta el registro cuando el borrado es posterior',
        sandbox._eliminadoGana(mapaNuevo, 'exp|123/2025||', expediente), true);

    igual('fusión: una clave que no se borró nunca no se toca',
        sandbox._eliminadoGana(mapa, 'exp|otro||', expediente), false);
}

// ---------- 4. La fusión por campo ----------
{
    const { sandbox } = crearEntorno();

    const enPC = {
        id: 1, numero: '123/2025', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN',
        comentario: 'lo viejo', fechaCreacion: '2026-08-01T10:00:00.000Z',
        _fieldTimestamps: {
            juzgado: '2026-08-19T10:00:00.000Z',
            comentario: '2026-08-10T10:00:00.000Z'
        }
    };
    const enTelefono = {
        id: 2, numero: '123/2025', juzgado: 'JUZGADO VIEJO',
        comentario: 'lo nuevo', fechaCreacion: '2026-08-01T10:00:00.000Z',
        _fieldTimestamps: {
            juzgado: '2026-08-05T10:00:00.000Z',
            comentario: '2026-08-20T10:00:00.000Z'
        }
    };

    const fusionado = sandbox.fusionarExpedientesInteligente(enPC, enTelefono);
    igual('fusión: cada campo conserva su edición más reciente (comentario)',
        fusionado.comentario, 'lo nuevo');
    igual('fusión: y la del otro campo no se pierde (juzgado)',
        fusionado.juzgado, 'JUZGADO PRIMERO CIVIL CANCUN');

    // Da igual el orden en que lleguen: el resultado tiene que ser el mismo, o
    // dos dispositivos acabarían con versiones distintas para siempre.
    const alReves = sandbox.fusionarExpedientesInteligente(enTelefono, enPC);
    igual('fusión: converge — fusionar al revés da lo mismo (comentario)',
        alReves.comentario, fusionado.comentario);
    igual('fusión: converge — fusionar al revés da lo mismo (juzgado)',
        alReves.juzgado, fusionado.juzgado);

    // Un campo sin sello no hereda la recencia del expediente entero: si no,
    // pisaría la edición explícita del otro dispositivo.
    const sinSello = {
        id: 3, numero: '123/2025', comentario: 'nunca tocado',
        fechaCreacion: '2026-08-01T10:00:00.000Z',
        fechaActualizacion: '2026-08-25T10:00:00.000Z'
    };
    const conSello = {
        id: 4, numero: '123/2025', comentario: 'editado a propósito',
        fechaCreacion: '2026-08-01T10:00:00.000Z',
        _fieldTimestamps: { comentario: '2026-08-15T10:00:00.000Z' }
    };
    const r = sandbox.fusionarExpedientesInteligente(sinSello, conSello);
    igual('fusión: un campo que nadie tocó no pisa la edición explícita del otro',
        r.comentario, 'editado a propósito');
}

// ---------- 5. Vaciar un campo a propósito ----------
{
    const { sandbox } = crearEntorno();

    const conTexto = {
        id: 1, comentario: 'algo escrito', fechaCreacion: '2026-08-01T10:00:00.000Z',
        _fieldTimestamps: { comentario: '2026-08-10T10:00:00.000Z' }
    };
    const vaciado = {
        id: 2, comentario: '', fechaCreacion: '2026-08-01T10:00:00.000Z',
        _fieldTimestamps: { comentario: '2026-08-20T10:00:00.000Z' }
    };

    const r = sandbox.fusionarExpedientesInteligente(conTexto, vaciado);
    verificar('fusión: borrar el contenido de un campo a propósito se respeta',
        r.comentario === undefined || r.comentario === '', JSON.stringify(r.comentario));

    // Pero un vaciado ANTERIOR no debe borrar lo que se escribió después.
    const r2 = sandbox.fusionarExpedientesInteligente(vaciado, conTexto);
    verificar('fusión: converge — el vaciado más reciente gana en los dos sentidos',
        (r2.comentario === undefined || r2.comentario === ''),
        JSON.stringify(r2.comentario));
}

} catch (e) {
    fallidas++;
    fallos.push('la prueba reventó — ' + e.message + '\n' + (e.stack || ''));
}

// ---------- Resultado ----------
console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas\n`);
if (fallidas > 0) {
    console.log('FALLOS:');
    fallos.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
}
console.log('✓ Una edición más nueva no la pisa ninguna más antigua.');
