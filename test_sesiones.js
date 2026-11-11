#!/usr/bin/env node
/**
 * Sesiones de los Tribunales Colegiados (listas de sesión de SISE).
 *
 *   node test_sesiones.js                   sin red: lo que corre en CI
 *   SISE_EN_VIVO=1 node test_sesiones.js    además, consultas reales a SISE
 *
 * Lo que se fija aquí:
 *   - el lector de la lista de sesión (docs/proxy/impi-proxy-worker.js,
 *     sección SESIONES SISE) con el HTML real de SISE, guardado en
 *     test_fixtures/: separa "Amparo Directo\n677/2023" en tipo y número/año,
 *     y distingue un día sin sesión de una página que no es la lista;
 *   - los días hábiles y el periodo por defecto (lunes de esta semana al
 *     viernes de la siguiente; 4 semanas como mucho);
 *   - que se pregunta primero al calendario y solo se piden los días con
 *     sesión, ordinaria y extraordinaria; de pocas en pocas, con un reintento,
 *     y que una llamada caída va a "errores" sin tumbar lo demás;
 *   - que el resultado se recuerda 6 horas y ?refresh=1 lo salta;
 *   - que cada expediente se busca con su tipo de asunto (en una misma lista
 *     hay quejas, revisiones y amparos directos con el mismo número);
 *   - en la app (docs/js/sesiones-pjf.js): qué expedientes son de un tribunal
 *     colegiado y se pueden buscar, y que la tarjeta está conectada.
 *
 * En los fixtures, el __VIEWSTATE y el token del video están recortados; el
 * resto es la respuesta de SISE tal cual.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const App = require('./docs/js/sesiones-pjf.js');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}
const igual = (d, a, b) => verificar(d, JSON.stringify(a) === JSON.stringify(b), `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);
function lanza(descripcion, fn, patron) {
    let mensaje = null;
    try { fn(); } catch (e) { mensaje = e.message; }
    verificar(descripcion, mensaje !== null && (!patron || patron.test(mensaje)), mensaje === null ? 'no lanzó error' : mensaje);
}

const fixture = (nombre) => fs.readFileSync(path.join(__dirname, 'test_fixtures', nombre), 'utf8');
const LISTA = fixture('sise_reporte_462_lista_2026-11-04.html');
const SESION = fixture('sise_reporte_462_sesion_2026-11-12.html');
const VACIA = fixture('sise_reporte_sin_registros.html');
const CAL_NOV = fixture('sise_calendario_462_2026-11.html');
const CAL_DIC = fixture('sise_calendario_462_2026-12.html');

// La sección SESIONES SISE del worker, tal cual, en un contexto aislado.
const WORKER = fs.readFileSync(path.join(__dirname, 'docs', 'proxy', 'impi-proxy-worker.js'), 'utf8');
const seccion = WORKER.slice(WORKER.indexOf('// ==================== SESIONES SISE (INICIO)'), WORKER.indexOf('// ==================== SESIONES SISE (FIN)'));
const W = {
    URL, AbortController, setTimeout, clearTimeout,
    sha256Hex: async (t) => crypto.createHash('sha256').update(String(t)).digest('hex')
};
vm.createContext(W);
vm.runInContext(seccion + `
Object.assign(this, { SESIONES, sesMemoria, sesVisitas, sesFechaValida, sesSumarDias, sesHoy, sesRangoPorDefecto, sesDiasHabiles,
    sesMeses, sesFechaAISO, sesFechaSise, sesTexto, sesTipoNormal, sesClaveExpediente, sesSepararExpediente, sesParsearReporte,
    sesParsearCalendario, sesLeerExpedientes, sesCoincidencias, sesPedir, sesConsultar, atenderSesiones });`, W);

// ---------- Un SISE de mentira ----------

const cuerpoDe = (opciones) => Object.fromEntries(JSON.parse(opciones.body).map(p => [p.Item, p.Valor]));
const respuesta = (texto, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => texto });

/**
 * Responde como SISE con los fixtures: el calendario de noviembre de 2026
 * marca 04, 05, 09, 12 y 13; la sesión ordinaria del 12 trae 41 asuntos y lo
 * demás no tiene registros. `alterar(llamada)` puede devolver otra respuesta
 * o lanzar un error.
 */
function siseFalso(alterar) {
    const llamadas = [];
    let enCurso = 0;
    const estado = { llamadas, maxALaVez: 0 };
    estado.fetch = async (url, opciones) => {
        const c = cuerpoDe(opciones);
        const llamada = { url, cuerpo: c, crudo: opciones.body, cabeceras: opciones.headers, metodo: opciones.method, senal: opciones.signal };
        llamada.esCalendario = /Controles\/ucCalendario\.aspx$/.test(url);
        llamada.veces = llamadas.filter(l => l.crudo === opciones.body && l.url === url).length + 1;
        llamadas.push(llamada);
        enCurso++;
        estado.maxALaVez = Math.max(estado.maxALaVez, enCurso);
        try {
            await new Promise(ok => setTimeout(ok, 2));
            const otra = alterar ? await alterar(llamada) : undefined;
            if (otra !== undefined) return otra;
            if (llamada.esCalendario) {
                if (c.AnioSiguiente === '2026' && c.MesSiguiente === '11') return respuesta(CAL_NOV);
                if (c.AnioSiguiente === '2026' && c.MesSiguiente === '12') return respuesta(CAL_DIC);
                return respuesta('<html>otro mes</html>');
            }
            if (c.Fecha === '12/11/2026' && c.TipoSesion === '20651' && c.OrganismoId === '462') return respuesta(SESION);
            return respuesta(VACIA);
        } finally {
            enCurso--;
        }
    };
    return estado;
}

const pausas = [];
function deps(sise, ahora) {
    return {
        fetch: sise.fetch,
        esperar: async (ms) => { pausas.push(ms); },
        ahora: () => Date.parse(ahora || '2026-11-10T18:00:00Z'),
        ip: sise.ip || ''
    };
}
const consultar = (sise, consulta) => W.sesConsultar(
    Object.assign({ desde: '2026-11-09', hasta: '2026-11-20', filtro: 'sesion' }, consulta),
    { fetch: sise.fetch, esperar: async (ms) => { pausas.push(ms); }, cuenta: { hechas: 0 } });
const expedientes = (texto) => W.sesLeerExpedientes(texto).porOrganismo;
const pedir = (sise, consulta, env, ahora) => W.atenderSesiones(
    new URL('https://proxy.test/api/sesiones?' + consulta), env || {}, deps(sise, ahora));
const reportes = (sise) => sise.llamadas.filter(l => !l.esCalendario);

