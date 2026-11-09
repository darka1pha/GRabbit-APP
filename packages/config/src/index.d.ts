import { AppSettings, PlatformId } from '@grabbit/types';
export declare const SUPPORTED_PLATFORMS: Array<{
    id: PlatformId;
    label: string;
    icon: string;
}>;
export declare const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export declare const DEFAULT_APP_SETTINGS: AppSettings;
export declare const DEFAULT_RPC_PORT = 31542;
export declare const DEFAULT_INTERCEPTED_EXTENSIONS: string[];
export declare const DOWNLOAD_CATEGORIES: readonly [{
    readonly id: "video";
    readonly label: "Video";
    readonly extensions: readonly ["mp4", "mkv", "webm", "mov", "avi"];
}, {
    readonly id: "music";
    readonly label: "Music";
    readonly extensions: readonly ["mp3", "m4a", "flac", "wav", "aac", "ogg"];
}, {
    readonly id: "documents";
    readonly label: "Documents";
    readonly extensions: readonly ["pdf", "doc", "docx", "txt", "epub"];
}, {
    readonly id: "compressed";
    readonly label: "Compressed";
    readonly extensions: readonly ["zip", "rar", "7z", "tar", "gz"];
}, {
    readonly id: "programs";
    readonly label: "Programs";
    readonly extensions: readonly ["exe", "msi", "dmg", "pkg", "apk"];
}, {
    readonly id: "images";
    readonly label: "Images";
    readonly extensions: readonly ["jpg", "jpeg", "png", "webp", "gif", "svg"];
}, {
    readonly id: "other";
    readonly label: "Other";
    readonly extensions: readonly [];
}];
//# sourceMappingURL=index.d.ts.map