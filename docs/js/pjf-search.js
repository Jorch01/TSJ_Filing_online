// ==================== BÚSQUEDA PJF FEDERAL ====================
// Sistema de búsqueda de expedientes del Poder Judicial de la Federación
// Utiliza catálogos de circuitos y organismos cargados desde JSON

let pjfCircuitos = [];
let pjfOrganismos = [];
let pjfDatosCargados = false;
let pjfCargando = false;

// URL base para consulta directa de expedientes SISE
const PJF_SISE_URL = 'https://www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx';

// Tipos de asunto con su ID del SISE
const PJF_TIPOS_ASUNTO = [
    { id: 8, nombre: 'Amparo Indirecto' },
    { id: 1, nombre: 'Amparo Directo' },
    { id: 2, nombre: 'Amparo en Revisión' },
    { id: 3, nombre: 'Queja' },
    { id: 4, nombre: 'Revisión Fiscal' },
    { id: 5, nombre: 'Conflicto Competencial' },
    { id: 6, nombre: 'Recurso de Reclamación' },
    { id: 14, nombre: 'Causa Penal' },
    { id: 10, nombre: 'Juicio Oral Mercantil' },
    { id: 13, nombre: 'Incidente' }
];

/**
 * Carga los catálogos JSON de circuitos y organismos
 */
async function cargarCatalogosPJF() {
    if (pjfDatosCargados || pjfCargando) return;
    pjfCargando = true;

    const spinner = document.getElementById('pjf-loading');
    if (spinner) spinner.style.display = 'flex';

    try {
        const [circuitosRes, organismosRes] = await Promise.all([
            fetch('data/circuitos.json'),
            fetch('data/organismos.json')
        ]);

        if (!circuitosRes.ok || !organismosRes.ok) {
            throw new Error('Error al cargar catálogos');
        }

        pjfCircuitos = await circuitosRes.json();
        pjfOrganismos = await organismosRes.json();
        pjfDatosCargados = true;

        poblarSelectCircuitos();
        poblarSelectTipoAsunto();

    } catch (error) {
        console.error('Error cargando catálogos PJF:', error);
        if (typeof mostrarToast === 'function') {
            mostrarToast('Error al cargar catálogos del PJF. Intenta recargar la página.', 'error');
        }
    } finally {
        pjfCargando = false;
        if (spinner) spinner.style.display = 'none';
    }
}

/**
 * Pobla el dropdown de circuitos usando numero_circuito como value
 */
function poblarSelectCircuitos() {
    const select = document.getElementById('pjf-circuito');
    if (!select) return;

    select.innerHTML = '<option value="">-- Selecciona un circuito --</option>';

    pjfCircuitos.forEach(c => {
        const option = document.createElement('option');
        option.value = c.numero_circuito;
        option.dataset.idSise = c.id_sise;
        option.textContent = `${c.numero_circuito}. ${c.nombre}`;
        select.appendChild(option);
    });
}

/**
 * Pobla el dropdown de tipos de asunto
 */
function poblarSelectTipoAsunto() {
    const select = document.getElementById('pjf-tipo-asunto');
    if (!select) return;

    select.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';

    PJF_TIPOS_ASUNTO.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.nombre;
        select.appendChild(option);
    });
}

/**
 * Filtra organismos por circuito seleccionado (dropdown en cascada)
 * Usa numero_circuito que es lo que organismos.circuito_id realmente contiene
 */
function filtrarOrganismosPorCircuito() {
    const numCircuito = parseInt(document.getElementById('pjf-circuito').value);
    const selectOrg = document.getElementById('pjf-organismo');

    selectOrg.innerHTML = '<option value="">-- Selecciona un organismo --</option>';

    if (!numCircuito) {
        selectOrg.disabled = true;
        document.getElementById('pjf-org-count').textContent = '';
        return;
    }

    const organismosFiltrados = pjfOrganismos.filter(o => o.circuito_id === numCircuito);

    organismosFiltrados.forEach(o => {
        const option = document.createElement('option');
        option.value = o.id;
        option.textContent = o.nombre;
        selectOrg.appendChild(option);
    });

    selectOrg.disabled = false;

    const contador = document.getElementById('pjf-org-count');
    if (contador) {
        contador.textContent = `${organismosFiltrados.length} organismos disponibles`;
    }
}

/**
 * Construye la URL directa del SISE para ver un expediente
 * Formato: https://www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx
 *          ?tipoasunto={id}&organismo={org_id}&expediente={num%2Fanio}&tipoprocedimiento=0
 */
