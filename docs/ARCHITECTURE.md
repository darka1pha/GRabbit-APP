# Architecture Overview

`gRabbit` is structured as a modular TypeScript monorepo powered by **Turborepo** and **pnpm workspaces**.

## Structure

```
GRabbitApp/
├── apps/
│   ├── desktop/                # Electron + React + Vite application
│   ├── mobile/                 # Expo Router React Native application
│   └── telegram-bot/           # Telegram bot backend (Grammy + BullMQ + Redis + PostgreSQL)
│
├── packages/
│   ├── core/                   # Shared business logic & algorithms (segments, platform detection)
│   ├── api/                    # API client abstraction & network layer
│   ├── types/                  # Shared TypeScript interfaces & types
│   ├── schemas/                # Zod validation schemas
│   ├── utils/                  # Shared formatting and math utilities
│   ├── config/                 # Common configuration defaults and constants
│   └── extension/              # Manifest V3 browser companion (Chrome, Edge, Firefox, Brave)
│
├── docs/                       # Architecture and developer guides
├── .github/workflows/          # CI/CD pipelines
├── package.json                # Monorepo root configuration
├── pnpm-workspace.yaml         # Monorepo workspace definition
├── turbo.json                  # Turborepo task pipeline
└── tsconfig.base.json          # Shared TypeScript settings
```

## Packages Role

- **`@grabbit/types`**: Single source of truth for media, download task, platform, and settings types.
- **`@grabbit/schemas`**: Zod validation schemas for API inputs, task creation, and application settings.
- **`@grabbit/config`**: Default application constants, supported platforms, user agents, categories.
- **`@grabbit/utils`**: Zero-dependency helpers (format bytes, calculate download ETA, filename sanitization).
- **`@grabbit/core`**: Domain logic (platform identification, segment chunk calculation).
- **`@grabbit/api`**: Common API interfaces and client implementation.
- **`@grabbit/extension`**: IDM-style browser companion extension (Manifest V3) for download interception, context menu integration, and video stream sniffing.

