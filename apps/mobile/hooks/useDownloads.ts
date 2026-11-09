import { useState, useEffect, useCallback } from 'react';
import { mobileDownloadManager, MobileDownloadTask } from '../services/download-manager';
import { MediaItem, MediaOption } from '@grabbit/types';

export function useDownloads() {
  const [tasks, setTasks] = useState<MobileDownloadTask[]>([]);

  useEffect(() => {
    const unsubscribe = mobileDownloadManager.subscribe((updatedTasks) => {
      setTasks([...updatedTasks]);
    });
    return unsubscribe;
  }, []);

  const startDownload = useCallback(async (item: MediaItem, option: MediaOption) => {
    return await mobileDownloadManager.startDownload(item, option);
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

  const activeTasks = tasks.filter((t) => t.status === 'downloading' || t.status === 'paused' || t.status === 'queued');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  return {
    tasks,
    activeTasks,
    completedTasks,
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    saveToLibrary,
    deleteDownload,
  };
}

