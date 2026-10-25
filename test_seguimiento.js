#!/usr/bin/env node
/**
 * Pruebas de la importación del seguimiento semanal (docs/js/seguimiento.js).
 *
 *   node test_seguimiento.js
 *
 * Lo que se fija aquí:
 *   - se lee indice_asuntos.json tal como lo deja la revisión de los viernes;
 *   - cada asunto se une con su expediente por número ("DIT-021/2026" es el
 *     21/2026; de una CI cuenta el número final), y sin número, por cliente;
 *   - importar dos veces no duplica: lo que ya está se actualiza (fecha,
 *     prioridad, nota), lo que el usuario terminó no se reabre y lo que ya no
 *     aparece se propone como terminado;
 *   - dos pendientes que solo difieren en la fecha no se confunden;
 *   - lo que el usuario asigna u omite a mano manda.
 *
 * Los asuntos son inventados: el formato es el real, los datos no.
 */

const fs = require('fs');
const path = require('path');
const S = require('./docs/js/seguimiento.js');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);

// ---- Un índice como el de la revisión semanal ----
function indice() {
    return [
        {
            carpeta: 'asunto laboral fiscalia perez',
            asunto: 'Juan Pérez Ruiz vs. Fiscalía General del Estado (reclasificación)',
            cliente: 'Juan Pérez Ruiz',
            materia: 'laboral (burocrático)',
            expedientes: ['DIT-021/2026 (también DIT-21/2026)'],
            estado: 'EN ESPERA',
            prioridad: 'MEDIA',
            audiencias: [],
            pendientes: [
                { accion: 'Confirmar que se presentó el escrito de alegatos del incidente de incompetencia y revisar el acuerdo recaído', tipo: 'SEGUIMIENTO', fecha_limite: '2026-10-23', nota: 'Arrastrado de la semana anterior' },
                { accion: 'Revisar la lista de estrados del Tribunal para detectar la interlocutoria del incidente', tipo: 'SEGUIMIENTO', fecha_limite: '2026-10-27', nota: '' },
                { accion: 'Si la interlocutoria declara la incompetencia, preparar amparo indirecto', tipo: 'ESCRITO', fecha_limite: null, nota: 'Estimado: 15 días hábiles' }
            ]
        },
        {
            carpeta: 'asuntos lopez / vs arquitectos',
            asunto: 'Ana López Mar vs Constructora Alfa — juicio ordinario civil (obra inconclusa)',
            cliente: 'Ana López Mar',
            materia: 'civil',
            expedientes: ['Exp. 174/2026 (juicio ordinario civil)'],
            estado: 'ACTIVO',
            prioridad: 'ALTA',
            pendientes: [
                { accion: 'Revisar acuerdo recaído al escrito de 29-sep (nuevo domicilio y oficios de búsqueda) en el exp. 174/2026', tipo: 'SEGUIMIENTO', fecha_limite: '2026-10-23', nota: 'No consta acuerdo en la carpeta' },
                { accion: 'Coordinar con el actuario la nueva diligencia de emplazamiento al demandado', tipo: 'AUDIENCIA/DILIGENCIA', fecha_limite: '2026-10-30', nota: 'Fecha estimada' }
            ]
        },
        {
            carpeta: 'asuntos lopez / vs arquitectos / querella fraude',
            asunto: 'Ana López Mar vs Constructora Alfa — querella por fraude',
            cliente: 'Ana López Mar',
            materia: 'penal',
            expedientes: ['CI FGE/QROO/BJ/07/15042/2026', 'Oficio de remisión FGE/QROO/CAN/DD/08/16410/2026'],
            estado: 'ACTIVO',
            prioridad: 'MEDIA',
            pendientes: [
                { accion: 'Agendar con la Fiscalía la entrega de los celulares para extracción forense', tipo: 'CLIENTE', fecha_limite: '2026-10-28', nota: '' }
            ]
        },
        {
            carpeta: 'fit and more',
            asunto: 'Gimnasio Fit and More — subarriendo del local',
            cliente: 'Gabriela Soto Luna',
            materia: 'civil',
            expedientes: [],
            estado: 'ACTIVO',
            prioridad: 'MEDIA',
            pendientes: [
                { accion: 'Enviar a la clienta el contrato de subarriendo revisado', tipo: 'ENTREGABLE', fecha_limite: '2026-10-26', nota: '' },
                { accion: 'Enviar a la clienta el contrato de subarriendo revisado.', tipo: 'ENTREGABLE', fecha_limite: '2026-10-24', nota: 'repetido en el índice' }
            ]
        },
        {
            carpeta: 'divorcio terminado',
            asunto: 'Divorcio que ya concluyó',
            cliente: 'Cliente X',
            expedientes: ['Exp. 99/2025'],
            estado: 'CONCLUIDO',
            pendientes: [{ accion: 'Archivar el expediente', tipo: 'SEGUIMIENTO', fecha_limite: '2026-10-26' }]
        }
    ];
}

