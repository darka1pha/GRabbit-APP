import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileBridgeService } from '../services/bridge';
import { mobileSettingsManager } from '../services/settings-manager';
import { resolveThemeMode } from '../hooks/useTheme';
import { parseIncomingDeepLink } from '../hooks/useShareIntent';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  },
  Platform: {
    OS: 'android',
  },
  useColorScheme: vi.fn().mockReturnValue('dark'),
}));

vi.mock('expo-linking', () => ({
  parse: vi.fn().mockImplementation((raw: string) => ({ queryParams: { url: raw } })),
  addEventListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  getInitialURL: vi.fn().mockResolvedValue(null),
}));

vi.mock('expo-file-system', () => ({
  documentDirectory: '/mock/grabbit/',
  cacheDirectory: '/mock/cache/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  getInfoAsync: vi.fn().mockResolvedValue({ exists: true }),
  makeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
  writeAsStringAsync: vi.fn().mockResolvedValue(undefined),
  readAsStringAsync: vi.fn().mockResolvedValue('{}'),
  deleteAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@grabbit/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@grabbit/utils')>();
  return actual;
});

describe('Mobile Cross-Device, Theme & Deep Link Flows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(mobileSettingsManager, 'getSettings').mockReturnValue({
      language: 'en',
      theme: 'system',
      maxConcurrent: 3,
      defaultAudioFormat: 'mp3',
      defaultVideoQuality: '1080p',
      notificationsEnabled: true,
      wifiOnly: false,
      saveToGallery: false,
      speedLimitKBps: 0,
      defaultConnections: 4,
      desktopBridge: {
        enabled: true,
        host: '192.168.1.42',
        port: 31542,
        token: 'pair-secret-token',
      },
      autoCheckUpdates: true,
    });
  });

  describe('resolveThemeMode', () => {
    it('follows OS color scheme when set to system', () => {
      expect(resolveThemeMode('system', 'light')).toBe('light');
      expect(resolveThemeMode('system', 'dark')).toBe('dark');
      expect(resolveThemeMode(undefined, null)).toBe('dark');
    });

    it('honors explicit light or dark override regardless of OS scheme', () => {
      expect(resolveThemeMode('light', 'dark')).toBe('light');
      expect(resolveThemeMode('dark', 'light')).toBe('dark');
    });
  });

  describe('parseIncomingDeepLink', () => {
    it('parses grabbit://pair deep links with host, port, and token', () => {
      const parsed = parseIncomingDeepLink('grabbit://pair?host=192.168.1.42&port=31542&token=abc123');
      expect(parsed).toEqual({
        kind: 'pair',
        pair: { host: '192.168.1.42', port: 31542, token: 'abc123' },
      });
    });

    it('parses grabbit://transfer deep links for direct Wi-Fi file pull', () => {
      const targetUrl = 'http://192.168.1.42:31542/transfer/tok_xyz';
      const parsed = parseIncomingDeepLink(
        `grabbit://transfer?url=${encodeURIComponent(targetUrl)}&name=Ubuntu.iso&size=102400`
      );
      expect(parsed).toEqual({
        kind: 'transfer',
        transfer: {
          url: targetUrl,
          fileName: 'Ubuntu.iso',
          sizeBytes: 102400,
        },
      });
    });

    it('rejects non-http transfer URLs and extracts normal shared HTTP URLs', () => {
      expect(parseIncomingDeepLink('grabbit://transfer?url=file:///etc/passwd')).toEqual({ kind: 'none' });
      expect(parseIncomingDeepLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
        kind: 'url',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
    });
  });

  describe('MobileBridgeService Remote PC Control & Wi-Fi Pull', () => {
    it('builds authenticated LAN pull URL & header for completed desktop items', () => {
      const bridge = new MobileBridgeService();
      const pull = bridge.getDesktopFilePullRequest({ id: 'dl 123', fileName: 'movie.mp4' });
      expect(pull).toEqual({
        url: 'http://192.168.1.42:31542/downloads/dl%20123/file',
        fileName: 'movie.mp4',
        headers: { 'X-GRabbit-Token': 'pair-secret-token' },
      });
    });

    it('fetches desktop downloads and computes aggregate active count & speed', async () => {
      const bridge = new MobileBridgeService();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            items: [
              { id: '1', status: 'downloading', speed: 1200 },
              { id: '2', status: 'completed', speed: 0 },
              { id: '3', status: 'processing', speed: 800 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await bridge.getDesktopDownloads();
      expect(res.ok).toBe(true);
      expect(res.items).toHaveLength(3);
      expect(res.aggregate).toEqual({ active: 2, speed: 2000, percent: null });
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://192.168.1.42:31542/downloads/list',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'X-GRabbit-Token': 'pair-secret-token' }),
        })
      );
    });

    it('sends matching RPC payloads for pause, resume, remove, and queue toggle', async () => {
      const bridge = new MobileBridgeService();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(bridge.pauseDesktopDownloads(['a'])).resolves.toEqual({ success: true, error: undefined });
      await expect(bridge.resumeDesktopDownloads(['a'])).resolves.toEqual({ success: true, error: undefined });
      await expect(bridge.removeDesktopDownloads(['a'], true)).resolves.toEqual({ success: true, error: undefined });
      await expect(bridge.toggleDesktopQueue('scheduled', 'start')).resolves.toEqual({
        success: true,
        error: undefined,
      });

      const removeCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/downloads/remove'));
      expect(JSON.parse(String(removeCall?.[1]?.body))).toEqual({ ids: ['a'], deleteFiles: true });

      const queueCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/queues/toggle'));
      expect(JSON.parse(String(queueCall?.[1]?.body))).toEqual({ id: 'scheduled', enabled: true });
    });
  });
});

