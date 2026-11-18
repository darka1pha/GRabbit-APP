import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, ChevronDown, ChevronRight, Clock, Copy, Download, ExternalLink, FolderOpen, Gauge, Inbox, Layers, Link, Music, Pause, Play, Plus, RotateCw, Search, Settings, ShieldCheck, SlidersHorizontal, Smartphone, Trash2, X, Zap } from 'lucide-react';
import type { Category, DownloadItem, DownloadQueue, LanTransferInfo } from '../../../shared/types';
import { errorText, useI18n, type MessageKey } from '../i18n';
import { api, useApp } from '../state';
import { formatBytes, computeDownloadSummary } from '../format';
import { ContextMenu, MenuEntry } from '../components/ui';
import { QueueConfigModal } from '../components/QueueConfigModal';
import { QRCodeModal } from '../components/QRCodeModal';
import { downloadStore } from '../downloads-store';
import { formatScheduleCountdown, getScheduleWindowState } from '../utils/schedule';
import { type StatusFilter, type GroupByOption, type DensityOption, ROW_HEIGHT_COMFORTABLE, ROW_HEIGHT_COMPACT, ACTIVE, matchesStatus, buildGroups, type DownloadGroup, fraction, canPause, isFolderDownload, canResume, restoreRemovedItems } from './downloads/model';
import { useVirtualVariableRows, useVirtualRows } from './downloads/virtual-rows';
import { type RowActions, DownloadRow } from './downloads/DownloadRow';
import { DetailsPanel } from './downloads/DetailsPanel';
import { DownloadsHeroStrip } from './downloads/DownloadsHeroStrip';
import { RemoveDialog, ChangeUrlDialog, SpeedLimitDialog, VerifyDialog, SegmentInspectorModal } from './downloads/dialogs';
export { type StatusFilter, type GroupByOption, type DensityOption, ROW_HEIGHT, ROW_HEIGHT_COMFORTABLE, ROW_HEIGHT_COMPACT, getDateGroupKey, matchesStatus } from './downloads/model';

type DialogState =
  | { kind: 'remove'; ids: string[]; deleteFiles: boolean }
  | { kind: 'url'; item: DownloadItem }
  | { kind: 'limit'; item: DownloadItem }
  | { kind: 'verify'; item: DownloadItem }
  | { kind: 'segments'; item: DownloadItem }
  | { kind: 'mobileTransfer'; item: DownloadItem; info: LanTransferInfo }
  | null;

