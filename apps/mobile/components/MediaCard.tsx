import React, { useMemo, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { formatEta } from '@grabbit/utils';
import { MobileDownloadTask } from '../services/download-manager';
import { PLATFORM_COLORS, PLATFORM_NAMES } from '../services/bridge';
import { MotionView } from './motion';
import { useTheme } from '../hooks/useTheme';
import { useI18n } from '../hooks/useI18n';
import { ThemeColors } from '../constants/theme';
import { hapticLight, hapticSuccess } from '../services/haptics';

const CATEGORY_COLORS: Record<string, string> = {
  video: '#ec4899',
  music: '#8b5cf6',
  documents: '#3b82f6',
  compressed: '#f59e0b',
  programs: '#10b981',
  images: '#06b6d4',
  other: '#64748b',
};

const SWIPE_THRESHOLD = 72;

interface MediaCardProps {
  task: MobileDownloadTask;
  queueName?: string;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onLongPress?: (id: string) => void;
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
  selectionMode,
  isSelected,
  onToggleSelect,
  onLongPress,
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
  const { colors } = useTheme();
  const { t, isRtl, textDirStyle, formatBytes, formatSpeed } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const platformColor = PLATFORM_COLORS[task.platform] || colors.accent;
  const platformName = PLATFORM_NAMES[task.platform] || task.platform.toUpperCase();
  const categoryColor = CATEGORY_COLORS[task.category] || '#64748b';

  const isDownloading = task.status === 'downloading';
  const isPaused = task.status === 'paused';
  const isQueued = task.status === 'queued';
  const isCompleted = task.status === 'completed';
  const isError = task.status === 'error';

  const translateX = useRef(new Animated.Value(0)).current;

  const primarySwipeAction = useMemo(() => {
    if (isDownloading && onPause) {
      return {
        label: t('mobile.swipePause'),
        icon: 'pause' as const,
        color: colors.warning,
        run: () => onPause(task.id),
      };
    }
    if ((isPaused || isQueued || isError) && onResume) {
      return {
        label: t('mobile.swipeResume'),
        icon: 'play' as const,
        color: colors.accent,
        run: () => onResume(task.id),
      };
    }
    if (isCompleted && onPlay) {
      return {
        label: t('dl.open'),
        icon: 'play' as const,
        color: colors.success,
        run: () => onPlay(task),
      };
    }
    return null;
  }, [isDownloading, isPaused, isQueued, isError, isCompleted, onPause, onResume, onPlay, task, t, colors]);

  const secondarySwipeAction = useMemo(() => {
    if (isCompleted && onDelete) {
      return {
        label: t('mobile.swipeDelete'),
        icon: 'trash-outline' as const,
        color: colors.error,
        run: () => onDelete(task.id),
      };
    }
    if (!isCompleted && onCancel) {
      return {
        label: t('common.cancel'),
        icon: 'close-circle-outline' as const,
        color: colors.error,
        run: () => onCancel(task.id),
      };
    }
    return null;
  }, [isCompleted, onDelete, onCancel, task.id, t, colors]);

  const swipeRefs = useRef({
    selectionMode,
    primarySwipeAction,
    secondarySwipeAction,
  });
  swipeRefs.current = { selectionMode, primarySwipeAction, secondarySwipeAction };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gestureState) => {
          if (swipeRefs.current.selectionMode) return false;
          const absX = Math.abs(gestureState.dx);
          const absY = Math.abs(gestureState.dy);
          return absX > 14 && absX > absY * 1.4;
        },
        onPanResponderMove: (_evt, gestureState) => {
          const clamped = Math.max(-108, Math.min(108, gestureState.dx));
          translateX.setValue(clamped);
        },
        onPanResponderRelease: (_evt, gestureState) => {
          const { primarySwipeAction: primary, secondarySwipeAction: secondary } = swipeRefs.current;
          if (gestureState.dx >= SWIPE_THRESHOLD && primary) {
            void hapticSuccess();
            primary.run();
          } else if (gestureState.dx <= -SWIPE_THRESHOLD && secondary) {
            void hapticLight();
            secondary.run();
          }
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
      }),
    [translateX]
  );

  const handleCopyLink = async () => {
    void hapticLight();
    await Clipboard.setStringAsync(task.url);
  };

  return (
    <MotionView
      style={styles.swipeContainer}
      initial={{ opacity: 0, translateY: 10, scale: 0.98 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ duration: 220 }}
    >
      {/* Revealed Swipe Action Rail behind card */}
      <View style={styles.swipeRail} pointerEvents="none">
        {primarySwipeAction ? (
          <View style={[styles.swipeHint, { backgroundColor: primarySwipeAction.color }]}>
            <Ionicons name={primarySwipeAction.icon} size={18} color="#ffffff" />
            <Text style={styles.swipeHintText}>{primarySwipeAction.label}</Text>
          </View>
        ) : (
          <View />
        )}
        {secondarySwipeAction ? (
          <View style={[styles.swipeHint, { backgroundColor: secondarySwipeAction.color }]}>
            <Ionicons name={secondarySwipeAction.icon} size={18} color="#ffffff" />
            <Text style={styles.swipeHintText}>{secondarySwipeAction.label}</Text>
          </View>
        ) : (
          <View />
        )}
      </View>

      <Animated.View
        style={[
          styles.card,
          isSelected && styles.cardSelected,
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          activeOpacity={selectionMode ? 0.7 : 0.95}
          onPress={() => {
            if (selectionMode && onToggleSelect) {
              onToggleSelect(task.id);
            }
          }}
          onLongPress={() => {
            if (onLongPress) {
              onLongPress(task.id);
            }
          }}
          accessibilityRole={selectionMode ? 'checkbox' : 'none'}
          accessibilityState={selectionMode ? { checked: isSelected } : undefined}
          accessibilityLabel={`${task.title || task.fileName}, ${task.status}`}
        >
          {/* Top Media Info */}
          <View style={[styles.topRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            {selectionMode && (
              <View style={styles.selectionBox}>
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={isSelected ? colors.accent : colors.textMuted}
                />
              </View>
            )}

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
                  color={colors.textSecondary}
                />
              </View>
            )}

            <View style={[styles.info, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}>
              <Text style={[styles.title, textDirStyle]} numberOfLines={1}>
                {task.title}
              </Text>
              {task.author ? (
                <Text style={[styles.uploader, textDirStyle]} numberOfLines={1}>
                  {task.author}
                </Text>
              ) : (
                <Text style={[styles.filenameText, textDirStyle]} numberOfLines={1}>
                  {task.fileName}
                </Text>
              )}

              <View style={[styles.badgesRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <View
                  style={[
                    styles.categoryBadge,
                    { backgroundColor: `${categoryColor}25`, borderColor: categoryColor },
                  ]}
                >
                  <Text style={[styles.categoryBadgeText, { color: categoryColor }]}>
                    {task.category.toUpperCase()}
                  </Text>
                </View>

                {queueName && (
                  <View style={styles.queueBadge}>
                    <Ionicons name="layers-outline" size={10} color={colors.accent} />
                    <Text style={styles.queueBadgeText}>{queueName}</Text>
                  </View>
                )}

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
                    <Ionicons name="checkmark-circle" size={12} color={colors.success} />
                    <Text style={styles.savedBadgeText}>{t('dl.savedTo')}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Progress & Speed Section */}
          {(isDownloading || isPaused || isQueued) && (
            <View style={styles.progressSection}>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.round(task.progress * 100)}%`,
                      backgroundColor: isPaused
                        ? colors.warning
                        : isQueued
                        ? colors.textMuted
                        : colors.accent,
                    },
                  ]}
                />
              </View>

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
                              backgroundColor: isPartDone ? colors.success : colors.accent,
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
                </TouchableOpacity>
              )}

              <View style={[styles.statsRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <Text style={styles.statsText}>
                  {task.totalBytes > 0
                    ? `${formatBytes(task.receivedBytes)} / ${formatBytes(task.totalBytes)} (${Math.round(task.progress * 100)}%)`
                    : formatBytes(task.receivedBytes)}
                </Text>
                {isDownloading && task.speed > 0 && (
                  <Text style={styles.statsText}>
                    {formatSpeed(task.speed)} • {formatEta(task.eta)}
                  </Text>
                )}
                {isPaused && (
                  <Text style={[styles.statsText, { color: colors.warning }]}>
                    {t('status.paused')}
                  </Text>
                )}
                {isQueued && (
                  <Text style={[styles.statsText, { color: colors.textMuted }]}>
                    {t('status.queued')}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Error state */}
          {isError && (
            <View style={[styles.errorContainer, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={[styles.errorText, textDirStyle]} numberOfLines={1}>
                {task.error || t('err.DOWNLOAD_FAILED')}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Action Buttons */}
        <View style={[styles.actionsRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity
            style={styles.iconActionBtn}
            onPress={() => onInspectSegments?.(task)}
            accessibilityLabel={t('dl.inspectSegments')}
          >
            <Ionicons name="pulse-outline" size={16} color={colors.accent} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconActionBtn}
            onPress={() => onMoveQueue?.(task)}
            accessibilityLabel={t('queue.moveTo')}
          >
            <Ionicons name="swap-horizontal-outline" size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconActionBtn}
            onPress={handleCopyLink}
            accessibilityLabel={t('dl.copyLink')}
          >
            <Ionicons name="link-outline" size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          {isCompleted && onVerifyChecksum && (
            <TouchableOpacity
              style={styles.iconActionBtn}
              onPress={() => onVerifyChecksum(task)}
              accessibilityLabel={t('dl.verify')}
            >
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}

          <View style={{ flex: 1 }} />

          {isDownloading && onPause && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onPause(task.id)}
              activeOpacity={0.7}
            >
              <Ionicons name="pause" size={15} color={colors.warning} />
              <Text style={[styles.actionBtnText, { color: colors.warning }]}>
                {t('dl.pause')}
              </Text>
            </TouchableOpacity>
          )}

          {(isPaused || isQueued || isError) && onResume && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onResume(task.id)}
              activeOpacity={0.7}
            >
              <Ionicons name="play" size={15} color={colors.accent} />
              <Text style={[styles.actionBtnText, { color: colors.accent }]}>
                {isError ? t('dl.retry') : t('dl.resume')}
              </Text>
            </TouchableOpacity>
          )}

          {(isDownloading || isPaused || isQueued || isError) && onCancel && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onCancel(task.id)}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={15} color={colors.textSecondary} />
              <Text style={styles.actionBtnText}>{t('common.cancel')}</Text>
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
                  <Text style={[styles.actionBtnText, { color: '#ffffff' }]}>
                    {t('dl.open')}
                  </Text>
                </TouchableOpacity>
              )}

              {!task.savedToLibrary && onSaveToLibrary && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onSaveToLibrary(task.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="download-outline" size={15} color={colors.accent} />
                  <Text style={[styles.actionBtnText, { color: colors.accent }]}>
                    {t('common.save')}
                  </Text>
                </TouchableOpacity>
              )}

              {onDelete && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onDelete(task.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={15} color={colors.error} />
                  <Text style={[styles.actionBtnText, { color: colors.error }]}>
                    {t('dl.remove')}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </Animated.View>
    </MotionView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    swipeContainer: {
      position: 'relative',
      borderRadius: 12,
      overflow: 'hidden',
    },
    swipeRail: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 14,
      backgroundColor: colors.surfaceSubtle,
      borderRadius: 12,
    },
    swipeHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
    },
    swipeHintText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '700',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
    },
    cardSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.surfaceSubtle,
    },
    selectionBox: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    topRow: {
      gap: 12,
    },
    thumbnail: {
      width: 56,
      height: 56,
      borderRadius: 8,
      backgroundColor: colors.background,
    },
    thumbnailPlaceholder: {
      width: 56,
      height: 56,
      borderRadius: 8,
      backgroundColor: colors.background,
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
      color: colors.textPrimary,
    },
    uploader: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    filenameText: {
      fontSize: 11,
      color: colors.textMuted,
      fontFamily: 'monospace',
    },
    badgesRow: {
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
      backgroundColor: colors.accentSubtle,
      borderWidth: 1,
      borderColor: colors.accent,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
    },
    queueBadgeText: {
      fontSize: 9,
      color: colors.accent,
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
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    qualityBadgeText: {
      fontSize: 9,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    savedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.successSubtle,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    savedBadgeText: {
      fontSize: 9,
      color: colors.success,
      fontWeight: '600',
    },
    progressSection: {
      gap: 6,
      marginTop: 8,
    },
    progressBarTrack: {
      height: 6,
      backgroundColor: colors.border,
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
      backgroundColor: colors.background,
      borderRadius: 2,
      overflow: 'hidden',
    },
    segmentFill: {
      height: '100%',
    },
    statsRow: {
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    statsText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    errorContainer: {
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.errorSubtle,
      padding: 8,
      borderRadius: 6,
      marginTop: 6,
    },
    errorText: {
      fontSize: 12,
      color: colors.error,
      flex: 1,
    },
    actionsRow: {
      alignItems: 'center',
      gap: 6,
      borderTopWidth: 1,
      borderTopColor: colors.borderSubtle,
      paddingTop: 8,
    },
    iconActionBtn: {
      padding: 6,
      borderRadius: 6,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: colors.surfaceSubtle,
    },
    primaryActionBtn: {
      backgroundColor: colors.accent,
    },
    actionBtnText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '500',
    },
  });

export const MediaCard = React.memo(MediaCardComponent);
