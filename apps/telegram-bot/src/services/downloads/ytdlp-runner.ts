import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  classifyYtDlpStderr,
  metadataArgs,
  parseFlatEntries,
  parseMetadataOutput,
  parsePlaylistHeader,
  playlistArgs,
  searchArgs,
  searchYouTubeInnerTube,
  searchYouTubeMusicSongs,
  stripAnsi,
  type YtDlpMetadata,
  type YtDlpSearchResult,
} from '@grabbit/core/media/ytdlp';
import { getConfig } from '../../config/env.js';
import {
  DownloadError,
  JobCancelledError,
  MediaUnavailableError,
  UnauthorizedContentError,
} from '../../core/errors/domain-errors.js';
import { logger } from '../../observability/logger.js';
import { DownloadProgress } from '../../core/types/platform.js';

// Parsing, arguments and InnerTube search are shared with the desktop app (@grabbit/core)
export type { YtDlpFormat, YtDlpMetadata, YtDlpSearchResult } from '@grabbit/core/media/ytdlp';
export { parseYouTubeMusicSongs } from '@grabbit/core/media/ytdlp';

export interface YtDlpDownloadOptions {
  url: string;
  formatSelector?: string;
  outputTemplate: string;
  extraArgs?: string[];
  onProgress?: (progress: DownloadProgress) => Promise<void> | void;
  signal?: AbortSignal;
}

/** Maps yt-dlp's stderr to the bot's localized error classes. */
export function classifyYtDlpError(stderr: string, code: number | null, args: string[] = []): Error {
  const detail = stderr.trim();
  switch (classifyYtDlpStderr(stderr)) {
    case 'drm':
      return new UnauthorizedContentError(`DRM-protected content: ${detail}`, 'error-drm-protected');
    case 'cookies-required':
      return new UnauthorizedContentError(`Bot verification / cookies required: ${detail}`, 'error-bot-verification');
    case 'auth-required':
      return new UnauthorizedContentError(`Content restricted or requires authorization: ${detail}`);
    case 'unsupported-url':
    case 'unavailable':
      return new MediaUnavailableError(`Media unavailable: ${detail}`);
    default:
      logger.error({ code, stderr, args }, 'yt-dlp execution error');
      return new DownloadError(`yt-dlp failed with exit code ${code}: ${detail}`);
  }
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
    const args = metadataArgs(url, extraArgs);
    logger.debug({ url, args }, 'Fetching metadata via yt-dlp');
    const { stdout } = await this.runProcess(args);
    try {
      return parseMetadataOutput(stdout);
    } catch {
      throw new DownloadError('Failed to parse metadata JSON from yt-dlp');
    }
  }

  /**
   * Searches YouTube Music's "Songs" category: official audio uploads (album art tracks)
   * distributed by labels from the master recording, rather than fan re-uploads.
   * Returns [] on any failure; `channel` holds the artist names.
   */
  public searchYouTubeMusicSongs(query: string, limit = 5, timeoutMs = 8000): Promise<YtDlpSearchResult[]> {
    return searchYouTubeMusicSongs(query, limit, timeoutMs, (err) =>
      logger.debug({ err, query }, 'YouTube Music song search failed')
    );
  }

  public async search(query: string, limit = 5, extraArgs: string[] = []): Promise<YtDlpSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const safeLimit = Math.max(1, Math.min(20, limit));

    // Fast path (~250ms) for interactive & inline search in production/development
    if (process.env.NODE_ENV !== 'test') {
      const fastResults = await searchYouTubeInnerTube(cleanQuery, safeLimit, 3500);
      if (fastResults.length > 0) return fastResults;
    }

    logger.debug({ query: cleanQuery, limit: safeLimit }, 'Searching YouTube via yt-dlp');
    const { stdout } = await this.runProcess(searchArgs(cleanQuery, safeLimit, extraArgs));
    return parseFlatEntries(stdout, (id) => `https://www.youtube.com/watch?v=${id}`).slice(0, safeLimit);
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
    logger.debug({ url, limit }, 'Listing playlist entries via yt-dlp');
    const { stdout } = await this.runProcess(playlistArgs(url, limit, extraArgs));
    return { ...parsePlaylistHeader(stdout), entries: parseFlatEntries(stdout).slice(0, limit) };
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

    // Everything after '--' is a URL, never an option
    args.push('--', options.url);

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
        if (code === 0) resolve({ stdout, stderr });
        else reject(classifyYtDlpError(stderr, code, args));
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
