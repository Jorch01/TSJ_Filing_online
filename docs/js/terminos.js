/**
 * Términos y condiciones de los planes Premium.
 *
 * Un solo texto para dos lugares: la ventana que la app muestra antes de
 * contratar o activar un plan (hay que aceptarlos) y la página pública
 * /terminos-y-condiciones/, que genera herramientas/generar-sitio.js.
 *
 * Al cambiar el texto, cambia VERSION: quien aceptó una versión anterior
 * tendrá que aceptar la nueva antes de su próxima contratación.
 */
(function (global) {
    'use strict';

    const VERSION = '2026-10-28';
    const VIGENTES_DESDE = '28 de octubre de 2026';

    const SECCIONES = [
        ['1. Partes y aceptación', [
            'Estos Términos y condiciones regulan la contratación y el uso de los planes Premium de TSJ Filing Online (la "Herramienta"), desarrollada y operada por Empírica Legal Lab, sus titulares, socios, representantes, empleados y colaboradores ("Empírica"). Quien solicita, paga o activa un plan es el "Usuario".',
            'El Usuario los acepta por medios electrónicos al marcar la casilla de aceptación en la Herramienta, al enviar el mensaje de solicitud de un plan o al pagarlo, lo que ocurra primero. La Herramienta guarda la versión y la fecha de la aceptación, y el mensaje de solicitud la menciona. Quien no esté de acuerdo no debe contratar.'
        ]],
        ['2. Objeto', [
            'Empírica otorga al Usuario una licencia de uso personal, no exclusiva, intransferible y revocable de las funciones Premium de la Herramienta, por el plazo contratado y vinculada al código de activación y al dispositivo en que se active.',
            'La licencia no transmite al Usuario derecho alguno sobre el programa, su código, sus contenidos, sus marcas o sus bases de datos, que son y seguirán siendo de Empírica.'
        ]],
        ['3. Precio, pago y activación', [
            'Los precios son los publicados en la Herramienta al momento de solicitar el plan, en pesos mexicanos. El pago se hace por los medios y con los datos que Empírica indique al Usuario por WhatsApp o correo electrónico.',
            'El plan se activa cuando Empírica confirma el pago y entrega el código de activación. Empírica puede cambiar sus precios en cualquier momento; el cambio no afecta los planes ya pagados.',
            'Quien necesite factura debe pedirla con sus datos fiscales a frida@empirica.mx dentro del mes en que pagó.'
        ]],
        ['4. Vigencia y término', [
            'El plan dura 3, 6 o 12 meses, según el contratado, contados desde su activación. El plazo corre de forma continua, se use o no la Herramienta, y no admite pausas, prórrogas, cambios de titular ni prorrateos.',
            'Al cumplirse el plazo, el plan termina de pleno derecho, sin necesidad de aviso ni de declaración judicial, y la Herramienta vuelve a las condiciones del plan gratuito. Los planes no se renuevan solos: para continuar hay que contratar uno nuevo, con los precios y términos vigentes en ese momento.'
        ]],
        ['5. Sin devoluciones', [
            'Las cuotas pagadas no son reembolsables, ni total ni parcialmente, en ningún caso: entre otros, cancelación o abandono anticipado por el Usuario, falta de uso, cambio o pérdida del dispositivo, desinstalación, borrado de datos o terminación del plan por incumplimiento de estos términos.'
        ]],
        ['6. Continuidad del servicio', [
            'Empírica prestará el servicio contratado de forma continua hasta el término del plan, sin más interrupciones que las derivadas de caso fortuito o fuerza mayor.',
            'Se consideran caso fortuito o fuerza mayor, entre otros: las fallas, cambios, bloqueos, suspensiones o restricciones de los sistemas de terceros de los que dependen las funciones de la Herramienta (Tribunal Superior de Justicia de Quintana Roo, Poder Judicial de la Federación, Instituto Mexicano de la Propiedad Industrial, Secretaría del Trabajo, Google, Cloudflare, GitHub y proveedores de internet o de telecomunicaciones); los ataques informáticos; las fallas eléctricas; los actos de autoridad, y los desastres naturales. También el mantenimiento indispensable para la seguridad o la continuidad de la Herramienta, que Empírica procurará hacer en el menor tiempo posible.',
            'Estas interrupciones no dan lugar a responsabilidad, compensación, descuento ni prórroga del plazo.'
        ]],
        ['7. Naturaleza de la información', [
            'La Herramienta es un auxiliar de trabajo. Consulta y organiza información de fuentes públicas externas que Empírica no controla, por lo que no garantiza que sea exacta, completa, oportuna ni que esté disponible.',
            'Nada de lo que muestra la Herramienta, incluidos los cálculos, las lecturas de acuerdos hechas con inteligencia artificial y los estudios de viabilidad de marca, constituye asesoría jurídica ni sustituye la revisión de las fuentes oficiales. En particular, los estudios de viabilidad dependen por completo de búsquedas en sistemas externos, nunca son concluyentes y, antes de usarlos para un trámite de registro, debe consultarse a un especialista.',
            'El Usuario es el único responsable de verificar la información, de sus plazos, términos y actuaciones, y de las decisiones que tome con base en ella.'
        ]],
        ['8. Limitación de responsabilidad', [
            'En la máxima medida que permita la ley, Empírica no responde por daños o perjuicios directos o indirectos, lucro cesante, pérdida de datos, plazos o términos vencidos, actuaciones omitidas, negativas de registro u otras consecuencias derivadas del uso de la Herramienta, de su interrupción o de la información obtenida con ella.',
            'En cualquier caso, la responsabilidad total de Empírica frente al Usuario no excederá el monto efectivamente pagado por el plan vigente, salvo dolo o lo que la ley disponga como irrenunciable.'
        ]],
        ['9. Datos del Usuario y respaldos', [
            'La información que el Usuario captura se guarda en su propio dispositivo y, si activa la sincronización, en el almacenamiento que él mismo configure. El Usuario es responsable de hacer y conservar sus respaldos; Empírica no responde por la pérdida de información.',
            'Los datos que el Usuario comparte para contratar (nombre, teléfono, correo, comprobante de pago y datos fiscales) se usan solo para gestionar su plan y su facturación.'
        ]],
        ['10. Uso permitido', [
            'El Usuario se obliga a no compartir, ceder ni revender su código de activación; a no eludir o manipular los límites del plan gratuito ni los controles de la Herramienta; a no hacer consultas automatizadas o masivas a través de ella; a no copiar, descompilar o modificar la Herramienta, y a no usarla para fines ilícitos.',
            'Si incumple, Empírica puede suspender o cancelar su plan de inmediato, sin necesidad de declaración judicial y sin devolución alguna, además de ejercer las acciones que correspondan.'
        ]],
        ['11. Cambios a estos términos', [
            'Empírica puede modificar estos términos y publicará siempre la versión vigente. Los cambios aplican a las contrataciones y activaciones posteriores a su publicación; la Herramienta pedirá aceptar la nueva versión antes de contratar.'
        ]],
        ['12. Ley aplicable y jurisdicción', [
            'Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para su interpretación y cumplimiento, las partes se someten a los tribunales competentes de Cancún, Quintana Roo, y renuncian a cualquier otro fuero que pudiera corresponderles por su domicilio presente o futuro, sin perjuicio de los derechos que la ley reconozca como irrenunciables.'
        ]],
        ['13. Contacto', [
            'Para dudas sobre estos términos o sobre un plan: WhatsApp 998 139 9930 o jorge_clemente@empirica.mx.'
        ]]
    ];

    const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    /** El texto en HTML: un h2 (o el nivel que se pida) por sección. */
    function html(nivel) {
        const h = 'h' + (nivel || 2);
        return SECCIONES.map(([titulo, parrafos]) =>
            '<section class="terminos-seccion"><' + h + '>' + esc(titulo) + '</' + h + '>' +
            parrafos.map(p => '<p>' + esc(p) + '</p>').join('') + '</section>').join('');
    }

    const TERMINOS = { VERSION, VIGENTES_DESDE, SECCIONES, html };
    if (typeof module !== 'undefined' && module.exports) module.exports = TERMINOS;
    if (typeof window !== 'undefined') global.TERMINOS = TERMINOS;
})(typeof window !== 'undefined' ? window : globalThis);
