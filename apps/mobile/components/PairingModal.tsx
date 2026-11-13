import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { mobileSettingsManager } from '../services/settings-manager';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '../hooks/useTheme';
import { ThemeColors } from '../constants/theme';
import { hapticSuccess, hapticError, hapticLight } from '../services/haptics';

interface PairingModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function PairingModal({ visible, onClose, onSuccess }: PairingModalProps) {
  const { t, isRtl, textDirStyle } = useI18n();
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const currentBridge = mobileSettingsManager.getSettings().desktopBridge;
  const [host, setHost] = useState(currentBridge.host || '');
  const [port, setPort] = useState(String(currentBridge.port || 31542));
  const [token, setToken] = useState(currentBridge.token || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handlePasteUri = async () => {
    try {
      void hapticLight();
      const raw = (await Clipboard.getStringAsync()).trim();
      if (!raw) {
        Alert.alert(t('common.close'), t('grab.placeholder'));
        return;
      }

      if (raw.startsWith('grabbit://pair')) {
        const u = new URL(raw.replace('grabbit://pair', 'http://localhost/pair'));
        const h = u.searchParams.get('host') || host;
        const p = u.searchParams.get('port') || port;
        const tok = u.searchParams.get('token') || token;
        setHost(h);
        setPort(p);
        setToken(tok);
        setTestResult(null);
        void hapticSuccess();
        return;
      }

      // Check if it's an IP:port string
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(raw)) {
        const parts = raw.split(':');
        setHost(parts[0]);
        if (parts[1]) setPort(parts[1]);
        setTestResult(null);
        void hapticSuccess();
        return;
      }

      Alert.alert(t('mobile.pairError'), t('mobile.qrInstruction'));
    } catch (err: any) {
      Alert.alert(t('common.close'), err?.message || 'Failed to read clipboard.');
    }
  };

  const handleTestAndSave = async () => {
    if (!host.trim()) {
      Alert.alert(t('common.close'), 'Desktop IP is required.');
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const parsedPort = Number(port);
      const portNum = Number.isFinite(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535 ? Math.trunc(parsedPort) : 31542;
      const url = `http://${host.trim()}:${portNum}/ping`;
      const res = await fetch(url, {
        headers: token.trim() ? { 'X-GRabbit-Token': token.trim() } : {},
      });

      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        if (data?.authenticated !== true) {
          void hapticError();
          setTestResult({
            success: false,
            message: 'Desktop rejected the security token. Check your security token in Desktop Settings.',
          });
          return;
        }
        await mobileSettingsManager.updateSettings({
          desktopBridge: {
            enabled: true,
            host: host.trim(),
            port: portNum,
            token: token.trim(),
          },
        });
        setTestResult({ success: true, message: t('mobile.pairSuccess') });
        void hapticSuccess();
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1200);
      } else {
        void hapticError();
        setTestResult({
          success: false,
          message: `Desktop returned status ${res.status}. Check your security token.`,
        });
      }
    } catch {
      void hapticError();
      setTestResult({
        success: false,
        message: `Could not reach ${host}:${port}. Ensure Desktop app is running and on the same WiFi network.`,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header */}
          <View style={[styles.header, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="qr-code-outline" size={22} color="#6366f1" />
              <Text style={styles.title}>{t('mobile.qrScanner')}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <Text style={[styles.instruction, textDirStyle]}>{t('mobile.qrInstruction')}</Text>

          {/* Quick Paste Button */}
          <TouchableOpacity
            style={[styles.pasteBtn, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
            onPress={handlePasteUri}
            accessibilityRole="button"
            accessibilityLabel={t('grab.paste')}
          >
            <Ionicons name="clipboard-outline" size={18} color={colors.accent} />
            <Text style={styles.pasteBtnText}>{t('grab.paste')}</Text>
          </TouchableOpacity>

          {/* Manual inputs */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, textDirStyle]}>Desktop IP</Text>
            <TextInput
              style={[styles.input, textDirStyle]}
              value={host}
              onChangeText={setHost}
              placeholder="e.g. 192.168.1.100"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              autoCapitalize="none"
              accessibilityLabel="Desktop IP"
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, textDirStyle]}>Port</Text>
            <TextInput
              style={[styles.input, textDirStyle]}
              value={port}
              onChangeText={setPort}
              placeholder="31542"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              accessibilityLabel="Port"
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, textDirStyle]}>{t('set.extensionToken')}</Text>
            <TextInput
              style={[styles.input, textDirStyle]}
              value={token}
              onChangeText={setToken}
              placeholder="Paste token"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              accessibilityLabel={t('set.extensionToken')}
            />
          </View>

          {/* Test status banner */}
          {testResult && (
            <View
              style={[
                styles.resultBanner,
                testResult.success ? styles.resultSuccess : styles.resultError,
              ]}
            >
              <Ionicons
                name={testResult.success ? 'checkmark-circle' : 'alert-circle'}
                size={18}
                color={testResult.success ? '#10b981' : '#ef4444'}
              />
              <Text
                style={[
                  styles.resultText,
                  { color: testResult.success ? '#10b981' : '#ef4444' },
                ]}
              >
                {testResult.message}
              </Text>
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, testing && styles.btnDisabled]}
              onPress={handleTestAndSave}
              disabled={testing}
              accessibilityRole="button"
              accessibilityLabel={t('mobile.pairButton')}
            >
              {testing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="link" size={16} color="#ffffff" />
                  <Text style={styles.saveText}>{t('mobile.pairButton')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    header: {
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    title: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    closeBtn: {
      padding: 6,
      minHeight: 44,
      minWidth: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    instruction: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: 16,
    },
    pasteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accentSubtle,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 12,
      marginBottom: 16,
      minHeight: 44,
    },
    pasteBtnText: {
      color: colors.accent,
      fontWeight: '600',
      fontSize: 14,
    },
    field: {
      marginBottom: 12,
    },
    fieldLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 4,
    },
    input: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.textPrimary,
      fontSize: 14,
      minHeight: 44,
    },
    resultBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 10,
      borderRadius: 8,
      marginBottom: 14,
    },
    resultSuccess: {
      backgroundColor: colors.successSubtle,
    },
    resultError: {
      backgroundColor: colors.errorSubtle,
    },
    resultText: {
      flex: 1,
      fontSize: 13,
    },
    actions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 8,
    },
    cancelBtn: {
      flex: 1,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    cancelText: {
      color: colors.textSecondary,
      fontWeight: '600',
    },
    saveBtn: {
      flex: 2,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      borderRadius: 8,
      minHeight: 44,
    },
    btnDisabled: {
      opacity: 0.6,
    },
    saveText: {
      color: '#ffffff',
      fontWeight: 'bold',
    },
  });
