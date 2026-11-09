import { InlineKeyboard } from 'grammy';
import { InlineQueryResult } from 'grammy/types';
import { BotContext } from '../context.js';
import { MediaCacheRepository } from '../../database/repositories/media-cache-repository.js';
import { YtDlpRunner } from '../../services/downloads/ytdlp-runner.js';
import { formatDuration } from '../../i18n/locale-resolver.js';
import { escapeHtml, buildMediaCaption } from '../formatting.js';
import { APP_NAME, BOT_USERNAME } from '../../config/constants.js';
import { logger } from '../../observability/logger.js';
import { getYouTubeYtDlpExtraArgs } from '../../platforms/youtube/youtube-adapter.js';

export function createInlineQueryHandler(
  mediaCacheRepo?: MediaCacheRepository,
  ytdlpRunner?: YtDlpRunner
) {
  const cacheRepo = mediaCacheRepo || new MediaCacheRepository();
  const ytdlp = ytdlpRunner || new YtDlpRunner();

  return async (ctx: BotContext): Promise<void> => {
    const rawQuery = ctx.inlineQuery?.query?.trim() || '';
    const results: InlineQueryResult[] = [];
    const botUsername = ctx.me?.username || BOT_USERNAME;

    logger.debug({ userId: ctx.from?.id, query: rawQuery }, 'Handling inline_query');

    try {
      // 1. Search cached Telegram file_ids first for instant inline sharing
      const cachedMatches = await cacheRepo.searchCachedMedia(rawQuery, 10);
      for (const item of cachedMatches) {
        const resultId = `cache_${item.platform}_${item.mediaId}_${item.format}_${item.qualityId}`
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .substring(0, 64);
        const title = item.title || `${item.platform.toUpperCase()} ${item.mediaId}`;
        const caption = buildMediaCaption(title, item.author, item.format, botUsername);

        if (item.format === 'audio') {
          results.push({
            type: 'audio',
            id: resultId,
            audio_file_id: item.telegramFileId,
            caption,
            parse_mode: 'HTML',
          });
        } else if (item.format === 'video') {
          results.push({
            type: 'video',
            id: resultId,
            video_file_id: item.telegramFileId,
            title,
            description: item.author || item.platform.toUpperCase(),
            caption,
            parse_mode: 'HTML',
          });
        }
      }

      // 2. If user typed a search query and we have room, also query YouTube
      if (rawQuery.length >= 2 && results.length < 10) {
        const ytResults = await ytdlp
          .search(rawQuery, 5, getYouTubeYtDlpExtraArgs())
          .catch(() => []);

        for (const yt of ytResults) {
          const dur = formatDuration(yt.duration);
          const channel = yt.channel || 'YouTube';
          const deepLink = `https://t.me/${botUsername}?start=yt_${yt.id}`;

          results.push({
            type: 'article',
            id: `yt_${yt.id}`.substring(0, 64),
            title: `🎵 ${yt.title}`,
            description: `👤 ${channel} · ⏱ ${dur}`,
            thumbnail_url: yt.thumbnail,
            input_message_content: {
              message_text: `🎬 <b>${escapeHtml(yt.title)}</b>\n👤 ${escapeHtml(channel)} · ⏱ ${escapeHtml(dur)}\n🔗 ${escapeHtml(yt.url)}`,
              parse_mode: 'HTML',
            },
            reply_markup: new InlineKeyboard()
              .url(ctx.t('inline-btn-download', { appName: APP_NAME }), deepLink)
              .primary(),
          });
        }
      }
    } catch (err) {
      logger.warn({ err, query: rawQuery }, 'Inline query search error');
    }

    const promptText = ctx.t('inline-prompt');

    await ctx.answerInlineQuery(results.slice(0, 20), {
      cache_time: 15,
      is_personal: true,
      button:
        rawQuery.length < 2
          ? {
              text: promptText,
              start_parameter: 'search',
            }
          : undefined,
    });
  };
}
