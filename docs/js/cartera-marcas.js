/**
 * Cartera de marcas: las marcas de los clientes del despacho, con su estatus
 * en el IMPI y sus plazos.
 *
 * Cada marca guarda lo que identifica su trámite: denominación, expediente,
 * registro, clases, titular, cliente, estatus y fechas de presentación,
 * concesión y vigencia. Se da de alta a mano o desde una ficha de MARCia o de
 * Marcanet, y su estatus se puede volver a consultar en el IMPI con las
 * fichas de MARCia y Marcanet, que no gastan búsquedas del plan.
 *
 * Con esas fechas se calculan dos plazos, como ayuda y no como cómputo
 * oficial:
 *  - Declaración de uso: con la Ley Federal de Protección a la Propiedad
 *    Industrial (en vigor desde el 5 de noviembre de 2020), el titular declara
 *    el uso de la marca dentro de los tres meses siguientes a que se cumplan
 *    tres años de otorgado el registro.
 *  - Renovación: en los seis meses anteriores al fin de la vigencia, con seis
 *    meses de gracia después. La vigencia de diez años cuenta desde el
 *    otorgamiento para los registros otorgados con la ley nueva y desde la
 *    presentación para los anteriores.
 * Cada plazo se puede pasar a Pendientes o marcar como atendido.
 *
 * Se guarda en la configuración (como las cuentas compartidas) y viaja en la
 * sincronización. Cada campo lleva la fecha de su último cambio, así que dos
 * dispositivos que editan cosas distintas de la misma marca no se pisan, y
 * borrar es un campo más: el borrado viaja como cualquier otro cambio.
 *
 * Dos partes:
 *  - el motor, puro, que se prueba en Node;
 *  - la pantalla y el almacén, que solo corren en el navegador.
 */
