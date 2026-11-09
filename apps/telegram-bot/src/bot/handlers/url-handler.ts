import { BotContext } from '../context.js';
import { extractUrlFromText } from '../../platforms/url-parser.js';
import { PlatformRouter } from '../../platforms/platform-router.js';
import { formatDuration } from '../../i18n/locale-resolver.js';
import { previewCache } from './preview-cache.js';
import { createFormatSelectionKeyboard, createJobProgressKeyboard } from '../keyboards/index.js';
import { randomBytes } from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { escapeHtml, formatPlatformName, renderStatusCard } from '../formatting.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { looksLikeCookiesInput } from '../commands/admin.js';
import { MediaFormat } from '../../config/constants.js';
import { DefaultFormatPreference } from '../../core/types/user.js';
import { MediaItem, MediaOption, PlatformMetadata } from '../../core/types/platform.js';
import { executeSearchQuery } from '../commands/search.js';
import { YtDlpRunner } from '../../services/downloads/ytdlp-runner.js';
import { assertCanStartJob, enqueueDownload } from './enqueue.js';
import { buildCollectionView } from './collection-view.js';

/** Compact link preview: title, author, then duration · platform on one line (HTML). */
export function buildMediaPreviewText(ctx: BotContext, metadata: PlatformMetadata): string {
  const firstItem = metadata.items[0];
  const options = firstItem.availableOptions;
  const isAudioOnly =
    metadata.platform === 'spotify' ||
    metadata.platform === 'soundcloud' ||
    (options.length > 0 && options.every((o) => o.format === 'audio'));
  const icon = isAudioOnly ? '🎵' : '🎬';
  const author = firstItem.uploader || metadata.artistOrAuthor || 'Unknown';
  const duration = formatDuration(firstItem.durationSeconds || metadata.durationSeconds);

  return [
    `${icon} <b>${escapeHtml(firstItem.title)}</b>`,
    escapeHtml(ctx.t('media-preview-author', { author })),
    escapeHtml(
      ctx.t('media-preview-meta', { duration, platform: formatPlatformName(metadata.platform) })
    ),
  ].join('\n');
}

export function unavailableReasonKey(platform: string): string {
  if (platform === 'spotify') return 'spotify-send-track';
  if (platform === 'youtube') return 'error-live-stream';
  return 'error-unauthorized-content';
}

/** Wraps one item (e.g. a track from an album) as its own single-item metadata. */
export function singleItemMetadata(parent: PlatformMetadata, item: MediaItem): PlatformMetadata {
  return {
    platform: parent.platform,
    url: item.url,
    title: item.title,
    artistOrAuthor: item.uploader || parent.artistOrAuthor,
    durationSeconds: item.durationSeconds,
    thumbnailUrl: item.thumbnailUrl || parent.thumbnailUrl,
    isAuthorized: true,
    items: [item],
  };
}

/**
 * Preview + format picker for a single item. Caches the preview (owned by the current user)
 * so the format buttons work; non-downloadable items get the reason and no keyboard.
 */
export function buildFormatPickerView(
  ctx: BotContext,
  metadata: PlatformMetadata
): { text: string; keyboard?: InlineKeyboard } {
  const item = metadata.items[0];
  let text = `${buildMediaPreviewText(ctx, metadata)}\n\n`;

  if (!item.isDownloadable) {
    text += `<b>${escapeHtml(ctx.t(unavailableReasonKey(metadata.platform)))}</b>`;
    return { text };
  }

  const cacheKey = randomBytes(6).toString('hex');
  previewCache.set(cacheKey, {
    url: item.url,
    platform: metadata.platform,
    metadata,
    ownerId: ctx.from?.id,
  });

  text += escapeHtml(ctx.t('download-select-format'));
  const keyboard = createFormatSelectionKeyboard({
    locale: ctx.locale,
    jobKey: cacheKey,
    mediaOptions: item.availableOptions,
  });
  return { text, keyboard };
}

export function resolvePreferredOption(
  preference: DefaultFormatPreference,
  options: MediaOption[]
): { format: MediaFormat; qualityId: string } {
  if (preference === 'audio') {
    const audioOpt = options.find((o) => o.format === 'audio');
    return {
      format: 'audio',
      qualityId: audioOpt?.qualityId || 'bestaudio',
    };
  }

  const targetQuality = preference === 'video_1080p' ? '1080p' : '720p';
  const exactVideo = options.find(
    (o) => o.format === 'video' && o.qualityId === targetQuality
  );
  if (exactVideo) {
    return { format: 'video', qualityId: exactVideo.qualityId };
  }

  const anyVideo = options.find((o) => o.format === 'video');
  if (anyVideo) {
    return { format: 'video', qualityId: anyVideo.qualityId };
  }

  return { format: 'video', qualityId: targetQuality };
}

