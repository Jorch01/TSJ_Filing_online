# SIGA 2.0 - Documentación de API e Integración

**Sitio:** https://siga.impi.gob.mx/
**API Base URL:** `https://siga.impi.gob.mx:5007`
**Versión UI:** 2.2.0
**Framework Frontend:** Angular (versión 2-8) + Angular Material
**Backend:** ASP.NET Core (inferido de los mensajes de error)

---

## 1. Autenticación y Seguridad

### CSRF / XSRF
- **Cookie:** `XSRF-TOKEN` (se setea automáticamente al visitar el sitio)
- **Header requerido:** `X-XSRF-TOKEN: <valor_de_la_cookie_decodificado>`
- Sin este header, el API devuelve `400` con `"Error de validación CSRF"`

### reCAPTCHA v3
- **Site Key:** `6LeRdm0pAAAAAOprsyOxSYwiBsVUmGSMdnCuA-P6`
- Se usa reCAPTCHA v3 invisible (Google)
- El token se genera con: `grecaptcha.execute(siteKey, {action: 'search'})`
- Se envía en el payload como campo `ReCaptchaToken`

### Headers requeridos para todas las peticiones
```
Content-Type: application/json
Accept: application/json
X-XSRF-TOKEN: <token_CSRF>
credentials: include (para enviar cookies)
```

---

## 2. Endpoint Principal: Búsqueda de Fichas

### `POST /api/BusquedaFicha/GetFichas`

**Request Payload:**
```json
{
  "Busqueda": "coca cola",
  "IdArea": "2",
  "IdGaceta": [],
  "FechaDesde": "",
  "FechaHasta": "",
  "ReCaptchaToken": "<token_recaptcha_v3>"
}
```

**Campos del payload:**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `Busqueda` | string | Sí | Término de búsqueda |
| `IdArea` | string | Sí | ID del área (ver catálogo abajo) |
| `IdGaceta` | int[] | Sí | Array de IDs de gaceta (vacío = todas) |
| `FechaDesde` | string | No | Fecha inicio (formato por determinar) |
| `FechaHasta` | string | No | Fecha fin |
| `ReCaptchaToken` | string | Sí | Token reCAPTCHA v3 |

**Nota sobre PascalCase:** Los nombres de campos usan **PascalCase** (primera letra mayúscula). El backend de ASP.NET rechaza camelCase.

### Catálogo de Áreas (IdArea)

| IdArea | Nombre |
|--------|--------|
| `"1"` | Patentes |
| `"2"` | Marcas |
| `"3"` | Protección a la Propiedad Intelectual |

### Response (200 OK):
```json
{
  "successed": true,
  "message": null,
  "errors": null,
  "data": [
    {
      "fichaId": 14660421,
      "areaId": 2,
      "ejemplar": "Noviembre de 2025",
      "gaceta": "Conservación de los Derechos",
      "seccion": "Marcas Renovadas en el Mes",
      "fechaPuestaCirculacion": "10/12/2025",
      "imagen": false,
      "countImagen": 0,
      "vinculos": false,
      "datos": [
        {
          "descripcion": "Resolución",
          "datoTxt": "891873/2025",
          "orden": 1
        },
        {
          "descripcion": "Registro de Marca",
          "datoTxt": "913909",
          "orden": 2
        },
        {
          "descripcion": "Clase",
          "datoTxt": "32",
          "orden": 3
        },
        {
          "descripcion": "Denominación",
          "datoTxt": "COCA-COLA ZERO",
          "orden": 4
        }
      ]
    }
  ]
}
```

**Estructura del objeto `data[]`:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `fichaId` | int | ID único de la ficha |
| `areaId` | int | ID del área (2 = Marcas) |
| `ejemplar` | string | Mes/año del ejemplar (ej: "Noviembre de 2025") |
| `gaceta` | string | Nombre de la gaceta (ej: "Conservación de los Derechos") |
| `seccion` | string | Sección dentro de la gaceta |
| `fechaPuestaCirculacion` | string | Fecha de publicación (DD/MM/YYYY) |
| `imagen` | bool | Si tiene imagen asociada |
| `countImagen` | int | Cantidad de imágenes |
| `vinculos` | bool | Si tiene vínculos |
| `datos` | array | Array de campos dinámicos de la ficha |

**Estructura de `datos[]`:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `descripcion` | string | Nombre del campo (ej: "Resolución", "Clase") |
| `datoTxt` | string | Valor del campo |
| `orden` | int | Orden de visualización |

---

## 3. Otros Endpoints Descubiertos

### Búsqueda de Fichas
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/BusquedaFicha/GetFichas` | Búsqueda principal en fichas |
| POST | `/api/BusquedaFicha/GetTitlesCount` | Conteo de títulos por búsqueda |
| POST | `/api/BusquedaFicha/GetFichaInfo` | Detalle de una ficha específica (body: `{id, reCaptchaToken}`) |
| POST | `/api/BusquedaFicha/getVinculos` | Vínculos de una ficha (body: `{id}`) |
| POST | `/api/BusquedaFicha/FichasGacetaPDF` | Descargar ficha como PDF (body: `{id}`) |
| GET  | `/api/BusquedaFicha/GetPdfById` | Obtener PDF por ID |

### Búsqueda Especializada / Estructurada
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/BusquedaEstructurada/SearchFullText` | Búsqueda de texto completo (body: `{busqueda}`) |
| GET  | `/api/BusquedaEstructurada/GetPdfById` | PDF por ID |

### Búsqueda por Imágenes
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| - | `/api/BusquedaImagenes` | Búsqueda por imágenes |

