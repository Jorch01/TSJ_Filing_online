#!/usr/bin/env node
/**
 * Pruebas del estudio de viabilidad de marca (docs/js/impi-viabilidad.js).
 *
 *   node test_impi_viabilidad.js
 *
 * Sin red: el motor recibe lo que respondería cada fuente del IMPI, con la
 * forma documentada en docs/data/ (MARCia y SIGA) y los nombres de columna que
 * ya usa la pestaña de Marcanet. Se fija:
 *   - cómo suena en español: B/V, C/K/QU, S/Z, GE/JE, H muda, LL/Y…;
 *   - el parecido entre denominaciones: idéntica, igual al oído, una contiene
 *     a la otra, comparten la palabra que distingue (y las genéricas no
 *     cuentan);
 *   - clases relacionadas y estatus;
 *   - que la misma marca encontrada por varias fuentes cuente una vez, y que
 *     dos marcas distintas nunca se junten;
 *   - la matriz de riesgo, conservadora ante la duda;
 *   - las observaciones sobre la denominación (descriptiva, geográfica,
 *     oficial, corta) y el dictamen, también cuando una fuente no responde.
 */

const fs = require('fs');
const path = require('path');
const V = require('./docs/js/impi-viabilidad.js');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);

const AHORA = new Date(2026, 9, 24, 12).getTime();

// Un resultado de MARCia como el de la documentación.
function marcia(id, title, status, extra) {
    return { id, applicationNumber: id.replace(/\D/g, '').slice(-6), registrationNumber: status === 'REGISTRADO' ? '8' + id.replace(/\D/g, '').slice(-5) : '',
        title, status, appType: 'REGISTRO DE MARCA', owners: ['TITULAR DE ' + title], dates: { application: '10/02/2019', expiry: '10/02/2029' },
        goodsAndServices: '', classes: [], images: '', ...(extra || {}) };
}

console.log('\nCómo suena');
{
    const igualOido = (a, b) => verificar(`"${a}" suena como "${b}"`, V.claveFonetica(a) === V.claveFonetica(b), `${V.claveFonetica(a)} / ${V.claveFonetica(b)}`);
    const distintoOido = (a, b) => verificar(`"${a}" no suena como "${b}"`, V.claveFonetica(a) !== V.claveFonetica(b));
    igualOido('Brisa', 'Vrisa');
    igualOido('Casa', 'Kasa');
    igualOido('Quiero', 'Kiero');
    igualOido('Zapata', 'Sapata');
    igualOido('Cielo', 'Sielo');
    igualOido('Gente', 'Jente');
    igualOido('Hermosa', 'Ermosa');
    igualOido('Llave', 'Yave');
    igualOido('Carro', 'Caro');
    igualOido('Rey', 'Rei');
    igualOido('Guerrero', 'Gerrero'.replace('Ge', 'Gue'));
    distintoOido('Casa', 'Gasa');
    distintoOido('Chico', 'Sico');
    distintoOido('Gato', 'Jato');
    igual('la Ñ se conserva como sonido propio', V.claveFonetica('Piña') !== V.claveFonetica('Pina'), true);
}

console.log('\nNormalización');
{
    igual('sin acentos, signos ni forma jurídica', V.normalizarMarca('Cafés del Sureste, S.A. de C.V.'), 'CAFES DEL SURESTE');
    igual('S. de R.L. también', V.normalizarMarca('Luna S. de R.L. de C.V.'), 'LUNA');
    igual('el & es "y"', V.normalizarMarca('Pérez & Hijos'), 'PEREZ Y HIJOS');
}

console.log('\nParecido entre denominaciones');
{
    const c = (a, b, cl) => V.compararMarcas(a, b, cl || [30]);
    igual('idéntica aunque cambien mayúsculas y la forma jurídica', [c('Luna Azul', 'LUNA AZUL S.A. DE C.V.').puntaje, c('Luna Azul', 'LUNA AZUL S.A. DE C.V.').tipo], [100, 'identica']);
    igual('igual al oído', [c('Brisa', 'Vrisa').puntaje, c('Brisa', 'Vrisa').tipo], [96, 'fonetica']);
    igual('Coca-Cola y Koka Kola suenan igual', c('Coca-Cola', 'Koka Kola').tipo, 'fonetica');
    igual('una contiene a la otra', [c('Luna Azul', 'Luna').puntaje, c('Luna Azul', 'Luna').tipo], [85, 'contiene']);
    igual('y al revés', c('Luna', 'Luna Azul').tipo, 'contiene');
    igual('comparten la palabra que distingue', [c('Café Luna', 'Luna Café').puntaje >= 75, c('Café Luna', 'Luna Café').detalle], [true, 'Comparten «LUNA»']);
    verificar('compartir una palabra genérica de la clase no cuenta ("café" en la 30)', c('Café Luna', 'Café Olé').puntaje < 75, c('Café Luna', 'Café Olé').puntaje);
    verificar('pero en otra clase "café" no es genérica', c('Café Luna', 'Café Olé', [9]).puntaje >= 75);
    igual('muy distintas', c('Luna Azul', 'Sol Rojo').tipo, 'distinta');
    verificar('un cambio de una letra se parece mucho', c('Lunazul', 'Lunasul').puntaje >= 90);
    verificar('el parecido del principio pesa', c('Mondo', 'Monda').puntaje > c('Mondo', 'Rondo').puntaje);
}

console.log('\nClases');
{
    verificar('café (30) se relaciona con cafeterías (43) y bebidas (32)', [43, 32].every(c => V.clasesRelacionadas([30]).includes(c)));
    verificar('las clases pedidas no se repiten como relacionadas', !V.clasesRelacionadas([30, 43]).includes(43));
    igual('misma', V.relacionClases([30, 43], [43]), 'misma');
    igual('relacionada', V.relacionClases([30], [32]), 'relacionada');
    igual('distinta', V.relacionClases([30], [12]), 'distinta');
    igual('sin dato', V.relacionClases([30], []), 'desconocida');
}

console.log('\nEstatus y titular');
{
    igual('estatus', ['REGISTRADO', 'EN TRÁMITE', 'CADUCADA', 'ABANDONADA', 'NEGADA', 'Cancelado', ''].map(V.situacionDe),
        ['vigente', 'tramite', 'inactiva', 'inactiva', 'inactiva', 'inactiva', 'desconocida']);
    verificar('reconoce al mismo titular con otra escritura', V.mismoTitular('Juan López', ['JUAN LOPEZ']));
    verificar('y a la empresa sin su forma jurídica', V.mismoTitular('Cafés del Sureste', ['CAFES DEL SURESTE, S.A. DE C.V.']));
    verificar('pero no a otro', !V.mismoTitular('Juan López', ['MARÍA PÉREZ']));
    verificar('ni con un nombre demasiado corto', !V.mismoTitular('Ana', ['ANA MARIA SA']));
}

