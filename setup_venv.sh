#!/bin/bash
# Script de configuración de entorno virtual para macOS
# Robot de Búsqueda Automática de Expedientes v6.0

echo "================================================"
echo "🐍 Configuración de Entorno Virtual"
echo "   Robot de Búsqueda de Expedientes v6.0"
echo "================================================"
echo ""

# Crear entorno virtual
echo "📦 Creando entorno virtual..."
python3 -m venv venv

# Activar entorno virtual
echo "✅ Entorno virtual creado"
echo ""
echo "🔄 Activando entorno virtual..."
source venv/bin/activate

# Instalar dependencias
echo "📥 Instalando dependencias..."
pip install --upgrade pip
pip install selenium openpyxl

echo ""
echo "================================================"
echo "✅ Instalación completada"
echo "================================================"
echo ""
echo "🎯 IMPORTANTE: Para usar el proyecto:"
echo ""
echo "   1. Activa el entorno virtual cada vez:"
echo "      source venv/bin/activate"
echo ""
echo "   2. Ejecuta el script:"
echo "      python buscar_expedientes.py"
echo ""
echo "   3. Para desactivar el entorno:"
echo "      deactivate"
echo ""
echo "⚠️  Asegúrate de tener ChromeDriver instalado"
echo "   brew install chromedriver"
echo ""
