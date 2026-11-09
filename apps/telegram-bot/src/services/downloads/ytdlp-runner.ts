import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfig } from '../../config/env.js';
import {
  DownloadError,
  JobCancelledError,
  MediaUnavailableError,
  UnauthorizedContentError,
} from '../../core/errors/domain-errors.js';
import { logger } from '../../observability/logger.js';
import { DownloadProgress } from '../../core/types/platform.js';

export interface YtDlpFormat {
  format_id?: string;
  format_note?: string;
  ext?: string;
  height?: number;
  width?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
}

export interface YtDlpMetadata {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  filesize?: number;
  filesize_approx?: number;
  is_live?: boolean;
  formats?: YtDlpFormat[];
  [key: string]: unknown;
}

export interface YtDlpSearchResult {
  id: string;
  title: string;
  url: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  /** 'youtube-music' for YouTube Music "Songs" results (official label uploads from the master). */
  source?: 'youtube' | 'youtube-music';
}

/** InnerTube search `params` for YouTube Music's "Songs" filter. */
const YTM_SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

export interface YtDlpDownloadOptions {
  url: string;
  formatSelector?: string;
  outputTemplate: string;
  extraArgs?: string[];
  onProgress?: (progress: DownloadProgress) => Promise<void> | void;
  signal?: AbortSignal;
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, '');
}

function parseDurationText(text?: string): number | undefined {
  if (!text) return undefined;
  const parts = text
    .trim()
    .split(':')
    .map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return undefined;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0];
}

type InnerTubeRun = {
  text?: string;
  navigationEndpoint?: {
    browseEndpoint?: {
      browseEndpointContextSupportedConfigs?: {
        browseEndpointContextMusicConfig?: { pageType?: string };
      };
    };
  };
};

/** Extracts song rows (video id, title, artists, duration) from a YouTube Music search response. */
export function parseYouTubeMusicSongs(data: unknown): YtDlpSearchResult[] {
  const results: YtDlpSearchResult[] = [];
  const tabs = (data as any)?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
  const sections = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

  for (const section of sections) {
    for (const item of section?.musicShelfRenderer?.contents ?? []) {
      const row = item?.musicResponsiveListItemRenderer;
      const id: string | undefined =
        row?.playlistItemData?.videoId ??
        row?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
          ?.playNavigationEndpoint?.watchEndpoint?.videoId;
      if (!id) continue;

      const columnRuns = (index: number): InnerTubeRun[] =>
        row?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];

      const title = columnRuns(0)
        .map((r) => r.text ?? '')
        .join('')
        .trim();
      if (!title) continue;

      // Second column: "Artist[, Artist] • Album • 3:19"
      const details = columnRuns(1);
      const artists = details
        .filter(
          (r) =>
            r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
              ?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST'
        )
        .map((r) => r.text ?? '')
        .filter(Boolean);
      const durationText = [...details].reverse().find((r) => /^\d+(:\d{2}){1,2}$/.test(r.text ?? ''));

      const thumbs = row?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
      results.push({
        id,
        title,
        url: `https://www.youtube.com/watch?v=${id}`,
        channel: artists.length > 0 ? artists.join(', ') : details[0]?.text,
        duration: parseDurationText(durationText?.text),
        thumbnail: Array.isArray(thumbs) ? thumbs[thumbs.length - 1]?.url : undefined,
        source: 'youtube-music',
      });
    }
  }
  return results;
}

