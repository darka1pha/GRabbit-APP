import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, radius, spacing, touchable, type ThemeColors } from '../constants/theme';
import { mobileSettingsManager } from '../services/settings-manager';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Resolves a stored theme preference against the current OS color scheme. */
export function resolveThemeMode(
  preference: ThemePreference | undefined,
  systemScheme: 'light' | 'dark' | null | undefined
): 'light' | 'dark' {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemScheme === 'light' ? 'light' : 'dark';
}

export interface ThemeContextValue {
  theme: ThemePreference;
  mode: 'light' | 'dark';
  isDark: boolean;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  touchable: typeof touchable;
  setTheme: (theme: ThemePreference) => void;
}

const DEFAULT_VALUE: ThemeContextValue = {
  theme: 'dark',
  mode: 'dark',
  isDark: true,
  colors: darkColors,
  spacing,
  radius,
  touchable,
  setTheme: (theme) => {
    void mobileSettingsManager.updateSettings({ theme });
  },
};

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_VALUE);

/** Provides live Light/Dark/System color tokens backed by mobile settings. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [themePref, setThemePref] = useState<ThemePreference>(
    mobileSettingsManager.getSettings().theme || 'dark'
  );

  useEffect(() => {
    return mobileSettingsManager.subscribe((settings) => {
      if (settings.theme && settings.theme !== themePref) {
        setThemePref(settings.theme);
      }
    });
  }, [themePref]);

  const value = useMemo<ThemeContextValue>(() => {
    const mode = resolveThemeMode(themePref, systemScheme);
    const isDark = mode === 'dark';
    return {
      theme: themePref,
      mode,
      isDark,
      colors: isDark ? darkColors : lightColors,
      spacing,
      radius,
      touchable,
      setTheme: (next: ThemePreference) => {
        setThemePref(next);
        void mobileSettingsManager.updateSettings({ theme: next });
      },
    };
  }, [themePref, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

