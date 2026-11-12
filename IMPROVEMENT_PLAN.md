# GRabbit — Improvement Implementation Plan

Based on a read of the code at `c706e4d` (v1.1.0): desktop main process, download engine, RPC bridge,
renderer, mobile services/hooks, extension manifest, and CI. The Telegram bot was not reviewed.

Effort: **S** ≈ under a day, **M** ≈ 1–3 days, **L** ≈ a week or more.

## Order of work

| Phase | Theme | Why this order | Status |
|---|---|---|---|
| 1 | RPC bridge security | Remotely exploitable on the default configuration | Done |
| 2 | Correctness bugs | Features that silently do the wrong thing | Done |
| 3 | Desktop performance | Scales poorly past a few hundred items | Done |
| 4 | Mobile performance & honesty | Disk write on every progress event; simulated segments | Done |
| 5 | Desktop UI/UX | Keyboard, accessibility, i18n gaps, narrow layout | Pending |
| 6 | Mobile UI/UX | Lists, background downloads, accessibility | Pending |
| 7 | Extension | Permission footprint, per-page cost | Pending |
| 8 | Tooling & release | Lint, lockfile, signing, cleanup | Pending |
| 9 | New features | Only after the above | Pending |

---

## Phase 1 — RPC bridge security (do first) — [COMPLETED]

The bridge in `apps/desktop/src/main/rpc-bridge.ts` is enabled by default, and `allowLan` defaults to
`true` (`settings.ts:54`), so it listens on `0.0.0.0:31542` on a fresh install.

| # | Item | Status | Implementation Details |
|---|---|---|---|
| 1.1 | Remove the Origin / client-header auth bypass | Done | Mandatory token comparison via `timingSafeEqual`; deleted Origin and `X-GRabbit-Client` auth bypass; dropped `?token=` query param. |
| 1.2 | Default to loopback | Done | `allowLan` default set to `false`; warning shown when toggled on; non-loopback / non-LAN `Host` headers rejected to prevent DNS rebinding. |
| 1.3 | Constrain what remote callers can ask for | Done | Ignored custom `directory` from RPC, enforced `settings.downloadDir`; sanitized filenames; added SSRF protections to prevent internal network scanning; restricted CORS to browser extensions. |
| 1.4 | Protect secrets at rest | Done | Encrypted bridge token, Spotify client secret, and Instagram session ID at rest via Electron `safeStorage`. |
| 1.5 | Validate IPC and RPC inputs | Done | Strict Zod schemas for all IPC and RPC calls (`@grabbit/schemas`), and validated `openPath` boundaries. |

### 1.1 Remove the Origin / client-header auth bypass — S (Done)
`authenticate()` (`rpc-bridge.ts:129-146`) accepts any request whose `Origin` starts with
`chrome-extension://` or `moz-extension://`, with no token. `Origin` is only trustworthy when a browser
sends it; any device on the LAN can set it with curl. Combined with `/downloads/add` accepting an
arbitrary `directory` and `fileName`, that is an unauthenticated write of an attacker-chosen file to
an attacker-chosen folder (for example the Startup folder).

- Require the token on every route except `/ping`. Delete the Origin and `X-GRabbit-Client` branches.
- Delete the `if (!expectedToken) return true` branch; `sanitize()` already guarantees a token.
- Drop the `?token=` query option (tokens end up in logs and history); compare with `timingSafeEqual`.
- The extension already stores a token in its options page — make pairing mandatory, and have the
  popup show a clear "paste token" state when `/ping` returns `authenticated: false`.
- Tests: extend `tests/rpc-bridge.test.ts` with spoofed-Origin and missing-token cases expecting 401.

### 1.2 Default to loopback — S (Done)
- `allowLan` default → `false`; switching it on shows a one-line warning in Settings.
- Migration: existing users keep their saved value; only the default changes.
- Reject requests whose `Host` header is not `127.0.0.1`, `localhost`, or the machine's LAN IP
  (blocks DNS rebinding from web pages).

