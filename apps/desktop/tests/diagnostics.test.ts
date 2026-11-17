import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDiagnosticsReport, redactHome, redactLogText, redactSettings } from '../src/main/diagnostics';

const HOME = 'C:\\Users\\Alice';

describe('diagnostics redaction', () => {
  it('hides secrets in settings, at any depth', () => {
    const out = redactSettings(
      {
        extension: { token: 'abc123', port: 31542 },
        media: { spotifyClientSecret: 'shh', instagramSessionId: 'sess', spotifyClientId: 'public-id' },
        proxy: 'http://bob:hunter2@proxy.example:8080',
        downloadDir: 'C:\\Users\\Alice\\Downloads',
        emptyToken: { token: '' },
      },
      '',
      HOME
    ) as any;
    expect(out.extension).toEqual({ token: '[redacted]', port: 31542 });
    expect(out.media.spotifyClientSecret).toBe('[redacted]');
    expect(out.media.instagramSessionId).toBe('[redacted]');
    expect(out.media.spotifyClientId).toBe('public-id');
    expect(out.proxy).toBe('http://[redacted]@proxy.example:8080');
    expect(out.downloadDir).toBe('~\\Downloads');
    expect(out.emptyToken.token).toBe('');
  });

  it('keeps the site but drops queries, credentials, cookies and magnets from log lines', () => {
    const line =
      'WARN Segment failed {"url":"https://cdn.example.com/f.zip?sig=SECRET&exp=1","cookie":"sid=abc","path":"C:\\\\Users\\\\Alice\\\\Downloads\\\\x"} magnet:?xt=urn:btih:abcd token=xyz';
    const out = redactLogText(line, HOME);
    expect(out).toContain('https://cdn.example.com/f.zip?[removed]');
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('sid=abc');
    expect(out).not.toContain('btih');
    expect(out).not.toContain('xyz');
    expect(out).not.toContain('Alice');
  });

  it('matches the home folder in any case and slash style', () => {
    expect(redactHome('c:\\users\\alice\\x and C:/Users/Alice/y', HOME)).toBe('~\\x and ~/y');
  });
});

describe('diagnostics report', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'grabbit-diag-'));
  afterAll(() => rmSync(logDir, { recursive: true, force: true }));

  it('summarises downloads by status without listing them', () => {
    writeFileSync(join(logDir, 'main.log'), 'INFO started https://example.com/a?token=1\n');
    const report = buildDiagnosticsReport({
      appVersion: '9.9.9',
      settings: { extension: { token: 'abc' } },
      items: [
        { status: 'completed', kind: 'http' },
        { status: 'completed', kind: 'media' },
        { status: 'error', kind: 'http' },
      ],
      logDir,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(report).toContain('GRabbit: 9.9.9');
    expect(report).toContain('"completed":2');
    expect(report).toContain('"error":1');
    expect(report).toContain('https://example.com/a?[removed]');
    expect(report).not.toContain('abc');
  });
});
