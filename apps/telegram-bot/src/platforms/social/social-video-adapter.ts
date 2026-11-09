import { PlatformId } from '../../config/constants.js';
import {
  IPlatformAdapter,
  PlatformMetadata,
  DownloadRequest,
  DownloadResult,
} from '../../core/types/platform.js';
import { YtDlpRunner } from '../../services/downloads/ytdlp-runner.js';
import { sanitizeFilename } from '../../security/filename.js';
import { extractMediaOptionsFromFormats } from '../youtube/youtube-adapter.js';

export class SocialVideoAdapter implements IPlatformAdapter {
  public readonly platformId: PlatformId;
  private readonly hostnames: string[];
  private readonly displayLabel: string;
  private ytdlp: YtDlpRunner;

  constructor(options: {
    platformId: PlatformId;
    hostnames: string[];
    displayLabel: string;
    ytdlpRunner?: YtDlpRunner;
  }) {
    this.platformId = options.platformId;
    this.hostnames = options.hostnames;
    this.displayLabel = options.displayLabel;
    this.ytdlp = options.ytdlpRunner || new YtDlpRunner();
  }

  public matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return this.hostnames.includes(host);
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
    const raw = await this.ytdlp.getMetadata(url);

    const availableOptions = extractMediaOptionsFromFormats(raw, {
      includeAudio: true,
      fallbackStandardQualities: false,
    });

    return {
      platform: this.platformId,
      url,
      title: raw.title || `${this.displayLabel} Media`,
      artistOrAuthor: raw.uploader || raw.channel || `${this.displayLabel} Creator`,
      durationSeconds: raw.duration,
      thumbnailUrl: raw.thumbnail,
      isAuthorized: true,
      items: [
        {
          id: raw.id || `${this.platformId}-media`,
          title: raw.title || `${this.displayLabel} Media`,
          uploader: raw.uploader || raw.channel,
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
    const outputTemplate = `${request.outputPath}/${this.platformId}-%(id)s.%(ext)s`;

    const extraArgs: string[] = ['--embed-metadata'];
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
      downloadedPath.split(/[/\\\\]/).pop() || `${this.platformId}-${request.mediaId}.${ext}`
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
