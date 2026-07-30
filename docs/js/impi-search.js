// ==================== BÚSQUEDA IMPI (MARCia + SIGA + Marcanet) ====================
// Integración directa con MARCia (marcas), SIGA 2.0 (gacetas) y Marcanet (expedientes) del IMPI.
// Usa un proxy CORS (Cloudflare Worker) para bypass de CORS y manejo de sesiones.
//
// SETUP (solo developer):
// 1. Despliega docs/proxy/impi-proxy-worker.js en Cloudflare Workers (gratis)
// 2. Actualiza IMPI_PROXY_URL abajo con la URL de tu worker
// 3. Listo - todos los usuarios tendrán acceso a la búsqueda IMPI

// ==================== CONFIGURACIÓN ====================

// URL del proxy CORS desplegado en Cloudflare Workers.
// El developer debe actualizar esta URL después de desplegar el worker.
// Dejar vacío '' desactiva la funcionalidad IMPI.
var IMPI_PROXY_URL = 'https://throbbing-scene-1c2b.enlilh.workers.dev/';

// ==================== ESTADO GLOBAL ====================

var marciaState = {
    searchId: null,
    // Payload de la última búsqueda enviada a /marcia/record. Se conserva para
    // poder re-registrar la búsqueda si la sesión del proxy se pierde.
    lastPayload: null,
    lastError: null,
    results: [],
    totalResults: 0,
    pageNumber: 0,
    pageSize: 50,
    aggregates: null,
    filters: { status: [], niceClass: [], viennaCode: [] },
    searchMode: 'rapida',
    searching: false,
    // Marca abierta en el detalle, para el botón de vigilancia.
    detalleActual: null
};

var sigaState = {
    results: [],
    searching: false,
    lastError: null,
    currentQuery: null, // { Busqueda, IdArea, FechaDesde, FechaHasta }
    savedSearches: [],
    lastAutoCheck: null
};

var marcanetState = {
    searchMode: 'fonetica', // 'fonetica', 'expediente', 'registro', 'titular'
    results: [],
    searching: false,
    lastError: null,
    detail: null
};

function getProxyUrl() {
    return IMPI_PROXY_URL.replace(/\/+$/, '');
}

// ==================== SPINNER COMPARTIDO ====================
// El spinner #impi-loading lo comparten las tres herramientas. Con búsquedas
// simultáneas (buscarEnLas3) un contador evita que la primera en terminar lo
// apague mientras las otras siguen corriendo.

var impiLoadingCount = 0;

function mostrarCargandoIMPI() {
    impiLoadingCount++;
    var el = document.getElementById('impi-loading');
    if (el) el.style.display = 'flex';
}

function ocultarCargandoIMPI() {
    impiLoadingCount = Math.max(0, impiLoadingCount - 1);
    if (impiLoadingCount > 0) return;
    var el = document.getElementById('impi-loading');
    if (el) el.style.display = 'none';
}


// ==================== TABS IMPI ====================

function cambiarTabIMPI(tab) {
    document.querySelectorAll('.impi-tab').forEach(function(t) {
        t.classList.toggle('active', t.dataset.impiTab === tab);
    });
    document.querySelectorAll('.impi-tab-content').forEach(function(c) {
        c.classList.remove('active');
    });
    var content = document.getElementById('impi-tab-' + tab);
    if (content) content.classList.add('active');

}

// ==================== PROXY HELPERS ====================

// Sesión de MARCia (token CSRF + cookies) tal como la devuelve el proxy. La
// conserva el cliente y la reenvía en cada petición: el worker ya no depende
// de mantenerla en memoria, que es lo que hacía fallar la paginación y los
// detalles cuando Cloudflare reciclaba el isolate.
var impiSessionToken = null;

// Id estable de este navegador. El proxy separa sesiones por este id; antes
// las agrupaba por IP, así que dos personas en la misma red compartían la
// sesión del IMPI y se pisaban entre sí.
var impiClientId = null;

function obtenerClientId() {
    if (impiClientId) return impiClientId;
    try {
        impiClientId = localStorage.getItem('impi_client_id');
    } catch (e) { /* modo privado o storage bloqueado */ }
    if (!impiClientId) {
        impiClientId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
        try { localStorage.setItem('impi_client_id', impiClientId); } catch (e) { /* se queda en memoria */ }
    }
    return impiClientId;
}

async function proxyFetch(path, options) {
    var proxy = getProxyUrl();
    if (!proxy) {
        throw new Error('PROXY_NOT_CONFIGURED');
    }

    var headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-IMPI-Client': obtenerClientId()
    };
    if (impiSessionToken) headers['X-IMPI-Session'] = impiSessionToken;

    var init = Object.assign({}, options);
    init.headers = Object.assign(headers, (options && options.headers) || {});

    var resp = await fetch(proxy + path, init);

    // El proxy devuelve la sesión con las cookies que haya rotado el IMPI.
    var sesionActualizada = resp.headers.get('X-IMPI-Session');
    if (sesionActualizada) impiSessionToken = sesionActualizada;

    if (!resp.ok) {
        var errData;
        try { errData = await resp.json(); } catch (e) { errData = { error: 'HTTP ' + resp.status }; }
        throw new Error(errData.error || 'HTTP ' + resp.status);
    }
    return resp.json();
}

function mostrarErrorProxy() {
    mostrarToast('El servicio de búsqueda IMPI no está disponible en este momento.', 'warning');
}

// ==================== MARCia: SESIÓN Y REINTENTOS ====================
// El proxy guarda la sesión CSRF de MARCia en memoria del worker, así que puede
// desaparecer entre peticiones (reciclado del isolate, timeout de 30 min). Sin
// reintento, paginar o abrir un detalle falla con "No active session".

function esErrorDeSesionMARCia(e) {
    var msg = (e && e.message) || '';
    return /no active session|HTTP 401/i.test(msg);
}

// Restablece la sesión CSRF. Si recrearBusqueda es true, vuelve a registrar la
// última búsqueda: el searchId anterior pertenece a la sesión perdida y ya no
// resuelve, así que hay que obtener uno nuevo antes de pedir resultados.
async function restablecerSesionMARCia(recrearBusqueda) {
    await proxyFetch('/marcia/csrf');
    if (!recrearBusqueda || !marciaState.lastPayload) return;
    var record = await proxyFetch('/marcia/search', {
        method: 'POST',
        body: JSON.stringify(marciaState.lastPayload)
    });
    marciaState.searchId = record.id;
    if (typeof record.count === 'number') marciaState.totalResults = record.count;
}

// Ejecuta fn(); si falla por sesión perdida, la restablece y reintenta una vez.
// fn debe leer marciaState.searchId en el momento de la llamada para que el
// reintento use el searchId nuevo.
async function conReintentoDeSesion(fn, recrearBusqueda) {
    try {
        return await fn();
    } catch (e) {
        if (!esErrorDeSesionMARCia(e)) throw e;
        await restablecerSesionMARCia(recrearBusqueda);
        return await fn();
    }
}

// ==================== MARCia: TOGGLE ====================

function toggleMarciaSearchMode(mode) {
    marciaState.searchMode = mode;
    document.getElementById('marcia-form-rapida').style.display = mode === 'rapida' ? '' : 'none';
    document.getElementById('marcia-form-avanzada').style.display = mode === 'avanzada' ? '' : 'none';
    document.getElementById('btn-marcia-rapida').classList.toggle('active', mode === 'rapida');
    document.getElementById('btn-marcia-avanzada').classList.toggle('active', mode === 'avanzada');
}

// ==================== MARCia: BÚSQUEDA ====================

