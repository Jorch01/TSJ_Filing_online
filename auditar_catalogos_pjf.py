#!/usr/bin/env python3
"""
Compara el catálogo de órganos del PJF que usa la app contra lo que responde
hoy el portal del PJF, y dice qué cambió.

    python3 auditar_catalogos_pjf.py                    # solo Quintana Roo (rápido)
    python3 auditar_catalogos_pjf.py --estado Yucatán
    python3 auditar_catalogos_pjf.py --todos            # los 1195 (tarda)
    python3 auditar_catalogos_pjf.py --guardar-html 462 # vuelca una respuesta cruda

Por qué existe: docs/data/pjf_catalogos_completos.json se generó una vez y
nada en el repositorio lo regenera. fetch_catalogos_pjf.py LEE los órganos y
solo escribe los tipos de asunto, así que la lista de órganos —que es de la
que dependen los estrados— envejece sin que nadie se entere.

Qué detecta y qué no:

  ✔ Órganos que ya no responden        → candidatos a haber desaparecido
  ✔ Tipos de asunto que cambiaron      → altas y bajas por órgano
  ✘ Órganos NUEVOS                     → hace falta el endpoint que lista
                                          órganos por circuito, que no está
                                          en el repositorio (ver el final)

No corre en CI a propósito: depende de un sitio externo y de una red que
puede no estar disponible.

Requisitos:  pip install requests
"""

import argparse
import json
import os
import sys
import time
from html.parser import HTMLParser

try:
    import requests
except ImportError:
    sys.exit('Falta la librería "requests". Instálala con: pip install requests')

BASE = 'https://www.serviciosenlinea.pjf.gob.mx'
ENDPOINT = '/juicioenlinea/juicioenlinea/Expediente/ObtenerDatosExpediente'

HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

RAIZ = os.path.dirname(os.path.abspath(__file__))
CATALOGO = os.path.join(RAIZ, 'docs', 'data', 'pjf_catalogos_completos.json')


# ==================== LECTURA DEL HTML ====================

class LectorSelect(HTMLParser):
    """Saca las <option> de un <select> por su id."""

    def __init__(self, select_id):
        super().__init__()
        self.objetivo = select_id
        self.dentro = False
        self.en_option = False
        self.valor = None
        self.texto = ''
        self.opciones = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'select' and a.get('id') == self.objetivo:
            self.dentro = True
        elif tag == 'option' and self.dentro:
            self.en_option = True
            self.valor = a.get('value')
            self.texto = ''

    def handle_endtag(self, tag):
        if tag == 'select' and self.dentro:
            self.dentro = False
        elif tag == 'option' and self.en_option:
            self.en_option = False
            v, t = (self.valor or '').strip(), self.texto.strip()
            # El "-- Seleccione --" no es un tipo de asunto.
            if v.isdigit() and int(v) > 0 and t:
                self.opciones.append({'id': int(v), 'nombre': t})

    def handle_data(self, data):
        if self.en_option:
            self.texto += data


def opciones_de(html, select_id):
    lector = LectorSelect(select_id)
    lector.feed(html)
    return lector.opciones


# ==================== CONSULTA ====================

def consultar(sesion, organo_id, reintentos=2):
    """
    Devuelve (tipos, html) del órgano, o (None, motivo) si no responde.
    None significa "no pude confirmar que exista", no "no existe".
    """
    cuerpo = f'IdOrgano={organo_id}&IdTipoAsunto=1&IdTipoPropiedad=&IdSubNivel=&IdSubNivelInc='
    ultimo = ''
    for intento in range(reintentos + 1):
        try:
            r = sesion.post(BASE + ENDPOINT, data=cuerpo, headers=HEADERS, timeout=30)
            if r.status_code != 200:
                ultimo = f'HTTP {r.status_code}'
            else:
                return opciones_de(r.text, 'ddlTipoAsunto'), r.text
        except Exception as e:
            ultimo = type(e).__name__ + ': ' + str(e)[:80]
        if intento < reintentos:
            time.sleep(2 * (intento + 1))
    return None, ultimo


# ==================== COMPARACIÓN ====================

def tipos_locales(catalogo, organo):
    """Los tipos de asunto que la app cree que tiene ese órgano."""
    for t in catalogo['tiposOrgano']:
        if t['TipoOrganismoId'] == organo['tipoOrganismoId']:
            return {a['id']: a['nombre'] for a in t.get('tiposAsunto', [])}
    return {}


