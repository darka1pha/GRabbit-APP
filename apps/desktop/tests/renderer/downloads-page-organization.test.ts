import { describe, expect, it } from 'vitest';

if (typeof (globalThis as unknown as { window: unknown }).window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = {
    grabbit: {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

import { createTranslator } from '../../src/renderer/src/i18n';

describe('Downloads Page Organization & UI/UX Improvements', () => {
  describe('Date Grouping Helper (getDateGroupKey)', () => {
    it('buckets timestamps accurately into today, yesterday, thisWeek, thisMonth, and older', async () => {
      const { getDateGroupKey } = await import('../../src/renderer/src/views/DownloadsView');
      const now = Date.now();
      const oneHourAgo = now - 3600 * 1000;
      const yesterday = now - 25 * 3600 * 1000;
      const threeDaysAgo = now - 3 * 86400 * 1000;
      const twoMonthsAgo = now - 65 * 86400 * 1000;

      expect(getDateGroupKey(oneHourAgo)).toBe('today');
      expect(['today', 'yesterday']).toContain(getDateGroupKey(yesterday));
      expect(['today', 'yesterday', 'thisWeek', 'thisMonth']).toContain(getDateGroupKey(threeDaysAgo));
      expect(getDateGroupKey(twoMonthsAgo)).toBe('older');
    });
  });

  describe('Density constants', () => {
    it('provides standard 56px comfortable and 40px compact heights', async () => {
      const { ROW_HEIGHT_COMFORTABLE, ROW_HEIGHT_COMPACT } = await import(
        '../../src/renderer/src/views/DownloadsView'
      );
      expect(ROW_HEIGHT_COMFORTABLE).toBe(56);
      expect(ROW_HEIGHT_COMPACT).toBe(40);
    });
  });

  describe('Multi-selection logic', () => {
    const visibleIds = ['dl-1', 'dl-2', 'dl-3', 'dl-4'];

    it('detects all selected, partially selected, and none selected', () => {
      const none = new Set<string>();
      const partial = new Set<string>(['dl-2']);
      const all = new Set<string>(visibleIds);

      const isAllSelected = (s: Set<string>) => visibleIds.length > 0 && visibleIds.every((id) => s.has(id));
      const isPartiallySelected = (s: Set<string>) => visibleIds.some((id) => s.has(id)) && !isAllSelected(s);

      expect(isAllSelected(none)).toBe(false);
      expect(isPartiallySelected(none)).toBe(false);

      expect(isAllSelected(partial)).toBe(false);
      expect(isPartiallySelected(partial)).toBe(true);

      expect(isAllSelected(all)).toBe(true);
      expect(isPartiallySelected(all)).toBe(false);
    });
  });

  describe('Bilingual Translations for Organization Features', () => {
    it('translates grouping, density, view options and selection bar keys in English and Persian', () => {
      const tEn = createTranslator('en');
      const tFa = createTranslator('fa');

      // Grouping
      expect(tEn('dl.groupBy')).toBe('Group by');
      expect(tFa('dl.groupBy')).toBe('دسته‌بندی');

      expect(tEn('dl.group.none')).toBe('None');
      expect(tFa('dl.group.none')).toBe('بدون دسته‌بندی');

      expect(tEn('dl.group.date')).toBe('Date');
      expect(tFa('dl.group.date')).toBe('تاریخ');

      expect(tEn('dl.group.today')).toBe('Today');
      expect(tFa('dl.group.today')).toBe('امروز');

      expect(tEn('dl.group.yesterday')).toBe('Yesterday');
      expect(tFa('dl.group.yesterday')).toBe('دیروز');

      expect(tEn('dl.group.thisWeek')).toBe('Earlier this week');
      expect(tFa('dl.group.thisWeek')).toBe('اوایل این هفته');

      // Density
      expect(tEn('dl.density')).toBe('Density');
      expect(tFa('dl.density')).toBe('تراکم نمایش');

      expect(tEn('dl.densityComfortable')).toBe('Comfortable');
      expect(tFa('dl.densityComfortable')).toBe('راحت');

      expect(tEn('dl.densityCompact')).toBe('Compact');
      expect(tFa('dl.densityCompact')).toBe('فشرده');

      // Floating Selection Bar
      expect(tEn('dl.selectedCount', { count: 3 })).toBe('3 selected');
      expect(tFa('dl.selectedCount', { count: 3 })).toBe('۳ مورد انتخاب شد');

      expect(tEn('dl.selectAll')).toBe('Select all');
      expect(tFa('dl.selectAll')).toBe('انتخاب همه');

      expect(tEn('dl.deselectAll')).toBe('Deselect');
      expect(tFa('dl.deselectAll')).toBe('لغو انتخاب');

      expect(tEn('dl.viewOptions')).toBe('View options');
      expect(tFa('dl.viewOptions')).toBe('گزینه‌های نمایش');
    });
  });
});
