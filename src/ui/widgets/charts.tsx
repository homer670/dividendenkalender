// Chart widgets: ChartWidget, ClientDataSeriesChart, DrawdownChart, HoldingsChart, TaxonomyChart, Rebalancing, Activity

import React from 'react';
import { View } from 'react-native';

import { PortfolioTransaction, PortfolioTransactionType } from '../../core/model';
import { convertMoney } from '../../core/money/exchange';
import { money } from '../../core/money/money';
import { ClientSnapshot } from '../../core/snapshot/clientSnapshot';
import { aggregate, AggregationPeriod } from '../../core/snapshot/securityIndex';
import { PerformanceIndex } from '../../core/snapshot/performanceIndex';
import { today, year as yearOf, yearMonthKey } from '../../core/util/dates';
import {
  CLIENT_DATA_SERIES_LABELS,
  ClientDataSeries,
  COLOR_TEXT,
  hsbToHex,
  parseDataSeriesList,
  statementOfAssetsValues,
  UseCase,
} from '../../state/dataSeries';
import { BarChart } from '../charts/BarChart';
import { DonutChart, Slice } from '../charts/DonutChart';
import { LineChart, TimeSeries } from '../charts/LineChart';
import { formatAxis, formatMoney, formatNumber, formatPercent, monthName } from '../format';
import { buildTaxonomyModel } from '../calc/taxonomy';
import { T } from '../components/basic';
import { useComputed } from '../hooks';
import { usePalette } from '../theme';
import {
  cfg,
  DashboardEnv,
  widgetBool,
  widgetChartHeight,
  widgetDataSeries,
  widgetEnum,
  widgetEnumSet,
  widgetFilter,
  widgetInterval,
  widgetKey,
  widgetPeriod,
  widgetTaxonomy,
} from './env';
import { WidgetBody, WidgetCard } from './frame';
import { WidgetProps } from './special';

const AGGREGATIONS = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

function chartConfigData(env: DashboardEnv, useCase: UseCase, uuid: string | undefined): { name: string; data: string } {
  const setName = `${useCase === 'STATEMENT_OF_ASSETS' ? 'StatementOfAssetsHistoryView' : 'PerformanceChartView'}-PICKER`;
  const set = env.ctx.client.settings.configurationSets.get(setName) ?? [];
  const c = (uuid ? set.find((x) => x.uuid === uuid) : undefined) ?? set[0];
  return c ? { name: c.name, data: c.data } : { name: 'Ohne Namen', data: '' };
}

export function availableChartConfigs(env: DashboardEnv, useCase: UseCase): { uuid: string; name: string }[] {
  const setName = `${useCase === 'STATEMENT_OF_ASSETS' ? 'StatementOfAssetsHistoryView' : 'PerformanceChartView'}-PICKER`;
  return (env.ctx.client.settings.configurationSets.get(setName) ?? []).map((c) => ({ uuid: c.uuid, name: c.name }));
}

