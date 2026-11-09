# 🐰 gRabbit Monorepo

> **Drop a link. Grab the goods.** Cross-platform media grabber, music recognizer, and multi-connection download manager.

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
│   └── config/                  # Shared configurations and constants
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

---

## 📄 License
MIT © DarkAlpha

