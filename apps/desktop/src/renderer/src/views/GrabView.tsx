import { useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  CircleAlert,
  Clipboard,
  Download,
  Film,
  FolderOpen,
  Info,
  LoaderCircle,
  ListMusic,
  Search,
  Sparkles,
  Music,
  Zap,
} from 'lucide-react';
import type { AddMediaDownloadRequest, ClipboardLink, MediaItem, MediaOption, PlatformMetadata } from '../../../shared/types';
import { errorText, useI18n } from '../i18n';
import { api, useApp } from '../state';
import { formatBytes, formatDuration, isHttpUrl, looksLikeDirectFile } from '../format';
import { Thumb } from '../components/ui';

const PLATFORM_LABELS = ['YouTube', 'YouTube Music', 'Spotify', 'Instagram', 'SoundCloud', 'TikTok', 'X', 'Reddit', 'Vimeo', 'Facebook', 'Twitch', '+1000'];

type ViewState =
  | { kind: 'idle' }
  | { kind: 'loading'; text: string }
  | { kind: 'error'; message: string; url?: string }
  | { kind: 'media'; meta: PlatformMetadata }
  | { kind: 'search'; query: string; items: MediaItem[] };

function toRequest(item: MediaItem, option: MediaOption, directory?: string): AddMediaDownloadRequest {
  return {
    url: item.url,
    platform: item.platform,
    mediaId: item.id,
    format: option.format,
    qualityId: option.qualityId,
    title: item.uploader && item.platform === 'spotify' ? `${item.uploader} - ${item.title}` : item.title,
    author: item.uploader,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds: item.durationSeconds,
    estimatedSizeBytes: option.estimatedSizeBytes,
    directory,
  };
}

