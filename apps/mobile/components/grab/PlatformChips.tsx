import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { ThemeColors } from '../../constants/theme';

const PLATFORM_CHIPS = [
  'YouTube',
  'Spotify',
  'Instagram',
  'TikTok',
  'SoundCloud',
  'X / Twitter',
  'Reddit',
  '+1000 Direct',
];

export function PlatformChips() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {PLATFORM_CHIPS.map((chip) => (
          <View key={chip} style={styles.chip}>
            <Text style={styles.chipText}>{chip}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginVertical: 4,
    },
    scroll: {
      gap: 8,
    },
    chip: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 6,
      minHeight: 32,
      justifyContent: 'center',
    },
    chipText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '500',
    },
  });
