import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, statfs, truncate, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import type { DownloadItem, SegmentState } from '../../shared/types';
import { HttpStatusError, JobCancelledError } from '../media/errors';
import { logger } from '../logger';
import {
  defaultHostPool,
  filenameFromContentDisposition,
  filenameFromUrl,
  headerValue,
  HostConnectionPool,
  httpRequest,
  HttpResponse,
  parseContentRange,
} from './http-client';
import { RateLimiter, sleep } from './throttle';

/** Segments are never made smaller than this, so splitting stays worthwhile. */
export const MIN_SEGMENT_BYTES = 1024 * 1024;
const WRITE_BUFFER_BYTES = 1024 * 1024;
const MAX_BACKOFF_MS = 30_000;

/** The server no longer serves the same bytes (ETag changed, Range ignored, 416...). */
export class ResourceChangedError extends Error {
  public readonly code = 'RESOURCE_CHANGED';
  constructor(message = 'The file on the server changed; the download must restart') {
    super(message);
  }
}

class StragglerError extends Error {
  constructor() {
    super('Straggler connection: throughput significantly below median');
  }
}

export interface ProbeInfo {
  finalUrl: string;
  totalBytes: number | null;
  resumable: boolean;
  serverFileName: string | null;
  mimeType?: string;
  etag?: string;
  lastModified?: string;
}

export interface DownloadSidecarMeta {
  version: 1;
  url: string;
  totalBytes: number | null;
  etag?: string;
  lastModified?: string;
  segments: SegmentState[];
}

export interface HttpTaskContext {
  globalLimiter: RateLimiter;
  itemLimiter: RateLimiter;
  userAgent: string;
  maxRetries: number;
  hostPool?: HostConnectionPool;
  /** First response of a fresh download: lets the manager pick the final name / folder. */
  onProbe(info: ProbeInfo): Promise<void> | void;
  /** Segments changed in a way worth saving (split, finished...). */
  onPersist(): void;
  /** Status / stage changed. */
  onUpdate(): void;
}

export function segmentLength(seg: SegmentState): number | null {
  return seg.end === null ? null : seg.end - seg.start + 1;
}

export function segmentDone(seg: SegmentState): boolean {
  const len = segmentLength(seg);
  return len !== null && seg.received >= len;
}

/** Splits [0, total) into up to `count` equal segments of at least MIN_SEGMENT_BYTES. */
export function planSegments(total: number, count: number): SegmentState[] {
  const n = Math.max(1, Math.min(count, Math.floor(total / MIN_SEGMENT_BYTES) || 1));
  const size = Math.ceil(total / n);
  const segments: SegmentState[] = [];
  for (let i = 0; i < n; i++) {
    const start = i * size;
    if (start >= total) break;
    segments.push({ start, end: Math.min(total, start + size) - 1, received: 0, part: String(i) });
  }
  return segments;
}

/**
 * Takes the largest remaining range among `active` segments and splits off its second half.
 * Returns the new segment, or null when nothing is worth splitting.
 */
export function splitLargest(segments: SegmentState[], active: Iterable<SegmentState>): SegmentState | null {
  let best: SegmentState | null = null;
  let bestRemaining = 0;
  for (const seg of active) {
    if (seg.end === null) continue;
    const remaining = seg.end - (seg.start + seg.received) + 1;
    if (remaining > bestRemaining) {
      best = seg;
      bestRemaining = remaining;
    }
  }
  if (!best || best.end === null || bestRemaining < MIN_SEGMENT_BYTES * 2) return null;

  const position = best.start + best.received;
  const mid = position + Math.floor(bestRemaining / 2);
  const nextPart = Math.max(...segments.map((s) => Number(s.part) || 0)) + 1;
  const created: SegmentState = { start: mid, end: best.end, received: 0, part: String(nextPart) };
  best.end = mid - 1;
  segments.push(created);
  return created;
}

