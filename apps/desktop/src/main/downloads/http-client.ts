import http, { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import https from 'node:https';
import { HttpStatusError, InvalidUrlError } from '../media/errors';

const MAX_REDIRECTS = 10;
/** A connection that delivers no data for this long is dropped and retried. */
const STALL_TIMEOUT_MS = 30_000;

let agents = createAgents('');

function createAgents(proxy: string): { http: http.Agent; https: https.Agent } {
  const proxyEnv = proxy ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NO_PROXY: 'localhost,127.0.0.1,::1' } : undefined;
  const common = { keepAlive: true, maxSockets: 256, ...(proxyEnv ? { proxyEnv } : {}) };
  return { http: new http.Agent(common), https: new https.Agent(common) };
}

/** Routes download-manager traffic through an HTTP(S) proxy, or directly when empty. */
export function configureHttpProxy(proxy: string): void {
  agents.http.destroy();
  agents.https.destroy();
  agents = createAgents(proxy.trim());
}

export interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: IncomingMessage;
  finalUrl: string;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function requestOnce(url: URL, options: HttpRequestOptions): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const req = (isHttps ? https : http).request(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      agent: isHttps ? agents.https : agents.http,
      signal: options.signal,
    });
    req.setTimeout(STALL_TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' }));
    });
    req.once('response', resolve);
    req.once('error', reject);
    req.end();
  });
}

/** GET/HEAD with manual redirect handling (so the final URL is known). */
export async function httpRequest(rawUrl: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidUrlError('Malformed URL');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new InvalidUrlError(`Unsupported protocol ${url.protocol}`);
    }
    const res = await requestOnce(url, options);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if ([301, 302, 303, 307, 308].includes(status) && location) {
      res.resume();
      url = new URL(location, url);
      continue;
    }
    return { status, headers: res.headers, body: res, finalUrl: url.toString() };
  }
  throw new HttpStatusError(310, 'Too many redirects');
}

/** Parses "bytes 0-99/1234" (and "bytes 0-99/*"). */
export function parseContentRange(value?: string): { start: number; end: number; total: number | null } | null {
  if (!value) return null;
  const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(value);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3]),
  };
}

/** Header values sometimes arrive as raw UTF-8 bytes that Node decoded as latin1. */
function fixMojibake(value: string): string {
  if (!/[\u0080-\u00ff]/.test(value)) return value;
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? value : decoded;
}

export function filenameFromContentDisposition(header?: string): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
    } catch {
      // fall back to the plain parameter
    }
  }
  const plain = /filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i.exec(header);
  if (!plain) return null;
  const value = (plain[1] ?? plain[2] ?? '').replace(/\\(.)/g, '$1').trim();
  if (!value) return null;
  try {
    return fixMojibake(/%[0-9a-f]{2}/i.test(value) ? decodeURIComponent(value) : value);
  } catch {
    return fixMojibake(value);
  }
}

export function filenameFromUrl(rawUrl: string): string | null {
  try {
    const last = new URL(rawUrl).pathname.split('/').filter(Boolean).pop();
    if (!last) return null;
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return null;
  }
}

export function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
