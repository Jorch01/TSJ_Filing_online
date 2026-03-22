// ==================== BÚSQUEDA IMPI (MARCia + SIGA) ====================
// Integración con MARCia (marcas) y SIGA 2.0 (gacetas) del IMPI.
// MARCia: API REST con CSRF token, sin reCAPTCHA.
// SIGA: Requiere reCAPTCHA v3, se abre en portal externo como fallback.

// ==================== ESTADO GLOBAL ====================

var marciaState = {
    searchId: null,
    csrfToken: null,
    results: [],
    totalResults: 0,
    pageNumber: 0,
    pageSize: 50,
    aggregates: null,
    filters: {
        status: [],
        niceClass: [],
        viennaCode: []
    },
    searchMode: 'rapida', // 'rapida' o 'avanzada'
    searching: false
};

var MARCIA_BASE = 'https://marcia.impi.gob.mx';
var SIGA_BASE = 'https://siga.impi.gob.mx';

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

// ==================== MARCia: TOGGLE BÚSQUEDA ====================

function toggleMarciaSearchMode(mode) {
    marciaState.searchMode = mode;
    var formRapida = document.getElementById('marcia-form-rapida');
    var formAvanzada = document.getElementById('marcia-form-avanzada');
    var btnRapida = document.getElementById('btn-marcia-rapida');
    var btnAvanzada = document.getElementById('btn-marcia-avanzada');

    if (mode === 'rapida') {
        formRapida.style.display = '';
        formAvanzada.style.display = 'none';
        btnRapida.classList.add('active');
        btnAvanzada.classList.remove('active');
    } else {
        formRapida.style.display = 'none';
        formAvanzada.style.display = '';
        btnRapida.classList.remove('active');
        btnAvanzada.classList.add('active');
    }
}

// ==================== MARCia: OBTENER CSRF TOKEN ====================

async function obtenerCsrfMARCia() {
    try {
        var resp = await fetch(MARCIA_BASE + '/marcas/search/quick', {
            credentials: 'include',
            mode: 'cors'
        });
        var html = await resp.text();
        var match = html.match(/<meta\s+name="_csrf"\s+content="([^"]+)"/);
        if (match) {
            marciaState.csrfToken = match[1];
            return match[1];
        }
        throw new Error('No se encontró token CSRF');
    } catch (e) {
        console.warn('No se pudo obtener CSRF de MARCia:', e.message);
        return null;
    }
}

// ==================== MARCia: BÚSQUEDA ====================

