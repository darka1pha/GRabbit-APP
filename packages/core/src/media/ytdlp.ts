/**
 * yt-dlp and YouTube InnerTube logic shared by the desktop app and the Telegram bot: result types,
 * command-line arguments, output parsing, error classification and the fast search paths.
 *
 * Each app keeps its own process runner (binary location, config, logging, error classes), so this
 * module has no Node imports: it only needs global `fetch`. Import it from
 * `@grabbit/core/media/ytdlp`.
 */

export interface YtDlpFormat {
  format_id?: string;
  format_note?: string;
  ext?: string;
  height?: number;
  width?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
}

export interface YtDlpMetadata {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  filesize?: number;
  filesize_approx?: number;
  is_live?: boolean;
  formats?: YtDlpFormat[];
  extractor_key?: string;
  webpage_url?: string;
  [key: string]: unknown;
}

export interface YtDlpSearchResult {
  id: string;
  title: string;
  url: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  /** 'youtube-music' for YouTube Music "Songs" results (official label uploads). */
  source?: 'youtube' | 'youtube-music';
}

/** Byte-level progress from the desktop's --progress-template. */
export interface YtDlpByteProgress {
  percent: number;
  downloadedBytes?: number;
  totalBytes?: number;
  /** Bytes per second */
  speed?: number;
  /** Seconds */
  eta?: number;
}

/** InnerTube search `params` for YouTube Music's "Songs" filter. */
export const YTM_SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

/** Prefix of the progress lines our --progress-template prints. */
export const PROGRESS_MARK = 'GRABBIT_PROGRESS|';

 
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, '');
}

function toNumber(text?: string): number | undefined {
  if (!text) return undefined;
  const n = Number(text.trim());
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** "1:02:03" / "3:19" / "45" -> seconds. */
export function parseDurationText(text?: string): number | undefined {
  if (!text) return undefined;
  const parts = text
    .trim()
    .split(':')
    .map((part) => parseInt(part, 10));
  if (parts.some((n) => isNaN(n))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

// ------------------------------------------------------------------ arguments

/** `--dump-json` for one item. */
export function metadataArgs(url: string, extraArgs: string[] = []): string[] {
  return ['--dump-json', '--no-playlist', '--no-warnings', ...extraArgs, '--', url];
}

/** `ytsearchN:` through yt-dlp (the slow path when InnerTube fails). */
export function searchArgs(query: string, limit: number, extraArgs: string[] = []): string[] {
  return ['--dump-json', '--flat-playlist', '--no-warnings', ...extraArgs, '--', `ytsearch${limit}:${query}`];
}

/** Playlist / album / set entries without resolving each one. */
export function playlistArgs(url: string, limit: number, extraArgs: string[] = []): string[] {
  return [
    '--dump-json',
    '--flat-playlist',
    '--yes-playlist',
    '--no-warnings',
    '--playlist-end',
    String(Math.max(1, limit)),
    ...extraArgs,
    '--',
    url,
  ];
}

// ------------------------------------------------------------------ output parsing

/** First JSON object in `--dump-json` output; throws when there is none. */
export function parseMetadataOutput(stdout: string): YtDlpMetadata {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith('{'));
  return JSON.parse(firstLine || stdout.trim()) as YtDlpMetadata;
}

/** Title and uploader of the playlist itself, from the first entry of a flat listing. */
export function parsePlaylistHeader(stdout: string): { title?: string; uploader?: string } {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return {
        title: (parsed.playlist_title || parsed.playlist) as string | undefined,
        uploader: (parsed.playlist_uploader || parsed.playlist_channel) as string | undefined,
      };
    } catch {
      // Malformed line: try the next one
    }
  }
  return {};
}

