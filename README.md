# ⚖️ TSJ Filing Online v7.0

## Sistema de Gestión de Expedientes - TSJ Quintana Roo

**Versión Web Completa** | **Base de Datos Local** | **Sin Instalación**

🌐 **[Acceder a la Aplicación Web](https://jorch01.github.io/TSJ_Filing_online/)**

---

## 🎯 Características Principales

### 🌐 Versión Web (NUEVA v7.0)
- ✅ **100% en el navegador** - No requiere instalación
- ✅ **Base de datos local** - Tus datos se guardan en tu computadora (IndexedDB)
- ✅ **Funciona offline** - Service Worker para uso sin conexión
- ✅ **Multiplataforma** - Chrome, Firefox, Safari, Edge
- ✅ **Diseño responsivo** - Funciona en desktop, tablet y móvil

### 📁 Gestión de Expedientes
- ✅ Agregar, editar y eliminar expedientes
- ✅ Organización por juzgados y categorías
- ✅ Búsqueda y filtrado avanzado
- ✅ Importar/Exportar datos (JSON, Excel, CSV)

### 📅 Calendario y Agenda
- ✅ Calendario mensual interactivo
- ✅ Eventos por expediente (audiencias, vencimientos, etc.)
- ✅ Alertas y recordatorios
- ✅ Vista de eventos próximos

### 📝 Sistema de Notas
- ✅ Notas vinculadas a expedientes
- ✅ Colores personalizables
- ✅ Recordatorios con fecha
- ✅ Búsqueda en notas

### 🔔 Notificaciones
- ✅ Notificaciones del navegador
- ✅ Alertas de eventos próximos
- ✅ Recordatorios por email (EmailJS)
- ✅ Sonidos de alerta configurables

### 🔍 Búsqueda en TSJ
- ✅ Extensión de navegador (Chrome, Firefox, Safari)
- ✅ Búsqueda automática de publicaciones
- ✅ Modo manual con URLs directas
- ✅ Exportación de resultados

---

## 🚀 Comenzar

### Opción 1: Usar la Versión Web (Recomendado)

Simplemente visita: **https://jorch01.github.io/TSJ_Filing_online/**

Tus datos se guardarán automáticamente en tu navegador.

### Opción 2: Versión de Escritorio (Python)

Si prefieres la versión de escritorio con automatización completa:

```bash
# Clonar repositorio
git clone https://github.com/Jorch01/TSJ_Filing_online.git
cd TSJ_Filing_online

# Instalar dependencias
pip3 install selenium openpyxl

# Ejecutar interfaz gráfica
./iniciar_gui.sh
```

---

## 📱 Instalación de la Extensión

Para habilitar búsquedas automáticas, instala la extensión de navegador:

### Chrome / Edge / Brave
1. Descarga `extension/chrome.zip`
2. Ve a `chrome://extensions`
3. Activa "Modo desarrollador"
4. Arrastra el archivo .zip

### Firefox
1. Descarga `extension/firefox.xpi`
2. Ve a `about:addons`
3. Haz clic en el engranaje → "Instalar complemento desde archivo"

### Safari
1. Descarga `extension/safari.zip`
2. Descomprime y sigue las instrucciones del README incluido

---

## 🏛️ Juzgados y Salas Soportados

### Salas de Segunda Instancia
- Primera Sala Civil Mercantil y Familiar
- Segunda Sala Penal Oral
- Tercera a Décima Salas
- Sala Constitucional

### Primera Instancia
- **Cancún**: Civil, Familiar, Mercantil, Laboral
- **Playa del Carmen**: Civil, Familiar, Mercantil, Laboral
- **Chetumal**: Civil, Familiar, Mercantil, Laboral
- **Cozumel, Tulum, Isla Mujeres** y más

Ver lista completa en la aplicación.

---

## 📊 Estructura del Proyecto

```
TSJ_Filing_online/
├── web/                    # Aplicación web (Svelte)
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/ # Componentes reutilizables
│   │   │   ├── services/   # Base de datos, email, notificaciones
│   │   │   ├── stores/     # Estado global (Svelte stores)
│   │   │   └── data/       # Datos de juzgados
│   │   └── routes/         # Páginas de la aplicación
│   └── static/             # Archivos estáticos
│
├── extension/              # Extensión de navegador
│   ├── chrome/             # Manifest v3 para Chrome
│   ├── firefox/            # Manifest v3 para Firefox
│   ├── safari/             # Para Safari
│   └── shared/             # Código compartido
│
├── *.py                    # Scripts Python (versión desktop)
├── *.json                  # Configuración
└── *.md                    # Documentación
```

---

## 🛠️ Desarrollo Local

### Requisitos
- Node.js 18+
- npm o pnpm

### Instalación

```bash
cd web
npm install
npm run dev
```

### Build para Producción

```bash
npm run build
```

Los archivos se generan en `web/build/`.

---

## 📧 Configuración de Email (Opcional)

Para recibir recordatorios por email:

1. Crea cuenta en [EmailJS](https://www.emailjs.com/) (gratis, 200 emails/mes)
2. Configura un servicio de email
3. Crea una plantilla
4. Ingresa las credenciales en Configuración → Email

---

## 🔐 Privacidad

- **Todos los datos se almacenan localmente** en tu navegador
- No hay servidor central ni base de datos externa
- Tus expedientes y notas nunca salen de tu computadora
- Puedes exportar tus datos en cualquier momento

---

## 📝 Changelog

### v7.0 (2026-01-24) 🌐 VERSIÓN WEB
- 🎉 **Aplicación web completa** con Svelte
- ✨ Base de datos local con IndexedDB
- ✨ Sistema de notas por expediente
- ✨ Calendario y agenda integrados
- ✨ Notificaciones web y por email
- ✨ Extensión de navegador multiplataforma
- ✨ PWA con modo offline
- ✨ Exportación a Excel/CSV/JSON
- ✨ Diseño responsivo moderno

### v6.2 (2025-01-22)
- 🖥️ Interfaz gráfica con Tkinter
- ✅ Fix para Salas de Segunda Instancia
- ✅ 11 Salas completamente configuradas

### v6.0 (2025-01-19)
- ✨ Búsquedas simultáneas
- ✨ Reportes Excel con formato

---

## 👨‍💻 Autor

**Jorge Israel Clemente Marié** - Empírica Legal Lab

---

## 📄 Licencia

MIT License - Uso libre
