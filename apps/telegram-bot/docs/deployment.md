# Production Deployment Guide 🚀 g(Rabbit)

This guide details deploying g(Rabbit) to a Linux VPS or cloud instance (e.g., Ubuntu 22.04 / 24.04 LTS, Debian 12) using Docker and Docker Compose, as well as setting up automated **CI/CD with GitHub Actions**.

---

## 1. Production Architecture

The production setup runs completely containerized:
- `grab-bit-app`: Node.js runtime executing the bot polling and BullMQ background worker pool.
- `grab-bit-postgres`: PostgreSQL 16 database with persistent storage volume (`pgdata`).
- `grab-bit-redis`: Redis 7 in-memory cache and BullMQ job backend with AOF persistence (`redisdata`).
- `grab-bit-bot-api`: Local Telegram Bot API server for 2,000 MB file upload limit (`telegram-bot-api-data`).
- Internal network `grab-bit-net` isolating database and cache ports from the public internet.

---

## 2. Server Provisioning

On a clean Ubuntu/Debian server:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker & Docker Compose plugin
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## 3. Initial Server Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/darka1pha/gRabbit.git ~/gRabbit
   cd ~/gRabbit
   ```

2. **Configure production environment**:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Set `NODE_ENV=production`, your real `BOT_TOKEN`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, database credentials, and optional cookies/tokens.

3. **Deploy using Docker Compose**:
   ```bash
   docker compose up -d --build
   ```

4. **Verify container health and logs**:
   ```bash
   docker compose ps
   docker compose logs -f app
   ```

---

## 4. Automated CI/CD with GitHub Actions

The repository includes a production-grade CI/CD pipeline at [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml).

### How It Works
1. **Continuous Integration (`ci` job)**:
   - Triggers on every push or pull request to the `main` branch.
   - Installs dependencies using `pnpm` (Node.js 22).
   - Validates all translation files (`pnpm run validate:translations`).
   - Compiles TypeScript to verify types (`pnpm run build`).
   - Executes all unit tests with Vitest (`pnpm test`).
   - Verifies that the multi-stage `Dockerfile` builds cleanly.

2. **Continuous Deployment (`deploy` job)**:
   - Triggers automatically **only when code is pushed to `main` and the `ci` job passes**.
   - Connects to your server over SSH.
   - Pulls the latest commits from `origin/main`.
   - Runs [`scripts/deploy.sh`](../scripts/deploy.sh) to rebuild and recreate `grab-bit-app` with zero downtime for database/redis services.
   - Prunes unused dangling Docker images to preserve server disk space.
   - Prints active container status directly in the GitHub Actions log.

---

### GitHub Repository Secrets Setup

Navigate to your GitHub repository:
**Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add the following secrets:

| Secret Name | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `SERVER_HOST` | **Yes** | Public IP address or domain name of your VPS | `194.163.150.20` or `bot.example.com` |
| `SERVER_USER` | **Yes** | SSH user on your server | `root` or `ubuntu` |
| `SERVER_SSH_KEY` | **Yes** | Private SSH key with access to your server | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SERVER_PORT` | No | SSH port (defaults to `22` if omitted) | `22` |
| `SERVER_PROJECT_PATH` | No | Directory where the repository is cloned | `/root/gRabbit` or `~/gRabbit` |
| `SERVER_SSH_PASSPHRASE` | No | Passphrase for your private key (if encrypted) | `your-key-passphrase` |
| `ENV_FILE` | No | Entire production `.env` contents to sync automatically | Content of `.env` |

---

### Generating an SSH Key for GitHub Actions

If you don't already have a dedicated SSH key for deployment:

1. **On your local machine or server**, generate a new key pair:
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key
   ```

2. **Add the public key** to your server's authorized keys:
   ```bash
   cat deploy_key.pub >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   chmod 700 ~/.ssh
   ```

3. **Add the private key** (`deploy_key`) to GitHub Secrets as `SERVER_SSH_KEY`.
   *(Never share or commit the private key!)*

---

## 5. Manual Redeployment

You can also trigger a redeployment manually anytime:
- **From GitHub**: Go to **Actions** → **CI/CD Pipeline** → **Run workflow**.
- **Directly on the server**:
  ```bash
  cd ~/gRabbit
  ./scripts/deploy.sh
  ```
