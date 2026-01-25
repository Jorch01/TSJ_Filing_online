/**
 * Datos de Juzgados del TSJ Quintana Roo
 */

// Mapeo de Juzgados a IDs (Primera Instancia)
const JUZGADOS = {
    // CANCÚN - Familiar
    'JUZGADO PRIMERO FAMILIAR ORAL CANCUN': 61,
    'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN': 62,
    'JUZGADO TERCERO FAMILIAR ORAL CANCUN': 63,
    'JUZGADO CUARTO FAMILIAR ORAL CANCUN': 64,

    // CANCÚN - Civil
    'JUZGADO PRIMERO CIVIL CANCUN': 111,
    'JUZGADO SEGUNDO CIVIL CANCUN': 112,
    'JUZGADO TERCERO CIVIL CANCUN': 113,
    'JUZGADO CUARTO CIVIL CANCUN': 114,
    'JUZGADO QUINTO CIVIL CANCUN': 115,

    // CANCÚN - Mercantil
    'JUZGADO PRIMERO MERCANTIL CANCUN': 51,
    'JUZGADO SEGUNDO MERCANTIL CANCUN': 52,
    'JUZGADO TERCERO MERCANTIL CANCUN': 53,
    'JUZGADO CUARTO MERCANTIL CANCUN': 54,

    // CANCÚN - Laboral
    'JUZGADO PRIMERO LABORAL CANCUN': 81,
    'JUZGADO SEGUNDO LABORAL CANCUN': 82,

    // PLAYA DEL CARMEN
    'JUZGADO PRIMERO CIVIL PLAYA DEL CARMEN': 121,
    'JUZGADO SEGUNDO CIVIL PLAYA DEL CARMEN': 122,
    'JUZGADO PRIMERO FAMILIAR PLAYA DEL CARMEN': 71,
    'JUZGADO SEGUNDO FAMILIAR PLAYA DEL CARMEN': 72,
    'JUZGADO MERCANTIL PLAYA DEL CARMEN': 55,
    'JUZGADO MIXTO CIVIL FAMILIAR PLAYA DEL CARMEN': 131,
    'JUZGADO LABORAL PLAYA DEL CARMEN': 83,

    // CHETUMAL
    'JUZGADO PRIMERO CIVIL CHETUMAL': 101,
    'JUZGADO SEGUNDO CIVIL CHETUMAL': 102,
    'JUZGADO PRIMERO FAMILIAR CHETUMAL': 41,
    'JUZGADO SEGUNDO FAMILIAR CHETUMAL': 42,
    'JUZGADO MERCANTIL CHETUMAL': 56,
    'JUZGADO LABORAL CHETUMAL': 84,

    // COZUMEL
    'JUZGADO MIXTO CIVIL COZUMEL': 141,
    'JUZGADO MIXTO FAMILIAR COZUMEL': 142,
    'JUZGADO CIVIL COZUMEL': 143,
    'JUZGADO FAMILIAR COZUMEL': 144,

    // OTROS MUNICIPIOS
    'JUZGADO MIXTO TULUM': 151,
    'JUZGADO MIXTO FELIPE CARRILLO PUERTO': 152,
    'JUZGADO MIXTO JOSE MARIA MORELOS': 153,
    'JUZGADO MIXTO LAZARO CARDENAS': 154,
    'JUZGADO MIXTO BACALAR': 155,
    'JUZGADO MIXTO PUERTO MORELOS': 156,
    'JUZGADO MIXTO ISLA MUJERES': 157,
    'JUZGADO CIVIL ORAL ISLA MUJERES': 158,
    'JUZGADO MIXTO CIVIL FAMILIAR TULUM': 159,
    'JUZGADO PRIMERO FAMILIAR ORAL TULUM': 160,
    'JUZGADO SEGUNDO FAMILIAR ORAL TULUM': 161,
    'JUZGADO CIVIL ORAL TULUM': 162,
    'JUZGADO MIXTO ORAL PUERTO AVENTURAS': 163
};

// Mapeo de Salas de Segunda Instancia
const SALAS_SEGUNDA_INSTANCIA = {
    'PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR': 170,
    'SEGUNDA SALA PENAL ORAL': 171,
    'TERCERA SALA CIVIL MERCANTIL': 172,
    'CUARTA SALA FAMILIAR': 173,
    'QUINTA SALA PENAL ORAL': 174,
    'SEXTA SALA CIVIL MERCANTIL': 175,
    'SEPTIMA SALA FAMILIAR': 176,
    'OCTAVA SALA CIVIL MERCANTIL FAMILIAR': 177,
    'NOVENA SALA PENAL': 178,
    'DECIMA SALA PENAL ORAL': 179,
    'SALA CONSTITUCIONAL': 184
};

