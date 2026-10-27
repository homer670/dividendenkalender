// Earnings widgets: EarningsList, EarningsChart (per year/quarter/month), EarningsByTaxonomy, DividendList

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Account, AccountTransaction, InvestmentVehicle, isCredit, ONE_HUNDRED_PERCENT } from '../../core/model';
import { convertMoneyAt } from '../../core/money/exchange';
import { money } from '../../core/money/money';
import { calculatePayments } from '../../core/snapshot/payments';
import { YearX } from '../../core/snapshot/reportingPeriod';
import { today, toYMD, year as yearOf } from '../../core/util/dates';
import { D, DMC, HALF_DOWN, toLong } from '../../core/util/decimal';
import { BarChart } from '../charts/BarChart';
import { DonutChart, Slice } from '../charts/DonutChart';
import { DATE_TYPE_LABELS, DateType, dividendItems, indicator, SecurityFilter, securitiesFor, ShowEventsStarting, startDate } from '../calc/dividends';
import { formatAxis, formatDate, formatMoney, formatPercent, monthName } from '../format';
import { T } from '../components/basic';
import { useComputed } from '../hooks';
import { spacing, usePalette } from '../theme';
import { cfg, widgetEnum, widgetFilter, widgetInterval, widgetKey, widgetPeriod, widgetStartYear, widgetTaxonomy } from './env';
import { WidgetBody, WidgetCard } from './frame';
import { EARNING_TYPES, earningPredicate, GROSS_NET } from './heatmaps';
import { WidgetProps } from './special';

/** PaymentsPalette */
const PAYMENTS_PALETTE = [
  '#8C564B',
  '#E377C2',
  '#7F7F7F',
  '#BCBD22',
  '#17BECF',
  '#727CC9',
  '#FA735C',
  '#FDB667',
  '#8FCF70',
  '#57CFFD',
  '#1F77B4',
  '#FF7F0E',
  '#2CA02C',
  '#D62728',
  '#9467BD',
];
export function paymentsColor(year: number): string {
  return PAYMENTS_PALETTE[year % PAYMENTS_PALETTE.length];
}

const MODE_OF: Record<(typeof EARNING_TYPES)[number], 'EARNINGS' | 'DIVIDENDS' | 'INTEREST'> = {
  EARNINGS: 'EARNINGS',
  DIVIDENDS: 'DIVIDENDS',
  INTEREST: 'INTEREST',
};

/** EarningsChartWidget */
export function EarningsChartWidget({ widget, env, kind }: WidgetProps & { kind: 'YEAR' | 'QUARTER' | 'MONTH' }) {
  const offset = kind === 'YEAR' ? 10 : 4;
  const startYear = widgetStartYear(widget, offset);
  const height = Math.max(200, Math.round(1.4 * 140));
  const state = useComputed(() => {
    const filter = widgetFilter(widget, env);
    const type = widgetEnum(widget, 'EARNING_TYPE', EARNING_TYPES);
    const gross = widgetEnum(widget, 'NET_GROSS', GROSS_NET) === 'GROSS';
    const key = `payments|${filter.id}|${startYear}|${type}|${gross}`;
    const model = env.ctx.cached(key, () =>
      calculatePayments(env.ctx.client, env.ctx.filteredClient(filter.id), env.ctx.converter, {
        startYear,
        mode: MODE_OF[type],
        useGrossValue: gross,
        useConsolidateRetired: false,
        costMethod: 'FIFO',
      }),
    );
    const years: number[] = [];
    for (let i = 0; i < model.noOfMonths; i += 12) years.push(model.startYear + i / 12);
    if (kind === 'YEAR') {
      const labels = years.map((y) => String(y % 100).padStart(2, '0'));
      const series = years.map((y, i) => ({
        label: String(y),
        color: paymentsColor(y),
        values: years.map((_, j) => {
          if (j !== i) return 0;
          let total = 0;
          for (let m = 0; m < Math.min(12, model.noOfMonths - i * 12); m++) total += model.sum.values[i * 12 + m];
          return total / 100;
        }),
      }));
      return { labels, series, stacked: true };
    }
    const labels = kind === 'QUARTER' ? ['Q1', 'Q2', 'Q3', 'Q4'] : Array.from({ length: 12 }, (_, i) => monthName(i + 1, true));
    const series = years.map((y, i) => {
      const n = Math.min(12, model.noOfMonths - i * 12);
      const values = new Array(labels.length).fill(0);
      for (let m = 0; m < n; m++) {
        const v = model.sum.values[i * 12 + m] / 100;
        if (kind === 'QUARTER') values[Math.floor(m / 3)] += v;
        else values[m] = v;
      }
      return { label: String(y), color: paymentsColor(y), values };
    });
    return { labels, series, stacked: false };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label} subtitle={`seit ${startYear}`}>
      <WidgetBody state={state} height={height}>
        {(v) => (
          <BarChart
            labels={v.labels}
            series={v.series}
            stacked={v.stacked}
            height={height}
            minBarWidth={kind === 'YEAR' ? 14 : 3}
            formatValue={(x) => formatMoney(money(env.ctx.termCurrency, Math.round(x * 100)), env.ctx.client.baseCurrency)}
            formatAxis={formatAxis}
          />
        )}
      </WidgetBody>
    </WidgetCard>
  );
}

