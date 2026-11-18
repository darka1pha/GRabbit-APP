import type { RecognizedTrack } from '@grabbit/types';

export interface RawShazamResult {
  matches?: unknown[];
  track?: Record<string, any>;
}

/**
 * Normalizes a raw Shazam discovery/node-shazam payload into a RecognizedTrack.
 * Shared across Desktop and Telegram Bot.
 */
export function parseShazamTrack(result: RawShazamResult | null | undefined): RecognizedTrack | null {
  const track = result?.track ?? (result as Record<string, any> | undefined);
  if (!track || typeof track.title !== 'string' || !track.title.trim()) return null;

  const songSection = Array.isArray(track.sections)
    ? track.sections.find((s: Record<string, any>) => s?.type === 'SONG')
    : undefined;

  const meta = (title: string): string | undefined =>
    Array.isArray(songSection?.metadata)
      ? songSection.metadata.find((m: Record<string, any>) => m?.title === title)?.text
      : undefined;

  let appleMusicUrl: string | undefined;
  let spotifyUri: string | undefined;
  const providers = Array.isArray(track.hub?.providers) ? track.hub.providers : [];
  for (const provider of providers) {
    const uri = provider?.actions?.[0]?.uri;
    if (provider?.type === 'APPLEMUSIC' && uri) appleMusicUrl = uri;
    if (provider?.type === 'SPOTIFY' && uri) spotifyUri = uri;
  }
  if (!appleMusicUrl && Array.isArray(track.hub?.options)) {
    appleMusicUrl = track.hub.options
      .flatMap((o: Record<string, any>) => (Array.isArray(o?.actions) ? o.actions : []))
      .find((a: Record<string, any>) => {
        if (typeof a?.uri !== 'string') return false;
        try {
          const parsed = new URL(a.uri);
          return parsed.protocol === 'https:' && parsed.hostname === 'music.apple.com';
        } catch {
          return false;
        }
      })?.uri;
  }

  return {
    title: track.title,
    artist: track.subtitle || track.artist || 'Unknown Artist',
    album: track.album || meta('Album'),
    releaseYear: track.year || meta('Released'),
    genre: track.genres?.primary,
    label: meta('Label'),
    coverArtUrl: track.images?.coverarthq || track.images?.coverart,
    shazamUrl: track.url,
    appleMusicUrl,
    spotifyUri,
  };
}
