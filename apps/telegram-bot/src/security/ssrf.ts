import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_IP_RANGES = [
  /^127\./, // Loopback
  /^10\./, // 10.0.0.0/8
  /^192\.168\./, // 192.168.0.0/16
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // 100.64.0.0/10 CGNAT
  /^169\.254\./, // Link-local & cloud metadata
  /^0\./, // Current network
  /^::1$/, // IPv6 loopback
  /^::$/, // IPv6 unspecified
  /^::ffff:/i, // IPv4-mapped IPv6
  /^f[cd][0-9a-f]{2}:/i, // IPv6 unique local (fc00::/7)
  /^fe80:/i, // IPv6 link-local
];

export function isPrivateOrBlockedHost(hostname: string): boolean {
  // Strip IPv6 square brackets if present (URL.hostname preserves brackets for IPv6)
  const normalized = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }

  // Check IP addresses
  if (isIP(normalized)) {
    return PRIVATE_IP_RANGES.some((regex) => regex.test(normalized));
  }

  return false;
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
