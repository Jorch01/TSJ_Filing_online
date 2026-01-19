# 📖 Guía Rápida de Uso

## ⚡ Inicio Rápido (3 pasos)

### 1️⃣ Instalar dependencias

```bash
./instalar.sh
```

O manualmente:
```bash
pip3 install selenium openpyxl
```

### 2️⃣ Configurar expedientes

Edita `expedientes.json`:

```json
{
  "expedientes": [
    {
      "numero": "1234/2025",
      "juzgado": "JUZGADO PRIMERO CIVIL CANCUN"
    }
  ]
}
```

### 3️⃣ Ejecutar

```bash
python3 buscar_expedientes.py
```

---

## 📁 Estructura de Archivos

```
TSJ_Filing/
├── buscar_expedientes.py    # Script principal
├── expedientes.json          # EDITA AQUÍ tus expedientes
├── config.json              # EDITA AQUÍ la configuración
├── requirements.txt         # Dependencias Python
├── instalar.sh             # Script de instalación
├── README.md               # Documentación completa
└── GUIA_RAPIDA.md          # Este archivo
```

---

## ✏️ Cómo Agregar Expedientes

### Por Número de Expediente:

```json
{
  "numero": "2358/2025",
  "juzgado": "JUZGADO SEGUNDO FAMILIAR ORAL CANCUN"
}
```

### Por Nombre de Actor:

```json
{
  "nombre": "JUAN PEREZ LOPEZ",
  "juzgado": "JUZGADO MERCANTIL PLAYA"
}
```

### Con Comentario (opcional):

```json
{
  "comentario": "Cliente importante - revisar urgente",
  "numero": "1234/2025",
  "juzgado": "JUZGADO PRIMERO CIVIL CANCUN"
}
```

---

## ⚙️ Configuración Rápida

Edita `config.json`:

```json
{
  "configuracion": {
    "max_pestanas": 5,           // 👈 Más = más rápido (consume más RAM)
    "dias_acuerdos_nuevos": 5,   // 👈 Últimos N días = "NUEVO"
    "debug_mode": true           // 👈 true = guardar screenshots
  }
}
```

---

## 🎨 Interpretando el Excel

| Color | Significado |
|-------|-------------|
| 🟦 **Encabezado azul** | Nombres de las columnas |
| 🟨 **Fila amarilla** | Acuerdo publicado en los últimos 5 días |
| ⭐ **"NUEVO"** | Indicador en la última columna |

---

## 🚀 Optimización del Rendimiento

### Para búsquedas rápidas (pocos expedientes):
```json
"max_pestanas": 3
```

### Para búsquedas masivas (muchos expedientes):
```json
"max_pestanas": 8
```

### Si tienes problemas de carga:
```json
"tiempo_espera_carga": 6  // Aumentar a 6-8 segundos
```

---

## 📋 Juzgados más Comunes

### Cancún - Familiar:
- `JUZGADO PRIMERO FAMILIAR ORAL CANCUN`
- `JUZGADO SEGUNDO FAMILIAR ORAL CANCUN`

### Cancún - Civil:
- `JUZGADO PRIMERO CIVIL CANCUN`
- `JUZGADO SEGUNDO CIVIL CANCUN`
- `JUZGADO TERCERO CIVIL CANCUN`
- `JUZGADO CUARTO CIVIL CANCUN`

### Cancún - Mercantil:
- `JUZGADO PRIMERO MERCANTIL CANCUN`
- `JUZGADO SEGUNDO MERCANTIL CANCUN`
- `JUZGADO TERCERO MERCANTIL CANCUN`

### Playa del Carmen:
- `JUZGADO FAMILIAR ORAL PLAYA`
- `JUZGADO PRIMERO CIVIL PLAYA`
- `JUZGADO MERCANTIL PLAYA`

**Ver lista completa en `expedientes.json`**

---

## 🔧 Problemas Comunes

### ❌ "ChromeDriver not found"
**Solución:** Descarga ChromeDriver desde https://chromedriver.chromium.org/

### ❌ "No se encontró expedientes.json"
**Solución:** Crea el archivo o usa los expedientes por defecto

### ❌ Páginas cargan incompletas
**Solución:** Aumenta `tiempo_espera_carga` en `config.json`

### ❌ Chrome consume mucha memoria
**Solución:** Reduce `max_pestanas` a 2-3

---

## 💡 Consejos

✅ **Nombra tus juzgados exactamente** como aparecen en la lista
✅ **Guarda copias** de tus archivos `expedientes.json` personalizados
✅ **Revisa la columna "NUEVO"** para identificar actualizaciones recientes
✅ **Usa debug_mode=false** en producción para mayor velocidad
✅ **Ejecuta búsquedas periódicas** (diarias/semanales) para monitorear casos

---

## 📞 Soporte

Para más información, consulta `README.md`

**Autor:** Jorge Israel Clemente Marié - Empírica Legal Lab
