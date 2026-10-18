#!/usr/bin/env bash
# One-time preparation of a fresh server for SwarmAI (Oracle Cloud Always Free Ampere A1, or any VPS) — Ubuntu/Debian
# or Oracle Linux/RHEL 9. Run as the normal login user (ubuntu or opc), from the repo folder:
#
#   bash infra/server-bootstrap.sh <duckdns-subdomain>     e.g.  bash infra/server-bootstrap.sh swarm-ai
#
# Installs Docker + Node.js 22, adds 4 GB swap, opens ports 80/443, enables automatic security updates, keeps the
# DuckDNS name pointed at this server, and schedules the nightly database backup. Safe to re-run.
set -euo pipefail
[ "$(id -u)" -eq 0 ] && { echo "Run as the normal user (ubuntu / opc); the script uses sudo where needed."; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SUB="${1:-}"
export DEBIAN_FRONTEND=noninteractive

. /etc/os-release
case "$ID" in
  ubuntu|debian) FAMILY=deb ;;
  ol|rhel|centos|rocky|almalinux|fedora) FAMILY=rpm ;;
  *) echo "Unsupported OS: $ID (Ubuntu/Debian or Oracle Linux/RHEL family)"; exit 1 ;;
esac
echo "== $PRETTY_NAME ($FAMILY)"

echo "== packages"
if [ "$FAMILY" = deb ]; then
  echo 'iptables-persistent iptables-persistent/autosave_v4 boolean true' | sudo debconf-set-selections
  echo 'iptables-persistent iptables-persistent/autosave_v6 boolean true' | sudo debconf-set-selections
  sudo apt-get update -y
  sudo apt-get upgrade -y
  sudo apt-get install -y ca-certificates curl git unattended-upgrades iptables-persistent cron
else
  sudo dnf -y install git curl cronie dnf-automatic dnf-plugins-core
  sudo systemctl enable --now crond
fi

echo "== swap (4 GB)"
if [ -z "$(swapon --show --noheadings)" ]; then   # some images (Oracle Linux) already ship a swap file
  # dd instead of fallocate: works on every filesystem (XFS on Oracle Linux)
  sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== Docker"
if ! command -v docker >/dev/null; then
  if [ "$FAMILY" = deb ]; then
    curl -fsSL https://get.docker.com | sudo sh
  else
    sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo dnf -y install --allowerasing docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker

echo "== Node.js 22 (runs scripts/swarm.mjs: deploy, n8n import)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  if [ "$FAMILY" = deb ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo dnf -y install nodejs
  fi
fi

echo "== firewall: allow HTTP/HTTPS (Oracle images block everything except SSH)"
if [ "$FAMILY" = deb ]; then
  for p in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null \
      || sudo iptables -I INPUT 1 -p tcp --dport "$p" -m state --state NEW -j ACCEPT
  done
  sudo netfilter-persistent save
elif systemctl is-active --quiet firewalld; then
  sudo firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
  sudo firewall-cmd --reload >/dev/null
fi

echo "== automatic security updates"
if [ "$FAMILY" = deb ]; then
  sudo dpkg-reconfigure -f noninteractive unattended-upgrades
else
  sudo sed -i 's/^upgrade_type.*/upgrade_type = security/; s/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf
  sudo systemctl enable --now dnf-automatic.timer
fi

echo "== SSH: keys only"
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload ssh 2>/dev/null || sudo systemctl reload sshd 2>/dev/null || true

if [ -n "$SUB" ]; then
  echo "== DuckDNS: keep ${SUB}.duckdns.org pointed at this server"
  read -rsp "DuckDNS token (input hidden): " TOKEN; echo
  sudo tee /usr/local/bin/duckdns-update >/dev/null <<EOS
#!/bin/sh
curl -fsS "https://www.duckdns.org/update?domains=${SUB}&token=${TOKEN}&ip=" -o /var/log/duckdns.last
EOS
  sudo chmod 700 /usr/local/bin/duckdns-update
  sudo /usr/local/bin/duckdns-update && echo "DuckDNS update: $(sudo cat /var/log/duckdns.last)"
  echo "*/5 * * * * root /usr/local/bin/duckdns-update" | sudo tee /etc/cron.d/duckdns >/dev/null
fi

echo "== nightly backup (02:30)"
chmod +x "$REPO/infra/backup.sh"
mkdir -p "$HOME/swarm-backups"
{ crontab -l 2>/dev/null | grep -v 'infra/backup.sh' || true; echo "30 2 * * * $REPO/infra/backup.sh >> $HOME/swarm-backups/backup.log 2>&1"; } | crontab -

echo
echo "Done. Log out and back in (so Docker works without sudo), copy the env files, then:  cd $REPO && ./setup.sh deploy"
