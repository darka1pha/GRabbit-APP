import { useEffect, useState } from 'react';
import { Download, Maximize2, Pause, Play } from 'lucide-react';
import { useI18n } from '../i18n';
import { api, useApp } from '../state';
import { useDownloadsAggregate } from '../downloads-store';
import { formatSpeed } from '../format';
import { ProgressBar } from './ui';
import { Sparkline } from './Sparkline';
import iconUrl from '../assets/icon.png';

export function MiniWidget({ onExpand }: { onExpand: () => void }) {
  const { t, language } = useI18n();
  const { active, speed, percent } = useDownloadsAggregate();
  const { downloads } = useApp();
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);

  useEffect(() => {
    setSpeedHistory((prev) => {
      const next = [...prev, speed];
      return next.slice(-25);
    });
  }, [speed]);

  const anyActive = active > 0;
  const anyPaused = downloads.some((d) => d.status === 'paused' || d.status === 'queued');

  return (
    <div className="mini-widget">
      <div className="mini-widget-head">
        <div className="mini-widget-brand">
          <img src={iconUrl} alt="GRabbit" width={18} height={18} />
          <span className="mini-widget-title">GRabbit</span>
          <span className="mini-widget-badge">
            {active > 0 ? t('dl.active', { count: active }) : t('status.idle')}
          </span>
        </div>
        <div className="mini-widget-actions">
          <button
            className="btn ghost sm icon"
            onClick={onExpand}
            title={t('common.maximize') ?? 'Expand Window'}
            aria-label="Expand Window"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div className="mini-widget-body">
        <div className="mini-widget-speed-row">
          <div className="mini-widget-speed-text">
            <span className="mini-widget-speed-val">{formatSpeed(speed, language) || '0 B/s'}</span>
            {percent !== null && percent >= 0 && (
              <span className="mini-widget-percent">{percent}%</span>
            )}
          </div>
          <div className="mini-widget-sparkline">
            <Sparkline data={speedHistory} width={100} height={22} />
          </div>
        </div>

        <div className="mini-widget-progress">
          <ProgressBar value={percent ?? 0} indeterminate={anyActive && (percent === null || percent === 0)} />
        </div>

        <div className="mini-widget-controls">
          {anyActive ? (
            <button
              className="btn sm"
              onClick={() => void api.downloads.pauseAll()}
              title={t('dl.pauseAll')}
            >
              <Pause size={12} /> {t('dl.pauseAll')}
            </button>
          ) : (
            <button
              className="btn sm primary"
              onClick={() => void api.downloads.resumeAll()}
              title={t('dl.resumeAll')}
              disabled={!anyPaused}
            >
              <Play size={12} /> {t('dl.resumeAll')}
            </button>
          )}
          <button
            className="btn ghost sm"
            onClick={() => {
              onExpand();
            }}
          >
            <Download size={12} /> {t('nav.downloads')}
          </button>
        </div>
      </div>
    </div>
  );
}