export function DownloadsView({
  category,
  onAdd,
  onGoGrab,
  onGoSettings,
}: {
  category: Category | 'all';
  onAdd(url?: string, mode?: 'single' | 'batch' | 'pattern'): void;
  onGoGrab?: () => void;
  onGoSettings?: (section?: string) => void;
}) {
  const { t, language } = useI18n();
  const { downloads, queues, refreshQueues, toast } = useApp();
  const [selectedQueueId, setSelectedQueueId] = useState<string | 'all'>('all');
  const [queueModal, setQueueModal] = useState<{ queue?: DownloadQueue | null } | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const [nowTick, setNowTick] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'order' | 'added' | 'name' | 'size' | 'progress' | 'speed'>('added');
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

  const queueOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    const targetQueues = selectedQueueId === 'all' ? queues : queues.filter((q) => q.id === selectedQueueId);
    let idx = 0;
    for (const q of targetQueues) {
      for (const id of q.order) map.set(id, idx++);
    }
    return map;
  }, [queues, selectedQueueId]);

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
        case 'order': {
          const ia = queueOrderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const ib = queueOrderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return ia !== ib ? ia - ib : a.createdAt - b.createdAt;
        }
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
  }, [inQueue, filter, query, sortBy, sortDir, sortsByLiveValue, liveSortTick, queueOrderMap]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, active: 0, queued: 0, completed: 0, failed: 0 };
    for (const d of inQueue) {
      for (const f of Object.keys(c) as StatusFilter[]) if (matchesStatus(d, f)) c[f]++;
    }
    return c;
  }, [inQueue]);

  const queueSummary = useMemo(() => computeDownloadSummary(inQueue), [inQueue]);

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
  const queueDisplayName = useCallback(
    (q: Pick<DownloadQueue, 'id' | 'name'>) => {
      if (q.id === 'main' && (!q.name || q.name === 'Main Queue')) return t('queue.main');
      if (q.id === 'scheduled' && (!q.name || q.name === 'Scheduled Queue')) return t('queue.scheduled');
      return q.name;
    },
    [t]
  );
  const queueNames = useMemo(() => new Map(queues.map((q) => [q.id, queueDisplayName(q)])), [queues, queueDisplayName]);
  const currentQueue = useMemo(
    () => (selectedQueueId === 'all' ? null : queues.find((q) => q.id === selectedQueueId) ?? null),
    [queues, selectedQueueId]
  );

  const hasScheduledQueue = useMemo(() => queues.some((q) => q.scheduler?.enabled), [queues]);
  useEffect(() => {
    if (!hasScheduledQueue) return;
    setNowTick(new Date());
    const timer = setInterval(() => setNowTick(new Date()), 15_000);
    return () => clearInterval(timer);
  }, [hasScheduledQueue]);

  const { scheduledBanners, waitingQueueIds } = useMemo(() => {
    const waiting = new Set<string>();
    const banners: Array<{ queue: DownloadQueue; win: ReturnType<typeof getScheduleWindowState> }> = [];
    for (const q of queues) {
      if (!q.scheduler?.enabled) continue;
      const win = getScheduleWindowState(q.scheduler, nowTick);
      if (!win.active || !q.enabled) waiting.add(q.id);
      const matchesQueue = selectedQueueId === 'all' || selectedQueueId === q.id;
      const hasPending = downloads.some(
        (d) => (d.queueId || 'main') === q.id && (d.status === 'queued' || d.status === 'paused')
      );
      if (matchesQueue && (selectedQueueId === q.id || hasPending)) {
        banners.push({ queue: q, win });
      }
    }
    return { scheduledBanners: banners, waitingQueueIds: waiting };
  }, [queues, nowTick, selectedQueueId, downloads]);

  const sendToMobile = useCallback(
    (item: DownloadItem) => {
      void (async () => {
        try {
          const info = await api.downloads.createTransferLink(item.id);
          if (!info) return;
          setDialog({ kind: 'mobileTransfer', item, info });
        } catch (err) {
          toast(
            errorText(t, err),
            'error',
            onGoSettings ? { label: t('nav.settings'), run: () => onGoSettings('sec-extension') } : undefined
          );
        }
      })();
    },
    [t, toast, onGoSettings]
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

  const groups = useMemo(
    () => buildGroups(visible, groupBy, { t, queues, queueDisplayName, queueNames }),
    [groupBy, visible, t, queueNames, queues, queueDisplayName]
  );

  const flatGroupedRows = useMemo(() => {
    if (groupBy === 'none') return [];
    const list: Array<
      | { kind: 'group'; group: DownloadGroup; isCollapsed: boolean }
      | { kind: 'item'; item: DownloadItem }
    > = [];
    for (const grp of groups) {
      const isCollapsed = collapsedGroups.has(grp.id);
      list.push({ kind: 'group', group: grp, isCollapsed });
      if (!isCollapsed) {
        for (const item of grp.items) {
          list.push({ kind: 'item', item });
        }
      }
    }
    return list;
  }, [groupBy, groups, collapsedGroups]);

  const groupedRowHeights = useMemo(
    () => flatGroupedRows.map((entry) => (entry.kind === 'group' ? 36 : rowHeight)),
    [flatGroupedRows, rowHeight]
  );
  const groupedVirtual = useVirtualVariableRows(tableRef, groupedRowHeights);

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
    // A torrent waiting for its files to be chosen only shows its details (selecting the row does)
    else if (item.torrent?.needsSelection) return;
    else if (canResume(item)) void run(() => api.downloads.resume([item.id]));
  }

  const removeWithUndo = useCallback(
    (targets: DownloadItem[]) => {
      const targetIds = targets.map((t) => t.id);
      const snapshot = targets.slice();
      void run(async () => {
        await api.downloads.remove(targetIds, false);
        toast(t('dl.confirmRemove', { count: targetIds.length }), 'info', {
          label: t('common.undo'),
          run: () => {
            restoreRemovedItems(snapshot);
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
    const snapshot = completed.slice();
    void run(async () => {
      await api.downloads.clearCompleted();
      toast(t('dl.clearedCompleted'), 'info', {
        label: t('common.undo'),
        run: () => {
          restoreRemovedItems(snapshot);
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
        let nextIdx: number;
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
      { label: t('dl.sendToMobile'), icon: <Smartphone size={15} />, disabled: !done, onClick: () => sendToMobile(item) },
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
      {
        label: t('dl.speedLimit'),
        icon: <Gauge size={15} />,
        disabled: (item.kind !== 'http' && item.kind !== 'torrent') || done,
        onClick: () => setDialog({ kind: 'limit', item }),
      },
      {
        label: t('dl.inspectSegments'),
        icon: <Activity size={15} />,
        disabled: item.kind !== 'http' || done,
        onClick: () => setDialog({ kind: 'segments', item }),
      },
      { label: t('dl.verify'), icon: <ShieldCheck size={15} />, disabled: !done || isFolderDownload(item), onClick: () => setDialog({ kind: 'verify', item }) },
      { separator: true },
      ...queues
        .filter((q) => q.id !== (item.queueId || 'main'))
        .map((q) => ({
          label: `${t('queue.moveTo')}: ${queueDisplayName(q)}`,
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
      { label: t('dl.moveTop'), icon: <ArrowUpToLine size={15} />, onClick: () => { setSortBy('order'); void run(() => api.downloads.move(item.id, 'top')); } },
      { label: t('dl.moveUp'), icon: <ArrowUp size={15} />, onClick: () => { setSortBy('order'); void run(() => api.downloads.move(item.id, 'up')); } },
      { label: t('dl.moveDown'), icon: <ArrowDown size={15} />, onClick: () => { setSortBy('order'); void run(() => api.downloads.move(item.id, 'down')); } },
      { label: t('dl.moveBottom'), icon: <ArrowDownToLine size={15} />, onClick: () => { setSortBy('order'); void run(() => api.downloads.move(item.id, 'bottom')); } },
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
    sendToMobile,
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
    dragOver: (e, item) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pos: 'before' | 'after' = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
      setDropTarget((prev) => (prev?.id === item.id && prev.pos === pos ? prev : { id: item.id, pos }));
    },
    dragEnd: () => {
      setDropTarget(null);
    },
    drop: (e, targetItem) => {
      e.preventDefault();
      const pos = dropTarget?.id === targetItem.id ? dropTarget.pos : 'before';
      setDropTarget(null);
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

      const targetQueue = queues.find((q) => q.id === targetQueueId);
      const allInTargetQueue = downloads.filter((d) => (d.queueId || 'main') === targetQueueId);
      const knownIds = new Set(allInTargetQueue.map((d) => d.id));
      const existingSet = new Set<string>();
      const order: string[] = [];
      for (const id of targetQueue?.order ?? []) {
        if (knownIds.has(id) && !existingSet.has(id)) {
          existingSet.add(id);
          order.push(id);
        }
      }
      for (const d of allInTargetQueue) {
        if (!existingSet.has(d.id)) {
          existingSet.add(d.id);
          order.push(d.id);
        }
      }
      const srcIdx = order.indexOf(sourceId);
      const dstIdx = order.indexOf(targetItem.id);
      if (srcIdx >= 0 && dstIdx >= 0) {
        const insertIdx = Math.max(0, dstIdx + (pos === 'after' ? 1 : 0) - (srcIdx < dstIdx ? 1 : 0));
        order.splice(srcIdx, 1);
        order.splice(insertIdx, 0, sourceId);
        setSortBy('order');
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
      sendToMobile: (item) => latestActions.current.sendToMobile?.(item),
      changeUrl: (item) => latestActions.current.changeUrl?.(item),
      retry: (item) => latestActions.current.retry?.(item),
      toggleSelect: (item) => latestActions.current.toggleSelect?.(item),
      dragStart: (e, item) => latestActions.current.dragStart?.(e, item),
      dragOver: (e, item) => latestActions.current.dragOver?.(e, item),
      drop: (e, item) => latestActions.current.drop?.(e, item),
      dragEnd: () => latestActions.current.dragEnd?.(),
    }),
    []
  );

  return (
    <div className="dl-layout">
      <div className="dl-head">
        <div className="dl-head-primary">
          <h1>{category === 'all' ? t('dl.title') : t(`cat.${category}` as MessageKey)}</h1>
          <span className="dl-count-chip">{counts.all}</span>
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
          <button className="btn primary" onClick={() => onAdd('', 'single')}>
            <Plus size={16} /> <span className="hide-narrow">{t('dl.add')}</span>
          </button>
          <button className="btn" onClick={() => onAdd('', 'batch')} title={t('dl.addBatch')}>
            <Layers size={15} /> <span className="hide-narrow">{t('dl.addBatch')}</span>
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
                <div className="dropdown-popover-divider" />
                <button
                  className="dropdown-popover-item"
                  onClick={() => {
                    setShowViewMenu(false);
                    void run(async () => {
                      const json = await api.downloads.exportList();
                      await navigator.clipboard.writeText(json);
                      toast(t('dl.exportedToast', { count: downloads.length }), 'success');
                    });
                  }}
                >
                  <span>{t('dl.exportList')}</span>
                </button>
                <button
                  className="dropdown-popover-item"
                  onClick={() => {
                    setShowViewMenu(false);
                    void run(async () => {
                      const text = await navigator.clipboard.readText();
                      const imported = await api.downloads.importList(text);
                      toast(t('dl.importedToast', { count: imported.length }), imported.length > 0 ? 'success' : 'info');
                    });
                  }}
                >
                  <span>{t('dl.importList')}</span>
                </button>
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
              aria-haspopup="listbox"
              aria-expanded={showQueueMenu}
            >
              <Layers size={14} className="queue-trigger-icon" />
              <span className="queue-trigger-prefix">{t('queue.label')}:</span>
              <span className="queue-trigger-name">
                {currentQueue ? queueDisplayName(currentQueue) : t('queue.all')}
              </span>
              {currentQueue && (
                <span
                  className={`queue-dot ${currentQueue.enabled ? 'running' : 'stopped'}`}
                  title={currentQueue.enabled ? t('queue.start') : t('queue.stop')}
                />
              )}
              <span className="queue-badge">{queueCounts[selectedQueueId] ?? 0}</span>
              <ChevronDown
                size={13}
                className="queue-trigger-chevron"
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
                <div className="queue-popover-header">
                  <span className="queue-popover-header-title">{t('queue.title')}</span>
                  <button
                    type="button"
                    className="queue-popover-new-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setQueueModal({ queue: null });
                      setShowQueueMenu(false);
                    }}
                  >
                    <Plus size={11} />
                    <span>{t('queue.new')}</span>
                  </button>
                </div>

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
                    <Layers size={14} className="queue-item-icon" />
                    <span className="queue-dropdown-item-title">{t('queue.all')}</span>
                  </div>
                  <div className="queue-dropdown-item-right">
                    <span className="queue-badge">{queueCounts['all'] ?? 0}</span>
                    {selectedQueueId === 'all' && <span className="queue-check">✓</span>}
                  </div>
                </div>

                <div className="dropdown-popover-divider" />

                <div className="queue-dropdown-list">
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
                          <span className="queue-dropdown-item-title" title={queueDisplayName(q)}>
                            {queueDisplayName(q)}
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
                          {isSelected && <span className="queue-check">✓</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
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

        <DownloadsHeroStrip
          summary={queueSummary}
          counts={counts}
          filter={filter}
          onFilter={setFilter}
        />
      </div>

      {scheduledBanners.length > 0 && (
        <div className="dl-schedule-stack">
          {scheduledBanners.map(({ queue, win }) => {
            const countdown = formatScheduleCountdown(win.remainingMs, language);
            const activeWindow = win.active && queue.enabled;
            return (
              <div key={queue.id} className={`dl-schedule-banner ${activeWindow ? 'active' : ''}`}>
                <Clock size={15} />
                <span className="queue-tag">{queueDisplayName(queue)}</span>
                <span className="grow small">
                  {win.active ? t('queue.stopsIn', { time: countdown }) : t('queue.startsIn', { time: countdown })}
                </span>
                {(!queue.enabled || !win.active) && (
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => void run(() => api.queues.start(queue.id))}
                  >
                    <Play size={12} /> {t('queue.startNow')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        className="table-wrap"
        ref={tableRef}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
        }}
        onMouseDown={(e) => e.target === tableRef.current && setSelected(new Set())}
      >
        {visible.length === 0 ? (
          <div className="empty">
            <div className="icon-circle">
              <Download size={28} />
            </div>
            <h3>{t('dl.empty')}</h3>
            <p>{t('dl.emptyHint')}</p>
            <div className="empty-starter-grid">
              <button type="button" className="card starter-card" onClick={() => onAdd('', 'single')}>
                <Plus size={18} />
                <b>{t('dl.add')}</b>
              </button>
              <button type="button" className="card starter-card" onClick={() => onAdd('', 'batch')}>
                <Layers size={18} />
                <b>{t('dl.addBatch')}</b>
              </button>
              <button type="button" className="card starter-card" onClick={() => onAdd('', 'pattern')}>
                <Zap size={18} />
                <b>{t('add.modePattern')}</b>
              </button>
              {onGoGrab && (
                <button type="button" className="card starter-card" onClick={onGoGrab}>
                  <Music size={18} />
                  <b>{t('nav.grab')}</b>
                </button>
              )}
            </div>
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
                      dropPosition={dropTarget?.id === item.id ? dropTarget.pos : undefined}
                      waitingWindow={item.status === 'queued' && waitingQueueIds.has(item.queueId || 'main')}
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
                <>
                  {groupedVirtual.topHeight > 0 && (
                    <tr className="dl-spacer" aria-hidden="true">
                      <td colSpan={8} style={{ height: groupedVirtual.topHeight }} />
                    </tr>
                  )}
                  {flatGroupedRows.slice(groupedVirtual.start, groupedVirtual.end).map((entry) => {
                    if (entry.kind === 'group') {
                      const grp = entry.group;
                      const isCollapsed = entry.isCollapsed;
                      return (
                        <tr key={`group-${grp.id}`} className="group-header-row" role="row">
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
                      );
                    }
                    const item = entry.item;
                    return (
                      <DownloadRow
                        key={item.id}
                        item={item}
                        selected={selected.has(item.id)}
                        isFocused={focusedId === item.id}
                        queueName={selectedQueueId === 'all' && groupBy !== 'queue' ? queueNames.get(item.queueId || 'main') : undefined}
                        dropPosition={dropTarget?.id === item.id ? dropTarget.pos : undefined}
                        waitingWindow={item.status === 'queued' && waitingQueueIds.has(item.queueId || 'main')}
                        actions={rowActions}
                        density={density}
                      />
                    );
                  })}
                  {groupedVirtual.bottomHeight > 0 && (
                    <tr className="dl-spacer" aria-hidden="true">
                      <td colSpan={8} style={{ height: groupedVirtual.bottomHeight }} />
                    </tr>
                  )}
                </>
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
                        {queueDisplayName(q)}
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
            onSendToMobile={() => sendToMobile(single)}
            onInspectSegments={(item) => setDialog({ kind: 'segments', item })}
          />
        )}
      </AnimatePresence>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu.item)} onClose={() => setMenu(null)} />}

      {dialog?.kind === 'mobileTransfer' && (
        <QRCodeModal
          value={dialog.info.deepLink}
          title={t('dl.transferReady', { name: dialog.info.fileName })}
          subtitle={`${t('dl.sendToMobileDesc')} — ${dialog.info.url}`}
          onClose={() => setDialog(null)}
        />
      )}

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
