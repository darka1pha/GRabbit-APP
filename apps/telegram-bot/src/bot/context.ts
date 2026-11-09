import { Context } from 'grammy';
import { SupportedLocale } from '../config/constants.js';
import { UserRecord } from '../core/types/user.js';

export interface BotContext extends Context {
  userRecord?: UserRecord;
  locale: SupportedLocale;
  t: (key: string, params?: Record<string, string | number>) => string;
}
