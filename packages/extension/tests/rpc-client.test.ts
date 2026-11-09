import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionRpcClient } from '../src/shared/rpc-client';
import type { ExtensionConfig } from '../src/types/extension';

describe('ExtensionRpcClient', () => {
  const config: ExtensionConfig = {
    bridgeHost: '127.0.0.1',
    bridgePort: 31542,
    bridgeToken: 'test-secret-token',
    interceptDownloads: true,
    interceptExtensions: ['zip', 'exe'],
    excludedDomains: [],
    enableVideoSniffer: true,
    minFileSizeMB: 0,
  };

  let client: ExtensionRpcClient;

  beforeEach(() => {
    client = new ExtensionRpcClient(config);
    vi.restoreAllMocks();
  });

  it('sends correct headers and handles successful ping', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers || {};
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            app: 'gRabbit',
            version: '1.0.0',
            authenticated: true,
            port: 31542,
          }),
      } as unknown as Response);
    });

    const res = await client.ping();
    expect(res.ok).toBe(true);
    expect(res.data?.app).toBe('gRabbit');
    expect(capturedUrl).toBe('http://127.0.0.1:31542/ping');
    expect(capturedHeaders['X-GRabbit-Token']).toBe('test-secret-token');
    expect(capturedHeaders['Authorization']).toBe('Bearer test-secret-token');
  });

  it('handles addDownload with JSON body', async () => {
    let capturedBody = '';

    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedBody = String(init?.body);
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            item: { id: 'item-1', fileName: 'sample.zip' },
          }),
      } as unknown as Response);
    });

    const res = await client.addDownload({
      url: 'https://example.com/sample.zip',
      fileName: 'sample.zip',
      cookies: 'session=xyz',
    });

    expect(res.success).toBe(true);
    expect(res.item?.fileName).toBe('sample.zip');
    const parsed = JSON.parse(capturedBody);
    expect(parsed.url).toBe('https://example.com/sample.zip');
    expect(parsed.cookies).toBe('session=xyz');
  });

  it('handles network error cleanly', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const res = await client.ping();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Connection refused');
  });
});
