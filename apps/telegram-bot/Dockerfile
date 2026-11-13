# ==============================================================================
# Multi-stage Dockerfile for g(Rabbit) Telegram Bot
# ==============================================================================

# Stage 1: Build stage
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests and config (pnpm-workspace.yaml holds allowBuilds approvals)
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./
COPY apps/telegram-bot/package.json ./apps/telegram-bot/
COPY packages/core/package.json ./packages/core/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/

# Install dependencies for telegram-bot and workspace packages
RUN pnpm --filter @grabbit/telegram-bot... install --frozen-lockfile || pnpm --filter @grabbit/telegram-bot... install --config.strict-dep-builds=false

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
FROM node:22-bookworm-slim AS runner

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

# Install latest yt-dlp binary safely
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

# Enable pnpm for production install
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifests
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./
COPY apps/telegram-bot/package.json ./apps/telegram-bot/
COPY packages/core/package.json ./packages/core/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/

# Install only production dependencies
RUN pnpm --filter @grabbit/telegram-bot... install --prod --ignore-scripts --config.strict-dep-builds=false

# Copy build artifacts and runtime resources
COPY --from=builder /app/apps/telegram-bot/dist ./apps/telegram-bot/dist
COPY --from=builder /app/apps/telegram-bot/locales ./apps/telegram-bot/locales
COPY apps/telegram-bot/src/database/migrations ./apps/telegram-bot/src/database/migrations

# Create temp media directory
RUN mkdir -p /app/temp

WORKDIR /app/apps/telegram-bot

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV TEMP_DIR=/app/temp

# Run application
CMD ["node", "dist/index.js"]
