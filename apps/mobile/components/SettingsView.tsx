import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mobileSettingsManager, MobileSettings } from '../services/settings-manager';
import { useDownloads } from '../hooks/useDownloads';
import { mobileRecognizer } from '../services/recognizer';
import { mobileUpdater, MobileUpdateStatus } from '../services/updater';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '../hooks/useTheme';
import { ThemeColors } from '../constants/theme';
import { PairingModal } from './PairingModal';
import { hapticLight, hapticSuccess } from '../services/haptics';

export function SettingsView() {
  const { t, isRtl, textDirStyle, formatBytes } = useI18n();
  const { colors, setTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [settings, setSettings] = useState<MobileSettings>(mobileSettingsManager.getSettings());
  const [updateStatus, setUpdateStatus] = useState<MobileUpdateStatus>(mobileUpdater.getStatus());
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [storage, setStorage] = useState<{ freeBytes: number; usedBytes: number; itemCount: number }>({
    freeBytes: 0,
    usedBytes: 0,
    itemCount: 0,
  });

  const { clearCompleted, getStorageUsage, cleanStorage } = useDownloads();

  const refreshStorage = useCallback(async () => {
    try {
      const info = await getStorageUsage();
      setStorage(info);
    } catch {
      // Ignored
    }
  }, [getStorageUsage]);

  useEffect(() => {
    mobileSettingsManager.loadSettings().then(setSettings);
    const unsubSettings = mobileSettingsManager.subscribe(setSettings);
    const unsubUpdater = mobileUpdater.subscribe(setUpdateStatus);
    void refreshStorage();
    return () => {
      unsubSettings();
      unsubUpdater();
    };
  }, [refreshStorage]);

  const handleCheckAndUpdate = async () => {
    void hapticLight();
    const res =
      updateStatus.state === 'available' && updateStatus.downloadUrl && updateStatus.latestVersion
        ? await mobileUpdater.downloadAndInstallApk(
            updateStatus.downloadUrl,
            updateStatus.latestVersion
          )
        : await mobileUpdater.checkAndInstallUpdate();
    if (res.state === 'up-to-date') {
      Alert.alert(t('set.upToDate'), `GRabbit Mobile v${res.currentVersion}`);
    } else if (res.state === 'available' && res.latestVersion) {
      Alert.alert(
        t('mobile.updateAvailable', { version: res.latestVersion }),
        t('mobile.updateNotesPrompt', { version: res.latestVersion })
      );
    } else if (res.state === 'error' && res.error) {
      Alert.alert(t('dl.error'), res.error);
    } else if (res.state === 'installing') {
      Alert.alert(
        t('set.updateReady'),
        'The update package installer has been launched. If prompted, please allow "Install unknown apps" for GRabbit in Android Settings.'
      );
    }
  };

  const update = (patch: Partial<MobileSettings>) => {
    void hapticLight();
    mobileSettingsManager.updateSettings(patch);
  };

  const handleCleanStorage = async () => {
    void hapticLight();
    Alert.alert(
      t('mobile.cleanStorage'),
      'Are you sure you want to clean up finished files and temporary cache to free up storage?',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.clear'),
          style: 'destructive',
          onPress: async () => {
            const res = await cleanStorage();
            void hapticSuccess();
            void refreshStorage();
            if (res.cleanedCount > 0) {
              Alert.alert(
                t('common.ok'),
                t('mobile.cleanedUp', {
                  count: res.cleanedCount,
                  size: formatBytes(res.freedBytes),
                })
              );
            } else {
              Alert.alert(t('common.ok'), t('mobile.nothingToClean'));
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.header, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}>
        <Text style={styles.title}>{t('set.title')}</Text>
        <Text style={styles.subtitle}>{t('onboarding.subtitle')}</Text>
      </View>

      {/* General & Localization */}
      <View style={styles.section}>
        <View style={[styles.sectionHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Ionicons name="globe-outline" size={18} color={colors.accent} />
          <Text style={styles.sectionTitle}>{t('set.general')}</Text>
        </View>
        <View style={styles.card}>
          {/* Theme */}
          <View style={[styles.settingRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={[styles.settingLabel, textDirStyle]}>{t('set.theme')}</Text>
            </View>
            <View style={styles.segmentedRow}>
              {(['system', 'dark', 'light'] as const).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.segBtn, settings.theme === mode && styles.segBtnActive]}
                  onPress={() => {
                    void hapticLight();
                    setTheme(mode);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t(`set.theme.${mode}`)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text
                    style={[
                      styles.segBtnText,
                      settings.theme === mode && styles.segBtnTextActive,
                    ]}
                  >
                    {t(`set.theme.${mode}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Language */}
          <View style={[styles.settingRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.settingLabel}>{t('set.language')}</Text>
              <Text style={styles.settingHint}>Language / زبان برنامه</Text>
            </View>
            <View style={styles.segmentedRow}>
              {(['en', 'fa'] as const).map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[styles.segBtn, settings.language === lang && styles.segBtnActive]}
                  onPress={() => update({ language: lang })}
                  accessibilityRole="button"
                  accessibilityLabel={lang === 'fa' ? 'فارسی' : 'English'}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.segBtnText, settings.language === lang && styles.segBtnTextActive]}>
                    {lang === 'fa' ? 'فارسی' : 'English'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Notifications */}
          <View style={[styles.settingRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.settingLabel}>{t('mobile.notifications')}</Text>
              <Text style={styles.settingHint}>{t('set.notifications')}</Text>
            </View>
            <Switch
              value={settings.notificationsEnabled}
              onValueChange={(notificationsEnabled) => update({ notificationsEnabled })}
              thumbColor={settings.notificationsEnabled ? '#6366f1' : '#64748b'}
              trackColor={{ false: '#334155', true: '#4338ca' }}
              accessibilityRole="switch"
              accessibilityLabel={t('mobile.notifications')}
            />
          </View>

          {/* Haptic Feedback */}
          <View style={[styles.settingRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.settingLabel}>{t('mobile.haptics')}</Text>
              <Text style={styles.settingHint}>Touch vibrations on gestures & button taps</Text>
            </View>
            <Switch
              value={settings.hapticsEnabled}
              onValueChange={(hapticsEnabled) => update({ hapticsEnabled })}
              thumbColor={settings.hapticsEnabled ? '#6366f1' : '#64748b'}
              trackColor={{ false: '#334155', true: '#4338ca' }}
              accessibilityRole="switch"
              accessibilityLabel={t('mobile.haptics')}
            />
          </View>
        </View>
      </View>

      {/* Storage Visibility & Management (Item 6.8) */}
      <View style={styles.section}>
        <View style={[styles.sectionHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Ionicons name="pie-chart-outline" size={18} color="#6366f1" />
          <Text style={styles.sectionTitle}>Storage & Disk</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.storageSummaryBox}>
            <View style={styles.storageStat}>
              <Text style={styles.storageStatLabel}>GRabbit Used</Text>
              <Text style={styles.storageStatVal}>{formatBytes(storage.usedBytes)}</Text>
            </View>
            <View style={styles.storageDivider} />
            <View style={styles.storageStat}>
              <Text style={styles.storageStatLabel}>Device Free</Text>
              <Text style={styles.storageStatVal}>
                {storage.freeBytes > 0 ? formatBytes(storage.freeBytes) : 'Available'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.cleanStorageBtn}
            onPress={handleCleanStorage}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.cleanStorage')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="sparkles-outline" size={18} color="#ffffff" />
            <Text style={styles.cleanStorageBtnText}>{t('mobile.cleanStorage')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Desktop Pairing & RPC Bridge (Item 6.6) */}
      <View style={styles.section}>
        <View style={[styles.sectionHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Ionicons name="desktop-outline" size={18} color="#6366f1" />
          <Text style={styles.sectionTitle}>{t('set.extension')}</Text>
        </View>
        <View style={styles.card}>
          <View style={[styles.settingRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.settingLabel}>{t('set.extensionEnable')}</Text>
              <Text style={styles.settingHint}>
                {settings.desktopBridge.enabled && settings.desktopBridge.host
                  ? `Connected to ${settings.desktopBridge.host}:${settings.desktopBridge.port}`
                  : 'Pair with Desktop over WiFi'}
              </Text>
            </View>
            <Switch
              value={settings.desktopBridge.enabled}
              onValueChange={(enabled) =>
                update({ desktopBridge: { ...settings.desktopBridge, enabled } })
              }
              thumbColor={settings.desktopBridge.enabled ? '#6366f1' : '#64748b'}
              trackColor={{ false: '#334155', true: '#4338ca' }}
              accessibilityRole="switch"
              accessibilityLabel={t('set.extensionEnable')}
            />
          </View>

          <TouchableOpacity
            style={styles.qrPairBtn}
            onPress={() => setShowPairingModal(true)}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.scanQr')}
          >
            <Ionicons name="qr-code-outline" size={18} color={colors.accent} />
            <Text style={styles.qrPairBtnText}>{t('mobile.scanQr')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Downloads Section */}
      <View style={styles.section}>
        <View style={[styles.sectionHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Ionicons name="download-outline" size={18} color="#6366f1" />
          <Text style={styles.sectionTitle}>{t('set.downloads')}</Text>
        </View>
        <View style={styles.card}>
          {/* Max Concurrent */}
          <View style={[styles.settingRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.settingLabel}>{t('set.maxConcurrent')}</Text>
              <Text style={styles.settingHint}>Active downloads at the same time</Text>
            </View>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => update({ maxConcurrent: Math.max(1, settings.maxConcurrent - 1) })}
                accessibilityRole="button"
                accessibilityLabel="Decrease concurrent downloads"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="remove" size={16} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.stepperVal}>{settings.maxConcurrent}</Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => update({ maxConcurrent: Math.min(8, settings.maxConcurrent + 1) })}
                accessibilityRole="button"
                accessibilityLabel="Increase concurrent downloads"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="add" size={16} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Speed Throttle */}
          <View style={[styles.settingRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.settingLabel}>{t('set.speedLimit')}</Text>
              <Text style={styles.settingHint}>0 = Unlimited maximum speed</Text>
            </View>
            <TextInput
              style={styles.numberInput}
              value={settings.globalSpeedLimitKBps ? String(settings.globalSpeedLimitKBps) : ''}
              onChangeText={(v) => update({ globalSpeedLimitKBps: Number(v) || 0 })}
              placeholder="0"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              accessibilityLabel={t('set.speedLimit')}
            />
          </View>

          {/* Auto Save to Gallery */}
          <View style={[styles.settingRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.settingLabel}>Auto-Save to Media Library</Text>
              <Text style={styles.settingHint}>Automatically save videos & photos to Camera Roll</Text>
            </View>
            <Switch
              value={settings.autoSaveToLibrary}
              onValueChange={(v) => update({ autoSaveToLibrary: v })}
              thumbColor={settings.autoSaveToLibrary ? '#6366f1' : '#64748b'}
              trackColor={{ false: '#334155', true: '#4338ca' }}
              accessibilityRole="switch"
              accessibilityLabel="Auto-Save to Media Library"
            />
          </View>
        </View>
      </View>

      {/* Clear History Buttons */}
      <View style={styles.section}>
        <View style={[styles.sectionHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Ionicons name="trash-bin-outline" size={18} color="#6366f1" />
          <Text style={styles.sectionTitle}>History</Text>
        </View>
        <View style={styles.card}>
          <TouchableOpacity
            style={[styles.clearBtnRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
            onPress={() => {
              void hapticLight();
              clearCompleted();
              Alert.alert(t('common.ok'), t('dl.clearedCompleted'));
            }}
            accessibilityRole="button"
            accessibilityLabel={t('dl.clearCompleted')}
          >
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.clearBtnTitle}>{t('dl.clearCompleted')}</Text>
              <Text style={styles.clearBtnHint}>Remove finished items from list</Text>
            </View>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.clearBtnRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
            onPress={() => {
              void hapticLight();
              mobileRecognizer.clearHistory();
              Alert.alert(t('common.ok'), 'Song recognition history cleared');
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear Song Recognition History"
          >
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.clearBtnTitle}>Clear Song Recognition History</Text>
              <Text style={styles.clearBtnHint}>Reset identified songs list</Text>
            </View>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      {/* App Updates */}
      <View style={styles.section}>
        <View style={[styles.sectionHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Ionicons name="cloud-download-outline" size={18} color={colors.accent} />
          <Text style={styles.sectionTitle}>{t('set.appUpdates')}</Text>
        </View>
        <View style={styles.card}>
          <View style={[styles.settingRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={styles.settingLabel}>GRabbit Mobile v{updateStatus.currentVersion}</Text>
              <Text style={styles.settingHint}>
                {updateStatus.state === 'checking'
                  ? t('set.checkingUpdates')
                  : updateStatus.state === 'available' && updateStatus.latestVersion
                  ? t('set.updateAvailable', { version: updateStatus.latestVersion })
                  : updateStatus.state === 'downloading'
                  ? t('set.downloadingUpdate', { percent: updateStatus.progressPercent ?? 0 })
                  : updateStatus.state === 'installing'
                  ? t('set.updateReady')
                  : updateStatus.state === 'up-to-date'
                  ? t('set.upToDate')
                  : updateStatus.state === 'error'
                  ? updateStatus.error || t('err.UNKNOWN')
                  : t('set.checkForUpdates')}
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.updateBtn,
                (updateStatus.state === 'checking' || updateStatus.state === 'downloading') && { opacity: 0.6 },
              ]}
              disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
              onPress={handleCheckAndUpdate}
              accessibilityRole="button"
              accessibilityLabel={t('set.checkForUpdates')}
            >
              <Ionicons name="refresh-outline" size={15} color="#ffffff" />
              <Text style={styles.updateBtnText}>
                {updateStatus.state === 'checking'
                  ? '…'
                  : updateStatus.state === 'downloading'
                  ? `${updateStatus.progressPercent ?? 0}%`
                  : updateStatus.state === 'available'
                  ? t('mobile.downloadApk')
                  : updateStatus.state === 'installing'
                  ? t('set.restartAndInstall')
                  : t('app.update')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* About */}
      <View style={styles.aboutCard}>
        <Text style={styles.aboutTitle}>🐰 GRabbit Mobile</Text>
        <Text style={styles.aboutVersion}>v{updateStatus.currentVersion}</Text>
        <Text style={styles.aboutDesc}>
          Cross-platform download manager & media grabber powered by Expo & @grabbit core engines.
        </Text>
      </View>

      <PairingModal
        visible={showPairingModal}
        onClose={() => setShowPairingModal(false)}
        onSuccess={() => void refreshStorage()}
      />
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
      gap: 20,
      paddingBottom: 40,
    },
    header: {
      marginVertical: 8,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    section: {
      gap: 8,
    },
    sectionHeader: {
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 4,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.accent,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 16,
    },
    settingRow: {
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    settingLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    settingHint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    stepperRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    stepperBtn: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperVal: {
      fontSize: 15,
      fontWeight: 'bold',
      color: colors.accent,
      minWidth: 20,
      textAlign: 'center',
    },
    segmentedRow: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 8,
      padding: 3,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      minHeight: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    segBtnActive: {
      backgroundColor: colors.accent,
    },
    segBtnText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    segBtnTextActive: {
      color: '#ffffff',
    },
    numberInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: colors.textPrimary,
      fontSize: 14,
      width: 90,
      textAlign: 'center',
      minHeight: 40,
    },
    storageSummaryBox: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 14,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    storageStat: {
      flex: 1,
      alignItems: 'center',
    },
    storageStatLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    storageStatVal: {
      fontSize: 16,
      fontWeight: 'bold',
      color: colors.accent,
    },
    storageDivider: {
      width: 1,
      height: 32,
      backgroundColor: colors.border,
    },
    cleanStorageBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 12,
      minHeight: 44,
    },
    cleanStorageBtnText: {
      color: '#ffffff',
      fontWeight: 'bold',
      fontSize: 14,
    },
    qrPairBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 12,
      minHeight: 44,
    },
    qrPairBtnText: {
      color: colors.textPrimary,
      fontWeight: '600',
      fontSize: 14,
    },
    clearBtnRow: {
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      minHeight: 44,
    },
    clearBtnTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    clearBtnHint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    updateBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
      minHeight: 40,
    },
    updateBtnText: {
      color: '#ffffff',
      fontWeight: '600',
      fontSize: 13,
    },
    aboutCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
      marginTop: 8,
    },
    aboutTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    aboutVersion: {
      fontSize: 12,
      color: colors.accent,
      fontWeight: '600',
    },
    aboutDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 6,
      lineHeight: 16,
    },
  });
