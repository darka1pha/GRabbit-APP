import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Gauge,
  Inbox,
  Layers,
  Link,
  Pause,
  Play,
  Plus,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { Category, ChecksumAlgorithm, DownloadItem, DownloadQueue, DownloadStatus } from '../../../shared/types';
import { errorText, useI18n, type MessageKey } from '../i18n';
import { api, useApp } from '../state';
import { formatBytes, formatDate, formatEta, formatPercent, formatSpeed } from '../format';
import { ContextMenu, FileIcon, MenuEntry, Modal, ProgressBar } from '../components/ui';
import { QueueConfigModal } from '../components/QueueConfigModal';
import { downloadStore, useDownloadsAggregate, useLiveDownload, useSegmentWatch } from '../downloads-store';
import { Sparkline } from '../components/Sparkline';

export type StatusFilter = 'all' | 'active' | 'queued' | 'completed' | 'failed';
export type GroupByOption = 'none' | 'date' | 'status' | 'queue';
export type DensityOption = 'comfortable' | 'compact';

export const ROW_HEIGHT_COMFORTABLE = 56;
export const ROW_HEIGHT_COMPACT = 40;
export const ROW_HEIGHT = ROW_HEIGHT_COMFORTABLE;
const OVERSCAN_ROWS = 10;

export function getDateGroupKey(timestamp: number): 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older' {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfThisWeek = startOfToday - 6 * 86400000;
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  if (timestamp >= startOfToday) return 'today';
  if (timestamp >= startOfYesterday) return 'yesterday';
  if (timestamp >= startOfThisWeek) return 'thisWeek';
  if (timestamp >= startOfThisMonth) return 'thisMonth';
  return 'older';
}

const ACTIVE: DownloadStatus[] = ['starting', 'downloading', 'processing'];

export function matchesStatus(item: DownloadItem, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return ACTIVE.includes(item.status);
    case 'queued':
      return item.status === 'queued' || item.status === 'paused';
    case 'completed':
      return item.status === 'completed';
    case 'failed':
      return item.status === 'error';
  }
}

function fraction(item: DownloadItem): number {
  if (item.status === 'completed') return 1;
  if (item.totalBytes) return Math.min(1, item.receivedBytes / item.totalBytes);
  if (item.percent !== undefined) return item.percent / 100;
  return 0;
}

function canPause(item: DownloadItem): boolean {
  return item.status === 'queued' || ACTIVE.includes(item.status);
}
function canResume(item: DownloadItem): boolean {
  return item.status === 'paused' || item.status === 'error';
}

/**
 * Which rows of a fixed-row-height list are in (or near) view. Only those are rendered; the
 * rest of the list is represented by two spacers of the right height.
 */
function useVirtualRows(
  container: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number = ROW_HEIGHT_COMFORTABLE
): { start: number; end: number } {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 40) });
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const update = () => {
      const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - OVERSCAN_ROWS);
      const end = Math.min(count, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + OVERSCAN_ROWS);
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [container, count, rowHeight]);
  return { start: Math.min(range.start, count), end: Math.min(range.end, count) };
}

/** Row callbacks that keep the same identity for the life of the view, so rows can be memoised. */
interface RowActions {
  click(e: React.MouseEvent, item: DownloadItem): void;
  doubleClick(item: DownloadItem): void;
  contextMenu(e: React.MouseEvent, item: DownloadItem): void;
  toggle(item: DownloadItem): void;
  openFile(item: DownloadItem): void;
  openFolder(item: DownloadItem): void;
  remove(item: DownloadItem): void;
  toggleSelect?(item: DownloadItem): void;
  changeUrl?(item: DownloadItem): void;
  retry?(item: DownloadItem): void;
  dragStart?(e: React.DragEvent, item: DownloadItem): void;
  dragOver?(e: React.DragEvent, item: DownloadItem): void;
  drop?(e: React.DragEvent, item: DownloadItem): void;
}

/** Speed and count of active downloads in the page header. */
function ActiveStat({ count }: { count: number }) {
  const { t, language } = useI18n();
  const { speed } = useDownloadsAggregate();
  return (
    <span className="stat">
      <Download size={14} /> <b>{formatSpeed(speed, language) || '0 B/s'}</b> · {t('dl.active', { count })}
    </span>
  );
}

type DialogState =
  | { kind: 'remove'; ids: string[]; deleteFiles: boolean }
  | { kind: 'url'; item: DownloadItem }
  | { kind: 'limit'; item: DownloadItem }
  | { kind: 'verify'; item: DownloadItem }
  | { kind: 'segments'; item: DownloadItem }
  | null;