export async function processMediaUrl(
  ctx: BotContext,
  extracted: string,
  router?: PlatformRouter,
  jobRepo?: JobRepository
): Promise<void> {
  const platformRouter = router || new PlatformRouter();
  const jobs = jobRepo || new JobRepository();

  const waitMsg = await ctx.reply(ctx.t('processing-link'));

  try {
    const metadata = await platformRouter.getMetadata(extracted);
    const firstItem = metadata.items[0];

    if (!firstItem) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        waitMsg.message_id,
        ctx.t('error-media-unavailable')
      );
      return;
    }

    // Albums / playlists / sets: show a track picker instead of a single preview
    if (metadata.isCollection) {
      const key = randomBytes(6).toString('hex');
      const entry = {
        url: extracted,
        platform: metadata.platform,
        metadata,
        ownerId: ctx.from?.id,
        queuedIds: [] as string[],
      };
      previewCache.set(key, entry);
      const { text, keyboard } = buildCollectionView(ctx, key, entry, 0);
      await ctx.api.editMessageText(ctx.chat!.id, waitMsg.message_id, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    // Check if user has an automatic default format preference configured
    const pref = ctx.userRecord?.defaultFormat || 'ask';
    if (firstItem.isDownloadable && pref !== 'ask' && ctx.from && ctx.chat) {
      const { activeCount, isVip } = await assertCanStartJob(ctx, jobs);
      const { format, qualityId } = resolvePreferredOption(pref, firstItem.availableOptions);

      const jobRecord = await enqueueDownload(ctx, jobs, {
        platform: metadata.platform,
        url: extracted,
        mediaId: firstItem.id,
        title: firstItem.title,
        format,
        qualityId,
        statusMessageId: waitMsg.message_id,
        isVip,
      });

      const queuedText = ctx.t('download-queued', { position: activeCount + 1 });
      await ctx.api.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        renderStatusCard(firstItem.title, format, escapeHtml(queuedText)),
        {
          parse_mode: 'HTML',
          reply_markup: createJobProgressKeyboard(ctx.locale, jobRecord.id),
        }
      );
      return;
    }

    // The preview's cached URL is the link the user sent (adapters may normalize item URLs)
    const { text, keyboard } = buildFormatPickerView(ctx, {
      ...metadata,
      items: [{ ...firstItem, url: extracted }],
    });
    await ctx.api.editMessageText(ctx.chat!.id, waitMsg.message_id, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
    throw err;
  }
}

export function createUrlHandler(
  router: PlatformRouter,
  jobRepo?: JobRepository,
  ytdlpRunner?: YtDlpRunner
) {
  return async (ctx: BotContext): Promise<void> => {
    const text = ctx.message?.text;
    if (!text || looksLikeCookiesInput(text)) return;

    const isPrivateChat = !ctx.chat?.type || ctx.chat.type === 'private';
    const botUsername = ctx.me?.username;
    const mentionPattern = botUsername ? new RegExp(`^@${botUsername}\\b\\s*`, 'i') : null;
    const mentionsBot = mentionPattern ? mentionPattern.test(text) : false;

    const extracted = extractUrlFromText(text);
    if (!extracted) {
      // In private chats any text is a search (a leading @mention comes from the Inline Search
      // button). In groups, only messages that start by mentioning the bot are searches.
      let cleaned = text.trim();
      if (isPrivateChat) {
        cleaned = cleaned.replace(/^@[a-zA-Z0-9_]+\s*/i, '').trim();
      } else if (mentionPattern) {
        cleaned = cleaned.replace(mentionPattern, '').trim();
      }
      if ((isPrivateChat || mentionsBot) && cleaned.length >= 2 && !cleaned.startsWith('/')) {
        await executeSearchQuery(ctx, cleaned, ytdlpRunner);
      }
      return;
    }

    await processMediaUrl(ctx, extracted, router, jobRepo);
  };
}

/**
 * /dl <link>, or /dl as a reply to a message containing a link. Mainly for groups, where the
 * bot may not see plain links (privacy mode), but works in private chats too.
 */
export function createDownloadCommandHandler(router: PlatformRouter, jobRepo?: JobRepository) {
  return async (ctx: BotContext): Promise<void> => {
    const ownText = (ctx.message?.text || '').replace(/^\/dl(@\S+)?\s*/i, '');
    const reply = ctx.message?.reply_to_message;
    const replyText = reply ? reply.text || reply.caption || '' : '';

    const extracted = extractUrlFromText(ownText) || extractUrlFromText(replyText);
    if (!extracted) {
      await ctx.reply(ctx.t('dl-usage'));
      return;
    }

    await processMediaUrl(ctx, extracted, router, jobRepo);
  };
}
