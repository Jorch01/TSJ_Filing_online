#!/usr/bin/env python3
"""
Obtiene el catálogo completo de tipos de asunto del portal SISE del PJF.

Consulta la API pública de serviciosenlinea.pjf.gob.mx para extraer los
tipos de asunto disponibles por categoría de órgano jurisdiccional y
guarda el resultado en docs/data/tipos_asunto.json.

Requisitos:
    pip install requests

Uso:
    python3 fetch_catalogos_pjf.py

Salida:
    docs/data/tipos_asunto.json (actualizado con IDs reales del SISE)
"""

import json
import os
import sys
import time
from html.parser import HTMLParser

try:
    import requests
except ImportError:
    print('Error: Se requiere la librería "requests".')
    print('Instálala con: pip install requests')
    sys.exit(1)

PJF_BASE = 'https://www.serviciosenlinea.pjf.gob.mx'
DATOS_EXPEDIENTE = '/juicioenlinea/juicioenlinea/Expediente/ObtenerDatosExpediente'

HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, 'docs', 'data')


# ==================== HTML PARSER ====================

class SelectParser(HTMLParser):
    """Extrae opciones de un <select> por su id."""
    def __init__(self, select_id):
        super().__init__()
        self.target_id = select_id
        self.in_target = False
        self.in_option = False
        self.current_value = None
        self.current_text = ''
        self.options = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'select' and a.get('id') == self.target_id:
            self.in_target = True
        elif tag == 'option' and self.in_target:
            self.in_option = True
            self.current_value = a.get('value', '')
            self.current_text = ''

    def handle_endtag(self, tag):
        if tag == 'select' and self.in_target:
            self.in_target = False
        elif tag == 'option' and self.in_option:
            self.in_option = False
            v = self.current_value.strip() if self.current_value else ''
            if v:
                self.options.append({
                    'id': int(v) if v.isdigit() else v,
                    'nombre': self.current_text.strip()
                })

    def handle_data(self, data):
        if self.in_option:
            self.current_text += data


def parse_select(html, select_id):
    p = SelectParser(select_id)
    p.feed(html)
    return p.options


# ==================== CATEGORÍA ====================

def detect_category(nombre):
    n = nombre.lower()
    if 'tribunal laboral' in n:
        return 'tribunal_laboral'
    if 'centro de justicia penal' in n:
        return 'centro_justicia_penal'
    if 'tribunal colegiado' in n:
        return 'tribunal_colegiado'
    if 'tribunal unitario' in n:
        return 'tribunal_unitario'
    if 'pleno regional' in n or 'pleno de circuito' in n:
        return 'pleno_regional'
    if 'juzgado' in n:
        return 'juzgado_distrito'
    return 'otro'


CATEGORY_LABELS = {
    'juzgado_distrito': 'Juzgados de Distrito',
    'tribunal_colegiado': 'Tribunales Colegiados de Circuito',
    'tribunal_unitario': 'Tribunales Unitarios de Circuito',
    'centro_justicia_penal': 'Centros de Justicia Penal Federal',
    'tribunal_laboral': 'Tribunales Laborales Federales',
    'pleno_regional': 'Plenos Regionales',
    'otro': 'Otros',
}


# ==================== FETCH ====================

def fetch_tipos(organo_id, session):
    """Obtiene tipos de asunto para un órgano específico."""
    try:
        resp = session.post(
            PJF_BASE + DATOS_EXPEDIENTE,
            data=f'IdOrgano={organo_id}&IdTipoAsunto=1&IdTipoPropiedad=&IdSubNivel=&IdSubNivelInc=',
            headers=HEADERS,
            timeout=30
        )
        resp.raise_for_status()
        return parse_select(resp.text, 'ddlTipoAsunto')
    except Exception as e:
        print(f'    Error para órgano {organo_id}: {e}')
        return []


# ==================== MAIN ====================

def main():
    circuitos_path = os.path.join(DATA_DIR, 'circuitos.json')
    organismos_path = os.path.join(DATA_DIR, 'organismos.json')
    output_path = os.path.join(DATA_DIR, 'tipos_asunto.json')

    with open(circuitos_path, 'r', encoding='utf-8') as f:
        circuitos = json.load(f)
    with open(organismos_path, 'r', encoding='utf-8') as f:
        organismos = json.load(f)

    session = requests.Session()

    # Recopilar tipos por categoría, muestreando hasta 3 órganos por categoría
    categorias_tipos = {}
    category_samples = {}  # cat -> número de muestras tomadas
    MAX_SAMPLES = 3

    print(f'Procesando {len(circuitos)} circuitos...\n')

    for circuito in circuitos:
        num = circuito['numero_circuito']
        nombre_c = circuito['nombre']
        organos_c = [o for o in organismos if o['circuito_id'] == num]

        if not organos_c:
            continue

        # Agrupar órganos por categoría en este circuito
        cats_vistas = {}
        for org in organos_c:
            cat = detect_category(org['nombre'])
            if cat not in cats_vistas:
                cats_vistas[cat] = org

        for cat, org in cats_vistas.items():
            samples = category_samples.get(cat, 0)
            if samples >= MAX_SAMPLES:
                continue

            print(f'Circuito {num:2d} ({nombre_c[:30]}) → {cat} → órgano {org["id"]} ({org["nombre"][:50]}...)')
            tipos = fetch_tipos(org['id'], session)
            category_samples[cat] = samples + 1

            if cat not in categorias_tipos:
                categorias_tipos[cat] = {
                    'label': CATEGORY_LABELS.get(cat, cat),
                    'tipos': []
                }

            # Merge tipos únicos por ID
            existing_ids = {t['id'] for t in categorias_tipos[cat]['tipos']}
            nuevos = 0
            for t in tipos:
                if t['id'] not in existing_ids:
                    categorias_tipos[cat]['tipos'].append(t)
                    existing_ids.add(t['id'])
                    nuevos += 1

            total = len(categorias_tipos[cat]['tipos'])
            print(f'    → {len(tipos)} tipos encontrados, {nuevos} nuevos (total: {total})')

            time.sleep(0.5)  # Pausa para no saturar el servidor

    # Ordenar tipos por ID dentro de cada categoría
    for cat in categorias_tipos:
        categorias_tipos[cat]['tipos'].sort(key=lambda t: t['id'] if isinstance(t['id'], int) else 0)

    # Construir salida
    output = {
        'por_categoria': categorias_tipos,
        'tipos_procedimiento': [
            {'id': 0, 'nombre': 'No aplica'},
            {'id': 111, 'nombre': 'Procedimiento ordinario'},
            {'id': 112, 'nombre': 'Procedimiento especial individual'},
            {'id': 113, 'nombre': 'Procedimiento especial colectivo'},
            {'id': 114, 'nombre': 'Conflictos Individuales de Seguridad Social'},
            {'id': 115, 'nombre': 'Conflictos Colectivos de Naturaleza Económica'},
            {'id': 116, 'nombre': 'Procedimiento de Huelga'},
            {'id': 117, 'nombre': 'Procedimiento de Ejecución'},
            {'id': 120, 'nombre': 'Procedimientos Paraprocesales o Voluntarios'}
        ]
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'\nGuardado en {output_path}')
    print(f'\nCategorías encontradas:')
    for cat, data in categorias_tipos.items():
        print(f'  {cat}: {len(data["tipos"])} tipos de asunto')


if __name__ == '__main__':
    main()