/** Parses `--flat-playlist --dump-json` output (one JSON object per line) into entries. */
export function parseFlatEntries(stdout: string, fallbackUrl?: (id: string) => string): YtDlpSearchResult[] {
  const results: YtDlpSearchResult[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as YtDlpMetadata & {
        url?: string;
        thumbnails?: Array<{ url?: string }>;
      };
      const id = parsed.id;
      if (!id) continue;

      const entryUrl =
        typeof parsed.webpage_url === 'string' && parsed.webpage_url.startsWith('http')
          ? parsed.webpage_url
          : typeof parsed.url === 'string' && parsed.url.startsWith('http')
            ? parsed.url
            : fallbackUrl?.(id);
      if (!entryUrl) continue;

      const thumb =
        parsed.thumbnail ||
        (Array.isArray(parsed.thumbnails) && parsed.thumbnails.length > 0
          ? parsed.thumbnails[parsed.thumbnails.length - 1]?.url
          : undefined);

      results.push({
        id,
        title: parsed.title || `#${results.length + 1}`,
        url: entryUrl,
        channel: parsed.channel || parsed.uploader || undefined,
        duration: typeof parsed.duration === 'number' ? parsed.duration : undefined,
        thumbnail: thumb,
      });
    } catch {
      // Ignore malformed line
    }
  }
  return results;
}

/** Parses one desktop progress line (percent|downloaded|total|estimate|speed|eta). */
export function parseProgressLine(line: string): YtDlpByteProgress | null {
  const clean = stripAnsi(line);
  const idx = clean.indexOf(PROGRESS_MARK);
  if (idx < 0) return null;
  const [percentStr, downloaded, total, estimate, speed, eta] = clean.substring(idx + PROGRESS_MARK.length).split('|');
  const downloadedBytes = toNumber(downloaded);
  const totalBytes = toNumber(total) ?? toNumber(estimate);
  let percent = parseFloat((percentStr || '').replace('%', '').trim());
  if (isNaN(percent) && downloadedBytes !== undefined && totalBytes) {
    percent = (downloadedBytes / totalBytes) * 100;
  }
  if (isNaN(percent)) return null;
  return { percent, downloadedBytes, totalBytes, speed: toNumber(speed), eta: toNumber(eta) };
}

// ------------------------------------------------------------------ errors

export type YtDlpErrorKind =
  | 'drm'
  | 'cookies-required'
  | 'unsupported-url'
  | 'auth-required'
  | 'unavailable'
  | 'other';

/** Last meaningful ERROR line from yt-dlp's stderr. */
export function lastErrorLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => stripAnsi(l).trim())
    .filter(Boolean);
  const err = [...lines].reverse().find((l) => l.startsWith('ERROR:'));
  return (err || lines[lines.length - 1] || 'unknown error').replace(/^ERROR:\s*/, '');
}

/** What went wrong, from yt-dlp's stderr. Each app maps the kind to its own error class. */
export function classifyYtDlpStderr(stderr: string): YtDlpErrorKind {
  const lower = stderr.toLowerCase();
  if (lower.includes('drm protected')) return 'drm';
  if (lower.includes('not a bot') || lower.includes('use --cookies') || lower.includes('cookies-from-browser')) {
    return 'cookies-required';
  }
  if (lower.includes('unsupported url')) return 'unsupported-url';
  if (
    lower.includes('private video') ||
    lower.includes('sign in') ||
    lower.includes('login') ||
    lower.includes('requires authentication') ||
    lower.includes('members-only') ||
    lower.includes('restricted') ||
    lower.includes('copyright')
  ) {
    return 'auth-required';
  }
  if (
    lower.includes('video unavailable') ||
    lower.includes('not available') ||
    lower.includes('not found') ||
    lower.includes('does not exist') ||
    lower.includes('removed') ||
    lower.includes('deleted') ||
    lower.includes('requested format is not available') ||
    lower.includes('http error 404')
  ) {
    return 'unavailable';
  }
  return 'other';
}

// ------------------------------------------------------------------ InnerTube search

type InnerTubeRun = {
  text?: string;
  navigationEndpoint?: {
    browseEndpoint?: {
      browseEndpointContextSupportedConfigs?: {
        browseEndpointContextMusicConfig?: { pageType?: string };
      };
    };
  };
};

