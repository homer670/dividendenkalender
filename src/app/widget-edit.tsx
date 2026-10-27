import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Dashboard, DashboardWidget } from '@/core/model';
import { ReportingPeriod } from '@/core/snapshot/reportingPeriod';
import { today, year } from '@/core/util/dates';
import { cloneDashboard, saveMobileDashboard, useMobileDashboards } from '@/state/dashboards';
import { DataSeries, parseDataSeriesList, serializeDataSeriesList } from '@/state/dataSeries';
import { Card, EmptyState, ListCard, Row, Screen, SectionHeader, T } from '@/ui/components/basic';
import { OptionSheet, SheetOption } from '@/ui/components/Sheet';
import { formatDate } from '@/ui/format';
import { useContextOrNull } from '@/ui/hooks';
import { radius, spacing, usePalette } from '@/ui/theme';
import { availableChartConfigs } from '@/ui/widgets/charts';
import { cfg, DashboardEnv, dashboardSeriesSet, HEIGHT_LABELS, widgetBool, widgetCount, widgetEnum, widgetEnumSet, widgetStartYear } from '@/ui/widgets/env';
import { ConfigSpec, widgetSpec } from '@/ui/widgets/registry';

const SERIES_SECTIONS: Record<string, string> = {
  CLIENT: 'Gesamtportfolio',
  CLIENT_PRETAX: 'Vor Steuern',
  PORTFOLIO_PRETAX: 'Vor Steuern',
  PORTFOLIO_PLUS_ACCOUNT_PRETAX: 'Vor Steuern',
  ACCOUNT_PRETAX: 'Vor Steuern',
  CLIENT_FILTER_PRETAX: 'Vor Steuern',
  SECURITY: 'Wertpapiere',
  PORTFOLIO: 'Depots',
  PORTFOLIO_PLUS_ACCOUNT: 'Depots',
  ACCOUNT: 'Konten',
  CLASSIFICATION: 'Klassifizierungen',
  CLIENT_FILTER: 'Filter',
  SECURITY_BENCHMARK: 'Vergleich (Benchmark)',
};

export default function WidgetEditScreen() {
  const params = useLocalSearchParams<{ dashboard: string; column: string; index: string }>();
  const ctx = useContextOrNull();
  const { mobile } = useMobileDashboards();
  const dashboard = mobile.find((d) => d.id === params.dashboard);
  const ci = Number(params.column);
  const wi = Number(params.index);
  const widget = dashboard?.columns[ci]?.widgets[wi];
  if (!ctx || !dashboard || !widget)
    return (
      <Screen>
        <EmptyState title="Widget nicht gefunden" />
      </Screen>
    );
  return <Editor dashboard={dashboard} ci={ci} wi={wi} widget={widget} />;
}

