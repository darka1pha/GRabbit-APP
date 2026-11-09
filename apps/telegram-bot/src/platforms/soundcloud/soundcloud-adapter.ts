import { COLLECTION_MAX_ITEMS, PLATFORMS } from '../../config/constants.js';
import {
  IPlatformAdapter,
  PlatformMetadata,
  DownloadRequest,
  DownloadResult,
  MediaOption,
} from '../../core/types/platform.js';
import { YtDlpRunner } from '../../services/downloads/ytdlp-runner.js';
import { sanitizeFilename } from '../../security/filename.js';

export class SoundCloudAdapter implements IPlatformAdapter {
  public readonly platformId = PLATFORMS.SOUNDCLOUD;
  private ytdlp: YtDlpRunner;

  constructor(ytdlpRunner?: YtDlpRunner) {
    this.ytdlp = ytdlpRunner || new YtDlpRunner();
  }

  public matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === 'soundcloud.com' ||
        host === 'www.soundcloud.com' ||
        host === 'on.soundcloud.com' ||
        host === 'm.soundcloud.com'
      );
    } catch {
      return false;
    }
  }

  public normalizeUrl(url: string): string {
    const parsed = new URL(url);
    parsed.searchParams.delete('si');
    parsed.searchParams.delete('utm_source');
    return parsed.toString();
  }

  /** Sets / playlists (soundcloud.com/<artist>/sets/<name>). */
  public static isSetUrl(url: string): boolean {
    try {
      return /\/sets\/[^/]+/.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  private async fetchSetMetadata(url: string): Promise<PlatformMetadata> {
    const { title, uploader, entries } = await this.ytdlp.getPlaylistEntries(
      url,
      COLLECTION_MAX_ITEMS
    );

    return {
      platform: this.platformId,
      url,
      title: title || 'SoundCloud Set',
      artistOrAuthor: uploader,
      isAuthorized: true,
      isCollection: true,
      items: entries.map((e) => ({
        id: e.id,
        title: e.title,
        uploader: e.channel,
        durationSeconds: e.duration,
        thumbnailUrl: e.thumbnail,
        platform: this.platformId,
        url: e.url,
        isDownloadable: true,
        availableOptions: [
          { format: 'audio', qualityId: 'bestaudio', label: 'Audio (MP3)', extension: 'mp3' },
        ],
      })),
    };
  }

  public async fetchMetadata(url: string): Promise<PlatformMetadata> {
    if (SoundCloudAdapter.isSetUrl(url)) {
      return this.fetchSetMetadata(url);
    }

    const raw = await this.ytdlp.getMetadata(url);

    const availableOptions: MediaOption[] = [
      {
        format: 'audio',
        qualityId: 'bestaudio',
        label: 'Audio (MP3 320k/HQ)',
        extension: 'mp3',
        estimatedSizeBytes: raw.filesize || raw.filesize_approx,
      },
    ];

    return {
      platform: this.platformId,
      url,
      title: raw.title || 'SoundCloud Track',
      artistOrAuthor: raw.uploader || raw.channel || 'SoundCloud Artist',
      durationSeconds: raw.duration,
      thumbnailUrl: raw.thumbnail,
      isAuthorized: true,
      items: [
        {
          id: raw.id || 'sc-track',
          title: raw.title || 'SoundCloud Track',
          uploader: raw.uploader,
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
    const outputTemplate = `${request.outputPath}/%(uploader).50s-%(title).50s-%(id)s.%(ext)s`;

    const downloadedPath = await this.ytdlp.downloadMedia({
      url: request.url,
      formatSelector: 'bestaudio/best',
      outputTemplate,
      extraArgs: [
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '--embed-metadata',
        '--embed-thumbnail',
        '--convert-thumbnails',
        'jpg',
      ],
      onProgress: request.onProgress,
      signal: request.signal,
    });

    const safeName = sanitizeFilename(
      downloadedPath.split(/[/\\\\]/).pop() || `soundcloud-${request.mediaId}.mp3`
    );

    return {
      filePath: downloadedPath,
      fileName: safeName,
      fileSizeBytes: 0,
      mimeType: 'audio/mpeg',
      format: 'audio',
      title: safeName,
    };
  }
}
