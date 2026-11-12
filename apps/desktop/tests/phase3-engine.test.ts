import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppSettings, DownloadItem } from '../src/shared/types';
import { DEFAULT_APP_SETTINGS } from '../src/main/settings';
import {
  defaultHostPool,
  HostConnectionPool,
  httpRequest,
} from '../src/main/downloads/http-client';
import {
  HttpDownloadTask,
  probeUrl,
  requiredFreeBytes,
} from '../src/main/downloads/http-engine';
import { DownloadManager } from '../src/main/downloads/manager';
import { RateLimiter } from '../src/main/downloads/throttle';

describe('HostConnectionPool', () => {
  it('enforces maximum concurrent connections per host', async () => {
    const pool = new HostConnectionPool(2);
    expect(pool.getActiveCount('example.com')).toBe(0);

    const rel1 = await pool.acquire('example.com');
    expect(pool.getActiveCount('example.com')).toBe(1);

    const rel2 = await pool.acquire('example.com');
    expect(pool.getActiveCount('example.com')).toBe(2);

    let acquired3 = false;
    const promise3 = pool.acquire('example.com').then((rel) => {
      acquired3 = true;
      return rel;
    });

    // Wait a tick: 3rd acquire is waiting
    await new Promise((r) => setTimeout(r, 20));
    expect(acquired3).toBe(false);

    // Meanwhile a different host can acquire immediately
    const relOther = await pool.acquire('other.com');
    expect(pool.getActiveCount('other.com')).toBe(1);
    relOther();
    expect(pool.getActiveCount('other.com')).toBe(0);

    // Release slot 1, waiter 3 should acquire
    rel1();
    const rel3 = await promise3;
    expect(acquired3).toBe(true);
    expect(pool.getActiveCount('example.com')).toBe(2);

    rel2();
    rel3();
    expect(pool.getActiveCount('example.com')).toBe(0);
  });

  it('cancels a waiting acquire when aborted', async () => {
    const pool = new HostConnectionPool(1);
    const rel1 = await pool.acquire('example.com');

    const ac = new AbortController();
    const p = pool.acquire('example.com', ac.signal);
    ac.abort();

    await expect(p).rejects.toThrow();
    rel1();
    expect(pool.getActiveCount('example.com')).toBe(0);
  });
});

describe('probeUrl fallbacks', () => {
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? '';
      if (url === '/reject-range') {
        // Rejects Range headers with 416, but answers HEAD or plain GET with 200
        if (req.headers.range) {
          res.writeHead(416, { 'Content-Type': 'text/plain' });
          res.end('Range Not Satisfiable');
          return;
        }
        res.writeHead(200, {
          'Content-Length': '1024',
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'none',
        });
        res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(1024));
        return;
      }

      if (url === '/head-only') {
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Length': '2048',
            'Content-Type': 'application/pdf',
          });
          res.end();
          return;
        }
        res.writeHead(405);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it('falls back to HEAD or plain GET when Range headers are rejected', async () => {
    const info = await probeUrl(`${base}/reject-range`, {});
    expect(info.totalBytes).toBe(1024);
    expect(info.resumable).toBe(false);
  });
});

