export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSubtle: string;
  surfaceElevated: string;
  border: string;
  borderSubtle: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSubtle: string;
  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  error: string;
  errorSubtle: string;
  overlay: string;
}

export const darkColors: ThemeColors = {
  background: '#0b0f19',
  surface: '#131b2e',
  surfaceSubtle: '#17223b',
  surfaceElevated: '#1e2b48',
  border: '#233253',
  borderSubtle: '#18243c',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  accent: '#6366f1',
  accentSubtle: 'rgba(99, 102, 241, 0.15)',
  success: '#10b981',
  successSubtle: 'rgba(16, 185, 129, 0.15)',
  warning: '#f59e0b',
  warningSubtle: 'rgba(245, 158, 11, 0.15)',
  error: '#ef4444',
  errorSubtle: 'rgba(239, 68, 68, 0.15)',
  overlay: 'rgba(0, 0, 0, 0.7)',
};

export const lightColors: ThemeColors = {
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceSubtle: '#f1f5f9',
  surfaceElevated: '#ffffff',
  border: '#e2e8f0',
  borderSubtle: '#f1f5f9',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  accent: '#4f46e5',
  accentSubtle: 'rgba(79, 70, 229, 0.1)',
  success: '#059669',
  successSubtle: 'rgba(5, 150, 105, 0.1)',
  warning: '#d97706',
  warningSubtle: 'rgba(217, 119, 6, 0.1)',
  error: '#dc2626',
  errorSubtle: 'rgba(220, 38, 38, 0.1)',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
};

export const touchable = {
  minHeight: 44,
  minWidth: 44,
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
};
