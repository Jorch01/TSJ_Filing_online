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

        // ── Organos ───────────────────────────────────────────────────────
        // El JSON es espejo fiel del portal, que incluye órganos de prueba
        // ("PLENO REGIONAL PRUEBAS1", "Apelación_Pruebas2"…). Se quitan aquí y
        // no en el fetcher para que, si el filtro falla, se vea en el JSON.
        // Sin \b: no hay frontera de palabra antes de un dígito o un "_".
        var todos = data.organos || [];
        var reales = todos.filter(function(o) { return !/prueba/i.test(o.nombre); });
        console.log('[PJF] Órganos de prueba descartados:', todos.length - reales.length);

        pjfOrganismos = reales.map(function(o) {
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

// ==================== BÚSQUEDA DE ORGANISMOS POR NOMBRE ====================
// Permite resolver "Juzgado Segundo de Distrito de Cancún" → orgId sin pasar
// por la cascada de selects. Lo usa el Asistente de Voz para abrir consultas
// federales dictadas desde cero.

/** Carga los catálogos PJF si aún no están en memoria. */
async function asegurarCatalogosPJF() {
    if (!pjfDatosCargados) await cargarCatalogosPJF();
    return pjfDatosCargados;
}

function normalizarTextoPJF(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

var PJF_STOPWORDS = { de: 1, del: 1, la: 1, las: 1, el: 1, los: 1, en: 1, y: 1, con: 1, para: 1 };

// "tribunales colegiados" debe encajar con "Tribunal Colegiado": el catálogo
// está en singular y las peticiones de varios órganos vienen en plural.
function _singularPJF(token) {
    if (/[a-z]{4,}es$/.test(token)) return token.slice(0, -2);
    if (/[a-z]{3,}s$/.test(token)) return token.slice(0, -1);
    return token;
}

function tokensPJF(texto) {
    return normalizarTextoPJF(texto).split(/[^a-z0-9]+/)
        .filter(function (t) { return t && !PJF_STOPWORDS[t]; });
}

// Los circuitos y los órganos se numeran con ordinales escritos ("Primer
// Tribunal Colegiado del Vigésimo Séptimo Circuito"), pero nadie los dicta así:
// se dice "el primer colegiado del 27". El id interno del circuito tampoco
// ayuda —el Vigésimo Séptimo es el circuitoId 54—, así que el número solo
// existe dentro del ordinal escrito. Esto lo traduce a dígitos por los dos
// lados, que es lo que hacía que la misma orden funcionara unas veces y otras
// no, según cómo la escribiera el modelo.
var PJF_ORDINAL_UNIDAD = {
    primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercer: 3,
    tercero: 3, tercera: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5,
    sexto: 6, sexta: 6, septimo: 7, septima: 7, octavo: 8, octava: 8,
    noveno: 9, novena: 9
};
var PJF_ORDINAL_DECENA = { decimo: 10, decima: 10, vigesimo: 20, vigesima: 20, trigesimo: 30, trigesima: 30 };
var PJF_ORDINAL_SUELTO = { undecimo: 11, undecima: 11, duodecimo: 12, duodecima: 12 };
var PJF_ROMANOS = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function _romanoANumero(token) {
    // Solo dos letras o más: una "i" suelta casi nunca es un número romano.
    if (!/^[ivxlcdm]{2,}$/.test(token)) return null;
    var total = 0;
    for (var i = 0; i < token.length; i++) {
        var v = PJF_ROMANOS[token[i]];
        var siguiente = PJF_ROMANOS[token[i + 1]];
        total += (siguiente && siguiente > v) ? -v : v;
    }
    return total > 0 && total <= 40 ? total : null;
}

/**
 * Devuelve el texto con los ordinales escritos y los números romanos pasados a
 * dígitos: "vigésimo séptimo" → "27", "XXVII" → "27", "primer" → "1".
 * Se aplica igual a lo que dicta el usuario y al nombre del catálogo, para que
 * los dos lados hablen el mismo idioma.
 */
function canonizarOrdinalesPJF(texto) {
    var tokens = normalizarTextoPJF(texto).split(/([^a-z0-9]+)/);
    var salida = [];

    for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (!/^[a-z0-9]+$/.test(t)) { salida.push(t); continue; }

        if (PJF_ORDINAL_SUELTO[t] !== undefined) { salida.push(String(PJF_ORDINAL_SUELTO[t])); continue; }

        if (PJF_ORDINAL_DECENA[t] !== undefined) {
            // "vigésimo séptimo" es un solo número; "vigésimo circuito" es 20.
            var siguiente = null, saltar = 0;
            for (var j = i + 1; j < tokens.length; j++) {
                if (/^[a-z0-9]+$/.test(tokens[j])) { siguiente = tokens[j]; saltar = j - i; break; }
                if (!/^\s+$/.test(tokens[j])) break;
            }
            if (siguiente && PJF_ORDINAL_UNIDAD[siguiente] !== undefined) {
                salida.push(String(PJF_ORDINAL_DECENA[t] + PJF_ORDINAL_UNIDAD[siguiente]));
                i += saltar;
                continue;
            }
            salida.push(String(PJF_ORDINAL_DECENA[t]));
            continue;
        }

        if (PJF_ORDINAL_UNIDAD[t] !== undefined) { salida.push(String(PJF_ORDINAL_UNIDAD[t])); continue; }

        var romano = _romanoANumero(t);
        salida.push(romano !== null ? String(romano) : t);
    }
    return salida.join('');
}

// Con los ordinales en dígitos, una bolsa de palabras ya no basta: "primer
// tribunal colegiado del segundo circuito" y "segundo tribunal colegiado del
// primer circuito" llevan los mismos tokens y son órganos de estados
// distintos. Estas dos funciones separan qué número es de quién.

/** El número que acompaña a la palabra "circuito" ("...del 27 circuito" → 27). */
function _numeroCircuitoPJF(canonico) {
    var m = /(\d+)\s+circuito/.exec(canonico);
    return m ? Number(m[1]) : null;
}

/** El ordinal del propio órgano: el primer número que no es el del circuito. */
function _ordinalOrganoPJF(canonico) {
    var circuito = _numeroCircuitoPJF(canonico);
    var numeros = (canonico.match(/\d+/g) || []).map(Number);
    for (var i = 0; i < numeros.length; i++) {
        if (numeros[i] !== circuito) return numeros[i];
    }
    return null;
}

/**
 * Busca un organismo del PJF por nombre aproximado (incluye ciudad/estado).
 * Devuelve el órgano con más tokens coincidentes; exige que TODOS los
 * tokens de la consulta aparezcan (precisión sobre cobertura). Si hay
 * empate devuelve el de nombre más corto (el más específico).
 * Retorna el objeto órgano o null.
 */
/**
 * TODOS los órganos que encajan con lo dictado, del más específico al menos.
 *
 * Existe porque una misma frase puede querer decir uno o varios: "el primer
 * colegiado del 27" es uno solo, y "los colegiados del 27 circuito" son
 * todos los de ese circuito. Lo decide la propia frase —cuanto más concreta,
 * menos resultados— sin necesidad de una bandera aparte.
 */
function buscarOrganismosPJF(texto) {
    var consulta = canonizarOrdinalesPJF(texto);
    var tokens = tokensPJF(consulta);
    if (!tokens.length || !pjfOrganismos.length) return [];

    // Si el usuario dijo de qué circuito y qué número de órgano, se exigen:
    // abrir el tribunal equivocado es peor que no abrir ninguno.
    var circuitoPedido = _numeroCircuitoPJF(consulta);
    var ordinalPedido = _ordinalOrganoPJF(consulta);

    var candidatos = [];
    for (var i = 0; i < pjfOrganismos.length; i++) {
        var o = pjfOrganismos[i];
        var crudo = o.nombre + ' ' + o.ciudad + ' ' + o.estado + ' ' + o.circuito;
        // El blob lleva el texto tal cual Y con los ordinales en dígitos: así
        // encajan tanto "vigésimo séptimo" como "27" y como "XXVII".
        var blob = normalizarTextoPJF(crudo) + ' ' + canonizarOrdinalesPJF(crudo);
        var palabras = blob.split(/[^a-z0-9]+/);
        var ok = true;
        for (var j = 0; j < tokens.length; j++) {
            // Las palabras se buscan como subcadena, que perdona plurales y
            // terminaciones. Los números NO: exigen la palabra entera, porque
            // si no el "2" de "segundo" encaja dentro del "27" del circuito y
            // el Segundo Tribunal Colegiado acaba abriendo el del Primero.
            var encaja = /^\d+$/.test(tokens[j])
                ? palabras.indexOf(tokens[j]) !== -1
                : blob.indexOf(tokens[j]) !== -1 || blob.indexOf(_singularPJF(tokens[j])) !== -1;
            if (!encaja) { ok = false; break; }
        }
        // El ordinal del órgano solo se puede exigir cuando se dijo la palabra
        // "circuito": sin ella no hay forma de saber si "los colegiados del 27"
        // pide el órgano 27 o el circuito 27. En ese caso basta con que el
        // número aparezca como palabra entera, que ya discrimina.
        if (ok && circuitoPedido !== null) {
            var suyo = canonizarOrdinalesPJF(o.nombre + ' ' + o.circuito);
            if (_numeroCircuitoPJF(suyo) !== circuitoPedido) ok = false;
            if (ok && ordinalPedido !== null && _ordinalOrganoPJF(suyo) !== ordinalPedido) ok = false;
        }
        if (ok) candidatos.push(o);
    }
    if (!candidatos.length) return [];

    // Por número de órgano (Primero, Segundo, Tercero...) y, a igualdad, el de
    // nombre más corto, que es el más específico.
    candidatos.sort(function (a, b) {
        var oa = _ordinalOrganoPJF(canonizarOrdinalesPJF(a.nombre + ' ' + a.circuito));
        var ob = _ordinalOrganoPJF(canonizarOrdinalesPJF(b.nombre + ' ' + b.circuito));
        if (oa !== ob) return (oa === null ? 999 : oa) - (ob === null ? 999 : ob);
        return a.nombre.length - b.nombre.length;
    });

    // Todos del mismo tipo que el mejor. No es cosmético: los tipos de asunto
    // dependen del tipo de órgano, así que "amparo directo" no significa lo
    // mismo en un Tribunal Colegiado de Circuito que en uno de Apelación, y
    // una Oficina de Correspondencia no es un tribunal donde buscar nada.
    var tipo = candidatos[0].tipoOrganismoId;
    return candidatos.filter(function (o) { return o.tipoOrganismoId === tipo; });
}

/** El órgano que mejor encaja, o null. Atajo sobre buscarOrganismosPJF(). */
function buscarOrganismoPJF(texto) {
    var lista = buscarOrganismosPJF(texto);
    return lista.length ? lista[0] : null;
}

/** El órgano con ese id (el que guarda un expediente como pjfOrgId), o null. */
function organismoPJFPorId(id) {
    if (id === null || id === undefined || id === '') return null;
    for (var i = 0; i < pjfOrganismos.length; i++) {
        if (String(pjfOrganismos[i].id) === String(id)) return pjfOrganismos[i];
    }
    return null;
}

/**
 * Busca el tipo de asunto por nombre aproximado dentro de los válidos para
 * el tipo de órgano dado. Retorna {id, nombre} o null.
 */
function buscarTipoAsuntoPJF(organo, texto) {
    if (!organo || !texto) return null;
    var info = pjfTiposOrgano[organo.tipoOrganismoId];
    var lista = (info && info.tiposAsuntoArr) ? info.tiposAsuntoArr : [];
    var tokens = tokensPJF(texto);
    if (!tokens.length || !lista.length) return null;

    var mejor = null;
    var mejorScore = 0;
    for (var i = 0; i < lista.length; i++) {
        var nombre = normalizarTextoPJF(lista[i].nombre);
        var score = 0;
        for (var j = 0; j < tokens.length; j++) {
            if (nombre.indexOf(tokens[j]) !== -1) score++;
        }
        // Debe coincidir al menos la mayoría de los tokens dictados
        if (score > mejorScore && score >= Math.ceil(tokens.length / 2)) {
            mejorScore = score;
            mejor = lista[i];
        }
    }
    return mejor;
}

/** Lista los tipos de asunto válidos para un órgano (para mostrarlos al usuario). */
function tiposAsuntoDeOrgano(organo) {
    var info = organo ? pjfTiposOrgano[organo.tipoOrganismoId] : null;
    return (info && info.tiposAsuntoArr) ? info.tiposAsuntoArr : [];
}

// ==================== DATOS DEL PJF DE UN EXPEDIENTE ====================
// La consulta del portal necesita dos números internos: el id del órgano y el
// del tipo de asunto. Nadie se los sabe ni tiene por qué: salen del nombre del
// juzgado y de cómo se llama el asunto ("Amparo Indirecto 123/2025"). Los
// expedientes que daba de alta la IA se guardaban solo con el nombre, y al
// consultarlos se pedía "ID de Organismo" con un selector de tipo de asunto que
// solo ofrecía "Otro". Esto los deduce del catálogo al crear el expediente y,
// para los que ya existían, al consultarlos.

// Cuando un nombre encaja con órganos de varios estados ("el Juzgado Segundo
// de Distrito", sin más), se queda con el de aquí: la app es para Quintana Roo.
var PJF_ESTADO_PREFERIDO = 'quintana roo';

// Lo que se guarda cuando no se supo el órgano. No es un nombre que buscar.
var PJF_ORGANO_SIN_DETERMINAR = /por determinar|sin determinar|no especificad|no identificad|desconocid/;

// "2o.", "1er", "3ro", "7mo" → "2", "1", "3", "7": así viene a veces el
// encabezado del acuerdo, y así el buscador no lo entiende.
var PJF_ORDINAL_ABREVIADO = /\b(\d{1,2})\s*(?:°|º|ª|er|ro|ra|do|da|to|ta|vo|va|no|na|mo|ma|o|a)(?![a-z0-9])\.?/gi;

// La sede que el acuerdo añade al nombre ("…, con residencia en Cancún"). El
// catálogo unas veces la lleva y otras no (y alguna vez sin el "en": "con sede
// Cancún"); se quitan esas palabras pero se deja el lugar, que sí distingue un
// órgano de otro.
var PJF_SEDE = /\b(?:con\s+)?(?:residencia|sede)(?:\s+en)?\b/gi;

// Palabras que dicen qué clase de órgano es. Las que se escriben tienen que
// estar en el órgano, y las que marcan una clase tienen que estar escritas
// para aceptarlo: un "tribunal colegiado" no es el de Apelación, una Oficina
// de Correspondencia no es el juzgado al que atiende, y un "Juzgado Segundo de
// lo Familiar" —del TSJ— no es el Juzgado Segundo de Distrito.
var PJF_PALABRAS_CLASE = ['juzgado', 'distrito', 'tribunal', 'colegiado', 'unitario', 'apelacion',
    'laboral', 'centro', 'pleno', 'oficina', 'auxiliar'];
var PJF_CLASES_APARTE = PJF_PALABRAS_CLASE.filter(function (c) { return c !== 'juzgado' && c !== 'tribunal'; });

// Cuánto de lo escrito tiene que estar en el órgano. Es bajo porque lo que de
// verdad distingue un órgano —su número, el circuito, la clase y el estado—
// no puntúa: se exige aparte.
var PJF_PARECIDO_MINIMO = 0.5;

var _pjfEstados = { fuente: null, lista: [] };

/** Los estados del catálogo, sin tildes y del nombre más largo al más corto. */
function _estadosPJF() {
    if (_pjfEstados.fuente !== pjfOrganismos) {
        var vistos = {};
        pjfOrganismos.forEach(function (o) {
            var e = normalizarTextoPJF(o.estado);
            if (e) vistos[e] = true;
        });
        // Los largos primero: "baja california sur" antes que "baja california".
        _pjfEstados = {
            fuente: pjfOrganismos,
            lista: Object.keys(vistos).sort(function (a, b) { return b.length - a.length; })
        };
    }
    return _pjfEstados.lista;
}

/** Los estados que se nombran en un texto. */
function _estadosMencionadosPJF(texto) {
    var resto = ' ' + normalizarTextoPJF(texto).replace(/[^a-z0-9]+/g, ' ') + ' ';
    var hallados = [];
    _estadosPJF().forEach(function (e) {
        var clave = ' ' + e.replace(/[^a-z0-9]+/g, ' ') + ' ';
        if (resto.indexOf(clave) !== -1) {
            hallados.push(e);
            resto = resto.split(clave).join(' ');
        }
    });
    return hallados;
}

/**
 * El número del propio órgano ("Segundo Tribunal…" → 2), o null. A diferencia
 * de _ordinalOrganoPJF(), no se pierde cuando coincide con el del circuito:
 * el Tercer Colegiado del Tercer Circuito es el 3 del 3.
 */
function _ordinalPropioPJF(canonico) {
    var m = /\d+/.exec(canonico.replace(/\d+\s+circuito/g, ' '));
    return m ? m[0] : null;
}

/** ¿Está la palabra en el texto? Los números, enteros; lo demás, como parte. */
function _palabraEnPJF(t, texto, palabras) {
    if (/^\d+$/.test(t)) return palabras.indexOf(t) !== -1;
    return texto.indexOf(t) !== -1 || texto.indexOf(_singularPJF(t)) !== -1;
}

var _pjfIndice = { fuente: null, items: [] };

/** Lo que se compara de cada órgano, calculado una sola vez por catálogo. */
function _indiceOrganosPJF() {
    if (_pjfIndice.fuente === pjfOrganismos) return _pjfIndice.items;
    var items = pjfOrganismos.map(function (o) {
        var crudo = o.nombre + ' ' + o.ciudad + ' ' + o.estado + ' ' + o.circuito;
        var blob = normalizarTextoPJF(crudo) + ' ' + canonizarOrdinalesPJF(crudo);
        var suyo = canonizarOrdinalesPJF(o.nombre + ' ' + o.circuito);
        // Lo que el nombre dice del órgano, sin dónde está: el estado, la
        // ciudad y el circuito ya se comparan aparte, y si contaran aquí un
        // estado de nombre largo puntuaría menos que uno corto. De los números
        // solo cuenta el suyo: el catálogo trae alguna errata ("Quinta Roo")
        // que, pasada a dígitos, parecería otro número del órgano.
        var lugar = (o.estado + ' ' + o.ciudad + ' estado').split(/\s+/).map(normalizarTextoPJF);
        var ordinal = _ordinalPropioPJF(suyo);
        var propios = tokensPJF(canonizarOrdinalesPJF(o.nombre.replace(PJF_SEDE, ' ')))
            .filter(function (t) { return !/^\d+$/.test(t) && lugar.indexOf(t) === -1; });
        if (ordinal !== null) propios.push(ordinal);
        return {
            organo: o,
            blob: blob,
            palabras: blob.split(/[^a-z0-9]+/),
            nombre: normalizarTextoPJF(o.nombre),
            estado: normalizarTextoPJF(o.estado),
            circuito: _numeroCircuitoPJF(suyo),
            ordinal: ordinal,
            propios: propios
        };
    });
    _pjfIndice = { fuente: pjfOrganismos, items: items };
    return items;
}

/**
 * De varios candidatos, el único posible: el que hay, o el único de Quintana
 * Roo. Si aun así quedan varios no se adivina —abrir el tribunal equivocado es
 * peor que preguntar cuál— y devuelve null.
 */
function _unicoOrganoPJF(candidatos) {
    if (candidatos.length === 1) return candidatos[0];
    var deAqui = candidatos.filter(function (o) {
        return normalizarTextoPJF(o.estado) === PJF_ESTADO_PREFERIDO;
    });
    return deAqui.length === 1 ? deAqui[0] : null;
}

/**
 * Los órganos que mejor encajan con un nombre escrito, empatados en lo más
 * alto. Lo que distingue un órgano de otro no puntúa, se exige: los números
 * (el suyo y el del circuito), la clase de órgano y el estado. Lo demás
 * puntúa en los dos sentidos —cuánto de lo escrito está en el órgano y cuánto
 * del órgano está en lo escrito—, porque con el primero solo "Juzgado Primero de
 * Distrito en Baja California" encajaba igual de bien en el Juzgado Primero
 * de Distrito *en Materia Mercantil* de Baja California, que es otro.
 */
function _organosPorParecidoPJF(texto) {
    var consulta = canonizarOrdinalesPJF(texto);
    var tokens = tokensPJF(consulta);
    if (!tokens.length) return [];

    var textoConsulta = normalizarTextoPJF(texto) + ' ' + consulta;
    var palabrasConsulta = textoConsulta.split(/[^a-z0-9]+/);
    var numeros = tokens.filter(function (t) { return /^\d+$/.test(t); });
    var clases = tokens.map(_singularPJF).filter(function (t) { return PJF_PALABRAS_CLASE.indexOf(t) !== -1; });
    var estados = _estadosMencionadosPJF(texto);
    var circuitoPedido = _numeroCircuitoPJF(consulta);
    var ordinalPedido = _ordinalPropioPJF(consulta);

    var mejores = [];
    var mejor = 0;
    _indiceOrganosPJF().forEach(function (x) {
        if (numeros.some(function (n) { return x.palabras.indexOf(n) === -1; })) return;
        // Si se escribió un número, el suyo tiene que ser uno de ellos. Si no
        // se escribió ninguno no se descarta: le baja la puntuación de vuelta,
        // y así "Juzgado de Distrito en Quintana Roo" queda entre todos los de
        // allí —ambiguo— en vez de quedarse con el único que no lleva número.
        if (numeros.length && x.ordinal !== null && numeros.indexOf(x.ordinal) === -1) return;
        // Igual que en buscarOrganismosPJF(): el número del órgano solo se
        // separa del del circuito cuando se escribió "circuito".
        if (circuitoPedido !== null) {
            if (x.circuito !== circuitoPedido) return;
            if (ordinalPedido !== null && x.ordinal !== ordinalPedido) return;
        }
        if (clases.some(function (c) { return x.blob.indexOf(c) === -1; })) return;
        if (PJF_CLASES_APARTE.some(function (c) {
            return x.nombre.indexOf(c) !== -1 && clases.indexOf(c) === -1;
        })) return;
        if (estados.length && estados.indexOf(x.estado) === -1) return;

        var ida = tokens.filter(function (t) {
            return _palabraEnPJF(t, x.blob, x.palabras);
        }).length / tokens.length;
        if (ida < PJF_PARECIDO_MINIMO) return;
        var vuelta = x.propios.length ? x.propios.filter(function (t) {
            return _palabraEnPJF(t, textoConsulta, palabrasConsulta);
        }).length / x.propios.length : 1;

        // Lo escrito pesa el doble que lo que le sobra al órgano: que diga
        // "mercantil" y el órgano lo sea vale más que un nombre corto.
        var parecido = 2 * ida + vuelta;
        if (parecido > mejor + 1e-9) { mejor = parecido; mejores = [x.organo]; }
        else if (Math.abs(parecido - mejor) <= 1e-9) mejores.push(x.organo);
    });
    return mejores;
}

/**
 * El órgano del catálogo al que se refiere un nombre escrito por la IA o por
 * el usuario, o null si no se puede saber con seguridad.
 *
 * Distinto de buscarOrganismoPJF(), que es para lo que se dicta y acepta
 * "el primer colegiado del 27": aquí el nombre suele venir copiado del
 * encabezado de un acuerdo, con mayúsculas, "2o." y coletillas como "…, con
 * residencia en Cancún", y lo que importa es no quedarse con un órgano
 * parecido que no es el suyo.
 */
function resolverOrganismoPJF(texto) {
    if (texto === null || texto === undefined || !pjfOrganismos.length) return null;
    var limpio = String(texto).replace(PJF_ORDINAL_ABREVIADO, '$1').trim();
    var normal = normalizarTextoPJF(limpio);
    if (!normal || PJF_ORGANO_SIN_DETERMINAR.test(normal)) return null;

    var indice = _indiceOrganosPJF();
    for (var i = 0; i < indice.length; i++) {
        if (indice[i].nombre === normal) return indice[i].organo;
    }
    return _unicoOrganoPJF(_organosPorParecidoPJF(limpio.replace(PJF_SEDE, ' ')));
}

// Cómo aparece cada tipo de asunto en un acuerdo, en el número del expediente
// ("A.D. 486/2026") o en lo que dicta el usuario, del más concreto al más
// genérico: "amparo en revisión" tiene que ganarle a "amparo" a secas. Cada
// uno lleva sus ids por orden de preferencia, porque el mismo asunto cambia de
// id según la clase de órgano: el amparo indirecto es el 1 en un Juzgado de
// Distrito y el 124 en un Colegiado de Apelación.
var PJF_TIPOS_POR_TEXTO = [
    { re: /amparo\s+en\s+revision|recurso\s+de\s+revision|\ba\.?\s?r\.?[\s-]*\d/, ids: [11] },
    { re: /revision\s+fiscal|\br\.?\s?f\.?[\s-]*\d/, ids: [16] },
    { re: /revision\s+contenciosa/, ids: [14] },
    { re: /amparo\s+directo|\ba\.?\s?d\.?[\s-]*\d|\bd\.?\s?[acpt]\.?[\s-]*\d/, ids: [10] },
    // Ante un colegiado, el amparo indirecto llega en revisión.
    { re: /amparo\s+indirecto|\ba\.?\s?i\.?[\s-]*\d/, ids: [1, 124, 11] },
    { re: /amparo\s+contra\s+leyes/, ids: [29] },
    { re: /\bqueja\b|\bq\.?\s?[acpt]?\.?[\s-]*\d/, ids: [15] },
    { re: /inejecucion/, ids: [23] },
    { re: /repeticion\s+del\s+acto/, ids: [24] },
    { re: /inconformidad/, ids: [25, 138] },
    { re: /reclamacion/, ids: [20, 139] },
    { re: /conflicto\s+(competencial|de\s+competencia)/, ids: [12, 131] },
    { re: /impedimento|\bexcusa\b|recusacion/, ids: [13] },
    { re: /contradiccion\s+de\s+(criterios|tesis)/, ids: [129] },
    { re: /reconocimiento\s+de\s+inocencia/, ids: [26, 109, 127] },
    { re: /oral\s+mercantil|mercantil[\s\S]*juicios?\s+orales?|juicios?\s+orales?[\s\S]*mercantil/, ids: [68] },
    { re: /concursos?\s+mercantil/, ids: [46] },
    { re: /extincion\s+de\s+dominio/, ids: [58] },
    { re: /extradicion/, ids: [19] },
    { re: /ejecucion\s+de\s+(la\s+|las\s+)?penas?/, ids: [67] },
    { re: /medidas?\s+(precautorias?|cautelar(es)?)|\bcateo\b|\barraigo\b/, ids: [18] },
    // La apelación es de segunda instancia: penal o civil y administrativa.
    { re: /(apelacion|segunda\s+instancia|\btoca\b)[\s\S]*penal|penal[\s\S]*(apelacion|segunda\s+instancia|\btoca\b)/, ids: [125, 6] },
    { re: /apelacion|segunda\s+instancia|\btoca\b/, ids: [126, 9] },
    { re: /causa\s+penal|procesos?\s+penal|carpeta\s+judicial|acusatorio|\bc\.?\s?p\.?[\s-]*\d/, ids: [74, 2, 125, 6] },
    // Laborales.
    { re: /especial\s+individual/, ids: [112, 135] },
    { re: /especial\s+colectivo/, ids: [113, 135] },
    { re: /huelga/, ids: [116] },
    { re: /seguridad\s+social/, ids: [114] },
    { re: /naturaleza\s+economica/, ids: [115] },
    { re: /paraprocesal|jurisdiccion\s+voluntaria/, ids: [120] },
    { re: /procedimiento\s+de\s+ejecucion/, ids: [117] },
    { re: /designacion\s+de\s+beneficiarios/, ids: [136] },
    { re: /procedimiento\s+ordinario|juicio\s+(ordinario\s+)?laboral|demanda\s+laboral/, ids: [111, 134] },
    // Juicios federales que no son amparo.
    { re: /(juicio|proceso|procedimiento)s?\s+(ordinario\s+)?(civil|mercantil|administrativo)/, ids: [4, 126, 9] },
    // "Amparo" a secas, o "juicio de amparo": ante un juzgado es indirecto y
    // ante un tribunal colegiado, directo.
    { re: /\bamparo\b|\bj\.?\s?a\.?[\s-]*\d/, ids: [1, 124, 10] }
];

// Sin nada escrito que lo diga, lo más común en cada clase de órgano: amparo
// indirecto en un juzgado, amparo directo en un colegiado, la segunda instancia
// civil en uno de apelación, el proceso acusatorio en el centro de justicia
// penal, el procedimiento ordinario en un tribunal laboral.
var PJF_TIPO_POR_DEFECTO = [1, 10, 126, 74, 111, 134, 129];

// Tipos que no son asuntos que alguien consulte por número.
var PJF_TIPO_NO_CONSULTABLE = /comunicaciones oficiales|varios administrativo|control de personal/i;

/**
 * El tipo de asunto de un expediente en ese órgano, { id, nombre }. Se busca
 * en las pistas por orden —la primera es la más fiable— y después en el
 * nombre del propio órgano, que a veces lo dice ("…Especializado en Juicios
 * Orales", "…de Procesos Penales Federales"). Si nada lo dice, el más común
 * para esa clase de órgano. Solo devuelve null si el órgano no tiene tipos en
 * el catálogo.
 */
function deducirTipoAsuntoPJF(organo, pistas) {
    var tipos = tiposAsuntoDeOrgano(organo);
    if (!tipos.length) return null;
    var porId = {};
    tipos.forEach(function (t) { porId[t.id] = t; });
    function primeroDisponible(ids) {
        for (var i = 0; i < ids.length; i++) if (porId[ids[i]]) return porId[ids[i]];
        return null;
    }

    var textos = (pistas || []).concat([organo.nombre]).map(normalizarTextoPJF).filter(Boolean);
    for (var i = 0; i < textos.length; i++) {
        for (var j = 0; j < PJF_TIPOS_POR_TEXTO.length; j++) {
            if (!PJF_TIPOS_POR_TEXTO[j].re.test(textos[i])) continue;
            var tipo = primeroDisponible(PJF_TIPOS_POR_TEXTO[j].ids);
            if (tipo) return tipo;
        }
    }
    return primeroDisponible(PJF_TIPO_POR_DEFECTO) ||
        tipos.filter(function (t) { return !PJF_TIPO_NO_CONSULTABLE.test(t.nombre); })[0] || null;
}

/**
 * Lo que le falta a un expediente federal para consultarse en el portal sin
 * pedirle nada a nadie: { pjfOrgId, pjfTipoAsunto } y, si se pide, el nombre
 * oficial del órgano en "juzgado". Devuelve solo lo nuevo; un objeto vacío si
 * ya lo tenía todo o si el nombre no basta para saber el órgano.
 *
 * opciones.pistas: textos donde buscar el tipo de asunto antes que en el
 *   propio expediente —lo que leyó la IA en el acuerdo, lo que dictó el
 *   usuario—, el más fiable primero.
 * opciones.renombrar: poner el nombre oficial del órgano. Sí al crear; no al
 *   consultar un expediente ya guardado, que no es momento de cambiarle lo
 *   que el usuario pudo escribir a propósito.
 */
function completarDatosPJF(exp, opciones) {
    var cambios = {};
    opciones = opciones || {};
    // Solo para expedientes federales: el nombre de un juzgado del TSJ podría
    // parecerse lo bastante a uno del PJF y acabar con un órgano que no es.
    if (!exp || (exp.institucion && exp.institucion !== 'PJF')) return cambios;

    var organo = organismoPJFPorId(exp.pjfOrgId);
    if (!organo && !exp.pjfOrgId) {
        organo = resolverOrganismoPJF(exp.juzgado);
        if (!organo) return cambios;
        cambios.pjfOrgId = String(organo.id);
        if (opciones.renombrar && organo.nombre !== exp.juzgado) cambios.juzgado = organo.nombre;
    }

    if (organo && !exp.pjfTipoAsunto) {
        var pistas = (opciones.pistas || []).concat([exp.numero, exp.nombre, exp.juzgado, exp.comentario]);
        var tipo = deducirTipoAsuntoPJF(organo, pistas);
        if (tipo) cambios.pjfTipoAsunto = String(tipo.id);
    }
    return cambios;
}
