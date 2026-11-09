import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { recognizeBytes } from 'shazamio-core';

/**
 * Minimal Shazam client: shazamio-core (WASM, runs locally) turns audio into fingerprints;
 * only those fingerprints are sent to Shazam's public recognition endpoint.
 */
const USER_AGENTS = [
  'Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)',
  'Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-P905V Build/LMY47X)',
  'Dalvik/2.1.0 (Linux; U; Android 5.0; SM-N9005 Build/LRX21V)',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ShazamResponse = { matches?: unknown[]; track?: any };

function endpoint(): string {
  const uuid = () => randomUUID().toUpperCase();
  const url = new URL(`https://amp.shazam.com/discovery/v5/en/US/iphone/-/tag/${uuid()}/${uuid()}`);
  const params: Record<string, string> = {
    sync: 'true',
    webv3: 'true',
    sampling: 'true',
    connected: '',
    shazamapiversion: 'v3',
    sharehub: 'true',
    hubv5minorversion: 'v5.1',
    hidelb: 'true',
    video: 'v3',
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  return url.toString();
}

export async function recognizeAudioFile(
  path: string,
  language = 'en-US',
  signal?: AbortSignal
): Promise<ShazamResponse | null> {
  const signatures = recognizeBytes(readFileSync(path), 0, Number.MAX_SAFE_INTEGER);
  try {
    for (let i = Math.floor(signatures.length / 2); i < signatures.length; i += 4) {
      if (signal?.aborted) return null;
      const body = JSON.stringify({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
        signature: { uri: signatures[i].uri, samplems: signatures[i].samplems },
        timestamp: Date.now(),
        context: {},
        geolocation: {},
      });
      const res = await fetch(endpoint(), {
        method: 'POST',
        body,
        headers: {
          'X-Shazam-Platform': 'IPHONE',
          'X-Shazam-AppVersion': '14.1.0',
          Accept: '*/*',
          'Content-Type': 'application/json',
          'Accept-Language': language,
          'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        },
        signal: signal ?? AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as ShazamResponse;
      if (data?.matches && data.matches.length > 0) return data;
    }
    return null;
  } finally {
    for (const sig of signatures) sig.free();
  }
}
