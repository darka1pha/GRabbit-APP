/**
 * Spotify data access shared by the desktop app and the Telegram bot: the Web API (client
 * credentials, paged album/playlist tracks), the public embed page (works without credentials)
 * and the track page (release details for tagging).
 *
 * No Node imports (only global `fetch`); each app maps the plain tracks returned here to its own
 * media items and download options. Import it from `@grabbit/core/media/spotify`.
 */
import { parseTrackPage } from '../platforms/track-page';

export interface SpotifyOEmbed {
  title: string;
  type: string;
  thumbnail_url?: string;
  provider_name: string;
  html?: string;
}

/** Subset of the entity JSON embedded in open.spotify.com/embed/* pages (`__NEXT_DATA__`). */
export interface SpotifyEmbedEntity {
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

/** Release details written into the audio file's tags. */
export interface SpotifyRelease {
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  totalTracks?: number;
  releaseDate?: string;
  coverUrl?: string;
}

/** One track of an album or playlist, before it becomes an app's media item. */
export interface SpotifyCollectionTrack {
  id: string;
  title: string;
  /** Artist names joined with ", " */
  artists?: string;
  durationSeconds?: number;
  url: string;
}

export interface SpotifyClientOptions {
  clientId?: string;
  clientSecret?: string;
  /** Upper bound when paging through very large playlists. */
  maxCollectionItems?: number;
  timeoutMs?: number;
  /** Debug/warn sink; failures are otherwise silent (callers fall back to the embed page). */
  log?: (level: 'debug' | 'warn', data: Record<string, unknown>, message: string) => void;
}

/** The public embed page lists at most this many tracks. */
export const SPOTIFY_EMBED_TRACK_LIMIT = 100;
const DEFAULT_MAX_ITEMS = 5000;
const DEFAULT_TIMEOUT_MS = 6000;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
// Deliberately minimal: with a full desktop-browser UA, open.spotify.com/track serves the
// client-rendered app without the music:* / og:* meta tags that release details are read from.
const BROWSER_UA = 'Mozilla/5.0';
const SPOTIFY_ID = /^[A-Za-z0-9]+$/;

/** Largest image of an embed entity. */
export function spotifyEmbedImage(entity: SpotifyEmbedEntity): string | undefined {
  const images = [
    ...(entity.visualIdentity?.image ?? []).map((i) => ({ url: i.url, w: i.maxWidth ?? 0 })),
    ...(entity.coverArt?.sources ?? []).map((i) => ({ url: i.url, w: i.width ?? 0 })),
  ].filter((i): i is { url: string; w: number } => Boolean(i.url));
  images.sort((a, b) => b.w - a.w);
  return images[0]?.url;
}

/** The tracks an embed page lists for an album or playlist (podcast episodes skipped). */
export function spotifyEmbedTracks(entity: SpotifyEmbedEntity): SpotifyCollectionTrack[] {
  return (entity.trackList ?? [])
    .filter((t) => (t.entityType ?? 'track') === 'track' && t.uri?.startsWith('spotify:track:'))
    .map((t) => {
      const id = t.uri!.split(':')[2];
      return {
        id,
        title: t.title || id,
        artists: t.subtitle || undefined,
        durationSeconds: t.duration ? Math.round(t.duration / 1000) : undefined,
        url: `https://open.spotify.com/track/${id}`,
      };
    });
}

/** Reads the `__NEXT_DATA__` entity out of an embed page. */
export function parseSpotifyEmbedPage(html: string): SpotifyEmbedEntity | null {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  const data = JSON.parse(match[1]) as {
    props?: { pageProps?: { state?: { data?: { entity?: SpotifyEmbedEntity } } } };
  };
  return data.props?.pageProps?.state?.data?.entity ?? null;
}

function base64(text: string): string {
  // btoa needs Latin-1; client ids and secrets are ASCII
  return btoa(text);
}

export class SpotifyClient {
  constructor(private readonly options: SpotifyClientOptions = {}) {}

