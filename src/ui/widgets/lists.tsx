// List widgets: Calculation, TopContributors, LimitExceeded, FollowUp, EventList

import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';

import { AttributeType, LimitPrice, Security, SecurityEventType, SecurityPrice } from '../../core/model';
import { CATEGORY_TYPES, CategoryType } from '../../core/snapshot/clientPerformanceSnapshot';
import { SecurityPerformanceSnapshot } from '../../core/snapshot/securityPerformance';
import { compareText } from '../../core/snapshot/clientSnapshot';
import { LocalDate, today } from '../../core/util/dates';
import { formatDate, formatMoney, formatPercent, formatQuote } from '../format';
import { CalculationLayout, CalculationTable } from '../components/perf';
import { T } from '../components/basic';
import { useComputed } from '../hooks';
import { usePalette } from '../theme';
import { cfg, DashboardEnv, widgetCount, widgetDataSeries, widgetEnum, widgetEnumSet, widgetInterval, widgetKey, widgetPeriod } from './env';
import { WidgetBody, WidgetCard } from './frame';
import { WidgetProps } from './special';

export const CALCULATION_LAYOUTS = ['FULL', 'REDUCED', 'RELEVANT'] as const;

/** PerformanceCalculationWidget */
export function CalculationWidget({ widget, env }: WidgetProps) {
  const ds = widgetDataSeries(widget, env);
  const state = useComputed(() => {
    const fifo = widgetEnum(widget, 'COST_METHOD', ['FIFO', 'MOVING_AVERAGE'] as const) === 'FIFO';
    return env.ctx.calculate(ds, widgetInterval(widget, env)).getClientPerformanceSnapshot(fifo);
  }, [env.ctx, widgetKey(widget, env)]);
  const layout = widgetEnum(widget, 'LAYOUT', CALCULATION_LAYOUTS) as CalculationLayout;
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state} height={160}>
        {(snapshot) => <CalculationTable snapshot={snapshot} layout={layout} />}
      </WidgetBody>
    </WidgetCard>
  );
}

interface DisplayRow {
  security: Security | null;
  label: string;
  value: string;
  positive: boolean;
}

function TopList({ rows, count, title, subtitle }: { rows: DisplayRow[]; count: number; title: string; subtitle: string }) {
  const p = usePalette();
  const top = rows.slice(0, Math.min(rows.length, count));
  const bottom = rows.slice(Math.max(0, Math.max(rows.length - count, top.length)));
  const showDivider = rows.length > 2 * count;
  const securities = new Set([...top, ...bottom].map((r) => r.security).filter(Boolean)).size;
  const line = (r: DisplayRow, i: number) => (
    <Pressable
      key={i}
      disabled={!r.security}
      onPress={() => r.security && router.push({ pathname: '/security/[id]', params: { id: r.security.uuid } })}
      style={{ flexDirection: 'row', gap: 6, paddingVertical: 4 }}
    >
      <T variant="caption" style={{ flex: 1 }} numberOfLines={1}>
        {r.label}
      </T>
      <T variant="caption" numeric color={r.positive ? p.positive : p.negative}>
        {r.value}
      </T>
    </Pressable>
  );
  return (
    <WidgetCard title={`${title} (${securities})`} subtitle={subtitle}>
      {top.map(line)}
      {showDivider ? <View style={{ height: 1, backgroundColor: p.separator, marginVertical: 4 }} /> : null}
      {bottom.map((r, i) => line(r, i + 1000))}
    </WidgetCard>
  );
}

/** TopContributorsWidget */
export function TopContributorsWidget({ widget, env }: WidgetProps) {
  const ds = widgetDataSeries(widget, env);
  const state = useComputed(() => {
    const snapshot = env.ctx.calculate(ds, widgetInterval(widget, env)).getClientPerformanceSnapshot(true);
    const onlySecurities = widgetEnumSet(widget, 'LAYOUT', ['ONLY_SECURITIES'] as const).includes('ONLY_SECURITIES');
    const records: { label: string; security: Security | null; category: string; explain: boolean; value: number; positive: boolean; currency: string }[] = [];
    const onlySec: CategoryType[] = ['CAPITAL_GAINS', 'REALIZED_CAPITAL_GAINS'];
    for (const type of CATEGORY_TYPES) {
      if (type === 'INITIAL_VALUE' || type === 'FINAL_VALUE') continue;
      if (onlySecurities && !onlySec.includes(type)) continue;
      const category = snapshot.getCategoryByType(type);
      const explain = type === 'EARNINGS' || type === 'FEES' || type === 'TAXES' || type === 'CURRENCY_GAINS';
      for (const pos of category.positions) {
        const v = pos.value.amount;
        if (v === 0) continue;
        records.push({
          label: pos.label,
          security: pos.security,
          category: category.label,
          explain,
          value: v,
          positive: v > 0 ? category.sign === '+' : category.sign === '-',
          currency: pos.value.currencyCode,
        });
      }
    }
    records.sort((a, b) => b.value - a.value);
    return records.map(
      (r): DisplayRow => ({
        security: r.security,
        label: r.explain ? `${r.label} (${r.category})` : r.label,
        value: formatMoney({ currencyCode: r.currency, amount: r.value }, env.ctx.client.baseCurrency),
        positive: r.positive,
      }),
    );
  }, [env.ctx, widgetKey(widget, env)]);
  if (!state.value)
    return (
      <WidgetCard title={widget.label}>
        <WidgetBody state={state}>{() => null}</WidgetBody>
      </WidgetCard>
    );
  return <TopList rows={state.value} count={widgetCount(widget)} title={widget.label} subtitle={widgetPeriod(widget, env).toString()} />;
}

