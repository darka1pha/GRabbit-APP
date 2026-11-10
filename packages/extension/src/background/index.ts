import type { DetectedMediaStream, RpcAddDownloadRequest } from '@grabbit/types';
import {
  compareSemver,
  extractFileExtension,
  extractFilenameFromUrl,
  loadExtensionConfig,
  saveExtensionConfig,
  shouldInterceptDownload,
} from '../shared/config';
import { ExtensionRpcClient } from '../shared/rpc-client';
import type {
  DownloadBatchPayload,
  DownloadUrlPayload,
  ExtensionConfig,
  ExtensionMessage,
  ExtensionUpdateInfo,
  ExtractedLink,
  MediaDetectedPayload,
} from '../types/extension';

const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/darka1pha/GRabbit-APP/releases/latest';
const GITHUB_RELEASES_PAGE = 'https://github.com/darka1pha/GRabbit-APP/releases/latest';

async function checkExtensionUpdate(autoInstall = true): Promise<ExtensionUpdateInfo> {
  const currentVersion =
    (typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : null) ||
    '1.1.0';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(GITHUB_LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        ok: false,
        currentVersion,
        updateAvailable: false,
        error: `GitHub API returned HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const rawTag = String(data?.tag_name || '').trim();
    const latestVersion = rawTag.replace(/^v/i, '') || currentVersion;
    const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;

    const assets: Array<{ name?: string; browser_download_url?: string }> = Array.isArray(data?.assets)
      ? data.assets
      : [];
    const extAsset =
      assets.find((a) => a.name && /extension.*\.zip$/i.test(a.name)) ||
      assets.find((a) => a.name && /\.zip$/i.test(a.name));

    const downloadUrl =
      extAsset?.browser_download_url ||
      `https://github.com/darka1pha/GRabbit-APP/releases/latest/download/GRabbit-Chrome-Extension-v${latestVersion}.zip`;
    const releaseUrl = data?.html_url || GITHUB_RELEASES_PAGE;

    let installed = false;
    let downloaded = false;

    if (updateAvailable && autoInstall && downloadUrl) {
      try {
        const config = await loadExtensionConfig();
        const rpc = new ExtensionRpcClient(config);
        const installRes = await rpc.installExtensionUpdate(downloadUrl, latestVersion);
        if (installRes.success) {
          installed = true;
          downloaded = true;
        } else {
          const dlRes = await rpc.addDownload({
            url: downloadUrl,
            fileName: `GRabbit-Chrome-Extension-v${latestVersion}.zip`,
          });
          if (dlRes.success) {
            downloaded = true;
          } else if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
            await chrome.downloads.download({
              url: downloadUrl,
              filename: `GRabbit-Chrome-Extension-v${latestVersion}.zip`,
            });
            downloaded = true;
          }
        }
      } catch {
        // ignore fallback errors
      }
    }

    return {
      ok: true,
      currentVersion,
      latestVersion,
      updateAvailable,
      downloadUrl,
      releaseUrl,
      installed,
      downloaded,
    };
  } catch (err) {
    return {
      ok: false,
      currentVersion,
      updateAvailable: false,
      error: err instanceof Error ? err.message : 'Could not reach GitHub Releases',
    };
  }
}

// In-memory tab media registry: tabId -> DetectedMediaStream[]
const tabMediaMap = new Map<number, DetectedMediaStream[]>();
const interceptedDownloadIds = new Set<number>();

// Initialize context menus and inject content scripts into open tabs on install/update
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  void injectIntoOpenTabs();
});

// Ensure context menus exist on service worker wakeup
setupContextMenus();

async function injectIntoOpenTabs(): Promise<void> {
  try {
    if (!chrome.tabs || !chrome.scripting) return;
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/styles.css'],
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/index.js'],
        });
      } catch {
        // Ignore restricted tabs (e.g. Chrome Web Store)
      }
    }
  } catch {
    // ignore
  }
}

function setupContextMenus(): void {
  try {
    chrome.contextMenus.removeAll().then(() => {
      chrome.contextMenus.create({
        id: 'grabbit-download-link',
        title: 'Download with GRabbit',
        contexts: ['link', 'image', 'video', 'audio', 'selection'],
      });

      chrome.contextMenus.create({
        id: 'grabbit-download-all',
        title: 'Download all links with GRabbit',
        contexts: ['page'],
      });

      chrome.contextMenus.create({
        id: 'grabbit-grab-media',
        title: 'Grab page media with GRabbit',
        contexts: ['page'],
      });
    });
  } catch (err) {
    console.warn('[GRabbit Extension] Failed to setup context menus:', err);
  }
}

async function getCookiesHeader(url: string): Promise<string> {
  try {
    if (chrome.cookies && chrome.cookies.getAll) {
      const cookies = await chrome.cookies.getAll({ url });
      if (cookies && cookies.length > 0) {
        return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      }
    }
  } catch {
    // Ignore cookie retrieval failure
  }
  return '';
}

