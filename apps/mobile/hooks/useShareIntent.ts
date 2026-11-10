import { useState, useEffect, useCallback } from 'react';
import * as Linking from 'expo-linking';
import { mobileBridge } from '../services/bridge';
import { mobileSettingsManager } from '../services/settings-manager';

export function useShareIntent(onUrlReceived?: (url: string) => void) {
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);

  const processIncomingUri = useCallback((uri: string | null) => {
    if (!uri) return;

    try {
      // Check for grabbit:// scheme
      const parsed = Linking.parse(uri);

      // Handle Desktop RPC pairing URI: grabbit://pair?host=...&port=...&token=...
      if (parsed.path === 'pair' || parsed.hostname === 'pair') {
        const host = parsed.queryParams?.host ? String(parsed.queryParams.host) : '';
        const port = parsed.queryParams?.port ? Number(parsed.queryParams.port) : 31542;
        const token = parsed.queryParams?.token ? String(parsed.queryParams.token) : '';
        if (host) {
          void mobileSettingsManager.updateSettings({
            desktopBridge: {
              enabled: true,
              host,
              port: port || 31542,
              token,
            },
          });
        }
        return;
      }

      let targetUrl: string | null = null;

      if (parsed.queryParams?.url) {
        targetUrl = String(parsed.queryParams.url);
      } else if (parsed.queryParams?.text) {
        targetUrl = String(parsed.queryParams.text);
      } else if (parsed.path && parsed.path.startsWith('http')) {
        targetUrl = parsed.path;
      } else {
        // Plain text intent payload
        targetUrl = uri;
      }

      if (targetUrl) {
        const { valid, url } = mobileBridge.extractAndParseUrl(targetUrl);
        if (valid) {
          setSharedUrl(url);
          onUrlReceived?.(url);
        }
      }
    } catch (err) {
      console.warn('Failed to parse incoming share intent URL:', err);
    }
  }, [onUrlReceived]);

  useEffect(() => {
    // Check initial launch URL
    Linking.getInitialURL().then(processIncomingUri);

    // Listen for incoming deep links or intents while active
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

