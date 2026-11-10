import { DEFAULT_EXTENSION_CONFIG } from '../shared/config';
import { ExtensionRpcClient } from '../shared/rpc-client';
import type { ExtensionConfig, ExtensionUpdateInfo } from '../types/extension';

const bridgeHostEl = document.getElementById('bridgeHost') as HTMLInputElement;
const bridgePortEl = document.getElementById('bridgePort') as HTMLInputElement;
const bridgeTokenEl = document.getElementById('bridgeToken') as HTMLInputElement;
const testBtnEl = document.getElementById('testBtn') as HTMLButtonElement;
const testResultEl = document.getElementById('testResult')!;

const interceptDownloadsEl = document.getElementById('interceptDownloads') as HTMLInputElement;
const interceptExtensionsEl = document.getElementById('interceptExtensions') as HTMLTextAreaElement;
const excludedDomainsEl = document.getElementById('excludedDomains') as HTMLTextAreaElement;
const minFileSizeMBEl = document.getElementById('minFileSizeMB') as HTMLInputElement;

const enableVideoSnifferEl = document.getElementById('enableVideoSniffer') as HTMLInputElement;
const checkUpdateBtnEl = document.getElementById('checkUpdateBtn') as HTMLButtonElement;
const reloadExtensionBtnEl = document.getElementById('reloadExtensionBtn') as HTMLButtonElement;
const downloadExtUpdateBtnEl = document.getElementById('downloadExtUpdateBtn') as HTMLButtonElement;
const updateResultEl = document.getElementById('updateResult')!;
const saveBtnEl = document.getElementById('saveBtn') as HTMLButtonElement;
const resetBtnEl = document.getElementById('resetBtn') as HTMLButtonElement;
const saveStatusEl = document.getElementById('saveStatus')!;

function populateForm(cfg: ExtensionConfig): void {
  bridgeHostEl.value = cfg.bridgeHost || '127.0.0.1';
  bridgePortEl.value = String(cfg.bridgePort || 31542);
  bridgeTokenEl.value = cfg.bridgeToken || '';

  interceptDownloadsEl.checked = cfg.interceptDownloads;
  interceptExtensionsEl.value = (cfg.interceptExtensions || []).join(', ');
  excludedDomainsEl.value = (cfg.excludedDomains || []).join('\n');
  minFileSizeMBEl.value = String(cfg.minFileSizeMB || 0);

  enableVideoSnifferEl.checked = cfg.enableVideoSniffer;
}

function gatherConfigFromForm(): ExtensionConfig {
  const exts = interceptExtensionsEl.value
    .split(/[,;\s\n]+/)
    .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);

  const domains = excludedDomainsEl.value
    .split(/[\n,;]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  return {
    bridgeHost: bridgeHostEl.value.trim() || '127.0.0.1',
    bridgePort: parseInt(bridgePortEl.value, 10) || 31542,
    bridgeToken: bridgeTokenEl.value.trim(),
    interceptDownloads: interceptDownloadsEl.checked,
    interceptExtensions: exts,
    excludedDomains: domains,
    enableVideoSniffer: enableVideoSnifferEl.checked,
    minFileSizeMB: parseFloat(minFileSizeMBEl.value) || 0,
  };
}

