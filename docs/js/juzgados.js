/**
 * Datos de Juzgados del TSJ Quintana Roo
 * IDs extraídos del sistema de estrados electrónicos oficial
 */

// Mapeo de Juzgados a IDs (Primera Instancia)
// IDs CORRECTOS del sistema TSJ
const JUZGADOS = {
    // ===== CANCÚN =====
    'JUZGADO PRIMERO FAMILIAR ORAL CANCUN': 109,
    'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN': 158,
    'JUZGADO SEGUNDO DE LO FAMILIAR CANCUN': 115,
    'JUZGADO FAMILIAR DE PRIMERA INSTANCIA CANCUN': 114,
    'JUZGADO PRIMERO CIVIL CANCUN': 111,
    'JUZGADO SEGUNDO CIVIL CANCUN': 112,
    'JUZGADO TERCERO CIVIL CANCUN': 113,
    'JUZGADO CUARTO CIVIL CANCUN': 182,
    'JUZGADO ORAL CIVIL CANCUN': 110,
    'JUZGADO PRIMERO MERCANTIL CANCUN': 105,
    'JUZGADO SEGUNDO MERCANTIL CANCUN': 106,
    'JUZGADO TERCERO MERCANTIL CANCUN': 107,
    'JUZGADO ORAL MERCANTIL CANCUN': 108,
    'TRIBUNAL PRIMERO LABORAL CANCUN': 164,
    'TRIBUNAL SEGUNDO LABORAL CANCUN': 165,

    // ===== PLAYA DEL CARMEN / SOLIDARIDAD =====
    'JUZGADO FAMILIAR ORAL PLAYA': 88,
    'JUZGADO FAMILIAR PRIMERA INSTANCIA PLAYA': 84,
    'JUZGADO PRIMERO CIVIL PLAYA': 83,
    'JUZGADO SEGUNDO CIVIL PLAYA': 161,
    'JUZGADO ORAL CIVIL PLAYA': 87,
    'JUZGADO MERCANTIL PLAYA': 85,
    'TRIBUNAL LABORAL PLAYA': 166,

    // ===== CHETUMAL =====
    'JUZGADO FAMILIAR ORAL CHETUMAL': 93,
    'JUZGADO FAMILIAR PRIMERA INSTANCIA CHETUMAL': 94,
    'JUZGADO CIVIL CHETUMAL': 95,
    'JUZGADO MERCANTIL CHETUMAL': 96,
    'JUZGADO CIVIL ORAL CHETUMAL': 97,
    'TRIBUNAL LABORAL CHETUMAL': 163,

    // ===== COZUMEL =====
    'JUZGADO FAMILIAR COZUMEL': 89,
    'JUZGADO CIVIL COZUMEL': 90,
    'JUZGADO FAMILIAR ORAL COZUMEL': 91,
    'JUZGADO ORAL CIVIL COZUMEL': 92,

    // ===== FELIPE CARRILLO PUERTO =====
    'JUZGADO CIVIL ORAL CARRILLO PUERTO': 136,
    'JUZGADO FAMILIAR ORAL CARRILLO PUERTO': 137,
    'JUZGADO CIVIL PRIMERA INSTANCIA CARRILLO PUERTO': 153,
    'JUZGADO FAMILIAR PRIMERA INSTANCIA CARRILLO PUERTO': 154,

    // ===== ISLA MUJERES =====
    'JUZGADO CIVIL ORAL ISLA MUJERES': 131,
    'JUZGADO FAMILIAR ORAL ISLA MUJERES': 132,

    // ===== TULUM =====
    'JUZGADO CIVIL ORAL TULUM': 144,
    'JUZGADO FAMILIAR ORAL TULUM': 145,

    // ===== BACALAR =====
    'JUZGADO FAMILIAR PRIMERA INSTANCIA BACALAR': 188
};

// Mapeo de Salas de Segunda Instancia
const SALAS_SEGUNDA_INSTANCIA = {
    'PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR': 170,
    'SEGUNDA SALA PENAL ORAL': 171,
    'TERCERA SALA PENAL ORAL': 173,
    'CUARTA SALA CIVIL MERCANTIL Y FAMILIAR': 183,
    'QUINTA SALA CIVIL MERCANTIL Y FAMILIAR': 175,
    'SEXTA SALA CIVIL MERCANTIL Y FAMILIAR': 176,
    'SEPTIMA SALA PENAL TRADICIONAL': 177,
    'OCTAVA SALA PENAL ORAL': 178,
    'NOVENA SALA PENAL ORAL': 179,
    'DECIMA SALA CIVIL MERCANTIL Y FAMILIAR PLAYA': 172,
    'SALA CONSTITUCIONAL': 184
};

