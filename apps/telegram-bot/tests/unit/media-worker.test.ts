import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaProcessingWorker } from '../../src/queue/workers/media-worker.js';
import { Job } from 'bullmq';
import { MediaJobPayload } from '../../core/types/job.js';
import { JobRepository } from '../../src/database/repositories/job-repository.js';
import { PlatformRouter } from '../../src/platforms/platform-router.js';
import { TempStorageManager } from '../../src/services/temp-storage/temp-storage-manager.js';
import { FFprobeRunner } from '../../src/services/media/ffprobe-runner.js';
import { FFmpegRunner } from '../../src/services/media/ffmpeg-runner.js';
import { DeliveryService } from '../../src/services/delivery/delivery-service.js';
import { Bot } from 'grammy';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

describe('MediaProcessingWorker Pipeline', () => {
  let mockJobRepo: JobRepository;
  let mockRouter: PlatformRouter;
  let mockTempStorage: TempStorageManager;
  let mockFFprobe: FFprobeRunner;
  let mockFFmpeg: FFmpegRunner;
  let mockDelivery: DeliveryService;
  let worker: MediaProcessingWorker;

  const testTempDir = join(process.cwd(), 'temp', 'test-job');

  beforeEach(() => {
    mkdirSync(testTempDir, { recursive: true });
    const dummyFile = join(testTempDir, 'test-audio.mp3');
    writeFileSync(dummyFile, 'dummy audio data buffer content');

    mockJobRepo = {
      updateJobStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;

    mockRouter = {
      getAdapterByPlatform: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({
          filePath: dummyFile,
          fileName: 'test-audio.mp3',
          fileSizeBytes: 30,
          mimeType: 'audio/mpeg',
          format: 'audio',
          title: 'Test Song',
        }),
      }),
    } as unknown as PlatformRouter;

    mockTempStorage = {
      createJobDirectory: vi.fn().mockReturnValue(testTempDir),
      cleanupJobDirectory: vi.fn(),
    } as unknown as TempStorageManager;

    mockFFprobe = {
      probe: vi.fn().mockResolvedValue({
        formatName: 'mp3',
        durationSeconds: 180,
        sizeBytes: 30,
        hasAudio: true,
        hasVideo: false,
      }),
    } as unknown as FFprobeRunner;

    mockFFmpeg = {
      remuxToMp4: vi.fn().mockResolvedValue('dummy.mp4'),
    } as unknown as FFmpegRunner;

    mockDelivery = {
      deliverMedia: vi.fn().mockResolvedValue(undefined),
      updateJobProgressMessage: vi.fn().mockResolvedValue(undefined),
      sendErrorMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeliveryService;

    worker = new MediaProcessingWorker({
      bot: {} as unknown as Bot,
      jobRepo: mockJobRepo,
      platformRouter: mockRouter,
      tempStorage: mockTempStorage,
      ffprobe: mockFFprobe,
      ffmpeg: mockFFmpeg,
      deliveryService: mockDelivery,
    });
  });

  it('successfully processes an audio job from queue to delivery', async () => {
    const jobPayload: MediaJobPayload = {
      jobId: 'job-12345',
      userId: 1001,
      chatId: 2002,
      statusMessageId: 3003,
      platform: 'youtube',
      url: 'https://youtube.com/watch?v=test',
      mediaId: 'test',
      title: 'Test Song',
      format: 'audio',
      qualityId: 'bestaudio',
      locale: 'en',
    };

    const mockJob = {
      data: jobPayload,
    } as unknown as Job<MediaJobPayload>;

    await worker.processJob(mockJob);

    // 1. Status updated to processing
    expect(mockJobRepo.updateJobStatus).toHaveBeenCalledWith(
      'job-12345',
      'processing',
      expect.objectContaining({ progressPercent: 0 })
    );

    // 2. FFprobe probed
    expect(mockFFprobe.probe).toHaveBeenCalled();

    // 3. Status updated to uploading
    expect(mockJobRepo.updateJobStatus).toHaveBeenCalledWith(
      'job-12345',
      'uploading',
      expect.objectContaining({ progressPercent: 95 })
    );

    // 4. Delivered via DeliveryService
    expect(mockDelivery.deliverMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 2002,
        format: 'audio',
        title: 'Test Song',
      })
    );

    // 5. Status updated to completed
    expect(mockJobRepo.updateJobStatus).toHaveBeenCalledWith(
      'job-12345',
      'completed',
      expect.objectContaining({ progressPercent: 100 })
    );

    // 6. Cleanup called
    expect(mockTempStorage.cleanupJobDirectory).toHaveBeenCalledWith('job-12345');

    // 7. Status card walks through localized stages and ends on a result line
    const cardTexts = (mockDelivery.updateJobProgressMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[2] as string
    );
    expect(cardTexts.every((t) => t.startsWith('🎵 <b>Test Song</b>'))).toBe(true);
    expect(cardTexts[0]).toContain('⬇️ Downloading…');
    expect(cardTexts.some((t) => t.includes('⚙️ Processing…'))).toBe(true);
    expect(cardTexts.some((t) => t.includes('📤 Sending to Telegram…'))).toBe(true);
    expect(cardTexts[cardTexts.length - 1]).toContain('✅ Sent (0.0 MB)');
  });

  it('sends audio with its embedded cover art as thumbnail and the tagged artist', async () => {
    (mockFFprobe.probe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      formatName: 'mp3',
      durationSeconds: 180,
      sizeBytes: 30,
      hasAudio: true,
      hasVideo: true, // attached cover picture
      tagArtist: 'Daft Punk',
    });
    const extractCoverArt = vi.fn().mockImplementation(async (_in: string, out: string) => {
      writeFileSync(out, 'jpeg');
      return out;
    });
    (mockFFmpeg as any).extractCoverArt = extractCoverArt;

    const mockJob = {
      data: {
        jobId: 'job-cover',
        userId: 1001,
        chatId: 2002,
        platform: 'youtube',
        url: 'https://youtube.com/watch?v=cover',
        mediaId: 'cover',
        title: 'Digital Love',
        format: 'audio',
        qualityId: 'bestaudio',
        locale: 'en',
      },
    } as unknown as Job<MediaJobPayload>;

    await worker.processJob(mockJob);

    expect(extractCoverArt).toHaveBeenCalled();
    expect(mockDelivery.deliverMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailPath: expect.stringMatching(/cover\.jpg$/),
        performerOrAuthor: 'Daft Punk',
      })
    );
  });

  it('shows the failure on the status card instead of leaving a stale progress bar', async () => {
    (mockFFprobe.probe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      durationSeconds: 999999,
      sizeBytes: 100,
      hasAudio: true,
      hasVideo: false,
    });
    (mockDelivery.updateJobProgressMessage as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const mockJob = {
      data: {
        jobId: 'job-card-fail',
        userId: 1001,
        chatId: 2002,
        statusMessageId: 3004,
        platform: 'youtube',
        url: 'https://youtube.com/watch?v=long',
        mediaId: 'long',
        title: 'Long Stream',
        format: 'audio',
        qualityId: 'bestaudio',
        locale: 'en',
      },
    } as unknown as Job<MediaJobPayload>;

    await expect(worker.processJob(mockJob)).rejects.toThrow();

    const calls = (mockDelivery.updateJobProgressMessage as ReturnType<typeof vi.fn>).mock.calls;
    const [, messageId, text, keyboard] = calls[calls.length - 1];
    expect(messageId).toBe(3004);
    expect(text).toContain('Long Stream');
    expect(text).toContain('minute limit');
    expect(keyboard).toBeUndefined(); // Cancel button removed
    expect(mockDelivery.sendErrorMessage).not.toHaveBeenCalled();
  });

  it('fails job and notifies user when duration exceeds limit', async () => {
    (mockFFprobe.probe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      durationSeconds: 999999, // exceeds max duration
      sizeBytes: 100,
      hasAudio: true,
      hasVideo: false,
    });

    const jobPayload: MediaJobPayload = {
      jobId: 'job-oversize',
      userId: 1001,
      chatId: 2002,
      platform: 'youtube',
      url: 'https://youtube.com/watch?v=long',
      mediaId: 'long',
      title: 'Long Stream',
      format: 'audio',
      qualityId: 'bestaudio',
      locale: 'fa',
    };

    const mockJob = {
      data: jobPayload,
    } as unknown as Job<MediaJobPayload>;

    await expect(worker.processJob(mockJob)).rejects.toThrow();

    // Job marked as failed, with the reason key prefixed for the admin failure stats
    expect(mockJobRepo.updateJobStatus).toHaveBeenCalledWith(
      'job-oversize',
      'failed',
      expect.objectContaining({ error: expect.stringMatching(/^\[error-duration-exceeded\] /) })
    );

    // User notified with localized error
    expect(mockDelivery.sendErrorMessage).toHaveBeenCalledWith(
      2002,
      'fa',
      'error-duration-exceeded',
      expect.any(Object)
    );

    // Temporary storage cleaned up even on failure
    expect(mockTempStorage.cleanupJobDirectory).toHaveBeenCalledWith('job-oversize');
  });

  it('aborts gracefully without failing or uploading if job was cancelled', async () => {
    mockJobRepo.getJob = vi.fn().mockResolvedValue({
      id: 'job-cancelled',
      status: 'cancelled',
    });

    const jobPayload: MediaJobPayload = {
      jobId: 'job-cancelled',
      userId: 1001,
      chatId: 2002,
      statusMessageId: 3003,
      platform: 'youtube',
      url: 'https://youtube.com/watch?v=cancelled',
      mediaId: 'cancelled',
      title: 'Cancelled Song',
      format: 'audio',
      qualityId: 'bestaudio',
      locale: 'en',
    };

    const mockJob = {
      data: jobPayload,
    } as unknown as Job<MediaJobPayload>;

    await worker.processJob(mockJob);

    expect(mockDelivery.deliverMedia).not.toHaveBeenCalled();
    expect(mockJobRepo.updateJobStatus).not.toHaveBeenCalledWith(
      'job-cancelled',
      'failed',
      expect.any(Object)
    );
    expect(mockTempStorage.cleanupJobDirectory).toHaveBeenCalledWith('job-cancelled');
  });

  it('delivers instantly from MediaCacheRepository when telegramFileId is cached', async () => {
    const mockCacheRepo = {
      getCachedMedia: vi.fn().mockResolvedValue({
        platform: 'youtube',
        mediaId: 'cached123',
        format: 'audio',
        qualityId: 'bestaudio',
        telegramFileId: 'CQACAgIAAxkBAAIB_cached_file_id',
        fileSizeBytes: 4194304,
        durationSeconds: 180,
      }),
      saveCachedMedia: vi.fn(),
    };

    mockDelivery.deliverCachedMedia = vi.fn().mockResolvedValue(undefined);

    const cachedWorker = new MediaProcessingWorker({
      bot: {} as unknown as Bot,
      jobRepo: mockJobRepo,
      mediaCacheRepo: mockCacheRepo as any,
      platformRouter: mockRouter,
      tempStorage: mockTempStorage,
      ffprobe: mockFFprobe,
      ffmpeg: mockFFmpeg,
      deliveryService: mockDelivery,
    });

    const jobPayload: MediaJobPayload = {
      jobId: 'job-cached-hit',
      userId: 1001,
      chatId: 2002,
      statusMessageId: 3003,
      platform: 'youtube',
      url: 'https://youtube.com/watch?v=cached123',
      mediaId: 'cached123',
      title: 'Cached Track',
      format: 'audio',
      qualityId: 'bestaudio',
      locale: 'en',
    };

    await cachedWorker.processJob({ data: jobPayload } as unknown as Job<MediaJobPayload>);

    expect(mockDelivery.deliverCachedMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 2002,
        telegramFileId: 'CQACAgIAAxkBAAIB_cached_file_id',
        format: 'audio',
      })
    );
    expect(mockDelivery.deliverMedia).not.toHaveBeenCalled();
    expect(mockJobRepo.updateJobStatus).toHaveBeenCalledWith(
      'job-cached-hit',
      'completed',
      expect.objectContaining({ progressPercent: 100, fileSizeBytes: 4194304 })
    );
  });
});
