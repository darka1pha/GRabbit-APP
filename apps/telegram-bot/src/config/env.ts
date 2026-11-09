import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './constants.js';

const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

// Load .env files (.env and .env.local)
loadDotenv({ quiet: true });
loadDotenv({ path: '.env.local', override: true, quiet: true });

if (isTestEnv) {
  process.env.NODE_ENV = 'test';
}

// Auto-reconcile DATABASE_URL if POSTGRES_PASSWORD is provided
if (
  process.env.POSTGRES_PASSWORD &&
  (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('postgres:postgres@'))
) {
  const user = encodeURIComponent(process.env.POSTGRES_USER || 'postgres');
  const pass = encodeURIComponent(process.env.POSTGRES_PASSWORD);
  const db = process.env.POSTGRES_DB || 'grabbit';

  if (process.env.DATABASE_URL) {
    try {
      const parsedDbUrl = new URL(process.env.DATABASE_URL);
      parsedDbUrl.username = user;
      parsedDbUrl.password = pass;
      if (process.env.POSTGRES_DB) {
        parsedDbUrl.pathname = `/${db}`;
      }
      process.env.DATABASE_URL = parsedDbUrl.toString();
    } catch {
      process.env.DATABASE_URL = `postgresql://${user}:${pass}@localhost:54320/${db}`;
    }
  } else {
    process.env.DATABASE_URL = `postgresql://${user}:${pass}@localhost:54320/${db}`;
  }
}

// Auto-resolve Docker service hostname for TELEGRAM_API_ROOT when running directly on host
if (
  process.env.TELEGRAM_API_ROOT &&
  process.env.TELEGRAM_API_ROOT.includes('telegram-bot-api') &&
  !existsSync('/.dockerenv')
) {
  process.env.TELEGRAM_API_ROOT = process.env.TELEGRAM_API_ROOT.replace(
    'telegram-bot-api:8081',
    'localhost:18081'
  ).replace('telegram-bot-api', 'localhost');
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_TOKEN:
    process.env.NODE_ENV === 'test'
      ? z.string().default('123456:TEST_TOKEN')
      : z.string().min(1, 'Telegram BOT_TOKEN is required'),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://postgres:postgres@localhost:5432/grabbit'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  DEFAULT_LANGUAGE: z
    .enum(SUPPORTED_LOCALES)
    .default(DEFAULT_LOCALE),
  SUPPORTED_LANGUAGES: z
    .string()
    .default('en,fa')
    .transform((val) => val.split(',').map((s) => s.trim())),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(2000),
  MAX_MEDIA_DURATION_SECONDS: z.coerce.number().positive().default(3600),
  MAX_CONCURRENT_JOBS_PER_USER: z.coerce.number().int().positive().default(2),
  VIP_MAX_FILE_SIZE_MB: z.coerce.number().positive().default(2000),
  VIP_MAX_MEDIA_DURATION_SECONDS: z.coerce.number().positive().default(7200),
  VIP_MAX_CONCURRENT_JOBS_PER_USER: z.coerce.number().int().positive().default(5),
  MAX_GLOBAL_WORKERS: z.coerce.number().int().positive().default(5),
  JOB_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(600),
  TEMP_DIR: z.string().default('./temp'),
  TEMP_FILE_TTL_MINUTES: z.coerce.number().positive().default(30),
  REQUIRED_CHANNEL: z.string().optional(),
  ADMIN_USER_IDS: z
    .string()
    .optional()
    .default('')
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => !isNaN(n))
        : []
    ),
  YTDLP_PATH: z.string().default('yt-dlp'),
  YTDLP_PROXY: z.string().optional(),
  // 'default' lets yt-dlp pick its maintained client set; forcing 'tv' first returns DRM-only formats for many videos
  YTDLP_YOUTUBE_CLIENTS: z.string().default('default'),
  YTDLP_FORCE_IPV4: z.coerce.boolean().default(true),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  INSTAGRAM_SESSION_ID: z.string().optional(),
  YOUTUBE_COOKIES_FILE: z.string().optional(),
  TELEGRAM_API_ROOT: z.string().optional(),
  TELEGRAM_API_ID: z.string().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let parsedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (parsedConfig) {
    return parsedConfig;
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:', result.error.format());
    throw new Error('Invalid environment configuration');
  }

  parsedConfig = result.data;
  return parsedConfig;
}

export function resetConfigForTesting(): void {
  parsedConfig = null;
}
