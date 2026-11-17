import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  classifyYtDlpStderr,
  lastErrorLine,
  metadataArgs,
  parseFlatEntries,
  parseMetadataOutput,
  parsePlaylistHeader,
  parseProgressLine,
  playlistArgs,
  PROGRESS_MARK,
  searchArgs,
  searchYouTubeInnerTube,
  searchYouTubeMusicSongs,
  stripAnsi,
  type YtDlpByteProgress,
  type YtDlpMetadata,
  type YtDlpSearchResult,
} from '@grabbit/core/media/ytdlp';
import { getMediaConfig } from './config';
import {
  DownloadError,
  JobCancelledError,
  MediaUnavailableError,
  UnauthorizedContentError,
} from './errors';
import { logger } from '../logger';

// Parsing, arguments and InnerTube search are shared with the Telegram bot (@grabbit/core)
export type { YtDlpFormat, YtDlpMetadata, YtDlpSearchResult } from '@grabbit/core/media/ytdlp';
export { parseDurationText, parseProgressLine, parseYouTubeMusicSongs } from '@grabbit/core/media/ytdlp';
export type DownloadProgress = YtDlpByteProgress;

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

const MEDIA_EXTENSIONS_TO_SKIP = ['.part', '.ytdl', '.jpg', '.jpeg', '.webp', '.png', '.temp', '.txt'];

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
    logger.debug({ url }, 'Fetching metadata via yt-dlp');
    const { stdout } = await this.runProcess(metadataArgs(url, extraArgs));
    try {
      return parseMetadataOutput(stdout);
    } catch {
      throw new DownloadError('Failed to parse metadata JSON from yt-dlp');
    }
  }

  /** Searches YouTube Music's "Songs" category (official label uploads). Returns [] on failure. */
  public searchYouTubeMusicSongs(query: string, limit = 5, timeoutMs = 8000): Promise<YtDlpSearchResult[]> {
    return searchYouTubeMusicSongs(query, limit, timeoutMs, (err) =>
      logger.debug({ err, query }, 'YouTube Music song search failed')
    );
  }

  public async search(query: string, limit = 5, extraArgs: string[] = []): Promise<YtDlpSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];
    const safeLimit = Math.max(1, Math.min(30, limit));

    const fastResults = await searchYouTubeInnerTube(cleanQuery, safeLimit);
    if (fastResults.length > 0) return fastResults;

    const { stdout } = await this.runProcess(searchArgs(cleanQuery, safeLimit, extraArgs));
    return parseFlatEntries(stdout, (id) => `https://www.youtube.com/watch?v=${id}`).slice(0, safeLimit);
  }

  /** Lists playlist / album / set entries without resolving each one. */
  public async getPlaylistEntries(
    url: string,
    limit = 200,
    extraArgs: string[] = []
  ): Promise<{ title?: string; uploader?: string; entries: YtDlpSearchResult[] }> {
    const { stdout } = await this.runProcess(playlistArgs(url, limit, extraArgs));
    return { ...parsePlaylistHeader(stdout), entries: parseFlatEntries(stdout).slice(0, limit) };
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
    // Everything after '--' is a URL, never an option
    args.push('--', options.url);

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

export function classifyYtDlpError(stderr: string, code: number | null): Error {
  const message = lastErrorLine(stderr);
  switch (classifyYtDlpStderr(stderr)) {
    case 'drm':
      return new UnauthorizedContentError(`DRM-protected content: ${message}`, 'DRM_PROTECTED');
    case 'cookies-required':
      return new UnauthorizedContentError(message, 'COOKIES_REQUIRED');
    case 'unsupported-url':
      return new MediaUnavailableError(`Unsupported URL: ${message}`);
    case 'auth-required':
      return new UnauthorizedContentError(message);
    case 'unavailable':
      return new MediaUnavailableError(message);
    default:
      logger.warn({ code, message }, 'yt-dlp execution error');
      return new DownloadError(message);
  }
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
