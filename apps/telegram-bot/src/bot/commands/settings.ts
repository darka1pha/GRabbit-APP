import { BotContext } from '../context.js';
import { InlineKeyboard } from 'grammy';
import { isAdminUser } from './admin.js';
import { DefaultFormatPreference } from '../../core/types/user.js';
import { escapeHtml } from '../formatting.js';

export function formatPreferenceLabel(
  ctx: BotContext,
  pref: DefaultFormatPreference = 'ask'
): string {
  switch (pref) {
    case 'audio':
      return ctx.t('settings-format-audio');
    case 'video_720p':
      return ctx.t('settings-format-video-720p');
    case 'video_1080p':
      return ctx.t('settings-format-video-1080p');
    default:
      return ctx.t('settings-format-ask');
  }
}

export function buildSettingsView(
  ctx: BotContext,
  overridePref?: DefaultFormatPreference
): { text: string; keyboard: InlineKeyboard } {
  const currentPref: DefaultFormatPreference =
    overridePref || ctx.userRecord?.defaultFormat || 'ask';

  const isVip = ctx.userRecord?.tier === 'vip' || isAdminUser(ctx.from?.id);
  const lines = [
    `<b>${escapeHtml(ctx.t('settings-title'))}</b>`,
    '',
    ctx.t('settings-current-language', { language: ctx.t('language-name') }),
    ctx.t('settings-tier', { tier: ctx.t(isVip ? 'settings-tier-vip' : 'settings-tier-free') }),
    ctx.t('settings-default-format', { format: formatPreferenceLabel(ctx, currentPref) }),
    '',
    ctx.t('settings-format-hint'),
  ];

  const keyboard = new InlineKeyboard();

  const addFormatBtn = (mode: DefaultFormatPreference) => {
    const label = formatPreferenceLabel(ctx, mode);
    const isSelected = currentPref === mode;
    keyboard.text(isSelected ? `✅ ${label}` : label, `pref:fmt:${mode}`);
    if (isSelected) {
      keyboard.success();
    }
  };

  addFormatBtn('ask');
  addFormatBtn('audio');
  keyboard.row();
  addFormatBtn('video_720p');
  addFormatBtn('video_1080p');
  keyboard
    .row()
    .text(ctx.t('settings-btn-change-language'), 'nav:language')
    .primary()
    .row()
    .text(ctx.t('menu-btn-home'), 'menu:home');

  return {
    text: lines.map((line, idx) => (idx === 0 ? line : escapeHtml(line))).join('\n'),
    keyboard,
  };
}

export async function handleSettingsCommand(ctx: BotContext): Promise<void> {
  const { text, keyboard } = buildSettingsView(ctx);

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}
