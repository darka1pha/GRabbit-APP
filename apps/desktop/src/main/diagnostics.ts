import { existsSync, readFileSync, statSync } from 'node:fs';
import { arch, homedir, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import type { DownloadItem } from '../shared/types';

/**
 * "Export diagnostics": one text file a user can attach to a bug report. It holds versions,
 * settings and the recent log, with secrets, cookies and URL queries removed, and counts of
 * downloads by status (never their URLs or file names).
 */

/** Setting names whose values are secrets or identify the user's accounts. */
const SECRET_KEY = /token|secret|password|passwd|session|cookie|credential|apikey|api_key|auth/i;
/** Names that match the pattern but only hold a choice, not a secret. */
const NOT_SECRET = new Set(['cookiesFromBrowser']);
const LOG_TAIL_BYTES = 256 * 1024;

/** Shows the user's home folder (which contains their account name) as `~`. */
export function redactHome(text: string, home = homedir()): string {
  if (!home) return text;
  const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')]);
  let out = text;
  for (const v of variants) out = out.split(v).join('~');
  // Same folder written with a different case (Windows paths are case-insensitive)
  return out.replace(new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '~');
}

/** Removes user:password@ from URLs (proxies) and replaces secret-looking values. */
export function redactSettings(value: unknown, key = '', home = homedir()): unknown {
  if (Array.isArray(value)) return value.map((v) => redactSettings(v, key, home));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactSettings(v, k, home)]));
  }
  if (SECRET_KEY.test(key) && !NOT_SECRET.has(key)) {
    return value === '' || value == null ? value : '[redacted]';
  }
  if (typeof value === 'string') return redactHome(value.replace(/(\w+:\/\/)[^/@\s]+@/g, '$1[redacted]@'), home);
  return value;
}

/**
 * Log lines can carry signed download links, cookies and tokens. Keeps scheme, host and path of
 * URLs (enough to see which site failed) and drops queries, fragments and credentials.
 */
export function redactLogText(text: string, home = homedir()): string {
  return redactHome(text, home)
    .replace(/(\w+:\/\/)[^/@\s"']+@/g, '$1[redacted]@')
    .replace(/(https?:\/\/[^\s"'?#]+)[?#][^\s"']*/g, '$1?[removed]')
    .replace(/("?(?:cookie|token|authorization|x-grabbit-token|secret|password)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi, '$1"[redacted]"')
    .replace(/magnet:\?[^\s"']+/gi, 'magnet:?[removed]');
}

function tail(file: string, bytes: number): string {
  if (!existsSync(file)) return '';
  const size = statSync(file).size;
  const data = readFileSync(file);
  const start = Math.max(0, size - bytes);
  const text = data.subarray(start).toString('utf8');
  // Drop the partial first line when the tail starts mid-file
  return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
}

export interface DiagnosticsInput {
  appVersion: string;
  electronVersion?: string;
  settings: unknown;
  tools?: Record<string, { path?: string; version?: string | null }>;
  items: Pick<DownloadItem, 'status' | 'kind'>[];
  logDir: string;
  now?: Date;
}

export function buildDiagnosticsReport(input: DiagnosticsInput): string {
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const item of input.items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  }
  const tools = Object.entries(input.tools ?? {})
    .map(([name, info]) => `  ${name}: ${info.version ?? 'not found'}`)
    .join('\n');

  const sections = [
    `GRabbit diagnostics, ${(input.now ?? new Date()).toISOString()}`,
    'Secrets, cookies and URL queries have been removed and the home folder is shown as ~. Review before sharing.',
    '',
    '## System',
    `  GRabbit: ${input.appVersion}`,
    `  Electron: ${input.electronVersion ?? 'unknown'}`,
    `  OS: ${platform()} ${release()} (${arch()})`,
    `  Memory: ${(totalmem() / 1024 ** 3).toFixed(1)} GB`,
    '',
    '## Tools',
    tools || '  (not available)',
    '',
    '## Downloads',
    `  total: ${input.items.length}`,
    `  by status: ${JSON.stringify(byStatus)}`,
    `  by kind: ${JSON.stringify(byKind)}`,
    '',
    '## Settings',
    JSON.stringify(redactSettings(input.settings), null, 2),
    '',
    '## Recent log',
    redactLogText(
      tail(join(input.logDir, 'main.old.log'), LOG_TAIL_BYTES / 4) + tail(join(input.logDir, 'main.log'), LOG_TAIL_BYTES)
    ) || '  (empty)',
  ];
  return sections.join('\n') + '\n';
}
