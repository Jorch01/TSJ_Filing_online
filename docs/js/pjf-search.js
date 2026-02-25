// ==================== BÚSQUEDA PJF FEDERAL ====================
// Búsqueda de expedientes del PJF usando catálogos estáticos (JSON).
// Construye la URL de vercaptura.aspx del portal DGEJ y la abre en ventana emergente.
// NO requiere proxy ni conexiones externas en tiempo de ejecución.

let pjfCircuitos = [];
let pjfOrganismos = [];
let pjfTiposOrgano = {};   // TipoOrganismoId → { nombre, tiposAsunto[] }
let pjfTiposAsunto = {};   // backward-compat: {por_categoria, tipos_procedimiento}
let pjfDatosCargados = false;

const PJF_VERCAPTURA_URL = 'https://www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx';

// ==================== CATEGORÍA DE ÓRGANO (legado, aún usada en algunos lugares) ====================

function detectarCategoriaOrgano(nombre) {
    const n = nombre.toLowerCase();
    if (n.includes('tribunal laboral')) return 'tribunal_laboral';
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

    const spinner = document.getElementById('pjf-loading');
    if (spinner) spinner.style.display = 'flex';

    try {
        const res = await fetch('data/pjf_catalogos_completos.json');
        if (!res.ok) throw new Error('Error cargando catálogo completo PJF');

        const data = await res.json();

        // ── Organos (1 195) ─────────────────────────────────────────
        // Los organos tienen: id, nombre, tipoOrganismoId, tipoOrganismo,
        // circuitoId, circuito, estadoId, estado, ciudad
        pjfOrganismos = (data.organos || []).map(o => ({
            id: o.id,
            nombre: o.nombre,
            circuito_id: o.circuitoId,   // compat con código legado
            circuito: o.circuito,
            tipoOrganismoId: o.tipoOrganismoId,
            tipoOrganismo: o.tipoOrganismo,
            ciudad: o.ciudad || '',
            estado: o.estado || ''
        }));

        // ── Circuitos (derivados de organos) ────────────────────────
        const circuitoMap = {};
        pjfOrganismos.forEach(o => {
            if (o.circuito_id && !circuitoMap[o.circuito_id]) {
                circuitoMap[o.circuito_id] = o.circuito;
            }
        });
        pjfCircuitos = Object.entries(circuitoMap)
            .map(([id, nombre]) => ({ numero_circuito: parseInt(id), nombre }))
            .sort((a, b) => a.numero_circuito - b.numero_circuito);

        // ── Tipos de Organo → Tipos de Asunto ────────────────────────
        // tiposOrgano: [{ TipoOrganismoId, TipoOrganismo, tiposAsunto[] }]
        pjfTiposOrgano = {};
        (data.tiposOrgano || []).forEach(to => {
            pjfTiposOrgano[to.TipoOrganismoId] = {
                nombre: to.TipoOrganismo,
                tiposAsunto: to.tiposAsunto || []
            };
        });

        // ── backward-compat: tipos_procedimiento ─────────────────────
        // Extraer tipos de procedimiento de cualquier asunto que los tenga
        const tiposProcedimiento = [];
        (data.tiposAsunto || []).forEach(ta => {
            if (Array.isArray(ta.tiposProcedimiento) && ta.tiposProcedimiento.length > 0) {
                ta.tiposProcedimiento.forEach(tp => {
                    if (tp.id && !tiposProcedimiento.find(x => x.id === tp.id)) {
                        tiposProcedimiento.push(tp);
                    }
                });
            }
        });

        // Tipos de procedimiento laborales conocidos (IDs 111-120)
        const labProcedimientos = [
            { id: 111, nombre: 'Procedimiento ordinario' },
            { id: 112, nombre: 'Procedimiento especial individual' },
            { id: 113, nombre: 'Procedimiento especial colectivo' },
            { id: 114, nombre: 'Conflictos Individuales de Seguridad Social' },
            { id: 115, nombre: 'Conflictos Colectivos de Naturaleza Económica' },
            { id: 116, nombre: 'Procedimiento de Huelga' },
            { id: 117, nombre: 'Procedimiento de Ejecución' },
            { id: 120, nombre: 'Procedimientos Paraprocesales o Voluntarios' }
        ];
        const finalProcedimientos = labProcedimientos.concat(
            tiposProcedimiento.filter(tp => !labProcedimientos.find(l => l.id === tp.id))
        );

        pjfTiposAsunto = {
            tipos_procedimiento: [{ id: 0, nombre: 'No aplica' }, ...finalProcedimientos]
        };

        pjfDatosCargados = true;
        poblarSelectCircuitos();

    } catch (error) {
        console.error('Error cargando catálogos PJF:', error);
        if (typeof mostrarToast === 'function') {
            mostrarToast('Error al cargar catálogos del PJF.', 'error');
        }
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}

// ==================== DROPDOWNS ====================

function poblarSelectCircuitos() {
    const select = document.getElementById('pjf-circuito');
    if (!select) return;
    select.innerHTML = '<option value="">-- Selecciona un circuito --</option>';
    pjfCircuitos.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.numero_circuito;
        opt.textContent = c.numero_circuito + '. ' + c.nombre;
        select.appendChild(opt);
    });
}

