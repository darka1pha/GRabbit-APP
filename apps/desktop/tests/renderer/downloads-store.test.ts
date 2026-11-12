import { describe, expect, it, vi } from 'vitest';
import { DownloadStore, type DownloadsSource } from '../../src/renderer/src/downloads-store';
import type { DownloadItem, DownloadProgressPatch } from '../../src/shared/types';

const item = (id: string, over: Partial<DownloadItem> = {}): DownloadItem => ({
  id,
  kind: 'http',
  url: `https://example.com/${id}`,
  fileName: `${id}.bin`,
  directory: 'C:\\Downloads',
  category: 'other',
  status: 'downloading',
  totalBytes: 1000,
  receivedBytes: 0,
  speed: 0,
  eta: null,
  resumable: true,
  connections: 4,
  activeConnections: 0,
  retries: 0,
  createdAt: 1,
  ...over,
});

const patch = (id: string, over: Partial<DownloadProgressPatch> = {}): DownloadProgressPatch => ({
  id,
  status: 'downloading',
  totalBytes: 1000,
  receivedBytes: 500,
  speed: 100,
  eta: 5,
  activeConnections: 4,
  retries: 0,
  ...over,
});

describe('DownloadStore', () => {
  it('progress re-renders the one download, not the list', () => {
    const store = new DownloadStore();
    store.reset([item('a'), item('b')]);
    const list = vi.fn();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribeList(list);
    store.subscribeItem('a', a);
    store.subscribeItem('b', b);
    const before = store.getList();

    store.applyPatches([patch('a')]);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(store.getList()).toBe(before);
    expect(store.get('a')).toMatchObject({ receivedBytes: 500, speed: 100, eta: 5, fileName: 'a.bin' });
  });

  it('a status change in a patch is a list change', () => {
    const store = new DownloadStore();
    store.reset([item('a')]);
    const list = vi.fn();
    store.subscribeList(list);
    store.applyPatches([patch('a', { status: 'processing' })]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(store.getList()[0].status).toBe('processing');
  });

  it('whole items add to the end, replace in place and notify', () => {
    const store = new DownloadStore();
    store.reset([item('a')]);
    const list = vi.fn();
    store.subscribeList(list);
    store.applyItems([item('b'), item('a', { fileName: 'renamed.bin' })]);
    expect(store.getList().map((d) => d.id)).toEqual(['a', 'b']);
    expect(store.getList()[0].fileName).toBe('renamed.bin');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('carries the media stage and watched segments from patches', () => {
    const store = new DownloadStore();
    const media = { platform: 'youtube', mediaId: 'x', format: 'video', qualityId: '1080p', title: 'T' } as DownloadItem['media'];
    store.reset([item('m', { kind: 'media', media }), item('h')]);
    store.applyPatches([
      patch('m', { stage: 'Converting' }),
      patch('h', { segments: [{ start: 0, end: 999, received: 500, part: '0' }] }),
    ]);
    expect(store.get('m')?.media?.stage).toBe('Converting');
    expect(store.get('h')?.segments?.[0].received).toBe(500);
    // A later patch without segments keeps the last known ones
    store.applyPatches([patch('h', { receivedBytes: 600 })]);
    expect(store.get('h')?.segments?.[0].received).toBe(500);
  });

  it('ignores patches for downloads it does not know', () => {
    const store = new DownloadStore();
    store.reset([item('a')]);
    expect(() => store.applyPatches([patch('ghost')])).not.toThrow();
    expect(store.getList()).toHaveLength(1);
  });

  it('removes and reorders', () => {
    const store = new DownloadStore();
    store.reset([item('a'), item('b'), item('c')]);
    store.setOrder(['c', 'a']);
    expect(store.getList().map((d) => d.id)).toEqual(['c', 'a', 'b']);
    store.remove(['a']);
    expect(store.getList().map((d) => d.id)).toEqual(['c', 'b']);
    expect(store.get('a')).toBeUndefined();
  });

  it('keeps updates that arrived before the initial list finished loading', () => {
    const store = new DownloadStore();
    store.applyItems([item('new'), item('a', { receivedBytes: 900 })]);
    store.reset([item('a', { receivedBytes: 100 })]);
    expect(store.getList().map((d) => d.id)).toEqual(['a', 'new']);
    expect(store.get('a')?.receivedBytes).toBe(900);
  });

  it('reports idle totals when nothing is active', () => {
    const store = new DownloadStore();
    const listener = vi.fn();
    store.subscribeAggregate(listener);
    store.setAggregate({ active: 2, speed: 300, percent: 40 });
    expect(store.getAggregate()).toEqual({ active: 2, speed: 300, percent: 40 });
    store.setAggregate({ active: 0, speed: 12, percent: null });
    expect(store.getAggregate()).toEqual({ active: 0, speed: 0, percent: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('watches segments for as long as any view needs them', () => {
    const watchSegments = vi.fn(async () => undefined);
    const noop = () => () => undefined;
    const source: DownloadsSource = {
      list: async () => [],
      onChanged: noop,
      onProgress: noop,
      onAggregate: noop,
      onRemoved: noop,
      onOrderChanged: noop,
      watchSegments,
    };
    const store = new DownloadStore();
    store.connect(source);

    const details = store.watchSegments('a');
    const inspector = store.watchSegments('a');
    expect(watchSegments).toHaveBeenLastCalledWith(['a']);
    inspector();
    expect(watchSegments).toHaveBeenLastCalledWith(['a']);
    details();
    details(); // releasing twice is harmless
    expect(watchSegments).toHaveBeenLastCalledWith([]);
  });
});
