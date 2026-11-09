import * as FileSystem from 'expo-file-system';
import { DeepPartial } from '@grabbit/types';

export interface MobileSettings {
  theme: 'system' | 'light' | 'dark';
  language: 'en' | 'fa';
  maxConcurrent: number;
  defaultConnections: number;
  globalSpeedLimitKBps: number;
  categorySubfolders: boolean;
  autoSaveToLibrary: boolean;
  defaultAudioFormat: 'mp3' | 'm4a' | 'flac';
  defaultVideoQuality: string;
  desktopBridge: {
    enabled: boolean;
    host: string;
    port: number;
    token: string;
  };
  scheduler: {
    enabled: boolean;
    startTime: string;
    stopTime: string;
  };
}

const DEFAULT_SETTINGS: MobileSettings = {
  theme: 'dark',
  language: 'en',
  maxConcurrent: 2,
  defaultConnections: 4,
  globalSpeedLimitKBps: 0,
  categorySubfolders: true,
  autoSaveToLibrary: false,
  defaultAudioFormat: 'mp3',
  defaultVideoQuality: '1080p',
  desktopBridge: {
    enabled: false,
    host: '192.168.1.100',
    port: 31542,
    token: '',
  },
  scheduler: {
    enabled: false,
    startTime: '02:00',
    stopTime: '08:00',
  },
};

type SettingsListener = (settings: MobileSettings) => void;

class MobileSettingsManager {
  private settings: MobileSettings = { ...DEFAULT_SETTINGS };
  private listeners: Set<SettingsListener> = new Set();
  private loaded = false;

  private getFilePath(): string {
    return `${FileSystem.documentDirectory || FileSystem.cacheDirectory}grabbit_settings.json`;
  }

  async loadSettings(): Promise<MobileSettings> {
    if (this.loaded) return this.settings;
    try {
      const path = this.getFilePath();
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(path);
        const parsed = JSON.parse(raw);
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          desktopBridge: { ...DEFAULT_SETTINGS.desktopBridge, ...(parsed.desktopBridge || {}) },
          scheduler: { ...DEFAULT_SETTINGS.scheduler, ...(parsed.scheduler || {}) },
        };
      }
    } catch (err) {
      console.warn('Failed to load mobile settings:', err);
    }
    this.loaded = true;
    this.notify();
    return this.settings;
  }

  getSettings(): MobileSettings {
    return this.settings;
  }

  async updateSettings(patch: DeepPartial<MobileSettings>): Promise<MobileSettings> {
    this.settings = {
      ...this.settings,
      ...patch,
      desktopBridge: patch.desktopBridge
        ? { ...this.settings.desktopBridge, ...patch.desktopBridge }
        : this.settings.desktopBridge,
      scheduler: patch.scheduler
        ? { ...this.settings.scheduler, ...patch.scheduler }
        : this.settings.scheduler,
    } as MobileSettings;

    this.notify();
    await this.persist();
    return this.settings;
  }

  private async persist() {
    try {
      const path = this.getFilePath();
      await FileSystem.writeAsStringAsync(path, JSON.stringify(this.settings, null, 2));
    } catch (err) {
      console.warn('Failed to persist mobile settings:', err);
    }
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    listener(this.settings);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.settings);
    }
  }
}

export const mobileSettingsManager = new MobileSettingsManager();

