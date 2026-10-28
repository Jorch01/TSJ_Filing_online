/**
 * Estudio de viabilidad de una marca nueva.
 *
 * Junta las tres herramientas del IMPI que la app ya consulta y las pone a
 * trabajar para una sola pregunta: ¿se puede registrar esta denominación en
 * estas clases?
 *
 *  - MARCia busca marcas idénticas y parecidas (su motor de similitud) en
 *    todas las clases, y luego las cuenta clase por clase.
 *  - Marcanet hace la búsqueda fonética oficial del IMPI, clase por clase.
 *  - SIGA trae lo publicado en las Gacetas: solicitudes recién publicadas
 *    (que todavía pueden no verse en las otras), renovaciones, caducidades.
 *
 * Lo que devuelven las tres se junta en una sola lista de antecedentes (sin
 * repetir la misma marca), y cada uno se compara contra la propuesta: qué
 * tanto se parece por escritura y por cómo suena en español, si está en la
 * misma clase o en una relacionada, si sigue vigente y si es del mismo
 * solicitante. Con eso se clasifica el riesgo y se arma un dictamen con
 * observaciones y recomendaciones.
 *
 * Dos partes, como la calculadora laboral:
 *  - el motor, puro: recibe lo que respondió cada fuente y devuelve el
 *    reporte; se prueba en Node sin red;
 *  - la interfaz, que hace las consultas por el proxy y pinta el reporte.
 *
 * Es una herramienta de apoyo: los umbrales son orientativos y el criterio
 * del IMPI (y del abogado) es el que decide.
 */
