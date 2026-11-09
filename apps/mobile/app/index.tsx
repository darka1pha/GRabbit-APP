import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MediaItem, MediaOption } from '@grabbit/types';
import { useShareIntent } from '../hooks/useShareIntent';
import { useDownloads } from '../hooks/useDownloads';
import { MobileDownloadTask } from '../services/download-manager';
import {
  GrabView,
  DownloadsView,
  RecognizeView,
  SettingsView,
  MediaPlayerModal,
  MediaPlayerSource,
  AddDownloadModal,
} from '../components';

type AppTab = 'grab' | 'downloads' | 'recognize' | 'settings';

export default function HomeScreen() {
  const [activeTab, setActiveTab] = useState<AppTab>('grab');
  const [initialGrabUrl, setInitialGrabUrl] = useState('');
  const [addDirectUrl, setAddDirectUrl] = useState<string | null>(null);

  // In-App Media Player
  const [playerVisible, setPlayerVisible] = useState(false);
  const [playerSource, setPlayerSource] = useState<MediaPlayerSource | null>(null);

  const { activeTasks, totalSpeed, saveToLibrary } = useDownloads();

  // Share Intent
  const handleIncomingShareUrl = useCallback((incomingUrl: string) => {
    setInitialGrabUrl(incomingUrl);
    setActiveTab('grab');
  }, []);

  const { sharedUrl, clearSharedUrl } = useShareIntent(handleIncomingShareUrl);

  // Stream preview from Grab view
  const handlePreviewStream = (item: MediaItem, option: MediaOption) => {
    setPlayerSource({
      uri: item.url,
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
      uri: task.localUri,
      title: task.title,
      author: task.author,
      thumbnailUrl: task.thumbnailUrl,
      isVideo: task.format === 'video',
      canSaveToLibrary: !task.savedToLibrary,
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
      <View style={styles.stage}>
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
      </View>

      {/* Sleek Bottom Navigation Bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('grab')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'grab' ? 'flash' : 'flash-outline'}
            size={22}
            color={activeTab === 'grab' ? '#38bdf8' : '#94a3b8'}
          />
          <Text style={[styles.navLabel, activeTab === 'grab' && styles.navLabelActive]}>
            Grab
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('downloads')}
          activeOpacity={0.7}
        >
          <View>
            <Ionicons
              name={activeTab === 'downloads' ? 'download' : 'download-outline'}
              size={22}
              color={activeTab === 'downloads' ? '#38bdf8' : '#94a3b8'}
            />
            {activeTasks.length > 0 && (
              <View style={styles.navBadge}>
                <Text style={styles.navBadgeText}>{activeTasks.length}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.navLabel, activeTab === 'downloads' && styles.navLabelActive]}>
            Downloads
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('recognize')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'recognize' ? 'musical-notes' : 'musical-notes-outline'}
            size={22}
            color={activeTab === 'recognize' ? '#38bdf8' : '#94a3b8'}
          />
          <Text style={[styles.navLabel, activeTab === 'recognize' && styles.navLabelActive]}>
            Recognize
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('settings')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'settings' ? 'settings' : 'settings-outline'}
            size={22}
            color={activeTab === 'settings' ? '#38bdf8' : '#94a3b8'}
          />
          <Text style={[styles.navLabel, activeTab === 'settings' && styles.navLabelActive]}>
            Settings
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
        onSaveToLibrary={() => {
          // If task matches, trigger save
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
    backgroundColor: '#020617',
  },
  stage: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingVertical: 8,
    paddingBottom: 12,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 64,
  },
  navLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
  },
  navLabelActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  navBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#0284c7',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#0f172a',
  },
  navBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
  },
});
