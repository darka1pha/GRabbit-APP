import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MediaItem } from '@grabbit/types';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { ThemeColors } from '../../constants/theme';

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
  const { colors } = useTheme();
  const { isRtl, formatDuration, textDirStyle } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <TouchableOpacity
      style={[
        styles.trackRow,
        { flexDirection: isRtl ? 'row-reverse' : 'row' },
        isChecked && styles.trackRowChecked,
      ]}
      onPress={() => onToggle(item.id)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isChecked }}
      accessibilityLabel={`${item.title || 'Track'}, ${item.uploader || ''}`}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <Ionicons
        name={isChecked ? 'checkbox' : 'square-outline'}
        size={20}
        color={isChecked ? colors.accent : colors.textMuted}
      />
      <Text style={styles.trackIndex}>{index + 1}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.trackTitle, textDirStyle]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.uploader ? (
          <Text style={[styles.trackAuthor, textDirStyle]} numberOfLines={1}>
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    trackRow: {
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.background,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 44,
    },
    trackRowChecked: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSubtle,
    },
    trackIndex: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textMuted,
      width: 20,
      textAlign: 'center',
    },
    trackTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    trackAuthor: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 1,
    },
    trackDuration: {
      fontSize: 11,
      color: colors.textMuted,
      fontWeight: '500',
    },
  });
