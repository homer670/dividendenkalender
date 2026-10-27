// IndicatorWidget based widgets of WidgetFactory

import { router } from 'expo-router';
import React from 'react';

import { DashboardWidget, Security } from '../../core/model';
import { Money, money } from '../../core/money/money';
import { PerformanceIndex } from '../../core/snapshot/performanceIndex';
import { AllTimeHigh } from '../../core/snapshot/securityIndex';
import { today } from '../../core/util/dates';
import { Interval } from '../../core/util/interval';
import { DataSeries } from '../../state/dataSeries';
import { formatDate, formatDateLong, formatMoney, formatNumber, formatPercent, formatQuote } from '../format';
import { useComputed } from '../hooks';
import { msg } from '../i18n';
import { usePalette } from '../theme';
import { DashboardEnv, widgetBool, widgetDataSeries, widgetInterval, widgetKey, widgetPeriod } from './env';
import { KpiCard } from './frame';

export type IndicatorFormat = 'money' | 'percent' | 'annualized' | 'plain' | 'quote';

export interface IndicatorDef<N> {
  format: IndicatorFormat;
  provider: (env: DashboardEnv, ds: DataSeries, interval: Interval) => N;
  tooltip?: (env: DashboardEnv, ds: DataSeries, interval: Interval) => string | null;
  colored?: boolean;
  supportsBenchmarks?: boolean;
  predicate?: (ds: DataSeries) => boolean;
}

function formatValue(env: DashboardEnv, format: IndicatorFormat, value: unknown): string {
  const base = env.ctx.client.baseCurrency;
  if (value && typeof value === 'object' && 'currencyCode' in (value as Money)) return formatMoney(value as Money, base);
  const n = value as number;
  switch (format) {
    case 'percent':
      return formatPercent(n);
    case 'annualized':
      return `${formatPercent(n)} p.a.`;
    case 'plain':
      return Number.isNaN(n) ? '-' : formatNumber(n, 2);
    case 'quote':
      return formatQuote(n);
    case 'money':
      return formatMoney(money(env.ctx.termCurrency, n), base);
  }
}

function isNegative(value: unknown): boolean {
  if (value && typeof value === 'object' && 'amount' in (value as Money)) return (value as Money).amount < 0;
  return typeof value === 'number' && value < 0;
}

export function IndicatorWidget<N>({ widget, env, def }: { widget: DashboardWidget; env: DashboardEnv; def: IndicatorDef<N> }) {
  const p = usePalette();
  const ds = widgetDataSeries(widget, env);
  const period = widgetPeriod(widget, env);
  const state = useComputed(() => {
    const interval = widgetInterval(widget, env);
    const value = def.provider(env, ds, interval);
    const tooltip = def.tooltip ? def.tooltip(env, ds, interval) : null;
    return { value, tooltip };
  }, [env.ctx, widgetKey(widget, env)]);
  const colored = def.colored !== false && widgetBool(widget, 'FLAG_COLORED_VALUE', true);
  const value = state.value?.value;
  const color = state.value && colored ? (isNegative(value) ? p.negative : p.positive) : undefined;
  const subtitle = ds.type === 'CLIENT' ? period.toString() : `${period.toString()} · ${ds.label}`;
  return (
    <KpiCard
      title={widget.label}
      value={state.error ? 'Fehler' : state.value ? formatValue(env, def.format, value) : ''}
      color={color}
      subtitle={subtitle}
      info={state.error ? state.error.message : state.value?.tooltip}
      loading={state.loading && !state.value}
      onPress={ds.instance instanceof Security ? () => router.push({ pathname: '/security/[id]', params: { id: (ds.instance as Security).uuid } }) : undefined}
    />
  );
}

const calc = (env: DashboardEnv, ds: DataSeries, interval: Interval): PerformanceIndex => env.ctx.calculate(ds, interval);
const last = (a: number[]) => (a.length > 0 ? a[a.length - 1] : 0);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

