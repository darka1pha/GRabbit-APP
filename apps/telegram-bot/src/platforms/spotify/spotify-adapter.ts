import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COLLECTION_MAX_ITEMS, PLATFORMS } from '../../config/constants.js';
import { getConfig } from '../../config/env.js';
import {
  IPlatformAdapter,
  PlatformMetadata,
  DownloadRequest,
  DownloadResult,
  MediaItem,
  MediaOption,
} from '../../core/types/platform.js';
import { UnauthorizedContentError } from '../../core/errors/domain-errors.js';
import { logger } from '../../observability/logger.js';
import { YtDlpRunner } from '../../services/downloads/ytdlp-runner.js';
import { AudioContainer, FFmpegRunner } from '../../services/media/ffmpeg-runner.js';
import { sanitizeFilename } from '../../security/filename.js';
import { getYouTubeYtDlpExtraArgs } from '../youtube/youtube-adapter.js';
import { pickBestMatch, SpotifyTrackInfo } from './track-matcher.js';
import {
  SpotifyClient,
  spotifyEmbedImage,
  spotifyEmbedTracks,
  type SpotifyCollectionTrack,
  type SpotifyEmbedEntity,
  type SpotifyOEmbed,
  type SpotifyRelease,
} from '@grabbit/core/media/spotify';

const MATCH_CANDIDATES = 8;

let warnedApiRefused = false;

/**
 * Formats offered for a Spotify track. MP3 comes first so it stays the default for
 * auto-download preferences and album/playlist downloads.
 * - mp3: YouTube's stream re-encoded to MP3 (plays everywhere)
 * - m4a: YouTube's AAC stream kept as-is, with no second lossy encode
 */
export function spotifyAudioOptions(): MediaOption[] {
  return [
    { format: 'audio', qualityId: 'mp3', label: 'Audio (MP3)', extension: 'mp3' },
    {
      format: 'audio',
      qualityId: 'm4a',
      label: 'Audio (M4A, original quality)',
      extension: 'm4a',
      isOriginalQuality: true,
    },
  ];
}

export class SpotifyAdapter implements IPlatformAdapter {
  public readonly platformId = PLATFORMS.SPOTIFY;
  private ytdlp: YtDlpRunner;
  private ffmpeg: FFmpegRunner;

  constructor(ytdlpRunner?: YtDlpRunner, ffmpegRunner?: FFmpegRunner) {
    this.ytdlp = ytdlpRunner || new YtDlpRunner();
    this.ffmpeg = ffmpegRunner || new FFmpegRunner();
  }

