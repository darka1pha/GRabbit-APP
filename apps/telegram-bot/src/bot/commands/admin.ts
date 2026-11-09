import { InlineKeyboard, NextFunction } from 'grammy';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BotContext } from '../context.js';
import { UserRepository } from '../../database/repositories/user-repository.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { MediaCacheRepository } from '../../database/repositories/media-cache-repository.js';
import { getConfig } from '../../config/env.js';
import { getMediaQueue } from '../../queue/queues.js';
import { MediaProcessingWorker } from '../../queue/workers/media-worker.js';
import { TempStorageManager } from '../../services/temp-storage/temp-storage-manager.js';
import { formatFileSize, formatDuration } from '../../i18n/locale-resolver.js';
import { escapeHtml, formatPlatformName, truncateLabel } from '../formatting.js';
import { translate } from '../../i18n/index.js';
import { APP_NAME, SupportedLocale } from '../../config/constants.js';
import { jobStatusLabel } from './status.js';
import { UserTier } from '../../core/types/user.js';
import { getRequiredChannel, invalidateForceJoinCache } from '../middleware/force-join.js';
import { resolveYouTubeCookiesPath } from '../../platforms/youtube/youtube-adapter.js';
import { logger } from '../../observability/logger.js';

const pendingBroadcastAdmins = new Set<number>();
const pendingChannelSetupAdmins = new Set<number>();
const pendingCookiesSetupAdmins = new Set<number>();

const YOUTUBE_AUTH_COOKIE_NAMES = new Set([
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  'LOGIN_INFO',
]);

export interface CookieSaveDiagnostics {
  savedPath: string;
  normalizedContent: string;
  totalCookies: number;
  youtubeCookies: number;
  hasAuthCookies: boolean;
  foundAuthCookies: string[];
}

interface ParsedCookieEntry {
  domain: string;
  includeSubdomains: 'TRUE' | 'FALSE';
  path: string;
  secure: 'TRUE' | 'FALSE';
  expires: number;
  name: string;
  value: string;
}

function getManagedCookiesFilePath(): string {
  return resolve(process.cwd(), getConfig().TEMP_DIR, 'youtube_cookies.txt');
}

function getRuntimeCookiesFilePath(): string {
  return resolve(process.cwd(), getConfig().TEMP_DIR, 'youtube_cookies_runtime.txt');
}

function parseCookiesFromText(rawContent: string): ParsedCookieEntry[] {
  const cleaned = rawContent.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const entries: ParsedCookieEntry[] = [];

  // 1. Support JSON cookie exports (e.g. Cookie-Editor / EditThisCookie / header dump)
  if (cleaned.startsWith('[') || (cleaned.startsWith('{') && cleaned.includes('"'))) {
    try {
      let parsedJson = JSON.parse(cleaned);
      if (parsedJson && !Array.isArray(parsedJson)) {
        if (Array.isArray(parsedJson.cookies)) {
          parsedJson = parsedJson.cookies;
        } else if (Array.isArray(parsedJson.data)) {
          parsedJson = parsedJson.data;
        }
      }
      if (Array.isArray(parsedJson)) {
        for (const item of parsedJson) {
          if (!item || typeof item !== 'object') continue;
          let domain = String(item.domain || '').trim();
          const name = String(item.name || '').trim();
          if (!domain || !name) continue;
          if (!item.hostOnly && !domain.startsWith('.')) {
            domain = `.${domain}`;
          }
          const includeSubdomains: 'TRUE' | 'FALSE' = domain.startsWith('.') ? 'TRUE' : 'FALSE';
          const path = String(item.path || '/').trim() || '/';
          const secure: 'TRUE' | 'FALSE' = item.secure ? 'TRUE' : 'FALSE';
          const expRaw = Number(item.expirationDate ?? item.expires ?? 0);
          const expires =
            Number.isFinite(expRaw) && expRaw > 0
              ? Math.floor(expRaw)
              : Math.floor(Date.now() / 1000) + 31536000;
          const value = String(item.value ?? '').replace(/[\r\n\t]/g, '');
          entries.push({ domain, includeSubdomains, path, secure, expires, name, value });
        }
        if (entries.length > 0) {
          return entries;
        }
      }
    } catch {
      // Fall through to line-by-line parsing
    }
  }

  // 2. Parse Netscape format (supporting both TABs and spaces, stripping #HttpOnly_, skipping truncated lines)
  const lines = cleaned.split('\n');
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    if (/^#HttpOnly_/i.test(line)) {
      line = line.replace(/^#HttpOnly_/i, '');
    } else if (line.startsWith('#')) {
      continue;
    }

    let parts = line.split('\t');
    if (parts.length === 6) {
      parts.push('');
    } else if (parts.length < 7) {
      // Telegram or text editors may convert TAB characters into spaces when copying/pasting
      const spaceMatch = line.match(
        /^(\S+)\s+(TRUE|FALSE)\s+(\S+)\s+(TRUE|FALSE)\s+(-?\d+(?:\.\d+)?)\s+(\S+)(?:\s+(.*))?$/i
      );
      if (spaceMatch) {
        parts = [
          spaceMatch[1],
          spaceMatch[2].toUpperCase(),
          spaceMatch[3],
          spaceMatch[4].toUpperCase(),
          spaceMatch[5],
          spaceMatch[6],
          spaceMatch[7] || '',
        ];
      }
    }

    if (parts.length < 7) {
      // Skip malformed or truncated lines (e.g. at Telegram's 4096-character split boundary)
      continue;
    }

    let domain = parts[0].trim();
    const flagRaw = parts[1].trim().toUpperCase();
    const path = parts[2].trim() || '/';
    const secureRaw = parts[3].trim().toUpperCase();
    const expiresNum = parseInt(parts[4].trim(), 10);
    const name = parts[5].trim();
    const value = parts.slice(6).join('\t').trim();

    if (!domain || !name || !path.startsWith('/')) continue;
    if (flagRaw !== 'TRUE' && flagRaw !== 'FALSE') continue;
    if (secureRaw !== 'TRUE' && secureRaw !== 'FALSE') continue;
    if (isNaN(expiresNum)) continue;
    if (!/^\.?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) continue;

    // Python's http.cookiejar.MozillaCookieJar strictly requires initial_dot == (includeSubdomains == 'TRUE')
    if (flagRaw === 'TRUE' && !domain.startsWith('.')) {
      domain = `.${domain}`;
    }
    const includeSubdomains: 'TRUE' | 'FALSE' = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure: 'TRUE' | 'FALSE' = secureRaw === 'TRUE' ? 'TRUE' : 'FALSE';
    const expires = expiresNum < 0 ? 0 : expiresNum;

    entries.push({
      domain,
      includeSubdomains,
      path,
      secure,
      expires,
      name,
      value,
    });
  }

  return entries;
}