interface MonthData {
  month: number;
  sum: number;
  transactions: { account: Account; t: AccountTransaction }[];
}

export const EXPANSION_SETTINGS = ['EXPAND_ALL', 'EXPAND_CURRENT_MONTH', 'COLLAPSE_ALL'] as const;

/** EarningsListWidget */
export function EarningsListWidget({ widget, env, update }: WidgetProps) {
  const p = usePalette();
  const now = today();
  const configuredYear = Number.parseInt(cfg(widget, 'START_YEAR') ?? '', 10);
  const selectedYear = Number.isFinite(configuredYear) ? configuredYear : yearOf(now);
  const expansion = widgetEnum(widget, 'LAYOUT', EXPANSION_SETTINGS);
  const [collapsed, setCollapsed] = useState<Record<string, boolean[]>>({});
  const key = `${selectedYear}|${expansion}`;
  const initialCollapsed = () => {
    if (expansion === 'EXPAND_ALL') return new Array(12).fill(false);
    const c = new Array(12).fill(true);
    if (expansion === 'EXPAND_CURRENT_MONTH') c[toYMD(now).month - 1] = false;
    return c;
  };
  const coll = collapsed[key] ?? initialCollapsed();
  const gross = widgetEnum(widget, 'NET_GROSS', GROSS_NET) === 'GROSS';
  const state = useComputed(() => {
    const filter = widgetFilter(widget, env);
    const type = widgetEnum(widget, 'EARNING_TYPE', EARNING_TYPES);
    const months: MonthData[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, sum: 0, transactions: [] }));
    const interval = new YearX(selectedYear).toInterval();
    for (const account of env.ctx.filteredClient(filter.id).accounts)
      for (const t of account.transactions) {
        if (!earningPredicate(type)(t) || !interval.containsDateTime(t.dateTime)) continue;
        const m = months[toYMD(t.date).month - 1];
        const value = convertMoneyAt(env.ctx.converter, t.dateTime, gross ? t.getGrossValue() : t.getMonetaryAmount()).amount;
        m.sum += isCredit(t.type) ? value : -value;
        m.transactions.push({ account: account.source ?? account, t });
      }
    return { months, sum: months.reduce((s, m) => s + m.sum, 0) };
  }, [env.ctx, widgetKey(widget, env), selectedYear]);
  const base = env.ctx.client.baseCurrency;
  const term = env.ctx.termCurrency;
  return (
    <WidgetCard title={widget.label}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
        <Pressable hitSlop={10} onPress={() => update({ START_YEAR: String(selectedYear - 1) })} accessibilityLabel="Vorjahr">
          <Ionicons name="chevron-back" size={18} color={p.accent} />
        </Pressable>
        <T weight="600">{selectedYear}</T>
        <Pressable
          hitSlop={10}
          onPress={() => selectedYear < yearOf(now) && update({ START_YEAR: String(Math.min(selectedYear + 1, yearOf(now))) })}
          accessibilityLabel="Nächstes Jahr"
        >
          <Ionicons name="chevron-forward" size={18} color={selectedYear < yearOf(now) ? p.accent : p.textTertiary} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {state.value ? (
          <T numeric weight="600">
            {formatMoney(money(term, state.value.sum), base)}
          </T>
        ) : null}
      </View>
      <WidgetBody state={state}>
        {(v) => (
          <View>
            {v.months.map((m) => (
              <View key={m.month}>
                <Pressable
                  onPress={() => {
                    const next = coll.slice();
                    next[m.month - 1] = !next[m.month - 1];
                    setCollapsed({ ...collapsed, [key]: next });
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 6, borderBottomWidth: 0.5, borderColor: p.separator }}
                >
                  <Ionicons name={coll[m.month - 1] ? 'chevron-forward' : 'chevron-down'} size={12} color={p.textTertiary} />
                  <T style={{ flex: 1 }}>{monthName(m.month)}</T>
                  <T numeric>{formatMoney(money(term, m.sum), base)}</T>
                </Pressable>
                {!coll[m.month - 1]
                  ? m.transactions.map(({ account, t }) => {
                      let value = gross ? t.getGrossValue() : t.getMonetaryAmount();
                      if (!isCredit(t.type)) value = money(value.currencyCode, -value.amount);
                      return (
                        <Pressable
                          key={t.uuid}
                          disabled={!t.security}
                          onPress={() => t.security && router.push({ pathname: '/security/[id]', params: { id: t.security.uuid } })}
                          style={{ flexDirection: 'row', paddingVertical: 4, paddingLeft: 18, gap: 6 }}
                        >
                          <T variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                            {t.security ? t.security.name : account.name}
                          </T>
                          <T variant="caption" secondary>
                            {formatDate(t.date).substring(0, 6)}
                          </T>
                          <T variant="caption" numeric>
                            {formatMoney(value, base)}
                          </T>
                        </Pressable>
                      );
                    })
                  : null}
              </View>
            ))}
          </View>
        )}
      </WidgetBody>
    </WidgetCard>
  );
}

