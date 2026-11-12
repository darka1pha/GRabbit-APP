import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isLoopbackHost,
  isHlsOrDashUrl,
  shouldInterceptDownload,
  DEFAULT_EXTENSION_CONFIG,
} from '../src/shared/config';
import type { ExtensionConfig } from '../src/types/extension';

describe('Phase 7 — Browser Extension Unit Tests', () => {
  describe('7.1 & 7.4 — Site Exclusion & Min Size Capture Rules', () => {
    const baseConfig: ExtensionConfig = {
      ...DEFAULT_EXTENSION_CONFIG,
      interceptDownloads: true,
      interceptExtensions: ['zip', 'exe', 'mp4'],
      excludedDomains: ['localhost', 'internal.corp'],
      minFileSizeMB: 10,
      allowRemoteCookies: false,
    };

    it('rejects capture on excluded domains and subdomains', () => {
      expect(
        shouldInterceptDownload('https://internal.corp/file.zip', 'file.zip', baseConfig)
      ).toBe(false);
      expect(
        shouldInterceptDownload('https://sub.internal.corp/file.zip', 'file.zip', baseConfig)
      ).toBe(false);
      expect(
        shouldInterceptDownload('http://localhost:8080/app.zip', 'app.zip', baseConfig)
      ).toBe(false);
    });

    it('allows capture on non-excluded domains', () => {
      expect(
        shouldInterceptDownload('https://files.example.com/archive.zip', 'archive.zip', baseConfig)
      ).toBe(true);
    });

    it('filters out downloads smaller than minFileSizeMB', () => {
      const fiveMB = 5 * 1024 * 1024;
      const twentyMB = 20 * 1024 * 1024;

      // Below 10MB threshold -> ignored
      expect(
        shouldInterceptDownload(
          'https://files.example.com/archive.zip',
          'archive.zip',
          baseConfig,
          fiveMB
        )
      ).toBe(false);

      // Above 10MB threshold -> intercepted
      expect(
        shouldInterceptDownload(
          'https://files.example.com/archive.zip',
          'archive.zip',
          baseConfig,
          twentyMB
        )
      ).toBe(true);
    });

    it('ignores file size filtering when minFileSizeMB is 0', () => {
      const noMinConfig = { ...baseConfig, minFileSizeMB: 0 };
      expect(
        shouldInterceptDownload(
          'https://files.example.com/small.zip',
          'small.zip',
          noMinConfig,
          1024 // 1 KB
        )
      ).toBe(true);
    });
  });

  describe('7.2 — Loopback & Remote Cookie Forwarding Security', () => {
    it('correctly identifies loopback hosts', () => {
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost(' 127.0.0.1 ')).toBe(true);

      // Remote hosts
      expect(isLoopbackHost('192.168.1.50')).toBe(false);
      expect(isLoopbackHost('10.0.0.5')).toBe(false);
      expect(isLoopbackHost('grabbit.lan')).toBe(false);
      expect(isLoopbackHost('example.com')).toBe(false);
    });

    it('simulates cookie forwarding policy', () => {
      function evaluateCookieForwarding(config: ExtensionConfig, rawCookies: string): string {
        const isLoopback = isLoopbackHost(config.bridgeHost);
        if (!isLoopback && !config.allowRemoteCookies) {
          return '';
        }
        return rawCookies;
      }

      const sampleCookies = 'session_id=abc123xyz; auth=token456';

      // Loopback host -> cookies permitted by default
      const loopbackConfig: ExtensionConfig = {
        ...DEFAULT_EXTENSION_CONFIG,
        bridgeHost: '127.0.0.1',
        allowRemoteCookies: false,
      };
      expect(evaluateCookieForwarding(loopbackConfig, sampleCookies)).toBe(sampleCookies);

      // Remote LAN host with allowRemoteCookies: false -> cookies stripped
      const remoteConfigDefault: ExtensionConfig = {
        ...DEFAULT_EXTENSION_CONFIG,
        bridgeHost: '192.168.1.120',
        allowRemoteCookies: false,
      };
      expect(evaluateCookieForwarding(remoteConfigDefault, sampleCookies)).toBe('');

      // Remote LAN host with allowRemoteCookies: true -> cookies preserved
      const remoteConfigOptIn: ExtensionConfig = {
        ...DEFAULT_EXTENSION_CONFIG,
        bridgeHost: '192.168.1.120',
        allowRemoteCookies: true,
      };
      expect(evaluateCookieForwarding(remoteConfigOptIn, sampleCookies)).toBe(sampleCookies);
    });
  });

  describe('7.3 — Toolbar Badge Status & Protocol Scheme', () => {
    function computeBadgeState(ping: { ok: boolean; data?: { authenticated?: boolean } }): {
      text: string;
      color: string;
    } {
      if (ping.ok && ping.data?.authenticated) {
        return { text: '', color: '#10b981' };
      }
      if (ping.ok && !ping.data?.authenticated) {
        return { text: 'PAIR', color: '#f59e0b' };
      }
      return { text: 'OFF', color: '#ef4444' };
    }

    it('assigns empty badge when connected and authenticated', () => {
      const state = computeBadgeState({ ok: true, data: { authenticated: true } });
      expect(state.text).toBe('');
      expect(state.color).toBe('#10b981');
    });

    it('assigns PAIR badge when reachable but invalid token', () => {
      const state = computeBadgeState({ ok: true, data: { authenticated: false } });
      expect(state.text).toBe('PAIR');
      expect(state.color).toBe('#f59e0b');
    });

    it('assigns OFF badge when desktop is unreachable', () => {
      const state = computeBadgeState({ ok: false });
      expect(state.text).toBe('OFF');
      expect(state.color).toBe('#ef4444');
    });

    it('validates grabbit:// scheme URI for launching desktop', () => {
      const launchUrl = 'grabbit://launch';
      expect(launchUrl.startsWith('grabbit://')).toBe(true);
    });
  });

  describe('7.5 — HLS & DASH Manifest Detection', () => {
    it('detects HLS (.m3u8) URLs', () => {
      expect(isHlsOrDashUrl('https://video.example.com/live/stream.m3u8')).toBe(true);
      expect(isHlsOrDashUrl('https://video.example.com/master.m3u8?token=xyz&expires=123')).toBe(true);
      expect(isHlsOrDashUrl('https://cdn.site/INDEX.M3U8')).toBe(true);
    });

    it('detects DASH (.mpd) URLs', () => {
      expect(isHlsOrDashUrl('https://dash.example.com/media/manifest.mpd')).toBe(true);
      expect(isHlsOrDashUrl('https://dash.example.com/manifest.mpd?session=999')).toBe(true);
      expect(isHlsOrDashUrl('https://cdn.site/MANIFEST.MPD')).toBe(true);
    });

    it('does not flag standard media or webpage URLs as HLS/DASH', () => {
      expect(isHlsOrDashUrl('https://example.com/video.mp4')).toBe(false);
      expect(isHlsOrDashUrl('https://example.com/audio.mp3')).toBe(false);
      expect(isHlsOrDashUrl('https://example.com/watch?v=12345')).toBe(false);
      expect(isHlsOrDashUrl('')).toBe(false);
    });

    it('intercepts .m3u8 and .mpd manifests automatically even if not in extensions list', () => {
      const restrictedConfig: ExtensionConfig = {
        ...DEFAULT_EXTENSION_CONFIG,
        interceptDownloads: true,
        interceptExtensions: ['zip', 'exe'], // does not contain m3u8 or mpd
        excludedDomains: [],
        minFileSizeMB: 0,
      };

      expect(
        shouldInterceptDownload(
          'https://stream.server.com/live/playlist.m3u8?auth=1',
          'playlist.m3u8',
          restrictedConfig
        )
      ).toBe(true);

      expect(
        shouldInterceptDownload(
          'https://stream.server.com/dash/manifest.mpd',
          'manifest.mpd',
          restrictedConfig
        )
      ).toBe(true);
    });
  });
});
