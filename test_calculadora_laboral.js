/**
 * Calculadora laboral: cada concepto contra una cuenta hecha a mano.
 *
 * Los casos están resueltos aparte, con la LFT en la mano, para que un
 * cambio en el motor que altere un peso se note aquí.
 */
const path = require('path');
const C = require(path.join(__dirname, 'docs', 'js', 'calculadora-laboral.js'));

let pasadas = 0, fallidas = 0;
const fallos = [];
function verificar(desc, cond, detalle) {
    if (cond) { pasadas++; return; }
    fallidas++;
    fallos.push(desc + (detalle ? `\n      ${detalle}` : ''));
}
function cerca(desc, real, esperado, tol = 0.011) {
    verificar(desc, Math.abs(real - esperado) <= tol, `esperado ${esperado}, obtenido ${real}`);
}
function igual(desc, real, esperado) {
    verificar(desc, JSON.stringify(real) === JSON.stringify(esperado),
        `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}
const concepto = (r, clave) => (r.conceptos.find(c => c.clave === clave) || {}).importe;

// ---------- Tabla de vacaciones (reforma 2023) ----------
igual('vacaciones: años 1 a 5',
    [1, 2, 3, 4, 5].map(C.diasVacaciones), [12, 14, 16, 18, 20]);
igual('vacaciones: de 5 en 5 después',
    [6, 10, 11, 15, 16, 20, 21, 25, 26, 30, 31].map(C.diasVacaciones),
    [22, 22, 24, 24, 26, 26, 28, 28, 30, 30, 32]);

// ---------- Antigüedad ----------
const ant = (a, b) => C.antiguedad(C.fecha(a), C.fecha(b));
igual('antigüedad: un año se cumple la víspera del aniversario',
    [ant('2020-03-01', '2021-02-28').aniosCompletos, ant('2020-03-01', '2021-02-28').diasAnioEnCurso], [1, 0]);
igual('antigüedad: el día del aniversario empieza el siguiente año',
    [ant('2020-03-01', '2021-03-01').aniosCompletos, ant('2020-03-01', '2021-03-01').diasAnioEnCurso], [1, 1]);
igual('antigüedad: ingreso y baja el mismo día es un día', ant('2026-05-10', '2026-05-10').diasServicio, 1);
igual('antigüedad: 29 de febrero cumple el 28 en años no bisiestos',
    ant('2024-02-29', '2025-02-27').aniosCompletos, 1);

// ---------- Salario diario ----------
cerca('salario: mensual entre 30', C.salarioDiarioDe(15000, 'mensual', 30), 500);
cerca('salario: mensual entre 30.4', C.salarioDiarioDe(15200, 'mensual', 30.4), 500);
cerca('salario: quincenal entre 15', C.salarioDiarioDe(7500, 'quincenal'), 500);
cerca('salario: semanal entre 7', C.salarioDiarioDe(3500, 'semanal'), 500);

// ---------- Caso base: despido injustificado ----------
// Ingreso 15-ene-2020, baja 26-sep-2026, $15,000 mensuales → SD $500.
// 6 años cumplidos el 15-ene-2026; del 15-ene al 26-sep van 255 días.
const base = {
    supuesto: 'despidoInjustificado', fechaIngreso: '2020-01-15', fechaBaja: '2026-09-26',
    salario: 15000, periodo: 'mensual', calcularISR: false
};
const r = C.calcular(base);
verificar('caso base: calcula', r.ok, JSON.stringify(r.errores));
igual('caso base: 6 años y 255 días', [r.datos.antiguedad.aniosCompletos, r.datos.antiguedad.diasAnioEnCurso], [6, 255]);
igual('caso base: el año en curso (7º) da 22 días de vacaciones', r.datos.diasVacacionesAnio, 22);
// Aguinaldo: 1-ene al 26-sep = 269 días. 15 × 269/365 × 500.
cerca('caso base: aguinaldo proporcional', concepto(r, 'aguinaldo'), 15 * 269 / 365 * 500);
cerca('caso base: vacaciones proporcionales', concepto(r, 'vacacionesProporcionales'), 22 * 255 / 365 * 500);
cerca('caso base: prima vacacional 25%', concepto(r, 'primaVacacional'), 22 * 255 / 365 * 500 * 0.25);
// SDI = 500 × (1 + (15 + 22 × 0.25)/365).
const sdi = 500 * (1 + (15 + 22 * 0.25) / 365);
cerca('caso base: salario integrado', r.datos.salarioDiarioIntegrado, sdi);
cerca('caso base: 3 meses con salario integrado', concepto(r, 'tresMeses'), 90 * sdi);
const antDec = 6 + 255 / 365;
cerca('caso base: prima de antigüedad (sin tope: 500 < 2 SM)', concepto(r, 'primaAntiguedad'), 12 * antDec * 500);
igual('caso base: sin los 20 días (el art. 48 no los da)', concepto(r, 'veinteDias'), undefined);
cerca('caso base: total = suma de conceptos redondeados', r.totales.bruto,
    r.conceptos.reduce((s, c) => s + c.importe, 0));

const conVeinte = C.calcular({ ...base, incluirVeinteDias: true });
cerca('despido injustificado: 20 días si se pactan', concepto(conVeinte, 'veinteDias'), 20 * antDec * sdi);

// ---------- Tope de la prima de antigüedad ----------
const alto = C.calcular({ ...base, salario: 60000 }); // SD 2,000 > 2 × 315.04
cerca('prima de antigüedad: tope de 2 salarios mínimos', concepto(alto, 'primaAntiguedad'), 12 * antDec * 630.08);
const frontera = C.calcular({ ...base, salario: 60000, zona: 'frontera' });
cerca('prima de antigüedad: tope con el mínimo de la frontera', concepto(frontera, 'primaAntiguedad'), 12 * antDec * 881.74);
const bajo = C.calcular({ ...base, salario: 9000 }); // SD 300 < 315.04
cerca('prima de antigüedad: nunca menos de un salario mínimo', concepto(bajo, 'primaAntiguedad'), 12 * antDec * 315.04);
verificar('salario bajo el mínimo: avisa', bajo.avisos.some(a => /menor al mínimo/.test(a)));

// ---------- Renuncia: prima solo con 15 años ----------
const renuncia = C.calcular({ ...base, supuesto: 'renuncia' });
igual('renuncia con 6 años: sin prima de antigüedad', concepto(renuncia, 'primaAntiguedad'), undefined);
igual('renuncia: sin indemnizaciones', renuncia.totales.indemnizacion, 0);
verificar('renuncia: explica por qué no hay prima', renuncia.avisos.some(a => /15 años/.test(a)));
const renuncia15 = C.calcular({ ...base, supuesto: 'renuncia', fechaIngreso: '2011-01-15' });
cerca('renuncia con 15 años: prima de antigüedad', concepto(renuncia15, 'primaAntiguedad'),
    12 * (15 + 255 / 365) * 500);
const justificado = C.calcular({ ...base, supuesto: 'despidoJustificado' });
cerca('despido justificado: prima de antigüedad aunque tenga 6 años',
    concepto(justificado, 'primaAntiguedad'), 12 * antDec * 500);
igual('despido justificado: sin 3 meses', concepto(justificado, 'tresMeses'), undefined);

// ---------- Supuestos con 20 días ----------
const negativa = C.calcular({ ...base, supuesto: 'negativaReinstalar' });
cerca('negativa a reinstalar: 20 días por año', concepto(negativa, 'veinteDias'), 20 * antDec * sdi);
const rescision = C.calcular({ ...base, supuesto: 'rescisionTrabajador' });
cerca('rescisión por el trabajador: 3 meses', concepto(rescision, 'tresMeses'), 90 * sdi);
cerca('rescisión por el trabajador: 20 días', concepto(rescision, 'veinteDias'), 20 * antDec * sdi);
const reajuste = C.calcular({ ...base, supuesto: 'reajuste' });
cerca('reajuste: 4 meses', concepto(reajuste, 'cuatroMeses'), 120 * sdi);
const cierre = C.calcular({ ...base, supuesto: 'cierreEmpresa' });
igual('cierre: 3 meses y prima, sin 20 días',
    [!!concepto(cierre, 'tresMeses'), !!concepto(cierre, 'primaAntiguedad'), concepto(cierre, 'veinteDias')],
    [true, true, undefined]);
const incap = C.calcular({ ...base, supuesto: 'incapacidadNoProfesional' });
cerca('incapacidad no profesional: un mes', concepto(incap, 'unMes'), 30 * sdi);

// ---------- Contrato por tiempo determinado (art. 50-I) ----------
const det = C.calcular({ ...base, supuesto: 'negativaReinstalar', tipoContrato: 'determinado',
    fechaIngreso: '2026-03-01', fechaBaja: '2026-08-28' });
const diasDet = det.datos.antiguedad.diasServicio;   // 181
igual('contrato determinado: días de servicio', diasDet, 181);
cerca('contrato determinado menor a un año: mitad del tiempo servido',
    concepto(det, 'veinteDias'), 500 * (1 + (15 + 12 * 0.25) / 365) * 181 / 2);
const det2 = C.calcular({ ...base, supuesto: 'negativaReinstalar', tipoContrato: 'determinado' });
cerca('contrato determinado de más de un año: 6 meses + 20 días por los siguientes',
    concepto(det2, 'veinteDias'), 180 * sdi + 20 * sdi * (antDec - 1));

// ---------- Salarios vencidos ----------
const juicio8 = C.calcular({ ...base, mesesJuicio: 8 });
cerca('salarios vencidos: 8 meses', concepto(juicio8, 'salariosVencidos'), 8 * 30 * sdi);
const juicio20 = C.calcular({ ...base, mesesJuicio: 20 });
cerca('salarios vencidos: tope de 12 meses', concepto(juicio20, 'salariosVencidos'), 12 * 30 * sdi);
cerca('salarios vencidos: 2% mensual sobre 15 meses después del mes 12',
    concepto(juicio20, 'interesesVencidos'), 15 * 30 * sdi * 0.02 * 8);
igual('renuncia: no hay salarios vencidos aunque se capture juicio',
    concepto(C.calcular({ ...base, supuesto: 'renuncia', mesesJuicio: 5 }), 'salariosVencidos'), undefined);

// ---------- Riesgos de trabajo ----------
const muerte = C.calcular({ ...base, supuesto: 'muerteRiesgo', salario: 60000 });
cerca('muerte por riesgo: 5,000 días con tope de 2 SM', concepto(muerte, 'muerteRiesgo'), 5000 * 630.08);
cerca('muerte por riesgo: 2 meses de funerarios', concepto(muerte, 'funerarios'), 60 * 630.08);
const total = C.calcular({ ...base, supuesto: 'incapacidadTotal' });
cerca('incapacidad total: 1,095 días', concepto(total, 'incapacidadTotal'), 1095 * sdi);
const parcial = C.calcular({ ...base, supuesto: 'incapacidadParcial', porcentajeIncapacidad: 30 });
cerca('incapacidad parcial: 30% de 1,095 días', concepto(parcial, 'incapacidadParcial'), 0.3 * 1095 * sdi);

// ---------- Ajustes del finiquito ----------
const ajustes = C.calcular({ ...base, supuesto: 'renuncia', vacacionesPendientesDias: 20,
    vacacionesTomadasAnioDias: 5, aguinaldoPagado: 1000, diasSalarioPendientes: 10,
    otrasPercepciones: 2500, diasAguinaldo: 30, primaVacacionalPct: 50 });
cerca('finiquito: salarios devengados', concepto(ajustes, 'salarios'), 10 * 500);
cerca('finiquito: aguinaldo de contrato menos lo ya pagado', concepto(ajustes, 'aguinaldo'), 30 * 269 / 365 * 500 - 1000);
const propDias = 22 * 255 / 365 - 5;
cerca('finiquito: vacaciones proporcionales menos las tomadas', concepto(ajustes, 'vacacionesProporcionales'), propDias * 500);
cerca('finiquito: vacaciones pendientes', concepto(ajustes, 'vacacionesPendientes'), 20 * 500);
cerca('finiquito: prima vacacional de contrato sobre todas las vacaciones',
    concepto(ajustes, 'primaVacacional'), (propDias + 20) * 500 * 0.5);
cerca('finiquito: otras percepciones', concepto(ajustes, 'otras'), 2500);
// En una renuncia no hay integrado; en un despido, sale con el aguinaldo y la
// prima del contrato.
cerca('indemnización: el integrado usa el aguinaldo y la prima del contrato',
    C.calcular({ ...base, diasAguinaldo: 30, primaVacacionalPct: 50 }).datos.salarioDiarioIntegrado,
    500 * (1 + (30 + 22 * 0.5) / 365));
const minimos = C.calcular({ ...base, diasAguinaldo: 10, primaVacacionalPct: 10 });
igual('mínimos de ley: aguinaldo 15 días y prima 25% aunque se capture menos',
    [minimos.datos.diasAguinaldo, minimos.datos.primaVacacionalPct], [15, 25]);
cerca('SDI capturado a mano manda sobre el calculado',
    concepto(C.calcular({ ...base, sdiManual: 700 }), 'tresMeses'), 90 * 700);

// ---------- ISR ----------
// Tarifa 2026: comprobaciones contra renglones publicados.
cerca('tarifa ISR: primer renglón', C.isrTarifaMensual(844.59, C.PARAMETROS.tarifaMensualISR), 844.58 * 0.0192);
cerca('tarifa ISR: $15,000 al mes', C.isrTarifaMensual(15000, C.PARAMETROS.tarifaMensualISR),
    1339.14 + (15000 - 14644.65) * 0.1792);
const conIsr = C.calcular({ ...base, calcularISR: true });
const i = conIsr.isr;
const uma = 117.31;
cerca('ISR: aguinaldo exento hasta 30 UMA', i.exentoAguinaldo, Math.min(concepto(conIsr, 'aguinaldo'), 30 * uma));
cerca('ISR: prima vacacional exenta hasta 15 UMA', i.exentoPrimaVacacional, Math.min(concepto(conIsr, 'primaVacacional'), 15 * uma));
igual('ISR: 6 años y 8 meses cuentan como 7 para la exención', i.aniosExencion, 7);
const separacion = concepto(conIsr, 'tresMeses') + concepto(conIsr, 'primaAntiguedad');
cerca('ISR: separación exenta hasta 90 UMA por año', i.exentoSeparacion, Math.min(separacion, 90 * uma * 7));
const tarifa = (x) => C.isrTarifaMensual(x, C.PARAMETROS.tarifaMensualISR);
const tasa = tarifa(15000) / 15000;
const gravSep = separacion - Math.min(separacion, 90 * uma * 7);
cerca('ISR: separación gravada a la tasa efectiva del último sueldo', i.isrSeparacion,
    gravSep >= 15000 ? gravSep * tasa : tarifa(15000 + i.gravadoOrdinario + gravSep) - tarifa(15000 + i.gravadoOrdinario));
cerca('ISR: neto = bruto − ISR', conIsr.totales.neto, conIsr.totales.bruto - i.total);
const riesgoIsr = C.calcular({ ...base, supuesto: 'incapacidadTotal', calcularISR: true });
verificar('ISR: la indemnización por riesgo de trabajo está exenta',
    riesgoIsr.isr.exentoRiesgo > 0 && riesgoIsr.isr.gravadoSeparacion < concepto(riesgoIsr, 'incapacidadTotal'));

// ---------- Salario base para el finiquito; el integrado, solo en indemnizaciones ----------
// El finiquito se paga con el salario base. El integrado solo se calcula si el
// motivo da una indemnización que lo use: en una renuncia no aparece.
const formulas = (res, grupo) => res.conceptos.filter(c => c.grupo === grupo).map(c => c.formula);
igual('renuncia: no calcula salario integrado', [renuncia.datos.salarioDiarioIntegrado, renuncia.datos.factorIntegracion], [null, null]);
verificar('renuncia: ninguna fórmula usa el integrado',
    renuncia.conceptos.every(c => !/integrado/.test(c.formula)), JSON.stringify(renuncia.conceptos.map(c => c.formula)));
verificar('finiquito: cada fórmula dice que va con el salario base',
    formulas(ajustes, 'finiquito').filter(f => !/Importe capturado/.test(f)).every(f => /\$500\.00 \(salario base\)/.test(f)),
    JSON.stringify(formulas(ajustes, 'finiquito')));
verificar('despido: el finiquito sigue con el salario base aunque haya integrado',
    formulas(r, 'finiquito').every(f => /salario base/.test(f) && !/integrado/.test(f)), JSON.stringify(formulas(r, 'finiquito')));
verificar('despido: los 3 meses dicen que van con el integrado', /\(salario integrado\)/.test(
    (r.conceptos.find(c => c.clave === 'tresMeses') || {}).formula || ''));
verificar('salarios vencidos: también con el integrado, y dicho',
    /\(salario integrado\)/.test((juicio20.conceptos.find(c => c.clave === 'salariosVencidos') || {}).formula || '') &&
    /\(salario integrado\)/.test((juicio20.conceptos.find(c => c.clave === 'interesesVencidos') || {}).formula || ''));
igual('despido justificado: solo finiquito y prima, así que sin integrado', justificado.datos.salarioDiarioIntegrado, null);
const renunciaConSdi = C.calcular({ ...base, supuesto: 'renuncia', sdiManual: 900, otrasPrestacionesDiarias: 50 });
igual('renuncia: un integrado capturado no cambia el finiquito', renunciaConSdi.totales.bruto, renuncia.totales.bruto);
igual('renuncia: ni se reporta', renunciaConSdi.datos.salarioDiarioIntegrado, null);
verificar('resumen de una renuncia: sin salario integrado', !/integrado/i.test(C.resumen(C.calcular({ ...base, supuesto: 'renuncia', calcularISR: true }))));
verificar('resumen de un despido: el integrado, aclarando que es de las indemnizaciones',
    /Salario integrado \$528\.\d\d \(solo indemnizaciones\)/.test(C.resumen(r)), C.resumen(r).split('\n')[1]);

// ---------- Topes de 2 salarios mínimos de la zona, a la vista ----------
const formulaDe = (res, clave) => (res.conceptos.find(c => c.clave === clave) || {}).formula || '';
verificar('tope de la prima: la fórmula dice la zona y el monto',
    /\$630\.08 \(tope: 2 veces el salario mínimo de la zona general, 2 × \$315\.04\)/.test(formulaDe(alto, 'primaAntiguedad')),
    formulaDe(alto, 'primaAntiguedad'));
verificar('tope de la prima en la frontera norte: su zona y su salario mínimo',
    /\$881\.74 \(tope: 2 veces el salario mínimo de la Zona Libre de la Frontera Norte, 2 × \$440\.87\)/.test(formulaDe(frontera, 'primaAntiguedad')),
    formulaDe(frontera, 'primaAntiguedad'));
verificar('prima bajo el mínimo: dice que se tomó el salario mínimo de la zona',
    /\$315\.04 \(mínimo: el salario mínimo de la zona general\)/.test(formulaDe(bajo, 'primaAntiguedad')), formulaDe(bajo, 'primaAntiguedad'));
verificar('prima dentro del tope: dice que va con el salario base y cuál es el tope',
    /\$500\.00 \(salario base; no rebasa el tope de 2 veces el salario mínimo de la zona general: \$630\.08\)/.test(formulaDe(r, 'primaAntiguedad')),
    formulaDe(r, 'primaAntiguedad'));
verificar('riesgo de trabajo: el tope de la zona en la fórmula',
    /\$630\.08 \(tope: 2 veces el salario mínimo de la zona general/.test(formulaDe(muerte, 'muerteRiesgo')), formulaDe(muerte, 'muerteRiesgo'));
const muerteFrontera = C.calcular({ ...base, supuesto: 'muerteRiesgo', salario: 60000, zona: 'frontera' });
cerca('riesgo de trabajo en la frontera norte: tope con su salario mínimo', concepto(muerteFrontera, 'muerteRiesgo'), 5000 * 881.74);
verificar('incapacidad total dentro del tope: con el integrado, y dicho',
    /\(salario integrado; no rebasa el tope de 2 veces el salario mínimo de la zona general: \$630\.08\)/.test(formulaDe(total, 'incapacidadTotal')),
    formulaDe(total, 'incapacidadTotal'));
const capturado = C.calcular({ ...base, salario: 60000, salarioMinimo: 400 });
verificar('salario mínimo capturado: se dice que es el capturado',
    /\$800\.00 \(tope: 2 veces el salario mínimo capturado, 2 × \$400\.00\)/.test(formulaDe(capturado, 'primaAntiguedad')),
    formulaDe(capturado, 'primaAntiguedad'));
igual('una zona que no existe usa la general', C.calcular({ ...base, salario: 60000, zona: 'marte' }).datos.salarioMinimo, 315.04);
igual('el tope se reporta con la zona',
    [frontera.datos.zona, frontera.datos.salarioMinimo, frontera.datos.topeSalarioMinimo, frontera.datos.usaTopeSalarioMinimo],
    ['frontera', 440.87, 881.74, true]);
igual('sin prima ni riesgo no hay tope que enseñar', renuncia.datos.usaTopeSalarioMinimo, false);
verificar('resumen: el salario mínimo con su zona', /salario mínimo \$440\.87 \(Zona Libre de la Frontera Norte\)/.test(C.resumen(frontera)));
// La exención de ISR de las indemnizaciones sigue en UMA (como la aplica el SAT).
cerca('ISR: la frontera no cambia la exención de la separación (va en UMA)',
    C.calcular({ ...base, calcularISR: true, zona: 'frontera' }).isr.exentoSeparacion, i.exentoSeparacion);

// ---------- Validación ----------
verificar('valida: sin fechas no calcula', !C.calcular({ supuesto: 'renuncia', salario: 1000 }).ok);
verificar('valida: baja antes del ingreso', !C.calcular({ ...base, fechaBaja: '2019-01-01' }).ok);
verificar('valida: sin salario', !C.calcular({ ...base, salario: 0 }).ok);
verificar('valida: fecha imposible', !C.calcular({ ...base, fechaIngreso: '2026-02-30' }).ok);

console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
if (fallidas) {
    console.log('  Fallos:');
    fallos.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
}
console.log('  ✓ Finiquito, liquidación e indemnizaciones cuadran con la ley.');
