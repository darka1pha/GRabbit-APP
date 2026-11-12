import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MediaItem } from '@grabbit/types';
import { formatDuration } from '@grabbit/utils';

export interface TrackRowProps {
  item: MediaItem;
  index: number;
  isChecked: boolean;
  onToggle: (id: string) => void;
}

export const TrackRow = React.memo(function TrackRow({
  item,
  index,
  isChecked,
  onToggle,
}: TrackRowProps) {
  return (
    <TouchableOpacity
      style={[styles.trackRow, isChecked && styles.trackRowChecked]}
      onPress={() => onToggle(item.id)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isChecked }}
      accessibilityLabel={`${item.title || 'Track'}, ${item.uploader || ''}`}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <Ionicons
        name={isChecked ? 'checkbox' : 'square-outline'}
        size={20}
        color={isChecked ? '#6366f1' : '#64748b'}
      />
      <Text style={styles.trackIndex}>{index + 1}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.trackTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {item.uploader ? (
          <Text style={styles.trackAuthor} numberOfLines={1}>
            {item.uploader}
          </Text>
        ) : null}
      </View>
      {item.durationSeconds ? (
        <Text style={styles.trackDuration}>{formatDuration(item.durationSeconds)}</Text>
      ) : null}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0b0f19',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#233253',
    minHeight: 44,
  },
  trackRowChecked: {
    borderColor: '#6366f1',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  trackIndex: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    width: 20,
    textAlign: 'center',
  },
  trackTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f8fafc',
  },
  trackAuthor: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 1,
  },
  trackDuration: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
});
