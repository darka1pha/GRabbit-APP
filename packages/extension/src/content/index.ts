import type { DetectedMediaStream } from '@grabbit/types';
import { extractFileExtension } from '../shared/config';
import type { ExtractedLink } from '../types/extension';

const detectedUrls = new Set<string>();
let snifferEnabled = true;

// Query extension config for sniffer toggle
chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (res) => {
  if (res && res.config && typeof res.config.enableVideoSniffer === 'boolean') {
    snifferEnabled = res.config.enableVideoSniffer;
  }
});

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
  return false;
});

// ---------------------------------------------------------------------------
// Video & Audio Sniffer
// ---------------------------------------------------------------------------

function getMediaTitle(): string {
  return document.title || 'Video Stream';
}

function notifyMediaDetected(stream: DetectedMediaStream): void {
  if (detectedUrls.has(stream.url)) return;
  detectedUrls.add(stream.url);

  chrome.runtime.sendMessage({
    type: 'MEDIA_DETECTED',
    payload: {
      media: stream,
    },
  });
}

function attachFloatingDownloadButton(mediaEl: HTMLMediaElement, streamUrl: string): void {
  if (!snifferEnabled) return;
  if (mediaEl.dataset.grabbitSnifferAttached) return;
  mediaEl.dataset.grabbitSnifferAttached = 'true';

  const container = document.createElement('div');
  container.className = 'grabbit-sniffer-pill';
  container.title = 'GRabbit Video Grabber';

  const btn = document.createElement('button');
  btn.className = 'grabbit-sniffer-btn';
  btn.innerHTML = `<span class="grabbit-icon">🐰</span> Download this video`;

  const closeBtn = document.createElement('span');
  closeBtn.className = 'grabbit-sniffer-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Dismiss';

  container.appendChild(btn);
  container.appendChild(closeBtn);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    btn.innerHTML = `<span class="grabbit-icon">⏳</span> Sending to GRabbit…`;
    btn.classList.add('grabbit-loading');

    chrome.runtime.sendMessage(
      {
        type: 'DOWNLOAD_URL',
        payload: {
          url: streamUrl,
          fileName: `${document.title.replace(/[^\w\s-]/g, '').trim() || 'video'}.mp4`,
          referrer: window.location.href,
        },
      },
      (res) => {
        if (res && res.success) {
          btn.innerHTML = `<span class="grabbit-icon">✅</span> Queued in GRabbit!`;
          btn.classList.remove('grabbit-loading');
          btn.classList.add('grabbit-success');
          setTimeout(() => {
            btn.innerHTML = `<span class="grabbit-icon">🐰</span> Download this video`;
            btn.classList.remove('grabbit-success');
          }, 3500);
        } else {
          btn.innerHTML = `<span class="grabbit-icon">❌</span> Connection failed`;
          btn.classList.remove('grabbit-loading');
          btn.classList.add('grabbit-error');
          setTimeout(() => {
            btn.innerHTML = `<span class="grabbit-icon">🐰</span> Download this video`;
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
  const parent = mediaEl.parentElement || document.body;
  if (window.getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  parent.appendChild(container);
}

function inspectMediaElement(el: HTMLMediaElement): void {
  let src = el.currentSrc || el.src;
  if (!src) {
    const source = el.querySelector<HTMLSourceElement>('source');
    if (source && source.src) {
      src = source.src;
    }
  }

  if (src && src.startsWith('http')) {
    const ext = extractFileExtension(src);
    const isVideo = el instanceof HTMLVideoElement;
    const stream: DetectedMediaStream = {
      url: src,
      title: getMediaTitle(),
      format: isVideo ? 'video' : 'audio',
      quality: isVideo ? `${el.videoWidth || 'HD'}p` : 'Audio',
    };

    notifyMediaDetected(stream);
    attachFloatingDownloadButton(el, src);
  }
}

function scanMediaElements(): void {
  const medias = document.querySelectorAll<HTMLMediaElement>('video, audio');
  for (const media of Array.from(medias)) {
    inspectMediaElement(media);
    media.addEventListener('play', () => inspectMediaElement(media), { once: true });
    media.addEventListener('loadedmetadata', () => inspectMediaElement(media), { once: true });
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

