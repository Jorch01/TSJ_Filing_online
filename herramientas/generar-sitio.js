#!/usr/bin/env node
/**
 * Genera las páginas públicas del sitio (las que encuentra Google):
 *
 *   /                                   presentación de la herramienta
 *   /estrados-tsj-quintana-roo/         los 52 juzgados y salas del TSJ
 *   /expedientes-pjf-quintana-roo/      los órganos federales del 27º circuito
 *   /calculadora-finiquito-liquidacion/ la calculadora laboral, funcionando
 *
 * Las listas salen de los catálogos de la app (docs/js/juzgados.js y
 * docs/data/organismos.json) y la calculadora usa el mismo formulario que la
 * app (se copia de docs/index.html), así que nada se captura dos veces.
 *
 * Uso:   node herramientas/generar-sitio.js
 * test_sitio.js comprueba que lo publicado es lo que genera este script: si
 * cambia un catálogo o el formulario, hay que volver a correrlo.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const SITIO = 'https://tsjia.empirica.mx';
const APP = '/docs/';
// Sin JavaScript, el botón de recomendar abre WhatsApp con este mensaje.
const WHATSAPP_RECOMENDAR = 'https://wa.me/?text=' + encodeURIComponent(
    'Te recomiendo TSJ Filing Online: estrados del TSJ de Quintana Roo y del PJF, agenda de audiencias, IA que lee los acuerdos y calculadora de finiquito. Gratis y sin registro. ' +
    'https://tsjia.empirica.mx/?utm_source=recomendacion&utm_medium=whatsapp&utm_campaign=colega');
const ACTUALIZADO = '2026-09-27';

// ==================== DATOS DE LOS CATÁLOGOS ====================

function juzgadosTSJ() {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'docs/js/juzgados.js'), 'utf8') +
        ';this.__CAT = CATEGORIAS_JUZGADOS;', ctx);
    return ctx.__CAT.map(c => ({ nombre: c.nombre, icono: c.icono, juzgados: [...c.juzgados] }));
}

function organosPJFQuintanaRoo() {
    const todos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'docs/data/organismos.json'), 'utf8'));
    const qroo = todos.filter(o => o.circuito_id === 27).map(o => o.nombre);
    const grupo = (re) => qroo.filter(n => re.test(n)).sort((a, b) => a.localeCompare(b, 'es'));
    const colegiados = grupo(/Colegiado/);
    const laborales = grupo(/Laboral/);
    const distrito = grupo(/Juzgado/);
    const otros = qroo.filter(n => ![...colegiados, ...laborales, ...distrito].includes(n));
    return [
        { nombre: 'Tribunales Colegiados del Vigésimo Séptimo Circuito', icono: '🏛️', organos: colegiados },
        { nombre: 'Juzgados de Distrito en Quintana Roo', icono: '⚖️', organos: distrito },
        { nombre: 'Tribunales Laborales Federales', icono: '👷', organos: laborales },
        ...(otros.length ? [{ nombre: 'Otros órganos', icono: '📍', organos: otros }] : [])
    ].filter(g => g.organos.length);
}

function formularioCalculadora() {
    const html = fs.readFileSync(path.join(RAIZ, 'docs/index.html'), 'utf8');
    const inicio = html.indexOf('<div class="lab-layout">');
    const fin = html.indexOf('</section>', inicio);
    if (inicio < 0 || fin < 0) throw new Error('No se encontró el formulario de la calculadora en docs/index.html');
    let bloque = html.slice(inicio, fin).trimEnd();
    // Fuera de la app no hay expedientes ni notas: guardar lleva a la app.
    bloque = bloque.replace(/<div class="card-footer lab-acciones"[\s\S]*?<\/div>/, `<div class="card-footer lab-acciones" id="lab-acciones" style="display:none;">
                            <button class="btn btn-secondary btn-sm" onclick="copiarResumenLaboral()">📋 Copiar</button>
                            <button class="btn btn-secondary btn-sm" onclick="imprimirCalculoLaboral()">🖨️ Imprimir</button>
                            <button class="btn btn-secondary btn-sm" onclick="recomendarApp('calculadora_sitio', 'calculadora')">💬 Compartir calculadora</button>
                            <a class="btn btn-success btn-sm" href="${APP}?tour=1#laboral">📁 Guardar en un expediente (gratis)</a>
                        </div>`);
    return bloque;
}

// ==================== PIEZAS COMUNES ====================

const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const titulo = (t) => t.toLowerCase().replace(/(^|\s|\()([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Y|De|Del|En|La|Las|Los|Con|Por)\b/g, w => w.toLowerCase());

function cabeza({ ruta, tituloPagina, descripcion, jsonld = [], extraHead = '' }) {
    const url = SITIO + ruta;
    return `<!DOCTYPE html>
<html lang="es-MX">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(tituloPagina)}</title>
    <meta name="description" content="${esc(descripcion)}">
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
    <meta name="author" content="Empírica Legal Lab">
    <meta name="theme-color" content="#2563a8">
    <meta name="geo.region" content="MX-ROO">
    <meta name="geo.placename" content="Quintana Roo">
    <link rel="canonical" href="${url}">
    <link rel="alternate" hreflang="es-MX" href="${url}">
    <meta name="google-site-verification" content="8SEvBo272NhP7QJE2_69Bz9hjjKkiZDN6hBu1u4pRl4">

    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${esc(tituloPagina)}">
    <meta property="og:description" content="${esc(descripcion)}">
    <meta property="og:locale" content="es_MX">
    <meta property="og:site_name" content="TSJ Filing Online">
    <meta property="og:image" content="${SITIO}/og-image.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="TSJ Filing Online: expedientes, estrados y agenda para abogados de Quintana Roo">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(tituloPagina)}">
    <meta name="twitter:description" content="${esc(descripcion)}">
    <meta name="twitter:image" content="${SITIO}/og-image.png">

    <link rel="icon" href="/docs/icons/icono.svg" type="image/svg+xml">
    <link rel="icon" href="/docs/icons/favicon-32.png" sizes="32x32" type="image/png">
    <link rel="apple-touch-icon" href="/docs/icons/apple-touch-icon.png">
    <link rel="stylesheet" href="/docs/css/styles.css">
    <link rel="stylesheet" href="/assets/sitio.css">
${jsonld.map(j => `    <script type="application/ld+json">\n${JSON.stringify(j, null, 2).replace(/^/gm, '    ')}\n    </script>`).join('\n')}
${extraHead}</head>
<body class="sitio">
    <a class="sitio-saltar" href="#contenido">Saltar al contenido</a>
    <header class="sitio-header">
        <div class="sitio-ancho sitio-header-fila">
            <a class="sitio-logo" href="/">⚖️ <span>TSJ Filing Online</span></a>
            <nav class="sitio-nav" aria-label="Secciones">
                <a href="/#funciones">Funciones</a>
                <a href="/estrados-tsj-quintana-roo/">Estrados TSJ</a>
                <a href="/expedientes-pjf-quintana-roo/">PJF</a>
                <a href="/calculadora-finiquito-liquidacion/">Calculadora laboral</a>
                <a href="/#preguntas">Preguntas</a>
            </nav>
            <a class="btn btn-primary sitio-cta-header" href="${APP}?tour=1">Probar gratis</a>
        </div>
    </header>
    <main id="contenido">
`;
}

function pie() {
    return `    </main>

    <section class="sitio-cta-final">
        <div class="sitio-ancho">
            <h2>Deja de perseguir acuerdos. Empieza hoy.</h2>
            <p>Abre la app, agrega tu primer expediente con ayuda de la IA y ten tu agenda de audiencias al día. Sin registro y gratis para empezar.</p>
            <div class="sitio-cta-botones">
                <a class="btn btn-primary btn-lg" href="${APP}?tour=1">Probar gratis ahora →</a>
                <a class="btn btn-lg sitio-recomendar" href="${WHATSAPP_RECOMENDAR}" target="_blank" rel="noopener"
                   onclick="if (window.recomendarApp) { event.preventDefault(); recomendarApp('sitio'); }">🤝 Recomendar a un colega</a>
            </div>
        </div>
    </section>

    <footer class="sitio-footer">
        <div class="sitio-ancho sitio-footer-grid">
            <div>
                <strong>⚖️ TSJ Filing Online</strong>
                <p>Herramienta para abogados y despachos de Quintana Roo: expedientes del TSJ y del PJF, estrados, agenda, IA y calculadora laboral.</p>
                <p>Desarrollado por <a href="https://www.empirica.mx" rel="noopener">Empírica Legal Lab</a>.</p>
            </div>
            <div>
                <strong>Herramientas</strong>
                <ul>
                    <li><a href="${APP}">Abrir la app</a></li>
                    <li><a href="/estrados-tsj-quintana-roo/">Estrados del TSJ de Quintana Roo</a></li>
                    <li><a href="/expedientes-pjf-quintana-roo/">Expedientes federales en Quintana Roo</a></li>
                    <li><a href="/calculadora-finiquito-liquidacion/">Calculadora de finiquito y liquidación</a></li>
                </ul>
            </div>
            <div>
                <strong>Contacto</strong>
                <p><a href="mailto:jorge_clemente@empirica.mx">jorge_clemente@empirica.mx</a></p>
                <p class="sitio-legal">Herramienta independiente: no está afiliada al Tribunal Superior de Justicia de Quintana Roo, al Poder Judicial de la Federación ni al IMPI. Las consultas se hacen en sus portales oficiales.</p>
                <p class="sitio-legal">Usamos estadísticas de uso anónimas para mejorar el sitio; nunca datos de tus expedientes.</p>
            </div>
        </div>
    </footer>
    <script src="/docs/js/recomendar.js"></script>
    <script src="/docs/js/analitica.js"></script>
</body>
</html>
`;
}

const organizacion = {
    '@type': 'Organization',
    '@id': SITIO + '/#organizacion',
    name: 'Empírica Legal Lab',
    url: 'https://www.empirica.mx',
    email: 'jorge_clemente@empirica.mx'
};

const quintanaRoo = { '@type': 'State', name: 'Quintana Roo', containedInPlace: { '@type': 'Country', name: 'México' } };

function migas(...pasos) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [{ nombre: 'Inicio', ruta: '/' }, ...pasos].map((p, i) => ({
            '@type': 'ListItem', position: i + 1, name: p.nombre, item: SITIO + p.ruta
        }))
    };
}

function faq(preguntas) {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: preguntas.map(([q, a]) => ({
            '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a }
        }))
    };
}

function faqHTML(preguntas) {
    return preguntas.map(([q, a]) => `
                <details class="sitio-faq">
                    <summary>${esc(q)}</summary>
                    <p>${esc(a)}</p>
                </details>`).join('');
}

// ==================== PÁGINA DE INICIO ====================

const PREGUNTAS_INICIO = [
    ['¿Cuánto cuesta TSJ Filing Online?',
        'Es gratis para empezar: puedes llevar hasta 10 expedientes con todas las funciones básicas. Para expedientes ilimitados y sincronizar entre computadora y celular existe el plan Premium.'],
    ['¿Necesito crear una cuenta?',
        'No. Abres la app en el navegador y empiezas a trabajar. Tus expedientes, notas y agenda se guardan en tu propio dispositivo.'],
    ['¿Qué juzgados de Quintana Roo incluye?',
        'Los 52 juzgados y salas del Tribunal Superior de Justicia de Quintana Roo en Cancún, Playa del Carmen, Chetumal, Cozumel, Tulum, Felipe Carrillo Puerto, Isla Mujeres y Bacalar, además de los juzgados de distrito y tribunales colegiados federales del Vigésimo Séptimo Circuito.'],
    ['¿Cómo me ayuda la inteligencia artificial?',
        'Pegas el texto de un acuerdo o le tomas una foto y la IA identifica el número de expediente, el juzgado, las fechas de audiencia y los plazos. Con un clic se crean el expediente, los eventos en tu calendario y las notas. Usa Gemini de Google con una clave gratuita que configuras una sola vez.'],
    ['¿Cómo la instalo en mi celular?',
        'En iPhone: ábrela en Safari, toca Compartir y elige "Agregar a pantalla de inicio". En Android: ábrela en Chrome y toca "Instalar app" (o el menú ⋮ → Instalar app). Queda un ícono que la abre con un toque, a pantalla completa.'],
    ['¿Funciona sin internet?',
        'Sí. Después de abrirla una vez, abre aunque no haya señal, con tus expedientes, agenda y notas. Lo que cambies se sincroniza al volver la conexión.'],
    ['¿Mis datos están seguros?',
        'Tus datos viven en tu navegador, no en un servidor nuestro. Puedes exportar respaldos cuando quieras y, si activas la sincronización, viajan cifrados.'],
    ['¿Sirve para asuntos federales?',
        'Sí. Consultas expedientes del Poder Judicial de la Federación de todo el país, con acceso directo a los órganos de Quintana Roo, y los llevas en la misma agenda que los del TSJ.']
];

function paginaInicio(cat, pjf) {
    const totalJuzgados = cat.reduce((s, c) => s + c.juzgados.length, 0);
    const totalPJF = pjf.reduce((s, g) => s + g.organos.length, 0);
    const funciones = [
        ['🏢', 'Estrados del TSJ en un clic', `Los ${totalJuzgados} juzgados y salas del TSJ de Quintana Roo. Busca por número o por nombre y revisa varios expedientes a la vez.`, '/estrados-tsj-quintana-roo/'],
        ['🤖', 'La IA lee los acuerdos por ti', 'Pega o fotografía un acuerdo: detecta expediente, juzgado, audiencias y plazos, y los guarda en tu agenda.'],
        ['🏛️', 'Expedientes federales (PJF)', `Consulta en el portal del PJF, con los ${totalPJF} órganos federales de Quintana Roo a la mano.`, '/expedientes-pjf-quintana-roo/'],
        ['📅', 'Agenda de audiencias y pendientes', 'Calendario con los días inhábiles del TSJ, pendientes con fecha límite y vista rápida de tu día.'],
        ['🧮', 'Calculadora de finiquito y liquidación', 'Finiquito, liquidación, 20 días, prima de antigüedad, salarios vencidos e ISR, con su artículo de la LFT.', '/calculadora-finiquito-liquidacion/'],
        ['🎤', 'Asistente de voz', '"Agenda audiencia del 120/2026 el martes a las 10." Díctale y listo.'],
        ['🔰', 'Marcas y gacetas del IMPI', 'Busca marcas registradas (MARCia) y vigila las gacetas (SIGA) con avisos de publicaciones nuevas.'],
        ['📴', 'Funciona sin internet', 'Abre en el juzgado aunque no haya señal. Tus datos son tuyos y viven en tu dispositivo.']
    ];
    const ciudades = ['Cancún', 'Playa del Carmen', 'Chetumal', 'Cozumel', 'Tulum', 'Felipe Carrillo Puerto', 'Isla Mujeres', 'Bacalar'];
    const jsonld = [
        {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            '@id': SITIO + '/#app',
            name: 'TSJ Filing Online',
            url: SITIO + '/',
            applicationCategory: 'BusinessApplication',
            applicationSubCategory: 'Gestión de expedientes jurídicos',
            operatingSystem: 'Web, Android, iOS, Windows, macOS',
            inLanguage: 'es-MX',
            description: 'Gestión de expedientes del TSJ de Quintana Roo y del PJF: estrados, agenda de audiencias, análisis de acuerdos con IA, calculadora laboral y búsqueda de marcas del IMPI.',
            image: SITIO + '/og-image.png',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'MXN', description: 'Gratis hasta 10 expedientes' },
            areaServed: quintanaRoo,
            audience: { '@type': 'Audience', audienceType: 'Abogados y despachos jurídicos' },
            publisher: organizacion,
            featureList: funciones.map(f => f[1])
        },
        { '@context': 'https://schema.org', ...organizacion },
        faq(PREGUNTAS_INICIO)
    ];

    return cabeza({
        ruta: '/',
        tituloPagina: 'TSJ Filing Online | Expedientes y estrados del TSJ Quintana Roo',
        descripcion: `Expedientes del TSJ de Quintana Roo y del PJF en un solo lugar: estrados de ${totalJuzgados} juzgados, agenda de audiencias, IA que lee acuerdos y calculadora laboral. Gratis.`,
        jsonld
    }) + `
        <section class="sitio-hero">
            <div class="sitio-ancho sitio-hero-grid">
                <div>
                    <p class="sitio-etiqueta">Para abogados y despachos de Quintana Roo</p>
                    <h1>Tus expedientes del TSJ de Quintana Roo y del PJF, al día y en un solo lugar</h1>
                    <p class="sitio-lead">Consulta estrados, lleva tu agenda de audiencias y plazos, y deja que la inteligencia artificial lea los acuerdos por ti. Desde la computadora o el celular.</p>
                    <div class="sitio-hero-botones">
                        <a class="btn btn-primary btn-lg" href="${APP}?tour=1">Probar gratis ahora →</a>
                        <a class="btn btn-secondary btn-lg" href="/calculadora-finiquito-liquidacion/">🧮 Calcular un finiquito</a>
                    </div>
                    <ul class="sitio-garantias">
                        <li>✓ Sin registro</li>
                        <li>✓ Gratis hasta 10 expedientes</li>
                        <li>✓ Tus datos se quedan en tu dispositivo</li>
                    </ul>
                </div>
                <div class="sitio-hero-demo" aria-hidden="true">
                    <div class="demo-tarjeta">
                        <div class="demo-cabecera"><span class="demo-badge">⚖️ TSJ</span><span class="demo-cat">CANCÚN - Familiar</span></div>
                        <strong>1234/2026</strong>
                        <span>JUZGADO PRIMERO FAMILIAR ORAL CANCUN</span>
                        <div class="demo-botones"><span class="demo-btn">🌐 Estrados</span><span class="demo-chip">✅ 2</span></div>
                    </div>
                    <div class="demo-tarjeta demo-ia">
                        <span class="demo-titulo">🤖 La IA encontró en el acuerdo:</span>
                        <span>📅 Audiencia de juicio · martes 14 de octubre, 10:00</span>
                        <span>⏳ Término de 9 días para ofrecer pruebas</span>
                        <span class="demo-btn demo-ok">💾 Guardar todo</span>
                    </div>
                </div>
            </div>
        </section>

        <section class="sitio-ciudades" aria-label="Cobertura">
            <div class="sitio-ancho">
                <span>Juzgados de</span>
                ${ciudades.map(c => `<strong>${c}</strong>`).join('<span aria-hidden="true">·</span>')}
            </div>
        </section>

        <section class="sitio-seccion" id="funciones">
            <div class="sitio-ancho">
                <h2>Todo lo que necesitas para litigar en Quintana Roo</h2>
                <p class="sitio-sub">Hecho para el día a día de los juzgados locales y federales del estado.</p>
                <div class="sitio-funciones">
${funciones.map(([ico, t, d, enlace]) => `                    <article class="sitio-funcion">
                        <span class="sitio-funcion-icono">${ico}</span>
                        <h3>${esc(t)}</h3>
                        <p>${esc(d)}</p>
                        ${enlace ? `<a href="${enlace}">Ver más →</a>` : ''}
                    </article>`).join('\n')}
                </div>
            </div>
        </section>

        <section class="sitio-seccion sitio-alterna">
            <div class="sitio-ancho">
                <h2>Empieza en 3 pasos</h2>
                <ol class="sitio-pasos">
                    <li><strong>Abre la app y ponla en tu pantalla de inicio.</strong> Sin cuentas ni contraseñas: queda como un ícono más en tu celular.</li>
                    <li><strong>Pega o fotografía un acuerdo.</strong> La IA crea el expediente con su juzgado, audiencias y plazos. Un recorrido guiado te enseña cómo.</li>
                    <li><strong>Trabaja con tu agenda al día.</strong> Revisa estrados, marca pendientes y recibe tu día resumido al abrir la app.</li>
                </ol>
                <a class="btn btn-primary btn-lg" href="${APP}?tour=1">Empezar el recorrido guiado →</a>
            </div>
        </section>

        <section class="sitio-seccion" id="instalar">
            <div class="sitio-ancho">
                <h2>📲 Llévala en tu celular como una app</h2>
                <p class="sitio-sub">Sin tiendas de apps ni descargas pesadas: queda un ícono en tu pantalla de inicio que la abre con un toque, a pantalla completa y aunque no haya señal en el juzgado.</p>
                <div class="sitio-instalar">
                    <article>
                        <h3>iPhone y iPad</h3>
                        <ol>
                            <li>Abre <strong>tsjia.empirica.mx/docs</strong> en Safari.</li>
                            <li>Toca <strong>Compartir</strong> (el cuadro con la flecha hacia arriba).</li>
                            <li>Elige <strong>Agregar a pantalla de inicio</strong> y luego <strong>Agregar</strong>.</li>
                        </ol>
                    </article>
                    <article>
                        <h3>Android</h3>
                        <ol>
                            <li>Abre <strong>tsjia.empirica.mx/docs</strong> en Chrome.</li>
                            <li>Toca <strong>Instalar</strong> cuando la app te lo ofrezca, o el menú <strong>⋮</strong>.</li>
                            <li>Elige <strong>Instalar app</strong> y confirma.</li>
                        </ol>
                    </article>
                    <article class="sitio-instalar-icono">
                        <img src="/docs/icons/icono-192.png" alt="Ícono de TSJ Filing en la pantalla de inicio" width="96" height="96" loading="lazy">
                        <strong>TSJ Filing</strong>
                        <a class="btn btn-primary" href="${APP}?tour=1">Abrir e instalar →</a>
                    </article>
                </div>
            </div>
        </section>

        <section class="sitio-seccion sitio-alterna" id="preguntas">
            <div class="sitio-ancho sitio-angosto">
                <h2>Preguntas frecuentes</h2>
${faqHTML(PREGUNTAS_INICIO)}
            </div>
        </section>
` + pie();
}

// ==================== ESTRADOS DEL TSJ ====================

const PREGUNTAS_ESTRADOS = [
    ['¿Qué son los estrados electrónicos del TSJ de Quintana Roo?',
        'Es el tablero en línea donde el Tribunal Superior de Justicia de Quintana Roo publica los acuerdos de cada juzgado y sala. Consultarlo a diario es la forma de enterarse de lo que se acordó en un expediente.'],
    ['¿Cómo consulto un expediente en los estrados?',
        'Necesitas el juzgado y el número de expediente (por ejemplo 1234/2026) o el nombre de una de las partes. En TSJ Filing Online eliges el juzgado de la lista, escribes el número y se abre la consulta en el portal oficial del TSJ.'],
    ['¿Puedo revisar varios expedientes a la vez?',
        'Sí. Guarda tus expedientes y usa la selección masiva: se abren los estrados de todos los que marques, uno tras otro, para revisarlos de corrido.'],
    ['¿Incluye las salas de segunda instancia?',
        'Sí, las salas civiles, mercantiles, familiares y penales del Tribunal, con su buscador de segunda instancia.']
];

function paginaEstrados(cat) {
    const total = cat.reduce((s, c) => s + c.juzgados.length, 0);
    return cabeza({
        ruta: '/estrados-tsj-quintana-roo/',
        tituloPagina: 'Estrados electrónicos del TSJ de Quintana Roo: consulta por juzgado',
        descripcion: `Consulta los estrados del TSJ de Quintana Roo en sus ${total} juzgados y salas: Cancún, Playa del Carmen, Chetumal, Cozumel y más. Por número o nombre, varios a la vez.`,
        jsonld: [
            migas({ nombre: 'Estrados del TSJ de Quintana Roo', ruta: '/estrados-tsj-quintana-roo/' }),
            faq(PREGUNTAS_ESTRADOS)
        ]
    }) + `
        <section class="sitio-hero sitio-hero-chico">
            <div class="sitio-ancho">
                <nav class="sitio-migas" aria-label="Ruta"><a href="/">Inicio</a> › Estrados del TSJ</nav>
                <h1>Estrados electrónicos del TSJ de Quintana Roo</h1>
                <p class="sitio-lead">Consulta los acuerdos de los ${total} juzgados y salas del Tribunal Superior de Justicia de Quintana Roo por número de expediente o por nombre. Guarda tus expedientes y revísalos todos de corrido cada mañana.</p>
                <div class="sitio-hero-botones">
                    <a class="btn btn-primary btn-lg" href="${APP}?tour=1#tribunales">Consultar estrados ahora →</a>
                </div>
            </div>
        </section>

        <section class="sitio-seccion">
            <div class="sitio-ancho">
                <h2>Cómo consultar un expediente en 3 pasos</h2>
                <ol class="sitio-pasos">
                    <li><strong>Elige el juzgado o la sala.</strong> Escribe parte del nombre (por ejemplo "familiar Cancún") para encontrarlo rápido.</li>
                    <li><strong>Escribe el número o el nombre.</strong> El número va con su año, como 1234/2026.</li>
                    <li><strong>Revisa el acuerdo.</strong> Se abre la consulta en el portal oficial del TSJ. Con "Buscar y Guardar" el expediente queda en tu lista para la próxima vez.</li>
                </ol>
            </div>
        </section>

        <section class="sitio-seccion sitio-alterna">
            <div class="sitio-ancho">
                <h2>Juzgados y salas incluidos</h2>
                <p class="sitio-sub">Todos disponibles en la app para consultar estrados, guardar expedientes y llevar su agenda.</p>
                <div class="sitio-directorio">
${cat.map(c => `                    <section>
                        <h3>${c.icono} ${esc(titulo(c.nombre))}</h3>
                        <ul>
${c.juzgados.map(j => `                            <li>${esc(titulo(j))}</li>`).join('\n')}
                        </ul>
                    </section>`).join('\n')}
                </div>
            </div>
        </section>

        <section class="sitio-seccion">
            <div class="sitio-ancho sitio-angosto">
                <h2>Preguntas frecuentes</h2>
${faqHTML(PREGUNTAS_ESTRADOS)}
            </div>
        </section>
` + pie();
}

// ==================== PJF EN QUINTANA ROO ====================

const PREGUNTAS_PJF = [
    ['¿A qué circuito pertenece Quintana Roo?',
        'Al Vigésimo Séptimo Circuito del Poder Judicial de la Federación, con sede en Cancún y Chetumal.'],
    ['¿Cómo consulto un expediente federal?',
        'Eliges el circuito, el órgano jurisdiccional y el tipo de asunto (amparo indirecto, juicio de amparo directo, etc.) y escribes el número de expediente. La consulta se abre en el portal oficial del PJF.'],
    ['¿Puedo llevar los asuntos federales junto con los del TSJ?',
        'Sí. En TSJ Filing Online los expedientes federales y los del TSJ comparten agenda, pendientes y notas, y puedes filtrarlos por tribunal.']
];

function paginaPJF(grupos) {
    const total = grupos.reduce((s, g) => s + g.organos.length, 0);
    return cabeza({
        ruta: '/expedientes-pjf-quintana-roo/',
        tituloPagina: 'Consulta de expedientes federales (PJF) en Quintana Roo | 27º Circuito',
        descripcion: `Consulta expedientes federales (PJF) en Quintana Roo: juzgados de distrito, tribunales colegiados y laborales del Vigésimo Séptimo Circuito en Cancún y Chetumal.`,
        jsonld: [
            migas({ nombre: 'Expedientes federales en Quintana Roo', ruta: '/expedientes-pjf-quintana-roo/' }),
            faq(PREGUNTAS_PJF)
        ]
    }) + `
        <section class="sitio-hero sitio-hero-chico">
            <div class="sitio-ancho">
                <nav class="sitio-migas" aria-label="Ruta"><a href="/">Inicio</a> › Expedientes federales</nav>
                <h1>Expedientes federales (PJF) en Quintana Roo</h1>
                <p class="sitio-lead">Consulta tus amparos y juicios federales del Vigésimo Séptimo Circuito y llévalos en la misma agenda que tus asuntos del TSJ.</p>
                <div class="sitio-hero-botones">
                    <a class="btn btn-primary btn-lg" href="${APP}?tour=1#pjf">Consultar un expediente federal →</a>
                </div>
            </div>
        </section>

        <section class="sitio-seccion">
            <div class="sitio-ancho">
                <h2>Órganos federales en Quintana Roo</h2>
                <p class="sitio-sub">También puedes consultar cualquier órgano del país: la app trae el catálogo completo del PJF.</p>
                <div class="sitio-directorio">
${grupos.map(g => `                    <section>
                        <h3>${g.icono} ${esc(g.nombre)}</h3>
                        <ul>
${g.organos.map(o => `                            <li>${esc(o)}</li>`).join('\n')}
                        </ul>
                    </section>`).join('\n')}
                </div>
            </div>
        </section>

        <section class="sitio-seccion sitio-alterna">
            <div class="sitio-ancho sitio-angosto">
                <h2>Preguntas frecuentes</h2>
${faqHTML(PREGUNTAS_PJF)}
            </div>
        </section>
` + pie();
}

// ==================== CALCULADORA LABORAL ====================

const PREGUNTAS_LABORAL = [
    ['¿Qué incluye el finiquito?',
        'Lo que se debe siempre que termina la relación de trabajo, sin importar la causa: salarios pendientes, aguinaldo proporcional, vacaciones no disfrutadas y proporcionales, prima vacacional y otras prestaciones adeudadas. Se calcula con el salario base; el salario integrado solo entra en las indemnizaciones.'],
    ['¿Cuál es la diferencia entre finiquito y liquidación?',
        'El finiquito se paga en toda terminación. La liquidación se suma cuando hay despido injustificado u otra causa que da derecho a indemnización: tres meses de salario integrado, prima de antigüedad y, según el caso, 20 días por año y salarios vencidos.'],
    ['¿Cuándo se pagan los 20 días por año?',
        'Cuando el patrón se niega a reinstalar (artículos 49 y 50), cuando el trabajador rescinde por causa imputable al patrón (artículo 52) o en el reajuste por maquinaria nueva (artículo 439). En el despido injustificado del artículo 48 no son obligatorios, aunque suelen pactarse en convenio.'],
    ['¿Cómo se calcula la prima de antigüedad?',
        'Son 12 días de salario por cada año de servicio. El salario se topa al doble del salario mínimo de la zona —la general o la Zona Libre de la Frontera Norte— y nunca baja de un salario mínimo (artículos 485 y 486). En renuncia solo se paga con 15 años o más; en despido, siempre.'],
    ['¿Cuántos días de vacaciones corresponden en 2026?',
        '12 días el primer año, 14 el segundo, 16 el tercero, 18 el cuarto y 20 el quinto; a partir del sexto año, dos días más por cada cinco años de servicio (reforma de "vacaciones dignas").'],
    ['¿La indemnización paga ISR?',
        'Está exenta hasta 90 UMA por cada año de servicio; el excedente paga ISR a la tasa efectiva del último sueldo mensual (artículo 95 de la Ley del ISR). El aguinaldo está exento hasta 30 UMA y la prima vacacional hasta 15 UMA.']
];

function paginaCalculadora() {
    return cabeza({
        ruta: '/calculadora-finiquito-liquidacion/',
        tituloPagina: 'Calculadora de finiquito y liquidación 2026 (LFT) | Quintana Roo',
        descripcion: 'Calcula finiquito y liquidación 2026 según la LFT: aguinaldo, vacaciones, prima de antigüedad, 3 meses, 20 días, salarios vencidos e ISR, con fórmulas y artículos.',
        jsonld: [
            {
                '@context': 'https://schema.org',
                '@type': 'WebApplication',
                name: 'Calculadora de finiquito y liquidación 2026',
                url: SITIO + '/calculadora-finiquito-liquidacion/',
                applicationCategory: 'FinanceApplication',
                operatingSystem: 'Web',
                inLanguage: 'es-MX',
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'MXN' },
                publisher: organizacion,
                description: 'Finiquito, liquidación, prima de antigüedad, salarios vencidos, indemnizaciones por riesgo de trabajo e ISR estimado según la LFT, con salario mínimo y UMA 2026.'
            },
            migas({ nombre: 'Calculadora de finiquito y liquidación', ruta: '/calculadora-finiquito-liquidacion/' }),
            faq(PREGUNTAS_LABORAL)
        ]
    }) + `
        <section class="sitio-hero sitio-hero-chico">
            <div class="sitio-ancho">
                <nav class="sitio-migas" aria-label="Ruta"><a href="/">Inicio</a> › Calculadora laboral</nav>
                <h1>Calculadora de finiquito y liquidación 2026</h1>
                <p class="sitio-lead">Conforme a la Ley Federal del Trabajo, con el salario mínimo y la UMA de 2026. Cada concepto con su fórmula y su artículo, más la estimación del ISR.</p>
            </div>
        </section>

        <section class="sitio-seccion sitio-calculadora" id="page-laboral">
            <div class="sitio-ancho">
            ${formularioCalculadora()}
            </div>
        </section>

        <section class="sitio-seccion sitio-alterna">
            <div class="sitio-ancho sitio-angosto">
                <h2>Qué calcula</h2>
                <ul class="sitio-lista">
                    <li><strong>Finiquito:</strong> salarios devengados, aguinaldo proporcional, vacaciones proporcionales por año de servicio y pendientes, prima vacacional y otras percepciones, con el salario base.</li>
                    <li><strong>Liquidación:</strong> indemnización constitucional de 3 meses con salario integrado, 20 días por año cuando la ley los da, prima de antigüedad topada y salarios vencidos con su tope de 12 meses e intereses.</li>
                    <li><strong>Otros supuestos:</strong> rescisión por causa del patrón, cierre de la empresa, reajuste por maquinaria, incapacidad, muerte y riesgos de trabajo (1,095 y 5,000 días, con el tope de 2 salarios mínimos de la zona).</li>
                    <li><strong>ISR:</strong> exenciones en UMA y tasa efectiva del artículo 95 de la Ley del ISR con la tarifa 2026.</li>
                </ul>
                <p>¿Llevas el juicio? <a href="${APP}?tour=1">Guarda el cálculo en el expediente</a>, agenda las audiencias y lleva los plazos en la misma herramienta.</p>
                <h2>Preguntas frecuentes</h2>
${faqHTML(PREGUNTAS_LABORAL)}
            </div>
        </section>
` + pie().replace('</body>', `    <script src="/docs/js/calculadora-laboral.js"></script>
    <script>window.addEventListener('load', () => prepararCalculadoraLaboral());</script>
</body>`);
}

// ==================== SITEMAP ====================

function sitemap() {
    const urls = [
        ['/', '1.0'],
        ['/calculadora-finiquito-liquidacion/', '0.9'],
        ['/estrados-tsj-quintana-roo/', '0.9'],
        ['/expedientes-pjf-quintana-roo/', '0.8'],
        ['/docs/', '0.7']
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, p]) => `    <url>
        <loc>${SITIO}${u}</loc>
        <lastmod>${ACTUALIZADO}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>${p}</priority>
    </url>`).join('\n')}
</urlset>
`;
}

// ==================== SALIDA ====================

function generar() {
    const cat = juzgadosTSJ();
    const pjf = organosPJFQuintanaRoo();
    return {
        'index.html': paginaInicio(cat, pjf),
        'estrados-tsj-quintana-roo/index.html': paginaEstrados(cat),
        'expedientes-pjf-quintana-roo/index.html': paginaPJF(pjf),
        'calculadora-finiquito-liquidacion/index.html': paginaCalculadora(),
        'sitemap.xml': sitemap()
    };
}

if (require.main === module) {
    for (const [ruta, contenido] of Object.entries(generar())) {
        const destino = path.join(RAIZ, ruta);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, contenido);
        console.log('✓', ruta);
    }
}

module.exports = { generar };