// opts.silencioso: no emite toasts propios (lo usa buscarEnLas3, que resume).
// opts.payload: reutiliza un payload ya construido (búsquedas guardadas).
// Devuelve true si la búsqueda se completó, false si falló.
async function buscarMARCia(opts) {
    opts = opts || {};
    if (marciaState.searching) return false;

    var payload = opts.payload || null;
    if (!payload) {
        if (marciaState.searchMode === 'rapida') {
            var query = (document.getElementById('marcia-query').value || '').trim();
            if (!query) {
                if (!opts.silencioso) mostrarToast('Ingresa un término de búsqueda', 'warning');
                return false;
            }
            payload = { _type: 'Search$Quick', query: query, images: [] };
        } else {
            payload = construirPayloadAvanzadoMARCia(opts.silencioso);
            if (!payload) return false;
        }
    }

    marciaState.searching = true;
    marciaState.lastError = null;
    marciaState.lastPayload = payload;
    marciaState.pageNumber = 0;
    marciaState.filters = { status: [], niceClass: [], viennaCode: [] };
    mostrarCargandoIMPI();

    try {
        // 1. Obtener sesión CSRF
        await proxyFetch('/marcia/csrf');

        // 2. Crear búsqueda (reintenta si el worker perdió la sesión recién creada)
        var recordData = await conReintentoDeSesion(function() {
            return proxyFetch('/marcia/search', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }, false);
        marciaState.searchId = recordData.id;
        marciaState.totalResults = recordData.count || 0;

        // 3. Obtener resultados
        var ok = await obtenerResultadosMARCia({ silencioso: opts.silencioso });
        if (!ok) return false;
        return true;

    } catch (e) {
        marciaState.lastError = e.message;
        if (!opts.silencioso) {
            if (e.message === 'PROXY_NOT_CONFIGURED') {
                mostrarErrorProxy();
            } else {
                console.error('Error MARCia:', e);
                mostrarToast('Error al buscar en MARCia: ' + e.message, 'error');
            }
        }
        return false;
    } finally {
        marciaState.searching = false;
        ocultarCargandoIMPI();
    }
}

function construirPayloadAvanzadoMARCia(silencioso) {
    var title = (document.getElementById('marcia-adv-title').value || '').trim();
    var titleOption = document.getElementById('marcia-adv-title-option').value;
    // MARCia acepta un solo nombre por búsqueda, con un tipo (titular o
    // apoderado); por eso es un campo con selector y no dos campos.
    var nombre = (document.getElementById('marcia-adv-name').value || '').trim();
    var nombreTipo = document.getElementById('marcia-adv-name-type').value || 'OWNER';
    var number = (document.getElementById('marcia-adv-number').value || '').trim();
    var numberType = document.getElementById('marcia-adv-number-type').value;
    var niceClass = document.getElementById('marcia-adv-class').value;
    var status = document.getElementById('marcia-adv-status').value;
    var appType = document.getElementById('marcia-adv-apptype').value;
    var goods = (document.getElementById('marcia-adv-goods').value || '').trim();
    var dateFrom = document.getElementById('marcia-adv-date-from').value;
    var dateTo = document.getElementById('marcia-adv-date-to').value;
    var dateType = document.getElementById('marcia-adv-date-type').value;

    if (!title && !nombre && !number && !goods) {
        if (!silencioso) mostrarToast('Ingresa al menos un criterio de búsqueda', 'warning');
        return null;
    }

    var query = {
        title: title || '',
        titleOption: titleOption,
        name: null,
        number: null,
        date: null,
        status: status ? [status] : [],
        classes: niceClass ? [parseInt(niceClass)] : [],
        codes: [],
        indicators: [],
        markType: [],
        appType: appType ? [appType] : [],
        goodsAndServices: goods,
        wordSet: { l: null, op: 'AND', r: null }
    };

    if (nombre) query.name = { name: nombre, types: [nombreTipo] };
    if (number) query.number = { name: number, types: [numberType] };
    if (dateFrom || dateTo) {
        query.date = { date: { from: dateFrom || '', to: dateTo || '' }, types: [dateType] };
    }

    return { _type: 'Search$Structured', images: [], query: query };
}

function construirBodyResultadosMARCia(pageNumber, pageSize) {
    return {
        searchId: marciaState.searchId,
        pageSize: pageSize || marciaState.pageSize,
        pageNumber: typeof pageNumber === 'number' ? pageNumber : marciaState.pageNumber,
        statusFilter: marciaState.filters.status,
        viennaCodeFilter: marciaState.filters.viennaCode,
        niceClassFilter: marciaState.filters.niceClass
    };
}

async function obtenerResultadosMARCia(opts) {
    opts = opts || {};
    if (!marciaState.searchId) return false;
    mostrarCargandoIMPI();

    try {
        var data = await conReintentoDeSesion(function() {
            return proxyFetch('/marcia/results', {
                method: 'POST',
                body: JSON.stringify(construirBodyResultadosMARCia())
            });
        }, true);

        marciaState.results = data.resultPage || [];
        marciaState.totalResults = data.totalResults || 0;
        marciaState.aggregates = data.aggregates || null;

        renderizarResultadosMARCia();
        renderizarFiltrosMARCia();
        renderizarPaginacionMARCia();
        actualizarBotonesGuardar();
        return true;
    } catch (e) {
        marciaState.lastError = e.message;
        if (!opts.silencioso) mostrarToast('Error obteniendo resultados: ' + e.message, 'error');
        return false;
    } finally {
        ocultarCargandoIMPI();
    }
}

// ==================== MARCia: RENDERIZADO ====================

function san(str) {
    return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(str || '') : (str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// san() sanitiza HTML, no escapa comillas: sirve para texto entre etiquetas,
// pero dentro de un atributo (src="...", alt="...") un valor con comillas
// rompe el markup. attr() escapa todo lo que puede cerrar un atributo.
function attr(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Solo se aceptan URLs de imagen http(s) o data:image para no inyectar
// esquemas raros en src.
function urlImagenSegura(url) {
    var u = String(url || '').trim();
    if (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)) return u;
    return '';
}

function renderizarResultadosMARCia() {
    var section = document.getElementById('marcia-results-section');
    var list = document.getElementById('marcia-results-list');
    var countEl = document.getElementById('marcia-results-count');
    var exportBtn = document.getElementById('btn-export-marcia');

    section.style.display = '';
    document.getElementById('marcia-detail-section').style.display = 'none';
    countEl.textContent = marciaState.totalResults + ' resultado' + (marciaState.totalResults !== 1 ? 's' : '');
    if (exportBtn) exportBtn.style.display = marciaState.results.length > 0 ? '' : 'none';

    if (marciaState.results.length === 0) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span><h3>Sin resultados</h3><p>No se encontraron marcas con los criterios proporcionados.</p></div>';
        return;
    }

    var html = '';
    marciaState.results.forEach(function(r, idx) {
        var sc = r.status === 'REGISTRADO' ? 'impi-status-registered' : r.status === 'EN TRÁMITE' ? 'impi-status-pending' : 'impi-status-cancelled';
        var imgUrl = urlImagenSegura(r.images);
        var imgHtml = imgUrl
            ? '<img src="' + attr(imgUrl) + '" alt="' + attr(r.title) + '" class="impi-mark-image" onerror="this.style.display=\'none\'">'
            : '<div class="impi-mark-placeholder">🔰</div>';
        var owners = (Array.isArray(r.owners) ? r.owners : (r.owners ? [r.owners] : [])).map(san).join(', ');
        var classes = (Array.isArray(r.classes) ? r.classes : (r.classes ? [r.classes] : [])).join(', ');
        var appDate = r.dates && r.dates.application ? r.dates.application : '';
        var gi = marciaState.pageNumber * marciaState.pageSize + idx + 1;

        html += '<div class="impi-result-card" data-mark-id="' + attr(r.id || '') + '">' +
            '<div class="impi-result-number">#' + gi + '</div>' +
            '<div class="impi-result-image">' + imgHtml + '</div>' +
            '<div class="impi-result-info">' +
                '<div class="impi-result-title">' + san(r.title || 'Sin denominación') + '</div>' +
                '<span class="impi-status-badge ' + sc + '">' + san(r.status) + '</span>' +
                '<div class="impi-result-meta">' +
                    (r.applicationNumber ? '<span><strong>Exp:</strong> ' + san(r.applicationNumber) + '</span>' : '') +
                    (r.registrationNumber ? '<span><strong>Reg:</strong> ' + san(r.registrationNumber) + '</span>' : '') +
                    (classes ? '<span><strong>Clase:</strong> ' + san(classes) + '</span>' : '') +
                    (appDate ? '<span><strong>Fecha:</strong> ' + san(appDate) + '</span>' : '') +
                '</div>' +
                (owners ? '<div class="impi-result-owner"><strong>Titular:</strong> ' + owners + '</div>' : '') +
                (r.appType ? '<div class="impi-result-type">' + san(r.appType) + '</div>' : '') +
            '</div></div>';
    });
    list.innerHTML = html;
}

// Categorías de primer nivel de la Clasificación de Viena (OMPI). Los códigos
// vienen como "27.05.13"; los dos primeros dígitos dan la categoría, que es lo
// que hace legible el filtro.
var VIENNA_CATEGORIAS = {
    '01': 'Cuerpos celestes y fenómenos naturales',
    '02': 'Seres humanos',
    '03': 'Animales',
    '04': 'Seres sobrenaturales o fantásticos',
    '05': 'Plantas',
    '06': 'Paisajes',
    '07': 'Construcciones y estructuras',
    '08': 'Productos alimenticios',
    '09': 'Textiles, vestimenta y calzado',
    '10': 'Tabaco, artículos de viaje y tocador',
    '11': 'Objetos domésticos',
    '12': 'Mobiliario e instalaciones sanitarias',
    '13': 'Iluminación, cocción y refrigeración',
    '14': 'Ferretería, herramientas y escaleras',
    '15': 'Maquinaria y motores',
    '16': 'Telecomunicaciones, cómputo y fotografía',
    '17': 'Relojería, joyería, pesas y medidas',
    '18': 'Transporte y equipos para animales',
    '19': 'Recipientes y embalajes',
    '20': 'Artículos de escritura y papelería',
    '21': 'Juegos, juguetes y artículos deportivos',
    '22': 'Instrumentos musicales, cuadros y esculturas',
    '23': 'Armas, municiones y armaduras',
    '24': 'Heráldica, monedas, emblemas y símbolos',
    '25': 'Motivos ornamentales y fondos',
    '26': 'Figuras y sólidos geométricos',
    '27': 'Formas de escritura y números',
    '28': 'Inscripciones en caracteres diversos',
    '29': 'Colores'
};

function descripcionViena(codigo) {
    var cat = String(codigo || '').split('.')[0];
    if (cat.length === 1) cat = '0' + cat;
    return VIENNA_CATEGORIAS[cat] || '';
}

// Cuántos chips se muestran por grupo antes de plegar el resto.
var MARCIA_CHIPS_VISIBLES = 12;
var marciaFiltrosExpandidos = { niceClass: false, viennaCode: false };

// Construye el HTML de un grupo de chips. Los valores vienen del API, así que
// van en data-* (escapados) y no interpolados en un onclick.
function chipsFiltroMARCia(tipo, agregado, etiquetar, titulo) {
    var seleccionados = marciaState.filters[tipo];
    var expandido = marciaFiltrosExpandidos[tipo];
    var visibles = expandido ? agregado : agregado.slice(0, MARCIA_CHIPS_VISIBLES);
    var ocultos = agregado.length - visibles.length;

    var html = visibles.map(function(item) {
        var active = seleccionados.indexOf(item.key) >= 0;
        var tip = titulo ? titulo(item.key) : '';
        return '<button class="impi-filter-chip' + (active ? ' active' : '') + '"' +
            ' data-filtro-tipo="' + attr(tipo) + '" data-filtro-valor="' + attr(item.key) + '"' +
            (tip ? ' title="' + attr(tip) + '"' : '') + '>' +
            san(etiquetar(item.key)) + ' (' + (item.docCount || 0) + ')</button>';
    }).join('');

    if (ocultos > 0) {
        html += '<button class="impi-filter-chip" data-filtro-expandir="' + attr(tipo) + '">+' + ocultos + ' más</button>';
    } else if (expandido && agregado.length > MARCIA_CHIPS_VISIBLES) {
        html += '<button class="impi-filter-chip" data-filtro-expandir="' + attr(tipo) + '">Ver menos</button>';
    }
    return html;
}

function renderizarFiltrosMARCia() {
    var el = document.getElementById('marcia-filters');
    if (!marciaState.aggregates) { el.style.display = 'none'; return; }

    var statusAgg = marciaState.aggregates.STATUS || [];
    var classAgg = marciaState.aggregates.NICE_CLASSES || [];
    var viennaAgg = marciaState.aggregates.VIENNA_CODES || [];

    if (statusAgg.length === 0 && classAgg.length === 0 && viennaAgg.length === 0) {
        el.style.display = 'none';
        return;
    }
    el.style.display = '';

    document.getElementById('marcia-filter-status').innerHTML =
        chipsFiltroMARCia('status', statusAgg, function(k) { return k; });
    document.getElementById('marcia-filter-classes').innerHTML =
        chipsFiltroMARCia('niceClass', classAgg, function(k) { return 'Clase ' + k; });
    document.getElementById('marcia-filter-vienna').innerHTML =
        chipsFiltroMARCia('viennaCode', viennaAgg, function(k) { return k; }, descripcionViena);

    mostrarGrupoFiltro('marcia-filter-group-status', statusAgg.length > 0);
    mostrarGrupoFiltro('marcia-filter-group-classes', classAgg.length > 0);
    mostrarGrupoFiltro('marcia-filter-group-vienna', viennaAgg.length > 0);
    mostrarGrupoFiltro('marcia-filter-group-reset', hayFiltrosActivosMARCia());
}

function mostrarGrupoFiltro(id, visible) {
    var g = document.getElementById(id);
    if (g) g.style.display = visible ? '' : 'none';
}

function hayFiltrosActivosMARCia() {
    var f = marciaState.filters;
    return f.status.length > 0 || f.niceClass.length > 0 || f.viennaCode.length > 0;
}

function toggleFiltroMARCia(tipo, valor) {
    var arr = marciaState.filters[tipo];
    if (!arr) return;
    var idx = arr.indexOf(valor);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(valor);
    marciaState.pageNumber = 0;
    obtenerResultadosMARCia();
}

function limpiarFiltrosMARCia() {
    if (!hayFiltrosActivosMARCia()) return;
    marciaState.filters = { status: [], niceClass: [], viennaCode: [] };
    marciaState.pageNumber = 0;
    obtenerResultadosMARCia();
}

function renderizarPaginacionMARCia() {
    var el = document.getElementById('marcia-pagination');
    var totalPages = Math.ceil(marciaState.totalResults / marciaState.pageSize);
    if (totalPages <= 1) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    document.getElementById('marcia-page-info').textContent = 'Página ' + (marciaState.pageNumber + 1) + ' de ' + totalPages + ' (' + marciaState.totalResults + ' resultados)';
    document.getElementById('marcia-prev').disabled = marciaState.pageNumber === 0;
    document.getElementById('marcia-next').disabled = marciaState.pageNumber >= totalPages - 1;
}

function marciaPaginaAnterior() {
    if (marciaState.pageNumber > 0) { marciaState.pageNumber--; obtenerResultadosMARCia(); }
}
function marciaPaginaSiguiente() {
    var tp = Math.ceil(marciaState.totalResults / marciaState.pageSize);
    if (marciaState.pageNumber < tp - 1) { marciaState.pageNumber++; obtenerResultadosMARCia(); }
}

// ==================== MARCia: DETALLE ====================

async function verDetalleMARCia(markId) {
    if (!markId) return;
    mostrarCargandoIMPI();

    try {
        var data = await conReintentoDeSesion(function() {
            return proxyFetch('/marcia/view/' + encodeURIComponent(markId));
        }, false);
        renderizarDetalleMARCia(data, markId);
    } catch (e) {
        console.error('MARCia detail error:', e);
        mostrarToast('Error al obtener detalle: ' + e.message, 'error');
    } finally {
        ocultarCargandoIMPI();
    }
}

function renderizarDetalleMARCia(data, markId) {
    var section = document.getElementById('marcia-detail-section');
    var content = document.getElementById('marcia-detail-content');
    document.getElementById('marcia-results-section').style.display = 'none';

    // Datos que necesita el botón "Vigilar" de la cabecera del detalle.
    var info = extraerEstadoMarca(data);
    marciaState.detalleActual = markId ? {
        markId: markId,
        title: info.title,
        status: info.status,
        expiry: info.expiry,
        applicationNumber: info.applicationNumber,
        registrationNumber: info.registrationNumber
    } : null;

    // Helper: asegurar que un valor sea array
    function asArr(v) { return Array.isArray(v) ? v : (v && typeof v === 'object' && !Array.isArray(v) ? [v] : []); }
    // Helper: asegurar que un valor sea objeto plano
    function asObj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }

    // La API puede devolver la data en distintas estructuras
    var d = asObj(data.details || data.result || data);
    var gi = asObj(d.generalInformation || d.general || data.generalInformation);
    var tm = asObj(d.trademark || d.mark || data.trademark);
    var oi = asObj(d.ownerInformation || d.owner || data.ownerInformation);
    var ps = asArr(d.productsAndServices || d.products || data.productsAndServices);

    var imgUrl = '';
    if (tm.image) imgUrl = tm.image;
    else if (data.result && data.result.images) imgUrl = typeof data.result.images === 'string' ? data.result.images : '';
    else if (data.images) imgUrl = typeof data.images === 'string' ? data.images : '';
    imgUrl = urlImagenSegura(imgUrl);
    var imgHtml = imgUrl ? '<img src="' + attr(imgUrl) + '" class="impi-detail-image" onerror="this.style.display=\'none\'">' : '';

    var ownersHtml = '';
    var ownersList = asArr(oi.owners || oi.owner || d.owners);
    if (ownersList.length > 0) {
        ownersHtml = '<div class="impi-detail-section"><h4>Titulares</h4>' + ownersList.map(function(o) {
            var name = typeof o === 'string' ? o : (o && (o.name || o.fullName || o.ownerName)) || '';
            var addr = typeof o === 'object' && o && (o.address || o.fullAddress) ? '<br><small>' + san(o.address || o.fullAddress) + '</small>' : '';
            return '<div class="impi-detail-owner"><strong>' + san(name) + '</strong>' + addr + '</div>';
        }).join('') + '</div>';
    }

    var productsHtml = '';
    if (ps.length > 0) {
        productsHtml = '<div class="impi-detail-section"><h4>Productos y Servicios</h4>' + ps.map(function(p) {
            if (typeof p === 'string') return '<div class="impi-detail-product">' + san(p) + '</div>';
            return '<div class="impi-detail-product"><strong>Clase ' + san(String(p.niceClass || p.classNumber || p.clase || '')) + ':</strong> ' + san(p.description || p.goodsServices || p.productos || '') + '</div>';
        }).join('') + '</div>';
    }

    var histHtml = '';
    var histSource = asObj(data.historyData || d.historyData || data.history);
    var histRecords = asArr(histSource.historyRecords || histSource.records || histSource);
    // Filtrar si histRecords contiene la misma fuente (objeto con historyRecords)
    if (histRecords.length === 1 && histRecords[0] && histRecords[0].historyRecords) {
        histRecords = asArr(histRecords[0].historyRecords);
    }
    if (histRecords.length > 0 && histRecords[0] && (histRecords[0].date || histRecords[0].description || histRecords[0].status)) {
        histHtml = '<div class="impi-detail-section"><h4>Historial</h4><div class="impi-history-list">' +
            histRecords.map(function(h) {
                if (typeof h === 'string') return '<div class="impi-history-item"><span>' + san(h) + '</span></div>';
                return '<div class="impi-history-item"><span class="impi-history-date">' + san(h.date || '') + '</span><span>' + san(h.description || h.status || '') + '</span></div>';
            }).join('') + '</div></div>';
    }

    var viennaCodes = asArr(tm.viennaCodes || tm.vienna).map(function(v) { return san(String(v)); }).join(', ');

    // Extraer título - puede venir de distintos campos
    var title = gi.title || gi.denomination || gi.name || tm.name || tm.denomination || d.title || data.title || 'Sin denominación';

    content.innerHTML =
        '<div class="impi-detail-grid">' +
            '<div class="impi-detail-left">' + imgHtml + '</div>' +
            '<div class="impi-detail-right">' +
                '<h2>' + san(title) + '</h2>' +
                '<div class="impi-detail-fields">' +
                    campo('Tipo de solicitud', gi.appType || gi.applicationType) +
                    campo('No. Expediente', gi.applicationNumber || gi.fileNumber || d.applicationNumber) +
                    campo('No. Registro', gi.registrationNumber || d.registrationNumber) +
                    campo('Fecha de presentación', gi.applicationDate || gi.filingDate) +
                    campo('Fecha de registro', gi.registrationDate) +
                    campo('Fecha de vencimiento', gi.expiryDate || gi.expirationDate) +
                    (viennaCodes ? campo('Códigos de Viena', viennaCodes) : '') +
                '</div>' +
            '</div>' +
        '</div>' + ownersHtml + productsHtml + histHtml;

    section.style.display = '';
    actualizarBotonVigilar();
}

// ==================== VIGILAR UNA MARCA ====================

function marcaYaVigilada(markId) {
    return savedSearchesState.searches.some(function(s) {
        return (s.tool || '') === 'marcia' && s.subtype === 'marca' && s.markId === markId;
    });
}

function actualizarBotonVigilar() {
    var btn = document.getElementById('marcia-watch-btn');
    if (!btn) return;
    var actual = marciaState.detalleActual;
    if (!actual || !actual.markId) { btn.style.display = 'none'; return; }

    var vigilada = marcaYaVigilada(actual.markId);
    btn.style.display = '';
    btn.disabled = vigilada;
    btn.textContent = vigilada ? '👁️ Ya la vigilas' : '👁️ Vigilar esta marca';
    btn.title = vigilada
        ? 'Esta marca ya está en tus búsquedas guardadas'
        : 'Avisa cuando cambie su estatus o se acerque su vencimiento';
}

// Guarda la marca abierta como vigilancia: se revisa su estatus y su vigencia
// en el auto-check diario, igual que las búsquedas guardadas.
function vigilarMarcaActual() {
    var actual = marciaState.detalleActual;
    if (!actual || !actual.markId) return;
    if (marcaYaVigilada(actual.markId)) {
        mostrarToast('Esta marca ya está en tus búsquedas guardadas', 'warning');
        return;
    }

    var identificador = actual.applicationNumber || actual.registrationNumber || actual.markId;
    guardarBusqueda('marcia', {
        query: identificador,
        subtype: 'marca',
        markId: actual.markId,
        label: actual.title || identificador,
        lastStatus: actual.status || '',
        expiryDate: actual.expiry || '',
        lastResultCount: 1
    });
    // El botón se refresca desde renderizarBusquedasGuardadas cuando el
    // guardado en IndexedDB confirma.
}

function campo(label, value) {
    if (!value) return '';
    return '<div class="impi-detail-field"><label>' + san(label) + '</label><span>' + san(value) + '</span></div>';
}

function cerrarDetalleMARCia() {
    document.getElementById('marcia-detail-section').style.display = 'none';
    document.getElementById('marcia-results-section').style.display = '';
}

// ==================== MARCia: LIMPIAR / EXPORTAR ====================

function limpiarFormularioMARCia() {
    document.getElementById('marcia-query').value = '';
    ['marcia-adv-title','marcia-adv-name','marcia-adv-number','marcia-adv-goods','marcia-adv-date-from','marcia-adv-date-to'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.value = '';
    });
    ['marcia-adv-title-option','marcia-adv-name-type','marcia-adv-number-type','marcia-adv-class','marcia-adv-status','marcia-adv-apptype','marcia-adv-date-type'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.selectedIndex = 0;
    });
    document.getElementById('marcia-results-section').style.display = 'none';
    document.getElementById('marcia-detail-section').style.display = 'none';
    marciaState.results = []; marciaState.searchId = null; marciaState.totalResults = 0; marciaState.pageNumber = 0;
    marciaState.lastPayload = null; marciaState.lastError = null; marciaState.aggregates = null;
    marciaState.filters = { status: [], niceClass: [], viennaCode: [] };
    marciaFiltrosExpandidos = { niceClass: false, viennaCode: false };
}

