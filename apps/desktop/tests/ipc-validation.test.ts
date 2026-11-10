import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: {}, BrowserWindow: {}, clipboard: {}, dialog: {}, shell: {} }));

import {
  AddHttpDownloadRequestSchema,
  IdListSchema,
  QueuePatchSchema,
  SettingsPatchSchema,
  z,
} from '@grabbit/schemas';
import { InvalidRequestError, parseArgs } from '../src/main/ipc';

describe('IPC argument validation', () => {
  it('passes well-formed arguments through and strips unknown keys', () => {
    const [requests] = parseArgs('downloads:addHttp', [z.array(AddHttpDownloadRequestSchema)], [
      [{ url: ' https://example.com/a.zip ', connections: 8, fileName: null, surprise: true }],
    ]) as [Record<string, unknown>[]];
    expect(requests[0]).toEqual({ url: 'https://example.com/a.zip', connections: 8 });
  });

  it('rejects arguments of the wrong shape with a readable message', () => {
    expect(() => parseArgs('downloads:pause', [IdListSchema], ['not-an-array'])).toThrow(InvalidRequestError);
    expect(() => parseArgs('downloads:pause', [IdListSchema], [[1, 2]])).toThrow(/argument 1 for downloads:pause: 0/);
    expect(() => parseArgs('downloads:addHttp', [z.array(AddHttpDownloadRequestSchema)], [[{ fileName: 'x' }]])).toThrow(/url/);
    expect(() => parseArgs('downloads:pause', [IdListSchema], [])).toThrow(InvalidRequestError);
  });

  it('never lets a queue patch set id or order', () => {
    const [patch] = parseArgs('queues:update', [QueuePatchSchema], [
      { name: 'Night', id: 'main', order: ['x'], maxConcurrent: 99 },
    ]) as [Record<string, unknown>];
    expect(patch).toEqual({ name: 'Night', maxConcurrent: 16 });
  });

  it('type-checks settings patches', () => {
    expect(SettingsPatchSchema.safeParse({ theme: 'dark', extension: { allowLan: true } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ scheduler: { startTime: '' } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ extension: { token: { $ne: '' } } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ downloadDir: 42 }).success).toBe(false);
  });
});
