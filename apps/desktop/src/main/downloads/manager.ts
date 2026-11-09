import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { shell } from 'electron';
import type {
  AddHttpDownloadRequest,
  AddMediaDownloadRequest,
  AppSettings,
  Category,
  ChecksumAlgorithm,
  DownloadItem,
  DownloadQueue,
  DownloadStatus,
} from '../../shared/types';
import { codeOf, JobCancelledError } from '../media/errors';
import { sanitizeFilename, splitExtension } from '../media/filename';
import { parseHttpUrl } from '../media/url-parser';
import type { PlatformRouter } from '../media/router';
import { logger } from '../logger';
import { JsonStore } from '../store';
import { CATEGORY_FOLDERS, categoryForFileName, categoryForMime, extensionForMime } from './categories';
import { filenameFromUrl } from './http-client';
import { HttpDownloadTask, ProbeInfo, ResourceChangedError } from './http-engine';
import { MediaDownloadTask } from './media-engine';
import { hashFile, moveFile, uniqueFileName } from './files';
import { RateLimiter } from './throttle';

const TICK_MS = 500;
const FLUSH_MS = 250;
const ACTIVE_STATUSES: DownloadStatus[] = ['starting', 'downloading', 'processing'];
const MAX_AUTO_RESTARTS = 2;

export interface ManagerDeps {
  dataDir: string;
  tempRoot: string;
  router: PlatformRouter;
  getSettings(): AppSettings;
  onItemsChanged(items: DownloadItem[]): void;
  onItemsRemoved(ids: string[]): void;
  onOrderChanged(ids: string[]): void;
  onQueuesChanged?(queues: DownloadQueue[]): void;
  onCompleted(item: DownloadItem): void;
  onFailed(item: DownloadItem): void;
  /** Every queued download has finished (at least one did during this run). */
  onQueueDrained(): void;
  onAggregateProgress(progress: {
    fraction: number | null;
    active: number;
    hasError?: boolean;
    hasPaused?: boolean;
  }): void;
}

interface RunningEntry {
  controller: AbortController;
  promise: Promise<void>;
  http?: HttpDownloadTask;
  /** What the item becomes once its task stops after an abort. */
  stopAs: DownloadStatus;
  lastBytes: number;
}

export class DownloadManager {
  private items = new Map<string, DownloadItem>();
  private order: string[] = [];
  private queues = new Map<string, DownloadQueue>();
  private running = new Map<string, RunningEntry>();
  private limiters = new Map<string, RateLimiter>();
  private restarts = new Map<string, number>();
  private dirty = new Set<string>();
  private store: JsonStore<DownloadItem[]>;
  private queueStore: JsonStore<DownloadQueue[]>;
  private globalLimiter = new RateLimiter();
  private flushTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private finishedSinceIdle = 0;
  private ticksSinceSave = 0;
  private schedulerFired = { start: '', stop: '' };
  private queueSchedulerFired = new Map<string, { start: string; stop: string }>();

  constructor(private readonly deps: ManagerDeps) {
    this.store = new JsonStore<DownloadItem[]>(join(deps.dataDir, 'downloads.json'), 1500);
    this.queueStore = new JsonStore<DownloadQueue[]>(join(deps.dataDir, 'queues.json'), 1500);
  }

  // ---------------------------------------------------------------- lifecycle

