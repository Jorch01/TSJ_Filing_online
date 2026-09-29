#!/usr/bin/env bash
# Estructura de la LISTA DE AUTOS del portal del PJF (vercaptura.aspx), para
# ajustar el lector: qué tabla la contiene, sus columnas, cuántos autos trae
# y si viene paginada. El texto de las celdas sale recortado a 3 letras;
# números y fechas completos.
# Uso: curl -s <url-de-este-archivo> | bash -s -- "<url de vercaptura.aspx>"
PEGADO="${1:?Falta la URL de vercaptura.aspx}"
URL=$(printf '%s' "$PEGADO" | grep -oE '(https?://)?[A-Za-z0-9.-]*cjf\.gob\.mx/[^] )"<>[:space:]]+' | head -1)
case "$URL" in http://*|https://*) ;; *) URL="https://$URL" ;; esac
curl -s -L --max-time 40 -A "Mozilla/5.0 (compatible; TSJFilingOnline/1.0; +https://tsjia.empirica.mx/)" \
     -o /tmp/pjf.html "$URL" || { echo "✗ no se pudo descargar"; exit 1; }
python3 - <<'PY'
import re, html
raw = open('/tmp/pjf.html', 'rb').read()
t = raw.decode('utf-8', 'replace')
def limpio(s): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()
def recorta(s):
    s = limpio(s)
    if not s: return '∅'
    if re.fullmatch(r'[\d/\-:. ]{1,24}', s): return s
    return f"{s[:3]}…({len(s)})"
print(f"bytes={len(raw)}")
print("paginación (Page$ / __doPostBack con página):",
      'SÍ ⚠️' if re.search(r"Page\$|Page\\\$|'Page'|pager", t, re.I) else 'no aparece')
print("postbacks en la página:", sorted(set(re.findall(r"__doPostBack\(&#39;([^&]+)&#39;|__doPostBack\('([^']+)'", t)))[:8])
print("'Listado de Resoluciones':", re.findall(r'Listado de Resoluciones\s*\(\d+\)', t))
print("'Ver síntesis completa' (cuántas):", len(re.findall(r'síntesis completa', t, re.I)))
print("enlaces 'síntesis' ejemplo:", [re.sub(r'(expediente|neun)=[^&"\']+', r'\1=…', h) for h in re.findall(r'href="([^"]*(?:intesis|Sintesis)[^"]*)"', t, re.I)][:2])
print()
# Tablas cuyo encabezado menciona "Fecha del Auto"
tablas = [m for m in re.finditer(r'<table\b([^>]*)>', t, re.I)]
vistos = 0
for m in tablas:
    inicio = m.start()
    # la tabla termina en su </table> correspondiente (conteo simple de anidamiento)
    prof, i = 0, inicio
    for tag in re.finditer(r'<(/?)table\b', t[inicio:], re.I):
        prof += -1 if tag.group(1) else 1
        if prof == 0:
            fin = inicio + tag.end(); break
    else:
        continue
    bloque = t[inicio:fin]
    if 'fecha del auto' not in bloque.lower(): continue
    # Solo la tabla más interna que contiene el encabezado
    internas = [x for x in re.finditer(r'<table\b', bloque[1:], re.I)]
    if any('fecha del auto' in bloque[1+x.start():].lower()[:bloque[1+x.start():].lower().find('</table>')] for x in internas):
        continue
    vistos += 1
    print(f"════ Tabla de autos #{vistos}: attrs='{m.group(1).strip()[:120]}'")
    filas = re.findall(r'<tr\b([^>]*)>(.*?)</tr>', bloque, re.I | re.S)
    print(f"   filas={len(filas)}")
    for n, (attrs, cuerpo) in enumerate(filas[:15]):
        celdas = re.findall(r'<t[dh]\b([^>]*)>(.*?)</t[dh]>', cuerpo, re.I | re.S)
        print(f"   fila {n}: attrs='{attrs.strip()[:50]}' celdas={len(celdas)} → " + ' | '.join(recorta(c[1]) for c in celdas[:8]))
    if len(filas) > 15:
        print(f"   … y {len(filas) - 15} filas más; última:",
              ' | '.join(recorta(c) for c in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', filas[-1][1], re.I | re.S)[:8]))
    print("   esqueleto de la 2ª fila:", re.sub(r'\s+', ' ', re.sub(r'>[^<]+<', '><', ''.join(f'<tr{a}>{c}</tr>' for a, c in filas[1:2])))[:900])
    print()
if not vistos:
    print("No se encontró una tabla con 'Fecha del Auto'. Contexto alrededor del texto:")
    k = t.lower().find('fecha del auto')
    print(re.sub(r'\s+', ' ', re.sub(r'>[^<]+<', '><', t[max(0, k-1500):k+1500]))[:3000])
PY
