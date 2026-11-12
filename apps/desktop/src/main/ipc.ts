import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  AddHttpDownloadRequestSchema,
  AddMediaDownloadRequestSchema,
  ChecksumAlgorithmSchema,
  describeIssue,
  FileFiltersSchema,
  HeadersSchema,
  IdListSchema,
  IdSchema,
  MoveDirectionSchema,
  QueuePatchSchema,
  SettingsPatchSchema,
  UrlTextSchema,
  z,
  type ZodTypeAny,
} from '@grabbit/schemas';
import {
  IPC,
  type AddHttpDownloadRequest,
  type AddMediaDownloadRequest,
  type AppSettings,
  type ChecksumAlgorithm,
  type DeepPartial,
  type DownloadQueue,
  type ProbeResult,
  type ToolInfo,
} from '../shared/types';
import type { DownloadManager } from './downloads/manager';
import { probeUrl } from './downloads/http-engine';
import { categoryForFileName, categoryForMime, extensionForMime } from './downloads/categories';
import { filenameFromUrl } from './downloads/http-client';
import type { SettingsService } from './settings';
import type { PlatformRouter } from './media/router';
import type { MusicRecognizer } from './media/recognizer';
import { YtDlpRunner } from './media/ytdlp-runner';
import { FFmpegRunner } from './media/ffmpeg-runner';
import { FFprobeRunner } from './media/ffprobe-runner';
import { getMediaConfig } from './media/config';
import { codeOf } from './media/errors';
import { sanitizeFilename, splitExtension } from './media/filename';
import { parseHttpUrl } from './media/url-parser';
import { installYtDlp } from './paths';
import type { ClipboardWatcher } from './clipboard-watcher';
import type { AutoUpdaterService } from './updater';
import type { GrabPillManager } from './grab-pill';
import { logger } from './logger';

