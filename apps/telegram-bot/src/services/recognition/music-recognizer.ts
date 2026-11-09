import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Shazam } from 'node-shazam';
import { FFmpegRunner } from '../media/ffmpeg-runner.js';
import { getConfig } from '../../config/env.js';
import { logger } from '../../observability/logger.js';

export interface RecognizedTrack {
  title: string;
  artist: string;
  album?: string;
  releaseYear?: string;
  genre?: string;
  label?: string;
  coverArtUrl?: string;
  shazamUrl?: string;
  appleMusicUrl?: string;
  spotifyUri?: string;
  raw?: any;
}

export class MusicRecognizer {
  private shazam: Shazam;
  private ffmpeg: FFmpegRunner;

  constructor(shazamInstance?: Shazam, ffmpegRunner?: FFmpegRunner) {
    this.shazam = shazamInstance || new Shazam();
    this.ffmpeg = ffmpegRunner || new FFmpegRunner();
  }

  /**
   * Identifies music from an audio or video file.
   * If the input is not a short mono MP3, extracts an optimal 15-second audio sample via FFmpeg first.
   */
  public async identifyMedia(
    inputPath: string,
    options?: {
      sampleStartSeconds?: number;
      sampleDurationSeconds?: number;
      locale?: string;
      signal?: AbortSignal;
    }
  ): Promise<RecognizedTrack | null> {
    if (!existsSync(inputPath)) {
      logger.warn({ inputPath }, 'Media file does not exist for recognition');
      return null;
    }

    const config = getConfig();
    const tempDir = config.TEMP_DIR || './temp';
    const sampleId = randomBytes(4).toString('hex');
    const samplePath = join(tempDir, `shazam_sample_${sampleId}.mp3`);

    try {
      // 1. Extract a clean, standardized 15-second mono sample for fingerprinting
      const startSec = options?.sampleStartSeconds ?? 0;
      const durationSec = options?.sampleDurationSeconds ?? 15;

      logger.debug(
        { inputPath, samplePath, startSec, durationSec },
        'Extracting audio snippet for Shazam recognition'
      );

      await this.ffmpeg.extractAudioSampleForRecognition(
        inputPath,
        samplePath,
        { startSeconds: startSec, durationSeconds: durationSec },
        options?.signal
      );

      // 2. Query Shazam acoustic fingerprint database
      const locale = options?.locale || 'en-US';
      const result = await this.shazam.recognise(samplePath, locale);

      if (!result) {
        logger.info({ inputPath }, 'No music match recognized by Shazam');
        return null;
      }

      const rawAny = result as any;
      const track = rawAny.track || rawAny;
      if (!track || !track.title) {
        logger.info({ inputPath }, 'No music track details recognized by Shazam');
        return null;
      }

      const songSection = track.sections?.find((s: any) => s.type === 'SONG');
      const album =
        track.album || songSection?.metadata?.find((m: any) => m.title === 'Album')?.text;
      const releaseYear =
        track.year || songSection?.metadata?.find((m: any) => m.title === 'Released')?.text;
      const label = songSection?.metadata?.find((m: any) => m.title === 'Label')?.text;

      // Extract streaming links from hub providers
      let appleMusicUrl: string | undefined;
      let spotifyUri: string | undefined;

      if (track.hub?.providers && Array.isArray(track.hub.providers)) {
        for (const provider of track.hub.providers) {
          if (provider.type === 'APPLEMUSIC' && provider.actions?.[0]?.uri) {
            appleMusicUrl = provider.actions[0].uri;
          } else if (provider.type === 'SPOTIFY' && provider.actions?.[0]?.uri) {
            spotifyUri = provider.actions[0].uri;
          }
        }
      }

      const recognized: RecognizedTrack = {
        title: track.title,
        artist: track.subtitle || track.artist || 'Unknown Artist',
        album,
        releaseYear,
        genre: track.genres?.primary,
        label,
        coverArtUrl: track.images?.coverarthq || track.images?.coverart,
        shazamUrl: track.url,
        appleMusicUrl,
        spotifyUri,
        raw: result,
      };

      logger.info(
        { title: recognized.title, artist: recognized.artist, album: recognized.album },
        'Song successfully recognized'
      );

      return recognized;
    } catch (err) {
      logger.error({ err, inputPath }, 'Error occurred during music recognition');
      return null;
    } finally {
      // Clean up the temporary sample file
      try {
        if (existsSync(samplePath)) {
          unlinkSync(samplePath);
        }
      } catch {}
    }
  }
}
