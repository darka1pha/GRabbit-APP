import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyYtDlpStderr,
  lastErrorLine,
  metadataArgs,
  parseFlatEntries,
  parseMetadataOutput,
  parsePlaylistHeader,
  parseProgressLine,
  playlistArgs,
} from '@grabbit/core/media/ytdlp';
import { parseSpotifyEmbedPage, SpotifyClient, spotifyEmbedImage, spotifyEmbedTracks } from '@grabbit/core/media/spotify';

describe('shared yt-dlp helpers', () => {
  it('always ends arguments with -- before the URL', () => {
    expect(metadataArgs('https://x/v', ['--cookies', 'c.txt']).slice(-2)).toEqual(['--', 'https://x/v']);
    expect(playlistArgs('https://x/p', 0)).toContain('1');
  });

  it('classifies stderr the same way for both apps', () => {
    expect(classifyYtDlpStderr('ERROR: This video is DRM protected')).toBe('drm');
    expect(classifyYtDlpStderr("ERROR: Sign in to confirm you're not a bot. Use --cookies")).toBe('cookies-required');
    expect(classifyYtDlpStderr('ERROR: Unsupported URL: https://x')).toBe('unsupported-url');
    expect(classifyYtDlpStderr('ERROR: Private video. Sign in')).toBe('auth-required');
    expect(classifyYtDlpStderr('ERROR: Video unavailable')).toBe('unavailable');
    expect(classifyYtDlpStderr('ERROR: HTTP Error 404: Not Found')).toBe('unavailable');
    expect(classifyYtDlpStderr('ERROR: something odd')).toBe('other');
    expect(lastErrorLine('WARNING: a\nERROR: the real one\n')).toBe('the real one');
  });

  it('parses metadata, playlist headers and flat entries', () => {
    expect(parseMetadataOutput('noise\n{"id":"a","title":"T"}\n').title).toBe('T');
    expect(() => parseMetadataOutput('no json')).toThrow();
    const flat = '{"id":"1","title":"One","playlist_title":"Mix","playlist_uploader":"Me","url":"https://y/1"}\n{"id":"2"}\nbad\n';
    expect(parsePlaylistHeader(flat)).toEqual({ title: 'Mix', uploader: 'Me' });
    const entries = parseFlatEntries(flat, (id) => `https://fallback/${id}`);
    expect(entries.map((e) => e.url)).toEqual(['https://y/1', 'https://fallback/2']);
  });

  it('parses byte progress lines', () => {
    expect(parseProgressLine('GRABBIT_PROGRESS| 50.0%|500|1000|NA|100|5')).toMatchObject({
      percent: 50,
      downloadedBytes: 500,
      totalBytes: 1000,
      speed: 100,
      eta: 5,
    });
    expect(parseProgressLine('[download] something else')).toBeNull();
  });
});

describe('shared Spotify client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads tracks and the cover from an embed page', () => {
    const entity = {
      trackList: [
        { uri: 'spotify:track:abc', title: 'Song', subtitle: 'Artist', duration: 200_500, entityType: 'track' },
        { uri: 'spotify:episode:x', title: 'Podcast', entityType: 'episode' },
      ],
      coverArt: { sources: [{ url: 'small', width: 64 }, { url: 'big', width: 640 }] },
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { state: { data: { entity } } } },
    })}</script>`;
    const parsed = parseSpotifyEmbedPage(html)!;
    expect(spotifyEmbedTracks(parsed)).toEqual([
      { id: 'abc', title: 'Song', artists: 'Artist', durationSeconds: 201, url: 'https://open.spotify.com/track/abc' },
    ]);
    expect(spotifyEmbedImage(parsed)).toBe('big');
  });

  it('pages through a playlist with valid page sizes, up to the cap', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes('accounts.spotify.com')) return new Response(JSON.stringify({ access_token: 't' }));
        const page = requested.filter((u) => u.includes('api.spotify.com')).length;
        const items = Array.from({ length: 100 }, (_, i) => ({ track: { id: `p${page}t${i}`, name: 'n', type: 'track' } }));
        return new Response(JSON.stringify({ items, next: page < 3 ? `https://api.spotify.com/next${page}` : null }));
      })
    );
    const client = new SpotifyClient({ clientId: 'id', clientSecret: 'secret', maxCollectionItems: 150 });
    const tracks = await client.fetchCollectionTracks('playlist', 'abc123');
    expect(tracks).toHaveLength(150);
    // Spotify rejects limit > 100, which made one-request listing fail
    expect(requested.find((u) => u.includes('/playlists/'))).toContain('limit=100');
    expect(requested.filter((u) => u.includes('api.spotify.com'))).toHaveLength(2);
  });

  it('returns null without credentials, without calling the API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await new SpotifyClient().fetchCollectionTracks('album', 'abc')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
