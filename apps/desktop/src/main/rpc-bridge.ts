import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { execFile } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { URL } from 'node:url';
import {
  describeIssue,
  RpcAddBatchRequestSchema,
  RpcAddDownloadRequestSchema,
  RpcExtensionUpdateRequestSchema,
  RpcStreamRequestSchema,
  RpcUrlRequestSchema,
  type ZodTypeAny,
} from '@grabbit/schemas';
import type {
  AddHttpDownloadRequest,
  DownloadItem,
  RpcAddDownloadRequest,
  RpcPingResponse,
  RpcStatusResponse,
} from '../shared/types';
import type { DownloadManager } from './downloads/manager';
import type { SettingsService } from './settings';
import type { PlatformRouter } from './media/router';
import type { MusicRecognizer } from './media/recognizer';
import { YtDlpRunner } from './media/ytdlp-runner';
import { detectPlatform, isPrivateHost, parseHttpUrl } from './media/url-parser';
import { InvalidUrlError } from './media/errors';
import { logger } from './logger';

/** Platforms whose content is music: links from the browser become audio downloads. */
const AUDIO_PLATFORMS = new Set<string>(['spotify', 'soundcloud']);

/** Most downloads one /downloads/batch call may add. */
export const MAX_BATCH_ITEMS = 200;
/** Largest extension package /extension/update will fetch. */
const MAX_EXTENSION_ZIP_BYTES = 50 * 1024 * 1024;
/** The only place an extension update may come from: this project's GitHub release assets. */
const EXTENSION_RELEASE_URL = /^https:\/\/github\.com\/darka1pha\/GRabbit-APP\/releases\/(?:download\/[^/?#]+|latest\/download)\/[^/?#]+\.zip$/i;

/** A request the bridge refuses because of what it asks for (answered with HTTP 400). */
class RpcRequestError extends Error {}

/** Requests one address may make per minute. */
export const MAX_REQUESTS_PER_MINUTE = 300;
/** Wrong-token attempts one address may make per minute before it is locked out for the rest of it. */
export const MAX_AUTH_FAILURES_PER_MINUTE = 20;
const MAX_OPEN_CONNECTIONS = 64;

/** Counts events per key in fixed windows. */
class WindowCounter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000
  ) {}

  private current(key: string, now: number): { start: number; count: number } {
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (this.windows.size > 2000) this.prune(now);
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    return w;
  }

  private prune(now: number): void {
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
  }

  public add(key: string, now = Date.now()): void {
    this.current(key, now).count++;
  }

  public exceeded(key: string, now = Date.now()): boolean {
    return this.current(key, now).count >= this.limit;
  }

  /** Seconds until the key's window ends. */
  public retryAfter(key: string, now = Date.now()): number {
    return Math.max(1, Math.ceil((this.current(key, now).start + this.windowMs - now) / 1000));
  }
}

export type HostLookup = (hostname: string) => Promise<string[]>;

const systemLookup: HostLookup = async (hostname) => (await lookup(hostname, { all: true })).map((a) => a.address);

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
  /** Resolves a host name to its addresses (defaults to the system resolver). */
  lookupHost?: HostLookup;
}

export class DesktopRpcBridge {
  private server: Server | null = null;
  private currentPort = 0;
  private currentHost = '127.0.0.1';
  private running = false;
  private requests = new WindowCounter(MAX_REQUESTS_PER_MINUTE);
  private authFailures = new WindowCounter(MAX_AUTH_FAILURES_PER_MINUTE);

  constructor(private readonly deps: RpcBridgeDeps) {}

  /**
   * URL the desktop is asked to fetch on a caller's behalf and report back on. Loopback, private
   * and link-local targets are refused, by name and by what the name resolves to, so the bridge
   * cannot be used to read from the user's own network.
   */
  private async publicHttpUrl(raw: string): Promise<string> {
    const parsed = parseHttpUrl(raw);
    const refuse = () => new RpcRequestError('Local and private network addresses are not allowed here');
    if (isPrivateHost(parsed.hostname)) throw refuse();
    if (isIP(parsed.hostname.replace(/^\[|\]$/g, '')) === 0) {
      let addresses: string[] = [];
      try {
        addresses = await (this.deps.lookupHost ?? systemLookup)(parsed.hostname);
      } catch {
        // Unresolvable here: the fetch itself will fail the same way
      }
      if (addresses.some((address) => isPrivateHost(address))) throw refuse();
    }
    return parsed.toString();
  }

  private parse<S extends ZodTypeAny>(schema: S, body: unknown): ReturnType<S['parse']> {
    const result = schema.safeParse(body);
    if (!result.success) throw new RpcRequestError(`Invalid request: ${describeIssue(result.error)}`);
    return result.data;
  }

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
    server.maxConnections = MAX_OPEN_CONNECTIONS;
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

  private async readBodyJson<T = unknown>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = '';
      const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
      req.setEncoding('utf8');

      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          req.destroy();
          reject(new RpcRequestError('Request payload too large'));
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
          reject(new RpcRequestError('Invalid JSON payload'));
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

