/**
 * Seguimiento semanal: lleva a la lista de pendientes lo que trae
 * `indice_asuntos.json`, el índice que deja la revisión semanal de las
 * carpetas de asuntos (cada viernes).
 *
 * El índice es una lista de asuntos. Cada uno trae su carpeta, cliente,
 * números de expediente ("Exp. 174/2026", "CI FGE/QROO/BJ/07/15042/2026"),
 * estado (ACTIVO, EN ESPERA…), prioridad y sus pendientes, cada uno con
 * acción, tipo, fecha límite y una nota.
 *
 * Importar no es copiar. Semana con semana el índice repite muchos
 * pendientes (los "arrastrados"), a veces con otra fecha o redactados un poco
 * distinto, así que:
 *   - cada asunto se une con su expediente de la app por número; si no hay
 *     número que coincida, se propone por el nombre del cliente y el usuario
 *     confirma;
 *   - cada pendiente se busca entre los que ya existen de ese asunto (por su
 *     origen o por parecido del texto). Si ya está, se actualiza su fecha,
 *     prioridad o nota; si el usuario ya lo terminó, no se reabre;
 *   - un pendiente importado antes que ya no aparece en el índice se propone
 *     como terminado;
 *   - nada se aplica sin que el usuario vea antes qué va a pasar.
 *
 * Dos partes, como las demás herramientas: el motor, puro (se prueba en
 * Node), y la interfaz, que lee el archivo, enseña la vista previa y aplica
 * con el núcleo de acciones.
 */
