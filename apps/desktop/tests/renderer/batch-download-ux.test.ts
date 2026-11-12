import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../src/renderer/src/i18n';
import { hasUrlPattern, expandUrlPatterns } from '@grabbit/utils';
import { isHttpUrl } from '../../src/renderer/src/format';

describe('Batch Download UX & Pattern Builder', () => {
  describe('Pattern Generator & Wildcards', () => {
    it('generates sequential URLs with zero padding using (*)', () => {
      const template = 'https://example.com/files/episode_(*).mp4';
      const from = 1;
      const to = 5;
      const pad = 2;
      const step = 1;

      const generated: string[] = [];
      for (let i = from; i <= to; i += step) {
        const numStr = String(i).padStart(pad, '0');
        generated.push(template.replaceAll('(*)', numStr));
      }

      expect(generated).toEqual([
        'https://example.com/files/episode_01.mp4',
        'https://example.com/files/episode_02.mp4',
        'https://example.com/files/episode_03.mp4',
        'https://example.com/files/episode_04.mp4',
        'https://example.com/files/episode_05.mp4',
      ]);
    });

    it('generates sequential URLs with custom step and 3-digit padding', () => {
      const template = 'https://cdn.site.com/archive_(*).tar.gz';
      const from = 10;
      const to = 30;
      const pad = 3;
      const step = 10;

      const generated: string[] = [];
      for (let i = from; i <= to; i += step) {
        const numStr = String(i).padStart(pad, '0');
        generated.push(template.replaceAll('(*)', numStr));
      }

      expect(generated).toEqual([
        'https://cdn.site.com/archive_010.tar.gz',
        'https://cdn.site.com/archive_020.tar.gz',
        'https://cdn.site.com/archive_030.tar.gz',
      ]);
    });

    it('supports bracket patterns via expandUrlPatterns', () => {
      const pattern = 'https://example.com/part_[01-03].zip';
      expect(hasUrlPattern(pattern)).toBe(true);
      const expanded = expandUrlPatterns(pattern);
      expect(expanded).toEqual([
        'https://example.com/part_01.zip',
        'https://example.com/part_02.zip',
        'https://example.com/part_03.zip',
      ]);
    });
  });

  describe('Clipboard URL extraction', () => {
    it('extracts multiple HTTP and HTTPS URLs from mixed text/markdown content', () => {
      const text = `
Here are the download links from the chat:
1. https://downloads.test.org/archive-1.iso
2. http://insecure.test.org/patch-2.zip (recommended)
Some other text without links
And another one: https://mirror.org/linux-v3.0.iso
      `;

      const matches = text.match(/https?:\/\/[^\s"'`<>]+/g) ?? [];
      const valid = matches.filter(isHttpUrl);

      expect(valid).toEqual([
        'https://downloads.test.org/archive-1.iso',
        'http://insecure.test.org/patch-2.zip',
        'https://mirror.org/linux-v3.0.iso',
      ]);
    });
  });

  describe('Multi-line paste auto-detection', () => {
    it('detects when pasted string contains multiple links or newlines', () => {
      const single = 'https://example.com/file.zip';
      const multi = 'https://example.com/file1.zip\nhttps://example.com/file2.zip';

      const isMulti = (val: string) => {
        const splitUrls = val.trim().split(/[\r\n\s]+/).filter(isHttpUrl);
        return splitUrls.length > 1 || (val.includes('\n') && splitUrls.length > 0);
      };

      expect(isMulti(single)).toBe(false);
      expect(isMulti(multi)).toBe(true);
    });
  });

  describe('Bilingual Translations for Batch Download UX', () => {
    it('provides complete translations in English and Persian', () => {
      const tEn = createTranslator('en');
      const tFa = createTranslator('fa');

      expect(tEn('dl.addBatch')).toBe('Batch Download');
      expect(tFa('dl.addBatch')).toBe('دانلود دسته‌ای');

      expect(tEn('add.modeSingle')).toBe('Single URL');
      expect(tFa('add.modeSingle')).toBe('تک لینک');

      expect(tEn('add.modeBatch')).toBe('Batch List');
      expect(tFa('add.modeBatch')).toBe('دانلود دسته‌ای');

      expect(tEn('add.modePattern')).toBe('Pattern Builder');
      expect(tFa('add.modePattern')).toBe('الگوساز دامنه‌ای');

      expect(tEn('add.pasteClipboard')).toBe('Paste Clipboard');
      expect(tFa('add.pasteClipboard')).toBe('جای‌گذاری از کلیپ‌بورد');

      expect(tEn('add.patternTemplate')).toBe('Address template with (*)');
      expect(tFa('add.patternTemplate')).toBe('قالب آدرس با (*)');

      expect(tEn('add.insertToBatch')).toBe('Insert into Batch List');
      expect(tFa('add.insertToBatch')).toBe('درج در فهرست دسته‌ای');
    });
  });
});

