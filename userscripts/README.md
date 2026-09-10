# Userscripts

## estrados-federales.user.js

Da enlace directo a la lista de acuerdos de un órgano federal en el portal del
CJF, que por sí solo no lo permite.

### Por qué hace falta

`busquedaacuerdos.aspx` es ASP.NET WebForms: un asistente de varios pasos dentro
de un único `.aspx`. El circuito y el órgano no viajan en la URL — viven en el
`__VIEWSTATE`, un blob firmado que el servidor genera por sesión y que no se
puede falsificar desde fuera. Comprobado sobre la página real: un solo
`<form method="post">` que apunta a sí mismo, y todos los enlaces son
`WebForm_DoPostBackWithOptions`. No hay querystring por ninguna parte.

El rodeo es el fragmento `#`, que el navegador nunca envía al servidor: no
interfiere con el postback, y el userscript sí puede leerlo y rellenar los
desplegables desde dentro de la página.

(Para un expediente concreto **con número**, esto no hace falta:
`vercaptura.aspx` sí acepta querystring y ya está implementado en
`docs/js/pjf-search.js`. Esto cubre el otro caso: ver la lista del día de un
órgano cuando no tienes el número.)

### Instalación

1. Violentmonkey o Tampermonkey (probado en Violentmonkey/Firefox).
2. Panel de la extensión → **+** → **Instalar desde URL**, o pegar el contenido
   de `estrados-federales.user.js` en un script nuevo y guardar.

### Uso

```
https://www.dgej.cjf.gob.mx/paginas/serviciosTramites.htm?pageName=servicios%2FlistaAcuerdos.htm#tsjfo=54/462
                                                                                                  ^^  ^^^
                                                                                     circuito ────┘   └──── órgano
```

Para obtener los dos números:

```sh
python3 userscripts/enlace_estrado_federal.py "primer tribunal colegiado del vigesimo septimo"
```

Los IDs salen de los catálogos que ya están en el repo, verificados contra los
desplegables del portal (32/32 circuitos y todos los órganos vigentes de la
muestra coinciden):

- circuito → `catalogo_circuitos.csv`, columna `id_sise`
- órgano → `docs/data/pjf_catalogos_completos.json`, campo `id`

Los únicos que no coinciden son órganos ya extintos, que el portal conserva con
su periodo de vigencia entre paréntesis y el catálogo no incluye.

### Si algo falla

El script deja rastro en la consola con la etiqueta `[estrados-federales]`.
Si no encuentra el botón de buscar, imprime los candidatos que sí halló — eso
es lo que hace falta para afinar el selector.