/** ChartWidget (performance chart and statement of assets chart) */
export function ChartWidget({ widget, env, useCase }: WidgetProps & { useCase: 'PERFORMANCE' | 'STATEMENT_OF_ASSETS' }) {
  const p = usePalette();
  const height = widgetChartHeight(widget);
  const state = useComputed(() => {
    const set = env.ctx.dataSeriesSet(useCase);
    const conf = chartConfigData(env, useCase, cfg(widget, 'CONFIG_UUID'));
    const series = parseDataSeriesList(set, conf.data).filter((s) => s.visible);
    const interval = widgetInterval(widget, env);
    const aggregationCode = cfg(widget, 'AGGREGATION');
    const aggregation = (AGGREGATIONS as readonly string[]).includes(aggregationCode ?? '') ? (aggregationCode as AggregationPeriod) : null;
    const out: TimeSeries[] = [];
    for (const s of series) {
      const index = env.ctx.calculate(s, interval);
      if (useCase === 'STATEMENT_OF_ASSETS') {
        const values = statementOfAssetsValues(s, index).map((v) => v / 100);
        out.push({ key: s.uuid, label: s.label, color: s.color, dates: index.dates, values, area: s.showArea, bar: !s.isLineChart, dashed: s.dashed });
      } else {
        const idx = aggregation ? aggregate(index, aggregation) : index;
        if (s.type === 'CLIENT' && s.instance === 'DELTA_PERCENTAGE')
          out.push({ key: s.uuid, label: aggregation ? AGG_LABELS[aggregation] : 'täglich', color: p.positive, colorNegative: p.negative, dates: idx.dates, values: idx.delta, bar: true });
        else out.push({ key: s.uuid, label: s.label, color: s.color, dates: idx.dates, values: idx.accumulated, area: s.showArea, dashed: s.dashed });
      }
    }
    return { series: out, name: conf.name };
  }, [env.ctx, widgetKey(widget, env), p.dark]);
  return (
    <WidgetCard title={widget.label} subtitle={`${widgetPeriod(widget, env).toString()}${state.value ? ` · ${state.value.name}` : ''}`}>
      <WidgetBody state={state} height={height}>
        {(v) => (
          <LineChart
            series={v.series}
            height={height}
            includeZero={useCase === 'PERFORMANCE'}
            formatValue={(x) => (useCase === 'PERFORMANCE' ? formatPercent(x) : formatMoney(money(env.ctx.termCurrency, Math.round(x * 100)), env.ctx.client.baseCurrency))}
            formatAxis={(x) => (useCase === 'PERFORMANCE' ? formatPercent(x, 0) : formatAxis(x))}
          />
        )}
      </WidgetBody>
    </WidgetCard>
  );
}

const AGG_LABELS: Record<AggregationPeriod, string> = { WEEKLY: 'wöchentlich', MONTHLY: 'monatlich', QUARTERLY: 'quartalsweise', YEARLY: 'jährlich' };

const ASPECTS = Object.keys(CLIENT_DATA_SERIES_LABELS).filter((k) => k !== 'DELTA_PERCENTAGE') as ClientDataSeries[];
export const CLIENT_DATA_SERIES_ASPECTS = ASPECTS;

const ASPECT_STYLE: Partial<Record<ClientDataSeries, { color: string; bar?: boolean; area?: boolean }>> = {
  INVESTED_CAPITAL: { color: '#EBC934', area: true },
  ABSOLUTE_INVESTED_CAPITAL: { color: '#EBC934', area: true },
  TRANSFERALS: { color: '#505050', bar: true },
  TRANSFERALS_ACCUMULATED: { color: '#E6C700', area: true },
  TAXES: { color: '#D13B3B', bar: true },
  TAXES_ACCUMULATED: { color: '#D13B3B', area: true },
  ABSOLUTE_DELTA: { color: '#2F5FD0' },
  ABSOLUTE_DELTA_ALL_RECORDS: { color: '#2F5FD0' },
  DIVIDENDS: { color: '#8B008B', bar: true },
  DIVIDENDS_ACCUMULATED: { color: '#8B008B' },
  INTEREST: { color: '#2E7D32', bar: true },
  INTEREST_ACCUMULATED: { color: '#2E7D32' },
  INTEREST_CHARGE: { color: '#2E7D32', bar: true },
  INTEREST_CHARGE_ACCUMULATED: { color: '#2E7D32' },
  EARNINGS: { color: '#2E7D32', bar: true },
  EARNINGS_ACCUMULATED: { color: '#2E7D32' },
  FEES: { color: '#909090', bar: true },
  FEES_ACCUMULATED: { color: '#909090' },
  TOTALS: { color: COLOR_TEXT },
};

