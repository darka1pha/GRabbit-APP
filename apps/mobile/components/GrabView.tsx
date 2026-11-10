import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import {
  PlatformMetadata,
  MediaItem,
  MediaOption,
  DownloadQueue,
} from '@grabbit/types';
import { formatBytes, formatDuration, isHttpUrl, looksLikeDirectFile } from '@grabbit/utils';
import { mobileBridge, PLATFORM_COLORS, PLATFORM_NAMES } from '../services/bridge';
import { mobileSettingsManager } from '../services/settings-manager';
import { useDownloads } from '../hooks/useDownloads';

const PLATFORM_CHIPS = [
  'YouTube',
  'Spotify',
  'Instagram',
  'TikTok',
  'SoundCloud',
  'X / Twitter',
  'Reddit',
  '+1000 Direct',
];

interface GrabViewProps {
  initialUrl?: string;
  sharedUrl?: string | null;
  onClearSharedUrl?: () => void;
  onOpenDirectDownload?: (url: string) => void;
  onDownloadStarted?: () => void;
  onPreviewMedia?: (item: MediaItem, option: MediaOption) => void;
}

export function GrabView({
  initialUrl = '',
  sharedUrl,
  onClearSharedUrl,
  onOpenDirectDownload,
  onDownloadStarted,
  onPreviewMedia,
}: GrabViewProps) {
  const { queues, startDownload } = useDownloads();

  const [input, setInput] = useState(initialUrl);
  const [isResolving, setIsResolving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resolvedMeta, setResolvedMeta] = useState<PlatformMetadata | null>(null);
  const [selectedQueueId, setSelectedQueueId] = useState('main');

  // Single media option choice
  const [selectedOption, setSelectedOption] = useState<MediaOption | null>(null);

  // Collection multi-select
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [collectionFormat, setCollectionFormat] = useState('audio:mp3');

  useEffect(() => {
    if (initialUrl) {
      setInput(initialUrl);
      handleGrab(initialUrl);
    }
  }, [initialUrl]);

  const looksDirect = useMemo(() => {
    return isHttpUrl(input) && looksLikeDirectFile(input);
  }, [input]);

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        const { url: parsedUrl } = mobileBridge.extractAndParseUrl(text);
        setInput(parsedUrl);
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
    }
  };

  const handleGrab = async (target = input) => {
    const text = target.trim();
    if (!text) return;

    if (looksLikeDirectFile(text) && onOpenDirectDownload) {
      onOpenDirectDownload(text);
      return;
    }

    setErrorMessage(null);
    setIsResolving(true);
    setResolvedMeta(null);
    setSelectedOption(null);

    try {
      const meta = await mobileBridge.resolveMetadata(text);
      if (!meta || meta.items.length === 0) {
        setErrorMessage('Could not extract media from this link.');
      } else {
        setResolvedMeta(meta);
        if (!meta.isCollection && meta.items[0]) {
          const first = meta.items[0];
          setSelectedOption(first.availableOptions[0] || null);
        } else if (meta.isCollection) {
          setSelectedTrackIds(new Set(meta.items.filter((i) => i.isDownloadable).map((i) => i.id)));
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resolve media metadata.');
    } finally {
      setIsResolving(false);
    }
  };

  const handleSingleDownload = async () => {
    if (!resolvedMeta || !resolvedMeta.items[0] || !selectedOption) return;
    try {
      await startDownload(resolvedMeta.items[0], selectedOption, selectedQueueId);
      setInput('');
      setResolvedMeta(null);
      onDownloadStarted?.();
    } catch (err: any) {
      Alert.alert('Download Error', err.message || 'Could not start download');
    }
  };

  const handleSendToDesktop = async () => {
    if (!resolvedMeta || !resolvedMeta.items[0]) return;
    const item = resolvedMeta.items[0];
    const res = await mobileBridge.sendToDesktop(item.url, { fileName: item.title });
    if (res.success) {
      Alert.alert('Sent to Desktop PC', `"${item.title}" was added to your GRabbit Desktop download queue!`);
      setInput('');
      setResolvedMeta(null);
    } else {
      Alert.alert('Desktop Sync Failed', res.error || 'Could not reach GRabbit Desktop RPC Bridge.');
    }
  };

  const handleCollectionDownload = async () => {
    if (!resolvedMeta || !resolvedMeta.items) return;
    const itemsToDownload = resolvedMeta.items.filter((i) => selectedTrackIds.has(i.id));
    if (itemsToDownload.length === 0) {
      Alert.alert('Notice', 'No tracks selected');
      return;
    }

    const [fmtKind, quality] = collectionFormat.split(':');
    const option: MediaOption = {
      format: fmtKind as 'audio' | 'video',
      qualityId: quality || 'mp3',
      label: quality.toUpperCase(),
      extension: fmtKind === 'audio' ? 'mp3' : 'mp4',
    };

    try {
      for (const item of itemsToDownload) {
        await startDownload(item, option, selectedQueueId);
      }
      setInput('');
      setResolvedMeta(null);
      onDownloadStarted?.();
    } catch (err: any) {
      Alert.alert('Download Error', err.message || 'Could not start batch download');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>🐰 GRabbit</Text>
        <Text style={styles.subtitle}>Drop a link. Grab the goods.</Text>
      </View>

      {/* Share Target Banner */}
      {sharedUrl && (
        <View style={styles.shareBanner}>
          <View style={styles.shareBannerLeft}>
            <Ionicons name="share-social" size={18} color="#38bdf8" />
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
              onPress={() => {
                setInput(sharedUrl);
                handleGrab(sharedUrl);
                onClearSharedUrl?.();
              }}
            >
              <Text style={styles.shareGrabText}>Grab</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClearSharedUrl} style={styles.shareDismissBtn}>
              <Ionicons name="close" size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Input Box */}
      <View style={styles.inputCard}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Paste URL (YouTube, Spotify, SoundCloud, Instagram...)"
            placeholderTextColor="#64748b"
            value={input}
            onChangeText={setInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {input.length > 0 ? (
            <TouchableOpacity onPress={() => setInput('')} style={styles.inputIconBtn}>
              <Ionicons name="close-circle" size={18} color="#94a3b8" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handlePaste} style={styles.inputIconBtn}>
              <Ionicons name="clipboard-outline" size={18} color="#38bdf8" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.grabBtn, isResolving && styles.grabBtnDisabled]}
          onPress={() => handleGrab()}
          disabled={isResolving}
          activeOpacity={0.8}
        >
          {isResolving ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="download" size={16} color="#ffffff" />
              <Text style={styles.grabBtnText}>Grab Media</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Direct file detected prompt */}
      {looksDirect && onOpenDirectDownload && (
        <View style={styles.directFileCard}>
          <Ionicons name="document-attach-outline" size={20} color="#38bdf8" />
          <View style={{ flex: 1 }}>
            <Text style={styles.directFileTitle}>Direct File Download Detected</Text>
            <Text style={styles.directFileSubtitle}>
              This link points to an archive, package or file. Open in Direct Downloader with segment threads & checksums?
            </Text>
          </View>
          <TouchableOpacity
            style={styles.directFileBtn}
            onPress={() => onOpenDirectDownload(input)}
          >
            <Text style={styles.directFileBtnText}>Open</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Platform Chips */}
      <View style={styles.platformScrollWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.platformScroll}>
          {PLATFORM_CHIPS.map((p) => (
            <View key={p} style={styles.platformChip}>
              <Text style={styles.platformChipText}>{p}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Error Banner */}
      {errorMessage && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={18} color="#ef4444" />
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      {/* Single Media Resolved Card */}
      {resolvedMeta && !resolvedMeta.isCollection && resolvedMeta.items[0] && (
        <View style={styles.mediaResolvedCard}>
          <View style={styles.mediaTop}>
            {resolvedMeta.items[0].thumbnailUrl ? (
              <Image source={{ uri: resolvedMeta.items[0].thumbnailUrl }} style={styles.mediaThumb} />
            ) : (
              <View style={styles.mediaThumbPlaceholder}>
                <Ionicons name="film-outline" size={32} color="#94a3b8" />
              </View>
            )}

            <View style={styles.mediaInfo}>
              <Text style={styles.mediaTitle} numberOfLines={2}>
                {resolvedMeta.items[0].title}
              </Text>
              {resolvedMeta.items[0].uploader ? (
                <Text style={styles.mediaUploader} numberOfLines={1}>
                  {resolvedMeta.items[0].uploader}
                </Text>
              ) : null}
              {resolvedMeta.items[0].durationSeconds ? (
                <Text style={styles.mediaDuration}>
                  Duration: {formatDuration(resolvedMeta.items[0].durationSeconds)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Quality Options Section */}
          <View style={styles.optionsSection}>
            <Text style={styles.optionsSectionTitle}>Select Quality & Format:</Text>
            <View style={styles.optionsGrid}>
              {resolvedMeta.items[0].availableOptions.map((opt) => {
                const isSelected = selectedOption?.qualityId === opt.qualityId && selectedOption?.format === opt.format;
                return (
                  <TouchableOpacity
                    key={`${opt.format}-${opt.qualityId}`}
                    style={[styles.optionTile, isSelected && styles.optionTileActive]}
                    onPress={() => setSelectedOption(opt)}
                  >
                    <View style={styles.optionHeader}>
                      <Ionicons
                        name={opt.format === 'video' ? 'videocam' : 'musical-note'}
                        size={14}
                        color={isSelected ? '#38bdf8' : '#94a3b8'}
                      />
                      <Text style={[styles.optionLabel, isSelected && styles.optionLabelActive]}>
                        {opt.label}
                      </Text>
                    </View>
                    <Text style={styles.optionSize}>
                      {opt.estimatedSizeBytes ? `~${formatBytes(opt.estimatedSizeBytes)}` : opt.extension.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Target Queue Selector */}
          <View style={styles.queueSelectSection}>
            <Text style={styles.queueSelectLabel}>Target Download Queue:</Text>
            <View style={styles.queuePillsRow}>
              {queues.map((q) => (
                <TouchableOpacity
                  key={q.id}
                  style={[styles.queuePill, selectedQueueId === q.id && styles.queuePillActive]}
                  onPress={() => setSelectedQueueId(q.id)}
                >
                  <Text
                    style={[
                      styles.queuePillText,
                      selectedQueueId === q.id && styles.queuePillTextActive,
                    ]}
                  >
                    {q.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Action Row */}
          <View style={styles.mediaActionsRow}>
            {onPreviewMedia && selectedOption && (
              <TouchableOpacity
                style={styles.previewBtn}
                onPress={() => onPreviewMedia(resolvedMeta.items[0], selectedOption)}
              >
                <Ionicons name="play-outline" size={16} color="#38bdf8" />
                <Text style={styles.previewBtnText}>Preview</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.downloadBtn, !selectedOption && styles.downloadBtnDisabled]}
              onPress={handleSingleDownload}
              disabled={!selectedOption}
            >
              <Ionicons name="download" size={16} color="#ffffff" />
              <Text style={styles.downloadBtnText}>Download to GRabbit</Text>
            </TouchableOpacity>

            {mobileSettingsManager.getSettings().desktopBridge.enabled && (
              <TouchableOpacity
                style={styles.previewBtn}
                onPress={handleSendToDesktop}
              >
                <Ionicons name="desktop-outline" size={16} color="#38bdf8" />
                <Text style={styles.previewBtnText}>PC</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Collection / Playlist Resolved Card */}
      {resolvedMeta && resolvedMeta.isCollection && (
        <View style={styles.collectionCard}>
          <View style={styles.collectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.collectionTitle}>{resolvedMeta.title}</Text>
              <Text style={styles.collectionSubtitle}>
                {resolvedMeta.items.length} tracks in album / playlist
              </Text>
            </View>
          </View>

          {/* Batch format choices & selections */}
          <View style={styles.collectionControls}>
            <TouchableOpacity
              style={styles.selectToggleBtn}
              onPress={() =>
                setSelectedTrackIds(
                  new Set(resolvedMeta.items.filter((i) => i.isDownloadable).map((i) => i.id))
                )
              }
            >
              <Text style={styles.selectToggleText}>Select All</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.selectToggleBtn}
              onPress={() => setSelectedTrackIds(new Set())}
            >
              <Text style={styles.selectToggleText}>Clear</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            <View style={styles.formatPills}>
              {['audio:mp3', 'audio:m4a', 'video:1080p', 'video:720p'].map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.fmtPill, collectionFormat === f && styles.fmtPillActive]}
                  onPress={() => setCollectionFormat(f)}
                >
                  <Text style={[styles.fmtPillText, collectionFormat === f && styles.fmtPillTextActive]}>
                    {f.split(':')[1].toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Tracks List */}
          <View style={styles.trackList}>
            {resolvedMeta.items.map((item, idx) => {
              const isChecked = selectedTrackIds.has(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.trackRow, isChecked && styles.trackRowChecked]}
                  onPress={() => {
                    const next = new Set(selectedTrackIds);
                    if (isChecked) next.delete(item.id);
                    else next.add(item.id);
                    setSelectedTrackIds(next);
                  }}
                >
                  <Ionicons
                    name={isChecked ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={isChecked ? '#38bdf8' : '#64748b'}
                  />
                  <Text style={styles.trackIndex}>{idx + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.uploader ? (
                      <Text style={styles.trackAuthor} numberOfLines={1}>
                        {item.uploader}
                      </Text>
                    ) : null}
                  </View>
                  {item.durationSeconds ? (
                    <Text style={styles.trackDuration}>{formatDuration(item.durationSeconds)}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Batch Download Button */}
          <TouchableOpacity
            style={[styles.batchDownloadBtn, selectedTrackIds.size === 0 && styles.batchDownloadBtnDisabled]}
            onPress={handleCollectionDownload}
            disabled={selectedTrackIds.size === 0}
          >
            <Ionicons name="download" size={16} color="#ffffff" />
            <Text style={styles.batchDownloadBtnText}>
              Download Selected ({selectedTrackIds.size})
            </Text>
          </TouchableOpacity>
        </View>
      )}
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
    gap: 16,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginVertical: 10,
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
  inputCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    color: '#ffffff',
    fontSize: 14,
  },
  inputIconBtn: {
    padding: 6,
  },
  grabBtn: {
    backgroundColor: '#0284c7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
  },
  grabBtnDisabled: {
    opacity: 0.6,
  },
  grabBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  directFileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0369a126',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#38bdf866',
  },
  directFileTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#38bdf8',
  },
  directFileSubtitle: {
    fontSize: 11,
    color: '#cbd5e1',
    marginTop: 2,
  },
  directFileBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  directFileBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  platformScrollWrapper: {
    marginVertical: 2,
  },
  platformScroll: {
    flexDirection: 'row',
  },
  platformChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    marginRight: 6,
  },
  platformChipText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#450a0a',
    borderRadius: 8,
    padding: 12,
  },
  errorBannerText: {
    color: '#fca5a5',
    fontSize: 13,
    flex: 1,
  },
  mediaResolvedCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#38bdf866',
    gap: 14,
  },
  mediaTop: {
    flexDirection: 'row',
    gap: 12,
  },
  mediaThumb: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#0f172a',
  },
  mediaThumbPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaInfo: {
    flex: 1,
    gap: 4,
  },
  mediaTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  mediaUploader: {
    fontSize: 13,
    color: '#38bdf8',
  },
  mediaDuration: {
    fontSize: 11,
    color: '#94a3b8',
  },
  optionsSection: {
    gap: 8,
  },
  optionsSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionTile: {
    width: '48%',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  optionTileActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0369a133',
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  optionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e2e8f0',
    flex: 1,
  },
  optionLabelActive: {
    color: '#38bdf8',
  },
  optionSize: {
    fontSize: 10,
    color: '#94a3b8',
  },
  queueSelectSection: {
    gap: 6,
  },
  queueSelectLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  queuePillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  queuePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  queuePillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  queuePillText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  queuePillTextActive: {
    color: '#ffffff',
  },
  mediaActionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  previewBtnText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
  downloadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    borderRadius: 8,
  },
  downloadBtnDisabled: {
    opacity: 0.5,
  },
  downloadBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  collectionCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#38bdf866',
    gap: 12,
  },
  collectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  collectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  collectionSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  collectionControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  selectToggleBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  selectToggleText: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '600',
  },
  formatPills: {
    flexDirection: 'row',
    gap: 4,
  },
  fmtPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  fmtPillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  fmtPillText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#94a3b8',
  },
  fmtPillTextActive: {
    color: '#ffffff',
  },
  trackList: {
    gap: 6,
    maxHeight: 280,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0f172a',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  trackRowChecked: {
    borderColor: '#38bdf866',
    backgroundColor: '#0369a11a',
  },
  trackIndex: {
    fontSize: 11,
    color: '#64748b',
    width: 18,
  },
  trackTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  trackAuthor: {
    fontSize: 10,
    color: '#94a3b8',
  },
  trackDuration: {
    fontSize: 11,
    color: '#64748b',
  },
  batchDownloadBtn: {
    backgroundColor: '#0284c7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 6,
  },
  batchDownloadBtnDisabled: {
    opacity: 0.5,
  },
  batchDownloadBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});

