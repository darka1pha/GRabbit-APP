import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { ChecksumAlgorithm } from '@grabbit/types';
import { MobileDownloadTask } from '../services/download-manager';
import { useDownloads } from '../hooks/useDownloads';

interface ChecksumModalProps {
  visible: boolean;
  task: MobileDownloadTask | null;
  onClose: () => void;
}

export function ChecksumModal({ visible, task, onClose }: ChecksumModalProps) {
  const { verifyChecksum } = useDownloads();
  const [algorithm, setAlgorithm] = useState<ChecksumAlgorithm>('sha256');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState<string | null>(task?.checksum?.actual || null);
  const [verified, setVerified] = useState<boolean | undefined>(task?.checksum?.verified);
  const [busy, setBusy] = useState(false);

  if (!task) return null;

  const handleCompute = async () => {
    setBusy(true);
    try {
      const res = await verifyChecksum(task.id, algorithm, expected.trim() || undefined);
      setActual(res.actual);
      setVerified(res.verified);
    } catch (err: any) {
      Alert.alert('Checksum Error', err.message || 'Failed to compute checksum');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (actual) {
      await Clipboard.setStringAsync(actual);
      Alert.alert('Copied', 'Checksum copied to clipboard');
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#38bdf8" />
              <Text style={styles.title}>Verify File Checksum</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={styles.filename} numberOfLines={1}>
              {task.fileName}
            </Text>

            {/* Algorithm selector */}
            <View style={styles.algoRow}>
              {(['sha256', 'sha1', 'md5'] as ChecksumAlgorithm[]).map((a) => (
                <TouchableOpacity
                  key={a}
                  style={[styles.algoBtn, algorithm === a && styles.algoBtnActive]}
                  onPress={() => setAlgorithm(a)}
                >
                  <Text style={[styles.algoBtnText, algorithm === a && styles.algoBtnTextActive]}>
                    {a.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Expected Input */}
            <View style={styles.field}>
              <Text style={styles.label}>Expected Hash (Optional)</Text>
              <TextInput
                style={styles.input}
                value={expected}
                onChangeText={setExpected}
                placeholder="Paste expected checksum to compare..."
                placeholderTextColor="#64748b"
                autoCapitalize="none"
              />
            </View>

            {/* Result Box */}
            {actual && (
              <View style={styles.resultBox}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultLabel}>Calculated Hash:</Text>
                  {verified === true && (
                    <View style={styles.badgeSuccess}>
                      <Text style={styles.badgeSuccessText}>Matches Expected</Text>
                    </View>
                  )}
                  {verified === false && (
                    <View style={styles.badgeError}>
                      <Text style={styles.badgeErrorText}>Mismatch!</Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity style={styles.hashRow} onPress={handleCopy}>
                  <Text style={styles.hashText} selectable>
                    {actual}
                  </Text>
                  <Ionicons name="copy-outline" size={16} color="#38bdf8" />
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={[styles.computeBtn, busy && styles.computeBtnDisabled]}
              onPress={handleCompute}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.computeBtnText}>Compute & Verify</Text>
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
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
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
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 16,
    gap: 14,
  },
  filename: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
  },
  algoRow: {
    flexDirection: 'row',
    gap: 8,
  },
  algoBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  algoBtnActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  algoBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
  },
  algoBtnTextActive: {
    color: '#ffffff',
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  resultBox: {
    backgroundColor: '#090d16',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultLabel: {
    fontSize: 11,
    color: '#94a3b8',
  },
  badgeSuccess: {
    backgroundColor: '#064e3b',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeSuccessText: {
    color: '#4ade80',
    fontSize: 10,
    fontWeight: '700',
  },
  badgeError: {
    backgroundColor: '#450a0a',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeErrorText: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '700',
  },
  hashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  hashText: {
    flex: 1,
    fontSize: 12,
    color: '#38bdf8',
    fontFamily: 'monospace',
  },
  computeBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  computeBtnDisabled: {
    opacity: 0.6,
  },
  computeBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});

