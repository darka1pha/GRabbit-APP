// Filters, grouping and status helpers for the downloads list.

import type { DownloadItem, DownloadQueue, DownloadStatus } from '../../../../shared/types';
import type { MessageKey } from '../../i18n';
import { api } from '../../state';

export type StatusFilter = 'all' | 'active' | 'queued' | 'completed' | 'failed';
export type GroupByOption = 'none' | 'date' | 'status' | 'queue';
export type DensityOption = 'comfortable' | 'compact';

export const ROW_HEIGHT_COMFORTABLE = 56;
export const ROW_HEIGHT_COMPACT = 40;
export const ROW_HEIGHT = ROW_HEIGHT_COMFORTABLE;
export const OVERSCAN_ROWS = 10;

export function getDateGroupKey(timestamp: number): 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older' {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfThisWeek = startOfToday - 6 * 86400000;
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  if (timestamp >= startOfToday) return 'today';
  if (timestamp >= startOfYesterday) return 'yesterday';
  if (timestamp >= startOfThisWeek) return 'thisWeek';
  if (timestamp >= startOfThisMonth) return 'thisMonth';
  return 'older';
}

export const ACTIVE: DownloadStatus[] = ['starting', 'downloading', 'processing'];

export function matchesStatus(item: DownloadItem, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return ACTIVE.includes(item.status);
    case 'queued':
      return item.status === 'queued' || item.status === 'paused';
    case 'completed':
      return item.status === 'completed';
    case 'failed':
      return item.status === 'error';
  }
}

export function fraction(item: DownloadItem): number {
  if (item.status === 'completed') return 1;
  if (item.totalBytes) return Math.min(1, item.receivedBytes / item.totalBytes);
  if (item.percent !== undefined) return item.percent / 100;
  return 0;
}

export function canPause(item: DownloadItem): boolean {
  return item.status === 'queued' || ACTIVE.includes(item.status);
}
/** A finished multi-file torrent is a folder: it cannot be verified or sent as one file. */
export function isFolderDownload(item: DownloadItem): boolean {
  return item.kind === 'torrent' && (item.torrent?.files?.length ?? 0) > 1;
}

export function canResume(item: DownloadItem): boolean {
  return item.status === 'paused' || item.status === 'error';
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function restoreRemovedItems(items: DownloadItem[]): void {
  if (items.length === 0) return;
  const http = items
    .filter((i) => i.kind === 'http')
    .map((i) => ({
      url: i.url,
      fileName: i.fileName,
      category: i.category,
      directory: i.directory,
      connections: i.connections,
      queueId: i.queueId,
      startPaused: true,
    }));
  const media = items
    .filter((i) => i.kind === 'media' && i.media)
    .map((i) => ({
      platform: i.media!.platform,
      mediaId: i.media!.mediaId,
      format: i.media!.format,
      qualityId: i.media!.qualityId,
      url: i.url,
      title: i.media!.title,
      author: i.media!.author,
      thumbnailUrl: i.media!.thumbnailUrl,
      durationSeconds: i.media!.durationSeconds,
      estimatedSizeBytes: i.totalBytes ?? undefined,
      directory: i.directory,
      queueId: i.queueId,
      startPaused: true,
    }));
  if (http.length > 0) void api.downloads.addHttp(http);
  if (media.length > 0) void api.downloads.addMedia(media);
}

/** One collapsible section of the grouped list. */
export interface DownloadGroup {
  id: string;
  title: string;
  items: DownloadItem[];
  totalBytes: number;
}

export interface GroupLabels {
  t(key: MessageKey): string;
  queues: DownloadQueue[];
  queueDisplayName(queue: DownloadQueue): string;
  /** Display name by queue id (queues that still exist). */
  queueNames: Map<string, string>;
}

function group(id: string, title: string, items: DownloadItem[]): DownloadGroup {
  const totalBytes = items.reduce((sum, i) => sum + (i.totalBytes ?? i.receivedBytes ?? 0), 0);
  return { id, title, items, totalBytes };
}

const DATE_GROUPS: Array<{ key: ReturnType<typeof getDateGroupKey>; labelKey: MessageKey }> = [
  { key: 'today', labelKey: 'dl.group.today' },
  { key: 'yesterday', labelKey: 'dl.group.yesterday' },
  { key: 'thisWeek', labelKey: 'dl.group.thisWeek' },
  { key: 'thisMonth', labelKey: 'dl.group.thisMonth' },
  { key: 'older', labelKey: 'dl.group.older' },
];

const STATUS_GROUPS: Array<{ key: Exclude<StatusFilter, 'all'>; labelKey: MessageKey }> = [
  { key: 'active', labelKey: 'filter.active' },
  { key: 'queued', labelKey: 'filter.queued' },
  { key: 'completed', labelKey: 'filter.completed' },
  { key: 'failed', labelKey: 'filter.failed' },
];

/** Splits the visible list into date, status or queue sections (empty sections are left out). */
export function buildGroups(visible: DownloadItem[], groupBy: GroupByOption, labels: GroupLabels): DownloadGroup[] {
  const { t } = labels;

  if (groupBy === 'date') {
    const buckets = new Map<string, DownloadItem[]>(DATE_GROUPS.map((g) => [g.key, []]));
    for (const item of visible) buckets.get(getDateGroupKey(item.createdAt))!.push(item);
    return DATE_GROUPS.filter((g) => buckets.get(g.key)!.length > 0).map((g) =>
      group(g.key, t(g.labelKey), buckets.get(g.key)!)
    );
  }

  if (groupBy === 'status') {
    const buckets = new Map<string, DownloadItem[]>(STATUS_GROUPS.map((g) => [g.key, []]));
    for (const item of visible) {
      if (ACTIVE.includes(item.status)) buckets.get('active')!.push(item);
      else if (item.status === 'queued' || item.status === 'paused') buckets.get('queued')!.push(item);
      else if (item.status === 'completed') buckets.get('completed')!.push(item);
      else if (item.status === 'error') buckets.get('failed')!.push(item);
    }
    return STATUS_GROUPS.filter((g) => buckets.get(g.key)!.length > 0).map((g) =>
      group(g.key, t(g.labelKey), buckets.get(g.key)!)
    );
  }

  if (groupBy === 'queue') {
    const byQueue = new Map<string, DownloadItem[]>();
    for (const item of visible) {
      const id = item.queueId || 'main';
      const list = byQueue.get(id);
      if (list) list.push(item);
      else byQueue.set(id, [item]);
    }
    const result: DownloadGroup[] = [];
    // Main queue first, then the user's queues in their order, then items of deleted queues
    if (byQueue.has('main')) result.push(group('main', labels.queueNames.get('main') || t('queue.main'), byQueue.get('main')!));
    for (const q of labels.queues) {
      const items = q.id === 'main' ? undefined : byQueue.get(q.id);
      if (items && items.length > 0) result.push(group(q.id, labels.queueDisplayName(q), items));
    }
    for (const [id, items] of byQueue) {
      if (id !== 'main' && !labels.queues.some((q) => q.id === id)) result.push(group(id, labels.queueNames.get(id) || id, items));
    }
    return result;
  }

  return [];
}
