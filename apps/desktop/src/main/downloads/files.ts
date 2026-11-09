import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChecksumAlgorithm } from '../../shared/types';
import { splitExtension } from '../media/filename';

/** "file.zip" → "file (1).zip" ... until neither the file nor a reserved name exists. */
export function uniqueFileName(directory: string, fileName: string, reserved: Set<string> = new Set()): string {
  const taken = (name: string) =>
    reserved.has(name.toLowerCase()) || existsSync(join(directory, name)) || existsSync(join(directory, `${name}.gdownload`));
  if (!taken(fileName)) return fileName;
  const { base, ext } = splitExtension(fileName);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** rename(), falling back to copy + delete across drives. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

export function hashFile(path: string, algorithm: ChecksumAlgorithm, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path, { highWaterMark: 4 * 1024 * 1024, signal });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** Guesses the algorithm from the length of a hex digest. */
export function algorithmForDigest(digest: string): ChecksumAlgorithm | null {
  const clean = digest.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean)) return null;
  return ({ 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' } as const)[clean.length as 32] ?? null;
}
