import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { TorrentSettings } from '../../shared/types';
import { TorrentError } from '../media/errors';
import { logger } from '../logger';

/**
 * aria2 (https://aria2.github.io) is the BitTorrent engine. The app starts one aria2c in the
 * background, listening for JSON-RPC on a random loopback port behind a random secret, and
 * drives every torrent through it. The download manager stays in charge of queues, order and
 * concurrency; aria2 only ever runs what it is told to.
 */

export interface Aria2File {
  index: string;
  path: string;
  length: string;
  completedLength: string;
  selected: string;
}

export interface Aria2Status {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  totalLength: string;
  completedLength: string;
  uploadLength: string;
  downloadSpeed: string;
  uploadSpeed: string;
  connections: string;
  numSeeders?: string;
  seeder?: string;
  infoHash?: string;
  dir?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Set on a magnet's metadata download once the real download has been created. */
  followedBy?: string[];
  bittorrent?: { info?: { name?: string }; mode?: 'single' | 'multi' };
  files?: Aria2File[];
}

/** The part of aria2's JSON-RPC interface the torrent task uses (a fake in tests). */
export interface Aria2Rpc {
  call<T = unknown>(method: string, params?: unknown[]): Promise<T>;
}

/** aria2 errors carry a numeric code (see "EXIT STATUS" in the aria2 manual). */
export class Aria2RpcError extends Error {
  constructor(
    message: string,
    public readonly rpcCode?: number
  ) {
    super(message);
  }
}

/** Translates aria2's download error codes into the app's error codes. */
export function torrentErrorFor(errorCode: string | undefined, message: string | undefined): TorrentError {
  const text = message?.trim() || 'The torrent failed';
  switch (errorCode) {
    case '9':
      return new TorrentError(text, 'DISK_FULL');
    case '12':
      return new TorrentError(text, 'TORRENT_DUPLICATE');
    case '15':
    case '16':
    case '17':
    case '18':
      return new TorrentError(text, 'ACCESS_DENIED');
    case '19':
      return new TorrentError(text, 'DNS_FAILED');
    case '6':
      return new TorrentError(text, 'NETWORK');
    default:
      return new TorrentError(text, 'TORRENT_FAILED');
  }
}

export class Aria2Client implements Aria2Rpc {
  private nextId = 1;

  constructor(
    private readonly endpoint: string,
    private readonly secret: string
  ) {}

  public async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: String(this.nextId++),
        method: method.startsWith('system.') ? method : `aria2.${method}`,
        params: method.startsWith('system.') ? params : [`token:${this.secret}`, ...params],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { result?: T; error?: { code?: number; message?: string } } | null;
    if (!body) throw new Aria2RpcError(`aria2 answered HTTP ${res.status}`);
    if (body.error) throw new Aria2RpcError(body.error.message ?? 'aria2 error', body.error.code);
    return body.result as T;
  }
}

/** A free TCP port on the loopback interface. */
function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('No free port'))));
    });
  });
}

export interface Aria2LaunchConfig {
  port: number;
  secret: string;
  /** Folder for aria2's own state (DHT routing tables). */
  stateDir: string;
  settings: TorrentSettings;
  /** KB/s across every torrent, 0 = unlimited. */
  downloadLimitKBps: number;
  proxy: string;
  /** aria2 exits by itself if this process disappears (crash, kill). */
  parentPid: number;
}

/** Command line for the background aria2c. Pure, so the choices are easy to test. */
export function buildAria2Args(cfg: Aria2LaunchConfig): string[] {
  const dht = cfg.settings.enableDht;
  const args = [
    '--enable-rpc=true',
    '--rpc-listen-all=false',
    `--rpc-listen-port=${cfg.port}`,
    `--rpc-secret=${cfg.secret}`,
    '--rpc-allow-origin-all=false',
    // A 10 MB .torrent is ~14 MB once base64-encoded for aria2.addTorrent
    '--rpc-max-request-size=24M',
    `--stop-with-process=${cfg.parentPid}`,
    // The download manager decides what runs; aria2 must never hold anything back itself
    '--max-concurrent-downloads=1000',
    '--continue=true',
    // Write the resume (.aria2) files often, so a crash loses little
    '--auto-save-interval=10',
    // Magnet metadata arrives as a separate download that we inspect before the real one starts
    '--pause-metadata=true',
    '--bt-save-metadata=false',
    // aria2 would otherwise drop a copy of every .torrent it is handed into the download folder
    '--rpc-save-upload-metadata=false',
    '--bt-load-saved-metadata=false',
    '--follow-torrent=mem',
    `--enable-dht=${dht}`,
    `--enable-dht6=${dht}`,
    `--bt-enable-lpd=${dht}`,
    '--enable-peer-exchange=true',
    `--dht-file-path=${join(cfg.stateDir, 'dht.dat')}`,
    `--dht-file-path6=${join(cfg.stateDir, 'dht6.dat')}`,
    `--max-overall-upload-limit=${Math.max(0, Math.round(cfg.settings.maxUploadKBps))}K`,
    `--max-overall-download-limit=${Math.max(0, Math.round(cfg.downloadLimitKBps))}K`,
    '--file-allocation=none',
    '--disk-cache=32M',
    '--allow-overwrite=false',
    '--console-log-level=error',
    '--summary-interval=0',
    '--show-console-readout=false',
    '--quiet=false',
  ];
  if (cfg.proxy.trim()) args.push(`--all-proxy=${cfg.proxy.trim()}`);
  return args;
}