  public matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host === 'open.spotify.com' || host === 'spotify.com';
    } catch {
      return false;
    }
  }

  public normalizeUrl(url: string): string {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  }

  public async fetchMetadata(url: string): Promise<PlatformMetadata> {
    return (await this.resolve(url)).meta;
  }

  /** Metadata plus the individual artist names (needed for matching; artist names may contain commas). */
  private async resolve(url: string): Promise<{ meta: PlatformMetadata; artists: string[] }> {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    // Handle optional /intl-xx/ prefix in Spotify links
    const cleanParts = pathParts[0]?.startsWith('intl-') ? pathParts.slice(1) : pathParts;
    const entityType = cleanParts[0] || 'track';
    const entityId = cleanParts[1] || 'unknown';

    // Query Spotify oEmbed service for canonical metadata
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    let title = `${entityType.toUpperCase()}: ${entityId}`;
    let artist = 'Spotify';
    let thumbnailUrl: string | undefined;
    let durationSeconds: number | undefined;
    let artists: string[] = [];

    try {
      const response = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'gRabbit-Telegram-Bot/1.0' },
      });

      if (response.ok) {
        const data = (await response.json()) as SpotifyOEmbed;
        title = data.title || title;
        thumbnailUrl = data.thumbnail_url;
      }
    } catch (err) {
      logger.warn({ err, url }, 'Failed to fetch Spotify oEmbed metadata');
    }

    // Albums / playlists: list their tracks when Spotify API credentials are configured
    if (entityType === 'album' || entityType === 'playlist') {
      let tracks = await this.fetchCollectionTracks(entityType, entityId).catch((err) => {
        logger.debug({ err, entityId }, 'Spotify collection track listing failed');
        return null;
      });
      let embed: SpotifyEmbedEntity | null = null;
      if (!tracks || tracks.length === 0) {
        embed = await this.fetchEmbedEntity(entityType, entityId);
        tracks = embed ? this.embedCollectionTracks(embed) : null;
      }
      if (tracks && tracks.length > 0) {
        const collectionThumb = thumbnailUrl || (embed ? this.embedImage(embed) : undefined);
        return {
          artists: [],
          meta: {
            platform: this.platformId,
            url,
            title: embed?.name || embed?.title || title,
            artistOrAuthor:
              entityType === 'album' ? embed?.subtitle || tracks[0].uploader : undefined,
            thumbnailUrl: collectionThumb,
            isAuthorized: true,
            isCollection: true,
            items: tracks.map((t) => ({ ...t, thumbnailUrl: collectionThumb })),
          },
        };
      }
    }

    // Attempt to enrich with Spotify Web API if credentials are configured
    if (entityType === 'track') {
      try {
        const accessToken = await this.getAccessToken();
        if (accessToken) {
          const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${entityId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (trackRes.ok) {
            const trackData = (await trackRes.json()) as {
              name?: string;
              artists?: { name: string }[];
              duration_ms?: number;
              album?: { images?: { url: string }[] };
            };
            if (trackData.name) title = trackData.name;
            if (trackData.artists && trackData.artists.length > 0) {
              artists = trackData.artists.map((a) => a.name).filter(Boolean);
            }
            if (trackData.duration_ms) {
              durationSeconds = Math.round(trackData.duration_ms / 1000);
            }
            if (trackData.album?.images?.[0]?.url) {
              thumbnailUrl = trackData.album.images[0].url;
            }
          } else {
            this.warnApiRefused(trackRes.status);
          }
        }
      } catch (err) {
        logger.debug({ err, entityId }, 'Optional Spotify API enrichment failed');
      }

      // No usable API data (no credentials, or Spotify refused them): read the public embed page
      if (artists.length === 0 || !durationSeconds) {
        const embed = await this.fetchEmbedEntity('track', entityId);
        if (embed) {
          title = embed.name || embed.title || title;
          if (artists.length === 0 && embed.artists?.length) {
            artists = embed.artists.map((a) => a.name || '').filter(Boolean);
          }
          if (!durationSeconds && embed.duration) {
            durationSeconds = Math.round(embed.duration / 1000);
          }
          thumbnailUrl = thumbnailUrl || this.embedImage(embed);
        }
      }

      if (artists.length > 0) artist = artists.join(', ');
    }

    const isTrack = entityType === 'track';
    const availableOptions: MediaOption[] = isTrack ? spotifyAudioOptions() : [];

    return {
      artists,
      meta: {
        platform: this.platformId,
        url,
        title,
        artistOrAuthor: artist,
        durationSeconds,
        thumbnailUrl,
        isAuthorized: true,
        items: [
          {
            id: entityId,
            title,
            uploader: artist,
            durationSeconds,
            thumbnailUrl,
            platform: this.platformId,
            url,
            isDownloadable: isTrack,
            unavailableReason: isTrack
              ? undefined
              : 'Please send an individual Spotify track link to download MP3 audio.',
            availableOptions,
          },
        ],
      },
    };
  }

  private warnApiRefused(status: number): void {
    if (warnedApiRefused) return;
    warnedApiRefused = true;
    logger.warn(
      { status },
      'Spotify Web API refused the configured credentials (developer apps now need the owner to have Spotify Premium); falling back to the public embed page'
    );
  }

  /** Public embed page entity (works without API credentials). */
  private fetchEmbedEntity(entityType: string, entityId: string): Promise<SpotifyEmbedEntity | null> {
    return this.spotify().fetchEmbedEntity(entityType, entityId);
  }

  private embedImage(entity: SpotifyEmbedEntity): string | undefined {
    return spotifyEmbedImage(entity);
  }

  private embedCollectionTracks(entity: SpotifyEmbedEntity): MediaItem[] {
    return spotifyEmbedTracks(entity).map((t) => this.toItem(t));
  }

  private toItem(t: SpotifyCollectionTrack): MediaItem {
    return {
      id: t.id,
      title: t.title,
      uploader: t.artists,
      durationSeconds: t.durationSeconds,
      platform: this.platformId,
      url: t.url,
      isDownloadable: true,
      availableOptions: spotifyAudioOptions(),
    };
  }

  /** Shared Spotify client (Web API, embed and track pages), with the current credentials. */
  private spotify(): SpotifyClient {
    const { SPOTIFY_CLIENT_ID: clientId, SPOTIFY_CLIENT_SECRET: clientSecret } = getConfig();
    return new SpotifyClient({
      clientId,
      clientSecret,
      maxCollectionItems: COLLECTION_MAX_ITEMS,
      log: (level, data, message) => logger[level](data, message),
    });
  }

  /** Searches YouTube and returns the URL of the result that best matches the Spotify track. */
  private async findBestYouTubeMatch(
    track: SpotifyTrackInfo,
    searchQuery: string
  ): Promise<string | null> {
    // YouTube Music "Songs" (official masters) and regular YouTube, searched in parallel
    const [music, regular] = await Promise.allSettled([
      this.ytdlp.searchYouTubeMusicSongs(searchQuery, MATCH_CANDIDATES),
      this.ytdlp.search(searchQuery, MATCH_CANDIDATES, getYouTubeYtDlpExtraArgs()),
    ]);
    if (regular.status === 'rejected') {
      logger.warn({ err: regular.reason, searchQuery }, 'YouTube candidate search failed');
    }
    const candidates = [
      ...(music.status === 'fulfilled' ? music.value : []),
      ...(regular.status === 'fulfilled' ? regular.value : []),
    ];

    const best = pickBestMatch(track, candidates);
    if (!best) return null;
    logger.info(
      {
        spotify: `${track.artists.join(', ')} - ${track.title}`,
        durationSeconds: track.durationSeconds,
        matched: best.candidate.title,
        channel: best.candidate.channel,
        source: best.candidate.source ?? 'youtube',
        matchedDuration: best.candidate.duration,
        score: Number(best.score.toFixed(2)),
      },
      'Matched Spotify track to YouTube'
    );
    return best.candidate.url;
  }

  /** Client-credentials token, or null when no API credentials are configured. */
  private getAccessToken(): Promise<string | null> {
    return this.spotify().getAccessToken();
  }

  /** Every track of an album or playlist (following the API's pages), as downloadable items. */
  private async fetchCollectionTracks(entityType: 'album' | 'playlist', entityId: string): Promise<MediaItem[] | null> {
    const tracks = await this.spotify().fetchCollectionTracks(entityType, entityId);
    return tracks ? tracks.map((t) => this.toItem(t)) : null;
  }

  public async download(request: DownloadRequest): Promise<DownloadResult> {
    const { meta, artists } = await this.resolve(request.url);
    const item = meta.items[0];
    if (!item || !item.isDownloadable) {
      throw new UnauthorizedContentError(
        'Only individual Spotify tracks can be matched and downloaded as audio.'
      );
    }

    const searchQuery =
      artists.length > 0 ? `${artists.slice(0, 2).join(' ')} - ${meta.title}` : meta.title;

    const matchedUrl = await this.findBestYouTubeMatch(
      { title: meta.title, artists, durationSeconds: meta.durationSeconds },
      searchQuery
    );

    // m4a: take YouTube's AAC stream and keep it (yt-dlp copies AAC into .m4a without
    // re-encoding). mp3 (default, also for legacy 'bestaudio' jobs): best stream → MP3 VBR V0.
    const container: AudioContainer = request.qualityId === 'm4a' ? 'm4a' : 'mp3';
    const formatSelector =
      container === 'm4a' ? 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best' : 'bestaudio/best';

    const outputTemplate = `${request.outputPath}/%(title).100s-%(id)s.%(ext)s`;
    const extraArgs = [
      ...getYouTubeYtDlpExtraArgs(),
      '--extract-audio',
      '--audio-format',
      container,
      '--audio-quality',
      '0',
      // No YouTube tags/thumbnail: the file is tagged with Spotify's metadata and cover below
    ];

    // Look up album / track number / release date / cover while the audio downloads
    const releasePromise = this.fetchReleaseDetails(item.id).catch((err) => {
      logger.debug({ err, trackId: item.id }, 'Spotify release details lookup failed');
      return null;
    });

    const downloadedPath = await this.ytdlp.downloadMedia({
      url: matchedUrl ?? `ytsearch1:${searchQuery}`,
      formatSelector,
      outputTemplate,
      extraArgs,
      onProgress: request.onProgress,
      signal: request.signal,
    });

    const release = await releasePromise;
    const filePath = await this.applySpotifyTags(downloadedPath, request, container, {
      title: meta.title,
      artist: artists.length > 0 ? artists.join(', ') : undefined,
      release,
      coverUrl: release?.coverUrl || meta.thumbnailUrl,
    });

    const displayName = artists.length > 0 ? `${artists.join(', ')} - ${meta.title}` : meta.title;
    const safeName = sanitizeFilename(
      `${displayName}.${container}`,
      `spotify-${request.mediaId}.${container}`
    );

    return {
      filePath,
      fileName: safeName,
      fileSizeBytes: 0,
      mimeType: container === 'm4a' ? 'audio/mp4' : 'audio/mpeg',
      format: 'audio',
      title: meta.title,
      author: meta.artistOrAuthor !== 'Spotify' ? meta.artistOrAuthor : undefined,
    };
  }

  /** Album, album artist, track number, release date and full-size cover of a Spotify track. */
  private fetchReleaseDetails(trackId: string): Promise<SpotifyRelease | null> {
    return this.spotify().fetchReleaseDetails(trackId);
  }

  /**
   * Replaces whatever tags the audio came with by Spotify's: title, artists, album, album artist,
   * track number, release date and the album cover. Returns the original file if tagging fails.
   */
  private async applySpotifyTags(
    audioPath: string,
    request: DownloadRequest,
    container: AudioContainer,
    info: { title: string; artist?: string; release: SpotifyRelease | null; coverUrl?: string }
  ): Promise<string> {
    const { release } = info;
    const coverPath = info.coverUrl
      ? await this.downloadCover(info.coverUrl, request.outputPath).catch((err) => {
          logger.debug({ err }, 'Spotify cover download failed');
          return undefined;
        })
      : undefined;

    const track = release?.trackNumber
      ? release.totalTracks
        ? `${release.trackNumber}/${release.totalTracks}`
        : String(release.trackNumber)
      : undefined;

    const taggedPath = join(request.outputPath, `spotify-${request.mediaId}-tagged.${container}`);
    try {
      await this.ffmpeg.writeAudioTags(
        audioPath,
        taggedPath,
        container,
        {
          title: info.title,
          artist: info.artist,
          album: release?.album,
          album_artist: release?.albumArtist || info.artist,
          track,
          date: release?.releaseDate,
        },
        coverPath,
        request.signal
      );
      await rm(audioPath, { force: true }).catch(() => undefined);
      return taggedPath;
    } catch (err) {
      if (request.signal?.aborted) throw err;
      logger.warn({ err }, 'Writing Spotify tags failed; sending the file untagged');
      return audioPath;
    }
  }

  /** Saves a Spotify CDN cover image into the job directory. */
  private async downloadCover(coverUrl: string, outputDir: string): Promise<string | undefined> {
    const cover = await this.spotify().fetchCover(coverUrl);
    if (!cover) return undefined;
    const coverPath = join(outputDir, `spotify-cover.${cover.ext}`);
    await writeFile(coverPath, cover.bytes);
    return coverPath;
  }

}
