import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickBestMatch } from '../../src/platforms/spotify/track-matcher.js';
import { parseTrackPage } from '../../src/platforms/spotify/track-page.js';
import { SpotifyAdapter, spotifyAudioOptions } from '../../src/platforms/spotify/spotify-adapter.js';
import { createFormatSelectionKeyboard } from '../../src/bot/keyboards/index.js';
import { YtDlpRunner, parseYouTubeMusicSongs } from '../../src/services/downloads/ytdlp-runner.js';
import { FFmpegRunner } from '../../src/services/media/ffmpeg-runner.js';
import { resetConfigForTesting } from '../../src/config/env.js';

describe('Spotify format picker', () => {
  it('offers MP3 and a best-quality M4A button', () => {
    const keyboard = createFormatSelectionKeyboard({
      locale: 'en',
      jobKey: 'k1',
      mediaOptions: spotifyAudioOptions(),
    });
    const buttons = keyboard.inline_keyboard.flat();
    expect(buttons.map((b) => ('callback_data' in b ? b.callback_data : ''))).toEqual([
      'dl:k1:audio:mp3',
      'dl:k1:audio:m4a',
      'cancel:preview:k1',
    ]);
    expect(buttons[0].text).toBe('🎵 Audio (MP3)');
    expect(buttons[1].text).toBe('🎧 Audio (M4A) · Best quality');
  });
});

describe('Spotify track page parsing', () => {
  it('reads album, track number, release date and cover from meta tags', () => {
    const html = [
      '<meta property="og:description" content="Rick Astley · Whenever You Need Somebody · Song · 1987"/>',
      '<meta property="og:image" content="https://i.scdn.co/image/ab67"/>',
      '<meta name="music:album" content="https://open.spotify.com/album/5Z9iiGl2FcIfa3BMiv6OIw"/>',
      '<meta name="music:album:track" content="1"/>',
      '<meta name="music:release_date" content="1987-11-12"/>',
    ].join('\n');
    expect(parseTrackPage(html)).toEqual({
      albumId: '5Z9iiGl2FcIfa3BMiv6OIw',
      albumName: 'Whenever You Need Somebody',
      trackNumber: 1,
      releaseDate: '1987-11-12',
      coverUrl: 'https://i.scdn.co/image/ab67',
    });
  });

  it('decodes HTML entities in album names', () => {
    const html =
      '<meta property="og:description" content="Simon &amp; Garfunkel · Bridge Over Troubled Water · Song · 1970"/>';
    expect(parseTrackPage(html).albumName).toBe('Bridge Over Troubled Water');
  });
});

