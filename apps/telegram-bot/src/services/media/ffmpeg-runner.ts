import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../../config/env.js';
import { JobCancelledError, ProcessingError } from '../../core/errors/domain-errors.js';
import { logger } from '../../observability/logger.js';

export type AudioContainer = 'mp3' | 'm4a';

// Telegram ignores thumbnails larger than 320x320, so scale down (never up), keeping aspect ratio
const TELEGRAM_THUMBNAIL_SCALE = "scale='min(320,iw)':'min(320,ih)':force_original_aspect_ratio=decrease";

export class FFmpegRunner {
  private binaryPath: string;

  constructor(binaryPath?: string) {
    const configured = binaryPath || getConfig().FFMPEG_PATH;
    if (configured === 'ffmpeg') {
      const localBin = join(process.cwd(), 'bin', 'ffmpeg.exe');
      if (existsSync(localBin)) {
        this.binaryPath = localBin;
        return;
      }
    }
    this.binaryPath = configured;
  }

  public async remuxToMp4(
    inputPath: string,
    outputPath: string,
    signal?: AbortSignal
  ): Promise<string> {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      outputPath,
    ];

    logger.debug({ args, inputPath, outputPath }, 'Executing FFmpeg remux');
    await this.runProcess(args, signal);
    return outputPath;
  }

  public async extractAudio(
    inputPath: string,
    outputPath: string,
    format: 'mp3' | 'm4a' = 'mp3',
    bitrate = '192k',
    signal?: AbortSignal
  ): Promise<string> {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-codec:a',
      format === 'mp3' ? 'libmp3lame' : 'aac',
      '-b:a',
      bitrate,
      outputPath,
    ];

    logger.debug({ args, inputPath, outputPath }, 'Executing FFmpeg audio extraction');
    await this.runProcess(args, signal);
    return outputPath;
  }

  /**
   * Extracts a short normalized audio clip optimized for music fingerprinting/recognition.
   * Grabs up to `durationSeconds` (default 15s) starting from `startSeconds` (default 0).
   */
  public async extractAudioSampleForRecognition(
    inputPath: string,
    outputPath: string,
    options?: { startSeconds?: number; durationSeconds?: number },
    signal?: AbortSignal
  ): Promise<string> {
    const start = options?.startSeconds ?? 0;
    const duration = options?.durationSeconds ?? 15;
    const args = [
      '-y',
      '-ss',
      start.toString(),
      '-t',
      duration.toString(),
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1', // mono
      '-ar',
      '44100', // 44.1kHz
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '128k',
      outputPath,
    ];

    logger.debug({ args, inputPath, outputPath }, 'Executing FFmpeg audio sampling for recognition');
    await this.runProcess(args, signal);
    return outputPath;
  }

  public async extractThumbnail(
    inputPath: string,
    outputPath: string,
    timeSeconds = 1,
    signal?: AbortSignal
  ): Promise<string> {
    const args = [
      '-y',
      '-ss',
      timeSeconds.toString(),
      '-i',
      inputPath,
      '-vframes',
      '1',
      '-vf',
      TELEGRAM_THUMBNAIL_SCALE,
      '-q:v',
      '2',
      outputPath,
    ];

    await this.runProcess(args, signal);
    return outputPath;
  }

  /**
   * Extracts the cover art embedded in an audio file (e.g. by yt-dlp --embed-thumbnail)
   * as a Telegram-sized JPEG, so sendAudio can show it as the track's thumbnail.
   */
  public async extractCoverArt(
    inputPath: string,
    outputPath: string,
    signal?: AbortSignal
  ): Promise<string> {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-an',
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-vf',
      TELEGRAM_THUMBNAIL_SCALE,
      '-q:v',
      '3',
      outputPath,
    ];

    await this.runProcess(args, signal);
    return outputPath;
  }

  /**
   * Rewrites an MP3's (ID3) or M4A's (iTunes atoms) tags and cover without re-encoding: drops
   * every existing tag and picture, writes `tags`, and embeds `coverPath` (JPEG/PNG) as the cover.
   */
  public async writeAudioTags(
    inputPath: string,
    outputPath: string,
    container: AudioContainer,
    tags: Record<string, string | undefined>,
    coverPath?: string,
    signal?: AbortSignal
  ): Promise<string> {
    const args = ['-y', '-i', inputPath];
    if (coverPath) args.push('-i', coverPath);
    args.push('-map', '0:a');
    if (coverPath) {
      args.push(
        '-map',
        '1:v',
        '-c:v',
        'copy',
        '-disposition:v',
        'attached_pic',
        '-metadata:s:v',
        'title=Album cover',
        '-metadata:s:v',
        'comment=Cover (front)'
      );
    }
    args.push('-c:a', 'copy', '-map_metadata', '-1', '-map_chapters', '-1');
    for (const [key, value] of Object.entries(tags)) {
      if (value) args.push('-metadata', `${key}=${value}`);
    }
    if (container === 'm4a') {
      // 'ipod' is FFmpeg's .m4a muxer; faststart lets Telegram start playback before the full download
      args.push('-movflags', '+faststart', '-f', 'ipod', outputPath);
    } else {
      args.push('-id3v2_version', '3', '-write_id3v1', '1', '-f', 'mp3', outputPath);
    }

    logger.debug({ inputPath, outputPath, hasCover: Boolean(coverPath) }, 'Writing audio tags');
    await this.runProcess(args, signal);
    return outputPath;
  }

  private async runProcess(args: string[], signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new JobCancelledError('aborted'));
        return;
      }

      const child = spawn(this.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let isAborted = false;

      const onAbort = () => {
        isAborted = true;
        try {
          child.kill('SIGTERM');
        } catch {}
        reject(new JobCancelledError('aborted'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (isAborted) return;

        if (code === 0) {
          resolve();
        } else {
          logger.error({ code, stderr }, 'FFmpeg execution error');
          reject(new ProcessingError(`FFmpeg failed with exit code ${code}: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        if (isAborted) return;
        reject(new ProcessingError(`FFmpeg execution error: ${err.message}`));
      });
    });
  }
}
