# Invoq API Manual VPS Setup (PM2 + Nginx + SSL)

## 1) SSH to server

```bash
ssh root@YOUR_VPS_IP
```

## 2) Install packages

```bash
apt update -y
apt upgrade -y
apt install -y git curl nginx redis-server certbot python3-certbot-nginx nodejs npm
npm install -g pm2
systemctl enable --now redis-server
```

## 3) Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## 4) Install Rust + Stellar CLI

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env
cargo install stellar-cli --locked
stellar --version
```

## 5) Add Stellar key

```bash
stellar keys generate mywallet
stellar keys address mywallet
stellar keys fund mywallet --network testnet
stellar keys show mywallet
```

Use the shown secret as `STELLAR_ADMIN_SECRET` in `.env`.

## 6) Clone project

```bash
cd /root
git clone <YOUR_REPO_URL> invoq
cd /root/invoq/invoq-api
```

## 7) Create `.env`

```bash
cat > .env <<'EOF'
PORT=3001
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=
STELLAR_ADMIN_SECRET=
MONGODB_URI=
MONGODB_DB=invoq
REDIS_URL=redis://127.0.0.1:6379
# or use local host/port directly:
# REDIS_HOST=127.0.0.1
# REDIS_PORT=6379
# REDIS_PASSWORD=
# REDIS_DB=0
SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS=
BILLING_CONTRACT_ID=
ESCROW_VAULT_CONTRACT_ID=
EOF
```

## 8) Install + build

```bash
bun install --frozen-lockfile
bun run build
```

## 9) Start with PM2

```bash
pm2 start dist/main.js --name invoq-api
pm2 save
pm2 startup
```

Run the command shown by `pm2 startup`, then:

```bash
pm2 save
```

## 10) Nginx setup

```bash
cat > /etc/nginx/sites-available/invoq-api <<'EOF'
server {
  listen 80;
  server_name api.yourdomain.com;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF

ln -sf /etc/nginx/sites-available/invoq-api /etc/nginx/sites-enabled/invoq-api
nginx -t
systemctl reload nginx
```

## 11) Add SSL

Point DNS first: `api.yourdomain.com -> YOUR_VPS_IP`

```bash
certbot --nginx -d api.yourdomain.com
```

## 12) Manual deploy every time

```bash
cd /root/invoq
git pull origin main
cd /root/invoq/invoq-api
bun install --frozen-lockfile
bun run build
pm2 restart invoq-api
```

## 13) Useful commands

```bash
pm2 status
pm2 logs invoq-api
pm2 restart invoq-api
```
