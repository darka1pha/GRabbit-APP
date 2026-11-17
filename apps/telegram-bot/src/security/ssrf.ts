import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateHost } from '@grabbit/core';

/**
 * True for names and addresses that reach this machine or a private network. One implementation
 * shared with the desktop RPC bridge, in @grabbit/core.
 */
export function isPrivateOrBlockedHost(hostname: string): boolean {
  return isPrivateHost(hostname);
}

export function validateSafeUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Malformed URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Unsupported URL protocol. Only http: and https: are allowed.');
  }

  if (isPrivateOrBlockedHost(parsed.hostname)) {
    throw new Error('Destination host is restricted for security.');
  }

  return parsed;
}

/**
 * Validates URL syntax/protocol/host AND resolves DNS records to block
 * hostnames that point to private, loopback, or link-local IP ranges.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const parsed = validateSafeUrl(rawUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname)) {
    return parsed;
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new Error('Could not resolve destination host.');
  }

  for (const record of records) {
    if (isPrivateOrBlockedHost(record.address)) {
      throw new Error('Destination host resolves to a restricted address.');
    }
  }

  return parsed;
}
