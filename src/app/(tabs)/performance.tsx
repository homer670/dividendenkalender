import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { money } from '@/core/money/money';
import { Security } from '@/core/model';
import { sortRecordsByName } from '@/core/snapshot/securityPerformance';
import { performanceIndexForSecurity } from '@/core/snapshot/securityIndex';
import { settingsStore, updateSettings, useSettings } from '@/state/settings';
import { COLOR_TEXT } from '@/state/dataSeries';
import { Button, Card, ListCard, Row, Screen, SectionHeader, Segmented, T } from '@/ui/components/basic';
import { Kpi, Pending } from '@/ui/components/common';
import { CalculationTable } from '@/ui/components/perf';
import { FilterButton, PeriodChips } from '@/ui/components/pickers';
import { OptionSheet } from '@/ui/components/Sheet';
import { LineChart, TimeSeries } from '@/ui/charts/LineChart';
import { formatAxis, formatDate, formatMoney, formatPercent, formatPercentAnnualized } from '@/ui/format';
import { RatesNotice } from '@/ui/components/RatesNotice';
import { useClientFilter, useComputed, useContextOrNull, usePeriod } from '@/ui/hooks';
import { spacing } from '@/ui/theme';

type ChartMode = 'performance' | 'assets' | 'delta';
type SortMode = 'name' | 'delta' | 'irr';

export default function PerformanceScreen() {
  const ctx = useContextOrNull();
  if (!ctx) return null;
  return <Performance />;
}

