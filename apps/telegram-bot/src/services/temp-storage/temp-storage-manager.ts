import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getConfig } from '../../config/env.js';
import { logger } from '../../observability/logger.js';

export class TempStorageManager {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolve(process.cwd(), baseDir || getConfig().TEMP_DIR);
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  public getJobDirectory(jobId: string): string {
    return join(this.baseDir, jobId);
  }

  public createJobDirectory(jobId: string): string {
    const jobDir = this.getJobDirectory(jobId);
    if (!existsSync(jobDir)) {
      mkdirSync(jobDir, { recursive: true });
    }
    return jobDir;
  }

  public cleanupJobDirectory(jobId: string): void {
    const jobDir = this.getJobDirectory(jobId);
    try {
      if (existsSync(jobDir)) {
        rmSync(jobDir, { recursive: true, force: true });
        logger.debug({ jobId, jobDir }, 'Cleaned up job temporary directory');
      }
    } catch (err) {
      logger.warn({ err, jobId, jobDir }, 'Failed to clean up job directory');
    }
  }

  public cleanupStaleDirectories(ttlMinutes = 30): void {
    try {
      const now = Date.now();
      const ttlMs = ttlMinutes * 60 * 1000;

      const entries = readdirSync(this.baseDir);
      for (const entry of entries) {
        const fullPath = join(this.baseDir, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory() && now - stats.mtimeMs > ttlMs) {
          rmSync(fullPath, { recursive: true, force: true });
          logger.info({ path: fullPath }, 'Purged expired temporary directory');
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error during stale temp file cleanup');
    }
  }
}
