/**
 * Reportes en PDF con el formato de Empírica Legal Lab.
 *
 * Los PDF que salen de la app hacia un cliente (el estudio de viabilidad de
 * una marca, el reporte de una cartera de marcas) llevan el diseño de los
 * documentos de Empírica:
 *  - hoja carta;
 *  - membrete con el logo solo en la primera hoja;
 *  - verde institucional, cuerpo en Lora y datos en Inter;
 *  - rótulos en versalitas y tablas con cabecera verde;
 *  - en cada hoja, el pie «Empírica Legal Lab · documento · cliente» con el
 *    número de página.
 *
 * Empírica Legal Lab presta el servicio de la herramienta, pero quien genera
 * y presenta el reporte puede ser un tercero. Por eso no lleva firmas y
 * cierra con un aviso: los resultados son orientativos, tienen reservas y
 * deben revisarse antes de decidir nada, y quien lo presenta no es
 * necesariamente Empírica.
 *
 * El PDF se arma en el navegador con pdfmake. Se descarga la primera vez que
 * se pide uno, junto con las fuentes y el logo de docs/assets/empirica/.
 *
 * Dos partes:
 *  - los documentos, puros: reciben los datos y devuelven la definición del
 *    PDF. Se prueban en Node sin pdfmake;
 *  - el motor, que carga pdfmake, las fuentes y el logo, y entrega el PDF.
 */
