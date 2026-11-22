#!/usr/bin/env node
/**
 * Pruebas de la cartera de marcas (docs/js/cartera-marcas.js).
 *
 *   node test_cartera_marcas.js
 *
 *  - Las fechas del IMPI («18/08/2011 11:47:18 AM») se leen bien, y las
 *    sumas de meses no se pasan de mes (31 de agosto + 6 meses = febrero).
 *  - Los plazos: declaración de uso a los tres años de otorgado el registro
 *    (solo con la ley de 2020) y renovación con sus seis meses de gracia.
 *  - Dos dispositivos que editan la misma marca no se pisan; el borrado viaja.
 *  - Lo que llega de MARCia y de Marcanet llena la marca sin borrar lo
 *    capturado, y Marcanet manda en el estatus y la vigencia.
 *  - La sincronización y los respaldos llevan la cartera.
 *
 * Se carga el código real de docs/js/.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const C = require('./docs/js/cartera-marcas.js');
const V = require('./docs/js/impi-viabilidad.js');
const R = require('./docs/js/reportes-pdf.js');

let pasadas = 0;
const fallos = [];
function verificar(d, c, det) { if (c) { pasadas++; return; } fallos.push(d + (det ? `\n      ${det}` : '')); }
function igual(d, real, esperado) {
    verificar(d, JSON.stringify(real) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}

const T0 = '2026-01-01T10:00:00.000Z', T1 = '2026-02-01T10:00:00.000Z', T2 = '2026-03-01T10:00:00.000Z';

console.log('\nFechas');
{
    igual('fecha del IMPI con hora', C.fecha('18/08/2011 11:47:18 AM'), '2011-08-18');
    igual('fecha corta del IMPI', C.fecha('9/8/2007'), '2007-08-09');
    igual('ISO', C.fecha('2026-11-22T10:00:00Z'), '2026-11-22');
    igual('lo que no es fecha, vacío', [C.fecha('31/02/2026'), C.fecha('mañana'), C.fecha(null)], ['', '', '']);
    igual('31 de agosto + 6 meses es fin de febrero', C.sumarMeses('2025-08-31', 6), '2026-02-28');
    igual('y en año bisiesto, el 29', C.sumarMeses('2027-08-31', 6), '2028-02-29');
    igual('restar meses', C.sumarMeses('2031-08-18', -6), '2031-02-18');
    igual('días entre dos fechas', [C.diasEntre('2026-01-01', '2026-03-01'), C.diasEntre('2026-03-01', '2026-01-01')], [59, -59]);
    igual('clases sueltas, repetidas y fuera de rango', C.clasesDe('35, 41 y 35; 99'), [35, 41]);
}

console.log('\nAlta y cambios');
{
    const m = C.nueva({ denominacion: '  Lunafardo ', expediente: '1204050', clases: '43', tipo: 'mixta', fechaConcesion: '21/11/2022', expedienteId: '7', estatus: 'REGISTRADA', otro: 'x' }, T0, 'u1');
    igual('se limpia lo capturado', [m.denominacion, m.clases, m.tipo, m.fechaConcesion, m.expedienteId], ['Lunafardo', [43], 'mixta', '2022-11-21', 7]);
    verificar('lo que no es un campo no se guarda', !('otro' in m));
    igual('cada campo lleva su sello', m.sellos.denominacion, T0);
    igual('el estatus inicial va al historial', m.historial, [{ fecha: T0, estatus: 'REGISTRADA' }]);
    const m2 = C.cambiar(m, { notas: 'cliente nuevo', denominacion: 'Lunafardo' }, T1);
    igual('solo se sella lo que cambia', [m2.sellos.notas, m2.sellos.denominacion], [T1, T0]);
    const m3 = C.cambiar(m2, { estatus: 'REGISTRADA, vigente hasta 21/11/2032' }, T2);
    igual('un cambio de estatus queda en el historial', m3.historial.map(h => h.estatus), ['REGISTRADA', 'REGISTRADA, vigente hasta 21/11/2032']);
    const m4 = C.cambiar(m3, { atendidos: { 'uso|2026-02-21': T2 } }, T2);
    igual('los atendidos llevan su propia fecha', m4.atendidos['uso|2026-02-21'], { valor: T2, en: T2 });
    const m5 = C.cambiar(m4, { atendidos: { 'uso|2026-02-21': null } }, T2);
    igual('y se pueden desmarcar', m5.atendidos['uso|2026-02-21'].valor, null);
    igual('el tipo desconocido no entra', C.nueva({ denominacion: 'X', tipo: 'holograma' }, T0, 'u2').tipo, '');

    const lista = [C.nueva({ denominacion: 'A', expediente: '001234567' }, T0, 'a'), C.nueva({ denominacion: 'B', registro: '1.261.657' }, T0, 'b')];
    igual('la misma marca se reconoce por el expediente', (C.buscarMisma(lista, { expediente: '1234567' }) || {}).uid, 'a');
    igual('o por el registro, se escriba como se escriba', (C.buscarMisma(lista, { registro: '1261657' }) || {}).uid, 'b');
    igual('sin números no se adivina', C.buscarMisma(lista, { denominacion: 'A' }), null);
}

console.log('\nSituación');
{
    const s = e => C.situacion({ estatus: e, registro: '', expediente: '' });
    igual('registrada', [s('REGISTRADO'), s('REGISTRADA, vigente hasta 18/08/2031'), s('CONCEDIDA')], ['registrada', 'registrada', 'registrada']);
    igual('en trámite', [s('EN TRÁMITE'), s('EN TRÁMITE, con oposición')], ['tramite', 'tramite']);
    igual('sin efectos', [s('ABANDONADA'), s('NEGADA'), s('CADUCADA'), s('DESISTIDA')], ['inactiva', 'inactiva', 'inactiva', 'inactiva']);
    igual('con registro y sin estatus, registrada', C.situacion({ estatus: '', registro: '123', expediente: '9' }), 'registrada');
    igual('con solo expediente, en trámite', C.situacion({ estatus: '', registro: '', expediente: '9' }), 'tramite');
    igual('sin nada', C.situacion({ estatus: '', registro: '', expediente: '' }), 'desconocida');
    igual('la vigencia terminada sigue siendo registrada (puede estar en gracia)', s('REGISTRADA, vigencia terminada el 09/08/2017'), 'registrada');
}

console.log('\nPlazos');
{
    // Otorgada con la ley de 2020: declaración de uso a los tres años.
    const nuevaLey = C.nueva({ denominacion: 'LUNA', registro: '2500000', estatus: 'REGISTRADA', fechaConcesion: '2022-11-21', vigencia: '2032-11-21' }, T0, 'n');
    const p = C.plazosDe(nuevaLey, '2026-01-10');
    igual('declaración de uso: tres meses desde el tercer año', p.find(x => x.tipo === 'uso'), {
        tipo: 'uso', titulo: 'Declaración de uso', desde: '2025-11-21', hasta: '2026-02-21', estimado: false,
        clave: 'uso|2026-02-21', atendido: false, pendienteId: null, estado: 'en_curso' });
    igual('renovación: seis meses antes de la vigencia', [p.find(x => x.tipo === 'renovacion').desde, p.find(x => x.tipo === 'renovacion').hasta], ['2032-05-21', '2032-11-21']);
    igual('el próximo plazo es la declaración en curso', C.textoPlazo(C.proximoPlazo(nuevaLey, '2026-01-10')), 'Declaración de uso: en curso, vence el 21/02/2026');
    igual('antes de empezar, a menos de 90 días: empieza pronto', C.proximoPlazo(nuevaLey, '2025-10-01').estado, 'proximo');
    igual('lejos todavía: por venir', C.proximoPlazo(nuevaLey, '2024-01-01').estado, 'futuro');
    igual('si ya pasó sin atenderse: vencido', C.proximoPlazo(nuevaLey, '2026-03-01').estado, 'vencido');
    const atendida = C.cambiar(nuevaLey, { atendidos: { 'uso|2026-02-21': T1 } }, T1);
    igual('atendida, el siguiente es la renovación', C.proximoPlazo(atendida, '2026-03-01').tipo, 'renovacion');

    // Otorgada antes de la ley de 2020: no hay declaración a los tres años.
    const vieja = C.nueva({ denominacion: 'LUNFARDO', registro: '1261657', estatus: 'REGISTRADA', fechaPresentacion: '18/08/2011', fechaConcesion: '01/02/2012', vigencia: '18/08/2031' }, T0, 'v');
    igual('registro anterior a la ley: sin declaración de uso', C.plazosDe(vieja, '2026-01-10').map(x => x.tipo), ['renovacion', 'gracia']);
    // Vencida la renovación: se muestra la gracia y no la renovación vencida.
    const enGracia = C.plazosVigentes(C.plazosDe(vieja, '2031-10-01'));
    igual('pasado el fin de la vigencia: periodo de gracia en curso', enGracia.map(x => x.tipo + ':' + x.estado), ['gracia:en_curso']);
    igual('en el periodo normal no aparece la gracia', C.plazosVigentes(C.plazosDe(vieja, '2031-04-01')).map(x => x.tipo + ':' + x.estado), ['renovacion:en_curso']);
    igual('pasada también la gracia: vencido', C.proximoPlazo(vieja, '2032-03-01').estado, 'vencido');

    // Sin vigencia: se estima, salvo que la estimación ya no sirva.
    const sinVig = C.nueva({ denominacion: 'SOL', registro: '3000000', estatus: 'REGISTRADA', fechaConcesion: '2023-05-10' }, T0, 's');
    const ren = C.plazosDe(sinVig, '2026-01-10').find(x => x.tipo === 'renovacion');
    igual('sin vigencia, con la ley nueva: diez años desde el otorgamiento, marcada como estimada', [ren.hasta, ren.estimado], ['2033-05-10', true]);
    const viejaSinVig = C.nueva({ denominacion: 'OLD', registro: '400000', estatus: 'REGISTRADA', fechaPresentacion: '1990-01-01' }, T0, 'o');
    igual('una marca vieja sin vigencia: no se inventa un plazo de hace años', C.plazosDe(viejaSinVig, '2026-01-10'), []);
    igual('en trámite no tiene plazos', C.plazosDe(C.nueva({ denominacion: 'X', expediente: '1', estatus: 'EN TRÁMITE', fechaConcesion: '2022-01-01' }, T0, 't'), '2026-01-10'), []);
    igual('negada tampoco', C.plazosDe(C.nueva({ denominacion: 'X', registro: '1', estatus: 'NEGADA', vigencia: '2030-01-01' }, T0, 'q'), '2026-01-10'), []);

    const lista = [nuevaLey, vieja, sinVig, C.cambiar(C.nueva({ denominacion: 'BORRADA', registro: '9', estatus: 'REGISTRADA', vigencia: '2026-02-01' }, T0, 'z'), { eliminada: T1 }, T1)];
    igual('resumen: sin contar la borrada', C.resumen(lista, '2026-01-10'), { total: 3, registradas: 3, tramite: 0, otras: 0, enCurso: 1, proximos: 0, vencidos: 0 });
    // LUNA tiene la declaración en curso; SOL, su declaración en mayo; LUNFARDO, la renovación en 2031.
    igual('orden: primero lo urgente', C.ordenar(lista, '2026-01-10').map(m => m.denominacion), ['LUNA', 'SOL', 'LUNFARDO']);
}

console.log('\nDos dispositivos');
{
    const base = C.nueva({ denominacion: 'LUNA', expediente: '1', cliente: 'Pérez', estatus: 'EN TRÁMITE' }, T0, 'u');
    const enLaPC = C.cambiar(base, { notas: 'llamar al cliente' }, T1);
    const enElTel = C.cambiar(base, { cliente: 'Pérez Ruiz', estatus: 'REGISTRADA' }, T2);
    const f = C.fusionar([enLaPC], [enElTel]);
    igual('cada uno conserva lo que cambió', [f[0].notas, f[0].cliente, f[0].estatus], ['llamar al cliente', 'Pérez Ruiz', 'REGISTRADA']);
    igual('y el historial de estatus se junta', f[0].historial.map(h => h.estatus), ['EN TRÁMITE', 'REGISTRADA']);
    igual('en un orden o en otro da lo mismo', JSON.stringify(C.fusionar([enElTel], [enLaPC])), JSON.stringify(f));
    igual('volver a fusionar no cambia nada', JSON.stringify(C.fusionar(f, f)), JSON.stringify(f));
    const borrada = C.cambiar(enLaPC, { eliminada: T2 }, T2);
    igual('el borrado viaja como un cambio más', C.activas(C.fusionar([borrada], [enElTel])).length, 0);
    const mismoSello = C.cambiar(base, { notas: 'a' }, T1), otroMismoSello = C.cambiar(base, { notas: 'b' }, T1);
    igual('con el mismo sello, todos llegan al mismo resultado', C.fusionar([mismoSello], [otroMismoSello])[0].notas, C.fusionar([otroMismoSello], [mismoSello])[0].notas);
    const p1 = C.cambiar(base, { pendientes: { 'uso|2026-02-21': 11 } }, T1);
    const p2 = C.cambiar(base, { atendidos: { 'renovacion|2032-11-21': T2 } }, T2);
    const fp = C.fusionar([p1], [p2])[0];
    igual('los mapas se juntan clave por clave', [fp.pendientes['uso|2026-02-21'].valor, !!fp.atendidos['renovacion|2032-11-21'].valor], [11, true]);
    const otra = C.nueva({ denominacion: 'SOL' }, T0, 'v');
    igual('lo que solo está en un lado se queda', C.fusionar([base], [otra]).map(m => m.uid), ['u', 'v']);
    const vieja = { uid: 'u', denominacion: 'LUNA' };
    igual('una versión incompleta (de otra app) no rompe nada', C.fusionar([base], [vieja])[0].cliente, 'Pérez');
    igual('lo que llega vacío no borra la cartera', C.fusionar([base], []).length, 1);
}

console.log('\nLo que llega del IMPI');
{
    const fila = { id: 'RM201101204050', applicationNumber: '1204050', registrationNumber: '1261657', title: 'LUNFARDO', status: 'REGISTRADO',
        owners: ['RESTAURANTES DEL SUR'], dates: { application: '18/08/2011', expiry: '18/08/2021' }, classes: [43], images: 'https://prod.impi.static.tmv.io/x' };
    const deFila = C.limpiar(C.desdeResultadoMARCia(fila));
    igual('fila de MARCia', [deFila.denominacion, deFila.expediente, deFila.registro, deFila.titular, deFila.clases, deFila.fechaPresentacion, deFila.vigencia, deFila.markId],
        ['LUNFARDO', '1204050', '1261657', 'RESTAURANTES DEL SUR', [43], '2011-08-18', '2021-08-18', 'RM201101204050']);
    igual('la imagen https se queda', deFila.imagen, 'https://prod.impi.static.tmv.io/x');
    igual('la que MARCia da como ruta de su sitio se guarda completa',
        C.desdeResultadoMARCia({ ...fila, images: '/marcas/image/RM201101204050' }).imagen, 'https://marcia.impi.gob.mx/marcas/image/RM201101204050');
    igual('y lo raro no se guarda', ['javascript:alert(1)', '//otro.com/x.png', '/marcas/../../x', 'http://inseguro.com/x.png', 42].map(C.imagenDeMARCia), ['', '', '', '', '']);
    const ficha = { result: fila, details: { generalInformation: { registrationDate: '01/02/2012', applicationDate: '18/08/2011', expiryDate: '18/08/2021' },
        ownerInformation: { owners: [{ name: 'RESTAURANTES DEL SUR, S.A. DE C.V.' }] }, productsAndServices: [{ niceClass: 43 }], trademark: { id: 'RM201101204050' } } };
    const deFicha = C.limpiar(C.desdeFichaMARCia(ficha));
    igual('la ficha de MARCia trae la concesión y el titular completo', [deFicha.fechaConcesion, deFicha.titular], ['2012-02-01', 'RESTAURANTES DEL SUR, S.A. DE C.V.']);
    const det = { 'Número de registro': '1261657', 'Fecha de presentación': '18/08/2011 11:47:18 AM', 'Fecha de vigencia': '18/08/2031', 'Denominación': 'LUNFARDO',
        'Fecha de concesión': '01/02/2012', '43Edición 9 del Clasificador de Niza': 'RESTAURANTES' };
    const deMarcanet = C.desdeFichaMarcanet(det, Date.parse('2026-01-10'), V.leerDetalleMarcanet);
    igual('la ficha de Marcanet', [deMarcanet.registro, C.fecha(deMarcanet.fechaConcesion), C.fecha(deMarcanet.vigencia), deMarcanet.clases, deMarcanet.estatus],
        ['1261657', '2012-02-01', '2031-08-18', [43], 'REGISTRADA, vigente hasta 18/08/2031']);
    const junto = C.combinar(C.desdeFichaMARCia(ficha), deMarcanet);
    igual('Marcanet manda en la vigencia y el estatus (se actualiza al renovar)', [junto.vigencia, junto.estatus], ['2031-08-18', 'REGISTRADA, vigente hasta 18/08/2031']);
    igual('MARCia, en lo demás', [junto.titular, junto.markId, junto.fuente], ['RESTAURANTES DEL SUR, S.A. DE C.V.', 'RM201101204050', 'MARCia y Marcanet']);

    const capturada = C.nueva({ denominacion: 'LUNFARDO', registro: '1261657', cliente: 'Pérez', notas: 'ojo', estatus: 'REGISTRADO' }, T0, 'u');
    const r = C.revisar(capturada, { ...junto, titular: '' }, T1);
    igual('revisar llena lo que trae el IMPI', [r.marca.vigencia, r.marca.fechaConcesion, r.marca.ultimaRevision], ['2031-08-18', '2012-02-01', T1]);
    igual('sin borrar lo capturado ni tocar el cliente', [r.marca.cliente, r.marca.notas], ['Pérez', 'ojo']);
    igual('y avisa del cambio de estatus', [r.cambioEstatus, r.antes, r.despues], [true, 'REGISTRADO', 'REGISTRADA, vigente hasta 18/08/2031']);
    igual('una revisión igual no es un cambio', C.revisar(r.marca, junto, T2).cambioEstatus, false);
}

console.log('\nReporte y CSV');
{
    const lista = [
        C.nueva({ denominacion: 'LUNA', registro: '2500000', estatus: 'REGISTRADA', fechaConcesion: '2022-11-21', vigencia: '2032-11-21', cliente: 'Pérez' }, T0, 'a'),
        C.nueva({ denominacion: 'SOL', expediente: '3', estatus: 'EN TRÁMITE', cliente: 'Gómez' }, T0, 'b'),
        C.nueva({ denominacion: 'MAR', registro: '2600000', estatus: 'REGISTRADA', fechaConcesion: '2023-06-01', cliente: 'pérez' }, T0, 'c')
    ];
    const d = C.datosParaReporte(lista, { cliente: 'Pérez', hoy: '2026-01-10', ahora: Date.parse('2026-01-10T12:00:00') });
    igual('el reporte de un cliente trae solo sus marcas (sin importar mayúsculas)', d.marcas.map(m => m.denominacion), ['LUNA', 'MAR']);
    igual('con los plazos en curso y los del próximo año, sin los lejanos', d.plazos.map(p => p.marca + ':' + p.titulo + ':' + p.estado),
        ['LUNA:Declaración de uso:En curso', 'MAR:Declaración de uso:Por venir']);
    igual('la vigencia estimada se marca', [d.marcas[1].vigencia, d.marcas[1].vigenciaEstimada], ['2033-06-01', true]);
    const doc = R.documentoCartera(d, { para: 'Pérez' });
    verificar('se arma el PDF de la cartera', doc.pageSize === 'LETTER' && doc.content.length > 5);
    const texto = JSON.stringify(doc.content);
    verificar('con el aviso de que los plazos son de apoyo', /cálculos de apoyo/.test(texto) && /5 de noviembre de 2020/.test(texto));
    const csv = C.csv(lista, '2026-01-10');
    verificar('el CSV abre con acentos en Excel (BOM)', csv.charCodeAt(0) === 0xfeff);
    igual('y trae una fila por marca más la cabecera', csv.trim().split('\n').length, 4);
}

console.log('\nSincronización y respaldos');
{
    const SYNC = fs.readFileSync(path.join(__dirname, 'docs', 'js', 'sync.js'), 'utf8');
    const BASE = fs.readFileSync(path.join(__dirname, 'docs', 'js', 'database.js'), 'utf8');
    const extraer = (fuente, nombre) => {
        const lineas = fuente.split('\n');
        const i = lineas.findIndex(l => new RegExp('^(?:async\\s+)?function\\s+' + nombre + '\\s*\\(|^const\\s+' + nombre + '\\s*=').test(l));
        if (i === -1) throw new Error('No se encontró ' + nombre);
        if (/;\s*$/.test(lineas[i])) return lineas[i];
        for (let j = i + 1; j < lineas.length; j++) if (/^[}\])]/.test(lineas[j])) return lineas.slice(i, j + 1).join('\n');
    };
    const sb = { JSON, Math, Array, Object, String };
    vm.createContext(sb);
    vm.runInContext(extraer(SYNC, 'MAX_HISTORIAL_SYNC') + '\n' + extraer(SYNC, 'huellaContenido'), sb);
    const datos = { expedientes: [], notas: [], eventos: [], historial: [], cartera: [] };
    verificar('una marca nueva cambia la huella: se sube a la nube',
        sb.huellaContenido(datos) !== sb.huellaContenido({ ...datos, cartera: [C.nueva({ denominacion: 'LUNA' }, T0, 'u')] }));
    verificar('fusionarDatos junta la cartera', /cartera:\s*typeof fusionarCarteraMarcas === 'function'/.test(extraer(SYNC, 'fusionarDatos')));
    verificar('obtenerTodosLosDatos la sube', /obtenerCarteraMarcas/.test(extraer(SYNC, 'obtenerTodosLosDatos')));
    verificar('aplicarDatosLocalmente la guarda al bajar', /aplicarCarteraMarcas\(datos\.cartera\)/.test(extraer(SYNC, 'aplicarDatosLocalmente')));
    verificar('el respaldo la exporta', /obtenerCarteraMarcas/.test(extraer(BASE, 'exportarTodosDatos')));
    verificar('y la restaura juntándola', /aplicarCarteraMarcas/.test(BASE));
}

console.log(`\n  ${pasadas} pasadas, ${fallos.length} fallidas\n`);
if (fallos.length) {
    fallos.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
}
console.log('  ✓ La cartera calcula sus plazos, se sincroniza sin pisarse y entiende al IMPI\n');