function abrirMARCiaExterno() {
    window.open('https://marcia.impi.gob.mx/marcas/search/quick', '_blank');
}

// Tope de filas por exportación: evita cientos de peticiones al IMPI en
// búsquedas muy amplias.
var MARCIA_EXPORT_MAX = 2000;
var MARCIA_EXPORT_PAGE_SIZE = 100;

// Una celda que empieza con = + - @ la interpreta Excel/Sheets como fórmula.
// Se prefija con apóstrofo para que se lea como texto.
function csvCelda(valor) {
    if (valor === null || valor === undefined) valor = '';
    if (Array.isArray(valor)) valor = valor.join('; ');
    else if (typeof valor === 'object') valor = valor.name || valor.title || '';
    var texto = String(valor);
    if (/^[=+\-@\t\r]/.test(texto)) texto = "'" + texto;
    return '"' + texto.replace(/"/g, '""') + '"';
}

function filaCSVMarca(r) {
    return [
        r.title,
        r.applicationNumber,
        r.registrationNumber,
        r.status,
        r.appType,
        r.owners,
        r.classes,
        r.dates && r.dates.application ? r.dates.application : ''
    ].map(csvCelda).join(',') + '\n';
}

// Trae todas las páginas de la búsqueda actual respetando los filtros activos.
// No toca marciaState.pageNumber para no alterar lo que ve el usuario.
async function obtenerTodasLasPaginasMARCia(limite) {
    var todas = [];
    var pagina = 0;
    while (todas.length < limite) {
        var paginaActual = pagina;
        var data = await conReintentoDeSesion(function() {
            return proxyFetch('/marcia/results', {
                method: 'POST',
                body: JSON.stringify(construirBodyResultadosMARCia(paginaActual, MARCIA_EXPORT_PAGE_SIZE))
            });
        }, true);

        var lote = data.resultPage || [];
        if (lote.length === 0) break;
        todas = todas.concat(lote);
        if (lote.length < MARCIA_EXPORT_PAGE_SIZE) break;
        pagina++;
    }
    return todas.slice(0, limite);
}

async function exportarResultadosMARCia() {
    if (marciaState.results.length === 0) return;

    var total = marciaState.totalResults || marciaState.results.length;
    var aExportar = Math.min(total, MARCIA_EXPORT_MAX);
    var registros = marciaState.results;

    // La página visible es solo una parte: si hay más, se descargan todas.
    if (total > marciaState.results.length) {
        var mensaje = 'Se exportarán ' + aExportar + ' de ' + total + ' resultados';
        if (total > MARCIA_EXPORT_MAX) mensaje += ' (máximo ' + MARCIA_EXPORT_MAX + ' por exportación)';
        mensaje += '.\n\nRequiere consultar varias páginas del IMPI y puede tardar unos segundos. ¿Continuar?';
        if (!confirm(mensaje)) return;

        mostrarCargandoIMPI();
        try {
            registros = await obtenerTodasLasPaginasMARCia(aExportar);
        } catch (e) {
            mostrarToast('Error al descargar todos los resultados: ' + e.message, 'error');
            return;
        } finally {
            ocultarCargandoIMPI();
        }
    }

    if (registros.length === 0) { mostrarToast('No hay resultados para exportar', 'warning'); return; }

    var csv = 'Denominación,Expediente,Registro,Estatus,Tipo,Titular,Clases,Fecha Presentación\n';
    registros.forEach(function(r) { csv += filaCSVMarca(r); });

    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'marcas_impi_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);

    var aviso = 'CSV exportado con ' + registros.length + ' resultado' + (registros.length !== 1 ? 's' : '');
    if (total > registros.length) aviso += ' de ' + total;
    mostrarToast(aviso, 'success');
}

// ==================== SIGA: BÚSQUEDA ====================

async function buscarSIGA(opts) {
    opts = opts || {};
    if (sigaState.searching) return false;
    var query = (document.getElementById('siga-query').value || '').trim();
    if (!query) {
        if (!opts.silencioso) mostrarToast('Ingresa un término de búsqueda', 'warning');
        return false;
    }

    var area = document.getElementById('siga-area').value;
    var fechaDesde = document.getElementById('siga-fecha-desde').value || '';
    var fechaHasta = document.getElementById('siga-fecha-hasta').value || '';

    sigaState.searching = true;
    sigaState.lastError = null;
    sigaState.currentQuery = { Busqueda: query, IdArea: area, FechaDesde: fechaDesde, FechaHasta: fechaHasta };
    mostrarCargandoIMPI();

    try {
        var data = await proxyFetch('/siga/search', {
            method: 'POST',
            body: JSON.stringify({
                Busqueda: query,
                IdArea: area,
                IdGaceta: [],
                FechaDesde: fechaDesde,
                FechaHasta: fechaHasta
            })
        });

        if (data.successed === false) {
            throw new Error(data.message || 'Error en la búsqueda SIGA');
        }

        sigaState.results = data.data || [];
        renderizarResultadosSIGA();
        actualizarBotonesGuardar();
        return true;

    } catch (e) {
        sigaState.lastError = e.message;
        if (!opts.silencioso) {
            if (e.message === 'PROXY_NOT_CONFIGURED') {
                mostrarErrorProxy();
            } else {
                console.error('Error SIGA:', e);
                mostrarToast('Error al buscar en SIGA: ' + e.message, 'error');
            }
        }
        return false;
    } finally {
        sigaState.searching = false;
        ocultarCargandoIMPI();
    }
}

// ==================== SIGA: RENDERIZADO ====================

function renderizarResultadosSIGA() {
    var section = document.getElementById('siga-results-section');
    var list = document.getElementById('siga-results-list');
    var countEl = document.getElementById('siga-results-count');

    section.style.display = '';
    countEl.textContent = sigaState.results.length + ' resultado' + (sigaState.results.length !== 1 ? 's' : '');

    if (sigaState.results.length === 0) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon">📰</span><h3>Sin resultados</h3><p>No se encontraron fichas en las gacetas.</p></div>';
        return;
    }

    var html = '';
    sigaState.results.forEach(function(ficha, idx) {
        var datos = ficha.datos || [];
        var denominacion = '';
        var clase = '';
        var registro = '';
        var resolucion = '';

        datos.forEach(function(d) {
            var desc = (d.descripcion || '').toLowerCase();
            if (desc.includes('denominación') || desc.includes('denominacion')) denominacion = d.datoTxt || '';
            else if (desc.includes('clase')) clase = d.datoTxt || '';
            else if (desc.includes('registro')) registro = d.datoTxt || '';
            else if (desc.includes('resolución') || desc.includes('resolucion')) resolucion = d.datoTxt || '';
        });

        var collapseId = 'siga-detail-' + idx;

        // Header row (always visible)
        html += '<div class="impi-result-card siga-card">' +
            '<div class="impi-result-number">#' + (idx + 1) + '</div>' +
            '<div class="impi-result-info" style="width:100%">' +
                '<div class="siga-card-toggle" onclick="toggleSigaDetail(\'' + collapseId + '\', this)" role="button" tabindex="0">' +
                    '<div class="siga-card-summary">' +
                        '<div class="impi-result-title">' + san(denominacion || 'Ficha #' + ficha.fichaId) + '</div>' +
                        '<div class="siga-card-header">' +
                            '<span class="siga-badge-gaceta">' + san(ficha.gaceta || '') + '</span>' +
                            '<span class="siga-badge-seccion">' + san(ficha.seccion || '') + '</span>' +
                        '</div>' +
                        '<div class="impi-result-meta">' +
                            (resolucion ? '<span><strong>Resolución:</strong> ' + san(resolucion) + '</span>' : '') +
                            (registro ? '<span><strong>Registro:</strong> ' + san(registro) + '</span>' : '') +
                            (clase ? '<span><strong>Clase:</strong> ' + san(clase) + '</span>' : '') +
                            '<span><strong>Ejemplar:</strong> ' + san(ficha.ejemplar || '') + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<span class="siga-chevron">&#9660;</span>' +
                '</div>' +
                // Collapsible detail section
                '<div id="' + collapseId + '" class="siga-detail-collapse">' +
                    '<div class="siga-detail-content">' +
                        // Publication info
                        '<div class="siga-detail-section">' +
                            '<div class="siga-detail-heading">Datos de publicación</div>' +
                            '<table class="siga-detail-table">' +
                                '<tr><td class="siga-detail-label">Gaceta</td><td>' + san(ficha.gaceta || '-') + '</td></tr>' +
                                '<tr><td class="siga-detail-label">Sección</td><td>' + san(ficha.seccion || '-') + '</td></tr>' +
                                '<tr><td class="siga-detail-label">Ejemplar</td><td>' + san(ficha.ejemplar || '-') + '</td></tr>' +
                                '<tr><td class="siga-detail-label">Fecha de publicación</td><td>' + san(ficha.fechaPuestaCirculacion || '-') + '</td></tr>' +
                                '<tr><td class="siga-detail-label">Área</td><td>' + san(ficha.areaId === 1 ? 'Patentes' : ficha.areaId === 2 ? 'Marcas' : ficha.areaId === 3 ? 'Protección a la PI' : String(ficha.areaId || '-')) + '</td></tr>' +
                            '</table>' +
                        '</div>' +
                        // All datos from the ficha
                        '<div class="siga-detail-section">' +
                            '<div class="siga-detail-heading">Datos de la ficha</div>' +
                            '<table class="siga-detail-table">' +
                                datos.sort(function(a, b) { return (a.orden || 0) - (b.orden || 0); }).map(function(d) {
                                    return '<tr><td class="siga-detail-label">' + san(d.descripcion || '') + '</td><td>' + san(d.datoTxt || '-') + '</td></tr>';
                                }).join('') +
                            '</table>' +
                        '</div>' +
                        (ficha.imagen ? '<div class="siga-detail-section"><div class="siga-detail-heading">Imagen</div><div class="siga-detail-img-wrap" id="siga-img-' + idx + '"><button class="btn-sm" onclick="cargarImagenSIGA(' + ficha.fichaId + ', ' + idx + ')">Cargar imagen</button></div></div>' : '') +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    });

    list.innerHTML = html;
}

