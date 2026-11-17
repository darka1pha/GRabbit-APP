import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseShazamTrack as coreParseShazamTrack } from '@grabbit/core';
import type { RecognizedTrack } from '../../shared/types';
import { getMediaConfig } from './config';
import { FFmpegRunner } from './ffmpeg-runner';
import { FFprobeRunner } from './ffprobe-runner';
import { YtDlpRunner } from './ytdlp-runner';
import { recognizeAudioFile, ShazamResponse } from './shazam-client';
import { cookieArgs } from './platforms/youtube';
import { MediaUnavailableError } from './errors';
import { logger } from '../logger';

const SAMPLE_SECONDS = 15;

export function parseShazamTrack(result: ShazamResponse): RecognizedTrack | null {
  return coreParseShazamTrack(result);
}

export class MusicRecognizer {
  constructor(
    private ffmpeg = new FFmpegRunner(),
    private ffprobe = new FFprobeRunner(),
    private ytdlp = new YtDlpRunner()
  ) {}

  private workDir(): string {
    const dir = join(getMediaConfig().tempDir, `recognize-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Identifies the song in a local audio or video file. Tries a few positions in longer files. */
  public async identifyFile(inputPath: string, signal?: AbortSignal): Promise<RecognizedTrack | null> {
    if (!existsSync(inputPath)) throw new MediaUnavailableError('File not found');
    const dir = this.workDir();
    try {
      let duration = 0;
      try {
        duration = (await this.ffprobe.probe(inputPath)).durationSeconds || 0;
      } catch {
        // Unknown duration: sample from the start
      }

      const offsets =
        duration > SAMPLE_SECONDS * 3
          ? [duration * 0.3, Math.max(0, duration * 0.6 - SAMPLE_SECONDS), 0]
          : [0];

      for (const [i, offset] of offsets.entries()) {
        if (signal?.aborted) return null;
        const sample = join(dir, `sample-${i}.mp3`);
        await this.ffmpeg.extractAudioSampleForRecognition(
          inputPath,
          sample,
          { startSeconds: Math.floor(offset), durationSeconds: SAMPLE_SECONDS },
          signal
        );
        const result = await recognizeAudioFile(sample, 'en-US', signal);
        const track = result ? parseShazamTrack(result) : null;
        if (track) {
          logger.info({ title: track.title, artist: track.artist }, 'Song recognized');
          return track;
        }
      }
      return null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Downloads the first part of a link's audio (Instagram reel, TikTok, YouTube...) and identifies it. */
  public async identifyUrl(url: string, signal?: AbortSignal): Promise<RecognizedTrack | null> {
    const dir = this.workDir();
    try {
      const file = await this.ytdlp.downloadMedia({
        url,
        formatSelector: 'worstaudio/bestaudio/worst/best',
        outputTemplate: join(dir, 'clip.%(ext)s'),
        extraArgs: ['--download-sections', '*0-90', ...cookieArgs()],
        signal,
      });
      return await this.identifyFile(file, signal);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
