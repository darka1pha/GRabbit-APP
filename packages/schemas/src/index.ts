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


// ---------------------------------------------------------------------------
// Desktop IPC and RPC bridge payloads
//
// Everything that crosses a process or network boundary into the desktop main
// process is parsed with these. Unknown keys are dropped; `null` is treated as
// "not given" so callers that serialise missing values as null keep working.
// ---------------------------------------------------------------------------

/** Optional field that also accepts null. */
const opt = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((v) => v ?? undefined);

const text = (max: number) => z.string().max(max);
const count = z.number().finite().nonnegative();

/** Protocol and host are checked by the URL parser; this only bounds the size. */
export const UrlTextSchema = z.string().trim().min(1).max(8192);
export const IdSchema = z.string().min(1).max(128);
export const IdListSchema = z.array(IdSchema).max(50_000);
export const CategorySchema = z.enum(['video', 'music', 'documents', 'compressed', 'programs', 'images', 'other']);
export const ChecksumAlgorithmSchema = z.enum(['md5', 'sha1', 'sha256', 'sha512']);
export const MoveDirectionSchema = z.enum(['up', 'down', 'top', 'bottom']);
export const HeadersSchema = z
  .record(text(256), text(16_384))
  .refine((h) => Object.keys(h).length <= 64, 'Too many headers');
/** HH:MM, or '' for "not set" (a cleared time field). */
const TimeOfDaySchema = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Expected HH:MM');

export const AddHttpDownloadRequestSchema = z.object({
  url: UrlTextSchema,
  fileName: opt(text(512)),
  directory: opt(text(1024)),
  category: opt(CategorySchema),
  /** Clamped to 1..32 by the download manager. */
  connections: opt(z.number().finite()),
  referrer: opt(text(8192)),
  headers: opt(HeadersSchema),
  speedLimitKBps: opt(count),
  checksum: opt(z.object({ algorithm: ChecksumAlgorithmSchema, expected: opt(text(256)) })),
  startPaused: opt(z.boolean()),
  queueId: opt(IdSchema),
});

export const AddMediaDownloadRequestSchema = z.object({
  url: UrlTextSchema,
  platform: PlatformIdSchema,
  mediaId: text(512),
  format: MediaFormatSchema,
  qualityId: text(64),
  title: text(1024),
  author: opt(text(512)),
  thumbnailUrl: opt(text(8192)),
  durationSeconds: opt(count),
  estimatedSizeBytes: opt(count),
  directory: opt(text(1024)),
  startPaused: opt(z.boolean()),
  queueId: opt(IdSchema),
});

export const WeekdaysSchema = z.array(z.number().int().min(0).max(6)).max(7);

export const QueueSchedulerSchema = z.object({
  enabled: z.boolean(),
  startTime: TimeOfDaySchema,
  stopTime: TimeOfDaySchema,
  days: opt(WeekdaysSchema),
});

/** Fields a caller may set when creating or editing a queue (never `id` or `order`). */
export const QueuePatchSchema = z.object({
  name: opt(text(120)),
  enabled: opt(z.boolean()),
  maxConcurrent: opt(z.number().finite().transform((n) => Math.min(16, Math.max(1, Math.round(n))))),
  scheduler: opt(QueueSchedulerSchema),
  afterQueue: opt(z.enum(['none', 'stopQueue', 'quit', 'sleep', 'shutdown'])),
});

export const FileFiltersSchema = z
  .array(z.object({ name: text(120), extensions: z.array(text(32)).max(64) }))
  .max(32);

