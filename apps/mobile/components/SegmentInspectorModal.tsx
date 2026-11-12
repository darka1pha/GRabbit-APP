import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MobileDownloadTask } from '../services/download-manager';
import { formatBytes, formatSpeed } from '@grabbit/utils';

interface SegmentInspectorModalProps {
  visible: boolean;
  task: MobileDownloadTask | null;
  onClose: () => void;
}

export function SegmentInspectorModal({ visible, task, onClose }: SegmentInspectorModalProps) {
  if (!task) return null;

  const total = task.totalBytes || 1;
  const segments = task.segments || [];
  const activeConn = task.activeConnections;
  const totalConn = task.connections;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <View style={styles.headerTitleRow}>
                <Ionicons name="pulse" size={20} color="#38bdf8" />
                <Text style={styles.title}>Stream Inspector</Text>
              </View>
              <Text style={styles.subtitle} numberOfLines={1}>
                {task.title}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {/* Stat Cards */}
            <View style={styles.statGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Connection Mode</Text>
                <Text style={styles.statValue}>1 Stream</Text>
                <Text style={styles.statSub}>
                  {task.status === 'downloading' ? 'Active' : task.status}
                </Text>
              </View>

              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Progress</Text>
                <Text style={styles.statValue}>
                  {total > 0 ? Math.min(100, Math.round(((task.receivedBytes || 0) / total) * 100)) : 0}%
                </Text>
                <Text style={styles.statSub}>Continuous</Text>
              </View>

              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Live Speed</Text>
                <Text style={styles.statValue}>{formatSpeed(task.speed) || '0 B/s'}</Text>
                <Text style={styles.statSub}>Smoothed</Text>
              </View>
            </View>

            {/* Segment Map Visual Timeline Bar */}
            <View style={styles.timelineCard}>
              <View style={styles.timelineHeader}>
                <Text style={styles.sectionTitle}>Visual Segment Stream</Text>
                <Text style={styles.timelineMeta}>
                  {formatBytes(task.receivedBytes)} / {formatBytes(task.totalBytes)}
                </Text>
              </View>

              <View style={styles.segmentMapTrack}>
                {segments.map((seg, idx) => {
                  const segLen = seg.end !== null ? seg.end - seg.start + 1 : total / segments.length;
                  const pct = total > 0 ? (segLen / total) * 100 : 100 / segments.length;
                  const donePct = segLen > 0 ? Math.min(100, (seg.received / segLen) * 100) : 0;
                  const isActive =
                    task.status === 'downloading' &&
                    seg.end !== null &&
                    seg.received > 0 &&
                    seg.received < seg.end - seg.start + 1;

                  return (
                    <View
                      key={seg.part || idx}
                      style={[
                        styles.segmentChunk,
                        { width: `${pct}%` },
                      ]}
                    >
                      <View
                        style={[
                          styles.segmentFill,
                          {
                            width: `${donePct}%`,
                            backgroundColor:
                              donePct >= 100
                                ? '#22c55e'
                                : isActive
                                ? '#38bdf8'
                                : '#334155',
                          },
                        ]}
                      />
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Detailed Stream Connection Card */}
            <View style={styles.threadsCard}>
              <Text style={styles.sectionTitle}>Stream Connection Details</Text>

              <View style={styles.threadRow}>
                <View style={styles.threadInfo}>
                  <View style={styles.threadTitleRow}>
                    <Text style={styles.threadPartName}>Primary HTTP Stream</Text>
                    <View
                      style={[
                        styles.badge,
                        task.status === 'completed'
                          ? styles.badgeDone
                          : task.status === 'downloading'
                          ? styles.badgeActive
                          : styles.badgeWaiting,
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          task.status === 'completed'
                            ? styles.badgeTextDone
                            : task.status === 'downloading'
                            ? styles.badgeTextActive
                            : styles.badgeTextWaiting,
                        ]}
                      >
                        {task.status === 'completed' ? 'Done' : task.status === 'downloading' ? 'Streaming' : task.status}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.threadRange}>
                    0 B → {formatBytes(task.totalBytes)}
                  </Text>

                  {/* Progress line */}
                  <View style={styles.threadProgressContainer}>
                    <View style={styles.threadProgressBar}>
                      <View
                        style={[
                          styles.threadProgressFill,
                          {
                            width: `${total > 0 ? Math.min(100, Math.round(((task.receivedBytes || 0) / total) * 100)) : 0}%`,
                            backgroundColor: task.status === 'completed' ? '#22c55e' : '#0284c7',
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.threadProgressLabelRow}>
                      <Text style={styles.threadProgressBytes}>
                        {formatBytes(task.receivedBytes)} / {formatBytes(task.totalBytes)}
                      </Text>
                      <Text style={styles.threadProgressPct}>
                        {total > 0 ? Math.min(100, Math.round(((task.receivedBytes || 0) / total) * 100)) : 0}%
                      </Text>
                    </View>
                  </View>

                  <Text style={{ fontSize: 11, color: '#64748b', marginTop: 10, lineHeight: 16 }}>
                    Mobile runs an honest single HTTP stream with byte-range resume capability to preserve battery life and memory. Multi-connection segmented chunk engines are supported on GRabbit Desktop.
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>Close Inspector</Text>
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
    maxHeight: '90%',
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
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  body: {
    maxHeight: 520,
  },
  bodyContent: {
    padding: 16,
    gap: 16,
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: '#94a3b8',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#38bdf8',
    marginVertical: 4,
  },
  statSub: {
    fontSize: 10,
    color: '#64748b',
  },
  timelineCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  timelineMeta: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  segmentMapTrack: {
    height: 24,
    backgroundColor: '#090d16',
    borderRadius: 6,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  segmentChunk: {
    height: '100%',
    borderRightWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#090d16',
  },
  segmentFill: {
    height: '100%',
  },
  threadsCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  threadRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  threadInfo: {
    gap: 4,
  },
  threadTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  threadPartName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  threadRange: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  threadProgressContainer: {
    marginTop: 4,
    gap: 2,
  },
  threadProgressBar: {
    height: 6,
    backgroundColor: '#090d16',
    borderRadius: 3,
    overflow: 'hidden',
  },
  threadProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  threadProgressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  threadProgressBytes: {
    fontSize: 10,
    color: '#64748b',
  },
  threadProgressPct: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeDone: {
    backgroundColor: '#064e3b',
  },
  badgeTextDone: {
    color: '#4ade80',
    fontSize: 10,
    fontWeight: '700',
  },
  badgeActive: {
    backgroundColor: '#0369a1',
  },
  badgeTextActive: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '700',
  },
  badgeWaiting: {
    backgroundColor: '#334155',
  },
  badgeTextWaiting: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
  },
  badgeText: {},
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  doneBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});

