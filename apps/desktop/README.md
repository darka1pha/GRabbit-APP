# 🐰 GRabbit for Windows

> **Drop a link. Grab the goods.** Now as a desktop app, no bot and no server.

GRabbit Desktop turns the g(Rabbit) Telegram bot into a native Windows app (Electron + React + TypeScript).
Everything runs on your PC: there is no Telegram, PostgreSQL, Redis or backend server of any kind.
The app only talks to the sites you download from.

## Features

### Media grabber (from the bot)
- Paste a link from **YouTube, YouTube Music, Spotify, Instagram, SoundCloud, TikTok, X, Reddit**, and any of the
  1000+ sites yt-dlp supports, or **search YouTube** by name.
- Pick **MP3**, **M4A** (original audio, no re-encode) or any **video resolution** (up to 4K/8K) with size estimates.
- **Playlists, albums and sets**: tick the tracks you want and download them all in one format.
- **Spotify**: tracks are matched to the official recording (YouTube Music "Songs" plus duration, artist and variant
  scoring) and tagged with Spotify's title, artists, album, track number, date and cover.
- Cover art and tags are embedded in audio files.

### Professional download manager
- **Multi-connection segmented downloads** (1–32 connections) with **dynamic segment splitting**: a connection that
  finishes early takes over half of the largest remaining segment, so all connections stay busy to the end.
- **Pause / resume**, including after a crash or reboot. Each segment downloads into its own part file, and file
  sizes on disk are the source of truth when resuming. `ETag` / `If-Range` validation detects changed files.
- **Automatic retries** with exponential backoff, `Retry-After` support and stall detection.
- **Queue** with configurable simultaneous downloads, reordering (top / up / down / bottom) and a **daily scheduler**.
- **Speed limits**: global and per download.
- **Categories** (Video, Music, Documents, Compressed, Programs, Images, Other) with optional sub-folders.
- **Batch add** (one link per line), custom **referrer / headers**, **checksum verification** (MD5, SHA-1, SHA-256,
  SHA-512), **change link** for expired URLs, a live **connection map**, and Windows **taskbar progress**.
- **Clipboard monitor** offers to grab media and file links you copy; press **Ctrl+V** anywhere in the app to grab a link.
- **After the queue finishes**: do nothing, quit, sleep, or shut down (with a 60 s cancel window).
- Proxy support (HTTP/HTTPS) for both the download manager and media sites.

### Song recognition
- Drop an audio or video file, or paste a video link (Instagram reel, TikTok, YouTube…).
- The audio fingerprint is computed **locally** (WebAssembly); only the fingerprint is sent to Shazam for matching.
- Then **Find & download** the song in one click.

### Desktop comforts
- English and **Persian (RTL)** UI, light / dark / system theme.
- System tray, notifications, single instance, close-to-tray.
- yt-dlp self-update from Settings → Tools (it runs from a per-user copy, so updates need no admin rights).

## Getting started (development)

Requirements: Windows 10/11 x64, Node.js 22+.

```bash
cd desktop
npm install
```

npm 11 may skip install scripts. If `node_modules/electron/dist` is missing, run:

```bash
node node_modules/electron/install.js
```

Put yt-dlp, FFmpeg and FFprobe into `resources/bin` (yt-dlp is fetched from its official GitHub release):

```bash
npm run fetch-binaries
```

Then start the app with hot reload:

```bash
npm run dev
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm test` | Unit and engine tests (vitest), including a local test server for segmented / resumed downloads |
| `npm run typecheck` | TypeScript checks for main, preload and renderer |
| `npm run build` | Production bundles into `out/` |
| `npm run dist` | Windows installer + portable `.exe` into `release/` |
| `npm run dist:dir` | Unpacked app folder only (fast smoke test) |
| `npm run icon` | Regenerates the app icon PNGs |

Set `GRABBIT_DATA_DIR=<folder>` to run with a separate profile (settings, queue, logs).

## How it is built

```
src/
├── shared/types.ts          Types + IPC channel names shared by every process
├── preload/index.ts         contextBridge API exposed as window.grabbit (sandboxed renderer)
├── main/
│   ├── index.ts             Window, tray, notifications, lifecycle, after-queue actions
│   ├── ipc.ts               IPC handlers ({ ok, data } / { ok: false, error: { code } })
│   ├── settings.ts          Settings with defaults, validation and atomic JSON storage
│   ├── store.ts             Debounced atomic JSON store (the whole "database")
│   ├── paths.ts             Bundled binary resolution, per-user yt-dlp copy, yt-dlp installer
│   ├── clipboard-watcher.ts Clipboard link detection
│   ├── downloads/
│   │   ├── manager.ts       Queue, concurrency, persistence, scheduler, progress aggregation
│   │   ├── http-engine.ts   Segmented multi-connection HTTP engine (part files, splitting, retries)
│   │   ├── http-client.ts   node:http(s) requests with redirects, proxy agent, header parsing
│   │   ├── media-engine.ts  yt-dlp based jobs (resumable working folder, stage reporting)
│   │   ├── throttle.ts      Shared bandwidth limiter (GCRA)
│   │   ├── categories.ts    Extension / MIME → category
│   │   └── files.ts         Unique names, cross-drive moves, hashing
│   └── media/               Ported from the bot: yt-dlp / FFmpeg runners, platform adapters,
│                            Spotify matcher, URL parser, Shazam recognizer
└── renderer/                React UI: Grab, Downloads, Recognize, Settings
```

Data lives in `%APPDATA%\GRabbit` (`settings.json`, `downloads.json`, `logs/`, `bin/yt-dlp.exe`, `temp/`).
In-progress HTTP downloads keep their parts in a hidden `.grabbit-<id>` folder next to the target file.

## Notes

- Respect copyright and each platform's terms of service. DRM-protected content is not supported.
- If YouTube asks you to "confirm you're not a bot", choose a browser under Settings → Media → *Use cookies from
  browser* (Firefox works best; Chromium browsers must be closed), or point it at a `cookies.txt` file.
- Shazam matching and Spotify metadata use those services' public endpoints; no account is needed.
