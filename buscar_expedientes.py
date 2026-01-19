#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Robot de Búsqueda Automática de Expedientes v5.0
TSJ Quintana Roo - Lista Electrónica
Autor: Jorge Israel Clemente Marié - Empírica Legal Lab

VERSIÓN 5.0:
- Juzgados corregidos según IDs del sistema
- Búsqueda por nombre en Playa del Carmen
- Extracción mejorada de tabla de resultados
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
import time
import csv
from datetime import datetime
import os

class TSJExpedientesBot:
    
    # IDs exactos del sistema TSJ (extraídos del sidebar.php)
    JUZGADOS = {
        # ===== CANCÚN =====
        'JUZGADO PRIMERO FAMILIAR ORAL CANCUN': 109,
        'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN': 158,
        'JUZGADO SEGUNDO DE LO FAMILIAR CANCUN': 115,
        'JUZGADO FAMILIAR DE PRIMERA INSTANCIA CANCUN': 114,
        'JUZGADO PRIMERO CIVIL CANCUN': 111,
        'JUZGADO SEGUNDO CIVIL CANCUN': 112,
        'JUZGADO TERCERO CIVIL CANCUN': 113,
        'JUZGADO CUARTO CIVIL CANCUN': 182,
        'JUZGADO ORAL CIVIL CANCUN': 110,
        'JUZGADO PRIMERO MERCANTIL CANCUN': 105,
        'JUZGADO SEGUNDO MERCANTIL CANCUN': 106,
        'JUZGADO TERCERO MERCANTIL CANCUN': 107,
        'JUZGADO ORAL MERCANTIL CANCUN': 108,
        'TRIBUNAL PRIMERO LABORAL CANCUN': 164,
        'TRIBUNAL SEGUNDO LABORAL CANCUN': 165,
        
        # ===== PLAYA DEL CARMEN / SOLIDARIDAD =====
        'JUZGADO FAMILIAR ORAL PLAYA': 88,
        'JUZGADO FAMILIAR PRIMERA INSTANCIA PLAYA': 84,
        'JUZGADO PRIMERO CIVIL PLAYA': 83,
        'JUZGADO SEGUNDO CIVIL PLAYA': 161,
        'JUZGADO ORAL CIVIL PLAYA': 87,
        'JUZGADO MERCANTIL PLAYA': 85,
        'TRIBUNAL LABORAL PLAYA': 166,
        
        # ===== CHETUMAL =====
        'JUZGADO FAMILIAR ORAL CHETUMAL': 93,
        'JUZGADO FAMILIAR PRIMERA INSTANCIA CHETUMAL': 94,
        'JUZGADO CIVIL CHETUMAL': 95,
        'JUZGADO MERCANTIL CHETUMAL': 96,
        'JUZGADO CIVIL ORAL CHETUMAL': 97,
        'TRIBUNAL LABORAL CHETUMAL': 163,
        
        # ===== COZUMEL =====
        'JUZGADO FAMILIAR COZUMEL': 89,
        'JUZGADO CIVIL COZUMEL': 90,
        'JUZGADO FAMILIAR ORAL COZUMEL': 91,
        'JUZGADO ORAL CIVIL COZUMEL': 92,
        
        # ===== FELIPE CARRILLO PUERTO =====
        'JUZGADO CIVIL ORAL CARRILLO PUERTO': 136,
        'JUZGADO FAMILIAR ORAL CARRILLO PUERTO': 137,
        'JUZGADO CIVIL PRIMERA INSTANCIA CARRILLO PUERTO': 153,
        'JUZGADO FAMILIAR PRIMERA INSTANCIA CARRILLO PUERTO': 154,
        
        # ===== ISLA MUJERES =====
        'JUZGADO CIVIL ORAL ISLA MUJERES': 131,
        'JUZGADO FAMILIAR ORAL ISLA MUJERES': 132,
        
        # ===== TULUM =====
        'JUZGADO CIVIL ORAL TULUM': 144,
        'JUZGADO FAMILIAR ORAL TULUM': 145,
        
        # ===== BACALAR =====
        'JUZGADO FAMILIAR PRIMERA INSTANCIA BACALAR': 188,
    }
    
    def __init__(self):
        self.base_url = "https://www.tsjqroo.gob.mx/estrados"
        self.driver = None
        self.resultados = []
        self.debug_mode = True
        self.screenshot_dir = "debug_screenshots"
        
        if self.debug_mode and not os.path.exists(self.screenshot_dir):
            os.makedirs(self.screenshot_dir)
    
    def log(self, msg, nivel="INFO"):
        timestamp = datetime.now().strftime('%H:%M:%S')
        iconos = {"INFO": "ℹ️", "OK": "✅", "WARN": "⚠️", "ERROR": "❌", "DEBUG": "🔍"}
        print(f"[{timestamp}] {iconos.get(nivel, '•')} {msg}")
    
    def screenshot(self, nombre):
        if self.debug_mode and self.driver:
            try:
                filename = f"{self.screenshot_dir}/{nombre}_{datetime.now().strftime('%H%M%S')}.png"
                self.driver.save_screenshot(filename)
            except:
                pass
    
    def guardar_html(self, nombre):
        if self.debug_mode and self.driver:
            try:
                filename = f"{self.screenshot_dir}/{nombre}_{datetime.now().strftime('%H%M%S')}.html"
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write(self.driver.page_source)
            except:
                pass
    
    def iniciar_navegador(self):
        self.log("Iniciando navegador Chrome...")
        
        opciones = webdriver.ChromeOptions()
        opciones.add_argument('--start-maximized')
        opciones.add_argument('--disable-notifications')
        opciones.add_argument('--disable-blink-features=AutomationControlled')
        opciones.add_argument('--no-sandbox')
        opciones.add_experimental_option("excludeSwitches", ["enable-automation"])
        opciones.add_experimental_option('useAutomationExtension', False)
        opciones.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        
        self.driver = webdriver.Chrome(options=opciones)
        self.driver.implicitly_wait(10)
        self.log("Navegador iniciado", "OK")
    
    def obtener_id_juzgado(self, nombre_juzgado):
        """Obtiene el ID interno del juzgado"""
        nombre_upper = nombre_juzgado.upper().strip()
        
        # Búsqueda exacta primero
        for nombre, id_juzgado in self.JUZGADOS.items():
            if nombre.upper() == nombre_upper:
                return id_juzgado
        
        # Búsqueda parcial flexible
        for nombre, id_juzgado in self.JUZGADOS.items():
            nombre_norm = nombre.upper()
            # Si coinciden las palabras clave principales
            if all(palabra in nombre_norm for palabra in nombre_upper.split()[:3]):
                return id_juzgado
        
        self.log(f"⚠️  Juzgado no encontrado: {nombre_juzgado}", "WARN")
        return None
    
    def buscar(self, termino, id_juzgado, metodo=1):
        """
        Realiza una búsqueda en el sistema
        metodo=1: por expediente
        metodo=2: por nombre (actores)
        """
        try:
            url = f"{self.base_url}/buscador_primera.php?int={id_juzgado}&metodo={metodo}&findexp={termino}"
            
            tipo = "expediente" if metodo == 1 else "nombre"
            self.log(f"Buscando {tipo}: {termino}")
            self.driver.get(url)
            time.sleep(4)  # Esperar a que cargue la tabla
            
            self.screenshot(f"resultado_{termino.replace('/', '_').replace(' ', '_')}")
            self.guardar_html(f"resultado_{termino.replace('/', '_').replace(' ', '_')}")
            return True
            
        except Exception as e:
            self.log(f"Error en búsqueda: {e}", "ERROR")
            return False
    
    def extraer_resultados(self, busqueda, juzgado, tipo_busqueda="expediente"):
        """Extrae los resultados de la tabla de publicaciones"""
        publicaciones = []
        
        try:
            time.sleep(2)
            
            # Verificar si no hay resultados
            page_source = self.driver.page_source
            if "No se encontr" in page_source or "ningun resultado" in page_source.lower():
                self.log(f"Sin publicaciones para: {busqueda}", "WARN")
                resultado = {
                    'busqueda': busqueda,
                    'tipo_busqueda': tipo_busqueda,
                    'juzgado': juzgado,
                    'estado': 'Sin publicaciones',
                    'fecha_busqueda': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'publicaciones': []
                }
                self.resultados.append(resultado)
                return resultado
            
            # Buscar filas de la tabla (las filas de datos tienen clase 'odd' o 'even')
            filas = self.driver.find_elements(By.CSS_SELECTOR, "tr.odd, tr.even")
            
            if not filas:
                # Intentar buscar cualquier fila de tabla con datos
                filas = self.driver.find_elements(By.XPATH, "//table//tr[td]")
            
            self.log(f"Filas encontradas: {len(filas)}", "DEBUG")
            
            for fila in filas:
                try:
                    celdas = fila.find_elements(By.TAG_NAME, "td")
                    if len(celdas) >= 7:
                        publicacion = {
                            'id_acuerdo': celdas[0].text.strip(),
                            'documento': celdas[1].text.strip(),
                            'juicio': celdas[2].text.strip(),
                            'promoventes': celdas[3].text.strip(),
                            'demandados': celdas[4].text.strip(),
                            'extracto': celdas[5].text.strip(),
                            'fecha_publicacion': celdas[6].text.strip(),
                        }
                        publicaciones.append(publicacion)
                except Exception as e:
                    self.log(f"Error en fila: {e}", "DEBUG")
                    continue
            
            resultado = {
                'busqueda': busqueda,
                'tipo_busqueda': tipo_busqueda,
                'juzgado': juzgado,
                'estado': 'Con publicaciones' if publicaciones else 'Sin publicaciones',
                'fecha_busqueda': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'publicaciones': publicaciones
            }
            
            self.resultados.append(resultado)
            self.log(f"✅ Encontradas {len(publicaciones)} publicaciones", "OK")
            return resultado
            
        except Exception as e:
            self.log(f"Error extrayendo resultados: {e}", "ERROR")
            return None
    
    def procesar_expedientes(self, expedientes):
        """Procesa una lista de expedientes"""
        total = len(expedientes)
        self.log(f"\n{'='*60}")
        self.log(f"PROCESANDO {total} BÚSQUEDAS")
        self.log(f"{'='*60}\n")
        
        for i, exp in enumerate(expedientes, 1):
            termino = exp.get('numero', exp.get('nombre', 'N/A'))
            self.log(f"\n[{i}/{total}] {termino} - {exp['juzgado']}")
            self.log("-" * 50)
            
            # Obtener ID del juzgado
            id_juzgado = self.obtener_id_juzgado(exp['juzgado'])
            if not id_juzgado:
                self.log(f"Saltando - juzgado no encontrado", "ERROR")
                continue
            
            self.log(f"ID Juzgado: {id_juzgado}", "DEBUG")
            
            try:
                if 'numero' in exp:
                    # Búsqueda por expediente (metodo=1)
                    if self.buscar(exp['numero'], id_juzgado, metodo=1):
                        self.extraer_resultados(exp['numero'], exp['juzgado'], "expediente")
                elif 'nombre' in exp:
                    # Búsqueda por nombre (metodo=2)
                    if self.buscar(exp['nombre'], id_juzgado, metodo=2):
                        self.extraer_resultados(exp['nombre'], exp['juzgado'], "nombre")
                        
            except Exception as e:
                self.log(f"Error: {e}", "ERROR")
            
            time.sleep(2)
    
    def guardar_csv(self, archivo='resultados_expedientes.csv'):
        """Guarda resultados en CSV"""
        self.log(f"Guardando en {archivo}...")
        
        with open(archivo, 'w', newline='', encoding='utf-8') as f:
            campos = [
                'Búsqueda', 'Tipo', 'Juzgado', 'Estado', 'Fecha Consulta',
                'IdAcuerdo', 'Documento', 'Juicio', 'Promoventes', 
                'Demandados', 'Extracto', 'Fecha Publicación'
            ]
            writer = csv.DictWriter(f, fieldnames=campos)
            writer.writeheader()
            
            for r in self.resultados:
                if r['publicaciones']:
                    for p in r['publicaciones']:
                        writer.writerow({
                            'Búsqueda': r['busqueda'],
                            'Tipo': r['tipo_busqueda'],
                            'Juzgado': r['juzgado'],
                            'Estado': r['estado'],
                            'Fecha Consulta': r['fecha_busqueda'],
                            'IdAcuerdo': p.get('id_acuerdo', ''),
                            'Documento': p.get('documento', ''),
                            'Juicio': p.get('juicio', ''),
                            'Promoventes': p.get('promoventes', ''),
                            'Demandados': p.get('demandados', ''),
                            'Extracto': p.get('extracto', ''),
                            'Fecha Publicación': p.get('fecha_publicacion', '')
                        })
                else:
                    writer.writerow({
                        'Búsqueda': r['busqueda'],
                        'Tipo': r['tipo_busqueda'],
                        'Juzgado': r['juzgado'],
                        'Estado': r['estado'],
                        'Fecha Consulta': r['fecha_busqueda'],
                        'IdAcuerdo': '', 'Documento': '', 'Juicio': '',
                        'Promoventes': '', 'Demandados': '', 
                        'Extracto': '', 'Fecha Publicación': ''
                    })
        
        self.log(f"CSV guardado: {archivo}", "OK")
    
    def resumen(self):
        """Muestra resumen de resultados"""
        print(f"\n{'='*60}")
        print("📊 RESUMEN DE RESULTADOS")
        print(f"{'='*60}")
        
        con = sum(1 for r in self.resultados if r['estado'] == 'Con publicaciones')
        sin = sum(1 for r in self.resultados if r['estado'] == 'Sin publicaciones')
        total_pubs = sum(len(r['publicaciones']) for r in self.resultados)
        
        print(f"Total búsquedas: {len(self.resultados)}")
        print(f"Con publicaciones: {con}")
        print(f"Sin publicaciones: {sin}")
        print(f"Total publicaciones: {total_pubs}")
        print("-" * 60)
        
        for r in self.resultados:
            num = len(r['publicaciones'])
            icono = "✅" if num > 0 else "⚪"
            juzgado_corto = r['juzgado'][:35] + "..." if len(r['juzgado']) > 35 else r['juzgado']
            print(f"  {icono} {r['busqueda']:15} | {juzgado_corto:38} | {num} pub.")
    
    def cerrar(self):
        if self.driver:
            self.log("Cerrando navegador...")
            self.driver.quit()
            self.log("Completado", "OK")


