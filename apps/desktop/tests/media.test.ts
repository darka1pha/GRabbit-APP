import { describe, expect, it } from 'vitest';
import { parseProgressLine } from '../src/main/media/ytdlp-runner';
import { detectPlatform, extractUrlFromText, parsePlatformUrl } from '../src/main/media/url-parser';
import { sanitizeFilename } from '../src/main/media/filename';
import { pickBestMatch } from '../src/main/media/platforms/track-matcher';
import { categoryForFileName, looksLikeDirectFile } from '../src/main/downloads/categories';
import { uniqueFileName, algorithmForDigest } from '../src/main/downloads/files';

describe('yt-dlp progress', () => {
  it('parses the numeric progress template', () => {
    const p = parseProgressLine('GRABBIT_PROGRESS| 42.0%|1048576|2097152|NA|524288.5|2');
    expect(p).toEqual({ percent: 42, downloadedBytes: 1048576, totalBytes: 2097152, speed: 524288.5, eta: 2 });
  });

  it('falls back to the size estimate and computes the percent', () => {
    const p = parseProgressLine('GRABBIT_PROGRESS|NA|500|NA|1000|NA|NA');
    expect(p?.percent).toBe(50);
    expect(p?.totalBytes).toBe(1000);
  });

  it('ignores other lines', () => {
    expect(parseProgressLine('[download] Destination: x.webm')).toBeNull();
  });
});

describe('URL handling', () => {
  it('detects platforms and falls back to generic', () => {
    expect(detectPlatform('www.youtube.com')).toBe('youtube');
    expect(detectPlatform('open.spotify.com')).toBe('spotify');
    expect(detectPlatform('x.com')).toBe('twitter');
    expect(detectPlatform('vimeo.com')).toBe('generic');
  });

  it('strips tracking parameters', () => {
    expect(parsePlatformUrl('https://youtu.be/abc?si=xyz').normalizedUrl).toBe('https://youtu.be/abc');
    expect(parsePlatformUrl('https://fxtwitter.com/a/status/1?s=20').normalizedUrl).toBe('https://x.com/a/status/1');
  });

  it('pulls a link out of pasted text', () => {
    expect(extractUrlFromText('look: https://example.com/a.zip).')).toBe('https://example.com/a.zip');
  });

  it('rejects non-http links', () => {
    expect(() => parsePlatformUrl('file:///C:/Windows')).toThrow();
  });
});

describe('file names', () => {
  it('makes Windows-safe names', () => {
    expect(sanitizeFilename('a/b\\c:d*?.mp3')).toBe('c_d__.mp3');
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFilename('name. ')).toBe('name');
    expect(sanitizeFilename('')).toBe('download');
  });

  it('numbers duplicates', () => {
    const reserved = new Set(['song.mp3', 'song (1).mp3']);
    expect(uniqueFileName('Z:\\nowhere', 'song.mp3', reserved)).toBe('song (2).mp3');
  });

  it('categorizes by extension', () => {
    expect(categoryForFileName('movie.MKV')).toBe('video');
    expect(categoryForFileName('setup.exe')).toBe('programs');
    expect(categoryForFileName('README')).toBe('other');
    expect(looksLikeDirectFile('https://cdn.example.com/files/app.zip?token=1')).toBe(true);
    expect(looksLikeDirectFile('https://www.youtube.com/watch?v=1')).toBe(false);
  });

  it('guesses the checksum algorithm', () => {
    expect(algorithmForDigest('d41d8cd98f00b204e9800998ecf8427e')).toBe('md5');
    expect(algorithmForDigest('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe('sha256');
    expect(algorithmForDigest('xyz')).toBeNull();
  });
});

describe('Spotify → YouTube matching', () => {
  it('prefers the official recording over covers and wrong durations', () => {
    const track = { title: 'Never Gonna Give You Up', artists: ['Rick Astley'], durationSeconds: 213 };
    const best = pickBestMatch(track, [
      { url: 'a', title: 'Never Gonna Give You Up (Piano Cover)', channel: 'Pianist', duration: 200 },
      { url: 'b', title: 'Never Gonna Give You Up (sped up)', channel: 'Edits', duration: 160 },
      { url: 'c', title: 'Never Gonna Give You Up', channel: 'Rick Astley', duration: 214, source: 'youtube-music' as const },
    ]);
    expect(best?.candidate.url).toBe('c');
  });
});
