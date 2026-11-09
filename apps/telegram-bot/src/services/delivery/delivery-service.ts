import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { existsSync, statSync } from 'node:fs';
import { MediaFormat, SupportedLocale } from '../../config/constants.js';
import { DeliveryError, MediaTooLargeError } from '../../core/errors/domain-errors.js';
import { translate } from '../../i18n/index.js';
import { logger } from '../../observability/logger.js';
import { sanitizeFilename } from '../../security/filename.js';
import { escapeHtml, buildMediaCaption } from '../../bot/formatting.js';
import { getConfig } from '../../config/env.js';

export interface DeliverMediaParams {
  chatId: number;
  filePath: string;
  fileName: string;
  format: MediaFormat;
  title: string;
  performerOrAuthor?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  thumbnailPath?: string;
  locale: SupportedLocale;
  maxSizeBytes?: number;
}

export interface DeliverCachedMediaParams {
  chatId: number;
  telegramFileId: string;
  format: MediaFormat;
  title: string;
  performerOrAuthor?: string;
  locale: SupportedLocale;
}

export class DeliveryService {
  private bot: Bot;

  constructor(bot: Bot) {
    this.bot = bot;
  }

  /** Live @username once the bot is initialized; grammY's botInfo getter throws before that. */
  private get botUsername(): string | undefined {
    try {
      return this.bot.botInfo.username;
    } catch {
      return undefined;
    }
  }

  public async deliverCachedMedia(params: DeliverCachedMediaParams): Promise<void> {
    const caption = buildMediaCaption(
      params.title,
      params.performerOrAuthor,
      params.format,
      this.botUsername
    );

    if (params.format === 'audio') {
      await this.bot.api.sendAudio(params.chatId, params.telegramFileId, {
        caption,
        parse_mode: 'HTML',
        title: params.title,
        performer: params.performerOrAuthor,
      });
    } else if (params.format === 'video') {
      await this.bot.api.sendVideo(params.chatId, params.telegramFileId, {
        caption,
        parse_mode: 'HTML',
        supports_streaming: true,
      });
    } else {
      await this.bot.api.sendDocument(params.chatId, params.telegramFileId, {
        caption,
        parse_mode: 'HTML',
      });
    }
  }

  public async deliverMedia(params: DeliverMediaParams): Promise<{ telegramFileId?: string }> {
    const stats = statSync(params.filePath);
    const config = getConfig();
    const configuredLimitMb = config.TELEGRAM_API_ROOT
      ? config.MAX_FILE_SIZE_MB
      : Math.min(config.MAX_FILE_SIZE_MB, 50);
    const effectiveMaxBytes = params.maxSizeBytes ?? configuredLimitMb * 1024 * 1024;

    if (stats.size > effectiveMaxBytes) {
      throw new MediaTooLargeError(
        Math.round(effectiveMaxBytes / (1024 * 1024)),
        stats.size / (1024 * 1024)
      );
    }

    const safeName = sanitizeFilename(params.fileName);
    const inputFile = new InputFile(params.filePath, safeName);
    const hasThumbnail = Boolean(params.thumbnailPath && existsSync(params.thumbnailPath));

    const caption = buildMediaCaption(
      params.title,
      params.performerOrAuthor,
      params.format,
      this.botUsername
    );

    logger.info(
      {
        chatId: params.chatId,
        format: params.format,
        fileSize: stats.size,
        fileName: safeName,
      },
      'Delivering media file to Telegram user'
    );

    try {
      if (params.format === 'audio') {
        const sent = await this.bot.api.sendAudio(params.chatId, inputFile, {
          caption,
          parse_mode: 'HTML',
          title: params.title,
          performer: params.performerOrAuthor,
          duration: params.durationSeconds ? Math.round(params.durationSeconds) : undefined,
          thumbnail: hasThumbnail ? new InputFile(params.thumbnailPath!) : undefined,
        });
        return { telegramFileId: sent?.audio?.file_id };
      } else if (params.format === 'video') {
        const sent = await this.bot.api.sendVideo(params.chatId, inputFile, {
          caption,
          parse_mode: 'HTML',
          duration: params.durationSeconds ? Math.round(params.durationSeconds) : undefined,
          width: params.width,
          height: params.height,
          supports_streaming: true,
          thumbnail: hasThumbnail ? new InputFile(params.thumbnailPath!) : undefined,
        });
        return { telegramFileId: sent?.video?.file_id };
      } else {
        const sent = await this.bot.api.sendDocument(params.chatId, inputFile, {
          caption,
          parse_mode: 'HTML',
        });
        return { telegramFileId: sent?.document?.file_id };
      }
    } catch (err) {
      if (err instanceof MediaTooLargeError) {
        throw err;
      }
      logger.error({ err, params }, 'Failed to deliver media via Telegram Bot API');
      const msg = (err as Error).message || '';
      if (msg.includes('file is too big') || msg.includes('Request Entity Too Large') || msg.includes('413')) {
        const limitMb = config.TELEGRAM_API_ROOT ? config.MAX_FILE_SIZE_MB : 50;
        throw new MediaTooLargeError(limitMb, Math.round(stats.size / (1024 * 1024)));
      }
      throw new DeliveryError(`Telegram upload failed: ${(err as Error).message}`);
    }
  }

  public async updateJobProgressMessage(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboard
  ): Promise<boolean> {
    try {
      await this.bot.api.editMessageText(chatId, messageId, text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
      return true;
    } catch (err) {
      // Ignore "message is not modified" or rate limit errors on status messages
      logger.debug({ err, chatId, messageId }, 'Failed to edit progress message');
      return String((err as Error)?.message || '').includes('message is not modified');
    }
  }

  public async sendErrorMessage(
    chatId: number,
    locale: SupportedLocale,
    errorKey: string,
    params?: Record<string, string | number>
  ): Promise<void> {
    const text = translate(locale, errorKey, params);
    try {
      await this.bot.api.sendMessage(chatId, escapeHtml(text), { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err, chatId }, 'Failed to send localized error message to user');
    }
  }
}
