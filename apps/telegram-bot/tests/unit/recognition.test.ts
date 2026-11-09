import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MusicRecognizer } from '../../src/services/recognition/music-recognizer.js';
import { createMusicRecognitionHandler } from '../../src/bot/handlers/recognition-handler.js';
import { FFmpegRunner } from '../../src/services/media/ffmpeg-runner.js';
import { YtDlpRunner } from '../../src/services/downloads/ytdlp-runner.js';
import { BotContext } from '../../src/bot/context.js';
import { translate } from '../../src/i18n/index.js';
import * as downloader from '../../src/bot/handlers/telegram-file-downloader.js';
import * as fs from 'node:fs';
import { join } from 'node:path';

vi.mock('../../src/queue/queues.js', () => ({
  getMediaQueue: () => ({
    add: vi.fn().mockResolvedValue(undefined),
  }),
}));

function createMockContext(locale: 'en' | 'fa' = 'en'): BotContext {
  return {
    from: { id: 1001, first_name: 'Tester', language_code: locale },
    chat: { id: 2002, type: 'private' },
    locale,
    t: (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    replyWithPhoto: vi.fn().mockResolvedValue({ message_id: 101 }),
    api: {
      editMessageText: vi.fn().mockResolvedValue({ message_id: 100 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as BotContext;
}

describe('MusicRecognizer Service', () => {
  const tempDir = join(process.cwd(), 'temp');
  const dummyFile = join(tempDir, 'dummy_voice.ogg');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(dummyFile, 'dummy audio data');
    return () => {
      try {
        if (fs.existsSync(dummyFile)) fs.unlinkSync(dummyFile);
      } catch {}
    };
  });

  it('returns null if input file does not exist', async () => {
    const recognizer = new MusicRecognizer();
    const result = await recognizer.identifyMedia('/nonexistent/sample.mp3');
    expect(result).toBeNull();
  });

  it('extracts sample with FFmpeg and maps Shazam track response correctly', async () => {
    const mockFFmpeg = {
      extractAudioSampleForRecognition: vi.fn().mockResolvedValue(dummyFile),
    } as unknown as FFmpegRunner;

    const mockShazam = {
      recognise: vi.fn().mockResolvedValue({
        matches: [{ id: '123' }],
        track: {
          title: 'Starboy',
          subtitle: 'The Weeknd ft. Daft Punk',
          url: 'https://shazam.com/track/123',
          genres: { primary: 'R&B' },
          images: { coverarthq: 'https://images.shazam.com/starboy.jpg' },
          sections: [
            {
              type: 'SONG',
              metadata: [
                { title: 'Album', text: 'Starboy' },
                { title: 'Released', text: '2016' },
                { title: 'Label', text: 'Republic Records' },
              ],
            },
          ],
          hub: {
            providers: [
              {
                type: 'APPLEMUSIC',
                actions: [{ uri: 'https://music.apple.com/album/starboy' }],
              },
            ],
          },
        },
      }),
    } as any;

    const recognizer = new MusicRecognizer(mockShazam, mockFFmpeg);
    const result = await recognizer.identifyMedia(dummyFile);

    expect(result).not.toBeNull();
    expect(result?.title).toBe('Starboy');
    expect(result?.artist).toBe('The Weeknd ft. Daft Punk');
    expect(result?.album).toBe('Starboy');
    expect(result?.releaseYear).toBe('2016');
    expect(result?.genre).toBe('R&B');
    expect(result?.coverArtUrl).toBe('https://images.shazam.com/starboy.jpg');
    expect(result?.appleMusicUrl).toBe('https://music.apple.com/album/starboy');
  });

  it('returns null when Shazam returns no track match', async () => {
    const mockFFmpeg = {
      extractAudioSampleForRecognition: vi.fn().mockResolvedValue(dummyFile),
    } as unknown as FFmpegRunner;

    const mockShazam = {
      recognise: vi.fn().mockResolvedValue(null),
    } as any;

    const recognizer = new MusicRecognizer(mockShazam, mockFFmpeg);
    const result = await recognizer.identifyMedia(dummyFile);
    expect(result).toBeNull();
  });
});

describe('createMusicRecognitionHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores message if it contains no audio or video', async () => {
    const handler = createMusicRecognitionHandler();
    const ctx = createMockContext('en');
    ctx.message = { message_id: 1, text: 'Hello bot' } as any;

    await handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('prioritizes link downloader when media message contains a URL in its caption', async () => {
    const mockRecognizer = {
      identifyMedia: vi.fn(),
    } as unknown as MusicRecognizer;

    const mockRouter = {
      getMetadata: vi.fn().mockResolvedValue({
        platform: 'youtube',
        items: [
          {
            id: 'yt123',
            title: 'Sample Video',
            availableOptions: [],
          },
        ],
      }),
    } as any;

    const handler = createMusicRecognitionHandler(mockRecognizer, undefined, mockRouter);
    const ctx = createMockContext('en');
    ctx.message = {
      message_id: 30,
      video: { file_id: 'vid_123', file_size: 1000 },
      caption: 'Check this link: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    } as any;

    await handler(ctx);

    expect(mockRouter.getMetadata).toHaveBeenCalled();
    expect(mockRecognizer.identifyMedia).not.toHaveBeenCalled();
  });

  it('rejects media larger than 25MB before downloading', async () => {
    const handler = createMusicRecognitionHandler();
    const ctx = createMockContext('en');
    ctx.message = {
      message_id: 2,
      video: { file_id: 'huge_vid', file_size: 30 * 1024 * 1024 },
    } as any;

    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('too large'),
      expect.objectContaining({ reply_to_message_id: 2 })
    );
  });

  it('handles recognized voice message, searches YouTube, and replies with rich card and download buttons', async () => {
    vi.spyOn(downloader, 'downloadTelegramMediaFile').mockResolvedValue({
      filePath: '/tmp/test_voice.ogg',
      cleanup: vi.fn(),
    });

    const mockRecognizer = {
      identifyMedia: vi.fn().mockResolvedValue({
        title: 'Veridis Quo',
        artist: 'Daft Punk',
        album: 'Discovery',
        coverArtUrl: 'https://images.shazam.com/discovery.jpg',
      }),
    } as unknown as MusicRecognizer;

    const mockYtDlp = {
      search: vi.fn().mockResolvedValue([
        {
          id: 'yt_vq123',
          title: 'Daft Punk - Veridis Quo (Official Audio)',
          channel: 'Daft Punk',
          duration: 345,
          url: 'https://www.youtube.com/watch?v=yt_vq123',
          thumbnail: 'https://i.ytimg.com/vi/yt_vq123/hqdefault.jpg',
        },
      ]),
    } as unknown as YtDlpRunner;

    const handler = createMusicRecognitionHandler(mockRecognizer, mockYtDlp);
    const ctx = createMockContext('en');
    ctx.message = {
      message_id: 10,
      voice: { file_id: 'voice_123', file_size: 500_000, duration: 12 },
    } as any;

    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('identifying'),
      expect.objectContaining({ reply_to_message_id: 10 })
    );
    expect(ctx.replyWithPhoto).toHaveBeenCalledWith(
      'https://images.shazam.com/discovery.jpg',
      expect.objectContaining({
        caption: expect.stringContaining('Veridis Quo'),
        parse_mode: 'HTML',
        reply_markup: expect.anything(),
      })
    );
  });

  it('handles unrecognized audio with friendly error message', async () => {
    vi.spyOn(downloader, 'downloadTelegramMediaFile').mockResolvedValue({
      filePath: '/tmp/unrec_voice.ogg',
      cleanup: vi.fn(),
    });

    const mockRecognizer = {
      identifyMedia: vi.fn().mockResolvedValue(null),
    } as unknown as MusicRecognizer;

    const handler = createMusicRecognitionHandler(mockRecognizer);
    const ctx = createMockContext('en');
    ctx.message = {
      message_id: 20,
      audio: { file_id: 'audio_unknown', file_size: 200_000, duration: 8 },
    } as any;

    await handler(ctx);

    expect(ctx.api.editMessageText).toHaveBeenCalledWith(
      2002,
      100,
      expect.stringContaining('Could not identify any song')
    );
  });
});