function toggleSigaDetail(id, toggleEl) {
    var el = document.getElementById(id);
    if (!el) return;
    var isOpen = el.classList.toggle('open');
    var chevron = toggleEl.querySelector('.siga-chevron');
    if (chevron) chevron.classList.toggle('open', isOpen);
}

async function cargarImagenSIGA(fichaId, idx) {
    var wrap = document.getElementById('siga-img-' + idx);
    if (!wrap) return;
    wrap.innerHTML = '<span class="siga-detail-loading">Cargando imagen...</span>';
    try {
        var data = await proxyFetch('/siga/ficha', {
            method: 'POST',
            body: JSON.stringify({ id: fichaId, reCaptchaToken: '' })
        });
        if (data && data.data && data.data.imagen) {
            wrap.innerHTML = '<img src="data:image/png;base64,' + data.data.imagen + '" alt="Imagen de marca" class="siga-detail-img" />';
        } else {
            wrap.innerHTML = '<span class="siga-detail-no-img">Imagen no disponible</span>';
        }
    } catch (e) {
        wrap.innerHTML = '<span class="siga-detail-no-img">Error al cargar imagen</span>';
    }
}

function limpiarFormularioSIGA() {
    document.getElementById('siga-query').value = '';
    document.getElementById('siga-area').value = '2';
    document.getElementById('siga-fecha-desde').value = '';
    document.getElementById('siga-fecha-hasta').value = '';
    document.getElementById('siga-results-section').style.display = 'none';
    sigaState.results = [];
}

// ==================== BÚSQUEDAS GUARDADAS (TODAS LAS HERRAMIENTAS) ====================

// Estado global de búsquedas guardadas (todas las herramientas)
var savedSearchesState = {
    searches: [] // { id, tool: 'siga'|'marcia'|'marcanet', query, label, ... }
};

// Helper: acceder al store sigaGuardadas de IndexedDB (usado para todas las herramientas)
function sigaDB(mode) {
    var tx = db.transaction(['sigaGuardadas'], mode);
    return tx.objectStore('sigaGuardadas');
}

async function cargarBusquedasGuardadas() {
    if (!db) return;
    return new Promise(function(resolve) {
        var store = sigaDB('readonly');
        var req = store.getAll();
        req.onsuccess = function() {
            var all = req.result || [];
            // Separar por herramienta
            sigaState.savedSearches = all.filter(function(s) { return !s.tool || s.tool === 'siga'; });
            savedSearchesState.searches = all;
            renderizarBusquedasGuardadas();
            resolve();
        };
        req.onerror = function() { resolve(); };
    });
}

// Guardar búsqueda genérica
function guardarBusqueda(tool, searchData) {
    if (!db) return;

    // Evitar duplicados
    var existe = savedSearchesState.searches.some(function(s) {
        return (s.tool || 'siga') === tool && s.query === searchData.query && (s.subtype || '') === (searchData.subtype || '');
    });
    if (existe) {
        mostrarToast('Esta búsqueda ya está guardada', 'warning');
        return;
    }

    var saved = Object.assign({
        tool: tool,
        fechaGuardado: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
        newCount: 0,
        newFichas: []
    }, searchData);

    saved.fechaCreacion = saved.fechaCreacion || new Date().toISOString();
    saved.fechaActualizacion = new Date().toISOString();
    var store = sigaDB('readwrite');
    var req = store.add(saved);
    req.onsuccess = function() {
        saved.id = req.result;
        savedSearchesState.searches.push(saved);
        if (tool === 'siga') sigaState.savedSearches.push(saved);
        renderizarBusquedasGuardadas();
        mostrarToast('Búsqueda guardada.', 'success');
        if (typeof marcarYSincronizar === 'function') {
            marcarYSincronizar().catch(function() {});
        }
    };
    req.onerror = function() {
        console.error('Error guardando búsqueda:', req.error);
        mostrarToast('No se pudo guardar la búsqueda: ' + ((req.error && req.error.message) || 'error de almacenamiento'), 'error');
    };
}

function guardarBusquedaSIGA() {
    if (!db || !sigaState.currentQuery) return;

    var q = sigaState.currentQuery;
    // Evitar duplicados (legacy check)
    var existe = sigaState.savedSearches.some(function(s) {
        return s.query === q.Busqueda && s.area === q.IdArea;
    });
    if (existe) {
        mostrarToast('Esta búsqueda ya está guardada', 'warning');
        return;
    }

    // Generar hash de fichaIds actuales para detectar cambios después
    var fichaIds = sigaState.results.map(function(f) { return f.fichaId; }).sort();

    var saved = {
        tool: 'siga',
        query: q.Busqueda,
        area: q.IdArea,
        fechaDesde: q.FechaDesde || '',
        fechaHasta: q.FechaHasta || '',
        label: q.Busqueda + (q.IdArea === '1' ? ' (Patentes)' : q.IdArea === '3' ? ' (PI)' : ' (Marcas)'),
        fechaGuardado: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
        lastResultCount: sigaState.results.length,
        lastFichaIds: fichaIds,
        newCount: 0,
        newFichas: []
    };

    saved.fechaCreacion = saved.fechaGuardado;
    saved.fechaActualizacion = saved.fechaGuardado;
    var store = sigaDB('readwrite');
    var req = store.add(saved);
    req.onsuccess = function() {
        saved.id = req.result;
        sigaState.savedSearches.push(saved);
        savedSearchesState.searches.push(saved);
        renderizarBusquedasGuardadas();
        mostrarToast('Búsqueda guardada. Se verificará automáticamente.', 'success');
        if (typeof marcarYSincronizar === 'function') {
            marcarYSincronizar().catch(function() {});
        }
    };
    req.onerror = function() {
        console.error('Error guardando búsqueda SIGA:', req.error);
        mostrarToast('No se pudo guardar la búsqueda: ' + ((req.error && req.error.message) || 'error de almacenamiento'), 'error');
    };
}

// Guardar búsqueda MARCia
function guardarBusquedaMARCia() {
    if (!db || marciaState.results.length === 0) return;
    var query = '';
    if (marciaState.searchMode === 'rapida') {
        query = (document.getElementById('marcia-query').value || '').trim();
    } else {
        query = (document.getElementById('marcia-adv-title').value || '').trim() ||
                (document.getElementById('marcia-adv-name').value || '').trim() ||
                (document.getElementById('marcia-adv-number').value || '').trim();
    }
    if (!query) { mostrarToast('No se pudo determinar el término de búsqueda', 'warning'); return; }

    guardarBusqueda('marcia', {
        query: query,
        subtype: marciaState.searchMode,
        // Una búsqueda avanzada no se puede reconstruir desde un solo término,
        // así que se guarda el payload completo para poder reejecutarla.
        payload: marciaState.lastPayload || null,
        label: query + ' (MARCia)',
        lastResultCount: marciaState.totalResults || marciaState.results.length,
        lastResultIds: marciaState.results.slice(0, 100).map(function(r) { return r.applicationNumber || r.id || ''; }).sort()
    });
}

// Guardar búsqueda Marcanet
function guardarBusquedaMarcanet() {
    if (!db || marcanetState.results.length === 0) return;
    var mode = marcanetState.searchMode;
    var query = '';
    var inputMap = { fonetica: 'mcn-denominacion', expediente: 'mcn-num-expediente', registro: 'mcn-num-registro', titular: 'mcn-titular' };
    query = (document.getElementById(inputMap[mode]) || {}).value || '';
    query = query.trim();
    if (!query) { mostrarToast('No se pudo determinar el término de búsqueda', 'warning'); return; }

    var modeLabels = { fonetica: 'Fonética', expediente: 'Expediente', registro: 'Registro', titular: 'Titular' };
    guardarBusqueda('marcanet', {
        query: query,
        subtype: mode,
        clase: mode === 'fonetica' ? ((document.getElementById('mcn-clase') || {}).value || '') : '',
        label: query + ' (Marcanet ' + modeLabels[mode] + ')',
        lastResultCount: marcanetState.results.length,
        lastResultIds: marcanetState.results.slice(0, 100).map(function(r) { return r['Expediente'] || r['Registro'] || ''; }).sort()
    });
}

function eliminarBusquedaGuardada(id) {
    if (!db) return;
    var store = sigaDB('readwrite');
    var req = store.delete(id);
    sigaState.savedSearches = sigaState.savedSearches.filter(function(s) { return s.id !== id; });
    savedSearchesState.searches = savedSearchesState.searches.filter(function(s) { return s.id !== id; });
    renderizarBusquedasGuardadas();
    req.onsuccess = function() {
        if (typeof marcarYSincronizar === 'function') {
            marcarYSincronizar().catch(function() {});
        }
    };
    req.onerror = function() {
        console.error('Error eliminando búsqueda guardada:', req.error);
        mostrarToast('No se pudo eliminar la búsqueda guardada', 'error');
    };
}