/** ClientDataSeriesChartWidget */
export function ClientDataSeriesChartWidget({ widget, env }: WidgetProps) {
  const height = widgetChartHeight(widget);
  const ds = widgetDataSeries(widget, env);
  const state = useComputed(() => {
    let aspects = widgetEnumSet(widget, 'CLIENT_DATA_SERIES', ASPECTS);
    if (aspects.length === 0) aspects = ['TOTALS', 'INVESTED_CAPITAL', 'ABSOLUTE_DELTA'];
    const index = env.ctx.calculate(ds, widgetInterval(widget, env));
    // PP adds the series in a fixed order with TOTALS last
    const order: ClientDataSeries[] = [
      'INVESTED_CAPITAL',
      'ABSOLUTE_INVESTED_CAPITAL',
      'TRANSFERALS',
      'TRANSFERALS_ACCUMULATED',
      'TAXES',
      'TAXES_ACCUMULATED',
      'ABSOLUTE_DELTA',
      'ABSOLUTE_DELTA_ALL_RECORDS',
      'DIVIDENDS',
      'DIVIDENDS_ACCUMULATED',
      'INTEREST',
      'INTEREST_ACCUMULATED',
      'INTEREST_CHARGE',
      'INTEREST_CHARGE_ACCUMULATED',
      'EARNINGS',
      'EARNINGS_ACCUMULATED',
      'FEES',
      'FEES_ACCUMULATED',
      'TOTALS',
    ];
    const pseudo = { ...env.ctx.dataSeriesSet('STATEMENT_OF_ASSETS').defaultSeries() };
    return order
      .filter((a) => aspects.includes(a))
      .map((aspect): TimeSeries => {
        const st = ASPECT_STYLE[aspect]!;
        const values = statementOfAssetsValues({ ...pseudo, instance: aspect }, index).map((v) => v / 100);
        return {
          key: aspect,
          label: `${CLIENT_DATA_SERIES_LABELS[aspect]} (${ds.label})`,
          color: st.color,
          bar: st.bar,
          area: st.area,
          dates: index.dates,
          values,
        };
      });
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state} height={height}>
        {(series) => (
          <LineChart
            series={series}
            height={height}
            formatValue={(x) => formatMoney(money(env.ctx.termCurrency, Math.round(x * 100)), env.ctx.client.baseCurrency)}
            formatAxis={formatAxis}
          />
        )}
      </WidgetBody>
    </WidgetCard>
  );
}

/** DrawdownChartWidget */
export function DrawdownChartWidget({ widget, env }: WidgetProps) {
  const p = usePalette();
  const height = widgetChartHeight(widget);
  const ds = widgetDataSeries(widget, env);
  const state = useComputed(() => {
    const index: PerformanceIndex = env.ctx.calculate(ds, widgetInterval(widget, env));
    return { dates: index.dates, values: index.getDrawdown().getMaxDrawdownSerie() };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state} height={height}>
        {(v) => (
          <LineChart
            series={[{ key: 'dd', label: `Drawdown (${ds.label})`, color: p.negative, area: true, dates: v.dates, values: v.values }]}
            height={height}
            includeZero
            formatValue={(x) => formatPercent(x)}
            formatAxis={(x) => formatPercent(x, 0)}
          />
        )}
      </WidgetBody>
    </WidgetCard>
  );
}

/** CircularChart.PieColors */
export function pieColors(): () => string {
  let next = 0;
  const SIZE = 11;
  return () => {
    const brightness = Math.min(1.0, 0.886 + 0.05 * (next / SIZE));
    const hue = (262.3 + (360 / SIZE) * next++) % 360;
    return hsbToHex(hue, 0.464, brightness);
  };
}

/** HoldingsChartWidget */
export function HoldingsChartWidget({ widget, env }: WidgetProps) {
  const filter = widgetFilter(widget, env);
  const state = useComputed(() => {
    const snapshot = ClientSnapshot.create(env.ctx.filteredClient(filter.id), env.ctx.converter, today());
    const next = pieColors();
    const slices: Slice[] = snapshot
      .getAssetPositions()
      .filter((p) => p.getValuation().amount > 0)
      .sort((l, r) => r.getValuation().amount - l.getValuation().amount)
      .map((p) => ({ key: p.investmentVehicle.uuid, label: p.getDescription(), value: p.getValuation().amount, color: next() }));
    return { slices, total: snapshot.getMonetaryAssets() };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label}>
      <WidgetBody state={state} height={200}>
        {(v) => <DonutWithLegend slices={v.slices} env={env} centerValue={formatMoney(v.total, env.ctx.client.baseCurrency)} />}
      </WidgetBody>
    </WidgetCard>
  );
}

