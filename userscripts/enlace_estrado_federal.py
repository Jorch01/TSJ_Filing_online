#!/usr/bin/env python3
"""
Genera el enlace directo a la lista de acuerdos de un órgano federal.

El portal del CJF no acepta filtros por URL, así que el enlace lleva el
objetivo en el fragmento (#tsjfo=circuito/organo) y lo aplica el userscript
estrados-federales.user.js. Sin ese userscript instalado, el enlace abre el
portal sin preseleccionar nada.

Uso:
    python3 userscripts/enlace_estrado_federal.py "primer tribunal colegiado del vigesimo septimo"
    python3 userscripts/enlace_estrado_federal.py "quinto de distrito quintana roo"
"""

import json
import os
import sys
import unicodedata

BASE = ('https://www.dgej.cjf.gob.mx/paginas/serviciosTramites.htm'
        '?pageName=servicios%2FlistaAcuerdos.htm')

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOGO = os.path.join(RAIZ, 'docs', 'data', 'pjf_catalogos_completos.json')


def normalizar(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    consulta = normalizar(' '.join(sys.argv[1:]))
    palabras = consulta.split()

    with open(CATALOGO, encoding='utf-8') as f:
        organos = json.load(f)['organos']

    hallazgos = [o for o in organos
                 if all(p in normalizar(o['nombre']) for p in palabras)]

    if not hallazgos:
        print(f'Sin coincidencias para: {" ".join(palabras)}')
        return 1

    for o in hallazgos[:10]:
        print(o['nombre'])
        print(f'  circuito {o["circuitoId"]} · órgano {o["id"]} · {o["tipoOrganismo"]}')
        print(f'  {BASE}#tsjfo={o["circuitoId"]}/{o["id"]}')
        print()

    if len(hallazgos) > 10:
        print(f'... y {len(hallazgos) - 10} más. Afina la búsqueda con más palabras.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
