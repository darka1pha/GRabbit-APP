import { describe, it, expect } from 'vitest';
import {
  normalizeLocale,
  resolveUserLocale,
  formatFileSize,
  formatDuration,
  formatNumberForLocale,
} from '../../src/i18n/locale-resolver.js';
import { translate } from '../../src/i18n/index.js';

describe('Internationalization & Locale Resolution', () => {
  it('normalizes standard and regional language codes', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('fa')).toBe('fa');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('en-GB')).toBe('en');
    expect(normalizeLocale('fa-IR')).toBe('fa');
    expect(normalizeLocale('fa_IR')).toBe('fa');
    expect(normalizeLocale('de')).toBe('en'); // unsupported falls back to default
    expect(normalizeLocale(null)).toBe('en');
  });

  it('respects locale resolution priority', () => {
    // 1. Saved preference wins
    expect(
      resolveUserLocale({
        savedLocale: 'fa',
        telegramLanguageCode: 'en',
        configuredDefault: 'en',
      })
    ).toBe('fa');

    // 2. Telegram language code if no saved preference
    expect(
      resolveUserLocale({
        savedLocale: null,
        telegramLanguageCode: 'fa-IR',
        configuredDefault: 'en',
      })
    ).toBe('fa');

    // 3. Fallback to default
    expect(
      resolveUserLocale({
        savedLocale: null,
        telegramLanguageCode: 'es',
        configuredDefault: 'en',
      })
    ).toBe('en');
  });

  it('translates messages in English and Persian', () => {
    const enWelcome = translate('en', 'welcome-title', { appName: 'g(Rabbit)' });
    expect(enWelcome).toContain('Welcome to g(Rabbit)!');

    const faWelcome = translate('fa', 'welcome-title', { appName: 'g(Rabbit)' });
    expect(faWelcome).toContain('به g(Rabbit) خوش آمدید!');
  });

  it('formats duration correctly', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(45)).toBe('00:45');
    expect(formatDuration(125)).toBe('02:05');
    expect(formatDuration(3665)).toBe('01:01:05');
  });

  it('formats file size correctly', () => {
    expect(formatFileSize(0)).toBe('0 MB');
    expect(formatFileSize(10485760)).toBe('10.0 MB');
    expect(formatFileSize(52428800)).toBe('50.0 MB');
  });

  it('formats numbers for Persian and English', () => {
    expect(formatNumberForLocale(1234, 'en')).toBe('1,234');
    expect(formatNumberForLocale(1234, 'fa')).toBe('۱٬۲۳۴');
  });
});
