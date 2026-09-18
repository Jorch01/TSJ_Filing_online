#!/usr/bin/env node
/**
 * Pruebas de que un pendiente con fecha SIEMPRE acaba en el calendario.
 *
 *   node test_pendientes_calendario.js
 *
 * Darlo de alta por el formulario ya lo agendaba, pero hay caminos por los que
 * un pendiente entra a la base sin pasar por ahí —un respaldo importado, lo
 * que baja de otro dispositivo, o pendientes de antes de que existiera el
 * vínculo— y su fecha se quedaba solo en la lista, sin llegar nunca al
 * calendario. De recogerlos se encarga sincronizarPendientesConCalendarioCore.
 *
 * También se comprueba que la hora no se pierde: "para el 20 a las 10:00" es
 * una cita a las diez, no un día completo.
 *
 * Corre sin dependencias: se carga el docs/js/acciones-core.js de verdad sobre
 * una base de datos simulada, así que si alguien cambia las reglas, falla.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, 'docs', 'js');

// ==================== BASE DE DATOS SIMULADA ====================
// Las mismas firmas que docs/js/database.js, lo justo para pendientes y eventos.

function crearSandbox() {
    let secuencia = 0;
    const nuevoId = () => ++secuencia;

    const estado = {
        pendientes: [],
        eventos: [],
        eliminaciones: [],
        refrescosUI: 0,
        sincronizaciones: 0
    };

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        Promise,
        Date,
        Map,
        Set,
        estado,
        nuevoId,

        // --- Capa de datos ---
        obtenerPendientes: async () => estado.pendientes.map(p => ({ ...p })),
        obtenerPendiente: async (id) => {
            const p = estado.pendientes.find(x => x.id === id);
            return p ? { ...p } : null;
        },
        agregarPendiente: async (p) => {
            const id = nuevoId();
            estado.pendientes.push({ ...p, id });
            return id;
        },
        actualizarPendiente: async (id, cambios) => {
            const p = estado.pendientes.find(x => x.id === id);
            if (!p) throw new Error('Pendiente no encontrado');
            Object.assign(p, cambios);
            return { ...p };
        },
        eliminarPendiente: async (id) => {
            estado.pendientes = estado.pendientes.filter(p => p.id !== id);
        },

        agregarEvento: async (ev) => {
            const id = nuevoId();
            estado.eventos.push({ ...ev, id });
            return id;
        },
        obtenerEventos: async () => estado.eventos.map(e => ({ ...e })),
        actualizarEvento: async (id, cambios) => {
            const e = estado.eventos.find(x => x.id === id);
            if (!e) throw new Error('Evento no encontrado');
            Object.assign(e, cambios);
            return { ...e };
        },
        eliminarEvento: async (id) => {
            estado.eliminaciones.push(id);
            estado.eventos = estado.eventos.filter(e => e.id !== id);
        },

        obtenerExpedientes: async () => [],
        obtenerExpediente: async () => null,

        // --- Ganchos de UI/sync (el núcleo los llama con guardas typeof) ---
        cargarPendientes: async () => { estado.refrescosUI++; },
        cargarExpedientes: async () => {},
        cargarEventos: async () => {},
        cargarNotas: async () => {},
        cargarEstadisticas: async () => {},
        renderizarCalendario: () => {},
        marcarYSincronizar: async () => { estado.sincronizaciones++; }
    };

    sandbox.window = sandbox;
    vm.createContext(sandbox);

    vm.runInContext(fs.readFileSync(path.join(JS, 'acciones-core.js'), 'utf8'),
        sandbox, { filename: 'acciones-core.js' });

    return { sandbox, estado };
}

// Se saca de app.js la función real que decide si lo escrito lleva hora, para
// que renombrarla o cambiar su criterio se note aquí.
function cargarTieneHora() {
    const fuente = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    const lineas = fuente.split('\n');
    const inicio = lineas.findIndex(l => /^function _pendienteFechaTieneHora\s*\(/.test(l));
    if (inicio === -1) throw new Error('No se encontró _pendienteFechaTieneHora en app.js (¿se renombró?)');
    const fin = lineas.findIndex((l, i) => i > inicio && /^}/.test(l));
    const cuerpo = lineas.slice(inicio, fin + 1).join('\n');
    const ctx = { module: {} };
    vm.createContext(ctx);
    vm.runInContext(cuerpo + '\nmodule.exports = _pendienteFechaTieneHora;', ctx,
        { filename: 'app.js:_pendienteFechaTieneHora' });
    return ctx.module.exports;
}

// ==================== ARNÉS ====================

let pasadas = 0;
const fallos = [];

function verificar(descripcion, condicion, detalle) {
    if (condicion) { pasadas++; return; }
    fallos.push(descripcion + (detalle ? `\n      ${detalle}` : ''));
}

function igual(descripcion, real, esperado) {
    verificar(descripcion, JSON.stringify(real) === JSON.stringify(esperado),
        `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
}

const EN_DOS_DIAS = new Date(Date.now() + 2 * 86400000);
const p2 = n => String(n).padStart(2, '0');
const fechaConHora = (h, m) => {
    const d = new Date(EN_DOS_DIAS);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
};

// ==================== PRUEBAS ====================

// La hora escrita en el formulario decide si el pendiente es una cita o un día
// entero. El <input type="datetime-local"> siempre devuelve hora, así que sin
// este criterio "para el 20" se agendaba como una cita a medianoche.
function pruebaLecturaDeLaHora() {
    const tieneHora = cargarTieneHora();
    igual('hora: "2026-09-20T10:30" lleva hora', tieneHora('2026-09-20T10:30'), true);
    igual('hora: "2026-09-20T00:00" es día completo', tieneHora('2026-09-20T00:00'), false);
    igual('hora: "2026-09-20T00:01" ya es una hora', tieneHora('2026-09-20T00:01'), true);
    igual('hora: con segundos también se lee', tieneHora('2026-09-20T09:15:00'), true);
    igual('hora: sin fecha no hay hora', tieneHora(''), false);
    igual('hora: un valor nulo no revienta', tieneHora(null), false);
}

// Lo que el formulario manda al núcleo tiene que llegar tal cual al evento.
async function pruebaLaHoraLlegaAlCalendario() {
    const { sandbox, estado } = crearSandbox();

    await sandbox.crearPendienteCore({
        titulo: 'Audiencia de pruebas',
        fechaLimite: fechaConHora(10, 30),
        todoElDia: false
    });

    igual('agenda: el pendiente con hora crea su evento', estado.eventos.length, 1);
    igual('agenda: y NO se agenda como día completo', estado.eventos[0].todoElDia, false);
    igual('agenda: conserva la hora exacta',
        new Date(estado.eventos[0].fechaInicio).getHours(), 10);

    await sandbox.crearPendienteCore({
        titulo: 'Vence el plazo',
        fechaLimite: fechaConHora(0, 0),
        todoElDia: true
    });

    igual('agenda: sin hora se agenda como día completo', estado.eventos[1].todoElDia, true);
}

// El caso que motivó todo: pendientes que ya estaban en la base con su fecha
// pero sin nada en el calendario (respaldo importado, sync, versión anterior).
async function pruebaRecogeLosQueSeQuedaronFuera() {
    const { sandbox, estado } = crearSandbox();

    // Entra POR DEBAJO del núcleo, como lo hacen la importación y el sync.
    const idViejo = await sandbox.agregarPendiente({
        titulo: 'Contestar demanda',
        fechaLimite: fechaConHora(0, 0),
        completado: false,
        eventoId: null
    });
    // Uno sin fecha: no tiene nada que hacer en el calendario.
    await sandbox.agregarPendiente({
        titulo: 'Leer el expediente',
        fechaLimite: null,
        completado: false,
        eventoId: null
    });

    igual('rescate: de entrada el calendario está vacío', estado.eventos.length, 0);

    const resumen = await sandbox.sincronizarPendientesConCalendarioCore();

    igual('rescate: se agenda el que tenía fecha', resumen.creados, 1);
    igual('rescate: y solo ese', estado.eventos.length, 1);
    igual('rescate: el evento apunta de vuelta al pendiente',
        estado.eventos[0].pendienteId, idViejo);
    igual('rescate: y el pendiente al evento',
        estado.pendientes.find(p => p.id === idViejo).eventoId, estado.eventos[0].id);
    igual('rescate: hereda el título del pendiente',
        estado.eventos[0].titulo, 'Contestar demanda');

    // Sin el dato todoElDia guardado (pendientes antiguos), las 00:00 se leen
    // como día señalado y no como una cita a medianoche.
    igual('rescate: una fecha a las 00:00 se agenda como día completo',
        estado.eventos[0].todoElDia, true);
}

// Un pendiente antiguo con hora tampoco debe acabar como "todo el día".
async function pruebaRescateConservaLaHora() {
    const { sandbox, estado } = crearSandbox();

    await sandbox.agregarPendiente({
        titulo: 'Comparecencia',
        fechaLimite: fechaConHora(9, 0),
        completado: false,
        eventoId: null
    });

    await sandbox.sincronizarPendientesConCalendarioCore();

    igual('rescate: con hora NO se agenda como día completo',
        estado.eventos[0].todoElDia, false);
    igual('rescate: y respeta la hora que tenía',
        new Date(estado.eventos[0].fechaInicio).getHours(), 9);
}

// Repasar dos veces no puede duplicar: el arranque, la importación y el sync
// llaman a esto, y en un mismo rato pueden encadenarse.
async function pruebaNoDuplica() {
    const { sandbox, estado } = crearSandbox();

    await sandbox.agregarPendiente({
        titulo: 'Presentar alegatos',
        fechaLimite: fechaConHora(0, 0),
        completado: false,
        eventoId: null
    });

    await sandbox.sincronizarPendientesConCalendarioCore();
    const segundo = await sandbox.sincronizarPendientesConCalendarioCore();
    const tercero = await sandbox.sincronizarPendientesConCalendarioCore();

    igual('repaso: la segunda vuelta no crea nada', segundo.creados, 0);
    igual('repaso: la tercera tampoco', tercero.creados, 0);
    igual('repaso: sigue habiendo un solo evento', estado.eventos.length, 1);
}

// Al importar un respaldo el evento llegaba sin su vínculo. Si el repaso
// creara otro al lado, el usuario vería la misma fecha dos veces.
async function pruebaReenganchaEnVezDeDuplicar() {
    const { sandbox, estado } = crearSandbox();

    const idPendiente = await sandbox.agregarPendiente({
        titulo: 'Audiencia inicial',
        fechaLimite: fechaConHora(0, 0),
        completado: false,
        eventoId: null            // el vínculo se perdió
    });
    const idEvento = await sandbox.agregarEvento({
        titulo: 'Audiencia inicial',
        tipo: 'recordatorio',
        fechaInicio: fechaConHora(0, 0),
        todoElDia: true,
        pendienteId: idPendiente   // el evento sí sabe de quién es
    });

    const resumen = await sandbox.sincronizarPendientesConCalendarioCore();

    igual('reenganche: no se crea un evento nuevo', resumen.creados, 0);
    igual('reenganche: se reengancha el que ya estaba', resumen.revinculados, 1);
    igual('reenganche: sigue habiendo una sola fecha', estado.eventos.length, 1);
    igual('reenganche: el pendiente apunta al evento de siempre',
        estado.pendientes.find(p => p.id === idPendiente).eventoId, idEvento);
}

// Un pendiente que ya se terminó no debe seguir ocupando sitio en el
// calendario, aunque su evento sobreviviera a una sincronización.
async function pruebaRetiraLoTerminado() {
    const { sandbox, estado } = crearSandbox();

    const idPendiente = await sandbox.agregarPendiente({
        titulo: 'Ya está hecho',
        fechaLimite: fechaConHora(0, 0),
        completado: true,
        eventoId: null
    });
    const idEvento = await sandbox.agregarEvento({
        titulo: 'Ya está hecho',
        tipo: 'recordatorio',
        fechaInicio: fechaConHora(0, 0),
        todoElDia: true,
        pendienteId: idPendiente     // es su espejo, y lo demuestra
    });
    await sandbox.actualizarPendiente(idPendiente, { eventoId: idEvento });

    const resumen = await sandbox.sincronizarPendientesConCalendarioCore();

    igual('terminados: se retira su fecha del calendario', resumen.retirados, 1);
    igual('terminados: el calendario queda limpio', estado.eventos.length, 0);
    igual('terminados: y el pendiente ya no apunta a nada',
        estado.pendientes.find(p => p.id === idPendiente).eventoId, null);
}

// Un eventoId heredado de un respaldo viejo puede haber caído sobre el id de
// una audiencia real. Borrarla no tiene vuelta atrás; soltar el vínculo sí.
async function pruebaNoBorraLoQueNoEsSuEspejo() {
    const { sandbox, estado } = crearSandbox();

    const idAudiencia = await sandbox.agregarEvento({
        titulo: 'Audiencia de desahogo de pruebas',
        tipo: 'audiencia',
        fechaInicio: fechaConHora(9, 0),
        todoElDia: false
        // sin pendienteId: NO es el espejo de nadie
    });
    const idPendiente = await sandbox.agregarPendiente({
        titulo: 'Pendiente terminado con un vínculo heredado',
        fechaLimite: fechaConHora(0, 0),
        completado: true,
        eventoId: idAudiencia        // el vínculo apunta donde no debe
    });

    const resumen = await sandbox.sincronizarPendientesConCalendarioCore();

    igual('prudencia: no se borra un evento que no es su espejo', resumen.retirados, 0);
    igual('prudencia: la audiencia sigue en el calendario', estado.eventos.length, 1);
    igual('prudencia: intacta', estado.eventos[0].titulo, 'Audiencia de desahogo de pruebas');
    igual('prudencia: pero el vínculo equivocado se suelta',
        estado.pendientes.find(p => p.id === idPendiente).eventoId, null);
}

// Un evento puesto a mano desde el calendario no se toca: el repaso solo
// rellena huecos, no reescribe lo que alguien ya ajustó.
async function pruebaNoPisaLoQueYaEstaba() {
    const { sandbox, estado } = crearSandbox();

    const idEvento = await sandbox.agregarEvento({
        titulo: 'Audiencia — sala 3, llevar copias',
        tipo: 'audiencia',
        fechaInicio: fechaConHora(11, 0),
        todoElDia: false
    });
    await sandbox.agregarPendiente({
        titulo: 'Audiencia',
        fechaLimite: fechaConHora(9, 0),
        completado: false,
        eventoId: idEvento
    });

    await sandbox.sincronizarPendientesConCalendarioCore();

    igual('respeto: el evento ajustado a mano conserva su título',
        estado.eventos[0].titulo, 'Audiencia — sala 3, llevar copias');
    igual('respeto: y su hora', new Date(estado.eventos[0].fechaInicio).getHours(), 11);
}

// Si no hay nada que arreglar, no se molesta a la UI ni a la nube: esto corre
// en CADA arranque y en cada sincronización.
async function pruebaSilenciosaCuandoNoHayNadaQueHacer() {
    const { sandbox, estado } = crearSandbox();

    await sandbox.agregarPendiente({
        titulo: 'Sin fecha',
        fechaLimite: null,
        completado: false,
        eventoId: null
    });

    estado.sincronizaciones = 0;
    estado.refrescosUI = 0;
    const resumen = await sandbox.sincronizarPendientesConCalendarioCore();

    igual('silencio: no hubo nada que crear', resumen.creados, 0);
    igual('silencio: no se repinta la interfaz', estado.refrescosUI, 0);
    igual('silencio: no se sube nada a la nube', estado.sincronizaciones, 0);
}

// El sync ya está en mitad de una vuelta cuando llama: si el repaso disparara
// otra subida, chocaría con la que está en curso.
async function pruebaNoSubeCuandoElSyncLoPide() {
    const { sandbox, estado } = crearSandbox();

    await sandbox.agregarPendiente({
        titulo: 'Llegó de otro dispositivo',
        fechaLimite: fechaConHora(0, 0),
        completado: false,
        eventoId: null
    });

    estado.sincronizaciones = 0;
    const resumen = await sandbox.sincronizarPendientesConCalendarioCore({ sincronizar: false });

    igual('desde sync: el evento se crea igual', resumen.creados, 1);
    igual('desde sync: pero no se dispara otra subida', estado.sincronizaciones, 0);

    // Y desde el arranque, donde nadie está sincronizando, sí se sube.
    const otro = crearSandbox();
    await otro.sandbox.agregarPendiente({
        titulo: 'Arranque',
        fechaLimite: fechaConHora(0, 0),
        completado: false,
        eventoId: null
    });
    otro.estado.sincronizaciones = 0;
    await otro.sandbox.sincronizarPendientesConCalendarioCore();
    igual('desde el arranque: sí se sube lo que se agendó',
        otro.estado.sincronizaciones > 0, true);
}

// Que falle la base de datos no puede tumbar el arranque ni el sync.
async function pruebaNoTumbaNada() {
    const { sandbox } = crearSandbox();
    sandbox.obtenerPendientes = async () => { throw new Error('base caída'); };
    // El fallo se registra en consola a propósito; aquí se calla para no
    // ensuciar la salida de las pruebas con un error que estamos provocando.
    const quejas = [];
    sandbox.console = { ...console, error: (...a) => quejas.push(a) };

    let resumen = null;
    try {
        resumen = await sandbox.sincronizarPendientesConCalendarioCore();
    } catch (e) {
        verificar('robustez: un fallo de la base no se propaga', false, e.message);
        return;
    }
    igual('robustez: un fallo de la base no se propaga', resumen, { creados: 0, revinculados: 0, retirados: 0 });
    verificar('robustez: pero queda anotado en la consola', quejas.length > 0);
}

// ==================== EJECUCIÓN ====================

(async () => {
    console.log('\n  Pendientes con fecha → calendario\n');

    pruebaLecturaDeLaHora();
    await pruebaLaHoraLlegaAlCalendario();
    await pruebaRecogeLosQueSeQuedaronFuera();
    await pruebaRescateConservaLaHora();
    await pruebaNoDuplica();
    await pruebaReenganchaEnVezDeDuplicar();
    await pruebaRetiraLoTerminado();
    await pruebaNoBorraLoQueNoEsSuEspejo();
    await pruebaNoPisaLoQueYaEstaba();
    await pruebaSilenciosaCuandoNoHayNadaQueHacer();
    await pruebaNoSubeCuandoElSyncLoPide();
    await pruebaNoTumbaNada();

    console.log(`  ${pasadas} pasadas, ${fallos.length} fallidas\n`);
    if (fallos.length > 0) {
        fallos.forEach(f => console.log('   ✗ ' + f));
        process.exit(1);
    }
    console.log('  ✓ Ninguna fecha se queda fuera del calendario\n');
})();