// Mapeo de IDs de Salas a areaIds
const AREA_IDS_SALAS = {
    170: 145, 171: 146, 172: 147, 173: 148, 174: 149,
    175: 150, 176: 151, 177: 152, 178: 153, 179: 154, 184: 159
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
            'JUZGADO TERCERO FAMILIAR ORAL CANCUN',
            'JUZGADO CUARTO FAMILIAR ORAL CANCUN'
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
            'JUZGADO QUINTO CIVIL CANCUN'
        ]
    },
    {
        nombre: 'CANCÚN - Mercantil',
        icono: '💼',
        juzgados: [
            'JUZGADO PRIMERO MERCANTIL CANCUN',
            'JUZGADO SEGUNDO MERCANTIL CANCUN',
            'JUZGADO TERCERO MERCANTIL CANCUN',
            'JUZGADO CUARTO MERCANTIL CANCUN'
        ]
    },
    {
        nombre: 'CANCÚN - Laboral',
        icono: '👷',
        juzgados: [
            'JUZGADO PRIMERO LABORAL CANCUN',
            'JUZGADO SEGUNDO LABORAL CANCUN'
        ]
    },
    {
        nombre: 'PLAYA DEL CARMEN',
        icono: '🏖️',
        juzgados: [
            'JUZGADO PRIMERO CIVIL PLAYA DEL CARMEN',
            'JUZGADO SEGUNDO CIVIL PLAYA DEL CARMEN',
            'JUZGADO PRIMERO FAMILIAR PLAYA DEL CARMEN',
            'JUZGADO SEGUNDO FAMILIAR PLAYA DEL CARMEN',
            'JUZGADO MERCANTIL PLAYA DEL CARMEN',
            'JUZGADO MIXTO CIVIL FAMILIAR PLAYA DEL CARMEN',
            'JUZGADO LABORAL PLAYA DEL CARMEN'
        ]
    },
    {
        nombre: 'CHETUMAL',
        icono: '🌴',
        juzgados: [
            'JUZGADO PRIMERO CIVIL CHETUMAL',
            'JUZGADO SEGUNDO CIVIL CHETUMAL',
            'JUZGADO PRIMERO FAMILIAR CHETUMAL',
            'JUZGADO SEGUNDO FAMILIAR CHETUMAL',
            'JUZGADO MERCANTIL CHETUMAL',
            'JUZGADO LABORAL CHETUMAL'
        ]
    },
    {
        nombre: 'COZUMEL',
        icono: '🏝️',
        juzgados: [
            'JUZGADO MIXTO CIVIL COZUMEL',
            'JUZGADO MIXTO FAMILIAR COZUMEL',
            'JUZGADO CIVIL COZUMEL',
            'JUZGADO FAMILIAR COZUMEL'
        ]
    },
    {
        nombre: 'OTROS MUNICIPIOS',
        icono: '📍',
        juzgados: [
            'JUZGADO MIXTO TULUM',
            'JUZGADO MIXTO CIVIL FAMILIAR TULUM',
            'JUZGADO PRIMERO FAMILIAR ORAL TULUM',
            'JUZGADO SEGUNDO FAMILIAR ORAL TULUM',
            'JUZGADO CIVIL ORAL TULUM',
            'JUZGADO MIXTO FELIPE CARRILLO PUERTO',
            'JUZGADO MIXTO JOSE MARIA MORELOS',
            'JUZGADO MIXTO LAZARO CARDENAS',
            'JUZGADO MIXTO BACALAR',
            'JUZGADO MIXTO PUERTO MORELOS',
            'JUZGADO MIXTO ISLA MUJERES',
            'JUZGADO CIVIL ORAL ISLA MUJERES',
            'JUZGADO MIXTO ORAL PUERTO AVENTURAS'
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

function construirUrlBusqueda(juzgado, tipoBusqueda, valor) {
    const idJuzgado = obtenerIdJuzgado(juzgado);
    if (!idJuzgado) return null;

    const baseUrl = 'https://www.tsjqroo.gob.mx/index.php/component/buscador';
    const valorCodificado = encodeURIComponent(valor);
    const esSala = esSalaSegundaInstancia(juzgado);

    if (esSala) {
        const areaId = AREA_IDS_SALAS[idJuzgado];
        if (tipoBusqueda === 'numero') {
            return `${baseUrl}_segunda/?expediente=${valorCodificado}&juzgadoId=${idJuzgado}&areaId=${areaId}`;
        } else {
            return `${baseUrl}_segunda/?actor=${valorCodificado}&juzgadoId=${idJuzgado}&areaId=${areaId}`;
        }
    } else {
        if (tipoBusqueda === 'numero') {
            return `${baseUrl}_primera/?expediente=${valorCodificado}&juzgadoId=${idJuzgado}`;
        } else {
            return `${baseUrl}_primera/?actor=${valorCodificado}&juzgadoId=${idJuzgado}`;
        }
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