(async () => {
    console.log('\nDías hábiles');
    {
        igual('dos semanas de lunes a viernes: 10 días, sin sábados ni domingos',
            W.sesDiasHabiles('2026-11-09', '2026-11-20'),
            ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
        igual('un rango que empieza en sábado arranca el lunes', W.sesDiasHabiles('2026-11-07', '2026-11-09'), ['2026-11-09']);
        igual('un fin de semana no tiene días hábiles', W.sesDiasHabiles('2026-11-14', '2026-11-15'), []);
        igual('un solo día hábil', W.sesDiasHabiles('2026-11-12', '2026-11-12'), ['2026-11-12']);
        igual('cruza de año sin perder días',
            W.sesDiasHabiles('2026-12-30', '2027-01-05'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-04', '2027-01-05']);
        igual('el 29 de febrero de un año bisiesto cuenta', W.sesDiasHabiles('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
        igual('con las fechas al revés, nada', W.sesDiasHabiles('2026-11-20', '2026-11-09'), []);
    }

    console.log('\nPeriodo por defecto: del lunes de esta semana al viernes de la siguiente');
    {
        const rango = (hoy) => { const r = W.sesRangoPorDefecto(hoy); return [r.desde, r.hasta]; };
        igual('un martes', rango('2026-11-10'), ['2026-11-09', '2026-11-20']);
        igual('el propio lunes', rango('2026-11-09'), ['2026-11-09', '2026-11-20']);
        igual('un viernes', rango('2026-11-13'), ['2026-11-09', '2026-11-20']);
        igual('un sábado sigue en su semana', rango('2026-11-14'), ['2026-11-09', '2026-11-20']);
        igual('en domingo, la semana es la que empieza mañana', rango('2026-11-15'), ['2026-11-16', '2026-11-27']);
        igual('a fin de año cruza a enero', rango('2026-12-30'), ['2026-12-28', '2027-01-08']);
        igual('"hoy" es el de Quintana Roo, no el del servidor (UTC)', W.sesHoy(Date.parse('2026-11-10T03:30:00Z'), 'America/Cancun'), '2026-11-09');
        igual('y a mediodía coinciden', W.sesHoy(Date.parse('2026-11-10T18:00:00Z'), 'America/Cancun'), '2026-11-10');
        igual('los meses de un rango', W.sesMeses('2026-11-23', '2026-12-04').map(m => m.clave), ['2026-11', '2026-12']);
        igual('de diciembre a enero', W.sesMeses('2026-12-28', '2027-01-08').map(m => [m.anio, m.mes]), [[2026, 12], [2027, 1]]);
        igual('fechas que no existen no pasan',
            ['2026-02-30', '2026-13-01', '12/11/2026', '', '2026-11-12'].map(f => W.sesFechaValida(f)), [false, false, false, false, true]);
        igual('la fecha va a SISE como dd/mm/aaaa y vuelve', [W.sesFechaSise('2026-11-04'), W.sesFechaAISO('04/11/2026'), W.sesFechaAISO('4/1/2027')],
            ['04/11/2026', '2026-11-04', '2027-01-04']);

        // La app calcula el mismo periodo que el proxy.
        const distintos = [];
        for (let i = 0; i < 21; i++) {
            const hoy = W.sesSumarDias('2026-12-20', i);
            if (JSON.stringify(App.rangoDeSemanas(hoy, 2)) !== JSON.stringify(W.sesRangoPorDefecto(hoy))) distintos.push(hoy);
        }
        igual('la app y el proxy calculan el mismo periodo, cualquier día', distintos, []);
        igual('la app: 1, 3 y 4 semanas',
            [1, 3, 4].map(n => App.rangoDeSemanas('2026-11-10', n).hasta), ['2026-11-13', '2026-11-27', '2026-12-04']);
        igual('la app: nunca más de 4 semanas ni menos de 1',
            [App.rangoDeSemanas('2026-11-10', 9).hasta, App.rangoDeSemanas('2026-11-10', 0).hasta, App.rangoDeSemanas('2026-11-10', -3).hasta],
            ['2026-12-04', '2026-11-20', '2026-11-13']);
        igual('la app toma la fecha local del dispositivo', App.rangoDeSemanas(new Date(2026, 10, 10, 23, 30), 2), { desde: '2026-11-09', hasta: '2026-11-20' });
    }

    console.log('\nLa lista de sesión (HTML real de SISE: órgano 462, lista del 04/11/2026)');
    {
        const filas = W.sesParsearReporte(LISTA);
        igual('trae sus 42 asuntos', filas.length, 42);
        igual('el primero, completo', filas[0], {
            neun: '33638865', tipoAsunto: 'Amparo Directo', expediente: '677/2023',
            autoridad: 'Junta Especial Número Cincuenta y Seis de la Federal de Conciliación y Arbitraje de Cancún Quintana Roo (AUTORIDAD RESPONSABLE)',
            ponente: 'Maria Teresa Rodriguez Cardenas', secretario: 'Carlos Hernández García',
            fechaSesion: '2026-11-12', resultado: '', sentencia: ''
        });
        verificar('"Amparo Directo\\n677/2023" llega sin el salto de línea', /Amparo Directo\r?\n677\/2023/.test(LISTA) && !filas.some(f => /[\r\n]/.test(f.tipoAsunto + f.expediente)));
        verificar('todos con número/año', filas.every(f => /^\d+\/\d{4}$/.test(f.expediente)), JSON.stringify(filas.filter(f => !/^\d+\/\d{4}$/.test(f.expediente))));
        verificar('todos con NEUN de solo dígitos', filas.every(f => /^\d+$/.test(f.neun)));
        const porTipo = {};
        filas.forEach(f => { porTipo[f.tipoAsunto] = (porTipo[f.tipoAsunto] || 0) + 1; });
        igual('el tipo de asunto queda separado del número', Object.entries(porTipo).sort(),
            [['Amparo Directo', 10], ['Amparo en revisión', 11], ['Conflictos Competenciales', 3], ['Inconformidades', 3], ['Queja', 14], ['Revisión Fiscal', 1]]);
        igual('los amparos directos de la lista', filas.filter(f => f.tipoAsunto === 'Amparo Directo').map(f => f.expediente).slice(0, 3), ['677/2023', '325/2024', '456/2025']);
        igual('la lista del 4 trae sesiones del 12 y una del 13', [...new Set(filas.map(f => f.fechaSesion))].sort(), ['2026-11-12', '2026-11-13']);
        verificar('los dobles espacios de los nombres se quedan en uno', /Hernández {2}García/.test(LISTA) && filas.every(f => !/\s{2}/.test(f.secretario + f.ponente + f.autoridad)));

        igual('el filtro "sesion" del día 12 trae los mismos asuntos menos el del 13',
            [W.sesParsearReporte(SESION).length, W.sesParsearReporte(SESION).every(f => f.fechaSesion === '2026-11-12')], [41, true]);
        igual('un día sin sesión: lista vacía', W.sesParsearReporte(VACIA), []);
        verificar('(y esa página dice "No se localizaron registros")', /No se localizaron registros/.test(VACIA));

        lanza('una página que no es la lista no pasa por "sin asuntos"', () => W.sesParsearReporte('<html><body><h1>The resource cannot be found.</h1></body></html>'), /no es la lista/);
        lanza('ni el calendario', () => W.sesParsearReporte(CAL_NOV), /no es la lista/);
        lanza('ni una respuesta vacía', () => W.sesParsearReporte(''), /no es la lista/);
        lanza('si SISE quita una columna necesaria, se avisa',
            () => W.sesParsearReporte(LISTA.replace('>NEUN<', '>Folio<')), /cambió de columnas/);
        lanza('y si una fila trae otro número de celdas, también',
            () => W.sesParsearReporte(LISTA.replace('<td>33638865</td>', '')), /otro número de columnas/);

        const revuelta = '<table><tr class="trtitulo"><td>Fecha de Sesión</td><td>No. Expediente</td><td>NEUN</td><td>Magistrado Ponente</td></tr>' +
            '<tr><td> 03/12/2026 </td><td>Amparo  Directo<br/>\r\n  0012/2026</td><td>777</td><td>Jos&eacute; P&#233;rez &amp; Asociados</td></tr></table>';
        igual('las columnas se leen por su título, no por su posición', W.sesParsearReporte(revuelta), [{
            neun: '777', tipoAsunto: 'Amparo Directo', expediente: '12/2026', autoridad: '', ponente: 'José Pérez & Asociados',
            secretario: '', fechaSesion: '2026-12-03', resultado: '', sentencia: ''
        }]);

        igual('la celda del expediente, en sus variantes', [
            W.sesSepararExpediente('Amparo Directo\n677/2023'),
            W.sesSepararExpediente('Amparo en revisión\r\n   12/2026'),
            W.sesSepararExpediente('Queja 661/2026'),
            W.sesSepararExpediente('<b>Amparo Directo</b><br>0045 / 2025'),
            W.sesSepararExpediente('Sin número')
        ], [
            { tipoAsunto: 'Amparo Directo', expediente: '677/2023' },
            { tipoAsunto: 'Amparo en revisión', expediente: '12/2026' },
            { tipoAsunto: 'Queja', expediente: '661/2026' },
            { tipoAsunto: 'Amparo Directo', expediente: '45/2025' },
            { tipoAsunto: 'Sin número', expediente: '' }
        ]);
        igual('un "&amp;lt;" no se convierte en etiqueta', W.sesTexto('a &amp;lt;b&amp;gt; c'), 'a &lt;b&gt; c');
    }

    console.log('\nEl calendario del mes');
    {
        igual('noviembre de 2026: los días con sesión', W.sesParsearCalendario(CAL_NOV, 2026, 11),
            ['2026-11-04', '2026-11-05', '2026-11-09', '2026-11-12', '2026-11-13']);
        igual('diciembre, todavía sin listas: ninguno', W.sesParsearCalendario(CAL_DIC, 2026, 12), []);
        lanza('si SISE devuelve otro mes, no se da por bueno', () => W.sesParsearCalendario(CAL_NOV, 2026, 12), /otro mes/);
        lanza('ni una página que no es el calendario', () => W.sesParsearCalendario(VACIA, 2026, 11), /no es el calendario/);
    }

    console.log('\nQué expedientes se buscan');
    {
        igual('número/año de un expediente, como venga escrito',
            ['677/2023', 'AD 0677/2023', '677/2023-II', ' 677 / 2023 ', 'D.C. 15/25', 'Amparo Directo', '', '2023'].map(t => W.sesClaveExpediente(t)),
            ['677/2023', '677/2023', '677/2023', '677/2023', '15/2025', null, null, null]);
        const pedidos = W.sesLeerExpedientes('462:677/2023, 462:AD 0325/2024,944:15/2025:33638865,462:677/2023,');
        igual('se agrupan por tribunal, sin repetidos', [...pedidos.porOrganismo.entries()],
            [['462', [{ clave: '677/2023', neun: '', tipo: 'amparo directo' }, { clave: '325/2024', neun: '', tipo: 'amparo directo' }]],
             ['944', [{ clave: '15/2025', neun: '33638865', tipo: 'amparo directo' }]]]);
        igual('el total y la forma canónica (para recordar el resultado)', [pedidos.total, pedidos.canon],
            [3, '462:325/2024:~amparo directo,462:677/2023:~amparo directo,944:15/2025:33638865~amparo directo']);
        igual('el orden en que llegan no cambia la forma canónica',
            W.sesLeerExpedientes('944:15/2025:33638865,462:325/2024,462:677/2023').canon, pedidos.canon);
        verificar('sin expedientes, error que dice qué falta', /Falta "exp"/.test(W.sesLeerExpedientes('').error));
        verificar('uno mal escrito, error que lo señala', /"462:sin numero"/.test(W.sesLeerExpedientes('462:677/2023,462:sin numero').error));
        verificar('sin tribunal, error', !!W.sesLeerExpedientes('677/2023').error);
        verificar('el tribunal tiene que ser un número', !!W.sesLeerExpedientes('abc:677/2023').error);
        verificar('más tribunales de los permitidos, error',
            /Demasiados tribunales/.test(W.sesLeerExpedientes(Array.from({ length: 13 }, (_, i) => (100 + i) + ':1/2026').join(',')).error));
        verificar('más expedientes de los permitidos, error',
            /Demasiados expedientes/.test(W.sesLeerExpedientes(Array.from({ length: 301 }, (_, i) => '462:' + (i + 1) + '/2026').join(',')).error));

        const filas = W.sesParsearReporte(LISTA);
        const queja = filas.find(f => f.tipoAsunto === 'Queja');
        const hallados = (texto) => W.sesCoincidencias(filas, expedientes(texto).get('462')).map(c => [c.registro.tipoAsunto, c.registro.expediente, c.coincidencia]);
        igual('un expediente que no dice su tipo es un amparo directo', hallados('462:677/2023,462:325/2024,462:9999/2020'),
            [['Amparo Directo', '677/2023', 'expediente'], ['Amparo Directo', '325/2024', 'expediente']]);
        igual('una queja con ese número no es mi amparo directo', hallados('462:' + queja.expediente).filter(h => h[0] === 'Queja'), []);
        igual('con NEUN coincide aunque el número esté mal capturado', hallados('462:1/2020:33638865'), [['Amparo Directo', '677/2023', 'neun']]);
        igual('y el NEUN manda sobre el tipo de asunto', hallados('462:1/2020:' + queja.neun), [['Queja', queja.expediente, 'neun']]);

        // Cada expediente con su tipo de asunto.
        const revision = filas.find(f => f.tipoAsunto === 'Amparo en revisión');
        igual('el tipo de asunto se compara sin acentos, mayúsculas ni signos',
            ['Amparo en revisión', 'AMPARO EN REVISION', ' amparo  en-revisión. ', 'Amp Ind, Proc Fed Penales en 2a Instancia'].map(x => W.sesTipoNormal(x)),
            ['amparo en revision', 'amparo en revision', 'amparo en revision', 'amp ind proc fed penales en 2a instancia']);
        const conTipos = W.sesLeerExpedientes('1535:557/2026~Amparo en revisión,1535:8/2026~*,1535:9/2026:123~queja,1535:557/2026~queja');
        igual('"~tipo" dice el tipo de asunto, "~*" cualquiera, y el NEUN va antes', [...conTipos.porOrganismo.get('1535')], [
            { clave: '557/2026', neun: '', tipo: 'amparo en revision' }, { clave: '8/2026', neun: '', tipo: '*' },
            { clave: '9/2026', neun: '123', tipo: 'queja' }, { clave: '557/2026', neun: '', tipo: 'queja' }
        ]);
        verificar('el mismo número con otro tipo de asunto es otro expediente (y otra consulta)',
            conTipos.total === 4 && W.sesLeerExpedientes('462:1/2026~queja').canon !== W.sesLeerExpedientes('462:1/2026').canon);
        verificar('un tipo vacío es un error, no "cualquiera"', !!W.sesLeerExpedientes('462:1/2026~').error && !!W.sesLeerExpedientes('462:1/2026~ . ').error);
        igual('un amparo en revisión se encuentra como tal', hallados('462:' + revision.expediente + '~Amparo en revisión'),
            [['Amparo en revisión', revision.expediente, 'expediente']]);
        igual('una queja, también', hallados('462:' + queja.expediente + '~QUEJA'), [['Queja', queja.expediente, 'expediente']]);
        igual('pero mi queja no es el amparo directo que lleva su número', hallados('462:677/2023~queja'), []);
        igual('ni mi amparo en revisión, la queja con su número', hallados('462:' + queja.expediente + '~amparo en revision').filter(h => h[0] === 'Queja'), []);
        igual('sin tipo ("~*") coincide por número, y lo dice', hallados('462:677/2023~*'), [['Amparo Directo', '677/2023', 'numero']]);
        igual('con tipo y sin tipo a la vez, gana la coincidencia segura', hallados('462:677/2023~*,462:677/2023'), [['Amparo Directo', '677/2023', 'expediente']]);
    }

    console.log('\nLa consulta a SISE (con un SISE de mentira)');
    {
        const sise = siseFalso();
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023,462:325/2024,462:9999/2020') });
        igual('encuentra los dos asuntos listados, con todos sus datos', r.sesiones, [
            { expediente: '325/2024', tipoAsunto: 'Amparo Directo', organismoId: '462', neun: '35845337', fechaSesion: '2026-11-12', tipoSesion: 'Ordinaria',
              ponente: 'Aarón Alberto Pereira Lizama', secretario: 'Griselda Arely Armendáriz Gutiérrez', resultado: '', sentencia: '',
              autoridad: 'CUARTA SALA UNITARIA DEL TRIBUNAL DE JUSTICIA ADMINISTRATIVA DEL ESTADO DE QUINTANA ROO (AUTORIDAD RESPONSABLE)', coincidencia: 'expediente' },
            { expediente: '677/2023', tipoAsunto: 'Amparo Directo', organismoId: '462', neun: '33638865', fechaSesion: '2026-11-12', tipoSesion: 'Ordinaria',
              ponente: 'Maria Teresa Rodriguez Cardenas', secretario: 'Carlos Hernández García', resultado: '', sentencia: '',
              autoridad: 'Junta Especial Número Cincuenta y Seis de la Federal de Conciliación y Arbitraje de Cancún Quintana Roo (AUTORIDAD RESPONSABLE)', coincidencia: 'expediente' }
        ]);
        igual('sin errores y completo', [r.errores, r.completo], [[], true]);
        igual('primero el calendario del mes', [sise.llamadas[0].esCalendario, sise.llamadas[0].crudo],
            [true, '[{"Item":"AnioSiguiente","Valor":"2026"},{"Item":"MesSiguiente","Valor":"11"},{"Item":"OrganismoId","Valor":"462"},{"Item":"TipoFiltro","Valor":"sesion"}]']);
        verificar('en la ruta del calendario', sise.llamadas[0].url === 'https://www.dgej.cjf.gob.mx/SiseInternet/Controles/ucCalendario.aspx', sise.llamadas[0].url);
        igual('después, solo los días con sesión que caen en el periodo (09, 12 y 13), ordinaria y extraordinaria',
            reportes(sise).map(l => l.cuerpo.Fecha + ' ' + l.cuerpo.TipoSesion).sort(),
            ['09/11/2026 20651', '09/11/2026 20652', '12/11/2026 20651', '12/11/2026 20652', '13/11/2026 20651', '13/11/2026 20652']);
        igual('el cuerpo es el que espera SISE', reportes(sise)[0].crudo,
            '[{"Item":"Fecha","Valor":"09/11/2026"},{"Item":"OrganismoId","Valor":"462"},{"Item":"TipoFiltro","Valor":"sesion"},{"Item":"TipoSesion","Valor":"20651"}]');
        verificar('por POST, a la ruta de la lista', reportes(sise).every(l => l.metodo === 'POST' && l.url === 'https://www.dgej.cjf.gob.mx/SiseInternet/Reportes/ListaSesion/ReporteSesion.aspx'));
        igual('como JSON', reportes(sise)[0].cabeceras['Content-Type'], 'application/json; charset=utf-8');
        verificar('con el User-Agent de un navegador', /^Mozilla\/5\.0 .*Chrome\/\d+/.test(reportes(sise)[0].cabeceras['User-Agent']));
        verificar('cada llamada con su tiempo de espera de 20 segundos', sise.llamadas.every(l => l.senal && typeof l.senal.aborted === 'boolean') && W.SESIONES.timeoutMs === 20000);
        verificar('nunca más de 3 a la vez', sise.maxALaVez <= 3 && sise.maxALaVez >= 2, 'a la vez: ' + sise.maxALaVez);
        verificar('y con una pausa entre una y otra', pausas.length >= 3 && pausas.every(ms => ms >= 250), JSON.stringify(pausas));
        igual('el resumen cuenta lo hecho', r.resumen, { organismos: 1, expedientes: 3, listasConsultadas: 6, listasFallidas: 0, llamadas: 7 });
    }
    {
        const sise = siseFalso();
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023'), filtro: 'lista', desde: '2026-11-02', hasta: '2026-11-06' });
        verificar('el filtro pedido llega a SISE en el calendario y en las listas', sise.llamadas.every(l => l.cuerpo.TipoFiltro === 'lista'));
        igual('y sin coincidencias, lista vacía y completa', [r.sesiones, r.completo], [[], true]);
    }
    {
        const sise = siseFalso();
        await consultar(sise, { porOrganismo: expedientes('462:677/2023,944:15/2025'), desde: '2026-11-23', hasta: '2026-12-04' });
        igual('un periodo entre dos meses pide los dos calendarios de cada tribunal',
            sise.llamadas.filter(l => l.esCalendario).map(l => l.cuerpo.OrganismoId + ' ' + l.cuerpo.AnioSiguiente + '-' + l.cuerpo.MesSiguiente).sort(),
            ['462 2026-11', '462 2026-12', '944 2026-11', '944 2026-12']);
        igual('y si el calendario no marca días en el periodo, no se pide ninguna lista', reportes(sise).length, 0);
    }

    console.log('\nCuando una llamada falla');
    {
        const sise = siseFalso((l) => { if (l.cuerpo.Fecha === '13/11/2026' && l.cuerpo.TipoSesion === '20652') throw new Error('conexión rechazada'); });
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023') });
        igual('lo demás sale igual', r.sesiones.map(s => s.expediente), ['677/2023']);
        igual('y la que falló queda anotada, con su día y su tipo de sesión', r.errores,
            [{ etapa: 'reporte', organismoId: '462', fecha: '2026-11-13', tipoSesion: 'Extraordinaria', mensaje: 'conexión rechazada' }]);
        igual('la respuesta se marca como incompleta', [r.completo, r.resumen.listasFallidas], [false, 1]);
        igual('se intentó dos veces: la llamada y un reintento',
            sise.llamadas.filter(l => l.cuerpo.Fecha === '13/11/2026' && l.cuerpo.TipoSesion === '20652').length, 2);
    }
    {
        const sise = siseFalso((l) => { if (l.cuerpo.Fecha === '12/11/2026' && l.cuerpo.TipoSesion === '20651' && l.veces === 1) throw new Error('se cortó'); });
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023') });
        igual('si el reintento sale bien, no hay error', [r.sesiones.map(s => s.expediente), r.errores, r.completo], [['677/2023'], [], true]);
    }
    {
        const sise = siseFalso((l) => (l.cuerpo.Fecha === '09/11/2026' ? respuesta('Service Unavailable', 503) : undefined));
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023') });
        igual('un error del servidor de SISE se reporta con su código',
            r.errores.map(e => e.fecha + ' ' + e.tipoSesion + ': ' + e.mensaje).sort(),
            ['2026-11-09 Extraordinaria: SISE respondió con error 503', '2026-11-09 Ordinaria: SISE respondió con error 503']);
    }
    {
        const sise = siseFalso((l) => (l.cuerpo.Fecha === '12/11/2026' ? respuesta('<html><body>Página no encontrada</body></html>') : undefined));
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023') });
        verificar('una página que no es la lista (aunque responda 200) es un error, no "sin asuntos"',
            r.completo === false && r.errores.length === 2 && r.errores.every(e => /no es la lista/.test(e.mensaje)), JSON.stringify(r.errores));
    }
    {
        const sise = siseFalso((l) => (l.cuerpo.Fecha === '12/11/2026' && l.cuerpo.TipoSesion === '20651' ? respuesta('', 526) : undefined));
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023') });
        verificar('si Cloudflare no valida el certificado de SISE, el error lo dice', /certificado de SISE \(HTTP 526\)/.test(r.errores[0] && r.errores[0].mensaje), JSON.stringify(r.errores));
    }
    {
        // Una llamada que nunca responde: la corta el tiempo de espera.
        W.SESIONES.timeoutMs = 40;
        const sise = siseFalso((l) => (l.cuerpo.Fecha === '09/11/2026' && l.cuerpo.TipoSesion === '20651'
            ? new Promise((_, no) => l.senal.addEventListener('abort', () => no(new Error('aborted')))) : undefined));
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023') });
        W.SESIONES.timeoutMs = 20000;
        igual('una llamada colgada se corta y se reporta; lo demás sale',
            [r.errores.map(e => e.fecha + ': ' + e.mensaje), r.sesiones.map(s => s.expediente)],
            [['2026-11-09: SISE no respondió en 0.04 segundos'], ['677/2023']]);
    }
    {
        const sise = siseFalso((l) => { if (l.esCalendario) throw new Error('calendario caído'); });
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023') });
        igual('sin calendario se piden todos los días hábiles del periodo',
            [...new Set(reportes(sise).map(l => l.cuerpo.Fecha))].length, 10);
        igual('cada uno, ordinaria y extraordinaria', reportes(sise).length, 20);
        igual('el asunto aparece igual, y la respuesta está completa', [r.sesiones.map(s => s.expediente), r.completo], [['677/2023'], true]);
        igual('el tropiezo del calendario queda anotado', r.errores,
            [{ etapa: 'calendario', organismoId: '462', mes: '2026-11', mensaje: 'calendario caído', nota: 'Se consultaron todos los días hábiles del mes' }]);
    }
    {
        // Calendario caído y tres tribunales en una sola consulta: harían
        // falta 66 llamadas, más de las permitidas.
        const sise = siseFalso((l) => { if (l.esCalendario) throw new Error('calendario caído'); });
        const r = await consultar(sise, { porOrganismo: expedientes('462:677/2023,944:15/2025,1319:88/2026') });
        verificar('nunca se hacen más llamadas a SISE que las permitidas por consulta', sise.llamadas.length === W.SESIONES.maxLlamadas, 'llamadas: ' + sise.llamadas.length);
        verificar('las que no se hicieron se reportan como tales',
            r.completo === false && r.errores.some(e => e.etapa === 'reporte' && /máximo de llamadas/.test(e.mensaje)));
        verificar('y se dejan para el final los días más lejanos',
            r.errores.filter(e => e.etapa === 'reporte').every(e => e.fecha >= '2026-11-17'), JSON.stringify(r.errores.map(e => e.fecha)));
        verificar('el máximo deja margen bajo las 50 subpeticiones del plan gratuito (el KV también cuenta)', W.SESIONES.maxLlamadas + 2 < 50);
    }

    console.log('\nEl endpoint GET /api/sesiones');
    {
        W.sesMemoria.clear();
        const sise = siseFalso();
        const r = await pedir(sise, 'exp=462:677/2023');
        igual('sin fechas: del lunes de esta semana al viernes de la siguiente', [r.status, r.datos.desde, r.datos.hasta, r.datos.filtro], [200, '2026-11-09', '2026-11-20', 'sesion']);
        igual('la respuesta trae sesiones, errores y resumen',
            Object.keys(r.datos), ['version', 'desde', 'hasta', 'filtro', 'generado', 'cache', 'completo', 'sesiones', 'errores', 'resumen']);
        igual('y la versión, para que la app sepa que este proxy entiende tipos de asunto', r.datos.version, 2);
        igual('cada sesión, con los campos acordados', Object.keys(r.datos.sesiones[0]),
            ['expediente', 'tipoAsunto', 'organismoId', 'neun', 'fechaSesion', 'tipoSesion', 'ponente', 'secretario', 'resultado', 'sentencia', 'autoridad', 'coincidencia']);
        igual('y dice cuándo se generó', r.datos.generado, '2026-11-10T18:00:00.000Z');

        const error = async (consulta) => { const x = await pedir(siseFalso(), consulta); return [x.status, x.datos.error ? 'error' : 'ok']; };
        igual('sin expedientes: 400', await error('desde=2026-11-09&hasta=2026-11-20'), [400, 'error']);
        igual('fecha mal escrita: 400', await error('desde=09/11/2026&hasta=2026-11-20&exp=462:1/2026'), [400, 'error']);
        igual('solo "desde": 400', await error('desde=2026-11-09&exp=462:1/2026'), [400, 'error']);
        igual('"hasta" anterior a "desde": 400', await error('desde=2026-11-20&hasta=2026-11-09&exp=462:1/2026'), [400, 'error']);
        igual('filtro desconocido: 400', await error('filtro=otro&exp=462:1/2026'), [400, 'error']);
        igual('4 semanas, de lunes a viernes: sí', await error('desde=2026-11-09&hasta=2026-12-04&exp=462:1/2026'), [200, 'ok']);
        igual('28 días justos: sí', await error('desde=2026-11-09&hasta=2026-12-06&exp=462:1/2026'), [200, 'ok']);
        igual('29 días: 400', await error('desde=2026-11-09&hasta=2026-12-07&exp=462:1/2026'), [400, 'error']);
        const ninguna = siseFalso();
        await pedir(ninguna, 'desde=2026-11-09&hasta=2026-12-07&exp=462:1/2026');
        igual('una consulta rechazada no llama a SISE', ninguna.llamadas.length, 0);
        const revisiones = siseFalso();
        const unaRevision = W.sesParsearReporte(SESION).find(f => f.tipoAsunto === 'Amparo en revisión').expediente;
        const rr = await pedir(revisiones, 'desde=2026-11-09&hasta=2026-11-20&exp=' + encodeURIComponent('462:' + unaRevision + '~amparo en revision,462:677/2023~queja,462:325/2024'));
        igual('de punta a punta: cada asunto con su tipo, y nada de otro tipo con el mismo número',
            rr.datos.sesiones.map(s => [s.tipoAsunto, s.expediente, s.coincidencia]).sort(),
            [['Amparo Directo', '325/2024', 'expediente'], ['Amparo en revisión', unaRevision, 'expediente']]);
        const conFiltro = siseFalso();
        const rf = await pedir(conFiltro, 'filtro=LISTA&exp=462:677/2023');
        igual('el filtro se puede elegir en la consulta', [rf.datos.filtro, conFiltro.llamadas.every(l => l.cuerpo.TipoFiltro === 'lista')], ['lista', true]);
    }

    console.log('\nEl resultado se recuerda 6 horas');
    {
        W.sesMemoria.clear();
        const guardado = new Map();
        const opciones = [];
        const env = { CUOTAS: { get: async (k) => (guardado.has(k) ? guardado.get(k) : null), put: async (k, v, o) => { guardado.set(k, v); opciones.push(o); } } };
        const consulta = 'desde=2026-11-09&hasta=2026-11-20&exp=462:677/2023,462:325/2024';

        const s1 = siseFalso();
        const r1 = await pedir(s1, consulta, env);
        igual('la primera vez se consulta a SISE', [r1.datos.cache, s1.llamadas.length > 0], [false, true]);
        igual('y se guarda en el KV del proyecto, con caducidad de 6 horas',
            [guardado.size, [...guardado.keys()][0].slice(0, 6), opciones[0]], [1, 'ses:2:', { expirationTtl: 21600 }]);

        const s2 = siseFalso();
        const r2 = await pedir(s2, consulta, env);
        igual('la segunda sale de la memoria, sin llamar a SISE', [r2.datos.cache, s2.llamadas.length, r2.datos.sesiones.length], [true, 0, 2]);

        const s3 = siseFalso();
        const r3 = await pedir(s3, 'exp=462:325/2024,462:677/2023&hasta=2026-11-20&desde=2026-11-09', env);
        igual('los mismos expedientes en otro orden son la misma consulta', [r3.datos.cache, s3.llamadas.length], [true, 0]);

        W.sesMemoria.clear();
        const s4 = siseFalso();
        const r4 = await pedir(s4, consulta, env);
        igual('aunque el worker se reinicie, el KV la conserva', [r4.datos.cache, s4.llamadas.length], [true, 0]);

        const s5 = siseFalso();
        const r5 = await pedir(s5, consulta + '&refresh=1', env);
        igual('con ?refresh=1 se vuelve a consultar', [r5.datos.cache, s5.llamadas.length > 0], [false, true]);

        const s6 = siseFalso();
        const r6 = await pedir(s6, consulta + ',462:456/2025', env);
        igual('otra lista de expedientes es otra consulta', [r6.datos.cache, s6.llamadas.length > 0, r6.datos.sesiones.length], [false, true, 3]);
        const s7 = siseFalso();
        const r7 = await pedir(s7, 'desde=2026-11-09&hasta=2026-11-13&exp=462:677/2023,462:325/2024', env);
        igual('y otro periodo, también', [r7.datos.cache, s7.llamadas.length > 0], [false, true]);
    }
    {
        W.sesMemoria.clear();
        const consulta = 'desde=2026-11-09&hasta=2026-11-20&exp=462:677/2023';
        const s1 = siseFalso();
        await pedir(s1, consulta);
        const s2 = siseFalso();
        const r2 = await pedir(s2, consulta);
        igual('sin KV, se recuerda en memoria', [r2.datos.cache, s2.llamadas.length], [true, 0]);
        const s3 = siseFalso();
        const r3 = await pedir(s3, consulta, {}, '2026-11-11T00:00:01Z');
        igual('pasadas las 6 horas se vuelve a consultar', [r3.datos.cache, s3.llamadas.length > 0], [false, true]);
    }
    {
        W.sesMemoria.clear();
        const consulta = 'desde=2026-11-09&hasta=2026-11-20&exp=462:677/2023';
        const caida = siseFalso((l) => { if (l.cuerpo.Fecha === '13/11/2026') throw new Error('caída'); });
        const r1 = await pedir(caida, consulta);
        const despues = siseFalso();
        const r2 = await pedir(despues, consulta);
        igual('una respuesta incompleta no se recuerda: la siguiente vuelve a intentarlo',
            [r1.datos.completo, r1.datos.errores.length > 0, r2.datos.cache, r2.datos.completo], [false, true, false, true]);
    }

    console.log('\nUn mismo visitante no puede bombardear a SISE');
    {
        W.sesMemoria.clear();
        W.sesVisitas.clear();
        const tope = W.SESIONES.topeConsultas;
        const de = (ip, exp, ahora) => { const s = siseFalso(); s.ip = ip; return pedir(s, 'desde=2026-11-09&hasta=2026-11-20&exp=462:' + exp, {}, ahora).then(r => [r.status, s.llamadas.length > 0]); };
        const primeras = [];
        for (let i = 1; i <= tope; i++) primeras.push((await de('1.1.1.1', i + '/2026'))[0]);
        verificar('las primeras ' + tope + ' consultas nuevas pasan', primeras.every(s => s === 200), JSON.stringify(primeras));
        igual('la siguiente se rechaza con 429, sin llamar a SISE', await de('1.1.1.1', '9999/2026'), [429, false]);
        igual('lo ya recordado se sigue sirviendo', await de('1.1.1.1', '1/2026'), [200, false]);
        igual('otro visitante no paga por el primero', await de('2.2.2.2', '9999/2026'), [200, true]);
        igual('y pasados 10 minutos vuelve a poder', await de('1.1.1.1', '9998/2026', '2026-11-10T18:10:01Z'), [200, true]);
        verificar('el tope da para abrir la app con varios tribunales y cambiar de periodo', tope >= 24);
        verificar('el worker identifica al visitante por su IP', /ip: request\.headers\.get\('CF-Connecting-IP'\)/.test(WORKER));
        W.sesVisitas.clear();
    }

    console.log('\nLa ruta en el worker');
    {
        verificar('/api/sesiones está en el enrutador', /path === '\/api\/sesiones'/.test(WORKER) && /await atenderSesiones\(url, env,/.test(WORKER));
        verificar('solo acepta GET', /path === '\/api\/sesiones'\) \{\s*if \(request\.method !== 'GET'\)/.test(WORKER));
        verificar('no pide pase de cuota (no es una búsqueda del IMPI)', !/RUTAS_CON_PASE = \[[^\]]*sesiones/.test(WORKER));
        verificar('en el worker no hay ids de tribunales escritos: los manda la app', !/\b(462|944|1319|4372)\b/.test(seccion.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    }

    console.log('\nEn la app: qué expedientes se revisan');
    {
        const TCC1 = 'Primer Tribunal Colegiado del Vigésimo Séptimo Circuito';
        const TCC3 = 'Tercer Tribunal Colegiado del Vigésimo Séptimo Circuito, con residencia en Cancún, Quintana Roo';
        const TCA20 = 'Tribunal Colegiado en Materia Administrativa del Vigésimo Circuito, con residencia en Tuxtla Gutiérrez, Chiapas';
        const APELACION = 'Tribunal Colegiado de Apelación del Vigésimo Séptimo Circuito, con residencia en Cancún, Quintana Roo';
        // El catálogo del PJF, lo que la app lee de él: tipo de cada órgano
        // (4 = Tribunal Colegiado de Circuito) y nombre de cada tipo de asunto.
        const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs', 'data', 'pjf_catalogos_completos.json'), 'utf8'));
        const catalogo = { organos: new Map(), tipos: new Map() };
        real.organos.forEach(o => catalogo.organos.set(String(o.id), { tipoOrganismoId: o.tipoOrganismoId, nombre: o.nombre }));
        real.tiposOrgano.filter(x => x.TipoOrganismoId === App.CONFIG.tipoOrganismoId).forEach(x => x.tiposAsunto.forEach(a => catalogo.tipos.set(String(a.id), a.nombre)));
        igual('el catálogo conoce los órganos de las pruebas y sus tipos de asunto',
            [['462', '1319', '1535', '4372'].map(id => catalogo.organos.get(id).tipoOrganismoId), ['10', '11', '15'].map(id => catalogo.tipos.get(id))],
            [[4, 4, 4, 340], ['Amparo Directo', 'Amparo en revisión', 'Queja']]);

        const juzgadoDistrito = real.organos.find(o => o.tipoOrganismoId === 2 && /Juzgado .* de Distrito .*Quintana Roo/.test(o.nombre));
        const lista = [
            { id: 1, institucion: 'PJF', numero: '677/2023', juzgado: TCC1, pjfOrgId: '462', pjfTipoAsunto: '10' },
            { id: 2, institucion: 'PJF', numero: 'AD 0325/2024', juzgado: TCC1, pjfOrgId: 462, pjfTipoAsunto: 10, neun: '35845337' },
            { id: 3, institucion: 'PJF', numero: '88/2026', juzgado: TCC3, pjfOrgId: '1319', pjfTipoAsunto: 'Amparo Directo' },
            { id: 4, institucion: 'PJF', numero: '90/2026', juzgado: TCC3, pjfOrgId: '1319', pjfTipoAsunto: 'queja' },
            { id: 5, institucion: 'PJF', numero: '50/2026', juzgado: juzgadoDistrito.nombre, pjfOrgId: String(juzgadoDistrito.id), pjfTipoAsunto: 'Amparo Indirecto' },
            { id: 6, institucion: 'TSJ', numero: '677/2023', juzgado: 'JUZGADO PRIMERO CIVIL CANCUN' },
            { id: 7, institucion: 'PJF', numero: '12/2026', juzgado: APELACION, pjfOrgId: '4372', pjfTipoAsunto: '10' },
            { id: 8, institucion: 'PJF', numero: '13/2026', juzgado: 'PJF - Por determinar', pjfTipoAsunto: '10' },
            { id: 9, institucion: 'PJF', numero: '14/2026', juzgado: TCC1, pjfOrgId: '462' },
            { id: 10, institucion: 'PJF', nombre: 'Juan Pérez', juzgado: TCC1, pjfOrgId: '462', pjfTipoAsunto: '10' },
            { id: 11, institucion: 'PJF', numero: '15/2026', juzgado: TCC1, pjfOrgId: '462', pjfTipoAsunto: '10', archivado: true },
            // El asunto que no aparecía: un amparo en revisión en un colegiado de Chiapas.
            { id: 12, institucion: 'PJF', numero: '557/2026', juzgado: TCA20, pjfOrgId: '1535', pjfTipoAsunto: '11' },
            { id: 13, institucion: 'PJF', numero: '16/2026', juzgado: TCC3, pjfOrgId: '1319', pjfTipoAsunto: 'Revisión incidental' },
            { id: 14, institucion: 'PJF', numero: '17/2026', juzgado: 'Tribunal Colegiado del Vigésimo Séptimo Circuito' }
        ];
        verificar('(la prueba incluye un juzgado de distrito del catálogo)', !!juzgadoDistrito && catalogo.organos.get(String(juzgadoDistrito.id)).tipoOrganismoId === 2);
        const s = App.seleccionarAsuntos(lista, catalogo);
        igual('todos los asuntos de tribunales colegiados de circuito, por tribunal y con su tipo de asunto', s.grupos, [
            { organismoId: '462', tribunal: TCC1, expedientes: [
                { id: 1, clave: '677/2023', numero: '677/2023', neun: '', tipo: 'Amparo Directo' },
                { id: 2, clave: '325/2024', numero: 'AD 0325/2024', neun: '35845337', tipo: 'Amparo Directo' },
                { id: 9, clave: '14/2026', numero: '14/2026', neun: '', tipo: '' }] },
            { organismoId: '1319', tribunal: TCC3, expedientes: [
                { id: 3, clave: '88/2026', numero: '88/2026', neun: '', tipo: 'Amparo Directo' },
                { id: 4, clave: '90/2026', numero: '90/2026', neun: '', tipo: 'Queja' },
                { id: 13, clave: '16/2026', numero: '16/2026', neun: '', tipo: '' }] },
            { organismoId: '1535', tribunal: TCA20, expedientes: [
                { id: 12, clave: '557/2026', numero: '557/2026', neun: '', tipo: 'Amparo en revisión' }] }
        ]);
        igual('fuera: el TSJ, los juzgados, el Colegiado de Apelación, los archivados y los que no tienen número', s.total, 7);
        igual('los de un colegiado sin órgano del catálogo se cuentan aparte (el amparo directo "por determinar" y el colegiado escrito a mano)', s.sinTribunal, 2);
        igual('sin expedientes, nada que revisar', App.seleccionarAsuntos([], catalogo), { grupos: [], total: 0, sinTribunal: 0 });

        const porNombre = App.seleccionarAsuntos([
            { id: 30, institucion: 'PJF', numero: '557/2026', juzgado: TCA20.toUpperCase(), pjfTipoAsunto: '11' },
            { id: 31, institucion: 'PJF', numero: '9/2026', juzgado: APELACION }
        ], catalogo);
        igual('un expediente con el nombre exacto del órgano pero sin su id se resuelve por el catálogo (y el de Apelación sigue fuera)',
            [porNombre.grupos.map(g => [g.organismoId, g.expedientes.map(e => e.id)]), porNombre.sinTribunal], [[['1535', [30]]], 0]);

        const sinCatalogo = App.seleccionarAsuntos(lista);
        igual('si el catálogo no carga, el órgano se reconoce por su nombre y lo que no se sabe se busca por número',
            sinCatalogo.grupos.map(g => [g.organismoId, g.expedientes.map(e => e.id + ':' + (e.tipo || '*'))]),
            [['462', ['1:Amparo Directo', '2:Amparo Directo', '9:*']], ['1319', ['3:Amparo Directo', '4:*', '13:*']], ['1535', ['12:*']]]);
        igual('y el Colegiado de Apelación sigue fuera', sinCatalogo.grupos.some(g => g.organismoId === '4372'), false);

        const rango = { desde: '2026-11-09', hasta: '2026-11-20' };
        const exp = (grupo) => new URL(App.urlConsulta('https://proxy.test/', grupo, rango, 'sesion', false)).searchParams.get('exp');
        igual('la consulta de un tribunal: organismo, número/año, NEUN si lo hay y el tipo si no es amparo directo',
            App.urlConsulta('https://proxy.test/', s.grupos[0], rango, 'sesion', false),
            'https://proxy.test/api/sesiones?desde=2026-11-09&hasta=2026-11-20&filtro=sesion&exp=' + encodeURIComponent('462:677/2023,462:325/2024:35845337,462:14/2026~*'));
        igual('el asunto de Chiapas va como amparo en revisión', exp(s.grupos[2]), '1535:557/2026~amparo en revision');
        igual('una queja, como queja; el de tipo desconocido, por número', exp(s.grupos[1]), '1319:88/2026,1319:90/2026~queja,1319:16/2026~*');
        verificar('con refresh=1 al actualizar a mano', /&refresh=1$/.test(App.urlConsulta('https://proxy.test', s.grupos[1], rango, 'sesion', true)));
        igual('y el proxy la entiende', [...W.sesLeerExpedientes(exp(s.grupos[1])).porOrganismo.get('1319')],
            [{ clave: '88/2026', neun: '', tipo: 'amparo directo' }, { clave: '90/2026', neun: '', tipo: 'queja' }, { clave: '16/2026', neun: '', tipo: '*' }]);
        const nombresRaros = [...catalogo.tipos.values()].filter(n => /[,:~]/.test(App.tipoNormal(n)) || W.sesTipoNormal(n) !== App.tipoNormal(n));
        igual('la app y el proxy normalizan igual todos los tipos de asunto del catálogo', nombresRaros, []);
        igual('solo los grupos con otros tipos de asunto necesitan el proxy nuevo',
            [App.pideOtrosTipos({ expedientes: s.grupos[0].expedientes.slice(0, 2) }), App.pideOtrosTipos(s.grupos[0]), App.pideOtrosTipos(s.grupos[2])], [false, true, true]);

        const completas = App.completar([
            { expediente: '677/2023', tipoAsunto: 'Amparo Directo', neun: '33638865', fechaSesion: '2026-11-12' },
            { expediente: '999/2024', tipoAsunto: 'Amparo Directo', neun: '35845337', fechaSesion: '2026-11-12' }
        ], s.grupos[0]);
        igual('a cada sesión se le pone su tribunal y su expediente (por NEUN antes que por número)',
            completas.map(c => [c.tribunal, c.expedienteId]), [[TCC1, 1], [TCC1, 2]]);
        const gemelos = { organismoId: '1535', tribunal: TCA20, expedientes: [
            { id: 20, clave: '557/2026', numero: '557/2026', neun: '', tipo: 'Queja' },
            { id: 21, clave: '557/2026', numero: '557/2026', neun: '', tipo: 'Amparo en revisión' },
            { id: 22, clave: '8/2026', numero: '8/2026', neun: '', tipo: '' }] };
        igual('con el mismo número en dos tipos de asunto, cada sesión va a su expediente',
            App.completar([{ expediente: '557/2026', tipoAsunto: 'Amparo en revisión' }, { expediente: '557/2026', tipoAsunto: 'Queja' }, { expediente: '8/2026', tipoAsunto: 'Queja', coincidencia: 'numero' }], gemelos)
                .map(c => c.expedienteId), [21, 20, 22]);
        igual('la consulta se identifica por periodo, expedientes y tipo de asunto, en cualquier orden',
            App.claveConsulta(s.grupos, rango, 'sesion') === App.claveConsulta(s.grupos.slice().reverse(), rango, 'sesion') &&
            App.claveConsulta(s.grupos, rango, 'sesion') !== App.claveConsulta(s.grupos, { desde: '2026-11-09', hasta: '2026-11-13' }, 'sesion') &&
            App.claveConsulta(s.grupos, rango, 'sesion') !== App.claveConsulta(s.grupos.slice(0, 1), rango, 'sesion') &&
            App.claveConsulta([gemelos], rango, 'sesion') !== App.claveConsulta([{ organismoId: '1535', expedientes: gemelos.expedientes.map(e => Object.assign({}, e, { tipo: '' })) }], rango, 'sesion'), true);
        igual('las fechas se leen de corrido', [App.fechaLarga('2026-11-12', '2026-11-10'), App.fechaLarga('2026-11-10', '2026-11-10'), App.fechaLarga('2026-11-11', '2026-11-10')],
            ['Jueves 12 de noviembre', 'Hoy, martes 10 de noviembre', 'Mañana, miércoles 11 de noviembre']);
        igual('y el periodo', [App.periodoTexto(rango), App.periodoTexto({ desde: '2026-11-30', hasta: '2026-12-11' })],
            ['del 9 al 20 de noviembre', 'del 30 de noviembre al 11 de diciembre']);
        igual('el filtro por defecto es por fecha de sesión; el tipo por defecto, el mismo en la app y en el proxy',
            [App.CONFIG.filtro, W.SESIONES.filtroPorDefecto, App.CONFIG.tipoPorDefecto, W.SESIONES.tipoAsunto, catalogo.tipos.get(App.CONFIG.tipoPorDefectoId)],
            ['sesion', 'sesion', 'Amparo Directo', 'Amparo Directo', 'Amparo Directo']);
    }

    console.log('\nEn la app: la tarjeta de Inicio');
    {
        const html = fs.readFileSync(path.join(__dirname, 'docs', 'index.html'), 'utf8');
        const app = fs.readFileSync(path.join(__dirname, 'docs', 'js', 'app.js'), 'utf8');
        const modulo = fs.readFileSync(path.join(__dirname, 'docs', 'js', 'sesiones-pjf.js'), 'utf8');
        verificar('index.html carga el módulo', /<script src="js\/sesiones-pjf\.js"><\/script>/.test(html));
        verificar('la tarjeta está en Inicio, oculta hasta saber si hay asuntos en tribunales colegiados',
            /<section class="page active" id="page-inicio">[\s\S]*id="sesiones-pjf"[^>]*hidden[\s\S]*<section class="page" id="page-expedientes">/.test(html));
        igual('con su selector de 1 a 4 semanas',
            [...(/<select id="sesiones-pjf-semanas"[\s\S]*?<\/select>/.exec(html) || [''])[0].matchAll(/<option value="(\d)"/g)].map(m => m[1]), ['1', '2', '3', '4']);
        verificar('y su botón para volver a consultar', /id="sesiones-pjf-actualizar"/.test(html));
        verificar('la app la arranca sola al abrir, sin esperarla',
            /async function inicializarApp\(\) \{[\s\S]*?\n    if \(typeof SESIONES_PJF !== 'undefined'\) SESIONES_PJF\.iniciar\(\);\n\}/.test(app));
        verificar('sin coincidencias dice "Sin asuntos listados en el periodo"', modulo.includes('Sin asuntos listados en el periodo'));
        verificar('un proxy anterior (sin "version") no se da por bueno para otros tipos de asunto',
            /pideOtrosTipos\(grupo\) && !\(datos\.version >= CONFIG\.versionProxy\)/.test(modulo) && App.CONFIG.versionProxy === 2);
        verificar('el catálogo del PJF solo se carga si hay expedientes federales', /if \(!expedientes\.some\(e => e && e\.institucion === 'PJF'\)\) return catalogo;/.test(modulo));
        verificar('la consulta va al proxy, nunca directo a SISE desde el navegador', !/dgej\.cjf\.gob\.mx/.test(modulo.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    }

    if (process.env.SISE_EN_VIVO) {
        console.log('\nEn vivo contra SISE (órgano 462)');
        const vivo = { fetch: (u, o) => fetch(u, o), esperar: (ms) => new Promise(ok => setTimeout(ok, ms)), cuenta: { hechas: 0 } };
        const pedirLista = async (fecha, filtro, tipo) => W.sesParsearReporte(await W.sesPedir(W.SESIONES.reporte,
            [['Fecha', fecha], ['OrganismoId', '462'], ['TipoFiltro', filtro], ['TipoSesion', tipo]], vivo));
        try {
            const lista = await pedirLista('04/11/2026', 'lista', '20651');
            console.log('    lista del 04/11/2026: ' + lista.length + ' asuntos; amparos directos: ' +
                lista.filter(f => f.tipoAsunto === 'Amparo Directo').map(f => f.expediente).join(', '));
            verificar('la lista del 04/11/2026 (filtro "lista") trae asuntos', lista.length > 0);
            verificar('entre ellos, "Amparo Directo 677/2023"', lista.some(f => f.tipoAsunto === 'Amparo Directo' && f.expediente === '677/2023'));

            await vivo.esperar(500);
            const sesion = await pedirLista('12/11/2026', 'sesion', '20651');
            console.log('    sesión del 12/11/2026: ' + sesion.length + ' asuntos');
            verificar('con el filtro "sesion", el mismo asunto sale el día de su sesión (12/11/2026)',
                sesion.some(f => f.tipoAsunto === 'Amparo Directo' && f.expediente === '677/2023' && f.fechaSesion === '2026-11-12'));
            const soloEnLista = lista.filter(f => f.fechaSesion === '2026-11-12' && !sesion.some(x => x.neun === f.neun));
            igual('"sesion" y "lista" dan los mismos asuntos para la sesión del 12', soloEnLista.map(f => f.expediente), []);

            await vivo.esperar(500);
            const dias = W.sesParsearCalendario(await W.sesPedir(W.SESIONES.calendario,
                [['AnioSiguiente', 2026], ['MesSiguiente', 11], ['OrganismoId', '462'], ['TipoFiltro', 'sesion']], vivo), 2026, 11);
            console.log('    calendario de noviembre de 2026: ' + dias.join(', '));
            verificar('el calendario de noviembre de 2026 marca el día 12', dias.includes('2026-11-12'));

            await vivo.esperar(500);
            const r = await W.atenderSesiones(new URL('https://proxy.test/api/sesiones?desde=2026-11-09&hasta=2026-11-20&refresh=1&exp=462:677/2023,462:1/1999'),
                {}, { fetch: vivo.fetch, esperar: vivo.esperar, ahora: () => Date.now() });
            console.log('    endpoint: ' + JSON.stringify(r.datos.resumen) + ' errores: ' + JSON.stringify(r.datos.errores));
            igual('el endpoint completo encuentra el 677/2023 en la sesión ordinaria del 12/11/2026',
                r.datos.sesiones.map(s => [s.expediente, s.fechaSesion, s.tipoSesion, s.neun]), [['677/2023', '2026-11-12', 'Ordinaria', '33638865']]);
            igual('sin errores', [r.datos.errores, r.datos.completo], [[], true]);
        } catch (e) {
            verificar('SISE respondió', false, (e && e.message) + (e && e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''));
        }
    }

    console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
    if (fallos.length) {
        console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
        process.exit(1);
    }
})();