function renderizarBusquedasGuardadas() {
    var section = document.getElementById('siga-saved-section');
    var list = document.getElementById('siga-saved-list');
    if (!section || !list) return;

    var allSearches = savedSearchesState.searches;
    if (allSearches.length === 0) {
        section.style.display = 'none';
        actualizarBotonesGuardar();
        actualizarBotonVigilar();
        return;
    }

    section.style.display = '';
    var html = '';

    var toolIcons = { siga: '📰', marcia: '🔍', marcanet: '📋' };
    var toolColors = { siga: '#e67e22', marcia: '#3498db', marcanet: '#27ae60' };

    allSearches.forEach(function(s) {
        var tool = s.tool || 'siga';
        var toolLabel = tool.toUpperCase();
        if (tool === 'siga') {
            var areaLabel = s.area === '1' ? 'Patentes' : s.area === '3' ? 'Protección PI' : 'Marcas';
            toolLabel = 'SIGA · ' + areaLabel;
        } else if (tool === 'marcanet' && s.subtype) {
            var subtypeLabels = { fonetica: 'Fonética', expediente: 'Expediente', registro: 'Registro', titular: 'Titular' };
            toolLabel = 'MARCANET · ' + (subtypeLabels[s.subtype] || s.subtype);
        } else if (tool === 'marcia') {
            toolLabel = s.subtype === 'marca' ? 'MARCia · Marca vigilada' : 'MARCia';
        }

        var fechaCheck = s.lastChecked ? new Date(s.lastChecked).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Nunca';
        var hasNew = s.newCount > 0;
        var cambio = s.statusChange || null;
        var vence = avisoVencimiento(s);
        var destacar = hasNew || cambio || (vence && vence.urgente);

        // Una marca vigilada muestra su denominación y su estatus, no un
        // conteo de resultados que siempre sería 1.
        var esVigilancia = s.subtype === 'marca' || s.subtype === 'expediente' || s.subtype === 'registro';
        // En una marca vigilada el label es la denominación, que dice más que
        // el número. En Marcanet el label solo repite lo que ya dice la etiqueta.
        var titulo = (s.subtype === 'marca' && s.label) ? s.label : s.query;
        var detalle = esVigilancia
            ? (s.lastStatus ? san(s.lastStatus) : 'Sin estatus aún')
            : (s.lastResultCount || 0) + ' resultado' + ((s.lastResultCount || 0) !== 1 ? 's' : '');

        html += '<div class="siga-saved-item' + (destacar ? ' siga-saved-has-new' : '') + '">' +
            '<div class="siga-saved-info">' +
                '<div class="siga-saved-query">' +
                    (esVigilancia ? '👁️' : (toolIcons[tool] || '')) + ' ' + san(titulo) +
                    (hasNew ? ' <span class="siga-new-badge">' + s.newCount + ' nueva' + (s.newCount > 1 ? 's' : '') + '</span>' : '') +
                    (cambio ? ' <span class="siga-status-badge" title="' + attr(cambio.de + ' → ' + cambio.a) + '">Cambió de estatus</span>' : '') +
                    (vence ? ' <span class="siga-expiry-badge' + (vence.urgente ? ' urgente' : '') + '">' + san(vence.texto) + '</span>' : '') +
                '</div>' +
                '<div class="siga-saved-meta">' +
                    '<span class="siga-badge-gaceta" style="background:' + (toolColors[tool] || '#888') + ';color:#fff">' + san(toolLabel) + '</span>' +
                    '<span>' + detalle + '</span>' +
                    '<span>Revisado: ' + fechaCheck + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="siga-saved-actions">' +
                '<button class="btn btn-sm btn-primary" onclick="ejecutarBusquedaGuardada(' + s.id + ')" title="' + (esVigilancia ? 'Ver expediente' : 'Buscar ahora') + '">🔍</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="verificarBusquedaGuardadaManual(' + s.id + ')" title="Verificar actualizaciones">🔄</button>' +
                '<button class="btn btn-sm btn-danger" onclick="eliminarBusquedaGuardada(' + s.id + ')" title="Eliminar">✕</button>' +
            '</div>' +
        '</div>';
    });
    list.innerHTML = html;

    // Badge global: novedades de las tres herramientas, más los cambios de
    // estatus y las vigencias urgentes de lo que se está vigilando.
    var totalNew = allSearches.reduce(function(sum, s) {
        var n = s.newCount || 0;
        if (s.statusChange) n += 1;
        var v = avisoVencimiento(s);
        if (v && v.urgente) n += 1;
        return sum + n;
    }, 0);
    var badge = document.getElementById('siga-updates-badge');
    if (badge) {
        badge.style.display = totalNew > 0 ? '' : 'none';
        badge.textContent = totalNew;
    }

    // Actualizar badge en el tab de SIGA
    actualizarTabBadge(totalNew);

    // Mostrar/ocultar botones de guardar y vigilar según estado actual
    actualizarBotonesGuardar();
    actualizarBotonVigilar();
}

function actualizarTabBadge(count) {
    var tab = document.querySelector('[data-impi-tab="siga"]');
    if (!tab) return;
    var existing = tab.querySelector('.siga-tab-badge');
    if (count > 0) {
        if (!existing) {
            existing = document.createElement('span');
            existing.className = 'siga-tab-badge';
            tab.appendChild(existing);
        }
        existing.textContent = count;
    } else if (existing) {
        existing.remove();
    }
}

function ejecutarBusquedaGuardada(id) {
    var saved = savedSearchesState.searches.find(function(s) { return s.id === id; });
    if (!saved) return;

    var tool = saved.tool || 'siga';

    // Limpiar las novedades ya vistas
    if (saved.newCount > 0 || saved.statusChange) {
        saved.newCount = 0;
        saved.newFichas = [];
        saved.newResultIds = [];
        delete saved.statusChange;
        actualizarBusquedaEnDB(saved);
        renderizarBusquedasGuardadas();
    }

    // Una marca vigilada abre su expediente, no una búsqueda.
    if (tool === 'marcia' && saved.subtype === 'marca') {
        cambiarTabIMPI('marcia');
        if (saved.markId) {
            verDetalleMARCia(saved.markId);
        } else {
            mostrarToast('Esta marca vigilada no tiene identificador. Elimínala y vuelve a vigilarla desde su detalle.', 'warning');
        }
        return;
    }

    if (tool === 'siga') {
        cambiarTabIMPI('siga');
        document.getElementById('siga-query').value = saved.query;
        document.getElementById('siga-area').value = saved.area || '2';
        document.getElementById('siga-fecha-desde').value = saved.fechaDesde || '';
        document.getElementById('siga-fecha-hasta').value = saved.fechaHasta || '';
        buscarSIGA();
    } else if (tool === 'marcia') {
        cambiarTabIMPI('marcia');
        if (saved.subtype === 'avanzada') {
            toggleMarciaSearchMode('avanzada');
            // El formulario avanzado puede estar vacío o con otros criterios:
            // se reejecuta con el payload guardado, no con lo que esté en pantalla.
            if (saved.payload) {
                buscarMARCia({ payload: saved.payload });
            } else {
                // Búsquedas guardadas antes de que se almacenara el payload.
                mostrarToast('Esta búsqueda avanzada se guardó sin sus criterios. Vuelve a capturarlos y guárdala de nuevo.', 'warning');
            }
        } else {
            toggleMarciaSearchMode('rapida');
            document.getElementById('marcia-query').value = saved.query;
            buscarMARCia();
        }
    } else if (tool === 'marcanet') {
        cambiarTabIMPI('marcanet');
        var mode = saved.subtype || 'fonetica';
        toggleMarcanetMode(mode);
        var inputMap = { fonetica: 'mcn-denominacion', expediente: 'mcn-num-expediente', registro: 'mcn-num-registro', titular: 'mcn-titular' };
        var input = document.getElementById(inputMap[mode]);
        if (input) input.value = saved.query;
        if (mode === 'fonetica' && saved.clase) {
            var claseInput = document.getElementById('mcn-clase');
            if (claseInput) claseInput.value = saved.clase;
        }
        buscarMarcanet();
    }
}

// ==================== VIGILANCIA: HELPERS ====================

// El IMPI entrega las fechas como DD/MM/YYYY, a veces sin cero a la izquierda.
function parsearFechaIMPI(txt) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(txt || '').trim());
    if (!m) return null;
    var d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (isNaN(d.getTime()) || d.getDate() !== Number(m[1])) return null;
    return d;
}

function diasHasta(fecha) {
    if (!fecha) return null;
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var f = new Date(fecha.getTime()); f.setHours(0, 0, 0, 0);
    return Math.round((f - hoy) / 86400000);
}

// Nombre para mostrar en avisos. El mismo término puede estar guardado en
// varias herramientas, y el label ya trae la que corresponde.
function nombreBusqueda(saved) {
    return saved.label || saved.query || 'búsqueda sin nombre';
}

// Ventana de aviso para la vigencia de una marca vigilada.
var DIAS_AVISO_VENCIMIENTO = 180;
var DIAS_VENCIMIENTO_URGENTE = 30;

// Devuelve el aviso de vigencia de una marca vigilada, o null si no aplica.
function avisoVencimiento(saved) {
    var fecha = parsearFechaIMPI(saved.expiryDate);
    if (!fecha) return null;
    var dias = diasHasta(fecha);
    if (dias === null) return null;
    if (dias < 0) return { texto: 'Vencida', urgente: true, dias: dias };
    if (dias > DIAS_AVISO_VENCIMIENTO) return null;
    return {
        texto: dias === 0 ? 'Vence hoy' : 'Vence en ' + dias + ' día' + (dias !== 1 ? 's' : ''),
        urgente: dias <= DIAS_VENCIMIENTO_URGENTE,
        dias: dias
    };
}

