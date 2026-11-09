import { describe, it, expect, vi } from 'vitest';
import { handleStartCommand } from '../../src/bot/commands/start.js';
import { handleHelpCommand } from '../../src/bot/commands/help.js';
import { handleAboutCommand } from '../../src/bot/commands/about.js';
import { handleLanguageCommand } from '../../src/bot/commands/language.js';
import { handleSettingsCommand } from '../../src/bot/commands/settings.js';
import { createStatusCommandHandler } from '../../src/bot/commands/status.js';
import { createHistoryCommandHandler } from '../../src/bot/commands/history.js';
import { createSearchCommandHandler } from '../../src/bot/commands/search.js';
import { createInlineQueryHandler } from '../../src/bot/handlers/inline-handler.js';
import { createAdminCommandHandler, handleAdminCallback } from '../../src/bot/commands/admin.js';
import { createCallbackHandler } from '../../src/bot/handlers/callback-handler.js';
import { resetConfigForTesting } from '../../src/config/env.js';
import { BotContext } from '../../src/bot/context.js';
import { translate } from '../../src/i18n/index.js';
import { JobRepository } from '../../src/database/repositories/job-repository.js';
import { UserRepository } from '../../src/database/repositories/user-repository.js';
import { MediaCacheRepository } from '../../src/database/repositories/media-cache-repository.js';
import { YtDlpRunner } from '../../src/services/downloads/ytdlp-runner.js';
import { ConcurrentJobLimitError, MediaTooLargeError } from '../../src/core/errors/domain-errors.js';

// Keep cancel/admin flows from opening a real Redis connection
vi.mock('../../src/queue/queues.js', () => ({
  getMediaQueue: () => ({
    getJob: vi.fn().mockResolvedValue(null),
    getJobCounts: vi.fn().mockResolvedValue({}),
    add: vi.fn().mockResolvedValue(undefined),
  }),
  closeMediaQueue: vi.fn().mockResolvedValue(undefined),
}));