export function looksLikeCookiesInput(text: string): boolean {
  if (!text) return false;
  if (
    text.includes('# Netscape HTTP Cookie File') ||
    text.includes('# HTTP Cookie File') ||
    text.includes('curl.haxx.se/rfc/cookie_spec') ||
    /#HttpOnly_/i.test(text)
  ) {
    return true;
  }
  return parseCookiesFromText(text).length >= 1;
}

export function saveYouTubeCookiesWithDiagnostics(
  content: string,
  options?: { mergeExisting?: boolean }
): CookieSaveDiagnostics {
  const target = getManagedCookiesFilePath();
  const dir = dirname(target);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const cookieMap = new Map<string, ParsedCookieEntry>();

  if (options?.mergeExisting && existsSync(target)) {
    try {
      const existingContent = readFileSync(target, 'utf-8');
      for (const entry of parseCookiesFromText(existingContent)) {
        cookieMap.set(`${entry.domain}|${entry.path}|${entry.name}`, entry);
      }
    } catch {}
  }

  const incomingEntries = parseCookiesFromText(content);
  for (const entry of incomingEntries) {
    cookieMap.set(`${entry.domain}|${entry.path}|${entry.name}`, entry);
  }

  const allEntries = Array.from(cookieMap.values());
  if (allEntries.length === 0) {
    return {
      savedPath: target,
      normalizedContent: '',
      totalCookies: 0,
      youtubeCookies: 0,
      hasAuthCookies: false,
      foundAuthCookies: [],
    };
  }

  const lines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.haxx.se/rfc/cookie_spec.html',
    '# This is a generated file! Do not edit.',
    '',
    ...allEntries.map(
      (e) =>
        `${e.domain}\t${e.includeSubdomains}\t${e.path}\t${e.secure}\t${e.expires}\t${e.name}\t${e.value}`
    ),
    '',
  ];

  const normalizedContent = lines.join('\n');
  writeFileSync(target, normalizedContent, 'utf-8');
  try {
    writeFileSync(getRuntimeCookiesFilePath(), normalizedContent, 'utf-8');
  } catch {}

  let youtubeCookies = 0;
  const foundAuthSet = new Set<string>();

  for (const e of allEntries) {
    const dom = e.domain.toLowerCase();
    if (dom.includes('youtube.com') || dom.includes('google.com')) {
      youtubeCookies++;
      if (YOUTUBE_AUTH_COOKIE_NAMES.has(e.name) && e.value.length > 0) {
        foundAuthSet.add(e.name);
      }
    }
  }

  return {
    savedPath: target,
    normalizedContent,
    totalCookies: allEntries.length,
    youtubeCookies,
    hasAuthCookies: foundAuthSet.size > 0,
    foundAuthCookies: Array.from(foundAuthSet),
  };
}

export function saveYouTubeCookiesFile(content: string): string {
  return saveYouTubeCookiesWithDiagnostics(content, { mergeExisting: false }).savedPath;
}

