/**
 * Sesiones de los Tribunales Colegiados de Circuito.
 *
 * Al abrir la app se revisa si alguno de los asuntos registrados en un
 * tribunal colegiado (amparos directos, amparos en revisión, quejas…) está
 * listado para sesión en las próximas semanas, y se avisa en Inicio.
 *
 * Las listas son las del buscador oficial del PJF (SISE). El navegador no
 * puede pedirlas directamente (no mandan cabeceras CORS), así que la consulta
 * la hace el proxy: docs/proxy/impi-proxy-worker.js, sección SESIONES SISE,
 * ruta /api/sesiones. Como los expedientes viven aquí, en el navegador, la
 * app le dice cuáles buscar: solo el tribunal, el número/año y el tipo de
 * asunto, nada más.
 *
 * Qué expedientes se revisan: los del PJF cuyo órgano es un Tribunal Colegiado
 * de Circuito del catálogo. El id de ese órgano (pjfOrgId) es el mismo
 * OrganismoId que usa SISE, así que no hay tabla de equivalencias que
 * mantener: sale de data/pjf_catalogos_completos.json al dar de alta el
 * expediente. En una misma lista hay quejas, revisiones y amparos directos
 * con el mismo número, así que cada expediente se busca con su tipo de
 * asunto; el que no lo tiene se busca solo por número, y se avisa.
 *
 * Dos partes: el motor (puro, se prueba en Node) y lo del navegador.
 */
