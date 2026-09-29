/**
 * Servicio del revisor (servidor/revisor.mjs), con el TSJ y el PJF
 * simulados: rutas, validación (no es un proxy abierto), CORS, caché,
 * turnos entre consultas, límite por minuto y errores.
 */
const path = require('path');
const { pathToFileURL } = require('url');

let pasadas = 0, fallidas = 0;
const fallos = [];
const verificar = (d, c, det) => { if (c) { pasadas++; return; } fallidas++; fallos.push(d + (det ? `\n      ${det}` : '')); };
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const TSJ = `<html><body class="list_acuerdos"><table><thead><tr><th>IdAcuerdo</th></tr></thead><tbody>
<tr><td>777362</td><td>DEMANDA</td><td>ORDINARIO</td><td>A</td><td>B</td><td>AUDIENCIA</td><td>2026-09-24</td><td></td></tr></tbody></table></body></html>`;
const PJF = `<form id="form1"><span id="lblNEUN"></span><table id="grvAcuerdos"><tr><th>No.</th></tr>
<tr><td>72</td><td>27-08-2026</td><td>Principal</td><td>28-08-2026</td><td>Visto</td><td><a href="javascript:DoVerAcuerdo(585,2,31000072,1)">Ver</a></td></tr></table></form>`;

(async () => {
    const R = await import(pathToFileURL(path.join(__dirname, 'servidor', 'revisor.mjs')).href);
    const pedidas = [];
    let respuesta = (url) => ({ status: 200, html: url.includes('tsjqroo') ? TSJ : PJF, ms: 5 });
    const descargar = async (url) => { pedidas.push({ url, t: Date.now() }); return respuesta(url); };
    const srv = R.crearServicio({ descargar, pausaMs: 150, limitePorMinuto: 30 });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const get = async (ruta, origen) => {
        const r = await fetch(base + ruta, { headers: origen ? { Origin: origen } : {} });
        return { status: r.status, cors: r.headers.get('access-control-allow-origin'), datos: await r.json() };
    };

    try {
        let r = await get('/salud');
        igual('salud: responde con su versión', [r.status, r.datos.version], [200, R.VERSION]);

        r = await get('/api/tsj?int=182&metodo=1&findexp=174/2026', 'https://tsjia.empirica.mx');
        igual('TSJ: devuelve las publicaciones', r.datos.publicaciones.map(p => p.id), ['tsj:777362']);
        igual('TSJ: arma la URL oficial de estrados', pedidas[0].url, 'https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=182&metodo=1&findexp=174%2F2026');
        igual('TSJ: la app puede llamarlo (CORS)', r.cors, 'https://tsjia.empirica.mx');

        r = await get('/api/tsj?int=182&metodo=1&findexp=174/2026');
        igual('caché: la misma consulta no vuelve a molestar al TSJ', [pedidas.length, r.datos.cache], [1, true]);

        r = await get('/api/tsj?int=175&areaId=150&metodo=1&findexp=61/2026');
        igual('TSJ: salas de segunda instancia', pedidas[1].url, 'https://www.tsjqroo.gob.mx/estrados/buscador_segunda.php?findexp=61%2F2026&int=175&areaId=150&metodo=1');

        r = await get('/api/pjf?organismo=585&tipoasunto=4&expediente=102/2018', 'https://jorch01.github.io');
        igual('PJF: devuelve los autos', r.datos.publicaciones.map(p => [p.id, p.fecha]), [['pjf:31000072', '2026-08-28']]);
        igual('PJF: arma la URL oficial de consulta', pedidas[2].url, 'https://www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx?tipoasunto=4&organismo=585&expediente=102%2F2018&tipoprocedimiento=0');

        for (const mala of ['/api/tsj?int=abc&findexp=1/2025', '/api/tsj?int=1', '/api/pjf?organismo=585&tipoasunto=4&expediente=<script>',
            '/api/pjf?organismo=x&tipoasunto=4&expediente=1/2025', '/api/tsj?url=https://evil.com']) {
            igual(`no es un proxy abierto: ${mala}`, (await get(mala)).status, 400);
        }
        igual('otros sitios no pueden llamarlo desde el navegador', (await get('/salud', 'https://otro.com')).cors, null);

        // Turnos: dos consultas distintas al TSJ quedan separadas por la pausa.
        const antes = pedidas.length;
        await Promise.all([get('/api/tsj?int=1&findexp=1/2020'), get('/api/tsj?int=1&findexp=2/2020')]);
        const [a, b] = pedidas.slice(antes);
        verificar('turnos: una consulta a la vez con pausa entre ellas', b.t - a.t >= 140, `${b.t - a.t} ms`);

        // Errores del tribunal y cambios de forma.
        respuesta = () => ({ status: 0, error: 'sin respuesta', ms: 30000 });
        r = await get('/api/tsj?int=1&findexp=9/2020');
        igual('si el TSJ no responde: 502 con el motivo', [r.status, r.datos.ok, r.datos.error], [502, false, 'sin respuesta']);
        respuesta = () => ({ status: 200, html: '<html>mantenimiento</html>', ms: 5 });
        r = await get('/api/tsj?int=1&findexp=8/2020');
        igual('si la página del TSJ cambia de forma, lo dice', r.datos.error, 'La página del TSJ cambió de forma');
        r = await get('/api/pjf?organismo=1&tipoasunto=1&expediente=8/2020');
        verificar('si la del PJF cambia de forma, lo dice', /cambió de forma/.test(r.datos.error || ''));
        respuesta = () => ({ status: 200, html: '<p>No se encontraron resultados</p>', ms: 5 });
        r = await get('/api/tsj?int=1&findexp=7/2020');
        igual('expediente sin publicaciones no es error', [r.status, r.datos.publicaciones], [200, []]);
        r = await get('/salud');
        verificar('salud: registra el estado de cada tribunal', r.datos.tribunales.tsj.ok === true && r.datos.tribunales.pjf.ok === false);

        // Límite por minuto.
        let ultimo;
        for (let i = 0; i < 25; i++) ultimo = await get(`/api/tsj?int=2&findexp=${i}/2021`);
        igual('límite: demasiadas consultas en un minuto → 429', ultimo.status, 429);
    } finally {
        srv.close();
    }

    console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
    if (fallidas) { console.log('  Fallos:'); fallos.forEach(f => console.log('   ✗ ' + f)); process.exit(1); }
    console.log('  ✓ El servicio del revisor consulta al TSJ y al PJF con cuidado y solo a ellos.');
})().catch(e => { console.error(e); process.exit(1); });
