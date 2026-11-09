import { BotContext } from '../context.js';
import { UserRepository } from '../../database/repositories/user-repository.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { MediaCacheRepository } from '../../database/repositories/media-cache-repository.js';
import { buildAdminOverviewHtml, isAdminUser } from './admin.js';

/** /stats: the admin panel overview as a plain message (no buttons). */
export function createStatsCommandHandler(
  userRepo: UserRepository,
  jobRepo: JobRepository,
  cacheRepo = new MediaCacheRepository()
) {
  return async (ctx: BotContext): Promise<void> => {
    if (!ctx.from) return;

    if (!isAdminUser(ctx.from.id)) {
      await ctx.reply(ctx.t('error-admin-only'));
      return;
    }

    const html = await buildAdminOverviewHtml(userRepo, jobRepo, cacheRepo, ctx.locale);
    await ctx.reply(html, { parse_mode: 'HTML' });
  };
}
