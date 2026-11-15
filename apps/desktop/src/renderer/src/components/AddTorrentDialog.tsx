import { useEffect, useState } from 'react';
import { CircleAlert, Download, FileUp, FolderOpen, LoaderCircle, Magnet, X } from 'lucide-react';
import { isMagnetLink } from '@grabbit/utils';
import type { TorrentPreview } from '../../../shared/types';
import { errorText, useI18n } from '../i18n';
import { api, useApp } from '../state';
import { formatBytes } from '../format';
import { Modal, Switch } from './ui';
import { TorrentFileChecklist } from './TorrentFileChecklist';

export interface TorrentSource {
  magnet?: string;
  torrentPath?: string;
}

/** Adds one torrent from a magnet link or a .torrent file. Nothing starts until the user confirms. */
export function AddTorrentDialog({
  initial,
  onClose,
  onShowExisting,
}: {
  initial?: TorrentSource;
  onClose(): void;
  onShowExisting(id: string): void;
}) {
  const { t, language } = useI18n();
  const { queues, toast } = useApp();
  const [magnet, setMagnet] = useState(initial?.magnet ?? '');
  const [torrentPath, setTorrentPath] = useState<string | null>(initial?.torrentPath ?? null);
  const [preview, setPreview] = useState<TorrentPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [queueId, setQueueId] = useState('main');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pickFiles, setPickFiles] = useState(false);

  // A new .torrent starts with every file ticked
  useEffect(() => {
    setSelected(new Set(preview?.files?.map((_, i) => i) ?? []));
  }, [preview]);

  const magnetText = magnet.trim();
  const source: TorrentSource | null = torrentPath ? { torrentPath } : isMagnetLink(magnetText) ? { magnet: magnetText } : null;

  // Read the torrent as soon as there is something to read
  useEffect(() => {
    setPreview(null);
    setProblem(null);
    if (!source) {
      if (magnetText && !torrentPath) setProblem(t('err.TORRENT_INVALID'));
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      api.downloads
        .inspectTorrent(source)
        .then((result) => !cancelled && setPreview(result))
        .catch((err) => !cancelled && setProblem(errorText(t, err)))
        .finally(() => !cancelled && setChecking(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The source is derived from these two
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magnetText, torrentPath]);

  async function chooseFile() {
    const file = await api.settings.chooseFile([{ name: 'Torrent', extensions: ['torrent'] }]);
    if (file) setTorrentPath(file);
  }

  async function submit(startPaused: boolean) {
    if (!source || preview?.existingId) return;
    setBusy(true);
    try {
      const files = preview?.files;
      const partial = files && selected.size < files.length;
      await api.downloads.addTorrent([
        {
          ...source,
          directory: folder ?? undefined,
          queueId,
          startPaused,
          selectedFiles: partial ? [...selected].sort((a, b) => a - b) : undefined,
          pickFiles: source.magnet ? pickFiles : undefined,
        },
      ]);
      toast(t('grab.added', { count: 1 }), 'success');
      onClose();
    } catch (err) {
      toast(errorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const nothingSelected = Boolean(preview?.files && selected.size === 0);
  const canAdd = Boolean(source && preview && !preview.existingId && !busy && !nothingSelected);

  return (
    <Modal
      title={t('torrent.title')}
      icon={<Magnet size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('add.cancel')}
          </button>
          <button className="btn" disabled={!canAdd} onClick={() => void submit(true)}>
            {t('add.paused')}
          </button>
          <button className="btn primary" disabled={!canAdd} onClick={() => void submit(false)}>
            <Download size={16} />
            {t('add.start')}
          </button>
        </>
      }
    >
      {torrentPath ? (
        <div className="field">
          <label>.torrent</label>
          <div className="row">
            <input className="input grow mono" value={torrentPath} readOnly title={torrentPath} />
            <button className="btn ghost" onClick={() => setTorrentPath(null)} title={t('torrent.useMagnet')}>
              <X size={15} />
            </button>
          </div>
        </div>
      ) : (
        <div className="field">
          <label>{t('torrent.magnet')}</label>
          <div className="row">
            <input
              className="input grow mono"
              value={magnet}
              autoFocus
              spellCheck={false}
              placeholder="magnet:?xt=urn:btih:…"
              onChange={(e) => setMagnet(e.target.value)}
            />
            <button className="btn" onClick={() => void chooseFile()}>
              <FileUp size={15} /> {t('torrent.chooseFile')}
            </button>
          </div>
          <span className="hint">{t('torrent.magnetHint')}</span>
        </div>
      )}

      {(checking || problem || preview) && (
        <div className="card card-pad" style={{ padding: '12px 14px' }}>
          {checking ? (
            <div className="row muted">
              <LoaderCircle size={16} className="spin" /> {t('torrent.checking')}
            </div>
          ) : problem ? (
            <div className="row" style={{ color: 'var(--danger)' }}>
              <CircleAlert size={16} /> {problem}
            </div>
          ) : preview ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {preview.name && <b className="ellipsis" title={preview.name}>{preview.name}</b>}
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {preview.totalBytes !== undefined && <span className="badge">{formatBytes(preview.totalBytes, language)}</span>}
                {preview.fileCount !== undefined && <span className="badge">{t('torrent.fileCount', { count: preview.fileCount })}</span>}
                <span className="badge">{t('torrent.trackers', { count: preview.trackers })}</span>
              </div>
              <span className="small muted mono ellipsis" title={preview.infoHash}>
                {t('torrent.infoHash')}: {preview.infoHash}
              </span>
              {preview.totalBytes === undefined && <span className="small muted">{t('torrent.sizeLater')}</span>}
              {preview.files && preview.files.length > 1 && !preview.existingId && (
                <TorrentFileChecklist files={preview.files} selected={selected} onChange={setSelected} />
              )}
              {nothingSelected && <span className="small" style={{ color: 'var(--danger)' }}>{t('torrent.noneSelected')}</span>}
              {!preview.files && !preview.existingId && (
                <div className="row" style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="small">{t('torrent.pickFiles')}</span>
                    <span className="small muted">{t('torrent.pickFilesHint')}</span>
                  </span>
                  <Switch checked={pickFiles} onChange={setPickFiles} label={t('torrent.pickFiles')} />
                </div>
              )}
              {preview.existingId && (
                <div className="banner">
                  <span className="grow">{t('torrent.duplicate')}</span>
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      onShowExisting(preview.existingId!);
                      onClose();
                    }}
                  >
                    {t('torrent.showExisting')}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      <div className="field">
        <label>{t('queue.title')}</label>
        <select className="select" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
          {queues.map((q) => (
            <option key={q.id} value={q.id}>
              {q.id === 'main' ? t('queue.main') : q.id === 'scheduled' ? t('queue.scheduled') : q.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{t('add.folder')}</label>
        <div className="row">
          <input className="input grow" value={folder ?? ''} placeholder={t('add.auto')} readOnly title={folder ?? undefined} />
          <button
            className="btn"
            onClick={async () => {
              const dir = await api.settings.chooseDirectory(folder ?? undefined);
              if (dir) setFolder(dir);
            }}
          >
            <FolderOpen size={15} /> {t('add.browse')}
          </button>
          {folder && (
            <button className="btn ghost" onClick={() => setFolder(null)} title={t('add.auto')}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <span className="small muted">{t('torrent.legalNote')}</span>
    </Modal>
  );
}