interface Item {
  vehicle: InvestmentVehicle;
  value: number;
  weight: number;
}

/** EarningsByTaxonomyChartWidget */
export function EarningsByTaxonomyChartWidget({ widget, env }: WidgetProps) {
  const p = usePalette();
  const taxonomy = widgetTaxonomy(widget, env);
  const state = useComputed(() => {
    if (!taxonomy) return null;
    const filter = widgetFilter(widget, env);
    const type = widgetEnum(widget, 'EARNING_TYPE', EARNING_TYPES);
    const gross = widgetEnum(widget, 'NET_GROSS', GROSS_NET) === 'GROSS';
    const interval = widgetInterval(widget, env);
    const result = new Map<InvestmentVehicle, Item>();
    for (const account of env.ctx.filteredClient(filter.id).accounts)
      for (const tx of account.transactions) {
        if (!earningPredicate(type)(tx) || !interval.containsDateTime(tx.dateTime)) continue;
        const vehicle: InvestmentVehicle = tx.security !== null ? tx.security : (account.source ?? account);
        const value = convertMoneyAt(env.ctx.converter, tx.dateTime, gross ? tx.getGrossValue() : tx.getMonetaryAmount());
        const item = result.get(vehicle) ?? { vehicle, value: 0, weight: ONE_HUNDRED_PERCENT };
        result.set(vehicle, { vehicle, value: item.value + (isCredit(tx.type) ? value.amount : -value.amount), weight: ONE_HUNDRED_PERCENT });
      }
    const skipped: Item[] = [];
    for (const [k, v] of [...result]) if (v.value < 0) {
      result.delete(k);
      skipped.push(v);
    }
    const slices: Slice[] = [];
    const outer: Slice[] = [];
    for (const classification of taxonomy.root.children) {
      const nodes: Item[] = [];
      for (const assignment of classification.flattenAssignments().assignments) {
        const item = result.get(assignment.investmentVehicle);
        if (!item || item.value === 0) continue;
        let value = item.value;
        if (assignment.weight < item.weight)
          value = toLong(new D(new DMC(new DMC(value).mul(assignment.weight)).div(item.weight)), HALF_DOWN);
        result.set(assignment.investmentVehicle, { vehicle: assignment.investmentVehicle, value: item.value - value, weight: item.weight - assignment.weight });
        nodes.push({ vehicle: item.vehicle, value, weight: assignment.weight });
      }
      nodes.sort((a, b) => b.value - a.value);
      const sum = nodes.reduce((s, n) => s + n.value, 0);
      if (sum > 0) slices.push({ key: classification.id, label: classification.name, value: sum, color: classification.color });
      for (const n of nodes) outer.push({ key: `${classification.id}/${n.vehicle.uuid}`, label: n.vehicle.name, value: n.value, color: classification.color });
    }
    const rest = [...result.values()].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
    const restSum = rest.reduce((s, i) => s + i.value, 0);
    if (restSum > 0) slices.push({ key: '$unassigned$', label: 'Ohne Klassifizierung', value: restSum, color: '#cccccc' });
    for (const i of rest) outer.push({ key: i.vehicle.uuid, label: i.vehicle.name, value: i.value, color: '#cccccc' });
    return { slices, outer, skipped };
  }, [env.ctx, widgetKey(widget, env)]);
  const base = env.ctx.client.baseCurrency;
  return (
    <WidgetCard title={widget.label} subtitle={`${taxonomy?.name ?? ''} · ${widgetPeriod(widget, env).toString()}`}>
      <WidgetBody state={state} height={200}>
        {(v) =>
          !v ? (
            <T secondary variant="caption">
              Keine Klassifizierung ausgewählt
            </T>
          ) : v.slices.length === 0 ? (
            <T secondary variant="caption">
              Keine Werte
            </T>
          ) : (
            <View style={{ gap: 8 }}>
              <DonutChart
                slices={v.slices}
                outerSlices={v.outer}
                size={190}
                centerValue={formatMoney(money(env.ctx.termCurrency, v.slices.reduce((s, x) => s + x.value, 0)), base)}
                formatValue={(x) => formatMoney(money(env.ctx.termCurrency, x), base)}
                formatShare={(s) => formatPercent(s)}
              />
              {v.slices.map((s) => (
                <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: s.color }} />
                  <T variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                    {s.label}
                  </T>
                  <T variant="caption" numeric secondary>
                    {formatMoney(money(env.ctx.termCurrency, s.value), base)}
                  </T>
                </View>
              ))}
              {v.skipped.length > 0 ? (
                <T variant="small" color={p.warning}>
                  Negative Werte nicht dargestellt: {v.skipped.map((i) => `${i.vehicle.name}: ${formatMoney(money(env.ctx.termCurrency, i.value), base)}`).join(', ')}
                </T>
              ) : null}
            </View>
          )
        }
      </WidgetBody>
    </WidgetCard>
  );
}

