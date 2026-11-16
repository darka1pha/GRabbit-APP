import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { jobMetrics, renderMetrics, runChecks, startHealthServer, type HealthDeps } from '../../src/observability/health-server.js';

function deps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    checks: { redis: async () => 'PONG', database: async () => ({ rows: [] }) },
    jobCounts: async () => ({ waiting: 3, active: 1, failed: 2 }),
    isShuttingDown: () => false,
    checkTimeoutMs: 50,
    ...overrides,
  };
}

describe('health server', () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  const url = (path: string) => `http://127.0.0.1:${(server!.address() as AddressInfo).port}${path}`;

  it('reports ready only when every check passes', async () => {
    expect(await runChecks(deps())).toEqual({ ok: true, checks: { redis: 'ok', database: 'ok' } });

    const failing = await runChecks(
      deps({ checks: { redis: async () => 'PONG', database: async () => Promise.reject(new Error('ECONNREFUSED')) } })
    );
    expect(failing.ok).toBe(false);
    expect(failing.checks.database).toBe('ECONNREFUSED');
  });

  it('treats a hung check as failed', async () => {
    const hung = await runChecks(deps({ checks: { redis: () => new Promise(() => undefined) } }));
    expect(hung.ok).toBe(false);
    expect(hung.checks.redis).toMatch(/timed out/);
  });

  it('is not ready while shutting down', async () => {
    expect((await runChecks(deps({ isShuttingDown: () => true }))).ok).toBe(false);
  });

  it('renders Prometheus metrics', async () => {
    jobMetrics.completed = 7;
    const text = await renderMetrics(deps());
    expect(text).toContain('grabbit_queue_jobs{state="waiting"} 3');
    expect(text).toContain('grabbit_queue_jobs{state="failed"} 2');
    expect(text).toContain('grabbit_jobs_completed_total 7');
    expect(text).toContain('# TYPE grabbit_jobs_failed_total counter');
  });

  it('serves /healthz, /readyz and /metrics over HTTP', async () => {
    server = await startHealthServer(
      deps({ checks: { redis: async () => Promise.reject(new Error('down')) } }),
      0,
      '127.0.0.1'
    );
    expect((await fetch(url('/healthz'))).status).toBe(200);
    const ready = await fetch(url('/readyz'));
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ status: 'unavailable', checks: { redis: 'down' } });
    const metrics = await fetch(url('/metrics'));
    expect(metrics.headers.get('content-type')).toContain('text/plain');
    expect((await fetch(url('/nope'))).status).toBe(404);
  });
});