def auditar(organos, catalogo, pausa):
    sesion = requests.Session()
    mudos, cambiados, iguales = [], [], 0

    for i, o in enumerate(organos, 1):
        print(f'  [{i}/{len(organos)}] {o["id"]:>5}  {o["nombre"][:58]}', flush=True)
        remotos, extra = consultar(sesion, o['id'])

        if remotos is None:
            mudos.append((o, extra))
        elif not remotos:
            mudos.append((o, 'respondió sin tipos de asunto'))
        else:
            locales = tipos_locales(catalogo, o)
            ids_remotos = {t['id'] for t in remotos}
            nuevos = [t for t in remotos if t['id'] not in locales]
            idos = [{'id': k, 'nombre': v} for k, v in locales.items() if k not in ids_remotos]
            if nuevos or idos:
                cambiados.append((o, nuevos, idos))
            else:
                iguales += 1

        time.sleep(pausa)

    return mudos, cambiados, iguales


def informe(mudos, cambiados, iguales, total):
    print('\n' + '═' * 70)
    print(f'  {total} órganos revisados')
    print(f'  ✓ {iguales} sin cambios')
    print(f'  {"⚠" if cambiados else "✓"} {len(cambiados)} con tipos de asunto distintos')
    print(f'  {"⚠" if mudos else "✓"} {len(mudos)} que no respondieron')
    print('═' * 70)

    if cambiados:
        print('\n── TIPOS DE ASUNTO QUE CAMBIARON ──')
        for o, nuevos, idos in cambiados:
            print(f'\n  {o["id"]}  {o["nombre"]}')
            for t in nuevos:
                print(f'     + {t["id"]:>4}  {t["nombre"]}   (nuevo en el portal)')
            for t in idos:
                print(f'     - {t["id"]:>4}  {t["nombre"]}   (ya no aparece)')

    if mudos:
        print('\n── NO RESPONDIERON ──')
        print('  Puede ser el órgano, o puede ser la red. Repite antes de concluir nada.')
        for o, motivo in mudos:
            print(f'  {o["id"]:>5}  {o["nombre"][:52]:<52} {motivo}')

    print('\n── ÓRGANOS NUEVOS ──')
    print('  Esto NO los detecta: haría falta el endpoint que lista los órganos')
    print('  de un circuito, y no está en el repositorio. Para capturarlo:')
    print('    1. Abre el portal del PJF y las herramientas de desarrollo (F12), pestaña Red.')
    print('    2. Elige un circuito en el formulario de consulta.')
    print('    3. Copia la petición que sale (URL y cuerpo) y pásamela.')
    print('  Con eso se completa la auditoría y se puede regenerar el catálogo entero.')

    return 1 if (cambiados or mudos) else 0


# ==================== MAIN ====================

def main():
    p = argparse.ArgumentParser(description='Audita el catálogo de órganos del PJF contra el portal.')
    p.add_argument('--estado', default='Quintana Roo', help='Solo los órganos de ese estado (por omisión: Quintana Roo)')
    p.add_argument('--todos', action='store_true', help='Revisar los 1195 órganos (tarda y son muchas peticiones)')
    p.add_argument('--pausa', type=float, default=0.5, help='Segundos entre peticiones (por omisión 0.5)')
    p.add_argument('--guardar-html', type=int, metavar='ID',
                   help='Vuelca la respuesta cruda de ese órgano y termina; sirve para ver qué más trae')
    args = p.parse_args()

    if not os.path.exists(CATALOGO):
        sys.exit(f'No encuentro el catálogo en {CATALOGO}')

    with open(CATALOGO, encoding='utf-8') as f:
        catalogo = json.load(f)

    print(f'Catálogo local generado el {catalogo.get("generado", "?")}')

    if args.guardar_html:
        _, html = consultar(requests.Session(), args.guardar_html)
        destino = os.path.join(RAIZ, f'respuesta_organo_{args.guardar_html}.html')
        with open(destino, 'w', encoding='utf-8') as f:
            f.write(html if isinstance(html, str) else str(html))
        print(f'Guardado en {destino} ({len(html)} bytes)')
        return 0

    organos = catalogo['organos']
    if not args.todos:
        organos = [o for o in organos if args.estado.lower() in (o.get('estado') or '').lower()]
        if not organos:
            sys.exit(f'Ningún órgano en "{args.estado}". Estados disponibles: '
                     + ', '.join(sorted({o.get('estado', '') for o in catalogo['organos']} - {''}))[:300])
        print(f'Revisando los {len(organos)} órganos de {args.estado}.')
    else:
        print(f'Revisando los {len(organos)} órganos. Serán {len(organos)} peticiones; '
              f'a {args.pausa}s cada una, unos {int(len(organos) * (args.pausa + 0.4) / 60)} minutos.')

    print()
    mudos, cambiados, iguales = auditar(organos, catalogo, args.pausa)
    return informe(mudos, cambiados, iguales, len(organos))


if __name__ == '__main__':
    sys.exit(main())
