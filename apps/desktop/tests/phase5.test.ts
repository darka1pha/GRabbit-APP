import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: {
    getLocale: () => 'en-US',
    getPath: (name: string) => (name === 'downloads' ? '/mock/downloads' : '/mock/userData'),
    getVersion: () => '1.0.0',
    isPackaged: false,
    setLoginItemSettings: vi.fn(),
  },
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
  clipboard: {
    readText: vi.fn(async () => 'https://example.com/test'),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    setPosition: vi.fn(),
    center: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
    destroy: vi.fn(),
  })),
}));

vi.mock('electron-updater', () => {
  return {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: true,
      logger: null,
      on: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    },
  };
});

import { defaultSettings, deepMerge, SettingsService } from '../src/main/settings';
import { AutoUpdaterService } from '../src/main/updater';
import { GrabPillManager } from '../src/main/grab-pill';

describe('Phase 5: Desktop Polish & Windows 11 Native Integration', () => {
  describe('Settings Integration', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'grabbit-p5-test-'));
      return () => {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      };
    });

    it('provides sensible Windows 11 defaults', () => {
      const d = defaultSettings();
      expect(d.startOnBoot).toBe(false);
      expect(d.startMinimized).toBe(true);
      expect(d.globalShortcut).toEqual({
        enabled: true,
        accelerator: 'CommandOrControl+Alt+G',
      });
      expect(d.updates).toEqual({
        autoCheck: true,
        autoDownload: false,
      });
    });

    it('persists and updates startup and shortcut settings', () => {
      const svc = new SettingsService(tempDir);
      expect(svc.get().startOnBoot).toBe(false);
      expect(svc.get().globalShortcut.enabled).toBe(true);

      const updated = svc.update({
        startOnBoot: true,
        startMinimized: false,
        globalShortcut: {
          enabled: false,
          accelerator: 'CommandOrControl+Shift+G',
        },
        updates: {
          autoCheck: false,
          autoDownload: true,
        },
      });

      expect(updated.startOnBoot).toBe(true);
      expect(updated.startMinimized).toBe(false);
      expect(updated.globalShortcut.enabled).toBe(false);
      expect(updated.globalShortcut.accelerator).toBe('CommandOrControl+Shift+G');
      expect(updated.updates.autoCheck).toBe(false);
      expect(updated.updates.autoDownload).toBe(true);
    });

    it('deep-merges partial shortcut and updates config without resetting peers', () => {
      const base = defaultSettings();
      const patched = deepMerge(base, {
        globalShortcut: { enabled: false },
        updates: { autoDownload: true },
      });

      expect(patched.globalShortcut.enabled).toBe(false);
      expect(patched.globalShortcut.accelerator).toBe('CommandOrControl+Alt+G');
      expect(patched.updates.autoCheck).toBe(true);
      expect(patched.updates.autoDownload).toBe(true);
    });
  });

  describe('AutoUpdaterService', () => {
    it('initializes in idle state and reports current version', () => {
      const notifyMock = vi.fn();
      const statusChangeMock = vi.fn();

      const updater = new AutoUpdaterService({
        getSettings: () => defaultSettings(),
        onStatusChange: statusChangeMock,
        notify: notifyMock,
      });

      const initialStatus = updater.getStatus();
      expect(initialStatus.state).toBe('idle');
      expect(initialStatus.version).toBeDefined();
    });

    it('handles unpackaged environment gracefully without errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: 'v1.0.0' }),
      } as Response);
      const statusChangeMock = vi.fn();
      const updater = new AutoUpdaterService({
        getSettings: () => defaultSettings(),
        onStatusChange: statusChangeMock,
        notify: vi.fn(),
      });

      const res = await updater.checkForUpdates();
      expect(res.state).toBe('not-available');
      expect(statusChangeMock).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'not-available' })
      );
    });
  });

  describe('GrabPillManager submit delegation', () => {
    it('delegates grab submission to main window callback with grab action', () => {
      const onOpenMock = vi.fn();
      const manager = new GrabPillManager({
        getAccelerator: () => 'CommandOrControl+Alt+G',
        isEnabled: () => true,
        onOpenMainWithUrl: onOpenMock,
      });

      manager.submit('https://youtube.com/watch?v=12345', 'grab');
      expect(onOpenMock).toHaveBeenCalledWith('https://youtube.com/watch?v=12345', 'grab');
    });

    it('delegates direct file download to main window callback with download action', () => {
      const onOpenMock = vi.fn();
      const manager = new GrabPillManager({
        getAccelerator: () => 'CommandOrControl+Alt+G',
        isEnabled: () => true,
        onOpenMainWithUrl: onOpenMock,
      });

      manager.submit('https://example.com/archive.zip', 'download');
      expect(onOpenMock).toHaveBeenCalledWith('https://example.com/archive.zip', 'download');
    });
  });
});
