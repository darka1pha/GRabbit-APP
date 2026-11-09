import { Bot } from 'grammy';
import { BotContext } from './context.js';
import { getConfig } from '../config/env.js';
import { errorBoundaryMiddleware } from './middleware/error-boundary.js';
import { createUserSyncMiddleware } from './middleware/user-sync.js';
import { createForceJoinMiddleware } from './middleware/force-join.js';
import { RateLimiter, RedisRateLimitStore } from './middleware/rate-limiter.js';
import { getRedisConnection } from '../queue/redis.js';
import { UserRepository } from '../database/repositories/user-repository.js';
import { JobRepository } from '../database/repositories/job-repository.js';
import { MediaCacheRepository } from '../database/repositories/media-cache-repository.js';
import { PlatformRouter } from '../platforms/platform-router.js';
import { handleStartCommand } from './commands/start.js';
import { handleHelpCommand } from './commands/help.js';
import { handleAboutCommand } from './commands/about.js';
import { handleLanguageCommand } from './commands/language.js';
import { handleSettingsCommand } from './commands/settings.js';
import { createStatusCommandHandler } from './commands/status.js';
import { createCancelCommandHandler } from './commands/cancel.js';
import { createStatsCommandHandler } from './commands/stats.js';
import { createSearchCommandHandler } from './commands/search.js';
import { createHistoryCommandHandler } from './commands/history.js';
import {
  createAdminCommandHandler,
  createAdminBroadcastMiddleware,
  createUserModerationCommandHandler,
} from './commands/admin.js';
import { createUrlHandler, createDownloadCommandHandler } from './handlers/url-handler.js';
import { createCallbackHandler } from './handlers/callback-handler.js';
import { createInlineQueryHandler } from './handlers/inline-handler.js';
import { createMusicRecognitionHandler } from './handlers/recognition-handler.js';
import { YtDlpRunner } from '../services/downloads/ytdlp-runner.js';
import { MusicRecognizer } from '../services/recognition/music-recognizer.js';

export interface CreateBotOptions {
  token?: string;
  userRepo?: UserRepository;
  jobRepo?: JobRepository;
  mediaCacheRepo?: MediaCacheRepository;
  platformRouter?: PlatformRouter;
  ytdlpRunner?: YtDlpRunner;
  musicRecognizer?: MusicRecognizer;
}

export function createBot(options: CreateBotOptions = {}): Bot<BotContext> {
  const config = getConfig();
  const token = options.token || config.BOT_TOKEN;
  const bot = new Bot<BotContext>(token, {
    client: config.TELEGRAM_API_ROOT
      ? {
          apiRoot: config.TELEGRAM_API_ROOT,
        }
      : undefined,
  });

  const userRepo = options.userRepo || new UserRepository();
  const jobRepo = options.jobRepo || new JobRepository();
  const mediaCacheRepo = options.mediaCacheRepo || new MediaCacheRepository();
  const router = options.platformRouter || new PlatformRouter();
  const ytdlpRunner = options.ytdlpRunner || new YtDlpRunner();
  const musicRecognizer = options.musicRecognizer || new MusicRecognizer();

  // Redis-backed so limits are shared across bot processes and survive restarts
  const rateLimiter =
    process.env.NODE_ENV === 'test'
      ? new RateLimiter()
      : new RateLimiter(undefined, undefined, new RedisRateLimitStore(getRedisConnection()));

  // Global Error Boundary
  bot.catch(errorBoundaryMiddleware);

  // Middlewares
  bot.use(createUserSyncMiddleware(userRepo));
  bot.use(rateLimiter.middleware());
  bot.use(createForceJoinMiddleware(userRepo));

  // Commands
  bot.command('start', handleStartCommand);
  bot.command('help', handleHelpCommand);
  bot.command('about', handleAboutCommand);
  bot.command('language', handleLanguageCommand);
  bot.command('settings', handleSettingsCommand);
  bot.command('search', createSearchCommandHandler(ytdlpRunner));
  bot.command('dl', createDownloadCommandHandler(router, jobRepo));
  bot.command('history', createHistoryCommandHandler(jobRepo));
  bot.command('status', createStatusCommandHandler(jobRepo));
  bot.command('cancel', createCancelCommandHandler(jobRepo));
  bot.command('stats', createStatsCommandHandler(userRepo, jobRepo, mediaCacheRepo));
  bot.command('admin', createAdminCommandHandler(userRepo, jobRepo, mediaCacheRepo));
  bot.command('ban', createUserModerationCommandHandler(userRepo, 'ban'));
  bot.command('unban', createUserModerationCommandHandler(userRepo, 'unban'));
  bot.command('vip', createUserModerationCommandHandler(userRepo, 'vip'));
  bot.command('unvip', createUserModerationCommandHandler(userRepo, 'unvip'));

  // Inline Query Mode (@gRabbit_robot <query>)
  bot.on('inline_query', createInlineQueryHandler(mediaCacheRepo, ytdlpRunner));

  // Callbacks
  bot.on('callback_query:data', createCallbackHandler(userRepo, jobRepo, mediaCacheRepo));

  // Music Recognition for incoming audio, voice notes, video notes, and videos
  const recognitionHandler = createMusicRecognitionHandler(
    musicRecognizer,
    ytdlpRunner,
    router,
    jobRepo
  );
  bot.on(
    [
      'message:voice',
      'message:video_note',
      'message:audio',
      'message:video',
    ],
    recognitionHandler
  );

  // Admin document upload (e.g. cookies.txt) + audio/video document recognition fallback
  const adminInterceptor = createAdminBroadcastMiddleware(userRepo);
  bot.on('message:document', adminInterceptor, recognitionHandler);

  // Admin broadcast / channel / cookies setup interceptor (runs before URL & plain-text search handler)
  bot.on(
    'message:text',
    adminInterceptor,
    createUrlHandler(router, jobRepo, ytdlpRunner)
  );

  return bot;
}
