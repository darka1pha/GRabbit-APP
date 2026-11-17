/**
 * End-to-end smoke test: launches the built app in a throwaway profile, adds a direct link served
 * by a local HTTP server, and waits until the file is complete on disk with the right bytes.
 * Catches packaging, preload/IPC and renderer wiring breaks that unit tests cannot see.
 *
 * Run with `pnpm --filter grabbit-desktop test:e2e` (builds first). Needs a desktop session.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const appDir = resolve(__dirname, '..', '..');
const electronPath = createRequire(join(appDir, 'package.json'))('electron') as unknown as string;

const payload = randomBytes(3 * 1024 * 1024 + 123);
const payloadHash = createHash('sha256').update(payload).digest('hex');

let server: http.Server;
let baseUrl: string;
let profileDir: string;
let downloadDir: string;
let app: ElectronApplication;
let page: Page;

/** Serves one file with byte-range support, like a real download host. */
function startFileServer(): Promise<void> {
  server = http.createServer((req, res) => {
    if (req.url !== '/smoke.bin') {
      res.writeHead(404).end();
      return;
    }
    const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', ETag: '"smoke"' };
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), payload.length - 1) : payload.length - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${payload.length}`, 'Content-Length': end - start + 1 });
      res.end(req.method === 'HEAD' ? undefined : payload.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': payload.length });
    res.end(req.method === 'HEAD' ? undefined : payload);
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
    })
  );
}

/** Settings that keep the test app away from the real one and from the system. */
function writeProfile(): void {
  profileDir = mkdtempSync(join(tmpdir(), 'grabbit-e2e-'));
  downloadDir = join(profileDir, 'Downloads');
  mkdirSync(downloadDir, { recursive: true });
  writeFileSync(
    join(profileDir, 'settings.json'),
    JSON.stringify({
      language: 'en',
      onboarded: true,
      downloadDir,
      clipboardMonitor: false,
      notifications: false,
      closeToTray: false,
      resumeOnStartup: false,
      startOnBoot: false,
      globalShortcut: { enabled: false },
      updates: { autoCheck: false, autoDownload: false },
      automation: { playCompletionSound: false },
      extension: { enabled: false },
      torrent: { handleMagnetLinks: false },
    })
  );
}

async function mainWindow(): Promise<Page> {
  // The quick-grab pill is a second window (index.html#/pill) with its own "Add URL" button
  for (let i = 0; i < 60; i++) {
    const main = app.windows().find((win) => win.url().includes('index.html') && !win.url().includes('#/pill'));
    if (main) {
      await main.getByRole('button', { name: 'Recognize song' }).waitFor({ timeout: 30_000 });
      return main;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The main window did not appear');
}

describe('desktop smoke', () => {
  beforeAll(async () => {
    if (!existsSync(join(appDir, 'out', 'main', 'index.js'))) throw new Error('Build first: pnpm test:e2e');
    await startFileServer();
    writeProfile();
    app = await electron.launch({
      executablePath: electronPath,
      args: [join(appDir, 'out', 'main', 'index.js')],
      cwd: appDir,
      env: { ...process.env, GRABBIT_DATA_DIR: profileDir, NODE_ENV: 'production', ELECTRON_RENDERER_URL: '' },
    });
    page = await mainWindow();
    // Same size everywhere (CI runners have small screens), and the narrow layout is the harder one
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/pill'));
      win?.setSize(760, 560);
    });
  });

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    server?.close();
    if (profileDir) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  });

  it('starts, shows the downloads view, and downloads a file end to end', async () => {
    await page.getByRole('button', { name: 'Downloads', exact: true }).click();
    await page.getByRole('button', { name: 'Add URL' }).first().click();
    await page.getByPlaceholder('https://example.com/file.zip').fill(`${baseUrl}/smoke.bin`);
    await page.getByRole('button', { name: 'Download now' }).click();

    const target = join(downloadDir, 'smoke.bin');
    const found = (): string | null => {
      for (const candidate of [target, ...['Compressed', 'Programs', 'Documents', 'Video', 'Music', 'Other'].map((c) => join(downloadDir, c, 'smoke.bin'))]) {
        if (existsSync(candidate)) return candidate;
      }
      return null;
    };
    const deadline = Date.now() + 60_000;
    let path = found();
    while (!path && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      path = found();
    }
    expect(path, 'downloaded file').toBeTruthy();
    expect(createHash('sha256').update(readFileSync(path!)).digest('hex')).toBe(payloadHash);

    // The download's own row shows it finished: a completed status dot and 100%. (A finished row
    // shows the site, not the word "Completed"; page-wide text matches only the toolbar's "Clear
    // completed" button and the filter tab, which say nothing about this download.)
    const row = page.getByRole('row').filter({ hasText: 'smoke.bin' }).filter({ hasText: '100%' });
    await row.locator('.status-dot.completed').waitFor({ timeout: 15_000 });
  });
});
