import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatBytes, formatSpeed, formatEta } from '@grabbit/utils';
import { MobileDownloadTask } from '../services/download-manager';
import { PLATFORM_COLORS, PLATFORM_NAMES } from '../services/bridge';

interface MediaCardProps {
  task: MobileDownloadTask;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onCancel?: (id: string) => void;
  onPlay?: (task: MobileDownloadTask) => void;
  onSaveToLibrary?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function MediaCard({
  task,
  onPause,
  onResume,
  onCancel,
  onPlay,
  onSaveToLibrary,
  onDelete,
}: MediaCardProps) {
  const platformColor = PLATFORM_COLORS[task.platform] || '#38bdf8';
  const platformName = PLATFORM_NAMES[task.platform] || task.platform.toUpperCase();

  const isDownloading = task.status === 'downloading';
  const isPaused = task.status === 'paused';
  const isCompleted = task.status === 'completed';
  const isError = task.status === 'error';

  return (
    <View style={styles.card}>
      {/* Top Media Info */}
      <View style={styles.topRow}>
        {task.thumbnailUrl ? (
          <Image source={{ uri: task.thumbnailUrl }} style={styles.thumbnail} />
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <Ionicons
              name={task.format === 'video' ? 'videocam' : 'musical-note'}
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
          ) : null}

          <View style={styles.badgesRow}>
            <View style={[styles.platformBadge, { backgroundColor: platformColor }]}>
              <Text style={styles.platformBadgeText}>{platformName}</Text>
            </View>
            <View style={styles.qualityBadge}>
              <Text style={styles.qualityBadgeText}>
                {task.qualityId.toUpperCase()} • {task.extension.toUpperCase()}
              </Text>
            </View>
            {task.savedToLibrary && (
              <View style={styles.savedBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#22c55e" />
                <Text style={styles.savedBadgeText}>Saved to Gallery</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Progress & Speed Section (when active or downloading) */}
      {(isDownloading || isPaused) && (
        <View style={styles.progressSection}>
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.round(task.progress * 100)}%`,
                  backgroundColor: isPaused ? '#eab308' : '#38bdf8',
                },
              ]}
            />
          </View>

          {/* Parallel Connection Segments Bar */}
          {task.segments && task.segments.length > 0 && (
            <View style={styles.segmentsRow}>
              {task.segments.map((seg, idx) => {
                const segTotal = (seg.end !== null ? seg.end - seg.start : 1) || 1;
                const segPercent = Math.min(100, Math.round((seg.received / segTotal) * 100));
                return (
                  <View key={idx} style={styles.segmentTrack}>
                    <View style={[styles.segmentFill, { width: `${segPercent}%` }]} />
                  </View>
                );
              })}
            </View>
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
        {isDownloading && onPause && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onPause(task.id)}
            activeOpacity={0.7}
          >
            <Ionicons name="pause" size={16} color="#eab308" />
            <Text style={[styles.actionBtnText, { color: '#eab308' }]}>Pause</Text>
          </TouchableOpacity>
        )}

        {isPaused && onResume && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onResume(task.id)}
            activeOpacity={0.7}
          >
            <Ionicons name="play" size={16} color="#38bdf8" />
            <Text style={[styles.actionBtnText, { color: '#38bdf8' }]}>Resume</Text>
          </TouchableOpacity>
        )}

        {(isDownloading || isPaused || isError) && onCancel && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onCancel(task.id)}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={16} color="#94a3b8" />
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
                <Ionicons name="play" size={16} color="#ffffff" />
                <Text style={[styles.actionBtnText, { color: '#ffffff' }]}>Play</Text>
              </TouchableOpacity>
            )}

            {!task.savedToLibrary && onSaveToLibrary && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => onSaveToLibrary(task.id)}
                activeOpacity={0.7}
              >
                <Ionicons name="download-outline" size={16} color="#38bdf8" />
                <Text style={[styles.actionBtnText, { color: '#38bdf8' }]}>Save to Gallery</Text>
              </TouchableOpacity>
            )}

            {onDelete && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => onDelete(task.id)}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={16} color="#ef4444" />
                <Text style={[styles.actionBtnText, { color: '#ef4444' }]}>Delete</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
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
    fontSize: 13,
    color: '#94a3b8',
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  platformBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  platformBadgeText: {
    fontSize: 10,
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
    fontSize: 10,
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
    fontSize: 10,
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
  },
  segmentTrack: {
    flex: 1,
    height: 3,
    backgroundColor: '#334155',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  segmentFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
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
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#33415566',
    paddingTop: 8,
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
