import { PlatformMetadata, SongRecognitionResult } from '@grabbit/types';

export interface MetadataFetchOptions {
  url: string;
  signal?: AbortSignal;
}

export interface RecognitionOptions {
  audioBuffer: ArrayBuffer;
  signal?: AbortSignal;
}

/**
 * Interface defining the API service contract for GRabbit.
 * Can be implemented by local bridges (Desktop Electron IPC)
 * or remote REST / WebSocket backends (Mobile / Cloud).
 */
export interface IGrabbitApiService {
  resolveMetadata(options: MetadataFetchOptions): Promise<PlatformMetadata>;
  recognizeSong(options: RecognitionOptions): Promise<SongRecognitionResult | null>;
  searchYouTube(query: string, signal?: AbortSignal): Promise<PlatformMetadata>;
  checkForUpdates(): Promise<{ hasUpdate: boolean; latestVersion?: string; releaseNotes?: string }>;
}

export class GrabbitApiClient implements IGrabbitApiService {
  constructor(private baseUrl?: string) {}

  async resolveMetadata(options: MetadataFetchOptions): Promise<PlatformMetadata> {
    if (!this.baseUrl) {
      throw new Error('API client base URL is not configured.');
    }
    const res = await fetch(`${this.baseUrl}/api/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: options.url }),
      signal: options.signal,
    });
    if (!res.ok) {
      throw new Error(`Failed to resolve metadata: ${res.statusText}`);
    }
    return res.json();
  }

  async recognizeSong(options: RecognitionOptions): Promise<SongRecognitionResult | null> {
    if (!this.baseUrl) {
      throw new Error('API client base URL is not configured.');
    }
    const res = await fetch(`${this.baseUrl}/api/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: options.audioBuffer,
      signal: options.signal,
    });
    if (!res.ok) return null;
    return res.json();
  }

  async searchYouTube(query: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    if (!this.baseUrl) {
      throw new Error('API client base URL is not configured.');
    }
    const res = await fetch(`${this.baseUrl}/api/search?q=${encodeURIComponent(query)}`, {
      signal,
    });
    if (!res.ok) {
      throw new Error(`Search failed: ${res.statusText}`);
    }
    return res.json();
  }

  async checkForUpdates(): Promise<{ hasUpdate: boolean; latestVersion?: string; releaseNotes?: string }> {
    return { hasUpdate: false };
  }
}

