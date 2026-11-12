# Aviso de privacidad integral — TSJ Filing Online

> **BORRADOR PARA REVISIÓN JURÍDICA. No publicar hasta validarlo.** Versión propuesta: `2026-11-12`.
> Lo que sigue entre corchetes falta confirmarlo. Fundamento: arts. 14, 15 y 16 de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (DOF 20-03-2025, última reforma DOF 14-11-2025).

Última actualización: 12 de noviembre de 2026.

## 1. Quién es el responsable

**Empírica Legal** ("**Empírica Legal Lab**" o "**Empírica**"), con domicilio en Av. La Luna, número exterior 4, Supermanzana 44, C.P. 77506, Benito Juárez (Cancún), Quintana Roo, México, es responsable del tratamiento de los datos personales de quienes usan y contratan **TSJ Filing Online** (la "**Herramienta**"), en la app y en el sitio tsjia.empirica.mx, conforme a este aviso.

Departamento de datos personales: correo **jorge_clemente@empirica.mx**, WhatsApp 998 139 9930.

### Un aviso importante sobre los datos de tus clientes

La Herramienta te permite capturar expedientes, partes, notas, audiencias y otros datos de tus clientes y de terceros. **Respecto de esos datos, el responsable eres tú**, como abogado o despacho, porque decides para qué y cómo los usas. Esa información se guarda en tu dispositivo y Empírica no la ve.

Empírica solo la trata **por tu cuenta, como persona encargada**, en dos casos: (a) si activas la **sincronización** Premium (apartado 4.3) y (b) cuando la Herramienta consulta por ti los portales oficiales con los **números de expediente** (apartado 4.4). En esos casos Empírica la usa solo para prestarte ese servicio, la mantiene confidencial y no la usa para nada más.

Cuando conectas **tus propias cuentas** de Google Gemini, EmailJS o Google Calendar, esos datos van directamente de tu dispositivo a esos proveedores, conforme a los términos que tú aceptaste con ellos. Empírica no los recibe (apartado 5).

## 2. Datos personales que tratamos

| Categoría | Datos | Cuándo |
|---|---|---|
| Identificación y contacto | Nombre; teléfono y nombre de perfil de WhatsApp; correo electrónico | Al pedir o contratar un plan, al activarlo o transferirlo y, si lo das, en un reporte |
| **Financieros y fiscales** | Comprobante de pago (banco, importe, fecha, referencia); RFC, razón social, régimen y domicilio fiscal, uso del CFDI | Al pagar un plan o pedir factura |
| Licencia | Código de activación; plan y vigencia; estado; fechas de registro y último acceso; número de dispositivos; intentos de usar el código en otro equipo | Al activar y usar un plan |
| Del dispositivo y técnicos | Identificador de dispositivo que genera la app; tipo de equipo y descripción del sistema (tomada del navegador); **dirección IP**; **huella del equipo** en forma de resumen cifrado (pantalla, zona horaria, núcleos, idioma, plataforma, navegador, tarjeta gráfica y un dibujo de prueba); versión de la app y datos técnicos de un error | Al usar la Herramienta, sobre todo las búsquedas con límite y los reportes |
| De uso (estadísticas) | Secciones visitadas y acciones (por ejemplo, "abrió el calendario"), tipo de cálculo, plataforma, identificador de cookie de Google Analytics | Mientras tengas activadas las estadísticas |
| Contenido sincronizado (como encargada) | Copia **cifrada** de tus expedientes, notas, agenda, pendientes, carpetas, búsquedas guardadas, historial y cuentas compartidas | Solo si activas la sincronización Premium |
| Consultas a portales (como encargada) | Números de expediente, tipo de asunto, NEUN y órgano; denominaciones, registros y titulares de marcas | Al consultar sesiones de Tribunales Colegiados, el IMPI, el TSJ de Quintana Roo o el PJF |
| Comunicación | Mensajes que nos envías por WhatsApp, correo o el formulario de reportes | Cuando nos escribes |

