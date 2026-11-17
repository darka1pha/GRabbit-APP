// Puts yt-dlp.exe, ffmpeg.exe, ffprobe.exe and aria2c.exe into resources/bin so they ship inside the app.
//   ffmpeg / ffprobe: copied from the ffmpeg-static / @ffprobe-installer npm packages
//   yt-dlp:           latest official GitHub release, checked against its SHA2-256SUMS (only when missing, or with --force)
//   aria2c:           the torrent engine, from a pinned official aria2 release, checked against its SHA-256
// Usage: node scripts/fetch-binaries.mjs [--force]
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binDir = join(root, 'resources', 'bin');
const force = process.argv.includes('--force');
const YTDLP_LATEST_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest';
const req = createRequire(import.meta.url);

// To upgrade aria2: bump the version and paste the SHA-256 of the new win-64bit zip
const ARIA2_VERSION = '1.37.0';
const ARIA2_ZIP = `aria2-${ARIA2_VERSION}-win-64bit-build1`;
const ARIA2_URL = `https://github.com/aria2/aria2/releases/download/release-${ARIA2_VERSION}/${ARIA2_ZIP}.zip`;
const ARIA2_ZIP_SHA256 = '67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288';

mkdirSync(binDir, { recursive: true });

function copyIfChanged(from, to) {
  if (!from || !existsSync(from)) {
    console.error(`missing ${from}: run npm install first`);
    process.exitCode = 1;
    return;
  }
  if (!force && existsSync(to) && statSync(to).size === statSync(from).size) {
    console.log(`ok      ${to}`);
    return;
  }
  copyFileSync(from, to);
  console.log(`copied  ${to}`);
}

let ffmpegSrc;
try {
  ffmpegSrc = req('ffmpeg-static');
} catch {
  ffmpegSrc = join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
}

let ffprobeSrc;
try {
  ffprobeSrc = req('@ffprobe-installer/ffprobe')?.path;
} catch {
  const direct = join(root, 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe');
  if (existsSync(direct)) {
    ffprobeSrc = direct;
  } else {
    const pnpmDir = join(root, '..', '..', 'node_modules', '.pnpm');
    const pkgDir = existsSync(pnpmDir)
      ? readdirSync(pnpmDir).find((d) => d.startsWith('@ffprobe-installer+win32-x64@'))
      : undefined;
    ffprobeSrc = pkgDir
      ? join(pnpmDir, pkgDir, 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe')
      : direct;
  }
}

copyIfChanged(ffmpegSrc, join(binDir, 'ffmpeg.exe'));
copyIfChanged(ffprobeSrc, join(binDir, 'ffprobe.exe'));

const ytdlp = join(binDir, 'yt-dlp.exe');
if (!force && existsSync(ytdlp)) {
  console.log(`ok      ${ytdlp}`);
} else {
  // Resolve "latest" to a tag once, so the binary and its checksum come from the same release
  const latest = await fetch(YTDLP_LATEST_URL, { redirect: 'manual' });
  const tag = /\/tag\/([^/?#]+)$/.exec(latest.headers.get('location') ?? '')?.[1];
  if (!tag) throw new Error(`Could not find the latest yt-dlp release (HTTP ${latest.status})`);
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}`;

  console.log(`fetch   ${base}/yt-dlp.exe`);
  const [binRes, sumsRes] = await Promise.all([
    fetch(`${base}/yt-dlp.exe`, { redirect: 'follow' }),
    fetch(`${base}/SHA2-256SUMS`, { redirect: 'follow' }),
  ]);
  if (!binRes.ok) throw new Error(`yt-dlp download failed: HTTP ${binRes.status}`);
  if (!sumsRes.ok) throw new Error(`yt-dlp checksum list download failed: HTTP ${sumsRes.status}`);
  const expected = (await sumsRes.text())
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === 'yt-dlp.exe')?.[0];
  if (!expected || !/^[0-9a-f]{64}$/i.test(expected)) throw new Error('yt-dlp.exe is missing from SHA2-256SUMS');
  const bin = Buffer.from(await binRes.arrayBuffer());
  const actual = createHash('sha256').update(bin).digest('hex');
  if (actual !== expected.toLowerCase()) {
    throw new Error(`yt-dlp checksum mismatch: expected ${expected}, got ${actual}`);
  }
  const tmp = `${ytdlp}.download`;
  writeFileSync(tmp, bin);
  rmSync(ytdlp, { force: true });
  renameSync(tmp, ytdlp);
  console.log(`saved   ${ytdlp} ${tag} (${(statSync(ytdlp).size / 1048576).toFixed(1)} MB, SHA-256 verified)`);
}

const aria2 = join(binDir, 'aria2c.exe');
if (!force && existsSync(aria2)) {
  console.log(`ok      ${aria2}`);
} else {
  if (!/^[0-9a-f]{64}$/.test(ARIA2_ZIP_SHA256)) {
    throw new Error('ARIA2_ZIP_SHA256 is not set in scripts/fetch-binaries.mjs');
  }
  console.log(`fetch   ${ARIA2_URL}`);
  const res = await fetch(ARIA2_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`aria2 download failed: HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(zip).digest('hex');
  if (actual !== ARIA2_ZIP_SHA256) {
    throw new Error(`aria2 checksum mismatch: expected ${ARIA2_ZIP_SHA256}, got ${actual}`);
  }
  const work = mkdtempSync(join(tmpdir(), 'grabbit-aria2-'));
  try {
    const zipPath = join(work, 'aria2.zip');
    await pipeline(Readable.from([zip]), createWriteStream(zipPath));
    // Windows' own tar (bsdtar) reads zip files; Git's GNU tar, often first on PATH, does not
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(existsSync(tar) ? tar : 'tar', ['-xf', zipPath, '-C', work], { stdio: 'inherit' });
    const extracted = join(work, ARIA2_ZIP, 'aria2c.exe');
    if (!existsSync(extracted) || readFileSync(extracted).length === 0) throw new Error('aria2c.exe not found in the aria2 zip');
    rmSync(aria2, { force: true });
    copyFileSync(extracted, aria2);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`saved   ${aria2} (${(statSync(aria2).size / 1048576).toFixed(1)} MB)`);
}
