import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AudioLines, CircleAlert, Download, ExternalLink, FileAudio, Link, LoaderCircle, Search, X } from 'lucide-react';
import type { RecognizedTrack } from '../../../shared/types';
import { errorText, useI18n } from '../i18n';
import { api, useApp } from '../state';
import { isHttpUrl } from '../format';
import { Thumb } from '../components/ui';

const HISTORY_KEY = 'grabbit.recognize.history';
const HISTORY_MAX = 12;

function loadHistory(): RecognizedTrack[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(items: RecognizedTrack[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    // storage unavailable: history is a convenience only
  }
}

function spotifyWebUrl(uri?: string): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith('https://')) return uri;
  const m = /^spotify:(track|search):(.+)$/.exec(uri);
  if (!m) return undefined;
  return m[1] === 'track' ? `https://open.spotify.com/track/${m[2]}` : `https://open.spotify.com/search/${encodeURIComponent(decodeURIComponent(m[2]))}`;
}

export function RecognizeView({ onFindAndDownload }: { onFindAndDownload(query: string): void }) {
  const { t } = useI18n();
  const { toast } = useApp();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecognizedTrack | null>(null);
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState<RecognizedTrack[]>(loadHistory);
  const [historyQuery, setHistoryQuery] = useState('');
  const [grabbingKey, setGrabbingKey] = useState<string | null>(null);

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) =>
        h.title.toLowerCase().includes(q) ||
        h.artist.toLowerCase().includes(q) ||
        (h.album?.toLowerCase().includes(q) ?? false) ||
        (h.genre?.toLowerCase().includes(q) ?? false)
    );
  }, [history, historyQuery]);

  async function quickGrabAudio(track: RecognizedTrack) {
    const key = `${track.artist}-${track.title}`;
    if (grabbingKey) return;
    setGrabbingKey(key);
    try {
      const searchQuery = `${track.artist} - ${track.title}`;
      const matches = await api.media.search(searchQuery, 1);
      const top = matches[0];
      if (!top) {
        onFindAndDownload(searchQuery);
        return;
      }
      const added = await api.downloads.addMedia([
        {
          url: top.url,
          platform: top.platform,
          mediaId: top.id,
          format: 'audio',
          qualityId: 'mp3',
          title: searchQuery,
          author: track.artist,
          thumbnailUrl: track.coverArtUrl ?? top.thumbnailUrl,
          durationSeconds: top.durationSeconds,
        },
      ]);
      toast(t('grab.added', { count: added.length }), 'success');
    } catch (err) {
      toast(errorText(t, err), 'error');
    } finally {
      setGrabbingKey((prev) => (prev === key ? null : prev));
    }
  }

  async function identify(job: () => Promise<RecognizedTrack | null>) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const track = await job();
      if (!track) {
        setError(t('rec.noMatch'));
        return;
      }
      setResult(track);
      const next = [track, ...history.filter((h) => !(h.title === track.title && h.artist === track.artist))];
      setHistory(next);
      saveHistory(next);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      const path = api.app.getPathForFile(file);
      if (path) void identify(() => api.recognize.file(path));
      return;
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (isHttpUrl(text)) void identify(() => api.recognize.url(text.trim()));
  }

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div>
            <h1>{t('rec.title')}</h1>
            <p>{t('rec.subtitle')}</p>
          </div>
        </div>

        <div
          className={`dropzone ${over ? 'over' : ''} ${busy ? 'busy' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <div className="icon-circle">{busy ? <AudioLines size={32} /> : <FileAudio size={32} />}</div>
          <b style={{ fontSize: 15 }}>{busy ? t('rec.listening') : t('rec.drop')}</b>
          {!busy && (
            <>
              <span className="muted small">{t('rec.or')}</span>
              <button
                className="btn primary"
                onClick={async () => {
                  const path = await api.settings.chooseFile([
                    { name: 'Audio / Video', extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma', 'mp4', 'mkv', 'webm', 'mov', 'avi', 'oga', '3gp'] },
                  ]);
                  if (path) void identify(() => api.recognize.file(path));
                }}
              >
                {t('rec.choose')}
              </button>
            </>
          )}
          {busy && <LoaderCircle className="spin" size={20} color="var(--accent)" />}
        </div>

        <form
          className="row"
          style={{ marginTop: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (isHttpUrl(url)) void identify(() => api.recognize.url(url.trim()));
          }}
        >
          <div className="input-with-icon grow">
            <Link size={15} />
            <input className="input" value={url} placeholder={t('rec.urlPlaceholder')} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
          </div>
          <button className="btn" type="submit" disabled={busy || !isHttpUrl(url)}>
            {t('rec.identify')}
          </button>
        </form>

        <AnimatePresence>
          {error && (
            <motion.div
              className="banner error"
              style={{ marginTop: 16 }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <CircleAlert size={17} />
              <span className="grow">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {result && (
            <SongCard
              key={`${result.artist}-${result.title}`}
              track={result}
              grabbing={grabbingKey === `${result.artist}-${result.title}`}
              onFindAndDownload={onFindAndDownload}
              onGrabAudio={(track) => void quickGrabAudio(track)}
            />
          )}
        </AnimatePresence>

        {history.length > 0 && (
          <div className="history">
            <div className="row" style={{ gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <b className="grow">{t('rec.history')}</b>
              <div className="input-with-icon" style={{ width: 210 }}>
                <Search size={14} />
                <input
                  className="input"
                  style={{ height: 30, fontSize: 12.5, paddingInlineEnd: historyQuery ? 26 : 10 }}
                  value={historyQuery}
                  placeholder={t('rec.searchHistory')}
                  onChange={(e) => setHistoryQuery(e.target.value)}
                />
                {historyQuery && (
                  <button
                    type="button"
                    className="input-clear-btn"
                    title={t('common.clear')}
                    onClick={() => setHistoryQuery('')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <button
                className="btn ghost sm"
                onClick={() => {
                  setHistory([]);
                  setHistoryQuery('');
                  saveHistory([]);
                }}
              >
                {t('rec.clear')}
              </button>
            </div>
            {filteredHistory.length === 0 ? (
              <div className="small muted" style={{ padding: '12px 4px' }}>
                {t('grab.noResults')}
              </div>
            ) : (
              filteredHistory.map((h, i) => {
                const trackKey = `${h.artist}-${h.title}`;
                const isGrabbing = grabbingKey === trackKey;
                return (
                  <motion.div
                    key={`${h.title}-${i}`}
                    className="history-item"
                    onClick={() => setResult(h)}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ x: 2 }}
                    transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.2) }}
                  >
                    {h.coverArtUrl ? <img src={h.coverArtUrl} alt="" referrerPolicy="no-referrer" /> : <div className="ph" />}
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis" style={{ fontWeight: 600 }}>
                        {h.title}
                      </div>
                      <div className="small muted ellipsis">
                        {h.artist}
                        {h.album ? ` · ${h.album}` : ''}
                      </div>
                    </div>
                    <button
                      className="btn sm"
                      disabled={isGrabbing}
                      title={t('rec.grabAudio')}
                      onClick={(e) => {
                        e.stopPropagation();
                        void quickGrabAudio(h);
                      }}
                    >
                      {isGrabbing ? <LoaderCircle size={13} className="spin" /> : <AudioLines size={13} />}
                      <span>{t('rec.grabAudio')}</span>
                    </button>
                    <button
                      className="btn ghost sm icon"
                      title={t('rec.download')}
                      onClick={(e) => {
                        e.stopPropagation();
                        onFindAndDownload(`${h.artist} - ${h.title}`);
                      }}
                    >
                      <Download size={15} />
                    </button>
                  </motion.div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SongCard({
  track,
  grabbing,
  onFindAndDownload,
  onGrabAudio,
}: {
  track: RecognizedTrack;
  grabbing: boolean;
  onFindAndDownload(query: string): void;
  onGrabAudio(track: RecognizedTrack): void;
}) {
  const { t } = useI18n();
  const spotify = spotifyWebUrl(track.spotifyUri);
  const facts: [string, string | undefined][] = [
    [t('rec.album'), track.album],
    [t('rec.released'), track.releaseYear],
    [t('rec.genre'), track.genre],
    [t('rec.label'), track.label],
  ];
  return (
    <motion.div
      className="card song-card"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <Thumb src={track.coverArtUrl} square />
      <div>
        <h2>{track.title}</h2>
        <div className="artist">{track.artist}</div>
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <dl className="kv" key={k} style={{ margin: '4px 0' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </dl>
          ))}
        <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={grabbing} onClick={() => onGrabAudio(track)}>
            {grabbing ? <LoaderCircle size={15} className="spin" /> : <AudioLines size={15} />} {t('rec.grabAudio')}
          </button>
          <button className="btn" onClick={() => onFindAndDownload(`${track.artist} - ${track.title}`)}>
            <Download size={15} /> {t('rec.download')}
          </button>
          {track.shazamUrl && (
            <button className="btn" onClick={() => void api.app.openExternal(track.shazamUrl!)}>
              <ExternalLink size={14} /> {t('rec.shazam')}
            </button>
          )}
          {track.appleMusicUrl && (
            <button className="btn" onClick={() => void api.app.openExternal(track.appleMusicUrl!)}>
              <ExternalLink size={14} /> {t('rec.apple')}
            </button>
          )}
          {spotify && (
            <button className="btn" onClick={() => void api.app.openExternal(spotify)}>
              <ExternalLink size={14} /> {t('rec.spotify')}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
