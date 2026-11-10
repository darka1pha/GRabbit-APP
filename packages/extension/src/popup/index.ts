import type { DetectedMediaStream, RpcStatusResponse } from '@grabbit/types';
import { isDirectMediaFileUrl, isStreamingMediaUrl } from '../shared/config';
import type { ExtensionConfig, ExtensionUpdateInfo } from '../types/extension';

const connectionStatusEl = document.getElementById('connectionStatus')!;
const urlInputEl = document.getElementById('urlInput') as HTMLInputElement;
const addBtnEl = document.getElementById('addBtn') as HTMLButtonElement;
const quickAddMsgEl = document.getElementById('quickAddMessage')!;
const interceptToggleEl = document.getElementById('interceptToggle') as HTMLInputElement;
const snifferToggleEl = document.getElementById('snifferToggle') as HTMLInputElement;
const mediaListEl = document.getElementById('mediaList')!;
const mediaCountEl = document.getElementById('mediaCount')!;
const optionsBtnEl = document.getElementById('optionsBtn')!;
const updateBtnEl = document.getElementById('updateBtn') as HTMLButtonElement;
const versionTextEl = document.getElementById('versionText')!;
const updateBannerEl = document.getElementById('updateBanner')!;
const updateTextEl = document.getElementById('updateText')!;
const downloadUpdateBtnEl = document.getElementById('downloadUpdateBtn') as HTMLButtonElement;
const reloadExtBtnEl = document.getElementById('reloadExtBtn') as HTMLButtonElement;

function showQuickMessage(text: string, type: 'success' | 'error'): void {
  quickAddMsgEl.textContent = text;
  quickAddMsgEl.className = `message-banner ${type}`;
  quickAddMsgEl.style.display = 'block';
  setTimeout(() => {
    quickAddMsgEl.style.display = 'none';
  }, 4000);
}

function updateConnectionPill(
  connected: boolean,
  authenticated: boolean,
  status?: RpcStatusResponse,
  error?: string
): void {
  connectionStatusEl.className = 'status-pill';
  if (connected && authenticated) {
    connectionStatusEl.classList.add('status-connected');
    const activeText = status?.activeDownloads ? ` (${status.activeDownloads} active)` : '';
    connectionStatusEl.querySelector('.status-text')!.textContent = `Connected${activeText}`;
    connectionStatusEl.title = `GRabbit Desktop RPC is online. Total downloads: ${status?.queueLength ?? 0}`;
  } else if (connected && !authenticated) {
    connectionStatusEl.classList.add('status-disconnected');
    connectionStatusEl.querySelector('.status-text')!.textContent = 'Auth Failed';
    connectionStatusEl.title = 'Security token mismatch. Update token in Options.';
  } else {
    connectionStatusEl.classList.add('status-disconnected');
    connectionStatusEl.querySelector('.status-text')!.textContent = 'Offline';
    connectionStatusEl.title = error || 'GRabbit Desktop is not running or RPC is disabled.';
  }
}

async function checkConnection(): Promise<void> {
  chrome.runtime.sendMessage({ type: 'CHECK_CONNECTION' }, (res) => {
    if (res && res.ok) {
      updateConnectionPill(true, res.authenticated, res.status);
    } else {
      updateConnectionPill(false, false, undefined, res?.error);
    }
  });
}

function initToggles(): void {
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (res) => {
    if (res && res.config) {
      const config = res.config as ExtensionConfig;
      interceptToggleEl.checked = config.interceptDownloads;
      snifferToggleEl.checked = config.enableVideoSniffer;
    }
  });

  interceptToggleEl.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      type: 'SAVE_CONFIG',
      payload: { interceptDownloads: interceptToggleEl.checked },
    });
  });

  snifferToggleEl.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      type: 'SAVE_CONFIG',
      payload: { enableVideoSniffer: snifferToggleEl.checked },
    });
  });
}