console.log('\nLo que responde cada fuente');
{
    const doc = V.desdeMARCia({ id: 'RM196800024621', applicationNumber: '24621', registrationNumber: '147263', title: 'COCA-COLA', status: 'REGISTRADO',
        appType: 'REGISTRO DE MARCA', owners: ['THE COCA-COLA COMPANY'], dates: { application: '25/10/1968', expiry: '25/10/2013' }, classes: [], images: 'x' }, 32);
    igual('MARCia (el ejemplo de la documentación), con la clase consultada', [doc.titulo, doc.registro, doc.expediente, doc.clases, doc.titulares[0], doc.vencimiento],
        ['COCA-COLA', '147263', '24621', [32], 'THE COCA-COLA COMPANY', '25/10/2013']);
    const mcn = V.desdeMarcanet({ 'Denominación': 'LUNAZUL', 'Expediente': '2345678', 'Clase': '30', 'Titular': 'TOSTADORES', 'Situación': 'EN TRÁMITE', _link_0: 'x' }, 30);
    igual('Marcanet', [mcn.titulo, mcn.expediente, mcn.clases, mcn.estado, mcn.titulares], ['LUNAZUL', '2345678', [30], 'EN TRÁMITE', ['TOSTADORES']]);
    const siga = V.desdeSIGA({ fichaId: 14660421, gaceta: 'Conservación de los Derechos', seccion: 'Marcas Renovadas en el Mes', ejemplar: 'Noviembre de 2025',
        fechaPuestaCirculacion: '10/12/2025', datos: [{ descripcion: 'Resolución', datoTxt: '891873/2025' }, { descripcion: 'Registro de Marca', datoTxt: '913909' },
            { descripcion: 'Clase', datoTxt: '32' }, { descripcion: 'Denominación', datoTxt: 'COCA-COLA ZERO' }] });
    igual('SIGA (el ejemplo de la documentación)', [siga.denominacion, siga.clases, siga.registro, siga.seccion], ['COCA-COLA ZERO', [32], '913909', 'Marcas Renovadas en el Mes']);
}

console.log('\nLa misma marca, una vez');
{
    const a = V.desdeMARCia(marcia('RM201900111111', 'LUNA AZUL', 'REGISTRADO'), 30);
    const b = V.desdeMarcanet({ 'Denominación': 'LUNA AZUL', 'Expediente': '111111', 'Clase': '30', 'Titular': 'OTRA FORMA DEL TITULAR', 'Situación': 'REGISTRADA' }, 30);
    const c = V.desdeMARCia(marcia('RM201900111111', 'LUNA AZUL', 'REGISTRADO'), 43);
    const juntas = V.consolidar([a, b, c]);
    igual('MARCia y Marcanet la encuentran: una sola entrada (Marcanet solo trae el expediente)', juntas.length, 1);
    igual('con las dos fuentes y las dos clases', [juntas[0].fuentes, juntas[0].clases], [['MARCia', 'Marcanet'], [30, 43]]);
    igual('y los titulares de ambas', juntas[0].titulares.length, 2);
    const distinta = V.desdeMARCia(marcia('RM201900111111', 'SOL ROJO', 'REGISTRADO'), 30);
    igual('el mismo número con otra denominación no se junta', V.consolidar([a, distinta]).length, 2);
    const sinNumero = (t, cl) => ({ fuentes: ['Marcanet'], id: null, titulo: t, expediente: '', registro: '', estado: '', titulares: [], clases: [cl], tipoSolicitud: '', solicitud: '', vencimiento: '', imagen: '' });
    igual('sin números: por denominación y clase', V.consolidar([sinNumero('LUNA', 30), sinNumero('Luna', 30), sinNumero('LUNA', 31)]).length, 2);
}

console.log('\nEl riesgo de cada antecedente');
{
    const entrada = { denominacion: 'Luna Azul', clases: [30], solicitante: 'Juan López' };
    const ant = (titulo, clases, estado, extra) => ({ fuentes: ['MARCia'], id: 'x', titulo, expediente: '1', registro: '', estado: estado || 'REGISTRADO',
        titulares: ['ALGUIEN'], clases, tipoSolicitud: 'REGISTRO DE MARCA', solicitud: '', vencimiento: '', imagen: '', ...(extra || {}) });
    const r = (a) => V.evaluarAntecedente(a, entrada, AHORA).riesgo;
    igual('idéntica en la misma clase: alto', r(ant('LUNA AZUL', [30])), 'alto');
    igual('igual al oído en la misma clase: alto', r(ant('LUNA ASUL', [30])), 'alto');
    igual('en trámite también: alto', r(ant('LUNA AZUL', [30], 'EN TRÁMITE')), 'alto');
    igual('comparte la palabra distintiva en la misma clase: medio', r(ant('LUNA ROJA', [30])), 'medio');
    igual('idéntica en una clase relacionada: alto', r(ant('LUNA AZUL', [43])), 'alto');
    igual('contenida en una clase relacionada: medio', r(ant('LUNA', [43])), 'medio');
    igual('idéntica en otra clase: bajo', r(ant('LUNA AZUL', [12])), 'bajo');
    igual('idéntica pero caducada: bajo', r(ant('LUNA AZUL', [30], 'CADUCADA')), 'bajo');
    igual('notoria, aunque sea en otra clase: alto', r(ant('LUNA AZUL', [12], 'REGISTRADO', { tipoSolicitud: 'MARCAS NOTORIAS' })), 'alto');
    igual('sin clase conocida y casi idéntica: medio (hay que confirmarla)', r(ant('LUNA AZUL', [])), 'medio');
    igual('sin estatus se trata como vigente (conservador)', r(ant('LUNA AZUL', [30], '')), 'alto');
    igual('del mismo solicitante: propia', r(ant('LUNA AZUL', [30], 'REGISTRADO', { titulares: ['JUAN LOPEZ'] })), 'propia');
    const vencida = V.evaluarAntecedente(ant('LUNA AZUL', [30], 'REGISTRADO', { vencimiento: '10/02/2020' }), entrada, AHORA);
    igual('vigencia reportada vencida: sigue alto, pero lo dice', [vencida.riesgo, vencida.motivos.some(m => /renov/.test(m))], ['alto', true]);
    const motivos = V.evaluarAntecedente(ant('LUNA ASUL', [30], 'EN TRÁMITE'), entrada, AHORA).motivos.join(' ');
    verificar('cada riesgo explica por qué', /Suena igual/.test(motivos) && /misma clase/.test(motivos) && /trámite/.test(motivos), motivos);
}

console.log('\nSobre la denominación misma');
{
    const obs = (denominacion, clases, extra) => V.observacionesRegistrabilidad({ denominacion, clases, ...(extra || {}) });
    const niveles = o => o.map(x => x.nivel);
    igual('una marca de fantasía no tiene observaciones', obs('Lunazul', [30]), []);
    verificar('solo descriptiva y elogiosa: alto', niveles(obs('Café Premium', [30])).includes('alto'));
    verificar('descriptiva más algo distintivo: medio', niveles(obs('Café Lunazul', [30])).includes('medio') && !niveles(obs('Café Lunazul', [30])).includes('alto'));
    verificar('lo descriptivo también sale de los productos que se capturan', obs('Tostado Luna', [30], { productos: 'café tostado' }).some(o => /TOSTADO/.test(o.texto)));
    verificar('solo descriptiva y geográfica: alto', niveles(obs('Café Cancún', [30])).includes('alto'));
    verificar('con nombre geográfico: lo advierte', obs('Luna de Tulum', [30]).some(o => /geográfico/.test(o.texto)));
    verificar('siglas oficiales: alto', obs('IMSS Express', [44]).some(o => o.nivel === 'alto' && /oficiales/.test(o.texto)));
    verificar('letras sueltas: poca distintividad', obs('XJ', [25]).some(o => /aislados/.test(o.texto)));
    verificar('mixta: recuerda la búsqueda por imagen', obs('Lunazul', [30], { tipo: 'mixta' }).some(o => /imagen/.test(o.texto)));
}

