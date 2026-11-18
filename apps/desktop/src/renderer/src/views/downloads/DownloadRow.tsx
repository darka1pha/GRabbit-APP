import { memo } from 'react';
import { Clock, ExternalLink, FolderOpen, Link, Pause, Play, RotateCw, Smartphone, Trash2 } from 'lucide-react';
import type { DownloadItem } from '../../../../shared/types';
import { errorText, useI18n, type MessageKey } from '../../i18n';
import { formatBytes, formatDate, formatEta, formatPercent, formatSpeed, getStatusTone } from '../../format';
import { FileIcon, ProgressBar } from '../../components/ui';
import { useLiveDownload } from '../../downloads-store';
import { type DensityOption, ACTIVE, fraction, isFolderDownload, canResume, safeHostname } from './model';

/** Row callbacks that keep the same identity for the life of the view, so rows can be memoised. */
export interface RowActions {
  click(e: React.MouseEvent, item: DownloadItem): void;
  doubleClick(item: DownloadItem): void;
  contextMenu(e: React.MouseEvent, item: DownloadItem): void;
  toggle(item: DownloadItem): void;
  openFile(item: DownloadItem): void;
  openFolder(item: DownloadItem): void;
  remove(item: DownloadItem): void;
  sendToMobile?(item: DownloadItem): void;
  toggleSelect?(item: DownloadItem): void;
  changeUrl?(item: DownloadItem): void;
  retry?(item: DownloadItem): void;
  dragStart?(e: React.DragEvent, item: DownloadItem): void;
  dragOver?(e: React.DragEvent, item: DownloadItem): void;
  drop?(e: React.DragEvent, item: DownloadItem): void;
  dragEnd?(): void;
}

/** One table row. Subscribes to its own download, so progress re-renders this row and nothing else. */
export const DownloadRow = memo(function DownloadRow({
  item: listed,
  selected,
  isFocused,
  queueName,
  dropPosition,
  waitingWindow,
  actions,
  density: _density = 'comfortable',
}: {
  item: DownloadItem;
  selected: boolean;
  isFocused: boolean;
  queueName?: string;
  dropPosition?: 'before' | 'after';
  waitingWindow?: boolean;
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
  const statusTone = waitingWindow && item.status === 'queued' ? 'warning' : getStatusTone(item.status);
  const statusLabel =
    waitingWindow && item.status === 'queued'
      ? t('dl.waitingWindow')
      : t(`status.${item.status}` as MessageKey);
  const title = item.media?.title && item.status !== 'completed' ? item.media.title : item.fileName;

  let detailMeta: React.ReactNode = null;
  if (item.status === 'error') {
    const isExpired = item.errorCode === 'HTTP_401' || item.errorCode === 'HTTP_403' || item.errorCode === 'HTTP_410';
    const isFullDisk = item.errorCode === 'ENOSPC';
    detailMeta = (
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
  } else if (item.kind === 'torrent' && item.torrent?.needsSelection && !active) {
    detailMeta = <span style={{ color: 'var(--accent)' }}>{t('torrent.chooseFiles')}</span>;
  } else if (item.kind === 'torrent' && active && item.torrent?.stage === 'Fetching metadata') {
    detailMeta = t('torrent.fetchingMetadata');
  } else if (item.kind === 'torrent' && item.status === 'downloading') {
    detailMeta = t('torrent.peers', { peers: item.torrent?.peers ?? 0, seeds: item.torrent?.seeders ?? 0 });
  } else if (item.status === 'downloading' && item.kind === 'http') {
    detailMeta = (
      <>
        {t('dl.connections', { active: item.activeConnections, total: item.connections })}
        {item.retries > 0 && <> · {t('dl.retries', { count: item.retries })}</>}
      </>
    );
  } else if (active && item.media?.stage) {
    detailMeta = item.media.stage;
  } else if (item.status === 'completed') {
    detailMeta = (
      <>
        {item.checksum?.verified === true && <span className="badge success">{t('dl.checksumOk')}</span>}
        {item.checksum?.verified === false && <span className="badge danger">{t('dl.checksumBad')}</span>}
        {item.media?.author ?? (item.kind === 'torrent' ? t('torrent.label') : safeHostname(item.url))}
      </>
    );
  } else if (item.status === 'queued' && waitingWindow) {
    detailMeta = <Clock size={11} style={{ color: 'var(--warning)' }} />;
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
      data-status={item.status}
      draggable={item.status !== 'completed'}
      onDragStart={(e) => actions.dragStart?.(e, item)}
      onDragOver={(e) => actions.dragOver?.(e, item)}
      onDrop={(e) => actions.drop?.(e, item)}
      onDragEnd={() => actions.dragEnd?.()}
      className={`dl-row${selected ? ' selected' : ''}${dropPosition ? ` drop-${dropPosition}` : ''}`}
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
              <span className={`status-badge ${statusTone}`}>
                <span className={`status-dot ${item.status}`} />
                {statusLabel}
              </span>
              {queueName && <span className="queue-tag">{queueName}</span>}
              {detailMeta && <span className="row-detail-meta">{detailMeta}</span>}
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
            <>
              <button
                className="btn ghost sm icon"
                title={t('dl.open')}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onOpenFile}
              >
                <ExternalLink size={15} />
              </button>
              {!isFolderDownload(item) && (
                <button
                  className="btn ghost sm icon"
                  title={t('dl.sendToMobile')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => actions.sendToMobile?.(item)}
                >
                  <Smartphone size={14} />
                </button>
              )}
            </>
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

/** Info hash, peers, upload and file list (with selection) of a torrent. */