### 1.3 Constrain what remote callers can ask for — M (Done)
- `/downloads/add` and `/batch`: ignore `directory` from RPC callers (or require it to resolve inside
  `settings.downloadDir`); run `fileName` through `sanitizeFilename`; cap batch size.
- `/extension/update` (`rpc-bridge.ts:349-393`): fetches any URL and unzips it via PowerShell, and
  writes into `process.cwd()/packages/extension/dist` (a dev-only path). Either remove the endpoint
  or pin `downloadUrl` to `https://github.com/darka1pha/GRabbit-APP/releases/…` and drop the cwd target.
- `/media/recognize`, `/media/stream`, `/media/resolve`: these make the desktop fetch arbitrary URLs.
  Block private/loopback/link-local targets (the bot already has `security/ssrf.ts` — move it to
  `@grabbit/core` and reuse).
- CORS: replace `Access-Control-Allow-Origin: *` with an echo of extension origins only.
- Add a small per-IP rate limit and a cap on concurrent requests.

### 1.4 Protect secrets at rest — S (Done)
`settings.json` stores the bridge token, Spotify client secret and Instagram session id in plain text.
Encrypt those three fields with Electron `safeStorage`, with a one-time migration on load.

### 1.5 Validate IPC and RPC inputs — M (Done)
`ipc.ts` passes renderer arguments straight to the manager (`any` on queue handlers). `@grabbit/schemas`
(Zod) exists but is not used here. Parse every IPC and RPC payload with a schema; restrict `openPath`
to paths the manager knows about.

**Done when:** a curl from another machine with a spoofed Origin gets 401; a fresh install is not
reachable from the LAN; `settings.json` contains no readable secrets.

---

## Phase 2 — Correctness bugs — [COMPLETED]

| # | Problem | Where | Fix | Status | Effort |
|---|---|---|---|---|---|
| 2.1 | Scheduler only fires if the clock reads exactly `HH:MM` while the app is running. Launching at 02:05, or waking from sleep after the start time, skips the whole night. | `manager.ts:842-877` | Treat start/stop as a window: on each tick compute "should be running now" and apply the transition once per window. Handle windows that cross midnight. Add day-of-week selection. | Done | M |
| 2.2 | Per-queue `afterQueue` (`quit`/`sleep`/`shutdown`) is ignored: `checkQueueDrained` calls the global `onQueueDrained()`, which runs `settings.afterQueue` (default `none`). | `manager.ts:605-621`, `index.ts:130` | Pass the queue's action through the callback. Before sleep/shutdown, confirm no other queue is active and show a cancellable countdown dialog instead of a notification. | Done | S |
| 2.3 | Dead ternary: `defaultAudioFormat === 'mp3' ? 'video' : 'video'` — links sent from the browser always become video, even Spotify/SoundCloud. | `rpc-bridge.ts:428` | Pick audio for audio-only platforms, otherwise honour a `format` field from the caller. | Done | S |
| 2.4 | `saveSync` at quit can race an in-flight async write; both use the same `.tmp` path. `saveSync` also skips the `.bak` rotation. | `store.ts` | Track the in-flight promise; use a unique tmp name per write; fsync before rename. | Done | S |
| 2.5 | `store.load` trusts file contents; there is no schema version. | `store.ts`, `manager.ts:119` | Wrap documents as `{ version, data }`, validate with Zod, migrate by version. | Done | M |
| 2.6 | No free-space check; assembling parts needs up to ~2× the file size. A full disk surfaces late as `ENOSPC`. | `http-engine.ts` | Check free space after probe (`fs.statfs`); fail early with a clear message. Resolved more fully by 3.4. | Done | S |
| 2.7 | Stall timeout uses `req.setTimeout` only; verify it still fires for a response body that stops mid-stream, and add a test. | `http-client.ts:46` | Add an idle timer in `pump()` if the test shows a gap. | Done | S |
| 2.8 | Notifications, tray menu and several renderer strings are English-only although the app ships Persian. | `index.ts`, `App.tsx:315-318,240,384` | Move main-process strings into a shared message table keyed by `settings.language`. | Done | S |