function currentDrawdown(index: PerformanceIndex): { value: number; highIndex: number } {
  const accumulated = index.accumulated;
  if (accumulated.length === 0) return { value: 0, highIndex: 0 };
  let high = Number.NEGATIVE_INFINITY;
  let highIndex = 0;
  for (let i = 0; i < accumulated.length; i++)
    if (accumulated[i] > high) {
      high = accumulated[i];
      highIndex = i;
    }
  if (high <= 0) return { value: 0, highIndex };
  const current = accumulated[accumulated.length - 1];
  if (current < high) {
    const peak = 1 + high;
    return { value: -(peak - (1 + current)) / peak, highIndex };
  }
  return { value: 0, highIndex };
}

function riskFreeRate(env: DashboardEnv): number {
  const v = env.ctx.client.getProperty('risk-free-rate-of-return');
  if (v == null) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export const INDICATORS: Record<string, IndicatorDef<unknown>> = {
  TOTAL_SUM: {
    format: 'money',
    provider: (env, ds, iv) => {
      const index = calc(env, ds, iv);
      return money(index.currency, last(index.totals));
    },
    supportsBenchmarks: false,
  },
  TTWROR: { format: 'percent', provider: (env, ds, iv) => calc(env, ds, iv).getFinalAccumulatedPercentage() },
  TTWROR_ANNUALIZED: { format: 'annualized', provider: (env, ds, iv) => calc(env, ds, iv).getFinalAccumulatedAnnualizedPercentage() },
  IRR: { format: 'annualized', provider: (env, ds, iv) => calc(env, ds, iv).getPerformanceIRR() },
  ABSOLUTE_CHANGE: {
    format: 'money',
    provider: (env, ds, iv) => {
      const index = calc(env, ds, iv);
      return money(index.currency, last(index.totals) - index.totals[0]);
    },
    supportsBenchmarks: false,
  },
  DELTA: {
    format: 'money',
    provider: (env, ds, iv) => money(env.ctx.termCurrency, last(calc(env, ds, iv).calculateDelta())),
    supportsBenchmarks: false,
  },
  ABSOLUTE_DELTA: {
    format: 'money',
    provider: (env, ds, iv) => money(env.ctx.termCurrency, last(calc(env, ds, iv).calculateAbsoluteDelta())),
    supportsBenchmarks: false,
  },
  SAVINGS: {
    format: 'money',
    provider: (env, ds, iv) => {
      const d = calc(env, ds, iv).getTransferals();
      return money(env.ctx.termCurrency, d.length > 1 ? sum(d.slice(1)) : 0);
    },
    supportsBenchmarks: false,
  },
  INVESTED_CAPITAL: {
    format: 'money',
    provider: (env, ds, iv) => money(env.ctx.termCurrency, last(calc(env, ds, iv).calculateInvestedCapital())),
    supportsBenchmarks: false,
  },
  ABSOLUTE_INVESTED_CAPITAL: {
    format: 'money',
    provider: (env, ds, iv) => money(env.ctx.termCurrency, last(calc(env, ds, iv).calculateAbsoluteInvestedCapital())),
    supportsBenchmarks: false,
  },
  MAXDRAWDOWN: {
    format: 'percent',
    provider: (env, ds, iv) => calc(env, ds, iv).getDrawdown().getMaxDrawdown(),
    tooltip: (env, ds, iv) => {
      const dd = calc(env, ds, iv).getDrawdown();
      return msg('TooltipMaxDrawdown', formatDateLong(dd.getIntervalOfMaxDrawdown().start), formatDateLong(dd.getIntervalOfMaxDrawdown().end));
    },
    colored: false,
  },
  CURRENT_DRAWDOWN: {
    format: 'percent',
    provider: (env, ds, iv) => currentDrawdown(calc(env, ds, iv)).value,
    tooltip: (env, ds, iv) => {
      const index = calc(env, ds, iv);
      if (index.accumulated.length === 0) return msg('TooltipCurrentDrawdown');
      return msg('TooltipCurrentDrawdown', formatDateLong(iv.start + currentDrawdown(index).highIndex));
    },
    colored: true,
  },
  VOLATILITY: {
    format: 'percent',
    provider: (env, ds, iv) => calc(env, ds, iv).getVolatility().getStandardDeviation(),
    tooltip: () => msg('TooltipVolatility'),
    colored: false,
  },
  SHARPE_RATIO: {
    format: 'plain',
    provider: (env, ds, iv) => {
      const index = calc(env, ds, iv);
      const r = index.getPerformanceIRR();
      const rf = riskFreeRate(env);
      if (Number.isNaN(rf)) return NaN;
      return (r - rf) / index.getVolatility().getStandardDeviation();
    },
    tooltip: (env, ds, iv) => {
      const index = calc(env, ds, iv);
      const r = index.getPerformanceIRR();
      const rf = riskFreeRate(env);
      const v = index.getVolatility().getStandardDeviation();
      return msg('TooltipSharpeRatio', formatPercent(r, 5), formatPercent(rf), formatNumber(v, 3), formatNumber((r - rf) / v, 3));
    },
    colored: false,
  },
  SEMIVOLATILITY: {
    format: 'percent',
    provider: (env, ds, iv) => calc(env, ds, iv).getVolatility().getSemiDeviation(),
    tooltip: (env, ds, iv) => {
      const v = calc(env, ds, iv).getVolatility();
      return msg(
        'TooltipSemiVolatility',
        formatPercent(v.getExpectedSemiDeviation(), 5),
        v.getNormalizedSemiDeviationComparison(),
        formatPercent(v.getStandardDeviation(), 5),
        formatPercent(v.getSemiDeviation(), 5),
      );
    },
    colored: false,
  },
  TRADES_TURNOVER_RATIO: {
    format: 'percent',
    provider: (env, ds, iv) => {
      const index = calc(env, ds, iv);
      if (index.totals.length === 0) return 0;
      const average = sum(index.totals) / index.totals.length;
      if (average <= 0) return 0;
      return Math.min(sum(index.buys), sum(index.sells)) / average;
    },
    tooltip: (env, ds, iv) => {
      const index = calc(env, ds, iv);
      const c = env.ctx.termCurrency;
      const average = index.totals.length > 0 ? sum(index.totals) / index.totals.length : 0;
      const buy = sum(index.buys);
      const sell = sum(index.sells);
      return msg(
        'TooltipTurnoverRate',
        formatMoney(money(c, buy)),
        formatMoney(money(c, sell)),
        formatMoney(money(c, Math.trunc(average))),
        formatPercent(average > 0 ? Math.min(buy, sell) / average : 0),
      );
    },
    supportsBenchmarks: false,
    colored: false,
  },
  LATEST_SECURITY_PRICE: {
    format: 'quote',
    provider: (_env, ds) => (ds.instance instanceof Security ? ds.instance.getSecurityPrice(today()).value : 0),
    tooltip: (_env, ds) =>
      ds.instance instanceof Security
        ? msg('TooltipSecurityLatestPrice', ds.instance.name, formatDate(ds.instance.getSecurityPrice(today()).date))
        : '',
    supportsBenchmarks: false,
    predicate: (ds) => ds.instance instanceof Security,
    colored: false,
  },
  DISTANCE_TO_ATH: {
    format: 'percent',
    provider: (_env, ds, iv) => {
      if (!(ds.instance instanceof Security)) return 0;
      return new AllTimeHigh(ds.instance, iv).distance ?? 0;
    },
    tooltip: (_env, ds, iv) => {
      if (!(ds.instance instanceof Security)) return null;
      const ath = new AllTimeHigh(ds.instance, iv);
      if (ath.value === null) return null;
      const latest = ds.instance.getSecurityPrice(today());
      return msg(
        'TooltipAllTimeHigh',
        iv.getDays(),
        formatDate(ath.date),
        formatNumber(ath.value / 1e8, 2, 4),
        formatNumber(latest.value / 1e8, 2, 4),
        formatDate(latest.date),
      );
    },
    supportsBenchmarks: false,
    predicate: (ds) => ds.instance instanceof Security,
    colored: false,
  },
  ALL_TIME_HIGH: {
    format: 'money',
    provider: (env, ds, iv) => {
      const index = calc(env, ds, iv);
      let max = 0;
      for (const v of index.totals) max = Math.max(max, v);
      return money(index.currency, max);
    },
    tooltip: (env, ds, iv) => {
      const totals = calc(env, ds, iv).totals;
      let max = 0;
      let maxIndex = 0;
      for (let i = 0; i < totals.length; i++)
        if (totals[i] > max) {
          max = totals[i];
          maxIndex = i;
        }
      return msg('TooltipAllTimeHighWidget', formatDateLong(iv.start + maxIndex));
    },
    supportsBenchmarks: false,
  },
};
