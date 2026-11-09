import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotContext } from '../../src/bot/context.js';
import { translate } from '../../src/i18n/index.js';
import { resetConfigForTesting } from '../../src/config/env.js';
import { JobRepository } from '../../src/database/repositories/job-repository.js';
import { UserRepository } from '../../src/database/repositories/user-repository.js';
import { PlatformRouter } from '../../src/platforms/platform-router.js';
import { YtDlpRunner } from '../../src/services/downloads/ytdlp-runner.js';
import { createCallbackHandler } from '../../src/bot/handlers/callback-handler.js';
import {
  createUrlHandler,
  createDownloadCommandHandler,
  processMediaUrl,
} from '../../src/bot/handlers/url-handler.js';
import { executeSearchQuery } from '../../src/bot/commands/search.js';
import { previewCache } from '../../src/bot/handlers/preview-cache.js';
import { buildAdminOverviewHtml } from '../../src/bot/commands/admin.js';
import {
  RateLimiter,
  RedisRateLimitStore,
} from '../../src/bot/middleware/rate-limiter.js';
import { RateLimitExceededError } from '../../src/core/errors/domain-errors.js';
import { YouTubeAdapter } from '../../src/platforms/youtube/youtube-adapter.js';
import { SpotifyAdapter } from '../../src/platforms/spotify/spotify-adapter.js';
import { PlatformMetadata } from '../../src/core/types/platform.js';

const queueAdd = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/queue/queues.js', () => ({
  getMediaQueue: () => ({
    getJob: vi.fn().mockResolvedValue(null),
    getJobCounts: vi.fn().mockResolvedValue({}),
    add: queueAdd,
  }),
  closeMediaQueue: vi.fn().mockResolvedValue(undefined),
}));

let nextMessageId = 500;

