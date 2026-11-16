import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { logger } from './logger.js';

/**
 * Small HTTP server for the container and for monitoring:
 *   GET /healthz  liveness: the process is up and not shutting down
 *   GET /readyz   readiness: Redis and PostgreSQL answer (503 with details when not)
 *   GET /metrics  Prometheus text: queue depth, job outcomes, process memory and uptime
 * It listens on loopback by default (Docker's HEALTHCHECK runs inside the container); set
 * HEALTH_HOST=0.0.0.0 to let a Prometheus container on the same network scrape it.
 */

export interface HealthDeps {
  /** Named checks; each resolves when healthy and rejects (or times out) when not. */
  checks: Record<string, () => Promise<unknown>>;
  /** BullMQ job counts by state (waiting, active, delayed, failed, completed...). */
  jobCounts: () => Promise<Record<string, number>>;
  isShuttingDown: () => boolean;
  checkTimeoutMs?: number;
}

/** Job outcomes counted since start, by the worker. */
export const jobMetrics = {
  completed: 0,
  failed: 0,
  /** Sum of completed-job durations, for an average. */
  durationSecondsSum: 0,
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function runChecks(deps: HealthDeps): Promise<{ ok: boolean; checks: Record<string, string> }> {
  const timeout = deps.checkTimeoutMs ?? 2000;
  const entries = await Promise.all(
    Object.entries(deps.checks).map(async ([name, check]) => {
      try {
        await withTimeout(check(), timeout);
        return [name, 'ok'] as const;
      } catch (err) {
        return [name, err instanceof Error ? err.message : String(err)] as const;
      }
    })
  );
  const checks = Object.fromEntries(entries);
  return { ok: !deps.isShuttingDown() && entries.every(([, v]) => v === 'ok'), checks };
}

export async function renderMetrics(deps: HealthDeps): Promise<string> {
  const lines: string[] = [];
  const metric = (name: string, help: string, type: 'gauge' | 'counter', samples: [string, number][]) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) lines.push(`${name}${labels} ${Number.isFinite(value) ? value : 0}`);
  };

  let counts: Record<string, number> = {};
  try {
    counts = await withTimeout(deps.jobCounts(), deps.checkTimeoutMs ?? 2000);
  } catch (err) {
    logger.warn({ err }, 'Could not read queue job counts for /metrics');
  }
  metric(
    'grabbit_queue_jobs',
    'Media jobs in the queue by state.',
    'gauge',
    Object.entries(counts).map(([state, n]) => [`{state="${state.replace(/[^a-z_]/gi, '')}"}`, n])
  );
  metric('grabbit_jobs_completed_total', 'Media jobs completed since start.', 'counter', [['', jobMetrics.completed]]);
  metric('grabbit_jobs_failed_total', 'Media jobs failed since start (after retries).', 'counter', [['', jobMetrics.failed]]);
  metric('grabbit_job_duration_seconds_sum', 'Total run time of completed jobs.', 'counter', [
    ['', jobMetrics.durationSecondsSum],
  ]);
  const mem = process.memoryUsage();
  metric('process_resident_memory_bytes', 'Resident memory size.', 'gauge', [['', mem.rss]]);
  metric('nodejs_heap_used_bytes', 'V8 heap in use.', 'gauge', [['', mem.heapUsed]]);
  metric('process_uptime_seconds', 'Seconds since the process started.', 'gauge', [['', Math.round(process.uptime())]]);
  return lines.join('\n') + '\n';
}

export function startHealthServer(deps: HealthDeps, port: number, host: string): Promise<Server> {
  const server = createServer((req, res) => {
    const send = (status: number, body: string, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, '{"error":"method not allowed"}');
    const path = (req.url ?? '/').split('?')[0];

    if (path === '/healthz') {
      const down = deps.isShuttingDown();
      return send(down ? 503 : 200, JSON.stringify({ status: down ? 'shutting_down' : 'ok' }));
    }
    if (path === '/readyz') {
      void runChecks(deps).then(({ ok, checks }) => send(ok ? 200 : 503, JSON.stringify({ status: ok ? 'ok' : 'unavailable', checks })));
      return;
    }
    if (path === '/metrics') {
      void renderMetrics(deps).then((text) => send(200, text, 'text/plain; version=0.0.4'));
      return;
    }
    send(404, '{"error":"not found"}');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address() as AddressInfo;
      logger.info({ host, port: address.port }, 'Health server listening');
      resolve(server);
    });
  });
}
