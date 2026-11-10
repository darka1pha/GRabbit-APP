import { isIP } from 'node:net';
import type { PlatformId } from '../../shared/types';
import { InvalidUrlError } from './errors';

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

const HOSTS: Record<Exclude<PlatformId, 'generic'>, string[]> = {
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
    throw new InvalidUrlError('Malformed URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidUrlError('Only http:// and https:// links are supported');
  }
  return parsed;
}

export function parsePlatformUrl(inputUrl: string): ParsedPlatformUrl {
  const parsed = parseHttpUrl(inputUrl);
  const platform = detectPlatform(parsed.hostname);
  const clean = new URL(parsed.toString());

  switch (platform) {
    case 'youtube':
      for (const p of ['si', 'feature', 'utm_source', 'utm_medium', 'utm_campaign', 'pp']) clean.searchParams.delete(p);
      break;
    case 'soundcloud':
      clean.searchParams.delete('si');
      clean.searchParams.delete('utm_source');
      break;
    case 'twitter':
      if (clean.hostname === 'vxtwitter.com' || clean.hostname === 'fxtwitter.com') clean.hostname = 'x.com';
      clean.search = '';
      break;
    case 'spotify':
    case 'instagram':
    case 'tiktok':
    case 'reddit':
      clean.search = '';
      break;
    case 'generic':
      break;
  }
  return { originalUrl: inputUrl, normalizedUrl: clean.toString(), platform };
}

const PRIVATE_IP_RANGES = [
  /^127\./, // loopback
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // carrier-grade NAT
  /^169\.254\./, // link-local
  /^0\./,
  /^::1?$/, // IPv6 loopback / unspecified
  /^::ffff:/i, // IPv4-mapped IPv6
  /^f[cd][0-9a-f]{2}:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

/**
 * True for hostnames that name this machine or the local network. Checks the name as written
 * (no DNS lookup), so a public name that resolves to a private address is not caught.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  return isIP(host) !== 0 && PRIVATE_IP_RANGES.some((range) => range.test(host));
}
