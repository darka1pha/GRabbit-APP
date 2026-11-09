import type { PlatformMetadata } from '../../../shared/types';
import { YtDlpRunner } from '../ytdlp-runner';
import type { DownloadRequest, DownloadResult, IPlatformAdapter } from './types';
import { YtDlpSiteAdapter } from './ytdlp-generic';
import { audioOptions, COLLECTION_MAX_ITEMS } from './youtube';

export class SoundCloudAdapter implements IPlatformAdapter {
  public readonly platformId = 'soundcloud' as const;
  private single: YtDlpSiteAdapter;

  constructor(private ytdlp: YtDlpRunner = new YtDlpRunner()) {
    this.single = new YtDlpSiteAdapter('soundcloud', 'SoundCloud', { audioOnly: true }, ytdlp);
  }

  /** Sets / playlists (soundcloud.com/<artist>/sets/<name>). */
  public static isSetUrl(url: string): boolean {
    try {
      return /\/sets\/[^/]+/.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  public async fetchMetadata(url: string): Promise<PlatformMetadata> {
    if (!SoundCloudAdapter.isSetUrl(url)) return this.single.fetchMetadata(url);

    const { title, uploader, entries } = await this.ytdlp.getPlaylistEntries(url, COLLECTION_MAX_ITEMS);
    return {
      platform: this.platformId,
      url,
      title: title || 'SoundCloud Set',
      artistOrAuthor: uploader,
      isAuthorized: true,
      isCollection: true,
      items: entries.map((e) => ({
        id: e.id,
        title: e.title,
        uploader: e.channel,
        durationSeconds: e.duration,
        thumbnailUrl: e.thumbnail,
        platform: this.platformId,
        url: e.url,
        isDownloadable: true,
        availableOptions: audioOptions(),
      })),
    };
  }

  public download(request: DownloadRequest): Promise<DownloadResult> {
    return this.single.download({ ...request, format: 'audio' });
  }
}
