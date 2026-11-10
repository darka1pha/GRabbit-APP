import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { getLocale: () => 'en-US', getPath: () => '/mock', getVersion: () => '1.0.0', isPackaged: false },
  shell: { trashItem: vi.fn() },
}));

import { DEFAULT_APP_SETTINGS } from '@grabbit/config';
import { JsonStore } from '../src/main/store';
import { httpRequest } from '../src/main/downloads/http-client';
import { requiredFreeBytes } from '../src/main/downloads/http-engine';
import { DownloadManager } from '../src/main/downloads/manager';
import { mainText } from '../src/main/messages';
import type { AfterQueueAction, AppSettings, DownloadItem } from '../src/shared/types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'grabbit-p2-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('JsonStore', () => {
  const file = () => join(dir, 'doc.json');
  const read = () => JSON.parse(readFileSync(file(), 'utf8'));

  it('a synchronous save wins over an asynchronous save still in flight', async () => {
    const store = new JsonStore<{ n: number }>(file(), 1);
    store.saveSync({ n: 0 });
    for (let round = 1; round <= 20; round++) {
      store.save(() => ({ n: -round }));
      await wait(2); // the debounce fired; the async write is now somewhere before its rename
      store.saveSync({ n: round });
      await wait(15);
      expect(read()).toEqual({ n: round });
    }
  });

  it('leaves no temp files behind', async () => {
    const store = new JsonStore<{ n: number }>(file(), 1);
    store.save(() => ({ n: 1 }));
    await wait(40);
    store.saveSync({ n: 2 });
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps the previous version as a backup and falls back to it', () => {
    const store = new JsonStore<number[]>(file(), 1);
    store.saveSync([1]);
    store.saveSync([1, 2]);
    writeFileSync(file(), '{ truncated');
    expect(store.load([])).toEqual([1]);
  });

  it('falls back when the file parses but has the wrong shape', () => {
    const store = new JsonStore<number[]>(file(), 1);
    store.saveSync([7]);
    store.saveSync([7, 8]);
    writeFileSync(file(), '{"not":"a list"}');
    expect(store.load([], Array.isArray)).toEqual([7]);
    writeFileSync(`${file()}.bak`, '"also wrong"');
    expect(store.load([], Array.isArray)).toEqual([]);
  });
});

