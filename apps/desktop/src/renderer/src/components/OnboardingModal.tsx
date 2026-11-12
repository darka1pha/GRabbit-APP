import { useState } from 'react';
import { Check, Copy, FolderOpen, Sparkles } from 'lucide-react';
import { useI18n, type MessageKey } from '../i18n';
import { api, useApp } from '../state';
import type { Language, Theme } from '../../../shared/types';
import iconUrl from '../assets/icon.png';

export function OnboardingModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { settings, updateSettings, toast } = useApp();
  const [downloadDir, setDownloadDir] = useState(settings?.downloadDir ?? '');
  const [theme, setTheme] = useState<Theme>(settings?.theme ?? 'system');
  const [language, setLanguage] = useState<Language>(settings?.language ?? 'en');
  const [copiedToken, setCopiedToken] = useState(false);

  const token = settings?.extension.token ?? '';

  async function handleBrowse() {
    const chosen = await api.settings.chooseDirectory(downloadDir);
    if (chosen) setDownloadDir(chosen);
  }

  function handleCopyToken() {
    if (!token) return;
    void navigator.clipboard.writeText(token);
    setCopiedToken(true);
    toast(t('dl.copied'), 'success');
    setTimeout(() => setCopiedToken(false), 2000);
  }

  async function handleComplete() {
    await updateSettings({
      downloadDir: downloadDir || settings?.downloadDir,
      theme,
      language,
      onboarded: true,
    });
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Welcome to GRabbit">
      <div className="modal onboarding-modal">
        <div className="onboarding-head">
          <img src={iconUrl} alt="GRabbit" width={48} height={48} className="onboarding-logo" />
          <h2>{t('onboarding.welcome') ?? 'Welcome to GRabbit!'}</h2>
          <p className="muted small">
            {t('onboarding.subtitle') ?? 'Let’s set up your preferred options to get you started.'}
          </p>
        </div>

        <div className="onboarding-body">
          {/* Step 1: Download Folder */}
          <div className="onboarding-section">
            <label className="onboarding-label">
              <FolderOpen size={16} /> {t('set.folder')}
            </label>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input ellipsis"
                value={downloadDir}
                readOnly
                title={downloadDir}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={handleBrowse}>
                {t('grab.change')}
              </button>
            </div>
          </div>

          {/* Step 2: Appearance & Language */}
          <div className="row" style={{ gap: 16 }}>
            <div className="onboarding-section" style={{ flex: 1 }}>
              <label className="onboarding-label">{t('set.theme')}</label>
              <div className="segmented" style={{ width: '100%' }}>
                {(['dark', 'light', 'system'] as Theme[]).map((m) => (
                  <button
                    key={m}
                    className={theme === m ? 'active' : ''}
                    onClick={() => setTheme(m)}
                    style={{ flex: 1 }}
                  >
                    {t(`set.theme.${m}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="onboarding-section" style={{ flex: 1 }}>
              <label className="onboarding-label">{t('set.language')}</label>
              <div className="segmented" style={{ width: '100%' }}>
                <button
                  className={language === 'en' ? 'active' : ''}
                  onClick={() => setLanguage('en')}
                  style={{ flex: 1 }}
                >
                  English
                </button>
                <button
                  className={language === 'fa' ? 'active' : ''}
                  onClick={() => setLanguage('fa')}
                  style={{ flex: 1 }}
                >
                  فارسی
                </button>
              </div>
            </div>
          </div>

          {/* Step 3: Browser Extension Pairing */}
          <div className="onboarding-section extension-card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="onboarding-label" style={{ margin: 0 }}>
                <Sparkles size={16} /> {t('set.extension')}
              </label>
              <span className="badge success">Port :{settings?.extension.port ?? 31542}</span>
            </div>
            <p className="small muted" style={{ margin: '6px 0 10px' }}>
              {t('onboarding.extensionDesc') ??
                'Pair the GRabbit browser extension to intercept downloads and grab media directly from your browser.'}
            </p>
            <div className="row" style={{ gap: 8 }}>
              <input className="input mono small" value={token} readOnly style={{ flex: 1 }} />
              <button className="btn sm" onClick={handleCopyToken}>
                {copiedToken ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedToken ? t('dl.copied') : t('common.copy')}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="modal-foot onboarding-foot">
          <button className="btn primary lg" onClick={handleComplete} style={{ width: '100%' }}>
            {t('onboarding.getStarted') ?? 'Get Started'}
          </button>
        </div>
      </div>
    </div>
  );
}
