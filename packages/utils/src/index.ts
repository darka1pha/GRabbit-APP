import { Language } from '@grabbit/types';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function nf(language: Language = 'en', digits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(language === 'fa' ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

/**
 * Format bytes into localized human-readable string (KB, MB, GB).
 */
export function formatBytes(bytes: number | null | undefined, language: Language = 'en'): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${nf(language, 0).format(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${nf(language, value >= 100 ? 0 : value >= 10 ? 1 : 2).format(value)} ${UNITS[unit]}`;
}

/**
 * Format speed in bytes per second.
 */
export function formatSpeed(bps: number, language: Language = 'en'): string {
  if (!bps || bps < 1) return '';
  return `${formatBytes(bps, language)}/s`;
}

/**
 * Format seconds into mm:ss or hh:mm:ss.
 */
export function formatDuration(seconds: number | null | undefined, language: Language = 'en'): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const f = nf(language, 0);
  const pad = (n: number) => f.format(n).padStart(2, language === 'fa' ? '۰' : '0');
  return h > 0 ? `${f.format(h)}:${pad(m)}:${pad(sec)}` : `${f.format(m)}:${pad(sec)}`;
}

/**
 * Format ETA seconds into human-readable string.
 */
export function formatEta(seconds: number | null | undefined, language: Language = 'en'): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  if (seconds > 86400 * 3) return '∞';
  return formatDuration(seconds, language);
}

/**
 * Format fraction (0..1) to percentage string.
 */
export function formatPercent(fraction: number, language: Language = 'en'): string {
  return `${nf(language, fraction < 0.1 ? 1 : 0).format(Math.max(0, Math.min(100, fraction * 100)))}%`;
}

/**
 * Format date timestamp into localized string.
 */
export function formatDate(ms: number, language: Language = 'en'): string {
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/**
 * Validate HTTP/HTTPS URL.
 */
export function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const isValidUrl = isHttpUrl;

const DIRECT_FILE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|iso|img|exe|msi|msix|apk|dmg|pkg|deb|rpm|appimage|pdf|docx?|xlsx?|pptx?|epub|mp3|m4a|flac|wav|ogg|opus|mp4|mkv|webm|avi|mov|wmv|jpg|jpeg|png|gif|webp|bin|torrent|csv|txt)$/i;

/**
 * Checks if a URL path points directly to a file extension.
 */
export function looksLikeDirectFile(url: string): boolean {
  try {
    return DIRECT_FILE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const MEDIA_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|instagram\.com|instagr\.am|soundcloud\.com|tiktok\.com|twitter\.com|x\.com|reddit\.com|redd\.it|vimeo\.com|dailymotion\.com|twitch\.tv|facebook\.com|fb\.watch|bilibili\.com|aparat\.com)$/i;

/**
 * Checks if a URL belongs to a supported media site.
 */
export function looksLikeMediaPage(url: string): boolean {
  try {
    return MEDIA_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Clean a string to make it safe as a local filename.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate download speed and remaining time (ETA).
 */
export function calculateSpeedAndEta(
  downloadedBytes: number,
  totalBytes: number,
  elapsedSeconds: number
): { speedBytesPerSec: number; etaSeconds?: number } {
  if (elapsedSeconds <= 0 || downloadedBytes <= 0) {
    return { speedBytesPerSec: 0 };
  }

  const speedBytesPerSec = downloadedBytes / elapsedSeconds;
  if (totalBytes <= 0 || downloadedBytes >= totalBytes) {
    return { speedBytesPerSec, etaSeconds: 0 };
  }

  const remainingBytes = totalBytes - downloadedBytes;
  const etaSeconds = Math.ceil(remainingBytes / speedBytesPerSec);
  return { speedBytesPerSec, etaSeconds };
}
