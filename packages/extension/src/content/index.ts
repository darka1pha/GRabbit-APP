import type { DetectedMediaStream } from '@grabbit/types';
import {
  DEFAULT_EXTENSION_CONFIG,
  extractFileExtension,
  extractFilenameFromUrl,
  isDirectMediaFileUrl,
  isStreamingMediaUrl,
  isHlsOrDashUrl,
  shouldInterceptDownload,
} from '../shared/config';
import type { ExtensionConfig, ExtractedLink } from '../types/extension';

const detectedStreams = new Map<string, DetectedMediaStream>();
let snifferEnabled = true;
let currentConfig: ExtensionConfig = { ...DEFAULT_EXTENSION_CONFIG };
let desktopConnected = false;

function refreshConfigAndConnection(): void {
  try {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.config) {
        currentConfig = res.config;
        if (typeof res.config.enableVideoSniffer === 'boolean') {
          snifferEnabled = res.config.enableVideoSniffer;
        }
      }
      if (res && typeof res.connected === 'boolean') {
        desktopConnected = res.connected;
      }
    });
  } catch {
    // ignore
  }
}

// Query extension config & Desktop connection status on load and when window gains focus
refreshConfigAndConnection();
window.addEventListener('focus', refreshConfigAndConnection);

// Intercept direct clicks on downloadable <a href="..."> links when GRabbit Desktop is online
// (Hold Alt while clicking to bypass GRabbit and use the browser's built-in downloader)
document.addEventListener(
  'click',
  (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
      return;
    }
    if (!currentConfig.interceptDownloads || !desktopConnected) {
      return;
    }

    const target = e.target as HTMLElement | null;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || !anchor.href) return;

    const href = anchor.href;
    if (!href.startsWith('http://') && !href.startsWith('https://')) return;

    // Do not intercept navigation to streaming social media pages (those use the floating video grabber)
    if (isStreamingMediaUrl(href) && !extractFileExtension(href)) return;

    const downloadAttr = anchor.getAttribute('download') || '';
    if (!shouldInterceptDownload(href, downloadAttr, currentConfig)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const fileName = downloadAttr || extractFilenameFromUrl(href);
    try {
      chrome.runtime.sendMessage(
        {
          type: 'DOWNLOAD_URL',
          payload: {
            url: href,
            fileName,
            referrer: window.location.href,
          },
        },
        (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            // Fallback: if Desktop went offline right before click, let browser navigate/download
            desktopConnected = false;
            window.location.assign(href);
          }
        }
      );
    } catch {
      window.location.assign(href);
    }
  },
  true
);

// ---------------------------------------------------------------------------
// Link Extractor for "Download all links"
// ---------------------------------------------------------------------------