**Datos sensibles.** Empírica **no pide** datos sensibles de los Usuarios. El contenido sincronizado puede incluirlos si tú los capturas (por ejemplo, salud o situación familiar de un cliente), pero está cifrado y Empírica no lo consulta (apartado 4.3). Te pedimos no poner datos de expedientes en los reportes.

## 3. Para qué usamos tus datos

**Finalidades necesarias** para la relación que tienes con nosotros (no requieren tu consentimiento: art. 9, fr. IV):

1. Atender tu solicitud de un plan, enviarte los datos de pago, confirmar el pago y entregarte el código de activación.
2. Facturar, cuando lo pidas.
3. Activar, verificar, transferir y vigilar tu licencia y sus dispositivos, y detectar el uso de un mismo código en más equipos de los permitidos.
4. Aplicar los límites del plan gratuito y evitar abusos de las búsquedas (huella del equipo e IP).
5. Prestar, como encargada y por tu cuenta, la sincronización y las consultas a portales oficiales.
6. Atender tus reportes, dudas, solicitudes y el ejercicio de tus derechos.
7. Proteger la seguridad de la Herramienta y cumplir obligaciones legales o requerimientos de autoridad.

**Finalidad adicional**, que puedes rechazar sin que eso afecte el servicio:

8. Generar **estadísticas de uso** para saber qué secciones se usan y mejorarlas (Google Analytics). Nunca se envían números de expediente, nombres, juzgados, notas, importes ni textos de acuerdos.

**Cómo negarte a la finalidad 8:** desactiva "Estadísticas de uso" en Configuración. Queda guardado en ese dispositivo. También puedes escribirnos al correo del apartado 1.

No usamos tus datos para publicidad ni los vendemos.

## 4. Cómo se tratan, según la función

### 4.1 En tu dispositivo
La información de la Herramienta (expedientes, notas, agenda, configuración y claves de tus servicios) se guarda en el almacenamiento de tu navegador (IndexedDB y almacenamiento local). Si borras los datos del navegador o desinstalas la app, se pierde, salvo lo que hayas sincronizado. Los contadores del plan gratuito se guardan además en una cookie y en un almacén propio que "Eliminar todos los datos" no borra, para que el límite no se reinicie.

### 4.2 Licencias
Los datos de tu licencia se guardan en una hoja de cálculo de Google de Empírica, administrada con Google Apps Script.

### 4.3 Sincronización entre dispositivos (Premium)
Si la activas, la app comprime y **cifra en tu dispositivo** (AES-256-GCM) todo tu contenido y sube el bloque cifrado a la hoja de Google de Empírica, junto con un respaldo que se guarda cuando se hace un borrado masivo, para poder devolverte lo que borraste por error.

**La clave se obtiene de tu código de activación.** Como Empírica genera y registra esos códigos, **técnicamente podría descifrar** el bloque. Nos comprometemos a no hacerlo, salvo que tú lo pidas por escrito para recuperar tu información o que lo ordene una autoridad competente. El acceso a la hoja está limitado a `[personas o cargos]`. Para descargar, reemplazar o borrar el bloque no basta el código: la petición tiene que venir de un dispositivo registrado en tu licencia. Si eso no te basta, no actives la sincronización y haz tus respaldos con la exportación de la app.

### 4.4 Consultas a portales oficiales
Para consultar las sesiones de Tribunales Colegiados (SISE del Consejo de la Judicatura Federal), el IMPI (MARCia, Marcanet, SIGA) y otros portales que no admiten consultas directas desde el navegador, la app envía los datos de la búsqueda a un servidor intermedio de Empírica en Cloudflare, que la reenvía al portal y te devuelve la respuesta. Las respuestas de las sesiones se guardan hasta 6 horas para no repetir la consulta. Los portales son fuentes de acceso público y tratan las consultas conforme a sus propios avisos.

