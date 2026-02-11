// ==================== BÚSQUEDA PJF FEDERAL ====================
// Sistema de búsqueda de expedientes del Poder Judicial de la Federación
// Utiliza catálogos de circuitos y organismos cargados desde JSON

let pjfCircuitos = [];
let pjfOrganismos = [];
let pjfDatosCargados = false;
let pjfCargando = false;

// Mapping de id_sise a Cir= URL parameter para DGEJ
const PJF_CIRCUITO_URL_MAP = {
    1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
    41: 41, 43: 43, 46: 46, 38: 38, 42: 42, 45: 45, 44: 44, 40: 40, 39: 39,
    20: 20,
    51: 51, 53: 53, 56: 56, 48: 48, 52: 52, 55: 55, 54: 54, 50: 50, 49: 49,
    30: 30,
    47: 47, 109: 109
};

// URLs del PJF
const PJF_URLS = {
    dgejCircuitos: 'https://www.dgej.cjf.gob.mx/internet/expedientes/circuitos.asp',
    siseSentencias: 'https://sise.cjf.gob.mx/consultasvp/default.aspx',
    juicioEnLinea: 'https://www.serviciosenlinea.pjf.gob.mx/juicioenlinea/'
};

// Tipos de asunto disponibles
const PJF_TIPOS_ASUNTO = [
    { id: 'amparo_indirecto', nombre: 'Amparo Indirecto' },
    { id: 'amparo_directo', nombre: 'Amparo Directo' },
    { id: 'amparo_revision', nombre: 'Amparo en Revisión' },
    { id: 'queja', nombre: 'Queja' },
    { id: 'revision_fiscal', nombre: 'Revisión Fiscal' },
    { id: 'conflicto_competencial', nombre: 'Conflicto Competencial' },
    { id: 'recurso_reclamacion', nombre: 'Recurso de Reclamación' },
    { id: 'causa_penal', nombre: 'Causa Penal' },
    { id: 'juicio_oral_mercantil', nombre: 'Juicio Oral Mercantil' },
    { id: 'incidente', nombre: 'Incidente' },
    { id: 'otro', nombre: 'Otro (campo libre)' }
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
        poblarSelectAnio();

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
 * Pobla el dropdown de circuitos
 */
function poblarSelectCircuitos() {
    const select = document.getElementById('pjf-circuito');
    if (!select) return;

    select.innerHTML = '<option value="">-- Selecciona un circuito --</option>';

    pjfCircuitos.forEach(c => {
        const option = document.createElement('option');
        option.value = c.id_sise;
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
 * Pobla el selector de año (2000-2026)
 */
function poblarSelectAnio() {
    const select = document.getElementById('pjf-anio');
    if (!select) return;

    select.innerHTML = '<option value="">-- Año --</option>';

    const anioActual = new Date().getFullYear();
    const anioMax = Math.max(anioActual, 2026);

    for (let a = anioMax; a >= 2000; a--) {
        const option = document.createElement('option');
        option.value = a;
        option.textContent = a;
        select.appendChild(option);
    }
}

/**
 * Filtra organismos por circuito seleccionado (dropdown en cascada)
 */
function filtrarOrganismosPorCircuito() {
    const circuitoId = parseInt(document.getElementById('pjf-circuito').value);
    const selectOrg = document.getElementById('pjf-organismo');

    selectOrg.innerHTML = '<option value="">-- Selecciona un organismo --</option>';

    if (!circuitoId) {
        selectOrg.disabled = true;
        return;
    }

    const organismosFiltrados = pjfOrganismos.filter(o => o.circuito_id === circuitoId);

    organismosFiltrados.forEach(o => {
        const option = document.createElement('option');
        option.value = o.id;
        option.textContent = o.nombre;
        selectOrg.appendChild(option);
    });

    selectOrg.disabled = false;

    // Actualizar contador
    const contador = document.getElementById('pjf-org-count');
    if (contador) {
        contador.textContent = `${organismosFiltrados.length} organismos disponibles`;
    }
}

/**
 * Muestra/oculta el campo libre de tipo de asunto
 */
function toggleTipoAsuntoLibre() {
    const select = document.getElementById('pjf-tipo-asunto');
    const campoLibre = document.getElementById('pjf-tipo-asunto-otro-group');
    if (campoLibre) {
        campoLibre.style.display = select.value === 'otro' ? 'block' : 'none';
    }
}

/**
 * Construye la URL de consulta en el portal DGEJ del PJF
 */
function construirUrlPJF(circuitoIdSise) {
    const cirParam = PJF_CIRCUITO_URL_MAP[circuitoIdSise] || circuitoIdSise;
    return `${PJF_URLS.dgejCircuitos}?Cir=${cirParam}&Exp=1`;
}

/**
 * Ejecuta la búsqueda PJF
 */
function ejecutarBusquedaPJF() {
    const circuitoId = document.getElementById('pjf-circuito').value;
    const organismoId = document.getElementById('pjf-organismo').value;
    const tipoAsunto = document.getElementById('pjf-tipo-asunto').value;
    const tipoAsuntoOtro = document.getElementById('pjf-tipo-asunto-otro')?.value || '';
    const numExpediente = document.getElementById('pjf-num-expediente').value.trim();
    const nombrePartes = document.getElementById('pjf-nombre-partes').value.trim();
    const anio = document.getElementById('pjf-anio').value;

    // Validación mínima
    if (!circuitoId) {
        if (typeof mostrarToast === 'function') {
            mostrarToast('Selecciona al menos un circuito para buscar.', 'warning');
        }
        return;
    }

    // Obtener datos del circuito y organismo seleccionados
    const circuito = pjfCircuitos.find(c => c.id_sise === parseInt(circuitoId));
    const organismo = organismoId ? pjfOrganismos.find(o => o.id === parseInt(organismoId)) : null;
    const tipoAsuntoTexto = tipoAsunto === 'otro' ? tipoAsuntoOtro :
        (PJF_TIPOS_ASUNTO.find(t => t.id === tipoAsunto)?.nombre || '');

    // Construir parámetros de búsqueda
    const parametros = {
        circuito: circuito,
        organismo: organismo,
        tipoAsunto: tipoAsuntoTexto,
        numExpediente: numExpediente,
        nombrePartes: nombrePartes,
        anio: anio
    };

    // Mostrar resultados con enlaces al portal
    mostrarResultadosPJF(parametros);
}

/**
 * Muestra los resultados de búsqueda con enlaces al portal del PJF
 */
function mostrarResultadosPJF(parametros) {
    const contenedor = document.getElementById('pjf-resultados');
    const card = document.getElementById('pjf-resultados-card');

    if (!contenedor || !card) return;

    card.style.display = 'block';

    // URL principal de consulta DGEJ
    const urlDGEJ = construirUrlPJF(parametros.circuito.id_sise);
    const urlSISE = PJF_URLS.siseSentencias;

    // Construir resumen de búsqueda
    let resumenHTML = '<div class="pjf-search-summary">';
    resumenHTML += '<h4>Resumen de Búsqueda</h4>';
    resumenHTML += '<div class="pjf-summary-grid">';

    resumenHTML += `<div class="pjf-summary-item">
        <span class="pjf-summary-label">Circuito:</span>
        <span class="pjf-summary-value">${escapeTextPJF(parametros.circuito.nombre)}</span>
    </div>`;

    if (parametros.organismo) {
        resumenHTML += `<div class="pjf-summary-item">
            <span class="pjf-summary-label">Organismo:</span>
            <span class="pjf-summary-value">${escapeTextPJF(parametros.organismo.nombre)}</span>
        </div>`;
    }

    if (parametros.tipoAsunto) {
        resumenHTML += `<div class="pjf-summary-item">
            <span class="pjf-summary-label">Tipo de Asunto:</span>
            <span class="pjf-summary-value">${escapeTextPJF(parametros.tipoAsunto)}</span>
        </div>`;
    }

    if (parametros.numExpediente) {
        resumenHTML += `<div class="pjf-summary-item">
            <span class="pjf-summary-label">Expediente:</span>
            <span class="pjf-summary-value">${escapeTextPJF(parametros.numExpediente)}</span>
        </div>`;
    }

    if (parametros.nombrePartes) {
        resumenHTML += `<div class="pjf-summary-item">
            <span class="pjf-summary-label">Nombre de las Partes:</span>
            <span class="pjf-summary-value">${escapeTextPJF(parametros.nombrePartes)}</span>
        </div>`;
    }

    if (parametros.anio) {
        resumenHTML += `<div class="pjf-summary-item">
            <span class="pjf-summary-label">Año:</span>
            <span class="pjf-summary-value">${escapeTextPJF(parametros.anio)}</span>
        </div>`;
    }

    resumenHTML += '</div></div>';

    // Construir sección de enlaces al portal
    let enlacesHTML = '<div class="pjf-portal-links">';
    enlacesHTML += '<h4>Consultar en Portales del PJF</h4>';
    enlacesHTML += '<p class="section-desc">Los siguientes enlaces te llevarán a los portales oficiales del Poder Judicial de la Federación donde podrás completar tu consulta.</p>';

    enlacesHTML += '<div class="pjf-links-grid">';

    // Enlace DGEJ - Acuerdos por expediente
    enlacesHTML += `<a href="${escapeAttrPJF(urlDGEJ)}" target="_blank" rel="noopener noreferrer" class="pjf-link-card">
        <div class="pjf-link-icon">📋</div>
        <div class="pjf-link-info">
            <strong>Consulta de Acuerdos (DGEJ)</strong>
            <p>Buscar acuerdos y publicaciones del ${escapeTextPJF(parametros.circuito.nombre)}</p>
        </div>
        <span class="pjf-link-arrow">→</span>
    </a>`;

    // Enlace SISE - Consulta de sentencias
    enlacesHTML += `<a href="${escapeAttrPJF(urlSISE)}" target="_blank" rel="noopener noreferrer" class="pjf-link-card">
        <div class="pjf-link-icon">⚖️</div>
        <div class="pjf-link-info">
            <strong>Consulta de Sentencias (SISE)</strong>
            <p>Consultar sentencias y versiones públicas del CJF</p>
        </div>
        <span class="pjf-link-arrow">→</span>
    </a>`;

    // Enlace Juicio en Línea
    enlacesHTML += `<a href="${escapeAttrPJF(PJF_URLS.juicioEnLinea)}" target="_blank" rel="noopener noreferrer" class="pjf-link-card">
        <div class="pjf-link-icon">💻</div>
        <div class="pjf-link-info">
            <strong>Juicio en Línea</strong>
            <p>Portal de servicios en línea del PJF</p>
        </div>
        <span class="pjf-link-arrow">→</span>
    </a>`;

    enlacesHTML += '</div></div>';

    // Tabla de referencia con la información proporcionada
    let tablaHTML = '<div class="pjf-reference-table">';
    tablaHTML += '<h4>Datos de Referencia para la Consulta</h4>';
    tablaHTML += '<div class="table-responsive"><table class="pjf-table">';
    tablaHTML += `<thead><tr>
        <th>Expediente</th>
        <th>Órgano Jurisdiccional</th>
        <th>Tipo de Asunto</th>
        <th>Año</th>
        <th>Circuito</th>
        <th>Acciones</th>
    </tr></thead>`;
    tablaHTML += '<tbody>';
    tablaHTML += `<tr>
        <td>${escapeTextPJF(parametros.numExpediente || 'No especificado')}</td>
        <td>${escapeTextPJF(parametros.organismo ? parametros.organismo.nombre : 'No especificado')}</td>
        <td>${escapeTextPJF(parametros.tipoAsunto || 'No especificado')}</td>
        <td>${escapeTextPJF(parametros.anio || 'No especificado')}</td>
        <td>${escapeTextPJF(parametros.circuito.nombre)}</td>
        <td>
            <button class="btn btn-sm btn-primary" onclick="window.open('${escapeAttrPJF(urlDGEJ)}', '_blank')">
                Ver en DGEJ
            </button>
        </td>
    </tr>`;
    tablaHTML += '</tbody></table></div>';
    tablaHTML += '</div>';

    contenedor.innerHTML = resumenHTML + enlacesHTML + tablaHTML;

    // Scroll al resultado
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
    document.getElementById('pjf-nombre-partes').value = '';
    document.getElementById('pjf-anio').value = '';

    const campoLibre = document.getElementById('pjf-tipo-asunto-otro-group');
    if (campoLibre) campoLibre.style.display = 'none';

    const otroInput = document.getElementById('pjf-tipo-asunto-otro');
    if (otroInput) otroInput.value = '';

    const orgCount = document.getElementById('pjf-org-count');
    if (orgCount) orgCount.textContent = '';

    const resultadosCard = document.getElementById('pjf-resultados-card');
    if (resultadosCard) resultadosCard.style.display = 'none';
}

/**
 * Filtra opciones en un select basándose en texto de búsqueda
 */
function filtrarSelectPJF(inputId, selectId) {
    const input = document.getElementById(inputId);
    const select = document.getElementById(selectId);

    if (!input || !select) return;

    const filtro = input.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    Array.from(select.options).forEach((option, index) => {
        if (index === 0) return; // Skip placeholder
        const texto = option.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        option.style.display = texto.includes(filtro) ? '' : 'none';
    });
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
