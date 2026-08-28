# CASCADE API (EC2)

This folder is the whole backend: Express, SQL schema, and systemd unit.

## On your PC

```powershell
cd backend
# edit .env from .env.example — never commit .env
```

## Copy to EC2 (first time)

Do **not** copy `node_modules` from Windows. Install on Amazon Linux instead.

```powershell
# from the cascade project root
tar --exclude=node_modules --exclude=.env -czf backend.tgz backend
scp -i "$HOME\Downloads\your-key.pem" backend.tgz ec2-user@YOUR_EC2_PUBLIC_IP:~/
```

On the instance:

```bash
tar -xzf backend.tgz
# results in ~/backend
```

```bash
git clone YOUR_REPO_URL
mv cascade/backend ~/backend
# or clone and: cd cascade && git pull
```

## On EC2

```bash
cd ~/backend
cp .env.example .env
nano .env
npm install --omit=dev
npm run db:init
sudo cp deploy/cascade-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cascade-api
sudo systemctl status cascade-api
curl -s http://127.0.0.1:4000/api/health
```

## Pull updates later

From your PC (if you scp). Recreate the tarball without `node_modules`, then:

```powershell
scp -i "$HOME\Downloads\your-key.pem" backend.tgz ec2-user@YOUR_EC2_PUBLIC_IP:~/
```

```bash
cd ~
tar -xzf backend.tgz
cd ~/backend
npm install --omit=dev
sudo systemctl restart cascade-api
```

If the instance clones this repo:

```bash
cd ~/cascade
git pull
cd backend
npm install --omit=dev
sudo systemctl restart cascade-api
```

If systemd still points at the old `server` path, copy the unit again:

```bash
sudo cp ~/backend/deploy/cascade-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart cascade-api
```
