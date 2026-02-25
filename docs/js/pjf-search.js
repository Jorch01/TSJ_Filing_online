// ==================== BÚSQUEDA PJF FEDERAL ====================
// Búsqueda de expedientes del PJF usando catálogos estáticos (JSON).
// Construye la URL de vercaptura.aspx del portal DGEJ y la abre en ventana emergente.
// NO requiere proxy ni conexiones externas en tiempo de ejecución.

let pjfCircuitos = [];
let pjfOrganismos = [];
let pjfTiposOrgano = {};   // TipoOrganismoId → { nombre, tiposAsunto[] } (UNION de todas las entradas)
let pjfTiposAsunto = {};   // compat: { tipos_procedimiento }
let pjfDatosCargados = false;

const PJF_VERCAPTURA_URL = 'https://www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx';

// ==================== CATEGORÍA DE ÓRGANO (legado) ====================

function detectarCategoriaOrgano(nombre) {
    var n = (nombre || '').toLowerCase();
    if (n.includes('tribunal laboral') || n.includes('tribunales laborales')) return 'tribunal_laboral';
    if (n.includes('centro de justicia penal')) return 'centro_justicia_penal';
    if (n.includes('tribunal colegiado')) return 'tribunal_colegiado';
    if (n.includes('tribunal unitario')) return 'tribunal_unitario';
    if (n.includes('pleno regional') || n.includes('pleno de circuito')) return 'pleno_regional';
    if (n.includes('juzgado')) return 'juzgado_distrito';
    return 'otro';
}

// ==================== INICIALIZACIÓN ====================

