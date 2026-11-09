import { createWriteStream, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BotContext } from '../context.js';
import { getConfig } from '../../config/env.js';
import { logger } from '../../observability/logger.js';

export interface DownloadedTelegramMedia {
  filePath: string;
  cleanup: () => void;
}

export async function downloadTelegramMediaFile(
  ctx: BotContext,
  fileId: string,
  preferredExt = 'tmp'
): Promise<DownloadedTelegramMedia> {
  const config = getConfig();
  const fileInfo = await ctx.api.getFile(fileId);
  const rawPath = fileInfo.file_path;

  if (!rawPath) {
    throw new Error('Telegram API returned empty file_path for getFile');
  }

  const tempDir = config.TEMP_DIR || './temp';
  const id = randomBytes(4).toString('hex');
  const targetPath = join(tempDir, `tg_media_${id}.${preferredExt}`);

  // 1. Direct local filesystem access (Local Bot API)
  if (existsSync(rawPath)) {
    try {
      copyFileSync(rawPath, targetPath);
      return {
        filePath: targetPath,
        cleanup: () => {
          try {
            if (existsSync(targetPath)) unlinkSync(targetPath);
          } catch {}
        },
      };
    } catch (err) {
      logger.debug({ err, rawPath }, 'Failed direct copy from rawPath, trying mapped/HTTP');
    }
  }

  // 2. Check mapped local volume path
  const relativePath = rawPath
    .replace(/^\/var\/lib\/telegram-bot-api\/[^/]+\//, '')
    .replace(/^\/+/, '');
  const mappedPath = join('/var/lib/telegram-bot-api', config.BOT_TOKEN, relativePath);

  if (existsSync(mappedPath)) {
    try {
      copyFileSync(mappedPath, targetPath);
      return {
        filePath: targetPath,
        cleanup: () => {
          try {
            if (existsSync(targetPath)) unlinkSync(targetPath);
          } catch {}
        },
      };
    } catch {}
  }

  // 3. HTTP Download from TELEGRAM_API_ROOT or official Telegram API
  const apiRoot = (config.TELEGRAM_API_ROOT || 'https://api.telegram.org').replace(/\/$/, '');
  const downloadUrl = `${apiRoot}/file/bot${config.BOT_TOKEN}/${relativePath}`;

  logger.debug({ downloadUrl, targetPath }, 'Downloading Telegram media via HTTP');

  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Telegram media file (HTTP ${response.status})`);
  }

  const fileStream = createWriteStream(targetPath);
  // @ts-ignore Node ReadableStream pipeline compatibility
  await pipeline(response.body, fileStream);

  return {
    filePath: targetPath,
    cleanup: () => {
      try {
        if (existsSync(targetPath)) unlinkSync(targetPath);
      } catch {}
    },
  };
}

