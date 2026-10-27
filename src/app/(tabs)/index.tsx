import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Dashboard, DashboardWidget } from '@/core/model';
import { ReportingPeriod } from '@/core/snapshot/reportingPeriod';
import {
  buildEarningsDashboard,
  buildEmptyDashboard,
  buildIndicatorDashboard,
  cloneDashboard,
  loadMobileDashboards,
  saveMobileDashboard,
  useMobileDashboards,
} from '@/state/dashboards';
import { usePortfolio } from '@/state/portfolio';
import { settingsStore, updateSettings, useSettings } from '@/state/settings';
import { Button, EmptyState, Loading, Screen, T } from '@/ui/components/basic';
import { PeriodChips } from '@/ui/components/pickers';
import { OptionSheet } from '@/ui/components/Sheet';
import { RatesNotice } from '@/ui/components/RatesNotice';
import { useContextOrNull } from '@/ui/hooks';
import { spacing, usePalette } from '@/ui/theme';
import { CollapsibleSectionWidget } from '@/ui/widgets/common';
import { Config, DashboardEnv } from '@/ui/widgets/env';
import { widgetSpec } from '@/ui/widgets/registry';
import { WidgetHost } from '@/ui/widgets/WidgetHost';

export default function DashboardScreen() {
  const ctx = useContextOrNull();
  if (!ctx) return null;
  return <DashboardView />;
}

type Item = { id: string; dashboard: Dashboard; mobile: boolean };

const defaultCreated = new Set<string>();

