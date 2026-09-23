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
