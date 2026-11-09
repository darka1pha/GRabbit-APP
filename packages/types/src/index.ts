/**
 * Shared types for gRabbit cross-platform applications (desktop, mobile, web).
 */

export type PlatformId =
  | 'youtube'
  | 'spotify'
  | 'instagram'
  | 'soundcloud'
  | 'tiktok'
  | 'twitter'
  | 'reddit'
  | 'generic';

export type MediaFormat = 'audio' | 'video';

export interface MediaOption {
  format: MediaFormat;
  qualityId: string;
  label: string;
  extension: string;
  estimatedSizeBytes?: number;
  /** Audio kept in the source codec (no re-encode). */
  isOriginalQuality?: boolean;
}

export interface MediaItem {
  id: string;
  title: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  platform: PlatformId;
  url: string;
  description?: string;
  isDownloadable: boolean;
  unavailableReason?: string;
  availableOptions: MediaOption[];
}

export interface PlatformMetadata {
  platform: PlatformId;
  url: string;
  title: string;
  artistOrAuthor?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  items: MediaItem[];
  /** Albums / playlists / sets: items are the tracks. */
  isCollection?: boolean;
  /** Only the first part of the collection could be listed (e.g. Spotify without API credentials). */
  truncated?: boolean;
  isAuthorized?: boolean;
}

export interface RecognizedTrack {
  title: string;
  artist: string;
  album?: string;
  releaseYear?: string;
  genre?: string;
  label?: string;
  coverArtUrl?: string;
  shazamUrl?: string;
  appleMusicUrl?: string;
  spotifyUri?: string;
}

export type SongRecognitionResult = RecognizedTrack;

// ---------------------------------------------------------------------------
// Download manager
// ---------------------------------------------------------------------------

export type DownloadKind = 'http' | 'media';

export type DownloadStatus =
  | 'queued'
  | 'starting'
  | 'downloading'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'error';

export type Category = 'video' | 'music' | 'documents' | 'compressed' | 'programs' | 'images' | 'other';

export const CATEGORIES: Category[] = [
  'video',
  'music',
  'documents',
  'compressed',
  'programs',
  'images',
  'other',
];

export type ChecksumAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

export interface SegmentState {
  /** First byte of the segment (inclusive). */
  start: number;
  /** Last byte of the segment (inclusive); null when the total size is unknown. */
  end: number | null;
  /** Bytes already written for this segment. */
  received: number;
  /** Name of the part file inside the item's part directory. */
  part: string;
}

export interface MediaJobInfo {
  platform: PlatformId;
  mediaId: string;
  format: MediaFormat;
  qualityId: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  estimatedSizeBytes?: number;
  /** Human readable current stage, e.g. "Downloading video", "Converting". */
  stage?: string;
}

export interface DownloadItem {
  id: string;
  kind: DownloadKind;
  url: string;
  /** Page the link came from; sent as Referer. */
  referrer?: string;
  fileName: string;
  /** True when the user picked the name, so the server's name must not replace it. */
  fileNameLocked?: boolean;
  directory: string;
  /** Category and folder were picked automatically and may follow the server's file name. */
  autoPlace?: boolean;
  category: Category;
  status: DownloadStatus;
  totalBytes: number | null;
  receivedBytes: number;
  /** Bytes per second (smoothed). */
  speed: number;
  /** Seconds remaining, when known. */
  eta: number | null;
  /** 0..100 when totalBytes is unknown but progress is (media jobs). */
  percent?: number;
  resumable: boolean;
  /** Requested parallel connections. */
  connections: number;
  activeConnections: number;
  segments?: SegmentState[];
  headers?: Record<string, string>;
  /** Per-download speed cap in bytes/s (0 = unlimited). */
  speedLimit?: number;
  checksum?: {
    algorithm: ChecksumAlgorithm;
    expected?: string;
    actual?: string;
    verified?: boolean;
  };
  media?: MediaJobInfo;
  mimeType?: string;
  etag?: string;
  lastModified?: string;
  error?: string;
  errorCode?: string;
  retries: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  /** Full path of the finished file. */
  filePath?: string;
  /** ID of the download queue this item belongs to (defaults to 'main'). */
  queueId?: string;
}

export interface DownloadQueueScheduler {
  enabled: boolean;
  /** 'HH:MM', local time */
  startTime: string;
  /** 'HH:MM', or '' for no stop time */
  stopTime: string;
}

export type QueueAfterAction = 'none' | 'stopQueue' | 'quit' | 'sleep' | 'shutdown';

export interface DownloadQueue {
  id: string;
  name: string;
  enabled: boolean;
  maxConcurrent: number;
  scheduler?: DownloadQueueScheduler;
  afterQueue?: QueueAfterAction;
  order: string[];
}

export interface AddHttpDownloadRequest {
  url: string;
  fileName?: string;
  directory?: string;
  category?: Category;
  connections?: number;
  referrer?: string;
  headers?: Record<string, string>;
  speedLimitKBps?: number;
  checksum?: { algorithm: ChecksumAlgorithm; expected?: string };
  startPaused?: boolean;
  queueId?: string;
}

