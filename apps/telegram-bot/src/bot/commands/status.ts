import { InlineKeyboard } from 'grammy';
import { BotContext } from '../context.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { createCancelJobKeyboard } from '../keyboards/index.js';
import { escapeHtml, renderProgressBar } from '../formatting.js';

export function jobStatusLabel(ctx: BotContext, status: string): string {
  switch (status) {
    case 'processing':
      return ctx.t('status-processing');
    case 'uploading':
      return ctx.t('status-uploading');
    default:
      return ctx.t('status-queued');
  }
}

/**
 * Shared "active downloads" screen used by /status, /cancel, the main-menu button
 * and after cancelling from the list. `notice` is shown above the list (e.g. "Cancelled: X").
 */
export async function buildStatusView(
  ctx: BotContext,
  jobRepo: JobRepository,
  notice?: string
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const activeJobs = ctx.from ? await jobRepo.getActiveUserJobs(ctx.from.id) : [];
  const noticeBlock = notice ? `${escapeHtml(notice)}\n\n` : '';

  if (activeJobs.length === 0) {
    return {
      text: `${noticeBlock}${escapeHtml(ctx.t('no-active-jobs'))}`,
      keyboard: createCancelJobKeyboard(ctx.locale, []),
    };
  }

  const lines = activeJobs.map((j, idx) => {
    const pct = Math.round(j.progressPercent ?? 0);
    const label = escapeHtml(jobStatusLabel(ctx, j.status));
    return `${idx + 1}. <b>${escapeHtml(j.title)}</b>\n   ${label} · <code>${renderProgressBar(pct)} ${pct}%</code>`;
  });

  const text =
    `${noticeBlock}<b>${escapeHtml(ctx.t('status-active-jobs'))}</b>\n\n` +
    `${lines.join('\n\n')}\n\n` +
    escapeHtml(ctx.t('cancel-job-prompt'));

  return {
    text,
    keyboard: createCancelJobKeyboard(
      ctx.locale,
      activeJobs.map((j) => ({ id: j.id, title: j.title }))
    ),
  };
}

export function createStatusCommandHandler(jobRepo: JobRepository) {
  return async (ctx: BotContext): Promise<void> => {
    if (!ctx.from) return;

    const { text, keyboard } = await buildStatusView(ctx, jobRepo);
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  };
}
