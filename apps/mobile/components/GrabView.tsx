import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image, ActivityIndicator, Alert, AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { PlatformMetadata, MediaItem, MediaOption } from '@grabbit/types';
import { isHttpUrl, looksLikeDirectFile } from '@grabbit/utils';
import { mobileBridge } from '../services/bridge';
import { mobileSettingsManager } from '../services/settings-manager';
import { useDownloads } from '../hooks/useDownloads';
import { MotionView, MotionPressable } from './motion';
import { PlatformChips } from './grab/PlatformChips';
import { TrackRow } from './grab/TrackRow';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '../hooks/useTheme';
import { hapticLight, hapticSuccess, hapticError } from '../services/haptics';
import { createStyles } from './GrabView.styles';

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
  const { t, isRtl, textDirStyle, formatBytes, formatDuration, errorText } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { queues, startDownload } = useDownloads();

  const [input, setInput] = useState(initialUrl);
  const [isResolving, setIsResolving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resolvedMeta, setResolvedMeta] = useState<PlatformMetadata | null>(null);
  const [selectedQueueId, setSelectedQueueId] = useState('main');
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const dismissedClipboardRef = useRef<string | null>(null);

  // Single media option choice
  const [selectedOption, setSelectedOption] = useState<MediaOption | null>(null);

  // Collection multi-select
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [collectionFormat, setCollectionFormat] = useState('audio:mp3');

  const checkClipboard = useCallback(async () => {
    try {
      const raw = (await Clipboard.getStringAsync()).trim();
      if (!raw) return;
      const { valid, url } = mobileBridge.extractAndParseUrl(raw);
      if (
        valid &&
        isHttpUrl(url) &&
        url !== dismissedClipboardRef.current &&
        url !== input.trim() &&
        url !== sharedUrl
      ) {
        setClipboardUrl(url);
      }
    } catch {
      // ignore clipboard permission / foreground noise
    }
  }, [input, sharedUrl]);

  useEffect(() => {
    void checkClipboard();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkClipboard();
      }
    });
    return () => sub.remove();
  }, [checkClipboard]);

  const looksDirect = useMemo(() => {
    return isHttpUrl(input) && looksLikeDirectFile(input);
  }, [input]);

  const handlePaste = async () => {
    try {
      void hapticLight();
      const text = await Clipboard.getStringAsync();
      if (text) {
        const { url: parsedUrl } = mobileBridge.extractAndParseUrl(text);
        setInput(parsedUrl);
        setClipboardUrl(null);
      }
    } catch {
      // ignore
    }
  };

  const handleToggleTrack = useCallback((id: string) => {
    void hapticLight();
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleGrab = useCallback(
    async (target = input) => {
      const text = target.trim();
      if (!text) return;

      if (looksLikeDirectFile(text) && onOpenDirectDownload) {
        onOpenDirectDownload(text);
        return;
      }

      void hapticLight();
      setErrorMessage(null);
      setIsResolving(true);
      setResolvedMeta(null);
      setSelectedOption(null);

      try {
        const meta = await mobileBridge.resolveMetadata(text);
        if (!meta || meta.items.length === 0) {
          void hapticError();
          setErrorMessage(t('grab.notMedia'));
        } else {
          void hapticSuccess();
          setResolvedMeta(meta);
          if (!meta.isCollection && meta.items[0]) {
            const first = meta.items[0];
            setSelectedOption(first.availableOptions[0] || null);
          } else if (meta.isCollection) {
            setSelectedTrackIds(
              new Set(meta.items.filter((i) => i.isDownloadable).map((i) => i.id))
            );
          }
        }
      } catch (err: any) {
        void hapticError();
        setErrorMessage(errorText(err));
      } finally {
        setIsResolving(false);
      }
    },
    [input, onOpenDirectDownload, t, errorText]
  );

  // Grab a shared/deep-linked URL once when it arrives, using the latest handleGrab
  // without re-running every time the text input (and so handleGrab) changes
  const handleGrabRef = useRef(handleGrab);
  useEffect(() => {
    handleGrabRef.current = handleGrab;
  }, [handleGrab]);

  useEffect(() => {
    if (initialUrl) {
      setInput(initialUrl);
      void handleGrabRef.current(initialUrl);
    }
  }, [initialUrl]);

  const handleSingleDownload = async () => {
    if (!resolvedMeta || !resolvedMeta.items[0] || !selectedOption) return;
    try {
      void hapticSuccess();
      await startDownload(resolvedMeta.items[0], selectedOption, selectedQueueId);
      setInput('');
      setResolvedMeta(null);
      onDownloadStarted?.();
    } catch (err: any) {
      void hapticError();
      Alert.alert(t('dl.error'), errorText(err));
    }
  };

  const handleSendToDesktop = async () => {
    if (!resolvedMeta || !resolvedMeta.items[0]) return;
    const item = resolvedMeta.items[0];
    const res = await mobileBridge.sendToDesktop(item.url, { fileName: item.title });
    if (res.success) {
      void hapticSuccess();
      Alert.alert(t('mobile.desktopPc'), item.title);
      setInput('');
      setResolvedMeta(null);
    } else {
      void hapticError();
      Alert.alert(t('dl.error'), res.error || t('err.NETWORK'));
    }
  };

  const handleCollectionDownload = async () => {
    if (!resolvedMeta || !resolvedMeta.items) return;
    const itemsToDownload = resolvedMeta.items.filter((i) => selectedTrackIds.has(i.id));
    if (itemsToDownload.length === 0) {
      return;
    }

    const [fmtKind, quality] = collectionFormat.split(':');
    const resolvedQuality = quality || (fmtKind === 'audio' ? 'mp3' : '1080p');
    const option: MediaOption = {
      format: fmtKind as 'audio' | 'video',
      qualityId: resolvedQuality,
      label: resolvedQuality.toUpperCase(),
      extension: fmtKind === 'audio' ? resolvedQuality : 'mp4',
    };

    try {
      void hapticSuccess();
      for (const item of itemsToDownload) {
        await startDownload(item, option, selectedQueueId);
      }
      setInput('');
      setResolvedMeta(null);
      onDownloadStarted?.();
    } catch (err: any) {
      void hapticError();
      Alert.alert(t('dl.error'), errorText(err));
    }
  };

  const bridgeEnabled = mobileSettingsManager.getSettings().desktopBridge.enabled;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, textDirStyle]}>🐰 GRabbit</Text>
        <Text style={[styles.subtitle, textDirStyle]} numberOfLines={2}>
          {t('grab.subtitle')}
        </Text>
      </View>

      {/* Auto-Detected Clipboard URL Pill */}
      {clipboardUrl && !sharedUrl && (
        <MotionView
          style={[styles.shareBanner, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
          initial={{ opacity: 0, translateY: -8, scale: 0.98 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={{ duration: 200 }}
        >
          <View style={[styles.shareBannerLeft, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <Ionicons name="clipboard-outline" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.shareBannerTitle, textDirStyle]}>
                {t('grab.clipboardDetected')}
              </Text>
              <Text style={[styles.shareBannerText, textDirStyle]} numberOfLines={1}>
                {clipboardUrl}
              </Text>
            </View>
          </View>
          <View style={styles.shareBannerActions}>
            <TouchableOpacity
              style={styles.shareGrabBtn}
              onPress={() => {
                const target = clipboardUrl;
                dismissedClipboardRef.current = target;
                setClipboardUrl(null);
                setInput(target);
                void handleGrab(target);
              }}
            >
              <Text style={styles.shareGrabText}>{t('grab.useIt')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                dismissedClipboardRef.current = clipboardUrl;
                setClipboardUrl(null);
              }}
              style={styles.shareDismissBtn}
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </MotionView>
      )}

      {/* Share Target Banner */}
      {sharedUrl && (
        <MotionView
          style={[styles.shareBanner, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
          initial={{ opacity: 0, translateY: -8, scale: 0.98 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={{ duration: 200 }}
        >
          <View style={[styles.shareBannerLeft, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <Ionicons name="share-social" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.shareBannerTitle, textDirStyle]}>
                {t('grab.clipboardDetected')}
              </Text>
              <Text style={[styles.shareBannerText, textDirStyle]} numberOfLines={1}>
                {sharedUrl}
              </Text>
            </View>
          </View>
          <View style={styles.shareBannerActions}>
            <TouchableOpacity
              style={styles.shareGrabBtn}
              onPress={() => {
                setInput(sharedUrl);
                void handleGrab(sharedUrl);
                onClearSharedUrl?.();
              }}
            >
              <Text style={styles.shareGrabText}>{t('grab.button')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClearSharedUrl} style={styles.shareDismissBtn}>
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </MotionView>
      )}

      {/* Input Box */}
      <MotionView
        style={styles.inputCard}
        initial={{ opacity: 0, translateY: 6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ duration: 200 }}
      >
        <View style={[styles.inputWrapper, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <TextInput
            style={[styles.input, textDirStyle]}
            placeholder={t('grab.placeholder')}
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {input.length > 0 ? (
            <TouchableOpacity onPress={() => setInput('')} style={styles.inputIconBtn}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handlePaste} style={styles.inputIconBtn}>
              <Ionicons name="clipboard-outline" size={18} color={colors.accent} />
            </TouchableOpacity>
          )}
        </View>

        <MotionPressable
          style={[
            styles.grabBtn,
            { flexDirection: isRtl ? 'row-reverse' : 'row' },
            isResolving && styles.grabBtnDisabled,
          ]}
          onPress={() => handleGrab()}
          disabled={isResolving}
          scaleOnPress={0.97}
        >
          {isResolving ? (
            <>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={styles.grabBtnText}>{t('grab.resolving')}</Text>
            </>
          ) : (
            <>
              <Ionicons name="download" size={16} color="#ffffff" />
              <Text style={styles.grabBtnText}>{t('grab.button')}</Text>
            </>
          )}
        </MotionPressable>
      </MotionView>

      {/* Direct file detected prompt */}
      {looksDirect && onOpenDirectDownload && (
        <MotionView
          style={[styles.directFileCard, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
          initial={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ duration: 180 }}
        >
          <Ionicons name="document-attach-outline" size={20} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.directFileTitle, textDirStyle]}>{t('grab.asFile')}</Text>
            <Text style={[styles.directFileSubtitle, textDirStyle]} numberOfLines={2}>
              {input}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.directFileBtn}
            onPress={() => onOpenDirectDownload(input)}
          >
            <Text style={styles.directFileBtnText}>{t('dl.open')}</Text>
          </TouchableOpacity>
        </MotionView>
      )}

      {/* Platform Chips */}
      <PlatformChips />

      {/* Error Banner */}
      {errorMessage && (
        <MotionView
          style={[styles.errorBanner, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
          initial={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ duration: 180 }}
        >
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={[styles.errorBannerText, textDirStyle]}>{errorMessage}</Text>
        </MotionView>
      )}

      {/* Single Media Resolved Card */}
      {resolvedMeta && !resolvedMeta.isCollection && resolvedMeta.items[0] && (
        <MotionView
          style={styles.mediaResolvedCard}
          initial={{ opacity: 0, translateY: 12, scale: 0.98 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={{ duration: 240 }}
        >
          <View style={[styles.mediaTop, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            {resolvedMeta.items[0].thumbnailUrl ? (
              <Image source={{ uri: resolvedMeta.items[0].thumbnailUrl }} style={styles.mediaThumb} />
            ) : (
              <View style={styles.mediaThumbPlaceholder}>
                <Ionicons name="film-outline" size={32} color={colors.textSecondary} />
              </View>
            )}

            <View style={[styles.mediaInfo, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}>
              <Text style={[styles.mediaTitle, textDirStyle]} numberOfLines={2}>
                {resolvedMeta.items[0].title}
              </Text>
              {resolvedMeta.items[0].uploader ? (
                <Text style={[styles.mediaUploader, textDirStyle]} numberOfLines={1}>
                  {resolvedMeta.items[0].uploader}
                </Text>
              ) : null}
              {resolvedMeta.items[0].durationSeconds ? (
                <Text style={[styles.mediaDuration, textDirStyle]}>
                  {formatDuration(resolvedMeta.items[0].durationSeconds)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Quality Options Section */}
          <View style={styles.optionsSection}>
            <Text style={[styles.optionsSectionTitle, textDirStyle]}>
              {t('grab.chooseFormat')}:
            </Text>
            <View style={styles.optionsGrid}>
              {resolvedMeta.items[0].availableOptions.map((opt) => {
                const isSelected =
                  selectedOption?.qualityId === opt.qualityId &&
                  selectedOption?.format === opt.format;
                return (
                  <TouchableOpacity
                    key={`${opt.format}-${opt.qualityId}`}
                    style={[styles.optionTile, isSelected && styles.optionTileActive]}
                    onPress={() => {
                      void hapticLight();
                      setSelectedOption(opt);
                    }}
                  >
                    <View
                      style={[
                        styles.optionHeader,
                        { flexDirection: isRtl ? 'row-reverse' : 'row' },
                      ]}
                    >
                      <Ionicons
                        name={opt.format === 'video' ? 'videocam' : 'musical-note'}
                        size={14}
                        color={isSelected ? colors.accent : colors.textSecondary}
                      />
                      <Text style={[styles.optionLabel, isSelected && styles.optionLabelActive]}>
                        {opt.label}
                      </Text>
                    </View>
                    <Text style={styles.optionSize}>
                      {opt.estimatedSizeBytes
                        ? `~${formatBytes(opt.estimatedSizeBytes)}`
                        : opt.extension.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Target Queue Selector */}
          <View style={styles.queueSelectSection}>
            <Text style={[styles.queueSelectLabel, textDirStyle]}>{t('queue.moveTo')}:</Text>
            <View
              style={[
                styles.queuePillsRow,
                { flexDirection: isRtl ? 'row-reverse' : 'row' },
              ]}
            >
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
          <View style={[styles.mediaActionsRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            {onPreviewMedia && selectedOption && (
              <TouchableOpacity
                style={styles.previewBtn}
                onPress={() => onPreviewMedia(resolvedMeta.items[0], selectedOption)}
              >
                <Ionicons name="play-outline" size={16} color={colors.accent} />
                <Text style={styles.previewBtnText}>{t('dl.open')}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.downloadBtn, !selectedOption && styles.downloadBtnDisabled]}
              onPress={handleSingleDownload}
              disabled={!selectedOption}
            >
              <Ionicons name="download" size={16} color="#ffffff" />
              <Text style={styles.downloadBtnText}>{t('grab.download')}</Text>
            </TouchableOpacity>

            {bridgeEnabled && (
              <TouchableOpacity style={styles.previewBtn} onPress={handleSendToDesktop}>
                <Ionicons name="desktop-outline" size={16} color={colors.accent} />
                <Text style={styles.previewBtnText}>{t('mobile.desktopPc')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </MotionView>
      )}

      {/* Collection / Playlist Resolved Card */}
      {resolvedMeta && resolvedMeta.isCollection && (
        <MotionView
          style={styles.collectionCard}
          initial={{ opacity: 0, translateY: 12, scale: 0.98 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={{ duration: 240 }}
        >
          <View style={styles.collectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.collectionTitle, textDirStyle]}>{resolvedMeta.title}</Text>
              <Text style={[styles.collectionSubtitle, textDirStyle]}>
                {t('grab.tracks', { count: resolvedMeta.items.length })}
              </Text>
            </View>
          </View>

          {/* Batch format choices & selections */}
          <View
            style={[
              styles.collectionControls,
              { flexDirection: isRtl ? 'row-reverse' : 'row' },
            ]}
          >
            <TouchableOpacity
              style={styles.selectToggleBtn}
              onPress={() =>
                setSelectedTrackIds(
                  new Set(resolvedMeta.items.filter((i) => i.isDownloadable).map((i) => i.id))
                )
              }
            >
              <Text style={styles.selectToggleText}>{t('grab.selectAll')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.selectToggleBtn}
              onPress={() => setSelectedTrackIds(new Set())}
            >
              <Text style={styles.selectToggleText}>{t('grab.selectNone')}</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            <View style={styles.formatPills}>
              {['audio:mp3', 'audio:m4a', 'video:1080p', 'video:720p'].map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.fmtPill, collectionFormat === f && styles.fmtPillActive]}
                  onPress={() => setCollectionFormat(f)}
                >
                  <Text
                    style={[
                      styles.fmtPillText,
                      collectionFormat === f && styles.fmtPillTextActive,
                    ]}
                  >
                    {f.split(':')[1].toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Tracks List */}
          <View style={styles.trackList}>
            {resolvedMeta.items.map((item, idx) => (
              <TrackRow
                key={item.id}
                item={item}
                index={idx}
                isChecked={selectedTrackIds.has(item.id)}
                onToggle={handleToggleTrack}
              />
            ))}
          </View>

          {/* Batch Download Button */}
          <TouchableOpacity
            style={[
              styles.batchDownloadBtn,
              selectedTrackIds.size === 0 && styles.batchDownloadBtnDisabled,
            ]}
            onPress={handleCollectionDownload}
            disabled={selectedTrackIds.size === 0}
          >
            <Ionicons name="download" size={16} color="#ffffff" />
            <Text style={styles.batchDownloadBtnText}>
              {t('grab.downloadSelected', { count: selectedTrackIds.size })}
            </Text>
          </TouchableOpacity>
        </MotionView>
      )}
    </ScrollView>
  );
}
