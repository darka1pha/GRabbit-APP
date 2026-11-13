import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import { AppWindow, ArrowUpCircle, CircleCheck, CircleX, Clock, Copy, Download, FolderOpen, Globe, Info, LoaderCircle, Monitor, Moon, Music, QrCode, Radio, RotateCw, Search, Settings, Sun, Volume2, Wrench, X, Zap } from 'lucide-react';
import type { AfterQueueAction, AppSettings, BrowserName, DeepPartial, Language, Theme, ToolInfo, UpdateStatusInfo } from '../../../shared/types';
import { errorText, useI18n, type MessageKey } from '../i18n';
import { api, useApp } from '../state';
import { DayPicker, Switch } from '../components/ui';
import { QRCodeModal } from '../components/QRCodeModal';
import { playCompletionChime } from '../utils/sound';
import { formatScheduleCountdown, getScheduleWindowState, type ScheduleLike } from '../utils/schedule';

const SettingsSearchContext = createContext<{
  query: string;
  reportMatch(id: string, matched: boolean): void;
}>({
  query: '',
  reportMatch: () => {},
});

const SectionFilterContext = createContext<{
  sectionMatches: boolean;
  reportChild(id: string, matched: boolean): void;
}>({
  sectionMatches: true,
  reportChild: () => {},
});

function Section({ id, title, icon, children }: { id?: string; title: string; icon: ReactNode; children: ReactNode }) {
  const { query, reportMatch } = useContext(SettingsSearchContext);
  const sectionId = useId();
  const [matchedChildren, setMatchedChildren] = useState<Set<string>>(() => new Set());
  const q = query.trim().toLowerCase();
  const sectionMatches = !q || title.toLowerCase().includes(q);
  const visible = sectionMatches || matchedChildren.size > 0;

  const reportChild = useCallback((childId: string, matched: boolean) => {
    setMatchedChildren((prev) => {
      const has = prev.has(childId);
      if (has === matched) return prev;
      const next = new Set(prev);
      if (matched) next.add(childId);
      else next.delete(childId);
      return next;
    });
  }, []);

  useEffect(() => {
    reportMatch(sectionId, visible);
    return () => reportMatch(sectionId, false);
  }, [sectionId, visible, reportMatch]);

  const ctx = useMemo(() => ({ sectionMatches, reportChild }), [sectionMatches, reportChild]);

  return (
    <SectionFilterContext.Provider value={ctx}>
      <div id={id} className="settings-section" style={visible ? undefined : { display: 'none' }}>
        <h3>
          {icon} {title}
        </h3>
        <div className="card">{children}</div>
      </div>
    </SectionFilterContext.Provider>
  );
}