/** Parses `--flat-playlist --dump-json` output (one JSON object per line) into entries. */
function parseFlatEntries(
  stdout: string,
  fallbackUrl?: (id: string) => string
): YtDlpSearchResult[] {
  const results: YtDlpSearchResult[] = [];
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'));

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as YtDlpMetadata & {
        url?: string;
        webpage_url?: string;
        thumbnails?: Array<{ url?: string }>;
      };
      const id = parsed.id;
      if (!id) continue;

      const entryUrl =
        typeof parsed.webpage_url === 'string' && parsed.webpage_url.startsWith('http')
          ? parsed.webpage_url
          : typeof parsed.url === 'string' && parsed.url.startsWith('http')
            ? parsed.url
            : fallbackUrl?.(id);
      if (!entryUrl) continue;

      const thumb =
        parsed.thumbnail ||
        (Array.isArray(parsed.thumbnails) && parsed.thumbnails.length > 0
          ? parsed.thumbnails[parsed.thumbnails.length - 1]?.url
          : undefined);

      results.push({
        id,
        title: parsed.title || `#${results.length + 1}`,
        url: entryUrl,
        channel: parsed.channel || parsed.uploader || undefined,
        duration: typeof parsed.duration === 'number' ? parsed.duration : undefined,
        thumbnail: thumb,
      });
    } catch {
      // Ignore malformed line
    }
  }

  return results;
}

export class YtDlpRunner {
  private binaryPath: string;

  constructor(binaryPath?: string) {
    const configured = binaryPath || getConfig().YTDLP_PATH;
    if (configured === 'yt-dlp') {
      const localBin = join(process.cwd(), 'bin', 'yt-dlp.exe');
      if (existsSync(localBin)) {
        this.binaryPath = localBin;
        return;
      }
    }
    this.binaryPath = configured;
  }

  public async getMetadata(url: string, extraArgs: string[] = []): Promise<YtDlpMetadata> {
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      ...extraArgs,
      url,
    ];

    logger.debug({ url, args }, 'Fetching metadata via yt-dlp');
    const { stdout } = await this.runProcess(args);

