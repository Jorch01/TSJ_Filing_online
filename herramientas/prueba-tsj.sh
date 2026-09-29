#!/usr/bin/env bash
# Prueba técnica: ¿el servidor del TSJ de Quintana Roo acepta conexiones
# desde esta máquina? Desde Cloudflare y desde GitHub (EE. UU.) no responde.
# Pensado para correr en Oracle Cloud Shell (región Querétaro):
#   curl -s https://raw.githubusercontent.com/Jorch01/TSJ_Filing_online/claude/happy-gauss-z2b9i3/herramientas/prueba-tsj.sh | bash
# No guarda nada ni imprime nombres de las partes: solo tiempos y estructura.

UA="Mozilla/5.0 (compatible; TSJFilingOnline/1.0; +https://tsjia.empirica.mx/)"
ESTRADOS="https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=182&metodo=1&findexp=174%2F2026"

echo "════ 1. Desde dónde se conecta esta máquina"
curl -s --max-time 10 https://ipinfo.io/json | grep -E '"(ip|city|region|country|org)"' || echo "(no se pudo consultar)"

echo
echo "════ 2. Conexión básica al servidor del TSJ"
ABIERTO=0
for p in 443 80; do
  if timeout 15 bash -c "cat < /dev/null > /dev/tcp/201.116.118.19/$p" 2>/dev/null; then
    echo "✓ puerto $p: responde"; ABIERTO=1
  else
    echo "✗ puerto $p: sin respuesta"
  fi
done

echo
echo "════ 3. Certificado del TSJ"
# El servidor del TSJ no envía el certificado intermedio de su cadena. Los
# navegadores lo descargan solos (de la dirección "CA Issuers" que trae el
# propio certificado); aquí se hace lo mismo, sin desactivar la verificación.
CERT=$(echo | timeout 15 openssl s_client -connect www.tsjqroo.gob.mx:443 -servername www.tsjqroo.gob.mx 2>/dev/null | openssl x509 2>/dev/null)
if [ -n "$CERT" ]; then
  echo "$CERT" | openssl x509 -noout -subject -issuer -enddate 2>/dev/null | sed 's/^/   /'
  AIA=$(echo "$CERT" | openssl x509 -noout -text 2>/dev/null | grep -oE 'CA Issuers - URI:[^ ]+' | head -1 | sed 's/CA Issuers - URI://')
  echo "   intermedio publicado en: ${AIA:-(no indicado)}"
  CAS=/tmp/tsj-cadena.pem
  cat /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt 2>/dev/null > "$CAS"
  if [ -n "$AIA" ] && curl -s --max-time 15 -o /tmp/intermedio "$AIA"; then
    (openssl x509 -inform DER -in /tmp/intermedio 2>/dev/null || openssl x509 -in /tmp/intermedio 2>/dev/null) >> "$CAS"
    echo "   ✓ intermedio descargado y agregado a la cadena de confianza"
  fi
  CURL_CA="--cacert $CAS"
else
  echo "   (no se pudo leer el certificado)"
  CURL_CA=""
fi

echo
echo "════ 4. Páginas del TSJ (verificando el certificado completo)"
VERIFICADO=0
for u in "https://www.tsjqroo.gob.mx/" "$ESTRADOS"; do
  echo "── $u"
  codigo=$(curl -sS -o /tmp/tsj.html -w "%{http_code} %{time_total} %{size_download}" \
       --max-time 30 -A "$UA" $CURL_CA "$u" 2>/tmp/tsj.err) || true
  set -- $codigo
  echo "   status=${1:-000}  tiempo=${2:-?}s  bytes=${3:-0}"
  [ -s /tmp/tsj.err ] && sed 's/^/   /' /tmp/tsj.err | head -2
  [ "${1:-000}" = "200" ] && VERIFICADO=1
done

echo
echo "════ 5. Estructura de la página de estrados"
if [ -s /tmp/tsj.html ]; then
  echo "   filas <tr>: $(grep -oi '<tr' /tmp/tsj.html | wc -l)"
  echo "   filas odd/even: $(grep -oiE 'class="(odd|even)' /tmp/tsj.html | wc -l)"
  echo "   charset: $(grep -oiE 'charset=[a-z0-9-]+' /tmp/tsj.html | head -1)"
  echo "   carga aparte (ajax/DataTables): $(grep -oiE 'DataTable|ajax|[a-z_]+\.php' /tmp/tsj.html | sort -u | head -12 | tr '\n' ' ')"
  echo "   celdas por fila (primeras 3): $(grep -oiE '<tr[^>]*>.*' /tmp/tsj.html | head -3 | awk -F'<td' '{printf "%d ", NF-1}')"
else
  echo "   (no hubo página que revisar)"
fi

echo
if [ "$VERIFICADO" = 1 ] && [ -s /tmp/tsj.html ]; then
  echo "✅ RESULTADO: el TSJ SÍ responde a esta máquina, con conexión segura verificada. Oracle Querétaro sirve para el aviso de acuerdos."
elif [ "$ABIERTO" = 1 ]; then
  echo "🟡 RESULTADO: el TSJ acepta la conexión, pero la página no se pudo leer (ver arriba)."
else
  echo "🔴 RESULTADO: el TSJ tampoco responde aquí."
fi
echo "Copia todo este texto y pégalo en el chat."
