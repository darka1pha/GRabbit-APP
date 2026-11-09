import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { PlatformMetadata, MediaItem, MediaOption } from '@grabbit/types';
import { mobileBridge } from '../services/bridge';
import { MobileDownloadTask } from '../services/download-manager';
import { useDownloads } from '../hooks/useDownloads';
import { useShareIntent } from '../hooks/useShareIntent';
import { MediaCard } from '../components/MediaCard';
import { OptionSelectorModal } from '../components/OptionSelectorModal';
import { MediaPlayerModal, MediaPlayerSource } from '../components/MediaPlayerModal';

type FilterTab = 'all' | 'active' | 'completed';

export default function HomeScreen() {
  const [url, setUrl] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resolvedMeta, setResolvedMeta] = useState<PlatformMetadata | null>(null);
  const [selectorVisible, setSelectorVisible] = useState(false);

  // Filter tab state
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  // Media Player state
  const [playerVisible, setPlayerVisible] = useState(false);
  const [playerSource, setPlayerSource] = useState<MediaPlayerSource | null>(null);

  // Downloads hook
  const {
    tasks,
    activeTasks,
    completedTasks,
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    saveToLibrary,
    deleteDownload,
  } = useDownloads();

  // Share intent receiver
  const handleUrlFromShare = useCallback((incomingUrl: string) => {
    setUrl(incomingUrl);
  }, []);

  const { sharedUrl, clearSharedUrl } = useShareIntent(handleUrlFromShare);

  // Paste from clipboard
  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        const { url: parsedUrl } = mobileBridge.extractAndParseUrl(text);
        setUrl(parsedUrl);
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
    }
  };

  // Grab button submit
  const handleGrab = async (targetUrl = url) => {
    const input = targetUrl.trim();
    if (!input) return;

    setErrorMessage(null);
    setIsResolving(true);

    try {
      const meta = await mobileBridge.resolveMetadata(input);
      if (!meta || meta.items.length === 0) {
        setErrorMessage('Could not extract downloadable media from this link.');
      } else {
        setResolvedMeta(meta);
        setSelectorVisible(true);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resolve media metadata.');
    } finally {
      setIsResolving(false);
    }
  };

  // User selects an option from the modal and triggers download
  const handleOptionSelected = async (item: MediaItem, option: MediaOption) => {
    try {
      await startDownload(item, option);
      setUrl('');
      clearSharedUrl();
    } catch (err: any) {
      Alert.alert('Download Error', err.message || 'Failed to start download');
    }
  };

  // Preview directly from Option Selector modal
  const handlePreviewStream = (item: MediaItem, option: MediaOption) => {
    setSelectorVisible(false);
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

  // Play completed download from local storage
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

  // Save to Photos / Camera Roll
  const handleSaveToGallery = async (id: string) => {
    const res = await saveToLibrary(id);
    Alert.alert(res.success ? 'Success' : 'Notice', res.message);
  };

  // Filter tasks based on active tab
  const displayedTasks =
    activeTab === 'active'
      ? activeTasks
      : activeTab === 'completed'
      ? completedTasks
      : tasks;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>🐰 gRabbit</Text>
        <Text style={styles.subtitle}>Drop a link. Grab the goods.</Text>
      </View>

      {/* Share Target Notification Banner */}
      {sharedUrl && (
        <View style={styles.shareBanner}>
          <View style={styles.shareBannerLeft}>
            <Ionicons name="share-social" size={20} color="#38bdf8" />
            <View style={{ flex: 1 }}>
              <Text style={styles.shareBannerTitle}>Received shared link</Text>
              <Text style={styles.shareBannerText} numberOfLines={1}>
                {sharedUrl}
              </Text>
            </View>
          </View>
          <View style={styles.shareBannerActions}>
            <TouchableOpacity
              style={styles.shareGrabBtn}
              onPress={() => handleGrab(sharedUrl)}
            >
              <Text style={styles.shareGrabText}>Grab</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearSharedUrl} style={styles.shareDismissBtn}>
              <Ionicons name="close" size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Input Row */}
      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Paste URL (YouTube, Spotify, Instagram, TikTok...)"
            placeholderTextColor="#64748b"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {url.length > 0 ? (
            <TouchableOpacity onPress={() => setUrl('')} style={styles.inputIconBtn}>
              <Ionicons name="close-circle" size={18} color="#94a3b8" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handlePaste} style={styles.inputIconBtn}>
              <Ionicons name="clipboard-outline" size={18} color="#38bdf8" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.button, isResolving && styles.buttonDisabled]}
          onPress={() => handleGrab()}
          disabled={isResolving}
          activeOpacity={0.8}
        >
          {isResolving ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Grab</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Error Banner */}
      {errorMessage && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={18} color="#ef4444" />
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      {/* Section Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabPill, activeTab === 'all' && styles.tabPillActive]}
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabPillText, activeTab === 'all' && styles.tabPillTextActive]}>
            All ({tasks.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabPill, activeTab === 'active' && styles.tabPillActive]}
          onPress={() => setActiveTab('active')}
        >
          <Text style={[styles.tabPillText, activeTab === 'active' && styles.tabPillTextActive]}>
            Active ({activeTasks.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabPill, activeTab === 'completed' && styles.tabPillActive]}
          onPress={() => setActiveTab('completed')}
        >
          <Text style={[styles.tabPillText, activeTab === 'completed' && styles.tabPillTextActive]}>
            Completed ({completedTasks.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Downloads List */}
      <View style={styles.tasksList}>
        {displayedTasks.map((t) => (
          <MediaCard
            key={t.id}
            task={t}
            onPause={pauseDownload}
            onResume={resumeDownload}
            onCancel={cancelDownload}
            onPlay={handlePlayDownloaded}
            onSaveToLibrary={handleSaveToGallery}
            onDelete={deleteDownload}
          />
        ))}

        {displayedTasks.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="cloud-download-outline" size={48} color="#334155" />
            <Text style={styles.emptyTitle}>No downloads in this view</Text>
            <Text style={styles.emptySubtitle}>
              Paste a link from Spotify, YouTube, Instagram or share a link directly to gRabbit!
            </Text>
          </View>
        )}
      </View>

      {/* Option Selector Modal */}
      <OptionSelectorModal
        visible={selectorVisible}
        metadata={resolvedMeta}
        onClose={() => setSelectorVisible(false)}
        onSelectOption={handleOptionSelected}
        onPreview={handlePreviewStream}
      />

      {/* In-App Media Player Modal */}
      <MediaPlayerModal
        visible={playerVisible}
        source={playerSource}
        onClose={() => {
          setPlayerVisible(false);
          setPlayerSource(null);
        }}
        onSaveToLibrary={() => {
          const matchingCompleted = completedTasks.find((c) => c.localUri === playerSource?.uri);
          if (matchingCompleted) {
            handleSaveToGallery(matchingCompleted.id);
          }
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    padding: 16,
    gap: 18,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginVertical: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#38bdf8',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  shareBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0369a126',
    borderWidth: 1,
    borderColor: '#38bdf866',
    borderRadius: 10,
    padding: 12,
  },
  shareBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  shareBannerTitle: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  shareBannerText: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  shareBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shareGrabBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  shareGrabText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  shareDismissBtn: {
    padding: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
  },
  inputIconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  button: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    minWidth: 70,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 15,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#450a0a',
    borderRadius: 8,
    padding: 10,
  },
  errorBannerText: {
    color: '#fca5a5',
    fontSize: 13,
    flex: 1,
  },
  tabsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  tabPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  tabPillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  tabPillText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  tabPillTextActive: {
    color: '#ffffff',
  },
  tasksList: {
    gap: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: '#64748b',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#475569',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
});
