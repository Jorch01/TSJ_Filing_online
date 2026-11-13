# Verificador de viabilidad de marca en empirica.mx

El sitio del despacho (repositorio `empirica.mx-nuevo-feb-2026`) tiene un verificador de viabilidad de marca
en `landing-registro-marcas-cancun.html`. Usa **este mismo Worker** (`throbbing-scene-1c2b`), con reglas propias
que **no cambian lo que hace la app**.

## Qué hace el Worker para el sitio (sección `SITIO PÚBLICO` de `impi-proxy-worker.js`)

| Regla | Cómo |
|---|---|
| CORS | Se agregan `https://empirica.mx` y `https://www.empirica.mx` a `ALLOWED_ORIGINS`. **No se quitó ninguno** (la app sigue igual: `tsjia.empirica.mx`, `jorch01.github.io` y `localhost`). |
| Límite | **1 estudio al mes por IP** (`CUOTAS.viabilidad_sitio`). Cuenta solo la IP (guardada como resumen SHA-256), sin Premium ni huellas. |
| Turnstile | `POST /cuota { tipo: "viabilidad_sitio", turnstile }` verifica el token con Cloudflare **antes** de contar: un intento fallido no gasta el estudio. |
| Pase | El pase firmado dura 30 min. El del sitio **solo abre** `/marcia/search`, `/siga/search` y `/marcanet/fonetica`, y **solo desde** los orígenes del sitio. No abre las demás rutas del IMPI ni las sesiones de tribunales. |
| Caché | 1 hora (Cache API), **solo para el sitio con su pase**: `/marcanet/fonetica`, `/siga/search`, `/marcanet/full-detail` y `/marcia/view/*`. Nunca guarda vacíos ni errores. MARCia (búsqueda y resultados) no se cachea: su sesión viaja con el cliente. |
| Apagado seguro | Sin `TURNSTILE_SECRET`, sin el KV `CUOTAS` o sin `CUOTA_SECRETO`, el estudio del sitio **no concede ningún pase** (503). |

`/health` ahora incluye `sitio: { turnstile: true|false }` para saber si el secreto está puesto.

## Lo que hay que hacer en Cloudflare (una sola vez)

1. **Crear el widget de Turnstile**: Cloudflare → Turnstile → *Add widget*. Hostnames: `empirica.mx` y `www.empirica.mx`.
   Modo *Managed*. Anota la **Site Key** (pública) y la **Secret Key**.
2. **Poner el secreto en el Worker** (la clave secreta nunca va en el repo):
   ```bash
   npx wrangler secret put TURNSTILE_SECRET --config docs/proxy/wrangler.toml
   ```
   o en el panel: Workers & Pages → `throbbing-scene-1c2b` → Settings → Variables and Secrets → *Add* (tipo *Secret*) → `TURNSTILE_SECRET`.
3. **Desplegar el Worker** (ver abajo).
4. **Poner la Site Key en el sitio**: `js/verificador-config.js` → `turnstileSiteKey: '...'` y publicar el sitio.

Mientras `turnstileSiteKey` esté vacía, el verificador del sitio dice que no está disponible y manda a WhatsApp; no llama al Worker.

## Desplegar el Worker

El flujo normal es el del repositorio: al llegar a `main`, `.github/workflows/desplegar-worker.yml` corre las pruebas y
despliega con wrangler (solo si existe el secreto `CLOUDFLARE_API_TOKEN`; si no, no hace nada y el Worker se publica a mano).
El workflow ahora también corre `test_viabilidad_sitio.js` y `test_verificador_sitio.js`.

Antes de producción, conviene comprobar el cambio:

```bash
node test_viabilidad_sitio.js && node test_verificador_sitio.js && node test_cuotas_impi.js && node test_proxy_enlaces.js && node test_sesiones.js
```

Después de desplegar: `GET https://throbbing-scene-1c2b.enlilh.workers.dev/health` debe responder
`"version": "2026-11-13-verificador-sitio"`, `"cuotas": true` y `"sitio": { "turnstile": true }`.

**Retroceder**: el cambio es aditivo. Si algo falla, basta volver a desplegar la versión anterior del archivo
(`2026-11-12-cuotas-por-ip`); la app no depende de nada nuevo.

## El módulo del sitio

El estudio del verificador lo hace `js/verificador-marca-motor.js` en el repo del sitio. **Es un archivo generado** desde
`docs/js/impi-viabilidad.js` (motor + orquestación de consultas), sin tocar la app:

```bash
node herramientas/generar-verificador-sitio.js ../empirica.mx-nuevo-feb-2026/js/verificador-marca-motor.js
node herramientas/generar-verificador-sitio.js --comprobar ../empirica.mx-nuevo-feb-2026/js/verificador-marca-motor.js   # ¿está al día?
```

Si se mejora el motor en la app, hay que volver a generar el módulo y publicar el sitio. `test_verificador_sitio.js` falla si alguien
mete algo de la interfaz de la app en las partes que se extraen.

## Probar de punta a punta

```bash
node herramientas/e2e-verificador-sitio.js ../empirica.mx-nuevo-feb-2026
```

Abre la landing en Chromium (escritorio y móvil) con el Worker completo en memoria; simula solo a Cloudflare, al IMPI y al Apps Script.
Necesita Playwright.

## Leads

El formulario de desbloqueo envía al Apps Script `contacto` del sitio (el mismo del formulario rápido): guarda en la hoja «Contactos» y
avisa por correo a `frida@empirica.mx` y `jorge_clemente@empirica.mx`, con `perfil = verificador-marca` y un resumen del estudio.

## Eventos de Google Analytics 4

`marca_estudio_iniciado`, `marca_resultado_mostrado` (con `semaforo`, `antecedentes`, `para_revisar`) y `generate_lead`
(`method: verificador_marca`). Ninguno lleva datos personales ni la denominación.

## Límite conocido

El límite es por IP: detrás de una red compartida (oficina, red móvil con IP compartida), varias personas comparten el estudio del mes.
El pase de 30 minutos permite reintentar lo que no respondió sin gastar otro estudio.