(function (global) {
    'use strict';

    const PDFMAKE = {
        version: '0.2.20',
        url: 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.20/build/pdfmake.min.js',
        integridad: 'sha384-G23ofMOEI98f9UnroUBjDi6Ll55Y5E6bOX4VAMJo0nIbuQRIxzn0g4athUOb58zs'
    };
    const RUTA_ACTIVOS = 'assets/empirica/';
    const ARCHIVOS_FUENTES = ['Lora-Regular.ttf', 'Lora-Bold.ttf', 'Lora-Italic.ttf', 'Inter-Regular.ttf', 'Inter-SemiBold.ttf'];
    // Lora no trae negrita cursiva ni Inter cursiva: se usan las más cercanas.
    const FUENTES = {
        Lora: { normal: 'Lora-Regular.ttf', bold: 'Lora-Bold.ttf', italics: 'Lora-Italic.ttf', bolditalics: 'Lora-Bold.ttf' },
        Inter: { normal: 'Inter-Regular.ttf', bold: 'Inter-SemiBold.ttf', italics: 'Inter-Regular.ttf', bolditalics: 'Inter-SemiBold.ttf' }
    };

    // Los colores de la plantilla de Empírica, sin aclarar ninguno: se imprimen.
    const COLOR = {
        verde: '#1E3F39', tinta: '#111111', tinta2: '#3A3A3A', pie: '#5A5A5A',
        filete: '#CBD8D4', fondo: '#E9F0EE', blanco: '#FFFFFF'
    };
    const EMPIRICA = {
        nombre: 'EMPÍRICA LEGAL LAB',
        marca: 'Empírica Legal Lab',
        datos: 'SM 313, Mz. 22, Lote 2, Av. Fonatur\nCancún, Quintana Roo, México\nwww.empirica.mx · +52 998 139 9930'
    };
    // Hoja carta (612 × 792 pt) con los márgenes de la plantilla: 50 arriba,
    // 56 a la derecha, 72 abajo y 57 a la izquierda.
    const MARGENES = [57, 50, 56, 72];
    const ANCHO = 612 - MARGENES[0] - MARGENES[2];

    // La plantilla da el interlineado como en CSS (veces el tamaño de letra).
    // pdfmake lo multiplica por el interlineado propio de la fuente, que en
    // Lora ya es 1.28 y en Inter 1.21: se convierte para que mida lo mismo.
    const INTERLINEA_LORA = 1.28;
    const INTERLINEA_INTER = 1.21;
    const lh = (css, fuente) => Math.round(css / (fuente === 'Inter' ? INTERLINEA_INTER : INTERLINEA_LORA) * 100) / 100;

    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    /** "2026-11-22" o un ISO completo → «22 de noviembre de 2026». */
    function fechaLarga(valor) {
        const d = aFecha(valor);
        return d ? d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear() : '';
    }

    /** "2026-11-22" → «22/11/2026», para tablas. */
    function fechaCorta(valor) {
        const d = aFecha(valor);
        if (!d) return '';
        const p2 = n => String(n).padStart(2, '0');
        return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
    }

    function horaDe(valor) {
        const d = aFecha(valor);
        if (!d || /^\d{4}-\d{2}-\d{2}$/.test(String(valor))) return '';
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' h';
    }

    // Un día suelto es del calendario local: con new Date("2026-11-22") sería
    // la medianoche de Greenwich, que en México todavía es el día anterior.
    function aFecha(valor) {
        if (!valor) return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor));
        const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(valor);
        return isNaN(d.getTime()) ? null : d;
    }

    const texto = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

    // Lista en español: «3, 5 y 10».
    function enLista(xs) {
        const v = (xs || []).map(String).filter(Boolean);
        return v.length > 1 ? v.slice(0, -1).join(', ') + ' y ' + v[v.length - 1] : (v[0] || '');
    }

    // ==================== BLOQUES DEL FORMATO ====================

    /** Rótulo en versalitas: Inter SemiBold 8 pt, verde, espaciado amplio. */
    function rotulo(contenido, extra) {
        return Object.assign({
            text: String(contenido).toUpperCase(), font: 'Inter', bold: true, fontSize: 8,
            characterSpacing: 1.76, color: COLOR.verde, lineHeight: 1
        }, extra || {});
    }

    function parrafo(contenido, extra) {
        return Object.assign({ text: contenido, alignment: 'justify', margin: [0, 0, 0, 8] }, extra || {});
    }

    function filete(color, grosor, margen) {
        return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: ANCHO, y2: 0, lineWidth: grosor, lineColor: color }], margin: margen || [0, 0, 0, 0] };
    }

    /** El membrete: logo a la izquierda; nombre y datos de Empírica a la derecha; línea verde. */
    function membrete(logo) {
        return [
            {
                columns: [
                    logo ? { image: logo, width: 56, height: 51 } : { text: '', width: 56 },
                    {
                        width: '*',
                        stack: [
                            { text: EMPIRICA.nombre, bold: true, fontSize: 15, characterSpacing: 1.05, color: COLOR.verde,
                                alignment: 'right', lineHeight: lh(1.2), margin: [0, 0, 0, 4] },
                            { text: EMPIRICA.datos, font: 'Inter', fontSize: 8, color: COLOR.tinta2, alignment: 'right', lineHeight: lh(1.5, 'Inter') }
                        ]
                    }
                ]
            },
            filete(COLOR.verde, 1, [0, 8, 0, 18])
        ];
    }

    /** Recuadro con fondo verde claro, rótulo arriba y texto en Lora 11 pt (la caja de ASUNTO). */
    function caja(titulo, contenido, extra) {
        return Object.assign({
            table: {
                widths: ['*'],
                body: [[{
                    stack: [rotulo(titulo, { margin: [0, 0, 0, 4] }), { text: contenido, fontSize: 11, lineHeight: lh(1.45) }],
                    fillColor: COLOR.fondo
                }]]
            },
            layout: sinBordes(12, 10, 12, 11),
            margin: [0, 0, 0, 16]
        }, extra || {});
    }

    function sinBordes(izq, arriba, der, abajo) {
        return {
            hLineWidth: () => 0, vLineWidth: () => 0,
            paddingLeft: () => izq, paddingRight: () => der, paddingTop: () => arriba, paddingBottom: () => abajo
        };
    }

    /**
     * Título de sección: «1.  Título» en Lora Bold 13 pt verde con filete
     * debajo. Es un solo nodo (una tabla de una celda con borde inferior) para
     * que pageBreakBefore lo pase a la hoja siguiente si quedaría solo al pie.
     */
    function seccion(numero, titulo) {
        return {
            table: { widths: ['*'], body: [[{ text: numero + '.  ' + titulo, bold: true, fontSize: 13, color: COLOR.verde, lineHeight: lh(1.15) }]] },
            layout: {
                hLineWidth: (i, node) => (i === node.table.body.length ? 0.8 : 0), vLineWidth: () => 0,
                hLineColor: () => COLOR.filete,
                paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 4
            },
            margin: [0, 20, 0, 10],
            headlineLevel: 1
        };
    }

    function subtitulo(contenido) {
        return { text: contenido, bold: true, fontSize: 11.5, margin: [0, 12, 0, 8], headlineLevel: 1 };
    }

    /** Viñetas: cuadritos verdes; con `negrita`, la entrada empieza en negrita. */
    function vinetas(items) {
        return {
            ul: (items || []).map(it => ({
                text: typeof it === 'string' ? it : [{ text: it.negrita + ' ', bold: true }, it.texto],
                alignment: 'justify', margin: [0, 0, 0, 5]
            })),
            type: 'square', markerColor: COLOR.verde, margin: [0, 0, 0, 8]
        };
    }

    /**
     * Tabla con cabecera verde y rótulos blancos en versalitas; celdas en
     * Lora 10.5 pt con filetes. Una fila no se parte entre dos hojas y la
     * cabecera se repite en cada hoja.
     */
    function tabla(cabeceras, filas, anchos) {
        return {
            table: {
                headerRows: 1,
                dontBreakRows: true,
                widths: anchos || cabeceras.map(() => '*'),
                body: [
                    cabeceras.map(c => ({ text: String(c).toUpperCase(), font: 'Inter', bold: true, fontSize: 8,
                        characterSpacing: 1.44, color: COLOR.blanco, fillColor: COLOR.verde, lineHeight: 1.1 })),
                    ...filas
                ]
            },
            layout: {
                hLineWidth: () => 0.6, vLineWidth: () => 0.6,
                hLineColor: i => (i <= 1 ? COLOR.verde : COLOR.filete),
                vLineColor: (i, node, fila) => (fila === 0 ? COLOR.verde : COLOR.filete),
                paddingLeft: () => 10, paddingRight: () => 10,
                paddingTop: i => (i === 0 ? 6 : 7), paddingBottom: i => (i === 0 ? 6 : 7)
            },
            fontSize: 10.5, lineHeight: lh(1.4),
            margin: [0, 0, 0, 6]
        };
    }

    /** Celda de tabla: lo principal en Lora y, debajo, datos menores en Inter 9 pt. */
    function celda(principal, menores, extra) {
        const partes = [];
        if (principal && typeof principal === 'object' && !Array.isArray(principal)) partes.push(principal);
        else if (principal) partes.push({ text: principal });
        for (const m of (menores || []).filter(Boolean)) {
            partes.push({ text: m, font: 'Inter', fontSize: 9, color: COLOR.tinta2, lineHeight: lh(1.45, 'Inter'), margin: [0, 2, 0, 0] });
        }
        return Object.assign({ stack: partes.length ? partes : [{ text: '—' }] }, extra || {});
    }

    /**
     * El recuadro del resultado (en la plantilla, el de honorarios): franja
     * verde claro con el rótulo a la izquierda y el resultado a la derecha en
     * Lora Bold 14 pt, y debajo el cuerpo con borde.
     */
    function recuadro(titulo, valor, cuerpo) {
        return {
            table: {
                widths: ['*'],
                body: [
                    [{
                        columns: [
                            { width: 'auto', stack: [rotulo(titulo, { margin: [0, 5, 0, 0] })] },
                            { width: '*', text: valor, bold: true, fontSize: 14, alignment: 'right', lineHeight: lh(1.2) }
                        ],
                        fillColor: COLOR.fondo, margin: [12, 8, 12, 8]
                    }],
                    [{ stack: cuerpo, fontSize: 10.5, lineHeight: lh(1.45), margin: [12, 10, 12, 4] }]
                ]
            },
            layout: {
                hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.8 : 0),
                vLineWidth: () => 0.8,
                hLineColor: () => COLOR.filete, vLineColor: () => COLOR.filete,
                paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0
            },
            margin: [0, 0, 0, 12]
        };
    }

    /** El aviso final: recuadro verde claro que no se parte entre hojas. */
    function aviso(titulo, puntos) {
        return {
            unbreakable: true,
            margin: [0, 24, 0, 0],
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        rotulo(titulo, { margin: [0, 0, 0, 6] }),
                        ...puntos.map((p, i) => ({
                            text: typeof p === 'string' ? p : [{ text: p.negrita + ' ', bold: true }, p.texto],
                            fontSize: 10.5, lineHeight: lh(1.45), alignment: 'justify', margin: [0, 0, 0, i === puntos.length - 1 ? 0 : 6]
                        }))
                    ],
                    fillColor: COLOR.fondo
                }]]
            },
            layout: sinBordes(12, 10, 12, 11)
        };
    }

    /** Pie de todas las hojas: filete; a la izquierda el documento y a la derecha «n / total». */
    function pie(tipo, cliente) {
        const izquierda = [EMPIRICA.marca, tipo, cliente].map(texto).filter(Boolean).join(' · ');
        return (actual, total) => ({
            margin: [MARGENES[0], 12, MARGENES[2], 0],
            stack: [
                filete(COLOR.filete, 0.8),
                {
                    columns: [
                        { width: '75%', text: izquierda },
                        { width: '25%', text: actual + ' / ' + total, alignment: 'right' }
                    ],
                    font: 'Inter', fontSize: 7.5, color: COLOR.pie, margin: [0, 7, 0, 0]
                }
            ]
        });
    }

    /**
     * El documento completo con el formato de Empírica.
     * { titulo, tipo, cliente, logo, fecha, para, presentadoPor, asunto, contenido }
     */
    function documento(d) {
        const cabeza = [];
        cabeza.push({ text: fechaLarga(d.fecha) + '.', alignment: 'right', margin: [0, 0, 0, 16] });
        if (texto(d.para)) cabeza.push({ text: texto(d.para).toUpperCase(), bold: true, fontSize: 12, lineHeight: lh(1.35), margin: [0, 0, 0, 3] });
        if (texto(d.presentadoPor)) {
            cabeza.push({ text: 'Presentado por: ' + texto(d.presentadoPor), font: 'Inter', fontSize: 9.5, color: COLOR.tinta2, margin: [0, 3, 0, 0] });
        }
        if (cabeza.length > 1) cabeza[cabeza.length - 1].margin = [0, cabeza[cabeza.length - 1].margin[1], 0, 16];
        return {
            pageSize: 'LETTER',
            pageMargins: MARGENES.slice(),
            info: {
                title: d.titulo, author: EMPIRICA.marca, subject: d.tipo,
                creator: 'TSJ Filing Online · ' + EMPIRICA.marca, producer: 'TSJ Filing Online'
            },
            defaultStyle: { font: 'Lora', fontSize: 11.5, lineHeight: lh(1.52), color: COLOR.tinta },
            footer: pie(d.tipo, d.cliente),
            // Un título de sección no se queda solo al pie de una hoja.
            pageBreakBefore: (nodo, siguientes) => nodo.headlineLevel === 1 && siguientes.length === 0,
            content: [...membrete(d.logo), ...cabeza, ...(d.asunto ? [caja('Asunto', d.asunto)] : []), ...d.contenido]
        };
    }

    // ==================== AVISOS ====================

    // Lo que tiene que quedar claro en cualquier reporte, con lo propio de cada uno.
    function puntosDeAviso(propios) {
        return [
            ...propios,
            { negrita: 'Debe revisarse antes de decidir.', texto: 'Antes de tomar cualquier decisión con base en este documento (presentar una solicitud, invertir en una marca, oponerse a otra, iniciar un procedimiento o dejar de atender un plazo), un profesional en propiedad industrial debe revisarlo con cuidado y confirmar en las fichas oficiales del IMPI los estatus, las fechas y los productos o servicios amparados.' },
            { negrita: 'No es una opinión jurídica.', texto: 'No constituye asesoría legal, dictamen, ni garantía de registro o de resultado alguno.' },
            { negrita: 'Quién lo presenta.', texto: EMPIRICA.marca + ' presta el servicio de la herramienta tecnológica con la que se generó este documento. Puede ser presentado por terceros que no son ' + EMPIRICA.marca + '; en ese caso, ' + EMPIRICA.marca + ' no lo emite, no lo revisó ni asume responsabilidad por su contenido, su uso o las decisiones que se tomen con base en él.' }
        ];
    }

    const AVISO_FUENTES = 'Tiene reservas.';
    // Los logotipos parecidos que caben en el PDF (cada uno lleva su imagen).
    const MAX_LOGOS_PDF = 24;

    // ==================== ESTUDIO DE VIABILIDAD ====================

    const NIVEL_RIESGO = { alto: 'Alto', medio: 'Medio', propia: 'Del solicitante', bajo: 'Bajo' };
    const RELACION = { misma: 'misma clase', relacionada: 'clase relacionada', distinta: 'otra clase', desconocida: 'clase sin dato' };
    const TIPO_MARCA = { nominativa: 'nominativa', mixta: 'mixta', figurativa: 'figurativa', tridimensional: 'tridimensional' };
    const NIVEL_OBSERVACION = { alto: 'Impedimento probable.', medio: 'A considerar.', info: 'Nota.' };

    const numerosDe = a => [a.registro ? 'Reg. ' + a.registro : '', a.expediente ? 'Exp. ' + a.expediente : ''].filter(Boolean).join(' · ');

    function conPunto(t) {
        const v = texto(t);
        return v && !/[.!?…)]$/.test(v) ? v + '.' : v;
    }

    // Las recomendaciones del estudio en pantalla nombran botones de la app
    // («Reintentar lo que faltó»): en un documento para el cliente no aplican.
    function paraElDocumento(r) {
        if (/Reintentar lo que faltó/.test(r)) return texto(r.split(':')[0]) + ': conviene repetir el estudio cuando respondan todas las fuentes.';
        return r;
    }

    /**
     * El estudio de viabilidad de una marca. `rep`: el reporte de VIABILIDAD.analizar.
     * opciones: { logo, para, presentadoPor, viabilidad (el motor, para Node) }
     */
    function documentoViabilidad(rep, opciones) {
        const o = opciones || {};
        const V = o.viabilidad || global.VIABILIDAD;
        const e = rep.entrada;
        const d = rep.dictamen;
        const marcas = V.agruparMarcas(rep.antecedentes).filter(a => !a.descartado);
        const relevantes = marcas.filter(a => a.riesgo !== 'bajo' || a.similitud.puntaje >= 75);
        const bajos = marcas.length - relevantes.length;
        const clases = e.clases.slice().sort((x, y) => x - y);
        const contenido = [];
        let n = 0;

        const L = rep.logotipo || null;
        contenido.push(parrafo('Se buscó la denominación en los sistemas del Instituto Mexicano de la Propiedad Industrial (MARCia, con marcas idénticas y parecidas; Marcanet, con la búsqueda fonética, y la Gaceta de la Propiedad Industrial, por medio de SIGA), y cada antecedente se comparó con la propuesta por su escritura y su pronunciación en español, su clase, su vigencia y su titular.' +
            (L ? ' El logotipo se buscó aparte, con la búsqueda por imagen de MARCia.' : '') +
            ' Este documento resume lo encontrado. Sus resultados son orientativos y tienen las reservas que se indican en el aviso del final.'));

        // ---- Resultado ----
        contenido.push(seccion(++n, 'Resultado'));
        const conteo = rep.conteo;
        const cifras = [conteo.alto + ' de riesgo alto', conteo.medio + ' de riesgo medio', conteo.bajo + ' de riesgo bajo']
            .concat(conteo.propia ? [conteo.propia + ' del mismo solicitante'] : []);
        contenido.push(recuadro('Resultado', d.titulo, [
            { text: d.resumen, alignment: 'justify', margin: [0, 0, 0, 6] },
            { text: 'Marcas encontradas que se tomaron en cuenta: ' + enLista(cifras) + '.' +
                (conteo.descartados ? ' Además, ' + conteo.descartados + ' resultado' + (conteo.descartados === 1 ? '' : 's') + ' que no se parece' + (conteo.descartados === 1 ? '' : 'n') + ' a la denominación se descartó' + (conteo.descartados === 1 ? '' : 'aron') + '.' : ''),
                font: 'Inter', fontSize: 9, color: COLOR.tinta2, lineHeight: lh(1.5, 'Inter'), margin: [0, 0, 0, 6] }
        ]));

        // ---- Sobre la denominación ----
        if (rep.observaciones.length) {
            contenido.push(seccion(++n, 'Sobre la denominación'));
            contenido.push(vinetas(rep.observaciones.map(ob => ({ negrita: NIVEL_OBSERVACION[ob.nivel] || 'Nota.', texto: ob.texto }))));
        }

        // ---- Antecedentes ----
        contenido.push(seccion(++n, 'Antecedentes a revisar'));
        if (relevantes.length) {
            contenido.push(parrafo('El parecido combina cómo se escribe y cómo suena en español; pesa más el principio de la palabra. Los umbrales son orientativos. Cada fila es una marca de un mismo titular; si tiene varios expedientes, se indica cuántos.', { fontSize: 10.5 }));
            contenido.push(tabla(['Marca', 'Clase', 'Estatus', 'Parecido', 'Riesgo y motivo'],
                relevantes.map(a => [
                    celda({ text: a.titulo, bold: true }, [
                        [numerosDe(a), a.miembros.length > 1 ? a.miembros.length + ' expedientes' : ''].filter(Boolean).join(' · '),
                        (a.titulares || []).slice(0, 2).join('; ')
                    ]),
                    celda(a.clases.join(', ') || '—', [RELACION[a.relacion] || '']),
                    celda(a.estado || 'Sin estatus', [a.conDetalle ? 'según su ficha en Marcanet' : '', a.gaceta && a.gaceta.length ? 'Gaceta: ' + V.historialTexto(a) : '']),
                    celda(a.similitud.puntaje + '%', [a.similitud.detalle]),
                    celda({ text: [{ text: NIVEL_RIESGO[a.riesgo] + '. ', bold: true }, conPunto((a.motivos || []).join('. '))] })
                ]),
                ['23%', '12%', '18%', '16%', '31%']));
            if (bajos) {
                contenido.push(parrafo('Además, ' + bajos + ' marca' + (bajos === 1 ? '' : 's') + ' de riesgo bajo (en otras clases, ya no vigentes o poco parecidas) no se detalla' + (bajos === 1 ? '' : 'n') + ' aquí.', { fontSize: 10.5, margin: [0, 6, 0, 8] }));
            }
        } else {
            contenido.push(parrafo(rep.antecedentes.length
                ? 'Ninguna de las marcas encontradas tiene un riesgo alto o medio para la denominación en las clases solicitadas.'
                : 'Las fuentes consultadas no devolvieron antecedentes.'));
        }

        // ---- Logotipo ----
        if (L) {
            contenido.push(seccion(++n, 'Logotipos parecidos'));
            if (!L.ok) {
                contenido.push(parrafo('La búsqueda del logotipo por imagen en MARCia no respondió' + (L.error ? ' (' + texto(L.error) + ')' : '') + '. Conviene repetirla antes de decidir sobre el diseño.'));
            } else {
                const indice = typeof V.avisoIndiceLogotipo === 'function' ? ' ' + V.avisoIndiceLogotipo(L) : '';
                const intro = parrafo('Se buscó el logotipo en MARCia con su búsqueda por imagen, en ' + (clases.length === 1 ? 'la clase ' : 'las clases ') + enLista(clases) +
                    '. MARCia ordena los resultados del más parecido al menos parecido, pero no mide cuánto se parecen: estos logotipos no se califican ni cuentan en el resultado del estudio, y deben revisarse a ojo. La columna «Lugar» es el que les dio MARCia en su clase.' + indice, { margin: [0, 0, 0, 0] });
                contenido.push(L.miniatura
                    ? { columns: [{ width: 76, stack: [{ image: L.miniatura, fit: [68, 68] }, { text: 'Logotipo buscado', font: 'Inter', fontSize: 7.5, color: COLOR.pie, margin: [0, 3, 0, 0] }] }, { width: '*', stack: [intro] }], columnGap: 12, margin: [0, 0, 0, 10] }
                    : Object.assign(intro, { margin: [0, 0, 0, 10] }));
                const marcas = L.marcas.slice(0, MAX_LOGOS_PDF);
                if (marcas.length) {
                    const imagenes = o.imagenes || {};
                    contenido.push(tabla(['Logotipo', 'Marca', 'Clase', 'Estatus', 'Lugar'],
                        marcas.map(m => [
                            imagenes[m.id] ? { image: imagenes[m.id], fit: [58, 58], alignment: 'center' } : celda({ text: 'Sin imagen', font: 'Inter', fontSize: 8, color: COLOR.pie }),
                            celda({ text: m.titulo || 'Sin denominación', bold: true }, [
                                m.registro ? 'Reg. ' + m.registro : m.expediente ? 'Exp. ' + m.expediente : '',
                                (m.titulares || []).slice(0, 1).join('')
                            ]),
                            celda(m.clases.join(', ') || '—'),
                            celda(m.estado || 'Sin estatus'),
                            celda(m.lugar + '.º', [], { alignment: 'center' })
                        ]),
                        ['18%', '38%', '11%', '21%', '12%']));
                    if (L.marcas.length > marcas.length) {
                        const resto = L.marcas.length - marcas.length;
                        contenido.push(parrafo('Además, ' + resto + ' logotipo' + (resto === 1 ? '' : 's') + ' de lugares posteriores no se detalla' + (resto === 1 ? '' : 'n') + ' aquí.', { fontSize: 10.5, margin: [0, 6, 0, 8] }));
                    }
                } else {
                    contenido.push(parrafo('MARCia no devolvió logotipos en las clases del estudio.'));
                }
            }
        }

        // ---- Gaceta ----
        if (rep.publicaciones && rep.publicaciones.length) {
            contenido.push(seccion(++n, 'Publicaciones parecidas en la Gaceta'));
            contenido.push(parrafo('Una solicitud publicada hace menos de un mes todavía admite oposición.', { fontSize: 10.5 }));
            contenido.push(tabla(['Denominación', 'Clase', 'Gaceta y sección', 'Parecido'],
                rep.publicaciones.slice(0, 15).map(p => [
                    celda({ text: p.denominacion, bold: true }, [p.registro ? 'Reg. ' + p.registro : p.expediente ? 'Exp. ' + p.expediente : '']),
                    celda((p.clases || []).join(', ') || '—'),
                    celda(texto(p.gaceta) || '—', [p.seccion, [p.ejemplar, p.fecha].filter(Boolean).join(' · ')]),
                    celda(p.similitud.puntaje + '%')
                ]),
                ['34%', '12%', '40%', '14%']));
        }

        // ---- Recomendaciones ----
        contenido.push(seccion(++n, 'Recomendaciones'));
        contenido.push(vinetas(rep.recomendaciones.map(paraElDocumento)));

        // ---- Fuentes ----
        contenido.push(seccion(++n, 'Fuentes y alcance'));
        const fuentes = rep.fuentes.map(f => ({
            negrita: f.nombre + ':',
            texto: f.ok ? f.total + ' resultados revisados.' : f.parcial ? f.total + ' resultados revisados; respondió a medias (' + texto(f.error) + ').' : 'no respondió' + (f.error ? ' (' + texto(f.error) + ')' : '') + '.'
        }));
        if (rep.fichas && rep.fichas.pedidas) fuentes.push({ negrita: 'Fichas de Marcanet:', texto: rep.fichas.leidas + ' de ' + rep.fichas.pedidas + ' consultadas (estatus y vigencia).' });
        if (rep.fichasMARCia && rep.fichasMARCia.pedidas) fuentes.push({ negrita: 'Fichas de MARCia:', texto: rep.fichasMARCia.leidas + ' de ' + rep.fichasMARCia.pedidas + ' consultadas (clase y productos).' });
        fuentes.push({ negrita: 'Fecha de corte:', texto: 'la consulta se hizo el ' + fechaLarga(rep.fecha) + (horaDe(rep.fecha) ? ' a las ' + horaDe(rep.fecha) : '') + '. Lo que se presente o publique después no está considerado.' });
        if (L) {
            fuentes.push({ negrita: 'Búsqueda por imagen (MARCia):', texto: L.ok
                ? L.marcas.length + ' logotipo' + (L.marcas.length === 1 ? '' : 's') + ' entre los primeros ' + (V.LOGO_POR_CLASE || 12) + ' de cada clase del estudio.'
                : 'no respondió' + (L.error ? ' (' + texto(L.error) + ')' : '') + '.' });
        }
        if (e.tipo && e.tipo !== 'nominativa') {
            fuentes.push({ negrita: 'Diseño:', texto: L && L.ok
                ? 'el parecido y el riesgo se calcularon solo con la parte en palabras; el logotipo se buscó aparte, por imagen, y sus resultados no se califican.'
                : 'el estudio compara solo la parte en palabras; el diseño de la marca requiere una búsqueda figurativa por separado.' });
        }
        contenido.push(vinetas(fuentes));

        contenido.push(aviso('Aviso importante', puntosDeAviso([
            { negrita: AVISO_FUENTES, texto: 'Este estudio se generó automáticamente a partir de consultas a sistemas públicos del IMPI (MARCia, Marcanet y SIGA), que pueden estar incompletos, desactualizados o fallar, y que pueden no mostrar solicitudes recientes o aún no publicadas. El parecido y el riesgo se estiman con criterios aproximados que no sustituyen el examen que hace el IMPI ni el criterio de un especialista.' }
        ])));

        const asunto = [
            'Estudio de viabilidad para el registro de la denominación ', { text: '«' + texto(e.denominacion) + '»', bold: true },
            TIPO_MARCA[e.tipo] && e.tipo !== 'nominativa' ? ' como marca ' + TIPO_MARCA[e.tipo] : '',
            ' en ', { text: (clases.length === 1 ? 'la clase ' : 'las clases ') + enLista(clases), bold: true }, ' de la Clasificación de Niza',
            rep.relacionadas && rep.relacionadas.length ? '. Se revisaron también las clases relacionadas ' + enLista(rep.relacionadas) : '',
            '.',
            texto(e.productos) ? ' Productos o servicios: ' + texto(e.productos) + '.' : '',
            texto(e.solicitante) ? ' Solicitante: ' + texto(e.solicitante) + '.' : ''
        ];

        return documento({
            titulo: 'Estudio de viabilidad de marca — ' + texto(e.denominacion),
            tipo: 'Estudio de viabilidad de marca',
            cliente: texto(o.para) || '«' + texto(e.denominacion) + '»',
            logo: o.logo, fecha: rep.fecha, para: o.para, presentadoPor: o.presentadoPor,
            asunto, contenido
        });
    }

    // ==================== CARTERA DE MARCAS ====================

    /**
     * El reporte de una cartera de marcas. `datos` llega ya preparado por
     * cartera-marcas.js:
     * { cliente, fecha, resumen: { total, registradas, tramite, otras, enCurso, proximos, vencidos },
     *   plazos: [{ marca, numeros, titulo, desde, hasta, estado, estimado }],
     *   marcas: [{ denominacion, numeros, titular, clases, estatus, revisado, vigencia, proximo }] }
     * opciones: { logo, para, presentadoPor }
     */
    function documentoCartera(datos, opciones) {
        const o = opciones || {};
        const r = datos.resumen;
        const quien = texto(o.para) || texto(datos.cliente);
        const contenido = [];
        let n = 0;

        contenido.push(seccion(++n, 'Resumen'));
        contenido.push(tabla(['Concepto', 'Marcas'], [
            ['Marcas en la cartera', r.total],
            ['Registradas', r.registradas],
            ['En trámite', r.tramite],
            ['Negadas, abandonadas, caducadas u otras', r.otras],
            ['Con un plazo en curso', r.enCurso],
            ['Con un plazo que empieza en los próximos 90 días', r.proximos],
            ['Con un plazo vencido sin marcar como atendido', r.vencidos]
        ].map(([c, v]) => [celda(c), celda({ text: String(v), alignment: 'right', bold: true })]), ['78%', '22%']));

        contenido.push(seccion(++n, 'Plazos'));
        if (datos.plazos.length) {
            contenido.push(parrafo('Declaraciones de uso (dentro de los tres meses siguientes a que se cumplan tres años de otorgado el registro, para los otorgados con la Ley Federal de Protección a la Propiedad Industrial) y renovaciones (en los seis meses anteriores al fin de la vigencia, con seis meses de gracia después), de los más urgentes a los más lejanos. Las fechas marcadas como estimadas se calcularon sin la vigencia oficial.', { fontSize: 10.5 }));
            contenido.push(tabla(['Marca', 'Plazo', 'Del', 'Al', 'Situación'],
                datos.plazos.map(p => [
                    celda({ text: p.marca, bold: true }, [p.numeros]),
                    celda(p.titulo, [p.estimado ? 'fecha estimada' : '']),
                    celda(fechaCorta(p.desde)),
                    celda(fechaCorta(p.hasta)),
                    celda({ text: p.estado, bold: /curso|vencido/i.test(p.estado) })
                ]),
                ['26%', '19%', '18%', '18%', '19%']));
        } else {
            contenido.push(parrafo('No hay plazos de declaración de uso ni de renovación por atender con los datos capturados.'));
        }

        contenido.push(seccion(++n, 'Marcas'));
        contenido.push(tabla(['Marca', 'Clase', 'Estatus', 'Vigencia', 'Próximo plazo'],
            datos.marcas.map(m => [
                celda({ text: m.denominacion, bold: true }, [m.numeros, m.titular]),
                celda((m.clases || []).join(', ') || '—'),
                celda(m.estatus || 'Sin estatus', [m.revisado ? 'revisado el ' + fechaCorta(m.revisado) : 'capturado a mano']),
                celda(m.vigencia ? fechaCorta(m.vigencia) : '—', [m.vigenciaEstimada ? 'estimada' : '']),
                celda(m.proximo || '—')
            ]),
            ['25%', '12%', '21%', '18%', '24%']));

        contenido.push(aviso('Aviso importante', puntosDeAviso([
            { negrita: AVISO_FUENTES, texto: 'Este reporte se generó con los datos capturados en la herramienta y, cuando se indica, con los que se consultaron en los sistemas públicos del IMPI (MARCia y Marcanet) en la fecha señalada, que pueden estar incompletos, desactualizados o fallar. Los plazos de declaración de uso y de renovación son cálculos de apoyo: deben confirmarse contra cada expediente, el título de registro y la legislación aplicable, en particular para los registros otorgados antes del 5 de noviembre de 2020.' }
        ])));

        const asunto = [
            'Estado de la cartera de marcas', quien ? [' de ', { text: quien, bold: true }] : '', ' ante el IMPI: ',
            { text: r.total + (r.total === 1 ? ' marca' : ' marcas'), bold: true },
            ' (' + r.registradas + ' registrada' + (r.registradas === 1 ? '' : 's') + ', ' + r.tramite + ' en trámite), con sus plazos de declaración de uso y renovación.'
        ].flat();

        return documento({
            titulo: 'Cartera de marcas' + (quien ? ' — ' + quien : ''),
            tipo: 'Reporte de cartera de marcas',
            cliente: quien || 'Todas las marcas',
            logo: o.logo, fecha: datos.fecha, para: o.para || datos.cliente, presentadoPor: o.presentadoPor,
            asunto, contenido
        });
    }

    /**
     * Nombre de archivo sin signos raros ni acentos: «Estudio de viabilidad -
     * Cafe Lopez - 2026-11-22.pdf». Con un acento, Chrome descarta el nombre y
     * guarda el archivo como «download», sin extensión.
     */
    function nombreArchivo(partes, fecha) {
        const d = aFecha(fecha) || new Date();
        const dia = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return partes.map(texto).filter(Boolean).concat(dia).join(' - ')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x20-\x7e]/g, '')
            .replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) + '.pdf';
    }

    const Motor = {
        PDFMAKE, FUENTES, ARCHIVOS_FUENTES, COLOR, MARGENES, ANCHO, EMPIRICA, MAX_LOGOS_PDF,
        fechaLarga, fechaCorta, enLista, puntosDeAviso, documento, documentoViabilidad, documentoCartera, nombreArchivo,
        bloques: { rotulo, parrafo, caja, seccion, subtitulo, vinetas, tabla, celda, recuadro, aviso, pie, membrete }
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
    global.REPORTES_PDF = Motor;
    if (typeof document === 'undefined') return;

    // ==================== MOTOR EN EL NAVEGADOR ====================

    let preparado = null;

    function cargarScript(url, integridad) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            if (integridad) { s.integrity = integridad; s.crossOrigin = 'anonymous'; }
            s.onload = resolve;
            s.onerror = () => reject(new Error('No se pudo cargar el generador de PDF (¿sin internet?)'));
            document.head.appendChild(s);
        });
    }

    function aBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binario = '';
        for (let i = 0; i < bytes.length; i += 8192) binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        return btoa(binario);
    }

    async function leerActivo(nombre) {
        const resp = await fetch(RUTA_ACTIVOS + nombre);
        if (!resp.ok) throw new Error('No se pudo leer ' + nombre + ' (' + resp.status + ')');
        return aBase64(await resp.arrayBuffer());
    }

    /** pdfmake, las fuentes y el logo; se cargan una vez. */
    function preparar() {
        if (preparado) return preparado;
        preparado = (async () => {
            if (!global.pdfMake || typeof global.pdfMake.createPdf !== 'function') await cargarScript(PDFMAKE.url, PDFMAKE.integridad);
            const vfs = {};
            const [logo, ...fuentes] = await Promise.all([leerActivo('logo-empirica.png'), ...ARCHIVOS_FUENTES.map(f => leerActivo('fuentes/' + f))]);
            ARCHIVOS_FUENTES.forEach((f, i) => { vfs[f] = fuentes[i]; });
            return { pdfMake: global.pdfMake, vfs, logo: 'data:image/png;base64,' + logo };
        })().catch(e => { preparado = null; throw e; });
        return preparado;
    }

    /** El PDF como Blob. `construir(logo)` devuelve la definición del documento. */
    async function generar(construir) {
        const { pdfMake, vfs, logo } = await preparar();
        const doc = construir(logo);
        return new Promise((resolve, reject) => {
            try {
                pdfMake.createPdf(doc, null, FUENTES, vfs).getBlob(resolve);
            } catch (e) { reject(e); }
        });
    }

    /** Lo descarga con ese nombre (en el teléfono se abre para compartirlo o guardarlo). */
    async function descargar(construir, archivo) {
        const blob = await generar(construir);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = archivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return blob;
    }

    // ---- Los datos que se piden antes de generar ----

    const CLAVE_PRESENTA = 'reportes_pdf_presentado_por';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function leerPresenta() { try { return localStorage.getItem(CLAVE_PRESENTA) || ''; } catch (e) { return ''; } }
    function guardarPresenta(v) { try { if (v) localStorage.setItem(CLAVE_PRESENTA, v); else localStorage.removeItem(CLAVE_PRESENTA); } catch (e) { /* sin almacenamiento */ } }

    /**
     * Pregunta para quién es y quién lo presenta (los dos, opcionales) y genera
     * el PDF. { titulo, para, antes(opciones) (opcional, async), construir(opciones) → definición,
     * archivo(opciones) → nombre }
     */
    function pedirYDescargar(cfg) {
        $('modal-titulo').textContent = '📄 ' + cfg.titulo;
        $('modal-body').innerHTML =
            '<div class="rpdf">' +
                '<p class="rpdf-nota">El PDF lleva el formato de Empírica Legal Lab y cierra con un aviso: es una herramienta de apoyo, sus resultados tienen reservas y deben revisarse antes de decidir. Si lo presentas tú, pon tu nombre o el de tu despacho.</p>' +
                '<label class="rpdf-campo">Para (cliente o destinatario, opcional)<input id="rpdf-para" value="' + esc(cfg.para || '') + '" placeholder="Nombre del cliente"></label>' +
                '<label class="rpdf-campo">Presentado por (opcional)<input id="rpdf-presenta" value="' + esc(leerPresenta()) + '" placeholder="Tu nombre o el de tu despacho"></label>' +
            '</div>';
        $('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>' +
            '<button class="btn btn-primary" id="rpdf-generar">📄 Descargar PDF</button>';
        $('rpdf-generar').addEventListener('click', async () => {
            const boton = $('rpdf-generar');
            const opciones = { para: $('rpdf-para').value.trim(), presentadoPor: $('rpdf-presenta').value.trim() };
            guardarPresenta(opciones.presentadoPor);
            boton.disabled = true;
            boton.textContent = 'Generando…';
            try {
                // Lo que hay que reunir antes de armar el documento (imágenes).
                if (typeof cfg.antes === 'function') await cfg.antes(opciones);
                await descargar(logo => cfg.construir({ ...opciones, logo }), cfg.archivo(opciones));
                if (typeof global.cerrarModal === 'function') global.cerrarModal();
                if (typeof global.mostrarToast === 'function') global.mostrarToast('PDF listo', 'success');
            } catch (e) {
                boton.disabled = false;
                boton.textContent = '📄 Descargar PDF';
                if (typeof global.mostrarToast === 'function') global.mostrarToast('No se pudo generar el PDF: ' + e.message, 'error');
                if (typeof cfg.siFalla === 'function') cfg.siFalla(e);
            }
        });
        if (typeof global.abrirModal === 'function') global.abrirModal(); else $('modal-overlay').classList.add('active');
        setTimeout(() => { const c = $('rpdf-para'); if (c && !c.value) c.focus(); }, 50);
    }

    global.REPORTES_PDF = Object.assign({}, Motor, { preparar, generar, descargar, pedirYDescargar });
})(typeof window !== 'undefined' ? window : globalThis);
