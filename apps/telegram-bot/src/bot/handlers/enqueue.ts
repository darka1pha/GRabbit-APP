import { randomBytes } from 'node:crypto';
import { BotContext } from '../context.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { getMediaQueue } from '../../queue/queues.js';
import { getConfig } from '../../config/env.js';
import { isAdminUser } from '../commands/admin.js';
import { ConcurrentJobLimitError } from '../../core/errors/domain-errors.js';
import { MediaFormat, PlatformId } from '../../config/constants.js';
import { JobRecord } from '../../core/types/job.js';

/** How many downloads this user may run at once, and how many are running now. */
export async function getJobSlots(
  ctx: BotContext,
  jobRepo: JobRepository
): Promise<{ activeCount: number; maxConcurrent: number; isVip: boolean }> {
  const userId = ctx.from!.id;
  const config = getConfig();
  const activeJobs = await jobRepo.getActiveUserJobs(userId);
  const isVip = ctx.userRecord?.tier === 'vip' || isAdminUser(userId);
  const maxConcurrent = isVip
    ? config.VIP_MAX_CONCURRENT_JOBS_PER_USER
    : config.MAX_CONCURRENT_JOBS_PER_USER;
  return { activeCount: activeJobs.length, maxConcurrent, isVip };
}

/**
 * Throws ConcurrentJobLimitError if the user can't start another download.
 * Returns the current active job count (for the queue position) and the user's tier.
 */
export async function assertCanStartJob(
  ctx: BotContext,
  jobRepo: JobRepository
): Promise<{ activeCount: number; isVip: boolean }> {
  const { activeCount, maxConcurrent, isVip } = await getJobSlots(ctx, jobRepo);
  if (activeCount >= maxConcurrent) {
    throw new ConcurrentJobLimitError(maxConcurrent);
  }
  return { activeCount, isVip };
}

export function newJobId(): string {
  return `job_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

/** Creates the DB job record and adds it to the media queue. Limits must be checked first. */
export async function enqueueDownload(
  ctx: BotContext,
  jobRepo: JobRepository,
  job: {
    id?: string;
    platform: PlatformId;
    url: string;
    mediaId: string;
    title: string;
    format: MediaFormat;
    qualityId: string;
    statusMessageId?: number;
    isVip: boolean;
  }
): Promise<JobRecord> {
  const jobRecord = await jobRepo.createJob({
    id: job.id || newJobId(),
    userId: ctx.from!.id,
    chatId: ctx.chat!.id,
    statusMessageId: job.statusMessageId,
    platform: job.platform,
    sourceUrl: job.url,
    mediaId: job.mediaId,
    title: job.title,
    format: job.format,
    qualityId: job.qualityId,
    localeSnapshot: ctx.locale,
    status: 'queued',
    progressPercent: 0,
  });

  const queue = getMediaQueue();
  await queue.add(
    'process-media',
    {
      jobId: jobRecord.id,
      userId: ctx.from!.id,
      chatId: ctx.chat!.id,
      statusMessageId: job.statusMessageId,
      platform: jobRecord.platform,
      url: jobRecord.sourceUrl,
      mediaId: jobRecord.mediaId,
      title: jobRecord.title,
      format: jobRecord.format,
      qualityId: jobRecord.qualityId,
      locale: jobRecord.localeSnapshot,
      userTier: job.isVip ? 'vip' : 'free',
    },
    { jobId: jobRecord.id }
  );

  return jobRecord;
}