(function (global) {
    'use strict';

    // ==================== CONFIGURACIÓN ====================

    const CONFIG = {
        // Se vigilan los asuntos de los Tribunales Colegiados de Circuito: el
        // tipo de órgano 4 del catálogo del PJF. (Los Colegiados de Apelación
        // son otro tipo, el 340, y quedan fuera.)
        tipoOrganismoId: 4,
        // El tipo de asunto que el proxy da por supuesto si no se le dice
        // otro, con su id en el catálogo por si el catálogo no carga.
        tipoPorDefecto: 'Amparo Directo',
        tipoPorDefectoId: '10',
        // Desde esta versión el proxy entiende otros tipos de asunto. El
        // anterior solo revisaba amparos directos, y callaba lo demás.
        versionProxy: 2,
        // "sesion": por el día de la sesión. "lista": por el día en que se
        // publicó la lista. Con "sesion" el periodo elegido es el de las
        // sesiones, que es lo que se quiere saber.
        filtro: 'sesion',
        semanasPorDefecto: 2,
        maxSemanas: 4,
        horasEnMemoria: 6,
        ruta: '/api/sesiones',
        // Cada tribunal puede necesitar varias decenas de llamadas a SISE.
        esperaMs: 120000
    };

    // ==================== MOTOR ====================

    const dos = (n) => String(n).padStart(2, '0');

    /** La fecha local de un Date, como AAAA-MM-DD. */
    function isoLocal(fecha) {
        return fecha.getFullYear() + '-' + dos(fecha.getMonth() + 1) + '-' + dos(fecha.getDate());
    }

    function sumarDias(iso, n) {
        const d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }

    /**
     * Del lunes de esta semana al viernes de la semana número `semanas`.
     * Las semanas van de domingo a sábado, como en el calendario de SISE: en
     * domingo, "esta semana" es la que empieza mañana. (La misma regla que el
     * proxy aplica cuando no se le dice el rango.)
     */
    function rangoDeSemanas(hoy, semanas) {
        const iso = typeof hoy === 'string' ? hoy : isoLocal(hoy);
        const n = Math.min(CONFIG.maxSemanas, Math.max(1, parseInt(semanas, 10) || CONFIG.semanasPorDefecto));
        const lunes = sumarDias(iso, 1 - new Date(iso + 'T00:00:00Z').getUTCDay());
        return { desde: lunes, hasta: sumarDias(lunes, 7 * (n - 1) + 4) };
    }

    function sinAcentos(texto) {
        return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /** "AD 0677/2023-II" → "677/2023". Sin número y año, null. */
    function claveExpediente(texto) {
        const m = /(\d{1,7})\s*\/\s*(\d{4}|\d{2})(?!\d)/.exec(String(texto || ''));
        if (!m) return null;
        return parseInt(m[1], 10) + '/' + (m[2].length === 2 ? '20' + m[2] : m[2]);
    }

    /**
     * El nombre de un tipo de asunto, para compararlo: sin acentos, en
     * minúsculas y sin signos. (La misma regla que aplica el proxy.)
     */
    function tipoNormal(texto) {
        return sinAcentos(texto).replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function esColegiado(nombre) {
        return sinAcentos(nombre).includes('tribunal colegiado');
    }

    function esDeApelacion(nombre) {
        return sinAcentos(nombre).includes('apelacion');
    }

    /**
     * De todos los expedientes, los que están en un Tribunal Colegiado de
     * Circuito y se pueden buscar, agrupados por tribunal.
     *
     * catalogo: { organos: Map(id → { tipoOrganismoId, nombre }), tipos: Map(id → nombre) },
     * del catálogo del PJF. Sin él, el órgano se reconoce por su nombre.
     *
     * → { grupos: [{ organismoId, tribunal, expedientes: [{ id, clave, numero, neun, tipo }] }],
     *     total, sinTribunal }
     * tipo: el nombre del tipo de asunto, o '' si el expediente no lo dice (se
     *       busca entonces solo por número).
     * sinTribunal: los que son de un colegiado pero no tienen órgano del
     *       catálogo, así que no hay a quién preguntar.
     */
    function seleccionarAsuntos(expedientes, catalogo) {
        const organos = (catalogo && catalogo.organos) || new Map();
        const tipos = (catalogo && catalogo.tipos) || new Map();
        const nombres = new Map([[tipoNormal(CONFIG.tipoPorDefecto), CONFIG.tipoPorDefecto]]);
        tipos.forEach((nombre) => nombres.set(tipoNormal(nombre), nombre));

        // El tipo de asunto llega como id del catálogo o como texto (el
        // asistente y la importación a veces guardan el nombre).
        const tipoDe = (valor) => {
            const crudo = String(valor == null ? '' : valor).trim();
            if (/^\d+$/.test(crudo)) return tipos.get(crudo) || (crudo === CONFIG.tipoPorDefectoId ? CONFIG.tipoPorDefecto : '');
            return nombres.get(tipoNormal(crudo)) || '';
        };

        // Un expediente que trae el nombre exacto del órgano pero no su id
        // (importado, o de una versión anterior) se resuelve por el nombre.
        const idPorNombre = new Map();
        organos.forEach((o, id) => { if (o && o.nombre) idPorNombre.set(sinAcentos(o.nombre), id); });

        const porOrganismo = new Map();
        let total = 0, sinTribunal = 0;

        for (const e of expedientes || []) {
            if (!e || e.institucion !== 'PJF' || e.archivado || e.activo === false) continue;
            const clave = claveExpediente(e.numero);
            if (!clave) continue;

            const organismoId = String(e.pjfOrgId == null ? '' : e.pjfOrgId).trim() || idPorNombre.get(sinAcentos(e.juzgado)) || '';
            const organo = organos.get(organismoId);
            const tipo = tipoDe(e.pjfTipoAsunto);
            const deColegiado = organo
                ? Number(organo.tipoOrganismoId) === CONFIG.tipoOrganismoId
                : !esDeApelacion(e.juzgado) && (esColegiado(e.juzgado) || tipo === CONFIG.tipoPorDefecto);
            if (!deColegiado) continue;
            if (!/^\d{1,6}$/.test(organismoId)) { sinTribunal++; continue; }

            if (!porOrganismo.has(organismoId)) {
                porOrganismo.set(organismoId, { organismoId, tribunal: e.juzgado || ('Organismo ' + organismoId), expedientes: [] });
            }
            const neun = String(e.neun || e.pjfNeun || '').replace(/\D/g, '').slice(0, 12);
            porOrganismo.get(organismoId).expedientes.push({ id: e.id, clave, numero: e.numero, neun, tipo });
            total++;
        }

        const grupos = [...porOrganismo.values()].sort((a, b) => Number(a.organismoId) - Number(b.organismoId));
        return { grupos, total, sinTribunal };
    }

    const esTipoPorDefecto = (tipo) => tipoNormal(tipo) === tipoNormal(CONFIG.tipoPorDefecto);

    /** ¿Algún asunto del grupo necesita un proxy que entienda tipos de asunto? */
    function pideOtrosTipos(grupo) {
        return grupo.expedientes.some(e => !esTipoPorDefecto(e.tipo));
    }

    /**
     * La dirección de la consulta de un tribunal. Cada expediente va como
     * "organismo:número/año[:NEUN][~tipo]"; el tipo por defecto no se
     * escribe, y "~*" es "de cualquier tipo".
     */
    function urlConsulta(base, grupo, rango, filtro, refrescar) {
        const vistos = new Set();
        for (const e of grupo.expedientes) {
            vistos.add(grupo.organismoId + ':' + e.clave + (e.neun ? ':' + e.neun : '') +
                (!e.tipo ? '~*' : esTipoPorDefecto(e.tipo) ? '' : '~' + tipoNormal(e.tipo)));
        }
        return String(base || '').replace(/\/+$/, '') + CONFIG.ruta +
            '?desde=' + rango.desde + '&hasta=' + rango.hasta +
            '&filtro=' + encodeURIComponent(filtro) +
            '&exp=' + encodeURIComponent([...vistos].join(',')) +
            (refrescar ? '&refresh=1' : '');
    }

    /** Lo que identifica una consulta: el periodo y la lista de expedientes. */
    function claveConsulta(grupos, rango, filtro) {
        const lista = [];
        for (const g of grupos) for (const e of g.expedientes) lista.push(g.organismoId + ':' + e.clave + ':' + e.neun + '~' + tipoNormal(e.tipo));
        return [rango.desde, rango.hasta, filtro, lista.sort().join(',')].join('|');
    }

    /**
     * A cada sesión que devuelve el proxy le pone el nombre del tribunal y a
     * cuál de mis expedientes corresponde.
     */
    function completar(sesiones, grupo) {
        return (sesiones || []).map(s => {
            const tipo = tipoNormal(s.tipoAsunto);
            const mismos = grupo.expedientes.filter(e => e.clave === s.expediente);
            // Con el mismo número puedo tener una queja y una revisión: se
            // empareja con la del mismo tipo antes que con la que no lo dice.
            const mio = grupo.expedientes.find(e => e.neun && e.neun === s.neun) ||
                mismos.find(e => e.tipo && tipoNormal(e.tipo) === tipo) ||
                mismos.find(e => !e.tipo) || mismos[0];
            return Object.assign({}, s, {
                tribunal: grupo.tribunal,
                expedienteId: mio ? mio.id : null
            });
        });
    }

    function ordenar(sesiones) {
        const llave = (s) => [s.fechaSesion, s.tribunal, s.expediente].join('|');
        return sesiones.slice().sort((a, b) => llave(a).localeCompare(llave(b), 'es'));
    }

    const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    /** "2026-11-12" → "jueves 12 de noviembre" (o "Hoy", "Mañana"). */
    function fechaLarga(iso, hoy) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return String(iso || '');
        const d = new Date(iso + 'T00:00:00Z');
        const texto = DIAS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()];
        if (hoy && iso === hoy) return 'Hoy, ' + texto;
        if (hoy && iso === sumarDias(hoy, 1)) return 'Mañana, ' + texto;
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    }

    /** "del 9 al 20 de noviembre" / "del 30 de noviembre al 11 de diciembre". */
    function periodoTexto(rango) {
        const a = new Date(rango.desde + 'T00:00:00Z');
        const b = new Date(rango.hasta + 'T00:00:00Z');
        const mismoMes = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
        return 'del ' + a.getUTCDate() + (mismoMes ? '' : ' de ' + MESES[a.getUTCMonth()]) +
            ' al ' + b.getUTCDate() + ' de ' + MESES[b.getUTCMonth()];
    }

    const Motor = {
        CONFIG, isoLocal, sumarDias, rangoDeSemanas, claveExpediente, tipoNormal, seleccionarAsuntos,
        pideOtrosTipos, urlConsulta, claveConsulta, completar, ordenar, fechaLarga, periodoTexto
    };

    if (typeof module !== 'undefined' && module.exports) { module.exports = Motor; return; }

    // ==================== NAVEGADOR ====================

    const CLAVE_MEMORIA = 'sesiones_pjf_memoria_v1';
    const CLAVE_SEMANAS = 'sesiones_pjf_semanas';
    const CLAVE_PROXY_LOCAL = 'sesiones_pjf_proxy_local';
    const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

    const $ = (id) => document.getElementById(id);
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

    // Si el usuario cambia el periodo a media consulta, la consulta vieja no
    // debe pintar encima de la nueva.
    let turno = 0;
    let seleccion = { grupos: [], total: 0, sinTribunal: 0 };

    /**
     * El proxy. Para probar en la computadora propia con un worker local
     * (wrangler dev) se puede apuntar a él, solo desde localhost:
     *   localStorage.setItem('sesiones_pjf_proxy_local', 'http://localhost:8787')
     */
    function proxy() {
        try {
            const local = localStorage.getItem(CLAVE_PROXY_LOCAL);
            if (local && LOCAL_RE.test(local) && LOCAL_RE.test(location.origin)) return local;
        } catch (e) { /* sin almacén se usa el de siempre */ }
        return typeof getProxyUrl === 'function' ? getProxyUrl() : '';
    }

    function semanasElegidas() {
        let n = CONFIG.semanasPorDefecto;
        try { n = parseInt(localStorage.getItem(CLAVE_SEMANAS), 10) || n; } catch (e) { /* por defecto */ }
        return Math.min(CONFIG.maxSemanas, Math.max(1, n));
    }

    // ---------- Memoria de 6 horas en el navegador ----------

    function leerMemoria(clave) {
        try {
            const todo = JSON.parse(localStorage.getItem(CLAVE_MEMORIA) || '{}');
            const r = todo[clave];
            return r && Date.now() - r.consultado < CONFIG.horasEnMemoria * 3600 * 1000 ? r : null;
        } catch (e) { return null; }
    }

    function guardarMemoria(clave, resultado) {
        try {
            const todo = JSON.parse(localStorage.getItem(CLAVE_MEMORIA) || '{}');
            todo[clave] = resultado;
            // Solo lo reciente, y pocas entradas: una por periodo consultado.
            const vigentes = Object.entries(todo)
                .filter(([, r]) => r && Date.now() - r.consultado < CONFIG.horasEnMemoria * 3600 * 1000)
                .sort((a, b) => b[1].consultado - a[1].consultado).slice(0, 8);
            localStorage.setItem(CLAVE_MEMORIA, JSON.stringify(Object.fromEntries(vigentes)));
        } catch (e) { /* sin almacén no se recuerda, y ya */ }
    }

    function olvidarMemoria(clave) {
        try {
            const todo = JSON.parse(localStorage.getItem(CLAVE_MEMORIA) || '{}');
            delete todo[clave];
            localStorage.setItem(CLAVE_MEMORIA, JSON.stringify(todo));
        } catch (e) { /* nada que olvidar */ }
    }

    // ---------- Consulta ----------

    async function pedirTribunal(grupo, rango, refrescar) {
        const control = new AbortController();
        const reloj = setTimeout(() => control.abort(), CONFIG.esperaMs);
        try {
            const resp = await fetch(urlConsulta(proxy(), grupo, rango, CONFIG.filtro, refrescar),
                { headers: { 'Accept': 'application/json' }, signal: control.signal });
            let datos = null;
            try { datos = await resp.json(); } catch (e) { /* respuesta que no es JSON */ }
            if (!resp.ok || !datos || !Array.isArray(datos.sesiones)) {
                throw new Error((datos && datos.error) || (resp.status === 404
                    ? 'El servicio de consulta todavía no está disponible'
                    : 'El servicio de consulta respondió con error ' + resp.status));
            }
            // Un proxy anterior ignora el tipo de asunto y solo mira los
            // amparos directos: diría "nada listado" sin haber buscado.
            if (pideOtrosTipos(grupo) && !(datos.version >= CONFIG.versionProxy)) {
                throw new Error('El servicio de consulta publicado es anterior y solo revisa amparos directos; hay que publicarlo de nuevo');
            }
            return datos;
        } catch (e) {
            if (control.signal.aborted) throw new Error('La consulta tardó demasiado');
            throw e;
        } finally {
            clearTimeout(reloj);
        }
    }

    /**
     * Revisa las listas del periodo elegido y pinta el resultado.
     * refrescar: no usar lo recordado (ni aquí ni en el proxy).
     */
    async function consultar(refrescar) {
        const cuerpo = $('sesiones-pjf-cuerpo');
        if (!cuerpo) return;
        const miTurno = ++turno;
        const rango = rangoDeSemanas(new Date(), semanasElegidas());
        const clave = claveConsulta(seleccion.grupos, rango, CONFIG.filtro);

        if (!seleccion.grupos.length) { pintar({ rango, sesiones: [], errores: [], completo: true, consultado: Date.now() }); return; }

        if (refrescar) {
            // Quien pide actualizar ya no se fía de lo recordado: si esta
            // consulta falla, la próxima vez se vuelve a intentar en vez de
            // enseñar el resultado viejo.
            olvidarMemoria(clave);
        } else {
            const recordado = leerMemoria(clave);
            if (recordado) { pintar(recordado); return; }
        }
        if (!proxy()) { pintarAviso('La consulta de sesiones no está disponible en esta instalación.'); return; }
        if (navigator.onLine === false) { pintarAviso('Sin conexión: no se pudieron consultar las listas de sesión.', true); return; }

        const sesiones = [];
        const errores = [];
        for (let i = 0; i < seleccion.grupos.length; i++) {
            if (miTurno !== turno) return;
            pintarCargando(i + 1, seleccion.grupos.length);
            const grupo = seleccion.grupos[i];
            try {
                // Un tribunal a la vez: el proxy ya reparte sus llamadas a SISE
                // de pocas en pocas, y así no se le juntan varias consultas.
                const datos = await pedirTribunal(grupo, rango, refrescar);
                sesiones.push(...completar(datos.sesiones, grupo));
                if (datos.completo === false) {
                    const fallidas = (datos.errores || []).filter(e => e.etapa === 'reporte');
                    errores.push({ tribunal: grupo.tribunal, mensaje: (fallidas[0] && fallidas[0].mensaje) || 'No se pudieron leer todas las listas', listas: fallidas.length });
                }
            } catch (e) {
                errores.push({ tribunal: grupo.tribunal, mensaje: (e && e.message) || 'No se pudo consultar' });
            }
        }
        if (miTurno !== turno) return;

        const resultado = { rango, sesiones: ordenar(sesiones), errores, completo: errores.length === 0, consultado: Date.now() };
        // Lo incompleto no se recuerda: la próxima vez se vuelve a intentar.
        if (resultado.completo) guardarMemoria(clave, resultado);
        pintar(resultado);
    }

    // ---------- Pintado ----------

    function pintarCargando(numero, total) {
        $('sesiones-pjf-cuerpo').innerHTML =
            '<p class="sesiones-pjf-estado">Consultando las listas de sesión del PJF…' +
            (total > 1 ? ' <span class="text-muted">(tribunal ' + numero + ' de ' + total + ')</span>' : '') + '</p>';
    }

    function pintarAviso(mensaje, conReintento) {
        $('sesiones-pjf-cuerpo').innerHTML = '<p class="sesiones-pjf-estado">' + esc(mensaje) + '</p>' +
            (conReintento ? '<p><button type="button" class="btn btn-sm btn-secondary" data-sesiones-reintentar>Reintentar</button></p>' : '');
    }

    function filaHTML(s, hoy) {
        const detalle = [s.tribunal, s.ponente ? 'Ponente: ' + s.ponente : ''].filter(Boolean).join(' · ');
        const resultado = [s.resultado, s.sentencia].filter(Boolean).join(' · ');
        const pasada = s.fechaSesion < hoy;
        const contenido =
            '<span class="sesiones-pjf-fecha"><strong>' + esc(fechaLarga(s.fechaSesion, hoy)) + '</strong>' +
                '<small>Sesión ' + esc(String(s.tipoSesion || '').toLowerCase()) + '</small></span>' +
            '<span class="sesiones-pjf-texto"><strong>' + esc((s.tipoAsunto ? s.tipoAsunto + ' ' : '') + s.expediente) + '</strong>' +
                '<small>' + esc(detalle) + '</small>' +
                (s.secretario ? '<small>Secretario: ' + esc(s.secretario) + '</small>' : '') +
                (resultado ? '<small class="sesiones-pjf-resultado">Resultado: ' + esc(resultado) + '</small>' : '') +
                (s.coincidencia === 'numero' ? '<small class="sesiones-pjf-duda">Coincide por número: tu expediente no indica el tipo de asunto. Confirma que es el tuyo.</small>' : '') +
            '</span>';
        return '<li class="sesiones-pjf-fila' + (pasada ? ' pasada' : '') + '">' +
            (s.expedienteId != null
                ? '<button type="button" class="sesiones-pjf-abrir" data-sesiones-expediente="' + esc(s.expedienteId) + '" title="Abrir el expediente">' + contenido + '</button>'
                : '<div class="sesiones-pjf-abrir">' + contenido + '</div>') +
            '</li>';
    }

    function pintar(r) {
        const hoy = isoLocal(new Date());
        const partes = [];

        if (r.errores && r.errores.length) {
            partes.push('<div class="sesiones-pjf-error" role="alert"><strong>No se pudieron revisar todas las listas.</strong> ' +
                r.errores.map(e => esc(e.tribunal) + ': ' + esc(e.mensaje)).join('; ') +
                '. <button type="button" class="btn btn-sm btn-secondary" data-sesiones-reintentar>Reintentar</button></div>');
        }

        if (r.sesiones.length) {
            partes.push('<ul class="sesiones-pjf-lista">' + r.sesiones.map(s => filaHTML(s, hoy)).join('') + '</ul>');
        } else if (seleccion.grupos.length && (!r.errores || !r.errores.length)) {
            partes.push('<p class="sesiones-pjf-vacio">Sin asuntos listados en el periodo</p>');
        }

        const notas = [];
        if (seleccion.total) {
            notas.push('Se ' + (seleccion.total === 1 ? 'revisó 1 asunto' : 'revisaron ' + seleccion.total + ' asuntos') +
                ' en ' + (seleccion.grupos.length === 1 ? '1 tribunal colegiado' : seleccion.grupos.length + ' tribunales colegiados') +
                ', sesiones ' + periodoTexto(r.rango) + '.');
        }
        if (seleccion.sinTribunal) {
            notas.push((seleccion.sinTribunal === 1 ? '1 asunto de tribunal colegiado no tiene' : seleccion.sinTribunal + ' asuntos de tribunales colegiados no tienen') +
                ' órgano del catálogo y no se pudo revisar: edítalo y elige el órgano.');
        }
        // Sin punto final: la hora ya termina en "p.m.".
        notas.push('Fuente: listas de sesión del PJF (SISE) · consulta del ' +
            new Date(r.consultado).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
        partes.push('<p class="sesiones-pjf-pie">' + notas.map(esc).join('<br>') + '</p>');

        $('sesiones-pjf-cuerpo').innerHTML = partes.join('');
    }

    // ---------- Arranque ----------

    let enlazado = false;
    function enlazar() {
        if (enlazado) return;
        enlazado = true;
        const semanas = $('sesiones-pjf-semanas');
        if (semanas) {
            semanas.value = String(semanasElegidas());
            semanas.addEventListener('change', () => {
                try { localStorage.setItem(CLAVE_SEMANAS, semanas.value); } catch (e) { /* solo esta vez */ }
                consultar(false);
            });
        }
        const actualizar = $('sesiones-pjf-actualizar');
        if (actualizar) actualizar.addEventListener('click', () => consultar(true));
        $('sesiones-pjf-cuerpo').addEventListener('click', (ev) => {
            if (ev.target.closest('[data-sesiones-reintentar]')) { consultar(true); return; }
            const fila = ev.target.closest('[data-sesiones-expediente]');
            if (fila && typeof verDetalleExpediente === 'function') {
                verDetalleExpediente(parseInt(fila.getAttribute('data-sesiones-expediente'), 10));
            }
        });
    }

    /**
     * Del catálogo del PJF, lo que hace falta para saber qué órganos son
     * Tribunales Colegiados de Circuito y cómo se llama cada tipo de asunto.
     * Solo se carga si hay expedientes federales.
     */
    async function leerCatalogo(expedientes) {
        const catalogo = { organos: new Map(), tipos: new Map() };
        if (!expedientes.some(e => e && e.institucion === 'PJF')) return catalogo;
        try {
            if (typeof asegurarCatalogosPJF === 'function') await asegurarCatalogosPJF();
            const organos = typeof pjfOrganismos !== 'undefined' ? pjfOrganismos : [];
            organos.forEach(o => catalogo.organos.set(String(o.id), { tipoOrganismoId: o.tipoOrganismoId, nombre: o.nombre }));
            const delTipo = typeof pjfTiposOrgano !== 'undefined' ? pjfTiposOrgano[CONFIG.tipoOrganismoId] : null;
            ((delTipo && delTipo.tiposAsuntoArr) || []).forEach(t => catalogo.tipos.set(String(t.id), t.nombre));
        } catch (e) {
            // Sin catálogo el órgano se reconoce por su nombre y los asuntos se
            // buscan por número.
            console.warn('No se pudo leer el catálogo del PJF para las sesiones:', e);
        }
        return catalogo;
    }

    /**
     * Lo llama la app al terminar de abrir. Quien no lleva asuntos en
     * tribunales colegiados no ve la tarjeta, y no se consulta nada.
     */
    async function iniciar() {
        const tarjeta = $('sesiones-pjf');
        if (!tarjeta || !$('sesiones-pjf-cuerpo')) return;
        try {
            const expedientes = await obtenerExpedientes();
            seleccion = seleccionarAsuntos(expedientes, await leerCatalogo(expedientes));
            if (!seleccion.total && !seleccion.sinTribunal) { tarjeta.hidden = true; return; }
            tarjeta.hidden = false;
            enlazar();
            await consultar(false);
        } catch (e) {
            console.warn('No se pudieron revisar las sesiones del PJF:', e);
        }
    }

    global.SESIONES_PJF = Object.assign({}, Motor, { iniciar, consultar });
})(typeof window !== 'undefined' ? window : globalThis);
