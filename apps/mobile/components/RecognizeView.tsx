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
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RecognizedTrack } from '@grabbit/types';
import { mobileRecognizer, RecognitionHistoryItem } from '../services/recognizer';
import { MotionView, PulseMotion } from './motion';
import { useTheme } from '../hooks/useTheme';
import { useI18n } from '../hooks/useI18n';
import { ThemeColors } from '../constants/theme';
import { hapticLight, hapticSuccess } from '../services/haptics';

interface RecognizeViewProps {
  onFindAndDownload: (query: string) => void;
}

interface HistoryRowProps {
  item: RecognitionHistoryItem;
  index: number;
  isRtl: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  onSelect: (item: RecognizedTrack) => void;
  onDownload: (query: string) => void;
}

const HistoryRow = React.memo(function HistoryRow({
  item,
  index,
  isRtl,
  colors,
  styles,
  onSelect,
  onDownload,
}: HistoryRowProps) {
  return (
    <MotionView
      key={item.id}
      initial={{ opacity: 0, translateY: 6 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ duration: 180, delay: Math.min(index * 30, 180) }}
    >
      <TouchableOpacity
        style={[styles.historyItem, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
        onPress={() => onSelect(item)}
      >
        {item.coverArtUrl ? (
          <Image source={{ uri: item.coverArtUrl }} style={styles.historyThumb} />
        ) : (
          <View style={styles.historyThumbPlaceholder}>
            <Ionicons name="musical-note" size={18} color={colors.textSecondary} />
          </View>
        )}
        <View style={[styles.historyInfo, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}>
          <Text style={styles.historyItemTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.historyItemArtist} numberOfLines={1}>
            {item.artist}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.historyGrabBtn}
          onPress={() => {
            void hapticLight();
            onDownload(`${item.artist} - ${item.title}`);
          }}
        >
          <Ionicons name="download-outline" size={18} color={colors.accent} />
        </TouchableOpacity>
      </TouchableOpacity>
    </MotionView>
  );
});

export function RecognizeView({ onFindAndDownload }: RecognizeViewProps) {
  const { colors } = useTheme();
  const { t, isRtl, textDirStyle, errorText } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecognizedTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RecognitionHistoryItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');

  useEffect(() => {
    void mobileRecognizer.loadHistory().then((h) => setHistory([...h]));
    const unsub = mobileRecognizer.subscribe((h) => setHistory([...h]));
    return unsub;
  }, []);

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.artist.toLowerCase().includes(q) ||
        (item.album || '').toLowerCase().includes(q)
    );
  }, [history, historyQuery]);

  const handleIdentify = async (targetUrl = url) => {
    const input = targetUrl.trim();
    if (!input) return;

    void hapticLight();
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const track = await mobileRecognizer.recognizeFromUrl(input);
      if (!track) {
        setError(t('rec.noMatch'));
      } else {
        void hapticSuccess();
        setResult(track);
      }
    } catch (err: any) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleClearHistory = async () => {
    void hapticLight();
    await mobileRecognizer.clearHistory();
  };

  const openExternal = (link?: string) => {
    if (link) {
      Linking.openURL(link).catch(() => {
        Alert.alert(t('dl.error'), t('err.UNKNOWN'));
      });
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          {busy ? (
            <PulseMotion active>
              <Ionicons name="musical-notes" size={32} color={colors.accent} />
            </PulseMotion>
          ) : (
            <Ionicons name="musical-notes" size={32} color={colors.accent} />
          )}
        </View>
        <Text style={[styles.title, textDirStyle]}>{t('rec.title')}</Text>
        <Text style={[styles.subtitle, textDirStyle]}>{t('rec.subtitle')}</Text>
      </View>

      {/* Input row */}
      <View style={styles.inputCard}>
        <View style={[styles.inputWrapper, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Ionicons name="link-outline" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.input, textDirStyle]}
            value={url}
            onChangeText={setUrl}
            placeholder={t('rec.urlPlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {url.length > 0 && (
            <TouchableOpacity onPress={() => setUrl('')} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.identifyBtn,
            { flexDirection: isRtl ? 'row-reverse' : 'row' },
            (!url.trim() || busy) && styles.identifyBtnDisabled,
          ]}
          onPress={() => handleIdentify()}
          disabled={!url.trim() || busy}
        >
          {busy ? (
            <>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={styles.identifyBtnText}>{t('rec.listening')}</Text>
            </>
          ) : (
            <>
              <Ionicons name="sparkles" size={16} color="#ffffff" />
              <Text style={styles.identifyBtnText}>{t('rec.identify')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Error Banner */}
      {error && (
        <MotionView
          style={[styles.errorBanner, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
          initial={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ duration: 180 }}
        >
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={[styles.errorBannerText, textDirStyle]}>{error}</Text>
        </MotionView>
      )}

      {/* Song Card Result */}
      {result && (
        <MotionView
          style={styles.songCard}
          initial={{ opacity: 0, translateY: 12, scale: 0.98 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={{ duration: 240 }}
        >
          <View style={[styles.songMainRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            {result.coverArtUrl ? (
              <Image source={{ uri: result.coverArtUrl }} style={styles.songCover} />
            ) : (
              <View style={styles.songCoverPlaceholder}>
                <Ionicons name="disc-outline" size={40} color={colors.textSecondary} />
              </View>
            )}

            <View style={[styles.songInfo, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}>
              <Text style={[styles.songTitle, textDirStyle]} numberOfLines={2}>
                {result.title}
              </Text>
              <Text style={[styles.songArtist, textDirStyle]} numberOfLines={1}>
                {result.artist}
              </Text>
              {result.album ? (
                <Text style={[styles.songMeta, textDirStyle]} numberOfLines={1}>
                  {t('rec.album')}: {result.album}
                </Text>
              ) : null}
              {result.releaseYear ? (
                <Text style={[styles.songMeta, textDirStyle]}>
                  {t('rec.released')}: {result.releaseYear}
                </Text>
              ) : null}
              {result.genre ? (
                <Text style={[styles.songMeta, textDirStyle]}>
                  {t('rec.genre')}: {result.genre}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Action Row */}
          <View style={[styles.songActionsRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <TouchableOpacity
              style={[styles.downloadTrackBtn, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
              onPress={() => onFindAndDownload(`${result.artist} - ${result.title}`)}
            >
              <Ionicons name="download" size={16} color="#ffffff" />
              <Text style={styles.downloadTrackBtnText}>{t('rec.download')}</Text>
            </TouchableOpacity>

            {result.appleMusicUrl && (
              <TouchableOpacity
                style={styles.linkOutBtn}
                onPress={() => openExternal(result.appleMusicUrl)}
              >
                <Ionicons name="logo-apple" size={16} color={colors.textPrimary} />
                <Text style={styles.linkOutBtnText}>{t('rec.apple')}</Text>
              </TouchableOpacity>
            )}

            {result.shazamUrl && (
              <TouchableOpacity
                style={styles.linkOutBtn}
                onPress={() => openExternal(result.shazamUrl)}
              >
                <Ionicons name="open-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.linkOutBtnText}>{t('rec.shazam')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </MotionView>
      )}

      {/* History */}
      {history.length > 0 && (
        <View style={styles.historySection}>
          <View style={[styles.historyHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <Text style={styles.historyTitle}>{t('rec.history')}</Text>
            <TouchableOpacity onPress={handleClearHistory} style={styles.clearHistoryBtn}>
              <Text style={styles.clearHistoryText}>{t('rec.clear')}</Text>
            </TouchableOpacity>
          </View>

          {history.length > 2 && (
            <View style={[styles.inputWrapper, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
              <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
              <TextInput
                style={[styles.input, textDirStyle]}
                value={historyQuery}
                onChangeText={setHistoryQuery}
                placeholder={t('rec.searchHistory')}
                placeholderTextColor={colors.textMuted}
              />
              {historyQuery.length > 0 && (
                <TouchableOpacity onPress={() => setHistoryQuery('')} style={styles.clearBtn}>
                  <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.historyList}>
            {filteredHistory.map((item, idx) => (
              <HistoryRow
                key={item.id}
                item={item}
                index={idx}
                isRtl={isRtl}
                colors={colors}
                styles={styles}
                onSelect={setResult}
                onDownload={onFindAndDownload}
              />
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
      gap: 18,
      paddingBottom: 40,
    },
    header: {
      alignItems: 'center',
      marginVertical: 12,
      gap: 6,
    },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.accentSubtle,
      borderWidth: 1,
      borderColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    title: {
      fontSize: 22,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 16,
    },
    inputCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
    },
    inputWrapper: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
    },
    input: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 8,
      color: colors.textPrimary,
      fontSize: 14,
    },
    clearBtn: {
      padding: 4,
    },
    identifyBtn: {
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 8,
    },
    identifyBtnDisabled: {
      opacity: 0.5,
    },
    identifyBtnText: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: 'bold',
    },
    errorBanner: {
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.errorSubtle,
      borderRadius: 8,
      padding: 12,
    },
    errorBannerText: {
      color: colors.error,
      fontSize: 13,
      flex: 1,
    },
    songCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.accent,
      gap: 14,
    },
    songMainRow: {
      gap: 14,
    },
    songCover: {
      width: 90,
      height: 90,
      borderRadius: 10,
      backgroundColor: colors.background,
    },
    songCoverPlaceholder: {
      width: 90,
      height: 90,
      borderRadius: 10,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    songInfo: {
      flex: 1,
      gap: 4,
    },
    songTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    songArtist: {
      fontSize: 14,
      color: colors.accent,
      fontWeight: '600',
    },
    songMeta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    songActionsRow: {
      gap: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    downloadTrackBtn: {
      flex: 1,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 8,
    },
    downloadTrackBtnText: {
      color: '#ffffff',
      fontWeight: 'bold',
      fontSize: 13,
    },
    linkOutBtn: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 8,
    },
    linkOutBtnText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '600',
    },
    historySection: {
      gap: 10,
      marginTop: 8,
    },
    historyHeader: {
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    historyTitle: {
      fontSize: 15,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    clearHistoryBtn: {
      padding: 4,
    },
    clearHistoryText: {
      color: colors.textSecondary,
      fontSize: 12,
    },
    historyList: {
      gap: 8,
    },
    historyItem: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    historyThumb: {
      width: 44,
      height: 44,
      borderRadius: 6,
      backgroundColor: colors.background,
    },
    historyThumbPlaceholder: {
      width: 44,
      height: 44,
      borderRadius: 6,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyInfo: {
      flex: 1,
      gap: 2,
    },
    historyItemTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    historyItemArtist: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    historyGrabBtn: {
      padding: 8,
      borderRadius: 6,
      backgroundColor: colors.background,
    },
  });
