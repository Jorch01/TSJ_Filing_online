// ==================== SINCRONIZACIÓN SIMPLE VIA GOOGLE SHEETS ====================
// Los datos se cifran localmente y se almacenan en tu Google Sheet
// El usuario solo necesita su código premium - nada más

// ==================== ESTADO ====================
let syncState = {
    lastSync: null,
    syncInProgress: false
};

// ==================== CIFRADO AES-256-GCM ====================
async function generarClaveDesdePassword(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function cifrarDatos(datos, codigoPremium) {
    try {
        const salt = 'TSJ_Filing_Sync_v2';
        const clave = await generarClaveDesdePassword(codigoPremium, salt);

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();
        const datosBytes = encoder.encode(JSON.stringify(datos));

        const datosCifrados = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            clave,
            datosBytes
        );

        const resultado = new Uint8Array(iv.length + datosCifrados.byteLength);
        resultado.set(iv);
        resultado.set(new Uint8Array(datosCifrados), iv.length);

        return btoa(String.fromCharCode(...resultado));
    } catch (error) {
        console.error('Error al cifrar:', error);
        throw new Error('Error al cifrar datos');
    }
}

async function descifrarDatos(datosCifradosBase64, codigoPremium) {
    try {
        const salt = 'TSJ_Filing_Sync_v2';
        const clave = await generarClaveDesdePassword(codigoPremium, salt);

        const datosCompletos = Uint8Array.from(atob(datosCifradosBase64), c => c.charCodeAt(0));
        const iv = datosCompletos.slice(0, 12);
        const datosCifrados = datosCompletos.slice(12);

        const datosDescifrados = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            clave,
            datosCifrados
        );

        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(datosDescifrados));
    } catch (error) {
        console.error('Error al descifrar:', error);
        throw new Error('Error al descifrar. ¿Código incorrecto?');
    }
}

// ==================== SINCRONIZACIÓN ====================
async function sincronizarDatos() {
    // Verificar premium
    if (!estadoPremium.activo || !estadoPremium.codigo) {
        mostrarToast('Necesitas una licencia Premium activa', 'warning');
        return;
    }

    if (syncState.syncInProgress) {
        mostrarToast('Sincronización en progreso...', 'info');
        return;
    }

    syncState.syncInProgress = true;
    actualizarUISync('syncing');

    try {
        // 1. Obtener datos remotos (si existen)
        let datosRemotos = null;
        try {
            const remotos = await descargarDatosRemotos();
            if (remotos) {
                datosRemotos = await descifrarDatos(remotos, estadoPremium.codigo);
            }
        } catch (e) {
            console.log('No hay datos remotos o error:', e.message);
        }

        // 2. Obtener datos locales
        const datosLocales = await obtenerTodosLosDatos();
        datosLocales.metadata = {
            ultimaModificacion: Date.now(),
            dispositivo: obtenerDeviceId(),
            version: '2.0'
        };

        // 3. Aplicar eliminaciones remotas primero (si hay datos remotos)
        let eliminadosAplicados = 0;
        if (datosRemotos && datosRemotos.eliminados && datosRemotos.eliminados.length > 0) {
            eliminadosAplicados = await aplicarEliminacionesRemotas(datosRemotos.eliminados);
            if (eliminadosAplicados > 0) {
                console.log(`Se eliminaron ${eliminadosAplicados} expediente(s) por sincronización remota`);
            }
        }

        // 4. Obtener datos locales actualizados (después de aplicar eliminaciones)
        const datosLocalesActualizados = await obtenerTodosLosDatos();
        datosLocalesActualizados.metadata = datosLocales.metadata;

        // 5. Fusionar datos
        let datosFinales;
        let huboDuplicados = false;
        if (datosRemotos && datosRemotos.metadata) {
            datosFinales = fusionarDatos(datosLocalesActualizados, datosRemotos);
            // Aplicar datos fusionados localmente
            await aplicarDatosLocalmente(datosFinales);

            // Verificar si hubo duplicados fusionados
            huboDuplicados = reporteFusionDuplicados.expedientesFusionados.length > 0;

            if (eliminadosAplicados > 0) {
                mostrarToast(`Sincronización completada. ${eliminadosAplicados} expediente(s) eliminado(s)`, 'success');
            } else if (huboDuplicados) {
                mostrarToast('Sincronización completada con fusión de duplicados', 'success');
            } else {
                mostrarToast('Datos sincronizados desde otro dispositivo', 'success');
            }
        } else {
            datosFinales = datosLocalesActualizados;
        }

        // 4. Subir datos cifrados
        const datosCifrados = await cifrarDatos(datosFinales, estadoPremium.codigo);
        await subirDatosRemotos(datosCifrados);

        syncState.lastSync = Date.now();
        localStorage.setItem('sync_last_sync', syncState.lastSync.toString());

        actualizarUISync('success');

    } catch (error) {
        console.error('Error en sincronización:', error);
        actualizarUISync('error', error.message);
        mostrarToast('Error: ' + error.message, 'error');
    } finally {
        syncState.syncInProgress = false;
    }
}

