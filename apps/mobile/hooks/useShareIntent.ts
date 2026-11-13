import { useState, useEffect, useCallback } from 'react';
import * as Linking from 'expo-linking';
import { mobileBridge } from '../services/bridge';
import { mobileSettingsManager } from '../services/settings-manager';

export interface IncomingTransferPayload {
  url: string;
  fileName: string;
  sizeBytes?: number;
}

export interface IncomingPairPayload {
  host: string;
  port: number;
  token: string;
}

export type ParsedDeepLink =
  | { kind: 'pair'; pair: IncomingPairPayload }
  | { kind: 'transfer'; transfer: IncomingTransferPayload }
  | { kind: 'url'; url: string }
  | { kind: 'none' };

/**
 * Pure parser for incoming `grabbit://` deep links and OS share payloads.
 */
export function parseIncomingDeepLink(uri: string | null): ParsedDeepLink {
  if (!uri || !uri.trim()) return { kind: 'none' };
  const raw = uri.trim();

  if (raw.toLowerCase().startsWith('grabbit://')) {
    try {
      const normalized = raw.replace(/^grabbit:\/\//i, 'http://grabbit.local/');
      const u = new URL(normalized);
      const route = (u.hostname === 'grabbit.local' ? u.pathname.replace(/^\/+/, '') : u.hostname).toLowerCase();
      const action = u.pathname.replace(/^\/+/, '').toLowerCase() || route;

      if (action === 'pair' || route === 'pair') {
        const host = u.searchParams.get('host')?.trim() || '';
        const parsedPort = Number(u.searchParams.get('port'));
        const port = Number.isFinite(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535 ? Math.trunc(parsedPort) : 31542;
        const token = u.searchParams.get('token')?.trim() || '';
        if (host) {
          return { kind: 'pair', pair: { host, port, token } };
        }
        return { kind: 'none' };
      }

      if (action === 'transfer' || route === 'transfer') {
        const transferUrl = u.searchParams.get('url')?.trim() || '';
        const name = u.searchParams.get('name')?.trim() || transferUrl.split('/').pop()?.split('?')[0] || 'download.bin';
        const rawSize = u.searchParams.get('size');
        const sizeBytes = rawSize && Number.isFinite(Number(rawSize)) ? Number(rawSize) : undefined;
        if (transferUrl && /^https?:\/\//i.test(transferUrl)) {
          return { kind: 'transfer', transfer: { url: transferUrl, fileName: name, sizeBytes } };
        }
        return { kind: 'none' };
      }
    } catch {
      // fall through to generic URL extraction
    }
  }

  try {
    const parsed = Linking.parse(raw);
    const qpUrl = parsed.queryParams?.url ? String(parsed.queryParams.url) : '';
    const qpText = parsed.queryParams?.text ? String(parsed.queryParams.text) : '';
    const targetUrl =
      qpUrl ||
      qpText ||
      (parsed.path && parsed.path.startsWith('http') ? parsed.path : raw);

    if (targetUrl) {
      const { valid, url } = mobileBridge.extractAndParseUrl(targetUrl);
      if (valid) {
        return { kind: 'url', url };
      }
    }
  } catch {
    const { valid, url } = mobileBridge.extractAndParseUrl(raw);
    if (valid) {
      return { kind: 'url', url };
    }
  }

  return { kind: 'none' };
}

export interface UseShareIntentOptions {
  onUrlReceived?: (url: string) => void;
  onTransferReceived?: (transfer: IncomingTransferPayload) => void;
  onPairReceived?: (pair: IncomingPairPayload) => void;
}

export function useShareIntent(
  onUrlOrOptions?: ((url: string) => void) | UseShareIntentOptions
) {
  const options: UseShareIntentOptions =
    typeof onUrlOrOptions === 'function'
      ? { onUrlReceived: onUrlOrOptions }
      : onUrlOrOptions || {};

  const { onUrlReceived, onTransferReceived, onPairReceived } = options;
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);

  const processIncomingUri = useCallback(
    (uri: string | null) => {
      if (!uri) return;
      try {
        const result = parseIncomingDeepLink(uri);
        if (result.kind === 'pair') {
          void mobileSettingsManager.updateSettings({
            desktopBridge: {
              enabled: true,
              host: result.pair.host,
              port: result.pair.port,
              token: result.pair.token,
            },
          });
          onPairReceived?.(result.pair);
          return;
        }
        if (result.kind === 'transfer') {
          onTransferReceived?.(result.transfer);
          return;
        }
        if (result.kind === 'url') {
          setSharedUrl(result.url);
          onUrlReceived?.(result.url);
        }
      } catch (err) {
        console.warn('Failed to parse incoming share intent URL:', err);
      }
    },
    [onUrlReceived, onTransferReceived, onPairReceived]
  );

  useEffect(() => {
    Linking.getInitialURL().then(processIncomingUri);

    const subscription = Linking.addEventListener('url', (event) => {
      processIncomingUri(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [processIncomingUri]);

  const clearSharedUrl = useCallback(() => {
    setSharedUrl(null);
  }, []);

  return {
    sharedUrl,
    clearSharedUrl,
  };
}