export function DownloadsView({
  category,
  onAdd,
}: {
  category: Category | 'all';
  onAdd(url?: string): void;
}) {
  const { t, language } = useI18n();
  const { downloads, queues, refreshQueues, toast } = useApp();
  const [selectedQueueId, setSelectedQueueId] = useState<string | 'all'>('all');
  const [queueModal, setQueueModal] = useState<{ queue?: DownloadQueue | null } | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'added' | 'name' | 'size' | 'progress' | 'speed'>('added');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: DownloadItem } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [groupBy, setGroupBy] = useState<GroupByOption>(() => {
    try {
      const saved = localStorage.getItem('grabbit_dl_grouping') as GroupByOption | null;
      if (saved === 'none' || saved === 'date' || saved === 'status' || saved === 'queue') return saved;
    } catch {}
    return 'date';
  });
  const [density, setDensity] = useState<DensityOption>(() => {
    try {
      const saved = localStorage.getItem('grabbit_dl_density') as DensityOption | null;
      if (saved === 'comfortable' || saved === 'compact') return saved;
    } catch {}
    return 'comfortable';
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('grabbit_dl_collapsed_groups');
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set<string>();
  });
  const [showViewMenu, setShowViewMenu] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [showQueueMenu, setShowQueueMenu] = useState(false);
  const queueMenuRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const undoBufferRef = useRef<{ items: DownloadItem[] } | null>(null);

  useEffect(() => {
    if (!showViewMenu && !showQueueMenu) return;
    const onDown = (e: MouseEvent) => {
      if (showViewMenu && viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setShowViewMenu(false);
      }
      if (showQueueMenu && queueMenuRef.current && !queueMenuRef.current.contains(e.target as Node)) {
        setShowQueueMenu(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [showViewMenu, showQueueMenu]);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try {
        localStorage.setItem('grabbit_dl_collapsed_groups', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) {
        setSelected(new Set([id]));
        setAnchor(id);
        setFocusedId(id);
        setInspectingId(id);
      }
    };
    window.addEventListener('select-download', onSelect);
    return () => window.removeEventListener('select-download', onSelect);
  }, []);

  const toggleSort = (col: 'added' | 'name' | 'size' | 'progress' | 'speed') => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir(col === 'name' ? 'asc' : 'desc');
    }
  };

  const inCategory = useMemo(
    () => downloads.filter((d) => category === 'all' || d.category === category),
    [downloads, category]
  );
  const inQueue = useMemo(
    () => inCategory.filter((d) => selectedQueueId === 'all' || (d.queueId || 'main') === selectedQueueId),
    [inCategory, selectedQueueId]
  );
  // The list only changes with its structure; sorting by a running number re-sorts on a slow timer
  const [liveSortTick, setLiveSortTick] = useState(0);
  const sortsByLiveValue = sortBy === 'size' || sortBy === 'progress' || sortBy === 'speed';
  const anyActive = useMemo(() => downloads.some((d) => ACTIVE.includes(d.status)), [downloads]);
  useEffect(() => {
    if (!sortsByLiveValue || !anyActive) return;
    const timer = setInterval(() => setLiveSortTick((n) => n + 1), 2000);
    return () => clearInterval(timer);
  }, [sortsByLiveValue, anyActive]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = inQueue.filter(
      (d) =>
        matchesStatus(d, filter) &&
        (!q || d.fileName.toLowerCase().includes(q) || d.url.toLowerCase().includes(q) || d.media?.title.toLowerCase().includes(q))
    );
    const mult = sortDir === 'asc' ? 1 : -1;
    const live = (d: DownloadItem) => (sortsByLiveValue ? (downloadStore.get(d.id) ?? d) : d);
    return [...filtered].sort((x, y) => {
      const a = live(x);
      const b = live(y);
      switch (sortBy) {
        case 'name':
          return a.fileName.localeCompare(b.fileName) * mult;
        case 'size':
          return ((a.totalBytes ?? a.receivedBytes) - (b.totalBytes ?? b.receivedBytes)) * mult;
        case 'progress':
          return (fraction(a) - fraction(b)) * mult;
        case 'speed':
          return ((a.speed || 0) - (b.speed || 0)) * mult;
        case 'added':
        default:
          return (a.createdAt - b.createdAt) * mult;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inQueue, filter, query, sortBy, sortDir, sortsByLiveValue, liveSortTick]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, active: 0, queued: 0, completed: 0, failed: 0 };
    for (const d of inQueue) {
      for (const f of Object.keys(c) as StatusFilter[]) if (matchesStatus(d, f)) c[f]++;
    }
    return c;
  }, [inQueue]);

  const queueCounts = useMemo(() => {
    const c: Record<string, number> = { all: inCategory.length };
    for (const q of queues) c[q.id] = 0;
    for (const d of inCategory) {
      const qId = d.queueId || 'main';
      c[qId] = (c[qId] ?? 0) + 1;
    }
    return c;
  }, [inCategory, queues]);

  // Drop selections that disappeared
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(downloads.map((d) => d.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [downloads]);

  const selectedItems = visible.filter((d) => selected.has(d.id));
  const single =
    inspectingId && selected.has(inspectingId) && selected.size === 1
      ? downloads.find((d) => d.id === inspectingId) ?? null
      : null;
  const rowHeight = density === 'compact' ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_COMFORTABLE;
  const rows = useVirtualRows(tableRef, visible.length, rowHeight);
  const queueNames = useMemo(() => new Map(queues.map((q) => [q.id, q.name])), [queues]);
  const currentQueue = useMemo(
    () => (selectedQueueId === 'all' ? null : queues.find((q) => q.id === selectedQueueId) ?? null),
    [queues, selectedQueueId]
  );

  const isAllSelected = visible.length > 0 && visible.every((d) => selected.has(d.id));
  const isPartiallySelected = visible.some((d) => selected.has(d.id)) && !isAllSelected;

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelected(new Set());
      setInspectingId(null);
    } else {
      setSelected(new Set(visible.map((d) => d.id)));
      setInspectingId(null);
    }
  }, [isAllSelected, visible]);

  interface DownloadGroup {
    id: string;
    title: string;
    items: DownloadItem[];
    totalBytes: number;
  }

  const groups = useMemo<DownloadGroup[]>(() => {
    if (groupBy === 'none') return [];

    if (groupBy === 'date') {
      const buckets: Record<'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older', DownloadItem[]> = {
        today: [],
        yesterday: [],
        thisWeek: [],
        thisMonth: [],
        older: [],
      };
      for (const item of visible) {
        const key = getDateGroupKey(item.createdAt);
        buckets[key].push(item);
      }
      const order: Array<{ key: keyof typeof buckets; labelKey: MessageKey }> = [
        { key: 'today', labelKey: 'dl.group.today' },
        { key: 'yesterday', labelKey: 'dl.group.yesterday' },
        { key: 'thisWeek', labelKey: 'dl.group.thisWeek' },
        { key: 'thisMonth', labelKey: 'dl.group.thisMonth' },
        { key: 'older', labelKey: 'dl.group.older' },
      ];
      return order
        .filter((o) => buckets[o.key].length > 0)
        .map((o) => {
          const items = buckets[o.key];
          const totalBytes = items.reduce((sum, i) => sum + (i.totalBytes ?? i.receivedBytes ?? 0), 0);
          return {
            id: o.key,
            title: t(o.labelKey),
            items,
            totalBytes,
          };
        });
    }

    if (groupBy === 'status') {
      const buckets: Record<StatusFilter, DownloadItem[]> = {
        active: [],
        queued: [],
        completed: [],
        failed: [],
        all: [],
      };
      for (const item of visible) {
        if (ACTIVE.includes(item.status)) buckets.active.push(item);
        else if (item.status === 'queued' || item.status === 'paused') buckets.queued.push(item);
        else if (item.status === 'completed') buckets.completed.push(item);
        else if (item.status === 'error') buckets.failed.push(item);
      }
      const order: Array<{ key: StatusFilter; labelKey: MessageKey }> = [
        { key: 'active', labelKey: 'filter.active' },
        { key: 'queued', labelKey: 'filter.queued' },
        { key: 'completed', labelKey: 'filter.completed' },
        { key: 'failed', labelKey: 'filter.failed' },
      ];
      return order
        .filter((o) => buckets[o.key].length > 0)
        .map((o) => {
          const items = buckets[o.key];
          const totalBytes = items.reduce((sum, i) => sum + (i.totalBytes ?? i.receivedBytes ?? 0), 0);
          return {
            id: o.key,
            title: t(o.labelKey),
            items,
            totalBytes,
          };
        });
    }

    if (groupBy === 'queue') {
      const map = new Map<string, DownloadItem[]>();
      for (const item of visible) {
        const qId = item.queueId || 'main';
        const list = map.get(qId);
        if (list) list.push(item);
        else map.set(qId, [item]);
      }
      const result: DownloadGroup[] = [];
      if (map.has('main')) {
        const items = map.get('main')!;
        const totalBytes = items.reduce((sum, i) => sum + (i.totalBytes ?? i.receivedBytes ?? 0), 0);
        result.push({
          id: 'main',
          title: queueNames.get('main') || t('queue.main'),
          items,
          totalBytes,
        });
      }
      for (const q of queues) {
        if (q.id === 'main') continue;
        const items = map.get(q.id);
        if (items && items.length > 0) {
          const totalBytes = items.reduce((sum, i) => sum + (i.totalBytes ?? i.receivedBytes ?? 0), 0);
          result.push({
            id: q.id,
            title: q.name,
            items,
            totalBytes,
          });
        }
      }
      for (const [qId, items] of map.entries()) {
        if (qId !== 'main' && !queues.some((q) => q.id === qId)) {
          const totalBytes = items.reduce((sum, i) => sum + (i.totalBytes ?? i.receivedBytes ?? 0), 0);
          result.push({
            id: qId,
            title: queueNames.get(qId) || qId,
            items,
            totalBytes,
          });
        }
      }
      return result;
    }

    return [];
  }, [groupBy, visible, t, queueNames, queues]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        toast(errorText(t, err), 'error');
      }
    },
    [t, toast]
  );

  const ids = (items: DownloadItem[]) => items.map((i) => i.id);

  function onRowClick(e: React.MouseEvent, item: DownloadItem) {
    // Right-clicking inside a multi-selection keeps it for the context menu
    if (e.button === 2 && selected.has(item.id)) return;
    if (e.shiftKey && anchor) {
      const a = visible.findIndex((d) => d.id === anchor);
      const b = visible.findIndex((d) => d.id === item.id);
      const [from, to] = a < b ? [a, b] : [b, a];
      setSelected(new Set(visible.slice(from, to + 1).map((d) => d.id)));
      setInspectingId(null);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setInspectingId(null);
    } else {
      setSelected(new Set([item.id]));
      setInspectingId(item.id);
    }
    setAnchor(item.id);
    setFocusedId(item.id);
  }

  function onDoubleClick(item: DownloadItem) {
    if (item.status === 'completed') void run(() => api.downloads.openFile(item.id));
    else if (canResume(item)) void run(() => api.downloads.resume([item.id]));
  }

  const removeWithUndo = useCallback(
    (targets: DownloadItem[]) => {
      const targetIds = targets.map((t) => t.id);
      undoBufferRef.current = { items: targets.slice() };
      void run(async () => {
        await api.downloads.remove(targetIds, false);
        toast(t('dl.confirmRemove', { count: targetIds.length }), 'info', {
          label: t('common.undo'),
          run: () => {
            const buf = undoBufferRef.current;
            if (!buf || buf.items.length === 0) return;
            const http = buf.items
              .filter((i) => i.kind === 'http')
              .map((i) => ({
                url: i.url,
                fileName: i.fileName,
                category: i.category,
                directory: i.directory,
                connections: i.connections,
                queueId: i.queueId,
                startPaused: true,
              }));
            const media = buf.items
              .filter((i) => i.kind === 'media' && i.media)
              .map((i) => ({
                platform: i.media!.platform,
                mediaId: i.media!.mediaId,
                format: i.media!.format,
                qualityId: i.media!.qualityId,
                url: i.url,
                title: i.media!.title,
                author: i.media!.author,
                thumbnailUrl: i.media!.thumbnailUrl,
                directory: i.directory,
                queueId: i.queueId,
                startPaused: true,
              }));
            if (http.length > 0) void api.downloads.addHttp(http);
            if (media.length > 0) void api.downloads.addMedia(media);
            toast(t('dl.undone'), 'success');
          },
        });
      });
    },
    [run, t, toast]
  );

  const clearCompletedWithUndo = useCallback(() => {
    const completed = downloads.filter((d) => d.status === 'completed');
    if (completed.length === 0) return;
    undoBufferRef.current = { items: completed.slice() };
    void run(async () => {
      await api.downloads.clearCompleted();
      toast(t('dl.clearedCompleted'), 'info', {
        label: t('common.undo'),
        run: () => {
          const buf = undoBufferRef.current;
          if (!buf || buf.items.length === 0) return;
          const http = buf.items
            .filter((i) => i.kind === 'http')
            .map((i) => ({
              url: i.url,
              fileName: i.fileName,
              category: i.category,
              directory: i.directory,
              connections: i.connections,
              queueId: i.queueId,
              startPaused: true,
            }));
          if (http.length > 0) void api.downloads.addHttp(http);
          toast(t('dl.undone'), 'success');
        },
      });
    });
  }, [downloads, run, t, toast]);

  // Keyboard: Arrow keys, Home, End, Space, Delete, Ctrl+A, Ctrl+F, Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select') || dialog) return;

      if (e.key === 'Escape') {
        if (selected.size > 0 || inspectingId) {
          setSelected(new Set());
          setInspectingId(null);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (visible.length === 0) return;
        const currentId = focusedId ?? anchor ?? selectedItems[0]?.id;
        const currentIdx = visible.findIndex((d) => d.id === currentId);
        let nextIdx = currentIdx;
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx < visible.length - 1 ? (currentIdx >= 0 ? currentIdx + 1 : 0) : 0;
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : visible.length - 1;
        }
        const nextItem = visible[nextIdx];
        if (!nextItem) return;

        setFocusedId(nextItem.id);
        if (e.shiftKey && anchor) {
          const a = visible.findIndex((d) => d.id === anchor);
          const [from, to] = a < nextIdx ? [a, nextIdx] : [nextIdx, a];
          setSelected(new Set(visible.slice(from, to + 1).map((d) => d.id)));
          setInspectingId(null);
        } else {
          setSelected(new Set([nextItem.id]));
          setAnchor(nextItem.id);
          setInspectingId(nextItem.id);
        }
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        if (visible.length > 0) {
          const first = visible[0];
          setFocusedId(first.id);
          setSelected(new Set([first.id]));
          setAnchor(first.id);
          setInspectingId(first.id);
        }
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        if (visible.length > 0) {
          const last = visible[visible.length - 1];
          setFocusedId(last.id);
          setSelected(new Set([last.id]));
          setAnchor(last.id);
          setInspectingId(last.id);
        }
        return;
      }

      if (e.key === ' ' && selectedItems.length > 0) {
        e.preventDefault();
        if (selectedItems.some(canResume)) {
          void run(() => api.downloads.resume(ids(selectedItems)));
        } else if (selectedItems.some(canPause)) {
          void run(() => api.downloads.pause(ids(selectedItems)));
        }
        return;
      }

      if (e.key === 'Delete' && selectedItems.length > 0) {
        if (e.shiftKey) {
          setDialog({ kind: 'remove', ids: ids(selectedItems), deleteFiles: true });
        } else {
          removeWithUndo(selectedItems);
        }
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelected(new Set(visible.map((d) => d.id)));
        setInspectingId(null);
      } else if (e.key === 'Enter' && single) {
        onDoubleClick(single);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function menuFor(item: DownloadItem): MenuEntry[] {
    const targets = selected.has(item.id) ? selectedItems : [item];
    const done = item.status === 'completed';
    return [
      { label: t('dl.open'), icon: <ExternalLink size={15} />, disabled: !done, onClick: () => void run(() => api.downloads.openFile(item.id)) },
      { label: t('dl.showInFolder'), icon: <FolderOpen size={15} />, onClick: () => void run(() => api.downloads.showInFolder(item.id)) },
      { separator: true },
      { label: t('dl.resume'), icon: <Play size={15} />, disabled: !targets.some(canResume), onClick: () => void run(() => api.downloads.resume(ids(targets))) },
      { label: t('dl.pause'), icon: <Pause size={15} />, disabled: !targets.some(canPause), onClick: () => void run(() => api.downloads.pause(ids(targets))) },
      { label: t('dl.retry'), icon: <RotateCw size={15} />, disabled: !targets.some((d) => d.status === 'error'), onClick: () => void run(() => api.downloads.retry(ids(targets))) },
      { separator: true },
      {
        label: t('dl.copyLink'),
        icon: <Copy size={15} />,
        onClick: () =>
          void run(async () => {
            await api.downloads.copyUrl(item.id);
            toast(t('dl.copied'), 'success');
          }),
      },
      { label: t('dl.changeLink'), icon: <Link size={15} />, disabled: item.kind !== 'http' || done, onClick: () => setDialog({ kind: 'url', item }) },
      { label: t('dl.speedLimit'), icon: <Gauge size={15} />, disabled: item.kind !== 'http' || done, onClick: () => setDialog({ kind: 'limit', item }) },
      {
        label: t('dl.inspectSegments'),
        icon: <Activity size={15} />,
        disabled: item.kind !== 'http' || done,
        onClick: () => setDialog({ kind: 'segments', item }),
      },
      { label: t('dl.verify'), icon: <ShieldCheck size={15} />, disabled: !done, onClick: () => setDialog({ kind: 'verify', item }) },
      { separator: true },
      ...queues
        .filter((q) => q.id !== (item.queueId || 'main'))
        .map((q) => ({
          label: `${t('queue.moveTo')}: ${q.name}`,
          icon: <Layers size={15} />,
          onClick: () =>
            void run(async () => {
              for (const target of targets) {
                await api.queues.moveItem(target.id, q.id);
              }
              toast(t('queue.items', { count: targets.length }), 'info');
            }),
        })),
      { separator: true },
      { label: t('dl.moveTop'), icon: <ArrowUpToLine size={15} />, onClick: () => void run(() => api.downloads.move(item.id, 'top')) },
      { label: t('dl.moveUp'), icon: <ArrowUp size={15} />, onClick: () => void run(() => api.downloads.move(item.id, 'up')) },
      { label: t('dl.moveDown'), icon: <ArrowDown size={15} />, onClick: () => void run(() => api.downloads.move(item.id, 'down')) },
      { label: t('dl.moveBottom'), icon: <ArrowDownToLine size={15} />, onClick: () => void run(() => api.downloads.move(item.id, 'bottom')) },
      { separator: true },
      { label: t('dl.remove'), icon: <Trash2 size={15} />, onClick: () => setDialog({ kind: 'remove', ids: ids(targets), deleteFiles: false }) },
      {
        label: t('dl.removeDelete'),
        icon: <Trash2 size={15} />,
        danger: true,
        disabled: !targets.some((d) => d.status === 'completed'),
        onClick: () => setDialog({ kind: 'remove', ids: ids(targets), deleteFiles: true }),
      },
    ];
  }

  const filters: StatusFilter[] = ['all', 'active', 'queued', 'completed', 'failed'];

  // Rows are memoised: they get one stable set of callbacks that forwards to the latest handlers
  const latestActions = useRef<RowActions>(null!);
  latestActions.current = {
    click: onRowClick,
    doubleClick: onDoubleClick,
    contextMenu: (e, item) => {
      e.preventDefault();
      if (!selected.has(item.id)) setSelected(new Set([item.id]));
      setMenu({ x: e.clientX, y: e.clientY, item });
    },
    toggle: (item) => void run(() => (canResume(item) ? api.downloads.resume([item.id]) : api.downloads.pause([item.id]))),
    openFile: (item) => void run(() => api.downloads.openFile(item.id)),
    openFolder: (item) => void run(() => api.downloads.showInFolder(item.id)),
    remove: (item) => removeWithUndo([item]),
    changeUrl: (item) => setDialog({ kind: 'url', item }),
    retry: (item) => void run(() => api.downloads.retry([item.id])),
    toggleSelect: (item) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setInspectingId(null);
    },
    dragStart: (e, item) => {
      e.dataTransfer.setData('text/download-id', item.id);
      e.dataTransfer.effectAllowed = 'move';
    },
    dragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    drop: (e, targetItem) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData('text/download-id');
      if (!sourceId || sourceId === targetItem.id) return;
      const targetQueueId = targetItem.queueId || 'main';
      const sourceItem = downloads.find((d) => d.id === sourceId);
      if (!sourceItem) return;

      if ((sourceItem.queueId || 'main') !== targetQueueId) {
        void run(async () => {
          await api.queues.moveItem(sourceId, targetQueueId);
          toast(t('queue.items', { count: 1 }), 'info');
        });
        return;
      }

      const queueItems = inQueue.filter((d) => (d.queueId || 'main') === targetQueueId);
      const order = queueItems.map((d) => d.id);
      const srcIdx = order.indexOf(sourceId);
      const dstIdx = order.indexOf(targetItem.id);
      if (srcIdx >= 0 && dstIdx >= 0) {
        order.splice(srcIdx, 1);
        order.splice(dstIdx, 0, sourceId);
        void run(() => api.queues.reorder(targetQueueId, order));
      }
    },
  };
  const rowActions = useMemo<RowActions>(
    () => ({
      click: (e, item) => latestActions.current.click(e, item),
      doubleClick: (item) => latestActions.current.doubleClick(item),
      contextMenu: (e, item) => latestActions.current.contextMenu(e, item),
      toggle: (item) => latestActions.current.toggle(item),
      openFile: (item) => latestActions.current.openFile(item),
      openFolder: (item) => latestActions.current.openFolder(item),
      remove: (item) => latestActions.current.remove(item),
      changeUrl: (item) => latestActions.current.changeUrl?.(item),
      retry: (item) => latestActions.current.retry?.(item),
      toggleSelect: (item) => latestActions.current.toggleSelect?.(item),
      dragStart: (e, item) => latestActions.current.dragStart?.(e, item),
      dragOver: (e, item) => latestActions.current.dragOver?.(e, item),
      drop: (e, item) => latestActions.current.drop?.(e, item),
    }),
    []
  );

  return (
    <div className="dl-layout">
      <div className="dl-head">
        <div className="dl-head-primary">
          <h1>{category === 'all' ? t('dl.title') : t(`cat.${category}` as MessageKey)}</h1>
          <ActiveStat count={counts.active} />
          <div style={{ flex: 1 }} />
          <div className="input-with-icon" style={{ width: 240 }}>
            <Search size={15} />
            <input
              ref={searchInputRef}
              id="dl-search-input"
              className="input"
              value={query}
              placeholder={t('dl.searchPlaceholder')}
              onChange={(e) => setQuery(e.target.value)}
              style={query ? { paddingInlineEnd: 28 } : undefined}
            />
            {query && (
              <button
                type="button"
                className="input-clear-btn"
                title={t('common.clear')}
                onClick={() => setQuery('')}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button className="btn primary" onClick={() => onAdd()}>
            <Plus size={16} /> <span className="hide-narrow">{t('dl.add')}</span>
          </button>
          <div className="divider" />
          <button className="btn ghost" title={t('dl.resumeAll')} onClick={() => void run(() => api.downloads.resumeAll())}>
            <Play size={15} /> <span className="hide-narrow">{t('dl.resumeAll')}</span>
          </button>
          <button className="btn ghost" title={t('dl.pauseAll')} onClick={() => void run(() => api.downloads.pauseAll())}>
            <Pause size={15} /> <span className="hide-narrow">{t('dl.pauseAll')}</span>
          </button>
          <button className="btn ghost" disabled={counts.completed === 0} title={t('dl.clearCompleted')} onClick={() => void clearCompletedWithUndo()}>
            <Inbox size={15} /> <span className="hide-narrow">{t('dl.clearCompleted')}</span>
          </button>
          <div className="popover-menu-wrap" ref={viewMenuRef}>
            <button
              className={`btn ghost ${showViewMenu ? 'active' : ''}`}
              title={t('dl.viewOptions')}
              onClick={() => setShowViewMenu((v) => !v)}
            >
              <SlidersHorizontal size={15} />
              <span className="hide-narrow">{t('dl.viewOptions')}</span>
            </button>
            {showViewMenu && (
              <div className="dropdown-popover">
                <div className="dropdown-popover-header">{t('dl.groupBy')}</div>
                {(['date', 'status', 'queue', 'none'] as GroupByOption[]).map((opt) => (
                  <button
                    key={opt}
                    className={`dropdown-popover-item ${groupBy === opt ? 'active' : ''}`}
                    onClick={() => {
                      setGroupBy(opt);
                      try {
                        localStorage.setItem('grabbit_dl_grouping', opt);
                      } catch {}
                      setShowViewMenu(false);
                    }}
                  >
                    <span>{t(`dl.group.${opt}` as MessageKey)}</span>
                    {groupBy === opt && <span>✓</span>}
                  </button>
                ))}
                <div className="dropdown-popover-divider" />
                <div className="dropdown-popover-header">{t('dl.density')}</div>
                {(['comfortable', 'compact'] as DensityOption[]).map((opt) => (
                  <button
                    key={opt}
                    className={`dropdown-popover-item ${density === opt ? 'active' : ''}`}
                    onClick={() => {
                      setDensity(opt);
                      try {
                        localStorage.setItem('grabbit_dl_density', opt);
                      } catch {}
                      setShowViewMenu(false);
                    }}
                  >
                    <span>{opt === 'comfortable' ? t('dl.densityComfortable') : t('dl.densityCompact')}</span>
                    {density === opt && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="dl-head-secondary">
          <div className="queue-dropdown-wrap" ref={queueMenuRef}>
            <button
              type="button"
              className={`queue-menu-trigger ${showQueueMenu ? 'active' : ''}`}
              onClick={() => setShowQueueMenu((v) => !v)}
              title={t('queue.title')}
              aria-expanded={showQueueMenu}
            >
              {currentQueue ? (
                <span
                  className={`queue-dot ${currentQueue.enabled ? 'running' : 'stopped'}`}
                  title={currentQueue.enabled ? t('queue.start') : t('queue.stop')}
                />
              ) : (
                <Layers size={14} />
              )}
              <span className="queue-menu-trigger-label">
                {currentQueue ? currentQueue.name : t('queue.all')}
              </span>
              <span className="queue-badge">{queueCounts[selectedQueueId] ?? 0}</span>
              <ChevronDown
                size={13}
                style={{
                  transform: showQueueMenu ? 'rotate(180deg)' : undefined,
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>

            {currentQueue && (
              <div className="queue-quick-controls">
                <button
                  type="button"
                  className={`queue-btn-action ${currentQueue.enabled ? 'running' : ''}`}
                  title={currentQueue.enabled ? t('queue.stop') : t('queue.start')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void run(() => (currentQueue.enabled ? api.queues.stop(currentQueue.id) : api.queues.start(currentQueue.id)));
                  }}
                >
                  {currentQueue.enabled ? <Pause size={12} /> : <Play size={12} />}
                </button>
                <button
                  type="button"
                  className="queue-btn-action"
                  title={t('queue.edit')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setQueueModal({ queue: currentQueue });
                  }}
                >
                  <Settings size={12} />
                </button>
              </div>
            )}

            {showQueueMenu && (
              <div className="queue-dropdown-popover">
                <div className="dropdown-popover-header">{t('queue.title')}</div>

                <div
                  role="button"
                  tabIndex={0}
                  className={`queue-dropdown-item ${selectedQueueId === 'all' ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedQueueId('all');
                    setShowQueueMenu(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setSelectedQueueId('all');
                      setShowQueueMenu(false);
                    }
                  }}
                >
                  <div className="queue-dropdown-item-left">
                    <Layers size={14} />
                    <span className="queue-dropdown-item-title">{t('queue.all')}</span>
                  </div>
                  <div className="queue-dropdown-item-right">
                    <span className="queue-badge">{queueCounts['all'] ?? 0}</span>
                    {selectedQueueId === 'all' && <span style={{ fontSize: 11, fontWeight: 700 }}>✓</span>}
                  </div>
                </div>

                <div className="dropdown-popover-divider" />

                {queues.map((q) => {
                  const isSelected = selectedQueueId === q.id;
                  return (
                    <div
                      key={q.id}
                      role="button"
                      tabIndex={0}
                      className={`queue-dropdown-item ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedQueueId(q.id);
                        setShowQueueMenu(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedQueueId(q.id);
                          setShowQueueMenu(false);
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const draggedId = e.dataTransfer.getData('text/download-id');
                        if (!draggedId) return;
                        const toMove = selected.has(draggedId) ? Array.from(selected) : [draggedId];
                        void run(async () => {
                          for (const id of toMove) {
                            await api.queues.moveItem(id, q.id);
                          }
                          toast(t('queue.items', { count: toMove.length }), 'info');
                        });
                        setShowQueueMenu(false);
                      }}
                    >
                      <div className="queue-dropdown-item-left">
                        <span
                          className={`queue-dot ${q.enabled ? 'running' : 'stopped'}`}
                          title={q.enabled ? t('queue.start') : t('queue.stop')}
                        />
                        <span className="queue-dropdown-item-title" title={q.name}>
                          {q.name}
                        </span>
                      </div>
                      <div className="queue-dropdown-item-right" onClick={(e) => e.stopPropagation()}>
                        <span className="queue-badge">{queueCounts[q.id] ?? 0}</span>
                        <button
                          type="button"
                          className={`queue-btn-action ${q.enabled ? 'running' : ''}`}
                          title={q.enabled ? t('queue.stop') : t('queue.start')}
                          onClick={() => {
                            void run(() => (q.enabled ? api.queues.stop(q.id) : api.queues.start(q.id)));
                          }}
                        >
                          {q.enabled ? <Pause size={12} /> : <Play size={12} />}
                        </button>
                        <button
                          type="button"
                          className="queue-btn-action"
                          title={t('queue.edit')}
                          onClick={() => {
                            setQueueModal({ queue: q });
                            setShowQueueMenu(false);
                          }}
                        >
                          <Settings size={12} />
                        </button>
                        {isSelected && <span style={{ fontSize: 11, fontWeight: 700 }}>✓</span>}
                      </div>
                    </div>
                  );
                })}

                <div className="dropdown-popover-divider" />

                <button
                  type="button"
                  className="dropdown-popover-item"
                  style={{ color: 'var(--accent)', fontWeight: 600, gap: 8 }}
                  onClick={() => {
                    setQueueModal({ queue: null });
                    setShowQueueMenu(false);
                  }}
                >
                  <Plus size={14} />
                  <span>{t('queue.new')}</span>
                </button>
              </div>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <div className="segmented">
            {filters.map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {t(`filter.${f}` as MessageKey)} <span className="n">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="table-wrap" ref={tableRef} onMouseDown={(e) => e.target === tableRef.current && setSelected(new Set())}>
        {visible.length === 0 ? (
          <div className="empty">
            <div className="icon-circle">
              <Download size={28} />
            </div>
            <h3>{t('dl.empty')}</h3>
            <p>{t('dl.emptyHint')}</p>
            <button className="btn primary" style={{ marginTop: 10 }} onClick={() => onAdd()}>
              <Plus size={16} /> {t('dl.add')}
            </button>
          </div>
        ) : (
          <table
            className={`dl-table ${density === 'compact' ? 'compact' : ''}`}
            role="grid"
            aria-label={category === 'all' ? t('dl.title') : t(`cat.${category}` as MessageKey)}
          >
            <colgroup>
              <col style={{ width: 38 }} />
              <col />
              <col style={{ width: 140 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 92 }} />
              <col style={{ width: 96 }} className="hide-narrow" />
              <col style={{ width: 112 }} />
            </colgroup>
            <thead>
              <tr role="row">
                <th role="columnheader" className="check-col">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isPartiallySelected;
                    }}
                    onChange={toggleSelectAll}
                    aria-label={t('dl.selectAll')}
                    title={isAllSelected ? t('dl.deselectAll') : t('dl.selectAll')}
                  />
                </th>
                <th role="columnheader" className="sortable" onClick={() => toggleSort('name')}>
                  {t('dl.col.name')} {sortBy === 'name' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th role="columnheader" className="sortable" onClick={() => toggleSort('size')}>
                  {t('dl.col.size')} {sortBy === 'size' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th role="columnheader" className="sortable" onClick={() => toggleSort('progress')}>
                  {t('dl.col.progress')} {sortBy === 'progress' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th role="columnheader" className="sortable" onClick={() => toggleSort('speed')}>
                  {t('dl.col.speed')} {sortBy === 'speed' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th role="columnheader">{t('dl.col.eta')}</th>
                <th role="columnheader" className="hide-narrow sortable" onClick={() => toggleSort('added')}>
                  {t('dl.col.added')} {sortBy === 'added' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th role="columnheader" />
              </tr>
            </thead>
            <tbody role="rowgroup">
              {groupBy === 'none' ? (
                <>
                  {rows.start > 0 && (
                    <tr className="dl-spacer" aria-hidden="true">
                      <td colSpan={8} style={{ height: rows.start * rowHeight }} />
                    </tr>
                  )}
                  {visible.slice(rows.start, rows.end).map((item) => (
                    <DownloadRow
                      key={item.id}
                      item={item}
                      selected={selected.has(item.id)}
                      isFocused={focusedId === item.id}
                      queueName={selectedQueueId === 'all' ? queueNames.get(item.queueId || 'main') : undefined}
                      actions={rowActions}
                      density={density}
                    />
                  ))}
                  {rows.end < visible.length && (
                    <tr className="dl-spacer" aria-hidden="true">
                      <td colSpan={8} style={{ height: (visible.length - rows.end) * rowHeight }} />
                    </tr>
                  )}
                </>
              ) : (
                groups.map((grp) => {
                  const isCollapsed = collapsedGroups.has(grp.id);
                  return (
                    <Fragment key={grp.id}>
                      <tr className="group-header-row" role="row">
                        <td colSpan={8}>
                          <div className="group-header-content">
                            <button
                              type="button"
                              className="group-collapse-btn"
                              onClick={() => toggleGroupCollapse(grp.id)}
                            >
                              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                              <span>{grp.title}</span>
                              <span className="group-count-pill">{grp.items.length}</span>
                              {grp.totalBytes > 0 && (
                                <span className="group-size-pill">({formatBytes(grp.totalBytes, language)})</span>
                              )}
                            </button>
                            <div className="group-actions">
                              {grp.items.some(canResume) && (
                                <button
                                  type="button"
                                  className="btn ghost xs"
                                  title={t('dl.resume')}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void run(() => api.downloads.resume(grp.items.filter(canResume).map((i) => i.id)));
                                  }}
                                >
                                  <Play size={12} />
                                </button>
                              )}
                              {grp.items.some(canPause) && (
                                <button
                                  type="button"
                                  className="btn ghost xs"
                                  title={t('dl.pause')}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void run(() => api.downloads.pause(grp.items.filter(canPause).map((i) => i.id)));
                                  }}
                                >
                                  <Pause size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed &&
                        grp.items.map((item) => (
                          <DownloadRow
                            key={item.id}
                            item={item}
                            selected={selected.has(item.id)}
                            isFocused={focusedId === item.id}
                            queueName={selectedQueueId === 'all' && groupBy !== 'queue' ? queueNames.get(item.queueId || 'main') : undefined}
                            actions={rowActions}
                            density={density}
                          />
                        ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {selectedItems.length > 0 && !single && (
          <motion.div
            className="floating-selection-bar"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.16 }}
          >
            <div className="sel-count">
              <span className="sel-badge">{selectedItems.length}</span>
              <span>{t('dl.selectedCount', { count: selectedItems.length })}</span>
            </div>
            <div className="sel-divider" />
            <div className="sel-actions">
              {selectedItems.some(canResume) && (
                <button
                  className="btn sm"
                  onClick={() => void run(() => api.downloads.resume(ids(selectedItems)))}
                  title={t('dl.resume')}
                >
                  <Play size={13} /> {t('dl.resume')}
                </button>
              )}
              {selectedItems.some(canPause) && (
                <button
                  className="btn sm"
                  onClick={() => void run(() => api.downloads.pause(ids(selectedItems)))}
                  title={t('dl.pause')}
                >
                  <Pause size={13} /> {t('dl.pause')}
                </button>
              )}
              {selectedItems.some((d) => d.status === 'error') && (
                <button
                  className="btn sm"
                  onClick={() => void run(() => api.downloads.retry(ids(selectedItems.filter((d) => d.status === 'error'))))}
                  title={t('dl.retry')}
                >
                  <RotateCw size={13} /> {t('dl.retry')}
                </button>
              )}
              <button
                className="btn sm"
                onClick={() => {
                  const urls = selectedItems.map((i) => i.url).join('\n');
                  void navigator.clipboard.writeText(urls);
                  toast(t('dl.copied'), 'success');
                }}
                title={t('dl.copyLink')}
              >
                <Copy size={13} /> {t('dl.copyLink')}
              </button>
              {queues.length > 1 && (
                <div className="sel-queue-move">
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const targetQueueId = e.target.value;
                      if (!targetQueueId) return;
                      void run(async () => {
                        for (const id of ids(selectedItems)) {
                          await api.queues.moveItem(id, targetQueueId);
                        }
                        toast(t('queue.items', { count: selectedItems.length }), 'info');
                      });
                      e.target.value = '';
                    }}
                  >
                    <option value="" disabled>
                      {t('queue.moveTo')}…
                    </option>
                    {queues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                className="btn sm danger"
                onClick={() => removeWithUndo(selectedItems)}
                title={t('dl.remove')}
              >
                <Trash2 size={13} /> {t('dl.remove')}
              </button>
              <div className="sel-divider" />
              <button
                className="btn ghost sm icon"
                onClick={() => {
                  setSelected(new Set());
                  setInspectingId(null);
                }}
                title={t('dl.deselectAll')}
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {single && (
          <DetailsPanel
            key={single.id}
            item={single}
            onClose={() => {
              setInspectingId(null);
              setSelected(new Set());
            }}
            onCopyUrl={() =>
              void run(async () => {
                await api.downloads.copyUrl(single.id);
                toast(t('dl.copied'), 'success');
              })
            }
            onOpenFile={() => void run(() => api.downloads.openFile(single.id))}
            onOpenFolder={() => void run(() => api.downloads.showInFolder(single.id))}
            onInspectSegments={(item) => setDialog({ kind: 'segments', item })}
          />
        )}
      </AnimatePresence>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu.item)} onClose={() => setMenu(null)} />}

      {dialog?.kind === 'remove' && (
        <RemoveDialog
          count={dialog.ids.length}
          deleteFiles={dialog.deleteFiles}
          onClose={() => setDialog(null)}
          onConfirm={(deleteFiles) => {
            const target = dialog.ids;
            setDialog(null);
            void run(() => api.downloads.remove(target, deleteFiles));
          }}
        />
      )}
      {dialog?.kind === 'url' && <ChangeUrlDialog item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'limit' && <SpeedLimitDialog item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'verify' && <VerifyDialog item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'segments' && <SegmentInspectorModal item={dialog.item} onClose={() => setDialog(null)} />}
      {queueModal && (
        <QueueConfigModal
          queue={queueModal.queue}
          onClose={() => setQueueModal(null)}
          onSaved={() => {
            setQueueModal(null);
            void refreshQueues();
          }}
          onDeleted={(id: string) => {
            if (selectedQueueId === id) setSelectedQueueId('all');
            setQueueModal(null);
            void refreshQueues();
          }}
        />
      )}
    </div>
  );
}

/** One table row. Subscribes to its own download, so progress re-renders this row and nothing else. */
const DownloadRow = memo(function DownloadRow({
  item: listed,
  selected,
  isFocused,
  queueName,
  actions,
  density: _density = 'comfortable',
}: {
  item: DownloadItem;
  selected: boolean;
  isFocused: boolean;
  queueName?: string;
  actions: RowActions;
  density?: DensityOption;
}) {
  const { t, language } = useI18n();
  const item = useLiveDownload(listed);
  const onClick = (e: React.MouseEvent) => actions.click(e, item);
  const onDoubleClick = () => actions.doubleClick(item);
  const onContextMenu = (e: React.MouseEvent) => actions.contextMenu(e, item);
  const onToggle = () => actions.toggle(item);
  const onOpenFile = () => actions.openFile(item);
  const onOpenFolder = () => actions.openFolder(item);
  const onRemove = () => actions.remove(item);
  const f = fraction(item);
  const active = ACTIVE.includes(item.status);
  const title = item.media?.title && item.status !== 'completed' ? item.media.title : item.fileName;

  let sub: React.ReactNode;
  if (item.status === 'error') {
    const isExpired = item.errorCode === 'HTTP_401' || item.errorCode === 'HTTP_403' || item.errorCode === 'HTTP_410';
    const isFullDisk = item.errorCode === 'ENOSPC';
    sub = (
      <span className="error-sub-row" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--danger)' }}>{errorText(t, { code: item.errorCode, message: item.error })}</span>
        {isExpired && (
          <button
            type="button"
            className="btn ghost xs"
            style={{ padding: '1px 6px', fontSize: 11, height: 20 }}
            title={t('dl.newLinkHint')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => actions.changeUrl?.(item)}
          >
            <Link size={11} /> {t('dl.refreshLink')}
          </button>
        )}
        {isFullDisk && (
          <button
            type="button"
            className="btn ghost xs"
            style={{ padding: '1px 6px', fontSize: 11, height: 20 }}
            title={t('dl.savedTo')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => actions.openFolder(item)}
          >
            <FolderOpen size={11} /> {t('dl.changeFolder')}
          </button>
        )}
        {!isExpired && !isFullDisk && (
          <button
            type="button"
            className="btn ghost xs"
            style={{ padding: '1px 6px', fontSize: 11, height: 20 }}
            title={t('dl.retry')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => actions.retry?.(item)}
          >
            <RotateCw size={11} /> {t('dl.retry')}
          </button>
        )}
      </span>
    );
  } else if (item.status === 'downloading' && item.kind === 'http') {
    sub = (
      <>
        {t('status.downloading')} · {t('dl.connections', { active: item.activeConnections, total: item.connections })}
        {item.retries > 0 && <> · {t('dl.retries', { count: item.retries })}</>}
      </>
    );
  } else if (active && item.media?.stage) {
    sub = item.media.stage;
  } else if (item.status === 'completed') {
    sub = (
      <>
        {item.checksum?.verified === true && <span className="badge success">{t('dl.checksumOk')}</span>}
        {item.checksum?.verified === false && <span className="badge danger">{t('dl.checksumBad')}</span>}
        {item.media?.author ?? new URL(item.url).hostname}
      </>
    );
  } else {
    sub = t(`status.${item.status}` as MessageKey);
  }

  const size =
    item.status === 'completed'
      ? formatBytes(item.totalBytes ?? item.receivedBytes, language)
      : item.receivedBytes > 0
        ? `${formatBytes(item.receivedBytes, language)} / ${item.totalBytes ? formatBytes(item.totalBytes, language) : '?'}`
        : item.totalBytes
          ? formatBytes(item.totalBytes, language)
          : '—';

  return (
    <tr
      role="row"
      aria-selected={selected}
      tabIndex={isFocused ? 0 : -1}
      draggable={item.status !== 'completed'}
      onDragStart={(e) => actions.dragStart?.(e, item)}
      onDragOver={(e) => actions.dragOver?.(e, item)}
      onDrop={(e) => actions.drop?.(e, item)}
      className={selected ? 'dl-row selected' : 'dl-row'}
      onMouseDown={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <td
        role="gridcell"
        className="check-cell"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => actions.toggleSelect?.(item)}
          aria-label={title}
        />
      </td>
      <td role="gridcell">
        <div className="name-cell">
          <FileIcon item={item} />
          <div className="name-text">
            <span className="n" title={title}>
              {title}
            </span>
            <span className="s">
              <span className={`status-dot ${item.status}`} />
              {queueName && <span className="queue-tag">{queueName}</span>}
              {sub}
            </span>
          </div>
        </div>
      </td>
      <td role="gridcell" className="small">{size}</td>
      <td role="gridcell">
        <div className="progress-cell">
          <ProgressBar
            value={f * 100}
            indeterminate={(item.status === 'starting' || item.status === 'processing') && f === 0}
            state={item.status === 'paused' ? 'paused' : item.status === 'completed' ? 'done' : item.status === 'error' ? 'error' : undefined}
          />
          <span className="pct">{formatPercent(f, language)}</span>
        </div>
      </td>
      <td role="gridcell" className="small">{active ? formatSpeed(item.speed, language) : ''}</td>
      <td role="gridcell" className="small">{active ? formatEta(item.eta, language) : ''}</td>
      <td role="gridcell" className="small muted hide-narrow">{formatDate(item.createdAt, language)}</td>
      <td role="gridcell">
        <div className="row-actions">
          {item.status === 'completed' ? (
            <button
              className="btn ghost sm icon"
              title={t('dl.open')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onOpenFile}
            >
              <ExternalLink size={15} />
            </button>
          ) : (
            <button
              className="btn ghost sm icon"
              title={canResume(item) ? t('dl.resume') : t('dl.pause')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onToggle}
            >
              {item.status === 'error' ? <RotateCw size={15} /> : canResume(item) ? <Play size={15} /> : <Pause size={15} />}
            </button>
          )}
          <button className="btn ghost sm icon" title={t('dl.showInFolder')} onMouseDown={(e) => e.stopPropagation()} onClick={onOpenFolder}>
            <FolderOpen size={15} />
          </button>
          <button className="btn ghost sm icon" title={t('dl.remove')} onMouseDown={(e) => e.stopPropagation()} onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
});

function DetailsPanel({
  item: listed,
  onClose,
  onCopyUrl,
  onOpenFile,
  onOpenFolder,
  onInspectSegments,
}: {
  item: DownloadItem;
  onClose(): void;
  onCopyUrl(): void;
  onOpenFile(): void;
  onOpenFolder(): void;
  onInspectSegments(item: DownloadItem): void;
}) {
  const { t, language } = useI18n();
  const item = useLiveDownload(listed);
  // The segment map needs per-segment progress, which is only sent for watched downloads
  useSegmentWatch(item.kind === 'http' && item.status !== 'completed' ? item.id : null);
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  useEffect(() => {
    if (item.status === 'downloading') {
      setSpeedHistory((prev) => [...prev, item.speed ?? 0].slice(-25));
    }
  }, [item.speed, item.status]);
  const total = item.totalBytes ?? 0;
  const where = item.filePath ?? `${item.directory}\\${item.fileName}`;
  return (
    <motion.div
      className="details"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="details-header full">
        <FileIcon item={item} />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="ellipsis" style={{ display: 'block', fontSize: 13.5 }}>
            {item.fileName}
          </b>
          <span className="small muted">{t(`status.${item.status}` as MessageKey)}</span>
        </div>
        <button className="btn sm" onClick={onCopyUrl} title={t('dl.copyLink')}>
          <Copy size={13} /> {t('dl.copyLink')}
        </button>
        {item.status === 'completed' && (
          <button className="btn sm primary" onClick={onOpenFile}>
            <ExternalLink size={13} /> {t('dl.open')}
          </button>
        )}
        <button className="btn sm" onClick={onOpenFolder}>
          <FolderOpen size={13} /> {t('dl.showInFolder')}
        </button>
        <button className="btn ghost sm icon" onClick={onClose} title={t('common.close')}>
          <X size={15} />
        </button>
      </div>
      <dl className="kv full">
        <dt>{t('dl.url')}</dt>
        <dd className="mono small" title={item.url}>
          {item.url}
        </dd>
      </dl>
      <dl className="kv">
        <dt>{t('dl.savedTo')}</dt>
        <dd title={where}>{where}</dd>
      </dl>
      <dl className="kv">
        <dt>{t('dl.col.size')}</dt>
        <dd>
          {formatBytes(item.receivedBytes, language)} / {item.totalBytes ? formatBytes(item.totalBytes, language) : t('dl.unknown')}
        </dd>
      </dl>
      {item.kind === 'http' && (
        <dl className="kv">
          <dt>{t('dl.resumable')}</dt>
          <dd>
            {item.totalBytes === null && item.status === 'queued' ? t('dl.unknown') : item.resumable ? t('dl.yes') : t('dl.no')}
            {' · '}
            {t('dl.connections', { active: item.activeConnections, total: item.connections })}
          </dd>
        </dl>
      )}
      {item.status === 'downloading' && (
        <dl className="kv full">
          <dt>{t('dl.col.speed')}</dt>
          <dd style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{formatSpeed(item.speed, language) || '0 B/s'}</span>
            <Sparkline data={speedHistory} width={130} height={20} />
          </dd>
        </dl>
      )}
      {item.media?.stage && (
        <dl className="kv">
          <dt>{t('dl.stage')}</dt>
          <dd>{item.media.stage}</dd>
        </dl>
      )}
      {item.checksum?.actual && (
        <dl className="kv full">
          <dt>
            {t('dl.checksum')} ({item.checksum.algorithm.toUpperCase()})
          </dt>
          <dd className="mono small">
            {item.checksum.actual}{' '}
            {item.checksum.verified === true && <span className="badge success">{t('dl.checksumOk')}</span>}
            {item.checksum.verified === false && <span className="badge danger">{t('dl.checksumBad')}</span>}
          </dd>
        </dl>
      )}
      {item.status === 'error' && item.error && (
        <dl className="kv full">
          <dt>{t('dl.error')}</dt>
          <dd className="wrap small" style={{ color: 'var(--danger)' }}>
            {item.error}
          </dd>
        </dl>
      )}
      {item.segments && total > 0 && item.status !== 'completed' && (
        <div className="full">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span className="small muted">{t('dl.segments')}</span>
            <button
              type="button"
              className="btn ghost xs"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => onInspectSegments(item)}
            >
              <Activity size={12} /> {t('dl.inspectSegments')}
            </button>
          </div>
          <div
            className="segment-map"
            style={{ cursor: 'pointer' }}
            title={t('dl.inspectSegments')}
            onClick={() => onInspectSegments(item)}
          >
            {item.segments.map((s) => {
              const startPct = (s.start / total) * 100;
              const doneWidth = (s.received / total) * 100;
              return (
                <div key={s.part}>
                  <div className="boundary" style={{ insetInlineStart: `${startPct}%` }} />
                  <div
                    className={`seg ${item.status === 'downloading' && s.end !== null && s.received < s.end - s.start + 1 ? 'active' : ''}`}
                    style={{ insetInlineStart: `${startPct}%`, width: `${doneWidth}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function RemoveDialog({
  count,
  deleteFiles,
  onClose,
  onConfirm,
}: {
  count: number;
  deleteFiles: boolean;
  onClose(): void;
  onConfirm(deleteFiles: boolean): void;
}) {
  const { t } = useI18n();
  const [del, setDel] = useState(deleteFiles);
  return (
    <Modal
      size="sm"
      title={t('dl.remove')}
      icon={<Trash2 size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className={`btn ${del ? 'danger solid' : 'primary'}`} onClick={() => onConfirm(del)} autoFocus>
            {t('dl.remove')}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{t('dl.confirmRemove', { count })}</p>
      <label className="check">
        <input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} />
        <span>{t('dl.confirmDelete')}</span>
      </label>
    </Modal>
  );
}

function ChangeUrlDialog({ item, onClose }: { item: DownloadItem; onClose(): void }) {
  const { t } = useI18n();
  const { toast } = useApp();
  const [url, setUrl] = useState(item.url);
  return (
    <Modal
      title={t('dl.changeLink')}
      icon={<Link size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await api.downloads.changeUrl(item.id, url.trim());
                await api.downloads.resume([item.id]);
                onClose();
              } catch (err) {
                toast(errorText(t, err), 'error');
              }
            }}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t('dl.newLink')}</label>
        <textarea className="textarea mono" rows={3} value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
        <span className="hint">{t('dl.newLinkHint')}</span>
      </div>
    </Modal>
  );
}

function SpeedLimitDialog({ item, onClose }: { item: DownloadItem; onClose(): void }) {
  const { t } = useI18n();
  const [kbps, setKbps] = useState(Math.round((item.speedLimit ?? 0) / 1024));
  return (
    <Modal
      size="sm"
      title={t('dl.speedLimit')}
      icon={<Gauge size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              void api.downloads.setSpeedLimit(item.id, kbps);
              onClose();
            }}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="field">
        <input className="input" type="number" min={0} value={kbps} autoFocus onChange={(e) => setKbps(Math.max(0, Number(e.target.value) || 0))} />
        <span className="hint">{t('dl.limitHint')}</span>
      </div>
    </Modal>
  );
}

function VerifyDialog({ item, onClose }: { item: DownloadItem; onClose(): void }) {
  const { t } = useI18n();
  const { toast } = useApp();
  const [algorithm, setAlgorithm] = useState<ChecksumAlgorithm>(item.checksum?.algorithm ?? 'sha256');
  const [expected, setExpected] = useState(item.checksum?.expected ?? '');
  const [result, setResult] = useState<DownloadItem['checksum'] | null>(item.checksum ?? null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t('dl.verify')}
      icon={<ShieldCheck size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const updated = await api.downloads.verifyChecksum(item.id, algorithm, expected || undefined);
                setResult(updated.checksum ?? null);
              } catch (err) {
                toast(errorText(t, err), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <RotateCw size={15} className="spin" /> : <ShieldCheck size={15} />} {t('dl.compute')}
          </button>
        </>
      }
    >
      <div className="segmented" style={{ alignSelf: 'flex-start' }}>
        {(['md5', 'sha1', 'sha256', 'sha512'] as ChecksumAlgorithm[]).map((a) => (
          <button key={a} className={algorithm === a ? 'active' : ''} onClick={() => setAlgorithm(a)}>
            {a.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="field">
        <label>{t('add.checksum')}</label>
        <input className="input mono" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="…" />
        <span className="hint">{t('dl.verifyHint')}</span>
      </div>
      {result?.actual && result.algorithm === algorithm && (
        <div className="card card-pad" style={{ padding: '10px 14px' }}>
          <div className="mono small selectable" style={{ wordBreak: 'break-all' }}>
            {result.actual}
          </div>
          {result.verified === true && <span className="badge success" style={{ marginTop: 8 }}>{t('dl.checksumOk')}</span>}
          {result.verified === false && <span className="badge danger" style={{ marginTop: 8 }}>{t('dl.checksumBad')}</span>}
        </div>
      )}
    </Modal>
  );
}

function SegmentInspectorModal({ item: listed, onClose }: { item: DownloadItem; onClose(): void }) {
  const { t, language } = useI18n();
  const item = useLiveDownload(listed);
  useSegmentWatch(item.id);
  const segments = item.segments ?? [];
  const total = item.totalBytes ?? 0;
  const activeCount = item.activeConnections;
  const totalConn = item.connections;

  return (
    <Modal
      size="lg"
      title={`${t('dl.inspectSegments')} — ${item.fileName}`}
      icon={<Activity size={18} />}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130, padding: '10px 14px' }}>
          <div className="small muted">{t('dl.connections', { active: activeCount, total: totalConn })}</div>
          <b style={{ fontSize: 16 }}>{activeCount} / {totalConn} {t('dl.statusActive')}</b>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130, padding: '10px 14px' }}>
          <div className="small muted">{t('dl.threads')}</div>
          <b style={{ fontSize: 16 }}>{t('dl.parts', { count: segments.length })}</b>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130, padding: '10px 14px' }}>
          <div className="small muted">{t('dl.col.speed')}</div>
          <b style={{ fontSize: 16 }}>{formatSpeed(item.speed, language) || '0 B/s'}</b>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="small muted">{t('dl.segments')}</span>
          <span className="small muted mono">{formatBytes(item.receivedBytes, language)} / {total > 0 ? formatBytes(total, language) : '—'}</span>
        </div>
        <div className="segment-map" style={{ height: 26, borderRadius: 6 }}>
          {segments.map((s) => {
            const startPct = total > 0 ? (s.start / total) * 100 : 0;
            const doneWidth = total > 0 ? (s.received / total) * 100 : 0;
            const isSegActive = item.status === 'downloading' && s.end !== null && s.received < s.end - s.start + 1;
            return (
              <div key={s.part}>
                <div className="boundary" style={{ insetInlineStart: `${startPct}%` }} />
                <div
                  className={`seg ${isSegActive ? 'active' : ''}`}
                  style={{ insetInlineStart: `${startPct}%`, width: `${doneWidth}%` }}
                  title={`Part ${s.part}: ${formatBytes(s.received, language)} / ${s.end ? formatBytes(s.end - s.start + 1, language) : '?'}`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
        <table className="table" style={{ margin: 0, fontSize: 13 }}>
          <thead>
            <tr>
              <th>{t('dl.thread')}</th>
              <th>{t('dl.range')}</th>
              <th>{t('dl.col.progress')}</th>
              <th>{t('status.ready')}</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s, idx) => {
              const segLen = s.end !== null ? s.end - s.start + 1 : null;
              const pct = segLen ? Math.min(100, Math.round((s.received / segLen) * 100)) : 0;
              const isDone = segLen !== null && s.received >= segLen;
              const isAct = item.status === 'downloading' && !isDone && s.received > 0;
              return (
                <tr key={s.part || idx}>
                  <td><b>Part {Number(s.part) + 1}</b></td>
                  <td className="mono small">
                    {formatBytes(s.start, language)} → {s.end !== null ? formatBytes(s.end, language) : '—'}
                  </td>
                  <td style={{ minWidth: 160 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div className="row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
                        <span>{formatBytes(s.received, language)} / {segLen ? formatBytes(segLen, language) : '—'}</span>
                        <b>{pct}%</b>
                      </div>
                      <ProgressBar value={pct} state={isDone ? 'done' : undefined} />
                    </div>
                  </td>
                  <td>
                    {isDone ? (
                      <span className="badge success">{t('dl.statusDone')}</span>
                    ) : isAct ? (
                      <span className="badge accent">{t('dl.statusActive')}</span>
                    ) : (
                      <span className="badge">{t('dl.statusWait')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
