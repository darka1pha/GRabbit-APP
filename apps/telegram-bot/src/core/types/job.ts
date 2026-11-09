import { JobStatus, PlatformId, MediaFormat, SupportedLocale } from '../../config/constants.js';
import { UserTier } from './user.js';

export interface JobRecord {
  id: string;
  userId: number;
  chatId: number;
  statusMessageId?: number;
  platform: PlatformId;
  sourceUrl: string;
  mediaId: string;
  title: string;
  format: MediaFormat;
  qualityId: string;
  localeSnapshot: SupportedLocale;
  status: JobStatus;
  progressPercent: number;
  fileSizeBytes?: number;
  durationSeconds?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface MediaJobPayload {
  jobId: string;
  userId: number;
  chatId: number;
  statusMessageId?: number;
  platform: PlatformId;
  url: string;
  mediaId: string;
  title: string;
  format: MediaFormat;
  qualityId: string;
  locale: SupportedLocale;
  userTier?: UserTier;
}
