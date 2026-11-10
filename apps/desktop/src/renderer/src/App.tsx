import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AudioLines,
  Download,
  Gauge,
  Link,
  LoaderCircle,
  Moon,
  Plus,
  RotateCw,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react';
import { CATEGORIES, type Category, type ClipboardLink, type UpdateStatusInfo } from '../../shared/types';
import { createTranslator, I18nContext, type MessageKey } from './i18n';
import { api, AppProvider, useApp } from './state';
import { formatSpeed, isHttpUrl, looksLikeDirectFile } from './format';
import { CategoryIcon, ProgressBar, Toasts } from './components/ui';
import { AddDownloadDialog } from './components/AddDownloadDialog';
import { GrabView } from './views/GrabView';
import { DownloadsView } from './views/DownloadsView';
import { RecognizeView } from './views/RecognizeView';
import { SettingsView } from './views/SettingsView';
import iconUrl from './assets/icon.png';

type View = 'grab' | 'downloads' | 'recognize' | 'settings';

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

function Shell() {
  const { settings, updateSettings, downloads, toast } = useApp();
  const language = settings?.language ?? 'en';
  const i18n = useMemo(
    () => ({ t: createTranslator(language), language, dir: language === 'fa' ? ('rtl' as const) : ('ltr' as const) }),
    [language]
  );
  const { t } = i18n;
  const systemDark = useSystemDark();
  const theme = settings?.theme === 'system' || !settings ? (systemDark ? 'dark' : 'light') : settings.theme;

  const [view, setView] = useState<View>('grab');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [addDialog, setAddDialog] = useState<{ url?: string } | null>(null);
  const [grabInput, setGrabInput] = useState<string | null>(null);
  const [clipboardLink, setClipboardLink] = useState<ClipboardLink | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusInfo | null>(null);
  const [draggingOverWindow, setDraggingOverWindow] = useState(false);

  useEffect(() => {
    const unsub = api.updater.onStatus((status) => {
      setUpdateStatus(status);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.lang = language;
    root.dir = i18n.dir;
  }, [theme, language, i18n.dir]);

  function openGrab(input: string) {
    setGrabInput(input);
    setView('grab');
  }

  function handleLink(url: string) {
    if (looksLikeDirectFile(url)) setAddDialog({ url });
    else openGrab(url);
  }

  useEffect(() => api.app.onNavigate((v) => setView(v as View)), []);

  useEffect(
    () =>
      api.app.onClipboardLink((link) => {
        setClipboardLink(link);
        if (document.hasFocus() && view !== 'grab') {
          toast(link.url, 'info', {
            label: t('grab.useIt'),
            run: () => (link.kind === 'file' ? setAddDialog({ url: link.url }) : openGrab(link.url)),
          });
        }
      }),
    [view, t, toast]
  );

  // Ctrl+V anywhere outside a text field grabs the pasted link; Ctrl+N opens "Add download"
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea')) return;
      const text = e.clipboardData?.getData('text')?.trim();
      if (text && isHttpUrl(text)) {
        e.preventDefault();
        handleLink(text);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setAddDialog({});
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  });

  const active = downloads.filter((d) => d.status === 'downloading' || d.status === 'starting' || d.status === 'processing');
  const totalSpeed = active.reduce((s, d) => s + d.speed, 0);
  const unfinished = downloads.filter((d) => d.status !== 'completed').length;
  const activeProgress = useMemo(() => {
    if (active.length === 0) return 0;
    let sum = 0;
    for (const d of active) {
      if (d.totalBytes && d.totalBytes > 0) sum += Math.min(100, (d.receivedBytes / d.totalBytes) * 100);
      else if (d.percent !== undefined) sum += d.percent;
    }
    return Math.round(sum / active.length);
  }, [active]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const d of downloads) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
    return counts;
  }, [downloads]);

  if (!settings) return null;

  const navItem = (id: View, icon: React.ReactNode, label: string, count?: number) => {
    const isActive = view === id && (id !== 'downloads' || category === 'all');
    return (
      <button
        className={`nav-item ${isActive ? 'active' : ''}`}
        onClick={() => {
          setView(id);
          if (id === 'downloads') setCategory('all');
        }}
      >
        {isActive && (
          <motion.span
            layoutId="sidebar-active-indicator"
            className="nav-active-pill"
            transition={{ type: 'spring', damping: 24, stiffness: 320 }}
          />
        )}
        {icon}
        {label}
        {count ? <span className="count">{count}</span> : null}
      </button>
    );
  };

  return (
    <I18nContext.Provider value={i18n}>
      <div
        className="app"
        onDragOver={(e) => {
          if (view === 'recognize') return;
          if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
            e.preventDefault();
            setDraggingOverWindow(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDraggingOverWindow(false);
        }}
        onDrop={(e) => {
          if (view === 'recognize') return;
          setDraggingOverWindow(false);
          const text = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
          if (text && isHttpUrl(text)) {
            e.preventDefault();
            handleLink(text);
          }
        }}
      >
        <header className="titlebar">
          <div className="brand">
            <img src={iconUrl} alt="" />
            GRabbit <small>{t('app.slogan')}</small>
          </div>
          <div className="spacer" />
          <div className="titlebar-actions">
            <button
              className="quick-pill btn ghost accent-pill"
              onClick={() => setAddDialog({})}
              title={`${t('dl.add')} (Ctrl+N)`}
            >
              <Plus size={13} />
              <span>{t('dl.add')}</span>
            </button>
            <button
              className="quick-pill btn ghost"
              disabled={updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'}
              onClick={async () => {
                if (updateStatus?.state === 'downloaded') {
                  await api.updater.install();
                  return;
                }
                if (updateStatus?.state === 'available') {
                  await api.updater.download();
                  return;
                }
                const st = await api.updater.check();
                setUpdateStatus(st);
                if (st.state === 'not-available') {
                  toast(`${t('set.upToDate')} (v${st.version || ''})`, 'success');
                }
              }}
              title={t('set.checkForUpdates')}
            >
              {updateStatus?.state === 'checking' || updateStatus?.state === 'downloading' ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <RotateCw size={13} />
              )}
              <span>
                {updateStatus?.state === 'checking'
                  ? t('set.checkingUpdates')
                  : updateStatus?.state === 'downloading'
                  ? `${updateStatus.progressPercent ?? 0}%`
                  : updateStatus?.state === 'downloaded'
                  ? t('set.restartAndInstall')
                  : 'Update'}
              </span>
            </button>
            <button
              className="quick-pill btn ghost"
              onClick={() => void api.pill.submit('', 'grab')}
              title={t('pill.shortcutHint')}
            >
              <Sparkles size={13} />
              <span className="kbd">Ctrl+Alt+G</span>
            </button>
            <button
              className="quick-pill btn ghost icon-pill"
              onClick={() => void updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
              title={theme === 'dark' ? t('set.theme.light') : t('set.theme.dark')}
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </button>
            <AnimatePresence initial={false}>
              {active.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -4 }}
                  transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                  className="speed-pill btn ghost"
                  onClick={() => setView('downloads')}
                  title={t('nav.speed')}
                >
                  <Gauge size={13} /> {formatSpeed(totalSpeed, language) || '…'} · {active.length}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </header>

        <nav className="sidebar">
          {navItem('grab', <Link size={17} />, t('nav.grab'))}
          {navItem('downloads', <Download size={17} />, t('nav.downloads'), unfinished)}
          {navItem('recognize', <AudioLines size={17} />, t('nav.recognize'))}

          <div className="nav-section">{t('nav.categories')}</div>
          {CATEGORIES.map((c) => {
            const isCatActive = view === 'downloads' && category === c;
            return (
              <button
                key={c}
                className={`nav-item sub ${isCatActive ? 'active' : ''}`}
                onClick={() => {
                  setCategory(c);
                  setView('downloads');
                }}
              >
                {isCatActive && (
                  <motion.span
                    layoutId="sidebar-active-indicator"
                    className="nav-active-pill"
                    transition={{ type: 'spring', damping: 24, stiffness: 320 }}
                  />
                )}
                <span className={`cat-dot ${c}`}>
                  <CategoryIcon category={c} size={14} />
                </span>
                {t(`cat.${c}` as MessageKey)}
                {categoryCounts.get(c) ? <span className="count">{categoryCounts.get(c)}</span> : null}
              </button>
            );
          })}

          <div className="grow" />

          <div className="sidebar-status-card" onClick={() => setView(active.length > 0 ? 'downloads' : 'settings')}>
            <div className="sidebar-status-row">
              <span className="sidebar-status-label">
                <Gauge size={13} />
                {active.length > 0 ? `${active.length} Active` : 'Engine Ready'}
              </span>
              <b className="sidebar-status-speed">
                {active.length > 0 ? formatSpeed(totalSpeed, language) || '0 B/s' : 'Idle'}
              </b>
            </div>
            {active.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <ProgressBar value={activeProgress} indeterminate={activeProgress === 0} />
              </div>
            )}
            <div className="sidebar-status-meta">
              <span className={`rpc-dot ${settings.extension.enabled ? 'on' : 'off'}`} />
              <span>
                {settings.extension.enabled
                  ? `RPC Bridge :${settings.extension.port}`
                  : t('set.extensionDisabled')}
              </span>
            </div>
          </div>

          {navItem('settings', <Settings size={17} />, t('nav.settings'))}
        </nav>

        <main className="main">
          <AnimatePresence mode="wait">
            <motion.div
              key={view === 'downloads' ? `${view}-${category}` : view}
              className="view-stage"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {view === 'grab' && (
                <GrabView
                  pendingInput={grabInput}
                  clipboardLink={clipboardLink}
                  onConsumePending={() => setGrabInput(null)}
                  onOpenAddDialog={(url) => setAddDialog({ url })}
                  onAdded={() => {
                    setCategory('all');
                    setView('downloads');
                  }}
                />
              )}
              {view === 'downloads' && <DownloadsView category={category} onAdd={(url) => setAddDialog({ url })} />}
              {view === 'recognize' && <RecognizeView onFindAndDownload={(q) => openGrab(q)} />}
              {view === 'settings' && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>
        <AnimatePresence>
          {draggingOverWindow && (
            <motion.div
              className="window-drop-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onDragLeave={() => setDraggingOverWindow(false)}
            >
              <motion.div
                className="window-drop-card"
                initial={{ scale: 0.9, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 10 }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              >
                <Download size={32} />
                <b>Drop link to grab or download</b>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {addDialog && (
        <AddDownloadDialog
          initialUrl={addDialog.url}
          onClose={() => setAddDialog(null)}
          onOpenInGrab={(url) => {
            setAddDialog(null);
            openGrab(url);
          }}
        />
      )}
      <Toasts />
    </I18nContext.Provider>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
