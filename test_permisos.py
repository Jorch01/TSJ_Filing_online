#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test de permisos para expedientes.json
Verifica que el archivo se puede leer desde diferentes directorios
"""

import os
import json
import sys

def test_lectura_expedientes():
    """Prueba leer expedientes.json con rutas relativas y absolutas"""

    print("=" * 70)
    print("🧪 TEST DE PERMISOS - expedientes.json")
    print("=" * 70)
    print()

    # Directorio del script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    print(f"📂 Directorio del script: {script_dir}")
    print(f"📂 Directorio actual: {os.getcwd()}")
    print()

    # Test 1: Ruta relativa
    print("📝 Test 1: Lectura con ruta relativa ('expedientes.json')")
    try:
        with open('expedientes.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
            num_expedientes = len(data.get('expedientes', []))
            print(f"   ✅ Éxito - {num_expedientes} expedientes encontrados")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    print()

    # Test 2: Ruta absoluta
    print("📝 Test 2: Lectura con ruta absoluta")
    archivo_absoluto = os.path.join(script_dir, 'expedientes.json')
    print(f"   Ruta: {archivo_absoluto}")
    try:
        with open(archivo_absoluto, 'r', encoding='utf-8') as f:
            data = json.load(f)
            num_expedientes = len(data.get('expedientes', []))
            print(f"   ✅ Éxito - {num_expedientes} expedientes encontrados")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    print()

    # Test 3: Permisos del archivo
    print("📝 Test 3: Verificación de permisos")
    try:
        st = os.stat(archivo_absoluto)
        print(f"   Permisos: {oct(st.st_mode)[-3:]}")
        print(f"   Propietario UID: {st.st_uid}")
        print(f"   Usuario actual UID: {os.getuid()}")
        print(f"   ✅ Archivo accesible")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    print()

    # Test 4: Capacidad de escritura
    print("📝 Test 4: Verificación de escritura")
    try:
        # Intentar abrir en modo escritura (sin escribir nada)
        with open(archivo_absoluto, 'r+', encoding='utf-8') as f:
            print(f"   ✅ Archivo se puede abrir para escritura")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    print()

    print("=" * 70)
    print("RECOMENDACIÓN:")
    print("=" * 70)
    print()
    print("✅ La GUI ahora usa rutas absolutas basadas en __file__")
    print("   Esto evita problemas cuando se ejecuta desde diferentes directorios")
    print()
    print("Para iniciar la GUI:")
    print("  ./iniciar_gui.sh")
    print()
    print("O directamente:")
    print(f"  cd {script_dir}")
    print("  python3 gui_expedientes.py")
    print()

if __name__ == "__main__":
    test_lectura_expedientes()
