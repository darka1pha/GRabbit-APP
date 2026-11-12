import { DEFAULT_INTERCEPTED_EXTENSIONS, DEFAULT_RPC_PORT } from '@grabbit/config';
import type { ExtensionConfig } from '../types/extension';

const LEGACY_DEFAULT_TOKEN = '519bf7cf-de9e-453f-98d3-fde5db273696';

export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  bridgeHost: '127.0.0.1',
  bridgePort: DEFAULT_RPC_PORT,
  bridgeToken: '',
  interceptDownloads: true,
  interceptExtensions: [...DEFAULT_INTERCEPTED_EXTENSIONS],
  excludedDomains: ['localhost', '127.0.0.1'],
  enableVideoSniffer: true,
  minFileSizeMB: 0,
  allowRemoteCookies: false,
};

export function isLoopbackHost(host: string): boolean {
  const h = (host || '').trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

const STREAMING_HOSTS = [
  'youtube.com',
  'youtu.be',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'soundcloud.com',
  'spotify.com',
  'twitch.tv',
  'vimeo.com',
  'dailymotion.com',
  'bilibili.com',
  'reddit.com',
  'facebook.com',
  'fb.watch',
  'pinterest.com',
];

const DIRECT_MEDIA_EXTENSIONS = new Set([
  'mp4',
  'mkv',
  'webm',
  'mov',
  'avi',
  'flv',
  'm4v',
  'mp3',
  'm4a',
  'flac',
  'wav',
  'ogg',
  'aac',
  'opus',
  'm3u8',
  'mpd',
]);

export function isStreamingMediaUrl(urlStr: string): boolean {
  const host = extractHostname(urlStr);
  if (!host) return false;
  return STREAMING_HOSTS.some((d) => host === d || host.endsWith('.' + d));
}

export function isDirectMediaFileUrl(urlStr: string): boolean {
  const ext = extractFileExtension(urlStr);
  return Boolean(ext && DIRECT_MEDIA_EXTENSIONS.has(ext));
}

export function isHlsOrDashUrl(urlStr: string): boolean {
  if (!urlStr) return false;
  const clean = urlStr.toLowerCase().split('?')[0];
  return clean.endsWith('.m3u8') || clean.endsWith('.mpd');
}

export async function loadExtensionConfig(): Promise<ExtensionConfig> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const data = await chrome.storage.sync.get('grabbit_config');
      if (data && data.grabbit_config) {
        const rawToken = data.grabbit_config.bridgeToken?.trim() ?? '';
        return {
          ...DEFAULT_EXTENSION_CONFIG,
          ...data.grabbit_config,
          bridgeToken: rawToken === LEGACY_DEFAULT_TOKEN ? '' : rawToken,
          interceptExtensions: Array.isArray(data.grabbit_config.interceptExtensions)
            ? data.grabbit_config.interceptExtensions
            : DEFAULT_EXTENSION_CONFIG.interceptExtensions,
        };
      }
    }
  } catch {
    // Fallback if chrome.storage is not available
  }
  return { ...DEFAULT_EXTENSION_CONFIG };
}

export async function saveExtensionConfig(config: Partial<ExtensionConfig>): Promise<ExtensionConfig> {
  const current = await loadExtensionConfig();
  const updated: ExtensionConfig = { ...current, ...config };
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      await chrome.storage.sync.set({ grabbit_config: updated });
    }
  } catch {
    // Fallback
  }
  return updated;
}

const INTERCEPTABLE_MIMES = new Set([
  'application/octet-stream',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-msi',
  'application/x-exe',
  'application/dos-exe',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-bzip2',
  'application/x-xz',
  'application/x-iso9660-image',
  'application/vnd.android.package-archive',
  'application/x-apple-diskimage',
]);

