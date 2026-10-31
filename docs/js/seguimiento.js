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
 *   - si el índice cataloga el mismo asunto dos veces (dos carpetas, una
 *     subcarpeta, un nombre escrito distinto), sus pendientes entran una
 *     sola vez, y los que ya se habían duplicado se proponen para cerrar;
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
    // Dos asuntos del índice sin números que los distingan son el mismo si se
    // llaman casi igual (y son del mismo cliente y materia).
    const UMBRAL_TITULO = 0.75;
    const PRIORIDADES = { ALTA: 'alta', MEDIA: 'media', BAJA: 'baja' };

    const VACIAS = new Set([
        'el', 'la', 'los', 'las', 'de', 'del', 'que', 'con', 'por', 'para', 'una', 'uno', 'unos', 'unas',
        'sus', 'son', 'sea', 'ser', 'hay', 'ante', 'sobre', 'entre', 'como', 'mas', 'sin', 'desde', 'hasta',
        'este', 'esta', 'ese', 'esa', 'lo', 'al', 'se', 'si', 'su', 'en', 'y', 'o', 'a', 'e', 'u', 'vs',
        'sa', 'cv', 'rl', 'sc', 'lic', 'exp', 'num', 'and'
    ]);

    // "29-sep", "29 sept" y "29 de septiembre" dicen lo mismo. La abreviatura
    // solo cuenta junto a un día: "Mar" también es apellido.
    const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
        septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    const MESES_CORTOS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8,
        sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12 };

    function normalizar(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/\s+/g, ' ').trim();
    }

    // Los números cuentan aunque sean cortos: "29-sep" y "8-oct" distinguen
    // dos escritos que por lo demás se redactan igual. Los meses se escriben
    // como número ("m09") y el plural cuenta como el singular ("acuerdos" es
    // "acuerdo"): la revisión redacta cada semana un poco distinto.
    function palabras(s) {
        const t = normalizar(s).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter(Boolean);
        const esDia = (x) => /^\d{1,2}$/.test(x || '');
        for (let i = 0; i < t.length; i++) {
            let mes = MESES[t[i]];
            if (!mes && MESES_CORTOS[t[i]] && (esDia(t[i - 1]) || (t[i - 1] === 'de' && esDia(t[i - 2])))) mes = MESES_CORTOS[t[i]];
            if (mes) t[i] = 'm' + String(mes).padStart(2, '0');
        }
        return t.filter(p => /\d/.test(p) || (p.length >= 3 && !VACIAS.has(p)))
            .map(p => (p.length >= 5 && !/\d/.test(p) && p.endsWith('s') ? p.slice(0, -1) : p));
    }

    const compactas = new Map();
    /**
     * Una clave de asunto sin mayúsculas, acentos, signos ni conectores:
     * "Asuntos López/vs Alfa" y "asuntos lopez / vs alfa" son la misma
     * carpeta, y "Fit & More" y "fit and more" también. Todo lo demás cuenta:
     * "Arrendamientos A" y "Arrendamientos B" son dos carpetas.
     */
    function compacta(clave) {
        const k = String(clave == null ? '' : clave);
        if (!compactas.has(k)) {
            compactas.set(k, normalizar(k).replace(/[^a-z0-9]+/g, ' ').split(' ')
                .filter(t => t && t !== 'y' && t !== 'and').join(' '));
        }
        return compactas.get(k);
    }
    function mismaClave(a, b) {
        if (a == null || b == null) return false;
        if (a === b) return true;
        const ca = compacta(a);
        return !!ca && ca === compacta(b);
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
            // La misma carpeta dos veces (aunque se escriba distinto: "Fit & More"
            // y "fit and more"): se juntan sus pendientes.
            const llave = compacta(clave) || clave;
            if (vistos.has(llave)) {
                const previo = vistos.get(llave);
                for (const p of pendientes) if (!previo.pendientes.some(x => parecido(x.accion, p.accion) >= 0.85)) previo.pendientes.push(p);
                previo.audiencias.push(...asunto.audiencias);
                return;
            }
            vistos.set(llave, asunto);
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

    function numerosDe(asunto) {
        return numerosEn(asunto.expedientes.join(' ') + ' ' + asunto.titulo);
    }

    function clientesCompatibles(x, y) {
        const a = normalizar(x), b = normalizar(y);
        return !a || !b || a.includes(b) || b.includes(a) || parecido(a, b) >= UMBRAL_NOMBRE;
    }

    /**
     * ¿Dos nombres de asunto se distinguen por un código corto? "Local A" y
     * "Local B", "Juicio I" y "Juicio II" o "Bodega 3" y "Bodega 4" son
     * asuntos distintos aunque todo lo demás coincida.
     */
    function codigosDistintos(x, y) {
        // Las letras sueltas cuentan: "A" puede ser el nombre del local.
        const fichas = (s) => new Set(normalizar(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(t => t && !(t.length >= 2 && VACIAS.has(t))));
        const codigo = (t) => /\d/.test(t) || /^[ivx]{1,4}$/.test(t) || (t.length <= 2 && !['ya', 'no', 'mi', 'tu', 'le', 'me', 'te', 'ni', 'un'].includes(t));
        const fx = fichas(x), fy = fichas(y);
        for (const t of fx) if (!fy.has(t) && codigo(t)) return true;
        for (const t of fy) if (!fx.has(t) && codigo(t)) return true;
        return false;
    }

    /**
     * Lo que separa a dos asuntos del índice aunque se parezcan: números de
     * expediente sin ninguno en común, materias distintas o clientes
     * distintos. La querella por fraude no es el juicio civil del mismo cliente.
     */
    function distintos(a, b) {
        if (mismaClave(a.clave, b.clave)) return false;
        const ma = palabras(a.materia)[0], mb = palabras(b.materia)[0];
        if (ma && mb && ma !== mb) return true;
        if (!clientesCompatibles(a.cliente, b.cliente)) return true;
        const na = numerosDe(a), nb = numerosDe(b);
        return na.size > 0 && nb.size > 0 && ![...na].some(n => nb.has(n));
    }

    /**
     * ¿Dos asuntos del índice son el mismo? La revisión a veces cataloga un
     * asunto dos veces: dos carpetas, una subcarpeta, un nombre escrito
     * distinto. Lo son si su carpeta dice lo mismo; o, si nada los separa, si
     * comparten un número de expediente o, sin números, son del mismo cliente
     * y se llaman casi igual.
     */
    function mismoAsunto(a, b) {
        if (mismaClave(a.clave, b.clave)) return true;
        if (distintos(a, b)) return false;
        if (numerosDe(a).size && numerosDe(b).size) return true; // comparten alguno: si no, serían distintos
        return !!normalizar(a.cliente) && !!normalizar(b.cliente) && parecido(a.titulo, b.titulo) >= UMBRAL_TITULO &&
            !codigosDistintos(a.titulo, b.titulo);
    }

    /**
     * Junta los asuntos del índice que son el mismo. Devuelve, para cada uno,
     * la posición del primero de su grupo. Un asunto entra a un grupo solo si
     * no choca con ninguno de los que ya están (así un asunto sin números no
     * une dos juicios de números distintos).
     */
    function agrupar(asuntos) {
        const grupo = [];
        const miembros = new Map();
        asuntos.forEach((a, j) => {
            let elegido = j;
            if (!a.fuera) {
                for (const [primero, ms] of miembros) {
                    if (ms.some(i => mismoAsunto(asuntos[i], a)) && !ms.some(i => distintos(asuntos[i], a))) { elegido = primero; break; }
                }
                miembros.set(elegido, [...(miembros.get(elegido) || []), j]);
            }
            grupo.push(elegido);
        });
        return grupo;
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
     * Un asunto que el índice cataloga dos veces (ver mismoAsunto) aporta sus
     * pendientes una sola vez: lo que trae el segundo y ya trajo el primero
     * queda como "repetido", y si de antes había quedado duplicado, el
     * duplicado se propone para cerrar.
     *
     * Devuelve { asuntos: [...], desaparecidos: [...], repetidos: [...], totales, semana }.
     */
    function planificar(entrada, ctx) {
        const expedientes = ctx.expedientes || [];
        const todos = ctx.pendientes || [];
        const asignaciones = ctx.asignaciones || {};
        const usados = new Set();
        const totales = { asuntos: 0, nuevos: 0, actualizar: 0, iguales: 0, yaTerminados: 0, desaparecidos: 0, fuera: 0, omitidos: 0, sinExpediente: 0,
            audienciasNuevas: 0, audienciasActualizar: 0, audienciasIguales: 0, repetidos: 0, repetidosExistentes: 0, audienciasRepetidas: 0 };
        // Los eventos que reflejan un pendiente no son audiencias.
        const eventos = (ctx.eventos || []).filter(e => e.pendienteId == null);
        const eventosUsados = new Set();
        const hoy = ctx.hoy || diaDe(new Date().toISOString());
        const semana = semanaDelReporte(ctx.revision || hoy);
        totales.fueraDelReporte = 0;
        totales.descartados = 0;
        const descartados = ctx.descartados || [];
        const descartado = (asunto, texto, fecha) => descartados.find(d => mismaClave(d.asunto, asunto) &&
            (d.fecha || null) === (fecha || null) && parecido(d.accion, texto) >= UMBRAL_MISMO);
        const delSeguimiento = (x) => !!(x && x.origen && x.origen.tipo === ORIGEN);

        // Lo que ya se importó antes, por asunto: así se sabe a qué
        // expediente se asignó aunque el número no coincida.
        const asignadoAntes = new Map();
        for (const p of todos) {
            if (delSeguimiento(p) && p.origen.asunto) {
                const k = compacta(p.origen.asunto) || p.origen.asunto;
                if (!asignadoAntes.has(k)) asignadoAntes.set(k, p.expedienteId != null ? p.expedienteId : null);
            }
        }
        const porId = new Map(expedientes.map(e => [e.id, e]));
        const eleccion = (clave) => {
            if (Object.prototype.hasOwnProperty.call(asignaciones, clave)) return { hay: true, valor: asignaciones[clave] };
            const k = Object.keys(asignaciones).find(x => mismaClave(x, clave));
            return k === undefined ? { hay: false } : { hay: true, valor: asignaciones[k] };
        };

        // 1. A qué expediente va cada asunto.
        const lista = entrada.asuntos;
        const grupos = agrupar(lista);
        const asuntos = lista.map(asunto => {
            const auto = emparejar(asunto, expedientes, ctx.nombreCarpetaDe);
            const manual = eleccion(asunto.clave);
            const antes = compacta(asunto.clave) || asunto.clave;
            let expedienteId, por;
            if (manual.hay) {
                expedienteId = manual.valor;
                por = 'usuario';
            } else if (auto.expediente) {
                expedienteId = auto.expediente.id;
                por = auto.por;
            } else if (asignadoAntes.has(antes) && (asignadoAntes.get(antes) == null || porId.has(asignadoAntes.get(antes)))) {
                expedienteId = asignadoAntes.get(antes);
                por = 'antes';
            } else {
                expedienteId = null;
                por = null;
            }
            const omitido = expedienteId === 'omitir';
            return {
                asunto, expedienteId: omitido ? null : expedienteId, por, omitido,
                candidatos: auto.candidatos, pendientes: [], audiencias: []
            };
        });

        // 2. Un asunto que el índice repite y que por sí solo no encontró
        // expediente va al de su gemelo, si el gemelo tiene uno (y solo uno).
        asuntos.forEach((plan, i) => {
            if (plan.asunto.fuera || plan.omitido || plan.por !== null) return;
            const gemelos = asuntos.filter((o, j) => j !== i && grupos[j] === grupos[i] && !o.asunto.fuera && !o.omitido && o.expedienteId != null);
            if (gemelos.length && new Set(gemelos.map(o => o.expedienteId)).size === 1) {
                plan.expedienteId = gemelos[0].expedienteId;
                plan.por = 'grupo';
                plan.gemelo = gemelos[0].asunto.titulo;
            }
        });

        // Lo que esta importación ya dejó en cada destino (un expediente, o el
        // grupo de un asunto sin expediente): otro asunto que va al mismo
        // lugar no lo repite.
        const planeados = new Map();
        const audPlaneadas = new Map();
        const enDestino = (mapa, destino) => {
            if (!mapa.has(destino)) mapa.set(destino, []);
            return mapa.get(destino);
        };
        const repetidos = [];
        const cerrarRepetido = (x, gemelo) => {
            usados.add(x.id);
            // Solo se propone cerrar lo que trajo la importación, nunca lo
            // que el usuario capturó a mano; y lo que ya conservó no vuelve.
            if (x.completado || !delSeguimiento(x) || descartado(x.origen.asunto, x.titulo)) return;
            repetidos.push({ existente: x, gemelo });
            totales.repetidosExistentes++;
        };

        // Importados antes cuya carpeta ya no está en el índice: si la carpeta
        // cambió de nombre, se reconocen por el nombre del asunto.
        const huerfanos = new Set(todos.filter(x => delSeguimiento(x) && !lista.some(a => mismaClave(a.clave, x.origen.asunto))).map(x => x.id));

        // 3. Los pendientes y las audiencias de cada asunto.
        asuntos.forEach((plan, i) => {
            const asunto = plan.asunto;
            if (asunto.fuera) { totales.fuera++; return; }
            if (plan.omitido) { totales.omitidos++; return; }
            totales.asuntos++;
            if (plan.expedienteId == null) totales.sinExpediente++;
            const destino = plan.expedienteId != null ? 'e:' + plan.expedienteId : 'g:' + grupos[i];
            const previos = enDestino(planeados, destino);
            const gemelos = lista.filter((a, j) => j !== i && grupos[j] === grupos[i]).map(a => a.clave);

            // Los que ya existen y pueden ser de este asunto.
            const existentes = todos.filter(x => !usados.has(x.id) && (
                (delSeguimiento(x) && mismaClave(x.origen.asunto, asunto.clave)) ||
                (plan.expedienteId != null && x.expedienteId === plan.expedienteId) ||
                (plan.expedienteId == null && x.expedienteId == null && delSeguimiento(x) &&
                    gemelos.some(c => mismaClave(c, x.origen.asunto))) ||
                (plan.expedienteId == null && x.expedienteId == null && huerfanos.has(x.id) &&
                    parecido(x.expedienteTexto || '', asunto.titulo) >= UMBRAL_TITULO)));

            // Cada pendiente del índice con su existente, de la pareja más
            // parecida a la menos: así uno que solo se parece no le quita a
            // otro el que es idéntico.
            const pareja = new Map();
            const pares = [];
            asunto.pendientes.forEach((p, k) => {
                for (const x of existentes) {
                    const v = parecido(x.titulo, p.accion);
                    if (v >= UMBRAL_MISMO) pares.push({ k, x, v });
                }
            });
            pares.sort((a, b) => b.v - a.v);
            const tomados = new Set();
            for (const { k, x } of pares) {
                if (pareja.has(k) || tomados.has(x.id)) continue;
                pareja.set(k, x);
                tomados.add(x.id);
            }

            asunto.pendientes.forEach((p, k) => {
                const mejor = pareja.get(k) || null;
                // Lo que el usuario desmarcó otra semana no se vuelve a proponer.
                const desc = descartado(asunto.clave, p.accion);
                if (desc) {
                    if (mejor) usados.add(mejor.id);
                    plan.pendientes.push({ ...p, accionPlan: 'descartado', descartado: desc });
                    totales.descartados++;
                    return;
                }

                // ¿Ya lo trajo otro asunto del índice que va al mismo lugar? (Los
                // del mismo asunto ya se juntaron al leer el índice.)
                let fecha = p.fecha;
                const gemelo = previos.find(g => g.asunto !== asunto.clave && parecido(g.accion, p.accion) >= UMBRAL_MISMO);
                if (gemelo) {
                    if (gemelo.entrada.accionPlan === 'nuevo' && mejor) {
                        // El gemelo iba a crearse, pero este ya existe: se
                        // queda el que existe, con la fecha más próxima de los dos.
                        if (gemelo.fecha && (!fecha || gemelo.fecha < fecha)) fecha = gemelo.fecha;
                        const e = gemelo.entrada;
                        e.accionPlan = 'repetido';
                        e.gemelo = { asunto: asunto.titulo, accion: p.accion };
                        delete e.datos;
                        totales.nuevos--;
                        totales.repetidos++;
                        previos.splice(previos.indexOf(gemelo), 1);
                    } else {
                        // De dos fechas para lo mismo manda la más próxima.
                        const e = gemelo.entrada;
                        if (fecha && (!gemelo.fecha || fecha < gemelo.fecha)) {
                            gemelo.fecha = fecha;
                            e.fecha = fecha;
                            if (e.accionPlan === 'nuevo') e.datos.fechaLimite = isoDeFecha(fecha);
                            else if ((e.accionPlan === 'igual' || e.accionPlan === 'actualizar') && diaDe(e.existente.fechaLimite) !== fecha) {
                                e.cambios.fechaLimite = isoDeFecha(fecha);
                                if (e.accionPlan === 'igual') { e.accionPlan = 'actualizar'; totales.iguales--; totales.actualizar++; }
                            }
                        }
                        if (mejor) cerrarRepetido(mejor, { asunto: gemelo.titulo, accion: gemelo.accion });
                        plan.pendientes.push({ ...p, accionPlan: 'repetido', gemelo: { asunto: gemelo.titulo, accion: gemelo.accion } });
                        totales.repetidos++;
                        return;
                    }
                }

                const datos = {
                    titulo: p.accion,
                    descripcion: descripcionDe(asunto, p),
                    expedienteId: plan.expedienteId,
                    expedienteTexto: plan.expedienteId == null ? asunto.titulo : null,
                    fechaLimite: isoDeFecha(fecha),
                    prioridad: p.prioridad,
                    origen: { tipo: ORIGEN, asunto: asunto.clave, revision: ctx.revision || null }
                };
                const anotar = (entradaPlan) => {
                    plan.pendientes.push(entradaPlan);
                    previos.push({ asunto: asunto.clave, titulo: asunto.titulo, accion: p.accion, fecha, entrada: entradaPlan });
                };
                if (!mejor) {
                    // Lo que el reporte de Word no lleva no se agrega (si ya
                    // existía sí se reconoce, para no darlo por desaparecido).
                    if (!ctx.todos && !semana.incluye({ ...p, fecha })) {
                        plan.pendientes.push({ ...p, fecha, accionPlan: 'fuera' });
                        totales.fueraDelReporte++;
                        return;
                    }
                    anotar({ ...p, fecha, accionPlan: 'nuevo', datos });
                    totales.nuevos++;
                    return;
                }
                usados.add(mejor.id);
                if (mejor.completado) {
                    anotar({ ...p, fecha, accionPlan: 'terminado', existente: mejor });
                    totales.yaTerminados++;
                    return;
                }
                // Ya existe: se trae lo que cambió. El título solo se reescribe
                // si lo había puesto la importación, no si lo escribió el usuario.
                const cambios = {};
                const importado = delSeguimiento(mejor);
                if (fecha && diaDe(mejor.fechaLimite) !== fecha) cambios.fechaLimite = datos.fechaLimite;
                if (p.prioridad && mejor.prioridad !== p.prioridad) cambios.prioridad = p.prioridad;
                if (importado) {
                    if (mejor.titulo !== datos.titulo) cambios.titulo = datos.titulo;
                    if ((mejor.descripcion || '') !== datos.descripcion) cambios.descripcion = datos.descripcion;
                }
                if (!importado || (mejor.origen.asunto !== asunto.clave)) cambios.origen = datos.origen;
                else if (ctx.revision && mejor.origen.revision !== ctx.revision) cambios.origen = datos.origen;
                const visibles = Object.keys(cambios).filter(c => c !== 'origen');
                if (visibles.length) {
                    anotar({ ...p, fecha, accionPlan: 'actualizar', existente: mejor, cambios });
                    totales.actualizar++;
                } else {
                    anotar({ ...p, fecha, accionPlan: 'igual', existente: mejor, cambios });
                    totales.iguales++;
                }
            });

            // Audiencias: las que aún no pasan van al calendario. Las pasadas
            // no: la revisión ya las trae como pendiente ("registrar resultado").
            const audPrevias = enDestino(audPlaneadas, destino);
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
                    (delSeguimiento(e) && mismaClave(e.origen.asunto, asunto.clave) && parecido(e.titulo, au.descripcion) >= 0.4) ||
                    (plan.expedienteId != null && e.expedienteId === plan.expedienteId && (e.tipo === 'audiencia' || parecido(e.titulo, au.descripcion) >= 0.4))));
                // La misma audiencia que ya trajo otro asunto del índice que va al mismo lugar.
                const gemela = audPrevias.find(g => g.fecha === au.fecha && parecido(g.descripcion, au.descripcion) >= 0.4);
                if (gemela) {
                    if (gemela.entrada.accionPlan === 'nuevo' && existente) {
                        gemela.entrada.accionPlan = 'repetida';
                        gemela.entrada.gemelo = asunto.titulo;
                        delete gemela.entrada.datos;
                        totales.audienciasNuevas--;
                        totales.audienciasRepetidas++;
                        audPrevias.splice(audPrevias.indexOf(gemela), 1);
                    } else {
                        if (existente) eventosUsados.add(existente.id);
                        plan.audiencias.push({ ...au, accionPlan: 'repetida', gemelo: gemela.titulo });
                        totales.audienciasRepetidas++;
                        continue;
                    }
                }
                const anotar = (entradaPlan) => {
                    plan.audiencias.push(entradaPlan);
                    audPrevias.push({ fecha: au.fecha, descripcion: au.descripcion, titulo: asunto.titulo, entrada: entradaPlan });
                };
                if (!existente) {
                    anotar({ ...au, accionPlan: 'nuevo', datos });
                    totales.audienciasNuevas++;
                    continue;
                }
                eventosUsados.add(existente.id);
                const cambios = {};
                if (au.hora && (existente.todoElDia || existente.fechaInicio !== datos.fechaInicio)) {
                    cambios.fechaInicio = datos.fechaInicio;
                    cambios.todoElDia = false;
                }
                if (delSeguimiento(existente)) {
                    if (existente.titulo !== datos.titulo) cambios.titulo = datos.titulo;
                    if ((existente.descripcion || '') !== datos.descripcion) cambios.descripcion = datos.descripcion;
                }
                if (Object.keys(cambios).length) {
                    anotar({ ...au, accionPlan: 'actualizar', existente, cambios });
                    totales.audienciasActualizar++;
                } else {
                    anotar({ ...au, accionPlan: 'igual', existente });
                    totales.audienciasIguales++;
                }
            }
        });

        // Importados antes, abiertos, que esta revisión ya no trae. Los de
        // asuntos que el usuario dejó fuera no se tocan.
        const omitidas = asuntos.filter(a => a.omitido).map(a => a.asunto.clave);
        const desaparecidos = todos.filter(x => !x.completado && !usados.has(x.id) &&
            delSeguimiento(x) && !omitidas.some(c => mismaClave(c, x.origen.asunto)) &&
            !descartado(x.origen.asunto, x.titulo));
        totales.desaparecidos = desaparecidos.length;

        return { asuntos, desaparecidos, repetidos, totales, semana };
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

    /**
     * Los asuntos que el usuario pidió no importar, para la sincronización:
     * [{ asunto, omitir, el }]. Recuperar un asunto también se anota (omitir
     * false): así, si se recupera en un dispositivo, no lo vuelve a ocultar
     * el otro.
     */
    function omisionDe(asunto, omitir) {
        return { asunto, omitir: !!omitir, el: new Date().toISOString() };
    }

    /** Une las omisiones de dos dispositivos: de cada asunto manda la más reciente. */
    function fusionarOmitidos(a, b) {
        const mapa = new Map();
        for (const o of [...(a || []), ...(b || [])]) {
            if (!o || !o.asunto) continue;
            const previa = mapa.get(o.asunto);
            if (!previa || (o.el || '') > (previa.el || '') || ((o.el || '') === (previa.el || '') && o.omitir && !previa.omitir)) {
                mapa.set(o.asunto, o);
            }
        }
        return Array.from(mapa.values()).sort((x, y) => (x.asunto < y.asunto ? -1 : x.asunto > y.asunto ? 1 : 0));
    }

    /**
     * Las asignaciones de este dispositivo con las omisiones sincronizadas
     * encima: lo omitido en otro dispositivo se omite aquí, y lo recuperado
     * allá deja de omitirse aquí. Un "no importar" de antes de sincronizarse
     * (sin anotar) se respeta.
     */
    function asignacionesConOmitidos(locales, omitidos) {
        const asignaciones = { ...(locales || {}) };
        for (const o of omitidos || []) {
            if (!o || !o.asunto) continue;
            if (o.omitir) asignaciones[o.asunto] = 'omitir';
            else if (asignaciones[o.asunto] === 'omitir') delete asignaciones[o.asunto];
        }
        return asignaciones;
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
        descarteDe, fusionarDescartados, omisionDe, fusionarOmitidos, asignacionesConOmitidos,
        compacta, mismaClave, mismoAsunto, agrupar
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
    // Los asuntos que se pidió no importar. Como lo desmarcado, van en la base
    // y viajan en la sincronización: no reaparecen en ningún dispositivo.
    const CLAVE_OMITIDOS = 'seguimiento_omitidos';

    async function leerOmitidos() {
        try {
            const v = typeof obtenerConfig === 'function' ? await obtenerConfig(CLAVE_OMITIDOS) : null;
            return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
    }
    async function guardarOmitidos(lista) {
        if (typeof guardarConfig === 'function') await guardarConfig(CLAVE_OMITIDOS, lista);
    }
    global.obtenerSeguimientoOmitidos = leerOmitidos;
    global.fusionarSeguimientoOmitidos = fusionarOmitidos;
    global.aplicarSeguimientoOmitidos = async (remotos) => {
        await guardarOmitidos(fusionarOmitidos(await leerOmitidos(), remotos));
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
        ui.omitidosSync = await leerOmitidos();
        ui.asignaciones = asignacionesConOmitidos(leerAsignaciones(), ui.omitidosSync);
        // Los que se pidió no importar en otra semana ya no se enseñan; solo
        // se pueden recuperar desde su bloque, al final.
        ui.omitidosAntes = new Set(Object.keys(ui.asignaciones).filter(k => ui.asignaciones[k] === OMITIR));
        ui.restaurar = new Set();
        ui.asignacionCambiada = false;
        // Lo que el usuario desmarca en la vista previa. Cambiar una asignación
        // la vuelve a pintar, y antes todo regresaba marcado sin avisar.
        ui.desmarcados = new Set();
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

    /** ' checked', salvo que el usuario la haya desmarcado en esta vista previa. */
    function marca(clave) {
        return ui.desmarcados && ui.desmarcados.has(clave) ? '' : ' checked';
    }

    /** ¿Este asunto ya se había pedido no importar? (La carpeta puede venir escrita distinto.) */
    function fueOmitido(clave) {
        return [...ui.omitidosAntes].some(k => mismaClave(k, clave));
    }

    /** El expediente o el asunto al que pertenece un pendiente de la app. */
    function contextoDe(x) {
        const exp = x.expedienteId != null ? ui.expedientes.find(e => e.id === x.expedienteId) : null;
        return exp ? etiquetaExp(exp) : (x.expedienteTexto || 'sin expediente');
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
            '<label><input type="checkbox" data-p="' + id + '"' + marca('p:' + a.asunto.clave + '|' + i) + '>' +
            '<span class="seg-cuerpo"><span class="seg-meta">' +
                '<span class="seg-fecha">' + esc(fechaCorta(p.fecha)) + '</span>' +
                (p.prioridad === 'alta' ? '<span class="seg-alta" title="Prioridad alta">ALTA</span>' : '') +
                (p.tipo ? '<span class="seg-tipo">' + esc(p.tipo) + '</span>' : '') +
            '</span><span class="seg-accion">' + esc(p.accion) + '</span>' + detalle + '</span></label>' +
        '</li>';
    }

    function pintar() {
        replanificar();
        const { asuntos, desaparecidos, repetidos, totales, semana } = ui.plan;
        const activos = asuntos.filter(a => !a.asunto.fuera && !a.omitido);
        const ocultos = asuntos.filter(a => !a.asunto.fuera && a.omitido && fueOmitido(a.asunto.clave));
        const porConfirmar = asuntos.filter(a => !a.asunto.fuera && !ocultos.includes(a) &&
            (a.por === 'nombre' || a.por === 'grupo' || a.por === null || a.por === 'usuario' || a.omitido));
        const errores = (ui.entrada && ui.entrada.errores) || [];

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
                (totales.repetidos ? ` · ${totales.repetidos} repetido${totales.repetidos !== 1 ? 's' : ''} en otro asunto del índice se importa${totales.repetidos !== 1 ? 'n' : ''} una sola vez` : '') +
                (errores.length ? ` · <span title="${esc(errores.join('\n'))}">${errores.length} elemento${errores.length !== 1 ? 's' : ''} del índice no se pudo leer</span>` : '') +
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
            const cuantos = (f) => porConfirmar.filter(f).length;
            const como = [
                [cuantos(a => a.por === 'nombre'), 'por parecido con el cliente, la contraparte o la carpeta'],
                [cuantos(a => a.por === 'grupo'), 'por ser el mismo asunto que otro del índice'],
                [cuantos(a => a.por === null && !a.omitido), 'sin expediente en la app, con el nombre del asunto'],
                [cuantos(a => a.por === 'usuario'), 'como los elegiste tú']
            ].filter(([n]) => n).map(([n, t]) => n + ' ' + t);
            html += '<details class="seg-bloque" id="seg-asignacion"' + (ui.verAsignacion ? ' open' : '') + '>' +
                '<summary>Expedientes asignados sin número (' + porConfirmar.length + ')</summary>' +
                '<p class="seg-nota">Así quedaron: ' + como.join('; ') + '. Corrige aquí solo si alguno está mal; se recuerda para la próxima semana.</p>' +
                porConfirmar.map(a =>
                    '<div class="seg-asignar"><div><strong>' + esc(a.asunto.titulo) + '</strong>' +
                    (a.asunto.expedientes.length ? '<small>' + esc(a.asunto.expedientes.join(' · ')) + '</small>' : '') +
                    (a.por === 'grupo' ? '<small>Es el mismo asunto que «' + esc(a.gemelo) + '»</small>' : '') + '</div>' +
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

        // El mismo asunto dos veces en el índice: lo repetido se importa una vez.
        const repetidosIndice = activos.flatMap(a => [
            ...a.pendientes.filter(p => p.accionPlan === 'repetido').map(p => ({ texto: p.accion, asunto: a.asunto.titulo, gemelo: p.gemelo.asunto })),
            ...a.audiencias.filter(au => au.accionPlan === 'repetida').map(au => ({ texto: au.descripcion, asunto: a.asunto.titulo, gemelo: au.gemelo }))
        ]);
        if (repetidosIndice.length) {
            html += '<details class="seg-bloque" id="seg-repetidos-indice"><summary>Repetidos en el índice (' + repetidosIndice.length + ')</summary>' +
                '<p class="seg-nota">El índice trae el mismo asunto dos veces. Esto ya viene en el otro y se importa una sola vez.</p><ul>' +
                repetidosIndice.map(r => '<li class="seg-p"><span class="seg-cuerpo"><span class="seg-accion">' + esc(r.texto) + '</span>' +
                    '<span class="seg-cambio">' + esc(r.asunto) + ' · es el mismo que en «' + esc(r.gemelo) + '»</span></span></li>').join('') +
            '</ul></details>';
        }

        // Duplicados de importaciones anteriores: se proponen para cerrar.
        if (repetidos.length) {
            html += '<details class="seg-bloque" id="seg-repetidos" open><summary>Repetidos que ya tenías (' + repetidos.length + ')</summary>' +
                '<p class="seg-nota">Se importaron dos veces porque el índice repetía el asunto. Los marcados se dan por terminados y queda el otro; los que desmarques se quedan como están y no se vuelven a proponer.</p><ul>' +
                repetidos.map(r => '<li class="seg-p"><label><input type="checkbox" data-rep="' + esc(r.existente.id) + '"' + marca('rep:' + r.existente.id) + '>' +
                    '<span class="seg-cuerpo"><span class="seg-accion">' + esc(r.existente.titulo) + '</span>' +
                    '<span class="seg-cambio">' + esc(contextoDe(r.existente)) + ' · queda el de «' + esc(r.gemelo.asunto) + '»</span></span></label></li>').join('') +
            '</ul></details>';
        }

        // Los asuntos que se pidió no importar: no se enseñan, pero se pueden recuperar.
        if (ocultos.length) {
            html += '<details class="seg-bloque" id="seg-omitidos"><summary>Asuntos que pediste no importar (' + ocultos.length + ')</summary>' +
                '<p class="seg-nota">No se muestran ni se importan aunque vengan en el índice. Marca los que quieras volver a importar.</p><ul>' +
                ocultos.map(a => '<li class="seg-p"><label><input type="checkbox" data-restaurar="' + esc(a.asunto.clave) + '">' +
                    '<span class="seg-cuerpo"><span class="seg-accion">' + esc(a.asunto.titulo) + '</span></span></label></li>').join('') +
            '</ul></details>';
        }

        // Audiencias que aún no pasan y van (o cambian) en el calendario.
        const audiencias = activos.flatMap(a => a.audiencias.map((au, i) => ({ a, au, i })))
            .filter(x => x.au.accionPlan === 'nuevo' || x.au.accionPlan === 'actualizar');
        if (audiencias.length) {
            html += '<details class="seg-bloque" open><summary>Audiencias al calendario (' + audiencias.length + ')</summary><ul>' +
                audiencias.map(({ a, au, i }) => '<li class="seg-p"><label><input type="checkbox" data-aud="' + esc(a.asunto.clave + '|' + i) + '"' + marca('aud:' + a.asunto.clave + '|' + i) + '>' +
                    '<span class="seg-cuerpo"><span class="seg-meta"><span class="seg-fecha">' + esc(fechaCorta(au.fecha)) + (au.hora ? ' ' + esc(au.hora) : '') + '</span>' +
                    (au.accionPlan === 'actualizar' ? '<span class="seg-tipo">CAMBIA</span>' : '') + '</span>' +
                    '<span class="seg-accion">' + esc(au.descripcion) + '</span>' +
                    '<span class="seg-cambio">' + esc(a.asunto.titulo + (au.lugar ? ' · ' + au.lugar : '')) + '</span></span></label></li>').join('') +
            '</ul></details>';
        }

        if (desaparecidos.length) {
            html += '<details class="seg-bloque" open><summary>Ya no aparecen en la revisión (' + desaparecidos.length + ')</summary>' +
                '<p class="seg-nota">Los importaste antes y esta revisión ya no los trae. Los marcados se darán por terminados; los que desmarques se quedan como están y no se vuelven a proponer.</p><ul>' +
                desaparecidos.map(x => '<li class="seg-p"><label><input type="checkbox" data-desap="' + esc(x.id) + '"' + marca('desap:' + x.id) + '>' +
                    '<span class="seg-cuerpo"><span class="seg-accion">' + esc(x.titulo) + '</span>' +
                    '<span class="seg-cambio">' + esc(contextoDe(x)) + '</span></span></label></li>').join('') + '</ul></details>';
        }
        const hayAlgo = totales.nuevos || totales.actualizar || desaparecidos.length || audiencias.length || repetidos.length;
        if (!hayAlgo) {
            html += '<p class="seg-ok">✓ Tu lista ya está al día con esta revisión.</p>';
        }

        $('modal-body').innerHTML = '<div class="seg-vista">' + html + '</div>';
        // Aunque no haya pendientes que traer, un asunto que se deja de importar
        // (o se recupera) tiene que guardarse.
        $('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>' +
            '<button class="btn btn-primary" id="seg-aplicar"' + (hayAlgo || ui.asignacionCambiada ? '' : ' disabled') + '>Importar</button>';

        $('modal-body').querySelectorAll('input[data-p], input[data-aud], input[data-desap], input[data-rep]').forEach(c => c.addEventListener('change', () => {
            const d = c.dataset;
            const clave = d.p != null ? 'p:' + d.p : d.aud != null ? 'aud:' + d.aud : d.desap != null ? 'desap:' + d.desap : 'rep:' + d.rep;
            if (c.checked) ui.desmarcados.delete(clave);
            else ui.desmarcados.add(clave);
        }));
        $('modal-body').querySelectorAll('[data-recuperar]').forEach(c => c.addEventListener('change', () => {
            ui.recuperar.add(c.dataset.recuperar);
            pintar();
        }));
        $('modal-body').querySelectorAll('[data-restaurar]').forEach(c => c.addEventListener('change', () => {
            const clave = c.dataset.restaurar;
            for (const k of Object.keys(ui.asignaciones)) if (mismaClave(k, clave)) delete ui.asignaciones[k];
            for (const k of [...ui.omitidosAntes]) if (mismaClave(k, clave)) ui.omitidosAntes.delete(k);
            ui.restaurar.add(clave);
            ui.asignacionCambiada = true;
            pintar();
        }));
        const todos = $('seg-todos');
        if (todos) todos.addEventListener('change', () => { ui.todos = todos.checked; pintar(); });
        const asignacion = $('seg-asignacion');
        if (asignacion) asignacion.addEventListener('toggle', () => { ui.verAsignacion = asignacion.open; });
        $('modal-body').querySelectorAll('.seg-exp').forEach(sel => sel.addEventListener('change', () => {
            const v = sel.value;
            ui.asignaciones[sel.dataset.asunto] = v === '' ? null : v === OMITIR ? OMITIR : (isNaN(Number(v)) ? v : Number(v));
            ui.asignacionCambiada = true;
            pintar();
        }));
        $('seg-aplicar').addEventListener('click', aplicar);
    }

    async function aplicar() {
        const boton = $('seg-aplicar');
        if (boton) boton.disabled = true;
        const marcado = (sel) => { const c = $('modal-body').querySelector(sel); return !c || c.checked; };
        const { asuntos, desaparecidos, repetidos } = ui.plan;
        let creados = 0, actualizados = 0, terminados = 0, agendadas = 0, descartadosNuevos = 0, cerrados = 0;
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
                        if ((au.accionPlan !== 'nuevo' && au.accionPlan !== 'actualizar') || !marcado('[data-aud="' + CSS.escape(a.asunto.clave + '|' + i) + '"]')) continue;
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
                for (const r of repetidos) {
                    if (!marcado('[data-rep="' + CSS.escape(String(r.existente.id)) + '"]')) continue;
                    try { await completarPendienteCore(r.existente.id, true); cerrados++; } catch (e) { fallos.push(r.existente.titulo); }
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
                        if ((au.accionPlan === 'nuevo' || au.accionPlan === 'actualizar') && !marcado('[data-aud="' + CSS.escape(a.asunto.clave + '|' + i) + '"]')) {
                            nuevos.push(descarteDe(a.asunto.clave, au.descripcion, au.fecha));
                        }
                    });
                }
                for (const x of desaparecidos) {
                    if (!marcado('[data-desap="' + CSS.escape(String(x.id)) + '"]')) nuevos.push(descarteDe(x.origen.asunto, x.titulo));
                }
                for (const r of repetidos) {
                    if (!marcado('[data-rep="' + CSS.escape(String(r.existente.id)) + '"]')) nuevos.push(descarteDe(r.existente.origen.asunto, r.existente.titulo));
                }
                const quedan = (await leerDescartados()).filter(d => !ui.recuperar.has(d.id));
                if (nuevos.length || ui.recuperar.size) {
                    descartadosNuevos = nuevos.length;
                    await guardarDescartados(fusionarDescartados(quedan, nuevos));
                }

                // Los asuntos que se dejan de importar o se recuperan, también
                // para los demás dispositivos.
                const yaOmitido = (clave) => ui.omitidosSync.some(o => o.omitir && mismaClave(o.asunto, clave));
                const omisiones = [];
                for (const a of asuntos) {
                    if (a.omitido && a.por === 'usuario' && !yaOmitido(a.asunto.clave)) omisiones.push(omisionDe(a.asunto.clave, true));
                }
                for (const clave of ui.restaurar) {
                    if (!asuntos.some(a => a.asunto.clave === clave && a.omitido)) omisiones.push(omisionDe(clave, false));
                }
                if (omisiones.length) await guardarOmitidos(fusionarOmitidos(await leerOmitidos(), omisiones));
            });
        } finally {
            // Lo que el usuario eligió a mano se recuerda para la próxima semana.
            const guardadas = leerAsignaciones();
            for (const clave of ui.restaurar) for (const k of Object.keys(guardadas)) if (mismaClave(k, clave)) delete guardadas[k];
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
        if (cerrados) partes.push(`${cerrados} repetido${cerrados !== 1 ? 's' : ''} cerrado${cerrados !== 1 ? 's' : ''}`);
        if (agendadas) partes.push(`${agendadas} audiencias al calendario`);
        if (descartadosNuevos) partes.push(`${descartadosNuevos} desmarcados no volverán a aparecer`);
        const omitidosNuevos = asuntos.filter(a => !a.asunto.fuera && a.omitido && !fueOmitido(a.asunto.clave)).length;
        if (omitidosNuevos) partes.push(`${omitidosNuevos} asunto${omitidosNuevos !== 1 ? 's' : ''} que ya no se mostrará${omitidosNuevos !== 1 ? 'n' : ''}`);
        const restaurados = [...ui.restaurar].filter(k => !asuntos.some(a => a.asunto.clave === k && a.omitido)).length;
        if (restaurados) partes.push(`${restaurados} asunto${restaurados !== 1 ? 's' : ''} que se vuelve${restaurados !== 1 ? 'n' : ''} a importar`);
        toast('Seguimiento importado: ' + (partes.join(', ') || 'sin cambios') + (fallos.length ? ` · ${fallos.length} no se pudieron guardar` : ''),
            fallos.length ? 'warning' : 'success');
    }

    global.SEGUIMIENTO = { ...Motor, abrir, cargarArchivo };
})(typeof window !== 'undefined' ? window : globalThis);
