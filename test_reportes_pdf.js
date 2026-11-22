#!/usr/bin/env node
/**
 * Pruebas de los reportes en PDF (docs/js/reportes-pdf.js).
 *
 *   node test_reportes_pdf.js
 *
 *  - El formato es el de los documentos de Empírica Legal Lab: hoja carta,
 *    sus márgenes y colores, membrete con logo, pie con documento, cliente y
 *    «n / total».
 *  - Los reportes no llevan firmas y cierran con el aviso que pidió Empírica:
 *    tienen reservas, deben revisarse antes de decidir, no son opinión
 *    jurídica y pueden presentarlos terceros que no son Empírica.
 *  - El estudio de viabilidad lleva lo que se ve en pantalla, sin las
 *    instrucciones que solo tienen sentido en la app.
 *  - Si pdfmake está instalado (lo instala CI), se genera un PDF de verdad
 *    con las fuentes y el logo de docs/assets/empirica/.
 *
 * Se carga el código real de docs/js/.
 */

const fs = require('fs');
const path = require('path');

const R = require('./docs/js/reportes-pdf.js');
const V = require('./docs/js/impi-viabilidad.js');

let pasadas = 0;
const fallos = [];
function verificar(d, c, det) { if (c) { pasadas++; return; } fallos.push(d + (det ? `\n      ${det}` : '')); }
function igual(d, real, esperado) {
    verificar(d, JSON.stringify(real) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}

// Todo el texto de una definición de pdfmake, en orden.
function textoDe(nodo) {
    if (nodo == null) return '';
    if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo);
    if (Array.isArray(nodo)) return nodo.map(textoDe).join(' ');
    if (typeof nodo === 'object') {
        return ['text', 'stack', 'columns', 'ul', 'table', 'body'].map(k => (k in nodo ? textoDe(nodo[k]) : '')).join(' ');
    }
    return '';
}

const AHORA = new Date(2026, 10, 22, 10, 35).getTime();
const entrada = { denominacion: 'Lunafardo', clases: [43], tipo: 'mixta', productos: 'Restaurante de comida argentina', solicitante: 'Juan Pérez Ruiz' };
const crudo = {
    marcia: [{ clase: 43, resultados: [
        { id: 'RM201101204050', applicationNumber: '1204050', registrationNumber: '1261657', title: 'LUNFARDO', status: 'REGISTRADO', owners: ['RESTAURANTES DEL SUR'], dates: { application: '18/08/2011', expiry: '18/08/2031' }, classes: [43] },
        { id: 'RM202503417716', applicationNumber: '3417716', title: 'LUNA FARDO', status: 'EN TRÁMITE', owners: ['MARÍA GONZÁLEZ'], dates: { application: '07/05/2025' }, classes: [43] },
        { id: 'RM200000000001', applicationNumber: '1', title: 'ZAPATERÍA EL SOL', status: 'REGISTRADO', owners: ['OTRA'], dates: {}, classes: [25] }
    ] }],
    marcanet: [], siga: [],
    fuentes: { MARCia: { ok: true, total: 57 }, Marcanet: { ok: true, total: 12 }, SIGA: { ok: false, error: 'tiempo de espera agotado' } }
};
const rep = V.analizar(entrada, crudo, AHORA);

