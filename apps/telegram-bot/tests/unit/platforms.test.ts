import { describe, it, expect } from 'vitest';
import { parsePlatformUrl, extractUrlFromText } from '../../src/platforms/url-parser.js';
import { sanitizeFilename } from '../../src/security/filename.js';
import { PlatformRouter } from '../../src/platforms/platform-router.js';
import {
  extractMediaOptionsFromFormats,
  getYouTubeYtDlpExtraArgs,
} from '../../src/platforms/youtube/youtube-adapter.js';
import { InvalidUrlError, UnsupportedPlatformError } from '../../src/core/errors/domain-errors.js';
import { resetConfigForTesting } from '../../src/config/env.js';

describe('Platform URL Parser & Security', () => {
  it('extracts URLs from messages with extra text and strips trailing punctuation', () => {
    const text = 'Hey check out this video (https://youtu.be/dQw4w9WgXcQ). It is great!';
    const url = extractUrlFromText(text);
    expect(url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('correctly detects YouTube URLs and strips tracking parameters', () => {
    const raw = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=123456&feature=share';
    const parsed = parsePlatformUrl(raw);
    expect(parsed.platform).toBe('youtube');
    expect(parsed.normalizedUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('correctly detects YouTube Shorts', () => {
    const raw = 'https://youtube.com/shorts/abcdefgh123?si=test';
    const parsed = parsePlatformUrl(raw);
    expect(parsed.platform).toBe('youtube');
    expect(parsed.normalizedUrl).toBe('https://youtube.com/shorts/abcdefgh123');
  });

  it('correctly detects Spotify URLs', () => {
    const raw = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abcdef';
    const parsed = parsePlatformUrl(raw);
    expect(parsed.platform).toBe('spotify');
    expect(parsed.normalizedUrl).toBe('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  });

  it('correctly detects Instagram URLs', () => {
    const raw = 'https://www.instagram.com/reel/C3abc123/?igsh=test';
    const parsed = parsePlatformUrl(raw);
    expect(parsed.platform).toBe('instagram');
    expect(parsed.normalizedUrl).toBe('https://www.instagram.com/reel/C3abc123/');
  });

  it('correctly detects SoundCloud URLs', () => {
    const raw = 'https://soundcloud.com/artist/great-track?si=999';
    const parsed = parsePlatformUrl(raw);
    expect(parsed.platform).toBe('soundcloud');
    expect(parsed.normalizedUrl).toBe('https://soundcloud.com/artist/great-track');
  });

  it('correctly detects TikTok, X (Twitter), and Reddit URLs', () => {
    const tiktok = parsePlatformUrl('https://www.tiktok.com/@user/video/123456789?is_from_webapp=1');
    expect(tiktok.platform).toBe('tiktok');
    expect(tiktok.normalizedUrl).toBe('https://www.tiktok.com/@user/video/123456789');

    const twitter = parsePlatformUrl('https://vxtwitter.com/user/status/987654321?s=20');
    expect(twitter.platform).toBe('twitter');
    expect(twitter.normalizedUrl).toBe('https://x.com/user/status/987654321');

    const reddit = parsePlatformUrl('https://www.reddit.com/r/videos/comments/abc123/cool_clip/?utm_source=share');
    expect(reddit.platform).toBe('reddit');
    expect(reddit.normalizedUrl).toBe('https://www.reddit.com/r/videos/comments/abc123/cool_clip/');
  });

  it('blocks SSRF attempts to localhost, private IP ranges, IPv6 loopback, and cloud metadata', () => {
    expect(() => parsePlatformUrl('http://localhost:8080/media')).toThrow(InvalidUrlError);
    expect(() => parsePlatformUrl('http://127.0.0.1/video.mp4')).toThrow(InvalidUrlError);
    expect(() => parsePlatformUrl('http://[::1]:8080/video.mp4')).toThrow(InvalidUrlError);
    expect(() => parsePlatformUrl('http://[fd00::1]/video.mp4')).toThrow(InvalidUrlError);
    expect(() => parsePlatformUrl('http://169.254.169.254/latest/meta-data')).toThrow(InvalidUrlError);
    expect(() => parsePlatformUrl('http://192.168.1.100/stream')).toThrow(InvalidUrlError);
    expect(() => parsePlatformUrl('http://10.0.0.1/private')).toThrow(InvalidUrlError);
  });

  it('rejects unsupported platforms and non-http schemes', () => {
    expect(() => parsePlatformUrl('https://example.com/video.mp4')).toThrow(UnsupportedPlatformError);
    expect(() => parsePlatformUrl('ftp://youtube.com/watch?v=123')).toThrow(InvalidUrlError);
  });
});

describe('Filename Sanitization', () => {
  it('strips directory traversal and path separators', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\..\\etc\\passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Windows\\System32\\calc.exe')).toBe('calc.exe');
    expect(sanitizeFilename('/usr/local/bin/ffmpeg')).toBe('ffmpeg');
    expect(sanitizeFilename('folder/subfolder/song.mp3')).toBe('song.mp3');
    expect(sanitizeFilename('folder\\subfolder\\song.mp3')).toBe('song.mp3');
  });

  it('replaces dangerous and reserved characters', () => {
    expect(sanitizeFilename('my:cool<video>?*.mp4')).toBe('my_cool_video___.mp4');
  });

  it('falls back to default if empty or only dots', () => {
    expect(sanitizeFilename('...')).toBe('media');
    expect(sanitizeFilename('')).toBe('media');
  });
});

describe('PlatformRouter & Quality Extraction', () => {
  const router = new PlatformRouter();

  it('resolves registered adapters properly', () => {
    const res = router.resolveAdapter('https://youtu.be/dQw4w9WgXcQ');
    expect(res.adapter.platformId).toBe('youtube');
  });

  it('extracts all available video resolutions (144p through 2160p 4K) plus audio', () => {
    const options = extractMediaOptionsFromFormats({
      id: 'yt_4k',
      title: '4K Test Video',
      duration: 100,
      formats: [
        { vcodec: 'none', acodec: 'opus', filesize: 1_500_000 },
        { height: 144, vcodec: 'avc1', filesize: 1_000_000 },
        { height: 240, vcodec: 'avc1', filesize: 2_000_000 },
        { height: 360, vcodec: 'avc1', filesize: 4_000_000 },
        { height: 480, vcodec: 'avc1', filesize: 8_000_000 },
        { height: 720, vcodec: 'avc1', filesize: 15_000_000 },
        { height: 1080, vcodec: 'avc1', filesize: 30_000_000 },
        { height: 1440, vcodec: 'vp9', filesize: 60_000_000 },
        { height: 2160, vcodec: 'vp9', filesize: 120_000_000 },
      ],
    });

    const qualityIds = options.map((o) => o.qualityId);
    expect(qualityIds).toEqual([
      'bestaudio',
      '2160p',
      '1440p',
      '1080p',
      '720p',
      '480p',
      '360p',
      '240p',
      '144p',
    ]);
  });
});

describe('YouTube yt-dlp Args Configuration', () => {
  it('supplies extractor client bypass, js runtimes, and IPv4 force flag', () => {
    delete process.env.YTDLP_PROXY;
    delete process.env.YTDLP_YOUTUBE_CLIENTS;
    resetConfigForTesting();

    const args = getYouTubeYtDlpExtraArgs();
    expect(args).toContain('--extractor-args');
    expect(args).toContain('youtube:player_client=default');
    expect(args).toContain('--js-runtimes');
    expect(args).toContain('node');
    expect(args).toContain('-4');
  });

  it('supports custom proxy via YTDLP_PROXY environment variable', () => {
    process.env.YTDLP_PROXY = 'http://127.0.0.1:8080';
    resetConfigForTesting();

    const args = getYouTubeYtDlpExtraArgs();
    expect(args).toContain('--proxy');
    expect(args).toContain('http://127.0.0.1:8080');

    delete process.env.YTDLP_PROXY;
    resetConfigForTesting();
  });
});
