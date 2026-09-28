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
echo "════ 3. Páginas del TSJ"
for u in "https://www.tsjqroo.gob.mx/" "$ESTRADOS"; do
  echo "── $u"
  curl -sS -o /tmp/tsj.html -w "   status=%{http_code}  tiempo=%{time_total}s  bytes=%{size_download}\n" \
       --max-time 30 -A "$UA" "$u" 2>&1 | sed 's/^/   /'
done

echo
echo "════ 4. Estructura de la página de estrados"
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
if [ "$ABIERTO" = 1 ] && [ -s /tmp/tsj.html ]; then
  echo "✅ RESULTADO: el TSJ SÍ responde a esta máquina. Oracle Querétaro sirve para el aviso de acuerdos."
else
  echo "🔴 RESULTADO: el TSJ tampoco responde aquí."
fi
echo "Copia todo este texto y pégalo en el chat."