export interface AddMediaDownloadRequest {
  url: string;
  platform: PlatformId;
  mediaId: string;
  format: MediaFormat;
  qualityId: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  estimatedSizeBytes?: number;
  directory?: string;
  startPaused?: boolean;
  queueId?: string;
}

export interface ProbeResult {
  url: string;
  finalUrl: string;
  fileName: string;
  totalBytes: number | null;
  resumable: boolean;
  mimeType?: string;
  category: Category;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type Language = 'en' | 'fa';
export type Theme = 'system' | 'light' | 'dark';
export type AfterQueueAction = 'none' | 'quit' | 'sleep' | 'shutdown';
export type BrowserName = '' | 'chrome' | 'edge' | 'firefox' | 'brave' | 'opera' | 'vivaldi' | 'chromium';

export interface ExtensionSettings {
  enabled: boolean;
  port: number;
  token: string;
  autoCapture: boolean;
}

export interface AppSettings {
  language: Language;
  theme: Theme;
  downloadDir: string;
  /** Put finished files in <downloadDir>/<Category>. */
  categorySubfolders: boolean;
  maxConcurrent: number;
  defaultConnections: number;
  maxRetries: number;
  /** KB/s across all downloads, 0 = unlimited. */
  globalSpeedLimitKBps: number;
  clipboardMonitor: boolean;
  notifications: boolean;
  closeToTray: boolean;
  resumeOnStartup: boolean;
  /** Launch gRabbit on Windows startup (openAtLogin). */
  startOnBoot: boolean;
  /** Start minimized to the system tray when launching on boot. */
  startMinimized: boolean;
  /** Global shortcut to summon floating quick grab pill from any screen. */
  globalShortcut: {
    enabled: boolean;
    accelerator: string;
  };
  /** Automatic application updates via GitHub Releases. */
  updates: {
    autoCheck: boolean;
    autoDownload: boolean;
  };
  userAgent: string;
  /** http://host:port, used by both engines. Empty = direct connection. */
  proxy: string;
  afterQueue: AfterQueueAction;
  scheduler: {
    enabled: boolean;
    /** HH:MM, local time. */
    startTime: string;
    /** HH:MM, or '' for no stop time. */
    stopTime: string;
  };
  media: {
    defaultAudioFormat: 'mp3' | 'm4a';
    defaultVideoQuality: string;
    cookiesFromBrowser: BrowserName;
    cookiesFile: string;
    spotifyClientId: string;
    spotifyClientSecret: string;
    instagramSessionId: string;
  };
  extension: ExtensionSettings;
}

// ---------------------------------------------------------------------------
// Extension RPC Bridge
// ---------------------------------------------------------------------------

export interface RpcPingResponse {
  app: 'gRabbit';
  version: string;
  authenticated: boolean;
  port: number;
}

export interface RpcStatusResponse {
  app: 'gRabbit';
  version: string;
  authenticated: boolean;
  port: number;
  activeDownloads: number;
  totalSpeed: number;
  queueLength: number;
}

export interface RpcAddDownloadRequest {
  url: string;
  fileName?: string;
  category?: Category;
  directory?: string;
  referrer?: string;
  headers?: Record<string, string>;
  cookies?: string;
  userAgent?: string;
  startPaused?: boolean;
}

export interface RpcAddBatchRequest {
  items: RpcAddDownloadRequest[];
}

export interface RpcAddDownloadResponse {
  success: boolean;
  item?: DownloadItem;
  items?: DownloadItem[];
  error?: string;
}

export interface DetectedMediaStream {
  url: string;
  title?: string;
  mimeType?: string;
  format?: 'video' | 'audio' | 'stream';
  sizeBytes?: number;
  quality?: string;
  tabId?: number;
}

export interface ToolInfo {
  ytdlp: { path: string; version: string | null };
  ffmpeg: { path: string; version: string | null };
  ffprobe: { path: string; version: string | null };
  appVersion: string;
  dataDir: string;
}

export interface ClipboardLink {
  url: string;
  /** 'media' when a platform adapter (or yt-dlp) should handle it, 'file' for the download manager. */
  kind: 'media' | 'file';
}

export interface AppError {
  code: string;
  message: string;
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatusInfo {
  state: UpdateState;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  progressPercent?: number;
  error?: string;
}

export interface GrabPillInitData {
  clipboardUrl?: string;
}

/** API the preload script exposes on `window.grabbit`. */
export interface GrabbitApi {
  platform: string;
  settings: {
    get(): Promise<AppSettings>;
    update(patch: DeepPartial<AppSettings>): Promise<AppSettings>;
    chooseDirectory(current?: string): Promise<string | null>;
    chooseFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
  };
  downloads: {
    list(): Promise<DownloadItem[]>;
    probe(url: string, headers?: Record<string, string>): Promise<ProbeResult>;
    addHttp(requests: AddHttpDownloadRequest[]): Promise<DownloadItem[]>;
    addMedia(requests: AddMediaDownloadRequest[]): Promise<DownloadItem[]>;
    pause(ids: string[]): Promise<void>;
    resume(ids: string[]): Promise<void>;
    retry(ids: string[]): Promise<void>;
    remove(ids: string[], deleteFiles: boolean): Promise<void>;
    clearCompleted(): Promise<void>;
    pauseAll(): Promise<void>;
    resumeAll(): Promise<void>;
    move(id: string, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<void>;
    changeUrl(id: string, url: string): Promise<void>;
    setSpeedLimit(id: string, kbps: number): Promise<void>;
    verifyChecksum(id: string, algorithm: ChecksumAlgorithm, expected?: string): Promise<DownloadItem>;
    openFile(id: string): Promise<void>;
    showInFolder(id: string): Promise<void>;
    copyUrl(id: string): Promise<void>;
    onChanged(listener: (items: DownloadItem[]) => void): () => void;
    onRemoved(listener: (ids: string[]) => void): () => void;
    /** New queue order after a move. */
    onOrderChanged(listener: (ids: string[]) => void): () => void;
  };
  queues: {
    list(): Promise<DownloadQueue[]>;
    create(name: string, options?: Partial<DownloadQueue>): Promise<DownloadQueue>;
    update(id: string, patch: Partial<DownloadQueue>): Promise<DownloadQueue>;
    delete(id: string): Promise<void>;
    start(id: string): Promise<void>;
    stop(id: string): Promise<void>;
    moveItem(itemId: string, targetQueueId: string): Promise<void>;
    reorder(queueId: string, order: string[]): Promise<void>;
    onChanged(listener: (queues: DownloadQueue[]) => void): () => void;
  };
  media: {
    resolve(url: string): Promise<PlatformMetadata>;
    search(query: string, limit?: number): Promise<MediaItem[]>;
  };
  recognize: {
    file(path: string): Promise<RecognizedTrack | null>;
    url(url: string): Promise<RecognizedTrack | null>;
  };
  tools: {
    info(): Promise<ToolInfo>;
    updateYtDlp(): Promise<string>;
  };
  updater: {
    check(): Promise<UpdateStatusInfo>;
    download(): Promise<void>;
    install(): Promise<void>;
    onStatus(listener: (status: UpdateStatusInfo) => void): () => void;
  };
  pill: {
    hide(): Promise<void>;
    submit(url: string, action?: 'grab' | 'download'): Promise<void>;
    onInit(listener: (data: GrabPillInitData) => void): () => void;
  };
  app: {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<void>;
    getPathForFile(file: File): string;
    onClipboardLink(listener: (link: ClipboardLink) => void): () => void;
    onNavigate(listener: (view: string) => void): () => void;
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  chooseDirectory: 'dialog:choose-directory',
  chooseFile: 'dialog:choose-file',
  downloadsList: 'downloads:list',
  downloadsProbe: 'downloads:probe',
  downloadsAddHttp: 'downloads:add-http',
  downloadsAddMedia: 'downloads:add-media',
  downloadsPause: 'downloads:pause',
  downloadsResume: 'downloads:resume',
  downloadsRetry: 'downloads:retry',
  downloadsRemove: 'downloads:remove',
  downloadsClearCompleted: 'downloads:clear-completed',
  downloadsPauseAll: 'downloads:pause-all',
  downloadsResumeAll: 'downloads:resume-all',
  downloadsMove: 'downloads:move',
  downloadsChangeUrl: 'downloads:change-url',
  downloadsSetSpeedLimit: 'downloads:set-speed-limit',
  downloadsVerify: 'downloads:verify',
  downloadsOpenFile: 'downloads:open-file',
  downloadsShowInFolder: 'downloads:show-in-folder',
  downloadsCopyUrl: 'downloads:copy-url',
  downloadsChanged: 'downloads:changed',
  downloadsRemoved: 'downloads:removed',
  downloadsOrder: 'downloads:order',
  queuesList: 'queues:list',
  queuesCreate: 'queues:create',
  queuesUpdate: 'queues:update',
  queuesDelete: 'queues:delete',
  queuesStart: 'queues:start',
  queuesStop: 'queues:stop',
  queuesMoveItem: 'queues:move-item',
  queuesReorder: 'queues:reorder',
  queuesChanged: 'queues:changed',
  mediaResolve: 'media:resolve',
  mediaSearch: 'media:search',
  recognizeFile: 'recognize:file',
  recognizeUrl: 'recognize:url',
  toolsInfo: 'tools:info',
  toolsUpdateYtDlp: 'tools:update-yt-dlp',
  updaterCheck: 'updater:check',
  updaterDownload: 'updater:download',
  updaterInstall: 'updater:install',
  updaterStatus: 'updater:status',
  pillHide: 'pill:hide',
  pillSubmit: 'pill:submit',
  pillInit: 'pill:init',
  openExternal: 'app:open-external',
  openPath: 'app:open-path',
  clipboardLink: 'app:clipboard-link',
  navigate: 'app:navigate',
} as const;