function showNotification(title: string, message: string): void {
  try {
    if (chrome.notifications && chrome.notifications.create) {
      void chrome.notifications.create(`grabbit-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: `🐰 ${title}`,
        message,
      });
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Context menu actions
// ---------------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const config = await loadExtensionConfig();
  const rpc = new ExtensionRpcClient(config);

  if (info.menuItemId === 'grabbit-download-link') {
    let targetUrl = info.linkUrl || info.srcUrl;
    if (!targetUrl && info.selectionText) {
      const text = info.selectionText.trim();
      if (/^https?:\/\//i.test(text)) {
        targetUrl = text;
      }
    }

    if (!targetUrl) {
      showNotification('GRabbit', 'No valid download link found in selection.');
      return;
    }

    const cookies = await getCookiesHeader(targetUrl);
    const res = await rpc.addDownload({
      url: targetUrl,
      referrer: info.pageUrl || tab?.url,
      cookies,
      userAgent: navigator.userAgent,
    });

    if (res.success) {
      showNotification('Download Queued', `Sent to GRabbit: ${res.item?.fileName || targetUrl}`);
    } else {
      showNotification('Connection Error', res.error || 'Failed to connect to GRabbit Desktop.');
    }
  } else if (info.menuItemId === 'grabbit-download-all') {
    if (!tab?.id) return;
    try {
      let links: ExtractedLink[] | undefined;
      try {
        links = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_PAGE_LINKS',
        });
      } catch {
        // Content script wasn't loaded on this tab yet — inject and retry
        if (chrome.scripting && chrome.scripting.executeScript) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/index.js'],
          });
          links = await chrome.tabs.sendMessage(tab.id, {
            type: 'EXTRACT_PAGE_LINKS',
          });
        }
      }

      if (!links || links.length === 0) {
        showNotification('GRabbit', 'No downloadable links found on this page.');
        return;
      }

      const items: RpcAddDownloadRequest[] = [];
      for (const link of links) {
        items.push({
          url: link.url,
          fileName: link.fileName,
          referrer: tab.url,
          userAgent: navigator.userAgent,
        });
      }

      const batchRes = await rpc.addBatch({ items });
      if (batchRes.success) {
        showNotification(
          'Batch Import Complete',
          `Queued ${batchRes.count ?? items.length} downloads in GRabbit.`
        );
      } else {
        showNotification('Batch Failed', batchRes.error || 'Could not queue batch downloads.');
      }
    } catch {
      showNotification('GRabbit', 'Could not read links from current tab.');
    }
  } else if (info.menuItemId === 'grabbit-grab-media') {
    const pageUrl = tab?.url || info.pageUrl;
    if (!pageUrl) return;

    const cookies = await getCookiesHeader(pageUrl);
    const res = await rpc.addDownload({
      url: pageUrl,
      referrer: pageUrl,
      cookies,
      userAgent: navigator.userAgent,
    });

    if (res.success) {
      showNotification('Media Grabbed', `Enqueued: ${res.item?.fileName || pageUrl}`);
    } else {
      showNotification('Grab Failed', res.error || 'Could not grab media from this page.');
    }
  }
});

// ---------------------------------------------------------------------------
// Automatic Download Interception
// ---------------------------------------------------------------------------

async function tryInterceptDownload(
  downloadItem: chrome.downloads.DownloadItem,
  suggestedFilename?: string
): Promise<void> {
  if (interceptedDownloadIds.has(downloadItem.id)) return;

  const config = await loadExtensionConfig();
  if (!config.interceptDownloads) return;

  const url = downloadItem.finalUrl || downloadItem.url;
  const originalUrl = downloadItem.url;
  const rawFilename = suggestedFilename || downloadItem.filename || '';

  if (
    !shouldInterceptDownload(
      url,
      rawFilename,
      config,
      downloadItem.totalBytes,
      originalUrl,
      downloadItem.mime
    )
  ) {
    return;
  }

  // Mark immediately to prevent duplicate triggers from onCreated / onDeterminingFilename / onChanged
  interceptedDownloadIds.add(downloadItem.id);

  // Pause browser download immediately so Chrome does not complete or show Save-As while contacting Desktop
  try {
    await chrome.downloads.pause(downloadItem.id);
  } catch {
    // ignore if already paused or not pausable
  }

  const rpc = new ExtensionRpcClient(config);
  const cookies = await getCookiesHeader(url);
  const cleanFileName = rawFilename
    ? rawFilename.replace(/.*[/\\]/, '')
    : extractFilenameFromUrl(url) || extractFilenameFromUrl(originalUrl);

  const res = await rpc.addDownload(
    {
      url,
      fileName: cleanFileName,
      referrer: downloadItem.referrer,
      cookies,
      userAgent: navigator.userAgent,
    },
    4000
  );

  if (res.success) {
    // Successfully handed off to GRabbit Desktop — cancel and erase the browser download
    try {
      await chrome.downloads.cancel(downloadItem.id);
      await chrome.downloads.erase({ id: downloadItem.id });
    } catch (err) {
      console.warn('[GRabbit Extension] Could not cancel browser download:', err);
    }

    showNotification(
      'Download Captured',
      `Transferred to GRabbit: ${cleanFileName || res.item?.fileName || url}`
    );
  } else {
    // GRabbit Desktop is not running or unreachable — let the browser finish downloading normally
    interceptedDownloadIds.delete(downloadItem.id);
    try {
      await chrome.downloads.resume(downloadItem.id);
    } catch {
      // ignore
    }
  }
}

chrome.downloads.onCreated.addListener((downloadItem) => {
  void tryInterceptDownload(downloadItem);
});

if (chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    // Allow Chrome's default filename suggestion to proceed while tryInterceptDownload pauses/cancels if matched
    try {
      suggest();
    } catch {
      // ignore
    }
    void tryInterceptDownload(downloadItem, downloadItem.filename);
  });
}

chrome.downloads.onChanged.addListener((delta) => {
  if ((delta.filename?.current || delta.mime?.current) && !interceptedDownloadIds.has(delta.id)) {
    chrome.downloads.search({ id: delta.id }, (items) => {
      if (items && items[0] && items[0].state === 'in_progress') {
        void tryInterceptDownload(items[0], delta.filename?.current);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Message Hub
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? 0;

  if (message.type === 'MEDIA_DETECTED') {
    const payload = message.payload as MediaDetectedPayload;
    const media = payload.media;
    const currentTabId = payload.tabId || tabId;

    if (!tabMediaMap.has(currentTabId)) {
      tabMediaMap.set(currentTabId, []);
    }
    const list = tabMediaMap.get(currentTabId)!;
    if (!list.some((m) => m.url === media.url)) {
      list.push(media);
    }
    sendResponse({ ok: true, count: list.length });
    return true;
  }

  if (message.type === 'GET_PAGE_MEDIA') {
    const targetTabId = (message.payload as { tabId?: number })?.tabId || tabId;
    const list = tabMediaMap.get(targetTabId) || [];
    sendResponse({ ok: true, media: list });
    return true;
  }

  if (message.type === 'DOWNLOAD_URL') {
    const payload = message.payload as DownloadUrlPayload;
    void (async () => {
      const config = await loadExtensionConfig();
      const rpc = new ExtensionRpcClient(config);
      const cookies = payload.cookies || (await getCookiesHeader(payload.url));
      const res = await rpc.addDownload({
        url: payload.url,
        fileName: payload.fileName,
        referrer: payload.referrer,
        cookies,
        userAgent: navigator.userAgent,
        startPaused: payload.startPaused,
      });
      if (res.success) {
        showNotification(
          'Download Captured',
          `Transferred to GRabbit: ${res.item?.fileName || payload.fileName || payload.url}`
        );
      }
      sendResponse(res);
    })();
    return true;
  }

  if (message.type === 'DOWNLOAD_BATCH') {
    const payload = message.payload as DownloadBatchPayload;
    void (async () => {
      const config = await loadExtensionConfig();
      const rpc = new ExtensionRpcClient(config);
      const res = await rpc.addBatch(payload);
      sendResponse(res);
    })();
    return true;
  }

  if (message.type === 'CHECK_CONNECTION') {
    void (async () => {
      const config = await loadExtensionConfig();
      const rpc = new ExtensionRpcClient(config);
      const ping = await rpc.ping();
      let statusData;
      if (ping.ok) {
        const s = await rpc.status();
        if (s.ok) statusData = s.data;
      }
      sendResponse({
        ok: ping.ok,
        authenticated: ping.data?.authenticated ?? false,
        version: ping.data?.version,
        port: ping.data?.port ?? config.bridgePort,
        status: statusData,
        error: ping.error,
      });
    })();
    return true;
  }

  if (message.type === 'GET_CONFIG') {
    void (async () => {
      const config = await loadExtensionConfig();
      const rpc = new ExtensionRpcClient(config);
      const ping = await rpc.ping(800);
      sendResponse({
        ok: true,
        config,
        connected: Boolean(ping.ok && ping.data?.authenticated),
      });
    })();
    return true;
  }

  if (message.type === 'SAVE_CONFIG') {
    const patch = message.payload as Partial<ExtensionConfig>;
    void (async () => {
      const updated = await saveExtensionConfig(patch);
      sendResponse({ ok: true, config: updated });
    })();
    return true;
  }

  if (message.type === 'CHECK_EXTENSION_UPDATE') {
    void (async () => {
      const payload = message.payload as { autoInstall?: boolean } | undefined;
      const info = await checkExtensionUpdate(payload?.autoInstall !== false);
      sendResponse(info);
      if (info.installed) {
        await injectIntoOpenTabs();
        setTimeout(() => {
          try {
            chrome.runtime.reload();
          } catch {
            // ignore
          }
        }, 600);
      }
    })();
    return true;
  }

  if (message.type === 'RELOAD_EXTENSION') {
    void (async () => {
      await injectIntoOpenTabs();
      sendResponse({ ok: true });
      setTimeout(() => {
        try {
          chrome.runtime.reload();
        } catch {
          // ignore
        }
      }, 150);
    })();
    return true;
  }

  return false;
});

