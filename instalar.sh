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

# Instalar dependencias
echo "📦 Instalando dependencias Python..."
pip3 install -r requirements.txt

echo ""
echo "================================================"
echo "✅ Instalación completada"
echo "================================================"
echo ""
echo "⚠️  IMPORTANTE: Asegúrate de tener ChromeDriver instalado"
echo "   Descarga desde: https://chromedriver.chromium.org/"
echo ""
echo "🚀 Para ejecutar:"
echo "   python3 buscar_expedientes.py"
echo ""
echo "📝 Para configurar:"
echo "   1. Edita 'expedientes.json' para agregar tus expedientes"
echo "   2. Edita 'config.json' para personalizar el comportamiento"
echo ""
