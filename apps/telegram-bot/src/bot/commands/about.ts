import { BotContext } from '../context.js';
import { APP_NAME } from '../../config/constants.js';
import { escapeHtml } from '../formatting.js';

export async function handleAboutCommand(ctx: BotContext): Promise<void> {
  const title = ctx.t('about-title', { appName: APP_NAME });
  const desc = ctx.t('about-description', { appName: APP_NAME });

  await ctx.reply(`<b>${escapeHtml(title)}</b>\n\n${escapeHtml(desc)}`, { parse_mode: 'HTML' });
}
