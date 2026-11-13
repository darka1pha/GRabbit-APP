import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type AppError, type GrabbitApi } from '../shared/types';

class BridgeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; data: T } | { ok: false; error: AppError };
  if (result.ok) return result.data;
  throw new BridgeError(result.error.code, result.error.message);
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: GrabbitApi = {
  platform: process.platform,
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    chooseDirectory: (current) => invoke(IPC.chooseDirectory, current),
    chooseFile: (filters) => invoke(IPC.chooseFile, filters),
  },
  downloads: {
    list: () => invoke(IPC.downloadsList),
    probe: (url, headers) => invoke(IPC.downloadsProbe, url, headers),
    addHttp: (requests) => invoke(IPC.downloadsAddHttp, requests),
    addMedia: (requests) => invoke(IPC.downloadsAddMedia, requests),
    pause: (ids) => invoke(IPC.downloadsPause, ids),
    resume: (ids) => invoke(IPC.downloadsResume, ids),
    retry: (ids) => invoke(IPC.downloadsRetry, ids),
    remove: (ids, deleteFiles) => invoke(IPC.downloadsRemove, ids, deleteFiles),
    clearCompleted: () => invoke(IPC.downloadsClearCompleted),
    pauseAll: () => invoke(IPC.downloadsPauseAll),
    resumeAll: () => invoke(IPC.downloadsResumeAll),
    move: (id, direction) => invoke(IPC.downloadsMove, id, direction),
    changeUrl: (id, url) => invoke(IPC.downloadsChangeUrl, id, url),
    setSpeedLimit: (id, kbps) => invoke(IPC.downloadsSetSpeedLimit, id, kbps),
    verifyChecksum: (id, algorithm, expected) => invoke(IPC.downloadsVerify, id, algorithm, expected),
    openFile: (id) => invoke(IPC.downloadsOpenFile, id),
    showInFolder: (id) => invoke(IPC.downloadsShowInFolder, id),
    copyUrl: (id) => invoke(IPC.downloadsCopyUrl, id),
    createTransferLink: (id) => invoke(IPC.downloadsCreateTransferLink, id),
    onChanged: (listener) => subscribe(IPC.downloadsChanged, listener),
    onProgress: (listener) => subscribe(IPC.downloadsProgress, listener),
    onAggregate: (listener) => subscribe(IPC.downloadsAggregate, listener),
    watchSegments: (ids) => invoke(IPC.downloadsWatchSegments, ids),
    onRemoved: (listener) => subscribe(IPC.downloadsRemoved, listener),
    onOrderChanged: (listener) => subscribe(IPC.downloadsOrder, listener),
    onAutomationSound: (listener) => subscribe(IPC.automationPlaySound, listener),
  },
  queues: {
    list: () => invoke(IPC.queuesList),
    create: (name, options) => invoke(IPC.queuesCreate, name, options),
    update: (id, patch) => invoke(IPC.queuesUpdate, id, patch),
    delete: (id) => invoke(IPC.queuesDelete, id),
    start: (id) => invoke(IPC.queuesStart, id),
    stop: (id) => invoke(IPC.queuesStop, id),
    moveItem: (itemId, targetQueueId) => invoke(IPC.queuesMoveItem, itemId, targetQueueId),
    reorder: (queueId, order) => invoke(IPC.queuesReorder, queueId, order),
    onChanged: (listener) => subscribe(IPC.queuesChanged, listener),
  },
  media: {
    resolve: (url) => invoke(IPC.mediaResolve, url),
    search: (query, limit) => invoke(IPC.mediaSearch, query, limit),
  },
  recognize: {
    file: (path) => invoke(IPC.recognizeFile, path),
    url: (url) => invoke(IPC.recognizeUrl, url),
  },
  tools: {
    info: () => invoke(IPC.toolsInfo),
    updateYtDlp: () => invoke(IPC.toolsUpdateYtDlp),
  },
  updater: {
    check: () => invoke(IPC.updaterCheck),
    download: () => invoke(IPC.updaterDownload),
    install: () => invoke(IPC.updaterInstall),
    onStatus: (listener) => subscribe(IPC.updaterStatus, listener),
  },
  pill: {
    hide: () => invoke(IPC.pillHide),
    submit: (url, action) => invoke(IPC.pillSubmit, url, action),
    onInit: (listener) => subscribe(IPC.pillInit, listener),
  },
  app: {
    openExternal: (url) => invoke(IPC.openExternal, url),
    openPath: (path) => invoke(IPC.openPath, path),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    onClipboardLink: (listener) => subscribe(IPC.clipboardLink, listener),
    onNavigate: (listener) => subscribe(IPC.navigate, listener),
    toggleMiniMode: (enable) => invoke(IPC.toggleMiniMode, enable),
    isMiniMode: () => invoke(IPC.isMiniMode),
    onMiniModeChanged: (listener) => subscribe(IPC.miniModeChanged, listener),
  },
};

contextBridge.exposeInMainWorld('grabbit', api);
