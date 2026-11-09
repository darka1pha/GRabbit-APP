import { useState } from 'react';
import { AudioLines, CircleAlert, Download, ExternalLink, FileAudio, Link, LoaderCircle } from 'lucide-react';
import type { RecognizedTrack } from '../../../shared/types';
import { errorText, useI18n } from '../i18n';
import { api } from '../state';
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
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecognizedTrack | null>(null);
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState<RecognizedTrack[]>(loadHistory);

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

        {error && (
          <div className="banner error" style={{ marginTop: 16 }}>
            <CircleAlert size={17} />
            <span className="grow">{error}</span>
          </div>
        )}

        {result && <SongCard track={result} onFindAndDownload={onFindAndDownload} />}

        {history.length > 0 && (
          <div className="history">
            <div className="row">
              <b className="grow">{t('rec.history')}</b>
              <button
                className="btn ghost sm"
                onClick={() => {
                  setHistory([]);
                  saveHistory([]);
                }}
              >
                {t('rec.clear')}
              </button>
            </div>
            {history.map((h, i) => (
              <div key={`${h.title}-${i}`} className="history-item" onClick={() => setResult(h)}>
                {h.coverArtUrl ? <img src={h.coverArtUrl} alt="" referrerPolicy="no-referrer" /> : <div className="ph" />}
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 600 }}>
                    {h.title}
                  </div>
                  <div className="small muted ellipsis">{h.artist}</div>
                </div>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SongCard({ track, onFindAndDownload }: { track: RecognizedTrack; onFindAndDownload(query: string): void }) {
  const { t } = useI18n();
  const spotify = spotifyWebUrl(track.spotifyUri);
  const facts: [string, string | undefined][] = [
    [t('rec.album'), track.album],
    [t('rec.released'), track.releaseYear],
    [t('rec.genre'), track.genre],
    [t('rec.label'), track.label],
  ];
  return (
    <div className="card song-card">
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
          <button className="btn primary" onClick={() => onFindAndDownload(`${track.artist} - ${track.title}`)}>
            <Download size={16} /> {t('rec.download')}
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
    </div>
  );
}
