#!/usr/bin/env bash
# Muestra la ESTRUCTURA de una página de estrados del TSJ para ajustar el
# lector de acuerdos: etiquetas, encabezados y cuántas celdas tiene cada fila.
# El contenido de cada celda se recorta a sus 3 primeras letras + su largo,
# así que no se ven los nombres de las partes.
# Uso (Oracle Cloud Shell):
#   curl -s <url-de-este-archivo> | bash -s -- "<url de estrados>"
URL="${1:-https://www.tsjqroo.gob.mx/estrados/buscador_primera.php?int=182&metodo=1&findexp=174%2F2026}"
CAS=/tmp/tsj-cadena.pem
if [ ! -s "$CAS" ]; then
  cat /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt 2>/dev/null > "$CAS"
  curl -s --max-time 15 http://cacerts.geotrust.com/GeoTrustTLSRSACAG1.crt | openssl x509 -inform DER 2>/dev/null >> "$CAS"
fi
curl -s --max-time 30 --cacert "$CAS" -A "Mozilla/5.0 (compatible; TSJFilingOnline/1.0; +https://tsjia.empirica.mx/)" \
  -D /tmp/tsj.headers -o /tmp/tsj.html "$URL"
echo "════ Cabeceras de respuesta"
grep -iE '^(HTTP|content-type|content-length|set-cookie|location)' /tmp/tsj.headers | sed 's/\(set-cookie: [^=]*\)=.*/\1=…/I'
echo
echo "════ Estructura (contenido de celdas recortado)"
python3 - "$URL" <<'PY'
import re, sys, html
raw = open('/tmp/tsj.html', 'rb').read()
m = re.search(rb'charset=["\']?([\w-]+)', raw[:3000], re.I)
cs = (m.group(1).decode() if m else 'utf-8')
try:
    t = raw.decode(cs)
except Exception:
    t = raw.decode('latin-1')
print(f"bytes={len(raw)} charset_declarado={m.group(1).decode() if m else '(ninguno)'} "
      f"tr={len(re.findall(r'<tr', t, re.I))} td={len(re.findall(r'<td', t, re.I))} th={len(re.findall(r'<th', t, re.I))}")
def recorta(s):
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s))
    s = re.sub(r'\s+', ' ', s).strip()
    if not s: return '∅'
    # Fechas y números se dejan ver: son los que importan para detectar novedades.
    if re.fullmatch(r'[\d/\-:. ]{1,20}', s): return s
    return f"{s[:3]}…({len(s)})"
# Encabezados completos
for th in re.findall(r'<th\b[^>]*>(.*?)</th>', t, re.I | re.S):
    print('  encabezado:', re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', th))).strip())
# Filas
for i, (attrs, cuerpo) in enumerate(re.findall(r'<tr\b([^>]*)>(.*?)</tr>', t, re.I | re.S)):
    celdas = re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', cuerpo, re.I | re.S)
    print(f"  fila {i}: attrs='{attrs.strip()[:60]}' celdas={len(celdas)} → " + ' | '.join(recorta(c) for c in celdas))
# Esqueleto de etiquetas (sin texto), para ver cómo se arma la página
esqueleto = re.sub(r'>[^<]+<', '><', t)
esqueleto = re.sub(r'\s+', ' ', esqueleto)
print()
print('════ Esqueleto de etiquetas (primeros 2500 caracteres)')
print(esqueleto[:2500])
PY
