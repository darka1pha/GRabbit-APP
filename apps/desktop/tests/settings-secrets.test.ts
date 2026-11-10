import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: {
    getLocale: () => 'en-US',
    getPath: () => '/mock',
  },
}));

import { SettingsService, type SecretCodec } from '../src/main/settings';

/** Reversible stand-in for OS encryption. */
const codec: SecretCodec = {
  available: () => true,
  encrypt: (plain) => Buffer.from(`sealed:${plain}`).toString('base64'),
  decrypt: (stored) => {
    const text = Buffer.from(stored, 'base64').toString();
    if (!text.startsWith('sealed:')) throw new Error('not ours');
    return text.slice('sealed:'.length);
  },
};

describe('settings credentials at rest', () => {
  let dir: string;
  const file = () => join(dir, 'settings.json');
  const onDisk = () => JSON.parse(readFileSync(file(), 'utf8'));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'grabbit-secrets-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes credentials encrypted and reads them back', () => {
    const first = new SettingsService(dir, codec);
    first.unlockSecrets();
    first.update({
      extension: { token: 'bridge-token' },
      media: { spotifyClientSecret: 'spotify-secret', instagramSessionId: 'insta-session', spotifyClientId: 'public-id' },
    });
    first.flush();

    const raw = readFileSync(file(), 'utf8');
    for (const secret of ['bridge-token', 'spotify-secret', 'insta-session']) expect(raw).not.toContain(secret);
    expect(onDisk().extension.token).toMatch(/^enc:v1:/);
    expect(onDisk().media.spotifyClientId).toBe('public-id');

    const second = new SettingsService(dir, codec);
    second.unlockSecrets();
    expect(second.get().extension.token).toBe('bridge-token');
    expect(second.get().media.spotifyClientSecret).toBe('spotify-secret');
    expect(second.get().media.instagramSessionId).toBe('insta-session');
  });

  it('keeps empty credentials empty', () => {
    const svc = new SettingsService(dir, codec);
    svc.unlockSecrets();
    svc.flush();
    expect(onDisk().media.spotifyClientSecret).toBe('');
  });

  it('migrates a plain-text settings file from an older version', () => {
    writeFileSync(file(), JSON.stringify({ extension: { token: 'old-plain-token' }, media: { spotifyClientSecret: 'old-secret' } }));
    const svc = new SettingsService(dir, codec);
    svc.unlockSecrets();
    expect(svc.get().extension.token).toBe('old-plain-token');
    svc.flush();
    expect(readFileSync(file(), 'utf8')).not.toContain('old-plain-token');
    expect(readFileSync(file(), 'utf8')).not.toContain('old-secret');
  });

  it('clears a credential it cannot decrypt and issues a new bridge token', () => {
    writeFileSync(
      file(),
      JSON.stringify({
        extension: { token: 'enc:v1:' + Buffer.from('from another machine').toString('base64') },
        media: { instagramSessionId: 'enc:v1:' + Buffer.from('garbage').toString('base64') },
      })
    );
    const svc = new SettingsService(dir, codec);
    svc.unlockSecrets();
    expect(svc.get().media.instagramSessionId).toBe('');
    expect(svc.get().extension.token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('falls back to plain text when OS encryption is unavailable', () => {
    const svc = new SettingsService(dir, { ...codec, available: () => false });
    svc.unlockSecrets();
    svc.update({ extension: { token: 'kept-plain' } });
    svc.flush();
    expect(onDisk().extension.token).toBe('kept-plain');
  });
});
