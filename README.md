# 🤖 Robot de Búsqueda Automática de Expedientes v6.1
## Tribunal Superior de Justicia de Quintana Roo - Estrados Electrónicos

### 🎯 Características Principales

✅ **Salas de Segunda Instancia** - Soporte completo para las 11 salas de apelación ⭐ NUEVO
✅ **Búsquedas simultáneas** - Procesa múltiples expedientes en paralelo usando pestañas de Chrome
✅ **Carga dinámica** - Agrega expedientes fácilmente editando `expedientes.json`
✅ **Reportes Excel mejorados** - Formato profesional con acuerdos nuevos marcados en amarillo
✅ **Detección inteligente** - Marca automáticamente acuerdos de los últimos 5 días
✅ **Búsqueda flexible** - Busca por número de expediente o por nombre de actor
✅ **Cobertura completa** - Todos los juzgados y salas de Quintana Roo

---

## 📋 Requisitos

### Instalación de dependencias:

```bash
pip3 install selenium openpyxl
```

### ChromeDriver:
- Debe estar instalado y accesible en tu PATH
- Descargar desde: https://chromedriver.chromium.org/

---

## 🚀 Uso Rápido

### 1. Configurar expedientes

Edita el archivo `expedientes.json` y agrega tus expedientes:

```json
{
  "expedientes": [
    {
      "numero": "1234/2025",
      "juzgado": "JUZGADO PRIMERO CIVIL CANCUN"
    },
    {
      "nombre": "JUAN PEREZ",
      "juzgado": "JUZGADO MERCANTIL PLAYA"
    }
  ]
}
```

### 2. Ejecutar el script

```bash
python3 buscar_expedientes.py
```

### 3. Revisar resultados

El script genera:
- 📊 **resultados_expedientes.xlsx** - Archivo Excel con formato (acuerdos nuevos en amarillo)
- 📄 **resultados_expedientes.csv** - Archivo CSV de respaldo

---

## ⚙️ Configuración Avanzada

Edita `config.json` para personalizar el comportamiento:

```json
{
  "configuracion": {
    "max_pestanas": 5,           // Pestañas simultáneas (1-10)
    "dias_acuerdos_nuevos": 5,   // Días para marcar como nuevo
    "debug_mode": true,          // Guardar screenshots para debug
    "tiempo_espera_carga": 4     // Segundos de espera por página
  }
}
```

También puedes editar directamente en `buscar_expedientes.py`:

```python
# Líneas 596-597
max_pestanas = 5  # Número de pestañas simultáneas
dias_nuevos = 5   # Días para marcar como nuevo
```

---

## 📚 Juzgados y Salas Disponibles

### 🏛️ Salas de Segunda Instancia (NUEVO ✅)
- PRIMERA SALA CIVIL MERCANTIL Y FAMILIAR
- SEGUNDA SALA PENAL ORAL
- TERCERA SALA PENAL ORAL
- CUARTA SALA CIVIL MERCANTIL Y FAMILIAR
- QUINTA SALA CIVIL MERCANTIL Y FAMILIAR
- SEXTA SALA CIVIL MERCANTIL Y FAMILIAR
- SEPTIMA SALA PENAL TRADICIONAL
- OCTAVA SALA PENAL ORAL
- NOVENA SALA PENAL ORAL
- DECIMA SALA CIVIL MERCANTIL Y FAMILIAR PLAYA
- SALA CONSTITUCIONAL

### Cancún - Primera Instancia
- JUZGADO PRIMERO/SEGUNDO FAMILIAR ORAL CANCUN
- JUZGADO PRIMERO/SEGUNDO/TERCERO/CUARTO CIVIL CANCUN
- JUZGADO PRIMERO/SEGUNDO/TERCERO MERCANTIL CANCUN
- TRIBUNAL PRIMERO/SEGUNDO LABORAL CANCUN

### Playa del Carmen / Solidaridad
- JUZGADO FAMILIAR ORAL PLAYA
- JUZGADO PRIMERO/SEGUNDO CIVIL PLAYA
- JUZGADO MERCANTIL PLAYA
- TRIBUNAL LABORAL PLAYA

### Chetumal, Cozumel, Tulum, Isla Mujeres, etc.
Ver lista completa en `expedientes.json`

---

## 📊 Formato del Reporte Excel

El archivo Excel incluye:
- ✅ Encabezados con formato profesional (fondo azul)
- ⭐ Acuerdos nuevos marcados con **fondo amarillo**
- 📅 Columna "NUEVO" con indicador visual
- 📏 Columnas auto-ajustadas
- 🔒 Primera fila congelada para scroll

---

## 🔧 Solución de Problemas

### Error: "ChromeDriver not found"
Instala ChromeDriver y agrégalo a tu PATH

### Error: "No se encontró expedientes.json"
El script usará expedientes por defecto. Crea `expedientes.json` para personalizar

### Las páginas no cargan completamente
Aumenta `tiempo_espera_carga` en `config.json` o en el código

### Consumo excesivo de memoria
Reduce `max_pestanas` a 2-3 pestañas simultáneas

---

## 📝 Notas Importantes

- Los **acuerdos nuevos** son aquellos publicados en los últimos 5 días (configurable)
- El script guarda screenshots en `debug_screenshots/` si `debug_mode=true`
- Ambos formatos (Excel y CSV) se generan automáticamente
- La búsqueda por nombre busca en el campo "actores" del sistema

---

## 👨‍💻 Autor

**Jorge Israel Clemente Marié** - Empírica Legal Lab

---

## 📜 Changelog

### v6.1 (2025-01-22) ✨
- ✅ **11 Salas de Segunda Instancia completamente configuradas**
- ✅ Script de descubrimiento automático de IDs de salas
- ✅ Soporte completo para apelaciones y recursos
- ✅ Salas históricas y especializadas incluidas
- ✅ Guía de instalación específica para macOS
- ✅ Detección automática de ambientes Conda

### v6.0 (2025-01-19)
- ✨ Búsquedas simultáneas en múltiples pestañas
- ✨ Carga dinámica de expedientes desde JSON
- ✨ Reporte Excel con formato y marcado de acuerdos nuevos
- ✨ Archivo de configuración separado
- ✨ Mejor manejo de errores y thread-safety

### v5.0
- IDs de juzgados corregidos
- Búsqueda por nombre implementada
- Extracción mejorada de tablas

---

## 📄 Licencia

Uso interno - Empírica Legal Lab
