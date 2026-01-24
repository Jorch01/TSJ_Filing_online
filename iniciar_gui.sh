#!/bin/bash
# Lanzador de Interfaz Gráfica
# Robot de Búsqueda de Expedientes v6.2

echo "🤖 Iniciando Interfaz Gráfica..."
echo ""

# Cambiar al directorio del script para evitar problemas de rutas
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "📂 Directorio de trabajo: $SCRIPT_DIR"
echo ""

# Detectar Python
if command -v python3 &> /dev/null; then
    python3 gui_expedientes.py
elif command -v python &> /dev/null; then
    python gui_expedientes.py
else
    echo "❌ Error: Python no encontrado"
    echo "   Instala Python desde https://www.python.org/"
    exit 1
fi
