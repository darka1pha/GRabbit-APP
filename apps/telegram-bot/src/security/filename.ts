import { posix } from 'node:path';

export function sanitizeFilename(input: string, fallback = 'media'): string {
  if (!input || !input.trim()) {
    return fallback;
  }

  // Normalize backslashes (Windows) to forward slashes (POSIX) and extract basename
  const normalized = input.trim().replace(/\\/g, '/');
  const base = posix.basename(normalized);

  // Replace invalid characters on Windows and POSIX: / \ : * ? " < > | and control chars
  const sanitized = base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  // Prevent dot-only names or empty names
  if (!sanitized || /^\.+$/.test(sanitized)) {
    return fallback;
  }

  // Truncate to reasonable length (e.g. 150 chars) while preserving extension
  if (sanitized.length > 150) {
    const extIndex = sanitized.lastIndexOf('.');
    if (extIndex > 0 && sanitized.length - extIndex <= 10) {
      const ext = sanitized.substring(extIndex);
      return sanitized.substring(0, 150 - ext.length) + ext;
    }
    return sanitized.substring(0, 150);
  }

  return sanitized;
}
