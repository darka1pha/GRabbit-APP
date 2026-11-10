import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mobileSettingsManager, MobileSettings } from '../services/settings-manager';
import { useDownloads } from '../hooks/useDownloads';
import { mobileRecognizer } from '../services/recognizer';

export function SettingsView() {
  const [settings, setSettings] = useState<MobileSettings>(mobileSettingsManager.getSettings());
  const { clearCompleted } = useDownloads();

  useEffect(() => {
    mobileSettingsManager.loadSettings().then(setSettings);
    const unsub = mobileSettingsManager.subscribe(setSettings);
    return unsub;
  }, []);

  const update = (patch: Partial<MobileSettings>) => {
    mobileSettingsManager.updateSettings(patch);
  };

  const handleTestDesktopRpc = async () => {
    const { host, port, token } = settings.desktopBridge;
    if (!host) {
      Alert.alert('Required', 'Please enter desktop IP address');
      return;
    }
    try {
      const url = `http://${host}:${port}/ping`;
      const res = await fetch(url, {
        headers: { 'X-GRabbit-Token': token },
      });
      if (res.ok) {
        Alert.alert('Success', 'Successfully connected to GRabbit Desktop RPC Bridge!');
      } else {
        Alert.alert('Connection Failed', `Desktop returned status ${res.status}`);
      }
    } catch (err: any) {
      Alert.alert('Connection Error', `Could not reach ${host}:${port}. Ensure desktop app is running and on the same WiFi network.`);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Customize downloads, media preferences & desktop pairing</Text>
      </View>

      {/* Downloads Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="download-outline" size={18} color="#38bdf8" />
          <Text style={styles.sectionTitle}>Downloads Engine</Text>
        </View>
        <View style={styles.card}>
          {/* Max Concurrent */}
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Max Concurrent Downloads</Text>
              <Text style={styles.settingHint}>Active downloads at the same time</Text>
            </View>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => update({ maxConcurrent: Math.max(1, settings.maxConcurrent - 1) })}
              >
                <Ionicons name="remove" size={16} color="#ffffff" />
              </TouchableOpacity>
              <Text style={styles.stepperVal}>{settings.maxConcurrent}</Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => update({ maxConcurrent: Math.min(8, settings.maxConcurrent + 1) })}
              >
                <Ionicons name="add" size={16} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Connection Threads */}
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Parallel Connection Threads</Text>
              <Text style={styles.settingHint}>Multi-part download segment chunks (1-16)</Text>
            </View>
            <View style={styles.segmentedRow}>
              {[1, 2, 4, 8, 16].map((threads) => (
                <TouchableOpacity
                  key={threads}
                  style={[
                    styles.segBtn,
                    settings.defaultConnections === threads && styles.segBtnActive,
                  ]}
                  onPress={() => update({ defaultConnections: threads })}
                >
                  <Text
                    style={[
                      styles.segBtnText,
                      settings.defaultConnections === threads && styles.segBtnTextActive,
                    ]}
                  >
                    {threads}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Global Speed Limit */}
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Speed Throttle (KB/s)</Text>
              <Text style={styles.settingHint}>0 = Unlimited maximum speed</Text>
            </View>
            <TextInput
              style={styles.numberInput}
              value={settings.globalSpeedLimitKBps ? String(settings.globalSpeedLimitKBps) : ''}
              onChangeText={(v) => update({ globalSpeedLimitKBps: Number(v) || 0 })}
              placeholder="0"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
            />
          </View>

          {/* Auto Save to Gallery */}
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Auto-Save to Media Library</Text>
              <Text style={styles.settingHint}>Automatically save videos & photos to Camera Roll</Text>
            </View>
            <Switch
              value={settings.autoSaveToLibrary}
              onValueChange={(v) => update({ autoSaveToLibrary: v })}
              thumbColor={settings.autoSaveToLibrary ? '#38bdf8' : '#64748b'}
              trackColor={{ false: '#334155', true: '#0284c7' }}
            />
          </View>
        </View>
      </View>

      {/* Media Quality Preferences */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="musical-notes-outline" size={18} color="#38bdf8" />
          <Text style={styles.sectionTitle}>Default Media Quality</Text>
        </View>
        <View style={styles.card}>
          {/* Audio Format */}
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Preferred Audio Format</Text>
            </View>
            <View style={styles.segmentedRow}>
              {(['mp3', 'm4a', 'flac'] as const).map((fmt) => (
                <TouchableOpacity
                  key={fmt}
                  style={[
                    styles.segBtn,
                    settings.defaultAudioFormat === fmt && styles.segBtnActive,
                  ]}
                  onPress={() => update({ defaultAudioFormat: fmt })}
                >
                  <Text
                    style={[
                      styles.segBtnText,
                      settings.defaultAudioFormat === fmt && styles.segBtnTextActive,
                    ]}
                  >
                    {fmt.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Video Quality */}
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Preferred Video Resolution</Text>
            </View>
            <View style={styles.segmentedRow}>
              {['1080p', '720p', '480p'].map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[
                    styles.segBtn,
                    settings.defaultVideoQuality === q && styles.segBtnActive,
                  ]}
                  onPress={() => update({ defaultVideoQuality: q })}
                >
                  <Text
                    style={[
                      styles.segBtnText,
                      settings.defaultVideoQuality === q && styles.segBtnTextActive,
                    ]}
                  >
                    {q}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* Desktop Pairing & RPC Bridge */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="desktop-outline" size={18} color="#38bdf8" />
          <Text style={styles.sectionTitle}>Desktop App RPC Bridge</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Connect to Desktop Engine</Text>
              <Text style={styles.settingHint}>
                Pair with GRabbit Desktop over local WiFi to utilize yt-dlp & FFmpeg extraction
              </Text>
            </View>
            <Switch
              value={settings.desktopBridge.enabled}
              onValueChange={(enabled) =>
                update({ desktopBridge: { ...settings.desktopBridge, enabled } })
              }
              thumbColor={settings.desktopBridge.enabled ? '#38bdf8' : '#64748b'}
              trackColor={{ false: '#334155', true: '#0284c7' }}
            />
          </View>

          {settings.desktopBridge.enabled && (
            <View style={styles.rpcForm}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Desktop Local IP Address</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={settings.desktopBridge.host}
                  onChangeText={(host) =>
                    update({ desktopBridge: { ...settings.desktopBridge, host } })
                  }
                  placeholder="192.168.1.100"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>RPC Port</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={String(settings.desktopBridge.port)}
                  onChangeText={(port) =>
                    update({ desktopBridge: { ...settings.desktopBridge, port: Number(port) || 31542 } })
                  }
                  placeholder="31542"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Extension / RPC Auth Token</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={settings.desktopBridge.token}
                  onChangeText={(token) =>
                    update({ desktopBridge: { ...settings.desktopBridge, token: token.trim() } })
                  }
                  placeholder="Token from Desktop Settings > Extension"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity style={styles.testRpcBtn} onPress={handleTestDesktopRpc}>
                <Ionicons name="wifi-outline" size={16} color="#ffffff" />
                <Text style={styles.testRpcBtnText}>Test Desktop Connection</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Storage & Clear Cache */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="trash-bin-outline" size={18} color="#38bdf8" />
          <Text style={styles.sectionTitle}>Data & Storage</Text>
        </View>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.clearBtnRow}
            onPress={() => {
              clearCompleted();
              Alert.alert('Completed', 'Cleared completed downloads history');
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.clearBtnTitle}>Clear Completed Downloads</Text>
              <Text style={styles.clearBtnHint}>Remove finished items from history</Text>
            </View>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.clearBtnRow}
            onPress={() => {
              mobileRecognizer.clearHistory();
              Alert.alert('Completed', 'Cleared song recognition history');
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.clearBtnTitle}>Clear Song Recognition History</Text>
              <Text style={styles.clearBtnHint}>Reset identified songs list</Text>
            </View>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      {/* About */}
      <View style={styles.aboutCard}>
        <Text style={styles.aboutTitle}>🐰 GRabbit Mobile</Text>
        <Text style={styles.aboutVersion}>v1.0.0 Monorepo Edition</Text>
        <Text style={styles.aboutDesc}>
          Cross-platform segmented download manager & media grabber powered by Expo & @grabbit core engines.
        </Text>
      </View>
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
    gap: 20,
    paddingBottom: 40,
  },
  header: {
    marginVertical: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#38bdf8',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  settingHint: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperVal: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#38bdf8',
    minWidth: 18,
    textAlign: 'center',
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 4,
  },
  segBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  segBtnActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  segBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  segBtnTextActive: {
    color: '#ffffff',
  },
  numberInput: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'monospace',
    minWidth: 70,
    textAlign: 'center',
  },
  rpcForm: {
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    color: '#94a3b8',
  },
  fieldInput: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  testRpcBtn: {
    backgroundColor: '#0284c7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  testRpcBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  clearBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  clearBtnTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  clearBtnHint: {
    fontSize: 11,
    color: '#94a3b8',
  },
  aboutCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    alignItems: 'center',
    gap: 4,
  },
  aboutTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#38bdf8',
  },
  aboutVersion: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  aboutDesc: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 4,
  },
});

