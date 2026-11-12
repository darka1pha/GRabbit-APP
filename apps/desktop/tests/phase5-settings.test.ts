import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, SettingsService } from '../src/main/settings';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock electron for Node vitest environment
vi.mock('electron', () => ({
  app: {
    getLocale: () => 'en-US',
    getPath: (name: string) => (name === 'downloads' ? '/mock/downloads' : '/mock/userData'),
    getVersion: () => '1.0.0',
    isPackaged: false,
    setLoginItemSettings: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}));

describe('Phase 5 — Desktop Settings & Onboarding', () => {
  describe('5.10 Onboarding and Settings persistence', () => {
    it('includes onboarded default false and allows updating to true', () => {
      const defaults = defaultSettings();
      expect(defaults.onboarded).toBe(false);

      const tempDir = mkdtempSync(join(tmpdir(), 'grabbit-p5-onboarding-'));
      try {
        const svc = new SettingsService(tempDir);
        expect(svc.get().onboarded).toBe(false);

        const updated = svc.update({ onboarded: true });
        expect(updated.onboarded).toBe(true);
        expect(svc.get().onboarded).toBe(true);
      } finally {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    });
  });
});

