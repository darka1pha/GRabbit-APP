import { describe, expect, it } from 'vitest';
import { createTranslator, errorText } from '../../src/renderer/src/i18n';

describe('Phase 5 — Desktop UI/UX Renderer', () => {
  describe('5.3 i18n completeness & translations', () => {
    it('creates translators that interpolate parameters in English and Persian', () => {
      const tEn = createTranslator('en');
      const tFa = createTranslator('fa');

      expect(tEn('dl.active', { count: 3 })).toBe('3 active');
      expect(tFa('dl.active', { count: 3 })).toBe('۳ فعال');

      expect(tEn('palette.title')).toBe('Command Palette');
      expect(tFa('palette.title')).toBe('جعبه فرمان');

      expect(tEn('onboarding.welcome')).toBe('Welcome to GRabbit!');
      expect(tFa('onboarding.welcome')).toBe('به GRabbit خوش آمدید!');
    });

    it('translates all new Phase 5 action, dialog and empty state keys', () => {
      const t = createTranslator('en');
      expect(t('dl.duplicateTitle')).toBe('Link Already Exists');
      expect(t('dl.viewExisting')).toBe('View Existing');
      expect(t('dl.downloadAgain')).toBe('Download Again');
      expect(t('dl.refreshLink')).toBe('Refresh Link');
      expect(t('dl.changeFolder')).toBe('Open Folder');
      expect(t('common.undo')).toBe('Undo');
      expect(t('common.maximize')).toBe('Expand Window');
      expect(t('tray.miniMode')).toBe('Mini Mode');
    });

    it('translates error codes cleanly via errorText', () => {
      const t = createTranslator('en');
      expect(errorText(t, { code: 'LINK_EXPIRED' })).toContain('The server refused the link');
      expect(errorText(t, { code: 'DISK_FULL' })).toBe('The disk is full.');
      expect(errorText(t, { code: 'HTTP_404' })).toContain('HTTP 404');
    });
  });

  describe('5.1 Keyboard navigation roving focus math', () => {
    it('computes correct next and previous indices with wraparound', () => {
      const count = 5;
      const getNext = (current: number) => (current < count - 1 ? current + 1 : 0);
      const getPrev = (current: number) => (current > 0 ? current - 1 : count - 1);

      expect(getNext(0)).toBe(1);
      expect(getNext(4)).toBe(0); // wraps around
      expect(getPrev(0)).toBe(4); // wraps around
      expect(getPrev(3)).toBe(2);
    });

    it('computes correct selection ranges for Shift+Arrow multi-select', () => {
      const items = ['a', 'b', 'c', 'd', 'e'];
      const anchorIdx = 1; // 'b'
      const targetIdx = 3; // 'd'

      const [from, to] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
      const range = items.slice(from, to + 1);
      expect(range).toEqual(['b', 'c', 'd']);
    });
  });

  describe('5.6 Drag-and-drop queue reordering logic', () => {
    it('reorders array correctly when an item is dragged and dropped', () => {
      const list = ['id-1', 'id-2', 'id-3', 'id-4'];
      const sourceId = 'id-3';
      const targetId = 'id-1';

      const srcIdx = list.indexOf(sourceId);
      const dstIdx = list.indexOf(targetId);

      list.splice(srcIdx, 1);
      list.splice(dstIdx, 0, sourceId);

      expect(list).toEqual(['id-3', 'id-1', 'id-2', 'id-4']);
    });
  });
});

