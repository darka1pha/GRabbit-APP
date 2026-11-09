import { PlatformMetadata } from '../../core/types/platform.js';
import { getRedisConnection } from '../../queue/redis.js';

export interface CachedMediaPreview {
  url: string;
  platform: string;
  metadata: PlatformMetadata;
  createdAt: number;
  /** User who opened this menu; other users in a group can't use its buttons. */
  ownerId?: number;
  /** Search sessions: the query and the per-result preview keys, in result order. */
  query?: string;
  itemKeys?: string[];
  /** Collections (albums/playlists): ids of tracks already queued via "Download all". */
  queuedIds?: string[];
}

const REDIS_PREFIX = 'grabbit:preview:';

export class PreviewCache {
  private cache = new Map<string, CachedMediaPreview>();
  private ttlMs = 15 * 60 * 1000; // 15 minutes
  private ttlSeconds = 15 * 60;

  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.cache.entries()) {
        if (now - val.createdAt > this.ttlMs) {
          this.cache.delete(key);
        }
      }
    }, 60000).unref();
  }

  public set(key: string, data: Omit<CachedMediaPreview, 'createdAt'>): void {
    const entry: CachedMediaPreview = { ...data, createdAt: Date.now() };
    this.cache.set(key, entry);

    if (process.env.NODE_ENV !== 'test') {
      try {
        const redis = getRedisConnection();
        if (redis.status === 'ready') {
          redis
            .set(`${REDIS_PREFIX}${key}`, JSON.stringify(entry), 'EX', this.ttlSeconds)
            .catch(() => {});
        }
      } catch {}
    }
  }

  public get(key: string): CachedMediaPreview | undefined {
    return this.cache.get(key);
  }

  public async getAsync(key: string): Promise<CachedMediaPreview | undefined> {
    const mem = this.cache.get(key);
    if (mem) return mem;

    if (process.env.NODE_ENV !== 'test') {
      try {
        const redis = getRedisConnection();
        if (redis.status === 'ready') {
          const raw = await redis.get(`${REDIS_PREFIX}${key}`);
          if (raw) {
            const parsed = JSON.parse(raw) as CachedMediaPreview;
            this.cache.set(key, parsed);
            return parsed;
          }
        }
      } catch {}
    }

    return undefined;
  }

  public delete(key: string): void {
    this.cache.delete(key);
    if (process.env.NODE_ENV !== 'test') {
      try {
        const redis = getRedisConnection();
        if (redis.status === 'ready') {
          redis.del(`${REDIS_PREFIX}${key}`).catch(() => {});
        }
      } catch {}
    }
  }
}

export const previewCache = new PreviewCache();
