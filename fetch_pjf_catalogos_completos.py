#!/usr/bin/env python3
"""
Regenera docs/data/pjf_catalogos_completos.json desde el portal del PJF.

    python3 fetch_pjf_catalogos_completos.py --limite 3   # primera vuelta: 3 órganos
    python3 fetch_pjf_catalogos_completos.py              # barrido completo (~22 min)
    python3 fetch_pjf_catalogos_completos.py --escribir   # sobrescribe, tras revisar el diff
    python3 fetch_pjf_catalogos_completos.py --desde-cero # olvida lo ya descargado

De dónde sale cada cosa. Son los mismos GET que hace el formulario público de
incidencias (juicioenlinea/Incidencia/IncidenciaOrgano), todos JSON:

    Catalogos/GetEntidadFederativa                           → los 32 estados
    Catalogos/GetOrganosJurisdiccionalesPorEntidadFederativa → órganos de un estado
    Catalogos/GetTiposAsunto?idOrgano=                       → tipos de asunto de un órgano
    Catalogos/GetTiposProcedimiento?idTipoAsunto=            → procedimientos de un tipo

No hace falta navegador: nada de esto pasa por __VIEWSTATE.

Por estado, el portal devuelve también cientos de dependencias locales
(secretarías, ayuntamientos) con CircuitoRegion "Local"; esas no son del PJF y
se descartan.

Reanudable: cada respuesta se añade como una línea a un JSONL en
.cache/pjf_catalogo/. Al reiniciar se salta lo que ya tiene línea. Una
petición que falla no deja línea, así que la siguiente vuelta la repite.

Nunca sobrescribe el catálogo por su cuenta: deja el resultado en
.cache/pjf_catalogo/pjf_catalogos_completos.json, imprime el diff contra el
actual y solo lo copia a docs/data/ con --escribir.

Como mucho una petición por segundo, reintentos incluidos.

Requisitos:  pip install requests
"""

import argparse
import datetime
import json
import os
import shutil
import sys
import time

try:
    import requests
except ImportError:
    sys.exit('Falta la librería "requests". Instálala con: pip install requests')

BASE = 'https://www.serviciosenlinea.pjf.gob.mx/juicioenlinea/juicioenlinea/Catalogos/'
INTERVALO = 1.0      # segundos mínimos entre peticiones; no bajarlo
REINTENTOS = 3

RAIZ = os.path.dirname(os.path.abspath(__file__))
ACTUAL = os.path.join(RAIZ, 'docs', 'data', 'pjf_catalogos_completos.json')
CACHE = os.path.join(RAIZ, '.cache', 'pjf_catalogo')
ESTADOS = os.path.join(CACHE, 'estados.json')
LISTADOS = os.path.join(CACHE, 'organos_por_estado.jsonl')   # una línea por estado
ORGANOS = os.path.join(CACHE, 'organos.jsonl')               # una línea por órgano
PROCEDIMIENTOS = os.path.join(CACHE, 'procedimientos.jsonl') # una línea por tipo de asunto
NUEVO = os.path.join(CACHE, 'pjf_catalogos_completos.json')
DIFF = os.path.join(CACHE, 'diff.txt')


# ==================== RED ====================

class Portal:
    """Cliente con un solo ritmo: nunca dos peticiones a menos de INTERVALO."""

    def __init__(self):
        self.sesion = requests.Session()
        self.sesion.headers.update({
            'User-Agent': 'Mozilla/5.0 (TSJ_Filing_online; catálogo PJF)',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
        })
        self.ultima = 0.0
        self.peticiones = 0

    def _esperar(self):
        falta = INTERVALO - (time.monotonic() - self.ultima)
        if falta > 0:
            time.sleep(falta)
        self.ultima = time.monotonic()

    def items(self, metodo, **params):
        """Los Items de la respuesta, o None si no hubo forma de obtenerlos."""
        motivo = ''
        for intento in range(REINTENTOS):
            if intento:
                time.sleep(2 * intento)          # además del segundo de rigor
            self._esperar()
            self.peticiones += 1
            try:
                r = self.sesion.get(BASE + metodo, params=params, timeout=30)
                if r.status_code != 200:
                    motivo = f'HTTP {r.status_code}'
                    continue
                datos = r.json()                 # el portal lo sirve como text/html
                if not datos.get('Success', True) or not isinstance(datos.get('Items'), list):
                    motivo = f'respuesta sin éxito: {str(datos.get("ErrorList"))[:80]}'
                    continue
                return datos['Items']
            except (requests.RequestException, ValueError) as e:
                motivo = type(e).__name__ + ': ' + str(e)[:80]
        print(f'      ✗ {metodo} {params}: {motivo}', flush=True)
        return None


