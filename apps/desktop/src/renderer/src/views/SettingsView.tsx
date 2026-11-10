import { ReactNode, useEffect, useState } from 'react';
import { AppWindow, ArrowUpCircle, CircleCheck, CircleX, Copy, Download, FolderOpen, Globe, Info, LoaderCircle, Monitor, Moon, Music, Radio, RotateCw, Settings, Sun, Wrench } from 'lucide-react';
import type { AfterQueueAction, AppSettings, BrowserName, DeepPartial, Language, Theme, ToolInfo, UpdateStatusInfo } from '../../../shared/types';
import { errorText, useI18n, type MessageKey } from '../i18n';
import { api, useApp } from '../state';
import { Switch } from '../components/ui';

function Section({ id, title, icon, children }: { id?: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div id={id} className="settings-section">
      <h3>
        {icon} {title}
      </h3>
      <div className="card">{children}</div>
    </div>
  );
}

function Setting({ label, hint, children, stack }: { label: string; hint?: string; children: ReactNode; stack?: boolean }) {
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

export function SettingsView() {
  const { t } = useI18n();
  const { settings, updateSettings, toast } = useApp();
  const [tools, setTools] = useState<ToolInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusInfo | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

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

  if (!settings) return null;
  const s = settings;

  const save = (patch: DeepPartial<AppSettings>) =>
    updateSettings(patch).catch((err) => toast(errorText(t, err), 'error'));
  const num = (v: string) => Number(v) || 0;

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header" style={{ flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>{t('set.title')}</h1>
          <div className="settings-jumpbar">
            {[
              { id: 'sec-general', label: t('set.general') },
              { id: 'sec-downloads', label: t('set.downloads') },
              { id: 'sec-media', label: t('set.media') },
              { id: 'sec-extension', label: 'RPC Bridge' },
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
            <Switch checked={s.scheduler.enabled} onChange={(v) => void save({ scheduler: { enabled: v } })} />
          </Setting>
          {s.scheduler.enabled && (
            <Setting label={`${t('set.startAt')} / ${t('set.stopAt')}`}>
              <input className="input narrow" type="time" value={s.scheduler.startTime} onChange={(e) => void save({ scheduler: { startTime: e.target.value } })} />
              <span className="muted">→</span>
              <input className="input narrow" type="time" value={s.scheduler.stopTime} onChange={(e) => void save({ scheduler: { stopTime: e.target.value } })} />
            </Setting>
          )}
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
                </Setting>
              )}
              <Setting label={t('set.extensionPort')}>
                <LazyInput
                  className="mono"
                  type="number"
                  min={1024}
                  max={65535}
                  value={s.extension.port}
                  onSave={(v) => void save({ extension: { port: num(v) || 31542 } })}
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
                      toast(`${t('set.upToDate')} (v${status.version ?? tools?.appVersion ?? '1.1.0'})`, 'success');
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
      </div>
    </div>
  );
}
