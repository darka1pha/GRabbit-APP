export const SUPPORTED_PLATFORMS = [
    { id: 'youtube', label: 'YouTube', icon: 'youtube' },
    { id: 'spotify', label: 'Spotify', icon: 'spotify' },
    { id: 'instagram', label: 'Instagram', icon: 'instagram' },
    { id: 'soundcloud', label: 'SoundCloud', icon: 'cloud' },
    { id: 'tiktok', label: 'TikTok', icon: 'music' },
    { id: 'twitter', label: 'X (Twitter)', icon: 'twitter' },
    { id: 'reddit', label: 'Reddit', icon: 'message-square' },
    { id: 'generic', label: 'Direct / Other URL', icon: 'link' },
];
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const DEFAULT_APP_SETTINGS = {
    language: 'en',
    theme: 'system',
    downloadDir: '',
    categorySubfolders: true,
    maxConcurrent: 3,
    defaultConnections: 8,
    maxRetries: 3,
    globalSpeedLimitKBps: 0,
    clipboardMonitor: true,
    notifications: true,
    closeToTray: true,
    resumeOnStartup: true,
    userAgent: DEFAULT_USER_AGENT,
    proxy: '',
    afterQueue: 'none',
    scheduler: {
        enabled: false,
        startTime: '02:00',
        stopTime: '08:00',
    },
    media: {
        defaultAudioFormat: 'mp3',
        defaultVideoQuality: '1080p',
        cookiesFromBrowser: '',
        cookiesFile: '',
        spotifyClientId: '',
        spotifyClientSecret: '',
        instagramSessionId: '',
    },
    extension: {
        enabled: true,
        port: 31542,
        token: 'grabbit-token-local',
        autoCapture: true,
    },
};
export const DEFAULT_RPC_PORT = 31542;
export const DEFAULT_INTERCEPTED_EXTENSIONS = [
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img',
    'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk',
    'mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'ts', 'm4v',
    'mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'opus',
    'pdf', 'epub', 'bin', 'torrent'
];
export const DOWNLOAD_CATEGORIES = [
    { id: 'video', label: 'Video', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi'] },
    { id: 'music', label: 'Music', extensions: ['mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg'] },
    { id: 'documents', label: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'epub'] },
    { id: 'compressed', label: 'Compressed', extensions: ['zip', 'rar', '7z', 'tar', 'gz'] },
    { id: 'programs', label: 'Programs', extensions: ['exe', 'msi', 'dmg', 'pkg', 'apk'] },
    { id: 'images', label: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'] },
    { id: 'other', label: 'Other', extensions: [] },
];
//# sourceMappingURL=index.js.map