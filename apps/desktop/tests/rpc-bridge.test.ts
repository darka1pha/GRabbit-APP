import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DesktopRpcBridge } from '../src/main/rpc-bridge';
import type { DownloadManager } from '../src/main/downloads/manager';
import type { PlatformRouter } from '../src/main/media/router';
import type { SettingsService } from '../src/main/settings';
import type { AddHttpDownloadRequest, AppSettings, DownloadItem } from '../src/shared/types';

describe('DesktopRpcBridge', () => {
  let bridge: DesktopRpcBridge;
  let mockManager: Partial<DownloadManager>;
  let mockRouter: Partial<PlatformRouter>;
  let mockSettings: Partial<SettingsService>;
  let currentSettings: AppSettings;
  let addedItemCallback: DownloadItem | null = null;
  const TEST_PORT = 31589;
  const TEST_TOKEN = 'secret-test-token-123';

  beforeEach(() => {
    addedItemCallback = null;
    currentSettings = {
      language: 'en',
      theme: 'system',
      downloadDir: 'C:\\Downloads',
      categorySubfolders: true,
      maxConcurrent: 3,
      defaultConnections: 8,
      maxRetries: 3,
      globalSpeedLimitKBps: 0,
      clipboardMonitor: false,
      notifications: false,
      closeToTray: false,
      resumeOnStartup: false,
      startOnBoot: false,
      startMinimized: true,
      globalShortcut: { enabled: true, accelerator: 'CommandOrControl+Alt+G' },
      updates: { autoCheck: true, autoDownload: false },
      userAgent: 'gRabbitTest/1.0',
      proxy: '',
      afterQueue: 'none',
      scheduler: { enabled: false, startTime: '', stopTime: '' },
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
        port: TEST_PORT,
        token: TEST_TOKEN,
        autoCapture: true,
      },
    };

    const mockItem: DownloadItem = {
      id: 'test-id-1',
      kind: 'http',
      url: 'https://example.com/archive.zip',
      fileName: 'archive.zip',
      directory: 'C:\\Downloads',
      category: 'compressed',
      status: 'downloading',
      totalBytes: 1048576,
      receivedBytes: 524288,
      speed: 256000,
      eta: 2,
      resumable: true,
      connections: 8,
      activeConnections: 4,
      retries: 0,
      createdAt: Date.now(),
    };

    mockManager = {
      list: vi.fn().mockReturnValue([mockItem]),
      addHttp: vi.fn().mockImplementation((reqs: AddHttpDownloadRequest[]) => {
        return reqs.map((r) => ({
          ...mockItem,
          url: r.url,
          fileName: r.fileName ?? 'download.zip',
        }));
      }),
      addMedia: vi.fn().mockReturnValue([]),
    };

    mockRouter = {
      resolve: vi.fn(),
    };

    mockSettings = {
      get: vi.fn().mockImplementation(() => currentSettings),
    };

    bridge = new DesktopRpcBridge({
      manager: mockManager as DownloadManager,
      router: mockRouter as PlatformRouter,
      settings: mockSettings as SettingsService,
      version: '1.0.0-test',
      onDownloadAdded: (item) => {
        addedItemCallback = item;
      },
    });

    bridge.start();
  });

  afterEach(() => {
    bridge.stop();
  });

  it('responds to OPTIONS preflight with CORS headers', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/ping`, {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')).toContain('X-GRabbit-Token');
  });

  it('allows unauthenticated GET /ping', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/ping`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.app).toBe('gRabbit');
    expect(data.version).toBe('1.0.0-test');
    expect(data.authenticated).toBe(false);
  });

  it('authenticates GET /ping when token is provided', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/ping`, {
      headers: { 'X-GRabbit-Token': TEST_TOKEN },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.authenticated).toBe(true);
  });

  it('rejects unauthorized request to /status', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/status`);
    expect(res.status).toBe(401);
    const data = (await res.json()) as any;
    expect(data.success).toBe(false);
    expect(data.error).toContain('Unauthorized');
  });

  it('returns queue stats on authorized GET /status', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/status`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.app).toBe('gRabbit');
    expect(data.authenticated).toBe(true);
    expect(data.activeDownloads).toBe(1);
    expect(data.totalSpeed).toBe(256000);
    expect(data.queueLength).toBe(1);
  });

  it('adds download with headers and cookies on POST /downloads/add', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GRabbit-Token': TEST_TOKEN,
      },
      body: JSON.stringify({
        url: 'https://example.com/file.iso',
        fileName: 'ubuntu.iso',
        referrer: 'https://example.com/downloads',
        cookies: 'session=abc123xyz',
        userAgent: 'CustomBrowser/1.0',
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.item.url).toBe('https://example.com/file.iso');
    expect(data.item.fileName).toBe('ubuntu.iso');
    expect(addedItemCallback).not.toBeNull();
    expect(mockManager.addHttp).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://example.com/file.iso',
        fileName: 'ubuntu.iso',
        referrer: 'https://example.com/downloads',
        headers: expect.objectContaining({
          Cookie: 'session=abc123xyz',
          'User-Agent': 'CustomBrowser/1.0',
        }),
      }),
    ]);
  });

  it('adds batch downloads on POST /downloads/batch', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/batch?token=${TEST_TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [
          { url: 'https://example.com/part1.rar', fileName: 'part1.rar' },
          { url: 'https://example.com/part2.rar', fileName: 'part2.rar' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.count).toBe(2);
    expect(mockManager.addHttp).toHaveBeenCalledTimes(2);
  });
});
