import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { execFile } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
import type { MusicRecognizer } from './media/recognizer';
import { YtDlpRunner } from './media/ytdlp-runner';
import { detectPlatform, parseHttpUrl } from './media/url-parser';
import { logger } from './logger';

/** Platforms whose content is music: links from the browser become audio downloads. */
const AUDIO_PLATFORMS = new Set<string>(['spotify', 'soundcloud']);

/** Constant-time comparison (hashing first makes both sides the same length). */
function tokensMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface RpcBridgeDeps {
  manager: DownloadManager;
  router: PlatformRouter;
  recognizer?: MusicRecognizer;
  settings: SettingsService;
  version: string;
  onDownloadAdded?: (item: DownloadItem) => void;
}

export class DesktopRpcBridge {
  private server: Server | null = null;
  private currentPort = 0;
  private currentHost = '127.0.0.1';
  private running = false;

  constructor(private readonly deps: RpcBridgeDeps) {}

  public start(): void {
    const s = this.deps.settings.get().extension;
    if (!s.enabled) {
      this.stop();
      return;
    }

    // Loopback unless the user explicitly opted in to LAN access (mobile pairing)
    const bindHost = s.allowLan === true ? '0.0.0.0' : '127.0.0.1';
    if (this.running && this.currentPort === s.port && this.currentHost === bindHost) {
      return;
    }

    this.stop();

    const server = createServer((req, res) => this.handleRequest(req, res));
    this.currentPort = s.port;
    this.currentHost = bindHost;

    server.on('error', (err: NodeJS.ErrnoException) => {
      logger.error({ port: s.port, host: bindHost, err: err.message }, 'RPC bridge server error');
      if (err.code === 'EADDRINUSE') {
        logger.warn({ port: s.port }, 'RPC bridge port already in use');
      }
    });

    // Tracked before it is listening, so a stop() that arrives first still closes it
    this.server = server;
    server.listen(s.port, bindHost, () => {
      if (this.server !== server) return;
      this.running = true;
      logger.info({ port: s.port, host: bindHost }, 'Desktop RPC bridge listening');
    });
  }

