import { InlineKeyboard } from 'grammy';
import { randomBytes } from 'node:crypto';
import { BotContext } from '../context.js';
import { YtDlpRunner } from '../../services/downloads/ytdlp-runner.js';
import { CachedMediaPreview, previewCache } from '../handlers/preview-cache.js';
import { formatDuration } from '../../i18n/locale-resolver.js';
import { escapeHtml } from '../formatting.js';
import { PLATFORMS } from '../../config/constants.js';
import { MediaItem } from '../../core/types/platform.js';
import {
  getStandardYouTubeMediaOptions,
  getYouTubeYtDlpExtraArgs,
} from '../../platforms/youtube/youtube-adapter.js';

export const SEARCH_PAGE_SIZE = 5;
export const SEARCH_MAX_RESULTS = 15;

/**
 * One page of search results. `session` holds every result (metadata.items) plus the
 * per-result preview keys used by the 🎵/🎬 buttons; paging uses sp:<sessionKey>:<page>.
 */
export function buildSearchResultsView(
  ctx: BotContext,
  sessionKey: string,
  session: CachedMediaPreview,
  page: number
): { text: string; keyboard: InlineKeyboard } {
  const items = session.metadata.items;
  const itemKeys = session.itemKeys || [];
  const totalPages = Math.max(1, Math.ceil(items.length / SEARCH_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * SEARCH_PAGE_SIZE;

  const header = escapeHtml(ctx.t('search-results-title', { query: session.query || '' }));
  const lines: string[] = [`<b>${header}</b>`, ''];
  const keyboard = new InlineKeyboard();

  items.slice(start, start + SEARCH_PAGE_SIZE).forEach((item, offset) => {
    const idx = start + offset + 1;
    const channel = item.uploader || 'YouTube';
    const dur = formatDuration(item.durationSeconds);
    lines.push(
      `${idx}. <b>${escapeHtml(item.title)}</b>\n   👤 ${escapeHtml(channel)} · ⏱ ${escapeHtml(dur)}`
    );

    // Titles are listed in the message body, so buttons only need the result number
    const cacheKey = itemKeys[start + offset];
    keyboard
      .text(ctx.t('search-btn-audio', { index: idx }), `srch:audio:${cacheKey}`)
      .success()
      .text(ctx.t('search-btn-video', { index: idx }), `srch:video:${cacheKey}`)
      .primary()
      .row();
  });

  lines.push('', escapeHtml(ctx.t('search-results-hint')));

  if (totalPages > 1) {
    if (safePage > 0) keyboard.text('⬅️', `sp:${sessionKey}:${safePage - 1}`);
    keyboard.text(`${safePage + 1}/${totalPages}`, `sp:${sessionKey}:${safePage}`);
    if (safePage < totalPages - 1) {
      keyboard.text(ctx.t('search-btn-more'), `sp:${sessionKey}:${safePage + 1}`);
    }
    keyboard.row();
  }
  keyboard.text(ctx.t('btn-close'), `cancel:preview:${sessionKey}`);

  return { text: lines.join('\n'), keyboard };
}

export async function executeSearchQuery(
  ctx: BotContext,
  rawQuery: string,
  ytdlpRunner?: YtDlpRunner
): Promise<void> {
  const query = rawQuery.trim();
  if (!query || !ctx.chat) {
    await ctx.reply(ctx.t('search-usage'));
    return;
  }

  const waitMsg = await ctx.reply(ctx.t('searching-query', { query }));
  const ytdlp = ytdlpRunner || new YtDlpRunner();

  try {
    const results = await ytdlp.search(query, SEARCH_MAX_RESULTS, getYouTubeYtDlpExtraArgs());

    if (results.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        ctx.t('search-no-results', { query })
      );
      return;
    }

    const ownerId = ctx.from?.id;
    const items: MediaItem[] = [];
    const itemKeys: string[] = [];

    for (const result of results) {
      const item: MediaItem = {
        id: result.id,
        title: result.title,
        uploader: result.channel,
        durationSeconds: result.duration,
        thumbnailUrl: result.thumbnail,
        platform: PLATFORMS.YOUTUBE,
        url: result.url,
        isDownloadable: true,
        availableOptions: getStandardYouTubeMediaOptions(),
      };
      items.push(item);

      const cacheKey = randomBytes(5).toString('hex');
      itemKeys.push(cacheKey);
      previewCache.set(cacheKey, {
        url: result.url,
        platform: PLATFORMS.YOUTUBE,
        ownerId,
        metadata: {
          platform: PLATFORMS.YOUTUBE,
          url: result.url,
          title: result.title,
          artistOrAuthor: result.channel || 'YouTube',
          durationSeconds: result.duration,
          thumbnailUrl: result.thumbnail,
          isAuthorized: true,
          items: [item],
        },
      });
    }

    const sessionKey = randomBytes(5).toString('hex');
    const session: CachedMediaPreview = {
      url: '',
      platform: PLATFORMS.YOUTUBE,
      ownerId,
      query,
      itemKeys,
      createdAt: Date.now(),
      metadata: {
        platform: PLATFORMS.YOUTUBE,
        url: '',
        title: query,
        isAuthorized: true,
        items,
      },
    };
    previewCache.set(sessionKey, session);

    const { text, keyboard } = buildSearchResultsView(ctx, sessionKey, session, 0);
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    throw err;
  }
}

export function createSearchCommandHandler(ytdlpRunner?: YtDlpRunner) {
  return async (ctx: BotContext): Promise<void> => {
    const rawText = ctx.message?.text || '';
    const query = rawText.replace(/^\/search(@\S+)?\s*/i, '').trim();
    if (!query) {
      await ctx.reply(ctx.t('search-usage'));
      return;
    }
    await executeSearchQuery(ctx, query, ytdlpRunner);
  };
}
