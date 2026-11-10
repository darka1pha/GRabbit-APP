import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { mobileUpdater, MobileUpdateStatus } from '../services/updater';

const StackNavigator = Stack as any;

function HeaderUpdateButton() {
  const [status, setStatus] = useState<MobileUpdateStatus>(mobileUpdater.getStatus());

  useEffect(() => {
    return mobileUpdater.subscribe(setStatus);
  }, []);

  const busy = status.state === 'checking' || status.state === 'downloading';

  return (
    <TouchableOpacity
      style={[styles.updateBtn, busy && { opacity: 0.65 }]}
      disabled={busy}
      onPress={async () => {
        const res = await mobileUpdater.checkAndInstallUpdate();
        if (res.state === 'up-to-date') {
          Alert.alert('Up to Date', `GRabbit Mobile v${res.currentVersion} is already on the latest version.`);
        } else if (res.state === 'error' && res.error) {
          Alert.alert('Update Error', res.error);
        }
      }}
    >
      <Ionicons name="refresh-outline" size={14} color="#38bdf8" />
      <Text style={styles.updateBtnText}>
        {status.state === 'checking'
          ? 'Checking…'
          : status.state === 'downloading'
          ? `${status.progressPercent ?? 0}%`
          : 'Update'}
      </Text>
    </TouchableOpacity>
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
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>GRabbit encountered an error</Text>
          <Text style={styles.errorMessage}>
            {this.state.error.message || String(this.state.error)}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => this.setState({ error: null })}
          >
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <StatusBar style="light" />
      <StackNavigator
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#ffffff',
          contentStyle: { backgroundColor: '#020617' },
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
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    marginRight: 8,
  },
  updateBtnText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f87171',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#0284c7',
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

