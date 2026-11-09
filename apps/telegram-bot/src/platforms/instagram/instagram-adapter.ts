import { PLATFORMS } from '../../config/constants.js';
import {
  IPlatformAdapter,
  PlatformMetadata,
  DownloadRequest,
  DownloadResult,
} from '../../core/types/platform.js';
import { YtDlpRunner } from '../../services/downloads/ytdlp-runner.js';
import { sanitizeFilename } from '../../security/filename.js';
import { getConfig } from '../../config/env.js';
import { extractMediaOptionsFromFormats } from '../youtube/youtube-adapter.js';

export class InstagramAdapter implements IPlatformAdapter {
  public readonly platformId = PLATFORMS.INSTAGRAM;
  private ytdlp: YtDlpRunner;

  constructor(ytdlpRunner?: YtDlpRunner) {
    this.ytdlp = ytdlpRunner || new YtDlpRunner();
  }

  private getExtraArgs(): string[] {
    const extraArgs: string[] = [];
    const sessionId = getConfig().INSTAGRAM_SESSION_ID;
    if (sessionId) {
      extraArgs.push('--add-header', `Cookie: sessionid=${sessionId}`);
    }
    return extraArgs;
  }

  public matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === 'instagram.com' ||
        host === 'www.instagram.com' ||
        host === 'instagr.am' ||
        host === 'www.instagr.am'
      );
    } catch {
      return false;
    }
  }

  public normalizeUrl(url: string): string {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  }

  public async fetchMetadata(url: string): Promise<PlatformMetadata> {
    const raw = await this.ytdlp.getMetadata(url, this.getExtraArgs());

    const availableOptions = extractMediaOptionsFromFormats(raw, {
      includeAudio: true,
      fallbackStandardQualities: false,
    });

    return {
      platform: this.platformId,
      url,
      title: raw.title || 'Instagram Media',
      artistOrAuthor: raw.channel || raw.uploader || 'Instagram User',
      durationSeconds: raw.duration,
      thumbnailUrl: raw.thumbnail,
      isAuthorized: true,
      items: [
        {
          id: raw.id || 'ig-media',
          title: raw.title || 'Instagram Post',
          uploader: raw.channel || raw.uploader,
          durationSeconds: raw.duration,
          thumbnailUrl: raw.thumbnail,
          platform: this.platformId,
          url,
          isDownloadable: true,
          availableOptions,
        },
      ],
      raw,
    };
  }

  public async download(request: DownloadRequest): Promise<DownloadResult> {
    const isAudio = request.format === 'audio';
    const ext = isAudio ? 'mp3' : 'mp4';
    const outputTemplate = `${request.outputPath}/instagram-%(id)s.%(ext)s`;
    const extraArgs: string[] = [...this.getExtraArgs(), '--embed-metadata'];

    if (isAudio) {
      extraArgs.push(
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '--embed-thumbnail',
        '--convert-thumbnails',
        'jpg'
      );
    } else {
      extraArgs.push('--merge-output-format', 'mp4');
    }

    let formatSelector = 'bestvideo+bestaudio/best';
    if (isAudio) {
      formatSelector = 'bestaudio/best';
    } else if (request.qualityId && request.qualityId.endsWith('p')) {
      const height = parseInt(request.qualityId, 10);
      if (!isNaN(height)) {
        formatSelector = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
      }
    } else if (request.qualityId && request.qualityId !== 'best') {
      formatSelector = request.qualityId;
    }

    const downloadedPath = await this.ytdlp.downloadMedia({
      url: request.url,
      formatSelector,
      outputTemplate,
      extraArgs,
      onProgress: request.onProgress,
      signal: request.signal,
    });

    const safeName = sanitizeFilename(
      downloadedPath.split(/[/\\\\]/).pop() || `instagram-${request.mediaId}.${ext}`
    );

    return {
      filePath: downloadedPath,
      fileName: safeName,
      fileSizeBytes: 0,
      mimeType: isAudio ? 'audio/mpeg' : 'video/mp4',
      format: request.format,
      title: safeName,
    };
  }
}
