// Heatmap widgets (PerformanceHeatmap, YearlyPerformanceHeatmap, Earnings/Investment/Cost heatmaps, MonthlyPNTransfers)

import React from 'react';

import { AccountTransaction, AccountTransactionType, Client, isCredit, isDebit, isLiquidation } from '../../core/model';
import { convertMoneyAt } from '../../core/money/exchange';
import { PerformanceIndex } from '../../core/snapshot/performanceIndex';
import { YearX } from '../../core/snapshot/reportingPeriod';
import { dayOfMonth, dayOfYear, lastDayOfMonth, lengthOfMonth, lengthOfYear, ofYMD, toYMD } from '../../core/util/dates';
import { Interval } from '../../core/util/interval';
import { colorFor, ColorSchema } from '../charts/colorSchema';
import { Heatmap, HeatmapRow } from '../charts/Heatmap';
import { formatNumber } from '../format';
import { useComputed } from '../hooks';
import { usePalette } from '../theme';
import { parseDataSeriesList } from '../../state/dataSeries';
import {
  cfg,
  DashboardEnv,
  dashboardSeriesSet,
  widgetDataSeries,
  widgetEnum,
  widgetEnumSet,
  widgetFilter,
  widgetInterval,
  widgetKey,
  widgetOptionalDataSeries,
  widgetPeriod,
} from './env';
import { WidgetBody, WidgetCard } from './frame';
import { WidgetProps } from './special';

export const COLOR_SCHEMAS = ['GREEN_YELLOW_RED', 'GREEN_WHITE_RED', 'GREEN_GRAY_RED', 'BLUE_GRAY_ORANGE', 'YELLOW_WHITE_BLACK'] as const;
export const HEATMAP_ORNAMENTS = ['SUM', 'GEOMETRIC_MEAN', 'STANDARD_DEVIATION'] as const;
export const EXCESS_RETURN_OPERATORS = ['ALPHA', 'RELATIVE'] as const;
export const EARNING_TYPES = ['EARNINGS', 'DIVIDENDS', 'INTEREST'] as const;
export const GROSS_NET = ['NET', 'GROSS'] as const;
export const INVESTMENT_TYPES = ['INVESTMENTS_MINUS_REVENUE', 'INVESTMENTS'] as const;

const MONTH_HEADER = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

interface Model {
  columns: string[];
  rows: HeatmapRow[];
}

function geometricMean(values: number[]): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  let sum = 1;
  for (const v of values) sum *= 1 + v;
  return Math.pow(sum, 1 / values.length) - 1;
}

function standardDeviation(values: (number | null)[]): number | null {
  let count = 0;
  let sum = 0;
  for (const v of values)
    if (v !== null) {
      count++;
      sum += v;
    }
  if (count === 0) return null;
  const mean = sum / count;
  let sq = 0;
  for (const v of values) if (v !== null) sq += Math.pow(v - mean, 2);
  return Math.sqrt(sq / count);
}

/** calcInterval of the monthly heatmaps: start at the end of the previous month, end at the end of the month */
function monthlyCalcInterval(interval: Interval): Interval {
  const start = interval.start;
  const ymd = toYMD(start);
  const s = dayOfMonth(start) === lengthOfMonth(ymd.year, ymd.month) ? start : ofYMD(ymd.year, ymd.month, 1) - 1;
  return Interval.of(s, lastDayOfMonth(interval.end));
}

function monthInterval(y: number, m: number): Interval {
  return Interval.of(ofYMD(y, m, 1) - 1, ofYMD(y, m, lengthOfMonth(y, m)));
}

function yearLabel(y: number, env: DashboardEnv): string {
  return env.columns > 2 ? String(y % 100) : String(y);
}

function percentFormat(env: DashboardEnv) {
  return (v: number) => formatNumber(v * 100, env.columns === 1 ? 2 : 1);
}

function schemaColor(widget: WidgetProps['widget'], background: string) {
  const schema = widgetEnum(widget, 'COLOR_SCHEMA', COLOR_SCHEMAS) as ColorSchema;
  return (v: number) => colorFor(schema, v, background);
}

