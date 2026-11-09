import { app } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { AppSettings, UpdateStatusInfo } from '../shared/types';
import { logger } from './logger';

export interface AutoUpdaterDeps {
  getSettings: () => AppSettings;
  onStatusChange: (status: UpdateStatusInfo) => void;
  notify: (title: string, body: string, onClick?: () => void) => void;
}

export class AutoUpdaterService {
  private status: UpdateStatusInfo = {
    state: 'idle',
    version: app.getVersion(),
  };

  constructor(private readonly deps: AutoUpdaterDeps) {
    this.init();
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
      this.updateStatus({ state: 'checking', version: app.getVersion() });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      logger.info({ version: info.version }, 'Update available');
      this.updateStatus({
        state: 'available',
        version: info.version,
        releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : undefined,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });

      if (this.deps.getSettings().updates.autoDownload) {
        void this.downloadUpdate();
      }
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      logger.info({ version: info.version }, 'App is up to date');
      this.updateStatus({
        state: 'not-available',
        version: info.version || app.getVersion(),
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

      this.deps.notify(
        'gRabbit update ready',
        `Version ${info.version} has been downloaded. Click to restart and apply update.`,
        () => this.quitAndInstall()
      );
    });

    autoUpdater.on('error', (err: Error) => {
      logger.warn({ err }, 'Update check failed');
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

  public async checkForUpdates(): Promise<UpdateStatusInfo> {
    if (!app.isPackaged) {
      logger.info('AutoUpdater: skipping update check in unpackaged / dev mode');
      this.updateStatus({
        state: 'not-available',
        version: app.getVersion(),
        releaseNotes: 'Running in development mode. Silent GitHub Release updates are active in packaged builds.',
      });
      return this.status;
    }

    try {
      this.updateStatus({ state: 'checking', error: undefined });
      await autoUpdater.checkForUpdates();
      return this.status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateStatus({ state: 'error', error: message });
      return this.status;
    }
  }

  public async downloadUpdate(): Promise<void> {
    if (!app.isPackaged) {
      logger.info('AutoUpdater: simulated download in dev mode');
      this.updateStatus({ state: 'downloading', progressPercent: 100 });
      setTimeout(() => {
        this.updateStatus({ state: 'downloaded', version: app.getVersion() });
      }, 500);
      return;
    }

    this.updateStatus({ state: 'downloading', progressPercent: 0 });
    await autoUpdater.downloadUpdate();
  }

  public quitAndInstall(): void {
    if (!app.isPackaged) {
      logger.info('AutoUpdater: simulated quitAndInstall in dev mode');
      return;
    }
    autoUpdater.quitAndInstall(false, true);
  }
}

