import { useState, useEffect, useCallback, useMemo } from 'react';
import { mobileDownloadManager, MobileDownloadTask } from '../services/download-manager';
import { MediaItem, MediaOption, DownloadQueue, AddHttpDownloadRequest, ChecksumAlgorithm } from '@grabbit/types';

export function useDownloads() {
  const [tasks, setTasks] = useState<MobileDownloadTask[]>([]);
  const [queues, setQueues] = useState<DownloadQueue[]>([]);

  useEffect(() => {
    const unsubTasks = mobileDownloadManager.subscribe((updatedTasks) => {
      setTasks([...updatedTasks]);
    });
    const unsubQueues = mobileDownloadManager.subscribeQueues((updatedQueues) => {
      setQueues([...updatedQueues]);
    });

    return () => {
      unsubTasks();
      unsubQueues();
    };
  }, []);

  const startDownload = useCallback(async (item: MediaItem, option: MediaOption, queueId?: string) => {
    return await mobileDownloadManager.startDownload(item, option, queueId);
  }, []);

  const startHttpDownload = useCallback(async (request: AddHttpDownloadRequest) => {
    return await mobileDownloadManager.startHttpDownload(request);
  }, []);

  const batchImportUrls = useCallback(async (urls: string[], request?: Partial<AddHttpDownloadRequest>) => {
    return await mobileDownloadManager.batchImportUrls(urls, request);
  }, []);

  const probeUrl = useCallback(async (url: string, headers?: Record<string, string>) => {
    return await mobileDownloadManager.probeUrl(url, headers);
  }, []);

  const pauseDownload = useCallback(async (id: string) => {
    await mobileDownloadManager.pauseDownload(id);
  }, []);

  const resumeDownload = useCallback(async (id: string) => {
    await mobileDownloadManager.resumeDownload(id);
  }, []);

  const cancelDownload = useCallback(async (id: string) => {
    await mobileDownloadManager.cancelDownload(id);
  }, []);

  const saveToLibrary = useCallback(async (id: string) => {
    return await mobileDownloadManager.saveToMediaLibrary(id);
  }, []);

  const deleteDownload = useCallback(async (id: string) => {
    await mobileDownloadManager.deleteDownload(id);
  }, []);

  const resumeAll = useCallback(async () => {
    await mobileDownloadManager.resumeAll();
  }, []);

  const pauseAll = useCallback(async () => {
    await mobileDownloadManager.pauseAll();
  }, []);

  const clearCompleted = useCallback(async () => {
    await mobileDownloadManager.clearCompleted();
  }, []);

  const retryFailed = useCallback(async () => {
    await mobileDownloadManager.retryFailed();
  }, []);

  const verifyChecksum = useCallback(async (id: string, algorithm: ChecksumAlgorithm, expected?: string) => {
    return await mobileDownloadManager.verifyChecksum(id, algorithm, expected);
  }, []);

  // Queue methods
  const createQueue = useCallback((name: string, options?: Partial<DownloadQueue>) => {
    return mobileDownloadManager.createQueue(name, options);
  }, []);

  const updateQueue = useCallback((id: string, patch: Partial<DownloadQueue>) => {
    return mobileDownloadManager.updateQueue(id, patch);
  }, []);

  const deleteQueue = useCallback((id: string) => {
    mobileDownloadManager.deleteQueue(id);
  }, []);

  const startQueue = useCallback((id: string) => {
    mobileDownloadManager.startQueue(id);
  }, []);

  const stopQueue = useCallback((id: string) => {
    mobileDownloadManager.stopQueue(id);
  }, []);

  const moveTaskToQueue = useCallback((taskId: string, targetQueueId: string) => {
    mobileDownloadManager.moveTaskToQueue(taskId, targetQueueId);
  }, []);

  const activeTasks = useMemo(
    () => tasks.filter((t) => t.status === 'downloading' || t.status === 'queued'),
    [tasks]
  );
  const completedTasks = useMemo(
    () => tasks.filter((t) => t.status === 'completed'),
    [tasks]
  );
  const pausedTasks = useMemo(
    () => tasks.filter((t) => t.status === 'paused'),
    [tasks]
  );
  const failedTasks = useMemo(
    () => tasks.filter((t) => t.status === 'error'),
    [tasks]
  );

  const totalSpeed = useMemo(
    () => activeTasks.reduce((s, t) => s + (t.status === 'downloading' ? t.speed : 0), 0),
    [activeTasks]
  );

  const cleanStorage = useCallback(async () => {
    return await mobileDownloadManager.cleanStorage();
  }, []);

  const getStorageUsage = useCallback(async () => {
    return await mobileDownloadManager.getStorageUsage();
  }, []);

  const refresh = useCallback(() => {
    mobileDownloadManager.refresh();
  }, []);

  return {
    tasks,
    queues,
    activeTasks,
    completedTasks,
    pausedTasks,
    failedTasks,
    totalSpeed,
    startDownload,
    startHttpDownload,
    batchImportUrls,
    probeUrl,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    saveToLibrary,
    deleteDownload,
    resumeAll,
    pauseAll,
    clearCompleted,
    retryFailed,
    verifyChecksum,
    createQueue,
    updateQueue,
    deleteQueue,
    startQueue,
    stopQueue,
    moveTaskToQueue,
    cleanStorage,
    getStorageUsage,
    refresh,
  };
}
