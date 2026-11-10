import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AppSettings, DeepPartial } from '../shared/types';
import { JsonStore } from './store';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

export function defaultSettings(): AppSettings {
  const locale = typeof app?.getLocale === 'function' ? app.getLocale() : 'en';
  const downloadsPath = typeof app?.getPath === 'function' ? app.getPath('downloads') : '';
  return {
    language: locale.toLowerCase().startsWith('fa') ? 'fa' : 'en',
    theme: 'system',
    downloadDir: downloadsPath ? join(downloadsPath, 'GRabbit') : 'GRabbit',
    categorySubfolders: true,
    maxConcurrent: 3,
    defaultConnections: 8,
    maxRetries: 8,
    globalSpeedLimitKBps: 0,
    clipboardMonitor: true,
    notifications: true,
    closeToTray: true,
    resumeOnStartup: true,
    startOnBoot: false,
    startMinimized: true,
    globalShortcut: {
      enabled: true,
      accelerator: 'CommandOrControl+Alt+G',
    },
    updates: {
      autoCheck: true,
      autoDownload: false,
    },
    userAgent: DEFAULT_USER_AGENT,
    proxy: '',
    afterQueue: 'none',
    scheduler: { enabled: false, startTime: '02:00', stopTime: '08:00' },
    media: {
      defaultAudioFormat: 'mp3',
      defaultVideoQuality: '1080p',
      cookiesFromBrowser: '',
      cookiesFile: '',
      spotifyClientId: '',
      spotifyClientSecret: '',
      instagramSessionId: '',
    },
    extension: {
      enabled: true,
      port: 31542,
      token: randomUUID(),
      autoCapture: true,
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || !(key in base)) continue;
    out[key] = isObject(value) && isObject((base as Record<string, unknown>)[key])
      ? deepMerge((base as Record<string, unknown>)[key], value)
      : value;
  }
  return out as T;
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function sanitize(s: AppSettings): AppSettings {
  const d = defaultSettings();
  return {
    ...s,
    maxConcurrent: clamp(s.maxConcurrent, 1, 16, d.maxConcurrent),
    defaultConnections: clamp(s.defaultConnections, 1, 32, d.defaultConnections),
    maxRetries: clamp(s.maxRetries, 0, 50, d.maxRetries),
    globalSpeedLimitKBps: clamp(s.globalSpeedLimitKBps, 0, 10_000_000, 0),
    downloadDir: s.downloadDir?.trim() || d.downloadDir,
    startOnBoot: typeof s.startOnBoot === 'boolean' ? s.startOnBoot : d.startOnBoot,
    startMinimized: typeof s.startMinimized === 'boolean' ? s.startMinimized : d.startMinimized,
    globalShortcut: {
      enabled: typeof s.globalShortcut?.enabled === 'boolean' ? s.globalShortcut.enabled : d.globalShortcut.enabled,
      accelerator: s.globalShortcut?.accelerator?.trim() || d.globalShortcut.accelerator,
    },
    updates: {
      autoCheck: typeof s.updates?.autoCheck === 'boolean' ? s.updates.autoCheck : d.updates.autoCheck,
      autoDownload: typeof s.updates?.autoDownload === 'boolean' ? s.updates.autoDownload : d.updates.autoDownload,
    },
    userAgent: s.userAgent?.trim() || d.userAgent,
    proxy: s.proxy?.trim() ?? '',
    extension: {
      enabled: typeof s.extension?.enabled === 'boolean' ? s.extension.enabled : true,
      port: clamp(s.extension?.port, 1024, 65535, 31542),
      token: s.extension?.token?.trim() || d.extension.token,
      autoCapture: typeof s.extension?.autoCapture === 'boolean' ? s.extension.autoCapture : true,
    },
  };
}

type Listener = (settings: AppSettings, previous: AppSettings) => void;

export class SettingsService {
  private store: JsonStore<AppSettings>;
  private current: AppSettings;
  private listeners: Listener[] = [];

  constructor(dataDir: string) {
    this.store = new JsonStore<AppSettings>(join(dataDir, 'settings.json'), 300);
    this.current = sanitize(deepMerge(defaultSettings(), this.store.load(defaultSettings())));
  }

  public get(): AppSettings {
    return this.current;
  }

  public update(patch: DeepPartial<AppSettings>): AppSettings {
    const previous = this.current;
    this.current = sanitize(deepMerge(previous, patch));
    this.store.save(() => this.current);
    for (const listener of this.listeners) listener(this.current, previous);
    return this.current;
  }

  public onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  public flush(): void {
    this.store.saveSync(this.current);
  }
}
