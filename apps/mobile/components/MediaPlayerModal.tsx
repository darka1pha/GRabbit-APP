import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Image,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@grabbit/utils';

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
  const [isPlaying, setIsPlaying] = useState(true);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

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
          setPlaybackError(err?.message || 'Failed to load audio stream');
        }
      }
    }

    setupAudio();

    return () => {
      isMounted = false;
      if (soundRef.current) {
        soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    };
  }, [visible, source]);

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

  const skipSeconds = async (seconds: number) => {
    const targetMs = Math.max(0, Math.min(durationMs, positionMs + seconds * 1000));
    if (source?.isVideo && videoRef.current) {
      await videoRef.current.setPositionAsync(targetMs);
    } else if (soundRef.current) {
      await soundRef.current.setPositionAsync(targetMs);
    }
    setPositionMs(targetMs);
  };

  if (!source) return null;

  const progressFraction = durationMs > 0 ? positionMs / durationMs : 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Top App Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleClose} style={styles.iconBtn} activeOpacity={0.7}>
            <Ionicons name="close" size={26} color="#ffffff" />
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
          {source.canSaveToLibrary && onSaveToLibrary ? (
            <TouchableOpacity onPress={onSaveToLibrary} style={styles.iconBtn} activeOpacity={0.7}>
              <Ionicons name="download-outline" size={24} color="#38bdf8" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
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
                setPlaybackError(typeof err === 'string' ? err : 'Failed to load video stream');
              }}
            />
          ) : (
            <View style={styles.audioArtworkContainer}>
              {source.thumbnailUrl ? (
                <Image source={{ uri: source.thumbnailUrl }} style={styles.albumArt} />
              ) : (
                <View style={styles.albumArtPlaceholder}>
                  <Ionicons name="musical-notes" size={80} color="#38bdf8" />
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
              <ActivityIndicator size="large" color="#38bdf8" />
            </View>
          )}
          {playbackError && (
            <View style={styles.loadingOverlay}>
              <Ionicons name="alert-circle-outline" size={40} color="#f87171" />
              <Text style={{ color: '#fecaca', marginTop: 10, paddingHorizontal: 24, textAlign: 'center', fontSize: 13 }}>
                {playbackError}
              </Text>
            </View>
          )}
        </View>

        {/* Controls & Scrubber */}
        <View style={styles.controlsSection}>
          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.round(progressFraction * 100)}%` }]} />
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatDuration(positionMs / 1000)}</Text>
              <Text style={styles.timeText}>{formatDuration(durationMs / 1000)}</Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.playbackControls}>
            <TouchableOpacity
              onPress={() => skipSeconds(-10)}
              style={styles.skipBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={24} color="#e2e8f0" style={{ transform: [{ scaleX: -1 }] }} />
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
                color="#0f172a"
                style={!isPlaying ? { marginLeft: 3 } : undefined}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => skipSeconds(10)}
              style={styles.skipBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={24} color="#e2e8f0" />
              <Text style={styles.skipLabel}>+10s</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 16,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
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
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  topSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  mediaArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    backgroundColor: '#000000',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
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
    borderColor: '#38bdf8',
    marginBottom: 24,
  },
  albumArtPlaceholder: {
    width: width * 0.65,
    height: width * 0.65,
    borderRadius: 16,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 24,
  },
  audioTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  audioAuthor: {
    color: '#94a3b8',
    fontSize: 15,
    marginTop: 6,
    textAlign: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlsSection: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  progressContainer: {
    marginBottom: 20,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  timeText: {
    color: '#94a3b8',
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
    backgroundColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#38bdf8',
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
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
});

