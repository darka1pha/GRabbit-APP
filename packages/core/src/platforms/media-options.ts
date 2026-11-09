import { MediaOption } from '@grabbit/types';

export function formatResolutionLabel(height: number): string {
  if (height >= 4320) return `${height}p 8K`;
  if (height >= 2160) return `${height}p 4K`;
  if (height === 1440) return '1440p 2K';
  if (height === 1080) return '1080p Full HD';
  if (height === 720) return '720p HD';
  return `${height}p`;
}

export function audioOptions(sizeBytes?: number): MediaOption[] {
  return [
    {
      format: 'audio',
      qualityId: 'm4a',
      label: 'M4A (Original)',
      extension: 'm4a',
      estimatedSizeBytes: sizeBytes,
      isOriginalQuality: true,
    },
    {
      format: 'audio',
      qualityId: 'mp3-320',
      label: 'MP3 320k',
      extension: 'mp3',
      estimatedSizeBytes: sizeBytes ? Math.round(sizeBytes * 1.1) : undefined,
    },
    {
      format: 'audio',
      qualityId: 'mp3-192',
      label: 'MP3 192k',
      extension: 'mp3',
      estimatedSizeBytes: sizeBytes ? Math.round(sizeBytes * 0.7) : undefined,
    },
    {
      format: 'audio',
      qualityId: 'mp3-128',
      label: 'MP3 128k',
      extension: 'mp3',
      estimatedSizeBytes: sizeBytes ? Math.round(sizeBytes * 0.45) : undefined,
    },
    {
      format: 'audio',
      qualityId: 'flac',
      label: 'FLAC (Lossless)',
      extension: 'flac',
      estimatedSizeBytes: sizeBytes ? Math.round(sizeBytes * 2.2) : undefined,
    },
  ];
}

export function spotifyAudioOptions(): MediaOption[] {
  return [
    { format: 'audio', qualityId: 'mp3-320', label: 'MP3 320k', extension: 'mp3' },
    { format: 'audio', qualityId: 'mp3-192', label: 'MP3 192k', extension: 'mp3' },
    { format: 'audio', qualityId: 'mp3-128', label: 'MP3 128k', extension: 'mp3' },
    {
      format: 'audio',
      qualityId: 'm4a',
      label: 'M4A (Original)',
      extension: 'm4a',
      isOriginalQuality: true,
    },
    { format: 'audio', qualityId: 'mp3', label: 'MP3 (Standard)', extension: 'mp3' },
  ];
}

export function standardVideoOptions(): MediaOption[] {
  return [2160, 1440, 1080, 720, 480, 360].map((h) => ({
    format: 'video' as const,
    qualityId: `${h}p`,
    label: formatResolutionLabel(h),
    extension: 'mp4',
  }));
}

export function standardMediaOptions(): MediaOption[] {
  return [...audioOptions(), ...standardVideoOptions()];
}

