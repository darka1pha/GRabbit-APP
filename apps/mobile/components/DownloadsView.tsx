import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Category,
  CATEGORIES,
  DownloadItem,
  DownloadQueue,
  DownloadsAggregate,
} from '@grabbit/types';
import { useDownloads } from '../hooks/useDownloads';
import { MobileDownloadTask } from '../services/download-manager';
import { mobileBridge } from '../services/bridge';
import { MediaCard } from './MediaCard';
import { SegmentInspectorModal } from './SegmentInspectorModal';
import { QueueConfigModal } from './QueueConfigModal';
import { MoveQueueModal } from './MoveQueueModal';
import { ChecksumModal } from './ChecksumModal';
import { AddDownloadModal } from './AddDownloadModal';
import { PairingModal } from './PairingModal';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '../hooks/useTheme';
import { ThemeColors } from '../constants/theme';
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from '../services/haptics';

type StatusFilter = 'all' | 'active' | 'queued' | 'completed' | 'failed';
type DeviceMode = 'local' | 'desktop';

interface DownloadsViewProps {
  onPlayMedia: (task: MobileDownloadTask) => void;
  onOpenInGrab?: (url: string) => void;
}

export function DownloadsView({ onPlayMedia, onOpenInGrab }: DownloadsViewProps) {
  const { t, isRtl, textDirStyle, formatSpeed, formatBytes } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    tasks,
    queues,
    totalSpeed,
    startHttpDownload,
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
    refresh,
  } = useDownloads();

  const [deviceMode, setDeviceMode] = useState<DeviceMode>('local');
  const [selectedQueueId, setSelectedQueueId] = useState<string | 'all'>('all');
  const [selectedCategory, setSelectedCategory] = useState<Category | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Desktop PC remote state
  const [desktopItems, setDesktopItems] = useState<DownloadItem[]>([]);
  const [desktopQueues, setDesktopQueues] = useState<DownloadQueue[]>([]);
  const [desktopAggregate, setDesktopAggregate] = useState<DownloadsAggregate | null>(null);
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [desktopLoading, setDesktopLoading] = useState(false);

  // Selection mode for long-press multi-select
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals / Sheets
  const [filtersSheetVisible, setFiltersSheetVisible] = useState(false);
  const [pairingVisible, setPairingVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [inspectTask, setInspectTask] = useState<MobileDownloadTask | null>(null);
  const [queueModalConfig, setQueueModalConfig] = useState<{
    visible: boolean;
    queue?: DownloadQueue | null;
  }>({
    visible: false,
    queue: null,
  });
  const [moveQueueTask, setMoveQueueTask] = useState<MobileDownloadTask | null>(null);
  const [checksumTask, setChecksumTask] = useState<MobileDownloadTask | null>(null);

  const fetchDesktopState = useCallback(async (showSpinner = false) => {
    if (showSpinner) setDesktopLoading(true);
    const [dlRes, qRes] = await Promise.all([
      mobileBridge.getDesktopDownloads(),
      mobileBridge.getDesktopQueues(),
    ]);
    if (dlRes.ok) {
      setDesktopItems(dlRes.items);
      setDesktopAggregate(dlRes.aggregate ?? null);
      setDesktopError(null);
    } else {
      setDesktopError(dlRes.error || t('mobile.pcNotPaired'));
    }
    if (qRes.ok) {
      setDesktopQueues(qRes.queues);
    }
    if (showSpinner) setDesktopLoading(false);
  }, [t]);

  useEffect(() => {
    if (deviceMode !== 'desktop') return;
    void fetchDesktopState(true);
    const timer = setInterval(() => {
      void fetchDesktopState(false);
    }, 3000);
    return () => clearInterval(timer);
  }, [deviceMode, fetchDesktopState]);

  // Filter pipeline (shared helper for status + category + query filters)
  const applyCommonFilters = useCallback(
    <T extends { status: string; category: Category; fileName: string; url: string; queueId?: string }>(
      source: T[],
      getTitle: (item: T) => string,
      getAuthor: (item: T) => string | undefined
    ): T[] => {
      let list = source;
      if (selectedQueueId !== 'all') {
        list = list.filter((it) => (it.queueId || 'main') === selectedQueueId);
      }
      if (selectedCategory !== 'all') {
        list = list.filter((it) => it.category === selectedCategory);
      }
      if (statusFilter === 'active') {
        list = list.filter(
          (it) =>
            it.status === 'downloading' ||
            it.status === 'starting' ||
            it.status === 'processing'
        );
      } else if (statusFilter === 'queued') {
        list = list.filter((it) => it.status === 'queued' || it.status === 'paused');
      } else if (statusFilter === 'completed') {
        list = list.filter((it) => it.status === 'completed');
      } else if (statusFilter === 'failed') {
        list = list.filter((it) => it.status === 'error');
      }

      const q = searchQuery.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (it) =>
            getTitle(it).toLowerCase().includes(q) ||
            it.url.toLowerCase().includes(q) ||
            (getAuthor(it)?.toLowerCase().includes(q) ?? false) ||
            it.fileName.toLowerCase().includes(q)
        );
      }
      return list;
    },
    [selectedQueueId, selectedCategory, statusFilter, searchQuery]
  );

  const filteredTasks = useMemo(
    () => applyCommonFilters(tasks, (it) => it.title, (it) => it.author),
    [applyCommonFilters, tasks]
  );

  const filteredDesktopItems = useMemo(
    () =>
      applyCommonFilters(
        desktopItems,
        (it) => it.media?.title || it.fileName,
        (it) => it.media?.author
      ),
    [applyCommonFilters, desktopItems]
  );

  // Counts
  const activeSourceCount = deviceMode === 'local' ? tasks.length : desktopItems.length;
  const activeCountValue =
    deviceMode === 'local'
      ? tasks.filter((it) => it.status === 'downloading').length
      : desktopItems.filter((it) => it.status === 'downloading').length;

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
    for (const task of tasks) {
      const qId = task.queueId || 'main';
      map[qId] = (map[qId] ?? 0) + 1;
    }
    return map;
  }, [tasks, queues]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = { all: tasks.length };
    for (const c of CATEGORIES) map[c] = 0;
    for (const task of tasks) {
      map[task.category] = (map[task.category] ?? 0) + 1;
    }
    return map;
  }, [tasks]);

  const activeFilterCount =
    (selectedQueueId !== 'all' ? 1 : 0) +
    (selectedCategory !== 'all' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0);

  const displayedSpeed =
    deviceMode === 'local' ? totalSpeed : desktopAggregate?.speed ?? 0;

  const handleRefresh = useCallback(async () => {
    void hapticLight();
    setIsRefreshing(true);
    try {
      if (deviceMode === 'desktop') {
        await fetchDesktopState(false);
      } else {
        refresh();
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [deviceMode, fetchDesktopState, refresh]);

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

  const handlePullToPhone = useCallback(
    async (item: DownloadItem) => {
      const pullReq = mobileBridge.getDesktopFilePullRequest(item);
      if (!pullReq) {
        setPairingVisible(true);
        return;
      }
      try {
        void hapticSuccess();
        await startHttpDownload({
          url: pullReq.url,
          fileName: pullReq.fileName,
          headers: pullReq.headers,
        });
        Alert.alert(
          t('dl.transferReady'),
          `${t('mobile.transferStarted')}\n${pullReq.fileName}`,
          [
            { text: t('common.ok'), style: 'cancel' },
            {
              text: t('mobile.localDevice'),
              onPress: () => setDeviceMode('local'),
            },
          ]
        );
      } catch (err: any) {
        void hapticError();
        Alert.alert(t('dl.error'), err?.message || t('err.NETWORK'));
      }
    },
    [startHttpDownload, t]
  );

  const handleRemoteAction = useCallback(
    async (fn: () => Promise<{ success: boolean; error?: string }>) => {
      void hapticLight();
      const res = await fn();
      if (!res.success && res.error) {
        void hapticError();
        Alert.alert(t('dl.error'), res.error);
      } else {
        void fetchDesktopState(false);
      }
    },
    [fetchDesktopState, t]
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

  const renderLocalItem = useCallback(
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

  const renderDesktopItem = useCallback(
    ({ item }: { item: DownloadItem }) => {
      const isDownloading = item.status === 'downloading' || item.status === 'starting';
      const isPaused = item.status === 'paused' || item.status === 'queued';
      const isCompleted = item.status === 'completed';
      const isError = item.status === 'error';
      const pct =
        item.totalBytes && item.totalBytes > 0
          ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
          : Math.round(item.percent ?? 0);

      return (
        <View style={styles.desktopCard}>
          <View style={[styles.desktopCardTop, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
              <Text style={[styles.desktopFileName, textDirStyle]} numberOfLines={1}>
                {item.media?.title || item.fileName}
              </Text>
              <Text style={styles.desktopMeta}>
                {item.totalBytes
                  ? `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)} (${pct}%)`
                  : `${formatBytes(item.receivedBytes)}`}
                {isDownloading && item.speed > 0 ? ` • ${formatSpeed(item.speed)}` : ''}
              </Text>
            </View>
            <View style={styles.desktopStatusPill}>
              <Text style={styles.desktopStatusText}>{item.status.toUpperCase()}</Text>
            </View>
          </View>

          {!isCompleted && (
            <View style={styles.desktopProgressTrack}>
              <View
                style={[
                  styles.desktopProgressFill,
                  {
                    width: `${pct}%`,
                    backgroundColor: isError
                      ? colors.error
                      : isPaused
                      ? colors.warning
                      : colors.accent,
                  },
                ]}
              />
            </View>
          )}

          {isError && item.error ? (
            <Text style={[styles.desktopErrorText, textDirStyle]} numberOfLines={1}>
              {item.error}
            </Text>
          ) : null}

          <View
            style={[styles.desktopActionsRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
          >
            {isDownloading && (
              <TouchableOpacity
                style={styles.desktopActionBtn}
                onPress={() => handleRemoteAction(() => mobileBridge.pauseDesktopDownloads([item.id]))}
              >
                <Ionicons name="pause" size={14} color={colors.warning} />
                <Text style={[styles.desktopActionText, { color: colors.warning }]}>
                  {t('dl.pause')}
                </Text>
              </TouchableOpacity>
            )}
            {(isPaused || isError) && (
              <TouchableOpacity
                style={styles.desktopActionBtn}
                onPress={() => handleRemoteAction(() => mobileBridge.resumeDesktopDownloads([item.id]))}
              >
                <Ionicons name="play" size={14} color={colors.accent} />
                <Text style={[styles.desktopActionText, { color: colors.accent }]}>
                  {isError ? t('dl.retry') : t('dl.resume')}
                </Text>
              </TouchableOpacity>
            )}
            {isCompleted && (
              <TouchableOpacity
                style={[styles.desktopActionBtn, styles.desktopPrimaryBtn]}
                onPress={() => void handlePullToPhone(item)}
              >
                <Ionicons name="phone-portrait-outline" size={14} color="#ffffff" />
                <Text style={[styles.desktopActionText, { color: '#ffffff' }]}>
                  {t('mobile.pullToPhone')}
                </Text>
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.desktopActionBtn}
              onPress={() =>
                handleRemoteAction(() => mobileBridge.removeDesktopDownloads([item.id], false))
              }
            >
              <Ionicons name="trash-outline" size={14} color={colors.error} />
              <Text style={[styles.desktopActionText, { color: colors.error }]}>
                {t('dl.remove')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [
      styles,
      isRtl,
      textDirStyle,
      formatBytes,
      formatSpeed,
      colors,
      t,
      handleRemoteAction,
      handlePullToPhone,
    ]
  );

  const renderHeader = useMemo(() => {
    return (
      <View style={{ gap: 12 }}>
        {/* Compact Header Row: Title + Local/PC Switcher + Speed */}
        <View style={[styles.topHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View style={{ alignItems: isRtl ? 'flex-end' : 'flex-start', flex: 1 }}>
            <Text style={[styles.viewTitle, textDirStyle]}>{t('dl.title')}</Text>
            <Text style={[styles.viewSubtitle, textDirStyle]}>
              {t('queue.items', { count: activeSourceCount })} • {activeCountValue}{' '}
              {t('dl.statusActive')}
            </Text>
          </View>

          {displayedSpeed > 0 && (
            <View style={styles.speedBadge}>
              <Ionicons name="speedometer-outline" size={14} color={colors.accent} />
              <Text style={styles.speedText}>{formatSpeed(displayedSpeed)}</Text>
            </View>
          )}
        </View>

        {/* Device Mode Segmented Pill (Local vs Desktop PC) */}
        <View style={[styles.deviceSwitchBar, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity
            style={[styles.deviceTab, deviceMode === 'local' && styles.deviceTabActive]}
            onPress={() => {
              void hapticLight();
              setDeviceMode('local');
            }}
          >
            <Ionicons
              name="phone-portrait-outline"
              size={15}
              color={deviceMode === 'local' ? '#ffffff' : colors.textSecondary}
            />
            <Text
              style={[
                styles.deviceTabText,
                deviceMode === 'local' && styles.deviceTabTextActive,
              ]}
            >
              {t('mobile.localDevice')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deviceTab, deviceMode === 'desktop' && styles.deviceTabActive]}
            onPress={() => {
              void hapticLight();
              setDeviceMode('desktop');
            }}
          >
            <Ionicons
              name="desktop-outline"
              size={15}
              color={deviceMode === 'desktop' ? '#ffffff' : colors.textSecondary}
            />
            <Text
              style={[
                styles.deviceTabText,
                deviceMode === 'desktop' && styles.deviceTabTextActive,
              ]}
            >
              {t('mobile.desktopPc')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Unified Compact Search + Filters Sheet Trigger */}
        <View style={[styles.searchControlsRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View
            style={[styles.searchRow, { flex: 1, flexDirection: isRtl ? 'row-reverse' : 'row' }]}
          >
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, textDirStyle]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('dl.searchPlaceholder')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('dl.searchPlaceholder')}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                style={styles.searchClearBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.clear')}
              >
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.filterPillBtn, activeFilterCount > 0 && styles.filterPillBtnActive]}
            onPress={() => {
              void hapticLight();
              setFiltersSheetVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.filterQueues')}
          >
            <Ionicons
              name="options-outline"
              size={17}
              color={activeFilterCount > 0 ? '#ffffff' : colors.textPrimary}
            />
            <Text
              style={[
                styles.filterPillText,
                activeFilterCount > 0 && { color: '#ffffff' },
              ]}
            >
              {t('mobile.filterQueues')}
            </Text>
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Active filter summary pills (shown only when filtered) */}
        {activeFilterCount > 0 && (
          <View style={[styles.activeFiltersRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            {selectedQueueId !== 'all' && (
              <View style={styles.activeChip}>
                <Text style={styles.activeChipText}>
                  {queues.find((q) => q.id === selectedQueueId)?.name || selectedQueueId}
                </Text>
              </View>
            )}
            {selectedCategory !== 'all' && (
              <View style={styles.activeChip}>
                <Text style={styles.activeChipText}>{getCategoryLabel(selectedCategory)}</Text>
              </View>
            )}
            {statusFilter !== 'all' && (
              <View style={styles.activeChip}>
                <Text style={styles.activeChipText}>{getStatusLabel(statusFilter)}</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => {
                setSelectedQueueId('all');
                setSelectedCategory('all');
                setStatusFilter('all');
              }}
              style={styles.clearFilterLink}
            >
              <Text style={styles.clearFilterLinkText}>{t('common.clear')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Desktop Queue Quick Strip in Desktop Mode */}
        {deviceMode === 'desktop' && !desktopError && desktopQueues.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', gap: 8 }}>
              {desktopQueues.map((q) => (
                <TouchableOpacity
                  key={q.id}
                  style={[styles.queueTab, q.enabled && styles.queueTabActive]}
                  onPress={() =>
                    void handleRemoteAction(() =>
                      mobileBridge.toggleDesktopQueue(q.id, q.enabled ? 'stop' : 'start')
                    )
                  }
                >
                  <Ionicons
                    name={q.enabled ? 'stop-circle-outline' : 'play-circle-outline'}
                    size={14}
                    color={q.enabled ? '#ffffff' : colors.accent}
                  />
                  <Text
                    style={[styles.queueTabText, q.enabled && styles.queueTabTextActive]}
                  >
                    {q.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    );
  }, [
    isRtl,
    textDirStyle,
    t,
    activeSourceCount,
    activeCountValue,
    displayedSpeed,
    colors,
    formatSpeed,
    deviceMode,
    searchQuery,
    activeFilterCount,
    selectedQueueId,
    selectedCategory,
    statusFilter,
    queues,
    getCategoryLabel,
    getStatusLabel,
    desktopError,
    desktopQueues,
    handleRemoteAction,
    styles,
  ]);

  const renderEmpty = useCallback(() => {
    if (deviceMode === 'desktop') {
      if (desktopLoading) {
        return (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        );
      }
      if (desktopError) {
        return (
          <View style={styles.emptyContainer}>
            <Ionicons name="desktop-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, textDirStyle]}>{t('mobile.pcNotPaired')}</Text>
            <Text style={[styles.emptySubtitle, textDirStyle]}>{desktopError}</Text>
            <TouchableOpacity
              style={styles.emptyPrimaryBtn}
              onPress={() => setPairingVisible(true)}
            >
              <Ionicons name="qr-code-outline" size={16} color="#ffffff" />
              <Text style={styles.emptyPrimaryBtnText}>{t('mobile.openPairing')}</Text>
            </TouchableOpacity>
          </View>
        );
      }
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="cloud-done-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, textDirStyle]}>{t('dl.empty')}</Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="cloud-download-outline" size={48} color={colors.textMuted} />
        <Text style={[styles.emptyTitle, textDirStyle]}>{t('dl.empty')}</Text>
        <Text style={[styles.emptySubtitle, textDirStyle]}>{t('dl.emptyHint')}</Text>
        <View style={[styles.emptyCtasRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity
            style={styles.emptyPrimaryBtn}
            onPress={() => setAddModalVisible(true)}
          >
            <Ionicons name="add" size={18} color="#ffffff" />
            <Text style={styles.emptyPrimaryBtnText}>{t('dl.add')}</Text>
          </TouchableOpacity>
          {onOpenInGrab && (
            <TouchableOpacity
              style={styles.emptySecondaryBtn}
              onPress={() => onOpenInGrab('')}
            >
              <Ionicons name="flash-outline" size={16} color={colors.accent} />
              <Text style={styles.emptySecondaryBtnText}>{t('nav.grab')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }, [
    deviceMode,
    desktopLoading,
    desktopError,
    styles,
    colors,
    textDirStyle,
    t,
    isRtl,
    onOpenInGrab,
  ]);

  return (
    <View style={styles.container}>
      {deviceMode === 'local' ? (
        <FlatList
          data={filteredTasks}
          keyExtractor={(item) => item.id}
          renderItem={renderLocalItem}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        />
      ) : (
        <FlatList
          data={desktopError ? [] : filteredDesktopItems}
          keyExtractor={(item) => item.id}
          renderItem={renderDesktopItem}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        />
      )}

      {/* Bottom-Right Floating '+' Action Button (Local mode when not multi-selecting) */}
      {deviceMode === 'local' && !selectionMode && (
        <TouchableOpacity
          style={[styles.fab, isRtl ? { left: 20 } : { right: 20 }]}
          onPress={() => {
            void hapticLight();
            setAddModalVisible(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('dl.add')}
        >
          <Ionicons name="add" size={26} color="#ffffff" />
        </TouchableOpacity>
      )}

      {/* Floating Multi-Select Bar */}
      {selectionMode && deviceMode === 'local' && (
        <View style={[styles.selectionBar, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.selectionCount}>
              {t('mobile.selectedCount', { count: selectedIds.size })}
            </Text>
            <TouchableOpacity
              onPress={
                selectedIds.size === filteredTasks.length ? handleDeselectAll : handleSelectAll
              }
              style={styles.selectionSubBtn}
            >
              <Text style={styles.selectionSubText}>
                {selectedIds.size === filteredTasks.length
                  ? t('grab.selectNone')
                  : t('grab.selectAll')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity onPress={handleBulkResume} style={styles.selectionActionBtn}>
              <Ionicons name="play" size={16} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleBulkPause} style={styles.selectionActionBtn}>
              <Ionicons name="pause" size={16} color={colors.warning} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleBulkDelete} style={styles.selectionActionBtn}>
              <Ionicons name="trash-outline" size={16} color={colors.error} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleDeselectAll}
              style={[styles.selectionActionBtn, { backgroundColor: colors.accent }]}
            >
              <Ionicons name="close" size={16} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Compact Filters, Queues & Bulk Actions Bottom Sheet */}
      <Modal
        visible={filtersSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFiltersSheetVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetCard}>
            <View style={[styles.sheetHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
              <Text style={styles.sheetTitle}>{t('mobile.filterQueues')}</Text>
              <TouchableOpacity onPress={() => setFiltersSheetVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 16 }}>
              {/* Status */}
              <View style={styles.sheetSection}>
                <Text style={[styles.sectionLabel, textDirStyle]}>{t('dl.group.status')}</Text>
                <View style={styles.statusSegment}>
                  {(['all', 'active', 'queued', 'completed', 'failed'] as StatusFilter[]).map(
                    (st) => (
                      <TouchableOpacity
                        key={st}
                        style={[styles.statusBtn, statusFilter === st && styles.statusBtnActive]}
                        onPress={() => {
                          void hapticLight();
                          setStatusFilter(st);
                        }}
                      >
                        <Text
                          style={[
                            styles.statusBtnText,
                            statusFilter === st && styles.statusBtnTextActive,
                          ]}
                        >
                          {getStatusLabel(st)}
                        </Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
              </View>

              {/* Queues */}
              {deviceMode === 'local' && (
                <View style={styles.sheetSection}>
                  <View
                    style={[styles.sectionRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
                  >
                    <Text style={[styles.sectionLabel, textDirStyle]}>{t('dl.group.queue')}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setFiltersSheetVisible(false);
                        setQueueModalConfig({ visible: true, queue: null });
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.accent }}>
                        + {t('queue.new')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <TouchableOpacity
                      style={[styles.queueTab, selectedQueueId === 'all' && styles.queueTabActive]}
                      onPress={() => setSelectedQueueId('all')}
                    >
                      <Text
                        style={[
                          styles.queueTabText,
                          selectedQueueId === 'all' && styles.queueTabTextActive,
                        ]}
                      >
                        {t('cat.all')} ({queueCounts.all ?? 0})
                      </Text>
                    </TouchableOpacity>

                    {queues.map((q) => {
                      const active = selectedQueueId === q.id;
                      return (
                        <View
                          key={q.id}
                          style={[styles.queueTabGroup, active && styles.queueTabGroupActive]}
                        >
                          <TouchableOpacity
                            style={styles.queueTabMain}
                            onPress={() => setSelectedQueueId(q.id)}
                          >
                            <View
                              style={[
                                styles.queueDot,
                                {
                                  backgroundColor: q.enabled ? colors.success : colors.warning,
                                },
                              ]}
                            />
                            <Text style={[styles.queueTabText, active && styles.queueTabTextActive]}>
                              {q.name} ({queueCounts[q.id] ?? 0})
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.queueActionBtn}
                            onPress={() => (q.enabled ? stopQueue(q.id) : startQueue(q.id))}
                          >
                            <Ionicons
                              name={q.enabled ? 'pause-circle' : 'play-circle'}
                              size={16}
                              color={q.enabled ? colors.warning : colors.success}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.queueActionBtn}
                            onPress={() => {
                              setFiltersSheetVisible(false);
                              setQueueModalConfig({ visible: true, queue: q });
                            }}
                          >
                            <Ionicons
                              name="settings-outline"
                              size={14}
                              color={colors.textSecondary}
                            />
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Category Chips */}
              <View style={styles.sheetSection}>
                <Text style={[styles.sectionLabel, textDirStyle]}>{t('cat.all')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {(['all', ...CATEGORIES] as (Category | 'all')[]).map((cat) => {
                    const active = selectedCategory === cat;
                    const count =
                      deviceMode === 'local' ? categoryCounts[cat] ?? 0 : undefined;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.categoryChip, active && styles.categoryChipActive]}
                        onPress={() => {
                          void hapticLight();
                          setSelectedCategory(cat);
                        }}
                      >
                        <Text
                          style={[
                            styles.categoryChipText,
                            active && styles.categoryChipTextActive,
                          ]}
                        >
                          {getCategoryLabel(cat)}
                          {count !== undefined && count > 0 ? ` (${count})` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Quick Bulk Actions */}
              {deviceMode === 'local' && (
                <View style={styles.sheetSection}>
                  <Text style={[styles.sectionLabel, textDirStyle]}>{t('dl.moreActions')}</Text>
                  <View style={styles.bulkActionsWrap}>
                    <TouchableOpacity
                      style={styles.toolBtn}
                      onPress={() => {
                        void hapticLight();
                        void resumeAll();
                        setFiltersSheetVisible(false);
                      }}
                    >
                      <Ionicons name="play-outline" size={14} color={colors.success} />
                      <Text style={styles.toolBtnText}>{t('dl.resumeAll')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.toolBtn}
                      onPress={() => {
                        void hapticLight();
                        void pauseAll();
                        setFiltersSheetVisible(false);
                      }}
                    >
                      <Ionicons name="pause-outline" size={14} color={colors.warning} />
                      <Text style={styles.toolBtnText}>{t('dl.pauseAll')}</Text>
                    </TouchableOpacity>

                    {counts.failed > 0 && (
                      <TouchableOpacity
                        style={styles.toolBtn}
                        onPress={() => {
                          void hapticLight();
                          void retryFailed();
                          setFiltersSheetVisible(false);
                        }}
                      >
                        <Ionicons name="refresh-outline" size={14} color={colors.accent} />
                        <Text style={styles.toolBtnText}>{t('dl.retry')}</Text>
                      </TouchableOpacity>
                    )}

                    {counts.completed > 0 && (
                      <TouchableOpacity
                        style={styles.toolBtn}
                        onPress={() => {
                          void hapticLight();
                          clearCompleted();
                          setFiltersSheetVisible(false);
                        }}
                      >
                        <Ionicons name="trash-outline" size={14} color={colors.error} />
                        <Text style={styles.toolBtnText}>{t('dl.clearCompleted')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={[styles.sheetFooter, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
              <TouchableOpacity
                style={styles.sheetResetBtn}
                onPress={() => {
                  setSelectedQueueId('all');
                  setSelectedCategory('all');
                  setStatusFilter('all');
                }}
              >
                <Text style={styles.sheetResetText}>{t('common.clear')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sheetDoneBtn}
                onPress={() => setFiltersSheetVisible(false)}
              >
                <Text style={styles.sheetDoneText}>{t('common.ok')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pairing Modal (for Desktop PC mode) */}
      <PairingModal
        visible={pairingVisible}
        onClose={() => setPairingVisible(false)}
        onSuccess={() => void fetchDesktopState(true)}
      />

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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
      gap: 12,
      paddingBottom: 92,
    },
    topHeader: {
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 4,
      gap: 8,
    },
    viewTitle: {
      fontSize: 22,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    viewSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    speedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accentSubtle,
      borderWidth: 1,
      borderColor: colors.accent,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 16,
    },
    speedText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.accent,
    },
    deviceSwitchBar: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 3,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    deviceTab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      borderRadius: 8,
      minHeight: 38,
    },
    deviceTabActive: {
      backgroundColor: colors.accent,
    },
    deviceTabText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    deviceTabTextActive: {
      color: '#ffffff',
    },
    searchControlsRow: {
      gap: 8,
      alignItems: 'center',
    },
    searchRow: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      gap: 8,
      minHeight: 44,
    },
    searchInput: {
      flex: 1,
      paddingVertical: 8,
      color: colors.textPrimary,
      fontSize: 13,
    },
    searchClearBtn: {
      padding: 4,
      minHeight: 34,
      minWidth: 34,
      justifyContent: 'center',
      alignItems: 'center',
    },
    filterPillBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      minHeight: 44,
    },
    filterPillBtnActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    filterPillText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    filterBadge: {
      backgroundColor: 'rgba(255,255,255,0.25)',
      borderRadius: 10,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    filterBadgeText: {
      fontSize: 10,
      fontWeight: 'bold',
      color: '#ffffff',
    },
    activeFiltersRow: {
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
    },
    activeChip: {
      backgroundColor: colors.accentSubtle,
      borderWidth: 1,
      borderColor: colors.accent,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 12,
    },
    activeChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.accent,
    },
    clearFilterLink: {
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    clearFilterLinkText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.error,
    },
    fab: {
      position: 'absolute',
      bottom: 20,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accent,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
      elevation: 8,
    },
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 48,
      paddingHorizontal: 24,
      gap: 10,
    },
    emptyTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
    emptySubtitle: {
      color: colors.textSecondary,
      fontSize: 13,
      textAlign: 'center',
    },
    emptyCtasRow: {
      gap: 10,
      marginTop: 10,
    },
    emptyPrimaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
      minHeight: 44,
    },
    emptyPrimaryBtnText: {
      color: '#ffffff',
      fontWeight: 'bold',
      fontSize: 13,
    },
    emptySecondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accent,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
      minHeight: 44,
    },
    emptySecondaryBtnText: {
      color: colors.accent,
      fontWeight: 'bold',
      fontSize: 13,
    },
    desktopCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    desktopCardTop: {
      alignItems: 'center',
      gap: 10,
    },
    desktopFileName: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    desktopMeta: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    desktopStatusPill: {
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    desktopStatusText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    desktopProgressTrack: {
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    desktopProgressFill: {
      height: '100%',
    },
    desktopErrorText: {
      fontSize: 12,
      color: colors.error,
    },
    desktopActionsRow: {
      alignItems: 'center',
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: colors.borderSubtle,
      paddingTop: 8,
    },
    desktopActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.surfaceSubtle,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
    },
    desktopPrimaryBtn: {
      backgroundColor: colors.accent,
    },
    desktopActionText: {
      fontSize: 12,
      fontWeight: '600',
    },
    sheetBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    sheetCard: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 18,
      borderTopWidth: 1,
      borderColor: colors.border,
      gap: 14,
    },
    sheetHeader: {
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    sheetTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    sheetSection: {
      gap: 8,
    },
    sectionRow: {
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    statusSegment: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 8,
      padding: 3,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statusBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: 6,
      minHeight: 34,
      justifyContent: 'center',
    },
    statusBtnActive: {
      backgroundColor: colors.accent,
    },
    statusBtnText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    statusBtnTextActive: {
      color: '#ffffff',
    },
    queueTab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
      marginRight: 8,
      minHeight: 36,
    },
    queueTabActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    queueTabGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      marginRight: 8,
      paddingRight: 4,
      minHeight: 36,
    },
    queueTabGroupActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSubtle,
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
      color: colors.textSecondary,
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
    categoryChip: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      marginRight: 6,
      minHeight: 32,
      justifyContent: 'center',
    },
    categoryChipActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    categoryChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    categoryChipTextActive: {
      color: '#ffffff',
    },
    bulkActionsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    toolBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toolBtnText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '500',
    },
    sheetFooter: {
      gap: 10,
      paddingTop: 6,
    },
    sheetResetBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sheetResetText: {
      color: colors.textSecondary,
      fontWeight: '600',
    },
    sheetDoneBtn: {
      flex: 2,
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: colors.accent,
    },
    sheetDoneText: {
      color: '#ffffff',
      fontWeight: 'bold',
    },
    selectionBar: {
      position: 'absolute',
      bottom: 20,
      left: 16,
      right: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accent,
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
      color: colors.textPrimary,
    },
    selectionSubBtn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: colors.surfaceSubtle,
      borderRadius: 6,
    },
    selectionSubText: {
      fontSize: 11,
      color: colors.accent,
      fontWeight: '600',
    },
    selectionActionBtn: {
      width: 38,
      height: 38,
      borderRadius: 8,
      backgroundColor: colors.surfaceSubtle,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
