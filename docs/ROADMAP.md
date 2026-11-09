# 🐰 gRabbit Engineering & Product Roadmap

> A unified, high-performance media grabber and segmented download manager monorepo across Desktop, Mobile, and Cloud/Telegram.

---

## 🗺️ High-Level Vision & Architecture

```
                       ┌─────────────────────────┐
                       │     Shared Packages     │
                       │  @grabbit/types         │
                       │  @grabbit/core          │
                       │  @grabbit/utils         │
                       │  @grabbit/config        │
                       │  @grabbit/schemas       │
                       │  @grabbit/api           │
                       └────────────┬────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐        ┌─────────────────┐        ┌──────────────────┐
│  apps/desktop   │        │   apps/mobile   │        │apps/telegram-bot │
│  (Electron+Vite)│        │  (Expo Router)  │        │ (Grammy+BullMQ)  │
└─────────────────┘        └─────────────────┘        └──────────────────┘
```

---

## 📌 Status & Milestones Overview

| Milestone | Scope | Target Apps / Packages | Status |
|---|---|---|---|
| **Phase 0** | Monorepo Setup & Workspace Topology | Root, Turbo, pnpm, TS | **Completed** ✅ |
| **Phase 1** | Shared Core & Platform Adapter Unification | `@grabbit/core`, `@grabbit/types` | **Completed** ✅ |
| **Phase 2** | Desktop Power User Features | `apps/desktop` | **Completed** ✅ |
| **Phase 3** | Mobile App Foundation & Native Grabbing | `apps/mobile` | **Completed** ✅ |
| **Phase 4** | Browser Companion Extension (IDM-style) | `packages/extension`, `apps/desktop` | **Completed** ✅ |
| **Phase 5** | Desktop Polish & Windows 11 Native Integration | `apps/desktop` | **Completed** ✅ |
| **Phase 6** | IDM-Style Multiple Download Queues & Per-Queue Scheduling | `packages/types`, `apps/desktop` | **Completed** ✅ |

---

## 🚀 Detailed Phase Breakdown

### Phase 0: Monorepo Setup & CI (Completed ✅)
- [x] Restructure project into `apps/` and `packages/` monorepo.
- [x] Setup Turborepo pipelines for `typecheck`, `test`, `build`, and `lint`.
- [x] Configure pnpm workspace with strict dependency hoisting and binary script approval.
- [x] Integrate `apps/telegram-bot` into the monorepo, resolving nested lockfiles and isolated `node_modules`.
- [x] Setup GitHub Actions CI workflow for automated typecheck and build validation.

---

### Phase 1: Shared Core & Platform Engine Unification (Completed ✅)
- [x] Centralize shared TypeScript definitions in `@grabbit/types` (IPC protocols, DownloadItem, MediaItem, Settings).
- [x] Consolidate localized formatting (`formatBytes`, `formatDuration`, `formatSpeed`, `looksLikeDirectFile`) in `@grabbit/utils`.
- [x] Migrate platform scraping & track-matching algorithms into `@grabbit/core`:
  - **Spotify-to-YouTube Track Matcher**: Duration scoring, variant keyword penalization (`remix`, `live`, `cover`), official audio / topic weighting.
  - **Spotify Track Page Scraper**: HTML meta tag parsing (`album`, `trackNumber`, `coverUrl`, `releaseDate`).
  - **URL Detection & Parsing**: Hostname normalizer and platform detector.
  - **Media Quality Options**: Audio tiers (Original M4A, MP3 320k/192k/128k, Lossless FLAC) and standard video resolutions (4K to 360p).
- [x] Wire `apps/desktop` and `apps/telegram-bot` to consume `@grabbit/core`.

---

### Phase 2: Desktop Enhancements (Completed ✅)
- [x] **Windows Taskbar Progress States**:
  - Green (`normal`): Active download progress.
  - Yellow (`paused`): When queue items are paused.
  - Red (`error`): Visual alert when a task encounters an error.
  - Clean reset (`-1`) on queue completion.
