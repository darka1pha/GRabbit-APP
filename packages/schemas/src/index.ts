import { z } from 'zod';

export const PlatformIdSchema = z.enum([
  'youtube',
  'spotify',
  'instagram',
  'soundcloud',
  'tiktok',
  'twitter',
  'reddit',
  'generic',
]);

export const MediaFormatSchema = z.enum(['audio', 'video']);

export const MediaOptionSchema = z.object({
  format: MediaFormatSchema,
  qualityId: z.string(),
  label: z.string(),
  extension: z.string(),
  estimatedSizeBytes: z.number().optional(),
  isOriginalQuality: z.boolean().optional(),
});

export const MediaItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  uploader: z.string().optional(),
  durationSeconds: z.number().optional(),
  thumbnailUrl: z.string().url().optional(),
  platform: PlatformIdSchema,
  url: z.string().url(),
  description: z.string().optional(),
  isDownloadable: z.boolean(),
  unavailableReason: z.string().optional(),
  availableOptions: z.array(MediaOptionSchema),
});

export const DownloadRequestSchema = z.object({
  url: z.string().url(),
  format: MediaFormatSchema,
  qualityId: z.string().optional(),
  customFilename: z.string().optional(),
  downloadPath: z.string().optional(),
  segments: z.number().int().min(1).max(32).default(8),
});

export const AppConfigSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  language: z.enum(['en', 'fa']).default('en'),
  downloadDirectory: z.string(),
  maxConcurrentDownloads: z.number().int().min(1).max(10).default(3),
  maxSegmentsPerDownload: z.number().int().min(1).max(32).default(8),
  autoStartDownloads: z.boolean().default(true),
  speedLimitBytesPerSec: z.number().int().positive().optional(),
});

export type DownloadRequestInput = z.infer<typeof DownloadRequestSchema>;
export type AppConfigInput = z.infer<typeof AppConfigSchema>;