console.log('\nEl formato de Empírica');
{
    igual('hoja carta con los márgenes de la plantilla', [R.MARGENES, R.ANCHO], [[57, 50, 56, 72], 499]);
    igual('los colores de la plantilla', [R.COLOR.verde, R.COLOR.tinta, R.COLOR.tinta2, R.COLOR.pie, R.COLOR.filete, R.COLOR.fondo],
        ['#1E3F39', '#111111', '#3A3A3A', '#5A5A5A', '#CBD8D4', '#E9F0EE']);
    igual('Lora para el cuerpo e Inter para los datos', Object.keys(R.FUENTES), ['Lora', 'Inter']);
    verificar('las fuentes y el logo están en la app', R.ARCHIVOS_FUENTES.every(f => fs.existsSync(path.join(__dirname, 'docs', 'assets', 'empirica', 'fuentes', f))) &&
        fs.existsSync(path.join(__dirname, 'docs', 'assets', 'empirica', 'logo-empirica.png')));
    verificar('pdfmake se carga con su huella de integridad', /^sha384-/.test(R.PDFMAKE.integridad) && R.PDFMAKE.url.includes('@' + R.PDFMAKE.version + '/'));

    const doc = R.documentoViabilidad(rep, { logo: 'data:image/png;base64,AAAA', para: 'Juan Pérez Ruiz', presentadoPor: 'Lic. Ana Torres', viabilidad: V });
    igual('carta, márgenes y letra del cuerpo', [doc.pageSize, doc.pageMargins, doc.defaultStyle.font, doc.defaultStyle.fontSize], ['LETTER', [57, 50, 56, 72], 'Lora', 11.5]);
    igual('autor del PDF', doc.info.author, 'Empírica Legal Lab');
    const membrete = doc.content[0];
    verificar('membrete: logo de 56 × 51 pt', membrete.columns[0].image === 'data:image/png;base64,AAAA' && membrete.columns[0].width === 56 && membrete.columns[0].height === 51);
    verificar('membrete: EMPÍRICA LEGAL LAB y sus datos', /EMPÍRICA LEGAL LAB/.test(textoDe(membrete)) && /www\.empirica\.mx/.test(textoDe(membrete)));
    const pie = doc.footer(2, 5);
    igual('pie: documento y cliente a la izquierda, n / total a la derecha',
        [pie.stack[1].columns[0].text, pie.stack[1].columns[1].text], ['Empírica Legal Lab · Estudio de viabilidad de marca · Juan Pérez Ruiz', '2 / 5']);
    igual('pie en Inter 7.5 pt', [pie.stack[1].font, pie.stack[1].fontSize], ['Inter', 7.5]);
    verificar('un título de sección no se queda solo al pie de una hoja',
        doc.pageBreakBefore({ headlineLevel: 1 }, []) === true && doc.pageBreakBefore({ headlineLevel: 1 }, [{}]) === false && doc.pageBreakBefore({}, []) === false);
    const sinCliente = R.documentoViabilidad(rep, { viabilidad: V });
    igual('sin cliente, el pie lleva la denominación', sinCliente.footer(1, 1).stack[1].columns[0].text, 'Empírica Legal Lab · Estudio de viabilidad de marca · «Lunafardo»');
}

console.log('\nEl estudio de viabilidad');
{
    const doc = R.documentoViabilidad(rep, { para: 'Juan Pérez Ruiz', presentadoPor: 'Lic. Ana Torres', viabilidad: V });
    const t = textoDe(doc.content);
    verificar('para quién y quién lo presenta', /JUAN PÉREZ RUIZ/.test(t) && /Presentado por: Lic\. Ana Torres/.test(t));
    verificar('asunto: denominación, tipo y clase', /«Lunafardo»/.test(t) && /como marca mixta/.test(t) && /la clase 43/.test(t) && /Clasificación de Niza/.test(t));
    const secciones = doc.content.filter(n => n.headlineLevel === 1).map(n => textoDe(n).trim());
    igual('secciones en orden', secciones.map(s => s.replace(/^\d+\.\s+/, '')),
        ['Resultado', 'Sobre la denominación', 'Antecedentes a revisar', 'Recomendaciones', 'Fuentes y alcance']);
    verificar('el resultado y su resumen', t.includes(rep.dictamen.titulo) && t.includes(rep.dictamen.resumen.split(':')[0]));
    const tabla = doc.content.find(n => n.table && n.table.headerRows === 1 && /MARCA/.test(textoDe(n.table.body[0])));
    igual('una fila por marca a revisar (las de riesgo bajo y poco parecidas no)', tabla.table.body.length - 1, 2);
    verificar('la cabecera de la tabla es verde con texto blanco', tabla.table.body[0].every(c => c.fillColor === '#1E3F39' && c.color === '#FFFFFF'));
    verificar('las filas no se parten entre hojas', tabla.table.dontBreakRows === true);
    verificar('las fuentes, con lo que no respondió', /MARCia:/.test(t) && /57 resultados/.test(t) && /SIGA:/.test(t) && /no respondió/.test(t));
    verificar('la fecha de corte de la consulta', /22 de noviembre de 2026 a las 10:35 h/.test(t));
    verificar('sin las instrucciones de la app', !/Reintentar lo que faltó/.test(t) && /conviene repetir el estudio cuando respondan todas las fuentes/.test(t));
    verificar('sin firmas', !/Jorge Israel Clemente|Frida Delgado|Socio Fundador/.test(t));
}

