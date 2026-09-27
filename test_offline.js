/**
 * Sin conexión: todo lo que la app carga de su propio servidor tiene que
 * estar en la lista del service worker. Si alguien agrega un script a
 * index.html y no a sw.js, la app abriría sin internet… y sin ese script.
 */
const fs = require('fs');
const path = require('path');
const DOCS = path.join(__dirname, 'docs');

let pasadas = 0, fallidas = 0;
const fallos = [];
function verificar(desc, cond, detalle) {
    if (cond) { pasadas++; return; }
    fallidas++;
    fallos.push(desc + (detalle ? `\n      ${detalle}` : ''));
}

const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
const lista = /const ARCHIVOS_APP = \[([\s\S]*?)\];/.exec(sw);
verificar('sw.js declara la lista de archivos de la app', !!lista);
const enCache = new Set((lista ? lista[1] : '').match(/'([^']+)'/g).map(s => s.slice(1, -1)));

const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
const locales = [
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/<link[^>]+rel="(?:stylesheet|manifest)"[^>]*href="([^"]+)"/g)].map(m => m[1])
].filter(u => !/^(https?:|data:|\/\/)/.test(u));

verificar('index.html carga archivos propios', locales.length > 5, JSON.stringify(locales));
for (const u of locales) {
    verificar(`sin conexión: "${u}" está en la caché del service worker`, enCache.has(u));
}
for (const u of enCache) {
    if (u === './') continue;
    verificar(`la caché no pide un archivo que no existe: "${u}"`, fs.existsSync(path.join(DOCS, u)));
}

// Los datos que el código pide con fetch() relativo también.
for (const f of fs.readdirSync(path.join(DOCS, 'js'))) {
    const js = fs.readFileSync(path.join(DOCS, 'js', f), 'utf8');
    for (const m of js.matchAll(/fetch\(\s*['"`]((?:data|js|css)\/[^'"`]+)['"`]/g)) {
        verificar(`sin conexión: ${f} pide "${m[1]}" y está en la caché`, enCache.has(m[1]));
    }
}

const cdn = /const CDN_ESENCIALES = \[([\s\S]*?)\];/.exec(sw);
const enCdn = (cdn ? cdn[1] : '').match(/'([^']+)'/g)?.map(s => s.slice(1, -1)) || [];
verificar('DOMPurify (lo usa la app para pintar) se guarda para abrir sin internet',
    enCdn.some(u => /dompurify/.test(u)) && html.includes(enCdn.find(u => /dompurify/.test(u))));

verificar('la app registra el service worker', /serviceWorker\.register\('sw\.js'\)/.test(
    fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8')));

console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
if (fallidas) {
    console.log('  Fallos:');
    fallos.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
}
console.log('  ✓ Todo lo que la app necesita para abrir queda guardado sin conexión.');
