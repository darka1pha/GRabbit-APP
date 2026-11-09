# Local Development Guide — g(Rabbit)

This guide covers running, testing, and developing g(Rabbit) on your local workstation.

---

## 1. Prerequisites

- **Node.js**: v22 LTS or v24 LTS
- **pnpm**: v10+ (or v12)
- **PostgreSQL**: v15 or v16
- **Redis**: v7+
- **Media Tools** (optional for unit tests, required for live media extraction):
  - `yt-dlp`
  - `ffmpeg`
  - `ffprobe`

## 2. Quick Setup

1. **Clone repository and install dependencies**:
   ```bash
   pnpm install
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Set your Telegram `BOT_TOKEN` obtained from [@BotFather](https://t.me/BotFather).

3. **Start local infrastructure (Docker Compose)**:
   ```bash
   docker compose up postgres redis -d
   ```

4. **Run database migrations**:
   Migrations run automatically on app startup, or via code.

5. **Start application in development mode**:
   ```bash
   pnpm dev
   ```

## 3. Running Checks & Tests

- **Run all automated tests**:
  ```bash
  pnpm test
  ```

- **Run translation validation**:
  ```bash
  pnpm validate:translations
  ```

- **Run TypeScript compilation check**:
  ```bash
  pnpm build
  ```
