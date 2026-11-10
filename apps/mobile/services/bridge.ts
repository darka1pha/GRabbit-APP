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

  /**
   * Send a download request directly to the paired Desktop PC over Wi-Fi RPC Bridge.
   */
  async sendToDesktop(
    url: string,
    options?: { fileName?: string; referrer?: string; startPaused?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const { desktopBridge } = mobileSettingsManager.getSettings();
    if (!desktopBridge.enabled || !desktopBridge.host) {
      return { success: false, error: 'Desktop RPC Bridge is not enabled in Settings.' };
    }
    try {
      const rpcUrl = `http://${desktopBridge.host}:${desktopBridge.port}/downloads/add`;
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GRabbit-Token': desktopBridge.token,
        },
        body: JSON.stringify({
          url,
          fileName: options?.fileName,
          referrer: options?.referrer,
          startPaused: options?.startPaused,
        }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        return { success: true };
      }
      return { success: false, error: data?.error || `Desktop returned HTTP ${res.status}` };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || `Could not reach Desktop at ${desktopBridge.host}:${desktopBridge.port}`,
      };
    }
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
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GRabbit-Token': desktopBridge.token,
          },
          body: JSON.stringify({ url: normalizedUrl }),
          signal,
        });
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
    return this.resolveStandalone(normalizedUrl, platform, signal);
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
        const res = await fetch(rpcUrl, {
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
        });
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
      `Could not extract a direct media stream from ${PLATFORM_NAMES[platform] || platform}. Connect to GRabbit Desktop RPC Bridge in Settings for full yt-dlp extraction.`
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
          const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
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
          });

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
        const pipedHosts = [
          'https://pipedapi.kavin.rocks',
          'https://api.piped.private.coffee',
        ];
        for (const host of pipedHosts) {
          if (extractedOptions.length > 0) break;
          try {
            const res = await fetch(`${host}/streams/${videoId}`, { signal });
            if (res.ok) {
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
            }
          } catch {
            // ignore
          }
        }
      }
    }

    // Metadata fallback via oEmbed if title wasn't populated yet
    if (title === 'YouTube Video') {
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
      const res = await fetch(apiUrl, { signal });
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
      const res = await fetch(`https://api.vxtwitter.com${apiPath}`, { signal });
      if (res.ok) {
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
      const res = await fetch(`${cleanUrl}.json`, {
        headers: { 'User-Agent': MOBILE_USER_AGENT },
        signal,
      });
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
      const embedUrl = `https://www.ddinstagram.com${parsed.pathname}`;
      const res = await fetch(embedUrl, {
        headers: { 'User-Agent': 'TelegramBot (like TwitterBot)' },
        signal,
      });
      if (res.ok) {
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
          const fullUrl = directUrl.startsWith('http') ? directUrl : `https://www.ddinstagram.com${directUrl}`;
          options.push({
            format: 'video',
            qualityId: '1080p',
            label: 'Original Reel (MP4)',
            extension: 'mp4',
            directStreamUrl: fullUrl,
          });
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
      const oembedRes = await fetch(
        `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
        { signal }
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
        ? { ...opt, directStreamUrl: matchedStream.streamUrl, estimatedSizeBytes: matchedStream.sizeBytes }
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
      const searchRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' } },
          query: `${query} official audio`,
        }),
        signal,
      });
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
      const oembedRes = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
        { signal }
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
      const res = await fetch(url, { signal });
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
