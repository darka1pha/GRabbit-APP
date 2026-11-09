import { InlineKeyboard, NextFunction } from 'grammy';
import { BotContext } from '../context.js';
import { UserRepository } from '../../database/repositories/user-repository.js';
import { getConfig } from '../../config/env.js';
import { isAdminUser } from '../commands/admin.js';
import { escapeHtml } from '../formatting.js';
import { createHomeButtonKeyboard } from '../keyboards/index.js';
import { translate } from '../../i18n/index.js';
import { SupportedLocale } from '../../config/constants.js';

let cachedChannel: { value: string | null; expiresAt: number } | null = null;

export function invalidateForceJoinCache(): void {
  cachedChannel = null;
}

export async function getRequiredChannel(userRepo: UserRepository): Promise<string | null> {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  const now = Date.now();
  if (cachedChannel && now < cachedChannel.expiresAt) {
    return cachedChannel.value;
  }

  const dbChannel = await userRepo.getSetting?.('required_channel').catch(() => null);
  const envChannel = getConfig().REQUIRED_CHANNEL?.trim() || null;

  let resolved = dbChannel !== undefined && dbChannel !== null ? dbChannel : envChannel;
  if (resolved === 'OFF' || resolved === '') {
    resolved = null;
  }

  cachedChannel = {
    value: resolved,
    expiresAt: now + 60_000,
  };

  return resolved;
}

export async function checkChannelMembership(
  ctx: BotContext,
  channel: string,
  userId: number
): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(channel, userId);
    return (
      member.status === 'member' ||
      member.status === 'administrator' ||
      member.status === 'creator'
    );
  } catch {
    // If bot is not admin in the target channel or channel is unreachable, fail open so bot doesn't lock out users
    return true;
  }
}

export function createForceJoinKeyboard(locale: SupportedLocale, channel: string): InlineKeyboard {
  const cleanHandle = channel.replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
  const joinUrl = `https://t.me/${cleanHandle}`;

  return new InlineKeyboard()
    .url(translate(locale, 'forcejoin-btn-join'), joinUrl)
    .row()
    .text(translate(locale, 'forcejoin-btn-verify'), 'verify:join');
}

export function buildForceJoinMessage(locale: SupportedLocale, channel: string): string {
  const displayChannel = channel.startsWith('@') ? channel : `@${channel.replace(/^https?:\/\/t\.me\//i, '')}`;
  return (
    `<b>${escapeHtml(translate(locale, 'forcejoin-title'))}</b>\n\n` +
    escapeHtml(translate(locale, 'forcejoin-body', { channel: displayChannel }))
  );
}

export function createForceJoinMiddleware(userRepo: UserRepository) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    if (!ctx.from || ctx.inlineQuery || isAdminUser(ctx.from.id)) {
      return next();
    }

    // Always allow basic onboarding and language selection commands/callbacks
    const text = ctx.message?.text || '';
    if (
      text.startsWith('/start') ||
      text.startsWith('/help') ||
      text.startsWith('/language')
    ) {
      return next();
    }

    const cbData = ctx.callbackQuery?.data || '';
    if (cbData.startsWith('lang:') || cbData === 'nav:language') {
      return next();
    }

    const requiredChannel = await getRequiredChannel(userRepo);
    if (!requiredChannel) {
      return next();
    }

    const isMember = await checkChannelMembership(ctx, requiredChannel, ctx.from.id);

    if (cbData === 'verify:join') {
      if (isMember) {
        await ctx
          .answerCallbackQuery({ text: ctx.t('forcejoin-verified-toast') })
          .catch(() => {});
        await ctx
          .editMessageText(escapeHtml(ctx.t('forcejoin-verified')), {
            parse_mode: 'HTML',
            reply_markup: createHomeButtonKeyboard(ctx.locale),
          })
          .catch(() => {});
      } else {
        await ctx
          .answerCallbackQuery({
            text: ctx.t('forcejoin-not-joined'),
            show_alert: true,
          })
          .catch(() => {});
      }
      return;
    }

    if (!isMember) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery().catch(() => {});
      }
      await ctx.reply(buildForceJoinMessage(ctx.locale, requiredChannel), {
        parse_mode: 'HTML',
        reply_markup: createForceJoinKeyboard(ctx.locale, requiredChannel),
      });
      return;
    }

    return next();
  };
}
