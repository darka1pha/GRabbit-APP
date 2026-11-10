const GITHUB_REPO = 'darka1pha/GRabbit-APP';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB ↓`;
  return `${(bytes / 1024).toFixed(0)} KB ↓`;
}

async function syncLatestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) return;
    const release = await res.json();

    if (release.tag_name) {
      document.querySelectorAll('.js-release-version').forEach((el) => {
        el.textContent = release.tag_name;
      });
    }

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
      } else if (/v.*\.apk$/i.test(name)) {
        document.querySelectorAll('.js-dl-android').forEach((el) => (el.href = url));
        const sizeEl = document.getElementById('size-android-apk');
        if (sizeEl && sizeStr) sizeEl.textContent = sizeStr;
      } else if (/Extension-v.*\.zip$/i.test(name)) {
        document.querySelectorAll('.js-dl-extension').forEach((el) => (el.href = url));
        const sizeEl = document.getElementById('size-chrome-ext');
        if (sizeEl && sizeStr) sizeEl.textContent = sizeStr;
      } else if (name === 'SHA256SUMS.txt') {
        document.querySelectorAll('.js-dl-checksums').forEach((el) => (el.href = url));
      }
    }
  } catch {
    // Keep default links
  }
}

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.guide-panel');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      buttons.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const panel = document.getElementById(`panel-${tab}`);
      if (panel) panel.classList.add('active');
    });
  });
}

function initCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy') || '';
      const original = btn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
        setTimeout(() => {
          btn.textContent = original;
        }, 1800);
      } catch {
        // ignore
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCopyButtons();
  void syncLatestRelease();
});