(function (global) {
    'use strict';

    // ==================== MOTOR ====================

    const ORIGEN = 'seguimiento';
    // Un asunto en alguno de estos estados no aporta pendientes.
    const RE_ESTADO_FUERA = /conclu|terminad|no es asunto|archivad|cerrad/i;
    // Dos acciones del mismo asunto se consideran la misma a partir de aquí.
    const UMBRAL_MISMO = 0.6;
    // Parecido entre el cliente y un expediente para proponerlo sin número.
    const UMBRAL_NOMBRE = 0.67;
    const PRIORIDADES = { ALTA: 'alta', MEDIA: 'media', BAJA: 'baja' };

    const VACIAS = new Set([
        'el', 'la', 'los', 'las', 'de', 'del', 'que', 'con', 'por', 'para', 'una', 'uno', 'unos', 'unas',
        'sus', 'son', 'sea', 'ser', 'hay', 'ante', 'sobre', 'entre', 'como', 'mas', 'sin', 'desde', 'hasta',
        'este', 'esta', 'ese', 'esa', 'lo', 'al', 'se', 'si', 'su', 'en', 'y', 'o', 'a', 'e', 'u', 'vs',
        'sa', 'cv', 'rl', 'sc', 'lic', 'exp', 'num'
    ]);

    function normalizar(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/\s+/g, ' ').trim();
    }

    // Los números cuentan aunque sean cortos: "29-sep" y "8-oct" distinguen
    // dos escritos que por lo demás se redactan igual.
    function palabras(s) {
        return normalizar(s).replace(/[^a-z0-9ñ]+/g, ' ').split(' ')
            .filter(p => p && (/\d/.test(p) || (p.length >= 3 && !VACIAS.has(p))));
    }

    /**
     * Qué tanto se parecen dos textos, de 0 a 1 (palabras en común). Si
     * mencionan números distintos (fechas, expedientes) se castiga: "revisar
     * el acuerdo al escrito del 29-sep" no es "… del 8-oct".
     */
    function parecido(a, b) {
        const pa = new Set(palabras(a));
        const pb = new Set(palabras(b));
        if (!pa.size || !pb.size) return normalizar(a) === normalizar(b) && !!normalizar(a) ? 1 : 0;
        let comunes = 0;
        for (const p of pa) if (pb.has(p)) comunes++;
        let v = (2 * comunes) / (pa.size + pb.size);
        const na = [...pa].filter(p => /\d/.test(p));
        const nb = [...pb].filter(p => /\d/.test(p));
        if (na.length && nb.length && (na.some(p => !pb.has(p)) || nb.some(p => !pa.has(p)))) v *= 0.7;
        return v;
    }

    /**
     * Los números de expediente que aparecen en un texto, comparables:
     * "Exp. 0174/2026-IV" → "174/2026"; "DIT-021/2026" → "21/2026";
     * "CI FGE/QROO/BJ/07/15042/2026" → "15042/2026".
     */
    function numerosEn(texto) {
        const s = new Set();
        const re = /(\d{1,7})\s*\/\s*(\d{4})(?!\d)/g;
        let m;
        while ((m = re.exec(String(texto || '')))) s.add(parseInt(m[1], 10) + '/' + m[2]);
        return s;
    }

    function textoExpediente(exp, nombreCarpeta) {
        return [exp.numero, exp.nombre, exp.cliente, exp.actor, exp.demandado, exp.comentario, exp.juzgado, nombreCarpeta]
            .filter(Boolean).join(' ');
    }

    /** "2026-10-23" → la fecha tal cual si es válida; si no, null. */
    function fechaValida(f) {
        if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
        const [y, m, d] = f.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? f : null;
    }

    /** "2026-10-23" → ISO de la medianoche local, como guarda la app un pendiente "para el día". */
    function isoDeFecha(f) {
        if (!fechaValida(f)) return null;
        const [y, m, d] = f.split('-').map(Number);
        return new Date(y, m - 1, d).toISOString();
    }

    /** El día (local) de una fecha guardada, "YYYY-MM-DD", o null. */
    function diaDe(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    /** "10:00", "9:30 hrs", "16:15-16:30" → "10:00", "09:30", "16:15"; si no trae hora, null. */
    function horaDe(h) {
        const m = String(h == null ? '' : h).match(/(\d{1,2}):(\d{2})/);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
        return m[1].padStart(2, '0') + ':' + m[2];
    }

    /** Fecha y hora (locales) → ISO. Sin hora, la medianoche. */
    function isoDeFechaHora(f, hora) {
        if (!fechaValida(f)) return null;
        const [y, m, d] = f.split('-').map(Number);
        const [hh, mm] = hora ? hora.split(':').map(Number) : [0, 0];
        return new Date(y, m - 1, d, hh, mm).toISOString();
    }

    /**
     * Lee el índice. Acepta la lista tal cual o un objeto { asuntos: [...] }.
     * Devuelve { asuntos, errores } con cada asunto ya limpio; lanza un error
     * si no es un índice.
     */
    function leerIndice(datos) {
        const lista = Array.isArray(datos) ? datos : (datos && Array.isArray(datos.asuntos) ? datos.asuntos : null);
        if (!lista) throw new Error('El archivo no es un índice de asuntos: se esperaba una lista de asuntos con sus pendientes');
        const asuntos = [];
        const errores = [];
        const vistos = new Map();
        lista.forEach((a, i) => {
            if (!a || typeof a !== 'object') { errores.push(`Elemento ${i + 1}: no es un asunto`); return; }
            const carpeta = String(a.carpeta || '').trim();
            const titulo = String(a.asunto || '').trim();
            if (!carpeta && !titulo) { errores.push(`Elemento ${i + 1}: sin carpeta ni nombre de asunto`); return; }
            const clave = normalizar(carpeta || titulo);
            const pendientes = [];
            for (const p of Array.isArray(a.pendientes) ? a.pendientes : []) {
                const accion = String((p && p.accion) || '').trim();
                if (!accion) continue;
                const nuevo = {
                    accion,
                    tipo: String(p.tipo || '').trim().toUpperCase(),
                    fecha: fechaValida(p.fecha_limite),
                    prioridad: PRIORIDADES[String(p.prioridad || a.prioridad || '').trim().toUpperCase()] || '',
                    nota: String(p.nota || '').trim()
                };
                // El mismo pendiente dos veces en el asunto: uno solo, con la
                // fecha más próxima.
                const igual = pendientes.find(x => parecido(x.accion, accion) >= 0.85);
                if (igual) {
                    if (nuevo.fecha && (!igual.fecha || nuevo.fecha < igual.fecha)) igual.fecha = nuevo.fecha;
                    continue;
                }
                pendientes.push(nuevo);
            }
            const asunto = {
                clave, carpeta, titulo: titulo || carpeta,
                cliente: String(a.cliente || '').trim(),
                materia: String(a.materia || '').trim(),
                estado: String(a.estado || '').trim().toUpperCase(),
                prioridad: PRIORIDADES[String(a.prioridad || '').trim().toUpperCase()] || '',
                expedientes: (Array.isArray(a.expedientes) ? a.expedientes : [a.expedientes]).filter(Boolean).map(String),
                fuera: RE_ESTADO_FUERA.test(String(a.estado || '')),
                pendientes,
                audiencias: (Array.isArray(a.audiencias) ? a.audiencias : [])
                    .filter(x => x && fechaValida(x.fecha) && String(x.descripcion || '').trim())
                    .map(x => ({
                        fecha: x.fecha,
                        hora: horaDe(x.hora),
                        descripcion: String(x.descripcion).trim(),
                        lugar: String(x.lugar || '').trim()
                    }))
            };
            // La misma carpeta dos veces: se juntan sus pendientes.
            if (vistos.has(clave)) {
                const previo = vistos.get(clave);
                for (const p of pendientes) if (!previo.pendientes.some(x => parecido(x.accion, p.accion) >= 0.85)) previo.pendientes.push(p);
                previo.audiencias.push(...asunto.audiencias);
                return;
            }
            vistos.set(clave, asunto);
            asuntos.push(asunto);
        });
        return { asuntos, errores };
    }

    /**
     * El expediente de la app que corresponde a un asunto.
     * Devuelve { expediente, por: 'numero'|'nombre'|null, candidatos }.
     * Por número es seguro. Sin número se busca por el cliente o por la
     * contraparte ("… vs Constructora Alfa"), en las partes, el nombre del
     * expediente y el nombre de su carpeta en la app (`nombreCarpetaDe`).
     */
    function emparejar(asunto, expedientes, nombreCarpetaDe) {
        const numeros = numerosEn(asunto.expedientes.join(' ') + ' ' + asunto.titulo);
        const lista = expedientes || [];
        const contraparte = (asunto.titulo.split(/\s+vs\.?\s+/i)[1] || '').split(/\s+[—–-]\s+|\(/)[0];
        const fraccion = (texto, ps) => ps.length ? ps.filter(p => texto.includes(' ' + p + ' ')).length / ps.length : 0;
        const puntajeNombre = (exp) => {
            const texto = ' ' + palabras(textoExpediente(exp, nombreCarpetaDe ? nombreCarpetaDe(exp.carpetaId) : '')).join(' ') + ' ';
            return Math.max(
                fraccion(texto, palabras(asunto.cliente || asunto.titulo)),
                fraccion(texto, palabras(contraparte)),
                fraccion(texto, palabras(asunto.carpeta.split('/')[0]))
            );
        };

        if (numeros.size) {
            const porNumero = lista.filter(exp => {
                for (const n of numerosEn(exp.numero)) if (numeros.has(n)) return true;
                return false;
            });
            if (porNumero.length === 1) return { expediente: porNumero[0], por: 'numero', candidatos: porNumero };
            if (porNumero.length > 1) {
                // El mismo número en dos juzgados: decide el cliente, si lo hace claro.
                const conPuntaje = porNumero.map(exp => ({ exp, p: puntajeNombre(exp) })).sort((a, b) => b.p - a.p);
                if (conPuntaje[0].p > 0 && conPuntaje[0].p > conPuntaje[1].p) {
                    return { expediente: conPuntaje[0].exp, por: 'numero', candidatos: conPuntaje.map(x => x.exp) };
                }
                return { expediente: null, por: null, candidatos: conPuntaje.map(x => x.exp) };
            }
        }

        const porNombre = lista.map(exp => ({ exp, p: puntajeNombre(exp) }))
            .filter(x => x.p >= UMBRAL_NOMBRE).sort((a, b) => b.p - a.p);
        if (porNombre.length && (porNombre.length === 1 || porNombre[0].p > porNombre[1].p)) {
            return { expediente: porNombre[0].exp, por: 'nombre', candidatos: porNombre.map(x => x.exp) };
        }
        return { expediente: null, por: null, candidatos: porNombre.map(x => x.exp) };
    }

    function descripcionDe(asunto, p) {
        return [
            p.tipo ? 'Tipo: ' + p.tipo : '',
            p.nota ? 'Nota: ' + p.nota : '',
            'Asunto: ' + asunto.titulo
        ].filter(Boolean).join('\n');
    }

    /**
     * Qué haría la importación, sin tocar nada.
     *
     * entrada: { asuntos } de leerIndice.
     * ctx: {
     *   expedientes,            lista de la app
     *   pendientes,             todos los de la app (abiertos y terminados)
     *   asignaciones,           { [clave del asunto]: id de expediente | null (sin expediente) | 'omitir' }
     *                           lo que eligió el usuario; manda sobre el emparejamiento automático
     *   revision                'YYYY-MM-DD' de la revisión, para el origen y la semana del reporte
     *   descartados             lo que el usuario desmarcó en importaciones anteriores
     *                           ([{ asunto, accion, fecha? }]): no se vuelve a proponer
     *   todos                   true: todos los pendientes del índice; si no, solo los
                                 que lleva el reporte de Word (ver semanaDelReporte)
     * }
     *
     * Devuelve { asuntos: [...], desaparecidos: [...], totales }.
     */
    function planificar(entrada, ctx) {
        const expedientes = ctx.expedientes || [];
        const todos = ctx.pendientes || [];
        const asignaciones = ctx.asignaciones || {};
        const usados = new Set();
        const totales = { asuntos: 0, nuevos: 0, actualizar: 0, iguales: 0, yaTerminados: 0, desaparecidos: 0, fuera: 0, omitidos: 0, sinExpediente: 0,
            audienciasNuevas: 0, audienciasActualizar: 0, audienciasIguales: 0 };
        // Los eventos que reflejan un pendiente no son audiencias.
        const eventos = (ctx.eventos || []).filter(e => e.pendienteId == null);
        const eventosUsados = new Set();
        const hoy = ctx.hoy || diaDe(new Date().toISOString());
        const semana = semanaDelReporte(ctx.revision || hoy);
        totales.fueraDelReporte = 0;
        totales.descartados = 0;
        const descartados = ctx.descartados || [];
        const descartado = (asunto, texto, fecha) => descartados.find(d => d.asunto === asunto &&
            (d.fecha || null) === (fecha || null) && parecido(d.accion, texto) >= UMBRAL_MISMO);

        // Lo que ya se importó antes, por asunto: así se sabe a qué
        // expediente se asignó aunque el número no coincida.
        const asignadoAntes = new Map();
        for (const p of todos) {
            if (p.origen && p.origen.tipo === ORIGEN && p.origen.asunto && !asignadoAntes.has(p.origen.asunto)) {
                asignadoAntes.set(p.origen.asunto, p.expedienteId != null ? p.expedienteId : null);
            }
        }
        const porId = new Map(expedientes.map(e => [e.id, e]));

        const asuntos = entrada.asuntos.map(asunto => {
            const auto = emparejar(asunto, expedientes, ctx.nombreCarpetaDe);
            let expedienteId, por;
            if (Object.prototype.hasOwnProperty.call(asignaciones, asunto.clave)) {
                expedienteId = asignaciones[asunto.clave];
                por = 'usuario';
            } else if (auto.expediente) {
                expedienteId = auto.expediente.id;
                por = auto.por;
            } else if (asignadoAntes.has(asunto.clave) && (asignadoAntes.get(asunto.clave) == null || porId.has(asignadoAntes.get(asunto.clave)))) {
                expedienteId = asignadoAntes.get(asunto.clave);
                por = 'antes';
            } else {
                expedienteId = null;
                por = null;
            }
            const omitido = expedienteId === 'omitir';
            const plan = {
                asunto, expedienteId: omitido ? null : expedienteId, por, omitido,
                candidatos: auto.candidatos, pendientes: [], audiencias: []
            };
            if (asunto.fuera) { totales.fuera++; return plan; }
            if (omitido) { totales.omitidos++; return plan; }
            totales.asuntos++;
            if (plan.expedienteId == null) totales.sinExpediente++;

            // Los que ya existen y pueden ser de este asunto.
            const existentes = todos.filter(x => !usados.has(x.id) && (
                (x.origen && x.origen.tipo === ORIGEN && x.origen.asunto === asunto.clave) ||
                (plan.expedienteId != null && x.expedienteId === plan.expedienteId)));

            for (const p of asunto.pendientes) {
                let mejor = null, mejorP = 0;
                for (const x of existentes) {
                    if (usados.has(x.id)) continue;
                    const v = parecido(x.titulo, p.accion);
                    if (v > mejorP) { mejor = x; mejorP = v; }
                }
                // Lo que el usuario desmarcó otra semana no se vuelve a proponer.
                const desc = descartado(asunto.clave, p.accion);
                if (desc) {
                    if (mejor && mejorP >= UMBRAL_MISMO) usados.add(mejor.id);
                    plan.pendientes.push({ ...p, accionPlan: 'descartado', descartado: desc });
                    totales.descartados++;
                    continue;
                }
                const datos = {
                    titulo: p.accion,
                    descripcion: descripcionDe(asunto, p),
                    expedienteId: plan.expedienteId,
                    expedienteTexto: plan.expedienteId == null ? asunto.titulo : null,
                    fechaLimite: isoDeFecha(p.fecha),
                    prioridad: p.prioridad,
                    origen: { tipo: ORIGEN, asunto: asunto.clave, revision: ctx.revision || null }
                };
                if (!mejor || mejorP < UMBRAL_MISMO) {
                    // Lo que el reporte de Word no lleva no se agrega (si ya
                    // existía sí se reconoce, para no darlo por desaparecido).
                    if (!ctx.todos && !semana.incluye(p)) {
                        plan.pendientes.push({ ...p, accionPlan: 'fuera' });
                        totales.fueraDelReporte++;
                        continue;
                    }
                    plan.pendientes.push({ ...p, accionPlan: 'nuevo', datos });
                    totales.nuevos++;
                    continue;
                }
                usados.add(mejor.id);
                if (mejor.completado) {
                    plan.pendientes.push({ ...p, accionPlan: 'terminado', existente: mejor });
                    totales.yaTerminados++;
                    continue;
                }
                // Ya existe: se trae lo que cambió. El título solo se reescribe
                // si lo había puesto la importación, no si lo escribió el usuario.
                const cambios = {};
                const delSeguimiento = !!(mejor.origen && mejor.origen.tipo === ORIGEN);
                if (p.fecha && diaDe(mejor.fechaLimite) !== p.fecha) cambios.fechaLimite = datos.fechaLimite;
                if (p.prioridad && mejor.prioridad !== p.prioridad) cambios.prioridad = p.prioridad;
                if (delSeguimiento) {
                    if (mejor.titulo !== datos.titulo) cambios.titulo = datos.titulo;
                    if ((mejor.descripcion || '') !== datos.descripcion) cambios.descripcion = datos.descripcion;
                }
                if (!delSeguimiento || (mejor.origen.asunto !== asunto.clave)) cambios.origen = datos.origen;
                else if (ctx.revision && mejor.origen.revision !== ctx.revision) cambios.origen = datos.origen;
                const visibles = Object.keys(cambios).filter(k => k !== 'origen');
                if (visibles.length) {
                    plan.pendientes.push({ ...p, accionPlan: 'actualizar', existente: mejor, cambios });
                    totales.actualizar++;
                } else {
                    plan.pendientes.push({ ...p, accionPlan: 'igual', existente: mejor, cambios });
                    totales.iguales++;
                }
            }

            // Audiencias: las que aún no pasan van al calendario. Las pasadas
            // no: la revisión ya las trae como pendiente ("registrar resultado").
            for (const au of asunto.audiencias) {
                if (au.fecha < hoy) continue;
                if (descartado(asunto.clave, au.descripcion, au.fecha)) { totales.descartados++; continue; }
                const datos = {
                    titulo: au.descripcion,
                    tipo: 'audiencia',
                    fechaInicio: isoDeFechaHora(au.fecha, au.hora),
                    todoElDia: !au.hora,
                    expedienteId: plan.expedienteId,
                    expedienteTexto: plan.expedienteId == null ? asunto.titulo : null,
                    descripcion: [au.lugar ? 'Lugar: ' + au.lugar : '', 'Asunto: ' + asunto.titulo].filter(Boolean).join('\n'),
                    alerta: true,
                    origen: { tipo: ORIGEN, asunto: asunto.clave, revision: ctx.revision || null }
                };
                // La misma audiencia ya en el calendario: mismo día y del mismo
                // asunto (importada antes) o del mismo expediente con texto parecido.
                const existente = eventos.find(e => !eventosUsados.has(e.id) && diaDe(e.fechaInicio) === au.fecha && (
                    (e.origen && e.origen.tipo === ORIGEN && e.origen.asunto === asunto.clave && parecido(e.titulo, au.descripcion) >= 0.4) ||
                    (plan.expedienteId != null && e.expedienteId === plan.expedienteId && (e.tipo === 'audiencia' || parecido(e.titulo, au.descripcion) >= 0.4))));
                if (!existente) {
                    plan.audiencias.push({ ...au, accionPlan: 'nuevo', datos });
                    totales.audienciasNuevas++;
                    continue;
                }
                eventosUsados.add(existente.id);
                const cambios = {};
                if (au.hora && (existente.todoElDia || existente.fechaInicio !== datos.fechaInicio)) {
                    cambios.fechaInicio = datos.fechaInicio;
                    cambios.todoElDia = false;
                }
                if (existente.origen && existente.origen.tipo === ORIGEN) {
                    if (existente.titulo !== datos.titulo) cambios.titulo = datos.titulo;
                    if ((existente.descripcion || '') !== datos.descripcion) cambios.descripcion = datos.descripcion;
                }
                if (Object.keys(cambios).length) {
                    plan.audiencias.push({ ...au, accionPlan: 'actualizar', existente, cambios });
                    totales.audienciasActualizar++;
                } else {
                    plan.audiencias.push({ ...au, accionPlan: 'igual', existente });
                    totales.audienciasIguales++;
                }
            }
            return plan;
        });

        // Importados antes, abiertos, que esta revisión ya no trae. Los de
        // asuntos que el usuario dejó fuera no se tocan.
        const omitidas = new Set(asuntos.filter(a => a.omitido).map(a => a.asunto.clave));
        const desaparecidos = todos.filter(x => !x.completado && !usados.has(x.id) &&
            x.origen && x.origen.tipo === ORIGEN && !omitidas.has(x.origen.asunto) &&
            !descartado(x.origen.asunto, x.titulo));
        totales.desaparecidos = desaparecidos.length;

        return { asuntos, desaparecidos, totales, semana };
    }

    /** Lo que se recuerda de algo que el usuario desmarcó. */
    function descarteDe(asunto, accion, fecha) {
        return { id: asunto + '|' + normalizar(accion) + (fecha ? '|' + fecha : ''), asunto, accion, fecha: fecha || null, el: new Date().toISOString() };
    }

    /** Une los descartados de dos dispositivos: nunca se pierde uno. */
    function fusionarDescartados(a, b) {
        const mapa = new Map();
        for (const d of [...(a || []), ...(b || [])]) if (d && d.id && !mapa.has(d.id)) mapa.set(d.id, d);
        return Array.from(mapa.values()).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    }

    function sumarDias(f, n) {
        const [y, m, d] = f.split('-').map(Number);
        return diaDe(new Date(y, m - 1, d + n).toISOString());
    }

    /**
     * La semana que cubre el reporte de Word de una revisión y qué pendientes
     * lleva, con la misma regla que generar_reporte.py:
     *   - la semana es la siguiente a la revisión (revisión del viernes 23 →
     *     lunes 26 a viernes 30);
     *   - van los que vencen hasta ese viernes (los anteriores al lunes, para
     *     revisar que se atendieron, y los de la semana) y los escritos sin
     *     fecha o que vencen hasta el viernes siguiente.
     * Los asuntos concluidos ya quedan fuera antes.
     */
    function semanaDelReporte(revision) {
        const f = fechaValida(revision) || diaDe(new Date().toISOString());
        const [y, m, d] = f.split('-').map(Number);
        const diaSemana = new Date(y, m - 1, d).getDay(); // 0 domingo … 6 sábado
        const lunes = sumarDias(f, ((8 - diaSemana) % 7) || 7);
        const viernes = sumarDias(lunes, 4);
        const limiteEscritos = sumarDias(viernes, 7);
        return {
            lunes, viernes,
            incluye: (p) => (!!p.fecha && p.fecha <= viernes) ||
                (p.tipo === 'ESCRITO' && (!p.fecha || p.fecha <= limiteEscritos))
        };
    }

    // ---- Lo que se le dice al asistente ----
    // La herramienta no tiene botón: se abre pidiéndole al asistente
    // "actualiza mis pendientes" (o una forma parecida de decirlo).
    const RE_VERBO_ACTUALIZAR = /\b(actualiz\w*|importa\w*|sincroniza\w*|carga\w*|trae\w*|traer\w*|refresca\w*|pon(me|gas|er)? al dia|poner al dia|al corriente)\b/;

    /** ¿Es "actualiza mis pendientes" (o una forma de decirlo)? */
    function esPeticionAbrir(texto) {
        const t = normalizar(texto).replace(/[¿?¡!.,;:"'«»“”()]/g, ' ').replace(/\s+/g, ' ').trim();
        // "Seguimiento semanal" a secas, o con un verbo de actualizar.
        if (/^(el |mi )?seguimiento( semanal)?$/.test(t)) return true;
        const objeto = /\bpendientes\b/.test(t) || /\bseguimiento( semanal)?\b/.test(t);
        if (!objeto || !RE_VERBO_ACTUALIZAR.test(t)) return false;
        // "Actualiza el pendiente 3" o "cambia la fecha de los pendientes de X"
        // son otra cosa: aquí solo se habla de la lista completa.
        if (/\bfecha\b|\bexpediente\b|\d/.test(t)) return false;
        return true;
    }

    const Motor = {
        ORIGEN, normalizar, palabras, parecido, numerosEn, fechaValida, isoDeFecha, diaDe,
        horaDe, isoDeFechaHora, semanaDelReporte, leerIndice, emparejar, planificar, esPeticionAbrir,
        descarteDe, fusionarDescartados
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
    if (typeof document === 'undefined') return;

    // ==================== INTERFAZ ====================

    const CLAVE_ASIGNACIONES = 'seguimiento_asignaciones';
    // Lo que el usuario desmarcó. Va en la base (config) y viaja en la
    // sincronización: desmarcado en la computadora, no reaparece en el celular.
    const CLAVE_DESCARTADOS = 'seguimiento_descartados';

    async function leerDescartados() {
        try {
            const v = typeof obtenerConfig === 'function' ? await obtenerConfig(CLAVE_DESCARTADOS) : null;
            return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
    }
    async function guardarDescartados(lista) {
        if (typeof guardarConfig === 'function') await guardarConfig(CLAVE_DESCARTADOS, lista);
    }
    // Para la sincronización (sync.js).
    global.obtenerSeguimientoDescartados = leerDescartados;
    global.fusionarSeguimientoDescartados = fusionarDescartados;
    global.aplicarSeguimientoDescartados = async (remotos) => {
        await guardarDescartados(fusionarDescartados(await leerDescartados(), remotos));
    };
    const OMITIR = 'omitir';
    const ui = { entrada: null, revision: null, nombreArchivo: '', expedientes: [], pendientes: [], asignaciones: {}, plan: null };

    const $ = id => document.getElementById(id);
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function toast(m, t) { if (typeof mostrarToast === 'function') mostrarToast(m, t || 'info'); }

    function leerAsignaciones() {
        try { return JSON.parse(localStorage.getItem(CLAVE_ASIGNACIONES)) || {}; } catch (e) { return {}; }
    }
    function guardarAsignaciones(a) {
        try { localStorage.setItem(CLAVE_ASIGNACIONES, JSON.stringify(a)); } catch (e) { /* sin almacenamiento */ }
    }

    function fechaCorta(f) {
        if (!f) return 'sin fecha';
        const [y, m, d] = f.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    }

    function etiquetaExp(exp) {
        if (!exp) return '';
        if (typeof etiquetaExpediente === 'function') return etiquetaExpediente(exp);
        return exp.numero || exp.nombre || 'Expediente';
    }

    function abrir() {
        $('modal-titulo').textContent = '📥 Seguimiento semanal';
        $('modal-body').innerHTML =
            '<div class="seg-intro">' +
                '<p>Trae a esta lista los pendientes de la revisión semanal de tus carpetas.</p>' +
                '<p>Elige el archivo <strong>indice_asuntos.json</strong> de <em>_SEGUIMIENTO SEMANAL/_herramientas</em>. ' +
                'Antes de cambiar nada te enseño qué es nuevo, qué se actualiza y qué ya no aparece.</p>' +
                '<label class="btn btn-primary seg-elegir">Elegir indice_asuntos.json' +
                    '<input type="file" id="seg-archivo" accept=".json,application/json" hidden></label>' +
                '<p class="seg-error" id="seg-error" role="alert" hidden></p>' +
            '</div>';
        $('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>';
        $('seg-archivo').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) cargarArchivo(f);
        });
        if (typeof abrirModal === 'function') abrirModal();
        else $('modal-overlay').classList.add('active');
    }

    function mostrarError(msg) {
        const el = $('seg-error');
        if (!el) return toast(msg, 'error');
        el.textContent = msg;
        el.hidden = false;
    }

    async function cargarArchivo(archivo) {
        let datos;
        try {
            datos = JSON.parse(await archivo.text());
        } catch (e) {
            return mostrarError('No pude leer el archivo: no es un JSON válido.');
        }
        try {
            ui.entrada = leerIndice(datos);
        } catch (e) {
            return mostrarError(e.message);
        }
        ui.nombreArchivo = archivo.name;
        ui.revision = archivo.lastModified ? diaDe(new Date(archivo.lastModified).toISOString()) : null;
        ui.expedientes = await obtenerExpedientes().catch(() => []);
        ui.pendientes = await obtenerPendientes().catch(() => []);
        ui.eventos = typeof obtenerEventos === 'function' ? await obtenerEventos().catch(() => []) : [];
        const carpetas = typeof obtenerCarpetas === 'function' ? await obtenerCarpetas().catch(() => []) : [];
        ui.nombreCarpetaDe = (id) => (carpetas.find(c => c.id === id) || {}).nombre || '';
        ui.verAsignacion = false;
        ui.todos = false;
        ui.descartados = await leerDescartados();
        ui.recuperar = new Set();
        ui.asignaciones = leerAsignaciones();
        pintar();
    }

    function replanificar() {
        ui.plan = planificar(ui.entrada, {
            expedientes: ui.expedientes, pendientes: ui.pendientes, eventos: ui.eventos, nombreCarpetaDe: ui.nombreCarpetaDe,
            asignaciones: ui.asignaciones, revision: ui.revision, todos: !!ui.todos,
            descartados: ui.descartados.filter(d => !ui.recuperar.has(d.id))
        });
    }

    function selectorExpediente(a) {
        const elegido = a.omitido ? OMITIR : (a.expedienteId == null ? '' : String(a.expedienteId));
        const candidatos = new Set(a.candidatos.map(e => e.id));
        const orden = a.candidatos.concat(ui.expedientes.filter(e => !candidatos.has(e.id))
            .sort((x, y) => etiquetaExp(x).localeCompare(etiquetaExp(y), 'es')));
        return '<select class="seg-exp" data-asunto="' + esc(a.asunto.clave) + '" aria-label="Expediente de ' + esc(a.asunto.titulo) + '">' +
            '<option value=""' + (elegido === '' ? ' selected' : '') + '>Sin expediente (queda con el nombre del asunto)</option>' +
            '<option value="' + OMITIR + '"' + (elegido === OMITIR ? ' selected' : '') + '>No importar este asunto</option>' +
            orden.map(e => '<option value="' + esc(e.id) + '"' + (String(e.id) === elegido ? ' selected' : '') + '>' +
                (candidatos.has(e.id) ? '★ ' : '') + esc(etiquetaExp(e)) + '</option>').join('') +
        '</select>';
    }

    function filaPendiente(a, p, i) {
        const id = esc(a.asunto.clave) + '|' + i;
        let detalle = '';
        if (p.accionPlan === 'actualizar') {
            const c = p.cambios;
            const partes = [];
            if (c.fechaLimite !== undefined) partes.push('fecha ' + fechaCorta(diaDe(p.existente.fechaLimite)) + ' → ' + fechaCorta(p.fecha));
            if (c.prioridad) partes.push('prioridad ' + (p.existente.prioridad || 'sin asignar') + ' → ' + c.prioridad);
            if (c.titulo || c.descripcion) partes.push('texto o nota');
            detalle = '<span class="seg-cambio">' + esc(partes.join(' · ')) + '</span>';
        }
        return '<li class="seg-p seg-p-' + p.accionPlan + '">' +
            '<label><input type="checkbox" data-p="' + id + '" checked>' +
            '<span class="seg-cuerpo"><span class="seg-meta">' +
                '<span class="seg-fecha">' + esc(fechaCorta(p.fecha)) + '</span>' +
                (p.prioridad === 'alta' ? '<span class="seg-alta" title="Prioridad alta">ALTA</span>' : '') +
                (p.tipo ? '<span class="seg-tipo">' + esc(p.tipo) + '</span>' : '') +
            '</span><span class="seg-accion">' + esc(p.accion) + '</span>' + detalle + '</span></label>' +
        '</li>';
    }

    function pintar() {
        replanificar();
        const { asuntos, desaparecidos, totales, semana } = ui.plan;
        const activos = asuntos.filter(a => !a.asunto.fuera && !a.omitido);
        const porConfirmar = asuntos.filter(a => !a.asunto.fuera && (a.por === 'nombre' || a.por === null || a.por === 'usuario' || a.omitido));

        let html = '<div class="seg-resumen">' +
            '<p><strong>' + esc(ui.nombreArchivo) + '</strong>' + (ui.revision ? ' · revisión del ' + esc(fechaCorta(ui.revision)) : '') + '</p>' +
            '<ul class="seg-cifras">' +
                '<li><strong>' + totales.nuevos + '</strong> nuevos</li>' +
                '<li><strong>' + totales.actualizar + '</strong> se actualizan</li>' +
                '<li><strong>' + totales.iguales + '</strong> sin cambios</li>' +
                '<li><strong>' + totales.desaparecidos + '</strong> ya no aparecen</li>' +
            '</ul>' +
            '<p class="seg-nota">' + totales.asuntos + ' asuntos con pendientes' +
                (totales.yaTerminados ? ` · ${totales.yaTerminados} que ya terminaste no se reabren` : '') +
                (totales.fuera ? ` · ${totales.fuera} concluidos no se importan` : '') +
                (totales.omitidos ? ` · ${totales.omitidos} que pediste no importar` : '') +
                (totales.descartados ? ` · ${totales.descartados} que desmarcaste antes no se proponen` : '') +
                (totales.audienciasNuevas + totales.audienciasActualizar ? ` · ${totales.audienciasNuevas + totales.audienciasActualizar} audiencias al calendario` : '') + '</p>' +
            '<p class="seg-nota">Como el reporte de Word: lo vencido y lo de la semana del ' + esc(fechaCorta(semana.lunes)) + ' al ' + esc(fechaCorta(semana.viernes)) +
                ', más los escritos por preparar.' +
                (totales.fueraDelReporte || ui.todos
                    ? ' <label class="seg-todos"><input type="checkbox" id="seg-todos"' + (ui.todos ? ' checked' : '') + '> Traer también los ' +
                      (ui.todos ? 'demás' : totales.fueraDelReporte) + ' pendientes del índice que el reporte no lleva</label>'
                    : '') + '</p>' +
        '</div>';

        // No hay que catalogar nada: cada asunto ya va a su expediente (por
        // número o por parecido) o, si no tiene, con el nombre del asunto. Aquí
        // solo se puede corregir, y se abre si el usuario quiere.
        if (porConfirmar.length) {
            const sinExp = porConfirmar.filter(a => a.expedienteId == null && !a.omitido).length;
            html += '<details class="seg-bloque" id="seg-asignacion"' + (ui.verAsignacion ? ' open' : '') + '>' +
                '<summary>Expedientes asignados sin número (' + porConfirmar.length + ')</summary>' +
                '<p class="seg-nota">Se asignaron solos: ' + (porConfirmar.length - sinExp) + ' por parecido con el cliente, la contraparte o la carpeta, y ' +
                sinExp + ' sin expediente en la app, con el nombre del asunto. Corrige aquí solo si alguno está mal; se recuerda para la próxima semana.</p>' +
                porConfirmar.map(a =>
                    '<div class="seg-asignar"><div><strong>' + esc(a.asunto.titulo) + '</strong>' +
                    (a.asunto.expedientes.length ? '<small>' + esc(a.asunto.expedientes.join(' · ')) + '</small>' : '') + '</div>' +
                    selectorExpediente(a) + '</div>').join('') +
            '</details>';
        }

        const seccion = (titulo, tipo, abierta) => {
            const grupos = activos.map(a => ({ a, ps: a.pendientes.map((p, i) => ({ p, i })).filter(x => x.p.accionPlan === tipo) }))
                .filter(g => g.ps.length);
            if (!grupos.length) return '';
            const n = grupos.reduce((s, g) => s + g.ps.length, 0);
            return '<details class="seg-bloque"' + (abierta ? ' open' : '') + '><summary>' + esc(titulo) + ' (' + n + ')</summary>' +
                grupos.map(g => {
                    const exp = g.a.expedienteId != null ? ui.expedientes.find(e => e.id === g.a.expedienteId) : null;
                    return '<div class="seg-grupo"><div class="seg-grupo-titulo">' + esc(g.a.asunto.titulo) +
                        '<small>' + esc(exp ? etiquetaExp(exp) : 'sin expediente') + '</small></div>' +
                        '<ul>' + g.ps.map(x => filaPendiente(g.a, x.p, x.i)).join('') + '</ul></div>';
                }).join('') + '</details>';
        };
        if (totales.nuevos || totales.actualizar) {
            html += '<p class="seg-nota">Lo que desmarques no se volverá a proponer en las siguientes actualizaciones.</p>';
        }
        html += seccion('Nuevos', 'nuevo', true);
        html += seccion('Se actualizan', 'actualizar', false);

        // Lo desmarcado en otra semana: se puede volver a traer.
        const previos = activos.flatMap(a => a.pendientes.filter(p => p.accionPlan === 'descartado'));
        if (previos.length) {
            html += '<details class="seg-bloque"><summary>Desmarcados en semanas anteriores (' + previos.length + ')</summary>' +
                '<p class="seg-nota">No se proponen. Marca los que quieras volver a traer.</p><ul>' +
                previos.map(p => '<li class="seg-p"><label><input type="checkbox" data-recuperar="' + esc(p.descartado.id) + '">' +
                    '<span class="seg-cuerpo"><span class="seg-accion">' + esc(p.accion) + '</span></span></label></li>').join('') +
            '</ul></details>';
        }

        // Audiencias que aún no pasan y van (o cambian) en el calendario.
        const audiencias = activos.flatMap(a => a.audiencias.map((au, i) => ({ a, au, i })))
            .filter(x => x.au.accionPlan !== 'igual');
        if (audiencias.length) {
            html += '<details class="seg-bloque" open><summary>Audiencias al calendario (' + audiencias.length + ')</summary><ul>' +
                audiencias.map(({ a, au, i }) => '<li class="seg-p"><label><input type="checkbox" data-aud="' + esc(a.asunto.clave + '|' + i) + '" checked>' +
                    '<span class="seg-cuerpo"><span class="seg-meta"><span class="seg-fecha">' + esc(fechaCorta(au.fecha)) + (au.hora ? ' ' + esc(au.hora) : '') + '</span>' +
                    (au.accionPlan === 'actualizar' ? '<span class="seg-tipo">CAMBIA</span>' : '') + '</span>' +
                    '<span class="seg-accion">' + esc(au.descripcion) + '</span>' +
                    '<span class="seg-cambio">' + esc(a.asunto.titulo + (au.lugar ? ' · ' + au.lugar : '')) + '</span></span></label></li>').join('') +
            '</ul></details>';
        }

        if (desaparecidos.length) {
            html += '<details class="seg-bloque" open><summary>Ya no aparecen en la revisión (' + desaparecidos.length + ')</summary>' +
                '<p class="seg-nota">Los importaste antes y esta revisión ya no los trae. Los marcados se darán por terminados; los que desmarques se quedan como están y no se vuelven a proponer.</p><ul>' +
                desaparecidos.map(x => '<li class="seg-p"><label><input type="checkbox" data-desap="' + esc(x.id) + '" checked>' +
                    '<span class="seg-cuerpo"><span class="seg-accion">' + esc(x.titulo) + '</span></span></label></li>').join('') + '</ul></details>';
        }
        const hayAlgo = totales.nuevos || totales.actualizar || desaparecidos.length || audiencias.length;
        if (!hayAlgo) {
            html += '<p class="seg-ok">✓ Tu lista ya está al día con esta revisión.</p>';
        }

        $('modal-body').innerHTML = '<div class="seg-vista">' + html + '</div>';
        $('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>' +
            '<button class="btn btn-primary" id="seg-aplicar"' + (hayAlgo ? '' : ' disabled') + '>Importar</button>';

        $('modal-body').querySelectorAll('[data-recuperar]').forEach(c => c.addEventListener('change', () => {
            ui.recuperar.add(c.dataset.recuperar);
            pintar();
        }));
        const todos = $('seg-todos');
        if (todos) todos.addEventListener('change', () => { ui.todos = todos.checked; pintar(); });
        const asignacion = $('seg-asignacion');
        if (asignacion) asignacion.addEventListener('toggle', () => { ui.verAsignacion = asignacion.open; });
        $('modal-body').querySelectorAll('.seg-exp').forEach(sel => sel.addEventListener('change', () => {
            const v = sel.value;
            ui.asignaciones[sel.dataset.asunto] = v === '' ? null : v === OMITIR ? OMITIR : (isNaN(Number(v)) ? v : Number(v));
            pintar();
        }));
        $('seg-aplicar').addEventListener('click', aplicar);
    }

    async function aplicar() {
        const boton = $('seg-aplicar');
        if (boton) boton.disabled = true;
        const marcado = (sel) => { const c = $('modal-body').querySelector(sel); return !c || c.checked; };
        const { asuntos, desaparecidos } = ui.plan;
        let creados = 0, actualizados = 0, terminados = 0, agendadas = 0, descartadosNuevos = 0;
        const fallos = [];
        try {
            await enLoteCore(async () => {
                for (const a of asuntos) {
                    if (a.asunto.fuera || a.omitido) continue;
                    for (let i = 0; i < a.pendientes.length; i++) {
                        const p = a.pendientes[i];
                        const sel = '[data-p="' + CSS.escape(a.asunto.clave + '|' + i) + '"]';
                        try {
                            if (p.accionPlan === 'nuevo' && marcado(sel)) {
                                await crearPendienteCore(p.datos);
                                creados++;
                            } else if (p.accionPlan === 'actualizar' && marcado(sel)) {
                                await actualizarPendienteCore(p.existente.id, p.cambios);
                                actualizados++;
                            } else if (p.accionPlan === 'igual' && p.cambios && p.cambios.origen) {
                                // Sin cambios a la vista, pero queda anotado de qué
                                // revisión viene (sin tocar su evento del calendario).
                                await actualizarPendiente(p.existente.id, { origen: p.cambios.origen });
                            }
                        } catch (e) {
                            fallos.push(p.accion);
                        }
                    }
                }
                for (const a of asuntos) {
                    if (a.asunto.fuera || a.omitido) continue;
                    for (let i = 0; i < a.audiencias.length; i++) {
                        const au = a.audiencias[i];
                        if (au.accionPlan === 'igual' || !marcado('[data-aud="' + CSS.escape(a.asunto.clave + '|' + i) + '"]')) continue;
                        try {
                            if (au.accionPlan === 'nuevo') await crearEventoCore(au.datos);
                            else await actualizarEventoCore(au.existente.id, au.cambios);
                            agendadas++;
                        } catch (e) {
                            fallos.push(au.descripcion);
                        }
                    }
                }
                for (const x of desaparecidos) {
                    if (!marcado('[data-desap="' + CSS.escape(String(x.id)) + '"]')) continue;
                    try { await completarPendienteCore(x.id, true); terminados++; } catch (e) { fallos.push(x.titulo); }
                }

                // Lo desmarcado se recuerda para no volver a proponerlo. Se
                // guarda dentro del lote para que viaje en la misma sincronización.
                const nuevos = [];
                for (const a of asuntos) {
                    if (a.asunto.fuera || a.omitido) continue;
                    a.pendientes.forEach((p, i) => {
                        if ((p.accionPlan === 'nuevo' || p.accionPlan === 'actualizar') &&
                            !marcado('[data-p="' + CSS.escape(a.asunto.clave + '|' + i) + '"]')) nuevos.push(descarteDe(a.asunto.clave, p.accion));
                    });
                    a.audiencias.forEach((au, i) => {
                        if (au.accionPlan !== 'igual' && !marcado('[data-aud="' + CSS.escape(a.asunto.clave + '|' + i) + '"]')) {
                            nuevos.push(descarteDe(a.asunto.clave, au.descripcion, au.fecha));
                        }
                    });
                }
                for (const x of desaparecidos) {
                    if (!marcado('[data-desap="' + CSS.escape(String(x.id)) + '"]')) nuevos.push(descarteDe(x.origen.asunto, x.titulo));
                }
                const quedan = (await leerDescartados()).filter(d => !ui.recuperar.has(d.id));
                if (nuevos.length || ui.recuperar.size) {
                    descartadosNuevos = nuevos.length;
                    await guardarDescartados(fusionarDescartados(quedan, nuevos));
                }
            });
        } finally {
            // Lo que el usuario eligió a mano se recuerda para la próxima semana.
            const guardadas = leerAsignaciones();
            for (const a of asuntos) {
                if (a.por === 'usuario') guardadas[a.asunto.clave] = a.omitido ? OMITIR : a.expedienteId;
            }
            guardarAsignaciones(guardadas);
        }
        if (typeof cerrarModal === 'function') cerrarModal();
        const partes = [];
        if (creados) partes.push(`${creados} nuevos`);
        if (actualizados) partes.push(`${actualizados} actualizados`);
        if (terminados) partes.push(`${terminados} terminados`);
        if (agendadas) partes.push(`${agendadas} audiencias al calendario`);
        if (descartadosNuevos) partes.push(`${descartadosNuevos} desmarcados no volverán a aparecer`);
        toast('Seguimiento importado: ' + (partes.join(', ') || 'sin cambios') + (fallos.length ? ` · ${fallos.length} no se pudieron guardar` : ''),
            fallos.length ? 'warning' : 'success');
    }

    global.SEGUIMIENTO = { ...Motor, abrir, cargarArchivo };
})(typeof window !== 'undefined' ? window : globalThis);
