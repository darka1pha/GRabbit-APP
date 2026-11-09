import { InlineKeyboard } from 'grammy';
import { BotContext } from '../context.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { escapeHtml, formatPlatformName, truncateLabel } from '../formatting.js';
import { formatFileSize } from '../../i18n/index.js';

export async function buildHistoryView(
  ctx: BotContext,
  jobRepo: JobRepository,
  includeBackBtn = false
): Promise<{ text: string; keyboard?: InlineKeyboard; isEmpty: boolean }> {
  const userId = ctx.from?.id;
  if (!userId) {
    return { text: escapeHtml(ctx.t('history-empty')), isEmpty: true };
  }

  const recentJobs = await jobRepo.getRecentJobs(userId, 10);
  const completed = recentJobs.filter((j) => j.status === 'completed').slice(0, 10);

  if (completed.length === 0) {
    const kb = includeBackBtn
      ? new InlineKeyboard().text(ctx.t('menu-btn-home'), 'menu:home')
      : undefined;
    return { text: escapeHtml(ctx.t('history-empty')), keyboard: kb, isEmpty: true };
  }

  const lines: string[] = [`<b>${escapeHtml(ctx.t('history-title'))}</b>`, ''];
  const keyboard = new InlineKeyboard();

  completed.forEach((job, idx) => {
    const indexNum = idx + 1;
    const icon = job.format === 'audio' ? '🎵' : '🎬';
    const meta = [formatPlatformName(job.platform)];
    if (job.fileSizeBytes && job.fileSizeBytes > 0) {
      meta.push(formatFileSize(job.fileSizeBytes));
    }
    lines.push(
      `${indexNum}. ${icon} <b>${escapeHtml(job.title)}</b>\n   ${escapeHtml(meta.join(' · '))}`
    );

    const btnText = ctx.t('history-btn-resend', {
      index: indexNum,
      title: truncateLabel(job.title, 26),
    });
    keyboard.text(btnText, `hist:resend:${job.id}`).primary().row();
  });

  lines.push('', escapeHtml(ctx.t('history-hint')));

  if (includeBackBtn) {
    keyboard.text(ctx.t('menu-btn-home'), 'menu:home');
  }

  return { text: lines.join('\n'), keyboard, isEmpty: false };
}

export function createHistoryCommandHandler(jobRepo: JobRepository) {
  return async (ctx: BotContext): Promise<void> => {
    if (!ctx.from) return;

    const { text, keyboard } = await buildHistoryView(ctx, jobRepo, false);
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  };
}
