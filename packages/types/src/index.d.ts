/**
 * Shared types for gRabbit cross-platform applications (desktop, mobile, web).
 */
export type PlatformId = 'youtube' | 'spotify' | 'instagram' | 'soundcloud' | 'tiktok' | 'twitter' | 'reddit' | 'generic';
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
export type DownloadKind = 'http' | 'media';
export type DownloadStatus = 'queued' | 'starting' | 'downloading' | 'processing' | 'paused' | 'completed' | 'error';
export type Category = 'video' | 'music' | 'documents' | 'compressed' | 'programs' | 'images' | 'other';
export declare const CATEGORIES: Category[];
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
    checksum?: {
        algorithm: ChecksumAlgorithm;
        expected?: string;
    };
    startPaused?: boolean;
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
    ytdlp: {
        path: string;
        version: string | null;
    };
    ffmpeg: {
        path: string;
        version: string | null;
    };
    ffprobe: {
        path: string;
        version: string | null;
    };
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
/** API the preload script exposes on `window.grabbit`. */
export interface GrabbitApi {
    platform: string;
    settings: {
        get(): Promise<AppSettings>;
        update(patch: DeepPartial<AppSettings>): Promise<AppSettings>;
        chooseDirectory(current?: string): Promise<string | null>;
        chooseFile(filters?: {
            name: string;
            extensions: string[];
        }[]): Promise<string | null>;
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
    app: {
        openExternal(url: string): Promise<void>;
        openPath(path: string): Promise<void>;
        getPathForFile(file: File): string;
        onClipboardLink(listener: (link: ClipboardLink) => void): () => void;
        onNavigate(listener: (view: string) => void): () => void;
    };
}
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export declare const IPC: {
    readonly settingsGet: "settings:get";
    readonly settingsUpdate: "settings:update";
    readonly chooseDirectory: "dialog:choose-directory";
    readonly chooseFile: "dialog:choose-file";
    readonly downloadsList: "downloads:list";
    readonly downloadsProbe: "downloads:probe";
    readonly downloadsAddHttp: "downloads:add-http";
    readonly downloadsAddMedia: "downloads:add-media";
    readonly downloadsPause: "downloads:pause";
    readonly downloadsResume: "downloads:resume";
    readonly downloadsRetry: "downloads:retry";
    readonly downloadsRemove: "downloads:remove";
    readonly downloadsClearCompleted: "downloads:clear-completed";
    readonly downloadsPauseAll: "downloads:pause-all";
    readonly downloadsResumeAll: "downloads:resume-all";
    readonly downloadsMove: "downloads:move";
    readonly downloadsChangeUrl: "downloads:change-url";
    readonly downloadsSetSpeedLimit: "downloads:set-speed-limit";
    readonly downloadsVerify: "downloads:verify";
    readonly downloadsOpenFile: "downloads:open-file";
    readonly downloadsShowInFolder: "downloads:show-in-folder";
    readonly downloadsCopyUrl: "downloads:copy-url";
    readonly downloadsChanged: "downloads:changed";
    readonly downloadsRemoved: "downloads:removed";
    readonly downloadsOrder: "downloads:order";
    readonly mediaResolve: "media:resolve";
    readonly mediaSearch: "media:search";
    readonly recognizeFile: "recognize:file";
    readonly recognizeUrl: "recognize:url";
    readonly toolsInfo: "tools:info";
    readonly toolsUpdateYtDlp: "tools:update-yt-dlp";
    readonly openExternal: "app:open-external";
    readonly openPath: "app:open-path";
    readonly clipboardLink: "app:clipboard-link";
    readonly navigate: "app:navigate";
};
//# sourceMappingURL=index.d.ts.map