/**
 * Worker de estrados del TSJ (docs/proxy/tsj-estrados-worker.js).
 *
 * El TSJ no es alcanzable desde las pruebas, así que se simula su respuesta
 * con páginas de ejemplo que imitan la tabla que leía el programa de
 * escritorio. Se prueba: que solo consulte estrados del TSJ (no es un proxy
 * abierto), que lea los acuerdos aunque la página venga en latin-1, que
 * distinga "sin resultados" de "tabla que carga aparte", y el informe.
 */
const path = require('path');
const { pathToFileURL } = require('url');

let pasadas = 0, fallidas = 0;
const fallos = [];
function verificar(desc, cond, detalle) {
    if (cond) { pasadas++; return; }
    fallidas++;
    fallos.push(desc + (detalle ? `\n      ${detalle}` : ''));
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const TABLA = `<!DOCTYPE html><html><head><meta charset="iso-8859-1"><title>Estrados</title></head><body>
<table id="tabla" class="display"><thead><tr><th>Acuerdo</th><th>Documento</th><th>Juicio</th><th>Promovente</th><th>Demandado</th><th>Extracto</th><th>Publicación</th></tr></thead>
<tbody>
<tr class="odd"><td>1234</td><td>ACUERDO</td><td>ORDINARIO CIVIL</td><td>JOSÉ PÉREZ</td><td>MARÍA NÚÑEZ</td><td>Se tiene por contestada la demanda &amp; se abre el periodo de pruebas.<br>Notifíquese.</td><td>26/09/2026</td></tr>
<tr class="even"><td>1201</td><td><a href="#">AUTO</a></td><td>ORDINARIO CIVIL</td><td>JOSÉ PÉREZ</td><td>MARÍA NÚÑEZ</td><td>Se admite la demanda.</td><td>10/09/2026</td></tr>
</tbody></table></body></html>`;

(async () => {
    const W = await import(pathToFileURL(path.join(__dirname, 'docs', 'proxy', 'tsj-estrados-worker.js')).href);

    // ---------- Solo estrados del TSJ ----------
    const q = (o) => W.urlDeConsulta(new URLSearchParams(o));
    igual('arma la consulta de primera instancia como la app',
        q({ int: '12', metodo: '1', findexp: '100/2025' }),
        'https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=12&metodo=1&findexp=100%2F2025');
    igual('arma la de segunda instancia (sala) con su área',
        q({ int: '170', areaId: '145', metodo: '1', findexp: '5/2026' }),
        'https://www.tsjqroo.gob.mx/estrados/buscador_segunda.php?findexp=5%2F2026&int=170&areaId=145&metodo=1');
    igual('acepta una URL de estrados copiada de la app',
        q({ url: 'https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=1&metodo=2&findexp=JUAN' }),
        'https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=1&metodo=2&findexp=JUAN');
    for (const mala of ['https://evil.com/estrados/buscador_primera.php', 'https://www.tsjqroo.gob.mx/admin.php',
        'https://tsjqroo.gob.mx.evil.com/estrados/buscador_primera.php', 'javascript:alert(1)', 'file:///etc/passwd']) {
        igual(`rechaza lo que no es estrados del TSJ: ${mala}`, q({ url: mala }), null);
    }
    igual('rechaza un juzgado que no es número', q({ int: '1;DROP', findexp: '1/2025' }), null);

    // ---------- Lectura ----------
    const acuerdos = W.extraerAcuerdos(TABLA);
    igual('lee las dos filas de acuerdos (y no el encabezado)', acuerdos.length, 2);
    igual('separa cada columna', [acuerdos[0].idAcuerdo, acuerdos[0].documento, acuerdos[0].fecha], ['1234', 'ACUERDO', '26/09/2026']);
    igual('limpia etiquetas, saltos y entidades del extracto', acuerdos[0].extracto,
        'Se tiene por contestada la demanda & se abre el periodo de pruebas. Notifíquese.');
    igual('lee el texto dentro de enlaces', acuerdos[1].documento, 'AUTO');

    const latin1 = Buffer.from(TABLA, 'latin1');
    const dec = W.decodificar(new Uint8Array(latin1), 'text/html');
    igual('respeta el charset de la página (latin-1)', W.extraerAcuerdos(dec.texto)[0].promoventes, 'JOSÉ PÉREZ');

    verificar('reconoce "sin resultados"', W.sinResultados('<p>No se encontraron publicaciones</p>'));
    verificar('una tabla con acuerdos no es "sin resultados"', !W.sinResultados(TABLA));
    const dinamica = W.pistasDeCargaDinamica(`<script src="js/jquery.dataTables.js"></script><script>
        $('#t').DataTable({ ajax: 'datos_primera.php?int=1&findexp=100' });</script>`);
    verificar('si la tabla carga aparte, da la dirección', dinamica.usaDataTables && dinamica.usaAjax &&
        dinamica.posiblesEndpoints.includes('datos_primera.php?int=1&findexp=100'), JSON.stringify(dinamica));

    // ---------- El worker completo, con el TSJ simulado ----------
    const pedidas = [];
    let respuesta = () => new Response(latin1, { status: 200, headers: { 'Content-Type': 'text/html; charset=ISO-8859-1' } });
    global.fetch = async (url, opciones) => { pedidas.push({ url: String(url), ua: opciones.headers['User-Agent'] }); return respuesta(); };
    const llamar = (ruta, origen) => W.default.fetch(new Request('https://tsj-estrados.test' + ruta, { headers: origen ? { Origin: origen } : {} }));

    let r = await llamar('/api/acuerdos?int=1&metodo=1&findexp=100/2025', 'https://tsjia.empirica.mx');
    let d = await r.json();
    igual('api/acuerdos: devuelve los acuerdos', d.acuerdos.map(a => a.idAcuerdo), ['1234', '1201']);
    igual('api/acuerdos: la app puede llamarlo (CORS)', r.headers.get('Access-Control-Allow-Origin'), 'https://tsjia.empirica.mx');
    verificar('se presenta con nombre propio ante el TSJ', /TSJFilingOnline/.test(pedidas[0].ua));
    r = await llamar('/api/acuerdos?int=1&findexp=1/2025', 'https://otro-sitio.com');
    igual('otros sitios no pueden usarlo desde el navegador', r.headers.get('Access-Control-Allow-Origin'), null);
    r = await llamar('/api/acuerdos?url=' + encodeURIComponent('https://example.com/'));
    igual('no es un proxy abierto', r.status, 400);

    r = await llamar('/api/diagnostico?url=' + encodeURIComponent('https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=1&metodo=1&findexp=100%2F2025'));
    d = await r.json();
    igual('diagnóstico: concluye que lee acuerdos', d.conclusion, 'LEE_ACUERDOS');
    igual('diagnóstico: muestra la estructura', d.muestraAcuerdos[0].fecha, '26/09/2026');

    respuesta = () => new Response('<html><body><table id="t"></table><script src="x.js"></script><script>$("#t").DataTable({ajax:"lista.php"})</script></body></html>', { status: 200 });
    d = await (await llamar('/api/diagnostico?int=1&findexp=9/2026')).json();
    igual('diagnóstico: detecta tabla que carga aparte', d.conclusion, 'TABLA_NO_ENCONTRADA');
    verificar('diagnóstico: y dice de dónde', d.pistas.posiblesEndpoints.includes('lista.php'));

    respuesta = () => new Response('<p>No se encontraron resultados</p>', { status: 200 });
    d = await (await llamar('/api/diagnostico?int=1&findexp=9/2026')).json();
    igual('diagnóstico: distingue un expediente sin publicaciones', d.conclusion, 'SIN_RESULTADOS_PARA_ESTE_EXPEDIENTE');

    respuesta = () => new Response('Forbidden', { status: 403 });
    d = await (await llamar('/api/diagnostico?int=1&findexp=9/2026')).json();
    igual('diagnóstico: detecta bloqueo', d.conclusion, 'BLOQUEADO_O_ERROR');

    // 522: Cloudflare no pudo conectarse con el servidor del TSJ, en ninguna página.
    respuesta = () => new Response('error code: 522', { status: 522 });
    pedidas.length = 0;
    d = await (await llamar('/api/diagnostico?repeticiones=3&int=1&findexp=9/2026')).json();
    igual('522: concluye que el sitio no es alcanzable desde Cloudflare', d.conclusion, 'SITIO_INALCANZABLE_DESDE_CLOUDFLARE');
    igual('522: no repite la consulta que no conecta', d.intentos.length, 1);
    igual('522: prueba la página principal, http y sin www', d.conectividad.map(c => c.url),
        ['https://www.tsjqroo.gob.mx/', 'http://www.tsjqroo.gob.mx/', 'https://tsjqroo.gob.mx/', 'https://www.tsjqroo.gob.mx/estrados/']);

    // Si la principal sí responde, el problema es esa página, no un bloqueo.
    respuesta = () => pedidas.length === 1 ? new Response('error code: 522', { status: 522 }) : new Response('<html>TSJ</html>', { status: 200 });
    pedidas.length = 0;
    d = await (await llamar('/api/diagnostico?int=1&findexp=9/2026')).json();
    igual('522 solo en estrados: no lo confunde con un bloqueo del sitio', d.conclusion, 'BLOQUEADO_O_ERROR');

    // Como se pega en la vida real: sin https://, o con los corchetes de un enlace.
    const esperada = 'https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=182&metodo=1&findexp=174%2F2026';
    igual('acepta la URL sin https://', q({ url: 'www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=182&metodo=1&findexp=174%2F2026' }), esperada);
    igual('acepta la URL con corchetes y paréntesis de un enlace copiado',
        q({ url: '[www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=182&metodo=1&findexp=174%2F2026](https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=182&metodo=1&findexp=174%2F2026)' }), esperada);
    igual('pero sigue rechazando otros sitios aunque mencionen al TSJ',
        q({ url: 'https://evil.com/?r=tsjqroo.gob.mx' }), null);

    // Varias URLs pegadas juntas: se usa la primera.
    igual('varias URLs pegadas: toma la primera', q({ url: 'https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=158&metodo=1&findexp=1421%2F2025 https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=109&metodo=1&findexp=2500%2F2025' }),
        'https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=158&metodo=1&findexp=1421%2F2025');

    global.fetch = async () => { throw new Error('TLS handshake failed'); };
    d = await (await llamar('/api/diagnostico?int=1&findexp=9/2026')).json();
    igual('diagnóstico: detecta que no conecta', d.conclusion, 'NO_CONECTA');

    const pagina = await (await llamar('/')).text();
    verificar('la página de prueba se abre con su formulario', /Probar/.test(pagina) && /api\/diagnostico/.test(pagina));

    console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
    if (fallidas) {
        console.log('  Fallos:');
        fallos.forEach(f => console.log('   ✗ ' + f));
        process.exit(1);
    }
    console.log('  ✓ El worker de estrados solo consulta al TSJ y lee sus acuerdos.');
})().catch(e => { console.error(e); process.exit(1); });
