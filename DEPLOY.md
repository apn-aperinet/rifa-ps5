# Deploy no servidor

## 1. Enviar para o servidor

```bash
# No seu PC, dentro da pasta rifa-ps5:
git init && git add . && git commit -m "Rifa do Play inicial"
git remote add origin https://github.com/SEU_USUARIO/rifa-ps5.git
git push -u origin main
```

```bash
# No servidor:
cd /var/www
git clone https://github.com/SEU_USUARIO/rifa-ps5.git
cd rifa-ps5
npm install
```

## 2. Banco de dados

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE rifa_do_play;
CREATE USER rifa_app WITH PASSWORD 'SENHA_FORTE_AQUI';
GRANT ALL PRIVILEGES ON DATABASE rifa_do_play TO rifa_app;
\c rifa_do_play
GRANT ALL ON SCHEMA public TO rifa_app;
\q
```

## 3. Arquivo .env

```bash
cp .env.example .env
nano .env
```

Preencha:
- `PGPASSWORD=` a senha criada acima
- `SESSION_SECRET=` uma string aleatória longa (ex: `openssl rand -hex 32`)
- `ADMIN_PASSWORD=` uma senha forte para o painel admin

## 4. Serviço systemd

```bash
sudo nano /etc/systemd/system/rifa-do-play.service
```

```ini
[Unit]
Description=Rifa do Play
After=network.target

[Service]
User=aperinet
WorkingDirectory=/var/www/rifa-ps5
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production
EnvironmentFile=/var/www/rifa-ps5/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable rifa-do-play
sudo systemctl start rifa-do-play
sudo systemctl status rifa-do-play
```

## 5. Nginx

```bash
sudo nano /etc/nginx/sites-available/rifa
```

```nginx
server {
    listen 80;
    server_name rifa.SEU_DOMINIO.com.br;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/rifa /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 6. SSL (Certbot)

```bash
sudo certbot --nginx -d rifa.SEU_DOMINIO.com.br
```

## 7. Permissões da pasta

```bash
sudo chown -R aperinet:aperinet /var/www/rifa-ps5
chmod 750 /var/www/rifa-ps5
chmod 600 /var/www/rifa-ps5/.env
```

## Acesso admin

URL: `https://rifa.SEU_DOMINIO.com.br/admin.html`  
Senha: o que você colocou em `ADMIN_PASSWORD` no `.env`

## Atualizar depois

```bash
cd /var/www/rifa-ps5
git pull
sudo systemctl restart rifa-do-play
```
