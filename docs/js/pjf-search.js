// ==================== BÚSQUEDA PJF FEDERAL ====================
// Búsqueda de expedientes del PJF usando catálogos estáticos (JSON).
// Construye la URL de vercaptura.aspx del portal DGEJ y la abre en ventana emergente.
// NO requiere proxy ni conexiones externas en tiempo de ejecución.

let pjfCircuitos = [];
let pjfOrganismos = [];
let pjfTiposAsunto = {};
let pjfDatosCargados = false;

const PJF_VERCAPTURA_URL = 'https://www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx';

// ==================== CATEGORÍA DE ÓRGANO ====================

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
        const [resC, resO, resT] = await Promise.all([
            fetch('data/circuitos.json'),
            fetch('data/organismos.json'),
            fetch('data/tipos_asunto.json')
        ]);

        if (!resC.ok || !resO.ok || !resT.ok) throw new Error('Error cargando catálogos');

        pjfCircuitos = await resC.json();
        pjfOrganismos = await resO.json();
        pjfTiposAsunto = await resT.json();
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
    document.getElementById('pjf-tipo-asunto-manual').style.display = 'none';
    document.getElementById('pjf-tipo-asunto-manual-input').value = '';
    ocultarTipoProcedimiento();

    if (!numCircuito) return;

    const organos = pjfOrganismos
        .filter(function(o) { return o.circuito_id === numCircuito; })
        .sort(function(a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });

    organos.forEach(function(o) {
        var opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.nombre;
        selectOrg.appendChild(opt);
    });

    selectOrg.disabled = false;
    document.getElementById('pjf-org-count').textContent = organos.length + ' organismos';
}

function onPjfOrganoChange() {
    var orgId = document.getElementById('pjf-organismo').value;
    var selectTipo = document.getElementById('pjf-tipo-asunto');
    var manualDiv = document.getElementById('pjf-tipo-asunto-manual');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');

    selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
    selectTipo.disabled = true;
    manualDiv.style.display = 'none';
    manualInput.value = '';
    ocultarTipoProcedimiento();

    if (!orgId) return;

    var organo = pjfOrganismos.find(function(o) { return String(o.id) === String(orgId); });
    if (!organo) return;

    var categoria = detectarCategoriaOrgano(organo.nombre);
    var catData = pjfTiposAsunto.por_categoria ? pjfTiposAsunto.por_categoria[categoria] : null;

    if (catData && catData.tipos && catData.tipos.length > 0) {
        catData.tipos.forEach(function(t) {
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
        // Sin catálogo para esta categoría → solo ID manual
        selectTipo.innerHTML = '<option value="">Sin catálogo para este tipo de órgano</option>';
        manualDiv.style.display = 'block';
    }

    // Mostrar tipo procedimiento para tribunales laborales
    if (categoria === 'tribunal_laboral') {
        mostrarTipoProcedimiento();
    }
}

function onPjfTipoAsuntoChange() {
    var select = document.getElementById('pjf-tipo-asunto');
    var manualDiv = document.getElementById('pjf-tipo-asunto-manual');
    var manualInput = document.getElementById('pjf-tipo-asunto-manual-input');

    if (select.value === '__manual__') {
        manualDiv.style.display = 'block';
        manualInput.focus();
    } else {
        manualDiv.style.display = 'none';
        manualInput.value = '';
    }
}

// ==================== TIPO PROCEDIMIENTO (LABORAL) ====================

function mostrarTipoProcedimiento() {
    var div = document.getElementById('pjf-tipo-procedimiento-group');
    if (!div) return;
    div.style.display = 'block';

    var select = document.getElementById('pjf-tipo-procedimiento');
    if (!select || select.options.length > 1) return;

    var tipos = pjfTiposAsunto.tipos_procedimiento || [];
    tipos.forEach(function(t) {
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
        tipoAsunto = manualInput.value.trim();
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
    document.getElementById('pjf-tipo-asunto-manual').style.display = 'none';
    document.getElementById('pjf-tipo-asunto-manual-input').value = '';
    ocultarTipoProcedimiento();
}
