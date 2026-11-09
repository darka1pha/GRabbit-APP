import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MediaItem, MediaOption, PlatformMetadata } from '@grabbit/types';
import { formatBytes } from '@grabbit/utils';
import { PLATFORM_COLORS, PLATFORM_NAMES } from '../services/bridge';

interface OptionSelectorModalProps {
  visible: boolean;
  metadata: PlatformMetadata | null;
  onClose: () => void;
  onSelectOption: (item: MediaItem, option: MediaOption) => void;
  onPreview: (item: MediaItem, option: MediaOption) => void;
}

export function OptionSelectorModal({
  visible,
  metadata,
  onClose,
  onSelectOption,
  onPreview,
}: OptionSelectorModalProps) {
  const [selectedFormat, setSelectedFormat] = useState<'audio' | 'video'>('video');
  const [selectedQualityId, setSelectedQualityId] = useState<string>('');

  const currentItem = metadata?.items?.[0];

  const audioOpts = useMemo(() => {
    return currentItem?.availableOptions.filter((o) => o.format === 'audio') || [];
  }, [currentItem]);

  const videoOpts = useMemo(() => {
    return currentItem?.availableOptions.filter((o) => o.format === 'video') || [];
  }, [currentItem]);

  const currentOptions = selectedFormat === 'audio' ? audioOpts : videoOpts;

  // Set default selection if none chosen
  React.useEffect(() => {
    if (visible && currentItem) {
      if (videoOpts.length > 0) {
        setSelectedFormat('video');
        setSelectedQualityId(videoOpts[0]?.qualityId || '');
      } else if (audioOpts.length > 0) {
        setSelectedFormat('audio');
        setSelectedQualityId(audioOpts[0]?.qualityId || '');
      }
    }
  }, [visible, currentItem, audioOpts, videoOpts]);

  if (!metadata || !currentItem) return null;

  const platformColor = PLATFORM_COLORS[metadata.platform] || '#38bdf8';
  const platformName = PLATFORM_NAMES[metadata.platform] || metadata.platform.toUpperCase();

  const activeOption = currentOptions.find((o) => o.qualityId === selectedQualityId) || currentOptions[0];

  const handleDownload = () => {
    if (activeOption) {
      onSelectOption(currentItem, activeOption);
      onClose();
    }
  };

  const handlePreview = () => {
    if (activeOption) {
      onPreview(currentItem, activeOption);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderTitleRow}>
              <View style={[styles.platformBadge, { backgroundColor: platformColor }]}>
                <Text style={styles.platformBadgeText}>{platformName}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <View style={styles.mediaSummary}>
              {currentItem.thumbnailUrl ? (
                <Image source={{ uri: currentItem.thumbnailUrl }} style={styles.thumbnail} />
              ) : (
                <View style={styles.thumbnailPlaceholder}>
                  <Ionicons name="musical-notes" size={32} color="#94a3b8" />
                </View>
              )}
              <View style={styles.mediaInfo}>
                <Text style={styles.title} numberOfLines={2}>
                  {currentItem.title}
                </Text>
                {currentItem.uploader ? (
                  <Text style={styles.uploader} numberOfLines={1}>
                    {currentItem.uploader}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* Format Tabs */}
          <View style={styles.tabsRow}>
            {videoOpts.length > 0 && (
              <TouchableOpacity
                style={[styles.tab, selectedFormat === 'video' && styles.tabActive]}
                onPress={() => {
                  setSelectedFormat('video');
                  setSelectedQualityId(videoOpts[0]?.qualityId || '');
                }}
              >
                <Ionicons
                  name="videocam"
                  size={18}
                  color={selectedFormat === 'video' ? '#38bdf8' : '#94a3b8'}
                />
                <Text
                  style={[styles.tabText, selectedFormat === 'video' && styles.tabTextActive]}
                >
                  Video ({videoOpts.length})
                </Text>
              </TouchableOpacity>
            )}

            {audioOpts.length > 0 && (
              <TouchableOpacity
                style={[styles.tab, selectedFormat === 'audio' && styles.tabActive]}
                onPress={() => {
                  setSelectedFormat('audio');
                  setSelectedQualityId(audioOpts[0]?.qualityId || '');
                }}
              >
                <Ionicons
                  name="musical-notes"
                  size={18}
                  color={selectedFormat === 'audio' ? '#38bdf8' : '#94a3b8'}
                />
                <Text
                  style={[styles.tabText, selectedFormat === 'audio' && styles.tabTextActive]}
                >
                  Audio ({audioOpts.length})
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Quality Options List */}
          <ScrollView style={styles.optionsList} contentContainerStyle={styles.optionsListContent}>
            {currentOptions.map((opt) => {
              const isSelected = opt.qualityId === selectedQualityId;
              return (
                <TouchableOpacity
                  key={opt.qualityId}
                  style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                  onPress={() => setSelectedQualityId(opt.qualityId)}
                  activeOpacity={0.7}
                >
                  <View style={styles.optionLeft}>
                    <Ionicons
                      name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={isSelected ? '#38bdf8' : '#64748b'}
                    />
                    <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                      {opt.label}
                    </Text>
                    {opt.isOriginalQuality && (
                      <View style={styles.originalBadge}>
                        <Text style={styles.originalBadgeText}>Original</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.optionRight}>
                    <Text style={styles.optionSize}>
                      {opt.estimatedSizeBytes ? formatBytes(opt.estimatedSizeBytes) : opt.extension.toUpperCase()}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Footer Actions */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.previewBtn}
              onPress={handlePreview}
              activeOpacity={0.8}
            >
              <Ionicons name="play" size={18} color="#38bdf8" />
              <Text style={styles.previewBtnText}>Preview</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.downloadBtn}
              onPress={handleDownload}
              activeOpacity={0.8}
            >
              <Ionicons name="download" size={18} color="#ffffff" />
              <Text style={styles.downloadBtnText}>Grab & Download</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '82%',
    paddingBottom: 24,
  },
  sheetHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  sheetHeaderTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  platformBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  closeBtn: {
    padding: 4,
  },
  mediaSummary: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  thumbnailPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaInfo: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
  },
  uploader: {
    color: '#94a3b8',
    fontSize: 13,
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingHorizontal: 16,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    marginRight: 24,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#38bdf8',
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#38bdf8',
  },
  optionsList: {
    maxHeight: 220,
  },
  optionsListContent: {
    padding: 16,
    gap: 8,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  optionRowSelected: {
    borderColor: '#38bdf8',
    backgroundColor: '#0369a122',
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  optionLabel: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '500',
  },
  optionLabelSelected: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  originalBadge: {
    backgroundColor: '#0284c733',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  originalBadgeText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '600',
  },
  optionRight: {},
  optionSize: {
    color: '#94a3b8',
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38bdf8',
    backgroundColor: '#0284c71a',
  },
  previewBtnText: {
    color: '#38bdf8',
    fontWeight: '600',
    fontSize: 14,
  },
  downloadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 8,
  },
  downloadBtnText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});