### Búsqueda Simple
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| - | `/api/BusquedaSimple` | Búsqueda simple |

### Catálogos / Gacetas
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/Gacetas/GetVersion` | Versión actual del sistema |
| - | `/api/Gacetas` | Catálogo de gacetas |

### Descarga de Ejemplares
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| - | `/api/DescargaEjemplares/GetEjemplares` | Lista de ejemplares |
| - | `/api/DescargaEjemplares/GetEjemplaresArrayByFecha` | Ejemplares por fecha |
| GET | `/api/DescargaEjemplares/getFichaHTML` | Ficha en HTML (`?idEjemplar=&idSeccion=`) |
| - | `/api/DescargaEjemplares/getColumnsBySeccion` | Columnas por sección |
| - | `/api/DescargaEjemplares/GetSeccionesByEjempl...` | Secciones por ejemplar |
| - | `/api/DescargaEjemplares/GetManualPDF` | Manual en PDF |

---

## 4. Estructura HTML de Resultados (Frontend Angular)

### Contenedor principal
```
app-root
  └─ app-busqueda-fichas
       └─ mat-drawer-container
            └─ mat-drawer-content
                 └─ div.example-sidenav-content
                      └─ div.container  (resultados)
```

### Tarjeta de resultado individual
```html
<div class="cardFicha">
  <div class="div-box-shadow">
    <div class="block">
      <!-- Cabecera gris con info del ejemplar -->
      <div class="grid divEstatus">
        <div class="col-1"># 1</div>     <!-- Número de resultado -->
        <div class="col-11">
          <div class="grid">
            <div class="col-12 md:col-6 lg:col-5">
              <strong>Ejemplar:</strong> <span>Noviembre de 2025</span>
            </div>
            <div class="col-12 md:col-6 lg:col-5">
              <strong>Gaceta:</strong> <span>Conservación de los Derechos</span>
            </div>
            <div class="col-12 md:col-6 lg:col-5">
              <strong>Sección:</strong> <span>Marcas Renovadas en el Mes</span>
            </div>
            <div class="col-12 md:col-6 lg:col-5">
              <strong>Fecha Puesta Circulación:</strong> <span>10/12/2025</span>
            </div>
          </div>
        </div>
      </div>
      <!-- Datos de la ficha -->
      <div class="col-12 md:col-6 lg:col-11">
        <div>
          <strong>Resolución:</strong> <span>891873/2025</span>
        </div>
        <div>
          <strong>Registro de Marca:</strong> <span>913909</span>
        </div>
        <div>
          <strong>Clase:</strong> <span>32</span>
        </div>
        <div>
          <strong>Denominación:</strong> <span>COCA-COLA ZERO</span>
        </div>
      </div>
    </div>
  </div>
  <!-- Checkbox para seleccionar/exportar -->
  <mat-checkbox></mat-checkbox>
</div>
```

### Paginador
```html
<mat-paginator>
  <!-- Texto: "Elementos por página 10 | 1 – 10 of 3920" -->
  <!-- Opciones de página: configurable -->
</mat-paginator>
```

---

## 5. Almacenamiento Local (localStorage)

La app almacena estado de búsqueda en localStorage:

| Key | Ejemplo | Descripción |
|-----|---------|-------------|
| `keyBusqueda` | "coca cola" | Término de búsqueda actual |
| `keyIdArea` | "2" | ID del área seleccionada |
| `keyIdAreaEs` | "" | ID del área (búsqueda especializada) |
| `keyIdGaceta` | "" | ID de gaceta seleccionada |
| `keyIdGacetaEs` | "" | ID de gaceta (especializada) |
| `keyIdSeccionEs` | "" | ID de sección (especializada) |
| `keyFechaDesde` | "" | Fecha desde |
| `keyFechaHasta` | "" | Fecha hasta |
| `keyIsSearch` | "true" | Si hay búsqueda activa |
| `pageSize` | "10" | Elementos por página |
| `pagination` | "0" | Página actual (base 0) |
| `indexTab` | "0" | Tab activo |

---

## 6. Paginación

La paginación en el frontend la maneja `mat-paginator`. La API devuelve **todos los resultados de golpe** (3920 items en el array `data`), y la paginación se hace del lado del cliente.

**Nota importante:** Esto significa que para búsquedas con muchos resultados, la respuesta puede ser muy pesada. La duración observada del request fue de ~4-15 segundos.

---

## 7. Flujo de Integración Recomendado

1. **Obtener XSRF token:** Hacer un GET a `https://siga.impi.gob.mx/` y leer la cookie `XSRF-TOKEN`
2. **Obtener reCAPTCHA token:** Ejecutar `grecaptcha.execute()` con el site key (requiere el script de Google reCAPTCHA cargado en el navegador)
3. **Hacer la búsqueda:** POST a `/api/BusquedaFicha/GetFichas` con el payload, CSRF header y credentials
4. **Procesar resultados:** Iterar `data[]`, y para cada item acceder a `datos[]` para los campos específicos
5. **Detalle de ficha:** POST a `/api/BusquedaFicha/GetFichaInfo` con `{id: fichaId, reCaptchaToken: token}`
6. **Descargar PDF:** POST a `/api/BusquedaFicha/FichasGacetaPDF` con `{id: fichaId}`

### Limitación Principal
El uso de **reCAPTCHA v3** dificulta la automatización directa desde un servidor backend. Opciones:
- Usar un navegador headless (Puppeteer/Playwright) para obtener tokens
- Explorar si el API acepta llamadas sin reCAPTCHA desde ciertos contextos
- Solicitar acceso API directo a IMPI
