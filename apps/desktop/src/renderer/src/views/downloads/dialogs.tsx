// Per-download dialogs: remove, change URL, speed limit, checksum and segment inspector.

import { useState } from 'react';
import { Activity, Gauge, Link, RotateCw, ShieldCheck, Trash2 } from 'lucide-react';
import type { ChecksumAlgorithm, DownloadItem } from '../../../../shared/types';
import { errorText, useI18n } from '../../i18n';
import { api, useApp } from '../../state';
import { formatBytes, formatSpeed } from '../../format';
import { Modal, ProgressBar } from '../../components/ui';
import { useLiveDownload, useSegmentWatch } from '../../downloads-store';

export function RemoveDialog({
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

export function ChangeUrlDialog({ item, onClose }: { item: DownloadItem; onClose(): void }) {
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

export function SpeedLimitDialog({ item, onClose }: { item: DownloadItem; onClose(): void }) {
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

export function VerifyDialog({ item, onClose }: { item: DownloadItem; onClose(): void }) {
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

export function SegmentInspectorModal({ item: listed, onClose }: { item: DownloadItem; onClose(): void }) {
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
