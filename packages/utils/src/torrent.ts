/**
 * Magnet links and .torrent files: just enough parsing to validate them, name them and
 * de-duplicate them before the torrent engine (aria2) takes over.
 */
import { sha1Hex } from './index';

export interface MagnetInfo {
  /** Lowercase hex info hash (40 chars for v1, 64 for a v2 btmh hash). */
  infoHash: string;
  /** Display name (dn), when the link has one. */
  name?: string;
  trackers: string[];
}

export interface TorrentFileEntry {
  /** Path inside the torrent, with '/' separators (the torrent name is not included). */
  path: string;
  length: number;
}

export interface TorrentMetadata {
  infoHash: string;
  /** Root name: the single file's name, or the folder holding a multi-file torrent. */
  name: string;
  totalBytes: number;
  files: TorrentFileEntry[];
  /** True when the torrent holds several files inside a folder named `name`. */
  multiFile: boolean;
  trackers: string[];
}

/** Largest .torrent file we read. Real ones are a few hundred KB at most. */
export const MAX_TORRENT_FILE_BYTES = 10 * 1024 * 1024;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToHex(input: string): string | null {
  let bits = '';
  for (const ch of input.toUpperCase()) {
    const v = BASE32.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function isMagnetLink(text: string): boolean {
  return parseMagnet(text) !== null;
}

/** Parses a magnet URI, or returns null when it is not a usable BitTorrent magnet link. */
export function parseMagnet(text: string): MagnetInfo | null {
  const raw = text.trim();
  if (!/^magnet:\?/i.test(raw) || raw.length > 16_384) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw.slice(raw.indexOf('?') + 1));
  } catch {
    return null;
  }
  let infoHash: string | null = null;
  for (const xt of params.getAll('xt')) {
    const v1 = /^urn:btih:([0-9a-f]{40}|[a-z2-7]{32})$/i.exec(xt.trim());
    if (v1) {
      infoHash = v1[1].length === 40 ? v1[1].toLowerCase() : base32ToHex(v1[1]);
      if (infoHash) break;
    }
    const v2 = /^urn:btmh:1220([0-9a-f]{64})$/i.exec(xt.trim());
    if (v2) {
      infoHash = v2[1].toLowerCase();
      break;
    }
  }
  if (!infoHash) return null;
  const name = params.get('dn')?.trim() || undefined;
  const trackers = params.getAll('tr').map((t) => t.trim()).filter(Boolean);
  return { infoHash, name, trackers };
}

/** A minimal magnet link for an info hash, so every torrent has a link to copy. */
export function magnetFor(infoHash: string, name?: string): string {
  return `magnet:?xt=urn:btih:${infoHash}${name ? `&dn=${encodeURIComponent(name)}` : ''}`;
}

// ---------------------------------------------------------------------------
// Bencode (BEP 3)
// ---------------------------------------------------------------------------

type BValue = number | Uint8Array | BValue[] | BDict;
interface BDict {
  [key: string]: BValue;
}

class BencodeError extends Error {}

const utf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * Decodes bencode and also reports where the top-level `info` dictionary sits in the input,
 * because the info hash is the SHA-1 of exactly those bytes.
 */