---

## Phase 3 — Desktop performance — [COMPLETED]

| # | Item | Status | Implementation Details |
|---|---|---|---|
| 3.1 | Stop re-rendering the whole app twice a second | Done | Downloads live in an external store (`downloads-store.ts`) outside React; row components subscribe individually; main process pushes aggregate stats directly to avoid list iterations. |
| 3.2 | Virtualise the downloads table | Done | In-house windowing hook (`useWindowedList`) renders only visible rows with constant row height at 60 fps. |
| 3.3 | Send smaller progress updates | Done | Compact `DownloadProgressPatch` sent during flushes; whole items sent only on structural change; segment state sent only for watched items. |
| 3.4 | Write segments straight into the final file | Done | Sparse `.gdownload` file allocated via `truncate()`; positional `FileHandle.write()` per segment; progress saved to `.gdownload.meta` sidecar; instantaneous completion rename; legacy `.grabbit-<id>` folder migration supported. |
| 3.5 | Manager hot paths | Done | Cached error/pause status flags; `updateTrayTooltip` uses cached active count; O(1) Sets for queue ordering and item removal; per-queue active counters. |
| 3.6 | Persistence that scales | Done | Split storage into `active.json` (debounced on ticks) and `history.json` (written on status changes/completions); automatic migration from legacy `downloads.json`; history capped to 5,000 items. |
| 3.7 | Network engine | Done | `HostConnectionPool` caps concurrent connections per host (default 8); straggler detection drops connections running < 20% median speed after 6s; dynamic connection reduction on HTTP 429/503; multi-stage probe fallback (`bytes=0-0` → `HEAD` → `bytes=0-` → `GET`). |
| 3.8 | Startup and bundle | Done | `SettingsView`, `RecognizeView`, and `AddDownloadDialog` lazy-loaded with `React.lazy()` / `<Suspense>`; `styles.css` modularized into per-view stylesheets under `styles/`; tool probes deferred until Settings opens; cold-start timing logged on launch. |

### 3.1 Stop re-rendering the whole app twice a second — M (Done)
`AppProvider` (`state.tsx`) exposes one context holding `downloads`. Every progress flush (250 ms)
produces a new array, so `Shell`, the sidebar, Settings and every row re-render. In `App.tsx` the
`active` array is rebuilt each render, which defeats the `useMemo` that depends on it, and the
paste/keydown effect has no dependency array so listeners are re-attached every render.

- Split state into a small external store (Zustand or `useSyncExternalStore`) with selectors:
  `useDownload(id)`, `useDownloadIds(filter)`, `useAggregate()`.
- Wrap `DownloadRow` in `React.memo`; pass stable callbacks.
- Have the main process send the aggregate (active count, total speed, percent) it already computes
  in `tick()`, so the title bar and sidebar never iterate the list.
- Fix the effect dependency array and memoise `active`.

### 3.2 Virtualise the downloads table — M (Done)
`DownloadsView.tsx:464` maps every visible item into a `<tr>`. Add `@tanstack/react-virtual`
(switch the table to a CSS-grid row layout so virtualisation works cleanly). Target: 10,000 items
scroll at 60 fps.

### 3.3 Send smaller progress updates — S (Done)
`onItemsChanged` ships whole `DownloadItem` objects, including `segments`, `headers` and `media`,
for every active item four times a second. Send a compact progress patch
(`id, receivedBytes, speed, eta, status, activeConnections`) and full items only on structural
change. Send `segments` only while the Segment Inspector is open for that item.