console.log('\nEl dictamen');
{
    const entrada = { denominacion: 'Luna Azul', clases: [30, 43], tipo: 'nominativa', productos: '', solicitante: '' };
    const fuentesOk = { MARCia: { ok: true, total: 3 }, Marcanet: { ok: true, total: 1 }, SIGA: { ok: true, total: 1 } };
    const limpio = V.analizar(entrada, { marcia: [{ clase: 30, resultados: [marcia('RM2019000001', 'SOL ROJO', 'REGISTRADO')] }], marcanet: [], siga: [], fuentes: fuentesOk }, AHORA);
    igual('sin antecedentes parecidos: viabilidad alta', limpio.dictamen.nivel, 'alta');

    const crudo = {
        marcia: [
            { clase: 30, resultados: [marcia('RM2019000002', 'LUNA AZUL', 'REGISTRADO'), marcia('RM2019000003', 'LUNA ROJA', 'REGISTRADO')] },
            { clase: null, resultados: [marcia('RM2019000004', 'LUNA AZUL', 'REGISTRADO', { classes: [25] })] }
        ],
        marcanet: [{ clase: 30, resultados: [{ 'Denominación': 'LUNA AZUL', 'Expediente': '000002', 'Clase': '30', 'Situación': 'REGISTRADA' }] }],
        siga: [
            { fichaId: 1, gaceta: 'Solicitudes', seccion: 'Solicitudes publicadas', ejemplar: 'Oct 2026', datos: [{ descripcion: 'Denominación', datoTxt: 'LUNA AZUL CAFÉ' }, { descripcion: 'Clase', datoTxt: '43' }] },
            { fichaId: 2, gaceta: 'Conservación', seccion: 'Renovadas', ejemplar: 'Mayo 2025', datos: [{ descripcion: 'Denominación', datoTxt: 'SOL Y MAR' }, { descripcion: 'Clase', datoTxt: '30' }] }
        ],
        fuentes: fuentesOk
    };
    const rep = V.analizar(entrada, crudo, AHORA);
    igual('con una idéntica en la misma clase: viabilidad baja', rep.dictamen.nivel, 'baja');
    igual('cuenta una vez la marca que vieron MARCia y Marcanet', rep.antecedentes.filter(a => a.titulo === 'LUNA AZUL' && a.clases.includes(30)).length, 1);
    // LUNA AZUL en la 30 y en la 25 son del mismo titular: una marca, dos expedientes.
    igual('conteo por marca y titular: LUNA AZUL en la 30 y en la 25 cuenta una vez', [rep.conteo.alto, rep.conteo.medio, rep.conteo.bajo, rep.conteo.expedientes], [1, 1, 0, 3]);
    const otroTitular = V.analizar(entrada, { ...crudo, marcia: [crudo.marcia[0],
        { clase: null, resultados: [marcia('RM2019000004', 'LUNA AZUL', 'REGISTRADO', { classes: [25], owners: ['CONFECCIONES DEL GOLFO SA DE CV'] })] }] }, AHORA);
    igual('de otro titular es otra marca: conteo por riesgo', [otroTitular.conteo.alto, otroTitular.conteo.medio, otroTitular.conteo.bajo], [1, 1, 1]);
    igual('los de mayor riesgo van primero', rep.antecedentes[0].riesgo, 'alto');
    igual('las publicaciones en Gaceta parecidas, no las demás', rep.publicaciones.map(p => p.denominacion), ['LUNA AZUL CAFÉ']);
    verificar('recomienda cambiar la denominación', rep.recomendaciones.some(r => /Cambia la denominación/.test(r)));
    verificar('y menciona la caducidad por falta de uso', rep.recomendaciones.some(r => /caducidad/.test(r)));
    verificar('y la oposición en Gaceta', rep.recomendaciones.some(r => /oposición/.test(r)));
    igual('revisa también las clases relacionadas', rep.relacionadas.includes(32), true);
    igual('guarda qué fichas de SIGA ya vio (para vigilar sin falsas novedades)', rep.fichasSIGA, [1, 2]);

    const parcial = V.analizar(entrada, { ...crudo, fuentes: { ...fuentesOk, SIGA: { ok: false, error: 'HTTP 502' } } }, AHORA);
    verificar('si una fuente no respondió, el dictamen lo dice', parcial.dictamen.parcial && /SIGA no respondió/.test(parcial.dictamen.resumen), parcial.dictamen.resumen);
    // MARCia responde una búsqueda y falla otras: lo que trajo cuenta, pero no es completo.
    const aMedias = V.analizar(entrada, { ...crudo, fuentes: { ...fuentesOk, MARCia: { ok: false, parcial: true, total: 3, error: '3 de 4 búsquedas fallaron (MARCia respondió vacío)' } } }, AHORA);
    verificar('MARCia a medias: el dictamen lo dice y es parcial', aMedias.dictamen.parcial && /MARCia respondió a medias; el resultado es parcial/.test(aMedias.dictamen.resumen), aMedias.dictamen.resumen);
    verificar('y lo que sí trajo cuenta', aMedias.antecedentes.some(a => a.fuentes.includes('MARCia')));
    verificar('y propone reintentar', aMedias.recomendaciones.some(r => /^MARCia respondió a medias: usa «Reintentar lo que faltó»/.test(r)));
    verificar('el resumen dice cuántas búsquedas fallaron', /MARCia \(3, a medias: 3 de 4 búsquedas fallaron/.test(V.resumenTexto(aMedias)));
    verificar('y recomienda reintentar lo que faltó, sin gastar otro estudio',
        parcial.recomendaciones.some(r => /SIGA no respondió: usa «Reintentar lo que faltó» en este reporte \(no cuenta como otro estudio\)/.test(r)), parcial.recomendaciones.join('\n'));
    const nada = V.analizar(entrada, { marcia: [], marcanet: [], siga: [], fuentes: { MARCia: { ok: false }, Marcanet: { ok: false }, SIGA: { ok: false } } }, AHORA);
    igual('si no respondió ninguna, no hay dictamen', nada.dictamen.nivel, 'incompleta');

    const descriptiva = V.analizar({ ...entrada, denominacion: 'Café Premium' }, { marcia: [], marcanet: [], siga: [], fuentes: fuentesOk }, AHORA);
    igual('sin antecedentes pero puramente descriptiva: viabilidad baja', descriptiva.dictamen.nivel, 'baja');

    const texto = V.resumenTexto(rep);
    verificar('el resumen en texto lleva dictamen, antecedentes y recomendaciones',
        /DICTAMEN: VIABILIDAD BAJA/.test(texto) && /\[ALTO\] LUNA AZUL/.test(texto) && /RECOMENDACIONES/.test(texto) && /nunca son concluyentes/.test(texto));
}

console.log('\nConectado con la app');
{
    const html = fs.readFileSync(path.join(__dirname, 'docs', 'index.html'), 'utf8');
    verificar('la pestaña de viabilidad es la primera y la que se abre', /<div class="impi-tabs">\s*<button class="impi-tab active" data-impi-tab="viabilidad"/.test(html));
    verificar('su contenedor existe y es el activo', html.includes('<div class="impi-tab-content active" id="impi-tab-viabilidad">'));
    verificar('MARCia ya no está activa de inicio', html.includes('<div class="impi-tab-content" id="impi-tab-marcia">'));
    verificar('el script se carga después de impi-search.js',
        html.indexOf('<script src="js/impi-viabilidad.js"></script>') > html.indexOf('<script src="js/impi-search.js"></script>'));
    verificar('y se guarda para usarse sin internet', /'js\/impi-viabilidad\.js'/.test(fs.readFileSync(path.join(__dirname, 'docs', 'sw.js'), 'utf8')));
    const proxy = fs.readFileSync(path.join(__dirname, 'docs', 'proxy', 'impi-proxy-worker.js'), 'utf8');
    for (const ruta of ['/marcia/csrf', '/marcia/search', '/marcia/results', '/marcanet/fonetica', '/siga/search', '/marcanet/full-detail']) {
        verificar(`el proxy atiende ${ruta}, que usa el estudio`, proxy.includes(`path === '${ruta}'`));
    }
}

// Un caso real (lunafardo, clase 43, octubre de 2026): lo que respondió el
// IMPI, recortado. El primer estudio marcaba cuatro antecedentes de riesgo
// medio que no lo eran: Marcanet no filtra por clase y se les ponía la 43, y
// sin estatus todos parecían vigentes.
console.log('\nUn caso real: lunafardo');
{
    const fila = (n, tit, exp, reg, clase, titular) => ({ '#': String(n), TS: 'M', TM: '', Titular: titular, Expediente: exp,
        _link_4: '/marcanet/vistas/common/busquedas/detalleExpedienteParcial.pgi?tipo=1&anio=1985&expediente=' + exp,
        Registro: reg, 'Denominación': tit, Clase: clase, Logotipo: '' });
    const marcanet = [
        fila(1, 'LUNFARDO', '1204050', '1261657', '43', 'FERNANDO NESTOR POCH Y CLAUDIA MARIA VILLALOBOS MAYA'),
        fila(2, 'L LUNFARDO', '879084', '1012592', '41', 'RAFAEL TABLADO RASCON'),
        fila(3, 'L LUNFARDO', '772119', '', '41', 'RAFAEL TABLADO RASCON'),
        fila(4, 'LUNAFURY', '3417716', '', '12 26 27 28', 'SHENZHEN NULING ELECTRONIC TECHNOLOGY CO., LTD'),
        fila(5, 'LUNAFURY', '3417715', '', '9 10 12', 'SHENZHEN NULING ELECTRONIC TECHNOLOGY CO., LTD'),
        fila(6, 'GA.MA', '1614721', '1571838', '3 5', 'DUNA ENTERPRISES, SDAD. LTDA.')
    ];
    const nav = { impi: 'Herramientas¿Cómo clasificar tus productos o servicios?', 'Expediente a buscar': '*' };
    const detalles = {
        1204050: { '2011': 'SOLICITUD DE REGISTRO', '2021': 'RENOVACION(registro)', ...nav, 'Número de registro': '1261657',
            'Fecha de presentación': '18/08/2011 11:47:18 AM', 'Fecha de vigencia': '18/08/2031', 'Denominación': 'LUNFARDO',
            '43Edición 9 del Clasificador de Niza': 'RESTAURACION [COMIDAS], RESTAURANTES (SERVICIOS DE).' },
        879084: { '2007': 'SOLICITUD DE REGISTRO', ...nav, 'Número de registro': '1012592', 'Fecha de presentación': '09/08/2007 09:00:00 AM',
            'Fecha de concesión': '21/11/2007', 'Fecha de vigencia': '09/08/2017', 'Denominación': 'L LUNFARDO',
            '41Edición 9 del Clasificador de Niza': 'EDICION DE TEXTOS.' },
        772119: { '1': 'Este expediente fue publicado el 07/12/2007, en la Gaceta de la Propiedad Industrial, Ejemplar Extraordinario 60, Solicitudes Abandonadas',
            '2006': 'SOLICITUD DE REGISTRO', ...nav, 'Fecha de presentación': '20/02/2006 09:00:00 AM', 'Denominación': 'L LUNFARDO' },
        3417716: { '1': '1861424', '2025': 'OPOSICION', ...nav, 'Fecha de presentación': '07/05/2025 12:00:00 AM', 'Denominación': 'LUNAFURY' }
    };
    const entrada = { denominacion: 'lunafardo', clases: [43], solicitante: '', productos: '', tipo: 'nominativa' };
    const fuentes = { MARCia: { ok: true, total: 0 }, Marcanet: { ok: true, total: 10 }, SIGA: { ok: true, total: 0 } };

    const lunafury = V.desdeMarcanet(marcanet[3]);
    igual('Marcanet: la clase es la de la fila, no la que se consultó', lunafury.clases, [12, 26, 27, 28]);
    verificar('y guarda el enlace a su ficha', /expediente=3417716$/.test(lunafury.enlace));

    const l = V.compararMarcas('lunafardo', 'L LUNFARDO', [43]);
    verificar('«L LUNFARDO» contiene una palabra casi igual a «lunafardo»', l.puntaje >= 80 && /LUNFARDO/.test(l.detalle), JSON.stringify(l));
    igual('las genéricas no se cuelan por ahí', V.compararMarcas('Café Lunafardo', 'CAFE DEL MAR', [43]).puntaje < 65, true);

    igual('MARCia no ve variantes de una letra: se le pide cada mitad con comodín', V.variantesComodin('lunafardo'), ['LUNAF*', '*FARDO']);
    igual('las palabras cortas no llevan comodín', V.variantesComodin('luna'), []);

    const sinFicha = V.analizar(entrada, { marcia: [], marcanet: [{ clase: 43, resultados: marcanet }], siga: [], fuentes }, AHORA);
    igual('sin fichas: LUNFARDO alto y nada más en la misma clase',
        sinFicha.antecedentes.filter(a => a.riesgo !== 'bajo').map(a => a.titulo + ':' + a.riesgo + ':' + a.relacion),
        ['LUNFARDO:alto:misma', 'L LUNFARDO:medio:relacionada', 'L LUNFARDO:medio:relacionada']);
    igual('LUNAFURY está en otra clase: bajo', sinFicha.antecedentes.filter(a => a.titulo === 'LUNAFURY').map(a => a.riesgo), ['bajo', 'bajo']);
    igual('se pide la ficha de los de riesgo alto y medio', V.aConsultarDetalle(sinFicha).map(o => o.expediente), ['1204050', '879084', '772119']);

    igual('ficha: renovada, vigente', V.leerDetalleMarcanet(detalles[1204050], AHORA).estado, 'REGISTRADA, vigente hasta 18/08/2031');
    igual('ficha: lo que ampara', V.leerDetalleMarcanet(detalles[1204050], AHORA).ampara, '43: RESTAURACION [COMIDAS], RESTAURANTES (SERVICIOS DE).');
    igual('ficha: vencida', V.leerDetalleMarcanet(detalles[879084], AHORA).estado, 'REGISTRADA, vigencia terminada el 09/08/2017');
    igual('ficha: abandonada', V.leerDetalleMarcanet(detalles[772119], AHORA).estado, 'ABANDONADA');
    igual('ficha: en oposición', V.leerDetalleMarcanet(detalles[3417716], AHORA).estado, 'EN TRÁMITE, con oposición');
    igual('una página sin datos del expediente no es ficha', V.leerDetalleMarcanet(nav, AHORA), null);

    const conFicha = V.analizar(entrada, { marcia: [], marcanet: [{ clase: 43, resultados: marcanet }], siga: [], fuentes, detalles }, AHORA);
    igual('con fichas: solo LUNFARDO, que sí está vigente, impide el registro',
        conFicha.antecedentes.filter(a => a.riesgo !== 'bajo').map(a => a.titulo + ':' + a.riesgo), ['LUNFARDO:alto']);
    const vencida = conFicha.antecedentes.find(a => a.registro === '1012592');
    verificar('la vencida sin renovar dice por qué no estorba', vencida.riesgo === 'bajo' && /09\/08\/2017 y no aparece renovada/.test(vencida.motivos.join(' ')), vencida.motivos.join(' '));
    verificar('la abandonada también', /ABANDONADA/.test(conFicha.antecedentes.find(a => a.expediente === '772119').motivos.join(' ')));
    igual('el dictamen sigue siendo baja, por la razón correcta', [conFicha.dictamen.nivel, conFicha.conteo.alto, conFicha.conteo.medio], ['baja', 1, 0]);
    igual('ya no se vuelve a pedir la ficha de lo que ya la tiene', V.aConsultarDetalle(conFicha), []);
    const marciaVieja = V.analizar(entrada, { marcia: [{ clase: 41, resultados: [marcia('RM200600772119', 'L LUNFARDO', 'EN TRÁMITE', { applicationNumber: '772119' })] }],
        marcanet: [], siga: [], fuentes, detalles }, AHORA);
    igual('la ficha manda sobre el estatus viejo de MARCia', marciaVieja.antecedentes[0].estado, 'ABANDONADA');

    // Lo que no se parece es ruido de las fuentes: ni cuenta ni se muestra.
    // Y cuenta marcas, no expedientes: L LUNFARDO y LUNAFURY tienen dos cada una.
    igual('cuenta solo lo que se parece, por marca: 1 alto, 2 bajos, 1 descartado (GA.MA); 6 expedientes',
        [conFicha.conteo.alto, conFicha.conteo.medio, conFicha.conteo.bajo, conFicha.conteo.descartados, conFicha.conteo.expedientes], [1, 0, 2, 1, 6]);
    igual('GA.MA queda marcado como descartado', conFicha.antecedentes.filter(a => a.descartado).map(a => a.titulo), ['GA.MA']);
    verificar('el resumen lo dice', /2 bajo \(y 1 resultado que no se parece, descartado\)\. Se cuenta una vez cada marca de un mismo titular; son 6 expedientes\./.test(V.resumenTexto(conFicha)),
        V.resumenTexto(conFicha).split('\n')[7]);

    // Recomendaciones: lo ya confirmado no se vuelve a pedir; con un solo
    // obstáculo, la carta de consentimiento es una salida.
    const recs = conFicha.recomendaciones.join('\n');
    verificar('no pide confirmar en Marcanet lo que ya se confirmó', !/Antes de presentar, confirma en Marcanet/.test(recs) && /se confirmó en su ficha de Marcanet el \d\d\/\d\d\/\d{4}/.test(recs), recs);
    verificar('con un solo obstáculo sugiere la carta de consentimiento de su titular',
        /negociar con FERNANDO NESTOR POCH Y CLAUDIA MARIA VILLALOBOS MAYA, titular de «LUNFARDO» \(reg\. 1261657\), una carta de consentimiento/.test(recs), recs);
    verificar('lo que se quedó sin ficha sí se pide confirmar',
        /Antes de presentar, confirma en Marcanet el estatus de «LUNFARDO»/.test(sinFicha.recomendaciones.join('\n')), sinFicha.recomendaciones.join('\n'));
    const muchos = { ...conFicha, antecedentes: [1, 2, 3].map(i => ({ ...conFicha.antecedentes[0], registro: String(i), expediente: String(i), titulares: ['TITULAR ' + i] })) };
    verificar('con muchos obstáculos, no', !/carta de consentimiento/.test(V.recomendaciones(muchos).join(' ')));
    const deUnTitular = { ...conFicha, antecedentes: [1, 2, 3].map(i => ({ ...conFicha.antecedentes[0], registro: String(i), expediente: String(i) })) };
    verificar('pero tres expedientes de un mismo titular son un solo obstáculo: sí, y los nombra',
        /negociar con FERNANDO NESTOR POCH Y CLAUDIA MARIA VILLALOBOS MAYA, titular de «LUNFARDO» \(reg\. 1, reg\. 2 y 1 más\), una carta de consentimiento/.test(V.recomendaciones(deUnTitular).join(' ')),
        V.recomendaciones(deUnTitular).join('\n'));
    const notoria = { ...conFicha, antecedentes: [{ ...conFicha.antecedentes[0], notoria: true }] };
    verificar('ni frente a una marca notoria', !/carta de consentimiento/.test(V.recomendaciones(notoria).join(' ')));

    // SIGA solo encuentra palabras exactas: se busca por el nombre de los
    // antecedentes principales. Lo que respondió para «lunfardo», más una
    // solicitud reciente inventada que todavía no estaría en MARCia.
    igual('se busca en SIGA el nombre de los antecedentes principales', V.nombresParaGaceta(conFicha), ['LUNFARDO']);
    igual('sin repetir ni incluir la propia denominación', V.nombresParaGaceta({ entrada: { denominacion: 'Luna' },
        antecedentes: [{ riesgo: 'alto', titulo: 'LUNA' }, { riesgo: 'medio', titulo: 'Lunas' }, { riesgo: 'medio', titulo: 'LUNAS' }, { riesgo: 'bajo', titulo: 'SOL' }] }), ['LUNAS']);
    const ficha = (fichaId, gaceta, seccion, fecha, datos) => ({ fichaId, gaceta, seccion, fechaPuestaCirculacion: fecha,
        datos: Object.entries(datos).map(([descripcion, datoTxt]) => ({ descripcion, datoTxt })) });
    const sigaHistorial = [
        ficha(101, 'Marcas Registradas, Avisos y Nombres Comerciales', 'Marcas Registradas', '09/04/2012', { 'Registro de Marca': '1261657', 'Expediente': '1204050' }),
        ficha(102, 'Ejemplar Extraordinario', 'Solicitudes de Marcas Abandonadas', '07/12/2007', { 'Expediente': '772119', 'Denominación': 'L LUNFARDO' }),
        ficha(103, 'Marcas Registradas, Avisos y Nombres Comerciales', 'Marcas Registradas', '28/03/2008', { 'Registro de Marca': '1012592', 'Expediente': '879084' }),
        ficha(104, 'Conservación de los Derechos', 'Marcas Renovadas en el Mes', '11/05/2022', { 'Registro de Marca': '1261657', 'Clase': '43', 'Denominación': 'LUNFARDO y diseño' }),
        ficha(105, 'Solicitudes de Marcas, Avisos y Nombres Comerciales presentadas ante el Instituto', 'Solicitudes de Marcas', '20/10/2026',
            { 'Expediente': '3456789', 'Denominación': 'LUNFARDO BAR', 'Clase': '43' })
    ];
    const conGaceta = V.analizar(entrada, { marcia: [], marcanet: [{ clase: null, resultados: marcanet }], siga: [], fuentes, detalles, sigaHistorial }, AHORA);
    const lunfardo = conGaceta.antecedentes.find(a => a.registro === '1261657');
    igual('el historial en Gaceta se pega a su antecedente, en orden', V.historialTexto(lunfardo), 'Registrada 09/04/2012 · Renovada 11/05/2022');
    igual('también el del abandonado', V.historialTexto(conGaceta.antecedentes.find(a => a.expediente === '772119')), 'Abandonada 07/12/2007');
    igual('la solicitud reciente parecida, de nadie conocido, sale en publicaciones', conGaceta.publicaciones.map(p => p.denominacion), ['LUNFARDO BAR']);
    verificar('la recomendación de caducidad dice cuándo se renovó', /su última renovación se publicó en la Gaceta el 11\/05\/2022\./.test(conGaceta.recomendaciones.join(' ')), conGaceta.recomendaciones.join('\n'));
    verificar('y el resumen trae el historial', /En Gaceta: Registrada 09\/04\/2012 · Renovada 11\/05\/2022/.test(V.resumenTexto(conGaceta)));
    igual('etiquetas de la Gaceta', ['Marcas Renovadas en el Mes', 'Solicitudes de Marcas Abandonadas', 'Declaraciones Administrativas de Caducidad', 'Solicitudes de Marcas']
        .map(V.etiquetaGaceta), ['Renovada', 'Abandonada', 'Caducidad', 'Solicitud publicada']);

    verificar('el resumen termina con el aviso: no es concluyente y hay que consultar a un especialista',
        /AVISO: Los resultados de este estudio dependen por completo de búsquedas en sistemas externos.*nunca son concluyentes.*especialista/.test(V.resumenTexto(conFicha)));
    igual('los titulares de MARCia llegan sin espacios de más', V.desdeMARCia(marcia('RM200700879084', 'L LUNFARDO', 'REGISTRADO',
        { owners: ['RAFAEL TABLADO RASCON  ', '  '] })).titulares, ['RAFAEL TABLADO RASCON']);

    // Con 60 resultados de Marcanet (paginados) aparecieron casos nuevos.
    const amp = V.desdeMarcanet({ 'Denominación': 'LUNA &amp; FRIDA', 'Expediente': '2650560', 'Clase': '43', 'Titular': 'RUIZ &amp; TORRES' });
    igual('Marcanet manda el texto de su HTML: se lee «LUNA & FRIDA»', [amp.titulo, amp.titulares], ['LUNA & FRIDA', ['RUIZ & TORRES']]);
    verificar('empezar con LUN- no basta: «LUNA & FRIDA» no llega a riesgo medio en la misma clase',
        V.compararMarcas('lunafardo', 'LUNA & FRIDA', [43]).puntaje < 65, JSON.stringify(V.compararMarcas('lunafardo', 'LUNA & FRIDA', [43])));
    verificar('pero «LUNA PHARMA» suena parecido de verdad (LUNA-FAR-MA): riesgo alto en la misma clase',
        V.compararMarcas('lunafardo', 'LUNA PHARMA', [43]).puntaje >= 80, JSON.stringify(V.compararMarcas('lunafardo', 'LUNA PHARMA', [43])));
    const pharma = (exp, clase, ficha) => ({ fila: fila(9, 'LUNA PHARMA', exp, '', clase, 'PHARMA GBC SAPI DE CV'),
        ficha: { 'Fecha de presentación': '07/01/2025', 'Denominación': 'LUNA PHARMA', ...ficha } });
    const p43 = pharma('3295484', '35 36 43', { '35Edición 12 del Clasificador de Niza': 'PUBLICIDAD; GESTIÓN DE NEGOCIOS COMERCIALES.' });
    const p39 = pharma('3295486', '39', { '39Edición 12 del Clasificador de Niza': 'TRANSPORTE; ORGANIZACIÓN DE VIAJES.' });
    const conPharma = V.analizar(entrada, { marcia: [], marcanet: [{ clase: null, resultados: [p43.fila, p39.fila] }], siga: [], fuentes,
        detalles: { 3295484: p43.ficha, 3295486: p39.ficha } }, AHORA);
    const a43 = conPharma.antecedentes.find(a => a.expediente === '3295484'), a39 = conPharma.antecedentes.find(a => a.expediente === '3295486');
    igual('lo que ampara: si la ficha solo trae otra clase (35), no se muestra en lugar de la 43', a43.ampara, '');
    // El estudio del 27/10/2026: Marcanet no respondió (ni su búsqueda ni sus
    // fichas). Con MARCia y el historial de la Gaceta el estatus viejo de las
    // listas se corrige: la solicitud abandonada y el registro vencido sin
    // renovación ya no estorban; LUNFARDO, renovada, sí.
    const deMarcia = (id, titulo, estado, extra) => marcia(id, titulo, estado, extra);
    const sinMarcanet = V.analizar(entrada, {
        marcia: [
            { clase: 43, resultados: [deMarcia('RM201101204050', 'LUNFARDO', 'REGISTRADO', { applicationNumber: '1204050', registrationNumber: '1261657',
                owners: ['FERNANDO NESTOR POCH Y CLAUDIA MARIA VILLALOBOS MAYA'], dates: { application: '18/08/2011', expiry: '18/08/2021' } })] },
            { clase: 41, resultados: [
                deMarcia('RM200600772119', 'L LUNFARDO', 'EN TRÁMITE', { applicationNumber: '772119', registrationNumber: '', owners: ['RAFAEL TABLADO RASCON'], dates: { application: '20/2/2006' } }),
                deMarcia('RM200700879084', 'L LUNFARDO', 'REGISTRADO', { applicationNumber: '879084', registrationNumber: '1012592', owners: ['RAFAEL TABLADO RASCON'],
                    dates: { application: '09/08/2007', expiry: '09/08/2017' } })] }
        ],
        marcanet: [], siga: [], sigaHistorial: sigaHistorial.slice(0, 4),
        fuentes: { MARCia: { ok: true, total: 4 }, Marcanet: { ok: false, error: 'respondió vacía tres veces' }, SIGA: { ok: true, total: 0 } },
        fichas: { pedidas: 3, leidas: 0 }
    }, AHORA);
    const deEste = (exp) => sinMarcanet.antecedentes.find(a => a.expediente === exp);
    igual('sin Marcanet: LUNFARDO sigue alto (la Gaceta publica su renovación de 2022)', [deEste('1204050').riesgo, deEste('1204050').vencida], ['alto', false]);
    verificar('y lo dice', /Se renovó \(Gaceta del 11\/05\/2022\)/.test(deEste('1204050').motivos.join(' ')), deEste('1204050').motivos.join(' '));
    igual('la solicitud que MARCia ve «en trámite» pero la Gaceta publicó abandonada: bajo',
        [deEste('772119').estado, deEste('772119').riesgo], ['ABANDONADA (Gaceta del 07/12/2007)', 'bajo']);
    igual('el registro vencido en 2017 sin renovación publicada: bajo', deEste('879084').riesgo, 'bajo');
    verificar('y dice por qué', /terminó el 09\/08\/2017 y la Gaceta no publica su renovación/.test(deEste('879084').motivos.join(' ')), deEste('879084').motivos.join(' '));
    igual('el dictamen: 1 alto, 0 medio', [sinMarcanet.dictamen.nivel, sinMarcanet.conteo.alto, sinMarcanet.conteo.medio], ['baja', 1, 0]);
    const recsSin = sinMarcanet.recomendaciones.join('\n');
    verificar('lo deducido de la Gaceta se pide confirmar en Marcanet, con los dos expedientes de «L LUNFARDO»',
        /el estatus de «L LUNFARDO» \(exp\. 772119, reg\. 1012592\) se dedujo de la Gaceta: confírmalo en Marcanet/.test(recsSin), recsSin);
    verificar('ya no pide revisar si se renovó «L LUNFARDO»', !/Revisa en Marcanet si se renovó/.test(recsSin), recsSin);
    verificar('el resumen dice por qué falló Marcanet y cuántas fichas se leyeron',
        /Marcanet \(sin respuesta: respondió vacía tres veces\)/.test(V.resumenTexto(sinMarcanet)) && /Fichas de Marcanet: 0 de 3\./.test(V.resumenTexto(sinMarcanet)));
    // Sin historial de la Gaceta no se deduce nada: la vigencia vieja sigue pidiendo confirmación.
    const sinHistoria = V.analizar(entrada, { marcia: [{ clase: 41, resultados: [deMarcia('RM200700879084', 'L LUNFARDO', 'REGISTRADO',
        { applicationNumber: '879084', registrationNumber: '1012592', dates: { application: '09/08/2007', expiry: '09/08/2017' } })] }],
        marcanet: [], siga: [], fuentes: { MARCia: { ok: true, total: 1 } } }, AHORA);
    igual('sin historial de la Gaceta, una vigencia vieja de MARCia no basta para bajar el riesgo', sinHistoria.antecedentes[0].riesgo, 'medio');

    igual('y el de una clase relacionada (39) sí', a39.ampara, '39: TRANSPORTE; ORGANIZACIÓN DE VIAJES.');
}

// La ficha de MARCia (/marcia/view) trae la clase y lo que ampara cada
// expediente. La búsqueda de Marcanet a veces muestra las clases de toda una
// familia de solicitudes: LUNA PHARMA, de PHARMA GBC, son cuatro expedientes
// de una clase cada uno, y en la búsqueda el 3295484 decía «35 36 43».
console.log('\nLa ficha de MARCia y las marcas con varios expedientes');
{
    // Lo que respondió MARCia el 28/10/2026, recortado.
    const fichaPharma = (exp, clase, productos, historial) => ({
        details: {
            generalInformation: { title: 'LUNA PHARMA', applicationNumber: exp, applicationDate: '6/1/2025', publicationDt: '13/01/2025', appType: 'REGISTRO DE MARCA' },
            productsAndServices: [{ classes: clase, goodsAndServices: productos }],
            trademark: { id: 'RM20250' + exp }
        },
        result: { id: 'RM20250' + exp, applicationNumber: exp, title: 'LUNA PHARMA', status: 'EN TRÁMITE', owners: ['PHARMA GBC SAPI DE CV'] },
        historyData: { historyRecords: historial || [{ description: 'SOLICITUD DE REGISTRO', startDate: '06/01/2025', details: { officios: [
            { descriptionOfTheTrade: 'SE LE CITA ANTERIORIDAD', officeNumber: '20250639944', dateOfTheTrade: '29/04/2025' },
            { descriptionOfTheTrade: 'ARCHIVO FONETICO', officeNumber: '20250634583', dateOfTheTrade: '28/04/2025' },
            { descriptionOfTheTrade: 'ARCHIVO FONETICO', officeNumber: '20250321872', dateOfTheTrade: '28/02/2025' }] } }] }
    });
    const crudo84 = fichaPharma('3295484', 35, 'PUBLICIDAD; GESTIÓN, ORGANIZACIÓN Y ADMINISTRACIÓN DE NEGOCIOS COMERCIALES; TRABAJOS DE OFICINA.');
    const f84 = V.leerFichaMARCia(crudo84, '3295484');
    igual('ficha de MARCia: su clase y lo que ampara', [f84.id, f84.clases, f84.productos[0].texto.slice(0, 10), f84.estado],
        ['RM202503295484', [35], 'PUBLICIDAD', 'EN TRÁMITE']);
    igual('ficha de MARCia: avisa de las anterioridades que le citó el IMPI', V.avisosDeFicha(f84), ['El IMPI le citó anterioridades (oficio del 29/04/2025)']);
    igual('y de una oposición', V.avisosDeFicha(V.leerFichaMARCia(fichaPharma('3417716', 28, 'JUGUETES.',
        [{ description: 'SOLICITUD DE REGISTRO', startDate: '07/05/2025' }, { description: 'OPOSICION', startDate: '15/08/2025' }]), '3417716')),
        ['Tiene una oposición (presentada el 15/08/2025)']);
    igual('si la ficha es de otro expediente, no se usa', V.leerFichaMARCia(crudo84, '3295485'), null);
    igual('ni si no trae productos (o es un error)', [V.leerFichaMARCia({ details: { generalInformation: {}, productsAndServices: [] } }, '1'),
        V.leerFichaMARCia({ error: 'HTTP 404' }, '1'), V.leerFichaMARCia(null, '1')], [null, null, null]);
    igual('varias clases en un expediente: todas', V.leerFichaMARCia({ details: { generalInformation: { applicationNumber: '1' },
        productsAndServices: [{ classes: 43, goodsAndServices: 'RESTAURANTES.' }, { classes: '30, 32', goodsAndServices: 'CAF&#201; Y BEBIDAS.' }] } }, '0001').productos
        .map(p => p.clase + ': ' + p.texto), ['43: RESTAURANTES.', '30: CAFÉ Y BEBIDAS.', '32: CAFÉ Y BEBIDAS.']);

    const entrada = { denominacion: 'lunafardo', clases: [43], solicitante: '', productos: '', tipo: 'nominativa' };
    const fuentes = { MARCia: { ok: true, total: 0 }, Marcanet: { ok: true, total: 4 }, SIGA: { ok: true, total: 0 } };
    const fila = (exp, clase) => ({ Titular: 'PHARMA GBC SAPI DE CV', Expediente: exp, Registro: '', 'Denominación': 'LUNA PHARMA', Clase: clase });
    const filas = [fila('3295484', '35 36 43'), fila('3295485', '10'), fila('3295486', '39'), fila('3295488', '5')];
    const detalles = {
        3295484: { 'Fecha de presentación': '07/01/2025 12:00:00 AM', 'Denominación': 'LUNA PHARMA', '35Edición 12 del Clasificador de Niza': 'PUBLICIDAD.' },
        3295486: { 'Fecha de presentación': '07/01/2025 12:00:00 AM', 'Denominación': 'LUNA PHARMA', '39Edición 12 del Clasificador de Niza': 'TRANSPORTE.' }
    };
    const base = { marcia: [], marcanet: [{ clase: null, resultados: filas }], siga: [], fuentes, detalles, fichas: { pedidas: 2, leidas: 2 } };

    // Sin las fichas de MARCia manda la clase de la búsqueda: conservador.
    const sinFichas = V.analizar(entrada, base, AHORA);
    const familia = V.agruparMarcas(sinFichas.antecedentes);
    igual('cuatro expedientes de la misma marca y titular: una fila', [familia.length, familia[0].miembros.length, sinFichas.conteo.total, sinFichas.conteo.expedientes], [1, 4, 1, 4]);
    igual('la fila toma el riesgo del más grave y junta las clases', [familia[0].riesgo, familia[0].expediente, familia[0].clases], ['alto', '3295484', [5, 10, 35, 36, 39, 43]]);
    igual('sin la ficha de MARCia, la clase de la búsqueda manda (se queda alto)', sinFichas.antecedentes.find(a => a.expediente === '3295484').riesgo, 'alto');
    igual('se pide la ficha de MARCia de los de riesgo alto y medio, con el año de su presentación',
        V.aConsultarMARCia(sinFichas), [{ expediente: '3295484', ids: ['RM202503295484'] }, { expediente: '3295486', ids: ['RM202503295486'] }]);
    igual('junto al año nuevo, también el id del año de al lado', V.aConsultarMARCia({ antecedentes: [
        { riesgo: 'alto', expediente: '1234', solicitud: '01/01/2021' }, { riesgo: 'medio', expediente: '5678', solicitud: '31/12/2020' },
        { riesgo: 'alto', id: 'RM201900111111', expediente: '111111' }, { riesgo: 'alto', expediente: '999' }, { riesgo: 'bajo', expediente: '42', solicitud: '05/05/2020' }] }),
        [{ expediente: '1234', ids: ['RM202100001234', 'RM202000001234'] }, { expediente: '5678', ids: ['RM202000005678', 'RM202100005678'] },
         { expediente: '111111', ids: ['RM201900111111'] }]);

    const fichasMARCia = { 3295484: f84, 3295486: V.leerFichaMARCia(fichaPharma('3295486', 39, 'TRANSPORTE; ORGANIZACIÓN DE VIAJES.'), '3295486') };
    const conFichas = V.analizar(entrada, { ...base, fichasMARCia, fichasM: { pedidas: 2, leidas: 2 } }, AHORA);
    const a84 = conFichas.antecedentes.find(a => a.expediente === '3295484'), a86 = conFichas.antecedentes.find(a => a.expediente === '3295486');
    igual('con su ficha de MARCia, el 3295484 es de la 35: bajo', [a84.clases, a84.riesgo], [[35], 'bajo']);
    verificar('y dice por qué, y lo que le citó el IMPI',
        /Clase según su ficha en MARCia \(la búsqueda de Marcanet mostraba 35, 36, 43\)/.test(a84.motivos.join('. ')) && /citó anterioridades \(oficio del 29\/04\/2025\)/.test(a84.motivos.join('. ')),
        a84.motivos.join('. '));
    igual('el de la 39, relacionada, sigue en medio y muestra lo que ampara', [a86.riesgo, a86.ampara, a86.id], ['medio', '39: TRANSPORTE; ORGANIZACIÓN DE VIAJES.', 'RM202503295486']);
    igual('la marca queda en riesgo medio: viabilidad media', [conFichas.dictamen.nivel, conFichas.conteo.alto, conFichas.conteo.medio, conFichas.conteo.bajo], ['media', 0, 1, 0]);
    const fam = V.agruparMarcas(conFichas.antecedentes)[0];
    igual('la fila de la marca la encabeza su expediente más grave', [fam.expediente, V.nombreDe(fam)], ['3295486', '«LUNA PHARMA» (exp. 3295486, exp. 3295484 y 2 más)']);
    const texto = V.resumenTexto(conFichas);
    verificar('el resumen lista sus expedientes', /\[MEDIO\] LUNA PHARMA — 4 expedientes de PHARMA GBC SAPI DE CV: exp\. 3295486 \(clase 39, .*riesgo medio\); exp\. 3295484 \(clase 35, .*riesgo bajo\)/.test(texto),
        texto.split('\n').find(l => /LUNA PHARMA/.test(l)));
    verificar('y cuántas fichas de MARCia se leyeron', /Fichas de MARCia: 2 de 2\./.test(texto));
    verificar('con lo que ampara, sin punto doble', /Ampara: 39: TRANSPORTE; ORGANIZACIÓN DE VIAJES\. En Gaceta|Ampara: 39: TRANSPORTE; ORGANIZACIÓN DE VIAJES\.$/m.test(texto) && !/\.\./.test(texto),
        texto.split('\n').find(l => /LUNA PHARMA/.test(l)));
    igual('lo ya leído no se vuelve a pedir', V.aConsultarMARCia(conFichas, 8, fichasMARCia), []);
    // Con otra clase en la ficha que sí es la del estudio, el riesgo sube.
    const sube = V.analizar(entrada, { ...base, fichasMARCia: { 3295485: { ...f84, clases: [10, 43], productos: [{ clase: 43, texto: 'RESTAURANTES.' }], oficios: [] } } }, AHORA);
    igual('si la ficha trae la clase del estudio, el riesgo sube', sube.antecedentes.find(a => a.expediente === '3295485').riesgo, 'alto');
    igual('el titular se compara sin su forma jurídica, con o sin puntos',
        ['PHARMA GBC SAPI DE CV', 'Pharma GBC, S.A.P.I. de C.V.', 'GRUPO X S DE RL DE CV', 'SHENZHEN NULING ELECTRONIC TECHNOLOGY CO., LTD'].map(V.claveTitular),
        ['PHARMA GBC', 'PHARMA GBC', 'GRUPO X', 'SHENZHEN NULING ELECTRONIC TECHNOLOGY']);
    igual('así, la misma marca del mismo titular escrito de dos formas es una fila', V.agruparMarcas([
        { titulo: 'LUNA PHARMA', titulares: ['PHARMA GBC SAPI DE CV'], riesgo: 'medio', similitud: { puntaje: 80 }, clases: [39], fuentes: ['Marcanet'] },
        { titulo: 'Luna Pharma', titulares: ['PHARMA GBC, S.A.P.I. DE C.V.'], riesgo: 'bajo', similitud: { puntaje: 80 }, clases: [5], fuentes: ['MARCia'] }])
        .map(f => [f.miembros.length, f.riesgo, f.clases, f.fuentes]), [[2, 'medio', [5, 39], ['Marcanet', 'MARCia']]]);
    // Todas las fichas, no solo las de riesgo alto y medio: así cada expediente
    // muestra su clase real (LUNA PHARMA 3295488 salía «1 5» y es solo 5).
    igual('con «todos», también se piden las de riesgo bajo; el año sale del expediente hermano',
        V.aConsultarMARCia(conFichas, 40, fichasMARCia, true), [{ expediente: '3295485', ids: ['RM202503295485'] }, { expediente: '3295488', ids: ['RM202503295488'] }]);
    const sinHermanos = V.analizar(entrada, { ...base, marcanet: [{ clase: null, resultados: filas.concat([
        { Titular: 'SHENZHEN NULING ELECTRONIC TECHNOLOGY CO., LTD', Expediente: '3417716', 'Denominación': 'LUNAFURY', Clase: '12 26 27 28' },
        { Titular: 'SHENZHEN NULING ELECTRONIC TECHNOLOGY CO., LTD', Expediente: '3417715', 'Denominación': 'LUNAFURY', Clase: '9 10 12' },
        { Titular: 'ITW POLY MEX, S.A. DE C.V.', Expediente: '565012', Registro: '782649', 'Denominación': 'LUNAFLEX', Clase: '1' },
        { Titular: 'MARIO  ALBERTO DONIZ', Expediente: '1270851', 'Denominación': 'GA.MA', Clase: '12' }]) }], fichasMARCia }, AHORA);
    igual('sin año ni hermano con fecha, se pide su ficha de Marcanet (una por grupo de hermanos, nada de los descartados)',
        V.aConsultarFechas(sinHermanos).map(o => o.expediente), ['3417716', '565012']);
    igual('y no se repite lo ya pedido', V.aConsultarFechas(sinHermanos, 20, ['3417716']).map(o => o.expediente), ['3417715', '565012']);
    igual('los titulares de Marcanet llegan sin espacios de más', V.desdeMarcanet({ 'Denominación': 'X', Expediente: '1', Titular: 'JOSÉ GERARDO  PACHUCA  HERNÁNDEZ ' }).titulares,
        ['JOSÉ GERARDO PACHUCA HERNÁNDEZ']);
    // Y una marca sin titular conocido no se junta con nada.
    igual('sin titular, cada expediente es su propia fila', V.agruparMarcas([
        { titulo: 'LUNA', titulares: [], riesgo: 'medio', similitud: { puntaje: 80 }, clases: [43], fuentes: ['SIGA'] },
        { titulo: 'LUNA', titulares: [], riesgo: 'medio', similitud: { puntaje: 80 }, clases: [43], fuentes: ['SIGA'] }]).length, 2);
}

console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
if (fallos.length) {
    console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
}
