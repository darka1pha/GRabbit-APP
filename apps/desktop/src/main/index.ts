import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Notification, shell, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, type AppSettings, type ClipboardLink, type DownloadItem } from '../shared/types';
import { initLogger, logger } from './logger';
import { SettingsService } from './settings';
import { DownloadManager } from './downloads/manager';
import { configureHttpProxy } from './downloads/http-client';
import { PlatformRouter } from './media/router';
import { MusicRecognizer } from './media/recognizer';
import { setMediaConfig } from './media/config';
import { resolveBinaries, resourcePath } from './paths';
import { ClipboardWatcher } from './clipboard-watcher';
import { DesktopRpcBridge } from './rpc-bridge';
import { AutoUpdaterService } from './updater';
import { GrabPillManager } from './grab-pill';
import { registerIpc } from './ipc';

const APP_ID = 'com.grabbit.desktop';
const TITLE_BAR_HEIGHT = 40;

// Separate profile (portable use, testing): GRABBIT_DATA_DIR=<folder>
if (process.env.GRABBIT_DATA_DIR) app.setPath('userData', process.env.GRABBIT_DATA_DIR);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId(APP_ID);

const dataDir = app.getPath('userData');
const tempRoot = join(dataDir, 'temp');
initLogger(join(dataDir, 'logs'));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const settings = new SettingsService(dataDir);
const router = new PlatformRouter();
const recognizer = new MusicRecognizer();

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function appIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(resourcePath('icon.png'));
}

function showWindow(view?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (view) send(IPC.navigate, view);
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!settings.get().notifications || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: appIcon(), silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

// ---------------------------------------------------------------- binaries / media config

function applyMediaConfig(s: AppSettings): void {
  const bins = resolveBinaries();
  setMediaConfig({
    ytdlpPath: bins.ytdlp,
    ffmpegPath: bins.ffmpeg,
    ffprobePath: bins.ffprobe,
    ffmpegDir: bins.ffmpegDir,
    // Electron doubles as Node: yt-dlp uses it to solve YouTube's JavaScript challenges
    jsRuntime: { path: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
    proxy: s.proxy,
    cookiesFile: s.media.cookiesFile,
    cookiesFromBrowser: s.media.cookiesFromBrowser,
    spotifyClientId: s.media.spotifyClientId,
    spotifyClientSecret: s.media.spotifyClientSecret,
    instagramSessionId: s.media.instagramSessionId,
    tempDir: tempRoot,
  });
}

// ---------------------------------------------------------------- download manager

const fileLabel = (item: DownloadItem) => item.media?.title ?? item.fileName;

const manager = new DownloadManager({
  dataDir,
  tempRoot,
  router,
  getSettings: () => settings.get(),
  onItemsChanged: (items) => send(IPC.downloadsChanged, items),
  onItemsRemoved: (ids) => send(IPC.downloadsRemoved, ids),
  onOrderChanged: (ids) => send(IPC.downloadsOrder, ids),
  onQueuesChanged: (queues) => send(IPC.queuesChanged, queues),
  onCompleted: (item) => {
    const mismatch = item.checksum?.verified === false;
    notify(mismatch ? 'Checksum mismatch' : 'Download complete', fileLabel(item), () => {
      if (item.filePath) shell.showItemInFolder(item.filePath);
    });
  },
  onFailed: (item) => notify('Download failed', `${fileLabel(item)}\n${item.error ?? ''}`.trim(), () => showWindow('downloads')),
  onQueueDrained: () => runAfterQueueAction(),
  onAggregateProgress: ({ fraction, hasError, hasPaused }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (fraction === null) {
      if (hasError) {
        mainWindow.setProgressBar(1, { mode: 'error' });
      } else if (hasPaused) {
        mainWindow.setProgressBar(1, { mode: 'paused' });
      } else {
        mainWindow.setProgressBar(-1);
      }
    } else if (fraction < 0) {
      mainWindow.setProgressBar(2, { mode: 'indeterminate' });
    } else {
      const mode = hasError ? 'error' : hasPaused ? 'paused' : 'normal';
      mainWindow.setProgressBar(Math.min(1, fraction), { mode });
    }
    updateTrayTooltip();
  },
});

function runAfterQueueAction(): void {
  const action = settings.get().afterQueue;
  if (action === 'none') return;
  logger.info({ action }, 'Queue finished: running the after-queue action');
  if (action === 'quit') {
    quitting = true;
    app.quit();
  } else if (action === 'sleep') {
    notify('gRabbit', 'All downloads finished. Putting the PC to sleep.');
    setTimeout(() => spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { windowsHide: true, detached: true }), 5000);
  } else if (action === 'shutdown') {
    notify('gRabbit', 'All downloads finished. Windows will shut down in 60 seconds (run "shutdown /a" to cancel).');
    spawn('shutdown', ['/s', '/t', '60', '/c', 'gRabbit finished all downloads. Run "shutdown /a" to cancel.'], {
      windowsHide: true,
      detached: true,
    });
  }
}

// ---------------------------------------------------------------- clipboard

const clipboardWatcher = new ClipboardWatcher((link: ClipboardLink) => {
  send(IPC.clipboardLink, link);
  const focused = mainWindow?.isFocused();
  if (!focused) {
    notify(link.kind === 'media' ? 'Media link copied' : 'Download link copied', `${link.url}\nClick to grab it with gRabbit.`, () => {
      showWindow(link.kind === 'media' ? 'grab' : 'downloads');
      send(IPC.clipboardLink, link);
    });
  }
});

function syncLoginItemSettings(startOnBoot: boolean, startMinimized: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: startOnBoot,
      args: startMinimized ? ['--hidden'] : [],
      path: process.execPath,
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to set Windows login item settings');
  }
}

