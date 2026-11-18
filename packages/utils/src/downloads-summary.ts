export interface DownloadSummaryInput {
  status: string;
  receivedBytes: number;
  totalBytes?: number | null;
  speed?: number;
}

export interface DownloadSummary {
  total: number;
  active: number;
  queued: number;
  completed: number;
  failed: number;
  totalSpeed: number;
  receivedBytes: number;
  totalBytes: number;
  /** 0..1 progress across items with known size, or null when no item has a known totalBytes. */
  overallProgress: number | null;
}

export type StatusTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

/** Maps a download status string to a shared semantic color tone. */
export function getStatusTone(status: string): StatusTone {
  switch (status) {
    case 'downloading':
    case 'starting':
      return 'accent';
    case 'processing':
      return 'info';
    case 'completed':
      return 'success';
    case 'paused':
      return 'warning';
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Computes aggregate throughput, status breakdown, and overall progress across downloads. */
export function computeDownloadSummary(items: readonly DownloadSummaryInput[]): DownloadSummary {
  let active = 0;
  let queued = 0;
  let completed = 0;
  let failed = 0;
  let totalSpeed = 0;
  let receivedBytes = 0;
  let knownReceived = 0;
  let knownTotal = 0;

  for (const item of items) {
    const st = item.status;
    if (st === 'downloading' || st === 'starting' || st === 'processing') {
      active++;
      if (typeof item.speed === 'number' && Number.isFinite(item.speed) && item.speed > 0) {
        totalSpeed += item.speed;
      }
    } else if (st === 'queued' || st === 'paused') {
      queued++;
    } else if (st === 'completed') {
      completed++;
    } else if (st === 'error') {
      failed++;
    }

    const rec = Math.max(0, item.receivedBytes || 0);
    const tot = item.totalBytes && item.totalBytes > 0 ? item.totalBytes : 0;
    const effectiveRec = st === 'completed' && tot > 0 ? tot : rec;
    receivedBytes += effectiveRec;
    if (tot > 0) {
      knownTotal += tot;
      knownReceived += Math.min(tot, effectiveRec);
    }
  }

  return {
    total: items.length,
    active,
    queued,
    completed,
    failed,
    totalSpeed,
    receivedBytes,
    totalBytes: knownTotal,
    overallProgress: knownTotal > 0 ? Math.min(1, knownReceived / knownTotal) : null,
  };
}
