import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getMediaConfig } from './config';
import {
  DownloadError,
  JobCancelledError,
  MediaUnavailableError,
  UnauthorizedContentError,
} from './errors';
import { logger } from '../logger';

export interface DownloadProgress {
  percent: number;
  downloadedBytes?: number;
  totalBytes?: number;
  /** Bytes per second */
  speed?: number;
  /** Seconds */
  eta?: number;
}

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
  extractor_key?: string;
  webpage_url?: string;
  [key: string]: unknown;
}

export interface YtDlpSearchResult {
  id: string;
  title: string;
  url: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  /** 'youtube-music' for YouTube Music "Songs" results (official label uploads). */
  source?: 'youtube' | 'youtube-music';
}

/** InnerTube search `params` for YouTube Music's "Songs" filter. */
const YTM_SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

export interface YtDlpDownloadOptions {
  url: string;
  formatSelector?: string;
  outputTemplate: string;
  extraArgs?: string[];
  onProgress?: (progress: DownloadProgress) => void;
  /** Called with post-processing stage names (Merger, ExtractAudio, ...). */
  onStage?: (stage: string) => void;
  signal?: AbortSignal;
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;
const PROGRESS_MARK = 'GRABBIT_PROGRESS|';
const MEDIA_EXTENSIONS_TO_SKIP = ['.part', '.ytdl', '.jpg', '.jpeg', '.webp', '.png', '.temp', '.txt'];

function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, '');
}

