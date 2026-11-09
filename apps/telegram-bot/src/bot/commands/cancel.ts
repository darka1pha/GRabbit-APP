import { BotContext } from '../context.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { JobNotFoundError } from '../../core/errors/domain-errors.js';
import { getMediaQueue } from '../../queue/queues.js';
import { MediaProcessingWorker } from '../../queue/workers/media-worker.js';
import { buildStatusView } from './status.js';
import { JobRecord } from '../../core/types/job.js';

/** Marks a job cancelled, aborts it in the worker and removes it from the queue. */
export async function cancelUserJob(
  jobRepo: JobRepository,
  userId: number,
  jobId: string
): Promise<JobRecord> {
  const job = await jobRepo.getJob(jobId);
  if (
    !job ||
    job.userId !== userId ||
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'cancelled'
  ) {
    throw new JobNotFoundError(jobId);
  }

  await jobRepo.updateJobStatus(jobId, 'cancelled');
  MediaProcessingWorker.abortJob(jobId);

  // Try removing from BullMQ queue if pending/waiting
  try {
    const queue = getMediaQueue();
    const bullJob = await queue.getJob(jobId);
    if (bullJob) {
      await bullJob.remove();
    }
  } catch {}

  return job;
}

export function createCancelCommandHandler(jobRepo: JobRepository) {
  return async (ctx: BotContext): Promise<void> => {
    if (!ctx.from) return;

    const parts = ctx.message?.text?.split(' ') || [];
    const targetJobId = parts[1]?.trim();

    let notice: string | undefined;
    if (targetJobId) {
      const job = await cancelUserJob(jobRepo, ctx.from.id, targetJobId);
      notice = ctx.t('job-cancelled-success', { title: job.title });
    }

    const { text, keyboard } = await buildStatusView(ctx, jobRepo, notice);
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  };
}
