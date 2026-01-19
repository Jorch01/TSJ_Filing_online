#!/bin/bash
# Script de instalación rápida para macOS
# Robot de Búsqueda Automática de Expedientes v6.0

echo "================================================"
echo "🤖 Instalación de Dependencias"
echo "   Robot de Búsqueda de Expedientes v6.0"
echo "================================================"
echo ""

# Verificar Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 no está instalado"
    echo "   Instala Python 3 desde https://www.python.org/"
    exit 1
fi

echo "✅ Python 3 encontrado: $(python3 --version)"
echo ""

# Detectar si está en ambiente Conda
if [ -n "$CONDA_DEFAULT_ENV" ]; then
    echo "🐍 Ambiente Conda detectado: $CONDA_DEFAULT_ENV"
    echo "📦 Instalando dependencias con conda/pip..."

    # Intentar con conda primero
    if command -v conda &> /dev/null; then
        conda install -y selenium openpyxl 2>/dev/null
        if [ $? -ne 0 ]; then
            # Si conda falla, usar pip del ambiente conda
            pip install selenium openpyxl
        fi
    else
        pip install selenium openpyxl
    fi

    PYTHON_CMD="python"
else
    # No está en conda, verificar si el sistema está administrado externamente
    echo "📦 Instalando dependencias Python..."
    pip3 install -r requirements.txt 2>/dev/null

    if [ $? -ne 0 ]; then
        echo ""
        echo "⚠️  Error: Python está administrado externamente (Homebrew)"
        echo ""
        echo "Elige una opción:"
        echo ""
        echo "1️⃣  Usar entorno virtual (RECOMENDADO):"
        echo "   ./setup_venv.sh"
        echo ""
        echo "2️⃣  Instalar con --user:"
        echo "   pip3 install --user selenium openpyxl"
        echo ""
        echo "3️⃣  Si tienes Conda instalado:"
        echo "   conda activate base"
        echo "   conda install selenium openpyxl"
        echo ""
        exit 1
    fi

    PYTHON_CMD="python3"
fi

echo ""
echo "================================================"
echo "✅ Instalación completada"
echo "================================================"
echo ""
echo "⚠️  IMPORTANTE: Asegúrate de tener ChromeDriver instalado"
echo "   brew install chromedriver"
echo "   O descarga desde: https://chromedriver.chromium.org/"
echo ""
echo "🚀 Para ejecutar:"
echo "   $PYTHON_CMD buscar_expedientes.py"
echo ""
echo "📝 Para configurar:"
echo "   1. Edita 'expedientes.json' para agregar tus expedientes"
echo "   2. Edita 'config.json' para personalizar el comportamiento"
echo ""
