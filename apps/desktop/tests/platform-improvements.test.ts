import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectCategory,
  extractUrlAndTimeRange,
  matchDomainPattern,
  parseSha256Sums,
  parseTimeRange,
} from '@grabbit/utils';
import { isScheduleWindowActive, parseShazamTrack } from '@grabbit/core';
import { isArchive } from '../src/main/downloads/automation';
import { DownloadManager } from '../src/main/downloads/manager';
import { defaultSettings } from '../src/main/settings';
import { PlatformRouter } from '../src/main/media/router';

describe('Shared utilities & core helpers', () => {
  it('parses valid time ranges and rejects invalid or reversed ones', () => {
    expect(parseTimeRange('01:10-02:05')).toEqual({ start: '01:10', end: '02:05', formatted: '01:10-02:05' });
    expect(parseTimeRange('00:01:10 - 00:02:05')).toEqual({ start: '00:01:10', end: '00:02:05', formatted: '00:01:10-00:02:05' });
    expect(parseTimeRange('02:05-01:10')).toBeNull();
    expect(parseTimeRange('01:75-02:00')).toBeNull();
  });

  it('extracts URL + trailing time range from text', () => {
    expect(extractUrlAndTimeRange('https://youtu.be/dQw4w9WgXcQ 00:30-01:15')).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      timeRange: '00:30-01:15',
    });
    expect(extractUrlAndTimeRange('check https://example.com/file.zip')).toEqual({
      url: 'https://example.com/file.zip',
    });
  });

  it('parses SHA256SUMS.txt and matches domain patterns', () => {
    const hash = 'a'.repeat(64);
    const sums = parseSha256Sums(`${hash}  GRabbit-v1.2.1.apk\n# comment\n${'b'.repeat(64)} *GRabbit-Setup.exe`);
    expect(sums.get('GRabbit-v1.2.1.apk')).toBe(hash);
    expect(sums.get('GRabbit-Setup.exe')).toBe('b'.repeat(64));

    expect(matchDomainPattern('cdn.example.com', '*.example.com')).toBe(true);
    expect(matchDomainPattern('example.com', '*.example.com')).toBe(true);
    expect(matchDomainPattern('evil-example.com', '*.example.com')).toBe(false);
  });

  it('classifies files and respects schedule weekday filters', () => {
    expect(detectCategory('archive.7z')).toBe('compressed');
    expect(detectCategory('https://host/app.apk')).toBe('programs');
    expect(detectCategory('https://host/unknown', 'video/mp4')).toBe('video');

    const monday = new Date(2026, 10, 16, 3, 0, 0); // Monday = 1
    expect(isScheduleWindowActive({ enabled: true, startTime: '02:00', stopTime: '08:00', days: [1] }, monday)).toBe(true);
    expect(isScheduleWindowActive({ enabled: true, startTime: '02:00', stopTime: '08:00', days: [0] }, monday)).toBe(false);
  });

  it('normalizes Shazam tracks via @grabbit/core', () => {
    const track = parseShazamTrack({
      track: {
        title: 'Blinding Lights',
        subtitle: 'The Weeknd',
        genres: { primary: 'Pop' },
        images: { coverarthq: 'https://img/cover.jpg' },
      },
    });
    expect(track).toMatchObject({
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      genre: 'Pop',
      coverArtUrl: 'https://img/cover.jpg',
    });
  });
});

describe('Desktop automation, site rules, and export/import', () => {
  it('recognizes .7z and .rar as archives', () => {
    expect(isArchive('bundle.7z')).toBe(true);
    expect(isArchive('archive.RAR')).toBe(true);
    expect(isArchive('video.mp4')).toBe(false);
  });

  it('applies per-site rules and exports/imports download lists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grabbit-imp-'));
    try {
      const settings = defaultSettings();
      settings.downloadDir = dir;
      settings.siteRules = [{ domainPattern: '*.slowhost.test', maxConnections: 2, speedLimitKBps: 250 }];

      const manager = new DownloadManager({
        dataDir: dir,
        tempRoot: join(dir, 'temp'),
        router: new PlatformRouter(),
        getSettings: () => settings,
        onItemsChanged: () => {},
        onItemsRemoved: () => {},
        onOrderChanged: () => {},
        onCompleted: () => {},
        onFailed: () => {},
        onQueueDrained: () => {},
        onAggregateProgress: () => {},
      });
      manager.init();

      const [added] = manager.addHttp([{ url: 'https://dl.slowhost.test/pack.zip', startPaused: true }]);
      expect(added.connections).toBe(2);
      expect(added.speedLimit).toBe(250 * 1024);

      const exported = manager.exportList();
      expect(exported).toContain('https://dl.slowhost.test/pack.zip');

      const imported = await manager.importList('https://example.org/a.iso\nhttps://example.org/b.zip');
      expect(imported).toHaveLength(2);
      expect(imported.every((i) => i.status === 'paused')).toBe(true);

      manager.shutdown();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
