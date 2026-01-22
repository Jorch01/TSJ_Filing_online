# 🖥️ Guía de Interfaz Gráfica

## Robot de Búsqueda de Expedientes v6.1 - Modo Visual

La interfaz gráfica te permite agregar y gestionar expedientes de manera visual, sin necesidad de editar archivos JSON manualmente.

---

## 🚀 Inicio Rápido

### Abrir la Interfaz Gráfica:

```bash
./iniciar_gui.sh
```

O directamente:

```bash
python3 gui_expedientes.py
```

O en sistemas con Conda:

```bash
python gui_expedientes.py
```

---

## 📸 Características de la Interfaz

### Panel Izquierdo - Agregar Expedientes

1. **Tipo de Búsqueda:**
   - ⚪ Por número de expediente (ej: 2358/2025)
   - ⚪ Por nombre de actor/parte (ej: JUAN PEREZ)

2. **Campo de Texto:**
   - Ingresa el número de expediente o nombre según el tipo seleccionado
   - Presiona ENTER para agregar rápidamente

3. **Seleccionar Juzgado/Sala:**
   - Lista desplegable organizada por categorías:
     - 🏛️ Salas de Segunda Instancia
     - 📍 Cancún (Familiar, Civil, Mercantil, Laboral)
     - 📍 Playa del Carmen
     - 📍 Chetumal
     - 📍 Otros Municipios

4. **Comentario (Opcional):**
   - Agrega notas personales para cada expediente

5. **Botones:**
   - ➕ **Agregar Expediente**: Añade a la lista
   - 🔄 **Limpiar**: Limpia el formulario

### Panel Derecho - Lista de Expedientes

- **Vista de tabla** con todos los expedientes agregados
- **Columnas:**
  - Tipo (📄 Expediente o 👤 Nombre)
  - Expediente/Nombre
  - Juzgado/Sala

- **Contador** de expedientes totales

- **Botones de gestión:**
  - 🗑️ **Eliminar Seleccionado**: Quita el expediente seleccionado
  - 🗑️ **Limpiar Todo**: Elimina todos los expedientes

### Panel Inferior - Acciones Principales

- 🚀 **EJECUTAR BÚSQUEDA**: Inicia la búsqueda automática
- 💾 **Guardar Expedientes**: Guarda en expedientes.json

---

## 🎯 Flujo de Trabajo

### Opción 1: Búsqueda Rápida

1. Abre la GUI: `./iniciar_gui.sh`
2. Agrega tus expedientes uno por uno
3. Click en "🚀 EJECUTAR BÚSQUEDA"
4. Espera a que termine (verás Chrome abriéndose)
5. Revisa el archivo Excel generado

### Opción 2: Preparar Lista para Después

1. Abre la GUI
2. Agrega todos tus expedientes
3. Click en "💾 Guardar Expedientes"
4. Cierra la GUI
5. Cuando quieras buscar, abre la GUI y click en "🚀 EJECUTAR BÚSQUEDA"

---

## 💡 Consejos de Uso

### ⚡ Atajos de Teclado

- **ENTER** en el campo de texto: Agrega el expediente automáticamente
- **TAB**: Navega entre campos

### 📝 Agregar Múltiples Expedientes

**Mismo Juzgado:**
1. Selecciona el juzgado una vez
2. Ingresa cada expediente y presiona ENTER
3. El juzgado se mantiene seleccionado

**Diferentes Juzgados:**
1. Ingresa expediente
2. Cambia juzgado
3. Click "Agregar"
4. Repite

### 🔍 Organización

**Usa comentarios para:**
- Identificar clientes
- Marcar prioridades
- Agregar recordatorios
- Agrupar por tipo

Ejemplos:
- "Cliente: Empresa ABC"
- "URGENTE - Revisar hoy"
- "Apelación - Seguimiento"

---

## 🎨 Interfaz Visual

### Colores y Significados

