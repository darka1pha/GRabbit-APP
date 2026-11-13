import { BotContext } from '../context.js';
import { SupportedLocale, MediaFormat } from '../../config/constants.js';
import { UserRepository } from '../../database/repositories/user-repository.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { MediaCacheRepository } from '../../database/repositories/media-cache-repository.js';
import { previewCache } from './preview-cache.js';
import { JobNotFoundError } from '../../core/errors/domain-errors.js';
import {
  createLanguageKeyboard,
  createJobProgressKeyboard,
  createHomeButtonKeyboard,
} from '../keyboards/index.js';
import { translate, isSupportedLocale } from '../../i18n/index.js';
import { escapeHtml, buildMediaCaption, renderStatusCard } from '../formatting.js';
import { handleAdminCallback } from '../commands/admin.js';
import { buildSettingsView } from '../commands/settings.js';
import { buildHomeMenuView, buildSearchPromptView } from '../commands/start.js';
import { buildHistoryView } from '../commands/history.js';
import { buildHelpText } from '../commands/help.js';
import { buildStatusView } from '../commands/status.js';
import { cancelUserJob } from '../commands/cancel.js';
import { buildSearchResultsView } from '../commands/search.js';
import { buildFormatPickerView } from './url-handler.js';
import { assertCanStartJob, enqueueDownload, newJobId } from './enqueue.js';
import { handleCollectionCallback } from './collection-view.js';
import { DefaultFormatPreference } from '../../core/types/user.js';
import { YouTubeAdapter, getStandardYouTubeMediaOptions } from '../../platforms/youtube/youtube-adapter.js';

const VALID_FORMAT_PREFS: DefaultFormatPreference[] = [
  'ask',
  'audio',
  'video_720p',
  'video_1080p',
];

type EditOptions = Parameters<BotContext['editMessageText']>[1];

/**
 * Edits the callback's message, ignoring Telegram's "message is not modified" error
 * (e.g. tapping Refresh or an already-selected option) so it doesn't surface as a failure.
 */
async function safeEdit(ctx: BotContext, text: string, options?: EditOptions): Promise<void> {
  try {
    await ctx.editMessageText(text, options);
  } catch (err) {
    const description =
      (err as { description?: string })?.description || (err as Error)?.message || '';
    if (description.includes('message is not modified')) {
      return;
    }
    if (description.includes('no text in the message to edit') || ctx.callbackQuery?.message?.photo) {
      try {
        await ctx.editMessageCaption({
          caption: text,
          parse_mode: options?.parse_mode,
          reply_markup: options?.reply_markup,
        });
        return;
      } catch (capErr) {
        const capDesc =
          (capErr as { description?: string })?.description || (capErr as Error)?.message || '';
        if (capDesc.includes('message is not modified')) {
          return;
        }
        await ctx.reply(text, {
          parse_mode: options?.parse_mode,
          reply_markup: options?.reply_markup,
        });
        return;
      }
    }
    throw err;
  }
}

/** Preview-cache key referenced by a menu button, if any (for the ownership check). */
function menuKeyFromCallback(data: string): string | undefined {
  const parts = data.split(':');
  if (data.startsWith('dl:') || data.startsWith('sp:')) return parts[1];
  if (data.startsWith('srch:') || data.startsWith('col:') || data.startsWith('cancel:preview:')) {
    return parts[2];
  }
  return undefined;
}

/**
 * In groups, menus and status cards belong to whoever opened them. Returns false (after
 * showing an alert) when someone else taps one of their buttons.
 */
async function ensureCallbackOwner(
  ctx: BotContext,
  data: string,
  jobRepo: JobRepository
): Promise<boolean> {
  let ownerId: number | undefined;

  const menuKey = menuKeyFromCallback(data);
  if (menuKey) {
    ownerId = (await previewCache.getAsync(menuKey))?.ownerId;
  } else if (data.startsWith('cancel:job:') || data.startsWith('cancel:list:')) {
    ownerId = (await jobRepo.getJob(data.split(':')[2]))?.userId;
  }

  if (ownerId !== undefined && ownerId !== ctx.from!.id) {
    await ctx
      .answerCallbackQuery({ text: ctx.t('error-not-your-menu'), show_alert: true })
      .catch(() => {});
    return false;
  }
  return true;
}

