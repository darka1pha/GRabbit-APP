// The admin panel's overview page: users, jobs, cache, queue and runtime numbers.

import { UserRepository } from '../../database/repositories/user-repository.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { MediaCacheRepository } from '../../database/repositories/media-cache-repository.js';
import { getMediaQueue } from '../../queue/queues.js';
import { formatFileSize, formatDuration } from '../../i18n/locale-resolver.js';
import { escapeHtml, formatPlatformName } from '../formatting.js';
import { translate } from '../../i18n/index.js';
import { APP_NAME, SupportedLocale } from '../../config/constants.js';
import { getRequiredChannel } from '../middleware/force-join.js';
import { resolveYouTubeCookiesPath } from '../../platforms/youtube/youtube-adapter.js';
import { saveYouTubeCookiesFile } from './admin-cookies.js';

/** Short admin label for a failure reason key (falls back to the key itself). */
function failureReasonLabel(locale: SupportedLocale, reason: string): string {
  const key = `admin-reason-${reason}`;
  const label = translate(locale, key);
  return label === key ? reason : label;
}

export async function buildAdminOverviewHtml(
  userRepo: UserRepository,
  jobRepo: JobRepository,
  cacheRepo: MediaCacheRepository,
  locale: SupportedLocale = 'en'
): Promise<string> {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  const [userStats, jobStats, cacheStats, reqChannel, failureReasons] = await Promise.all([
    userRepo.getUserStats(),
    jobRepo.getGlobalStats(),
    cacheRepo.getCacheStats().catch(() => ({ totalItems: 0, totalBytes: 0 })),
    getRequiredChannel(userRepo),
    jobRepo.getFailureReasons?.(24).catch(() => []) ?? Promise.resolve([]),
  ]);

  // Restore cookies from DB setting if temp file was recreated
  if (!resolveYouTubeCookiesPath()) {
    const savedCookies = await userRepo.getSetting?.('youtube_cookies').catch(() => null);
    if (savedCookies) {
      try {
        saveYouTubeCookiesFile(savedCookies);
      } catch {}
    }
  }

  let queueLine = t('admin-queue-unavailable');
  if (process.env.NODE_ENV !== 'test') {
    try {
      const queue = getMediaQueue();
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      queueLine = t('admin-queue-line', {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
      });
    } catch {}
  }

  const platformsLine =
    jobStats.topPlatforms.length > 0
      ? jobStats.topPlatforms
          .map((p) => `${escapeHtml(formatPlatformName(p.platform))} (${p.count})`)
          .join(', ')
      : t('admin-none-yet');

  const failureLines =
    failureReasons.length > 0
      ? failureReasons.map((f) =>
          t('admin-failure-line', {
            reason: escapeHtml(failureReasonLabel(locale, f.reason)),
            count: f.count,
          })
        )
      : [t('admin-failures-none')];

  const memMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
  const uptimeStr = formatDuration(Math.floor(process.uptime()));
  const hasYtCookies = Boolean(resolveYouTubeCookiesPath());

  return [
    t('admin-title', { appName: APP_NAME }),
    '',
    t('admin-section-users'),
    t('admin-users-total', { count: userStats.totalUsers }),
    t('admin-users-active', { count: userStats.activeLast24h }),
    t('admin-users-vip-banned', {
      vip: userStats.vipUsers ?? 0,
      banned: userStats.bannedUsers ?? 0,
    }),
    t('admin-channel-line', { channel: reqChannel ? escapeHtml(reqChannel) : t('admin-off') }),
    t('admin-cookies-line', {
      status: t(hasYtCookies ? 'admin-cookies-active' : 'admin-cookies-missing'),
    }),
    '',
    t('admin-section-downloads'),
    t('admin-jobs-total', { count: jobStats.totalJobs }),
    t('admin-jobs-breakdown', {
      completed: jobStats.completedJobs,
      failed: jobStats.failedJobs,
      active: jobStats.activeJobs,
    }),
    t('admin-bandwidth', { size: escapeHtml(formatFileSize(jobStats.totalBytesDelivered)) }),
    t('admin-top-platforms', { platforms: platformsLine }),
    '',
    t('admin-section-failures'),
    ...failureLines,
    '',
    t('admin-section-cache'),
    t('admin-cache-line', {
      count: cacheStats.totalItems,
      size: escapeHtml(formatFileSize(cacheStats.totalBytes)),
    }),
    queueLine,
    '',
    t('admin-section-runtime'),
    t('admin-runtime-line', { uptime: uptimeStr, memory: memMb }),
  ].join('\n');
}
