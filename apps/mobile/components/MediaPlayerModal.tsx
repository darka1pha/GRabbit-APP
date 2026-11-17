import { useState, useEffect, useMemo } from 'react';
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
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
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
/** An audio file that has not loaded by then is reported as unplayable. */
const AUDIO_LOAD_TIMEOUT_MS = 15_000;

export function MediaPlayerModal({
  visible,
  source,
  onClose,
  onSaveToLibrary,
}: MediaPlayerModalProps) {
  const { colors } = useTheme();
  const { t, isRtl } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [trackWidth, setTrackWidth] = useState(width - 40);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // One player per kind; the other gets no source. Both hooks release their player on change.
  const isVideo = Boolean(source?.isVideo);
  const videoSource = visible && source && isVideo ? { uri: source.uri } : null;
  const audioSource = visible && source && !isVideo ? { uri: source.uri } : null;

  // ---------------------------------------------------------------- video (expo-video)
  const videoPlayer = useVideoPlayer(videoSource, (player) => {
    player.loop = true;
    player.timeUpdateEventInterval = 0.5;
    player.play();
  });
  const [video, setVideo] = useState({ playing: false, loading: true, position: 0, duration: 0 });

  useEventListener(videoPlayer, 'statusChange', ({ status, error }) => {
    setVideo((v) => ({ ...v, loading: status === 'loading' || status === 'idle' }));
    if (status === 'error') setPlaybackError(error?.message || t('err.UNKNOWN'));
    else if (status === 'readyToPlay') setPlaybackError(null);
  });
  useEventListener(videoPlayer, 'playingChange', ({ isPlaying }) => setVideo((v) => ({ ...v, playing: isPlaying })));
  useEventListener(videoPlayer, 'sourceLoad', ({ duration }) => setVideo((v) => ({ ...v, duration, loading: false })));
  useEventListener(videoPlayer, 'timeUpdate', ({ currentTime }) =>
    setVideo((v) => ({ ...v, position: currentTime, duration: videoPlayer.duration || v.duration }))
  );

  // ---------------------------------------------------------------- audio (expo-audio)
  const audioPlayer = useAudioPlayer(audioSource, { updateInterval: 500 });
  const audioStatus = useAudioPlayerStatus(audioPlayer);

  useEffect(() => {
    if (!audioSource) return;
    let cancelled = false;
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true })
      .catch((err) => console.warn('Audio mode error:', err))
      .finally(() => {
        if (!cancelled) audioPlayer.play();
      });
    return () => {
      cancelled = true;
    };
    // The player is recreated when the source changes, so it alone decides when to start
  }, [audioPlayer]); // eslint-disable-line react-hooks/exhaustive-deps

  // expo-audio reports no load error, so a file that never loads is called unplayable
  useEffect(() => {
    if (!audioSource || audioStatus.isLoaded) return;
    const timer = setTimeout(() => setPlaybackError(t('err.UNKNOWN')), AUDIO_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [audioPlayer, audioStatus.isLoaded, t]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPlaybackError(null);
    setVideo({ playing: false, loading: true, position: 0, duration: 0 });
  }, [visible, source]);

  // ---------------------------------------------------------------- shared view state
  const isPlaying = isVideo ? video.playing : audioStatus.playing;
  const isLoading = Boolean(visible && source) && (isVideo ? video.loading : !audioStatus.isLoaded);
  const positionMs = Math.round((isVideo ? video.position : audioStatus.currentTime) * 1000);
  const durationMs = Math.round((isVideo ? video.duration : audioStatus.duration) * 1000) || 0;

  const handleClose = () => {
    if (isVideo) videoPlayer.pause();
    else audioPlayer.pause();
    onClose();
  };

  const togglePlayPause = () => {
    void hapticLight();
    const player = isVideo ? videoPlayer : audioPlayer;
    if (isPlaying) player.pause();
    else player.play();
  };

  const seekToMs = async (targetMs: number) => {
    const seconds = Math.max(0, Math.min(durationMs, Math.round(targetMs))) / 1000;
    if (isVideo) {
      videoPlayer.currentTime = seconds;
      setVideo((v) => ({ ...v, position: seconds }));
    } else {
      await audioPlayer.seekTo(seconds);
    }
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
            <VideoView
              player={videoPlayer}
              style={styles.videoPlayer}
              nativeControls={false}
              contentFit="contain"
              allowsPictureInPicture
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
      ...StyleSheet.absoluteFill,
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
