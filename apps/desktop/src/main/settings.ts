import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AppSettings, DeepPartial } from '../shared/types';
import { JsonStore } from './store';
import { logger } from './logger';

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
    onboarded: false,
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
    scheduler: { enabled: false, startTime: '02:00', stopTime: '08:00', days: [] },
    automation: {
      autoExtractArchives: false,
      extractToSubfolder: true,
      deleteArchiveAfterExtraction: false,
      customCommand: '',
      playCompletionSound: true,
    },
    speedSchedule: {
      enabled: false,
      startTime: '08:00',
      stopTime: '22:00',
      speedLimitKBps: 500,
      days: [],
    },
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
      allowLan: false,
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
    automation: {
      autoExtractArchives: typeof s.automation?.autoExtractArchives === 'boolean' ? s.automation.autoExtractArchives : false,
      extractToSubfolder: typeof s.automation?.extractToSubfolder === 'boolean' ? s.automation.extractToSubfolder : true,
      deleteArchiveAfterExtraction: typeof s.automation?.deleteArchiveAfterExtraction === 'boolean' ? s.automation.deleteArchiveAfterExtraction : false,
      customCommand: s.automation?.customCommand?.trim() ?? '',
      playCompletionSound: typeof s.automation?.playCompletionSound === 'boolean' ? s.automation.playCompletionSound : true,
    },
    speedSchedule: {
      enabled: typeof s.speedSchedule?.enabled === 'boolean' ? s.speedSchedule.enabled : false,
      startTime: s.speedSchedule?.startTime?.trim() || '08:00',
      stopTime: s.speedSchedule?.stopTime?.trim() || '22:00',
      speedLimitKBps: clamp(s.speedSchedule?.speedLimitKBps ?? 500, 0, 10_000_000, 500),
      days: Array.isArray(s.speedSchedule?.days) ? s.speedSchedule.days : [],
    },
    extension: {
      enabled: typeof s.extension?.enabled === 'boolean' ? s.extension.enabled : true,
      port: clamp(s.extension?.port, 1024, 65535, 31542),
      token: s.extension?.token?.trim() || d.extension.token,
      autoCapture: typeof s.extension?.autoCapture === 'boolean' ? s.extension.autoCapture : true,
      allowLan: typeof s.extension?.allowLan === 'boolean' ? s.extension.allowLan : false,
    },
  };
}

/** Encrypts the few settings that are credentials before they are written to disk. */
export interface SecretCodec {
  available(): boolean;
  /** Returns text safe to store in JSON. */
  encrypt(plain: string): string;
  decrypt(stored: string): string;
}

/** OS-backed encryption (DPAPI on Windows), tied to the current Windows user. Usable once the app is ready. */
export const osSecretCodec: SecretCodec = {
  available: () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64')),
};

const ENCRYPTED_PREFIX = 'enc:v1:';

/** The settings that are credentials. */
const SECRETS = [
  {
    get: (s: AppSettings) => s.extension.token,
    set: (s: AppSettings, v: string): AppSettings => ({ ...s, extension: { ...s.extension, token: v } }),
  },
  {
    get: (s: AppSettings) => s.media.spotifyClientSecret,
    set: (s: AppSettings, v: string): AppSettings => ({ ...s, media: { ...s.media, spotifyClientSecret: v } }),
  },
  {
    get: (s: AppSettings) => s.media.instagramSessionId,
    set: (s: AppSettings, v: string): AppSettings => ({ ...s, media: { ...s.media, instagramSessionId: v } }),
  },
];

type Listener = (settings: AppSettings, previous: AppSettings) => void;

export class SettingsService {
  private store: JsonStore<AppSettings>;
  private current: AppSettings;
  private listeners: Listener[] = [];

  constructor(
    dataDir: string,
    private readonly codec: SecretCodec = osSecretCodec
  ) {
    this.store = new JsonStore<AppSettings>(join(dataDir, 'settings.json'), 300);
    this.current = sanitize(deepMerge(defaultSettings(), this.store.load(defaultSettings())));
  }

  /**
   * Decrypts the stored credentials. Call once the app is ready (OS encryption is not usable
   * earlier) and before anything reads a credential. Settings files written by older versions
   * hold them as plain text; those are rewritten encrypted.
   */
  public unlockSecrets(): void {
    let next = this.current;
    let hadPlainText = false;
    for (const secret of SECRETS) {
      const stored = secret.get(next);
      if (!stored) continue;
      if (!stored.startsWith(ENCRYPTED_PREFIX)) {
        hadPlainText = true;
        continue;
      }
      try {
        next = secret.set(next, this.codec.decrypt(stored.slice(ENCRYPTED_PREFIX.length)));
      } catch (err) {
        // Another Windows user or machine wrote this file: the value cannot be recovered
        logger.warn({ err }, 'A stored credential could not be decrypted and was cleared');
        next = secret.set(next, '');
      }
    }
    // sanitize() issues a fresh bridge token if the old one was lost
    this.current = sanitize(next);
    if (hadPlainText && this.codec.available()) this.store.save(() => this.forDisk());
  }

  /** The settings as written to disk: credentials encrypted when the OS can do it. */
  private forDisk(): AppSettings {
    if (!this.codec.available()) return this.current;
    let out = this.current;
    for (const secret of SECRETS) {
      const value = secret.get(out);
      if (value && !value.startsWith(ENCRYPTED_PREFIX)) out = secret.set(out, ENCRYPTED_PREFIX + this.codec.encrypt(value));
    }
    return out;
  }

  public get(): AppSettings {
    return this.current;
  }

  public update(patch: DeepPartial<AppSettings>): AppSettings {
    const previous = this.current;
    this.current = sanitize(deepMerge(previous, patch));
    this.store.save(() => this.forDisk());
    for (const listener of this.listeners) listener(this.current, previous);
    return this.current;
  }

  public onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  public flush(): void {
    this.store.saveSync(this.forDisk());
  }
}
