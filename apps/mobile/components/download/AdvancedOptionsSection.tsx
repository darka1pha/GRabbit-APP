import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

interface AdvancedOptionsSectionProps {
  referrer: string;
  onReferrerChange: (r: string) => void;
  headersText: string;
  onHeadersChange: (h: string) => void;
  speedLimitKBps: number;
  onSpeedLimitChange: (s: number) => void;
  checksum: string;
  onChecksumChange: (c: string) => void;
}

export function AdvancedOptionsSection({
  referrer,
  onReferrerChange,
  headersText,
  onHeadersChange,
  speedLimitKBps,
  onSpeedLimitChange,
  checksum,
  onChecksumChange,
}: AdvancedOptionsSectionProps) {
  return (
    <View style={styles.container}>
      {/* Speed Limit */}
      <View style={styles.field}>
        <Text style={styles.label}>Speed Limit (KB/s, 0 = unlimited)</Text>
        <TextInput
          style={styles.input}
          value={speedLimitKBps > 0 ? String(speedLimitKBps) : ''}
          onChangeText={(v) => onSpeedLimitChange(Math.max(0, parseInt(v.replace(/[^0-9]/g, ''), 10) || 0))}
          placeholder="0"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          accessibilityLabel="Speed limit"
        />
      </View>

      {/* Parallel Connections */}
      <View style={styles.field}>
        <Text style={styles.label}>Connection Stream (Native Single-Connection)</Text>
        <View style={styles.chipRow}>
          <View style={[styles.chip, styles.chipActive]}>
            <Text style={[styles.chipText, styles.chipTextActive]}>1 Stream (Honest Mode)</Text>
          </View>
        </View>
      </View>

      {/* Referrer */}
      <View style={styles.field}>
        <Text style={styles.label}>Referrer (optional)</Text>
        <TextInput
          style={styles.input}
          value={referrer}
          onChangeText={onReferrerChange}
          placeholder="https://example.com/page"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          accessibilityLabel="Referrer"
        />
      </View>

      {/* Custom Headers */}
      <View style={styles.field}>
        <Text style={styles.label}>Custom Headers (one per line, e.g. Cookie: foo=bar)</Text>
        <TextInput
          style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
          value={headersText}
          onChangeText={onHeadersChange}
          placeholder="Header-Name: value"
          placeholderTextColor="#64748b"
          multiline
          autoCapitalize="none"
          accessibilityLabel="Custom Headers"
        />
      </View>

      {/* Expected Checksum */}
      <View style={styles.field}>
        <Text style={styles.label}>Expected Checksum (optional)</Text>
        <TextInput
          style={styles.input}
          value={checksum}
          onChangeText={onChecksumChange}
          placeholder="SHA-256 or MD5 hash to verify after download"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          accessibilityLabel="Expected Checksum"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    marginTop: 6,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: '#0b0f19',
    borderWidth: 1,
    borderColor: '#233253',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    minHeight: 32,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: '#6366f1',
    borderColor: '#818cf8',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
  },
  chipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#0b0f19',
    borderWidth: 1,
    borderColor: '#233253',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#f8fafc',
    fontSize: 13,
    minHeight: 40,
  },
});
