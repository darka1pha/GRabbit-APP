import { DEFAULT_INTERCEPTED_EXTENSIONS, DEFAULT_RPC_PORT } from '@grabbit/config';
import type { ExtensionConfig } from '../types/extension';

export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  bridgeHost: '127.0.0.1',
  bridgePort: DEFAULT_RPC_PORT,
  bridgeToken: '519bf7cf-de9e-453f-98d3-fde5db273696',
  interceptDownloads: true,
  interceptExtensions: [...DEFAULT_INTERCEPTED_EXTENSIONS],
  excludedDomains: ['localhost', '127.0.0.1'],
  enableVideoSniffer: true,
  minFileSizeMB: 0,
};

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

export async function loadExtensionConfig(): Promise<ExtensionConfig> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const data = await chrome.storage.sync.get('grabbit_config');
      if (data && data.grabbit_config) {
        return {
          ...DEFAULT_EXTENSION_CONFIG,
          ...data.grabbit_config,
          bridgeToken:
            data.grabbit_config.bridgeToken?.trim() || DEFAULT_EXTENSION_CONFIG.bridgeToken,
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

export function extractFileExtension(filenameOrUrl: string): string {
  try {
    let clean = filenameOrUrl.split('?')[0].split('#')[0];
    const slashIdx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    if (slashIdx >= 0) {
      clean = clean.substring(slashIdx + 1);
    }
    const dotIdx = clean.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < clean.length - 1) {
      return clean.substring(dotIdx + 1).toLowerCase();
    }
  } catch {
    // ignore
  }
  return '';
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
  fileSizeBytes?: number
): boolean {
  if (!config.interceptDownloads) {
    return false;
  }

  // Check URL scheme
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return false;
  }

  const host = extractHostname(url);
  if (host) {
    const isExcluded = config.excludedDomains.some((d) => {
      const target = d.trim().toLowerCase();
      return target && (host === target || host.endsWith('.' + target));
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

  const extFromFilename = extractFileExtension(filename);
  const extFromUrl = extractFileExtension(url);
  const targetExt = extFromFilename || extFromUrl;

  if (!targetExt) {
    return false;
  }

  const allowed = new Set(config.interceptExtensions.map((e) => e.trim().toLowerCase().replace(/^\./, '')));
  return allowed.has(targetExt);
}

