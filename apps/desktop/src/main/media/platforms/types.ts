import type { MediaFormat, PlatformId, PlatformMetadata } from '../../../shared/types';
import type { DownloadProgress } from '../ytdlp-runner';

export interface DownloadRequest {
  url: string;
  platform: PlatformId;
  mediaId: string;
  format: MediaFormat;
  qualityId: string;
  /** Working folder for this job (kept between pause / resume so yt-dlp can continue .part files). */
  outputPath: string;
  title?: string;
  onProgress?: (progress: DownloadProgress) => void;
  onStage?: (stage: string) => void;
  signal?: AbortSignal;
}

export interface DownloadResult {
  filePath: string;
  /** Suggested final name (already sanitized). */
  fileName: string;
  mimeType: string;
  format: MediaFormat;
  title: string;
  author?: string;
}

export interface IPlatformAdapter {
  readonly platformId: PlatformId;
  fetchMetadata(url: string): Promise<PlatformMetadata>;
  download(request: DownloadRequest): Promise<DownloadResult>;
}