/** A settings patch: every field optional, every given field of the right type. */
export const SettingsPatchSchema = z
  .object({
    language: z.enum(['en', 'fa']),
    theme: z.enum(['system', 'light', 'dark']),
    downloadDir: text(1024),
    categorySubfolders: z.boolean(),
    // Numbers are range-checked (and NaN repaired) by the settings service
    maxConcurrent: z.number(),
    defaultConnections: z.number(),
    maxRetries: z.number(),
    globalSpeedLimitKBps: z.number(),
    clipboardMonitor: z.boolean(),
    notifications: z.boolean(),
    closeToTray: z.boolean(),
    resumeOnStartup: z.boolean(),
    startOnBoot: z.boolean(),
    startMinimized: z.boolean(),
    onboarded: z.boolean(),
    globalShortcut: z.object({ enabled: z.boolean(), accelerator: text(120) }).partial(),
    updates: z.object({ autoCheck: z.boolean(), autoDownload: z.boolean() }).partial(),
    userAgent: text(1024),
    proxy: text(2048),
    afterQueue: z.enum(['none', 'quit', 'sleep', 'shutdown']),
    scheduler: z
      .object({ enabled: z.boolean(), startTime: TimeOfDaySchema, stopTime: TimeOfDaySchema, days: WeekdaysSchema })
      .partial(),
    media: z
      .object({
        defaultAudioFormat: z.enum(['mp3', 'm4a']),
        defaultVideoQuality: text(32),
        cookiesFromBrowser: z.enum(['', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium']),
        cookiesFile: text(1024),
        spotifyClientId: text(512),
        spotifyClientSecret: text(512),
        instagramSessionId: text(4096),
      })
      .partial(),
    extension: z
      .object({
        enabled: z.boolean(),
        port: z.number(),
        token: text(512),
        autoCapture: z.boolean(),
        allowLan: z.boolean(),
      })
      .partial(),
  })
  .partial();

export const RpcAddDownloadRequestSchema = z.object({
  url: UrlTextSchema,
  fileName: opt(text(512)),
  category: opt(CategorySchema),
  directory: opt(text(1024)),
  referrer: opt(text(8192)),
  headers: opt(HeadersSchema),
  cookies: opt(text(16_384)),
  userAgent: opt(text(1024)),
  startPaused: opt(z.boolean()),
  format: opt(MediaFormatSchema),
});

/** Items are checked one by one by the bridge, so one bad entry does not sink the batch. */
export const RpcAddBatchRequestSchema = z.object({ items: z.array(z.unknown()).min(1) });

export const RpcUrlRequestSchema = z.object({ url: UrlTextSchema });
export const RpcStreamRequestSchema = z.object({
  url: UrlTextSchema,
  format: opt(MediaFormatSchema),
  qualityId: opt(text(64)),
});
export const RpcExtensionUpdateRequestSchema = z.object({ downloadUrl: UrlTextSchema, version: opt(text(64)) });

/** One line describing the first problem in a failed parse, e.g. `items.0.url: Required`. */
export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export { z, ZodError, type ZodTypeAny } from 'zod';

// ---------------------------------------------------------------------------
// Stored state (downloads.json / queues.json)
//
// Checked when the files are read back: an entry that is damaged or was
// written by something else is dropped instead of crashing the app later.
// Fields these schemas do not know are kept, so newer files stay readable.
// ---------------------------------------------------------------------------

const StoredSegmentSchema = z.object({
  start: count,
  end: z.number().finite().nonnegative().nullable(),
  received: count,
  part: z.string(),
});

export const StoredDownloadItemSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(['http', 'media']),
    url: z.string().min(1),
    fileName: z.string().min(1),
    directory: z.string().min(1),
    category: CategorySchema,
    status: z.enum(['queued', 'starting', 'downloading', 'processing', 'paused', 'completed', 'error']),
    totalBytes: z.number().finite().nonnegative().nullable(),
    receivedBytes: count,
    resumable: z.boolean(),
    connections: z.number().finite(),
    retries: z.number().finite().catch(0),
    createdAt: z.number().finite().catch(0),
    segments: z.array(StoredSegmentSchema).optional(),
    headers: z.record(z.string()).optional(),
    queueId: z.string().optional(),
  })
  .passthrough();

export const StoredQueueSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    enabled: z.boolean(),
    maxConcurrent: z.number().finite().transform((n) => Math.min(16, Math.max(1, Math.round(n)))),
    scheduler: QueueSchedulerSchema.optional().catch(undefined),
    afterQueue: z.enum(['none', 'stopQueue', 'quit', 'sleep', 'shutdown']).optional().catch(undefined),
    order: z.array(z.string()).catch([]),
  })
  .passthrough();