function analyzeResponse(res: HttpResponse): ProbeInfo {
  const contentType = headerValue(res.headers, 'content-type')?.split(';')[0].trim();
  const etag = headerValue(res.headers, 'etag');
  const base = {
    finalUrl: res.finalUrl,
    serverFileName:
      filenameFromContentDisposition(headerValue(res.headers, 'content-disposition')) ?? filenameFromUrl(res.finalUrl),
    mimeType: contentType,
    // Weak validators can't be used with If-Range
    etag: etag && !etag.startsWith('W/') ? etag : undefined,
    lastModified: headerValue(res.headers, 'last-modified'),
  };

  if (res.status === 206) {
    const range = parseContentRange(headerValue(res.headers, 'content-range'));
    return { ...base, totalBytes: range?.total ?? null, resumable: range?.total != null };
  }
  const length = Number(headerValue(res.headers, 'content-length'));
  const totalBytes = Number.isFinite(length) && length > 0 ? length : null;
  const acceptsRanges = headerValue(res.headers, 'accept-ranges')?.toLowerCase() === 'bytes';
  return { ...base, totalBytes, resumable: acceptsRanges && totalBytes !== null };
}

/** Buffers small network chunks into ~1 MB appends for legacy part files. */
class PartWriter {
  private chunks: Buffer[] = [];
  private size = 0;

  private constructor(private handle: import('node:fs/promises').FileHandle) {}

  static async open(path: string): Promise<PartWriter> {
    return new PartWriter(await open(path, 'a'));
  }

  async write(chunk: Buffer): Promise<void> {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size >= WRITE_BUFFER_BYTES) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.size === 0) return;
    const data = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.size);
    this.chunks = [];
    this.size = 0;
    await this.handle.write(data);
  }

  async close(): Promise<void> {
    try {
      await this.flush();
    } finally {
      await this.handle.close();
    }
  }
}

/** Buffers small network chunks and writes them directly at the segment's file offset. */
class SparseSegmentWriter {
  private chunks: Buffer[] = [];
  private size = 0;
  private flushedBytes: number;

  private constructor(
    private handle: import('node:fs/promises').FileHandle,
    private startPos: number,
    initialReceived: number
  ) {
    this.flushedBytes = initialReceived;
  }

  static async open(path: string, startPos: number, initialReceived: number): Promise<SparseSegmentWriter> {
    return new SparseSegmentWriter(await open(path, 'r+'), startPos, initialReceived);
  }

  async write(chunk: Buffer, onFlush?: () => Promise<void> | void): Promise<void> {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size >= WRITE_BUFFER_BYTES) await this.flush(onFlush);
  }

  async flush(onFlush?: () => Promise<void> | void): Promise<void> {
    if (this.size === 0) return;
    const data = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.size);
    const writePos = this.startPos + this.flushedBytes;
    this.chunks = [];
    this.size = 0;
    await this.handle.write(data, 0, data.length, writePos);
    this.flushedBytes += data.length;
    if (onFlush) await onFlush();
  }

  async close(onFlush?: () => Promise<void> | void): Promise<void> {
    try {
      await this.flush(onFlush);
    } finally {
      await this.handle.close();
    }
  }
}

function isFatal(err: unknown): boolean {
  if (err instanceof ResourceChangedError) return true;
  if (err instanceof HttpStatusError) return err.status >= 400 && err.status < 500 && ![408, 425, 429].includes(err.status);
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

function backoffMs(attempt: number, res?: HttpResponse): number {
  const retryAfter = res ? Number(headerValue(res.headers, 'retry-after')) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 120_000);
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1));
  return base / 2 + Math.random() * (base / 2);
}

/**
 * Bytes a download needs free in its folder. Segments are written directly into the pre-allocated
 * sparse file, so only the file size itself is required (no duplicate part assembly).
 */
export function requiredFreeBytes(segments: SegmentState[]): number {
  const lengths = segments.map((s) => segmentLength(s) ?? 0);
  return lengths.reduce((sum, n) => sum + n, 0);
}

/** Fails early, with the same error a full disk gives later, when the folder clearly cannot hold the file. */
async function assertFreeSpace(directory: string, needed: number): Promise<void> {
  if (needed <= 0) return;
  let free: number;
  try {
    const info = await statfs(directory);
    free = info.bavail * info.bsize;
  } catch {
    return; // Unknown (network share, old filesystem): let the download try
  }
  if (free < needed) {
    throw Object.assign(new Error(`Not enough free disk space: ${needed} bytes needed, ${free} available`), { code: 'ENOSPC' });
  }
}

