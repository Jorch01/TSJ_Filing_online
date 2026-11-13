#!/usr/bin/env node
/**
 * Genera el módulo del verificador de viabilidad de marca para el sitio del
 * despacho (empirica.mx), a partir del código de la app. NO toca la app.
 *
 *   node herramientas/generar-verificador-sitio.js <salida.js>
 *   node herramientas/generar-verificador-sitio.js --comprobar <archivo.js>   (¿está al día?)
 *
 * De docs/js/impi-viabilidad.js toma, tal cual:
 *   - el MOTOR (comparación de denominaciones, riesgos, dictamen), que es puro; y
 *   - la ORQUESTACIÓN de las consultas (MARCia, Marcanet, SIGA, fichas), que en
 *     la app vive entre funciones de la interfaz pero no usa nada de ella.
 * Les agrega una cubierta mínima (el proxy y el progreso se inyectan) y expone
 * `VerificadorMarca.estudiar(entrada, { proxyFetch, clientId, progreso })`.
 *
 * Una sola fuente de verdad: si se mejora el motor o las consultas en la app,
 * basta volver a generar. Si alguien mete en esas regiones algo de la interfaz
 * (document, toast, la base de datos…), el generador falla en vez de producir
 * un módulo roto; la prueba test_verificador_sitio.js lo cubre.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FUENTE = path.join(__dirname, '..', 'docs', 'js', 'impi-viabilidad.js');

const MOTOR_INICIO = '    // ==================== MOTOR ====================';
const MOTOR_FIN = "    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;";
const ORQ_INICIO = '    function consultaMARCia(titulo, opcion) {';
const ORQ_FIN = '    function puedeReintentar() {';

// Lo que no puede aparecer en las regiones extraídas: es de la interfaz o de la app.
const PROHIBIDO = [
    [/\bdocument\./, 'document'], [/\bwindow\./, 'window'], [/\blocalStorage\b/, 'localStorage'], [/\btoast\(/, 'toast()'],
    [/\$\('/, "$('…')"], [/\bui\./, 'ui.'], [/\bpintar[A-Z]\w*\(/, 'pintar…()'], [/\bguardarReciente\(/, 'guardarReciente()'],
    [/\bguardarBusqueda\(/, 'guardarBusqueda()'], [/\bdatabase\b|\bsyncManager\b|\bdb\./i, 'base de datos de la app'],
    [/\bCUOTAS_IMPI\b/, 'CUOTAS_IMPI']
];

function extraer(fuente, inicio, fin, nombre) {
    const i = fuente.indexOf(inicio);
    const j = fuente.indexOf(fin, i + 1);
    if (i < 0 || j < 0) throw new Error('No encontré la región «' + nombre + '» en impi-viabilidad.js (¿cambió el marcador?): ' + (i < 0 ? inicio.trim() : fin.trim()));
    const region = fuente.slice(i, j);
    for (const [rx, etiqueta] of PROHIBIDO) {
        const m = rx.exec(region);
        if (m) {
            const linea = region.slice(0, m.index).split('\n').length;
            throw new Error('La región «' + nombre + '» ya no es independiente de la interfaz: usa ' + etiqueta + ' (línea ' + linea + ' de la región). ' +
                'Sácalo de ahí o ajusta herramientas/generar-verificador-sitio.js.');
        }
    }
    return region;
}

function generar(fuente) {
    const motor = extraer(fuente, MOTOR_INICIO, MOTOR_FIN, 'motor');
    const orquestacion = extraer(fuente, ORQ_INICIO, ORQ_FIN, 'orquestación');
    const huella = crypto.createHash('sha256').update(motor + '\n' + orquestacion).digest('hex').slice(0, 16);
    return `/**
 * VERIFICADOR DE VIABILIDAD DE MARCA — módulo para el sitio.
 *
 * ARCHIVO GENERADO: no lo edites a mano. Se genera desde la app con
 *   node herramientas/generar-verificador-sitio.js <este archivo>
 * (repositorio TSJ_Filing_online, de docs/js/impi-viabilidad.js).
 * Huella de lo extraído: ${huella}
 *
 * Sin dependencias de la app (base de datos, sincronización, cuentas, interfaz).
 * Uso:
 *   const { reporte, crudo } = await VerificadorMarca.estudiar(
 *       { denominacion, tipo, clases: [25, 35], productos, solicitante: '', porPalabra: true },
 *       { proxyFetch, clientId: () => 'abc', progreso: (ev) => {} });
 */