function renderMediaList(mediaList: DetectedMediaStream[], activeTabUrl?: string): void {
  mediaCountEl.textContent = String(mediaList.length);

  if (mediaList.length === 0) {
    mediaListEl.innerHTML = `<div class="empty-state">No media streams detected on this tab.</div>`;
    return;
  }

  mediaListEl.innerHTML = '';
  for (const item of mediaList) {
    const card = document.createElement('div');
    card.className = 'media-card';

    const info = document.createElement('div');
    info.className = 'media-info';
    info.innerHTML = `
      <span class="media-title" title="${item.title || item.url}">${item.title || 'Media Stream'}</span>
      <span class="media-meta">${item.format?.toUpperCase() || 'VIDEO'} • ${item.quality || 'Best Available'}</span>
    `;

    const grabBtn = document.createElement('button');
    grabBtn.className = 'btn primary sm';
    grabBtn.textContent = 'Grab';

    grabBtn.addEventListener('click', () => {
      grabBtn.disabled = true;
      grabBtn.textContent = 'Sending…';

      const payload: { url: string; fileName?: string; referrer?: string } = {
        url: item.url,
        referrer: activeTabUrl,
      };
      if (isDirectMediaFileUrl(item.url) && !isStreamingMediaUrl(item.url)) {
        payload.fileName = `${(item.title || 'video').replace(/[^\w\s-]/g, '').trim()}.mp4`;
      }

      chrome.runtime.sendMessage(
        {
          type: 'DOWNLOAD_URL',
          payload,
        },
        (dlRes) => {
          if (dlRes && dlRes.success) {
            grabBtn.textContent = 'Queued! ✅';
          } else {
            grabBtn.textContent = 'Failed ❌';
            grabBtn.title = dlRes?.error || 'Failed to queue in GRabbit';
            grabBtn.disabled = false;
          }
        }
      );
    });

    card.appendChild(info);
    card.appendChild(grabBtn);
    mediaListEl.appendChild(card);
  }
}

async function loadActiveTabMedia(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab || !activeTab.id) return;

  const tabId = activeTab.id;
  const tabUrl = activeTab.url || '';
  const tabTitle = activeTab.title?.replace(/\s*-\s*YouTube$/i, '').trim() || 'Page Media';

  // Pre-fill Quick Grab input if the active tab is a supported streaming media page
  if (tabUrl.startsWith('http') && isStreamingMediaUrl(tabUrl) && !urlInputEl.value) {
    urlInputEl.value = tabUrl;
  }

  const combined = new Map<string, DetectedMediaStream>();
  if (tabUrl.startsWith('http') && isStreamingMediaUrl(tabUrl)) {
    combined.set(tabUrl, {
      url: tabUrl,
      title: tabTitle,
      format: 'video',
      quality: 'Best Available',
    });
  }

  // 1. Ask background for already-recorded streams on this tab
  chrome.runtime.sendMessage(
    { type: 'GET_PAGE_MEDIA', payload: { tabId } },
    (bgRes) => {
      const bgMedia: DetectedMediaStream[] = bgRes?.media || [];
      for (const m of bgMedia) combined.set(m.url, m);
      renderMediaList(Array.from(combined.values()), tabUrl);

      // 2. Ask the content script on the active tab to scan live <video>/<audio> elements
      if (tabUrl.startsWith('http')) {
        try {
          chrome.tabs.sendMessage(tabId, { type: 'SCAN_PAGE_MEDIA' }, (csRes) => {
            if (chrome.runtime.lastError) {
              // Content script wasn't injected on this pre-existing tab yet — inject it now
              if (chrome.scripting && chrome.scripting.executeScript) {
                chrome.scripting
                  .executeScript({
                    target: { tabId },
                    files: ['content/index.js'],
                  })
                  .then(() => {
                    chrome.tabs.sendMessage(tabId, { type: 'SCAN_PAGE_MEDIA' }, (retryRes) => {
                      if (chrome.runtime.lastError) return;
                      for (const m of retryRes?.media || []) combined.set(m.url, m);
                      renderMediaList(Array.from(combined.values()), tabUrl);
                    });
                  })
                  .catch(() => {});
              }
              return;
            }
            for (const m of csRes?.media || []) combined.set(m.url, m);
            renderMediaList(Array.from(combined.values()), tabUrl);
          });
        } catch {
          // ignore
        }
      }
    }
  );
}

