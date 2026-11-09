# ==============================================================================
# Multi-stage Dockerfile for g(Rabbit) Telegram Bot
# ==============================================================================

# Stage 1: Build stage
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package manifests and config (pnpm-workspace.yaml holds allowBuilds approvals)
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./

# Install all dependencies (including dev)
RUN pnpm install --frozen-lockfile || pnpm install --config.strict-dep-builds=false

# Copy source code and build config
COPY tsconfig.json ./
COPY src/ ./src/
COPY locales/ ./locales/
COPY scripts/ ./scripts/

# Build TypeScript to dist/
RUN pnpm build

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

# Install only production dependencies
RUN pnpm install --prod --ignore-scripts --config.strict-dep-builds=false

# Copy build artifacts and runtime resources
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/locales ./locales
COPY src/database/migrations ./src/database/migrations

# Create temp media directory
RUN mkdir -p /app/temp

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV TEMP_DIR=/app/temp

# Run application
CMD ["node", "dist/index.js"]