// Función auxiliar para fetch con timeout y reintentos
async function fetchConReintentos(url, opciones = {}, maxReintentos = 3) {
    const timeout = opciones.timeout || 30000; // 30 segundos por defecto

    for (let intento = 0; intento <= maxReintentos; intento++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                ...opciones,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;
        } catch (error) {
            const esErrorRed = error.name === 'TypeError' ||
                               error.name === 'AbortError' ||
                               error.message.includes('NetworkError') ||
                               error.message.includes('Failed to fetch') ||
                               error.message.includes('Load failed') ||
                               error.message.includes('network');

            if (esErrorRed && intento < maxReintentos) {
                // Esperar con backoff exponencial: 2s, 4s, 8s
                const espera = Math.pow(2, intento + 1) * 1000;
                console.log(`Reintentando en ${espera/1000}s (intento ${intento + 1}/${maxReintentos})...`);
                await new Promise(r => setTimeout(r, espera));
                continue;
            }

            // Dar mensaje más amigable para errores de red
            if (esErrorRed) {
                throw new Error('No se pudo conectar. Verifica tu conexión a internet e intenta de nuevo.');
            }
            throw error;
        }
    }
}

// Descargar datos del servidor
async function descargarDatosRemotos() {
    const url = `${PREMIUM_CONFIG.apiUrl}?action=obtener_sync&codigo=${encodeURIComponent(estadoPremium.codigo)}`;

    try {
        const response = await fetchConReintentos(url, {
            method: 'GET',
            timeout: 30000
        });
        const texto = await response.text();

        // Intentar parsear JSON
        let resultado;
        try {
            resultado = JSON.parse(texto);
        } catch (e) {
            console.error('Respuesta no es JSON:', texto);
            throw new Error('Respuesta inválida del servidor');
        }

        if (resultado.error) {
            throw new Error(resultado.mensaje || 'Error del servidor');
        }

        if (resultado.success && resultado.datos) {
            return resultado.datos;
        }
        return null;
    } catch (error) {
        console.error('Error descargando datos:', error);
        throw error;
    }
}

// Subir datos al servidor (usando POST para datos grandes)
async function subirDatosRemotos(datosCifrados) {
    const url = PREMIUM_CONFIG.apiUrl;

    try {
        const response = await fetchConReintentos(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                action: 'guardar_sync',
                codigo: estadoPremium.codigo,
                datos: datosCifrados
            }),
            timeout: 60000 // 60 segundos para subida (datos grandes)
        });

        const texto = await response.text();

        let resultado;
        try {
            resultado = JSON.parse(texto);
        } catch (e) {
            console.error('Respuesta no es JSON:', texto);
            throw new Error('Respuesta inválida del servidor');
        }

        if (!resultado.success) {
            throw new Error(resultado.mensaje || 'Error al guardar en servidor');
        }
        return resultado;
    } catch (error) {
        console.error('Error subiendo datos:', error);
        throw error;
    }
}

// Fusionar datos locales y remotos
function fusionarDatos(local, remoto) {
    // Fusionar eliminados primero (unir ambas listas)
    const eliminadosFusionados = fusionarEliminados(
        local.eliminados || [],
        remoto.eliminados || []
    );

    // Crear set de claves eliminadas para filtrar
    const clavesEliminadas = new Set(eliminadosFusionados.map(e => e.clave));

    const resultado = {
        expedientes: fusionarExpedientes(
            local.expedientes || [],
            remoto.expedientes || [],
            clavesEliminadas
        ),
        notas: fusionarNotas(local.notas || [], remoto.notas || []),
        eventos: fusionarEventos(local.eventos || [], remoto.eventos || []),
        eliminados: eliminadosFusionados,
        metadata: local.metadata
    };
    return resultado;
}

