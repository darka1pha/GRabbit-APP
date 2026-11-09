import type { DetectedMediaStream, RpcStatusResponse } from '@grabbit/types';
import type { ExtensionConfig } from '../types/extension';

const connectionStatusEl = document.getElementById('connectionStatus')!;
const urlInputEl = document.getElementById('urlInput') as HTMLInputElement;
const addBtnEl = document.getElementById('addBtn') as HTMLButtonElement;
const quickAddMsgEl = document.getElementById('quickAddMessage')!;
const interceptToggleEl = document.getElementById('interceptToggle') as HTMLInputElement;
const snifferToggleEl = document.getElementById('snifferToggle') as HTMLInputElement;
const mediaListEl = document.getElementById('mediaList')!;
const mediaCountEl = document.getElementById('mediaCount')!;
const optionsBtnEl = document.getElementById('optionsBtn')!;

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
    connectionStatusEl.title = `gRabbit Desktop RPC is online. Total downloads: ${status?.queueLength ?? 0}`;
  } else if (connected && !authenticated) {
    connectionStatusEl.classList.add('status-disconnected');
    connectionStatusEl.querySelector('.status-text')!.textContent = 'Auth Failed';
    connectionStatusEl.title = 'Security token mismatch. Update token in Options.';
  } else {
    connectionStatusEl.classList.add('status-disconnected');
    connectionStatusEl.querySelector('.status-text')!.textContent = 'Offline';
    connectionStatusEl.title = error || 'gRabbit Desktop is not running or RPC is disabled.';
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

async function loadActiveTabMedia(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab || !activeTab.id) return;

  chrome.runtime.sendMessage(
    { type: 'GET_PAGE_MEDIA', payload: { tabId: activeTab.id } },
    (res) => {
      const mediaList: DetectedMediaStream[] = res?.media || [];
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
          <span class="media-meta">${item.format?.toUpperCase() || 'VIDEO'} • ${item.quality || 'Standard'}</span>
        `;

        const grabBtn = document.createElement('button');
        grabBtn.className = 'btn primary sm';
        grabBtn.textContent = 'Grab';

        grabBtn.addEventListener('click', () => {
          grabBtn.disabled = true;
          grabBtn.textContent = 'Sending…';

          chrome.runtime.sendMessage(
            {
              type: 'DOWNLOAD_URL',
              payload: {
                url: item.url,
                fileName: `${(item.title || 'video').replace(/[^\w\s-]/g, '').trim()}.mp4`,
                referrer: activeTab.url,
              },
            },
            (dlRes) => {
              if (dlRes && dlRes.success) {
                grabBtn.textContent = 'Queued! ✅';
              } else {
                grabBtn.textContent = 'Failed ❌';
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
          showQuickMessage('Download queued in gRabbit!', 'success');
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

connectionStatusEl.addEventListener('click', () => {
  void checkConnection();
});

// Bootstrap
void checkConnection();
initToggles();
initQuickAdd();
void loadActiveTabMedia();