export function createCallbackHandler(
  userRepo: UserRepository,
  jobRepo: JobRepository,
  mediaCacheRepo?: MediaCacheRepository
) {
  const cacheRepo = mediaCacheRepo || new MediaCacheRepository();

  return async (ctx: BotContext): Promise<void> => {
    const data = ctx.callbackQuery?.data;
    if (!data || !ctx.from || !ctx.chat) return;

    // 0. Admin Panel callbacks: admin:*
    if (data.startsWith('admin:')) {
      await handleAdminCallback(ctx, userRepo, jobRepo, cacheRepo);
      return;
    }

    if (!(await ensureCallbackOwner(ctx, data, jobRepo))) return;

    await ctx.answerCallbackQuery().catch(() => {});

    // 1. Language update: lang:<locale> or lang:set:<locale>
    if (data.startsWith('lang:')) {
      const isFromSettings = data.startsWith('lang:set:');
      const rawLocale = isFromSettings ? data.replace('lang:set:', '') : data.split(':')[1];
      if (!rawLocale || !isSupportedLocale(rawLocale)) return;
      const selectedLocale: SupportedLocale = rawLocale;
      await userRepo.updateLanguage(ctx.from.id, selectedLocale);
      ctx.locale = selectedLocale;
      ctx.t = (key, params) => translate(selectedLocale, key, params);
      if (ctx.userRecord) {
        ctx.userRecord.languageCode = selectedLocale;
        ctx.userRecord.languageSelected = true;
      }

      const confirmMsg = escapeHtml(translate(selectedLocale, 'language-updated'));

      if (isFromSettings) {
        const { text, keyboard } = buildSettingsView(ctx);
        await safeEdit(ctx, `${confirmMsg}\n\n${text}`, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        return;
      }

      // First-time language selection on /start -> show confirmation + main menu
      const home = buildHomeMenuView(ctx, selectedLocale);
      await safeEdit(ctx, `${confirmMsg}\n\n${home.text}`, {
        parse_mode: 'HTML',
        reply_markup: home.keyboard,
      });
      return;
    }

    // 2. Navigation to language selection (from settings)
    if (data === 'nav:language') {
      const prompt = ctx.t('language-select-title');
      await safeEdit(ctx, prompt, {
        reply_markup: createLanguageKeyboard(true),
      });
      return;
    }

    // 2a. Main menu navigation callbacks: menu:*
    if (data === 'menu:home') {
      const home = buildHomeMenuView(ctx);
      await safeEdit(ctx, home.text, {
        parse_mode: 'HTML',
        reply_markup: home.keyboard,
      });
      return;
    }

    if (data === 'menu:settings') {
      const { text, keyboard } = buildSettingsView(ctx);
      await safeEdit(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    if (data === 'menu:search') {
      const { text, keyboard } = buildSearchPromptView(ctx);
      await safeEdit(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    if (data === 'menu:history') {
      const { text, keyboard } = await buildHistoryView(ctx, jobRepo, true);
      await safeEdit(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    if (data === 'menu:status') {
      const { text, keyboard } = await buildStatusView(ctx, jobRepo);
      await safeEdit(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    if (data === 'menu:help') {
      await safeEdit(ctx, buildHelpText(ctx), {
        parse_mode: 'HTML',
        reply_markup: createHomeButtonKeyboard(ctx.locale),
      });
      return;
    }

    // 2b. Default format preference update: pref:fmt:<mode>
    if (data.startsWith('pref:fmt:')) {
      const rawPref = data.replace('pref:fmt:', '') as DefaultFormatPreference;
      if (!VALID_FORMAT_PREFS.includes(rawPref)) return;

      await userRepo.updateDefaultFormat(ctx.from.id, rawPref);
      if (ctx.userRecord) {
        ctx.userRecord.defaultFormat = rawPref;
      }

      const { text, keyboard } = buildSettingsView(ctx, rawPref);
      await safeEdit(ctx, `${escapeHtml(ctx.t('settings-format-updated'))}\n\n${text}`, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    // 2c. Search result paging: sp:<sessionKey>:<page>
    if (data.startsWith('sp:')) {
      const [, sessionKey, rawPage] = data.split(':');
      const session = await previewCache.getAsync(sessionKey);
      if (!session) {
        await safeEdit(ctx, ctx.t('error-preview-expired'));
        return;
      }
      const { text, keyboard } = buildSearchResultsView(ctx, sessionKey, session, Number(rawPage) || 0);
      await safeEdit(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

    // 2d. Album / playlist track picker: col:<p|t|all>:<key>:<arg>
    if (data.startsWith('col:')) {
      await handleCollectionCallback(ctx, data, jobRepo, (text, keyboard) =>
        safeEdit(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard })
      );
      return;
    }

    // 3a. Search result -> video: srch:video:<cacheKey> opens a format picker as a new
    // message, so the results list stays available for other picks
    if (data.startsWith('srch:video:')) {
      const cacheKey = data.split(':')[2];
      const cached = await previewCache.getAsync(cacheKey);
      if (!cached) {
        await safeEdit(ctx, ctx.t('error-preview-expired'));
        return;
      }

      // Fetching live formats can take a few seconds; show feedback meanwhile
      const loadingMsg = await ctx.reply(ctx.t('loading-formats'));

      // Try to enrich with live yt-dlp format sizes if available; otherwise use standard options
      try {
        const ytAdapter = new YouTubeAdapter();
        const liveMetadata = await ytAdapter.fetchMetadata(cached.url);
        if (liveMetadata.items[0]?.availableOptions?.length) {
          cached.metadata = liveMetadata;
          previewCache.set(cacheKey, cached);
        }
      } catch {
        if (cached.metadata.items[0]) {
          cached.metadata.items[0].availableOptions = getStandardYouTubeMediaOptions();
          previewCache.set(cacheKey, cached);
        }
      }

      const { text, keyboard } = buildFormatPickerView(ctx, {
        ...cached.metadata,
        items: [{ ...cached.metadata.items[0], url: cached.url }],
      });
      await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    // 3b. Search result -> audio: srch:audio:<cacheKey> starts right away in a new status card
    if (data.startsWith('srch:audio:')) {
      const cacheKey = data.split(':')[2];
      const cached = await previewCache.getAsync(cacheKey);
      if (!cached) {
        await safeEdit(ctx, ctx.t('error-preview-expired'));
        return;
      }

      const { activeCount, isVip } = await assertCanStartJob(ctx, jobRepo);
      const item = cached.metadata.items[0];
      const jobId = newJobId();
      const card = await ctx.reply(
        renderStatusCard(
          item.title,
          'audio',
          escapeHtml(ctx.t('download-queued', { position: activeCount + 1 }))
        ),
        { parse_mode: 'HTML', reply_markup: createJobProgressKeyboard(ctx.locale, jobId) }
      );
      await enqueueDownload(ctx, jobRepo, {
        id: jobId,
        platform: cached.metadata.platform,
        url: cached.url,
        mediaId: item.id,
        title: item.title,
        format: 'audio',
        qualityId: 'bestaudio',
        statusMessageId: card.message_id,
        isVip,
      });
      return;
    }

    // 3c. Format picked: dl:<cacheKey>:<format>:<qualityId> turns the picker into a status card
    if (data.startsWith('dl:')) {
      const parts = data.split(':');
      const cacheKey = parts[1];
      const format = parts[2] as MediaFormat;
      const qualityId = parts.slice(3).join(':');

      const cached = await previewCache.getAsync(cacheKey);
      if (!cached) {
        await safeEdit(ctx, ctx.t('error-preview-expired'));
        return;
      }

      const { activeCount, isVip } = await assertCanStartJob(ctx, jobRepo);
      const item = cached.metadata.items[0];

      const jobRecord = await enqueueDownload(ctx, jobRepo, {
        platform: cached.metadata.platform,
        url: cached.url,
        mediaId: item.id,
        title: item.title,
        format,
        qualityId,
        statusMessageId: ctx.callbackQuery?.message?.message_id,
        isVip,
      });

      previewCache.delete(cacheKey);

      const queuedText = ctx.t('download-queued', { position: activeCount + 1 });
      await safeEdit(ctx, renderStatusCard(item.title, format, escapeHtml(queuedText)), {
        parse_mode: 'HTML',
        reply_markup: createJobProgressKeyboard(ctx.locale, jobRecord.id),
      });
      return;
    }

    // 3d. History Re-send: hist:resend:<jobId>
    if (data.startsWith('hist:resend:')) {
      const jobId = data.replace('hist:resend:', '');
      const job = await jobRepo.getJob(jobId);
      if (!job || job.userId !== ctx.from.id) {
        throw new JobNotFoundError(jobId);
      }

      const cachedMedia = await cacheRepo.getCachedMedia(
        job.platform,
        job.mediaId,
        job.format,
        job.qualityId
      );

      if (cachedMedia?.telegramFileId) {
        const caption = buildMediaCaption(
          job.title,
          cachedMedia.author,
          job.format,
          ctx.me?.username
        );

        if (job.format === 'audio') {
          await ctx.api.sendAudio(ctx.chat.id, cachedMedia.telegramFileId, {
            caption,
            parse_mode: 'HTML',
            title: job.title,
            performer: cachedMedia.author,
          });
        } else if (job.format === 'video') {
          await ctx.api.sendVideo(ctx.chat.id, cachedMedia.telegramFileId, {
            caption,
            parse_mode: 'HTML',
            supports_streaming: true,
          });
        } else {
          await ctx.api.sendDocument(ctx.chat.id, cachedMedia.telegramFileId, {
            caption,
            parse_mode: 'HTML',
          });
        }
        return;
      }

      // Fallback: if cache was flushed, re-queue the job (subject to the same download limit)
      const { activeCount, isVip } = await assertCanStartJob(ctx, jobRepo);
      const newId = newJobId();
      const statusMsg = await ctx.reply(
        renderStatusCard(
          job.title,
          job.format,
          escapeHtml(ctx.t('download-queued', { position: activeCount + 1 }))
        ),
        {
          parse_mode: 'HTML',
          reply_markup: createJobProgressKeyboard(ctx.locale, newId),
        }
      );

      await enqueueDownload(ctx, jobRepo, {
        id: newId,
        platform: job.platform,
        url: job.sourceUrl,
        mediaId: job.mediaId,
        title: job.title,
        format: job.format,
        qualityId: job.qualityId,
        statusMessageId: statusMsg.message_id,
        isVip,
      });
      return;
    }

    // 4. Cancel job from its progress card: cancel:job:<jobId>
    if (data.startsWith('cancel:job:')) {
      const jobId = data.replace('cancel:job:', '');
      const job = await cancelUserJob(jobRepo, ctx.from.id, jobId);

      await safeEdit(
        ctx,
        renderStatusCard(job.title, job.format, escapeHtml(ctx.t('download-cancelled'))),
        { parse_mode: 'HTML' }
      );
      return;
    }

    // 4b. Cancel job from the active-downloads list: cancel:list:<jobId> (list is re-rendered)
    if (data.startsWith('cancel:list:')) {
      const jobId = data.replace('cancel:list:', '');
      const job = await cancelUserJob(jobRepo, ctx.from.id, jobId);

      const notice = ctx.t('job-cancelled-success', { title: job.title });
      const { text, keyboard } = await buildStatusView(ctx, jobRepo, notice);
      await safeEdit(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    // 5. Cancel preview / close search results or a track list
    if (data.startsWith('cancel:preview:')) {
      const cacheKey = data.replace('cancel:preview:', '');
      previewCache.delete(cacheKey);
      await ctx.deleteMessage().catch(() => {});
      return;
    }
  };
}
