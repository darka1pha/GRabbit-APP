import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../../config/env.js';
import { ProcessingError } from '../../core/errors/domain-errors.js';
import { logger } from '../../observability/logger.js';

export interface MediaProbeInfo {
  formatName: string;
  durationSeconds: number;
  sizeBytes: number;
  bitrate?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  width?: number;
  height?: number;
  audioCodec?: string;
  videoCodec?: string;
  /** Embedded tags (ID3 / container metadata), when present. */
  tagTitle?: string;
  tagArtist?: string;
}

export class FFprobeRunner {
  private binaryPath: string;

  constructor(binaryPath?: string) {
    const configured = binaryPath || getConfig().FFPROBE_PATH;
    if (configured === 'ffprobe') {
      const localBin = join(process.cwd(), 'bin', 'ffprobe.exe');
      if (existsSync(localBin)) {
        this.binaryPath = localBin;
        return;
      }
    }
    this.binaryPath = configured;
  }

  public async probe(filePath: string): Promise<MediaProbeInfo> {
    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          logger.error({ code, stderr, filePath }, 'FFprobe failed to inspect file');
          reject(new ProcessingError(`FFprobe failed to inspect media: ${stderr}`));
          return;
        }

        try {
          const data = JSON.parse(stdout);
          const format = data.format || {};
          const streams = data.streams || [];

          const audioStream = streams.find((s: { codec_type?: string }) => s.codec_type === 'audio');
          const videoStream = streams.find((s: { codec_type?: string }) => s.codec_type === 'video');
          // Tag keys vary in case between containers (title / TITLE, artist / ARTIST)
          const tags: Record<string, string> = {};
          for (const [k, v] of Object.entries(format.tags || {})) {
            tags[k.toLowerCase()] = String(v);
          }

          resolve({
            formatName: format.format_name || 'unknown',
            durationSeconds: parseFloat(format.duration || '0'),
            sizeBytes: parseInt(format.size || '0', 10),
            bitrate: parseInt(format.bit_rate || '0', 10),
            hasAudio: Boolean(audioStream),
            hasVideo: Boolean(videoStream),
            width: videoStream ? videoStream.width : undefined,
            height: videoStream ? videoStream.height : undefined,
            audioCodec: audioStream ? audioStream.codec_name : undefined,
            videoCodec: videoStream ? videoStream.codec_name : undefined,
            tagTitle: tags.title || undefined,
            tagArtist: tags.artist || tags.album_artist || undefined,
          });
        } catch (err) {
          reject(new ProcessingError('Failed to parse FFprobe JSON output'));
        }
      });

      child.on('error', (err) => {
        reject(new ProcessingError(`FFprobe spawn failed: ${err.message}`));
      });
    });
  }
}
