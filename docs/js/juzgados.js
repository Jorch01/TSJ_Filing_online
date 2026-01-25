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
