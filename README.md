<div align="center">

<img src="./docs/icon.png" alt="GRabbit Logo" width="96" height="96" />

# GRabbit

**Download anything, faster.**  
A lightweight, 100% local 32-connection download manager, 4K social media grabber, and Shazam song recognizer for **Windows**, **Android**, and **Chromium Browsers**.

[![Latest Release](https://img.shields.io/github/v/release/darka1pha/GRabbit-APP?style=flat-square&label=Release&color=38bdf8)](https://github.com/darka1pha/GRabbit-APP/releases/latest)
[![CI Status](https://img.shields.io/github/actions/workflow/status/darka1pha/GRabbit-APP/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/darka1pha/GRabbit-APP/actions/workflows/ci.yml)
[![Release Build](https://img.shields.io/github/actions/workflow/status/darka1pha/GRabbit-APP/release.yml?style=flat-square&label=Release%20Pipeline)](https://github.com/darka1pha/GRabbit-APP/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](./LICENSE)

[**Official Website**](https://grabbit.darkalpha.ir) · [**GitHub Pages Mirror**](https://darka1pha.github.io/GRabbit-APP/) · [**All Releases**](https://github.com/darka1pha/GRabbit-APP/releases) · [**Setup Guide**](#-quick-setup--usage-guide) · [**Report an Issue**](https://github.com/darka1pha/GRabbit-APP/issues)

</div>

---

## ⬇ Download Latest Release (`v1.1.0`)

All official builds are compiled automatically via GitHub Actions and published on the [**GitHub Releases**](https://github.com/darka1pha/GRabbit-APP/releases/latest) page:

| Platform | Package Type | Requirements | Direct Download |
| :--- | :--- | :--- | :--- |
| **Windows Installer** *(Recommended)* | Full NSIS Setup (`.exe`) | Windows 10 / 11 (64-bit) | [**Download `GRabbit-Setup-1.1.0.exe`**](https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-Setup-1.1.0.exe) |
| **Windows Portable** | Zero-Install Standalone (`.exe`) | Windows 10 / 11 (64-bit) | [**Download `GRabbit-1.1.0-portable.exe`**](https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-1.1.0-portable.exe) |
| **Android Mobile App** | Universal APK (`.apk`) | Android 8.0+ / Xiaomi MIUI | [**Download `GRabbit-v1.1.0.apk`**](https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-v1.1.0.apk) |
| **Browser Extension** | Manifest V3 Unpacked (`.zip`) | Chrome, Edge, Brave, Opera | [**Download `GRabbit-Chrome-Extension-v1.1.0.zip`**](https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-Chrome-Extension-v1.1.0.zip) |
| **Checksums** | SHA-256 Hashes (`.txt`) | All Platforms | [**View `SHA256SUMS.txt`**](https://github.com/darka1pha/GRabbit-APP/releases/latest/download/SHA256SUMS.txt) |

> 📦 Browse all versions and release notes at **[github.com/darka1pha/GRabbit-APP/releases](https://github.com/darka1pha/GRabbit-APP/releases)**.

---

## ✨ Highlights

| Feature | Description |
| :--- | :--- |
| **⚡ 32-Connection Segmented Engine** | Splits large HTTP downloads into up to 32 parallel byte-range streams with live per-segment progress, exponential-backoff retries, pause/resume, and bandwidth speed limits. |
| **🎬 4K / 8K Social Media Grabber** | Powered by pre-bundled `yt-dlp` and `FFmpeg`. Grab video and MP3/M4A audio from **YouTube** (videos, Shorts, playlists), **Instagram** (Reels, posts), **TikTok** (watermark-free), **Spotify**, **SoundCloud**, and **X / Twitter**. |
| **🎵 Built-In Shazam Song Recognition** | Identify unknown songs from any social media link or local video/audio file using acoustic fingerprinting—complete with cover art and 1-click *Find & Download*. |
| **🧩 Chrome / Edge / Brave Extension** | Automatically intercepts browser file downloads, injects a floating **Download with GRabbit** button onto web videos, and forwards session cookies over `127.0.0.1:31542`. |
| **📱 Native Android Companion** | Share links directly from YouTube, Instagram, or TikTok via the **Android Share Sheet → GRabbit**, play media offline, save to Gallery, or forward downloads to your Desktop over Wi-Fi. |
| **🗂️ Smart Queues & Night Scheduler** | Organize tasks into custom queues, auto-sort into category subfolders, schedule start/stop hours, verify MD5/SHA-256 checksums, and trigger post-queue Sleep/Shutdown actions. |

---

## 📖 Quick Setup & Usage Guide

### 1. Windows Desktop App
1. Download and run [**`GRabbit-Setup-1.1.0.exe`**](https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-Setup-1.1.0.exe) (or launch [**`GRabbit-1.1.0-portable.exe`**](https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-1.1.0-portable.exe)). Both `yt-dlp` and `FFmpeg` are bundled inside automatically.
2. **Direct File Downloads:** Open **Downloads → + Add** and paste any direct file link (`.iso`, `.zip`, `.rar`, `.exe`, `.mp4`).
3. **Social Video & Audio:** Open **Grab Media**, paste a YouTube, Instagram, TikTok, Spotify, or SoundCloud URL, and select your desired resolution or MP3/M4A audio format.
4. **Global Quick Grab Shortcut:** Press `Ctrl + Alt + G` anywhere in Windows to open the floating Quick Grab bar without leaving your current window.

### 2. Chrome / Edge / Brave Extension (Unpacked Setup)
1. Download [**`GRabbit-Chrome-Extension-v1.1.0.zip`**](https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-Chrome-Extension-v1.1.0.zip) and extract (unzip) it to a permanent folder on your computer.
2. Open `chrome://extensions` in your browser and enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** (top-left) and select the extracted folder (the folder containing `manifest.json`).
4. Keep **GRabbit Desktop** running—the extension automatically connects to the local RPC bridge on `http://127.0.0.1:31542` and shows **🟢 Connected**.
5. Hover over any web video to click **🐰 Download with GRabbit**, or right-click any link/page to send downloads directly to GRabbit.

### 3. Android Mobile App (`.apk`)
1. Download [**`GRabbit-v1.1.0.apk`**](https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-v1.1.0.apk) on your Android device and tap to install *(allow "Install unknown apps" if prompted)*.
2. **Share from Any App:** While watching a video in YouTube, Instagram, TikTok, or X, tap **Share → GRabbit** to inspect qualities and start downloading immediately.
3. **Desktop Wi-Fi Sync (Optional):** Go to **Settings → Desktop RPC Bridge**, enter your PC's local LAN IP and port `31542`, and send heavy downloads straight from your phone to your PC.

---

## 🏗️ Monorepo Architecture

```text
GRabbitApp/
├── apps/
│   ├── desktop/          # Electron + React 19 + Vite desktop app (Windows NSIS & Portable)
│   ├── mobile/           # React Native + Expo SDK 52 mobile app (Android APK)
│   └── telegram-bot/     # Grammy + BullMQ Telegram Bot backend service
│
├── packages/
│   ├── core/             # Platform detection, URL parsers & byte-segment calculation
│   ├── api/              # Typed HTTP & RPC client abstractions
│   ├── types/            # Shared TypeScript interfaces across Desktop, Mobile & Extension
│   ├── schemas/          # Runtime Zod validation schemas
│   ├── utils/            # Formatting, speed/ETA math & filename sanitization
│   ├── config/           # Shared constants, default ports & file extension presets
│   └── extension/        # Manifest V3 browser extension (Chrome, Edge, Brave, Firefox)
│
├── docs/                 # Official Landing Page (https://grabbit.darkalpha.ir) & Architecture docs
└── .github/workflows/    # Automated CI, Multi-Platform Release & GitHub Pages pipelines
```

---

## 💻 Development & Building from Source

### Prerequisites
- **Node.js** `>= 20` (Node 22 LTS recommended)
- **pnpm** `>= 9` (`corepack enable pnpm`)

### Install & Run
```bash
# Install all workspace dependencies
pnpm install

# Launch Desktop app in development mode
pnpm --filter grabbit-desktop dev

# Launch Mobile app with Expo
pnpm --filter @grabbit/mobile start

# Build Browser Extension into packages/extension/dist/
pnpm build:extension
```

### Verification & Production Packaging
```bash
# Typecheck all 10 packages & apps
pnpm typecheck

# Run full unit & integration test suite (Vitest)
pnpm test

# Build Windows Installer (.exe) & Portable executable
pnpm build:desktop
```

---

## 📄 License

Released under the **MIT License** · Copyright © [DarkAlpha](https://github.com/darka1pha)