  public init(): void {
    const settings = this.deps.getSettings();

    const defaultQueues: DownloadQueue[] = [
      {
        id: 'main',
        name: 'Main Queue',
        enabled: true,
        maxConcurrent: 2,
        order: [],
      },
      {
        id: 'scheduled',
        name: 'Scheduled Queue',
        enabled: false,
        maxConcurrent: 1,
        scheduler: { enabled: true, startTime: '02:00', stopTime: '08:00' },
        afterQueue: 'stopQueue',
        order: [],
      },
    ];

    const loadedQueues = this.queueStore.load(defaultQueues);
    for (const q of (loadedQueues.length > 0 ? loadedQueues : defaultQueues)) {
      this.queues.set(q.id, { ...q, order: q.order || [] });
    }
    if (!this.queues.has('main')) {
      this.queues.set('main', defaultQueues[0]);
    }

    for (const item of this.store.load([])) {
      if (!item?.id) continue;
      if (ACTIVE_STATUSES.includes(item.status)) item.status = settings.resumeOnStartup ? 'queued' : 'paused';
      item.speed = 0;
      item.eta = null;
      item.activeConnections = 0;

      // Assign to main queue if queueId is missing or unknown
      if (!item.queueId || !this.queues.has(item.queueId)) {
        item.queueId = 'main';
      }
      const q = this.queues.get(item.queueId)!;
      if (!q.order.includes(item.id)) {
        q.order.push(item.id);
      }

      this.items.set(item.id, item);
      this.order.push(item.id);
    }
    this.applySettings(settings);
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.pump();
  }

  public applySettings(settings: AppSettings): void {
    this.globalLimiter.setRate(settings.globalSpeedLimitKBps * 1024);
    this.pump();
  }

  /** Stops every task and saves synchronously (app quit). Running items resume next launch. */
  public shutdown(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    const resume = this.deps.getSettings().resumeOnStartup;
    for (const [id, entry] of this.running) {
      entry.stopAs = resume ? 'queued' : 'paused';
      const item = this.items.get(id);
      if (item) item.status = entry.stopAs;
      entry.controller.abort(new JobCancelledError());
    }
    this.store.saveSync(this.snapshot());
    this.queueStore.saveSync(Array.from(this.queues.values()));
  }

  // ---------------------------------------------------------------- queries

  public list(): DownloadItem[] {
    return this.snapshot();
  }

  private snapshot(): DownloadItem[] {
    return this.order.map((id) => this.items.get(id)!).filter(Boolean);
  }

  public get(id: string): DownloadItem | undefined {
    return this.items.get(id);
  }

  public hasActive(): boolean {
    return this.running.size > 0;
  }

  // ---------------------------------------------------------------- adding

  private directoryFor(category: Category): string {
    const settings = this.deps.getSettings();
    return settings.categorySubfolders ? join(settings.downloadDir, CATEGORY_FOLDERS[category]) : settings.downloadDir;
  }

  /** Names other unfinished downloads in `directory` will use. */
  private reservedNames(directory: string, exceptId?: string): Set<string> {
    const names = new Set<string>();
    for (const item of this.items.values()) {
      if (item.id !== exceptId && item.status !== 'completed' && item.directory === directory) {
        names.add(item.fileName.toLowerCase());
      }
    }
    return names;
  }

  public addHttp(requests: AddHttpDownloadRequest[]): DownloadItem[] {
    const settings = this.deps.getSettings();
    const added: DownloadItem[] = [];
    for (const req of requests) {
      const url = parseHttpUrl(req.url).toString();
      const lockedName = req.fileName?.trim() ? sanitizeFilename(req.fileName) : undefined;
      const guessed = lockedName ?? sanitizeFilename(filenameFromUrl(url) ?? '', 'download');
      const category = req.category ?? categoryForFileName(guessed);
      const directory = req.directory?.trim() || this.directoryFor(category);
      const queueId = req.queueId && this.queues.has(req.queueId) ? req.queueId : 'main';
      const item: DownloadItem = {
        id: randomUUID(),
        kind: 'http',
        url,
        referrer: req.referrer?.trim() || undefined,
        fileName: uniqueFileName(directory, guessed, this.reservedNames(directory)),
        fileNameLocked: Boolean(lockedName),
        directory,
        autoPlace: !req.directory && !req.category,
        category,
        queueId,
        status: req.startPaused ? 'paused' : 'queued',
        totalBytes: null,
        receivedBytes: 0,
        speed: 0,
        eta: null,
        resumable: false,
        connections: Math.max(1, Math.min(32, req.connections ?? settings.defaultConnections)),
        activeConnections: 0,
        headers: req.headers && Object.keys(req.headers).length > 0 ? req.headers : undefined,
        speedLimit: req.speedLimitKBps ? req.speedLimitKBps * 1024 : 0,
        checksum: req.checksum?.expected
          ? { algorithm: req.checksum.algorithm, expected: req.checksum.expected.trim().toLowerCase() }
          : undefined,
        retries: 0,
        createdAt: Date.now(),
      };
      this.insert(item);
      added.push(item);
    }
    this.persist();
    this.pump();
    return added;
  }

