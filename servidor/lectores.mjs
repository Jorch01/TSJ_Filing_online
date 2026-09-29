/**
 * Lectores de las publicaciones de los tribunales, para el revisor de
 * acuerdos nuevos (servidor en Oracle Cloud, región Querétaro).
 *
 * Cada lector recibe el HTML de la consulta y devuelve la lista de
 * publicaciones con un `id` estable: con él se sabe qué es nuevo comparando
 * contra lo que ya se vio. Las estructuras son las reales, vistas desde
 * Oracle Querétaro el 29-sep-2026:
 *
 *  - TSJ (estrados/buscador_*.php): tabla con encabezados en <th> y filas de
 *    8 celdas: IdAcuerdo, Documento, Juicio, Promoventes, Demandados,
 *    Extracto, Fecha Publicación (AAAA-MM-DD) y un enlace a gestión.
 *  - PJF (siseinternet/reportes/vercaptura.aspx): tabla id="grvAcuerdos" con
 *    todos los autos del expediente en una sola página: No., Fecha del Auto,
 *    Tipo Cuaderno, Fecha de publicación (DD-MM-AAAA, puede venir vacía),
 *    Resumen y un enlace "Ver" con DoVerAcuerdo(organismo, ?, idAuto, …).
 */

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü' };

export function textoPlano(html) {
    return String(html)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
            if (e[0] === '#') {
                const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
                return Number.isFinite(n) ? String.fromCodePoint(n) : m;
            }
            return ENTIDADES[e] !== undefined ? ENTIDADES[e] : m;
        })
        .replace(/\s+/g, ' ')
        .trim();
}

/** '21-12-2018' o '21/12/2018' → '2018-12-21'; lo que ya es AAAA-MM-DD se respeta. */
export function fechaISO(texto) {
    const t = String(texto || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(t);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
}

function filas(html) {
    return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
}

function celdas(fila) {
    return [...fila.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
}

// ==================== TSJ ====================

export function leerTSJ(html) {
    const publicaciones = [];
    for (const fila of filas(html)) {
        const c = celdas(fila).map(textoPlano);
        if (c.length < 7 || !/^\d+$/.test(c[0])) continue;
        const [idAcuerdo, documento, juicio, promoventes, demandados, extracto, fecha] = c;
        publicaciones.push({
            id: `tsj:${idAcuerdo}`,
            numero: idAcuerdo,
            fecha: fechaISO(fecha),
            documento, juicio, promoventes, demandados,
            texto: extracto
        });
    }
    return publicaciones;
}

export function sinResultadosTSJ(html) {
    return /no se encontr|ning[uú]n resultado|sin resultados|no existen registros/i.test(textoPlano(html));
}

// ==================== PJF ====================

/** Solo la tabla de autos: la página trae otras 40 tablas con datos del asunto. */
function tablaAutosPJF(html) {
    const t = String(html);
    const inicio = t.search(/<table\b[^>]*\bid=["']grvAcuerdos["']/i);
    if (inicio < 0) return null;
    let prof = 0;
    for (const m of t.slice(inicio).matchAll(/<(\/?)table\b/gi)) {
        prof += m[1] ? -1 : 1;
        if (prof === 0) return t.slice(inicio, inicio + m.index + m[0].length);
    }
    return t.slice(inicio);
}

export function leerPJF(html) {
    const tabla = tablaAutosPJF(html);
    if (!tabla) return [];
    const autos = [];
    for (const fila of filas(tabla)) {
        const crudas = celdas(fila);
        if (crudas.length < 5) continue;
        const c = crudas.map(textoPlano);
        if (!/^\d+$/.test(c[0])) continue;   // el encabezado usa <th>, pero por si acaso
        // DoVerAcuerdo(organismo, ?, idAuto, ...): el tercero identifica el auto.
        const ver = /DoVerAcuerdo\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(fila);
        const idInterno = ver ? ver[3] : null;
        autos.push({
            id: idInterno ? `pjf:${idInterno}` : `pjf:n${c[0]}:${fechaISO(c[1]) || c[1]}`,
            numero: c[0],
            fecha: fechaISO(c[3]) || fechaISO(c[1]),   // publicación; si no hay, la del auto
            fechaAuto: fechaISO(c[1]),
            fechaPublicacion: fechaISO(c[3]),
            cuaderno: c[2],
            texto: c[4].replace(/^\.\.\.\s*/, '')
        });
    }
    return autos;
}

/** ¿La página es la consulta de un expediente (aunque no tenga autos)? */
export function esConsultaPJF(html) {
    return /id=["']form1["']/i.test(html) && /lblNEUN|grvAcuerdos|Captura de Informaci/i.test(html);
}

// ==================== NOVEDADES ====================

/**
 * Lo nuevo respecto de lo ya visto. `vistos` es un Set de ids. La primera vez
 * (sin nada visto) no se avisa de todo el historial: solo se toma nota.
 */
export function novedades(publicaciones, vistos, { primeraVez = false } = {}) {
    if (primeraVez) return [];
    return publicaciones.filter(p => !vistos.has(p.id));
}
