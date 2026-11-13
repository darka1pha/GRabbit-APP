import {
  PlatformId,
  PlatformMetadata,
  MediaItem,
  MediaOption,
  DownloadItem,
  DownloadQueue,
  DownloadsAggregate,
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
import { mobileSettingsManager } from './settings-manager';

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

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

export const DEFAULT_RESOLVER_ENDPOINTS = {
  piped: [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.private.coffee',
    'https://piped-api.lunar.icu',
    'https://pipedapi.tokhmi.xyz',
  ],
  twitter: [
    'https://api.vxtwitter.com',
    'https://api.fxtwitter.com',
    'https://api.fixupx.com',
  ],
  instagram: [
    'https://www.ddinstagram.com',
    'https://www.kkinstagram.com',
  ],
};

class ResolverEndpointPool {
  private lastHealthyMirror: Map<string, string> = new Map();

  getOrdered(category: 'piped' | 'twitter' | 'instagram', defaultList: string[]): string[] {
    const healthy = this.lastHealthyMirror.get(category);
    if (!healthy) return [...defaultList];
    return [healthy, ...defaultList.filter((m) => m !== healthy)];
  }

  markSuccess(category: 'piped' | 'twitter' | 'instagram', mirror: string) {
    this.lastHealthyMirror.set(category, mirror);
  }

  markFailure(category: 'piped' | 'twitter' | 'instagram', mirror: string) {
    if (this.lastHealthyMirror.get(category) === mirror) {
      this.lastHealthyMirror.delete(category);
    }
  }
}

export const resolverPool = new ResolverEndpointPool();

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (init?.signal) {
    if (init.signal.aborted) {
      clearTimeout(timeoutId);
      throw new Error('Aborted');
    }
    init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] || null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = parsed.searchParams.get('v');
      if (v) return v;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') && parts[1]) {
        return parts[1];
      }
    }
  } catch {
    // ignore
  }
  const match = /(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/.exec(url);
  return match ? match[1] : null;
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

  /** Returns base URL and auth headers when Desktop RPC Bridge is configured, or null otherwise. */
  private getDesktopRpcConfig(): { baseUrl: string; headers: Record<string, string> } | null {
    const { desktopBridge } = mobileSettingsManager.getSettings();
    if (!desktopBridge.enabled || !desktopBridge.host) {
      return null;
    }
    return {
      baseUrl: `http://${desktopBridge.host.trim()}:${desktopBridge.port || 31542}`,
      headers: {
        'Content-Type': 'application/json',
        ...(desktopBridge.token ? { 'X-GRabbit-Token': desktopBridge.token } : {}),
      },
    };
  }

  private async requestDesktopRpc<T = Record<string, unknown>>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}
  ): Promise<{ ok: boolean; data?: T; error?: string }> {
    const cfg = this.getDesktopRpcConfig();
    if (!cfg) {
      return { ok: false, error: 'Desktop RPC Bridge is not enabled in Settings.' };
    }
    try {
      const res = await fetchWithTimeout(
        `${cfg.baseUrl}${path}`,
        {
          method: init.method ?? 'GET',
          headers: cfg.headers,
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        },
        init.timeoutMs ?? 2500
      );
      const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
      if (!res.ok) {
        return { ok: false, error: data?.error || `Desktop returned HTTP ${res.status}` };
      }
      return { ok: true, data: data ?? ({} as T) };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || `Could not reach Desktop at ${cfg.baseUrl}`,
      };
    }
  }

  /**
   * Send a download request directly to the paired Desktop PC over Wi-Fi RPC Bridge.
   */
  async sendToDesktop(
    url: string,
    options?: { fileName?: string; referrer?: string; startPaused?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const res = await this.requestDesktopRpc<{ success?: boolean; error?: string }>('/downloads/add', {
      method: 'POST',
      body: {
        url,
        fileName: options?.fileName,
        referrer: options?.referrer,
        startPaused: options?.startPaused,
      },
    });
    if (res.ok && res.data?.success) {
      return { success: true };
    }
    return { success: false, error: res.data?.error || res.error || 'Desktop download request failed' };
  }

  /** Fetches the current downloads list & aggregate speed from the paired Desktop PC. */
  async getDesktopDownloads(): Promise<{
    ok: boolean;
    items: DownloadItem[];
    aggregate?: DownloadsAggregate;
    error?: string;
  }> {
    const res = await this.requestDesktopRpc<{ items?: DownloadItem[]; aggregate?: DownloadsAggregate }>(
      '/downloads/list',
      { method: 'GET', timeoutMs: 2500 }
    );
    if (!res.ok) {
      return { ok: false, items: [], error: res.error };
    }
    const items = Array.isArray(res.data?.items) ? res.data.items : [];
    const activeItems = items.filter(
      (i) => i.status === 'downloading' || i.status === 'starting' || i.status === 'processing'
    );
    const totalSpeed = activeItems.reduce((acc, i) => acc + (i.speed || 0), 0);
    const aggregate: DownloadsAggregate = res.data?.aggregate ?? {
      active: activeItems.length,
      speed: totalSpeed,
      percent: null,
    };
    return {
      ok: true,
      items,
      aggregate,
    };
  }

  /** Fetches queues defined on the paired Desktop PC. */
  async getDesktopQueues(): Promise<{ ok: boolean; queues: DownloadQueue[]; error?: string }> {
    const res = await this.requestDesktopRpc<{ queues?: DownloadQueue[] }>('/queues/list', {
      method: 'GET',
      timeoutMs: 2500,
    });
    if (!res.ok) {
      return { ok: false, queues: [], error: res.error };
    }
    return {
      ok: true,
      queues: Array.isArray(res.data?.queues) ? res.data.queues : [],
    };
  }

  async pauseDesktopDownloads(ids: string[]): Promise<{ success: boolean; error?: string }> {
    const res = await this.requestDesktopRpc<{ success?: boolean }>('/downloads/pause', {
      method: 'POST',
      body: { ids },
    });
    return { success: Boolean(res.ok && res.data?.success), error: res.error };
  }

  async resumeDesktopDownloads(ids: string[]): Promise<{ success: boolean; error?: string }> {
    const res = await this.requestDesktopRpc<{ success?: boolean }>('/downloads/resume', {
      method: 'POST',
      body: { ids },
    });
    return { success: Boolean(res.ok && res.data?.success), error: res.error };
  }

  async removeDesktopDownloads(
    ids: string[],
    deleteFiles = false
  ): Promise<{ success: boolean; error?: string }> {
    const res = await this.requestDesktopRpc<{ success?: boolean }>('/downloads/remove', {
      method: 'POST',
      body: { ids, deleteFiles },
    });
    return { success: Boolean(res.ok && res.data?.success), error: res.error };
  }

  async toggleDesktopQueue(
    id: string,
    action: 'start' | 'stop'
  ): Promise<{ success: boolean; error?: string }> {
    const res = await this.requestDesktopRpc<{ success?: boolean }>('/queues/toggle', {
      method: 'POST',
      body: { id, enabled: action === 'start' },
    });
    return { success: Boolean(res.ok && res.data?.success), error: res.error };
  }

  /** Builds a direct authenticated HTTP pull request for a completed Desktop file over Wi-Fi. */
  getDesktopFilePullRequest(item: Pick<DownloadItem, 'id' | 'fileName'>): {
    url: string;
    fileName: string;
    headers: Record<string, string>;
  } | null {
    const cfg = this.getDesktopRpcConfig();
    if (!cfg) return null;
    const tokenHeader = cfg.headers['X-GRabbit-Token'];
    return {
      url: `${cfg.baseUrl}/downloads/${encodeURIComponent(item.id)}/file`,
      fileName: item.fileName || 'download.bin',
      headers: tokenHeader ? { 'X-GRabbit-Token': tokenHeader } : {},
    };
  }

  /**
   * Resolve platform metadata for a given URL.
   * 1. Tries paired Desktop RPC Bridge if enabled in Settings
   * 2. Tries remote API service if configured
   * 3. Falls back to standalone on-device stream & metadata extractors
   */
  async resolveMetadata(targetUrl: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    const { normalizedUrl, platform } = parsePlatformUrl(targetUrl);

    // 1. Check Desktop RPC Bridge first
    const { desktopBridge } = mobileSettingsManager.getSettings();
    if (desktopBridge.enabled && desktopBridge.host) {
      try {
        const rpcUrl = `http://${desktopBridge.host}:${desktopBridge.port}/media/resolve`;
        const res = await fetchWithTimeout(
          rpcUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-GRabbit-Token': desktopBridge.token,
            },
            body: JSON.stringify({ url: normalizedUrl }),
            signal,
          },
          2500
        );
        if (res.ok) {
          const data = await res.json();
          const meta: PlatformMetadata | undefined = data?.metadata ?? (data?.items ? data : undefined);
          if (meta && Array.isArray(meta.items) && meta.items.length > 0) {
            return meta;
          }
        }
      } catch (err) {
        console.warn('Desktop RPC metadata resolution failed, falling back to on-device extractor:', err);
      }
    }

    // 2. If explicit API client is configured, use remote API
    if (this.apiClient) {
      try {
        return await this.apiClient.resolveMetadata({ url: normalizedUrl, signal });
      } catch (err) {
        console.warn('API client resolution failed, using fallback scraper:', err);
      }
    }

    // 3. Standalone on-device resolution with real stream extraction
    try {
      return await this.resolveStandalone(normalizedUrl, platform, signal);
    } catch (err: any) {
      throw new Error(
        `Resolver unavailable — pair with desktop. Standalone extractor could not resolve ${PLATFORM_NAMES[platform] || platform}: ${err?.message || 'Remote mirrors unreachable'}. Connect to GRabbit Desktop in Settings for full yt-dlp extraction.`
      );
    }
  }

  /**
   * Resolve a direct playable media stream URL for downloading on mobile.
   */
  async resolveDirectStreamUrl(
    url: string,
    platform: PlatformId,
    option: MediaOption,
    signal?: AbortSignal
  ): Promise<{ streamUrl: string; headers?: Record<string, string>; sizeBytes?: number }> {
    // 1. If the option already carries a direct stream URL from standalone resolution
    if (option.directStreamUrl && option.directStreamUrl.startsWith('http')) {
      return {
        streamUrl: option.directStreamUrl,
        sizeBytes: option.estimatedSizeBytes,
      };
    }

    // 2. If Desktop RPC Bridge is enabled, ask Desktop's yt-dlp for the direct stream URL
    const { desktopBridge } = mobileSettingsManager.getSettings();
    if (desktopBridge.enabled && desktopBridge.host) {
      try {
        const rpcUrl = `http://${desktopBridge.host}:${desktopBridge.port}/media/stream`;
        const res = await fetchWithTimeout(
          rpcUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-GRabbit-Token': desktopBridge.token,
            },
            body: JSON.stringify({
              url,
              format: option.format,
              qualityId: option.qualityId,
            }),
            signal,
          },
          2500
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.streamUrl) {
            return {
              streamUrl: data.streamUrl,
              headers: data.headers,
              sizeBytes: data.sizeBytes,
            };
          }
        }
      } catch (err) {
        console.warn('Desktop RPC stream extraction failed, trying standalone extractor:', err);
      }
    }

    // 3. Run standalone extractor to get direct stream URLs
    const meta = await this.resolveStandalone(url, platform, signal);
    const first = meta.items[0];
    if (first && first.availableOptions.length > 0) {
      const matched =
        first.availableOptions.find(
          (o) => o.directStreamUrl && o.format === option.format && o.qualityId === option.qualityId
        ) ||
        first.availableOptions.find((o) => o.directStreamUrl && o.format === option.format) ||
        first.availableOptions.find((o) => o.directStreamUrl);

      if (matched?.directStreamUrl) {
        return {
          streamUrl: matched.directStreamUrl,
          sizeBytes: matched.estimatedSizeBytes,
        };
      }
    }

    // 4. If it is already a direct media file URL, return it
    if (/\.(mp4|m4a|mp3|webm|mkv|flac|wav|ogg|aac|mov)(\?|$)/i.test(url)) {
      return { streamUrl: url };
    }

    throw new Error(
      `Resolver unavailable — pair with desktop. Could not extract a direct media stream from ${PLATFORM_NAMES[platform] || platform}. Connect to GRabbit Desktop RPC Bridge in Settings for full yt-dlp extraction.`
    );
  }

  /**
   * Standalone resolver for mobile when backend is not configured or offline.
   */
  private async resolveStandalone(
    url: string,
    platform: PlatformId,
    signal?: AbortSignal
  ): Promise<PlatformMetadata> {
    switch (platform) {
      case 'youtube':
        return this.resolveYouTube(url, signal);
      case 'tiktok':
        return this.resolveTikTok(url, signal);
      case 'twitter':
        return this.resolveTwitter(url, signal);
      case 'reddit':
        return this.resolveReddit(url, signal);
      case 'instagram':
        return this.resolveInstagram(url, signal);
      case 'spotify':
        return this.resolveSpotify(url, signal);
      case 'soundcloud':
        return this.resolveSoundCloud(url, signal);
      default:
        return this.resolveGeneric(url, platform);
    }
  }

  /**
   * Extract YouTube metadata & direct stream URLs via Innertube Player API + Piped fallback.
   */
  private async resolveYouTube(url: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let title = 'YouTube Video';
    let author: string | undefined;
    let thumbnailUrl: string | undefined;
    let durationSeconds: number | undefined;
    const videoId = extractYouTubeVideoId(url);

    const extractedOptions: MediaOption[] = [];

    if (videoId) {
      thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // Try YouTube Innertube Player API with ANDROID_VR / IOS client profiles
      const clients = [
        {
          clientName: 'ANDROID_VR',
          clientVersion: '1.60.19',
          androidSdkVersion: 34,
          osName: 'Android',
          osVersion: '14',
          userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 14; en_US; Quest 3; Build/UP1A.231005.007.A1; Cronet/132.0.6808.3)',
        },
        {
          clientName: 'IOS',
          clientVersion: '19.45.4',
          deviceMake: 'Apple',
          deviceModel: 'iPhone16,2',
          osName: 'iPhone',
          osVersion: '18.1.0.22B83',
          userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
        },
      ];

      for (const client of clients) {
        if (extractedOptions.length > 0) break;
        try {
          const res = await fetchWithTimeout(
            'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': client.userAgent,
              },
              body: JSON.stringify({
                videoId,
                context: {
                  client: {
                    clientName: client.clientName,
                    clientVersion: client.clientVersion,
                    hl: 'en',
                    gl: 'US',
                    ...(client.androidSdkVersion ? { androidSdkVersion: client.androidSdkVersion } : {}),
                    ...(client.deviceMake ? { deviceMake: client.deviceMake, deviceModel: client.deviceModel } : {}),
                    osName: client.osName,
                    osVersion: client.osVersion,
                  },
                },
                contentCheckOk: true,
                racyCheckOk: true,
              }),
              signal,
            },
            7000
          );

          if (res.ok) {
            const data = await res.json();
            const vd = data?.videoDetails;
            if (vd) {
              if (vd.title) title = vd.title;
              if (vd.author) author = vd.author;
              if (vd.lengthSeconds) durationSeconds = Number(vd.lengthSeconds) || undefined;
              const thumbs = vd.thumbnail?.thumbnails;
              if (Array.isArray(thumbs) && thumbs.length > 0) {
                thumbnailUrl = thumbs[thumbs.length - 1]?.url || thumbnailUrl;
              }
            }

            const muxedFormats: any[] = data?.streamingData?.formats || [];
            const adaptiveFormats: any[] = data?.streamingData?.adaptiveFormats || [];

            // 1. Add muxed video+audio MP4 streams first (guaranteed playable with audio on mobile)
            for (const f of muxedFormats) {
              if (typeof f.url === 'string' && f.url.startsWith('http')) {
                const height = f.height || 360;
                const qId = `${height}p`;
                const size = f.contentLength ? parseInt(String(f.contentLength), 10) : undefined;
                if (!extractedOptions.some((o) => o.format === 'video' && o.qualityId === qId)) {
                  extractedOptions.push({
                    format: 'video',
                    qualityId: qId,
                    label: `${qId} MP4`,
                    extension: 'mp4',
                    estimatedSizeBytes: size,
                    directStreamUrl: f.url,
                  });
                }
              }
            }

            // 2. Add audio-only M4A / WebM streams from adaptiveFormats
            const audioStreams = adaptiveFormats
              .filter((f) => typeof f.url === 'string' && typeof f.mimeType === 'string' && f.mimeType.startsWith('audio/'))
              .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

            if (audioStreams.length > 0) {
              const bestM4a = audioStreams.find((f) => f.mimeType.includes('mp4')) || audioStreams[0];
              const size = bestM4a.contentLength ? parseInt(String(bestM4a.contentLength), 10) : undefined;
              const kbps = bestM4a.bitrate ? Math.round(bestM4a.bitrate / 1000) : 128;
              extractedOptions.push({
                format: 'audio',
                qualityId: 'm4a',
                label: `M4A Audio (${kbps} kbps)`,
                extension: 'm4a',
                estimatedSizeBytes: size,
                isOriginalQuality: true,
                directStreamUrl: bestM4a.url,
              });
              extractedOptions.push({
                format: 'audio',
                qualityId: 'mp3',
                label: `Audio (${kbps} kbps)`,
                extension: 'm4a',
                estimatedSizeBytes: size,
                directStreamUrl: bestM4a.url,
              });
            }
          }
        } catch {
          // Try next client profile
        }
      }

      // Fallback to Piped API if Innertube didn't return direct URLs
      if (extractedOptions.length === 0) {
        const pipedHosts = resolverPool.getOrdered('piped', DEFAULT_RESOLVER_ENDPOINTS.piped);
        for (const host of pipedHosts) {
          if (extractedOptions.length > 0) break;
          try {
            const res = await fetchWithTimeout(`${host}/streams/${videoId}`, { signal }, 6000);
            if (res.ok) {
              resolverPool.markSuccess('piped', host);
              const data = await res.json();
              if (data.title) title = data.title;
              if (data.uploader) author = data.uploader;
              if (data.thumbnailUrl) thumbnailUrl = data.thumbnailUrl;
              if (data.duration) durationSeconds = Number(data.duration) || undefined;

              const videoStreams: any[] = (data.videoStreams || []).filter((s: any) => s.videoOnly === false && s.url);
              for (const vs of videoStreams) {
                const qId = vs.quality || '720p';
                extractedOptions.push({
                  format: 'video',
                  qualityId: qId,
                  label: `${qId} MP4`,
                  extension: 'mp4',
                  directStreamUrl: vs.url,
                });
              }

              const audioStreams: any[] = (data.audioStreams || []).filter((s: any) => s.url);
              if (audioStreams[0]) {
                extractedOptions.push({
                  format: 'audio',
                  qualityId: 'm4a',
                  label: `Audio (${audioStreams[0].quality || '128 kbps'})`,
                  extension: 'm4a',
                  directStreamUrl: audioStreams[0].url,
                });
              }
            } else {
              resolverPool.markFailure('piped', host);
            }
          } catch {
            resolverPool.markFailure('piped', host);
          }
        }
      }
    }

    // Metadata fallback via oEmbed if title wasn't populated yet
    if (title === 'YouTube Video') {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const res = await fetchWithTimeout(oembedUrl, { signal }, 5000);
        if (res.ok) {
          const data = await res.json();
          if (data.title) title = data.title;
          if (data.author_name) author = data.author_name;
          if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
        }
      } catch {
        // Fallback
      }
    }

    const availableOptions = extractedOptions.length > 0 ? extractedOptions : standardMediaOptions();

    const item: MediaItem = {
      id: videoId ? `yt-${videoId}` : `yt-${Date.now()}`,
      title,
      uploader: author,
      durationSeconds,
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
      durationSeconds,
      items: [item],
    };
  }

  /**
   * Extract TikTok watermark-free HD video & MP3 audio via TikWM API.
   */
  private async resolveTikTok(url: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let title = 'TikTok Video';
    let author: string | undefined;
    let thumbnailUrl: string | undefined;
    let durationSeconds: number | undefined;
    const options: MediaOption[] = [];

    try {
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
      const res = await fetchWithTimeout(apiUrl, { signal }, 7000);
      if (res.ok) {
        const json = await res.json();
        const d = json?.data;
        if (d) {
          title = d.title || `TikTok by ${d.author?.nickname || d.author?.unique_id || 'Creator'}`;
          author = d.author?.nickname || d.author?.unique_id;
          thumbnailUrl = d.origin_cover || d.cover;
          durationSeconds = Number(d.duration) || undefined;

          if (d.hdplay) {
            options.push({
              format: 'video',
              qualityId: '1080p',
              label: 'HD (No Watermark)',
              extension: 'mp4',
              estimatedSizeBytes: Number(d.hd_size) || undefined,
              directStreamUrl: d.hdplay,
            });
          }
          if (d.play) {
            options.push({
              format: 'video',
              qualityId: '720p',
              label: 'SD (No Watermark)',
              extension: 'mp4',
              estimatedSizeBytes: Number(d.size) || undefined,
              directStreamUrl: d.play,
            });
          }
          if (d.wmplay) {
            options.push({
              format: 'video',
              qualityId: '480p',
              label: 'Watermarked MP4',
              extension: 'mp4',
              estimatedSizeBytes: Number(d.wm_size) || undefined,
              directStreamUrl: d.wmplay,
            });
          }
          if (d.music) {
            options.push({
              format: 'audio',
              qualityId: 'mp3',
              label: 'Original Sound (MP3)',
              extension: 'mp3',
              directStreamUrl: d.music,
            });
          }
        }
      }
    } catch {
      // Fallback
    }

    const availableOptions = options.length > 0 ? options : standardMediaOptions();
    const item: MediaItem = {
      id: `tt-${Date.now()}`,
      title,
      uploader: author,
      durationSeconds,
      platform: 'tiktok',
      url,
      thumbnailUrl,
      isDownloadable: true,
      availableOptions,
    };

    return {
      platform: 'tiktok',
      url,
      title,
      artistOrAuthor: author,
      thumbnailUrl,
      durationSeconds,
      items: [item],
    };
  }

  /**
   * Extract X / Twitter video & GIF streams via vxtwitter API.
   */
  private async resolveTwitter(url: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let title = 'X / Twitter Video';
    let author: string | undefined;
    let thumbnailUrl: string | undefined;
    let durationSeconds: number | undefined;
    const options: MediaOption[] = [];

    try {
      const parsed = new URL(url);
      const apiPath = parsed.pathname;
      const twitterHosts = resolverPool.getOrdered('twitter', DEFAULT_RESOLVER_ENDPOINTS.twitter);
      for (const host of twitterHosts) {
        if (options.length > 0) break;
        try {
          const res = await fetchWithTimeout(`${host}${apiPath}`, { signal }, 6000);
          if (res.ok) {
            resolverPool.markSuccess('twitter', host);
            const data = await res.json();
            if (data.text) title = data.text.split('\n')[0].slice(0, 90) || title;
            if (data.user_name) author = `${data.user_name} (@${data.user_screen_name || ''})`;
            const mediaList: any[] = data.media_extended || [];
            for (const m of mediaList) {
              if ((m.type === 'video' || m.type === 'gif') && m.url) {
                if (!thumbnailUrl && m.thumbnail_url) thumbnailUrl = m.thumbnail_url;
                if (!durationSeconds && m.duration_millis) {
                  durationSeconds = Math.round(m.duration_millis / 1000);
                }
                const height = m.size?.height || 720;
                options.push({
                  format: 'video',
                  qualityId: `${height}p`,
                  label: `${height}p MP4`,
                  extension: 'mp4',
                  directStreamUrl: m.url,
                });
              }
            }
          } else {
            resolverPool.markFailure('twitter', host);
          }
        } catch {
          resolverPool.markFailure('twitter', host);
        }
      }
    } catch {
      // Fallback
    }

    const availableOptions = options.length > 0 ? options : standardMediaOptions();
    const item: MediaItem = {
      id: `tw-${Date.now()}`,
      title,
      uploader: author,
      durationSeconds,
      platform: 'twitter',
      url,
      thumbnailUrl,
      isDownloadable: true,
      availableOptions,
    };

    return {
      platform: 'twitter',
      url,
      title,
      artistOrAuthor: author,
      thumbnailUrl,
      durationSeconds,
      items: [item],
    };
  }

  /**
   * Extract Reddit video streams via Reddit JSON API.
   */
  private async resolveReddit(url: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let title = 'Reddit Video';
    let author: string | undefined;
    let thumbnailUrl: string | undefined;
    let durationSeconds: number | undefined;
    const options: MediaOption[] = [];

    try {
      const cleanUrl = url.split('?')[0].replace(/\/$/, '');
      const res = await fetchWithTimeout(
        `${cleanUrl}.json`,
        {
          headers: { 'User-Agent': MOBILE_USER_AGENT },
          signal,
        },
        7000
      );
      if (res.ok) {
        const json = await res.json();
        const post = json?.[0]?.data?.children?.[0]?.data;
        if (post) {
          if (post.title) title = post.title;
          if (post.author) author = `u/${post.author}`;
          if (post.thumbnail && post.thumbnail.startsWith('http')) thumbnailUrl = post.thumbnail;
          const rv = post.secure_media?.reddit_video || post.media?.reddit_video;
          if (rv?.fallback_url) {
            durationSeconds = rv.duration || undefined;
            const height = rv.height || 720;
            options.push({
              format: 'video',
              qualityId: `${height}p`,
              label: `${height}p MP4`,
              extension: 'mp4',
              directStreamUrl: rv.fallback_url,
            });
          }
        }
      }
    } catch {
      // Fallback
    }

    const availableOptions = options.length > 0 ? options : standardMediaOptions();
    const item: MediaItem = {
      id: `rd-${Date.now()}`,
      title,
      uploader: author,
      durationSeconds,
      platform: 'reddit',
      url,
      thumbnailUrl,
      isDownloadable: true,
      availableOptions,
    };

    return {
      platform: 'reddit',
      url,
      title,
      artistOrAuthor: author,
      thumbnailUrl,
      durationSeconds,
      items: [item],
    };
  }

  /**
   * Extract Instagram Reel / Post video via embed & opengraph scraping.
   */
  private async resolveInstagram(url: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let title = 'Instagram Reel';
    let author: string | undefined;
    let thumbnailUrl: string | undefined;
    const options: MediaOption[] = [];

    try {
      const parsed = new URL(url);
      const igHosts = resolverPool.getOrdered('instagram', DEFAULT_RESOLVER_ENDPOINTS.instagram);
      for (const host of igHosts) {
        if (options.length > 0) break;
        try {
          const embedUrl = `${host}${parsed.pathname}`;
          const res = await fetchWithTimeout(
            embedUrl,
            {
              headers: { 'User-Agent': 'TelegramBot (like TwitterBot)' },
              signal,
            },
            6000
          );
          if (res.ok) {
            resolverPool.markSuccess('instagram', host);
            const html = await res.text();
            const videoMatch = /<meta\s+property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i.exec(html);
            const titleMatch = /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i.exec(html);
            const imageMatch = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html);
            const authorMatch = /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i.exec(html);

            if (titleMatch?.[1]) title = titleMatch[1].slice(0, 90);
            if (authorMatch?.[1]) author = authorMatch[1];
            if (imageMatch?.[1]) thumbnailUrl = imageMatch[1].replace(/&amp;/g, '&');
            if (videoMatch?.[1]) {
              const directUrl = videoMatch[1].replace(/&amp;/g, '&');
              const fullUrl = directUrl.startsWith('http') ? directUrl : `${host}${directUrl}`;
              options.push({
                format: 'video',
                qualityId: '1080p',
                label: 'Original Reel (MP4)',
                extension: 'mp4',
                directStreamUrl: fullUrl,
              });
            }
          } else {
            resolverPool.markFailure('instagram', host);
          }
        } catch {
          resolverPool.markFailure('instagram', host);
        }
      }
    } catch {
      // Fallback
    }

    const availableOptions = options.length > 0 ? options : standardMediaOptions();
    const item: MediaItem = {
      id: `ig-${Date.now()}`,
      title,
      uploader: author,
      platform: 'instagram',
      url,
      thumbnailUrl,
      isDownloadable: true,
      availableOptions,
    };

    return {
      platform: 'instagram',
      url,
      title,
      artistOrAuthor: author,
      thumbnailUrl,
      items: [item],
    };
  }

  /**
   * Resolve SoundCloud track metadata and progressive audio stream.
   */
  private async resolveSoundCloud(url: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let title = 'SoundCloud Track';
    let author: string | undefined;
    let thumbnailUrl: string | undefined;

    try {
      const oembedRes = await fetchWithTimeout(
        `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
        { signal },
        6000
      );
      if (oembedRes.ok) {
        const data = await oembedRes.json();
        if (data.title) title = data.title;
        if (data.author_name) author = data.author_name;
        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
      }
    } catch {
      // ignore
    }

    // Match audio stream via YouTube Innertube search if direct SC stream requires client_id
    const matchedStream = await this.searchYouTubeAudioStream(`${author || ''} ${title}`.trim(), signal);
    const availableOptions = audioOptions().map((opt) =>
      matchedStream
        ? {
            ...opt,
            extension: 'm4a',
            directStreamUrl: matchedStream.streamUrl,
            estimatedSizeBytes: matchedStream.sizeBytes,
          }
        : opt
    );

    const item: MediaItem = {
      id: `sc-${Date.now()}`,
      title,
      uploader: author,
      platform: 'soundcloud',
      url,
      thumbnailUrl,
      isDownloadable: true,
      availableOptions,
    };

    return {
      platform: 'soundcloud',
      url,
      title,
      artistOrAuthor: author,
      thumbnailUrl,
      items: [item],
    };
  }

  /**
   * Search YouTube Innertube for a track query and extract its direct audio stream URL.
   */
  private async searchYouTubeAudioStream(
    query: string,
    signal?: AbortSignal
  ): Promise<{ streamUrl: string; sizeBytes?: number; durationSeconds?: number } | null> {
    if (!query || query === 'Spotify Track' || query === 'SoundCloud Track') return null;
    try {
      const searchRes = await fetchWithTimeout(
        'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' } },
            query: `${query} official audio`,
          }),
          signal,
        },
        7000
      );
      if (!searchRes.ok) return null;
      const searchData = await searchRes.json();
      const sections =
        searchData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
      let videoId: string | null = null;
      for (const sec of sections) {
        for (const item of sec?.itemSectionRenderer?.contents || []) {
          if (item?.videoRenderer?.videoId) {
            videoId = item.videoRenderer.videoId;
            break;
          }
        }
        if (videoId) break;
      }
      if (!videoId) return null;

      const ytMeta = await this.resolveYouTube(`https://www.youtube.com/watch?v=${videoId}`, signal);
      const firstItem = ytMeta.items[0];
      const audioOpt =
        firstItem?.availableOptions.find((o) => o.format === 'audio' && o.directStreamUrl) ||
        firstItem?.availableOptions.find((o) => o.directStreamUrl);
      if (audioOpt?.directStreamUrl) {
        return {
          streamUrl: audioOpt.directStreamUrl,
          sizeBytes: audioOpt.estimatedSizeBytes,
          durationSeconds: firstItem?.durationSeconds,
        };
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async resolveSpotify(url: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let title = 'Spotify Track';
    let artistOrAuthor: string | undefined;
    let thumbnailUrl: string | undefined;

    // 1. Try Spotify oEmbed first (fast, reliable JSON with title & thumbnail)
    try {
      const oembedRes = await fetchWithTimeout(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
        { signal },
        6000
      );
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        if (oembed.title) title = oembed.title;
        if (oembed.thumbnail_url) thumbnailUrl = oembed.thumbnail_url;
      }
    } catch {
      // ignore
    }

    // 2. Also scrape track page HTML for artist / album details
    try {
      const res = await fetchWithTimeout(url, { signal }, 6000);
      if (res.ok) {
        const html = await res.text();
        const details = parseTrackPage(html);
        if (details.albumName && title === 'Spotify Track') {
          title = details.albumName;
        }
        if (details.coverUrl && !thumbnailUrl) {
          thumbnailUrl = details.coverUrl;
        }
        const ogDesc = /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i.exec(html);
        if (ogDesc?.[1]) {
          artistOrAuthor = ogDesc[1].split('·')[0]?.trim();
        }
      }
    } catch {
      // Offline or network error - continue with sensible defaults
    }

    // 3. Match to YouTube audio stream so standalone mobile downloads real playable audio
    const searchQuery = artistOrAuthor ? `${artistOrAuthor} - ${title}` : title;
    const matchedAudio = await this.searchYouTubeAudioStream(searchQuery, signal);

    const availableOptions = spotifyAudioOptions().map((opt) =>
      matchedAudio
        ? {
            ...opt,
            extension: 'm4a',
            directStreamUrl: matchedAudio.streamUrl,
            estimatedSizeBytes: matchedAudio.sizeBytes,
          }
        : opt
    );

    const item: MediaItem = {
      id: `spotify-${Date.now()}`,
      title,
      uploader: artistOrAuthor,
      durationSeconds: matchedAudio?.durationSeconds,
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
      durationSeconds: matchedAudio?.durationSeconds,
      items: [item],
    };
  }

  private resolveGeneric(url: string, platform: PlatformId): PlatformMetadata {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').filter(Boolean).pop() || 'Media Download';
    const isAudio = /\.(mp3|m4a|flac|wav|ogg)$/i.test(pathname);
    const isDirectMedia = /\.(mp4|m4a|mp3|webm|mkv|flac|wav|ogg|aac|mov)$/i.test(pathname);

    const availableOptions = (isAudio ? audioOptions() : standardMediaOptions()).map((opt) =>
      isDirectMedia ? { ...opt, directStreamUrl: url } : opt
    );

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