describe('stall timeout', () => {
  let server: http.Server;
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('drops a response that stops sending data part-way through the body', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '1000000' });
      res.write(Buffer.alloc(1000)); // then silence
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const started = Date.now();
    const res = await httpRequest(`http://127.0.0.1:${port}/file`, { stallTimeoutMs: 300 });
    let received = 0;
    let failure: unknown;
    try {
      for await (const chunk of res.body) received += (chunk as Buffer).length;
    } catch (err) {
      failure = err;
    }
    server.closeAllConnections();

    expect(received).toBe(1000);
    expect(failure).toBeTruthy();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('free space estimate', () => {
  it('needs the file once, plus every part except the first a second time', () => {
    const seg = (start: number, end: number) => ({ start, end, received: 0, part: '0' });
    expect(requiredFreeBytes([seg(0, 99)])).toBe(100);
    expect(requiredFreeBytes([seg(0, 99), seg(100, 199), seg(200, 299), seg(300, 399)])).toBe(400 + 300);
    expect(requiredFreeBytes([{ start: 0, end: null, received: 0, part: '0' }])).toBe(0);
  });
});

describe('main-process text', () => {
  it('is translated and fills in parameters', () => {
    expect(mainText('en', 'tray.active', { count: 3 })).toBe('GRabbit: 3 active');
    expect(mainText('fa', 'notify.complete')).toBe('دانلود کامل شد');
    expect(mainText('fa', 'after.shutdown', { seconds: 60 })).toContain('60');
  });
});

describe('DownloadManager', () => {
  let managers: DownloadManager[] = [];
  let drained: (AfterQueueAction | undefined)[];
  let settings: AppSettings;

  function create(): DownloadManager {
    const manager = new DownloadManager({
      dataDir: dir,
      tempRoot: join(dir, 'temp'),
      router: {} as never,
      getSettings: () => settings,
      onItemsChanged: () => {},
      onItemsRemoved: () => {},
      onOrderChanged: () => {},
      onCompleted: () => {},
      onFailed: () => {},
      onQueueDrained: (action) => drained.push(action),
      onAggregateProgress: () => {},
    });
    managers.push(manager);
    return manager;
  }

  beforeEach(() => {
    managers = [];
    drained = [];
    settings = { ...DEFAULT_APP_SETTINGS, downloadDir: dir, resumeOnStartup: false };
  });
  afterEach(() => {
    for (const m of managers) m.shutdown();
  });

  const storedItem = (over: Partial<DownloadItem>): DownloadItem => ({
    id: 'a',
    kind: 'http',
    url: 'https://example.com/a.bin',
    fileName: 'a.bin',
    directory: dir,
    category: 'other',
    status: 'paused',
    totalBytes: null,
    receivedBytes: 0,
    speed: 0,
    eta: null,
    resumable: false,
    connections: 4,
    activeConnections: 0,
    retries: 0,
    createdAt: 1,
    ...over,
  });

  it('drops damaged entries from downloads.json and keeps the good ones', () => {
    writeFileSync(
      join(dir, 'downloads.json'),
      JSON.stringify([
        storedItem({ id: 'good', futureField: 'kept' } as Partial<DownloadItem>),
        { id: 'no-fields' },
        'garbage',
        null,
        storedItem({ id: 'bad-status', status: 'exploded' as never }),
        storedItem({ id: 'good' }), // duplicate id
      ])
    );
    const manager = create();
    manager.init();
    const items = manager.list();
    expect(items.map((i) => i.id)).toEqual(['good']);
    expect((items[0] as unknown as { futureField: string }).futureField).toBe('kept');
  });

  it('survives a downloads.json that is not a list', () => {
    writeFileSync(join(dir, 'downloads.json'), '{"oops":true}');
    const manager = create();
    expect(() => manager.init()).not.toThrow();
    expect(manager.list()).toEqual([]);
  });

  it('starts a scheduled queue when the app comes up inside its window, and stops it afterwards', () => {
    const manager = create();
    manager.init();
    const queue = manager.createQueue('Night', { scheduler: { enabled: true, startTime: '02:00', stopTime: '08:00' } });
    expect(manager.listQueues().find((q) => q.id === queue.id)?.enabled).toBe(false);

    manager.checkScheduler(new Date(2026, 10, 9, 2, 5));
    expect(manager.listQueues().find((q) => q.id === queue.id)?.enabled).toBe(true);

    manager.checkScheduler(new Date(2026, 10, 9, 8, 30));
    expect(manager.listQueues().find((q) => q.id === queue.id)?.enabled).toBe(false);
  });

  describe('after a queue finishes', () => {
    let server: http.Server;
    let url: string;
    beforeEach(async () => {
      server = http.createServer((_req, res) => {
        const body = Buffer.alloc(4096, 1);
        res.writeHead(200, { 'Content-Length': String(body.length) });
        res.end(body);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

    async function untilDrained(): Promise<void> {
      for (let i = 0; i < 200 && drained.length === 0; i++) await wait(25);
    }

    it("passes on the finished queue's own action instead of the global setting", async () => {
      settings.afterQueue = 'none';
      const manager = create();
      manager.init();
      const queue = manager.createQueue('Night', { afterQueue: 'sleep' });
      manager.startQueue(queue.id);
      manager.addHttp([{ url: `${url}/one.bin`, queueId: queue.id }]);
      await untilDrained();
      expect(drained).toEqual(['sleep']);
    });

    it('reports no specific action for a queue without one', async () => {
      const manager = create();
      manager.init();
      manager.addHttp([{ url: `${url}/two.bin` }]);
      await untilDrained();
      expect(drained).toEqual([undefined]);
    });

    it('is not held up by items waiting in a stopped queue', async () => {
      const manager = create();
      manager.init();
      const parked = manager.createQueue('Parked');
      manager.addHttp([{ url: `${url}/parked.bin`, queueId: parked.id }]);
      manager.addHttp([{ url: `${url}/three.bin` }]);
      await untilDrained();
      expect(drained).toEqual([undefined]);
    });
  });

  it('leaves a manually stopped queue alone for the rest of the window', () => {
    const manager = create();
    manager.init();
    const queue = manager.createQueue('Night', { scheduler: { enabled: true, startTime: '02:00', stopTime: '08:00' } });
    manager.checkScheduler(new Date(2026, 10, 9, 2, 5));
    manager.stopQueue(queue.id);
    manager.checkScheduler(new Date(2026, 10, 9, 2, 6));
    expect(manager.listQueues().find((q) => q.id === queue.id)?.enabled).toBe(false);
  });
});
