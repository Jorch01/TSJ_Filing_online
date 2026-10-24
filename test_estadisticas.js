#!/usr/bin/env node
/**
 * Pruebas del motor de estadísticas (docs/js/estadisticas.js).
 *
 *   node test_estadisticas.js
 *
 * Lo que se fija aquí, con un despacho armado a mano y la hora congelada:
 *   - los periodos (30 días, este mes, 12 meses, todo, un rango al revés) y
 *     el periodo anterior del mismo largo contra el que se compara;
 *   - la materia que se deduce del juzgado (una sala "civil mercantil y
 *     familiar" es una sola materia) y la que se captura a mano;
 *   - los tiempos: la duración cuenta desde el inicio del asunto si se
 *     capturó, la antigüedad cae en su tramo, la mediana es la de verdad;
 *   - "sin movimiento": cualquier nota, pendiente o cambio lo reinicia, y un
 *     asunto con algo agendado no está estancado;
 *   - pendientes: uno de "todo el día" que vence hoy no está vencido hasta que
 *     acaba el día; a tiempo, tiempo para terminar, prioridades;
 *   - la agenda no cuenta dos veces lo que ya es un pendiente;
 *   - clientes sin importar acentos ni mayúsculas, y los filtros arrastran
 *     pendientes y eventos;
 *   - resultados: favorable o parcial cuentan como favorables;
 *   - lo que conecta el motor con la app: los campos nuevos viajan en la
 *     sincronización y la página está en el menú y en el asistente.
 */

const fs = require('fs');
const path = require('path');
const E = require('./docs/js/estadisticas.js');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);

