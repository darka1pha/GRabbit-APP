import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DownloadItem } from '../src/shared/types';
import {
  HttpDownloadTask,
  MIN_SEGMENT_BYTES,
  planSegments,
  segmentDone,
  splitLargest,
} from '../src/main/downloads/http-engine';
import { filenameFromContentDisposition, parseContentRange } from '../src/main/downloads/http-client';
import { RateLimiter } from '../src/main/downloads/throttle';

const FILE = randomBytes(9 * 1024 * 1024 + 12345);
const FILE_SHA = createHash('sha256').update(FILE).digest('hex');

let server: http.Server;
let base = '';
let throttleMs = 0;
let requests: { path: string; range?: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push({ path: req.url ?? '', range: req.headers.range });
    const url = req.url ?? '';
    if (url.startsWith('/redirect')) {
      res.writeHead(302, { Location: '/file.bin' });
      res.end();
      return;
    }
    if (url.startsWith('/gone')) {
      res.writeHead(403);
      res.end('nope');
      return;
    }
    const ranged = url.startsWith('/file') || url.startsWith('/named');
    const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'application/octet-stream', ETag: '"v1"' };
    if (url.startsWith('/named')) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent('گزارش نهایی.bin')}`;

    const range = ranged ? /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '') : null;
    let start = 0;
    let end = FILE.length - 1;
    if (range) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), FILE.length - 1) : FILE.length - 1;
      headers['Content-Range'] = `bytes ${start}-${end}/${FILE.length}`;
      headers['Accept-Ranges'] = 'bytes';
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
    } else {
      headers['Content-Length'] = FILE.length;
      res.writeHead(200, headers);
    }

    // Stream in 64 KB pieces so aborts can land mid-transfer
    let pos = start;
    const pump = () => {
      while (pos <= end) {
        const next = Math.min(end + 1, pos + 64 * 1024);
        const ok = res.write(FILE.subarray(pos, next));
        pos = next;
        if (throttleMs) {
          setTimeout(pump, throttleMs);
          return;
        }
        if (!ok) {
          res.once('drain', pump);
          return;
        }
      }
      res.end();
    };
    pump();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

function makeItem(dir: string, url: string, connections = 4): DownloadItem {
  return {
    id: `t${Math.random().toString(16).slice(2)}`,
    kind: 'http',
    url,
    fileName: 'out.bin',
    directory: dir,
    category: 'other',
    status: 'queued',
    totalBytes: null,
    receivedBytes: 0,
    speed: 0,
    eta: null,
    resumable: false,
    connections,
    activeConnections: 0,
    retries: 0,
    createdAt: Date.now(),
  };
}

function makeTask(item: DownloadItem, onProbe?: (name: string | null) => void) {
  return new HttpDownloadTask(item, {
    globalLimiter: new RateLimiter(),
    itemLimiter: new RateLimiter(),
    userAgent: 'test',
    maxRetries: 2,
    onProbe: (info) => onProbe?.(info.serverFileName),
    onPersist: () => undefined,
    onUpdate: () => undefined,
  });
}

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('segment planning', () => {
  it('splits a file into equal contiguous segments', () => {
    const segs = planSegments(10 * MIN_SEGMENT_BYTES + 7, 4);
    expect(segs).toHaveLength(4);
    expect(segs[0].start).toBe(0);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end! + 1);
    expect(segs[segs.length - 1].end).toBe(10 * MIN_SEGMENT_BYTES + 6);
  });

  it('never makes segments smaller than the minimum', () => {
    expect(planSegments(MIN_SEGMENT_BYTES * 2, 16)).toHaveLength(2);
    expect(planSegments(1000, 8)).toHaveLength(1);
  });

  it('splits the largest active segment in half', () => {
    const segs = planSegments(8 * MIN_SEGMENT_BYTES, 2);
    segs[0].received = segs[0].end! + 1; // finished
    const created = splitLargest(segs, [segs[1]]);
    expect(created).not.toBeNull();
    expect(segs[1].end! + 1).toBe(created!.start);
    expect(created!.end).toBe(8 * MIN_SEGMENT_BYTES - 1);
    expect(segmentDone(segs[0])).toBe(true);
  });
});

describe('header parsing', () => {
  it('reads RFC 5987 and plain file names', () => {
    expect(filenameFromContentDisposition(`attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`)).toBe('résumé.pdf');
    expect(filenameFromContentDisposition('attachment; filename="a \\"b\\".zip"')).toBe('a "b".zip');
    expect(filenameFromContentDisposition('inline; filename=plain.txt')).toBe('plain.txt');
    expect(filenameFromContentDisposition(undefined)).toBeNull();
  });

  it('parses Content-Range', () => {
    expect(parseContentRange('bytes 0-99/1234')).toEqual({ start: 0, end: 99, total: 1234 });
    expect(parseContentRange('bytes 5-9/*')).toEqual({ start: 5, end: 9, total: null });
  });
});

describe('HttpDownloadTask', () => {
  it('downloads with several connections and reassembles the exact bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grabbit-'));
    try {
      requests = [];
      const item = makeItem(dir, `${base}/file.bin`, 6);
      const path = await makeTask(item).run(new AbortController().signal);
      expect(item.resumable).toBe(true);
      expect(item.totalBytes).toBe(FILE.length);
      expect(sha(path)).toBe(FILE_SHA);
      expect(requests.filter((r) => r.path === '/file.bin').length).toBeGreaterThanOrEqual(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('follows redirects and picks up the server file name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grabbit-'));
    try {
      let name: string | null = null;
      const item = makeItem(dir, `${base}/named`, 2);
      const path = await makeTask(item, (n) => (name = n)).run(new AbortController().signal);
      expect(name).toBe('گزارش نهایی.bin');
      expect(sha(path)).toBe(FILE_SHA);

      const redirected = makeItem(dir, `${base}/redirect`, 2);
      redirected.fileName = 'r.bin';
      expect(sha(await makeTask(redirected).run(new AbortController().signal))).toBe(FILE_SHA);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resumes after a pause without re-downloading finished bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grabbit-'));
    try {
      // ~2.5 MB/s per connection: a 9 MB file takes about a second on 4 connections
      throttleMs = 25;
      const item = makeItem(dir, `${base}/file.bin`, 4);
      const controller = new AbortController();
      const first = makeTask(item).run(controller.signal);
      await new Promise((r) => setTimeout(r, 300));
      controller.abort();
      await expect(first).rejects.toThrow();
      const before = item.segments!.reduce((s, x) => s + x.received, 0);
      expect(before).toBeGreaterThan(0);
      expect(before).toBeLessThan(FILE.length);

      throttleMs = 0;
      requests = [];
      const path = await makeTask(item).run(new AbortController().signal);
      expect(sha(path)).toBe(FILE_SHA);
      // Every resumed request starts past the bytes already on disk
      const resumedFromZero = requests.filter((r) => r.range?.startsWith('bytes=0-'));
      expect(resumedFromZero.length).toBe(0);
    } finally {
      throttleMs = 0;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to a single connection when the server ignores ranges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grabbit-'));
    try {
      const item = makeItem(dir, `${base}/plain`, 8);
      const path = await makeTask(item).run(new AbortController().signal);
      expect(item.resumable).toBe(false);
      expect(item.segments).toHaveLength(1);
      expect(sha(path)).toBe(FILE_SHA);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails fast on HTTP 403 with a LINK_EXPIRED code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grabbit-'));
    try {
      const item = makeItem(dir, `${base}/gone`, 2);
      await expect(makeTask(item).run(new AbortController().signal)).rejects.toMatchObject({ code: 'LINK_EXPIRED' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('RateLimiter', () => {
  it('holds throughput near the configured rate', async () => {
    const limiter = new RateLimiter(512 * 1024);
    const started = performance.now();
    for (let i = 0; i < 16; i++) await limiter.take(64 * 1024);
    const seconds = (performance.now() - started) / 1000;
    // 1 MB at 512 KB/s ≈ 2 s, minus the 200 ms burst allowance
    expect(seconds).toBeGreaterThan(1.6);
    expect(seconds).toBeLessThan(2.6);
  });
});
