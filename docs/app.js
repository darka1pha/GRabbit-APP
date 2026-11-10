const GITHUB_REPO = 'darka1pha/GRabbit-APP';
const FALLBACK_TAG = 'v1.0.0';
const BASE_DOWNLOAD = `https://github.com/${GITHUB_REPO}/releases/latest/download`;

const DEFAULT_ASSETS = {
  winInstaller: `${BASE_DOWNLOAD}/GRabbit-Setup-1.0.0.exe`,
  winPortable: `${BASE_DOWNLOAD}/GRabbit-1.0.0-portable.exe`,
  androidApk: `${BASE_DOWNLOAD}/GRabbit-v1.0.0.apk`,
  chromeExt: `${BASE_DOWNLOAD}/GRabbit-Chrome-Extension-v1.0.0.zip`,
  checksums: `${BASE_DOWNLOAD}/SHA256SUMS.txt`,
};

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

// 1. Auto-highlight primary CTA based on visitor OS
function detectVisitorOS() {
  const ua = navigator.userAgent || '';
  const primaryBtn = document.getElementById('heroPrimaryDownload');
  const primaryLabel = document.getElementById('heroPrimaryLabel');
  if (!primaryBtn || !primaryLabel) return;

  if (/android/i.test(ua)) {
    primaryBtn.href = DEFAULT_ASSETS.androidApk;
    primaryLabel.textContent = 'Download for Android (.apk)';
  } else {
    primaryBtn.href = DEFAULT_ASSETS.winInstaller;
    primaryLabel.textContent = 'Download for Windows (64-bit)';
  }
}

// 2. Fetch live GitHub Release metadata to keep version & file sizes up to date
async function syncLatestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) return;
    const release = await res.json();
    const tag = release.tag_name || FALLBACK_TAG;

    const versionBadges = document.querySelectorAll('.js-release-version');
    versionBadges.forEach((el) => {
      el.textContent = tag;
    });

    if (!Array.isArray(release.assets)) return;

    for (const asset of release.assets) {
      const name = asset.name || '';
      const url = asset.browser_download_url;
      const sizeStr = formatBytes(asset.size);

      if (/Setup.*\.exe$/i.test(name)) {
        document.querySelectorAll('.js-dl-win-installer').forEach((el) => (el.href = url));
        const sizeEl = document.getElementById('size-win-installer');
        if (sizeEl && sizeStr) sizeEl.textContent = sizeStr;
      } else if (/portable\.exe$/i.test(name)) {
        document.querySelectorAll('.js-dl-win-portable').forEach((el) => (el.href = url));
        const sizeEl = document.getElementById('size-win-portable');
        if (sizeEl && sizeStr) sizeEl.textContent = sizeStr;
      } else if (/\.apk$/i.test(name)) {
        document.querySelectorAll('.js-dl-android').forEach((el) => (el.href = url));
        const sizeEl = document.getElementById('size-android-apk');
        if (sizeEl && sizeStr) sizeEl.textContent = sizeStr;
      } else if (/Extension.*\.zip$/i.test(name)) {
        document.querySelectorAll('.js-dl-extension').forEach((el) => (el.href = url));
        const sizeEl = document.getElementById('size-chrome-ext');
        if (sizeEl && sizeStr) sizeEl.textContent = sizeStr;
      } else if (name === 'SHA256SUMS.txt') {
        document.querySelectorAll('.js-dl-checksums').forEach((el) => (el.href = url));
      }
    }
  } catch {
    // Fallback URLs remain active
  }
}

// 3. Interactive Usage Guide Tabs
function initGuideTabs() {
  const buttons = document.querySelectorAll('.guide-tab-btn');
  const panels = document.querySelectorAll('.guide-panel');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      buttons.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(`panel-${targetId}`);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // Also allow links like #guide-extension to open a specific tab
  document.querySelectorAll('[data-open-tab]').forEach((link) => {
    link.addEventListener('click', () => {
      const tabName = link.getAttribute('data-open-tab');
      const tabBtn = document.querySelector(`.guide-tab-btn[data-tab="${tabName}"]`);
      if (tabBtn) tabBtn.click();
    });
  });
}

// 4. Copy-to-clipboard buttons for snippets
function initCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy') || '';
      const original = btn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied! ✓';
        setTimeout(() => {
          btn.textContent = original;
        }, 2000);
      } catch {
        // ignore
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  detectVisitorOS();
  initGuideTabs();
  initCopyButtons();
  void syncLatestRelease();
});
