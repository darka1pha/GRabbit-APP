import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useI18n } from '../i18n';
import { formatBytes, formatPercent } from '../format';

export interface ChecklistFile {
  path: string;
  length: number;
  completedLength?: number;
}

/** Above this many files the list gets a filter box. */
const FILTER_FROM = 12;

/** Lets the user tick which files of a torrent to download. Indices refer to `files`. */
export function TorrentFileChecklist({
  files,
  selected,
  onChange,
  showProgress,
  disabled,
}: {
  files: ChecklistFile[];
  selected: Set<number>;
  onChange(next: Set<number>): void;
  /** Show each file's progress (a running or paused download). */
  showProgress?: boolean;
  disabled?: boolean;
}) {
  const { t, language } = useI18n();
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();

  const visible = useMemo(
    () => files.map((f, index) => ({ ...f, index })).filter((f) => !q || f.path.toLowerCase().includes(q)),
    [files, q]
  );
  const selectedBytes = useMemo(() => files.reduce((sum, f, i) => sum + (selected.has(i) ? f.length : 0), 0), [files, selected]);

  // "All" and "None" act on what the filter shows, so "filter: .mkv, Select all" works
  const setVisible = (on: boolean) => {
    const next = new Set(selected);
    for (const f of visible) {
      if (on) next.add(f.index);
      else next.delete(f.index);
    }
    onChange(next);
  };

  const toggle = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onChange(next);
  };

  return (
    <div className="torrent-files" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="small muted">
          {t('torrent.selectedSummary', { count: selected.size, total: files.length, size: formatBytes(selectedBytes, language) })}
        </span>
        <span className="row" style={{ gap: 4 }}>
          <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => setVisible(true)}>
            {t('torrent.selectAll')}
          </button>
          <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => setVisible(false)}>
            {t('torrent.selectNone')}
          </button>
        </span>
      </div>
      {files.length > FILTER_FROM && (
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <Search size={14} className="muted" />
          <input
            className="input grow"
            value={filter}
            spellCheck={false}
            placeholder={t('torrent.filterFiles')}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <div
        role="group"
        aria-label={t('torrent.files')}
        style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}
      >
        {visible.map((f) => {
          const on = selected.has(f.index);
          const progress =
            showProgress && on && f.length > 0 ? formatPercent(Math.min(1, (f.completedLength ?? 0) / f.length), language) : null;
          return (
            <label
              key={f.index}
              className="row small"
              style={{ gap: 8, alignItems: 'center', padding: '3px 0', cursor: disabled ? 'default' : 'pointer', opacity: on ? 1 : 0.6 }}
            >
              <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(f.index)} />
              <span className="ellipsis grow" title={f.path}>
                {f.path}
              </span>
              <span className="muted" style={{ flexShrink: 0 }}>
                {showProgress && !on ? t('torrent.skipped') : progress ? `${progress} · ` : ''}
                {formatBytes(f.length, language)}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