/** Per-torrent seeding options for aria2.addUri / addTorrent. */
export function seedOptions(settings: TorrentSettings): Record<string, string> {
  if (settings.seedRatio > 0) return { 'seed-ratio': String(settings.seedRatio) };
  // Stop the moment the last piece is verified
  return { 'seed-time': '0' };
}

export interface Aria2ServiceDeps {
  getBinary(): string;
  getSettings(): { torrent: TorrentSettings; proxy: string };
  stateDir: string;
}

/** Owns the background aria2c: started on first use, stopped when the app quits. */
export class Aria2Service {
  private child: ChildProcess | null = null;
  private client: Aria2Client | null = null;
  private starting: Promise<Aria2Client> | null = null;
  private version: string | null = null;
  private downloadLimitKBps = 0;
  /** Settings that only take effect on a fresh aria2 (DHT) changed while torrents were running. */
  private restartWanted = false;

  constructor(private readonly deps: Aria2ServiceDeps) {}

  public isRunning(): boolean {
    return this.client !== null;
  }

  public getVersion(): string | null {
    return this.version;
  }

  public binaryPath(): string {
    return this.deps.getBinary();
  }

  /** The running aria2, started if needed. */
  public rpc(): Promise<Aria2Rpc> {
    if (this.client) return Promise.resolve(this.client);
    this.starting ??= this.launch().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(): Promise<Aria2Client> {
    const binary = this.deps.getBinary();
    if (!existsSync(binary)) {
      throw new TorrentError('The torrent engine (aria2c.exe) is missing from this installation', 'TORRENT_ENGINE_MISSING');
    }
    mkdirSync(this.deps.stateDir, { recursive: true });
    const port = await freeLoopbackPort();
    const secret = randomBytes(24).toString('hex');
    const settings = this.deps.getSettings();
    const args = buildAria2Args({
      port,
      secret,
      stateDir: this.deps.stateDir,
      settings: settings.torrent,
      downloadLimitKBps: this.downloadLimitKBps,
      proxy: settings.proxy,
      parentPid: process.pid,
    });

    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-4000);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    let exited = false;
    child.once('exit', (code) => {
      exited = true;
      if (this.child === child) {
        logger.warn({ code, output: output.trim().slice(-500) }, 'aria2 exited');
        this.child = null;
        this.client = null;
      }
    });
    child.once('error', (err) => logger.error({ err }, 'aria2 could not be started'));

    const client = new Aria2Client(`http://127.0.0.1:${port}/jsonrpc`, secret);
    const deadline = Date.now() + 10_000;
    for (;;) {
      if (exited) {
        throw new TorrentError(`The torrent engine stopped while starting: ${output.trim().slice(-300) || 'no output'}`);
      }
      try {
        const info = await client.call<{ version: string }>('getVersion');
        this.version = info.version;
        break;
      } catch {
        if (Date.now() > deadline) {
          child.kill();
          throw new TorrentError('The torrent engine did not start in time');
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    this.child = child;
    this.client = client;
    this.restartWanted = false;
    logger.info({ version: this.version, port }, 'aria2 started');
    return client;
  }

  /** Overall download cap in bytes/s (0 = unlimited), following the app's global limit. */
  public setDownloadLimit(bytesPerSecond: number): void {
    const kbps = Math.round(Math.max(0, bytesPerSecond) / 1024);
    if (kbps === this.downloadLimitKBps) return;
    this.downloadLimitKBps = kbps;
    void this.client?.call('changeGlobalOption', [{ 'max-overall-download-limit': `${kbps}K` }]).catch((err) => {
      logger.warn({ err }, 'Could not change the torrent download limit');
    });
  }

  /** Applies changed torrent settings. Returns true when aria2 has to restart to pick them up. */
  public applySettings(next: TorrentSettings, previous: TorrentSettings): boolean {
    if (!this.client) return false;
    if (next.maxUploadKBps !== previous.maxUploadKBps) {
      void this.client
        .call('changeGlobalOption', [{ 'max-overall-upload-limit': `${Math.round(next.maxUploadKBps)}K` }])
        .catch((err) => logger.warn({ err }, 'Could not change the torrent upload limit'));
    }
    if (next.enableDht !== previous.enableDht) this.restartWanted = true;
    return this.restartWanted;
  }

  /** Asks for a fresh aria2 (e.g. the proxy changed); it happens once no torrent is running. */
  public requestRestart(): void {
    if (this.client) this.restartWanted = true;
  }

  /** Called when no torrent is running: a restart that was waiting for that happens now. */
  public onIdle(): void {
    if (this.restartWanted) void this.stop();
  }

  /** Stops aria2, letting it write its resume files first. */
  public async stop(timeoutMs = 3000): Promise<void> {
    const child = this.child;
    const client = this.client;
    this.child = null;
    this.client = null;
    if (!child) return;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
    try {
      await client?.call('shutdown');
    } catch {
      // fall through to the kill below
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    await exited;
    clearTimeout(timer);
  }

  /** Last resort on exit: no time to wait. */
  public killNow(): void {
    this.child?.kill();
    this.child = null;
    this.client = null;
  }
}