const expedientes = [
    { id: 1, numero: 'DIT-21/2026', nombre: 'Pérez vs FGE', cliente: 'Juan Pérez Ruiz', institucion: 'TCA' },
    { id: 2, numero: '174/2026', nombre: 'López vs Constructora Alfa', cliente: 'Ana López Mar', juzgado: 'Cuarto Civil' },
    { id: 3, numero: '174/2026', nombre: 'Otro asunto con el mismo número', cliente: 'Roberto Díaz', juzgado: 'Segundo Familiar' },
    { id: 4, numero: '15042/2026', nombre: 'Querella López', cliente: 'Ana López Mar', institucion: 'FGE' },
    { id: 5, numero: '300/2026', nombre: 'Subarriendo', cliente: 'Gabriela Soto Luna' }
];

// Simula lo que haría la app al aplicar: crea los nuevos con id, aplica cambios.
let siguienteId = 100;
function aplicar(plan, pendientes) {
    const lista = pendientes.map(p => ({ ...p }));
    for (const a of plan.asuntos) {
        for (const p of a.pendientes) {
            if (p.accionPlan === 'nuevo') lista.push({ id: siguienteId++, completado: false, ...p.datos });
            else if ((p.accionPlan === 'actualizar' || p.accionPlan === 'igual') && p.cambios) {
                const x = lista.find(y => y.id === p.existente.id);
                Object.assign(x, p.cambios);
            }
        }
    }
    for (const d of plan.desaparecidos) lista.find(y => y.id === d.id).completado = true;
    return lista;
}

console.log('\nLeer el índice');
{
    const { asuntos, errores } = S.leerIndice(indice());
    igual('lee los cinco asuntos sin errores', [asuntos.length, errores.length], [5, 0]);
    igual('el concluido queda fuera', asuntos.map(a => a.fuera), [false, false, false, false, true]);
    igual('un pendiente repetido en el mismo asunto queda una vez, con la fecha más próxima',
        asuntos[3].pendientes.map(p => [p.accion, p.fecha]), [['Enviar a la clienta el contrato de subarriendo revisado', '2026-10-24']]);
    igual('la prioridad del pendiente es la del asunto', [asuntos[0].pendientes[0].prioridad, asuntos[1].pendientes[0].prioridad], ['media', 'alta']);
    igual('sin fecha límite queda sin fecha', asuntos[0].pendientes[2].fecha, null);
    igual('también acepta { asuntos: [...] }', S.leerIndice({ asuntos: indice() }).asuntos.length, 5);
    let error = null;
    try { S.leerIndice({ hola: 1 }); } catch (e) { error = e.message; }
    verificar('un JSON que no es índice se rechaza con un mensaje claro', /no es un índice de asuntos/.test(error || ''), error);
    igual('una fecha imposible no pasa', S.fechaValida('2026-02-30'), null);
}

console.log('\nNúmeros de expediente');
{
    const n = t => [...S.numerosEn(t)];
    igual('"Exp. 174/2026 (juicio…)"', n('Exp. 174/2026 (juicio ordinario civil)'), ['174/2026']);
    igual('"DIT-021/2026 (también DIT-21/2026)" es uno solo: 21/2026', n('DIT-021/2026 (también DIT-21/2026)'), ['21/2026']);
    igual('de una carpeta de investigación cuenta el número final', n('CI FGE/QROO/BJ/07/15042/2026'), ['15042/2026']);
    igual('amparo con sufijo de mesa', n('amparo indirecto 220/2026-V'), ['220/2026']);
}

console.log('\nUnir cada asunto con su expediente');
{
    const { asuntos } = S.leerIndice(indice());
    const e = a => { const r = S.emparejar(a, expedientes); return [r.expediente && r.expediente.id, r.por]; };
    igual('DIT-021/2026 encuentra el DIT-21/2026', e(asuntos[0]), [1, 'numero']);
    igual('174/2026 está en dos juzgados: decide el cliente', e(asuntos[1]), [2, 'numero']);
    igual('la querella se une por el número de la CI', e(asuntos[2]), [4, 'numero']);
    igual('sin número, se propone por el cliente (para confirmar)', e(asuntos[3]), [5, 'nombre']);
    igual('sin número ni cliente parecido, no se adivina', S.emparejar({ ...asuntos[3], cliente: 'Nadie Conocido', titulo: 'Algo' }, expedientes).expediente, null);
}

