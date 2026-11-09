import { PlatformId } from '@grabbit/types';

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
  return match[0].replace(/[.,!;?)]+$/, '');
}

export const HOSTS: Record<Exclude<PlatformId, 'generic'>, string[]> = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'],
  spotify: ['open.spotify.com', 'spotify.com'],
  instagram: ['instagram.com', 'www.instagram.com', 'instagr.am', 'www.instagr.am'],
  soundcloud: ['soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com', 'm.soundcloud.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'],
  twitter: ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com', 'vxtwitter.com', 'fxtwitter.com'],
  reddit: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'v.redd.it', 'redd.it'],
};

export function detectPlatform(hostname: string): PlatformId {
  const host = hostname.toLowerCase();
  for (const [platform, hosts] of Object.entries(HOSTS)) {
    if (hosts.includes(host)) return platform as PlatformId;
  }
  return 'generic';
}

export function parseHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error('Malformed URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// links are supported');
  }
  return parsed;
}

export function parsePlatformUrl(inputUrl: string): ParsedPlatformUrl {
  const parsed = parseHttpUrl(inputUrl);
  const platform = detectPlatform(parsed.hostname);
  return {
    originalUrl: inputUrl,
    normalizedUrl: parsed.toString(),
    platform,
  };
}

