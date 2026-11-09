# Implementation Plan — g(Rabbit)

## Overview
g(Rabbit) is a production-ready, multilingual Telegram bot for retrieving and downloading authorized media from YouTube, Spotify, Instagram, and SoundCloud.
"Drop a link. Grab the goods."

---

## Phases & Status

- [x] **Phase 1: Repository Assessment**
  - Assessed workspace: empty repository at `d:\Work\gRabbit`.
  - Node.js LTS v24.21.0, pnpm v12.5.1 detected.
  - Determined project structure and dependencies.

- [x] **Phase 2: Foundation & Tooling**
  - Initialized `package.json` with pnpm.
  - Setup TypeScript (`tsconfig.json`), Vitest, and build scripts.
  - Setup core configuration with Zod (`src/config/env.ts`, `src/config/constants.ts`).
  - Setup structured logging with Pino & secret redaction (`src/observability/logger.ts`).
  - Defined custom domain error classes (`src/core/errors/`).
  - Defined core types and interfaces (`src/core/types/`).

- [x] **Phase 3: Internationalization (i18n)**
  - Implemented `@grammyjs/i18n` (Fluent syntax) with English (`en`) and Persian (`fa`).
  - Created translation files: `locales/en.ftl` and `locales/fa.ftl` (45 keys each).
  - Locale resolution priority: User preference -> Telegram `from.language_code` -> Config default -> `en` fallback.
  - Persian RTL support, localized numbers/dates, plural forms.
  - Locale snapshot for asynchronous background jobs.
  - Script for translation completeness and argument validation (`scripts/validate-translations.ts`).

- [x] **Phase 4: Telegram Bot Experience**
  - Setup grammY bot with type-safe context, error boundaries, rate limiting.
  - Implemented commands: `/start`, `/help`, `/about`, `/language`, `/settings`, `/status`, `/cancel`.
  - Implemented interactive inline keyboards (language selection, format/quality selection, job cancellation).
  - Handled link submission, platform detection, preview card rendering.

- [x] **Phase 5: Platform Integrations & Security**
  - Common platform interface (`src/core/types/platform.ts`).
  - Platform Router & URL Parser with strict SSRF & URL validation (`src/security/ssrf.ts`, `src/platforms/url-parser.ts`).
  - Safe filename sanitization and traversal prevention (`src/security/filename.ts`).
  - YouTube Adapter (yt-dlp wrapper, format discovery, audio extraction, video download).
  - Spotify Adapter (Official Web API metadata for tracks, albums, playlists, episodes; explicit DRM notification).
  - Instagram Adapter (Public posts/reels/video parser; clear handling of login-restricted/private content).
  - SoundCloud Adapter (Public tracks & playlists, authorized stream/download extraction).

- [x] **Phase 6: Media Processing Pipeline & Queue**
  - BullMQ + Redis integration (`src/queue/`).
  - Media processor: yt-dlp execution via `spawn` with argument arrays (no shell injection).
  - Media validation with FFprobe, remuxing/transcoding with FFmpeg (`+faststart`).
  - Temp file management with automatic TTL cleanup and quota checks (`src/services/temp-storage/`).
  - Job lifecycle: `pending`, `queued`, `processing`, `uploading`, `completed`, `failed`, `cancelled`.
  - Concurrency limits, timeouts, cancellation support.

- [x] **Phase 7: Persistence & Database**
  - PostgreSQL schema and migration runner (`src/database/migrator.ts`, `001_initial_schema.sql`).
  - Repositories: `UserRepository`, `JobRepository`.
  - Language preference persistence, job history, rate limit tracking.

- [x] **Phase 8: Telegram Delivery Service**
  - Delivered audio / video / document based on media type & Bot API limits (50MB standard).
  - Progress updates, localized captions, filename sanitization (`src/services/delivery/delivery-service.ts`).
  - Safe cleanup of local files after upload.

- [x] **Phase 9: Automated Testing & Verification**
  - Vitest test suite: 34 tests passing across 6 test suites (`tests/unit/`).
  - Translation validation tests: 45 keys verified with 100% parity (`scripts/validate-translations.ts`).
  - TypeScript compilation: `tsc` compiles with 0 errors into `dist/`.

- [x] **Phase 10: Docker & Production Documentation**
  - Multi-stage Dockerfile (Node 22, non-root user, FFmpeg, FFprobe, yt-dlp binary).
  - `docker-compose.yml` (App, PostgreSQL 16, Redis 7).
  - `.env.example` with safe defaults and comprehensive documentation.
  - Complete documentation in `docs/` (`architecture.md`, `deployment.md`, `internationalization.md`, `development.md`, `troubleshooting.md`).