function onPjfCircuitoChange() {
    const numCircuito = parseInt(document.getElementById('pjf-circuito').value);
    const selectOrg = document.getElementById('pjf-organismo');
    const selectTipo = document.getElementById('pjf-tipo-asunto');

    // Reset downstream
    selectOrg.innerHTML = '<option value="">-- Selecciona un organismo --</option>';
    selectOrg.disabled = true;
    selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
    selectTipo.disabled = true;
    document.getElementById('pjf-org-count').textContent = '';

    const manualDiv = document.getElementById('pjf-tipo-asunto-manual');
    if (manualDiv) manualDiv.style.display = 'none';
    const manualInput = document.getElementById('pjf-tipo-asunto-manual-input');
    if (manualInput) manualInput.value = '';

    ocultarTipoProcedimiento();

    // Clear organo search
    const orgSearch = document.getElementById('pjf-organismo-search');
    if (orgSearch) orgSearch.value = '';

    if (!numCircuito) return;

    const organos = pjfOrganismos
        .filter(function(o) { return o.circuito_id === numCircuito; })
        .sort(function(a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });

    organos.forEach(function(o) {
        var opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.nombre;
        opt.dataset.nombre = o.nombre.toLowerCase();
        selectOrg.appendChild(opt);
    });

    selectOrg.disabled = false;
    document.getElementById('pjf-org-count').textContent = organos.length + ' organismos';

    // Show organ search input if there are many organs
    var orgSearch = document.getElementById('pjf-organismo-search');
    if (orgSearch) orgSearch.style.display = organos.length > 5 ? 'block' : 'none';
}

function onPjfOrganoChange() {
    var orgId = document.getElementById('pjf-organismo').value;
    var selectTipo = document.getElementById('pjf-tipo-asunto');
    var manualDiv = document.getElementById('pjf-tipo-asunto-manual');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');

    selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
    selectTipo.disabled = true;
    if (manualDiv) manualDiv.style.display = 'none';
    if (manualInput) manualInput.value = '';
    ocultarTipoProcedimiento();

    if (!orgId) return;

    var organo = pjfOrganismos.find(function(o) { return String(o.id) === String(orgId); });
    if (!organo) return;

    // Look up tipos de asunto by tipoOrganismoId (new full catalog)
    var tipoOrgData = pjfTiposOrgano[organo.tipoOrganismoId];
    var tipos = tipoOrgData ? tipoOrgData.tiposAsunto : [];

    if (tipos.length > 0) {
        tipos.forEach(function(t) {
            var opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.nombre;
            selectTipo.appendChild(opt);
        });
        // Opción para ID manual al final
        var optManual = document.createElement('option');
        optManual.value = '__manual__';
        optManual.textContent = '-- Otro (ingresar ID manual) --';
        selectTipo.appendChild(optManual);
        selectTipo.disabled = false;
    } else {
        // Sin catálogo para este tipo de órgano → solo ID manual
        selectTipo.innerHTML = '<option value="">Sin tipos de asunto para este órgano</option>';
        if (manualDiv) manualDiv.style.display = 'block';
    }

    // Mostrar tipo procedimiento para tribunales laborales
    if (organo.tipoOrganismo && organo.tipoOrganismo.toLowerCase().includes('laboral')) {
        mostrarTipoProcedimiento();
    }
}

