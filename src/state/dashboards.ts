// Mobile dashboards (stored on the device per file) and the default dashboard (NewDashboardDialog)

import AsyncStorage from '@react-native-async-storage/async-storage';

import { Dashboard, DashboardWidget, randomUUID } from '../core/model';
import { createStore } from './createStore';

const key = (fileId: string) => `pp.dashboards.${fileId}`;

export interface DashboardsState {
  fileId: string | null;
  mobile: Dashboard[];
  loaded: boolean;
}

export const dashboardsStore = createStore<DashboardsState>({ fileId: null, mobile: [], loaded: false });

export function useMobileDashboards(): DashboardsState {
  return dashboardsStore.use((s) => s);
}

export async function loadMobileDashboards(fileId: string): Promise<void> {
  if (dashboardsStore.get().fileId === fileId && dashboardsStore.get().loaded) return;
  dashboardsStore.set({ fileId, mobile: [], loaded: false });
  try {
    const raw = await AsyncStorage.getItem(key(fileId));
    const mobile = raw ? (JSON.parse(raw) as Dashboard[]) : [];
    dashboardsStore.set({ fileId, mobile, loaded: true });
  } catch {
    dashboardsStore.set({ fileId, mobile: [], loaded: true });
  }
}

function persist(): void {
  const { fileId, mobile } = dashboardsStore.get();
  if (!fileId) return;
  AsyncStorage.setItem(key(fileId), JSON.stringify(mobile)).catch(() => undefined);
}

export function saveMobileDashboard(dashboard: Dashboard): void {
  const list = dashboardsStore.get().mobile;
  const i = list.findIndex((d) => d.id === dashboard.id);
  const next = i >= 0 ? list.map((d) => (d.id === dashboard.id ? dashboard : d)) : [...list, dashboard];
  dashboardsStore.set({ mobile: next });
  persist();
}

export function deleteMobileDashboard(id: string): void {
  dashboardsStore.set({ mobile: dashboardsStore.get().mobile.filter((d) => d.id !== id) });
  persist();
}

export function moveMobileDashboard(id: string, delta: number): void {
  const list = dashboardsStore.get().mobile.slice();
  const i = list.findIndex((d) => d.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  dashboardsStore.set({ mobile: list });
  persist();
}

export function cloneDashboard(d: Dashboard, name?: string): Dashboard {
  return {
    id: randomUUID(),
    name: name ?? d.name,
    configuration: { ...d.configuration },
    columns: d.columns.map((c) => ({ weight: c.weight, widgets: c.widgets.map((w) => ({ type: w.type, label: w.label, configuration: { ...w.configuration } })) })),
  };
}

const w = (type: string, label: string, configuration: Record<string, string> = {}): DashboardWidget => ({ type, label, configuration });

/** NewDashboardDialog#buildIndicatorDashboard */
export function buildIndicatorDashboard(name: string): Dashboard {
  return {
    id: randomUUID(),
    name,
    configuration: { REPORTING_PERIOD: 'L1Y0' },
    columns: [
      {
        weight: 1,
        widgets: [
          w('HEADING', 'Kennzahlen'),
          w('TTWROR', 'True Time-Weighted Rate of Return (kumulativ)'),
          w('IRR', 'Interner Zinsfuß (IZF)'),
          w('ABSOLUTE_CHANGE', 'Absolute Veränderung'),
          w('DELTA', 'Delta (im Berichtszeitraum)'),
          w('HEADING', 'Letzter Tag'),
          w('TTWROR', 'True Time-Weighted Rate of Return (kumulativ)', { REPORTING_PERIOD: 'T1' }),
          w('ABSOLUTE_CHANGE', 'Absolute Veränderung', { REPORTING_PERIOD: 'T1' }),
        ],
      },
      {
        weight: 1,
        widgets: [
          w('HEADING', 'Risikokennzahlen'),
          w('MAXDRAWDOWN', 'Maximaler Drawdown'),
          w('MAXDRAWDOWNDURATION', 'Maximale Drawdown Duration'),
          w('VOLATILITY', 'Volatilität'),
          w('SEMIVOLATILITY', 'Semivolatilität'),
        ],
      },
      { weight: 1, widgets: [w('HEADING', 'Berechnung'), w('CALCULATION', 'Performance-Berechnung')] },
    ],
  };
}

/** NewDashboardDialog#buildEarningsDashboard */
export function buildEarningsDashboard(name: string): Dashboard {
  return {
    id: randomUUID(),
    name,
    configuration: {},
    columns: [
      { weight: 1, widgets: [w('HEADING', 'Erträge'), w('EARNINGS_PER_YEAR_CHART', 'Erträge pro Jahr'), w('EARNINGS_PER_MONTH_CHART', 'Erträge pro Monat')] },
      { weight: 1, widgets: [w('EARNINGS', 'Übersicht der Transaktionen', { LAYOUT: 'EXPAND_CURRENT_MONTH' })] },
    ],
  };
}

/** NewDashboardDialog#buildEmptyDashboard */
export function buildEmptyDashboard(name: string): Dashboard {
  return {
    id: randomUUID(),
    name,
    configuration: {},
    columns: [
      {
        weight: 1,
        widgets: [
          w(
            'DESCRIPTION',
            'Tippe auf „Bearbeiten“, um Widgets hinzuzufügen, zu konfigurieren und zu sortieren.',
          ),
        ],
      },
    ],
  };
}
