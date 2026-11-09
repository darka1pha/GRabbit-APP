import type { MediaItem, PlatformId, PlatformMetadata } from '../../shared/types';
import { YtDlpRunner } from './ytdlp-runner';
import { parsePlatformUrl } from './url-parser';
import type { IPlatformAdapter } from './platforms/types';
import { getYouTubeYtDlpExtraArgs, standardMediaOptions, YouTubeAdapter } from './platforms/youtube';
import { SpotifyAdapter } from './platforms/spotify';
import { SoundCloudAdapter } from './platforms/soundcloud';
import { instagramArgs, YtDlpSiteAdapter } from './platforms/ytdlp-generic';

export class PlatformRouter {
  private adapters = new Map<PlatformId, IPlatformAdapter>();

  constructor(private ytdlp: YtDlpRunner = new YtDlpRunner()) {
    const list: IPlatformAdapter[] = [
      new YouTubeAdapter(ytdlp),
      new SpotifyAdapter(ytdlp),
      new SoundCloudAdapter(ytdlp),
      new YtDlpSiteAdapter('instagram', 'Instagram', { extraArgs: instagramArgs }, ytdlp),
      new YtDlpSiteAdapter('tiktok', 'TikTok', {}, ytdlp),
      new YtDlpSiteAdapter('twitter', 'X', {}, ytdlp),
      new YtDlpSiteAdapter('reddit', 'Reddit', {}, ytdlp),
      new YtDlpSiteAdapter('generic', 'Web', {}, ytdlp),
    ];
    for (const adapter of list) this.adapters.set(adapter.platformId, adapter);
  }

  public getAdapter(platform: PlatformId): IPlatformAdapter {
    return this.adapters.get(platform) ?? this.adapters.get('generic')!;
  }

  public async resolve(url: string): Promise<PlatformMetadata> {
    const parsed = parsePlatformUrl(url);
    return this.getAdapter(parsed.platform).fetchMetadata(parsed.normalizedUrl);
  }

  public async search(query: string, limit = 15): Promise<MediaItem[]> {
    const results = await this.ytdlp.search(query, limit, getYouTubeYtDlpExtraArgs());
    return results.map((r) => ({
      id: r.id,
      title: r.title,
      uploader: r.channel,
      durationSeconds: r.duration,
      thumbnailUrl: r.thumbnail,
      platform: 'youtube' as const,
      url: r.url,
      isDownloadable: true,
      availableOptions: standardMediaOptions(),
    }));
  }
}
