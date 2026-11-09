/**
 * El proxy del IMPI solo sigue enlaces de Marcanet.
 *
 * /marcanet/detail-link y /marcanet/full-detail reciben del navegador el
 * enlace de un resultado. Antes, uno que empezara con "http" se pedía tal
 * cual: el worker servía de proxy abierto y mandaba las cookies de la sesión
 * con el IMPI a cualquier servidor. Aquí se prueba urlMarcanet() del worker.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pasadas = 0;
const fallos = [];
function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; console.log('  ✓ ' + descripcion); }
    else { fallos.push(descripcion); console.log('  ✗ ' + descripcion + (detalle !== undefined ? '\n      ' + detalle : '')); }
}

const WORKER = fs.readFileSync(path.join(__dirname, 'docs', 'proxy', 'impi-proxy-worker.js'), 'utf8');
const base = WORKER.match(/const MARCANET_BASE = '[^']+';/)[0];
const seccion = WORKER.slice(WORKER.indexOf('// ==================== ENLACES MARCANET (INICIO)'), WORKER.indexOf('// ==================== ENLACES MARCANET (FIN)'));
const W = { URL, Error };
vm.createContext(W);
vm.runInContext(base + '\n' + seccion + '\nthis.urlMarcanet = urlMarcanet;', W);

const B = 'https://acervomarcas.impi.gob.mx:8181';
function da(descripcion, link, esperado) {
    let r;
    try { r = W.urlMarcanet(link); } catch (e) { r = 'ERROR'; }
    verificar(descripcion, r === esperado, `obtenido ${r}, esperado ${esperado}`);
}

console.log('\nEnlaces que sí se siguen');
da('relativo sin barra va bajo /marcanet/', 'vistas/common/datos/bsqExpediente.pgi?exp=1', B + '/marcanet/vistas/common/datos/bsqExpediente.pgi?exp=1');
da('relativo con barra', '/marcanet/vistas/x.pgi?a=1&b=2', B + '/marcanet/vistas/x.pgi?a=1&b=2');
da('absoluto de Marcanet', B + '/marcanet/vistas/x.pgi?a=1', B + '/marcanet/vistas/x.pgi?a=1');
da('mismo servidor por http o sin puerto: se usa el de siempre', 'http://acervomarcas.impi.gob.mx/marcanet/x.pgi', B + '/marcanet/x.pgi');

console.log('\nEnlaces que no');
da('otro servidor', 'https://ejemplo.com/robar', 'ERROR');
da('otro servidor en mayúsculas', 'HTTPS://ejemplo.com/', 'ERROR');
da('un subdominio falso', 'https://acervomarcas.impi.gob.mx.ejemplo.com/', 'ERROR');
da('con usuario para disfrazar el destino', 'https://acervomarcas.impi.gob.mx:8181@ejemplo.com/', 'ERROR');
da('con usuario y el host bueno', 'https://alguien@acervomarcas.impi.gob.mx:8181/x', 'ERROR');
da('dirección interna', 'http://169.254.169.254/latest', 'ERROR');

console.log('\nLos raros se quedan como rutas dentro de Marcanet');
da('protocolo relativo', '//ejemplo.com/x', B + '//ejemplo.com/x');
da('otro esquema', 'file:///etc/passwd', B + '/marcanet/file:///etc/passwd');

console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
if (fallos.length) {
    console.log('\nFallaron:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
}
