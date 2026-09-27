/**
 * Páginas públicas y buscadores: lo que Google ve.
 *
 * - Lo publicado es exactamente lo que genera herramientas/generar-sitio.js
 *   (si cambian los juzgados o el formulario de la calculadora, se regenera).
 * - Cada página tiene título, descripción, canónica, un solo h1 y datos
 *   estructurados válidos; el sitemap las lista y robots.txt no las bloquea.
 * - Los enlaces internos llevan a archivos que existen.
 */
const fs = require('fs');
const path = require('path');
const RAIZ = __dirname;
const { generar } = require('./herramientas/generar-sitio.js');

let pasadas = 0, fallidas = 0;
const fallos = [];
function verificar(desc, cond, detalle) {
    if (cond) { pasadas++; return; }
    fallidas++;
    fallos.push(desc + (detalle ? `\n      ${detalle}` : ''));
}

const generado = generar();
for (const [ruta, contenido] of Object.entries(generado)) {
    const publicado = fs.existsSync(path.join(RAIZ, ruta)) ? fs.readFileSync(path.join(RAIZ, ruta), 'utf8') : null;
    verificar(`${ruta}: está al día con el generador (corre node herramientas/generar-sitio.js)`, publicado === contenido);
}

const paginas = Object.keys(generado).filter(r => r.endsWith('.html'));
const titulos = new Set();
for (const ruta of paginas) {
    const html = generado[ruta];
    const t = /<title>([^<]+)<\/title>/.exec(html)?.[1] || '';
    verificar(`${ruta}: título de 30 a 70 caracteres`, t.length >= 30 && t.length <= 70, `${t.length}: ${t}`);
    verificar(`${ruta}: título distinto a las demás páginas`, !titulos.has(t));
    titulos.add(t);
    verificar(`${ruta}: menciona Quintana Roo en el título`, /Quintana Roo|LFT/.test(t), t);
    const d = /<meta name="description" content="([^"]+)"/.exec(html)?.[1] || '';
    verificar(`${ruta}: descripción de 110 a 180 caracteres`, d.length >= 110 && d.length <= 180, `${d.length}: ${d}`);
    const canon = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    const esperada = 'https://tsjia.empirica.mx/' + ruta.replace(/index\.html$/, '');
    verificar(`${ruta}: canónica a sí misma`, canon === esperada, canon);
    verificar(`${ruta}: un solo h1`, (html.match(/<h1[\s>]/g) || []).length === 1);
    verificar(`${ruta}: imagen para compartir en PNG`, /og:image" content="https:\/\/tsjia\.empirica\.mx\/og-image\.png"/.test(html));
    verificar(`${ruta}: invita a probar la app`, /href="\/docs\/\?tour=1/.test(html));
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        let ok = true;
        try { JSON.parse(m[1]); } catch (e) { ok = false; }
        verificar(`${ruta}: datos estructurados válidos`, ok);
    }
    // Enlaces internos (sin dominio) a archivos que existen.
    for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
        let destino = m[1];
        if (destino.endsWith('/')) destino += 'index.html';
        const existe = fs.existsSync(path.join(RAIZ, destino)) || Object.keys(generado).includes(destino.slice(1));
        verificar(`${ruta}: el enlace ${m[1]} existe`, existe);
    }
}

// Todos los juzgados del catálogo aparecen en la página de estrados.
const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'docs/js/juzgados.js'), 'utf8') + ';this.C=CATEGORIAS_JUZGADOS', ctx);
const total = ctx.C.reduce((s, c) => s + c.juzgados.length, 0);
const estrados = generado['estrados-tsj-quintana-roo/index.html'];
verificar('estrados: lista los 52 juzgados y salas del catálogo',
    (estrados.match(/<li>(?!<)/g) || []).length === total, `${(estrados.match(/<li>(?!<)/g) || []).length} de ${total}`);

// La calculadora pública usa el mismo formulario que la app.
const calc = generado['calculadora-finiquito-liquidacion/index.html'];
const app = fs.readFileSync(path.join(RAIZ, 'docs/index.html'), 'utf8');
const idsApp = [...app.matchAll(/id="(lab-[^"]+)"/g)].map(m => m[1]).filter(i => !['lab-expediente'].includes(i));
const faltan = idsApp.filter(i => !calc.includes(`id="${i}"`));
verificar('calculadora pública: trae todos los campos de la de la app', faltan.length === 0, faltan.join(', '));
verificar('calculadora pública: carga el motor', calc.includes('src="/docs/js/calculadora-laboral.js"'));

// Sitemap y robots.
const sitemap = generado['sitemap.xml'];
for (const ruta of paginas) {
    const url = 'https://tsjia.empirica.mx/' + ruta.replace(/index\.html$/, '');
    verificar(`sitemap: incluye ${url}`, sitemap.includes(`<loc>${url}</loc>`));
}
const robots = fs.readFileSync(path.join(RAIZ, 'robots.txt'), 'utf8');
verificar('robots.txt: anuncia el sitemap', /Sitemap: https:\/\/tsjia\.empirica\.mx\/sitemap\.xml/.test(robots));
const bloqueos = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map(m => m[1]);
for (const ruta of ['/', '/docs/', '/docs/css/styles.css', '/docs/js/app.js', '/assets/sitio.css',
    '/calculadora-finiquito-liquidacion/', '/estrados-tsj-quintana-roo/']) {
    const bloqueada = bloqueos.some(b => {
        const re = new RegExp('^' + b.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
        return re.test(ruta);
    });
    verificar(`robots.txt: deja rastrear ${ruta}`, !bloqueada);
}

// La imagen para redes: PNG de 1200×630.
const png = fs.readFileSync(path.join(RAIZ, 'og-image.png'));
verificar('og-image.png: es PNG de 1200×630',
    png.slice(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630);

// La app: su canónica es ella misma, no la portada.
verificar('app: canónica propia en /docs/', app.includes('<link rel="canonical" href="https://tsjia.empirica.mx/docs/">'));
verificar('app: comparte con imagen PNG', app.includes('og:image" content="https://tsjia.empirica.mx/og-image.png"'));

console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
if (fallidas) {
    console.log('  Fallos:');
    fallos.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
}
console.log('  ✓ El sitio está listo para los buscadores.');