### 4.5 Límites del plan gratuito
Para contar las búsquedas sin cuentas ni registro, el servidor intermedio guarda **resúmenes cifrados (SHA-256)** de tu IP sola, de tu IP combinada con la huella del equipo, de la huella sola y del identificador de dispositivo, junto con el número de búsquedas. No guarda la IP ni la huella en claro, pero estos resúmenes permiten reconocer el equipo, por lo que los tratamos como datos personales.

## 5. Servicios que conectas tú

Estas funciones son opcionales y usan **tus propias claves o cuentas**. Los datos van directamente de tu dispositivo al proveedor, conforme a los términos y el aviso de privacidad que aceptaste con él. Empírica no los recibe ni responde por ese tratamiento. Como responsable frente a tus clientes, te corresponde decidir si los usas y con qué información.

| Función | Proveedor | Qué se envía |
|---|---|---|
| Lectura de acuerdos con IA, asistente de voz y transcripción | Google (API de Gemini) | **El texto completo del acuerdo**, el audio de tu voz y, en el asistente, la lista de tus expedientes y tu agenda como contexto |
| Recordatorios por correo | EmailJS y tu proveedor de correo | Título, fecha, hora y descripción del evento, y el correo destino |
| Calendario | Google Calendar | Título, fecha, descripción y expediente de cada evento |

**Atención con la IA.** Según los términos de Google para la API de Gemini, en el **nivel gratuito** Google usa lo que envías para mejorar sus productos, revisores humanos pueden leerlo, y Google pide no enviar información personal, sensible o confidencial. En el **nivel de pago** no lo usa para entrenar sus modelos. Para acuerdos de tus clientes, te recomendamos usar una clave de pago o no usar la función. La Herramienta te pedirá confirmarlo antes del primer uso.

## 6. Con quién compartimos los datos

**Proveedores que tratan datos por cuenta de Empírica** (personas encargadas, art. 2, fr. XII). No requieren tu consentimiento. Los obligamos a tratarlos solo para prestarnos el servicio:

| Proveedor | Servicio | Ubicación |
|---|---|---|
| Google LLC y filiales | Hojas de cálculo, Apps Script y correo (licencias, sincronización, reportes); Google Analytics (estadísticas); fuentes tipográficas | EE. UU. y otros países |
| Cloudflare, Inc. | Servidor intermedio, límites del plan gratuito y caché de consultas | Red global |
| GitHub, Inc. | Alojamiento del sitio y de la app (registra la IP de la visita) | EE. UU. |
| jsDelivr | Distribución de bibliotecas de código (registra la IP de la descarga) | Red global |
| WhatsApp (Meta Platforms) | Canal de contratación y atención que tú inicias | EE. UU. y otros países |

**Transferencias.** Empírica **no transfiere** tus datos a terceros para fines propios de ellos. Solo podría comunicarlos sin tu consentimiento en los casos del art. 36 de la Ley, por ejemplo por requerimiento fundado de autoridad competente o para la defensa de un derecho en un proceso judicial.

## 7. Cuánto tiempo los conservamos

| Datos | Plazo |
|---|---|
| Licencia y dispositivos | Mientras esté vigente el plan y 2 años después de vencido, para aclaraciones y nuevas contrataciones; luego se bloquean y se eliminan |
| Comprobantes de pago y datos fiscales | El plazo que exigen las disposiciones fiscales (5 años, Código Fiscal de la Federación, art. 30) |
| Bloque sincronizado y su respaldo | Mientras esté vigente el plan y **30 días** después de vencido, para que puedas renovar sin perder nada; luego se eliminan. Puedes pedir que se borren antes |
| Contadores del plan gratuito | Mensuales: 40 días. Diarios: 2 días. Totales (estudios de viabilidad y consultas de sesiones): 13 meses desde el último uso |
| Caché de consultas a portales | 6 horas |
| Estadísticas de uso | 2 meses, según la configuración de Google Analytics |
| Reportes y conversaciones | 2 años desde la última comunicación |