/**
 * One multi-connection HTTP download. Segments are written straight into a sparse
 * `${directory}/${fileName}.gdownload` file at their offsets. Progress is persisted
 * in a small sidecar file (`.gdownload.meta`), making completion an instant rename.
 * Also supports resuming legacy `.grabbit-<id>` part folders.
 */
export class HttpDownloadTask {
  private active = new Set<SegmentState>();
  private isLegacy = false;
  private segmentSpeeds = new Map<string, { bytes: number; lastCheck: number; speed: number; startTime: number }>();

  constructor(
    private readonly item: DownloadItem,
    private readonly ctx: HttpTaskContext
  ) {}

  get activeConnections(): number {
    return this.active.size;
  }

  public get targetPath(): string {
    return join(this.item.directory, `${this.item.fileName}.gdownload`);
  }

  public get metaPath(): string {
    return `${this.targetPath}.meta`;
  }

  public static partDir(item: Pick<DownloadItem, 'directory' | 'id'>): string {
    return join(item.directory, `.grabbit-${item.id}`);
  }

  private partPath(seg: SegmentState): string {
    return join(HttpDownloadTask.partDir(this.item), `${seg.part}.part`);
  }

  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.ctx.userAgent,
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      ...(this.item.headers ?? {}),
    };
    if (this.item.referrer) headers.Referer = this.item.referrer;
    return headers;
  }

  private async saveMeta(): Promise<void> {
    if (this.isLegacy) return;
    const meta: DownloadSidecarMeta = {
      version: 1,
      url: this.item.url,
      totalBytes: this.item.totalBytes,
      etag: this.item.etag,
      lastModified: this.item.lastModified,
      segments: this.item.segments ? this.item.segments.map((s) => ({ ...s })) : [],
    };
    const tmp = `${this.metaPath}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(meta), 'utf8');
      await rename(tmp, this.metaPath);
    } catch {
      // Best effort sidecar write
    }
  }

  /** Downloads every segment directly into `${directory}/${fileName}.gdownload`. Returns that path. */
  public async run(signal: AbortSignal): Promise<string> {
    const item = this.item;
    let adopted: HttpResponse | undefined;

    if (!item.segments || item.segments.length === 0) {
      adopted = await this.probe(signal);
    } else {
      await this.syncWithDisk();
    }

    const segments = item.segments!;
    item.receivedBytes = segments.reduce((sum, s) => sum + s.received, 0);
    item.status = 'downloading';
    this.ctx.onPersist();

    // A shared controller so one fatal error stops every connection
    const internal = new AbortController();
    const onAbort = () => internal.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const workers: Promise<void>[] = [];
      const firstSeg = adopted ? segments.find((s) => s.start === 0) : undefined;
      const workerCount = item.resumable ? Math.max(1, item.connections) : 1;
      for (let i = 0; i < workerCount; i++) {
        workers.push(
          this.worker(internal.signal, i === 0 ? firstSeg : undefined, i === 0 ? adopted : undefined).catch((err) => {
            internal.abort(err);
            throw err;
          })
        );
      }
      const results = await Promise.allSettled(workers);
      if (signal.aborted) throw new JobCancelledError();
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason as unknown);
      // Report the error that stopped the others, not the cancellations it caused
      if (errors.length > 0) throw errors.find((e) => !(e instanceof JobCancelledError)) ?? errors[0];
    } finally {
      signal.removeEventListener('abort', onAbort);
      adopted?.body.destroy();
    }

    // Unknown-size downloads learn their size when the stream ends
    if (item.totalBytes === null) item.totalBytes = item.receivedBytes;
    if (!segments.every(segmentDone)) throw new Error('Download ended before all data was received');

    if (this.isLegacy) {
      return this.assemble(signal);
    }

    const target = this.targetPath;
    const finalSize = (await stat(target)).size;
    if (item.totalBytes !== null && finalSize !== item.totalBytes) {
      const handle = await open(target, 'r+');
      await handle.truncate(item.totalBytes);
      await handle.close();
    }
    await rm(this.metaPath, { force: true });
    return target;
  }

  private async probe(signal: AbortSignal): Promise<HttpResponse | undefined> {
    const item = this.item;
    item.status = 'starting';
    this.ctx.onUpdate();

    let res: HttpResponse | undefined;
    let fallbackInfo: ProbeInfo | undefined;

    try {
      res = await httpRequest(item.url, { headers: { ...this.baseHeaders(), Range: 'bytes=0-' }, signal });
      if (res.status >= 400) {
        res.body.resume();
        res = undefined;
      }
    } catch (err) {
      if (signal.aborted) throw new JobCancelledError();
      res = undefined;
    }

    if (!res) {
      fallbackInfo = await probeUrl(item.url, this.baseHeaders());
    }

    const info = fallbackInfo ?? analyzeResponse(res!);
    item.totalBytes = info.totalBytes;
    item.resumable = info.resumable;
    item.mimeType = info.mimeType;
    item.etag = info.etag;
    item.lastModified = info.lastModified;
    await this.ctx.onProbe(info);

    await mkdir(item.directory, { recursive: true });
    const target = this.targetPath;
    const handle = await open(target, existsSync(target) ? 'r+' : 'w+');
    if (info.totalBytes && info.totalBytes > 0) {
      await handle.truncate(info.totalBytes);
    }
    await handle.close();

    item.segments =
      info.resumable && info.totalBytes
        ? planSegments(info.totalBytes, item.connections)
        : [{ start: 0, end: info.totalBytes ? info.totalBytes - 1 : null, received: 0, part: '0' }];

    await this.saveMeta();

    try {
      await assertFreeSpace(item.directory, requiredFreeBytes(item.segments));
    } catch (err) {
      res?.body.destroy();
      item.segments = undefined;
      throw err;
    }

    // A 200 answer to "bytes=0-" is the whole file; if we split, segment 0 keeps reading it
    // and simply stops at its own end.
    return res;
  }

  /** On resume the sidecar / files on disk are the truth. */
  private async syncWithDisk(): Promise<void> {
    const item = this.item;
    const legacyDir = HttpDownloadTask.partDir(item);

    // Check for legacy .grabbit-<id> part folder
    if (existsSync(legacyDir)) {
      try {
        const entries = await readdir(legacyDir);
        if (entries.some((e) => e.endsWith('.part'))) {
          this.isLegacy = true;
          await this.syncLegacyParts();
          return;
        }
      } catch {
        // Fall through to modern sync
      }
    }

    const target = this.targetPath;
    const metaPath = this.metaPath;

    let meta: DownloadSidecarMeta | null = null;
    if (existsSync(metaPath)) {
      try {
        const raw = await readFile(metaPath, 'utf8');
        meta = JSON.parse(raw) as DownloadSidecarMeta;
      } catch {
        meta = null;
      }
    }

    if (meta && meta.version === 1 && meta.segments && existsSync(target)) {
      const segMap = new Map(meta.segments.map((s) => [s.part, s]));
      for (const seg of item.segments!) {
        const stored = segMap.get(seg.part);
        if (stored) {
          seg.received = stored.received;
          if (stored.end !== null) seg.end = stored.end;
        }
        const len = segmentLength(seg);
        if (len !== null && seg.received > len) {
          seg.received = len;
        }
      }
    }

    if (!item.resumable) {
      for (const seg of item.segments!) {
        seg.received = 0;
      }
      item.segments = item.segments!.slice(0, 1).map((s) => ({ ...s, start: 0, end: item.totalBytes ? item.totalBytes - 1 : null }));
      await rm(target, { force: true });
      await rm(metaPath, { force: true });
      await mkdir(item.directory, { recursive: true });
      const handle = await open(target, 'w+');
      if (item.totalBytes && item.totalBytes > 0) await handle.truncate(item.totalBytes);
      await handle.close();
      await this.saveMeta();
    } else if (existsSync(target) && item.totalBytes) {
      try {
        const currentSize = (await stat(target)).size;
        if (currentSize < item.totalBytes) {
          const handle = await open(target, 'r+');
          await handle.truncate(item.totalBytes);
          await handle.close();
        }
      } catch {
        // ignore
      }
    }
  }

  private async syncLegacyParts(): Promise<void> {
    const item = this.item;
    const dir = HttpDownloadTask.partDir(item);
    await mkdir(dir, { recursive: true });

    for (const seg of item.segments!) {
      let size = 0;
      try {
        size = (await stat(this.partPath(seg))).size;
      } catch {
        size = 0;
      }
      const len = segmentLength(seg);
      if (len !== null && size > len) {
        await truncate(this.partPath(seg), len);
        size = len;
      }
      seg.received = size;
    }

    if (!item.resumable) {
      for (const seg of item.segments!) {
        seg.received = 0;
        await rm(this.partPath(seg), { force: true });
      }
      item.segments = item.segments!.slice(0, 1).map((s) => ({ ...s, start: 0, end: item.totalBytes ? item.totalBytes - 1 : null }));
    }
  }

  private nextSegment(): SegmentState | null {
    const segments = this.item.segments!;
    const idle = segments.find((s) => !this.active.has(s) && !segmentDone(s) && !(s.end === null && s.received > 0));
    if (idle) return idle;
    if (!this.item.resumable) return null;
    const created = splitLargest(segments, this.active);
    if (created) this.ctx.onPersist();
    return created;
  }

  private async worker(signal: AbortSignal, first?: SegmentState, adopted?: HttpResponse): Promise<void> {
    let seg: SegmentState | null | undefined = first;
    let response = adopted;
    while (!signal.aborted) {
      if (this.active.size >= this.item.connections) return;
      seg = seg ?? this.nextSegment();
      if (!seg) return;
      this.active.add(seg);
      this.ctx.onUpdate();
      try {
        await this.downloadSegment(seg, signal, response);
      } finally {
        response = undefined;
        this.active.delete(seg);
        this.ctx.onUpdate();
      }
      seg = undefined;
    }
  }

  private async downloadSegment(seg: SegmentState, signal: AbortSignal, adopted?: HttpResponse): Promise<void> {
    const item = this.item;
    let attempt = 0;
    let response = adopted;

    while (!segmentDone(seg)) {
      if (signal.aborted) throw new JobCancelledError();
      let res: HttpResponse | undefined = response;
      response = undefined;
      const before = seg.received;
      let releaseHost: (() => void) | undefined;
      try {
        if (!res) {
          const host = new URL(item.url).hostname;
          releaseHost = await (this.ctx.hostPool ?? defaultHostPool).acquire(host, signal);
          res = await this.openSegment(seg, signal);
        }
        await this.pump(seg, res, signal);

        if (seg.end === null) {
          // Unknown size: the stream ending is the end of the file
          seg.end = seg.start + seg.received - 1;
          item.totalBytes = seg.received;
          return;
        }
        if (segmentDone(seg)) return;
        throw Object.assign(new Error('Connection closed before the segment finished'), { code: 'ECONNRESET' });
      } catch (err) {
        if (signal.aborted) throw new JobCancelledError();
        if (err instanceof StragglerError) {
          logger.warn({ id: item.id, part: seg.part }, 'Straggler connection dropped; reconnecting segment');
          attempt = 0;
          await sleep(500, signal).catch(() => undefined);
          continue;
        }
        if (isFatal(err)) throw err;

        if (err instanceof HttpStatusError && (err.status === 429 || err.status === 503)) {
          const reduced = Math.max(1, Math.floor(item.connections / 2));
          if (reduced < item.connections) {
            logger.warn(
              { id: item.id, from: item.connections, to: reduced, status: err.status },
              'Reducing connection count due to server rate limit/busy'
            );
            item.connections = reduced;
            this.ctx.onPersist();
          }
        }

        if (seg.received > before) attempt = 0; // progress was made: a fresh failure budget
        attempt++;
        if (attempt > this.ctx.maxRetries) throw err;
        item.retries++;
        const wait = backoffMs(attempt, res);
        logger.warn({ id: item.id, part: seg.part, attempt, wait, err }, 'Segment failed, retrying');
        this.ctx.onUpdate();
        await sleep(wait, signal).catch(() => undefined);
      } finally {
        releaseHost?.();
      }
    }
  }

  private async openSegment(seg: SegmentState, signal: AbortSignal): Promise<HttpResponse> {
    const item = this.item;
    const from = seg.start + seg.received;
    const headers = this.baseHeaders();

    if (!item.resumable) {
      // Can't continue mid-file: restart this (only) segment
      if (seg.received > 0) {
        item.receivedBytes -= seg.received;
        seg.received = 0;
        if (this.isLegacy) {
          await rm(this.partPath(seg), { force: true });
        }
      }
    } else {
      headers.Range = `bytes=${from}-${seg.end ?? ''}`;
      const validator = item.etag ?? item.lastModified;
      if (validator) headers['If-Range'] = validator;
    }

    const res = await httpRequest(item.url, { headers, signal });
    if (res.status === 416) {
      res.body.resume();
      throw new ResourceChangedError('The server rejected the byte range (file changed?)');
    }
    if (res.status >= 400) {
      res.body.resume();
      throw new HttpStatusError(res.status);
    }
    if (item.resumable) {
      if (res.status !== 206) {
        res.body.resume();
        throw new ResourceChangedError(
          res.status === 200 ? 'The server ignored the byte range or the file changed' : `Unexpected HTTP ${res.status}`
        );
      }
      const range = parseContentRange(headerValue(res.headers, 'content-range'));
      if (!range || range.start !== from || (item.totalBytes !== null && range.total !== null && range.total !== item.totalBytes)) {
        res.body.resume();
        throw new ResourceChangedError('The server returned a different byte range');
      }
    }
    return res;
  }

  /** Streams the response into the segment's file region until the (possibly shrunk) segment end. */
  private async pump(seg: SegmentState, res: HttpResponse, signal: AbortSignal): Promise<void> {
    const item = this.item;
    const segKey = seg.part;
    const now = Date.now();
    this.segmentSpeeds.set(segKey, { bytes: 0, lastCheck: now, speed: 0, startTime: now });

    if (this.isLegacy) {
      const writer = await PartWriter.open(this.partPath(seg));
      try {
        for await (const raw of res.body) {
          const chunk = raw as Buffer;
          await Promise.all([this.ctx.globalLimiter.take(chunk.length, signal), this.ctx.itemLimiter.take(chunk.length, signal)]);
          if (signal.aborted) break;
          const remaining = seg.end === null ? Infinity : seg.end - (seg.start + seg.received) + 1;
          if (remaining <= 0) break;
          const piece = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
          seg.received += piece.length;
          item.receivedBytes += piece.length;
          await writer.write(piece);
          this.recordSegmentChunk(segKey, piece.length);
          if (piece.length < chunk.length || segmentDone(seg)) break;
        }
      } finally {
        this.segmentSpeeds.delete(segKey);
        res.body.destroy();
        await writer.close();
      }
      return;
    }

    const writer = await SparseSegmentWriter.open(this.targetPath, seg.start, seg.received);
    try {
      for await (const raw of res.body) {
        const chunk = raw as Buffer;
        await Promise.all([this.ctx.globalLimiter.take(chunk.length, signal), this.ctx.itemLimiter.take(chunk.length, signal)]);
        if (signal.aborted) break;
        const remaining = seg.end === null ? Infinity : seg.end - (seg.start + seg.received) + 1;
        if (remaining <= 0) break;
        const piece = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        seg.received += piece.length;
        item.receivedBytes += piece.length;
        await writer.write(piece, () => this.saveMeta());
        this.recordSegmentChunk(segKey, piece.length);
        if (piece.length < chunk.length || segmentDone(seg)) break;
      }
    } finally {
      this.segmentSpeeds.delete(segKey);
      res.body.destroy();
      await writer.close(() => this.saveMeta());
    }
  }

  private recordSegmentChunk(segKey: string, bytes: number): void {
    const tracker = this.segmentSpeeds.get(segKey);
    if (!tracker) return;
    tracker.bytes += bytes;
    const now = Date.now();
    const elapsed = (now - tracker.lastCheck) / 1000;
    if (elapsed >= 2) {
      tracker.speed = tracker.bytes / elapsed;
      tracker.bytes = 0;
      tracker.lastCheck = now;
      if (this.active.size >= 3 && now - tracker.startTime >= 6000) {
        const speeds = [...this.segmentSpeeds.values()].map((s) => s.speed).sort((a, b) => a - b);
        const median = speeds[Math.floor(speeds.length / 2)] ?? 0;
        if (median > 50 * 1024 && tracker.speed < 0.2 * median) {
          throw new StragglerError();
        }
      }
    }
  }

  /** Joins legacy parts in byte order into `<file>.gdownload` and returns its path. */
  private async assemble(signal: AbortSignal): Promise<string> {
    const item = this.item;
    item.status = 'processing';
    this.ctx.onUpdate();

    const segments = [...item.segments!].sort((a, b) => a.start - b.start);
    let expected = 0;
    for (const seg of segments) {
      if (seg.start !== expected) throw new Error(`Missing bytes at offset ${expected}`);
      expected = (seg.end ?? 0) + 1;
    }

    const target = this.targetPath;
    await rm(target, { force: true });
    await rename(this.partPath(segments[0]), target);
    for (const seg of segments.slice(1)) {
      if (signal.aborted) throw new JobCancelledError();
      await pipeline(createReadStream(this.partPath(seg)), createWriteStream(target, { flags: 'a' }), { signal });
    }

    const size = (await stat(target)).size;
    if (item.totalBytes !== null && size !== item.totalBytes) {
      throw new Error(`Assembled file is ${size} bytes, expected ${item.totalBytes}`);
    }
    await rm(HttpDownloadTask.partDir(item), { recursive: true, force: true });
    return target;
  }

  /** Deletes the working files/folders of an item (used on remove / restart). */
  public static async discardParts(item: Pick<DownloadItem, 'directory' | 'fileName' | 'id'>): Promise<void> {
    const dir = HttpDownloadTask.partDir(item);
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
    const target = join(item.directory, `${item.fileName}.gdownload`);
    const meta = `${target}.meta`;
    if (existsSync(target)) await rm(target, { force: true });
    if (existsSync(meta)) await rm(meta, { force: true });
  }
}

/** Quick look at a URL with multi-stage fallback: Range 0-0 -> HEAD -> Range 0- -> GET. */
export async function probeUrl(url: string, headers: Record<string, string>): Promise<ProbeInfo> {
  const baseHeaders = { Accept: '*/*', 'Accept-Encoding': 'identity', ...headers };

  // Try 1: Range bytes=0-0
  try {
    const res = await httpRequest(url, {
      headers: { ...baseHeaders, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(20_000),
    });
    res.body.destroy();
    if (res.status < 400) return analyzeResponse(res);
  } catch (err) {
    if (err instanceof JobCancelledError) throw err;
  }

  // Try 2: HEAD request
  try {
    const res = await httpRequest(url, {
      method: 'HEAD',
      headers: baseHeaders,
      signal: AbortSignal.timeout(20_000),
    });
    res.body.destroy();
    if (res.status < 400) return analyzeResponse(res);
  } catch (err) {
    if (err instanceof JobCancelledError) throw err;
  }

  // Try 3: Range bytes=0-
  try {
    const res = await httpRequest(url, {
      headers: { ...baseHeaders, Range: 'bytes=0-' },
      signal: AbortSignal.timeout(20_000),
    });
    res.body.destroy();
    if (res.status < 400) return analyzeResponse(res);
  } catch (err) {
    if (err instanceof JobCancelledError) throw err;
  }

  // Try 4: Plain GET request
  const res = await httpRequest(url, {
    headers: baseHeaders,
    signal: AbortSignal.timeout(20_000),
  });
  res.body.destroy();
  if (res.status >= 400) throw new HttpStatusError(res.status);
  return analyzeResponse(res);
}
