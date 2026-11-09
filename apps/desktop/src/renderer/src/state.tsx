import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppSettings, DeepPartial, DownloadItem, DownloadQueue } from '../../shared/types';

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
  const [byId, setById] = useState<Map<string, DownloadItem>>(new Map());
  const [order, setOrder] = useState<string[]>([]);
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
    void api.downloads.list().then((items) => {
      setById(new Map(items.map((i) => [i.id, i])));
      setOrder(items.map((i) => i.id));
    });

    const offQueues = api.queues.onChanged((updated) => setQueues(updated));

    const offChanged = api.downloads.onChanged((items) => {
      setById((prev) => {
        const next = new Map(prev);
        for (const item of items) next.set(item.id, item);
        return next;
      });
      setOrder((prev) => {
        const known = new Set(prev);
        const added = items.filter((i) => !known.has(i.id)).map((i) => i.id);
        return added.length > 0 ? [...prev, ...added] : prev;
      });
    });
    const offOrder = api.downloads.onOrderChanged((ids) => setOrder(ids));
    const offRemoved = api.downloads.onRemoved((ids) => {
      const gone = new Set(ids);
      setById((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setOrder((prev) => prev.filter((id) => !gone.has(id)));
    });
    return () => {
      offQueues();
      offChanged();
      offRemoved();
      offOrder();
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

  const downloads = useMemo(() => order.map((id) => byId.get(id)).filter((i): i is DownloadItem => Boolean(i)), [order, byId]);

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
