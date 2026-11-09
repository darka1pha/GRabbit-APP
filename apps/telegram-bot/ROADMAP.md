# 🐰 g(Rabbit) — Product & Engineering Roadmap

> *"Drop a link. Grab the goods."*

This document tracks completed milestones and upcoming features for **g(Rabbit)**, organized by priority and domain.

---

## ✅ Completed Milestones

### Phase 1 — Core Foundation & Architecture
- [x] **grammY Telegram Bot Framework** with TypeScript (`ES2022` / `NodeNext`), global error boundary, and per-user rate limiting.
- [x] **Bilingual Internationalization (`en` & `fa`)** using Project Fluent (`@grammyjs/i18n`) with automatic locale detection and FSI/PDI stripping.
- [x] **Asynchronous Job Queue** powered by **BullMQ** and **Redis** with configurable worker concurrency.
- [x] **PostgreSQL Persistence** with automatic startup SQL migrations (`users`, `jobs`, `media_cache`).
- [x] **SSRF & Input Security** blocking loopback, private IPv4/IPv6 ranges, CGNAT, and cloud metadata endpoints, plus strict filename sanitization.
- [x] **Local Telegram Bot API Server (`tdlib/telegram-bot-api`)** integration in Docker Compose supporting file uploads up to **2,000 MB (2 GB)**.

### Phase 2 — Performance, UX & Multi-Platform Expansion
- [x] **Telegram `file_id` Media Cache (`002_media_cache.sql`)**: Instant `<0.5s` delivery for previously downloaded media/qualities without re-downloading or re-uploading.
- [x] **True Subprocess Cancellation (`AbortController`)**: Immediate `SIGTERM` termination of active `yt-dlp` and `ffmpeg` child processes when a user or admin cancels a job.
- [x] **Extended Platform Support**:
  - **YouTube** (Videos, Shorts, Music, resolution selector with estimated file sizes, MP3 extraction).
  - **Spotify** (Track metadata + automatic YouTube audio matching and MP3 extraction).
  - **Instagram** (Public Reels & Videos with optional session cookie support).
  - **SoundCloud** (Tracks & Sets with embedded album art and ID3 metadata).
  - **TikTok**, **X (Twitter / vxtwitter / fxtwitter)**, and **Reddit** (Video MP4 & Audio MP3).
- [x] **Live Progress Bar & Inline Cancel Button**: Throttled real-time progress bar, speed, ETA, and one-tap `❌ Cancel` button.
- [x] **Redis-Backed Preview Cache**: Format selection buttons survive container restarts.
- [x] **Interactive Admin Control Panel (`/admin` & `/stats`)**:
  - Live system overview (users, jobs, bandwidth, cache stats, BullMQ queue health, RAM & uptime).
  - Paginated user browser with download counts.
  - Active & recent job monitor with one-tap force-kill buttons.
  - Maintenance tools (temp directory cleanup, BullMQ history purge, media cache flush).
  - Admin broadcast system to send announcements to all registered users.

### Phase 3 — User Management, Access Control & Growth
- [x] **Ban / Unban & User Tiers in `/admin` (`003_user_tiers_and_bans.sql`)**
  - Added `is_banned` (`BOOLEAN`) and `tier` (`'free' | 'vip'`) columns to `users` and `system_settings` table.
  - Added interactive user detail view inside `/admin` (`👥 Users & VIP/Ban`) with one-tap **⭐ Promote to VIP / 👤 Downgrade to Free** and **🚫 Ban / ✅ Unban** buttons, plus `/ban`, `/unban`, `/vip`, and `/unvip` commands.
  - Enforced tier-based concurrent job, duration, and file size limits, and blocked banned users in `createUserSyncMiddleware`.
- [x] **Forced Channel Subscription ("Force Join" Gate)**
  - Added `createForceJoinMiddleware` verifying channel membership via `getChatMember` before processing links.
  - Added live runtime configuration in `/admin` (`📢 Force-Join Channel`) to set `@channel_username` or disable the gate without restarting the bot.
  - Added localized gate prompt with **`📢 Join Channel`** and **`✅ I Joined (Verify)`** inline buttons.
