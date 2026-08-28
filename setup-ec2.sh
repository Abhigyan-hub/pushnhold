#!/usr/bin/env bash
# Run on the EC2 instance as the SSH user (ubuntu or ec2-user), not as root.
#   chmod +x setup-ec2.sh
#   ./setup-ec2.sh
set -euo pipefail

HOME_DIR="${HOME}"
APP_DIR="${HOME_DIR}/backend"
USER_NAME="$(id -un)"
NODE_MAJOR="${NODE_MAJOR:-20}"

echo "User: ${USER_NAME}"
echo "Home: ${HOME_DIR}"

install_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo "Node $(node -v) / npm $(npm -v) already installed"
    return
  fi

  echo "Installing Node.js ${NODE_MAJOR}..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
    sudo apt-get update -y
    sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs
  else
    echo "Install Node ${NODE_MAJOR} manually, then re-run this script."
    exit 1
  fi
}

find_tarball() {
  local f
  for f in \
    "${PWD}/backend.tgz" \
    "${HOME_DIR}/backend.tgz" \
    /home/ubuntu/backend.tgz \
    /home/ec2-user/backend.tgz \
    "${HOME_DIR}/cascade/backend.tgz"
  do
    if [[ -f "$f" ]]; then
      echo "$f"
      return
    fi
  done
  return 1
}

extract_backend() {
  if [[ -f "${APP_DIR}/package.json" ]]; then
    echo "Found ${APP_DIR}/package.json — skipping extract"
    return
  fi

  local tarfile
  if ! tarfile="$(find_tarball)"; then
    echo "backend.tgz not found. From your PC (project root):"
    echo "  tar --exclude=node_modules --exclude=.env -czf backend.tgz backend"
    echo "  scp -i KEY.pem backend.tgz ${USER_NAME}@YOUR_EC2_IP:~/"
    echo "Then run this script from ~"
    exit 1
  fi

  echo "Extracting ${tarfile} into ${HOME_DIR}"
  tar -xzf "$tarfile" -C "${HOME_DIR}"

  if [[ ! -f "${APP_DIR}/package.json" && -f "${HOME_DIR}/package.json" ]]; then
    mkdir -p "${APP_DIR}"
    # tarball was packed from inside backend/
    mv "${HOME_DIR}/package.json" "${HOME_DIR}/package-lock.json" "${HOME_DIR}/src" "${HOME_DIR}/db" "${HOME_DIR}/deploy" "${APP_DIR}/" 2>/dev/null || true
    [[ -f "${HOME_DIR}/.env.example" ]] && mv "${HOME_DIR}/.env.example" "${APP_DIR}/"
  fi

  if [[ -f "${HOME_DIR}/backend/backend/package.json" ]]; then
    mv "${HOME_DIR}/backend/backend" "${HOME_DIR}/backend-nested"
    rm -rf "${HOME_DIR}/backend"
    mv "${HOME_DIR}/backend-nested" "${APP_DIR}"
  fi

  if [[ ! -f "${APP_DIR}/package.json" ]]; then
    echo "Extract finished but ${APP_DIR}/package.json is missing. Contents of home:"
    ls -la "${HOME_DIR}"
    exit 1
  fi
}

write_systemd_unit() {
  local node_bin
  node_bin="$(command -v node)"
  sudo tee /etc/systemd/system/cascade-api.service >/dev/null <<EOF
[Unit]
Description=CASCADE Express API
After=network.target

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${node_bin} src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
}

install_node
extract_backend
cd "${APP_DIR}"
npm install --omit=dev
write_systemd_unit

if [[ ! -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  echo
  echo "Created ${APP_DIR}/.env from the example. Edit it before starting:"
  echo "  nano ${APP_DIR}/.env"
  echo "Then:"
  echo "  cd ${APP_DIR} && npm run db:init"
  echo "  sudo systemctl enable --now cascade-api"
  echo "  curl -s http://127.0.0.1:4000/api/health"
  exit 0
fi

echo "To apply schema (first time): npm run db:init"
echo "To start API: sudo systemctl enable --now cascade-api"
echo "Health: curl -s http://127.0.0.1:4000/api/health"
