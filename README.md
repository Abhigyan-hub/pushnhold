# CASCADE API (EC2)

This folder is the whole backend. Your instance is likely **Ubuntu** (`ubuntu` user, `apt`), not Amazon Linux (`ec2-user`, `dnf`). Use the SSH username that actually works.

## 1. On your Windows PC (cascade project root)

```powershell
tar --exclude=node_modules --exclude=.env -czf backend.tgz backend
scp -i "$HOME\Downloads\your-key.pem" backend.tgz ubuntu@YOUR_EC2_PUBLIC_IP:~/
scp -i "$HOME\Downloads\your-key.pem" backend/setup-ec2.sh ubuntu@YOUR_EC2_PUBLIC_IP:~/
```

If SSH is `ec2-user@...`, use that instead of `ubuntu`. The tarball must land in **that user's home** (`ls ~` should show `backend.tgz`).

## 2. On the instance (one script)

```bash
cd ~
ls -la
# you must see backend.tgz here before continuing

chmod +x setup-ec2.sh
./setup-ec2.sh
```

That installs Node 20, extracts `~/backend`, runs `npm install`, and writes the systemd unit for **your** user.

Then:

```bash
nano ~/backend/.env
cd ~/backend
npm run db:init
bash deploy/install-service.sh
curl -s http://127.0.0.1:4000/api/health
```

`db:init` creates the `cascade` database if it does not exist (on the URL in `.env`, usually local Postgres), then applies tables.

Do **not** copy `deploy/cascade-api.service` as-is. That file assumes `ec2-user` and `/home/ec2-user/backend`. `install-service.sh` writes a unit for **your** user and **this** directory (for example `/home/ubuntu/backend/pushnhold`).

## If you already SSHed in and tar failed

You ran `tar` in a folder that does not contain `backend.tgz`. Fix:

```bash
pwd
ls -la ~
ls -la ~/backend.tgz
```

If the file is missing, scp it again (step 1), then:

```bash
cd ~
tar -tzf backend.tgz | head
tar -xzf backend.tgz
ls ~/backend/package.json
```

Do **not** run `sudo apt install npm` (old Node). The setup script uses Node 20.

## Manual Node install (Ubuntu only)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

## Later updates

Recreate `backend.tgz` on Windows, scp to `~/`, then:

```bash
cd ~
tar -xzf backend.tgz
cd ~/backend
npm install --omit=dev
sudo systemctl restart cascade-api
```

## S3 IAM (event images)

Uploads go through the API (`events/<id>/...` keys). Attach an instance role instead of access keys.

1. IAM → Roles → EC2 → name `cascade-ec2-s3`. Inline policy: [`deploy/s3-instance-policy.json`](deploy/s3-instance-policy.json) (replace `YOUR_BUCKET`).
2. EC2 → instance → Actions → Security → Modify IAM role → `cascade-ec2-s3`.
3. Bucket policy for public posters: [`deploy/s3-bucket-public-read.json`](deploy/s3-bucket-public-read.json).
4. In `.env`: `AWS_REGION` (same as the bucket) and `S3_BUCKET=YOUR_BUCKET`. Do not set `AWS_ACCESS_KEY_ID` when using the role.
5. `sudo systemctl restart cascade-api`

## Resend SMTP (verification mail)

The API key **is** the SMTP password. Username in code is the word `resend`.

1. [resend.com/api-keys](https://resend.com/api-keys) → Create API Key → **Sending access** → copy `re_...` once.
2. Domains → verify `mozartdev.in` (DNS SPF/DKIM). Until then `MAIL_FROM` with `beth.t@example.com` only reaches your Resend login email.
3. `.env`: `RESEND_API_KEY`, `MAIL_FROM=CASCADE <noreply@mozartdev.in>`, `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`.
4. Restart and test: `node scripts/send-test-email.js you@inbox.com`

`beth.t@example.com` is a shared Resend domain and often lands in **spam**. After DNS is Verified, set `MAIL_FROM=CASCADE <noreply@mozartdev.in>` and restart. Mark the first real message as Not spam so Gmail learns.
