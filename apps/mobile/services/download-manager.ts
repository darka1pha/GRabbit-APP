import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { AppState, AppStateStatus } from 'react-native';
import {
  PlatformId,
  MediaFormat,
  MediaItem,
  MediaOption,
  SegmentState,
  Category,
  DownloadQueue,
  ChecksumAlgorithm,
  ProbeResult,
  AddHttpDownloadRequest,
} from '@grabbit/types';
import { base64ToBytes, createIncrementalHasher } from '@grabbit/utils';
import { mobileSettingsManager } from './settings-manager';
import { mobileBridge } from './bridge';

export interface MobileDownloadTask {
  id: string;
  kind: 'http' | 'media';
  url: string;
  streamUrl?: string;
  fileName: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  platform: PlatformId;
  format: MediaFormat;
  qualityId: string;
  extension: string;
  category: Category;
  queueId: string;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'error';
  receivedBytes: number;
  totalBytes: number;
  progress: number; // 0..1
  speed: number; // bytes/sec
  eta: number | null;
  connections: number;
  activeConnections: number;
  segments: SegmentState[];
  localUri: string;
  savedToLibrary?: boolean;
  error?: string;
  errorCode?: string;
  resumable: boolean;
  speedLimit?: number;
  checksum?: {
    algorithm: ChecksumAlgorithm;
    expected?: string;
    actual?: string;
    verified?: boolean;
  };
  headers?: Record<string, string>;
  referrer?: string;
  createdAt: number;
  completedAt?: number;
}

export function detectCategory(urlOrFileName: string, mimeType?: string): Category {
  const clean = urlOrFileName.toLowerCase().split('?')[0];
  if (mimeType) {
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'music';
    if (mimeType.startsWith('image/')) return 'images';
    if (mimeType.includes('pdf') || mimeType.includes('text') || mimeType.includes('document')) return 'documents';
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('compressed') || mimeType.includes('archive')) return 'compressed';
  }
  if (/\.(mp4|mkv|webm|avi|mov|flv|wmv|m4v|3gp|ts)$/i.test(clean)) return 'video';
  if (/\.(mp3|m4a|flac|wav|aac|ogg|opus|wma|aiff|alac)$/i.test(clean)) return 'music';
  if (/\.(pdf|docx?|xlsx?|pptx?|epub|txt|rtf|odt|csv)$/i.test(clean)) return 'documents';
  if (/\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|iso|img)$/i.test(clean)) return 'compressed';
  if (/\.(apk|aab|exe|msi|dmg|pkg|deb|rpm|appimage)$/i.test(clean)) return 'programs';
  if (/\.(jpe?g|png|gif|webp|svg|bmp|ico|tiff?)$/i.test(clean)) return 'images';
  return 'other';
}

export type DownloadListener = (tasks: MobileDownloadTask[]) => void;
export type QueueListener = (queues: DownloadQueue[]) => void;

class MobileDownloadManager {
  private tasks: Map<string, MobileDownloadTask> = new Map();
  private queues: Map<string, DownloadQueue> = new Map();
  private resumables: Map<string, FileSystem.DownloadResumable> = new Map();
  private taskListeners: Set<DownloadListener> = new Set();
  private queueListeners: Set<QueueListener> = new Set();
  private speedTracking: Map<string, { lastBytes: number; lastTime: number }> = new Map();
  private lastProgressNotifyTime: Map<string, number> = new Map();
  private persistTasksTimer: any = null;
  private persistQueuesTimer: any = null;
  private appStateSubscription: any = null;
  private scheduleTimer: any = null;
  private isLoaded = false;

