import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, Download, FileText, FolderOpen, LoaderCircle, Plus, X, Zap } from 'lucide-react';
import { CATEGORIES, type Category, type ChecksumAlgorithm, type DownloadItem, type ProbeResult } from '../../../shared/types';
import { errorText, useI18n } from '../i18n';
import { api, useApp } from '../state';
import { formatBytes, isHttpUrl, looksLikeMediaPage } from '../format';
import { Modal } from './ui';
import { DuplicateDialog } from './DuplicateDialog';

const CATEGORY_FOLDERS: Record<Category, string> = {
  video: 'Video',
  music: 'Music',
  documents: 'Documents',
  compressed: 'Compressed',
  programs: 'Programs',
  images: 'Images',
  other: 'Other',
};

function digestAlgorithm(digest: string): ChecksumAlgorithm | null {
  const clean = digest.trim();
  if (!/^[0-9a-f]+$/i.test(clean)) return null;
  return ({ 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' } as Record<number, ChecksumAlgorithm>)[clean.length] ?? null;
}

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (/^[A-Za-z0-9-]+$/.test(name) && value) headers[name] = value;
  }
  return headers;
}

export function AddDownloadDialog({
  initialUrl,
  onClose,
  onOpenInGrab,
}: {
  initialUrl?: string;
  onClose(): void;
  onOpenInGrab(url: string): void;
}) {
  const { t, language } = useI18n();
  const { settings, queues, downloads, toast } = useApp();
  const [text, setText] = useState(initialUrl ?? '');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [category, setCategory] = useState<Category | 'auto'>('auto');
  const [queueId, setQueueId] = useState('main');
  const [folder, setFolder] = useState<string | null>(null);
  const [connections, setConnections] = useState(settings?.defaultConnections ?? 8);
  const [advanced, setAdvanced] = useState(false);
  const [referrer, setReferrer] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [speedLimit, setSpeedLimit] = useState(0);
  const [checksum, setChecksum] = useState('');
  const [busy, setBusy] = useState(false);
  const [duplicateItem, setDuplicateItem] = useState<DownloadItem | null>(null);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileLoad(file: File) {
    try {
      const content = await file.text();
      setText((prev) => (prev.trim() ? `${prev.trim()}\n${content}` : content));
      toast(t('grab.added', { count: 1 }), 'info');
    } catch {
      toast('Failed to read file', 'error');
    }
  }

  function removeUrl(indexToRemove: number) {
    const next = urls.filter((_, idx) => idx !== indexToRemove);
    setText(next.join('\n'));
  }

  const urls = useMemo(
    () =>
      text
        .split(/[\s]+/)
        .map((u) => u.trim())
        .filter(isHttpUrl),
    [text]
  );
  const single = urls.length === 1 ? urls[0] : null;
  const headers = useMemo(() => parseHeaders(headersText), [headersText]);

  // Probe a single link (debounced) to show its name, size and resume support
  useEffect(() => {
    setProbe(null);
    setProbeError(null);
    if (!single) return;
    let cancelled = false;
    setProbing(true);
    const timer = setTimeout(() => {
      const extra = { ...headers, ...(referrer ? { Referer: referrer } : {}) };
      api.downloads
        .probe(single, extra)
        .then((result) => {
          if (cancelled) return;
          setProbe(result);
          if (!nameTouched) setFileName(result.fileName);
        })
        .catch((err) => !cancelled && setProbeError(errorText(t, err)))
        .finally(() => !cancelled && setProbing(false));
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, referrer, headersText]);

  const effectiveCategory: Category = category === 'auto' ? (probe?.category ?? 'other') : category;
  const defaultFolder = settings
    ? settings.categorySubfolders
      ? `${settings.downloadDir}\\${CATEGORY_FOLDERS[effectiveCategory]}`
      : settings.downloadDir
    : '';
  const algorithm = digestAlgorithm(checksum);
  const showMediaHint = single && looksLikeMediaPage(single) && probe?.mimeType?.startsWith('text/html');

  async function submit(startPaused: boolean, forceDuplicate = false) {
    if (urls.length === 0) return;
    if (single && !forceDuplicate && !allowDuplicate) {
      const existing = downloads.find((d) => d.url === single || d.url === probe?.finalUrl);
      if (existing) {
        setDuplicateItem(existing);
        return;
      }
    }
    setBusy(true);
    try {
      const added = await api.downloads.addHttp(
        urls.map((url) => ({
          url,
          fileName: single && nameTouched && fileName.trim() ? fileName.trim() : undefined,
          directory: folder ?? undefined,
          category: category === 'auto' ? undefined : category,
          connections,
          referrer: referrer.trim() || undefined,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          speedLimitKBps: speedLimit || undefined,
          checksum: single && algorithm ? { algorithm, expected: checksum.trim() } : undefined,
          startPaused,
          queueId,
        }))
      );
      toast(t('grab.added', { count: added.length }), 'success');
      onClose();
    } catch (err) {
      toast(errorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('add.title')}
      icon={<Plus size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('add.cancel')}
          </button>
          <button className="btn" disabled={urls.length === 0 || busy} onClick={() => void submit(true)}>
            {t('add.paused')}
          </button>
          <button className="btn primary" disabled={urls.length === 0 || busy} onClick={() => void submit(false)}>
            <Download size={16} />
            {t('add.start')}
          </button>
        </>
      }
    >
      <div className="field">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ margin: 0 }}>{t('add.urls')}</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".txt,.m3u,.m3u8,.csv,.tsv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileLoad(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn ghost sm"
              style={{ padding: '3px 8px', fontSize: 12 }}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText size={13} /> {t('add.importFile')}
            </button>
            {urls.length > 0 && (
              <button
                type="button"
                className="btn ghost sm"
                style={{ padding: '3px 8px', fontSize: 12 }}
                onClick={() => setText('')}
              >
                {t('add.clearAll')}
              </button>
            )}
          </div>
        </div>
        <textarea
          className="textarea mono"
          rows={urls.length > 1 ? 4 : 2}
          value={text}
          autoFocus
          spellCheck={false}
          placeholder="https://example.com/file.zip"
          onChange={(e) => setText(e.target.value)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFileLoad(file);
          }}
        />
        <span className="hint">{urls.length > 1 ? t('add.batchDetected', { count: urls.length }) : t('add.urlsHint')}</span>
      </div>

      {urls.length > 1 && (
        <div className="card card-pad" style={{ padding: '10px 12px', maxHeight: 150, overflowY: 'auto' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="small muted"><b>{t('add.batchDetected', { count: urls.length })}</b></span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {urls.slice(0, 8).map((u, i) => (
              <div key={i} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span className="ellipsis mono muted" style={{ maxWidth: 380 }}>{u}</span>
                <button
                  type="button"
                  className="btn ghost icon"
                  style={{ width: 20, height: 20, padding: 0 }}
                  onClick={() => removeUrl(i)}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {urls.length > 8 && (
              <span className="small muted" style={{ textAlign: 'center', marginTop: 4 }}>
                + {urls.length - 8} more URLs
              </span>
            )}
          </div>
        </div>
      )}

      {single && (
        <div className="card card-pad" style={{ padding: '12px 14px' }}>
          {probing ? (
            <div className="row muted">
              <LoaderCircle size={16} className="spin" /> {t('add.checking')}
            </div>
          ) : probeError ? (
            <div className="row" style={{ color: 'var(--danger)' }}>
              <CircleAlert size={16} /> {probeError}
            </div>
          ) : probe ? (
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="badge">{formatBytes(probe.totalBytes, language)}</span>
              <span className={`badge ${probe.resumable ? 'success' : 'warning'}`}>
                {probe.resumable ? <Zap size={12} /> : null}
                {probe.resumable ? t('add.resumeYes') : t('add.resumeNo')}
              </span>
              {probe.mimeType && <span className="badge">{probe.mimeType}</span>}
            </div>
          ) : null}
          {showMediaHint && (
            <div className="banner" style={{ marginTop: 10 }}>
              <span className="grow">{t('add.isMedia')}</span>
              <button className="btn sm primary" onClick={() => onOpenInGrab(single)}>
                {t('add.openGrab')}
              </button>
            </div>
          )}
        </div>
      )}

      {single && (
        <div className="field">
          <label>{t('add.fileName')}</label>
          <input
            className="input"
            value={fileName}
            spellCheck={false}
            onChange={(e) => {
              setFileName(e.target.value);
              setNameTouched(true);
            }}
          />
        </div>
      )}

      <div className="grid-2">
        <div className="field">
          <label>{t('add.category')}</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as Category | 'auto')}>
            <option value="auto">{t('add.auto')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`cat.${c}`)}
              </option>
            ))}
          </select>
        </div>
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
      </div>

      <div className="field">
        <label>{t('add.folder')}</label>
        <div className="row">
          <input className="input grow" value={folder ?? defaultFolder} readOnly title={folder ?? defaultFolder} />
          <button
            className="btn"
            onClick={async () => {
              const dir = await api.settings.chooseDirectory(folder ?? defaultFolder);
              if (dir) setFolder(dir);
            }}
          >
            <FolderOpen size={15} /> {t('add.browse')}
          </button>
        </div>
      </div>

      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced((v) => !v)}>
        {advanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {t('add.advanced')}
      </button>

      {advanced && (
        <>
          <div className="grid-3">
            <div className="field">
              <label>{t('add.referrer')}</label>
              <input className="input mono" value={referrer} onChange={(e) => setReferrer(e.target.value)} placeholder="https://" />
            </div>
            <div className="field">
              <label>{t('add.connections')}</label>
              <input
                className="input"
                type="number"
                min={1}
                max={32}
                value={connections}
                onChange={(e) => setConnections(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="field">
              <label>{t('add.speedLimit')}</label>
              <input
                className="input"
                type="number"
                min={0}
                value={speedLimit}
                onChange={(e) => setSpeedLimit(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>
          <div className="field">
            <label>{t('add.headers')}</label>
            <textarea
              className="textarea mono"
              rows={2}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder="Cookie: name=value"
            />
            <span className="hint">{t('add.headersHint')}</span>
          </div>
          {single && (
            <div className="field">
              <label>
                {t('add.checksum')} {algorithm && <span className="badge accent">{algorithm.toUpperCase()}</span>}
              </label>
              <input
                className="input mono"
                value={checksum}
                onChange={(e) => setChecksum(e.target.value)}
                placeholder="MD5 / SHA-1 / SHA-256 / SHA-512"
              />
            </div>
          )}
        </>
      )}

      {duplicateItem && single && (
        <DuplicateDialog
          existingItem={duplicateItem}
          newUrl={single}
          onViewExisting={() => {
            setDuplicateItem(null);
            onClose();
            window.dispatchEvent(new CustomEvent('select-download', { detail: duplicateItem.id }));
          }}
          onDownloadAgain={() => {
            setDuplicateItem(null);
            setAllowDuplicate(true);
            void submit(false, true);
          }}
          onRefreshLink={async () => {
            try {
              await api.downloads.changeUrl(duplicateItem.id, single);
              await api.downloads.resume([duplicateItem.id]);
              toast(t('dl.copied'), 'success');
              setDuplicateItem(null);
              onClose();
            } catch (err) {
              toast(errorText(t, err), 'error');
            }
          }}
          onClose={() => setDuplicateItem(null)}
        />
      )}
    </Modal>
  );
}
