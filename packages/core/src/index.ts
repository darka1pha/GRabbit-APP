export * from './platforms/track-matcher';
export * from './platforms/track-page';
export * from './platforms/url-parser';
export * from './platforms/media-options';

import { PlatformId } from '@grabbit/types';
import { detectPlatform, parseHttpUrl } from './platforms/url-parser';

/**
 * Identify platform from a URL string.
 */
export function identifyPlatform(url: string): PlatformId {
  try {
    const parsed = parseHttpUrl(url);
    return detectPlatform(parsed.hostname);
  } catch {
    return 'generic';
  }
}

/**
 * Split a byte range into segmented chunk boundaries.
 */
export function computeSegments(totalBytes: number, segmentCount: number) {
  if (totalBytes <= 0 || segmentCount <= 1) {
    return [{ id: 0, startByte: 0, endByte: Math.max(0, totalBytes - 1) }];
  }

  const chunkSize = Math.floor(totalBytes / segmentCount);
  const segments = [];

  for (let i = 0; i < segmentCount; i++) {
    const startByte = i * chunkSize;
    const endByte = i === segmentCount - 1 ? totalBytes - 1 : (i + 1) * chunkSize - 1;
    segments.push({
      id: i,
      startByte,
      endByte,
    });
  }

  return segments;
}

export * from '@grabbit/types';
export * from '@grabbit/utils';