export interface IpcDeps {
  getWindow(): BrowserWindow | null;
  settings: SettingsService;
  manager: DownloadManager;
  router: PlatformRouter;
  recognizer: MusicRecognizer;
  clipboardWatcher: ClipboardWatcher;
  refreshBinaries(): void;
  appVersion: string;
  dataDir: string;
  updater: AutoUpdaterService;
  grabPill: GrabPillManager;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => unknown;

/** The renderer sent arguments of the wrong shape. */
export class InvalidRequestError extends Error {
  public readonly code = 'INVALID_REQUEST';
}

/**
 * Checks a handler's arguments against one schema per parameter. Missing trailing arguments are
 * read as undefined, extra ones are dropped, and unknown object keys are stripped.
 */
export function parseArgs(channel: string, schemas: ZodTypeAny[], args: unknown[]): unknown[] {
  return schemas.map((schema, index) => {
    const result = schema.safeParse(args[index]);
    if (!result.success) {
      throw new InvalidRequestError(`Invalid argument ${index + 1} for ${channel}: ${describeIssue(result.error)}`);
    }
    return result.data;
  });
}

const optional = <T extends ZodTypeAny>(schema: T) => schema.nullish().transform((v) => v ?? undefined);
const pathText = z.string().min(1).max(4096);

/** Every handler answers { ok, data } / { ok: false, error } so error codes survive IPC. */
function handle(channel: string, schemas: ZodTypeAny[], fn: Handler): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return { ok: true, data: await fn(...parseArgs(channel, schemas, args)) };
    } catch (err) {
      const code = codeOf(err);
      logger.warn({ channel, code, err }, 'IPC handler failed');
      return { ok: false, error: { code, message: err instanceof Error ? err.message : String(err) } };
    }
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerIpc(deps: IpcDeps): void {
  const { settings, manager, router, recognizer } = deps;
  const ytdlp = new YtDlpRunner();

  handle(IPC.settingsGet, [], () => settings.get());
  handle(IPC.settingsUpdate, [SettingsPatchSchema], (patch: DeepPartial<AppSettings>) => settings.update(patch));

  handle(IPC.chooseDirectory, [optional(z.string().max(4096))], async (current?: string) => {
    const win = deps.getWindow();
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath: current };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });

  handle(IPC.chooseFile, [optional(FileFiltersSchema)], async (filters?: { name: string; extensions: string[] }[]) => {
    const win = deps.getWindow();
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });

  // ------------------------------------------------------------ downloads
  handle(IPC.downloadsList, [], () => manager.list());
  handle(IPC.downloadsProbe, [UrlTextSchema, optional(HeadersSchema)], async (url: string, headers?: Record<string, string>): Promise<ProbeResult> => {
    const parsed = parseHttpUrl(url).toString();
    const info = await probeUrl(parsed, { 'User-Agent': settings.get().userAgent, ...(headers ?? {}) });
    let fileName = sanitizeFilename(info.serverFileName ?? filenameFromUrl(parsed) ?? '', 'download');
    if (!splitExtension(fileName).ext) {
      const ext = extensionForMime(info.mimeType);
      if (ext) fileName = `${fileName}.${ext}`;
    }
    const byName = categoryForFileName(fileName);
    return {
      url: parsed,
      finalUrl: info.finalUrl,
      fileName,
      totalBytes: info.totalBytes,
      resumable: info.resumable,
      mimeType: info.mimeType,
      category: byName !== 'other' ? byName : (categoryForMime(info.mimeType) ?? 'other'),
    };
  });
  handle(IPC.downloadsAddHttp, [z.array(AddHttpDownloadRequestSchema).max(5000)], (requests: AddHttpDownloadRequest[]) => manager.addHttp(requests));
  handle(IPC.downloadsAddMedia, [z.array(AddMediaDownloadRequestSchema).max(5000)], (requests: AddMediaDownloadRequest[]) => manager.addMedia(requests));
  handle(IPC.downloadsPause, [IdListSchema], (ids: string[]) => manager.pause(ids));
  handle(IPC.downloadsResume, [IdListSchema], (ids: string[]) => manager.resume(ids));
  handle(IPC.downloadsRetry, [IdListSchema], (ids: string[]) => manager.retry(ids));
  handle(IPC.downloadsRemove, [IdListSchema, optional(z.boolean())], (ids: string[], deleteFiles: boolean) => manager.remove(ids, deleteFiles));
  handle(IPC.downloadsClearCompleted, [], () => manager.clearCompleted());
  handle(IPC.downloadsPauseAll, [], () => manager.pauseAll());
  handle(IPC.downloadsResumeAll, [], () => manager.resumeAll());
  handle(IPC.downloadsMove, [IdSchema, MoveDirectionSchema], (id: string, direction: 'up' | 'down' | 'top' | 'bottom') => manager.move(id, direction));
  handle(IPC.downloadsChangeUrl, [IdSchema, UrlTextSchema], (id: string, url: string) => manager.changeUrl(id, url));
  handle(IPC.downloadsSetSpeedLimit, [IdSchema, z.number().finite().nonnegative()], (id: string, kbps: number) => manager.setSpeedLimit(id, kbps));
  handle(IPC.downloadsVerify, [IdSchema, ChecksumAlgorithmSchema, optional(z.string().max(256))], (id: string, algorithm: ChecksumAlgorithm, expected?: string) =>
    manager.verifyChecksum(id, algorithm, expected)
  );
  handle(IPC.downloadsOpenFile, [IdSchema], async (id: string) => {
    const item = manager.get(id);
    if (!item?.filePath || !existsSync(item.filePath)) throw new Error('The file was moved or deleted');
    const error = await shell.openPath(item.filePath);
    if (error) throw new Error(error);
  });
  handle(IPC.downloadsShowInFolder, [IdSchema], async (id: string) => {
    const item = manager.get(id);
    if (!item) return;
    if (item.filePath && existsSync(item.filePath)) shell.showItemInFolder(item.filePath);
    else if (existsSync(item.directory)) await shell.openPath(item.directory);
    else if (existsSync(dirname(item.directory))) await shell.openPath(dirname(item.directory));
  });
  handle(IPC.downloadsCopyUrl, [IdSchema], (id: string) => {
    const item = manager.get(id);
    if (!item) return;
    deps.clipboardWatcher.ignore(item.url);
    clipboard.writeText(item.url);
  });

  handle(IPC.downloadsWatchSegments, [IdListSchema], (ids: string[]) => manager.watchSegments(ids));

  // ------------------------------------------------------------ queues
  handle(IPC.queuesList, [], () => manager.listQueues());
  handle(IPC.queuesCreate, [z.string().max(120), optional(QueuePatchSchema)], (name: string, options?: Partial<DownloadQueue>) => manager.createQueue(name, options));
  handle(IPC.queuesUpdate, [IdSchema, QueuePatchSchema], (id: string, patch: Partial<DownloadQueue>) => manager.updateQueue(id, patch));
  handle(IPC.queuesDelete, [IdSchema], (id: string) => manager.deleteQueue(id));
  handle(IPC.queuesStart, [IdSchema], (id: string) => manager.startQueue(id));
  handle(IPC.queuesStop, [IdSchema], (id: string) => manager.stopQueue(id));
  handle(IPC.queuesMoveItem, [IdSchema, IdSchema], (itemId: string, targetQueueId: string) => manager.moveItemToQueue(itemId, targetQueueId));
  handle(IPC.queuesReorder, [IdSchema, IdListSchema], (queueId: string, order: string[]) => manager.reorderQueue(queueId, order));

  // ------------------------------------------------------------ media
  handle(IPC.mediaResolve, [z.string().trim().min(1).max(8192)], (url: string) => router.resolve(url));
  handle(IPC.mediaSearch, [z.string().trim().min(1).max(500), optional(z.number().int().min(1).max(50))], (query: string, limit?: number) => router.search(query, limit ?? 15));

  // ------------------------------------------------------------ recognition
  handle(IPC.recognizeFile, [pathText], (path: string) => recognizer.identifyFile(path));
  handle(IPC.recognizeUrl, [UrlTextSchema], (url: string) => recognizer.identifyUrl(parseHttpUrl(url).toString()));

  // ------------------------------------------------------------ tools
  handle(IPC.toolsInfo, [], async (): Promise<ToolInfo> => {
    const cfg = getMediaConfig();
    const [y, f, p] = await Promise.all([ytdlp.getVersion(), new FFmpegRunner().getVersion(), new FFprobeRunner().getVersion()]);
    let lanIp: string | undefined;
    try {
      const nets = networkInterfaces();
      for (const iface of Object.values(nets)) {
        for (const addr of iface ?? []) {
          if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
            lanIp = addr.address;
            break;
          }
        }
        if (lanIp) break;
      }
    } catch {
      // ignore
    }
    return {
      ytdlp: { path: cfg.ytdlpPath, version: y },
      ffmpeg: { path: cfg.ffmpegPath, version: f },
      ffprobe: { path: cfg.ffprobePath, version: p },
      appVersion: deps.appVersion,
      dataDir: deps.dataDir,
      lanIp,
    };
  });
  handle(IPC.toolsUpdateYtDlp, [], async () => {
    if (!existsSync(getMediaConfig().ytdlpPath)) {
      const path = await installYtDlp();
      deps.refreshBinaries();
      return `Installed yt-dlp to ${path}`;
    }
    return ytdlp.selfUpdate();
  });

  // ------------------------------------------------------------ updater
  handle(IPC.updaterCheck, [], () => deps.updater.checkForUpdates());
  handle(IPC.updaterDownload, [], () => deps.updater.downloadUpdate());
  handle(IPC.updaterInstall, [], () => deps.updater.quitAndInstall());

  // ------------------------------------------------------------ grab pill
  handle(IPC.pillHide, [], () => deps.grabPill.hide());
  handle(IPC.pillSubmit, [z.string().max(8192), optional(z.enum(['grab', 'download']))], (url: string, action?: 'grab' | 'download') => {
    deps.grabPill.submit(url, action);
  });

  // ------------------------------------------------------------ shell
  handle(IPC.openExternal, [z.string().min(1).max(8192)], async (url: string) => {
    if (!isHttpUrl(url) && !url.startsWith('spotify:')) throw new Error('Only web links can be opened');
    await shell.openExternal(url);
  });
  handle(IPC.openPath, [pathText], async (path: string) => {
    // Only folders the app itself manages: the download folder, the data folder and item folders
    const wanted = resolve(path).toLowerCase();
    const allowed = [settings.get().downloadDir, deps.dataDir, ...manager.list().map((item) => item.directory)];
    if (!allowed.some((dir) => dir && resolve(dir).toLowerCase() === wanted)) {
      throw new InvalidRequestError('That folder cannot be opened from here');
    }
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
}
