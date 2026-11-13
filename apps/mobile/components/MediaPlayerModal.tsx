import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Image,
  Share,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus, Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@grabbit/utils';
import { useTheme } from '../hooks/useTheme';
import { useI18n } from '../hooks/useI18n';
import { ThemeColors } from '../constants/theme';
import { hapticLight } from '../services/haptics';

export interface MediaPlayerSource {
  taskId?: string;
  uri: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  isVideo: boolean;
  canSaveToLibrary?: boolean;
}

interface MediaPlayerModalProps {
  visible: boolean;
  source: MediaPlayerSource | null;
  onClose: () => void;
  onSaveToLibrary?: () => void;
}

const { width } = Dimensions.get('window');

export function MediaPlayerModal({
  visible,
  source,
  onClose,
  onSaveToLibrary,
}: MediaPlayerModalProps) {
  const { colors } = useTheme();
  const { t, isRtl } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [isPlaying, setIsPlaying] = useState(true);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [trackWidth, setTrackWidth] = useState(width - 40);

  const videoRef = useRef<Video>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    setPlaybackError(null);
    setPositionMs(0);
    setDurationMs(0);
    setIsLoading(Boolean(visible && source));
  }, [visible, source]);

  // Audio playback setup when source is audio
  useEffect(() => {
    let isMounted = true;

    async function setupAudio() {
      if (!visible || !source || source.isVideo) return;

      try {
        setIsLoading(true);
        setPlaybackError(null);
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });

        const { sound } = await Audio.Sound.createAsync(
          { uri: source.uri },
          { shouldPlay: true },
          (status: AVPlaybackStatus) => {
            if (!isMounted) return;
            if (status.isLoaded) {
              setIsLoading(false);
              setIsPlaying(status.isPlaying);
              setPositionMs(status.positionMillis);
              setDurationMs(status.durationMillis || 0);
            }
          }
        );

        soundRef.current = sound;
      } catch (err: any) {
        console.warn('Audio setup error:', err);
        if (isMounted) {
          setIsLoading(false);
          setPlaybackError(err?.message || t('err.UNKNOWN'));
        }
      }
    }

    setupAudio();

    return () => {
      isMounted = false;
      if (soundRef.current) {
        void soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    };
  }, [visible, source, t]);

  const handleClose = async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    if (videoRef.current) {
      await videoRef.current.stopAsync();
    }
    onClose();
  };

  const togglePlayPause = async () => {
    void hapticLight();
    if (source?.isVideo && videoRef.current) {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
      } else {
        await videoRef.current.playAsync();
      }
      setIsPlaying(!isPlaying);
    } else if (soundRef.current) {
      if (isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        await soundRef.current.playAsync();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const seekToMs = async (targetMs: number) => {
    const clamped = Math.max(0, Math.min(durationMs, Math.round(targetMs)));
    if (source?.isVideo && videoRef.current) {
      await videoRef.current.setPositionAsync(clamped);
    } else if (soundRef.current) {
      await soundRef.current.setPositionAsync(clamped);
    }
    setPositionMs(clamped);
  };

  const skipSeconds = async (seconds: number) => {
    void hapticLight();
    await seekToMs(positionMs + seconds * 1000);
  };

  const handleScrubPress = (event: GestureResponderEvent) => {
    if (durationMs <= 0 || trackWidth <= 0) return;
    const x = Math.max(0, Math.min(trackWidth, event.nativeEvent.locationX));
    const fraction = isRtl ? 1 - x / trackWidth : x / trackWidth;
    void seekToMs(fraction * durationMs);
  };

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const handleShare = async () => {
    if (!source) return;
    try {
      await Share.share({
        title: source.title,
        message: `${source.title}\n${source.uri}`,
        url: source.uri,
      });
    } catch {
      // ignore user cancellation
    }
  };

  if (!source) return null;

  const progressFraction = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Top App Bar */}
        <View style={[styles.topBar, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.iconBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.topInfo}>
            <Text style={styles.topTitle} numberOfLines={1}>
              {source.title}
            </Text>
            {source.author ? (
              <Text style={styles.topSubtitle} numberOfLines={1}>
                {source.author}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <TouchableOpacity
              onPress={handleShare}
              style={styles.iconBtn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Share"
            >
              <Ionicons name="share-outline" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
            {source.canSaveToLibrary && onSaveToLibrary ? (
              <TouchableOpacity
                onPress={onSaveToLibrary}
                style={styles.iconBtn}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('common.save')}
              >
                <Ionicons name="download-outline" size={24} color={colors.accent} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Media Content Area */}
        <View style={styles.mediaArea}>
          {source.isVideo ? (
            <Video
              ref={videoRef}
              style={styles.videoPlayer}
              source={{ uri: source.uri }}
              shouldPlay={visible}
              useNativeControls={false}
              resizeMode={ResizeMode.CONTAIN}
              isLooping
              onPlaybackStatusUpdate={(status) => {
                if (status.isLoaded) {
                  setIsLoading(false);
                  setPlaybackError(null);
                  setIsPlaying(status.isPlaying);
                  setPositionMs(status.positionMillis);
                  setDurationMs(status.durationMillis || 0);
                } else if ('error' in status && status.error) {
                  setIsLoading(false);
                  setPlaybackError(status.error);
                }
              }}
              onError={(err) => {
                setIsLoading(false);
                setPlaybackError(typeof err === 'string' ? err : t('err.UNKNOWN'));
              }}
            />
          ) : (
            <View style={styles.audioArtworkContainer}>
              {source.thumbnailUrl ? (
                <Image source={{ uri: source.thumbnailUrl }} style={styles.albumArt} />
              ) : (
                <View style={styles.albumArtPlaceholder}>
                  <Ionicons name="musical-notes" size={80} color={colors.accent} />
                </View>
              )}
              <Text style={styles.audioTitle} numberOfLines={2}>
                {source.title}
              </Text>
              {source.author ? (
                <Text style={styles.audioAuthor} numberOfLines={1}>
                  {source.author}
                </Text>
              ) : null}
            </View>
          )}

          {isLoading && !playbackError && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          )}
          {playbackError && (
            <View style={styles.loadingOverlay}>
              <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
              <Text style={styles.errorText}>{playbackError}</Text>
            </View>
          )}
        </View>

        {/* Controls & Interactive Seekable Scrubber */}
        <View style={styles.controlsSection}>
          <View style={styles.progressContainer}>
            <Pressable
              style={styles.scrubberHitArea}
              onLayout={handleTrackLayout}
              onPress={handleScrubPress}
            >
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.round(progressFraction * 100)}%` },
                  ]}
                />
              </View>
            </Pressable>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatDuration(positionMs / 1000)}</Text>
              <Text style={styles.timeText}>{formatDuration(durationMs / 1000)}</Text>
            </View>
          </View>

          <View style={styles.playbackControls}>
            <TouchableOpacity
              onPress={() => skipSeconds(-10)}
              style={styles.skipBtn}
              activeOpacity={0.7}
            >
              <Ionicons
                name="refresh"
                size={24}
                color={colors.textPrimary}
                style={{ transform: [{ scaleX: -1 }] }}
              />
              <Text style={styles.skipLabel}>-10s</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={togglePlayPause}
              style={styles.playPauseBtn}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={34}
                color="#ffffff"
                style={!isPlaying ? { marginLeft: 3 } : undefined}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => skipSeconds(10)}
              style={styles.skipBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={24} color={colors.textPrimary} />
              <Text style={styles.skipLabel}>+10s</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    iconBtn: {
      padding: 8,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topInfo: {
      flex: 1,
      marginHorizontal: 12,
    },
    topTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
    topSubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    mediaArea: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      position: 'relative',
      backgroundColor: colors.background,
    },
    videoPlayer: {
      width: '100%',
      height: '100%',
      backgroundColor: '#000000',
    },
    audioArtworkContainer: {
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    albumArt: {
      width: width * 0.65,
      height: width * 0.65,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: colors.accent,
      marginBottom: 24,
    },
    albumArtPlaceholder: {
      width: width * 0.65,
      height: width * 0.65,
      borderRadius: 16,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 24,
    },
    audioTitle: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '700',
      textAlign: 'center',
    },
    audioAuthor: {
      color: colors.textSecondary,
      fontSize: 15,
      marginTop: 6,
      textAlign: 'center',
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorText: {
      color: colors.error,
      marginTop: 10,
      paddingHorizontal: 24,
      textAlign: 'center',
      fontSize: 13,
    },
    controlsSection: {
      backgroundColor: colors.surface,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 40,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    progressContainer: {
      marginBottom: 16,
    },
    scrubberHitArea: {
      paddingVertical: 10,
    },
    progressBarTrack: {
      height: 6,
      backgroundColor: colors.border,
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: colors.accent,
    },
    timeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    timeText: {
      color: colors.textSecondary,
      fontSize: 12,
    },
    playbackControls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 36,
    },
    playPauseBtn: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: colors.accent,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
    },
    skipBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
    },
    skipLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 2,
    },
  });