console.log('\nPrimera importación');
let pendientes = [];
{
    const entrada = S.leerIndice(indice());
    const plan = S.planificar(entrada, { expedientes, pendientes, revision: '2026-10-23' });
    igual('todo es nuevo: 3 + 2 + 1 + 1 (el concluido no)', [plan.totales.nuevos, plan.totales.fuera], [7, 1]);
    const p = plan.asuntos[0].pendientes[0].datos;
    igual('el pendiente cuelga del expediente', p.expedienteId, 1);
    igual('con fecha del día, a medianoche local', [S.diaDe(p.fechaLimite), new Date(p.fechaLimite).getHours()], ['2026-10-23', 0]);
    igual('con prioridad', p.prioridad, 'media');
    verificar('la descripción lleva tipo, nota y asunto', /Tipo: SEGUIMIENTO/.test(p.descripcion) && /Arrastrado/.test(p.descripcion) && /Asunto: Juan Pérez/.test(p.descripcion), p.descripcion);
    igual('y recuerda de dónde vino', p.origen, { tipo: 'seguimiento', asunto: 'asunto laboral fiscalia perez', revision: '2026-10-23' });
    igual('sin fecha límite, sin fecha', plan.asuntos[0].pendientes[2].datos.fechaLimite, null);
    pendientes = aplicar(plan, pendientes);
}

console.log('\nLa misma revisión otra vez no duplica');
{
    const plan = S.planificar(S.leerIndice(indice()), { expedientes, pendientes, revision: '2026-10-23' });
    igual('nada nuevo, nada que actualizar, nada desaparecido', [plan.totales.nuevos, plan.totales.actualizar, plan.totales.desaparecidos, plan.totales.iguales], [0, 0, 0, 7]);
}

console.log('\nLa revisión del viernes siguiente');
{
    const sig = indice();
    // Se movió una fecha y cambió la nota.
    sig[0].pendientes[1].fecha_limite = '2026-11-03';
    sig[0].pendientes[1].nota = 'Van siete semanas';
    // Se redactó un poco distinto.
    sig[1].pendientes[1].accion = 'Coordinar con el actuario la nueva diligencia de emplazamiento al demandado en su nuevo domicilio';
    // Uno se resolvió y ya no aparece.
    sig[0].pendientes.splice(2, 1);
    // Uno nuevo que se redacta igual que otro, salvo la fecha del escrito.
    sig[1].pendientes.push({ accion: 'Revisar acuerdo recaído al escrito de 8-oct (nuevo domicilio y oficios de búsqueda) en el exp. 174/2026', tipo: 'SEGUIMIENTO', fecha_limite: '2026-10-30' });
    // El usuario ya terminó uno que la revisión sigue arrastrando.
    const yaHecho = pendientes.find(p => /celulares/.test(p.titulo));
    yaHecho.completado = true;

    const plan = S.planificar(S.leerIndice(sig), { expedientes, pendientes, revision: '2026-10-30' });
    const de = (i, j) => plan.asuntos[i].pendientes[j];
    igual('la fecha que cambió se actualiza', [de(0, 1).accionPlan, S.diaDe(de(0, 1).cambios.fechaLimite)], ['actualizar', '2026-11-03']);
    verificar('y su nota también', /siete semanas/.test(de(0, 1).cambios.descripcion || ''));
    igual('lo redactado un poco distinto es el mismo pendiente: se actualiza el texto', [de(1, 1).accionPlan, !!de(1, 1).cambios.titulo], ['actualizar', true]);
    igual('el escrito del 8-oct no se confunde con el del 29-sep: es nuevo', de(1, 2).accionPlan, 'nuevo');
    igual('el del 29-sep sigue igual', de(1, 0).accionPlan, 'igual');
    igual('lo que el usuario terminó no se reabre', de(2, 0).accionPlan, 'terminado');
    igual('el que ya no aparece se propone como terminado', plan.desaparecidos.map(d => d.titulo), ['Si la interlocutoria declara la incompetencia, preparar amparo indirecto']);
    igual('los que no cambiaron quedan anotados con la revisión nueva', de(1, 0).cambios.origen.revision, '2026-10-30');
}

console.log('\nLo que ya estaba capturado a mano');
{
    const manuales = [{ id: 7, titulo: 'Coordinar con actuario la diligencia de emplazamiento al demandado', expedienteId: 2, fechaLimite: null, prioridad: '', completado: false }];
    const plan = S.planificar(S.leerIndice(indice()), { expedientes, pendientes: manuales, revision: '2026-10-23' });
    const p = plan.asuntos[1].pendientes[1];
    igual('un pendiente parecido del mismo expediente es el mismo: no se duplica', [p.accionPlan, p.existente.id], ['actualizar', 7]);
    igual('se le pone fecha y prioridad, pero su título lo escribió el usuario y se respeta',
        [S.diaDe(p.cambios.fechaLimite), p.cambios.prioridad, p.cambios.titulo], ['2026-10-30', 'alta', undefined]);
    igual('y queda vinculado al seguimiento para la próxima semana', p.cambios.origen.tipo, 'seguimiento');
}

