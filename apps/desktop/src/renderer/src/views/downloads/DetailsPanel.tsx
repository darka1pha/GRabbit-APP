import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, Copy, ExternalLink, FolderOpen, Smartphone, X } from 'lucide-react';
import type { DownloadItem } from '../../../../shared/types';
import { errorText, useI18n, type MessageKey } from '../../i18n';
import { api, useApp } from '../../state';
import { formatBytes, formatSpeed } from '../../format';
import { FileIcon } from '../../components/ui';
import { TorrentFileChecklist } from '../../components/TorrentFileChecklist';
import { useLiveDownload, useSegmentWatch } from '../../downloads-store';
import { Sparkline } from '../../components/Sparkline';
import { ACTIVE, isFolderDownload } from './model';

export function TorrentDetails({ item }: { item: DownloadItem }) {
  const { t, language } = useI18n();
  const { toast } = useApp();
  const torrent = item.torrent!;
  const files = torrent.files ?? [];
  const active = ACTIVE.includes(item.status);
  const done = item.status === 'completed';
  const savedKey = files.map((f) => (f.selected !== false ? 1 : 0)).join('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set(files.flatMap((f, i) => (f.selected !== false ? [i] : []))));
  const [saving, setSaving] = useState(false);
  // Follow the saved selection when it changes elsewhere (or a new file list arrives)
  useEffect(() => {
    setSelected(new Set(files.flatMap((f, i) => (f.selected !== false ? [i] : []))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, item.id]);
  const changed = files.some((f, i) => (f.selected !== false) !== selected.has(i));

  async function save(start: boolean) {
    setSaving(true);
    try {
      await api.downloads.setTorrentFiles(item.id, [...selected].sort((a, b) => a - b));
      if (start) await api.downloads.resume([item.id]);
    } catch (err) {
      toast(errorText(t, err), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {torrent.needsSelection && !active && (
        <div className="banner full">
          <span className="grow">{t('torrent.needsSelection')}</span>
          <button className="btn sm primary" disabled={saving || selected.size === 0} onClick={() => void save(true)}>
            {t('torrent.startSelected')}
          </button>
        </div>
      )}
      <dl className="kv full">
        <dt>{t('torrent.infoHash')}</dt>
        <dd className="mono small">{torrent.infoHash}</dd>
      </dl>
      {active && (
        <dl className="kv">
          <dt>{t('torrent.label')}</dt>
          <dd>{t('torrent.peers', { peers: torrent.peers ?? 0, seeds: torrent.seeders ?? 0 })}</dd>
        </dl>
      )}
      {(torrent.uploadedBytes ?? 0) > 0 && (
        <dl className="kv">
          <dt>{t('torrent.uploaded')}</dt>
          <dd>
            {formatBytes(torrent.uploadedBytes ?? 0, language)}
            {active && torrent.uploadSpeed ? ` · ${formatSpeed(torrent.uploadSpeed, language)}` : ''}
          </dd>
        </dl>
      )}
      {torrent.seeding && (
        <div className="banner full">
          <span className="grow">{t('torrent.uploaded')}: {formatBytes(torrent.uploadedBytes ?? 0, language)}</span>
          <button
            className="btn sm"
            onClick={() => void api.downloads.stopSeeding(item.id).catch((err) => toast(errorText(t, err), 'error'))}
          >
            {t('torrent.stopSeeding')}
          </button>
        </div>
      )}
      {files.length > 1 && (
        <dl className="kv full">
          <dt>{t('torrent.files')}</dt>
          <dd style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <TorrentFileChecklist files={files} selected={selected} onChange={setSelected} showProgress disabled={done || saving} />
            {changed && !torrent.needsSelection && !done && (
              <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                {selected.size === 0 && <span className="small" style={{ color: 'var(--danger)' }}>{t('torrent.noneSelected')}</span>}
                <button className="btn sm primary" disabled={saving || selected.size === 0} onClick={() => void save(false)}>
                  {t('torrent.applySelection')}
                </button>
              </span>
            )}
          </dd>
        </dl>
      )}
    </>
  );
}

export function DetailsPanel({
  item: listed,
  onClose,
  onCopyUrl,
  onOpenFile,
  onOpenFolder,
  onSendToMobile,
  onInspectSegments,
}: {
  item: DownloadItem;
  onClose(): void;
  onCopyUrl(): void;
  onOpenFile(): void;
  onOpenFolder(): void;
  onSendToMobile(): void;
  onInspectSegments(item: DownloadItem): void;
}) {
  const { t, language } = useI18n();
  const item = useLiveDownload(listed);
  // The segment map needs per-segment progress, which is only sent for watched downloads
  // Live segment maps (http) and per-file progress (torrents) are only sent for watched downloads
  useSegmentWatch((item.kind === 'http' || item.kind === 'torrent') && item.status !== 'completed' ? item.id : null);
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  useEffect(() => {
    if (item.status === 'downloading') {
      setSpeedHistory((prev) => [...prev, item.speed ?? 0].slice(-25));
    }
  }, [item.speed, item.status]);
  const total = item.totalBytes ?? 0;
  const sep = item.directory.includes('/') && !item.directory.includes('\\') ? '/' : '\\';
  const baseDir = item.directory.replace(/[\\/]+$/, '');
  const where = item.filePath ?? `${baseDir}${sep}${item.fileName}`;
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
          <>
            <button className="btn sm primary" onClick={onOpenFile}>
              <ExternalLink size={13} /> {t('dl.open')}
            </button>
            {!isFolderDownload(item) && (
              <button className="btn sm" onClick={onSendToMobile}>
                <Smartphone size={13} /> {t('dl.sendToMobile')}
              </button>
            )}
          </>
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
      {item.kind === 'torrent' && item.torrent && <TorrentDetails item={item} />}
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
