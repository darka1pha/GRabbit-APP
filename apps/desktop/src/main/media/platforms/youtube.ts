import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaOption, PlatformMetadata } from '../../../shared/types';
import { getMediaConfig } from '../config';
import { YtDlpMetadata, YtDlpRunner } from '../ytdlp-runner';
import { sanitizeFilename } from '../filename';
import type { DownloadRequest, DownloadResult, IPlatformAdapter } from './types';

/** Upper bound for playlist / set listings (a safety net, not a practical limit). */
export const COLLECTION_MAX_ITEMS = 5000;

export function formatResolutionLabel(height: number): string {
  if (height >= 4320) return `${height}p 8K`;
  if (height >= 2160) return `${height}p 4K`;
  if (height === 1440) return '1440p 2K';
  if (height === 1080) return '1080p Full HD';
  if (height === 720) return '720p HD';
  return `${height}p`;
}

export function audioOptions(sizeBytes?: number): MediaOption[] {
  return [
    {
      format: 'audio',
      qualityId: 'm4a',
      label: 'M4A (Original)',
      extension: 'm4a',
      estimatedSizeBytes: sizeBytes,
      isOriginalQuality: true,
    },
    {
      format: 'audio',
      qualityId: 'mp3-320',
      label: 'MP3 320k',
      extension: 'mp3',
      estimatedSizeBytes: sizeBytes ? Math.round(sizeBytes * 1.1) : undefined,
    },
    {
      format: 'audio',
      qualityId: 'mp3-192',
      label: 'MP3 192k',
      extension: 'mp3',
      estimatedSizeBytes: sizeBytes ? Math.round(sizeBytes * 0.7) : undefined,
    },
    {
      format: 'audio',
      qualityId: 'mp3-128',
      label: 'MP3 128k',
      extension: 'mp3',
      estimatedSizeBytes: sizeBytes ? Math.round(sizeBytes * 0.45) : undefined,
    },
    {
      format: 'audio',
      qualityId: 'flac',
      label: 'FLAC (Lossless)',
      extension: 'flac',
      estimatedSizeBytes: sizeBytes ? Math.round(sizeBytes * 2.2) : undefined,
    },
  ];
}

export function standardVideoOptions(): MediaOption[] {
  return [2160, 1440, 1080, 720, 480, 360].map((h) => ({
    format: 'video' as const,
    qualityId: `${h}p`,
    label: formatResolutionLabel(h),
    extension: 'mp4',
  }));
}

export function standardMediaOptions(): MediaOption[] {
  return [...audioOptions(), ...standardVideoOptions()];
}

export function extractMediaOptionsFromFormats(
  raw: YtDlpMetadata,
  options?: { includeAudio?: boolean; fallbackStandardQualities?: boolean }
): MediaOption[] {
  const includeAudio = options?.includeAudio ?? true;
  const fallbackStandard = options?.fallbackStandardQualities ?? false;
  const result: MediaOption[] = [];
  const sizeOf = (f: { filesize?: number; filesize_approx?: number; tbr?: number }) =>
    f.filesize || f.filesize_approx || (f.tbr && raw.duration ? Math.round(((f.tbr * 1000) / 8) * raw.duration) : 0);

  let bestAudioBytes = 0;
  for (const f of raw.formats ?? []) {
    if (f.vcodec === 'none' && f.acodec && f.acodec !== 'none') bestAudioBytes = Math.max(bestAudioBytes, sizeOf(f));
  }

  if (includeAudio) result.push(...audioOptions(bestAudioBytes || undefined));

  const heightSize = new Map<number, number>();
  for (const f of raw.formats ?? []) {
    if (f.height && f.height >= 144 && f.vcodec && f.vcodec !== 'none') {
      heightSize.set(f.height, Math.max(heightSize.get(f.height) ?? 0, sizeOf(f)));
    }
  }
  for (const h of [...heightSize.keys()].sort((a, b) => b - a)) {
    const videoBytes = heightSize.get(h) || 0;
    result.push({
      format: 'video',
      qualityId: `${h}p`,
      label: formatResolutionLabel(h),
      extension: 'mp4',
      estimatedSizeBytes: videoBytes > 0 ? videoBytes + bestAudioBytes : undefined,
    });
  }

  if (!result.some((o) => o.format === 'video')) {
    if (fallbackStandard) result.push(...standardVideoOptions());
    else
      result.push({
        format: 'video',
        qualityId: 'best',
        label: 'Best quality',
        extension: 'mp4',
        estimatedSizeBytes: raw.filesize || raw.filesize_approx,
      });
  }
  return result;
}