// Hora congelada: jueves 22 de octubre de 2026, 12:00 locales.
const AHORA = new Date(2026, 9, 22, 12, 0).getTime();
const DIA = 864e5;
const hace = (dias, hora = 10) => { const d = new Date(AHORA - dias * DIA); d.setHours(hora, 0, 0, 0); return d.toISOString(); };
const ymdHace = (dias) => { const d = new Date(AHORA - dias * DIA); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

let id = 0;
function exp(datos) {
    id++;
    return { id, numero: id + '/2026', institucion: 'TSJ', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN', fechaCreacion: hace(10), fechaActualizacion: hace(10), ...datos };
}
const calcular = (datos, opciones) => E.calcular({ pendientes: [], eventos: [], notas: [], historial: [], ...datos }, { ahora: AHORA, ...opciones });

console.log('\nPeriodos');
{
    const p30 = E.resolverPeriodo('30d', AHORA);
    igual('30 días son 30 días, de inicio a fin de día', p30.dias, 30);
    igual('y terminan hoy a las 23:59:59', new Date(p30.hasta).getHours(), 23);
    const pMes = E.resolverPeriodo('mes', AHORA);
    igual('este mes empieza el día 1', new Date(pMes.desde).getDate(), 1);
    const p12 = E.resolverPeriodo('12m', AHORA);
    igual('12 meses: del 23 de octubre pasado a hoy', [new Date(p12.desde).getFullYear(), new Date(p12.desde).getMonth(), new Date(p12.desde).getDate()], [2025, 9, 23]);
    const ant = E.periodoAnterior(p30);
    igual('el periodo anterior mide lo mismo', Math.round((ant.hasta + 1 - ant.desde) / DIA), 30);
    igual('y termina justo antes del actual', ant.hasta + 1, p30.desde);
    const rev = E.resolverPeriodo('rango', AHORA, '2026-06-30', '2026-06-01');
    igual('un rango escrito al revés se acomoda', [new Date(rev.desde).getDate(), new Date(rev.hasta).getDate()], [1, 30]);
    const todo = E.resolverPeriodo('todo', AHORA, null, null, new Date(2019, 4, 3).getTime());
    igual('"todo" empieza en lo más antiguo', new Date(todo.desde).getFullYear(), 2019);
    igual('y no tiene periodo anterior', E.periodoAnterior(todo), null);
    igual('un periodo desconocido es 12 meses', E.resolverPeriodo('xyz', AHORA).preset, '12m');
}

console.log('\nMateria y tipo de asunto');
{
    const m = (juzgado, extra) => E.materiaDe({ juzgado, institucion: 'TSJ', ...(extra || {}) });
    igual('juzgado familiar oral → Familiar', m('JUZGADO PRIMERO FAMILIAR ORAL CANCUN'), 'Familiar');
    igual('"de lo familiar" → Familiar', m('JUZGADO SEGUNDO DE LO FAMILIAR CANCUN'), 'Familiar');
    igual('sala civil mercantil y familiar es una sola materia', m('PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR'), 'Civil, mercantil y familiar');
    igual('sala penal → Penal', m('SEGUNDA SALA PENAL ORAL'), 'Penal');
    igual('tribunal laboral → Laboral', m('TRIBUNAL PRIMERO LABORAL CANCUN'), 'Laboral');
    igual('mercantil → Mercantil', m('JUZGADO ORAL MERCANTIL CANCUN'), 'Mercantil');
    igual('un juzgado de distrito sin materia, con amparo → Amparo',
        E.materiaDe({ juzgado: 'Juzgado Segundo de Distrito en el Estado de Quintana Roo', institucion: 'PJF', pjfTipoAsunto: 'Amparo Indirecto' }), 'Amparo');
    igual('un colegiado "en Materia Penal" → Penal',
        E.materiaDe({ juzgado: 'Primer Tribunal Colegiado en Materia Penal del Primer Circuito', institucion: 'PJF' }), 'Penal');
    igual('otra autoridad', E.materiaDe({ juzgado: 'Junta Local', institucion: 'OTRO' }), 'Otras autoridades');
    igual('la materia capturada a mano manda', m('JUZGADO PRIMERO CIVIL CANCUN', { materia: 'arrendamiento' }), 'Arrendamiento');
    igual('el tipo de asunto capturado', E.tipoAsuntoDe({ tipo: 'Divorcio' }), 'Divorcio');
    igual('o el del catálogo del PJF', E.tipoAsuntoDe({ pjfTipoAsunto: 'Amparo Directo' }), 'Amparo Directo');
    igual('sin tipo', E.tipoAsuntoDe({}), E.SIN_TIPO);
}

console.log('\nTiempos');
{
    const exps = [
        // Cerrado en el periodo: inicio capturado hace 400 días, archivado hace 10.
        exp({ fechaInicioAsunto: ymdHace(400), fechaCreacion: hace(30), archivado: true, fechaArchivo: hace(10), motivoArchivo: 'concluido', resultado: 'favorable' }),
        // Cerrado en el periodo sin inicio capturado: cuenta desde el alta (hace 200).
        exp({ fechaCreacion: hace(200), archivado: true, fechaArchivo: hace(0), motivoArchivo: 'abandonado' }),
        // Cerrado hace dos años: fuera del periodo de 12 meses.
        exp({ fechaCreacion: hace(900), archivado: true, fechaArchivo: hace(800), motivoArchivo: 'concluido', resultado: 'desfavorable' }),
        // Activos de distintas antigüedades.
        exp({ fechaInicioAsunto: ymdHace(20) }),
        exp({ fechaInicioAsunto: ymdHace(100) }),
        exp({ fechaInicioAsunto: ymdHace(300) }),
        exp({ fechaInicioAsunto: ymdHace(500), fechaCreacion: hace(5) }),
        exp({ fechaInicioAsunto: ymdHace(1000), fechaCreacion: hace(5) }),
        // Borrado: no cuenta para nada.
        exp({ activo: false, fechaCreacion: hace(3) })
    ];
    const r = calcular({ expedientes: exps }, { periodo: '12m' });
    igual('activos (sin el borrado)', r.kpis.activos, 5);
    igual('cerrados en el periodo', r.kpis.cerrados.valor, 2);
    igual('de ellos, concluidos', r.kpis.cerrados.concluidos, 1);
    // 390 días (inicio capturado) y 200 días (alta): mediana 295.
    igual('la duración usa el inicio capturado, o el alta si no hay', Math.round(r.kpis.duracionMediana), 295);
    igual('antigüedad por tramos', r.antiguedad.map(t => t.valor), [1, 1, 1, 1, 1]);
    igual('mediana de un número par de valores', E.mediana([1, 2, 3, 10]), 2.5);
    igual('mediana de nada', E.mediana([]), null);
    igual('12 días', E.textoDuracion(12), '12 días');
    igual('1 día', E.textoDuracion(1), '1 día');
    igual('más de dos meses se dice en meses', E.textoDuracion(295), '9.7 meses');
    igual('más de dos años, en años', E.textoDuracion(1000), '2.7 años');
    igual('sin dato', E.textoDuracion(null), '—');
    const nuevos = calcular({ expedientes: exps }, { periodo: '30d' }).kpis.nuevos;
    igual('nuevos en 30 días (por su alta)', nuevos.valor, 5);
}

console.log('\nSin movimiento');
{
    const quieto = exp({ fechaCreacion: hace(200), fechaActualizacion: hace(200) });
    const conNota = exp({ fechaCreacion: hace(200), fechaActualizacion: hace(200) });
    const conAudiencia = exp({ fechaCreacion: hace(200), fechaActualizacion: hace(200) });
    const conPendiente = exp({ fechaCreacion: hace(200), fechaActualizacion: hace(200) });
    const conHistorial = exp({ fechaCreacion: hace(200), fechaActualizacion: hace(200) });
    const r = calcular({
        expedientes: [quieto, conNota, conAudiencia, conPendiente, conHistorial],
        notas: [{ expedienteId: conNota.id, fechaCreacion: hace(5) }],
        eventos: [{ expedienteId: conAudiencia.id, tipo: 'audiencia', fechaInicio: hace(-20) }],
        pendientes: [{ expedienteId: conPendiente.id, completado: true, fechaCreacion: hace(150), fechaCompletado: hace(3) }],
        historial: [{ expedienteId: conHistorial.id, fecha: hace(30) }]
    });
    igual('solo el que de verdad está quieto', r.sinMovimiento.map(x => x.id), [quieto.id]);
    igual('con sus días sin movimiento', r.sinMovimiento[0].dias, 200);
    igual('y el contador de la cifra', r.kpis.estancados, 1);
}

console.log('\nPendientes');
{
    const e1 = exp({ prioridad: '' });
    const hoyFin = new Date(AHORA); hoyFin.setHours(0, 0, 0, 0);
    const pendientes = [
        { id: 1, expedienteId: e1.id, completado: false, fechaLimite: hace(3), prioridad: 'alta' },                   // vencido
        { id: 2, expedienteId: e1.id, completado: false, fechaLimite: hoyFin.toISOString(), todoElDia: true },          // vence hoy: aún no
        { id: 3, expedienteId: e1.id, completado: false, fechaLimite: hace(-3) },                                      // esta semana
        { id: 4, expedienteId: e1.id, completado: false, fechaLimite: hace(-30), prioridad: 'baja' },                 // más adelante
        { id: 5, expedienteId: e1.id, completado: false, fechaLimite: null },                                          // sin fecha
        { id: 6, expedienteId: e1.id, completado: true, fechaCreacion: hace(12), fechaLimite: hace(5), fechaCompletado: hace(6) },   // a tiempo, 6 días
        { id: 7, expedienteId: e1.id, completado: true, fechaCreacion: hace(20), fechaLimite: hace(15), fechaCompletado: hace(2) },  // tarde, 18 días
        { id: 8, expedienteId: e1.id, completado: true, fechaCreacion: hace(4), fechaLimite: null, fechaCompletado: hace(1) }        // sin fecha, 3 días
    ];
    const r = calcular({ expedientes: [e1], pendientes }, { periodo: '30d' });
    const p = r.pendientes;
    igual('abiertos', p.abiertos, 5);
    igual('vencidos: el de "todo el día" que vence hoy no cuenta', p.vencidos, 1);
    igual('vencen en 7 días (incluye el de hoy)', p.estaSemana, 2);
    igual('más adelante y sin fecha', [p.masAdelante, p.sinFecha], [1, 1]);
    igual('terminados en el periodo', p.completados, 3);
    igual('a tiempo: 1 de los 2 que tenían fecha', [p.aTiempo, p.conFecha], [1, 2]);
    igual('tiempo típico para terminar (mediana de 6, 18 y 3)', Math.round(p.resolucionMediana), 6);
    igual('por prioridad: la alta tiene el vencido', p.porPrioridad.find(x => x.clave === 'alta'), { clave: 'alta', etiqueta: 'Alta', abiertos: 1, vencidos: 1, completados: 0 });
    igual('el expediente con más pendientes', [p.porExpediente[0].id, p.porExpediente[0].abiertos, p.porExpediente[0].vencidos], [e1.id, 5, 1]);
}

console.log('\nAgenda');
{
    const e1 = exp({});
    const eventos = [
        { expedienteId: e1.id, tipo: 'audiencia', fechaInicio: hace(-2) },
        { expedienteId: e1.id, tipo: 'audiencia', fechaInicio: hace(-40) },
        { expedienteId: e1.id, tipo: 'vencimiento', fechaInicio: hace(-5) },
        // El evento que la app crea para la fecha de un pendiente.
        { expedienteId: e1.id, tipo: 'recordatorio', fechaInicio: hace(-1), pendienteId: 9 },
        { expedienteId: e1.id, tipo: 'audiencia', fechaInicio: hace(15) }
    ];
    const r = calcular({ expedientes: [e1], eventos }, { periodo: '30d' });
    igual('audiencias en los próximos 30 días', r.kpis.audienciasProximas, 1);
    igual('eventos del periodo por tipo, sin el espejo del pendiente', r.agenda.porTipo.map(t => t.valor), [1, 0, 0, 0]);
    igual('ocho semanas por delante', r.agenda.semanas.length, 8);
    igual('las semanas empiezan en lunes', new Date(r.agenda.semanas[0].desde).getDay(), 1);
    igual('esta semana: la audiencia del sábado y el vencimiento del martes no, ese es la siguiente',
        [r.agenda.semanas[0].audiencias, r.agenda.semanas[1].vencimientos], [1, 1]);
}

console.log('\nClientes, responsables y filtros');
{
    const a = exp({ cliente: 'Pérez', abogado: 'Jorge' });
    const b = exp({ cliente: 'perez ', abogado: 'jorge' });
    const c = exp({ cliente: 'Grupo Caribe', abogado: 'Frida', archivado: true, fechaArchivo: hace(5), motivoArchivo: 'concluido' });
    const d = exp({});
    const pendientes = [
        { expedienteId: a.id, completado: false, fechaLimite: hace(2) },
        { expedienteId: d.id, completado: false },
        { expedienteId: null, completado: false, titulo: 'Sin expediente' }
    ];
    const eventos = [{ expedienteId: b.id, tipo: 'audiencia', fechaInicio: hace(-3) }];
    const r = calcular({ expedientes: [a, b, c, d], pendientes, eventos }, {});
    const perez = r.clientes.find(x => x.clave === 'Pérez');
    igual('"Pérez" y "perez " son el mismo cliente', perez && [perez.activos, perez.pendientesAbiertos, perez.vencidos, perez.audienciasProximas], [2, 1, 1, 1]);
    igual('"Sin cliente registrado" va al final', r.clientes[r.clientes.length - 1].clave, E.SIN_CLIENTE);
    igual('los responsables se agrupan igual', r.responsables.find(x => x.clave === 'Jorge').activos, 2);
    igual('las opciones del filtro, sin repetir', r.opcionesFiltro.clientes, ['Grupo Caribe', 'Pérez', E.SIN_CLIENTE]);
    igual('sin filtro entran todos los pendientes, también el suelto', r.pendientes.abiertos, 3);

    const f = calcular({ expedientes: [a, b, c, d], pendientes, eventos }, { cliente: 'Pérez' });
    igual('con filtro de cliente: sus expedientes', f.kpis.activos, 2);
    igual('sus pendientes, no los de otros ni los sueltos', f.pendientes.abiertos, 1);
    igual('y sus audiencias', f.kpis.audienciasProximas, 1);
    igual('filtrar por materia', calcular({ expedientes: [a, exp({ juzgado: 'JUZGADO PRIMERO FAMILIAR ORAL CANCUN' })] }, { materia: 'Familiar' }).kpis.activos, 1);
    igual('filtrar por institución', calcular({ expedientes: [a, exp({ institucion: 'PJF', juzgado: 'Juzgado Primero de Distrito' })] }, { institucion: 'PJF' }).kpis.activos, 1);
}

console.log('\nResultados');
{
    const cerrado = (resultado, motivo) => exp({ archivado: true, fechaArchivo: hace(5), motivoArchivo: motivo || 'concluido', resultado });
    const r = calcular({ expedientes: [cerrado('favorable'), cerrado('parcial'), cerrado('desfavorable'), cerrado('convenio'), cerrado(undefined, 'abandonado')] }, { periodo: '30d' });
    igual('favorables = favorable o parcial, de los que tienen resultado', [r.kpis.favorables.favorables, r.kpis.favorables.conResultado], [2, 4]);
    igual('el reparto, con "sin registrar" al final', r.resultados.map(x => x.valor), [1, 1, 1, 1, 0, 1]);
    igual('motivos de archivo', r.motivos.map(x => x.valor), [4, 1, 0]);
    igual('por materia', [r.resultadosPorMateria[0].cerrados, r.resultadosPorMateria[0].favorables, r.resultadosPorMateria[0].pct], [5, 2, 0.5]);
}

console.log('\nTendencia por mes');
{
    const r = calcular({ expedientes: [exp({ fechaCreacion: hace(5) }), exp({ fechaCreacion: hace(40), archivado: true, fechaArchivo: hace(4) })] }, { periodo: '30d' });
    igual('un periodo corto muestra al menos 6 meses', r.tendencia.length, 6);
    const ultimo = r.tendencia[r.tendencia.length - 1];
    igual('el mes actual cuenta las altas y los cierres', [ultimo.nuevos, ultimo.cerrados], [1, 1]);
    igual('"todo el historial" no pasa de 24 meses', calcular({ expedientes: [exp({ fechaCreacion: hace(2000) })] }, { periodo: 'todo' }).tendencia.length, 24);
}

console.log('\nUn despacho vacío');
{
    const r = calcular({ expedientes: [] }, {});
    igual('no truena y todo da cero', [r.kpis.activos, r.kpis.duracionMediana, r.kpis.favorables.pct, r.sinMovimiento.length], [0, null, null, 0]);
}

console.log('\nConectado con la app');
{
    const leer = f => fs.readFileSync(path.join(__dirname, 'docs', f), 'utf8');
    const app = leer('js/app.js');
    const lista = /const RESULTADOS_EXPEDIENTE = \[([\s\S]*?)\];/.exec(app);
    const enApp = lista ? [...lista[1].matchAll(/valor: '([^']+)', etiqueta: '([^']+)'/g)].map(m => [m[1], m[2]]) : [];
    igual('los resultados del diálogo de archivo son los mismos que mide el motor', enApp, E.RESULTADOS.map(r => [r.clave, r.etiqueta]));

    const sync = leer('js/sync.js');
    const campos = /const camposPorCampo = \[([\s\S]*?)\];/.exec(sync);
    for (const c of ['cliente', 'abogado', 'tipo', 'resultado', 'fechaInicioAsunto']) {
        verificar(`"${c}" se fusiona por campo al sincronizar (si no, la edición de otro dispositivo se pierde)`, !!campos && campos[1].includes(`'${c}'`));
    }
    const html = leer('index.html');
    igual('la página está en los dos menús', (html.match(/data-page="estadisticas"/g) || []).length, 2);
    verificar('la página existe', html.includes('id="page-estadisticas"') && html.includes('id="est-raiz"'));
    verificar('el formulario pide cliente, responsable, tipo e inicio',
        ['expediente-cliente', 'expediente-abogado', 'expediente-tipo', 'expediente-inicio'].every(i => html.includes(`id="${i}"`)));
    verificar('el script se carga', html.includes('<script src="js/estadisticas.js"></script>'));
    verificar('y se guarda para usarse sin internet', /'js\/estadisticas\.js'/.test(leer('sw.js')));
    verificar('navegar a la página la prepara', /pagina === 'estadisticas'[\s\S]{0,120}prepararEstadisticas/.test(app));
    verificar('se repinta cuando cambian los datos', /refrescarEstadisticasSiVisible/.test(leer('js/acciones-core.js')) && /refrescarEstadisticasSiVisible/.test(sync));
    const voz = leer('js/voice-assistant.js');
    verificar('el asistente sabe llevar a las estadísticas', /const paginas = \[[^\]]*'estadisticas'/.test(voz) && /"estadisticas" son las tablas/.test(voz));
}

console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
if (fallos.length) {
    console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
}