# ==================== JSONL REANUDABLE ====================

def leer_jsonl(ruta, clave):
    """{clave: registro}. Una última línea a medias (corte brusco) se ignora."""
    hechos = {}
    if not os.path.exists(ruta):
        return hechos
    with open(ruta, encoding='utf-8') as f:
        for linea in f:
            try:
                reg = json.loads(linea)
            except ValueError:
                continue
            hechos[reg[clave]] = reg
    return hechos


def anadir_jsonl(ruta, reg):
    with open(ruta, 'a', encoding='utf-8') as f:
        f.write(json.dumps(reg, ensure_ascii=False) + '\n')
        f.flush()
        os.fsync(f.fileno())


# ==================== DESCARGA ====================

def es_federal(item):
    return item.get('CircuitoRegion') != 'Local' and item.get('ClasificacionOrganismoId') != 18


def organo_desde(item):
    return {
        'id': item['OrganoId'],
        'nombre': item['Organo'],
        'tipoOrganismoId': item['TipoOrganismoId'],
        'tipoOrganismo': item['TipoOrganismo'],
        'materiaId': item['MateriaOrganismoId'],
        'circuitoId': item['CircuitoRegionId'],
        'circuito': item['CircuitoRegion'],
        'estadoId': item['EntidadFederativaId'],
        'estado': item['EntidadFederativa'],
        'ciudad': item['Ciudad'],
    }


def descargar_estados(portal):
    if os.path.exists(ESTADOS):
        with open(ESTADOS, encoding='utf-8') as f:
            return json.load(f)
    print('Estados…', flush=True)
    items = portal.items('GetEntidadFederativa')
    if items is None:
        sys.exit('No pude obtener la lista de estados; sin ella no hay nada que hacer.')
    estados = [{'id': e['EntidadFederativaId'], 'nombre': e['Nombre']} for e in items]
    with open(ESTADOS, 'w', encoding='utf-8') as f:
        json.dump(estados, f, ensure_ascii=False, indent=1)
    return estados


def descargar_listados(portal, estados, limite):
    """Órganos federales, en el orden del portal: estado por estado."""
    hechos = leer_jsonl(LISTADOS, 'estadoId')
    organos, pendientes = [], []
    for e in estados:
        if limite and len(organos) >= limite:
            break
        if e['id'] not in hechos:
            print(f'Órganos de {e["nombre"]}…', flush=True)
            items = portal.items('GetOrganosJurisdiccionalesPorEntidadFederativa',
                                 EntidadFederativaId=e['id'])
            if items is None:
                pendientes.append(e['nombre'])
                continue
            federales = [organo_desde(i) for i in items if es_federal(i)]
            hechos[e['id']] = {'estadoId': e['id'], 'estado': e['nombre'],
                               'descartados_locales': len(items) - len(federales),
                               'organos': federales}
            anadir_jsonl(LISTADOS, hechos[e['id']])
            print(f'   {len(federales)} federales ({len(items) - len(federales)} locales descartados)')
        organos.extend(hechos[e['id']]['organos'])
    return (organos[:limite] if limite else organos), pendientes


