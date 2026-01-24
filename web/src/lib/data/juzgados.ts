/**
 * Datos de Juzgados del TSJ Quintana Roo
 * Incluye mapeos de IDs y categorías
 */

export interface JuzgadoInfo {
  id: number;
  nombre: string;
  categoria: string;
  ciudad: string;
  esSalaSegundaInstancia: boolean;
  areaId?: number;
}

// Mapeo de Juzgados a IDs (Primera Instancia)
export const JUZGADOS: Record<string, number> = {
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

// Mapeo de Salas de Segunda Instancia a IDs
export const SALAS_SEGUNDA_INSTANCIA: Record<string, number> = {
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

// Mapeo de IDs de Salas a areaIds (requerido para búsquedas de 2ª instancia)
export const AREA_IDS_SALAS: Record<number, number> = {
  170: 145,  // PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR
  171: 146,  // SEGUNDA SALA PENAL ORAL
  172: 147,  // TERCERA SALA CIVIL MERCANTIL
  173: 148,  // CUARTA SALA FAMILIAR
  174: 149,  // QUINTA SALA PENAL ORAL
  175: 150,  // SEXTA SALA CIVIL MERCANTIL
  176: 151,  // SEPTIMA SALA FAMILIAR
  177: 152,  // OCTAVA SALA CIVIL MERCANTIL FAMILIAR
  178: 153,  // NOVENA SALA PENAL
  179: 154,  // DECIMA SALA PENAL ORAL
  184: 159   // SALA CONSTITUCIONAL
};

// Categorías organizadas para el selector
export interface CategoriaJuzgados {
  nombre: string;
  icono: string;
  juzgados: string[];
}

export const CATEGORIAS_JUZGADOS: CategoriaJuzgados[] = [
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

// Función para obtener ID de juzgado
export function obtenerIdJuzgado(nombre: string): number | undefined {
  return JUZGADOS[nombre] || SALAS_SEGUNDA_INSTANCIA[nombre];
}

// Función para verificar si es sala de segunda instancia
export function esSalaSegundaInstancia(nombre: string): boolean {
  return nombre in SALAS_SEGUNDA_INSTANCIA;
}

// Función para obtener areaId de sala
export function obtenerAreaIdSala(idSala: number): number | undefined {
  return AREA_IDS_SALAS[idSala];
}

// Función para obtener categoría de un juzgado
export function obtenerCategoriaJuzgado(nombre: string): string {
  for (const categoria of CATEGORIAS_JUZGADOS) {
    if (categoria.juzgados.includes(nombre)) {
      return categoria.nombre;
    }
  }
  return 'OTROS';
}

// Función para construir URL de búsqueda
export function construirUrlBusqueda(
  idJuzgado: number,
  tipoBusqueda: 'numero' | 'nombre',
  valor: string,
  esSala: boolean
): string {
  const baseUrl = 'https://www.tsjqroo.gob.mx/index.php/component/buscador';
  const valorCodificado = encodeURIComponent(valor);

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

// Lista completa de todos los juzgados para autocompletado
export function obtenerTodosLosJuzgados(): string[] {
  return [...Object.keys(JUZGADOS), ...Object.keys(SALAS_SEGUNDA_INSTANCIA)];
}

// Obtener información completa de un juzgado
export function obtenerInfoJuzgado(nombre: string): JuzgadoInfo | undefined {
  const id = obtenerIdJuzgado(nombre);
  if (!id) return undefined;

  const esSala = esSalaSegundaInstancia(nombre);
  const categoria = obtenerCategoriaJuzgado(nombre);

  // Extraer ciudad del nombre
  let ciudad = 'Otro';
  if (nombre.includes('CANCUN')) ciudad = 'Cancún';
  else if (nombre.includes('PLAYA')) ciudad = 'Playa del Carmen';
  else if (nombre.includes('CHETUMAL')) ciudad = 'Chetumal';
  else if (nombre.includes('COZUMEL')) ciudad = 'Cozumel';
  else if (nombre.includes('TULUM')) ciudad = 'Tulum';
  else if (nombre.includes('BACALAR')) ciudad = 'Bacalar';
  else if (nombre.includes('ISLA MUJERES')) ciudad = 'Isla Mujeres';
  else if (esSala) ciudad = 'Chetumal'; // Las salas están en Chetumal

  return {
    id,
    nombre,
    categoria,
    ciudad,
    esSalaSegundaInstancia: esSala,
    areaId: esSala ? AREA_IDS_SALAS[id] : undefined
  };
}
