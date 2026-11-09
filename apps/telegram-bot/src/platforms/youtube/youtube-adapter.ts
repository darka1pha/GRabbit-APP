import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { COLLECTION_MAX_ITEMS, PLATFORMS } from '../../config/constants.js';
import { getConfig } from '../../config/env.js';
import {
  DownloadRequest,
  DownloadResult,
  IPlatformAdapter,
  MediaOption,
  PlatformMetadata,
} from '../../core/types/platform.js';
import { YtDlpMetadata, YtDlpRunner } from '../../services/downloads/ytdlp-runner.js';
import { sanitizeFilename } from '../../security/filename.js';

export function formatResolutionLabel(height: number): string {
  if (height >= 2160) return `${height}p 4K`;
  if (height === 1440) return '1440p 2K';
  if (height === 1080) return '1080p FHD';
  if (height === 720) return '720p HD';
  return `${height}p`;
}

export function getStandardYouTubeMediaOptions(): MediaOption[] {
  return [
    {
      format: 'audio',
      qualityId: 'bestaudio',
      label: 'Audio (MP3)',
      extension: 'mp3',
    },
    ...[1080, 720, 480, 360, 240, 144].map((h) => ({
      format: 'video' as const,
      qualityId: `${h}p`,
      label: formatResolutionLabel(h),
      extension: 'mp4',
    })),
  ];
}

export function extractMediaOptionsFromFormats(
  raw: YtDlpMetadata,
  options?: { includeAudio?: boolean; fallbackStandardQualities?: boolean }
): MediaOption[] {
  const includeAudio = options?.includeAudio ?? true;
  const fallbackStandard = options?.fallbackStandardQualities ?? false;
  const availableOptions: MediaOption[] = [];

  // Find best audio size estimate
  let bestAudioBytes = 0;
  if (raw.formats && raw.formats.length > 0) {
    for (const f of raw.formats) {
      if (f.vcodec === 'none' && f.acodec && f.acodec !== 'none') {
        const size =
          f.filesize ||
          f.filesize_approx ||
          (f.tbr && raw.duration ? Math.round(((f.tbr * 1000) / 8) * raw.duration) : 0);
        if (size > bestAudioBytes) {
          bestAudioBytes = size;
        }
      }
    }
  }

  if (includeAudio) {
    availableOptions.push({
      format: 'audio',
      qualityId: 'bestaudio',
      label: 'Audio (MP3)',
      extension: 'mp3',
      estimatedSizeBytes: bestAudioBytes || raw.filesize_approx,
    });
  }

  // Collect ALL distinct video resolutions (144p up to 4K+)
  if (raw.formats && raw.formats.length > 0) {
    const heightSizeMap = new Map<number, number>();
    for (const f of raw.formats) {
      if (f.height && f.height >= 144 && f.vcodec && f.vcodec !== 'none') {
        const size =
          f.filesize ||
          f.filesize_approx ||
          (f.tbr && raw.duration ? Math.round(((f.tbr * 1000) / 8) * raw.duration) : 0);
        const prev = heightSizeMap.get(f.height) || 0;
        if (size > prev) {
          heightSizeMap.set(f.height, size);
        } else if (!heightSizeMap.has(f.height)) {
          heightSizeMap.set(f.height, 0);
        }
      }
    }

    const sortedHeights = Array.from(heightSizeMap.keys()).sort((a, b) => b - a);

    for (const h of sortedHeights) {
      const videoBytes = heightSizeMap.get(h) || 0;
      const estimatedTotal = videoBytes > 0 ? videoBytes + bestAudioBytes : undefined;
      availableOptions.push({
        format: 'video',
        qualityId: `${h}p`,
        label: formatResolutionLabel(h),
        extension: 'mp4',
        estimatedSizeBytes: estimatedTotal,
      });
    }
  }

  if (availableOptions.filter((o) => o.format === 'video').length === 0) {
    if (fallbackStandard) {
      for (const h of [1080, 720, 480, 360, 240, 144]) {
        availableOptions.push({
          format: 'video',
          qualityId: `${h}p`,
          label: formatResolutionLabel(h),
          extension: 'mp4',
        });
      }
    } else {
      availableOptions.push({
        format: 'video',
        qualityId: 'best',
        label: 'Best MP4',
        extension: 'mp4',
        estimatedSizeBytes: raw.filesize || raw.filesize_approx,
      });
    }
  }

  return availableOptions;
}

