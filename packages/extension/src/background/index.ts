import type { DetectedMediaStream, RpcAddDownloadRequest } from '@grabbit/types';
import {
  extractFileExtension,
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
  ExtractedLink,
  MediaDetectedPayload,
} from '../types/extension';

// In-memory tab media registry: tabId -> DetectedMediaStream[]
const tabMediaMap = new Map<number, DetectedMediaStream[]>();

// Initialize context menus on extension install or update
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

function setupContextMenus(): void {
  try {
    chrome.contextMenus.removeAll().then(() => {
      chrome.contextMenus.create({
        id: 'grabbit-download-link',
        title: 'Download with gRabbit',
        contexts: ['link', 'image', 'video', 'audio', 'selection'],
      });

      chrome.contextMenus.create({
        id: 'grabbit-download-all',
        title: 'Download all links with gRabbit',
        contexts: ['page'],
      });

      chrome.contextMenus.create({
        id: 'grabbit-grab-media',
        title: 'Grab page media with gRabbit',
        contexts: ['page'],
      });
    });
  } catch (err) {
    console.warn('[gRabbit Extension] Failed to setup context menus:', err);
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
      showNotification('gRabbit', 'No valid download link found in selection.');
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
      showNotification('Download Queued', `Sent to gRabbit: ${res.item?.fileName || targetUrl}`);
    } else {
      showNotification('Connection Error', res.error || 'Failed to connect to gRabbit Desktop.');
    }
  } else if (info.menuItemId === 'grabbit-download-all') {
    if (!tab?.id) return;
    try {
      const links: ExtractedLink[] = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_PAGE_LINKS',
      });

      if (!links || links.length === 0) {
        showNotification('gRabbit', 'No downloadable links found on this page.');
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
          `Queued ${batchRes.count ?? items.length} downloads in gRabbit.`
        );
      } else {
        showNotification('Batch Failed', batchRes.error || 'Could not queue batch downloads.');
      }
    } catch {
      showNotification('gRabbit', 'Could not read links from current tab.');
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

chrome.downloads.onCreated.addListener(async (downloadItem) => {
  const config = await loadExtensionConfig();
  if (!config.interceptDownloads) {
    return;
  }

  const url = downloadItem.finalUrl || downloadItem.url;
  const filename = downloadItem.filename;

  if (!shouldInterceptDownload(url, filename, config, downloadItem.totalBytes)) {
    return;
  }

  // Intercepting download: cancel browser download
  try {
    await chrome.downloads.cancel(downloadItem.id);
    await chrome.downloads.erase({ id: downloadItem.id });
  } catch (err) {
    console.warn('[gRabbit Extension] Could not cancel browser download:', err);
  }

  const cookies = await getCookiesHeader(url);
  const rpc = new ExtensionRpcClient(config);

  const cleanFileName = filename ? filename.replace(/.*[/\\]/, '') : undefined;
  const res = await rpc.addDownload({
    url,
    fileName: cleanFileName,
    referrer: downloadItem.referrer,
    cookies,
    userAgent: navigator.userAgent,
  });

  if (res.success) {
    showNotification(
      'Download Captured',
      `Transferred to gRabbit: ${cleanFileName || url}`
    );
  } else {
    showNotification(
      'gRabbit Bridge Offline',
      `Could not send download to gRabbit. Please ensure gRabbit is running.`
    );
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
      sendResponse({ ok: true, config });
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

  return false;
});

