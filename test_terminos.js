#!/usr/bin/env node
/**
 * Términos y condiciones de los planes Premium (docs/js/terminos.js).
 *
 *   node test_terminos.js
 *
 * Un solo texto para la app y la página pública. Se fija que diga lo que se
 * pactó (sin devoluciones, continuidad salvo caso fortuito o fuerza mayor,
 * término de pleno derecho), que la app lo pida antes de contratar o activar
 * un plan y que la página pública sea exactamente ese texto.
 */
const fs = require('fs');
const path = require('path');
const T = require('./docs/js/terminos.js');
const { generar } = require('./herramientas/generar-sitio.js');

let pasadas = 0;
const fallos = [];
function verificar(d, c, detalle) {
    if (c) { pasadas++; console.log('  ✓ ' + d); } else { fallos.push(d); console.log('  ✗ ' + d + (detalle ? '\n      ' + detalle : '')); }
}
const texto = T.SECCIONES.map(([t, ps]) => t + '\n' + ps.join('\n')).join('\n');
const leer = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

console.log('\nEl texto');
verificar('tiene versión con fecha', /^\d{4}-\d{2}-\d{2}$/.test(T.VERSION));
verificar('las cuotas no se devuelven, en ningún caso', /no son reembolsables, ni total ni parcialmente, en ningún caso/.test(texto));
verificar('servicio continuo hasta el término, salvo caso fortuito o fuerza mayor',
    /forma continua hasta el término del plan, sin más interrupciones que las derivadas de caso fortuito o fuerza mayor/.test(texto));
verificar('las fallas de los sistemas de terceros cuentan como caso fortuito', /sistemas de terceros/.test(texto) && /Instituto Mexicano de la Propiedad Industrial/.test(texto));
verificar('al vencer, termina de pleno derecho y no se renueva solo', /termina de pleno derecho/.test(texto) && /no se renuevan solos/.test(texto));
verificar('la información no es asesoría y la viabilidad nunca es concluyente', /Nada de lo que muestra la Herramienta[^\n]*constituye asesoría jurídica/.test(texto) && /nunca son concluyentes/.test(texto));
verificar('limita la responsabilidad a lo pagado', /no excederá el monto efectivamente pagado/.test(texto));
verificar('aceptación por medios electrónicos', /por medios electrónicos/.test(texto));
verificar('jurisdicción en Cancún, Quintana Roo', /tribunales competentes de Cancún, Quintana Roo/.test(texto));
verificar('el HTML escapa el texto', !/<script/i.test(T.html()) && T.html().includes('<h2>1. Partes y aceptación</h2>'));

console.log('\nEn la app');
const app = leer('docs/js/app.js'), index = leer('docs/index.html');
verificar('se carga en la app y funciona sin internet', index.includes('<script src="js/terminos.js"></script>') && /'js\/terminos\.js'/.test(leer('docs/sw.js')));
verificar('cada plan pide aceptarlos antes de abrir WhatsApp', /onclick="return elegirPlanPremium\(event, '\$\{p\.id\}'\)"/.test(app));
verificar('activar un código también', /if \(!terminosAceptados\(\)\) \{\s*pedirAceptacionTerminos\(\(\) => activarPremium\(\)\);/.test(app));
verificar('el mensaje de WhatsApp lleva la aceptación y su versión', /Acepto los Términos y condiciones de TSJ Filing Online \(versión \$\{TERMINOS\.VERSION\}\)/.test(app));
verificar('una versión nueva hay que volver a aceptarla', /t\.version === TERMINOS\.VERSION/.test(app));
verificar('junto a los precios se avisa y se enlazan', /hay que aceptar los <a href="#" onclick="pedirAceptacionTerminos\(\); return false;">Términos y condiciones<\/a>/.test(index));

console.log('\nEn el sitio');
const sitio = generar();
const pagina = sitio['terminos-y-condiciones/index.html'];
verificar('la página pública es el mismo texto', T.SECCIONES.every(([t]) => pagina.includes(t)) && pagina.includes('Versión ' + T.VERSION));
verificar('el pie la enlaza en todas las páginas', Object.entries(sitio).filter(([r]) => r.endsWith('.html')).every(([, h]) => h.includes('href="/terminos-y-condiciones/"')));
verificar('contratar desde el sitio también la acepta en el mensaje', /Acepto%20los%20T%C3%A9rminos%20y%20condiciones/.test(sitio['index.html']));

console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
if (fallos.length) process.exit(1);
