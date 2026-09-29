#!/usr/bin/env bash
# Prueba técnica del PJF: ¿el portal de consulta de expedientes (DGEJ/SISE)
# responde desde esta máquina y se puede leer sin intervención humana?
# Uso (Oracle Cloud Shell), con la URL que abre la app en "🔍 Buscar" de un
# expediente federal (cópiala de la barra de direcciones de esa ventana):
#   curl -s <url-de-este-archivo> | bash -s -- "<url de vercaptura.aspx>"
# No imprime nombres: el texto de las celdas sale recortado a 3 letras.
PEGADO="${1:-https://www.dgej.cjf.gob.mx/siseinternet/reportes/vercaptura.aspx}"
# Se toma la primera dirección del portal que aparezca en lo pegado: con o sin
# https://, entre corchetes o paréntesis (como a veces se copia de un chat).
URL=$(printf '%s' "$PEGADO" | grep -oE '(https?://)?[A-Za-z0-9.-]*cjf\.gob\.mx/[^] )"<>[:space:]]+' | head -1)
[ -z "$URL" ] && URL="$PEGADO"
case "$URL" in http://*|https://*) ;; *) URL="https://$URL" ;; esac
echo "Consulta: $URL"
HOST=$(echo "$URL" | sed -E 's#^https?://([^/]+).*#\1#')
UA="Mozilla/5.0 (compatible; TSJFilingOnline/1.0; +https://tsjia.empirica.mx/)"

echo "════ 1. Desde dónde se conecta esta máquina"
curl -s --max-time 10 https://ipinfo.io/json | grep -E '"(city|country|org)"' || true

echo
echo "════ 2. Conexión con $HOST"
IP=$(getent hosts "$HOST" | awk '{print $1; exit}')
echo "   IP: ${IP:-(no resuelve)}"
if [ -n "$IP" ] && timeout 15 bash -c "cat < /dev/null > /dev/tcp/$IP/443" 2>/dev/null; then
  echo "   ✓ puerto 443 responde"
else
  echo "   ✗ puerto 443 sin respuesta"
fi

echo
echo "════ 3. Certificado"
CAS=/tmp/pjf-cadena.pem
cat /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt 2>/dev/null > "$CAS"
CERT=$(echo | timeout 15 openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 2>/dev/null)
if [ -n "$CERT" ]; then
  echo "$CERT" | openssl x509 -noout -subject -issuer -enddate 2>/dev/null | sed 's/^/   /'
  AIA=$(echo "$CERT" | openssl x509 -noout -text 2>/dev/null | grep -oE 'CA Issuers - URI:[^ ]+' | head -1 | sed 's/CA Issuers - URI://')
  if [ -n "$AIA" ] && curl -s --max-time 15 -o /tmp/pjf-inter "$AIA"; then
    (openssl x509 -inform DER -in /tmp/pjf-inter 2>/dev/null || openssl x509 -in /tmp/pjf-inter 2>/dev/null) >> "$CAS"
    echo "   (intermedio agregado por si el servidor no lo envía: $AIA)"
  fi
fi

echo
echo "════ 4. La página de consulta"
rm -f /tmp/pjf.html /tmp/pjf.cookies
R=$(curl -sS -L --max-time 40 --cacert "$CAS" -A "$UA" -c /tmp/pjf.cookies -D /tmp/pjf.headers \
     -o /tmp/pjf.html -w "%{http_code} %{time_total} %{size_download} %{url_effective}" "$URL" 2>/tmp/pjf.err) || true
set -- $R
echo "   status=${1:-000} tiempo=${2:-?}s bytes=${3:-0}"
echo "   url final: ${4:-?}"
[ -s /tmp/pjf.err ] && sed 's/^/   /' /tmp/pjf.err | head -3
grep -iE '^(content-type|set-cookie|location|x-powered-by|server)' /tmp/pjf.headers 2>/dev/null \
  | sed -E 's/(set-cookie: [^=]+)=[^;]*/\1=…/I; s/^/   /'

echo
echo "════ 5. ¿Qué hay en la página?"
if [ -s /tmp/pjf.html ]; then
python3 - <<'PY'
import re, html
raw = open('/tmp/pjf.html', 'rb').read()
m = re.search(rb'charset=["\']?([\w-]+)', raw[:4000], re.I)
try: t = raw.decode(m.group(1).decode() if m else 'utf-8')
except Exception: t = raw.decode('latin-1')
low = t.lower()
def hay(*p): return any(x in low for x in p)
print('   captcha:', 'SÍ ⚠️' if hay('captcha', 'recaptcha', 'g-recaptcha', 'hcaptcha', 'turnstile') else 'no')
print('   formulario ASP.NET (__VIEWSTATE):', 'sí' if '__viewstate' in low else 'no')
print('   visor de reportes (ReportViewer/.axd):', 'sí' if hay('reportviewer', 'microsoft.reporting', '.axd') else 'no')
print('   iframes:', len(re.findall(r'<iframe', t, re.I)), [s for s in re.findall(r'<iframe[^>]+src=["\']([^"\']+)', t, re.I)][:3])
print('   tablas:', len(re.findall(r'<table', t, re.I)), ' filas:', len(re.findall(r'<tr', t, re.I)), ' celdas:', len(re.findall(r'<td', t, re.I)))
print('   título:', re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', (re.search(r'<title[^>]*>(.*?)</title>', t, re.I | re.S) or [None, ''])[1]))).strip()[:80])
def recorta(s):
    s = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()
    if not s: return '∅'
    if re.fullmatch(r'[\d/\-:. ]{1,24}', s): return s
    return f"{s[:3]}…({len(s)})"
# Etiquetas de campos (suelen ser cortas y no son datos personales)
etiquetas = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', x))).strip()
             for x in re.findall(r'<(?:th|label|span|b|strong)\b[^>]*>(.*?)</(?:th|label|span|b|strong)>', t, re.I | re.S)]
etiquetas = [e for e in etiquetas if 2 < len(e) <= 40 and not re.search(r'\d{3,}', e)]
print('   etiquetas/encabezados:', ' | '.join(dict.fromkeys(etiquetas))[:700])
for i, (attrs, cuerpo) in enumerate(re.findall(r'<tr\b([^>]*)>(.*?)</tr>', t, re.I | re.S)[:25]):
    celdas = re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', cuerpo, re.I | re.S)
    if celdas: print(f"   fila {i}: celdas={len(celdas)} → " + ' | '.join(recorta(c) for c in celdas[:10]))
print()
print('════ Esqueleto (primeros 2500 caracteres, sin textos)')
e = re.sub(r'\s+', ' ', re.sub(r'>[^<]+<', '><', re.sub(r'<script\b.*?</script>', '<script/>', t, flags=re.I | re.S)))
e = re.sub(r'(value=")[^"]{20,}(")', r'\1…\2', e)
print(e[:2500])
PY
else
  echo "   (no hubo página)"
fi