function Setting({ label, hint, children, stack }: { label: string; hint?: string; children: ReactNode; stack?: boolean }) {
  const { query } = useContext(SettingsSearchContext);
  const { sectionMatches, reportChild } = useContext(SectionFilterContext);
  const settingId = useId();
  const q = query.trim().toLowerCase();
  const matched =
    !q ||
    sectionMatches ||
    label.toLowerCase().includes(q) ||
    (hint ? hint.toLowerCase().includes(q) : false);

  useEffect(() => {
    reportChild(settingId, matched);
    return () => reportChild(settingId, false);
  }, [settingId, matched, reportChild]);

  if (!matched) return null;

  return (
    <div className={`setting ${stack ? 'stack' : ''}`}>
      <div className="label">
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

/** Text input that saves on blur / Enter instead of on every keystroke. */
function LazyInput({
  value,
  onSave,
  className,
  type,
  placeholder,
  min,
  max,
}: {
  value: string | number;
  onSave(v: string): void;
  className?: string;
  type?: string;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      className={`input ${className ?? ''}`}
      type={type}
      min={min}
      max={max}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== String(value) && onSave(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ScheduleStatusBadge({ schedule, now }: { schedule: ScheduleLike; now: Date }) {
  const { t, language } = useI18n();
  const win = getScheduleWindowState(schedule, now);
  if (!win.enabled) return null;
  if (win.active) {
    return (
      <span className="badge success schedule-status-badge">
        <Clock size={11} />
        {t('set.scheduleActiveNow')}
        {win.remainingMs !== null ? ` · ${formatScheduleCountdown(win.remainingMs, language)}` : ''}
      </span>
    );
  }
  return (
    <span className="badge schedule-status-badge">
      <Clock size={11} />
      {t('set.scheduleWaiting', { time: formatScheduleCountdown(win.remainingMs, language) })}
    </span>
  );
}

function formatSampleCustomCommand(template: string, downloadDir: string): string {
  const base = (downloadDir || 'C:\\Downloads').replace(/[\\/]+$/, '');
  const sep = base.includes('/') && !base.includes('\\') ? '/' : '\\';
  const fileName = 'ubuntu-24.04-desktop-amd64.iso';
  const vars: Record<string, string> = {
    filePath: `${base}${sep}${fileName}`,
    fileName,
    directory: base,
    category: 'programs',
    fileSize: '4823449600',
  };
  return template.replace(/\{(filePath|fileName|directory|category|fileSize)\}/g, (full, key: string) => vars[key] ?? full);
}

export function SettingsView({ initialSection }: { initialSection?: string } = {}) {
  const { t } = useI18n();
  const { settings, updateSettings, toast } = useApp();
  const [tools, setTools] = useState<ToolInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusInfo | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showQrModal, setShowQrModal] = useState(false);
  const [matchedSections, setMatchedSections] = useState<Set<string>>(() => new Set());
  const [nowTick, setNowTick] = useState(() => new Date());

  const reportMatch = useCallback((id: string, matched: boolean) => {
    setMatchedSections((prev) => {
      const has = prev.has(id);
      if (has === matched) return prev;
      const next = new Set(prev);
      if (matched) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const searchCtx = useMemo(() => ({ query: searchQuery, reportMatch }), [searchQuery, reportMatch]);

  useEffect(() => {
    if (initialSection) {
      setTimeout(() => {
        const targetId = initialSection.startsWith('sec-') ? initialSection : `sec-${initialSection}`;
        document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [initialSection]);

  useEffect(() => {
    void api.tools.info().then(setTools);
    const offUpdater = api.updater.onStatus((status) => {
      setUpdateStatus(status);
      if (status.state !== 'checking') setCheckingUpdates(false);
    });
    return () => {
      offUpdater();
    };
  }, []);

  const anyScheduleEnabled = Boolean(settings?.scheduler.enabled || settings?.speedSchedule?.enabled);
  useEffect(() => {
    if (!anyScheduleEnabled) return;
    setNowTick(new Date());
    const timer = setInterval(() => setNowTick(new Date()), 15_000);
    return () => clearInterval(timer);
  }, [anyScheduleEnabled]);

  if (!settings) return null;
  const s = settings;

  const save = (patch: DeepPartial<AppSettings>) =>
    updateSettings(patch).catch((err) => toast(errorText(t, err), 'error'));
  const num = (v: string) => Number(v) || 0;

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header" style={{ flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="row" style={{ alignItems: 'center', gap: 14 }}>
            <h1>{t('set.title')}</h1>
            <div className="input-with-icon" style={{ width: 220 }}>
              <Search size={14} />
              <input
                className="input sm"
                value={searchQuery}
                placeholder={t('set.searchSettings')}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={searchQuery ? { paddingInlineEnd: 24 } : undefined}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="input-clear-btn"
                  title={t('common.clear')}
                  onClick={() => setSearchQuery('')}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <div className="settings-jumpbar">
            {[
              { id: 'sec-general', label: t('set.general') },
              { id: 'sec-downloads', label: t('set.downloads') },
              { id: 'sec-automation', label: t('set.automation') },
              { id: 'sec-media', label: t('set.media') },
              { id: 'sec-extension', label: t('status.rpcBridge') },
              { id: 'sec-tools', label: t('set.tools') },
              { id: 'sec-updates', label: t('set.appUpdates') },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className="settings-jump-pill"
                onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <SettingsSearchContext.Provider value={searchCtx}>
        <Section id="sec-general" title={t('set.general')} icon={<Settings size={15} />}>
          <Setting label={t('set.language')}>
            <div className="segmented">
              {(['en', 'fa'] as Language[]).map((l) => (
                <button key={l} className={s.language === l ? 'active' : ''} onClick={() => void save({ language: l })}>
                  {l === 'en' ? 'English' : 'فارسی'}
                </button>
              ))}
            </div>
          </Setting>
          <Setting label={t('set.theme')}>
            <div className="segmented">
              {(['system', 'light', 'dark'] as Theme[]).map((th) => (
                <button key={th} className={s.theme === th ? 'active' : ''} onClick={() => void save({ theme: th })}>
                  {th === 'system' ? <Monitor size={13} /> : th === 'light' ? <Sun size={13} /> : <Moon size={13} />}
                  {t(`set.theme.${th}` as MessageKey)}
                </button>
              ))}
            </div>
          </Setting>
          <Setting label={t('set.closeToTray')}>
            <Switch checked={s.closeToTray} onChange={(v) => void save({ closeToTray: v })} />
          </Setting>
          <Setting label={t('set.notifications')}>
            <Switch checked={s.notifications} onChange={(v) => void save({ notifications: v })} />
          </Setting>
          <Setting label={t('set.clipboard')}>
            <Switch checked={s.clipboardMonitor} onChange={(v) => void save({ clipboardMonitor: v })} />
          </Setting>
          <Setting label={t('set.resumeOnStartup')}>
            <Switch checked={s.resumeOnStartup} onChange={(v) => void save({ resumeOnStartup: v })} />
          </Setting>
        </Section>

        <Section title={t('set.windowsIntegration')} icon={<AppWindow size={15} />}>
          <Setting label={t('set.startOnBoot')} hint={t('set.startOnBootHint')}>
            <Switch checked={s.startOnBoot} onChange={(v) => void save({ startOnBoot: v })} />
          </Setting>
          {s.startOnBoot && (
            <Setting label={t('set.startMinimized')}>
              <Switch checked={s.startMinimized} onChange={(v) => void save({ startMinimized: v })} />
            </Setting>
          )}
          <Setting label={t('set.globalShortcut')} hint={t('set.globalShortcutHint')}>
            <Switch checked={s.globalShortcut.enabled} onChange={(v) => void save({ globalShortcut: { enabled: v } })} />
          </Setting>
        </Section>

        <Section id="sec-downloads" title={t('set.downloads')} icon={<Download size={15} />}>
          <Setting label={t('set.folder')} hint={s.downloadDir}>
            <button
              className="btn"
              onClick={async () => {
                const dir = await api.settings.chooseDirectory(s.downloadDir);
                if (dir) void save({ downloadDir: dir });
              }}
            >
              <FolderOpen size={15} /> {t('grab.change')}
            </button>
            <button className="btn ghost icon" title={t('set.open')} onClick={() => void api.app.openPath(s.downloadDir)}>
              <FolderOpen size={15} />
            </button>
          </Setting>
          <Setting label={t('set.subfolders')}>
            <Switch checked={s.categorySubfolders} onChange={(v) => void save({ categorySubfolders: v })} />
          </Setting>
          <Setting label={t('set.maxConcurrent')}>
            <LazyInput className="narrow" type="number" min={1} max={16} value={s.maxConcurrent} onSave={(v) => void save({ maxConcurrent: num(v) })} />
          </Setting>
          <Setting label={t('set.connections')}>
            <LazyInput className="narrow" type="number" min={1} max={32} value={s.defaultConnections} onSave={(v) => void save({ defaultConnections: num(v) })} />
          </Setting>
          <Setting label={t('set.retries')}>
            <LazyInput className="narrow" type="number" min={0} max={50} value={s.maxRetries} onSave={(v) => void save({ maxRetries: num(v) })} />
          </Setting>
          <Setting label={t('set.speedLimit')}>
            <LazyInput className="narrow" type="number" min={0} value={s.globalSpeedLimitKBps} onSave={(v) => void save({ globalSpeedLimitKBps: num(v) })} />
          </Setting>
          <Setting label={t('set.afterQueue')}>
            <select className="select" value={s.afterQueue} onChange={(e) => void save({ afterQueue: e.target.value as AfterQueueAction })}>
              {(['none', 'quit', 'sleep', 'shutdown'] as AfterQueueAction[]).map((a) => (
                <option key={a} value={a}>
                  {t(`set.after.${a}` as MessageKey)}
                </option>
              ))}
            </select>
          </Setting>
          <Setting label={t('set.scheduler')} hint={t('set.schedulerEnable')}>
            <ScheduleStatusBadge schedule={s.scheduler} now={nowTick} />
            <Switch checked={s.scheduler.enabled} onChange={(v) => void save({ scheduler: { enabled: v } })} />
          </Setting>
          {s.scheduler.enabled && (
            <Setting label={`${t('set.startAt')} / ${t('set.stopAt')}`}>
              <input className="input narrow" type="time" value={s.scheduler.startTime} onChange={(e) => void save({ scheduler: { startTime: e.target.value } })} />
              <span className="muted">→</span>
              <input className="input narrow" type="time" value={s.scheduler.stopTime} onChange={(e) => void save({ scheduler: { stopTime: e.target.value } })} />
            </Setting>
          )}
          {s.scheduler.enabled && (
            <Setting label={t('sched.days')}>
              <DayPicker value={s.scheduler.days} onChange={(days) => void save({ scheduler: { days } })} />
            </Setting>
          )}
          <Setting label={t('set.speedSchedule')} hint={t('set.speedScheduleEnable')}>
            {s.speedSchedule && <ScheduleStatusBadge schedule={s.speedSchedule} now={nowTick} />}
            <Switch
              checked={s.speedSchedule?.enabled ?? false}
              onChange={(v) => void save({ speedSchedule: { enabled: v } })}
            />
          </Setting>
          <Setting label={t('set.presets')}>
            <div className="settings-presets-row">
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  void save({
                    speedSchedule: {
                      enabled: true,
                      startTime: '08:00',
                      stopTime: '22:00',
                      speedLimitKBps: 500,
                      days: [],
                    },
                    globalSpeedLimitKBps: 0,
                  })
                }
              >
                <Moon size={13} /> {t('set.presetNightOwl')}
              </button>
            </div>
          </Setting>
          {s.speedSchedule?.enabled && (
            <>
              <Setting label={`${t('set.startAt')} / ${t('set.stopAt')}`}>
                <input
                  className="input narrow"
                  type="time"
                  value={s.speedSchedule.startTime || '08:00'}
                  onChange={(e) => void save({ speedSchedule: { startTime: e.target.value } })}
                />
                <span className="muted">→</span>
                <input
                  className="input narrow"
                  type="time"
                  value={s.speedSchedule.stopTime || '22:00'}
                  onChange={(e) => void save({ speedSchedule: { stopTime: e.target.value } })}
                />
              </Setting>
              <Setting label={t('set.scheduledSpeedLimit')}>
                <LazyInput
                  className="narrow"
                  type="number"
                  min={0}
                  value={s.speedSchedule.speedLimitKBps ?? 500}
                  onSave={(v) => void save({ speedSchedule: { speedLimitKBps: num(v) } })}
                />
              </Setting>
              <Setting label={t('sched.days')}>
                <DayPicker
                  value={s.speedSchedule.days}
                  onChange={(days) => void save({ speedSchedule: { days } })}
                />
              </Setting>
            </>
          )}
        </Section>

        <Section id="sec-automation" title={t('set.automation')} icon={<Zap size={15} />}>
          <Setting label={t('set.presets')}>
            <div className="settings-presets-row">
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  void save({
                    automation: {
                      autoExtractArchives: true,
                      extractToSubfolder: true,
                      deleteArchiveAfterExtraction: false,
                    },
                  })
                }
              >
                <Zap size={13} /> {t('set.presetExtractZip')}
              </button>
            </div>
          </Setting>
          <Setting label={t('set.autoExtract')} hint={t('set.autoExtractHint')}>
            <Switch
              checked={s.automation?.autoExtractArchives ?? false}
              onChange={(v) => void save({ automation: { autoExtractArchives: v } })}
            />
          </Setting>
          {s.automation?.autoExtractArchives && (
            <>
              <Setting label={t('set.extractSubfolder')} hint={t('set.extractSubfolderHint')}>
                <Switch
                  checked={s.automation?.extractToSubfolder ?? true}
                  onChange={(v) => void save({ automation: { extractToSubfolder: v } })}
                />
              </Setting>
              <Setting label={t('set.deleteArchive')} hint={t('set.deleteArchiveHint')}>
                <Switch
                  checked={s.automation?.deleteArchiveAfterExtraction ?? false}
                  onChange={(v) => void save({ automation: { deleteArchiveAfterExtraction: v } })}
                />
              </Setting>
            </>
          )}
          <Setting label={t('set.completionSound')} hint={t('set.completionSoundHint')}>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <Switch
                checked={s.automation?.playCompletionSound ?? true}
                onChange={(v) => void save({ automation: { playCompletionSound: v } })}
              />
              <button
                type="button"
                className="btn ghost sm"
                style={{ padding: '2px 8px', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => playCompletionChime()}
              >
                <Volume2 size={13} /> {t('set.testSound')}
              </button>
            </div>
          </Setting>
          <Setting label={t('set.customCommand')} hint={t('set.customCommandHint')} stack>
            <LazyInput
              className="mono"
              value={s.automation?.customCommand ?? ''}
              placeholder="e.g. echo Finished {fileName}"
              onSave={(v) => void save({ automation: { customCommand: v } })}
            />
            {(s.automation?.customCommand ?? '').trim() !== '' && (
              <div className="cmd-preview">
                <span className="cmd-preview-label">{t('set.commandPreview')}:</span>
                <code className="mono">{formatSampleCustomCommand(s.automation!.customCommand!.trim(), s.downloadDir)}</code>
              </div>
            )}
          </Setting>
        </Section>

        <Section title={t('set.network')} icon={<Globe size={15} />}>
          <Setting label={t('set.proxy')} hint={t('set.proxyHint')}>
            <LazyInput className="mono" value={s.proxy} placeholder="http://127.0.0.1:8080" onSave={(v) => void save({ proxy: v })} />
          </Setting>
          <Setting label={t('set.userAgent')} stack>
            <LazyInput className="mono" value={s.userAgent} onSave={(v) => void save({ userAgent: v })} />
          </Setting>
        </Section>

        <Section id="sec-media" title={t('set.media')} icon={<Music size={15} />}>
          <Setting label={t('set.audioFormat')}>
            <div className="segmented">
              {(['mp3', 'm4a'] as const).map((f) => (
                <button key={f} className={s.media.defaultAudioFormat === f ? 'active' : ''} onClick={() => void save({ media: { defaultAudioFormat: f } })}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </Setting>
          <Setting label={t('set.videoQuality')}>
            <select className="select" value={s.media.defaultVideoQuality} onChange={(e) => void save({ media: { defaultVideoQuality: e.target.value } })}>
              {['2160p', '1440p', '1080p', '720p', '480p', '360p'].map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </Setting>
          <Setting label={t('set.cookiesBrowser')} hint={t('set.cookiesBrowserHint')}>
            <select
              className="select"
              value={s.media.cookiesFromBrowser}
              onChange={(e) => void save({ media: { cookiesFromBrowser: e.target.value as BrowserName } })}
            >
              <option value="">{t('set.none')}</option>
              {(['firefox', 'chrome', 'edge', 'brave', 'opera', 'vivaldi', 'chromium'] as BrowserName[]).map((b) => (
                <option key={b} value={b}>
                  {b[0].toUpperCase() + b.slice(1)}
                </option>
              ))}
            </select>
          </Setting>
          <Setting label={t('set.cookiesFile')} hint={s.media.cookiesFile || undefined}>
            <button
              className="btn"
              onClick={async () => {
                const file = await api.settings.chooseFile([{ name: 'cookies.txt', extensions: ['txt'] }]);
                if (file) void save({ media: { cookiesFile: file } });
              }}
            >
              <FolderOpen size={15} /> {t('add.browse')}
            </button>
            {s.media.cookiesFile && (
              <button className="btn ghost" onClick={() => void save({ media: { cookiesFile: '' } })}>
                {t('set.clear')}
              </button>
            )}
          </Setting>
          <Setting label={t('set.spotify')} hint={t('set.spotifyHint')} stack>
            <div className="grid-2" style={{ width: '100%' }}>
              <LazyInput className="mono" value={s.media.spotifyClientId} placeholder="Client ID" onSave={(v) => void save({ media: { spotifyClientId: v.trim() } })} />
              <LazyInput
                className="mono"
                type="password"
                value={s.media.spotifyClientSecret}
                placeholder="Client secret"
                onSave={(v) => void save({ media: { spotifyClientSecret: v.trim() } })}
              />
            </div>
          </Setting>
          <Setting label={t('set.instagram')}>
            <LazyInput className="mono" type="password" value={s.media.instagramSessionId} placeholder="sessionid" onSave={(v) => void save({ media: { instagramSessionId: v.trim() } })} />
          </Setting>
        </Section>

        <Section id="sec-extension" title={t('set.extension')} icon={<Radio size={15} />}>
          <Setting label={t('set.extensionEnable')}>
            <Switch
              checked={s.extension.enabled}
              onChange={(enabled) => void save({ extension: { enabled } })}
            />
          </Setting>
          {s.extension.enabled && (
            <>
              <Setting label={t('set.extensionStatus')}>
                <span className="badge success">
                  <CircleCheck size={12} /> {t('set.extensionListening', { port: s.extension.port })}
                </span>
              </Setting>
              <Setting label={t('set.extensionAllowLan')} hint={t('set.extensionAllowLanHint')}>
                <Switch
                  checked={s.extension.allowLan === true}
                  onChange={(allowLan) => {
                    void save({ extension: { allowLan } });
                    if (allowLan) toast(t('set.extensionAllowLanWarning'), 'info');
                  }}
                />
              </Setting>
              {s.extension.allowLan === true && tools?.lanIp && (
                <Setting label={t('set.extensionLanIp')} hint={`http://${tools.lanIp}:${s.extension.port}`}>
                  <span className="badge mono">{tools.lanIp}:{s.extension.port}</span>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button
                      className="btn"
                      onClick={() => {
                        const uri = `grabbit://pair?host=${encodeURIComponent(tools.lanIp!)}&port=${s.extension.port}&token=${encodeURIComponent(s.extension.token)}`;
                        void navigator.clipboard.writeText(uri);
                        toast(t('set.pairingCopied'), 'success');
                      }}
                    >
                      <Copy size={14} /> {t('set.copyPairingCode')}
                    </button>
                    <button
                      className="btn"
                      onClick={() => setShowQrModal(true)}
                    >
                      <QrCode size={14} /> {t('mobile.scanQr')}
                    </button>
                  </div>
                </Setting>
              )}
              <Setting label={t('set.extensionPort')}>
                <LazyInput
                  className="mono"
                  type="number"
                  min={1024}
                  max={65535}
                  value={s.extension.port}
                  onSave={(v) => {
                    const parsed = Math.trunc(num(v));
                    const clamped = parsed > 0 ? Math.min(65535, Math.max(1024, parsed)) : 31542;
                    void save({ extension: { port: clamped } });
                  }}
                />
              </Setting>
              <Setting label={t('set.extensionToken')} hint={t('set.extensionTokenHint')} stack>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%' }}>
                  <input
                    className="input mono"
                    type="text"
                    readOnly
                    value={s.extension.token}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(s.extension.token);
                      toast(t('set.tokenCopied'), 'success');
                    }}
                  >
                    <Copy size={14} /> {t('common.copy')}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      const newToken = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
                      void save({ extension: { token: newToken } });
                    }}
                  >
                    <RotateCw size={14} /> {t('set.regenerateToken')}
                  </button>
                </div>
              </Setting>
            </>
          )}
        </Section>

        <Section id="sec-tools" title={t('set.tools')} icon={<Wrench size={15} />}>
          {(['ytdlp', 'ffmpeg', 'ffprobe'] as const).map((key) => {
            const info = tools?.[key];
            return (
              <Setting key={key} label={key === 'ytdlp' ? 'yt-dlp' : key === 'ffmpeg' ? 'FFmpeg' : 'FFprobe'} hint={info?.path}>
                {!tools ? (
                  <LoaderCircle size={16} className="spin" />
                ) : info?.version ? (
                  <span className="badge success">
                    <CircleCheck size={12} /> {info.version}
                  </span>
                ) : (
                  <span className="badge danger">
                    <CircleX size={12} /> {t('set.notFound')}
                  </span>
                )}
                {key === 'ytdlp' && (
                  <button
                    className="btn"
                    disabled={updating}
                    onClick={async () => {
                      setUpdating(true);
                      try {
                        const out = await api.tools.updateYtDlp();
                        toast(out.split('\n').filter(Boolean).pop() ?? 'OK', 'success');
                        setTools(await api.tools.info());
                      } catch (err) {
                        toast(errorText(t, err), 'error');
                      } finally {
                        setUpdating(false);
                      }
                    }}
                  >
                    <RotateCw size={14} className={updating ? 'spin' : ''} />
                    {updating ? t('set.updating') : tools?.ytdlp.version ? t('set.updateYtdlp') : t('set.installYtdlp')}
                  </button>
                )}
              </Setting>
            );
          })}
          <Setting label={t('set.dataFolder')} hint={tools?.dataDir}>
            <button className="btn" disabled={!tools} onClick={() => tools && void api.app.openPath(tools.dataDir)}>
              <FolderOpen size={15} /> {t('set.open')}
            </button>
          </Setting>
        </Section>

        <Section id="sec-updates" title={t('set.appUpdates')} icon={<ArrowUpCircle size={15} />}>
          <Setting label={`GRabbit ${tools?.appVersion ? `v${tools.appVersion}` : ''}`}>
            {checkingUpdates ? (
              <span className="badge info">
                <LoaderCircle size={12} className="spin" /> {t('set.checkingUpdates')}
              </span>
            ) : updateStatus?.state === 'downloaded' ? (
              <span className="badge success">
                <CircleCheck size={12} /> {t('set.updateReady')}
              </span>
            ) : updateStatus?.state === 'downloading' ? (
              <span className="badge info">
                <LoaderCircle size={12} className="spin" /> {t('set.downloadingUpdate', { percent: updateStatus.progressPercent ?? 0 })}
              </span>
            ) : updateStatus?.state === 'available' ? (
              <span className="badge warning">
                {t('set.updateAvailable', { version: updateStatus.version ?? '' })}
              </span>
            ) : updateStatus?.state === 'not-available' ? (
              <span className="badge success">
                <CircleCheck size={12} /> {t('set.upToDate')}
              </span>
            ) : updateStatus?.state === 'error' ? (
              <span className="badge danger" title={updateStatus.error}>
                <CircleX size={12} /> {updateStatus.error || t('err.UNKNOWN')}
              </span>
            ) : null}

            {updateStatus?.state === 'downloaded' ? (
              <button className="btn primary" onClick={() => void api.updater.install()}>
                <RotateCw size={14} /> {t('set.restartAndInstall')}
              </button>
            ) : updateStatus?.state === 'available' ? (
              <button className="btn primary" onClick={() => void api.updater.download()}>
                <Download size={14} /> {t('set.downloadUpdate')}
              </button>
            ) : (
              <button
                className="btn primary"
                disabled={checkingUpdates || updateStatus?.state === 'downloading'}
                onClick={async () => {
                  setCheckingUpdates(true);
                  try {
                    const status = await api.updater.check();
                    setUpdateStatus(status);
                    if (status.state === 'not-available') {
                      const ver = status.version ?? tools?.appVersion;
                      toast(ver ? `${t('set.upToDate')} (v${ver})` : t('set.upToDate'), 'success');
                    }
                  } catch (err) {
                    toast(errorText(t, err), 'error');
                  } finally {
                    setCheckingUpdates(false);
                  }
                }}
              >
                <RotateCw size={14} className={checkingUpdates || updateStatus?.state === 'downloading' ? 'spin' : ''} />
                {checkingUpdates
                  ? t('set.checkingUpdates')
                  : updateStatus?.state === 'downloading'
                  ? t('set.downloadingUpdate', { percent: updateStatus.progressPercent ?? 0 })
                  : t('set.checkForUpdates')}
              </button>
            )}
          </Setting>
          <Setting label={t('set.autoCheckUpdates')}>
            <Switch checked={s.updates.autoCheck} onChange={(v) => void save({ updates: { autoCheck: v } })} />
          </Setting>
          <Setting label={t('set.autoDownloadUpdates')}>
            <Switch checked={s.updates.autoDownload} onChange={(v) => void save({ updates: { autoDownload: v } })} />
          </Setting>
        </Section>

        <Section title={t('set.about')} icon={<Info size={15} />}>
          <Setting label={`GRabbit ${tools?.appVersion ?? ''}`} hint={t('set.aboutText')}>
            <span />
          </Setting>
        </Section>

        {searchQuery.trim() !== '' && matchedSections.size === 0 && (
          <div className="empty" style={{ padding: '40px 16px' }}>
            <p className="muted">{t('set.noMatchingSettings')}</p>
          </div>
        )}
        </SettingsSearchContext.Provider>

        {showQrModal && tools?.lanIp && (
          <QRCodeModal
            value={`grabbit://pair?host=${encodeURIComponent(tools.lanIp)}&port=${s.extension.port}&token=${encodeURIComponent(s.extension.token)}`}
            title={t('mobile.scanQr')}
            subtitle={t('mobile.qrInstruction')}
            onClose={() => setShowQrModal(false)}
          />
        )}
      </div>
    </div>
  );
}
