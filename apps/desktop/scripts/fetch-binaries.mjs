// Puts yt-dlp.exe, ffmpeg.exe and ffprobe.exe into resources/bin so they ship inside the app.
//   ffmpeg / ffprobe: copied from the ffmpeg-static (FFmpeg 6.x) / @ffprobe-installer npm packages
//   yt-dlp:           downloaded from the official GitHub release (only when missing, or with --force)
// Usage: node scripts/fetch-binaries.mjs [--force]
import { copyFileSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binDir = join(root, 'resources', 'bin');
const force = process.argv.includes('--force');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

mkdirSync(binDir, { recursive: true });

function copyIfChanged(from, to) {
  if (!existsSync(from)) {
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

copyIfChanged(join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'), join(binDir, 'ffmpeg.exe'));
copyIfChanged(join(root, 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe'), join(binDir, 'ffprobe.exe'));

const ytdlp = join(binDir, 'yt-dlp.exe');
if (!force && existsSync(ytdlp)) {
  console.log(`ok      ${ytdlp}`);
} else {
  console.log(`fetch   ${YTDLP_URL}`);
  const res = await fetch(YTDLP_URL, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`yt-dlp download failed: HTTP ${res.status}`);
  const tmp = `${ytdlp}.download`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  rmSync(ytdlp, { force: true });
  renameSync(tmp, ytdlp);
  console.log(`saved   ${ytdlp} (${(statSync(ytdlp).size / 1048576).toFixed(1)} MB)`);
}