| Elemento | Color | Significado |
|----------|-------|-------------|
| 🟦 Encabezado azul | `#366092` | Identidad TSJ |
| 🟢 Botón "Agregar" | Verde | Acción positiva |
| 🔵 Botón "Ejecutar" | Azul | Acción principal |
| 🟠 Botón "Guardar" | Naranja | Acción de guardado |
| 🔴 Botones "Eliminar" | Rojo | Acción destructiva |
| ⚫ Botón "Limpiar" | Gris | Acción neutral |

### Iconos

- 📄 = Búsqueda por expediente
- 👤 = Búsqueda por nombre
- 🏛️ = Sala de Segunda Instancia
- 📍 = Juzgado de Primera Instancia

---

## ⚙️ Integración con el Sistema

### Archivo expedientes.json

La GUI lee y escribe en `expedientes.json`:
- **Carga automática** al iniciar
- **Guardado manual** con botón "💾 Guardar"
- **Guardado automático** antes de ejecutar búsqueda
- **Preserva** toda la estructura del JSON (juzgados_disponibles, ejemplos, etc.)

### Ejecución del Bot

Al hacer click en "🚀 EJECUTAR BÚSQUEDA":
1. Guarda expedientes en JSON
2. Ejecuta `buscar_expedientes.py` en segundo plano
3. Chrome se abre automáticamente
4. Se procesa cada expediente
5. Se genera el Excel al finalizar

---

## 🔧 Solución de Problemas

### La GUI no abre

**Problema:** `ModuleNotFoundError: No module named 'tkinter'`

**Solución en macOS:**
```bash
# Tkinter viene con Python, pero si falta:
brew install python-tk
```

**Solución en Linux:**
```bash
sudo apt-get install python3-tk
```

### Error al ejecutar búsqueda

**Problema:** "No se pudo ejecutar el script"

**Solución:**
1. Asegúrate de estar en el directorio correcto
2. Verifica que `buscar_expedientes.py` existe
3. Revisa que las dependencias estén instaladas

### La lista no se actualiza

**Solución:**
- Click en "🔄 Limpiar" y vuelve a agregar
- Cierra y abre la GUI nuevamente
- Verifica que `expedientes.json` no esté corrupto

### Juzgado no aparece en la lista

**Solución:**
- Usa el nombre exacto del juzgado
- Revisa que el juzgado esté en `buscar_expedientes.py`
- Reporta si es un juzgado nuevo

---

## 📊 Ventajas de la GUI vs Manual

| Característica | GUI | Edición Manual |
|----------------|-----|----------------|
| Facilidad | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| Velocidad | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Errores | Menos | Más propenso |
| Validación | Automática | Manual |
| Visualización | Lista clara | JSON crudo |
| Aprendizaje | Inmediato | Requiere práctica |

---

## 🎓 Casos de Uso

### Caso 1: Abogado con 10 expedientes diarios

```
1. Abre GUI al inicio del día
2. Agrega los 10 expedientes
3. Ejecuta búsqueda
4. Revisa Excel mientras toma café
5. Tiene todos los acuerdos nuevos identificados
```

### Caso 2: Despacho con múltiples casos

```
1. Mantiene lista permanente en expedientes.json
2. Abre GUI solo para agregar nuevos casos
3. Ejecuta búsqueda semanal
4. Compara Excels para ver cambios
```

### Caso 3: Búsqueda única

```
1. Abre GUI
2. Agrega 1 expediente específico
3. Ejecuta inmediatamente
4. Cierra todo
```

---

## 🚀 Funciones Avanzadas (Próximamente)

Estas funciones están planeadas para futuras versiones:

- 📅 **Programar búsquedas** automáticas diarias/semanales
- 📧 **Notificaciones** por email de acuerdos nuevos
- 📊 **Estadísticas** visuales de expedientes
- 🔄 **Sincronización** en la nube
- 📱 **Versión móvil**
- 🎨 **Temas personalizables**

---

## 💬 Feedback

Si tienes sugerencias de mejoras para la GUI, compártelas con el equipo de desarrollo.

**Autor:** Jorge Israel Clemente Marié - Empírica Legal Lab