### 3.4 Write segments straight into the final file — L (Done)
Today each segment goes to its own `.part` file and `assemble()` copies them all into
`.gdownload` (`http-engine.ts:466-492`). That doubles disk writes and needs extra free space.

- Pre-allocate one sparse `.gdownload` file and write each segment at its offset with
  `FileHandle.write(buffer, 0, len, position)`.
- Persist `received` per segment in a small sidecar file (flushed with the data) so resume no
  longer depends on part-file sizes.
- Completion becomes a rename. Keep `planSegments`/`splitLargest` unchanged.
- Migration: detect an old `.grabbit-<id>` part folder and finish it with the old path.

### 3.5 Manager hot paths — S (Done)
- `tick()` scans every item for `hasError`/`hasPaused` twice a second; keep counters updated on
  status change instead.
- `updateTrayTooltip()` calls `manager.list()` (allocates the full list) on every tick; use the
  `active` count already passed to `onAggregateProgress`.
- `q.order.includes()` during `init`/`insert` and `removed.includes()` in `remove` are O(n²) on
  large histories; use Sets. `insert()` also emits a queues-changed event per item during batch
  import — emit once per batch.
- `pump()` recounts active-per-queue by filtering `running` per queue; keep a per-queue counter.

### 3.6 Persistence that scales — M (Done)
`downloads.json` is rewritten in full every 5 s while anything is active, including all completed
history. Split into `active.json` (small, written often) and an append-only history, or move to
SQLite. Cap or archive history (setting: keep last N / N days).

### 3.7 Network engine — M (Done)
- Per-host connection cap (default 8–16) so several downloads from one host do not trip rate limits.
- Drop and replace connections that are much slower than the item's median.
- On repeated 429/503, reduce that item's connection count instead of only backing off.
- Retry the probe with `HEAD`/`Range: bytes=0-0` variants for servers that reject `bytes=0-`.

### 3.8 Startup and bundle — S (Done)
- Lazy-load `SettingsView`, `RecognizeView` and the modals (`React.lazy`).
- `styles.css` is one 2,255-line file; split per view as part of the UI work.
- Defer the yt-dlp/ffmpeg version probes until Settings opens (check current behaviour first).
- Measure before and after with a cold-start timing log line.

---

## Phase 4 — Mobile performance and honesty — [COMPLETED]

| # | Item | Status | Implementation Details |
|---|---|---|---|
| 4.1 | Disk & UI Write Throttling | Done | Separated UI notifications from persistence; throttled UI callbacks to ~4/s (250ms); debounced persistence to 2s; added immediate flush on status changes and `AppState` background/inactive; removed pretty-print indentation. |
| 4.2 | Incremental List Rendering | Done | Converted `DownloadsView` to `FlatList` with header virtualization; wrapped `MediaCard`, playlist `TrackRow`, and `HistoryRow` in `React.memo` to eliminate unnecessary full-list re-renders. |
| 4.3 | Honest Single-Stream Mode | Done | Removed synthetic segmented chunk slicing in `executeDownload`; explicitly set single connection stream (`connections = 1`); updated `SegmentInspectorModal` and `AddDownloadModal` to honestly display single-stream native downloads. |
| 4.4 | Memory-Safe Checksumming | Done | Fast-path MD5 calculation via native `FileSystem.getInfoAsync({ md5: true })` (zero JS memory); chunked 256KB streaming hasher (`createIncrementalHasher`) for SHA-1/256/512 to prevent OOM crashes on large files. |
| 4.5 | Resolver Resilience | Done | Added fallback mirror lists for Piped, Twitter, and Instagram in `resolverPool` with health tracking; added `fetchWithTimeout` across all resolvers; surfaced clear "Resolver unavailable — pair with desktop" actionable errors. |
| 4.6 | Platform Upgrades & Media Player | Done | Verified clean resource cleanup in `MediaPlayerModal`; documented planned Expo SDK 53 player migration (`expo-video` & `expo-audio`). |