function extractDownloadableLinks(): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seenUrls = new Set<string>();
  const elements = document.querySelectorAll<HTMLAnchorElement>('a[href]');

  for (const el of Array.from(elements)) {
    try {
      const href = el.href;
      if (!href || !href.startsWith('http')) continue;
      if (seenUrls.has(href)) continue;

      const ext = extractFileExtension(href);
      const text = el.innerText?.trim() || el.title?.trim() || ext || 'File';

      seenUrls.add(href);
      links.push({
        url: href,
        text: text.slice(0, 100),
        fileName: href.split('/').pop()?.split('?')[0],
      });
    } catch {
      // ignore
    }
  }

  return links;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE_LINKS') {
    sendResponse(extractDownloadableLinks());
    return true;
  }
  if (message.type === 'SCAN_PAGE_MEDIA') {
    scanMediaElements();
    sendResponse({ ok: true, media: Array.from(detectedStreams.values()) });
    return true;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Video & Audio Sniffer
// ---------------------------------------------------------------------------

function getMediaTitle(): string {
  return document.title?.replace(/\s*-\s*YouTube$/i, '').trim() || 'Video Stream';
}

function notifyMediaDetected(stream: DetectedMediaStream): void {
  if (detectedStreams.has(stream.url)) return;
  detectedStreams.set(stream.url, stream);

  try {
    chrome.runtime.sendMessage({
      type: 'MEDIA_DETECTED',
      payload: {
        media: stream,
      },
    });
  } catch {
    // ignore if extension context invalidated
  }
}

function attachFloatingDownloadButton(mediaEl: HTMLMediaElement, streamUrl: string): void {
  if (!snifferEnabled) return;
  if (mediaEl.dataset.grabbitSnifferAttached === streamUrl) return;
  mediaEl.dataset.grabbitSnifferAttached = streamUrl;

  const parent = mediaEl.parentElement || document.body;
  const existingPill = parent.querySelector<HTMLElement>('.grabbit-sniffer-pill');
  if (existingPill) {
    existingPill.dataset.streamUrl = streamUrl;
    return;
  }

  const container = document.createElement('div');
  container.className = 'grabbit-sniffer-pill';
  container.title = 'GRabbit Video Grabber';
  container.dataset.streamUrl = streamUrl;

  const btn = document.createElement('button');
  btn.className = 'grabbit-sniffer-btn';
  btn.innerHTML = `<span class="grabbit-icon">🐰</span> Download with GRabbit`;

  const closeBtn = document.createElement('span');
  closeBtn.className = 'grabbit-sniffer-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Dismiss';

  container.appendChild(btn);
  container.appendChild(closeBtn);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const targetUrl =
      container.dataset.streamUrl && !container.dataset.streamUrl.startsWith('blob:')
        ? container.dataset.streamUrl
        : window.location.href;

    btn.innerHTML = `<span class="grabbit-icon">⏳</span> Sending to GRabbit…`;
    btn.classList.add('grabbit-loading');

    const payload: { url: string; fileName?: string; referrer: string } = {
      url: targetUrl,
      referrer: window.location.href,
    };
    if (isDirectMediaFileUrl(targetUrl) && !isStreamingMediaUrl(targetUrl)) {
      payload.fileName = `${getMediaTitle().replace(/[^\w\s-]/g, '').trim() || 'video'}.mp4`;
    }

    chrome.runtime.sendMessage(
      {
        type: 'DOWNLOAD_URL',
        payload,
      },
      (res) => {
        if (res && res.success) {
          btn.innerHTML = `<span class="grabbit-icon">✅</span> Queued in GRabbit!`;
          btn.classList.remove('grabbit-loading');
          btn.classList.add('grabbit-success');
          setTimeout(() => {
            btn.innerHTML = `<span class="grabbit-icon">🐰</span> Download with GRabbit`;
            btn.classList.remove('grabbit-success');
          }, 3500);
        } else {
          btn.innerHTML = `<span class="grabbit-icon">❌</span> ${res?.error ? 'Error' : 'Connection failed'}`;
          btn.title = res?.error || 'Could not reach GRabbit Desktop';
          btn.classList.remove('grabbit-loading');
          btn.classList.add('grabbit-error');
          setTimeout(() => {
            btn.innerHTML = `<span class="grabbit-icon">🐰</span> Download with GRabbit`;
            btn.classList.remove('grabbit-error');
          }, 3500);
        }
      }
    );
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    container.style.display = 'none';
  });

  // Position pill near media element
  if (window.getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  parent.appendChild(container);
}

function isCurrentSiteExcluded(): boolean {
  const host = window.location.hostname.toLowerCase();
  return (currentConfig.excludedDomains || []).some((d) => {
    const target = d.trim().toLowerCase();
    if (!target) return false;
    return host === target || host.endsWith('.' + target);
  });
}

