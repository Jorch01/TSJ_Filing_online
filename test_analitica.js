/**
 * Estadísticas de uso: que nunca salga información de los expedientes.
 *
 * - Sin ID configurado no se carga nada ni se envía nada.
 * - Con ID, solo pasan los parámetros de la lista blanca, con valores
 *   genéricos: un número de expediente, un nombre o un texto libre se caen.
 * - Desactivarlas desde Configuración las apaga.
 * - Ninguna llamada a medir() en el código usa un parámetro fuera de la lista.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JS = path.join(__dirname, 'docs', 'js');
const fuente = fs.readFileSync(path.join(JS, 'analitica.js'), 'utf8');

let pasadas = 0, fallidas = 0;
const fallos = [];
function verificar(desc, cond, detalle) {
    if (cond) { pasadas++; return; }
    fallidas++;
    fallos.push(desc + (detalle ? `\n      ${detalle}` : ''));
}

// El caso "sin ID" se prueba con la constante vaciada en una copia.
const fuenteSinId = fuente.replace(/const GA_ID = '[^']*';/, "const GA_ID = '';");

function entorno({ id, host = 'tsjia.empirica.mx', desactivada = false, codigo = fuenteSinId } = {}) {
    const almacen = desactivada ? { analitica_desactivada: '1' } : {};
    const scripts = [];
    const w = {
        location: { hostname: host, protocol: 'https:', pathname: '/docs/' },
        localStorage: {
            getItem: k => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); },
            removeItem: k => { delete almacen[k]; }
        },
        document: {
            getElementById: () => null,
            head: { appendChild: s => scripts.push(s.src) },
            createElement: () => ({}),
            addEventListener: () => {}
        },
        addEventListener: () => {},
        setTimeout, clearTimeout, Promise, Date, Object, RegExp, String, Set
    };
    w.window = w;
    if (id) w.TSJ_GA_ID = id;
    vm.createContext(w);
    vm.runInContext(codigo, w);
    return { w, scripts, almacen };
}

// Sin ID: nada.
{
    const { w, scripts } = entorno();
    w.medir('seccion_vista', { seccion: 'calendario' });
    verificar('sin ID: no carga el script de Google', scripts.length === 0);
    verificar('sin ID: no envía eventos', !w.dataLayer);
}

// Con ID: solo lo permitido.
{
    const { w, scripts } = entorno({ id: 'G-PRUEBA' });
    w.medir('seccion_vista', { seccion: 'calendario' });
    verificar('con ID: carga gtag una sola vez', scripts.length === 1 && /googletagmanager\.com\/gtag\/js\?id=G-PRUEBA/.test(scripts[0]));
    const eventos = () => w.dataLayer.filter(a => a[0] === 'event').map(a => [a[1], a[2]]);
    verificar('con ID: envía el evento', JSON.stringify(eventos()) === JSON.stringify([['seccion_vista', { seccion: 'calendario' }]]));
    const config = w.dataLayer.find(a => a[0] === 'config');
    verificar('con ID: sin señales publicitarias', config && config[2].allow_google_signals === false && config[2].allow_ad_personalization_signals === false);

    w.medir('expediente_creado', { numero: '1234/2026', juzgado: 'JUZGADO PRIMERO CIVIL', nombre: 'Juan Pérez', cantidad: 1 });
    verificar('privacidad: número, juzgado y nombre no salen; la cantidad sí',
        JSON.stringify(eventos()[1]) === JSON.stringify(['expediente_creado', { cantidad: 1 }]), JSON.stringify(eventos()[1]));
    w.medir('calculo_laboral', { supuesto: 'Juan Pérez 1234/2026' });
    verificar('privacidad: un valor con datos se cae aunque la clave sea válida',
        JSON.stringify(eventos()[2][1]) === '{}', JSON.stringify(eventos()[2]));
    w.medir('seccion_vista', { seccion: 'calendario', texto: 'Audiencia del expediente 45/2025' });
    verificar('privacidad: textos libres no salen', !JSON.stringify(eventos()[3]).includes('45/2025'));
    w.medir('Evento Raro!', {});
    verificar('nombres de evento raros se ignoran', eventos().length === 4);

    w.desactivarAnalitica(true);
    w.medir('seccion_vista', { seccion: 'notas' });
    verificar('desactivar: deja de enviar', eventos().length === 4);
    verificar('desactivar: y apaga el script ya cargado', w['ga-disable-G-PRUEBA'] === true);
}

// El ID real está puesto, y en la computadora de pruebas (localhost) no mide.
verificar('el ID de GA4 está configurado', /const GA_ID = 'G-[A-Z0-9]{6,}';/.test(fuente));
{
    const real = entorno({ codigo: fuente });
    real.w.medir('seccion_vista', { seccion: 'notas' });
    verificar('con el ID real, en el sitio publicado sí mide', real.scripts.length === 1);
    const local = entorno({ codigo: fuente, host: 'localhost' });
    local.w.medir('seccion_vista', { seccion: 'notas' });
    verificar('con el ID real, en localhost no mide', local.scripts.length === 0 && !local.w.dataLayer);
}

// Desactivada desde antes, en pruebas locales o en file://.
{
    const d = entorno({ id: 'G-PRUEBA', desactivada: true });
    d.w.medir('seccion_vista', { seccion: 'notas' });
    verificar('desactivada por el usuario: ni carga ni envía', d.scripts.length === 0 && !d.w.dataLayer);
}

// Todas las llamadas a medir() del código usan claves de la lista blanca.
const permitidas = Object.keys(eval('(' + /const PERMITIDOS = (\{[\s\S]*?\});/.exec(fuente)[1] + ')'));
for (const f of fs.readdirSync(JS)) {
    const js = fs.readFileSync(path.join(JS, f), 'utf8');
    for (const m of js.matchAll(/medir\('([a-z_]+)'(?:,\s*\{([^}]*)\})?/g)) {
        const claves = [...(m[2] || '').matchAll(/([a-zA-Z_]+)\s*:/g)].map(x => x[1]);
        const ajenas = claves.filter(c => !permitidas.includes(c));
        verificar(`${f}: medir('${m[1]}') solo usa parámetros permitidos`, ajenas.length === 0, ajenas.join(', '));
    }
}

console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
if (fallidas) {
    console.log('  Fallos:');
    fallos.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
}
console.log('  ✓ Las estadísticas cuentan acciones, nunca datos de expedientes.');