// ---------------------------------------------------------------- window & tray

function themeColors(): { background: string; symbol: string } {
  return nativeTheme.shouldUseDarkColors ? { background: '#0f1117', symbol: '#e6e8ef' } : { background: '#f6f7fb', symbol: '#1b1e28' };
}

function applyTheme(): void {
  nativeTheme.themeSource = settings.get().theme;
  const colors = themeColors();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(colors.background);
    try {
      mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT });
    } catch {
      // overlay not available
    }
  }
}

function createWindow(): void {
  const colors = themeColors();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'gRabbit',
    icon: appIcon(),
    backgroundColor: colors.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (!quitting && settings.get().closeToTray && tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links never navigate the app window: open them in the user's browser instead
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function updateTrayTooltip(): void {
  if (!tray) return;
  const active = manager.list().filter((i) => i.status === 'downloading' || i.status === 'starting' || i.status === 'processing');
  tray.setToolTip(active.length > 0 ? `gRabbit: ${active.length} active download${active.length > 1 ? 's' : ''}` : 'gRabbit');
}

function createTray(): void {
  const icon = appIcon().resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('gRabbit');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open gRabbit', click: () => showWindow() },
      { label: 'Quick Grab Pill (Ctrl+Alt+G)', click: () => grabPill.show() },
      { label: 'Grab media…', click: () => showWindow('grab') },
      { label: 'Downloads', click: () => showWindow('downloads') },
      { type: 'separator' },
      { label: 'Resume all', click: () => manager.resumeAll() },
      { label: 'Pause all', click: () => manager.pauseAll() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => showWindow());
}

// ---------------------------------------------------------------- app lifecycle

const rpcBridge = new DesktopRpcBridge({
  manager,
  router,
  settings,
  version: app.getVersion(),
  onDownloadAdded: (item) => {
    notify('Download added from browser', fileLabel(item), () => showWindow('downloads'));
  },
});

const updater = new AutoUpdaterService({
  getSettings: () => settings.get(),
  onStatusChange: (status) => send(IPC.updaterStatus, status),
  notify: (title, body, onClick) => notify(title, body, onClick),
});

const grabPill = new GrabPillManager({
  getAccelerator: () => settings.get().globalShortcut.accelerator,
  isEnabled: () => settings.get().globalShortcut.enabled,
  onOpenMainWithUrl: (url, action) => {
    showWindow(action === 'download' ? 'downloads' : 'grab');
    send(IPC.clipboardLink, { url, kind: action === 'download' ? 'file' : 'media' });
  },
});

app.on('second-instance', () => showWindow());

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  grabPill.destroy();
  clipboardWatcher.setEnabled(false);
  rpcBridge.stop();
  manager.shutdown();
  settings.flush();
});

app.on('window-all-closed', () => {
  if (!settings.get().closeToTray) app.quit();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  mkdirSync(tempRoot, { recursive: true });
  // Leftover recognition samples from a crash
  try {
    for (const entry of readdirSync(tempRoot)) {
      if (entry.startsWith('recognize-')) rmSync(join(tempRoot, entry), { recursive: true, force: true });
    }
  } catch {
    // ignore
  }

  const s = settings.get();
  applyMediaConfig(s);
  configureHttpProxy(s.proxy);
  mkdirSync(s.downloadDir, { recursive: true });

  registerIpc({
    getWindow: () => mainWindow,
    settings,
    manager,
    router,
    recognizer,
    clipboardWatcher,
    refreshBinaries: () => applyMediaConfig(settings.get()),
    appVersion: app.getVersion(),
    dataDir,
    updater,
    grabPill,
  });

  settings.onChange((next, previous) => {
    applyMediaConfig(next);
    if (next.proxy !== previous.proxy) configureHttpProxy(next.proxy);
    if (next.theme !== previous.theme) applyTheme();
    if (next.downloadDir !== previous.downloadDir) mkdirSync(next.downloadDir, { recursive: true });
    if (
      next.extension.enabled !== previous.extension.enabled ||
      next.extension.port !== previous.extension.port
    ) {
      rpcBridge.start();
    }
    if (
      next.startOnBoot !== previous.startOnBoot ||
      next.startMinimized !== previous.startMinimized
    ) {
      syncLoginItemSettings(next.startOnBoot, next.startMinimized);
    }
    if (
      next.globalShortcut.enabled !== previous.globalShortcut.enabled ||
      next.globalShortcut.accelerator !== previous.globalShortcut.accelerator
    ) {
      grabPill.updateShortcut();
    }
    clipboardWatcher.setEnabled(next.clipboardMonitor);
    manager.applySettings(next);
  });

  applyTheme();
  nativeTheme.on('updated', applyTheme);
  createWindow();
  createTray();
  syncLoginItemSettings(s.startOnBoot, s.startMinimized);
  grabPill.init();
  manager.init();
  clipboardWatcher.setEnabled(s.clipboardMonitor);
  rpcBridge.start();

  if (s.updates.autoCheck) {
    setTimeout(() => {
      void updater.checkForUpdates();
    }, 6000);
  }

  logger.info({ version: app.getVersion(), dataDir }, 'gRabbit started');
});
