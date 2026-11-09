import { PLATFORMS } from '../config/constants.js';
import { IPlatformAdapter, PlatformMetadata } from '../core/types/platform.js';
import { UnsupportedPlatformError } from '../core/errors/domain-errors.js';
import { parsePlatformUrl, ParsedPlatformUrl } from './url-parser.js';
import { YouTubeAdapter } from './youtube/youtube-adapter.js';
import { SpotifyAdapter } from './spotify/spotify-adapter.js';
import { InstagramAdapter } from './instagram/instagram-adapter.js';
import { SoundCloudAdapter } from './soundcloud/soundcloud-adapter.js';
import { SocialVideoAdapter } from './social/social-video-adapter.js';

export class PlatformRouter {
  private adapters: Map<string, IPlatformAdapter> = new Map();

  constructor(customAdapters?: IPlatformAdapter[]) {
    if (customAdapters) {
      for (const adapter of customAdapters) {
        this.adapters.set(adapter.platformId, adapter);
      }
    } else {
      const yt = new YouTubeAdapter();
      const sp = new SpotifyAdapter();
      const ig = new InstagramAdapter();
      const sc = new SoundCloudAdapter();
      const tt = new SocialVideoAdapter({
        platformId: PLATFORMS.TIKTOK,
        hostnames: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'],
        displayLabel: 'TikTok',
      });
      const tw = new SocialVideoAdapter({
        platformId: PLATFORMS.TWITTER,
        hostnames: [
          'twitter.com',
          'www.twitter.com',
          'mobile.twitter.com',
          'x.com',
          'www.x.com',
          'vxtwitter.com',
          'fxtwitter.com',
        ],
        displayLabel: 'X (Twitter)',
      });
      const rd = new SocialVideoAdapter({
        platformId: PLATFORMS.REDDIT,
        hostnames: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'v.redd.it', 'redd.it'],
        displayLabel: 'Reddit',
      });

      this.adapters.set(yt.platformId, yt);
      this.adapters.set(sp.platformId, sp);
      this.adapters.set(ig.platformId, ig);
      this.adapters.set(sc.platformId, sc);
      this.adapters.set(tt.platformId, tt);
      this.adapters.set(tw.platformId, tw);
      this.adapters.set(rd.platformId, rd);
    }
  }

  public resolveAdapter(url: string): { adapter: IPlatformAdapter; parsed: ParsedPlatformUrl } {
    const parsed = parsePlatformUrl(url);
    const adapter = this.adapters.get(parsed.platform);

    if (!adapter) {
      throw new UnsupportedPlatformError(`No adapter registered for platform: ${parsed.platform}`);
    }

    return { adapter, parsed };
  }

  public async getMetadata(url: string): Promise<PlatformMetadata> {
    const { adapter, parsed } = this.resolveAdapter(url);
    return adapter.fetchMetadata(parsed.normalizedUrl);
  }

  public getAdapterByPlatform(platformId: string): IPlatformAdapter | undefined {
    return this.adapters.get(platformId);
  }
}
