/**
 * Estadísticas del despacho: tiempos, resultados, tipos de asunto, clientes,
 * responsables, pendientes y agenda.
 *
 * Dos partes, como la calculadora laboral:
 *  - el motor (`calcular`), puro: recibe expedientes, pendientes, eventos,
 *    notas e historial y devuelve todas las cifras. No toca el DOM ni la
 *    base, así que se prueba en Node con datos armados a mano;
 *  - la interfaz, que lee la base, llama al motor y pinta filtros, cifras,
 *    gráficas y tablas.
 *
 * Qué se mide y cómo, para que las cifras no engañen:
 *  - Un asunto empieza en su "Inicio del asunto" si se capturó y, si no, el
 *    día que se dio de alta en la app. Termina el día que se archivó.
 *  - "Cerrados" son los archivados (concluidos, abandonados u otro motivo).
 *  - El periodo elegido aplica a lo que ocurre en el tiempo (altas, cierres,
 *    pendientes terminados, eventos). Lo que es "hoy" (activos, pendientes
 *    abiertos, vencidos) no depende del periodo.
 *  - Los eventos que la app crea para la fecha de un pendiente no cuentan en
 *    la agenda: ya cuentan como pendientes.
 */
(function (global) {
    'use strict';

    // ==================== MOTOR ====================

    const DIA_MS = 864e5;
    const DIAS_POR_MES = 30.4375;
    const DIAS_SIN_MOVIMIENTO = 60;
    const DIAS_AUDIENCIAS_PROXIMAS = 30;
    const SEMANAS_AGENDA = 8;

    const PERIODOS = [
        { clave: '30d', etiqueta: 'Últimos 30 días' },
        { clave: '90d', etiqueta: 'Últimos 90 días' },
        { clave: 'mes', etiqueta: 'Este mes' },
        { clave: 'anio', etiqueta: 'Este año' },
        { clave: '12m', etiqueta: 'Últimos 12 meses' },
        { clave: 'todo', etiqueta: 'Todo el historial' },
        { clave: 'rango', etiqueta: 'Otro rango…' }
    ];

    const TRAMOS_ANTIGUEDAD = [
        { clave: 'm3', etiqueta: 'Menos de 3 meses', hasta: 91 },
        { clave: 'm6', etiqueta: '3 a 6 meses', hasta: 183 },
        { clave: 'm12', etiqueta: '6 a 12 meses', hasta: 366 },
        { clave: 'a2', etiqueta: '1 a 2 años', hasta: 731 },
        { clave: 'mas', etiqueta: 'Más de 2 años', hasta: Infinity }
    ];

    // Debe coincidir con RESULTADOS_EXPEDIENTE de app.js (lo vigila la prueba).
    const RESULTADOS = [
        { clave: 'favorable', etiqueta: 'Favorable' },
        { clave: 'parcial', etiqueta: 'Parcialmente favorable' },
        { clave: 'convenio', etiqueta: 'Convenio o acuerdo' },
        { clave: 'desfavorable', etiqueta: 'Desfavorable' },
        { clave: 'sin_fondo', etiqueta: 'Sin resolución de fondo (desistimiento, caducidad…)' }
    ];
    const RESULTADOS_FAVORABLES = new Set(['favorable', 'parcial']);

    const MOTIVOS = { concluido: 'Concluido', abandonado: 'Abandonado', otro: 'Otro motivo' };
    const INSTITUCIONES = { TSJ: 'TSJ Quintana Roo', PJF: 'PJF Federal', OTRO: 'Otras autoridades' };
    const TIPOS_EVENTO = { audiencia: 'Audiencias', vencimiento: 'Vencimientos', recordatorio: 'Recordatorios', otro: 'Otros' };
    const PRIORIDADES = { alta: 'Alta', media: 'Media', baja: 'Baja', '': 'Sin prioridad' };

    const SIN_CLIENTE = 'Sin cliente registrado';
    const SIN_RESPONSABLE = 'Sin responsable';
    const SIN_TIPO = 'Sin tipo registrado';

    // La materia sale del nombre del juzgado. El orden importa: "Sala Civil
    // Mercantil y Familiar" es una sola materia, no "Familiar".
    const REGLAS_MATERIA = [
        [/CIVIL,? MERCANTIL Y FAMILIAR/, 'Civil, mercantil y familiar'],
        [/CONSTITUCIONAL/, 'Constitucional'],
        [/PENAL/, 'Penal'],
        [/LABORAL|TRABAJO/, 'Laboral'],
        [/FAMILIAR/, 'Familiar'],
        [/MERCANTIL/, 'Mercantil'],
        [/CIVIL/, 'Civil'],
        [/ADMINISTRATIV/, 'Administrativa']
    ];

    function normalizar(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /** ms de una fecha: "2026-10-01" es medianoche LOCAL; lo demás, ISO. */
    function aMs(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
        const t = Date.parse(v);
        return Number.isNaN(t) ? null : t;
    }

    function inicioDelDia(ms) {
        const d = new Date(ms);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }

    function finDelDia(ms) { return inicioDelDia(ms) + DIA_MS - 1; }

    function mediana(nums) {
        const v = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
        if (!v.length) return null;
        const m = Math.floor(v.length / 2);
        return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    }

    function promedio(nums) {
        const v = nums.filter(n => Number.isFinite(n));
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    }

    function institucionDe(exp) {
        return ['TSJ', 'PJF', 'OTRO'].includes(exp && exp.institucion) ? exp.institucion : 'TSJ';
    }

    function materiaDe(exp) {
        if (exp.materia && String(exp.materia).trim()) {
            const t = String(exp.materia).trim();
            return t.charAt(0).toUpperCase() + t.slice(1);
        }
        const juzgado = normalizar(exp.juzgado).toUpperCase();
        for (const [re, materia] of REGLAS_MATERIA) if (re.test(juzgado)) return materia;
        const inst = institucionDe(exp);
        if (inst === 'PJF') return /amparo/i.test(exp.pjfTipoAsunto || '') ? 'Amparo' : 'Federal';
        if (inst === 'OTRO') return 'Otras autoridades';
        return 'Sin clasificar';
    }

    function tipoAsuntoDe(exp) {
        const t = String(exp.tipo || exp.pjfTipoAsunto || '').trim();
        return t || SIN_TIPO;
    }

    /** El inicio del asunto: el capturado o, si no hay, el alta en la app. */
    function inicioDe(exp) {
        return aMs(exp.fechaInicioAsunto) || aMs(exp.fechaCreacion);
    }

    function nombreExpediente(exp) {
        return String(exp.numero || exp.nombre || 'Expediente').trim();
    }

    /**
     * Agrupa por un texto sin distinguir mayúsculas ni acentos ("Pérez" y
     * "perez" son el mismo cliente) y muestra la primera forma que apareció.
     */
    function agrupador() {
        const grupos = new Map();
        return {
            clave(texto, vacio) {
                const t = String(texto || '').trim();
                if (!t) return vacio;
                const k = normalizar(t);
                if (!grupos.has(k)) grupos.set(k, t);
                return grupos.get(k);
            }
        };
    }

    /** El periodo elegido, en ms locales, de inicio del primer día a fin del último. */
    function resolverPeriodo(preset, ahoraMs, desdeYmd, hastaYmd, minimoMs) {
        const hoy = inicioDelDia(ahoraMs);
        const d = new Date(hoy);
        let desde, hasta = finDelDia(hoy);
        switch (preset) {
            case '30d': desde = hoy - 29 * DIA_MS; break;
            case '90d': desde = hoy - 89 * DIA_MS; break;
            case 'mes': desde = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); break;
            case 'anio': desde = new Date(d.getFullYear(), 0, 1).getTime(); break;
            case 'todo': desde = inicioDelDia(minimoMs != null ? Math.min(minimoMs, hoy) : hoy); break;
            case 'rango': {
                const a = aMs(desdeYmd), b = aMs(hastaYmd);
                desde = a != null ? a : new Date(d.getFullYear(), d.getMonth() - 11, d.getDate()).getTime();
                hasta = b != null ? finDelDia(b) : hasta;
                if (desde > hasta) { const t = desde; desde = inicioDelDia(hasta); hasta = finDelDia(t); }
                break;
            }
            default:
                preset = '12m';
                desde = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate() + 1).getTime();
        }
        const dias = Math.round((hasta + 1 - desde) / DIA_MS);
        return { preset, desde, hasta, dias };
    }

    /** El periodo del mismo largo justo antes; "todo" no tiene anterior. */
    function periodoAnterior(p) {
        if (p.preset === 'todo') return null;
        const largo = p.hasta + 1 - p.desde;
        return { desde: p.desde - largo, hasta: p.desde - 1 };
    }

    const dentro = (ms, p) => ms != null && ms >= p.desde && ms <= p.hasta;

    function claveMes(ms) {
        const d = new Date(ms);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    /** Los meses que cubre la tendencia: los del periodo, entre 6 y 24. */
    function mesesDeTendencia(p) {
        const fin = new Date(p.hasta);
        let inicio = new Date(p.desde);
        let n = (fin.getFullYear() - inicio.getFullYear()) * 12 + fin.getMonth() - inicio.getMonth() + 1;
        n = Math.max(6, Math.min(24, n));
        const meses = [];
        for (let i = n - 1; i >= 0; i--) {
            const m = new Date(fin.getFullYear(), fin.getMonth() - i, 1);
            meses.push({ clave: claveMes(m.getTime()), ms: m.getTime() });
        }
        return meses;
    }

    function lunesDe(ms) {
        const d = new Date(inicioDelDia(ms));
        const dia = (d.getDay() + 6) % 7; // lunes = 0
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dia).getTime();
    }

    /**
     * Todas las cifras. `datos`: { expedientes (activos y archivados),
     * pendientes, eventos, notas, historial }. `opciones`: { ahora, periodo,
     * desde, hasta, institucion, materia, cliente, responsable }.
     */
    function calcular(datos, opciones) {
        opciones = opciones || {};
        const ahora = opciones.ahora != null ? opciones.ahora : Date.now();
        const todos = (datos.expedientes || []).filter(e => e && e.activo !== false);
        const pendientesTodos = datos.pendientes || [];
        const eventosTodos = datos.eventos || [];
        const notasTodas = datos.notas || [];
        const historialTodo = datos.historial || [];

        // Nombres de cliente y responsable unificados en todo el despacho,
        // antes de filtrar: así el filtro y las tablas usan la misma forma.
        const clientes = agrupador();
        const responsables = agrupador();
        const tipos = agrupador();
        const fichas = todos.map(exp => ({
            exp,
            id: exp.id,
            institucion: institucionDe(exp),
            materia: materiaDe(exp),
            tipo: tipos.clave(tipoAsuntoDe(exp) === SIN_TIPO ? '' : tipoAsuntoDe(exp), SIN_TIPO),
            cliente: clientes.clave(exp.cliente, SIN_CLIENTE),
            responsable: responsables.clave(exp.abogado, SIN_RESPONSABLE),
            archivado: !!exp.archivado,
            alta: aMs(exp.fechaCreacion),
            inicio: inicioDe(exp),
            cierre: exp.archivado ? aMs(exp.fechaArchivo) : null
        }));

        const valores = (campo, vacio) => Array.from(new Set(fichas.map(f => f[campo])))
            .sort((a, b) => (a === vacio) - (b === vacio) || a.localeCompare(b, 'es'));
        const opcionesFiltro = {
            instituciones: Object.keys(INSTITUCIONES).filter(k => fichas.some(f => f.institucion === k)),
            materias: valores('materia', 'Sin clasificar'),
            clientes: valores('cliente', SIN_CLIENTE),
            responsables: valores('responsable', SIN_RESPONSABLE)
        };

        const filtros = {
            institucion: opciones.institucion || '',
            materia: opciones.materia || '',
            cliente: opciones.cliente || '',
            responsable: opciones.responsable || ''
        };
        const hayFiltro = Object.values(filtros).some(Boolean);
        const sel = fichas.filter(f =>
            (!filtros.institucion || f.institucion === filtros.institucion) &&
            (!filtros.materia || f.materia === filtros.materia) &&
            (!filtros.cliente || f.cliente === filtros.cliente) &&
            (!filtros.responsable || f.responsable === filtros.responsable));
        const porId = new Map(sel.map(f => [f.id, f]));
        // Con un filtro puesto solo entra lo que cuelga de un expediente que
        // pasa; sin filtro entra todo, también lo que no tiene expediente.
        const entra = r => hayFiltro ? porId.has(r.expedienteId) : true;

        const pendientes = pendientesTodos.filter(entra);
        const eventos = eventosTodos.filter(entra);
        const eventosAgenda = eventos.filter(e => e.pendienteId == null);

        // Lo más antiguo que hay, para "todo el historial".
        let minimo = null;
        for (const f of fichas) for (const t of [f.alta, f.inicio]) if (t != null && (minimo == null || t < minimo)) minimo = t;
        const p = resolverPeriodo(opciones.periodo, ahora, opciones.desde, opciones.hasta, minimo);
        const pAnt = periodoAnterior(p);

        // ---- Actividad por expediente ----
        const ultima = new Map();
        const proximo = new Map();
        const tocar = (id, ms) => {
            if (!porId.has(id) || ms == null || ms > ahora) return;
            if (!ultima.has(id) || ms > ultima.get(id)) ultima.set(id, ms);
        };
        for (const f of sel) { tocar(f.id, aMs(f.exp.fechaActualizacion)); tocar(f.id, f.alta); }
        for (const n of notasTodas) { tocar(n.expedienteId, aMs(n.fechaActualizacion)); tocar(n.expedienteId, aMs(n.fechaCreacion)); }
        for (const h of historialTodo) tocar(h.expedienteId, aMs(h.fecha));
        for (const x of pendientesTodos) {
            tocar(x.expedienteId, aMs(x.fechaCreacion));
            tocar(x.expedienteId, aMs(x.fechaCompletado));
        }
        for (const ev of eventosTodos) {
            const t = aMs(ev.fechaInicio);
            if (t == null || !porId.has(ev.expedienteId)) continue;
            if (t <= ahora) tocar(ev.expedienteId, t);
            else if (!proximo.has(ev.expedienteId) || t < proximo.get(ev.expedienteId).ms) {
                proximo.set(ev.expedienteId, { ms: t, titulo: ev.titulo || '', tipo: ev.tipo || 'otro' });
            }
        }

        const activos = sel.filter(f => !f.archivado);
        const cerradosEn = per => sel.filter(f => f.archivado && dentro(f.cierre, per));
        const nuevosEn = per => sel.filter(f => dentro(f.alta, per));
        const cerrados = cerradosEn(p);
        const nuevos = nuevosEn(p);
        const duraciones = cerrados.map(f => f.inicio != null && f.cierre != null ? Math.max(0, (f.cierre - f.inicio) / DIA_MS) : null)
            .filter(n => n != null);

        const estancados = activos.filter(f => {
            const u = ultima.get(f.id);
            return (u == null || (ahora - u) / DIA_MS >= DIAS_SIN_MOVIMIENTO) && !proximo.has(f.id);
        });
        const esEstancado = new Set(estancados);

        // ---- Pendientes ----
        const finHoy = finDelDia(ahora);
        const abiertos = pendientes.filter(x => !x.completado);
        const venceMs = x => {
            const t = aMs(x.fechaLimite);
            if (t == null) return null;
            // Uno de "todo el día" vence al terminar ese día, no a medianoche.
            return x.todoElDia !== false ? finDelDia(t) : t;
        };
        const vencidos = abiertos.filter(x => { const v = venceMs(x); return v != null && v < ahora; });
        const esVencido = new Set(vencidos);
        const estaSemana = abiertos.filter(x => { const v = venceMs(x); return v != null && v >= ahora && v <= finHoy + 7 * DIA_MS; });
        const masAdelante = abiertos.filter(x => { const v = venceMs(x); return v != null && v > finHoy + 7 * DIA_MS; });
        const sinFecha = abiertos.filter(x => venceMs(x) == null);
        const completadosEn = per => pendientes.filter(x => x.completado && dentro(aMs(x.fechaCompletado), per));
        const completados = completadosEn(p);
        const conFecha = completados.filter(x => venceMs(x) != null);
        const aTiempo = conFecha.filter(x => aMs(x.fechaCompletado) <= venceMs(x));
        const resolucion = completados.map(x => {
            const a = aMs(x.fechaCreacion), b = aMs(x.fechaCompletado);
            return a != null && b != null ? Math.max(0, (b - a) / DIA_MS) : null;
        }).filter(n => n != null);

        // ---- Agenda ----
        const audienciasProximas = eventosAgenda.filter(e => {
            const t = aMs(e.fechaInicio);
            return e.tipo === 'audiencia' && t != null && t >= ahora && t <= ahora + DIAS_AUDIENCIAS_PROXIMAS * DIA_MS;
        });

        // ---- Resultados ----
        const conResultado = cerrados.filter(f => f.exp.resultado);
        const favorables = conResultado.filter(f => RESULTADOS_FAVORABLES.has(f.exp.resultado));

        const kpis = {
            activos: activos.length,
            estancados: estancados.length,
            nuevos: { valor: nuevos.length, anterior: pAnt ? nuevosEn(pAnt).length : null },
            cerrados: {
                valor: cerrados.length, anterior: pAnt ? cerradosEn(pAnt).length : null,
                concluidos: cerrados.filter(f => f.exp.motivoArchivo === 'concluido').length
            },
            duracionMediana: mediana(duraciones),
            duracionPromedio: promedio(duraciones),
            pendientesAbiertos: abiertos.length,
            pendientesVencidos: vencidos.length,
            cumplimiento: { aTiempo: aTiempo.length, total: conFecha.length, pct: conFecha.length ? aTiempo.length / conFecha.length : null },
            audienciasProximas: audienciasProximas.length,
            favorables: { favorables: favorables.length, conResultado: conResultado.length, pct: conResultado.length ? favorables.length / conResultado.length : null }
        };

        // ---- Tendencia: altas y cierres por mes ----
        const meses = mesesDeTendencia(p);
        const indiceMes = new Map(meses.map((m, i) => [m.clave, i]));
        const tendencia = meses.map(m => ({ clave: m.clave, ms: m.ms, nuevos: 0, cerrados: 0 }));
        for (const f of sel) {
            if (f.alta != null && indiceMes.has(claveMes(f.alta))) tendencia[indiceMes.get(claveMes(f.alta))].nuevos++;
            if (f.cierre != null && indiceMes.has(claveMes(f.cierre))) tendencia[indiceMes.get(claveMes(f.cierre))].cerrados++;
        }

        // ---- Antigüedad de los activos ----
        const antiguedad = TRAMOS_ANTIGUEDAD.map(t => ({ clave: t.clave, etiqueta: t.etiqueta, valor: 0 }));
        for (const f of activos) {
            const dias = f.inicio != null ? (ahora - f.inicio) / DIA_MS : 0;
            const i = TRAMOS_ANTIGUEDAD.findIndex(t => dias < t.hasta);
            antiguedad[i === -1 ? antiguedad.length - 1 : i].valor++;
        }

        // ---- Tablas por dimensión ----
        const porDimension = (campo, etiquetas) => {
            const filas = new Map();
            for (const f of sel) {
                const k = f[campo];
                if (!filas.has(k)) filas.set(k, { clave: k, etiqueta: (etiquetas && etiquetas[k]) || k, activos: 0, nuevos: 0, cerrados: 0, total: 0, duraciones: [] });
                const fila = filas.get(k);
                fila.total++;
                if (!f.archivado) fila.activos++;
                if (dentro(f.alta, p)) fila.nuevos++;
                if (f.archivado && dentro(f.cierre, p)) {
                    fila.cerrados++;
                    if (f.inicio != null) fila.duraciones.push(Math.max(0, (f.cierre - f.inicio) / DIA_MS));
                }
            }
            return Array.from(filas.values()).map(fila => {
                const { duraciones: ds, ...resto } = fila;
                return { ...resto, duracionMediana: mediana(ds), duracionPromedio: promedio(ds), duracionMaxima: ds.length ? Math.max(...ds) : null };
            }).sort((a, b) => b.activos - a.activos || b.total - a.total || String(a.etiqueta).localeCompare(String(b.etiqueta), 'es'));
        };

        const porJuzgado = (() => {
            const filas = new Map();
            for (const f of sel) {
                const k = String(f.exp.juzgado || 'Sin juzgado').trim() || 'Sin juzgado';
                if (!filas.has(k)) filas.set(k, { clave: k, etiqueta: k, institucion: INSTITUCIONES[f.institucion], activos: 0, nuevos: 0, cerrados: 0, total: 0 });
                const fila = filas.get(k);
                fila.total++;
                if (!f.archivado) fila.activos++;
                if (dentro(f.alta, p)) fila.nuevos++;
                if (f.archivado && dentro(f.cierre, p)) fila.cerrados++;
            }
            return Array.from(filas.values()).sort((a, b) => b.activos - a.activos || b.total - a.total);
        })();

        // ---- Clientes y responsables: la carga de trabajo de cada quien ----
        const cargaPor = (campo) => {
            const filas = new Map();
            const fila = k => {
                if (!filas.has(k)) filas.set(k, { clave: k, etiqueta: k, activos: 0, cerrados: 0, total: 0, pendientesAbiertos: 0, vencidos: 0, audienciasProximas: 0, ultimaActividad: null });
                return filas.get(k);
            };
            for (const f of sel) {
                const r = fila(f[campo]);
                r.total++;
                if (!f.archivado) r.activos++;
                if (f.archivado && dentro(f.cierre, p)) r.cerrados++;
                const u = ultima.get(f.id);
                if (u != null && (r.ultimaActividad == null || u > r.ultimaActividad)) r.ultimaActividad = u;
            }
            for (const x of abiertos) {
                const f = porId.get(x.expedienteId);
                if (!f) continue;
                const r = fila(f[campo]);
                r.pendientesAbiertos++;
                if (esVencido.has(x)) r.vencidos++;
            }
            for (const e of audienciasProximas) {
                const f = porId.get(e.expedienteId);
                if (f) fila(f[campo]).audienciasProximas++;
            }
            return Array.from(filas.values()).sort((a, b) =>
                (a.clave === SIN_CLIENTE || a.clave === SIN_RESPONSABLE) - (b.clave === SIN_CLIENTE || b.clave === SIN_RESPONSABLE) ||
                b.activos - a.activos || b.pendientesAbiertos - a.pendientesAbiertos || a.etiqueta.localeCompare(b.etiqueta, 'es'));
        };

        // ---- Expedientes que piden atención ----
        const sinMovimiento = activos.map(f => {
            const u = ultima.get(f.id);
            const prox = proximo.get(f.id);
            return {
                id: f.id, expediente: nombreExpediente(f.exp), cliente: f.cliente === SIN_CLIENTE ? '' : f.cliente,
                responsable: f.responsable === SIN_RESPONSABLE ? '' : f.responsable, juzgado: f.exp.juzgado || '',
                ultimaActividad: u != null ? u : null, dias: u != null ? Math.floor((ahora - u) / DIA_MS) : null,
                proximo: prox ? prox.ms : null, estancado: esEstancado.has(f)
            };
        }).filter(r => r.estancado).sort((a, b) => (b.dias == null) - (a.dias == null) || b.dias - a.dias);

        const pendientesPorExpediente = (() => {
            const filas = new Map();
            for (const x of abiertos) {
                const f = porId.get(x.expedienteId);
                if (!f) continue;
                if (!filas.has(f.id)) filas.set(f.id, { id: f.id, expediente: nombreExpediente(f.exp), cliente: f.cliente === SIN_CLIENTE ? '' : f.cliente, abiertos: 0, vencidos: 0, proximoVence: null });
                const r = filas.get(f.id);
                r.abiertos++;
                if (esVencido.has(x)) r.vencidos++;
                const v = venceMs(x);
                if (v != null && (r.proximoVence == null || v < r.proximoVence)) r.proximoVence = v;
            }
            return Array.from(filas.values()).sort((a, b) => b.vencidos - a.vencidos || b.abiertos - a.abiertos);
        })();

        const porPrioridad = Object.keys(PRIORIDADES).map(k => ({
            clave: k, etiqueta: PRIORIDADES[k],
            abiertos: abiertos.filter(x => (x.prioridad || '') === k).length,
            vencidos: vencidos.filter(x => (x.prioridad || '') === k).length,
            completados: completados.filter(x => (x.prioridad || '') === k).length
        }));

        // ---- Agenda ----
        const enPeriodo = eventosAgenda.filter(e => dentro(aMs(e.fechaInicio), p));
        const eventosPorTipo = Object.keys(TIPOS_EVENTO).map(k => ({
            clave: k, etiqueta: TIPOS_EVENTO[k], valor: enPeriodo.filter(e => (TIPOS_EVENTO[e.tipo] ? e.tipo : 'otro') === k).length
        }));
        const lunes = lunesDe(ahora);
        const semanas = [];
        for (let i = 0; i < SEMANAS_AGENDA; i++) {
            const desde = new Date(new Date(lunes).getFullYear(), new Date(lunes).getMonth(), new Date(lunes).getDate() + 7 * i).getTime();
            const hasta = new Date(new Date(desde).getFullYear(), new Date(desde).getMonth(), new Date(desde).getDate() + 7).getTime() - 1;
            const de = eventosAgenda.filter(e => { const t = aMs(e.fechaInicio); return t != null && t >= desde && t <= hasta; });
            semanas.push({
                desde, audiencias: de.filter(e => e.tipo === 'audiencia').length,
                vencimientos: de.filter(e => e.tipo === 'vencimiento').length,
                pendientes: abiertos.filter(x => { const v = venceMs(x); return v != null && v >= desde && v <= hasta; }).length
            });
        }

        // ---- Resultados ----
        const resultados = RESULTADOS.map(r => ({ clave: r.clave, etiqueta: r.etiqueta, valor: cerrados.filter(f => f.exp.resultado === r.clave).length }))
            .concat([{ clave: '', etiqueta: 'Sin registrar', valor: cerrados.filter(f => !RESULTADOS.some(r => r.clave === f.exp.resultado)).length }]);
        const motivos = Object.keys(MOTIVOS).map(k => ({
            clave: k, etiqueta: MOTIVOS[k],
            valor: cerrados.filter(f => (MOTIVOS[f.exp.motivoArchivo] ? f.exp.motivoArchivo : 'otro') === k).length
        }));
        const resultadosPorMateria = (() => {
            const filas = new Map();
            for (const f of cerrados) {
                if (!filas.has(f.materia)) filas.set(f.materia, { clave: f.materia, etiqueta: f.materia, cerrados: 0, conResultado: 0, favorables: 0, desfavorables: 0 });
                const r = filas.get(f.materia);
                r.cerrados++;
                if (f.exp.resultado) r.conResultado++;
                if (RESULTADOS_FAVORABLES.has(f.exp.resultado)) r.favorables++;
                if (f.exp.resultado === 'desfavorable') r.desfavorables++;
            }
            return Array.from(filas.values()).map(r => ({ ...r, pct: r.conResultado ? r.favorables / r.conResultado : null }))
                .sort((a, b) => b.cerrados - a.cerrados);
        })();

        return {
            ahora,
            periodo: p,
            periodoAnterior: pAnt,
            filtros, opcionesFiltro,
            totales: { expedientes: sel.length, archivados: sel.length - activos.length },
            kpis,
            tendencia,
            antiguedad,
            porMateria: porDimension('materia'),
            porTipo: porDimension('tipo'),
            porInstitucion: porDimension('institucion', INSTITUCIONES),
            porJuzgado,
            clientes: cargaPor('cliente'),
            responsables: cargaPor('responsable'),
            sinMovimiento,
            pendientes: {
                abiertos: abiertos.length, vencidos: vencidos.length, estaSemana: estaSemana.length,
                masAdelante: masAdelante.length, sinFecha: sinFecha.length,
                completados: completados.length, completadosAnterior: pAnt ? completadosEn(pAnt).length : null,
                resolucionMediana: mediana(resolucion), resolucionPromedio: promedio(resolucion),
                aTiempo: aTiempo.length, conFecha: conFecha.length,
                porPrioridad, porExpediente: pendientesPorExpediente
            },
            agenda: { porTipo: eventosPorTipo, semanas, enPeriodo: enPeriodo.length },
            resultados, motivos, resultadosPorMateria
        };
    }

    /** "12 días", "3.4 meses", "2.1 años": la unidad que se lee mejor. */
    function textoDuracion(dias) {
        if (dias == null || !Number.isFinite(dias)) return '—';
        if (dias < 60) {
            const n = Math.round(dias);
            return n + (n === 1 ? ' día' : ' días');
        }
        const meses = dias / DIAS_POR_MES;
        if (meses < 24) return meses.toLocaleString('es-MX', { maximumFractionDigits: 1 }) + ' meses';
        return (meses / 12).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + ' años';
    }

    const Motor = {
        PERIODOS, TRAMOS_ANTIGUEDAD, RESULTADOS, MOTIVOS, INSTITUCIONES, TIPOS_EVENTO, PRIORIDADES,
        DIAS_SIN_MOVIMIENTO, DIAS_AUDIENCIAS_PROXIMAS, SIN_CLIENTE, SIN_RESPONSABLE, SIN_TIPO,
        calcular, materiaDe, tipoAsuntoDe, inicioDe, resolverPeriodo, periodoAnterior, mediana, promedio,
        textoDuracion, aMs
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
    if (typeof document === 'undefined') return;

    // ==================== INTERFAZ ====================

    const CLAVE_FILTROS = 'estadisticas_filtros';   // localStorage: lo último que se eligió
    const FILAS_VISIBLES = 12;

    const ui = {
        filtros: { periodo: '12m', desde: '', hasta: '', institucion: '', materia: '', cliente: '', responsable: '' },
        orden: {},            // tabla → { col, dir }
        expandidas: new Set(),
        comoTabla: new Set(), // gráficas que se están viendo como tabla
        tarjetas: new Map(),  // id → { titulo, columnas, filas } para tabla y CSV
        informe: null,
        pintando: false,
        pendiente: false
    };

    try {
        const guardados = JSON.parse(localStorage.getItem(CLAVE_FILTROS) || 'null');
        if (guardados && typeof guardados === 'object') Object.assign(ui.filtros, guardados);
    } catch (e) { /* sin almacenamiento: se usan los de siempre */ }

    function guardarFiltros() {
        try { localStorage.setItem(CLAVE_FILTROS, JSON.stringify(ui.filtros)); } catch (e) { /* modo privado */ }
    }

    function esc(t) {
        return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    const entero = n => (n == null ? '—' : Number(n).toLocaleString('es-MX'));
    const pct = n => (n == null ? '—' : Math.round(n * 100) + '%');

    function fecha(ms) {
        if (ms == null) return '—';
        return new Date(ms).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function mesCorto(ms, conAnio) {
        const d = new Date(ms);
        const m = d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '');
        return conAnio ? m + ' ' + String(d.getFullYear()).slice(2) : m;
    }

    function mesLargo(ms) {
        const t = new Date(ms).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
        return t.charAt(0).toUpperCase() + t.slice(1);
    }

    function ymd(ms) {
        const d = new Date(ms);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function raiz() { return document.getElementById('est-raiz'); }

    function visible() {
        const pagina = document.getElementById('page-estadisticas');
        return !!pagina && pagina.classList.contains('active');
    }

    async function cargarDatos() {
        const seguro = (fn) => (typeof fn === 'function' ? fn().catch(() => []) : Promise.resolve([]));
        const [activos, archivados, pendientes, eventos, notas, historial] = await Promise.all([
            seguro(global.obtenerExpedientes), seguro(global.obtenerExpedientesArchivados),
            seguro(global.obtenerPendientes), seguro(global.obtenerEventos),
            seguro(global.obtenerNotas), seguro(global.obtenerTodoHistorial)
        ]);
        return { expedientes: [...activos, ...archivados], pendientes, eventos, notas, historial };
    }

    /** La entrada desde el menú. */
    async function preparar() {
        const r = raiz();
        if (!r) return;
        if (!r.dataset.listo) {
            r.dataset.listo = '1';
            r.addEventListener('change', alCambiar);
            r.addEventListener('click', alHacerClic);
            r.addEventListener('pointerover', mostrarTip);
            r.addEventListener('pointerout', ocultarTip);
            r.addEventListener('focusin', mostrarTip);
            r.addEventListener('focusout', ocultarTip);
        }
        await pintar();
    }

    /** Tras cualquier cambio en los datos: repinta solo si se está viendo. */
    async function refrescarSiVisible() {
        if (visible()) await pintar();
    }

    async function pintar() {
        // Si llega otro aviso mientras se pinta, se repinta una vez más al
        // terminar, en vez de pintar dos veces a la vez.
        if (ui.pintando) { ui.pendiente = true; return; }
        ui.pintando = true;
        const r = raiz();
        // Lo que se va a repintar puede ser la marca bajo el ratón: su
        // descripción no debe quedarse flotando sin dueño.
        ocultarTipYa();
        try {
            if (r) r.classList.add('est-cargando');
            const datos = await cargarDatos();
            ui.informe = calcular(datos, { ...ui.filtros });
            // Un filtro que ya no existe (se borró ese cliente) no deja la página en blanco.
            const op = ui.informe.opcionesFiltro;
            let ajustado = false;
            for (const [campo, lista] of [['institucion', op.instituciones], ['materia', op.materias], ['cliente', op.clientes], ['responsable', op.responsables]]) {
                if (ui.filtros[campo] && !lista.includes(ui.filtros[campo])) { ui.filtros[campo] = ''; ajustado = true; }
            }
            if (ajustado) ui.informe = calcular(datos, { ...ui.filtros });
            if (r) r.innerHTML = vistaCompleta(ui.informe);
        } catch (e) {
            console.error('[ESTADÍSTICAS]', e);
            if (r) r.innerHTML = '<p class="est-vacio">No se pudieron calcular las estadísticas: ' + esc(e.message || e) + '</p>';
        } finally {
            if (r) r.classList.remove('est-cargando');
            ui.pintando = false;
            if (ui.pendiente) { ui.pendiente = false; pintar(); }
        }
    }

    // ---- La página ----

    function vistaCompleta(inf) {
        ui.tarjetas.clear();
        const k = inf.kpis;
        const p = inf.periodo;
        const hayDatos = inf.totales.expedientes > 0;

        let html = vistaFiltros(inf);
        html += '<p class="est-resumen">Del <strong>' + esc(fecha(p.desde)) + '</strong> al <strong>' + esc(fecha(p.hasta)) + '</strong> · ' +
            esc(entero(inf.totales.expedientes)) + ' expedientes en el análisis (' + esc(entero(k.activos)) + ' activos, ' +
            esc(entero(inf.totales.archivados)) + ' archivados). Los tiempos cuentan desde el inicio del asunto o, si no se capturó, desde su alta aquí.</p>';

        if (!hayDatos) {
            return html + '<div class="est-vacio"><p><strong>No hay expedientes con estos filtros.</strong></p>' +
                '<p>Cuando des de alta expedientes, aquí verás tiempos, resultados, tipos de asunto, clientes y pendientes.</p></div>';
        }

        html += '<nav class="est-indice" aria-label="Secciones">' + [
            ['tiempos', '⏱️ Tiempos'], ['flujo', '📈 Flujo'], ['tipos', '🏷️ Tipos de asunto'], ['resultados', '🏁 Resultados'],
            ['clientes', '👤 Clientes'], ['responsables', '🧑‍💼 Responsables'], ['pendientes', '✅ Pendientes'], ['agenda', '📅 Agenda']
        ].map(([id, t]) => '<a href="#est-' + id + '" data-acc="ir" data-destino="est-' + id + '">' + t + '</a>').join('') + '</nav>';

        html += '<div class="est-kpis">' +
            tile('Expedientes activos', entero(k.activos), k.estancados
                ? entero(k.estancados) + ' sin movimiento en ' + DIAS_SIN_MOVIMIENTO + ' días' : 'Todos con movimiento reciente') +
            tile('Nuevos en el periodo', entero(k.nuevos.valor), 'altas', delta(k.nuevos.valor, k.nuevos.anterior, 0)) +
            tile('Cerrados en el periodo', entero(k.cerrados.valor), entero(k.cerrados.concluidos) + ' concluidos', delta(k.cerrados.valor, k.cerrados.anterior, 1)) +
            tile('Duración típica', textoDuracion(k.duracionMediana), k.duracionPromedio != null
                ? 'mediana de los cerrados · promedio ' + textoDuracion(k.duracionPromedio) : 'sin cerrados en el periodo') +
            tile('Pendientes abiertos', entero(k.pendientesAbiertos), k.pendientesVencidos ? '⚠️ ' + entero(k.pendientesVencidos) + ' vencidos' : 'ninguno vencido') +
            tile('Pendientes a tiempo', pct(k.cumplimiento.pct), k.cumplimiento.total
                ? entero(k.cumplimiento.aTiempo) + ' de ' + entero(k.cumplimiento.total) + ' con fecha, terminados en el periodo' : 'sin pendientes con fecha terminados') +
            tile('Audiencias próximas', entero(k.audienciasProximas), 'en los próximos ' + DIAS_AUDIENCIAS_PROXIMAS + ' días') +
            tile('Resultados favorables', pct(k.favorables.pct), k.favorables.conResultado
                ? 'favorable o parcial, de ' + entero(k.favorables.conResultado) + ' con resultado' : 'registra el resultado al archivar') +
        '</div>';

        html += seccion('tiempos', '⏱️ Tiempos', 'Cuánto duran los asuntos y cuáles llevan tiempo quietos.',
            tarjeta('antiguedad', 'Antigüedad de los expedientes activos', 'Desde el inicio del asunto hasta hoy', 'barras',
                [{ clave: 'etiqueta', titulo: 'Antigüedad', tipo: 'texto' }, { clave: 'valor', titulo: 'Expedientes', tipo: 'entero' }],
                inf.antiguedad, () => barras(inf.antiguedad.map((f, i) => ({ ...f, clase: 'est-o' + (i + 1) })), 'expedientes')) +
            tarjeta('duracion', 'Duración de los cerrados por materia', 'Asuntos cerrados en el periodo', 'tabla',
                [{ clave: 'etiqueta', titulo: 'Materia', tipo: 'texto' }, { clave: 'cerrados', titulo: 'Cerrados', tipo: 'entero' },
                 { clave: 'duracionMediana', titulo: 'Duración típica', tipo: 'dias' }, { clave: 'duracionPromedio', titulo: 'Promedio', tipo: 'dias' },
                 { clave: 'duracionMaxima', titulo: 'La más larga', tipo: 'dias' }],
                inf.porMateria.filter(f => f.cerrados > 0), null, 'Ningún asunto se cerró en el periodo.') +
            tarjeta('sinmov', 'Expedientes sin movimiento', `Activos sin notas, cambios, pendientes ni audiencias en ${DIAS_SIN_MOVIMIENTO} días o más, y sin nada agendado`, 'tabla',
                [{ clave: 'expediente', titulo: 'Expediente', tipo: 'exp' }, { clave: 'cliente', titulo: 'Cliente', tipo: 'texto' },
                 { clave: 'responsable', titulo: 'Responsable', tipo: 'texto' }, { clave: 'juzgado', titulo: 'Juzgado', tipo: 'texto' },
                 { clave: 'dias', titulo: 'Días quieto', tipo: 'entero' }, { clave: 'ultimaActividad', titulo: 'Último movimiento', tipo: 'fecha' }],
                inf.sinMovimiento, null, '✓ Todos los expedientes activos tienen movimiento reciente o algo agendado.', true));

        html += seccion('flujo', '📈 Flujo de trabajo', 'Cuántos asuntos entran y cuántos se cierran cada mes.',
            tarjeta('tendencia', 'Nuevos y cerrados por mes', 'Altas en la app y archivados', 'columnas',
                [{ clave: 'mes', titulo: 'Mes', tipo: 'texto' }, { clave: 'nuevos', titulo: 'Nuevos', tipo: 'entero' }, { clave: 'cerrados', titulo: 'Cerrados', tipo: 'entero' }],
                inf.tendencia.map(t => ({ mes: mesLargo(t.ms), nuevos: t.nuevos, cerrados: t.cerrados })),
                () => columnas(inf.tendencia.map((t, i) => ({ corto: mesCorto(t.ms, i === 0 || new Date(t.ms).getMonth() === 0), largo: mesLargo(t.ms) })),
                    [{ nombre: 'Nuevos', clase: 'est-s1', valores: inf.tendencia.map(t => t.nuevos) },
                     { nombre: 'Cerrados', clase: 'est-s2', valores: inf.tendencia.map(t => t.cerrados) }]), null, true));

        const colsDimension = (titulo) => [
            { clave: 'etiqueta', titulo, tipo: 'texto' }, { clave: 'activos', titulo: 'Activos', tipo: 'entero' },
            { clave: 'nuevos', titulo: 'Nuevos', tipo: 'entero' }, { clave: 'cerrados', titulo: 'Cerrados', tipo: 'entero' },
            { clave: 'total', titulo: 'Total', tipo: 'entero' }, { clave: 'duracionMediana', titulo: 'Duración típica', tipo: 'dias' }];
        html += seccion('tipos', '🏷️ Tipos de asunto', 'Qué clase de asuntos lleva el despacho. Nuevos y cerrados se cuentan en el periodo.',
            tarjeta('materia', 'Expedientes activos por materia', 'La materia sale del juzgado', 'barras', colsDimension('Materia'), inf.porMateria,
                () => barras(inf.porMateria.filter(f => f.activos > 0).map(f => ({ etiqueta: f.etiqueta, valor: f.activos, clase: 'est-s1' })), 'activos'),
                'No hay expedientes activos.') +
            tarjeta('institucion', 'Por institución', '', 'barras', colsDimension('Institución'), inf.porInstitucion,
                () => barras(inf.porInstitucion.map(f => ({ etiqueta: f.etiqueta, valor: f.activos, clase: 'est-s1' })), 'activos')) +
            tarjeta('tipo', 'Por tipo de asunto', 'El que se captura en el expediente (o el del catálogo del PJF)', 'tabla', colsDimension('Tipo de asunto'), inf.porTipo) +
            tarjeta('juzgado', 'Por juzgado u órgano', '', 'tabla',
                [{ clave: 'etiqueta', titulo: 'Juzgado', tipo: 'texto' }, { clave: 'institucion', titulo: 'Institución', tipo: 'texto' },
                 { clave: 'activos', titulo: 'Activos', tipo: 'entero' }, { clave: 'nuevos', titulo: 'Nuevos', tipo: 'entero' },
                 { clave: 'cerrados', titulo: 'Cerrados', tipo: 'entero' }, { clave: 'total', titulo: 'Total', tipo: 'entero' }], inf.porJuzgado));

        const totalCerrados = inf.resultados.reduce((s, r) => s + r.valor, 0);
        const conPct = filas => filas.map(f => ({ ...f, pct: totalCerrados ? f.valor / totalCerrados : null }));
        html += seccion('resultados', '🏁 Resultados', 'Cómo terminaron los asuntos cerrados en el periodo. El resultado se elige al archivar.',
            tarjeta('resultado', 'Resultado de los cerrados', totalCerrados ? entero(totalCerrados) + ' cerrados en el periodo' : '', 'barras',
                [{ clave: 'etiqueta', titulo: 'Resultado', tipo: 'texto' }, { clave: 'valor', titulo: 'Expedientes', tipo: 'entero' }, { clave: 'pct', titulo: '% de los cerrados', tipo: 'pct' }],
                conPct(inf.resultados), () => barras(conPct(inf.resultados).map(f => ({ ...f, clase: f.clave ? 'est-s1' : 'est-neutro', detalle: pct(f.pct) })), 'expedientes'),
                'Ningún asunto se cerró en el periodo.') +
            tarjeta('motivo', 'Motivo de archivo', '', 'barras',
                [{ clave: 'etiqueta', titulo: 'Motivo', tipo: 'texto' }, { clave: 'valor', titulo: 'Expedientes', tipo: 'entero' }, { clave: 'pct', titulo: '% de los cerrados', tipo: 'pct' }],
                conPct(inf.motivos), () => barras(conPct(inf.motivos).map(f => ({ ...f, clase: 'est-s1', detalle: pct(f.pct) })), 'expedientes'),
                'Ningún asunto se cerró en el periodo.') +
            tarjeta('resmateria', 'Resultados por materia', 'Favorables = favorable o parcialmente favorable', 'tabla',
                [{ clave: 'etiqueta', titulo: 'Materia', tipo: 'texto' }, { clave: 'cerrados', titulo: 'Cerrados', tipo: 'entero' },
                 { clave: 'conResultado', titulo: 'Con resultado', tipo: 'entero' }, { clave: 'favorables', titulo: 'Favorables', tipo: 'entero' },
                 { clave: 'desfavorables', titulo: 'Desfavorables', tipo: 'entero' }, { clave: 'pct', titulo: '% favorable', tipo: 'pct' }],
                inf.resultadosPorMateria, null, 'Ningún asunto se cerró en el periodo.', true));

        const colsCarga = (titulo) => [
            { clave: 'etiqueta', titulo, tipo: 'texto' }, { clave: 'activos', titulo: 'Activos', tipo: 'entero' },
            { clave: 'cerrados', titulo: 'Cerrados', tipo: 'entero' }, { clave: 'pendientesAbiertos', titulo: 'Pendientes', tipo: 'entero' },
            { clave: 'vencidos', titulo: 'Vencidos', tipo: 'entero' }, { clave: 'audienciasProximas', titulo: `Audiencias ${DIAS_AUDIENCIAS_PROXIMAS} d`, tipo: 'entero' },
            { clave: 'ultimaActividad', titulo: 'Último movimiento', tipo: 'fecha' }];
        const sinClientes = inf.clientes.every(f => f.clave === SIN_CLIENTE);
        html += seccion('clientes', '👤 Clientes', 'La carga de cada cliente. Cerrados, en el periodo; lo demás, a hoy.',
            (sinClientes ? '<p class="est-aviso">Aún no hay clientes capturados. Agrégalos en cada expediente (campo <strong>Cliente</strong> al editarlo) para ver esta tabla por cliente.</p>' : '') +
            tarjeta('clientes', 'Expedientes y pendientes por cliente', '', 'tabla', colsCarga('Cliente'), inf.clientes, null, '', true));
        const sinResp = inf.responsables.every(f => f.clave === SIN_RESPONSABLE);
        html += seccion('responsables', '🧑‍💼 Responsables', 'La carga de trabajo de cada abogado.',
            (sinResp ? '<p class="est-aviso">Aún no hay responsables capturados. Indica el abogado a cargo en cada expediente (campo <strong>Responsable</strong>).</p>' : '') +
            tarjeta('responsables', 'Carga por responsable', '', 'tabla', colsCarga('Responsable'), inf.responsables, null, '', true));

        const pe = inf.pendientes;
        const estadoPendientes = [
            { clave: 'vencidos', etiqueta: '⚠️ Vencidos', valor: pe.vencidos, clase: 'est-critico' },
            { clave: 'semana', etiqueta: '⏳ Vencen en 7 días', valor: pe.estaSemana, clase: 'est-aviso' },
            { clave: 'despues', etiqueta: '📅 Más adelante', valor: pe.masAdelante, clase: 'est-bien' },
            { clave: 'sinfecha', etiqueta: '— Sin fecha', valor: pe.sinFecha, clase: 'est-neutro' }
        ];
        html += seccion('pendientes', '✅ Pendientes', 'Lo que hay por hacer hoy y cómo se cumplió en el periodo.',
            '<div class="est-kpis est-kpis-chicos">' +
                tile('Terminados en el periodo', entero(pe.completados), '', delta(pe.completados, pe.completadosAnterior, 1)) +
                tile('Tiempo típico para terminar', textoDuracion(pe.resolucionMediana), pe.resolucionPromedio != null ? 'mediana · promedio ' + textoDuracion(pe.resolucionPromedio) : 'sin terminados en el periodo') +
                tile('Terminados a tiempo', pct(pe.conFecha ? pe.aTiempo / pe.conFecha : null), pe.conFecha ? entero(pe.aTiempo) + ' de ' + entero(pe.conFecha) + ' con fecha límite' : 'sin terminados con fecha') +
            '</div>' +
            tarjeta('pendestado', 'Pendientes abiertos por vencimiento', entero(pe.abiertos) + ' abiertos', 'barras',
                [{ clave: 'etiqueta', titulo: 'Estado', tipo: 'texto' }, { clave: 'valor', titulo: 'Pendientes', tipo: 'entero' }],
                estadoPendientes, () => barras(estadoPendientes, 'pendientes'), 'No hay pendientes abiertos.') +
            tarjeta('prioridad', 'Por prioridad', '', 'tabla',
                [{ clave: 'etiqueta', titulo: 'Prioridad', tipo: 'texto' }, { clave: 'abiertos', titulo: 'Abiertos', tipo: 'entero' },
                 { clave: 'vencidos', titulo: 'Vencidos', tipo: 'entero' }, { clave: 'completados', titulo: 'Terminados', tipo: 'entero' }], pe.porPrioridad) +
            tarjeta('pendexp', 'Expedientes con más pendientes', '', 'tabla',
                [{ clave: 'expediente', titulo: 'Expediente', tipo: 'exp' }, { clave: 'cliente', titulo: 'Cliente', tipo: 'texto' },
                 { clave: 'abiertos', titulo: 'Abiertos', tipo: 'entero' }, { clave: 'vencidos', titulo: 'Vencidos', tipo: 'entero' },
                 { clave: 'proximoVence', titulo: 'Próximo vencimiento', tipo: 'fecha' }], pe.porExpediente, null, 'No hay pendientes abiertos ligados a expedientes.', true));

        const ag = inf.agenda;
        html += seccion('agenda', '📅 Agenda', 'La carga de las próximas semanas, para repartir el trabajo.',
            tarjeta('semanas', `Próximas ${ag.semanas.length} semanas`, 'Audiencias y vencimientos del calendario, y pendientes con fecha', 'columnas',
                [{ clave: 'semana', titulo: 'Semana del', tipo: 'texto' }, { clave: 'audiencias', titulo: 'Audiencias', tipo: 'entero' },
                 { clave: 'vencimientos', titulo: 'Vencimientos', tipo: 'entero' }, { clave: 'pendientes', titulo: 'Pendientes con fecha', tipo: 'entero' }],
                ag.semanas.map(s => ({ semana: fecha(s.desde), audiencias: s.audiencias, vencimientos: s.vencimientos, pendientes: s.pendientes })),
                () => columnas(ag.semanas.map(s => ({ corto: new Date(s.desde).getDate() + ' ' + mesCorto(s.desde), largo: 'Semana del ' + fecha(s.desde) })),
                    [{ nombre: 'Audiencias', clase: 'est-s1', valores: ag.semanas.map(s => s.audiencias) },
                     { nombre: 'Vencimientos', clase: 'est-s2', valores: ag.semanas.map(s => s.vencimientos) }]), null, true) +
            tarjeta('eventostipo', 'Eventos del periodo por tipo', entero(ag.enPeriodo) + ' en el periodo', 'barras',
                [{ clave: 'etiqueta', titulo: 'Tipo', tipo: 'texto' }, { clave: 'valor', titulo: 'Eventos', tipo: 'entero' }],
                ag.porTipo, () => barras(ag.porTipo.map(f => ({ ...f, clase: 'est-s1' })), 'eventos'), 'No hay eventos en el periodo.'));
        return html;
    }

    function vistaFiltros(inf) {
        const f = ui.filtros;
        const op = inf.opcionesFiltro;
        const opciones = (lista, actual, etiquetas, todos) => '<option value="">' + todos + '</option>' + lista.map(v =>
            '<option value="' + esc(v) + '"' + (v === actual ? ' selected' : '') + '>' + esc((etiquetas && etiquetas[v]) || v) + '</option>').join('');
        const rango = f.periodo === 'rango';
        return '<div class="est-filtros" role="group" aria-label="Filtros de las estadísticas">' +
            '<label class="est-campo">Periodo<select data-filtro="periodo">' + PERIODOS.map(x =>
                '<option value="' + x.clave + '"' + (x.clave === inf.periodo.preset ? ' selected' : '') + '>' + x.etiqueta + '</option>').join('') + '</select></label>' +
            (rango ? '<label class="est-campo">Desde<input type="date" data-filtro="desde" value="' + esc(f.desde || ymd(inf.periodo.desde)) + '"></label>' +
                     '<label class="est-campo">Hasta<input type="date" data-filtro="hasta" value="' + esc(f.hasta || ymd(inf.periodo.hasta)) + '"></label>' : '') +
            '<label class="est-campo">Institución<select data-filtro="institucion">' + opciones(op.instituciones, f.institucion, INSTITUCIONES, 'Todas') + '</select></label>' +
            '<label class="est-campo">Materia<select data-filtro="materia">' + opciones(op.materias, f.materia, null, 'Todas') + '</select></label>' +
            '<label class="est-campo">Cliente<select data-filtro="cliente">' + opciones(op.clientes, f.cliente, null, 'Todos') + '</select></label>' +
            '<label class="est-campo">Responsable<select data-filtro="responsable">' + opciones(op.responsables, f.responsable, null, 'Todos') + '</select></label>' +
            '<div class="est-filtros-btns">' +
                (f.institucion || f.materia || f.cliente || f.responsable ? '<button type="button" class="btn btn-sm btn-secondary" data-acc="limpiar">Quitar filtros</button>' : '') +
                '<button type="button" class="btn btn-sm btn-secondary" data-acc="csv-todo" title="Todas las tablas en un archivo">⬇️ Exportar todo</button>' +
            '</div></div>';
    }

    function tile(etiqueta, valor, detalle, deltaHTML) {
        return '<div class="est-kpi"><span class="est-kpi-etiqueta">' + esc(etiqueta) + '</span>' +
            '<span class="est-kpi-valor">' + esc(valor) + '</span>' +
            (deltaHTML || '') +
            (detalle ? '<span class="est-kpi-detalle">' + esc(detalle) + '</span>' : '') + '</div>';
    }

    /**
     * Cambio contra el periodo anterior del mismo largo. bueno: 1 si subir es
     * bueno (cerrados), -1 si es malo, 0 si no es ni lo uno ni lo otro (altas).
     */
    function delta(actual, anterior, bueno) {
        if (anterior == null) return '';
        const d = actual - anterior;
        if (!d) return '<span class="est-delta">= igual que el periodo anterior</span>';
        const clase = !bueno ? '' : (d > 0) === (bueno > 0) ? ' est-delta-bien' : ' est-delta-mal';
        return '<span class="est-delta' + clase + '">' + (d > 0 ? '▲ ' : '▼ ') + entero(Math.abs(d)) + ' vs periodo anterior (' + entero(anterior) + ')</span>';
    }

    function seccion(id, titulo, sub, contenido) {
        return '<section class="est-seccion" id="est-' + id + '"><header class="est-seccion-cab"><h3>' + titulo + '</h3>' +
            (sub ? '<p>' + esc(sub) + '</p>' : '') + '</header><div class="est-rejilla">' + contenido + '</div></section>';
    }

    /**
     * Una tarjeta con gráfica o tabla. Toda gráfica puede verse como tabla
     * (los valores nunca dependen solo del color ni del ratón) y toda tabla
     * se puede exportar.
     */
    function tarjeta(id, titulo, sub, forma, columnas, filas, grafica, vacio, ancha) {
        ui.tarjetas.set(id, { titulo, columnas, filas });
        const conGrafica = forma !== 'tabla' && typeof grafica === 'function';
        const comoTabla = !conGrafica || ui.comoTabla.has(id);
        const hayFilas = filas.length && (forma === 'tabla' || filas.some(f => columnas.slice(1).some(c => Number(f[c.clave]) > 0)));
        let cuerpo;
        if (!hayFilas && vacio) cuerpo = '<p class="est-vacio">' + esc(vacio) + '</p>';
        else cuerpo = comoTabla ? tabla(id, columnas, filas) : grafica();
        // Una tabla de más de tres columnas no cabe en media fila sin partir palabras.
        if (comoTabla && columnas.length > 3) ancha = true;
        return '<article class="est-tarjeta' + (ancha ? ' est-ancha' : '') + '" data-tarjeta="' + id + '">' +
            '<header class="est-tarjeta-cab"><div><h4>' + esc(titulo) + '</h4>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' +
            '<div class="est-tarjeta-btns">' +
                (conGrafica ? '<button type="button" class="est-boton" data-acc="alternar" data-tarjeta="' + id + '">' + (comoTabla ? '📊 Gráfica' : '▦ Tabla') + '</button>' : '') +
                '<button type="button" class="est-boton" data-acc="csv" data-tarjeta="' + id + '" title="Descargar en CSV">⬇️ CSV</button>' +
            '</div></header>' +
            '<div class="est-tarjeta-cuerpo">' + cuerpo + '</div></article>';
    }

    // ---- Tablas ----

    function valorCelda(c, f) {
        const v = f[c.clave];
        switch (c.tipo) {
            case 'entero': return entero(v);
            case 'dias': return textoDuracion(v);
            case 'fecha': return v == null ? '—' : fecha(v);
            case 'pct': return pct(v);
            default: return v == null || v === '' ? '—' : String(v);
        }
    }

    function filasOrdenadas(id, columnas, filas) {
        const o = ui.orden[id];
        if (!o) return filas;
        const c = columnas.find(x => x.clave === o.col);
        if (!c) return filas;
        const num = c.tipo !== 'texto' && c.tipo !== 'exp';
        return filas.slice().sort((a, b) => {
            const x = a[c.clave], y = b[c.clave];
            if (x == null && y == null) return 0;
            if (x == null) return 1;   // lo vacío siempre al final
            if (y == null) return -1;
            const r = num ? x - y : String(x).localeCompare(String(y), 'es');
            return o.dir === 'asc' ? r : -r;
        });
    }

    function tabla(id, columnas, filas) {
        const o = ui.orden[id];
        const lista = filasOrdenadas(id, columnas, filas);
        const todas = ui.expandidas.has(id);
        const mostrar = todas ? lista : lista.slice(0, FILAS_VISIBLES);
        const cab = columnas.map(c => {
            const activa = o && o.col === c.clave;
            const num = c.tipo !== 'texto' && c.tipo !== 'exp';
            return '<th scope="col" class="' + (num ? 'est-num' : '') + '"' + (activa ? ' aria-sort="' + (o.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '>' +
                '<button type="button" data-acc="ordenar" data-tarjeta="' + id + '" data-col="' + c.clave + '">' + esc(c.titulo) +
                (activa ? (o.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</button></th>';
        }).join('');
        const cuerpo = mostrar.map(f => '<tr>' + columnas.map(c => {
            const num = c.tipo !== 'texto' && c.tipo !== 'exp';
            if (c.tipo === 'exp' && f.id != null) {
                return '<td><button type="button" class="est-enlace" data-acc="expediente" data-id="' + esc(f.id) + '">' + esc(valorCelda(c, f)) + '</button></td>';
            }
            return '<td' + (num ? ' class="est-num"' : '') + '>' + esc(valorCelda(c, f)) + '</td>';
        }).join('') + '</tr>').join('');
        const mas = lista.length > FILAS_VISIBLES
            ? '<button type="button" class="est-boton est-mas" data-acc="expandir" data-tarjeta="' + id + '">' +
              (todas ? 'Ver menos' : 'Ver los ' + entero(lista.length)) + '</button>' : '';
        return '<div class="est-tabla-marco"><table class="est-tabla"><thead><tr>' + cab + '</tr></thead><tbody>' + cuerpo + '</tbody></table></div>' + mas;
    }

    // ---- Gráficas ----
    // HTML y CSS, sin librerías: barras de 14 px con el extremo redondeado,
    // columnas de 16 px como mucho, rejilla de línea fina, y cada marca con su
    // descripción al pasar el ratón o al llegar con el teclado.

    function tip(titulo, filas) {
        return esc(JSON.stringify({ t: titulo, f: filas }));
    }

    /** Barras horizontales: una serie, cada fila con su valor a la punta. */
    function barras(filas, unidad) {
        const max = Math.max(1, ...filas.map(f => f.valor || 0));
        return '<div class="est-barras" role="list">' + filas.map(f => {
            const ancho = f.valor ? Math.max(1.5, (f.valor / max) * 100) : 0;
            return '<div class="est-barra-fila" role="listitem" tabindex="0" data-tip="' + tip(f.etiqueta, [[unidad, entero(f.valor)]].concat(f.detalle ? [['del total', f.detalle]] : [])) + '">' +
                '<span class="est-barra-etiqueta">' + esc(f.etiqueta) + '</span>' +
                '<span class="est-barra-pista"><span class="est-barra ' + (f.clase || 'est-s1') + '" style="width:' + ancho.toFixed(2) + '%"></span></span>' +
                '<span class="est-barra-valor">' + esc(entero(f.valor)) + (f.detalle ? ' <small>' + esc(f.detalle) + '</small>' : '') + '</span>' +
            '</div>';
        }).join('') + '</div>';
    }

    function tope(max) {
        if (max <= 4) return { max: 4, paso: 1 };
        const crudo = max / 4;
        const base = Math.pow(10, Math.floor(Math.log10(crudo)));
        const paso = [1, 2, 2.5, 5, 10].map(x => x * base).find(x => x >= crudo);
        return { max: paso * 4, paso };
    }

    /** Columnas agrupadas, una o dos series, con eje y rejilla. */
    function columnas(categorias, series) {
        const max = Math.max(0, ...series.flatMap(s => s.valores));
        const t = tope(max);
        const lineas = [];
        for (let v = 0; v <= t.max; v += t.paso) lineas.push(v);
        const ultima = categorias.length - 1;
        const grupos = categorias.map((cat, i) => {
            const filas = series.map(s => [s.nombre, entero(s.valores[i]), s.clase]);
            return '<div class="est-grupo" tabindex="0" data-tip="' + tip(cat.largo, filas) + '">' +
                series.map(s => {
                    const v = s.valores[i];
                    // La última columna lleva su valor encima: es el dato más reciente.
                    const etiqueta = i === ultima && v ? '<span class="est-col-valor">' + esc(entero(v)) + '</span>' : '';
                    return '<span class="est-col ' + s.clase + (v ? '' : ' est-col-cero') + '" style="height:' + (v / t.max * 100).toFixed(2) + '%">' + etiqueta + '</span>';
                }).join('') + '</div>';
        }).join('');
        return '<div class="est-columnas' + (categorias.length > 8 ? ' est-denso' : '') + '">' +
            '<div class="est-plot">' +
                lineas.map(v => '<span class="est-rejilla-linea" style="bottom:' + (v / t.max * 100).toFixed(2) + '%"><span>' + esc(entero(v)) + '</span></span>').join('') +
                '<div class="est-grupos">' + grupos + '</div>' +
            '</div>' +
            '<div class="est-eje-x">' + categorias.map(c => '<span>' + esc(c.corto) + '</span>').join('') + '</div>' +
            (series.length > 1 ? '<div class="est-leyenda">' + series.map(s => '<span><i class="' + s.clase + '"></i>' + esc(s.nombre) + '</span>').join('') + '</div>' : '') +
        '</div>';
    }

    // ---- Descripción emergente ----

    function caja() {
        let el = document.getElementById('est-tip');
        if (!el) {
            el = document.createElement('div');
            el.id = 'est-tip';
            el.className = 'est-tip';
            el.setAttribute('role', 'tooltip');
            el.hidden = true;
            document.body.appendChild(el);
        }
        return el;
    }

    function mostrarTip(e) {
        const marca = e.target.closest && e.target.closest('[data-tip]');
        if (!marca) return;
        let datos;
        try { datos = JSON.parse(marca.dataset.tip); } catch (x) { return; }
        const el = caja();
        el.textContent = '';
        const t = document.createElement('div');
        t.className = 'est-tip-titulo';
        t.textContent = datos.t;
        el.appendChild(t);
        for (const [nombre, valor, clase] of datos.f || []) {
            const fila = document.createElement('div');
            fila.className = 'est-tip-fila';
            if (clase) {
                const llave = document.createElement('i');
                llave.className = 'est-tip-llave ' + clase;
                fila.appendChild(llave);
            }
            const v = document.createElement('strong');
            v.textContent = valor;
            const n = document.createElement('span');
            n.textContent = nombre;
            fila.append(v, n);
            el.appendChild(fila);
        }
        el.hidden = false;
        const r = marca.getBoundingClientRect();
        const w = el.offsetWidth, h = el.offsetHeight;
        let x = r.left + r.width / 2 - w / 2;
        x = Math.max(8, Math.min(x, document.documentElement.clientWidth - w - 8));
        let y = r.top - h - 8;
        if (y < 8) y = r.bottom + 8;
        el.style.left = x + 'px';
        el.style.top = y + 'px';
    }

    function ocultarTipYa() {
        const el = document.getElementById('est-tip');
        if (el) el.hidden = true;
    }

    function ocultarTip(e) {
        const marca = e.target.closest && e.target.closest('[data-tip]');
        if (!marca) return;
        if (e.relatedTarget && marca.contains(e.relatedTarget)) return;
        const el = document.getElementById('est-tip');
        if (el) el.hidden = true;
    }

    // ---- Eventos ----

    function alCambiar(e) {
        const campo = e.target.dataset && e.target.dataset.filtro;
        if (!campo) return;
        ui.filtros[campo] = e.target.value;
        if (campo === 'periodo' && e.target.value === 'rango' && ui.informe) {
            ui.filtros.desde = ui.filtros.desde || ymd(ui.informe.periodo.desde);
            ui.filtros.hasta = ui.filtros.hasta || ymd(ui.informe.periodo.hasta);
        }
        guardarFiltros();
        pintar();
    }

    async function alHacerClic(e) {
        const b = e.target.closest('[data-acc]');
        if (!b || !raiz().contains(b)) return;
        const id = b.dataset.tarjeta;
        switch (b.dataset.acc) {
            case 'ir': {
                e.preventDefault();
                const destino = document.getElementById(b.dataset.destino);
                if (destino) destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            case 'limpiar':
                Object.assign(ui.filtros, { institucion: '', materia: '', cliente: '', responsable: '' });
                guardarFiltros();
                return pintar();
            case 'alternar':
                if (ui.comoTabla.has(id)) ui.comoTabla.delete(id); else ui.comoTabla.add(id);
                return pintar();
            case 'ordenar': {
                const o = ui.orden[id];
                ui.orden[id] = o && o.col === b.dataset.col ? { col: o.col, dir: o.dir === 'asc' ? 'desc' : 'asc' }
                    : { col: b.dataset.col, dir: b.closest('th').classList.contains('est-num') ? 'desc' : 'asc' };
                return pintar();
            }
            case 'expandir':
                if (ui.expandidas.has(id)) ui.expandidas.delete(id); else ui.expandidas.add(id);
                return pintar();
            case 'expediente': {
                const n = parseInt(b.dataset.id, 10);
                if (typeof global.verDetalleExpediente === 'function') return global.verDetalleExpediente(n);
                if (typeof global.mostrarExpediente === 'function') return global.mostrarExpediente(n);
                return;
            }
            case 'csv': return descargar(nombreArchivo(ui.tarjetas.get(id).titulo), csvDeTarjetas([id]));
            case 'csv-todo': return descargar(nombreArchivo('estadisticas'), csvDeTarjetas(Array.from(ui.tarjetas.keys())));
        }
    }

    // ---- CSV ----

    function nombreArchivo(titulo) {
        const base = normalizar(titulo).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'estadisticas';
        return base + '-' + ymd(Date.now()) + '.csv';
    }

    function valorCSV(c, f) {
        const v = f[c.clave];
        if (v == null || v === '') return '';
        switch (c.tipo) {
            case 'dias': return (Math.round(v * 10) / 10).toFixed(1);
            case 'fecha': return ymd(v);
            case 'pct': return (Math.round(v * 1000) / 10).toFixed(1);
            default: return v;
        }
    }

    function csvDeTarjetas(ids) {
        const celda = v => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const inf = ui.informe;
        const lineas = [['Estadísticas del despacho', 'del ' + ymd(inf.periodo.desde) + ' al ' + ymd(inf.periodo.hasta)]];
        const f = ui.filtros;
        const filtros = [['Institución', INSTITUCIONES[f.institucion]], ['Materia', f.materia], ['Cliente', f.cliente], ['Responsable', f.responsable]]
            .filter(([, v]) => v).map(([k, v]) => k + ': ' + v);
        if (filtros.length) lineas.push(['Filtros', filtros.join(' · ')]);
        for (const id of ids) {
            const t = ui.tarjetas.get(id);
            if (!t) continue;
            lineas.push([], [t.titulo]);
            lineas.push(t.columnas.map(c => c.titulo + (c.tipo === 'dias' ? ' (días)' : c.tipo === 'pct' ? ' (%)' : '')));
            for (const fila of filasOrdenadas(id, t.columnas, t.filas)) lineas.push(t.columnas.map(c => valorCSV(c, fila)));
        }
        return '﻿' + lineas.map(l => l.map(celda).join(',')).join('\r\n');
    }

    function descargar(nombre, contenido) {
        if (typeof global.descargarArchivo === 'function') global.descargarArchivo(nombre, contenido, 'text/csv;charset=utf-8');
        if (typeof global.mostrarToast === 'function') global.mostrarToast('Exportado: ' + nombre, 'success');
    }

    global.ESTADISTICAS = Object.assign({}, Motor, { preparar, refrescarSiVisible, pintar });
    global.prepararEstadisticas = preparar;
    global.refrescarEstadisticasSiVisible = refrescarSiVisible;
})(typeof window !== 'undefined' ? window : globalThis);