export const DATE_TYPES = ['ALL_DATES', 'EX_DIVIDEND_DATE', 'PAYMENT_DATE'] as const;
export const SECURITY_FILTERS = ['ALL', 'ACTIVE', 'OWNED'] as const;
export const SHOW_EVENTS_STARTING = ['TODAY', 'ONE_WEEK_AGO', 'ONE_MONTH_AGO', 'THREE_MONTHS_AGO'] as const;

/** DividendListWidget */
export function DividendListWidget({ widget, env }: WidgetProps) {
  const state = useComputed(() => {
    const now = today();
    const dateType = widgetEnum(widget, 'DATE_TYPE_FILTER', DATE_TYPES) as DateType;
    const from = startDate(widgetEnum(widget, 'START_YEAR', SHOW_EVENTS_STARTING) as ShowEventsStarting, now);
    const filter = widgetFilter(widget, env);
    const securities = securitiesFor(
      widgetEnum(widget, 'SECURITY_FILTER', SECURITY_FILTERS) as SecurityFilter,
      env.ctx.client,
      env.ctx.filteredClient(filter.id),
      env.ctx.converter,
      now,
    );
    return dividendItems(securities, dateType, from);
  }, [env.ctx, widgetKey(widget, env)]);
  const base = env.ctx.client.baseCurrency;
  return (
    <WidgetCard title={widget.label} subtitle={`${DATE_TYPE_LABELS.EX_DIVIDEND_DATE}   ${DATE_TYPE_LABELS.PAYMENT_DATE}`}>
      <WidgetBody state={state}>
        {(items) =>
          items.length === 0 ? (
            <T variant="caption" secondary>
              Keine Termine
            </T>
          ) : (
            <View>
              {items.slice(0, 40).map((item, i) => (
                <View key={i}>
                  {item.hasNewDate ? (
                    <T variant="caption" weight="600" style={{ marginTop: i > 0 ? 6 : 0 }}>
                      {formatDate(item.date)}
                    </T>
                  ) : null}
                  <Pressable
                    onPress={() => router.push({ pathname: '/security/[id]', params: { id: item.security.uuid } })}
                    style={{ flexDirection: 'row', gap: 6, paddingVertical: 3 }}
                  >
                    <T variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                      {item.security.name}
                    </T>
                    <T variant="caption" numeric>
                      {indicator(item)} {item.event.amount ? formatMoney(item.event.amount, base) : ''}
                    </T>
                  </Pressable>
                </View>
              ))}
            </View>
          )
        }
      </WidgetBody>
    </WidgetCard>
  );
}