describe('Spotify → YouTube track matching', () => {
  const track = { title: 'Loser', artists: ['Tame Impala'], durationSeconds: 223 };

  it('rejects a same-titled song by another artist', () => {
    const best = pickBestMatch(track, [
      { url: 'beck', title: 'Beck - Loser (Official Music Video)', channel: 'Beck', duration: 235 },
      { url: 'tame', title: 'Tame Impala - Loser', channel: 'Tame Impala - Topic', duration: 223 },
    ]);
    expect(best?.candidate.url).toBe('tame');
  });

  it('prefers the matching duration over covers, loops and live versions', () => {
    const best = pickBestMatch(track, [
      { url: 'loop', title: '[1 HOUR] Tame Impala - Loser (Lyrics)', duration: 3600 },
      { url: 'cover', title: 'Tame Impala - Loser (Piano Cover)', duration: 220 },
      { url: 'live', title: 'Tame Impala - Loser (Live at Glastonbury)', duration: 300 },
      { url: 'video', title: 'Tame Impala - Loser (Official Video)', channel: 'Tame Impala', duration: 268 },
      { url: 'audio', title: 'Tame Impala - Loser (Lyrics)', channel: '7clouds', duration: 224 },
    ]);
    expect(best?.candidate.url).toBe('audio');
  });

  it('prefers the official YouTube Music upload over a fan re-upload of equal length', () => {
    const best = pickBestMatch(track, [
      { url: 'reupload', title: 'Tame Impala - Loser (Lyrics)', channel: '7clouds', duration: 223 },
      { url: 'ytm', title: 'Loser', channel: 'Tame Impala', duration: 224, source: 'youtube-music' },
    ]);
    expect(best?.candidate.url).toBe('ytm');
  });

  it('parses YouTube Music song rows', () => {
    const artistRun = (text: string) => ({
      text,
      navigationEndpoint: {
        browseEndpoint: {
          browseEndpointContextSupportedConfigs: {
            browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' },
          },
        },
      },
    });
    const response = {
      contents: {
        tabbedSearchResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicShelfRenderer: {
                          contents: [
                            {
                              musicResponsiveListItemRenderer: {
                                playlistItemData: { videoId: 'WNxAvQNsJuM' },
                                flexColumns: [
                                  { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Stop The Wedding!' }] } } },
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: {
                                        runs: [
                                          artistRun('Ashe'),
                                          { text: ' • ' },
                                          { text: 'Stop The Wedding!' },
                                          { text: ' • ' },
                                          { text: '3:19' },
                                        ],
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };
    expect(parseYouTubeMusicSongs(response)).toEqual([
      {
        id: 'WNxAvQNsJuM',
        title: 'Stop The Wedding!',
        url: 'https://www.youtube.com/watch?v=WNxAvQNsJuM',
        channel: 'Ashe',
        duration: 199,
        thumbnail: undefined,
        source: 'youtube-music',
      },
    ]);
  });

  it('does not penalise variant words the Spotify title itself contains', () => {
    const best = pickBestMatch(
      { title: 'Song - Acoustic Version', artists: ['Artist'], durationSeconds: 180 },
      [
        { url: 'studio', title: 'Artist - Song', duration: 200 },
        { url: 'acoustic', title: 'Artist - Song (Acoustic Version)', duration: 181 },
      ]
    );
    expect(best?.candidate.url).toBe('acoustic');
  });
});

describe('SpotifyAdapter without a usable Web API', () => {
  let outDir: string;
  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'grabbit-spotify-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    resetConfigForTesting();
  });

  const embedHtml = (entity: unknown) =>
    `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { state: { data: { entity } } } },
    })}</script></html>`;

  it('reads artist + duration from the embed page when the API returns 403, and downloads the best match', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'id';
    process.env.SPOTIFY_CLIENT_SECRET = 'secret';
    resetConfigForTesting();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('oembed')) return { ok: true, json: async () => ({ title: 'Loser' }) };
        if (url.includes('/api/token'))
          return { ok: true, json: async () => ({ access_token: 'tok' }) };
        if (url.includes('api.spotify.com')) return { ok: false, status: 403 };
        if (url.includes('/embed/track/abc'))
          return {
            ok: true,
            text: async () =>
              embedHtml({
                type: 'track',
                name: 'Loser',
                artists: [{ name: 'Tame Impala' }],
                duration: 223069,
              }),
          };
        if (url === 'https://open.spotify.com/track/abc')
          return {
            ok: true,
            text: async () =>
              [
                '<meta property="og:description" content="Tame Impala · Deadbeat · Song · 2025"/>',
                '<meta property="og:image" content="https://i.scdn.co/image/cover640"/>',
                '<meta name="music:album" content="https://open.spotify.com/album/alb1"/>',
                '<meta name="music:album:track" content="3"/>',
                '<meta name="music:release_date" content="2025-10-17"/>',
              ].join(''),
          };
        if (url.includes('/embed/album/alb1'))
          return {
            ok: true,
            text: async () =>
              embedHtml({
                type: 'album',
                name: 'Deadbeat',
                subtitle: 'Tame Impala',
                trackList: Array.from({ length: 12 }, (_, i) => ({ uri: `spotify:track:x${i}` })),
              }),
          };
        if (url === 'https://i.scdn.co/image/cover640')
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'image/jpeg' }),
            arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer,
          };
        throw new Error(`unexpected fetch ${url}`);
      })
    );

    const ytdlp = new YtDlpRunner('yt-dlp');
    const search = vi.spyOn(ytdlp, 'search').mockResolvedValue([
      { id: 'b', url: 'https://www.youtube.com/watch?v=beck', title: 'Beck - Loser', duration: 235 },
      { id: 't', url: 'https://www.youtube.com/watch?v=tame', title: 'Tame Impala - Loser', duration: 223 },
    ]);
    const musicSearch = vi.spyOn(ytdlp, 'searchYouTubeMusicSongs').mockResolvedValue([]);
    const download = vi.spyOn(ytdlp, 'downloadMedia').mockResolvedValue(join(outDir, 'out.mp3'));
    const ffmpeg = new FFmpegRunner('ffmpeg');
    const writeTags = vi
      .spyOn(ffmpeg, 'writeAudioTags')
      .mockImplementation(async (_in, out) => out);

    const adapter = new SpotifyAdapter(ytdlp, ffmpeg);
    const meta = await adapter.fetchMetadata('https://open.spotify.com/track/abc');
    expect(meta.artistOrAuthor).toBe('Tame Impala');
    expect(meta.durationSeconds).toBe(223);

    // Both formats are offered; MP3 first so it stays the default
    expect(meta.items[0].availableOptions.map((o) => o.qualityId)).toEqual(['mp3', 'm4a']);

    const result = await adapter.download({
      url: 'https://open.spotify.com/track/abc',
      outputPath: outDir,
      mediaId: 'abc',
      qualityId: 'mp3',
    } as never);

    expect(search.mock.calls[0][0]).toBe('Tame Impala - Loser');
    expect(musicSearch.mock.calls[0][0]).toBe('Tame Impala - Loser');
    expect(download.mock.calls[0][0].url).toBe('https://www.youtube.com/watch?v=tame');
    // YouTube's own tags/thumbnail are not embedded
    expect(download.mock.calls[0][0].extraArgs).not.toContain('--embed-thumbnail');
    expect(download.mock.calls[0][0].extraArgs).not.toContain('--embed-metadata');

    expect(download.mock.calls[0][0].extraArgs).toContain('mp3');
    expect(result.fileName).toBe('Tame Impala - Loser.mp3');
    expect(result.mimeType).toBe('audio/mpeg');

    const [input, output, container, tags, cover] = writeTags.mock.calls[0];
    expect(input).toBe(join(outDir, 'out.mp3'));
    expect(container).toBe('mp3');
    expect(tags).toEqual({
      title: 'Loser',
      artist: 'Tame Impala',
      album: 'Deadbeat',
      album_artist: 'Tame Impala',
      track: '3/12',
      date: '2025-10-17',
    });
    expect(cover).toBe(join(outDir, 'spotify-cover.jpg'));
    expect(result.filePath).toBe(output);
    expect(result.author).toBe('Tame Impala');

    // M4A keeps YouTube's AAC stream (no MP3 re-encode) and tags the .m4a container
    const m4a = await adapter.download({
      url: 'https://open.spotify.com/track/abc',
      outputPath: outDir,
      mediaId: 'abc',
      qualityId: 'm4a',
    } as never);
    const m4aCall = download.mock.calls[1][0];
    expect(m4aCall.formatSelector).toMatch(/^bestaudio\[ext=m4a\]/);
    expect(m4aCall.extraArgs).toContain('m4a');
    expect(m4aCall.extraArgs).not.toContain('mp3');
    expect(writeTags.mock.calls[1][2]).toBe('m4a');
    expect(m4a.fileName).toBe('Tame Impala - Loser.m4a');
    expect(m4a.mimeType).toBe('audio/mp4');
    expect(m4a.filePath.endsWith('.m4a')).toBe(true);
  });

  it('lists playlist tracks from the embed page when no credentials are configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('oembed')) return { ok: true, json: async () => ({ title: 'Top Hits' }) };
        if (url.includes('/embed/playlist/pl1'))
          return {
            ok: true,
            text: async () =>
              embedHtml({
                type: 'playlist',
                name: 'Top Hits',
                trackList: [
                  { uri: 'spotify:track:t1', title: 'Song A', subtitle: 'Artist A', duration: 200000 },
                  { uri: 'spotify:episode:e1', title: 'Podcast', entityType: 'episode' },
                ],
              }),
          };
        throw new Error(`unexpected fetch ${url}`);
      })
    );

    const meta = await new SpotifyAdapter(new YtDlpRunner('yt-dlp')).fetchMetadata(
      'https://open.spotify.com/playlist/pl1'
    );
    expect(meta.isCollection).toBe(true);
    expect(meta.items).toHaveLength(1);
    expect(meta.items[0]).toMatchObject({
      title: 'Song A',
      uploader: 'Artist A',
      durationSeconds: 200,
      url: 'https://open.spotify.com/track/t1',
    });
  });
});