console.log('\nLos logotipos parecidos');
// Un PNG de 1 × 1, como el que da /marcia/miniatura convertido a data URL.
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const conLogo = V.analizar({ ...entrada, conLogotipo: true }, { ...crudo, logotipo: {
    ok: true, indexacion: '02 Feb 2020', miniatura: PNG_1PX,
    lotes: [{ clase: 43, total: 800, resultados: [
        { id: 'RM202002404330', applicationNumber: '2404330', title: 'THE GLAMPING COMPANY', status: 'EN TRÁMITE', owners: ['LUIS FERNANDO RUBIO FLORES'], dates: { application: '13/8/2020' }, classes: [], images: '/marcas/image/RM202002404330' },
        { id: 'RM202002377940', applicationNumber: '2377940', registrationNumber: '2147989', title: 'INEDIA', status: 'REGISTRADO', owners: ['ANA AURORA LORENZO MEJIA'], dates: { application: '13/7/2020' }, classes: [], images: '/marcas/image/RM202002377940' }
    ] }]
} }, AHORA);
{
    const doc = R.documentoViabilidad(conLogo, { viabilidad: V, imagenes: { RM202002404330: PNG_1PX } });
    const t = textoDe(doc.content);
    const secciones = doc.content.filter(n => n.headlineLevel === 1).map(n => textoDe(n).trim().replace(/^\d+\.\s+/, ''));
    igual('va después de los antecedentes', secciones, ['Resultado', 'Sobre la denominación', 'Antecedentes a revisar', 'Logotipos parecidos', 'Recomendaciones', 'Fuentes y alcance']);
    verificar('explica que MARCia solo ordena y que no se califican', /no mide cuánto se parecen/.test(t) && /no se califican ni cuentan en el resultado del estudio/.test(t) && /revisarse a ojo/.test(t));
    verificar('con la indexación que declara MARCia', /«02 Feb 2020»/.test(t) && /13\/08\/2020/.test(t));
    verificar('el párrafo inicial dice que el logotipo se buscó aparte', /El logotipo se buscó aparte, con la búsqueda por imagen de MARCia/.test(t));
    const tabla = doc.content.find(n => n.table && n.table.headerRows === 1 && /LOGOTIPO/.test(textoDe(n.table.body[0])));
    igual('una fila por logotipo', tabla && tabla.table.body.length - 1, 2);
    igual('con su imagen, si se pudo traer', tabla && tabla.table.body[1][0].image, PNG_1PX);
    verificar('y «Sin imagen» si no', tabla && /Sin imagen/.test(textoDe(tabla.table.body[2][0])));
    verificar('con su lugar en MARCia', tabla && /1\.º/.test(textoDe(tabla.table.body[1][4])) && /2\.º/.test(textoDe(tabla.table.body[2][4])));
    const cab = doc.content.find(n => n.columns && n.columns[0].stack && n.columns[0].stack[0].image);
    igual('el logotipo buscado va junto a la explicación', cab && cab.columns[0].stack[0].image, PNG_1PX);
    verificar('las fuentes dicen cuántos se revisaron y que el diseño no se califica', /Búsqueda por imagen \(MARCia\):\s+2 logotipos entre los primeros 12/.test(t) && /el logotipo se buscó aparte, por imagen, y sus resultados no se califican/.test(t));
    const fallo = V.analizar({ ...entrada, conLogotipo: true }, { ...crudo, logotipo: { ok: false, error: 'MARCia respondió vacío', lotes: [] } }, AHORA);
    const tf = textoDe(R.documentoViabilidad(fallo, { viabilidad: V }).content);
    verificar('si la búsqueda falló, lo dice sin botones de la app', /La búsqueda del logotipo por imagen en MARCia no respondió \(MARCia respondió vacío\)/.test(tf) && !/Reintentar lo que faltó/.test(tf), tf.slice(0, 200));
    const sinLogo = textoDe(R.documentoViabilidad(rep, { viabilidad: V }).content);
    verificar('sin logotipo no hay sección y pide la búsqueda figurativa', !/Logotipos parecidos/.test(sinLogo) && /requiere una búsqueda figurativa por separado/.test(sinLogo));
    igual('caben hasta 24', R.MAX_LOGOS_PDF, 24);
}

