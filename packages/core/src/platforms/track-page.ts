/** Release details from the public open.spotify.com/track/{id} page's <meta> tags. */
export interface SpotifyTrackPageDetails {
  albumId?: string;
  /** Album name parsed from og:description ("Artist · Album · Song · Year"); prefer the album embed's name. */
  albumName?: string;
  trackNumber?: number;
  /** YYYY-MM-DD (or YYYY) */
  releaseDate?: string;
  /** Largest cover image (640px) */
  coverUrl?: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function metaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match =
    html.match(new RegExp(`<meta[^>]+(?:property|name)="${escaped}"[^>]+content="([^"]*)"`, 'i')) ||
    html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${escaped}"`, 'i'));
  const value = match?.[1] ? decodeEntities(match[1]).trim() : undefined;
  return value || undefined;
}

export function parseTrackPage(html: string): SpotifyTrackPageDetails {
  const albumUrl = metaContent(html, 'music:album');
  const albumId = albumUrl?.match(/\/album\/([A-Za-z0-9]+)/)?.[1];

  const trackNo = parseInt(metaContent(html, 'music:album:track') ?? '', 10);

  const releaseDate = metaContent(html, 'music:release_date');

  // "Rick Astley · Whenever You Need Somebody · Song · 1987"
  let albumName: string | undefined;
  const description = metaContent(html, 'og:description');
  if (description) {
    const parts = description.split(' · ');
    if (parts.length >= 4) albumName = parts.slice(1, parts.length - 2).join(' · ') || undefined;
  }

  return {
    albumId,
    albumName,
    trackNumber: Number.isFinite(trackNo) && trackNo > 0 ? trackNo : undefined,
    releaseDate,
    coverUrl: metaContent(html, 'og:image'),
  };
}

