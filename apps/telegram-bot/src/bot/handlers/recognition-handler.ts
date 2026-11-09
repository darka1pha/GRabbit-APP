import { InlineKeyboard } from 'grammy';
import { randomBytes } from 'node:crypto';
import { BotContext } from '../context.js';
import { MusicRecognizer, RecognizedTrack } from '../../services/recognition/music-recognizer.js';
import { downloadTelegramMediaFile } from './telegram-file-downloader.js';
import { YtDlpRunner } from '../../services/downloads/ytdlp-runner.js';
import { previewCache } from './preview-cache.js';
import { PLATFORMS } from '../../config/constants.js';
import {
  getStandardYouTubeMediaOptions,
  getYouTubeYtDlpExtraArgs,
} from '../../platforms/youtube/youtube-adapter.js';
import { escapeHtml } from '../formatting.js';
import { logger } from '../../observability/logger.js';
import { extractUrlFromText } from '../../platforms/url-parser.js';
import { processMediaUrl } from './url-handler.js';
import { PlatformRouter } from '../../platforms/platform-router.js';
import { JobRepository } from '../../database/repositories/job-repository.js';

export function createMusicRecognitionHandler(
  musicRecognizer?: MusicRecognizer,
  ytdlpRunner?: YtDlpRunner,
  router?: PlatformRouter,
  jobRepo?: JobRepository
) {
  const recognizer = musicRecognizer || new MusicRecognizer();
  const ytdlp = ytdlpRunner || new YtDlpRunner();

  return async (ctx: BotContext): Promise<void> => {
    const msg = ctx.message;
    if (!msg || !ctx.chat) return;

    // 0. If user sent a media file with a URL in the caption, prioritize downloading the link
    const captionUrl = extractUrlFromText(msg.caption);
    if (captionUrl) {
      await processMediaUrl(ctx, captionUrl, router, jobRepo);
      return;
    }

    // 1. Identify incoming media payload
    let fileId: string | undefined;
    let fileSize: number | undefined;
    let preferredExt = 'tmp';

    if (msg.voice) {
      fileId = msg.voice.file_id;
      fileSize = msg.voice.file_size;
      preferredExt = 'ogg';
    } else if (msg.video_note) {
      fileId = msg.video_note.file_id;
      fileSize = msg.video_note.file_size;
      preferredExt = 'mp4';
    } else if (msg.audio) {
      fileId = msg.audio.file_id;
      fileSize = msg.audio.file_size;
      preferredExt = 'mp3';
    } else if (msg.video) {
      fileId = msg.video.file_id;
      fileSize = msg.video.file_size;
      preferredExt = 'mp4';
    } else if (msg.document) {
      const mime = msg.document.mime_type?.toLowerCase() || '';
      if (mime.startsWith('audio/') || mime.startsWith('video/')) {
        fileId = msg.document.file_id;
        fileSize = msg.document.file_size;
        preferredExt = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'mp3';
      }
    }

    if (!fileId) return;

    // Check size limit: 25MB max for audio recognition
    const MAX_RECOGNITION_BYTES = 25 * 1024 * 1024;
    if (fileSize && fileSize > MAX_RECOGNITION_BYTES) {
      await ctx.reply(ctx.t('recognition-error-too-large'), {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    const waitMsg = await ctx.reply(ctx.t('recognition-identifying'), {
      reply_to_message_id: msg.message_id,
    });

    try {
      // 2. Download media file from Telegram
      const { filePath, cleanup } = await downloadTelegramMediaFile(ctx, fileId, preferredExt);

      let recognized: RecognizedTrack | null = null;
      try {
        recognized = await recognizer.identifyMedia(filePath, {
          locale: ctx.locale === 'fa' ? 'fa' : 'en-US',
        });
      } finally {
        cleanup();
      }

      if (!recognized) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          waitMsg.message_id,
          ctx.t('recognition-no-match')
        );
        return;
      }

      // 3. Track was recognized! Find top YouTube match for one-tap downloading
      const searchTerms = `${recognized.title} ${recognized.artist}`;
      let topYtMatch: any = null;

      try {
        const ytResults = await ytdlp.search(searchTerms, 1, getYouTubeYtDlpExtraArgs());
        if (ytResults && ytResults.length > 0) {
          topYtMatch = ytResults[0];
        }
      } catch (searchErr) {
        logger.debug({ searchErr, searchTerms }, 'YouTube search fallback during recognition');
      }

      // Build metadata card text
      const lines: string[] = [
        ctx.t('recognition-found-title', { title: escapeHtml(recognized.title) }),
        ctx.t('recognition-artist', { artist: escapeHtml(recognized.artist) }),
      ];

      if (recognized.album) {
        lines.push(ctx.t('recognition-album', { album: escapeHtml(recognized.album) }));
      }
      if (recognized.genre) {
        lines.push(ctx.t('recognition-genre', { genre: escapeHtml(recognized.genre) }));
      }
      if (recognized.releaseYear) {
        lines.push(ctx.t('recognition-released', { year: escapeHtml(recognized.releaseYear) }));
      }

      const keyboard = new InlineKeyboard();

      // If YouTube match found, wire one-tap download buttons through previewCache
      if (topYtMatch) {
        const cacheKey = randomBytes(5).toString('hex');
        previewCache.set(cacheKey, {
          url: topYtMatch.url,
          platform: PLATFORMS.YOUTUBE,
          ownerId: ctx.from?.id,
          metadata: {
            platform: PLATFORMS.YOUTUBE,
            url: topYtMatch.url,
            title: recognized.title,
            artistOrAuthor: recognized.artist,
            durationSeconds: topYtMatch.duration,
            thumbnailUrl: recognized.coverArtUrl || topYtMatch.thumbnail,
            isAuthorized: true,
            items: [
              {
                id: topYtMatch.id,
                title: `${recognized.title} - ${recognized.artist}`,
                uploader: recognized.artist,
                durationSeconds: topYtMatch.duration,
                thumbnailUrl: recognized.coverArtUrl || topYtMatch.thumbnail,
                platform: PLATFORMS.YOUTUBE,
                url: topYtMatch.url,
                isDownloadable: true,
                availableOptions: getStandardYouTubeMediaOptions(),
              },
            ],
          },
        });

        keyboard
          .text(ctx.t('recognition-btn-mp3'), `srch:audio:${cacheKey}`)
          .success()
          .text(ctx.t('recognition-btn-video'), `srch:video:${cacheKey}`)
          .primary()
          .row();
      }

      // Streaming links
      let hasLink = false;
      if (recognized.appleMusicUrl) {
        keyboard.url(ctx.t('recognition-btn-listen-apple'), recognized.appleMusicUrl);
        hasLink = true;
      }
      if (recognized.shazamUrl) {
        keyboard.url(ctx.t('recognition-btn-listen-shazam'), recognized.shazamUrl);
        hasLink = true;
      }
      if (hasLink) {
        keyboard.row();
      }

      // Search other versions
      keyboard.switchInlineCurrent(
        ctx.t('recognition-btn-search'),
        `${recognized.title} ${recognized.artist}`
      );

      const caption = lines.join('\n');

      // Send result: If cover art is available, send as photo; otherwise edit text message
      if (recognized.coverArtUrl) {
        try {
          await ctx.replyWithPhoto(recognized.coverArtUrl, {
            caption,
            parse_mode: 'HTML',
            reply_markup: keyboard,
            reply_to_message_id: msg.message_id,
          });
          await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
          return;
        } catch (photoErr) {
          logger.debug({ photoErr }, 'Failed to send recognition photo, falling back to text edit');
        }
      }

      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, caption, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error({ err }, 'Error in media recognition handler');
      await ctx.api
        .editMessageText(ctx.chat.id, waitMsg.message_id, ctx.t('recognition-error-generic'))
        .catch(() => {});
    }
  };
}
