export abstract class AppError extends Error {
  public abstract readonly code: string;
  public readonly i18nKey?: string;
  public readonly i18nParams?: Record<string, string | number>;

  constructor(message: string, i18nKey?: string, i18nParams?: Record<string, string | number>) {
    super(message);
    this.name = this.constructor.name;
    this.i18nKey = i18nKey;
    this.i18nParams = i18nParams;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidUrlError extends AppError {
  public readonly code = 'INVALID_URL';
  constructor(message = 'The provided URL is invalid or malformed', url?: string) {
    super(message, 'error-invalid-url', url ? { url } : undefined);
  }
}

export class UnsupportedPlatformError extends AppError {
  public readonly code = 'UNSUPPORTED_PLATFORM';
  constructor(message = 'Platform is not supported') {
    super(message, 'error-unsupported-platform');
  }
}

export class MediaUnavailableError extends AppError {
  public readonly code = 'MEDIA_UNAVAILABLE';
  constructor(message = 'The requested media is unavailable or removed') {
    super(message, 'error-media-unavailable');
  }
}

export class UnauthorizedContentError extends AppError {
  public readonly code = 'UNAUTHORIZED_CONTENT';
  constructor(
    message = 'Access to this content is restricted or unauthorized',
    i18nKey = 'error-unauthorized-content'
  ) {
    super(message, i18nKey);
  }
}

export class MediaTooLargeError extends AppError {
  public readonly code = 'MEDIA_TOO_LARGE';
  constructor(maxSizeMb: number, actualSizeMb?: number) {
    super(
      `Media size exceeds limit of ${maxSizeMb}MB${actualSizeMb ? ` (actual: ${actualSizeMb.toFixed(1)}MB)` : ''}`,
      'error-file-too-large',
      // Pass numbers (not strings) so Fluent formats both with the user's locale digits
      {
        maxSize: maxSizeMb,
        actualSize: actualSizeMb ? Math.round(actualSizeMb * 10) / 10 : maxSizeMb,
      }
    );
  }
}

export class MediaDurationExceededError extends AppError {
  public readonly code = 'MEDIA_DURATION_EXCEEDED';
  constructor(maxDurationSeconds: number, actualDurationSeconds?: number) {
    super(
      `Media duration exceeds limit of ${maxDurationSeconds}s${actualDurationSeconds ? ` (actual: ${actualDurationSeconds}s)` : ''}`,
      'error-duration-exceeded',
      { maxDuration: Math.round(maxDurationSeconds / 60) }
    );
  }
}

export class RateLimitExceededError extends AppError {
  public readonly code = 'RATE_LIMIT_EXCEEDED';
  constructor(retryAfterSeconds: number) {
    super(
      `Rate limit exceeded. Please wait ${retryAfterSeconds}s`,
      'error-rate-limited',
      { seconds: retryAfterSeconds }
    );
  }
}

export class ConcurrentJobLimitError extends AppError {
  public readonly code = 'CONCURRENT_JOB_LIMIT';
  constructor(maxConcurrent: number) {
    super(
      `You have reached the maximum of ${maxConcurrent} concurrent active downloads`,
      'error-concurrent-limit',
      { limit: maxConcurrent }
    );
  }
}

export class DownloadError extends AppError {
  public readonly code = 'DOWNLOAD_FAILED';
  constructor(message = 'Failed to extract or download media') {
    super(message, 'error-download-failed');
  }
}

export class ProcessingError extends AppError {
  public readonly code = 'PROCESSING_FAILED';
  constructor(message = 'Failed to process or convert media') {
    super(message, 'error-processing-failed');
  }
}

export class DeliveryError extends AppError {
  public readonly code = 'DELIVERY_FAILED';
  constructor(message = 'Failed to deliver media via Telegram') {
    super(message, 'error-delivery-failed');
  }
}

export class JobNotFoundError extends AppError {
  public readonly code = 'JOB_NOT_FOUND';
  constructor(jobId: string) {
    super(`Job not found: ${jobId}`, 'error-job-not-found', { jobId });
  }
}

export class JobCancelledError extends AppError {
  public readonly code = 'JOB_CANCELLED';
  constructor(jobId: string) {
    super(`Job was cancelled: ${jobId}`, 'download-cancelled', { jobId });
  }
}
