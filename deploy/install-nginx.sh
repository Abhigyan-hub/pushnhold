#!/usr/bin/env bash
# Install Nginx site for api.cascade.mozartdev.in
# Run from the app folder (e.g. ~/pushnhold):  bash deploy/install-nginx.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${APP_DIR}/deploy/nginx-cascade.conf"
AVAILABLE="/etc/nginx/sites-available/cascade-api"
ENABLED="/etc/nginx/sites-enabled/cascade-api"

if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC"
  exit 1
fi

sudo apt-get update -y
sudo apt-get install -y nginx

sudo rm -f "$ENABLED"
sudo cp "$SRC" "$AVAILABLE"
sudo ln -sf "$AVAILABLE" "$ENABLED"
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo
echo "Nginx is serving HTTP for api.cascade.mozartdev.in -> 127.0.0.1:4000"
echo "When DNS points here, run:"
echo "  sudo apt-get install -y certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d api.cascade.mozartdev.in"