function DashboardView() {
  const ctx = useContextOrNull()!;
  const p = usePalette();
  const navigation = useNavigation();
  const file = usePortfolio((s) => s.file);
  const settings = useSettings();
  const mobileState = useMobileDashboards();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Config>>({});

  useEffect(() => {
    if (file) loadMobileDashboards(file.id);
  }, [file]);

  const items: Item[] = useMemo(
    () => [
      ...ctx.client.dashboards.map((d) => ({ id: `file:${d.id}`, dashboard: d, mobile: false })),
      ...mobileState.mobile.map((d) => ({ id: `mobile:${d.id}`, dashboard: d, mobile: true })),
    ],
    [ctx, mobileState.mobile],
  );

  // as in PP: create a default dashboard if there is none
  useEffect(() => {
    if (!file || !mobileState.loaded || mobileState.fileId !== file.id || items.length > 0 || defaultCreated.has(file.id)) return;
    defaultCreated.add(file.id);
    saveMobileDashboard(buildIndicatorDashboard('Dashboard'));
  }, [mobileState.loaded, mobileState.fileId, file, items.length]);

  const selectedId = settings.filters.dashboard;
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const select = (id: string) => updateSettings({ filters: { ...settingsStore.get().filters, dashboard: id } });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Pressable onPress={() => setPickerOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 260 }}>
          <T variant="headline" numberOfLines={1}>
            {selected?.dashboard.name ?? 'Dashboard'}
          </T>
          <Ionicons name="chevron-down" size={16} color={p.textSecondary} />
        </Pressable>
      ),
      headerRight: () =>
        selected ? (
          <Pressable
            onPress={() => {
              if (selected.mobile) router.push({ pathname: '/dashboard-edit', params: { id: selected.dashboard.id } });
              else {
                const copy = cloneDashboard(selected.dashboard, `${selected.dashboard.name} (mobil)`);
                saveMobileDashboard(copy);
                select(`mobile:${copy.id}`);
                router.push({ pathname: '/dashboard-edit', params: { id: copy.id } });
              }
            }}
            hitSlop={10}
            style={{ marginRight: spacing.l }}
            accessibilityLabel="Dashboard bearbeiten"
          >
            <Ionicons name={selected.mobile ? 'create-outline' : 'copy-outline'} size={22} color={p.accent} />
          </Pressable>
        ) : null,
    });
  }, [navigation, selected, p]);

  if (!mobileState.loaded) return <Loading />;
  if (!selected)
    return (
      <Screen>
        <EmptyState icon="grid-outline" title="Kein Dashboard" />
      </Screen>
    );

  const dashboard = selected.dashboard;
  const periodKey = `dashboard:${selected.id}`;
  const periods = ctx.reportingPeriods();
  const stored = settings.periods[periodKey] ? ReportingPeriod.tryFrom(settings.periods[periodKey]) : null;
  const fromDashboard = dashboard.configuration.REPORTING_PERIOD ? ReportingPeriod.tryFrom(dashboard.configuration.REPORTING_PERIOD) : null;
  const defaultPeriod = stored ?? fromDashboard ?? periods[0];
  const allPeriods = periods.some((x) => x.equals(defaultPeriod)) ? periods : [...periods, defaultPeriod];
  const env: DashboardEnv = { ctx, dashboard, defaultPeriod, columns: dashboard.columns.length };

  const widgetFor = (ci: number, wi: number, w: DashboardWidget): DashboardWidget => {
    const o = overrides[`${selected.id}:${ci}:${wi}`];
    return o ? { ...w, configuration: { ...w.configuration, ...o } } : w;
  };
  const update = (ci: number, wi: number) => (patch: Config) => {
    if (selected.mobile) {
      const d = cloneDashboard(dashboard, dashboard.name);
      d.id = dashboard.id;
      const target = d.columns[ci].widgets[wi];
      target.configuration = { ...target.configuration, ...patch };
      saveMobileDashboard(d);
    } else {
      const k = `${selected.id}:${ci}:${wi}`;
      setOverrides({ ...overrides, [k]: { ...(overrides[k] ?? {}), ...patch } });
    }
  };

  // flatten the columns; compact widgets are shown two per row
  const blocks: React.ReactNode[] = [];
  dashboard.columns.forEach((column, ci) => {
    let collapsed = false;
    let pending: React.ReactNode[] = [];
    const flush = () => {
      for (let i = 0; i < pending.length; i += 2)
        blocks.push(
          <View key={`row-${ci}-${blocks.length}`} style={{ flexDirection: 'row', gap: spacing.m }}>
            <View style={{ flex: 1 }}>{pending[i]}</View>
            <View style={{ flex: 1 }}>{pending[i + 1] ?? null}</View>
          </View>,
        );
      pending = [];
    };
    column.widgets.forEach((raw, wi) => {
      const w = widgetFor(ci, wi, raw);
      if (w.type === 'COLLAPSIBLE_SECTION') {
        flush();
        collapsed = w.configuration.COLLAPSED === 'true';
        blocks.push(
          <CollapsibleSectionWidget
            key={`w-${ci}-${wi}`}
            widget={w}
            env={env}
            update={update(ci, wi)}
            collapsed={collapsed}
            onToggle={() => update(ci, wi)({ COLLAPSED: String(!collapsed) })}
          />,
        );
        return;
      }
      if (collapsed) return;
      const spec = widgetSpec(w.type);
      const node = <WidgetHost key={`w-${ci}-${wi}`} widget={w} env={env} update={update(ci, wi)} />;
      if (spec?.compact) pending.push(node);
      else {
        flush();
        blocks.push(node);
      }
    });
    flush();
  });

  const create = (kind: 'INDICATORS' | 'EARNINGS' | 'EMPTY') => {
    const d =
      kind === 'INDICATORS' ? buildIndicatorDashboard('Kennzahlen') : kind === 'EARNINGS' ? buildEarningsDashboard('Erträge') : buildEmptyDashboard('Neues Dashboard');
    saveMobileDashboard(d);
    select(`mobile:${d.id}`);
  };

  return (
    <Screen>
      <RatesNotice />
      <PeriodChips
        periods={allPeriods}
        selected={defaultPeriod}
        onSelect={(x) => updateSettings({ periods: { ...settingsStore.get().periods, [periodKey]: x.getCode() } })}
      />
      {!selected.mobile ? (
        <T variant="small" tertiary>
          Dashboard aus der Desktop-Datei · Zum Anpassen oben rechts als mobiles Dashboard kopieren
        </T>
      ) : null}
      {blocks}
      {blocks.length === 0 ? (
        <EmptyState icon="grid-outline" title="Leeres Dashboard" message="Füge über „Bearbeiten“ Widgets hinzu.">
          {selected.mobile ? (
            <Button title="Bearbeiten" small onPress={() => router.push({ pathname: '/dashboard-edit', params: { id: dashboard.id } })} />
          ) : null}
        </EmptyState>
      ) : null}
      <OptionSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Dashboards"
        options={[
          ...items.map((i) => ({ key: i.id, label: i.dashboard.name, section: i.mobile ? 'Mobile Dashboards' : 'Dashboards der Datei' })),
          { key: 'new:INDICATORS', label: 'Neu: Kennzahlen', section: 'Neues Dashboard' },
          { key: 'new:EARNINGS', label: 'Neu: Erträge', section: 'Neues Dashboard' },
          { key: 'new:EMPTY', label: 'Neu: Leeres Dashboard', section: 'Neues Dashboard' },
        ]}
        selected={selected.id}
        onSelect={(k) => {
          if (k.startsWith('new:')) create(k.substring(4) as 'INDICATORS' | 'EARNINGS' | 'EMPTY');
          else select(k);
        }}
      />
    </Screen>
  );
}
