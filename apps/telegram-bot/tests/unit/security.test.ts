import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}));

import {
  isPrivateOrBlockedHost,
  validateSafeUrl,
  assertSafePublicUrl,
} from '../../src/security/ssrf.js';

describe('SSRF Protection', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('blocks localhost and private IP literals synchronously', () => {
    expect(isPrivateOrBlockedHost('localhost')).toBe(true);
    expect(isPrivateOrBlockedHost('127.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedHost('169.254.169.254')).toBe(true);
    expect(isPrivateOrBlockedHost('[::1]')).toBe(true);
    expect(() => validateSafeUrl('http://127.0.0.1/admin')).toThrow();
    expect(() => validateSafeUrl('file:///etc/passwd')).toThrow();
  });

  it('blocks hostnames whose DNS records resolve to private/loopback ranges', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(assertSafePublicUrl('https://rebind.example.com/hook')).rejects.toThrow(
      'restricted address'
    );

    lookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    await expect(assertSafePublicUrl('https://metadata.example.com/latest')).rejects.toThrow(
      'restricted address'
    );

    lookupMock.mockResolvedValueOnce([{ address: 'fd00::1', family: 6 }]);
    await expect(assertSafePublicUrl('https://v6local.example.com/')).rejects.toThrow(
      'restricted address'
    );
  });

  it('allows public hostnames resolving to public IP addresses', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const parsed = await assertSafePublicUrl('https://example.com/video');
    expect(parsed.hostname).toBe('example.com');
  });
});