async function init(): Promise<void> {
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (res) => {
    if (res && res.config) {
      populateForm(res.config as ExtensionConfig);
    }
  });

  // Test connection
  testBtnEl.addEventListener('click', async () => {
    testBtnEl.disabled = true;
    testBtnEl.textContent = 'Testing…';
    testResultEl.style.display = 'none';

    const testCfg = gatherConfigFromForm();
    const rpc = new ExtensionRpcClient(testCfg);

    try {
      const pingRes = await rpc.ping();
      testResultEl.style.display = 'block';

      if (pingRes.ok) {
        if (pingRes.data?.authenticated) {
          testResultEl.className = 'test-result success';
          testResultEl.textContent = `Connected successfully to GRabbit Desktop v${pingRes.data.version || '1.0'}`;
        } else {
          testResultEl.className = 'test-result error';
          testResultEl.textContent = `Desktop app found, but authentication failed. Check your security token!`;
        }
      } else {
        testResultEl.className = 'test-result error';
        testResultEl.textContent = `Connection failed: ${pingRes.error || 'Server not reachable on ' + testCfg.bridgeHost + ':' + testCfg.bridgePort}`;
      }
    } finally {
      testBtnEl.disabled = false;
      testBtnEl.textContent = 'Test Connection';
    }
  });

  // Save settings
  saveBtnEl.addEventListener('click', () => {
    saveBtnEl.disabled = true;
    saveBtnEl.textContent = 'Saving…';

    const updated = gatherConfigFromForm();
    chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', payload: updated }, () => {
      saveBtnEl.disabled = false;
      saveBtnEl.textContent = 'Save Settings';
      saveStatusEl.textContent = 'Settings saved!';
      saveStatusEl.style.display = 'inline';
      setTimeout(() => {
        saveStatusEl.style.display = 'none';
      }, 3000);
    });
  });

  // Reset to defaults
  resetBtnEl.addEventListener('click', () => {
    if (confirm('Reset all extension settings to default values?')) {
      populateForm(DEFAULT_EXTENSION_CONFIG);
      chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', payload: DEFAULT_EXTENSION_CONFIG }, () => {
        saveStatusEl.textContent = 'Reset to defaults!';
        saveStatusEl.style.display = 'inline';
        setTimeout(() => {
          saveStatusEl.style.display = 'none';
        }, 3000);
      });
    }
  });

  // Check for extension updates
  let latestDownloadUrl = '';
  let latestReleaseUrl = 'https://github.com/darka1pha/GRabbit-APP/releases/latest';

  checkUpdateBtnEl.addEventListener('click', () => {
    checkUpdateBtnEl.disabled = true;
    checkUpdateBtnEl.textContent = 'Updating…';
    updateResultEl.style.display = 'none';
    downloadExtUpdateBtnEl.style.display = 'none';

    chrome.runtime.sendMessage(
      { type: 'CHECK_EXTENSION_UPDATE', payload: { autoInstall: true } },
      (info: ExtensionUpdateInfo) => {
        checkUpdateBtnEl.disabled = false;
        checkUpdateBtnEl.textContent = 'Check & Install Update';
        updateResultEl.style.display = 'block';

        if (info && info.ok) {
          if (info.downloadUrl) latestDownloadUrl = info.downloadUrl;
          if (info.releaseUrl) latestReleaseUrl = info.releaseUrl;

          if (info.updateAvailable && info.latestVersion) {
            updateResultEl.className = 'test-result success';
            if (info.installed) {
              updateResultEl.textContent = `Downloaded & installed v${info.latestVersion}! Reloading extension…`;
            } else if (info.downloaded) {
              updateResultEl.textContent = `Downloaded v${info.latestVersion} via GRabbit! Click Reload Extension to apply.`;
            } else {
              updateResultEl.textContent = `New version v${info.latestVersion} is available! (Current: v${info.currentVersion})`;
              downloadExtUpdateBtnEl.style.display = 'inline-flex';
            }
          } else {
            updateResultEl.className = 'test-result success';
            updateResultEl.textContent = `GRabbit Extension is up to date (v${info.currentVersion}).`;
          }
        } else {
          updateResultEl.className = 'test-result error';
          updateResultEl.textContent = info?.error || 'Could not check for updates.';
        }
      }
    );
  });

  downloadExtUpdateBtnEl.addEventListener('click', () => {
    const target = latestDownloadUrl || latestReleaseUrl;
    if (!target) return;
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_URL', payload: { url: target } }, (res) => {
      if (res && res.success) {
        updateResultEl.className = 'test-result success';
        updateResultEl.textContent = 'Extension update queued in GRabbit Desktop!';
      } else {
        void chrome.tabs.create({ url: latestReleaseUrl });
      }
    });
  });

  reloadExtensionBtnEl.addEventListener('click', () => {
    reloadExtensionBtnEl.disabled = true;
    reloadExtensionBtnEl.textContent = 'Reloading…';
    chrome.runtime.sendMessage({ type: 'RELOAD_EXTENSION' });
  });
}

void init();