/** Cookie arguments from the settings (a cookies.txt file wins over a browser). */
export function cookieArgs(): string[] {
  const cfg = getMediaConfig();
  if (cfg.cookiesFile && existsSync(cfg.cookiesFile)) {
    // yt-dlp rewrites the cookie jar on exit: hand it a copy so the user's file stays intact
    const runtimeCopy = join(cfg.tempDir || '.', 'cookies-runtime.txt');
    try {
      copyFileSync(cfg.cookiesFile, runtimeCopy);
      return ['--cookies', runtimeCopy];
    } catch {
      return ['--cookies', cfg.cookiesFile];
    }
  }
  if (cfg.cookiesFromBrowser) return ['--cookies-from-browser', cfg.cookiesFromBrowser];
  return [];
}

export function getYouTubeYtDlpExtraArgs(): string[] {
  const args = ['--extractor-args', 'youtube:player_client=default'];
  if (getMediaConfig().forceIpv4) args.push('-4');
  return [...args, ...cookieArgs()];
}

/** yt-dlp arguments + format selector for an audio/video choice. Shared by the yt-dlp based adapters. */
export function buildFormatArgs(request: DownloadRequest): { formatSelector: string; args: string[]; ext: string } {
  if (request.format === 'audio') {
    const isM4A = request.qualityId === 'm4a';
    const isFlac = request.qualityId === 'flac';
    const ext = isM4A ? 'm4a' : isFlac ? 'flac' : 'mp3';

    let audioQuality = '0';
    if (request.qualityId === 'mp3-320') audioQuality = '320K';
    else if (request.qualityId === 'mp3-192') audioQuality = '192K';
    else if (request.qualityId === 'mp3-128') audioQuality = '128K';

    return {
      ext,
      formatSelector:
        ext === 'm4a' ? 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best' : 'bestaudio/best',
      args: [
        '--extract-audio',
        '--audio-format',
        ext,
        '--audio-quality',
        audioQuality,
        '--embed-metadata',
        '--embed-thumbnail',
        '--convert-thumbnails',
        'jpg',
      ],
    };
  }

  let formatSelector = 'bestvideo+bestaudio/best';
  const height = parseInt(request.qualityId, 10);
  if (request.qualityId.endsWith('p') && !isNaN(height)) {
    formatSelector = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
  }
  return {
    ext: 'mp4',
    formatSelector,
    args: ['--merge-output-format', 'mp4', '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg'],
  };
}

/** Download through yt-dlp with a stable output name, so a resumed job finds its .part files. */
export async function ytdlpDownload(
  ytdlp: YtDlpRunner,
  request: DownloadRequest,
  extraArgs: string[] = []
): Promise<DownloadResult> {
  const { formatSelector, args, ext } = buildFormatArgs(request);
  const filePath = await ytdlp.downloadMedia({
    url: request.url,
    formatSelector,
    outputTemplate: join(request.outputPath, 'media.%(ext)s'),
    extraArgs: [...extraArgs, ...args],
    onProgress: request.onProgress,
    onStage: request.onStage,
    signal: request.signal,
  });
  const finalExt = filePath.split('.').pop() || ext;
  const title = request.title || request.mediaId;
  return {
    filePath,
    fileName: sanitizeFilename(`${title}.${finalExt}`, `${request.platform}-${request.mediaId}.${finalExt}`),
    mimeType: request.format === 'audio' ? (finalExt === 'm4a' ? 'audio/mp4' : 'audio/mpeg') : 'video/mp4',
    format: request.format,
    title,
  };
}

export class YouTubeAdapter implements IPlatformAdapter {
  public readonly platformId = 'youtube' as const;

  constructor(private ytdlp: YtDlpRunner = new YtDlpRunner()) {}

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
      getYouTubeYtDlpExtraArgs()
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
        availableOptions: standardMediaOptions(),
      })),
    };
  }

  public async fetchMetadata(url: string): Promise<PlatformMetadata> {
    if (YouTubeAdapter.isPlaylistUrl(url)) return this.fetchPlaylistMetadata(url);

    let raw: YtDlpMetadata;
    try {
      raw = await this.ytdlp.getMetadata(url, getYouTubeYtDlpExtraArgs());
    } catch (err) {
      // oEmbed fallback when yt-dlp is blocked by bot verification
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      if (!res?.ok) throw err;
      const oembed = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
      const parsedUrl = new URL(url);
      raw = {
        id: parsedUrl.searchParams.get('v') || parsedUrl.pathname.split('/').filter(Boolean).pop() || 'yt-media',
        title: oembed.title || 'YouTube Video',
        channel: oembed.author_name,
        thumbnail: oembed.thumbnail_url,
      };
    }

    return {
      platform: this.platformId,
      url,
      title: raw.title || 'YouTube Media',
      artistOrAuthor: raw.channel || raw.uploader,
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
          availableOptions: extractMediaOptionsFromFormats(raw, { includeAudio: true, fallbackStandardQualities: true }),
        },
      ],
    };
  }

  public download(request: DownloadRequest): Promise<DownloadResult> {
    return ytdlpDownload(this.ytdlp, request, getYouTubeYtDlpExtraArgs());
  }
}