export function isAdminUser(userId?: number): boolean {
  if (!userId) return false;
  const config = getConfig();
  if (config.ADMIN_USER_IDS.length === 0) {
    return config.NODE_ENV !== 'production';
  }
  return config.ADMIN_USER_IDS.includes(userId);
}

export function createAdminMainKeyboard(locale: SupportedLocale = 'en'): InlineKeyboard {
  const t = (key: string) => translate(locale, key);
  return new InlineKeyboard()
    .text(t('admin-btn-refresh'), 'admin:home')
    .primary()
    .text(t('admin-btn-users'), 'admin:users:0')
    .primary()
    .row()
    .text(t('admin-btn-jobs'), 'admin:jobs')
    .text(t('admin-btn-maintenance'), 'admin:maintenance')
    .row()
    .text(t('admin-btn-cookies'), 'admin:cookies')
    .success()
    .text(t('admin-btn-channel'), 'admin:channel')
    .row()
    .text(t('admin-btn-broadcast'), 'admin:broadcast')
    .row()
    .text(t('menu-btn-home'), 'menu:home');
}

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

export function createAdminCommandHandler(
  userRepo: UserRepository,
  jobRepo: JobRepository,
  cacheRepo = new MediaCacheRepository()
) {
  return async (ctx: BotContext): Promise<void> => {
    if (!ctx.from) return;

    if (!isAdminUser(ctx.from.id)) {
      await ctx.reply(ctx.t('admin-access-denied'));
      return;
    }

    pendingBroadcastAdmins.delete(ctx.from.id);
    pendingChannelSetupAdmins.delete(ctx.from.id);
    pendingCookiesSetupAdmins.delete(ctx.from.id);

    const html = await buildAdminOverviewHtml(userRepo, jobRepo, cacheRepo, ctx.locale);
    await ctx.reply(html, {
      parse_mode: 'HTML',
      reply_markup: createAdminMainKeyboard(ctx.locale),
    });
  };
}

export function createUserModerationCommandHandler(
  userRepo: UserRepository,
  action: 'ban' | 'unban' | 'vip' | 'unvip'
) {
  return async (ctx: BotContext): Promise<void> => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) return;

    const rawText = ctx.message?.text || '';
    const arg = rawText.split(/\s+/)[1]?.trim();
    const targetId = Number(arg);

    if (!arg || isNaN(targetId)) {
      await ctx.reply(ctx.t('admin-usage', { action }), { parse_mode: 'HTML' });
      return;
    }

    // IDs are passed as strings so they aren't digit-grouped or localized
    const userId = String(targetId);
    const user = await userRepo.getUser(targetId);
    if (!user) {
      await ctx.reply(ctx.t('admin-user-not-found', { userId }), { parse_mode: 'HTML' });
      return;
    }

    if (action === 'ban') {
      await userRepo.setUserBanned(targetId, true);
      await ctx.reply(ctx.t('admin-user-banned', { userId }), { parse_mode: 'HTML' });
    } else if (action === 'unban') {
      await userRepo.setUserBanned(targetId, false);
      await ctx.reply(ctx.t('admin-user-unbanned', { userId }), { parse_mode: 'HTML' });
    } else if (action === 'vip') {
      await userRepo.setUserTier(targetId, 'vip');
      await ctx.reply(ctx.t('admin-user-vip', { userId }), { parse_mode: 'HTML' });
    } else if (action === 'unvip') {
      await userRepo.setUserTier(targetId, 'free');
      await ctx.reply(ctx.t('admin-user-free', { userId }), { parse_mode: 'HTML' });
    }
  };
}

