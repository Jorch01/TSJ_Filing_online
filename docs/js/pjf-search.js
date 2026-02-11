// ==================== BÚSQUEDA PJF FEDERAL ====================
// Búsqueda de expedientes del PJF usando la API pública de serviciosenlinea.pjf.gob.mx
// Los dropdowns de órgano y tipo de asunto se cargan dinámicamente de la API.
// Requiere un proxy CORS (Cloudflare Worker) para funcionar desde el navegador.

let pjfCircuitos = [];
let pjfDatosCargados = false;
let pjfCargando = false;

// PJF API
const PJF_API_BASE = 'https://www.serviciosenlinea.pjf.gob.mx';
const PJF_ENDPOINTS = {
    datosPublicos: '/juicioenlinea/Expediente/ObtenerDatosPublicos',
    datosExpediente: '/juicioenlinea/juicioenlinea/Expediente/ObtenerDatosExpediente?Length=10'
};

// ==================== PROXY CONFIG ====================

function getPjfProxyUrl() {
    return localStorage.getItem('pjf_proxy_url') || '';
}

function setPjfProxyUrl(url) {
    localStorage.setItem('pjf_proxy_url', url.replace(/\/+$/, ''));
}

function guardarProxyPJF() {
    const input = document.getElementById('pjf-proxy-url');
    const url = input.value.trim();
    setPjfProxyUrl(url);
    if (typeof mostrarToast === 'function') {
        mostrarToast(url ? 'URL del proxy guardada.' : 'Proxy desactivado.', 'success');
    }
}

// ==================== API FETCH ====================

function pjfApiUrl(path) {
    const proxy = getPjfProxyUrl();
    if (proxy) {
        return proxy + path;
    }
    return PJF_API_BASE + path;
}

async function fetchPJF(path, formBody) {
    const url = pjfApiUrl(path);
    const options = {
        method: formBody ? 'POST' : 'GET',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    };
    if (formBody) {
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        options.body = formBody;
    }

    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
}

// ==================== HTML PARSING ====================

function parseSelectOptions(html, selectId) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const select = doc.querySelector(`#${selectId}`);
    if (!select) return [];
    return Array.from(select.querySelectorAll('option'))
        .filter(opt => opt.value && opt.value.trim() !== '')
        .map(opt => ({
            id: opt.value.trim(),
            nombre: opt.textContent.trim()
        }));
}

// ==================== INICIALIZACIÓN ====================

async function cargarCatalogosPJF() {
    if (pjfDatosCargados || pjfCargando) return;
    pjfCargando = true;

    const spinner = document.getElementById('pjf-loading');
    if (spinner) spinner.style.display = 'flex';

    try {
        const res = await fetch('data/circuitos.json');
        if (!res.ok) throw new Error('Error cargando circuitos');
        pjfCircuitos = await res.json();
        pjfDatosCargados = true;

        poblarSelectCircuitos();

        // Cargar proxy URL guardada
        const proxyInput = document.getElementById('pjf-proxy-url');
        if (proxyInput) {
            proxyInput.value = getPjfProxyUrl();
        }
    } catch (error) {
        console.error('Error:', error);
        if (typeof mostrarToast === 'function') {
            mostrarToast('Error al cargar catálogos del PJF.', 'error');
        }
    } finally {
        pjfCargando = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// ==================== DROPDOWNS ====================

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
 * Circuito seleccionado → fetch órganos y tipos de asunto desde la API
 */
async function onPjfCircuitoChange() {
    const idCircuito = document.getElementById('pjf-circuito').value;
    const selectOrg = document.getElementById('pjf-organismo');
    const selectTipo = document.getElementById('pjf-tipo-asunto');

    // Reset downstream
    selectOrg.innerHTML = '<option value="">-- Selecciona un organismo --</option>';
    selectOrg.disabled = true;
    selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
    selectTipo.disabled = true;
    document.getElementById('pjf-org-count').textContent = '';
    ocultarResultadosPJF();

    if (!idCircuito) return;

    if (!getPjfProxyUrl()) {
        selectOrg.innerHTML = '<option value="">Configura el proxy CORS primero</option>';
        if (typeof mostrarToast === 'function') {
            mostrarToast('Configura la URL del proxy CORS para conectar con el PJF.', 'warning');
        }
        return;
    }

    selectOrg.innerHTML = '<option value="">Cargando organismos...</option>';

    try {
        const html = await fetchPJF(
            PJF_ENDPOINTS.datosPublicos,
            `IdCircuito=${idCircuito}`
        );

        // Parsear órganos
        const organos = parseSelectOptions(html, 'ddlOrgano');
        selectOrg.innerHTML = '<option value="">-- Selecciona un organismo --</option>';
        organos.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = o.nombre;
            selectOrg.appendChild(opt);
        });
        selectOrg.disabled = false;
        document.getElementById('pjf-org-count').textContent = `${organos.length} organismos`;

        // Parsear tipos de asunto (vienen para el primer órgano por default)
        const tipos = parseSelectOptions(html, 'ddlTipoAsunto');
        selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
        tipos.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.nombre;
            selectTipo.appendChild(opt);
        });
        selectTipo.disabled = false;

    } catch (error) {
        console.error('Error fetching PJF organs:', error);
        selectOrg.innerHTML = '<option value="">Error al cargar</option>';

        if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
            if (typeof mostrarToast === 'function') {
                mostrarToast('Error de conexión. Verifica la URL del proxy CORS.', 'error');
            }
        } else {
            if (typeof mostrarToast === 'function') {
                mostrarToast('Error al consultar PJF: ' + error.message, 'error');
            }
        }
    }
}

/**
 * Órgano seleccionado → fetch tipos de asunto actualizados para ese órgano
 */
