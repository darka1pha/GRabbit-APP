import { spawn } from 'node:child_process';
import { getMediaConfig } from './config';
import { ProcessingError } from './errors';

export interface MediaProbeInfo {
  formatName: string;
  durationSeconds: number;
  sizeBytes: number;
  hasAudio: boolean;
  hasVideo: boolean;
  width?: number;
  height?: number;
}

export class FFprobeRunner {
  public async getVersion(): Promise<string | null> {
    try {
      const out = await this.run(['-version']);
      return /ffprobe version (\S+)/.exec(out)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  public async probe(filePath: string): Promise<MediaProbeInfo> {
    const out = await this.run(['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
    try {
      const data = JSON.parse(out);
      const format = data.format || {};
      const streams: Array<{ codec_type?: string; width?: number; height?: number }> = data.streams || [];
      const video = streams.find((s) => s.codec_type === 'video');
      return {
        formatName: format.format_name || 'unknown',
        durationSeconds: parseFloat(format.duration || '0'),
        sizeBytes: parseInt(format.size || '0', 10),
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
        hasVideo: Boolean(video),
        width: video?.width,
        height: video?.height,
      };
    } catch {
      throw new ProcessingError('Failed to parse FFprobe output');
    }
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(getMediaConfig().ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.on('close', (code) =>
        code === 0 ? resolve(stdout) : reject(new ProcessingError(`FFprobe exited with code ${code}`))
      );
      child.on('error', (err) => reject(new ProcessingError(`FFprobe could not start: ${err.message}`)));
    });
  }
}
