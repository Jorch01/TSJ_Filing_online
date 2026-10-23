/**
 * Cuentas compartidas del despacho — función reservada.
 *
 * Lleva saldos permanentes de los gastos que se reparten entre colegas. Si
 * alguien paga 1,000 de un gasto que es mitad y mitad, queda con 500 a su
 * favor; si después el otro paga 600 de otro gasto mitad y mitad, los 300 que
 * le tocaban al primero se descuentan de esos 500 y lo que se muestra es la
 * diferencia: 200. Cada cuenta admite de 2 a 20 participantes y cada gasto se
 * reparte con los porcentajes que se elijan (50-50, 70-30, solo entre
 * algunos…).
 *
 * No aparece en el menú, en la paleta de comandos ni en la guía del
 * asistente: se abre pidiéndole al asistente "abre las cuentas" y eligiendo
 * del catálogo que muestra.
 *
 * Cómo se guarda. Cada cuenta es una bitácora de hechos que nunca se borran
 * ni se editan: se creó, se registró un gasto, se anuló un movimiento, alguien
 * pidió archivarla, otro lo confirmó… Los saldos, el histórico y el estado de
 * archivo se calculan siempre desde esa lista. Así:
 *   - el histórico está completo por construcción: corregir es anular y
 *     registrar de nuevo, y lo anulado sigue a la vista con su motivo;
 *   - fusionar lo de dos dispositivos es unir las dos listas sin repetir;
 *     no hay ediciones que se pisen ni conflictos que resolver.
 * Las cuentas viajan dentro del bloque cifrado de la sincronización, así que
 * las comparten todos los dispositivos de una misma licencia.
 *
 * El dinero va en centavos enteros: con decimales de coma flotante
 * 0.1 + 0.2 no da 0.3 y los saldos dejarían de sumar cero.
 *
 * Dos partes, como la calculadora laboral:
 *  - el motor, puro (sin DOM ni base de datos), que se prueba en Node;
 *  - la interfaz y el almacén, que solo corren en el navegador.
 */