async function onPjfOrganoChange() {
    const idOrgano = document.getElementById('pjf-organismo').value;
    const selectTipo = document.getElementById('pjf-tipo-asunto');

    selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
    selectTipo.disabled = true;
    ocultarResultadosPJF();

    if (!idOrgano) return;

    selectTipo.innerHTML = '<option value="">Cargando tipos de asunto...</option>';

    try {
        const html = await fetchPJF(
            PJF_ENDPOINTS.datosExpediente,
            `IdOrgano=${idOrgano}&IdTipoAsunto=1&IdTipoPropiedad=&IdSubNivel=&IdSubNivelInc=`
        );

        const tipos = parseSelectOptions(html, 'ddlTipoAsunto');
        selectTipo.innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
        tipos.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.nombre;
            selectTipo.appendChild(opt);
        });
        selectTipo.disabled = false;

    } catch (error) {
        console.error('Error fetching tipos asunto:', error);
        selectTipo.innerHTML = '<option value="">Error al cargar tipos</option>';
    }
}

// ==================== BÚSQUEDA ====================

async function ejecutarBusquedaPJF() {
    const idOrgano = document.getElementById('pjf-organismo').value;
    const idTipoAsunto = document.getElementById('pjf-tipo-asunto').value;
    const expediente = document.getElementById('pjf-num-expediente').value.trim();

    if (!idOrgano) {
        if (typeof mostrarToast === 'function') mostrarToast('Selecciona un organismo.', 'warning');
        return;
    }
    if (!idTipoAsunto) {
        if (typeof mostrarToast === 'function') mostrarToast('Selecciona un tipo de asunto.', 'warning');
        return;
    }
    if (!expediente) {
        if (typeof mostrarToast === 'function') mostrarToast('Ingresa el número de expediente.', 'warning');
        return;
    }

    const card = document.getElementById('pjf-resultados-card');
    const contenedor = document.getElementById('pjf-resultados');
    card.style.display = 'block';
    contenedor.innerHTML = '<div class="pjf-loading"><span class="loading-spinner"></span><span>Buscando expediente...</span></div>';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
        const html = await fetchPJF(
            PJF_ENDPOINTS.datosExpediente,
            `IdOrgano=${idOrgano}&IdTipoAsunto=${idTipoAsunto}&NoExpediente=${expediente}&IdTipoPropiedad=&IdSubNivel=&IdSubNivelInc=`
        );

        renderizarResultadosPJF(html);

    } catch (error) {
        console.error('Error searching:', error);
        contenedor.innerHTML = `<div class="empty-state small"><span>❌</span><p>Error al buscar: ${escapeTextPJF(error.message)}</p></div>`;
    }
}

// ==================== RESULTADOS ====================

function renderizarResultadosPJF(html) {
    const contenedor = document.getElementById('pjf-resultados');
    const card = document.getElementById('pjf-resultados-card');

    if (!contenedor || !card) return;
    card.style.display = 'block';

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bodyText = doc.body ? doc.body.textContent : '';

    // Verificar si no se encontró
    if (bodyText.includes('no existe') || bodyText.includes('No existe') ||
        bodyText.includes('no se encontr') || bodyText.includes('No se encontr')) {
        contenedor.innerHTML = '<div class="empty-state small"><span>📭</span><p>No se encontró el expediente. Verifica los datos e intenta de nuevo.</p></div>';
        return;
    }

    // Limpiar: remover scripts, forms internos, inputs hidden, botones del form original
    const cleanDoc = doc.cloneNode(true);
    cleanDoc.querySelectorAll('script, style, link').forEach(el => el.remove());

    // Remover los selects y inputs del formulario de búsqueda (no los datos)
    cleanDoc.querySelectorAll('select, input[type="hidden"]').forEach(el => el.remove());

    let resultHTML = cleanDoc.body ? cleanDoc.body.innerHTML : '';

    // Sanitizar con DOMPurify si está disponible
    if (typeof DOMPurify !== 'undefined') {
        resultHTML = DOMPurify.sanitize(resultHTML, {
            ALLOWED_TAGS: ['div', 'span', 'p', 'table', 'thead', 'tbody', 'tfoot',
                           'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                           'strong', 'b', 'em', 'i', 'br', 'hr', 'ul', 'ol', 'li',
                           'a', 'label', 'small', 'dl', 'dt', 'dd', 'fieldset', 'legend',
                           'img', 'caption', 'col', 'colgroup'],
            ALLOWED_ATTR: ['class', 'id', 'href', 'target', 'rel', 'colspan', 'rowspan',
                           'src', 'alt', 'width', 'height']
        });
    }

    if (resultHTML.trim()) {
        contenedor.innerHTML = `<div class="pjf-result-content">${resultHTML}</div>`;
    } else {
        contenedor.innerHTML = '<div class="empty-state small"><span>📭</span><p>La respuesta no contiene datos del expediente.</p></div>';
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function ocultarResultadosPJF() {
    const card = document.getElementById('pjf-resultados-card');
    if (card) card.style.display = 'none';
}

// ==================== LIMPIAR ====================

function limpiarFormularioPJF() {
    document.getElementById('pjf-circuito').value = '';
    document.getElementById('pjf-organismo').innerHTML = '<option value="">-- Selecciona un organismo --</option>';
    document.getElementById('pjf-organismo').disabled = true;
    document.getElementById('pjf-tipo-asunto').innerHTML = '<option value="">-- Selecciona tipo de asunto --</option>';
    document.getElementById('pjf-tipo-asunto').disabled = true;
    document.getElementById('pjf-num-expediente').value = '';
    document.getElementById('pjf-org-count').textContent = '';
    ocultarResultadosPJF();
}

// ==================== UTILIDADES ====================

function escapeTextPJF(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