(function (global) {
    'use strict';

    // ==================== MOTOR ====================

    const CLASES_NIZA = {
        1: 'Químicos', 2: 'Pinturas', 3: 'Cosméticos', 4: 'Aceites industriales', 5: 'Farmacéuticos',
        6: 'Metales comunes', 7: 'Máquinas', 8: 'Herramientas manuales', 9: 'Aparatos científicos/electrónicos',
        10: 'Aparatos médicos', 11: 'Iluminación/calefacción', 12: 'Vehículos', 13: 'Armas de fuego', 14: 'Joyería',
        15: 'Instrumentos musicales', 16: 'Papelería', 17: 'Caucho/plástico', 18: 'Cuero/equipaje',
        19: 'Materiales construcción', 20: 'Muebles', 21: 'Utensilios domésticos', 22: 'Cuerdas/fibras textiles',
        23: 'Hilos textiles', 24: 'Tejidos', 25: 'Vestimenta/calzado', 26: 'Mercería', 27: 'Alfombras',
        28: 'Juegos/deportes', 29: 'Alimentos (carne/lácteos)', 30: 'Alimentos (café/cereales)',
        31: 'Productos agrícolas', 32: 'Bebidas sin alcohol y cerveza', 33: 'Bebidas alcohólicas', 34: 'Tabaco',
        35: 'Publicidad/negocios', 36: 'Seguros/finanzas', 37: 'Construcción/reparación', 38: 'Telecomunicaciones',
        39: 'Transporte', 40: 'Tratamiento materiales', 41: 'Educación/entretenimiento',
        42: 'Servicios científicos/tecnológicos', 43: 'Alimentos/hospedaje', 44: 'Servicios médicos',
        45: 'Servicios jurídicos'
    };

    // Clases que el IMPI suele considerar relacionadas: productos que se
    // venden juntos, servicios que los acompañan. Dos clases son relacionadas
    // si comparten algún grupo. Es una guía; la relación real depende de los
    // productos concretos.
    const GRUPOS_RELACIONADOS = [
        [29, 30, 31, 32, 43],        // alimentos y lo que se sirve
        [32, 33, 43],                // bebidas y bares
        [3, 5, 10, 44],              // cosméticos, salud, servicios médicos
        [3, 21, 8],                  // cuidado personal y del hogar
        [9, 38, 42],                 // tecnología y software
        [9, 16, 41, 28],             // contenidos, publicaciones, entretenimiento
        [14, 18, 25, 26, 24],        // moda y accesorios
        [20, 21, 11, 27, 24],        // hogar
        [6, 19, 37],                 // construcción
        [36, 37],                    // inmobiliario
        [12, 37, 39, 4],             // vehículos, talleres, transporte
        [39, 41, 43],                // turismo y hospedaje
        [35, 36],                    // negocios y finanzas
        [35, 45, 41],                // servicios profesionales
        [34, 33]                     // tabaco y licores
    ];

    // Palabras que no distinguen nada por sí solas: artículos, conectores y
    // las formas jurídicas de las empresas.
    const PALABRAS_VACIAS = new Set([
        'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', 'O', 'U', 'EN', 'CON', 'POR', 'PARA', 'AL', 'UN', 'UNA',
        'THE', 'OF', 'AND', 'A', 'AN', 'FOR', 'BY', 'TO',
        'SA', 'CV', 'RL', 'SC', 'SAPI', 'SRL', 'SAB', 'AC', 'S', 'R', 'L', 'C', 'V', 'INC', 'LLC', 'LTD', 'CO', 'CORP'
    ]);

    // Términos de uso común en cualquier giro: ayudan a describir, no a
    // distinguir. Nadie los puede tener en exclusiva.
    const GENERICAS_GENERALES = [
        'GRUPO', 'SERVICIOS', 'SERVICIO', 'CENTRO', 'INTERNACIONAL', 'NACIONAL', 'COMPANIA', 'COMPANY', 'CORPORATIVO',
        'CORPORACION', 'EMPRESA', 'EMPRESAS', 'MEXICO', 'MEXICANA', 'MEXICANO', 'STORE', 'SHOP', 'TIENDA', 'CASA',
        'HOUSE', 'CLUB', 'MARCA', 'PRODUCTOS', 'PRODUCTS', 'SOLUCIONES', 'SOLUTIONS', 'GLOBAL', 'ONLINE', 'DIGITAL',
        'STUDIO', 'ESTUDIO', 'LAB', 'LABS', 'NET', 'WEB', 'APP', 'GROUP', 'ACADEMIA', 'DISTRIBUIDORA', 'COMERCIAL',
        'COMERCIALIZADORA', 'INDUSTRIAS', 'INDUSTRIAL'
    ];

    // Elogios: tampoco se pueden apropiar.
    const LAUDATORIAS = [
        'MEJOR', 'MEJORES', 'PREMIUM', 'SUPER', 'EXTRA', 'TOP', 'PLUS', 'GOURMET', 'ORIGINAL', 'AUTENTICO', 'AUTENTICA',
        'ELITE', 'LUJO', 'DELUXE', 'CALIDAD', 'TOTAL', 'EXPRESS', 'PRO', 'MAX', 'ULTRA', 'BEST', 'GOLD', 'ORO',
        'REAL', 'IMPERIAL', 'SELECTO', 'SELECTA', 'FINO', 'FINA', 'PERFECTO', 'PERFECTA', 'NUMERO', 'UNO', 'PRIMERO'
    ];

    // Lo que describe los productos de cada clase. No es exhaustivo: cubre lo
    // más común para que el estudio avise. El campo "productos o servicios"
    // completa lo que aquí falte.
    const DESCRIPTIVAS_POR_CLASE = {
        3: ['COSMETICOS', 'BELLEZA', 'CREMA', 'SHAMPOO', 'JABON', 'PERFUME', 'MAQUILLAJE', 'SKIN', 'CARE', 'SPA', 'NATURAL'],
        5: ['FARMACIA', 'MEDICAMENTO', 'MEDICINA', 'SALUD', 'VITAMINAS', 'PHARMA', 'FARMA', 'NATURAL', 'SUPLEMENTO'],
        9: ['SOFTWARE', 'TECH', 'TECNOLOGIA', 'DIGITAL', 'SMART', 'APP', 'DATA', 'CLOUD', 'SYSTEMS', 'SISTEMAS', 'ELECTRONICA'],
        16: ['PAPEL', 'PAPELERIA', 'LIBROS', 'EDITORIAL', 'IMPRESOS', 'REVISTA'],
        25: ['ROPA', 'MODA', 'FASHION', 'WEAR', 'JEANS', 'ZAPATOS', 'CALZADO', 'BOUTIQUE', 'STYLE', 'ESTILO', 'TEXTIL'],
        29: ['CARNES', 'CARNE', 'LACTEOS', 'QUESOS', 'QUESO', 'LECHE', 'POLLO', 'EMBUTIDOS', 'NATURAL', 'ORGANICO'],
        30: ['CAFE', 'COFFEE', 'PAN', 'PANADERIA', 'CHOCOLATE', 'TE', 'TEA', 'GALLETAS', 'TORTILLAS', 'HELADOS', 'SALSA', 'SALSAS', 'MOLE', 'TAMALES', 'ORGANICO', 'NATURAL'],
        31: ['FRUTAS', 'VERDURAS', 'SEMILLAS', 'PLANTAS', 'FLORES', 'ORGANICO', 'AGRO'],
        32: ['AGUA', 'WATER', 'JUGO', 'JUGOS', 'REFRESCO', 'BEBIDA', 'BEBIDAS', 'CERVEZA', 'BEER', 'SODA', 'ENERGY', 'NATURAL'],
        33: ['TEQUILA', 'MEZCAL', 'VINO', 'WINE', 'RON', 'VODKA', 'WHISKY', 'LICOR', 'DESTILADO', 'BEBIDAS'],
        35: ['MARKETING', 'PUBLICIDAD', 'CONSULTORIA', 'NEGOCIOS', 'BUSINESS', 'STORE', 'TIENDA', 'VENTAS', 'COMERCIO'],
        36: ['FINANZAS', 'FINANCIERA', 'INVERSIONES', 'CAPITAL', 'SEGUROS', 'CREDITO', 'INMOBILIARIA', 'REAL', 'ESTATE', 'BIENES', 'RAICES'],
        37: ['CONSTRUCCION', 'CONSTRUCTORA', 'REMODELACION', 'MANTENIMIENTO', 'REPARACION', 'TALLER'],
        39: ['TRANSPORTE', 'VIAJES', 'TOURS', 'TRAVEL', 'LOGISTICA', 'MUDANZAS', 'TAXI'],
        41: ['ESCUELA', 'COLEGIO', 'ACADEMIA', 'EDUCACION', 'CURSOS', 'INSTITUTO', 'ENTRETENIMIENTO', 'EVENTOS', 'GYM', 'FITNESS'],
        42: ['SOFTWARE', 'TECH', 'TECNOLOGIA', 'DESARROLLO', 'DISENO', 'DESIGN', 'CLOUD', 'DATA', 'ARQUITECTURA', 'INGENIERIA'],
        43: ['RESTAURANTE', 'RESTAURANT', 'CAFE', 'CAFETERIA', 'BAR', 'COCINA', 'KITCHEN', 'GRILL', 'TACOS', 'TAQUERIA', 'HOTEL', 'HOSTAL', 'MARISCOS', 'PIZZA', 'BURGER', 'COMIDA', 'FOOD', 'BISTRO'],
        44: ['CLINICA', 'MEDICOS', 'MEDICAL', 'SALUD', 'DENTAL', 'SPA', 'ESTETICA', 'NUTRICION', 'HOSPITAL', 'VETERINARIA'],
        45: ['ABOGADOS', 'LEGAL', 'JURIDICO', 'JURIDICOS', 'BUFETE', 'DESPACHO', 'LAW', 'NOTARIA', 'ASESORES', 'CONSULTORES']
    };

    // Nombres geográficos frecuentes en México. Una marca puede llevarlos,
    // pero si indican de dónde vienen los productos (o engañan sobre ello) el
    // IMPI la niega.
    const GEOGRAFICOS = [
        'MEXICO', 'AMERICA', 'CARIBE', 'CANCUN', 'TULUM', 'COZUMEL', 'BACALAR', 'CHETUMAL', 'HOLBOX', 'MAHAHUAL',
        'QUINTANA ROO', 'PLAYA DEL CARMEN', 'RIVIERA MAYA', 'ISLA MUJERES', 'YUCATAN', 'MERIDA', 'CAMPECHE', 'CHIAPAS',
        'TABASCO', 'VERACRUZ', 'OAXACA', 'PUEBLA', 'GUERRERO', 'ACAPULCO', 'MICHOACAN', 'JALISCO', 'GUADALAJARA',
        'MONTERREY', 'NUEVO LEON', 'COAHUILA', 'CHIHUAHUA', 'SONORA', 'SINALOA', 'DURANGO', 'ZACATECAS', 'NAYARIT',
        'COLIMA', 'AGUASCALIENTES', 'GUANAJUATO', 'QUERETARO', 'HIDALGO', 'TLAXCALA', 'MORELOS', 'TAMAULIPAS',
        'SAN LUIS POTOSI', 'BAJA CALIFORNIA', 'TIJUANA', 'LOS CABOS', 'PUERTO VALLARTA', 'CIUDAD DE MEXICO', 'CDMX'
    ];

    // Nombres y siglas oficiales: reproducirlos sin autorización es causa de
    // negativa.
    const OFICIALES = [
        'IMPI', 'SAT', 'IMSS', 'ISSSTE', 'PEMEX', 'CFE', 'UNAM', 'IPN', 'INFONAVIT', 'BANXICO', 'SCJN', 'ONU', 'UNESCO',
        'OEA', 'OMS', 'OLIMPICO', 'OLIMPICA', 'OLIMPIADA', 'OLIMPIADAS', 'CRUZ ROJA', 'GOBIERNO', 'SECRETARIA', 'PRESIDENCIA'
    ];
    const SEMIOFICIALES = ['FEDERAL', 'OFICIAL', 'REPUBLICA', 'ESTATAL', 'MUNICIPAL', 'NACIONAL'];

    const RIESGOS = ['alto', 'medio', 'propia', 'bajo'];

    // Va en el formulario, en el reporte, en el resumen y en el CSV.
    const AVISO_VIABILIDAD = 'Los resultados de este estudio dependen por completo de búsquedas en sistemas externos (MARCia, Marcanet y SIGA del IMPI), ' +
        'que pueden estar incompletos, desactualizados o fallar. Por eso nunca son concluyentes: antes de usar esta información para un trámite de registro, ' +
        'consulta siempre a un especialista en propiedad industrial.';

    // ---- Texto ----

    /** Mayúsculas, sin acentos ni signos, sin la forma jurídica de la empresa. */
    function normalizarMarca(texto) {
        let t = String(texto == null ? '' : texto).toUpperCase().replace(/Ñ/g, 'NY');
        t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
        t = t.replace(/&/g, ' Y ').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
        // "S.A. DE C.V." llega como "S A DE C V": fuera del final.
        t = t.replace(/(\s+(S A P I|S A B|S A|S DE R L|S C|A C|DE C V|DE R L|DE C|DE R L DE C V|INC|LLC|LTD|CORP))+$/g, '').trim();
        return t;
    }

    function palabras(normalizado) {
        return normalizado ? normalizado.split(' ').filter(Boolean) : [];
    }

    function fonetizarPalabra(p) {
        if (/^\d+$/.test(p)) return p;
        let w = p;
        w = w.replace(/PH/g, 'F').replace(/TH/g, 'T');
        w = w.replace(/CH/g, '1');               // la CH se aparta para que la C no la toque
        w = w.replace(/QU(?=[EI])/g, 'K').replace(/Q/g, 'K');
        w = w.replace(/GU(?=[EI])/g, '2');        // gue, gui: G suave
        w = w.replace(/G(?=[EI])/g, 'J');         // ge, gi: suena a J
        w = w.replace(/2/g, 'G');
        w = w.replace(/C(?=[EI])/g, 'S').replace(/C/g, 'K');
        w = w.replace(/Z/g, 'S');
        w = w.replace(/^X/, 'S').replace(/X/g, 'KS');
        w = w.replace(/H/g, '');                  // la H no suena
        w = w.replace(/LL/g, 'Y');
        w = w.replace(/Y(?=[^AEIOU]|$)/g, 'I');   // "rey" ~ "rei"
        w = w.replace(/V/g, 'B').replace(/W/g, 'U');
        w = w.replace(/1/g, 'CH');
        w = w.replace(/(.)\1+/g, '$1');           // rr, ll, ss… cuentan como una
        return w;
    }

    /** Cómo suena en español: "Vrisa" y "Brisa", "Kasa" y "Casa" dan lo mismo. */
    function claveFonetica(texto) {
        return palabras(normalizarMarca(texto)).map(fonetizarPalabra).join(' ');
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            const actual = [i];
            for (let j = 1; j <= b.length; j++) {
                actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            previa = actual;
        }
        return previa[b.length];
    }

    function parecido(a, b) {
        if (!a && !b) return 1;
        return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    }

    /** Las palabras de los nombres geográficos que aparecen en la denominación. */
    function palabrasGeograficas(normalizado) {
        const s = new Set();
        for (const g of GEOGRAFICOS) if ((' ' + normalizado + ' ').includes(' ' + g + ' ')) for (const w of g.split(' ')) s.add(w);
        return s;
    }

    function descriptivasDe(clases) {
        const s = new Set(GENERICAS_GENERALES);
        for (const c of clases || []) for (const w of DESCRIPTIVAS_POR_CLASE[c] || []) s.add(w);
        return s;
    }

    /** Las palabras que de verdad distinguen a la marca. */
    function palabrasDistintivas(denominacion, clases, productos) {
        const desc = descriptivasDe(clases);
        const n = normalizarMarca(denominacion);
        const geo = palabrasGeograficas(n);
        const deProductos = new Set(palabras(normalizarMarca(productos)).filter(w => w.length >= 4));
        return palabras(n).filter(w =>
            w.length >= 3 && !PALABRAS_VACIAS.has(w) && !desc.has(w) && !LAUDATORIAS.includes(w) && !deProductos.has(w) && !geo.has(w));
    }

    /**
     * Qué tanto se parecen dos denominaciones (0 a 100) y por qué. Se mira la
     * escritura y el sonido; pesa más el principio, que es lo que se recuerda;
     * y cuenta que una contenga a la otra o que compartan la palabra que
     * distingue.
     */
    function compararMarcas(propuesta, antecedente, clases) {
        const na = normalizarMarca(propuesta), nb = normalizarMarca(antecedente);
        if (!na || !nb) return { puntaje: 0, tipo: 'distinta', detalle: '' };
        const ca = na.replace(/ /g, ''), cb = nb.replace(/ /g, '');
        if (ca === cb) return { puntaje: 100, tipo: 'identica', detalle: 'Idéntica' };
        const fa = claveFonetica(na).replace(/ /g, ''), fb = claveFonetica(nb).replace(/ /g, '');
        if (fa && fa === fb) return { puntaje: 96, tipo: 'fonetica', detalle: 'Suena igual' };

        const orto = parecido(ca, cb), fon = parecido(fa, fb);
        let puntaje = Math.round(100 * Math.max(orto, fon));
        let tipo = fon > orto + 0.02 ? 'fonetica' : 'escrita';
        let detalle = fon > orto + 0.02 ? 'Suena parecido' : 'Se escribe parecido';
        // Empezar igual pesa, pero solo en lo que ya se parece: con un
        // principio tan común como LUN-, «LUNA & FRIDA» no se acerca a
        // «LUNAFARDO» por eso.
        if (fa.slice(0, 3) === fb.slice(0, 3) && fa.length >= 3 && puntaje >= 70 && puntaje < 94) puntaje = Math.min(94, puntaje + 5);
        if (puntaje < 50) { tipo = 'distinta'; detalle = 'Poco parecido'; }

        const desc = descriptivasDe(clases);
        const util = w => w.length >= 3 && !PALABRAS_VACIAS.has(w) && !desc.has(w) && !LAUDATORIAS.includes(w);
        const pa = palabras(na).filter(w => !PALABRAS_VACIAS.has(w));
        const pb = palabras(nb).filter(w => !PALABRAS_VACIAS.has(w));
        const fpa = pa.map(fonetizarPalabra), fpb = pb.map(fonetizarPalabra);
        const contenida = (corta, larga, fcorta, flarga) => corta.length && corta.length < larga.length &&
            corta.filter(util).join('').length >= 4 && fcorta.every(w => flarga.includes(w));
        if (contenida(pa, pb, fpa, fpb) || contenida(pb, pa, fpb, fpa)) {
            if (puntaje < 85) { puntaje = 85; tipo = 'contiene'; detalle = 'Una contiene a la otra'; }
        }
        const comunes = pa.filter((w, i) => util(w) && w.length >= 4 && fpb.includes(fpa[i]));
        if (comunes.length && puntaje < 75) {
            puntaje = 75;
            tipo = 'comparte';
            detalle = 'Comparten «' + comunes[0] + '»';
        }
        // Una palabra casi igual a la que distingue, aunque el resto cambie:
        // «L LUNFARDO» frente a «LUNAFARDO». Pesa un poco menos que el todo.
        let mejor = null;
        for (const w of pa.filter(x => util(x) && x.length >= 5)) {
            for (const v of pb.filter(x => x.length >= 5)) {
                const sim = Math.max(parecido(w, v), parecido(fonetizarPalabra(w), fonetizarPalabra(v)));
                if (sim >= 0.85 && (!mejor || sim > mejor.sim)) mejor = { sim, v };
            }
        }
        if (mejor && palabras(na).length + palabras(nb).length > 2) {
            const p = Math.round(100 * mejor.sim) - 6;
            if (p > puntaje) { puntaje = p; tipo = 'comparte'; detalle = 'Contiene «' + mejor.v + '», casi igual'; }
        }
        return { puntaje, tipo, detalle };
    }

    /**
     * MARCia busca palabras enteras: «lunafardo» no encuentra «LUNFARDO».
     * Sí acepta comodines, así que se busca la primera mitad larga y la
     * segunda («lunaf*» y «*fardo»): un cambio de una letra deja intacta
     * alguna de las dos.
     */
    function variantesComodin(palabra) {
        const w = normalizarMarca(palabra).replace(/ /g, '');
        if (w.length < 6) return [];
        const k = Math.min(w.length - 1, Math.max(5, Math.ceil(w.length * 0.55)));
        return [w.slice(0, k) + '*', '*' + w.slice(-k)];
    }

    // ---- Clases y estatus ----

    function clasesRelacionadas(clases) {
        const objetivo = new Set((clases || []).map(Number));
        const rel = new Set();
        for (const g of GRUPOS_RELACIONADOS) {
            if (g.some(c => objetivo.has(c))) for (const c of g) if (!objetivo.has(c)) rel.add(c);
        }
        return Array.from(rel).sort((a, b) => a - b);
    }

    function relacionClases(objetivo, clasesAntecedente) {
        const de = (clasesAntecedente || []).map(Number).filter(n => n >= 1 && n <= 45);
        if (!de.length) return 'desconocida';
        const obj = (objetivo || []).map(Number);
        if (de.some(c => obj.includes(c))) return 'misma';
        const rel = clasesRelacionadas(obj);
        if (de.some(c => rel.includes(c))) return 'relacionada';
        return 'distinta';
    }

    /** "25/10/2013", "2013-10-25" → ms. */
    function fechaIMPI(t) {
        if (!t) return null;
        let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(t).trim());
        if (m) return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
        m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t).trim());
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
        return null;
    }

    /**
     * vigente | tramite | inactiva | desconocida. Ante la duda se trata como
     * vigente: en un estudio de viabilidad es peor callar un obstáculo que
     * avisar de uno que luego no lo era.
     */
    function situacionDe(estado) {
        const e = normalizarMarca(estado);
        if (!e) return 'desconocida';
        if (/CADUC|CANCEL|ABANDON|NEGAD|NEGATIV|DESIST|NULID|NULA|EXTIN|REVOC|BAJA|DESECH|CONCLUID/.test(e)) return 'inactiva';
        if (/TRAMITE|SOLICIT|EXAMEN|PUBLICAD|OPOSICION|PENDIENTE/.test(e)) return 'tramite';
        if (/REGISTR|CONCEDID|VIGENTE|OTORGAD|RENOVAD/.test(e)) return 'vigente';
        return 'desconocida';
    }

    /**
     * El titular sin su forma jurídica, venga como venga: el IMPI la escribe
     * sin puntos ("PHARMA GBC SAPI DE CV") y a veces la omite.
     */
    function claveTitular(t) {
        return normalizarMarca(t).replace(/(\s+(S A P I|SAPI|S A B|SAB|S A|SA|S DE R L|S DE RL|S R L|SRL|S C|SC|A C|AC|S P R|SPR|DE C V|DE CV|DE R L|DE RL|DE R I|DE RI|DE C|CV|SDAD|LTDA|INC|LLC|LTD|CORP|CO|GMBH|AG|SL|SAS|BV|NV|PLC))+$/g, '').trim();
    }

    function mismoTitular(solicitante, titulares) {
        const s = normalizarMarca(solicitante);
        if (!s || s.length < 4) return false;
        return (titulares || []).some(t => {
            const n = normalizarMarca(t);
            return n && (n === s || n.includes(s) || s.includes(n) && n.length >= 6);
        });
    }

    // ---- Lo que responde cada fuente, en una forma común ----

    function lista(v) { return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]); }

    function numeros(v) {
        return lista(v).flatMap(x => String(x).split(/[^0-9]+/)).map(Number).filter(n => n >= 1 && n <= 45);
    }

    function desdeMARCia(r, claseConsultada) {
        const clases = numeros(r.classes);
        if (claseConsultada && !clases.includes(Number(claseConsultada))) clases.push(Number(claseConsultada));
        return {
            fuentes: ['MARCia'],
            id: r.id || null,
            titulo: String(r.title || '').trim(),
            expediente: r.applicationNumber ? String(r.applicationNumber) : '',
            registro: r.registrationNumber ? String(r.registrationNumber) : '',
            estado: r.status || '',
            titulares: lista(r.owners).map(t => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean),
            clases,
            tipoSolicitud: r.appType || '',
            solicitud: (r.dates && r.dates.application) || '',
            vencimiento: (r.dates && (r.dates.expiry || r.dates.cancellation)) || '',
            imagen: typeof r.images === 'string' ? r.images : ''
        };
    }

    // Marcanet manda el texto de su HTML tal cual: «LUNA &amp; FRIDA».
    function sinEntidades(t) {
        return String(t == null ? '' : t)
            .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
            .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
            .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    }

    // Marcanet no tiene nombres de columna fijos: se buscan como los busca la
    // pestaña de Marcanet.
    function campoMarcanet(r, nombres) {
        for (const n of nombres) if (r[n]) return sinEntidades(r[n]).trim();
        return '';
    }

    // La clase es la que trae la fila: aunque se le pida una, la fonética de
    // Marcanet responde con marcas de cualquier clase.
    function desdeMarcanet(r) {
        const llaves = Object.keys(r).filter(k => !k.startsWith('_'));
        const clases = numeros(campoMarcanet(r, ['Clase', 'clase', 'Clase Niza']));
        const enlace = Object.keys(r).filter(k => k.startsWith('_link')).map(k => r[k]).find(v => /detalleExpediente/.test(v)) || '';
        return {
            enlace,
            fuentes: ['Marcanet'],
            id: null,
            titulo: campoMarcanet(r, ['Denominación', 'denominacion', 'Denominacion', 'Marca', 'marca']) || sinEntidades(r[llaves[0]] || '').trim(),
            expediente: campoMarcanet(r, ['Expediente', 'No. Expediente', 'expediente', 'No. de Expediente']),
            registro: campoMarcanet(r, ['Registro', 'No. Registro', 'registro', 'No. de Registro']),
            estado: campoMarcanet(r, ['Situación', 'Situacion', 'Status', 'Estado', 'situacion', 'Estatus']),
            titulares: lista(campoMarcanet(r, ['Titular', 'titular', 'Nombre'])).filter(Boolean),
            clases,
            tipoSolicitud: campoMarcanet(r, ['Tipo', 'Tipo de Marca', 'TM']),
            solicitud: campoMarcanet(r, ['Fecha de presentación', 'Fecha Presentación', 'Fecha']),
            vencimiento: campoMarcanet(r, ['Vigencia', 'Fecha de vigencia']),
            imagen: ''
        };
    }

    /**
     * La ficha de un expediente en Marcanet (detalleExpedienteParcial): de ahí
     * salen el estatus y la vigencia que la búsqueda no trae. Sus campos
     * llegan con nombres irregulares, así que lo que no tiene nombre fijo se
     * busca en todo el texto.
     */
    function leerDetalleMarcanet(det, ahora) {
        if (!det) return null;
        const campos = Object.keys(det).filter(k => !k.startsWith('_'));
        if (!det['Fecha de presentación'] && !det['Denominación']) return null;
        const texto = normalizarMarca(campos.map(k => k + ' ' + det[k]).join(' '));
        const vigencia = String(det['Fecha de vigencia'] || '').trim();
        const registro = String(det['Número de registro'] || '').replace(/\D/g, '');
        // Lo que ampara, clase por clase. La ficha no siempre trae todas: si
        // falta la que importa, mejor no mostrar otra en su lugar.
        const amparaPorClase = campos.filter(k => /^\d{1,2}\s*Edici/.test(k))
            .map(k => ({ clase: +k.match(/^\d{1,2}/)[0], texto: sinEntidades(det[k]).trim() }));
        const ampara = amparaPorClase.map(a => a.clase + ': ' + a.texto).join(' · ');
        let estado;
        if (/SOLICITUDES ABANDONADAS|ABANDONAD/.test(texto)) estado = 'ABANDONADA';
        else if (/NEGATIVA DE REGISTRO|NEGAD/.test(texto)) estado = 'NEGADA';
        else if (/DESISTID|DESISTIMIENTO/.test(texto)) estado = 'DESISTIDA';
        else if (/CADUCAD/.test(texto)) estado = 'CADUCADA';
        else if (registro && vigencia) {
            const fin = fechaIMPI(vigencia);
            estado = fin != null && fin < (ahora != null ? ahora : Date.now()) ? 'REGISTRADA, vigencia terminada el ' + vigencia : 'REGISTRADA, vigente hasta ' + vigencia;
        }
        else if (registro) estado = 'REGISTRADA';
        else estado = /OPOSICION/.test(texto) ? 'EN TRÁMITE, con oposición' : 'EN TRÁMITE';
        return { estado, vigencia, registro, ampara, amparaPorClase, presentacion: String(det['Fecha de presentación'] || '').trim() };
    }

    /**
     * La ficha de MARCia de un expediente (/marcia/view): la clase y lo que
     * ampara, clase por clase, y su historial de trámites y oficios. Es la
     * fuente buena para la clase: la búsqueda de Marcanet a veces muestra las
     * de toda una familia de solicitudes (LUNA PHARMA, exp. 3295484: Marcanet
     * dice 35, 36 y 43; su ficha, solo 35). Si no es del expediente pedido, nada.
     */
    function leerFichaMARCia(d, expediente) {
        const det = d && d.details;
        if (!det) return null;
        const g = det.generalInformation || {};
        const cifras = v => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
        const num = cifras(g.applicationNumber || (d.result && d.result.applicationNumber));
        if (expediente && num && num !== cifras(expediente)) return null;
        // La clase viene como número (35); por si llega "35, 43", cada una.
        const productos = (det.productsAndServices || [])
            .flatMap(p => numeros(p.classes).map(clase => ({ clase, texto: sinEntidades(p.goodsAndServices).trim() })));
        if (!productos.length) return null;
        const historial = (d.historyData && d.historyData.historyRecords) || [];
        const tramites = historial.map(h => ({ texto: String(h.description || '').trim(), fecha: String(h.startDate || '').trim() }));
        const oficios = historial.flatMap(h => ((h.details && h.details.officios) || [])
            .map(o => ({ texto: String(o.descriptionOfTheTrade || '').trim(), fecha: String(o.dateOfTheTrade || '').trim() })));
        return {
            id: String((d.result && d.result.id) || (det.trademark && det.trademark.id) || ''),
            clases: Array.from(new Set(productos.map(p => p.clase))).sort((a, b) => a - b),
            productos, tramites, oficios, estado: String((d.result && d.result.status) || '').trim()
        };
    }

    /** Lo que conviene saber de su trámite: anterioridades citadas, oposición. Solo informa. */
    function avisosDeFicha(f) {
        const ultimo = (lista, re) => lista.filter(x => re.test(normalizarMarca(x.texto)))
            .sort((x, y) => (fechaIMPI(x.fecha) || 0) - (fechaIMPI(y.fecha) || 0)).pop();
        const avisos = [];
        const cita = ultimo(f.oficios || [], /CITA ANTERIORIDAD/);
        if (cita) avisos.push('El IMPI le citó anterioridades' + (cita.fecha ? ' (oficio del ' + cita.fecha + ')' : ''));
        const oposicion = ultimo(f.tramites || [], /OPOSICION/);
        if (oposicion) avisos.push('Tiene una oposición' + (oposicion.fecha ? ' (presentada el ' + oposicion.fecha + ')' : ''));
        return avisos;
    }

    function desdeSIGA(ficha) {
        // Se prueban los nombres en orden: "Registro de Marca" es el número de
        // registro, no la denominación, aunque termine en "Marca".
        const dato = (...res) => {
            for (const re of res) {
                const d = (ficha.datos || []).find(x => re.test(normalizarMarca(x.descripcion)));
                if (d) return String(d.datoTxt || '').trim();
            }
            return '';
        };
        return {
            fichaId: ficha.fichaId,
            denominacion: dato(/^DENOMINACION/, /^(MARCA|SIGNO DISTINTIVO|SIGNO)$/),
            clases: numeros(dato(/CLASE/)),
            expediente: dato(/EXPEDIENTE|SOLICITUD/),
            registro: dato(/REGISTRO/),
            titular: dato(/TITULAR|SOLICITANTE/),
            gaceta: ficha.gaceta || '',
            seccion: ficha.seccion || '',
            ejemplar: ficha.ejemplar || '',
            fecha: ficha.fechaPuestaCirculacion || ''
        };
    }

    /** Lo que dice la sección de la Gaceta, en una palabra: "Renovada", "Abandonada"… */
    function etiquetaGaceta(seccion) {
        const s = normalizarMarca(seccion);
        if (/RENOVAD/.test(s)) return 'Renovada';
        if (/ABANDONAD/.test(s)) return 'Abandonada';
        if (/NEGAD/.test(s)) return 'Negada';
        if (/CADUC/.test(s)) return 'Caducidad';
        if (/NULIDAD/.test(s)) return 'Nulidad';
        if (/CANCELA/.test(s)) return 'Cancelación';
        if (/TRANSMISI|CESION/.test(s)) return 'Transmisión';
        if (/LICENCIA/.test(s)) return 'Licencia';
        if (/REGISTRADA/.test(s)) return 'Registrada';
        if (/SOLICITUD/.test(s)) return 'Solicitud publicada';
        return String(seccion || 'Publicación').trim();
    }

    /** "Registrada 09/04/2012 · Renovada 11/05/2022" */
    function historialTexto(a) {
        return (a.gaceta || []).map(g => g.etiqueta + (g.fecha ? ' ' + g.fecha : '')).join(' · ');
    }

    /**
     * Los nombres que vale la pena buscar en SIGA, que solo encuentra palabras
     * exactas: «lunafardo» no trae nada, «LUNFARDO» trae su registro, su
     * renovación y su abandono. Los de riesgo alto y medio, sin repetir y sin
     * la propia denominación (esa ya se buscó).
     */
    function nombresParaGaceta(rep, max) {
        const propia = normalizarMarca(rep.entrada.denominacion);
        const vistos = new Set([propia]);
        const nombres = [];
        for (const a of rep.antecedentes) {
            if (a.riesgo !== 'alto' && a.riesgo !== 'medio') continue;
            const n = normalizarMarca(a.titulo);
            if (!n || vistos.has(n)) continue;
            vistos.add(n);
            nombres.push(n);
        }
        return nombres.slice(0, max || 3);
    }

    /**
     * Una sola entrada por marca, aunque la hayan encontrado varias fuentes.
     * Se reconoce por su registro o por su expediente (basta uno: Marcanet a
     * veces trae solo el expediente) y, sin números, por denominación y clase.
     * Aun con el mismo número, dos denominaciones que no se parecen no se
     * juntan: un dato mal leído no debe esconder una marca.
     */
    function consolidar(antecedentes) {
        const entradas = [];
        const porNumero = new Map();
        const digitos = v => String(v || '').replace(/\D/g, '');
        const claveTitulo = a => 'T' + normalizarMarca(a.titulo) + '|' + a.clases.slice().sort((x, y) => x - y).join(',');
        const mismaMarca = (x, y) => compararMarcas(x.titulo, y.titulo).puntaje >= 80;
        for (const a of antecedentes) {
            if (!a.titulo) continue;
            const claves = [];
            if (digitos(a.registro)) claves.push('R' + digitos(a.registro));
            if (digitos(a.expediente)) claves.push('E' + digitos(a.expediente));
            if (!claves.length) claves.push(claveTitulo(a));
            let previo = null;
            for (const k of claves) {
                const candidato = porNumero.get(k);
                if (candidato && mismaMarca(candidato, a)) { previo = candidato; break; }
            }
            if (!previo) {
                previo = { ...a, clases: a.clases.slice(), fuentes: a.fuentes.slice(), titulares: a.titulares.slice() };
                entradas.push(previo);
            } else {
                for (const c of a.clases) if (!previo.clases.includes(c)) previo.clases.push(c);
                for (const f of a.fuentes) if (!previo.fuentes.includes(f)) previo.fuentes.push(f);
                for (const t of a.titulares) if (!previo.titulares.some(x => claveTitular(x) === claveTitular(t))) previo.titulares.push(t);
                for (const campo of ['id', 'expediente', 'registro', 'estado', 'tipoSolicitud', 'solicitud', 'vencimiento', 'imagen', 'enlace']) {
                    if (!previo[campo] && a[campo]) previo[campo] = a[campo];
                }
            }
            for (const k of claves) if (!porNumero.has(k)) porNumero.set(k, previo);
            if (digitos(previo.registro) && !porNumero.has('R' + digitos(previo.registro))) porNumero.set('R' + digitos(previo.registro), previo);
            if (digitos(previo.expediente) && !porNumero.has('E' + digitos(previo.expediente))) porNumero.set('E' + digitos(previo.expediente), previo);
        }
        for (const a of entradas) a.clases.sort((x, y) => x - y);
        return entradas;
    }

    // ---- El riesgo de cada antecedente ----

    /**
     * alto: puede impedir el registro; medio: hay que revisarlo; bajo: no
     * debería estorbar; propia: es del mismo solicitante.
     */
    function evaluarAntecedente(ant, entrada, ahora) {
        const sim = compararMarcas(entrada.denominacion, ant.titulo, entrada.clases);
        const relacion = relacionClases(entrada.clases, ant.clases);
        const situacion = situacionDe(ant.estado);
        const notoria = /NOTORI|FAMOS/.test(normalizarMarca(ant.tipoSolicitud));
        const venc = fechaIMPI(ant.vencimiento);
        const SEIS_MESES = 183 * 864e5;
        // La vigencia de una lista puede ser vieja: si la Gaceta publicó una
        // renovación cerca o después de esa fecha, ya no está vencida. La de la
        // ficha de Marcanet sí se actualiza al renovar.
        const renovacion = (ant.gaceta || []).filter(g => g.etiqueta === 'Renovada' && fechaIMPI(g.fecha) != null).pop() || null;
        const renovadaEnGaceta = !ant.conDetalle && !!renovacion && venc != null && fechaIMPI(renovacion.fecha) >= venc - SEIS_MESES;
        const vencida = situacion !== 'inactiva' && venc != null && venc < ahora && !renovadaEnGaceta;
        // Seis meses de gracia para renovar; después, el registro ya no estorba.
        // Se da por hecho con la ficha de Marcanet, o con la Gaceta cuando ya
        // se vio su historial y no publica la renovación.
        const conGaceta = !!(ant.gaceta && ant.gaceta.length);
        const sinRenovar = vencida && (!!ant.conDetalle || conGaceta) && ahora - venc > SEIS_MESES;
        const motivos = [];
        let riesgo = 'bajo';

        if (entrada.solicitante && mismoTitular(entrada.solicitante, ant.titulares)) {
            return { ...ant, similitud: sim, relacion, situacion, riesgo: 'propia', motivos: ['Es del mismo solicitante: no es un obstáculo'] };
        }

        if (situacion === 'inactiva') {
            riesgo = 'bajo';
            motivos.push('Ya no está vigente (' + (ant.estado || 'sin estatus') + '): en principio no impide el registro');
        } else if (sinRenovar) {
            riesgo = 'bajo';
            motivos.push(ant.conDetalle
                ? 'Su vigencia terminó el ' + ant.vencimiento + ' y no aparece renovada: en principio no impide el registro'
                : 'Su vigencia terminó el ' + ant.vencimiento + ' y la Gaceta no publica su renovación: en principio no impide el registro (confírmalo en Marcanet)');
        } else if (notoria && sim.puntaje >= 70) {
            riesgo = 'alto';
            motivos.push('Marca notoria o famosa: su protección alcanza todas las clases');
        } else if (relacion === 'misma') {
            riesgo = sim.puntaje >= 80 ? 'alto' : sim.puntaje >= 65 ? 'medio' : 'bajo';
            motivos.push('En la misma clase');
        } else if (relacion === 'relacionada') {
            riesgo = sim.puntaje >= 90 ? 'alto' : sim.puntaje >= 75 ? 'medio' : 'bajo';
            motivos.push('En una clase relacionada (' + ant.clases.join(', ') + ')');
        } else if (relacion === 'desconocida') {
            riesgo = sim.puntaje >= 90 ? 'medio' : 'bajo';
            motivos.push('No se sabe su clase: confírmala en el detalle');
        } else {
            riesgo = 'bajo';
            motivos.push(sim.puntaje >= 95 ? 'Igual, pero en otra clase: por sí sola no impide el registro' : 'En otra clase');
        }
        if (riesgo !== 'bajo' || sim.puntaje >= 75) motivos.unshift(sim.detalle + ' (' + sim.puntaje + '%)');
        if (situacion === 'tramite') motivos.push('Está en trámite: si se concede, tendrá prioridad sobre la tuya');
        if (situacion === 'desconocida' && riesgo !== 'bajo') motivos.push('Sin estatus en la fuente: se trató como vigente');
        if (vencida && !sinRenovar) motivos.push('Su vigencia reportada terminó el ' + ant.vencimiento + ': confirma si se renovó (hay seis meses de gracia)');
        if (renovadaEnGaceta) motivos.push('Se renovó (Gaceta del ' + renovacion.fecha + ')');
        if (ant.clasesAntes) motivos.push('Clase según su ficha en MARCia (la búsqueda' + (ant.fuentes.includes('MARCia') ? '' : ' de Marcanet') + ' mostraba ' + ant.clasesAntes + ')');
        for (const aviso of ant.avisos || []) motivos.push(aviso);
        // Lo que se dedujo de la Gaceta, sin ficha de Marcanet, conviene confirmarlo.
        const deduccion = !ant.conDetalle && (ant.segunGaceta || (sinRenovar && conGaceta) || renovadaEnGaceta);
        return { ...ant, similitud: sim, relacion, situacion, notoria, vencida: vencida && !sinRenovar, riesgo, motivos, deduccion };
    }

    // ---- Lo que se ve en la propia denominación ----

    function contieneFrase(normalizado, frase) {
        return (' ' + normalizado + ' ').includes(' ' + frase + ' ');
    }

    /**
     * Observaciones sobre la denominación en sí, antes de mirar a terceros:
     * si describe los productos, si lleva nombres geográficos u oficiales,
     * si es demasiado corta. Son las prohibiciones del art. 173 de la LFPPI.
     */
    function observacionesRegistrabilidad(entrada) {
        const n = normalizarMarca(entrada.denominacion);
        const ws = palabras(n).filter(w => !PALABRAS_VACIAS.has(w));
        const obs = [];
        const desc = descriptivasDe(entrada.clases);
        const deProductos = new Set(palabras(normalizarMarca(entrada.productos)).filter(w => w.length >= 4));
        const descriptivas = ws.filter(w => desc.has(w) || deProductos.has(w));
        const laudatorias = ws.filter(w => LAUDATORIAS.includes(w));
        const distintivas = palabrasDistintivas(entrada.denominacion, entrada.clases, entrada.productos);

        if (!ws.length) {
            obs.push({ nivel: 'alto', texto: 'La denominación está vacía o solo tiene signos.' });
            return obs;
        }
        const geograficas = ws.filter(w => palabrasGeograficas(n).has(w));
        if (!distintivas.length && (descriptivas.length || laudatorias.length || geograficas.length)) {
            obs.push({ nivel: 'alto', texto: 'Se forma solo con palabras descriptivas, de uso común, elogiosas o geográficas para estos productos o servicios (' +
                descriptivas.concat(laudatorias, geograficas).join(', ') + '). Sin un elemento distintivo el IMPI suele negarla (art. 173 LFPPI).' });
        } else if (descriptivas.length) {
            obs.push({ nivel: 'medio', texto: '«' + descriptivas.join('», «') + '» describe lo que se ofrece: no aporta distintividad y nadie puede usarla en exclusiva. La protección recaerá en «' +
                distintivas.join(' ') + '».' });
        }
        if (laudatorias.length && distintivas.length) {
            obs.push({ nivel: 'info', texto: '«' + laudatorias.join('», «') + '» es un elogio: se puede usar, pero no se protege por sí solo.' });
        }
        const geo = GEOGRAFICOS.filter(g => contieneFrase(n, g));
        if (geo.length) {
            obs.push({ nivel: 'medio', texto: 'Lleva un nombre geográfico (' + geo.join(', ') + '). Es registrable si no indica la procedencia de los productos ni engaña sobre ella; si la indica, el IMPI la niega (art. 173 LFPPI).' });
        }
        const oficiales = OFICIALES.filter(g => contieneFrase(n, g));
        if (oficiales.length) {
            obs.push({ nivel: 'alto', texto: 'Reproduce nombres o siglas oficiales (' + oficiales.join(', ') + '). Sin autorización es causa de negativa (art. 173 LFPPI).' });
        }
        const semi = SEMIOFICIALES.filter(g => contieneFrase(n, g));
        if (semi.length && !oficiales.length) {
            obs.push({ nivel: 'info', texto: '«' + semi.join('», «') + '» puede sugerir un carácter oficial; evita que la marca dé esa impresión.' });
        }
        const compacta = n.replace(/ /g, '');
        if (compacta.length <= 2 || /^\d+$/.test(compacta)) {
            obs.push({ nivel: 'medio', texto: 'Letras o números aislados tienen poca distintividad; conviene acompañarlos de otros elementos o de un diseño.' });
        }
        if (entrada.tipo && entrada.tipo !== 'nominativa') {
            obs.push({ nivel: 'info', texto: 'El estudio compara solo la parte en palabras. Para el diseño haz también la búsqueda por imagen en MARCia.' });
        }
        return obs;
    }

    // ---- El dictamen ----

    /**
     * Una fila por marca y titular: el mismo titular suele pedir la misma
     * denominación en varios expedientes, uno por clase (LUNA PHARMA: 4). La
     * familia toma riesgo, estatus y motivos de su expediente más grave y
     * junta clases y fuentes; cada expediente queda en `miembros`.
     */
    function agruparMarcas(antecedentes) {
        const familias = [];
        const porClave = new Map();
        for (const a of antecedentes) {
            const titular = claveTitular((a.titulares || [])[0] || '');
            const clave = titular ? normalizarMarca(a.titulo) + '|' + titular : 'solo:' + familias.length;
            let f = porClave.get(clave);
            if (!f) { f = []; porClave.set(clave, f); familias.push(f); }
            f.push(a);
        }
        const orden = (x, y) => RIESGOS.indexOf(x.riesgo) - RIESGOS.indexOf(y.riesgo) || y.similitud.puntaje - x.similitud.puntaje;
        return familias.map(miembros => {
            miembros = miembros.slice().sort(orden);
            const union = (campo) => Array.from(new Set(miembros.flatMap(m => m[campo] || [])));
            return { ...miembros[0], miembros, clases: union('clases').sort((x, y) => x - y), fuentes: union('fuentes'),
                descartado: miembros.every(m => m.descartado) };
        }).sort((x, y) => orden(x, y) || x.titulo.localeCompare(y.titulo, 'es'));
    }

    /** "reg. 1261657" o "exp. 3295484" */
    function numeroDe(a) {
        return a.registro ? 'reg. ' + a.registro : a.expediente ? 'exp. ' + a.expediente : '';
    }

    /** «LUNA PHARMA» (exp. 3295486, exp. 3295484 y 2 más); con `cuales`, solo esos expedientes. */
    function nombreDe(a, cuales) {
        const nums = (a.miembros || [a]).filter(m => !cuales || cuales(m)).map(numeroDe).filter(Boolean);
        return '«' + a.titulo + '»' + (nums.length ? ' (' + nums.slice(0, 2).join(', ') + (nums.length > 2 ? ' y ' + (nums.length - 2) + ' más' : '') + ')' : '');
    }

    /**
     * Los expedientes de riesgo alto o medio cuya ficha de MARCia falta. El id
     * es "RM" + año de presentación + expediente a 8 cifras; si no viene de
     * MARCia, se arma con la fecha de la ficha de Marcanet.
     */
    function aConsultarMARCia(rep, max, ya) {
        ya = ya || {};
        const res = [];
        const vistos = new Set();
        for (const a of rep.antecedentes) {
            if (a.riesgo !== 'alto' && a.riesgo !== 'medio') continue;
            const expediente = String(a.expediente || '').replace(/\D/g, '');
            if (!expediente || vistos.has(expediente) || ya[expediente]) continue;
            vistos.add(expediente);
            const ids = /^RM\d{12}$/.test(a.id || '') ? [a.id] : [];
            const fecha = fechaIMPI(a.solicitud);
            if (fecha != null) {
                // MARCia y Marcanet registran la fecha con horas de diferencia:
                // junto al año nuevo, el id puede llevar el año de al lado.
                const d = new Date(fecha), anio = d.getFullYear();
                const anios = [anio];
                if (d.getMonth() === 0 && d.getDate() <= 2) anios.push(anio - 1);
                if (d.getMonth() === 11 && d.getDate() >= 30) anios.push(anio + 1);
                for (const y of anios) {
                    const id = 'RM' + y + expediente.padStart(8, '0');
                    if (!ids.includes(id)) ids.push(id);
                }
            }
            if (ids.length) res.push({ expediente, ids });
            if (res.length >= (max || 8)) break;
        }
        return res;
    }

    /** "SIGA no respondió y MARCia respondió a medias" */
    function queFalto(fuentes) {
        const nada = fuentes.filter(f => !f.ok && !f.parcial).map(f => f.nombre);
        const medias = fuentes.filter(f => f.parcial).map(f => f.nombre);
        const partes = [];
        if (nada.length) partes.push(nada.join(' y ') + ' no respondi' + (nada.length === 1 ? 'ó' : 'eron'));
        if (medias.length) partes.push(medias.join(' y ') + ' respondi' + (medias.length === 1 ? 'ó' : 'eron') + ' a medias');
        return partes.join(' y ');
    }

    /**
     * Junta lo que respondió cada fuente y arma el reporte completo.
     * entrada: { denominacion, clases, tipo, productos, solicitante }
     * crudo: { marcia: [{ clase, resultados }], marcanet: [{ clase, resultados }],
     *          siga: [fichas], fuentes: { MARCia: { ok, total, error }, ... },
     *          detalles: { expediente: ficha de Marcanet }, fichas: { pedidas, leidas },
     *          fichasMARCia: { expediente: leerFichaMARCia(...) }, fichasM: { pedidas, leidas } }
     */
    function analizar(entrada, crudo, ahora) {
        ahora = ahora != null ? ahora : Date.now();
        entrada = { ...entrada, clases: (entrada.clases || []).map(Number).filter(n => n >= 1 && n <= 45) };
        const brutos = [];
        for (const lote of crudo.marcia || []) for (const r of lote.resultados || []) brutos.push(desdeMARCia(r, lote.clase));
        for (const lote of crudo.marcanet || []) for (const r of lote.resultados || []) brutos.push(desdeMarcanet(r));

        const detalles = crudo.detalles || {};
        const fichasMARCia = crudo.fichasMARCia || {};
        const digitos = v => String(v || '').replace(/\D/g, '');
        const historial = (crudo.sigaHistorial || []).map(desdeSIGA);
        const usadas = new Set();
        const clasesQueImportan = entrada.clases.concat(clasesRelacionadas(entrada.clases));
        const antecedentes = consolidar(brutos).map(a => {
            const d = leerDetalleMarcanet(detalles[String(a.expediente || '').replace(/\D/g, '')], ahora);
            if (!d) return a;
            // La ficha de Marcanet manda sobre el estatus de la lista: MARCia
            // puede seguir diciendo "en trámite" de una solicitud abandonada.
            // Lo que ampara, solo en las clases del estudio y sus relacionadas.
            const ampara = d.amparaPorClase.filter(x => clasesQueImportan.includes(x.clase)).map(x => x.clase + ': ' + x.texto).join(' · ');
            return { ...a, estado: d.estado, vencimiento: d.vigencia || a.vencimiento, registro: a.registro || d.registro, ampara, conDetalle: true,
                solicitud: a.solicitud || d.presentacion };
        }).map(a => {
            // La clase y lo que ampara, de su ficha de MARCia (la de la búsqueda
            // de Marcanet puede ser la de toda una familia de solicitudes).
            const f = fichasMARCia[digitos(a.expediente)];
            if (!f) return a;
            const antes = a.clases.slice().sort((x, y) => x - y).join(', ');
            const ampara = f.productos.filter(p => clasesQueImportan.includes(p.clase)).map(p => p.clase + ': ' + p.texto).join(' · ');
            // Su estatus solo llena el hueco: el de la ficha de Marcanet es más fino.
            return { ...a, id: a.id || f.id || null, estado: a.estado || f.estado, clases: f.clases.slice(),
                clasesAntes: antes && antes !== f.clases.join(', ') ? antes : '',
                ampara: ampara || (f.productos.some(p => clasesQueImportan.includes(p.clase)) ? a.ampara : ''), avisos: avisosDeFicha(f), conFichaMARCia: true };
        }).map(a => {
            // Lo que SIGA publicó de los antecedentes principales (se buscaron
            // por su nombre): se pega a cada uno por su expediente o su registro.
            const exp = digitos(a.expediente), reg = digitos(a.registro);
            const suyas = historial.filter(p => (exp && digitos(p.expediente) === exp) || (reg && digitos(p.registro) === reg));
            if (!suyas.length) return a;
            for (const p of suyas) usadas.add(p.fichaId);
            const gaceta = suyas.filter((p, i) => suyas.findIndex(q => q.fichaId === p.fichaId) === i)
                .map(p => ({ etiqueta: etiquetaGaceta(p.seccion), fecha: p.fecha, seccion: p.seccion, gaceta: p.gaceta }))
                .sort((x, y) => (fechaIMPI(x.fecha) || 0) - (fechaIMPI(y.fecha) || 0));
            // Sin ficha de Marcanet, la Gaceta corrige el estatus viejo de las
            // listas: una solicitud abandonada o negada ya no estorba, aunque
            // MARCia la siga mostrando "en trámite".
            const fin = !a.conDetalle && gaceta.filter(g => g.etiqueta === 'Abandonada' || g.etiqueta === 'Negada').pop();
            return fin ? { ...a, gaceta, estado: fin.etiqueta.toUpperCase() + ' (Gaceta del ' + fin.fecha + ')', segunGaceta: true } : { ...a, gaceta };
        }).map(a => evaluarAntecedente(a, entrada, ahora))
            // Lo que no se parece (menos de 50%) y no estorba es ruido de las
            // fuentes: no cuenta ni se muestra, solo va en el CSV.
            .map(a => ({ ...a, descartado: a.riesgo === 'bajo' && a.similitud.tipo === 'distinta' }))
            .sort((a, b) => RIESGOS.indexOf(a.riesgo) - RIESGOS.indexOf(b.riesgo) || b.similitud.puntaje - a.similitud.puntaje ||
                a.titulo.localeCompare(b.titulo, 'es'));


        // Las publicaciones parecidas que no son de ningún antecedente: una
        // solicitud reciente puede estar en la Gaceta antes que en MARCia.
        const sueltas = historial.filter(p => !usadas.has(p.fichaId));
        const publicaciones = (crudo.siga || []).map(desdeSIGA).concat(sueltas)
            .filter((p, i, todas) => p.fichaId == null || todas.findIndex(q => q.fichaId === p.fichaId) === i)
            .map(p => ({
                ...p, similitud: compararMarcas(entrada.denominacion, p.denominacion, entrada.clases),
                relacion: relacionClases(entrada.clases, p.clases)
            })).filter(p => p.denominacion && p.similitud.puntaje >= 60)
            .sort((a, b) => b.similitud.puntaje - a.similitud.puntaje);

        const observaciones = observacionesRegistrabilidad(entrada);
        // Se cuentan marcas (una por denominación y titular), no expedientes.
        const marcas = agruparMarcas(antecedentes);
        const cuenta = r => marcas.filter(a => a.riesgo === r && !a.descartado).length;
        const conteo = { alto: cuenta('alto'), medio: cuenta('medio'), bajo: cuenta('bajo'), propia: cuenta('propia'),
            descartados: marcas.filter(a => a.descartado).length, total: marcas.length, expedientes: antecedentes.length };
        const fuentes = Object.entries(crudo.fuentes || {}).map(([nombre, f]) => ({ nombre, ok: !!f.ok, parcial: !!f.parcial, total: f.total || 0, error: f.error || '' }));
        const respondieron = fuentes.filter(f => f.ok || f.parcial);
        const fallaron = fuentes.filter(f => !f.ok);
        const obsAlto = observaciones.some(o => o.nivel === 'alto');
        const obsMedio = observaciones.some(o => o.nivel === 'medio');

        let nivel, titulo, resumen;
        if (!respondieron.length) {
            nivel = 'incompleta';
            titulo = 'No se pudo concluir';
            resumen = 'Ninguna fuente del IMPI respondió. Repite el estudio en unos minutos.';
        } else if (conteo.alto || obsAlto) {
            nivel = 'baja';
            titulo = 'Viabilidad baja';
            resumen = conteo.alto
                ? `Hay ${conteo.alto} antecedente${conteo.alto === 1 ? '' : 's'} que puede${conteo.alto === 1 ? '' : 'n'} impedir el registro en las clases solicitadas.`
                : 'La denominación tiene un problema de registrabilidad propio, aunque no aparezcan marcas en conflicto.';
        } else if (conteo.medio || obsMedio) {
            nivel = 'media';
            titulo = 'Viabilidad media';
            resumen = conteo.medio
                ? `Registrable con reservas: hay ${conteo.medio} antecedente${conteo.medio === 1 ? '' : 's'} que conviene revisar antes de presentar.`
                : 'Registrable con reservas: revisa las observaciones sobre la denominación.';
        } else {
            nivel = 'alta';
            titulo = 'Viabilidad alta';
            resumen = 'No se encontraron antecedentes que impidan el registro en las clases solicitadas.';
        }
        const parcial = fallaron.length > 0 && respondieron.length > 0;
        if (parcial) resumen += ' Ojo: ' + queFalto(fuentes) + '; el resultado es parcial.';

        const reporte = {
            fecha: new Date(ahora).toISOString(),
            entrada,
            relacionadas: clasesRelacionadas(entrada.clases),
            distintivas: palabrasDistintivas(entrada.denominacion, entrada.clases, entrada.productos),
            dictamen: { nivel, titulo, resumen, parcial },
            fichas: crudo.fichas || null,
            fichasMARCia: crudo.fichasM || null,
            conteo, fuentes, observaciones, antecedentes, publicaciones,
            // Todo lo que SIGA devolvió, como punto de partida si se vigila la
            // denominación: lo ya visto no debe llegar luego como novedad.
            fichasSIGA: (crudo.siga || []).map(f => f.fichaId).filter(x => x != null).sort()
        };
        reporte.recomendaciones = recomendaciones(reporte);
        return reporte;
    }

    /**
     * Los antecedentes cuyo estatus vale la pena confirmar en la ficha de
     * Marcanet: los de riesgo alto o medio que tienen expediente. Primero los
     * más graves, y no más de `max` para no hacer esperar de más.
     */
    function aConsultarDetalle(rep, max) {
        return rep.antecedentes
            .filter(a => (a.riesgo === 'alto' || a.riesgo === 'medio') && !a.conDetalle && /\d/.test(a.expediente || ''))
            .slice(0, max || 8)
            .map(a => {
                const expediente = String(a.expediente).replace(/\D/g, '');
                return { expediente, enlace: a.enlace || '/marcanet/vistas/common/busquedas/detalleExpedienteParcial.pgi?tipo=1&anio=1985&expediente=' + expediente };
            });
    }

    function recomendaciones(rep) {
        const r = [];
        // Por marca y titular: los expedientes de una misma familia se nombran juntos.
        const marcas = agruparMarcas(rep.antecedentes);
        const altos = marcas.filter(a => a.riesgo === 'alto');
        const medios = marcas.filter(a => a.riesgo === 'medio');
        const nombre = a => nombreDe(a);
        const graves = m => m.riesgo === 'alto' || m.riesgo === 'medio';
        if (rep.dictamen.nivel === 'incompleta') {
            r.push('Repite el estudio cuando respondan las fuentes del IMPI; sin ellas no hay dictamen.');
            return r;
        }
        if (altos.some(a => a.relacion === 'misma')) {
            r.push('Cambia la denominación o agrégale un elemento distintivo fuerte: las coincidencias en la misma clase son la causa más común de negativa.');
        }
        // Con uno o dos obstáculos identificados, hablar con su titular es una
        // salida real; con muchos, no.
        const bloqueos = altos.filter(a => !a.notoria && a.situacion !== 'inactiva');
        if (bloqueos.length && bloqueos.length <= 2 && bloqueos.length === altos.length) {
            const titulares = bloqueos.map(a => (a.titulares[0] ? a.titulares[0] + ', titular de ' : 'el titular de ') + nombre(a));
            r.push('Si no quieres cambiar la denominación, otra vía es negociar con ' + titulares.join(', y con ') +
                ', una carta de consentimiento para que las marcas coexistan. Valora si procede en tu caso.');
        }
        if (altos.some(a => a.notoria)) {
            r.push('Evita cualquier parecido con ' + altos.filter(a => a.notoria).map(nombre).join(', ') + ': las marcas notorias se protegen en todas las clases.');
        }
        const vencidas = altos.concat(medios).filter(a => a.miembros.some(m => graves(m) && m.vencida));
        if (vencidas.length) {
            r.push('Revisa en Marcanet si se renovó ' + vencidas.slice(0, 3).map(a => nombreDe(a, m => graves(m) && m.vencida)).join(', ') + ': si no, puede quedar libre.');
        }
        const vigentes = altos.filter(a => a.situacion === 'vigente');
        if (vigentes.length) {
            const renovada = a => ((a.gaceta || []).filter(g => g.etiqueta === 'Renovada' && g.fecha).pop() || {}).fecha;
            const nota = vigentes.length === 1
                ? (renovada(vigentes[0]) ? ' Toma en cuenta que su última renovación se publicó en la Gaceta el ' + renovada(vigentes[0]) + '.' : '')
                : (vigentes.some(renovada) ? ' Toma en cuenta que ' + vigentes.filter(renovada).map(a => nombre(a) + ' se renovó (Gaceta del ' + renovada(a) + ')').join('; ') + '.' : '');
            r.push('Si ' + vigentes.slice(0, 3).map(nombre).join(', ') + ' no se ha usado en los últimos tres años, puede pedirse su caducidad por falta de uso y despejar el camino.' + nota);
        }
        if (altos.concat(medios).some(a => a.relacion === 'relacionada')) {
            r.push('Delimita con precisión los productos o servicios de la solicitud para alejarte de las clases relacionadas donde hay antecedentes.');
        }
        if (rep.observaciones.some(o => o.nivel !== 'info' && /describe|descriptivas/.test(o.texto))) {
            r.push('Refuerza la parte distintiva de la marca; la parte descriptiva no se protege.');
        }
        if (rep.entrada.tipo && rep.entrada.tipo !== 'nominativa') {
            r.push('Haz la búsqueda figurativa (por imagen) en MARCia para el diseño de la marca.');
        }
        if (rep.dictamen.parcial) {
            const falto = queFalto(rep.fuentes);
            r.push(falto.charAt(0).toUpperCase() + falto.slice(1) +
                ': usa «Reintentar lo que faltó» en este reporte (no cuenta como otro estudio) o repite el estudio más tarde.');
        }
        if (rep.publicaciones.length) {
            r.push('Revisa las publicaciones en Gaceta de la lista: una solicitud publicada hace menos de un mes todavía admite oposición.');
        }
        // Lo que el estudio ya confirmó en la ficha de Marcanet no hace falta
        // volver a pedirlo; solo lo que se quedó sin confirmar.
        const marcados = altos.concat(medios);
        const sinFicha = marcados.filter(a => a.miembros.some(m => graves(m) && !m.conDetalle));
        const deducidos = marcas.filter(a => !graves(a) && !a.descartado && a.miembros.some(m => m.deduccion));
        if (deducidos.length) {
            r.push('Sin la ficha de Marcanet, el estatus de ' + deducidos.slice(0, 4).map(a => nombreDe(a, m => m.deduccion)).join(', ') +
                ' se dedujo de la Gaceta: confírmalo en Marcanet antes de presentar.');
        }
        if (sinFicha.length) {
            r.push('Antes de presentar, confirma en Marcanet el estatus de ' + sinFicha.slice(0, 4).map(a => nombreDe(a, m => graves(m) && !m.conDetalle)).join(', ') + '.');
        } else if (marcados.length) {
            const d = new Date(rep.fecha);
            const dia = isNaN(d.getTime()) ? '' : String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
            r.push('El estatus de ' + (marcados.length === 1 ? 'ese antecedente' : 'esos antecedentes') + ' se confirmó en su ficha de Marcanet' +
                (dia ? ' el ' + dia : '') + '. Si pasan semanas antes de presentar, repite el estudio.');
        }
        r.push('Ya presentada, vigila la Gaceta: hay un mes para que terceros se opongan desde que se publica tu solicitud.');
        return r;
    }

    /** El reporte en texto, para pegar en un correo o en una nota. */
    function resumenTexto(rep, formatoFecha) {
        const f = formatoFecha || (iso => iso.slice(0, 10));
        const e = rep.entrada;
        const lineas = [
            'ESTUDIO DE VIABILIDAD DE MARCA',
            'Denominación: ' + e.denominacion,
            'Clases: ' + e.clases.join(', ') + (rep.relacionadas.length ? ' (se revisaron también las relacionadas: ' + rep.relacionadas.join(', ') + ')' : ''),
            'Fecha: ' + f(rep.fecha),
            '',
            'DICTAMEN: ' + rep.dictamen.titulo.toUpperCase(),
            rep.dictamen.resumen,
            'Antecedentes: ' + rep.conteo.alto + ' de riesgo alto, ' + rep.conteo.medio + ' medio, ' + rep.conteo.bajo + ' bajo' +
                (rep.conteo.propia ? ', ' + rep.conteo.propia + ' del mismo solicitante' : '') +
                (rep.conteo.descartados ? ' (y ' + rep.conteo.descartados + ' resultado' + (rep.conteo.descartados === 1 ? '' : 's') + ' que no se parece' + (rep.conteo.descartados === 1 ? '' : 'n') + ', descartado' + (rep.conteo.descartados === 1 ? '' : 's') + ')' : '') + '.' +
                (rep.conteo.expedientes > rep.conteo.total ? ' Se cuenta una vez cada marca de un mismo titular; son ' + rep.conteo.expedientes + ' expedientes.' : ''),
            'Fuentes: ' + rep.fuentes.map(x => x.nombre + (x.ok ? ' (' + x.total + ')' : x.parcial ? ' (' + x.total + ', a medias: ' + x.error + ')' :
                ' (sin respuesta' + (x.error ? ': ' + x.error : '') + ')')).join(', ') + '.' +
                (rep.fichas && rep.fichas.pedidas ? ' Fichas de Marcanet: ' + rep.fichas.leidas + ' de ' + rep.fichas.pedidas + '.' : '') +
                (rep.fichasMARCia && rep.fichasMARCia.pedidas ? ' Fichas de MARCia: ' + rep.fichasMARCia.leidas + ' de ' + rep.fichasMARCia.pedidas + '.' : '')
        ];
        if (rep.observaciones.length) {
            lineas.push('', 'OBSERVACIONES');
            for (const o of rep.observaciones) lineas.push('• ' + o.texto);
        }
        const relevantes = agruparMarcas(rep.antecedentes).filter(a => a.riesgo === 'alto' || a.riesgo === 'medio');
        if (relevantes.length) {
            lineas.push('', 'ANTECEDENTES A REVISAR');
            for (const a of relevantes.slice(0, 15)) {
                const familia = a.miembros.length > 1
                    ? ' — ' + a.miembros.length + ' expedientes' + (a.titulares.length ? ' de ' + a.titulares[0] : '') + ': ' +
                      a.miembros.map(m => numeroDe(m) + ' (clase ' + (m.clases.join(', ') || '¿?') + (m.estado ? ', ' + m.estado : '') + ', riesgo ' + m.riesgo + ')').join('; ') + '.'
                    : ' — clase ' + (a.clases.join(', ') || '¿?') + (numeroDe(a) ? ', ' + numeroDe(a) : '') +
                      (a.estado ? ', ' + a.estado : '') + (a.titulares.length ? ', ' + a.titulares[0] : '') + '.';
                lineas.push('• [' + a.riesgo.toUpperCase() + '] ' + a.titulo + familia + ' ' + a.motivos.join('; ') + '.' +
                    (a.ampara ? ' Ampara: ' + a.ampara.replace(/\.+$/, '') + '.' : '') +
                    (a.gaceta && a.gaceta.length ? ' En Gaceta: ' + historialTexto(a) + '.' : ''));
            }
        }
        lineas.push('', 'RECOMENDACIONES');
        for (const r of rep.recomendaciones) lineas.push('• ' + r);
        lineas.push('', 'AVISO: ' + AVISO_VIABILIDAD);
        return lineas.join('\n');
    }

    const Motor = {
        CLASES_NIZA, RIESGOS, AVISO_VIABILIDAD, normalizarMarca, claveFonetica, compararMarcas, clasesRelacionadas, relacionClases,
        situacionDe, mismoTitular, palabrasDistintivas, observacionesRegistrabilidad, desdeMARCia, desdeMarcanet,
        desdeSIGA, consolidar, evaluarAntecedente, analizar, recomendaciones, resumenTexto, fechaIMPI,
        leerDetalleMarcanet, variantesComodin, aConsultarDetalle, nombresParaGaceta, etiquetaGaceta, historialTexto,
        leerFichaMARCia, avisosDeFicha, agruparMarcas, aConsultarMARCia, nombreDe, claveTitular
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
    if (typeof document === 'undefined') return;

    // ==================== INTERFAZ ====================

    const CLAVE_RECIENTES = 'impi_estudios_viabilidad';   // localStorage: los últimos estudios
    const MAX_RECIENTES = 8;
    const MAX_CLASES = 6;

    const ui = { clases: [], ejecutando: false, reporte: null, verBajos: false, crudo: null, entrada: null, sinReintento: false };

    function $(id) { return document.getElementById(id); }

    function esc(t) {
        return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function toast(m, tipo) { if (typeof global.mostrarToast === 'function') global.mostrarToast(m, tipo || 'info'); }

    function fechaHora(iso) {
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    const ETIQUETA_RIESGO = { alto: '⛔ Alto', medio: '⚠️ Medio', bajo: '✓ Bajo', propia: '👤 Propia' };
    const ETIQUETA_RELACION = { misma: 'Misma clase', relacionada: 'Clase relacionada', distinta: 'Otra clase', desconocida: 'Clase sin dato' };
    const ICONO_OBS = { alto: '⛔', medio: '⚠️', info: 'ℹ️' };

    // ---- Formulario ----

    function construir() {
        const cont = $('impi-tab-viabilidad');
        if (!cont || cont.dataset.listo) return;
        cont.dataset.listo = '1';
        const opciones = Object.entries(CLASES_NIZA).map(([n, t]) => '<option value="' + n + '">' + n + ' — ' + esc(t) + '</option>').join('');
        cont.innerHTML =
            '<div class="card vb-card">' +
                '<div class="card-header"><div><h3>🧭 Estudio de viabilidad de marca</h3>' +
                '<p class="vb-sub">Busca la denominación en MARCia (idénticas y parecidas), Marcanet (búsqueda fonética oficial) y las Gacetas (SIGA); junta lo encontrado, lo compara con tu propuesta y da un dictamen orientativo.</p></div></div>' +
                '<div class="card-body">' +
                    '<form id="vb-form" novalidate>' +
                        '<div class="form-row">' +
                            '<div class="form-group" style="flex:2"><label for="vb-denominacion">Denominación propuesta *</label>' +
                                '<input type="text" id="vb-denominacion" maxlength="120" autocomplete="off" placeholder="Ej: Luna Azul"></div>' +
                            '<div class="form-group"><label for="vb-tipo">Tipo de marca</label><select id="vb-tipo">' +
                                '<option value="nominativa">Nominativa (solo palabras)</option><option value="mixta">Mixta (palabras y diseño)</option>' +
                                '<option value="figurativa">Figurativa (solo diseño)</option><option value="tridimensional">Tridimensional</option></select></div>' +
                        '</div>' +
                        '<div class="form-group"><label for="vb-clase-agregar">Clases de Niza * <small>(hasta ' + MAX_CLASES + ')</small></label>' +
                            '<div class="vb-clases"><div id="vb-clases-elegidas" class="vb-chips" aria-live="polite"></div>' +
                            '<select id="vb-clase-agregar"><option value="">Agregar clase…</option>' + opciones + '</select></div>' +
                            '<small class="vb-ayuda">Las clases donde se usará la marca. Las relacionadas (por ejemplo, café y cafeterías) se revisan solas.</small></div>' +
                        '<div class="form-group"><label for="vb-productos">Productos o servicios (opcional)</label>' +
                            '<textarea id="vb-productos" rows="2" maxlength="600" placeholder="Ej: café en grano y molido; servicio de cafetería"></textarea>' +
                            '<small class="vb-ayuda">Sirve para detectar si la marca describe lo que ofreces.</small></div>' +
                        '<div class="form-row">' +
                            '<div class="form-group"><label for="vb-solicitante">Solicitante (opcional)</label>' +
                                '<input type="text" id="vb-solicitante" maxlength="160" autocomplete="off" placeholder="Para no contar como obstáculo sus propias marcas"></div>' +
                            '<div class="form-group vb-opcion"><label class="checkbox-label"><input type="checkbox" id="vb-palabras" checked> Buscar también cada palabra distintiva por separado</label></div>' +
                        '</div>' +
                        '<p class="vb-aviso vb-aviso-form" role="note">⚠️ ' + esc(AVISO_VIABILIDAD) + '</p>' +
                        '<div class="vb-acciones-form"><button type="submit" class="btn btn-primary" id="vb-ejecutar">🧭 Hacer el estudio</button></div>' +
                    '</form>' +
                    '<ol id="vb-progreso" class="vb-progreso" hidden></ol>' +
                '</div>' +
            '</div>' +
            '<div id="vb-reporte"></div>' +
            '<div id="vb-recientes"></div>';

        $('vb-form').addEventListener('submit', e => { e.preventDefault(); ejecutar(); });
        $('vb-clase-agregar').addEventListener('change', e => {
            const n = parseInt(e.target.value, 10);
            e.target.value = '';
            if (!n || ui.clases.includes(n)) return;
            if (ui.clases.length >= MAX_CLASES) { toast('Hasta ' + MAX_CLASES + ' clases por estudio', 'warning'); return; }
            ui.clases.push(n);
            ui.clases.sort((a, b) => a - b);
            pintarClases();
        });
        cont.addEventListener('click', alHacerClic);
        pintarClases();
        pintarRecientes();
    }

    function pintarClases() {
        const el = $('vb-clases-elegidas');
        if (!el) return;
        el.innerHTML = ui.clases.length
            ? ui.clases.map(n => '<span class="vb-chip">' + n + ' — ' + esc(CLASES_NIZA[n]) +
                ' <button type="button" data-vb="quitar-clase" data-clase="' + n + '" aria-label="Quitar clase ' + n + '">✕</button></span>').join('')
            : '<span class="vb-sin-clases">Ninguna clase elegida</span>';
    }

    function leerEntrada() {
        return {
            denominacion: ($('vb-denominacion').value || '').trim(),
            tipo: $('vb-tipo').value,
            clases: ui.clases.slice(),
            productos: ($('vb-productos').value || '').trim(),
            solicitante: ($('vb-solicitante').value || '').trim(),
            porPalabra: $('vb-palabras').checked
        };
    }

    function ponerEntrada(e) {
        $('vb-denominacion').value = e.denominacion || '';
        $('vb-tipo').value = e.tipo || 'nominativa';
        $('vb-productos').value = e.productos || '';
        $('vb-solicitante').value = e.solicitante || '';
        $('vb-palabras').checked = e.porPalabra !== false;
        ui.clases = (e.clases || []).slice(0, MAX_CLASES);
        pintarClases();
    }

    // ---- Progreso ----

    let pasos = [];

    function paso(id, texto) {
        pasos.push({ id, texto, estado: 'espera', detalle: '' });
        pintarProgreso();
    }

    function marcar(id, estado, detalle) {
        const p = pasos.find(x => x.id === id);
        if (!p) return;
        p.estado = estado;
        p.detalle = detalle || '';
        pintarProgreso();
    }

    function pintarProgreso() {
        const el = $('vb-progreso');
        if (!el) return;
        el.hidden = !pasos.length;
        const icono = { espera: '⏳', ok: '✅', error: '⚠️', omitido: '—' };
        el.innerHTML = pasos.map(p => '<li class="vb-paso vb-paso-' + p.estado + '"><span aria-hidden="true">' + icono[p.estado] + '</span> ' +
            esc(p.texto) + (p.detalle ? ' <small>' + esc(p.detalle) + '</small>' : '') + '</li>').join('');
    }

    // ---- Consultas ----

    function consultaMARCia(titulo, opcion) {
        return {
            title: titulo, titleOption: opcion, name: null, number: null, date: null, status: [], classes: [],
            codes: [], indicators: [], markType: [], appType: [], goodsAndServices: '', wordSet: { l: null, op: 'AND', r: null }
        };
    }

    function esErrorSesion(e) {
        return typeof global.esErrorDeSesionMARCia === 'function' ? global.esErrorDeSesionMARCia(e) : /no active session|HTTP 401/i.test((e && e.message) || '');
    }

    /**
     * Registra una búsqueda en MARCia y trae lo que interesa: la primera
     * página sin filtro (si se pide) y, para cada clase que importa y en la
     * que MARCia dice que hay resultados, la página de esa clase. Así cada
     * antecedente llega con su clase aunque MARCia no la ponga en la lista.
     */
    // MARCia entrega 100 por página. En las clases pedidas se leen hasta 3
    // páginas: con palabras comunes («luna» tiene 263 marcas en la 43) la
    // primera se queda corta. En las relacionadas basta la primera.
    const PAGINAS_MARCIA = 3;

    async function buscarEnMARCia(consulta, clases, sinFiltro, clasesProfundas) {
        const profundas = (clasesProfundas || []).map(String);
        const intento = async () => {
            const registro = await global.proxyFetch('/marcia/search', {
                method: 'POST', body: JSON.stringify({ _type: 'Search$Structured', images: [], query: consulta })
            });
            const pedir = (filtro, pagina) => global.proxyFetch('/marcia/results', {
                method: 'POST',
                body: JSON.stringify({ searchId: registro.id, pageSize: 100, pageNumber: pagina || 0, statusFilter: [], viennaCodeFilter: [], niceClassFilter: filtro })
            });
            const primera = await pedir([]);
            const lotes = sinFiltro ? [{ clase: null, resultados: primera.resultPage || [] }] : [];
            const agregados = (primera.aggregates && primera.aggregates.NICE_CLASSES) || [];
            // Si falla una clase, se repite una vez; si sigue fallando, las
            // demás clases no se pierden por ella.
            const fallos = [];
            for (const c of clases) {
                if (agregados.length) {
                    const a = agregados.find(x => String(x.key) === String(c));
                    if (!a || !a.docCount) continue;
                }
                let r;
                try {
                    r = await pedir([String(c)]);
                } catch (e) {
                    if (esErrorSesion(e) || esLimite(e)) throw e;
                    try {
                        await esperar(1000);
                        r = await pedir([String(c)]);
                    } catch (e2) {
                        if (esErrorSesion(e2) || esLimite(e2)) throw e2;
                        fallos.push(c);
                        continue;
                    }
                }
                const resultados = (r.resultPage || []).slice();
                const total = r.totalResults || 0;
                if (profundas.includes(String(c))) {
                    for (let pagina = 1; pagina < PAGINAS_MARCIA && resultados.length < total; pagina++) {
                        const mas = (await pedir([String(c)], pagina)).resultPage || [];
                        if (!mas.length) break;
                        resultados.push(...mas);
                    }
                }
                lotes.push({ clase: c, resultados });
            }
            return { total: primera.totalResults || registro.count || 0, lotes, fallos };
        };
        try {
            return await intento();
        } catch (e) {
            if (!esErrorSesion(e)) throw e;
            await global.proxyFetch('/marcia/csrf');
            return await intento();
        }
    }

    async function consultarMARCia(entrada, crudo, distintivas, comodines) {
        comodines = comodines || [];
        const clasesRevisar = entrada.clases.concat(clasesRelacionadas(entrada.clases));
        const fuente = crudo.fuentes.MARCia = { ok: false, total: 0, error: '', consultas: 0, fallidas: 0 };
        let alguna = false;
        try {
            await global.proxyFetch('/marcia/csrf');
        } catch (e) {
            fuente.error = e.message;
            for (const id of ['m-similar', 'm-identica'].concat(distintivas.map((_, i) => 'm-palabra-' + i), comodines.map((_, i) => 'm-comodin-' + i))) marcar(id, 'error', e.message);
            return;
        }
        const correr = async (id, consulta, clases, sinFiltro) => {
            fuente.consultas++;
            const intento = () => buscarEnMARCia(consulta, clases, sinFiltro, entrada.clases);
            try {
                let r;
                try {
                    r = await intento();
                } catch (e) {
                    if (esLimite(e)) throw e;
                    // MARCia a veces falla una búsqueda suelta (responde vacío):
                    // una vez más, tras una pausa.
                    marcar(id, 'espera', 'falló; se repite en 2 s');
                    await esperar(2000);
                    r = await intento();
                }
                crudo.marcia.push(...r.lotes);
                const n = r.lotes.reduce((s, l) => s + l.resultados.length, 0);
                fuente.total += n;
                alguna = true;
                if (r.fallos.length) {
                    fuente.fallidas++;
                    fuente.error = fuente.error || 'faltaron las clases ' + r.fallos.join(', ');
                    marcar(id, 'error', r.total + ' en total; faltaron las clases ' + r.fallos.join(', '));
                } else {
                    marcar(id, 'ok', r.total + ' en total');
                }
            } catch (e) {
                fuente.fallidas++;
                const msg = /JSON/.test(e.message) ? 'MARCia respondió vacío' : e.message;
                fuente.error = fuente.error || msg;
                marcar(id, 'error', msg);
            }
        };
        await correr('m-similar', consultaMARCia(entrada.denominacion, 'similar'), clasesRevisar, false);
        await correr('m-identica', consultaMARCia(entrada.denominacion, ''), [], true);
        for (let i = 0; i < distintivas.length; i++) {
            await correr('m-palabra-' + i, consultaMARCia(distintivas[i], 'similar'), entrada.clases, false);
        }
        for (let i = 0; i < comodines.length; i++) {
            await correr('m-comodin-' + i, consultaMARCia(comodines[i], ''), clasesRevisar, false);
        }
        // Si alguna búsqueda falló, MARCia respondió a medias: lo que trajo
        // cuenta, pero el dictamen lo dice y se puede reintentar.
        fuente.ok = alguna && !fuente.fallidas;
        fuente.parcial = alguna && fuente.fallidas > 0;
        if (fuente.parcial) fuente.error = fuente.fallidas + ' de ' + fuente.consultas + ' búsquedas fallaron (' + fuente.error + ')';
    }

    // El proxy guarda una sesión con Marcanet por navegador. Si esa sesión se
    // atora (búsquedas y fichas llegan vacías una y otra vez), otra nueva lo
    // resuelve: se pide con otro identificador de cliente.
    let clienteMarcanet = null;
    function sesionNuevaMarcanet() {
        const base = (typeof global.obtenerClientId === 'function' ? String(global.obtenerClientId()) : 'cliente')
            .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'cliente';
        clienteMarcanet = base + '-m' + Date.now().toString(36);
    }
    const cabecerasMarcanet = () => (clienteMarcanet ? { 'X-IMPI-Client': clienteMarcanet } : {});
    // Un 402 es el límite del plan: eso no se reintenta.
    const esLimite = (e) => /Límite del plan gratuito/.test((e && e.message) || '');

    // Cuántos resultados se le piden a la fonética de Marcanet. Su página trae
    // 10; el proxy lee las siguientes hasta juntar estos.
    const MAX_MARCANET = 60;
    // Marcanet a veces responde vacía en un segundo: con la sesión recién
    // abierta o todavía ocupada con la búsqueda anterior. Medido en vivo, una
    // de cada ocho búsquedas; casi todas se recuperan si se espera un poco.
    const PAUSAS_MARCANET = [3000, 5000];
    const esperar = (ms) => new Promise(r => setTimeout(r, ms));

    /**
     * La fonética de Marcanet no filtra por clase: con la 25 o con la 43
     * devuelve las mismas marcas, cada una con su clase. Basta una consulta.
     */
    async function consultarMarcanet(entrada, crudo) {
        const fuente = crudo.fuentes.Marcanet = { ok: false, total: 0, error: '' };
        const pedir = async () => {
            try {
                return await global.proxyFetch('/marcanet/fonetica', {
                    method: 'POST', headers: cabecerasMarcanet(),
                    body: JSON.stringify({ denominacion: entrada.denominacion, clase: String(entrada.clases[0]), maxResultados: MAX_MARCANET })
                });
            } catch (e) {
                if (esLimite(e)) throw e;
                return { error: e.message };
            }
        };
        try {
            let data = await pedir();
            for (let i = 0; i < PAUSAS_MARCANET.length; i++) {
                if (data && !data.error && !data.isFormPage && (data.results || []).length) break;
                // El último intento, con una sesión nueva: si la del navegador
                // se atoró, insistir con ella no sirve.
                const ultimo = i === PAUSAS_MARCANET.length - 1;
                marcar('mcn', 'espera', (data && data.error ? 'falló' : 'respondió vacía') + '; se repite en ' + (PAUSAS_MARCANET[i] / 1000) + ' s' +
                    (ultimo && !clienteMarcanet ? ' con una sesión nueva' : ''));
                await esperar(PAUSAS_MARCANET[i]);
                if (ultimo && !clienteMarcanet) sesionNuevaMarcanet();
                data = await pedir();
            }
            if (data && data.error) throw new Error(data.error);
            if (data && data.isFormPage) throw new Error('Marcanet devolvió su formulario en vez de resultados');
            const resultados = (data && data.results) || [];
            // Su fonética siempre encuentra algo (para «lunafardo», 197): vacía
            // tres veces es una falla de Marcanet, y decir "no hay nada" sería
            // peor que decir que no respondió.
            if (!resultados.length) throw new Error('respondió vacía tres veces; repite el estudio en unos minutos');
            crudo.marcanet.push({ clase: null, resultados });
            fuente.total = resultados.length;
            fuente.ok = true;
            marcar('mcn', 'ok', resultados.length + ' resultados');
        } catch (e) {
            fuente.error = e.message;
            marcar('mcn', 'error', e.message);
        }
    }

    /** La ficha de Marcanet de cada antecedente que importa: estatus y vigencia. */
    async function consultarDetalles(objetivos) {
        const detalles = {};
        let leidos = 0;
        for (const o of objetivos) {
            const pedir = () => global.proxyFetch('/marcanet/full-detail', {
                method: 'POST', headers: cabecerasMarcanet(), body: JSON.stringify({ expediente: o.expediente, link: o.enlace })
            }).catch(() => null);
            try {
                let data = await pedir();
                // Igual que la búsqueda: con la sesión recién abierta puede llegar vacía.
                if (!leerDetalleMarcanet(data && data.detail)) data = await pedir();
                // Dos veces vacía: la sesión está atorada; otra nueva (y se queda
                // para las fichas que siguen).
                if (!leerDetalleMarcanet(data && data.detail) && !clienteMarcanet) {
                    sesionNuevaMarcanet();
                    data = await pedir();
                }
                if (leerDetalleMarcanet(data && data.detail)) { detalles[o.expediente] = data.detail; leidos++; }
            } catch (e) { /* sin ficha, el antecedente se queda como estaba */ }
            marcar('detalle', 'espera', leidos + ' de ' + objetivos.length);
        }
        marcar('detalle', leidos ? 'ok' : 'error', leidos + ' de ' + objetivos.length + (leidos ? '' : ': no respondió'));
        return detalles;
    }

    /**
     * La ficha de MARCia de cada antecedente que importa: su clase y lo que
     * ampara. Cada objetivo trae los ids posibles; el primero que corresponda
     * al expediente se queda.
     */
    async function consultarFichasMARCia(objetivos) {
        const fichas = {};
        let leidas = 0;
        const ver = async (id) => {
            const pedir = () => global.proxyFetch('/marcia/view/' + encodeURIComponent(id));
            try {
                return await pedir();
            } catch (e) {
                if (!esErrorSesion(e)) return null;
                // La sesión de MARCia en el proxy se perdió: otra, y una vez más.
                try { await global.proxyFetch('/marcia/csrf'); return await pedir(); } catch (e2) { return null; }
            }
        };
        for (const o of objetivos) {
            for (const id of o.ids) {
                const f = leerFichaMARCia(await ver(id), o.expediente);
                if (f) { fichas[o.expediente] = f; leidas++; break; }
            }
            marcar('marcia-fichas', 'espera', leidas + ' de ' + objetivos.length);
        }
        marcar('marcia-fichas', leidas ? 'ok' : 'error', leidas + ' de ' + objetivos.length + (leidas ? '' : ': no respondió'));
        return fichas;
    }

    /** SIGA por el nombre de cada antecedente principal: su historial en la Gaceta. */
    async function consultarHistorialSIGA(nombres) {
        const fichas = [];
        const buscados = [];
        let leidos = 0;
        for (const n of nombres) {
            try {
                const data = await global.proxyFetch('/siga/search', {
                    method: 'POST', body: JSON.stringify({ Busqueda: n, IdArea: '2', IdGaceta: [], FechaDesde: '', FechaHasta: '' })
                });
                if (data && data.successed === false) throw new Error(data.message || 'SIGA rechazó la búsqueda');
                fichas.push(...((data && data.data) || []));
                buscados.push(n);
                leidos++;
            } catch (e) { /* sin historial de ese nombre: el reporte sigue */ }
        }
        marcar('siga-historial', leidos ? 'ok' : 'error', leidos ? fichas.length + ' publicaciones' : 'no respondió');
        return { fichas, buscados };
    }

    async function consultarSIGA(entrada, crudo) {
        const fuente = crudo.fuentes.SIGA = { ok: false, total: 0, error: '' };
        try {
            const data = await global.proxyFetch('/siga/search', {
                method: 'POST',
                body: JSON.stringify({ Busqueda: entrada.denominacion, IdArea: '2', IdGaceta: [], FechaDesde: '', FechaHasta: '' })
            });
            if (data && data.successed === false) throw new Error(data.message || 'SIGA rechazó la búsqueda');
            crudo.siga = (data && data.data) || [];
            fuente.ok = true;
            fuente.total = crudo.siga.length;
            marcar('siga', 'ok', crudo.siga.length + ' publicaciones');
        } catch (e) {
            fuente.error = e.message;
            marcar('siga', 'error', e.message);
        }
    }

    /** Qué se le pregunta a MARCia además de la denominación, y sus pasos. */
    function planDeBusqueda(entrada) {
        const todas = palabrasDistintivas(entrada.denominacion, entrada.clases, entrada.productos);
        const distintivas = entrada.porPalabra && palabras(normalizarMarca(entrada.denominacion)).filter(w => !PALABRAS_VACIAS.has(w)).length > 1
            ? todas.filter((w, i, a) => a.indexOf(w) === i).sort((a, b) => b.length - a.length).slice(0, 3) : [];
        // Variantes de una letra de las palabras que distinguen (MARCia no las ve solas).
        const comodines = todas.filter((w, i, a) => a.indexOf(w) === i).sort((a, b) => b.length - a.length).slice(0, 2)
            .flatMap(variantesComodin);
        return { distintivas, comodines };
    }

    function pasosDeMARCia(plan) {
        paso('m-similar', 'MARCia: marcas parecidas, por clase');
        paso('m-identica', 'MARCia: idénticas en todas las clases');
        plan.distintivas.forEach((w, i) => paso('m-palabra-' + i, 'MARCia: la palabra «' + w + '»'));
        plan.comodines.forEach((w, i) => paso('m-comodin-' + i, 'MARCia: variantes «' + w.toLowerCase() + '»'));
    }

    /**
     * Lo que sigue a las fuentes: el dictamen, las fichas de Marcanet y de
     * MARCia de los antecedentes principales y su historial en la Gaceta.
     * Sirve igual para el estudio y para reintentar lo que faltó: lo que ya
     * se tiene no se vuelve a pedir.
     */
    async function completar(entrada, crudo) {
        crudo.fuentes = { MARCia: crudo.fuentes.MARCia, Marcanet: crudo.fuentes.Marcanet, SIGA: crudo.fuentes.SIGA };
        let rep = analizar(entrada, crudo, Date.now());
        // Las listas no traen estatus fiable: se confirma en la ficha de
        // Marcanet de los antecedentes de riesgo alto y medio, y se vuelve a
        // evaluar con lo que diga.
        const objetivos = aConsultarDetalle(rep, 8);
        if (objetivos.length) {
            paso('detalle', 'Marcanet: estatus y vigencia de los ' + objetivos.length + ' antecedentes principales');
            crudo.detalles = Object.assign(crudo.detalles || {}, await consultarDetalles(objetivos));
            crudo.fichasPedidas = Array.from(new Set((crudo.fichasPedidas || []).concat(objetivos.map(o => o.expediente))));
            crudo.fichas = { pedidas: crudo.fichasPedidas.length, leidas: crudo.fichasPedidas.filter(x => crudo.detalles[x]).length };
            rep = analizar(entrada, crudo, Date.now());
        }
        // La clase y lo que ampara, de la ficha de MARCia: la búsqueda de
        // Marcanet a veces muestra las clases de toda una familia de solicitudes.
        const deMARCia = aConsultarMARCia(rep, 8, crudo.fichasMARCia);
        if (deMARCia.length) {
            paso('marcia-fichas', 'MARCia: clase y productos de los ' + deMARCia.length + ' antecedentes principales');
            crudo.fichasMARCia = Object.assign(crudo.fichasMARCia || {}, await consultarFichasMARCia(deMARCia));
            crudo.fichasMPedidas = Array.from(new Set((crudo.fichasMPedidas || []).concat(deMARCia.map(o => o.expediente))));
            crudo.fichasM = { pedidas: crudo.fichasMPedidas.length, leidas: crudo.fichasMPedidas.filter(x => crudo.fichasMARCia[x]).length };
            rep = analizar(entrada, crudo, Date.now());
        }
        // SIGA solo encuentra palabras exactas: con los nombres de los
        // antecedentes principales trae su historial en la Gaceta (registro,
        // renovaciones, abandono…) y solicitudes recientes parecidas.
        const nombres = nombresParaGaceta(rep, 3).filter(n => !(crudo.sigaNombres || []).includes(n));
        if (nombres.length) {
            paso('siga-historial', 'SIGA: historial en Gaceta de ' + nombres.map(n => '«' + n + '»').join(', '));
            const h = await consultarHistorialSIGA(nombres);
            crudo.sigaHistorial = (crudo.sigaHistorial || []).concat(h.fichas);
            crudo.sigaNombres = (crudo.sigaNombres || []).concat(h.buscados);
            rep = analizar(entrada, crudo, Date.now());
        }
        return rep;
    }

    /**
     * Lo que no respondió: las fuentes, y las fichas de Marcanet o de MARCia
     * si no se leyó ninguna (señal de que la sesión se atoró). Una ficha
     * suelta que no se deja leer no se arregla reintentando.
     */
    function faltantes(rep) {
        if (!rep) return [];
        const f = rep.fuentes.filter(x => !x.ok).map(x => x.nombre);
        if (rep.fichas && rep.fichas.pedidas && !rep.fichas.leidas) f.push('fichas');
        if (rep.fichasMARCia && rep.fichasMARCia.pedidas && !rep.fichasMARCia.leidas) f.push('fichas-marcia');
        return f;
    }

    function puedeReintentar() {
        return !!(ui.crudo && ui.entrada && ui.reporte && !ui.sinReintento && faltantes(ui.reporte).length);
    }

    /**
     * Vuelve a pedir solo lo que no respondió, con una sesión nueva en
     * Marcanet. Usa el permiso del estudio (30 minutos), así que no cuenta
     * como otro; vencido, con Premium se pide otro y sin Premium hay que
     * repetir el estudio.
     */
    async function reintentar() {
        if (ui.ejecutando || !puedeReintentar()) return;
        const Q = global.CUOTAS_IMPI;
        if (Q && typeof Q.vencePase === 'function') {
            const vence = Q.vencePase();
            if (vence != null && vence < Date.now() + 15000) {
                const premium = !!(global.estadoPremium && global.estadoPremium.activo);
                if (!premium || !(await Q.autorizar('viabilidad', { silencioso: true }))) {
                    toast('El permiso de este estudio ya venció (dura 30 minutos). Para completar lo que faltó, repite el estudio.', 'warning');
                    ui.sinReintento = true;
                    return pintarReporte();
                }
            }
        }
        ui.ejecutando = true;
        const entrada = ui.entrada, crudo = ui.crudo;
        const falta = faltantes(ui.reporte);
        sesionNuevaMarcanet();
        pasos = [];
        const tareas = [];
        if (falta.includes('MARCia')) {
            const plan = planDeBusqueda(entrada);
            pasosDeMARCia(plan);
            crudo.marcia = [];
            tareas.push(consultarMARCia(entrada, crudo, plan.distintivas, plan.comodines));
        }
        if (falta.includes('Marcanet')) {
            paso('mcn', 'Marcanet: búsqueda fonética (en todas las clases)');
            crudo.marcanet = [];
            tareas.push(consultarMarcanet(entrada, crudo));
        }
        if (falta.includes('SIGA')) {
            paso('siga', 'SIGA: publicaciones en Gaceta');
            tareas.push(consultarSIGA(entrada, crudo));
        }
        const boton = document.querySelector('[data-vb="reintentar"]');
        if (boton) { boton.disabled = true; boton.textContent = '⏳ Reintentando…'; }
        try {
            await Promise.all(tareas);
            ui.reporte = await completar(entrada, crudo);
            guardarReciente(ui.reporte, true);
            pintarReporte();
            pintarRecientes();
            const sigue = faltantes(ui.reporte).length;
            toast(sigue ? 'Todavía faltó algo; puedes volver a intentarlo en un momento.' : 'Listo: el estudio quedó completo.', sigue ? 'warning' : 'success');
        } catch (e) {
            console.error('[VIABILIDAD]', e);
            toast('No se pudo reintentar: ' + e.message, 'error');
            pintarReporte();
        } finally {
            ui.ejecutando = false;
        }
    }

    async function ejecutar() {
        if (ui.ejecutando) return;
        const entrada = leerEntrada();
        if (!entrada.denominacion) { toast('Escribe la denominación que quieres registrar', 'warning'); $('vb-denominacion').focus(); return; }
        if (!entrada.clases.length) { toast('Elige al menos una clase de Niza', 'warning'); $('vb-clase-agregar').focus(); return; }
        if (typeof global.proxyFetch !== 'function' || (typeof global.getProxyUrl === 'function' && !global.getProxyUrl())) {
            toast('El servicio de búsqueda IMPI no está disponible en este momento.', 'warning');
            return;
        }
        // Sin Premium hay 2 estudios en total (cuotas-impi.js). Se marca antes
        // de preguntar para que un doble clic no gaste dos.
        ui.ejecutando = true;
        if (global.CUOTAS_IMPI && !(await global.CUOTAS_IMPI.autorizar('viabilidad'))) { ui.ejecutando = false; return; }

        const boton = $('vb-ejecutar');
        boton.disabled = true;
        boton.textContent = '⏳ Consultando al IMPI…';
        $('vb-reporte').innerHTML = '';

        const plan = planDeBusqueda(entrada);
        pasos = [];
        pasosDeMARCia(plan);
        paso('mcn', 'Marcanet: búsqueda fonética (en todas las clases)');
        paso('siga', 'SIGA: publicaciones en Gaceta');
        // Cada estudio empieza con la sesión de siempre en Marcanet.
        clienteMarcanet = null;
        ui.crudo = null;
        ui.sinReintento = false;

        const crudo = { marcia: [], marcanet: [], siga: [], fuentes: {} };
        try {
            await Promise.all([consultarMARCia(entrada, crudo, plan.distintivas, plan.comodines), consultarMarcanet(entrada, crudo), consultarSIGA(entrada, crudo)]);
            ui.reporte = await completar(entrada, crudo);
            // Lo crudo se queda en memoria para poder reintentar lo que faltó.
            ui.crudo = crudo;
            ui.entrada = entrada;
            ui.verBajos = false;
            guardarReciente(ui.reporte);
            pintarReporte();
            pintarRecientes();
            const r = $('vb-reporte');
            if (r && r.scrollIntoView) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
            console.error('[VIABILIDAD]', e);
            toast('No se pudo completar el estudio: ' + e.message, 'error');
        } finally {
            ui.ejecutando = false;
            boton.disabled = false;
            boton.textContent = '🧭 Hacer el estudio';
        }
    }

    // ---- Reporte ----

    function pintarReporte() {
        const rep = ui.reporte;
        const cont = $('vb-reporte');
        if (!cont || !rep) return;
        const e = rep.entrada;
        const d = rep.dictamen;
        // Una fila por marca y titular; sus expedientes, dentro.
        const utiles = agruparMarcas(rep.antecedentes).filter(a => !a.descartado);
        const relevantes = utiles.filter(a => a.riesgo !== 'bajo' || a.similitud.puntaje >= 75);
        const bajos = utiles.filter(a => !relevantes.includes(a));
        const visibles = ui.verBajos ? utiles : relevantes;
        const descartados = rep.conteo.descartados || 0;

        const numero = a => a.registro ? 'Reg. ' + a.registro : a.expediente ? 'Exp. ' + a.expediente : '';
        const verMARCia = id => '<button type="button" class="btn btn-sm btn-secondary" data-vb="detalle" data-id="' + esc(id) + '">Ver</button>';
        // Los expedientes de una marca con varios: riesgo, número, clase y estatus de cada uno.
        const miembros = a => a.miembros.length < 2 ? '' :
            '<details class="vb-miembros"><summary>Sus ' + a.miembros.length + ' expedientes</summary><ul>' +
            a.miembros.map(m => '<li>' + esc([ETIQUETA_RIESGO[m.riesgo], numero(m), 'clase ' + (m.clases.join(', ') || '—'), m.estado].filter(Boolean).join(' · ')) +
                (m.id && m.id !== a.id ? ' ' + verMARCia(m.id) : '') + '</li>').join('') + '</ul></details>';
        const fila = a => {
            const num = numero(a) + (a.miembros.length > 1 ? ' y ' + (a.miembros.length - 1) + ' más' : '');
            const acciones = a.id ? verMARCia(a.id) : '';
            return '<tr class="vb-fila-' + a.riesgo + '">' +
                '<td><span class="vb-riesgo vb-riesgo-' + a.riesgo + '">' + ETIQUETA_RIESGO[a.riesgo] + '</span></td>' +
                '<td><strong>' + esc(a.titulo) + '</strong>' + (num ? '<br><small>' + esc(num) + '</small>' : '') + miembros(a) + '</td>' +
                '<td>' + esc(a.clases.join(', ') || '—') + '<br><small>' + esc(ETIQUETA_RELACION[a.relacion]) + (a.conFichaMARCia ? ', según MARCia' : '') + '</small></td>' +
                '<td>' + esc(a.estado || '—') + (a.conDetalle ? '<br><small>según su ficha en Marcanet</small>' : '') +
                    (a.gaceta && a.gaceta.length ? '<br><small>En Gaceta: ' + esc(historialTexto(a)) + '</small>' : '') + '</td>' +
                '<td>' + esc(a.titulares.slice(0, 2).join('; ') || '—') + (a.ampara ? '<br><small>Ampara: ' + esc(a.ampara.length > 140 ? a.ampara.slice(0, 140) + '…' : a.ampara) + '</small>' : '') + '</td>' +
                '<td class="vb-num">' + a.similitud.puntaje + '%<br><small>' + esc(a.similitud.detalle) + '</small></td>' +
                '<td class="vb-motivos">' + esc(a.motivos.join('. ')) + '</td>' +
                '<td><small>' + esc(a.fuentes.join(', ')) + '</small></td>' +
                '<td>' + acciones + '</td></tr>';
        };

        const tablaAntecedentes = visibles.length
            ? '<div class="vb-tabla-marco"><table class="vb-tabla"><thead><tr><th>Riesgo</th><th>Marca</th><th>Clase</th><th>Estatus</th><th>Titular</th>' +
              '<th class="vb-num">Parecido</th><th>Por qué</th><th>Fuente</th><th></th></tr></thead><tbody>' + visibles.map(fila).join('') + '</tbody></table></div>'
            : '<p class="vb-vacio">' + (rep.antecedentes.length ? 'Ningún antecedente se parece lo suficiente para considerarse.' : 'Las fuentes no devolvieron antecedentes.') + '</p>';
        const notaMarcas = visibles.some(a => a.miembros.length > 1)
            ? '<p class="vb-nota">Cada fila es una marca de un mismo titular. Si tiene varios expedientes (suele pedirse uno por clase), la fila toma el riesgo del más grave y los demás se ven en «Sus expedientes».</p>'
            : '';
        const notaDescartados = descartados
            ? '<p class="vb-nota">Se descartaron ' + descartados + ' resultado' + (descartados === 1 ? '' : 's') + ' de las fuentes que no se parece' + (descartados === 1 ? '' : 'n') +
              ' a la denominación (menos de 50%). Van en el CSV por si quieres revisarlos.</p>'
            : '';

        const publicaciones = rep.publicaciones.length
            ? '<div class="vb-tabla-marco"><table class="vb-tabla"><thead><tr><th>Denominación</th><th>Clase</th><th>Gaceta y sección</th><th>Ejemplar</th><th class="vb-num">Parecido</th></tr></thead><tbody>' +
              rep.publicaciones.slice(0, 25).map(p => '<tr><td><strong>' + esc(p.denominacion) + '</strong>' +
                (p.registro || p.expediente ? '<br><small>' + esc(p.registro ? 'Reg. ' + p.registro : 'Exp. ' + p.expediente) + '</small>' : '') + '</td>' +
                '<td>' + esc(p.clases.join(', ') || '—') + '</td><td>' + esc(p.gaceta) + '<br><small>' + esc(p.seccion) + '</small></td>' +
                '<td>' + esc(p.ejemplar) + (p.fecha ? '<br><small>' + esc(p.fecha) + '</small>' : '') + '</td>' +
                '<td class="vb-num">' + p.similitud.puntaje + '%</td></tr>').join('') + '</tbody></table></div>'
            : '<p class="vb-vacio">' + (rep.fuentes.some(f => f.nombre === 'SIGA' && f.ok) ? 'Sin publicaciones parecidas en las Gacetas.' : 'SIGA no respondió.') + '</p>';

        cont.innerHTML =
            '<article class="card vb-reporte" aria-labelledby="vb-titulo-reporte">' +
                '<header class="vb-reporte-cab">' +
                    '<div><h3 id="vb-titulo-reporte">Estudio de viabilidad: «' + esc(e.denominacion) + '»</h3>' +
                    '<p>Clases ' + esc(e.clases.join(', ')) + (rep.relacionadas.length ? ' · relacionadas revisadas: ' + esc(rep.relacionadas.join(', ')) : '') +
                    ' · ' + esc({ nominativa: 'Nominativa', mixta: 'Mixta', figurativa: 'Figurativa', tridimensional: 'Tridimensional' }[e.tipo] || '') +
                    ' · ' + esc(fechaHora(rep.fecha)) + '</p></div>' +
                    '<div class="vb-reporte-btns">' +
                        '<button type="button" class="btn btn-sm btn-secondary" data-vb="imprimir">🖨️ Imprimir / PDF</button>' +
                        '<button type="button" class="btn btn-sm btn-secondary" data-vb="copiar">📋 Copiar resumen</button>' +
                        '<button type="button" class="btn btn-sm btn-secondary" data-vb="csv">⬇️ CSV</button>' +
                        '<button type="button" class="btn btn-sm btn-secondary" data-vb="vigilar">👁️ Vigilar</button>' +
                    '</div>' +
                '</header>' +
                '<div class="vb-dictamen vb-dictamen-' + d.nivel + '">' +
                    '<span class="vb-dictamen-icono" aria-hidden="true">' + ({ alta: '✅', media: '⚠️', baja: '⛔', incompleta: '❔' }[d.nivel]) + '</span>' +
                    '<div><strong>' + esc(d.titulo) + '</strong><p>' + esc(d.resumen) + '</p>' +
                    '<p class="vb-conteo">' + rep.conteo.alto + ' de riesgo alto · ' + rep.conteo.medio + ' medio · ' + rep.conteo.bajo + ' bajo' +
                    (rep.conteo.propia ? ' · ' + rep.conteo.propia + ' del mismo solicitante' : '') +
                    (descartados ? ' · ' + descartados + ' descartado' + (descartados === 1 ? '' : 's') + ' por no parecerse' : '') + '</p></div>' +
                '</div>' +
                '<section class="vb-seccion"><h4>Fuentes consultadas</h4><ul class="vb-fuentes">' + rep.fuentes.map(f =>
                    '<li class="' + (f.ok ? 'vb-ok' : 'vb-falla') + '">' + (f.ok ? '✅ ' : '⚠️ ') + '<strong>' + esc(f.nombre) + '</strong> ' +
                    (f.ok ? esc(f.total + ' resultados revisados') : f.parcial ? esc(f.total + ' resultados revisados; a medias: ' + f.error) :
                        esc('sin respuesta' + (f.error ? ': ' + f.error : ''))) + '</li>').join('') +
                    (rep.fichas && rep.fichas.pedidas ? '<li class="' + (rep.fichas.leidas === rep.fichas.pedidas ? 'vb-ok' : 'vb-falla') + '">' +
                        (rep.fichas.leidas === rep.fichas.pedidas ? '✅ ' : '⚠️ ') + '<strong>Fichas de Marcanet</strong> ' +
                        esc(rep.fichas.leidas + ' de ' + rep.fichas.pedidas + ' (estatus y vigencia)') + '</li>' : '') +
                    (rep.fichasMARCia && rep.fichasMARCia.pedidas ? '<li class="' + (rep.fichasMARCia.leidas === rep.fichasMARCia.pedidas ? 'vb-ok' : 'vb-falla') + '">' +
                        (rep.fichasMARCia.leidas === rep.fichasMARCia.pedidas ? '✅ ' : '⚠️ ') + '<strong>Fichas de MARCia</strong> ' +
                        esc(rep.fichasMARCia.leidas + ' de ' + rep.fichasMARCia.pedidas + ' (clase y productos)') + '</li>' : '') + '</ul>' +
                    (puedeReintentar() ? '<p class="vb-reintentar"><button type="button" class="btn btn-sm btn-primary" data-vb="reintentar">🔄 Reintentar lo que faltó</button> ' +
                        '<small>Vuelve a pedir solo lo que no respondió. No cuenta como otro estudio.</small></p>' : '') + '</section>' +
                (rep.observaciones.length ? '<section class="vb-seccion"><h4>Sobre la denominación</h4><ul class="vb-observaciones">' +
                    rep.observaciones.map(o => '<li class="vb-obs-' + o.nivel + '"><span aria-hidden="true">' + ICONO_OBS[o.nivel] + '</span> ' + esc(o.texto) + '</li>').join('') + '</ul></section>' : '') +
                '<section class="vb-seccion"><h4>Antecedentes</h4>' +
                    '<p class="vb-nota">El parecido combina cómo se escribe y cómo suena en español; pesa más el principio de la palabra. Los umbrales son orientativos.</p>' +
                    tablaAntecedentes + notaMarcas + notaDescartados +
                    (bajos.length ? '<button type="button" class="btn btn-sm btn-secondary vb-mas" data-vb="ver-bajos">' +
                        (ui.verBajos ? 'Ocultar los de riesgo bajo' : 'Ver también los ' + bajos.length + ' de riesgo bajo') + '</button>' : '') +
                '</section>' +
                '<section class="vb-seccion"><h4>Publicaciones en Gaceta</h4>' + publicaciones + '</section>' +
                '<section class="vb-seccion"><h4>Recomendaciones</h4><ul class="vb-recomendaciones">' +
                    rep.recomendaciones.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul></section>' +
                '<section class="vb-seccion vb-guardar"><label for="vb-expediente">Guardar como nota del expediente</label>' +
                    '<div class="vb-guardar-fila"><select id="vb-expediente"><option value="">Sin expediente (nota general)</option></select>' +
                    '<button type="button" class="btn btn-sm btn-primary" data-vb="nota">📝 Guardar nota</button></div></section>' +
                '<p class="vb-aviso" role="note">⚠️ ' + esc(AVISO_VIABILIDAD) + '</p>' +
            '</article>';
        llenarExpedientes();
    }

    async function llenarExpedientes() {
        const sel = $('vb-expediente');
        if (!sel || typeof global.obtenerExpedientes !== 'function') return;
        const exps = await global.obtenerExpedientes().catch(() => []);
        for (const x of exps) {
            const op = document.createElement('option');
            op.value = x.id;
            op.textContent = (x.numero || x.nombre || 'Expediente') + (x.cliente ? ' — ' + x.cliente : '');
            sel.appendChild(op);
        }
    }

    // ---- Acciones ----

    async function alHacerClic(ev) {
        const b = ev.target.closest('[data-vb]');
        if (!b) return;
        const rep = ui.reporte;
        switch (b.dataset.vb) {
            case 'quitar-clase':
                ui.clases = ui.clases.filter(c => c !== Number(b.dataset.clase));
                return pintarClases();
            case 'ver-bajos':
                ui.verBajos = !ui.verBajos;
                return pintarReporte();
            case 'detalle':
                if (typeof global.cambiarTabIMPI === 'function') global.cambiarTabIMPI('marcia');
                if (typeof global.verDetalleMARCia === 'function') return global.verDetalleMARCia(b.dataset.id);
                return;
            case 'reintentar': return reintentar();
            case 'imprimir': return imprimir();
            case 'copiar': return copiar(resumenTexto(rep, fechaHora));
            case 'csv': return exportarCSV(rep);
            case 'vigilar': return vigilar(rep);
            case 'nota': return guardarNota(rep);
            case 'abrir-reciente': {
                const r = leerRecientes().find(x => x.id === b.dataset.id);
                if (!r) return;
                ui.reporte = r.reporte;
                ui.crudo = null;
                ui.verBajos = false;
                ponerEntrada(r.reporte.entrada);
                pintarReporte();
                return $('vb-reporte').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            case 'repetir-reciente': {
                const r = leerRecientes().find(x => x.id === b.dataset.id);
                if (!r) return;
                ponerEntrada(r.reporte.entrada);
                return ejecutar();
            }
            case 'borrar-recientes':
                try { localStorage.removeItem(CLAVE_RECIENTES); } catch (x) { /* nada que borrar */ }
                return pintarRecientes();
        }
    }

    function imprimir() {
        document.querySelectorAll('#vb-reporte details.vb-miembros').forEach(d => { d.open = true; });
        document.body.classList.add('imprimiendo-viabilidad');
        const quitar = () => { document.body.classList.remove('imprimiendo-viabilidad'); window.removeEventListener('afterprint', quitar); };
        window.addEventListener('afterprint', quitar);
        window.print();
        setTimeout(quitar, 1000);
    }

    async function copiar(texto) {
        try {
            await navigator.clipboard.writeText(texto);
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = texto;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (x) { /* sin portapapeles */ }
            ta.remove();
        }
        toast('Resumen copiado', 'success');
    }

    function exportarCSV(rep) {
        const celda = v => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const d = new Date(rep.fecha);
        const dia = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const filas = [['Estudio de viabilidad', rep.entrada.denominacion, 'Clases ' + rep.entrada.clases.join(' '), dia],
            ['Dictamen', rep.dictamen.titulo, rep.dictamen.resumen], ['Aviso', AVISO_VIABILIDAD], [],
            ['Riesgo', 'Marca', 'Expediente', 'Registro', 'Clases', 'Relación de clase', 'Estatus', 'Titular', 'Parecido (%)', 'Tipo de parecido', 'Por qué', 'Fuentes', 'Ampara', 'En Gaceta']];
        for (const a of rep.antecedentes) {
            filas.push([a.descartado ? 'descartado' : a.riesgo, a.titulo, a.expediente, a.registro, a.clases.join(' '), ETIQUETA_RELACION[a.relacion], a.estado,
                a.titulares.join('; '), a.similitud.puntaje, a.similitud.detalle, a.motivos.join('. '), a.fuentes.join(' '), a.ampara || '', historialTexto(a)]);
        }
        if (rep.publicaciones.length) {
            filas.push([], ['Publicaciones en Gaceta'], ['Denominación', 'Clases', 'Gaceta', 'Sección', 'Ejemplar', 'Fecha', 'Parecido (%)']);
            for (const p of rep.publicaciones) filas.push([p.denominacion, p.clases.join(' '), p.gaceta, p.seccion, p.ejemplar, p.fecha, p.similitud.puntaje]);
        }
        const nombre = 'viabilidad-' + (normalizarMarca(rep.entrada.denominacion).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'marca') +
            '-' + dia + '.csv';
        const contenido = '﻿' + filas.map(f => f.map(celda).join(',')).join('\r\n');
        if (typeof global.descargarArchivo === 'function') global.descargarArchivo(nombre, contenido, 'text/csv;charset=utf-8');
        toast('Exportado: ' + nombre, 'success');
    }

    /**
     * Deja vigilados, con la vigilancia que ya tiene la app: la denominación en
     * las Gacetas (para enterarse de solicitudes nuevas parecidas) y las
     * marcas de riesgo alto que vienen de MARCia (estatus y vencimiento).
     */
    function vigilar(rep) {
        if (typeof global.guardarBusqueda !== 'function') { toast('La vigilancia no está disponible', 'warning'); return; }
        const guardadas = (global.savedSearchesState && global.savedSearchesState.searches) || [];
        let nuevas = 0;
        const yaGaceta = guardadas.some(s => (s.tool || 'siga') === 'siga' && s.query === rep.entrada.denominacion && (s.area || '2') === '2');
        if (!yaGaceta) {
            const vistas = rep.fichasSIGA || [];
            global.guardarBusqueda('siga', {
                query: rep.entrada.denominacion, area: '2', fechaDesde: '', fechaHasta: '',
                label: rep.entrada.denominacion + ' (Marcas)', lastResultCount: vistas.length, lastFichaIds: vistas
            });
            nuevas++;
        }
        for (const a of rep.antecedentes.filter(x => x.riesgo === 'alto' && x.id).slice(0, 10)) {
            if (typeof global.marcaYaVigilada === 'function' && global.marcaYaVigilada(a.id)) continue;
            global.guardarBusqueda('marcia', {
                query: a.expediente || a.registro || a.id, subtype: 'marca', markId: a.id, label: a.titulo,
                lastStatus: a.estado || '', expiryDate: a.vencimiento || '', lastResultCount: 1
            });
            nuevas++;
        }
        if (!nuevas) toast('Ya vigilas la denominación y sus antecedentes de riesgo alto', 'info');
    }

    async function guardarNota(rep) {
        if (typeof global.crearNotaCore !== 'function') { toast('No se pueden crear notas', 'warning'); return; }
        const sel = $('vb-expediente');
        const expedienteId = sel && sel.value ? parseInt(sel.value, 10) : null;
        try {
            await global.crearNotaCore({
                titulo: 'Viabilidad de marca: ' + rep.entrada.denominacion + ' — ' + rep.dictamen.titulo,
                contenido: resumenTexto(rep, fechaHora),
                expedienteId
            });
            toast('Nota guardada', 'success');
        } catch (e) {
            toast('No se pudo guardar la nota: ' + e.message, 'error');
        }
    }

    // ---- Estudios recientes (solo en este navegador) ----

    function leerRecientes() {
        try { return JSON.parse(localStorage.getItem(CLAVE_RECIENTES) || '[]') || []; } catch (e) { return []; }
    }

    function guardarReciente(rep, reemplazar) {
        // Se guarda lo que se ve: los de riesgo bajo y poco parecidos no hacen falta.
        const ligero = { ...rep, antecedentes: rep.antecedentes.filter(a => a.riesgo !== 'bajo' || a.similitud.puntaje >= 60).slice(0, 80) };
        const anteriores = leerRecientes();
        // Reintentar lo que faltó completa el último estudio, no agrega otro.
        const lista = [{ id: reemplazar && anteriores[0] ? anteriores[0].id : Date.now().toString(36), reporte: ligero }]
            .concat(reemplazar ? anteriores.slice(1) : anteriores).slice(0, MAX_RECIENTES);
        try { localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(lista)); } catch (e) { /* lleno o modo privado: no pasa nada */ }
    }

    function pintarRecientes() {
        const cont = $('vb-recientes');
        if (!cont) return;
        const lista = leerRecientes();
        if (!lista.length) { cont.innerHTML = ''; return; }
        cont.innerHTML = '<div class="card vb-recientes"><div class="card-header"><h3>🕘 Estudios recientes</h3>' +
            '<button type="button" class="btn btn-sm btn-secondary" data-vb="borrar-recientes">Borrar lista</button></div><div class="card-body"><ul>' +
            lista.map(r => {
                const rep = r.reporte;
                return '<li><span class="vb-riesgo vb-dictamen-chip-' + rep.dictamen.nivel + '">' + esc(rep.dictamen.titulo) + '</span> ' +
                    '<strong>' + esc(rep.entrada.denominacion) + '</strong> <small>clases ' + esc(rep.entrada.clases.join(', ')) + ' · ' + esc(fechaHora(rep.fecha)) + '</small>' +
                    '<span class="vb-recientes-btns"><button type="button" class="btn btn-sm btn-secondary" data-vb="abrir-reciente" data-id="' + esc(r.id) + '">Abrir</button>' +
                    '<button type="button" class="btn btn-sm btn-secondary" data-vb="repetir-reciente" data-id="' + esc(r.id) + '">Repetir</button></span></li>';
            }).join('') + '</ul><p class="vb-nota">Se guardan solo en este navegador.</p></div></div>';
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', construir);
    else construir();

    global.VIABILIDAD = Object.assign({}, Motor, { ejecutar, construir, pintarReporte });
})(typeof window !== 'undefined' ? window : globalThis);