function createMockContext(locale: 'en' | 'fa' = 'en'): BotContext {
  return {
    from: { id: 1001, first_name: 'TestUser', language_code: locale },
    chat: { id: 2002, type: 'private' },
    locale,
    t: (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    reply: vi.fn().mockResolvedValue({ message_id: 123 }),
    editMessageText: vi.fn().mockResolvedValue({ message_id: 123 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    answerInlineQuery: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    api: {
      editMessageText: vi.fn().mockResolvedValue({ message_id: 123 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      sendAudio: vi.fn().mockResolvedValue({ message_id: 777 }),
      sendVideo: vi.fn().mockResolvedValue({ message_id: 778 }),
      sendDocument: vi.fn().mockResolvedValue({ message_id: 779 }),
    },
  } as unknown as BotContext;
}

describe('Telegram Bot Commands', () => {
  it('/start replies with localized welcome and inline keyboard in English', async () => {
    const ctx = createMockContext('en');
    await handleStartCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replyText).toContain('Welcome to g(Rabbit)!');
    expect(options.reply_markup).toBeDefined();
  });

  it('/start replies with localized Persian welcome when locale is fa', async () => {
    const ctx = createMockContext('fa');
    await handleStartCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replyText).toContain('به g(Rabbit) خوش آمدید!');
    expect(replyText).toContain('زبان خود را انتخاب کنید');
  });

  it('/start skips language selection and shows glossy menu buttons once languageSelected is true', async () => {
    const ctx = createMockContext('en');
    ctx.userRecord = {
      id: 1001,
      languageCode: 'en',
      languageSelected: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await handleStartCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replyText).toContain('Welcome to g(Rabbit)!');
    expect(replyText).not.toContain('Select your preferred language');
    const flatButtons = options.reply_markup.inline_keyboard.flat();
    expect(flatButtons.some((b: any) => b.callback_data === 'menu:search' && b.style === 'primary')).toBe(true);
    expect(flatButtons.some((b: any) => b.callback_data === 'menu:history' && b.style === 'success')).toBe(true);
    // Search gets its own row; inline search lives on the Search screen instead
    expect(options.reply_markup.inline_keyboard[0]).toHaveLength(1);
    expect(flatButtons.some((b: any) => 'switch_inline_query_current_chat' in b)).toBe(false);
  });

  it('/help replies with platform list and command guide', async () => {
    const ctx = createMockContext('en');
    await handleHelpCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replyText).toContain('How to use g(Rabbit)');
    expect(replyText).toContain('YouTube');
    expect(replyText).toContain('Spotify');
  });

  it('/about describes architecture and stack', async () => {
    const ctx = createMockContext('en');
    await handleAboutCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replyText).toContain('BullMQ');
    expect(replyText).toContain('PostgreSQL');
  });

  it('/language shows language selection inline buttons', async () => {
    const ctx = createMockContext('en');
    await handleLanguageCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.reply_markup).toBeDefined();
  });

  it('/settings shows user preferences, current language, and default format selector', async () => {
    const ctx = createMockContext('fa');
    await handleSettingsCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replyText).toContain('تنظیمات');
    expect(replyText).toContain('فارسی');
    expect(replyText).toContain('فرمت پیش‌فرض');
    expect(options.reply_markup).toBeDefined();
  });

  it('/history displays recent completed jobs with Re-send inline buttons', async () => {
    const mockJobRepo = {
      getRecentJobs: vi.fn().mockResolvedValue([
        {
          id: 'job_hist_1',
          userId: 1001,
          platform: 'youtube',
          mediaId: 'yt123',
          title: 'Daft Punk - Veridis Quo',
          format: 'audio',
          qualityId: 'bestaudio',
          status: 'completed',
          fileSizeBytes: 5242880,
        },
      ]),
    } as unknown as JobRepository;

    const handler = createHistoryCommandHandler(mockJobRepo);
    const ctx = createMockContext('en');
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replyText).toContain('Your recent downloads');
    expect(replyText).toContain('Daft Punk - Veridis Quo');
    expect(replyText).toContain('YouTube · 5.0 MB');
    expect(options.reply_markup).toBeDefined();
  });

  it('/search queries YtDlpRunner and renders top matches with MP3/MP4 buttons', async () => {
    const mockYtDlp = {
      search: vi.fn().mockResolvedValue([
        {
          id: 'yt_abc',
          title: 'Kavinsky - Nightcall',
          channel: 'Kavinsky',
          duration: 258,
          url: 'https://www.youtube.com/watch?v=yt_abc',
        },
      ]),
    } as unknown as YtDlpRunner;

    const handler = createSearchCommandHandler(mockYtDlp);
    const ctx = createMockContext('en');
    ctx.message = { text: '/search Kavinsky Nightcall' } as any;

    await handler(ctx);

    expect(mockYtDlp.search).toHaveBeenCalledWith('Kavinsky Nightcall', 15, expect.any(Array));
    expect(ctx.api.editMessageText).toHaveBeenCalledOnce();
    const [, , renderedText, opts] = (ctx.api.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(renderedText).toContain('Kavinsky - Nightcall');
    const buttons = opts.reply_markup.inline_keyboard;
    // One row per result (audio + video), then a Close row
    expect(buttons[0].map((b: any) => b.text)).toEqual(['🎵 1 · Audio', '🎬 1 · Video']);
    expect(buttons[0][0].callback_data).toMatch(/^srch:audio:/);
    expect(buttons[0][1].callback_data).toMatch(/^srch:video:/);
    expect(buttons[1][0].text).toBe('✖️ Close');
  });

  it('inline_query returns cached media and YouTube search articles', async () => {
    const mockCacheRepo = {
      searchCachedMedia: vi.fn().mockResolvedValue([
        {
          platform: 'youtube',
          mediaId: 'cached_1',
          format: 'audio',
          qualityId: 'bestaudio',
          telegramFileId: 'CQACAgIAAxkB_cached_file_id',
          title: 'Cached Synthwave Track',
          author: 'FM-84',
        },
      ]),
    } as unknown as MediaCacheRepository;

    const mockYtDlp = {
      search: vi.fn().mockResolvedValue([
        {
          id: 'yt_inline_1',
          title: 'FM-84 - Running in the Night',
          channel: 'NewRetroWave',
          duration: 270,
          url: 'https://www.youtube.com/watch?v=yt_inline_1',
        },
      ]),
    } as unknown as YtDlpRunner;

    const handler = createInlineQueryHandler(mockCacheRepo, mockYtDlp);
    const ctx = createMockContext('en');
    (ctx as any).inlineQuery = { id: 'iq_1', query: 'FM-84' };

    await handler(ctx);

    expect(ctx.answerInlineQuery).toHaveBeenCalledOnce();
    const [results] = (ctx.answerInlineQuery as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('audio');
    expect(results[1].type).toBe('article');
  });

  it('/status shows empty state message when no active jobs exist', async () => {
    const mockJobRepo = {
      getActiveUserJobs: vi.fn().mockResolvedValue([]),
    } as unknown as JobRepository;

    const handler = createStatusCommandHandler(mockJobRepo);
    const ctx = createMockContext('en');

    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replyText).toBe('💤 No active downloads right now.');
    const flatButtons = options.reply_markup.inline_keyboard.flat();
    expect(flatButtons.map((b: any) => b.callback_data)).toEqual(['menu:home']);
  });

  it('/status safely escapes HTML entities in active job titles', async () => {
    const mockJobRepo = {
      getActiveUserJobs: vi.fn().mockResolvedValue([
        {
          id: 'job_123_abc',
          title: 'Artist_Name *Special* <Track> & [Remix]',
          status: 'processing',
          progressPercent: 40,
        },
      ]),
    } as unknown as JobRepository;

    const handler = createStatusCommandHandler(mockJobRepo);
    const ctx = createMockContext('en');

    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.parse_mode).toBe('HTML');
    expect(replyText).toContain('Artist_Name *Special* &lt;Track&gt; &amp; [Remix]');
    // Localized status label instead of the raw DB status / internal job ID
    expect(replyText).toContain('⬇️ Downloading');
    expect(replyText).not.toContain('job_123_abc');
    const rows = options.reply_markup.inline_keyboard;
    expect(rows[0][0].callback_data).toBe('cancel:list:job_123_abc');
    expect(rows[1].map((b: any) => b.callback_data)).toEqual(['menu:status', 'menu:home']);
  });

  it('/admin renders interactive admin dashboard for authorized admin', async () => {
    process.env.ADMIN_USER_IDS = '1001';
    resetConfigForTesting();

    const mockUserRepo = {
      getUserStats: vi.fn().mockResolvedValue({ totalUsers: 12, activeLast24h: 4 }),
      listUsers: vi.fn().mockResolvedValue({ total: 1, users: [] }),
    } as unknown as UserRepository;

    const mockJobRepo = {
      getGlobalStats: vi.fn().mockResolvedValue({
        totalJobs: 30,
        completedJobs: 28,
        failedJobs: 2,
        activeJobs: 0,
        totalBytesDelivered: 104857600,
        topPlatforms: [{ platform: 'youtube', count: 20 }],
      }),
    } as unknown as JobRepository;

    const mockCacheRepo = {
      getCacheStats: vi.fn().mockResolvedValue({ totalItems: 5, totalBytes: 52428800 }),
    } as any;

    const handler = createAdminCommandHandler(mockUserRepo, mockJobRepo, mockCacheRepo);
    const ctx = createMockContext('en');

    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [replyText, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replyText).toContain('Admin Panel');
    expect(replyText).toContain('Total registered: <b>12</b>');
    // Repo without getFailureReasons (older mocks) still renders a failures section
    expect(replyText).toContain('No failures');
    expect(options.reply_markup).toBeDefined();

    // Test admin:users:0 callback navigation
    ctx.callbackQuery = {
      data: 'admin:users:0',
      message: { message_id: 999 },
    } as unknown as BotContext['callbackQuery'];

    const handled = await handleAdminCallback(ctx, mockUserRepo, mockJobRepo, mockCacheRepo);
    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledOnce();
  });

  it('blocks banned users in createUserSyncMiddleware and allows VIP/ban actions in /admin', async () => {
    const { createUserSyncMiddleware } = await import('../../src/bot/middleware/user-sync.js');
    process.env.ADMIN_USER_IDS = '1001';
    resetConfigForTesting();

    const mockUserRepo = {
      getUser: vi.fn().mockResolvedValue({
        id: 2002,
        firstName: 'BannedGuy',
        languageCode: 'en',
        isBanned: true,
        tier: 'free',
      }),
      setUserTier: vi.fn().mockResolvedValue(undefined),
      setUserBanned: vi.fn().mockResolvedValue(undefined),
    } as unknown as UserRepository;

    const syncMw = createUserSyncMiddleware(mockUserRepo);
    const bannedCtx = {
      from: { id: 2002, first_name: 'BannedGuy', language_code: 'en' },
      chat: { id: 2002 },
      reply: vi.fn().mockResolvedValue({}),
    } as unknown as BotContext;

    const next = vi.fn();
    await syncMw(bannedCtx, next);
    expect(next).not.toHaveBeenCalled();
    expect(bannedCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('suspended')
    );

    // Admin promotes user 2002 to VIP via callback
    const adminCtx = createMockContext('en');
    adminCtx.callbackQuery = {
      data: 'admin:utier:2002:vip:0',
      message: { message_id: 888 },
    } as unknown as BotContext['callbackQuery'];

    const handled = await handleAdminCallback(adminCtx, mockUserRepo, {} as JobRepository);
    expect(handled).toBe(true);
    expect(mockUserRepo.setUserTier).toHaveBeenCalledWith(2002, 'vip');
  });
});