(function (global) {
    'use strict';

    // ==================== MOTOR ====================

    const CLAVE_CONFIG = 'cartera_marcas';
    const INICIO_LFPPI = '2020-11-05';
    // Un plazo que empieza dentro de estos días "empieza pronto".
    const DIAS_AVISO = 90;
    const MAX_HISTORIAL = 40;

    const CAMPOS = ['denominacion', 'expediente', 'registro', 'clases', 'titular', 'cliente', 'tipo', 'estatus',
        'fechaPresentacion', 'fechaConcesion', 'vigencia', 'notas', 'expedienteId', 'markId', 'imagen',
        'ultimaRevision', 'fuente', 'eliminada'];
    // Mapas que se juntan clave por clave: lo atendido y los pendientes creados, por plazo.
    const MAPAS = ['atendidos', 'pendientes'];
    const CAMPOS_FECHA = ['fechaPresentacion', 'fechaConcesion', 'vigencia'];
    const TIPOS = { nominativa: 'Nominativa', mixta: 'Mixta', figurativa: 'Figurativa (diseño)', tridimensional: 'Tridimensional', otra: 'Otra' };
    const ESTADOS = { en_curso: 'En curso', vencido: 'Vencido', proximo: 'Empieza pronto', futuro: 'Por venir', atendido: 'Atendido' };
    const ORDEN_ESTADO = { en_curso: 0, vencido: 1, proximo: 2, futuro: 3, atendido: 4 };

    const texto = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');
    const normal = t => texto(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const lista = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
    const p2 = n => String(n).padStart(2, '0');
    const aTexto = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());

    function valida(y, m, d) {
        const x = new Date(y, m - 1, d);
        return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? aTexto(x) : '';
    }

    /** «18/08/2011 11:47:18 AM», «2011-08-18» o un ISO → «2011-08-18». Lo que no se entiende, ''. */
    function fecha(v) {
        const t = texto(v);
        let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
        if (m) return valida(+m[1], +m[2], +m[3]);
        m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
        if (m) return valida(+m[3], +m[2], +m[1]);
        return '';
    }

    /** Suma meses a un día; si el mes no tiene ese día, se queda en el último (31 de agosto + 6 meses → 28 de febrero). */
    function sumarMeses(f, n) {
        const [y, m, d] = f.split('-').map(Number);
        const x = new Date(y, m - 1 + n, 1);
        const ultimo = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
        x.setDate(Math.min(d, ultimo));
        return aTexto(x);
    }

    function sumarDias(f, n) {
        const [y, m, d] = f.split('-').map(Number);
        return aTexto(new Date(y, m - 1, d + n));
    }

    /** Días de `a` a `b` (positivo si b es después). */
    function diasEntre(a, b) {
        const [y1, m1, d1] = a.split('-').map(Number);
        const [y2, m2, d2] = b.split('-').map(Number);
        return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
    }

    function hoyTexto(ahora) {
        return aTexto(new Date(ahora != null ? ahora : Date.now()));
    }

    function clasesDe(v) {
        const crudas = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[^\d]+/);
        return Array.from(new Set(crudas.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 45))).sort((a, b) => a - b);
    }

    function vacio(campo) {
        if (campo === 'clases') return [];
        if (campo === 'expedienteId' || campo === 'eliminada') return null;
        return '';
    }

    /** Solo los campos conocidos que vienen en `datos`, ya limpios. */
    function limpiar(datos) {
        const r = {};
        for (const c of CAMPOS) {
            if (!datos || !(c in datos)) continue;
            const v = datos[c];
            if (c === 'clases') r[c] = clasesDe(v);
            else if (CAMPOS_FECHA.includes(c)) r[c] = fecha(v);
            else if (c === 'tipo') r[c] = TIPOS[v] ? v : '';
            else if (c === 'expedienteId') r[c] = v == null || v === '' || isNaN(parseInt(v, 10)) ? null : parseInt(v, 10);
            else if (c === 'eliminada') r[c] = v ? String(v) : null;
            else r[c] = texto(v);
        }
        return r;
    }

    function nuevoUid() {
        let azar = '';
        try {
            const b = new Uint8Array(6);
            (global.crypto || require('crypto').webcrypto).getRandomValues(b);
            azar = Array.from(b, x => x.toString(36).padStart(2, '0')).join('');
        } catch (e) {
            azar = Math.random().toString(36).slice(2, 14);
        }
        return 'mc_' + Date.now().toString(36) + azar;
    }

    /** Una marca nueva. `ahora` es el sello (ISO) con que se fechan sus campos. */
    function nueva(datos, ahora, uid) {
        const limpios = limpiar(datos);
        const m = { uid: uid || nuevoUid(), creada: ahora, sellos: {}, historial: [], atendidos: {}, pendientes: {} };
        for (const c of CAMPOS) {
            m[c] = c in limpios ? limpios[c] : vacio(c);
            m.sellos[c] = ahora;
        }
        if (m.estatus) m.historial.push({ fecha: ahora, estatus: m.estatus });
        return m;
    }

    function copiar(m) {
        return JSON.parse(JSON.stringify(m));
    }

    /** Rellena lo que falte a un registro que llega de fuera (otra versión, un respaldo). */
    function completar(m) {
        const r = copiar(m);
        r.sellos = r.sellos || {};
        r.historial = Array.isArray(r.historial) ? r.historial : [];
        for (const c of CAMPOS) if (r[c] === undefined) r[c] = vacio(c);
        for (const mapa of MAPAS) if (!r[mapa] || typeof r[mapa] !== 'object') r[mapa] = {};
        return r;
    }

    function unirHistorial(a, b) {
        const vistos = new Map();
        for (const h of [...lista(a), ...lista(b)]) {
            if (!h || !h.estatus) continue;
            vistos.set((h.fecha || '') + '|' + h.estatus, { fecha: h.fecha || '', estatus: h.estatus });
        }
        return Array.from(vistos.values()).sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0)).slice(-MAX_HISTORIAL);
    }

    /**
     * Cambia una marca. Solo se sellan los campos que de verdad cambian; en
     * los mapas (atendidos, pendientes) cada entrada lleva su propia fecha y
     * `null` la quita.
     */
    function cambiar(m, cambios, ahora) {
        const r = completar(m);
        const limpios = limpiar(cambios);
        for (const c of Object.keys(limpios)) {
            if (JSON.stringify(r[c]) === JSON.stringify(limpios[c])) continue;
            if (c === 'estatus' && limpios.estatus) r.historial = unirHistorial(r.historial, [{ fecha: ahora, estatus: limpios.estatus }]);
            r[c] = limpios[c];
            r.sellos[c] = ahora;
        }
        for (const mapa of MAPAS) {
            const entradas = cambios && cambios[mapa];
            if (!entradas || typeof entradas !== 'object') continue;
            for (const [clave, valor] of Object.entries(entradas)) r[mapa][clave] = { valor: valor == null ? null : valor, en: ahora };
        }
        return r;
    }

    // Entre dos versiones de lo mismo gana la más reciente; si empatan, una
    // regla fija, para que todos los dispositivos lleguen al mismo resultado.
    function gana(x, y, sx, sy) {
        if (sx > sy) return x;
        if (sy > sx) return y;
        return JSON.stringify(y) > JSON.stringify(x) ? y : x;
    }

    function juntar(a, b) {
        const x = completar(a), y = completar(b);
        const r = {
            uid: x.uid,
            creada: [x.creada, y.creada].filter(Boolean).sort()[0] || '',
            sellos: {},
            historial: unirHistorial(x.historial, y.historial)
        };
        for (const c of CAMPOS) {
            const sx = x.sellos[c] || '', sy = y.sellos[c] || '';
            r[c] = gana({ v: x[c] }, { v: y[c] }, sx, sy).v;
            r.sellos[c] = sx > sy ? sx : sy;
        }
        for (const mapa of MAPAS) {
            r[mapa] = {};
            for (const clave of new Set([...Object.keys(x[mapa]), ...Object.keys(y[mapa])])) {
                const ex = x[mapa][clave], ey = y[mapa][clave];
                r[mapa][clave] = !ex ? ey : !ey ? ex : gana(ex, ey, ex.en || '', ey.en || '');
            }
        }
        return r;
    }

    /** Une dos listas de marcas (local y remota) campo por campo, por su uid. */
    function fusionar(locales, remotas) {
        const mapa = new Map();
        for (const m of [...lista(remotas), ...lista(locales)]) {
            if (!m || !m.uid) continue;
            mapa.set(m.uid, mapa.has(m.uid) ? juntar(mapa.get(m.uid), m) : completar(m));
        }
        return Array.from(mapa.values()).sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    }

    const activas = marcas => lista(marcas).filter(m => m && !m.eliminada);

    // El número sin ceros a la izquierda: «001234567» y «1234567» son el mismo expediente.
    const numero = v => digitos(v).replace(/^0+(?=\d)/, '');

    /** La misma marca ya en la cartera: mismo expediente o mismo registro. */
    function buscarMisma(marcas, datos) {
        const exp = numero(datos && datos.expediente), reg = numero(datos && datos.registro);
        if (!exp && !reg) return null;
        return activas(marcas).find(m => (exp && numero(m.expediente) === exp) || (reg && numero(m.registro) === reg)) || null;
    }

    /** registrada, tramite, inactiva o desconocida. */
    function situacion(m) {
        const e = normal(m.estatus);
        if (/NEGAD|ABANDON|DESIST|CADUC|CANCELAD|NULIDAD|EXTINT|RECHAZ/.test(e)) return 'inactiva';
        if (/TRAMITE|EXAMEN|OPOSICION|REQUISITO|SUSPEN|SOLICITUD/.test(e) && !/REGISTRAD|CONCEDID|OTORGAD/.test(e)) return 'tramite';
        if (/REGISTRAD|CONCEDID|OTORGAD|VIGENTE|RENOVAD/.test(e) || digitos(m.registro)) return 'registrada';
        if (digitos(m.expediente)) return 'tramite';
        return 'desconocida';
    }

    /**
     * Los plazos de una marca registrada, cada uno con su estado respecto de
     * hoy: { tipo, titulo, desde, hasta, estimado, clave, atendido, pendienteId, estado }.
     */
    function plazosDe(m, hoy) {
        if (situacion(m) !== 'registrada') return [];
        const out = [];
        const conc = fecha(m.fechaConcesion), pres = fecha(m.fechaPresentacion);
        if (conc && conc >= INICIO_LFPPI) {
            const desde = sumarMeses(conc, 36);
            out.push({ tipo: 'uso', titulo: 'Declaración de uso', desde, hasta: sumarMeses(desde, 3), estimado: false });
        }
        let vig = fecha(m.vigencia), estimada = false;
        if (!vig) {
            // Sin vigencia oficial se estima, pero solo si la estimación no se
            // quedó atrás: una marca vieja que sigue registrada se renovó, y
            // contar diez años desde su presentación daría un plazo falso.
            const base = conc && conc >= INICIO_LFPPI ? conc : pres;
            if (base) {
                const est = sumarMeses(base, 120);
                if (diasEntre(hoy, sumarMeses(est, 6)) >= 0) { vig = est; estimada = true; }
            }
        }
        if (vig) {
            out.push({ tipo: 'renovacion', titulo: 'Renovación', desde: sumarMeses(vig, -6), hasta: vig, estimado: estimada });
            out.push({ tipo: 'gracia', titulo: 'Renovación (periodo de gracia)', desde: sumarDias(vig, 1), hasta: sumarMeses(vig, 6), estimado: estimada });
        }
        return out.map(p => {
            const clave = p.tipo + '|' + p.hasta;
            const at = (m.atendidos || {})[clave];
            const pe = (m.pendientes || {})[clave];
            const atendido = !!(at && at.valor);
            return { ...p, clave, atendido, pendienteId: pe && pe.valor != null ? pe.valor : null, estado: estadoPlazo(p, hoy, atendido) };
        });
    }

    function estadoPlazo(p, hoy, atendido) {
        if (atendido) return 'atendido';
        if (diasEntre(p.hasta, hoy) > 0) return 'vencido';
        if (diasEntre(p.desde, hoy) >= 0) return 'en_curso';
        if (diasEntre(hoy, p.desde) <= DIAS_AVISO) return 'proximo';
        return 'futuro';
    }

    /**
     * Los plazos que vale la pena mostrar: el periodo de gracia solo cuando ya
     * pasó el de renovación sin atenderse, y entonces la renovación vencida
     * deja de mostrarse (la sustituye la gracia).
     */
    function plazosVigentes(plazos) {
        const ren = plazos.find(p => p.tipo === 'renovacion');
        const enGracia = !!ren && ren.estado === 'vencido';
        return plazos.filter(p => {
            if (p.tipo === 'gracia') return enGracia;
            if (p.tipo === 'renovacion') return !enGracia;
            return true;
        });
    }

    function porUrgencia(a, b) {
        return (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]) ||
            (a.estado === 'vencido' ? diasEntre(a.hasta, b.hasta) * -1 : 0) ||
            (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0);
    }

    /** El plazo más urgente sin atender, o null. */
    function proximoPlazo(m, hoy) {
        const abiertos = plazosVigentes(plazosDe(m, hoy)).filter(p => p.estado !== 'atendido');
        return abiertos.sort(porUrgencia)[0] || null;
    }

    function fechaCorta(f) {
        const v = fecha(f);
        return v ? v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4) : '';
    }

    /** «Renovación: en curso, vence el 18/08/2031». */
    function textoPlazo(p) {
        if (!p) return '';
        const est = p.estimado ? ' (fecha estimada)' : '';
        if (p.estado === 'atendido') return p.titulo + ': atendido';
        if (p.estado === 'vencido') return p.titulo + ': venció el ' + fechaCorta(p.hasta) + est;
        if (p.estado === 'en_curso') return p.titulo + ': en curso, vence el ' + fechaCorta(p.hasta) + est;
        return p.titulo + ': del ' + fechaCorta(p.desde) + ' al ' + fechaCorta(p.hasta) + est;
    }

    function numeros(m) {
        return [digitos(m.registro) ? 'Reg. ' + texto(m.registro) : '', digitos(m.expediente) ? 'Exp. ' + texto(m.expediente) : ''].filter(Boolean).join(' · ');
    }

    /** Cifras de la cartera (solo las marcas que no se borraron). */
    function resumen(marcas, hoy) {
        const r = { total: 0, registradas: 0, tramite: 0, otras: 0, enCurso: 0, proximos: 0, vencidos: 0 };
        for (const m of activas(marcas)) {
            r.total++;
            const s = situacion(m);
            if (s === 'registrada') r.registradas++;
            else if (s === 'tramite') r.tramite++;
            else r.otras++;
            const plazos = plazosVigentes(plazosDe(m, hoy));
            if (plazos.some(p => p.estado === 'en_curso')) r.enCurso++;
            if (plazos.some(p => p.estado === 'proximo')) r.proximos++;
            if (plazos.some(p => p.estado === 'vencido')) r.vencidos++;
        }
        return r;
    }

    function ordenar(marcas, hoy) {
        return activas(marcas).map(m => ({ m, p: proximoPlazo(m, hoy) })).sort((x, y) => {
            if (x.p && y.p) return porUrgencia(x.p, y.p) || normal(x.m.denominacion).localeCompare(normal(y.m.denominacion));
            if (x.p) return -1;
            if (y.p) return 1;
            return normal(x.m.denominacion).localeCompare(normal(y.m.denominacion));
        }).map(x => x.m);
    }

    const esDelCliente = (m, cliente) => !cliente || normal(m.cliente) === normal(cliente);

    /** Lo que necesita el reporte en PDF (REPORTES_PDF.documentoCartera). */
    function datosParaReporte(marcas, opciones) {
        const o = opciones || {};
        const hoy = o.hoy || hoyTexto(o.ahora);
        const delCliente = ordenar(activas(marcas).filter(m => esDelCliente(m, o.cliente)), hoy);
        const plazos = [];
        for (const m of delCliente) {
            for (const p of plazosVigentes(plazosDe(m, hoy))) {
                // En el reporte: lo que corre, lo vencido y lo del próximo año.
                if (p.estado === 'atendido' || (p.estado === 'futuro' && diasEntre(hoy, p.desde) > 365)) continue;
                plazos.push({ marca: m.denominacion, numeros: numeros(m), titulo: p.titulo, desde: p.desde, hasta: p.hasta,
                    estado: ESTADOS[p.estado], estimado: p.estimado, _p: p });
            }
        }
        plazos.sort((a, b) => porUrgencia(a._p, b._p));
        return {
            cliente: texto(o.cliente),
            fecha: o.ahora != null ? new Date(o.ahora).toISOString() : new Date().toISOString(),
            resumen: resumen(delCliente, hoy),
            plazos: plazos.map(({ _p, ...p }) => p),
            marcas: delCliente.map(m => {
                const p = proximoPlazo(m, hoy);
                const vig = fecha(m.vigencia);
                const estimada = !vig ? (plazosDe(m, hoy).find(x => x.tipo === 'renovacion') || null) : null;
                return {
                    denominacion: m.denominacion, numeros: numeros(m), titular: m.titular, clases: m.clases, estatus: m.estatus,
                    revisado: m.ultimaRevision ? m.ultimaRevision.slice(0, 10) : '',
                    vigencia: vig || (estimada ? estimada.hasta : ''), vigenciaEstimada: !vig && !!estimada,
                    proximo: p ? textoPlazo(p) : ''
                };
            })
        };
    }

    function celdaCSV(v) {
        const s = String(v == null ? '' : v);
        return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function csv(marcas, hoy) {
        const filas = [['Denominación', 'Expediente', 'Registro', 'Clases', 'Titular', 'Cliente', 'Tipo', 'Estatus', 'Presentación',
            'Concesión', 'Vigencia', 'Próximo plazo', 'Última revisión en el IMPI', 'Notas']];
        for (const m of ordenar(marcas, hoy)) {
            filas.push([m.denominacion, m.expediente, m.registro, m.clases.join(' '), m.titular, m.cliente, TIPOS[m.tipo] || '', m.estatus,
                fechaCorta(m.fechaPresentacion), fechaCorta(m.fechaConcesion), fechaCorta(m.vigencia), textoPlazo(proximoPlazo(m, hoy)),
                m.ultimaRevision ? fechaCorta(m.ultimaRevision.slice(0, 10)) : '', m.notas]);
        }
        return '﻿' + filas.map(f => f.map(celdaCSV).join(',')).join('\n');
    }

    // ---- Lo que llega del IMPI ----

    function nombreDeTitular(o) {
        if (typeof o === 'string') return texto(o);
        return texto(o && (o.name || o.fullName || o.ownerName));
    }

    // MARCia da la imagen de sus resultados como una ruta de su sitio
    // («/marcas/image/RM…»): se guarda completa, para pedirla directo a MARCia.
    function imagenDeMARCia(u) {
        const v = typeof u === 'string' ? u.trim() : '';
        if (/^\/marcas\/[\w\/.%-]+$/.test(v) && v.indexOf('..') < 0) return 'https://marcia.impi.gob.mx' + v;
        return /^https:\/\//i.test(v) ? v : '';
    }

    /** Una fila de resultados de MARCia (o el `result` de su ficha). */
    function desdeResultadoMARCia(r) {
        const x = r || {};
        const d = x.dates || {};
        return {
            denominacion: x.title, expediente: x.applicationNumber, registro: x.registrationNumber,
            titular: lista(x.owners).map(nombreDeTitular).filter(Boolean).join('; '),
            clases: x.classes, estatus: x.status, fechaPresentacion: d.application, vigencia: d.expiry,
            markId: x.id, imagen: imagenDeMARCia(x.images), fuente: 'MARCia'
        };
    }

    /** La ficha completa de MARCia (/marcia/view): agrega la fecha de concesión, las clases y los titulares. */
    function desdeFichaMARCia(data) {
        const d = data || {};
        const res = d.result || {};
        const det = d.details || {};
        const gi = det.generalInformation || {};
        const tm = det.trademark || {};
        const base = desdeResultadoMARCia(res);
        const titulares = lista((det.ownerInformation || {}).owners).map(nombreDeTitular).filter(Boolean);
        const deProductos = lista(det.productsAndServices).map(p => p && (p.niceClass || p.classNumber || p.clase));
        return {
            ...base,
            denominacion: base.denominacion || gi.title,
            expediente: base.expediente || gi.applicationNumber,
            registro: base.registro || gi.registrationNumber,
            titular: titulares.join('; ') || base.titular,
            clases: clasesDe(base.clases).length ? base.clases : deProductos,
            estatus: base.estatus || gi.status,
            fechaPresentacion: gi.applicationDate || base.fechaPresentacion,
            fechaConcesion: gi.registrationDate || '',
            vigencia: gi.expiryDate || base.vigencia,
            markId: tm.id || base.markId,
            imagen: imagenDeMARCia(tm.image) || base.imagen
        };
    }

    /**
     * La ficha de Marcanet (sus campos no tienen nombre fijo). El estatus se
     * lee como lo lee el estudio de viabilidad: abandonada, negada, registrada
     * y vigente hasta…, en trámite. La vigencia de Marcanet se actualiza al
     * renovar, la de MARCia no siempre.
     */
    function desdeFichaMarcanet(det, ahora, leerDetalle) {
        const d = det || {};
        const campo = re => {
            const k = Object.keys(d).find(x => !x.startsWith('_') && re.test(x));
            return k ? texto(d[k]) : '';
        };
        const leida = typeof leerDetalle === 'function' ? leerDetalle(d, ahora) : null;
        return {
            denominacion: campo(/^Denominaci/i),
            registro: digitos(campo(/^N[úu]mero de registro/i)),
            fechaPresentacion: campo(/^Fecha de presentaci/i),
            fechaConcesion: campo(/^Fecha de (concesi|otorgamiento)/i),
            vigencia: campo(/^Fecha de vigencia/i),
            titular: campo(/^Titular/i),
            clases: Object.keys(d).filter(k => /^\d{1,2}\s*Edici/.test(k)).map(k => +k.match(/^\d{1,2}/)[0]),
            estatus: leida ? leida.estado : '',
            fuente: 'Marcanet'
        };
    }

    /**
     * Junta lo de MARCia y lo de Marcanet: Marcanet manda en el estatus y la
     * vigencia; MARCia, en lo demás. Lo vacío no cuenta.
     */
    function combinar(deMARCia, deMarcanet) {
        const a = limpiar(deMARCia || {}), b = limpiar(deMarcanet || {});
        const r = {};
        const lleno = v => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');
        for (const c of CAMPOS) {
            const prefiereMarcanet = c === 'estatus' || c === 'vigencia';
            const primero = prefiereMarcanet ? b : a, segundo = prefiereMarcanet ? a : b;
            if (lleno(primero[c])) r[c] = primero[c];
            else if (lleno(segundo[c])) r[c] = segundo[c];
        }
        r.fuente = [lleno(a.estatus) || lleno(a.denominacion) ? 'MARCia' : '', lleno(b.estatus) || lleno(b.denominacion) ? 'Marcanet' : ''].filter(Boolean).join(' y ');
        return r;
    }

    /**
     * Aplica a una marca lo que se consultó en el IMPI. Lo vacío no borra lo
     * capturado. Devuelve { marca, cambioEstatus, antes, despues }.
     */
    function revisar(m, delIMPI, ahora) {
        const nuevos = limpiar(delIMPI || {});
        const cambios = {};
        for (const [c, v] of Object.entries(nuevos)) {
            if (c === 'eliminada' || c === 'cliente' || c === 'notas' || c === 'expedienteId' || c === 'tipo') continue;
            if (Array.isArray(v) ? !v.length : v == null || v === '') continue;
            cambios[c] = v;
        }
        cambios.ultimaRevision = ahora;
        const antes = m.estatus;
        const marca = cambiar(m, cambios, ahora);
        return { marca, cambioEstatus: !!antes && !!marca.estatus && normal(antes) !== normal(marca.estatus), antes, despues: marca.estatus };
    }

    const Motor = {
        CLAVE_CONFIG, INICIO_LFPPI, CAMPOS, TIPOS, ESTADOS,
        fecha, sumarMeses, sumarDias, diasEntre, hoyTexto, clasesDe, limpiar, nueva, cambiar, fusionar, activas, buscarMisma,
        situacion, plazosDe, plazosVigentes, proximoPlazo, textoPlazo, numeros, resumen, ordenar, datosParaReporte, csv,
        desdeResultadoMARCia, desdeFichaMARCia, desdeFichaMarcanet, combinar, revisar, imagenDeMARCia
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
    global.CARTERA_MARCAS = Motor;
    if (typeof document === 'undefined') return;

    // ==================== ALMACÉN ====================

    function baseDeDatos() {
        return (typeof db !== 'undefined' && db && db.objectStoreNames && db.objectStoreNames.contains('config')) ? db : null;
    }

    function leer() {
        const base = baseDeDatos();
        if (!base) return Promise.resolve([]);
        return new Promise((resolve, reject) => {
            const req = base.transaction(['config'], 'readonly').objectStore('config').get(CLAVE_CONFIG);
            req.onsuccess = () => resolve(Array.isArray(req.result && req.result.valor) ? req.result.valor : []);
            req.onerror = () => reject(req.error);
        });
    }

    /** Lee, cambia y guarda en una sola transacción: dos pestañas no se pisan. */
    function modificar(cambio) {
        const base = baseDeDatos();
        if (!base) return Promise.reject(new Error('La base de datos aún no está lista'));
        return new Promise((resolve, reject) => {
            const tx = base.transaction(['config'], 'readwrite');
            const store = tx.objectStore('config');
            let resultado = null;
            const req = store.get(CLAVE_CONFIG);
            req.onsuccess = () => {
                const actuales = Array.isArray(req.result && req.result.valor) ? req.result.valor : [];
                try {
                    resultado = cambio(actuales);
                    store.put({ clave: CLAVE_CONFIG, valor: resultado.lista });
                } catch (e) {
                    reject(e);
                    try { tx.abort(); } catch (x) { /* ya terminó */ }
                }
            };
            tx.oncomplete = () => resolve(resultado);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('No se pudo guardar'));
        });
    }

    const sello = () => (typeof ahoraSync === 'function' ? ahoraSync() : new Date().toISOString());

    function avisarCambio() {
        if (typeof global.marcarYSincronizar === 'function') {
            Promise.resolve(global.marcarYSincronizar()).catch(() => { /* queda pendiente y se reintenta */ });
        }
    }

    async function guardarNueva(datos) {
        const r = await modificar(actuales => {
            const misma = buscarMisma(actuales, datos);
            if (misma) return { lista: actuales, marca: misma, yaEstaba: true };
            const m = nueva(datos, sello());
            return { lista: actuales.concat([m]), marca: m, yaEstaba: false };
        });
        if (!r.yaEstaba) avisarCambio();
        return r;
    }

    async function guardarCambios(uid, cambios) {
        const r = await modificar(actuales => {
            const i = actuales.findIndex(m => m && m.uid === uid);
            if (i < 0) throw new Error('Esa marca ya no está en la cartera');
            const copia = actuales.slice();
            copia[i] = typeof cambios === 'function' ? cambios(actuales[i]) : cambiar(actuales[i], cambios, sello());
            return { lista: copia, marca: copia[i] };
        });
        avisarCambio();
        return r.marca;
    }

    /** Lo que llega de la nube se junta con lo de aquí, nunca lo sustituye. */
    async function aplicarRemotas(listaRemota) {
        if (!Array.isArray(listaRemota)) return;
        await modificar(actuales => ({ lista: fusionar(actuales, listaRemota) }));
        refrescar();
    }

    // ==================== PANTALLA ====================

    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (m, t) => { if (typeof global.mostrarToast === 'function') global.mostrarToast(m, t || 'info'); };
    const ui = { buscar: '', cliente: '', situacion: '', revisando: false };
    const MAX_REVISION = 40;
    const SITUACION = { registrada: 'Registrada', tramite: 'En trámite', inactiva: 'Sin efectos', desconocida: 'Sin estatus' };

    // Las que se guardaron antes como ruta de MARCia también se ven.
    const urlImagen = u => imagenDeMARCia(u);

    function construir() {
        const cont = $('impi-tab-cartera');
        if (!cont || cont.dataset.listo) return;
        cont.dataset.listo = '1';
        cont.innerHTML =
            '<div class="card cm-card">' +
                '<div class="card-header cm-cabecera">' +
                    '<div><h3>📁 Cartera de marcas</h3>' +
                    '<p class="cm-sub">Las marcas de tus clientes, con su estatus en el IMPI y sus plazos de declaración de uso y renovación.</p></div>' +
                    '<div class="cm-botones">' +
                        '<button type="button" class="btn btn-sm btn-primary" data-cm="agregar">➕ Agregar marca</button>' +
                        '<button type="button" class="btn btn-sm btn-secondary" data-cm="revisar-todas" title="Consulta el estatus de cada marca en las fichas del IMPI (no gasta búsquedas)">🔄 Actualizar estatus</button>' +
                        '<button type="button" class="btn btn-sm btn-secondary" data-cm="pdf" title="Reporte con el formato de Empírica Legal Lab">📄 PDF</button>' +
                        '<button type="button" class="btn btn-sm btn-secondary" data-cm="csv">⬇️ CSV</button>' +
                    '</div>' +
                '</div>' +
                '<div class="card-body">' +
                    '<div class="cm-resumen" id="cm-resumen"></div>' +
                    '<div class="cm-filtros">' +
                        '<input type="search" id="cm-buscar" placeholder="Buscar por marca, número, titular o cliente" aria-label="Buscar en la cartera">' +
                        '<select id="cm-cliente" aria-label="Cliente"><option value="">Todos los clientes</option></select>' +
                        '<select id="cm-situacion" aria-label="Situación">' +
                            '<option value="">Todas las marcas</option>' +
                            '<option value="plazos">Con un plazo en curso, vencido o próximo</option>' +
                            '<option value="registrada">Registradas</option>' +
                            '<option value="tramite">En trámite</option>' +
                            '<option value="inactiva">Sin efectos (negadas, abandonadas…)</option>' +
                        '</select>' +
                    '</div>' +
                    '<div id="cm-lista" class="cm-lista"></div>' +
                    '<p class="cm-nota">Los plazos son cálculos de apoyo a partir de las fechas de cada marca: confírmalos en el expediente, el título de registro y la ley aplicable antes de actuar. Desde una ficha de MARCia o Marcanet puedes agregar una marca con «➕ Cartera».</p>' +
                '</div>' +
            '</div>';
        cont.addEventListener('click', alHacerClic);
        $('cm-buscar').addEventListener('input', e => { ui.buscar = e.target.value; pintar(); });
        $('cm-cliente').addEventListener('change', e => { ui.cliente = e.target.value; pintar(); });
        $('cm-situacion').addEventListener('change', e => { ui.situacion = e.target.value; pintar(); });
        refrescar();
    }

    let ultimas = [];

    async function refrescar() {
        try { ultimas = await leer(); } catch (e) { ultimas = []; }
        pintar();
        pintarInsignia();
    }

    function pintarInsignia() {
        const tab = document.querySelector('.impi-tab[data-impi-tab="cartera"]');
        if (!tab) return;
        const r = resumen(ultimas, hoyTexto());
        const n = r.enCurso + r.vencidos;
        let insignia = tab.querySelector('.cm-insignia');
        if (!n) { if (insignia) insignia.remove(); return; }
        if (!insignia) { insignia = document.createElement('span'); insignia.className = 'cm-insignia'; tab.appendChild(insignia); }
        insignia.textContent = String(n);
        insignia.title = n + (n === 1 ? ' marca con un plazo en curso o vencido' : ' marcas con un plazo en curso o vencido');
    }

    function filtradas(hoy) {
        const q = normal(ui.buscar);
        return ordenar(ultimas, hoy).filter(m => {
            if (!esDelCliente(m, ui.cliente)) return false;
            if (ui.situacion === 'plazos') {
                const p = proximoPlazo(m, hoy);
                if (!p || p.estado === 'futuro') return false;
            } else if (ui.situacion && situacion(m) !== ui.situacion && !(ui.situacion === 'inactiva' && situacion(m) === 'desconocida')) return false;
            if (!q) return true;
            return normal([m.denominacion, m.expediente, m.registro, m.titular, m.cliente, m.notas].join(' ')).includes(q);
        });
    }

    function pintar() {
        const cont = $('cm-lista');
        if (!cont) return;
        const hoy = hoyTexto();
        const r = resumen(ultimas, hoy);
        $('cm-resumen').innerHTML = [
            ['', r.total + (r.total === 1 ? ' marca' : ' marcas')],
            ['', r.registradas + ' registrada' + (r.registradas === 1 ? '' : 's')],
            ['', r.tramite + ' en trámite'],
            ['cm-chip-curso', r.enCurso + ' con plazo en curso'],
            ['cm-chip-vencido', r.vencidos + ' con plazo vencido'],
            ['cm-chip-proximo', r.proximos + ' empieza' + (r.proximos === 1 ? '' : 'n') + ' pronto']
        ].map(([c, t]) => '<span class="cm-chip ' + c + '">' + esc(t) + '</span>').join('');

        // Los clientes que hay, para el filtro.
        const sel = $('cm-cliente');
        const clientes = Array.from(new Set(activas(ultimas).map(m => texto(m.cliente)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));
        const actual = ui.cliente;
        sel.innerHTML = '<option value="">Todos los clientes</option>' + clientes.map(c => '<option value="' + esc(c) + '"' + (c === actual ? ' selected' : '') + '>' + esc(c) + '</option>').join('');

        const marcas = filtradas(hoy);
        if (!activas(ultimas).length) {
            cont.innerHTML = '<div class="cm-vacio"><p><strong>Tu cartera está vacía.</strong></p><p>Agrega una marca a mano o ábrela en MARCia o Marcanet y pulsa «➕ Cartera».</p></div>';
            return;
        }
        if (!marcas.length) {
            cont.innerHTML = '<p class="cm-vacio">Ninguna marca coincide con el filtro.</p>';
            return;
        }
        cont.innerHTML = '<div class="cm-tabla-marco"><table class="cm-tabla"><thead><tr><th>Marca</th><th>Clase</th><th>Titular y cliente</th><th>Estatus</th><th>Vigencia</th><th>Próximo plazo</th><th></th></tr></thead><tbody>' +
            marcas.map(m => fila(m, hoy)).join('') + '</tbody></table></div>';
    }

    function fila(m, hoy) {
        const p = proximoPlazo(m, hoy);
        const sit = situacion(m);
        const img = urlImagen(m.imagen);
        const vig = fecha(m.vigencia);
        return '<tr data-uid="' + esc(m.uid) + '">' +
            '<td class="cm-marca">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
                '<div><strong>' + esc(m.denominacion || 'Sin denominación') + '</strong><small>' + esc(numeros(m) || 'Sin número') + '</small></div></td>' +
            '<td>' + esc(m.clases.join(', ') || '—') + '</td>' +
            '<td>' + esc(m.titular || '—') + (m.cliente ? '<small>Cliente: ' + esc(m.cliente) + '</small>' : '') + '</td>' +
            '<td><span class="cm-sit cm-sit-' + sit + '">' + esc(m.estatus || SITUACION[sit]) + '</span>' +
                '<small>' + esc(m.ultimaRevision ? 'Revisado el ' + fechaCorta(m.ultimaRevision.slice(0, 10)) : 'Capturado a mano') + '</small></td>' +
            '<td>' + esc(vig ? fechaCorta(vig) : '—') + '</td>' +
            '<td>' + (p ? '<span class="cm-plazo cm-plazo-' + p.estado + '">' + esc(textoPlazo(p)) + '</span>' : '<small>—</small>') + '</td>' +
            '<td class="cm-acciones">' +
                '<button type="button" class="btn btn-sm btn-secondary" data-cm="revisar" title="Actualizar su estatus en el IMPI">🔄</button>' +
                '<button type="button" class="btn btn-sm btn-secondary" data-cm="plazos" title="Plazos y pendientes">📅</button>' +
                '<button type="button" class="btn btn-sm btn-secondary" data-cm="editar" title="Editar">✏️</button>' +
                '<button type="button" class="btn btn-sm btn-secondary" data-cm="eliminar" title="Quitar de la cartera">🗑️</button>' +
            '</td></tr>';
    }

    const deFila = b => { const tr = b.closest('tr[data-uid]'); return tr ? ultimas.find(m => m.uid === tr.dataset.uid) : null; };

    async function alHacerClic(ev) {
        const b = ev.target.closest('[data-cm]');
        if (!b) return;
        const accion = b.dataset.cm;
        if (accion === 'agregar') return abrirFormulario(null, {});
        if (accion === 'revisar-todas') return revisarTodas();
        if (accion === 'pdf') return reportePDF();
        if (accion === 'csv') return descargarCSV();
        const m = deFila(b);
        if (!m) return;
        if (accion === 'revisar') return revisarUna(m, true);
        if (accion === 'plazos') return verPlazos(m);
        if (accion === 'editar') return abrirFormulario(m, {});
        if (accion === 'eliminar') return eliminar(m);
    }

    // ---- Alta y edición ----

    async function opcionesDeExpedientes(elegido) {
        let exps = [];
        try { exps = typeof global.obtenerExpedientes === 'function' ? await global.obtenerExpedientes() : []; } catch (e) { exps = []; }
        return '<option value="">Sin vincular</option>' + exps.map(x => '<option value="' + x.id + '"' + (x.id === elegido ? ' selected' : '') + '>' +
            esc((x.numero || x.nombre || 'Expediente') + (x.cliente ? ' — ' + x.cliente : '')) + '</option>').join('');
    }

    async function clientesConocidos() {
        const nombres = new Set(activas(ultimas).map(m => texto(m.cliente)).filter(Boolean));
        try {
            const exps = typeof global.obtenerExpedientes === 'function' ? await global.obtenerExpedientes() : [];
            for (const x of exps) if (texto(x.cliente)) nombres.add(texto(x.cliente));
        } catch (e) { /* sin expedientes */ }
        return Array.from(nombres).sort((a, b) => a.localeCompare(b, 'es'));
    }

    /** El formulario. `m`: la marca a editar (o null para una nueva); `datos`: lo que llega prellenado. */
    async function abrirFormulario(m, datos) {
        const v = Object.assign({}, m || {}, limpiar(datos || {}));
        const campo = (id, etiqueta, valor, extra) => '<div class="form-group"><label for="cm-f-' + id + '">' + etiqueta + '</label>' +
            '<input id="cm-f-' + id + '" value="' + esc(valor || '') + '"' + (extra || '') + '></div>';
        const fechaCampo = (id, etiqueta, valor) => campo(id, etiqueta, fecha(valor), ' type="date"');
        const clientes = await clientesConocidos();
        $('modal-titulo').textContent = m ? '✏️ ' + (m.denominacion || 'Marca') : '➕ Agregar marca a la cartera';
        $('modal-body').innerHTML =
            '<form id="cm-form" class="cm-form" novalidate>' +
                campo('denominacion', 'Denominación *', v.denominacion, ' required') +
                '<div class="form-row">' + campo('expediente', 'Expediente', v.expediente, ' inputmode="numeric"') + campo('registro', 'Registro', v.registro, ' inputmode="numeric"') + '</div>' +
                '<p class="cm-nota cm-nota-form">Con el expediente o el registro puedes <button type="button" class="btn btn-sm btn-secondary" id="cm-llenar">🔍 Llenar desde el IMPI</button></p>' +
                '<div class="form-row">' + campo('clases', 'Clases (Niza)', (v.clases || []).join(', '), ' placeholder="35, 41"') +
                    '<div class="form-group"><label for="cm-f-tipo">Tipo</label><select id="cm-f-tipo"><option value="">—</option>' +
                    Object.entries(TIPOS).map(([k, t]) => '<option value="' + k + '"' + (v.tipo === k ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></div></div>' +
                campo('titular', 'Titular', v.titular) +
                '<div class="form-group"><label for="cm-f-cliente">Cliente</label><input id="cm-f-cliente" list="cm-clientes" value="' + esc(v.cliente || '') + '" placeholder="Para agrupar y filtrar la cartera">' +
                    '<datalist id="cm-clientes">' + clientes.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
                campo('estatus', 'Estatus en el IMPI', v.estatus, ' placeholder="REGISTRADA, EN TRÁMITE…"') +
                '<div class="form-row">' + fechaCampo('fechaPresentacion', 'Presentación', v.fechaPresentacion) + fechaCampo('fechaConcesion', 'Concesión (otorgamiento)', v.fechaConcesion) +
                    fechaCampo('vigencia', 'Fin de la vigencia', v.vigencia) + '</div>' +
                '<div class="form-group"><label for="cm-f-expedienteId">Expediente de la app (opcional)</label><select id="cm-f-expedienteId">' + await opcionesDeExpedientes(v.expedienteId) + '</select>' +
                    '<small class="form-hint">Los pendientes de sus plazos quedarán en ese expediente.</small></div>' +
                '<div class="form-group"><label for="cm-f-notas">Notas</label><textarea id="cm-f-notas" rows="2">' + esc(v.notas || '') + '</textarea></div>' +
            '</form>';
        $('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>' +
            '<button class="btn btn-primary" id="cm-guardar">💾 Guardar</button>';
        const extra = { markId: v.markId || '', imagen: v.imagen || '', fuente: v.fuente || '', ultimaRevision: v.ultimaRevision || '' };
        $('cm-llenar').addEventListener('click', () => llenarDesdeIMPI(extra));
        $('cm-guardar').addEventListener('click', () => guardarFormulario(m, extra));
        if (typeof global.abrirModal === 'function') global.abrirModal(); else $('modal-overlay').classList.add('active');
    }

    function leerFormulario() {
        const val = id => ($('cm-f-' + id) || {}).value || '';
        return {
            denominacion: val('denominacion'), expediente: val('expediente'), registro: val('registro'), clases: val('clases'), tipo: val('tipo'),
            titular: val('titular'), cliente: val('cliente'), estatus: val('estatus'), fechaPresentacion: val('fechaPresentacion'),
            fechaConcesion: val('fechaConcesion'), vigencia: val('vigencia'), expedienteId: val('expedienteId'), notas: val('notas')
        };
    }

    function ponerEnFormulario(datos) {
        const v = limpiar(datos);
        for (const [c, valor] of Object.entries(v)) {
            const el = $('cm-f-' + c);
            if (!el) continue;
            const nuevo = Array.isArray(valor) ? valor.join(', ') : valor;
            if (nuevo !== '' && nuevo != null) el.value = nuevo;
        }
    }

    async function llenarDesdeIMPI(extra) {
        const actual = leerFormulario();
        if (!digitos(actual.expediente) && !digitos(actual.registro)) { toast('Escribe primero el expediente o el registro', 'warning'); return; }
        const boton = $('cm-llenar');
        boton.disabled = true;
        boton.textContent = 'Consultando…';
        try {
            const datos = await consultarIMPI({ ...actual, markId: extra.markId });
            ponerEnFormulario(datos);
            Object.assign(extra, { markId: datos.markId || extra.markId, imagen: datos.imagen || extra.imagen, fuente: datos.fuente || extra.fuente, ultimaRevision: sello() });
            toast(datos.denominacion ? 'Datos del IMPI cargados: revísalos antes de guardar' : 'El IMPI no devolvió datos de ese número', datos.denominacion ? 'success' : 'warning');
        } catch (e) {
            toast('No se pudo consultar el IMPI: ' + e.message, 'error');
        } finally {
            boton.disabled = false;
            boton.textContent = '🔍 Llenar desde el IMPI';
        }
    }

    async function guardarFormulario(m, extra) {
        const datos = leerFormulario();
        if (!texto(datos.denominacion)) { toast('Falta la denominación', 'warning'); $('cm-f-denominacion').focus(); return; }
        const completos = { ...datos, ...Object.fromEntries(Object.entries(extra).filter(([, x]) => x)) };
        try {
            if (m) {
                await guardarCambios(m.uid, completos);
                toast('Marca actualizada', 'success');
            } else {
                const r = await guardarNueva(completos);
                toast(r.yaEstaba ? 'Esa marca ya estaba en la cartera (mismo expediente o registro)' : 'Marca agregada a la cartera', r.yaEstaba ? 'warning' : 'success');
            }
            if (typeof global.cerrarModal === 'function') global.cerrarModal();
            await refrescar();
        } catch (e) {
            toast('No se pudo guardar: ' + e.message, 'error');
        }
    }

    /** Abre el formulario con lo de una ficha de MARCia o Marcanet (botón «➕ Cartera»). */
    async function agregarDesde(datos) {
        try { ultimas = await leer(); } catch (e) { /* sin base */ }
        const misma = buscarMisma(ultimas, limpiar(datos));
        if (misma) {
            toast('Esa marca ya está en tu cartera: se abre para que la revises', 'info');
            return abrirFormulario(misma, {});
        }
        return abrirFormulario(null, datos);
    }

    async function eliminar(m) {
        if (!confirm('¿Quitar «' + (m.denominacion || 'esta marca') + '» de la cartera?\n\nLos pendientes que ya se crearon se quedan.')) return;
        await guardarCambios(m.uid, { eliminada: sello() });
        toast('Marca quitada de la cartera', 'success');
        await refrescar();
    }

    // ---- Consultar el IMPI ----

    async function fichaCompleta(cuerpo) {
        return global.proxyFetch('/marcanet/full-detail', { method: 'POST', body: JSON.stringify(cuerpo) });
    }

    const leerDetalleMarcanet = () => (global.VIABILIDAD && global.VIABILIDAD.leerDetalleMarcanet) || null;

    /** Lo que dice el IMPI hoy de una marca: la ficha de MARCia (si se conoce) y la de Marcanet. */
    async function consultarIMPI(m) {
        if (typeof global.proxyFetch !== 'function') throw new Error('la consulta al IMPI no está disponible');
        const exp = digitos(m.expediente), reg = digitos(m.registro);
        let deMARCia = null;
        if (m.markId && typeof global.obtenerMarcaEnSegundoPlano === 'function') {
            const pedir = () => global.obtenerMarcaEnSegundoPlano(m.markId);
            const data = typeof global.conUnReintentoDeSesion === 'function' ? await global.conUnReintentoDeSesion(pedir) : await pedir();
            deMARCia = desdeFichaMARCia(data);
        }
        const numero = digitos(deMARCia && deMARCia.expediente) || exp;
        if (!numero && !reg) {
            if (deMARCia) return combinar(deMARCia, null);
            throw new Error('hace falta el expediente o el registro');
        }
        let completa = null;
        try {
            completa = await fichaCompleta(numero ? { expediente: numero } : { registro: reg });
        } catch (e) {
            if (!deMARCia) throw e;
        }
        if (completa && completa.marcia && !deMARCia) deMARCia = desdeFichaMARCia(completa.marcia);
        const deMarcanet = completa && completa.detail ? desdeFichaMarcanet(completa.detail, Date.now(), leerDetalleMarcanet()) : null;
        return combinar(deMARCia, deMarcanet);
    }

    async function revisarUna(m, conAviso) {
        let datos;
        try {
            datos = await consultarIMPI(m);
        } catch (e) {
            if (conAviso) toast('No se pudo consultar «' + (m.denominacion || 'la marca') + '»: ' + e.message, 'error');
            return { error: e };
        }
        let resultado = null;
        await guardarCambios(m.uid, actual => {
            resultado = revisar(actual, datos, sello());
            return resultado.marca;
        });
        if (conAviso) {
            toast(resultado.cambioEstatus ? '«' + m.denominacion + '» cambió de estatus: ' + resultado.antes + ' → ' + resultado.despues
                : 'Estatus de «' + m.denominacion + '» al día', resultado.cambioEstatus ? 'warning' : 'success');
            await refrescar();
        }
        return resultado;
    }

    /** Actualiza las que llevan más tiempo sin revisar, de una en una, sin pasar de MAX_REVISION por vez. */
    async function revisarTodas() {
        if (ui.revisando) return;
        const candidatas = activas(ultimas).filter(m => digitos(m.expediente) || digitos(m.registro) || m.markId)
            .sort((a, b) => (a.ultimaRevision || '').localeCompare(b.ultimaRevision || ''));
        if (!candidatas.length) { toast('Ninguna marca tiene expediente o registro para consultar', 'warning'); return; }
        const lote = candidatas.slice(0, MAX_REVISION);
        ui.revisando = true;
        let cambios = 0, fallos = 0;
        try {
            for (let i = 0; i < lote.length; i++) {
                toast('Consultando el IMPI: ' + (i + 1) + ' de ' + lote.length, 'info');
                const r = await revisarUna(lote[i], false);
                if (!r || r.error) fallos++;
                else if (r.cambioEstatus) cambios++;
                await new Promise(res => setTimeout(res, 400));
            }
        } finally {
            ui.revisando = false;
        }
        await refrescar();
        toast(lote.length + ' marca' + (lote.length === 1 ? '' : 's') + ' revisada' + (lote.length === 1 ? '' : 's') +
            (cambios ? '; ' + cambios + ' cambió de estatus' : '') + (fallos ? '; ' + fallos + ' sin respuesta del IMPI' : '') +
            (candidatas.length > lote.length ? '. Faltan ' + (candidatas.length - lote.length) + ': vuelve a pulsar para seguir.' : '.'),
            fallos ? 'warning' : 'success');
    }

    // ---- Plazos ----

    async function verPlazos(m) {
        const hoy = hoyTexto();
        const plazos = plazosVigentes(plazosDe(m, hoy));
        $('modal-titulo').textContent = '📅 Plazos de «' + (m.denominacion || 'la marca') + '»';
        const sit = situacion(m);
        let cuerpo;
        if (sit !== 'registrada') {
            cuerpo = '<p class="cm-vacio">' + (sit === 'tramite' ? 'Está en trámite: los plazos de declaración de uso y renovación empiezan a contar cuando se otorga el registro.'
                : 'Con su estatus actual no tiene plazos de declaración de uso ni de renovación.') + '</p>';
        } else if (!plazos.length) {
            cuerpo = '<p class="cm-vacio">Faltan sus fechas de concesión y de vigencia para calcular los plazos. Captúralas o usa «🔍 Llenar desde el IMPI» al editarla.</p>';
        } else {
            cuerpo = '<ul class="cm-plazos">' + plazos.map(p =>
                '<li class="cm-plazo-item" data-clave="' + esc(p.clave) + '">' +
                    '<div><strong>' + esc(p.titulo) + '</strong> <span class="cm-plazo cm-plazo-' + p.estado + '">' + esc(ESTADOS[p.estado]) + '</span>' +
                    '<small>Del ' + esc(fechaCorta(p.desde)) + ' al ' + esc(fechaCorta(p.hasta)) + (p.estimado ? ' · fecha estimada: confirma la vigencia' : '') + '</small></div>' +
                    '<div class="cm-plazo-botones">' +
                        (p.pendienteId != null ? '<button type="button" class="btn btn-sm btn-secondary" data-cm-plazo="ver">✅ Ver pendiente</button>'
                            : '<button type="button" class="btn btn-sm btn-primary" data-cm-plazo="pendiente">✅ Crear pendiente</button>') +
                        '<button type="button" class="btn btn-sm btn-secondary" data-cm-plazo="atendido">' + (p.atendido ? 'Desmarcar atendido' : 'Marcar atendido') + '</button>' +
                    '</div></li>').join('') + '</ul>' +
                '<p class="cm-nota">La declaración de uso se presenta dentro de los tres meses siguientes a que se cumplan tres años de otorgado el registro (registros otorgados desde el 5 de noviembre de 2020). La renovación, en los seis meses anteriores al fin de la vigencia, con seis meses de gracia después. Confírmalo en el expediente antes de actuar.</p>';
        }
        $('modal-body').innerHTML = '<div class="cm-modal-plazos">' + cuerpo + '</div>';
        $('modal-footer').innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>';
        $('modal-body').querySelectorAll('[data-cm-plazo]').forEach(b => b.addEventListener('click', async () => {
            const clave = b.closest('[data-clave]').dataset.clave;
            const p = plazos.find(x => x.clave === clave);
            if (!p) return;
            const accion = b.dataset.cmPlazo;
            if (accion === 'pendiente') await crearPendiente(m, p);
            if (accion === 'atendido') await guardarCambios(m.uid, { atendidos: { [clave]: p.atendido ? null : sello() } });
            if (accion === 'ver') { if (typeof global.cerrarModal === 'function') global.cerrarModal(); if (typeof global.navegarA === 'function') global.navegarA('pendientes'); return; }
            await refrescar();
            const actual = ultimas.find(x => x.uid === m.uid);
            if (actual) verPlazos(actual);
        }));
        if (typeof global.abrirModal === 'function') global.abrirModal(); else $('modal-overlay').classList.add('active');
    }

    async function crearPendiente(m, p) {
        if (typeof global.crearPendienteCore !== 'function') { toast('Los pendientes no están disponibles', 'warning'); return; }
        const [y, mes, d] = p.hasta.split('-').map(Number);
        const prioridad = p.estado === 'en_curso' || p.estado === 'vencido' ? 'alta' : p.estado === 'proximo' ? 'media' : '';
        const id = await global.crearPendienteCore({
            titulo: p.titulo + ': «' + m.denominacion + '»' + (numeros(m) ? ' (' + numeros(m) + ')' : ''),
            descripcion: 'Plazo del ' + fechaCorta(p.desde) + ' al ' + fechaCorta(p.hasta) + (p.estimado ? ' (fecha estimada: confirma la vigencia)' : '') + '.' +
                (m.cliente ? ' Cliente: ' + m.cliente + '.' : '') + (m.titular ? ' Titular: ' + m.titular + '.' : '') + ' Desde la cartera de marcas.',
            fechaLimite: new Date(y, mes - 1, d).toISOString(),
            todoElDia: true,
            prioridad,
            expedienteId: m.expedienteId != null ? m.expedienteId : null,
            expedienteTexto: m.expedienteId != null ? null : 'Marca ' + m.denominacion + (m.cliente ? ' — ' + m.cliente : '')
        });
        await guardarCambios(m.uid, { pendientes: { [p.clave]: id } });
        toast('Pendiente creado para el ' + fechaCorta(p.hasta), 'success');
    }

    // ---- Reportes ----

    function reportePDF() {
        const R = global.REPORTES_PDF;
        if (!R || typeof R.pedirYDescargar !== 'function') { toast('El generador de PDF no está disponible', 'warning'); return; }
        if (!activas(ultimas).filter(m => esDelCliente(m, ui.cliente)).length) { toast('No hay marcas que reportar con este filtro', 'warning'); return; }
        const marcas = ultimas.slice();
        const cliente = ui.cliente;
        R.pedirYDescargar({
            titulo: 'Reporte de cartera en PDF' + (cliente ? ' — ' + cliente : ''),
            para: cliente,
            construir: op => R.documentoCartera(datosParaReporte(marcas, { cliente, ahora: Date.now() }), op),
            archivo: op => R.nombreArchivo(['Cartera de marcas', op.para || cliente], new Date().toISOString())
        });
    }

    function descargarCSV() {
        const hoy = hoyTexto();
        const marcas = activas(ultimas).filter(m => esDelCliente(m, ui.cliente));
        if (!marcas.length) { toast('No hay marcas que exportar', 'warning'); return; }
        const nombre = 'cartera-marcas' + (ui.cliente ? '-' + normal(ui.cliente).toLowerCase().replace(/[^a-z0-9]+/g, '-') : '') + '-' + hoy + '.csv';
        if (typeof global.descargarArchivo === 'function') global.descargarArchivo(nombre, csv(marcas, hoy), 'text/csv;charset=utf-8');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', construir); else construir();

    // La base se abre después de pintar: en cuanto esté, se lee la cartera.
    const esperarBase = setInterval(() => {
        if (baseDeDatos()) { clearInterval(esperarBase); refrescar(); }
    }, 300);

    global.obtenerCarteraMarcas = leer;
    global.aplicarCarteraMarcas = aplicarRemotas;
    global.fusionarCarteraMarcas = fusionar;
    global.CARTERA_MARCAS = Object.assign({}, Motor, { construir, refrescar, agregarDesde, consultarIMPI, leer });
})(typeof window !== 'undefined' ? window : globalThis);
