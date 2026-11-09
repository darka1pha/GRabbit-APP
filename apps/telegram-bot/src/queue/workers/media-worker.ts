import { Worker, Job, UnrecoverableError } from 'bullmq';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Bot, InlineKeyboard } from 'grammy';
import { QUEUE_NAMES, TELEGRAM_MAX_FILE_SIZE_BYTES } from '../../config/constants.js';
import { getConfig } from '../../config/env.js';
import { MediaJobPayload } from '../../core/types/job.js';
import {
  DownloadError,
  MediaDurationExceededError,
  MediaTooLargeError,
  MediaUnavailableError,
  UnauthorizedContentError,
  JobCancelledError,
  AppError,
} from '../../core/errors/domain-errors.js';
import { JobRepository } from '../../database/repositories/job-repository.js';
import { MediaCacheRepository } from '../../database/repositories/media-cache-repository.js';
import { translate, formatFileSize } from '../../i18n/index.js';
import { logger } from '../../observability/logger.js';
import { PlatformRouter } from '../../platforms/platform-router.js';
import { DeliveryService } from '../../services/delivery/delivery-service.js';
import { FFmpegRunner } from '../../services/media/ffmpeg-runner.js';
import { FFprobeRunner, MediaProbeInfo } from '../../services/media/ffprobe-runner.js';
import { TempStorageManager } from '../../services/temp-storage/temp-storage-manager.js';
import { getRedisConnection } from '../redis.js';
import {
  escapeHtml,
  renderProgressBar,
  renderStatusCard,
  adminHintKeyForError,
} from '../../bot/formatting.js';
import { createJobProgressKeyboard } from '../../bot/keyboards/index.js';
import { DownloadProgress } from '../../core/types/platform.js';

export class MediaProcessingWorker {
  private static activeAbortControllers = new Map<string, AbortController>();

  public static abortJob(jobId: string): boolean {
    const controller = MediaProcessingWorker.activeAbortControllers.get(jobId);
    if (controller) {
      controller.abort();
      MediaProcessingWorker.activeAbortControllers.delete(jobId);
      return true;
    }
    return false;
  }

  private worker: Worker<MediaJobPayload> | null = null;
  private jobRepo: JobRepository;
  private mediaCacheRepo?: MediaCacheRepository;
  private router: PlatformRouter;
  private tempStorage: TempStorageManager;
  private ffprobe: FFprobeRunner;
  private ffmpeg: FFmpegRunner;
  private delivery: DeliveryService;

  constructor(options: {
    bot: Bot;
    jobRepo?: JobRepository;
    mediaCacheRepo?: MediaCacheRepository;
    platformRouter?: PlatformRouter;
    tempStorage?: TempStorageManager;
    ffprobe?: FFprobeRunner;
    ffmpeg?: FFmpegRunner;
    deliveryService?: DeliveryService;
  }) {
    this.jobRepo = options.jobRepo || new JobRepository();
    this.mediaCacheRepo =
      options.mediaCacheRepo ||
      (process.env.NODE_ENV !== 'test' ? new MediaCacheRepository() : undefined);
    this.router = options.platformRouter || new PlatformRouter();
    this.tempStorage = options.tempStorage || new TempStorageManager();
    this.ffprobe = options.ffprobe || new FFprobeRunner();
    this.ffmpeg = options.ffmpeg || new FFmpegRunner();
    this.delivery = options.deliveryService || new DeliveryService(options.bot);
  }

