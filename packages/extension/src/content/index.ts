import type { DetectedMediaStream } from '@grabbit/types';
import {
  extractFileExtension,
  isDirectMediaFileUrl,
  isStreamingMediaUrl,
} from '../shared/config';
import type { ExtractedLink } from '../types/extension';

const detectedStreams = new Map<string, DetectedMediaStream>();
let snifferEnabled = true;

// Query extension config for sniffer toggle
try {
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.config && typeof res.config.enableVideoSniffer === 'boolean') {
      snifferEnabled = res.config.enableVideoSniffer;
    }
  });
} catch {
  // ignore
}

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

function inspectMediaElement(el: HTMLMediaElement): void {
  let rawSrc = el.currentSrc || el.src;
  if (!rawSrc) {
    const source = el.querySelector<HTMLSourceElement>('source');
    if (source && source.src) {
      rawSrc = source.src;
    }
  }

  const pageUrl = window.location.href;
  const isStreamingSite = isStreamingMediaUrl(pageUrl);

  // For MSE blob: streams (YouTube, Instagram, TikTok, X, Twitch, Vimeo, etc.)
  // or streaming platform video elements, use the page URL so yt-dlp resolves it.
  let targetUrl = '';
  if (rawSrc && rawSrc.startsWith('http') && !isStreamingSite) {
    targetUrl = rawSrc;
  } else if ((rawSrc && rawSrc.startsWith('blob:')) || isStreamingSite) {
    targetUrl = pageUrl;
  }

  if (targetUrl && targetUrl.startsWith('http')) {
    const isVideo = el instanceof HTMLVideoElement;
    const height = isVideo && el.videoHeight ? `${el.videoHeight}p` : isVideo ? 'HD Video' : 'Audio';
    const stream: DetectedMediaStream = {
      url: targetUrl,
      title: getMediaTitle(),
      format: isVideo ? 'video' : 'audio',
      quality: height,
    };

    notifyMediaDetected(stream);
    attachFloatingDownloadButton(el, targetUrl);
  }
}

function scanMediaElements(): void {
  const medias = document.querySelectorAll<HTMLMediaElement>('video, audio');
  for (const media of Array.from(medias)) {
    inspectMediaElement(media);
    media.addEventListener('play', () => inspectMediaElement(media), { once: true });
    media.addEventListener('loadedmetadata', () => inspectMediaElement(media), { once: true });
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

// Observe DOM mutations for dynamically inserted video/audio elements (YouTube, Twitch, Netflix, etc.)
const observer = new MutationObserver(() => {
  scanMediaElements();
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
  scanMediaElements();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scanMediaElements();
  });
}