// Mapeo de IDs de Salas a areaIds (requerido para buscador_segunda.php)
const AREA_IDS_SALAS = {
    170: 145,  // PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR
    171: 146,  // SEGUNDA SALA PENAL ORAL
    172: 147,  // DECIMA SALA CIVIL MERCANTIL Y FAMILIAR PLAYA
    173: 148,  // TERCERA SALA PENAL ORAL
    175: 150,  // QUINTA SALA CIVIL MERCANTIL Y FAMILIAR
    176: 151,  // SEXTA SALA CIVIL MERCANTIL Y FAMILIAR
    177: 152,  // SEPTIMA SALA PENAL TRADICIONAL
    178: 153,  // OCTAVA SALA PENAL ORAL
    179: 154,  // NOVENA SALA PENAL ORAL
    183: 158,  // CUARTA SALA CIVIL MERCANTIL Y FAMILIAR
    184: 159   // SALA CONSTITUCIONAL
};

// Categorías organizadas
const CATEGORIAS_JUZGADOS = [
    {
        nombre: 'SALAS DE SEGUNDA INSTANCIA',
        icono: '🏛️',
        juzgados: Object.keys(SALAS_SEGUNDA_INSTANCIA)
    },
    {
        nombre: 'CANCÚN - Familiar',
        icono: '👨‍👩‍👧‍👦',
        juzgados: [
            'JUZGADO PRIMERO FAMILIAR ORAL CANCUN',
            'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN',
            'JUZGADO SEGUNDO DE LO FAMILIAR CANCUN',
            'JUZGADO FAMILIAR DE PRIMERA INSTANCIA CANCUN'
        ]
    },
    {
        nombre: 'CANCÚN - Civil',
        icono: '⚖️',
        juzgados: [
            'JUZGADO PRIMERO CIVIL CANCUN',
            'JUZGADO SEGUNDO CIVIL CANCUN',
            'JUZGADO TERCERO CIVIL CANCUN',
            'JUZGADO CUARTO CIVIL CANCUN',
            'JUZGADO ORAL CIVIL CANCUN'
        ]
    },
    {
        nombre: 'CANCÚN - Mercantil',
        icono: '💼',
        juzgados: [
            'JUZGADO PRIMERO MERCANTIL CANCUN',
            'JUZGADO SEGUNDO MERCANTIL CANCUN',
            'JUZGADO TERCERO MERCANTIL CANCUN',
            'JUZGADO ORAL MERCANTIL CANCUN'
        ]
    },
    {
        nombre: 'CANCÚN - Laboral',
        icono: '👷',
        juzgados: [
            'TRIBUNAL PRIMERO LABORAL CANCUN',
            'TRIBUNAL SEGUNDO LABORAL CANCUN'
        ]
    },
    {
        nombre: 'PLAYA DEL CARMEN',
        icono: '🏖️',
        juzgados: [
            'JUZGADO PRIMERO CIVIL PLAYA',
            'JUZGADO SEGUNDO CIVIL PLAYA',
            'JUZGADO ORAL CIVIL PLAYA',
            'JUZGADO FAMILIAR ORAL PLAYA',
            'JUZGADO FAMILIAR PRIMERA INSTANCIA PLAYA',
            'JUZGADO MERCANTIL PLAYA',
            'TRIBUNAL LABORAL PLAYA'
        ]
    },
    {
        nombre: 'CHETUMAL',
        icono: '🌴',
        juzgados: [
            'JUZGADO CIVIL CHETUMAL',
            'JUZGADO CIVIL ORAL CHETUMAL',
            'JUZGADO FAMILIAR ORAL CHETUMAL',
            'JUZGADO FAMILIAR PRIMERA INSTANCIA CHETUMAL',
            'JUZGADO MERCANTIL CHETUMAL',
            'TRIBUNAL LABORAL CHETUMAL'
        ]
    },
    {
        nombre: 'COZUMEL',
        icono: '🏝️',
        juzgados: [
            'JUZGADO CIVIL COZUMEL',
            'JUZGADO ORAL CIVIL COZUMEL',
            'JUZGADO FAMILIAR COZUMEL',
            'JUZGADO FAMILIAR ORAL COZUMEL'
        ]
    },
    {
        nombre: 'OTROS MUNICIPIOS',
        icono: '📍',
        juzgados: [
            'JUZGADO CIVIL ORAL TULUM',
            'JUZGADO FAMILIAR ORAL TULUM',
            'JUZGADO CIVIL ORAL CARRILLO PUERTO',
            'JUZGADO FAMILIAR ORAL CARRILLO PUERTO',
            'JUZGADO CIVIL PRIMERA INSTANCIA CARRILLO PUERTO',
            'JUZGADO FAMILIAR PRIMERA INSTANCIA CARRILLO PUERTO',
            'JUZGADO CIVIL ORAL ISLA MUJERES',
            'JUZGADO FAMILIAR ORAL ISLA MUJERES',
            'JUZGADO FAMILIAR PRIMERA INSTANCIA BACALAR'
        ]
    }
];

