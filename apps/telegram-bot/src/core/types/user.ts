import { SupportedLocale } from '../../config/constants.js';

export type UserTier = 'free' | 'vip';
export type DefaultFormatPreference = 'ask' | 'audio' | 'video_720p' | 'video_1080p';

export interface UserRecord {
  id: number; // Telegram User ID
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode: SupportedLocale;
  languageSelected?: boolean;
  isBanned?: boolean;
  tier?: UserTier;
  defaultFormat?: DefaultFormatPreference;
  createdAt: Date;
  updatedAt: Date;
}
