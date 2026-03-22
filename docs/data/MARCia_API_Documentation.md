# MARCia - Documentación de API e Integración

**Sitio:** https://marcia.impi.gob.mx/marcas/search/quick
**Framework Frontend:** Vue.js 2 + Vuex + vue-multiselect
**Backend:** Java (Spring Framework - inferido de CSRF pattern y estructura de endpoints)
**Powered by:** TrademarkVision (TMV) / TrademarkNow (imágenes servidas desde `prod.impi.static.tmv.io`)

---

## 1. Autenticación y Seguridad

### CSRF Token
- **Origen:** Meta tags en el HTML
  ```html
  <meta name="_csrf_parameter" content="_csrf">
  <meta name="_csrf_header" content="X-XSRF-TOKEN">
  <meta name="_csrf" content="66932450-5ba4-4bea-b563-76534b641d33">
  ```
- **Header requerido:** `X-XSRF-TOKEN: <valor_del_meta_tag>`
- Se genera nuevo token en cada carga de página

### reCAPTCHA
- **No usa reCAPTCHA.** No hay scripts de Google reCAPTCHA cargados.

### Cuenta PASE
- **No es obligatoria** para búsquedas. El menú "Tu cuenta PASE" existe pero las búsquedas funcionan sin autenticación.
- La cuenta PASE podría ser necesaria para funciones de "Tus favoritos" o "Historial de Búsqueda".

### Headers requeridos
```
Content-Type: application/json
Accept: application/json
X-XSRF-TOKEN: <token_del_meta_tag>
credentials: include (para enviar cookies de sesión)
```

---

## 2. Flujo de Búsqueda (3 pasos)

### Paso 1: Crear registro de búsqueda
**`POST /marcas/search/internal/record`**

Crea una sesión de búsqueda y devuelve un `searchId` (UUID).

**Request Body (Búsqueda Rápida):**
```json
{
  "_type": "Search$Quick",
  "query": "coca cola",
  "images": []
}
```

**Response (200):**
```json
{
  "id": "8725b9f2-fd47-4a32-b257-1ef2bc4015be",
  "contextId": "...",
  "count": 287,
  "source": "...",
  "query": "...",
  "position": 0
}
```

### Paso 2: Obtener conteos
**`GET /marcas/search/internal/counts`**

Devuelve el número de registros guardados y extracts.

**Response:**
```json
{
  "records": 2,
  "extracts": 0
}
```

### Paso 3: Obtener resultados paginados
**`POST /marcas/search/internal/result`**

**Request Body:**
```json
{
  "searchId": "8725b9f2-fd47-4a32-b257-1ef2bc4015be",
  "pageSize": 100,
  "pageNumber": 0,
  "statusFilter": [],
  "viennaCodeFilter": [],
  "niceClassFilter": []
}
```

**Response:**
```json
{
  "request": { ... },
  "resultPage": [ ... ],
  "pageSize": 100,
  "pageNumber": 0,
  "totalResults": 287,
  "record": null,
  "aggregates": {
    "STATUS": [
      { "key": "REGISTRADO", "docCount": 284, "selected": false },
      { "key": "EN TRÁMITE", "docCount": 3, "selected": false }
    ],
    "VIENNA_CODES": [
      { "key": "27.05.13", "docCount": 168, "selected": false },
      { "key": "27.05.05", "docCount": 115, "selected": false }
    ],
    "NICE_CLASSES": [
      { "key": "1", "docCount": 3, "selected": false },
      { "key": "32", "docCount": 50, "selected": false }
    ]
  }
}
```

---

## 3. Estructura de un Resultado Individual

Cada item en `resultPage` tiene esta estructura:

