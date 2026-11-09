import type { MediaOption, PlatformId, PlatformMetadata } from '../../../shared/types';
import { getMediaConfig } from '../config';
import { YtDlpRunner } from '../ytdlp-runner';
import type { DownloadRequest, DownloadResult, IPlatformAdapter } from './types';
import { audioOptions, cookieArgs, extractMediaOptionsFromFormats, ytdlpDownload } from './youtube';

/**
 * Any site yt-dlp understands: Instagram, TikTok, X, Reddit and the 1000+ sites of its generic extractors.
 * Platform-specific behaviour is limited to extra arguments and display labels.
 */
export class YtDlpSiteAdapter implements IPlatformAdapter {
  constructor(
    public readonly platformId: PlatformId,
    private readonly displayLabel: string,
    private readonly options: { audioOnly?: boolean; extraArgs?: () => string[] } = {},
    private readonly ytdlp: YtDlpRunner = new YtDlpRunner()
  ) {}

  private args(): string[] {
    return [...(this.options.extraArgs?.() ?? []), ...cookieArgs()];
  }

  public async fetchMetadata(url: string): Promise<PlatformMetadata> {
    const raw = await this.ytdlp.getMetadata(url, this.args());
    const availableOptions: MediaOption[] = this.options.audioOnly
      ? audioOptions(raw.filesize || raw.filesize_approx)
      : extractMediaOptionsFromFormats(raw, { includeAudio: true, fallbackStandardQualities: false });
    const title = raw.title || `${this.displayLabel} media`;
    const author = raw.uploader || raw.channel;

    return {
      platform: this.platformId,
      url,
      title,
      artistOrAuthor: author,
      durationSeconds: raw.duration,
      thumbnailUrl: raw.thumbnail,
      isAuthorized: true,
      items: [
        {
          id: raw.id || `${this.platformId}-media`,
          title,
          uploader: author,
          durationSeconds: raw.duration,
          thumbnailUrl: raw.thumbnail,
          platform: this.platformId,
          url: raw.webpage_url || url,
          isDownloadable: !raw.is_live,
          unavailableReason: raw.is_live ? 'Live streams cannot be downloaded' : undefined,
          availableOptions,
        },
      ],
    };
  }

  public download(request: DownloadRequest): Promise<DownloadResult> {
    return ytdlpDownload(this.ytdlp, request, this.args());
  }
}

export function instagramArgs(): string[] {
  const sessionId = getMediaConfig().instagramSessionId;
  return sessionId ? ['--add-header', `Cookie: sessionid=${sessionId}`] : [];
}