/** Extracts song rows (video id, title, artists, duration) from a YouTube Music search response. */
export function parseYouTubeMusicSongs(data: unknown): YtDlpSearchResult[] {
  const results: YtDlpSearchResult[] = [];
   
  const tabs = (data as any)?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
  const sections = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

  for (const section of sections) {
    for (const item of section?.musicShelfRenderer?.contents ?? []) {
      const row = item?.musicResponsiveListItemRenderer;
      const id: string | undefined =
        row?.playlistItemData?.videoId ??
        row?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
          ?.watchEndpoint?.videoId;
      if (!id) continue;

      const columnRuns = (index: number): InnerTubeRun[] =>
        row?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];

      const title = columnRuns(0)
        .map((r) => r.text ?? '')
        .join('')
        .trim();
      if (!title) continue;

      // Second column: "Artist[, Artist] • Album • 3:19"
      const details = columnRuns(1);
      const artists = details
        .filter(
          (r) =>
            r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
              ?.pageType === 'MUSIC_PAGE_TYPE_ARTIST'
        )
        .map((r) => r.text ?? '')
        .filter(Boolean);
      const durationText = [...details].reverse().find((r) => /^\d+(:\d{2}){1,2}$/.test(r.text ?? ''));

      const thumbs = row?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
      results.push({
        id,
        title,
        url: `https://www.youtube.com/watch?v=${id}`,
        channel: artists.length > 0 ? artists.join(', ') : details[0]?.text,
        duration: parseDurationText(durationText?.text),
        thumbnail: Array.isArray(thumbs) ? thumbs[thumbs.length - 1]?.url : undefined,
        source: 'youtube-music',
      });
    }
  }
  return results;
}

/** Extracts video rows from a YouTube web search response. */
export function parseYouTubeVideoResults(data: unknown, limit: number): YtDlpSearchResult[] {
   
  const sections = (data as any)?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const results: YtDlpSearchResult[] = [];
  for (const sec of sections) {
    for (const item of sec?.itemSectionRenderer?.contents || []) {
      const v = item?.videoRenderer;
      if (!v?.videoId) continue;
      const title = Array.isArray(v.title?.runs)
        ? v.title.runs.map((r: { text: string }) => r.text).join('')
        : v.title?.simpleText || 'YouTube Media';
      const channel =
        v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || undefined;
      const thumbs = v.thumbnail?.thumbnails;
      results.push({
        id: v.videoId,
        title,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        channel,
        duration: parseDurationText(v.lengthText?.simpleText),
        thumbnail: Array.isArray(thumbs) && thumbs.length > 0 ? thumbs[thumbs.length - 1]?.url : undefined,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

/**
 * Fast (~250 ms) YouTube search through the web client's InnerTube API. Returns [] on any
 * failure, so callers can fall back to `yt-dlp ytsearch`.
 */
export async function searchYouTubeInnerTube(query: string, limit: number, timeoutMs = 5000): Promise<YtDlpSearchResult[]> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' } },
        query,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    return parseYouTubeVideoResults(await res.json(), limit);
  } catch {
    return [];
  }
}

/**
 * Searches YouTube Music's "Songs" category: official audio uploads (album art tracks)
 * distributed by labels from the master recording, rather than fan re-uploads. Returns [] on
 * any failure (reported to `onError`); `channel` holds the artist names.
 */
export async function searchYouTubeMusicSongs(
  query: string,
  limit = 5,
  timeoutMs = 8000,
  onError?: (err: unknown) => void
): Promise<YtDlpSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];
  try {
    const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://music.youtube.com',
        Referer: 'https://music.youtube.com/',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240724.00.00', hl: 'en', gl: 'US' } },
        query: cleanQuery,
        params: YTM_SONGS_FILTER,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    return parseYouTubeMusicSongs(await res.json()).slice(0, Math.max(1, limit));
  } catch (err) {
    onError?.(err);
    return [];
  }
}