describe('Callback Query Handler', () => {
  it('updates language when lang:fa callback received', async () => {
    const mockUserRepo = {
      updateLanguage: vi.fn().mockResolvedValue(undefined),
    } as unknown as UserRepository;
    const mockJobRepo = {} as unknown as JobRepository;

    const handler = createCallbackHandler(mockUserRepo, mockJobRepo);
    const ctx = createMockContext('en');
    ctx.callbackQuery = {
      data: 'lang:fa',
      message: { message_id: 456 },
    } as unknown as BotContext['callbackQuery'];

    await handler(ctx);

    expect(mockUserRepo.updateLanguage).toHaveBeenCalledWith(1001, 'fa');
    expect(ctx.editMessageText).toHaveBeenCalledOnce();
    const [editText] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(editText).toContain('زبان به فارسی تغییر کرد.');
    expect(editText).toContain('به g(Rabbit) خوش آمدید!');
  });

  it('updates default format preference when pref:fmt:audio callback received', async () => {
    const mockUserRepo = {
      updateDefaultFormat: vi.fn().mockResolvedValue(undefined),
    } as unknown as UserRepository;
    const mockJobRepo = {} as unknown as JobRepository;

    const handler = createCallbackHandler(mockUserRepo, mockJobRepo);
    const ctx = createMockContext('en');
    ctx.callbackQuery = {
      data: 'pref:fmt:audio',
      message: { message_id: 457 },
    } as unknown as BotContext['callbackQuery'];

    await handler(ctx);

    expect(mockUserRepo.updateDefaultFormat).toHaveBeenCalledWith(1001, 'audio');
    expect(ctx.editMessageText).toHaveBeenCalledOnce();
    const [editText, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(editText).toContain('Default format saved.');
    expect(editText).toContain('Default format: 🎵 Audio (MP3)');
    const flatButtons = options.reply_markup.inline_keyboard.flat();
    expect(flatButtons.find((b: any) => b.callback_data === 'pref:fmt:audio').text).toBe(
      '✅ 🎵 Audio (MP3)'
    );
  });

  it('ignores "message is not modified" when re-tapping the selected format', async () => {
    const mockUserRepo = {
      updateDefaultFormat: vi.fn().mockResolvedValue(undefined),
    } as unknown as UserRepository;
    const handler = createCallbackHandler(mockUserRepo, {} as unknown as JobRepository);
    const ctx = createMockContext('en');
    ctx.callbackQuery = {
      data: 'pref:fmt:audio',
      message: { message_id: 457 },
    } as unknown as BotContext['callbackQuery'];
    (ctx.editMessageText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('Bad Request'), {
        description: 'Bad Request: message is not modified',
      })
    );

    await expect(handler(ctx)).resolves.toBeUndefined();
  });

  it('shows an expiry hint when a format button outlives its preview cache', async () => {
    const handler = createCallbackHandler(
      {} as unknown as UserRepository,
      {} as unknown as JobRepository
    );
    const ctx = createMockContext('fa');
    ctx.callbackQuery = {
      data: 'dl:deadbeef0000:audio:bestaudio',
      message: { message_id: 459 },
    } as unknown as BotContext['callbackQuery'];

    await handler(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      '⌛ این منو منقضی شده است. لینک را دوباره بفرستید.',
      undefined
    );
  });

  it('cancelling from the active list re-renders the list with a confirmation', async () => {
    const mockJobRepo = {
      getJob: vi.fn().mockResolvedValue({
        id: 'job_a',
        userId: 1001,
        title: 'Song A',
        format: 'audio',
        status: 'processing',
      }),
      updateJobStatus: vi.fn().mockResolvedValue(undefined),
      getActiveUserJobs: vi.fn().mockResolvedValue([]),
    } as unknown as JobRepository;

    const handler = createCallbackHandler({} as unknown as UserRepository, mockJobRepo);
    const ctx = createMockContext('en');
    ctx.callbackQuery = {
      data: 'cancel:list:job_a',
      message: { message_id: 460 },
    } as unknown as BotContext['callbackQuery'];

    await handler(ctx);

    expect(mockJobRepo.updateJobStatus).toHaveBeenCalledWith('job_a', 'cancelled');
    const [editText, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(editText).toContain('🚫 Cancelled: Song A');
    expect(editText).toContain('No active downloads right now.');
    expect(options.reply_markup.inline_keyboard.flat()[0].callback_data).toBe('menu:home');
  });

  it('re-sends cached media immediately on hist:resend:<jobId>', async () => {
    const mockUserRepo = {} as unknown as UserRepository;
    const mockJobRepo = {
      getJob: vi.fn().mockResolvedValue({
        id: 'job_hist_1',
        userId: 1001,
        platform: 'youtube',
        mediaId: 'yt_123',
        title: 'Cached Song',
        format: 'audio',
        qualityId: 'bestaudio',
        status: 'completed',
      }),
    } as unknown as JobRepository;
    const mockCacheRepo = {
      getCachedMedia: vi.fn().mockResolvedValue({
        platform: 'youtube',
        mediaId: 'yt_123',
        format: 'audio',
        qualityId: 'bestaudio',
        telegramFileId: 'CQACAgIAAxkB_cached_audio',
        author: 'Artist',
      }),
    } as unknown as MediaCacheRepository;

    const handler = createCallbackHandler(mockUserRepo, mockJobRepo, mockCacheRepo);
    const ctx = createMockContext('en');
    ctx.callbackQuery = {
      data: 'hist:resend:job_hist_1',
      message: { message_id: 458 },
    } as unknown as BotContext['callbackQuery'];

    await handler(ctx);

    expect(ctx.api.sendAudio).toHaveBeenCalledWith(
      2002,
      'CQACAgIAAxkB_cached_audio',
      expect.objectContaining({ title: 'Cached Song' })
    );
    const [, , sendOpts] = (ctx.api.sendAudio as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sendOpts.caption).toContain('🎵 <b>Cached Song</b>');
    expect(sendOpts.caption).toContain('Delivered by @gRabbit_robot');
  });

  it('enforces the download limit when re-sending an uncached history item', async () => {
    const mockJobRepo = {
      getJob: vi.fn().mockResolvedValue({
        id: 'job_hist_2',
        userId: 1001,
        platform: 'youtube',
        mediaId: 'yt_456',
        title: 'Evicted Song',
        format: 'audio',
        qualityId: 'bestaudio',
        status: 'completed',
      }),
      // More active jobs than any tier allows
      getActiveUserJobs: vi.fn().mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ id: `a${i}` }))),
      createJob: vi.fn(),
    } as unknown as JobRepository;
    const mockCacheRepo = {
      getCachedMedia: vi.fn().mockResolvedValue(null),
    } as unknown as MediaCacheRepository;

    const handler = createCallbackHandler({} as unknown as UserRepository, mockJobRepo, mockCacheRepo);
    const ctx = createMockContext('en');
    ctx.callbackQuery = {
      data: 'hist:resend:job_hist_2',
      message: { message_id: 461 },
    } as unknown as BotContext['callbackQuery'];

    await expect(handler(ctx)).rejects.toBeInstanceOf(ConcurrentJobLimitError);
    expect(mockJobRepo.createJob).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

describe('Localized error formatting', () => {
  it('renders file sizes with locale digits in the file-too-large error', () => {
    const { i18nParams } = new MediaTooLargeError(50, 73.42);
    const fa = translate('fa', 'error-file-too-large', i18nParams);
    expect(fa).toContain('۷۳٫۴');
    expect(fa).toContain('۵۰');
    expect(fa).not.toMatch(/[0-9]/);

    const en = translate('en', 'error-file-too-large', i18nParams);
    expect(en).toContain('73.4 MB, limit 50 MB');
  });
});

describe('Bot Formatting Utilities', () => {
  it('renderProgressBar renders empty, partial, and full progress bars', async () => {
    const { renderProgressBar } = await import('../../src/bot/formatting.js');
    expect(renderProgressBar(0)).toBe('[░░░░░░░░░░]');
    expect(renderProgressBar(50)).toBe('[█████░░░░░]');
    expect(renderProgressBar(100)).toBe('[██████████]');
    expect(renderProgressBar(150)).toBe('[██████████]');
    expect(renderProgressBar(-10)).toBe('[░░░░░░░░░░]');
  });

  it('escapeHtml escapes dangerous HTML characters', async () => {
    const { escapeHtml } = await import('../../src/bot/formatting.js');
    expect(escapeHtml('Title <with> & "special" characters')).toBe('Title &lt;with&gt; &amp; "special" characters');
  });
});
