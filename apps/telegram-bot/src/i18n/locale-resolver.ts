import { SupportedLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../config/constants.js';

export function normalizeLocale(rawCode?: string | null): SupportedLocale {
  if (!rawCode) {
    return DEFAULT_LOCALE;
  }

  const cleaned = rawCode.trim().toLowerCase().replace('_', '-');
  const base = cleaned.split('-')[0];

  if (SUPPORTED_LOCALES.includes(cleaned as SupportedLocale)) {
    return cleaned as SupportedLocale;
  }

  if (SUPPORTED_LOCALES.includes(base as SupportedLocale)) {
    return base as SupportedLocale;
  }

  return DEFAULT_LOCALE;
}

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

export function resolveUserLocale(options: {
  savedLocale?: string | null;
  telegramLanguageCode?: string | null;
  configuredDefault?: string | null;
}): SupportedLocale {
  if (options.savedLocale && isSupportedLocale(options.savedLocale)) {
    return options.savedLocale;
  }

  if (options.telegramLanguageCode) {
    const normalized = normalizeLocale(options.telegramLanguageCode);
    if (isSupportedLocale(normalized)) {
      return normalized;
    }
  }

  if (options.configuredDefault && isSupportedLocale(options.configuredDefault)) {
    return options.configuredDefault;
  }

  return DEFAULT_LOCALE;
}

export function formatNumberForLocale(num: number, locale: SupportedLocale): string {
  try {
    const intlLocale = locale === 'fa' ? 'fa-IR' : 'en-US';
    return new Intl.NumberFormat(intlLocale).format(num);
  } catch {
    return num.toString();
  }
}

export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
