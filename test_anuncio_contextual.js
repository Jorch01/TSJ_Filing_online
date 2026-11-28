/**
 * Anuncio contextual de Empírica: que elija bien y que no saque datos.
 *
 * - Abogado (3+ expedientes) o parte; materia predominante; sección actual.
 * - Enlaces al despacho: WhatsApp del despacho o empirica.mx con UTM.
 * - Lo que va a Analytics es solo el nombre del anuncio (lista blanca).
 * - Está en index.html, en sw.js, y el aviso de privacidad lo explica.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JS = path.join(__dirname, 'docs', 'js');

let pasadas = 0, fallidas = 0;
const fallos = [];
function verificar(desc, cond, detalle) {
    if (cond) { pasadas++; return; }
    fallidas++; fallos.push(desc + (detalle ? `\n      ${detalle}` : ''));
}

const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(JS, 'juzgados.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(JS, 'anuncio-contextual.js'), 'utf8'), ctx);
const A = ctx.AnuncioContextual;
verificar('el módulo se carga sin navegador', !!A && typeof A.elegirVariante === 'function');

const exp = (juzgado, extra = {}) => Object.assign({ juzgado }, extra);
const fam = exp('JUZGADO PRIMERO FAMILIAR CANCUN');
const civ = exp('Juzgado Segundo Civil de Primera Instancia del Distrito Judicial de Cancún');
const mer = exp('JUZGADO PRIMERO MERCANTIL CANCUN');
const pen = exp('JUZGADO PRIMERO DE CONTROL PENAL CHETUMAL');
const lab = exp('TRIBUNAL LABORAL CANCUN');
const pjf = exp('Juzgado Quinto de Distrito', { institucion: 'PJF' });
const raro = exp('Algo que no se reconoce');
const elegir = (expedientes, pagina) => A.elegirVariante({ expedientes, pagina });

// Partes (menos de 3 expedientes)
verificar('sin expedientes: corresponsalía (ganó la prueba A/B)', elegir([], 'inicio') === 'abogado_nuevo' && elegir([], 'expedientes') === 'abogado_nuevo' && elegir([]) === 'abogado_nuevo');
verificar('ya no hay sorteo: el grupo que hubiera quedado guardado no cuenta', A.elegirVariante({ expedientes: [], pagina: 'inicio', grupo: 'a' }) === 'abogado_nuevo');
verificar('parte con un juzgado no reconocido sigue con orientación general', elegir([raro]) === 'parte_general');
verificar('quien tiene expedientes no cambia', elegir([fam]) === 'parte_familiar' && elegir([fam, civ, pen]) === 'abogado_general');
verificar('la sección manda también sin expedientes (IMPI, PJF, laboral)', elegir([], 'impi') === 'parte_marcas' && elegir([], 'pjf') === 'parte_amparo' && elegir([], 'laboral') === 'parte_laboral');
verificar('se borra la marca del grupo de la prueba', /localStorage\.removeItem\(CLAVE_GRUPO_VIEJA\)/.test(fs.readFileSync(path.join(JS, 'anuncio-contextual.js'), 'utf8')));
verificar('abogado_nuevo dice lo mismo que abogado_general', A.VARIANTES.abogado_nuevo.texto === A.VARIANTES.abogado_general.texto);
verificar('parte familiar', elegir([fam], 'expedientes') === 'parte_familiar');
verificar('parte civil', elegir([civ], 'expedientes') === 'parte_civil');
verificar('parte mercantil va con civil', elegir([mer]) === 'parte_civil');
verificar('parte penal', elegir([pen]) === 'parte_penal');
verificar('parte laboral por el juzgado', elegir([lab]) === 'parte_laboral', elegir([lab]));
verificar('parte con expediente del PJF: amparo', elegir([pjf]) === 'parte_amparo');
verificar('juzgado no reconocido: general', elegir([raro]) === 'parte_general');
verificar('parte en la sección IMPI: marcas', elegir([fam], 'impi') === 'parte_marcas');
verificar('parte en la sección PJF: amparo', elegir([], 'pjf') === 'parte_amparo');
verificar('parte en la calculadora laboral: laboral', elegir([], 'laboral') === 'parte_laboral');

// Abogados (3 o más)
verificar('abogado: corresponsalía', elegir([fam, civ, pen]) === 'abogado_general');
verificar('abogado con mayoría de amparos', elegir([pjf, pjf, civ]) === 'abogado_amparo');
verificar('abogado en IMPI: marcas para su cliente', elegir([fam, civ, pen], 'impi') === 'abogado_marcas');
verificar('abogado en PJF: amparo', elegir([fam, civ, pen], 'pjf') === 'abogado_amparo');
verificar('abogado en la calculadora: no le ofrece "orientación laboral"', elegir([fam, civ, pen], 'laboral') === 'abogado_general');
verificar('el umbral es 3 expedientes', A.UMBRAL_ABOGADO === 3 && elegir([fam, fam]) === 'parte_familiar');

// Enlaces y textos
const nombres = Object.keys(A.VARIANTES);
for (const id of nombres) {
    const v = A.VARIANTES[id];
    const url = v.enlace();
    const ok = url.startsWith('https://wa.me/529982570828?text=') ||
        (url.startsWith('https://empirica.mx/') && url.includes('utm_source=tsjfiling') && url.includes('utm_medium=anuncio_contextual') && url.includes('utm_campaign=' + id));
    verificar(`${id}: enlace al despacho (WhatsApp 998 257 0828 o empirica.mx con UTM)`, ok, url);
    verificar(`${id}: texto y llamada`, v.texto && v.texto.length <= 110 && v.llamada, v.texto);
    verificar(`${id}: nombre válido para Analytics`, /^(abogado|parte)_[a-z]{1,20}$/.test(id));
}
verificar('a las partes nunca se les menciona a su abogado', nombres.filter(n => n.startsWith('parte_')).every(n => !/tu abogado/i.test(A.VARIANTES[n].texto)));
verificar('marcas lleva al verificador (#verificador después de la consulta)', /\?utm_[^#]+#verificador$/.test(A.VARIANTES.parte_marcas.enlace()));

// Analytics: el parámetro está en la lista blanca y solo acepta nombres de anuncio
const analitica = fs.readFileSync(path.join(JS, 'analitica.js'), 'utf8');
const permitidos = eval('(' + /const PERMITIDOS = (\{[\s\S]*?\});/.exec(analitica)[1] + ')');
verificar('analitica.js permite el parámetro "anuncio"', !!permitidos.anuncio);
verificar('"anuncio" acepta los nombres de variante', nombres.every(n => permitidos.anuncio.test(n)));
verificar('"anuncio" rechaza datos de expedientes', !permitidos.anuncio.test('1234/2025') && !permitidos.anuncio.test('JUZGADO PRIMERO FAMILIAR'));
const fuente = fs.readFileSync(path.join(JS, 'anuncio-contextual.js'), 'utf8');
verificar('solo manda { anuncio } a medir()', /medir\(evento, \{ anuncio \}\)/.test(fuente) && (fuente.match(/\.medir\(/g) || []).length === 1);
verificar('no usa innerHTML (textos con textContent)', !/innerHTML/.test(fuente));

// Integración
const index = fs.readFileSync(path.join(__dirname, 'docs', 'index.html'), 'utf8');
verificar('index.html carga el módulo después de analitica.js', index.indexOf('js/anuncio-contextual.js') > index.indexOf('js/analitica.js') && index.includes('js/anuncio-contextual.js'));
verificar('sw.js lo guarda para usar sin conexión', fs.readFileSync(path.join(__dirname, 'docs', 'sw.js'), 'utf8').includes("'js/anuncio-contextual.js'"));
const aviso = fs.readFileSync(path.join(__dirname, 'docs', 'legal', 'aviso-privacidad-integral.md'), 'utf8');
verificar('el aviso de privacidad explica el anuncio', aviso.includes('**Anuncio del despacho.**') && !aviso.includes('No usamos tus datos para publicidad ni los vendemos.'));

console.log(`\n  ${pasadas} pasadas, ${fallidas} fallidas\n`);
if (fallidas) { console.log('  Fallos:'); fallos.forEach(f => console.log('   ✗ ' + f)); process.exit(1); }
console.log('  ✓ El anuncio elige en el dispositivo y solo cuenta qué anuncio salió.');