  constructor() {
    this.initDefaultQueues();
    this.loadState().then(() => {
      this.startSchedulerTicker();
      this.pumpQueues();
    });

    // Flush any pending disk writes immediately when app transitions to background or inactive
    try {
      this.appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'background' || state === 'inactive') {
          this.flushPendingPersists();
        }
      });
    } catch {
      // In headless or test environments where AppState may not be available
    }
  }

  private initDefaultQueues() {
    this.queues.set('main', {
      id: 'main',
      name: 'Main Queue',
      enabled: true,
      maxConcurrent: 2,
      order: [],
      afterQueue: 'none',
    });
    this.queues.set('scheduled', {
      id: 'scheduled',
      name: 'Scheduled Queue',
      enabled: false,
      maxConcurrent: 1,
      scheduler: {
        enabled: true,
        startTime: '02:00',
        stopTime: '08:00',
      },
      order: [],
      afterQueue: 'stopQueue',
    });
  }

  private getBaseDir(): string {
    return `${FileSystem.documentDirectory || FileSystem.cacheDirectory}grabbit/`;
  }

  private async ensureDir() {
    const dir = this.getBaseDir();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  }

  private async loadState() {
    try {
      await this.ensureDir();
      const queuesPath = `${this.getBaseDir()}queues.json`;
      const qInfo = await FileSystem.getInfoAsync(queuesPath);
      if (qInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(queuesPath);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const q of parsed) {
            this.queues.set(q.id, q);
          }
        }
      }

      const tasksPath = `${this.getBaseDir()}tasks.json`;
      const tInfo = await FileSystem.getInfoAsync(tasksPath);
      if (tInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(tasksPath);
        const parsed: MobileDownloadTask[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const t of parsed) {
            // Re-map tasks; if it was downloading when exited, mark as paused
            if (t.status === 'downloading') {
              t.status = 'paused';
            }
            // Ensure single-stream representation on mobile
            t.connections = 1;
            t.activeConnections = 0;
            this.tasks.set(t.id, t);
          }
        }
      }
      this.isLoaded = true;
      this.notifyTasks();
      this.notifyQueues();
    } catch (err) {
      console.warn('Failed to load download manager state:', err);
    }
  }

  // -------------------------------------------------------------------------
  // High-Performance Persistence (Debounced + Flush on Status Transitions)
  // -------------------------------------------------------------------------

  private async persistTasks() {
    try {
      await this.ensureDir();
      const tasksPath = `${this.getBaseDir()}tasks.json`;
      const arr = Array.from(this.tasks.values());
      await FileSystem.writeAsStringAsync(tasksPath, JSON.stringify(arr));
    } catch (err) {
      console.warn('Failed to persist tasks:', err);
    }
  }

  private async persistQueues() {
    try {
      await this.ensureDir();
      const queuesPath = `${this.getBaseDir()}queues.json`;
      const arr = Array.from(this.queues.values());
      await FileSystem.writeAsStringAsync(queuesPath, JSON.stringify(arr));
    } catch (err) {
      console.warn('Failed to persist queues:', err);
    }
  }

  private schedulePersistTasks(delayMs = 2000) {
    if (this.persistTasksTimer) return;
    this.persistTasksTimer = setTimeout(() => {
      this.persistTasksTimer = null;
      this.persistTasks();
    }, delayMs);
  }

  private schedulePersistQueues(delayMs = 2000) {
    if (this.persistQueuesTimer) return;
    this.persistQueuesTimer = setTimeout(() => {
      this.persistQueuesTimer = null;
      this.persistQueues();
    }, delayMs);
  }

  private persistTasksImmediately() {
    if (this.persistTasksTimer) {
      clearTimeout(this.persistTasksTimer);
      this.persistTasksTimer = null;
    }
    this.persistTasks();
  }

  private persistQueuesImmediately() {
    if (this.persistQueuesTimer) {
      clearTimeout(this.persistQueuesTimer);
      this.persistQueuesTimer = null;
    }
    this.persistQueues();
  }

  flushPendingPersists() {
    if (this.persistTasksTimer) {
      clearTimeout(this.persistTasksTimer);
      this.persistTasksTimer = null;
    }
    if (this.persistQueuesTimer) {
      clearTimeout(this.persistQueuesTimer);
      this.persistQueuesTimer = null;
    }
    this.persistTasks();
    this.persistQueues();
  }

  subscribe(listener: DownloadListener): () => void {
    this.taskListeners.add(listener);
    listener(this.getAllTasks());
    return () => this.taskListeners.delete(listener);
  }

  subscribeQueues(listener: QueueListener): () => void {
    this.queueListeners.add(listener);
    listener(this.getAllQueues());
    return () => this.queueListeners.delete(listener);
  }

  private notifyTasks() {
    const list = this.getAllTasks();
    for (const listener of this.taskListeners) {
      listener(list);
    }
  }

  private notifyTasksThrottled(taskId: string) {
    const now = Date.now();
    const last = this.lastProgressNotifyTime.get(taskId) || 0;
    if (now - last >= 250) {
      this.lastProgressNotifyTime.set(taskId, now);
      this.notifyTasks();
      this.schedulePersistTasks(2000);
    }
  }

  private notifyQueues() {
    const list = this.getAllQueues();
    for (const listener of this.queueListeners) {
      listener(list);
    }
  }

  getAllTasks(): MobileDownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getTask(id: string): MobileDownloadTask | undefined {
    return this.tasks.get(id);
  }

  getAllQueues(): DownloadQueue[] {
    return Array.from(this.queues.values());
  }

  getQueue(id: string): DownloadQueue | undefined {
    return this.queues.get(id);
  }

  // -------------------------------------------------------------------------
  // Queue Management
  // -------------------------------------------------------------------------

  createQueue(name: string, options?: Partial<DownloadQueue>): DownloadQueue {
    const id = `queue-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const queue: DownloadQueue = {
      id,
      name,
      enabled: options?.enabled ?? true,
      maxConcurrent: options?.maxConcurrent ?? 2,
      scheduler: options?.scheduler,
      afterQueue: options?.afterQueue ?? 'none',
      order: [],
    };
    this.queues.set(id, queue);
    this.notifyQueues();
    this.persistQueuesImmediately();
    this.pumpQueues();
    return queue;
  }

  updateQueue(id: string, patch: Partial<DownloadQueue>): DownloadQueue {
    const q = this.queues.get(id);
    if (!q) throw new Error(`Queue not found: ${id}`);
    Object.assign(q, patch);
    this.notifyQueues();
    this.persistQueuesImmediately();
    this.pumpQueues();
    return q;
  }

  deleteQueue(id: string) {
    if (id === 'main') throw new Error('Cannot delete main queue');
    // Move all items from this queue to main
    for (const task of this.tasks.values()) {
      if (task.queueId === id) {
        task.queueId = 'main';
      }
    }
    this.queues.delete(id);
    this.notifyTasks();
    this.notifyQueues();
    this.persistTasksImmediately();
    this.persistQueuesImmediately();
    this.pumpQueues();
  }

  startQueue(id: string) {
    const q = this.queues.get(id);
    if (!q) return;
    q.enabled = true;
    this.notifyQueues();
    this.persistQueuesImmediately();
    this.pumpQueues();
  }

  stopQueue(id: string) {
    const q = this.queues.get(id);
    if (!q) return;
    q.enabled = false;
    // Pause active downloads belonging to this queue
    for (const task of this.tasks.values()) {
      if (task.queueId === id && task.status === 'downloading') {
        this.pauseDownload(task.id);
      }
    }
    this.notifyQueues();
    this.persistQueuesImmediately();
  }

  moveTaskToQueue(taskId: string, targetQueueId: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.queueId = targetQueueId;
    this.notifyTasks();
    this.persistTasksImmediately();
    this.pumpQueues();
  }

  private startSchedulerTicker() {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = setInterval(() => {
      this.checkQueueSchedules();
    }, 30000); // Check every 30s
    this.checkQueueSchedules();
  }

  private checkQueueSchedules() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    let changed = false;

    for (const q of this.queues.values()) {
      if (q.scheduler?.enabled && q.scheduler.startTime && q.scheduler.stopTime) {
        const [startH, startM] = q.scheduler.startTime.split(':').map(Number);
        const [stopH, stopM] = q.scheduler.stopTime.split(':').map(Number);
        const startMin = (startH || 0) * 60 + (startM || 0);
        const stopMin = (stopH || 0) * 60 + (stopM || 0);

        let inWindow = false;
        if (startMin <= stopMin) {
          inWindow = currentMinutes >= startMin && currentMinutes < stopMin;
        } else {
          // Window crosses midnight
          inWindow = currentMinutes >= startMin || currentMinutes < stopMin;
        }

        if (inWindow && !q.enabled) {
          q.enabled = true;
          changed = true;
          this.pumpQueues();
        } else if (!inWindow && q.enabled && q.id === 'scheduled') {
          q.enabled = false;
          changed = true;
          for (const task of this.tasks.values()) {
            if (task.queueId === q.id && task.status === 'downloading') {
              this.pauseDownload(task.id);
            }
          }
        }
      }
    }

    if (changed) {
      this.notifyQueues();
    }
  }

  // -------------------------------------------------------------------------
  // Concurrency & Execution Engine
  // -------------------------------------------------------------------------

  private pumpQueues() {
    const settings = mobileSettingsManager.getSettings();
    const globalMax = settings.maxConcurrent || 2;
    const currentlyDownloading = Array.from(this.tasks.values()).filter((t) => t.status === 'downloading');

    if (currentlyDownloading.length >= globalMax) return;

    for (const q of this.queues.values()) {
      if (!q.enabled) continue;
      const queueDownloading = currentlyDownloading.filter((t) => t.queueId === q.id);
      if (queueDownloading.length >= q.maxConcurrent) continue;

      // Find next queued task in this queue
      const candidates = Array.from(this.tasks.values())
        .filter((t) => t.queueId === q.id && t.status === 'queued')
        .sort((a, b) => a.createdAt - b.createdAt);

      for (const nextTask of candidates) {
        if (currentlyDownloading.length >= globalMax || queueDownloading.length >= q.maxConcurrent) break;
        this.executeDownload(nextTask);
        queueDownloading.push(nextTask);
        currentlyDownloading.push(nextTask);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Direct HTTP File Probe
  // -------------------------------------------------------------------------

  async probeUrl(url: string, headers?: Record<string, string>): Promise<ProbeResult> {
    let fileName = url.split('/').pop()?.split('?')[0] || 'download.bin';
    try {
      fileName = decodeURIComponent(fileName);
    } catch {}

    let totalBytes: number | null = null;
    let resumable = false;
    let mimeType: string | undefined;

    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { ...(headers || {}) },
      });
      if (res.ok) {
        const len = res.headers.get('content-length');
        if (len) totalBytes = parseInt(len, 10);
        const acceptRanges = res.headers.get('accept-ranges');
        resumable = acceptRanges?.toLowerCase() === 'bytes';
        mimeType = res.headers.get('content-type') || undefined;

        const disposition = res.headers.get('content-disposition');
        if (disposition) {
          const match = /filename\*?=['"]?(?:UTF-8'')?([^'";]+)['"]?/i.exec(disposition);
          if (match && match[1]) {
            fileName = decodeURIComponent(match[1]);
          }
        }
      }
    } catch {
      // Fallback
    }

    const category = detectCategory(fileName, mimeType);
    return {
      url,
      finalUrl: url,
      fileName,
      totalBytes,
      resumable,
      mimeType,
      category,
    };
  }

  // -------------------------------------------------------------------------
  // Task Creation: Media & Direct HTTP Downloads
  // -------------------------------------------------------------------------

  async startDownload(item: MediaItem, option: MediaOption, targetQueueId = 'main'): Promise<string> {
    await this.ensureDir();

    const id = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const safeTitle = item.title.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'media';
    const extension = option.extension || (option.format === 'audio' ? 'mp3' : 'mp4');
    const fileName = `${safeTitle}.${extension}`;
    const localUri = `${this.getBaseDir()}${id}_${fileName}`;

    const totalBytes = option.estimatedSizeBytes || 10 * 1024 * 1024;
    // Mobile runs an honest single-connection HTTP stream
    const segments: SegmentState[] = [
      {
        start: 0,
        end: totalBytes > 0 ? totalBytes - 1 : null,
        received: 0,
        part: '0',
      },
    ];

    const category = option.format === 'audio' ? 'music' : 'video';

    const task: MobileDownloadTask = {
      id,
      kind: 'media',
      url: item.url,
      streamUrl: option.directStreamUrl,
      fileName,
      title: item.title,
      author: item.uploader,
      thumbnailUrl: item.thumbnailUrl,
      platform: item.platform,
      format: option.format,
      qualityId: option.qualityId,
      extension,
      category,
      queueId: targetQueueId,
      status: 'queued',
      receivedBytes: 0,
      totalBytes,
      progress: 0,
      speed: 0,
      eta: null,
      connections: 1,
      activeConnections: 0,
      segments,
      localUri,
      resumable: true,
      createdAt: Date.now(),
    };

    this.tasks.set(id, task);
    this.notifyTasks();
    this.persistTasksImmediately();
    this.pumpQueues();
    return id;
  }

  async startHttpDownload(request: AddHttpDownloadRequest): Promise<string> {
    await this.ensureDir();

    const id = `http-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    let fileName = request.fileName;
    if (!fileName) {
      fileName = request.url.split('/').pop()?.split('?')[0] || 'file.bin';
      try {
        fileName = decodeURIComponent(fileName);
      } catch {}
    }
    fileName = fileName.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'download.bin';
    const extension = fileName.split('.').pop() || 'bin';
    const localUri = `${this.getBaseDir()}${id}_${fileName}`;

    const category = request.category || detectCategory(fileName);
    const totalBytes = 10 * 1024 * 1024; // Default estimate until probe/response
    // Mobile runs an honest single-connection HTTP stream
    const segments: SegmentState[] = [
      {
        start: 0,
        end: totalBytes > 0 ? totalBytes - 1 : null,
        received: 0,
        part: '0',
      },
    ];

    const task: MobileDownloadTask = {
      id,
      kind: 'http',
      url: request.url,
      fileName,
      title: fileName,
      platform: 'generic',
      format: category === 'video' ? 'video' : 'audio',
      qualityId: 'original',
      extension,
      category,
      queueId: request.queueId || 'main',
      status: request.startPaused ? 'paused' : 'queued',
      receivedBytes: 0,
      totalBytes,
      progress: 0,
      speed: 0,
      eta: null,
      connections: 1,
      activeConnections: 0,
      segments,
      localUri,
      resumable: true,
      speedLimit: request.speedLimitKBps ? request.speedLimitKBps * 1024 : undefined,
      checksum: request.checksum,
      headers: request.headers,
      referrer: request.referrer,
      createdAt: Date.now(),
    };

    this.tasks.set(id, task);
    this.notifyTasks();
    this.persistTasksImmediately();
    if (!request.startPaused) {
      this.pumpQueues();
    }
    return id;
  }

  async batchImportUrls(urls: string[], request: Partial<AddHttpDownloadRequest> = {}): Promise<string[]> {
    const ids: string[] = [];
    for (const url of urls) {
      const id = await this.startHttpDownload({
        url,
        ...request,
      });
      ids.push(id);
    }
    return ids;
  }

  // -------------------------------------------------------------------------
  // Execution & Progress
  // -------------------------------------------------------------------------

  private async executeDownload(task: MobileDownloadTask) {
    try {
      task.status = 'downloading';
      task.connections = 1;
      task.activeConnections = 1;
      this.speedTracking.set(task.id, { lastBytes: task.receivedBytes, lastTime: Date.now() });
      this.notifyTasks();
      this.persistTasksImmediately();

      const downloadCallback = (downloadProgress: FileSystem.DownloadProgressData) => {
        const received = downloadProgress.totalBytesWritten;
        const total = downloadProgress.totalBytesExpectedToWrite > 0
          ? downloadProgress.totalBytesExpectedToWrite
          : task.totalBytes;

        const currentTask = this.tasks.get(task.id);
        if (!currentTask || currentTask.status !== 'downloading') return;

        currentTask.receivedBytes = received;
        currentTask.totalBytes = total;
        currentTask.progress = total > 0 ? Math.min(1, received / total) : 0;
        currentTask.connections = 1;
        currentTask.activeConnections = 1;

        // Honest single-stream state
        currentTask.segments = [
          {
            start: 0,
            end: total > 0 ? total - 1 : null,
            received,
            part: '0',
          },
        ];

        // Compute speed & ETA
        const tracking = this.speedTracking.get(task.id);
        const now = Date.now();
        if (tracking && now - tracking.lastTime >= 500) {
          const deltaBytes = received - tracking.lastBytes;
          const deltaTime = (now - tracking.lastTime) / 1000;
          const instantSpeed = deltaBytes / deltaTime;
          currentTask.speed = currentTask.speed ? Math.round(currentTask.speed * 0.7 + instantSpeed * 0.3) : Math.round(instantSpeed);

          if (currentTask.speed > 0) {
            currentTask.eta = Math.max(0, Math.round((total - received) / currentTask.speed));
          }

          this.speedTracking.set(task.id, { lastBytes: received, lastTime: now });
        }

        // Throttle UI notification to ~4/s (250ms) and debounce disk persistence to 2s
        this.notifyTasksThrottled(task.id);
      };

      // If this is a social media task and doesn't yet have a resolved direct CDN stream URL, resolve it now
      let targetUrl = task.streamUrl || task.url;
      if (task.kind === 'media' && !task.streamUrl) {
        const resolved = await mobileBridge.resolveDirectStreamUrl(task.url, task.platform, {
          format: task.format,
          qualityId: task.qualityId,
          label: task.qualityId,
          extension: task.extension,
          estimatedSizeBytes: task.totalBytes,
        });
        targetUrl = resolved.streamUrl;
        task.streamUrl = resolved.streamUrl;
        if (resolved.sizeBytes && resolved.sizeBytes > 0) {
          task.totalBytes = resolved.sizeBytes;
        }
        if (resolved.headers) {
          task.headers = { ...(task.headers || {}), ...resolved.headers };
        }
      }

      const requestHeaders: Record<string, string> = {
        ...(task.headers || {}),
        ...(task.referrer ? { Referer: task.referrer } : {}),
      };

      const resumable = FileSystem.createDownloadResumable(
        targetUrl,
        task.localUri,
        { headers: requestHeaders },
        downloadCallback
      );

      this.resumables.set(task.id, resumable);
      const result = await resumable.downloadAsync();

      if (result?.uri) {
        if (typeof result.status === 'number' && (result.status < 200 || result.status >= 300)) {
          throw new Error(`Server returned HTTP ${result.status}`);
        }
        const contentType = (
          result.headers?.['content-type'] ||
          result.headers?.['Content-Type'] ||
          ''
        ).toLowerCase();
        if (task.kind === 'media' && contentType.includes('text/html')) {
          throw new Error('Remote server returned an HTML page instead of a playable media stream.');
        }

        task.status = 'completed';
        task.progress = 1;
        task.receivedBytes = task.totalBytes;
        task.speed = 0;
        task.eta = 0;
        task.activeConnections = 0;
        task.completedAt = Date.now();
        this.resumables.delete(task.id);
        this.speedTracking.delete(task.id);
        this.lastProgressNotifyTime.delete(task.id);

        // Auto-save to Media Library if configured in settings
        const settings = mobileSettingsManager.getSettings();
        if (settings.autoSaveToLibrary && (task.category === 'video' || task.category === 'images' || task.category === 'music')) {
          this.saveToMediaLibrary(task.id).catch(() => {});
        }

        this.notifyTasks();
        this.persistTasksImmediately();
        this.pumpQueues();
      }
    } catch (err: any) {
      if (task.status !== 'paused') {
        task.status = 'error';
        task.error = err.message || 'Download failed';
        task.activeConnections = 0;
        task.speed = 0;
        this.resumables.delete(task.id);
        this.speedTracking.delete(task.id);
        this.lastProgressNotifyTime.delete(task.id);
        this.notifyTasks();
        this.persistTasksImmediately();
        this.pumpQueues();
      }
    }
  }

  async pauseDownload(id: string) {
    const task = this.tasks.get(id);
    const resumable = this.resumables.get(id);
    if (!task) return;

    task.status = 'paused';
    task.speed = 0;
    task.activeConnections = 0;
    this.lastProgressNotifyTime.delete(id);

    if (resumable) {
      try {
        await resumable.pauseAsync();
      } catch (err) {
        console.warn('Error pausing download:', err);
      }
    }
    this.notifyTasks();
    this.persistTasksImmediately();
    this.pumpQueues();
  }

  async resumeDownload(id: string) {
    const task = this.tasks.get(id);
    if (!task || task.status === 'downloading') return;

    task.status = 'queued';
    this.notifyTasks();
    this.persistTasksImmediately();
    this.pumpQueues();
  }

  async cancelDownload(id: string) {
    const task = this.tasks.get(id);
    const resumable = this.resumables.get(id);
    if (resumable) {
      try {
        await resumable.pauseAsync();
      } catch {}
      this.resumables.delete(id);
    }

    if (task) {
      try {
        const info = await FileSystem.getInfoAsync(task.localUri);
        if (info.exists) {
          await FileSystem.deleteAsync(task.localUri);
        }
      } catch {}
      this.tasks.delete(id);
      this.speedTracking.delete(id);
      this.lastProgressNotifyTime.delete(id);
      this.notifyTasks();
      this.persistTasksImmediately();
      this.pumpQueues();
    }
  }

  async deleteDownload(id: string) {
    await this.cancelDownload(id);
  }

  // -------------------------------------------------------------------------
  // Bulk Actions
  // -------------------------------------------------------------------------

  async resumeAll() {
    for (const task of this.tasks.values()) {
      if (task.status === 'paused' || task.status === 'error') {
        task.status = 'queued';
      }
    }
    this.notifyTasks();
    this.persistTasksImmediately();
    this.pumpQueues();
  }

  async pauseAll() {
    for (const task of this.tasks.values()) {
      if (task.status === 'downloading' || task.status === 'queued') {
        await this.pauseDownload(task.id);
      }
    }
    this.notifyTasks();
    this.persistTasksImmediately();
  }

  async clearCompleted() {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed') {
        this.tasks.delete(id);
        this.lastProgressNotifyTime.delete(id);
      }
    }
    this.notifyTasks();
    this.persistTasksImmediately();
  }

  async retryFailed() {
    for (const task of this.tasks.values()) {
      if (task.status === 'error') {
        task.status = 'queued';
        task.error = undefined;
      }
    }
    this.notifyTasks();
    this.persistTasksImmediately();
    this.pumpQueues();
  }

  // -------------------------------------------------------------------------
  // Media Library Integration
  // -------------------------------------------------------------------------

  async saveToMediaLibrary(id: string): Promise<{ success: boolean; message: string }> {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'completed') {
      return { success: false, message: 'File is not yet completed.' };
    }

    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        return { success: false, message: 'Permission to access media library was denied.' };
      }

      await MediaLibrary.saveToLibraryAsync(task.localUri);
      task.savedToLibrary = true;
      this.notifyTasks();
      this.persistTasksImmediately();
      return { success: true, message: 'Saved successfully to Photos / Media Library!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to save to Media Library.' };
    }
  }

  // -------------------------------------------------------------------------
  // Memory-Safe Checksum Computation & Verification
  // -------------------------------------------------------------------------

  async verifyChecksum(
    id: string,
    algorithm: ChecksumAlgorithm = 'sha256',
    expected?: string
  ): Promise<{ actual: string; verified?: boolean }> {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'completed') {
      throw new Error('Task is not completed or does not exist');
    }

    let actual = '';

    // Fast path: For MD5, native FileSystem.getInfoAsync calculates MD5 with zero JS memory allocation
    if (algorithm === 'md5') {
      try {
        const info = await FileSystem.getInfoAsync(task.localUri, { md5: true });
        if (info.exists && (info as any).md5) {
          actual = String((info as any).md5).toLowerCase();
        }
      } catch (err) {
        console.warn('Native MD5 checksum failed, falling back to chunked hasher:', err);
      }
    }

    // Chunked streaming hash computation for SHA-1, SHA-256, SHA-512, or MD5 fallback
    if (!actual) {
      const fileInfo = await FileSystem.getInfoAsync(task.localUri);
      if (!fileInfo.exists) {
        throw new Error(`Downloaded file not found at ${task.localUri}`);
      }
      const totalSize = (fileInfo as any).size ?? task.receivedBytes;
      const CHUNK_SIZE = 256 * 1024; // 256 KB chunk size to prevent memory spikes
      const hasher = createIncrementalHasher(algorithm);

      let position = 0;
      while (position < totalSize) {
        const readLen = Math.min(CHUNK_SIZE, totalSize - position);
        const base64Chunk = await FileSystem.readAsStringAsync(task.localUri, {
          encoding: FileSystem.EncodingType.Base64,
          position,
          length: readLen,
        });
        const chunkBytes = base64ToBytes(base64Chunk);
        hasher.update(chunkBytes);
        position += readLen;
      }
      actual = hasher.digestHex();
    }

    const cleanExpected = expected?.trim().toLowerCase().replace(/^(sha256|sha1|md5)[-:]?/i, '');
    const verified = cleanExpected ? actual.toLowerCase() === cleanExpected : undefined;

    task.checksum = {
      algorithm,
      expected,
      actual,
      verified,
    };
    this.notifyTasks();
    this.persistTasksImmediately();
    return { actual, verified };
  }
}

export const mobileDownloadManager = new MobileDownloadManager();
