/** Resolves after `ms`, or rejects with an AbortError when the signal fires first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Bandwidth limiter (virtual scheduling / GCRA). Every `take(n)` reserves the next n/rate seconds
 * of the line; callers sleep until their slot starts. Shared by any number of connections.
 */
export class RateLimiter {
  private nextAt = 0;

  constructor(private bytesPerSecond = 0) {}

  public get rate(): number {
    return this.bytesPerSecond;
  }

  public setRate(bytesPerSecond: number): void {
    this.bytesPerSecond = Math.max(0, bytesPerSecond || 0);
    this.nextAt = 0;
  }

  public async take(bytes: number, signal?: AbortSignal): Promise<void> {
    const rate = this.bytesPerSecond;
    if (!rate || bytes <= 0) return;
    const now = performance.now();
    // Allow a 200 ms burst so short pauses don't waste bandwidth
    const slotStart = Math.max(this.nextAt, now - 200);
    this.nextAt = slotStart + (bytes / rate) * 1000;
    const wait = slotStart - now;
    if (wait > 1) await sleep(wait, signal);
  }
}
