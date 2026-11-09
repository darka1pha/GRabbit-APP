export const APP_NAME = 'g(Rabbit)';
export const APP_SLOGAN = 'Drop a link. Grab the goods.';
/** Fallback @username for captions/deep links when the live bot info isn't available. */
export const BOT_USERNAME = 'gRabbit_robot';

export const SUPPORTED_LOCALES = ['en', 'fa'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const PLATFORMS = {
  YOUTUBE: 'youtube',
  SPOTIFY: 'spotify',
  INSTAGRAM: 'instagram',
  SOUNDCLOUD: 'soundcloud',
  TIKTOK: 'tiktok',
  TWITTER: 'twitter',
  REDDIT: 'reddit',
} as const;

export type PlatformId = (typeof PLATFORMS)[keyof typeof PLATFORMS];

export const JOB_STATUSES = {
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  UPLOADING: 'uploading',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type JobStatus = (typeof JOB_STATUSES)[keyof typeof JOB_STATUSES];

export const MEDIA_FORMATS = {
  AUDIO: 'audio',
  VIDEO: 'video',
} as const;

export type MediaFormat = (typeof MEDIA_FORMATS)[keyof typeof MEDIA_FORMATS];

export const QUEUE_NAMES = {
  MEDIA_PROCESSING: 'media-processing',
} as const;

/** Max tracks listed from an album / playlist / set. */
export const COLLECTION_MAX_ITEMS = 50;

// Telegram standard Bot API limits (up to 2000MB / 2GB)
export const TELEGRAM_MAX_FILE_SIZE_BYTES = 2000 * 1024 * 1024; // 2000MB