export function extractFileExtension(filenameOrUrl: string): string {
  if (!filenameOrUrl) return '';
  try {
    let clean = filenameOrUrl.split('?')[0].split('#')[0];
    const slashIdx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    if (slashIdx >= 0) {
      clean = clean.substring(slashIdx + 1);
    }
    const dotIdx = clean.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < clean.length - 1) {
      const ext = clean.substring(dotIdx + 1).toLowerCase();
      if (/^[a-z0-9]{1,10}$/.test(ext)) {
        return ext;
      }
    }

    // Check query parameters for embedded filenames (e.g. GitHub Releases / S3 response-content-disposition)
    if (filenameOrUrl.includes('?')) {
      const decoded = decodeURIComponent(filenameOrUrl);
      const dispMatch = /filename\*?=(?:UTF-8'')?["']?([^"';&\s]+)["']?/i.exec(decoded);
      if (dispMatch?.[1]) {
        const innerDot = dispMatch[1].lastIndexOf('.');
        if (innerDot > 0 && innerDot < dispMatch[1].length - 1) {
          return dispMatch[1].substring(innerDot + 1).toLowerCase();
        }
      }
    }
  } catch {
    // ignore
  }
  return '';
}

export function extractFilenameFromUrl(urlStr: string): string | undefined {
  if (!urlStr) return undefined;
  try {
    const decoded = decodeURIComponent(urlStr);
    const dispMatch = /filename\*?=(?:UTF-8'')?["']?([^"';&\s]+)["']?/i.exec(decoded);
    if (dispMatch?.[1]) {
      return dispMatch[1].replace(/.*[/\\]/, '');
    }
    const pathname = new URL(urlStr).pathname;
    const base = pathname.split('/').filter(Boolean).pop();
    if (base && base.includes('.')) {
      return decodeURIComponent(base);
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function extractHostname(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function shouldInterceptDownload(
  url: string,
  filename: string,
  config: ExtensionConfig,
  fileSizeBytes?: number,
  originalUrl?: string,
  mimeType?: string
): boolean {
  if (!config.interceptDownloads) {
    return false;
  }

  // Check URL scheme (must be http/https, never blob: or data: or chrome-extension:)
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return false;
  }

  const host = extractHostname(url);
  const origHost = originalUrl ? extractHostname(originalUrl) : '';
  if (host || origHost) {
    const isExcluded = config.excludedDomains.some((d) => {
      const target = d.trim().toLowerCase();
      if (!target) return false;
      return (
        host === target ||
        host.endsWith('.' + target) ||
        origHost === target ||
        origHost.endsWith('.' + target)
      );
    });
    if (isExcluded) {
      return false;
    }
  }

  // Minimum size check (if configured and known)
  if (config.minFileSizeMB > 0 && typeof fileSizeBytes === 'number' && fileSizeBytes > 0) {
    const minBytes = config.minFileSizeMB * 1024 * 1024;
    if (fileSizeBytes < minBytes) {
      return false;
    }
  }

  const allowed = new Set(config.interceptExtensions.map((e) => e.trim().toLowerCase().replace(/^\./, '')));

  // HLS and DASH manifests (.m3u8, .mpd) are always interceptable for desktop yt-dlp remuxing
  if (isHlsOrDashUrl(url) || (originalUrl && isHlsOrDashUrl(originalUrl))) {
    return true;
  }

  const candidates = [
    extractFileExtension(filename),
    extractFileExtension(url),
    originalUrl ? extractFileExtension(originalUrl) : '',
  ].filter(Boolean);

  for (const ext of candidates) {
    if (allowed.has(ext) || ext === 'm3u8' || ext === 'mpd') {
      return true;
    }
  }

  // Also check binary MIME type if URL has no file extension (e.g. CDN signed URLs before filename is resolved)
  if (mimeType) {
    const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
    if (INTERCEPTABLE_MIMES.has(cleanMime)) {
      return true;
    }
  }

  return false;
}

/**
 * Compare two semantic version strings (e.g. "1.1.0" vs "1.0.0").
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const cleanA = a.trim().replace(/^v/i, '').split('-')[0];
  const cleanB = b.trim().replace(/^v/i, '').split('-')[0];
  const partsA = cleanA.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = cleanB.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length, 3);
  for (let i = 0; i < len; i++) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

