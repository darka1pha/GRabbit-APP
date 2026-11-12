import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { formatBytes, formatSpeed, formatEta } from '@grabbit/utils';
import { MobileDownloadTask } from '../services/download-manager';
import { PLATFORM_COLORS, PLATFORM_NAMES } from '../services/bridge';
import { MotionView } from './motion';

const CATEGORY_COLORS: Record<string, string> = {
  video: '#ec4899',
  music: '#8b5cf6',
  documents: '#3b82f6',
  compressed: '#f59e0b',
  programs: '#10b981',
  images: '#06b6d4',
  other: '#64748b',
};

interface MediaCardProps {
  task: MobileDownloadTask;
  queueName?: string;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onCancel?: (id: string) => void;
  onPlay?: (task: MobileDownloadTask) => void;
  onSaveToLibrary?: (id: string) => void;
  onDelete?: (id: string) => void;
  onInspectSegments?: (task: MobileDownloadTask) => void;
  onMoveQueue?: (task: MobileDownloadTask) => void;
  onVerifyChecksum?: (task: MobileDownloadTask) => void;
}

function MediaCardComponent({
  task,
  queueName,
  onPause,
  onResume,
  onCancel,
  onPlay,
  onSaveToLibrary,
  onDelete,
  onInspectSegments,
  onMoveQueue,
  onVerifyChecksum,
}: MediaCardProps) {
  const platformColor = PLATFORM_COLORS[task.platform] || '#38bdf8';
  const platformName = PLATFORM_NAMES[task.platform] || task.platform.toUpperCase();
  const categoryColor = CATEGORY_COLORS[task.category] || '#64748b';

  const isDownloading = task.status === 'downloading';
  const isPaused = task.status === 'paused';
  const isQueued = task.status === 'queued';
  const isCompleted = task.status === 'completed';
  const isError = task.status === 'error';

  const handleCopyLink = async () => {
    await Clipboard.setStringAsync(task.url);
  };

  return (
    <MotionView
      style={styles.card}
      initial={{ opacity: 0, translateY: 10, scale: 0.98 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ duration: 220 }}
    >
      {/* Top Media Info */}
      <View style={styles.topRow}>
        {task.thumbnailUrl ? (
          <Image source={{ uri: task.thumbnailUrl }} style={styles.thumbnail} />
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <Ionicons
              name={
                task.category === 'video'
                  ? 'videocam'
                  : task.category === 'music'
                  ? 'musical-note'
                  : task.category === 'images'
                  ? 'image'
                  : task.category === 'documents'
                  ? 'document-text'
                  : 'cube'
              }
              size={24}
              color="#94a3b8"
            />
          </View>
        )}

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {task.title}
          </Text>
          {task.author ? (
            <Text style={styles.uploader} numberOfLines={1}>
              {task.author}
            </Text>
          ) : (
            <Text style={styles.filenameText} numberOfLines={1}>
              {task.fileName}
            </Text>
          )}

          <View style={styles.badgesRow}>
            {/* Category Badge */}
            <View style={[styles.categoryBadge, { backgroundColor: `${categoryColor}25`, borderColor: categoryColor }]}>
              <Text style={[styles.categoryBadgeText, { color: categoryColor }]}>
                {task.category.toUpperCase()}
              </Text>
            </View>

            {/* Queue Badge */}
            {queueName && (
              <View style={styles.queueBadge}>
                <Ionicons name="layers-outline" size={10} color="#38bdf8" />
                <Text style={styles.queueBadgeText}>{queueName}</Text>
              </View>
            )}

            {/* Platform Badge */}
            <View style={[styles.platformBadge, { backgroundColor: platformColor }]}>
              <Text style={styles.platformBadgeText}>{platformName}</Text>
            </View>

            {/* Quality Badge */}
            <View style={styles.qualityBadge}>
              <Text style={styles.qualityBadgeText}>
                {task.qualityId.toUpperCase()} • {task.extension.toUpperCase()}
              </Text>
            </View>

            {task.savedToLibrary && (
              <View style={styles.savedBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#22c55e" />
                <Text style={styles.savedBadgeText}>Gallery</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Progress & Speed Section (when active, downloading, queued, or paused) */}
      {(isDownloading || isPaused || isQueued) && (
        <View style={styles.progressSection}>
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.round(task.progress * 100)}%`,
                  backgroundColor: isPaused ? '#eab308' : isQueued ? '#64748b' : '#38bdf8',
                },
              ]}
            />
          </View>

          {/* Parallel Connection Segments Mini Bar (clickable to inspect!) */}
          {task.segments && task.segments.length > 0 && (
            <TouchableOpacity
              style={styles.segmentsRow}
              onPress={() => onInspectSegments?.(task)}
              activeOpacity={0.7}
            >
              {task.segments.map((seg, idx) => {
                const segTotal = (seg.end !== null ? seg.end - seg.start : 1) || 1;
                const segPercent = Math.min(100, Math.round((seg.received / segTotal) * 100));
                const isPartDone = segPercent >= 100;
                return (
                  <View key={idx} style={styles.segmentTrack}>
                    <View
                      style={[
                        styles.segmentFill,
                        {
                          width: `${segPercent}%`,
                          backgroundColor: isPartDone ? '#22c55e' : '#38bdf8',
                        },
                      ]}
                    />
                  </View>
                );
              })}
            </TouchableOpacity>
          )}

          <View style={styles.statsRow}>
            <Text style={styles.statsText}>
              {formatBytes(task.receivedBytes)} / {formatBytes(task.totalBytes)} ({Math.round(task.progress * 100)}%)
            </Text>
            {isDownloading && task.speed > 0 && (
              <Text style={styles.statsText}>
                {formatSpeed(task.speed)} • ETA {formatEta(task.eta)}
              </Text>
            )}
            {isPaused && <Text style={[styles.statsText, { color: '#eab308' }]}>Paused</Text>}
            {isQueued && <Text style={[styles.statsText, { color: '#94a3b8' }]}>Queued</Text>}
          </View>
        </View>
      )}

      {/* Error state */}
      {isError && (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={16} color="#ef4444" />
          <Text style={styles.errorText} numberOfLines={1}>
            {task.error || 'Download failed'}
          </Text>
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.actionsRow}>
        {/* Quick Inspection Buttons */}
        <TouchableOpacity
          style={styles.iconActionBtn}
          onPress={() => onInspectSegments?.(task)}
        >
          <Ionicons name="pulse-outline" size={16} color="#38bdf8" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.iconActionBtn}
          onPress={() => onMoveQueue?.(task)}
        >
          <Ionicons name="swap-horizontal-outline" size={16} color="#94a3b8" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.iconActionBtn}
          onPress={handleCopyLink}
        >
          <Ionicons name="link-outline" size={16} color="#94a3b8" />
        </TouchableOpacity>

        {isCompleted && onVerifyChecksum && (
          <TouchableOpacity
            style={styles.iconActionBtn}
            onPress={() => onVerifyChecksum(task)}
          >
            <Ionicons name="shield-checkmark-outline" size={16} color="#94a3b8" />
          </TouchableOpacity>
        )}

        <View style={{ flex: 1 }} />

        {/* State actions */}
        {isDownloading && onPause && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onPause(task.id)}
            activeOpacity={0.7}
          >
            <Ionicons name="pause" size={15} color="#eab308" />
            <Text style={[styles.actionBtnText, { color: '#eab308' }]}>Pause</Text>
          </TouchableOpacity>
        )}

        {(isPaused || isQueued) && onResume && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onResume(task.id)}
            activeOpacity={0.7}
          >
            <Ionicons name="play" size={15} color="#38bdf8" />
            <Text style={[styles.actionBtnText, { color: '#38bdf8' }]}>Resume</Text>
          </TouchableOpacity>
        )}

        {(isDownloading || isPaused || isQueued || isError) && onCancel && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onCancel(task.id)}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={15} color="#94a3b8" />
            <Text style={styles.actionBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}

        {isCompleted && (
          <>
            {onPlay && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.primaryActionBtn]}
                onPress={() => onPlay(task)}
                activeOpacity={0.7}
              >
                <Ionicons name="play" size={15} color="#ffffff" />
                <Text style={[styles.actionBtnText, { color: '#ffffff' }]}>Play</Text>
              </TouchableOpacity>
            )}

            {!task.savedToLibrary && onSaveToLibrary && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => onSaveToLibrary(task.id)}
                activeOpacity={0.7}
              >
                <Ionicons name="download-outline" size={15} color="#38bdf8" />
                <Text style={[styles.actionBtnText, { color: '#38bdf8' }]}>Save</Text>
              </TouchableOpacity>
            )}

            {onDelete && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => onDelete(task.id)}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={15} color="#ef4444" />
                <Text style={[styles.actionBtnText, { color: '#ef4444' }]}>Delete</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </MotionView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    gap: 12,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#0f172a',
  },
  thumbnailPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f8fafc',
  },
  uploader: {
    fontSize: 12,
    color: '#94a3b8',
  },
  filenameText: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  categoryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  categoryBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  queueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#0369a126',
    borderWidth: 1,
    borderColor: '#38bdf866',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  queueBadgeText: {
    fontSize: 9,
    color: '#38bdf8',
    fontWeight: '600',
  },
  platformBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  platformBadgeText: {
    fontSize: 9,
    color: '#ffffff',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  qualityBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  qualityBadgeText: {
    fontSize: 9,
    color: '#cbd5e1',
    fontWeight: '600',
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#14532d44',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  savedBadgeText: {
    fontSize: 9,
    color: '#22c55e',
    fontWeight: '600',
  },
  progressSection: {
    gap: 6,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
  },
  segmentsRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 2,
    paddingVertical: 2,
  },
  segmentTrack: {
    flex: 1,
    height: 4,
    backgroundColor: '#090d16',
    borderRadius: 2,
    overflow: 'hidden',
  },
  segmentFill: {
    height: '100%',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statsText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#450a0a',
    padding: 8,
    borderRadius: 6,
  },
  errorText: {
    fontSize: 12,
    color: '#fca5a5',
    flex: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#33415566',
    paddingTop: 8,
  },
  iconActionBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#33415588',
  },
  primaryActionBtn: {
    backgroundColor: '#0284c7',
  },
  actionBtnText: {
    fontSize: 12,
    color: '#cbd5e1',
    fontWeight: '500',
  },
});

export const MediaCard = React.memo(MediaCardComponent);
