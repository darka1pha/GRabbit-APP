import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Sparkles, X } from 'lucide-react';
import { api } from '../state';
import { isHttpUrl, looksLikeDirectFile } from '../format';
import { createTranslator } from '../i18n';
import iconUrl from '../assets/icon.png';

export function GrabPillWindow() {
  const [url, setUrl] = useState('');
  const [language, setLanguage] = useState<'en' | 'fa'>('en');
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.settings.get().then((s) => {
      setLanguage(s.language || 'en');
      setTheme(s.theme || 'system');
    });

    const offInit = api.pill.onInit((data) => {
      if (data.clipboardUrl) {
        setUrl(data.clipboardUrl);
      }
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    });

    return () => {
      offInit();
    };
  }, []);

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'system' ? prefersDark : theme === 'dark';
  const t = createTranslator(language);

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
  }, [isDark, language]);

  const hasUrl = isHttpUrl(url.trim());
  const isDirectFile = hasUrl && looksLikeDirectFile(url.trim());

  function handleSubmit(action?: 'grab' | 'download') {
    const trimmed = url.trim();
    if (!trimmed) return;
    const finalAction = action ?? (isDirectFile ? 'download' : 'grab');
    void api.pill.submit(trimmed, finalAction);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      void api.pill.hide();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handleSubmit(isDirectFile ? 'grab' : 'download');
      } else {
        handleSubmit();
      }
    }
  }

  return (
    <div className="grab-pill-container" onKeyDown={handleKeyDown}>
      <div className="grab-pill-bar">
        <div className="grab-pill-brand" title="gRabbit Floating Pill">
          <img src={iconUrl} alt="gRabbit" />
          <div className="grab-pill-glow" />
        </div>

        <div className="grab-pill-input-wrap">
          <input
            ref={inputRef}
            type="text"
            className="grab-pill-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('pill.placeholder')}
            autoFocus
            spellCheck={false}
          />
          {url ? (
            <button
              className="grab-pill-clear-btn"
              onClick={() => {
                setUrl('');
                inputRef.current?.focus();
              }}
              title={t('common.clear')}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        <div className="grab-pill-actions">
          <button
            className={`grab-pill-btn grab ${!isDirectFile && hasUrl ? 'primary' : ''}`}
            onClick={() => handleSubmit('grab')}
            disabled={!hasUrl}
            title={`${t('grab.button')} (Enter)`}
          >
            <Sparkles size={14} />
            <span>{t('grab.button')}</span>
          </button>

          <button
            className={`grab-pill-btn download ${isDirectFile ? 'primary' : ''}`}
            onClick={() => handleSubmit('download')}
            disabled={!hasUrl}
            title={`${t('dl.add')} (Shift+Enter)`}
          >
            <ArrowDownToLine size={14} />
            <span>{t('dl.add')}</span>
          </button>

          <button
            className="grab-pill-close-btn"
            onClick={() => void api.pill.hide()}
            title={t('common.close')}
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

