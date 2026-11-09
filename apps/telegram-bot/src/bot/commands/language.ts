import { BotContext } from '../context.js';
import { createLanguageKeyboard } from '../keyboards/index.js';

export async function handleLanguageCommand(ctx: BotContext): Promise<void> {
  const prompt = ctx.t('language-select-title');
  await ctx.reply(prompt, {
    reply_markup: createLanguageKeyboard(),
  });
}
