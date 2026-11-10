import { app, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import { compareSemver } from '@grabbit/utils';
import type { AppSettings, UpdateStatusInfo } from '../shared/types';
import { logger } from './logger';

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/darka1pha/GRabbit-APP/releases/latest';

export interface AutoUpdaterDeps {
  getSettings: () => AppSettings;
  onStatusChange: (status: UpdateStatusInfo) => void;
  notify: (title: string, body: string, onClick?: () => void) => void;
}

export class AutoUpdaterService {
  private status: UpdateStatusInfo = {
    state: 'idle',
    version: typeof app?.getVersion === 'function' ? app.getVersion() : '1.1.0',
  };
  private autoInstallRequested = false;
  private downloadedInstallerPath: string | null = null;
  private fallbackDownloadUrl: string | null = null;

  constructor(private readonly deps: AutoUpdaterDeps) {
    this.init();
  }

  private getCurrentVersion(): string {
    return typeof app?.getVersion === 'function' ? app.getVersion() : '1.1.0';
  }

  private init(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (msg: unknown) => logger.info({ msg }, 'electron-updater'),
      warn: (msg: unknown) => logger.warn({ msg }, 'electron-updater'),
      error: (msg: unknown) => logger.error({ msg }, 'electron-updater'),
      debug: (msg: unknown) => logger.debug({ msg }, 'electron-updater'),
    };

    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({ state: 'checking', version: this.getCurrentVersion() });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      logger.info({ version: info.version }, 'Update available');
      this.updateStatus({
        state: 'available',
        version: info.version,
        releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : undefined,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });

      if (this.autoInstallRequested || this.deps.getSettings().updates.autoDownload) {
        void this.downloadUpdate();
      }
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      logger.info({ version: info.version }, 'App is up to date');
      this.autoInstallRequested = false;
      this.updateStatus({
        state: 'not-available',
        version: info.version || this.getCurrentVersion(),
      });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.updateStatus({
        state: 'downloading',
        progressPercent: Math.round(progress.percent),
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      logger.info({ version: info.version }, 'Update downloaded and ready to install');
      this.updateStatus({
        state: 'downloaded',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });

      if (this.autoInstallRequested) {
        this.autoInstallRequested = false;
        setTimeout(() => this.quitAndInstall(), 400);
        return;
      }

      this.deps.notify(
        'GRabbit update ready',
        `Version ${info.version} has been downloaded. Click to restart and apply update.`,
        () => this.quitAndInstall()
      );
    });

    autoUpdater.on('error', (err: Error) => {
      logger.warn({ err }, 'Update check failed');
      this.autoInstallRequested = false;
      this.updateStatus({
        state: 'error',
        error: err.message || 'Failed to check for updates',
      });
    });
  }

  private updateStatus(patch: Partial<UpdateStatusInfo>): void {
    this.status = { ...this.status, ...patch };
    this.deps.onStatusChange(this.status);
  }

  public getStatus(): UpdateStatusInfo {
    return this.status;
  }

  public async checkForUpdates(autoInstall = true): Promise<UpdateStatusInfo> {
    this.autoInstallRequested = autoInstall;
    this.updateStatus({ state: 'checking', error: undefined });

    if (!app.isPackaged) {
      return this.checkGitHubReleaseFallback(autoInstall);
    }

    try {
      await autoUpdater.checkForUpdates();
      return this.status;
    } catch (err) {
      logger.warn({ err }, 'electron-updater check failed; falling back to GitHub Releases API');
      return this.checkGitHubReleaseFallback(autoInstall);
    }
  }

  private async checkGitHubReleaseFallback(autoInstall: boolean): Promise<UpdateStatusInfo> {
    const currentVersion = this.getCurrentVersion();
    try {
      const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `GRabbit/${currentVersion}` },
      });
      if (!res.ok) {
        this.autoInstallRequested = false;
        this.updateStatus({
          state: 'not-available',
          version: currentVersion,
          releaseNotes: 'Up to date with latest release.',
        });
        return this.status;
      }

      const data = (await res.json()) as {
        tag_name?: string;
        published_at?: string;
        body?: string;
        assets?: Array<{ name?: string; browser_download_url?: string }>;
      };

      const latestVersion = String(data.tag_name || currentVersion).replace(/^v/i, '');
      const isNewer = compareSemver(latestVersion, currentVersion) > 0;

      if (!isNewer) {
        this.autoInstallRequested = false;
        this.updateStatus({
          state: 'not-available',
          version: currentVersion,
        });
        return this.status;
      }

      const exeAsset = (data.assets || []).find(
        (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
      );
      this.fallbackDownloadUrl = exeAsset?.browser_download_url || null;

      this.updateStatus({
        state: 'available',
        version: latestVersion,
        releaseDate: data.published_at,
        releaseNotes: data.body,
      });

      if (autoInstall || this.deps.getSettings().updates.autoDownload) {
        await this.downloadUpdate();
      }

      return this.status;
    } catch (err) {
      this.autoInstallRequested = false;
      const message = err instanceof Error ? err.message : String(err);
      this.updateStatus({ state: 'error', error: message });
      return this.status;
    }
  }

  public async downloadUpdate(): Promise<void> {
    if (!app.isPackaged || this.fallbackDownloadUrl) {
      if (this.fallbackDownloadUrl) {
        await this.downloadFallbackInstaller(this.fallbackDownloadUrl, this.status.version || this.getCurrentVersion());
        return;
      }
      logger.info('AutoUpdater: simulated download in dev mode');
      this.updateStatus({ state: 'downloading', progressPercent: 100 });
      setTimeout(() => {
        this.updateStatus({ state: 'downloaded', version: this.status.version || this.getCurrentVersion() });
      }, 300);
      return;
    }

    this.updateStatus({ state: 'downloading', progressPercent: 0 });
    await autoUpdater.downloadUpdate();
  }

  private async downloadFallbackInstaller(url: string, version: string): Promise<void> {
    try {
      this.updateStatus({ state: 'downloading', progressPercent: 0 });
      const res = await fetch(url);
      if (!res.ok || !res.body) {
        throw new Error(`Failed to download installer (HTTP ${res.status})`);
      }

      const totalBytes = Number(res.headers.get('content-length') || 0);
      const targetPath = join(tmpdir(), `GRabbit-Setup-${version}.exe`);
      const fileStream = createWriteStream(targetPath);
      const reader = res.body.getReader();
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          fileStream.write(Buffer.from(value));
          received += value.byteLength;
          if (totalBytes > 0) {
            this.updateStatus({
              state: 'downloading',
              progressPercent: Math.min(99, Math.round((received / totalBytes) * 100)),
            });
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end(() => resolve());
        fileStream.on('error', reject);
      });

      this.downloadedInstallerPath = targetPath;
      this.updateStatus({ state: 'downloaded', version, progressPercent: 100 });

      if (this.autoInstallRequested) {
        this.autoInstallRequested = false;
        this.quitAndInstall();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateStatus({ state: 'error', error: message });
    }
  }

  public quitAndInstall(): void {
    if (this.downloadedInstallerPath) {
      const installer = this.downloadedInstallerPath;
      void shell.openPath(installer).then(() => {
        if (app.isPackaged) app.quit();
      });
      return;
    }
    if (!app.isPackaged) {
      logger.info('AutoUpdater: simulated quitAndInstall in dev mode');
      return;
    }
    autoUpdater.quitAndInstall(false, true);
  }
}


