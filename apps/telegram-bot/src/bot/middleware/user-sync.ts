import { NextFunction } from 'grammy';
import { BotContext } from '../context.js';
import { UserRepository } from '../../database/repositories/user-repository.js';
import { resolveUserLocale } from '../../i18n/locale-resolver.js';
import { translate } from '../../i18n/index.js';
import { getConfig } from '../../config/env.js';
import { DEFAULT_LOCALE } from '../../config/constants.js';
import { isAdminUser } from '../commands/admin.js';

export function createUserSyncMiddleware(userRepo: UserRepository) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    if (!ctx.from) {
      ctx.locale = DEFAULT_LOCALE;
      ctx.t = (key, params) => translate(ctx.locale, key, params);
      return next();
    }

    const config = getConfig();

    let user = await userRepo.getUser(ctx.from.id);

    if (!user) {
      const initialLocale = resolveUserLocale({
        telegramLanguageCode: ctx.from.language_code,
        configuredDefault: config.DEFAULT_LANGUAGE,
      });

      user = await userRepo.upsertUser({
        id: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        languageCode: initialLocale,
      });
    }

    ctx.userRecord = user;
    ctx.locale = user.languageCode;
    ctx.t = (key, params) => translate(ctx.locale, key, params);

    // Block banned users (admins are exempt)
    if (user.isBanned && !isAdminUser(user.id)) {
      const bannedMsg =
        ctx.locale === 'fa'
          ? '🚫 حساب کاربری شما توسط مدیریت مسدود شده است.'
          : '🚫 Your account has been suspended by an administrator.';

      if (ctx.callbackQuery) {
        await ctx
          .answerCallbackQuery({ text: bannedMsg, show_alert: true })
          .catch(() => {});
      } else if (ctx.chat) {
        await ctx.reply(bannedMsg).catch(() => {});
      }
      return;
    }

    return next();
  };
}