def main():
    """
    LISTA DE EXPEDIENTES A BUSCAR
    
    Según tu solicitud:
    - 2358/2025, 2501/2025, 2502/2025, 1421/2025 → Segundo Familiar Oral Cancún
    - 2500/2025, 1430/2022 → Primero Familiar Oral Cancún
    - samanta (nombre) → Familiar Oral Playa del Carmen
    """
    
    expedientes = [
        # ===== JUZGADO SEGUNDO FAMILIAR ORAL CANCÚN =====
        {
            'numero': '2358/2025',
            'juzgado': 'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN'
        },
        {
            'numero': '2501/2025',
            'juzgado': 'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN'
        },
        {
            'numero': '2502/2025',
            'juzgado': 'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN'
        },
        {
            'numero': '1421/2025',
            'juzgado': 'JUZGADO SEGUNDO FAMILIAR ORAL CANCUN'
        },
        
        # ===== JUZGADO PRIMERO FAMILIAR ORAL CANCÚN =====
        {
            'numero': '2500/2025',
            'juzgado': 'JUZGADO PRIMERO FAMILIAR ORAL CANCUN'
        },
        {
            'numero': '1430/2022',
            'juzgado': 'JUZGADO PRIMERO FAMILIAR ORAL CANCUN'
        },
        
        # ===== BÚSQUEDA POR NOMBRE - PLAYA DEL CARMEN =====
        {
            'nombre': 'samanta',
            'juzgado': 'JUZGADO FAMILIAR ORAL PLAYA'  # ID 88
        },
    ]
    
    bot = TSJExpedientesBot()
    
    try:
        bot.iniciar_navegador()
        bot.procesar_expedientes(expedientes)
        bot.resumen()
        bot.guardar_csv()
        
        print(f"\n📁 Archivo guardado: resultados_expedientes.csv")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        input("\n⏸️  Presiona ENTER para cerrar el navegador...")
        bot.cerrar()


if __name__ == "__main__":
    main()