import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

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

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  scroll: {
    gap: 8,
  },
  chip: {
    backgroundColor: '#131b2e',
    borderWidth: 1,
    borderColor: '#233253',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
});
