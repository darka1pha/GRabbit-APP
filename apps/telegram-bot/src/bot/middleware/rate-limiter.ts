import { NextFunction } from 'grammy';
import { Redis } from 'ioredis';
import { BotContext } from '../context.js';
import { RateLimitExceededError } from '../../core/errors/domain-errors.js';
import { logger } from '../../observability/logger.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/** Counts a user's requests in the current window; returns the count and ms until reset. */
export interface RateLimitStore {
  hit(userId: number, windowMs: number): Promise<{ count: number; resetInMs: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<number, RateLimitEntry>();

  constructor() {
    // Periodic cleanup of expired entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [userId, entry] of this.entries.entries()) {
        if (now > entry.resetAt) {
          this.entries.delete(userId);
        }
      }
    }, 300000).unref();
  }

  public async hit(userId: number, windowMs: number) {
    const now = Date.now();
    let entry = this.entries.get(userId);

    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + windowMs };
      this.entries.set(userId, entry);
    } else {
      entry.count++;
    }

    return { count: entry.count, resetInMs: entry.resetAt - now };
  }
}

// INCR the counter and start its expiry on the first hit, atomically
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

/**
 * Shared across bot processes and survives restarts. Falls back to in-memory counting
 * while Redis isn't ready, so a Redis outage never blocks or crashes the bot.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private fallback = new MemoryRateLimitStore();

  constructor(
    private redis: Pick<Redis, 'status' | 'eval'>,
    private keyPrefix = 'grabbit:ratelimit:'
  ) {}

  public async hit(userId: number, windowMs: number) {
    if (this.redis.status !== 'ready') {
      return this.fallback.hit(userId, windowMs);
    }
    try {
      const [count, ttl] = (await this.redis.eval(
        HIT_SCRIPT,
        1,
        `${this.keyPrefix}${userId}`,
        String(windowMs)
      )) as [number, number];
      return { count, resetInMs: ttl > 0 ? ttl : windowMs };
    } catch (err) {
      logger.warn({ err }, 'Redis rate limit check failed; using in-memory fallback');
      return this.fallback.hit(userId, windowMs);
    }
  }
}

export class RateLimiter {
  private maxRequests: number;
  private windowMs: number;
  private store: RateLimitStore;

  constructor(maxRequests = 15, windowMs = 60000, store: RateLimitStore = new MemoryRateLimitStore()) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.store = store;
  }

  public middleware() {
    return async (ctx: BotContext, next: NextFunction): Promise<void> => {
      // Do not rate-limit keystroke-driven inline queries
      if (!ctx.from || ctx.inlineQuery) return next();

      const { count, resetInMs } = await this.store.hit(ctx.from.id, this.windowMs);

      if (count > this.maxRequests) {
        throw new RateLimitExceededError(Math.max(1, Math.ceil(resetInMs / 1000)));
      }

      return next();
    };
  }
}