function construirUrlSISE(tipoAsuntoId, organismoId, expediente) {
    const params = new URLSearchParams();
    params.set('tipoasunto', tipoAsuntoId || 0);
    params.set('organismo', organismoId || 0);
    params.set('expediente', expediente);
    params.set('tipoprocedimiento', 0);
    return `${PJF_SISE_URL}?${params.toString()}`;
}

/**
 * Abre la URL del SISE en una ventana popup
 */
function abrirPopupPJF(url, titulo) {
    const w = 900;
    const h = 650;
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    window.open(url, titulo || 'PJF_Consulta', `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`);
}

/**
 * Ejecuta la búsqueda PJF: valida campos y abre popup con URL directa
 */
function ejecutarBusquedaPJF() {
    const numCircuito = document.getElementById('pjf-circuito').value;
    const organismoId = document.getElementById('pjf-organismo').value;
    const tipoAsuntoId = document.getElementById('pjf-tipo-asunto').value;
    const numExpediente = document.getElementById('pjf-num-expediente').value.trim();

    // Validaciones
    if (!organismoId) {
        if (typeof mostrarToast === 'function') {
            mostrarToast('Selecciona un organismo jurisdiccional.', 'warning');
        }
        return;
    }

    if (!tipoAsuntoId) {
        if (typeof mostrarToast === 'function') {
            mostrarToast('Selecciona un tipo de asunto.', 'warning');
        }
        return;
    }

    if (!numExpediente) {
        if (typeof mostrarToast === 'function') {
            mostrarToast('Ingresa el número de expediente (ej: 123/2024).', 'warning');
        }
        return;
    }

    // Obtener datos para mostrar en la tabla
    const circuito = pjfCircuitos.find(c => c.numero_circuito === parseInt(numCircuito));
    const organismo = pjfOrganismos.find(o => o.id === parseInt(organismoId));
    const tipoAsunto = PJF_TIPOS_ASUNTO.find(t => t.id === parseInt(tipoAsuntoId));

    // Construir URL directa y abrir popup
    const url = construirUrlSISE(tipoAsuntoId, organismoId, numExpediente);
    abrirPopupPJF(url, 'PJF_Expediente');

    // Mostrar resultado en tabla
    mostrarResultadosPJF({
        circuito,
        organismo,
        tipoAsunto,
        numExpediente,
        url
    });
}

/**
 * Muestra el resultado de búsqueda en la tabla
 */
function mostrarResultadosPJF(params) {
    const contenedor = document.getElementById('pjf-resultados');
    const card = document.getElementById('pjf-resultados-card');

    if (!contenedor || !card) return;

    card.style.display = 'block';

    const safeUrl = escapeAttrPJF(params.url);

    let html = '<div class="table-responsive"><table class="pjf-table">';
    html += `<thead><tr>
        <th>Expediente</th>
        <th>Órgano Jurisdiccional</th>
        <th>Tipo de Asunto</th>
        <th>Circuito</th>
        <th>Acciones</th>
    </tr></thead>`;
    html += '<tbody>';
    html += `<tr>
        <td><strong>${escapeTextPJF(params.numExpediente)}</strong></td>
        <td>${escapeTextPJF(params.organismo ? params.organismo.nombre : '-')}</td>
        <td>${escapeTextPJF(params.tipoAsunto ? params.tipoAsunto.nombre : '-')}</td>
        <td>${escapeTextPJF(params.circuito ? params.circuito.nombre : '-')}</td>
        <td>
            <button class="btn btn-sm btn-primary" onclick="abrirPopupPJF('${safeUrl}', 'PJF_Expediente')">
                Ver Expediente
            </button>
        </td>
    </tr>`;
    html += '</tbody></table></div>';

    contenedor.innerHTML = html;

    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Limpia el formulario de búsqueda PJF
 */
function limpiarFormularioPJF() {
    document.getElementById('pjf-circuito').value = '';
    document.getElementById('pjf-organismo').innerHTML = '<option value="">-- Selecciona un organismo --</option>';
    document.getElementById('pjf-organismo').disabled = true;
    document.getElementById('pjf-tipo-asunto').value = '';
    document.getElementById('pjf-num-expediente').value = '';

    const orgCount = document.getElementById('pjf-org-count');
    if (orgCount) orgCount.textContent = '';

    const resultadosCard = document.getElementById('pjf-resultados-card');
    if (resultadosCard) resultadosCard.style.display = 'none';
}

/**
 * Escape de texto para prevenir XSS
 */
function escapeTextPJF(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Escape de atributos para prevenir XSS
 */
function escapeAttrPJF(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&#39;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;');
}
