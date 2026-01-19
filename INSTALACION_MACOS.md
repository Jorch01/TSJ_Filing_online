# 🍎 Guía de Instalación para macOS

## Tu Situación Actual

Tienes:
- ✅ Python instalado vía Homebrew
- ✅ Conda instalado (veo `(base)` en tu terminal)
- ⚠️ Error PEP 668 al intentar `pip3 install`

---

## ✅ Solución Rápida (Opción 1 - RECOMENDADA)

### Usa Conda que ya tienes activo:

```bash
# Asegúrate de estar en ambiente conda (debes ver "(base)" en el prompt)
conda install selenium openpyxl
```

O si prefieres pip dentro de conda:

```bash
pip install selenium openpyxl
```

**Nota:** Dentro de conda usa `pip`, no `pip3`.

Luego ejecuta el bot:

```bash
python buscar_expedientes.py
```

---

## 🔄 Opción 2: Entorno Virtual Dedicado

Si prefieres un entorno limpio solo para este proyecto:

### 1. Crear y configurar entorno virtual:

```bash
./setup_venv.sh
```

### 2. O manualmente:

```bash
# Crear entorno virtual
python3 -m venv venv

# Activar (debes hacer esto cada vez que uses el proyecto)
source venv/bin/activate

# Instalar dependencias
pip install selenium openpyxl

# Ejecutar el bot
python buscar_expedientes.py

# Desactivar cuando termines
deactivate
```

---

## 🛠️ Opción 3: Instalación con --user

Si no quieres usar entornos virtuales ni conda:

```bash
pip3 install --user selenium openpyxl
```

Luego ejecuta:

```bash
python3 buscar_expedientes.py
```

---

## 🌐 Instalar ChromeDriver

El bot necesita ChromeDriver para controlar Chrome:

### Opción más fácil (con Homebrew):

```bash
brew install chromedriver
```

### Si brew lo bloquea por seguridad:

```bash
# Después de instalar
xattr -d com.apple.quarantine $(which chromedriver)
```

### Opción manual:

1. Descarga desde: https://chromedriver.chromium.org/
2. Descomprime
3. Mueve a `/usr/local/bin/`:
   ```bash
   sudo mv chromedriver /usr/local/bin/
   sudo chmod +x /usr/local/bin/chromedriver
   ```

---

## 🚀 Verificar Instalación

```bash
# Verificar Python
python3 --version

# Verificar ChromeDriver
chromedriver --version

# Si usas conda
conda list selenium
conda list openpyxl
```

---

## 📋 Resumen de Comandos según tu Preferencia

### Si usas Conda (RECOMENDADO porque ya lo tienes):

```bash
# Instalar
conda install selenium openpyxl

# Ejecutar
python buscar_expedientes.py
```

### Si usas Entorno Virtual:

```bash
# Primera vez
./setup_venv.sh

# Cada vez que uses el proyecto
source venv/bin/activate
python buscar_expedientes.py
deactivate
```

### Si usas --user:

```bash
# Instalar
pip3 install --user selenium openpyxl

# Ejecutar
python3 buscar_expedientes.py
```

---

## ❓ Problemas Comunes

### "conda: command not found"

Si instalaste Miniconda/Anaconda pero no está en PATH:

```bash
# Añadir conda al PATH
export PATH="$HOME/miniconda3/bin:$PATH"

# O reinicia la terminal después de instalar conda
```

### "chromedriver cannot be opened because..."

macOS bloquea el ejecutable por seguridad:

```bash
xattr -d com.apple.quarantine /usr/local/bin/chromedriver
```

### "Permission denied" al ejecutar scripts

```bash
chmod +x instalar.sh
chmod +x setup_venv.sh
```

---

## 💡 Mi Recomendación

Como ya tienes Conda activo (`(base)` en tu prompt):

1. **Instala con conda:**
   ```bash
   conda install selenium openpyxl
   ```

2. **Instala ChromeDriver:**
   ```bash
   brew install chromedriver
   ```

3. **Ejecuta el bot:**
   ```bash
   python buscar_expedientes.py
   ```

¡Listo! Sin complicaciones de entornos virtuales adicionales.

---

## 📞 Necesitas Ayuda?

Si sigues teniendo problemas, comparte:
- El output completo del error
- La salida de: `which python`, `python --version`, `conda --version`
- Tu sistema: `sw_vers`