  public addMedia(requests: AddMediaDownloadRequest[]): DownloadItem[] {
    const added: DownloadItem[] = [];
    for (const req of requests) {
      const ext = req.format === 'audio' ? (req.qualityId === 'm4a' ? 'm4a' : req.qualityId === 'flac' ? 'flac' : 'mp3') : 'mp4';
      const category: Category = req.format === 'audio' ? 'music' : 'video';
      const directory = req.directory?.trim() || this.directoryFor(category);
      const queueId = req.queueId && this.queues.has(req.queueId) ? req.queueId : 'main';
      const name = sanitizeFilename(`${req.title}.${ext}`, `${req.platform}-${req.mediaId}.${ext}`);
      const item: DownloadItem = {
        id: randomUUID(),
        kind: 'media',
        url: req.url,
        fileName: uniqueFileName(directory, name, this.reservedNames(directory)),
        directory,
        category,
        queueId,
        status: req.startPaused ? 'paused' : 'queued',
        totalBytes: req.estimatedSizeBytes ?? null,
        receivedBytes: 0,
        speed: 0,
        eta: null,
        percent: 0,
        resumable: true,
        connections: 1,
        activeConnections: 0,
        retries: 0,
        createdAt: Date.now(),
        media: {
          platform: req.platform,
          mediaId: req.mediaId,
          format: req.format,
          qualityId: req.qualityId,
          title: req.title,
          author: req.author,
          thumbnailUrl: req.thumbnailUrl,
          durationSeconds: req.durationSeconds,
          estimatedSizeBytes: req.estimatedSizeBytes,
        },
      };
      this.insert(item);
      added.push(item);
    }
    this.persist();
    this.pump();
    return added;
  }

  private insert(item: DownloadItem): void {
    this.items.set(item.id, item);
    this.order.push(item.id);
    const q = this.queues.get(item.queueId || 'main');
    if (q && !q.order.includes(item.id)) {
      q.order.push(item.id);
      this.persistQueues();
    }
    this.markDirty(item);
  }

  // ---------------------------------------------------------------- control