// Ejecuta una búsqueda MARCia sin tocar el estado visible (marciaState), para
// que el monitoreo no pise lo que el usuario tiene en pantalla. Arranca con un
// CSRF nuevo, así que reintentar la función completa es la recuperación válida
// si el worker pierde la sesión a media secuencia.
async function buscarMARCiaEnSegundoPlano(payload) {
    await proxyFetch('/marcia/csrf');
    var record = await proxyFetch('/marcia/search', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    var data = await proxyFetch('/marcia/results', {
        method: 'POST',
        body: JSON.stringify({
            searchId: record.id,
            pageSize: MARCIA_EXPORT_PAGE_SIZE,
            pageNumber: 0,
            statusFilter: [], viennaCodeFilter: [], niceClassFilter: []
        })
    });
    return { total: data.totalResults || 0, resultados: data.resultPage || [] };
}

async function obtenerMarcaEnSegundoPlano(markId) {
    await proxyFetch('/marcia/csrf');
    return proxyFetch('/marcia/view/' + encodeURIComponent(markId));
}

async function conUnReintentoDeSesion(fn) {
    try {
        return await fn();
    } catch (e) {
        if (!esErrorDeSesionMARCia(e)) throw e;
        return await fn();
    }
}

// El detalle de MARCia llega en varias formas; result tiene el mismo formato
// que una fila de resultados y es la fuente más limpia.
function extraerEstadoMarca(data) {
    var d = (data && typeof data === 'object') ? data : {};
    var res = (d.result && typeof d.result === 'object') ? d.result : {};
    var det = (d.details && typeof d.details === 'object') ? d.details : {};
    var gi = (det.generalInformation && typeof det.generalInformation === 'object') ? det.generalInformation : {};
    return {
        title: res.title || gi.title || '',
        status: res.status || gi.status || '',
        expiry: (res.dates && res.dates.expiry) || gi.expiryDate || '',
        applicationNumber: res.applicationNumber || gi.applicationNumber || '',
        registrationNumber: res.registrationNumber || gi.registrationNumber || ''
    };
}

// Estatus tal como lo etiqueta Marcanet, que usa nombres de columna distintos.
function extraerEstatusMarcanet(detail) {
    var d = detail || {};
    return d['Situación'] || d['Situacion'] || d['situacion'] ||
           d['Status'] || d['Estado'] || d['estado'] || '';
}

// Compara el conjunto de ids actual contra el guardado y registra las
// novedades. baseComparable indica si los ids guardados se capturaron de la
// misma forma que los recién traídos; si no, esta pasada solo re-toma la línea
// base (comparar una página de 50 contra una de 100 daría falsos positivos).
function compararIdsGuardados(saved, idsActuales, baseComparable) {
    var previos = {};
    (saved.lastResultIds || []).forEach(function(i) { previos[i] = true; });
    var nuevas = baseComparable
        ? idsActuales.filter(function(i) { return !previos[i]; })
        : [];

    saved.lastResultIds = idsActuales.slice(0, 200);
    saved.idsBase = 'monitor';

    if (nuevas.length > 0) {
        saved.newCount = nuevas.length;
        saved.newResultIds = nuevas;
    }
    return nuevas.length;
}

// Registra un cambio de estatus sobre una marca o expediente vigilado.
function registrarCambioEstatus(saved, estatusNuevo, vencimiento) {
    if (vencimiento) saved.expiryDate = vencimiento;
    var previo = saved.lastStatus || '';
    saved.lastStatus = estatusNuevo || previo;
    if (!previo || !estatusNuevo || previo === estatusNuevo) return false;
    saved.statusChange = { de: previo, a: estatusNuevo, fecha: new Date().toISOString() };
    return true;
}

// ==================== VIGILANCIA: VERIFICADORES POR HERRAMIENTA ====================

async function verificarGuardadaSIGA(saved) {
    var data = await proxyFetch('/siga/search', {
        method: 'POST',
        body: JSON.stringify({
            Busqueda: saved.query,
            IdArea: saved.area,
            IdGaceta: [],
            FechaDesde: saved.fechaDesde || '',
            FechaHasta: saved.fechaHasta || ''
        })
    });
    if (!data.successed) return null;

    var fichas = data.data || [];
    var currentIds = fichas.map(function(f) { return f.fichaId; }).sort();
    var previos = {};
    (saved.lastFichaIds || []).forEach(function(i) { previos[i] = true; });
    var nuevas = currentIds.filter(function(i) { return !previos[i]; });

    saved.lastResultCount = fichas.length;
    saved.lastFichaIds = currentIds;
    if (nuevas.length > 0) {
        saved.newCount = nuevas.length;
        saved.newFichas = nuevas;
    }
    return { total: fichas.length, nuevas: nuevas.length, cambioEstatus: false };
}

function payloadDeBusquedaGuardada(saved) {
    if (saved.payload) return saved.payload;
    if (!saved.query) return null;
    return { _type: 'Search$Quick', query: saved.query, images: [] };
}

async function verificarGuardadaMARCia(saved) {
    var payload = payloadDeBusquedaGuardada(saved);
    if (!payload) return null;

    var r = await conUnReintentoDeSesion(function() {
        return buscarMARCiaEnSegundoPlano(payload);
    });
    var ids = r.resultados
        .map(function(x) { return x.applicationNumber || x.id || ''; })
        .filter(Boolean).sort();

    var nuevas = compararIdsGuardados(saved, ids, saved.idsBase === 'monitor');
    saved.lastResultCount = r.total;
    return { total: r.total, nuevas: nuevas, cambioEstatus: false };
}

// Vigilancia de una marca concreta: interesa el cambio de estatus y la
// vigencia, no la aparición de resultados nuevos.
async function verificarMarcaVigilada(saved) {
    if (!saved.markId) return null;
    var data = await conUnReintentoDeSesion(function() {
        return obtenerMarcaEnSegundoPlano(saved.markId);
    });
    var info = extraerEstadoMarca(data);
    if (!info.status && !info.expiry) return null;

    var cambio = registrarCambioEstatus(saved, info.status, info.expiry);
    if (info.title) saved.label = info.title;
    saved.lastResultCount = 1;
    return { total: 1, nuevas: 0, cambioEstatus: cambio };
}

async function verificarGuardadaMarcanet(saved) {
    var mode = saved.subtype || 'fonetica';

    // Expediente y registro devuelven una ficha, no una lista: se vigila su
    // estatus igual que una marca de MARCia.
    if (mode === 'expediente' || mode === 'registro') {
        var endpoint = mode === 'registro' ? '/marcanet/registro' : '/marcanet/expediente';
        var body = mode === 'registro' ? { registro: saved.query } : { expediente: saved.query };
        var ficha = await proxyFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
        var detail = ficha.detail || {};
        if (Object.keys(detail).length === 0) return null;
        var cambio = registrarCambioEstatus(saved, extraerEstatusMarcanet(detail), '');
        saved.lastResultCount = 1;
        return { total: 1, nuevas: 0, cambioEstatus: cambio };
    }

    var data;
    if (mode === 'titular') {
        data = await proxyFetch('/marcanet/titular', {
            method: 'POST', body: JSON.stringify({ titular: saved.query })
        });
    } else {
        data = await proxyFetch('/marcanet/fonetica', {
            method: 'POST',
            body: JSON.stringify({ denominacion: saved.query, clase: saved.clase || '' })
        });
    }
    if (data.isFormPage) return null;

    var resultados = data.results || [];
    var ids = resultados
        .map(function(r) { return r['Expediente'] || r['Registro'] || r['expediente'] || ''; })
        .filter(Boolean).sort();

    // Marcanet devuelve la lista completa de una vez, así que los ids guardados
    // al crear la búsqueda ya son comparables con estos.
    var nuevas = compararIdsGuardados(saved, ids, true);
    saved.lastResultCount = resultados.length;
    return { total: resultados.length, nuevas: nuevas, cambioEstatus: false };
}

// Verifica una búsqueda guardada de cualquier herramienta.
// Devuelve { total, nuevas, cambioEstatus } o null si no se pudo verificar.
async function verificarBusquedaGuardada(id) {
    var saved = savedSearchesState.searches.find(function(s) { return s.id === id; });
    if (!saved) return null;

    var tool = saved.tool || 'siga';
    try {
        var resultado;
        if (tool === 'siga') {
            resultado = await verificarGuardadaSIGA(saved);
        } else if (tool === 'marcia') {
            resultado = saved.subtype === 'marca'
                ? await verificarMarcaVigilada(saved)
                : await verificarGuardadaMARCia(saved);
        } else if (tool === 'marcanet') {
            resultado = await verificarGuardadaMarcanet(saved);
        } else {
            return null;
        }
        if (!resultado) return null;

        saved.lastChecked = new Date().toISOString();
        actualizarBusquedaEnDB(saved);
        renderizarBusquedasGuardadas();
        return resultado;
    } catch (e) {
        console.error('Error verificando búsqueda guardada:', e);
        return null;
    }
}

// Verificación manual desde el botón 🔄: además de actualizar, avisa el
// resultado, porque sin feedback parece que no hizo nada.
async function verificarBusquedaGuardadaManual(id) {
    var saved = savedSearchesState.searches.find(function(s) { return s.id === id; });
    if (!saved) return;

    mostrarCargandoIMPI();
    var resultado;
    try {
        resultado = await verificarBusquedaGuardada(id);
    } finally {
        ocultarCargandoIMPI();
    }

    if (!resultado) {
        mostrarToast('No se pudo verificar "' + nombreBusqueda(saved) + '" en este momento', 'warning');
    } else if (resultado.cambioEstatus) {
        mostrarToast('Cambio de estatus en "' + nombreBusqueda(saved) + '": ' +
            saved.statusChange.de + ' → ' + saved.statusChange.a, 'info');
    } else if (resultado.nuevas > 0) {
        mostrarToast(resultado.nuevas + ' resultado' + (resultado.nuevas > 1 ? 's nuevos' : ' nuevo') +
            ' en "' + nombreBusqueda(saved) + '"', 'info');
    } else {
        mostrarToast('Sin novedades en "' + nombreBusqueda(saved) + '"', 'success');
    }
}

function actualizarBusquedaEnDB(saved) {
    if (!db) return;
    saved.fechaActualizacion = new Date().toISOString();
    var store = sigaDB('readwrite');
    var req = store.put(saved);
    req.onsuccess = function() {
        // Propagar a otros dispositivos: las novedades detectadas por el
        // auto-monitor (newCount, newFichas, lastFichaIds) no son útiles si
        // se quedan locales. marcarYSincronizar marca pendiente y dispara
        // sync en background si hay premium.
        if (typeof marcarYSincronizar === 'function') {
            marcarYSincronizar().catch(function() { /* sync se reintenta solo */ });
        }
    };
}

// Auto-check: verificar todas las búsquedas guardadas (máximo 1 vez al día).
// Cubre SIGA, MARCia y Marcanet, incluidas las marcas y expedientes vigilados.
async function autoCheckBusquedasGuardadas() {
    if (!db || savedSearchesState.searches.length === 0) return;
    if (!getProxyUrl()) return;

    // Revisar si ya se verificó hoy
    var lastCheck = localStorage.getItem('siga_last_auto_check');
    var today = new Date().toDateString();
    if (lastCheck === today) return;

    localStorage.setItem('siga_last_auto_check', today);

    // Copia: verificarBusquedaGuardada re-renderiza y puede reordenar la lista.
    var pendientes = savedSearchesState.searches.slice();
    var totalNuevas = 0;
    var conNovedades = [];
    var conCambioEstatus = [];

    for (var i = 0; i < pendientes.length; i++) {
        var result = await verificarBusquedaGuardada(pendientes[i].id);
        if (result) {
            if (result.nuevas > 0) {
                totalNuevas += result.nuevas;
                conNovedades.push(nombreBusqueda(pendientes[i]));
            }
            if (result.cambioEstatus) conCambioEstatus.push(nombreBusqueda(pendientes[i]));
        }
        // Pequeña pausa entre requests para no saturar
        if (i < pendientes.length - 1) {
            await new Promise(function(r) { setTimeout(r, 500); });
        }
    }

    var avisos = [];
    if (totalNuevas > 0) {
        avisos.push(totalNuevas + ' resultado' + (totalNuevas > 1 ? 's nuevos' : ' nuevo') +
            ' en: ' + conNovedades.join(', '));
    }
    if (conCambioEstatus.length > 0) {
        avisos.push('Cambio de estatus en: ' + conCambioEstatus.join(', '));
    }

    // Vigencias próximas de las marcas vigiladas.
    var porVencer = savedSearchesState.searches
        .map(function(s) {
            var aviso = avisoVencimiento(s);
            return aviso ? nombreBusqueda(s) + ' (' + aviso.texto.toLowerCase() + ')' : null;
        })
        .filter(Boolean);
    if (porVencer.length > 0) avisos.push('Vigencia: ' + porVencer.join(', '));

    if (avisos.length > 0) mostrarToast(avisos.join(' · '), 'info');
}

// ==================== BUSCAR EN LAS 3 HERRAMIENTAS ====================

async function buscarEnLas3() {
    var queryInput = document.getElementById('impi-unified-query');
    var query = queryInput ? queryInput.value.trim() : '';
    if (!query) { mostrarToast('Ingresa un término de búsqueda', 'warning'); return; }

    // El spinner se mantiene tomado durante toda la operación: cada búsqueda
    // lo suelta al terminar, pero este contador evita que se apague antes.
    mostrarCargandoIMPI();

    // Llenar los 3 formularios con el mismo término
    var marciaQ = document.getElementById('marcia-query');
    if (marciaQ) marciaQ.value = query;
    toggleMarciaSearchMode('rapida');

    var mcnDenom = document.getElementById('mcn-denominacion');
    if (mcnDenom) mcnDenom.value = query;
    toggleMarcanetMode('fonetica');

    var sigaQ = document.getElementById('siga-query');
    if (sigaQ) sigaQ.value = query;

    // Lanzar las 3 búsquedas en paralelo. Cada una reporta su propio resultado
    // en silencio; aquí se emite un solo resumen.
    var acuerdos;
    try {
        acuerdos = await Promise.allSettled([
            buscarMARCia({ silencioso: true }),
            buscarMarcanet({ silencioso: true }),
            buscarSIGA({ silencioso: true })
        ]);
    } finally {
        ocultarCargandoIMPI();
    }
    var resultados = acuerdos.map(function(a) { return a.status === 'fulfilled' && a.value === true; });

    var estado = [
        { tab: 'marcia',   nombre: 'MARCia',   ok: resultados[0], count: marciaState.totalResults || marciaState.results.length, error: marciaState.lastError },
        { tab: 'marcanet', nombre: 'Marcanet', ok: resultados[1], count: marcanetState.results.length, error: marcanetState.lastError },
        { tab: 'siga',     nombre: 'SIGA',     ok: resultados[2], count: sigaState.results.length,     error: sigaState.lastError }
    ];

    var resumen = [];
    var errores = [];
    estado.forEach(function(s) {
        if (s.ok) {
            resumen.push(s.nombre + ': ' + s.count + ' resultado' + (s.count !== 1 ? 's' : ''));
        } else {
            errores.push(s.nombre + (s.error ? ': ' + s.error : ''));
        }
    });
    if (errores.length > 0) resumen.push('Sin respuesta de ' + errores.join(' | '));

    mostrarToast(resumen.join(' · '), errores.length > 0 ? 'warning' : 'success');

    // Mostrar el tab con más resultados
    var conResultados = estado.filter(function(s) { return s.ok && s.count > 0; });
    conResultados.sort(function(a, b) { return b.count - a.count; });
    if (conResultados.length > 0) cambiarTabIMPI(conResultados[0].tab);
}

// El término con el que se identifica la búsqueda MARCia actual. En modo
// avanzado el campo #marcia-query está vacío, así que hay que mirar el
// formulario avanzado (igual que guardarBusquedaMARCia).
function terminoActualMARCia() {
    if (marciaState.searchMode === 'rapida') {
        return ((document.getElementById('marcia-query') || {}).value || '').trim();
    }
    return (((document.getElementById('marcia-adv-title') || {}).value || '').trim() ||
            ((document.getElementById('marcia-adv-name') || {}).value || '').trim() ||
            ((document.getElementById('marcia-adv-number') || {}).value || '').trim());
}

// Actualizar visibilidad de botones de guardar
function actualizarBotonesGuardar() {
    // MARCia save button
    var marciaSaveBtn = document.getElementById('marcia-save-search-btn');
    if (marciaSaveBtn) {
        var marciaQuery = terminoActualMARCia();
        var yaGuardadaMarcia = savedSearchesState.searches.some(function(s) {
            return s.tool === 'marcia' && s.query === marciaQuery && (s.subtype || '') === marciaState.searchMode;
        });
        marciaSaveBtn.style.display = (marciaState.results.length > 0 && marciaQuery && !yaGuardadaMarcia) ? '' : 'none';
    }

    // Marcanet save button
    var mcnSaveBtn = document.getElementById('mcn-save-search-btn');
    if (mcnSaveBtn) {
        var inputMap = { fonetica: 'mcn-denominacion', expediente: 'mcn-num-expediente', registro: 'mcn-num-registro', titular: 'mcn-titular' };
        var mcnQuery = (document.getElementById(inputMap[marcanetState.searchMode]) || {}).value || '';
        var yaGuardadaMcn = savedSearchesState.searches.some(function(s) {
            return s.tool === 'marcanet' && s.query === mcnQuery.trim();
        });
        mcnSaveBtn.style.display = (marcanetState.results.length > 0 && !yaGuardadaMcn) ? '' : 'none';
    }

    // SIGA save button (existing logic)
    var sigaSaveBtn = document.getElementById('siga-save-search-btn');
    if (sigaSaveBtn && sigaState.currentQuery) {
        var yaGuardadaSiga = sigaState.savedSearches.some(function(s) {
            return s.query === sigaState.currentQuery.Busqueda && s.area === sigaState.currentQuery.IdArea;
        });
        sigaSaveBtn.style.display = (sigaState.results.length > 0 && !yaGuardadaSiga) ? '' : 'none';
    }
}

// ==================== ENTER KEY HANDLERS ====================

// ==================== Marcanet: TOGGLE MODO ====================

function toggleMarcanetMode(mode) {
    marcanetState.searchMode = mode;
    var modes = ['fonetica', 'expediente', 'registro', 'titular'];
    modes.forEach(function(m) {
        var form = document.getElementById('mcn-form-' + m);
        var btn = document.getElementById('btn-mcn-' + m);
        if (form) form.style.display = m === mode ? '' : 'none';
        if (btn) btn.classList.toggle('active', m === mode);
    });
}

// ==================== Marcanet: BÚSQUEDA ====================

async function buscarMarcanet(opts) {
    opts = opts || {};
    if (marcanetState.searching) return false;
    marcanetState.searching = true;
    marcanetState.lastError = null;

    mostrarCargandoIMPI();

    try {
        var mode = marcanetState.searchMode;
        var data;

        if (mode === 'fonetica') {
            var denominacion = (document.getElementById('mcn-denominacion') || {}).value || '';
            var clase = (document.getElementById('mcn-clase') || {}).value || '';
            if (!denominacion.trim()) {
                if (!opts.silencioso) mostrarToast('Ingresa una denominación para buscar.', 'warning');
                return false;
            }
            data = await proxyFetch('/marcanet/fonetica', {
                method: 'POST',
                body: JSON.stringify({ denominacion: denominacion.trim(), clase: clase })
            });
            if (data.isFormPage) {
                marcanetState.lastError = 'Marcanet devolvió la página del formulario';
                if (!opts.silencioso) mostrarToast('Marcanet devolvió la página del formulario. Es posible que el servidor no esté procesando búsquedas. Intenta directamente en Marcanet.', 'warning');
                marcanetState.results = [];
            } else {
                marcanetState.results = data.results || [];
            }
            renderizarResultadosMarcanet();
            actualizarBotonesGuardar();
            return true;

        } else if (mode === 'expediente') {
            var expediente = (document.getElementById('mcn-num-expediente') || {}).value || '';
            if (!expediente.trim()) {
                if (!opts.silencioso) mostrarToast('Ingresa un número de expediente.', 'warning');
                return false;
            }
            data = await proxyFetch('/marcanet/expediente', {
                method: 'POST',
                body: JSON.stringify({ expediente: expediente.trim() })
            });
            // Búsqueda por expediente devuelve detalle directo
            if (data.detail && Object.keys(data.detail).length > 0) {
                marcanetState.detail = data.detail;
                renderizarDetalleMarcanet(data.detail);
                return true;
            }
            marcanetState.lastError = 'Sin datos para el expediente ' + expediente.trim();
            if (!opts.silencioso) mostrarToast('No se encontraron datos para el expediente ' + san(expediente), 'warning');
            return false;

        } else if (mode === 'registro') {
            var registro = (document.getElementById('mcn-num-registro') || {}).value || '';
            if (!registro.trim()) {
                if (!opts.silencioso) mostrarToast('Ingresa un número de registro.', 'warning');
                return false;
            }
            data = await proxyFetch('/marcanet/registro', {
                method: 'POST',
                body: JSON.stringify({ registro: registro.trim() })
            });
            if (data.detail && Object.keys(data.detail).length > 0) {
                marcanetState.detail = data.detail;
                renderizarDetalleMarcanet(data.detail);
                return true;
            }
            marcanetState.lastError = 'Sin datos para el registro ' + registro.trim();
            if (!opts.silencioso) mostrarToast('No se encontraron datos para el registro ' + san(registro), 'warning');
            return false;

        } else if (mode === 'titular') {
            var titular = (document.getElementById('mcn-titular') || {}).value || '';
            if (!titular.trim()) {
                if (!opts.silencioso) mostrarToast('Ingresa un nombre de titular.', 'warning');
                return false;
            }
            data = await proxyFetch('/marcanet/titular', {
                method: 'POST',
                body: JSON.stringify({ titular: titular.trim() })
            });
            if (data.isFormPage) {
                marcanetState.lastError = 'Marcanet devolvió la página del formulario';
                if (!opts.silencioso) mostrarToast('Marcanet devolvió la página del formulario. Intenta directamente en Marcanet.', 'warning');
                marcanetState.results = [];
            } else {
                marcanetState.results = data.results || [];
            }
            renderizarResultadosMarcanet();
            actualizarBotonesGuardar();
            return true;
        }

        return false;

    } catch (e) {
        marcanetState.lastError = e.message;
        console.error('Marcanet error:', e);
        if (!opts.silencioso) mostrarToast('Error en Marcanet: ' + e.message, 'error');
        return false;
    } finally {
        marcanetState.searching = false;
        ocultarCargandoIMPI();
    }
}

// ==================== Marcanet: RENDERIZAR RESULTADOS ====================

function renderizarResultadosMarcanet() {
    var section = document.getElementById('mcn-results-section');
    var list = document.getElementById('mcn-results-list');
    var countEl = document.getElementById('mcn-results-count');
    var detailSection = document.getElementById('mcn-detail-section');

    if (detailSection) detailSection.style.display = 'none';
    section.style.display = '';
    countEl.textContent = marcanetState.results.length + ' resultado' + (marcanetState.results.length !== 1 ? 's' : '');

    if (marcanetState.results.length === 0) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span><h3>Sin resultados</h3><p>No se encontraron registros con los criterios proporcionados.</p>' +
            '<p style="margin-top: 8px; font-size: 0.85em; color: var(--text-secondary);">Nota: Si Marcanet no responde, intenta directamente en <a href="https://acervomarcas.impi.gob.mx:8181/marcanet/vistas/common/home.pgi" target="_blank" rel="noopener">acervomarcas.impi.gob.mx</a></p></div>';
        return;
    }

    var html = '';
    marcanetState.results.forEach(function(r, idx) {
        // Intentar mapear las columnas a campos conocidos
        var keys = Object.keys(r).filter(function(k) { return !k.startsWith('_'); });
        var title = r['Denominación'] || r['denominacion'] || r['Marca'] || r['marca'] || r[keys[0]] || '';
        var expediente = r['Expediente'] || r['No. Expediente'] || r['expediente'] || r['No. de Expediente'] || '';
        var registro = r['Registro'] || r['No. Registro'] || r['registro'] || r['No. de Registro'] || '';
        var clase = r['Clase'] || r['clase'] || r['Clase Niza'] || '';
        var titular = r['Titular'] || r['titular'] || r['Nombre'] || '';
        var status = r['Situación'] || r['Status'] || r['Estado'] || r['situacion'] || '';

        var statusClass = '';
        if (status) {
            var sl = status.toLowerCase();
            if (sl.indexOf('registr') >= 0 || sl.indexOf('concedi') >= 0) statusClass = 'impi-status-registered';
            else if (sl.indexOf('trámite') >= 0 || sl.indexOf('tramite') >= 0) statusClass = 'impi-status-pending';
            else statusClass = 'impi-status-cancelled';
        }

        // Recopilar campos adicionales no mapeados
        var mappedKeys = ['Denominación', 'denominacion', 'Marca', 'marca',
            'Expediente', 'No. Expediente', 'expediente', 'No. de Expediente',
            'Registro', 'No. Registro', 'registro', 'No. de Registro',
            'Clase', 'clase', 'Clase Niza',
            'Titular', 'titular', 'Nombre',
            'Situación', 'Status', 'Estado', 'situacion'];
        var extraMeta = '';
        keys.forEach(function(k) {
            if (mappedKeys.indexOf(k) < 0 && r[k] && k !== keys[0]) {
                extraMeta += '<span><strong>' + san(k) + ':</strong> ' + san(r[k]) + '</span>';
            }
        });

        html += '<div class="impi-result-card mcn-result-card" onclick="verDetalleMarcanetDesdeResultado(' + idx + ')">' +
            '<div class="impi-result-number">#' + (idx + 1) + '</div>' +
            '<div class="impi-result-info">' +
                '<div class="impi-result-title">' + san(title || 'Sin denominación') + '</div>' +
                (status ? '<span class="impi-status-badge ' + statusClass + '">' + san(status) + '</span>' : '') +
                '<div class="impi-result-meta">' +
                    (expediente ? '<span><strong>Exp:</strong> ' + san(expediente) + '</span>' : '') +
                    (registro ? '<span><strong>Reg:</strong> ' + san(registro) + '</span>' : '') +
                    (clase ? '<span><strong>Clase:</strong> ' + san(clase) + '</span>' : '') +
                '</div>' +
                (titular ? '<div class="impi-result-owner"><strong>Titular:</strong> ' + san(titular) + '</div>' : '') +
                (extraMeta ? '<div class="impi-result-meta" style="margin-top: 4px; font-size: 0.85em;">' + extraMeta + '</div>' : '') +
                '<div style="margin-top: 6px; font-size: 0.8em; color: var(--primary-color);">Click para ver expediente completo →</div>' +
            '</div></div>';
    });

    list.innerHTML = html;
}

