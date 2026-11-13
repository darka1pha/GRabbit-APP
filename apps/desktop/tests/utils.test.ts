import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeHashHex,
  createIncrementalHasher,
  createTranslator,
  en,
  fa,
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
    ] as const) {
      expect(tEn(key).length).toBeGreaterThan(0);
      expect(tFa(key).length).toBeGreaterThan(0);
    }
  });
});

