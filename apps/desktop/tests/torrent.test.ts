import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const trashItem = vi.fn(async (_path: string) => undefined);
vi.mock('electron', () => ({
  app: {
    getLocale: () => 'en-US',
    getPath: (name: string) => (name === 'downloads' ? '/mock/downloads' : '/mock/userData'),
    getVersion: () => '1.0.0',
    isPackaged: false,
    quit: vi.fn(),
  },
  shell: { trashItem: (p: string) => trashItem(p) },
}));

import { magnetFor, parseMagnet, parseTorrentFile } from '@grabbit/utils';
import { DEFAULT_APP_SETTINGS } from '@grabbit/config';
import { DownloadManager } from '../src/main/downloads/manager';
import { buildAria2Args, seedOptions, torrentErrorFor, type Aria2File, type Aria2Rpc, type Aria2Status } from '../src/main/downloads/aria2';
import { describeFiles, selectFileOption, TorrentDownloadTask } from '../src/main/downloads/torrent-engine';
import { JobCancelledError } from '../src/main/media/errors';
import type { AppSettings, DownloadItem, DownloadProgressPatch } from '../src/shared/types';

// ---------------------------------------------------------------- helpers

/** Minimal bencoder for building test .torrent files. */
function bencode(value: unknown): Buffer {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (typeof value === 'string') return Buffer.concat([Buffer.from(`${Buffer.byteLength(value)}:`), Buffer.from(value)]);
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  const dict = value as Record<string, unknown>;
  const keys = Object.keys(dict).sort();
  return Buffer.concat([Buffer.from('d'), ...keys.flatMap((k) => [bencode(k), bencode(dict[k])]), Buffer.from('e')]);
}

