# 🔧 Fix: Error de Permisos en GUI v6.2

## Problema Resuelto

### Error Original:
```
Error al cargar expedientes: [Errno 1] Operation not permitted: 'expedientes.json'
```

La GUI se abría pero los expedientes antiguos no se cargaban.

---

## 🎯 Solución Implementada

### Cambios Realizados:

1. **Rutas Absolutas** - La GUI ahora usa el directorio del script como base
   ```python
   script_dir = os.path.dirname(os.path.abspath(__file__))
   self.archivo_json = os.path.join(script_dir, "expedientes.json")
   ```

2. **Launcher Mejorado** - `iniciar_gui.sh` cambia al directorio correcto antes de ejecutar

3. **Ejecución Robusta** - Todos los subprocess usan `cwd=script_dir`

---

## ✅ Cómo Probar el Fix

### Método 1: Usar el Launcher (RECOMENDADO)

```bash
cd /home/user/TSJ_Filing
./iniciar_gui.sh
```

Deberías ver:
```
🤖 Iniciando Interfaz Gráfica...
📂 Directorio de trabajo: /home/user/TSJ_Filing
```

Y los 12 expedientes existentes deben aparecer cargados en la lista.

### Método 2: Ejecutar Directamente

```bash
cd /home/user/TSJ_Filing
python3 gui_expedientes.py
```

### Método 3: Desde Conda

```bash
# Activar conda (si no está activo)
conda activate base

# Navegar al directorio
cd /home/user/TSJ_Filing

# Ejecutar GUI
./iniciar_gui.sh
```

---

## 🧪 Script de Diagnóstico

Si aún tienes problemas, ejecuta el script de diagnóstico:

```bash
cd /home/user/TSJ_Filing
python3 test_permisos.py
```

Este script verificará:
- ✅ Lectura con rutas relativas y absolutas
- ✅ Permisos del archivo
- ✅ Capacidad de escritura
- ✅ Usuario actual y propietario del archivo

---

## 📊 Resultado Esperado

### Al Abrir la GUI:

1. **Título de la ventana**: `🤖 Robot de Búsqueda de Expedientes TSJ QRoo v6.2`

2. **Lista de expedientes**: Debe mostrar los 12 expedientes existentes:
   - 2358/2025 - JUZGADO SEGUNDO FAMILIAR ORAL CANCUN
   - 615/2019 - NOVENA SALA PENAL ORAL
   - ... (10 más)

3. **Contador**: Debe decir `(12 expedientes)` en la esquina superior derecha

4. **Sin errores**: No debe aparecer ningún mensaje de error al iniciar

---

## 🔍 Verificar Versión

Para confirmar que tienes la versión correcta:

### En la GUI:
- Mira el título de la ventana: Debe decir **v6.2** (no v6.1)

### En el código:
```bash
head -5 gui_expedientes.py
```

Debe decir:
```python
"""
Interfaz Gráfica para Robot de Búsqueda de Expedientes v6.2
...
FIX v6.2: Usa rutas absolutas para evitar errores de permisos
"""
```

---

## 🐛 Si Aún Hay Problemas

### Problema: "No such file or directory"

**Solución:** Asegúrate de estar en el directorio correcto:
```bash
cd /home/user/TSJ_Filing
ls -la expedientes.json  # Verificar que el archivo existe
python3 gui_expedientes.py
```

### Problema: "Permission denied" en el launcher

**Solución:** Dale permisos de ejecución:
```bash
chmod +x iniciar_gui.sh
./iniciar_gui.sh
```

### Problema: Expedientes no se guardan

**Solución:** Verifica permisos de escritura:
```bash
ls -la expedientes.json
# Debe mostrar: -rw-r--r-- (lectura/escritura para el propietario)

# Si necesario, cambiar permisos:
chmod 644 expedientes.json
```

### Problema: Chrome no se abre al ejecutar búsqueda

**Solución:** Verifica que buscar_expedientes.py está en el mismo directorio:
```bash
ls -la buscar_expedientes.py
```

---

## 📝 Cambios en esta Versión (v6.2)

### gui_expedientes.py
- ✅ Usa `os.path.abspath(__file__)` para rutas
- ✅ Todas las operaciones con archivos usan rutas absolutas
- ✅ subprocess.run() incluye `cwd=script_dir`

### iniciar_gui.sh
- ✅ Cambia al directorio del script antes de ejecutar
- ✅ Muestra el directorio de trabajo actual

### Nuevo: test_permisos.py
- 🔧 Script de diagnóstico
- 🔧 Verifica permisos y acceso al archivo
- 🔧 Compara rutas relativas vs absolutas

---

## ✨ Beneficios del Fix

1. **Funciona desde cualquier directorio** - No importa desde dónde ejecutes el script
2. **Compatible con Conda** - Funciona correctamente en entornos virtuales
3. **Más robusto** - Evita errores de permisos en macOS/Linux
4. **Sin configuración** - No necesitas configurar variables de entorno

---

## 📞 Siguiente Paso

**Intenta ejecutar la GUI ahora:**

```bash
cd /home/user/TSJ_Filing
./iniciar_gui.sh
```

Si ves los 12 expedientes en la lista, **el fix funcionó correctamente!** ✅

Si aún tienes problemas, envía la salida de:
```bash
python3 test_permisos.py
```

---

**Fix implementado:** 24 enero 2026
**Versión:** v6.2
**Commit:** e4a78cd
