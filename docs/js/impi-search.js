// ==================== BÚSQUEDA IMPI (MARCia + SIGA) ====================
// Integración directa con MARCia (marcas) y SIGA 2.0 (gacetas) del IMPI.
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
        renderizarDetalleMARCia(data);
    } catch (e) {
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
    function asArr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }

    var d = data.details || {};
    var gi = d.generalInformation || {};
    var tm = d.trademark || {};
    var oi = d.ownerInformation || {};
    var ps = asArr(d.productsAndServices);

    var imgUrl = tm.image || (data.result && data.result.images) || '';
    var imgHtml = imgUrl ? '<img src="' + san(imgUrl) + '" class="impi-detail-image" onerror="this.style.display=\'none\'">' : '';

    var ownersHtml = '';
    var ownersList = asArr(oi.owners);
    if (ownersList.length > 0) {
        ownersHtml = '<div class="impi-detail-section"><h4>Titulares</h4>' + ownersList.map(function(o) {
            var name = typeof o === 'string' ? o : o.name || '';
            var addr = typeof o === 'object' && o.address ? '<br><small>' + san(o.address) + '</small>' : '';
            return '<div class="impi-detail-owner"><strong>' + san(name) + '</strong>' + addr + '</div>';
        }).join('') + '</div>';
    }

    var productsHtml = '';
    if (ps.length > 0) {
        productsHtml = '<div class="impi-detail-section"><h4>Productos y Servicios</h4>' + ps.map(function(p) {
            return '<div class="impi-detail-product"><strong>Clase ' + san(String(p.niceClass || p.classNumber || '')) + ':</strong> ' + san(p.description || p.goodsServices || '') + '</div>';
        }).join('') + '</div>';
    }

    var histHtml = '';
    var histRecords = asArr(data.historyData && data.historyData.historyRecords);
    if (histRecords.length > 0) {
        histHtml = '<div class="impi-detail-section"><h4>Historial</h4><div class="impi-history-list">' +
            histRecords.map(function(h) {
                return '<div class="impi-history-item"><span class="impi-history-date">' + san(h.date || '') + '</span><span>' + san(h.description || h.status || '') + '</span></div>';
            }).join('') + '</div></div>';
    }

    var viennaCodes = asArr(tm.viennaCodes).map(function(v) { return san(String(v)); }).join(', ');

    content.innerHTML =
        '<div class="impi-detail-grid">' +
            '<div class="impi-detail-left">' + imgHtml + '</div>' +
            '<div class="impi-detail-right">' +
                '<h2>' + san(gi.title || 'Sin denominación') + '</h2>' +
                '<div class="impi-detail-fields">' +
                    campo('Tipo de solicitud', gi.appType) +
                    campo('No. Expediente', gi.applicationNumber) +
                    campo('No. Registro', gi.registrationNumber) +
                    campo('Fecha de presentación', gi.applicationDate) +
                    campo('Fecha de registro', gi.registrationDate) +
                    campo('Fecha de vencimiento', gi.expiryDate) +
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
