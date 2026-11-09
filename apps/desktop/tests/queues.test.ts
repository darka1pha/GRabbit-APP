import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: {
    getLocale: () => 'en-US',
    getPath: (name: string) => (name === 'downloads' ? '/mock/downloads' : '/mock/userData'),
    getVersion: () => '1.0.0',
    isPackaged: false,
    quit: vi.fn(),
  },
  powerSaveBlocker: {
    start: vi.fn(() => 1),
    stop: vi.fn(),
    isStarted: vi.fn(() => true),
  },
}));

import { DownloadManager } from '../src/main/downloads/manager';
import type { AppSettings, DownloadQueue } from '../src/shared/types';
import { DEFAULT_APP_SETTINGS } from '@grabbit/config';

describe('Download Queues System', () => {
  let tempDir: string;
  let manager: DownloadManager;
  let settings: AppSettings;
  let queuesChangedCalled: DownloadQueue[] | null = null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'grabbit-queues-test-'));
    settings = {
      ...DEFAULT_APP_SETTINGS,
      downloadDir: tempDir,
    };
    queuesChangedCalled = null;

    manager = new DownloadManager({
      dataDir: tempDir,
      tempRoot: join(tempDir, 'temp'),
      router: {} as any,
      getSettings: () => settings,
      onItemsChanged: () => {},
      onItemsRemoved: () => {},
      onOrderChanged: () => {},
      onQueuesChanged: (qs) => {
        queuesChangedCalled = qs;
      },
      onCompleted: () => {},
      onFailed: () => {},
      onQueueDrained: () => {},
      onAggregateProgress: () => {},
    });
    manager.init();
  });

  afterEach(async () => {
    manager.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes with default main and scheduled queues', () => {
    const qs = manager.listQueues();
    expect(qs.length).toBeGreaterThanOrEqual(2);
    const main = qs.find((q) => q.id === 'main');
    const scheduled = qs.find((q) => q.id === 'scheduled');

    expect(main).toBeDefined();
    expect(main?.name).toBe('Main Queue');
    expect(main?.enabled).toBe(true);

    expect(scheduled).toBeDefined();
    expect(scheduled?.name).toBe('Scheduled Queue');
    expect(scheduled?.scheduler?.enabled).toBe(true);
  });

  it('creates and updates a custom queue', async () => {
    const custom = manager.createQueue('Night Owl', {
      maxConcurrent: 3,
      scheduler: { enabled: true, startTime: '01:00', stopTime: '06:00' },
      afterQueue: 'quit',
    });

    expect(custom.id).toBeDefined();
    expect(custom.name).toBe('Night Owl');
    expect(custom.maxConcurrent).toBe(3);
    expect(custom.afterQueue).toBe('quit');
    expect(manager.listQueues().find((q) => q.id === custom.id)).toEqual(custom);
    expect(queuesChangedCalled).toBeDefined();

    const updated = manager.updateQueue(custom.id, {
      name: 'Night Downloads',
      maxConcurrent: 2,
    });

    expect(updated.name).toBe('Night Downloads');
    expect(updated.maxConcurrent).toBe(2);
    expect(manager.listQueues().find((q) => q.id === custom.id)?.name).toBe('Night Downloads');
  });

  it('assigns added downloads to the specified queue', () => {
    const [itemMain] = manager.addHttp([
      { url: 'https://example.com/file1.zip', startPaused: true, queueId: 'main' },
    ]);
    const [itemSched] = manager.addHttp([
      { url: 'https://example.com/file2.zip', startPaused: true, queueId: 'scheduled' },
    ]);

    expect(itemMain.queueId).toBe('main');
    expect(itemSched.queueId).toBe('scheduled');

    const mainQ = manager.listQueues().find((q) => q.id === 'main');
    const schedQ = manager.listQueues().find((q) => q.id === 'scheduled');

    expect(mainQ?.order).toContain(itemMain.id);
    expect(schedQ?.order).toContain(itemSched.id);
  });

  it('moves an item between queues', () => {
    const custom = manager.createQueue('Work', { maxConcurrent: 1 });
    const [item] = manager.addHttp([
      { url: 'https://example.com/doc.pdf', startPaused: true, queueId: 'main' },
    ]);

    expect(manager.listQueues().find((q) => q.id === 'main')?.order).toContain(item.id);
    expect(manager.listQueues().find((q) => q.id === custom.id)?.order).not.toContain(item.id);

    manager.moveItemToQueue(item.id, custom.id);

    const fetchedItem = manager.get(item.id);
    expect(fetchedItem?.queueId).toBe(custom.id);
    expect(manager.listQueues().find((q) => q.id === 'main')?.order).not.toContain(item.id);
    expect(manager.listQueues().find((q) => q.id === custom.id)?.order).toContain(item.id);
  });

  it('deletes a custom queue and moves its downloads to main queue', () => {
    const custom = manager.createQueue('Temporary', { maxConcurrent: 2 });
    const [item] = manager.addHttp([
      { url: 'https://example.com/temp.iso', startPaused: true, queueId: custom.id },
    ]);

    expect(manager.get(item.id)?.queueId).toBe(custom.id);

    manager.deleteQueue(custom.id);

    expect(manager.listQueues().find((q) => q.id === custom.id)).toBeUndefined();
    const migratedItem = manager.get(item.id);
    expect(migratedItem?.queueId).toBe('main');
    expect(manager.listQueues().find((q) => q.id === 'main')?.order).toContain(item.id);
  });

  it('starts and stops queues', () => {
    const custom = manager.createQueue('Queue A', { maxConcurrent: 1 });
    expect(custom.enabled).toBe(false);

    manager.startQueue(custom.id);
    expect(manager.listQueues().find((q) => q.id === custom.id)?.enabled).toBe(true);

    manager.stopQueue(custom.id);
    expect(manager.listQueues().find((q) => q.id === custom.id)?.enabled).toBe(false);
  });

  it('reorders downloads inside a queue', () => {
    const [item1] = manager.addHttp([{ url: 'https://example.com/1.zip', startPaused: true, queueId: 'main' }]);
    const [item2] = manager.addHttp([{ url: 'https://example.com/2.zip', startPaused: true, queueId: 'main' }]);

    const q = manager.listQueues().find((q) => q.id === 'main')!;
    const idx1 = q.order.indexOf(item1.id);
    const idx2 = q.order.indexOf(item2.id);
    expect(idx1).toBeLessThan(idx2);

    manager.reorderQueue('main', [item2.id, item1.id]);
    const updatedQ = manager.listQueues().find((q) => q.id === 'main')!;
    expect(updatedQ.order.indexOf(item2.id)).toBeLessThan(updatedQ.order.indexOf(item1.id));
  });
});