export function resolveYouTubeCookiesPath(): string | undefined {
  const config = getConfig();
  const candidates = [
    config.YOUTUBE_COOKIES_FILE,
    resolve(process.cwd(), config.TEMP_DIR, 'youtube_cookies.txt'),
    join(process.cwd(), 'cookies.txt'),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

export function getYouTubeYtDlpExtraArgs(): string[] {
  const config = getConfig();
  const clientList = config.YTDLP_YOUTUBE_CLIENTS || 'default';
  const args: string[] = [
    '--extractor-args',
    `youtube:player_client=${clientList}`,
    '--js-runtimes',
    'node',
  ];

  if (config.YTDLP_FORCE_IPV4) {
    args.push('-4');
  }

  if (config.YTDLP_PROXY) {
    args.push('--proxy', config.YTDLP_PROXY);
  }

  const cookiesFile = resolveYouTubeCookiesPath();
  if (cookiesFile) {
    // Copy master cookies file to a runtime copy so yt-dlp never corrupts or clears the master file on exit
    const runtimeCookiesFile = resolve(dirname(cookiesFile), 'youtube_cookies_runtime.txt');
    let targetFile = cookiesFile;
    try {
      copyFileSync(cookiesFile, runtimeCookiesFile);
      targetFile = runtimeCookiesFile;
    } catch {
      targetFile = cookiesFile;
    }
    args.push('--cookies', targetFile);
  }

  return args;
}

export class YouTubeAdapter implements IPlatformAdapter {
  public readonly platformId = PLATFORMS.YOUTUBE;
  private ytdlp: YtDlpRunner;

  constructor(ytdlpRunner?: YtDlpRunner) {
    this.ytdlp = ytdlpRunner || new YtDlpRunner();
  }

  private getExtraArgs(): string[] {
    return getYouTubeYtDlpExtraArgs();
  }

  public matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtu.be'
      );
    } catch {
      return false;
    }
  }

  public normalizeUrl(url: string): string {
    const parsed = new URL(url);
    parsed.searchParams.delete('si');
    parsed.searchParams.delete('feature');
    return parsed.toString();
  }

  /** Playlist pages (youtube.com/playlist?list=…). A watch link with &list= stays a single video. */
  public static isPlaylistUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.pathname === '/playlist' && parsed.searchParams.has('list');
    } catch {
      return false;
    }
  }

  private async fetchPlaylistMetadata(url: string): Promise<PlatformMetadata> {
    const { title, uploader, entries } = await this.ytdlp.getPlaylistEntries(
      url,
      COLLECTION_MAX_ITEMS,
      this.getExtraArgs()
    );

    return {
      platform: this.platformId,
      url,
      title: title || 'YouTube Playlist',
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
        availableOptions: getStandardYouTubeMediaOptions(),
      })),
    };
  }

  public async fetchMetadata(url: string): Promise<PlatformMetadata> {
    if (YouTubeAdapter.isPlaylistUrl(url)) {
      return this.fetchPlaylistMetadata(url);
    }

    let raw: YtDlpMetadata;
    try {
      raw = await this.ytdlp.getMetadata(url, this.getExtraArgs());
    } catch (err) {
      // Fallback to YouTube oEmbed when yt-dlp metadata extraction is blocked by bot verification
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
          { signal: AbortSignal.timeout(3500) }
        );
        if (res.ok) {
          const oembed = (await res.json()) as {
            title?: string;
            author_name?: string;
            thumbnail_url?: string;
          };
          const parsedUrl = new URL(url);
          const videoId =
            parsedUrl.searchParams.get('v') ||
            parsedUrl.pathname.split('/').filter(Boolean).pop() ||
            'yt-media';
          raw = {
            id: videoId,
            title: oembed.title || 'YouTube Video',
            channel: oembed.author_name || 'YouTube Channel',
            thumbnail: oembed.thumbnail_url,
          };
        } else {
          throw err;
        }
      } catch {
        throw err;
      }
    }

    const availableOptions = extractMediaOptionsFromFormats(raw, {
      includeAudio: true,
      fallbackStandardQualities: true,
    });

    return {
      platform: this.platformId,
      url,
      title: raw.title || 'YouTube Media',
      artistOrAuthor: raw.channel || raw.uploader || 'YouTube Channel',
      durationSeconds: raw.duration,
      thumbnailUrl: raw.thumbnail,
      isAuthorized: true,
      items: [
        {
          id: raw.id || 'yt-media',
          title: raw.title || 'YouTube Media',
          uploader: raw.channel || raw.uploader,
          durationSeconds: raw.duration,
          thumbnailUrl: raw.thumbnail,
          platform: this.platformId,
          url,
          isDownloadable: !raw.is_live,
          unavailableReason: raw.is_live ? 'Live streams cannot be downloaded' : undefined,
          availableOptions,
        },
      ],
      raw,
    };
  }

  public async download(request: DownloadRequest): Promise<DownloadResult> {
    const isAudio = request.format === 'audio';
    const ext = isAudio ? 'mp3' : 'mp4';
    const outputTemplate = `${request.outputPath}/%(title).100s-%(id)s.%(ext)s`;

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

    let formatSelector = request.qualityId;
    if (isAudio) {
      formatSelector = 'bestaudio/best';
    } else if (request.qualityId.endsWith('p')) {
      const height = parseInt(request.qualityId, 10);
      if (!isNaN(height)) {
        formatSelector = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
      }
    } else if (request.qualityId === 'best') {
      formatSelector = 'bestvideo+bestaudio/best';
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
      downloadedPath.split(/[/\\\\]/).pop() || `youtube-${request.mediaId}.${ext}`
    );

    return {
      filePath: downloadedPath,
      fileName: safeName,
      fileSizeBytes: 0, // to be populated after probe/stat
      mimeType: isAudio ? 'audio/mpeg' : 'video/mp4',
      format: request.format,
      title: safeName,
    };
  }
}
