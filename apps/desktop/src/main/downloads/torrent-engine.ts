import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTorrentFile, type TorrentMetadata } from '@grabbit/utils';
import type { DownloadItem, TorrentFileInfo } from '../../shared/types';
import { JobCancelledError, TorrentError } from '../media/errors';
import { logger } from '../logger';
import { Aria2RpcError, torrentErrorFor, type Aria2File, type Aria2Rpc, type Aria2Status } from './aria2';

const STATUS_KEYS = [
  'gid',
  'status',
  'totalLength',
  'completedLength',
  'uploadLength',
  'downloadSpeed',
  'uploadSpeed',
  'connections',
  'numSeeders',
  'seeder',
  'infoHash',
  'dir',
  'errorCode',
  'errorMessage',
  'followedBy',
  'bittorrent',
];

/** What the manager decides once a torrent's metadata is known. */
export interface TorrentPlacement {
  /** Folder aria2 should download into. */
  directory: string;
  /** Stop here: the user wants to choose the files before anything downloads. */
  hold?: boolean;
}

/** The torrent stopped after its metadata so the user can choose files. Not a failure. */
export class TorrentSelectionNeededError extends Error {
  constructor() {
    super('Choose the files to download');
  }
}

/** aria2's select-file value (1-based indices), or null when every file is wanted. */
export function selectFileOption(files: TorrentFileInfo[] | undefined): string | null {
  if (!files || files.every((f) => f.selected !== false)) return null;
  return files
    .map((f, i) => (f.selected !== false ? String(i + 1) : null))
    .filter((v): v is string => v !== null)
    .join(',');
}

export interface TorrentMetadataInfo {
  name: string;
  totalBytes: number;
  files: TorrentFileInfo[];
}

export interface TorrentTaskContext {
  rpc(): Promise<Aria2Rpc>;
  /**
   * Private folder where a magnet's metadata is fetched; aria2 saves it there as
   * `<info hash>.torrent`. Nothing of the torrent's content is ever written here.
   */
  metadataDir: string;
  /** aria2 options added to every download (seeding, limits). */
  options(): Record<string, string>;
  /** The user wants finished torrents to keep seeding (a seed ratio is set). */
  keepsSeeding(): boolean;
  /**
   * The torrent's file list just became known (magnet links). The manager picks the final
   * folder here; nothing of the torrent has been written yet.
   */
  onMetadata(info: TorrentMetadataInfo): Promise<TorrentPlacement>;
  /** Finished, but aria2 keeps seeding this download (seed ratio set). */
  onSeeding?(gid: string): void;
  onUpdate(): void;
  /** How often aria2 is asked for progress. */
  pollMs?: number;
}

