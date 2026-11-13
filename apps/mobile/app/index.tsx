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
import { hapticLight } from '../services/haptics';
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
  const [activeTab, setActiveTab] = useState<AppTab>('grab');
  const [initialGrabUrl, setInitialGrabUrl] = useState('');
  const [addDirectUrl, setAddDirectUrl] = useState<string | null>(null);

  // In-App Media Player
  const [playerVisible, setPlayerVisible] = useState(false);
  const [playerSource, setPlayerSource] = useState<MediaPlayerSource | null>(null);

  const { tasks, activeTasks, saveToLibrary } = useDownloads();

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

  // Share Intent
  const handleIncomingShareUrl = useCallback((incomingUrl: string) => {
    setInitialGrabUrl(incomingUrl);
    setActiveTab('grab');
  }, []);

  const { sharedUrl, clearSharedUrl } = useShareIntent(handleIncomingShareUrl);

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
    <SafeAreaView style={styles.container}>
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
        style={[styles.navBar, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
        accessibilityRole="tablist"
      >
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => switchTab('grab')}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityLabel={t('nav.grab')}
          accessibilityState={{ selected: activeTab === 'grab' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={activeTab === 'grab' ? 'flash' : 'flash-outline'}
            size={22}
            color={activeTab === 'grab' ? '#6366f1' : '#94a3b8'}
          />
          <Text style={[styles.navLabel, activeTab === 'grab' && styles.navLabelActive]}>
            {t('nav.grab')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => switchTab('downloads')}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityLabel={t('nav.downloads')}
          accessibilityState={{ selected: activeTab === 'downloads' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View>
            <Ionicons
              name={activeTab === 'downloads' ? 'download' : 'download-outline'}
              size={22}
              color={activeTab === 'downloads' ? '#6366f1' : '#94a3b8'}
            />
            {activeTasks.length > 0 && (
              <View style={styles.navBadge}>
                <Text style={styles.navBadgeText}>{activeTasks.length}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.navLabel, activeTab === 'downloads' && styles.navLabelActive]}>
            {t('nav.downloads')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => switchTab('recognize')}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityLabel={t('nav.recognize')}
          accessibilityState={{ selected: activeTab === 'recognize' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={activeTab === 'recognize' ? 'musical-notes' : 'musical-notes-outline'}
            size={22}
            color={activeTab === 'recognize' ? '#6366f1' : '#94a3b8'}
          />
          <Text style={[styles.navLabel, activeTab === 'recognize' && styles.navLabelActive]}>
            {t('nav.recognize')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => switchTab('settings')}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityLabel={t('nav.settings')}
          accessibilityState={{ selected: activeTab === 'settings' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={activeTab === 'settings' ? 'settings' : 'settings-outline'}
            size={22}
            color={activeTab === 'settings' ? '#6366f1' : '#94a3b8'}
          />
          <Text style={[styles.navLabel, activeTab === 'settings' && styles.navLabelActive]}>
            {t('nav.settings')}
          </Text>
        </TouchableOpacity>
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
