import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from './logger';

/**
 * A JSON document on disk with atomic (write temp + rename) and debounced saves.
 * This is the app's whole "database": no server, no native modules.
 */
export class JsonStore<T> {
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private pending: (() => T) | null = null;
  private writes = 0;
  /** Set by saveSync: async writes that have not reached the rename yet must not overwrite it. */
  private generation = 0;

  constructor(
    private readonly path: string,
    private readonly debounceMs = 1000
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }

  /**
   * Reads the document, falling back to the previous version (`.bak`) and then to `fallback`.
   * `accept` can reject a file that parses but has the wrong shape (e.g. an object where a
   * list is expected), so a damaged file does not take the backup's place.
   */
  public load(fallback: T, accept: (value: unknown) => boolean = () => true): T {
    for (const candidate of [this.path, `${this.path}.bak`]) {
      if (!existsSync(candidate)) continue;
      try {
        const value: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
        if (accept(value)) return value as T;
        logger.warn({ candidate }, 'Store file has an unexpected shape');
      } catch (err) {
        logger.warn({ err, candidate }, 'Store file unreadable');
      }
    }
    return fallback;
  }

  /** Schedules a save; `snapshot` is called when the write actually happens. */
  public save(snapshot: () => T): void {
    this.pending = snapshot;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const take = this.pending;
      this.pending = null;
      if (!take) return;
      const json = JSON.stringify(take());
      const generation = this.generation;
      this.writing = this.writing
        .then(() => this.writeAsync(json, generation))
        .catch((err) => logger.error({ err }, 'Store save failed'));
    }, this.debounceMs);
  }

  /** Every write gets its own temp file, so two writes can never share one. */
  private tempPath(): string {
    return `${this.path}.${process.pid}.${++this.writes}.tmp`;
  }

  private async writeAsync(json: string, generation: number): Promise<void> {
    const tmp = this.tempPath();
    try {
      const handle = await open(tmp, 'w');
      try {
        await handle.writeFile(json, 'utf8');
        // On disk before the rename, so a power cut cannot leave an empty file under the real name
        await handle.sync();
      } finally {
        await handle.close();
      }
      // A synchronous save happened meanwhile and is newer than this snapshot
      if (generation !== this.generation) return;
      // The swap itself is synchronous (two quick renames), so saveSync can never run in the middle of it
      this.swapIn(tmp);
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  /** Immediate synchronous save (app shutdown). Supersedes any save still in flight. */
  public saveSync(value: T): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.generation++;
    const tmp = this.tempPath();
    try {
      const fd = openSync(tmp, 'w');
      try {
        writeSync(fd, JSON.stringify(value), null, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.swapIn(tmp);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /** Replaces the document with a finished temp file, keeping the old version as `.bak`. */
  private swapIn(tmp: string): void {
    if (existsSync(this.path)) {
      try {
        renameSync(this.path, `${this.path}.bak`);
      } catch {
        // keep going
      }
    }
    renameSync(tmp, this.path);
  }
}