function decodeTorrent(bytes: Uint8Array): { root: BDict; infoStart: number; infoEnd: number } {
  let pos = 0;
  let infoStart = -1;
  let infoEnd = -1;

  const fail = (msg: string): never => {
    throw new BencodeError(`Not a valid .torrent file (${msg} at byte ${pos})`);
  };

  const readInt = (terminator: number): number => {
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== terminator) pos++;
    if (pos >= bytes.length) fail('unterminated number');
    const text = utf8.decode(bytes.subarray(start, pos));
    if (!/^-?\d+$/.test(text)) fail('bad number');
    pos++;
    const n = Number(text);
    if (!Number.isSafeInteger(n)) fail('number too large');
    return n;
  };

  const decode = (depth: number, topLevelKey?: string): BValue => {
    if (depth > 64) fail('nesting too deep');
    if (pos >= bytes.length) fail('unexpected end');
    const c = bytes[pos];
    if (c === 0x69 /* i */) {
      pos++;
      return readInt(0x65 /* e */);
    }
    if (c === 0x6c /* l */) {
      pos++;
      const list: BValue[] = [];
      while (bytes[pos] !== 0x65) {
        list.push(decode(depth + 1));
        if (list.length > 1_000_000) fail('list too long');
      }
      pos++;
      return list;
    }
    if (c === 0x64 /* d */) {
      const start = pos;
      pos++;
      const dict: BDict = {};
      while (bytes[pos] !== 0x65) {
        const keyBytes = decode(depth + 1);
        if (!(keyBytes instanceof Uint8Array)) fail('dictionary key is not a string');
        const key = utf8.decode(keyBytes as Uint8Array);
        dict[key] = decode(depth + 1, depth === 0 ? key : undefined);
      }
      pos++;
      if (topLevelKey === 'info') {
        infoStart = start;
        infoEnd = pos;
      }
      return dict;
    }
    if (c >= 0x30 && c <= 0x39) {
      const len = readInt(0x3a /* : */);
      if (len < 0 || pos + len > bytes.length) fail('string runs past the end');
      const out = bytes.subarray(pos, pos + len);
      pos += len;
      return out;
    }
    return fail('unexpected byte');
  };

  const root = decode(0);
  if (typeof root !== 'object' || root instanceof Uint8Array || Array.isArray(root)) fail('top level is not a dictionary');
  return { root: root as BDict, infoStart, infoEnd };
}

function text(value: BValue | undefined): string | undefined {
  return value instanceof Uint8Array ? utf8.decode(value) : undefined;
}

function cleanSegment(segment: string): string {
  // Never let a torrent's own paths climb out of the download folder
  return segment.replace(/[\\/]/g, '_').replace(/^\.+$/, '_');
}

/** Reads a .torrent file's name, size, file list and info hash. Throws on anything malformed. */
export function parseTorrentFile(bytes: Uint8Array): TorrentMetadata {
  if (bytes.length === 0 || bytes.length > MAX_TORRENT_FILE_BYTES) {
    throw new BencodeError('Not a valid .torrent file (empty or too large)');
  }
  const { root, infoStart, infoEnd } = decodeTorrent(bytes);
  const info = root.info;
  if (!info || typeof info !== 'object' || info instanceof Uint8Array || Array.isArray(info) || infoStart < 0) {
    throw new BencodeError('Not a valid .torrent file (no info dictionary)');
  }

  const name = cleanSegment(text(info['name.utf-8']) ?? text(info.name) ?? '').trim();
  if (!name) throw new BencodeError('Not a valid .torrent file (no name)');

  const files: TorrentFileEntry[] = [];
  let multiFile = false;
  if (typeof info.length === 'number') {
    files.push({ path: name, length: info.length });
  } else if (Array.isArray(info.files)) {
    multiFile = true;
    for (const entry of info.files) {
      if (typeof entry !== 'object' || entry instanceof Uint8Array || Array.isArray(entry)) continue;
      const parts = (entry['path.utf-8'] ?? entry.path) as BValue;
      const length = entry.length;
      if (!Array.isArray(parts) || typeof length !== 'number') continue;
      const path = parts.map((p) => cleanSegment(text(p) ?? '')).filter(Boolean).join('/');
      if (path) files.push({ path, length });
    }
    if (files.length === 0) throw new BencodeError('Not a valid .torrent file (no files)');
  } else {
    throw new BencodeError('Not a valid .torrent file (no length or files)');
  }

  const trackers = new Set<string>();
  const announce = text(root.announce);
  if (announce) trackers.add(announce);
  if (Array.isArray(root['announce-list'])) {
    for (const tier of root['announce-list']) {
      if (Array.isArray(tier)) for (const t of tier) if (text(t)) trackers.add(text(t)!);
    }
  }

  return {
    infoHash: sha1Hex(bytes.subarray(infoStart, infoEnd)),
    name,
    totalBytes: files.reduce((sum, f) => sum + f.length, 0),
    files,
    multiFile,
    trackers: [...trackers],
  };
}
