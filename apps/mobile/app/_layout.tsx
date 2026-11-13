import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { mobileUpdater, MobileUpdateStatus } from '../services/updater';
import { ThemeProvider, useTheme } from '../hooks/useTheme';
import { useI18n } from '../hooks/useI18n';

const StackNavigator = Stack as any;

function HeaderUpdateButton() {
  const { colors, isDark } = useTheme();
  const { t, isRtl } = useI18n();
  const [status, setStatus] = useState<MobileUpdateStatus>(mobileUpdater.getStatus());

  useEffect(() => {
    return mobileUpdater.subscribe(setStatus);
  }, []);

  if (
    status.state !== 'available' &&
    status.state !== 'downloading' &&
    status.state !== 'installing'
  ) {
    return null;
  }

  const busy = status.state === 'downloading';

  const handlePress = async () => {
    if (status.state === 'available' && status.downloadUrl && status.latestVersion) {
      Alert.alert(
        t('mobile.updateAvailable', { version: status.latestVersion }),
        t('mobile.updateNotesPrompt', { version: status.latestVersion }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('mobile.downloadApk'),
            onPress: async () => {
              const res = await mobileUpdater.downloadAndInstallApk(
                status.downloadUrl!,
                status.latestVersion!
              );
              if (res.state === 'error' && res.error) {
                Alert.alert(t('dl.error'), res.error);
              }
            },
          },
        ]
      );
      return;
    }

    const res =
      status.state === 'installing'
        ? await mobileUpdater.installDownloadedApk()
        : await mobileUpdater.checkAndInstallUpdate();
    if (res.state === 'up-to-date') {
      Alert.alert(t('set.upToDate'), `v${res.currentVersion}`);
    } else if (res.state === 'error' && res.error) {
      Alert.alert(t('dl.error'), res.error);
    } else if (res.state === 'installing') {
      Alert.alert(
        t('set.updateReady'),
        'The update package has been launched. If prompted, allow "Install unknown apps" for GRabbit in Android Settings.'
      );
    }
  };

  const label =
    status.state === 'downloading'
      ? `${status.progressPercent ?? 0}%`
      : status.state === 'installing'
      ? t('set.updateReady')
      : status.latestVersion
      ? `v${status.latestVersion}`
      : t('app.update');

  return (
    <TouchableOpacity
      style={[
        styles.updateBtn,
        {
          backgroundColor: colors.accentSubtle,
          borderColor: colors.accent,
          flexDirection: isRtl ? 'row-reverse' : 'row',
          opacity: busy ? 0.65 : 1,
        },
      ]}
      disabled={busy}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        status.latestVersion
          ? t('mobile.updateAvailable', { version: status.latestVersion })
          : t('app.update')
      }
    >
      <Ionicons
        name={status.state === 'installing' ? 'checkmark-circle-outline' : 'arrow-down-circle-outline'}
        size={14}
        color={isDark ? '#38bdf8' : colors.accent}
      />
      <Text style={[styles.updateBtnText, { color: isDark ? '#38bdf8' : colors.accent }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ErrorFallbackView({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { colors } = useTheme();
  const { t, textDirStyle } = useI18n();
  return (
    <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
      <Text style={[styles.errorTitle, { color: colors.error }, textDirStyle]}>
        {t('dl.error')}
      </Text>
      <Text style={[styles.errorMessage, { color: colors.textSecondary }, textDirStyle]}>
        {error.message || String(error)}
      </Text>
      <TouchableOpacity
        style={[styles.retryButton, { backgroundColor: colors.accent }]}
        onPress={onRetry}
      >
        <Text style={styles.retryText}>{t('dl.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorFallbackView
          error={this.state.error}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

function ThemedStack() {
  const { colors, isDark } = useTheme();

  useEffect(() => {
    void mobileUpdater.checkForUpdatesSilent();
  }, []);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <StackNavigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <StackNavigator.Screen
          name="index"
          options={{
            title: 'GRabbit',
            headerRight: () => <HeaderUpdateButton />,
          }}
        />
      </StackNavigator>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppErrorBoundary>
        <ThemedStack />
      </AppErrorBoundary>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    marginRight: 8,
  },
  updateBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});
