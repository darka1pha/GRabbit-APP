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
import { parseTrackPage } from './track-page.js';

export interface SpotifyOEmbed {
  title: string;
  type: string;
  thumbnail_url?: string;
  provider_name: string;
  html?: string;
}

/** Subset of the entity JSON embedded in open.spotify.com/embed/* pages (`__NEXT_DATA__`). */
interface SpotifyEmbedEntity {
  type?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  artists?: { name?: string }[];
  /** Milliseconds */
  duration?: number;
  releaseDate?: { isoString?: string };
  coverArt?: { sources?: { url?: string; width?: number }[] };
  visualIdentity?: { image?: { url?: string; maxWidth?: number }[] };
  trackList?: {
    uri?: string;
    title?: string;
    subtitle?: string;
    duration?: number;
    entityType?: string;
  }[];
}

/** Release details written into the MP3's ID3 tags. */
interface SpotifyRelease {
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  totalTracks?: number;
  releaseDate?: string;
  coverUrl?: string;
}

const EMBED_TIMEOUT_MS = 6000;
const MATCH_CANDIDATES = 8;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
// Deliberately minimal: with a full desktop-browser UA, open.spotify.com/track serves the
// client-rendered app without the music:* / og:* meta tags that release details are read from.
const BROWSER_UA = 'Mozilla/5.0';

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

  /**
   * Reads the entity JSON from the public open.spotify.com/embed page. Works without API
   * credentials and returns artists + duration for tracks and a trackList for albums/playlists.
   */
  private async fetchEmbedEntity(
    entityType: string,
    entityId: string
  ): Promise<SpotifyEmbedEntity | null> {
    if (!/^[A-Za-z0-9]+$/.test(entityId)) return null;
    const html = await this.fetchText(`https://open.spotify.com/embed/${entityType}/${entityId}`);
    if (!html) return null;
    try {
      const match = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
      );
      if (!match) return null;
      const data = JSON.parse(match[1]) as {
        props?: { pageProps?: { state?: { data?: { entity?: SpotifyEmbedEntity } } } };
      };
      return data.props?.pageProps?.state?.data?.entity ?? null;
    } catch (err) {
      logger.debug({ err, entityType, entityId }, 'Spotify embed page parse failed');
      return null;
    }
  }

  private embedImage(entity: SpotifyEmbedEntity): string | undefined {
    const images = [
      ...(entity.visualIdentity?.image ?? []).map((i) => ({ url: i.url, w: i.maxWidth ?? 0 })),
      ...(entity.coverArt?.sources ?? []).map((i) => ({ url: i.url, w: i.width ?? 0 })),
    ].filter((i): i is { url: string; w: number } => Boolean(i.url));
    images.sort((a, b) => b.w - a.w);
    return images[0]?.url;
  }

  private embedCollectionTracks(entity: SpotifyEmbedEntity): MediaItem[] {
    return (entity.trackList ?? [])
      .filter((t) => (t.entityType ?? 'track') === 'track' && t.uri?.startsWith('spotify:track:'))
      .slice(0, COLLECTION_MAX_ITEMS)
      .map((t) => {
        const id = t.uri!.split(':')[2];
        return {
          id,
          title: t.title || id,
          uploader: t.subtitle || undefined,
          durationSeconds: t.duration ? Math.round(t.duration / 1000) : undefined,
          platform: this.platformId,
          url: `https://open.spotify.com/track/${id}`,
          isDownloadable: true,
          availableOptions: spotifyAudioOptions(),
        };
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

  /** Client-credentials token, or null when SPOTIFY_CLIENT_ID / SECRET aren't configured. */
  private async getAccessToken(): Promise<string | null> {
    const config = getConfig();
    if (!config.SPOTIFY_CLIENT_ID || !config.SPOTIFY_CLIENT_SECRET) return null;

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(`${config.SPOTIFY_CLIENT_ID}:${config.SPOTIFY_CLIENT_SECRET}`).toString(
            'base64'
          ),
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) return null;
    const tokenData = (await tokenRes.json()) as { access_token: string };
    return tokenData.access_token;
  }

  /** First COLLECTION_MAX_ITEMS tracks of an album or playlist, as downloadable items. */
  private async fetchCollectionTracks(
    entityType: 'album' | 'playlist',
    entityId: string
  ): Promise<MediaItem[] | null> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return null;

    const res = await fetch(
      `https://api.spotify.com/v1/${entityType}s/${entityId}/tracks?limit=${COLLECTION_MAX_ITEMS}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;

    type SpotifyTrack = {
      id?: string;
      name?: string;
      type?: string;
      artists?: { name: string }[];
      duration_ms?: number;
    };
    const body = (await res.json()) as { items?: Array<SpotifyTrack & { track?: SpotifyTrack }> };

    // Album items are tracks; playlist items wrap them in { track } (and may be episodes/null)
    const tracks = (body.items || [])
      .map((i) => (entityType === 'playlist' ? i.track : i))
      .filter((t): t is SpotifyTrack => Boolean(t?.id && t.name && (t.type ?? 'track') === 'track'));

    return tracks.map((t) => ({
      id: t.id!,
      title: t.name!,
      uploader: t.artists?.map((a) => a.name).join(', ') || undefined,
      durationSeconds: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined,
      platform: this.platformId,
      url: `https://open.spotify.com/track/${t.id}`,
      isDownloadable: true,
      availableOptions: spotifyAudioOptions(),
    }));
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
  private async fetchReleaseDetails(trackId: string): Promise<SpotifyRelease | null> {
    if (!/^[A-Za-z0-9]+$/.test(trackId)) return null;
    const html = await this.fetchText(`https://open.spotify.com/track/${trackId}`);
    if (!html) return null;
    const page = parseTrackPage(html);

    const album = page.albumId ? await this.fetchEmbedEntity('album', page.albumId) : null;
    const albumTracks = (album?.trackList ?? []).filter(
      (t) => (t.entityType ?? 'track') === 'track'
    );
    const indexInAlbum = albumTracks.findIndex((t) => t.uri === `spotify:track:${trackId}`);
    const albumRelease = album?.releaseDate?.isoString;

    return {
      album: album?.name || album?.title || page.albumName,
      albumArtist: album?.subtitle,
      trackNumber: page.trackNumber ?? (indexInAlbum >= 0 ? indexInAlbum + 1 : undefined),
      totalTracks: albumTracks.length > 0 ? albumTracks.length : undefined,
      releaseDate: page.releaseDate || albumRelease?.slice(0, 10),
      coverUrl: page.coverUrl || (album ? this.embedImage(album) : undefined),
    };
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
    const host = new URL(coverUrl).hostname;
    if (!/(^|\.)(scdn\.co|spotifycdn\.com)$/.test(host)) return undefined;

    const res = await fetch(coverUrl, { signal: AbortSignal.timeout(EMBED_TIMEOUT_MS) });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') || '';
    const ext = type.includes('png') ? 'png' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : null;
    if (!ext) return undefined;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_COVER_BYTES) return undefined;

    const coverPath = join(outputDir, `spotify-cover.${ext}`);
    await writeFile(coverPath, bytes);
    return coverPath;
  }

  private async fetchText(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      return res.ok ? await res.text() : null;
    } catch (err) {
      logger.debug({ err, url }, 'Spotify page fetch failed');
      return null;
    }
  }
}