export interface TorrentResult {
  /** The finished file (single-file torrent) or folder (multi-file torrent). */
  path: string;
  /** aria2 keeps sharing it, so its files are still in use. */
  seeding?: boolean;
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Forward slashes, no trailing slash, case-folded on Windows: for comparing paths aria2 reports. */
function norm(path: string): string {
  const p = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * aria2's absolute file paths, made relative to the torrent's root and split into root + rest.
 * `root` is the first folder (or the file) under `dir` as aria2 wrote it, or null when no path
 * sits under `dir`; callers then fall back to the torrent's own name rather than guess.
 */
export function describeFiles(dir: string, files: Aria2File[]): { root: string | null; files: TorrentFileInfo[] } {
  const base = norm(dir);
  let root: string | null = null;
  const out: TorrentFileInfo[] = [];
  for (const f of files) {
    if (!f.path || f.path.startsWith('[METADATA]')) continue;
    const full = f.path.replace(/\\/g, '/');
    const size = { length: num(f.length), completedLength: num(f.completedLength), selected: f.selected !== 'false' };
    if (!norm(full).startsWith(`${base}/`)) {
      out.push({ path: full.split('/').pop() ?? full, ...size });
      continue;
    }
    const [first, ...rest] = full.slice(base.length + 1).split('/');
    root ??= first;
    out.push({ path: rest.length > 0 ? rest.join('/') : first, ...size });
  }
  return { root, files: out };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * One torrent run: adds it to aria2, follows it to completion and removes it from aria2 when
 * paused (aria2 keeps its .aria2 resume file, so the next run continues where this one stopped).
 */
export class TorrentDownloadTask {
  private gid: string | null = null;
  private rpcClient: Aria2Rpc | null = null;

  constructor(
    private readonly item: DownloadItem,
    private readonly ctx: TorrentTaskContext
  ) {}

  /** Applies a new file selection to the running download (aria2 restarts it internally). */
  public async setSelection(): Promise<void> {
    if (!this.gid || !this.rpcClient) return;
    const files = this.item.torrent?.files;
    const value = selectFileOption(files) ?? (files ? files.map((_, i) => i + 1).join(',') : null);
    if (!value) return;
    await this.rpcClient
      .call('changeOption', [this.gid, { 'select-file': value }])
      .catch((err) => logger.warn({ err, id: this.item.id }, 'Could not change the torrent file selection'));
  }

  /** Changes the per-torrent download cap while it runs (bytes/s, 0 = unlimited). */
  public async setSpeedLimit(bytesPerSecond: number): Promise<void> {
    if (!this.gid || !this.rpcClient) return;
    await this.rpcClient
      .call('changeOption', [this.gid, { 'max-download-limit': `${Math.round(Math.max(0, bytesPerSecond) / 1024)}K` }])
      .catch((err) => logger.warn({ err, id: this.item.id }, 'Could not change the torrent speed limit'));
  }

  public async run(signal: AbortSignal): Promise<TorrentResult> {
    const item = this.item;
    const torrent = item.torrent;
    if (!torrent) throw new TorrentError('This download has no torrent information', 'TORRENT_INVALID');

    item.status = 'starting';
    torrent.stage = 'Starting';
    this.ctx.onUpdate();

    const rpc = await this.ctx.rpc();
    this.rpcClient = rpc;
    if (signal.aborted) throw new JobCancelledError();

    try {
      this.gid = await this.add(rpc);
      return await this.follow(rpc, signal);
    } finally {
      torrent.stage = undefined;
      torrent.peers = undefined;
      torrent.seeders = undefined;
      torrent.uploadSpeed = undefined;
    }
  }

  private baseOptions(): Record<string, string> {
    const opts: Record<string, string> = { dir: this.item.directory, ...this.ctx.options() };
    if (this.item.speedLimit) opts['max-download-limit'] = `${Math.round(this.item.speedLimit / 1024)}K`;
    const selection = selectFileOption(this.item.torrent?.files);
    if (selection) opts['select-file'] = selection;
    return opts;
  }

  private async add(rpc: Aria2Rpc, retried = false): Promise<string> {
    const torrent = this.item.torrent!;
    try {
      // A .torrent file, or a magnet whose metadata was saved on an earlier run
      if (torrent.torrentFile) {
        let bytes: Buffer;
        try {
          bytes = await readFile(torrent.torrentFile);
        } catch {
          if (torrent.source === 'file') throw new TorrentError('The saved copy of the .torrent file is missing', 'TORRENT_INVALID');
          torrent.torrentFile = undefined;
          return this.add(rpc, retried);
        }
        return await rpc.call<string>('addTorrent', [bytes.toString('base64'), [], this.baseOptions()]);
      }
      if (torrent.source === 'file') throw new TorrentError('The .torrent file for this download is missing', 'TORRENT_INVALID');
      // aria2 cannot move a torrent to another folder once it exists, so the magnet only
      // fetches metadata here; the real download is added once its folder is known
      const metadataOptions: Record<string, string> = { ...this.baseOptions(), dir: this.ctx.metadataDir, 'bt-save-metadata': 'true' };
      // The selection belongs to the real download added later, not to this metadata fetch
      delete metadataOptions['select-file'];
      return await rpc.call<string>('addUri', [[this.item.url], metadataOptions]);
    } catch (err) {
      // A copy left over from an earlier run (e.g. a pause whose removal never finished)
      if (!retried && err instanceof Aria2RpcError && /already registered|InfoHash/i.test(err.message)) {
        await this.removeStale(rpc, torrent.infoHash);
        return this.add(rpc, true);
      }
      throw err;
    }
  }

  private async removeStale(rpc: Aria2Rpc, infoHash: string): Promise<void> {
    const lists = await Promise.all([
      rpc.call<Aria2Status[]>('tellActive', [['gid', 'infoHash']]).catch(() => []),
      rpc.call<Aria2Status[]>('tellWaiting', [0, 1000, ['gid', 'infoHash']]).catch(() => []),
    ]);
    for (const s of lists.flat()) {
      if (s.infoHash?.toLowerCase() === infoHash.toLowerCase()) {
        await rpc.call('forceRemove', [s.gid]).catch(() => undefined);
        await rpc.call('removeDownloadResult', [s.gid]).catch(() => undefined);
      }
    }
  }

  /** Stops this download in aria2 without touching its files or resume data. */
  private async detach(rpc: Aria2Rpc): Promise<void> {
    const gid = this.gid;
    if (!gid) return;
    await rpc.call('forceRemove', [gid]).catch(() => undefined);
    // forceRemove is asynchronous: wait (briefly) until aria2 has really let go of the files
    for (let i = 0; i < 20; i++) {
      const s = await rpc.call<Aria2Status>('tellStatus', [gid, ['status']]).catch(() => null);
      if (!s || s.status === 'removed' || s.status === 'complete' || s.status === 'error') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await rpc.call('removeDownloadResult', [gid]).catch(() => undefined);
  }

  private async follow(rpc: Aria2Rpc, signal: AbortSignal): Promise<TorrentResult> {
    const item = this.item;
    const torrent = item.torrent!;
    const pollMs = this.ctx.pollMs ?? 1000;
    let root: string | null = torrent.name ?? null;
    let filesChecked = Date.now();

    for (;;) {
      if (signal.aborted) {
        await this.detach(rpc);
        throw new JobCancelledError();
      }

      const st = await rpc.call<Aria2Status>('tellStatus', [this.gid, STATUS_KEYS]);

      // A magnet's metadata arrived. aria2 also created a (paused) download in the metadata
      // folder: drop it, choose the real folder, and add the saved .torrent there instead.
      if (st.followedBy && st.followedBy.length > 0) {
        await rpc.call('removeDownloadResult', [this.gid]).catch(() => undefined);
        this.gid = st.followedBy[0];
        await this.detach(rpc);
        this.gid = null;
        root = await this.restartFromMetadata(rpc, signal);
        continue;
      }

      if (st.status === 'error') {
        await rpc.call('removeDownloadResult', [this.gid]).catch(() => undefined);
        throw torrentErrorFor(st.errorCode, st.errorMessage);
      }
      if (st.status === 'removed') {
        throw new TorrentError('The torrent was stopped outside GRabbit');
      }

      const total = num(st.totalLength);
      const done = num(st.completedLength);
      const hasInfo = Boolean(st.bittorrent?.info);

      if (!hasInfo && st.status !== 'complete') {
        // Still asking peers for a magnet's metadata: those bytes are not the download itself
        item.status = 'starting';
        torrent.stage = 'Fetching metadata';
        torrent.peers = num(st.connections);
        item.activeConnections = num(st.connections);
        item.speed = 0;
        item.eta = null;
      } else {
        if (st.bittorrent?.info?.name) torrent.name = st.bittorrent.info.name;
        item.status = st.status === 'waiting' ? 'starting' : 'downloading';
        torrent.stage = undefined;

        // Per-file progress: every few seconds for the details panel, every poll when only some
        // files are wanted (the size and progress shown then come from those files)
        const partial = selectFileOption(torrent.files) !== null;
        if (!torrent.files || partial || Date.now() - filesChecked > 5000 || st.status === 'complete') {
          filesChecked = Date.now();
          const files = await rpc.call<Aria2File[]>('getFiles', [this.gid]).catch(() => null);
          const described = files ? describeFiles(st.dir ?? item.directory, files) : null;
          if (described && described.files.length > 0) {
            torrent.files = described.files;
            root = described.root ?? root;
          }
        }

        // aria2 counts whole pieces, which spill into skipped files; show what the user chose
        let wanted = total;
        let got = done;
        if (partial && torrent.files) {
          const chosen = torrent.files.filter((f) => f.selected !== false);
          wanted = chosen.reduce((sum, f) => sum + f.length, 0);
          got = chosen.reduce((sum, f) => sum + f.completedLength, 0);
        }
        item.totalBytes = wanted || item.totalBytes;
        item.receivedBytes = got;
        item.percent = wanted ? (got / wanted) * 100 : item.percent;
        item.speed = num(st.downloadSpeed);
        item.eta = wanted && item.speed > 0 ? Math.max(0, (wanted - got) / item.speed) : null;
        item.activeConnections = num(st.connections);
        torrent.peers = num(st.connections);
        torrent.seeders = num(st.numSeeders);
        torrent.uploadSpeed = num(st.uploadSpeed);
        torrent.uploadedBytes = num(st.uploadLength);

        // aria2 briefly reports "seeder" before it stops a download that should not seed, so
        // only a user who asked for seeding gets the download treated as done at that point
        const finished =
          st.status === 'complete' || (this.ctx.keepsSeeding() && total > 0 && done >= total && st.seeder === 'true');
        if (finished) {
          const seeding = st.status !== 'complete';
          if (!seeding) {
            await rpc.call('removeDownloadResult', [this.gid]).catch(() => undefined);
          } else {
            // Seeding continues in aria2 until the ratio is reached; the download itself is done
            this.ctx.onSeeding?.(this.gid!);
          }
          item.receivedBytes = wanted;
          item.totalBytes = wanted;
          item.percent = 100;
          this.ctx.onUpdate();
          const name = root ?? torrent.name ?? item.fileName;
          return { path: join(item.directory, name), seeding };
        }
      }

      this.ctx.onUpdate();
      await sleep(pollMs, signal);
    }
  }

  /** The metadata aria2 saved for this magnet, checked to be the torrent we asked for. */
  private async readSavedMetadata(signal: AbortSignal): Promise<{ path: string; bytes: Buffer; meta: TorrentMetadata }> {
    const torrent = this.item.torrent!;
    const path = join(this.ctx.metadataDir, `${torrent.infoHash}.torrent`);
    // aria2 writes the file as the metadata download completes; give it a moment
    for (let i = 0; i < 50 && !existsSync(path) && !signal.aborted; i++) await sleep(100, signal);
    if (signal.aborted) throw new JobCancelledError();
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      throw new TorrentError('The torrent engine did not save the metadata it fetched', 'TORRENT_FAILED');
    }
    const meta = parseTorrentFile(bytes);
    if (meta.infoHash !== torrent.infoHash) {
      throw new TorrentError('The metadata received does not match this magnet link', 'TORRENT_INVALID');
    }
    return { path, bytes, meta };
  }

  /** Lets the manager place a magnet whose metadata just arrived, then adds it for real. */
  private async restartFromMetadata(rpc: Aria2Rpc, signal: AbortSignal): Promise<string> {
    const torrent = this.item.torrent!;
    const saved = await this.readSavedMetadata(signal);
    // Kept, so pausing and resuming never has to ask peers for the metadata again
    torrent.torrentFile = saved.path;
    const placement = await this.ctx.onMetadata({
      name: saved.meta.name,
      totalBytes: saved.meta.totalBytes,
      files: saved.meta.files.map((f) => ({ ...f, completedLength: 0 })),
    });
    this.item.directory = placement.directory;
    if (placement.hold) throw new TorrentSelectionNeededError();
    if (signal.aborted) throw new JobCancelledError();
    this.gid = await rpc.call<string>('addTorrent', [saved.bytes.toString('base64'), [], this.baseOptions()]);
    return saved.meta.name;
  }
}
