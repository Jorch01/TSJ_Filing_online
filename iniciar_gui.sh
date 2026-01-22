#!/bin/bash
# Lanzador de Interfaz Gráfica
# Robot de Búsqueda de Expedientes v6.1

echo "🤖 Iniciando Interfaz Gráfica..."
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
