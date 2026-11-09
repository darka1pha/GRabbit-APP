import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../../src/bot/middleware/rate-limiter.js';
import { RateLimitExceededError } from '../../src/core/errors/domain-errors.js';
import { BotContext } from '../../src/bot/context.js';

describe('Rate Limiter Middleware', () => {
  it('allows requests within limit', async () => {
    const limiter = new RateLimiter(3, 10000);
    const mw = limiter.middleware();

    const mockCtx = {
      from: { id: 12345 },
    } as unknown as BotContext;

    let calls = 0;
    const next = async () => {
      calls++;
    };

    await mw(mockCtx, next);
    await mw(mockCtx, next);
    await mw(mockCtx, next);

    expect(calls).toBe(3);
  });

  it('throws RateLimitExceededError when request count exceeds threshold', async () => {
    const limiter = new RateLimiter(2, 5000);
    const mw = limiter.middleware();

    const mockCtx = {
      from: { id: 99999 },
    } as unknown as BotContext;

    const next = async () => {};

    await mw(mockCtx, next);
    await mw(mockCtx, next);

    await expect(mw(mockCtx, next)).rejects.toThrow(RateLimitExceededError);
  });
});