def descargar_tipos(portal, organos):
    hechos = leer_jsonl(ORGANOS, 'id')
    faltan = [o for o in organos if o['id'] not in hechos]
    if faltan:
        print(f'\nTipos de asunto: {len(organos) - len(faltan)} ya descargados, '
              f'faltan {len(faltan)} (~{len(faltan) // 60 + 1} min)', flush=True)
    pendientes = []
    for n, o in enumerate(faltan, 1):
        print(f'  [{n}/{len(faltan)}] {o["id"]:>6}  {o["nombre"][:70]}', flush=True)
        items = portal.items('GetTiposAsunto', idOrgano=o['id'])
        if items is None:
            pendientes.append(o)
            continue
        reg = dict(o, tiposAsunto=[{'id': t['TipoAsuntoId'], 'nombre': t['Descripcion']} for t in items])
        hechos[o['id']] = reg
        anadir_jsonl(ORGANOS, reg)
        print('         ' + (', '.join(f'{t["id"]} {t["nombre"]}' for t in reg['tiposAsunto'])[:110]
                             or '(sin tipos de asunto)'))
    return hechos, pendientes


def descargar_procedimientos(portal, ids_tipo):
    hechos = leer_jsonl(PROCEDIMIENTOS, 'idTipoAsunto')
    faltan = [i for i in sorted(ids_tipo) if i not in hechos]
    if faltan:
        print(f'\nProcedimientos: faltan {len(faltan)} tipos de asunto', flush=True)
    pendientes = []
    for i in faltan:
        items = portal.items('GetTiposProcedimiento', idTipoAsunto=i)
        if items is None:
            pendientes.append(i)
            continue
        hechos[i] = {'idTipoAsunto': i, 'tiposProcedimiento': [
            {'id': p['IdTipoProcedimiento'], 'nombre': p['TipoProcedimiento']} for p in items]}
        anadir_jsonl(PROCEDIMIENTOS, hechos[i])
    return hechos, pendientes


# ==================== ARMADO ====================

def armar(organos, tipos, procs):
    """Mismo esquema que el catálogo actual."""
    # Una entrada por (tipo de órgano, materia), en orden de primera aparición.
    # Sus tipos de asunto son la UNIÓN de los de todos sus órganos: si uno solo
    # de ellos admite "Ejecución de Penas", el buscador tiene que ofrecerlo.
    grupos = {}
    for o in organos:
        clave = (o['tipoOrganismoId'], o['materiaId'])
        g = grupos.setdefault(clave, {'TipoOrganismoId': clave[0], 'TipoOrganismo': o['tipoOrganismo'],
                                      'MateriaOrganismoId': clave[1], 'tiposAsunto': {}})
        for t in tipos[o['id']]['tiposAsunto']:
            g['tiposAsunto'].setdefault(t['id'], t['nombre'])
    tipos_organo = []
    for g in grupos.values():
        g['tiposAsunto'] = sorted(({'id': i, 'nombre': n} for i, n in g['tiposAsunto'].items()),
                                  key=lambda t: t['nombre'])
        tipos_organo.append(g)

    nombres = {t['id']: t['nombre'] for g in tipos_organo for t in g['tiposAsunto']}
    tipos_asunto = [{'id': i, 'nombre': nombres[i],
                     'tiposProcedimiento': procs[i]['tiposProcedimiento']}
                    for i in sorted(nombres)]

    ahora = datetime.datetime.now(datetime.timezone.utc)
    return {
        'generado': ahora.strftime('%Y-%m-%dT%H:%M:%S.') + f'{ahora.microsecond // 1000:03d}Z',
        'resumen': {'totalOrganos': len(organos), 'totalTiposAsunto': len(tipos_asunto),
                    'totalRelaciones': len(tipos_organo)},
        'tiposAsunto': tipos_asunto,
        'tiposOrgano': tipos_organo,
        'organos': organos,
    }


# ==================== DIFF ====================

CAMPOS = ['nombre', 'tipoOrganismoId', 'tipoOrganismo', 'materiaId', 'circuitoId',
          'circuito', 'estadoId', 'estado', 'ciudad']