- [x] **Automatic Scoped Telegram Command Menus (`setMyCommands`)**
  - Registered localized English and Persian `/` command menus on startup (`registerBotCommands`).
  - Registered an extended `BotCommandScopeChat` command menu for `ADMIN_USER_IDS` that surfaces `/admin` and `/stats` exclusively to administrators.

### Phase 4 — Search, Personalization & History
- [x] **Direct Music & Video Search in Chat (`/search`)**
  - Users can send plain text queries in private chats (e.g., `The Weeknd Blinding Lights`) or `/search <query>` without needing a URL.
  - Queries `ytsearch5:<query>` via `YtDlpRunner.search` and renders an inline keyboard of the top 5 matches with duration and channel info for one-tap MP3 or Video download.
- [x] **Inline Mode (`@gRabbit_robot <query or URL>`)**
  - Added `inline_query` handler (`createInlineQueryHandler`) so users can search tracks or share cached downloads (`media_cache`) directly inside any Telegram group or private chat.
- [x] **User Download History (`/history`)**
  - Displays the user's last 10 completed downloads using `JobRepository.getRecentJobs` with one-tap **🔄 Re-send** buttons backed by `media_cache` (and automatic re-queue fallback).
- [x] **Default Format & Quality Preferences (`/settings` & `004_user_preferences.sql`)**
  - Added `default_format` (`ask | audio | video_720p | video_1080p`) to `users`.
  - When set to an automatic mode, pasting a link bypasses the format-selection prompt and immediately queues the download.

### Phase 5 — CI/CD Automation & DevOps
- [x] **Automated GitHub Actions CI/CD Pipeline (`.github/workflows/ci-cd.yml`)**:
  - Full CI pipeline with translation verification, TypeScript compilation, Vitest test suites, and Docker Buildx multi-stage verification.
  - Automated CD deployment via SSH on push to `main`, pulling latest commits, and rebuilding the `grab-bit-app` container with zero database interruption.
- [x] **Deployment Automation Script (`scripts/deploy.sh`)**:
  - Portable bash deployment script detecting Docker Compose v1/v2, pruning dangling images, and checking service health.
- [x] **Cross-Platform Git Attributes (`.gitattributes`)**:
  - Normalized LF line endings for shell scripts, dockerfiles, and localization files.

### Phase 6 — Audio Recognition & Music Matching
- [x] **Acoustic Music Recognition (Shazam Engine)**
  - Users can send or forward any voice note, round video (`video_note`), audio track, or video clip.
  - Automatically extracts a clean 15-second mono audio sample via `FFmpegRunner` (`extractAudioSampleForRecognition`).
  - Matches the acoustic fingerprint against Shazam's catalog using WebAssembly (`node-shazam` / `shazamio_core`).
  - Delivers a rich card with song title, artist, album, genre, release year, and high-resolution cover art.
  - Features one-tap **`🎵 Download MP3`** and **`🎬 Download Video`** buttons wired directly into the BullMQ download queue.
  - Includes streaming buttons for Apple Music / Shazam and an inline switch button to search more versions.

---

## 🚀 Upcoming Roadmap

### Phase 7 — Advanced Media Processing
- [ ] **Time-Range Clipping & Trimming**
  - Support timestamp ranges appended to URLs (e.g., `https://youtu.be/dQw4w9WgXcQ 01:10-02:05`).
  - Pass `--download-sections "*01:10-02:05"` to `yt-dlp` / `ffmpeg` to extract custom video clips or audio ringtones.
- [ ] **Playlist & Carousel Batch Downloads**
  - Detect YouTube playlists, SoundCloud sets, and multi-slide Instagram posts (`--flat-playlist`).
  - Allow users to select individual items or **"📦 Download All (up to 10 items)"** delivered as a media group or sequential batch.
- [ ] **Zero-Copy Local File Delivery (`file://` URI)**
  - Leverage the shared `/app/temp` volume between `grab-bit-app` and `grab-bit-bot-api` (`--local`) to pass local file references directly without HTTP multipart streaming overhead.
- [ ] **Whisper / Subtitle & Lyrics Extraction**
  - Offer an optional **`📝 Subtitles (.srt)`** button when a video contains closed captions (`--write-subs --write-auto-subs`).
