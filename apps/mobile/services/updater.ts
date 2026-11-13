import * as FileSystem from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { compareSemver } from '@grabbit/utils';

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/darka1pha/GRabbit-APP/releases/latest';
const GITHUB_RELEASES_PAGE = 'https://github.com/darka1pha/GRabbit-APP/releases/latest';

export type MobileUpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error';

export interface MobileUpdateStatus {
  state: MobileUpdateState;
  currentVersion: string;
  latestVersion?: string;
  progressPercent?: number;
  downloadUrl?: string;
  releaseUrl?: string;
  localUri?: string;
  error?: string;
}

type StatusListener = (status: MobileUpdateStatus) => void;

export class MobileUpdaterService {
  private status: MobileUpdateStatus = {
    state: 'idle',
    currentVersion: this.getCurrentVersion(),
  };
  private listeners = new Set<StatusListener>();

  public getCurrentVersion(): string {
    try {
      return Constants.expoConfig?.version || '1.2.1';
    } catch {
      return '1.2.1';
    }
  }

  public getStatus(): MobileUpdateStatus {
    return this.status;
  }

  public subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: Partial<MobileUpdateStatus>): MobileUpdateStatus {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) {
      try {
        l(this.status);
      } catch {
        // ignore listener errors
      }
    }
    return this.status;
  }

  /**
   * Directly launch the Android package installer for an already-downloaded APK file.
   */
  public async installDownloadedApk(): Promise<MobileUpdateStatus> {
    if (!this.status.localUri) {
      return await this.checkAndInstallUpdate();
    }

    try {
      const info = await FileSystem.getInfoAsync(this.status.localUri);
      if (!info.exists || info.isDirectory) {
        this.status.localUri = undefined;
        return await this.checkAndInstallUpdate();
      }

      this.emit({
        state: 'installing',
        progressPercent: 100,
        error: undefined,
      });

      await this.launchApkInstaller(
        this.status.localUri,
        this.status.downloadUrl || this.status.releaseUrl || GITHUB_RELEASES_PAGE
      );
      return this.status;
    } catch (err: any) {
      return this.emit({
        state: 'error',
        error: err?.message || 'Failed to launch installer',
      });
    }
  }

  private async checkLatestRelease(silent = false): Promise<{
    isOutdated: boolean;
    hasApkAsset: boolean;
    status: MobileUpdateStatus;
  }> {
    const currentVersion = this.getCurrentVersion();
    if (!silent) {
      this.emit({
        state: 'checking',
        currentVersion,
        error: undefined,
        progressPercent: undefined,
      });
    }

    try {
      const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `GRabbit-Mobile/${currentVersion}`,
        },
      });

      if (!res.ok) {
        const status = silent
          ? this.status
          : this.emit({
              state: 'error',
              currentVersion,
              releaseUrl: GITHUB_RELEASES_PAGE,
              error: `Update check failed (HTTP ${res.status})`,
            });
        return { isOutdated: false, hasApkAsset: false, status };
      }

      const data = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        assets?: Array<{ name?: string; browser_download_url?: string }>;
      };

      const latestVersion = String(data.tag_name || currentVersion).replace(/^v/i, '');
      const releaseUrl = data.html_url || GITHUB_RELEASES_PAGE;
      const isOutdated = compareSemver(latestVersion, currentVersion) > 0;

      if (!isOutdated) {
        const status = silent
          ? this.status
          : this.emit({
              state: 'up-to-date',
              currentVersion,
              latestVersion,
              releaseUrl,
            });
        return { isOutdated: false, hasApkAsset: false, status };
      }

      const assets = Array.isArray(data.assets) ? data.assets : [];
      const apkAsset = assets.find(
        (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk')
      );
      const downloadUrl = apkAsset?.browser_download_url || releaseUrl;

      const status = this.emit({
        state: 'available',
        currentVersion,
        latestVersion,
        downloadUrl,
        releaseUrl,
      });

      return {
        isOutdated: true,
        hasApkAsset: Boolean(apkAsset?.browser_download_url),
        status,
      };
    } catch (err: any) {
      const status = silent
        ? this.status
        : this.emit({
            state: 'error',
            currentVersion,
            error: err?.message || 'Failed to check for updates',
          });
      return { isOutdated: false, hasApkAsset: false, status };
    }
  }

  /**
   * Silently checks for a newer APK release at startup without triggering download or error UI.
   */
  public async checkForUpdatesSilent(): Promise<MobileUpdateStatus> {
    if (this.status.state === 'downloading' || this.status.state === 'installing') {
      return this.status;
    }
    const { status } = await this.checkLatestRelease(true);
    return status;
  }

  /**
   * One-click check -> download -> install flow if the installed app is outdated.
   */
  public async checkAndInstallUpdate(): Promise<MobileUpdateStatus> {
    // If an APK has already been downloaded and exists in cache, attempt installation immediately
    if (this.status.localUri) {
      try {
        const info = await FileSystem.getInfoAsync(this.status.localUri);
        if (info.exists && !info.isDirectory) {
          return await this.installDownloadedApk();
        }
      } catch {
        this.status.localUri = undefined;
      }
    }

    const { isOutdated, hasApkAsset, status } = await this.checkLatestRelease(false);
    if (!isOutdated) return status;

    if (!hasApkAsset && status.releaseUrl) {
      await Linking.openURL(status.releaseUrl);
      return status;
    }

    if (status.downloadUrl && status.latestVersion) {
      return await this.downloadAndInstallApk(status.downloadUrl, status.latestVersion);
    }

    return status;
  }

  public async downloadAndInstallApk(downloadUrl: string, version: string): Promise<MobileUpdateStatus> {
    try {
      this.emit({
        state: 'downloading',
        latestVersion: version,
        downloadUrl,
        progressPercent: 0,
        error: undefined,
      });

      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!cacheDir || !downloadUrl.toLowerCase().endsWith('.apk')) {
        await Linking.openURL(downloadUrl);
        return this.emit({
          state: 'available',
          latestVersion: version,
          progressPercent: undefined,
        });
      }

      const targetUri = `${cacheDir}GRabbit-v${version}.apk`;

      // If the target file already exists and is completely downloaded, launch it directly
      try {
        const existingInfo = await FileSystem.getInfoAsync(targetUri);
        if (existingInfo.exists && existingInfo.size > 2000000) {
          this.emit({
            state: 'installing',
            progressPercent: 100,
            localUri: targetUri,
          });
          await this.launchApkInstaller(targetUri, downloadUrl);
          return this.status;
        }
      } catch {
        // Proceed with download
      }

      const resumable = FileSystem.createDownloadResumable(
        downloadUrl,
        targetUri,
        {},
        (progress) => {
          const total = progress.totalBytesExpectedToWrite;
          const written = progress.totalBytesWritten;
          if (total > 0) {
            const pct = Math.min(99, Math.round((written / total) * 100));
            this.emit({
              state: 'downloading',
              progressPercent: pct,
            });
          }
        }
      );

      const result = await resumable.downloadAsync();
      if (!result || !result.uri) {
        throw new Error('APK download failed: empty response');
      }
      if (typeof result.status === 'number' && (result.status < 200 || result.status >= 300)) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
        throw new Error(`APK download failed (HTTP ${result.status})`);
      }

      const downloadedInfo = await FileSystem.getInfoAsync(result.uri);
      if (
        !downloadedInfo.exists ||
        (typeof downloadedInfo.size === 'number' && downloadedInfo.size < 100_000)
      ) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
        throw new Error('Downloaded update file is incomplete or invalid');
      }

      this.emit({
        state: 'installing',
        progressPercent: 100,
        localUri: result.uri,
      });

      try {
        await this.launchApkInstaller(result.uri, downloadUrl);
      } catch (launchErr: any) {
        return this.emit({
          state: 'error',
          error: `Downloaded update APK, but could not open installer: ${launchErr?.message || 'Unknown error'}. Tap Install to try again.`,
          localUri: result.uri,
        });
      }

      return this.status;
    } catch (err: any) {
      // Fallback: open direct APK download URL in system browser
      try {
        await Linking.openURL(downloadUrl);
        return this.emit({
          state: 'available',
          latestVersion: version,
          progressPercent: undefined,
          error: err?.message || 'In-app download failed; opened release link in browser',
        });
      } catch {
        return this.emit({
          state: 'error',
          error: err?.message || 'Failed to download and install update',
        });
      }
    }
  }

  public async launchApkInstaller(localUri: string, fallbackUrl?: string): Promise<void> {
    if (Platform.OS === 'android') {
      try {
        const contentUri = await FileSystem.getContentUriAsync(localUri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          type: 'application/vnd.android.package-archive',
          flags: 1, // Intent.FLAG_GRANT_READ_URI_PERMISSION
        });
        return;
      } catch (err: any) {
        console.warn('Native IntentLauncher failed for APK installation:', err);
        if (fallbackUrl) {
          try {
            await Linking.openURL(fallbackUrl);
            return;
          } catch {
            // Re-throw original error
          }
        }
        throw new Error(`Failed to launch Android package installer: ${err?.message || 'Access denied'}`);
      }
    }

    if (fallbackUrl) {
      await Linking.openURL(fallbackUrl);
      return;
    }

    throw new Error('APK installation is only supported on Android devices');
  }
}

export const mobileUpdater = new MobileUpdaterService();
