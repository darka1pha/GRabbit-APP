import { posix } from 'node:path';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Makes a string safe to use as a Windows file name (no path parts, reserved names or bad chars). */
export function sanitizeFilename(input: string, fallback = 'download'): string {
  if (!input || !input.trim()) return fallback;

  const normalized = input.trim().replace(/\\/g, '/');
  const base = posix.basename(normalized);

  // eslint-disable-next-line no-control-regex
  let sanitized = base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows silently drops trailing dots and spaces
    .replace(/[. ]+$/, '');

  if (!sanitized || /^\.+$/.test(sanitized)) return fallback;
  if (WINDOWS_RESERVED.test(sanitized)) sanitized = `_${sanitized}`;

  if (sanitized.length > 180) {
    const extIndex = sanitized.lastIndexOf('.');
    if (extIndex > 0 && sanitized.length - extIndex <= 10) {
      const ext = sanitized.substring(extIndex);
      return sanitized.substring(0, 180 - ext.length) + ext;
    }
    return sanitized.substring(0, 180);
  }
  return sanitized;
}

/** Splits "name.tar.gz" style names into base + extension (only the last extension). */
export function splitExtension(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || name.length - idx > 12) return { base: name, ext: '' };
  return { base: name.substring(0, idx), ext: name.substring(idx) };
}
