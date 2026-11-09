import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DownloadItem } from '../../shared/types';
import type { PlatformRouter } from '../media/router';
import type { DownloadResult } from '../media/platforms/types';

export interface MediaTaskContext {
  router: PlatformRouter;
  tempRoot: string;
  onUpdate(): void;
}

const STAGE_LABELS: Record<string, string> = {
  Merger: 'Merging audio and video',
  ExtractAudio: 'Converting audio',
  VideoConvertor: 'Converting video',
  VideoRemuxer: 'Remuxing',
  EmbedThumbnail: 'Embedding cover',
  Metadata: 'Writing tags',
  Tagging: 'Writing tags',
  FixupM3u8: 'Fixing container',
  FixupM4a: 'Fixing container',
};

/**
 * A yt-dlp based download (YouTube, Spotify match, Instagram...). Works in a per-item folder that
 * survives pause / resume, so yt-dlp continues its .part files.
 */
export class MediaDownloadTask {
  constructor(
    private readonly item: DownloadItem,
    private readonly ctx: MediaTaskContext
  ) {}

  public static workDir(tempRoot: string, id: string): string {
    return join(tempRoot, id);
  }

  public async run(signal: AbortSignal): Promise<DownloadResult> {
    const item = this.item;
    const media = item.media!;
    const workDir = MediaDownloadTask.workDir(this.ctx.tempRoot, item.id);
    await mkdir(workDir, { recursive: true });

    item.status = 'starting';
    media.stage = 'Preparing';
    this.ctx.onUpdate();

    // Video downloads usually fetch two streams (video, then audio): keep a running total
    let finishedBytes = 0;
    let currentTotal = 0;
    let lastPercent = 0;
    let stream = 0;

    const adapter = this.ctx.router.getAdapter(media.platform);
    return adapter.download({
      url: item.url,
      platform: media.platform,
      mediaId: media.mediaId,
      format: media.format,
      qualityId: media.qualityId,
      outputPath: workDir,
      title: media.title,
      signal,
      onStage: (stage) => {
        item.status = 'processing';
        item.speed = 0;
        item.eta = null;
        media.stage = STAGE_LABELS[stage] ?? stage;
        this.ctx.onUpdate();
      },
      onProgress: (p) => {
        if (p.percent + 10 < lastPercent) {
          // A new stream started
          finishedBytes += currentTotal;
          stream++;
        }
        lastPercent = p.percent;
        if (p.totalBytes) currentTotal = p.totalBytes;

        item.status = 'downloading';
        media.stage = media.format === 'video' ? (stream === 0 ? 'Downloading video' : 'Downloading audio') : 'Downloading audio';
        item.receivedBytes = finishedBytes + (p.downloadedBytes ?? 0);
        const known = finishedBytes + currentTotal;
        item.totalBytes = Math.max(media.estimatedSizeBytes ?? 0, known) || null;
        item.percent = item.totalBytes ? Math.min(100, (item.receivedBytes / item.totalBytes) * 100) : p.percent;
        item.speed = p.speed ?? item.speed;
        item.eta = p.eta ?? null;
        this.ctx.onUpdate();
      },
    });
  }
}
