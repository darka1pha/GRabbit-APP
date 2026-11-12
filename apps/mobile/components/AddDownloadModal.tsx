import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Category, DownloadQueue, ProbeResult, CATEGORIES } from '@grabbit/types';
import { formatBytes, isHttpUrl, looksLikeMediaPage } from '@grabbit/utils';
import { useDownloads } from '../hooks/useDownloads';

interface AddDownloadModalProps {
  visible: boolean;
  initialUrl?: string;
  onClose: () => void;
  onOpenInGrab?: (url: string) => void;
}

export function AddDownloadModal({
  visible,
  initialUrl = '',
  onClose,
  onOpenInGrab,
}: AddDownloadModalProps) {
  const { queues, probeUrl, startHttpDownload, batchImportUrls } = useDownloads();

  const [text, setText] = useState(initialUrl);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [category, setCategory] = useState<Category | 'auto'>('auto');
  const [queueId, setQueueId] = useState('main');
  const [connections, setConnections] = useState(4);
  const [advanced, setAdvanced] = useState(false);
  const [referrer, setReferrer] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [speedLimitKBps, setSpeedLimitKBps] = useState(0);
  const [checksum, setChecksum] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setText(initialUrl);
      setProbe(null);
      setProbeError(null);
      setFileName('');
      setCategory('auto');
      setQueueId('main');
      setAdvanced(false);
    }
  }, [visible, initialUrl]);

  const urls = useMemo(() => {
    return text
      .split(/[\s]+/)
      .map((u) => u.trim())
      .filter((u) => isHttpUrl(u));
  }, [text]);

  const singleUrl = urls.length === 1 ? urls[0] : null;

  // Probe single URL
  useEffect(() => {
    if (!singleUrl) {
      setProbe(null);
      return;
    }

    let active = true;
    setProbing(true);
    setProbeError(null);

    const timer = setTimeout(() => {
      probeUrl(singleUrl)
        .then((res) => {
          if (!active) return;
          setProbe(res);
          setFileName(res.fileName);
        })
        .catch((err) => {
          if (!active) return;
          setProbeError(err.message || 'Failed to probe URL');
        })
        .finally(() => {
          if (active) setProbing(false);
        });
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [singleUrl, probeUrl]);

  const isMedia = singleUrl && looksLikeMediaPage(singleUrl);

  const handleSubmit = async (startPaused: boolean) => {
    if (urls.length === 0) {
      Alert.alert('Required', 'Please enter at least one valid URL');
      return;
    }

    setSubmitting(true);
    try {
      if (urls.length === 1) {
        await startHttpDownload({
          url: urls[0],
          fileName: fileName.trim() || undefined,
          category: category === 'auto' ? undefined : category,
          queueId,
          connections,
          referrer: referrer.trim() || undefined,
          speedLimitKBps: speedLimitKBps > 0 ? speedLimitKBps : undefined,
          startPaused,
        });
      } else {
        await batchImportUrls(urls, {
          category: category === 'auto' ? undefined : category,
          queueId,
          connections,
          startPaused,
        });
      }
      onClose();
    } catch (err: any) {
      Alert.alert('Download Error', err.message || 'Failed to add download');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="cloud-download-outline" size={20} color="#38bdf8" />
              <Text style={styles.title}>Add Direct Download</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {/* URLs Input */}
            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Download URL(s)</Text>
                {urls.length > 1 && (
                  <Text style={styles.batchCountBadge}>{urls.length} URLs detected</Text>
                )}
              </View>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={text}
                onChangeText={setText}
                placeholder="https://example.com/file.zip&#10;Paste single or multi-line URLs..."
                placeholderTextColor="#64748b"
                multiline
                numberOfLines={urls.length > 1 ? 4 : 2}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Media Site Hint */}
            {isMedia && onOpenInGrab && (
              <View style={styles.mediaHintCard}>
                <Ionicons name="sparkles" size={18} color="#38bdf8" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.mediaHintTitle}>Media stream detected</Text>
                  <Text style={styles.mediaHintSubtitle}>
                    This looks like a video/audio page. Grab formats & quality in Grab view?
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.openGrabBtn}
                  onPress={() => {
                    onClose();
                    onOpenInGrab(singleUrl!);
                  }}
                >
                  <Text style={styles.openGrabBtnText}>Open Grab</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Probe info card */}
            {singleUrl && !isMedia && (
              <View style={styles.probeCard}>
                {probing ? (
                  <View style={styles.probingRow}>
                    <ActivityIndicator size="small" color="#38bdf8" />
                    <Text style={styles.probingText}>Probing URL headers & size...</Text>
                  </View>
                ) : probeError ? (
                  <View style={styles.probingRow}>
                    <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
                    <Text style={styles.probeErrorText}>{probeError}</Text>
                  </View>
                ) : probe ? (
                  <View style={styles.probeDetails}>
                    <View style={styles.probeBadgesRow}>
                      <View style={styles.probeBadge}>
                        <Text style={styles.probeBadgeText}>
                          {probe.totalBytes ? formatBytes(probe.totalBytes) : 'Unknown size'}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.probeBadge,
                          probe.resumable ? styles.probeBadgeSuccess : styles.probeBadgeWarning,
                        ]}
                      >
                        <Text style={styles.probeBadgeText}>
                          {probe.resumable ? 'Resumable' : 'Non-resumable'}
                        </Text>
                      </View>
                      {probe.mimeType && (
                        <View style={styles.probeBadge}>
                          <Text style={styles.probeBadgeText}>{probe.mimeType.split('/')[1] || probe.mimeType}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ) : null}
              </View>
            )}

            {/* Custom Filename */}
            {singleUrl && (
              <View style={styles.field}>
                <Text style={styles.label}>Save File As</Text>
                <TextInput
                  style={styles.input}
                  value={fileName}
                  onChangeText={setFileName}
                  placeholder="filename.ext"
                  placeholderTextColor="#64748b"
                />
              </View>
            )}

            {/* Category & Target Queue */}
            <View style={styles.rowTwoCols}>
              <View style={styles.col}>
                <Text style={styles.label}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  <TouchableOpacity
                    style={[styles.chip, category === 'auto' && styles.chipActive]}
                    onPress={() => setCategory('auto')}
                  >
                    <Text style={[styles.chipText, category === 'auto' && styles.chipTextActive]}>
                      Auto ({probe?.category || 'other'})
                    </Text>
                  </TouchableOpacity>
                  {CATEGORIES.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, category === c && styles.chipActive]}
                      onPress={() => setCategory(c)}
                    >
                      <Text style={[styles.chipText, category === c && styles.chipTextActive]}>
                        {c[0].toUpperCase() + c.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>

            {/* Target Queue */}
            <View style={styles.field}>
              <Text style={styles.label}>Target Queue</Text>
              <View style={styles.queuePillsRow}>
                {queues.map((q) => (
                  <TouchableOpacity
                    key={q.id}
                    style={[styles.queuePill, queueId === q.id && styles.queuePillActive]}
                    onPress={() => setQueueId(q.id)}
                  >
                    <Text
                      style={[
                        styles.queuePillText,
                        queueId === q.id && styles.queuePillTextActive,
                      ]}
                    >
                      {q.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Advanced toggle */}
            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setAdvanced(!advanced)}
            >
              <Ionicons
                name={advanced ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color="#38bdf8"
              />
              <Text style={styles.advancedToggleText}>Advanced Options</Text>
            </TouchableOpacity>

            {advanced && (
              <View style={styles.advancedContainer}>
                {/* Mobile Single Stream Engine */}
                <View style={styles.field}>
                  <Text style={styles.label}>Connection Mode</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b' }}>
                    <Ionicons name="flash-outline" size={16} color="#38bdf8" style={{ marginRight: 8 }} />
                    <Text style={{ fontSize: 13, color: '#f8fafc', fontWeight: '500' }}>Single Stream (Mobile Native)</Text>
                  </View>
                </View>

                {/* Speed Limit */}
                <View style={styles.field}>
                  <Text style={styles.label}>Speed Limit (KB/s, 0 = unlimited)</Text>
                  <TextInput
                    style={styles.input}
                    value={speedLimitKBps ? String(speedLimitKBps) : ''}
                    onChangeText={(v) => setSpeedLimitKBps(Number(v) || 0)}
                    placeholder="0"
                    placeholderTextColor="#64748b"
                    keyboardType="numeric"
                  />
                </View>

                {/* Referrer */}
                <View style={styles.field}>
                  <Text style={styles.label}>Custom Referrer</Text>
                  <TextInput
                    style={styles.input}
                    value={referrer}
                    onChangeText={setReferrer}
                    placeholder="https://"
                    placeholderTextColor="#64748b"
                    autoCapitalize="none"
                  />
                </View>

                {/* Checksum */}
                {singleUrl && (
                  <View style={styles.field}>
                    <Text style={styles.label}>Expected Checksum (SHA-256 / MD5)</Text>
                    <TextInput
                      style={styles.input}
                      value={checksum}
                      onChangeText={setChecksum}
                      placeholder="Optional checksum hash..."
                      placeholderTextColor="#64748b"
                      autoCapitalize="none"
                    />
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pausedBtn}
              onPress={() => handleSubmit(true)}
              disabled={submitting || urls.length === 0}
            >
              <Text style={styles.pausedBtnText}>Add Paused</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.startBtn, (submitting || urls.length === 0) && styles.startBtnDisabled]}
              onPress={() => handleSubmit(false)}
              disabled={submitting || urls.length === 0}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.startBtnText}>Start Download</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000a6',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: '#334155',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    maxHeight: 520,
  },
  bodyContent: {
    padding: 16,
    gap: 14,
  },
  field: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
  },
  batchCountBadge: {
    fontSize: 11,
    color: '#38bdf8',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
  },
  textArea: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  mediaHintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0369a126',
    borderWidth: 1,
    borderColor: '#38bdf866',
    borderRadius: 8,
    padding: 10,
  },
  mediaHintTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#38bdf8',
  },
  mediaHintSubtitle: {
    fontSize: 11,
    color: '#cbd5e1',
  },
  openGrabBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  openGrabBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  probeCard: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  probingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  probingText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  probeErrorText: {
    fontSize: 12,
    color: '#ef4444',
  },
  probeDetails: {
    gap: 4,
  },
  probeBadgesRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  probeBadge: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  probeBadgeSuccess: {
    borderColor: '#22c55e',
  },
  probeBadgeWarning: {
    borderColor: '#f59e0b',
  },
  probeBadgeText: {
    fontSize: 11,
    color: '#e2e8f0',
  },
  rowTwoCols: {
    gap: 10,
  },
  col: {
    gap: 6,
  },
  chipScroll: {
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginRight: 6,
  },
  chipActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  chipText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  queuePillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  queuePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  queuePillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  queuePillText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  queuePillTextActive: {
    color: '#ffffff',
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  advancedToggleText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
  advancedContainer: {
    gap: 12,
    backgroundColor: '#090d16',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  stepperRow: {
    flexDirection: 'row',
    gap: 8,
  },
  connChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  connChipActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  connChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  connChipTextActive: {
    color: '#ffffff',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    gap: 10,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cancelBtnText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  pausedBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  pausedBtnText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  startBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  startBtnDisabled: {
    opacity: 0.5,
  },
  startBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});

