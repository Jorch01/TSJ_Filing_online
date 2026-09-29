#!/usr/bin/env node
/**
 * Pruebas de "calcula la liquidación de…" dictado al asistente.
 *
 *   node test_voz_laboral.js
 *
 * El asistente no calcula con datos supuestos: lo que falte (cómo terminó,
 * fechas, salario y cada cuándo se pagaba, el porcentaje de una incapacidad
 * parcial) lo pregunta de uno en uno hasta poder calcular. Aquí se prueba,
 * con el código real de docs/js/, que:
 *   - lo que dice el modelo se lleva a la forma del motor ("15,000", "al mes",
 *     "hoy", la clave del supuesto sin importar mayúsculas);
 *   - se detecta lo que falta, en orden, y se pregunta lo primero;
 *   - la pregunta queda en la conversación, para que el modelo sepa qué se
 *     preguntó y conserve lo reunido;
 *   - completo, se calcula y se guarda para poder ajustarlo después;
 *   - el prompt conoce la acción y todos los supuestos del motor.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, 'docs', 'js');
const VOZ = fs.readFileSync(path.join(JS, 'voice-assistant.js'), 'utf8');
const motor = require('./docs/js/calculadora-laboral.js');

function extraerIndentado(fuente, nombre) {
    const re = new RegExp('^([ \\t]*)(?:async )?function ' + nombre + '\\s*\\([\\s\\S]*?\\n\\1\\}', 'm');
    const m = re.exec(fuente);
    if (!m) throw new Error(`No se encontró "${nombre}" en voice-assistant.js (¿se renombró?)`);
    return m[0];
}

function extraerSeccion(fuente, titulo) {
    const marca = fuente.indexOf('// ==================== ' + titulo);
    if (marca === -1) throw new Error(`No se encontró la sección "${titulo}" en voice-assistant.js`);
    const siguiente = fuente.indexOf('// ====================', marca + 30);
    return fuente.slice(marca, siguiente === -1 ? undefined : siguiente);
}

function crearSandbox() {
    const estado = { mensajes: [], dicho: [], ejecutadas: [], expedientes: [{ id: 7, numero: '123/2025' }] };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Map, Set, Promise, JSON, Object, Array, String, Number, isNaN, isFinite, parseFloat, parseInt, setTimeout,
        estado,
        CalculadoraLaboral: motor,
        Estado: { ESPERANDO_DATO: 'esperando_dato', INACTIVO: 'inactivo' },
        agregarMensaje: (rol, html) => { estado.mensajes.push(html); return null; },
        esc: (t) => String(t == null ? '' : t),
        hablar: (t) => { estado.dicho.push(t); },
        panelAbierto: () => false,
        iniciarEscucha: () => {},
        ejecutarAccion: async (r) => { estado.ejecutadas.push(r); },
        resolverExpedienteDeParametros: async (p) =>
            estado.expedientes.find(e => e.id === p.expedienteId || e.numero === p.expedienteRef) || null
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext('var conversacion = []; var estado = "inactivo"; var ultimoCalculoLaboral = null;', sb);
    for (const n of ['normalizar', 'pad', 'fechaLocalISO', 'ErrorAviso']) {
        vm.runInContext(extraerIndentado(VOZ, n), sb, { filename: 'voice-assistant.js:' + n });
    }
    vm.runInContext(extraerSeccion(VOZ, 'CALCULADORA LABORAL'), sb, { filename: 'voice-assistant.js:laboral' });
    return { sb, estado };
}

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);

(async () => {
    const hoy = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

    console.log('\nLo que dice el modelo, en la forma del motor');
    {
        const { sb } = crearSandbox();
        const d = sb.normalizarDatosLaborales({
            supuesto: 'DESPIDOINJUSTIFICADO', fechaIngreso: '2020-01-15', fechaBaja: 'hoy',
            salario: '$15,000', periodo: 'al mes', mesesJuicio: '6', incluirVeinteDias: 'true', zona: 'marte'
        });
        igual('la clave del supuesto sin importar mayúsculas', d.supuesto, 'despidoInjustificado');
        igual('"hoy" es la fecha de hoy', d.fechaBaja, hoy);
        igual('"$15,000" es 15000', d.salario, 15000);
        igual('"al mes" es mensual', d.periodo, 'mensual');
        igual('los números que llegan como texto', d.mesesJuicio, 6);
        igual('los 20 días, pedidos', d.incluirVeinteDias, true);
        igual('una zona que no existe se ignora', d.zona, undefined);
        for (const [dicho, periodo] of [['quincenal', 'quincenal'], ['a la semana', 'semanal'], ['semana', 'semanal'],
                                        ['diarios', 'diario'], ['por día', 'diario'], ['catorcena', 'catorcenal']]) {
            igual(`"${dicho}" es ${periodo}`, sb.normalizarDatosLaborales({ periodo: dicho }).periodo, periodo);
        }
    }

    console.log('\nLo que falta, en orden');
    {
        const { sb } = crearSandbox();
        const faltan = (p) => sb.faltantesCalculoLaboral(sb.normalizarDatosLaborales(p)).map(f => f.campo);
        igual('sin nada, faltan los cinco obligatorios', faltan({}), ['supuesto', 'fechaIngreso', 'fechaBaja', 'salario']);
        igual('un salario sin periodo no se supone mensual', faltan({ supuesto: 'renuncia', fechaIngreso: '2020-01-01', fechaBaja: '2026-01-01', salario: 5000 }), ['periodo']);
        igual('un periodo que no se entiende se vuelve a preguntar', faltan({ supuesto: 'renuncia', fechaIngreso: '2020-01-01', fechaBaja: '2026-01-01', salario: 5000, periodo: 'bimestral' }), ['periodo']);
        igual('la incapacidad parcial pide el porcentaje', faltan({ supuesto: 'incapacidadParcial', fechaIngreso: '2020-01-01', fechaBaja: '2026-01-01', salario: 500, periodo: 'diario' }), ['porcentajeIncapacidad']);
        igual('fechas al revés se vuelven a preguntar', faltan({ supuesto: 'renuncia', fechaIngreso: '2026-01-01', fechaBaja: '2020-01-01', salario: 500, periodo: 'diario' }), ['fechaBaja']);
        igual('una fecha imposible cuenta como faltante', faltan({ supuesto: 'renuncia', fechaIngreso: '2020-02-31', fechaBaja: '2026-01-01', salario: 500, periodo: 'diario' }), ['fechaIngreso']);
        igual('completo, no falta nada', faltan({ supuesto: 'renuncia', fechaIngreso: '2020-01-01', fechaBaja: '2026-01-01', salario: 500, periodo: 'diario' }), []);
        igual('lo opcional (juicio, 20 días) nunca se pregunta',
            faltan({ supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-01', fechaBaja: '2026-01-01', salario: 500, periodo: 'diario' }), []);
    }

    console.log('\nSe pregunta de uno en uno, sin perder lo reunido');
    {
        const { sb, estado } = crearSandbox();
        const r = { accion: 'calcular_laboral', faltan_datos: false, parametros: { supuesto: 'despidoInjustificado', fechaBaja: '2026-09-26' } };
        sb.conversacion.push({ role: 'user', content: 'calcula la liquidación, lo corrieron hoy' });
        sb.conversacion.push({ role: 'assistant', content: JSON.stringify(r) });
        await sb.prepararCalculoLaboral(r);
        const ultimo = estado.mensajes[estado.mensajes.length - 1];
        verificar('pregunta la fecha de ingreso', /¿En qué fecha entró a trabajar\?/.test(ultimo), ultimo);
        verificar('y solo esa', !/salario|ganaba/i.test(ultimo.split('<br>')[0]), ultimo);
        verificar('enseña lo que ya lleva', /Llevo: Despido injustificado.*terminación 2026-09-26/.test(ultimo), ultimo);
        igual('lo dice en voz alta', estado.dicho[estado.dicho.length - 1], '¿En qué fecha entró a trabajar?');
        igual('queda esperando el dato', sb.estado, 'esperando_dato');
        igual('no se agrega un turno de más a la conversación', sb.conversacion.length, 2);
        const enConversacion = JSON.parse(sb.conversacion[1].content);
        igual('el modelo verá la pregunta que se hizo', enConversacion.pregunta, '¿En qué fecha entró a trabajar?');
        igual('y los datos reunidos', enConversacion.parametros.fechaBaja, '2026-09-26');
        igual('nada se ejecuta todavía', estado.ejecutadas.length, 0);

        const completo = { accion: 'calcular_laboral', parametros: { supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-15', fechaBaja: '2026-09-26', salario: '15 000', periodo: 'mensual' } };
        await sb.prepararCalculoLaboral(completo);
        igual('completo, se ejecuta', estado.ejecutadas.length, 1);
        igual('con los datos ya normalizados', estado.ejecutadas[0].parametros.salario, 15000);
    }

    console.log('\nEl cálculo');
    {
        const { sb, estado } = crearSandbox();
        const p = { supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-15', fechaBaja: '2026-09-26', salario: 15000, periodo: 'mensual', expedienteRef: '123/2025' };
        const esperado = motor.calcular({ supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-15', fechaBaja: '2026-09-26', salario: 15000, periodo: 'mensual' });
        const vuelta = await sb.accCalcularLaboral(p);
        igual('el mensaje lo pinta el propio resultado', vuelta, '');
        const html = estado.mensajes[estado.mensajes.length - 1];
        verificar('con el total del motor', html.includes('Total bruto: <strong>' + motor.dinero(esperado.totales.bruto)), html);
        verificar('con cada concepto', esperado.conceptos.every(c => html.includes(c.concepto)), html);
        verificar('con el neto estimado', html.includes(motor.dinero(esperado.totales.neto)), html);
        verificar('con el expediente al que se guardaría', html.includes('123/2025'), html);
        verificar('sugiere sumar los meses de juicio', /cuántos meses duró/.test(html), html);
        verificar('y los 20 días', /20 días por año/.test(html), html);
        verificar('dice el total en voz alta', /total bruto \$/.test(estado.dicho[estado.dicho.length - 1]), estado.dicho[estado.dicho.length - 1]);
        igual('recuerda el cálculo para ajustarlo', sb.ultimoCalculoLaboral.salario, 15000);
        igual('con su expediente', sb.ultimoCalculoLaboral.expedienteId, 7);

        let error = null;
        try { await sb.accCalcularLaboral({ supuesto: 'renuncia' }); } catch (e) { error = e; }
        verificar('sin datos, no calcula: pregunta', error && error._esAviso && /fecha entró/.test(error.message), error && error.message);
    }

    console.log('\nEl prompt y la guía');
    {
        const prompt = extraerIndentado(VOZ, 'construirPromptSistema');
        verificar('el prompt ofrece calcular_laboral', /"calcular_laboral"/.test(prompt));
        for (const clave of Object.keys(motor.SUPUESTOS)) {
            verificar(`el prompt conoce el supuesto ${clave}`, new RegExp('\\b' + clave + '\\b').test(prompt));
        }
        verificar('el prompt incluye el último cálculo', /ÚLTIMO CÁLCULO LABORAL/.test(prompt) && /ultimoCalculoLaboral/.test(prompt));
        verificar('navegar llega a la calculadora', /"laboral"/.test(prompt) && /'laboral'/.test(extraerIndentado(VOZ, 'accNavegar')));
        verificar('la acción se ejecuta', /case 'calcular_laboral':/.test(extraerIndentado(VOZ, 'ejecutarAccionResuelta')));
        verificar('antes se revisa que no falte nada', /accion === 'calcular_laboral'/.test(extraerIndentado(VOZ, 'procesarRespuestaIA')));
        verificar('la guía de comandos tiene su sección', /titulo: '🧮 Calculadora laboral'/.test(VOZ));
        const tour = fs.readFileSync(path.join(JS, 'tour.js'), 'utf8');
        verificar('el recorrido de la calculadora enseña que se le puede pedir al asistente',
            /laboral: \{[\s\S]*?objetivo: '#voz-fab'[\s\S]*?asistente/.test(tour));
    }

    console.log(`\n${pasadas} pruebas pasadas, ${fallos.length} fallidas`);
    if (fallos.length) process.exit(1);
    console.log('✓ El asistente reúne los datos del cálculo laboral y calcula con el motor.');
})().catch(e => { console.error(e); process.exit(1); });