  public pause(ids: string[]): void {
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item) continue;
      const entry = this.running.get(id);
      if (entry) {
        entry.stopAs = 'paused';
        entry.controller.abort(new JobCancelledError());
      } else if (item.status === 'queued') {
        item.status = 'paused';
        this.markDirty(item);
      }
    }
    this.persist();
  }

  public resume(ids: string[]): void {
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item || this.running.has(id)) continue;
      if (item.status === 'paused' || item.status === 'error') {
        item.status = 'queued';
        item.error = undefined;
        item.errorCode = undefined;
        this.markDirty(item);
      }
    }
    this.persist();
    this.pump();
  }

  public retry(ids: string[]): void {
    for (const id of ids) {
      const item = this.items.get(id);
      if (item) {
        item.retries = 0;
        this.restarts.delete(id);
      }
    }
    this.resume(ids);
  }

  public pauseAll(): void {
    this.pause(this.order.filter((id) => {
      const s = this.items.get(id)?.status;
      return s === 'queued' || (s !== undefined && ACTIVE_STATUSES.includes(s));
    }));
  }

  public resumeAll(): void {
    this.resume(this.order.filter((id) => this.items.get(id)?.status === 'paused'));
  }

  /** Stops (and awaits) a running task. */
  private async stop(id: string): Promise<void> {
    const entry = this.running.get(id);
    if (!entry) return;
    entry.stopAs = 'paused';
    entry.controller.abort(new JobCancelledError());
    await entry.promise.catch(() => undefined);
  }

  public async remove(ids: string[], deleteFiles: boolean): Promise<void> {
    const removed: string[] = [];
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item) continue;
      await this.stop(id);
      await this.discardWork(item);
      if (deleteFiles && item.status === 'completed' && item.filePath && existsSync(item.filePath)) {
        // Recycle Bin, not a permanent delete
        await shell.trashItem(item.filePath).catch((err) => logger.warn({ err }, 'Could not move file to the Recycle Bin'));
      }
      this.items.delete(id);
      this.limiters.delete(id);
      this.restarts.delete(id);
      this.dirty.delete(id);
      removed.push(id);
    }
    this.order = this.order.filter((id) => !removed.includes(id));
    for (const q of this.queues.values()) {
      q.order = q.order.filter((id) => !removed.includes(id));
    }
    this.persistQueues();
    if (removed.length > 0) this.deps.onItemsRemoved(removed);
    this.persist();
    this.pump();
  }

  public async clearCompleted(): Promise<void> {
    await this.remove(
      this.order.filter((id) => this.items.get(id)?.status === 'completed'),
      false
    );
  }

  public move(id: string, direction: 'up' | 'down' | 'top' | 'bottom'): void {
    const index = this.order.indexOf(id);
    if (index < 0) return;
    this.order.splice(index, 1);
    const target =
      direction === 'top' ? 0 : direction === 'bottom' ? this.order.length : direction === 'up' ? Math.max(0, index - 1) : Math.min(this.order.length, index + 1);
    this.order.splice(target, 0, id);
    this.deps.onOrderChanged([...this.order]);

    const item = this.items.get(id);
    if (item?.queueId && this.queues.has(item.queueId)) {
      const q = this.queues.get(item.queueId)!;
      const qIndex = q.order.indexOf(id);
      if (qIndex >= 0) {
        q.order.splice(qIndex, 1);
        const qTarget =
          direction === 'top' ? 0 : direction === 'bottom' ? q.order.length : direction === 'up' ? Math.max(0, qIndex - 1) : Math.min(q.order.length, qIndex + 1);
        q.order.splice(qTarget, 0, id);
        this.persistQueues();
      }
    }

    this.persist();
  }

  public async changeUrl(id: string, url: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;
    const parsed = parseHttpUrl(url).toString();
    await this.stop(id);
    item.url = parsed;
    if (item.status !== 'completed') {
      item.status = 'paused';
      item.error = undefined;
      item.errorCode = undefined;
    }
    this.markDirty(item);
    this.persist();
  }

  public setSpeedLimit(id: string, kbps: number): void {
    const item = this.items.get(id);
    if (!item) return;
    item.speedLimit = Math.max(0, kbps) * 1024;
    this.limiters.get(id)?.setRate(item.speedLimit);
    this.markDirty(item);
    this.persist();
  }

  public async verifyChecksum(id: string, algorithm: ChecksumAlgorithm, expected?: string): Promise<DownloadItem> {
    const item = this.items.get(id);
    if (!item?.filePath || !existsSync(item.filePath)) throw new Error('The file is not available');
    const actual = await hashFile(item.filePath, algorithm);
    const want = expected?.trim().toLowerCase() || undefined;
    item.checksum = { algorithm, expected: want, actual, verified: want ? want === actual : undefined };
    this.markDirty(item);
    this.persist();
    return item;
  }

  // ---------------------------------------------------------------- scheduling

  private pump(): void {
    const globalMax = this.deps.getSettings().maxConcurrent;
    if (this.running.size >= globalMax) return;

    for (const queue of this.queues.values()) {
      if (!queue.enabled) continue;
      const activeInQueue = Array.from(this.running.keys()).filter((id) => this.items.get(id)?.queueId === queue.id).length;
      let slots = Math.max(0, queue.maxConcurrent - activeInQueue);

      for (const id of queue.order) {
        if (slots <= 0 || this.running.size >= globalMax) break;
        const item = this.items.get(id);
        if (item?.status === 'queued' && !this.running.has(id)) {
          this.start(item);
          slots--;
        }
      }
    }
  }

  // ---------------------------------------------------------------- queues

  public listQueues(): DownloadQueue[] {
    return Array.from(this.queues.values());
  }

  public createQueue(name: string, options?: Partial<DownloadQueue>): DownloadQueue {
    const queue: DownloadQueue = {
      id: randomUUID(),
      name: name.trim() || 'New Queue',
      enabled: false,
      maxConcurrent: options?.maxConcurrent ?? 1,
      scheduler: options?.scheduler,
      afterQueue: options?.afterQueue ?? 'none',
      order: [],
    };
    this.queues.set(queue.id, queue);
    this.persistQueues();
    return queue;
  }

  public updateQueue(id: string, patch: Partial<DownloadQueue>): DownloadQueue {
    const queue = this.queues.get(id);
    if (!queue) throw new Error(`Queue not found: ${id}`);
    if (patch.name !== undefined) queue.name = patch.name.trim();
    if (patch.maxConcurrent !== undefined) queue.maxConcurrent = Math.max(1, Math.min(16, patch.maxConcurrent));
    if (patch.scheduler !== undefined) queue.scheduler = patch.scheduler;
    if (patch.afterQueue !== undefined) queue.afterQueue = patch.afterQueue;
    if (patch.enabled !== undefined) queue.enabled = patch.enabled;
    this.persistQueues();
    this.pump();
    return queue;
  }

  public deleteQueue(id: string): void {
    if (id === 'main') throw new Error('Cannot delete main queue');
    const queue = this.queues.get(id);
    if (!queue) return;
    const mainQueue = this.queues.get('main');
    for (const itemId of queue.order) {
      const item = this.items.get(itemId);
      if (item) {
        item.queueId = 'main';
        if (mainQueue && !mainQueue.order.includes(itemId)) {
          mainQueue.order.push(itemId);
        }
        this.markDirty(item);
      }
    }
    this.queues.delete(id);
    this.persistQueues();
    this.persist();
    this.pump();
  }

  public startQueue(id: string): void {
    const queue = this.queues.get(id);
    if (!queue) return;
    queue.enabled = true;
    for (const itemId of queue.order) {
      const item = this.items.get(itemId);
      if (item && (item.status === 'paused' || item.status === 'error')) {
        item.status = 'queued';
        item.error = undefined;
        this.markDirty(item);
      }
    }
    this.persistQueues();
    this.persist();
    this.pump();
  }

  public stopQueue(id: string): void {
    const queue = this.queues.get(id);
    if (!queue) return;
    queue.enabled = false;
    for (const itemId of queue.order) {
      const item = this.items.get(itemId);
      if (!item) continue;
      const entry = this.running.get(itemId);
      if (entry) {
        entry.stopAs = 'paused';
        entry.controller.abort(new JobCancelledError());
      } else if (item.status === 'queued') {
        item.status = 'paused';
        this.markDirty(item);
      }
    }
    this.persistQueues();
    this.persist();
  }

  public moveItemToQueue(itemId: string, targetQueueId: string): void {
    const item = this.items.get(itemId);
    if (!item) return;
    const targetQueue = this.queues.get(targetQueueId);
    if (!targetQueue) return;
    const currentQueueId = item.queueId || 'main';
    const currentQueue = this.queues.get(currentQueueId);
    if (currentQueue) {
      currentQueue.order = currentQueue.order.filter((id) => id !== itemId);
    }
    item.queueId = targetQueueId;
    if (!targetQueue.order.includes(itemId)) {
      targetQueue.order.push(itemId);
    }
    this.markDirty(item);
    this.persistQueues();
    this.persist();
    this.pump();
  }

  public reorderQueue(queueId: string, order: string[]): void {
    const queue = this.queues.get(queueId);
    if (!queue) return;
    queue.order = order;
    this.persistQueues();
  }

  private persistQueues(): void {
    this.queueStore.save(() => Array.from(this.queues.values()));
    this.deps.onQueuesChanged?.(Array.from(this.queues.values()));
  }

  private checkQueueDrained(queueId: string): void {
    const queue = this.queues.get(queueId);
    if (!queue || !queue.enabled) return;
    const hasPending = queue.order.some((id) => {
      const item = this.items.get(id);
      return item && (item.status === 'queued' || ACTIVE_STATUSES.includes(item.status));
    });
    if (!hasPending && queue.order.length > 0) {
      logger.info({ queueId, queueName: queue.name }, 'Queue finished all downloads');
      if (queue.afterQueue === 'stopQueue') {
        queue.enabled = false;
        this.persistQueues();
      } else if (queue.afterQueue && queue.afterQueue !== 'none') {
        this.deps.onQueueDrained();
      }
    }
  }

  private itemLimiter(item: DownloadItem): RateLimiter {
    let limiter = this.limiters.get(item.id);
    if (!limiter) {
      limiter = new RateLimiter(item.speedLimit ?? 0);
      this.limiters.set(item.id, limiter);
    }
    return limiter;
  }

  private start(item: DownloadItem): void {
    const controller = new AbortController();
    const entry: RunningEntry = { controller, promise: Promise.resolve(), stopAs: 'paused', lastBytes: item.receivedBytes };
    this.running.set(item.id, entry);
    item.status = 'starting';
    item.startedAt ??= Date.now();
    item.error = undefined;
    item.errorCode = undefined;
    this.markDirty(item);

    const work = item.kind === 'http' ? this.runHttp(item, entry) : this.runMedia(item, entry);
    entry.promise = work
      .then(() => this.onSuccess(item))
      .catch((err) => this.onFailure(item, entry, err))
      .finally(() => {
        this.running.delete(item.id);
        item.speed = 0;
        item.eta = null;
        item.activeConnections = 0;
        if (item.media) item.media.stage = undefined;
        this.markDirty(item);
        this.persist();
        this.pump();
        this.checkQueueDrained(item.queueId || 'main');
        this.checkDrained();
      });
  }

  private async runHttp(item: DownloadItem, entry: RunningEntry): Promise<void> {
    const settings = this.deps.getSettings();
    const task = new HttpDownloadTask(item, {
      globalLimiter: this.globalLimiter,
      itemLimiter: this.itemLimiter(item),
      userAgent: settings.userAgent,
      maxRetries: settings.maxRetries,
      onProbe: (info) => this.applyProbe(item, info),
      onPersist: () => this.persist(),
      onUpdate: () => this.markDirty(item),
    });
    entry.http = task;
    await mkdir(item.directory, { recursive: true });
    const tempFile = await task.run(entry.controller.signal);

    // A file with the same name may have appeared meanwhile
    let finalName = item.fileName;
    if (existsSync(join(item.directory, finalName))) finalName = uniqueFileName(item.directory, finalName);
    const finalPath = join(item.directory, finalName);
    await moveFile(tempFile, finalPath);
    item.fileName = finalName;
    item.filePath = finalPath;

    if (item.checksum?.expected) {
      item.status = 'processing';
      this.markDirty(item);
      const actual = await hashFile(finalPath, item.checksum.algorithm, entry.controller.signal);
      item.checksum = { ...item.checksum, actual, verified: actual === item.checksum.expected };
    }
  }

  /** First response of an HTTP download: final file name, category and folder. */
  private async applyProbe(item: DownloadItem, info: ProbeInfo): Promise<void> {
    let name = item.fileName;
    if (!item.fileNameLocked && info.serverFileName) name = sanitizeFilename(info.serverFileName, name);
    if (!splitExtension(name).ext) {
      const ext = extensionForMime(info.mimeType);
      if (ext) name = `${name}.${ext}`;
    }
    if (item.autoPlace) {
      const byName = categoryForFileName(name);
      item.category = byName !== 'other' ? byName : (categoryForMime(info.mimeType) ?? 'other');
      item.directory = this.directoryFor(item.category);
    }
    await mkdir(item.directory, { recursive: true });
    item.fileName = uniqueFileName(item.directory, name, this.reservedNames(item.directory, item.id));
    this.markDirty(item);
    this.persist();
  }

  private async runMedia(item: DownloadItem, entry: RunningEntry): Promise<void> {
    const task = new MediaDownloadTask(item, {
      router: this.deps.router,
      tempRoot: this.deps.tempRoot,
      onUpdate: () => this.markDirty(item),
    });
    const result = await task.run(entry.controller.signal);

    await mkdir(item.directory, { recursive: true });
    const finalName = uniqueFileName(item.directory, result.fileName, this.reservedNames(item.directory, item.id));
    const finalPath = join(item.directory, finalName);
    await moveFile(result.filePath, finalPath);
    item.fileName = finalName;
    item.filePath = finalPath;
    const size = (await stat(finalPath)).size;
    item.totalBytes = size;
    item.receivedBytes = size;
    item.percent = 100;
    await rm(MediaDownloadTask.workDir(this.deps.tempRoot, item.id), { recursive: true, force: true });
  }

  private onSuccess(item: DownloadItem): void {
    item.status = 'completed';
    item.completedAt = Date.now();
    item.segments = undefined;
    if (item.totalBytes !== null) item.receivedBytes = item.totalBytes;
    this.finishedSinceIdle++;
    this.markDirty(item);
    this.deps.onCompleted(item);
  }

  private async onFailure(item: DownloadItem, entry: RunningEntry, err: unknown): Promise<void> {
    if (entry.controller.signal.aborted || err instanceof JobCancelledError) {
      item.status = entry.stopAs;
      return;
    }

    if (err instanceof ResourceChangedError) {
      const count = (this.restarts.get(item.id) ?? 0) + 1;
      this.restarts.set(item.id, count);
      if (count <= MAX_AUTO_RESTARTS) {
        logger.warn({ id: item.id, reason: err.message }, 'Restarting download from scratch');
        await this.discardWork(item);
        // The second restart drops to one connection in case the server mishandles ranges
        this.resetProgress(item, count >= 2);
        item.status = 'queued';
        return;
      }
    }

    item.status = 'error';
    item.error = err instanceof Error ? err.message : String(err);
    item.errorCode = codeOf(err);
    logger.error({ id: item.id, url: item.url, err }, 'Download failed');
    this.deps.onFailed(item);
  }

  private resetProgress(item: DownloadItem, singleConnection = false): void {
    item.segments = undefined;
    item.receivedBytes = 0;
    item.totalBytes = item.kind === 'media' ? (item.media?.estimatedSizeBytes ?? null) : null;
    item.percent = 0;
    if (singleConnection) item.connections = 1;
  }

  private async discardWork(item: DownloadItem): Promise<void> {
    try {
      if (item.kind === 'http') {
        await HttpDownloadTask.discardParts(item);
        await rm(join(item.directory, `${item.fileName}.gdownload`), { force: true });
      } else {
        await rm(MediaDownloadTask.workDir(this.deps.tempRoot, item.id), { recursive: true, force: true });
      }
    } catch (err) {
      logger.warn({ err, id: item.id }, 'Could not delete temporary files');
    }
  }

  private checkDrained(): void {
    if (this.running.size > 0) return;
    if ([...this.items.values()].some((i) => i.status === 'queued')) return;
    if (this.finishedSinceIdle === 0) return;
    this.finishedSinceIdle = 0;
    this.deps.onQueueDrained();
  }

  // ---------------------------------------------------------------- progress

  private tick(): void {
    let received = 0;
    let total = 0;
    let unknown = false;

    for (const [id, entry] of this.running) {
      const item = this.items.get(id);
      if (!item) continue;
      if (item.kind === 'http') {
        const delta = Math.max(0, item.receivedBytes - entry.lastBytes);
        entry.lastBytes = item.receivedBytes;
        const instant = (delta * 1000) / TICK_MS;
        item.speed = item.status === 'downloading' ? (item.speed ? item.speed * 0.7 + instant * 0.3 : instant) : 0;
        item.activeConnections = entry.http?.activeConnections ?? 0;
        item.eta = item.totalBytes && item.speed > 1 ? Math.max(0, (item.totalBytes - item.receivedBytes) / item.speed) : null;
      }
      received += item.receivedBytes;
      if (item.totalBytes) total += item.totalBytes;
      else unknown = true;
      this.dirty.add(id);
    }

    // Keep the saved state close to reality in case the app is killed
    if (this.running.size > 0 && ++this.ticksSinceSave >= 10) {
      this.ticksSinceSave = 0;
      this.persist();
    }

    this.checkScheduler();
    this.scheduleFlush();
    let hasError = false;
    let hasPaused = false;
    for (const it of this.items.values()) {
      if (it.status === 'error') hasError = true;
      if (it.status === 'paused') hasPaused = true;
    }
    this.deps.onAggregateProgress({
      fraction: this.running.size === 0 ? null : unknown || total === 0 ? -1 : received / total,
      active: this.running.size,
      hasError,
      hasPaused,
    });
  }

  private checkScheduler(): void {
    const { scheduler } = this.deps.getSettings();
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const stamp = `${now.toDateString()} ${hhmm}`;

    if (scheduler.enabled) {
      if (scheduler.startTime === hhmm && this.schedulerFired.start !== stamp) {
        this.schedulerFired.start = stamp;
        logger.info('Scheduler: starting the queue');
        this.resumeAll();
      }
      if (scheduler.stopTime && scheduler.stopTime === hhmm && this.schedulerFired.stop !== stamp) {
        this.schedulerFired.stop = stamp;
        logger.info('Scheduler: pausing the queue');
        this.pauseAll();
      }
    }

    for (const queue of this.queues.values()) {
      if (!queue.scheduler?.enabled) continue;
      const fired = this.queueSchedulerFired.get(queue.id) || { start: '', stop: '' };
      if (queue.scheduler.startTime === hhmm && fired.start !== stamp) {
        fired.start = stamp;
        this.queueSchedulerFired.set(queue.id, fired);
        logger.info({ queueId: queue.id, queueName: queue.name }, 'Queue scheduler: starting queue');
        this.startQueue(queue.id);
      }
      if (queue.scheduler.stopTime && queue.scheduler.stopTime === hhmm && fired.stop !== stamp) {
        fired.stop = stamp;
        this.queueSchedulerFired.set(queue.id, fired);
        logger.info({ queueId: queue.id, queueName: queue.name }, 'Queue scheduler: stopping queue');
        this.stopQueue(queue.id);
      }
    }
  }

  private markDirty(item: DownloadItem): void {
    this.dirty.add(item.id);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const changed = [...this.dirty].map((id) => this.items.get(id)).filter((i): i is DownloadItem => Boolean(i));
      this.dirty.clear();
      if (changed.length > 0) this.deps.onItemsChanged(changed);
    }, FLUSH_MS);
  }

  private persist(): void {
    this.store.save(() => this.snapshot());
  }
}
