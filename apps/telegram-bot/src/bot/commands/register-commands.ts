import { Bot } from 'grammy';
import { BotContext } from '../context.js';
import { getConfig } from '../../config/env.js';
import { logger } from '../../observability/logger.js';

export async function registerBotCommands(bot: Bot<BotContext>): Promise<void> {
  const enCommands = [
    { command: 'start', description: 'Main menu' },
    { command: 'search', description: 'Search music and videos' },
    { command: 'dl', description: 'Download a link (or reply to one)' },
    { command: 'history', description: 'Your recent downloads' },
    { command: 'status', description: 'Downloads in progress' },
    { command: 'cancel', description: 'Cancel a download' },
    { command: 'settings', description: 'Language and default format' },
    { command: 'language', description: 'Change language' },
    { command: 'help', description: 'How to use the bot' },
    { command: 'about', description: 'About this bot' },
  ];

  const faCommands = [
    { command: 'start', description: 'منوی اصلی' },
    { command: 'search', description: 'جستجوی آهنگ و ویدیو' },
    { command: 'dl', description: 'دانلود لینک (یا پاسخ به پیام لینک‌دار)' },
    { command: 'history', description: 'دانلودهای اخیر' },
    { command: 'status', description: 'دانلودهای در حال انجام' },
    { command: 'cancel', description: 'لغو دانلود' },
    { command: 'settings', description: 'زبان و فرمت پیش‌فرض' },
    { command: 'language', description: 'تغییر زبان' },
    { command: 'help', description: 'راهنمای استفاده' },
    { command: 'about', description: 'درباره ربات' },
  ];

  const adminExtraCommands = [
    { command: 'admin', description: '🛡️ Open Admin Control Panel' },
    { command: 'stats', description: '📊 View System Statistics' },
  ];

  try {
    // 1. Default command menu (English)
    await bot.api.setMyCommands(enCommands);

    // 2. Localized Persian command menu
    await bot.api.setMyCommands(faCommands, { language_code: 'fa' });

    // 3. Scoped admin command menu for each configured admin user
    const config = getConfig();
    for (const adminId of config.ADMIN_USER_IDS) {
      await bot.api
        .setMyCommands([...enCommands, ...adminExtraCommands], {
          scope: { type: 'chat', chat_id: adminId },
        })
        .catch(() => {});
    }

    logger.info('Registered scoped Telegram bot command menus');
  } catch (err) {
    logger.warn({ err }, 'Failed to register Telegram bot command menus');
  }
}
