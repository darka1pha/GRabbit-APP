import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppSettings, DeepPartial, DownloadItem, DownloadQueue } from '../../shared/types';
import { downloadStore, useDownloadList } from './downloads-store';

export const api = window.grabbit;

export interface ToastMessage {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

interface AppState {
  settings: AppSettings | null;
  updateSettings(patch: DeepPartial<AppSettings>): Promise<void>;
  /**
   * Every download in queue order. Updates when the list changes (add, remove, reorder, status),
   * not on progress: use `useLiveDownload` for a download's running numbers.
   */
  downloads: DownloadItem[];
  queues: DownloadQueue[];
  refreshQueues(): Promise<void>;
  toasts: ToastMessage[];
  toast(text: string, kind?: ToastMessage['kind'], action?: ToastMessage['action']): void;
  dismissToast(id: number): void;
}

const AppContext = createContext<AppState | null>(null);

let toastId = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const downloads = useDownloadList();
  const [queues, setQueues] = useState<DownloadQueue[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const refreshQueues = useCallback(async () => {
    try {
      const q = await api.queues.list();
      setQueues(q);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void api.settings.get().then(setSettings);
    void refreshQueues();
    const disconnect = downloadStore.connect(api.downloads);
    const offQueues = api.queues.onChanged((updated) => setQueues(updated));
    return () => {
      offQueues();
      disconnect();
    };
  }, [refreshQueues]);

  const updateSettings = useCallback(async (patch: DeepPartial<AppSettings>) => {
    setSettings(await api.settings.update(patch));
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (text: string, kind: ToastMessage['kind'] = 'info', action?: ToastMessage['action']) => {
      const id = ++toastId;
      setToasts((prev) => [...prev.slice(-3), { id, text, kind, action }]);
      setTimeout(() => dismissToast(id), action ? 9000 : 4500);
    },
    [dismissToast]
  );

  const value = useMemo(
    () => ({ settings, updateSettings, downloads, queues, refreshQueues, toasts, toast, dismissToast }),
    [settings, updateSettings, downloads, queues, refreshQueues, toasts, toast, dismissToast]
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}
