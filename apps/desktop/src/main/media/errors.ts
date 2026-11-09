/** Domain errors carried over from the bot. `code` is shown to the renderer for localized messages. */
export abstract class AppError extends Error {
  public abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidUrlError extends AppError {
  public readonly code = 'INVALID_URL';
  constructor(message = 'The provided URL is invalid or malformed') {
    super(message);
  }
}

export class UnsupportedPlatformError extends AppError {
  public readonly code = 'UNSUPPORTED_PLATFORM';
  constructor(message = 'Platform is not supported') {
    super(message);
  }
}

export class MediaUnavailableError extends AppError {
  public readonly code = 'MEDIA_UNAVAILABLE';
  constructor(message = 'The requested media is unavailable or removed') {
    super(message);
  }
}

export class UnauthorizedContentError extends AppError {
  public readonly code: string;
  constructor(message = 'Access to this content is restricted', code = 'UNAUTHORIZED_CONTENT') {
    super(message);
    this.code = code;
  }
}

export class DownloadError extends AppError {
  public readonly code = 'DOWNLOAD_FAILED';
  constructor(message = 'Failed to download') {
    super(message);
  }
}

export class ProcessingError extends AppError {
  public readonly code = 'PROCESSING_FAILED';
  constructor(message = 'Failed to process or convert media') {
    super(message);
  }
}

export class JobCancelledError extends AppError {
  public readonly code = 'CANCELLED';
  constructor(message = 'aborted') {
    super(message);
  }
}

export class HttpStatusError extends AppError {
  public readonly code: string;
  constructor(
    public readonly status: number,
    message?: string
  ) {
    super(message ?? `Server responded with HTTP ${status}`);
    this.code = status === 403 || status === 401 || status === 410 ? 'LINK_EXPIRED' : `HTTP_${status}`;
  }
}

export function errorCode(err: unknown): string {
  if (err instanceof AppError) return err.code;
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return 'DISK_FULL';
  if (code === 'EACCES' || code === 'EPERM') return 'ACCESS_DENIED';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS_FAILED';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') return 'NETWORK';
  return 'UNKNOWN';
}

/** An UPPER_SNAKE code from the error itself, or one derived from its Node errno. */
export function codeOf(err: unknown): string {
  const own = (err as { code?: unknown })?.code;
  if (typeof own === 'string' && /^[A-Z][A-Z_0-9]+$/.test(own) && !own.startsWith('E')) return own;
  return errorCode(err);
}