function createMockContext(
  locale: 'en' | 'fa' = 'en',
  opts: { userId?: number; chatType?: string } = {}
): BotContext {
  return {
    from: { id: opts.userId ?? 1001, first_name: 'TestUser', language_code: locale },
    chat: { id: 2002, type: opts.chatType ?? 'private' },
    me: { username: 'gRabbit_robot' },
    locale,
    t: (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    reply: vi.fn().mockImplementation(async () => ({ message_id: nextMessageId++ })),
    editMessageText: vi.fn().mockResolvedValue({ message_id: 123 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    api: {
      editMessageText: vi.fn().mockResolvedValue({ message_id: 123 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as BotContext;
}

function makeAlbum(trackCount: number): PlatformMetadata {
  return {
    platform: 'spotify',
    url: 'https://open.spotify.com/album/abc',
    title: 'Discovery',
    artistOrAuthor: 'Daft Punk',
    isAuthorized: true,
    isCollection: true,
    items: Array.from({ length: trackCount }, (_, i) => ({
      id: `t${i + 1}`,
      title: `Track ${i + 1}`,
      uploader: 'Daft Punk',
      durationSeconds: 200,
      platform: 'spotify' as const,
      url: `https://open.spotify.com/track/t${i + 1}`,
      isDownloadable: true,
      availableOptions: [
        { format: 'audio' as const, qualityId: 'bestaudio', label: 'Audio (MP3)', extension: 'mp3' },
      ],
    })),
  };
}

function callbackButtons(markup: any): any[] {
  return markup.inline_keyboard.flat();
}

beforeEach(() => {
  // A configured admin list that doesn't include the test user -> free tier (2 at a time)
  process.env.ADMIN_USER_IDS = '999';
  resetConfigForTesting();
  queueAdd.mockClear();
});

describe('Search paging', () => {
  it('shows 5 results per page with a More button, and pages through the rest', async () => {
    const results = Array.from({ length: 7 }, (_, i) => ({
      id: `v${i + 1}`,
      title: `Song ${i + 1}`,
      channel: 'Channel',
      duration: 180,
      url: `https://www.youtube.com/watch?v=v${i + 1}`,
    }));
    const ytdlp = { search: vi.fn().mockResolvedValue(results) } as unknown as YtDlpRunner;
    const ctx = createMockContext('en');

    await executeSearchQuery(ctx, 'songs', ytdlp);

    const [, , firstPage, opts] = (ctx.api.editMessageText as any).mock.calls[0];
    expect(firstPage).toContain('5. <b>Song 5</b>');
    expect(firstPage).not.toContain('Song 6');
    const more = callbackButtons(opts.reply_markup).find((b) => b.text === 'More ➡️');
    expect(more.callback_data).toMatch(/^sp:[0-9a-f]+:1$/);

    const handler = createCallbackHandler({} as UserRepository, {} as JobRepository);
    ctx.callbackQuery = { data: more.callback_data, message: { message_id: 1 } } as any;
    await handler(ctx);

    const [secondPage] = (ctx.editMessageText as any).mock.calls[0];
    expect(secondPage).toContain('6. <b>Song 6</b>');
    expect(secondPage).toContain('7. <b>Song 7</b>');
    expect(secondPage).not.toContain('Song 5');
  });
});

describe('Album / playlist track picker', () => {
  it('lists the tracks with number buttons and a Download all button', async () => {
    const router = { getMetadata: vi.fn().mockResolvedValue(makeAlbum(10)) } as unknown as PlatformRouter;
    const ctx = createMockContext('en');

    await processMediaUrl(ctx, 'https://open.spotify.com/album/abc', router, {} as JobRepository);

    const [, , text, opts] = (ctx.api.editMessageText as any).mock.calls[0];
    expect(text).toContain('🎶 <b>Discovery</b>');
    expect(text).toContain('10 tracks');
    expect(text).toContain('8. Track 8 · 03:20');
    expect(text).not.toContain('Track 9'); // second page
    const buttons = callbackButtons(opts.reply_markup);
    expect(buttons.filter((b) => /^col:t:/.test(b.callback_data))).toHaveLength(8);
    expect(buttons.find((b) => b.text === '1/2')).toBeDefined();
    expect(buttons.find((b) => /^col:all:/.test(b.callback_data)).text).toBe(
      '⬇️ Download all as audio (10)'
    );
  });

  it('"Download all" queues only as many tracks as the user may run at once', async () => {
    const router = { getMetadata: vi.fn().mockResolvedValue(makeAlbum(10)) } as unknown as PlatformRouter;
    const jobRepo = {
      getActiveUserJobs: vi.fn().mockResolvedValue([]),
      createJob: vi.fn().mockImplementation(async (j: any) => j),
    } as unknown as JobRepository;
    const ctx = createMockContext('en');
    await processMediaUrl(ctx, 'https://open.spotify.com/album/abc', router, jobRepo);
    const [, , , opts] = (ctx.api.editMessageText as any).mock.calls[0];
    const allBtn = callbackButtons(opts.reply_markup).find((b) => /^col:all:/.test(b.callback_data));

    const handler = createCallbackHandler({} as UserRepository, jobRepo);
    ctx.callbackQuery = { data: allBtn.callback_data, message: { message_id: 1 } } as any;
    (ctx.reply as any).mockClear(); // ignore the "Checking your link…" message
    await handler(ctx);

    // Free tier: 2 at a time -> 2 jobs, each with its own status card
    expect(jobRepo.createJob).toHaveBeenCalledTimes(2);
    expect(queueAdd).toHaveBeenCalledTimes(2);
    expect((jobRepo.createJob as any).mock.calls[0][0]).toMatchObject({
      title: 'Track 1',
      format: 'audio',
      sourceUrl: 'https://open.spotify.com/track/t1',
    });
    expect(ctx.reply).toHaveBeenCalledTimes(2);

    const [listText, listOpts] = (ctx.editMessageText as any).mock.calls[0];
    expect(listText).toContain('✅ Queued 2.');
    expect(listText).toContain('1. ✅ Track 1');
    expect(callbackButtons(listOpts.reply_markup).find((b) => /^col:all:/.test(b.callback_data)).text).toBe(
      '⬇️ Queue the next ones (8 left)'
    );
  });
});

describe('Group chats', () => {
  it('only treats group text as a search when it starts with the bot mention', async () => {
    const ytdlp = { search: vi.fn().mockResolvedValue([]) } as unknown as YtDlpRunner;
    const handler = createUrlHandler({} as PlatformRouter, {} as JobRepository, ytdlp);

    const plain = createMockContext('en', { chatType: 'supergroup' });
    plain.message = { text: 'daft punk' } as any;
    await handler(plain);
    expect(ytdlp.search).not.toHaveBeenCalled();

    const mentioned = createMockContext('en', { chatType: 'supergroup' });
    mentioned.message = { text: '@gRabbit_robot daft punk' } as any;
    await handler(mentioned);
    expect(ytdlp.search).toHaveBeenCalledWith('daft punk', 15, expect.any(Array));
  });

  it('/dl downloads the link from the message it replies to', async () => {
    const router = {
      getMetadata: vi.fn().mockResolvedValue({ ...makeAlbum(1), isCollection: false }),
    } as unknown as PlatformRouter;
    const handler = createDownloadCommandHandler(router, {} as JobRepository);
    const ctx = createMockContext('en', { chatType: 'group' });
    ctx.message = {
      text: '/dl@gRabbit_robot',
      reply_to_message: { text: 'listen: https://open.spotify.com/track/t1' },
    } as any;

    await handler(ctx);
    expect(router.getMetadata).toHaveBeenCalledWith('https://open.spotify.com/track/t1');
  });

  it('/dl without a link explains how to use it', async () => {
    const handler = createDownloadCommandHandler({} as PlatformRouter, {} as JobRepository);
    const ctx = createMockContext('en', { chatType: 'group' });
    ctx.message = { text: '/dl' } as any;
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(translate('en', 'dl-usage'));
  });

  it("blocks other users from pressing someone else's menu buttons", async () => {
    previewCache.set('ownedkey0001', {
      url: 'https://youtu.be/x',
      platform: 'youtube',
      ownerId: 1001,
      metadata: makeAlbum(1),
    });
    const handler = createCallbackHandler({} as UserRepository, {} as JobRepository);
    const intruder = createMockContext('en', { userId: 4242, chatType: 'group' });
    intruder.callbackQuery = { data: 'dl:ownedkey0001:audio:bestaudio', message: { message_id: 9 } } as any;

    await handler(intruder);

    expect(intruder.answerCallbackQuery).toHaveBeenCalledWith({
      text: translate('en', 'error-not-your-menu'),
      show_alert: true,
    });
    expect(intruder.editMessageText).not.toHaveBeenCalled();
  });
});

describe('Admin failure reasons', () => {
  const userRepo = {
    getUserStats: vi.fn().mockResolvedValue({ totalUsers: 3, activeLast24h: 1 }),
  } as unknown as UserRepository;
  const jobRepo = {
    getGlobalStats: vi.fn().mockResolvedValue({
      totalJobs: 10,
      completedJobs: 6,
      failedJobs: 4,
      activeJobs: 0,
      totalBytesDelivered: 0,
      topPlatforms: [],
    }),
    getFailureReasons: vi.fn().mockResolvedValue([
      { reason: 'error-bot-verification', count: 3 },
      { reason: 'other', count: 1 },
    ]),
  } as unknown as JobRepository;
  const cacheRepo = { getCacheStats: vi.fn().mockResolvedValue({ totalItems: 0, totalBytes: 0 }) } as any;

  it('lists the top failure reasons with readable labels', async () => {
    const html = await buildAdminOverviewHtml(userRepo, jobRepo, cacheRepo, 'en');
    expect(html).toContain('<b>❌ Failures (last 24h)</b>');
    expect(html).toContain('• YouTube bot check (refresh cookies): <b>3</b>');
    expect(html).toContain('• Other / older: <b>1</b>');
  });

  it('renders the admin overview in Persian', async () => {
    const html = await buildAdminOverviewHtml(userRepo, jobRepo, cacheRepo, 'fa');
    expect(html).toContain('پنل مدیریت');
    expect(html).toContain('• کل کاربران: <b>۳</b>');
    expect(html).toContain('بررسی ربات یوتیوب');
  });
});

describe('Redis-backed rate limiting', () => {
  it('counts hits in Redis and reports the remaining wait', async () => {
    let count = 0;
    const redis = {
      status: 'ready',
      eval: vi.fn().mockImplementation(async () => [++count, 42000]),
    };
    const limiter = new RateLimiter(2, 60000, new RedisRateLimitStore(redis as any));
    const mw = limiter.middleware();
    const ctx = { from: { id: 7 } } as BotContext;
    const next = vi.fn();

    await mw(ctx, next);
    await mw(ctx, next);
    await expect(mw(ctx, next)).rejects.toMatchObject({
      i18nParams: { seconds: 42 },
    });
    expect(next).toHaveBeenCalledTimes(2);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'grabbit:ratelimit:7', '60000');
  });

  it('falls back to in-memory counting when Redis is not ready', async () => {
    const redis = { status: 'connecting', eval: vi.fn() };
    const limiter = new RateLimiter(1, 60000, new RedisRateLimitStore(redis as any));
    const mw = limiter.middleware();
    const ctx = { from: { id: 8 } } as BotContext;

    await mw(ctx, vi.fn());
    await expect(mw(ctx, vi.fn())).rejects.toThrow(RateLimitExceededError);
    expect(redis.eval).not.toHaveBeenCalled();
  });
});

describe('Collection metadata from adapters', () => {
  it('YouTube playlist links become a track list', async () => {
    const ytdlp = {
      getPlaylistEntries: vi.fn().mockResolvedValue({
        title: 'Chill Mix',
        uploader: 'Someone',
        entries: [
          { id: 'a', title: 'One', url: 'https://www.youtube.com/watch?v=a', duration: 60 },
          { id: 'b', title: 'Two', url: 'https://www.youtube.com/watch?v=b' },
        ],
      }),
    } as unknown as YtDlpRunner;

    const meta = await new YouTubeAdapter(ytdlp).fetchMetadata(
      'https://www.youtube.com/playlist?list=PL123'
    );
    expect(meta.isCollection).toBe(true);
    expect(meta.title).toBe('Chill Mix');
    expect(meta.items.map((i) => i.url)).toEqual([
      'https://www.youtube.com/watch?v=a',
      'https://www.youtube.com/watch?v=b',
    ]);
  });

  it('a watch link with &list= stays a single video', () => {
    expect(YouTubeAdapter.isPlaylistUrl('https://www.youtube.com/watch?v=a&list=PL123')).toBe(false);
  });

  it('Spotify albums list their tracks when API credentials are configured', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'id';
    process.env.SPOTIFY_CLIENT_SECRET = 'secret';
    resetConfigForTesting();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('oembed')) return { ok: true, json: async () => ({ title: 'Discovery' }) };
      if (url.includes('/api/token')) return { ok: true, json: async () => ({ access_token: 'tok' }) };
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: 's1', name: 'One More Time', type: 'track', artists: [{ name: 'Daft Punk' }], duration_ms: 320000 },
            { id: 's2', name: 'Aerodynamic', type: 'track', artists: [{ name: 'Daft Punk' }] },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const meta = await new SpotifyAdapter().fetchMetadata('https://open.spotify.com/album/xyz');
      expect(meta.isCollection).toBe(true);
      expect(meta.title).toBe('Discovery');
      expect(meta.artistOrAuthor).toBe('Daft Punk');
      expect(meta.items[0]).toMatchObject({
        title: 'One More Time',
        url: 'https://open.spotify.com/track/s1',
        durationSeconds: 320,
        isDownloadable: true,
      });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.SPOTIFY_CLIENT_ID;
      delete process.env.SPOTIFY_CLIENT_SECRET;
      resetConfigForTesting();
    }
  });
});