// Fusionar listas de eliminados
function fusionarEliminados(locales, remotos) {
    const mapa = new Map();

    // Agregar remotos primero
    for (const e of remotos) {
        mapa.set(e.clave, e);
    }

    // Agregar/actualizar con locales (los más recientes ganan)
    for (const e of locales) {
        const existente = mapa.get(e.clave);
        if (!existente || new Date(e.fecha) > new Date(existente.fecha)) {
            mapa.set(e.clave, e);
        }
    }

    return Array.from(mapa.values());
}

// Generar clave única para expediente (basada en contenido, no ID)
function claveExpediente(exp) {
    const numero = (exp.numero || '').trim().toLowerCase();
    const nombre = (exp.nombre || '').trim().toLowerCase();
    const juzgado = (exp.juzgado || '').trim().toLowerCase();
    return `${numero}|${nombre}|${juzgado}`;
}

// ==================== DETECCIÓN Y FUSIÓN INTELIGENTE DE DUPLICADOS ====================

// Normalizar texto para comparación
function normalizarTexto(texto) {
    if (!texto) return '';
    return texto.toString().trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quitar acentos
        .replace(/[^a-z0-9]/g, ''); // Solo alfanuméricos
}

// Normalizar número de expediente (extraer solo dígitos y año)
function normalizarNumeroExpediente(numero) {
    if (!numero) return '';
    // Extraer patrón común: números/año o números-año
    const match = numero.match(/(\d+)[\/\-]?(\d{2,4})?/);
    if (match) {
        const num = match[1];
        const year = match[2] || '';
        return `${num}${year}`;
    }
    return numero.replace(/[^0-9]/g, '');
}

// Calcular similitud entre dos strings (algoritmo de Dice coefficient)
function calcularSimilitud(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = normalizarTexto(str1);
    const s2 = normalizarTexto(str2);

    if (s1 === s2) return 1;
    if (s1.length < 2 || s2.length < 2) return 0;

    const bigrams1 = new Set();
    for (let i = 0; i < s1.length - 1; i++) {
        bigrams1.add(s1.substring(i, i + 2));
    }

    let matches = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        if (bigrams1.has(s2.substring(i, i + 2))) {
            matches++;
        }
    }

    return (2 * matches) / (s1.length - 1 + s2.length - 1);
}

// Detectar si dos expedientes son potencialmente duplicados
function sonExpedientesDuplicados(exp1, exp2) {
    // Misma clave exacta = definitivamente duplicados
    if (claveExpediente(exp1) === claveExpediente(exp2)) {
        return { esDuplicado: true, confianza: 1, razon: 'clave_exacta' };
    }

    const num1 = normalizarNumeroExpediente(exp1.numero);
    const num2 = normalizarNumeroExpediente(exp2.numero);
    const nombre1 = normalizarTexto(exp1.nombre);
    const nombre2 = normalizarTexto(exp2.nombre);
    const juzgado1 = normalizarTexto(exp1.juzgado);
    const juzgado2 = normalizarTexto(exp2.juzgado);

    // Mismo número de expediente y mismo juzgado = duplicados
    if (num1 && num2 && num1 === num2 && juzgado1 === juzgado2) {
        return { esDuplicado: true, confianza: 0.95, razon: 'numero_juzgado' };
    }

    // Mismo nombre exacto y mismo juzgado = duplicados
    if (nombre1 && nombre2 && nombre1 === nombre2 && juzgado1 === juzgado2) {
        return { esDuplicado: true, confianza: 0.9, razon: 'nombre_juzgado' };
    }

    // Nombre muy similar (>85%) y mismo juzgado
    if (nombre1 && nombre2 && juzgado1 === juzgado2) {
        const similitud = calcularSimilitud(nombre1, nombre2);
        if (similitud > 0.85) {
            return { esDuplicado: true, confianza: similitud * 0.9, razon: 'nombre_similar' };
        }
    }

    // Mismo número y nombre similar
    if (num1 && num2 && num1 === num2) {
        const similitudNombre = calcularSimilitud(nombre1, nombre2);
        if (similitudNombre > 0.7) {
            return { esDuplicado: true, confianza: 0.85, razon: 'numero_nombre_similar' };
        }
    }

    return { esDuplicado: false, confianza: 0, razon: null };
}