    try {
      const firstLine = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith('{'));
      return JSON.parse(firstLine || stdout.trim()) as YtDlpMetadata;
    } catch {
      throw new DownloadError('Failed to parse metadata JSON from yt-dlp');
    }
  }

  private async fastYoutubeInnerTubeSearch(
    query: string,
    limit: number
  ): Promise<YtDlpSearchResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240726.00.00',
              hl: 'en',
              gl: 'US',
            },
          },
          query,
        }),
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const data = (await res.json()) as any;
      const sections =
        data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
          ?.contents || [];

      const results: YtDlpSearchResult[] = [];
      for (const sec of sections) {
        const items = sec?.itemSectionRenderer?.contents || [];
        for (const item of items) {
          const v = item?.videoRenderer;
          if (!v?.videoId) continue;

          const title = Array.isArray(v.title?.runs)
            ? v.title.runs.map((r: any) => r.text).join('')
            : v.title?.simpleText || 'YouTube Media';

          const channel =
            v.ownerText?.runs?.[0]?.text ||
            v.longBylineText?.runs?.[0]?.text ||
            v.shortBylineText?.runs?.[0]?.text ||
            undefined;

          const duration = parseDurationText(v.lengthText?.simpleText);
          const thumbs = v.thumbnail?.thumbnails;
          const thumbnail =
            Array.isArray(thumbs) && thumbs.length > 0
              ? thumbs[thumbs.length - 1]?.url
              : undefined;

          results.push({
            id: v.videoId,
            title,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            channel,
            duration,
            thumbnail,
          });

          if (results.length >= limit) {
            return results;
          }
        }
      }

      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Searches YouTube Music's "Songs" category: official audio uploads (album art tracks)
   * distributed by labels from the master recording, rather than fan re-uploads.
   * Returns [] on any failure; `channel` holds the artist names.
   */
  public async searchYouTubeMusicSongs(
    query: string,
    limit = 5,
    timeoutMs = 8000
  ): Promise<YtDlpSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://music.youtube.com',
          Referer: 'https://music.youtube.com/',
        },
        body: JSON.stringify({
          context: {
            client: { clientName: 'WEB_REMIX', clientVersion: '1.20240724.00.00', hl: 'en', gl: 'US' },
          },
          query: cleanQuery,
          params: YTM_SONGS_FILTER,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return [];
      return parseYouTubeMusicSongs(await res.json()).slice(0, Math.max(1, limit));
    } catch (err) {
      logger.debug({ err, query: cleanQuery }, 'YouTube Music song search failed');
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  public async search(query: string, limit = 5, extraArgs: string[] = []): Promise<YtDlpSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const safeLimit = Math.max(1, Math.min(20, limit));

    // Fast path (~250ms) for interactive & inline search in production/development
    if (process.env.NODE_ENV !== 'test') {
      const fastResults = await this.fastYoutubeInnerTubeSearch(cleanQuery, safeLimit);
      if (fastResults.length > 0) {
        return fastResults;
      }
    }

    const searchTarget = `ytsearch${safeLimit}:${cleanQuery}`;
    const args = [
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      ...extraArgs,
      searchTarget,
    ];

    logger.debug({ query: cleanQuery, limit: safeLimit }, 'Searching YouTube via yt-dlp');
    const { stdout } = await this.runProcess(args);

    return parseFlatEntries(stdout, (id) => `https://www.youtube.com/watch?v=${id}`).slice(
      0,
      safeLimit
    );
  }

  /**
   * Lists the entries of a playlist / album / set without resolving each one
   * (`--flat-playlist`), capped at `limit`. Also returns the playlist's own title/uploader.
   */
  public async getPlaylistEntries(
    url: string,
    limit = 50,
    extraArgs: string[] = []
  ): Promise<{ title?: string; uploader?: string; entries: YtDlpSearchResult[] }> {
    const args = [
      '--dump-json',
      '--flat-playlist',
      '--yes-playlist',
      '--no-warnings',
      '--playlist-end',
      String(Math.max(1, limit)),
      ...extraArgs,
      url,
    ];

    logger.debug({ url, limit }, 'Listing playlist entries via yt-dlp');
    const { stdout } = await this.runProcess(args);

    let title: string | undefined;
    let uploader: string | undefined;
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        title = (parsed.playlist_title || parsed.playlist) as string | undefined;
        uploader = (parsed.playlist_uploader || parsed.playlist_channel) as string | undefined;
        break;
      } catch {}
    }

    return { title, uploader, entries: parseFlatEntries(stdout).slice(0, limit) };
  }

  public async downloadMedia(options: YtDlpDownloadOptions): Promise<string> {
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--progress',
      '--progress-delta', '1',
      '--progress-template', 'download:GRABBIT_PROGRESS|%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s',
      '--print', 'after_move:filepath',
    ];

    const localFfmpeg = join(process.cwd(), 'bin', 'ffmpeg.exe');
    if (existsSync(localFfmpeg)) {
      args.push('--ffmpeg-location', dirname(localFfmpeg));
    }

    if (options.formatSelector) {
      args.push('-f', options.formatSelector);
    }

    args.push('-o', options.outputTemplate);

    if (options.extraArgs && options.extraArgs.length > 0) {
      args.push(...options.extraArgs);
    }

    args.push(options.url);

    logger.debug({ url: options.url, args }, 'Downloading media via yt-dlp');
    const { stdout } = await this.runProcess(
      args,
      (line) => {
        if (line.includes('GRABBIT_PROGRESS|')) {
          const payload = stripAnsi(line).split('GRABBIT_PROGRESS|')[1];
          if (payload) {
            const [percentStr, etaStr, speedStr] = payload.split('|');
            const percent = parseFloat((percentStr || '').replace('%', '').trim());
            if (!isNaN(percent)) {
              const eta = etaStr?.trim();
              const speed = speedStr?.trim();
              options.onProgress?.({
                percent,
                eta: eta && eta !== 'Unknown' && eta !== 'NA' ? eta : undefined,
                speed: speed && speed !== 'Unknown' && speed !== 'NA' ? speed : undefined,
              });
            }
          }
        }
      },
      options.signal
    );

    // 1. First attempt to match an existing file path from stdout lines
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !l.includes('GRABBIT_PROGRESS|'));

    for (const line of [...lines].reverse()) {
      if (existsSync(line) && !line.endsWith('.jpg') && !line.endsWith('.webp')) {
        return line;
      }
    }

    // 2. Fallback: inspect the output directory for downloaded media files
    const outputDir = dirname(options.outputTemplate);
    if (existsSync(outputDir)) {
      const files = readdirSync(outputDir)
        .filter(
          (file) =>
            !file.endsWith('.part') &&
            !file.endsWith('.ytdl') &&
            !file.endsWith('.jpg') &&
            !file.endsWith('.webp')
        )
        .map((file) => join(outputDir, file))
        .filter((fullPath) => {
          try {
            return statSync(fullPath).isFile();
          } catch {
            return false;
          }
        });

      if (files.length > 0) {
        // Return the newest file if multiple exist
        files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
        return files[0];
      }
    }

    // 3. Fallback to the last stdout line if non-empty
    if (lines.length > 0) {
      return lines[lines.length - 1];
    }

    throw new DownloadError('yt-dlp finished but downloaded media file could not be located');
  }

  private async runProcess(
    args: string[],
    onLine?: (line: string) => void,
    signal?: AbortSignal
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new JobCancelledError('aborted'));
        return;
      }

      const child = spawn(this.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let isAborted = false;

      const onAbort = () => {
        isAborted = true;
        try {
          child.kill('SIGTERM');
        } catch {}
        reject(new JobCancelledError('aborted'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (d: Buffer) => {
        const chunk = d.toString();
        stdout += chunk;
        if (onLine) {
          stdoutBuffer += chunk;
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() || '';
          for (const line of lines) {
            onLine(line);
          }
        }
      });

      child.stderr.on('data', (d: Buffer) => {
        const chunk = d.toString();
        stderr += chunk;
        if (onLine) {
          stderrBuffer += chunk;
          const lines = stderrBuffer.split(/\r?\n/);
          stderrBuffer = lines.pop() || '';
          for (const line of lines) {
            onLine(line);
          }
        }
      });

      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (isAborted) return;

        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const errLower = stderr.toLowerCase();
          if (errLower.includes('drm protected')) {
            reject(
              new UnauthorizedContentError(
                `DRM-protected content: ${stderr.trim()}`,
                'error-drm-protected'
              )
            );
          } else if (
            errLower.includes('not a bot') ||
            errLower.includes('use --cookies') ||
            errLower.includes('cookies-from-browser')
          ) {
            reject(
              new UnauthorizedContentError(
                `Bot verification / cookies required: ${stderr.trim()}`,
                'error-bot-verification'
              )
            );
          } else if (
            errLower.includes('private video') ||
            errLower.includes('sign in') ||
            errLower.includes('login') ||
            errLower.includes('requires authentication') ||
            errLower.includes('members-only') ||
            errLower.includes('restricted') ||
            errLower.includes('copyright')
          ) {
            reject(
              new UnauthorizedContentError(
                `Content restricted or requires authorization: ${stderr.trim()}`
              )
            );
          } else if (
            errLower.includes('video unavailable') ||
            errLower.includes('not available') ||
            errLower.includes('not found') ||
            errLower.includes('does not exist') ||
            errLower.includes('removed') ||
            errLower.includes('deleted') ||
            errLower.includes('requested format is not available')
          ) {
            reject(new MediaUnavailableError(`Media unavailable: ${stderr.trim()}`));
          } else {
            logger.error({ code, stderr, args }, 'yt-dlp execution error');
            reject(new DownloadError(`yt-dlp failed with exit code ${code}: ${stderr.trim()}`));
          }
        }
      });

      child.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        if (isAborted) return;
        logger.error({ err, binary: this.binaryPath }, 'yt-dlp process spawn error');
        reject(
          new DownloadError(
            `Failed to execute yt-dlp binary (${this.binaryPath}): ${err.message}`
          )
        );
      });
    });
  }
}
