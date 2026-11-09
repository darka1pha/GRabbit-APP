import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Category, CATEGORIES, DownloadQueue } from '@grabbit/types';
import { formatSpeed } from '@grabbit/utils';
import { useDownloads } from '../hooks/useDownloads';
import { MobileDownloadTask } from '../services/download-manager';
import { MediaCard } from './MediaCard';
import { SegmentInspectorModal } from './SegmentInspectorModal';
import { QueueConfigModal } from './QueueConfigModal';
import { MoveQueueModal } from './MoveQueueModal';
import { ChecksumModal } from './ChecksumModal';
import { AddDownloadModal } from './AddDownloadModal';

type StatusFilter = 'all' | 'active' | 'queued' | 'completed' | 'failed';

interface DownloadsViewProps {
  onPlayMedia: (task: MobileDownloadTask) => void;
  onOpenInGrab?: (url: string) => void;
}

export function DownloadsView({ onPlayMedia, onOpenInGrab }: DownloadsViewProps) {
  const {
    tasks,
    queues,
    totalSpeed,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteDownload,
    saveToLibrary,
    resumeAll,
    pauseAll,
    clearCompleted,
    retryFailed,
    createQueue,
    updateQueue,
    deleteQueue,
    startQueue,
    stopQueue,
    moveTaskToQueue,
  } = useDownloads();

  const [selectedQueueId, setSelectedQueueId] = useState<string | 'all'>('all');
  const [selectedCategory, setSelectedCategory] = useState<Category | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [inspectTask, setInspectTask] = useState<MobileDownloadTask | null>(null);
  const [queueModalConfig, setQueueModalConfig] = useState<{ visible: boolean; queue?: DownloadQueue | null }>({
    visible: false,
    queue: null,
  });
  const [moveQueueTask, setMoveQueueTask] = useState<MobileDownloadTask | null>(null);
  const [checksumTask, setChecksumTask] = useState<MobileDownloadTask | null>(null);

  // Filter pipeline
  const filteredTasks = useMemo(() => {
    let list = tasks;

    // Queue filter
    if (selectedQueueId !== 'all') {
      list = list.filter((t) => (t.queueId || 'main') === selectedQueueId);
    }

    // Category filter
    if (selectedCategory !== 'all') {
      list = list.filter((t) => t.category === selectedCategory);
    }

    // Status filter
    if (statusFilter === 'active') {
      list = list.filter((t) => t.status === 'downloading');
    } else if (statusFilter === 'queued') {
      list = list.filter((t) => t.status === 'queued' || t.status === 'paused');
    } else if (statusFilter === 'completed') {
      list = list.filter((t) => t.status === 'completed');
    } else if (statusFilter === 'failed') {
      list = list.filter((t) => t.status === 'error');
    }

    // Search query
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.url.toLowerCase().includes(q) ||
          (t.author && t.author.toLowerCase().includes(q)) ||
          t.fileName.toLowerCase().includes(q)
      );
    }

    return list;
  }, [tasks, selectedQueueId, selectedCategory, statusFilter, searchQuery]);

  // Counts
  const counts = useMemo(() => {
    return {
      all: tasks.length,
      active: tasks.filter((t) => t.status === 'downloading').length,
      queued: tasks.filter((t) => t.status === 'queued' || t.status === 'paused').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'error').length,
    };
  }, [tasks]);

  const queueCounts = useMemo(() => {
    const map: Record<string, number> = { all: tasks.length };
    for (const q of queues) map[q.id] = 0;
    for (const t of tasks) {
      const qId = t.queueId || 'main';
      map[qId] = (map[qId] ?? 0) + 1;
    }
    return map;
  }, [tasks, queues]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = { all: tasks.length };
    for (const c of CATEGORIES) map[c] = 0;
    for (const t of tasks) {
      map[t.category] = (map[t.category] ?? 0) + 1;
    }
    return map;
  }, [tasks]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header with Title & Speed */}
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.viewTitle}>Downloads Manager</Text>
          <Text style={styles.viewSubtitle}>
            {counts.all} tasks • {counts.active} downloading
          </Text>
        </View>

        {counts.active > 0 && (
          <View style={styles.speedBadge}>
            <Ionicons name="speedometer-outline" size={14} color="#38bdf8" />
            <Text style={styles.speedText}>{formatSpeed(totalSpeed) || '0 B/s'}</Text>
          </View>
        )}
      </View>

      {/* Search Input */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color="#64748b" />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search downloads by name, link, or author..."
          placeholderTextColor="#64748b"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClearBtn}>
            <Ionicons name="close-circle" size={16} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Multiple Queues Bar */}
      <View style={styles.sectionBlock}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>Download Queues</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
          {/* All Queues Pill */}
          <TouchableOpacity
            style={[styles.queueTab, selectedQueueId === 'all' && styles.queueTabActive]}
            onPress={() => setSelectedQueueId('all')}
          >
            <Ionicons name="layers-outline" size={14} color={selectedQueueId === 'all' ? '#ffffff' : '#94a3b8'} />
            <Text style={[styles.queueTabText, selectedQueueId === 'all' && styles.queueTabTextActive]}>
              All
            </Text>
            <View style={styles.badgeCount}>
              <Text style={styles.badgeCountText}>{queueCounts['all'] || 0}</Text>
            </View>
          </TouchableOpacity>

          {/* Individual Queue Pills */}
          {queues.map((q) => {
            const isSelected = selectedQueueId === q.id;
            return (
              <View key={q.id} style={[styles.queueTabGroup, isSelected && styles.queueTabGroupActive]}>
                <TouchableOpacity
                  style={styles.queueTabMain}
                  onPress={() => setSelectedQueueId(q.id)}
                >
                  <View
                    style={[
                      styles.queueDot,
                      { backgroundColor: q.enabled ? '#22c55e' : '#64748b' },
                    ]}
                  />
                  <Text style={[styles.queueTabText, isSelected && styles.queueTabTextActive]}>
                    {q.name}
                  </Text>
                  <View style={styles.badgeCount}>
                    <Text style={styles.badgeCountText}>{queueCounts[q.id] || 0}</Text>
                  </View>
                </TouchableOpacity>

                {/* Queue Start/Stop Button */}
                <TouchableOpacity
                  style={styles.queueActionBtn}
                  onPress={() => (q.enabled ? stopQueue(q.id) : startQueue(q.id))}
                >
                  <Ionicons
                    name={q.enabled ? 'pause' : 'play'}
                    size={12}
                    color={q.enabled ? '#eab308' : '#38bdf8'}
                  />
                </TouchableOpacity>

                {/* Queue Settings Trigger */}
                <TouchableOpacity
                  style={styles.queueActionBtn}
                  onPress={() => setQueueModalConfig({ visible: true, queue: q })}
                >
                  <Ionicons name="settings-outline" size={12} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            );
          })}

          {/* New Queue Button */}
          <TouchableOpacity
            style={styles.addQueueBtn}
            onPress={() => setQueueModalConfig({ visible: true, queue: null })}
          >
            <Ionicons name="add" size={15} color="#38bdf8" />
            <Text style={styles.addQueueText}>New Queue</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Category Filter Chips Bar */}
      <View style={styles.sectionBlock}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
          <TouchableOpacity
            style={[styles.categoryChip, selectedCategory === 'all' && styles.categoryChipActive]}
            onPress={() => setSelectedCategory('all')}
          >
            <Text style={[styles.categoryChipText, selectedCategory === 'all' && styles.categoryChipTextActive]}>
              All ({categoryCounts['all'] || 0})
            </Text>
          </TouchableOpacity>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.categoryChip, selectedCategory === cat && styles.categoryChipActive]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text style={[styles.categoryChipText, selectedCategory === cat && styles.categoryChipTextActive]}>
                {cat[0].toUpperCase() + cat.slice(1)} ({categoryCounts[cat] || 0})
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Action Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddModalVisible(true)}>
          <Ionicons name="add" size={16} color="#ffffff" />
          <Text style={styles.addBtnText}>Add Download</Text>
        </TouchableOpacity>

        <View style={styles.toolbarDivider} />

        <TouchableOpacity style={styles.toolBtn} onPress={resumeAll}>
          <Ionicons name="play" size={14} color="#38bdf8" />
          <Text style={styles.toolBtnText}>Resume All</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolBtn} onPress={pauseAll}>
          <Ionicons name="pause" size={14} color="#eab308" />
          <Text style={styles.toolBtnText}>Pause All</Text>
        </TouchableOpacity>

        {counts.failed > 0 && (
          <TouchableOpacity style={styles.toolBtn} onPress={retryFailed}>
            <Ionicons name="refresh" size={14} color="#ef4444" />
            <Text style={styles.toolBtnText}>Retry</Text>
          </TouchableOpacity>
        )}

        {counts.completed > 0 && (
          <TouchableOpacity style={styles.toolBtn} onPress={clearCompleted}>
            <Ionicons name="trash-outline" size={14} color="#94a3b8" />
            <Text style={styles.toolBtnText}>Clear Done</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Status Segment Filters */}
      <View style={styles.statusSegment}>
        {(['all', 'active', 'queued', 'completed', 'failed'] as StatusFilter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.statusBtn, statusFilter === f && styles.statusBtnActive]}
            onPress={() => setStatusFilter(f)}
          >
            <Text style={[styles.statusBtnText, statusFilter === f && styles.statusBtnTextActive]}>
              {f[0].toUpperCase() + f.slice(1)} ({counts[f]})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tasks List */}
      <View style={styles.tasksList}>
        {filteredTasks.map((t) => {
          const queue = queues.find((q) => q.id === (t.queueId || 'main'));
          return (
            <MediaCard
              key={t.id}
              task={t}
              queueName={selectedQueueId === 'all' ? queue?.name : undefined}
              onPause={pauseDownload}
              onResume={resumeDownload}
              onCancel={cancelDownload}
              onPlay={onPlayMedia}
              onSaveToLibrary={saveToLibrary}
              onDelete={deleteDownload}
              onInspectSegments={(task) => setInspectTask(task)}
              onMoveQueue={(task) => setMoveQueueTask(task)}
              onVerifyChecksum={(task) => setChecksumTask(task)}
            />
          );
        })}

        {filteredTasks.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="cloud-download-outline" size={48} color="#334155" />
            <Text style={styles.emptyTitle}>No downloads found</Text>
            <Text style={styles.emptySubtitle}>
              Tap "Add Download" above or grab links from YouTube, Spotify, and direct URLs!
            </Text>
          </View>
        )}
      </View>

      {/* Add Direct Download Modal */}
      <AddDownloadModal
        visible={addModalVisible}
        onClose={() => setAddModalVisible(false)}
        onOpenInGrab={onOpenInGrab}
      />

      {/* Segment Inspector Modal */}
      <SegmentInspectorModal
        visible={!!inspectTask}
        task={inspectTask}
        onClose={() => setInspectTask(null)}
      />

      {/* Queue Config Modal */}
      <QueueConfigModal
        visible={queueModalConfig.visible}
        queue={queueModalConfig.queue}
        onClose={() => setQueueModalConfig({ visible: false, queue: null })}
        onSave={(qId, data) => {
          if (qId) {
            updateQueue(qId, data);
          } else {
            createQueue(data.name || 'New Queue', data);
          }
        }}
        onDelete={(qId) => deleteQueue(qId)}
      />

      {/* Move Queue Modal */}
      <MoveQueueModal
        visible={!!moveQueueTask}
        task={moveQueueTask}
        queues={queues}
        onClose={() => setMoveQueueTask(null)}
        onSelectQueue={(taskId, targetQueueId) => moveTaskToQueue(taskId, targetQueueId)}
      />

      {/* Checksum Modal */}
      <ChecksumModal
        visible={!!checksumTask}
        task={checksumTask}
        onClose={() => setChecksumTask(null)}
      />
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
    gap: 14,
    paddingBottom: 40,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  viewTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  viewSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  speedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0369a126',
    borderWidth: 1,
    borderColor: '#38bdf866',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  speedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38bdf8',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 13,
  },
  searchClearBtn: {
    padding: 4,
  },
  sectionBlock: {
    gap: 6,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
  },
  horizontalScroll: {
    flexDirection: 'row',
  },
  queueTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  queueTabActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  queueTabGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 16,
    marginRight: 8,
    paddingRight: 4,
  },
  queueTabGroupActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0369a133',
  },
  queueTabMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  queueDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  queueTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  queueTabTextActive: {
    color: '#ffffff',
  },
  queueActionBtn: {
    padding: 4,
  },
  badgeCount: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeCountText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#cbd5e1',
  },
  addQueueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#38bdf8',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  addQueueText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#38bdf8',
  },
  categoryChip: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 6,
  },
  categoryChipActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  categoryChipTextActive: {
    color: '#ffffff',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 8,
    flexWrap: 'wrap',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0284c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  addBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  toolbarDivider: {
    width: 1,
    height: 18,
    backgroundColor: '#334155',
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#0f172a',
  },
  toolBtnText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '500',
  },
  statusSegment: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 3,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statusBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 6,
  },
  statusBtnActive: {
    backgroundColor: '#0284c7',
  },
  statusBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
  },
  statusBtnTextActive: {
    color: '#ffffff',
  },
  tasksList: {
    gap: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: '#64748b',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#475569',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
});