function Editor({ dashboard, ci, wi, widget }: { dashboard: Dashboard; ci: number; wi: number; widget: DashboardWidget }) {
  const ctx = useContextOrNull()!;
  const p = usePalette();
  const spec = widgetSpec(widget.type);
  const [label, setLabel] = useState(widget.label);
  const [sheet, setSheet] = useState<{ title: string; options: SheetOption<string>[]; selected: string | null; onSelect: (k: string) => void } | null>(null);
  const env: DashboardEnv = { ctx, dashboard, defaultPeriod: ctx.reportingPeriods()[0], columns: dashboard.columns.length };

  const save = (mutate: (w: DashboardWidget) => void) => {
    const d = cloneDashboard(dashboard, dashboard.name);
    d.id = dashboard.id;
    mutate(d.columns[ci].widgets[wi]);
    saveMobileDashboard(d);
  };
  const setKey = (key: string, value: string | null) =>
    save((w) => {
      if (value === null || value === '') delete w.configuration[key];
      else w.configuration[key] = value;
    });

  const seriesOptions = (benchmarks: boolean, predicate?: (ds: DataSeries) => boolean): SheetOption<string>[] =>
    dashboardSeriesSet(env)
      .availableSeries.filter((s) => (benchmarks ? true : !s.isBenchmark))
      .filter((s) => !predicate || predicate(s))
      .map((s) => ({ key: s.uuid, label: s.label, section: SERIES_SECTIONS[s.type] ?? s.type }))
      .sort((a, b) => sectionRank(a.section) - sectionRank(b.section));

  const rows: React.ReactNode[] = [];
  for (const [i, c] of (spec?.configs ?? []).entries()) rows.push(<React.Fragment key={i}>{renderConfig(c)}</React.Fragment>);

  function renderConfig(c: ConfigSpec): React.ReactNode {
    switch (c.kind) {
      case 'period': {
        const code = cfg(widget, 'REPORTING_PERIOD');
        const current = code ? ReportingPeriod.tryFrom(code) : null;
        const periods = ctx.reportingPeriods();
        const presets = ['W', 'M', 'Q', 'X', 'P', 'E', 'A', 'B', 'C', 'Z', 'D7', 'D30', 'T1', 'T20', 'L0Y6', 'L1Y0', 'L2Y0', 'L3Y0', 'L5Y0', 'L10Y0', ...(c.pastAndFuture ? ['G', 'H'] : [])];
        const y = year(today());
        for (let k = 0; k < 6; k++) presets.push(`Y${y - k}`);
        return (
          <Row
            title="Berichtszeitraum"
            value={current ? current.toString() : 'Dashboard-Standard'}
            onPress={() =>
              setSheet({
                title: 'Berichtszeitraum',
                selected: code ?? '',
                options: [
                  { key: '', label: 'Dashboard-Standard verwenden' },
                  ...periods.map((x) => ({ key: x.getCode(), label: x.toString(), section: 'Aus der Datei' })),
                  ...presets
                    .filter((pc) => !periods.some((x) => x.getCode() === pc))
                    .map((pc) => {
                      const per = ReportingPeriod.from(pc);
                      const iv = per.toInterval(today());
                      return { key: pc, label: per.toString(), subtitle: `${formatDate(iv.start + 1)} – ${formatDate(iv.end)}`, section: 'Weitere' };
                    }),
                ],
                onSelect: (k) => setKey('REPORTING_PERIOD', k || null),
              })
            }
          />
        );
      }
      case 'dataSeries': {
        const current = dashboardSeriesSet(env).lookup(cfg(widget, c.key));
        return (
          <Row
            title={c.label}
            value={current ? current.label : c.allowEmpty ? 'Keine' : 'Gesamtportfolio'}
            onPress={() =>
              setSheet({
                title: c.label,
                selected: cfg(widget, c.key) ?? '',
                options: [...(c.allowEmpty ? [{ key: '', label: 'Keine' }] : []), ...seriesOptions(c.benchmarks, c.predicate)],
                onSelect: (k) => setKey(c.key, k || null),
              })
            }
          />
        );
      }
      case 'multiDataSeries': {
        const set = dashboardSeriesSet(env);
        const selected = parseDataSeriesList(set, cfg(widget, 'DATA_SERIES'));
        return (
          <View>
            <Row title="Datenreihen" value={`${selected.length} ausgewählt`} />
            {seriesOptions(true).map((o) => {
              const on = selected.some((s) => s.uuid === o.key);
              return (
                <Pressable
                  key={o.key}
                  onPress={() => {
                    const next = on ? selected.filter((s) => s.uuid !== o.key) : [...selected, set.lookup(o.key)!];
                    setKey('DATA_SERIES', serializeDataSeriesList(next));
                  }}
                  style={styles.check}
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? p.accent : p.textTertiary} />
                  <T variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                    {o.label}
                  </T>
                  <T variant="small" tertiary>
                    {o.section}
                  </T>
                </Pressable>
              );
            })}
          </View>
        );
      }
      case 'clientFilter': {
        const id = cfg(widget, 'CLIENT_FILTER') ?? '';
        const item = ctx.filterItems.find((x) => x.id === id) ?? ctx.filterItems[0];
        return (
          <Row
            title="Filter"
            value={item.label}
            onPress={() =>
              setSheet({
                title: 'Filter',
                selected: item.id,
                options: ctx.filterItems.map((x) => ({ key: x.id, label: x.label, section: x.custom ? 'Eigene Filter' : 'Standard' })),
                onSelect: (k) => setKey('CLIENT_FILTER', k),
              })
            }
          />
        );
      }
      case 'enum': {
        const values = c.options.map((o) => o.value);
        if (c.multiple) {
          const selected = widgetEnumSet(widget, c.key, values);
          return (
            <View>
              <Row title={c.label} value={selected.length === 0 ? '–' : `${selected.length} ausgewählt`} />
              {c.options.map((o) => {
                const on = selected.includes(o.value);
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => {
                      const next = on ? selected.filter((v) => v !== o.value) : [...selected, o.value];
                      setKey(c.key, values.filter((v) => next.includes(v)).join(','));
                    }}
                    style={styles.check}
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? p.accent : p.textTertiary} />
                    <T variant="caption">{o.label}</T>
                  </Pressable>
                );
              })}
            </View>
          );
        }
        const raw = cfg(widget, c.key);
        const current = values.includes('') ? (raw ?? '') : widgetEnum(widget, c.key, values);
        return (
          <Row
            title={c.label}
            value={c.options.find((o) => o.value === current)?.label ?? current}
            onPress={() =>
              setSheet({
                title: c.label,
                selected: current,
                options: c.options.map((o) => ({ key: o.value, label: o.label })),
                onSelect: (k) => setKey(c.key, k || null),
              })
            }
          />
        );
      }
      case 'bool':
        return <Row title={c.label} value={<Switch value={widgetBool(widget, c.key, c.defaultValue)} onValueChange={(v) => setKey(c.key, String(v))} />} />;
      case 'count':
        return (
          <Row
            title="Anzahl"
            value={String(widgetCount(widget))}
            onPress={() =>
              setSheet({
                title: 'Anzahl',
                selected: String(widgetCount(widget)),
                options: Array.from({ length: 10 }, (_, k) => ({ key: String(k + 1), label: String(k + 1) })),
                onSelect: (k) => setKey('COUNT', k),
              })
            }
          />
        );
      case 'height': {
        const code = cfg(widget, 'HEIGHT') ?? 'NORMAL';
        return (
          <Row
            title="Höhe"
            value={HEIGHT_LABELS[code as keyof typeof HEIGHT_LABELS] ?? 'Normal'}
            onPress={() =>
              setSheet({
                title: 'Höhe',
                selected: code,
                options: Object.entries(HEIGHT_LABELS).map(([k, l]) => ({ key: k, label: l })),
                onSelect: (k) => setKey('HEIGHT', k),
              })
            }
          />
        );
      }
      case 'taxonomy': {
        const id = cfg(widget, 'TAXONOMY');
        const t = ctx.client.taxonomies.find((x) => x.id === id) ?? ctx.client.taxonomies[0];
        return (
          <Row
            title="Klassifizierung"
            value={t ? t.name : '–'}
            onPress={() =>
              setSheet({
                title: 'Klassifizierung',
                selected: t?.id ?? null,
                options: ctx.client.taxonomies.map((x) => ({ key: x.id, label: x.name })),
                onSelect: (k) => setKey('TAXONOMY', k),
              })
            }
          />
        );
      }
      case 'startYear': {
        const sy = widgetStartYear(widget, c.offset);
        const now = year(today());
        return (
          <Row
            title="Ab Jahr"
            value={String(sy)}
            onPress={() =>
              setSheet({
                title: 'Ab Jahr',
                selected: String(sy),
                options: Array.from({ length: 20 }, (_, k) => ({ key: String(now - k), label: String(now - k) })),
                onSelect: (k) => setKey('START_YEAR', k),
              })
            }
          />
        );
      }
      case 'attribute': {
        const types = ctx.client.settings.attributeTypes.filter((t) => t.target === 'name.abuchen.portfolio.model.Security' && t.type === c.valueType);
        const id = cfg(widget, 'ATTRIBUTE_UUID');
        const t = types.find((x) => x.id === id);
        return (
          <Row
            title="Attribut"
            value={t ? t.name : 'Alle Attribute'}
            onPress={() =>
              setSheet({
                title: 'Attribut',
                selected: t?.id ?? '',
                options: [{ key: '', label: 'Alle Attribute' }, ...types.map((x) => ({ key: x.id, label: x.name }))],
                onSelect: (k) => setKey('ATTRIBUTE_UUID', k || null),
              })
            }
          />
        );
      }
      case 'exchangeRate': {
        const all = ctx.factory
          .getAvailableTimeSeries()
          .slice()
          .sort((a, b) => a.baseCurrency.localeCompare(b.baseCurrency) || a.termCurrency.localeCompare(b.termCurrency));
        const code = cfg(widget, 'EXCHANGE_RATE_SERIES') ?? 'EUR/USD';
        return (
          <Row
            title="Wechselkurs"
            value={code}
            onPress={() =>
              setSheet({
                title: 'Wechselkurs',
                selected: code,
                options: all.map((s) => ({ key: `${s.baseCurrency}/${s.termCurrency}`, label: `${s.baseCurrency}/${s.termCurrency}`, subtitle: s.providerName })),
                onSelect: (k) => setKey('EXCHANGE_RATE_SERIES', k),
              })
            }
          />
        );
      }
      case 'chartConfig': {
        const configs = availableChartConfigs(env, c.useCase);
        const id = cfg(widget, 'CONFIG_UUID');
        const current = configs.find((x) => x.uuid === id) ?? configs[0];
        return (
          <Row
            title="Diagramm"
            value={current ? current.name : 'Standard'}
            onPress={() =>
              configs.length > 0 &&
              setSheet({
                title: 'Diagramm (aus der Datei)',
                selected: current?.uuid ?? null,
                options: configs.map((x) => ({ key: x.uuid, label: x.name })),
                onSelect: (k) => setKey('CONFIG_UUID', k),
              })
            }
          />
        );
      }
      case 'url':
        return <TextConfig title="URL" value={cfg(widget, 'URL') ?? ''} onCommit={(v) => setKey('URL', v || null)} keyboard="url" />;
      case 'spacerHeight':
        return <TextConfig title="Höhe (Pixel)" value={cfg(widget, 'HEIGHT') ?? '20'} onCommit={(v) => /^\d+$/.test(v) && Number(v) >= 5 && setKey('HEIGHT', v)} keyboard="number-pad" />;
      case 'fire':
        return <Row title="FIRE-Werte" subtitle="Werte direkt im Widget durch Antippen setzen" />;
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: spec?.label ?? 'Widget',
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={10} style={{ paddingHorizontal: spacing.s }}>
              <T weight="600" color={p.accent}>
                Fertig
              </T>
            </Pressable>
          ),
        }}
      />
      <Screen>
        <Card style={{ gap: spacing.s }}>
          <T variant="caption" secondary>
            Beschriftung
          </T>
          <TextInput
            value={label}
            onChangeText={setLabel}
            multiline={widget.type === 'DESCRIPTION'}
            onBlur={() => save((w) => (w.label = label))}
            onEndEditing={() => save((w) => (w.label = label))}
            style={[styles.input, { backgroundColor: p.inputBackground, color: p.text }, widget.type === 'DESCRIPTION' ? { minHeight: 90 } : null]}
          />
        </Card>
        {rows.length > 0 ? (
          <View>
            <SectionHeader title="Konfiguration" />
            <ListCard>{rows}</ListCard>
          </View>
        ) : null}
      </Screen>
      {sheet ? (
        <OptionSheet visible onClose={() => setSheet(null)} title={sheet.title} options={sheet.options} selected={sheet.selected} onSelect={sheet.onSelect} />
      ) : null}
    </>
  );
}

function TextConfig({ title, value, onCommit, keyboard }: { title: string; value: string; onCommit: (v: string) => void; keyboard: 'url' | 'number-pad' }) {
  const p = usePalette();
  const [text, setText] = useState(value);
  return (
    <View style={{ padding: spacing.l, gap: 6 }}>
      <T variant="caption" secondary>
        {title}
      </T>
      <TextInput
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboard}
        onBlur={() => onCommit(text.trim())}
        onSubmitEditing={() => onCommit(text.trim())}
        style={[styles.input, { backgroundColor: p.inputBackground, color: p.text }]}
      />
    </View>
  );
}

const ORDER = ['Gesamtportfolio', 'Depots', 'Konten', 'Filter', 'Wertpapiere', 'Klassifizierungen', 'Vor Steuern', 'Vergleich (Benchmark)'];
function sectionRank(s: string | undefined): number {
  const i = ORDER.indexOf(s ?? '');
  return i < 0 ? 99 : i;
}

const styles = StyleSheet.create({
  input: { borderRadius: radius.s, paddingHorizontal: spacing.m, paddingVertical: spacing.s + 2, fontSize: 16 },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingHorizontal: spacing.l, paddingVertical: 8 },
});
