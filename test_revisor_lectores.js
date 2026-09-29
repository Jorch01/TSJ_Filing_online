/**
 * Revisor de acuerdos nuevos: lectores del TSJ y del PJF (servidor/lectores.mjs)
 * con la estructura real de sus páginas (vista desde Oracle Querétaro).
 */
const path = require('path');
const { pathToFileURL } = require('url');

let pasadas = 0, fallidas = 0;
const fallos = [];
const verificar = (d, c, det) => { if (c) { pasadas++; return; } fallidas++; fallos.push(d + (det ? `\n      ${det}` : '')); };
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const TSJ = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body class="list_acuerdos"><h1>JUZGADO</h1><table class="tinytable floatThead-table"><thead><tr><th class="head">IdAcuerdo</th><th class="head">Documento</th><th class="head">Juicio</th><th class="head">Promoventes</th><th class="head">Demandados</th><th class="head">Extracto</th><th class="head">Fecha Publicación</th><th></th></tr></thead><tbody>
<tr><td>777362</td><td>DEMANDA INICIAL</td><td>ORDINARIO CIVIL</td><td>ACTOR</td><td>DEMANDADO</td><td>AUDIENCIA PREVIA Y DE CONCILIACI&Oacute;N</td><td>2026-09-24</td><td><a href="https://gestionchetumal.tsjqroo.gob.mx/Consulta" target="_blank"><img alt="Exp" src="images/exp3.png" width="28px"></a></td></tr>
<tr><td>776315</td><td>DEMANDA INICIAL</td><td>ORDINARIO CIVIL</td><td>ACTOR</td><td>DEMANDADO</td><td>MANDA A NOTIFICAR</td><td>2026-09-17</td><td><a href="#"><img alt="Exp"></a></td></tr>
</tbody></table></body></html>`;

const fila = (n, fa, fp, id, resumen) => `<tr><td align="center" style="width:80px;"><span id="grvAcuerdos_ctl0${n}_lblContenido">${n}</span></td><td style="width:10%;">${fa}</td><td style="width:10%;">Principal / Procedimiento</td><td style="width:10%;">${fp}</td><td style="width:70%;">${resumen}</td><td align="center"><a id="grvAcuerdos_ctl0${n}_lnkTicketLink2" href="javascript:DoVerAcuerdo(585,2,${id},1,&quot;21/12/2018 12:00:00 a.m.&quot;,&quot;24/12/2018 12:00:00 a.m.&quot;,&quot;102/2018&quot;)">Ver síntesis</a></td></tr>`;
const PJF = `<html><body><form name="form1" method="post" id="form1"><input type="hidden" name="__VIEWSTATE" value="x"/>
<span id="lblNEUN">NEUN</span>
<table><tr><td><table><tr><td>Fecha de ingreso</td><td>11/12/2018</td></tr></table></td></tr></table>
<table cellspacing="0" rules="all" border="1" id="grvAcuerdos" style="color:#180C3E;"><tr><th>No.</th><th>Fecha del Auto</th><th>Tipo Cuaderno</th><th>Fecha de publicación</th><th>Resumen</th><th>Ver síntesis completa</th></tr>
${fila(1, '21-12-2018', '24-12-2018', 24057728, 'Pozo... se admite la demanda')}
${fila(8, '02-10-2019', '', 25000001, 'Pozo sin publicación')}
${fila(72, '27-08-2026', '28-08-2026', 31000072, '... Visto el estado de autos')}
</table>
<table id="grvReporteSentencias"><tr><td>1</td><td>01-01-2026</td><td>x</td><td>y</td><td>no es un auto</td></tr></table>
<a href="javascript:__doPostBack('grvReporteSentencias$ctl02$SentenciasLinkButton','')">sentencia</a>
</form></body></html>`;

(async () => {
    const L = await import(pathToFileURL(path.join(__dirname, 'servidor', 'lectores.mjs')).href);

    igual('fechas: DD-MM-AAAA a ISO', L.fechaISO('21-12-2018'), '2018-12-21');
    igual('fechas: DD/MM/AAAA a ISO', L.fechaISO('1/7/2019'), '2019-07-01');
    igual('fechas: ISO se respeta', L.fechaISO('2026-09-24'), '2026-09-24');
    igual('fechas: vacía es null', L.fechaISO(''), null);

    // TSJ
    const t = L.leerTSJ(TSJ);
    igual('TSJ: lee los acuerdos (sin el encabezado)', t.map(x => x.id), ['tsj:777362', 'tsj:776315']);
    igual('TSJ: fecha y texto', [t[0].fecha, t[0].texto], ['2026-09-24', 'AUDIENCIA PREVIA Y DE CONCILIACIÓN']);
    verificar('TSJ: "sin resultados"', L.sinResultadosTSJ('<p>No se encontraron resultados</p>') && !L.sinResultadosTSJ(TSJ));

    // PJF
    const p = L.leerPJF(PJF);
    igual('PJF: solo los autos de grvAcuerdos (no las sentencias ni los datos del asunto)', p.map(x => x.numero), ['1', '8', '72']);
    igual('PJF: el id es el interno de "Ver"', p.map(x => x.id), ['pjf:24057728', 'pjf:25000001', 'pjf:31000072']);
    igual('PJF: fechas del auto y de publicación', [p[0].fechaAuto, p[0].fechaPublicacion, p[0].fecha], ['2018-12-21', '2018-12-24', '2018-12-24']);
    igual('PJF: sin fecha de publicación usa la del auto', [p[1].fechaPublicacion, p[1].fecha], [null, '2019-10-02']);
    igual('PJF: el resumen sin los puntos suspensivos iniciales', p[2].texto, 'Visto el estado de autos');
    verificar('PJF: reconoce la página de consulta', L.esConsultaPJF(PJF) && !L.esConsultaPJF('<html>error</html>'));
    igual('PJF: página sin tabla de autos no inventa nada', L.leerPJF('<form id="form1"><span id="lblNEUN"></span></form>'), []);
    const sinVer = PJF.replace(/DoVerAcuerdo\([^)]*\)/g, 'void(0)');
    igual('PJF: sin enlace "Ver", el id sale del número y la fecha', L.leerPJF(sinVer)[0].id, 'pjf:n1:2018-12-21');

    // Novedades
    const vistos = new Set(['pjf:24057728', 'pjf:25000001']);
    igual('novedades: solo lo que no se había visto', L.novedades(p, vistos).map(x => x.numero), ['72']);
    igual('novedades: la primera revisión no avisa de todo el historial', L.novedades(p, new Set(), { primeraVez: true }), []);

    console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
    if (fallidas) { console.log('  Fallos:'); fallos.forEach(f => console.log('   ✗ ' + f)); process.exit(1); }
    console.log('  ✓ El revisor lee los acuerdos del TSJ y los autos del PJF y sabe qué es nuevo.');
})().catch(e => { console.error(e); process.exit(1); });