function initQuickAdd(): void {
  const handleAdd = () => {
    const rawUrl = urlInputEl.value.trim();
    if (!rawUrl) return;

    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      showQuickMessage('Please enter a valid http(s) link.', 'error');
      return;
    }

    addBtnEl.disabled = true;
    addBtnEl.textContent = 'Adding…';

    chrome.runtime.sendMessage(
      {
        type: 'DOWNLOAD_URL',
        payload: { url: rawUrl },
      },
      (res) => {
        addBtnEl.disabled = false;
        addBtnEl.textContent = 'Grab';
        if (res && res.success) {
          urlInputEl.value = '';
          showQuickMessage('Download queued in GRabbit!', 'success');
        } else {
          showQuickMessage(res?.error || 'Failed to add download.', 'error');
        }
      }
    );
  };

  addBtnEl.addEventListener('click', handleAdd);
  urlInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAdd();
  });
}

// Open options page
optionsBtnEl.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

function initUpdateControls(): void {
  try {
    if (chrome.runtime.getManifest) {
      const manifest = chrome.runtime.getManifest();
      if (manifest.version) {
        versionTextEl.textContent = `v${manifest.version}`;
      }
    }
  } catch {
    // ignore
  }

  let latestDownloadUrl = '';
  let latestReleaseUrl = 'https://github.com/darka1pha/GRabbit-APP/releases/latest';

  updateBtnEl.addEventListener('click', () => {
    updateBtnEl.disabled = true;
    updateBtnEl.textContent = '⏳ Updating…';

    chrome.runtime.sendMessage(
      { type: 'CHECK_EXTENSION_UPDATE', payload: { autoInstall: true } },
      (info: ExtensionUpdateInfo) => {
        updateBtnEl.disabled = false;
        updateBtnEl.textContent = '↻ Update';
        updateBannerEl.style.display = 'flex';

        if (info && info.ok) {
          if (info.downloadUrl) latestDownloadUrl = info.downloadUrl;
          if (info.releaseUrl) latestReleaseUrl = info.releaseUrl;

          if (info.updateAvailable && info.latestVersion) {
            updateBannerEl.className = 'update-banner available';
            if (info.installed) {
              updateTextEl.textContent = `Updated to v${info.latestVersion}! Reloading…`;
              downloadUpdateBtnEl.style.display = 'none';
            } else if (info.downloaded) {
              updateTextEl.textContent = `Downloaded v${info.latestVersion}! Click Reload to apply.`;
              downloadUpdateBtnEl.style.display = 'none';
            } else {
              updateTextEl.textContent = `New update v${info.latestVersion} available!`;
              downloadUpdateBtnEl.style.display = 'inline-flex';
            }
          } else {
            updateBannerEl.className = 'update-banner uptodate';
            updateTextEl.textContent = `Up to date (v${info.currentVersion})`;
            downloadUpdateBtnEl.style.display = 'none';
          }
        } else {
          updateBannerEl.className = 'update-banner uptodate';
          updateTextEl.textContent = `v${info?.currentVersion || '1.1.0'} • Click Reload to refresh`;
          downloadUpdateBtnEl.style.display = 'none';
        }
      }
    );
  });

  downloadUpdateBtnEl.addEventListener('click', () => {
    const target = latestDownloadUrl || latestReleaseUrl;
    if (!target) return;
    chrome.runtime.sendMessage(
      {
        type: 'DOWNLOAD_URL',
        payload: { url: target },
      },
      (res) => {
        if (res && res.success) {
          showQuickMessage('Extension update queued in GRabbit Desktop!', 'success');
        } else {
          void chrome.tabs.create({ url: latestReleaseUrl });
        }
      }
    );
  });

  reloadExtBtnEl.addEventListener('click', () => {
    reloadExtBtnEl.disabled = true;
    reloadExtBtnEl.textContent = 'Reloading…';
    chrome.runtime.sendMessage({ type: 'RELOAD_EXTENSION' }, () => {
      window.close();
    });
  });
}

connectionStatusEl.addEventListener('click', () => {
  void checkConnection();
});

// Bootstrap
void checkConnection();
initToggles();
initQuickAdd();
initUpdateControls();
void loadActiveTabMedia();