async function buscarMARCia() {
    if (marciaState.searching) return;

    var query = '';
    var payload = null;

    if (marciaState.searchMode === 'rapida') {
        query = (document.getElementById('marcia-query').value || '').trim();
        if (!query) {
            mostrarNotificacion('Ingresa un término de búsqueda', 'warning');
            return;
        }
        payload = {
            _type: 'Search$Quick',
            query: query,
            images: []
        };
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
        // Paso 1: Obtener CSRF token
        var csrf = await obtenerCsrfMARCia();
        if (!csrf) {
            // Fallback: abrir MARCia en nueva pestaña
            abrirMARCiaExterno(query);
            return;
        }

        // Paso 2: Crear búsqueda
        var recordResp = await fetch(MARCIA_BASE + '/marcas/search/internal/record', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-XSRF-TOKEN': csrf
            },
            body: JSON.stringify(payload)
        });

        if (!recordResp.ok) throw new Error('Error al crear búsqueda: ' + recordResp.status);
        var recordData = await recordResp.json();
        marciaState.searchId = recordData.id;
        marciaState.totalResults = recordData.count || 0;

        // Paso 3: Obtener resultados
        await obtenerResultadosMARCia();

    } catch (e) {
        console.error('Error en búsqueda MARCia:', e);
        // Fallback: abrir en nueva pestaña
        mostrarNotificacion('No se pudo conectar directamente a MARCia. Abriendo en nueva pestaña...', 'warning');
        abrirMARCiaExterno(query);
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

    // Al menos un campo debe estar lleno
    if (!title && !owner && !agent && !number && !goods) {
        mostrarNotificacion('Ingresa al menos un criterio de búsqueda', 'warning');
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

    if (owner) {
        query.name = { name: owner, types: ['OWNER'] };
    } else if (agent) {
        query.name = { name: agent, types: ['AGENT'] };
    }

    if (number) {
        query.number = { name: number, types: [numberType] };
    }

    if (dateFrom || dateTo) {
        query.date = {
            date: { from: dateFrom || '', to: dateTo || '' },
            types: [dateType]
        };
    }

    return {
        _type: 'Search$Structured',
        images: [],
        query: query
    };
}

async function obtenerResultadosMARCia() {
    if (!marciaState.searchId || !marciaState.csrfToken) return;

    var loading = document.getElementById('impi-loading');
    if (loading) loading.style.display = 'flex';

    try {
        var body = {
            searchId: marciaState.searchId,
            pageSize: marciaState.pageSize,
            pageNumber: marciaState.pageNumber,
            statusFilter: marciaState.filters.status,
            viennaCodeFilter: marciaState.filters.viennaCode,
            niceClassFilter: marciaState.filters.niceClass
        };

        var resp = await fetch(MARCIA_BASE + '/marcas/search/internal/result', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-XSRF-TOKEN': marciaState.csrfToken
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) throw new Error('Error al obtener resultados: ' + resp.status);
        var data = await resp.json();

        marciaState.results = data.resultPage || [];
        marciaState.totalResults = data.totalResults || 0;
        marciaState.aggregates = data.aggregates || null;

        renderizarResultadosMARCia();
        renderizarFiltrosMARCia();
        renderizarPaginacionMARCia();

    } catch (e) {
        console.error('Error obteniendo resultados MARCia:', e);
        mostrarNotificacion('Error al obtener resultados: ' + e.message, 'error');
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

// ==================== MARCia: RENDERIZADO ====================

function renderizarResultadosMARCia() {
    var section = document.getElementById('marcia-results-section');
    var list = document.getElementById('marcia-results-list');
    var countEl = document.getElementById('marcia-results-count');
    var exportBtn = document.getElementById('btn-export-marcia');

    section.style.display = '';

    countEl.textContent = marciaState.totalResults + ' resultado' + (marciaState.totalResults !== 1 ? 's' : '');

    if (exportBtn) exportBtn.style.display = marciaState.results.length > 0 ? '' : 'none';

    if (marciaState.results.length === 0) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span>' +
            '<h3>Sin resultados</h3><p>No se encontraron marcas con los criterios proporcionados.</p></div>';
        return;
    }

    var html = '';
    marciaState.results.forEach(function(r, idx) {
        var statusClass = '';
        var statusText = r.status || '';
        if (statusText === 'REGISTRADO') statusClass = 'impi-status-registered';
        else if (statusText === 'EN TRÁMITE') statusClass = 'impi-status-pending';
        else statusClass = 'impi-status-cancelled';

        var imgUrl = r.images || '';
        var imgHtml = imgUrl
            ? '<img src="' + DOMPurify.sanitize(imgUrl) + '" alt="' + DOMPurify.sanitize(r.title || '') + '" class="impi-mark-image" onerror="this.style.display=\'none\'">'
            : '<div class="impi-mark-placeholder">🔰</div>';

        var owners = (r.owners || []).map(function(o) { return DOMPurify.sanitize(o); }).join(', ');
        var classes = (r.classes || []).join(', ');
        var appDate = r.dates && r.dates.application ? r.dates.application : '';

        var globalIdx = marciaState.pageNumber * marciaState.pageSize + idx + 1;

        html += '<div class="impi-result-card" onclick="verDetalleMARCia(\'' + DOMPurify.sanitize(r.id || '') + '\')">' +
            '<div class="impi-result-number">#' + globalIdx + '</div>' +
            '<div class="impi-result-image">' + imgHtml + '</div>' +
            '<div class="impi-result-info">' +
                '<div class="impi-result-title">' + DOMPurify.sanitize(r.title || 'Sin denominación') + '</div>' +
                '<span class="impi-status-badge ' + statusClass + '">' + DOMPurify.sanitize(statusText) + '</span>' +
                '<div class="impi-result-meta">' +
                    (r.applicationNumber ? '<span><strong>Exp:</strong> ' + DOMPurify.sanitize(r.applicationNumber) + '</span>' : '') +
                    (r.registrationNumber ? '<span><strong>Reg:</strong> ' + DOMPurify.sanitize(r.registrationNumber) + '</span>' : '') +
                    (classes ? '<span><strong>Clase:</strong> ' + DOMPurify.sanitize(classes) + '</span>' : '') +
                    (appDate ? '<span><strong>Fecha:</strong> ' + DOMPurify.sanitize(appDate) + '</span>' : '') +
                '</div>' +
                (owners ? '<div class="impi-result-owner"><strong>Titular:</strong> ' + owners + '</div>' : '') +
                (r.appType ? '<div class="impi-result-type">' + DOMPurify.sanitize(r.appType) + '</div>' : '') +
            '</div>' +
        '</div>';
    });

    list.innerHTML = html;
}

function renderizarFiltrosMARCia() {
    var filtersEl = document.getElementById('marcia-filters');
    if (!marciaState.aggregates) {
        filtersEl.style.display = 'none';
        return;
    }
    filtersEl.style.display = '';

    // Estatus
    var statusContainer = document.getElementById('marcia-filter-status');
    var statusAgg = marciaState.aggregates.STATUS || [];
    statusContainer.innerHTML = statusAgg.map(function(s) {
        var active = marciaState.filters.status.indexOf(s.key) >= 0;
        return '<button class="impi-filter-chip' + (active ? ' active' : '') + '" onclick="toggleFiltroMARCia(\'status\',\'' +
            DOMPurify.sanitize(s.key) + '\')">' + DOMPurify.sanitize(s.key) + ' (' + s.docCount + ')</button>';
    }).join('');

    // Clases Niza
    var classContainer = document.getElementById('marcia-filter-classes');
    var classAgg = marciaState.aggregates.NICE_CLASSES || [];
    // Mostrar top 10
    classContainer.innerHTML = classAgg.slice(0, 10).map(function(c) {
        var active = marciaState.filters.niceClass.indexOf(c.key) >= 0;
        return '<button class="impi-filter-chip' + (active ? ' active' : '') + '" onclick="toggleFiltroMARCia(\'niceClass\',\'' +
            DOMPurify.sanitize(c.key) + '\')">' + 'Clase ' + DOMPurify.sanitize(c.key) + ' (' + c.docCount + ')</button>';
    }).join('');
}

function toggleFiltroMARCia(tipo, valor) {
    var arr = marciaState.filters[tipo];
    var idx = arr.indexOf(valor);
    if (idx >= 0) {
        arr.splice(idx, 1);
    } else {
        arr.push(valor);
    }
    marciaState.pageNumber = 0;
    obtenerResultadosMARCia();
}

function renderizarPaginacionMARCia() {
    var paginationEl = document.getElementById('marcia-pagination');
    var totalPages = Math.ceil(marciaState.totalResults / marciaState.pageSize);

    if (totalPages <= 1) {
        paginationEl.style.display = 'none';
        return;
    }

    paginationEl.style.display = 'flex';
    document.getElementById('marcia-page-info').textContent =
        'Página ' + (marciaState.pageNumber + 1) + ' de ' + totalPages +
        ' (' + marciaState.totalResults + ' resultados)';
    document.getElementById('marcia-prev').disabled = marciaState.pageNumber === 0;
    document.getElementById('marcia-next').disabled = marciaState.pageNumber >= totalPages - 1;
}

function marciaPaginaAnterior() {
    if (marciaState.pageNumber > 0) {
        marciaState.pageNumber--;
        obtenerResultadosMARCia();
    }
}

function marciaPaginaSiguiente() {
    var totalPages = Math.ceil(marciaState.totalResults / marciaState.pageSize);
    if (marciaState.pageNumber < totalPages - 1) {
        marciaState.pageNumber++;
        obtenerResultadosMARCia();
    }
}

// ==================== MARCia: DETALLE ====================

async function verDetalleMARCia(markId) {
    if (!markId || !marciaState.csrfToken) {
        // Abrir en MARCia directamente
        window.open(MARCIA_BASE + '/marcas/search/view/' + encodeURIComponent(markId), '_blank');
        return;
    }

    var loading = document.getElementById('impi-loading');
    if (loading) loading.style.display = 'flex';

    try {
        var resp = await fetch(MARCIA_BASE + '/marcas/search/internal/view/' + encodeURIComponent(markId), {
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'X-XSRF-TOKEN': marciaState.csrfToken
            }
        });

        if (!resp.ok) throw new Error('Error: ' + resp.status);
        var data = await resp.json();

        renderizarDetalleMARCia(data);

    } catch (e) {
        console.error('Error al obtener detalle:', e);
        window.open(MARCIA_BASE + '/marcas/search/view/' + encodeURIComponent(markId), '_blank');
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderizarDetalleMARCia(data) {
    var section = document.getElementById('marcia-detail-section');
    var content = document.getElementById('marcia-detail-content');
    var resultsSection = document.getElementById('marcia-results-section');

    var d = data.details || {};
    var gi = d.generalInformation || {};
    var tm = d.trademark || {};
    var oi = d.ownerInformation || {};
    var ps = d.productsAndServices || [];

    var imgUrl = tm.image || (data.result && data.result.images) || '';
    var imgHtml = imgUrl
        ? '<img src="' + DOMPurify.sanitize(imgUrl) + '" class="impi-detail-image" onerror="this.style.display=\'none\'">'
        : '';

    var ownersHtml = '';
    if (oi.owners && oi.owners.length > 0) {
        ownersHtml = oi.owners.map(function(o) {
            return '<div class="impi-detail-owner">' +
                '<strong>' + DOMPurify.sanitize(o.name || o) + '</strong>' +
                (o.address ? '<br><small>' + DOMPurify.sanitize(o.address) + '</small>' : '') +
            '</div>';
        }).join('');
    }

    var productsHtml = '';
    if (ps.length > 0) {
        productsHtml = '<div class="impi-detail-section"><h4>Productos y Servicios</h4>' +
            ps.map(function(p) {
                return '<div class="impi-detail-product">' +
                    '<strong>Clase ' + DOMPurify.sanitize(String(p.niceClass || p.classNumber || '')) + ':</strong> ' +
                    DOMPurify.sanitize(p.description || p.goodsServices || '') +
                '</div>';
            }).join('') +
        '</div>';
    }

    var viennaCodes = (tm.viennaCodes || []).map(function(v) { return DOMPurify.sanitize(String(v)); }).join(', ');

    content.innerHTML =
        '<div class="impi-detail-grid">' +
            '<div class="impi-detail-left">' + imgHtml + '</div>' +
            '<div class="impi-detail-right">' +
                '<h2>' + DOMPurify.sanitize(gi.title || 'Sin denominación') + '</h2>' +
                '<div class="impi-detail-fields">' +
                    '<div class="impi-detail-field"><label>Tipo de solicitud</label><span>' + DOMPurify.sanitize(gi.appType || '') + '</span></div>' +
                    '<div class="impi-detail-field"><label>No. Expediente</label><span>' + DOMPurify.sanitize(gi.applicationNumber || '') + '</span></div>' +
                    '<div class="impi-detail-field"><label>No. Registro</label><span>' + DOMPurify.sanitize(gi.registrationNumber || '') + '</span></div>' +
                    '<div class="impi-detail-field"><label>Fecha de presentación</label><span>' + DOMPurify.sanitize(gi.applicationDate || '') + '</span></div>' +
                    '<div class="impi-detail-field"><label>Fecha de registro</label><span>' + DOMPurify.sanitize(gi.registrationDate || '') + '</span></div>' +
                    '<div class="impi-detail-field"><label>Fecha de vencimiento</label><span>' + DOMPurify.sanitize(gi.expiryDate || '') + '</span></div>' +
                    (viennaCodes ? '<div class="impi-detail-field"><label>Códigos de Viena</label><span>' + viennaCodes + '</span></div>' : '') +
                '</div>' +
            '</div>' +
        '</div>' +
        (ownersHtml ? '<div class="impi-detail-section"><h4>Titulares</h4>' + ownersHtml + '</div>' : '') +
        productsHtml +
        (data.historyData && data.historyData.historyRecords && data.historyData.historyRecords.length > 0
            ? '<div class="impi-detail-section"><h4>Historial</h4>' +
                '<div class="impi-history-list">' +
                data.historyData.historyRecords.map(function(h) {
                    return '<div class="impi-history-item">' +
                        '<span class="impi-history-date">' + DOMPurify.sanitize(h.date || '') + '</span>' +
                        '<span>' + DOMPurify.sanitize(h.description || h.status || '') + '</span>' +
                    '</div>';
                }).join('') +
              '</div></div>'
            : '');

    resultsSection.style.display = 'none';
    section.style.display = '';
}

function cerrarDetalleMARCia() {
    document.getElementById('marcia-detail-section').style.display = 'none';
    document.getElementById('marcia-results-section').style.display = '';
}

// ==================== MARCia: LIMPIAR / EXPORTAR ====================

function limpiarFormularioMARCia() {
    document.getElementById('marcia-query').value = '';
    document.getElementById('marcia-adv-title').value = '';
    document.getElementById('marcia-adv-title-option').value = 'similar';
    document.getElementById('marcia-adv-owner').value = '';
    document.getElementById('marcia-adv-agent').value = '';
    document.getElementById('marcia-adv-number').value = '';
    document.getElementById('marcia-adv-number-type').value = 'APPLICATION';
    document.getElementById('marcia-adv-class').value = '';
    document.getElementById('marcia-adv-status').value = '';
    document.getElementById('marcia-adv-apptype').value = '';
    document.getElementById('marcia-adv-goods').value = '';
    document.getElementById('marcia-adv-date-from').value = '';
    document.getElementById('marcia-adv-date-to').value = '';
    document.getElementById('marcia-adv-date-type').value = 'APPLICATION';

    document.getElementById('marcia-results-section').style.display = 'none';
    document.getElementById('marcia-detail-section').style.display = 'none';

    marciaState.results = [];
    marciaState.searchId = null;
    marciaState.totalResults = 0;
    marciaState.pageNumber = 0;
    marciaState.filters = { status: [], niceClass: [], viennaCode: [] };
}

function abrirMARCiaExterno(query) {
    var q = query || (document.getElementById('marcia-query').value || '').trim();
    if (q) {
        // MARCia no soporta parámetros de URL para búsqueda directa,
        // pero podemos abrir la página de búsqueda rápida
        window.open(MARCIA_BASE + '/marcas/search/quick', '_blank');
        mostrarNotificacion('MARCia abierto. Busca: "' + q + '"', 'info');
    } else {
        window.open(MARCIA_BASE + '/marcas/search/quick', '_blank');
    }
}

function exportarResultadosMARCia() {
    if (marciaState.results.length === 0) return;

    var csv = 'Denominación,Expediente,Registro,Estatus,Tipo,Titular,Clases,Fecha Presentación\n';
    marciaState.results.forEach(function(r) {
        var owners = (r.owners || []).join('; ');
        var classes = (r.classes || []).join('; ');
        var appDate = r.dates && r.dates.application ? r.dates.application : '';
        csv += '"' + (r.title || '').replace(/"/g, '""') + '",' +
            '"' + (r.applicationNumber || '') + '",' +
            '"' + (r.registrationNumber || '') + '",' +
            '"' + (r.status || '') + '",' +
            '"' + (r.appType || '') + '",' +
            '"' + owners.replace(/"/g, '""') + '",' +
            '"' + classes + '",' +
            '"' + appDate + '"\n';
    });

    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'marcas_impi_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    mostrarNotificacion('CSV exportado con ' + marciaState.results.length + ' resultados', 'success');
}

// ==================== SIGA: BÚSQUEDA ====================

function buscarSIGA() {
    var query = (document.getElementById('siga-query').value || '').trim();
    if (!query) {
        mostrarNotificacion('Ingresa un término de búsqueda', 'warning');
        return;
    }

    var area = document.getElementById('siga-area').value;

    // SIGA requiere reCAPTCHA v3, no podemos hacer la llamada directamente.
    // Abrimos SIGA en nueva pestaña. El usuario verá los resultados ahí.
    // Guardamos los parámetros en localStorage para que si el usuario tiene
    // la extensión, esta pueda pre-llenar la búsqueda.
    try {
        localStorage.setItem('siga_pendingSearch', JSON.stringify({
            query: query,
            area: area,
            fechaDesde: document.getElementById('siga-fecha-desde').value || '',
            fechaHasta: document.getElementById('siga-fecha-hasta').value || ''
        }));
    } catch (e) { /* localStorage puede fallar */ }

    // Abrir SIGA - la búsqueda se hace en el portal
    window.open(SIGA_BASE + '/', '_blank');

    mostrarNotificacion('SIGA abierto en nueva pestaña. Busca: "' + query + '" en ' +
        (area === '1' ? 'Patentes' : area === '2' ? 'Marcas' : 'Protección PI'), 'info');
}

function limpiarFormularioSIGA() {
    document.getElementById('siga-query').value = '';
    document.getElementById('siga-area').value = '2';
    document.getElementById('siga-fecha-desde').value = '';
    document.getElementById('siga-fecha-hasta').value = '';
    document.getElementById('siga-results-section').style.display = 'none';
}

// ==================== ENTER KEY HANDLERS ====================

document.addEventListener('DOMContentLoaded', function() {
    var marciaInput = document.getElementById('marcia-query');
    if (marciaInput) {
        marciaInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                buscarMARCia();
            }
        });
    }

    var sigaInput = document.getElementById('siga-query');
    if (sigaInput) {
        sigaInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                buscarSIGA();
            }
        });
    }
});
