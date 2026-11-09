import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { PlatformId, MediaFormat, MediaItem, MediaOption, SegmentState } from '@grabbit/types';
import { computeSegments } from '@grabbit/core';

export interface MobileDownloadTask {
  id: string;
  url: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  platform: PlatformId;
  format: MediaFormat;
  qualityId: string;
  extension: string;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'error';
  receivedBytes: number;
  totalBytes: number;
  progress: number; // 0..1
  speed: number; // bytes/sec
  eta: number | null;
  segments: SegmentState[];
  localUri: string;
  savedToLibrary?: boolean;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export type DownloadListener = (tasks: MobileDownloadTask[]) => void;

class MobileDownloadManager {
  private tasks: Map<string, MobileDownloadTask> = new Map();
  private resumables: Map<string, FileSystem.DownloadResumable> = new Map();
  private listeners: Set<DownloadListener> = new Set();
  private speedTracking: Map<string, { lastBytes: number; lastTime: number }> = new Map();

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

  subscribe(listener: DownloadListener): () => void {
    this.listeners.add(listener);
    listener(this.getAllTasks());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const list = this.getAllTasks();
    for (const listener of this.listeners) {
      listener(list);
    }
  }

  getAllTasks(): MobileDownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getTask(id: string): MobileDownloadTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Start a download for a chosen media item and option
   */
  async startDownload(item: MediaItem, option: MediaOption): Promise<string> {
    await this.ensureDir();

    const id = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const safeTitle = item.title.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'media';
    const extension = option.extension || (option.format === 'audio' ? 'mp3' : 'mp4');
    const fileName = `${safeTitle}.${extension}`;
    const localUri = `${this.getBaseDir()}${id}_${fileName}`;

    // Estimated total bytes or default 10MB
    const totalBytes = option.estimatedSizeBytes || 10 * 1024 * 1024;
    const segmentCount = 4;
    const rawSegments = computeSegments(totalBytes, segmentCount);

    const segments: SegmentState[] = rawSegments.map((s) => ({
      start: s.startByte,
      end: s.endByte,
      received: 0,
      part: `part_${s.id}`,
    }));

    const task: MobileDownloadTask = {
      id,
      url: item.url,
      title: item.title,
      author: item.uploader,
      thumbnailUrl: item.thumbnailUrl,
      platform: item.platform,
      format: option.format,
      qualityId: option.qualityId,
      extension,
      status: 'queued',
      receivedBytes: 0,
      totalBytes,
      progress: 0,
      speed: 0,
      eta: null,
      segments,
      localUri,
      createdAt: Date.now(),
    };

    this.tasks.set(id, task);
    this.notify();

    // Begin download
    this.executeDownload(task);
    return id;
  }

  private async executeDownload(task: MobileDownloadTask) {
    try {
      task.status = 'downloading';
      this.speedTracking.set(task.id, { lastBytes: 0, lastTime: Date.now() });
      this.notify();

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

        // Update segmented states visually across connection threads
        const chunkSize = Math.max(1, Math.floor(total / currentTask.segments.length));
        currentTask.segments.forEach((seg, idx) => {
          const segStart = idx * chunkSize;
          const segEnd = (idx + 1) * chunkSize;
          if (received >= segEnd) {
            seg.received = chunkSize;
          } else if (received > segStart) {
            seg.received = received - segStart;
          } else {
            seg.received = 0;
          }
        });

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

        this.notify();
      };

      const resumable = FileSystem.createDownloadResumable(
        task.url,
        task.localUri,
        {},
        downloadCallback
      );

      this.resumables.set(task.id, resumable);
      const result = await resumable.downloadAsync();

      if (result?.uri) {
        task.status = 'completed';
        task.progress = 1;
        task.receivedBytes = task.totalBytes;
        task.speed = 0;
        task.eta = 0;
        task.completedAt = Date.now();
        this.resumables.delete(task.id);
        this.speedTracking.delete(task.id);
        this.notify();
      }
    } catch (err: any) {
      if (task.status !== 'paused') {
        task.status = 'error';
        task.error = err.message || 'Download failed';
        this.notify();
      }
    }
  }

  async pauseDownload(id: string) {
    const task = this.tasks.get(id);
    const resumable = this.resumables.get(id);
    if (!task || !resumable || task.status !== 'downloading') return;

    try {
      task.status = 'paused';
      task.speed = 0;
      await resumable.pauseAsync();
      this.notify();
    } catch (err) {
      console.warn('Error pausing download:', err);
    }
  }

  async resumeDownload(id: string) {
    const task = this.tasks.get(id);
    const resumable = this.resumables.get(id);
    if (!task || !resumable || task.status !== 'paused') return;

    try {
      task.status = 'downloading';
      this.speedTracking.set(task.id, { lastBytes: task.receivedBytes, lastTime: Date.now() });
      this.notify();
      await resumable.resumeAsync();
      task.status = 'completed';
      task.progress = 1;
      task.completedAt = Date.now();
      this.notify();
    } catch (err: any) {
      task.status = 'error';
      task.error = err.message || 'Resume failed';
      this.notify();
    }
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
      this.notify();
    }
  }

  /**
   * Save downloaded file to user's native Camera Roll / Photos / Audio Library
   */
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
      this.notify();
      return { success: true, message: 'Saved successfully to Photos / Media Library!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to save to Media Library.' };
    }
  }

  async deleteDownload(id: string) {
    await this.cancelDownload(id);
  }
}

export const mobileDownloadManager = new MobileDownloadManager();

