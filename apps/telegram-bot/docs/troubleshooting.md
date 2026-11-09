# Troubleshooting Guide — g(Rabbit)

This guide documents common operational scenarios and their resolutions.

---

## 1. Telegram Bot Token Issues

- **Symptom**: `Error: Telegram BOT_TOKEN is required`
  - **Fix**: Check `.env` and verify `BOT_TOKEN` is present and formatted as `123456789:ABC...`.
- **Symptom**: `401 Unauthorized` on bot startup
  - **Fix**: The token provided is invalid or was revoked by @BotFather. Generate a new token and update `.env`.

## 2. Media Extraction Issues

- **Symptom**: `Media unavailable, private, or has been removed`
  - **Cause**: The source link is private, age-gated, or geo-restricted.
  - **Resolution**: Test public links. For Instagram or age-restricted content, provide `INSTAGRAM_SESSION_ID` or YouTube cookies if legally authorized.
- **Symptom**: `Spotify audio downloads are not available`
  - **Behavior**: This is intentional. Spotify audio streams are encrypted under DRM. g(Rabbit) displays rich track/album metadata preview cards without circumventing DRM.

## 3. Database & Redis Connectivity

- **Symptom**: `Connection refused to localhost:5432` or `localhost:6379`
  - **Fix**: Confirm PostgreSQL and Redis are running. If running locally with Docker Compose, run `docker compose up postgres redis -d`.

## 4. File Size Limits

- **Symptom**: `File size exceeds the maximum Telegram limit of 50MB`
  - **Explanation**: Telegram Bot API enforces a 50MB file size limit for bot uploads.
  - **Resolution**: When downloading high-resolution YouTube videos that exceed 50MB, choose lower resolutions (e.g., 480p/720p) or audio extraction (MP3).
