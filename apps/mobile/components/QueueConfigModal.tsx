import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DownloadQueue, QueueAfterAction } from '@grabbit/types';

interface QueueConfigModalProps {
  visible: boolean;
  queue?: DownloadQueue | null;
  onClose: () => void;
  onSave: (queueId: string | null, data: Partial<DownloadQueue>) => void;
  onDelete?: (queueId: string) => void;
}

export function QueueConfigModal({
  visible,
  queue,
  onClose,
  onSave,
  onDelete,
}: QueueConfigModalProps) {
  const isNew = !queue;
  const [name, setName] = useState('');
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [startTime, setStartTime] = useState('02:00');
  const [stopTime, setStopTime] = useState('08:00');
  const [afterQueue, setAfterQueue] = useState<QueueAfterAction>('stopQueue');

  useEffect(() => {
    if (queue) {
      setName(queue.name);
      setMaxConcurrent(queue.maxConcurrent || 2);
      setScheduleEnabled(queue.scheduler?.enabled || false);
      setStartTime(queue.scheduler?.startTime || '02:00');
      setStopTime(queue.scheduler?.stopTime || '08:00');
      setAfterQueue(queue.afterQueue || 'stopQueue');
    } else {
      setName('');
      setMaxConcurrent(2);
      setScheduleEnabled(false);
      setStartTime('02:00');
      setStopTime('08:00');
      setAfterQueue('stopQueue');
    }
  }, [queue, visible]);

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter a queue name');
      return;
    }

    onSave(queue ? queue.id : null, {
      name: name.trim(),
      maxConcurrent,
      scheduler: {
        enabled: scheduleEnabled,
        startTime: startTime.trim() || '02:00',
        stopTime: stopTime.trim() || '08:00',
      },
      afterQueue,
    });
    onClose();
  };

  const handleDelete = () => {
    if (!queue || queue.id === 'main') return;
    Alert.alert(
      'Delete Queue',
      `Are you sure you want to delete "${queue.name}"? Tasks will be moved to the Main Queue.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            onDelete?.(queue.id);
            onClose();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="layers-outline" size={20} color="#38bdf8" />
              <Text style={styles.title}>{isNew ? 'New Download Queue' : 'Configure Queue'}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {/* Form */}
          <View style={styles.body}>
            {/* Queue Name */}
            <View style={styles.field}>
              <Text style={styles.label}>Queue Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Night Queue, High Priority"
                placeholderTextColor="#64748b"
                editable={queue?.id !== 'main'}
              />
            </View>

            {/* Max Concurrent Stepper */}
            <View style={styles.field}>
              <Text style={styles.label}>Max Concurrent Downloads: {maxConcurrent}</Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity
                  style={[styles.stepperBtn, maxConcurrent <= 1 && styles.stepperBtnDisabled]}
                  onPress={() => setMaxConcurrent(Math.max(1, maxConcurrent - 1))}
                  disabled={maxConcurrent <= 1}
                >
                  <Ionicons name="remove" size={18} color="#ffffff" />
                </TouchableOpacity>

                <Text style={styles.stepperValue}>{maxConcurrent}</Text>

                <TouchableOpacity
                  style={[styles.stepperBtn, maxConcurrent >= 8 && styles.stepperBtnDisabled]}
                  onPress={() => setMaxConcurrent(Math.min(8, maxConcurrent + 1))}
                  disabled={maxConcurrent >= 8}
                >
                  <Ionicons name="add" size={18} color="#ffffff" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Daily Schedule Card */}
            <View style={styles.scheduleCard}>
              <View style={styles.scheduleHeader}>
                <View style={styles.scheduleTitleRow}>
                  <Ionicons name="time-outline" size={18} color="#38bdf8" />
                  <Text style={styles.scheduleTitle}>Daily Scheduled Window</Text>
                </View>
                <Switch
                  value={scheduleEnabled}
                  onValueChange={setScheduleEnabled}
                  thumbColor={scheduleEnabled ? '#38bdf8' : '#64748b'}
                  trackColor={{ false: '#334155', true: '#0284c7' }}
                />
              </View>

              {scheduleEnabled && (
                <View style={styles.timeInputsRow}>
                  <View style={styles.timeInputCol}>
                    <Text style={styles.timeLabel}>Start At (HH:MM)</Text>
                    <TextInput
                      style={styles.timeInput}
                      value={startTime}
                      onChangeText={setStartTime}
                      placeholder="02:00"
                      placeholderTextColor="#64748b"
                      maxLength={5}
                    />
                  </View>

                  <Ionicons name="arrow-forward" size={18} color="#64748b" style={{ marginTop: 18 }} />

                  <View style={styles.timeInputCol}>
                    <Text style={styles.timeLabel}>Stop At (HH:MM)</Text>
                    <TextInput
                      style={styles.timeInput}
                      value={stopTime}
                      onChangeText={setStopTime}
                      placeholder="08:00"
                      placeholderTextColor="#64748b"
                      maxLength={5}
                    />
                  </View>
                </View>
              )}
            </View>

            {/* Post-Completion Action */}
            <View style={styles.field}>
              <Text style={styles.label}>After Queue Completes</Text>
              <View style={styles.actionSegment}>
                <TouchableOpacity
                  style={[styles.actionBtn, afterQueue === 'stopQueue' && styles.actionBtnActive]}
                  onPress={() => setAfterQueue('stopQueue')}
                >
                  <Text style={[styles.actionBtnText, afterQueue === 'stopQueue' && styles.actionBtnTextActive]}>
                    Stop Queue
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, afterQueue === 'none' && styles.actionBtnActive]}
                  onPress={() => setAfterQueue('none')}
                >
                  <Text style={[styles.actionBtnText, afterQueue === 'none' && styles.actionBtnTextActive]}>
                    Keep Running
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            {!isNew && queue?.id !== 'main' && (
              <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                <Ionicons name="trash-outline" size={16} color="#ef4444" />
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Save</Text>
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
  headerLeft: {
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
    padding: 16,
    gap: 16,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
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
    fontSize: 14,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepperBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#38bdf8',
    minWidth: 24,
    textAlign: 'center',
  },
  scheduleCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  scheduleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scheduleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scheduleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  timeInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  timeInputCol: {
    flex: 1,
    gap: 4,
  },
  timeLabel: {
    fontSize: 11,
    color: '#94a3b8',
  },
  timeInput: {
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  actionSegment: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 4,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  actionBtnActive: {
    backgroundColor: '#0284c7',
  },
  actionBtnText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  actionBtnTextActive: {
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
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  deleteBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  cancelBtnText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  saveBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});

