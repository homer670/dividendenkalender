// Colors and spacing (light/dark), loosely following the Portfolio Performance mobile app

import { useColorScheme } from 'react-native';

import { useSettings } from '../state/settings';

export interface Palette {
  dark: boolean;
  background: string;
  card: string;
  cardAlt: string;
  border: string;
  separator: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentText: string;
  positive: string;
  negative: string;
  warning: string;
  chartGrid: string;
  chartAxis: string;
  /** default line color for the accumulated performance/total series */
  series: string;
  seriesFill: string;
  inputBackground: string;
  overlay: string;
}

export const LIGHT: Palette = {
  dark: false,
  background: '#F2F2F7',
  card: '#FFFFFF',
  cardAlt: '#F7F7FA',
  border: '#E1E1E6',
  separator: '#E5E5EA',
  text: '#111114',
  textSecondary: '#5E5E66',
  textTertiary: '#9A9AA2',
  accent: '#1F6FC5',
  accentText: '#FFFFFF',
  positive: '#1E7B34',
  negative: '#C42B1C',
  warning: '#B26A00',
  chartGrid: '#E6E6EB',
  chartAxis: '#8A8A92',
  series: '#1F6FC5',
  seriesFill: 'rgba(31,111,197,0.12)',
  inputBackground: '#EFEFF4',
  overlay: 'rgba(0,0,0,0.35)',
};

export const DARK: Palette = {
  dark: true,
  background: '#000000',
  card: '#1C1C1E',
  cardAlt: '#242427',
  border: '#2E2E32',
  separator: '#38383C',
  text: '#F2F2F5',
  textSecondary: '#A5A5AD',
  textTertiary: '#6E6E76',
  accent: '#4C9BEF',
  accentText: '#FFFFFF',
  positive: '#4CC774',
  negative: '#FF6B5E',
  warning: '#F0A33A',
  chartGrid: '#2C2C30',
  chartAxis: '#8A8A92',
  series: '#4C9BEF',
  seriesFill: 'rgba(76,155,239,0.18)',
  inputBackground: '#2A2A2E',
  overlay: 'rgba(0,0,0,0.6)',
};

export function usePalette(): Palette {
  const system = useColorScheme();
  const { theme } = useSettings();
  const dark = theme === 'system' ? system === 'dark' : theme === 'dark';
  return dark ? DARK : LIGHT;
}

/** ColoredValueConfig: positive values green, negative values red */
export function valueColor(p: Palette, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) return p.text;
  return value > 0 ? p.positive : p.negative;
}

export const spacing = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
export const radius = { s: 8, m: 12, l: 16 };