def diff_organos(viejos, nuevos, out):
    v = {o['id']: o for o in viejos}
    n = {o['id']: o for o in nuevos}
    altas = [n[i] for i in n if i not in v]
    bajas = [v[i] for i in v if i not in n]
    cambios = [(v[i], n[i]) for i in n if i in v and any(v[i].get(c) != n[i].get(c) for c in CAMPOS)]
    out(f'\n── ÓRGANOS: {len(v)} → {len(n)}   (+{len(altas)} −{len(bajas)} ~{len(cambios)})')
    for o in altas:
        out(f'  + {o["id"]:>6}  {o["nombre"]}  [{o["estado"]} · {o["circuito"]} · {o["tipoOrganismo"]}]')
    for o in bajas:
        out(f'  − {o["id"]:>6}  {o["nombre"]}  [{o["estado"]}]')
    for a, b in cambios:
        out(f'  ~ {a["id"]:>6}  {b["nombre"]}')
        for c in CAMPOS:
            if a.get(c) != b.get(c):
                out(f'        {c}: {a.get(c)!r} → {b.get(c)!r}')
    comunes = [i for i in n if i in v]
    orden_v = [i for i in v if i in n]
    if comunes != orden_v:
        out('  (el orden de los órganos comunes cambió)')

    circ_v = {(o['circuitoId'], o['circuito']) for o in viejos}
    circ_n = {(o['circuitoId'], o['circuito']) for o in nuevos}
    out(f'\n── CIRCUITOS: {len({c[0] for c in circ_v})} → {len({c[0] for c in circ_n})}')
    for c in sorted(circ_n - circ_v):
        out(f'  + {c[0]:>4}  {c[1]}')
    for c in sorted(circ_v - circ_n):
        out(f'  − {c[0]:>4}  {c[1]}')


def diff_tipos_organo(viejos, nuevos, out, solo=None):
    v = {(t['TipoOrganismoId'], t['MateriaOrganismoId']): t for t in viejos}
    n = {(t['TipoOrganismoId'], t['MateriaOrganismoId']): t for t in nuevos}
    claves = [k for k in n if solo is None or k in solo]
    out(f'\n── TIPOS DE ÓRGANO × MATERIA: {len(v)} → {len(n)}' if solo is None else
        '\n── TIPOS DE ASUNTO de esos órganos, contra su entrada (tipo, materia) actual')
    if solo is None:
        for k in n:
            if k not in v:
                out(f'  + {k}  {n[k]["TipoOrganismo"]}  ({len(n[k]["tiposAsunto"])} tipos de asunto)')
        for k in v:
            if k not in n:
                out(f'  − {k}  {v[k]["TipoOrganismo"]}')
    for k in claves:
        if k not in v:
            continue
        ids_v = {t['id']: t['nombre'] for t in v[k]['tiposAsunto']}
        ids_n = {t['id']: t['nombre'] for t in n[k]['tiposAsunto']}
        mas = [i for i in ids_n if i not in ids_v]
        menos = [i for i in ids_v if i not in ids_n]
        renom = [i for i in ids_n if i in ids_v and ids_n[i] != ids_v[i]]
        if mas or menos or renom or solo is not None:
            out(f'  {k}  {n[k]["TipoOrganismo"]}' + ('' if mas or menos or renom else '  = sin cambios'))
            for i in mas:
                out(f'      + {i:>4}  {ids_n[i]}')
            for i in menos:
                out(f'      − {i:>4}  {ids_v[i]}')
            for i in renom:
                out(f'      ~ {i:>4}  {ids_v[i]!r} → {ids_n[i]!r}')


def diff_tipos_asunto(viejos, nuevos, out):
    v = {t['id']: t for t in viejos}
    n = {t['id']: t for t in nuevos}
    out(f'\n── TIPOS DE ASUNTO: {len(v)} → {len(n)}')
    for i in n:
        if i not in v:
            out(f'  + {i:>4}  {n[i]["nombre"]}')
        elif v[i]['nombre'] != n[i]['nombre']:
            out(f'  ~ {i:>4}  {v[i]["nombre"]!r} → {n[i]["nombre"]!r}')
        elif len(v[i]['tiposProcedimiento']) != len(n[i]['tiposProcedimiento']):
            out(f'  ~ {i:>4}  {n[i]["nombre"]}: procedimientos {len(v[i]["tiposProcedimiento"])}'
                f' → {len(n[i]["tiposProcedimiento"])}')
    for i in v:
        if i not in n:
            out(f'  − {i:>4}  {v[i]["nombre"]}')
    vacios = sum(1 for t in viejos for p in t['tiposProcedimiento'] if p == {})
    if vacios:
        out(f'  Nota: el actual guarda sus {vacios} procedimientos como {{}} vacíos '
            f'(se perdieron al serializarlo); el nuevo los trae con id y nombre.')