/** PerformanceHeatmapWidget */
export function PerformanceHeatmapWidget({ widget, env }: WidgetProps) {
  const p = usePalette();
  const state = useComputed((): Model => {
    const calcInterval = monthlyCalcInterval(widgetInterval(widget, env));
    const ds = widgetDataSeries(widget, env);
    const index = env.ctx.calculate(ds, calcInterval);
    let actualInterval = index.getActualInterval();
    const perf = (idx: PerformanceIndex, iv: Interval) => idx.getPerformance(iv);
    let monthly = (y: number, m: number) => perf(index, monthInterval(y, m));
    let yearly = (y: number) => perf(index, Interval.of(ofYMD(y, 1, 1) - 1, ofYMD(y, 12, 31)));
    const benchmark = widgetOptionalDataSeries(widget, env, 'SECONDARY_DATA_SERIES');
    if (benchmark) {
      actualInterval = index.getFirstHoldingInterval();
      const benchIndex = env.ctx.calculate(benchmark, calcInterval);
      const operator = widgetEnum(widget, 'CALCULATION_METHOD', EXCESS_RETURN_OPERATORS);
      const op = operator === 'ALPHA' ? (x: number, y: number) => x - y : (x: number, y: number) => (x + 1) / (y + 1) - 1;
      const notBefore = actualInterval.start;
      const limited = (start: number, end: number) => (notBefore > end ? 0 : perf(benchIndex, Interval.of(notBefore > start ? notBefore : start, end)));
      const baseMonthly = monthly;
      const baseYearly = yearly;
      monthly = (y, m) => op(baseMonthly(y, m), limited(ofYMD(y, m, 1) - 1, ofYMD(y, m, lengthOfMonth(y, m))));
      yearly = (y) => op(baseYearly(y), limited(ofYMD(y, 1, 1) - 1, ofYMD(y, 12, 31)));
    }
    const ornaments = widgetEnumSet(widget, 'LAYOUT', HEATMAP_ORNAMENTS);
    const showSum = ornaments.includes('SUM');
    const showSd = ornaments.includes('STANDARD_DEVIATION');
    const columns = [...MONTH_HEADER];
    if (showSum) columns.push('Σ');
    if (showSd) columns.push('s');
    const rows: HeatmapRow[] = [];
    for (const y of actualInterval.getYears()) {
      const cells: (number | null)[] = [];
      for (let m = 1; m <= 12; m++) cells.push(actualInterval.intersects(monthInterval(y, m)) ? monthly(y, m) : null);
      if (showSum) cells.push(yearly(y));
      if (showSd) cells.push(standardDeviation(cells.slice(0, 12)));
      rows.push({ label: yearLabel(y, env), cells });
    }
    if (ornaments.includes('GEOMETRIC_MEAN')) {
      const cells: (number | null)[] = [];
      for (let i = 0; i < columns.length; i++) cells.push(geometricMean(rows.map((r) => r.cells[i]).filter((v): v is number => v !== null)));
      rows.push({ label: 'x̄ geom', cells });
    }
    return { columns, rows };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state}>
        {(m) => <Heatmap columns={m.columns} rows={m.rows} format={percentFormat(env)} cellColor={schemaColor(widget, p.card)} />}
      </WidgetBody>
    </WidgetCard>
  );
}

/** YearlyPerformanceHeatmapWidget */
export function YearlyPerformanceHeatmapWidget({ widget, env }: WidgetProps) {
  const p = usePalette();
  const state = useComputed((): Model => {
    const interval = widgetInterval(widget, env);
    const series = parseDataSeriesList(dashboardSeriesSet(env), cfg(widget, 'DATA_SERIES'));
    const sy = toYMD(interval.start).year;
    const start = dayOfYear(interval.start) === lengthOfYear(sy) ? interval.start : ofYMD(sy, 1, 1) - 1;
    const ey = toYMD(interval.end).year;
    const calcInterval = Interval.of(start, ofYMD(ey, 12, 31));
    const columns = series.map((s) => s.label);
    const rows: HeatmapRow[] = [];
    for (const y of calcInterval.getYears()) {
      const iv = new YearX(y).toInterval();
      rows.push({ label: yearLabel(y, env), cells: series.map((s) => env.ctx.calculate(s, iv).getFinalAccumulatedPercentage()) });
    }
    const ornaments = widgetEnumSet(widget, 'LAYOUT', HEATMAP_ORNAMENTS);
    const sumRow = ornaments.includes('SUM') ? { label: 'Σ', cells: series.map((s) => env.ctx.calculate(s, calcInterval).getFinalAccumulatedPercentage()) } : null;
    const sdRow = ornaments.includes('STANDARD_DEVIATION')
      ? { label: 's', cells: series.map((_, i) => standardDeviation(rows.map((r) => r.cells[i]))) }
      : null;
    if (sumRow) rows.push(sumRow);
    if (sdRow) rows.push(sdRow);
    if (ornaments.includes('GEOMETRIC_MEAN')) {
      columns.push('x̄ geom');
      for (const r of rows) r.cells.push(geometricMean(r.cells.filter((v): v is number => v !== null)));
    }
    return { columns, rows };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state}>
        {(m) => <Heatmap columns={m.columns} rows={m.rows} format={percentFormat(env)} cellColor={schemaColor(widget, p.card)} cellWidth={64} />}
      </WidgetBody>
    </WidgetCard>
  );
}

