#!/usr/bin/env bash
# Instala el revisor de acuerdos en una máquina Always Free de Oracle Cloud
# (Ubuntu 22.04/24.04, región Querétaro). Se corre UNA vez, como root:
#
#   curl -fsSL https://raw.githubusercontent.com/Jorch01/TSJ_Filing_online/<rama>/servidor/instalar.sh | sudo bash
#
# Deja: Node 22, el servicio "revisor" (arranca solo), Caddy con certificado
# HTTPS gratuito (Let's Encrypt) en <ip-con-guiones>.sslip.io, los puertos 80
# y 443 abiertos en el firewall de la máquina, los certificados intermedios
# que el TSJ y el PJF no envían, y una actualización diaria desde GitHub.
# Volver a correrlo es seguro: reinstala sin perder nada.
set -euo pipefail

RAMA="${RAMA:-claude/happy-gauss-z2b9i3}"
REPO="https://github.com/Jorch01/TSJ_Filing_online.git"
DIR=/opt/revisor
paso() { echo; echo "════ $*"; }

[ "$(id -u)" = 0 ] || { echo "Córrelo con sudo."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

paso "1/7 Paquetes del sistema"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates gnupg openssl iptables-persistent debian-keyring debian-archive-keyring apt-transport-https >/dev/null

paso "2/7 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node --version

paso "3/7 Caddy (HTTPS gratuito)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
caddy version

paso "4/7 Código del revisor (rama $RAMA)"
id revisor >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin revisor
mkdir -p "$DIR/intermedios"
if [ -d "$DIR/repo/.git" ]; then
  git -C "$DIR/repo" fetch -q --depth 1 origin "$RAMA" && git -C "$DIR/repo" checkout -q -B "$RAMA" FETCH_HEAD
else
  git clone -q --depth 1 -b "$RAMA" "$REPO" "$DIR/repo"
fi
git -C "$DIR/repo" log -1 --format='   versión %h del %ci'

paso "5/7 Certificados intermedios del TSJ y del PJF"
for host in www.tsjqroo.gob.mx www.dgej.cjf.gob.mx; do
  aia=$(echo | timeout 20 openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null \
        | openssl x509 -noout -text 2>/dev/null | grep -oE 'CA Issuers - URI:[^ ]+' | head -1 | sed 's/CA Issuers - URI://')
  if [ -n "$aia" ] && curl -fsS --max-time 20 -o /tmp/inter "$aia"; then
    (openssl x509 -inform DER -in /tmp/inter 2>/dev/null || openssl x509 -in /tmp/inter) > "$DIR/intermedios/$host.pem"
    echo "   ✓ $host: $(openssl x509 -in "$DIR/intermedios/$host.pem" -noout -subject | sed 's/.*CN *= *//')"
  else
    echo "   ⚠️ $host: no se pudo obtener su intermedio (se reintenta en la actualización diaria)"
  fi
done
chown -R revisor:revisor "$DIR"

paso "6/7 Servicio, HTTPS y firewall"
cat > /etc/systemd/system/revisor.service <<UNIT
[Unit]
Description=Revisor de acuerdos TSJ/PJF (TSJ Filing Online)
After=network-online.target
Wants=network-online.target

[Service]
User=revisor
Environment=PORT=8080
Environment=DIR_INTERMEDIOS=$DIR/intermedios
ExecStart=/usr/bin/node $DIR/repo/servidor/revisor.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q --now revisor
systemctl restart revisor

IP=$(curl -fsS --max-time 10 https://ifconfig.me || curl -fsS --max-time 10 https://api.ipify.org)
DOMINIO="${DOMINIO:-${IP//./-}.sslip.io}"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMINIO {
    encode gzip
    header -Server
    reverse_proxy 127.0.0.1:8080
}
CADDY
# Las imágenes de Ubuntu de Oracle traen el firewall cerrado salvo SSH.
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport $p -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true
systemctl enable -q caddy && systemctl restart caddy

paso "7/7 Actualización diaria (4:15 a. m.)"
cat > /etc/cron.d/revisor <<CRON
15 4 * * * root RAMA=$RAMA DOMINIO=$DOMINIO bash -c 'cd $DIR/repo && antes=\$(git rev-parse HEAD) && git fetch -q --depth 1 origin $RAMA && git checkout -q -B $RAMA FETCH_HEAD && [ "\$antes" != "\$(git rev-parse HEAD)" ] && systemctl restart revisor' >/dev/null 2>&1
CRON

echo
echo "Esperando el certificado HTTPS (hasta 60 s)…"
for i in $(seq 1 12); do
  if curl -fsS --max-time 5 "https://$DOMINIO/salud" >/tmp/salud 2>/dev/null; then break; fi
  sleep 5
done
if [ -s /tmp/salud ]; then
  echo "✅ LISTO. El revisor responde en: https://$DOMINIO"
  cat /tmp/salud; echo
else
  echo "🟡 El servicio corre, pero HTTPS aún no responde en https://$DOMINIO"
  echo "   Revisa que en Oracle estén abiertos los puertos 80 y 443 (Security List) y vuelve a correr este comando."
  curl -s http://127.0.0.1:8080/salud; echo
fi