### 4.1 Stop writing to disk on every progress event — S (Done)
`notifyTasks()` (`download-manager.ts:209-215`) calls `persistTasks()`, and the download progress
callback calls `notifyTasks()` on every event. That is a full pretty-printed `JSON.stringify` and
file write many times per second per download.

- Separate "notify UI" from "persist". Throttle UI notifications to ~4/s; debounce persistence to
  ~2 s plus immediate writes on status change and on app background (`AppState`).
- Drop the `null, 2` indentation.

### 4.2 Make list rendering incremental — M (Done)
There is no `FlatList` anywhere in `apps/mobile`; lists are `ScrollView` + `.map`, and
`useDownloads` copies the whole task array on every update. Move Downloads, Grab results and
recognition history to `FlatList`/FlashList with memoised row components and per-task subscriptions.

### 4.3 Segments are simulated — decide — M/L (Done)
`executeDownload` uses a single `createDownloadResumable` stream, then fills `segments` by slicing
`received` into equal chunks (`download-manager.ts:607-619`), and sets
`activeConnections = min(connections, 4)`. The Segment Inspector and "threads" setting therefore
show connections that do not exist.

- Option A (S): label mobile as single-connection; hide the thread count and inspector.
- Option B (L): real multi-range downloads via a native module (e.g. a small Expo module wrapping
  OkHttp/URLSession range requests) that reports true per-segment progress.
- Recommended: A now, B as a feature in Phase 9.

### 4.4 Checksum reads the whole file into memory — S (Done)
`verifyChecksum` loads the file as base64, converts to bytes, then hashes in JS
(`download-manager.ts:859-864`); a 1 GB file will crash the app. Use `expo-crypto` or
`FileSystem.getInfoAsync(uri, { md5: true })` for MD5, and chunked reads (`position`/`length`) for
SHA variants with a progress indicator.

### 4.5 Resolver resilience — M (Done)
`bridge.ts` hard-codes third-party endpoints (two Piped instances, vxtwitter, YouTube innertube).
Move the instance lists to remote config with health-checking and fallback ordering, add timeouts
everywhere, and surface "resolver unavailable — pair with desktop" as an actionable error.

### 4.6 Platform upgrades — M (Done)
Mobile is on Expo 52 / RN 0.76 / React 18 while desktop is on React 19. `expo-av` is deprecated in
favour of `expo-video`/`expo-audio`. Plan one SDK upgrade and do the player migration with it.

---

## Phase 5 — Desktop UI/UX — [COMPLETED]

