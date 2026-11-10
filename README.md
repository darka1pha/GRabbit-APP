# 🐰 GRabbit Monorepo

> **Drop a link. Grab the goods.** Cross-platform media grabber, music recognizer, and multi-connection download manager.
>
> 🌐 **Official Website & Downloads:** [https://darka1pha.github.io/GRabbit-APP/](https://darka1pha.github.io/GRabbit-APP/)

---

## 📁 Repository Structure

```
GRabbitApp/
├── apps/
│   ├── desktop/                 # Electron + React + Vite desktop app (Windows, macOS, Linux)
│   │   ├── src/
│   │   │   ├── main/           # Electron main process
│   │   │   ├── preload/        # Preload scripts & IPC bridge
│   │   │   └── renderer/       # React UI (Tailwind-styled, RTL supported)
│   │   ├── package.json
│   │   └── electron.vite.config.ts
│   │
│   ├── mobile/                  # React Native mobile app with Expo Router
│   │   ├── app/                 # Expo file-based routing
│   │   ├── components/          # Native mobile components
│   │   ├── package.json
│   │   └── app.json
│   │
│   └── telegram-bot/            # Grammy + BullMQ Telegram Bot backend service
│       ├── src/                 # Bot handlers, queue workers & platform adapters
│       ├── tests/               # Unit & integration tests
│       ├── package.json
│       ├── Dockerfile
│       └── docker-compose.yml
│
├── packages/
│   ├── core/                    # Shared business logic
│   ├── api/                     # API client abstraction
│   ├── types/                   # Shared TypeScript definitions
│   ├── schemas/                 # Zod validation schemas
│   ├── utils/                   # Shared utility functions
│   ├── config/                  # Shared configurations and constants
│   └── extension/               # Chrome / Edge / Firefox browser companion extension
│
├── docs/                        # Architecture & documentation
├── .github/
│   └── workflows/               # CI/CD pipelines
├── package.json                 # Monorepo root configuration
├── pnpm-workspace.yaml          # PNPM workspace definition
├── turbo.json                   # Turborepo task pipeline
├── tsconfig.base.json           # Shared base TypeScript configuration
├── .gitignore
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: >= 20 (Node 22 or 24 recommended)
- **pnpm**: >= 9 (`corepack enable pnpm` or `npm install -g pnpm`)

### Install Dependencies
```bash
pnpm install
```

### Development
Run all apps concurrently:
```bash
pnpm dev
```

Or target a specific app:
```bash
# Run Electron Desktop App
pnpm --filter grabbit-desktop dev

# Run Expo Mobile App
pnpm --filter @grabbit/mobile start

# Build Browser Extension (outputs to packages/extension/dist/)
pnpm build:extension
```

### Type Checking & Build
```bash
# Typecheck all packages and apps
pnpm typecheck

# Build all packages and apps
pnpm build
```

---

## 📦 Packages Overview

| Package | Description |
|---|---|
| [`@grabbit/types`](./packages/types) | Common TypeScript interfaces for media, tasks, platforms, and configs |
| [`@grabbit/schemas`](./packages/schemas) | Runtime validation schemas powered by Zod |
| [`@grabbit/utils`](./packages/utils) | Byte formatting, duration parsing, speed/ETA calculation, filename sanitation |
| [`@grabbit/config`](./packages/config) | Defaults, platforms list, user-agents, categories |
| [`@grabbit/core`](./packages/core) | Domain logic (platform identification, segment computation) |
| [`@grabbit/api`](./packages/api) | Unified API client for metadata extraction, recognition, and updates |
| [`@grabbit/extension`](./packages/extension) | Chrome / Firefox extension for 1-click media grabbing & RPC bridge |

---

## 🛠️ Releases & Packaging

### Desktop App (Windows)
```bash
# Package Windows NSIS installer and portable executable into apps/desktop/release/
pnpm build:desktop

# Test unpacked directory build
pnpm build:desktop:dir
```

### Mobile App (Android)
```bash
# Export optimized production bundle with Hermes
pnpm build:mobile:export

# Generate native Android project and build APK locally
pnpm --filter @grabbit/mobile prebuild:android
cd apps/mobile/android && ./gradlew assembleRelease
```

### Browser Extension (Chrome / Edge / Firefox)
```bash
# Build unpacked MV3 extension into packages/extension/dist/
pnpm build:extension
```

### GitHub Releases Pipeline
The repository includes an automated CI/CD release workflow in `.github/workflows/release.yml`.

To publish a new version for Desktop (`.exe` installer & portable), Mobile (`.apk`), and the Chrome Extension (`.zip`):
1. Tag a release commit:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. Or trigger the **Release** workflow manually from the **Actions** tab in GitHub.
3. The workflow will build all artifacts, generate SHA256 checksums, and publish a GitHub Release with direct download links.

---

## 📄 License
MIT © DarkAlpha

