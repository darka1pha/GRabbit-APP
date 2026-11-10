import { useEffect, useMemo, useState } from 'react';
import { AudioLines, Download, Gauge, Link, Settings, Sparkles } from 'lucide-react';
import { CATEGORIES, type Category, type ClipboardLink } from '../../shared/types';
import { createTranslator, I18nContext, type MessageKey } from './i18n';
import { api, AppProvider, useApp } from './state';
import { formatSpeed, isHttpUrl, looksLikeDirectFile } from './format';
import { CategoryIcon, Toasts } from './components/ui';
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
  const { settings, downloads, toast } = useApp();
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
  const categoryCounts = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const d of downloads) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
    return counts;
  }, [downloads]);

  if (!settings) return null;

  const navItem = (id: View, icon: React.ReactNode, label: string, count?: number) => (
    <button
      className={`nav-item ${view === id && (id !== 'downloads' || category === 'all') ? 'active' : ''}`}
      onClick={() => {
        setView(id);
        if (id === 'downloads') setCategory('all');
      }}
    >
      {icon}
      {label}
      {count ? <span className="count">{count}</span> : null}
    </button>
  );

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        <header className="titlebar">
          <div className="brand">
            <img src={iconUrl} alt="" />
            GRabbit <small>{t('app.slogan')}</small>
          </div>
          <div className="spacer" />
          <div className="titlebar-actions">
            <button
              className="quick-pill btn ghost"
              onClick={() => void api.pill.submit('', 'grab')}
              title={t('pill.shortcutHint')}
            >
              <Sparkles size={13} />
              <span className="kbd">Ctrl+Alt+G</span>
            </button>
            {active.length > 0 && (
              <button className="speed-pill btn ghost" onClick={() => setView('downloads')} title={t('nav.speed')}>
                <Gauge size={13} /> {formatSpeed(totalSpeed, language) || '…'} · {active.length}
              </button>
            )}
          </div>
        </header>

        <nav className="sidebar">
          {navItem('grab', <Link size={17} />, t('nav.grab'))}
          {navItem('downloads', <Download size={17} />, t('nav.downloads'), unfinished)}
          {navItem('recognize', <AudioLines size={17} />, t('nav.recognize'))}

          <div className="nav-section">{t('nav.categories')}</div>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`nav-item sub ${view === 'downloads' && category === c ? 'active' : ''}`}
              onClick={() => {
                setCategory(c);
                setView('downloads');
              }}
            >
              <CategoryIcon category={c} size={15} />
              {t(`cat.${c}` as MessageKey)}
              {categoryCounts.get(c) ? <span className="count">{categoryCounts.get(c)}</span> : null}
            </button>
          ))}

          <div className="grow" />
          {navItem('settings', <Settings size={17} />, t('nav.settings'))}
        </nav>

        <main className="main">
          <div key={view === 'downloads' ? `${view}-${category}` : view} className="view-stage">
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
          </div>
        </main>
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