function Performance() {
  const ctx = useContextOrNull()!;
  const settings = useSettings();
  const period = usePeriod('performance', ctx);
  const filter = useClientFilter('performance', ctx);
  const [mode, setMode] = useState<ChartMode>('performance');
  const [sort, setSort] = useState<SortMode>('name');
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const benchmarkId = settings.filters['performance.benchmark'] ?? '';
  const benchmark: Security | null = ctx.client.securities.find((s) => s.uuid === benchmarkId) ?? null;
  const fifo = settings.costMethod === 'FIFO';

  const state = useComputed(() => {
    const series = ctx.dataSeriesSet('PERFORMANCE').defaultSeries();
    const index = ctx.filteredCache(filter.item.id).lookup(series, period.interval);
    const snapshot = index.getClientPerformanceSnapshot(fifo);
    const bench = benchmark ? performanceIndexForSecurity(index, benchmark) : null;
    const dd = index.getDrawdown();
    const vola = index.getVolatility();
    return {
      index,
      snapshot,
      bench,
      ttwror: index.getFinalAccumulatedPercentage(),
      ttwrorPa: index.getFinalAccumulatedAnnualizedPercentage(),
      irr: index.getPerformanceIRR(),
      absoluteChange: index.totals[index.totals.length - 1] - index.totals[0],
      delta: snapshot.getAbsoluteDelta().amount,
      maxDD: dd.getMaxDrawdown(),
      maxDDInterval: dd.getIntervalOfMaxDrawdown(),
      volatility: vola.getStandardDeviation(),
      semiVolatility: vola.getSemiDeviation(),
    };
  }, [ctx, filter.item.id, period.interval.start, period.interval.end, fifo, benchmark]);

  const term = ctx.termCurrency;
  const fm = (v: number) => formatMoney(money(term, v), term);

  return (
    <Screen>
      <RatesNotice />
      <PeriodChips periods={period.periods} selected={period.period} onSelect={period.setPeriod} />
      <FilterButton items={filter.items} selected={filter.item} onSelect={filter.setFilter} />
      <Pending state={state}>
        {(r) => {
          let series: TimeSeries[];
          if (mode === 'performance') {
            series = [{ key: 'ttwror', label: 'Gesamtportfolio', color: COLOR_TEXT, dates: r.index.dates, values: r.index.accumulated }];
            if (r.bench)
              series.push({ key: 'bench', label: benchmark!.name, color: '#eb6834', dates: r.bench.dates, values: r.bench.accumulated });
          } else if (mode === 'assets') {
            series = [
              { key: 'totals', label: 'Gesamtsumme', color: COLOR_TEXT, dates: r.index.dates, values: r.index.totals.map((v) => v / 100) },
              {
                key: 'invested',
                label: 'Investiertes Kapital',
                color: '#EBC934',
                area: true,
                dates: r.index.dates,
                values: r.index.calculateInvestedCapital().map((v) => v / 100),
              },
            ];
          } else {
            series = [
              {
                key: 'delta',
                label: 'Delta',
                color: '#2a78d6',
                area: true,
                dates: r.index.dates,
                values: r.index.calculateDelta().map((v) => v / 100),
              },
            ];
          }
          const records = r.snapshot.securityPerformance ? sortRecordsByName(r.snapshot.securityPerformance.records) : [];
          if (sort === 'delta') records.sort((a, b) => b.getDelta().amount - a.getDelta().amount);
          if (sort === 'irr') records.sort((a, b) => (Number.isNaN(b.getIrr()) ? -Infinity : b.getIrr()) - (Number.isNaN(a.getIrr()) ? -Infinity : a.getIrr()));
          return (
            <>
              <Card style={{ gap: spacing.m }}>
                <Segmented
                  items={[
                    { key: 'performance', label: 'Performance' },
                    { key: 'assets', label: 'Vermögen' },
                    { key: 'delta', label: 'Delta' },
                  ]}
                  selected={mode}
                  onSelect={setMode}
                />
                <LineChart
                  series={series}
                  height={210}
                  includeZero={mode !== 'assets'}
                  formatValue={(v) => (mode === 'performance' ? formatPercent(v) : formatMoney(money(term, Math.round(v * 100)), term))}
                  formatAxis={(v) => (mode === 'performance' ? formatPercent(v, 0) : formatAxis(v))}
                />
                {mode === 'performance' ? (
                  <Button
                    small
                    kind="secondary"
                    icon="git-compare-outline"
                    title={benchmark ? `Vergleich: ${benchmark.name}` : 'Mit Wertpapier/Index vergleichen'}
                    onPress={() => setBenchmarkOpen(true)}
                  />
                ) : null}
              </Card>
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
                  <Kpi label="True-Time-Weighted Rate of Return (TTWROR)" value={formatPercent(r.ttwror)} signed={r.ttwror} />
                  <Kpi label="TTWROR (p.a.)" value={formatPercentAnnualized(r.ttwrorPa)} signed={r.ttwrorPa} />
                  <Kpi label="Interner Zinsfuß (IZF)" value={formatPercentAnnualized(r.irr)} signed={r.irr} />
                  <Kpi label="Absolute Veränderung" value={fm(r.absoluteChange)} signed={r.absoluteChange} />
                  <Kpi label="Delta" value={fm(r.delta)} signed={r.delta} />
                  <Kpi
                    label="Maximaler Drawdown"
                    value={formatPercent(r.maxDD)}
                    sub={`${formatDate(r.maxDDInterval.start)} – ${formatDate(r.maxDDInterval.end)}`}
                  />
                  <Kpi label="Volatilität" value={formatPercent(r.volatility)} />
                  <Kpi label="Semivolatilität" value={formatPercent(r.semiVolatility)} />
                </View>
              </Card>
              <View>
                <SectionHeader title="Performance-Berechnung" />
                <Card>
                  <CalculationTable snapshot={r.snapshot} />
                </Card>
              </View>
              <View>
                <SectionHeader title="Wertpapiere" />
                <Segmented
                  items={[
                    { key: 'name', label: 'Name' },
                    { key: 'delta', label: 'Delta' },
                    { key: 'irr', label: 'IZF' },
                  ]}
                  selected={sort}
                  onSelect={setSort}
                />
              </View>
              {records.length === 0 ? (
                <T secondary>Keine Wertpapiere im Berichtszeitraum.</T>
              ) : (
                <ListCard>
                  {records.map((rec) => (
                    <Row
                      key={rec.security.uuid}
                      title={rec.security.name}
                      subtitle={`IZF ${formatPercent(rec.getIrr())} · TTWROR ${formatPercent(rec.getTrueTimeWeightedRateOfReturn())}`}
                      value={formatMoney(rec.getDelta(), term)}
                      valueSigned={rec.getDelta().amount}
                      detail={formatMoney(rec.getMarketValue(), term)}
                      onPress={() => router.push({ pathname: '/security/[id]', params: { id: rec.security.uuid } })}
                    />
                  ))}
                </ListCard>
              )}
            </>
          );
        }}
      </Pending>
      <OptionSheet
        visible={benchmarkOpen}
        onClose={() => setBenchmarkOpen(false)}
        title="Vergleichen mit"
        options={[
          { key: '', label: 'Kein Vergleich' },
          ...ctx.client.securities
            .filter((s) => s.prices.length > 0)
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, 'de'))
            .map((s) => ({ key: s.uuid, label: s.name, subtitle: s.isin ?? s.tickerSymbol ?? undefined })),
        ]}
        selected={benchmarkId}
        onSelect={(id) => updateSettings({ filters: { ...settingsStore.get().filters, 'performance.benchmark': id } })}
      />
    </Screen>
  );
}