Concluidos los plazos, los datos se bloquean el tiempo que dure la prescripción de las acciones derivadas de la relación y después se suprimen (arts. 2, fr. III; 10 y 24).

## 8. Tus derechos ARCO y cómo ejercerlos

Puedes **acceder** a tus datos, **rectificarlos**, **cancelarlos** y **oponerte** a su tratamiento (arts. 21 a 34 de la Ley).

**Cómo:** envía tu solicitud al correo **jorge_clemente@empirica.mx** o por WhatsApp al 998 139 9930, con:

1. Tu nombre y un correo o medio para responderte.
2. Copia de una identificación oficial o, si actúas por otra persona, del documento que acredite tu representación y la identificación de ambos.
3. La descripción clara de los datos y del derecho que quieres ejercer (en la rectificación, el cambio que pides y el documento que lo respalda).
4. Tu código de activación o el identificador de dispositivo, si los tienes, para localizar tus datos.

**Plazos:** te respondemos en un máximo de **20 días hábiles** desde que recibimos la solicitud, y si procede, la hacemos efectiva dentro de los **15 días hábiles** siguientes. Podemos ampliar cada plazo una sola vez por un periodo igual cuando el caso lo justifique (art. 31). Entregamos los datos en documento electrónico. El trámite es gratuito, salvo los gastos de envío o reproducción que la ley permite (art. 34).

**Datos de tus clientes.** Si un cliente tuyo o un tercero nos pide ejercer sus derechos sobre datos que tú capturaste, le diremos que el responsable eres tú y te avisaremos para que lo atiendas. Cuando nos lo pidas, cancelaremos la copia sincronizada.

Si no estás conforme con la respuesta, o no la recibes, puedes acudir a la **Secretaría Anticorrupción y Buen Gobierno** dentro de los 15 días hábiles siguientes (art. 40).

## 9. Revocar tu consentimiento y limitar el uso

Puedes revocar tu consentimiento en cualquier momento, sin efectos retroactivos, por los mismos medios del apartado 8. Si la revocación afecta una finalidad necesaria, quizá no podamos seguir prestándote el plan.

Para **limitar** el uso de tus datos: desactiva las estadísticas en Configuración; no actives la sincronización, o usa la app sin conectar servicios externos.

## 10. Cookies y tecnologías similares

La Herramienta usa almacenamiento local, IndexedDB y una cookie propia para su funcionamiento y para los límites del plan gratuito. Con las estadísticas activas, también las cookies de Google Analytics (`_ga`, `_ga_*`), sin señales publicitarias. Desactívalas en Configuración. La huella del equipo se describe en el apartado 4.5.

## 11. Seguridad

Aplicamos medidas administrativas, técnicas y físicas para proteger tus datos (art. 18), entre ellas: cifrado del contenido sincronizado en tu dispositivo; conexiones HTTPS; resúmenes cifrados en lugar de IP y huella en claro; acceso restringido a la hoja de licencias y a los servidores; y verificación en dos pasos en las cuentas administrativas `[confirmar que esté activa]`. Si ocurre una vulneración que afecte de forma significativa tus derechos, te la informaremos de inmediato para que puedas defenderte (art. 19).

## 12. Cambios a este aviso

Podemos modificar este aviso. Publicaremos siempre la versión vigente, con su fecha, en `tsjia.empirica.mx/aviso-de-privacidad/`, y la Herramienta te mostrará la nueva versión la próxima vez que la abras. Si un cambio añade una finalidad que requiere tu consentimiento, te lo pediremos antes de aplicarla (art. 11).

## 13. Aceptación

Si usas la Herramienta después de que se te haya puesto a disposición este aviso, consientes el tratamiento descrito, salvo que manifiestes lo contrario (art. 7). Para los **datos financieros y fiscales**, te pediremos tu consentimiento expreso con una casilla al contratar o activar un plan.