/** TopContributorsReturnWidget */
export function TopContributorsReturnWidget({ widget, env }: WidgetProps) {
  const ds = widgetDataSeries(widget, env);
  const state = useComputed(() => {
    const interval = widgetInterval(widget, env);
    const index = env.ctx.calculate(ds, interval);
    const records = SecurityPerformanceSnapshot.create(index.client, env.ctx.converter, interval).records.slice();
    records.sort((a, b) => b.getTrueTimeWeightedRateOfReturn() - a.getTrueTimeWeightedRateOfReturn());
    return records.map(
      (r): DisplayRow => ({
        security: r.security,
        label: r.security.name,
        value: formatPercent(r.getTrueTimeWeightedRateOfReturn()),
        positive: r.getTrueTimeWeightedRateOfReturn() >= 0,
      }),
    );
  }, [env.ctx, widgetKey(widget, env)]);
  if (!state.value)
    return (
      <WidgetCard title={widget.label}>
        <WidgetBody state={state}>{() => null}</WidgetBody>
      </WidgetCard>
    );
  return <TopList rows={state.value} count={widgetCount(widget)} title={widget.label} subtitle={widgetPeriod(widget, env).toString()} />;
}

function attributeTypes(env: DashboardEnv, valueType: string, selected: string | undefined): AttributeType[] {
  const types = env.ctx.client.settings.attributeTypes.filter(
    (t) => t.target === 'name.abuchen.portfolio.model.Security' && t.type === valueType,
  );
  if (selected) {
    const t = types.find((x) => x.id === selected);
    if (t) return [t];
  }
  return types;
}

function isExceeded(limit: LimitPrice, price: SecurityPrice): boolean {
  switch (limit.relationalOperator) {
    case '>=':
      return price.value >= limit.value;
    case '<=':
      return price.value <= limit.value;
    case '>':
      return price.value > limit.value;
    case '<':
      return price.value < limit.value;
    default:
      return false;
  }
}

function normalizedDistance(limit: LimitPrice, latest: SecurityPrice): number {
  const d = Math.abs(limit.value / latest.value - 1);
  return isExceeded(limit, latest) ? d : -d;
}

/** LimitExceededWidget */
export function LimitExceededWidget({ widget, env }: WidgetProps) {
  const state = useComputed(() => {
    const types = attributeTypes(env, 'name.abuchen.portfolio.model.LimitPrice', cfg(widget, 'ATTRIBUTE_UUID'));
    const items: { security: Security; limit: LimitPrice; price: SecurityPrice; type: AttributeType }[] = [];
    for (const security of env.ctx.client.securities)
      for (const t of types) {
        const a = security.attributes.get(t.id);
        if (!a || typeof a !== 'object' || !('relationalOperator' in a)) continue;
        const limit = a as LimitPrice;
        const latest = security.getSecurityPrice(today());
        if (latest && isExceeded(limit, latest)) items.push({ security, limit, price: latest, type: t });
      }
    items.sort((r, l) => normalizedDistance(l.limit, l.price) - normalizedDistance(r.limit, r.price));
    return { items, hasTypes: attributeTypes(env, 'name.abuchen.portfolio.model.LimitPrice', undefined).length > 0 };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label}>
      <WidgetBody state={state}>
        {(v) =>
          !v.hasTypes ? (
            <T variant="caption" secondary>
              Es sind keine Attribute vom Typ „Limit“ konfiguriert.
            </T>
          ) : v.items.length === 0 ? (
            <T variant="caption" secondary>
              Keine Limits überschritten
            </T>
          ) : (
            <View>
              {v.items.map((i, k) => {
                const greater = i.limit.relationalOperator.startsWith('>');
                const dist = i.limit.value / i.price.value - 1;
                return (
                  <Pressable
                    key={k}
                    onPress={() => router.push({ pathname: '/security/[id]', params: { id: i.security.uuid } })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}
                  >
                    <T variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                      {i.security.name}
                    </T>
                    <View style={{ backgroundColor: greater ? 'rgba(46,160,67,0.25)' : 'rgba(214,39,40,0.25)', borderRadius: 4, paddingHorizontal: 4 }}>
                      <T variant="caption" numeric>
                        {formatQuote(i.price.value, i.security.currencyCode)}
                      </T>
                    </View>
                    <T variant="small" secondary numeric>
                      {i.limit.relationalOperator} {formatQuote(i.limit.value)} ({formatPercent(dist)})
                    </T>
                  </Pressable>
                );
              })}
            </View>
          )
        }
      </WidgetBody>
    </WidgetCard>
  );
}