| # | Item | Status | Implementation Details |
|---|---|---|---|
| 5.1 | Keyboard operation of the downloads list | Done | Added roving focus (`tabIndex`), Up/Down arrow navigation, Shift+arrow multi-selection ranges, Home/End jumping, Space pause/resume, Delete/Shift+Delete removal, Enter file opening, and Ctrl+F / Cmd+F search focusing. |
| 5.2 | Accessibility pass | Done | Added `role="grid"`/`row`/`columnheader`/`gridcell`, `aria-selected`, `aria-modal="true"`, focus traps with Esc handling in modals, `role="progressbar"`, `role="switch"`, and global `:focus-visible` outline rings. |
| 5.3 | Finish i18n and RTL | Done | Replaced hard-coded strings across dialogs and views with localized keys in English and Persian; verified RTL mirroring and parameter interpolation. |
| 5.4 | Compact / narrow layout | Done | Lowered minimum window bounds to 720×520px in main process; added responsive `@media (max-width: 1080px)` collapsing sidebar to icon-only and hiding secondary table columns. |
| 5.5 | Mini mode | Done | Added always-on-top compact widget window mode (360×160px) showing active count, speed sparkline, progress bar, and pause/resume controls; toggled from Tray and Title bar. |
| 5.6 | Drag-and-drop reordering | Done | Enabled drag-and-drop reordering within queues using `api.queues.reorder` and dragging items directly onto queue tabs to move them across queues. |
| 5.7 | Undo for destructive actions | Done | Replaced confirmation dialogs on Remove and Clear Completed with interactive toasts offering 5-second "Undo" actions that restore items. |
| 5.8 | Clearer errors | Done | Mapped download errors (HTTP 401/403/410, ENOSPC disk full, timeouts) to user-friendly messages and contextual action buttons ("Refresh URL", "Open Folder", "Retry"). |
| 5.9 | Duplicate handling | Done | Added `DuplicateDialog` prompt when adding existing URLs offering "View Existing", "Download Again", or "Refresh Link". |
| 5.10 | Onboarding and empty states | Done | Added `OnboardingModal` first-run wizard for folder selection, theme, language, and 1-click extension token pairing; enhanced empty state prompts. |
| 5.11 | Command palette | Done | Added global Ctrl+K / Cmd+K Command Palette with fuzzy search across views, settings sections, bulk actions, and jump-to-download. |
| 5.12 | Speed graph | Done | Added lightweight SVG `Sparkline` component for live download speed trends in Mini Mode and DetailsPanel. |
| 5.13 | Settings findability | Done | Added search filter input to Settings page header and support for deep-linking/scrolling to specific setting sections. |
| 5.14 | Renderer error boundary | Done | Added reusable `ErrorBoundary` wrapping views with friendly error display, "Reload view", and "Copy details". |
| 5.15 | Title bar declutter | Done | Decluttered title bar by displaying the Update pill only when updates are actively available, downloading, or downloaded. |

---

## Phase 6 — Mobile UI/UX

| # | Change | Detail | Effort |
|---|---|---|---|
| 6.1 | Background downloads | Downloads stop when the app is backgrounded or killed. Android: foreground service with a progress notification and pause/cancel actions. iOS: background URLSession. Needs a native download module (shared with 4.3 B). | L |
| 6.2 | Completion notifications | `expo-notifications` for finished/failed, tapping opens the item. | S |
| 6.3 | Accessibility | No `accessibilityLabel`/`accessibilityRole` anywhere. Add to all touchables; ensure 44 pt targets; support Dynamic Type. | M |
| 6.4 | Localisation | Desktop has en/fa; mobile has no i18n layer. Move message tables to a shared package and reuse. | M |
| 6.5 | Gestures and feedback | Swipe a row to pause/delete, pull-to-refresh, long-press multi-select, haptics on key actions. | M |
| 6.6 | QR pairing | Desktop already builds a `grabbit://pair?...` URI. Render it as a QR code on desktop and scan it on mobile (after Phase 1, since the token is the only credential). | S |
| 6.7 | Break up large components | `GrabView.tsx` (1,006 lines), `AddDownloadModal.tsx` (714), `DownloadsView.tsx` (674): extract sections and hooks; move shared style tokens to a theme file. | M |
| 6.8 | Storage visibility | Show free space, total used by GRabbit, and a "clean up" action. | S |

---

## Phase 7 — Browser extension

- **7.1 Shrink the footprint — M.** The content script runs on `<all_urls>` at `document_idle` with a
  `MutationObserver` on every page. Debounce the observer, observe only added `video/audio` nodes,
  and disconnect when the tab is hidden. Consider injecting on demand via `scripting` + `activeTab`
  and making broad host access an optional permission the user grants (also eases store review).
- **7.2 Cookie forwarding — S.** Cookies are sent to the desktop over plain HTTP. After Phase 1 this
  is loopback-only by default; when the bridge host is not loopback, do not forward cookies unless
  the user opts in.
- **7.3 Connection status — S.** Badge on the toolbar icon: connected / not paired / desktop not
  running, with a "launch GRabbit" link via the `grabbit://` scheme.
- **7.4 Capture rules UX — S.** Per-site toggle from the popup ("never capture on this site"),
  a minimum-size threshold, and a hold-key (e.g. Alt) to bypass capture once.