# ==================== MAIN ====================

def main():
    p = argparse.ArgumentParser(description='Regenera el catálogo de órganos del PJF.')
    p.add_argument('--limite', type=int, metavar='N', help='Solo los primeros N órganos (prueba)')
    p.add_argument('--escribir', action='store_true',
                   help=f'Copiar el resultado sobre {os.path.relpath(ACTUAL, RAIZ)} (tras ver el diff)')
    p.add_argument('--desde-cero', action='store_true', help='Borrar lo descargado y empezar de nuevo')
    args = p.parse_args()

    if args.desde_cero and os.path.isdir(CACHE):
        shutil.rmtree(CACHE)
    os.makedirs(CACHE, exist_ok=True)

    with open(ACTUAL, encoding='utf-8') as f:
        actual = json.load(f)

    portal = Portal()
    try:
        estados = descargar_estados(portal)
        organos, estados_pendientes = descargar_listados(portal, estados, args.limite)
        tipos, organos_pendientes = descargar_tipos(portal, organos)
        ids_tipo = {t['id'] for o in organos if o['id'] in tipos for t in tipos[o['id']]['tiposAsunto']}
        procs, procs_pendientes = descargar_procedimientos(portal, ids_tipo)
    except KeyboardInterrupt:
        print(f'\nInterrumpido tras {portal.peticiones} peticiones. '
              'Lo descargado está guardado; vuelve a correrlo para seguir.')
        return 130

    print(f'\n{portal.peticiones} peticiones en esta vuelta.')
    if estados_pendientes or organos_pendientes or procs_pendientes:
        print('Quedaron pendientes (vuelve a correrlo para reintentarlos):')
        if estados_pendientes:
            print('  estados:', ', '.join(estados_pendientes))
        if organos_pendientes:
            print('  órganos:', ', '.join(str(o['id']) for o in organos_pendientes))
        if procs_pendientes:
            print('  tipos de asunto:', procs_pendientes)
        print('No armo el catálogo con huecos.')
        return 1

    lineas = []

    def out(s=''):
        print(s)
        lineas.append(s)

    out('═' * 72)
    if args.limite:
        # Una prueba parcial no es un catálogo: solo se comparan esos órganos.
        out(f'  PRUEBA con {len(organos)} órganos — no se arma catálogo ni se escribe nada')
        out('═' * 72)
        ids = {o['id'] for o in organos}
        diff_organos([o for o in actual['organos'] if o['id'] in ids], organos, out)
        parcial = armar(organos, tipos, procs)
        diff_tipos_organo(actual['tiposOrgano'], parcial['tiposOrgano'], out,
                          solo={(o['tipoOrganismoId'], o['materiaId']) for o in organos})
        return 0

    nuevo = armar(organos, tipos, procs)
    with open(NUEVO, 'w', encoding='utf-8') as f:
        json.dump(nuevo, f, ensure_ascii=False, indent=2)
    out(f'  Actual: generado {actual.get("generado")}  ·  nuevo: {nuevo["generado"]}')
    out(f'  {actual["resumen"]}  →  {nuevo["resumen"]}')
    out('═' * 72)
    diff_organos(actual['organos'], nuevo['organos'], out)
    diff_tipos_organo(actual['tiposOrgano'], nuevo['tiposOrgano'], out)
    diff_tipos_asunto(actual['tiposAsunto'], nuevo['tiposAsunto'], out)
    with open(DIFF, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lineas) + '\n')

    rel = lambda r: os.path.relpath(r, RAIZ)
    if args.escribir:
        shutil.copyfile(NUEVO, ACTUAL)
        print(f'\nEscrito {rel(ACTUAL)}.')
    else:
        print(f'\nResultado en {rel(NUEVO)}, diff en {rel(DIFF)}.')
        print(f'{rel(ACTUAL)} NO se tocó; para reemplazarlo: --escribir')
    return 0


if __name__ == '__main__':
    sys.exit(main())