describe('Sparse in-place download and legacy migration', () => {
  const TEST_DATA = randomBytes(2 * 1024 * 1024 + 500);
  const TEST_SHA = createHash('sha256').update(TEST_DATA).digest('hex');
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), TEST_DATA.length - 1) : TEST_DATA.length - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${TEST_DATA.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': 'application/octet-stream',
        });
        res.end(TEST_DATA.subarray(start, end + 1));
      } else {
        res.writeHead(200, {
          'Content-Length': String(TEST_DATA.length),
          'Content-Type': 'application/octet-stream',
        });
        res.end(TEST_DATA);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  function makeItem(dir: string, fileName = 'sparse.bin'): DownloadItem {
    return {
      id: `task_${Math.random().toString(16).slice(2)}`,
      kind: 'http',
      url: `${base}/file`,
      fileName,
      directory: dir,
      category: 'other',
      status: 'queued',
      totalBytes: null,
      receivedBytes: 0,
      speed: 0,
      eta: null,
      resumable: false,
      connections: 2,
      activeConnections: 0,
      retries: 0,
      createdAt: Date.now(),
    };
  }

  function makeTask(item: DownloadItem) {
    return new HttpDownloadTask(item, {
      globalLimiter: new RateLimiter(),
      itemLimiter: new RateLimiter(),
      userAgent: 'test-agent',
      maxRetries: 2,
      onProbe: () => undefined,
      onPersist: () => undefined,
      onUpdate: () => undefined,
    });
  }

  it('writes into .gdownload and removes .gdownload.meta upon completion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grabbit-sparse-'));
    try {
      const item = makeItem(dir, 'output.bin');
      const task = makeTask(item);

      const filePath = await task.run(new AbortController().signal);
      expect(filePath).toBe(join(dir, 'output.bin.gdownload'));
      expect(existsSync(filePath)).toBe(true);
      expect(existsSync(`${filePath}.meta`)).toBe(false);

      const content = readFileSync(filePath);
      expect(createHash('sha256').update(content).digest('hex')).toBe(TEST_SHA);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates and finishes legacy .grabbit-<id> part files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grabbit-legacy-'));
    try {
      const item = makeItem(dir, 'legacy.bin');
      // Create a legacy .grabbit-<id> folder with part 0 and part 1
      const legacyDir = HttpDownloadTask.partDir(item);
      const fs = await import('node:fs/promises');
      await fs.mkdir(legacyDir, { recursive: true });

      const half = Math.floor(TEST_DATA.length / 2);
      await fs.writeFile(join(legacyDir, '0.part'), TEST_DATA.subarray(0, half));
      await fs.writeFile(join(legacyDir, '1.part'), TEST_DATA.subarray(half));

      item.totalBytes = TEST_DATA.length;
      item.resumable = true;
      item.segments = [
        { start: 0, end: half - 1, received: half, part: '0' },
        { start: half, end: TEST_DATA.length - 1, received: TEST_DATA.length - half, part: '1' },
      ];

      const task = makeTask(item);
      const filePath = await task.run(new AbortController().signal);
      expect(existsSync(filePath)).toBe(true);
      expect(existsSync(legacyDir)).toBe(false);

      const content = readFileSync(filePath);
      expect(createHash('sha256').update(content).digest('hex')).toBe(TEST_SHA);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('DownloadManager active vs history persistence and capping', () => {
  let dir: string;
  let settings: AppSettings;
  let manager: DownloadManager;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'grabbit-mgr-'));
    settings = { ...DEFAULT_APP_SETTINGS, downloadDir: dir, resumeOnStartup: false };
  });

  afterAll(() => {
    manager?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it('migrates legacy downloads.json and splits into active.json and history.json', async () => {
    const legacyItems = [
      {
        id: 'item-active',
        kind: 'http',
        url: 'https://example.com/active.bin',
        fileName: 'active.bin',
        directory: dir,
        category: 'other',
        status: 'paused',
        totalBytes: 5000,
        receivedBytes: 1000,
        speed: 0,
        eta: null,
        resumable: true,
        connections: 2,
        activeConnections: 0,
        retries: 0,
        createdAt: 100,
      },
      {
        id: 'item-completed',
        kind: 'http',
        url: 'https://example.com/done.bin',
        fileName: 'done.bin',
        directory: dir,
        category: 'other',
        status: 'completed',
        totalBytes: 2000,
        receivedBytes: 2000,
        speed: 0,
        eta: null,
        resumable: true,
        connections: 2,
        activeConnections: 0,
        retries: 0,
        createdAt: 200,
        completedAt: 300,
      },
    ];

    writeFileSync(join(dir, 'downloads.json'), JSON.stringify(legacyItems));

    manager = new DownloadManager({
      dataDir: dir,
      tempRoot: join(dir, 'temp'),
      router: {} as never,
      getSettings: () => settings,
      onItemsChanged: () => {},
      onItemsRemoved: () => {},
      onOrderChanged: () => {},
      onCompleted: () => {},
      onFailed: () => {},
      onQueueDrained: () => {},
      onAggregateProgress: () => {},
    });

    manager.init();

    // Verify both items loaded in manager
    expect(manager.list()).toHaveLength(2);
    expect(manager.get('item-active')?.status).toBe('paused');
    expect(manager.get('item-completed')?.status).toBe('completed');

    // Trigger synchronous save by shutdown
    manager.shutdown();

    // Verify active.json and history.json exist
    expect(existsSync(join(dir, 'active.json'))).toBe(true);
    expect(existsSync(join(dir, 'history.json'))).toBe(true);

    const activeStored = JSON.parse(readFileSync(join(dir, 'active.json'), 'utf8'));
    const historyStored = JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8'));

    expect(activeStored.map((i: DownloadItem) => i.id)).toEqual(['item-active']);
    expect(historyStored.map((i: DownloadItem) => i.id)).toEqual(['item-completed']);
  });

  it('caps history entries to prevent unbounded growth', () => {
    const historyDir = mkdtempSync(join(tmpdir(), 'grabbit-cap-'));
    try {
      const items: DownloadItem[] = [];
      for (let i = 0; i < 5005; i++) {
        items.push({
          id: `item-${i}`,
          kind: 'http',
          url: `https://example.com/${i}.bin`,
          fileName: `${i}.bin`,
          directory: historyDir,
          category: 'other',
          status: 'completed',
          totalBytes: 100,
          receivedBytes: 100,
          speed: 0,
          eta: null,
          resumable: true,
          connections: 1,
          activeConnections: 0,
          retries: 0,
          createdAt: i,
          completedAt: i + 1,
        });
      }

      writeFileSync(join(historyDir, 'history.json'), JSON.stringify(items));

      const capManager = new DownloadManager({
        dataDir: historyDir,
        tempRoot: join(historyDir, 'temp'),
        router: {} as never,
        getSettings: () => settings,
        onItemsChanged: () => {},
        onItemsRemoved: () => {},
        onOrderChanged: () => {},
        onCompleted: () => {},
        onFailed: () => {},
        onQueueDrained: () => {},
        onAggregateProgress: () => {},
      });

      capManager.init();
      // Initially loaded all
      expect(capManager.list().length).toBe(5005);

      // On shutdown (or when item finishes), history is capped to 5000
      capManager.shutdown();

      const savedHistory = JSON.parse(readFileSync(join(historyDir, 'history.json'), 'utf8'));
      expect(savedHistory.length).toBe(5000);
      // Oldest 5 items (item-0 through item-4) dropped
      expect(savedHistory[0].id).toBe('item-5');
      expect(savedHistory[4999].id).toBe('item-5004');
    } finally {
      rmSync(historyDir, { recursive: true, force: true });
    }
  });
});

