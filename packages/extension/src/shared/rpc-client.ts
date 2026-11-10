import type {
  RpcAddBatchRequest,
  RpcAddDownloadRequest,
  RpcAddDownloadResponse,
  RpcPingResponse,
  RpcStatusResponse,
} from '@grabbit/types';
import type { ExtensionConfig } from '../types/extension';

export class ExtensionRpcClient {
  constructor(private readonly config: ExtensionConfig) {}

  private baseUrl(): string {
    const host = this.config.bridgeHost || '127.0.0.1';
    const port = this.config.bridgePort || 31542;
    return `http://${host}:${port}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.bridgeToken) {
      headers['X-GRabbit-Token'] = this.config.bridgeToken;
      headers['Authorization'] = `Bearer ${this.config.bridgeToken}`;
    }
    return headers;
  }

  public async ping(timeoutMs = 4000): Promise<{
    ok: boolean;
    data?: RpcPingResponse;
    error?: string;
  }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${this.baseUrl()}/ping`, {
        method: 'GET',
        headers: this.headers(),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const data = (await res.json()) as RpcPingResponse;
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async status(timeoutMs = 5000): Promise<{
    ok: boolean;
    data?: RpcStatusResponse;
    error?: string;
  }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${this.baseUrl()}/status`, {
        method: 'GET',
        headers: this.headers(),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const data = (await res.json()) as RpcStatusResponse;
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async addDownload(
    req: RpcAddDownloadRequest,
    timeoutMs = 60000
  ): Promise<RpcAddDownloadResponse> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${this.baseUrl()}/downloads/add`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errorJson = (await res.json().catch(() => ({}))) as { error?: string };
        return {
          success: false,
          error: errorJson.error || `HTTP ${res.status}: ${res.statusText}`,
        };
      }
      return (await res.json()) as RpcAddDownloadResponse;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async addBatch(
    req: RpcAddBatchRequest,
    timeoutMs = 12000
  ): Promise<{ success: boolean; count?: number; items?: unknown[]; error?: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${this.baseUrl()}/downloads/batch`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errorJson = (await res.json().catch(() => ({}))) as { error?: string };
        return {
          success: false,
          error: errorJson.error || `HTTP ${res.status}: ${res.statusText}`,
        };
      }
      return (await res.json()) as { success: boolean; count?: number; items?: unknown[] };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