// ==================== Marcanet: VER DETALLE ====================

async function verDetalleMarcanetDesdeResultado(idx) {
    var r = marcanetState.results[idx];
    if (!r) return;

    console.log('Marcanet result clicked:', JSON.stringify(r));

    // Extraer datos del resultado para buscar detalle completo
    // Intentar múltiples nombres de campo posibles
    var expediente = r['Expediente'] || r['No. Expediente'] || r['expediente'] || r['No. de Expediente'] ||
        r['No. Exp.'] || r['Exp.'] || r['No_Expediente'] || '';
    var registro = r['Registro'] || r['No. Registro'] || r['registro'] || r['No. de Registro'] ||
        r['No. Reg.'] || r['Reg.'] || r['No_Registro'] || '';
    var link = r['_link_tr'] || '';
    var jsParam = '';
    var denominacion = r['Denominación'] || r['denominacion'] || r['Marca'] || r['marca'] || '';

    for (var k in r) {
        if (k.startsWith('_link_') && r[k] && !link) { link = r[k]; }
        if (k.startsWith('_js_param_') && r[k] && !jsParam) { jsParam = r[k]; }
    }

    // Si no encontramos expediente/registro con nombres conocidos, buscar en TODOS los campos
    // un valor que parezca número de expediente (5-8 dígitos)
    if (!expediente && !registro) {
        var keys = Object.keys(r).filter(function(k) { return !k.startsWith('_'); });
        for (var i = 0; i < keys.length; i++) {
            var val = String(r[keys[i]]).trim();
            // Un número de 5-8 dígitos es probablemente un expediente
            if (/^\d{5,8}$/.test(val)) {
                expediente = val;
                console.log('Marcanet: found likely expediente in field "' + keys[i] + '": ' + val);
                break;
            }
        }
    }

    // Limpiar números
    var expClean = expediente ? expediente.replace(/\D/g, '') : '';
    var regClean = registro ? registro.replace(/\D/g, '') : '';

    // Si no hay datos suficientes, al menos extraer la denominación
    if (!expClean && !regClean && !link && !jsParam && !denominacion) {
        // Tomar el primer valor no vacío como denominación
        var keys2 = Object.keys(r).filter(function(k) { return !k.startsWith('_'); });
        for (var j = 0; j < keys2.length; j++) {
            if (r[keys2[j]] && String(r[keys2[j]]).trim().length > 2) {
                denominacion = String(r[keys2[j]]).trim();
                break;
            }
        }
    }

    mostrarCargandoIMPI();

    try {
        // Usar el endpoint full-detail que combina Marcanet + MARCia
        var data = await proxyFetch('/marcanet/full-detail', {
            method: 'POST',
            body: JSON.stringify({
                expediente: expClean,
                registro: regClean,
                link: link,
                jsParam: jsParam,
                denominacion: denominacion
            })
        });
        console.log('Marcanet full-detail response:', data);
        if (data.debug) console.log('Marcanet debug snippets:', data.debug);

        // Renderizar con todos los datos disponibles
        renderizarDetalleMarcanetCompleto(data, r);

    } catch (e) {
        console.error('Full detail error:', e);
        // Fallback: intentar endpoint simple
        try {
            if (expClean) {
                var data2 = await proxyFetch('/marcanet/expediente', {
                    method: 'POST',
                    body: JSON.stringify({ expediente: expClean })
                });
                if (data2.detail && Object.keys(data2.detail).length > 0) {
                    renderizarDetalleMarcanetCompleto({ detail: data2.detail, sources: ['marcanet-expediente'] }, r);
                    return;
                }
            }
        } catch (e2) { /* ignorar */ }
        // Último fallback: mostrar datos del resultado
        renderizarDetalleMarcanetCompleto({ detail: r, sources: ['resultado-local'] }, r);
    } finally {
        ocultarCargandoIMPI();
    }
}

