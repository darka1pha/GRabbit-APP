import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
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

  constructor(
    private readonly path: string,
    private readonly debounceMs = 1000
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }

  public load(fallback: T): T {
    for (const candidate of [this.path, `${this.path}.bak`]) {
      if (!existsSync(candidate)) continue;
      try {
        return JSON.parse(readFileSync(candidate, 'utf8')) as T;
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
      this.writing = this.writing.then(() => this.writeAsync(json)).catch((err) => logger.error({ err }, 'Store save failed'));
    }, this.debounceMs);
  }

  private async writeAsync(json: string): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, json, 'utf8');
    if (existsSync(this.path)) {
      try {
        await rename(this.path, `${this.path}.bak`);
      } catch {
        // keep going
      }
    }
    await rename(tmp, this.path);
  }

  /** Immediate synchronous save (app shutdown). */
  public saveSync(value: T): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value), 'utf8');
    renameSync(tmp, this.path);
  }
}