export async function handleAdminCallback(
  ctx: BotContext,
  userRepo: UserRepository,
  jobRepo: JobRepository,
  cacheRepo = new MediaCacheRepository()
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith('admin:') || !ctx.from) {
    return false;
  }

  if (!isAdminUser(ctx.from.id)) {
    await ctx
      .answerCallbackQuery({
        text: ctx.t('admin-access-required'),
        show_alert: true,
      })
      .catch(() => {});
    return true;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  // 1. Home Overview
  if (data === 'admin:home') {
    pendingBroadcastAdmins.delete(ctx.from.id);
    pendingChannelSetupAdmins.delete(ctx.from.id);
    pendingCookiesSetupAdmins.delete(ctx.from.id);
    const html = await buildAdminOverviewHtml(userRepo, jobRepo, cacheRepo, ctx.locale);
    await ctx
      .editMessageText(html, {
        parse_mode: 'HTML',
        reply_markup: createAdminMainKeyboard(ctx.locale),
      })
      .catch(() => {});
    return true;
  }

  // 2. User Tier / Ban updates: admin:utier:<uid>:<tier>:<page> or admin:uban:<uid>:<0|1>:<page>
  if (data.startsWith('admin:utier:') || data.startsWith('admin:uban:')) {
    const parts = data.split(':');
    const actionType = parts[1];
    const targetUserId = Number(parts[2]);
    const val = parts[3];
    const returnPage = Number(parts[4] || 0);

    if (actionType === 'utier') {
      const newTier: UserTier = val === 'vip' ? 'vip' : 'free';
      await userRepo.setUserTier(targetUserId, newTier);
    } else if (actionType === 'uban') {
      const banState = val === '1';
      await userRepo.setUserBanned(targetUserId, banState);
    }

    // Fall through to render single user detail view
    return renderAdminUserDetail(ctx, userRepo, targetUserId, returnPage);
  }

  // 2b. Single User Detail View: admin:user:<uid>:<page>
  if (data.startsWith('admin:user:')) {
    const parts = data.split(':');
    const targetUserId = Number(parts[2]);
    const returnPage = Number(parts[3] || 0);
    return renderAdminUserDetail(ctx, userRepo, targetUserId, returnPage);
  }

  // 2c. Users List: admin:users:<page>
  if (data.startsWith('admin:users:')) {
    const page = Math.max(0, parseInt(data.split(':')[2] || '0', 10) || 0);
    const pageSize = 6;
    const { users, total } = await userRepo.listUsers(pageSize, page * pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    let text =
      `${ctx.t('admin-users-title', { total, page: page + 1, pages: totalPages })}\n` +
      `${ctx.t('admin-users-hint')}\n\n`;

    const kb = new InlineKeyboard();

    if (users.length === 0) {
      text += ctx.t('admin-users-empty');
    } else {
      for (const u of users) {
        const name = escapeHtml([u.firstName, u.lastName].filter(Boolean).join(' ') || 'User');
        const uname = u.username ? ` (@${escapeHtml(u.username)})` : '';
        const badge = ctx.t(
          u.isBanned ? 'admin-badge-banned' : u.tier === 'vip' ? 'admin-badge-vip' : 'admin-badge-free'
        );
        const meta = ctx.t('admin-user-row-meta', {
          userId: String(u.id),
          lang: u.languageCode.toUpperCase(),
          jobs: u.jobCount,
        });
        text += `• <b>${name}</b>${uname} [${badge}]\n  ${meta}\n`;

        const btnIcon = u.isBanned ? '🚫' : u.tier === 'vip' ? '⭐' : '👤';
        const shortName = ([u.firstName, u.lastName].filter(Boolean).join(' ') || `${u.id}`).substring(0, 16);
        kb.text(`${btnIcon} ${shortName} (${u.id})`, `admin:user:${u.id}:${page}`).row();
      }
    }

    if (page > 0) {
      kb.text(ctx.t('admin-btn-prev'), `admin:users:${page - 1}`);
    }
    if ((page + 1) * pageSize < total) {
      kb.text(ctx.t('admin-btn-next'), `admin:users:${page + 1}`);
    }
    if (page > 0 || (page + 1) * pageSize < total) {
      kb.row();
    }
    kb.text(ctx.t('admin-btn-refresh'), `admin:users:${page}`).text(
      ctx.t('admin-btn-back-panel'),
      'admin:home'
    );

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: kb,
      })
      .catch(() => {});
    return true;
  }

  // 3. Force kill a job from Admin Panel: admin:killjob:<jobId>
  if (data.startsWith('admin:killjob:')) {
    const jobId = data.replace('admin:killjob:', '');
    await jobRepo.updateJobStatus(jobId, 'cancelled', {
      error: 'Cancelled by administrator',
    });
    MediaProcessingWorker.abortJob(jobId);
    try {
      const queue = getMediaQueue();
      const bullJob = await queue.getJob(jobId);
      if (bullJob) await bullJob.remove();
    } catch {}
    // Fall through to refresh admin:jobs view
  }

  // 4. Jobs Overview: admin:jobs
  if (data === 'admin:jobs' || data.startsWith('admin:killjob:')) {
    const [activeJobs, recentJobs] = await Promise.all([
      jobRepo.getAllActiveJobs(),
      jobRepo.getGlobalRecentJobs(6),
    ]);

    let text = `${ctx.t('admin-jobs-title')}\n\n`;
    text += `${ctx.t('admin-jobs-active', { count: activeJobs.length })}\n`;
    if (activeJobs.length === 0) {
      text += `${ctx.t('admin-jobs-none-active')}\n\n`;
    } else {
      for (const j of activeJobs) {
        const meta = ctx.t('admin-job-row-meta', {
          jobId: escapeHtml(j.id),
          userId: String(j.userId),
          status: escapeHtml(jobStatusLabel(ctx, j.status)),
          percent: j.progressPercent,
        });
        text += `• <b>${escapeHtml(j.title.substring(0, 40))}</b>\n  ${meta}\n`;
      }
      text += '\n';
    }

    text += `${ctx.t('admin-jobs-recent')}\n`;
    if (recentJobs.length === 0) {
      text += `${ctx.t('admin-jobs-none-recent')}\n`;
    } else {
      for (const j of recentJobs) {
        const icon =
          j.status === 'completed'
            ? '✅'
            : j.status === 'failed'
              ? '❌'
              : j.status === 'cancelled'
                ? '🚫'
                : '⏳';
        const sizeStr = j.fileSizeBytes ? ` (${formatFileSize(j.fileSizeBytes)})` : '';
        text += `${icon} <b>${escapeHtml(formatPlatformName(j.platform))}</b> — ${escapeHtml(j.title.substring(0, 32))}${escapeHtml(sizeStr)}\n`;
      }
    }

    const kb = new InlineKeyboard();
    for (const j of activeJobs.slice(0, 5)) {
      kb.text(ctx.t('admin-btn-kill', { job: truncateLabel(j.title, 20) }), `admin:killjob:${j.id}`)
        .danger()
        .row();
    }
    kb.text(ctx.t('admin-btn-refresh'), 'admin:jobs').text(
      ctx.t('admin-btn-back-panel'),
      'admin:home'
    );

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: kb,
      })
      .catch(() => {});
    return true;
  }

  // 5. Maintenance & Cache actions: admin:maintenance or admin:action:*
  if (data === 'admin:maintenance' || data.startsWith('admin:action:')) {
    let actionBanner = '';

    if (data === 'admin:action:cleantemp') {
      const tempStorage = new TempStorageManager();
      tempStorage.cleanupStaleDirectories(0);
      actionBanner = `${ctx.t('admin-maint-cleaned-temp')}\n\n`;
    } else if (data === 'admin:action:clearcache') {
      const removed = await cacheRepo.clearAllCache();
      actionBanner = `${ctx.t('admin-maint-flushed', { count: removed })}\n\n`;
    } else if (data === 'admin:action:cleanqueue') {
      try {
        const queue = getMediaQueue();
        await queue.clean(0, 1000, 'failed');
        await queue.clean(0, 1000, 'completed');
        actionBanner = `${ctx.t('admin-maint-cleaned-queue')}\n\n`;
      } catch {
        actionBanner = `${ctx.t('admin-maint-queue-error')}\n\n`;
      }
    }

    const cacheStats = await cacheRepo
      .getCacheStats()
      .catch(() => ({ totalItems: 0, totalBytes: 0 }));

    let queueDetails = ctx.t('admin-queue-unavailable');
    if (process.env.NODE_ENV !== 'test') {
      try {
        const queue = getMediaQueue();
        const c = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        queueDetails =
          `${ctx.t('admin-maint-queue-counts', { waiting: c.waiting ?? 0, active: c.active ?? 0 })}\n` +
          ctx.t('admin-maint-queue-retained', {
            completed: c.completed ?? 0,
            failed: c.failed ?? 0,
          });
      } catch {}
    }

    const text =
      `${actionBanner}${ctx.t('admin-maint-title')}\n\n` +
      `${ctx.t('admin-maint-cache-section')}\n` +
      `${ctx.t('admin-maint-cache-entries', { count: cacheStats.totalItems })}\n` +
      `${ctx.t('admin-maint-cache-size', { size: escapeHtml(formatFileSize(cacheStats.totalBytes)) })}\n\n` +
      `${ctx.t('admin-maint-queue-section')}\n` +
      queueDetails;

    const kb = new InlineKeyboard()
      .text(ctx.t('admin-btn-clean-temp'), 'admin:action:cleantemp')
      .text(ctx.t('admin-btn-clean-queue'), 'admin:action:cleanqueue')
      .row()
      .text(ctx.t('admin-btn-flush-cache'), 'admin:action:clearcache')
      .danger()
      .row()
      .text(ctx.t('admin-btn-back-panel'), 'admin:home');

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: kb,
      })
      .catch(() => {});
    return true;
  }

  // 5b. YouTube Cookies management: admin:cookies*
  if (data === 'admin:cookies' || data === 'admin:cookies:clear') {
    if (data === 'admin:cookies:clear') {
      pendingCookiesSetupAdmins.delete(ctx.from.id);
      await userRepo.setSetting('youtube_cookies', null);
      try {
        rmSync(getManagedCookiesFilePath(), { force: true });
        rmSync(getRuntimeCookiesFilePath(), { force: true });
      } catch {}
    } else {
      // Activate pending state right on the cookies overview screen so uploading immediately works
      pendingCookiesSetupAdmins.add(ctx.from.id);
    }

    const currentPath = resolveYouTubeCookiesPath();
    let statusText = ctx.t('admin-cookies-missing');
    if (currentPath) {
      const pathLine = ctx.t('admin-cookies-path', { path: escapeHtml(currentPath) });
      try {
        const raw = readFileSync(currentPath, 'utf-8');
        const parsed = parseCookiesFromText(raw);
        const hasAuth = parsed.some(
          (c) =>
            YOUTUBE_AUTH_COOKIE_NAMES.has(c.name) &&
            (c.domain.includes('youtube.com') || c.domain.includes('google.com'))
        );
        statusText =
          ctx.t('admin-cookies-configured', {
            count: parsed.length,
            auth: ctx.t(hasAuth ? 'admin-cookies-auth-ok' : 'admin-cookies-auth-missing'),
          }) + `\n${pathLine}`;
      } catch {
        statusText = `${ctx.t('admin-cookies-configured-simple')}\n${pathLine}`;
      }
    }

    const text =
      `${ctx.t('admin-cookies-title')}\n\n` +
      `${ctx.t('admin-cookies-status', { status: statusText })}\n\n` +
      ctx.t('admin-cookies-help');

    const kb = new InlineKeyboard()
      .text(ctx.t('admin-btn-cookies-upload'), 'admin:cookies:set')
      .primary()
      .row();
    if (currentPath) {
      kb.text(ctx.t('admin-btn-cookies-remove'), 'admin:cookies:clear').danger().row();
    }
    kb.text(ctx.t('admin-btn-back-panel'), 'admin:home');

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: kb,
      })
      .catch(() => {});
    return true;
  }

  if (data === 'admin:cookies:set') {
    pendingCookiesSetupAdmins.add(ctx.from.id);
    const kb = new InlineKeyboard().text(ctx.t('admin-btn-cancel'), 'admin:cookies').danger();
    await ctx
      .editMessageText(
        ctx.t('admin-cookies-set-prompt'),
        {
          parse_mode: 'HTML',
          reply_markup: kb,
        }
      )
      .catch(() => {});
    return true;
  }

  // 6. Force-Join Channel Gate management: admin:channel*
  if (data === 'admin:channel' || data === 'admin:channel:off') {
    pendingChannelSetupAdmins.delete(ctx.from.id);
    if (data === 'admin:channel:off') {
      await userRepo.setSetting('required_channel', 'OFF');
      invalidateForceJoinCache();
    }

    const currentChannel = await getRequiredChannel(userRepo);
    const statusText = currentChannel
      ? ctx.t('admin-channel-on', { channel: escapeHtml(currentChannel) })
      : ctx.t('admin-channel-off');

    const text =
      `${ctx.t('admin-channel-title')}\n\n` +
      `${ctx.t('admin-channel-status', { status: statusText })}\n\n` +
      ctx.t('admin-channel-help');

    const kb = new InlineKeyboard()
      .text(ctx.t('admin-btn-channel-set'), 'admin:channel:set')
      .primary()
      .row();
    if (currentChannel) {
      kb.text(ctx.t('admin-btn-channel-off'), 'admin:channel:off').danger().row();
    }
    kb.text(ctx.t('admin-btn-back-panel'), 'admin:home');

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: kb,
      })
      .catch(() => {});
    return true;
  }

  if (data === 'admin:channel:set') {
    pendingChannelSetupAdmins.add(ctx.from.id);
    const kb = new InlineKeyboard().text(ctx.t('admin-btn-cancel'), 'admin:channel').danger();
    await ctx
      .editMessageText(
        ctx.t('admin-channel-set-prompt'),
        {
          parse_mode: 'HTML',
          reply_markup: kb,
        }
      )
      .catch(() => {});
    return true;
  }

  // 7. Broadcast Mode
  if (data === 'admin:broadcast') {
    pendingBroadcastAdmins.add(ctx.from.id);
    const kb = new InlineKeyboard()
      .text(ctx.t('admin-btn-cancel'), 'admin:broadcast:cancel')
      .danger();
    await ctx
      .editMessageText(
        ctx.t('admin-broadcast-prompt'),
        {
          parse_mode: 'HTML',
          reply_markup: kb,
        }
      )
      .catch(() => {});
    return true;
  }

  if (data === 'admin:broadcast:cancel') {
    pendingBroadcastAdmins.delete(ctx.from.id);
    const html = await buildAdminOverviewHtml(userRepo, jobRepo, cacheRepo, ctx.locale);
    await ctx
      .editMessageText(html, {
        parse_mode: 'HTML',
        reply_markup: createAdminMainKeyboard(ctx.locale),
      })
      .catch(() => {});
    return true;
  }

  return true;
}