// Fusionar dos expedientes conservando la información más completa
function fusionarExpedientesInteligente(exp1, exp2) {
    const fusionado = { ...exp1 };
    const cambios = [];

    // Para cada campo, conservar el valor más reciente según fechaActualizacion
    const campos = ['numero', 'nombre', 'juzgado', 'tipo', 'actor', 'demandado',
                    'materia', 'estado', 'abogado', 'observaciones', 'etiquetas',
                    'comentario', 'categoria', 'color'];

    campos.forEach(campo => {
        const val1 = exp1[campo];
        const val2 = exp2[campo];

        // Si uno tiene valor y el otro no, usar el que tiene valor
        if (!val1 && val2) {
            fusionado[campo] = val2;
            cambios.push({ campo, de: val1, a: val2, origen: 'exp2' });
        } else if (val1 && val2 && val1 !== val2) {
            if (Array.isArray(val1) && Array.isArray(val2)) {
                // Arrays (ej: etiquetas): siempre unión
                fusionado[campo] = [...new Set([...val1, ...val2])];
                cambios.push({ campo, de: val1, a: fusionado[campo], origen: 'fusion_arrays' });
            } else if (typeof val1 === 'string' && typeof val2 === 'string') {
                // Strings: usa el valor del expediente con fechaActualizacion más reciente
                const ts1 = exp1.fechaActualizacion || exp1.fechaCreacion || '';
                const ts2 = exp2.fechaActualizacion || exp2.fechaCreacion || '';
                if (ts2 > ts1) {
                    // exp2 es más reciente — usar su valor
                    fusionado[campo] = val2;
                    cambios.push({ campo, de: val1, a: val2, origen: 'exp2_mas_reciente' });
                }
                // si exp1 es igual o más reciente, fusionado[campo] ya tiene val1 (del spread inicial)
            }
        }
    });

    // Fusionar campos de archivo: usar el estado más reciente
    const ts1 = exp1.fechaActualizacion || exp1.fechaCreacion || '';
    const ts2 = exp2.fechaActualizacion || exp2.fechaCreacion || '';
    const exp2MasReciente = ts2 > ts1;
    const expReciente = exp2MasReciente ? exp2 : exp1;

    // Si alguno tiene archivado, usar el estado del más reciente
    if (exp1.archivado !== undefined || exp2.archivado !== undefined) {
        fusionado.archivado = expReciente.archivado || false;
        fusionado.motivoArchivo = expReciente.motivoArchivo || fusionado.motivoArchivo;
        fusionado.etiquetaArchivo = expReciente.etiquetaArchivo || fusionado.etiquetaArchivo;
        fusionado.fechaArchivo = expReciente.fechaArchivo || fusionado.fechaArchivo;

        if (exp1.archivado !== exp2.archivado) {
            cambios.push({ campo: 'archivado', de: exp1.archivado, a: fusionado.archivado, origen: exp2MasReciente ? 'exp2_mas_reciente' : 'exp1' });
        }
    }

    // Fusionar campos de institución y PJF
    if (!fusionado.institucion && exp2.institucion) fusionado.institucion = exp2.institucion;
    if (exp2MasReciente && exp2.institucion) fusionado.institucion = exp2.institucion;
    const camposPJF = ['pjfOrgId', 'pjfTipoAsunto', 'pjfTipoProcedimiento'];
    camposPJF.forEach(campo => {
        if (!fusionado[campo] && exp2[campo]) fusionado[campo] = exp2[campo];
        if (exp2MasReciente && exp2[campo]) fusionado[campo] = exp2[campo];
    });

    // Combinar historial si existe
    if (exp1.historial || exp2.historial) {
        const historial1 = exp1.historial || [];
        const historial2 = exp2.historial || [];
        fusionado.historial = [...historial1, ...historial2]
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    }

    // Usar la fecha de creación más antigua
    if (exp1.fechaCreacion && exp2.fechaCreacion) {
        fusionado.fechaCreacion = exp1.fechaCreacion < exp2.fechaCreacion
            ? exp1.fechaCreacion : exp2.fechaCreacion;
    }

    // Usar la fecha de actualización más reciente
    if (exp1.fechaActualizacion && exp2.fechaActualizacion) {
        fusionado.fechaActualizacion = exp1.fechaActualizacion > exp2.fechaActualizacion
            ? exp1.fechaActualizacion : exp2.fechaActualizacion;
    } else {
        fusionado.fechaActualizacion = new Date().toISOString();
    }

    // Conservar IDs originales para reasignar notas/eventos
    fusionado._idsOriginales = [exp1.id, exp2.id].filter(Boolean);
    fusionado._cambiosFusion = cambios;

    return fusionado;
}

// Reporte de fusión de duplicados
let reporteFusionDuplicados = {
    expedientesFusionados: [],
    notasReasignadas: 0,
    eventosReasignados: 0
};