```json
{
  "id": "RM196800024621",
  "applicationNumber": "24621",
  "registrationNumber": "147263",
  "title": "COCA-COLA",
  "status": "REGISTRADO",
  "appType": "REGISTRO DE MARCA",
  "owners": ["THE COCA-COLA COMPANY"],
  "dates": {
    "application": "25/10/1968",
    "cancellation": "25/10/2013",
    "expiry": "25/10/2013"
  },
  "goodsAndServices": "",
  "classes": [],
  "images": "https://prod.impi.static.tmv.io/lm/tmimage_trim96/MX/RM196800024621?fallback=COCA-COLA"
}
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | ID único (formato: RM + año + número) |
| `applicationNumber` | string | Número de expediente |
| `registrationNumber` | string | Número de registro |
| `title` | string | Nombre/denominación de la marca |
| `status` | string | "REGISTRADO" o "EN TRÁMITE" |
| `appType` | string | Tipo de solicitud |
| `owners` | string[] | Lista de titulares |
| `dates` | object | Fechas relevantes |
| `goodsAndServices` | string | Descripción de productos/servicios |
| `classes` | int[] | Clases de Niza |
| `images` | string | URL de la imagen de la marca (hosted en TMV) |

### URL de Imágenes
Las imágenes se sirven desde TrademarkVision:
```
https://prod.impi.static.tmv.io/lm/tmimage_trim96/MX/{markId}?fallback={markTitle}
```

---

## 4. Detalle de Marca Individual

### `GET /marcas/search/internal/view/{markId}`

**Response:**
```json
{
  "details": {
    "generalInformation": {
      "title": "COCA-COLA",
      "applicationNumber": "25111",
      "registrationNumber": "518568",
      "applicationDate": "15/5/1987",
      "registrationDate": "...",
      "expiryDate": "15/05/1997",
      "appType": "REGISTRO DE MARCA"
    },
    "productsAndServices": [ ... ],
    "avisos": [ ... ],
    "prioridad": [ ... ],
    "trademark": {
      "id": "RM198700025111",
      "image": "...",
      "viennaCodes": [ ... ]
    },
    "ownerInformation": {
      "owners": [ ... ]
    }
  },
  "result": { /* mismo formato que un resultado de búsqueda */ },
  "currentOrdinal": 1,
  "totalResults": 1,
  "historyData": {
    "historyRecords": [ ... ]
  }
}
```

---

## 5. Búsqueda Avanzada (Estructurada)

### `POST /marcas/search/internal/record`

**Request Body:**
```json
{
  "_type": "Search$Structured",
  "images": [],
  "query": {
    "title": "coca cola",
    "titleOption": "similar",
    "name": {
      "name": "THE COCA-COLA COMPANY",
      "types": ["OWNER"]
    },
    "number": {
      "name": "24621",
      "types": ["APPLICATION"]
    },
    "date": {
      "date": {
        "from": "2020-01-01",
        "to": "2025-12-31"
      },
      "types": ["APPLICATION"]
    },
    "status": ["REGISTRADO"],
    "classes": [32],
    "codes": ["27.05.13"],
    "indicators": [],
    "markType": [],
    "appType": ["MARCA"],
    "goodsAndServices": "bebidas",
    "wordSet": {
      "l": null,
      "op": "AND",
      "r": null
    }
  }
}
```

### Campos de Búsqueda Avanzada

| Campo del Formulario | Campo del API | Valores posibles |
|---------------------|---------------|------------------|
| **Nombre de marca** | `title` | Texto libre |
| **Opciones de búsqueda** | `titleOption` | `""` (idéntico), `"similar"` |
| **Clase de Niza** | `classes` | Array de enteros (1-45) |
| **Códigos de Viena** | `codes` | Array de strings ("27.05.13") |
| **Estatus** | `status` | `"En trámite"`, `"Registrado"` |
| **Fecha (tipo)** | `date.types` | `"APPLICATION"` (Presentación), `"REGISTRATION"` (Registro), publicación, terminación |
| **Fecha rango** | `date.date.from/to` | Formato fecha |
| **Titular/Apoderado** | `name.name` + `name.types` | types: `["OWNER"]` (Titular), `["AGENT"]` (Apoderado) |
| **Tipo de solicitud** | `appType` | Ver catálogo abajo |
| **Tipo de marca no trad.** | `markType` | Ver catálogo abajo |
| **Producto/Servicio** | `goodsAndServices` | Texto libre |
| **Nº expediente/registro** | `number.name` + `number.types` | types: `["APPLICATION"]`, `["REGISTRATION"]` |

### Catálogo: Tipo de Solicitud (`appType`)
- `"NOMBRE COMERCIAL"`
- `"DENOMINACIONES COMUNES INTERNACIONALES"`
- `"MARCA"`
- `"MARCAS FAMOSAS"`
- `"MARCAS NOTORIAS"`
- `"AVISO COMERCIAL"`
- `"ARTICULO 6TER (CONVENIO DE PARIS)"`

### Catálogo: Tipo de Marca No Tradicional (`markType`)
- `"IMAGEN COMERCIAL (MARCA)"`
- `"MARCA CERTIFICACION"`
- `"MARCA HOLOGRAFICA"`
- `"MARCA OLFATIVA"`
- `"MARCA OTRA"`
- `"MARCA SONORA"`

### Catálogo: Estatus (`status`)
- `"En trámite"` / `"EN TRÁMITE"`
- `"Registrado"` / `"REGISTRADO"`
- `"Cancelado"`

### Catálogo: Fecha Tipos (`date.types`)
- `"Presentación"` → `APPLICATION`
- `"Publicación"` → PUBLICATION
- `"Registro"` → `REGISTRATION`
- `"Terminación"` → EXPIRY

### Catálogo: Titular/Apoderado (`name.types`)
- `"Titular"` → `["OWNER"]`
- `"Apoderado"` → `["AGENT"]`

---

## 6. Búsqueda Figurativa (por Imagen)

### Subida de Imagen
**`POST /marcas/search/internal/image/upload/bulk`**

**Request:** `multipart/form-data`

| Campo FormData | Tipo | Descripción |
|---------------|------|-------------|
| `files` | File[] | Archivos de imagen (acepta `image/*`) |
| `crop` | object | Coordenadas de recorte |
| `segment` | object | Segmentación de imagen |
| `autoSegmentCrop` | boolean | Auto-segmentación por recorte |
| `autoSegmentLasso` | boolean | Auto-segmentación por lazo |

**Input HTML:**
```html
<input type="file" accept="image/*" multiple>
```

**Flujo de imagen:**
1. El usuario arrastra/selecciona una imagen en la zona de drop
2. Se envía a `/internal/image/upload/bulk` como FormData
3. El servidor procesa la imagen y devuelve URLs/IDs
4. Las URLs se agregan al array `images` del payload de `/record`
5. El servidor busca marcas visualmente similares usando IA (TrademarkVision)

**Nota:** La IA de MARCia usa reconocimiento visual para comparar logos/imágenes contra marcas registradas. El campo `maxImages` sugiere un límite de imágenes por búsqueda.

---

## 7. Todos los Endpoints Descubiertos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| **POST** | `/marcas/search/internal/record` | Crear búsqueda (Quick o Structured) |
| **GET** | `/marcas/search/internal/counts` | Conteo de registros/extracts |
| **POST** | `/marcas/search/internal/result` | Obtener resultados paginados con filtros |
| **POST** | `/marcas/search/internal/result/count` | Conteo de resultados |
| **GET** | `/marcas/search/internal/view/{markId}` | Detalle completo de una marca |
| **POST** | `/marcas/search/internal/image/upload/bulk` | Subir imágenes para búsqueda figurativa |
| **DELETE** | `/marcas/search/internal/image/{imageId}` | Eliminar imagen subida |
| **GET** | `/marcas/search/internal/records` | Listar búsquedas guardadas |
| **POST** | `/marcas/search/internal/record/combination` | Combinar búsquedas (left op right) |
| **DELETE** | `/marcas/search/internal/record/{id}` | Eliminar búsqueda guardada |
| **DELETE** | `/marcas/search/internal/record/all` | Eliminar todas las búsquedas |
| **POST** | `/marcas/search/internal/extract` | Crear extract |
| **POST** | `/marcas/search/internal/extract/bulk` | Crear extracts en lote |
| **DELETE** | `/marcas/search/internal/extract/{id}` | Eliminar extract |

---

## 8. Paginación y Filtrado

La paginación es **del lado del servidor** (a diferencia de SIGA que devuelve todo):

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `pageSize` | int | Resultados por página (default: 100) |
| `pageNumber` | int | Página actual (base 0) |
| `statusFilter` | string[] | Filtrar por estatus |
| `viennaCodeFilter` | string[] | Filtrar por códigos de Viena |
| `niceClassFilter` | string[] | Filtrar por clases de Niza |

Los **aggregates** en la respuesta proporcionan los conteos para cada valor de filtro (faceted search).

---

## 9. URL de Resultados

La URL de la página de resultados sigue este formato:
```
https://marcia.impi.gob.mx/marcas/search/result?s={searchId}&m=l
```
- `s` = UUID del searchId devuelto por `/record`
- `m` = modo de visualización (`l` = lista, `g` = grid)

---

## 10. Vuex Store (Estado del Frontend)

```
store.state.search
  ├── state.searching (bool)
  ├── quick
  │   └── state
  │       ├── query { query: string, images: [] }
  │       ├── count: number
  │       ├── uploadingImage: bool
  │       └── showAdvanced: bool
  └── advanced
      └── state
          ├── query { images: [], query: { ...campos... } }
          ├── count: number
          └── uploadingImage: bool

store.state.results.state
  ├── searchId: string (UUID)
  ├── totalCount: number
  ├── filteredCount: number
  ├── results: array
  ├── pageNumber: number
  ├── filter { status: [], viennaCode: [], niceClass: [] }
  └── aggregates { STATUS: [], VIENNA_CODES: [], NICE_CLASSES: [] }
```

---

## 11. Flujo de Integración Recomendado

1. **Obtener CSRF token:** GET a la página y leer `<meta name="_csrf" content="...">`
2. **Crear búsqueda:** POST a `/internal/record` con `_type: "Search$Quick"` y `query`
3. **Obtener resultados:** POST a `/internal/result` con `searchId` del paso 2
4. **Paginar:** Incrementar `pageNumber` y repetir paso 3
5. **Filtrar:** Agregar valores a `statusFilter`, `niceClassFilter`, `viennaCodeFilter`
6. **Ver detalle:** GET a `/internal/view/{markId}` con el `id` de un resultado

### Ventajas sobre SIGA
- **Sin reCAPTCHA** - mucho más fácil de automatizar
- **Paginación del lado del servidor** - mejor rendimiento
- **Filtros facetados** - búsqueda más precisa
- **Búsqueda por imagen** con IA (TrademarkVision)
- **API REST bien estructurada** con UUIDs de sesión

### Limitación
- Requiere CSRF token fresco en cada sesión (se obtiene del HTML)
- La cookie de sesión puede expirar
