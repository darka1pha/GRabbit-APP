import { describe, expect, it } from 'vitest';
import type { DownloadItem, DownloadQueue } from '../../src/shared/types';

if (typeof (globalThis as unknown as { window: unknown }).window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = { grabbit: {}, addEventListener: () => {}, removeEventListener: () => {} };
}

const { buildGroups } = await import('../../src/renderer/src/views/downloads/model');

const item = (id: string, over: Partial<DownloadItem>): DownloadItem =>
  ({ id, status: 'completed', createdAt: Date.now(), totalBytes: 100, receivedBytes: 100, queueId: 'main', ...over }) as DownloadItem;

const queues = [
  { id: 'main', name: 'Main' },
  { id: 'night', name: 'Night' },
] as DownloadQueue[];
const labels = {
  t: (key: string) => key,
  queues,
  queueDisplayName: (q: DownloadQueue) => q.name,
  queueNames: new Map([
    ['main', 'Main'],
    ['night', 'Night'],
  ]),
};

describe('buildGroups', () => {
  it('returns nothing when grouping is off', () => {
    expect(buildGroups([item('a', {})], 'none', labels)).toEqual([]);
  });

  it('groups by status in a fixed order, leaving out empty groups and summing sizes', () => {
    const groups = buildGroups(
      [
        item('a', { status: 'error', totalBytes: 10 }),
        item('b', { status: 'downloading', totalBytes: null, receivedBytes: 5 }),
        item('c', { status: 'paused' }),
        item('d', { status: 'downloading', totalBytes: 7 }),
      ],
      'status',
      labels
    );
    expect(groups.map((g) => g.id)).toEqual(['active', 'queued', 'failed']);
    expect(groups[0]).toMatchObject({ title: 'filter.active', totalBytes: 12 });
    expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('groups by queue: main first, then queue order, then items of deleted queues', () => {
    const groups = buildGroups(
      [item('a', { queueId: 'gone' }), item('b', { queueId: 'night' }), item('c', { queueId: 'main' })],
      'queue',
      labels
    );
    expect(groups.map((g) => [g.id, g.title])).toEqual([
      ['main', 'Main'],
      ['night', 'Night'],
      ['gone', 'gone'],
    ]);
  });

  it('groups by date', () => {
    const groups = buildGroups([item('a', { createdAt: Date.now() - 400 * 86400 * 1000 }), item('b', {})], 'date', labels);
    expect(groups.map((g) => g.id)).toEqual(['today', 'older']);
  });
});
