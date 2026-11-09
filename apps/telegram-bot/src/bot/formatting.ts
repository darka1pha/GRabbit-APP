/**
 * Utilities for escaping user-generated and external strings
 * before sending to Telegram Bot API.
 */

import { BOT_USERNAME } from '../config/constants.js';

export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeMarkdown(text: string): string {
  if (!text) return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function renderProgressBar(percent: number, totalBlocks = 10): string {
  const clamped = Math.max(0, Math.min(100, isNaN(percent) ? 0 : percent));
  const filledCount = Math.round((clamped / 100) * totalBlocks);
  const emptyCount = totalBlocks - filledCount;
  return `[${'█'.repeat(filledCount)}${'░'.repeat(emptyCount)}]`;
}

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  instagram: 'Instagram',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
  twitter: 'X (Twitter)',
  reddit: 'Reddit',
};

export function formatPlatformName(platform: string): string {
  return PLATFORM_DISPLAY_NAMES[platform] || platform.toUpperCase();
}

export function truncateLabel(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.substring(0, maxLength).trimEnd()}…` : text;
}

/** Caption attached to delivered media (fresh, cached, history re-send and inline). */
export function buildMediaCaption(
  title: string,
  author: string | undefined,
  format: string,
  botUsername = BOT_USERNAME
): string {
  const icon = format === 'audio' ? '🎵' : '🎬';
  const authorLine = author ? `👤 ${escapeHtml(author)}\n` : '';
  return `${icon} <b>${escapeHtml(title)}</b>\n${authorLine}🤖 Delivered by @${escapeHtml(botUsername)}`;
}

/**
 * Download status card: the media title as a header, then a stage/result body.
 * `bodyHtml` must already be escaped.
 */
export function renderStatusCard(title: string, format: string, bodyHtml: string): string {
  const icon = format === 'audio' ? '🎵' : '🎬';
  return `${icon} <b>${escapeHtml(title)}</b>\n\n${bodyHtml}`;
}

/** Extra admin-only hint for errors an admin can fix (e.g. by refreshing YouTube cookies). */
export function adminHintKeyForError(i18nKey: string): string | undefined {
  if (i18nKey === 'error-bot-verification' || i18nKey === 'error-unauthorized-content') {
    return 'error-hint-admin-cookies';
  }
  return undefined;
}
