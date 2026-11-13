import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  /** Stand-in for DNS: public by default, overridden per test. */
  let lookupHost: (hostname: string) => Promise<string[]>;

  beforeEach(() => {
    addedItemCallback = null;
    lookupHost = async () => ['93.184.216.34'];
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
      get: vi.fn().mockImplementation((id: string) => (id === mockItem.id ? mockItem : undefined)),
      addHttp: vi.fn().mockImplementation((reqs: AddHttpDownloadRequest[]) => {
        return reqs.map((r) => ({
          ...mockItem,
          url: r.url,
          fileName: r.fileName ?? 'download.zip',
        }));
      }),
      addMedia: vi.fn().mockReturnValue([]),
      pause: vi.fn(),
      resume: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      listQueues: vi.fn().mockReturnValue([
        { id: 'main', name: 'Main Queue', enabled: true, maxConcurrent: 3, order: ['test-id-1'] },
        { id: 'scheduled', name: 'Scheduled Queue', enabled: false, maxConcurrent: 2, order: [] },
      ]),
      startQueue: vi.fn(),
      stopQueue: vi.fn(),
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
      lookupHost: (hostname) => lookupHost(hostname),
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

  describe('limits on what callers may ask for', () => {
    const post = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${TEST_PORT}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GRabbit-Token': TEST_TOKEN },
        body: JSON.stringify(body),
      });
    const lastDirectory = () => (mockManager.addHttp as any).mock.lastCall[0][0].directory;

    it('drops a folder outside the download folder', async () => {
      for (const directory of ['C:\\Users\\me\\Startup', '..\\..\\Windows', 'C:\\Downloads\\..\\Elsewhere']) {
        expect((await post('/downloads/add', { url: 'https://example.com/a.zip', directory })).status).toBe(200);
        expect(lastDirectory()).toBeUndefined();
      }
    });

    it('keeps a folder inside the download folder', async () => {
      await post('/downloads/add', { url: 'https://example.com/a.zip', directory: 'C:\\Downloads\\Work' });
      expect(lastDirectory()).toBe('C:\\Downloads\\Work');
      await post('/downloads/add', { url: 'https://example.com/a.zip', directory: 'Sub\\Folder' });
      expect(lastDirectory()).toBe('C:\\Downloads\\Sub\\Folder');
    });

    it('rejects an oversized batch', async () => {
      const items = Array.from({ length: 201 }, (_, i) => ({ url: `https://example.com/${i}.bin` }));
      const res = await post('/downloads/batch', { items });
      expect(res.status).toBe(400);
      expect(mockManager.addHttp).not.toHaveBeenCalled();
    });

    it('refuses to resolve, recognise or stream local-network addresses', async () => {
      for (const path of ['/media/resolve', '/media/recognize', '/media/stream']) {
        for (const url of ['http://127.0.0.1:8080/x', 'http://192.168.1.1/admin', 'http://localhost/x', 'http://[::1]/x', 'file:///c:/x']) {
          expect((await post(path, { url })).status, `${path} ${url}`).toBe(400);
        }
      }
      expect(mockRouter.resolve).not.toHaveBeenCalled();
    });

    it('refuses a public-looking name that resolves to a private address', async () => {
      lookupHost = async (hostname) => (hostname === 'rebind.example' ? ['93.184.216.34', '10.0.0.5'] : ['93.184.216.34']);
      expect((await post('/media/resolve', { url: 'https://rebind.example/video' })).status).toBe(400);
      expect(mockRouter.resolve).not.toHaveBeenCalled();
    });

    it('answers malformed bodies with 400', async () => {
      expect((await post('/downloads/add', { url: 42 })).status).toBe(400);
      expect((await post('/downloads/add', { url: 'https://example.com/a', headers: 'nope' })).status).toBe(400);
      expect((await post('/downloads/batch', { items: 'nope' })).status).toBe(400);
      const raw = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GRabbit-Token': TEST_TOKEN },
        body: '{not json',
      });
      expect(raw.status).toBe(400);
      expect(mockManager.addHttp).not.toHaveBeenCalled();
    });

    it('skips malformed entries in a batch but adds the rest', async () => {
      const res = await post('/downloads/batch', { items: [{ url: 'https://example.com/ok.zip' }, { nope: true }, null] });
      expect(((await res.json()) as any).count).toBe(1);
    });

    it('locks an address out after repeated wrong tokens, even with the right one', async () => {
      const get = (token: string) => fetch(`http://127.0.0.1:${TEST_PORT}/status`, { headers: { 'X-GRabbit-Token': token } });
      for (let i = 0; i < 20; i++) expect((await get(`guess-${i}`)).status).toBe(401);
      const locked = await get(TEST_TOKEN);
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    it('limits how many requests one address may make per minute', async () => {
      const get = () => fetch(`http://127.0.0.1:${TEST_PORT}/ping`);
      const statuses: number[] = [];
      for (let i = 0; i < 301; i++) statuses.push((await get()).status);
      expect(statuses.slice(0, 300).every((s) => s === 200)).toBe(true);
      expect(statuses[300]).toBe(429);
    });

    it("only installs extension updates from this project's GitHub releases", async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      for (const downloadUrl of [
        'https://evil.example/ext.zip',
        'http://github.com/darka1pha/GRabbit-APP/releases/download/v1/ext.zip',
        'https://github.com/someone-else/GRabbit-APP/releases/download/v1/ext.zip',
        'https://github.com/darka1pha/GRabbit-APP/releases/download/v1/ext.exe',
        'https://github.com/darka1pha/GRabbit-APP/releases/download/v1/../../../x.zip',
      ]) {
        expect((await post('/extension/update', { downloadUrl, version: '9.9.9' })).status, downloadUrl).toBe(400);
      }
      // Only the test's own calls to the bridge went out: the bridge fetched nothing
      expect(fetchSpy.mock.calls.every(([u]) => String(u).startsWith(`http://127.0.0.1:${TEST_PORT}`))).toBe(true);
      fetchSpy.mockRestore();
    });
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

  it('controls downloads via POST /downloads/pause, /resume, and /remove', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'X-GRabbit-Token': TEST_TOKEN,
    };

    const pauseRes = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/pause`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: ['test-id-1'] }),
    });
    expect(pauseRes.status).toBe(200);
    expect(mockManager.pause).toHaveBeenCalledWith(['test-id-1']);

    const resumeRes = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/resume`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: ['test-id-1'] }),
    });
    expect(resumeRes.status).toBe(200);
    expect(mockManager.resume).toHaveBeenCalledWith(['test-id-1']);

    const removeRes = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/remove`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: ['test-id-1'], deleteFiles: true }),
    });
    expect(removeRes.status).toBe(200);
    expect(mockManager.remove).toHaveBeenCalledWith(['test-id-1'], true);
  });

  it('lists and toggles queues via GET /queues/list and POST /queues/toggle', async () => {
    const listRes = await fetch(`http://127.0.0.1:${TEST_PORT}/queues/list`, {
      headers: { 'X-GRabbit-Token': TEST_TOKEN },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.success).toBe(true);
    expect(listBody.queues).toHaveLength(2);

    const startRes = await fetch(`http://127.0.0.1:${TEST_PORT}/queues/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GRabbit-Token': TEST_TOKEN },
      body: JSON.stringify({ id: 'scheduled', enabled: true }),
    });
    expect(startRes.status).toBe(200);
    expect(mockManager.startQueue).toHaveBeenCalledWith('scheduled');

    const stopRes = await fetch(`http://127.0.0.1:${TEST_PORT}/queues/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GRabbit-Token': TEST_TOKEN },
      body: JSON.stringify({ id: 'main', enabled: false }),
    });
    expect(stopRes.status).toBe(200);
    expect(mockManager.stopQueue).toHaveBeenCalledWith('main');
  });

  it('streams completed files via temporary /transfer/:token and authenticated /downloads/:id/file with Range support', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'grabbit-transfer-test-'));
    try {
      const samplePath = join(tempDir, 'hello-world.bin');
      writeFileSync(samplePath, 'HelloGRabbitTransfer');

      const completedItem: DownloadItem = {
        id: 'done-file-1',
        kind: 'http',
        url: 'https://example.com/hello-world.bin',
        fileName: 'hello-world.bin',
        filePath: samplePath,
        directory: tempDir,
        category: 'other',
        status: 'completed',
        totalBytes: 20,
        receivedBytes: 20,
        speed: 0,
        eta: 0,
        resumable: true,
        connections: 1,
        activeConnections: 0,
        retries: 0,
        createdAt: Date.now(),
      };
      (mockManager.get as any).mockImplementation((id: string) => (id === 'done-file-1' ? completedItem : undefined));

      const tokenInfo = bridge.createTransferToken('done-file-1');
      expect(tokenInfo).not.toBeNull();
      expect(tokenInfo!.fileName).toBe('hello-world.bin');
      expect(tokenInfo!.sizeBytes).toBe(20);

      // Unauthenticated pull via single-use/time-limited token succeeds
      const fullRes = await fetch(`http://127.0.0.1:${TEST_PORT}/transfer/${tokenInfo!.token}`);
      expect(fullRes.status).toBe(200);
      expect(fullRes.headers.get('accept-ranges')).toBe('bytes');
      expect(await fullRes.text()).toBe('HelloGRabbitTransfer');

      // HTTP Range partial slice returns 206 Partial Content
      const rangeRes = await fetch(`http://127.0.0.1:${TEST_PORT}/transfer/${tokenInfo!.token}`, {
        headers: { Range: 'bytes=5-11' },
      });
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get('content-range')).toBe('bytes 5-11/20');
      expect(await rangeRes.text()).toBe('GRabbit');

      // Invalid token is rejected with 404
      const badTokenRes = await fetch(`http://127.0.0.1:${TEST_PORT}/transfer/does-not-exist`);
      expect(badTokenRes.status).toBe(404);

      // Authenticated direct file pull enforces X-GRabbit-Token
      const unauthDirect = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/done-file-1/file`);
      expect(unauthDirect.status).toBe(401);

      const authDirect = await fetch(`http://127.0.0.1:${TEST_PORT}/downloads/done-file-1/file`, {
        headers: { 'X-GRabbit-Token': TEST_TOKEN },
      });
      expect(authDirect.status).toBe(200);
      expect(await authDirect.text()).toBe('HelloGRabbitTransfer');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
