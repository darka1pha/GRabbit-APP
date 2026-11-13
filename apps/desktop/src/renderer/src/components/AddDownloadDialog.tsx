import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardPaste,
  Download,
  FileText,
  FolderOpen,
  Layers,
  LoaderCircle,
  Plus,
  X,
  Zap,
} from 'lucide-react';
import { hasUrlPattern, expandUrlPatterns } from '@grabbit/utils';
import { CATEGORIES, type Category, type ChecksumAlgorithm, type DownloadItem, type ProbeResult } from '../../../shared/types';
import { errorText, useI18n } from '../i18n';
import { api, useApp } from '../state';
import { formatBytes, isHttpUrl, looksLikeMediaPage } from '../format';
import { Modal } from './ui';
import { DuplicateDialog } from './DuplicateDialog';

export type AddMode = 'single' | 'batch' | 'pattern';

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
  initialMode,
  onClose,
  onOpenInGrab,
}: {
  initialUrl?: string;
  initialMode?: AddMode;
  onClose(): void;
  onOpenInGrab(url: string): void;
}) {
  const { t, language } = useI18n();
  const { settings, queues, downloads, toast } = useApp();

  const [mode, setMode] = useState<AddMode>(() => {
    if (initialMode) return initialMode;
    if (!initialUrl) return 'single';
    if (initialUrl.includes('(*)') || hasUrlPattern(initialUrl)) {
      return initialUrl.includes('(*)') ? 'pattern' : 'batch';
    }
    const lines = initialUrl.trim().split(/\s+/).filter(Boolean);
    return lines.length > 1 ? 'batch' : 'single';
  });

  // Single URL mode state
  const [singleUrl, setSingleUrl] = useState(initialUrl ?? '');

  // Batch List mode state
  const [batchText, setBatchText] = useState(initialUrl ?? '');

  // Pattern Builder state
  const [patternTemplate, setPatternTemplate] = useState(() => {
    if (initialUrl && (initialUrl.includes('(*)') || initialUrl.includes('*'))) return initialUrl;
    return '';
  });
  const [patternFrom, setPatternFrom] = useState(1);
  const [patternTo, setPatternTo] = useState(10);
  const [patternDigits, setPatternDigits] = useState(2);
  const [patternStep, setPatternStep] = useState(1);

  // Common download options
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

  // Single mode computed URL
  const singleUrlTrimmed = singleUrl.trim();
  const singleUrls = useMemo(() => (isHttpUrl(singleUrlTrimmed) ? [singleUrlTrimmed] : []), [singleUrlTrimmed]);

  // Batch mode computed URLs
  const batchCanExpand = useMemo(() => hasUrlPattern(batchText), [batchText]);
  const batchExpandedList = useMemo(() => (batchCanExpand ? expandUrlPatterns(batchText) : []), [batchCanExpand, batchText]);
  const batchUrls = useMemo(() => {
    const raw = batchCanExpand ? batchExpandedList : batchText.split(/[\s]+/);
    return raw.map((u) => u.trim()).filter(isHttpUrl);
  }, [batchCanExpand, batchExpandedList, batchText]);

  // Pattern mode computed URLs
  const generatedPatternUrls = useMemo(() => {
    const tmpl = patternTemplate.trim();
    if (!tmpl) return [];
    if (hasUrlPattern(tmpl)) {
      return expandUrlPatterns(tmpl).filter(isHttpUrl);
    }
    const from = Math.max(0, patternFrom);
    const to = Math.max(from, patternTo);
    const step = Math.max(1, patternStep);
    const pad = Math.max(1, Math.min(10, patternDigits));
    const results: string[] = [];
    const maxItems = 500;
    for (let i = from; i <= to && results.length < maxItems; i += step) {
      const numStr = String(i).padStart(pad, '0');
      let u: string;
      if (tmpl.includes('(*)')) {
        u = tmpl.replaceAll('(*)', numStr);
      } else if (tmpl.includes('*')) {
        u = tmpl.replaceAll('*', numStr);
      } else {
        u = tmpl;
      }
      if (isHttpUrl(u.trim())) {
        results.push(u.trim());
      }
    }
    return results;
  }, [patternTemplate, patternFrom, patternTo, patternStep, patternDigits]);

  // Active URLs according to selected tab mode
  const activeUrls = useMemo(() => {
    if (mode === 'single') return singleUrls;
    if (mode === 'batch') return batchUrls;
    return generatedPatternUrls;
  }, [mode, singleUrls, batchUrls, generatedPatternUrls]);

  const single = mode === 'single' ? singleUrls[0] ?? null : activeUrls.length === 1 ? activeUrls[0] : null;
  const headers = useMemo(() => parseHeaders(headersText), [headersText]);

  // Probe single link
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
  const pathSep = settings?.downloadDir.includes('/') && !settings.downloadDir.includes('\\') ? '/' : '\\';
  const baseDownloadDir = settings ? settings.downloadDir.replace(/[\\/]+$/, '') : '';
  const defaultFolder = settings
    ? settings.categorySubfolders
      ? `${baseDownloadDir}${pathSep}${CATEGORY_FOLDERS[effectiveCategory]}`
      : settings.downloadDir
    : '';
  const algorithm = digestAlgorithm(checksum);
  const showMediaHint = single && looksLikeMediaPage(single) && probe?.mimeType?.startsWith('text/html');

  // Intelligent handler for single URL input (detects multi-line paste and auto-switches to batch)
  function handleSingleUrlChange(value: string) {
    const urlsInInput = value.trim().split(/[\r\n\s]+/).filter(isHttpUrl);
    if (urlsInInput.length > 1 || (value.includes('\n') && urlsInInput.length > 0)) {
      setBatchText((prev) => (prev.trim() ? `${prev.trim()}\n${value.trim()}` : value.trim()));
      setMode('batch');
      toast(t('add.autoDetectedBatch'), 'info');
      return;
    }
    setSingleUrl(value);
  }

  // Paste clipboard handler for batch list
  async function handlePasteClipboard() {
    try {
      const clipText = await navigator.clipboard.readText();
      if (!clipText || !clipText.trim()) {
        toast(t('add.clipboardEmpty'), 'info');
        return;
      }
      const matches = clipText.match(/https?:\/\/[^\s"'`<>]+/g);
      if (matches && matches.length > 0) {
        const unique = Array.from(new Set(matches));
        setBatchText((prev) => (prev.trim() ? `${prev.trim()}\n${unique.join('\n')}` : unique.join('\n')));
        toast(t('add.clipboardFound', { count: unique.length }), 'success');
      } else {
        setBatchText((prev) => (prev.trim() ? `${prev.trim()}\n${clipText.trim()}` : clipText.trim()));
        toast(t('add.clipboardFound', { count: 1 }), 'info');
      }
    } catch {
      toast('Failed to read clipboard', 'error');
    }
  }

  // Import file handler
  async function handleFileLoad(file: File) {
    try {
      const content = await file.text();
      setBatchText((prev) => (prev.trim() ? `${prev.trim()}\n${content}` : content));
      const importedCount = content
        .split(/\r?\n/)
        .flatMap((line) => (line.trim().startsWith('#') ? [] : line.trim().split(/\s+/)))
        .filter((token) => /^https?:\/\//i.test(token)).length;
      toast(t('add.batchDetected', { count: importedCount }), 'info');
    } catch {
      toast('Failed to read file', 'error');
    }
  }

  function removeBatchUrl(indexToRemove: number) {
    const next = batchUrls.filter((_, idx) => idx !== indexToRemove);
    setBatchText(next.join('\n'));
  }

  function handleSwitchMode(targetMode: AddMode) {
    if (targetMode === 'batch' && !batchText.trim() && singleUrl.trim()) {
      setBatchText(singleUrl.trim());
    }
    if (targetMode === 'pattern' && !patternTemplate.trim()) {
      if (singleUrl.includes('(*)') || singleUrl.includes('*')) {
        setPatternTemplate(singleUrl.trim());
      } else if (batchText.includes('(*)') || batchText.includes('*')) {
        const lineWithPattern = batchText.split('\n').find((l) => l.includes('(*)') || l.includes('*'));
        if (lineWithPattern) setPatternTemplate(lineWithPattern.trim());
      }
    }
    setMode(targetMode);
  }

  function insertPatternToBatch() {
    if (generatedPatternUrls.length === 0) return;
    setBatchText((prev) => {
      const existing = prev.trim();
      return existing ? `${existing}\n${generatedPatternUrls.join('\n')}` : generatedPatternUrls.join('\n');
    });
    setMode('batch');
    toast(t('add.batchDetected', { count: generatedPatternUrls.length }), 'info');
  }

  async function submit(startPaused: boolean, forceDuplicate = false) {
    if (activeUrls.length === 0) return;
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
        activeUrls.map((url) => ({
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

  const modalTitle =
    mode === 'single' ? t('add.title') : mode === 'batch' ? t('add.batchTitle') : `${t('add.batchTitle')} · ${t('add.modePattern')}`;
  const modalIcon = mode === 'single' ? <Plus size={18} /> : mode === 'batch' ? <Layers size={18} /> : <Zap size={18} />;

  return (
    <Modal
      title={modalTitle}
      icon={modalIcon}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('add.cancel')}
          </button>
          <button className="btn" disabled={activeUrls.length === 0 || busy} onClick={() => void submit(true)}>
            {activeUrls.length > 1 ? t('add.pausedBatch', { count: activeUrls.length }) : t('add.paused')}
          </button>
          <button className="btn primary" disabled={activeUrls.length === 0 || busy} onClick={() => void submit(false)}>
            <Download size={16} />
            {activeUrls.length > 1 ? t('add.startBatch', { count: activeUrls.length }) : t('add.start')}
          </button>
        </>
      }
    >
      {/* Mode Switcher Tabs */}
      <div className="segmented" style={{ width: '100%', display: 'flex', marginBottom: 14 }}>
        <button
          type="button"
          className={mode === 'single' ? 'active' : ''}
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => handleSwitchMode('single')}
        >
          <Plus size={14} />
          <span>{t('add.modeSingle')}</span>
        </button>
        <button
          type="button"
          className={mode === 'batch' ? 'active' : ''}
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => handleSwitchMode('batch')}
        >
          <Layers size={14} />
          <span>{t('add.modeBatch')}</span>
          {batchUrls.length > 0 && <span className="badge sm accent">{batchUrls.length}</span>}
        </button>
        <button
          type="button"
          className={mode === 'pattern' ? 'active' : ''}
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => handleSwitchMode('pattern')}
        >
          <Zap size={14} />
          <span>{t('add.modePattern')}</span>
          {generatedPatternUrls.length > 0 && <span className="badge sm">{generatedPatternUrls.length}</span>}
        </button>
      </div>

      {/* Mode: Single URL */}
      {mode === 'single' && (
        <>
          <div className="field">
            <label>{t('add.singleUrl')}</label>
            <input
              className="input mono"
              value={singleUrl}
              autoFocus
              spellCheck={false}
              placeholder="https://example.com/file.zip"
              onChange={(e) => handleSingleUrlChange(e.target.value)}
            />
            <span className="hint">{t('add.singleHint')}</span>
          </div>

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
        </>
      )}

      {/* Mode: Batch List */}
      {mode === 'batch' && (
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <label style={{ margin: 0 }}>
              {t('add.urls')}{' '}
              {batchUrls.length > 0 && <span className="badge sm accent">{t('queue.items', { count: batchUrls.length })}</span>}
            </label>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn ghost sm"
                style={{ padding: '3px 8px', fontSize: 12 }}
                onClick={() => void handlePasteClipboard()}
                title={t('add.pasteClipboard')}
              >
                <ClipboardPaste size={13} /> {t('add.pasteClipboard')}
              </button>
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
              {batchCanExpand && (
                <button
                  type="button"
                  className="btn primary sm"
                  style={{ padding: '3px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  onClick={() => setBatchText(batchExpandedList.join('\n'))}
                  title={t('add.expandPatternTooltip')}
                >
                  <Zap size={13} />
                  <span>{t('add.expandPattern', { count: batchExpandedList.length })}</span>
                </button>
              )}
              {batchUrls.length > 0 && (
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => setBatchText('')}
                >
                  {t('add.clearAll')}
                </button>
              )}
            </div>
          </div>
          <textarea
            className="textarea mono"
            rows={4}
            value={batchText}
            autoFocus
            spellCheck={false}
            placeholder={`https://example.com/file1.zip\nhttps://example.com/file2.zip`}
            onChange={(e) => setBatchText(e.target.value)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFileLoad(file);
            }}
          />
          <span className="hint">{t('add.batchUrlsHint')}</span>

          {batchUrls.length > 0 && (
            <div className="card card-pad" style={{ padding: '10px 12px', marginTop: 10, maxHeight: 150, overflowY: 'auto' }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="small muted">
                  <b>{t('add.batchDetected', { count: batchUrls.length })}</b>
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {batchUrls.slice(0, 8).map((u, i) => (
                  <div key={i} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <span className="ellipsis mono muted" style={{ maxWidth: 380 }}>
                      {u}
                    </span>
                    <button
                      type="button"
                      className="btn ghost icon"
                      style={{ width: 20, height: 20, padding: 0 }}
                      onClick={() => removeBatchUrl(i)}
                      title="Remove"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {batchUrls.length > 8 && (
                  <span className="small muted" style={{ textAlign: 'center', marginTop: 4 }}>
                    + {batchUrls.length - 8} more URLs
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mode: Pattern Builder */}
      {mode === 'pattern' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>{t('add.patternTemplate')}</label>
            <input
              className="input mono"
              value={patternTemplate}
              autoFocus
              spellCheck={false}
              placeholder="https://example.com/file_(*).zip"
              onChange={(e) => setPatternTemplate(e.target.value)}
            />
            <span className="hint">{t('add.patternTemplateHint')}</span>
          </div>

          <div className="grid-4">
            <div className="field">
              <label>{t('add.patternFrom')}</label>
              <input
                className="input"
                type="number"
                min={0}
                value={patternFrom}
                onChange={(e) => setPatternFrom(Math.max(0, parseInt(e.target.value, 10) || 0))}
              />
            </div>
            <div className="field">
              <label>{t('add.patternTo')}</label>
              <input
                className="input"
                type="number"
                min={0}
                value={patternTo}
                onChange={(e) => setPatternTo(Math.max(0, parseInt(e.target.value, 10) || 0))}
              />
            </div>
            <div className="field">
              <label>{t('add.patternPad')}</label>
              <input
                className="input"
                type="number"
                min={1}
                max={8}
                value={patternDigits}
                onChange={(e) => setPatternDigits(Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 1)))}
                title={t('add.patternPadHint')}
              />
            </div>
            <div className="field">
              <label>{t('add.patternStep')}</label>
              <input
                className="input"
                type="number"
                min={1}
                value={patternStep}
                onChange={(e) => setPatternStep(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>
          </div>

          <div className="card card-pad" style={{ padding: '10px 12px', maxHeight: 160, overflowY: 'auto' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span className="small muted">
                <b>{t('add.patternPreview', { count: generatedPatternUrls.length })}</b>
              </span>
              {generatedPatternUrls.length > 0 && (
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ padding: '3px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  onClick={insertPatternToBatch}
                >
                  <Layers size={13} />
                  <span>{t('add.insertToBatch')}</span>
                </button>
              )}
            </div>
            {generatedPatternUrls.length === 0 ? (
              <span className="small muted" style={{ display: 'block', padding: '6px 0' }}>
                {t('add.patternTemplateHint')}
              </span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {generatedPatternUrls.slice(0, 8).map((u, i) => (
                  <span key={i} className="ellipsis mono muted" style={{ fontSize: 12 }}>
                    {u}
                  </span>
                ))}
                {generatedPatternUrls.length > 8 && (
                  <span className="small muted" style={{ textAlign: 'center', marginTop: 4 }}>
                    + {generatedPatternUrls.length - 8} more URLs
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Common Options: Category & Queue */}
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

      {/* Common Options: Destination Folder */}
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

      {/* Advanced Settings */}
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

      {/* Duplicate Dialog */}
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
              toast(t('dl.linkRefreshed'), 'success');
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
