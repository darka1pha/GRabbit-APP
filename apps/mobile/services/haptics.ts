import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { mobileSettingsManager } from './settings-manager';

export function isHapticsSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function hapticLight(): Promise<void> {
  if (!isHapticsSupported()) return;
  const settings = mobileSettingsManager.getSettings();
  if (!settings.hapticsEnabled) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Graceful fallback
  }
}

export async function hapticMedium(): Promise<void> {
  if (!isHapticsSupported()) return;
  const settings = mobileSettingsManager.getSettings();
  if (!settings.hapticsEnabled) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // Graceful fallback
  }
}

export async function hapticHeavy(): Promise<void> {
  if (!isHapticsSupported()) return;
  const settings = mobileSettingsManager.getSettings();
  if (!settings.hapticsEnabled) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // Graceful fallback
  }
}

export async function hapticSuccess(): Promise<void> {
  if (!isHapticsSupported()) return;
  const settings = mobileSettingsManager.getSettings();
  if (!settings.hapticsEnabled) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Graceful fallback
  }
}

export async function hapticWarning(): Promise<void> {
  if (!isHapticsSupported()) return;
  const settings = mobileSettingsManager.getSettings();
  if (!settings.hapticsEnabled) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // Graceful fallback
  }
}

export async function hapticError(): Promise<void> {
  if (!isHapticsSupported()) return;
  const settings = mobileSettingsManager.getSettings();
  if (!settings.hapticsEnabled) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // Graceful fallback
  }
}