/** AbstractMonthlyHeatmapWidget: amounts per month */
function monthlyAmountModel(
  widget: WidgetProps['widget'],
  env: DashboardEnv,
  showAverage: boolean,
  process: (startYear: number, interval: Interval, add: (year: number, month: number, value: number) => void, client: Client) => void,
): Model {
  const calcInterval = monthlyCalcInterval(widgetInterval(widget, env));
  const columns = [...MONTH_HEADER, 'Σ'];
  if (showAverage) columns.push('⌀');
  const startYear = toYMD(calcInterval.start + 1).year;
  const years = calcInterval.getYears();
  const rows: HeatmapRow[] = years.map((y) => ({
    label: yearLabel(y, env),
    cells: Array.from({ length: 12 }, (_, m) => (calcInterval.intersects(monthInterval(y, m + 1)) ? 0 : null)),
  }));
  const filtered = env.ctx.filteredClient(widgetFilter(widget, env).id);
  process(
    startYear,
    calcInterval,
    (y, m, value) => {
      const row = rows[y - startYear];
      if (!row) return;
      const old = row.cells[m - 1];
      // as in PP, a transaction in a month without data would fail; null months are not part of the interval
      row.cells[m - 1] = (old ?? 0) + value;
    },
    filtered,
  );
  for (const row of rows) {
    const sum = row.cells.reduce<number>((s, v) => s + (v ?? 0), 0);
    row.cells.push(sum);
    if (showAverage) {
      const values = row.cells.slice(0, 12).filter((v): v is number => v !== null);
      row.cells.push(values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
    }
  }
  return { columns, rows };
}

function amountFormat(env: DashboardEnv) {
  return (v: number) => formatNumber(v / 100, env.columns <= 1 ? 2 : 0);
}

const EARNING_PREDICATE: Record<(typeof EARNING_TYPES)[number], (t: AccountTransaction) => boolean> = {
  EARNINGS: (t) => t.type === 'DIVIDENDS' || t.type === 'INTEREST' || t.type === 'INTEREST_CHARGE',
  DIVIDENDS: (t) => t.type === 'DIVIDENDS',
  INTEREST: (t) => t.type === 'INTEREST' || t.type === 'INTEREST_CHARGE',
};

export function earningPredicate(type: (typeof EARNING_TYPES)[number]) {
  return EARNING_PREDICATE[type];
}

/** EarningsHeatmapWidget */
export function EarningsHeatmapWidget({ widget, env }: WidgetProps) {
  const state = useComputed(() => {
    const type = widgetEnum(widget, 'EARNING_TYPE', EARNING_TYPES);
    const grossNet = widgetEnum(widget, 'NET_GROSS', GROSS_NET);
    const showAverage = widgetEnumSet(widget, 'LAYOUT', ['AVERAGE'] as const).length > 0;
    return monthlyAmountModel(widget, env, showAverage, (_sy, interval, add, client) => {
      for (const a of client.accounts)
        for (const t of a.transactions) {
          if (!EARNING_PREDICATE[type](t) || !interval.containsDateTime(t.dateTime)) continue;
          let value = convertMoneyAt(env.ctx.converter, t.dateTime, grossNet === 'GROSS' ? t.getGrossValue() : t.getMonetaryAmount()).amount;
          if (isDebit(t.type)) value = -value;
          const { year, month } = toYMD(t.date);
          add(year, month, value);
        }
    });
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state}>{(m) => <Heatmap columns={m.columns} rows={m.rows} format={amountFormat(env)} cellWidth={58} />}</WidgetBody>
    </WidgetCard>
  );
}

/** InvestmentHeatmapWidget */
export function InvestmentHeatmapWidget({ widget, env }: WidgetProps) {
  const state = useComputed(() => {
    const type = widgetEnum(widget, 'EARNING_TYPE', INVESTMENT_TYPES);
    const grossNet = widgetEnum(widget, 'NET_GROSS', GROSS_NET);
    const showAverage = widgetEnumSet(widget, 'LAYOUT', ['AVERAGE'] as const).length > 0;
    return monthlyAmountModel(widget, env, showAverage, (_sy, interval, add, client) => {
      for (const p of client.portfolios)
        for (const t of p.transactions) {
          const included =
            type === 'INVESTMENTS'
              ? t.type === 'BUY' || t.type === 'DELIVERY_INBOUND'
              : t.type === 'BUY' || t.type === 'DELIVERY_INBOUND' || t.type === 'SELL' || t.type === 'DELIVERY_OUTBOUND';
          if (!included || !interval.containsDateTime(t.dateTime)) continue;
          let value = convertMoneyAt(env.ctx.converter, t.dateTime, grossNet === 'GROSS' ? t.getGrossValue() : t.getMonetaryAmount()).amount;
          if (isLiquidation(t.type)) value = -value;
          const { year, month } = toYMD(t.date);
          add(year, month, value);
        }
    });
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state}>{(m) => <Heatmap columns={m.columns} rows={m.rows} format={amountFormat(env)} cellWidth={58} />}</WidgetBody>
    </WidgetCard>
  );
}

const COST_MODE_TYPES: Record<'TAXES' | 'FEES', AccountTransactionType[]> = {
  TAXES: ['DIVIDENDS', 'INTEREST', 'INTEREST_CHARGE', 'TAXES', 'TAX_REFUND'],
  FEES: ['DIVIDENDS', 'INTEREST', 'INTEREST_CHARGE', 'FEES', 'FEES_REFUND'],
};

/** CostHeatmapWidget */
export function CostHeatmapWidget({ widget, env, mode }: WidgetProps & { mode: 'TAXES' | 'FEES' }) {
  const state = useComputed(() => {
    const unit = mode === 'TAXES' ? 'TAX' : 'FEE';
    const base: AccountTransactionType[] = mode === 'TAXES' ? ['TAXES', 'TAX_REFUND'] : ['FEES', 'FEES_REFUND'];
    const showAverage = widgetEnumSet(widget, 'LAYOUT', ['AVERAGE'] as const).length > 0;
    return monthlyAmountModel(widget, env, showAverage, (_sy, interval, add, client) => {
      for (const p of client.portfolios)
        for (const t of p.transactions) {
          if (!interval.containsDateTime(t.dateTime)) continue;
          const { year, month } = toYMD(t.date);
          add(year, month, convertMoneyAt(env.ctx.converter, t.dateTime, t.getUnitSum(unit)).amount);
        }
      for (const a of client.accounts)
        for (const t of a.transactions) {
          if (!COST_MODE_TYPES[mode].includes(t.type) || !interval.containsDateTime(t.dateTime)) continue;
          let value: number;
          if (base.includes(t.type)) {
            value = convertMoneyAt(env.ctx.converter, t.dateTime, t.getMonetaryAmount()).amount;
            if (isCredit(t.type)) value *= -1;
          } else value = convertMoneyAt(env.ctx.converter, t.dateTime, t.getUnitSum(unit)).amount;
          const { year, month } = toYMD(t.date);
          add(year, month, value);
        }
    });
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state}>{(m) => <Heatmap columns={m.columns} rows={m.rows} format={amountFormat(env)} cellWidth={58} />}</WidgetBody>
    </WidgetCard>
  );
}

/** MonthlyPNTransfersWidget */
export function MonthlyPNTransfersWidget({ widget, env }: WidgetProps) {
  const state = useComputed(() => {
    const showAverage = widgetEnumSet(widget, 'LAYOUT', ['AVERAGE'] as const).length > 0;
    return monthlyAmountModel(widget, env, showAverage, (_sy, interval, add, client) => {
      for (const a of client.accounts)
        for (const t of a.transactions) {
          if (!interval.containsDateTime(t.dateTime)) continue;
          if (t.type !== 'DEPOSIT' && t.type !== 'REMOVAL') continue;
          const v = convertMoneyAt(env.ctx.converter, t.dateTime, t.getMonetaryAmount()).amount;
          const { year, month } = toYMD(t.date);
          add(year, month, t.type === 'DEPOSIT' ? v : -v);
        }
      for (const p of client.portfolios)
        for (const t of p.transactions) {
          if (!interval.containsDateTime(t.dateTime)) continue;
          if (t.type !== 'DELIVERY_INBOUND' && t.type !== 'DELIVERY_OUTBOUND') continue;
          const v = convertMoneyAt(env.ctx.converter, t.dateTime, t.getMonetaryAmount()).amount;
          const { year, month } = toYMD(t.date);
          add(year, month, t.type === 'DELIVERY_INBOUND' ? v : -v);
        }
    });
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state}>{(m) => <Heatmap columns={m.columns} rows={m.rows} format={amountFormat(env)} cellWidth={58} />}</WidgetBody>
    </WidgetCard>
  );
}