(function (raiz) {
    'use strict';

    // Lo que la orquestación espera del entorno (en la app es la ventana).
    let entorno = { proxyFetch: null, clientId: () => 'sitio', progreso: null };
    const global = {
        proxyFetch: (...args) => entorno.proxyFetch(...args),
        obtenerClientId: () => entorno.clientId()
    };

${motor}
    // ==================== ORQUESTACIÓN DE LAS CONSULTAS ====================
    // Tal cual de la app; solo cambian paso() y marcar(), que aquí avisan de
    // su progreso a quien llame en vez de pintar una lista.

    function paso(id, texto) { if (entorno.progreso) entorno.progreso({ tipo: 'paso', id, texto }); }
    function marcar(id, estado, detalle) { if (entorno.progreso) entorno.progreso({ tipo: 'marca', id, estado, detalle: detalle || '' }); }

${orquestacion}
    // ==================== API PARA EL SITIO ====================

    function usar(opciones) {
        entorno = Object.assign({ proxyFetch: null, clientId: () => 'sitio', progreso: null }, opciones || {});
        if (typeof entorno.proxyFetch !== 'function') throw new Error('Falta proxyFetch');
    }

    /** El estudio completo: las tres fuentes en paralelo y luego las fichas. Igual que ejecutar() en la app, sin interfaz. */
    async function estudiar(entrada, opciones) {
        usar(opciones);
        const plan = planDeBusqueda(entrada);
        pasosDeMARCia(plan);
        paso('mcn', 'Marcanet: búsqueda fonética (en todas las clases)');
        paso('siga', 'SIGA: publicaciones en Gaceta');
        clienteMarcanet = null;
        const crudo = { marcia: [], marcanet: [], siga: [], fuentes: {} };
        await Promise.all([consultarMARCia(entrada, crudo, plan.distintivas, plan.comodines), consultarMarcanet(entrada, crudo), consultarSIGA(entrada, crudo)]);
        const reporte = await completar(entrada, crudo);
        return { reporte, crudo };
    }

    /** Vuelve a pedir solo lo que no respondió. Igual que reintentar() en la app, sin interfaz ni cuotas. */
    async function reintentar(entrada, crudo, reporte, opciones) {
        usar(opciones);
        const falta = faltantes(reporte);
        sesionNuevaMarcanet();
        const tareas = [];
        if (falta.includes('MARCia')) {
            const plan = planDeBusqueda(entrada);
            pasosDeMARCia(plan);
            crudo.marcia = [];
            tareas.push(consultarMARCia(entrada, crudo, plan.distintivas, plan.comodines));
        }
        if (falta.includes('Marcanet')) {
            paso('mcn', 'Marcanet: búsqueda fonética (en todas las clases)');
            crudo.marcanet = [];
            tareas.push(consultarMarcanet(entrada, crudo));
        }
        if (falta.includes('SIGA')) {
            paso('siga', 'SIGA: publicaciones en Gaceta');
            tareas.push(consultarSIGA(entrada, crudo));
        }
        await Promise.all(tareas);
        return { reporte: await completar(entrada, crudo), crudo };
    }

    const API = Object.assign({}, Motor, { estudiar, reintentar, faltantes, planDeBusqueda });
    raiz.VerificadorMarca = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

module.exports = { generar, FUENTE };

if (require.main === module) {
    const args = process.argv.slice(2);
    const comprobar = args[0] === '--comprobar';
    const destino = comprobar ? args[1] : args[0];
    if (!destino) {
        console.error('Uso: node herramientas/generar-verificador-sitio.js <salida.js>\n     node herramientas/generar-verificador-sitio.js --comprobar <archivo.js>');
        process.exit(2);
    }
    let codigo;
    try { codigo = generar(fs.readFileSync(FUENTE, 'utf8')); }
    catch (e) { console.error('✗ ' + e.message); process.exit(1); }
    if (comprobar) {
        const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';
        if (actual === codigo) { console.log('✓ El módulo del sitio está al día con la app.'); process.exit(0); }
        console.error('✗ El módulo del sitio está desfasado de la app. Vuelve a generarlo:\n  node herramientas/generar-verificador-sitio.js ' + destino);
        process.exit(1);
    }
    fs.mkdirSync(path.dirname(path.resolve(destino)), { recursive: true });
    fs.writeFileSync(destino, codigo);
    console.log('✓ Generado ' + destino + ' (' + Math.round(codigo.length / 1024) + ' KB)');
}