// Funciones auxiliares
function obtenerIdJuzgado(nombre) {
    return JUZGADOS[nombre] || SALAS_SEGUNDA_INSTANCIA[nombre];
}

function esSalaSegundaInstancia(nombre) {
    return nombre in SALAS_SEGUNDA_INSTANCIA;
}

function obtenerAreaIdSala(idSala) {
    return AREA_IDS_SALAS[idSala];
}

function obtenerCategoriaJuzgado(nombre) {
    for (const cat of CATEGORIAS_JUZGADOS) {
        if (cat.juzgados.includes(nombre)) {
            return cat.nombre;
        }
    }
    return 'OTROS';
}

// Normaliza un nombre de juzgado para comparar: sin tildes, minúsculas y
// espacios colapsados. El catálogo guarda "CANCUN" y "SEPTIMA" sin tilde, pero
// nadie escribe así: hace falta que "Cancún" y "SÉPTIMA" también encuentren su
// juzgado.
function normalizarNombreJuzgado(nombre) {
    return String(nombre || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// Palabras de enlace que el catálogo omite o incluye sin criterio fijo.
const ENLACES_NOMBRE_JUZGADO = new Set(['de', 'del', 'la', 'las', 'el', 'lo', 'los', 'en', 'y']);

/**
 * Resuelve lo que el usuario escribió al nombre EXACTO del catálogo (regla
 * única para el asistente de voz y la carga masiva por CSV). Devolver el
 * nombre canónico —y no el que se tecleó— es imprescindible: construirUrlBusqueda
 * busca el id por nombre exacto, así que un expediente guardado como
 * "Juzgado Primero Civil Cancún" quedaría sin botón de búsqueda.
 *
 * @returns {string|null} nombre canónico, o null si no hay coincidencia.
 */
function resolverJuzgadoTSJ(nombre) {
    if (!nombre) return null;
    const todos = Object.keys(JUZGADOS).concat(Object.keys(SALAS_SEGUNDA_INSTANCIA));
    if (todos.includes(nombre)) return nombre;

    const objetivo = normalizarNombreJuzgado(nombre);
    if (!objetivo) return null;

    const exacto = todos.find(j => normalizarNombreJuzgado(j) === objetivo);
    if (exacto) return exacto;

    // "Juzgado Primero Civil de Cancún": el catálogo no lleva las preposiciones
    // ("JUZGADO PRIMERO CIVIL CANCUN"), pero así lo dice y lo escribe todo el
    // mundo. Se compara sin ellas, y solo vale si queda uno.
    const sinEnlaces = (s) => normalizarNombreJuzgado(s).split(' ')
        .filter(p => !ENLACES_NOMBRE_JUZGADO.has(p)).join(' ');
    const objetivoSinEnlaces = sinEnlaces(nombre);
    const porPalabras = todos.filter(j => sinEnlaces(j) === objetivoSinEnlaces);
    if (porPalabras.length === 1) return porPalabras[0];

    // Último recurso: coincidencia parcial, pero solo si es inequívoca. Con
    // varios candidatos se prefiere fallar a adivinar mal el juzgado.
    const parciales = todos.filter(j => {
        const n = normalizarNombreJuzgado(j);
        return n.includes(objetivo) || objetivo.includes(n);
    });
    return parciales.length === 1 ? parciales[0] : null;
}

// ==================== EL JUZGADO COMO LO ESCRIBE UN ACUERDO ====================
// El catálogo usa nombres cortos ("JUZGADO PRIMERO CIVIL CANCUN") y un acuerdo
// los escribe completos: "Juzgado Primero Civil de Primera Instancia del
// Distrito Judicial de Cancún, Quintana Roo". resolverJuzgadoTSJ() no llega a
// tanto —es la regla de lo que se teclea, y está bien que sea estricta—, así
// que la IA guardaba el nombre largo y el expediente se quedaba sin estrados.
// Esto reconoce el juzgado por sus rasgos: sala o juzgado, número, materia, si
// es oral y la ciudad, también dicha por su municipio.

const CIUDADES_TSJ = [
    ['cancun', ['cancun', 'benito juarez']],
    ['playa', ['playa del carmen', 'solidaridad', 'playa']],
    ['chetumal', ['chetumal', 'othon p blanco', 'othon pompeyo blanco']],
    ['cozumel', ['cozumel']],
    ['carrillo puerto', ['felipe carrillo puerto', 'carrillo puerto']],
    ['isla mujeres', ['isla mujeres']],
    ['tulum', ['tulum']],
    ['bacalar', ['bacalar']]
];

const ORDINALES_TSJ = {
    primero: 1, primer: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercer: 3, tercera: 3,
    cuarto: 4, cuarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6, septimo: 7, septima: 7,
    octavo: 8, octava: 8, noveno: 9, novena: 9, decimo: 10, decima: 10
};

const MATERIAS_TSJ = ['civil', 'familiar', 'mercantil', 'laboral', 'penal', 'constitucional'];

/** Los rasgos que distinguen un juzgado o una sala del TSJ, sacados del nombre. */
function rasgosJuzgadoTSJ(nombre) {
    let t = ' ' + normalizarNombreJuzgado(nombre).replace(/[^a-z0-9]+/g, ' ') + ' ';

    let ciudad = null;
    for (const [clave, variantes] of CIUDADES_TSJ) {
        const v = variantes.find(x => t.includes(' ' + x + ' '));
        if (v) { ciudad = clave; t = t.split(' ' + v + ' ').join(' '); break; }
    }
    // "Primera Instancia" no es el número del juzgado.
    t = t.replace(/ (primera|segunda) instancia /g, ' ');

    const palabras = t.trim().split(' ');
    let ordinal = null;
    for (const p of palabras) {
        if (ORDINALES_TSJ[p] !== undefined) { ordinal = ORDINALES_TSJ[p]; break; }
        const m = /^(\d{1,2})(?:o|a|er|ro|do|to|vo|no|mo)?$/.exec(p);
        if (m) { ordinal = Number(m[1]); break; }
    }

    const materias = MATERIAS_TSJ.filter(m => palabras.includes(m) || palabras.includes(m + 'es'));
    if (palabras.includes('trabajo') && !materias.includes('laboral')) materias.push('laboral');

    return {
        sala: palabras.includes('sala'),
        ordinal,
        materias,
        oral: palabras.some(p => /^oral(es|idad)?$/.test(p)),
        tradicional: palabras.includes('tradicional'),
        ciudad
    };
}

let _catalogoRasgosTSJ = null;

function _catalogoConRasgosTSJ() {
    if (!_catalogoRasgosTSJ) {
        _catalogoRasgosTSJ = Object.keys(JUZGADOS).concat(Object.keys(SALAS_SEGUNDA_INSTANCIA))
            .map(nombre => ({ nombre, rasgos: rasgosJuzgadoTSJ(nombre) }));
    }
    return _catalogoRasgosTSJ;
}

/**
 * El nombre del catálogo del juzgado o sala del TSJ al que se refiere un
 * nombre escrito como en un acuerdo, o null si no se puede saber con
 * seguridad: entre dos que encajan igual no se adivina, porque abrir los
 * estrados de otro juzgado es peor que no abrir ninguno.
 */
function reconocerJuzgadoTSJ(texto) {
    const directo = resolverJuzgadoTSJ(texto);
    if (directo) return directo;
    if (!texto) return null;

    // Los federales no son del TSJ aunque se parezcan: "Juzgado Primero de
    // Distrito" no es el Juzgado Primero Civil.
    const normal = normalizarNombreJuzgado(texto);
    if (/\bde distrito\b(?! judicial)|colegiad|circuito|federal|unitario/.test(normal)) return null;

    const q = rasgosJuzgadoTSJ(texto);
    // Sin materia no hay forma de saber cuál ("Juzgado Primero de Cancún").
    if (!q.materias.length) return null;

    let mejores = [];
    let mejor = -1;
    for (const { nombre, rasgos: r } of _catalogoConRasgosTSJ()) {
        if (r.sala !== q.sala) continue;
        if (q.materias.some(m => !r.materias.includes(m))) continue;
        if (q.ciudad && r.ciudad && q.ciudad !== r.ciudad) continue;
        // Uno con número se nombra con su número, y uno sin número solo puede
        // ser "el primero": un "Juzgado Tercero Civil de Chetumal" no es el
        // Juzgado Civil de Chetumal.
        if (r.ordinal !== null && q.ordinal !== null && r.ordinal !== q.ordinal) continue;
        if (r.ordinal === null && q.ordinal !== null && q.ordinal !== 1) continue;
        if (q.oral && !r.oral) continue;
        if (q.tradicional && !r.tradicional) continue;

        // Lo que no se escribió no descarta, pero pesa: "Juzgado Civil de
        // Cancún", sin número, queda empatado entre los cinco de allí.
        let puntos = 0;
        if (r.ordinal === q.ordinal) puntos += 2;
        if (r.oral === q.oral) puntos += 2;
        if (q.ciudad && r.ciudad === q.ciudad) puntos += 1;
        if (r.materias.length === q.materias.length) puntos += 1;

        if (puntos > mejor) { mejor = puntos; mejores = [nombre]; }
        else if (puntos === mejor) mejores.push(nombre);
    }
    return mejores.length === 1 ? mejores[0] : null;
}

/**
 * Construye la URL correcta de búsqueda según el tipo de juzgado
 * - Primera Instancia: buscador_primera.php
 * - Segunda Instancia (Salas): buscador_segunda.php + areaId
 *
 * @param {string} juzgado - Nombre del juzgado
 * @param {string} tipoBusqueda - 'numero' o 'nombre'
 * @param {string} valor - Término de búsqueda
 * @returns {string} URL completa para la búsqueda
 */
function construirUrlBusqueda(juzgado, tipoBusqueda, valor) {
    const idJuzgado = obtenerIdJuzgado(juzgado);
    if (!idJuzgado) return null;

    const baseUrl = 'https://www.tsjqroo.gob.mx/estrados';
    const valorCodificado = encodeURIComponent(valor);
    const metodo = tipoBusqueda === 'numero' ? 1 : 2;
    const esSala = esSalaSegundaInstancia(juzgado);

    if (esSala) {
        // Sala de Segunda Instancia - usar buscador_segunda.php
        const areaId = AREA_IDS_SALAS[idJuzgado];
        return `${baseUrl}/buscador_segunda.php?findexp=${valorCodificado}&int=${idJuzgado}&areaId=${areaId}&metodo=${metodo}`;
    } else {
        // Primera Instancia - usar buscador_primera.php
        return `${baseUrl}/buscador_primera.php?int=${idJuzgado}&metodo=${metodo}&findexp=${valorCodificado}`;
    }
}

// Poblar select de juzgados
function poblarSelectJuzgados(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '<option value="">Selecciona un juzgado...</option>';

    for (const cat of CATEGORIAS_JUZGADOS) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = `${cat.icono} ${cat.nombre}`;

        for (const juzgado of cat.juzgados) {
            const option = document.createElement('option');
            option.value = juzgado;
            option.textContent = juzgado;
            optgroup.appendChild(option);
        }

        select.appendChild(optgroup);
    }
}

// Poblar select de categorías
function poblarSelectCategorias(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '<option value="">Todas las categorías</option>';

    for (const cat of CATEGORIAS_JUZGADOS) {
        const option = document.createElement('option');
        option.value = cat.nombre;
        option.textContent = `${cat.icono} ${cat.nombre}`;
        select.appendChild(option);
    }
}
