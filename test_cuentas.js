#!/usr/bin/env node
/**
 * Pruebas de las cuentas compartidas del despacho (docs/js/cuentas.js).
 *
 *   node test_cuentas.js
 *
 * Lo que se fija aquí:
 *   - el caso con el que se pidió: A paga 1,000 mitad y mitad (le deben 500);
 *     B paga 600 mitad y mitad (A le debe 300); queda la diferencia, 200;
 *   - el dinero cuadra al centavo: las partes suman el monto y los saldos
 *     suman cero, con 3, 7 o 20 personas y porcentajes como 70-30 o 33.33;
 *   - los pagos y abonos, las anulaciones (que no borran nada) y los pagos
 *     mínimos para quedar a mano;
 *   - archivar solo con la conformidad de todos;
 *   - lo de dos dispositivos se junta sin perder ni duplicar nada;
 *   - la sincronización sube las cuentas (si faltaran en la huella, un cambio
 *     solo en ellas parecería "sin novedades" y nunca llegaría a los demás);
 *   - el asistente reconoce "abre las cuentas" y la elección del catálogo;
 *   - la función sigue oculta: ni el menú, ni la paleta, ni la guía del
 *     asistente, ni el prompt del modelo la mencionan.
 *
 * Se carga el código real que se despliega, no una copia.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const C = require('./docs/js/cuentas.js');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);

// ---- Una cuenta de prueba, como la dejaría la interfaz ----
let reloj = Date.parse('2026-10-01T15:00:00.000Z');
let serie = 0;
function ev(datos, fecha) {
    reloj += 60000;
    return { id: 'ev_' + String(++serie).padStart(4, '0'), fecha: fecha || new Date(reloj).toISOString(), dispositivo: 'pruebas', ...datos };
}
function cuenta(nombres, reparto, uid) {
    const participantes = nombres.map((n, i) => ({ id: 'p' + (i + 1), nombre: n }));
    const r = reparto || C.repartoIgual(participantes.map(p => p.id));
    return { uid: uid || 'cta_prueba', eventos: [ev({ tipo: 'crear', por: 'p1', nombre: 'Oficina', moneda: 'MXN', participantes, reparto: r })] };
}
function gasto(c, por, monto, reparto, extra) {
    const e = ev({ tipo: 'gasto', por, mov: { concepto: 'Gasto', monto, pagadoPor: por, reparto, fechaMov: '2026-10-0' + ((serie % 9) + 1), ...(extra || {}) } });
    c.eventos.push(e);
    return e;
}
function pago(c, de, a, monto) {
    const e = ev({ tipo: 'pago', por: de, mov: { concepto: 'Liquidación', monto, de, a, fechaMov: '2026-10-09' } });
    c.eventos.push(e);
    return e;
}
const sumaSaldos = s => Object.values(s).reduce((x, y) => x + y, 0);

console.log('\nEl caso con el que se pidió');
{
    const c = cuenta(['Jorge', 'Frida'], { p1: 50, p2: 50 });
    gasto(c, 'p1', 100000, { p1: 50, p2: 50 });
    let e = C.derivarCuenta(c);
    igual('Jorge paga 1,000 mitad y mitad: queda con 500 a su favor', e.saldos.p1, 50000);
    igual('y Frida debe 500', e.saldos.p2, -50000);

    gasto(c, 'p2', 60000, { p1: 50, p2: 50 });
    e = C.derivarCuenta(c);
    igual('Frida paga 600 mitad y mitad: los 300 de Jorge se descuentan y quedan 200 a su favor', e.saldos.p1, 20000);
    igual('Frida debe la diferencia: 200', e.saldos.p2, -20000);
    igual('para quedar a mano, Frida le paga 200 a Jorge',
        C.liquidacionSugerida(e.saldos, ['p1', 'p2']), [{ de: 'p2', a: 'p1', monto: 20000 }]);
    igual('en la relación entre los dos, Frida le debe 200 a Jorge', C.deudaNeta(e, 'p2', 'p1'), 20000);
    igual('el resumen del catálogo lo dice en una línea', C.resumenSaldos(e), 'Frida debe $200.00 a Jorge');
    igual('el histórico guarda los dos movimientos con el saldo de cada momento',
        e.movimientos.map(m => m.saldoTras.p1), [50000, 20000]);
    igual('de dónde sale el saldo de Jorge: pagó 1,000, le tocaron 800',
        e.totales.p1, { pagado: 100000, parte: 80000, dio: 0, recibio: 0 });

    pago(c, 'p2', 'p1', 20000);
    e = C.derivarCuenta(c);
    igual('Frida le paga los 200: quedan a mano', [e.saldos.p1, e.saldos.p2], [0, 0]);
    igual('y ya no se sugiere ningún pago', C.liquidacionSugerida(e.saldos, ['p1', 'p2']), []);
    igual('el resumen lo dice', C.resumenSaldos(e), 'Todos están a mano');
    igual('el pago queda en el histórico como lo que dio y recibió cada quien',
        [e.totales.p2.dio, e.totales.p1.recibio], [20000, 20000]);
}

console.log('\nRepartos distintos de mitad y mitad');
{
    const c = cuenta(['Jorge', 'Frida'], { p1: 70, p2: 30 });
    gasto(c, 'p1', 100000, { p1: 70, p2: 30 });
    const e = C.derivarCuenta(c);
    igual('70-30: Jorge paga 1,000 y Frida le debe 300', e.saldos.p2, -30000);
    igual('a Jorge le tocaron 700', e.totales.p1.parte, 70000);
}
{
    const c = cuenta(['A', 'B', 'C', 'D', 'E']);
    // Un gasto solo entre tres de los cinco.
    gasto(c, 'p4', 30000, { p1: 50, p2: 25, p4: 25 });
    const e = C.derivarCuenta(c);
    igual('un gasto solo entre algunos no toca a los demás', [e.saldos.p3, e.saldos.p5], [0, 0]);
    igual('el que pagó tiene a favor lo que pusieron los otros', e.saldos.p4, 22500);
    igual('y cada uno debe su parte', [e.saldos.p1, e.saldos.p2], [-15000, -7500]);
}

console.log('\nEl dinero cuadra al centavo');
{
    igual('100 entre tres: 33.34 + 33.33 + 33.33', C.repartirMonto(10000, C.repartoIgual(['a', 'b', 'c']), ['a', 'b', 'c']), { a: 3334, b: 3333, c: 3333 });
    igual('los porcentajes iguales suman 100 con dos decimales', C.sumaReparto(C.repartoIgual(['a', 'b', 'c'])), 100);
    igual('33.33 tres veces (99.99%) se acepta como reparto válido',
        C.validarReparto({ a: 33.33, b: 33.33, c: 33.33 }, ['a', 'b', 'c']), null);
    igual('y aun así las partes suman el monto exacto',
        Object.values(C.repartirMonto(10001, { a: 33.33, b: 33.33, c: 33.33 }, ['a', 'b', 'c'])).reduce((x, y) => x + y, 0), 10001);

    // Muchos gastos al azar con 2 a 20 personas: nunca se pierde un centavo.
    let semilla = 12345;
    const azar = n => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; };
    let partesMal = 0, saldosMal = 0;
    for (let k = 0; k < 300; k++) {
        const n = 2 + azar(19);
        const c = cuenta(Array.from({ length: n }, (_, i) => 'Persona ' + (i + 1)), null, 'cta_' + k);
        const ids = Array.from({ length: n }, (_, i) => 'p' + (i + 1));
        for (let g = 0; g < 8; g++) {
            const elegidos = ids.filter(() => azar(3) > 0);
            if (!elegidos.length) elegidos.push(ids[0]);
            const monto = 1 + azar(5000000);
            const reparto = C.repartoIgual(elegidos);
            const cuotas = C.repartirMonto(monto, reparto, ids);
            if (Object.values(cuotas).reduce((x, y) => x + y, 0) !== monto) partesMal++;
            gasto(c, ids[azar(n)], monto, reparto);
        }
        if (sumaSaldos(C.derivarCuenta(c).saldos) !== 0) saldosMal++;
    }
    igual('300 cuentas al azar (2 a 20 personas): las partes siempre suman el monto', partesMal, 0);
    igual('y los saldos siempre suman cero', saldosMal, 0);
}
{
    const c = cuenta(Array.from({ length: 7 }, (_, i) => 'P' + i));
    for (let i = 1; i <= 7; i++) gasto(c, 'p' + i, 1000 * i + 7, C.repartoIgual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']));
    const e = C.derivarCuenta(c);
    const pagos = C.liquidacionSugerida(e.saldos, e.participantes.map(p => p.id));
    const despues = { ...e.saldos };
    for (const p of pagos) { despues[p.de] += p.monto; despues[p.a] -= p.monto; }
    verificar('con 7 personas basta con 6 pagos o menos', pagos.length <= 6, JSON.stringify(pagos));
    igual('y hechos esos pagos todos quedan en cero', Object.values(despues).every(v => v === 0), true);
}

console.log('\nCantidades como las escribe la gente');
{
    igual('"1,000.50" son 100050 centavos', C.aCentavos('1,000.50'), 100050);
    igual('"$1000" son 100000', C.aCentavos('$1000'), 100000);
    igual('"1000,5" (coma decimal) son 100050', C.aCentavos('1000,5'), 100050);
    igual('"1,000" (coma de miles) son 100000', C.aCentavos('1,000'), 100000);
    igual('"1.005" redondea a 1.01 sin perder el centavo por la coma flotante', C.aCentavos('1.005'), 101);
    igual('el número 0.1 + 0.2 no deja basura', C.aCentavos(0.1 + 0.2), 30);
    verificar('"mil" no es una cantidad', Number.isNaN(C.aCentavos('mil')));
    verificar('vacío no es una cantidad', Number.isNaN(C.aCentavos('')));
    igual('se muestra como pesos mexicanos', C.formatoMoneda(123456, 'MXN'), '$1,234.56');
}

console.log('\nValidaciones');
{
    const e = C.derivarCuenta(cuenta(['Jorge', 'Frida']));
    verificar('un reparto que suma 90% no pasa', /suman 90% y deben sumar 100%/.test(C.validarReparto({ p1: 60, p2: 30 }, ['p1', 'p2'])));
    verificar('un reparto con alguien ajeno a la cuenta no pasa', !!C.validarReparto({ p1: 50, x: 50 }, ['p1', 'p2']));
    verificar('un reparto con todo en cero no pasa', !!C.validarReparto({ p1: 0, p2: 0 }, ['p1', 'p2']));
    verificar('un gasto sin concepto no pasa', !!C.validarGasto(e, { concepto: '', monto: 100, pagadoPor: 'p1', reparto: { p1: 50, p2: 50 }, fechaMov: '2026-10-01' }));
    verificar('un gasto de cero no pasa', !!C.validarGasto(e, { concepto: 'x', monto: 0, pagadoPor: 'p1', reparto: { p1: 50, p2: 50 }, fechaMov: '2026-10-01' }));
    igual('un gasto completo pasa', C.validarGasto(e, { concepto: 'Renta', monto: 100, pagadoPor: 'p1', reparto: { p1: 50, p2: 50 }, fechaMov: '2026-10-01' }), null);
    verificar('nadie se paga a sí mismo', !!C.validarPago(e, { de: 'p1', a: 'p1', monto: 100, fechaMov: '2026-10-01' }));
    verificar('una cuenta de una sola persona no se puede crear', !!C.validarParticipantes(['Jorge']));
    verificar('ni una de 21', !!C.validarParticipantes(Array.from({ length: 21 }, (_, i) => 'P' + i)));
    igual('una de 20 sí', C.validarParticipantes(Array.from({ length: 20 }, (_, i) => 'P' + i)), null);
    verificar('dos participantes con el mismo nombre (sin importar acentos) no', !!C.validarParticipantes(['José', 'jose']));
}

console.log('\nAnular no borra');
{
    const c = cuenta(['Jorge', 'Frida']);
    const g1 = gasto(c, 'p1', 100000, { p1: 50, p2: 50 });
    gasto(c, 'p2', 60000, { p1: 50, p2: 50 });
    c.eventos.push(ev({ tipo: 'anular', por: 'p2', movId: g1.id, motivo: 'Se capturó dos veces' }));
    const e = C.derivarCuenta(c);
    igual('el gasto anulado deja de contar en los saldos', e.saldos.p1, -30000);
    igual('pero sigue en el histórico', e.movimientos.length, 2);
    igual('marcado como anulado, con quién y por qué', [e.movimientos[0].anulado.por, e.movimientos[0].anulado.motivo], ['p2', 'Se capturó dos veces']);
    c.eventos.push(ev({ tipo: 'anular', por: 'p1', movId: g1.id, motivo: 'Otra vez' }));
    igual('anularlo dos veces (desde dos dispositivos) no cambia el primer motivo', C.derivarCuenta(c).movimientos[0].anulado.motivo, 'Se capturó dos veces');
    igual('la bitácora conserva todo lo que pasó', C.derivarCuenta(c).bitacora.length, 5);
}

console.log('\nEl histórico va por la fecha del gasto');
{
    const c = cuenta(['Jorge', 'Frida']);
    c.eventos.push(ev({ tipo: 'gasto', por: 'p1', mov: { concepto: 'Hoy', monto: 1000, pagadoPor: 'p1', reparto: { p1: 50, p2: 50 }, fechaMov: '2026-10-20' } }));
    c.eventos.push(ev({ tipo: 'gasto', por: 'p1', mov: { concepto: 'Recibo viejo', monto: 1000, pagadoPor: 'p1', reparto: { p1: 50, p2: 50 }, fechaMov: '2026-09-15' } }));
    igual('un recibo viejo capturado después queda en su fecha', C.derivarCuenta(c).movimientos.map(m => m.concepto), ['Recibo viejo', 'Hoy']);
}

console.log('\nArchivar solo de común acuerdo');
{
    const c = cuenta(['Jorge', 'Frida', 'Ana']);
    gasto(c, 'p1', 30000, C.repartoIgual(['p1', 'p2', 'p3']));
    const saldosAntes = C.derivarCuenta(c).saldos;
    const sol = ev({ tipo: 'solicitar_archivo', por: 'p1', motivo: 'Cerramos el local' });
    c.eventos.push(sol);
    let e = C.derivarCuenta(c);
    igual('pedirlo no la archiva', e.archivada, false);
    igual('quien lo pide ya dio su conformidad', Object.keys(e.solicitud.confirmaciones), ['p1']);

    c.eventos.push(ev({ tipo: 'confirmar_archivo', por: 'p2', solicitudId: sol.id }));
    igual('con dos de tres, todavía no', C.derivarCuenta(c).archivada, false);

    c.eventos.push(ev({ tipo: 'confirmar_archivo', por: 'intruso', solicitudId: sol.id }));
    igual('alguien que no participa no cuenta', C.derivarCuenta(c).archivada, false);

    c.eventos.push(ev({ tipo: 'confirmar_archivo', por: 'p3', solicitudId: sol.id }));
    e = C.derivarCuenta(c);
    igual('con los tres de acuerdo, queda archivada', e.archivada, true);
    igual('se guarda quiénes estuvieron de acuerdo', Object.keys(e.archivo.solicitud.confirmaciones).sort(), ['p1', 'p2', 'p3']);
    igual('los saldos se conservan tal cual', e.saldos, saldosAntes);

    c.eventos.push(ev({ tipo: 'reactivar', por: 'p2', motivo: 'Faltó un recibo' }));
    e = C.derivarCuenta(c);
    igual('se puede reactivar', e.archivada, false);
    igual('y para volver a archivar hace falta una solicitud nueva', e.solicitud, null);
}
{
    const c = cuenta(['Jorge', 'Frida']);
    const sol = ev({ tipo: 'solicitar_archivo', por: 'p1' });
    c.eventos.push(sol);
    c.eventos.push(ev({ tipo: 'rechazar_archivo', por: 'p2', solicitudId: sol.id, motivo: 'Aún me debes' }));
    let e = C.derivarCuenta(c);
    igual('si uno no está de acuerdo, la solicitud se cierra', [e.archivada, e.solicitud], [false, null]);
    igual('y queda el motivo', e.ultimoRechazo.motivo, 'Aún me debes');
    c.eventos.push(ev({ tipo: 'confirmar_archivo', por: 'p2', solicitudId: sol.id }));
    igual('confirmar una solicitud ya cerrada no archiva', C.derivarCuenta(c).archivada, false);
}
{
    // Los dos piden archivar a la vez, cada uno en su dispositivo.
    const c = cuenta(['Jorge', 'Frida']);
    c.eventos.push(ev({ tipo: 'solicitar_archivo', por: 'p1' }, '2026-10-05T10:00:00.000Z'));
    c.eventos.push(ev({ tipo: 'solicitar_archivo', por: 'p2' }, '2026-10-05T10:00:01.000Z'));
    igual('dos solicitudes a la vez cuentan como dos conformidades', C.derivarCuenta(c).archivada, true);
}
{
    const c = cuenta(['Jorge', 'Frida']);
    const sol = ev({ tipo: 'solicitar_archivo', por: 'p1' });
    c.eventos.push(sol);
    c.eventos.push(ev({ tipo: 'participante', por: 'p1', participante: { id: 'p3', nombre: 'Ana' } }));
    c.eventos.push(ev({ tipo: 'confirmar_archivo', por: 'p2', solicitudId: sol.id }));
    igual('quien se sumó durante la solicitud también tiene que estar de acuerdo', C.derivarCuenta(c).archivada, false);
}

console.log('\nParticipantes, PIN y eliminar');
{
    const c = cuenta(['Jorge', 'Frida']);
    c.eventos.push(ev({ tipo: 'participante', por: 'p1', participante: { id: 'p3', nombre: 'Ana' } }));
    c.eventos.push(ev({ tipo: 'renombrar_participante', por: 'p1', participanteId: 'p2', nombre: 'Frida M.' }));
    c.eventos.push(ev({ tipo: 'pin', por: 'p1', participanteId: 'p1', pinHash: 'abc' }));
    const e = C.derivarCuenta(c);
    igual('se puede sumar gente', e.participantes.map(p => p.nombre), ['Jorge', 'Frida M.', 'Ana']);
    igual('quien se suma no hereda los gastos anteriores', e.saldos.p3, 0);
    igual('el PIN se guarda como huella, no como número', e.participantes[0].pinHash, 'abc');
}
{
    const vacia = cuenta(['Jorge', 'Frida']);
    vacia.eventos.push(ev({ tipo: 'eliminar', por: 'p1' }));
    verificar('una cuenta sin movimientos se puede eliminar', !!C.derivarCuenta(vacia).eliminada);
    const conGasto = cuenta(['Jorge', 'Frida']);
    conGasto.eventos.push(ev({ tipo: 'eliminar', por: 'p1' }));
    gasto(conGasto, 'p2', 5000, { p1: 50, p2: 50 }); // llegó de otro dispositivo
    igual('si llega un gasto de otro dispositivo, la cuenta no desaparece', C.derivarCuenta(conGasto).eliminada, null);
}

console.log('\nDos dispositivos de la misma licencia');
{
    const base = cuenta(['Jorge', 'Frida']);
    const enJorge = JSON.parse(JSON.stringify(base));
    const enFrida = JSON.parse(JSON.stringify(base));
    gasto(enJorge, 'p1', 100000, { p1: 50, p2: 50 });
    gasto(enFrida, 'p2', 60000, { p1: 50, p2: 50 });
    const otra = cuenta(['Ana', 'Luis'], null, 'cta_otra');

    const fusion = C.fusionarCuentas([enJorge, otra], [enFrida]);
    igual('se juntan las cuentas de los dos lados', fusion.map(c => c.uid), ['cta_otra', 'cta_prueba']);
    const e = C.derivarCuenta(fusion.find(c => c.uid === 'cta_prueba'));
    igual('el gasto de cada uno está, sin duplicar el alta', e.bitacora.length, 3);
    igual('y el saldo es el del caso: Frida debe 200', e.saldos.p2, -20000);
    igual('fusionar en un orden o en otro da lo mismo', JSON.stringify(C.fusionarCuentas([enFrida], [enJorge, otra])), JSON.stringify(fusion));
    igual('volver a fusionar con lo mismo no cambia nada', JSON.stringify(C.fusionarCuentas(fusion, fusion)), JSON.stringify(fusion));
    igual('lo que llega sin cuentas (una versión vieja de la app) no borra las de aquí',
        C.fusionarCuentas(fusion, []).length, 2);
}

console.log('\nLa sincronización las sube y las baja');
{
    const SYNC = fs.readFileSync(path.join(__dirname, 'docs', 'js', 'sync.js'), 'utf8');
    const extraer = (nombre) => {
        const lineas = SYNC.split('\n');
        const i = lineas.findIndex(l => new RegExp('^(?:async\\s+)?function\\s+' + nombre + '\\s*\\(|^const\\s+' + nombre + '\\s*=').test(l));
        if (i === -1) throw new Error('No se encontró ' + nombre + ' en sync.js');
        if (/;\s*$/.test(lineas[i])) return lineas[i];
        for (let j = i + 1; j < lineas.length; j++) if (/^[}\])]/.test(lineas[j])) return lineas.slice(i, j + 1).join('\n');
    };
    const sb = { JSON, Math, Array, Object, String, fusionarCuentasCompartidas: C.fusionarCuentas };
    vm.createContext(sb);
    vm.runInContext(extraer('MAX_HISTORIAL_SYNC') + '\n' + extraer('huellaContenido'), sb);
    const datos = { expedientes: [], notas: [], eventos: [], historial: [], cuentas: [] };
    const conCuenta = { ...datos, cuentas: [cuenta(['Jorge', 'Frida'])] };
    verificar('una cuenta nueva cambia la huella: se sube a la nube', sb.huellaContenido(datos) !== sb.huellaContenido(conCuenta));

    verificar('fusionarDatos junta las cuentas', /cuentas:\s*typeof fusionarCuentasCompartidas === 'function'/.test(extraer('fusionarDatos')));
    verificar('obtenerTodosLosDatos las incluye en lo que se sube', /obtenerCuentasCompartidas/.test(extraer('obtenerTodosLosDatos')));
    verificar('aplicarDatosLocalmente las guarda al bajar', /aplicarCuentasCompartidas\(datos\.cuentas\)/.test(extraer('aplicarDatosLocalmente')));
}

console.log('\nLo que se le dice al asistente');
{
    for (const t of ['Abre las cuentas', 'ábreme las cuentas', 'muéstrame las cuentas compartidas', 'las cuentas',
                     'Quiero ver las cuentas', '¿Me abres las cuentas?', 'llévame a las cuentas', 'Cuentas']) {
        verificar(`"${t}" abre las cuentas`, C.esPeticionAbrir(t));
    }
    for (const t of ['Agenda audiencia del expediente 123/2025', 'toma en cuenta la audiencia', 'abre el expediente de cuentas por cobrar',
                     'busca la rendición de cuentas', 'abre la cuenta', 'abre el calendario']) {
        verificar(`"${t}" no`, !C.esPeticionAbrir(t));
    }

    const lista = [
        { numero: 1, uid: 'a', nombre: 'Gastos de oficina' },
        { numero: 2, uid: 'b', nombre: 'Renta del local' },
        { numero: 3, uid: 'c', nombre: 'Nueva sucursal' }
    ];
    const elige = t => { const r = C.elegirDeCatalogo(t, lista); return r && (r.tipo === 'cuenta' ? r.item.uid : r.tipo); };
    igual('"la 2" elige la segunda', elige('la 2'), 'b');
    igual('"la segunda" también', elige('la segunda'), 'b');
    igual('"la tres" también', elige('la tres'), 'c');
    igual('"la última" es la última', elige('la última'), 'c');
    igual('por el nombre: "renta"', elige('renta'), 'b');
    igual('por el nombre completo', elige('abre gastos de oficina'), 'a');
    igual('una cuenta que se llama "Nueva…" se abre, no se crea otra', elige('nueva sucursal'), 'c');
    igual('"crea una nueva" crea', elige('crea una nueva'), 'nueva');
    igual('"las archivadas" las enseña', elige('las archivadas'), 'archivadas');
    igual('"cancelar" cancela', elige('cancelar'), 'cancelar');
    igual('un número fuera de la lista no elige nada', elige('la 9'), null);
    igual('algo que no se parece a nada tampoco', elige('agenda una audiencia'), null);
}

console.log('\nSigue oculta');
{
    const leer = f => fs.readFileSync(path.join(__dirname, 'docs', f), 'utf8');
    const voz = leer('js/voice-assistant.js');
    const guia = voz.slice(voz.indexOf('const EJEMPLOS'), voz.indexOf('// ==================== ESTADO'));
    verificar('ni los ejemplos, ni la guía, ni los tips del asistente la mencionan', !/cuentas/i.test(guia));
    const prompt = voz.slice(voz.indexOf('async function construirPromptSistema'), voz.indexOf('async function llamarModelo'));
    verificar('el prompt del modelo no la menciona: los montos no salen del navegador', prompt.length > 1000 && !/cuentas compartidas|CUENTAS/.test(prompt));
    verificar('la paleta de comandos no la ofrece', !/cuentas/i.test(leer('js/command-palette.js')));
    const html = leer('index.html');
    verificar('el menú no la lleva', !/cuentas compartidas|cta-overlay|abrirCuentas/i.test(html));
    verificar('pero el script se carga', html.includes('<script src="js/cuentas.js"></script>'));
    verificar('y se guarda para usarse sin internet', /'js\/cuentas\.js'/.test(leer('sw.js')));
}

console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
if (fallos.length) {
    console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
}
