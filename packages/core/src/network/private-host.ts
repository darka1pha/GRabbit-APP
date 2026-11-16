/**
 * One shared answer to "does this host name or address point at this machine or a private
 * network?". Used by the desktop RPC bridge (for URLs a paired device asks the desktop to fetch,
 * including every redirect hop) and by the Telegram bot.
 *
 * Pure string logic with no Node imports, because the mobile app bundles @grabbit/core too.
 * It checks the name as written: callers that fetch by host name must also check what the name
 * resolves to.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Name suffixes that only ever mean "this machine" or "the local network". */
const LOCAL_NAME_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

function isPrivateIPv4(a: number, b: number): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

function isPrivateIPv6(host: string): boolean {
  return (
    host === '::' ||
    host === '::1' ||
    /^::ffff:/i.test(host) || // IPv4-mapped: refuse rather than decode
    /^f[cd][0-9a-f]{2}:/i.test(host) || // unique local fc00::/7
    /^fe[89ab][0-9a-f]:/i.test(host) || // link-local fe80::/10
    /^ff[0-9a-f]{2}:/i.test(host) // multicast
  );
}

/** True when `value` is an IPv4 or IPv6 literal (brackets allowed). */
export function isIpLiteral(value: string): boolean {
  const host = value.trim().replace(/^\[|\]$/g, '');
  const v4 = IPV4.exec(host);
  if (v4) return v4.slice(1).every((part) => Number(part) <= 255);
  return host.includes(':') && /^[0-9a-f:.]+$/i.test(host);
}

/**
 * True for names and addresses that reach this machine or the local network: localhost and
 * local-only suffixes, loopback, private, link-local, CGNAT, multicast and reserved ranges.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || LOCAL_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const v4 = IPV4.exec(host);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    return isPrivateIPv4(a, b);
  }
  if (host.includes(':')) return isPrivateIPv6(host);
  return false;
}