(function (global) {
    'use strict';

    // ==================== MOTOR ====================

    const MIN_PARTICIPANTES = 2;
    const MAX_PARTICIPANTES = 20;
    const MONEDAS = ['MXN', 'USD', 'EUR'];
    const CATEGORIAS = [
        'Renta', 'Luz', 'Agua', 'Internet y teléfono', 'Papelería', 'Limpieza',
        'Cafetería e insumos', 'Mensajería', 'Software y suscripciones',
        'Mantenimiento', 'Gastos de expediente', 'Honorarios compartidos', 'Otros'
    ];
    // Lo que puede desviarse la suma de porcentajes de 100: "33.33" tres veces
    // da 99.99 y no por eso el reparto está mal.
    const TOLERANCIA_PORCENTAJE = 0.05;

    function normalizar(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /**
     * "1,000.50", "$1000", "1000,5", 1000.5 → centavos (100050). NaN si no es
     * una cantidad. Se lee el texto dígito a dígito en vez de multiplicar por
     * 100: 1.005 * 100 da 100.49999… y se perdería un centavo.
     */
    function aCentavos(valor) {
        if (valor == null || valor === '') return NaN;
        let t = String(valor).trim().replace(/[$\s]/g, '').replace(/^(MXN|USD|EUR)/i, '');
        // Una coma sin punto es decimal salvo que agrupe miles ("1,000").
        if (t.includes(',') && !t.includes('.')) {
            const partes = t.split(',');
            const miles = partes.slice(1).every(p => p.length === 3);
            t = miles ? partes.join('') : partes.slice(0, -1).join('') + '.' + partes[partes.length - 1];
        } else {
            t = t.replace(/,/g, '');
        }
        const m = t.match(/^(-?)(\d*)(?:\.(\d*))?$/);
        if (!m || (!m[2] && !m[3])) return NaN;
        const dec = m[3] || '';
        let total = parseInt(m[2] || '0', 10) * 100 + parseInt((dec + '00').slice(0, 2), 10);
        if (dec.length > 2 && dec[2] >= '5') total += 1;
        return m[1] ? -total : total;
    }

    function formatoMoneda(centavos, moneda) {
        const n = (centavos || 0) / 100;
        try {
            return new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda || 'MXN' }).format(n);
        } catch (e) {
            return '$' + n.toFixed(2);
        }
    }

    /** Monto con signo explícito: "+$200.00" a favor, "−$200.00" en contra. */
    function formatoSaldo(centavos, moneda) {
        if (!centavos) return formatoMoneda(0, moneda);
        return (centavos > 0 ? '+' : '−') + formatoMoneda(Math.abs(centavos), moneda);
    }

    /** Porcentajes iguales con dos decimales que suman exactamente 100. */
    function repartoIgual(ids) {
        const reparto = {};
        if (!ids || !ids.length) return reparto;
        const base = Math.floor(10000 / ids.length);
        let sobra = 10000 - base * ids.length;
        for (const id of ids) {
            reparto[id] = (base + (sobra > 0 ? 1 : 0)) / 100;
            if (sobra > 0) sobra--;
        }
        return reparto;
    }

    function sumaReparto(reparto) {
        return Object.values(reparto || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    }

    /** null si el reparto vale; si no, por qué. */
    function validarReparto(reparto, idsParticipantes) {
        const ids = new Set(idsParticipantes || []);
        const entradas = Object.entries(reparto || {});
        for (const [id, pct] of entradas) {
            if (!ids.has(id)) return 'El reparto incluye a alguien que no participa en la cuenta';
            if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return 'Cada porcentaje debe ser un número de 0 a 100';
        }
        if (!entradas.some(([, pct]) => pct > 0)) return 'Al menos una persona debe asumir parte del gasto';
        const suma = sumaReparto(reparto);
        if (Math.abs(suma - 100) > TOLERANCIA_PORCENTAJE) {
            return `Los porcentajes suman ${Math.round(suma * 100) / 100}% y deben sumar 100%`;
        }
        return null;
    }

    /**
     * Parte un monto (en centavos) según el reparto. Las partes suman
     * exactamente el monto: lo que no se puede dividir (el centavo de 100
     * entre 3) va a quien tenga la fracción más grande, y en empate al primero
     * de la lista.
     */
    function repartirMonto(monto, reparto, orden) {
        const claves = Object.keys(reparto || {});
        const ids = (orden || []).filter(id => claves.includes(id))
            .concat(claves.filter(id => !(orden || []).includes(id)))
            .filter(id => (reparto[id] || 0) > 0);
        const total = ids.reduce((s, id) => s + reparto[id], 0);
        const cuotas = {};
        if (!ids.length || total <= 0 || !(monto > 0)) return cuotas;

        let asignado = 0;
        const restos = ids.map((id, i) => {
            const exacto = monto * reparto[id] / total;
            const base = Math.floor(exacto + 1e-9);
            cuotas[id] = base;
            asignado += base;
            return { id, resto: exacto - base, i };
        });
        restos.sort((a, b) => (b.resto - a.resto) || (a.i - b.i));
        for (let k = 0; k < monto - asignado; k++) cuotas[restos[k % restos.length].id] += 1;
        return cuotas;
    }

    function ordenarEventos(eventos) {
        return (eventos || []).slice().sort((a, b) =>
            (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    /**
     * El estado de una cuenta, calculado desde su bitácora. Es la única
     * fuente de verdad: lo que se ve en pantalla sale de aquí.
     *
     * saldos[id] > 0: a esa persona le deben; < 0: ella debe. Suman cero.
     */
    function derivarCuenta(cuenta) {
        const bitacora = ordenarEventos(cuenta && cuenta.eventos);
        const e = {
            uid: cuenta && cuenta.uid,
            nombre: 'Cuenta', descripcion: '', moneda: 'MXN',
            participantes: [], reparto: {},
            movimientos: [], saldos: {}, deudas: {},
            archivada: false, archivo: null, solicitud: null, ultimoRechazo: null, reactivada: null,
            eliminada: null, creada: null, creadaPor: null, actualizada: null,
            bitacora
        };
        const participantes = new Map();
        const movimientos = new Map();
        const anulaciones = new Map();

        const altaParticipante = (p, fecha) => {
            if (!p || !p.id || participantes.has(p.id)) return;
            const nuevo = { id: p.id, nombre: String(p.nombre || 'Participante'), pinHash: p.pinHash || null, alta: fecha };
            participantes.set(p.id, nuevo);
            e.participantes.push(nuevo);
        };
        const esParticipante = id => !!id && participantes.has(id);
        const revisarArchivo = (ev) => {
            const faltan = e.participantes.filter(p => !e.solicitud.confirmaciones[p.id]);
            if (faltan.length) return;
            e.archivada = true;
            e.archivo = { fecha: ev.fecha, solicitud: e.solicitud };
            e.solicitud = null;
        };

        for (const ev of bitacora) {
            if (!ev || !ev.tipo) continue;
            e.actualizada = ev.fecha;
            switch (ev.tipo) {
                case 'crear':
                    if (e.creada) break;
                    e.creada = ev.fecha;
                    e.creadaPor = ev.por || null;
                    e.nombre = String(ev.nombre || 'Cuenta');
                    e.descripcion = String(ev.descripcion || '');
                    e.moneda = MONEDAS.includes(ev.moneda) ? ev.moneda : 'MXN';
                    for (const p of ev.participantes || []) altaParticipante(p, ev.fecha);
                    e.reparto = { ...(ev.reparto || {}) };
                    break;
                case 'editar': {
                    const c = ev.cambios || {};
                    if (typeof c.nombre === 'string' && c.nombre.trim()) e.nombre = c.nombre.trim();
                    if (typeof c.descripcion === 'string') e.descripcion = c.descripcion;
                    if (c.reparto && typeof c.reparto === 'object') e.reparto = { ...c.reparto };
                    break;
                }
                case 'participante':
                    altaParticipante(ev.participante, ev.fecha);
                    break;
                case 'renombrar_participante': {
                    const p = participantes.get(ev.participanteId);
                    if (p && typeof ev.nombre === 'string' && ev.nombre.trim()) p.nombre = ev.nombre.trim();
                    break;
                }
                case 'pin': {
                    const p = participantes.get(ev.participanteId);
                    if (p) p.pinHash = ev.pinHash || null;
                    break;
                }
                case 'gasto':
                case 'pago':
                    if (!movimientos.has(ev.id)) {
                        movimientos.set(ev.id, {
                            ...(ev.mov || {}), id: ev.id, tipo: ev.tipo,
                            registradoPor: ev.por || null, registradoEn: ev.fecha
                        });
                    }
                    break;
                case 'anular':
                    // La primera anulación es la que cuenta; una segunda hecha a
                    // la vez en otro dispositivo no cambia nada.
                    if (ev.movId && !anulaciones.has(ev.movId)) {
                        anulaciones.set(ev.movId, { fecha: ev.fecha, por: ev.por || null, motivo: ev.motivo || '' });
                    }
                    break;
                case 'solicitar_archivo':
                    if (e.archivada) break;
                    // Si ya hay una solicitud abierta, pedir archivar es estar de
                    // acuerdo con ella: dos personas que lo piden a la vez desde
                    // dos dispositivos cuentan como dos conformidades.
                    if (!e.solicitud) {
                        e.solicitud = { id: ev.id, por: ev.por || null, fecha: ev.fecha, motivo: ev.motivo || '', confirmaciones: {} };
                    }
                    if (esParticipante(ev.por) && !e.solicitud.confirmaciones[ev.por]) {
                        e.solicitud.confirmaciones[ev.por] = ev.fecha;
                    }
                    revisarArchivo(ev);
                    break;
                case 'confirmar_archivo':
                    if (e.solicitud && ev.solicitudId === e.solicitud.id && esParticipante(ev.por)) {
                        if (!e.solicitud.confirmaciones[ev.por]) e.solicitud.confirmaciones[ev.por] = ev.fecha;
                        revisarArchivo(ev);
                    }
                    break;
                case 'rechazar_archivo':
                    if (e.solicitud && ev.solicitudId === e.solicitud.id) {
                        e.ultimoRechazo = { por: ev.por || null, fecha: ev.fecha, motivo: ev.motivo || '', solicitud: e.solicitud };
                        e.solicitud = null;
                    }
                    break;
                case 'reactivar':
                    if (e.archivada) {
                        e.archivada = false;
                        e.reactivada = { por: ev.por || null, fecha: ev.fecha, motivo: ev.motivo || '' };
                    }
                    break;
                case 'eliminar':
                    if (!e.eliminada) e.eliminada = { por: ev.por || null, fecha: ev.fecha };
                    break;
                default:
                    // Un tipo que no se conoce viene de una versión más nueva de
                    // la app: se conserva en la bitácora y aquí no se aplica.
                    break;
            }
        }

        const orden = e.participantes.map(p => p.id);
        const saldos = {};
        const deudas = {};
        // De dónde sale cada saldo: lo que pagó de gastos, lo que le tocaba de
        // ellos, y los pagos que hizo o recibió para ir quedando a mano.
        const totales = {};
        const porCategoria = {};
        let totalGastos = 0;
        for (const id of orden) {
            saldos[id] = 0;
            deudas[id] = {};
            totales[id] = { pagado: 0, parte: 0, dio: 0, recibio: 0 };
        }
        const total = id => (totales[id] = totales[id] || { pagado: 0, parte: 0, dio: 0, recibio: 0 });
        const sumarDeuda = (deudor, acreedor, monto) => {
            if (deudor === acreedor || !monto) return;
            if (!deudas[deudor]) deudas[deudor] = {};
            deudas[deudor][acreedor] = (deudas[deudor][acreedor] || 0) + monto;
        };
        const sumarSaldo = (id, monto) => { saldos[id] = (saldos[id] || 0) + monto; };

        // El histórico va por la fecha del gasto, no por cuándo se capturó:
        // un recibo de la semana pasada registrado hoy va en la semana pasada.
        const lista = Array.from(movimientos.values()).sort((a, b) =>
            ((a.fechaMov || '') < (b.fechaMov || '') ? -1 : (a.fechaMov || '') > (b.fechaMov || '') ? 1 : 0) ||
            (a.registradoEn < b.registradoEn ? -1 : a.registradoEn > b.registradoEn ? 1 : 0) ||
            (a.id < b.id ? -1 : 1));

        for (const mov of lista) {
            mov.anulado = anulaciones.get(mov.id) || null;
            const monto = Number(mov.monto) || 0;
            if (mov.tipo === 'gasto') {
                mov.cuotas = repartirMonto(monto, mov.reparto || {}, orden);
            } else {
                mov.cuotas = {};
            }
            if (!mov.anulado && monto > 0) {
                if (mov.tipo === 'gasto') {
                    sumarSaldo(mov.pagadoPor, monto);
                    total(mov.pagadoPor).pagado += monto;
                    totalGastos += monto;
                    const cat = String(mov.categoria || '').trim() || 'Sin categoría';
                    porCategoria[cat] = (porCategoria[cat] || 0) + monto;
                    for (const [id, cuota] of Object.entries(mov.cuotas)) {
                        sumarSaldo(id, -cuota);
                        total(id).parte += cuota;
                        sumarDeuda(id, mov.pagadoPor, cuota);
                    }
                } else if (mov.tipo === 'pago') {
                    // Quien paga reduce lo que debe: es como si el otro le
                    // debiera ese monto, y se compensa con lo que había.
                    sumarSaldo(mov.de, monto);
                    sumarSaldo(mov.a, -monto);
                    total(mov.de).dio += monto;
                    total(mov.a).recibio += monto;
                    sumarDeuda(mov.a, mov.de, monto);
                }
            }
            mov.saldoTras = { ...saldos };
        }

        e.movimientos = lista;
        e.saldos = saldos;
        e.deudas = deudas;
        e.totales = totales;
        e.porCategoria = porCategoria;
        e.totalGastos = totalGastos;
        // Una cuenta con movimientos vigentes no se puede eliminar, ni siquiera
        // si el gasto llegó de otro dispositivo después de pedir eliminarla.
        if (e.eliminada && lista.some(m => !m.anulado)) e.eliminada = null;
        return e;
    }

    /** Lo que `deudor` le debe a `acreedor` en neto (negativo: al revés). */
    function deudaNeta(estado, deudor, acreedor) {
        const d = estado.deudas || {};
        return ((d[deudor] && d[deudor][acreedor]) || 0) - ((d[acreedor] && d[acreedor][deudor]) || 0);
    }

    /**
     * Los pagos mínimos para que todos queden a mano. Se emparejan el que más
     * debe con el que más le deben, una y otra vez; con n personas salen a lo
     * sumo n - 1 pagos.
     */
    function liquidacionSugerida(saldos, orden) {
        const ids = (orden && orden.length ? orden : Object.keys(saldos || {}));
        const pos = id => ids.indexOf(id);
        const acreedores = ids.filter(id => saldos[id] > 0).map(id => ({ id, v: saldos[id] }))
            .sort((a, b) => (b.v - a.v) || (pos(a.id) - pos(b.id)));
        const deudores = ids.filter(id => saldos[id] < 0).map(id => ({ id, v: -saldos[id] }))
            .sort((a, b) => (b.v - a.v) || (pos(a.id) - pos(b.id)));
        const pagos = [];
        let i = 0, j = 0;
        while (i < deudores.length && j < acreedores.length) {
            const monto = Math.min(deudores[i].v, acreedores[j].v);
            if (monto > 0) pagos.push({ de: deudores[i].id, a: acreedores[j].id, monto });
            deudores[i].v -= monto;
            acreedores[j].v -= monto;
            if (!deudores[i].v) i++;
            if (!acreedores[j].v) j++;
        }
        return pagos;
    }

    function nombreDe(estado, id) {
        const p = (estado.participantes || []).find(x => x.id === id);
        return p ? p.nombre : 'Alguien';
    }

    /** Una línea que dice cómo está la cuenta, para el catálogo. */
    function resumenSaldos(estado) {
        const pagos = liquidacionSugerida(estado.saldos, estado.participantes.map(p => p.id));
        if (!pagos.length) return 'Todos están a mano';
        if (pagos.length === 1) {
            const p = pagos[0];
            return `${nombreDe(estado, p.de)} debe ${formatoMoneda(p.monto, estado.moneda)} a ${nombreDe(estado, p.a)}`;
        }
        return `${pagos.length} pagos pendientes para quedar a mano`;
    }

    function validarParticipantes(nombres) {
        const limpios = (nombres || []).map(n => String(n || '').trim()).filter(Boolean);
        if (limpios.length < MIN_PARTICIPANTES) return `Una cuenta necesita al menos ${MIN_PARTICIPANTES} participantes`;
        if (limpios.length > MAX_PARTICIPANTES) return `Una cuenta admite hasta ${MAX_PARTICIPANTES} participantes`;
        const vistos = new Set();
        for (const n of limpios) {
            const k = normalizar(n);
            if (vistos.has(k)) return `"${n}" está repetido: cada participante necesita un nombre distinto`;
            vistos.add(k);
        }
        return null;
    }

    function validarGasto(estado, mov) {
        const ids = estado.participantes.map(p => p.id);
        if (!String(mov.concepto || '').trim()) return 'Falta el concepto del gasto';
        if (!Number.isInteger(mov.monto) || mov.monto <= 0) return 'El monto debe ser mayor que cero';
        if (!ids.includes(mov.pagadoPor)) return 'Indica quién pagó';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(mov.fechaMov || '')) return 'La fecha no es válida';
        return validarReparto(mov.reparto, ids);
    }

    function validarPago(estado, mov) {
        const ids = estado.participantes.map(p => p.id);
        if (!ids.includes(mov.de) || !ids.includes(mov.a)) return 'Indica quién paga y a quién';
        if (mov.de === mov.a) return 'Quien paga y quien recibe deben ser personas distintas';
        if (!Number.isInteger(mov.monto) || mov.monto <= 0) return 'El monto debe ser mayor que cero';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(mov.fechaMov || '')) return 'La fecha no es válida';
        return null;
    }

    /**
     * Junta las cuentas de dos dispositivos. Como una cuenta es solo su
     * bitácora, basta unir los hechos sin repetir. El resultado sale siempre
     * en el mismo orden para que dos copias con el mismo contenido se vean
     * idénticas (la sincronización compara huellas antes de subir).
     */
    function fusionarCuentas(locales, remotas) {
        const mapa = new Map();
        for (const c of [...(remotas || []), ...(locales || [])]) {
            if (!c || !c.uid) continue;
            if (!mapa.has(c.uid)) mapa.set(c.uid, new Map());
            const eventos = mapa.get(c.uid);
            for (const ev of c.eventos || []) {
                if (ev && ev.id && !eventos.has(ev.id)) eventos.set(ev.id, ev);
            }
        }
        return Array.from(mapa.entries())
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([uid, eventos]) => ({ uid, eventos: ordenarEventos(Array.from(eventos.values())) }));
    }

    // ---- Lo que se le dice al asistente ----

    function limpiarDicho(texto) {
        return normalizar(texto).replace(/[¿?¡!.,;:"'«»“”()]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const RE_VERBO_ABRIR = new RegExp('\\b(' + [
        'abre', 'abrir', 'abreme', 'abrime', 'abran', 'abranme', 'abrelas', 'abres', 'abren',
        'muestra', 'muestrame', 'muestralas', 'muestras', 'mostrar', 'mostrame', 'ensena', 'ensename', 'ensenas',
        'ver', 'veamos', 'consulta', 'consultar', 'revisa', 'revisar', 'dame',
        'llevame a', 'ir a', 've a', 'vamos a', 'entra a', 'entrar a', 'accede a', 'acceder a'
    ].join('|') + ')\\b');

    /** ¿Es "abre las cuentas" (o una forma de decirlo)? */
    function esPeticionAbrir(texto) {
        const t = limpiarDicho(texto);
        if (!/\bcuentas\b/.test(t)) return false;
        // "La rendición de cuentas del expediente 12/2025" es otra cosa.
        if (/\bexpedientes?\b|\d+\s*\/\s*\d+|\bdiagonal\b/.test(t)) return false;
        if (/^(las |mis |nuestras )?cuentas( compartidas| del despacho| de la oficina)?$/.test(t)) return true;
        return RE_VERBO_ABRIR.test(t);
    }

    const ORDINALES = {
        primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4,
        quinta: 5, quinto: 5, sexta: 6, sexto: 6, septima: 7, septimo: 7, octava: 8, octavo: 8,
        novena: 9, noveno: 9, decima: 10, decimo: 10,
        uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10
    };
    const RE_PALABRA_ORDEN = /^(nueva|nuevo|crear|crea|creame|agrega|agregar|alta|otra|archivadas?|activas|vigentes|abiertas)$/;
    const PALABRAS_VACIAS = new Set([
        'la', 'el', 'los', 'las', 'de', 'del', 'que', 'con', 'por', 'para', 'favor', 'una', 'uno', 'esa', 'esta',
        'cuenta', 'cuentas', 'abre', 'abrir', 'abreme', 'quiero', 'ver', 'muestra', 'muestrame', 'numero', 'opcion',
        'dame', 'porfa', 'porfavor', 'pues', 'entre', 'abres', 'mostrar', 'ensename'
    ]);

    /**
     * Qué cuenta eligió el usuario de la lista que se le enseñó. Devuelve
     *   { tipo: 'cuenta', item } | { tipo: 'nueva' } | { tipo: 'archivadas' } |
     *   { tipo: 'activas' } | { tipo: 'cancelar' } | { tipo: 'ambigua', candidatos } | null
     * El nombre manda sobre las palabras clave: una cuenta que se llame
     * "Nueva oficina" se abre, no se crea otra.
     */
    function elegirDeCatalogo(texto, lista) {
        const t = limpiarDicho(texto);
        if (!t) return null;
        lista = lista || [];

        if (/^(no|cancela|cancelar|ninguna|ninguno|olvidalo|mejor no|salir|sal|cierra|cerrar|nada)\b/.test(t)) {
            return { tipo: 'cancelar' };
        }

        // Para parecerse a un nombre no cuentan las palabras de las órdenes:
        // "crea una nueva" no es la cuenta "Nueva sucursal". Decir el nombre
        // completo sí manda.
        const palabras = t.split(' ').filter(w => w.length >= 3 && !PALABRAS_VACIAS.has(w) && !RE_PALABRA_ORDEN.test(w));
        let mejor = 0, candidatos = [];
        for (const item of lista) {
            const n = limpiarDicho(item.nombre);
            if (!n) continue;
            const tokens = n.split(' ');
            let puntos = 0;
            if ((' ' + t + ' ').includes(' ' + n + ' ')) puntos = 100 + n.length;
            else puntos = palabras.filter(w => tokens.some(x => x === w || (w.length >= 4 && x.startsWith(w)))).length;
            if (puntos > mejor) { mejor = puntos; candidatos = [item]; }
            else if (puntos && puntos === mejor) candidatos.push(item);
        }
        if (mejor > 0 && candidatos.length === 1) return { tipo: 'cuenta', item: candidatos[0] };

        if (/\b(nueva|crear|crea|creame|agrega|agregar|alta|otra)\b/.test(t)) return { tipo: 'nueva' };
        if (/\barchivad/.test(t)) return { tipo: 'archivadas' };
        if (/\b(activas|vigentes|abiertas)\b/.test(t)) return { tipo: 'activas' };

        // Un número solo vale si es lo único que se dijo ("la 2", "la
        // segunda", "abre la número tres"): en "agenda una audiencia" el "una"
        // no es la cuenta 1.
        let indice = null;
        const restantes = t.split(' ').filter(w => !PALABRAS_VACIAS.has(w) || ORDINALES[w]);
        if (restantes.length === 1) {
            const w = restantes[0];
            if (/^\d{1,2}$/.test(w)) indice = parseInt(w, 10);
            else if (w === 'ultima' || w === 'ultimo') indice = lista.length;
            else if (ORDINALES[w]) indice = ORDINALES[w];
        }
        if (indice && indice >= 1 && indice <= lista.length) return { tipo: 'cuenta', item: lista[indice - 1] };

        if (candidatos.length > 1) return { tipo: 'ambigua', candidatos };
        return null;
    }

    const Motor = {
        MIN_PARTICIPANTES, MAX_PARTICIPANTES, MONEDAS, CATEGORIAS,
        normalizar, aCentavos, formatoMoneda, formatoSaldo, repartoIgual, sumaReparto, validarReparto,
        repartirMonto, ordenarEventos, derivarCuenta, deudaNeta, liquidacionSugerida, resumenSaldos,
        nombreDe, validarParticipantes, validarGasto, validarPago, fusionarCuentas,
        esPeticionAbrir, elegirDeCatalogo
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
    if (typeof document === 'undefined') return;

    // ==================== ALMACÉN ====================
    // Todas las cuentas viven en una sola entrada del store "config" de
    // IndexedDB. Un store propio obligaría a subir la versión de la base, y
    // con la app abierta en otra pestaña esa subida se queda bloqueada.

    const CLAVE_CONFIG = 'cuentas_compartidas';
    // Quién es quién en ESTE dispositivo. No viaja en la sincronización: en
    // la computadora de Jorge, Jorge es "yo"; en la de Frida, Frida.
    const CLAVE_IDENTIDAD = 'cuentas_identidad';

    function baseDeDatos() {
        return (typeof db !== 'undefined' && db && db.objectStoreNames && db.objectStoreNames.contains('config')) ? db : null;
    }

    function leerCuentas() {
        const base = baseDeDatos();
        if (!base) return Promise.resolve([]);
        return new Promise((resolve, reject) => {
            const req = base.transaction(['config'], 'readonly').objectStore('config').get(CLAVE_CONFIG);
            req.onsuccess = () => resolve(Array.isArray(req.result && req.result.valor) ? req.result.valor : []);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Lee, cambia y guarda en una sola transacción: si dos pestañas escriben a
     * la vez, IndexedDB las pone en fila y ninguna pisa lo de la otra.
     */
    function modificarCuentas(cambio) {
        const base = baseDeDatos();
        if (!base) return Promise.reject(new Error('La base de datos aún no está lista'));
        return new Promise((resolve, reject) => {
            const tx = base.transaction(['config'], 'readwrite');
            const store = tx.objectStore('config');
            let resultado = null;
            const req = store.get(CLAVE_CONFIG);
            req.onsuccess = () => {
                const actuales = Array.isArray(req.result && req.result.valor) ? req.result.valor : [];
                try {
                    resultado = cambio(actuales);
                    store.put({ clave: CLAVE_CONFIG, valor: resultado });
                } catch (e) {
                    reject(e);
                    try { tx.abort(); } catch (x) { /* ya terminó */ }
                }
            };
            tx.oncomplete = () => resolve(resultado);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('No se pudo guardar'));
        });
    }

    /**
     * Lo que llega de la nube se junta con lo de aquí, nunca lo sustituye: si
     * entre la descarga y este momento se registró un gasto en esta pestaña,
     * sigue estando.
     */
    async function aplicarCuentasCompartidas(lista) {
        if (!Array.isArray(lista)) return;
        await modificarCuentas(actuales => fusionarCuentas(actuales, lista));
        refrescar();
    }

    function nuevoId(prefijo) {
        let azar = '';
        try {
            const b = new Uint8Array(6);
            crypto.getRandomValues(b);
            azar = Array.from(b, x => x.toString(36).padStart(2, '0')).join('');
        } catch (e) {
            azar = Math.random().toString(36).slice(2, 14);
        }
        return `${prefijo}_${Date.now().toString(36)}${azar}`;
    }

    function sello() {
        return typeof ahoraSync === 'function' ? ahoraSync() : new Date().toISOString();
    }

    function dispositivo() {
        try { return typeof obtenerDeviceId === 'function' ? obtenerDeviceId() : null; } catch (e) { return null; }
    }

    function avisarCambio() {
        if (typeof marcarYSincronizar === 'function') {
            Promise.resolve(marcarYSincronizar()).catch(() => { /* queda pendiente y se reintenta */ });
        }
    }

    async function registrar(uid, datos) {
        const ev = { id: nuevoId('ev'), fecha: sello(), dispositivo: dispositivo(), ...datos };
        await modificarCuentas(lista => fusionarCuentas(lista, [{ uid, eventos: [ev] }]));
        avisarCambio();
        return ev;
    }

    /** Las cuentas vigentes, la que tuvo movimiento más reciente primero. */
    async function estadosDeCuentas() {
        const crudas = await leerCuentas();
        return crudas.map(derivarCuenta).filter(e => e.creada && !e.eliminada)
            .sort((a, b) => (b.actualizada || '').localeCompare(a.actualizada || ''));
    }

    async function estadoDe(uid) {
        const crudas = await leerCuentas();
        const c = crudas.find(x => x.uid === uid);
        if (!c) return null;
        const e = derivarCuenta(c);
        return e.creada && !e.eliminada ? e : null;
    }

    // ---- Identidad en este dispositivo ----

    function leerIdentidades() {
        try { return JSON.parse(localStorage.getItem(CLAVE_IDENTIDAD)) || {}; } catch (e) { return {}; }
    }

    function guardarIdentidad(uid, participante) {
        const todas = leerIdentidades();
        if (participante) todas[uid] = { pid: participante.id, pinHash: participante.pinHash || null };
        else delete todas[uid];
        try { localStorage.setItem(CLAVE_IDENTIDAD, JSON.stringify(todas)); } catch (e) { /* modo privado */ }
    }

    function identidadEn(estado) {
        const reg = leerIdentidades()[estado.uid];
        if (!reg) return null;
        const p = estado.participantes.find(x => x.id === reg.pid);
        if (!p) return null;
        // Si después de elegirse le pusieron PIN, o lo cambiaron, hay que
        // volver a comprobarlo antes de actuar en su nombre.
        if ((p.pinHash || null) !== (reg.pinHash || null)) return null;
        return p;
    }

    async function hashPin(uid, pid, pin) {
        const datos = new TextEncoder().encode(`tsj-cuentas|${uid}|${pid}|${pin}`);
        const buf = await crypto.subtle.digest('SHA-256', datos);
        return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    }

    // ==================== INTERFAZ ====================

    const ui = {
        vista: 'catalogo',     // catalogo | cuenta | nueva | gasto | pago | ajustes
        uid: null,
        verArchivadas: false,
        borrador: null,        // lo que precarga el formulario de gasto o pago
        filtro: { texto: '', categoria: '', persona: '', desde: '', hasta: '', anulados: true },
        estado: null,          // la cuenta tal como se pintó, para las vistas previas al escribir
        resolverDialogo: null,
        pendienteRefresco: false
    };

    function $(id) { return document.getElementById(id); }

    function esc(t) {
        return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function toast(msg, tipo) {
        if (typeof mostrarToast === 'function') mostrarToast(msg, tipo || 'info');
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    function hoyISO() {
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function fechaCorta(ymd) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
        if (!m) return ymd || '';
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function fechaHora(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function dinero(c, estado) { return formatoMoneda(c, estado && estado.moneda); }

    /** Cierra la frase con punto, salvo que ya termine en uno ("p.m."). */
    function conPunto(t) { return /[.!?…]$/.test(t) ? t : t + '.'; }

    function textoPorcentaje(n) {
        return (Math.round(n * 100) / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 }) + '%';
    }

    function textoReparto(estado, reparto) {
        return estado.participantes
            .filter(p => (reparto || {})[p.id] > 0)
            .map(p => `${p.nombre} ${textoPorcentaje(reparto[p.id])}`).join(' · ');
    }

    function hayLicencia() {
        return typeof estadoPremium !== 'undefined' && !!(estadoPremium && estadoPremium.activo && estadoPremium.codigo);
    }

    function lineaSincronizacion() {
        if (!hayLicencia()) {
            return '📱 Sin licencia Premium activa: estas cuentas se guardan solo en este dispositivo.';
        }
        let ultima = '';
        try {
            if (typeof syncState !== 'undefined' && syncState.lastSync) ultima = ' · última sincronización ' + fechaHora(new Date(syncState.lastSync).toISOString());
        } catch (e) { /* sin estado de sincronización */ }
        return '🔄 Compartidas con todos los usuarios de tu licencia' + ultima + '.';
    }

    // ---- Esqueleto ----

    function asegurarOverlay() {
        let ov = $('cta-overlay');
        if (ov) return ov;
        ov = document.createElement('div');
        ov.id = 'cta-overlay';
        ov.className = 'cta-overlay';
        ov.hidden = true;
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-labelledby', 'cta-titulo');
        ov.innerHTML =
            '<div class="cta-ventana">' +
                '<header class="cta-cabecera">' +
                    '<button type="button" class="cta-volver" data-acc="volver" aria-label="Volver" hidden>←</button>' +
                    '<div class="cta-titulos">' +
                        '<h2 id="cta-titulo">Cuentas compartidas</h2>' +
                        '<div id="cta-subtitulo" class="cta-subtitulo"></div>' +
                    '</div>' +
                    '<button type="button" class="btn-close cta-cerrar" data-acc="cerrar" aria-label="Cerrar">✕</button>' +
                '</header>' +
                '<div id="cta-cuerpo" class="cta-cuerpo"></div>' +
            '</div>' +
            '<div id="cta-dialogo" class="cta-dialogo" hidden></div>';
        document.body.appendChild(ov);

        ov.addEventListener('click', alHacerClic);
        ov.addEventListener('submit', alEnviar);
        ov.addEventListener('input', alEscribir);
        ov.addEventListener('change', alEscribir);
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || ov.hidden) return;
            if (!$('cta-dialogo').hidden) { cerrarDialogo(null); return; }
            cerrar();
        });
        return ov;
    }

    function abierto() {
        const ov = $('cta-overlay');
        return !!ov && !ov.hidden;
    }

    // La app no sincroniza sola cada cierto tiempo: lo hace al abrir, al
    // guardar y al volver a la pestaña. Con las cuentas abiertas se pregunta a
    // la nube de vez en cuando, para que lo que registre un colega aparezca
    // sin tener que cerrar y abrir.
    const INTERVALO_SYNC_MS = 2 * 60 * 1000;
    let temporizadorSync = null;

    function sincronizarSiSePuede() {
        if (!abierto() || document.visibilityState !== 'visible' || !hayLicencia()) return;
        if (typeof sincronizarDatos !== 'function') return;
        if (typeof syncState !== 'undefined' && syncState.syncInProgress) return;
        Promise.resolve(sincronizarDatos()).catch(() => { /* se avisa desde la sincronización */ });
    }

    async function mostrar(vista, uid) {
        asegurarOverlay().hidden = false;
        document.body.classList.add('cta-abierto');
        if (!temporizadorSync) temporizadorSync = setInterval(sincronizarSiSePuede, INTERVALO_SYNC_MS);
        ui.vista = vista;
        if (uid !== undefined) ui.uid = uid;
        await pintar();
        const cuerpo = $('cta-cuerpo');
        if (cuerpo) cuerpo.scrollTop = 0;
        const foco = document.querySelector('#cta-cuerpo [autofocus]') || $('cta-titulo');
        if (foco) { if (foco === $('cta-titulo')) foco.setAttribute('tabindex', '-1'); foco.focus({ preventScroll: true }); }
    }

    async function abrir(uid) {
        const e = uid ? await estadoDe(uid) : null;
        if (!e) return mostrar('catalogo', null);
        ui.verArchivadas = e.archivada;
        ui.filtro = { texto: '', categoria: '', persona: '', desde: '', hasta: '', anulados: true };
        await mostrar('cuenta', uid);
        // Lo que hayan registrado los colegas desde la última vez.
        sincronizarSiSePuede();
    }

    function abrirNueva() { return mostrar('nueva', null); }
    function abrirCatalogo(archivadas) { ui.verArchivadas = !!archivadas; return mostrar('catalogo', null); }

    function cerrar() {
        const ov = $('cta-overlay');
        if (!ov) return;
        cerrarDialogo(null);
        ov.hidden = true;
        document.body.classList.remove('cta-abierto');
        clearInterval(temporizadorSync);
        temporizadorSync = null;
        $('cta-cuerpo').innerHTML = '';
        ui.borrador = null;
    }

    /** Lo llama la sincronización cuando trae cambios de otro dispositivo. */
    function refrescar() {
        if (!abierto()) return;
        // Un formulario a medio llenar no se repinta: se perdería lo escrito.
        if (!['catalogo', 'cuenta'].includes(ui.vista) || !$('cta-dialogo').hidden) {
            ui.pendienteRefresco = true;
            return;
        }
        // Si se estaba escribiendo en un filtro, se le devuelve el foco.
        const activo = document.activeElement;
        const filtro = activo && activo.dataset ? activo.dataset.filtro : null;
        pintar().then(() => {
            const campo = filtro && document.querySelector('#cta-cuerpo [data-filtro="' + filtro + '"]');
            if (campo) campo.focus({ preventScroll: true });
        }).catch(e => console.warn('[CUENTAS] No se pudo repintar:', e));
    }

    async function pintar() {
        ui.pendienteRefresco = false;
        const cuerpo = $('cta-cuerpo');
        const volver = document.querySelector('#cta-overlay .cta-volver');
        const titulo = $('cta-titulo');
        const sub = $('cta-subtitulo');
        if (!cuerpo) return;

        if (ui.vista === 'catalogo') {
            const estados = await estadosDeCuentas();
            titulo.textContent = '🔐 Cuentas compartidas';
            sub.textContent = lineaSincronizacion();
            volver.hidden = true;
            cuerpo.innerHTML = vistaCatalogo(estados);
            return;
        }
        if (ui.vista === 'nueva') {
            titulo.textContent = 'Nueva cuenta compartida';
            sub.textContent = `De ${MIN_PARTICIPANTES} a ${MAX_PARTICIPANTES} participantes, con el reparto que acuerden.`;
            volver.hidden = false;
            cuerpo.innerHTML = vistaNueva();
            actualizarFormNueva();
            return;
        }

        const estado = ui.uid ? await estadoDe(ui.uid) : null;
        ui.estado = estado;
        if (!estado) { ui.vista = 'catalogo'; return pintar(); }
        titulo.textContent = estado.nombre + (estado.archivada ? ' · archivada' : '');
        sub.textContent = estado.participantes.map(p => p.nombre).join(' · ') + ' — ' + lineaSincronizacion();
        volver.hidden = false;

        if (ui.vista === 'gasto') { cuerpo.innerHTML = vistaGasto(estado); actualizarFormGasto(estado); return; }
        if (ui.vista === 'pago') { cuerpo.innerHTML = vistaPago(estado); actualizarFormPago(estado); return; }
        if (ui.vista === 'ajustes') { cuerpo.innerHTML = vistaAjustes(estado); actualizarFormReparto(estado); return; }
        cuerpo.innerHTML = vistaCuenta(estado);
        pintarHistorial(estado);
    }

    // ---- Catálogo ----

    function vistaCatalogo(estados) {
        const activas = estados.filter(e => !e.archivada);
        const archivadas = estados.filter(e => e.archivada);
        const lista = ui.verArchivadas ? archivadas : activas;

        const tarjetas = lista.map(e => {
            const yo = identidadEn(e);
            let etiqueta = '';
            if (e.solicitud) {
                const falta = yo && !e.solicitud.confirmaciones[yo.id];
                etiqueta = `<span class="cta-etiqueta cta-etiqueta-aviso">${falta ? '⏳ Te piden confirmar el archivo' : '⏳ Archivo por confirmar'}</span>`;
            }
            if (e.archivada && e.archivo) etiqueta = `<span class="cta-etiqueta">🗄️ Archivada el ${esc(fechaCorta(e.archivo.fecha.slice(0, 10)))}</span>`;
            return '<button type="button" class="cta-tarjeta" data-acc="abrir" data-uid="' + esc(e.uid) + '">' +
                '<span class="cta-tarjeta-nombre">' + esc(e.nombre) + '</span>' +
                '<span class="cta-tarjeta-personas">' + esc(e.participantes.map(p => p.nombre).join(' · ')) + '</span>' +
                '<span class="cta-tarjeta-resumen">' + esc(resumenSaldos(e)) + '</span>' +
                etiqueta +
            '</button>';
        }).join('');

        const vacio = ui.verArchivadas
            ? '<p class="cta-vacio">No hay cuentas archivadas.</p>'
            : '<div class="cta-vacio"><p>Todavía no hay cuentas compartidas.</p>' +
              '<p>Crea una para llevar los gastos que se reparten en el despacho: quién pagó, cuánto le toca a cada quien y cuánto se deben.</p></div>';

        return '<div class="cta-barra">' +
                '<div class="cta-pestanas" role="tablist">' +
                    `<button type="button" role="tab" class="cta-pestana${ui.verArchivadas ? '' : ' activa'}" data-acc="ver-activas" aria-selected="${!ui.verArchivadas}">Activas (${activas.length})</button>` +
                    `<button type="button" role="tab" class="cta-pestana${ui.verArchivadas ? ' activa' : ''}" data-acc="ver-archivadas" aria-selected="${ui.verArchivadas}">Archivadas (${archivadas.length})</button>` +
                '</div>' +
                '<button type="button" class="btn btn-primary" data-acc="nueva">➕ Nueva cuenta</button>' +
            '</div>' +
            (lista.length ? '<div class="cta-lista">' + tarjetas + '</div>' : vacio);
    }

    // ---- Una cuenta ----

    function vistaCuenta(estado) {
        const yo = identidadEn(estado);
        const orden = estado.participantes.map(p => p.id);
        const pagos = liquidacionSugerida(estado.saldos, orden);
        const editable = !estado.archivada;
        let html = '';

        // Quién soy aquí
        if (yo) {
            html += '<div class="cta-yo">Estás como <strong>' + esc(yo.nombre) + '</strong>' +
                (yo.pinHash ? ' <span class="cta-candado" title="Con PIN">🔒</span>' : '') +
                ' <button type="button" class="btn btn-sm btn-secondary" data-acc="cambiar-yo">Cambiar</button></div>';
        } else {
            html += '<div class="cta-yo cta-yo-falta"><span>¿Quién eres en esta cuenta? Así queda registrado quién hace cada movimiento.</span>' +
                '<div class="cta-chips">' + estado.participantes.map(p =>
                    '<button type="button" class="cta-chip" data-acc="soy" data-pid="' + esc(p.id) + '">' + esc(p.nombre) + (p.pinHash ? ' 🔒' : '') + '</button>').join('') +
                '</div></div>';
        }

        html += bannerArchivo(estado, yo);

        // Saldos
        html += '<section class="cta-saldos" aria-label="Saldos">' + estado.participantes.map(p => {
            const s = estado.saldos[p.id] || 0;
            const t = estado.totales[p.id] || { pagado: 0, parte: 0, dio: 0, recibio: 0 };
            const clase = s > 0 ? 'positivo' : s < 0 ? 'negativo' : 'cero';
            const leyenda = s > 0 ? 'A su favor' : s < 0 ? 'Debe' : 'A mano';
            const abonos = (t.dio || t.recibio)
                ? '<small>Pagos: dio ' + esc(dinero(t.dio, estado)) + ' · recibió ' + esc(dinero(t.recibio, estado)) + '</small>' : '';
            return '<div class="cta-saldo ' + clase + (yo && yo.id === p.id ? ' cta-saldo-yo' : '') + '">' +
                '<span class="cta-saldo-nombre">' + esc(p.nombre) + (yo && yo.id === p.id ? ' (tú)' : '') + '</span>' +
                '<span class="cta-saldo-leyenda">' + leyenda + '</span>' +
                '<span class="cta-saldo-monto">' + esc(dinero(Math.abs(s), estado)) + '</span>' +
                '<small>Pagó ' + esc(dinero(t.pagado, estado)) + ' · le tocó ' + esc(dinero(t.parte, estado)) + '</small>' +
                abonos +
            '</div>';
        }).join('') + '</section>';

        // Cómo quedar a mano
        html += '<section class="cta-bloque"><h3>Para quedar a mano</h3>';
        if (!pagos.length) {
            html += '<p class="cta-ok">✓ Todos están a mano.</p>';
        } else {
            html += '<ul class="cta-pagos">' + pagos.map(p =>
                '<li><span><strong>' + esc(nombreDe(estado, p.de)) + '</strong> paga <strong>' + esc(dinero(p.monto, estado)) +
                '</strong> a <strong>' + esc(nombreDe(estado, p.a)) + '</strong></span>' +
                (editable ? '<button type="button" class="btn btn-sm btn-secondary" data-acc="liquidar" data-de="' + esc(p.de) +
                    '" data-a="' + esc(p.a) + '" data-monto="' + p.monto + '">Registrar este pago</button>' : '') +
                '</li>').join('') + '</ul>';
            if (estado.participantes.length > 2) {
                html += '<p class="cta-nota">Son los pagos mínimos para que todos queden a mano, aunque no siempre coincidan con quién le pagó a quién.</p>';
            }
        }
        html += '</section>';

        // La relación de "yo" con cada uno, cuando son más de dos
        if (yo && estado.participantes.length > 2) {
            const filas = estado.participantes.filter(p => p.id !== yo.id).map(p => {
                const n = deudaNeta(estado, p.id, yo.id); // > 0: el otro me debe
                const txt = n > 0 ? `te debe ${dinero(n, estado)}` : n < 0 ? `le debes ${dinero(-n, estado)}` : 'están a mano';
                return '<li><strong>' + esc(p.nombre) + '</strong>: ' + esc(txt) + '</li>';
            }).join('');
            html += '<section class="cta-bloque"><h3>Tu relación con cada quien</h3><ul class="cta-relacion">' + filas + '</ul>' +
                '<p class="cta-nota">Cuenta solo los gastos y pagos entre tú y esa persona.</p></section>';
        }

        // Acciones
        html += '<div class="cta-acciones">' +
            (editable ? '<button type="button" class="btn btn-primary" data-acc="nuevo-gasto">➕ Registrar gasto</button>' +
                        '<button type="button" class="btn btn-secondary" data-acc="nuevo-pago">💸 Registrar pago o abono</button>' : '') +
            '<button type="button" class="btn btn-secondary" data-acc="copiar">📋 Copiar resumen</button>' +
            '<button type="button" class="btn btn-secondary" data-acc="csv">⬇️ Exportar CSV</button>' +
            '<button type="button" class="btn btn-secondary" data-acc="ajustes">⚙️ Ajustes</button>' +
            (editable && !estado.solicitud ? '<button type="button" class="btn btn-secondary" data-acc="solicitar-archivo">🗄️ Solicitar archivo</button>' : '') +
        '</div>';

        // Gasto por categoría
        const cats = Object.entries(estado.porCategoria).sort((a, b) => b[1] - a[1]);
        if (cats.length) {
            html += '<details class="cta-bloque cta-desplegable"><summary>Gasto por categoría · total ' + esc(dinero(estado.totalGastos, estado)) + '</summary>' +
                '<ul class="cta-categorias">' + cats.map(([c, v]) =>
                    '<li><span>' + esc(c) + '</span><span>' + esc(dinero(v, estado)) + '</span></li>').join('') + '</ul></details>';
        }

        // Histórico
        const categorias = Array.from(new Set(estado.movimientos.filter(m => m.tipo === 'gasto')
            .map(m => String(m.categoria || '').trim()).filter(Boolean))).sort();
        const f = ui.filtro;
        html += '<section class="cta-bloque"><h3>Histórico de movimientos</h3>' +
            '<div class="cta-filtros">' +
                '<input type="search" data-filtro="texto" placeholder="Buscar concepto o nota" value="' + esc(f.texto) + '" aria-label="Buscar">' +
                '<select data-filtro="categoria" aria-label="Categoría"><option value="">Todas las categorías</option>' +
                    categorias.map(c => '<option' + (f.categoria === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
                '<select data-filtro="persona" aria-label="Persona"><option value="">Todas las personas</option>' +
                    estado.participantes.map(p => '<option value="' + esc(p.id) + '"' + (f.persona === p.id ? ' selected' : '') + '>' + esc(p.nombre) + '</option>').join('') + '</select>' +
                '<label class="cta-filtro-fecha">Desde <input type="date" data-filtro="desde" value="' + esc(f.desde) + '"></label>' +
                '<label class="cta-filtro-fecha">Hasta <input type="date" data-filtro="hasta" value="' + esc(f.hasta) + '"></label>' +
                '<label class="cta-check"><input type="checkbox" data-filtro="anulados"' + (f.anulados ? ' checked' : '') + '> Mostrar anulados</label>' +
            '</div>' +
            '<div id="cta-historial"></div></section>';

        // Bitácora
        html += '<details class="cta-bloque cta-desplegable"><summary>Bitácora completa (' + estado.bitacora.length + ' registros)</summary>' +
            '<ol class="cta-bitacora">' + estado.bitacora.slice().reverse().map(ev =>
                '<li><span class="cta-bitacora-fecha">' + esc(fechaHora(ev.fecha)) + '</span> ' +
                '<strong>' + esc(ev.por ? nombreDe(estado, ev.por) : 'Sin identificar') + '</strong> ' +
                esc(describirEvento(estado, ev)) + '</li>').join('') + '</ol></details>';

        return html;
    }

    function bannerArchivo(estado, yo) {
        if (estado.archivada) {
            const a = estado.archivo;
            const quienes = a && a.solicitud ? Object.keys(a.solicitud.confirmaciones).map(id => nombreDe(estado, id)).join(', ') : '';
            return '<div class="cta-banner cta-banner-archivo">' +
                '<div><strong>🗄️ Cuenta archivada</strong> ' +
                esc(conPunto('el ' + (a ? fechaHora(a.fecha) : '') + (quienes ? ', con la conformidad de ' + quienes : ''))) +
                (a && a.solicitud && a.solicitud.motivo ? '<br><small>Motivo: ' + esc(a.solicitud.motivo) + '</small>' : '') +
                '<br><small>Queda de solo lectura: el histórico y los saldos se conservan tal cual.</small></div>' +
                '<button type="button" class="btn btn-sm btn-secondary" data-acc="reactivar">Reactivar</button></div>';
        }
        if (estado.solicitud) {
            const s = estado.solicitud;
            const estadoPersonas = estado.participantes.map(p =>
                '<li>' + (s.confirmaciones[p.id] ? '✅' : '⏳') + ' ' + esc(p.nombre) + '</li>').join('');
            let botones = '';
            if (yo && !s.confirmaciones[yo.id]) {
                botones = '<button type="button" class="btn btn-sm btn-primary" data-acc="confirmar-archivo">✅ Estoy de acuerdo</button>' +
                    '<button type="button" class="btn btn-sm btn-danger" data-acc="rechazar-archivo">No archivar</button>';
            } else if (yo) {
                botones = '<span class="cta-nota">Ya diste tu conformidad. Falta la de los demás.</span>' +
                    '<button type="button" class="btn btn-sm btn-secondary" data-acc="rechazar-archivo">Retirar solicitud</button>';
            } else {
                botones = '<span class="cta-nota">Elige quién eres para dar tu conformidad.</span>';
            }
            return '<div class="cta-banner cta-banner-aviso">' +
                '<div><strong>⏳ ' + esc(nombreDe(estado, s.por)) + ' pidió archivar esta cuenta</strong> ' + esc(conPunto('el ' + fechaHora(s.fecha))) +
                (s.motivo ? '<br><small>Motivo: ' + esc(s.motivo) + '</small>' : '') +
                '<br><small>Se archiva cuando todos estén de acuerdo.</small>' +
                '<ul class="cta-conformidades">' + estadoPersonas + '</ul></div>' +
                '<div class="cta-banner-btns">' + botones + '</div></div>';
        }
        if (estado.ultimoRechazo && (!estado.reactivada || estado.ultimoRechazo.fecha > estado.reactivada.fecha)) {
            const r = estado.ultimoRechazo;
            const retiro = r.por && r.por === r.solicitud.por;
            return '<div class="cta-banner"><small>' + esc(conPunto(nombreDe(estado, r.por) +
                (retiro ? ' retiró su solicitud de archivo' : ' no estuvo de acuerdo en archivar') +
                ' el ' + fechaHora(r.fecha) + (r.motivo ? ': ' + r.motivo : ''))) + '</small></div>';
        }
        return '';
    }

    function movimientosFiltrados(estado) {
        const f = ui.filtro;
        const texto = normalizar(f.texto);
        return estado.movimientos.filter(m => {
            if (!f.anulados && m.anulado) return false;
            if (f.categoria && String(m.categoria || '').trim() !== f.categoria) return false;
            if (f.persona) {
                const involucra = m.tipo === 'gasto'
                    ? (m.pagadoPor === f.persona || (m.cuotas[f.persona] || 0) > 0)
                    : (m.de === f.persona || m.a === f.persona);
                if (!involucra) return false;
            }
            if (f.desde && (m.fechaMov || '') < f.desde) return false;
            if (f.hasta && (m.fechaMov || '') > f.hasta) return false;
            if (texto && !normalizar([m.concepto, m.nota, m.categoria].join(' ')).includes(texto)) return false;
            return true;
        });
    }

    function pintarHistorial(estado) {
        const cont = $('cta-historial');
        if (!cont) return;
        const yo = identidadEn(estado);
        const lista = movimientosFiltrados(estado).slice().reverse(); // lo más reciente arriba
        if (!estado.movimientos.length) {
            cont.innerHTML = '<p class="cta-vacio">Aún no hay movimientos. Registra el primer gasto compartido.</p>';
            return;
        }
        if (!lista.length) {
            cont.innerHTML = '<p class="cta-vacio">Ningún movimiento coincide con los filtros.</p>';
            return;
        }
        const editable = !estado.archivada;
        const pocos = estado.participantes.length <= 3;
        cont.innerHTML = '<div class="cta-movs">' + lista.map(m => {
            let titulo, detalle;
            if (m.tipo === 'gasto') {
                titulo = esc(m.concepto || 'Gasto') + (m.categoria ? ' <span class="cta-cat">' + esc(m.categoria) + '</span>' : '');
                detalle = 'Pagó <strong>' + esc(nombreDe(estado, m.pagadoPor)) + '</strong> · ' +
                    estado.participantes.filter(p => m.cuotas[p.id] > 0).map(p =>
                        esc(p.nombre) + ' ' + esc(textoPorcentaje((m.reparto || {})[p.id] || 0)) + ' (' + esc(dinero(m.cuotas[p.id], estado)) + ')').join(' · ');
            } else {
                titulo = '💸 ' + esc(m.concepto || 'Pago');
                detalle = '<strong>' + esc(nombreDe(estado, m.de)) + '</strong> pagó a <strong>' + esc(nombreDe(estado, m.a)) + '</strong>';
            }
            let efecto = '';
            if (!m.anulado) {
                if (yo) {
                    efecto = 'Tu saldo después: <strong>' + esc(formatoSaldo(m.saldoTras[yo.id] || 0, estado.moneda)) + '</strong>';
                } else if (pocos) {
                    efecto = 'Saldos después: ' + estado.participantes.map(p =>
                        esc(p.nombre) + ' ' + esc(formatoSaldo(m.saldoTras[p.id] || 0, estado.moneda))).join(' · ');
                }
            }
            const anulado = m.anulado
                ? '<div class="cta-mov-anulado">Anulado por ' + esc(nombreDe(estado, m.anulado.por)) + ' el ' + esc(fechaHora(m.anulado.fecha)) +
                  (m.anulado.motivo ? ': ' + esc(m.anulado.motivo) : '') + '</div>' : '';
            const botones = editable && !m.anulado
                ? '<div class="cta-mov-btns">' +
                    (m.tipo === 'gasto' ? '<button type="button" class="btn btn-sm btn-secondary" data-acc="repetir" data-mov="' + esc(m.id) + '" title="Registrar otro igual con fecha de hoy">Repetir</button>' : '') +
                    '<button type="button" class="btn btn-sm btn-secondary" data-acc="corregir" data-mov="' + esc(m.id) + '" title="Anula este y abre uno nuevo con sus datos">Corregir</button>' +
                    '<button type="button" class="btn btn-sm btn-danger" data-acc="anular" data-mov="' + esc(m.id) + '">Anular</button>' +
                  '</div>' : '';
            return '<article class="cta-mov' + (m.anulado ? ' cta-anulado' : '') + (m.tipo === 'pago' ? ' cta-mov-pago' : '') + '">' +
                '<div class="cta-mov-fecha">' + esc(fechaCorta(m.fechaMov)) + '</div>' +
                '<div class="cta-mov-cuerpo">' +
                    '<div class="cta-mov-titulo">' + titulo + '</div>' +
                    '<div class="cta-mov-detalle">' + detalle + '</div>' +
                    (m.nota ? '<div class="cta-mov-nota">📝 ' + esc(m.nota) + '</div>' : '') +
                    anulado +
                    '<div class="cta-mov-pie">Registró ' + esc(m.registradoPor ? nombreDe(estado, m.registradoPor) : 'sin identificar') +
                        ' el ' + esc(fechaHora(m.registradoEn)) + (efecto ? ' · ' + efecto : '') + '</div>' +
                '</div>' +
                '<div class="cta-mov-monto">' + esc(dinero(m.monto, estado)) + '</div>' +
                botones +
            '</article>';
        }).join('') + '</div>';
    }

    function describirEvento(estado, ev) {
        const mov = estado.movimientos.find(m => m.id === ev.movId);
        switch (ev.tipo) {
            case 'crear': return `creó la cuenta con ${(ev.participantes || []).map(p => p.nombre).join(', ')}` +
                (ev.reparto ? ` (reparto habitual: ${textoReparto(estado, ev.reparto)})` : '');
            case 'editar': {
                const c = ev.cambios || {};
                const partes = [];
                if (c.nombre) partes.push(`el nombre a «${c.nombre}»`);
                if (typeof c.descripcion === 'string') partes.push('la descripción');
                if (c.reparto) partes.push(`el reparto habitual a ${textoReparto(estado, c.reparto)}`);
                return 'cambió ' + (partes.join(', ') || 'los datos de la cuenta');
            }
            case 'participante': return `agregó a ${ev.participante && ev.participante.nombre}`;
            case 'renombrar_participante': return `cambió el nombre de un participante a «${ev.nombre}»`;
            case 'pin': return ev.pinHash ? 'puso o cambió su PIN' : 'quitó su PIN';
            case 'gasto': return `registró el gasto «${ev.mov && ev.mov.concepto}» por ${dinero(ev.mov && ev.mov.monto, estado)}, pagado por ${nombreDe(estado, ev.mov && ev.mov.pagadoPor)}`;
            case 'pago': return `registró que ${nombreDe(estado, ev.mov && ev.mov.de)} pagó ${dinero(ev.mov && ev.mov.monto, estado)} a ${nombreDe(estado, ev.mov && ev.mov.a)}`;
            case 'anular': return `anuló «${mov ? (mov.concepto || (mov.tipo === 'pago' ? 'pago' : 'gasto')) : 'un movimiento'}»` + (ev.motivo ? `: ${ev.motivo}` : '');
            case 'solicitar_archivo': return 'pidió archivar la cuenta' + (ev.motivo ? `: ${ev.motivo}` : '');
            case 'confirmar_archivo': return 'estuvo de acuerdo en archivar';
            case 'rechazar_archivo': return 'rechazó o retiró la solicitud de archivo' + (ev.motivo ? `: ${ev.motivo}` : '');
            case 'reactivar': return 'reactivó la cuenta' + (ev.motivo ? `: ${ev.motivo}` : '');
            case 'eliminar': return 'pidió eliminar la cuenta';
            default: return `hizo un cambio (${ev.tipo})`;
        }
    }

    // ---- Formularios ----

    function opcionesParticipantes(estado, elegido) {
        return estado.participantes.map(p =>
            '<option value="' + esc(p.id) + '"' + (p.id === elegido ? ' selected' : '') + '>' + esc(p.nombre) + '</option>').join('');
    }

    function filasReparto(estado, reparto, conCasilla) {
        return estado.participantes.map(p => {
            const pct = (reparto || {})[p.id] || 0;
            const incluido = !conCasilla || pct > 0;
            return '<div class="cta-reparto-fila" data-pid="' + esc(p.id) + '">' +
                (conCasilla
                    ? '<label class="cta-check"><input type="checkbox" name="incl" value="' + esc(p.id) + '"' + (incluido ? ' checked' : '') + '> ' + esc(p.nombre) + '</label>'
                    : '<span class="cta-reparto-nombre">' + esc(p.nombre) + '</span>') +
                '<span class="cta-pct"><input type="text" inputmode="decimal" name="pct-' + esc(p.id) + '" value="' + (incluido ? esc(String(pct)) : '0') + '"' +
                    (incluido ? '' : ' disabled') + ' aria-label="Porcentaje de ' + esc(p.nombre) + '"> %</span>' +
                '<span class="cta-cuota" data-cuota="' + esc(p.id) + '"></span>' +
            '</div>';
        }).join('');
    }

    function vistaGasto(estado) {
        const b = ui.borrador || {};
        const yo = identidadEn(estado);
        const reparto = b.reparto || estado.reparto;
        const titulo = b.corrigeA ? 'Corregir gasto' : 'Registrar gasto';
        return '<form class="cta-form" data-form="gasto" novalidate>' +
            '<h3>' + titulo + '</h3>' +
            (b.corrigeA ? '<p class="cta-nota">Al guardar, el gasto original queda anulado y este lo sustituye. Los dos quedan en el histórico.</p>' : '') +
            '<div class="cta-fila">' +
                '<label class="cta-campo cta-campo-ancho">Concepto<input name="concepto" maxlength="140" required autofocus value="' + esc(b.concepto || '') + '" placeholder="Renta de octubre, papelería…"></label>' +
                '<label class="cta-campo">Monto<input name="monto" inputmode="decimal" required value="' + esc(b.monto ? (b.monto / 100).toFixed(2) : '') + '" placeholder="0.00"></label>' +
            '</div>' +
            '<div class="cta-fila">' +
                '<label class="cta-campo">Fecha del gasto<input type="date" name="fechaMov" required value="' + esc(b.fechaMov || hoyISO()) + '"></label>' +
                '<label class="cta-campo">¿Quién pagó?<select name="pagadoPor">' + opcionesParticipantes(estado, b.pagadoPor || (yo && yo.id)) + '</select></label>' +
                '<label class="cta-campo">Categoría<input name="categoria" list="cta-lista-categorias" maxlength="60" value="' + esc(b.categoria || '') + '" placeholder="Elige o escribe"></label>' +
            '</div>' +
            '<datalist id="cta-lista-categorias">' + CATEGORIAS.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
            '<fieldset class="cta-reparto"><legend>¿Cómo se reparte?</legend>' +
                '<div class="cta-chips">' +
                    '<button type="button" class="cta-chip" data-acc="reparto-cuenta">Reparto habitual (' + esc(textoReparto(estado, estado.reparto)) + ')</button>' +
                    '<button type="button" class="cta-chip" data-acc="reparto-igual">Partes iguales entre los marcados</button>' +
                '</div>' +
                filasReparto(estado, reparto, true) +
                '<div class="cta-reparto-suma" id="cta-suma"></div>' +
            '</fieldset>' +
            '<label class="cta-campo">Nota (opcional)<textarea name="nota" rows="2" maxlength="500" placeholder="Número de factura, para qué fue…">' + esc(b.nota || '') + '</textarea></label>' +
            '<div class="cta-error" id="cta-error" role="alert" hidden></div>' +
            '<div class="cta-form-btns">' +
                '<button type="button" class="btn btn-secondary" data-acc="volver">Cancelar</button>' +
                '<button type="submit" class="btn btn-primary">' + (b.corrigeA ? 'Guardar corrección' : 'Guardar gasto') + '</button>' +
            '</div></form>';
    }

    function leerRepartoDelForm(form, conCasilla) {
        const reparto = {};
        form.querySelectorAll('.cta-reparto-fila').forEach(fila => {
            const pid = fila.dataset.pid;
            const casilla = fila.querySelector('input[name="incl"]');
            const campo = fila.querySelector('input[name="pct-' + pid + '"]');
            if (conCasilla && casilla && !casilla.checked) return;
            const v = parseFloat(String(campo.value).replace(',', '.'));
            if (Number.isFinite(v) && v > 0) reparto[pid] = Math.round(v * 100) / 100;
            else if (!Number.isFinite(v) && String(campo.value).trim()) reparto[pid] = NaN;
        });
        return reparto;
    }

    function pintarSumaReparto(form, estado, reparto, monto) {
        const suma = sumaReparto(reparto);
        const ok = Math.abs(suma - 100) <= TOLERANCIA_PORCENTAJE;
        const el = form.querySelector('#cta-suma');
        if (el) {
            el.textContent = `Suma: ${textoPorcentaje(Number.isFinite(suma) ? suma : 0)}` + (ok ? ' ✓' : ' — debe ser 100%');
            el.classList.toggle('cta-mal', !ok);
        }
        const valido = !validarReparto(reparto, estado.participantes.map(p => p.id));
        const cuotas = valido && monto > 0 ? repartirMonto(monto, reparto, estado.participantes.map(p => p.id)) : {};
        form.querySelectorAll('[data-cuota]').forEach(s => {
            const c = cuotas[s.dataset.cuota];
            s.textContent = c ? dinero(c, estado) : '';
        });
    }

    function actualizarFormGasto(estado) {
        const form = document.querySelector('#cta-cuerpo form[data-form="gasto"]');
        if (!form) return;
        form.querySelectorAll('.cta-reparto-fila').forEach(fila => {
            const casilla = fila.querySelector('input[name="incl"]');
            const campo = fila.querySelector('input[type="text"]');
            if (casilla && campo) campo.disabled = !casilla.checked;
        });
        pintarSumaReparto(form, estado, leerRepartoDelForm(form, true), aCentavos(form.monto.value));
    }

    function ponerReparto(form, reparto, estado, conCasilla) {
        form.querySelectorAll('.cta-reparto-fila').forEach(fila => {
            const pid = fila.dataset.pid;
            const pct = reparto[pid] || 0;
            const casilla = fila.querySelector('input[name="incl"]');
            if (conCasilla && casilla) casilla.checked = pct > 0;
            const campo = fila.querySelector('input[name="pct-' + pid + '"]');
            campo.value = String(pct);
        });
        if (form.dataset.form === 'gasto') actualizarFormGasto(estado);
        else pintarSumaReparto(form, estado, leerRepartoDelForm(form, false), 0);
    }

    function vistaPago(estado) {
        const b = ui.borrador || {};
        const yo = identidadEn(estado);
        const de = b.de || (yo && estado.saldos[yo.id] < 0 ? yo.id : null) || estado.participantes[0].id;
        const a = b.a || estado.participantes.find(p => p.id !== de).id;
        return '<form class="cta-form" data-form="pago" novalidate>' +
            '<h3>' + (b.corrigeA ? 'Corregir pago' : 'Registrar pago o abono') + '</h3>' +
            '<p class="cta-nota">Cuando alguien le paga a otro para saldar (todo o en parte) lo que le debe. No es un gasto nuevo: solo mueve los saldos entre los dos.</p>' +
            '<div class="cta-fila">' +
                '<label class="cta-campo">¿Quién paga?<select name="de">' + opcionesParticipantes(estado, de) + '</select></label>' +
                '<label class="cta-campo">¿A quién?<select name="a">' + opcionesParticipantes(estado, a) + '</select></label>' +
            '</div>' +
            '<div class="cta-pista" id="cta-pista-pago"></div>' +
            '<div class="cta-fila">' +
                '<label class="cta-campo">Monto<input name="monto" inputmode="decimal" required autofocus value="' + esc(b.monto ? (b.monto / 100).toFixed(2) : '') + '" placeholder="0.00"></label>' +
                '<label class="cta-campo">Fecha<input type="date" name="fechaMov" required value="' + esc(b.fechaMov || hoyISO()) + '"></label>' +
            '</div>' +
            '<label class="cta-campo">Concepto<input name="concepto" maxlength="140" value="' + esc(b.concepto || 'Liquidación') + '" placeholder="Liquidación, abono, transferencia…"></label>' +
            '<label class="cta-campo">Nota (opcional)<textarea name="nota" rows="2" maxlength="500" placeholder="Transferencia, efectivo, referencia…">' + esc(b.nota || '') + '</textarea></label>' +
            '<div class="cta-error" id="cta-error" role="alert" hidden></div>' +
            '<div class="cta-form-btns">' +
                '<button type="button" class="btn btn-secondary" data-acc="volver">Cancelar</button>' +
                '<button type="submit" class="btn btn-primary">' + (b.corrigeA ? 'Guardar corrección' : 'Guardar pago') + '</button>' +
            '</div></form>';
    }

    function actualizarFormPago(estado) {
        const form = document.querySelector('#cta-cuerpo form[data-form="pago"]');
        const pista = $('cta-pista-pago');
        if (!form || !pista) return;
        const de = form.de.value, a = form.a.value;
        if (de === a) { pista.innerHTML = '<span class="cta-mal">Elige dos personas distintas.</span>'; return; }
        const n = deudaNeta(estado, de, a);
        if (n > 0) {
            pista.innerHTML = 'Entre ellos dos, ' + esc(nombreDe(estado, de)) + ' le debe <strong>' + esc(dinero(n, estado)) + '</strong> a ' + esc(nombreDe(estado, a)) + '. ' +
                '<button type="button" class="cta-chip" data-acc="usar-monto" data-monto="' + n + '">Usar ese monto</button>';
        } else if (n < 0) {
            pista.innerHTML = 'Ojo: entre ellos dos es al revés, ' + esc(nombreDe(estado, a)) + ' le debe ' + esc(dinero(-n, estado)) + ' a ' + esc(nombreDe(estado, de)) + '.';
        } else {
            pista.textContent = 'Entre ellos dos están a mano.';
        }
    }

    function vistaNueva() {
        const filas = [0, 1].map(() => filaParticipanteNueva('', '50')).join('');
        return '<form class="cta-form" data-form="nueva" novalidate>' +
            '<div class="cta-fila">' +
                '<label class="cta-campo cta-campo-ancho">Nombre de la cuenta<input name="nombre" maxlength="80" required autofocus placeholder="Gastos de oficina, Renta del local…"></label>' +
                '<label class="cta-campo">Moneda<select name="moneda">' + MONEDAS.map(m => '<option>' + m + '</option>').join('') + '</select></label>' +
            '</div>' +
            '<label class="cta-campo">Descripción (opcional)<input name="descripcion" maxlength="200" placeholder="Qué gastos se llevan aquí"></label>' +
            '<fieldset class="cta-reparto"><legend>Participantes y reparto habitual</legend>' +
                '<p class="cta-nota">El reparto habitual se propone en cada gasto; en cualquiera se puede cambiar (70-30, solo entre algunos…).</p>' +
                '<div id="cta-nuevos">' + filas + '</div>' +
                '<div class="cta-chips">' +
                    '<button type="button" class="cta-chip" data-acc="agregar-fila">➕ Agregar participante</button>' +
                    '<button type="button" class="cta-chip" data-acc="nueva-igual">Partes iguales</button>' +
                '</div>' +
                '<div class="cta-reparto-suma" id="cta-suma"></div>' +
            '</fieldset>' +
            '<label class="cta-campo">¿Quién eres tú?<select name="yo"></select></label>' +
            '<div class="cta-error" id="cta-error" role="alert" hidden></div>' +
            '<div class="cta-form-btns">' +
                '<button type="button" class="btn btn-secondary" data-acc="volver">Cancelar</button>' +
                '<button type="submit" class="btn btn-primary">Crear cuenta</button>' +
            '</div></form>';
    }

    function filaParticipanteNueva(nombre, pct) {
        return '<div class="cta-nuevo">' +
            '<input name="p-nombre" maxlength="60" placeholder="Nombre" value="' + esc(nombre) + '" aria-label="Nombre del participante">' +
            '<span class="cta-pct"><input name="p-pct" inputmode="decimal" value="' + esc(pct) + '" aria-label="Porcentaje"> %</span>' +
            '<button type="button" class="btn-close" data-acc="quitar-fila" aria-label="Quitar participante">✕</button>' +
        '</div>';
    }

    function leerFormNueva(form) {
        return Array.from(form.querySelectorAll('.cta-nuevo')).map(fila => ({
            nombre: fila.querySelector('input[name="p-nombre"]').value.trim(),
            pct: parseFloat(String(fila.querySelector('input[name="p-pct"]').value).replace(',', '.'))
        }));
    }

    function actualizarFormNueva() {
        const form = document.querySelector('#cta-cuerpo form[data-form="nueva"]');
        if (!form) return;
        const filas = leerFormNueva(form);
        const suma = filas.filter(f => f.nombre).reduce((s, f) => s + (Number.isFinite(f.pct) ? f.pct : 0), 0);
        const ok = Math.abs(suma - 100) <= TOLERANCIA_PORCENTAJE;
        const el = form.querySelector('#cta-suma');
        el.textContent = `${filas.filter(f => f.nombre).length} participantes · suma ${textoPorcentaje(suma)}` + (ok ? ' ✓' : ' — debe ser 100%');
        el.classList.toggle('cta-mal', !ok);
        const yo = form.yo;
        const antes = yo.value;
        const nombres = filas.map(f => f.nombre).filter(Boolean);
        yo.innerHTML = '<option value="">Prefiero elegir después</option>' +
            nombres.map(n => '<option' + (n === antes ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
        form.querySelectorAll('[data-acc="quitar-fila"]').forEach(b => { b.disabled = filas.length <= MIN_PARTICIPANTES; });
        const agregar = form.querySelector('[data-acc="agregar-fila"]');
        if (agregar) agregar.disabled = filas.length >= MAX_PARTICIPANTES;
    }

    function vistaAjustes(estado) {
        const yo = identidadEn(estado);
        const editable = !estado.archivada;
        const vigentes = estado.movimientos.filter(m => !m.anulado).length;
        let html = '';
        html += '<form class="cta-form cta-bloque" data-form="datos" novalidate><h3>Datos de la cuenta</h3>' +
            '<label class="cta-campo">Nombre<input name="nombre" maxlength="80" required value="' + esc(estado.nombre) + '"' + (editable ? '' : ' disabled') + '></label>' +
            '<label class="cta-campo">Descripción<input name="descripcion" maxlength="200" value="' + esc(estado.descripcion) + '"' + (editable ? '' : ' disabled') + '></label>' +
            (editable ? '<div class="cta-form-btns"><button type="submit" class="btn btn-primary btn-sm">Guardar datos</button></div>' : '') +
            '</form>';

        html += '<form class="cta-form cta-bloque" data-form="reparto" novalidate><h3>Reparto habitual</h3>' +
            '<p class="cta-nota">Es el que se propone al registrar un gasto. Cambiarlo no toca los gastos ya registrados.</p>' +
            filasReparto(estado, estado.reparto, false) +
            '<div class="cta-reparto-suma" id="cta-suma"></div>' +
            (editable ? '<div class="cta-form-btns"><button type="button" class="cta-chip" data-acc="ajuste-igual">Partes iguales</button>' +
                '<button type="submit" class="btn btn-primary btn-sm">Guardar reparto</button></div>' : '') +
            '</form>';

        html += '<section class="cta-bloque"><h3>Participantes (' + estado.participantes.length + ' de ' + MAX_PARTICIPANTES + ')</h3><ul class="cta-participantes">' +
            estado.participantes.map(p => '<li><span>' + esc(p.nombre) + (p.pinHash ? ' 🔒' : '') + (yo && yo.id === p.id ? ' (tú)' : '') + '</span>' +
                (editable ? '<button type="button" class="btn btn-sm btn-secondary" data-acc="renombrar" data-pid="' + esc(p.id) + '">Renombrar</button>' : '') + '</li>').join('') +
            '</ul>' +
            (editable && estado.participantes.length < MAX_PARTICIPANTES
                ? '<form class="cta-fila" data-form="agregar-participante" novalidate><input name="nombre" maxlength="60" placeholder="Nombre de quien se suma" aria-label="Nombre del nuevo participante">' +
                  '<button type="submit" class="btn btn-secondary btn-sm">Agregar</button></form>' +
                  '<p class="cta-nota">Quien se suma entra con 0% en el reparto habitual: ajústalo arriba si va a participar en los gastos de siempre. Los gastos anteriores no le afectan.</p>'
                : '') +
            '</section>';

        html += '<section class="cta-bloque"><h3>Mi PIN</h3>';
        if (!yo) {
            html += '<p class="cta-nota">Elige primero quién eres en esta cuenta.</p>';
        } else {
            html += '<p class="cta-nota">Con un PIN, nadie más que use la licencia puede dar tu conformidad para archivar, reactivar o anular movimientos en tu nombre.</p>' +
                '<div class="cta-chips">' +
                (yo.pinHash
                    ? '<button type="button" class="btn btn-sm btn-secondary" data-acc="pin-poner">Cambiar mi PIN</button><button type="button" class="btn btn-sm btn-danger" data-acc="pin-quitar">Quitar mi PIN</button>'
                    : '<button type="button" class="btn btn-sm btn-secondary" data-acc="pin-poner">Poner un PIN</button>') +
                '</div>';
        }
        html += '</section>';

        if (!vigentes) {
            html += '<section class="cta-bloque"><h3>Eliminar la cuenta</h3>' +
                '<p class="cta-nota">Solo se puede mientras no tenga movimientos vigentes. Con movimientos, lo que procede es archivarla de común acuerdo.</p>' +
                '<button type="button" class="btn btn-sm btn-danger" data-acc="eliminar-cuenta">Eliminar esta cuenta</button></section>';
        }
        return html;
    }

    function actualizarFormReparto(estado) {
        const form = document.querySelector('#cta-cuerpo form[data-form="reparto"]');
        if (!form) return;
        if (estado.archivada) form.querySelectorAll('input').forEach(i => { i.disabled = true; });
        pintarSumaReparto(form, estado, leerRepartoDelForm(form, false), 0);
    }

    function mostrarError(texto) {
        const el = $('cta-error');
        if (!el) { toast(texto, 'error'); return; }
        el.textContent = texto;
        el.hidden = !texto;
        if (texto) el.scrollIntoView({ block: 'nearest' });
    }

    // ---- Diálogos dentro de la ventana ----

    /**
     * Una pregunta encima de la cuenta. Resuelve con el texto escrito, con el
     * valor de la opción elegida, con true si solo había que aceptar, o con
     * null si se canceló. `validar` puede devolver un mensaje para no cerrar.
     */
    function dialogo({ titulo, mensaje, campo, opciones, aceptar, peligro, validar }) {
        cerrarDialogo(null);
        const cont = $('cta-dialogo');
        cont.innerHTML =
            '<form class="cta-dialogo-caja" role="alertdialog" aria-labelledby="cta-dialogo-titulo" novalidate>' +
                '<h3 id="cta-dialogo-titulo">' + esc(titulo) + '</h3>' +
                (mensaje ? '<p>' + mensaje + '</p>' : '') +
                (campo ? '<label class="cta-campo">' + esc(campo.etiqueta || '') +
                    '<input name="valor" type="' + (campo.tipo || 'text') + '" maxlength="' + (campo.max || 200) + '"' +
                    (campo.inputmode ? ' inputmode="' + campo.inputmode + '"' : '') +
                    ' value="' + esc(campo.valor || '') + '" placeholder="' + esc(campo.placeholder || '') + '" autocomplete="off"></label>' : '') +
                (opciones ? '<div class="cta-chips cta-dialogo-opciones">' + opciones.map(o =>
                    '<button type="button" class="cta-chip" data-dialogo="' + esc(o.valor) + '">' + esc(o.texto) + '</button>').join('') + '</div>' : '') +
                '<div class="cta-error" role="alert" hidden></div>' +
                '<div class="cta-form-btns">' +
                    '<button type="button" class="btn btn-secondary" data-dialogo-cancelar>Cancelar</button>' +
                    (opciones ? '' : '<button type="submit" class="btn ' + (peligro ? 'btn-danger' : 'btn-primary') + '">' + esc(aceptar || 'Aceptar') + '</button>') +
                '</div>' +
            '</form>';
        cont.hidden = false;
        const form = cont.querySelector('form');
        const input = form.querySelector('input[name="valor"]');
        (input || form.querySelector('button')).focus();

        return new Promise(resolve => {
            ui.resolverDialogo = resolve;
            const terminar = async (valor) => {
                if (validar && valor !== null) {
                    const error = await validar(valor);
                    if (error) {
                        const el = form.querySelector('.cta-error');
                        el.textContent = error;
                        el.hidden = false;
                        if (input) { input.select(); input.focus(); }
                        return;
                    }
                }
                cerrarDialogo(valor);
            };
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                e.stopPropagation();
                terminar(campo ? input.value.trim() : true);
            });
            form.addEventListener('click', (e) => {
                const op = e.target.closest('[data-dialogo]');
                if (op) { e.stopPropagation(); terminar(op.dataset.dialogo); return; }
                if (e.target.closest('[data-dialogo-cancelar]')) { e.stopPropagation(); cerrarDialogo(null); }
            });
        });
    }

    function cerrarDialogo(valor) {
        const cont = $('cta-dialogo');
        if (cont) { cont.hidden = true; cont.innerHTML = ''; }
        const r = ui.resolverDialogo;
        ui.resolverDialogo = null;
        if (r) r(valor);
        if (ui.pendienteRefresco && abierto() && ['catalogo', 'cuenta'].includes(ui.vista)) refrescar();
    }

    /** Pide el PIN si la persona lo tiene. true si puede seguir. */
    async function comprobarPin(estado, p, motivo) {
        if (!p.pinHash) return true;
        const ok = await dialogo({
            titulo: `PIN de ${p.nombre}`,
            mensaje: esc(motivo || 'Escribe tu PIN para continuar.'),
            campo: { tipo: 'password', inputmode: 'numeric', max: 12, etiqueta: 'PIN' },
            aceptar: 'Continuar',
            validar: async (pin) => (await hashPin(estado.uid, p.id, pin)) === p.pinHash ? null : 'PIN incorrecto'
        });
        return ok !== null;
    }

    async function elegirIdentidad(estado, pid) {
        let p = pid ? estado.participantes.find(x => x.id === pid) : null;
        if (!p) {
            const valor = await dialogo({
                titulo: '¿Quién eres en esta cuenta?',
                mensaje: 'Queda guardado en este dispositivo. Cada movimiento registra quién lo hizo.',
                opciones: estado.participantes.map(x => ({ valor: x.id, texto: x.nombre + (x.pinHash ? ' 🔒' : '') }))
            });
            if (!valor) return null;
            p = estado.participantes.find(x => x.id === valor);
            if (!p) return null;
        }
        if (!(await comprobarPin(estado, p, 'Para usar esta cuenta como ' + p.nombre + ' en este dispositivo.'))) return null;
        guardarIdentidad(estado.uid, p);
        return p;
    }

    /** Quién actúa. Si en este dispositivo aún no se sabe, se pregunta. */
    async function asegurarYo(estado) {
        return identidadEn(estado) || await elegirIdentidad(estado, null);
    }

    // ---- Acciones ----

    async function estadoActual() {
        const e = ui.uid ? await estadoDe(ui.uid) : null;
        if (!e) throw new Error('No encontré la cuenta');
        return e;
    }

    function borradorDesde(mov, opciones) {
        const b = {
            concepto: mov.concepto, monto: mov.monto, categoria: mov.categoria, nota: mov.nota,
            pagadoPor: mov.pagadoPor, reparto: mov.reparto, de: mov.de, a: mov.a,
            fechaMov: opciones.hoy ? hoyISO() : mov.fechaMov
        };
        if (opciones.corrige) b.corrigeA = mov.id;
        return b;
    }

    const acciones = {
        cerrar: () => cerrar(),
        volver: () => {
            if (ui.vista === 'cuenta' || ui.vista === 'nueva') return abrirCatalogo(ui.verArchivadas);
            ui.borrador = null;
            return mostrar('cuenta');
        },
        'ver-activas': () => abrirCatalogo(false),
        'ver-archivadas': () => abrirCatalogo(true),
        nueva: () => abrirNueva(),
        abrir: (d) => abrir(d.uid),
        soy: async (d) => { const e = await estadoActual(); if (await elegirIdentidad(e, d.pid)) await pintar(); },
        'cambiar-yo': async () => { const e = await estadoActual(); if (await elegirIdentidad(e, null)) await pintar(); },
        'nuevo-gasto': () => { ui.borrador = null; return mostrar('gasto'); },
        'nuevo-pago': () => { ui.borrador = null; return mostrar('pago'); },
        liquidar: (d) => { ui.borrador = { de: d.de, a: d.a, monto: parseInt(d.monto, 10), concepto: 'Liquidación' }; return mostrar('pago'); },
        ajustes: () => mostrar('ajustes'),
        repetir: async (d) => {
            const e = await estadoActual();
            const m = e.movimientos.find(x => x.id === d.mov);
            if (!m) return;
            ui.borrador = borradorDesde(m, { hoy: true });
            return mostrar('gasto');
        },
        corregir: async (d) => {
            const e = await estadoActual();
            const m = e.movimientos.find(x => x.id === d.mov);
            if (!m) return;
            ui.borrador = borradorDesde(m, { corrige: true });
            return mostrar(m.tipo === 'pago' ? 'pago' : 'gasto');
        },
        anular: async (d) => {
            const e = await estadoActual();
            const m = e.movimientos.find(x => x.id === d.mov);
            if (!m || m.anulado) return;
            const yo = await asegurarYo(e);
            if (!yo || !(await comprobarPin(e, yo, 'Para anular un movimiento.'))) return;
            const motivo = await dialogo({
                titulo: 'Anular movimiento',
                mensaje: '«' + esc(m.concepto || 'Movimiento') + '» por ' + esc(dinero(m.monto, e)) +
                    '. Deja de contar en los saldos pero sigue en el histórico con el motivo.',
                campo: { etiqueta: 'Motivo', placeholder: 'Se capturó dos veces, monto equivocado…', max: 200 },
                aceptar: 'Anular', peligro: true,
                validar: (v) => v ? null : 'Escribe el motivo: queda en el histórico'
            });
            if (motivo === null) return;
            await registrar(e.uid, { tipo: 'anular', por: yo.id, movId: m.id, motivo });
            toast('Movimiento anulado', 'success');
            await pintar();
        },
        'reparto-cuenta': async () => {
            const e = await estadoActual();
            const form = document.querySelector('#cta-cuerpo form[data-form="gasto"]');
            if (form) ponerReparto(form, e.reparto, e, true);
        },
        'reparto-igual': async () => {
            const e = await estadoActual();
            const form = document.querySelector('#cta-cuerpo form[data-form="gasto"]');
            if (!form) return;
            const marcados = Array.from(form.querySelectorAll('input[name="incl"]:checked')).map(c => c.value);
            ponerReparto(form, repartoIgual(marcados.length ? marcados : e.participantes.map(p => p.id)), e, true);
        },
        'ajuste-igual': async () => {
            const e = await estadoActual();
            const form = document.querySelector('#cta-cuerpo form[data-form="reparto"]');
            if (form) ponerReparto(form, repartoIgual(e.participantes.map(p => p.id)), e, false);
        },
        'usar-monto': (d) => {
            const form = document.querySelector('#cta-cuerpo form[data-form="pago"]');
            if (form) { form.monto.value = (parseInt(d.monto, 10) / 100).toFixed(2); form.monto.focus(); }
        },
        'agregar-fila': () => {
            const cont = $('cta-nuevos');
            if (!cont || cont.children.length >= MAX_PARTICIPANTES) return;
            cont.insertAdjacentHTML('beforeend', filaParticipanteNueva('', '0'));
            const ultimo = cont.lastElementChild.querySelector('input');
            if (ultimo) ultimo.focus();
            actualizarFormNueva();
        },
        'quitar-fila': (d, boton) => {
            const cont = $('cta-nuevos');
            if (!cont || cont.children.length <= MIN_PARTICIPANTES) return;
            boton.closest('.cta-nuevo').remove();
            actualizarFormNueva();
        },
        'nueva-igual': () => {
            const form = document.querySelector('#cta-cuerpo form[data-form="nueva"]');
            if (!form) return;
            const filas = Array.from(form.querySelectorAll('.cta-nuevo'));
            const conNombre = filas.filter(f => f.querySelector('input[name="p-nombre"]').value.trim());
            const usar = conNombre.length >= MIN_PARTICIPANTES ? conNombre : filas;
            const reparto = repartoIgual(usar.map((_, i) => String(i)));
            filas.forEach(f => { f.querySelector('input[name="p-pct"]').value = '0'; });
            usar.forEach((f, i) => { f.querySelector('input[name="p-pct"]').value = String(reparto[String(i)]); });
            actualizarFormNueva();
        },
        copiar: async () => {
            const e = await estadoActual();
            const texto = resumenTexto(e);
            try {
                await navigator.clipboard.writeText(texto);
            } catch (err) {
                const ta = document.createElement('textarea');
                ta.value = texto;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch (x) { /* sin portapapeles */ }
                ta.remove();
            }
            toast('Resumen copiado: pégalo en un chat o correo', 'success');
        },
        csv: async () => {
            const e = await estadoActual();
            const nombre = 'cuenta-' + (normalizar(e.nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'compartida') + '-' + hoyISO() + '.csv';
            const contenido = '﻿' + csvDe(e, movimientosFiltrados(e));
            if (typeof descargarArchivo === 'function') descargarArchivo(nombre, contenido, 'text/csv;charset=utf-8');
            toast('Estado de cuenta exportado', 'success');
        },
        'solicitar-archivo': async () => {
            const e = await estadoActual();
            const yo = await asegurarYo(e);
            if (!yo || !(await comprobarPin(e, yo, 'Para pedir que se archive la cuenta.'))) return;
            const pendientes = liquidacionSugerida(e.saldos, e.participantes.map(p => p.id));
            const aviso = pendientes.length
                ? '<strong>Ojo: aún hay saldos pendientes</strong> (' + esc(resumenSaldos(e)) + '). Si se archiva así, quedan congelados como están.<br>'
                : 'Todos están a mano. ';
            const motivo = await dialogo({
                titulo: 'Solicitar archivo',
                mensaje: aviso + 'La cuenta se archiva cuando todos los participantes den su conformidad desde su dispositivo.',
                campo: { etiqueta: 'Motivo (opcional)', placeholder: 'Terminó el contrato del local…', max: 200 },
                aceptar: 'Solicitar archivo'
            });
            if (motivo === null) return;
            await registrar(e.uid, { tipo: 'solicitar_archivo', por: yo.id, motivo });
            const despues = await estadoActual();
            toast(despues.archivada ? 'Cuenta archivada' : 'Solicitud enviada: falta la conformidad de los demás', 'success');
            await pintar();
        },
        'confirmar-archivo': async () => {
            const e = await estadoActual();
            if (!e.solicitud) return pintar();
            const yo = await asegurarYo(e);
            if (!yo || !(await comprobarPin(e, yo, 'Para dar tu conformidad de archivo.'))) return;
            const ok = await dialogo({
                titulo: 'Dar conformidad',
                mensaje: '¿Estás de acuerdo en archivar «' + esc(e.nombre) + '»? Saldos actuales: ' + esc(resumenSaldos(e)) + '.',
                aceptar: 'Sí, archivar'
            });
            if (!ok) return;
            await registrar(e.uid, { tipo: 'confirmar_archivo', por: yo.id, solicitudId: e.solicitud.id });
            const despues = await estadoActual();
            toast(despues.archivada ? 'Todos de acuerdo: cuenta archivada' : 'Conformidad registrada', 'success');
            await pintar();
        },
        'rechazar-archivo': async () => {
            const e = await estadoActual();
            if (!e.solicitud) return pintar();
            const yo = await asegurarYo(e);
            if (!yo) return;
            const retiro = yo.id === e.solicitud.por;
            const motivo = await dialogo({
                titulo: retiro ? 'Retirar la solicitud' : 'No archivar',
                mensaje: retiro ? 'La cuenta seguirá activa.' : 'La solicitud se cierra y la cuenta sigue activa.',
                campo: { etiqueta: 'Motivo (opcional)', max: 200 },
                aceptar: retiro ? 'Retirar' : 'No archivar'
            });
            if (motivo === null) return;
            await registrar(e.uid, { tipo: 'rechazar_archivo', por: yo.id, solicitudId: e.solicitud.id, motivo });
            await pintar();
        },
        reactivar: async () => {
            const e = await estadoActual();
            const yo = await asegurarYo(e);
            if (!yo || !(await comprobarPin(e, yo, 'Para reactivar la cuenta.'))) return;
            const motivo = await dialogo({
                titulo: 'Reactivar cuenta',
                mensaje: 'Vuelve a admitir movimientos. Para archivarla de nuevo hará falta otra vez la conformidad de todos.',
                campo: { etiqueta: 'Motivo (opcional)', max: 200 },
                aceptar: 'Reactivar'
            });
            if (motivo === null) return;
            await registrar(e.uid, { tipo: 'reactivar', por: yo.id, motivo });
            ui.verArchivadas = false;
            toast('Cuenta reactivada', 'success');
            await pintar();
        },
        renombrar: async (d) => {
            const e = await estadoActual();
            const p = e.participantes.find(x => x.id === d.pid);
            if (!p) return;
            const yo = await asegurarYo(e);
            if (!yo) return;
            const nombre = await dialogo({
                titulo: 'Renombrar participante',
                campo: { etiqueta: 'Nombre', valor: p.nombre, max: 60 },
                aceptar: 'Guardar',
                validar: (v) => {
                    if (!v) return 'Escribe un nombre';
                    if (e.participantes.some(x => x.id !== p.id && normalizar(x.nombre) === normalizar(v))) return 'Ya hay alguien con ese nombre';
                    return null;
                }
            });
            if (nombre === null || nombre === p.nombre) return;
            await registrar(e.uid, { tipo: 'renombrar_participante', por: yo.id, participanteId: p.id, nombre });
            await pintar();
        },
        'pin-poner': async () => {
            const e = await estadoActual();
            const yo = identidadEn(e);
            if (!yo) return;
            if (!(await comprobarPin(e, yo, 'Escribe tu PIN actual.'))) return;
            let primero = null;
            const pin = await dialogo({
                titulo: 'Nuevo PIN',
                mensaje: 'De 4 a 8 dígitos. Te lo pediremos para archivar, reactivar o anular en tu nombre.',
                campo: { tipo: 'password', inputmode: 'numeric', max: 8, etiqueta: 'PIN' },
                aceptar: 'Continuar',
                validar: (v) => /^\d{4,8}$/.test(v) ? null : 'Usa de 4 a 8 dígitos'
            });
            if (pin === null) return;
            primero = pin;
            const repetido = await dialogo({
                titulo: 'Confirma tu PIN',
                campo: { tipo: 'password', inputmode: 'numeric', max: 8, etiqueta: 'Repite el PIN' },
                aceptar: 'Guardar PIN',
                validar: (v) => v === primero ? null : 'No coincide'
            });
            if (repetido === null) return;
            const pinHash = await hashPin(e.uid, yo.id, pin);
            await registrar(e.uid, { tipo: 'pin', por: yo.id, participanteId: yo.id, pinHash });
            guardarIdentidad(e.uid, { ...yo, pinHash });
            toast('PIN guardado', 'success');
            await pintar();
        },
        'pin-quitar': async () => {
            const e = await estadoActual();
            const yo = identidadEn(e);
            if (!yo || !(await comprobarPin(e, yo, 'Para quitar tu PIN.'))) return;
            await registrar(e.uid, { tipo: 'pin', por: yo.id, participanteId: yo.id, pinHash: null });
            guardarIdentidad(e.uid, { ...yo, pinHash: null });
            toast('PIN quitado', 'success');
            await pintar();
        },
        'eliminar-cuenta': async () => {
            const e = await estadoActual();
            if (e.movimientos.some(m => !m.anulado)) return;
            const ok = await dialogo({
                titulo: 'Eliminar cuenta',
                mensaje: '¿Eliminar «' + esc(e.nombre) + '»? Desaparece del catálogo en todos los dispositivos de la licencia.',
                aceptar: 'Eliminar', peligro: true
            });
            if (!ok) return;
            await registrar(e.uid, { tipo: 'eliminar', por: (identidadEn(e) || {}).id || null });
            toast('Cuenta eliminada', 'success');
            await abrirCatalogo(false);
        }
    };

    async function alHacerClic(e) {
        const b = e.target.closest('[data-acc]');
        if (!b || !$('cta-overlay').contains(b) || b.disabled) return;
        if ($('cta-dialogo').contains(b)) return;
        const fn = acciones[b.dataset.acc];
        if (!fn) return;
        e.preventDefault();
        try {
            await fn(b.dataset, b);
        } catch (err) {
            console.error('[CUENTAS]', err);
            toast(err.message || 'No se pudo completar', 'error');
        }
    }

    function alEscribir(e) {
        const t = e.target;
        const est = ui.estado;
        if (t.dataset && t.dataset.filtro) {
            const campo = t.dataset.filtro;
            ui.filtro[campo] = t.type === 'checkbox' ? t.checked : t.value;
            if (est) pintarHistorial(est);
            return;
        }
        const form = t.closest && t.closest('form[data-form]');
        if (!form) return;
        if (form.dataset.form === 'nueva') { actualizarFormNueva(); return; }
        if (!est) return;
        if (form.dataset.form === 'gasto') actualizarFormGasto(est);
        else if (form.dataset.form === 'pago') actualizarFormPago(est);
        else if (form.dataset.form === 'reparto') pintarSumaReparto(form, est, leerRepartoDelForm(form, false), 0);
    }

    async function alEnviar(e) {
        const form = e.target.closest('form[data-form]');
        if (!form || $('cta-dialogo').contains(form)) return;
        e.preventDefault();
        const enviar = form.querySelector('button[type="submit"]');
        if (enviar) enviar.disabled = true;
        try {
            await (envios[form.dataset.form] || (() => {}))(form);
        } catch (err) {
            console.error('[CUENTAS]', err);
            mostrarError(err.message || 'No se pudo guardar');
        } finally {
            if (enviar && document.body.contains(enviar)) enviar.disabled = false;
        }
    }

    const envios = {
        nueva: async (form) => {
            const nombre = form.nombre.value.trim();
            if (!nombre) return mostrarError('Ponle nombre a la cuenta');
            const filas = leerFormNueva(form).filter(f => f.nombre);
            const error = validarParticipantes(filas.map(f => f.nombre));
            if (error) return mostrarError(error);
            const participantes = filas.map(f => ({ id: nuevoId('p'), nombre: f.nombre }));
            const reparto = {};
            filas.forEach((f, i) => { if (Number.isFinite(f.pct) && f.pct > 0) reparto[participantes[i].id] = Math.round(f.pct * 100) / 100; });
            const errReparto = validarReparto(reparto, participantes.map(p => p.id));
            if (errReparto) return mostrarError(errReparto);
            const yo = participantes.find(p => p.nombre === form.yo.value) || null;
            const uid = nuevoId('cta');
            await registrar(uid, {
                tipo: 'crear', por: yo ? yo.id : null,
                nombre, descripcion: form.descripcion.value.trim(),
                moneda: MONEDAS.includes(form.moneda.value) ? form.moneda.value : 'MXN',
                participantes, reparto
            });
            if (yo) guardarIdentidad(uid, yo);
            toast('Cuenta creada', 'success');
            await abrir(uid);
        },
        gasto: async (form) => {
            const e = await estadoActual();
            if (e.archivada) return mostrarError('La cuenta está archivada');
            const mov = {
                concepto: form.concepto.value.trim(),
                monto: aCentavos(form.monto.value),
                fechaMov: form.fechaMov.value,
                pagadoPor: form.pagadoPor.value,
                categoria: form.categoria.value.trim(),
                reparto: leerRepartoDelForm(form, true),
                nota: form.nota.value.trim()
            };
            const error = validarGasto(e, mov);
            if (error) return mostrarError(error);
            await guardarMovimiento(e, 'gasto', mov);
        },
        pago: async (form) => {
            const e = await estadoActual();
            if (e.archivada) return mostrarError('La cuenta está archivada');
            const mov = {
                concepto: form.concepto.value.trim() || 'Pago',
                monto: aCentavos(form.monto.value),
                fechaMov: form.fechaMov.value,
                de: form.de.value,
                a: form.a.value,
                nota: form.nota.value.trim()
            };
            const error = validarPago(e, mov);
            if (error) return mostrarError(error);
            await guardarMovimiento(e, 'pago', mov);
        },
        datos: async (form) => {
            const e = await estadoActual();
            const nombre = form.nombre.value.trim();
            if (!nombre) return toast('El nombre no puede quedar vacío', 'warning');
            const cambios = {};
            if (nombre !== e.nombre) cambios.nombre = nombre;
            if (form.descripcion.value.trim() !== e.descripcion) cambios.descripcion = form.descripcion.value.trim();
            if (!Object.keys(cambios).length) return toast('No hay cambios', 'info');
            const yo = await asegurarYo(e);
            if (!yo) return;
            await registrar(e.uid, { tipo: 'editar', por: yo.id, cambios });
            toast('Datos guardados', 'success');
            await pintar();
        },
        reparto: async (form) => {
            const e = await estadoActual();
            const reparto = leerRepartoDelForm(form, false);
            const error = validarReparto(reparto, e.participantes.map(p => p.id));
            if (error) return toast(error, 'warning');
            const yo = await asegurarYo(e);
            if (!yo) return;
            await registrar(e.uid, { tipo: 'editar', por: yo.id, cambios: { reparto } });
            toast('Reparto habitual guardado', 'success');
            await pintar();
        },
        'agregar-participante': async (form) => {
            const e = await estadoActual();
            const nombre = form.nombre.value.trim();
            if (!nombre) return;
            const error = validarParticipantes(e.participantes.map(p => p.nombre).concat(nombre));
            if (error) return toast(error, 'warning');
            const yo = await asegurarYo(e);
            if (!yo) return;
            await registrar(e.uid, { tipo: 'participante', por: yo.id, participante: { id: nuevoId('p'), nombre } });
            toast(nombre + ' se sumó a la cuenta', 'success');
            await pintar();
        }
    };

    async function guardarMovimiento(estado, tipo, mov) {
        const yo = await asegurarYo(estado);
        if (!yo) return mostrarError('Elige quién eres para registrar el movimiento');
        const corrige = ui.borrador && ui.borrador.corrigeA;
        if (corrige) {
            const original = estado.movimientos.find(m => m.id === corrige);
            if (!original || original.anulado) return mostrarError('El movimiento original ya fue anulado');
            if (!(await comprobarPin(estado, yo, 'Corregir anula el movimiento original.'))) return;
        }
        const ev = await registrar(estado.uid, { tipo, por: yo.id, mov: corrige ? { ...mov, corrigeA: corrige } : mov });
        if (corrige) {
            await registrar(estado.uid, { tipo: 'anular', por: yo.id, movId: corrige, motivo: 'Corregido: se registró de nuevo', reemplazadoPor: ev.id });
        }
        ui.borrador = null;
        toast(corrige ? 'Movimiento corregido' : (tipo === 'gasto' ? 'Gasto registrado' : 'Pago registrado'), 'success');
        await mostrar('cuenta');
    }

    // ---- Resumen y CSV ----

    function resumenTexto(e) {
        const lineas = [`Cuenta «${e.nombre}» — ${fechaCorta(hoyISO())}`, '', 'Saldos:'];
        for (const p of e.participantes) {
            const s = e.saldos[p.id] || 0;
            lineas.push(`• ${p.nombre}: ` + (s > 0 ? `a su favor ${dinero(s, e)}` : s < 0 ? `debe ${dinero(-s, e)}` : 'a mano'));
        }
        const pagos = liquidacionSugerida(e.saldos, e.participantes.map(p => p.id));
        lineas.push('', 'Para quedar a mano:');
        if (!pagos.length) lineas.push('• Todos están a mano');
        for (const p of pagos) lineas.push(`• ${nombreDe(e, p.de)} paga ${dinero(p.monto, e)} a ${nombreDe(e, p.a)}`);
        const vigentes = e.movimientos.filter(m => !m.anulado);
        lineas.push('', `Movimientos vigentes: ${vigentes.length} · Total de gastos: ${dinero(e.totalGastos, e)}`);
        return lineas.join('\n');
    }

    function csvDe(e, movimientos) {
        const celda = v => {
            const s = String(v == null ? '' : v);
            return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const num = c => (c / 100).toFixed(2);
        const encabezado = ['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Pagó / Paga', 'Recibe', 'Monto']
            .concat(e.participantes.map(p => 'Parte de ' + p.nombre))
            .concat(e.participantes.map(p => 'Saldo de ' + p.nombre + ' después'))
            .concat(['Estado', 'Motivo de anulación', 'Registró', 'Registrado el', 'Nota']);
        const filas = movimientos.map(m => [
            m.fechaMov, m.tipo === 'gasto' ? 'Gasto' : 'Pago', m.concepto, m.categoria || '',
            nombreDe(e, m.tipo === 'gasto' ? m.pagadoPor : m.de), m.tipo === 'pago' ? nombreDe(e, m.a) : '',
            num(m.monto)
        ].concat(e.participantes.map(p => m.tipo === 'gasto' ? num(m.cuotas[p.id] || 0) : ''))
         .concat(e.participantes.map(p => num(m.saldoTras[p.id] || 0)))
         .concat([m.anulado ? 'Anulado' : 'Vigente', m.anulado ? m.anulado.motivo : '',
                  m.registradoPor ? nombreDe(e, m.registradoPor) : '', m.registradoEn, m.nota || '']));
        const pie = [[], ['Saldo final'].concat(Array(6).fill('')).concat(e.participantes.map(() => ''))
            .concat(e.participantes.map(p => num(e.saldos[p.id] || 0)))];
        return [encabezado].concat(filas).concat(pie).map(f => f.map(celda).join(',')).join('\r\n');
    }

    // ---- Lo que usa el asistente ----

    /** Las cuentas para enseñarlas en el chat, numeradas como se muestran. */
    async function catalogo(opciones) {
        const archivadas = !!(opciones && opciones.archivadas);
        const estados = await estadosDeCuentas();
        const lista = estados.filter(e => e.archivada === archivadas)
            .sort((a, b) => (b.actualizada || '').localeCompare(a.actualizada || ''));
        return {
            items: lista.map((e, i) => {
                const yo = identidadEn(e);
                return {
                    numero: i + 1, uid: e.uid, nombre: e.nombre,
                    participantes: e.participantes.map(p => p.nombre),
                    resumen: resumenSaldos(e),
                    archivada: e.archivada,
                    porConfirmar: !!(e.solicitud && (!yo || !e.solicitud.confirmaciones[yo.id]))
                };
            }),
            activas: estados.filter(e => !e.archivada).length,
            archivadas: estados.filter(e => e.archivada).length
        };
    }

    global.CUENTAS = Object.assign({}, Motor, {
        catalogo, abrir, abrirNueva, abrirCatalogo, cerrar, refrescar, abierto
    });
    // Para la sincronización (sync.js).
    global.obtenerCuentasCompartidas = leerCuentas;
    global.aplicarCuentasCompartidas = aplicarCuentasCompartidas;
    global.fusionarCuentasCompartidas = fusionarCuentas;
})(typeof window !== 'undefined' ? window : globalThis);