describe('HTTP 429/503 rate limit backoff', () => {
  let rateServer: http.Server;
  let rateBase = '';

  beforeAll(async () => {
    rateServer = http.createServer((req, res) => {
      // Return 206 for probe bytes=0-, but 429 for subsequent segment requests
      if (req.headers.range === 'bytes=0-') {
        res.writeHead(206, {
          'Content-Range': 'bytes 0-1048575/1048576',
          'Accept-Ranges': 'bytes',
          'Content-Length': '1048576',
          'Content-Type': 'application/octet-stream',
        });
        res.end(Buffer.alloc(1048576));
        return;
      }
      res.writeHead(429, { 'Retry-After': '1' });
      res.end('Too Many Requests');
    });
    await new Promise<void>((resolve) => rateServer.listen(0, '127.0.0.1', resolve));
    rateBase = `http://127.0.0.1:${(rateServer.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    rateServer.closeAllConnections();
    rateServer.close();
  });

  it('reduces item.connections when receiving HTTP 429 or 503', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grabbit-429-'));
    try {
      const item: DownloadItem = {
        id: 't-429',
        kind: 'http',
        url: `${rateBase}/rate`,
        fileName: 'rate.bin',
        directory: dir,
        category: 'other',
        status: 'queued',
        totalBytes: 1048576,
        receivedBytes: 0,
        speed: 0,
        eta: null,
        resumable: true,
        connections: 8,
        activeConnections: 0,
        retries: 0,
        createdAt: Date.now(),
        segments: [
          { start: 0, end: 524287, received: 0, part: '0' },
          { start: 524288, end: 1048575, received: 0, part: '1' },
        ],
      };

      const task = new HttpDownloadTask(item, {
        globalLimiter: new RateLimiter(),
        itemLimiter: new RateLimiter(),
        userAgent: 'test',
        maxRetries: 1,
        onProbe: () => undefined,
        onPersist: () => undefined,
        onUpdate: () => undefined,
      });

      await expect(task.run(new AbortController().signal)).rejects.toThrow();
      // Connections should have been halved from 8 to 4 (or 2)
      expect(item.connections).toBeLessThan(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
