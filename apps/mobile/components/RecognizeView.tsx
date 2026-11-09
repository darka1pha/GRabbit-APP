import React, { useState, useEffect } from 'react';
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

interface RecognizeViewProps {
  onFindAndDownload: (query: string) => void;
}

export function RecognizeView({ onFindAndDownload }: RecognizeViewProps) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecognizedTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RecognitionHistoryItem[]>([]);

  useEffect(() => {
    mobileRecognizer.loadHistory().then((h) => setHistory([...h]));
    const unsub = mobileRecognizer.subscribe((h) => setHistory([...h]));
    return unsub;
  }, []);

  const handleIdentify = async (targetUrl = url) => {
    const input = targetUrl.trim();
    if (!input) return;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const track = await mobileRecognizer.recognizeFromUrl(input);
      if (!track) {
        setError('No matching song could be identified for this audio.');
      } else {
        setResult(track);
      }
    } catch (err: any) {
      setError(err.message || 'Recognition failed');
    } finally {
      setBusy(false);
    }
  };

  const handleClearHistory = async () => {
    await mobileRecognizer.clearHistory();
  };

  const openExternal = (link?: string) => {
    if (link) {
      Linking.openURL(link).catch(() => {
        Alert.alert('Error', 'Could not open URL');
      });
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <Ionicons name="musical-notes" size={32} color="#38bdf8" />
        </View>
        <Text style={styles.title}>Music & Audio Recognizer</Text>
        <Text style={styles.subtitle}>
          Paste an audio link, YouTube clip, or TikTok to identify songs with Shazam & find downloadable media!
        </Text>
      </View>

      {/* Input row */}
      <View style={styles.inputCard}>
        <View style={styles.inputWrapper}>
          <Ionicons name="link-outline" size={18} color="#94a3b8" />
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="Paste audio link or song keywords..."
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {url.length > 0 && (
            <TouchableOpacity onPress={() => setUrl('')} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.identifyBtn, (!url.trim() || busy) && styles.identifyBtnDisabled]}
          onPress={() => handleIdentify()}
          disabled={!url.trim() || busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="sparkles" size={16} color="#ffffff" />
              <Text style={styles.identifyBtnText}>Recognize Song</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Error Banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={18} color="#ef4444" />
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      {/* Song Card Result */}
      {result && (
        <View style={styles.songCard}>
          <View style={styles.songMainRow}>
            {result.coverArtUrl ? (
              <Image source={{ uri: result.coverArtUrl }} style={styles.songCover} />
            ) : (
              <View style={styles.songCoverPlaceholder}>
                <Ionicons name="disc-outline" size={40} color="#94a3b8" />
              </View>
            )}

            <View style={styles.songInfo}>
              <Text style={styles.songTitle} numberOfLines={2}>
                {result.title}
              </Text>
              <Text style={styles.songArtist} numberOfLines={1}>
                {result.artist}
              </Text>
              {result.album ? (
                <Text style={styles.songMeta} numberOfLines={1}>
                  Album: {result.album}
                </Text>
              ) : null}
              {result.releaseYear ? (
                <Text style={styles.songMeta}>Released: {result.releaseYear}</Text>
              ) : null}
              {result.genre ? (
                <Text style={styles.songMeta}>Genre: {result.genre}</Text>
              ) : null}
            </View>
          </View>

          {/* Action Row */}
          <View style={styles.songActionsRow}>
            <TouchableOpacity
              style={styles.downloadTrackBtn}
              onPress={() => onFindAndDownload(`${result.artist} - ${result.title}`)}
            >
              <Ionicons name="download" size={16} color="#ffffff" />
              <Text style={styles.downloadTrackBtnText}>Grab Track</Text>
            </TouchableOpacity>

            {result.appleMusicUrl && (
              <TouchableOpacity
                style={styles.linkOutBtn}
                onPress={() => openExternal(result.appleMusicUrl)}
              >
                <Ionicons name="logo-apple" size={16} color="#ffffff" />
                <Text style={styles.linkOutBtnText}>Apple</Text>
              </TouchableOpacity>
            )}

            {result.shazamUrl && (
              <TouchableOpacity
                style={styles.linkOutBtn}
                onPress={() => openExternal(result.shazamUrl)}
              >
                <Ionicons name="open-outline" size={16} color="#ffffff" />
                <Text style={styles.linkOutBtnText}>Shazam</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* History */}
      {history.length > 0 && (
        <View style={styles.historySection}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Recognition History</Text>
            <TouchableOpacity onPress={handleClearHistory} style={styles.clearHistoryBtn}>
              <Text style={styles.clearHistoryText}>Clear</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.historyList}>
            {history.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.historyItem}
                onPress={() => setResult(item)}
              >
                {item.coverArtUrl ? (
                  <Image source={{ uri: item.coverArtUrl }} style={styles.historyThumb} />
                ) : (
                  <View style={styles.historyThumbPlaceholder}>
                    <Ionicons name="musical-note" size={18} color="#94a3b8" />
                  </View>
                )}

                <View style={styles.historyInfo}>
                  <Text style={styles.historyItemTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.historyItemArtist} numberOfLines={1}>
                    {item.artist}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.historyGrabBtn}
                  onPress={() => onFindAndDownload(`${item.artist} - ${item.title}`)}
                >
                  <Ionicons name="download-outline" size={18} color="#38bdf8" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
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
    backgroundColor: '#0369a126',
    borderWidth: 1,
    borderColor: '#38bdf866',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  inputCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
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
  clearBtn: {
    padding: 4,
  },
  identifyBtn: {
    backgroundColor: '#0284c7',
    flexDirection: 'row',
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
  songCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#38bdf866',
    gap: 14,
  },
  songMainRow: {
    flexDirection: 'row',
    gap: 14,
  },
  songCover: {
    width: 90,
    height: 90,
    borderRadius: 10,
    backgroundColor: '#0f172a',
  },
  songCoverPlaceholder: {
    width: 90,
    height: 90,
    borderRadius: 10,
    backgroundColor: '#0f172a',
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
    color: '#ffffff',
  },
  songArtist: {
    fontSize: 14,
    color: '#38bdf8',
    fontWeight: '600',
  },
  songMeta: {
    fontSize: 12,
    color: '#94a3b8',
  },
  songActionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  downloadTrackBtn: {
    flex: 1,
    backgroundColor: '#0284c7',
    flexDirection: 'row',
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
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  linkOutBtnText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  historySection: {
    gap: 10,
    marginTop: 8,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#cbd5e1',
  },
  clearHistoryBtn: {
    padding: 4,
  },
  clearHistoryText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  historyList: {
    gap: 8,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  historyThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#0f172a',
  },
  historyThumbPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#0f172a',
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
    color: '#ffffff',
  },
  historyItemArtist: {
    fontSize: 11,
    color: '#94a3b8',
  },
  historyGrabBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#0f172a',
  },
});