function DonutWithLegend({ slices, env, centerValue, outer, legend = 8 }: { slices: Slice[]; env: DashboardEnv; centerValue?: string; outer?: Slice[]; legend?: number }) {
  const p = usePalette();
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const base = env.ctx.client.baseCurrency;
  if (slices.length === 0)
    return (
      <T secondary variant="caption">
        Keine Werte
      </T>
    );
  return (
    <View style={{ gap: 8 }}>
      <DonutChart
        slices={slices}
        outerSlices={outer}
        size={190}
        centerValue={centerValue}
        formatValue={(v) => formatMoney(money(env.ctx.termCurrency, v), base)}
        formatShare={(s) => formatPercent(s)}
      />
      {slices.slice(0, legend).map((s) => (
        <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: s.color }} />
          <T variant="caption" style={{ flex: 1 }} numberOfLines={1}>
            {s.label}
          </T>
          <T variant="caption" numeric secondary>
            {formatPercent(total ? s.value / total : 0)}
          </T>
        </View>
      ))}
      {slices.length > legend ? (
        <T variant="small" color={p.textTertiary}>
          + {slices.length - legend} weitere
        </T>
      ) : null}
    </View>
  );
}

/** TaxonomyChartWidget and RebalancingTargetChartWidget */
export function TaxonomyChartWidget({ widget, env, target }: WidgetProps & { target?: boolean }) {
  const filter = widgetFilter(widget, env);
  const taxonomy = widgetTaxonomy(widget, env);
  const includeUnassigned = widgetBool(widget, 'FLAG_INCLUDE_UNASSIGNED', true);
  const includeSecurities = !target && widgetBool(widget, 'FLAG_INCLUDE_SECURITIES', true);
  const state = useComputed(() => {
    if (!taxonomy) return null;
    const model = buildTaxonomyModel(env.ctx.filteredClient(filter.id), env.ctx.converter, taxonomy, today());
    const nodes = model.classificationRoot.children.filter((n) => n.classification);
    const all = includeUnassigned && model.unassigned.actual !== 0 && !target ? [...nodes, model.unassigned] : nodes;
    const slices: Slice[] = all.map((n) => ({ key: n.key, label: n.name, value: Math.max(0, target ? (n.target ?? 0) : n.actual), color: n.color }));
    let outer: Slice[] | undefined;
    if (includeSecurities) {
      outer = [];
      const collect = (n: (typeof all)[number], color: string) => {
        for (const c of n.children) {
          if (c.assignment) outer!.push({ key: `${n.key}/${c.key}`, label: c.name, value: Math.max(0, c.actual), color });
          else collect(c, color);
        }
      };
      for (const n of all) collect(n, n.color);
    }
    return { slices, outer, total: target ? (model.virtualRoot.target ?? 0) : model.total };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={taxonomy?.name}>
      <WidgetBody state={state} height={200}>
        {(v) =>
          v ? (
            <DonutWithLegend slices={v.slices} outer={v.outer} env={env} centerValue={formatMoney(money(env.ctx.termCurrency, v.total), env.ctx.client.baseCurrency)} />
          ) : (
            <T secondary variant="caption">
              Keine Klassifizierung ausgewählt
            </T>
          )
        }
      </WidgetBody>
    </WidgetCard>
  );
}

/** RebalancingChartWidget: actual vs. target per top level classification */
export function RebalancingChartWidget({ widget, env }: WidgetProps) {
  const p = usePalette();
  const filter = widgetFilter(widget, env);
  const taxonomy = widgetTaxonomy(widget, env);
  const height = widgetChartHeight(widget);
  const state = useComputed(() => {
    if (!taxonomy) return null;
    const model = buildTaxonomyModel(env.ctx.filteredClient(filter.id), env.ctx.converter, taxonomy, today());
    const nodes = model.classificationRoot.children;
    return {
      labels: nodes.map((n) => n.name),
      actual: nodes.map((n) => n.actual / 100),
      target: nodes.map((n) => (n.target ?? 0) / 100),
      diff: nodes.map((n) => ((n.target ?? 0) - n.actual) / 100),
    };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={taxonomy?.name}>
      <WidgetBody state={state} height={height}>
        {(v) =>
          v ? (
            <BarChart
              labels={v.labels.map((l) => (l.length > 10 ? `${l.slice(0, 9)}…` : l))}
              series={[
                { label: 'Istwert', color: '#3C97DA', values: v.actual },
                { label: 'Sollwert', color: '#71AD46', values: v.target },
                { label: 'Delta', color: p.negative, values: v.diff },
              ]}
              height={height}
              formatValue={(x) => formatMoney(money(env.ctx.termCurrency, Math.round(x * 100)), env.ctx.client.baseCurrency)}
              formatAxis={formatAxis}
            />
          ) : (
            <T secondary variant="caption">
              Keine Klassifizierung ausgewählt
            </T>
          )
        }
      </WidgetBody>
    </WidgetCard>
  );
}

export const ACTIVITY_CHART_TYPES = ['COUNT', 'SUM', 'COUNT_BY_YEAR', 'SUM_BY_YEAR'] as const;
export const ACTIVITY_FILTERS = ['ALL_TRANSACTIONS', 'BUYS_ONLY', 'SELLS_ONLY', 'ALL_INBOUND', 'ALL_OUTBOUND'] as const;

/** ActivityWidget */
export function ActivityWidget({ widget, env }: WidgetProps) {
  const height = widgetChartHeight(widget);
  const filter = widgetFilter(widget, env);
  const state = useComputed(() => {
    const interval = widgetInterval(widget, env);
    const chartType = widgetEnum(widget, 'AGGREGATION', ACTIVITY_CHART_TYPES);
    const txFilter = widgetEnum(widget, 'TRANSACTION_FILTER', ACTIVITY_FILTERS);
    const byYear = chartType === 'SUM_BY_YEAR' || chartType === 'COUNT_BY_YEAR';
    const buckets = byYear ? interval.getYears() : interval.getYearMonths();
    const labels = buckets.map((b) => (byYear ? String(b) : `${monthName(b % 100, true)} ${String(Math.floor(b / 100)).slice(2)}`));
    const types: { type: PortfolioTransactionType; label: string; color: string }[] = [];
    const add = (type: PortfolioTransactionType, label: string, color: string) => types.push({ type, label, color });
    if (txFilter === 'ALL_TRANSACTIONS' || txFilter === 'ALL_INBOUND' || txFilter === 'BUYS_ONLY') add('BUY', 'Kauf', '#3b78bd');
    if (txFilter === 'ALL_TRANSACTIONS' || txFilter === 'ALL_INBOUND') add('DELIVERY_INBOUND', 'Einlieferung', '#7aa6d8');
    if (txFilter === 'ALL_TRANSACTIONS' || txFilter === 'ALL_OUTBOUND' || txFilter === 'SELLS_ONLY') add('SELL', 'Verkauf', '#e8892d');
    if (txFilter === 'ALL_TRANSACTIONS' || txFilter === 'ALL_OUTBOUND') add('DELIVERY_OUTBOUND', 'Auslieferung', '#f2b77f');
    const transactions = env.ctx.cached(`allTx|${filter.id}`, () => env.ctx.filteredClient(filter.id).getAllTransactions());
    const series = types.map((t) => {
      const values = new Array(buckets.length).fill(0);
      for (const pair of transactions) {
        const tx = pair.transaction;
        if (!(tx instanceof PortfolioTransaction) || tx.type !== t.type) continue;
        if (!interval.containsDateTime(tx.dateTime)) continue;
        const key = byYear ? yearOf(tx.date) : yearMonthKey(tx.date);
        const i = buckets.indexOf(key);
        if (i < 0) continue;
        if (chartType === 'COUNT' || chartType === 'COUNT_BY_YEAR') values[i] += 1;
        else values[i] += convertMoney(env.ctx.converter, tx.date, tx.getMonetaryAmount()).amount / 100;
      }
      return { label: t.label, color: t.color, values };
    });
    return { labels, series, count: chartType === 'COUNT' || chartType === 'COUNT_BY_YEAR' };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state} height={height}>
        {(v) => (
          <BarChart
            labels={v.labels}
            series={v.series}
            stacked
            height={height}
            minBarWidth={6}
            formatValue={(x) => (v.count ? formatNumber(x, 0) : formatMoney(money(env.ctx.termCurrency, Math.round(x * 100)), env.ctx.client.baseCurrency))}
            formatAxis={(x) => (v.count ? formatNumber(x, 0) : formatAxis(x))}
          />
        )}
      </WidgetBody>
    </WidgetCard>
  );
}