const HASH = '0123456789abcdef0123456789abcdef01234567';
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=My%20Show&tr=udp%3A%2F%2Ftracker.example%3A1337`;

/** A real two-file torrent, so the metadata aria2 "saves" parses and matches its magnet. */
const SHOW_INFO = {
  name: 'My Show',
  'piece length': 16384,
  pieces: Buffer.alloc(20, 1),
  files: [
    { length: 2000, path: ['ep1.mkv'] },
    { length: 1000, path: ['notes.txt'] },
  ],
};
const SHOW_TORRENT = bencode({ info: SHOW_INFO });
const SHOW_HASH = createHash('sha1').update(bencode(SHOW_INFO)).digest('hex');
const SHOW_MAGNET = `magnet:?xt=urn:btih:${SHOW_HASH}&dn=My%20Show`;

/** aria2 scripted per gid: each tellStatus returns the next state, the last one repeats. */
class FakeAria2 implements Aria2Rpc {
  public calls: { method: string; params: unknown[] }[] = [];
  public statuses = new Map<string, Partial<Aria2Status>[]>();
  public files = new Map<string, Aria2File[]>();
  /** Gids handed out by addUri / addTorrent, in order (the last one repeats). */
  public addGids = ['gid-meta'];
  public onCall?: (method: string, params: unknown[]) => void;

  public async call<T>(method: string, params: unknown[] = []): Promise<T> {
    this.calls.push({ method, params });
    this.onCall?.(method, params);
    if (method === 'addUri' || method === 'addTorrent') return (this.addGids.length > 1 ? this.addGids.shift()! : this.addGids[0]) as T;
    if (method === 'forceRemove') this.statuses.set(params[0] as string, [{ status: 'removed' }]);
    if (method === 'tellStatus') {
      const seq = this.statuses.get(params[0] as string) ?? [{ status: 'removed' }];
      const next = seq.length > 1 ? seq.shift()! : seq[0];
      return { gid: params[0], totalLength: '0', completedLength: '0', uploadLength: '0', downloadSpeed: '0', uploadSpeed: '0', connections: '0', ...next } as T;
    }
    if (method === 'getFiles') return (this.files.get(params[0] as string) ?? []) as T;
    if (method === 'tellActive' || method === 'tellWaiting') return [] as T;
    return 'OK' as T;
  }

  public methods(): string[] {
    return this.calls.map((c) => c.method);
  }
}

function torrentItem(dir: string, overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 't1',
    kind: 'torrent',
    url: MAGNET,
    fileName: 'My Show',
    directory: dir,
    category: 'other',
    status: 'queued',
    totalBytes: null,
    receivedBytes: 0,
    speed: 0,
    eta: null,
    resumable: true,
    connections: 0,
    activeConnections: 0,
    retries: 0,
    createdAt: Date.now(),
    torrent: { infoHash: HASH, source: 'magnet', name: 'My Show' },
    ...overrides,
  };
}

/**
 * What real aria2 does with a magnet: fetch metadata (saving it as <hash>.torrent in the
 * metadata folder), create a paused download there, which we drop; then the re-added
 * .torrent runs in the final folder.
 */
function scriptMagnetRun(fake: FakeAria2, metadataDir: string, finalDir: string, saved: Buffer = SHOW_TORRENT) {
  mkdirSync(metadataDir, { recursive: true });
  writeFileSync(join(metadataDir, `${SHOW_HASH}.torrent`), saved);
  fake.addGids = ['gid-meta', 'gid-real'];
  fake.statuses.set('gid-meta', [
    { status: 'active', connections: '3' },
    { status: 'complete', followedBy: ['gid-paused'] },
  ]);
  fake.statuses.set('gid-paused', [{ status: 'paused', dir: metadataDir, bittorrent: { info: { name: 'My Show' } } }]);
  fake.statuses.set('gid-real', [
    { status: 'active', dir: finalDir, totalLength: '3000', completedLength: '1000', downloadSpeed: '500', connections: '7', numSeeders: '2', bittorrent: { info: { name: 'My Show' } } },
    { status: 'complete', dir: finalDir, totalLength: '3000', completedLength: '3000', bittorrent: { info: { name: 'My Show' } } },
  ]);
  const base = finalDir.replace(/\\/g, '/');
  fake.files.set('gid-real', [
    { index: '1', path: `${base}/My Show/ep1.mkv`, length: '2000', completedLength: '2000', selected: 'true' },
    { index: '2', path: `${base}/My Show/notes.txt`, length: '1000', completedLength: '1000', selected: 'true' },
  ]);
}

// ---------------------------------------------------------------- parsing

describe('magnet links', () => {
  it('reads hex and base32 info hashes, name and trackers', () => {
    expect(parseMagnet(MAGNET)).toEqual({ infoHash: HASH, name: 'My Show', trackers: ['udp://tracker.example:1337'] });
    // Base32 form of the same 20 bytes
    const base32 = 'AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH';
    expect(parseMagnet(`magnet:?xt=urn:btih:${base32}`)?.infoHash).toBe(HASH);
  });

  it('accepts v2 (btmh) hashes and rejects everything else', () => {
    const v2 = 'a'.repeat(64);
    expect(parseMagnet(`magnet:?xt=urn:btmh:1220${v2}`)?.infoHash).toBe(v2);
    for (const bad of ['https://example.com/x.torrent', 'magnet:?dn=only-a-name', 'magnet:?xt=urn:btih:xyz', `magnet:?xt=urn:sha1:${HASH}`, '']) {
      expect(parseMagnet(bad), bad).toBeNull();
    }
  });

  it('builds a magnet link back from a hash', () => {
    expect(parseMagnet(magnetFor(HASH, 'a b'))).toMatchObject({ infoHash: HASH, name: 'a b' });
  });
});

describe('.torrent files', () => {
  const pieces = Buffer.alloc(20, 7);

  it('reads a single-file torrent and computes its info hash', () => {
    const info = { length: 5, name: 'hello.txt', 'piece length': 16384, pieces };
    const file = bencode({ announce: 'http://tracker.example/announce', info });
    const meta = parseTorrentFile(file);
    expect(meta).toMatchObject({ name: 'hello.txt', totalBytes: 5, multiFile: false, trackers: ['http://tracker.example/announce'] });
    expect(meta.infoHash).toBe(createHash('sha1').update(bencode(info)).digest('hex'));
  });

  it('reads a multi-file torrent and keeps its paths inside the torrent folder', () => {
    const info = {
      name: '../Season 1',
      'piece length': 16384,
      pieces,
      files: [
        { length: 100, path: ['ep1.mkv'] },
        { length: 50, path: ['..', '..', 'evil.exe'] },
      ],
    };
    const meta = parseTorrentFile(bencode({ info }));
    expect(meta.multiFile).toBe(true);
    expect(meta.totalBytes).toBe(150);
    expect(meta.name).not.toContain('/');
    expect(meta.files.map((f) => f.path)).toEqual(['ep1.mkv', '_/_/evil.exe']);
  });

  it('rejects files that are not torrents', () => {
    for (const bad of [Buffer.from('not bencode'), bencode({ announce: 'x' }), bencode({ info: { name: 'x' } }), Buffer.alloc(0)]) {
      expect(() => parseTorrentFile(bad)).toThrow(/valid \.torrent/);
    }
  });
});

// ---------------------------------------------------------------- aria2

describe('aria2 launch options', () => {
  const base = {
    port: 6800,
    secret: 's3cret',
    stateDir: 'C:\\data\\aria2',
    settings: { ...DEFAULT_APP_SETTINGS.torrent },
    downloadLimitKBps: 0,
    proxy: '',
    parentPid: 42,
  };

  it('listens on loopback only, behind the secret, and exits with the app', () => {
    const args = buildAria2Args(base);
    expect(args).toContain('--rpc-listen-all=false');
    expect(args).toContain('--rpc-secret=s3cret');
    expect(args).toContain('--rpc-allow-origin-all=false');
    expect(args).toContain('--stop-with-process=42');
    expect(args).toContain('--pause-metadata=true');
    // No stray <sha1>.torrent copies in the user's download folder
    expect(args).toContain('--rpc-save-upload-metadata=false');
    expect(args.some((a) => a.startsWith('--all-proxy'))).toBe(false);
  });

  it('follows the DHT, upload limit and proxy settings', () => {
    const args = buildAria2Args({ ...base, settings: { ...base.settings, enableDht: false, maxUploadKBps: 50 }, proxy: 'http://p:8080' });
    expect(args).toContain('--enable-dht=false');
    expect(args).toContain('--bt-enable-lpd=false');
    expect(args).toContain('--max-overall-upload-limit=50K');
    expect(args).toContain('--all-proxy=http://p:8080');
  });

  it('stops at completion unless a seed ratio is set', () => {
    expect(seedOptions({ ...base.settings, seedRatio: 0 })).toEqual({ 'seed-time': '0' });
    expect(seedOptions({ ...base.settings, seedRatio: 1.5 })).toEqual({ 'seed-ratio': '1.5' });
  });

  it('maps aria2 error codes to the app codes', () => {
    expect(torrentErrorFor('9', 'no space').code).toBe('DISK_FULL');
    expect(torrentErrorFor('18', 'mkdir').code).toBe('ACCESS_DENIED');
    expect(torrentErrorFor('1', undefined).code).toBe('TORRENT_FAILED');
  });

  it('only passes select-file when some files are skipped', () => {
    const f = (selected?: boolean) => ({ path: 'x', length: 1, completedLength: 0, selected });
    expect(selectFileOption(undefined)).toBeNull();
    expect(selectFileOption([f(), f(true)])).toBeNull();
    expect(selectFileOption([f(true), f(false), f()])).toBe('1,3');
  });

  it('turns aria2 file paths into paths inside the torrent', () => {
    const { root, files } = describeFiles('C:\\dl\\Video', [
      { index: '1', path: 'C:/dl/Video/Show/a/ep1.mkv', length: '10', completedLength: '5', selected: 'true' },
      { index: '2', path: '[METADATA]abc', length: '1', completedLength: '0', selected: 'true' },
    ]);
    expect(root).toBe('Show');
    expect(files).toEqual([{ path: 'a/ep1.mkv', length: 10, completedLength: 5, selected: true }]);
  });
});

// ---------------------------------------------------------------- task

describe('TorrentDownloadTask', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'grabbit-torrent-task-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('fetches metadata privately, then downloads straight into the folder the manager chose', async () => {
    const fake = new FakeAria2();
    const metadataDir = join(dir, 'meta');
    const finalDir = join(dir, 'Video');
    scriptMagnetRun(fake, metadataDir, finalDir);
    const item = torrentItem(dir, { url: SHOW_MAGNET, torrent: { infoHash: SHOW_HASH, source: 'magnet', name: 'My Show' } });
    const onMetadata = vi.fn(async () => ({ directory: finalDir }));
    const progress: number[] = [];

    const task = new TorrentDownloadTask(item, {
      rpc: async () => fake,
      metadataDir, keepsSeeding: () => false,
      options: () => ({ 'seed-time': '0' }),
      onMetadata,
      onUpdate: () => progress.push(item.receivedBytes),
      pollMs: 1,
    });
    const result = await task.run(new AbortController().signal);

    // Metadata goes to the private folder, never the download folder
    expect(fake.calls[0]).toEqual({ method: 'addUri', params: [[SHOW_MAGNET], { dir: metadataDir, 'seed-time': '0', 'bt-save-metadata': 'true' }] });
    expect(onMetadata).toHaveBeenCalledWith({
      name: 'My Show',
      totalBytes: 3000,
      files: [
        { path: 'ep1.mkv', length: 2000, completedLength: 0 },
        { path: 'notes.txt', length: 1000, completedLength: 0 },
      ],
    });
    // aria2's placeholder is dropped; the saved .torrent is added in the chosen folder
    expect(fake.calls.find((c) => c.method === 'forceRemove')?.params).toEqual(['gid-paused']);
    const added = fake.calls.find((c) => c.method === 'addTorrent')!;
    expect(Buffer.from(added.params[0] as string, 'base64')).toEqual(SHOW_TORRENT);
    expect(added.params[2]).toEqual({ dir: finalDir, 'seed-time': '0' });
    expect(fake.methods()).not.toContain('changeOption');
    // Kept so a pause / resume never waits for metadata again
    expect(item.torrent?.torrentFile).toBe(join(metadataDir, `${SHOW_HASH}.torrent`));
    expect(item.directory).toBe(finalDir);
    expect(progress).toContain(1000);
    expect(item.receivedBytes).toBe(3000);
    expect(result.path).toBe(join(finalDir, 'My Show'));
  });

  it('refuses metadata that does not belong to the magnet link', async () => {
    const fake = new FakeAria2();
    const metadataDir = join(dir, 'meta');
    scriptMagnetRun(fake, metadataDir, dir, bencode({ info: { ...SHOW_INFO, name: 'Something else' } }));
    const item = torrentItem(dir, { url: SHOW_MAGNET, torrent: { infoHash: SHOW_HASH, source: 'magnet' } });
    const task = new TorrentDownloadTask(item, {
      rpc: async () => fake,
      metadataDir, keepsSeeding: () => false,
      options: () => ({}),
      onMetadata: async () => ({ directory: dir }),
      onUpdate: () => {},
      pollMs: 1,
    });
    await expect(task.run(new AbortController().signal)).rejects.toMatchObject({ code: 'TORRENT_INVALID' });
    expect(fake.methods()).not.toContain('addTorrent');
  });

  it('falls back to the torrent name when aria2 reports paths outside the folder', () => {
    const { root, files } = describeFiles('D:\\Elsewhere', [
      { index: '1', path: 'C:/dl/My Show/ep1.mkv', length: '10', completedLength: '0', selected: 'true' },
    ]);
    expect(root).toBeNull();
    expect(files[0].path).toBe('ep1.mkv');
  });

  it('shows "Fetching metadata" rather than the metadata bytes as progress', async () => {
    const fake = new FakeAria2();
    fake.statuses.set('gid-meta', [{ status: 'active', connections: '4', totalLength: '9000', completedLength: '9000' }]);
    const item = torrentItem(dir);
    const controller = new AbortController();
    const task = new TorrentDownloadTask(item, {
      rpc: async () => fake,
      metadataDir: dir, keepsSeeding: () => false,
      options: () => ({}),
      onMetadata: async () => ({ directory: dir }),
      onUpdate: () => {
        if (item.torrent?.stage === 'Fetching metadata') controller.abort();
      },
      pollMs: 1,
    });
    await expect(task.run(controller.signal)).rejects.toBeInstanceOf(JobCancelledError);
    expect(item.status).toBe('starting');
    expect(item.receivedBytes).toBe(0);
  });

  it('removes the torrent from aria2 (keeping its files) when paused', async () => {
    const fake = new FakeAria2();
    fake.addGids = ['gid-real'];
    fake.statuses.set('gid-real', [
      { status: 'active', totalLength: '3000', completedLength: '10', bittorrent: { info: { name: 'My Show' } } },
    ]);
    const controller = new AbortController();
    fake.onCall = (method) => {
      if (method === 'getFiles') controller.abort();
      if (method === 'forceRemove') fake.statuses.set('gid-real', [{ status: 'removed' }]);
    };
    const task = new TorrentDownloadTask(torrentItem(dir), {
      rpc: async () => fake,
      metadataDir: dir, keepsSeeding: () => false,
      options: () => ({}),
      onMetadata: async () => ({ directory: dir }),
      onUpdate: () => {},
      pollMs: 1,
    });
    await expect(task.run(controller.signal)).rejects.toBeInstanceOf(JobCancelledError);
    expect(fake.methods()).toContain('forceRemove');
    expect(fake.methods()).toContain('removeDownloadResult');
    expect(fake.methods()).not.toContain('remove');
  });

  it('waits for aria2 to stop a finished torrent unless seeding was asked for', async () => {
    const run = async (keepsSeeding: boolean) => {
      const fake = new FakeAria2();
      fake.addGids = ['gid-real'];
      const done = { totalLength: '100', completedLength: '100', bittorrent: { info: { name: 'My Show' } } };
      // aria2 says "seeder" for a moment before it notices seeding is off and completes
      fake.statuses.set('gid-real', [{ status: 'active', seeder: 'true', ...done }, { status: 'complete', ...done }]);
      const onSeeding = vi.fn();
      const result = await new TorrentDownloadTask(torrentItem(dir, { torrent: { infoHash: HASH, source: 'magnet', torrentFile: undefined } }), {
        rpc: async () => fake,
        metadataDir: dir,
        keepsSeeding: () => keepsSeeding,
        options: () => ({}),
        onMetadata: async () => ({ directory: dir }),
        onSeeding,
        onUpdate: () => {},
        pollMs: 1,
      }).run(new AbortController().signal);
      return { result, onSeeding, fake };
    };

    const off = await run(false);
    expect(off.result.seeding).toBe(false);
    expect(off.onSeeding).not.toHaveBeenCalled();
    expect(off.fake.methods()).toContain('removeDownloadResult');

    const on = await run(true);
    expect(on.result.seeding).toBe(true);
    expect(on.onSeeding).toHaveBeenCalledWith('gid-real');
  });

  it('reports aria2 failures with the matching error code', async () => {
    const fake = new FakeAria2();
    fake.addGids = ['gid-real'];
    fake.statuses.set('gid-real', [{ status: 'error', errorCode: '9', errorMessage: 'Not enough disk space' }]);
    const task = new TorrentDownloadTask(torrentItem(dir), {
      rpc: async () => fake,
      metadataDir: dir, keepsSeeding: () => false,
      options: () => ({}),
      onMetadata: async () => ({ directory: dir }),
      onUpdate: () => {},
      pollMs: 1,
    });
    await expect(task.run(new AbortController().signal)).rejects.toMatchObject({ code: 'DISK_FULL' });
  });

  it('adds .torrent files from the saved copy', async () => {
    const copy = join(dir, 'copy.torrent');
    writeFileSync(copy, 'd4:infod4:name1:xee');
    const fake = new FakeAria2();
    fake.addGids = ['gid-real'];
    fake.statuses.set('gid-real', [{ status: 'complete', totalLength: '1', completedLength: '1', bittorrent: { info: { name: 'x' } } }]);
    const item = torrentItem(dir, { torrent: { infoHash: HASH, source: 'file', torrentFile: copy, name: 'x' } });
    await new TorrentDownloadTask(item, { rpc: async () => fake, metadataDir: dir, keepsSeeding: () => false, options: () => ({}), onMetadata: async () => ({ directory: dir }), onUpdate: () => {}, pollMs: 1 }).run(
      new AbortController().signal
    );
    expect(fake.calls[0].method).toBe('addTorrent');
    expect(Buffer.from(fake.calls[0].params[0] as string, 'base64').toString()).toBe('d4:infod4:name1:xee');
  });
});

// ---------------------------------------------------------------- manager

describe('DownloadManager torrents', () => {
  let dir: string;
  let settings: AppSettings;
  let manager: DownloadManager;
  let fake: FakeAria2;
  let askedToChoose: string[];
  let patches: DownloadProgressPatch[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'grabbit-torrent-mgr-'));
    settings = { ...DEFAULT_APP_SETTINGS, downloadDir: dir, categorySubfolders: true };
    fake = new FakeAria2();
    askedToChoose = [];
    patches = [];
    trashItem.mockClear();
    manager = new DownloadManager({
      dataDir: join(dir, 'data'),
      tempRoot: join(dir, 'temp'),
      router: {} as any,
      torrent: { rpc: async () => fake, options: () => ({ 'seed-time': '0' }) },
      getSettings: () => settings,
      onItemsChanged: () => {},
      onItemsRemoved: () => {},
      onOrderChanged: () => {},
      onCompleted: () => {},
      onFailed: () => {},
      onNeedsSelection: (item) => askedToChoose.push(item.id),
      onItemsProgress: (p) => patches.push(...p),
      onQueueDrained: () => {},
      onAggregateProgress: () => {},
    });
    manager.init();
  });

  afterEach(() => {
    manager.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it('downloads a magnet link into the folder for its content, creating no guessed folder', async () => {
    const videoDir = join(dir, 'Video');
    scriptMagnetRun(fake, join(dir, 'data', 'torrents'), videoDir);
    const [item] = await manager.addTorrent([{ magnet: SHOW_MAGNET }]);
    expect(item).toMatchObject({ kind: 'torrent', fileName: 'My Show', directory: join(dir, 'Other'), torrent: { infoHash: SHOW_HASH, source: 'magnet' } });

    await vi.waitFor(() => expect(manager.get(item.id)?.status).toBe('completed'), { timeout: 5000, interval: 10 });
    const done = manager.get(item.id)!;
    // The biggest file is a video, so it went to Video, not Other
    expect(done.category).toBe('video');
    expect(done.directory).toBe(videoDir);
    expect(done.filePath).toBe(join(videoDir, 'My Show'));
    expect(done.torrent?.files?.length).toBe(2);
    expect(fake.calls.find((c) => c.method === 'addTorrent')?.params[2]).toMatchObject({ dir: videoDir });
    // The first guess ("Other") was never created on disk
    expect(existsSync(join(dir, 'Other'))).toBe(false);
  });

  it('refuses a torrent that is already downloading, and malformed links', async () => {
    await manager.addTorrent([{ magnet: MAGNET, startPaused: true }]);
    // The same torrent, written with an uppercase hash and no name
    await expect(manager.addTorrent([{ magnet: `magnet:?xt=urn:btih:${HASH.toUpperCase()}` }])).rejects.toMatchObject({ code: 'TORRENT_DUPLICATE' });
    await expect(manager.addTorrent([{ magnet: 'magnet:?dn=nothing' }])).rejects.toMatchObject({ code: 'TORRENT_INVALID' });
    const preview = await manager.inspectTorrent({ magnet: MAGNET });
    expect(preview.existingId).toBeDefined();
  });

  it('keeps its own copy of a .torrent file and never writes over an existing folder', async () => {
    const info = { name: 'Album', 'piece length': 16384, pieces: Buffer.alloc(20), files: [{ length: 10, path: ['01.flac'] }] };
    const src = join(dir, 'album.torrent');
    writeFileSync(src, bencode({ info }));
    // Something unrelated already uses the name in the Music folder
    mkdirSync(join(dir, 'Music', 'Album'), { recursive: true });

    const preview = await manager.inspectTorrent({ torrentPath: src });
    expect(preview).toMatchObject({ name: 'Album', totalBytes: 10, fileCount: 1 });

    const [item] = await manager.addTorrent([{ torrentPath: src, startPaused: true }]);
    expect(item.category).toBe('music');
    expect(item.directory).toBe(join(dir, 'Music', 'Album (1)'));
    expect(item.torrent?.torrentFile).toBe(join(dir, 'data', 'torrents', `${item.torrent?.infoHash}.torrent`));
    expect(readFileSync(item.torrent!.torrentFile!)).toEqual(readFileSync(src));
  });

  it('moves partial data to the Recycle Bin when an unfinished torrent is removed', async () => {
    const [item] = await manager.addTorrent([{ magnet: MAGNET, startPaused: true }]);
    const root = join(item.directory, 'My Show');
    mkdirSync(root, { recursive: true });
    writeFileSync(`${root}.aria2`, 'resume');
    await manager.remove([item.id], false);
    expect(trashItem).toHaveBeenCalledWith(root);
    expect(existsSync(`${root}.aria2`)).toBe(false);
  });

  it('leaves a folder alone when it holds no partial download of this torrent', async () => {
    const [item] = await manager.addTorrent([{ magnet: MAGNET, startPaused: true }]);
    mkdirSync(join(item.directory, 'My Show'), { recursive: true });
    await manager.remove([item.id], false);
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('downloads only the files chosen when adding a .torrent', async () => {
    const src = join(dir, 'show.torrent');
    writeFileSync(src, SHOW_TORRENT);
    const [item] = await manager.addTorrent([{ torrentPath: src, selectedFiles: [1], startPaused: true }]);
    expect(item.torrent?.files?.map((f) => f.selected)).toEqual([false, true]);
    // Filed by the chosen file (notes.txt), not the skipped video
    expect(item.category).toBe('documents');
    // Size and progress follow what was chosen, not the whole torrent
    expect(item.totalBytes).toBe(1000);

    await expect(manager.addTorrent([{ torrentPath: src, selectedFiles: [5] }])).rejects.toMatchObject({ code: 'TORRENT_DUPLICATE' });
    await manager.remove([item.id], false);
    await expect(manager.addTorrent([{ torrentPath: src, selectedFiles: [5] }])).rejects.toMatchObject({ code: 'TORRENT_INVALID' });
  });

  it('passes the selection to aria2 and can change it later', async () => {
    const src = join(dir, 'show.torrent');
    writeFileSync(src, SHOW_TORRENT);
    const [item] = await manager.addTorrent([{ torrentPath: src, selectedFiles: [0], startPaused: true }]);
    const updated = await manager.setTorrentFiles(item.id, [0, 1]);
    expect(updated.totalBytes).toBe(3000);
    expect(updated.torrent?.files?.every((f) => f.selected)).toBe(true);
    await expect(manager.setTorrentFiles(item.id, [])).rejects.toThrow();
    await expect(manager.setTorrentFiles(item.id, [9])).rejects.toMatchObject({ code: 'TORRENT_INVALID' });

    await manager.setTorrentFiles(item.id, [1]);
    // A boundary piece left a fragment of the skipped video on disk
    const root = join(item.directory, 'My Show');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'ep1.mkv'), Buffer.alloc(64));
    writeFileSync(join(root, 'notes.txt'), 'wanted');
    writeFileSync(`${root}.aria2`, 'resume');
    fake.addGids = ['gid-real'];
    fake.statuses.set('gid-real', [{ status: 'complete', totalLength: '1000', completedLength: '1000', bittorrent: { info: { name: 'My Show' } } }]);
    manager.resume([item.id]);
    await vi.waitFor(() => expect(manager.get(item.id)?.status).toBe('completed'), { timeout: 5000, interval: 10 });
    expect(fake.calls.find((c) => c.method === 'addTorrent')?.params[2]).toMatchObject({ 'select-file': '2' });
    // The fragment of the skipped file is gone; the chosen file stays
    expect(existsSync(join(root, 'ep1.mkv'))).toBe(false);
    expect(readFileSync(join(root, 'notes.txt'), 'utf8')).toBe('wanted');
    // aria2 keeps its resume file after a partial download; the app removes it
    expect(existsSync(`${root}.aria2`)).toBe(false);
  });

  it('pauses a magnet to ask which files to download, then downloads only those', async () => {
    const videoDir = join(dir, 'Video');
    scriptMagnetRun(fake, join(dir, 'data', 'torrents'), videoDir);
    const [item] = await manager.addTorrent([{ magnet: SHOW_MAGNET, pickFiles: true }]);

    // Metadata arrives, then it stops and asks, before any content is added to aria2
    await vi.waitFor(() => expect(manager.get(item.id)?.status).toBe('paused'), { timeout: 5000, interval: 10 });
    const waiting = manager.get(item.id)!;
    expect(waiting.torrent?.needsSelection).toBe(true);
    expect(waiting.torrent?.files?.map((f) => f.path)).toEqual(['ep1.mkv', 'notes.txt']);
    expect(askedToChoose).toEqual([item.id]);
    expect(fake.methods()).not.toContain('addTorrent');
    expect(existsSync(videoDir)).toBe(false);

    // "Resume all" and starting the queue leave it waiting for the choice
    manager.resumeAll();
    manager.startQueue('main');
    expect(manager.get(item.id)?.status).toBe('paused');

    await manager.setTorrentFiles(item.id, [0]);
    manager.resume([item.id]);
    await vi.waitFor(() => expect(manager.get(item.id)?.status).toBe('completed'), { timeout: 5000, interval: 10 });
    const added = fake.calls.find((c) => c.method === 'addTorrent')!;
    expect(added.params[2]).toMatchObject({ dir: videoDir, 'select-file': '1' });
    expect(manager.get(item.id)?.torrent?.needsSelection).toBe(false);
  });

  it('sends per-file progress only for the torrent whose details are open', async () => {
    const src = join(dir, 'show.torrent');
    writeFileSync(src, SHOW_TORRENT);
    const [item] = await manager.addTorrent([{ torrentPath: src, startPaused: true }]);
    await new Promise((r) => setTimeout(r, 300));
    patches.length = 0;

    manager.watchSegments([item.id]);
    await vi.waitFor(() => expect(patches.some((p) => p.id === item.id)).toBe(true), { timeout: 2000, interval: 10 });
    expect(patches.find((p) => p.id === item.id)?.torrent?.files?.length).toBe(2);

    manager.watchSegments([]);
    patches.length = 0;
    manager.setSpeedLimit(item.id, 0);
    (manager as any).progressDirty.add(item.id);
    (manager as any).scheduleFlush();
    await new Promise((r) => setTimeout(r, 400));
    for (const p of patches.filter((p) => p.id === item.id)) expect(p.torrent && 'files' in p.torrent).toBe(false);
  });
});
