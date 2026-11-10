import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
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
  Trash2,
  X,
} from 'lucide-react';
import type { Category, ChecksumAlgorithm, DownloadItem, DownloadQueue, DownloadStatus } from '../../../shared/types';
import { errorText, useI18n, type MessageKey } from '../i18n';
import { api, useApp } from '../state';
import { formatBytes, formatDate, formatEta, formatPercent, formatSpeed } from '../format';
import { ContextMenu, FileIcon, MenuEntry, Modal, ProgressBar } from '../components/ui';
import { QueueConfigModal } from '../components/QueueConfigModal';

export type StatusFilter = 'all' | 'active' | 'queued' | 'completed' | 'failed';

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
  const [menu, setMenu] = useState<{ x: number; y: number; item: DownloadItem } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const tableRef = useRef<HTMLDivElement>(null);

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
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = inQueue.filter(
      (d) =>
        matchesStatus(d, filter) &&
        (!q || d.fileName.toLowerCase().includes(q) || d.url.toLowerCase().includes(q) || d.media?.title.toLowerCase().includes(q))
    );
    const mult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
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
  }, [inQueue, filter, query, sortBy, sortDir]);

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
  const single = selectedItems.length === 1 ? selectedItems[0] : null;
  const totalSpeed = downloads.reduce((s, d) => s + (ACTIVE.includes(d.status) ? d.speed : 0), 0);

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
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    } else {
      setSelected(new Set([item.id]));
    }
    setAnchor(item.id);
  }

  function onDoubleClick(item: DownloadItem) {
    if (item.status === 'completed') void run(() => api.downloads.openFile(item.id));
    else if (canResume(item)) void run(() => api.downloads.resume([item.id]));
  }

  // Keyboard: Delete, Ctrl+A, Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select') || dialog) return;
      if (e.key === 'Delete' && selectedItems.length > 0) {
        setDialog({ kind: 'remove', ids: ids(selectedItems), deleteFiles: e.shiftKey });
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelected(new Set(visible.map((d) => d.id)));
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
        disabled: !item.segments || item.segments.length === 0,
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

  return (
    <div className="dl-layout">
      <div className="dl-head">
        <div className="title-row">
          <h1>{category === 'all' ? t('dl.title') : t(`cat.${category}` as MessageKey)}</h1>
          {counts.active > 0 && (
            <span className="stat">
              <Download size={14} /> <b>{formatSpeed(totalSpeed, language) || '0 B/s'}</b> · {t('dl.active', { count: counts.active })}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <div className="input-with-icon" style={{ width: 260 }}>
            <Search size={15} />
            <input
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
        </div>
        <div className="queue-bar">
          <div className="queue-tabs">
            <button
              className={`queue-pill ${selectedQueueId === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedQueueId('all')}
            >
              <Layers size={14} />
              <span>{t('queue.all')}</span>
              <span className="queue-badge">{queueCounts['all'] ?? 0}</span>
            </button>
            {queues.map((q) => {
              const isSelected = selectedQueueId === q.id;
              return (
                <div key={q.id} className={`queue-tab-group ${isSelected ? 'active' : ''}`}>
                  <button
                    className="queue-pill-main"
                    onClick={() => setSelectedQueueId(q.id)}
                    title={q.name}
                  >
                    <span
                      className={`queue-dot ${q.enabled ? 'running' : 'stopped'}`}
                      title={q.enabled ? t('queue.start') : t('queue.stop')}
                    />
                    <span className="queue-title">{q.name}</span>
                    <span className="queue-badge">{queueCounts[q.id] ?? 0}</span>
                  </button>
                  <button
                    className={`queue-btn-action ${q.enabled ? 'running' : ''}`}
                    title={q.enabled ? t('queue.stop') : t('queue.start')}
                    onClick={(e) => {
                      e.stopPropagation();
                      void run(() => (q.enabled ? api.queues.stop(q.id) : api.queues.start(q.id)));
                    }}
                  >
                    {q.enabled ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <button
                    className="queue-btn-action"
                    title={t('queue.edit')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setQueueModal({ queue: q });
                    }}
                  >
                    <Settings size={12} />
                  </button>
                </div>
              );
            })}
            <button
              className="queue-add-btn"
              title={t('queue.new')}
              onClick={() => setQueueModal({ queue: null })}
            >
              <Plus size={14} />
              <span>{t('queue.new')}</span>
            </button>
          </div>
        </div>
        <div className="toolbar">
          <button className="btn primary" onClick={() => onAdd()}>
            <Plus size={16} /> {t('dl.add')}
          </button>
          <div className="divider" />
          <button className="btn" disabled={!selectedItems.some(canResume)} onClick={() => void run(() => api.downloads.resume(ids(selectedItems)))}>
            <Play size={15} /> {t('dl.resume')}
          </button>
          <button className="btn" disabled={!selectedItems.some(canPause)} onClick={() => void run(() => api.downloads.pause(ids(selectedItems)))}>
            <Pause size={15} /> {t('dl.pause')}
          </button>
          <button
            className="btn"
            disabled={selectedItems.length === 0}
            onClick={() => setDialog({ kind: 'remove', ids: ids(selectedItems), deleteFiles: false })}
          >
            <Trash2 size={15} /> {t('dl.remove')}
          </button>
          <div className="divider" />
          <button className="btn ghost" onClick={() => void run(() => api.downloads.resumeAll())}>
            <Play size={15} /> <span className="hide-narrow">{t('dl.resumeAll')}</span>
          </button>
          <button className="btn ghost" onClick={() => void run(() => api.downloads.pauseAll())}>
            <Pause size={15} /> <span className="hide-narrow">{t('dl.pauseAll')}</span>
          </button>
          <button className="btn ghost" disabled={counts.completed === 0} onClick={() => void run(() => api.downloads.clearCompleted())}>
            <Inbox size={15} /> <span className="hide-narrow">{t('dl.clearCompleted')}</span>
          </button>
          <div className="grow" />
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
          <table className="dl-table">
            <colgroup>
              <col />
              <col style={{ width: 150 }} />
              <col style={{ width: 210 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 92 }} />
              <col style={{ width: 96 }} className="hide-narrow" />
              <col style={{ width: 112 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('name')}>
                  {t('dl.col.name')} {sortBy === 'name' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th className="sortable" onClick={() => toggleSort('size')}>
                  {t('dl.col.size')} {sortBy === 'size' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th className="sortable" onClick={() => toggleSort('progress')}>
                  {t('dl.col.progress')} {sortBy === 'progress' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th className="sortable" onClick={() => toggleSort('speed')}>
                  {t('dl.col.speed')} {sortBy === 'speed' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th>{t('dl.col.eta')}</th>
                <th className="hide-narrow sortable" onClick={() => toggleSort('added')}>
                  {t('dl.col.added')} {sortBy === 'added' && <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <DownloadRow
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  queueName={selectedQueueId === 'all' ? queues.find((q) => q.id === (item.queueId || 'main'))?.name : undefined}
                  onClick={(e) => onRowClick(e, item)}
                  onDoubleClick={() => onDoubleClick(item)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!selected.has(item.id)) setSelected(new Set([item.id]));
                    setMenu({ x: e.clientX, y: e.clientY, item });
                  }}
                  onToggle={() =>
                    void run(() => (canResume(item) ? api.downloads.resume([item.id]) : api.downloads.pause([item.id])))
                  }
                  onOpenFile={() => void run(() => api.downloads.openFile(item.id))}
                  onOpenFolder={() => void run(() => api.downloads.showInFolder(item.id))}
                  onRemove={() => setDialog({ kind: 'remove', ids: [item.id], deleteFiles: false })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {single && (
          <DetailsPanel
            key={single.id}
            item={single}
            onClose={() => setSelected(new Set())}
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

function DownloadRow({
  item,
  selected,
  queueName,
  onClick,
  onDoubleClick,
  onContextMenu,
  onToggle,
  onOpenFile,
  onOpenFolder,
  onRemove,
}: {
  item: DownloadItem;
  selected: boolean;
  queueName?: string;
  onClick(e: React.MouseEvent): void;
  onDoubleClick(): void;
  onContextMenu(e: React.MouseEvent): void;
  onToggle(): void;
  onOpenFile(): void;
  onOpenFolder(): void;
  onRemove(): void;
}) {
  const { t, language } = useI18n();
  const f = fraction(item);
  const active = ACTIVE.includes(item.status);
  const title = item.media?.title && item.status !== 'completed' ? item.media.title : item.fileName;

  let sub: React.ReactNode;
  if (item.status === 'error') {
    sub = <span style={{ color: 'var(--danger)' }}>{errorText(t, { code: item.errorCode, message: item.error })}</span>;
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
    <tr className={selected ? 'selected' : ''} onMouseDown={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
      <td>
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
      <td className="small">{size}</td>
      <td>
        <div className="progress-cell">
          <ProgressBar
            value={f * 100}
            indeterminate={(item.status === 'starting' || item.status === 'processing') && f === 0}
            state={item.status === 'paused' ? 'paused' : item.status === 'completed' ? 'done' : item.status === 'error' ? 'error' : undefined}
          />
          <span className="pct">{formatPercent(f, language)}</span>
        </div>
      </td>
      <td className="small">{active ? formatSpeed(item.speed, language) : ''}</td>
      <td className="small">{active ? formatEta(item.eta, language) : ''}</td>
      <td className="small muted hide-narrow">{formatDate(item.createdAt, language)}</td>
      <td>
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
}

function DetailsPanel({
  item,
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

function SegmentInspectorModal({ item, onClose }: { item: DownloadItem; onClose(): void }) {
  const { t, language } = useI18n();
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
          {t('common.cancel') ?? 'Close'}
        </button>
      }
    >
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130, padding: '10px 14px' }}>
          <div className="small muted">{t('dl.connections', { active: activeCount, total: totalConn })}</div>
          <b style={{ fontSize: 16 }}>{activeCount} / {totalConn} active</b>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130, padding: '10px 14px' }}>
          <div className="small muted">{t('dl.threads')}</div>
          <b style={{ fontSize: 16 }}>{segments.length} parts</b>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130, padding: '10px 14px' }}>
          <div className="small muted">Speed</div>
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
              <th>Progress</th>
              <th>Status</th>
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
                      <span className="badge success">Done</span>
                    ) : isAct ? (
                      <span className="badge accent">Active</span>
                    ) : (
                      <span className="badge">Waiting</span>
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