- [x] **Live Visual Connection Map (Segment Inspector)**:
  - Real-time connection thread inspector modal (`SegmentInspectorModal`).
  - Visual timeline breakdown showing chunks, byte ranges, individual % bars, and thread states (`Active`, `Done`, `Waiting`).
- [x] **Batch URL & File Import**:
  - Import multi-line URLs or `.txt`, `.m3u`, `.m3u8`, `.csv` files.
  - Drag-and-drop file support with live URL count and pruning list.
  - Bulk configuration for category, target directory, connection limits, and paused additions.
- [x] **Audio Quality & Bitrate Options**:
  - Direct selection of MP3 320k, 192k, 128k, M4A Original, and Lossless FLAC in `GrabView`.

---

### Phase 3: Mobile Experience (`apps/mobile`) (Completed ✅)
*Target: iOS & Android via Expo 52 + Expo Router.*
- [x] **Cross-Platform Bridge**:
  - Connected mobile state to `@grabbit/core` for platform parsing (`parsePlatformUrl`, `detectPlatform`, `extractUrlFromText`) and `@grabbit/api` (`GrabbitApiClient`) with standalone offline resolver fallback for Spotify, YouTube, and generic media.
- [x] **Native Download Storage**:
  - Integrated `expo-file-system` for segmented background downloading on mobile storage with real-time speed calculation, ETA, and progress metrics.
  - Media library saving (save videos to Camera Roll / Photos via `expo-media-library` with permissions handling).
- [x] **In-App Media Player**:
  - Built-in audio and video preview player (`MediaPlayerModal` using `expo-av`) supporting both stream previews and local downloaded files with scrubbing, -10s/+10s skipping, and gallery saving.
- [x] **Share Target Extension (Intent Receiver)**:
  - Supported Android *Share to gRabbit* (`android.intent.action.SEND` for `text/plain`) and iOS URL scheme (`grabbit://`) with `useShareIntent` to grab links immediately from YouTube, Instagram, Spotify, or TikTok.
- [x] **Desktop Feature Parity**:
  - **Multiple Download Queues & Daily Scheduling**: IDM-style queue manager (`DownloadQueue`), Main Queue (`main`), Scheduled Queue (`scheduled`), and custom user queues with daily start/stop windows, concurrency throttling, and live queue status indicators.
  - **Live Visual Connection Map (Segment Inspector)**: Real-time multi-threaded chunk inspector modal (`SegmentInspectorModal`) visualizing segment boundaries, active chunk threads, and byte progress.
  - **Direct File Downloads & Batch Import**: Direct file downloader (`AddDownloadModal`) with URL probing (HEAD / Range test), custom filename, parallel connection threads (1-16), Referrer, headers/cookies, speed limits, and multi-line batch import.
  - **Music & Audio Recognizer (`RecognizeView`)**: Shazam-style song recognition from audio URLs, YouTube clips, TikTok or local files with rich `SongCard` metadata, external links, recognition history, and one-tap Grab.
  - **Category Auto-Detection & Filtering**: 7 categories (`video`, `music`, `documents`, `compressed`, `programs`, `images`, `other`) with filter chips and auto-tagging.
  - **Comprehensive Mobile Settings**: Download concurrency limits, connection threads, speed throttling, audio/video quality defaults, and Desktop RPC bridge pairing.
  - **Checksum Verification**: On-device checksum calculator (`ChecksumModal`) supporting SHA-256, SHA-1, and MD5 with comparison matching.
  - **State Persistence**: Saved tasks, queues, recognition history, and settings to disk using `expo-file-system`.

---

### Phase 4: Browser Companion Extension (IDM-Style) (Completed ✅)
*Target: Chrome, Edge, Firefox, Brave.*
- [x] **Local Desktop RPC Bridge**:
  - Lightweight localhost HTTP listener inside `apps/desktop` (`http://127.0.0.1:31542`).
  - Secure token authentication via `X-GRabbit-Token` or Bearer header between extension and desktop app.
  - Endpoints: `GET /ping`, `GET /status`, `POST /downloads/add`, `POST /downloads/batch`, `POST /media/resolve`.
  - CORS preflight support for browser extensions with zero third-party dependencies.
  - Desktop settings view integration with token display, copy to clipboard, and token regeneration.
