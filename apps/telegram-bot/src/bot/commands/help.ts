import { BotContext } from '../context.js';
import { APP_NAME, BOT_USERNAME } from '../../config/constants.js';
import { escapeHtml } from '../formatting.js';

export function buildHelpText(ctx: BotContext): string {
  const title = ctx.t('help-title', { appName: APP_NAME });
  const desc = ctx.t('help-description', { botUsername: ctx.me?.username || BOT_USERNAME });
  return `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(desc)}`;
}

export async function handleHelpCommand(ctx: BotContext): Promise<void> {
  await ctx.reply(buildHelpText(ctx), { parse_mode: 'HTML' });
}