export function GrabView({
  pendingInput,
  clipboardLink,
  onConsumePending,
  onOpenAddDialog,
  onAdded,
}: {
  pendingInput: string | null;
  clipboardLink: ClipboardLink | null;
  onConsumePending(): void;
  onOpenAddDialog(url: string): void;
  onAdded(): void;
}) {
  const { t } = useI18n();
  const { toast } = useApp();
  const [input, setInput] = useState('');
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const [directory, setDirectory] = useState<string | undefined>();

  async function submit(value = input) {
    const text = value.trim();
    if (!text) return;
    setInput(text);
    if (isHttpUrl(text)) {
      if (looksLikeDirectFile(text)) {
        onOpenAddDialog(text);
        return;
      }
      setState({ kind: 'loading', text: t('grab.resolving') });
      try {
        const meta = await api.media.resolve(text);
        if (meta.items.length === 0) setState({ kind: 'error', message: t('grab.notMedia'), url: text });
        else setState({ kind: 'media', meta });
      } catch (err) {
        setState({ kind: 'error', message: errorText(t, err), url: text });
      }
    } else {
      setState({ kind: 'loading', text: t('grab.searching') });
      try {
        setState({ kind: 'search', query: text, items: await api.media.search(text, 20) });
      } catch (err) {
        setState({ kind: 'error', message: errorText(t, err) });
      }
    }
  }

  // Links / queries handed over from other views or the tray
  useEffect(() => {
    if (pendingInput) {
      onConsumePending();
      void submit(pendingInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInput]);

  async function add(requests: AddMediaDownloadRequest[]) {
    try {
      const added = await api.downloads.addMedia(requests);
      toast(t('grab.added', { count: added.length }), 'success', { label: t('nav.downloads'), run: onAdded });
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  }

  const showClipboard = clipboardLink && clipboardLink.url !== input && state.kind !== 'loading';

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="hero">
          <h1>{t('grab.title')}</h1>
          <p>{t('grab.subtitle')}</p>
          <form
            className="grab-bar"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <button
              type="button"
              className="btn ghost icon"
              title={t('grab.paste')}
              onClick={async () => {
                const text = (await navigator.clipboard.readText().catch(() => '')).trim();
                if (text) void submit(text);
              }}
            >
              <Clipboard size={17} />
            </button>
            <input value={input} placeholder={t('grab.placeholder')} onChange={(e) => setInput(e.target.value)} autoFocus spellCheck={false} />
            <button className="btn primary lg" type="submit" disabled={!input.trim() || state.kind === 'loading'}>
              {isHttpUrl(input) || !input.trim() ? <Download size={17} /> : <Search size={17} />}
              {isHttpUrl(input) || !input.trim() ? t('grab.button') : t('grab.search')}
            </button>
          </form>
          <div className="platforms">
            {PLATFORM_LABELS.map((p) => (
              <span key={p} className="platform-chip">
                {p}
              </span>
            ))}
          </div>
          {showClipboard && (
            <div className="banner">
              <Sparkles size={17} color="var(--accent)" />
              <div className="grow">
                <b>{t('grab.clipboardDetected')}</b>
                <div className="small ellipsis mono">{clipboardLink.url}</div>
              </div>
              <button
                className="btn sm primary"
                onClick={() => (clipboardLink.kind === 'file' ? onOpenAddDialog(clipboardLink.url) : void submit(clipboardLink.url))}
              >
                {t('grab.useIt')}
              </button>
            </div>
          )}
        </div>

        {state.kind === 'loading' && (
          <div className="empty">
            <LoaderCircle size={30} className="spin" color="var(--accent)" />
            <p>{state.text}</p>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="banner error" style={{ marginTop: 18 }}>
            <CircleAlert size={18} />
            <div className="grow">{state.message}</div>
            {state.url && (
              <button className="btn sm" onClick={() => onOpenAddDialog(state.url!)}>
                <Download size={14} /> {t('grab.asFile')}
              </button>
            )}
          </div>
        )}

        {state.kind === 'media' && !state.meta.isCollection && (
          <SingleMedia
            item={state.meta.items[0]}
            directory={directory}
            onDirectory={setDirectory}
            onDownload={(item, option) => void add([toRequest(item, option, directory)])}
          />
        )}

        {state.kind === 'media' && state.meta.isCollection && (
          <Collection meta={state.meta} onDownload={(requests) => void add(requests)} />
        )}

        {state.kind === 'search' && (
          <SearchResults
            query={state.query}
            items={state.items}
            onQuick={(item, format) => void quickAdd(item, format)}
            onMore={(item) => void submit(item.url)}
          />
        )}

        {state.kind === 'idle' && (
          <div className="tips">
            <div className="card tip">
              <Clipboard size={18} />
              <span>{t('grab.hint1')}</span>
            </div>
            <div className="card tip">
              <Music size={18} />
              <span>{t('grab.hint2')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  async function quickAdd(item: MediaItem, format: 'audio' | 'video') {
    const s = await api.settings.get();
    const option: MediaOption =
      format === 'audio'
        ? { format: 'audio', qualityId: s.media.defaultAudioFormat, label: '', extension: s.media.defaultAudioFormat }
        : { format: 'video', qualityId: s.media.defaultVideoQuality, label: '', extension: 'mp4' };
    await add([toRequest(item, option)]);
  }
}

function OptionTile({ option, selected, onSelect }: { option: MediaOption; selected: boolean; onSelect(): void }) {
  const { t, language } = useI18n();
  return (
    <button className={`option ${selected ? 'selected' : ''}`} onClick={onSelect} onDoubleClick={onSelect}>
      <b>
        {option.label}
        {option.isOriginalQuality && <span className="badge accent">{t('grab.originalQuality')}</span>}
      </b>
      <span>{option.estimatedSizeBytes ? `~${formatBytes(option.estimatedSizeBytes, language)}` : option.extension.toUpperCase()}</span>
    </button>
  );
}

function SingleMedia({
  item,
  directory,
  onDirectory,
  onDownload,
}: {
  item: MediaItem;
  directory?: string;
  onDirectory(dir: string | undefined): void;
  onDownload(item: MediaItem, option: MediaOption): void;
}) {
  const { t, language } = useI18n();
  const { settings } = useApp();
  const audio = item.availableOptions.filter((o) => o.format === 'audio');
  const video = item.availableOptions.filter((o) => o.format === 'video');

  const preferred = useMemo(() => {
    const wantAudio = settings?.media.defaultAudioFormat ?? 'mp3';
    const wantVideo = settings?.media.defaultVideoQuality ?? '1080p';
    return (
      video.find((o) => o.qualityId === wantVideo) ??
      video.find((o) => parseInt(o.qualityId, 10) <= parseInt(wantVideo, 10)) ??
      video[0] ??
      audio.find((o) => o.qualityId === wantAudio || (wantAudio === 'mp3' && o.qualityId.startsWith('mp3'))) ??
      audio[0]
    );
  }, [item, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const [choice, setChoice] = useState<MediaOption | undefined>(preferred);
  useEffect(() => setChoice(preferred), [preferred]);

  return (
    <div className="card media-card">
      <div className="thumb-wrap">
        <Thumb src={item.thumbnailUrl} square={item.platform === 'spotify' || item.platform === 'soundcloud'} />
        {item.durationSeconds ? <span className="duration">{formatDuration(item.durationSeconds, language)}</span> : null}
      </div>
      <div>
        <h2>{item.title}</h2>
        {item.uploader && <div className="muted">{item.uploader}</div>}
        {!item.isDownloadable ? (
          <div className="banner error">
            <CircleAlert size={17} />
            <span className="grow">{item.unavailableReason ?? t('grab.unavailable')}</span>
          </div>
        ) : (
          <>
            {audio.length > 0 && (
              <div className="option-group">
                <h4>
                  <AudioLines size={14} /> {t('grab.audio')}
                </h4>
                <div className="options">
                  {audio.map((o) => (
                    <OptionTile key={o.qualityId} option={o} selected={choice === o} onSelect={() => setChoice(o)} />
                  ))}
                </div>
              </div>
            )}
            {video.length > 0 && (
              <div className="option-group">
                <h4>
                  <Film size={14} /> {t('grab.video')}
                </h4>
                <div className="options">
                  {video.map((o) => (
                    <OptionTile key={o.qualityId} option={o} selected={choice === o} onSelect={() => setChoice(o)} />
                  ))}
                </div>
              </div>
            )}
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn primary lg" disabled={!choice} onClick={() => choice && onDownload(item, choice)}>
                <Download size={17} /> {t('grab.download')}
              </button>
              <button
                className="btn ghost sm"
                title={directory ?? t('grab.default')}
                onClick={async () => {
                  const dir = await api.settings.chooseDirectory(directory);
                  onDirectory(dir ?? undefined);
                }}
              >
                <FolderOpen size={14} />
                <span className="ellipsis" style={{ maxWidth: 260 }}>
                  {t('grab.saveTo')}: {directory ?? t('grab.default')}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Collection({ meta, onDownload }: { meta: PlatformMetadata; onDownload(requests: AddMediaDownloadRequest[]): void }) {
  const { t, language } = useI18n();
  const { settings } = useApp();
  const downloadable = meta.items.filter((i) => i.isDownloadable);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(downloadable.map((i) => i.id)));
  const audioOnly = meta.items.every((i) => i.availableOptions.every((o) => o.format === 'audio'));
  const [format, setFormat] = useState<string>(audioOnly ? (settings?.media.defaultAudioFormat ?? 'mp3') : 'audio:mp3');

  useEffect(() => setSelected(new Set(meta.items.filter((i) => i.isDownloadable).map((i) => i.id))), [meta]);

  const formatChoices: { value: string; label: string }[] = audioOnly
    ? [
        { value: 'mp3', label: 'MP3' },
        { value: 'm4a', label: 'M4A' },
      ]
    : [
        { value: 'audio:mp3', label: `${t('grab.audio')} MP3` },
        { value: 'audio:m4a', label: `${t('grab.audio')} M4A` },
        ...['2160p', '1440p', '1080p', '720p', '480p', '360p'].map((q) => ({ value: `video:${q}`, label: `${t('grab.video')} ${q}` })),
      ];

  function optionFor(): MediaOption {
    const [kind, quality] = audioOnly ? ['audio', format] : format.split(':');
    return kind === 'audio'
      ? { format: 'audio', qualityId: quality, label: '', extension: quality }
      : { format: 'video', qualityId: quality, label: '', extension: 'mp4' };
  }

  return (
    <div className="card card-pad" style={{ marginTop: 18 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div style={{ width: 96, flexShrink: 0 }}>
          <Thumb src={meta.thumbnailUrl ?? meta.items[0]?.thumbnailUrl} square />
        </div>
        <div className="grow">
          <div className="row small muted">
            <ListMusic size={14} /> {t('grab.tracks', { count: meta.items.length })}
          </div>
          <h2 style={{ margin: '2px 0', fontSize: 19 }} className="selectable">
            {meta.title}
          </h2>
          {meta.artistOrAuthor && <div className="muted">{meta.artistOrAuthor}</div>}
        </div>
      </div>

      {meta.truncated && (
        <div className="banner" style={{ marginTop: 14 }}>
          <Info size={17} color="var(--accent)" />
          <span className="grow small">{t('grab.truncated', { count: meta.items.length })}</span>
        </div>
      )}

      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => setSelected(new Set(downloadable.map((i) => i.id)))}>
          {t('grab.selectAll')}
        </button>
        <button className="btn sm" onClick={() => setSelected(new Set())}>
          {t('grab.selectNone')}
        </button>
        <div className="grow" />
        <span className="small muted">{t('grab.formatForAll')}</span>
        <select className="select" value={format} onChange={(e) => setFormat(e.target.value)}>
          {formatChoices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          disabled={selected.size === 0}
          onClick={() => {
            const option = optionFor();
            onDownload(meta.items.filter((i) => selected.has(i.id)).map((i) => toRequest(i, option)));
          }}
        >
          <Download size={16} /> {t('grab.downloadSelected', { count: selected.size })}
        </button>
      </div>

      <div className="track-list">
        {meta.items.map((item, index) => (
          <label key={`${item.id}-${index}`} className={`track ${item.isDownloadable ? '' : 'unavailable'}`}>
            <input
              type="checkbox"
              disabled={!item.isDownloadable}
              checked={selected.has(item.id)}
              onChange={(e) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(item.id);
                  else next.delete(item.id);
                  return next;
                })
              }
            />
            <span className="index">{index + 1}</span>
            <span className="ellipsis">
              <b style={{ fontWeight: 550 }}>{item.title}</b>
              {item.uploader && <span className="muted"> · {item.uploader}</span>}
            </span>
            <span className="small muted">{formatDuration(item.durationSeconds, language)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SearchResults({
  query,
  items,
  onQuick,
  onMore,
}: {
  query: string;
  items: MediaItem[];
  onQuick(item: MediaItem, format: 'audio' | 'video'): void;
  onMore(item: MediaItem): void;
}) {
  const { t, language } = useI18n();
  if (items.length === 0) {
    return (
      <div className="empty">
        <Search size={28} />
        <p>{t('grab.noResults')}</p>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 20 }}>
      <div className="small muted">{t('grab.results', { query })}</div>
      <div className="result-list">
        {items.map((item) => (
          <div key={item.id} className="result">
            <div className="thumb-wrap">
              <Thumb src={item.thumbnailUrl} />
              {item.durationSeconds ? <span className="duration">{formatDuration(item.durationSeconds, language)}</span> : null}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="title selectable">{item.title}</div>
              <div className="small muted ellipsis">{item.uploader}</div>
            </div>
            <div className="actions">
              <button className="btn sm" title={t('grab.audio')} onClick={() => onQuick(item, 'audio')}>
                <AudioLines size={14} /> {t('grab.audio')}
              </button>
              <button className="btn sm" title={t('grab.video')} onClick={() => onQuick(item, 'video')}>
                <Film size={14} /> {t('grab.video')}
              </button>
              <button className="btn sm ghost" onClick={() => onMore(item)}>
                <Zap size={14} /> {t('grab.more')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
