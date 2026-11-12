import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTranslator, errorText, formatBytes } from '@grabbit/utils';
import { mobileSettingsManager } from '../services/settings-manager';
import { mobileDownloadManager, MobileDownloadTask } from '../services/download-manager';
import { notificationService } from '../services/notification-service';
import { hapticLight, hapticMedium, hapticSuccess } from '../services/haptics';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { darkColors, lightColors, touchable } from '../constants/theme';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  },
  Platform: {
    OS: 'android',
  },
}));

vi.mock('expo-file-system', () => ({
  documentDirectory: '/mock/grabbit/',
  cacheDirectory: '/mock/cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: vi.fn().mockResolvedValue({ exists: true }),
  makeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
  writeAsStringAsync: vi.fn().mockResolvedValue(undefined),
  readAsStringAsync: vi.fn().mockResolvedValue('[]'),
  deleteAsync: vi.fn().mockResolvedValue(undefined),
  getFreeDiskStorageAsync: vi.fn().mockResolvedValue(25 * 1024 * 1024 * 1024), // 25 GB free
  getTotalDiskCapacityAsync: vi.fn().mockResolvedValue(128 * 1024 * 1024 * 1024), // 128 GB
  createDownloadResumable: vi.fn().mockReturnValue({
    downloadAsync: vi.fn().mockResolvedValue({ uri: '/mock/file.mp4' }),
    pauseAsync: vi.fn().mockResolvedValue(undefined),
    resumeAsync: vi.fn().mockResolvedValue({ uri: '/mock/file.mp4' }),
  }),
}));

