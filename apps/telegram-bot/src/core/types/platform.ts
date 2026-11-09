import { PlatformId, MediaFormat } from '../../config/constants.js';

export interface MediaOption {
  format: MediaFormat;
  qualityId: string;
  label: string;
  extension: string;
  estimatedSizeBytes?: number;
  /** Audio kept in the source codec (no re-encode); labelled as the best-quality choice. */
  isOriginalQuality?: boolean;
}

export interface MediaItem {
  id: string;
  title: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  platform: PlatformId;
  url: string;
  description?: string;
  isDownloadable: boolean;
  unavailableReason?: string;
  availableOptions: MediaOption[];
}

export interface PlatformMetadata {
  platform: PlatformId;
  url: string;
  title: string;
  artistOrAuthor?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  items: MediaItem[];
  /** True for albums/playlists/sets: items are the tracks, shown in a track picker. */
  isCollection?: boolean;
  isAuthorized: boolean;
  raw?: unknown;
}

export interface DownloadProgress {
  percent: number;
  speed?: string;
  eta?: string;
}

export interface DownloadRequest {
  url: string;
  platform: PlatformId;
  mediaId: string;
  format: MediaFormat;
  qualityId: string;
  outputPath: string;
  onProgress?: (progress: DownloadProgress) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface DownloadResult {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  format: MediaFormat;
  durationSeconds?: number;
  thumbnailPath?: string;
  title: string;
  author?: string;
}

export interface IPlatformAdapter {
  readonly platformId: PlatformId;
  matches(url: string): boolean;
  normalizeUrl(url: string): string;
  fetchMetadata(url: string): Promise<PlatformMetadata>;
  download?(request: DownloadRequest): Promise<DownloadResult>;
}
