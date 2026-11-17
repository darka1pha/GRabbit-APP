// YouTube cookies.txt handling for the admin panel: parsing, merging, saving and diagnostics.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../../config/env.js';

export const YOUTUBE_AUTH_COOKIE_NAMES = new Set([
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  'LOGIN_INFO',
]);

export interface CookieSaveDiagnostics {
  savedPath: string;
  normalizedContent: string;
  totalCookies: number;
  youtubeCookies: number;
  hasAuthCookies: boolean;
  foundAuthCookies: string[];
}

interface ParsedCookieEntry {
  domain: string;
  includeSubdomains: 'TRUE' | 'FALSE';
  path: string;
  secure: 'TRUE' | 'FALSE';
  expires: number;
  name: string;
  value: string;
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function getManagedCookiesFilePath(): string {
  return resolve(PACKAGE_ROOT, getConfig().TEMP_DIR, 'youtube_cookies.txt');
}

export function getRuntimeCookiesFilePath(): string {
  return resolve(PACKAGE_ROOT, getConfig().TEMP_DIR, 'youtube_cookies_runtime.txt');
}

export function parseCookiesFromText(rawContent: string): ParsedCookieEntry[] {
  const cleaned = rawContent.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const entries: ParsedCookieEntry[] = [];

  // 1. Support JSON cookie exports (e.g. Cookie-Editor / EditThisCookie / header dump)
  if (cleaned.startsWith('[') || (cleaned.startsWith('{') && cleaned.includes('"'))) {
    try {
      let parsedJson = JSON.parse(cleaned);
      if (parsedJson && !Array.isArray(parsedJson)) {
        if (Array.isArray(parsedJson.cookies)) {
          parsedJson = parsedJson.cookies;
        } else if (Array.isArray(parsedJson.data)) {
          parsedJson = parsedJson.data;
        }
      }
      if (Array.isArray(parsedJson)) {
        for (const item of parsedJson) {
          if (!item || typeof item !== 'object') continue;
          let domain = String(item.domain || '').trim();
          const name = String(item.name || '').trim();
          if (!domain || !name) continue;
          if (!item.hostOnly && !domain.startsWith('.')) {
            domain = `.${domain}`;
          }
          const includeSubdomains: 'TRUE' | 'FALSE' = domain.startsWith('.') ? 'TRUE' : 'FALSE';
          const path = String(item.path || '/').trim() || '/';
          const secure: 'TRUE' | 'FALSE' = item.secure ? 'TRUE' : 'FALSE';
          const expRaw = Number(item.expirationDate ?? item.expires ?? 0);
          const expires =
            Number.isFinite(expRaw) && expRaw > 0
              ? Math.floor(expRaw)
              : Math.floor(Date.now() / 1000) + 31536000;
          const value = String(item.value ?? '').replace(/[\r\n\t]/g, '');
          entries.push({ domain, includeSubdomains, path, secure, expires, name, value });
        }
        if (entries.length > 0) {
          return entries;
        }
      }
    } catch {
      // Fall through to line-by-line parsing
    }
  }

  // 2. Parse Netscape format (supporting both TABs and spaces, stripping #HttpOnly_, skipping truncated lines)
  const lines = cleaned.split('\n');
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    if (/^#HttpOnly_/i.test(line)) {
      line = line.replace(/^#HttpOnly_/i, '');
    } else if (line.startsWith('#')) {
      continue;
    }

    let parts = line.split('\t');
    if (parts.length === 6) {
      parts.push('');
    } else if (parts.length < 7) {
      // Telegram or text editors may convert TAB characters into spaces when copying/pasting
      const spaceMatch = line.match(
        /^(\S+)\s+(TRUE|FALSE)\s+(\S+)\s+(TRUE|FALSE)\s+(-?\d+(?:\.\d+)?)\s+(\S+)(?:\s+(.*))?$/i
      );
      if (spaceMatch) {
        parts = [
          spaceMatch[1],
          spaceMatch[2].toUpperCase(),
          spaceMatch[3],
          spaceMatch[4].toUpperCase(),
          spaceMatch[5],
          spaceMatch[6],
          spaceMatch[7] || '',
        ];
      }
    }

    if (parts.length < 7) {
      // Skip malformed or truncated lines (e.g. at Telegram's 4096-character split boundary)
      continue;
    }

    let domain = parts[0].trim();
    const flagRaw = parts[1].trim().toUpperCase();
    const path = parts[2].trim() || '/';
    const secureRaw = parts[3].trim().toUpperCase();
    const expiresNum = parseInt(parts[4].trim(), 10);
    const name = parts[5].trim();
    const value = parts.slice(6).join('\t').trim();

    if (!domain || !name || !path.startsWith('/')) continue;
    if (flagRaw !== 'TRUE' && flagRaw !== 'FALSE') continue;
    if (secureRaw !== 'TRUE' && secureRaw !== 'FALSE') continue;
    if (isNaN(expiresNum)) continue;
    if (!/^\.?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) continue;

    // Python's http.cookiejar.MozillaCookieJar strictly requires initial_dot == (includeSubdomains == 'TRUE')
    if (flagRaw === 'TRUE' && !domain.startsWith('.')) {
      domain = `.${domain}`;
    }
    const includeSubdomains: 'TRUE' | 'FALSE' = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure: 'TRUE' | 'FALSE' = secureRaw === 'TRUE' ? 'TRUE' : 'FALSE';
    const expires = expiresNum < 0 ? 0 : expiresNum;

    entries.push({
      domain,
      includeSubdomains,
      path,
      secure,
      expires,
      name,
      value,
    });
  }

  return entries;
}

export function looksLikeCookiesInput(text: string): boolean {
  if (!text) return false;
  if (
    text.includes('# Netscape HTTP Cookie File') ||
    text.includes('# HTTP Cookie File') ||
    text.includes('curl.haxx.se/rfc/cookie_spec') ||
    /#HttpOnly_/i.test(text)
  ) {
    return true;
  }
  return parseCookiesFromText(text).length >= 1;
}

export function saveYouTubeCookiesWithDiagnostics(
  content: string,
  options?: { mergeExisting?: boolean }
): CookieSaveDiagnostics {
  const target = getManagedCookiesFilePath();
  const dir = dirname(target);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const cookieMap = new Map<string, ParsedCookieEntry>();

  if (options?.mergeExisting && existsSync(target)) {
    try {
      const existingContent = readFileSync(target, 'utf-8');
      for (const entry of parseCookiesFromText(existingContent)) {
        cookieMap.set(`${entry.domain}|${entry.path}|${entry.name}`, entry);
      }
    } catch {}
  }

  const incomingEntries = parseCookiesFromText(content);
  for (const entry of incomingEntries) {
    cookieMap.set(`${entry.domain}|${entry.path}|${entry.name}`, entry);
  }

  const allEntries = Array.from(cookieMap.values());
  if (allEntries.length === 0) {
    return {
      savedPath: target,
      normalizedContent: '',
      totalCookies: 0,
      youtubeCookies: 0,
      hasAuthCookies: false,
      foundAuthCookies: [],
    };
  }

  const lines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.haxx.se/rfc/cookie_spec.html',
    '# This is a generated file! Do not edit.',
    '',
    ...allEntries.map(
      (e) =>
        `${e.domain}\t${e.includeSubdomains}\t${e.path}\t${e.secure}\t${e.expires}\t${e.name}\t${e.value}`
    ),
    '',
  ];

  const normalizedContent = lines.join('\n');
  writeFileSync(target, normalizedContent, 'utf-8');
  try {
    writeFileSync(getRuntimeCookiesFilePath(), normalizedContent, 'utf-8');
  } catch {}

  let youtubeCookies = 0;
  const foundAuthSet = new Set<string>();

  for (const e of allEntries) {
    const dom = e.domain.toLowerCase();
    if (dom.includes('youtube.com') || dom.includes('google.com')) {
      youtubeCookies++;
      if (YOUTUBE_AUTH_COOKIE_NAMES.has(e.name) && e.value.length > 0) {
        foundAuthSet.add(e.name);
      }
    }
  }

  return {
    savedPath: target,
    normalizedContent,
    totalCookies: allEntries.length,
    youtubeCookies,
    hasAuthCookies: foundAuthSet.size > 0,
    foundAuthCookies: Array.from(foundAuthSet),
  };
}

export function saveYouTubeCookiesFile(content: string): string {
  return saveYouTubeCookiesWithDiagnostics(content, { mergeExisting: false }).savedPath;
}
