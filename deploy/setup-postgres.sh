#!/usr/bin/env bash
# Install Postgres on THIS EC2 (no RDS). Run as ubuntu, not root:
#   chmod +x deploy/setup-postgres.sh
#   ./deploy/setup-postgres.sh
set -euo pipefail

DB_NAME="cascade"
DB_USER="cascade"
DB_PASS="${POSTGRES_APP_PASSWORD:-$(openssl rand -hex 16)}"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as ubuntu, not root."
  exit 1
fi

sudo apt-get update -y
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi

sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
GRANT ALL ON SCHEMA public TO ${DB_USER};
ALTER SCHEMA public OWNER TO ${DB_USER};
SQL

echo
echo "Postgres is local only (127.0.0.1). Do not open port 5432 in the EC2 security group."
echo
echo "Put these lines in ~/backend/.env :"
echo "DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"
echo "DATABASE_SSL=false"
echo
echo "Then:"
echo "  cd ~/backend && npm run db:init"
echo "  bash deploy/install-service.sh"
