// Pure helpers for torrent downloads: reading .torrent files, choosing files and a category.
// The download manager keeps the stateful parts (finding duplicates, placing folders).
import { readFile, stat } from 'node:fs/promises';
import { MAX_TORRENT_FILE_BYTES, parseTorrentFile, type TorrentMetadata } from '@grabbit/utils';
import type { Category } from '../../shared/types';
import { TorrentError } from '../media/errors';
import { categoryForFileName } from './categories';

/** Reads a .torrent file, refusing anything too large to be one. */
export async function readTorrentFile(path: string): Promise<{ bytes: Buffer; meta: TorrentMetadata }> {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new TorrentError('The .torrent file could not be found', 'TORRENT_INVALID');
  }
  if (!info.isFile() || info.size > MAX_TORRENT_FILE_BYTES) {
    throw new TorrentError('That is not a .torrent file', 'TORRENT_INVALID');
  }
  const bytes = await readFile(path);
  try {
    return { bytes, meta: parseTorrentFile(bytes) };
  } catch (err) {
    throw new TorrentError(err instanceof Error ? err.message : 'Not a valid .torrent file', 'TORRENT_INVALID');
  }
}

/** Category from the torrent's biggest file (a season of episodes is video, not "other"). */
export function categoryForTorrent(name: string, files: { path: string; length: number }[]): Category {
  const biggest = [...files].sort((a, b) => b.length - a.length)[0];
  const byFile = biggest ? categoryForFileName(biggest.path) : 'other';
  return byFile !== 'other' ? byFile : categoryForFileName(name);
}

/**
 * Marks which files to download. Returns them, or throws when the indices do not fit the
 * torrent or select nothing.
 */
export function applySelection<T extends { length: number }>(
  files: T[],
  indices: number[] | undefined
): (T & { selected: boolean })[] {
  const wanted = indices ? new Set(indices) : null;
  if (wanted && ([...wanted].some((i) => i >= files.length) || wanted.size === 0)) {
    throw new TorrentError('That file selection does not match this torrent', 'TORRENT_INVALID');
  }
  return files.map((f, i) => ({ ...f, selected: !wanted || wanted.has(i) }));
}

/** Bytes the user actually asked for. */
export function selectedBytes(files: { length: number; selected?: boolean }[]): number {
  return files.reduce((sum, f) => sum + (f.selected !== false ? f.length : 0), 0);
}
