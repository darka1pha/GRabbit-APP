import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, statSync, createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { httpRequest } from './downloads/http-client';
import { logger } from './logger';

const EXE = process.platform === 'win32' ? '.exe' : '';
const YTDLP_RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp${EXE}`;

/** A file shipped next to the app (extraResources) or in the project folder during development. */
export function resourcePath(...parts: string[]): string {
  const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(root, ...parts);
}

export function userBinDir(): string {
  return join(app.getPath('userData'), 'bin');
}

export interface BinaryPaths {
  ytdlp: string;
  ffmpeg: string;
  ffprobe: string;
  /** Folder with both ffmpeg and ffprobe, for yt-dlp's --ffmpeg-location. */
  ffmpegDir: string;
}

function devFallback(...parts: string[]): string {
  return join(app.getAppPath(), 'node_modules', ...parts);
}

function resolveDevPackageBinary(specifier: string, property?: string): string | null {
  try {
    const req = createRequire(join(app.getAppPath(), 'package.json'));
    const loaded = req(specifier) as unknown;
    const candidate = property && loaded && typeof loaded === 'object' ? (loaded as Record<string, unknown>)[property] : loaded;
    if (typeof candidate === 'string' && existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // Fall back to direct node_modules path
  }
  return null;
}

/**
 * yt-dlp runs from a per-user copy so it can update itself (Program Files is read-only);
 * the bundled copy seeds it on first launch and whenever a newer build ships with the app.
 */
export function resolveBinaries(): BinaryPaths {
  const bundledBin = resourcePath('bin');
  const userBin = userBinDir();
  mkdirSync(userBin, { recursive: true });

  const bundledYtdlp = join(bundledBin, `yt-dlp${EXE}`);
  const userYtdlp = join(userBin, `yt-dlp${EXE}`);
  try {
    if (existsSync(bundledYtdlp) && (!existsSync(userYtdlp) || statSync(bundledYtdlp).mtimeMs > statSync(userYtdlp).mtimeMs)) {
      copyFileSync(bundledYtdlp, userYtdlp);
    }
  } catch (err) {
    logger.warn({ err }, 'Could not copy the bundled yt-dlp');
  }

  const bundledFfmpeg = join(bundledBin, `ffmpeg${EXE}`);
  const bundledFfprobe = join(bundledBin, `ffprobe${EXE}`);
  const hasBundled = existsSync(bundledFfmpeg) && existsSync(bundledFfprobe);

  const devFfmpeg = resolveDevPackageBinary('ffmpeg-static') ?? devFallback('ffmpeg-static', `ffmpeg${EXE}`);
  const devFfprobe =
    resolveDevPackageBinary('@ffprobe-installer/ffprobe', 'path') ??
    devFallback('@ffprobe-installer', `${process.platform}-${process.arch}`, `ffprobe${EXE}`);

  return {
    ytdlp: existsSync(userYtdlp) ? userYtdlp : existsSync(bundledYtdlp) ? bundledYtdlp : userYtdlp,
    ffmpeg: hasBundled ? bundledFfmpeg : devFfmpeg,
    ffprobe: hasBundled ? bundledFfprobe : devFfprobe,
    ffmpegDir: hasBundled ? bundledBin : existsSync(devFfmpeg) ? dirname(devFfmpeg) : '',
  };
}

/** Downloads the official yt-dlp build into the per-user bin folder. */
export async function installYtDlp(): Promise<string> {
  const target = join(userBinDir(), `yt-dlp${EXE}`);
  const tmp = `${target}.download`;
  const res = await httpRequest(YTDLP_RELEASE_URL, { headers: { 'User-Agent': 'GRabbit-Desktop' } });
  if (res.status !== 200) {
    res.body.resume();
    throw new Error(`GitHub answered HTTP ${res.status}`);
  }
  await pipeline(res.body, createWriteStream(tmp));
  await rm(target, { force: true });
  await rename(tmp, target);
  return target;
}