async function cargarCatalogosPJF() {
    if (pjfDatosCargados) return;

    var spinner = document.getElementById('pjf-loading');
    if (spinner) spinner.style.display = 'flex';

    try {
        var res = await fetch('data/pjf_catalogos_completos.json');
        if (!res.ok) throw new Error('HTTP ' + res.status + ' al cargar catálogo PJF');

        var data = await res.json();

        // ── Organos (1 195) ───────────────────────────────────────────────
        pjfOrganismos = (data.organos || []).map(function(o) {
            return {
                id: o.id,
                nombre: o.nombre,
                circuito_id: Number(o.circuitoId),   // compat con código legado (siempre Number)
                circuito: o.circuito || '',
                tipoOrganismoId: o.tipoOrganismoId,
                tipoOrganismo: o.tipoOrganismo || '',
                ciudad: o.ciudad || '',
                estado: o.estado || ''
            };
        });

        // ── Circuitos (derivados de organos, ordenados por id) ────────────
        var circuitoMap = {};
        pjfOrganismos.forEach(function(o) {
            if (o.circuito_id && !circuitoMap[o.circuito_id]) {
                circuitoMap[o.circuito_id] = o.circuito;
            }
        });
        pjfCircuitos = Object.keys(circuitoMap)
            .map(function(id) { return { numero_circuito: Number(id), nombre: circuitoMap[id] }; })
            .sort(function(a, b) { return a.numero_circuito - b.numero_circuito; });

        // ── Tipos de Organo → Tipos de Asunto (UNION por TipoOrganismoId) ──
        // El JSON tiene 82 entradas para tiposOrgano con IDs repetidos.
        // Hacemos la unión (merge) de tiposAsunto para cada TipoOrganismoId.
        pjfTiposOrgano = {};
        (data.tiposOrgano || []).forEach(function(to) {
            var tid = to.TipoOrganismoId;
            if (!pjfTiposOrgano[tid]) {
                pjfTiposOrgano[tid] = { nombre: to.TipoOrganismo, tiposAsunto: {}, nombresById: {} };
            }
            // Merge tiposAsunto por ID (unión)
            (to.tiposAsunto || []).forEach(function(ta) {
                if (!pjfTiposOrgano[tid].tiposAsunto[ta.id]) {
                    pjfTiposOrgano[tid].tiposAsunto[ta.id] = ta.nombre;
                    pjfTiposOrgano[tid].nombresById[ta.id] = ta.nombre;
                }
            });
        });
        // Convertir a array ordenado por id
        Object.keys(pjfTiposOrgano).forEach(function(tid) {
            var map = pjfTiposOrgano[tid].tiposAsunto;
            pjfTiposOrgano[tid].tiposAsuntoArr = Object.keys(map)
                .map(function(id) { return { id: Number(id), nombre: map[id] }; })
                .sort(function(a, b) { return a.id - b.id; });
        });

        // ── Tipos de procedimiento (laborales) ────────────────────────────
        pjfTiposAsunto = {
            tipos_procedimiento: [
                { id: 0,   nombre: 'No aplica' },
                { id: 111, nombre: 'Procedimiento ordinario' },
                { id: 112, nombre: 'Procedimiento especial individual' },
                { id: 113, nombre: 'Procedimiento especial colectivo' },
                { id: 114, nombre: 'Conflictos Individuales de Seguridad Social' },
                { id: 115, nombre: 'Conflictos Colectivos de Naturaleza Económica' },
                { id: 116, nombre: 'Procedimiento de Huelga' },
                { id: 117, nombre: 'Procedimiento de Ejecución' },
                { id: 120, nombre: 'Procedimientos Paraprocesales o Voluntarios' }
            ]
        };

        pjfDatosCargados = true;
        poblarSelectCircuitos();

        console.log('[PJF] Catálogos cargados:', pjfOrganismos.length, 'organos,', pjfCircuitos.length, 'circuitos,', Object.keys(pjfTiposOrgano).length, 'tipos de órgano');

    } catch (err) {
        console.error('[PJF] Error cargando catálogos:', err);
        if (typeof mostrarToast === 'function') {
            mostrarToast('Error al cargar catálogos del PJF: ' + err.message, 'error');
        }
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}

// ==================== DROPDOWNS ====================

function poblarSelectCircuitos() {
    var select = document.getElementById('pjf-circuito');
    if (!select) return;
    select.innerHTML = '<option value="">-- Selecciona un circuito --</option>';
    pjfCircuitos.forEach(function(c) {
        var opt = document.createElement('option');
        opt.value = c.numero_circuito;
        opt.textContent = c.numero_circuito + '. ' + c.nombre;
        select.appendChild(opt);
    });
}

function onPjfCircuitoChange() {
    var numCircuito = parseInt(document.getElementById('pjf-circuito').value, 10);
    var selectOrg  = document.getElementById('pjf-organismo');
    var selectTipo = document.getElementById('pjf-tipo-asunto');

    // Reset downstream
    selectOrg.innerHTML  = '<option value="">-- Selecciona un organismo --</option>';
    selectOrg.disabled   = true;
    selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
    selectTipo.disabled  = true;

    var orgCount = document.getElementById('pjf-org-count');
    if (orgCount) orgCount.textContent = '';

    var manualDiv   = document.getElementById('pjf-tipo-asunto-manual');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');
    if (manualDiv)   manualDiv.style.display = 'none';
    if (manualInput) manualInput.value = '';

    ocultarTipoProcedimiento();

    // Clear & hide organo search
    var orgSearch = document.getElementById('pjf-organismo-search');
    if (orgSearch) { orgSearch.value = ''; orgSearch.style.display = 'none'; }

    if (!numCircuito) return;

    var organos = pjfOrganismos
        .filter(function(o) { return o.circuito_id === numCircuito; })
        .sort(function(a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });

    organos.forEach(function(o) {
        var opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.nombre;
        selectOrg.appendChild(opt);
    });

    selectOrg.disabled = false;
    if (orgCount) orgCount.textContent = organos.length + ' organismos';

    // Show search input when there are many organs
    if (orgSearch) orgSearch.style.display = organos.length > 5 ? 'block' : 'none';
}

function onPjfOrganoChange() {
    var orgId      = document.getElementById('pjf-organismo').value;
    var selectTipo = document.getElementById('pjf-tipo-asunto');
    var manualDiv  = document.getElementById('pjf-tipo-asunto-manual');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');

    selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
    selectTipo.disabled  = true;
    if (manualDiv)   manualDiv.style.display = 'none';
    if (manualInput) manualInput.value = '';
    ocultarTipoProcedimiento();

    if (!orgId) return;

    var organo = pjfOrganismos.find(function(o) { return String(o.id) === String(orgId); });
    if (!organo) return;

    // Obtener tipos de asunto (UNION del TipoOrganismo correspondiente)
    var tipoOrgData = pjfTiposOrgano[organo.tipoOrganismoId];
    var tipos = (tipoOrgData && tipoOrgData.tiposAsuntoArr) ? tipoOrgData.tiposAsuntoArr : [];

    if (tipos.length > 0) {
        tipos.forEach(function(t) {
            var opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.nombre;
            selectTipo.appendChild(opt);
        });
        var optManual = document.createElement('option');
        optManual.value = '__manual__';
        optManual.textContent = '-- Otro (ingresar ID manual) --';
        selectTipo.appendChild(optManual);
        selectTipo.disabled = false;
    } else {
        // Sin catálogo conocido → mostrar entrada manual
        selectTipo.innerHTML = '<option value="">Sin tipos de asunto para este órgano</option>';
        if (manualDiv) manualDiv.style.display = 'block';
    }

    // Tipo de procedimiento solo para tribunales laborales
    if (organo.tipoOrganismo && organo.tipoOrganismo.toLowerCase().includes('laboral')) {
        mostrarTipoProcedimiento();
    }
}

function onPjfTipoAsuntoChange() {
    var select     = document.getElementById('pjf-tipo-asunto');
    var manualDiv  = document.getElementById('pjf-tipo-asunto-manual');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');

    if (select.value === '__manual__') {
        if (manualDiv)   manualDiv.style.display = 'block';
        if (manualInput) manualInput.focus();
    } else {
        if (manualDiv)   manualDiv.style.display = 'none';
        if (manualInput) manualInput.value = '';
    }
}

// ==================== BÚSQUEDA DE TEXTO EN CATÁLOGO DE ÓRGANOS ====================

/**
 * Filtra las opciones visibles de un <select> según el texto del input.
 * Úsalo con oninput en un campo de texto posicionado encima del select.
 */
function filtrarOrganosSelect(searchInputId, selectId, countId) {
    var input  = document.getElementById(searchInputId);
    var select = document.getElementById(selectId);
    if (!input || !select) return;

    var query   = input.value.toLowerCase().trim();
    var visible = 0;
    var total   = 0;

    Array.from(select.options).forEach(function(opt) {
        if (opt.value === '' || opt.value === '__manual__') {
            opt.style.display = '';
            return;
        }
        total++;
        var match = !query || opt.textContent.toLowerCase().includes(query);
        opt.style.display = match ? '' : 'none';
        if (match) visible++;
    });

    if (countId) {
        var countEl = document.getElementById(countId);
        if (countEl) countEl.textContent = query ? (visible + ' de ' + total + ' organismos') : (total + ' organismos');
    }
}

/**
 * Muestra el input de búsqueda de un catálogo cuando se hace clic en el select.
 * Lo llama onmousedown del <select>.
 */
function mostrarBuscadorOrganos(searchInputId, selectId) {
    var searchInput = document.getElementById(searchInputId);
    var select      = document.getElementById(selectId);
    if (!searchInput || !select || select.disabled) return;
    if (select.options.length > 3) {
        searchInput.style.display = 'block';
    }
}

/**
 * Filtra las opciones del selector de juzgados TSJ.
 */
function filtrarJuzgadosSelect(searchInputId, selectId) {
    var input  = document.getElementById(searchInputId);
    var select = document.getElementById(selectId);
    if (!input || !select) return;
    var query = input.value.toLowerCase().trim();
    Array.from(select.options).forEach(function(opt) {
        if (opt.value === '') { opt.style.display = ''; return; }
        opt.style.display = (!query || opt.textContent.toLowerCase().includes(query)) ? '' : 'none';
    });
}

// ==================== TIPO PROCEDIMIENTO (LABORAL) ====================

function mostrarTipoProcedimiento() {
    var div = document.getElementById('pjf-tipo-procedimiento-group');
    if (!div) return;
    div.style.display = 'block';

    var select = document.getElementById('pjf-tipo-procedimiento');
    if (!select || select.options.length > 1) return;

    var tipos = (pjfTiposAsunto && pjfTiposAsunto.tipos_procedimiento) ? pjfTiposAsunto.tipos_procedimiento : [];
    tipos.forEach(function(t) {
        if (t.id === 0) return; // "No aplica" ya está en el HTML
        var opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.nombre;
        select.appendChild(opt);
    });
}

function ocultarTipoProcedimiento() {
    var div = document.getElementById('pjf-tipo-procedimiento-group');
    if (div) div.style.display = 'none';
}

// ==================== CONSTRUIR URL PJF ====================

/**
 * Construye la URL de vercaptura.aspx con los parámetros dados.
 */
function construirURLPJF(orgId, tipoAsunto, expediente, tipoProcedimiento) {
    return PJF_VERCAPTURA_URL +
        '?tipoasunto='       + encodeURIComponent(tipoAsunto) +
        '&organismo='        + encodeURIComponent(orgId) +
        '&expediente='       + encodeURIComponent(expediente) +
        '&tipoprocedimiento='+ encodeURIComponent(tipoProcedimiento || 0);
}

// ==================== BÚSQUEDA DIRECTA ====================

function ejecutarBusquedaPJF() {
    var orgId       = document.getElementById('pjf-organismo').value;
    var selectTipo  = document.getElementById('pjf-tipo-asunto');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');
    var expediente  = document.getElementById('pjf-num-expediente').value.trim();

    var tipoAsunto = selectTipo.value;
    if (tipoAsunto === '__manual__' || !tipoAsunto) {
        tipoAsunto = manualInput ? manualInput.value.trim() : '';
    }

    if (!orgId) {
        if (typeof mostrarToast === 'function') mostrarToast('Selecciona un organismo.', 'warning');
        return;
    }
    if (!tipoAsunto) {
        if (typeof mostrarToast === 'function') mostrarToast('Selecciona o ingresa un tipo de asunto.', 'warning');
        return;
    }
    if (!expediente) {
        if (typeof mostrarToast === 'function') mostrarToast('Ingresa el número de expediente.', 'warning');
        return;
    }

    var tipoProcedimiento = 0;
    var tipoProcGroup = document.getElementById('pjf-tipo-procedimiento-group');
    if (tipoProcGroup && tipoProcGroup.style.display !== 'none') {
        var tipoProcSelect = document.getElementById('pjf-tipo-procedimiento');
        if (tipoProcSelect) tipoProcedimiento = tipoProcSelect.value || 0;
    }

    var url = construirURLPJF(orgId, tipoAsunto, expediente, tipoProcedimiento);
    window.open(url, 'pjf_expediente', 'width=1024,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no');
}

// ==================== LIMPIAR FORMULARIO ====================

function limpiarFormularioPJF() {
    var circuito = document.getElementById('pjf-circuito');
    if (circuito) circuito.value = '';

    var selectOrg = document.getElementById('pjf-organismo');
    if (selectOrg) { selectOrg.innerHTML = '<option value="">-- Selecciona un organismo --</option>'; selectOrg.disabled = true; }

    var selectTipo = document.getElementById('pjf-tipo-asunto');
    if (selectTipo) { selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>'; selectTipo.disabled = true; }

    var numExp = document.getElementById('pjf-num-expediente');
    if (numExp) numExp.value = '';

    var orgCount = document.getElementById('pjf-org-count');
    if (orgCount) orgCount.textContent = '';

    var manualDiv   = document.getElementById('pjf-tipo-asunto-manual');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');
    if (manualDiv)   manualDiv.style.display = 'none';
    if (manualInput) manualInput.value = '';

    var orgSearch = document.getElementById('pjf-organismo-search');
    if (orgSearch) { orgSearch.value = ''; orgSearch.style.display = 'none'; }

    ocultarTipoProcedimiento();
}