  public stop(): void {
    if (this.server) {
      try {
        this.server.close();
        // Keep-alive sockets would otherwise keep being served by the old server
        this.server.closeAllConnections();
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

  /**
   * Only browser extensions may read responses cross-origin. Ordinary web pages get no
   * CORS grant, so they can neither probe for the app nor read anything from it.
   */
  private setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers['origin'];
    if (typeof origin === 'string' && /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-GRabbit-Token');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  /**
   * The token is the only credential. Request headers such as Origin or a client name are
   * chosen by the caller and prove nothing, so they are never accepted in its place.
   */
  private authenticate(req: IncomingMessage): boolean {
    const expectedToken = this.deps.settings.get().extension.token;
    if (!expectedToken) return false;

    const headerToken = req.headers['x-grabbit-token'];
    if (typeof headerToken === 'string' && tokensMatch(headerToken, expectedToken)) return true;

    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && tokensMatch(match[1], expectedToken)) return true;
    }
    return false;
  }

  /**
   * DNS-rebinding guard: a web page can point its own domain at this machine, but the browser
   * then sends that domain in Host. Real clients address the bridge by IP or "localhost".
   */
  private hostAllowed(req: IncomingMessage): boolean {
    const raw = req.headers['host'];
    if (typeof raw !== 'string' || !raw) return false;
    let hostname: string;
    try {
      hostname = new URL(`http://${raw}`).hostname.replace(/^\[|\]$/g, '');
    } catch {
      return false;
    }
    return hostname.toLowerCase() === 'localhost' || isIP(hostname) !== 0;
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
    this.setCorsHeaders(req, res);
    // One request per connection: calls are infrequent, and no client is left holding a
    // socket to a server that has since been stopped or rebound.
    res.setHeader('Connection', 'close');

    if (!this.hostAllowed(req)) {
      this.sendJson(res, 403, { success: false, error: 'Forbidden: unexpected Host header' });
      return;
    }

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
      const authenticated = this.authenticate(req);
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
    if (!this.authenticate(req)) {
      this.sendJson(res, 401, {
        success: false,
        error: 'Unauthorized: invalid or missing X-GRabbit-Token header',
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

      if (req.method === 'POST' && (pathname === '/media/resolve' || pathname === '/api/resolve')) {
        const body = await this.readBodyJson<{ url: string }>(req);
        if (!body.url) {
          this.sendJson(res, 400, { success: false, error: 'Field "url" is required' });
          return;
        }
        const metadata = await this.deps.router.resolve(body.url);
        this.sendJson(res, 200, { success: true, metadata, ...metadata });
        return;
      }

      if (req.method === 'GET' && pathname === '/downloads/list') {
        this.sendJson(res, 200, { success: true, items: this.deps.manager.list() });
        return;
      }

      if (req.method === 'POST' && (pathname === '/media/recognize' || pathname === '/api/recognize')) {
        const body = await this.readBodyJson<{ url?: string }>(req);
        if (!body.url || !this.deps.recognizer) {
          this.sendJson(res, 400, { success: false, error: 'Field "url" is required or recognizer unavailable' });
          return;
        }
        const track = await this.deps.recognizer.identifyUrl(parseHttpUrl(body.url).toString());
        this.sendJson(res, 200, track ?? { title: null });
        return;
      }

      if (req.method === 'POST' && pathname === '/media/stream') {
        const body = await this.readBodyJson<{ url: string; format?: 'audio' | 'video'; qualityId?: string }>(req);
        if (!body.url) {
          this.sendJson(res, 400, { success: false, error: 'Field "url" is required' });
          return;
        }
        const ytdlp = new YtDlpRunner();
        const meta = await ytdlp.getMetadata(body.url);
        const formats = Array.isArray(meta.formats) ? meta.formats : [];
        const directFormats = formats.filter((f) => typeof (f as any).url === 'string' && !(f as any).url.includes('.m3u8'));
        let chosen: any = null;
        if (body.format === 'audio') {
          chosen =
            directFormats
              .filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
              .sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0] ??
            directFormats.filter((f) => f.acodec && f.acodec !== 'none').pop();
        } else {
          const targetHeight = parseInt((body.qualityId || '1080').replace(/\D/g, ''), 10) || 1080;
          const muxed = directFormats.filter(
            (f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none'
          );
          chosen =
            muxed.filter((f) => (f.height || 0) <= targetHeight).sort((a, b) => (b.height || 0) - (a.height || 0))[0] ??
            muxed.sort((a, b) => (b.height || 0) - (a.height || 0))[0] ??
            directFormats.filter((f) => f.vcodec && f.vcodec !== 'none').pop();
        }
        const streamUrl = chosen?.url || (typeof (meta as any).url === 'string' ? (meta as any).url : null);
        if (!streamUrl) {
          this.sendJson(res, 404, { success: false, error: 'No direct stream URL found' });
          return;
        }
        this.sendJson(res, 200, {
          success: true,
          streamUrl,
          ext: chosen?.ext || (body.format === 'audio' ? 'm4a' : 'mp4'),
          sizeBytes: chosen?.filesize || chosen?.filesize_approx,
          headers: (chosen as any)?.http_headers || (meta as any)?.http_headers,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/extension/update') {
        const body = await this.readBodyJson<{ downloadUrl?: string; version?: string }>(req);
        if (!body.downloadUrl) {
          this.sendJson(res, 400, { success: false, error: 'Field "downloadUrl" is required' });
          return;
        }
        const version = String(body.version || 'latest').replace(/[^a-zA-Z0-9._-]/g, '');
        const zipRes = await fetch(body.downloadUrl);
        if (!zipRes.ok) {
          this.sendJson(res, 502, { success: false, error: `Failed to download extension zip (HTTP ${zipRes.status})` });
          return;
        }
        const buf = Buffer.from(await zipRes.arrayBuffer());
        const zipPath = join(tmpdir(), `GRabbit-Chrome-Extension-v${version}.zip`);
        writeFileSync(zipPath, buf);

        const targetDirs: string[] = [];
        const downloadDir = this.deps.settings.get().downloadDir;
        if (downloadDir) {
          const dlExtDir = join(downloadDir, 'GRabbit-Chrome-Extension');
          mkdirSync(dlExtDir, { recursive: true });
          targetDirs.push(dlExtDir);
        }
        const localRepoDist = resolve(process.cwd(), 'packages/extension/dist');
        if (existsSync(localRepoDist)) {
          targetDirs.push(localRepoDist);
        }

        for (const dest of targetDirs) {
          await new Promise<void>((resolveExec) => {
            execFile(
              'powershell.exe',
              ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`],
              () => resolveExec()
            );
          });
        }

        this.sendJson(res, 200, {
          success: true,
          installedVersion: version,
          extractedDirs: targetDirs,
        });
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

      // If recognized streaming media platform, try media resolve first
      if (platform !== 'generic') {
        try {
          const meta = await this.deps.router.resolve(rawUrl);
          const first = meta.items[0];
          if (first && first.isDownloadable && first.availableOptions.length > 0) {
            const s = this.deps.settings.get();
            const preferredFormat = req.format ?? (AUDIO_PLATFORMS.has(platform) ? 'audio' : 'video');
            const candidates = first.availableOptions.filter((o) => o.format === preferredFormat);
            const option =
              (preferredFormat === 'audio'
                ? candidates.find((o) => o.qualityId.startsWith(s.media.defaultAudioFormat))
                : undefined) ??
              candidates[0] ??
              first.availableOptions[0];
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
