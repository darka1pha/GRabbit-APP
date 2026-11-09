import { InlineKeyboard } from 'grammy';
import { MediaOption } from '../../core/types/platform.js';
import { translate, formatFileSize } from '../../i18n/index.js';
import { SupportedLocale } from '../../config/constants.js';
import { truncateLabel } from '../formatting.js';

export function createLanguageKeyboard(fromSettings = false): InlineKeyboard {
  const prefix = fromSettings ? 'lang:set:' : 'lang:';
  const kb = new InlineKeyboard()
    .text('🇬🇧 English', `${prefix}en`)
    .primary()
    .text('🇮🇷 فارسی', `${prefix}fa`)
    .success();

  if (fromSettings) {
    kb.row().text('🔙 Back / بازگشت', 'menu:settings');
  }

  return kb;
}

export function createMainMenuKeyboard(
  locale: SupportedLocale,
  isAdmin = false
): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(translate(locale, 'menu-btn-search'), 'menu:search')
    .primary()
    .row()
    .text(translate(locale, 'menu-btn-history'), 'menu:history')
    .success()
    .text(translate(locale, 'menu-btn-status'), 'menu:status')
    .primary()
    .row()
    .text(translate(locale, 'menu-btn-settings'), 'menu:settings')
    .text(translate(locale, 'menu-btn-help'), 'menu:help');

  if (isAdmin) {
    kb.row()
      .text(translate(locale, 'menu-btn-admin'), 'admin:home')
      .danger();
  }

  return kb;
}

export function createHomeButtonKeyboard(locale: SupportedLocale): InlineKeyboard {
  return new InlineKeyboard().text(translate(locale, 'menu-btn-home'), 'menu:home');
}

export function createSearchPromptKeyboard(locale: SupportedLocale): InlineKeyboard {
  return new InlineKeyboard()
    .switchInlineCurrent(translate(locale, 'menu-btn-inline'), '')
    .primary()
    .row()
    .text(translate(locale, 'menu-btn-home'), 'menu:home');
}

export function createFormatSelectionKeyboard(options: {
  locale: SupportedLocale;
  jobKey: string; // cache key for url/metadata
  mediaOptions: MediaOption[];
}): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const audioOptions = options.mediaOptions.filter((o) => o.format === 'audio');
  const videoOptions = options.mediaOptions.filter((o) => o.format !== 'audio');

  for (const opt of audioOptions) {
    const sizeHint =
      opt.estimatedSizeBytes && opt.estimatedSizeBytes > 0
        ? ` (~${formatFileSize(opt.estimatedSizeBytes)})`
        : '';
    const baseLabel = translate(
      options.locale,
      opt.isOriginalQuality ? 'btn-audio-original' : 'btn-audio',
      { ext: opt.extension.toUpperCase() }
    );
    keyboard
      .text(`${baseLabel}${sizeHint}`, `dl:${options.jobKey}:${opt.format}:${opt.qualityId}`)
      .success()
      .row();
  }

  // Render video quality options in a 2-column grid when multiple qualities are available
  const useTwoColumns = videoOptions.length > 2;
  videoOptions.forEach((opt, idx) => {
    const sizeHint =
      opt.estimatedSizeBytes && opt.estimatedSizeBytes > 0
        ? ` (~${formatFileSize(opt.estimatedSizeBytes)})`
        : '';
    const baseLabel = useTwoColumns
      ? `🎬 ${opt.label}`
      : translate(options.locale, 'btn-video', { quality: opt.label });

    keyboard
      .text(`${baseLabel}${sizeHint}`, `dl:${options.jobKey}:${opt.format}:${opt.qualityId}`)
      .primary();

    if (!useTwoColumns || idx % 2 === 1 || idx === videoOptions.length - 1) {
      keyboard.row();
    }
  });

  const cancelLabel = translate(options.locale, 'btn-cancel');
  keyboard.text(cancelLabel, `cancel:preview:${options.jobKey}`).danger();

  return keyboard;
}

export function createJobProgressKeyboard(
  locale: SupportedLocale,
  jobId: string
): InlineKeyboard {
  const cancelLabel = translate(locale, 'btn-cancel');
  return new InlineKeyboard().text(cancelLabel, `cancel:job:${jobId}`).danger();
}

/**
 * Active-downloads list: one cancel button per job (cancel:list re-renders this list),
 * followed by Refresh and Main menu.
 */
export function createCancelJobKeyboard(
  locale: SupportedLocale,
  jobs: { id: string; title: string }[]
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const j of jobs) {
    keyboard.text(`❌ ${truncateLabel(j.title, 28)}`, `cancel:list:${j.id}`).danger().row();
  }
  if (jobs.length > 0) {
    keyboard.text(translate(locale, 'menu-btn-refresh'), 'menu:status');
  }
  keyboard.text(translate(locale, 'menu-btn-home'), 'menu:home');
  return keyboard;
}
