import { PLATFORMS, PlatformId } from '../config/constants.js';
import { InvalidUrlError, UnsupportedPlatformError } from '../core/errors/domain-errors.js';
import { validateSafeUrl } from '../security/ssrf.js';

export interface ParsedPlatformUrl {
  originalUrl: string;
  normalizedUrl: string;
  platform: PlatformId;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;

export function extractUrlFromText(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(URL_REGEX);
  if (!match) return null;
  // Strip trailing sentence punctuation that users often include around pasted links
  return match[0].replace(/[.,!;?)]+$/, '');
}

export function parsePlatformUrl(inputUrl: string): ParsedPlatformUrl {
  let parsed: URL;
  try {
    parsed = validateSafeUrl(inputUrl);
  } catch (err) {
    throw new InvalidUrlError((err as Error).message, inputUrl);
  }

  const hostname = parsed.hostname.toLowerCase();

  // YouTube
  if (
    hostname === 'youtube.com' ||
    hostname === 'www.youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'music.youtube.com' ||
    hostname === 'youtu.be'
  ) {
    return {
      originalUrl: inputUrl,
      normalizedUrl: normalizeYouTubeUrl(parsed),
      platform: PLATFORMS.YOUTUBE,
    };
  }

  // Spotify
  if (hostname === 'open.spotify.com' || hostname === 'spotify.com') {
    return {
      originalUrl: inputUrl,
      normalizedUrl: normalizeSpotifyUrl(parsed),
      platform: PLATFORMS.SPOTIFY,
    };
  }

  // Instagram
  if (
    hostname === 'instagram.com' ||
    hostname === 'www.instagram.com' ||
    hostname === 'instagr.am' ||
    hostname === 'www.instagr.am'
  ) {
    return {
      originalUrl: inputUrl,
      normalizedUrl: normalizeInstagramUrl(parsed),
      platform: PLATFORMS.INSTAGRAM,
    };
  }

  // SoundCloud
  if (
    hostname === 'soundcloud.com' ||
    hostname === 'www.soundcloud.com' ||
    hostname === 'on.soundcloud.com' ||
    hostname === 'm.soundcloud.com'
  ) {
    return {
      originalUrl: inputUrl,
      normalizedUrl: normalizeSoundCloudUrl(parsed),
      platform: PLATFORMS.SOUNDCLOUD,
    };
  }

  // TikTok
  if (
    hostname === 'tiktok.com' ||
    hostname === 'www.tiktok.com' ||
    hostname === 'vm.tiktok.com' ||
    hostname === 'vt.tiktok.com' ||
    hostname === 'm.tiktok.com'
  ) {
    return {
      originalUrl: inputUrl,
      normalizedUrl: normalizeCleanQueryUrl(parsed),
      platform: PLATFORMS.TIKTOK,
    };
  }

  // X / Twitter
  if (
    hostname === 'twitter.com' ||
    hostname === 'www.twitter.com' ||
    hostname === 'mobile.twitter.com' ||
    hostname === 'x.com' ||
    hostname === 'www.x.com' ||
    hostname === 'vxtwitter.com' ||
    hostname === 'fxtwitter.com'
  ) {
    return {
      originalUrl: inputUrl,
      normalizedUrl: normalizeTwitterUrl(parsed),
      platform: PLATFORMS.TWITTER,
    };
  }

  // Reddit
  if (
    hostname === 'reddit.com' ||
    hostname === 'www.reddit.com' ||
    hostname === 'old.reddit.com' ||
    hostname === 'v.redd.it' ||
    hostname === 'redd.it'
  ) {
    return {
      originalUrl: inputUrl,
      normalizedUrl: normalizeCleanQueryUrl(parsed),
      platform: PLATFORMS.REDDIT,
    };
  }

  throw new UnsupportedPlatformError(`Unsupported platform for URL: ${inputUrl}`);
}

function normalizeYouTubeUrl(url: URL): string {
  // Strip tracking parameters
  const clean = new URL(url.toString());
  clean.searchParams.delete('si');
  clean.searchParams.delete('feature');
  clean.searchParams.delete('utm_source');
  clean.searchParams.delete('utm_medium');
  clean.searchParams.delete('utm_campaign');
  return clean.toString();
}

function normalizeSpotifyUrl(url: URL): string {
  const clean = new URL(url.toString());
  clean.search = '';
  return clean.toString();
}

function normalizeInstagramUrl(url: URL): string {
  const clean = new URL(url.toString());
  clean.search = '';
  return clean.toString();
}

function normalizeSoundCloudUrl(url: URL): string {
  const clean = new URL(url.toString());
  clean.searchParams.delete('si');
  clean.searchParams.delete('utm_source');
  return clean.toString();
}

function normalizeCleanQueryUrl(url: URL): string {
  const clean = new URL(url.toString());
  clean.search = '';
  return clean.toString();
}

function normalizeTwitterUrl(url: URL): string {
  const clean = new URL(url.toString());
  if (clean.hostname === 'vxtwitter.com' || clean.hostname === 'fxtwitter.com') {
    clean.hostname = 'x.com';
  }
  clean.search = '';
  return clean.toString();
}
