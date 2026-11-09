import type { Category } from '../../shared/types';

const EXTENSIONS: Record<Exclude<Category, 'other'>, string[]> = {
  video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'm2ts', 'ogv'],
  music: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma', 'alac', 'aiff', 'ape', 'mka'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'epub', 'mobi', 'csv', 'md', 'djvu'],
  compressed: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab', 'lz', 'lzma', 'z'],
  programs: ['exe', 'msi', 'msix', 'appx', 'apk', 'xapk', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'bat', 'iso', 'img', 'jar'],
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'ico', 'heic', 'avif', 'psd', 'raw'],
};

const BY_EXTENSION = new Map<string, Category>();
for (const [category, exts] of Object.entries(EXTENSIONS)) {
  for (const ext of exts) BY_EXTENSION.set(ext, category as Category);
}

/** Folder names used when "sort into category folders" is on. */
export const CATEGORY_FOLDERS: Record<Category, string> = {
  video: 'Video',
  music: 'Music',
  documents: 'Documents',
  compressed: 'Compressed',
  programs: 'Programs',
  images: 'Images',
  other: 'Other',
};

export function categoryForFileName(name: string): Category {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === name.toLowerCase()) return 'other';
  return BY_EXTENSION.get(ext) ?? 'other';
}

export function categoryForMime(mime?: string): Category | null {
  if (!mime) return null;
  const type = mime.toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'music';
  if (type.startsWith('image/')) return 'images';
  if (type === 'application/pdf' || type.startsWith('text/')) return 'documents';
  if (/zip|rar|7z|x-tar|gzip|bzip|x-xz/.test(type)) return 'compressed';
  if (/x-msdownload|x-msi|vnd\.android\.package-archive|x-iso9660/.test(type)) return 'programs';
  return null;
}

/** True when the URL path ends in an extension the download manager (not yt-dlp) should handle. */
export function looksLikeDirectFile(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const ext = path.split('/').pop()?.split('.').pop() ?? '';
    if (!path.includes('.') || !ext) return false;
    const category = BY_EXTENSION.get(ext);
    return Boolean(category) && !['html', 'htm', 'php', 'aspx'].includes(ext);
  } catch {
    return false;
  }
}

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
  'application/gzip': 'gz',
  'application/x-msdownload': 'exe',
  'application/x-msi': 'msi',
  'application/vnd.android.package-archive': 'apk',
  'application/x-iso9660-image': 'iso',
  'application/json': 'json',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/wav': 'wav',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

export function extensionForMime(mime?: string): string | null {
  if (!mime) return null;
  return MIME_EXTENSIONS[mime.split(';')[0].trim().toLowerCase()] ?? null;
}