function toNumber(text?: string): number | undefined {
  if (!text) return undefined;
  const n = Number(text.trim());
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parseDurationText(text?: string): number | undefined {
  if (!text) return undefined;
  const parts = text
    .trim()
    .split(':')
    .map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/** Parses one progress line printed through our --progress-template. */
export function parseProgressLine(line: string): DownloadProgress | null {
  const idx = line.indexOf(PROGRESS_MARK);
  if (idx < 0) return null;
  const [percentStr, downloaded, total, estimate, speed, eta] = stripAnsi(line)
    .substring(stripAnsi(line).indexOf(PROGRESS_MARK) + PROGRESS_MARK.length)
    .split('|');
  const downloadedBytes = toNumber(downloaded);
  const totalBytes = toNumber(total) ?? toNumber(estimate);
  let percent = parseFloat((percentStr || '').replace('%', '').trim());
  if (isNaN(percent) && downloadedBytes !== undefined && totalBytes) {
    percent = (downloadedBytes / totalBytes) * 100;
  }
  if (isNaN(percent)) return null;
  return { percent, downloadedBytes, totalBytes, speed: toNumber(speed), eta: toNumber(eta) };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      const details = columnRuns(1);
      const artists = details
        .filter(
          (r) =>
            r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
              ?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST'
        )
        .map((r) => r.text ?? '')
        .filter(Boolean);
      const durationText = [...details]
        .reverse()
        .find((r) => /^\d+(:\d{2}){1,2}$/.test(r.text ?? ''));

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
function parseFlatEntries(stdout: string, fallbackUrl?: (id: string) => string): YtDlpSearchResult[] {
  const results: YtDlpSearchResult[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as YtDlpMetadata & {
        url?: string;
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
  /** Arguments every yt-dlp call gets: encoding, proxy, ffmpeg and JS runtime locations. */
  private baseArgs(): string[] {
    const cfg = getMediaConfig();
    const args = ['--encoding', 'utf-8', '--no-colors'];
    if (cfg.proxy) args.push('--proxy', cfg.proxy);
    if (cfg.ffmpegDir) args.push('--ffmpeg-location', cfg.ffmpegDir);
    if (cfg.jsRuntime) args.push('--js-runtimes', `node:${cfg.jsRuntime.path}`);
    return args;
  }

  private env(): NodeJS.ProcessEnv {
    const cfg = getMediaConfig();
    return {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      ...(cfg.jsRuntime?.env ?? {}),
    };
  }

  public async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await this.runProcess(['--version'], undefined, undefined, false);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Runs `yt-dlp -U` and returns its output. */
  public async selfUpdate(): Promise<string> {
    const { stdout, stderr } = await this.runProcess(['-U'], undefined, undefined, false);
    return `${stdout}\n${stderr}`.trim();
  }

  public async getMetadata(url: string, extraArgs: string[] = []): Promise<YtDlpMetadata> {
    const args = ['--dump-json', '--no-playlist', '--no-warnings', ...extraArgs, url];
    logger.debug({ url }, 'Fetching metadata via yt-dlp');
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

  private async fastYoutubeInnerTubeSearch(query: string, limit: number): Promise<YtDlpSearchResult[]> {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' } },
          query,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      const sections =
        data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

      const results: YtDlpSearchResult[] = [];
      for (const sec of sections) {
        for (const item of sec?.itemSectionRenderer?.contents || []) {
          const v = item?.videoRenderer;
          if (!v?.videoId) continue;
          const title = Array.isArray(v.title?.runs)
            ? v.title.runs.map((r: { text: string }) => r.text).join('')
            : v.title?.simpleText || 'YouTube Media';
          const channel =
            v.ownerText?.runs?.[0]?.text ||
            v.longBylineText?.runs?.[0]?.text ||
            v.shortBylineText?.runs?.[0]?.text ||
            undefined;
          const thumbs = v.thumbnail?.thumbnails;
          results.push({
            id: v.videoId,
            title,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            channel,
            duration: parseDurationText(v.lengthText?.simpleText),
            thumbnail: Array.isArray(thumbs) && thumbs.length > 0 ? thumbs[thumbs.length - 1]?.url : undefined,
          });
          if (results.length >= limit) return results;
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  /** Searches YouTube Music's "Songs" category (official label uploads). Returns [] on failure. */
  public async searchYouTubeMusicSongs(query: string, limit = 5, timeoutMs = 8000): Promise<YtDlpSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];
    try {
      const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://music.youtube.com',
          Referer: 'https://music.youtube.com/',
        },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240724.00.00', hl: 'en', gl: 'US' } },
          query: cleanQuery,
          params: YTM_SONGS_FILTER,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return [];
      return parseYouTubeMusicSongs(await res.json()).slice(0, Math.max(1, limit));
    } catch (err) {
      logger.debug({ err, query: cleanQuery }, 'YouTube Music song search failed');
      return [];
    }
  }

  public async search(query: string, limit = 5, extraArgs: string[] = []): Promise<YtDlpSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];
    const safeLimit = Math.max(1, Math.min(30, limit));

    const fastResults = await this.fastYoutubeInnerTubeSearch(cleanQuery, safeLimit);
    if (fastResults.length > 0) return fastResults;

    const args = ['--dump-json', '--flat-playlist', '--no-warnings', ...extraArgs, `ytsearch${safeLimit}:${cleanQuery}`];
    const { stdout } = await this.runProcess(args);
    return parseFlatEntries(stdout, (id) => `https://www.youtube.com/watch?v=${id}`).slice(0, safeLimit);
  }

  /** Lists playlist / album / set entries without resolving each one. */
  public async getPlaylistEntries(
    url: string,
    limit = 200,
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
      } catch {
        // ignore
      }
    }
    return { title, uploader, entries: parseFlatEntries(stdout).slice(0, limit) };
  }

  /** Downloads into the template's folder and returns the final media file path. */
  public async downloadMedia(options: YtDlpDownloadOptions): Promise<string> {
    const outputDir = dirname(options.outputTemplate);
    const pathFile = join(outputDir, '.grabbit-filepath.txt');
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--progress',
      '--continue',
      '--no-mtime',
      '--progress-delta',
      '0.5',
      '--progress-template',
      `download:${PROGRESS_MARK}%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
      '--print-to-file',
      'after_move:filepath',
      pathFile,
    ];
    if (options.formatSelector) args.push('-f', options.formatSelector);
    args.push('-o', options.outputTemplate);
    if (options.extraArgs?.length) args.push(...options.extraArgs);
    args.push(options.url);

    logger.debug({ url: options.url }, 'Downloading media via yt-dlp');
    await this.runProcess(
      args,
      (line) => {
        const progress = parseProgressLine(line);
        if (progress) {
          options.onProgress?.(progress);
          return;
        }
        const stage = /^\[(Merger|ExtractAudio|VideoConvertor|FixupM3u8|FixupM4a|EmbedThumbnail|Metadata|VideoRemuxer|ModifyChapters)\]/.exec(
          stripAnsi(line).trim()
        );
        if (stage) options.onStage?.(stage[1]);
      },
      options.signal
    );

    // 1. Path yt-dlp wrote after moving the final file (UTF-8, survives non-ASCII titles)
    try {
      const printed = readFileSync(pathFile, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      if (printed && existsSync(printed)) return printed;
    } catch {
      // fall through
    }

    // 2. Newest media file in the output folder
    if (existsSync(outputDir)) {
      const files = readdirSync(outputDir)
        .filter((f) => !f.startsWith('.') && !MEDIA_EXTENSIONS_TO_SKIP.some((ext) => f.toLowerCase().endsWith(ext)))
        .map((f) => join(outputDir, f))
        .filter((p) => {
          try {
            return statSync(p).isFile();
          } catch {
            return false;
          }
        });
      if (files.length > 0) {
        files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
        return files[0];
      }
    }
    throw new DownloadError('yt-dlp finished but the downloaded file could not be located');
  }

  private runProcess(
    args: string[],
    onLine?: (line: string) => void,
    signal?: AbortSignal,
    withBaseArgs = true
  ): Promise<{ stdout: string; stderr: string }> {
    const binary = getMediaConfig().ytdlpPath;
    const fullArgs = withBaseArgs ? [...this.baseArgs(), ...args] : args;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new JobCancelledError());
        return;
      }

      const child = spawn(binary, fullArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: this.env(),
      });
      let stdout = '';
      let stderr = '';
      const buffers = { out: '', err: '' };
      let isAborted = false;

      const onAbort = () => {
        isAborted = true;
        killTree(child.pid);
        reject(new JobCancelledError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const feed = (key: 'out' | 'err', chunk: string) => {
        if (!onLine) return;
        buffers[key] += chunk;
        const lines = buffers[key].split(/\r?\n|\r/);
        buffers[key] = lines.pop() || '';
        for (const line of lines) onLine(line);
      };

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        feed('out', chunk);
      });
      child.stderr.on('data', (chunk: string) => {
        // Keep only the tail: progress spam can be long
        stderr = (stderr + chunk).slice(-20000);
        feed('err', chunk);
      });

      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (isAborted) return;
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(classifyYtDlpError(stderr, code));
      });

      child.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        if (isAborted) return;
        logger.error({ err, binary }, 'yt-dlp process spawn error');
        reject(
          new DownloadError(
            (err as NodeJS.ErrnoException).code === 'ENOENT'
              ? 'yt-dlp was not found. Open Settings → Tools to install it.'
              : `Failed to run yt-dlp: ${err.message}`
          )
        );
      });
    });
  }
}

/** Last meaningful ERROR line from yt-dlp's stderr. */
function lastErrorLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => stripAnsi(l).trim())
    .filter(Boolean);
  const err = [...lines].reverse().find((l) => l.startsWith('ERROR:'));
  return (err || lines[lines.length - 1] || 'unknown error').replace(/^ERROR:\s*/, '');
}

export function classifyYtDlpError(stderr: string, code: number | null): Error {
  const message = lastErrorLine(stderr);
  const lower = stderr.toLowerCase();
  if (lower.includes('drm protected')) {
    return new UnauthorizedContentError(`DRM-protected content: ${message}`, 'DRM_PROTECTED');
  }
  if (lower.includes('not a bot') || lower.includes('use --cookies') || lower.includes('cookies-from-browser')) {
    return new UnauthorizedContentError(message, 'COOKIES_REQUIRED');
  }
  if (lower.includes('unsupported url')) {
    return new MediaUnavailableError(`Unsupported URL: ${message}`);
  }
  if (
    lower.includes('private video') ||
    lower.includes('sign in') ||
    lower.includes('login required') ||
    lower.includes('requires authentication') ||
    lower.includes('members-only')
  ) {
    return new UnauthorizedContentError(message);
  }
  if (
    lower.includes('video unavailable') ||
    lower.includes('not available') ||
    lower.includes('does not exist') ||
    lower.includes('requested format is not available') ||
    lower.includes('http error 404')
  ) {
    return new MediaUnavailableError(message);
  }
  logger.warn({ code, message }, 'yt-dlp execution error');
  return new DownloadError(message);
}

/** Kills a process and its children (yt-dlp spawns ffmpeg). */
export function killTree(pid?: number): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
      'error',
      () => undefined
    );
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}
