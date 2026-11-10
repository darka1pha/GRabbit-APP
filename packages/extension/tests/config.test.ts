import { describe, it, expect } from 'vitest';
import {
  compareSemver,
  extractFileExtension,
  extractFilenameFromUrl,
  extractHostname,
  shouldInterceptDownload,
  DEFAULT_EXTENSION_CONFIG,
} from '../src/shared/config';
import type { ExtensionConfig } from '../src/types/extension';

describe('Extension Config & URL Helpers', () => {
  it('compares semantic versions accurately for update checks', () => {
    expect(compareSemver('1.1.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('v2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0);
  });
  it('extracts file extensions correctly including query content-disposition', () => {
    expect(extractFileExtension('archive.zip')).toBe('zip');
    expect(extractFileExtension('https://example.com/downloads/setup.exe')).toBe('exe');
    expect(extractFileExtension('https://example.com/video.mp4?token=123&quality=1080')).toBe('mp4');
    expect(extractFileExtension('https://example.com/image.png#preview')).toBe('png');
    expect(
      extractFileExtension(
        'https://objects.githubusercontent.com/github-production-release-asset/12345?response-content-disposition=attachment%3B%20filename%3DGRabbit-Setup-1.0.0.exe'
      )
    ).toBe('exe');
    expect(
      extractFilenameFromUrl(
        'https://objects.githubusercontent.com/github-production-release-asset/12345?response-content-disposition=attachment%3B%20filename%3DGRabbit-Setup-1.0.0.exe'
      )
    ).toBe('GRabbit-Setup-1.0.0.exe');
    expect(extractFileExtension('no-extension-here')).toBe('');
    expect(extractFileExtension('https://example.com/path/')).toBe('');
  });

  it('extracts hostnames correctly', () => {
    expect(extractHostname('https://github.com/torvalds/linux')).toBe('github.com');
    expect(extractHostname('http://sub.domain.org:8080/path')).toBe('sub.domain.org');
    expect(extractHostname('invalid-url')).toBe('');
  });

  describe('shouldInterceptDownload', () => {
    const config: ExtensionConfig = {
      ...DEFAULT_EXTENSION_CONFIG,
      interceptDownloads: true,
      interceptExtensions: ['zip', 'rar', '7z', 'iso', 'exe', 'mp4'],
      excludedDomains: ['localhost', 'mybank.com'],
      minFileSizeMB: 0,
    };

    it('intercepts matching extensions', () => {
      expect(
        shouldInterceptDownload('https://cdn.example.com/build.zip', 'build.zip', config)
      ).toBe(true);

      expect(
        shouldInterceptDownload('https://releases.ubuntu.com/ubuntu-24.04.iso', 'ubuntu-24.04.iso', config)
      ).toBe(true);

      expect(
        shouldInterceptDownload('https://example.com/video.mp4', 'video.mp4', config)
      ).toBe(true);
    });

    it('ignores non-intercepted extensions', () => {
      expect(
        shouldInterceptDownload('https://example.com/page.html', 'page.html', config)
      ).toBe(false);

      expect(
        shouldInterceptDownload('https://example.com/script.js', 'script.js', config)
      ).toBe(false);

      expect(
        shouldInterceptDownload('https://example.com/style.css', 'style.css', config)
      ).toBe(false);
    });

    it('respects excluded domains', () => {
      expect(
        shouldInterceptDownload('http://localhost:3000/archive.zip', 'archive.zip', config)
      ).toBe(false);

      expect(
        shouldInterceptDownload('https://mybank.com/statements/file.zip', 'file.zip', config)
      ).toBe(false);

      expect(
        shouldInterceptDownload('https://sub.mybank.com/file.zip', 'file.zip', config)
      ).toBe(false);
    });

    it('honors interceptDownloads toggle', () => {
      const disabledConfig = { ...config, interceptDownloads: false };
      expect(
        shouldInterceptDownload('https://example.com/file.zip', 'file.zip', disabledConfig)
      ).toBe(false);
    });

    it('respects minFileSizeMB threshold when file size is provided', () => {
      const sizeConfig = { ...config, minFileSizeMB: 10 }; // 10 MB minimum
      const fiveMB = 5 * 1024 * 1024;
      const twentyMB = 20 * 1024 * 1024;

      expect(
        shouldInterceptDownload('https://example.com/small.zip', 'small.zip', sizeConfig, fiveMB)
      ).toBe(false);

      expect(
        shouldInterceptDownload('https://example.com/large.zip', 'large.zip', sizeConfig, twentyMB)
      ).toBe(true);
    });

    it('intercepts redirected CDN downloads using originalUrl or binary MIME type when filename is empty', () => {
      // GitHub Release / S3 redirect where finalUrl has no extension in path and filename is still ""
      expect(
        shouldInterceptDownload(
          'https://objects.githubusercontent.com/github-production-release-asset/99999?X-Amz-Signature=abc',
          '',
          config,
          undefined,
          'https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-Setup-1.0.0.exe'
        )
      ).toBe(true);

      // Extensionless URL with binary MIME type
      expect(
        shouldInterceptDownload(
          'https://cdn.example.com/download/987654',
          '',
          config,
          undefined,
          undefined,
          'application/octet-stream'
        )
      ).toBe(true);
    });
  });
});