async function renderAdminUserDetail(
  ctx: BotContext,
  userRepo: UserRepository,
  targetUserId: number,
  returnPage: number
): Promise<boolean> {
  const u = await userRepo.getUser(targetUserId);
  if (!u) {
    await ctx.editMessageText(ctx.t('admin-user-missing'), {
      reply_markup: new InlineKeyboard().text(
        ctx.t('admin-btn-back-users'),
        `admin:users:${returnPage}`
      ),
    }).catch(() => {});
    return true;
  }

  const name = escapeHtml([u.firstName, u.lastName].filter(Boolean).join(' ') || 'User');
  const uname = u.username ? `@${escapeHtml(u.username)}` : ctx.t('admin-na');

  const text = [
    ctx.t('admin-user-detail-title'),
    '',
    ctx.t('admin-user-name', { name }),
    ctx.t('admin-user-username', { username: uname }),
    ctx.t('admin-user-id', { userId: String(u.id) }),
    ctx.t('admin-user-lang', { lang: u.languageCode.toUpperCase() }),
    ctx.t('admin-user-tier', { tier: ctx.t(u.tier === 'vip' ? 'admin-tier-vip' : 'admin-tier-free') }),
    ctx.t('admin-user-status', {
      status: ctx.t(u.isBanned ? 'admin-status-banned' : 'admin-status-active'),
    }),
  ].join('\n');

  const kb = new InlineKeyboard();
  if (u.tier === 'vip') {
    kb.text(ctx.t('admin-btn-demote'), `admin:utier:${u.id}:free:${returnPage}`);
  } else {
    kb.text(ctx.t('admin-btn-promote'), `admin:utier:${u.id}:vip:${returnPage}`).success();
  }

  if (u.isBanned) {
    kb.text(ctx.t('admin-btn-unban'), `admin:uban:${u.id}:0:${returnPage}`).success();
  } else {
    kb.text(ctx.t('admin-btn-ban'), `admin:uban:${u.id}:1:${returnPage}`).danger();
  }

  kb.row().text(ctx.t('admin-btn-back-users'), `admin:users:${returnPage}`);

  await ctx
    .editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: kb,
    })
    .catch(() => {});
  return true;
}

