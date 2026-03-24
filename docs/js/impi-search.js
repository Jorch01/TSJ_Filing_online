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
    results: [],
    totalResults: 0,
    pageNumber: 0,
    pageSize: 50,
    aggregates: null,
    filters: { status: [], niceClass: [], viennaCode: [] },
    searchMode: 'rapida',
    searching: false
};

var sigaState = {
    results: [],
    searching: false,
    currentQuery: null, // { Busqueda, IdArea, FechaDesde, FechaHasta }
    savedSearches: [],
    lastAutoCheck: null
};

var marcanetState = {
    searchMode: 'fonetica', // 'fonetica', 'expediente', 'registro', 'titular'
    results: [],
    searching: false,
    detail: null
};

function getProxyUrl() {
    return IMPI_PROXY_URL.replace(/\/+$/, '');
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

async function proxyFetch(path, options) {
    var proxy = getProxyUrl();
    if (!proxy) {
        throw new Error('PROXY_NOT_CONFIGURED');
    }
    var url = proxy + path;
    var resp = await fetch(url, Object.assign({
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    }, options));
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

// ==================== MARCia: TOGGLE ====================

function toggleMarciaSearchMode(mode) {
    marciaState.searchMode = mode;
    document.getElementById('marcia-form-rapida').style.display = mode === 'rapida' ? '' : 'none';
    document.getElementById('marcia-form-avanzada').style.display = mode === 'avanzada' ? '' : 'none';
    document.getElementById('btn-marcia-rapida').classList.toggle('active', mode === 'rapida');
    document.getElementById('btn-marcia-avanzada').classList.toggle('active', mode === 'avanzada');
}

// ==================== MARCia: BÚSQUEDA ====================

async function buscarMARCia() {
    if (marciaState.searching) return;

    var payload;
    if (marciaState.searchMode === 'rapida') {
        var query = (document.getElementById('marcia-query').value || '').trim();
        if (!query) { mostrarToast('Ingresa un término de búsqueda', 'warning'); return; }
        payload = { _type: 'Search$Quick', query: query, images: [] };
    } else {
        payload = construirPayloadAvanzadoMARCia();
        if (!payload) return;
    }

    marciaState.searching = true;
    marciaState.pageNumber = 0;
    marciaState.filters = { status: [], niceClass: [], viennaCode: [] };
    var loading = document.getElementById('impi-loading');
    if (loading) loading.style.display = 'flex';

    try {
        // 1. Obtener sesión CSRF
        await proxyFetch('/marcia/csrf');

        // 2. Crear búsqueda
        var recordData = await proxyFetch('/marcia/search', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        marciaState.searchId = recordData.id;
        marciaState.totalResults = recordData.count || 0;

        // 3. Obtener resultados
        await obtenerResultadosMARCia();

    } catch (e) {
        if (e.message === 'PROXY_NOT_CONFIGURED') {
            mostrarErrorProxy();
        } else {
            console.error('Error MARCia:', e);
            mostrarToast('Error al buscar en MARCia: ' + e.message, 'error');
        }
    } finally {
        marciaState.searching = false;
        if (loading) loading.style.display = 'none';
    }
}

function construirPayloadAvanzadoMARCia() {
    var title = (document.getElementById('marcia-adv-title').value || '').trim();
    var titleOption = document.getElementById('marcia-adv-title-option').value;
    var owner = (document.getElementById('marcia-adv-owner').value || '').trim();
    var agent = (document.getElementById('marcia-adv-agent').value || '').trim();
    var number = (document.getElementById('marcia-adv-number').value || '').trim();
    var numberType = document.getElementById('marcia-adv-number-type').value;
    var niceClass = document.getElementById('marcia-adv-class').value;
    var status = document.getElementById('marcia-adv-status').value;
    var appType = document.getElementById('marcia-adv-apptype').value;
    var goods = (document.getElementById('marcia-adv-goods').value || '').trim();
    var dateFrom = document.getElementById('marcia-adv-date-from').value;
    var dateTo = document.getElementById('marcia-adv-date-to').value;
    var dateType = document.getElementById('marcia-adv-date-type').value;

    if (!title && !owner && !agent && !number && !goods) {
        mostrarToast('Ingresa al menos un criterio de búsqueda', 'warning');
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

    if (owner) query.name = { name: owner, types: ['OWNER'] };
    else if (agent) query.name = { name: agent, types: ['AGENT'] };
    if (number) query.number = { name: number, types: [numberType] };
    if (dateFrom || dateTo) {
        query.date = { date: { from: dateFrom || '', to: dateTo || '' }, types: [dateType] };
    }

    return { _type: 'Search$Structured', images: [], query: query };
}

async function obtenerResultadosMARCia() {
    if (!marciaState.searchId) return;
    var loading = document.getElementById('impi-loading');
    if (loading) loading.style.display = 'flex';

    try {
        var data = await proxyFetch('/marcia/results', {
            method: 'POST',
            body: JSON.stringify({
                searchId: marciaState.searchId,
                pageSize: marciaState.pageSize,
                pageNumber: marciaState.pageNumber,
                statusFilter: marciaState.filters.status,
                viennaCodeFilter: marciaState.filters.viennaCode,
                niceClassFilter: marciaState.filters.niceClass
            })
        });

        marciaState.results = data.resultPage || [];
        marciaState.totalResults = data.totalResults || 0;
        marciaState.aggregates = data.aggregates || null;

        renderizarResultadosMARCia();
        renderizarFiltrosMARCia();
        renderizarPaginacionMARCia();
    } catch (e) {
        mostrarToast('Error obteniendo resultados: ' + e.message, 'error');
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

// ==================== MARCia: RENDERIZADO ====================

function san(str) {
    return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(str || '') : (str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        var imgHtml = r.images
            ? '<img src="' + san(r.images) + '" alt="' + san(r.title) + '" class="impi-mark-image" onerror="this.style.display=\'none\'">'
            : '<div class="impi-mark-placeholder">🔰</div>';
        var owners = (Array.isArray(r.owners) ? r.owners : (r.owners ? [r.owners] : [])).map(san).join(', ');
        var classes = (Array.isArray(r.classes) ? r.classes : (r.classes ? [r.classes] : [])).join(', ');
        var appDate = r.dates && r.dates.application ? r.dates.application : '';
        var gi = marciaState.pageNumber * marciaState.pageSize + idx + 1;

        html += '<div class="impi-result-card" onclick="verDetalleMARCia(\'' + san(r.id || '') + '\')">' +
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

function renderizarFiltrosMARCia() {
    var el = document.getElementById('marcia-filters');
    if (!marciaState.aggregates) { el.style.display = 'none'; return; }
    el.style.display = '';

    var statusAgg = marciaState.aggregates.STATUS || [];
    document.getElementById('marcia-filter-status').innerHTML = statusAgg.map(function(s) {
        var active = marciaState.filters.status.indexOf(s.key) >= 0;
        return '<button class="impi-filter-chip' + (active ? ' active' : '') + '" onclick="toggleFiltroMARCia(\'status\',\'' + san(s.key) + '\')">' + san(s.key) + ' (' + s.docCount + ')</button>';
    }).join('');

    var classAgg = marciaState.aggregates.NICE_CLASSES || [];
    document.getElementById('marcia-filter-classes').innerHTML = classAgg.slice(0, 12).map(function(c) {
        var active = marciaState.filters.niceClass.indexOf(c.key) >= 0;
        return '<button class="impi-filter-chip' + (active ? ' active' : '') + '" onclick="toggleFiltroMARCia(\'niceClass\',\'' + san(c.key) + '\')">Clase ' + san(c.key) + ' (' + c.docCount + ')</button>';
    }).join('');
}

function toggleFiltroMARCia(tipo, valor) {
    var arr = marciaState.filters[tipo];
    var idx = arr.indexOf(valor);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(valor);
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
    var loading = document.getElementById('impi-loading');
    if (loading) loading.style.display = 'flex';

    try {
        var data = await proxyFetch('/marcia/view/' + encodeURIComponent(markId));
        console.log('MARCia detail response:', JSON.stringify(data).substring(0, 2000));
        renderizarDetalleMARCia(data);
    } catch (e) {
        console.error('MARCia detail error:', e);
        mostrarToast('Error al obtener detalle: ' + e.message, 'error');
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderizarDetalleMARCia(data) {
    var section = document.getElementById('marcia-detail-section');
    var content = document.getElementById('marcia-detail-content');
    document.getElementById('marcia-results-section').style.display = 'none';

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
    var imgHtml = imgUrl ? '<img src="' + san(imgUrl) + '" class="impi-detail-image" onerror="this.style.display=\'none\'">' : '';

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
    ['marcia-adv-title','marcia-adv-owner','marcia-adv-agent','marcia-adv-number','marcia-adv-goods','marcia-adv-date-from','marcia-adv-date-to'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.value = '';
    });
    ['marcia-adv-title-option','marcia-adv-number-type','marcia-adv-class','marcia-adv-status','marcia-adv-apptype','marcia-adv-date-type'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.selectedIndex = 0;
    });
    document.getElementById('marcia-results-section').style.display = 'none';
    document.getElementById('marcia-detail-section').style.display = 'none';
    marciaState.results = []; marciaState.searchId = null; marciaState.totalResults = 0; marciaState.pageNumber = 0;
    marciaState.filters = { status: [], niceClass: [], viennaCode: [] };
}

function abrirMARCiaExterno() {
    window.open('https://marcia.impi.gob.mx/marcas/search/quick', '_blank');
}

function exportarResultadosMARCia() {
    if (marciaState.results.length === 0) return;
    var csv = 'Denominación,Expediente,Registro,Estatus,Tipo,Titular,Clases,Fecha Presentación\n';
    marciaState.results.forEach(function(r) {
        csv += '"' + (r.title || '').replace(/"/g, '""') + '",' +
            '"' + (r.applicationNumber || '') + '",' +
            '"' + (r.registrationNumber || '') + '",' +
            '"' + (r.status || '') + '",' +
            '"' + (r.appType || '') + '",' +
            '"' + (r.owners || []).join('; ').replace(/"/g, '""') + '",' +
            '"' + (r.classes || []).join('; ') + '",' +
            '"' + (r.dates && r.dates.application ? r.dates.application : '') + '"\n';
    });
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'marcas_impi_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    mostrarToast('CSV exportado con ' + marciaState.results.length + ' resultados', 'success');
}

// ==================== SIGA: BÚSQUEDA ====================

async function buscarSIGA() {
    if (sigaState.searching) return;
    var query = (document.getElementById('siga-query').value || '').trim();
    if (!query) { mostrarToast('Ingresa un término de búsqueda', 'warning'); return; }

    var area = document.getElementById('siga-area').value;
    var fechaDesde = document.getElementById('siga-fecha-desde').value || '';
    var fechaHasta = document.getElementById('siga-fecha-hasta').value || '';

    sigaState.searching = true;
    sigaState.currentQuery = { Busqueda: query, IdArea: area, FechaDesde: fechaDesde, FechaHasta: fechaHasta };
    var loading = document.getElementById('impi-loading');
    if (loading) loading.style.display = 'flex';

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

        // Mostrar botón de guardar si hay resultados y no está ya guardada
        var saveBtn = document.getElementById('siga-save-search-btn');
        if (saveBtn) {
            var yaGuardada = sigaState.savedSearches.some(function(s) {
                return s.query === query && s.area === area;
            });
            saveBtn.style.display = (sigaState.results.length > 0 && !yaGuardada) ? '' : 'none';
        }

    } catch (e) {
        if (e.message === 'PROXY_NOT_CONFIGURED') {
            mostrarErrorProxy();
        } else {
            console.error('Error SIGA:', e);
            mostrarToast('Error al buscar en SIGA: ' + e.message, 'error');
        }
    } finally {
        sigaState.searching = false;
        if (loading) loading.style.display = 'none';
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

// ==================== SIGA: BÚSQUEDAS GUARDADAS ====================

// Helper: acceder al store sigaGuardadas de IndexedDB
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
            sigaState.savedSearches = req.result || [];
            renderizarBusquedasGuardadas();
            resolve();
        };
        req.onerror = function() { resolve(); };
    });
}

function guardarBusquedaSIGA() {
    if (!db || !sigaState.currentQuery) return;

    var q = sigaState.currentQuery;
    // Evitar duplicados
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

    var store = sigaDB('readwrite');
    var req = store.add(saved);
    req.onsuccess = function() {
        saved.id = req.result;
        sigaState.savedSearches.push(saved);
        renderizarBusquedasGuardadas();
        mostrarToast('Búsqueda guardada. Se verificará automáticamente.', 'success');
    };
}

function eliminarBusquedaGuardada(id) {
    if (!db) return;
    var store = sigaDB('readwrite');
    store.delete(id);
    sigaState.savedSearches = sigaState.savedSearches.filter(function(s) { return s.id !== id; });
    renderizarBusquedasGuardadas();
}

function renderizarBusquedasGuardadas() {
    var section = document.getElementById('siga-saved-section');
    var list = document.getElementById('siga-saved-list');
    if (!section || !list) return;

    if (sigaState.savedSearches.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    var html = '';
    sigaState.savedSearches.forEach(function(s) {
        var areaLabel = s.area === '1' ? 'Patentes' : s.area === '3' ? 'Protección PI' : 'Marcas';
        var fechaCheck = s.lastChecked ? new Date(s.lastChecked).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Nunca';
        var hasNew = s.newCount > 0;

        html += '<div class="siga-saved-item' + (hasNew ? ' siga-saved-has-new' : '') + '">' +
            '<div class="siga-saved-info">' +
                '<div class="siga-saved-query">' +
                    san(s.query) +
                    (hasNew ? ' <span class="siga-new-badge">' + s.newCount + ' nueva' + (s.newCount > 1 ? 's' : '') + '</span>' : '') +
                '</div>' +
                '<div class="siga-saved-meta">' +
                    '<span class="siga-badge-gaceta">' + san(areaLabel) + '</span>' +
                    '<span>' + s.lastResultCount + ' resultado' + (s.lastResultCount !== 1 ? 's' : '') + '</span>' +
                    '<span>Revisado: ' + fechaCheck + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="siga-saved-actions">' +
                '<button class="btn btn-sm btn-primary" onclick="ejecutarBusquedaGuardada(' + s.id + ')" title="Buscar ahora">🔍</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="verificarBusquedaGuardada(' + s.id + ')" title="Verificar actualizaciones">🔄</button>' +
                '<button class="btn btn-sm btn-danger" onclick="eliminarBusquedaGuardada(' + s.id + ')" title="Eliminar">✕</button>' +
            '</div>' +
        '</div>';
    });
    list.innerHTML = html;

    // Actualizar badge global
    var totalNew = sigaState.savedSearches.reduce(function(sum, s) { return sum + (s.newCount || 0); }, 0);
    var badge = document.getElementById('siga-updates-badge');
    if (badge) {
        badge.style.display = totalNew > 0 ? '' : 'none';
        badge.textContent = totalNew;
    }

    // Actualizar badge en el tab de SIGA
    actualizarTabBadge(totalNew);
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
    var saved = sigaState.savedSearches.find(function(s) { return s.id === id; });
    if (!saved) return;

    // Llenar formulario y buscar
    document.getElementById('siga-query').value = saved.query;
    document.getElementById('siga-area').value = saved.area;
    document.getElementById('siga-fecha-desde').value = saved.fechaDesde || '';
    document.getElementById('siga-fecha-hasta').value = saved.fechaHasta || '';

    // Limpiar el conteo de novedades
    if (saved.newCount > 0) {
        saved.newCount = 0;
        saved.newFichas = [];
        actualizarBusquedaEnDB(saved);
        renderizarBusquedasGuardadas();
    }

    buscarSIGA();
}

async function verificarBusquedaGuardada(id) {
    var saved = sigaState.savedSearches.find(function(s) { return s.id === id; });
    if (!saved) return;

    try {
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

        if (!data.successed) return;

        var fichas = data.data || [];
        var currentIds = fichas.map(function(f) { return f.fichaId; }).sort();
        var prevIds = (saved.lastFichaIds || []);

        // Detectar fichas nuevas
        var prevSet = {};
        prevIds.forEach(function(id) { prevSet[id] = true; });
        var nuevas = currentIds.filter(function(id) { return !prevSet[id]; });

        saved.lastChecked = new Date().toISOString();
        saved.lastResultCount = fichas.length;
        saved.lastFichaIds = currentIds;

        if (nuevas.length > 0) {
            saved.newCount = nuevas.length;
            saved.newFichas = nuevas;
        }

        actualizarBusquedaEnDB(saved);
        renderizarBusquedasGuardadas();

        return { total: fichas.length, nuevas: nuevas.length };
    } catch (e) {
        console.error('Error verificando búsqueda guardada:', e);
        return null;
    }
}

function actualizarBusquedaEnDB(saved) {
    if (!db) return;
    var store = sigaDB('readwrite');
    store.put(saved);
}

// Auto-check: verificar todas las búsquedas guardadas (máximo 1 vez al día)
async function autoCheckBusquedasGuardadas() {
    if (!db || sigaState.savedSearches.length === 0) return;
    if (!getProxyUrl()) return;

    // Revisar si ya se verificó hoy
    var lastCheck = localStorage.getItem('siga_last_auto_check');
    var today = new Date().toDateString();
    if (lastCheck === today) return;

    localStorage.setItem('siga_last_auto_check', today);

    var totalNuevas = 0;
    var busquedasConNovedades = [];

    for (var i = 0; i < sigaState.savedSearches.length; i++) {
        var result = await verificarBusquedaGuardada(sigaState.savedSearches[i].id);
        if (result && result.nuevas > 0) {
            totalNuevas += result.nuevas;
            busquedasConNovedades.push(sigaState.savedSearches[i].query);
        }
        // Pequeña pausa entre requests para no saturar
        if (i < sigaState.savedSearches.length - 1) {
            await new Promise(function(r) { setTimeout(r, 500); });
        }
    }

    if (totalNuevas > 0) {
        mostrarToast(
            totalNuevas + ' publicación' + (totalNuevas > 1 ? 'es' : '') +
            ' nueva' + (totalNuevas > 1 ? 's' : '') +
            ' en gacetas: ' + busquedasConNovedades.join(', '),
            'info'
        );
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

async function buscarMarcanet() {
    if (marcanetState.searching) return;
    marcanetState.searching = true;

    var loading = document.getElementById('impi-loading');
    if (loading) loading.style.display = 'flex';

    try {
        var mode = marcanetState.searchMode;
        var data;

        if (mode === 'fonetica') {
            var denominacion = (document.getElementById('mcn-denominacion') || {}).value || '';
            var clase = (document.getElementById('mcn-clase') || {}).value || '';
            if (!denominacion.trim()) { mostrarToast('Ingresa una denominación para buscar.', 'warning'); return; }
            data = await proxyFetch('/marcanet/fonetica', {
                method: 'POST',
                body: JSON.stringify({ denominacion: denominacion.trim(), clase: clase })
            });
            console.log('Marcanet fonetica response:', data);
            if (data.debug) console.log('Marcanet fonetica debug:', data.debug);
            if (data.results && data.results.length > 0) console.log('Marcanet first result keys/values:', JSON.stringify(data.results[0]));
            if (data.isFormPage) {
                mostrarToast('Marcanet devolvió la página del formulario. Es posible que el servidor no esté procesando búsquedas. Intenta directamente en Marcanet.', 'warning');
                marcanetState.results = [];
            } else {
                marcanetState.results = data.results || [];
            }
            renderizarResultadosMarcanet();

        } else if (mode === 'expediente') {
            var expediente = (document.getElementById('mcn-num-expediente') || {}).value || '';
            if (!expediente.trim()) { mostrarToast('Ingresa un número de expediente.', 'warning'); return; }
            data = await proxyFetch('/marcanet/expediente', {
                method: 'POST',
                body: JSON.stringify({ expediente: expediente.trim() })
            });
            console.log('Marcanet expediente response:', data);
            // Búsqueda por expediente devuelve detalle directo
            if (data.detail && Object.keys(data.detail).length > 0) {
                marcanetState.detail = data.detail;
                renderizarDetalleMarcanet(data.detail);
            } else {
                mostrarToast('No se encontraron datos para el expediente ' + san(expediente), 'warning');
            }
            return;

        } else if (mode === 'registro') {
            var registro = (document.getElementById('mcn-num-registro') || {}).value || '';
            if (!registro.trim()) { mostrarToast('Ingresa un número de registro.', 'warning'); return; }
            data = await proxyFetch('/marcanet/registro', {
                method: 'POST',
                body: JSON.stringify({ registro: registro.trim() })
            });
            console.log('Marcanet registro response:', data);
            if (data.detail && Object.keys(data.detail).length > 0) {
                marcanetState.detail = data.detail;
                renderizarDetalleMarcanet(data.detail);
            } else {
                mostrarToast('No se encontraron datos para el registro ' + san(registro), 'warning');
            }
            return;

        } else if (mode === 'titular') {
            var titular = (document.getElementById('mcn-titular') || {}).value || '';
            if (!titular.trim()) { mostrarToast('Ingresa un nombre de titular.', 'warning'); return; }
            data = await proxyFetch('/marcanet/titular', {
                method: 'POST',
                body: JSON.stringify({ titular: titular.trim() })
            });
            console.log('Marcanet titular response:', data);
            if (data.isFormPage) {
                mostrarToast('Marcanet devolvió la página del formulario. Intenta directamente en Marcanet.', 'warning');
                marcanetState.results = [];
            } else {
                marcanetState.results = data.results || [];
            }
            renderizarResultadosMarcanet();
        }

    } catch (e) {
        console.error('Marcanet error:', e);
        mostrarToast('Error en Marcanet: ' + e.message, 'error');
    } finally {
        marcanetState.searching = false;
        if (loading) loading.style.display = 'none';
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

    var loading = document.getElementById('impi-loading');
    if (loading) loading.style.display = 'flex';

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
        if (loading) loading.style.display = 'none';
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
                '<img src="' + san(tm.image || result.image) + '" style="max-width: 250px; max-height: 250px; border-radius: 8px; border: 2px solid var(--primary-color); padding: 4px; background: white;" onerror="this.style.display=\'none\'">' +
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
                    '<img src="' + san(detail._imagen) + '" style="max-width: 250px; max-height: 250px; border-radius: 8px; border: 2px solid var(--primary-color); padding: 4px; background: white;" onerror="this.style.display=\'none\'">' +
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
        html += '<a href="' + san('https://acervomarcas.impi.gob.mx:8181/marcanet/UCMServlet?info=' + encodeURIComponent(infoB64)) + '" ' +
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

document.addEventListener('DOMContentLoaded', function() {
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
