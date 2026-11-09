import {
  PlatformId,
  PlatformMetadata,
  MediaItem,
  MediaOption,
} from '@grabbit/types';
import {
  parsePlatformUrl,
  detectPlatform,
  extractUrlFromText,
  standardMediaOptions,
  spotifyAudioOptions,
  audioOptions,
  parseTrackPage,
} from '@grabbit/core';
import { GrabbitApiClient } from '@grabbit/api';

/**
 * Platform color theme mapping
 */
export const PLATFORM_COLORS: Record<PlatformId, string> = {
  youtube: '#ef4444',
  spotify: '#22c55e',
  instagram: '#ec4899',
  soundcloud: '#f97316',
  tiktok: '#06b6d4',
  twitter: '#38bdf8',
  reddit: '#f97316',
  generic: '#8b5cf6',
};

export const PLATFORM_NAMES: Record<PlatformId, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  instagram: 'Instagram',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
  twitter: 'X / Twitter',
  reddit: 'Reddit',
  generic: 'Direct Media',
};

export interface MobileBridgeConfig {
  apiBaseUrl?: string;
}

export class MobileBridgeService {
  private apiClient: GrabbitApiClient | null = null;

  constructor(config?: MobileBridgeConfig) {
    if (config?.apiBaseUrl) {
      this.apiClient = new GrabbitApiClient(config.apiBaseUrl);
    }
  }

  setBaseUrl(url?: string) {
    this.apiClient = url ? new GrabbitApiClient(url) : null;
  }

  /**
   * Parse and extract URL from raw input or shared text
   */
  extractAndParseUrl(rawText: string) {
    const extracted = extractUrlFromText(rawText) || rawText.trim();
    try {
      const parsed = parsePlatformUrl(extracted);
      return {
        valid: true,
        url: parsed.normalizedUrl,
        platform: parsed.platform,
      };
    } catch {
      return {
        valid: false,
        url: extracted,
        platform: 'generic' as PlatformId,
      };
    }
  }

  /**
   * Resolve platform metadata for a given URL.
   * Tries remote API service first if available, falls back to standalone platform scrapers.
   */
  async resolveMetadata(targetUrl: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    const { normalizedUrl, platform } = parsePlatformUrl(targetUrl);

    // If API client is configured, use remote API
    if (this.apiClient) {
      try {
        return await this.apiClient.resolveMetadata({ url: normalizedUrl, signal });
      } catch (err) {
        console.warn('API client resolution failed, using fallback scraper:', err);
      }
    }

    // Standalone resolution fallback
    return this.resolveStandalone(normalizedUrl, platform, signal);
  }

  /**
   * Standalone resolver for mobile when backend is not configured or offline.
   */
  private async resolveStandalone(
    url: string,
    platform: PlatformId,
    signal?: AbortSignal
  ): Promise<PlatformMetadata> {
    if (platform === 'spotify') {
      return this.resolveSpotify(url, signal);
    }

    if (platform === 'youtube') {
      return this.resolveYouTube(url, signal);
    }

    // Generic media resolver
    return this.resolveGeneric(url, platform);
  }

  private async resolveSpotify(url: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let title = 'Spotify Track';
    let artistOrAuthor: string | undefined;
    let thumbnailUrl: string | undefined;

    try {
      const res = await fetch(url, { signal });
      if (res.ok) {
        const html = await res.text();
        const details = parseTrackPage(html);
        if (details.albumName) {
          title = details.albumName;
        }
        if (details.coverUrl) {
          thumbnailUrl = details.coverUrl;
        }
      }
    } catch {
      // Offline or network error - continue with sensible defaults
    }

    const availableOptions = spotifyAudioOptions();

    const item: MediaItem = {
      id: `spotify-${Date.now()}`,
      title,
      uploader: artistOrAuthor,
      platform: 'spotify',
      url,
      thumbnailUrl,
      isDownloadable: true,
      availableOptions,
    };

    return {
      platform: 'spotify',
      url,
      title,
      artistOrAuthor,
      thumbnailUrl,
      items: [item],
    };
  }

  private async resolveYouTube(url: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let title = 'YouTube Video';
    let author: string | undefined;
    let thumbnailUrl: string | undefined;

    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await fetch(oembedUrl, { signal });
      if (res.ok) {
        const data = await res.json();
        if (data.title) title = data.title;
        if (data.author_name) author = data.author_name;
        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
      }
    } catch {
      // Fallback
    }

    const availableOptions = standardMediaOptions();

    const item: MediaItem = {
      id: `yt-${Date.now()}`,
      title,
      uploader: author,
      platform: 'youtube',
      url,
      thumbnailUrl,
      isDownloadable: true,
      availableOptions,
    };

    return {
      platform: 'youtube',
      url,
      title,
      artistOrAuthor: author,
      thumbnailUrl,
      items: [item],
    };
  }

  private resolveGeneric(url: string, platform: PlatformId): PlatformMetadata {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').filter(Boolean).pop() || 'Media Download';
    const isAudio = /\.(mp3|m4a|flac|wav|ogg)$/i.test(pathname);

    const availableOptions = isAudio ? audioOptions() : standardMediaOptions();

    const item: MediaItem = {
      id: `media-${Date.now()}`,
      title: decodeURIComponent(filename),
      platform,
      url,
      isDownloadable: true,
      availableOptions,
    };

    return {
      platform,
      url,
      title: item.title,
      items: [item],
    };
  }
}

export const mobileBridge = new MobileBridgeService();

