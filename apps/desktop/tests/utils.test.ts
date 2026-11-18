import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeDownloadSummary,
  computeHashHex,
  createIncrementalHasher,
  createTranslator,
  en,
  fa,
  getStatusTone,
  sha512Hex,
} from '@grabbit/utils';

describe('@grabbit/utils SHA-512', () => {
  const vectors = [
    '',
    'abc',
    'The quick brown fox jumps over the lazy dog',
    'A'.repeat(127),
    'A'.repeat(128), // exact SHA-512 block boundary
    'A'.repeat(129),
    'در صف دانلود برای تست چندبخشی گربیت 🐇 '.repeat(12),
  ];

  it('matches Node crypto sha512 for one-shot sha512Hex and computeHashHex', () => {
    const encoder = new TextEncoder();
    for (const input of vectors) {
      const bytes = encoder.encode(input);
      const expected = createHash('sha512').update(bytes).digest('hex');
      expect(sha512Hex(bytes)).toBe(expected);
      expect(computeHashHex(bytes, 'sha512')).toBe(expected);
    }
  });

  it('matches Node crypto sha512 across multi-chunk streaming updates', () => {
    const payload = new TextEncoder().encode('grabbit-sha512-stream-'.repeat(40));
    const expected = createHash('sha512').update(payload).digest('hex');

    const hasher = createIncrementalHasher('sha512');
    for (let i = 0; i < payload.length; i += 37) {
      hasher.update(payload.subarray(i, i + 37));
    }
    expect(hasher.digestHex()).toBe(expected);
  });
});

describe('@grabbit/utils i18n', () => {
  it('contains matching keys in en and fa dictionaries', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fa).sort());
  });

  it('translates queued status cleanly in Persian and resolves new Wave 1 keys', () => {
    const tFa = createTranslator('fa');
    const tEn = createTranslator('en');

    expect(tFa('status.queued')).toBe('در صف');
    expect(tEn('status.queued').length).toBeGreaterThan(0);

    for (const key of [
      'grab.recent',
      'dl.linkRefreshed',
      'app.viewRenderError',
      'set.noMatchingSettings',
      'dl.summary.throughput',
      'dl.summary.downloaded',
      'dl.summary.overall',
    ] as const) {
      expect(tEn(key).length).toBeGreaterThan(0);
      expect(tFa(key).length).toBeGreaterThan(0);
    }
  });
});

describe('@grabbit/utils download summary & status tones', () => {
  it('computes status counts, throughput, transferred bytes, and overall progress', () => {
    const summary = computeDownloadSummary([
      { status: 'downloading', receivedBytes: 500, totalBytes: 1000, speed: 2500 },
      { status: 'processing', receivedBytes: 1000, totalBytes: 1000, speed: 0 },
      { status: 'queued', receivedBytes: 0, totalBytes: 1000, speed: 0 },
      { status: 'paused', receivedBytes: 250, totalBytes: 1000, speed: 999 },
      { status: 'completed', receivedBytes: 900, totalBytes: 1000, speed: 0 },
      { status: 'error', receivedBytes: 100, totalBytes: null, speed: 0 },
    ]);

    expect(summary.total).toBe(6);
    expect(summary.active).toBe(2);
    expect(summary.queued).toBe(2);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.totalSpeed).toBe(2500);
    // Completed item counts full totalBytes (1000), unknown total adds receivedBytes (100)
    expect(summary.receivedBytes).toBe(2850);
    expect(summary.totalBytes).toBe(5000);
    expect(summary.overallProgress).toBeCloseTo(2750 / 5000, 6);
  });

  it('returns null overallProgress when no item has a known totalBytes', () => {
    const empty = computeDownloadSummary([]);
    expect(empty.total).toBe(0);
    expect(empty.overallProgress).toBeNull();

    const unknownSizes = computeDownloadSummary([
      { status: 'downloading', receivedBytes: 512, totalBytes: null, speed: 128 },
    ]);
    expect(unknownSizes.receivedBytes).toBe(512);
    expect(unknownSizes.totalBytes).toBe(0);
    expect(unknownSizes.overallProgress).toBeNull();
  });

  it('maps download statuses consistently to semantic tones', () => {
    expect(getStatusTone('downloading')).toBe('accent');
    expect(getStatusTone('starting')).toBe('accent');
    expect(getStatusTone('processing')).toBe('info');
    expect(getStatusTone('completed')).toBe('success');
    expect(getStatusTone('paused')).toBe('warning');
    expect(getStatusTone('error')).toBe('danger');
    expect(getStatusTone('queued')).toBe('neutral');
  });
});

