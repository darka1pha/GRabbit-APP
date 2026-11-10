import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request } from 'node:http';
import { DesktopRpcBridge } from '../src/main/rpc-bridge';
import type { DownloadManager } from '../src/main/downloads/manager';
import type { PlatformRouter } from '../src/main/media/router';
import type { SettingsService } from '../src/main/settings';
import type { AddHttpDownloadRequest, AppSettings, DownloadItem } from '../src/shared/types';

/** GET with a caller-chosen Host header (fetch does not allow overriding it). Resolves to the status code. */
function rawGet(path: string, headers: Record<string, string>, port = 31589): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

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
      userAgent: 'GRabbitTest/1.0',
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

  it('answers OPTIONS preflight and grants CORS only to extension origins', async () => {
    const ext = 'chrome-extension://abcdefghijklmnop';
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/ping`, {
      method: 'OPTIONS',
      headers: { Origin: ext },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ext);
    expect(res.headers.get('access-control-allow-headers')).toContain('X-GRabbit-Token');

    const web = await fetch(`http://127.0.0.1:${TEST_PORT}/ping`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    expect(web.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not treat a spoofed extension Origin or client header as authentication', async () => {
    const spoofed = {
      'Content-Type': 'application/json',
      Origin: 'chrome-extension://abcdefghijklmnop',
      'X-GRabbit-Client': 'browser-extension',
    };
    const status = await fetch(`http://127.0.0.1:${TEST_PORT}/status`, { headers: spoofed });
    expect(status.status).toBe(401);

    const add = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/add`, {
      method: 'POST',
      headers: spoofed,
      body: JSON.stringify({ url: 'https://example.com/evil.bat', directory: 'C:\Startup' }),
    });
    expect(add.status).toBe(401);
    expect(mockManager.addHttp).not.toHaveBeenCalled();

    const ping = await fetch(`http://127.0.0.1:${TEST_PORT}/ping`, { headers: spoofed });
    expect(((await ping.json()) as any).authenticated).toBe(false);
  });

  it('rejects a wrong token and a token passed in the query string', async () => {
    const wrong = await fetch(`http://127.0.0.1:${TEST_PORT}/status`, {
      headers: { 'X-GRabbit-Token': 'not-the-token' },
    });
    expect(wrong.status).toBe(401);

    const query = await fetch(`http://127.0.0.1:${TEST_PORT}/status?token=${TEST_TOKEN}`);
    expect(query.status).toBe(401);
  });

  it('rejects every request when no token is configured', async () => {
    currentSettings.extension.token = '';
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/status`, {
      headers: { 'X-GRabbit-Token': '' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests whose Host header is a domain name (DNS rebinding)', async () => {
    const status = await rawGet('/status', { Host: 'attacker.example', 'X-GRabbit-Token': TEST_TOKEN });
    expect(status).toBe(403);
    expect(await rawGet('/status', { Host: `localhost:${TEST_PORT}`, 'X-GRabbit-Token': TEST_TOKEN })).toBe(200);
  });

  it('listens on loopback only unless LAN access is switched on', () => {
    expect((bridge as any).currentHost).toBe('127.0.0.1');
    currentSettings.extension.allowLan = true;
    bridge.start();
    expect((bridge as any).currentHost).toBe('0.0.0.0');
  });

  it('grabs audio from music platforms and honours an explicit format', async () => {
    const options = [
      { format: 'video', qualityId: '1080p', label: '1080p', extension: 'mp4' },
      { format: 'audio', qualityId: 'm4a', label: 'M4A', extension: 'm4a' },
      { format: 'audio', qualityId: 'mp3-320', label: 'MP3 320k', extension: 'mp3' },
    ];
    const meta = (platform: string, url: string) => ({
      platform,
      url,
      title: 'T',
      items: [{ id: 'm1', title: 'T', platform, url, isDownloadable: true, availableOptions: options }],
    });
    (mockManager.addMedia as any).mockImplementation((reqs: any[]) => reqs.map((r) => ({ id: 'x', ...r })));
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${TEST_PORT}/downloads/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GRabbit-Token': TEST_TOKEN },
        body: JSON.stringify(body),
      });

    const sc = 'https://soundcloud.com/artist/track';
    (mockRouter.resolve as any).mockResolvedValue(meta('soundcloud', sc));
    expect((await post({ url: sc })).status).toBe(200);
    expect(mockManager.addMedia).toHaveBeenLastCalledWith([
      expect.objectContaining({ format: 'audio', qualityId: 'mp3-320' }),
    ]);

    const yt = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    (mockRouter.resolve as any).mockResolvedValue(meta('youtube', yt));
    await post({ url: yt });
    expect(mockManager.addMedia).toHaveBeenLastCalledWith([expect.objectContaining({ format: 'video' })]);

    await post({ url: yt, format: 'audio' });
    expect(mockManager.addMedia).toHaveBeenLastCalledWith([expect.objectContaining({ format: 'audio' })]);
  });

  it('allows unauthenticated GET /ping', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/ping`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.app).toBe('GRabbit');
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
    expect(data.app).toBe('GRabbit');
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
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GRabbit-Token': TEST_TOKEN,
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

  it('returns download list on GET /downloads/list', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/list`, {
      headers: { 'X-GRabbit-Token': TEST_TOKEN },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items[0].fileName).toBe('archive.zip');
  });

  it('resolves metadata on POST /media/resolve and POST /api/resolve', async () => {
    (mockRouter.resolve as any).mockResolvedValue({
      platform: 'youtube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Test Video',
      items: [{ id: 'yt-1', title: 'Test Video', platform: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', isDownloadable: true, availableOptions: [] }],
    });

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/media/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GRabbit-Token': TEST_TOKEN,
      },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.metadata.title).toBe('Test Video');
    expect(data.items).toHaveLength(1);
  });
});
