/**
 * Calculadora laboral: finiquito, liquidación y otras indemnizaciones (LFT).
 *
 * Dos partes:
 *  - El motor (`calcular`), puro: recibe los datos y devuelve cada concepto
 *    con su fórmula y su fundamento. No toca el DOM, así que se prueba en Node.
 *  - La interfaz, que solo lee el formulario, llama al motor y pinta.
 *
 * La lógica básica sigue la de las calculadoras públicas (PROFEDET y las más
 * usadas), afinada contra la ley donde esas se simplifican:
 *  - vacaciones con la tabla de "vacaciones dignas" (reforma 2023);
 *  - proporcionales por AÑO DE SERVICIO (art. 79), no por año calendario;
 *  - prima de antigüedad con el salario topado entre 1 y 2 salarios mínimos
 *    (arts. 485 y 486), y en renuncia solo con 15 años o más (art. 162-III);
 *  - los 20 días por año solo donde la ley los da (arts. 49, 50, 52, 439),
 *    con la opción de sumarlos cuando se negocian en un convenio;
 *  - salarios vencidos topados a 12 meses más intereses (art. 48);
 *  - ISR estimado con exenciones en UMA y tasa efectiva del art. 95 LISR.
 */
(function (global) {
    'use strict';

    // ==================== PARÁMETROS VIGENTES ====================
    // Todo lo que cambia cada año vive aquí, y en la interfaz se puede ajustar.
    const PARAMETROS = {
        anio: 2026,
        // CONASAMI, vigentes desde el 1 de enero de 2026.
        salarioMinimo: { general: 315.04, frontera: 440.87 },
        // INEGI, vigente desde el 1 de febrero de 2026.
        uma: 117.31,
        // Tarifa mensual del art. 96 LISR, Anexo 8 RMF 2026 (DOF 28-12-2025).
        // [límite inferior, cuota fija, % sobre el excedente]
        tarifaMensualISR: [
            [0.01, 0.00, 1.92],
            [844.60, 16.22, 6.40],
            [7168.52, 420.95, 10.88],
            [12598.03, 1011.68, 16.00],
            [14644.65, 1339.14, 17.92],
            [17533.65, 1856.84, 21.36],
            [35362.84, 5665.16, 23.52],
            [55736.69, 10457.09, 30.00],
            [106410.51, 25659.23, 32.00],
            [141880.67, 37009.69, 34.00],
            [425642.00, 133488.54, 35.00]
        ]
    };

    // ==================== SUPUESTOS ====================
    // Qué paga cada forma de terminar la relación. `primaAntiguedad`:
    // 'siempre' o 'quince' (solo con 15 años o más, art. 162-III).
    const SUPUESTOS = {
        renuncia: {
            nombre: 'Renuncia voluntaria',
            descripcion: 'El trabajador deja el empleo por decisión propia. Se paga el finiquito; la prima de antigüedad solo con 15 años o más.',
            primaAntiguedad: 'quince'
        },
        mutuo: {
            nombre: 'Terminación por mutuo consentimiento o fin de contrato',
            descripcion: 'Acuerdo de ambas partes o conclusión de la obra o del tiempo pactado (art. 53-I y III). Finiquito; prima de antigüedad con 15 años o más.',
            primaAntiguedad: 'quince'
        },
        despidoJustificado: {
            nombre: 'Despido justificado (rescisión por el patrón, art. 47)',
            descripcion: 'Hubo causa legal y el patrón la acredita. No hay indemnización, pero sí finiquito y prima de antigüedad, sin importar los años (art. 162-III).',
            primaAntiguedad: 'siempre'
        },
        despidoInjustificado: {
            nombre: 'Despido injustificado (liquidación, art. 48)',
            descripcion: 'El trabajador opta por la indemnización en vez de la reinstalación: 3 meses de salario, prima de antigüedad y, si hubo juicio, salarios vencidos. Los 20 días por año no los da el art. 48; se pueden sumar si se pactan en convenio.',
            primaAntiguedad: 'siempre',
            tresMeses: true,
            veinteDias: 'opcional',
            salariosVencidos: true
        },
        negativaReinstalar: {
            nombre: 'Negativa del patrón a reinstalar (arts. 49 y 50)',
            descripcion: 'El patrón se niega a reinstalar (trabajadores de confianza, de menos de un año, domésticos, etc., o cuando no acata la reinstalación): 3 meses, 20 días por año, prima de antigüedad y salarios vencidos.',
            primaAntiguedad: 'siempre',
            tresMeses: true,
            veinteDias: 'siempre',
            salariosVencidos: true
        },
        rescisionTrabajador: {
            nombre: 'Rescisión por causa imputable al patrón (arts. 51 y 52)',
            descripcion: 'El trabajador se separa por falta del patrón (no pagarle, malos tratos, reducir su salario…). Se indemniza como el art. 50: 3 meses, 20 días por año y prima de antigüedad.',
            primaAntiguedad: 'siempre',
            tresMeses: true,
            veinteDias: 'siempre',
            salariosVencidos: true
        },
        cierreEmpresa: {
            nombre: 'Terminación colectiva por cierre o quiebra (arts. 434 y 436)',
            descripcion: 'Cierre de la empresa, incosteabilidad, agotamiento de la materia o concurso: 3 meses de salario y prima de antigüedad.',
            primaAntiguedad: 'siempre',
            tresMeses: true
        },
        reajuste: {
            nombre: 'Reajuste por nueva maquinaria o procedimientos (art. 439)',
            descripcion: 'Reducción de personal por implantar maquinaria o procedimientos nuevos: 4 meses de salario, 20 días por año y prima de antigüedad.',
            primaAntiguedad: 'siempre',
            cuatroMeses: true,
            veinteDias: 'siempre'
        },
        incapacidadNoProfesional: {
            nombre: 'Incapacidad no derivada de riesgo de trabajo (arts. 53-IV y 54)',
            descripcion: 'Incapacidad física o mental que impide trabajar y no viene del trabajo: un mes de salario y 12 días por año (prima de antigüedad).',
            primaAntiguedad: 'siempre',
            unMes: true
        },
        muerte: {
            nombre: 'Muerte del trabajador (causa ajena al trabajo)',
            descripcion: 'Se paga a los beneficiarios el finiquito y la prima de antigüedad, sin importar los años (art. 162-V).',
            primaAntiguedad: 'siempre'
        },
        muerteRiesgo: {
            nombre: 'Muerte por riesgo de trabajo (arts. 500 y 502)',
            descripcion: 'Indemnización de 5,000 días de salario y dos meses para gastos funerarios, además del finiquito y la prima de antigüedad. Si el trabajador estaba en el IMSS, el Seguro cubre las prestaciones del riesgo (art. 53 LSS).',
            primaAntiguedad: 'siempre',
            riesgo: 'muerte'
        },
        incapacidadTotal: {
            nombre: 'Incapacidad permanente total por riesgo de trabajo (art. 495)',
            descripcion: 'Indemnización de 1,095 días de salario, además del finiquito y la prima de antigüedad. Con IMSS, la cubre el Seguro.',
            primaAntiguedad: 'siempre',
            riesgo: 'total'
        },
        incapacidadParcial: {
            nombre: 'Incapacidad permanente parcial por riesgo de trabajo (art. 492)',
            descripcion: 'El porcentaje de la tabla del art. 514 aplicado a 1,095 días de salario. Con IMSS, la cubre el Seguro.',
            primaAntiguedad: null,
            riesgo: 'parcial'
        }
    };

    // ==================== UTILIDADES ====================

    const DIA_MS = 86400000;

    function redondear(n) {
        return Math.round((n + Number.EPSILON) * 100) / 100;
    }

    /** 'AAAA-MM-DD' → Date en UTC (sin horas, sin sorpresas de zona horaria). */
    function fecha(texto) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto || '').trim());
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return d.getUTCMonth() === +m[2] - 1 ? d : null;
    }

    function diasEntre(a, b) {
        return Math.round((b - a) / DIA_MS);
    }

    /** El mismo día N años después; un 29 de febrero cae en 28 si no es bisiesto. */
    function sumarAnios(d, n) {
        const anio = d.getUTCFullYear() + n;
        const mes = d.getUTCMonth();
        const ultimoDelMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
        return new Date(Date.UTC(anio, mes, Math.min(d.getUTCDate(), ultimoDelMes)));
    }

    function esBisiesto(anio) {
        return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
    }

    /** Días de vacaciones del N-ésimo año de servicio (art. 76, reforma 2023). */
    function diasVacaciones(anioDeServicio) {
        const n = Math.floor(anioDeServicio);
        if (n < 1) return 0;
        if (n <= 5) return 10 + 2 * n;               // 12, 14, 16, 18, 20
        return 20 + 2 * Math.ceil((n - 5) / 5);      // 6-10: 22, 11-15: 24…
    }

    /**
     * Antigüedad contando el día de ingreso y el de baja como trabajados.
     * Un año se cumple el día anterior al aniversario: quien entró el 1 de
     * marzo cumple su primer año trabajando hasta el 28 de febrero.
     */
    function antiguedad(ingreso, baja) {
        const diasServicio = diasEntre(ingreso, baja) + 1;
        let anios = 0;
        while (diasEntre(sumarAnios(ingreso, anios + 1), baja) >= -1) anios++;
        const inicioAnioEnCurso = sumarAnios(ingreso, anios);
        const diasAnioEnCurso = Math.max(0, diasEntre(inicioAnioEnCurso, baja) + 1);
        return {
            diasServicio,
            aniosCompletos: anios,
            diasAnioEnCurso,
            decimal: anios + diasAnioEnCurso / 365
        };
    }

    function salarioDiarioDe(monto, periodo, divisorMensual) {
        const divisores = { diario: 1, semanal: 7, catorcenal: 14, quincenal: 15, mensual: divisorMensual || 30 };
        return monto / (divisores[periodo] || 1);
    }

    function isrTarifaMensual(base, tarifa) {
        if (!(base > 0)) return 0;
        let fila = tarifa[0];
        for (const f of tarifa) if (base >= f[0]) fila = f;
        return fila[1] + (base - fila[0]) * fila[2] / 100;
    }

    const dinero = (n) => '$' + redondear(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const num = (n, dec = 2) => redondear(n).toLocaleString('es-MX', { maximumFractionDigits: dec });

    // ==================== MOTOR ====================

    /**
     * datos: {
     *   supuesto, fechaIngreso, fechaBaja ('AAAA-MM-DD'), salario, periodo,
     *   divisorMensual (30), diasAguinaldo (15), primaVacacionalPct (25),
     *   zona ('general'|'frontera'), salarioMinimo?, uma?,
     *   otrasPrestacionesDiarias (se integran al SDI), sdiManual?,
     *   diasVacacionesAnio? (si el contrato da más que la ley),
     *   vacacionesPendientesDias, vacacionesTomadasAnioDias,
     *   aguinaldoPagado ($), diasSalarioPendientes, otrasPercepciones ($),
     *   tipoContrato ('indeterminado'|'determinado'),
     *   incluirVeinteDias (despido injustificado), mesesJuicio,
     *   porcentajeIncapacidad, calcularISR, salarioMensualISR?
     * }
     */
    function calcular(entrada) {
        const d = Object.assign({
            periodo: 'mensual', divisorMensual: 30, diasAguinaldo: 15, primaVacacionalPct: 25,
            zona: 'general', otrasPrestacionesDiarias: 0, vacacionesPendientesDias: 0,
            vacacionesTomadasAnioDias: 0, aguinaldoPagado: 0, diasSalarioPendientes: 0,
            otrasPercepciones: 0, tipoContrato: 'indeterminado', incluirVeinteDias: false,
            mesesJuicio: 0, porcentajeIncapacidad: 0, calcularISR: true
        }, entrada || {});
        const errores = [];
        const avisos = [];

        const supuesto = SUPUESTOS[d.supuesto];
        if (!supuesto) errores.push('Elige el motivo de la terminación.');
        const ingreso = fecha(d.fechaIngreso);
        const baja = fecha(d.fechaBaja);
        if (!ingreso) errores.push('Falta la fecha de ingreso.');
        if (!baja) errores.push('Falta la fecha de terminación.');
        if (ingreso && baja && baja < ingreso) errores.push('La fecha de terminación es anterior a la de ingreso.');
        const salario = Number(d.salario);
        if (!(salario > 0)) errores.push('Indica el salario.');
        if (errores.length) return { ok: false, errores };

        const n = (v) => Math.max(0, Number(v) || 0);
        const sm = n(d.salarioMinimo) || PARAMETROS.salarioMinimo[d.zona] || PARAMETROS.salarioMinimo.general;
        const uma = n(d.uma) || PARAMETROS.uma;
        const primaPct = Math.max(25, n(d.primaVacacionalPct)) / 100;
        if (n(d.primaVacacionalPct) < 25) avisos.push('La prima vacacional no puede ser menor al 25% (art. 80); se usó 25%.');
        const diasAguinaldo = Math.max(15, n(d.diasAguinaldo));
        if (n(d.diasAguinaldo) < 15) avisos.push('El aguinaldo no puede ser menor a 15 días (art. 87); se usaron 15.');

        const ant = antiguedad(ingreso, baja);
        const sd = salarioDiarioDe(salario, d.periodo, n(d.divisorMensual) || 30);
        if (sd < sm) avisos.push(`El salario diario (${dinero(sd)}) es menor al mínimo de la zona (${dinero(sm)}).`);

        // Vacaciones del año de servicio en curso (el que no se completó).
        const anioEnCurso = ant.aniosCompletos + 1;
        const vacLey = diasVacaciones(anioEnCurso);
        const vacAnio = Math.max(vacLey, n(d.diasVacacionesAnio));

        // Salario diario integrado (art. 84 y 89): cuota diaria más la parte
        // diaria de aguinaldo y prima vacacional, más lo demás que se pague
        // con regularidad.
        const factor = 1 + (diasAguinaldo + vacAnio * primaPct) / 365;
        const sdiCalculado = sd * factor + n(d.otrasPrestacionesDiarias);
        const sdi = n(d.sdiManual) || sdiCalculado;

        const conceptos = [];
        const agregar = (c) => { c.importe = redondear(c.importe); if (c.importe > 0 || c.mostrarEnCero) conceptos.push(c); };

        // ---------- Finiquito: lo que se debe siempre ----------
        agregar({
            clave: 'salarios', grupo: 'finiquito', fiscal: 'ordinario',
            concepto: 'Salarios devengados no pagados',
            formula: `${num(n(d.diasSalarioPendientes))} días × ${dinero(sd)}`,
            fundamento: 'Arts. 82 y 88 LFT',
            importe: n(d.diasSalarioPendientes) * sd
        });

        const anioBaja = baja.getUTCFullYear();
        const inicioAnio = new Date(Date.UTC(anioBaja, 0, 1));
        const desde = ingreso > inicioAnio ? ingreso : inicioAnio;
        const diasDelAnio = esBisiesto(anioBaja) ? 366 : 365;
        const diasAnioCalendario = diasEntre(desde, baja) + 1;
        const aguinaldoDias = diasAguinaldo * diasAnioCalendario / diasDelAnio;
        const aguinaldoBruto = aguinaldoDias * sd;
        agregar({
            clave: 'aguinaldo', grupo: 'finiquito', fiscal: 'aguinaldo',
            concepto: 'Aguinaldo proporcional',
            formula: `${diasAguinaldo} días × ${diasAnioCalendario}/${diasDelAnio} días trabajados en ${anioBaja} = ${num(aguinaldoDias, 4)} días × ${dinero(sd)}` +
                (n(d.aguinaldoPagado) ? ` − ${dinero(n(d.aguinaldoPagado))} ya pagado` : ''),
            fundamento: 'Art. 87 LFT',
            importe: Math.max(0, aguinaldoBruto - n(d.aguinaldoPagado)),
            mostrarEnCero: true
        });

        const vacPropDias = Math.max(0, vacAnio * ant.diasAnioEnCurso / 365 - n(d.vacacionesTomadasAnioDias));
        agregar({
            clave: 'vacacionesProporcionales', grupo: 'finiquito', fiscal: 'ordinario',
            concepto: `Vacaciones proporcionales (año de servicio ${anioEnCurso})`,
            formula: `${vacAnio} días × ${ant.diasAnioEnCurso}/365 días del año en curso` +
                (n(d.vacacionesTomadasAnioDias) ? ` − ${num(n(d.vacacionesTomadasAnioDias))} ya tomados` : '') +
                ` = ${num(vacPropDias, 4)} días × ${dinero(sd)}`,
            fundamento: 'Arts. 76 y 79 LFT',
            importe: vacPropDias * sd,
            mostrarEnCero: true
        });

        const vacPendDias = n(d.vacacionesPendientesDias);
        agregar({
            clave: 'vacacionesPendientes', grupo: 'finiquito', fiscal: 'ordinario',
            concepto: 'Vacaciones de años anteriores no disfrutadas',
            formula: `${num(vacPendDias)} días × ${dinero(sd)}`,
            fundamento: 'Arts. 76, 81 y 516 LFT (prescriben al año)',
            importe: vacPendDias * sd
        });

        const primaVacDias = vacPropDias + vacPendDias;
        agregar({
            clave: 'primaVacacional', grupo: 'finiquito', fiscal: 'primaVacacional',
            concepto: `Prima vacacional (${num(primaPct * 100)}%)`,
            formula: `${num(primaVacDias, 4)} días de vacaciones × ${dinero(sd)} × ${num(primaPct * 100)}%`,
            fundamento: 'Art. 80 LFT',
            importe: primaVacDias * sd * primaPct,
            mostrarEnCero: true
        });

        agregar({
            clave: 'otras', grupo: 'finiquito', fiscal: 'ordinario',
            concepto: d.otrasPercepcionesConcepto ? `Otras percepciones: ${d.otrasPercepcionesConcepto}` : 'Otras percepciones adeudadas',
            formula: 'Importe capturado',
            fundamento: 'Horas extra, PTU, bonos, comisiones… adeudados',
            importe: n(d.otrasPercepciones)
        });

        // ---------- Indemnizaciones ----------
        if (supuesto.tresMeses) {
            agregar({
                clave: 'tresMeses', grupo: 'indemnizacion', fiscal: 'separacion',
                concepto: 'Indemnización constitucional (3 meses)',
                formula: `90 días × ${dinero(sdi)} (salario integrado)`,
                fundamento: 'Art. 123-A-XXII Constitución; arts. 48, 50-III y 89 LFT',
                importe: 90 * sdi
            });
        }
        if (supuesto.cuatroMeses) {
            agregar({
                clave: 'cuatroMeses', grupo: 'indemnizacion', fiscal: 'separacion',
                concepto: 'Indemnización por reajuste (4 meses)',
                formula: `120 días × ${dinero(sdi)} (salario integrado)`,
                fundamento: 'Art. 439 LFT',
                importe: 120 * sdi
            });
        }
        if (supuesto.unMes) {
            agregar({
                clave: 'unMes', grupo: 'indemnizacion', fiscal: 'separacion',
                concepto: 'Un mes de salario por incapacidad',
                formula: `30 días × ${dinero(sdi)} (salario integrado)`,
                fundamento: 'Art. 54 LFT',
                importe: 30 * sdi
            });
        }

        const veinte = supuesto.veinteDias === 'siempre' ||
            (supuesto.veinteDias === 'opcional' && d.incluirVeinteDias);
        if (veinte) {
            let importe, formula, fundamento;
            if (d.tipoContrato === 'determinado') {
                if (ant.decimal < 1) {
                    importe = sdi * ant.diasServicio / 2;
                    formula = `Mitad del tiempo de servicios: ${ant.diasServicio} días ÷ 2 × ${dinero(sdi)}`;
                } else {
                    importe = 180 * sdi + 20 * sdi * (ant.decimal - 1);
                    formula = `6 meses (180 días) por el primer año + 20 días × ${num(ant.decimal - 1, 4)} años siguientes, × ${dinero(sdi)}`;
                }
                fundamento = 'Art. 50-I LFT (contrato por tiempo determinado)';
            } else {
                importe = 20 * sdi * ant.decimal;
                formula = `20 días × ${num(ant.decimal, 4)} años × ${dinero(sdi)} (salario integrado)`;
                fundamento = supuesto.veinteDias === 'opcional'
                    ? 'Art. 50-II LFT (sumado por convenio: el art. 48 no lo impone)'
                    : 'Art. 50-II LFT';
            }
            agregar({
                clave: 'veinteDias', grupo: 'indemnizacion', fiscal: 'separacion',
                concepto: d.tipoContrato === 'determinado' ? 'Indemnización por contrato determinado' : '20 días por año de servicio',
                formula, fundamento, importe
            });
        }

        // Prima de antigüedad: 12 días por año con el salario entre 1 y 2 mínimos.
        const aplicaPrima = supuesto.primaAntiguedad === 'siempre' ||
            (supuesto.primaAntiguedad === 'quince' && ant.aniosCompletos >= 15);
        const basePrima = Math.min(Math.max(sd, sm), 2 * sm);
        if (aplicaPrima) {
            agregar({
                clave: 'primaAntiguedad', grupo: 'indemnizacion', fiscal: 'separacion',
                concepto: 'Prima de antigüedad',
                formula: `12 días × ${num(ant.decimal, 4)} años × ${dinero(basePrima)}` +
                    (sd > 2 * sm ? ` (tope: 2 salarios mínimos)` : sd < sm ? ' (mínimo: 1 salario mínimo)' : ''),
                fundamento: 'Arts. 162, 485 y 486 LFT',
                importe: 12 * basePrima * ant.decimal
            });
        } else if (supuesto.primaAntiguedad === 'quince') {
            avisos.push(`Sin prima de antigüedad: en ${supuesto.nombre.toLowerCase()} solo se paga con 15 años o más (art. 162-III); lleva ${ant.aniosCompletos}.`);
        }

        // Salarios vencidos: hasta 12 meses; después, 2% mensual sobre 15 meses.
        const meses = n(d.mesesJuicio);
        if (supuesto.salariosVencidos && meses > 0) {
            const mesesTopados = Math.min(meses, 12);
            agregar({
                clave: 'salariosVencidos', grupo: 'indemnizacion', fiscal: 'separacion',
                concepto: 'Salarios vencidos (caídos)',
                formula: `${num(mesesTopados)} meses × 30 días × ${dinero(sdi)}` + (meses > 12 ? ' (tope de 12 meses)' : ''),
                fundamento: 'Art. 48 LFT',
                importe: mesesTopados * 30 * sdi
            });
            if (meses > 12) {
                agregar({
                    clave: 'interesesVencidos', grupo: 'indemnizacion', fiscal: 'separacion',
                    concepto: 'Intereses después de 12 meses de juicio',
                    formula: `15 meses × 30 días × ${dinero(sdi)} × 2% × ${num(meses - 12)} meses`,
                    fundamento: 'Art. 48 LFT (2% mensual sobre 15 meses de salario)',
                    importe: 15 * 30 * sdi * 0.02 * (meses - 12)
                });
            }
        }

        // Riesgos de trabajo: salario del día del riesgo, entre 1 y 2 mínimos.
        if (supuesto.riesgo) {
            const baseRiesgo = Math.min(Math.max(sdi, sm), 2 * sm);
            const nota = sdi > 2 * sm ? ' (tope: 2 salarios mínimos, art. 486)' : sdi < sm ? ' (mínimo: art. 485)' : '';
            if (supuesto.riesgo === 'muerte') {
                agregar({
                    clave: 'muerteRiesgo', grupo: 'indemnizacion', fiscal: 'riesgo',
                    concepto: 'Indemnización por muerte',
                    formula: `5,000 días × ${dinero(baseRiesgo)}${nota}`,
                    fundamento: 'Arts. 502, 484 y 486 LFT',
                    importe: 5000 * baseRiesgo
                });
                agregar({
                    clave: 'funerarios', grupo: 'indemnizacion', fiscal: 'riesgo',
                    concepto: 'Gastos funerarios (2 meses)',
                    formula: `60 días × ${dinero(baseRiesgo)}${nota}`,
                    fundamento: 'Art. 500-I LFT',
                    importe: 60 * baseRiesgo
                });
            } else if (supuesto.riesgo === 'total') {
                agregar({
                    clave: 'incapacidadTotal', grupo: 'indemnizacion', fiscal: 'riesgo',
                    concepto: 'Indemnización por incapacidad permanente total',
                    formula: `1,095 días × ${dinero(baseRiesgo)}${nota}`,
                    fundamento: 'Arts. 495, 484 y 486 LFT',
                    importe: 1095 * baseRiesgo
                });
            } else if (supuesto.riesgo === 'parcial') {
                const pct = Math.min(100, n(d.porcentajeIncapacidad));
                if (!pct) avisos.push('Indica el porcentaje de incapacidad de la tabla del art. 514.');
                agregar({
                    clave: 'incapacidadParcial', grupo: 'indemnizacion', fiscal: 'riesgo',
                    concepto: `Indemnización por incapacidad permanente parcial (${num(pct)}%)`,
                    formula: `${num(pct)}% × 1,095 días × ${dinero(baseRiesgo)}${nota}`,
                    fundamento: 'Arts. 492, 514 y 486 LFT',
                    importe: pct / 100 * 1095 * baseRiesgo,
                    mostrarEnCero: true
                });
            }
        }

        const suma = (grupo) => redondear(conceptos.filter(c => !grupo || c.grupo === grupo)
            .reduce((s, c) => s + c.importe, 0));
        const totales = {
            finiquito: suma('finiquito'),
            indemnizacion: suma('indemnizacion'),
            bruto: suma()
        };

        // ---------- ISR (estimación) ----------
        let isr = null;
        if (d.calcularISR) {
            isr = estimarISR(conceptos, {
                uma, ant, tarifa: PARAMETROS.tarifaMensualISR,
                sueldoMensual: n(d.salarioMensualISR) || sd * 30
            });
            totales.isr = isr.total;
            totales.neto = redondear(totales.bruto - isr.total);
        }

        return {
            ok: true,
            supuesto: Object.assign({ clave: d.supuesto }, supuesto),
            datos: {
                salarioDiario: redondear(sd), salarioDiarioIntegrado: redondear(sdi),
                factorIntegracion: Math.round(factor * 10000) / 10000,
                sdiManual: !!n(d.sdiManual),
                salarioMinimo: sm, uma, basePrimaAntiguedad: redondear(basePrima),
                antiguedad: ant, anioDeServicioEnCurso: anioEnCurso, diasVacacionesAnio: vacAnio,
                diasAguinaldo, primaVacacionalPct: primaPct * 100
            },
            conceptos, totales, isr, avisos
        };
    }

    /**
     * ISR estimado. Lo ordinario (salarios, vacaciones, la parte gravada del
     * aguinaldo y de la prima) se suma al sueldo del mes y paga la diferencia
     * de tarifa. Lo de separación exenta 90 UMA por año de servicio (fracción
     * de más de seis meses = año) y el resto paga a la tasa efectiva del
     * último sueldo mensual ordinario (art. 95 LISR), salvo que sea menor a
     * ese sueldo: entonces se acumula. Las indemnizaciones por riesgo de
     * trabajo están exentas (art. 93-III LISR).
     */
    function estimarISR(conceptos, { uma, ant, tarifa, sueldoMensual }) {
        const tot = (fiscal) => conceptos.filter(c => c.fiscal === fiscal).reduce((s, c) => s + c.importe, 0);
        const exentoAguinaldo = Math.min(tot('aguinaldo'), 30 * uma);
        const exentoPrima = Math.min(tot('primaVacacional'), 15 * uma);
        const gravadoOrdinario = tot('ordinario') + tot('aguinaldo') - exentoAguinaldo + tot('primaVacacional') - exentoPrima;

        const aniosExencion = ant.aniosCompletos + (ant.diasAnioEnCurso > 182 ? 1 : 0);
        const separacion = tot('separacion');
        const exentoSeparacion = Math.min(separacion, 90 * uma * aniosExencion);
        const gravadoSeparacion = separacion - exentoSeparacion;

        const isrBase = isrTarifaMensual(sueldoMensual, tarifa);
        const isrOrdinario = isrTarifaMensual(sueldoMensual + gravadoOrdinario, tarifa) - isrBase;
        const tasaEfectiva = sueldoMensual > 0 ? isrBase / sueldoMensual : 0;
        let isrSeparacion;
        let metodoSeparacion;
        if (gravadoSeparacion <= 0) {
            isrSeparacion = 0;
            metodoSeparacion = 'Todo exento';
        } else if (gravadoSeparacion < sueldoMensual) {
            isrSeparacion = isrTarifaMensual(sueldoMensual + gravadoOrdinario + gravadoSeparacion, tarifa) -
                isrTarifaMensual(sueldoMensual + gravadoOrdinario, tarifa);
            metodoSeparacion = 'Menor al último sueldo mensual: se acumula con la tarifa';
        } else {
            isrSeparacion = gravadoSeparacion * tasaEfectiva;
            metodoSeparacion = `Tasa efectiva del último sueldo mensual: ${num(tasaEfectiva * 100)}%`;
        }

        return {
            exentoAguinaldo: redondear(exentoAguinaldo),
            exentoPrimaVacacional: redondear(exentoPrima),
            gravadoOrdinario: redondear(gravadoOrdinario),
            isrOrdinario: redondear(isrOrdinario),
            aniosExencion,
            exentoSeparacion: redondear(exentoSeparacion),
            gravadoSeparacion: redondear(gravadoSeparacion),
            isrSeparacion: redondear(isrSeparacion),
            exentoRiesgo: redondear(tot('riesgo')),
            tasaEfectiva: Math.round(tasaEfectiva * 10000) / 100,
            sueldoMensual: redondear(sueldoMensual),
            metodoSeparacion,
            total: redondear(isrOrdinario + isrSeparacion)
        };
    }

    const motor = {
        PARAMETROS, SUPUESTOS, calcular, estimarISR, diasVacaciones, antiguedad,
        isrTarifaMensual, salarioDiarioDe, fecha, redondear, dinero
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = motor;
    global.CalculadoraLaboral = motor;

    // ==================== INTERFAZ ====================
    if (typeof document === 'undefined') return;

    const $ = (id) => document.getElementById(id);
    let ultimoResultado = null;

    function valor(id) { return $(id) ? $(id).value : ''; }
    function numero(id) { const v = parseFloat(valor(id)); return isNaN(v) ? 0 : v; }

    function leerFormulario() {
        return {
            supuesto: valor('lab-supuesto'),
            fechaIngreso: valor('lab-ingreso'),
            fechaBaja: valor('lab-baja'),
            salario: numero('lab-salario'),
            periodo: valor('lab-periodo'),
            divisorMensual: numero('lab-divisor') || 30,
            zona: valor('lab-zona'),
            salarioMinimo: numero('lab-sm'),
            uma: numero('lab-uma'),
            diasAguinaldo: numero('lab-aguinaldo-dias') || 15,
            primaVacacionalPct: numero('lab-prima-pct') || 25,
            diasVacacionesAnio: numero('lab-vac-contrato'),
            otrasPrestacionesDiarias: numero('lab-otras-integrables'),
            sdiManual: numero('lab-sdi-manual'),
            vacacionesPendientesDias: numero('lab-vac-pendientes'),
            vacacionesTomadasAnioDias: numero('lab-vac-tomadas'),
            aguinaldoPagado: numero('lab-aguinaldo-pagado'),
            diasSalarioPendientes: numero('lab-dias-pendientes'),
            otrasPercepciones: numero('lab-otras'),
            otrasPercepcionesConcepto: valor('lab-otras-concepto').trim(),
            tipoContrato: valor('lab-contrato'),
            incluirVeinteDias: !!$('lab-veinte')?.checked,
            mesesJuicio: numero('lab-meses-juicio'),
            porcentajeIncapacidad: numero('lab-pct-incapacidad'),
            calcularISR: !!$('lab-isr')?.checked,
            salarioMensualISR: numero('lab-sueldo-isr')
        };
    }

    // Muestra solo los campos que el motivo elegido usa.
    function ajustarCamposSegunSupuesto() {
        const s = SUPUESTOS[valor('lab-supuesto')] || {};
        const ver = (id, si) => { const el = $(id); if (el) el.style.display = si ? '' : 'none'; };
        ver('lab-grupo-veinte', s.veinteDias === 'opcional');
        ver('lab-grupo-contrato', !!s.veinteDias);
        ver('lab-grupo-juicio', !!s.salariosVencidos);
        ver('lab-grupo-incapacidad', s.riesgo === 'parcial');
        const desc = $('lab-supuesto-desc');
        if (desc) desc.textContent = s.descripcion || '';
    }

    function escapar(t) {
        return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function filasHTML(r, grupo) {
        return r.conceptos.filter(c => c.grupo === grupo).map(c => `
            <tr>
                <td><strong>${escapar(c.concepto)}</strong>
                    <div class="lab-formula">${escapar(c.formula)}</div>
                    <div class="lab-fundamento">${escapar(c.fundamento)}</div></td>
                <td class="lab-importe">${dinero(c.importe)}</td>
            </tr>`).join('');
    }

    function pintar(r) {
        const cont = $('lab-resultados');
        if (!cont) return;
        if (!r.ok) {
            cont.innerHTML = `<div class="lab-vacio">📝 ${r.errores.map(escapar).join('<br>')}</div>`;
            $('lab-acciones').style.display = 'none';
            return;
        }
        const a = r.datos.antiguedad;
        const hayIndemnizacion = r.conceptos.some(c => c.grupo === 'indemnizacion');
        const isr = r.isr;
        cont.innerHTML = `
            <div class="lab-resumen">
                <div class="lab-cifra"><span>Finiquito</span><strong>${dinero(r.totales.finiquito)}</strong></div>
                ${hayIndemnizacion ? `<div class="lab-cifra"><span>Indemnizaciones</span><strong>${dinero(r.totales.indemnizacion)}</strong></div>` : ''}
                <div class="lab-cifra lab-cifra-total"><span>Total bruto</span><strong id="lab-total-bruto">${dinero(r.totales.bruto)}</strong></div>
                ${isr ? `<div class="lab-cifra"><span>ISR estimado</span><strong>− ${dinero(isr.total)}</strong></div>
                <div class="lab-cifra lab-cifra-neto"><span>Neto estimado</span><strong>${dinero(r.totales.neto)}</strong></div>` : ''}
            </div>

            <div class="lab-bases">
                <span>Antigüedad: <strong>${a.aniosCompletos} año${a.aniosCompletos !== 1 ? 's' : ''} y ${a.diasAnioEnCurso} día${a.diasAnioEnCurso !== 1 ? 's' : ''}</strong> (${num(a.decimal, 4)} años)</span>
                <span>Salario diario: <strong>${dinero(r.datos.salarioDiario)}</strong></span>
                <span>Salario integrado: <strong>${dinero(r.datos.salarioDiarioIntegrado)}</strong>${r.datos.sdiManual ? ' (capturado)' : ` (factor ${r.datos.factorIntegracion})`}</span>
                <span>Vacaciones del año en curso: <strong>${r.datos.diasVacacionesAnio} días</strong></span>
            </div>

            ${r.avisos.length ? `<div class="lab-avisos">${r.avisos.map(x => `<p>⚠️ ${escapar(x)}</p>`).join('')}</div>` : ''}

            <table class="lab-tabla">
                <thead><tr><th>Finiquito</th><th class="lab-importe">Importe</th></tr></thead>
                <tbody>${filasHTML(r, 'finiquito')}</tbody>
                <tfoot><tr><td>Subtotal finiquito</td><td class="lab-importe">${dinero(r.totales.finiquito)}</td></tr></tfoot>
            </table>
            ${hayIndemnizacion ? `
            <table class="lab-tabla">
                <thead><tr><th>Indemnizaciones (${escapar(r.supuesto.nombre)})</th><th class="lab-importe">Importe</th></tr></thead>
                <tbody>${filasHTML(r, 'indemnizacion')}</tbody>
                <tfoot><tr><td>Subtotal indemnizaciones</td><td class="lab-importe">${dinero(r.totales.indemnizacion)}</td></tr></tfoot>
            </table>` : ''}
            ${isr ? `
            <details class="lab-isr">
                <summary>🧾 Cómo se estimó el ISR (${dinero(isr.total)})</summary>
                <ul>
                    <li>Aguinaldo exento (30 UMA): ${dinero(isr.exentoAguinaldo)}; prima vacacional exenta (15 UMA): ${dinero(isr.exentoPrimaVacacional)}.</li>
                    <li>Gravado ordinario ${dinero(isr.gravadoOrdinario)} sumado al sueldo mensual de ${dinero(isr.sueldoMensual)}: ISR ${dinero(isr.isrOrdinario)}.</li>
                    <li>Pagos por separación: exentos ${dinero(isr.exentoSeparacion)} (90 UMA × ${isr.aniosExencion} año${isr.aniosExencion !== 1 ? 's' : ''}); gravados ${dinero(isr.gravadoSeparacion)}. ${escapar(isr.metodoSeparacion)}: ISR ${dinero(isr.isrSeparacion)}.</li>
                    ${isr.exentoRiesgo ? `<li>Indemnizaciones por riesgo de trabajo exentas: ${dinero(isr.exentoRiesgo)} (art. 93-III LISR).</li>` : ''}
                    <li>Tarifa mensual art. 96 LISR 2026. No incluye subsidio para el empleo. Es una estimación: la retención exacta la hace el patrón con su nómina.</li>
                </ul>
            </details>` : ''}
        `;
        $('lab-acciones').style.display = '';
    }

    function recalcularLaboral() {
        ajustarCamposSegunSupuesto();
        ultimoResultado = calcular(leerFormulario());
        pintar(ultimoResultado);
        // Las del último año cumplido son las que más se olvidan.
        const ayuda = $('lab-vac-pendientes-ayuda');
        if (ayuda) {
            const a = ultimoResultado.ok ? ultimoResultado.datos.antiguedad : null;
            ayuda.textContent = a && a.aniosCompletos >= 1
                ? `Si no tomó las de su año ${a.aniosCompletos} de servicio, son ${diasVacaciones(a.aniosCompletos)} días.`
                : '';
        }
        return ultimoResultado;
    }

    function resumenTexto(r) {
        if (!r || !r.ok) return '';
        const a = r.datos.antiguedad;
        const lineas = [
            `CÁLCULO LABORAL — ${r.supuesto.nombre}`,
            `Antigüedad: ${a.aniosCompletos} años y ${a.diasAnioEnCurso} días · Salario diario ${dinero(r.datos.salarioDiario)} · SDI ${dinero(r.datos.salarioDiarioIntegrado)}`,
            ''
        ];
        for (const c of r.conceptos) lineas.push(`• ${c.concepto}: ${dinero(c.importe)}  (${c.formula}; ${c.fundamento})`);
        lineas.push('', `Finiquito: ${dinero(r.totales.finiquito)}`);
        if (r.totales.indemnizacion) lineas.push(`Indemnizaciones: ${dinero(r.totales.indemnizacion)}`);
        lineas.push(`TOTAL BRUTO: ${dinero(r.totales.bruto)}`);
        if (r.isr) lineas.push(`ISR estimado: ${dinero(r.isr.total)} · NETO ESTIMADO: ${dinero(r.totales.neto)}`);
        lineas.push('', `Parámetros ${PARAMETROS.anio}: salario mínimo ${dinero(r.datos.salarioMinimo)}, UMA ${dinero(r.datos.uma)}. Estimación orientativa.`);
        return lineas.join('\n');
    }

    async function copiarResumenLaboral() {
        const texto = resumenTexto(ultimoResultado || recalcularLaboral());
        if (!texto) return;
        try {
            await navigator.clipboard.writeText(texto);
            if (typeof mostrarToast === 'function') mostrarToast('Resumen copiado', 'success');
        } catch (e) {
            if (typeof mostrarToast === 'function') mostrarToast('No se pudo copiar', 'error');
        }
    }

    async function guardarCalculoComoNota() {
        const r = ultimoResultado || recalcularLaboral();
        if (!r || !r.ok) return;
        const expedienteId = valor('lab-expediente') ? parseInt(valor('lab-expediente'), 10) : null;
        try {
            await crearNotaCore({
                titulo: `🧮 ${r.supuesto.nombre}: ${dinero(r.totales.bruto)}`,
                contenido: resumenTexto(r),
                expedienteId,
                color: '#e3f2fd'
            });
            if (typeof mostrarToast === 'function') mostrarToast('Cálculo guardado en Notas', 'success');
        } catch (e) {
            if (typeof mostrarToast === 'function') mostrarToast('No se pudo guardar: ' + e.message, 'error');
        }
    }

    function imprimirCalculoLaboral() {
        document.body.classList.add('imprimiendo-laboral');
        // En papel no hay dónde tocar para desplegar: el detalle del ISR va abierto.
        document.querySelectorAll('#page-laboral details.lab-isr').forEach(d => { d.open = true; });
        const quitar = () => { document.body.classList.remove('imprimiendo-laboral'); window.removeEventListener('afterprint', quitar); };
        window.addEventListener('afterprint', quitar);
        window.print();
        setTimeout(quitar, 1000);
    }

    async function prepararCalculadoraLaboral() {
        const hoy = new Date();
        const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
        if ($('lab-baja') && !$('lab-baja').value) $('lab-baja').value = iso;
        const sm = $('lab-sm');
        if (sm && !sm.value) sm.placeholder = PARAMETROS.salarioMinimo[valor('lab-zona')] || '';
        if ($('lab-uma') && !$('lab-uma').placeholder) $('lab-uma').placeholder = PARAMETROS.uma;
        // Expedientes para guardar el cálculo como nota.
        const sel = $('lab-expediente');
        if (sel && typeof obtenerExpedientes === 'function') {
            const previo = sel.value;
            const exps = await obtenerExpedientes().catch(() => []);
            sel.innerHTML = '<option value="">Sin expediente</option>' + exps.map(e =>
                `<option value="${e.id}">${escapar(e.numero || e.nombre)} — ${escapar(e.juzgado || '')}</option>`).join('');
            sel.value = previo;
        }
        recalcularLaboral();
    }

    function cambiarZonaLaboral() {
        const sm = $('lab-sm');
        if (sm) sm.placeholder = PARAMETROS.salarioMinimo[valor('lab-zona')] || '';
        recalcularLaboral();
    }

    Object.assign(global, {
        recalcularLaboral, prepararCalculadoraLaboral, copiarResumenLaboral,
        guardarCalculoComoNota, imprimirCalculoLaboral, cambiarZonaLaboral
    });
})(typeof window !== 'undefined' ? window : globalThis);
