import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { I18n } from '@grammyjs/i18n';
import { SupportedLocale, DEFAULT_LOCALE } from '../config/constants.js';

const LOCALES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../locales');

export const i18n = new I18n({
  defaultLocale: DEFAULT_LOCALE,
  directory: LOCALES_DIR,
  useSession: false,
});

export function stripFluentIsolates(text: string): string {
  // Strip Unicode FSI (\u2068), PDI (\u2069), LRI (\u2066), RLI (\u2067)
  return text.replace(/[\u2066-\u2069]/g, '');
}

export function translate(
  locale: SupportedLocale,
  key: string,
  params?: Record<string, string | number>
): string {
  try {
    const raw = i18n.t(locale, key, params);
    return stripFluentIsolates(raw);
  } catch (err) {
    // Fallback to key if translation fails
    return key;
  }
}

export * from './locale-resolver.js';