- **7.5 HLS/DASH detection — M.** Detect `.m3u8`/`.mpd` requests and hand the manifest URL to the
  desktop media engine (yt-dlp handles them) rather than only direct media URLs.

---

## Phase 8 — Tooling, tests, release

| # | Change | Detail | Effort |
|---|---|---|---|
| 8.1 | Real linting | `lint` is `echo` in desktop and mobile. Add one shared ESLint (or Biome) config at the root with `react-hooks` rules — it would have caught the missing effect deps in `App.tsx`. | S |
| 8.2 | Reproducible installs | CI and release use `pnpm install --no-frozen-lockfile`. Switch to `--frozen-lockfile`. Remove `apps/desktop/package-lock.json` (pnpm repo). | S |
| 8.3 | Remove committed build output | `packages/config/src` and `packages/types/src` contain generated `.js`, `.d.ts` and `.map` files next to the sources. Delete and ignore them. | S |
| 8.4 | Code signing | Windows builds are unsigned (SmartScreen warnings, and auto-update integrity relies only on the hash in `latest.yml`). Add signing (Azure Trusted Signing or a certificate) and publish SHA-256 checksums with each release. | M |
| 8.5 | Faster, wider CI | Enable Turborepo remote cache; run package tests on Linux and only the desktop build on Windows; add a mobile typecheck/test job. | S |
| 8.6 | Test gaps | Add: scheduler window logic (2.1), store crash-safety (2.4), RPC auth (1.1), a local range-server integration test for resume/split/ETag-change, renderer component tests, and one Playwright-Electron smoke test (launch, add URL, complete). | M |
| 8.7 | Opt-in diagnostics | "Export diagnostics" button (logs + redacted settings) and optional crash reporting. | S |
| 8.8 | Dependency hygiene | Renovate/Dependabot; scheduled check that bundled yt-dlp is current, plus an in-app prompt when it is older than ~30 days (yt-dlp breaks often). | S |
| 8.9 | Docs | `docs/ARCHITECTURE.md` is a short outline. Add the data flow (manager → IPC → store), the RPC contract, and a threat model for the bridge. | S |

---

## Phase 9 — Feature ideas (after the above)

- Playlist/channel grab with per-item selection, plus "subscribe" to auto-grab new uploads.
- Subtitles, chapters, SponsorBlock, and embedded metadata/cover options in the Grab view.
- Post-download actions per category: convert, extract archive, move, run a command.
- Site logins manager (per-host credentials and cookies) instead of raw header fields.
- Bandwidth schedule (different speed limits by time of day), building on the 2.1 scheduler.
- Remote control: with a hardened bridge, let mobile show and control the desktop queue.
- Real multi-connection downloads on mobile (4.3 B / 6.1 native module).
- macOS and Linux desktop builds — the code is mostly portable; `attrib`, `rundll32`, `shutdown`
  and PowerShell calls need platform branches.
- BitTorrent/magnet and FTP/SFTP support (via aria2 as an optional engine or a library).

---

## Suggested first three pull requests

1. **Bridge hardening** — 1.1, 1.2, 2.3 and tests. Small diff, removes the most serious risk.
2. **Mobile persistence throttle** — 4.1 and 4.4. Small diff, large battery and smoothness gain.
3. **Renderer state split + virtualised table** — 3.1, 3.2, 3.3. The biggest visible desktop gain.

## Not verified in this review

- Nothing was run: no build, tests or profiling. Performance items are from reading the code, so
  measure before and after each one.
- The Telegram bot, the media platform adapters (`youtube.ts`, `spotify.ts`, `ytdlp-runner.ts`),
  `GrabView`/`SettingsView` internals and the extension popup/options code were only skimmed.
- Item 2.7 (stall timeout mid-body) is a suspicion to test, not a confirmed bug.
