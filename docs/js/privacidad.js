/**
 * Aviso de privacidad: lo que la app y el sitio necesitan saber de él.
 *
 * El texto completo vive en docs/legal/aviso-privacidad-integral.md y
 * herramientas/generar-sitio.js lo publica en /aviso-de-privacidad/. Aquí van
 * la versión, la ruta y los textos cortos que la app enseña:
 *   - el aviso simplificado (al abrir la app por primera vez o cuando cambia la
 *     versión, art. 16, fr. II de la LFPDPPP);
 *   - la casilla de consentimiento expreso para los datos financieros y
 *     fiscales al contratar o activar un plan (art. 7);
 *   - la ventana previa al primer uso de la IA.
 *
 * Al cambiar el aviso, cambia VERSION: la app vuelve a enseñar el aviso
 * simplificado y pide otra vez la casilla en la siguiente contratación.
 */
(function (global) {
    'use strict';

    const VERSION = '2026-11-12';
    const VIGENTE_DESDE = '12 de noviembre de 2026';
    const RUTA = '/aviso-de-privacidad/';
    const URL = 'https://tsjia.empirica.mx' + RUTA;
    const RESPONSABLE = 'Empírica Legal Lab, S.A.S. de C.V.';
    const CORREO = 'jorge_clemente@empirica.mx';

    /** Versión corta del aviso simplificado: la que cabe en un aviso al pie. */
    const CORTO = RESPONSABLE + ' trata tus datos para gestionar tu plan y tu licencia, aplicar los límites del plan ' +
        'gratuito y, si no lo desactivas, para estadísticas de uso. Los datos de tus expedientes se quedan en tu ' +
        'dispositivo, salvo que actives la sincronización cifrada.';

    /** Lo que se añade a la casilla de los términos al contratar o activar. */
    const CONSENTIMIENTO = 'He leído el Aviso de privacidad (versión ' + VERSION + ') y consiento el tratamiento de mis ' +
        'datos personales, incluidos los financieros y fiscales necesarios para el pago y la facturación de mi plan.';

    const IA = {
        titulo: 'Uso de inteligencia artificial',
        parrafos: [
            'Para leer un acuerdo, transcribir tu voz o atender una orden del asistente, la app envía el texto completo del acuerdo, el audio y, en el asistente, la lista de tus expedientes y tu agenda a Google (API de Gemini) con tu propia clave. Empírica no recibe esa información.',
            'Según los términos de Google, en el nivel gratuito Google usa lo que envías para mejorar sus productos, revisores humanos pueden leerlo, y Google pide no enviar datos personales ni confidenciales. En el nivel de pago no lo usa para entrenar sus modelos.',
            'Los acuerdos suelen contener datos de tus clientes y de terceros, y a veces datos sensibles. Como responsable de esos datos y obligado al secreto profesional, decides tú si los envías. Para material de clientes, te recomendamos una clave de pago.'
        ],
        casilla: 'Entiendo qué se envía y a quién, y quiero usar la IA con mi clave.'
    };

    const PRIVACIDAD = { VERSION, VIGENTE_DESDE, RUTA, URL, RESPONSABLE, CORREO, CORTO, CONSENTIMIENTO, IA };

    if (typeof module !== 'undefined' && module.exports) module.exports = PRIVACIDAD;
    else global.PRIVACIDAD = PRIVACIDAD;
})(typeof window !== 'undefined' ? window : this);
