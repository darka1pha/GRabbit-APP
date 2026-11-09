import { spawn } from 'node:child_process';
import { getMediaConfig } from './config';
import { JobCancelledError, ProcessingError } from './errors';
import { killTree } from './ytdlp-runner';
import { logger } from '../logger';

export type AudioContainer = 'mp3' | 'm4a';

export class FFmpegRunner {
  public async getVersion(): Promise<string | null> {
    try {
      const out = await this.run(['-version'], undefined, true);
      return /ffmpeg version (\S+)/.exec(out)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /** Short mono MP3 clip used for music fingerprinting. */
  public async extractAudioSampleForRecognition(
    inputPath: string,
    outputPath: string,
    options?: { startSeconds?: number; durationSeconds?: number },
    signal?: AbortSignal
  ): Promise<string> {
    const args = [
      '-y',
      '-ss',
      String(options?.startSeconds ?? 0),
      '-t',
      String(options?.durationSeconds ?? 15),
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '128k',
      outputPath,
    ];
    await this.run(args, signal);
    return outputPath;
  }

  /**
   * Rewrites an MP3's (ID3) or M4A's (iTunes atoms) tags and cover without re-encoding.
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
      args.push('-movflags', '+faststart', '-f', 'ipod', outputPath);
    } else {
      args.push('-id3v2_version', '3', '-write_id3v1', '1', '-f', 'mp3', outputPath);
    }
    logger.debug({ inputPath, outputPath, hasCover: Boolean(coverPath) }, 'Writing audio tags');
    await this.run(args, signal);
    return outputPath;
  }

  private run(args: string[], signal?: AbortSignal, captureStdout = false): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new JobCancelledError());
        return;
      }
      const child = spawn(getMediaConfig().ffmpegPath, ['-hide_banner', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        killTree(child.pid);
        reject(new JobCancelledError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (d: Buffer) => {
        if (captureStdout) stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-8000);
      });
      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (aborted) return;
        if (code === 0) resolve(stdout);
        else reject(new ProcessingError(`FFmpeg failed with exit code ${code}: ${stderr.trim().split('\n').pop()}`));
      });
      child.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        if (!aborted) reject(new ProcessingError(`FFmpeg could not start: ${err.message}`));
      });
    });
  }
}
