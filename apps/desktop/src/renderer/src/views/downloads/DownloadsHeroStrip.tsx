import { useEffect, useState } from 'react';
import { Activity, HardDriveDownload } from 'lucide-react';
import { useI18n, type MessageKey } from '../../i18n';
import { type DownloadSummary, formatBytes, formatPercent, formatSpeed } from '../../format';
import { useDownloadsAggregate } from '../../downloads-store';
import { ProgressBar } from '../../components/ui';
import { Sparkline } from '../../components/Sparkline';
import type { StatusFilter } from './model';

const HISTORY_LIMIT = 24;

interface BreakdownFilter {
  key: Exclude<StatusFilter, 'all'>;
  labelKey: MessageKey;
  count: number;
  tone: 'accent' | 'warning' | 'success' | 'danger';
}

/** Live throughput, overall progress, and clickable status overview tiles for the Downloads header. */
export function DownloadsHeroStrip({
  summary,
  counts,
  filter,
  onFilter,
}: {
  summary: DownloadSummary;
  counts: Record<StatusFilter, number>;
  filter: StatusFilter;
  onFilter(next: StatusFilter): void;
}) {
  const { t, language } = useI18n();
  const aggregate = useDownloadsAggregate();
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);

  const isLive = aggregate.active > 0 || summary.active > 0;
  const activeCount = Math.max(aggregate.active, summary.active);
  const currentSpeed = isLive ? aggregate.speed : 0;

  useEffect(() => {
    if (!isLive) {
      setSpeedHistory((prev) => (prev.length === 0 || prev[prev.length - 1] === 0 ? prev : [...prev.slice(-(HISTORY_LIMIT - 1)), 0]));
      return;
    }
    setSpeedHistory((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), aggregate.speed]);
    const timer = setInterval(() => {
      setSpeedHistory((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), aggregate.speed]);
    }, 1000);
    return () => clearInterval(timer);
  }, [isLive, aggregate.speed]);

  const progressFraction =
    aggregate.percent !== null && isLive
      ? Math.max(0, Math.min(1, aggregate.percent / 100))
      : summary.overallProgress;

  const breakdown: BreakdownFilter[] = [
    { key: 'active', labelKey: 'filter.active', count: counts.active, tone: 'accent' },
    { key: 'queued', labelKey: 'filter.queued', count: counts.queued, tone: 'warning' },
    { key: 'completed', labelKey: 'filter.completed', count: counts.completed, tone: 'success' },
    { key: 'failed', labelKey: 'filter.failed', count: counts.failed, tone: 'danger' },
  ];

  return (
    <div className="dl-hero-strip">
      <div className={`dl-hero-card throughput ${isLive ? 'is-live' : ''}`}>
        <div className="dl-hero-top">
          <span className="dl-hero-label">
            <span className={`live-stat-dot ${isLive ? 'pulsing' : ''}`} />
            {t('dl.summary.throughput')}
          </span>
          <span className={`dl-hero-badge ${isLive ? 'accent' : ''}`}>
            {t('dl.active', { count: activeCount })}
          </span>
        </div>
        <div className="dl-hero-main">
          <div className="dl-hero-value">{formatSpeed(currentSpeed, language) || '0 B/s'}</div>
          <Sparkline
            data={speedHistory}
            width={88}
            height={24}
            stroke={isLive ? 'var(--accent)' : 'var(--border-strong)'}
            fill={isLive ? 'var(--accent-soft)' : 'transparent'}
          />
        </div>
      </div>

      <div className="dl-hero-card">
        <div className="dl-hero-top">
          <span className="dl-hero-label">
            <HardDriveDownload size={13} />
            {progressFraction !== null ? t('dl.summary.overall') : t('dl.summary.downloaded')}
          </span>
          {progressFraction !== null && (
            <span className="dl-hero-badge">{formatPercent(progressFraction, language)}</span>
          )}
        </div>
        <div className="dl-hero-size-row">
          <b className="dl-hero-value-sm">{formatBytes(summary.receivedBytes, language)}</b>
          {summary.totalBytes > 0 && (
            <span className="small muted">/ {formatBytes(summary.totalBytes, language)}</span>
          )}
        </div>
        {progressFraction !== null && (
          <ProgressBar
            value={progressFraction * 100}
            state={counts.active === 0 && progressFraction >= 1 ? 'done' : undefined}
          />
        )}
      </div>

      <div className="dl-hero-card breakdown">
        <div className="dl-hero-top">
          <span className="dl-hero-label">
            <Activity size={13} />
            {t('dl.group.status')}
          </span>
          <span className="small muted">{t('queue.items', { count: summary.total })}</span>
        </div>
        <div className="dl-breakdown-grid">
          {breakdown.map((b) => {
            const active = filter === b.key;
            return (
              <button
                key={b.key}
                type="button"
                className={`dl-breakdown-pill ${b.tone} ${active ? 'active' : ''}`}
                onClick={() => onFilter(active ? 'all' : b.key)}
              >
                <span className="dl-breakdown-dot" />
                <span className="dl-breakdown-name">{t(b.labelKey)}</span>
                <b className="dl-breakdown-num">{b.count}</b>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
