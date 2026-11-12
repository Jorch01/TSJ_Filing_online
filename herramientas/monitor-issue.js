#!/usr/bin/env node
/**
 * Abre, actualiza o cierra el issue del monitor de integraciones.
 *
 *   node herramientas/monitor-issue.js resultado.json informe.md
 *
 * Lee lo que dejó herramientas/monitor-integraciones.js (--json y --markdown) y:
 *   - hay fallas y no hay issue abierto  → lo abre;
 *   - hay fallas y ya hay uno abierto    → lo actualiza (y deja un comentario
 *                                           solo si cambió QUÉ está fallando,
 *                                           para no llenar de ruido);
 *   - no hay fallas y hay uno abierto    → comenta que se recuperó y lo cierra.
 * Las pruebas omitidas y los avisos no abren issue.
 *
 * Es un repositorio público: el cuerpo es el informe del monitor, que ya viene
 * limpio de secretos y de datos de clientes (ver limpiar() allá). Aquí no se
 * agrega nada más que ids de prueba y la fecha.
 *
 * Necesita GITHUB_TOKEN (permiso issues: write) y GITHUB_REPOSITORY.
 */

'use strict';

const fs = require('fs');

const ETIQUETA = 'monitor-integraciones';
const MARCA = '<!-- monitor-integraciones -->';
const API = 'https://api.github.com';

const idsConFalla = (resultado) => resultado.chequeos.filter(c => c.estado === 'falla').map(c => c.id).sort();

function cuerpoDelIssue(informe, fallas) {
    return MARCA + '\n<!-- fallas: ' + fallas.join(',') + ' -->\n' +
        'El monitor diario de integraciones detectó que algo dejó de responder como la app espera.\n\n' +
        informe + '\n' +
        '_Este issue lo abre, actualiza y cierra solo el workflow "Monitor de integraciones". ' +
        'No contiene datos de clientes: las consultas son fijas y el informe se limpia de secretos._\n';
}

function titulo(fallas) {
    const t = 'Integraciones con falla: ' + fallas.join(', ');
    return t.length > 120 ? t.slice(0, 117) + '…' : t;
}

/** ids que el issue abierto ya tenía anotados como fallando. */
function fallasAnotadas(cuerpo) {
    const m = /<!-- fallas: ([^>]*?) -->/.exec(cuerpo || '');
    return m && m[1] ? m[1].split(',') : [];
}

/**
 * Hace lo que toca. `deps` = { fetch, repo, token }.
 * Devuelve { accion: 'abierto' | 'actualizado' | 'cerrado' | 'nada', numero }.
 */
async function sincronizar(deps, resultado, informe) {
    const { fetch: f, repo, token } = deps;
    const llamar = async (ruta, metodo, cuerpo) => {
        const r = await f(API + '/repos/' + repo + ruta, {
            method: metodo || 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                'User-Agent': 'TSJ-Monitor-Integraciones'
            },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
        });
        const texto = await r.text();
        let json = null;
        try { json = JSON.parse(texto); } catch (e) { /* sin cuerpo */ }
        return { status: r.status, json };
    };

    const fallas = idsConFalla(resultado);

    const lista = await llamar('/issues?state=open&labels=' + ETIQUETA + '&per_page=20');
    if (lista.status !== 200 || !Array.isArray(lista.json)) throw new Error('No se pudo listar los issues (HTTP ' + lista.status + ')');
    const abierto = lista.json.find(i => !i.pull_request && String(i.body || '').includes(MARCA));

    if (fallas.length) {
        const cuerpo = cuerpoDelIssue(informe, fallas);
        if (!abierto) {
            // La etiqueta puede no existir todavía; si ya existe da 422 y no importa.
            await llamar('/labels', 'POST', { name: ETIQUETA, color: 'd93f0b', description: 'Abierto por el monitor diario de integraciones' });
            const c = await llamar('/issues', 'POST', { title: titulo(fallas), body: cuerpo, labels: [ETIQUETA] });
            if (c.status !== 201) throw new Error('No se pudo abrir el issue (HTTP ' + c.status + ')');
            return { accion: 'abierto', numero: c.json.number };
        }
        const antes = fallasAnotadas(abierto.body);
        const p = await llamar('/issues/' + abierto.number, 'PATCH', { title: titulo(fallas), body: cuerpo });
        if (p.status !== 200) throw new Error('No se pudo actualizar el issue #' + abierto.number + ' (HTTP ' + p.status + ')');
        if (antes.join(',') !== fallas.join(',')) {
            const nuevas = fallas.filter(x => !antes.includes(x));
            const recuperadas = antes.filter(x => !fallas.includes(x));
            await llamar('/issues/' + abierto.number + '/comments', 'POST', {
                body: 'Cambió lo que está fallando.' +
                    (nuevas.length ? ' Nuevas: ' + nuevas.map(x => '`' + x + '`').join(', ') + '.' : '') +
                    (recuperadas.length ? ' Recuperadas: ' + recuperadas.map(x => '`' + x + '`').join(', ') + '.' : '') +
                    ' El detalle está en la descripción del issue.'
            });
        }
        return { accion: 'actualizado', numero: abierto.number };
    }

    if (!abierto) return { accion: 'nada' };
    const r = resultado.resumen;
    await llamar('/issues/' + abierto.number + '/comments', 'POST', {
        body: 'Recuperado: en la última ejecución (' + resultado.generado + ') no falló ninguna prueba (' +
            r.ok + ' bien, ' + r.omitida + ' omitidas, ' + r.aviso + ' avisos). Se cierra solo.'
    });
    const c = await llamar('/issues/' + abierto.number, 'PATCH', { state: 'closed', state_reason: 'completed' });
    if (c.status !== 200) throw new Error('No se pudo cerrar el issue #' + abierto.number + ' (HTTP ' + c.status + ')');
    return { accion: 'cerrado', numero: abierto.number };
}

async function main(argv) {
    const [rutaJson, rutaMd] = argv;
    if (!rutaJson || !rutaMd) { console.error('Uso: monitor-issue.js resultado.json informe.md'); return 2; }
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) { console.error('Faltan GITHUB_TOKEN o GITHUB_REPOSITORY'); return 2; }
    const resultado = JSON.parse(fs.readFileSync(rutaJson, 'utf8'));
    const informe = fs.readFileSync(rutaMd, 'utf8');
    const r = await sincronizar({ fetch, repo: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN }, resultado, informe);
    console.log('Issue: ' + r.accion + (r.numero ? ' #' + r.numero : ''));
    return 0;
}

module.exports = { ETIQUETA, MARCA, sincronizar, idsConFalla, cuerpoDelIssue, fallasAnotadas, titulo };

if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c), e => { console.error('Error:', e.message); process.exit(2); });