// Renderizar detalle completo con datos de múltiples fuentes
function renderizarDetalleMarcanetCompleto(data, resultadoOriginal) {
    var section = document.getElementById('mcn-detail-section');
    var content = document.getElementById('mcn-detail-content');
    var resultsSection = document.getElementById('mcn-results-section');
    if (resultsSection) resultsSection.style.display = 'none';

    var detail = data.detail || {};
    var marcia = data.marcia || null;
    var sources = data.sources || [];

    var html = '';

    // === SECCIÓN 1: Información de MARCia (si disponible, es la más completa) ===
    if (marcia && marcia.details) {
        var gi = marcia.details.generalInformation || {};
        var tm = marcia.details.trademark || {};
        var owners = (marcia.details.ownerInformation || {}).owners || [];
        var prods = marcia.details.productsAndServices || [];
        var avisos = marcia.details.avisos || [];
        var history = (marcia.historyData || {}).historyRecords || [];
        var result = marcia.result || {};

        // Imagen de MARCia (TrademarkVision)
        if (tm.image || result.image) {
            html += '<div style="text-align: center; margin-bottom: 16px;">' +
                '<img src="' + attr(urlImagenSegura(tm.image || result.image)) + '" style="max-width: 250px; max-height: 250px; border-radius: 8px; border: 2px solid var(--primary-color); padding: 4px; background: white;" onerror="this.style.display=\'none\'">' +
                '</div>';
        }

        // Título/Denominación
        var titulo = gi.title || result.title || '';
        if (titulo) {
            html += '<h2 style="text-align: center; margin-bottom: 4px; color: var(--primary-color);">' + san(titulo) + '</h2>';
        }

        // Status badge
        var status = result.status || '';
        if (status) {
            var statusClass = '';
            var sl = status.toLowerCase();
            if (sl.indexOf('registr') >= 0 || sl.indexOf('concedi') >= 0) statusClass = 'impi-status-registered';
            else if (sl.indexOf('trámite') >= 0 || sl.indexOf('tramite') >= 0) statusClass = 'impi-status-pending';
            else statusClass = 'impi-status-cancelled';
            html += '<div style="text-align: center; margin-bottom: 16px;"><span class="impi-status-badge ' + statusClass + '" style="font-size: 1em; padding: 4px 12px;">' + san(status) + '</span></div>';
        }

        // Información General
        html += '<div class="mcn-section"><h3 class="mcn-section-title">Información General</h3>';
        html += '<table class="mcn-detail-table">';
        var giFields = [
            ['Denominación', gi.title],
            ['Tipo de Solicitud', gi.appType],
            ['No. de Expediente', gi.applicationNumber],
            ['No. de Registro', gi.registrationNumber],
            ['Fecha de Presentación', gi.applicationDate],
            ['Fecha de Registro', gi.registrationDate],
            ['Fecha de Vencimiento', gi.expiryDate],
            ['Estatus', status]
        ];
        giFields.forEach(function(f) {
            if (f[1]) html += '<tr><td class="mcn-detail-label">' + san(f[0]) + '</td><td class="mcn-detail-value">' + san(f[1]) + '</td></tr>';
        });

        // Clases de Niza
        if (result.classes && result.classes.length > 0) {
            html += '<tr><td class="mcn-detail-label">Clases de Niza</td><td class="mcn-detail-value">' + san(result.classes.join(', ')) + '</td></tr>';
        }

        // Códigos de Viena
        if (tm.viennaCodes && tm.viennaCodes.length > 0) {
            html += '<tr><td class="mcn-detail-label">Códigos de Viena</td><td class="mcn-detail-value">' + san(tm.viennaCodes.join(', ')) + '</td></tr>';
        }

        html += '</table></div>';

        // Titulares
        if (owners.length > 0) {
            html += '<div class="mcn-section"><h3 class="mcn-section-title">Titular(es)</h3>';
            html += '<table class="mcn-detail-table">';
            owners.forEach(function(owner, i) {
                var ownerName = owner.name || owner.nombre || '';
                var ownerType = owner.type || owner.tipo || '';
                if (ownerName) {
                    html += '<tr><td class="mcn-detail-label">' + san(ownerType || ('Titular ' + (i + 1))) + '</td><td class="mcn-detail-value">' + san(ownerName) + '</td></tr>';
                }
                if (owner.address) html += '<tr><td class="mcn-detail-label">Domicilio</td><td class="mcn-detail-value">' + san(owner.address) + '</td></tr>';
                if (owner.country) html += '<tr><td class="mcn-detail-label">País</td><td class="mcn-detail-value">' + san(owner.country) + '</td></tr>';
            });
            html += '</table></div>';
        }

        // Productos y Servicios
        if (prods.length > 0) {
            html += '<div class="mcn-section"><h3 class="mcn-section-title">Productos y Servicios</h3>';
            prods.forEach(function(ps) {
                var claseNum = ps.classNumber || ps.niceClass || ps['class'] || '';
                var desc = ps.description || ps.goodsServices || ps.productos || '';
                if (desc) {
                    html += '<div class="mcn-products-item">';
                    if (claseNum) html += '<strong>Clase ' + san(String(claseNum)) + ':</strong> ';
                    html += '<span>' + san(desc) + '</span>';
                    html += '</div>';
                }
            });
            html += '</div>';
        }

        // Avisos
        if (avisos.length > 0) {
            html += '<div class="mcn-section"><h3 class="mcn-section-title">Avisos / Publicaciones</h3>';
            html += '<table class="mcn-detail-table">';
            avisos.forEach(function(aviso) {
                for (var ak in aviso) {
                    if (aviso[ak]) html += '<tr><td class="mcn-detail-label">' + san(ak) + '</td><td class="mcn-detail-value">' + san(String(aviso[ak])) + '</td></tr>';
                }
            });
            html += '</table></div>';
        }

        // Historial
        if (history.length > 0) {
            html += '<div class="mcn-section"><h3 class="mcn-section-title">Historial del Expediente</h3>';
            html += '<div class="mcn-history-list">';
            history.forEach(function(h) {
                html += '<div class="mcn-history-item">';
                if (h.date || h.fecha) html += '<span class="mcn-history-date">' + san(h.date || h.fecha) + '</span>';
                if (h.description || h.descripcion || h.action) html += '<span class="mcn-history-desc">' + san(h.description || h.descripcion || h.action) + '</span>';
                // Mostrar todos los campos adicionales del historial
                for (var hk in h) {
                    if (hk !== 'date' && hk !== 'fecha' && hk !== 'description' && hk !== 'descripcion' && hk !== 'action' && h[hk]) {
                        html += '<span class="mcn-history-extra"><em>' + san(hk) + ':</em> ' + san(String(h[hk])) + '</span>';
                    }
                }
                html += '</div>';
            });
            html += '</div></div>';
        }
    }

    // === SECCIÓN 2: Datos de Marcanet (complementarios o únicos) ===
    var marcanetKeys = Object.keys(detail).filter(function(k) { return !k.startsWith('_'); });
    if (marcanetKeys.length > 0) {
        // Si ya mostramos MARCia, agregar como sección adicional
        if (marcia && marcia.details) {
            html += '<div class="mcn-section"><h3 class="mcn-section-title">Datos adicionales (Marcanet)</h3>';
        } else {
            // Marcanet es la única fuente
            // Imagen
            if (detail._imagen) {
                html += '<div style="text-align: center; margin-bottom: 16px;">' +
                    '<img src="' + attr(urlImagenSegura(detail._imagen)) + '" style="max-width: 250px; max-height: 250px; border-radius: 8px; border: 2px solid var(--primary-color); padding: 4px; background: white;" onerror="this.style.display=\'none\'">' +
                    '</div>';
            }
            if (detail._titulo) {
                html += '<h2 style="text-align: center; margin-bottom: 16px; color: var(--primary-color);">' + san(detail._titulo) + '</h2>';
            }
            html += '<div class="mcn-section"><h3 class="mcn-section-title">Información del Expediente</h3>';
        }

        html += '<table class="mcn-detail-table">';

        // Campos ordenados primero
        var camposOrdenados = [
            'Denominación', 'denominacion', 'Marca',
            'No. Expediente', 'Expediente', 'expediente', 'Número de expediente',
            'No. Registro', 'Registro', 'registro', 'Número de registro',
            'Situación', 'Status', 'Estado', 'situacion',
            'Tipo de marca', 'Tipo de solicitud', 'Tipo',
            'Clase', 'clase', 'Clase Niza', 'Clase(s)',
            'Titular', 'titular', 'Nombre', 'Datos del titular',
            'Apoderado', 'apoderado', 'Representante',
            'Fecha de presentación', 'Fecha presentación',
            'Fecha de concesión', 'Fecha concesión',
            'Fecha de vigencia', 'Vigencia',
            'Fecha de publicación de la solicitud',
            'Fecha de publicación del registro',
            'Fecha de inicio de uso',
            'Productos y/o servicios', 'Productos', 'Servicios',
            'Número de registro internacional',
            'Código de la clasificación de Viena',
            'Leyendas y figuras no reservables',
            'Aviso comercial', 'Nombre comercial',
            'País de origen', 'Domicilio',
            'Observaciones', 'Notas'
        ];

        var mostrados = {};
        camposOrdenados.forEach(function(campo) {
            if (detail[campo] && !mostrados[campo]) {
                html += '<tr><td class="mcn-detail-label">' + san(campo) + '</td><td class="mcn-detail-value">' + san(detail[campo]) + '</td></tr>';
                mostrados[campo] = true;
            }
        });

        // Todos los campos restantes
        for (var k in detail) {
            if (!k.startsWith('_') && !mostrados[k] && detail[k]) {
                html += '<tr><td class="mcn-detail-label">' + san(k) + '</td><td class="mcn-detail-value">' + san(detail[k]) + '</td></tr>';
            }
        }
        html += '</table></div>';
    }

    // === SECCIÓN 3: Datos del resultado original (si hay campos que no aparecieron) ===
    if (resultadoOriginal) {
        var extraFields = [];
        for (var rk in resultadoOriginal) {
            if (!rk.startsWith('_') && resultadoOriginal[rk] && !detail[rk]) {
                extraFields.push([rk, resultadoOriginal[rk]]);
            }
        }
        if (extraFields.length > 0) {
            html += '<div class="mcn-section"><h3 class="mcn-section-title">Datos del resultado</h3>';
            html += '<table class="mcn-detail-table">';
            extraFields.forEach(function(f) {
                html += '<tr><td class="mcn-detail-label">' + san(f[0]) + '</td><td class="mcn-detail-value">' + san(f[1]) + '</td></tr>';
            });
            html += '</table></div>';
        }
    }

    // === Links directos ===
    var expNum = detail['No. Expediente'] || detail['Expediente'] || detail['expediente'] ||
        (resultadoOriginal && (resultadoOriginal['Expediente'] || resultadoOriginal['No. Expediente'] || resultadoOriginal['expediente'])) || '';
    var regNum = detail['No. Registro'] || detail['Registro'] || detail['registro'] ||
        (resultadoOriginal && (resultadoOriginal['Registro'] || resultadoOriginal['No. Registro'] || resultadoOriginal['registro'])) || '';

    html += '<div style="text-align: center; margin-top: 16px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">';
    if (expNum) {
        var expClean = expNum.replace(/\D/g, '');
        var infoB64 = btoa('1|1|1985|' + expClean);
        html += '<a href="' + attr('https://acervomarcas.impi.gob.mx:8181/marcanet/UCMServlet?info=' + encodeURIComponent(infoB64)) + '" ' +
            'target="_blank" rel="noopener" class="btn btn-sm btn-outline">↗️ Ver expediente en Marcanet</a>';
    }
    html += '</div>';

    // Fuentes de datos
    if (sources.length > 0) {
        html += '<div style="text-align: center; margin-top: 12px; font-size: 0.8em; color: var(--text-secondary);">Fuentes: ' + san(sources.join(', ')) + '</div>';
    }

    content.innerHTML = html;
    section.style.display = '';
}

// Compatibilidad: función legacy para cuando se llama sin datos de MARCia
function renderizarDetalleMarcanet(detail) {
    renderizarDetalleMarcanetCompleto({ detail: detail, sources: ['marcanet'] }, null);
}

function cerrarDetalleMarcanet() {
    document.getElementById('mcn-detail-section').style.display = 'none';
    if (marcanetState.results.length > 0) {
        document.getElementById('mcn-results-section').style.display = '';
    }
}

// ==================== DOMContentLoaded ====================

// Los ids de marca y los códigos de filtro vienen del IMPI, así que viajan en
// data-* y se leen aquí en vez de interpolarse dentro de un onclick.
function inicializarDelegacionMARCia() {
    var lista = document.getElementById('marcia-results-list');
    if (lista) {
        lista.addEventListener('click', function(e) {
            var card = e.target.closest('.impi-result-card[data-mark-id]');
            if (card) verDetalleMARCia(card.dataset.markId);
        });
    }

    var filtros = document.getElementById('marcia-filters');
    if (filtros) {
        filtros.addEventListener('click', function(e) {
            var chip = e.target.closest('.impi-filter-chip');
            if (!chip) return;
            if (chip.dataset.filtroExpandir) {
                var tipo = chip.dataset.filtroExpandir;
                marciaFiltrosExpandidos[tipo] = !marciaFiltrosExpandidos[tipo];
                renderizarFiltrosMARCia();
            } else if (chip.dataset.filtroTipo) {
                toggleFiltroMARCia(chip.dataset.filtroTipo, chip.dataset.filtroValor);
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    inicializarDelegacionMARCia();

    // Enter key para búsqueda unificada
    var unifiedInput = document.getElementById('impi-unified-query');
    if (unifiedInput) {
        unifiedInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); buscarEnLas3(); }
        });
    }

    var marciaInput = document.getElementById('marcia-query');
    if (marciaInput) {
        marciaInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); buscarMARCia(); }
        });
    }
    var sigaInput = document.getElementById('siga-query');
    if (sigaInput) {
        sigaInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); buscarSIGA(); }
        });
    }

    // Enter key para inputs de Marcanet
    ['mcn-denominacion', 'mcn-num-expediente', 'mcn-num-registro', 'mcn-titular'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            el.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); buscarMarcanet(); }
            });
        }
    });

    // Cargar búsquedas guardadas y auto-check al inicio
    // Esperar a que IndexedDB esté lista (initDB se llama en app.js)
    var waitForDB = setInterval(function() {
        if (db) {
            clearInterval(waitForDB);
            cargarBusquedasGuardadas().then(function() {
                autoCheckBusquedasGuardadas();
            });
        }
    }, 200);
});