  private get timeout(): number {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private log(level: 'debug' | 'warn', data: Record<string, unknown>, message: string): void {
    this.options.log?.(level, data, message);
  }

  public hasCredentials(): boolean {
    return Boolean(this.options.clientId && this.options.clientSecret);
  }

  /** GET a public Spotify page as text, or null. */
  public async fetchText(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(this.timeout),
      });
      return res.ok ? await res.text() : null;
    } catch (err) {
      this.log('debug', { err, url }, 'Spotify page fetch failed');
      return null;
    }
  }

  /**
   * Reads the entity JSON from the public open.spotify.com/embed page. Works without API
   * credentials and returns artists + duration for tracks and a trackList for albums/playlists.
   */
  public async fetchEmbedEntity(entityType: string, entityId: string): Promise<SpotifyEmbedEntity | null> {
    if (!SPOTIFY_ID.test(entityId)) return null;
    const html = await this.fetchText(`https://open.spotify.com/embed/${entityType}/${entityId}`);
    if (!html) return null;
    try {
      return parseSpotifyEmbedPage(html);
    } catch (err) {
      this.log('debug', { err, entityType, entityId }, 'Spotify embed page parse failed');
      return null;
    }
  }

  /** Client-credentials token, or null when no credentials are configured or they are refused. */
  public async getAccessToken(): Promise<string | null> {
    if (!this.hasCredentials()) return null;
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${base64(`${this.options.clientId}:${this.options.clientSecret}`)}`,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  }

  /**
   * Every track of an album or playlist, following the API's pages (100 playlist items or 50
   * album tracks per page) up to `maxCollectionItems`. Null without credentials or on refusal.
   */
  public async fetchCollectionTracks(
    entityType: 'album' | 'playlist',
    entityId: string
  ): Promise<SpotifyCollectionTrack[] | null> {
    if (!SPOTIFY_ID.test(entityId)) return null;
    const accessToken = await this.getAccessToken();
    if (!accessToken) return null;

    type ApiTrack = { id?: string; name?: string; type?: string; artists?: { name: string }[]; duration_ms?: number };
    type Page = { items?: Array<ApiTrack & { track?: ApiTrack }>; next?: string | null };

    const maxItems = this.options.maxCollectionItems ?? DEFAULT_MAX_ITEMS;
    const pageSize = entityType === 'playlist' ? 100 : 50;
    let next: string | null = `https://api.spotify.com/v1/${entityType}s/${entityId}/tracks?limit=${pageSize}`;
    const tracks: ApiTrack[] = [];
    while (next && tracks.length < maxItems) {
      const res = await fetch(next, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        if (tracks.length === 0) return null;
        this.log('warn', { status: res.status, entityId, loaded: tracks.length }, 'Spotify paging stopped early');
        break;
      }
      const body = (await res.json()) as Page;
      // Album items are tracks; playlist items wrap them in { track } (and may be episodes/null)
      for (const item of body.items ?? []) {
        const t = entityType === 'playlist' ? item.track : item;
        if (t?.id && t.name && (t.type ?? 'track') === 'track') tracks.push(t);
      }
      next = body.next ?? null;
    }

    return tracks.slice(0, maxItems).map((t) => ({
      id: t.id!,
      title: t.name!,
      artists: t.artists?.map((a) => a.name).join(', ') || undefined,
      durationSeconds: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined,
      url: `https://open.spotify.com/track/${t.id}`,
    }));
  }

  /** Album, album artist, track number, release date and full-size cover of a Spotify track. */
  public async fetchReleaseDetails(trackId: string): Promise<SpotifyRelease | null> {
    if (!SPOTIFY_ID.test(trackId)) return null;
    const html = await this.fetchText(`https://open.spotify.com/track/${trackId}`);
    if (!html) return null;
    const page = parseTrackPage(html);

    const album = page.albumId ? await this.fetchEmbedEntity('album', page.albumId) : null;
    const albumTracks = (album?.trackList ?? []).filter((t) => (t.entityType ?? 'track') === 'track');
    const indexInAlbum = albumTracks.findIndex((t) => t.uri === `spotify:track:${trackId}`);
    const albumRelease = album?.releaseDate?.isoString;

    return {
      album: album?.name || album?.title || page.albumName,
      albumArtist: album?.subtitle,
      trackNumber: page.trackNumber ?? (indexInAlbum >= 0 ? indexInAlbum + 1 : undefined),
      totalTracks: albumTracks.length > 0 ? albumTracks.length : undefined,
      releaseDate: page.releaseDate || albumRelease?.slice(0, 10),
      coverUrl: page.coverUrl || (album ? spotifyEmbedImage(album) : undefined),
    };
  }

  /** Downloads a cover from Spotify's CDN (only), as bytes plus a file extension. */
  public async fetchCover(coverUrl: string): Promise<{ bytes: Uint8Array; ext: 'png' | 'jpg' } | undefined> {
    const host = new URL(coverUrl).hostname;
    if (!/(^|\.)(scdn\.co|spotifycdn\.com)$/.test(host)) return undefined;
    const res = await fetch(coverUrl, { signal: AbortSignal.timeout(this.timeout) });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') || '';
    const ext = type.includes('png') ? 'png' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : null;
    if (!ext) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_COVER_BYTES) return undefined;
    return { bytes, ext };
  }
}
