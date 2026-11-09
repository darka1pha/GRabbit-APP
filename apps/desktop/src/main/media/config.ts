/** Runtime configuration for the media layer, filled from the app settings and binary paths. */
export interface MediaRuntimeConfig {
  ytdlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  /** Folder holding both ffmpeg.exe and ffprobe.exe (passed to yt-dlp). */
  ffmpegDir: string;
  /** JavaScript runtime yt-dlp uses for YouTube's player challenges. */
  jsRuntime?: { path: string; env: Record<string, string> };
  proxy: string;
  cookiesFile: string;
  cookiesFromBrowser: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
  instagramSessionId: string;
  tempDir: string;
  forceIpv4: boolean;
}

let config: MediaRuntimeConfig = {
  ytdlpPath: 'yt-dlp',
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  ffmpegDir: '',
  proxy: '',
  cookiesFile: '',
  cookiesFromBrowser: '',
  spotifyClientId: '',
  spotifyClientSecret: '',
  instagramSessionId: '',
  tempDir: '',
  forceIpv4: true,
};

export function getMediaConfig(): MediaRuntimeConfig {
  return config;
}

export function setMediaConfig(patch: Partial<MediaRuntimeConfig>): void {
  config = { ...config, ...patch };
}