- [x] **Browser Extension Core (`packages/extension`)**:
  - Manifest V3 compliant extension compatible with Chromium (Chrome, Edge, Brave) and Gecko (Firefox).
  - Context menu items: *"Download with gRabbit"*, *"Download all links with gRabbit"*, *"Grab page media with gRabbit"*.
  - Automatic download interception via `chrome.downloads.onCreated` for designated file extensions (`.zip`, `.iso`, `.exe`, `.mp4`, etc.) with domain exclusions, cookie forwarding, and desktop task delegation.
  - One-click IDM-style floating video sniffer pill attached to streaming video/audio players.
  - Sleek modern popup with connection status, quick link grabber, detected page media list, and live toggles.
  - Comprehensive options page for RPC connection, token pairing, file extension filter rules, and domain blacklists.

---

### Phase 5: Desktop Polish & Windows 11 Native Integration (Completed ✅)
- [x] **Windows 11 Native Custom Title Bar**:
  - Frameless window (`titleBarStyle: 'hidden'`) with native Windows 11 snap layout button integration via `titleBarOverlay` (`color: '#00000000'`, dynamic `symbolColor`, and theme synchronization).
  - Drag regions, branding slogan, active queue speed pill, and quick grab shortcut pill (`Ctrl+Alt+G`).
- [x] **Global Shortcut Hotkey & Floating Grab Pill**:
  - Registered `Ctrl+Alt+G` (configurable accelerator) to summon a sleek, compact floating grab pill window on the active display containing the cursor.
  - Automatic clipboard URL detection, direct file vs media destination inference, quick actions (Grab/Download), and dismiss on Escape or blur.
  - System tray menu item *"Quick Grab Pill (Ctrl+Alt+G)"* and title bar pill button.
- [x] **Automatic App Updates**:
  - Integrated `electron-updater` configured with GitHub Releases provider.
  - Dedicated Desktop Settings UI for updates: check for updates, version status badge, live download progress, restart & install trigger, and auto-download background toggles.
- [x] **Launch on Startup (`openAtLogin`)**:
  - Native Windows startup integration via `app.setLoginItemSettings`.
  - Settings switches to start on Windows boot and launch minimized to system tray (`--hidden`).

---

### Phase 6: IDM-Style Multiple Download Queues & Scheduling (Completed ✅)
- [x] **Core Queues Architecture (`packages/types`, `apps/desktop/src/main/downloads/manager.ts`)**:
  - `DownloadQueue` data model with queue ID, name, enabled status, max concurrent downloads, scheduler, after-queue completion actions (`stopQueue`, `quit`, `sleep`, `shutdown`, `none`), and ordered item IDs (`order: string[]`).
  - Out-of-the-box default queues: **Main Queue** (`main`, enabled by default) and **Scheduled Queue** (`scheduled`).
  - Queue persistence via `queues.json` with CRUD operations, startup restoration, and automated migrations.
  - Per-queue concurrency enforcement within global limits and separate queue scheduler ticking.
- [x] **Desktop Renderer & Interactive Queue Bar (`DownloadsView.tsx`, `QueueConfigModal.tsx`)**:
  - Horizontal queue pills bar with active status indicators (pulsing green dot when running, muted when stopped), live item counter badges, quick start/stop toggles, and settings modal triggers.
  - "All Downloads" aggregated view alongside individual queue filtering.
  - Queue creation and editing modal with custom concurrency limits, daily time windows (start/stop time), and post-completion actions.
  - Context menu integration: *"Move to Queue: [Queue Name]"* for single or batch-selected download items.
  - Add Download dialog queue selector with automatic target queue assignment.
  - Visual queue tags displayed on download rows in the downloads table.


