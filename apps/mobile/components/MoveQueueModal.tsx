import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DownloadQueue } from '@grabbit/types';
import { MobileDownloadTask } from '../services/download-manager';

interface MoveQueueModalProps {
  visible: boolean;
  task: MobileDownloadTask | null;
  queues: DownloadQueue[];
  onClose: () => void;
  onSelectQueue: (taskId: string, targetQueueId: string) => void;
}

export function MoveQueueModal({
  visible,
  task,
  queues,
  onClose,
  onSelectQueue,
}: MoveQueueModalProps) {
  if (!task) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="swap-horizontal-outline" size={20} color="#38bdf8" />
              <Text style={styles.title}>Move to Queue</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={styles.taskTitle} numberOfLines={1}>
              {task.title}
            </Text>

            <View style={styles.queueList}>
              {queues.map((q) => {
                const isCurrent = (task.queueId || 'main') === q.id;
                return (
                  <TouchableOpacity
                    key={q.id}
                    style={[styles.queueItem, isCurrent && styles.queueItemCurrent]}
                    disabled={isCurrent}
                    onPress={() => {
                      onSelectQueue(task.id, q.id);
                      onClose();
                    }}
                  >
                    <Ionicons
                      name="layers-outline"
                      size={18}
                      color={isCurrent ? '#38bdf8' : '#94a3b8'}
                    />
                    <Text
                      style={[
                        styles.queueName,
                        isCurrent && styles.queueNameCurrent,
                      ]}
                    >
                      {q.name}
                    </Text>
                    {isCurrent && (
                      <Text style={styles.currentBadge}>Current</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
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
    padding: 24,
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
    gap: 12,
  },
  taskTitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 4,
  },
  queueList: {
    gap: 8,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    borderRadius: 10,
  },
  queueItemCurrent: {
    borderColor: '#38bdf8',
    backgroundColor: '#0369a126',
  },
  queueName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
  },
  queueNameCurrent: {
    color: '#38bdf8',
  },
  currentBadge: {
    fontSize: 11,
    color: '#38bdf8',
    fontWeight: 'bold',
  },
});

