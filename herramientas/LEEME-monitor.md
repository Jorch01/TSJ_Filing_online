# Monitor de integraciones y despliegue del Worker

## Qué hay

| Archivo | Para qué |
|---|---|
| `herramientas/monitor-integraciones.js` | Prueba en vivo cada integración con una consulta conocida y dice qué falló. `--lista` enseña las 15 pruebas. |
| `herramientas/monitor-issue.js` | Abre, actualiza o cierra el issue `monitor-integraciones` según el resultado. |
| `herramientas/verificar-worker.js` | Compara `/health` del Worker publicado con `WORKER_VERSION` del repo. |
| `herramientas/certificados/root-yr-by-x1.pem` | Certificado de Let's Encrypt que SISE no manda en su cadena (ver abajo). |
| `.github/workflows/monitor-integraciones.yml` | Corre el monitor cada día (7:37 Cancún) y a mano. |
| `.github/workflows/desplegar-worker.yml` | Despliega el Worker con wrangler. **No hace nada sin `CLOUDFLARE_API_TOKEN`.** |
| `docs/proxy/wrangler.toml` | Describe el Worker publicado: nombre, código y el KV `CUOTAS`. |

Cada prueba termina en `ok`, `falla`, `omitida` o `aviso`. Solo `falla` abre issue.
Una prueba **omitida** (falta un secreto opcional) no es una falla.

## Secretos y variables de GitHub

`Settings → Secrets and variables → Actions`.

| Nombre | Tipo | ¿Obligatorio? | Para qué |
|---|---|---|---|
| `MONITOR_LICENCIA_CODIGO` | Secret | Opcional | Una licencia Premium. Sin ella se omiten las pruebas que exigen el pase de `/cuota` (búsquedas de MARCia, SIGA y Marcanet, y `/api/sesiones`). Conviene una licencia solo para el monitor. Su dispositivo (`monitor-integraciones`, o el de `MONITOR_LICENCIA_DISPOSITIVO`) tiene que estar **registrado** en ella: el Worker solo da Premium a dispositivos registrados. Se registra poniendo en la columna J de esa fila `[{"id":"monitor-integraciones","tipo":"desktop","nombre":"Monitor GitHub","fechaRegistro":"2026-11-12T00:00:00Z"}]`. |
| `GEMINI_API_KEY` | Secret | Opcional | Sin ella se omite la prueba de Gemini. |
| `CLOUDFLARE_API_TOKEN` | Secret | Para desplegar | Sin él, el workflow de despliegue avisa y termina en verde sin tocar nada. De preferencia el que ofrece el propio worker (Settings → Builds → "API token for external CI/CD"), que solo puede desplegar este Worker; si le faltan permisos, la plantilla "Edit Cloudflare Workers". |
| `CUOTAS_KV_ID` | Variable | Si hay token | Id del KV `CUOTAS` (Cloudflare → Storage & databases → Workers KV → `tsj-cuotas`, o el worker → Settings → Bindings). Sin él el despliegue se detiene: wrangler borra los bindings que no declara el `wrangler.toml`. |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Opcional | Solo si el token ve más de una cuenta. |

`CUOTA_SECRETO` **no** va en GitHub: vive en Cloudflare y un despliegue no lo toca.
El workflow se detiene si el worker no lo tiene.

## Primer uso

1. Fusionar el PR.
2. Poner los secretos que se quieran (los opcionales pueden esperar).
3. `Actions → Monitor de integraciones → Run workflow` para ver el primer informe
   (queda también en el resumen del trabajo).
4. Para desplegar: poner `CLOUDFLARE_API_TOKEN` y `CUOTAS_KV_ID`, y correr
   `Actions → Desplegar Worker → Run workflow`. Después, cada cambio a
   `docs/proxy/impi-proxy-worker.js` en `main` se despliega solo.
   **Antes del primer despliegue** conviene comparar el panel de Cloudflare con
   `wrangler.toml`: lo que esté puesto a mano y no figure ahí (cron triggers,
   rutas, dominios, fecha de compatibilidad, logs) se pierde o se cambia; las
   variables de texto se conservan (`--keep-vars`). Se comparó el 12/11/2026.
5. Al cambiar el Worker, subir `WORKER_VERSION`; el despliegue avisa si `/health`
   no devuelve esa versión, y el monitor lo marca como aviso.

## SISE y su certificado

`www.dgej.cjf.gob.mx` sirve una cadena incompleta: el certificado de Let's Encrypt
YR2 sin el cruzado de Root YR. Los navegadores lo completan solos; Node no. Por eso
el monitor, al consultar SISE directo, necesita
`NODE_EXTRA_CA_CERTS=herramientas/certificados/root-yr-by-x1.pem` (es el
`root-yr-by-x1.pem` de letsencrypt.org; el workflow ya lo pone y una prueba comprueba
su huella). Esto va en la variable de entorno, antes de arrancar Node. La prueba
`sesiones-sise` pasa por el Worker y no lo necesita.

## Probarlo a mano

```
node herramientas/monitor-integraciones.js            # sin secretos: omite lo que los necesita
MONITOR_LICENCIA_CODIGO=... GEMINI_API_KEY=... \
NODE_EXTRA_CA_CERTS=$PWD/herramientas/certificados/root-yr-by-x1.pem \
  node herramientas/monitor-integraciones.js --json r.json --markdown r.md
node test_monitor_integraciones.js                    # las pruebas (sin red)
```

## Privacidad

El issue vive en un repo público. Las consultas son fijas (`COCA COLA`, un expediente
inventado `462:1/2000`); toda cadena del informe pasa por `limpiar()`, que quita la
licencia, claves de Gemini, pases y correos, y recorta a 300 caracteres. Nunca se
copia una respuesta completa.
