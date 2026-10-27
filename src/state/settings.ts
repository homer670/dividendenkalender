// User preferences (persisted in AsyncStorage)

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CostMethod } from '../core/snapshot/securityPerformance';
import { detectNumberLocale, NumberLocale, setDiscreetMode, setNumberLocale } from '../ui/format';
import { createStore } from './createStore';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
  numberLocale: NumberLocale;
  /** hide amounts (DiscreetMode) */
  discreet: boolean;
  costMethod: CostMethod;
  /** lock the file when the app goes to the background */
  lockOnBackground: boolean;
  /** use Face ID / Touch ID / fingerprint to unlock with the stored password */
  useBiometrics: boolean;
  /** download exchange rates from the European Central Bank */
  downloadExchangeRates: boolean;
  /** selected reporting period per view */
  periods: Record<string, string>;
  /** selected client filter id per view */
  filters: Record<string, string>;
}

const KEY = 'pp.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  numberLocale: detectNumberLocale(),
  discreet: false,
  costMethod: 'FIFO',
  lockOnBackground: true,
  useBiometrics: true,
  downloadExchangeRates: true,
  periods: {},
  filters: {},
};

export const settingsStore = createStore<Settings & { loaded: boolean }>({ ...DEFAULT_SETTINGS, loaded: false });

function apply(s: Settings): void {
  setNumberLocale(s.numberLocale);
  setDiscreetMode(s.discreet);
}

apply(DEFAULT_SETTINGS);

export async function loadSettings(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    const s: Settings = { ...DEFAULT_SETTINGS, ...parsed };
    apply(s);
    settingsStore.set({ ...s, loaded: true });
  } catch {
    settingsStore.set({ loaded: true });
  }
}

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set(patch);
  const { loaded: _loaded, ...s } = settingsStore.get();
  apply(s);
  AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => undefined);
}

export function useSettings(): Settings & { loaded: boolean } {
  return settingsStore.use((s) => s);
}