export const DATE_CHECKS = ['PAST', 'FUTURE'] as const;
export const SORT_DIRECTIONS = ['ASCENDING', 'DESCENDING'] as const;

/** FollowUpWidget */
export function FollowUpWidget({ widget, env }: WidgetProps) {
  const state = useComputed(() => {
    const now = today();
    const check = widgetEnum(widget, 'REPORTING_PERIOD', DATE_CHECKS);
    const types = attributeTypes(env, 'java.time.LocalDate', cfg(widget, 'ATTRIBUTE_UUID'));
    const items: { security: Security; type: AttributeType; date: LocalDate }[] = [];
    for (const security of env.ctx.client.securities)
      for (const t of types) {
        const a = security.attributes.get(t.id);
        if (typeof a !== 'number') continue;
        const include = check === 'PAST' ? !(now < a) : !(a < now);
        if (include) items.push({ security, type: t, date: a });
      }
    const desc = widgetEnum(widget, 'SORT_DIRECTION', SORT_DIRECTIONS) === 'DESCENDING';
    items.sort((r, l) => (desc ? l.date - r.date : r.date - l.date) || compareText(r.type.name, l.type.name));
    return { items, hasTypes: attributeTypes(env, 'java.time.LocalDate', undefined).length > 0 };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <WidgetCard title={widget.label}>
      <WidgetBody state={state}>
        {(v) =>
          !v.hasTypes ? (
            <T variant="caption" secondary>
              Es sind keine Attribute vom Typ „Datum“ konfiguriert.
            </T>
          ) : v.items.length === 0 ? (
            <T variant="caption" secondary>
              Keine Einträge
            </T>
          ) : (
            <View>
              {v.items.map((i, k) => {
                const prev = k > 0 ? v.items[k - 1] : null;
                const header = !prev || prev.date !== i.date || prev.type !== i.type;
                return (
                  <View key={k}>
                    {header ? (
                      <T variant="caption" weight="600" style={{ marginTop: k > 0 ? 6 : 0 }}>
                        {i.type.name}: {formatDate(i.date)}
                      </T>
                    ) : null}
                    <Pressable onPress={() => router.push({ pathname: '/security/[id]', params: { id: i.security.uuid } })} style={{ paddingVertical: 3 }}>
                      <T variant="caption" numberOfLines={1}>
                        {i.security.name}
                      </T>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )
        }
      </WidgetBody>
    </WidgetCard>
  );
}

export const EVENT_TYPES: SecurityEventType[] = ['STOCK_SPLIT', 'NOTE', 'DIVIDEND_PAYMENT'];
export const EVENT_TYPE_LABELS: Record<SecurityEventType, string> = {
  STOCK_SPLIT: 'Split',
  NOTE: 'Notiz',
  DIVIDEND_PAYMENT: 'Dividendenzahlung',
};

/** EventListWidget */
export function EventListWidget({ widget, env }: WidgetProps) {
  const state = useComputed(() => {
    const interval = widgetInterval(widget, env);
    let types = widgetEnumSet(widget, 'EVENT_TYPE', EVENT_TYPES);
    if (types.length === 0) types = EVENT_TYPES;
    const items: { security: Security; event: Security['events'][number] }[] = [];
    for (const security of env.ctx.client.securities)
      for (const event of security.events) {
        if (event.date === null || !interval.contains(event.date)) continue;
        if (!types.includes(event.type)) continue;
        items.push({ security, event });
      }
    const desc = widgetEnum(widget, 'SORT_DIRECTION', SORT_DIRECTIONS) === 'DESCENDING';
    items.sort((r, l) => (desc ? (l.event.date ?? 0) - (r.event.date ?? 0) : (r.event.date ?? 0) - (l.event.date ?? 0)));
    return items;
  }, [env.ctx, widgetKey(widget, env)]);
  const base = env.ctx.client.baseCurrency;
  return (
    <WidgetCard title={widget.label} subtitle={widgetPeriod(widget, env).toString()}>
      <WidgetBody state={state}>
        {(items) =>
          items.length === 0 ? (
            <T variant="caption" secondary>
              Keine Ereignisse
            </T>
          ) : (
            <View>
              {items.slice(0, 50).map(({ security, event }, k) => {
                let type = EVENT_TYPE_LABELS[event.type];
                let details: string | null = null;
                if (event.type === 'NOTE') details = event.details;
                else if (event.type === 'STOCK_SPLIT') type += ` ${event.details ?? ''}`;
                else details = event.amount ? formatMoney(event.amount, base) : null;
                return (
                  <Pressable
                    key={k}
                    onPress={() => router.push({ pathname: '/security/[id]', params: { id: security.uuid } })}
                    style={{ paddingVertical: 4 }}
                  >
                    <T variant="small" secondary>
                      {formatDate(event.date)}: {type}
                    </T>
                    <T variant="caption" numberOfLines={1}>
                      {security.name}
                    </T>
                    {details ? (
                      <T variant="small" secondary>
                        {details}
                      </T>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )
        }
      </WidgetBody>
    </WidgetCard>
  );
}
