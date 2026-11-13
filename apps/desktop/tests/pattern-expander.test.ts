import { describe, expect, it } from 'vitest';
import { expandSinglePattern, expandUrlPatterns, hasUrlPattern } from '@grabbit/utils';

describe('Batch URL Pattern Expander', () => {
  it('detects bracket patterns correctly with hasUrlPattern', () => {
    expect(hasUrlPattern('https://example.com/file[01-10].zip')).toBe(true);
    expect(hasUrlPattern('https://example.com/part[1-5].rar')).toBe(true);
    expect(hasUrlPattern('https://example.com/data[a-d].bin')).toBe(true);
    expect(hasUrlPattern('https://example.com/data[A-C].bin')).toBe(true);
    expect(hasUrlPattern('https://example.com/file[1-20:2].mp4')).toBe(true);
    expect(hasUrlPattern('https://example.com/file.zip')).toBe(false);
    expect(hasUrlPattern('https://example.com/[not-a-pattern].zip')).toBe(false);
    expect(hasUrlPattern('https://example.com/item[Z-a].bin')).toBe(false);
    expect(hasUrlPattern('https://example.com/item[a-Z].bin')).toBe(false);
  });

  it('does not expand mixed-case ASCII ranges like [Z-a] across punctuation', () => {
    expect(expandSinglePattern('https://example.com/item[Z-a].bin')).toEqual([
      'https://example.com/item[Z-a].bin',
    ]);
  });

  it('expands numeric patterns with zero padding', () => {
    const urls = expandSinglePattern('https://example.com/file[01-05].zip');
    expect(urls).toEqual([
      'https://example.com/file01.zip',
      'https://example.com/file02.zip',
      'https://example.com/file03.zip',
      'https://example.com/file04.zip',
      'https://example.com/file05.zip',
    ]);
  });

  it('expands numeric patterns without zero padding', () => {
    const urls = expandSinglePattern('https://example.com/part[1-4].rar');
    expect(urls).toEqual([
      'https://example.com/part1.rar',
      'https://example.com/part2.rar',
      'https://example.com/part3.rar',
      'https://example.com/part4.rar',
    ]);
  });

  it('expands numeric patterns with a custom step', () => {
    const urls = expandSinglePattern('https://example.com/item[02-10:2].dat');
    expect(urls).toEqual([
      'https://example.com/item02.dat',
      'https://example.com/item04.dat',
      'https://example.com/item06.dat',
      'https://example.com/item08.dat',
      'https://example.com/item10.dat',
    ]);
  });

  it('expands alphabetic patterns (lowercase and uppercase)', () => {
    const lower = expandSinglePattern('https://example.com/img_[a-d].jpg');
    expect(lower).toEqual([
      'https://example.com/img_a.jpg',
      'https://example.com/img_b.jpg',
      'https://example.com/img_c.jpg',
      'https://example.com/img_d.jpg',
    ]);

    const upper = expandSinglePattern('https://example.com/SECTION_[X-Z].pdf');
    expect(upper).toEqual([
      'https://example.com/SECTION_X.pdf',
      'https://example.com/SECTION_Y.pdf',
      'https://example.com/SECTION_Z.pdf',
    ]);
  });

  it('expands multiple patterns per URL via cartesian product', () => {
    const urls = expandSinglePattern('https://example.com/[a-b]/[1-2].zip');
    expect(urls).toEqual([
      'https://example.com/a/1.zip',
      'https://example.com/a/2.zip',
      'https://example.com/b/1.zip',
      'https://example.com/b/2.zip',
    ]);
  });

  it('handles multi-line inputs with expandUrlPatterns', () => {
    const input = `
      https://example.com/single.zip
      https://example.com/batch[1-3].mp4
      https://example.com/other.iso
    `;
    const result = expandUrlPatterns(input);
    expect(result).toEqual([
      'https://example.com/single.zip',
      'https://example.com/batch1.mp4',
      'https://example.com/batch2.mp4',
      'https://example.com/batch3.mp4',
      'https://example.com/other.iso',
    ]);
  });

  it('respects safety caps on astronomical ranges', () => {
    const urls = expandSinglePattern('https://example.com/chunk[1-999999].bin');
    expect(urls.length).toBeLessThanOrEqual(500);
  });
});