  public start(): Worker<MediaJobPayload> {
    if (this.worker) return this.worker;

    const redis = getRedisConnection();
    const config = getConfig();

    this.worker = new Worker<MediaJobPayload>(
      QUEUE_NAMES.MEDIA_PROCESSING,
      async (job: Job<MediaJobPayload>) => {
        await this.processJob(job);
      },
      {
        connection: redis,
        concurrency: config.MAX_GLOBAL_WORKERS,
      }
    );

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err }, 'Worker reported job failure');
    });

    this.worker.on('error', (err) => {
      logger.error({ err }, 'Worker system error');
    });

    logger.info({ concurrency: config.MAX_GLOBAL_WORKERS }, 'Media processing worker started');
    return this.worker;
  }

  private async ensureNotCancelled(jobId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new JobCancelledError(jobId);
    }
    const existing = await this.jobRepo.getJob?.(jobId);
    if (existing?.status === 'cancelled') {
      throw new JobCancelledError(jobId);
    }
  }

  public async processJob(job: Job<MediaJobPayload>): Promise<void> {
    const payload = job.data;
    const config = getConfig();
    const jobDir = this.tempStorage.createJobDirectory(payload.jobId);
    const abortController = new AbortController();
    MediaProcessingWorker.activeAbortControllers.set(payload.jobId, abortController);

    logger.info({ jobId: payload.jobId, url: payload.url }, 'Starting job execution in worker');

    try {
      await this.ensureNotCancelled(payload.jobId, abortController.signal);

      // 0. Check Telegram file_id cache for instant <0.5s delivery
      if (this.mediaCacheRepo && this.delivery.deliverCachedMedia) {
        try {
          const cached = await this.mediaCacheRepo.getCachedMedia(
            payload.platform,
            payload.mediaId,
            payload.format,
            payload.qualityId
          );

          if (cached?.telegramFileId) {
            logger.info(
              { jobId: payload.jobId, mediaId: payload.mediaId },
              'Cache hit! Delivering media instantly via cached Telegram file_id'
            );

            await this.delivery.deliverCachedMedia({
              chatId: payload.chatId,
              telegramFileId: cached.telegramFileId,
              format: payload.format,
              title: payload.title,
              performerOrAuthor: cached.author,
              locale: payload.locale,
            });

            await this.jobRepo.updateJobStatus(payload.jobId, 'completed', {
              progressPercent: 100,
              fileSizeBytes: cached.fileSizeBytes,
              durationSeconds: cached.durationSeconds,
            });

            await this.updateStatusCard(
              payload,
              escapeHtml(translate(payload.locale, 'download-completed-instant'))
            );
            return;
          }
        } catch (cacheErr) {
          logger.warn(
            { cacheErr, jobId: payload.jobId },
            'Cached file_id delivery failed, falling back to fresh download'
          );
        }
      }

      // 1. Update status to PROCESSING
      await this.jobRepo.updateJobStatus(payload.jobId, 'processing', {
        progressPercent: 0,
      });

      const progressKeyboard = createJobProgressKeyboard(payload.locale, payload.jobId);

      await this.updateStatusCard(
        payload,
        this.renderStageBody(payload, 'download-stage-downloading', 0),
        progressKeyboard
      );

      // 2. Resolve adapter & download
      const adapter = this.router.getAdapterByPlatform(payload.platform);
      if (!adapter || !adapter.download) {
        throw new DownloadError(`Platform ${payload.platform} does not support downloads`);
      }

      let lastEditTime = 0;
      let lastCancelCheckTime = 0;
      let lastReportedPercent = -1;

      const onProgress = async (prog: DownloadProgress) => {
        const now = Date.now();

        if (now - lastCancelCheckTime > 3000) {
          lastCancelCheckTime = now;
          const current = await this.jobRepo.getJob?.(payload.jobId).catch(() => null);
          if (current?.status === 'cancelled') {
            abortController.abort();
            return;
          }
        }

        const timeDiff = now - lastEditTime;
        const percentDiff = Math.abs(prog.percent - lastReportedPercent);

        // Throttle updates: edit message at most once every 1.5 seconds, or on >= 5% jump, or at 100%
        if (timeDiff < 1500 && prog.percent < 100 && percentDiff < 5) {
          return;
        }

        lastEditTime = now;
        lastReportedPercent = prog.percent;

        const details: string[] = [];
        if (prog.speed) {
          details.push(translate(payload.locale, 'download-speed', { speed: prog.speed }));
        }
        if (prog.eta) {
          details.push(translate(payload.locale, 'download-eta', { eta: prog.eta }));
        }

        await this.updateStatusCard(
          payload,
          this.renderStageBody(payload, 'download-stage-downloading', prog.percent, details),
          progressKeyboard
        );

        await this.jobRepo
          .updateJobStatus(payload.jobId, 'processing', {
            progressPercent: Math.round(prog.percent),
          })
          .catch(() => {});
      };

      const downloadResult = await adapter.download({
        url: payload.url,
        platform: payload.platform,
        mediaId: payload.mediaId,
        format: payload.format,
        qualityId: payload.qualityId,
        outputPath: jobDir,
        onProgress,
        signal: abortController.signal,
      });

      await this.ensureNotCancelled(payload.jobId, abortController.signal);

      await this.updateStatusCard(
        payload,
        this.renderStageBody(payload, 'download-stage-processing', 100),
        progressKeyboard
      );

      // 3. Inspect & Validate Media with FFprobe
      const isVip = payload.userTier === 'vip';
      const maxDurationSeconds = isVip
        ? config.VIP_MAX_MEDIA_DURATION_SECONDS
        : config.MAX_MEDIA_DURATION_SECONDS;
      const maxFileSizeBytes = Math.min(
        TELEGRAM_MAX_FILE_SIZE_BYTES,
        (isVip ? config.VIP_MAX_FILE_SIZE_MB : config.MAX_FILE_SIZE_MB) * 1024 * 1024
      );

      let finalFilePath = downloadResult.filePath;
      let thumbnailPath = downloadResult.thumbnailPath;
      let probeInfo: MediaProbeInfo | undefined;
      try {
        probeInfo = await this.ffprobe.probe(finalFilePath);

        // Check duration limits
        if (probeInfo.durationSeconds && probeInfo.durationSeconds > maxDurationSeconds) {
          throw new MediaDurationExceededError(
            maxDurationSeconds,
            probeInfo.durationSeconds
          );
        }

        // 4. Optimize MP4 with faststart & extract video thumbnail
        if (payload.format === 'video' && finalFilePath.endsWith('.mp4')) {
          const remuxedPath = `${finalFilePath}.stream.mp4`;
          try {
            await this.ffmpeg.remuxToMp4(finalFilePath, remuxedPath, abortController.signal);
            finalFilePath = remuxedPath;
          } catch (remuxErr) {
            if (remuxErr instanceof JobCancelledError) throw remuxErr;
            logger.warn({ remuxErr }, 'FFmpeg remux failed, proceeding with original file');
          }

          if (!thumbnailPath && this.ffmpeg.extractThumbnail) {
            const candidateThumb = join(jobDir, 'thumb.jpg');
            try {
              await this.ffmpeg.extractThumbnail(
                finalFilePath,
                candidateThumb,
                1,
                abortController.signal
              );
              if (existsSync(candidateThumb)) {
                thumbnailPath = candidateThumb;
              }
            } catch {
              // Thumbnail extraction is optional
            }
          }
        }

        // Audio: reuse the embedded cover art as the Telegram thumbnail (shown in the player)
        if (
          payload.format === 'audio' &&
          !thumbnailPath &&
          probeInfo.hasVideo &&
          this.ffmpeg.extractCoverArt
        ) {
          const candidateCover = join(jobDir, 'cover.jpg');
          try {
            await this.ffmpeg.extractCoverArt(finalFilePath, candidateCover, abortController.signal);
            if (existsSync(candidateCover)) {
              thumbnailPath = candidateCover;
            }
          } catch {
            // Cover art is optional
          }
        }
      } catch (probeErr) {
        if (probeErr instanceof AppError) {
          throw probeErr;
        }
        logger.warn({ probeErr }, 'FFprobe validation skipped or failed');
      }

      await this.ensureNotCancelled(payload.jobId, abortController.signal);

      // 5. Update status to UPLOADING
      await this.jobRepo.updateJobStatus(payload.jobId, 'uploading', {
        progressPercent: 95,
      });

      await this.updateStatusCard(
        payload,
        this.renderStageBody(payload, 'download-stage-uploading', 100)
      );

      // 6. Deliver to Telegram
      const stats = statSync(finalFilePath);
      const resolvedDuration = probeInfo?.durationSeconds ?? downloadResult.durationSeconds;
      // Artist for the audio player: adapter-provided, else the file's embedded tag
      const performer = downloadResult.author || probeInfo?.tagArtist;

      const deliveryResult = await this.delivery.deliverMedia({
        chatId: payload.chatId,
        filePath: finalFilePath,
        fileName: downloadResult.fileName,
        format: payload.format,
        title: payload.title,
        performerOrAuthor: performer,
        durationSeconds: resolvedDuration,
        width: probeInfo?.width,
        height: probeInfo?.height,
        thumbnailPath,
        locale: payload.locale,
        maxSizeBytes: maxFileSizeBytes,
      });

      // Save Telegram file_id in cache for future instant deliveries
      if (deliveryResult?.telegramFileId && this.mediaCacheRepo) {
        await this.mediaCacheRepo
          .saveCachedMedia({
            platform: payload.platform,
            mediaId: payload.mediaId,
            format: payload.format,
            qualityId: payload.qualityId,
            telegramFileId: deliveryResult.telegramFileId,
            fileSizeBytes: stats.size,
            durationSeconds: resolvedDuration,
            title: payload.title,
            author: performer,
          })
          .catch((err) => {
            logger.warn({ err, jobId: payload.jobId }, 'Failed to save media file_id to cache');
          });
      }

      // 7. Update status to COMPLETED
      await this.jobRepo.updateJobStatus(payload.jobId, 'completed', {
        progressPercent: 100,
        fileSizeBytes: stats.size,
        durationSeconds: resolvedDuration ? Math.round(resolvedDuration) : undefined,
      });

      await this.updateStatusCard(
        payload,
        escapeHtml(
          translate(payload.locale, 'download-completed', { size: formatFileSize(stats.size) })
        )
      );

      logger.info({ jobId: payload.jobId }, 'Job completed and delivered successfully');
    } catch (err) {
      if (err instanceof JobCancelledError) {
        logger.info({ jobId: payload.jobId }, 'Job execution aborted due to user cancellation');
        await this.updateStatusCard(
          payload,
          escapeHtml(translate(payload.locale, 'download-cancelled'))
        );
        return;
      }

      const errorMsg = (err as Error).message || 'Unknown processing error';
      logger.error({ jobId: payload.jobId, err }, 'Job processing failed');

      const isNonRetryable =
        err instanceof MediaTooLargeError ||
        err instanceof MediaDurationExceededError ||
        err instanceof MediaUnavailableError ||
        err instanceof UnauthorizedContentError;

      const maxAttempts = job.opts?.attempts ?? 1;
      const currentAttempt = (job.attemptsMade ?? 0) + 1;
      const isFinalAttempt = isNonRetryable || currentAttempt >= maxAttempts;

      if (isFinalAttempt) {
        const i18nKey =
          err instanceof AppError && err.i18nKey ? err.i18nKey : 'error-download-failed';
        const i18nParams = err instanceof AppError ? err.i18nParams : undefined;

        // Prefix the reason key so the admin panel can group failures (see getFailureReasons)
        await this.jobRepo.updateJobStatus(payload.jobId, 'failed', {
          error: `[${i18nKey}] ${errorMsg}`,
        });

        // Show the error on the progress card (replacing the stale bar and Cancel button);
        // fall back to a separate message if there is no card or it can't be edited.
        const hintKey = getConfig().ADMIN_USER_IDS.includes(payload.userId)
          ? adminHintKeyForError(i18nKey)
          : undefined;
        const errorLines = [translate(payload.locale, i18nKey, i18nParams)];
        if (hintKey) errorLines.push(translate(payload.locale, hintKey));

        const shownOnCard = await this.updateStatusCard(
          payload,
          escapeHtml(errorLines.join('\n\n'))
        );
        if (!shownOnCard) {
          await this.delivery.sendErrorMessage(payload.chatId, payload.locale, i18nKey, i18nParams);
        }
      }

      if (isNonRetryable) {
        throw new UnrecoverableError(errorMsg);
      }

      throw err;
    } finally {
      MediaProcessingWorker.activeAbortControllers.delete(payload.jobId);
      // Clean up temporary files for this job
      this.tempStorage.cleanupJobDirectory(payload.jobId);
    }
  }

  /** Progress-card body for a stage: stage label, progress bar, then optional speed/ETA line. */
  private renderStageBody(
    payload: MediaJobPayload,
    stageKey: string,
    percent: number,
    details: string[] = []
  ): string {
    const pct = Math.floor(Math.max(0, Math.min(100, percent || 0)));
    const lines = [
      escapeHtml(translate(payload.locale, stageKey)),
      `<code>${renderProgressBar(pct)}</code> <b>${pct}%</b>`,
    ];
    if (details.length > 0) {
      lines.push(escapeHtml(details.join(' · ')));
    }
    return lines.join('\n');
  }

  /** Rewrites the job's status card (title header + body). Returns false if there is no card or the edit failed. */
  private async updateStatusCard(
    payload: MediaJobPayload,
    bodyHtml: string,
    keyboard?: InlineKeyboard
  ): Promise<boolean> {
    if (!payload.statusMessageId) return false;
    const edited = await this.delivery.updateJobProgressMessage(
      payload.chatId,
      payload.statusMessageId,
      renderStatusCard(payload.title, payload.format, bodyHtml),
      keyboard
    );
    return edited === true;
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
      logger.info('Media processing worker stopped');
    }
  }
}
