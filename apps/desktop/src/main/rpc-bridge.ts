import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { URL } from 'node:url';
import type {
  AddHttpDownloadRequest,
  DownloadItem,
  RpcAddBatchRequest,
  RpcAddDownloadRequest,
  RpcPingResponse,
  RpcStatusResponse,
} from '../shared/types';
import type { DownloadManager } from './downloads/manager';
import type { SettingsService } from './settings';
import type { PlatformRouter } from './media/router';
import { detectPlatform, parseHttpUrl } from './media/url-parser';
import { logger } from './logger';

export interface RpcBridgeDeps {
  manager: DownloadManager;
  router: PlatformRouter;
  settings: SettingsService;
  version: string;
  onDownloadAdded?: (item: DownloadItem) => void;
}

export class DesktopRpcBridge {
  private server: Server | null = null;
  private currentPort = 0;
  private running = false;

  constructor(private readonly deps: RpcBridgeDeps) {}

  public start(): void {
    const s = this.deps.settings.get().extension;
    if (!s.enabled) {
      this.stop();
      return;
    }

    if (this.running && this.currentPort === s.port) {
      return;
    }

    this.stop();

    const server = createServer((req, res) => this.handleRequest(req, res));
    this.currentPort = s.port;

    server.on('error', (err: NodeJS.ErrnoException) => {
      logger.error({ port: s.port, err: err.message }, 'RPC bridge server error');
      if (err.code === 'EADDRINUSE') {
        logger.warn({ port: s.port }, 'RPC bridge port already in use');
      }
    });

    server.listen(s.port, '127.0.0.1', () => {
      this.running = true;
      this.server = server;
      logger.info({ port: s.port }, 'Desktop RPC bridge listening on 127.0.0.1');
    });
  }

