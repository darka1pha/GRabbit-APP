# Contributing to GRabbit

Thank you for contributing to **GRabbit**!

## Prerequisites

- **Node.js** `24` (see `.nvmrc`)
- **pnpm** `12.5.1` (`corepack enable pnpm`)

## Setup

```bash
pnpm install
```

## Common Commands

```bash
# Typecheck all packages & apps
pnpm typecheck

# Lint all packages, apps, docs & scripts
pnpm lint

# Run unit & integration tests
pnpm test

# Validate Telegram bot Fluent translations (en.ftl <-> fa.ftl)
pnpm --filter @grabbit/telegram-bot run validate:translations

# Build browser extension (Chrome -> packages/extension/dist, Firefox -> packages/extension/dist-firefox)
pnpm build:extension
```

## Pull Request Guidelines

1. Branch from `main` with a descriptive branch name (`feat/...`, `fix/...`).
2. Keep changes focused and add unit tests for new logic.
3. Ensure `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass before opening a PR.
4. When adding i18n keys:
   - Desktop/Mobile: update both `en` and `fa` in `packages/utils/src/i18n.ts`.
   - Telegram Bot: update both `apps/telegram-bot/locales/en.ftl` and `fa.ftl`.
