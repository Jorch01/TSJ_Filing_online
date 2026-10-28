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
    igual('conteo por riesgo', [rep.conteo.alto, rep.conteo.medio, rep.conteo.bajo], [1, 1, 1]);
    igual('los de mayor riesgo van primero', rep.antecedentes[0].riesgo, 'alto');
    igual('las publicaciones en Gaceta parecidas, no las demás', rep.publicaciones.map(p => p.denominacion), ['LUNA AZUL CAFÉ']);
    verificar('recomienda cambiar la denominación', rep.recomendaciones.some(r => /Cambia la denominación/.test(r)));
    verificar('y menciona la caducidad por falta de uso', rep.recomendaciones.some(r => /caducidad/.test(r)));
    verificar('y la oposición en Gaceta', rep.recomendaciones.some(r => /oposición/.test(r)));
    igual('revisa también las clases relacionadas', rep.relacionadas.includes(32), true);
    igual('guarda qué fichas de SIGA ya vio (para vigilar sin falsas novedades)', rep.fichasSIGA, [1, 2]);

    const parcial = V.analizar(entrada, { ...crudo, fuentes: { ...fuentesOk, SIGA: { ok: false, error: 'HTTP 502' } } }, AHORA);
    verificar('si una fuente no respondió, el dictamen lo dice', parcial.dictamen.parcial && /SIGA no respondió/.test(parcial.dictamen.resumen), parcial.dictamen.resumen);
    verificar('y recomienda repetirlo', parcial.recomendaciones.some(r => /Repite el estudio para completar SIGA/.test(r)));
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
    igual('cuenta solo lo que se parece: 1 alto, 4 bajos, 1 descartado (GA.MA)',
        [conFicha.conteo.alto, conFicha.conteo.medio, conFicha.conteo.bajo, conFicha.conteo.descartados], [1, 0, 4, 1]);
    igual('GA.MA queda marcado como descartado', conFicha.antecedentes.filter(a => a.descartado).map(a => a.titulo), ['GA.MA']);
    verificar('el resumen lo dice', /4 bajo \(y 1 resultado que no se parece, descartado\)/.test(V.resumenTexto(conFicha)), V.resumenTexto(conFicha).split('\n')[7]);

    // Recomendaciones: lo ya confirmado no se vuelve a pedir; con un solo
    // obstáculo, la carta de consentimiento es una salida.
    const recs = conFicha.recomendaciones.join('\n');
    verificar('no pide confirmar en Marcanet lo que ya se confirmó', !/Antes de presentar, confirma en Marcanet/.test(recs) && /se confirmó en su ficha de Marcanet el \d\d\/\d\d\/\d{4}/.test(recs), recs);
    verificar('con un solo obstáculo sugiere la carta de consentimiento de su titular',
        /negociar con FERNANDO NESTOR POCH Y CLAUDIA MARIA VILLALOBOS MAYA, titular de «LUNFARDO» \(reg\. 1261657\), una carta de consentimiento/.test(recs), recs);
    verificar('lo que se quedó sin ficha sí se pide confirmar',
        /Antes de presentar, confirma en Marcanet el estatus de «LUNFARDO»/.test(sinFicha.recomendaciones.join('\n')), sinFicha.recomendaciones.join('\n'));
    const muchos = { ...conFicha, antecedentes: [1, 2, 3].map(i => ({ ...conFicha.antecedentes[0], registro: String(i), expediente: String(i) })) };
    verificar('con muchos obstáculos, no', !/carta de consentimiento/.test(V.recomendaciones(muchos).join(' ')));
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
    igual('y el de una clase relacionada (39) sí', a39.ampara, '39: TRANSPORTE; ORGANIZACIÓN DE VIAJES.');
}

console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
if (fallos.length) {
    console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
}
