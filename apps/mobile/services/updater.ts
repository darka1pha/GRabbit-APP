import * as FileSystem from 'expo-file-system';
import * as Linking from 'expo-linking';
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
      return Constants.expoConfig?.version || '1.1.0';
    } catch {
      return '1.1.0';
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
   * One-click check -> download -> install flow if the installed app is outdated.
   */
  public async checkAndInstallUpdate(): Promise<MobileUpdateStatus> {
    const currentVersion = this.getCurrentVersion();
    this.emit({
      state: 'checking',
      currentVersion,
      error: undefined,
      progressPercent: undefined,
    });

    try {
      const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `GRabbit-Mobile/${currentVersion}`,
        },
      });

      if (!res.ok) {
        return this.emit({
          state: 'up-to-date',
          currentVersion,
          latestVersion: currentVersion,
          releaseUrl: GITHUB_RELEASES_PAGE,
        });
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
        return this.emit({
          state: 'up-to-date',
          currentVersion,
          latestVersion,
          releaseUrl,
        });
      }

      const assets = Array.isArray(data.assets) ? data.assets : [];
      const apkAsset = assets.find(
        (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk')
      );
      const downloadUrl = apkAsset?.browser_download_url || releaseUrl;

      this.emit({
        state: 'available',
        currentVersion,
        latestVersion,
        downloadUrl,
        releaseUrl,
      });

      return await this.downloadAndInstallApk(downloadUrl, latestVersion);
    } catch (err: any) {
      return this.emit({
        state: 'error',
        currentVersion,
        error: err?.message || 'Failed to check for updates',
      });
    }
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
          state: 'installing',
          latestVersion: version,
          progressPercent: 100,
        });
      }

      const targetUri = `${cacheDir}GRabbit-v${version}.apk`;
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
        throw new Error('APK download failed');
      }

      this.emit({
        state: 'installing',
        progressPercent: 100,
        localUri: result.uri,
      });

      await this.launchApkInstaller(result.uri, downloadUrl);
      return this.status;
    } catch (err: any) {
      // Fallback: open direct APK download URL in system browser/installer
      try {
        await Linking.openURL(downloadUrl);
        return this.emit({
          state: 'installing',
          latestVersion: version,
          progressPercent: 100,
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
    if (Platform.OS === 'android' && typeof FileSystem.getContentUriAsync === 'function') {
      try {
        const contentUri = await FileSystem.getContentUriAsync(localUri);
        const canOpen = await Linking.canOpenURL(contentUri);
        if (canOpen) {
          await Linking.openURL(contentUri);
          return;
        }
      } catch {
        // fallback below
      }
    }
    if (fallbackUrl) {
      await Linking.openURL(fallbackUrl);
    }
  }
}

export const mobileUpdater = new MobileUpdaterService();

