import type { Language } from '../shared/types';

/** Text shown by the main process: notifications, tray menu and dialogs. */
const en = {
  'notify.complete': 'Download complete',
  'notify.checksumMismatch': 'Checksum mismatch',
  'notify.failed': 'Download failed',
  'notify.addedRemote': 'Download added from browser / mobile',
  'notify.mediaLinkCopied': 'Media link copied',
  'notify.fileLinkCopied': 'Download link copied',
  'notify.clickToGrab': 'Click to grab it with GRabbit.',
  'tray.open': 'Open GRabbit',
  'tray.pill': 'Quick Grab Pill',
  'tray.grab': 'Grab media…',
  'tray.downloads': 'Downloads',
  'tray.resumeAll': 'Resume all',
  'tray.pauseAll': 'Pause all',
  'tray.quit': 'Quit',
  'tray.active': 'GRabbit: {count} active',
  'after.title': 'Downloads finished',
  'after.sleep': 'All downloads finished. The PC will go to sleep in {seconds} seconds.',
  'after.shutdown': 'All downloads finished. Windows will shut down in {seconds} seconds.',
  'after.cancel': 'Cancel',
  'after.sleepNow': 'Sleep now',
  'after.shutdownNow': 'Shut down now',
};

export type MainMessageKey = keyof typeof en;

const fa: Record<MainMessageKey, string> = {
  'notify.complete': 'دانلود کامل شد',
  'notify.checksumMismatch': 'چک‌سام مطابقت ندارد',
  'notify.failed': 'دانلود ناموفق بود',
  'notify.addedRemote': 'دانلود از مرورگر / موبایل اضافه شد',
  'notify.mediaLinkCopied': 'لینک رسانه کپی شد',
  'notify.fileLinkCopied': 'لینک دانلود کپی شد',
  'notify.clickToGrab': 'برای دریافت با GRabbit کلیک کنید.',
  'tray.open': 'باز کردن GRabbit',
  'tray.pill': 'دریافت سریع',
  'tray.grab': 'دریافت رسانه…',
  'tray.downloads': 'دانلودها',
  'tray.resumeAll': 'ادامهٔ همه',
  'tray.pauseAll': 'توقف همه',
  'tray.quit': 'خروج',
  'tray.active': 'GRabbit: {count} دانلود فعال',
  'after.title': 'دانلودها تمام شد',
  'after.sleep': 'همهٔ دانلودها تمام شد. رایانه تا {seconds} ثانیهٔ دیگر به حالت خواب می‌رود.',
  'after.shutdown': 'همهٔ دانلودها تمام شد. ویندوز تا {seconds} ثانیهٔ دیگر خاموش می‌شود.',
  'after.cancel': 'لغو',
  'after.sleepNow': 'اکنون بخواب',
  'after.shutdownNow': 'اکنون خاموش کن',
};

const tables: Record<Language, Record<MainMessageKey, string>> = { en, fa };

export function mainText(language: Language, key: MainMessageKey, params: Record<string, string | number> = {}): string {
  const template = (tables[language] ?? en)[key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
