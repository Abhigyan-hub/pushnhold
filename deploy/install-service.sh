#!/usr/bin/env bash
# Run from the folder that contains package.json (this app directory).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"
NODE_BIN="$(command -v node)"

if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "package.json not found in ${APP_DIR}"
  exit 1
fi

if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "Create ${APP_DIR}/.env before installing the service"
  exit 1
fi

# Do not use systemd EnvironmentFile: it treats # in passwords as comments
# and breaks DATABASE_URL. Node loads .env via dotenv from WorkingDirectory.
sudo tee /etc/systemd/system/cascade-api.service >/dev/null <<EOF
[Unit]
Description=CASCADE Express API
After=network.target

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl reset-failed cascade-api.service || true
sudo systemctl enable --now cascade-api
sleep 2
sudo systemctl --no-pager --full status cascade-api
echo
echo "--- recent logs ---"
journalctl -u cascade-api -n 30 --no-pager
echo
curl -sS http://127.0.0.1:4000/api/health || true
echo
