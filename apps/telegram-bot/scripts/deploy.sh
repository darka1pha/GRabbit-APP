#!/usr/bin/env bash
# ==============================================================================
# g(Rabbit) Deployment Script
# Automatically pulls the latest main branch and redeploys the Docker container
# ==============================================================================
set -euo pipefail

# Determine script, bot, and repository root directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="${1:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"

echo "🐰 g(Rabbit) — Server Redeployment"
echo "========================================"
echo "📍 Repository directory: $PROJECT_DIR"
cd "$PROJECT_DIR"

# 1. Verify Git Repository
if [ ! -d ".git" ]; then
  echo "❌ Error: $PROJECT_DIR is not a git repository!" >&2
  exit 1
fi

# 2. Check for .env file
if [ ! -f "$BOT_DIR/.env" ] && [ ! -f ".env" ]; then
  echo "⚠️ Warning: .env file not found in $BOT_DIR or $PROJECT_DIR. Ensure required environment variables are set."
fi

# 3. Pull latest changes from origin/main
echo "⬇️ Pulling latest changes from origin/main..."
git fetch origin main
git reset --hard origin/main

# 4. Detect Docker Compose
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif docker-compose version >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "❌ Error: Neither 'docker compose' nor 'docker-compose' found on system." >&2
  exit 1
fi

# 5. Rebuild and restart the app service
echo "🐳 Rebuilding and restarting application container..."
$COMPOSE -f "$BOT_DIR/docker-compose.yml" up -d --build app

# 6. Clean up dangling images
echo "🧹 Cleaning up unused Docker images..."
docker image prune -f

# 7. Verify running containers
echo "📋 Active containers:"
$COMPOSE -f "$BOT_DIR/docker-compose.yml" ps

echo "========================================"
echo "✅ g(Rabbit) redeployment completed successfully!"