function limpiarReporteFusion() {
    reporteFusionDuplicados = {
        expedientesFusionados: [],
        notasReasignadas: 0,
        eventosReasignados: 0
    };
}

// Generar clave única para nota
function claveNota(nota) {
    const contenido = (nota.contenido || '').substring(0, 100).trim().toLowerCase();
    const expedienteId = nota.expedienteId || 'sin-exp';
    const fecha = nota.fechaCreacion || '';
    return `${expedienteId}|${contenido}|${fecha.substring(0, 10)}`;
}

// Generar clave única para evento
function claveEvento(evento) {
    const titulo = (evento.titulo || '').trim().toLowerCase();
    const fecha = (evento.fecha || evento.fechaInicio || '').substring(0, 10);
    const expedienteId = evento.expedienteId || 'sin-exp';
    return `${titulo}|${fecha}|${expedienteId}`;
}

// Generar clave de eliminación para un expediente
function claveEliminacionExpediente(exp) {
    const numero = (exp.numero || '').trim().toLowerCase();
    const nombre = (exp.nombre || '').trim().toLowerCase();
    const juzgado = (exp.juzgado || '').trim().toLowerCase();
    return `exp|${numero}|${nombre}|${juzgado}`;
}

// Fusionar expedientes con detección inteligente de duplicados
function fusionarExpedientes(locales, remotos, clavesEliminadas = new Set()) {
    limpiarReporteFusion();

    // Filtrar expedientes que han sido eliminados
    const localesFiltrados = locales.filter(exp => !clavesEliminadas.has(claveEliminacionExpediente(exp)));
    const remotosFiltrados = remotos.filter(exp => !clavesEliminadas.has(claveEliminacionExpediente(exp)));

    // Locales primero: el expediente local es la base (exp1) en la fusión,
    // garantizando que los cambios locales recientes no se pierdan ante una versión remota más vieja.
    const todosExpedientes = [...localesFiltrados, ...remotosFiltrados];
    const expedientesProcesados = [];
    const indicesUsados = new Set();

    // Comparar cada expediente con los demás para detectar duplicados
    for (let i = 0; i < todosExpedientes.length; i++) {
        if (indicesUsados.has(i)) continue;

        let expedienteBase = { ...todosExpedientes[i] };
        const duplicadosEncontrados = [];

        for (let j = i + 1; j < todosExpedientes.length; j++) {
            if (indicesUsados.has(j)) continue;

            const resultado = sonExpedientesDuplicados(expedienteBase, todosExpedientes[j]);

            if (resultado.esDuplicado) {
                duplicadosEncontrados.push({
                    indice: j,
                    expediente: todosExpedientes[j],
                    confianza: resultado.confianza,
                    razon: resultado.razon
                });
                indicesUsados.add(j);
            }
        }

        // Si hay duplicados, fusionarlos
        if (duplicadosEncontrados.length > 0) {
            const nombresOriginales = [expedienteBase.nombre || expedienteBase.numero];

            duplicadosEncontrados.forEach(dup => {
                nombresOriginales.push(dup.expediente.nombre || dup.expediente.numero);
                expedienteBase = fusionarExpedientesInteligente(expedienteBase, dup.expediente);
            });

            reporteFusionDuplicados.expedientesFusionados.push({
                expedienteFinal: expedienteBase.numero || expedienteBase.nombre,
                cantidadFusionados: duplicadosEncontrados.length + 1,
                originales: nombresOriginales,
                idsOriginales: expedienteBase._idsOriginales || [],
                cambios: expedienteBase._cambiosFusion || []
            });

            // Limpiar campos temporales
            delete expedienteBase._cambiosFusion;
        }

        indicesUsados.add(i);
        expedientesProcesados.push(expedienteBase);
    }

    return expedientesProcesados;
}

// Crear mapa de IDs originales a ID final (para reasignar notas/eventos)
function crearMapaReasignacion() {
    const mapa = new Map();
    reporteFusionDuplicados.expedientesFusionados.forEach(fusion => {
        if (fusion.idsOriginales && fusion.idsOriginales.length > 1) {
            const idFinal = fusion.idsOriginales[0]; // El primer ID será el principal
            fusion.idsOriginales.forEach(idOriginal => {
                if (idOriginal !== idFinal) {
                    mapa.set(idOriginal, idFinal);
                }
            });
        }
    });
    return mapa;
}