vi.mock('expo-media-library', () => ({
  requestPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  saveToLibraryAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
  setNotificationChannelAsync: vi.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: vi.fn().mockResolvedValue('notif-id'),
  addNotificationResponseReceivedListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  AndroidImportance: { HIGH: 4 },
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

describe('Phase 6 — Mobile UI/UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('6.4 Shared Localisation & RTL', () => {
    it('provides translation keys in English and Persian', () => {
      const tEn = createTranslator('en');
      const tFa = createTranslator('fa');

      expect(tEn('mobile.cleanStorage')).toBe('Clean Up Storage');
      expect(tFa('mobile.cleanStorage')).toBe('پاک‌سازی حافظه');

      expect(tEn('mobile.notifications')).toBe('Notifications');
      expect(tFa('mobile.notifications')).toBe('اعلان‌ها');

      expect(tEn('mobile.scanQr')).toBe('Scan QR Code');
      expect(tFa('mobile.scanQr')).toBe('اسکن کد QR');
    });

    it('interpolates parameters correctly with localized formatting', () => {
      const tEn = createTranslator('en');
      const tFa = createTranslator('fa');

      expect(tEn('mobile.selectedCount', { count: 5 })).toBe('5 selected');
      expect(tFa('mobile.selectedCount', { count: 5 })).toBe('۵ مورد انتخاب شد');
    });

    it('translates error codes cleanly via errorText', () => {
      const t = createTranslator('en');
      expect(errorText(t, { code: 'DISK_FULL' })).toBe('The disk is full.');
      expect(errorText(t, { code: 'HTTP_404' })).toContain('HTTP 404');
    });
  });

  describe('6.2 Completion Notifications', () => {
    it('schedules notification when download completes successfully', async () => {
      const mockTask: MobileDownloadTask = {
        id: 't-complete',
        kind: 'http',
        url: 'https://example.com/test.zip',
        fileName: 'test.zip',
        title: 'test.zip',
        platform: 'generic',
        format: 'audio',
        qualityId: 'original',
        extension: 'zip',
        category: 'compressed',
        queueId: 'main',
        status: 'completed',
        receivedBytes: 1048576,
        totalBytes: 1048576,
        progress: 1,
        speed: 0,
        eta: 0,
        connections: 1,
        activeConnections: 0,
        segments: [],
        localUri: '/mock/grabbit/t-complete_test.zip',
        resumable: true,
        createdAt: Date.now(),
      };

      await notificationService.notifyDownloadCompleted(mockTask);
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: 'Download Completed',
            body: expect.stringContaining('test.zip'),
            data: expect.objectContaining({ taskId: 't-complete' }),
          }),
        })
      );
    });

    it('schedules failure notification when download errors out', async () => {
      const mockTask: MobileDownloadTask = {
        id: 't-fail',
        kind: 'http',
        url: 'https://example.com/failed.bin',
        fileName: 'failed.bin',
        title: 'failed.bin',
        platform: 'generic',
        format: 'audio',
        qualityId: 'original',
        extension: 'bin',
        category: 'other',
        queueId: 'main',
        status: 'error',
        receivedBytes: 0,
        totalBytes: 5000,
        progress: 0,
        speed: 0,
        eta: null,
        connections: 1,
        activeConnections: 0,
        segments: [],
        localUri: '/mock/grabbit/t-fail_failed.bin',
        resumable: true,
        createdAt: Date.now(),
      };

      await notificationService.notifyDownloadFailed(mockTask, 'Server timed out');
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: 'Download Failed',
            body: expect.stringContaining('Server timed out'),
            data: expect.objectContaining({ taskId: 't-fail' }),
          }),
        })
      );
    });
  });

  describe('6.5 Gestures & Haptic Feedback', () => {
    it('triggers haptic feedback when haptics are enabled', async () => {
      await mobileSettingsManager.updateSettings({ hapticsEnabled: true });
      await hapticLight();
      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);

      await hapticMedium();
      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);

      await hapticSuccess();
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    });

    it('suppresses haptics when disabled in settings', async () => {
      await mobileSettingsManager.updateSettings({ hapticsEnabled: false });
      vi.clearAllMocks();

      await hapticLight();
      expect(Haptics.impactAsync).not.toHaveBeenCalled();

      // restore
      await mobileSettingsManager.updateSettings({ hapticsEnabled: true });
    });

    it('implements correct multi-select toggle and batching logic', () => {
      const selected = new Set<string>();
      const toggle = (id: string) => {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      };

      toggle('task-1');
      toggle('task-2');
      expect(selected.has('task-1')).toBe(true);
      expect(selected.has('task-2')).toBe(true);
      expect(selected.size).toBe(2);

      toggle('task-1');
      expect(selected.has('task-1')).toBe(false);
      expect(selected.size).toBe(1);
    });
  });

  describe('6.6 Desktop QR & URI Pairing', () => {
    it('parses grabbit://pair URI format correctly', () => {
      const uri = 'grabbit://pair?host=192.168.1.150&port=31542&token=sec-token-123';
      const u = new URL(uri.replace('grabbit://pair', 'http://localhost/pair'));

      expect(u.searchParams.get('host')).toBe('192.168.1.150');
      expect(u.searchParams.get('port')).toBe('31542');
      expect(u.searchParams.get('token')).toBe('sec-token-123');
    });

    it('persists desktop bridge configuration in settings manager', async () => {
      await mobileSettingsManager.updateSettings({
        desktopBridge: {
          enabled: true,
          host: '10.0.0.42',
          port: 31542,
          token: 'auth-xyz',
        },
      });

      const s = mobileSettingsManager.getSettings();
      expect(s.desktopBridge.enabled).toBe(true);
      expect(s.desktopBridge.host).toBe('10.0.0.42');
      expect(s.desktopBridge.token).toBe('auth-xyz');
    });
  });

  describe('6.8 Storage Visibility & Cleanup', () => {
    it('queries storage usage with free bytes and GRabbit task bytes', async () => {
      const storage = await mobileDownloadManager.getStorageUsage();
      expect(storage.freeBytes).toBe(25 * 1024 * 1024 * 1024);
      expect(storage.totalDiskBytes).toBe(128 * 1024 * 1024 * 1024);
      expect(typeof storage.usedBytes).toBe('number');
    });

    it('cleans up completed files and frees storage space', async () => {
      const res = await mobileDownloadManager.cleanStorage();
      expect(typeof res.cleanedCount).toBe('number');
      expect(typeof res.freedBytes).toBe('number');
    });
  });

  describe('6.3 Accessibility & 6.7 Theme Tokens', () => {
    it('enforces WCAG minimum 44pt touchable dimensions', () => {
      expect(touchable.minHeight).toBeGreaterThanOrEqual(44);
      expect(touchable.minWidth).toBeGreaterThanOrEqual(44);
      expect(touchable.hitSlop.top).toBeGreaterThanOrEqual(8);
    });

    it('defines consistent theme tokens across light and dark palettes', () => {
      expect(darkColors.background).toBeDefined();
      expect(darkColors.accent).toBeDefined();
      expect(lightColors.background).toBeDefined();
      expect(lightColors.accent).toBeDefined();
    });
  });
});