function inspectMediaElement(el: HTMLMediaElement): void {
  if (isCurrentSiteExcluded() || !snifferEnabled) return;

  let rawSrc = el.currentSrc || el.src;
  if (!rawSrc) {
    const source = el.querySelector<HTMLSourceElement>('source');
    if (source && source.src) {
      rawSrc = source.src;
    }
  }

  const pageUrl = window.location.href;
  const isStreamingSite = isStreamingMediaUrl(pageUrl);
  const isHlsDash = isHlsOrDashUrl(rawSrc);

  // For HLS/DASH manifest URLs (.m3u8/.mpd), pass the manifest directly (yt-dlp handles them).
  // For MSE blob: streams or streaming platform pages, use the page URL.
  let targetUrl = '';
  if (rawSrc && (isHlsDash || (rawSrc.startsWith('http') && !isStreamingSite))) {
    targetUrl = rawSrc;
  } else if ((rawSrc && rawSrc.startsWith('blob:')) || isStreamingSite) {
    targetUrl = pageUrl;
  }

  if (targetUrl && targetUrl.startsWith('http')) {
    const isVideo = el instanceof HTMLVideoElement;
    let quality = isVideo && el.videoHeight ? `${el.videoHeight}p` : isVideo ? 'HD Video' : 'Audio';
    if (isHlsDash) {
      quality = rawSrc.toLowerCase().includes('.m3u8') ? 'HLS Stream (.m3u8)' : 'DASH Manifest (.mpd)';
    }

    const stream: DetectedMediaStream = {
      url: targetUrl,
      title: getMediaTitle(),
      format: isVideo ? 'video' : 'audio',
      quality,
    };

    notifyMediaDetected(stream);
    attachFloatingDownloadButton(el, targetUrl);
  }
}

function scanMediaElements(): void {
  if (isCurrentSiteExcluded() || !snifferEnabled) return;

  const medias = document.querySelectorAll<HTMLMediaElement>('video, audio');
  for (const media of Array.from(medias)) {
    inspectMediaElement(media);
    media.addEventListener('play', () => inspectMediaElement(media), { once: true });
    media.addEventListener('loadedmetadata', () => inspectMediaElement(media), { once: true });
  }

  // Also query <source> tags with HLS/DASH manifests
  const sources = document.querySelectorAll<HTMLSourceElement>('source[src*=".m3u8"], source[src*=".mpd"]');
  for (const srcEl of Array.from(sources)) {
    const parentMedia = srcEl.closest<HTMLMediaElement>('video, audio');
    if (parentMedia) {
      inspectMediaElement(parentMedia);
    }
  }

  // Also detect supported streaming pages even before <video> finishes mounting
  if (medias.length === 0 && isStreamingMediaUrl(window.location.href)) {
    notifyMediaDetected({
      url: window.location.href,
      title: getMediaTitle(),
      format: 'video',
      quality: 'Best Available',
    });
  }
}

// ---------------------------------------------------------------------------
// Debounced & Tab-Visibility Aware MutationObserver (Item 7.1)
// ---------------------------------------------------------------------------

let scanTimeout: any = null;
function scheduleMediaScan(): void {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(() => {
    scanMediaElements();
  }, 250);
}

function hasMediaNodes(nodes: NodeList): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'video' || tag === 'audio' || tag === 'source') return true;
    if (el.querySelector?.('video, audio, source')) return true;
  }
  return false;
}

const observer = new MutationObserver((mutations) => {
  let hasMedia = false;
  for (const m of mutations) {
    if (m.addedNodes && hasMediaNodes(m.addedNodes)) {
      hasMedia = true;
      break;
    }
  }
  if (hasMedia) {
    scheduleMediaScan();
  }
});

let isObserving = false;

function startObserver(): void {
  if (isObserving || isCurrentSiteExcluded() || !snifferEnabled || !document.body) return;
  observer.observe(document.body, { childList: true, subtree: true });
  isObserving = true;
}

function stopObserver(): void {
  if (!isObserving) return;
  observer.disconnect();
  isObserving = false;
}

// Disconnect observer when page is hidden in background tab to save CPU/battery, reconnect on visible
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopObserver();
  } else if (document.visibilityState === 'visible') {
    startObserver();
    scheduleMediaScan();
  }
});

if (document.body) {
  startObserver();
  scheduleMediaScan();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    startObserver();
    scheduleMediaScan();
  });
}