// Fusionar notas sin duplicar y reasignar de expedientes fusionados
function fusionarNotas(locales, remotas) {
    const mapa = new Map();
    const mapaReasignacion = crearMapaReasignacion();

    const todasNotas = [...remotas, ...locales];

    todasNotas.forEach(nota => {
        // Reasignar expedienteId si el expediente fue fusionado
        let notaProcesada = { ...nota };
        if (nota.expedienteId && mapaReasignacion.has(nota.expedienteId)) {
            notaProcesada.expedienteId = mapaReasignacion.get(nota.expedienteId);
            notaProcesada._reasignada = true;
            reporteFusionDuplicados.notasReasignadas++;
        }

        const clave = claveNota(notaProcesada);
        if (!clave) return;

        const existente = mapa.get(clave);
        if (!existente) {
            mapa.set(clave, notaProcesada);
        } else {
            const fechaNueva = new Date(notaProcesada.fechaActualizacion || notaProcesada.fechaCreacion || 0);
            const fechaExistente = new Date(existente.fechaActualizacion || existente.fechaCreacion || 0);
            if (fechaNueva >= fechaExistente) {
                mapa.set(clave, notaProcesada);
            }
        }
    });

    // Limpiar campos temporales
    return Array.from(mapa.values()).map(nota => {
        delete nota._reasignada;
        return nota;
    });
}

// Fusionar eventos sin duplicar y reasignar de expedientes fusionados
function fusionarEventos(locales, remotos) {
    const mapa = new Map();
    const mapaReasignacion = crearMapaReasignacion();

    const todosEventos = [...remotos, ...locales];

    todosEventos.forEach(evento => {
        // Reasignar expedienteId si el expediente fue fusionado
        let eventoProcesado = { ...evento };
        if (evento.expedienteId && mapaReasignacion.has(evento.expedienteId)) {
            eventoProcesado.expedienteId = mapaReasignacion.get(evento.expedienteId);
            eventoProcesado._reasignado = true;
            reporteFusionDuplicados.eventosReasignados++;
        }

        const clave = claveEvento(eventoProcesado);
        if (!clave) return;

        const existente = mapa.get(clave);
        if (!existente) {
            mapa.set(clave, eventoProcesado);
        } else {
            const fechaNueva = new Date(eventoProcesado.fechaCreacion || 0);
            const fechaExistente = new Date(existente.fechaCreacion || 0);
            if (fechaNueva >= fechaExistente) {
                mapa.set(clave, eventoProcesado);
            }
        }
    });

    // Limpiar campos temporales
    return Array.from(mapa.values()).map(evento => {
        delete evento._reasignado;
        return evento;
    });
}

// Obtener todos los datos locales
async function obtenerTodosLosDatos() {
    // Incluir tanto activos como archivados para no perder datos en sync
    const expedientes = await obtenerExpedientes();
    const archivados = typeof obtenerExpedientesArchivados === 'function' ? await obtenerExpedientesArchivados() : [];
    const notas = await obtenerNotas();
    const eventos = await obtenerEventos();
    const eliminados = await obtenerEliminados();

    return { expedientes: [...expedientes, ...archivados], notas, eventos, eliminados };
}

// Escape HTML para evitar XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Aplicar datos a IndexedDB
async function aplicarDatosLocalmente(datos) {
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('TSJFilingDB');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    const tx = db.transaction(['expedientes', 'notas', 'eventos', 'eliminados'], 'readwrite');

    // Limpiar y repoblar
    const storeExp = tx.objectStore('expedientes');
    const storeNotas = tx.objectStore('notas');
    const storeEventos = tx.objectStore('eventos');
    const storeEliminados = tx.objectStore('eliminados');

    await Promise.all([
        new Promise(r => { storeExp.clear().onsuccess = r; }),
        new Promise(r => { storeNotas.clear().onsuccess = r; }),
        new Promise(r => { storeEventos.clear().onsuccess = r; }),
        new Promise(r => { storeEliminados.clear().onsuccess = r; })
    ]);

    for (const exp of datos.expedientes || []) {
        storeExp.put(exp);
    }
    for (const nota of datos.notas || []) {
        storeNotas.put(nota);
    }
    for (const evento of datos.eventos || []) {
        storeEventos.put(evento);
    }
    for (const eliminado of datos.eliminados || []) {
        storeEliminados.put(eliminado);
    }

    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    // Recargar UI
    await cargarExpedientes();
    await cargarNotas();
    await cargarEventos();
    await cargarEstadisticas();
    renderizarCalendario();
    if (typeof cargarExpedientesPJF === 'function') await cargarExpedientesPJF();

    // Actualizar badges de archivo
    if (typeof actualizarBadgeArchivo === 'function') actualizarBadgeArchivo();
    if (typeof actualizarBadgeArchivoPJF === 'function') actualizarBadgeArchivoPJF();

    // Si alguna sección de archivo está visible, recargarla
    const archivoTSJ = document.getElementById('archivo-section');
    if (archivoTSJ && archivoTSJ.style.display === 'block' && typeof cargarArchivo === 'function') {
        await cargarArchivo();
    }
    const archivoPJF = document.getElementById('archivo-section-pjf');
    if (archivoPJF && archivoPJF.style.display === 'block' && typeof cargarArchivoPJF === 'function') {
        await cargarArchivoPJF();
    }
}

