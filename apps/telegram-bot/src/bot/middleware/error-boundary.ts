import { BotError } from 'grammy';
import { BotContext } from '../context.js';
import { AppError } from '../../core/errors/domain-errors.js';
import { logger } from '../../observability/logger.js';
import { escapeHtml, adminHintKeyForError } from '../formatting.js';
import { isAdminUser } from '../commands/admin.js';

export async function errorBoundaryMiddleware(err: BotError<BotContext>): Promise<void> {
  const ctx = err.ctx;
  const originalError = err.error;

  logger.error(
    {
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
      updateId: ctx.update.update_id,
      error: originalError instanceof Error ? originalError.message : originalError,
      stack: originalError instanceof Error ? originalError.stack : undefined,
    },
    'Error caught in grammY error boundary'
  );

  if (!ctx.chat) return;

  if (originalError instanceof AppError && originalError.i18nKey) {
    let text = ctx.t(originalError.i18nKey, originalError.i18nParams);
    const hintKey = isAdminUser(ctx.from?.id)
      ? adminHintKeyForError(originalError.i18nKey)
      : undefined;
    if (hintKey) {
      text += `\n\n${ctx.t(hintKey)}`;
    }
    try {
      await ctx.reply(escapeHtml(text), { parse_mode: 'HTML' });
    } catch (replyErr) {
      logger.error({ replyErr }, 'Failed to send domain error reply');
    }
    return;
  }

  // Generic fallback message
  const fallback = ctx.t('error-generic');
  try {
    await ctx.reply(escapeHtml(fallback), { parse_mode: 'HTML' });
  } catch (replyErr) {
    logger.error({ replyErr }, 'Failed to send generic error reply');
  }
}