function onPjfTipoAsuntoChange() {
    var select = document.getElementById('pjf-tipo-asunto');
    var manualDiv = document.getElementById('pjf-tipo-asunto-manual');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');

    if (select.value === '__manual__') {
        if (manualDiv) manualDiv.style.display = 'block';
        if (manualInput) manualInput.focus();
    } else {
        if (manualDiv) manualDiv.style.display = 'none';
        if (manualInput) manualInput.value = '';
    }
}

// ==================== BÚSQUEDA DE TEXTO EN CATÁLOGO DE ÓRGANOS ====================

/**
 * Filtra las opciones del select de organismos según el texto ingresado.
 * @param {string} searchInputId  ID del input de búsqueda
 * @param {string} selectId       ID del <select> a filtrar
 * @param {string} countId        ID opcional del elemento con el conteo
 */
function filtrarOrganosSelect(searchInputId, selectId, countId) {
    var input = document.getElementById(searchInputId);
    var select = document.getElementById(selectId);
    if (!input || !select) return;

    var query = input.value.toLowerCase().trim();
    var visible = 0;

    Array.from(select.options).forEach(function(opt) {
        if (opt.value === '' || opt.value === '__manual__') {
            // Siempre mostrar la opción vacía y manual
            opt.style.display = '';
            return;
        }
        var texto = (opt.textContent || '').toLowerCase();
        var mostrar = !query || texto.includes(query);
        opt.style.display = mostrar ? '' : 'none';
        if (mostrar) visible++;
    });

    if (countId) {
        var countEl = document.getElementById(countId);
        if (countEl) {
            var total = select.options.length - 2; // exclude blank + manual
            countEl.textContent = query ? (visible + ' de ' + total + ' organismos') : (total + ' organismos');
        }
    }
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
        if (t.id === 0) return; // "No aplica" ya está
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

// ==================== BÚSQUEDA ====================

function ejecutarBusquedaPJF() {
    var orgId = document.getElementById('pjf-organismo').value;
    var selectTipo = document.getElementById('pjf-tipo-asunto');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');
    var expediente = document.getElementById('pjf-num-expediente').value.trim();

    // Determinar tipo de asunto
    var tipoAsunto = selectTipo.value;
    if (tipoAsunto === '__manual__' || !tipoAsunto) {
        tipoAsunto = manualInput ? manualInput.value.trim() : '';
    }

    // Validar campos
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

    // Tipo procedimiento (para laborales)
    var tipoProcGroup = document.getElementById('pjf-tipo-procedimiento-group');
    var tipoProcedimiento = '0';
    if (tipoProcGroup && tipoProcGroup.style.display !== 'none') {
        var tipoProcSelect = document.getElementById('pjf-tipo-procedimiento');
        if (tipoProcSelect) tipoProcedimiento = tipoProcSelect.value || '0';
    }

    // Construir URL
    var url = PJF_VERCAPTURA_URL +
        '?tipoasunto=' + encodeURIComponent(tipoAsunto) +
        '&organismo=' + encodeURIComponent(orgId) +
        '&expediente=' + encodeURIComponent(expediente) +
        '&tipoprocedimiento=' + encodeURIComponent(tipoProcedimiento);

    // Abrir en ventana emergente
    window.open(url, 'pjf_expediente', 'width=1024,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no');
}

// ==================== LIMPIAR ====================

function limpiarFormularioPJF() {
    document.getElementById('pjf-circuito').value = '';

    var selectOrg = document.getElementById('pjf-organismo');
    selectOrg.innerHTML = '<option value="">-- Selecciona un organismo --</option>';
    selectOrg.disabled = true;

    var selectTipo = document.getElementById('pjf-tipo-asunto');
    selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
    selectTipo.disabled = true;

    document.getElementById('pjf-num-expediente').value = '';
    document.getElementById('pjf-org-count').textContent = '';

    var manualDiv = document.getElementById('pjf-tipo-asunto-manual');
    if (manualDiv) manualDiv.style.display = 'none';
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');
    if (manualInput) manualInput.value = '';

    var orgSearch = document.getElementById('pjf-organismo-search');
    if (orgSearch) orgSearch.value = '';

    ocultarTipoProcedimiento();
}
