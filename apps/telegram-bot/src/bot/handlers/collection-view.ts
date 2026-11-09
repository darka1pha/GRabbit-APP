import { InlineKeyboard } from 'grammy';
import { BotContext } from '../context.js';
import { CachedMediaPreview, previewCache } from './preview-cache.js';
import { escapeHtml, formatPlatformName, renderStatusCard } from '../formatting.js';
import { formatDuration } from '../../i18n/locale-resolver.js';
import { createJobProgressKeyboard } from '../keyboards/index.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { ConcurrentJobLimitError } from '../../core/errors/domain-errors.js';
import { enqueueDownload, getJobSlots, newJobId } from './enqueue.js';
import { buildFormatPickerView, singleItemMetadata } from './url-handler.js';

export const COLLECTION_PAGE_SIZE = 8;
const NUMBER_BUTTONS_PER_ROW = 4;

type CollectionEntry = Omit<CachedMediaPreview, 'createdAt'>;

function pendingItems(entry: CollectionEntry) {
  const queued = new Set(entry.queuedIds || []);
  return entry.metadata.items.filter((i) => i.isDownloadable && !queued.has(i.id));
}

/**
 * Album / playlist track picker: a numbered page of tracks, number buttons that open a
 * track, paging, and "Download all as audio" (queued in batches that fit the user's limit).
 */
export function buildCollectionView(
  ctx: BotContext,
  key: string,
  entry: CollectionEntry,
  page: number,
  notice?: string
): { text: string; keyboard: InlineKeyboard } {
  const { metadata } = entry;
  const items = metadata.items;
  const totalPages = Math.max(1, Math.ceil(items.length / COLLECTION_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * COLLECTION_PAGE_SIZE;
  const pageItems = items.slice(start, start + COLLECTION_PAGE_SIZE);
  const queued = new Set(entry.queuedIds || []);

  const lines: string[] = [];
  if (notice) lines.push(escapeHtml(notice), '');
  lines.push(
    `🎶 <b>${escapeHtml(metadata.title)}</b>`,
    escapeHtml(
      ctx.t('collection-meta', {
        author: metadata.artistOrAuthor || formatPlatformName(metadata.platform),
        platform: formatPlatformName(metadata.platform),
        count: items.length,
      })
    ),
    ''
  );

  pageItems.forEach((item, idx) => {
    const number = start + idx + 1;
    const mark = queued.has(item.id) ? '✅ ' : '';
    const duration = item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : '';
    lines.push(`${number}. ${mark}${escapeHtml(item.title)}${duration}`);
  });
  lines.push('', escapeHtml(ctx.t('collection-hint')));

  const keyboard = new InlineKeyboard();
  pageItems.forEach((_, idx) => {
    const index = start + idx;
    keyboard.text(String(index + 1), `col:t:${key}:${index}`);
    if ((idx + 1) % NUMBER_BUTTONS_PER_ROW === 0 || idx === pageItems.length - 1) {
      keyboard.row();
    }
  });

  if (totalPages > 1) {
    if (safePage > 0) keyboard.text('⬅️', `col:p:${key}:${safePage - 1}`);
    keyboard.text(`${safePage + 1}/${totalPages}`, `col:p:${key}:${safePage}`);
    if (safePage < totalPages - 1) keyboard.text('➡️', `col:p:${key}:${safePage + 1}`);
    keyboard.row();
  }

  const remaining = pendingItems(entry).length;
  if (remaining > 0) {
    const label =
      queued.size === 0
        ? ctx.t('collection-btn-all', { count: remaining })
        : ctx.t('collection-btn-next', { count: remaining });
    keyboard.text(label, `col:all:${key}:${safePage}`).success().row();
  }
  keyboard.text(ctx.t('btn-close'), `cancel:preview:${key}`);

  return { text: lines.join('\n'), keyboard };
}

/** Handles col:p (page), col:t (open track) and col:all (download all) callbacks. */
export async function handleCollectionCallback(
  ctx: BotContext,
  data: string,
  jobRepo: JobRepository,
  edit: (text: string, keyboard: InlineKeyboard) => Promise<void>
): Promise<void> {
  const [, action, key, rawArg] = data.split(':');
  const entry = (await previewCache.getAsync(key)) as CollectionEntry | undefined;
  if (!entry) {
    await ctx.editMessageText(ctx.t('error-preview-expired')).catch(() => {});
    return;
  }
  const arg = Number(rawArg) || 0;

  if (action === 'p') {
    const { text, keyboard } = buildCollectionView(ctx, key, entry, arg);
    await edit(text, keyboard);
    return;
  }

  if (action === 't') {
    // Open the track as its own preview message so the list stays usable
    const item = entry.metadata.items[arg];
    if (!item) return;
    const { text, keyboard } = buildFormatPickerView(ctx, singleItemMetadata(entry.metadata, item));
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    return;
  }

  if (action === 'all') {
    const { activeCount, maxConcurrent, isVip } = await getJobSlots(ctx, jobRepo);
    const freeSlots = maxConcurrent - activeCount;
    if (freeSlots <= 0) {
      throw new ConcurrentJobLimitError(maxConcurrent);
    }

    const batch = pendingItems(entry).slice(0, freeSlots);
    let position = activeCount;
    for (const item of batch) {
      position++;
      const jobId = newJobId();
      // Each track gets its own status card with progress and a Cancel button
      const card = await ctx.reply(
        renderStatusCard(
          item.title,
          'audio',
          escapeHtml(ctx.t('download-queued', { position }))
        ),
        { parse_mode: 'HTML', reply_markup: createJobProgressKeyboard(ctx.locale, jobId) }
      );
      await enqueueDownload(ctx, jobRepo, {
        id: jobId,
        platform: entry.metadata.platform,
        url: item.url,
        mediaId: item.id,
        title: item.title,
        format: 'audio',
        qualityId: item.availableOptions.find((o) => o.format === 'audio')?.qualityId || 'bestaudio',
        statusMessageId: card.message_id,
        isVip,
      });
      entry.queuedIds = [...(entry.queuedIds || []), item.id];
    }
    previewCache.set(key, entry);

    const left = pendingItems(entry).length;
    const notice =
      left > 0
        ? ctx.t('collection-queued', { count: batch.length, left, limit: maxConcurrent })
        : ctx.t('collection-all-queued', { count: batch.length });
    const { text, keyboard } = buildCollectionView(ctx, key, entry, arg, notice);
    await edit(text, keyboard);
  }
}
