# ==============================================================================
# Multi-stage Dockerfile for g(Rabbit) Telegram Bot
# ==============================================================================

# Stage 1: Build stage
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Enable corepack and prepare the pnpm version pinned in package.json
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate

# Copy workspace manifests and config (pnpm-workspace.yaml holds allowBuilds approvals).
# Every workspace manifest is copied so the workspace matches pnpm-lock.yaml exactly and
# --frozen-lockfile can be enforced; the filter below still installs only the bot's deps.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/telegram-bot/package.json ./apps/telegram-bot/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/api/package.json ./packages/api/
COPY packages/config/package.json ./packages/config/
COPY packages/core/package.json ./packages/core/
COPY packages/extension/package.json ./packages/extension/
COPY packages/schemas/package.json ./packages/schemas/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/

# Install dependencies for telegram-bot and workspace packages
RUN pnpm --filter @grabbit/telegram-bot... install --frozen-lockfile

# Copy workspace packages & telegram-bot source code and build config
COPY packages/types ./packages/types
COPY packages/utils ./packages/utils
COPY packages/core ./packages/core
COPY apps/telegram-bot/tsconfig.json ./apps/telegram-bot/
COPY apps/telegram-bot/src ./apps/telegram-bot/src
COPY apps/telegram-bot/locales ./apps/telegram-bot/locales
COPY apps/telegram-bot/scripts ./apps/telegram-bot/scripts

# Build TypeScript + workspace bundle to apps/telegram-bot/dist/
RUN pnpm --filter @grabbit/telegram-bot build

# Stage 2: Production runtime image
FROM node:24-bookworm-slim AS runner

WORKDIR /app

# Install system dependencies: FFmpeg, FFprobe, Python 3, curl, ca-certificates
# Retries/timeouts make the build resilient to flaky mirror connections.
RUN printf 'Acquire::Retries "10";\nAcquire::http::Timeout "60";\nAcquire::https::Timeout "60";\n' \
    > /etc/apt/apt.conf.d/80-retries \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pinned yt-dlp release, verified against its published SHA-256.
# To upgrade, bump both values from https://github.com/yt-dlp/yt-dlp/releases (SHA2-256SUMS).
ARG YTDLP_VERSION=2026.10.26
ARG YTDLP_SHA256=e51e69e89489f199530f13d32a4342da3ddb2cf34842f364603a066db05afbf3
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" -o /usr/local/bin/yt-dlp \
    && echo "${YTDLP_SHA256}  /usr/local/bin/yt-dlp" | sha256sum -c - \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

# Enable pnpm for production install
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate

# Copy manifests (all of them, for the same reason as in the build stage)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/telegram-bot/package.json ./apps/telegram-bot/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/api/package.json ./packages/api/
COPY packages/config/package.json ./packages/config/
COPY packages/core/package.json ./packages/core/
COPY packages/extension/package.json ./packages/extension/
COPY packages/schemas/package.json ./packages/schemas/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/

# Install only production dependencies
RUN pnpm --filter @grabbit/telegram-bot... install --prod --frozen-lockfile --ignore-scripts

# Copy build artifacts and runtime resources
COPY --from=builder /app/apps/telegram-bot/dist ./apps/telegram-bot/dist
COPY --from=builder /app/apps/telegram-bot/locales ./apps/telegram-bot/locales
COPY apps/telegram-bot/src/database/migrations ./apps/telegram-bot/src/database/migrations

# Temp media directory, owned by the unprivileged runtime user
RUN mkdir -p /app/temp && chown -R node:node /app/temp

WORKDIR /app/apps/telegram-bot

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV TEMP_DIR=/app/temp

# Run as the image's built-in unprivileged user
USER node

# Liveness via the built-in health server (HEALTH_PORT; /readyz also checks Redis and PostgreSQL)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.HEALTH_PORT || 8090) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Run application
CMD ["node", "dist/index.js"]