async function readTelegramDocumentContent(
  ctx: BotContext,
  fileId: string
): Promise<{ content: string | null; filePath?: string; errorDetail?: string }> {
  try {
    const fileInfo = await ctx.api.getFile(fileId);
    const rawPath = fileInfo.file_path;
    if (!rawPath) {
      return { content: null, errorDetail: 'Telegram getFile returned an empty file_path' };
    }

    const config = getConfig();
    const errors: string[] = [];

    // 1. Try reading directly from local filesystem path (e.g. /var/lib/telegram-bot-api/<token>/documents/...)
    try {
      const content = readFileSync(rawPath, 'utf-8');
      if (content) {
        return { content, filePath: rawPath };
      }
    } catch (err) {
      errors.push(`local(${rawPath}): ${err instanceof Error ? err.message : String(err)}`);
    }

    // Normalize relative path by stripping local telegram-bot-api prefix if present
    const relativePath = rawPath
      .replace(/^\/var\/lib\/telegram-bot-api\/[^/]+\//, '')
      .replace(/^\/+/, '');

    // 2. Try reading from /var/lib/telegram-bot-api/<BOT_TOKEN>/<relativePath>
    const mappedLocalPath = join('/var/lib/telegram-bot-api', config.BOT_TOKEN, relativePath);
    if (mappedLocalPath !== rawPath) {
      try {
        const content = readFileSync(mappedLocalPath, 'utf-8');
        if (content) {
          return { content, filePath: mappedLocalPath };
        }
      } catch (err) {
        errors.push(`mapped(${mappedLocalPath}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Try HTTP fetch from configured TELEGRAM_API_ROOT and official api.telegram.org
    const apiRoot = (config.TELEGRAM_API_ROOT || 'https://api.telegram.org').replace(/\/$/, '');
    const candidateUrls = [
      `${apiRoot}/file/bot${config.BOT_TOKEN}/${relativePath}`,
      `${apiRoot}/file/bot${config.BOT_TOKEN}/${rawPath.replace(/^\/+/, '')}`,
      `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${relativePath}`,
    ];

    for (const url of Array.from(new Set(candidateUrls))) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const text = await res.text();
          if (text) {
            return { content: text, filePath: rawPath };
          }
        } else {
          errors.push(`http(${res.status})`);
        }
      } catch (err) {
        errors.push(`fetch: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.warn({ rawPath, errors }, 'Failed to read uploaded Telegram document');
    return { content: null, filePath: rawPath, errorDetail: errors[0] };
  } catch (err) {
    logger.error({ err }, 'Error calling ctx.api.getFile for uploaded document');
    return {
      content: null,
      errorDetail: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildCookieReplyMessage(ctx: BotContext, diag: CookieSaveDiagnostics): string {
  if (diag.totalCookies === 0) {
    return ctx.t('admin-cookies-none');
  }

  const authLine = diag.hasAuthCookies
    ? ctx.t('admin-cookies-auth-found', {
        names: escapeHtml(diag.foundAuthCookies.slice(0, 4).join(', ')),
      })
    : ctx.t('admin-cookies-auth-none');

  return [
    ctx.t('admin-cookies-saved'),
    ctx.t('admin-cookies-path', { path: escapeHtml(diag.savedPath) }),
    ctx.t('admin-cookies-saved-count', { total: diag.totalCookies, youtube: diag.youtubeCookies }),
    authLine,
  ].join('\n');
}

function backToCookiesKeyboard(ctx: BotContext): InlineKeyboard {
  return new InlineKeyboard().text(ctx.t('admin-btn-back-cookies'), 'admin:cookies').primary();
}

export function createAdminBroadcastMiddleware(userRepo: UserRepository) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id;
    if (!userId) {
      return next();
    }

    const doc = ctx.message?.document;
    const text = ctx.message?.text?.trim();

    // 1. Handle any document uploaded in chat (cookies.txt)
    if (doc) {
      if (!isAdminUser(userId)) {
        await ctx.reply(ctx.t('admin-upload-denied', { userId: String(userId) }), {
          parse_mode: 'HTML',
        });
        return;
      }

      const { content: cookiesContent, filePath, errorDetail } = await readTelegramDocumentContent(
        ctx,
        doc.file_id
      );

      if (cookiesContent) {
        pendingCookiesSetupAdmins.delete(userId);
        const diag = saveYouTubeCookiesWithDiagnostics(cookiesContent, { mergeExisting: false });
        await userRepo.setSetting('youtube_cookies', diag.normalizedContent);

        await ctx.reply(buildCookieReplyMessage(ctx, diag), {
          parse_mode: 'HTML',
          reply_markup: backToCookiesKeyboard(ctx),
        });
        return;
      }

      const failureLines = [ctx.t('admin-cookies-read-failed')];
      if (filePath) failureLines.push(ctx.t('admin-cookies-read-path', { path: escapeHtml(filePath) }));
      if (errorDetail) {
        failureLines.push(ctx.t('admin-cookies-read-detail', { detail: escapeHtml(errorDetail) }));
      }
      failureLines.push('', ctx.t('admin-cookies-read-fix'));

      await ctx.reply(failureLines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: backToCookiesKeyboard(ctx),
      });
      return;
    }

    // 2. Handle pasted YouTube cookies text (auto-detects Netscape/JSON cookies & merges multi-part Telegram splits)
    const isCookiesText = Boolean(text && !text.startsWith('/') && looksLikeCookiesInput(text));
    if (
      text &&
      !text.startsWith('/') &&
      isAdminUser(userId) &&
      ( isCookiesText || (pendingCookiesSetupAdmins.has(userId) && !/^https?:\/\/\S+$/i.test(text)) )
    ) {
      const diag = saveYouTubeCookiesWithDiagnostics(text, { mergeExisting: true });
      await userRepo.setSetting('youtube_cookies', diag.normalizedContent);

      await ctx.reply(buildCookieReplyMessage(ctx, diag), {
        parse_mode: 'HTML',
        reply_markup: backToCookiesKeyboard(ctx),
      });
      return;
    }

    if (!text) {
      return next();
    }

    if (text.startsWith('/')) {
      pendingCookiesSetupAdmins.delete(userId);
    }

    // Handle pending Force-Join Channel setup
    if (pendingChannelSetupAdmins.has(userId)) {
      pendingChannelSetupAdmins.delete(userId);
      if (text.startsWith('/')) {
        return next();
      }
      const normalizedChannel = text.startsWith('@')
        ? text
        : `@${text.replace(/^https?:\/\/t\.me\//i, '')}`;
      await userRepo.setSetting('required_channel', normalizedChannel);
      invalidateForceJoinCache();

      await ctx.reply(
        ctx.t('admin-channel-updated', { channel: escapeHtml(normalizedChannel) }),
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text(ctx.t('admin-btn-back-channel'), 'admin:channel'),
        }
      );
      return;
    }

    // Handle pending Broadcast message
    if (!pendingBroadcastAdmins.has(userId)) {
      return next();
    }

    if (text.startsWith('/')) {
      pendingBroadcastAdmins.delete(userId);
      return next();
    }

    pendingBroadcastAdmins.delete(userId);

    const userIds = await userRepo.getAllUserIds();
    let sentCount = 0;
    let failedCount = 0;

    const statusMsg = await ctx.reply(
      ctx.t('admin-broadcast-sending', { count: userIds.length }),
      { parse_mode: 'HTML' }
    );

    for (const targetId of userIds) {
      try {
        // Recipients' languages vary, so the header is bilingual
        await ctx.api.sendMessage(
          targetId,
          `📢 <b>Announcement · اطلاعیه</b>\n\n${escapeHtml(text)}`,
          { parse_mode: 'HTML' }
        );
        sentCount++;
      } catch {
        failedCount++;
      }
    }

    await ctx.api
      .editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        ctx.t('admin-broadcast-done', { sent: sentCount, failed: failedCount }),
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text(ctx.t('admin-btn-back-panel'), 'admin:home'),
        }
      )
      .catch(() => {});
  };
}
