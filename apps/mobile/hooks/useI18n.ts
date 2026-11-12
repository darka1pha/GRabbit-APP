import { useEffect, useState, useMemo } from 'react';
import { I18nManager, TextStyle } from 'react-native';
import {
  createTranslator,
  errorText as getErrorText,
  formatBytes as fmtBytes,
  formatSpeed as fmtSpeed,
  formatDuration as fmtDuration,
  type MessageKey,
  type Translate,
} from '@grabbit/utils';
import { mobileSettingsManager } from '../services/settings-manager';

export interface UseI18nReturn {
  t: Translate;
  language: 'en' | 'fa';
  isRtl: boolean;
  dir: 'ltr' | 'rtl';
  textDirStyle: TextStyle;
  formatBytes: (bytes: number | null | undefined) => string;
  formatSpeed: (bps: number) => string;
  formatDuration: (seconds: number | null | undefined) => string;
  errorText: (err: unknown) => string;
}

export function useI18n(): UseI18nReturn {
  const [language, setLanguage] = useState<'en' | 'fa'>(
    mobileSettingsManager.getSettings().language || 'en'
  );

  useEffect(() => {
    return mobileSettingsManager.subscribe((settings) => {
      if (settings.language && settings.language !== language) {
        setLanguage(settings.language);
      }
    });
  }, [language]);

  const isRtl = language === 'fa';
  const t = useMemo(() => createTranslator(language), [language]);

  const textDirStyle: TextStyle = useMemo(
    () => ({
      writingDirection: isRtl ? 'rtl' : 'ltr',
      textAlign: isRtl ? 'right' : 'left',
    }),
    [isRtl]
  );

  const formatBytes = useMemo(
    () => (bytes: number | null | undefined) => fmtBytes(bytes, language),
    [language]
  );

  const formatSpeed = useMemo(
    () => (bps: number) => fmtSpeed(bps, language),
    [language]
  );

  const formatDuration = useMemo(
    () => (seconds: number | null | undefined) => fmtDuration(seconds, language),
    [language]
  );

  const errorText = useMemo(
    () => (err: unknown) => getErrorText(t, err),
    [t]
  );

  return {
    t,
    language,
    isRtl,
    dir: isRtl ? 'rtl' : 'ltr',
    textDirStyle,
    formatBytes,
    formatSpeed,
    formatDuration,
    errorText,
  };
}
