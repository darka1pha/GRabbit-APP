/**
 * Picks the YouTube search result that best matches a Spotify track.
 *
 * Taking the first `ytsearch1:` hit is unreliable: same-titled songs by other
 * artists, covers, remixes, sped-up edits and live versions often rank first.
 * Candidates are scored on title tokens, artist presence, duration closeness and
 * unwanted-variant keywords instead.
 */

export interface SpotifyTrackInfo {
  title: string;
  /** Individual artist names, primary artist first. */
  artists: string[];
  durationSeconds?: number;
}

export interface MatchCandidate {
  url: string;
  title: string;
  channel?: string;
  duration?: number;
  source?: 'youtube' | 'youtube-music';
}

/** Keywords that indicate a different rendition, penalised unless the Spotify title has them too. */
export const VARIANT_KEYWORDS = [
  'cover',
  'karaoke',
  'instrumental',
  'remix',
  'sped up',
  'speed up',
  'slowed',
  'reverb',
  'nightcore',
  '8d',
  'live',
  'acoustic',
  'reaction',
  'tutorial',
  'lesson',
  'bass boosted',
  '1 hour',
  'loop',
  'extended',
  'mashup',
  'edit',
  'version',
  'piano',
  'guitar',
  'drum',
  'lofi',
  'lo fi',
  'chipmunk',
  'trailer',
  'shorts',
];

function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

function compact(text: string): string {
  return normalize(text).replace(/ /g, '');
}

function hasPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

/** "Song (feat. X) - Remastered 2011" → "Song" */
function coreTitle(title: string): string {
  const stripped = title
    .replace(/\s*[([].*?[)\]]/g, '')
    .split(/\s+-\s+/)[0]
    .trim();
  return stripped || title;
}

export function scoreCandidate(track: SpotifyTrackInfo, candidate: MatchCandidate): number {
  const candTitle = normalize(candidate.title);
  const candAll = normalize(`${candidate.title} ${candidate.channel ?? ''}`);
  const candCompact = compact(`${candidate.title} ${candidate.channel ?? ''}`);
  const spotifyText = normalize(`${track.title} ${track.artists.join(' ')}`);

  // Title: share of the Spotify core-title tokens present in the candidate title
  const titleTokens = tokens(coreTitle(track.title));
  const titleHits = titleTokens.filter((t) => hasPhrase(candTitle, t)).length;
  const titleRatio = titleTokens.length > 0 ? titleHits / titleTokens.length : 0;
  let score = titleRatio * 4;
  if (titleRatio < 0.5) score -= 4;

  // Artist: compare compacted so "RickAstleyVEVO" / "Rick Astley - Topic" both match
  const [primary, ...others] = track.artists.map(compact).filter(Boolean);
  if (primary) {
    if (candCompact.includes(primary)) score += 3;
    else if (others.some((a) => candCompact.includes(a))) score += 1.5;
    else score -= 2;
  }

  // Duration: the strongest signal for picking the right recording
  if (track.durationSeconds && candidate.duration) {
    const diff = Math.abs(candidate.duration - track.durationSeconds);
    if (diff <= 3) score += 3;
    else if (diff <= 10) score += 2;
    else if (diff <= 25) score += 0.5;
    else if (diff <= 60) score -= 2;
    else score -= 5;
  }

  // Unwanted renditions (only when the Spotify title/artist doesn't contain them)
  let variantPenalty = 0;
  for (const kw of VARIANT_KEYWORDS) {
    if (hasPhrase(candAll, kw) && !hasPhrase(spotifyText, kw)) variantPenalty += 3;
  }
  score -= Math.min(variantPenalty, 9);

  // Official label uploads carry the studio master; fan re-uploads are often re-encoded copies
  if (candidate.source === 'youtube-music') score += 2.5;
  else if (candidate.channel && /\s-\stopic$/i.test(candidate.channel.trim())) score += 1.5;
  if (hasPhrase(candTitle, 'official audio')) score += 0.5;

  return score;
}

/** Returns the best-scoring candidate, preferring earlier search ranks on ties. */
export function pickBestMatch<T extends MatchCandidate>(
  track: SpotifyTrackInfo,
  candidates: T[]
): { candidate: T; score: number } | null {
  let best: { candidate: T; score: number } | null = null;
  candidates.forEach((candidate, index) => {
    const score = scoreCandidate(track, candidate) - index * 0.05;
    if (!best || score > best.score) best = { candidate, score };
  });
  return best;
}

