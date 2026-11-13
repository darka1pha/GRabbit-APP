import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MediaItem, MediaOption } from '@grabbit/types';
import { useShareIntent } from '../hooks/useShareIntent';
import { useDownloads } from '../hooks/useDownloads';
import { MobileDownloadTask } from '../services/download-manager';
import { mobileBridge } from '../services/bridge';
import { notificationService } from '../services/notification-service';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '../hooks/useTheme';
import { hapticLight, hapticSuccess } from '../services/haptics';
import {
  GrabView,
  DownloadsView,
  RecognizeView,
  SettingsView,
  MediaPlayerModal,
  MediaPlayerSource,
  AddDownloadModal,
  MotionView,
} from '../components';

type AppTab = 'grab' | 'downloads' | 'recognize' | 'settings';

export default function HomeScreen() {
  const { t, isRtl } = useI18n();
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<AppTab>('grab');
  const [initialGrabUrl, setInitialGrabUrl] = useState('');
  const [addDirectUrl, setAddDirectUrl] = useState<string | null>(null);

  // In-App Media Player
  const [playerVisible, setPlayerVisible] = useState(false);
  const [playerSource, setPlayerSource] = useState<MediaPlayerSource | null>(null);

  const { tasks, activeTasks, startHttpDownload, saveToLibrary } = useDownloads();

  // Handle incoming notification tap (Item 6.2)
  useEffect(() => {
    const sub = notificationService.onNotificationTap((data) => {
      setActiveTab('downloads');
      if (data?.taskId) {
        const matchingTask = tasks.find((t) => t.id === data.taskId);
        if (matchingTask && matchingTask.status === 'completed') {
          handlePlayDownloaded(matchingTask);
        }
      }
    });

    return () => {
      sub.remove();
    };
  }, [tasks]);

  // Share Intent & Deep Links (grabbit://pair, grabbit://transfer)
  const handleIncomingShareUrl = useCallback((incomingUrl: string) => {
    setInitialGrabUrl(incomingUrl);
    setActiveTab('grab');
  }, []);

  const handleIncomingTransfer = useCallback(
    async (transfer: { url: string; fileName: string }) => {
      void hapticSuccess();
      setActiveTab('downloads');
      await startHttpDownload({ url: transfer.url, fileName: transfer.fileName });
      Alert.alert(t('dl.transferReady'), transfer.fileName);
    },
    [startHttpDownload, t]
  );

  const handleIncomingPair = useCallback(
    (pair: { host: string; port: number }) => {
      void hapticSuccess();
      Alert.alert(t('mobile.pairSuccess'), `${pair.host}:${pair.port}`);
    },
    [t]
  );

  const { sharedUrl, clearSharedUrl } = useShareIntent({
    onUrlReceived: handleIncomingShareUrl,
    onTransferReceived: handleIncomingTransfer,
    onPairReceived: handleIncomingPair,
  });

  const switchTab = (tab: AppTab) => {
    void hapticLight();
    setActiveTab(tab);
  };

  // Stream preview from Grab view
  const handlePreviewStream = async (item: MediaItem, option: MediaOption) => {
    let uri = option.directStreamUrl || item.url;
    if (!option.directStreamUrl) {
      try {
        const resolved = await mobileBridge.resolveDirectStreamUrl(item.url, item.platform, option);
        if (resolved.streamUrl) uri = resolved.streamUrl;
      } catch {
        // Fall back to source URL if resolver fails; modal displays playback error cleanly
      }
    }
    setPlayerSource({
      uri,
      title: item.title,
      author: item.uploader,
      thumbnailUrl: item.thumbnailUrl,
      isVideo: option.format === 'video',
      canSaveToLibrary: false,
    });
    setPlayerVisible(true);
  };

  // Play downloaded task from Downloads view
  const handlePlayDownloaded = (task: MobileDownloadTask) => {
    setPlayerSource({
      taskId: task.id,
      uri: task.localUri,
      title: task.title,
      author: task.author,
      thumbnailUrl: task.thumbnailUrl,
      isVideo: task.format === 'video',
      canSaveToLibrary: !task.savedToLibrary && (task.category === 'video' || task.category === 'images'),
    });
    setPlayerVisible(true);
  };

  // Switch to Grab with a query (e.g. from Recognize)
  const handleFindAndDownload = (query: string) => {
    setInitialGrabUrl(query);
    setActiveTab('grab');
  };

  // Open Direct Download modal with URL
  const handleOpenDirectDownload = (url: string) => {
    setAddDirectUrl(url);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* View Content Stage */}
      <MotionView
        key={activeTab}
        style={styles.stage}
        initial={{ opacity: 0, translateY: 8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ duration: 200 }}
      >
        {activeTab === 'grab' && (
          <GrabView
            initialUrl={initialGrabUrl}
            sharedUrl={sharedUrl}
            onClearSharedUrl={clearSharedUrl}
            onOpenDirectDownload={handleOpenDirectDownload}
            onDownloadStarted={() => setActiveTab('downloads')}
            onPreviewMedia={handlePreviewStream}
          />
        )}

        {activeTab === 'downloads' && (
          <DownloadsView
            onPlayMedia={handlePlayDownloaded}
            onOpenInGrab={(url) => {
              setInitialGrabUrl(url);
              setActiveTab('grab');
            }}
          />
        )}

        {activeTab === 'recognize' && (
          <RecognizeView onFindAndDownload={handleFindAndDownload} />
        )}

        {activeTab === 'settings' && <SettingsView />}
      </MotionView>

      {/* Sleek Bottom Navigation Bar */}
      <View
        style={[
          styles.navBar,
          {
            flexDirection: isRtl ? 'row-reverse' : 'row',
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        ]}
        accessibilityRole="tablist"
      >
        {(
          [
            { key: 'grab', activeIcon: 'flash', idleIcon: 'flash-outline', label: t('nav.grab') },
            {
              key: 'downloads',
              activeIcon: 'download',
              idleIcon: 'download-outline',
              label: t('nav.downloads'),
              badge: activeTasks.length,
            },
            {
              key: 'recognize',
              activeIcon: 'musical-notes',
              idleIcon: 'musical-notes-outline',
              label: t('nav.recognize'),
            },
            {
              key: 'settings',
              activeIcon: 'settings',
              idleIcon: 'settings-outline',
              label: t('nav.settings'),
            },
          ] as const
        ).map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.navItem}
              onPress={() => switchTab(tab.key)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View>
                <Ionicons
                  name={isActive ? tab.activeIcon : tab.idleIcon}
                  size={22}
                  color={isActive ? colors.accent : colors.textSecondary}
                />
                {'badge' in tab && tab.badge > 0 && (
                  <View
                    style={[
                      styles.navBadge,
                      { backgroundColor: colors.accent, borderColor: colors.surface },
                    ]}
                  >
                    <Text style={styles.navBadgeText}>{tab.badge}</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.navLabel,
                  { color: colors.textSecondary },
                  isActive && { color: colors.accent, fontWeight: '700' },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Global In-App Media Player Modal */}
      <MediaPlayerModal
        visible={playerVisible}
        source={playerSource}
        onClose={() => {
          setPlayerVisible(false);
          setPlayerSource(null);
        }}
        onSaveToLibrary={async () => {
          if (!playerSource?.taskId) return;
          const res = await saveToLibrary(playerSource.taskId);
          Alert.alert(res.success ? 'Saved' : 'Error', res.message);
          if (res.success) {
            setPlayerSource((prev) => (prev ? { ...prev, canSaveToLibrary: false } : null));
          }
        }}
      />

      {/* Direct Download Dialog when triggered from Grab or elsewhere */}
      <AddDownloadModal
        visible={!!addDirectUrl}
        initialUrl={addDirectUrl || ''}
        onClose={() => setAddDirectUrl(null)}
        onOpenInGrab={(url) => {
          setAddDirectUrl(null);
          setInitialGrabUrl(url);
          setActiveTab('grab');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  stage: {
    flex: 1,
  },
  navBar: {
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#131b2e',
    borderTopWidth: 1,
    borderTopColor: '#233253',
    paddingVertical: 8,
    paddingBottom: 12,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 64,
    minHeight: 44,
  },
  navLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
  },
  navLabelActive: {
    color: '#6366f1',
    fontWeight: '700',
  },
  navBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#131b2e',
  },
  navBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
  },
});
