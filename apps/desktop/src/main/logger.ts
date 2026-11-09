import { appendFile, mkdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let logFile: string | null = null;
let minLevel: Level = process.env.GRABBIT_DEBUG ? 'debug' : 'info';

/** Starts writing logs to <dir>/main.log (rotated at 5 MB). */
export function initLogger(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, 'main.log');
    try {
      if (statSync(logFile).size > MAX_LOG_BYTES) renameSync(logFile, join(dir, 'main.old.log'));
    } catch {
      // No log yet
    }
  } catch {
    logFile = null;
  }
}

export function setLogLevel(level: Level): void {
  minLevel = level;
}

function serialize(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v));
  } catch {
    return String(value);
  }
}

function write(level: Level, objOrMsg: unknown, msg?: string): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const text =
    typeof objOrMsg === 'string' ? objOrMsg : `${msg ?? ''} ${serialize(objOrMsg)}`.trim();
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${text}\n`;
  if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
    (level === 'error' ? console.error : console.log)(line.trimEnd());
  }
  if (logFile) appendFile(logFile, line, () => undefined);
}

/** pino-like API so the ported bot code keeps its call sites. */
export const logger = {
  debug: (o: unknown, m?: string) => write('debug', o, m),
  info: (o: unknown, m?: string) => write('info', o, m),
  warn: (o: unknown, m?: string) => write('warn', o, m),
  error: (o: unknown, m?: string) => write('error', o, m),
};
