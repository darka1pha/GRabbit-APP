import type { PlatformId } from '../../shared/types';
import { detectPlatform } from '@grabbit/core';
import { InvalidUrlError } from './errors';

export interface ParsedPlatformUrl {
  originalUrl: string;
  normalizedUrl: string;
  platform: PlatformId;
}

// URL extraction and platform detection are shared with the bot and mobile app
export { detectPlatform, extractUrlFromText, HOSTS } from '@grabbit/core';

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

/**
 * Shared with the bot and mobile: see @grabbit/core network/private-host. Checks the name as
 * written (no DNS lookup), so callers must also check what a name resolves to.
 */
export { isPrivateHost } from '@grabbit/core';
