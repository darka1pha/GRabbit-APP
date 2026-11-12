import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
import { createTranslator, I18nContext, useI18n, type MessageKey } from './i18n';
import { api, AppProvider, useApp } from './state';
import { useDownloadsAggregate } from './downloads-store';
import { formatSpeed, isHttpUrl, looksLikeDirectFile } from './format';
import { CategoryIcon, ProgressBar, Toasts } from './components/ui';
import { GrabView } from './views/GrabView';
import { DownloadsView } from './views/DownloadsView';

// Views and modals that are not on screen at launch load when first opened
const AddDownloadDialog = lazy(() => import('./components/AddDownloadDialog').then((m) => ({ default: m.AddDownloadDialog })));
const RecognizeView = lazy(() => import('./views/RecognizeView').then((m) => ({ default: m.RecognizeView })));
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })));
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

/** Total speed and active count in the title bar. Subscribes on its own so the shell does not re-render with it. */
function SpeedPill({ onClick }: { onClick(): void }) {
  const { t, language } = useI18n();
  const { active, speed } = useDownloadsAggregate();
  return (
    <AnimatePresence initial={false}>
      {active > 0 && (
        <motion.button
          initial={{ opacity: 0, scale: 0.9, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -4 }}
          transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          className="speed-pill btn ghost"
          onClick={onClick}
          title={t('nav.speed')}
        >
          <Gauge size={13} /> {formatSpeed(speed, language) || '…'} · {active}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/** The status card at the bottom of the sidebar. */
function SidebarStatus({ rpcEnabled, rpcPort, onOpen }: { rpcEnabled: boolean; rpcPort: number; onOpen(active: boolean): void }) {
  const { t, language } = useI18n();
  const { active, speed, percent } = useDownloadsAggregate();
  return (
    <div className="sidebar-status-card" onClick={() => onOpen(active > 0)}>
      <div className="sidebar-status-row">
        <span className="sidebar-status-label">
          <Gauge size={13} />
          {active > 0 ? t('status.active', { count: active }) : t('status.ready')}
        </span>
        <b className="sidebar-status-speed">{active > 0 ? formatSpeed(speed, language) || '0 B/s' : t('status.idle')}</b>
      </div>
      {active > 0 && (
        <div style={{ marginTop: 6 }}>
          <ProgressBar value={percent ?? 0} indeterminate={!percent} />
        </div>
      )}
      <div className="sidebar-status-meta">
        <span className={`rpc-dot ${rpcEnabled ? 'on' : 'off'}`} />
        <span>{rpcEnabled ? `${t('status.rpcBridge')} :${rpcPort}` : t('set.extensionDisabled')}</span>
      </div>
    </div>
  );
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
  const handleLinkRef = useRef(handleLink);
  handleLinkRef.current = handleLink;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea')) return;
      const text = e.clipboardData?.getData('text')?.trim();
      if (text && isHttpUrl(text)) {
        e.preventDefault();
        handleLinkRef.current(text);
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
  }, []);

  const { unfinished, categoryCounts } = useMemo(() => {
    const counts = new Map<Category, number>();
    let pending = 0;
    for (const d of downloads) {
      counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
      if (d.status !== 'completed') pending++;
    }
    return { unfinished: pending, categoryCounts: counts };
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
                  : t('app.update')}
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
            <SpeedPill onClick={() => setView('downloads')} />
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

          <SidebarStatus
            rpcEnabled={settings.extension.enabled}
            rpcPort={settings.extension.port}
            onOpen={(busy) => setView(busy ? 'downloads' : 'settings')}
          />

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
              <Suspense fallback={null}>
                {view === 'recognize' && <RecognizeView onFindAndDownload={(q) => openGrab(q)} />}
                {view === 'settings' && <SettingsView />}
              </Suspense>
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
                <b>{t('app.dropLink')}</b>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {addDialog && (
        <Suspense fallback={null}>
          <AddDownloadDialog
            initialUrl={addDialog.url}
            onClose={() => setAddDialog(null)}
            onOpenInGrab={(url) => {
              setAddDialog(null);
              openGrab(url);
            }}
          />
        </Suspense>
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
