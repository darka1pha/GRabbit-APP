import { Language } from '@grabbit/types';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function nf(language: Language = 'en', digits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(language === 'fa' ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

/**
 * Format bytes into localized human-readable string (KB, MB, GB).
 */
export function formatBytes(bytes: number | null | undefined, language: Language = 'en'): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${nf(language, 0).format(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${nf(language, value >= 100 ? 0 : value >= 10 ? 1 : 2).format(value)} ${UNITS[unit]}`;
}

/**
 * Format speed in bytes per second.
 */
export function formatSpeed(bps: number, language: Language = 'en'): string {
  if (!bps || bps < 1) return '';
  return `${formatBytes(bps, language)}/s`;
}

/**
 * Format seconds into mm:ss or hh:mm:ss.
 */
export function formatDuration(seconds: number | null | undefined, language: Language = 'en'): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const f = nf(language, 0);
  const pad = (n: number) => f.format(n).padStart(2, language === 'fa' ? '۰' : '0');
  return h > 0 ? `${f.format(h)}:${pad(m)}:${pad(sec)}` : `${f.format(m)}:${pad(sec)}`;
}

/**
 * Format ETA seconds into human-readable string.
 */
export function formatEta(seconds: number | null | undefined, language: Language = 'en'): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  if (seconds > 86400 * 3) return '∞';
  return formatDuration(seconds, language);
}

/**
 * Format fraction (0..1) to percentage string.
 */
export function formatPercent(fraction: number, language: Language = 'en'): string {
  return `${nf(language, fraction < 0.1 ? 1 : 0).format(Math.max(0, Math.min(100, fraction * 100)))}%`;
}

/**
 * Format date timestamp into localized string.
 */
export function formatDate(ms: number, language: Language = 'en'): string {
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/**
 * Validate HTTP/HTTPS URL.
 */
export function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const isValidUrl = isHttpUrl;

const DIRECT_FILE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|iso|img|exe|msi|msix|apk|dmg|pkg|deb|rpm|appimage|pdf|docx?|xlsx?|pptx?|epub|mp3|m4a|flac|wav|ogg|opus|mp4|mkv|webm|avi|mov|wmv|jpg|jpeg|png|gif|webp|bin|torrent|csv|txt)$/i;

/**
 * Checks if a URL path points directly to a file extension.
 */
export function looksLikeDirectFile(url: string): boolean {
  try {
    return DIRECT_FILE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const MEDIA_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|instagram\.com|instagr\.am|soundcloud\.com|tiktok\.com|twitter\.com|x\.com|reddit\.com|redd\.it|vimeo\.com|dailymotion\.com|twitch\.tv|facebook\.com|fb\.watch|bilibili\.com|aparat\.com)$/i;

/**
 * Checks if a URL belongs to a supported media site.
 */
export function looksLikeMediaPage(url: string): boolean {
  try {
    return MEDIA_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Clean a string to make it safe as a local filename.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate download speed and remaining time (ETA).
 */
export function calculateSpeedAndEta(
  downloadedBytes: number,
  totalBytes: number,
  elapsedSeconds: number
): { speedBytesPerSec: number; etaSeconds?: number } {
  if (elapsedSeconds <= 0 || downloadedBytes <= 0) {
    return { speedBytesPerSec: 0 };
  }

  const speedBytesPerSec = downloadedBytes / elapsedSeconds;
  if (totalBytes <= 0 || downloadedBytes >= totalBytes) {
    return { speedBytesPerSec, etaSeconds: 0 };
  }

  const remainingBytes = totalBytes - downloadedBytes;
  const etaSeconds = Math.ceil(remainingBytes / speedBytesPerSec);
  return { speedBytesPerSec, etaSeconds };
}

/**
 * Decode a Base64 string into a Uint8Array (works in Node, Browser, and React Native).
 */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\r\n\s]/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  let bufferLength = Math.floor((clean.length * 3) / 4);
  if (clean.endsWith('==')) bufferLength -= 2;
  else if (clean.endsWith('=')) bufferLength -= 1;

  const bytes = new Uint8Array(Math.max(0, bufferLength));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = lookup[clean.charCodeAt(i)] ?? 0;
    const e2 = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const e3 = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const e4 = lookup[clean.charCodeAt(i + 3)] ?? 0;

    if (p < bufferLength) bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (p < bufferLength) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (p < bufferLength) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63);
  }
  return bytes;
}

function toHex(words: number[], littleEndian = false): string {
  let out = '';
  for (const w of words) {
    if (littleEndian) {
      for (let i = 0; i < 4; i++) {
        out += ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
      }
    } else {
      out += (w >>> 0).toString(16).padStart(8, '0');
    }
  }
  return out;
}

export interface IncrementalHasher {
  update(chunk: Uint8Array): this;
  digestHex(): string;
}

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
}

class Md5IncrementalHasher implements IncrementalHasher {
  private buffer = new Uint8Array(64);
  private bufferPos = 0;
  private totalBytes = 0;
  private a0 = 0x67452301;
  private b0 = 0xefcdab89;
  private c0 = 0x98badcfe;
  private d0 = 0x10325476;
  private M = new Uint32Array(16);

  private processBlock(block: Uint8Array) {
    const view = new DataView(block.buffer, block.byteOffset, 64);
    for (let j = 0; j < 16; j++) {
      this.M[j] = view.getUint32(j * 4, true);
    }
    let A = this.a0;
    let B = this.b0;
    let C = this.c0;
    let D = this.d0;

    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const temp = D;
      D = C;
      C = B;
      const sum = (A + F + MD5_K[i] + this.M[g]) >>> 0;
      const rot = ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i]))) >>> 0;
      B = (B + rot) >>> 0;
      A = temp;
    }

    this.a0 = (this.a0 + A) >>> 0;
    this.b0 = (this.b0 + B) >>> 0;
    this.c0 = (this.c0 + C) >>> 0;
    this.d0 = (this.d0 + D) >>> 0;
  }

  update(chunk: Uint8Array): this {
    let offset = 0;
    while (offset < chunk.length) {
      const toCopy = Math.min(64 - this.bufferPos, chunk.length - offset);
      this.buffer.set(chunk.subarray(offset, offset + toCopy), this.bufferPos);
      this.bufferPos += toCopy;
      offset += toCopy;
      if (this.bufferPos === 64) {
        this.processBlock(this.buffer);
        this.bufferPos = 0;
      }
    }
    this.totalBytes += chunk.length;
    return this;
  }

  digestHex(): string {
    const bitLen = this.totalBytes * 8;
    const bitLenLow = bitLen >>> 0;
    const bitLenHigh = Math.floor(bitLen / 0x100000000) >>> 0;

    this.buffer[this.bufferPos++] = 0x80;
    if (this.bufferPos > 56) {
      this.buffer.fill(0, this.bufferPos, 64);
      this.processBlock(this.buffer);
      this.bufferPos = 0;
    }
    this.buffer.fill(0, this.bufferPos, 56);

    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 64);
    view.setUint32(56, bitLenLow, true);
    view.setUint32(60, bitLenHigh, true);
    this.processBlock(this.buffer);

    return toHex([this.a0, this.b0, this.c0, this.d0], true);
  }
}

class Sha1IncrementalHasher implements IncrementalHasher {
  private buffer = new Uint8Array(64);
  private bufferPos = 0;
  private totalBytes = 0;
  private h0 = 0x67452301;
  private h1 = 0xefcdab89;
  private h2 = 0x98badcfe;
  private h3 = 0x10325476;
  private h4 = 0xc3d2e1f0;
  private W = new Uint32Array(80);

  private processBlock(block: Uint8Array) {
    const view = new DataView(block.buffer, block.byteOffset, 64);
    for (let i = 0; i < 16; i++) {
      this.W[i] = view.getUint32(i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      const n = this.W[i - 3] ^ this.W[i - 8] ^ this.W[i - 14] ^ this.W[i - 16];
      this.W[i] = ((n << 1) | (n >>> 31)) >>> 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;

    for (let i = 0; i < 80; i++) {
      let f = 0;
      let k = 0;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const rotA = ((a << 5) | (a >>> 27)) >>> 0;
      const temp = (rotA + f + e + k + this.W[i]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }

    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
  }

  update(chunk: Uint8Array): this {
    let offset = 0;
    while (offset < chunk.length) {
      const toCopy = Math.min(64 - this.bufferPos, chunk.length - offset);
      this.buffer.set(chunk.subarray(offset, offset + toCopy), this.bufferPos);
      this.bufferPos += toCopy;
      offset += toCopy;
      if (this.bufferPos === 64) {
        this.processBlock(this.buffer);
        this.bufferPos = 0;
      }
    }
    this.totalBytes += chunk.length;
    return this;
  }

  digestHex(): string {
    const bitLen = this.totalBytes * 8;
    const bitLenLow = bitLen >>> 0;
    const bitLenHigh = Math.floor(bitLen / 0x100000000) >>> 0;

    this.buffer[this.bufferPos++] = 0x80;
    if (this.bufferPos > 56) {
      this.buffer.fill(0, this.bufferPos, 64);
      this.processBlock(this.buffer);
      this.bufferPos = 0;
    }
    this.buffer.fill(0, this.bufferPos, 56);

    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 64);
    view.setUint32(56, bitLenHigh, false);
    view.setUint32(60, bitLenLow, false);
    this.processBlock(this.buffer);

    return toHex([this.h0, this.h1, this.h2, this.h3, this.h4], false);
  }
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class Sha256IncrementalHasher implements IncrementalHasher {
  private buffer = new Uint8Array(64);
  private bufferPos = 0;
  private totalBytes = 0;
  private h0 = 0x6a09e667;
  private h1 = 0xbb67ae85;
  private h2 = 0x3c6ef372;
  private h3 = 0xa54ff53a;
  private h4 = 0x510e527f;
  private h5 = 0x9b05688c;
  private h6 = 0x1f83d9ab;
  private h7 = 0x5be0cd19;
  private W = new Uint32Array(64);

  private rotr(x: number, n: number) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  private processBlock(block: Uint8Array) {
    const view = new DataView(block.buffer, block.byteOffset, 64);
    for (let i = 0; i < 16; i++) {
      this.W[i] = view.getUint32(i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = this.rotr(this.W[i - 15], 7) ^ this.rotr(this.W[i - 15], 18) ^ (this.W[i - 15] >>> 3);
      const s1 = this.rotr(this.W[i - 2], 17) ^ this.rotr(this.W[i - 2], 19) ^ (this.W[i - 2] >>> 10);
      this.W[i] = (this.W[i - 16] + s0 + this.W[i - 7] + s1) >>> 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;
    let f = this.h5;
    let g = this.h6;
    let h = this.h7;

    for (let i = 0; i < 64; i++) {
      const S1 = this.rotr(e, 6) ^ this.rotr(e, 11) ^ this.rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + this.W[i]) >>> 0;
      const S0 = this.rotr(a, 2) ^ this.rotr(a, 13) ^ this.rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
  }

  update(chunk: Uint8Array): this {
    let offset = 0;
    while (offset < chunk.length) {
      const toCopy = Math.min(64 - this.bufferPos, chunk.length - offset);
      this.buffer.set(chunk.subarray(offset, offset + toCopy), this.bufferPos);
      this.bufferPos += toCopy;
      offset += toCopy;
      if (this.bufferPos === 64) {
        this.processBlock(this.buffer);
        this.bufferPos = 0;
      }
    }
    this.totalBytes += chunk.length;
    return this;
  }

  digestHex(): string {
    const bitLen = this.totalBytes * 8;
    const bitLenLow = bitLen >>> 0;
    const bitLenHigh = Math.floor(bitLen / 0x100000000) >>> 0;

    this.buffer[this.bufferPos++] = 0x80;
    if (this.bufferPos > 56) {
      this.buffer.fill(0, this.bufferPos, 64);
      this.processBlock(this.buffer);
      this.bufferPos = 0;
    }
    this.buffer.fill(0, this.bufferPos, 56);

    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 64);
    view.setUint32(56, bitLenHigh, false);
    view.setUint32(60, bitLenLow, false);
    this.processBlock(this.buffer);

    return toHex([this.h0, this.h1, this.h2, this.h3, this.h4, this.h5, this.h6, this.h7], false);
  }
}

const SHA512_K_HI = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  0xca273ece, 0xd186b8c7, 0xeada7dd6, 0xf57d4f7f, 0x06f067aa, 0x0a637dc5, 0x113f9804, 0x1b710b35,
  0x28db77f5, 0x32caab7b, 0x3c9ebe0a, 0x431d67c4, 0x4cc5d4be, 0x597f299c, 0x5fcb6fab, 0x6c44198c,
]);

const SHA512_K_LO = new Uint32Array([
  0xd728ae22, 0x23ef65cd, 0xec4d3b2f, 0x8189dbbc, 0xf348b538, 0xb605d019, 0xaf194f9b, 0xda6d8118,
  0xa3030242, 0x45706fbe, 0x4ee4b28c, 0xd5ffb4e2, 0xf27b896f, 0x3b1696b1, 0x25c71235, 0xcf692694,
  0x9ef14ad2, 0x384f25e3, 0x8b8cd5b5, 0x77ac9c65, 0x592b0275, 0x6ea6e483, 0xbd41fbd4, 0x831153b5,
  0xee66dfab, 0x2db43210, 0x98fb213f, 0xbeef0ee4, 0x3da88fc2, 0x930aa725, 0xe003826f, 0x0a0e6e70,
  0x46d22ffc, 0x5c26c926, 0x5ac42aed, 0x9d95b3df, 0x8baf63de, 0x3c77b2a8, 0x47edaee6, 0x1482353b,
  0x4cf10364, 0xbc423001, 0xd0f89791, 0x0654be30, 0xd6ef5218, 0x5565a910, 0x5771202a, 0x32bbd1b8,
  0xb8d2d0c8, 0x5141ab53, 0xdf8eeb99, 0xe19b48a8, 0xc5c95a63, 0xe3418acb, 0x7763e373, 0xd6b2b8a3,
  0x5defb2fc, 0x43172f60, 0xa1f0ab72, 0x1a6439ec, 0x23631e28, 0xde82bde9, 0xb2c67915, 0xe372532b,
  0xea26619c, 0x21c0c207, 0xcde0eb1e, 0xee6ed178, 0x72176fba, 0xa2c898a6, 0xbef90dae, 0x131c471b,
  0x23047d84, 0x40c72493, 0x15c9bebc, 0x9c100d4c, 0xcb3e42b6, 0xfc657e2a, 0x3ad6faec, 0x4a475817,
]);

class Sha512IncrementalHasher implements IncrementalHasher {
  private buffer = new Uint8Array(128);
  private bufferPos = 0;
  private totalBytes = 0;
  private hHi = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private hLo = new Uint32Array([
    0xf3bcc908, 0x84caa73b, 0xfe94f82b, 0x5f1d36f1,
    0xade682d1, 0x2b3e6c1f, 0xfb41bd6b, 0x137e2179,
  ]);
  private wHi = new Uint32Array(80);
  private wLo = new Uint32Array(80);

  private processBlock(block: Uint8Array) {
    const view = new DataView(block.buffer, block.byteOffset, 128);
    for (let i = 0; i < 16; i++) {
      this.wHi[i] = view.getUint32(i * 8, false);
      this.wLo[i] = view.getUint32(i * 8 + 4, false);
    }

    for (let i = 16; i < 80; i++) {
      const h15 = this.wHi[i - 15];
      const l15 = this.wLo[i - 15];
      // s0 = rotr64(w[i-15], 1) ^ rotr64(w[i-15], 8) ^ shr64(w[i-15], 7)
      const s0Hi =
        ((h15 >>> 1) | (l15 << 31)) ^
        ((h15 >>> 8) | (l15 << 24)) ^
        (h15 >>> 7);
      const s0Lo =
        ((l15 >>> 1) | (h15 << 31)) ^
        ((l15 >>> 8) | (h15 << 24)) ^
        ((l15 >>> 7) | (h15 << 25));

      const h2 = this.wHi[i - 2];
      const l2 = this.wLo[i - 2];
      // s1 = rotr64(w[i-2], 19) ^ rotr64(w[i-2], 61) ^ shr64(w[i-2], 6)
      // Note rotr64(x, 61) === rotl64(x, 3)
      const s1Hi =
        ((h2 >>> 19) | (l2 << 13)) ^
        ((h2 << 3) | (l2 >>> 29)) ^
        (h2 >>> 6);
      const s1Lo =
        ((l2 >>> 19) | (h2 << 13)) ^
        ((l2 << 3) | (h2 >>> 29)) ^
        ((l2 >>> 6) | (h2 << 26));

      let loSum =
        (this.wLo[i - 16] >>> 0) +
        (s0Lo >>> 0) +
        (this.wLo[i - 7] >>> 0) +
        (s1Lo >>> 0);
      const carry = Math.floor(loSum / 0x100000000);
      this.wLo[i] = loSum >>> 0;
      this.wHi[i] =
        (this.wHi[i - 16] + s0Hi + this.wHi[i - 7] + s1Hi + carry) >>> 0;
    }

    let aHi = this.hHi[0], aLo = this.hLo[0];
    let bHi = this.hHi[1], bLo = this.hLo[1];
    let cHi = this.hHi[2], cLo = this.hLo[2];
    let dHi = this.hHi[3], dLo = this.hLo[3];
    let eHi = this.hHi[4], eLo = this.hLo[4];
    let fHi = this.hHi[5], fLo = this.hLo[5];
    let gHi = this.hHi[6], gLo = this.hLo[6];
    let hHi = this.hHi[7], hLo = this.hLo[7];

    for (let i = 0; i < 80; i++) {
      // S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41)
      // Note rotr64(e, 41) -> s=9 on swapped words
      const S1Hi =
        ((eHi >>> 14) | (eLo << 18)) ^
        ((eHi >>> 18) | (eLo << 14)) ^
        ((eLo >>> 9) | (eHi << 23));
      const S1Lo =
        ((eLo >>> 14) | (eHi << 18)) ^
        ((eLo >>> 18) | (eHi << 14)) ^
        ((eHi >>> 9) | (eLo << 23));

      const chHi = (eHi & fHi) ^ (~eHi & gHi);
      const chLo = (eLo & fLo) ^ (~eLo & gLo);

      const t1LoSum =
        (hLo >>> 0) +
        (S1Lo >>> 0) +
        (chLo >>> 0) +
        (SHA512_K_LO[i] >>> 0) +
        (this.wLo[i] >>> 0);
      const t1Carry = Math.floor(t1LoSum / 0x100000000);
      const t1Lo = t1LoSum >>> 0;
      const t1Hi =
        (hHi + S1Hi + chHi + SHA512_K_HI[i] + this.wHi[i] + t1Carry) >>> 0;

      // S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39)
      const S0Hi =
        ((aHi >>> 28) | (aLo << 4)) ^
        ((aLo >>> 2) | (aHi << 30)) ^
        ((aLo >>> 7) | (aHi << 25));
      const S0Lo =
        ((aLo >>> 28) | (aHi << 4)) ^
        ((aHi >>> 2) | (aLo << 30)) ^
        ((aHi >>> 7) | (aLo << 25));

      const majHi = (aHi & bHi) ^ (aHi & cHi) ^ (bHi & cHi);
      const majLo = (aLo & bLo) ^ (aLo & cLo) ^ (bLo & cLo);

      const t2LoSum = (S0Lo >>> 0) + (majLo >>> 0);
      const t2Carry = Math.floor(t2LoSum / 0x100000000);
      const t2Lo = t2LoSum >>> 0;
      const t2Hi = (S0Hi + majHi + t2Carry) >>> 0;

      hHi = gHi; hLo = gLo;
      gHi = fHi; gLo = fLo;
      fHi = eHi; fLo = eLo;

      const dSumLo = (dLo >>> 0) + (t1Lo >>> 0);
      eLo = dSumLo >>> 0;
      eHi = (dHi + t1Hi + Math.floor(dSumLo / 0x100000000)) >>> 0;

      dHi = cHi; dLo = cLo;
      cHi = bHi; cLo = bLo;
      bHi = aHi; bLo = aLo;

      const aSumLo = (t1Lo >>> 0) + (t2Lo >>> 0);
      aLo = aSumLo >>> 0;
      aHi = (t1Hi + t2Hi + Math.floor(aSumLo / 0x100000000)) >>> 0;
    }

    const addInto = (idx: number, hi: number, lo: number) => {
      const sLo = (this.hLo[idx] >>> 0) + (lo >>> 0);
      this.hLo[idx] = sLo >>> 0;
      this.hHi[idx] = (this.hHi[idx] + hi + Math.floor(sLo / 0x100000000)) >>> 0;
    };
    addInto(0, aHi, aLo);
    addInto(1, bHi, bLo);
    addInto(2, cHi, cLo);
    addInto(3, dHi, dLo);
    addInto(4, eHi, eLo);
    addInto(5, fHi, fLo);
    addInto(6, gHi, gLo);
    addInto(7, hHi, hLo);
  }

  update(chunk: Uint8Array): this {
    let offset = 0;
    while (offset < chunk.length) {
      const toCopy = Math.min(128 - this.bufferPos, chunk.length - offset);
      this.buffer.set(chunk.subarray(offset, offset + toCopy), this.bufferPos);
      this.bufferPos += toCopy;
      offset += toCopy;
      if (this.bufferPos === 128) {
        this.processBlock(this.buffer);
        this.bufferPos = 0;
      }
    }
    this.totalBytes += chunk.length;
    return this;
  }

  digestHex(): string {
    const bitLen = this.totalBytes * 8;
    const bitLenLow = bitLen >>> 0;
    const bitLenHigh = Math.floor(bitLen / 0x100000000) >>> 0;

    this.buffer[this.bufferPos++] = 0x80;
    if (this.bufferPos > 112) {
      this.buffer.fill(0, this.bufferPos, 128);
      this.processBlock(this.buffer);
      this.bufferPos = 0;
    }
    this.buffer.fill(0, this.bufferPos, 112);

    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 128);
    // 128-bit length field: high 64 bits are 0 for JS safe-integer byte lengths
    view.setUint32(112, 0, false);
    view.setUint32(116, 0, false);
    view.setUint32(120, bitLenHigh, false);
    view.setUint32(124, bitLenLow, false);
    this.processBlock(this.buffer);

    const words: number[] = [];
    for (let i = 0; i < 8; i++) {
      words.push(this.hHi[i], this.hLo[i]);
    }
    return toHex(words, false);
  }
}

/**
 * Create a streaming/incremental cryptographic hasher for MD5, SHA-1, SHA-256, or SHA-512.
 * Allows computing hashes chunk by chunk with minimal memory overhead.
 */
export function createIncrementalHasher(algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512' = 'sha256'): IncrementalHasher {
  switch (algorithm) {
    case 'md5':
      return new Md5IncrementalHasher();
    case 'sha1':
      return new Sha1IncrementalHasher();
    case 'sha512':
      return new Sha512IncrementalHasher();
    case 'sha256':
    default:
      return new Sha256IncrementalHasher();
  }
}

/**
 * Compute RFC 1321 MD5 hex digest for a Uint8Array.
 */
export function md5Hex(data: Uint8Array): string {
  return createIncrementalHasher('md5').update(data).digestHex();
}

/**
 * Compute FIPS 180-4 SHA-1 hex digest for a Uint8Array.
 */
export function sha1Hex(data: Uint8Array): string {
  return createIncrementalHasher('sha1').update(data).digestHex();
}

/**
 * Compute FIPS 180-4 SHA-256 hex digest for a Uint8Array.
 */
export function sha256Hex(data: Uint8Array): string {
  return createIncrementalHasher('sha256').update(data).digestHex();
}

/**
 * Compute FIPS 180-4 SHA-512 hex digest for a Uint8Array.
 */
export function sha512Hex(data: Uint8Array): string {
  return createIncrementalHasher('sha512').update(data).digestHex();
}

/**
 * Compute cryptographic hash digest in lowercase hex for MD5, SHA-1, SHA-256, or SHA-512.
 */
export function computeHashHex(data: Uint8Array, algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512' = 'sha256'): string {
  switch (algorithm) {
    case 'md5':
      return md5Hex(data);
    case 'sha1':
      return sha1Hex(data);
    case 'sha512':
      return sha512Hex(data);
    case 'sha256':
    default:
      return sha256Hex(data);
  }
}

/**
 * Compare two semantic version strings (e.g. "1.2.0" vs "1.0.0" or "v1.2.0").
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const cleanA = String(a || '')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const cleanB = String(b || '')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(cleanA.length, cleanB.length, 3);
  for (let i = 0; i < len; i++) {
    const va = cleanA[i] ?? 0;
    const vb = cleanB[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export * from './i18n';
export * from './pattern-expander';