console.log('\nLo que el usuario decide manda');
{
    const entrada = S.leerIndice(indice());
    const plan = S.planificar(entrada, { expedientes, pendientes: [], asignaciones: { 'fit and more': null, 'asuntos lopez / vs arquitectos / querella fraude': 'omitir' } });
    igual('"sin expediente": el pendiente lleva el nombre del asunto', [plan.asuntos[3].expedienteId, plan.asuntos[3].pendientes[0].datos.expedienteTexto],
        [null, 'Gimnasio Fit and More — subarriendo del local']);
    igual('"no importar": el asunto no aporta nada', [plan.asuntos[2].omitido, plan.asuntos[2].pendientes.length, plan.totales.omitidos], [true, 0, 1]);

    // Uno importado antes de un asunto que luego se omite no se propone como terminado.
    const antes = [{ id: 50, titulo: 'Agendar con la Fiscalía la entrega de los celulares para extracción forense', completado: false,
        expedienteId: 4, origen: { tipo: 'seguimiento', asunto: 'asuntos lopez / vs arquitectos / querella fraude' } }];
    const plan2 = S.planificar(entrada, { expedientes, pendientes: antes, asignaciones: { 'asuntos lopez / vs arquitectos / querella fraude': 'omitir' } });
    igual('lo de un asunto omitido no se da por terminado', plan2.desaparecidos.length, 0);

    // Si el número no coincide pero antes se asignó a mano, se recuerda.
    const sinNumero = expedientes.filter(e => e.id !== 1);
    const previo = [{ id: 60, titulo: 'Algo viejo de este asunto', completado: true, expedienteId: 5, origen: { tipo: 'seguimiento', asunto: 'asunto laboral fiscalia perez' } }];
    const plan3 = S.planificar(entrada, { expedientes: sinNumero, pendientes: previo });
    igual('se usa el expediente al que se asignó la vez anterior', [plan3.asuntos[0].expedienteId, plan3.asuntos[0].por], [5, 'antes']);
}

console.log('\nLo que se le dice al asistente');
{
    for (const t of ['actualiza mis pendientes', 'Actualiza pendientes', 'actualízame los pendientes', 'pon al día mis pendientes',
        'importa el seguimiento semanal', 'seguimiento semanal', 'sincroniza mis pendientes']) {
        verificar(`"${t}" la abre`, S.esPeticionAbrir(t));
    }
    for (const t of ['muéstrame mis pendientes', 'qué pendientes tengo hoy', 'actualiza el pendiente 3', 'actualiza la fecha del pendiente',
        'crea un pendiente', 'actualiza el expediente 174/2026']) {
        verificar(`"${t}" es otra cosa`, !S.esPeticionAbrir(t));
    }
}

console.log('\nEn la app');
{
    const html = fs.readFileSync(path.join(__dirname, 'docs', 'index.html'), 'utf8');
    verificar('el script se carga', html.includes('<script src="js/seguimiento.js"></script>'));
    verificar('no hay botón: está oculta', !/btn-seguimiento-semanal|SEGUIMIENTO\.abrir/.test(html));
    const voz = fs.readFileSync(path.join(__dirname, 'docs', 'js', 'voice-assistant.js'), 'utf8');
    verificar('el asistente la abre antes de llamar a la IA', /SEGUIMIENTO\.esPeticionAbrir\(texto\)/.test(voz));
    const guia = voz.slice(voz.indexOf('const EJEMPLOS'), voz.indexOf('// ==================== ESTADO'));
    verificar('ni la guía ni los ejemplos del asistente la mencionan', guia.length > 100 && !/seguimiento semanal|actualiza mis pendientes/i.test(guia));
    verificar('la paleta de comandos tampoco', !/seguimiento/i.test(fs.readFileSync(path.join(__dirname, 'docs', 'js', 'command-palette.js'), 'utf8')));
    verificar('y funciona sin internet', /'js\/seguimiento\.js'/.test(fs.readFileSync(path.join(__dirname, 'docs', 'sw.js'), 'utf8')));
    verificar('crear un pendiente conserva su origen', /pendiente\.origen = \{ \.\.\.datos\.origen \}/.test(fs.readFileSync(path.join(__dirname, 'docs', 'js', 'acciones-core.js'), 'utf8')));
}

console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
if (fallos.length) {
    console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
}
