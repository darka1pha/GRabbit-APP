import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  Platform,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Category, CATEGORIES, DownloadQueue } from '@grabbit/types';
import { useDownloads } from '../hooks/useDownloads';
import { MobileDownloadTask } from '../services/download-manager';
import { MediaCard } from './MediaCard';
import { SegmentInspectorModal } from './SegmentInspectorModal';
import { QueueConfigModal } from './QueueConfigModal';
import { MoveQueueModal } from './MoveQueueModal';
import { ChecksumModal } from './ChecksumModal';
import { AddDownloadModal } from './AddDownloadModal';
import { useI18n } from '../hooks/useI18n';
import { hapticLight, hapticMedium, hapticSuccess } from '../services/haptics';

type StatusFilter = 'all' | 'active' | 'queued' | 'completed' | 'failed';

interface DownloadsViewProps {
  onPlayMedia: (task: MobileDownloadTask) => void;
  onOpenInGrab?: (url: string) => void;
}

export function DownloadsView({ onPlayMedia, onOpenInGrab }: DownloadsViewProps) {
  const { t, isRtl, formatSpeed } = useI18n();
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
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Selection mode for long-press multi-select (Item 6.5)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  // Pull-to-refresh
  const handleRefresh = useCallback(async () => {
    void hapticLight();
    setIsRefreshing(true);
    try {
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Multi-select actions
  const handleLongPress = useCallback((id: string) => {
    void hapticMedium();
    setSelectionMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    void hapticLight();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    void hapticLight();
    setSelectedIds(new Set(filteredTasks.map((t) => t.id)));
  }, [filteredTasks]);

  const handleDeselectAll = useCallback(() => {
    void hapticLight();
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  const handleBulkPause = useCallback(async () => {
    void hapticLight();
    for (const id of selectedIds) {
      await pauseDownload(id);
    }
    void hapticSuccess();
  }, [selectedIds, pauseDownload]);

  const handleBulkResume = useCallback(async () => {
    void hapticLight();
    for (const id of selectedIds) {
      await resumeDownload(id);
    }
    void hapticSuccess();
  }, [selectedIds, resumeDownload]);

  const handleBulkDelete = useCallback(() => {
    void hapticLight();
    Alert.alert(
      t('mobile.deleteConfirm'),
      t('dl.confirmRemove', { count: selectedIds.size }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.ok'),
          style: 'destructive',
          onPress: async () => {
            for (const id of selectedIds) {
              await deleteDownload(id);
            }
            setSelectedIds(new Set());
            setSelectionMode(false);
            void hapticSuccess();
          },
        },
      ]
    );
  }, [selectedIds, deleteDownload, t]);

  const keyExtractor = useCallback((item: MobileDownloadTask) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: MobileDownloadTask }) => {
      const queue = queues.find((q) => q.id === (item.queueId || 'main'));
      return (
        <MediaCard
          task={item}
          queueName={selectedQueueId === 'all' ? queue?.name : undefined}
          selectionMode={selectionMode}
          isSelected={selectedIds.has(item.id)}
          onToggleSelect={handleToggleSelect}
          onLongPress={handleLongPress}
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
    },
    [
      queues,
      selectedQueueId,
      selectionMode,
      selectedIds,
      handleToggleSelect,
      handleLongPress,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      onPlayMedia,
      saveToLibrary,
      deleteDownload,
    ]
  );

  const getCategoryLabel = useCallback(
    (cat: Category | 'all'): string => {
      if (cat === 'all') return t('cat.all');
      const key = `cat.${cat}` as any;
      return t(key) || cat;
    },
    [t]
  );

  const getStatusLabel = useCallback(
    (st: StatusFilter): string => {
      const key = `filter.${st}` as any;
      return t(key) || st;
    },
    [t]
  );

  const renderHeader = useMemo(() => {
    return (
      <View style={{ gap: 14 }}>
        {/* Header with Title & Speed */}
        <View style={[styles.topHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View style={{ alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
            <Text style={styles.viewTitle}>{t('dl.title')}</Text>
            <Text style={styles.viewSubtitle}>
              {counts.all} {t('queue.items', { count: counts.all })} • {counts.active} {t('dl.statusActive')}
            </Text>
          </View>

          {counts.active > 0 && (
            <View style={styles.speedBadge}>
              <Ionicons name="speedometer-outline" size={14} color="#6366f1" />
              <Text style={styles.speedText}>{formatSpeed(totalSpeed) || '0 B/s'}</Text>
            </View>
          )}
        </View>

        {/* Search Input */}
        <View style={[styles.searchRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Ionicons name="search" size={16} color="#64748b" />
          <TextInput
            style={[styles.searchInput, { textAlign: isRtl ? 'right' : 'left' }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('dl.searchPlaceholder')}
            placeholderTextColor="#64748b"
            accessibilityLabel={t('dl.searchPlaceholder')}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.searchClearBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.clear')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={16} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Multiple Queues Bar */}
        <View style={styles.sectionBlock}>
          <View style={[styles.sectionRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <Text style={styles.sectionLabel}>{t('queue.title')}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
            {/* All Queues Pill */}
            <TouchableOpacity
              style={[styles.queueTab, selectedQueueId === 'all' && styles.queueTabActive]}
              onPress={() => {
                void hapticLight();
                setSelectedQueueId('all');
              }}
              accessibilityRole="button"
              accessibilityLabel={t('queue.all')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="layers-outline" size={14} color={selectedQueueId === 'all' ? '#ffffff' : '#94a3b8'} />
              <Text style={[styles.queueTabText, selectedQueueId === 'all' && styles.queueTabTextActive]}>
                {t('queue.all')}
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
                    onPress={() => {
                      void hapticLight();
                      setSelectedQueueId(q.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={q.name}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
                    onPress={() => {
                      void hapticLight();
                      q.enabled ? stopQueue(q.id) : startQueue(q.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={q.enabled ? t('queue.stop') : t('queue.start')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={q.enabled ? 'pause' : 'play'}
                      size={12}
                      color={q.enabled ? '#eab308' : '#6366f1'}
                    />
                  </TouchableOpacity>

                  {/* Queue Settings Trigger */}
                  <TouchableOpacity
                    style={styles.queueActionBtn}
                    onPress={() => {
                      void hapticLight();
                      setQueueModalConfig({ visible: true, queue: q });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('queue.edit')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="settings-outline" size={12} color="#94a3b8" />
                  </TouchableOpacity>
                </View>
              );
            })}

            {/* New Queue Button */}
            <TouchableOpacity
              style={styles.addQueueBtn}
              onPress={() => {
                void hapticLight();
                setQueueModalConfig({ visible: true, queue: null });
              }}
              accessibilityRole="button"
              accessibilityLabel={t('queue.new')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="add" size={15} color="#6366f1" />
              <Text style={styles.addQueueText}>{t('queue.new')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Category Filter Chips Bar */}
        <View style={styles.sectionBlock}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
            <TouchableOpacity
              style={[styles.categoryChip, selectedCategory === 'all' && styles.categoryChipActive]}
              onPress={() => {
                void hapticLight();
                setSelectedCategory('all');
              }}
              accessibilityRole="button"
              accessibilityLabel={t('cat.all')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.categoryChipText, selectedCategory === 'all' && styles.categoryChipTextActive]}>
                {getCategoryLabel('all')} ({categoryCounts['all'] || 0})
              </Text>
            </TouchableOpacity>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryChip, selectedCategory === cat && styles.categoryChipActive]}
                onPress={() => {
                  void hapticLight();
                  setSelectedCategory(cat);
                }}
                accessibilityRole="button"
                accessibilityLabel={getCategoryLabel(cat)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.categoryChipText, selectedCategory === cat && styles.categoryChipTextActive]}>
                  {getCategoryLabel(cat)} ({categoryCounts[cat] || 0})
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Action Toolbar */}
        <View style={[styles.toolbar, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => {
              void hapticLight();
              setAddModalVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('dl.add')}
          >
            <Ionicons name="add" size={16} color="#ffffff" />
            <Text style={styles.addBtnText}>{t('dl.add')}</Text>
          </TouchableOpacity>

          <View style={styles.toolbarDivider} />

          <TouchableOpacity
            style={styles.toolBtn}
            onPress={() => {
              void hapticLight();
              void resumeAll();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('dl.resumeAll')}
          >
            <Ionicons name="play" size={14} color="#6366f1" />
            <Text style={styles.toolBtnText}>{t('dl.resumeAll')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolBtn}
            onPress={() => {
              void hapticLight();
              void pauseAll();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('dl.pauseAll')}
          >
            <Ionicons name="pause" size={14} color="#eab308" />
            <Text style={styles.toolBtnText}>{t('dl.pauseAll')}</Text>
          </TouchableOpacity>

          {counts.failed > 0 && (
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => {
                void hapticLight();
                void retryFailed();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('dl.retry')}
            >
              <Ionicons name="refresh" size={14} color="#ef4444" />
              <Text style={styles.toolBtnText}>{t('dl.retry')}</Text>
            </TouchableOpacity>
          )}

          {counts.completed > 0 && (
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => {
                void hapticLight();
                void clearCompleted();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('dl.clearCompleted')}
            >
              <Ionicons name="trash-outline" size={14} color="#94a3b8" />
              <Text style={styles.toolBtnText}>{t('dl.clearCompleted')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Status Segment Filters */}
        <View style={styles.statusSegment}>
          {(['all', 'active', 'queued', 'completed', 'failed'] as StatusFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.statusBtn, statusFilter === f && styles.statusBtnActive]}
              onPress={() => {
                void hapticLight();
                setStatusFilter(f);
              }}
              accessibilityRole="button"
              accessibilityLabel={getStatusLabel(f)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.statusBtnText, statusFilter === f && styles.statusBtnTextActive]}>
                {getStatusLabel(f)} ({counts[f]})
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }, [
    counts,
    totalSpeed,
    searchQuery,
    selectedQueueId,
    queueCounts,
    queues,
    selectedCategory,
    categoryCounts,
    resumeAll,
    pauseAll,
    retryFailed,
    clearCompleted,
    statusFilter,
    stopQueue,
    startQueue,
    t,
    isRtl,
    formatSpeed,
    getCategoryLabel,
    getStatusLabel,
  ]);

  const renderEmpty = useCallback(() => {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="cloud-download-outline" size={48} color="#233253" />
        <Text style={styles.emptyTitle}>{t('dl.empty')}</Text>
        <Text style={styles.emptySubtitle}>{t('dl.emptyHint')}</Text>
      </View>
    );
  }, [t]);

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredTasks}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.content}
        initialNumToRender={8}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#6366f1"
            colors={['#6366f1']}
          />
        }
      />

      {/* Floating Multi-Select Bar (Item 6.5) */}
      {selectionMode && (
        <View style={[styles.selectionBar, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.selectionCount}>
              {t('mobile.selectedCount', { count: selectedIds.size })}
            </Text>
            <TouchableOpacity
              onPress={selectedIds.size === filteredTasks.length ? handleDeselectAll : handleSelectAll}
              style={styles.selectionSubBtn}
              accessibilityRole="button"
              accessibilityLabel={selectedIds.size === filteredTasks.length ? t('grab.selectNone') : t('grab.selectAll')}
            >
              <Text style={styles.selectionSubText}>
                {selectedIds.size === filteredTasks.length ? t('grab.selectNone') : t('grab.selectAll')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              onPress={handleBulkResume}
              style={styles.selectionActionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('dl.resume')}
            >
              <Ionicons name="play" size={16} color="#6366f1" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleBulkPause}
              style={styles.selectionActionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('dl.pause')}
            >
              <Ionicons name="pause" size={16} color="#eab308" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleBulkDelete}
              style={styles.selectionActionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('dl.remove')}
            >
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleDeselectAll}
              style={[styles.selectionActionBtn, { backgroundColor: '#233253' }]}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={16} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  content: {
    padding: 16,
    gap: 14,
    paddingBottom: 70,
  },
  topHeader: {
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
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderWidth: 1,
    borderColor: '#6366f1',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  speedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6366f1',
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: '#131b2e',
    borderWidth: 1,
    borderColor: '#233253',
    borderRadius: 8,
    paddingHorizontal: 12,
    gap: 8,
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 13,
  },
  searchClearBtn: {
    padding: 4,
    minHeight: 36,
    minWidth: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionBlock: {
    gap: 6,
  },
  sectionRow: {
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
    backgroundColor: '#131b2e',
    borderWidth: 1,
    borderColor: '#233253',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    minHeight: 36,
  },
  queueTabActive: {
    backgroundColor: '#6366f1',
    borderColor: '#818cf8',
  },
  queueTabGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131b2e',
    borderWidth: 1,
    borderColor: '#233253',
    borderRadius: 16,
    marginRight: 8,
    paddingRight: 4,
    minHeight: 36,
  },
  queueTabGroupActive: {
    borderColor: '#6366f1',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
  },
  queueTabMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 36,
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
    minHeight: 32,
    minWidth: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeCount: {
    backgroundColor: '#0b0f19',
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
    borderColor: '#6366f1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    minHeight: 36,
  },
  addQueueText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366f1',
  },
  categoryChip: {
    backgroundColor: '#131b2e',
    borderWidth: 1,
    borderColor: '#233253',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  categoryChipActive: {
    backgroundColor: '#6366f1',
    borderColor: '#818cf8',
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
    alignItems: 'center',
    backgroundColor: '#131b2e',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#233253',
    gap: 8,
    flexWrap: 'wrap',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#6366f1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    minHeight: 36,
  },
  addBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  toolbarDivider: {
    width: 1,
    height: 18,
    backgroundColor: '#233253',
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#0b0f19',
    minHeight: 34,
  },
  toolBtnText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '500',
  },
  statusSegment: {
    flexDirection: 'row',
    backgroundColor: '#131b2e',
    borderRadius: 8,
    padding: 3,
    borderWidth: 1,
    borderColor: '#233253',
  },
  statusBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  statusBtnActive: {
    backgroundColor: '#6366f1',
  },
  statusBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
  },
  statusBtnTextActive: {
    color: '#ffffff',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  selectionBar: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: '#131b2e',
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  selectionCount: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  selectionSubBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#1e2b48',
    borderRadius: 6,
  },
  selectionSubText: {
    fontSize: 11,
    color: '#6366f1',
    fontWeight: '600',
  },
  selectionActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#1e2b48',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