// ==================== UI ====================
function actualizarUISync(estado, mensaje = '') {
    const statusEl = document.getElementById('sync-status');
    const btnSync = document.getElementById('btn-sync');
    const lastSyncEl = document.getElementById('sync-last-time');

    if (statusEl) {
        switch (estado) {
            case 'syncing':
                statusEl.innerHTML = '<span class="sync-dot syncing"></span> Sincronizando...';
                break;
            case 'success':
                statusEl.innerHTML = '<span class="sync-dot online"></span> Sincronizado';
                break;
            case 'error':
                statusEl.innerHTML = '<span class="sync-dot error"></span> Error';
                break;
            default:
                statusEl.innerHTML = '<span class="sync-dot offline"></span> No sincronizado';
        }
    }

    if (btnSync) {
        btnSync.disabled = estado === 'syncing';
    }

    if (lastSyncEl && syncState.lastSync) {
        const fecha = new Date(syncState.lastSync);
        lastSyncEl.textContent = fecha.toLocaleString('es-MX');
    }
}

function inicializarSync() {
    // Cargar última sincronización
    const lastSync = localStorage.getItem('sync_last_sync');
    if (lastSync) {
        syncState.lastSync = parseInt(lastSync);
    }

    // Actualizar UI inicial
    if (syncState.lastSync) {
        actualizarUISync('success');
    }

    // Mostrar/ocultar sección según estado premium
    actualizarVisibilidadSync();
}

function actualizarVisibilidadSync() {
    const syncSection = document.getElementById('sync-section');
    if (syncSection) {
        // Siempre visible pero con mensaje si no es premium
        const content = syncSection.querySelector('.sync-content');
        const noPremium = syncSection.querySelector('.sync-no-premium');

        if (estadoPremium.activo) {
            if (content) content.style.display = 'block';
            if (noPremium) noPremium.style.display = 'none';
        } else {
            if (content) content.style.display = 'none';
            if (noPremium) noPremium.style.display = 'block';
        }
    }
}

// ==================== CONFIGURACIÓN DE AUTO-SYNC ====================

// Guardar configuración de sincronización
async function guardarConfigSync() {
    const syncOnLoad = document.getElementById('sync-on-load')?.checked || false;
    const syncOnSave = document.getElementById('sync-on-save')?.checked || false;

    localStorage.setItem('sync_on_load', syncOnLoad ? 'true' : 'false');
    localStorage.setItem('sync_on_save', syncOnSave ? 'true' : 'false');

    mostrarToast('Configuración de sincronización guardada', 'success');
}

// Cargar configuración de sincronización
function cargarConfigSync() {
    const syncOnLoad = localStorage.getItem('sync_on_load') === 'true';
    const syncOnSave = localStorage.getItem('sync_on_save') === 'true';

    const checkOnLoad = document.getElementById('sync-on-load');
    const checkOnSave = document.getElementById('sync-on-save');

    if (checkOnLoad) checkOnLoad.checked = syncOnLoad;
    if (checkOnSave) checkOnSave.checked = syncOnSave;
}

// Verificar si debe sincronizar al cargar
async function verificarSyncAlCargar() {
    if (!estadoPremium.activo) return;

    const syncOnLoad = localStorage.getItem('sync_on_load') === 'true';
    if (!syncOnLoad) return;

    // Esperar un poco para que la app termine de cargar
    setTimeout(async () => {
        try {
            // Preguntar al usuario si quiere sincronizar
            const datosRemotos = await verificarDatosRemotos();

            if (datosRemotos) {
                const confirmar = confirm(
                    '🔄 Se encontraron datos en otro dispositivo.\n\n' +
                    '¿Deseas sincronizar ahora?\n\n' +
                    '• Sí: Combina los datos de ambos dispositivos\n' +
                    '• No: Continuar solo con datos locales'
                );

                if (confirmar) {
                    await sincronizarDatos();
                }
            }
        } catch (error) {
            console.log('No hay datos remotos o error al verificar:', error.message);
        }
    }, 2000);
}