console.log('\nEl aviso');
{
    const doc = R.documentoViabilidad(rep, { viabilidad: V });
    const aviso = doc.content[doc.content.length - 1];
    const t = textoDe(aviso);
    verificar('va al final, en un recuadro que no se parte', aviso.unbreakable === true && aviso.table.body[0][0].fillColor === '#E9F0EE');
    verificar('rótulo AVISO IMPORTANTE', /AVISO IMPORTANTE/.test(t));
    verificar('tiene reservas: depende de sistemas del IMPI que pueden fallar', /Tiene reservas\./.test(t) && /incompletos, desactualizados o fallar/.test(t));
    verificar('debe revisarse antes de decidir', /Debe revisarse antes de decidir\./.test(t) && /profesional en propiedad industrial/.test(t));
    verificar('no es opinión jurídica ni garantía', /No es una opinión jurídica\./.test(t) && /garantía de registro/.test(t));
    verificar('Empírica presta el servicio; pueden presentarlo terceros', /Empírica Legal Lab presta el servicio/.test(t) && /presentado por terceros que no son Empírica Legal Lab/.test(t));
    verificar('en ese caso Empírica no lo emite ni responde', /no lo emite, no lo revisó ni asume responsabilidad/.test(t));
}

console.log('\nNombres de archivo y fechas');
{
    igual('nombre de archivo legible, sin signos prohibidos ni acentos (con acento, Chrome lo guarda como «download»)',
        R.nombreArchivo(['Estudio de viabilidad', 'Luna/Sol: "Café"', 'Juan López Ñuñez', ''], '2026-11-22'),
        'Estudio de viabilidad - LunaSol Cafe - Juan Lopez Nunez - 2026-11-22.pdf');
    igual('fecha larga en español', R.fechaLarga('2026-11-22'), '22 de noviembre de 2026');
    igual('un día suelto es del calendario local (no se recorre al día anterior)', R.fechaCorta('2026-01-01'), '01/01/2026');
    igual('listas en español', [R.enLista([3]), R.enLista([3, 5]), R.enLista([3, 5, 10])], ['3', '3 y 5', '3, 5 y 10']);
}

// ---- Con pdfmake de verdad (si está instalado) ----
(async () => {
    let pdfMake = null;
    try { pdfMake = require('pdfmake/build/pdfmake'); } catch (e) { pdfMake = null; }
    if (!pdfMake) {
        console.log('\n  (pdfmake no está instalado: no se genera el PDF de prueba; en CI sí)');
    } else {
        console.log('\nUn PDF de verdad');
        const activos = path.join(__dirname, 'docs', 'assets', 'empirica');
        const vfs = {};
        for (const f of R.ARCHIVOS_FUENTES) vfs[f] = fs.readFileSync(path.join(activos, 'fuentes', f)).toString('base64');
        const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(activos, 'logo-empirica.png')).toString('base64');
        const pdf = await new Promise((resolve, reject) => {
            try {
                pdfMake.createPdf(R.documentoViabilidad(rep, { logo, para: 'Juan Pérez Ruiz', viabilidad: V }), null, R.FUENTES, vfs).getBuffer(resolve);
            } catch (e) { reject(e); }
        });
        const bytes = Buffer.from(pdf);
        const crudoPdf = bytes.toString('latin1');
        verificar('es un PDF', crudoPdf.startsWith('%PDF-'));
        verificar('lleva las fuentes de Empírica incrustadas', /Lora-Regular/.test(crudoPdf) && /Inter/.test(crudoPdf));
        verificar('y el logo', /\/Subtype\s*\/Image/.test(crudoPdf));
        const paginas = (crudoPdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
        verificar('ocupa varias hojas carta', paginas >= 2 && /\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/.test(crudoPdf), 'páginas: ' + paginas);
        const conImagenes = await new Promise((resolve, reject) => {
            try {
                pdfMake.createPdf(R.documentoViabilidad(conLogo, { logo, viabilidad: V, imagenes: { RM202002404330: PNG_1PX } }), null, R.FUENTES, vfs).getBuffer(resolve);
            } catch (e) { reject(e); }
        });
        const crudoLogo = Buffer.from(conImagenes).toString('latin1');
        verificar('con logotipos, también sale el PDF, con sus imágenes', crudoLogo.startsWith('%PDF-') && (crudoLogo.match(/\/Subtype\s*\/Image/g) || []).length >= 3);
    }

    console.log(`\n  ${pasadas} pasadas, ${fallos.length} fallidas\n`);
    if (fallos.length) {
        fallos.forEach(f => console.log('   ✗ ' + f));
        process.exit(1);
    }
    console.log('  ✓ Los reportes salen con el formato de Empírica y con su aviso\n');
})().catch(e => { console.error(e); process.exit(1); });