  public stop(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch {
        // ignore
      }
      this.server = null;
      this.running = false;
      logger.info('Desktop RPC bridge stopped');
    }
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getPort(): number {
    return this.currentPort;
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-GRabbit-Token');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    this.setCorsHeaders(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  private authenticate(req: IncomingMessage, urlObj: URL): boolean {
    const s = this.deps.settings.get().extension;
    const expectedToken = s.token;
    if (!expectedToken) return true;

    const headerToken = req.headers['x-grabbit-token'];
    if (typeof headerToken === 'string' && headerToken === expectedToken) {
      return true;
    }

    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && match[1] === expectedToken) {
        return true;
      }
    }

    const queryToken = urlObj.searchParams.get('token');
    if (queryToken && queryToken === expectedToken) {
      return true;
    }

    return false;
  }

  private async readBodyJson<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = '';
      const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
      req.setEncoding('utf8');

      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          req.destroy();
          reject(new Error('Request payload too large'));
        }
      });

      req.on('end', () => {
        if (!body.trim()) {
          resolve({} as T);
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error('Invalid JSON payload'));
        }
      });

      req.on('error', (err) => reject(err));
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const rawUrl = req.url ?? '/';
    const parsedUrl = new URL(rawUrl, `http://127.0.0.1:${this.currentPort}`);
    const pathname = parsedUrl.pathname;

    // Public ping / health check endpoint
    if (req.method === 'GET' && (pathname === '/ping' || pathname === '/health')) {
      const authenticated = this.authenticate(req, parsedUrl);
      const pingResp: RpcPingResponse = {
        app: 'GRabbit',
        version: this.deps.version,
        authenticated,
        port: this.currentPort,
      };
      this.sendJson(res, 200, pingResp);
      return;
    }

    // All subsequent endpoints require authentication
    if (!this.authenticate(req, parsedUrl)) {
      this.sendJson(res, 401, {
        success: false,
        error: 'Unauthorized: invalid or missing X-GRabbit-Token header or token parameter',
      });
      return;
    }

    try {
      if (req.method === 'GET' && pathname === '/status') {
        const items = this.deps.manager.list();
        const activeItems = items.filter(
          (i) => i.status === 'downloading' || i.status === 'starting' || i.status === 'processing'
        );
        const totalSpeed = activeItems.reduce((acc, i) => acc + (i.speed || 0), 0);

        const statusResp: RpcStatusResponse = {
          app: 'GRabbit',
          version: this.deps.version,
          authenticated: true,
          port: this.currentPort,
          activeDownloads: activeItems.length,
          totalSpeed,
          queueLength: items.length,
        };
        this.sendJson(res, 200, statusResp);
        return;
      }

      if (req.method === 'POST' && pathname === '/downloads/add') {
        const body = await this.readBodyJson<RpcAddDownloadRequest>(req);
        if (!body.url || typeof body.url !== 'string') {
          this.sendJson(res, 400, { success: false, error: 'Field "url" is required' });
          return;
        }

        const added = await this.processDownloadRequest(body);
        if (added) {
          if (this.deps.onDownloadAdded) {
            this.deps.onDownloadAdded(added);
          }
          this.sendJson(res, 200, { success: true, item: added });
        } else {
          this.sendJson(res, 500, { success: false, error: 'Failed to enqueue download' });
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/downloads/batch') {
        const body = await this.readBodyJson<RpcAddBatchRequest>(req);
        if (!Array.isArray(body.items) || body.items.length === 0) {
          this.sendJson(res, 400, { success: false, error: 'Field "items" must be a non-empty array' });
          return;
        }

        const results: DownloadItem[] = [];
        for (const reqItem of body.items) {
          if (reqItem.url) {
            const added = await this.processDownloadRequest(reqItem);
            if (added) {
              results.push(added);
              if (this.deps.onDownloadAdded) {
                this.deps.onDownloadAdded(added);
              }
            }
          }
        }

        this.sendJson(res, 200, { success: true, count: results.length, items: results });
        return;
      }

      if (req.method === 'POST' && pathname === '/media/resolve') {
        const body = await this.readBodyJson<{ url: string }>(req);
        if (!body.url) {
          this.sendJson(res, 400, { success: false, error: 'Field "url" is required' });
          return;
        }
        const metadata = await this.deps.router.resolve(body.url);
        this.sendJson(res, 200, { success: true, metadata });
        return;
      }

      // 404 for any other route
      this.sendJson(res, 404, { success: false, error: `Route not found: ${req.method} ${pathname}` });
    } catch (err) {
      logger.error({ err, pathname }, 'RPC bridge request error');
      this.sendJson(res, 500, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async processDownloadRequest(req: RpcAddDownloadRequest): Promise<DownloadItem | null> {
    const rawUrl = req.url.trim();
    const headers: Record<string, string> = { ...(req.headers ?? {}) };

    if (req.cookies && !headers['Cookie'] && !headers['cookie']) {
      headers['Cookie'] = req.cookies;
    }
    if (req.userAgent && !headers['User-Agent'] && !headers['user-agent']) {
      headers['User-Agent'] = req.userAgent;
    }

    try {
      const parsed = parseHttpUrl(rawUrl);
      const platform = detectPlatform(parsed.hostname);

      // If recognized streaming media platform and no direct file name specified, try media resolve
      if (platform !== 'generic' && !req.fileName) {
        try {
          const meta = await this.deps.router.resolve(rawUrl);
          const first = meta.items[0];
          if (first && first.isDownloadable && first.availableOptions.length > 0) {
            const s = this.deps.settings.get();
            const preferredFormat = s.media.defaultAudioFormat === 'mp3' ? 'video' : 'video';
            const option = first.availableOptions.find((o) => o.format === preferredFormat) ?? first.availableOptions[0];
            const added = this.deps.manager.addMedia([
              {
                platform,
                mediaId: first.id,
                url: first.url,
                format: option.format,
                qualityId: option.qualityId,
                title: first.title,
                author: first.uploader,
                thumbnailUrl: first.thumbnailUrl,
                durationSeconds: first.durationSeconds,
                estimatedSizeBytes: option.estimatedSizeBytes,
                startPaused: req.startPaused,
              },
            ]);
            return added[0] ?? null;
          }
        } catch (mediaErr) {
          logger.warn({ rawUrl, err: mediaErr }, 'Media resolve failed in RPC; falling back to direct HTTP download');
        }
      }

      const httpReq: AddHttpDownloadRequest = {
        url: rawUrl,
        fileName: req.fileName,
        category: req.category,
        directory: req.directory,
        referrer: req.referrer,
        headers,
        startPaused: req.startPaused,
      };

      const added = this.deps.manager.addHttp([httpReq]);
      return added[0] ?? null;
    } catch (err) {
      logger.error({ rawUrl, err }, 'Failed to process RPC download request');
      return null;
    }
  }
}