    // Per-address limits: a general request budget, and a lockout after repeated wrong tokens
    const client = req.socket.remoteAddress ?? 'unknown';
    const limited = this.authFailures.exceeded(client) ? this.authFailures : this.requests.exceeded(client) ? this.requests : null;
    if (limited) {
      res.setHeader('Retry-After', String(limited.retryAfter(client)));
      this.sendJson(res, 429, { success: false, error: 'Too many requests' });
      return;
    }
    this.requests.add(client);

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
      this.authFailures.add(client);
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
        const body = this.parse(RpcAddDownloadRequestSchema, await this.readBodyJson(req));

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
        const body = this.parse(RpcAddBatchRequestSchema, await this.readBodyJson(req));
        if (body.items.length > MAX_BATCH_ITEMS) {
          this.sendJson(res, 400, { success: false, error: `A batch may contain at most ${MAX_BATCH_ITEMS} items` });
          return;
        }

        const results: DownloadItem[] = [];
        for (const rawItem of body.items) {
          // A malformed entry is skipped rather than failing the whole batch
          const reqItem = RpcAddDownloadRequestSchema.safeParse(rawItem);
          if (!reqItem.success) continue;
          const added = await this.processDownloadRequest(reqItem.data);
          if (added) {
            results.push(added);
            if (this.deps.onDownloadAdded) {
              this.deps.onDownloadAdded(added);
            }
          }
        }

        this.sendJson(res, 200, { success: true, count: results.length, items: results });
        return;
      }

      if (req.method === 'POST' && (pathname === '/media/resolve' || pathname === '/api/resolve')) {
        const body = this.parse(RpcUrlRequestSchema, await this.readBodyJson(req));
        const metadata = await this.deps.router.resolve(await this.publicHttpUrl(body.url));
        this.sendJson(res, 200, { success: true, metadata, ...metadata });
        return;
      }

      if (req.method === 'GET' && pathname === '/downloads/list') {
        this.sendJson(res, 200, { success: true, items: this.deps.manager.list() });
        return;
      }

      if (req.method === 'POST' && (pathname === '/media/recognize' || pathname === '/api/recognize')) {
        const body = this.parse(RpcUrlRequestSchema, await this.readBodyJson(req));
        if (!this.deps.recognizer) {
          this.sendJson(res, 400, { success: false, error: 'Recognizer unavailable' });
          return;
        }
        const track = await this.deps.recognizer.identifyUrl(await this.publicHttpUrl(body.url));
        this.sendJson(res, 200, track ?? { title: null });
        return;
      }

      if (req.method === 'POST' && pathname === '/media/stream') {
        const body = this.parse(RpcStreamRequestSchema, await this.readBodyJson(req));
        const ytdlp = new YtDlpRunner();
        const meta = await ytdlp.getMetadata(await this.publicHttpUrl(body.url));
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
        const body = this.parse(RpcExtensionUpdateRequestSchema, await this.readBodyJson(req));
        if (!EXTENSION_RELEASE_URL.test(body.downloadUrl)) {
          this.sendJson(res, 400, {
            success: false,
            error: 'Field "downloadUrl" must be a .zip asset of a GRabbit GitHub release',
          });
          return;
        }
        const version = String(body.version || 'latest').replace(/[^a-zA-Z0-9._-]/g, '');
        const zipRes = await fetch(body.downloadUrl);
        if (!zipRes.ok) {
          this.sendJson(res, 502, { success: false, error: `Failed to download extension zip (HTTP ${zipRes.status})` });
          return;
        }
        const buf = Buffer.from(await zipRes.arrayBuffer());
        if (buf.length > MAX_EXTENSION_ZIP_BYTES) {
          this.sendJson(res, 502, { success: false, error: 'Extension zip is unexpectedly large' });
          return;
        }
        const zipPath = join(tmpdir(), `GRabbit-Chrome-Extension-v${version}.zip`);
        writeFileSync(zipPath, buf);

        const targetDirs: string[] = [];
        const downloadDir = this.deps.settings.get().downloadDir;
        if (downloadDir) {
          const dlExtDir = join(downloadDir, 'GRabbit-Chrome-Extension');
          mkdirSync(dlExtDir, { recursive: true });
          targetDirs.push(dlExtDir);
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
      if (err instanceof RpcRequestError || err instanceof InvalidUrlError) {
        this.sendJson(res, 400, { success: false, error: err.message });
        return;
      }
      logger.error({ err, pathname }, 'RPC bridge request error');
      this.sendJson(res, 500, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Remote callers may only choose a folder inside the user's download folder. Anything else
   * is dropped and the download lands in the default location for its category.
   */
  private safeDirectory(requested: unknown): string | undefined {
    if (typeof requested !== 'string' || !requested.trim()) return undefined;
    const root = resolve(this.deps.settings.get().downloadDir);
    const target = resolve(root, requested.trim());
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      logger.warn({ requested }, 'RPC download asked for a folder outside the download folder; using the default');
      return undefined;
    }
    return target;
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
        directory: this.safeDirectory(req.directory),
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
