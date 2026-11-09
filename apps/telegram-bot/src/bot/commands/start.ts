import { InlineKeyboard } from 'grammy';
import { BotContext } from '../context.js';
import {
  createLanguageKeyboard,
  createMainMenuKeyboard,
  createSearchPromptKeyboard,
} from '../keyboards/index.js';
import { APP_NAME, APP_SLOGAN, BOT_USERNAME, SupportedLocale } from '../../config/constants.js';
import { translate } from '../../i18n/index.js';
import { isAdminUser } from './admin.js';
import { processMediaUrl } from '../handlers/url-handler.js';
import { escapeHtml } from '../formatting.js';

function buildWelcomeText(loc: SupportedLocale, botUsername = BOT_USERNAME): string {
  const title = translate(loc, 'welcome-title', { appName: APP_NAME });
  const desc = translate(loc, 'welcome-description', {
    slogan: APP_SLOGAN,
    botUsername,
  });
  return `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(desc)}`;
}

export function buildHomeMenuView(
  ctx: BotContext,
  overrideLocale?: SupportedLocale
): { text: string; keyboard: InlineKeyboard } {
  const loc = overrideLocale || ctx.locale;
  const isAdmin = isAdminUser(ctx.from?.id);

  return {
    text: buildWelcomeText(loc, ctx.me?.username || BOT_USERNAME),
    keyboard: createMainMenuKeyboard(loc, isAdmin),
  };
}

export function buildSearchPromptView(ctx: BotContext): { text: string; keyboard: InlineKeyboard } {
  const title = ctx.t('search-prompt-title');
  const body = ctx.t('search-prompt-body');
  return {
    text: `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`,
    keyboard: createSearchPromptKeyboard(ctx.locale),
  };
}

export async function handleStartCommand(ctx: BotContext): Promise<void> {
  // Handle deep-linked payloads (e.g. /start yt_<videoId> from Inline Mode or /start search)
  const payload =
    typeof ctx.match === 'string'
      ? ctx.match.trim()
      : (ctx.message?.text || '').replace(/^\/start(@\S+)?\s*/i, '').trim();

  if (payload.startsWith('yt_') && payload.length > 3) {
    const videoId = payload.slice(3).replace(/[^a-zA-Z0-9_-]/g, '');
    if (videoId) {
      await processMediaUrl(ctx, `https://www.youtube.com/watch?v=${videoId}`);
      return;
    }
  }

  if (payload === 'search') {
    const { text, keyboard } = buildSearchPromptView(ctx);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    return;
  }

  const hasSelectedLanguage = Boolean(ctx.userRecord?.languageSelected);

  if (!hasSelectedLanguage) {
    // First-time onboarding: ask for preferred language once
    const langPrompt = escapeHtml(ctx.t('language-select-title'));

    await ctx.reply(`${buildWelcomeText(ctx.locale, ctx.me?.username || BOT_USERNAME)}\n\n${langPrompt}`, {
      parse_mode: 'HTML',
      reply_markup: createLanguageKeyboard(false),
    });
    return;
  }

  // Returning user: show welcome card and main menu buttons directly
  const { text, keyboard } = buildHomeMenuView(ctx);
  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}
