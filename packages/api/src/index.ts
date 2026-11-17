import type {
  DownloadItem,
  DownloadQueue,
  PlatformMetadata,
  RecognizedTrack,
  RpcAddBatchRequest,
  RpcAddDownloadRequest,
  RpcAddDownloadResponse,
  RpcPingResponse,
  RpcStatusResponse,
  SongRecognitionResult,
} from '@grabbit/types';

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

export interface DesktopRpcClientConfig {
  host: string;
  port: number;
  token?: string;
}

export interface RpcCallResult<T> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
}

/**
 * Typed HTTP client for the Desktop RPC Bridge (used by Mobile and Extension).
 */
export class DesktopRpcClient {
  constructor(private readonly config: DesktopRpcClientConfig) {}

  public get baseUrl(): string {
    return `http://${this.config.host.trim()}:${this.config.port || 31542}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...(extra ?? {}) };
    const token = this.config.token?.trim();
    if (token) h['X-GRabbit-Token'] = token;
    return h;
  }

  public async request<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<RpcCallResult<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), init.timeoutMs ?? 4000);
    if (init.signal) {
      if (init.signal.aborted) {
        clearTimeout(timeoutId);
        return { ok: false, error: 'Aborted' };
      }
      init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: this.headers(),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
      if (!res.ok) {
        return { ok: false, status: res.status, error: data?.error || `HTTP ${res.status}` };
      }
      return { ok: true, status: res.status, data: data ?? ({} as T) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Request failed' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public ping(timeoutMs = 2000): Promise<RpcCallResult<RpcPingResponse>> {
    return this.request<RpcPingResponse>('/ping', { timeoutMs });
  }

  public status(timeoutMs = 2500): Promise<RpcCallResult<RpcStatusResponse>> {
    return this.request<RpcStatusResponse>('/status', { timeoutMs });
  }

  public listDownloads(timeoutMs = 2500): Promise<RpcCallResult<{ success: boolean; items: DownloadItem[] }>> {
    return this.request('/downloads/list', { timeoutMs });
  }

  public addDownload(payload: RpcAddDownloadRequest, timeoutMs = 4000): Promise<RpcCallResult<RpcAddDownloadResponse>> {
    return this.request('/downloads/add', { method: 'POST', body: payload, timeoutMs });
  }

  public addBatch(payload: RpcAddBatchRequest, timeoutMs = 6000): Promise<RpcCallResult<RpcAddDownloadResponse & { count?: number }>> {
    return this.request('/downloads/batch', { method: 'POST', body: payload, timeoutMs });
  }

  public pauseDownloads(ids: string[]): Promise<RpcCallResult<{ success: boolean }>> {
    return this.request('/downloads/pause', { method: 'POST', body: { ids } });
  }

  public resumeDownloads(ids: string[]): Promise<RpcCallResult<{ success: boolean }>> {
    return this.request('/downloads/resume', { method: 'POST', body: { ids } });
  }

  public removeDownloads(ids: string[], deleteFiles = false): Promise<RpcCallResult<{ success: boolean }>> {
    return this.request('/downloads/remove', { method: 'POST', body: { ids, deleteFiles } });
  }

  public listQueues(timeoutMs = 2500): Promise<RpcCallResult<{ success: boolean; queues: DownloadQueue[] }>> {
    return this.request('/queues/list', { timeoutMs });
  }

  public toggleQueue(id: string, enabled: boolean): Promise<RpcCallResult<{ success: boolean }>> {
    return this.request('/queues/toggle', { method: 'POST', body: { id, enabled } });
  }

  public resolveMedia(url: string, signal?: AbortSignal): Promise<RpcCallResult<{ metadata?: PlatformMetadata } & PlatformMetadata>> {
    return this.request('/media/resolve', { method: 'POST', body: { url }, timeoutMs: 8000, signal });
  }

  public recognizeMedia(url: string, signal?: AbortSignal): Promise<RpcCallResult<RecognizedTrack>> {
    return this.request('/media/recognize', { method: 'POST', body: { url }, timeoutMs: 25_000, signal });
  }
}