// Verificar si hay datos remotos (sin descargar todo)
async function verificarDatosRemotos() {
    const url = `${PREMIUM_CONFIG.apiUrl}?action=obtener_sync&codigo=${encodeURIComponent(estadoPremium.codigo)}`;

    try {
        const response = await fetchConReintentos(url, {
            method: 'GET',
            timeout: 15000 // 15 segundos para verificación rápida
        }, 2); // Solo 2 reintentos para verificación

        const resultado = await response.json();

        if (resultado.success && resultado.datos) {
            return true;
        }
        return false;
    } catch (error) {
        console.log('Error verificando datos remotos:', error.message);
        return false;
    }
}

// Sincronizar después de guardar (delegado a sincronización bidireccional completa)
async function sincronizarDespuesDeGuardar() {
    if (!estadoPremium.activo || !estadoPremium.codigo) return;
    // Delegar a sincronización bidireccional completa para garantizar que todos los dispositivos reciban los cambios
    return sincronizarDatos();
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        inicializarSync();
        cargarConfigSync();
    });
} else {
    setTimeout(() => {
        inicializarSync();
        cargarConfigSync();
    }, 100);
}

// Verificar sync al cargar (después de que premium esté verificado)
setTimeout(() => {
    if (typeof estadoPremium !== 'undefined' && estadoPremium.activo) {
        verificarSyncAlCargar();
    }
}, 3000);

// Mostrar reporte de fusión de duplicados en un modal
function mostrarReporteFusion() {
    const reporte = reporteFusionDuplicados;
    if (!reporte || reporte.expedientesFusionados.length === 0) {
        mostrarToast('No hubo duplicados fusionados en la última sincronización', 'info');
        return;
    }

    let html = '<div class="fusion-reporte">';
    html += '<div class="fusion-resumen">';
    html += '<div class="fusion-stat"><span class="fusion-numero">' + reporte.expedientesFusionados.length + '</span><span class="fusion-label">Expedientes fusionados</span></div>';
    html += '<div class="fusion-stat"><span class="fusion-numero">' + reporte.notasReasignadas + '</span><span class="fusion-label">Notas reasignadas</span></div>';
    html += '<div class="fusion-stat"><span class="fusion-numero">' + reporte.eventosReasignados + '</span><span class="fusion-label">Eventos reasignados</span></div>';
    html += '</div>';

    html += '<div class="fusion-lista">';
    reporte.expedientesFusionados.forEach(function(fusion) {
        html += '<div class="fusion-item">';
        html += '<div class="fusion-item-header">';
        html += '<strong>' + (fusion.numero || fusion.nombre || 'Expediente') + '</strong>';
        if (fusion.idsOriginales) {
            html += '<span class="fusion-badge">' + fusion.idsOriginales.length + ' duplicados</span>';
        }
        html += '</div>';
        if (fusion.idsOriginales && fusion.idsOriginales.length > 1) {
            html += '<div class="fusion-item-originales">IDs originales: ' + fusion.idsOriginales.join(', ') + '</div>';
        }
        if (fusion._cambiosFusion) {
            html += '<div class="fusion-item-cambios">Cambios: ' + fusion._cambiosFusion + '</div>';
        }
        html += '</div>';
    });
    html += '</div>';

    html += '<div class="fusion-nota">Los expedientes duplicados fueron fusionados automáticamente conservando los datos más recientes.</div>';
    html += '</div>';

    // Usar el sistema de modales existente
    if (typeof mostrarModal === 'function') {
        mostrarModal('Reporte de Fusión de Duplicados', html);
    } else {
        // Fallback: mostrar en alert
        var texto = 'Expedientes fusionados: ' + reporte.expedientesFusionados.length +
            '\nNotas reasignadas: ' + reporte.notasReasignadas +
            '\nEventos reasignados: ' + reporte.eventosReasignados;
        alert(texto);
    }
}

// Exportar funciones globales
window.sincronizarDatos = sincronizarDatos;
window.guardarConfigSync = guardarConfigSync;
window.sincronizarDespuesDeGuardar = sincronizarDespuesDeGuardar;
window.actualizarVisibilidadSync = actualizarVisibilidadSync;
window.cargarConfigSync = cargarConfigSync;
window.mostrarReporteFusion = mostrarReporteFusion;
window.sonExpedientesDuplicados = sonExpedientesDuplicados;
