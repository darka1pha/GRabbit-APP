import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { mobileSettingsManager } from './settings-manager';
import { createTranslator, formatBytes } from '@grabbit/utils';
import type { MobileDownloadTask } from './download-manager';

// Safe handler setup
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {
  // Not available in non-standard runtimes / tests
}

class NotificationService {
  private initialized = false;
  private channelId = 'grabbit_downloads';

  async init(): Promise<boolean> {
    if (this.initialized || Platform.OS === 'web') return this.initialized;
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        return false;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(this.channelId, {
          name: 'Downloads',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#6366f1',
          showBadge: true,
        });
      }

      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  async notifyDownloadCompleted(task: MobileDownloadTask) {
    const settings = mobileSettingsManager.getSettings();
    if (!settings.notificationsEnabled) return;

    try {
      await this.init();
      const t = createTranslator(settings.language || 'en');
      const sizeStr = task.totalBytes > 0 ? ` (${formatBytes(task.totalBytes, settings.language)})` : '';
      await Notifications.scheduleNotificationAsync({
        content: {
          title: t('mobile.notifCompleted'),
          body: `${task.fileName}${sizeStr}`,
          data: { taskId: task.id, localUri: task.localUri, action: 'open_item' },
          sound: true,
        },
        trigger: null, // deliver immediately
      });
    } catch (err) {
      console.warn('Failed to schedule completion notification:', err);
    }
  }

  async notifyDownloadFailed(task: MobileDownloadTask, errorMessage: string) {
    const settings = mobileSettingsManager.getSettings();
    if (!settings.notificationsEnabled) return;

    try {
      await this.init();
      const t = createTranslator(settings.language || 'en');
      await Notifications.scheduleNotificationAsync({
        content: {
          title: t('mobile.notifFailed'),
          body: `${task.fileName}: ${errorMessage}`,
          data: { taskId: task.id, action: 'view_error' },
          sound: true,
        },
        trigger: null, // deliver immediately
      });
    } catch (err) {
      console.warn('Failed to schedule failure notification:', err);
    }
  }

  onNotificationTap(callback: (data: { taskId?: string; localUri?: string; action?: string }) => void) {
    try {
      return Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as any;
        if (data) {
          callback(data);
        }
      });
    } catch {
      return { remove: () => {} };
    }
  }
}

export const notificationService = new NotificationService();
