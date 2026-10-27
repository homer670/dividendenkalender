// Widgets with special logic: MaxDrawdownDuration, Ratio, TaxOrFeeRate, Trades, ExchangeRate, CurrentDate, FIRE

import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { DashboardWidget } from '../../core/model';
import { money, MutableMoney } from '../../core/money/money';
import { ClientPerformanceSnapshot } from '../../core/snapshot/clientPerformanceSnapshot';
import { CostMethod } from '../../core/snapshot/securityPerformance';
import { Trade, TradeCollector } from '../../core/snapshot/trades';
import { LocalDate, plusYears, toLocalDate, today } from '../../core/util/dates';
import { Interval } from '../../core/util/interval';
import { formatDate, formatDateLong, formatMoney, formatMoneyShort, formatNumber, formatPercent } from '../format';
import { useComputed } from '../hooks';
import { msg } from '../i18n';
import { T } from '../components/basic';
import { radius, spacing, usePalette } from '../theme';
import {
  cfg,
  Config,
  DashboardEnv,
  widgetBool,
  widgetDataSeries,
  widgetEnum,
  widgetFilter,
  widgetInterval,
  widgetKey,
  widgetPeriod,
} from './env';
import { KpiCard, WidgetBody, WidgetCard } from './frame';

export interface WidgetProps {
  widget: DashboardWidget;
  env: DashboardEnv;
  update: (patch: Config) => void;
}

export function MaxDrawdownDurationWidget({ widget, env }: WidgetProps) {
  const ds = widgetDataSeries(widget, env);
  const state = useComputed(() => {
    const index = env.ctx.calculate(ds, widgetInterval(widget, env));
    const dd = index.getDrawdown();
    const duration = dd.getMaxDrawdownDuration();
    const untilEnd = duration.end === index.reportInterval.end;
    const recovery = dd.getLongestRecoveryTime();
    const recoveryUntilEnd = recovery.end === index.reportInterval.end;
    const supplement = (iv: Interval, open: boolean) =>
      msg(open ? 'TooltipMaxDrawdownDurationEndOfPeriod' : 'TooltipMaxDrawdownDurationFromXtoY', formatDateLong(iv.start), formatDateLong(iv.end));
    return {
      text: msg('LabelXDays', `${duration.getDays()}${untilEnd ? '+' : ''}`),
      tooltip: `${msg('TooltipMaxDrawdownDuration')}\n\n${supplement(duration, untilEnd)}\n\n${msg('TooltipMaxDurationLowToHigh', recovery.getDays())}\n${supplement(recovery, recoveryUntilEnd)}`,
    };
  }, [env.ctx, widgetKey(widget, env)]);
  return (
    <KpiCard
      title={widget.label}
      value={state.value?.text ?? ''}
      subtitle={widgetPeriod(widget, env).toString()}
      info={state.value?.tooltip}
      loading={!state.value}
    />
  );
}

export function RatioWidget({ widget, env }: WidgetProps) {
  const p = usePalette();
  const ds = widgetDataSeries(widget, env);
  const base = widgetDataSeries(widget, env, 'SECONDARY_DATA_SERIES');
  const state = useComputed(() => {
    const end = widgetInterval(widget, env).end;
    const interval = Interval.of(end, end);
    const index = env.ctx.calculate(ds, interval);
    const baseIndex = env.ctx.calculate(base, interval);
    return index.totals[index.totals.length - 1] / baseIndex.totals[baseIndex.totals.length - 1];
  }, [env.ctx, widgetKey(widget, env)]);
  const rate = state.value;
  const colored = widgetBool(widget, 'FLAG_COLORED_VALUE', false);
  return (
    <KpiCard
      title={widget.label}
      value={rate === null ? '' : Number.isFinite(rate) || Number.isNaN(rate) ? formatPercent(rate) : '-'}
      color={rate !== null && colored ? (rate < 0 ? p.negative : p.positive) : undefined}
      subtitle={`${ds.label} / ${base.label}`}
      loading={state.loading && rate === null}
    />
  );
}

export function TaxOrFeeRateWidget({ widget, env, kind }: WidgetProps & { kind: 'TAXES' | 'FEES' }) {
  const ds = widgetDataSeries(widget, env);
  const state = useComputed(() => {
    const snapshot: ClientPerformanceSnapshot = env.ctx.calculate(ds, widgetInterval(widget, env)).getClientPerformanceSnapshot();
    const rate = kind === 'TAXES' ? snapshot.getPortfolioTaxRate() : snapshot.getPortfolioFeeRate();
    return Number.isNaN(rate) ? snapshot.getValue(kind) : rate;
  }, [env.ctx, widgetKey(widget, env)]);
  const v = state.value;
  const tooltip = msg(kind === 'TAXES' ? 'TooltipPortfolioTaxRate' : 'TooltipPortfolioFeeRate');
  let text = '';
  let info = tooltip;
  if (typeof v === 'number') text = Number.isFinite(v) ? formatPercent(v) : '-';
  else if (v) {
    text = `${formatMoney(v)}*`;
    info = `${tooltip}\n\n* ${msg('LabelPortfolioRateNotAvailable')}`;
  }
  return <KpiCard title={widget.label} value={text} subtitle={widgetPeriod(widget, env).toString()} info={info} loading={v === null} />;
}

/** AbstractTradesWidget#getUpdateTask */
function collectTrades(widget: DashboardWidget, env: DashboardEnv, useSecurityCurrency: boolean): Trade[] {
  const filter = widgetFilter(widget, env);
  const key = `trades|${useSecurityCurrency}|${filter.id}`;
  return env.ctx.cached(key, () => {
    const filtered = env.ctx.filteredClient(filter.id);
    const trades: Trade[] = [];
    const cache = new Map();
    for (const s of env.ctx.client.securities) {
      try {
        let converter = env.ctx.converter;
        if (useSecurityCurrency && s.currencyCode != null) converter = converter.with(s.currencyCode);
        trades.push(...new TradeCollector(filtered, converter, 'COMBINED', cache).collect(s));
      } catch {
        // TradeCollectorException: ignored as in PP
      }
    }
    return trades;
  });
}

function closedInInterval(interval: Interval) {
  return (t: Trade) => t.end !== null && interval.containsDateTime(t.end);
}

export function TradesWidget({ widget, env, variant }: WidgetProps & { variant: 'BASIC' | 'PROFIT_LOSS' | 'HOLDING' }) {
  const p = usePalette();
  const state = useComputed(() => {
    const interval = widgetInterval(widget, env);
    const useSecurityCurrency = variant === 'BASIC' && widgetBool(widget, 'FLAG_USE_SECURITY_CURRENCY', false);
    const all = collectTrades(widget, env, useSecurityCurrency);
    if (variant === 'HOLDING') {
      const now = today();
      const trades = all.filter((t) => {
        const start = toLocalDate(t.start);
        const end = t.end !== null ? toLocalDate(t.end) : now;
        return !(start > interval.end) && end > interval.start;
      });
      const totalPurchase = trades.reduce((s, t) => s + t.entryValue.amount, 0);
      const days = trades.reduce((s, t) => s + (t.holdingPeriod * t.entryValue.amount) / totalPurchase, 0);
      const metric = widgetEnum(widget, 'METRIC', ['DAY', 'YEAR'] as const);
      return {
        text: metric === 'DAY' ? msg('LabelMetricDaysFormatter', formatNumber(Math.round(days), 0)) : msg('LabelMetricYearsFormatter', formatNumber(days / 365, 0, 1)),
        color: undefined as string | undefined,
      };
    }
    const trades = all.filter(closedInInterval(interval));
    if (variant === 'BASIC') {
      const positive = trades.filter((t) => t.getProfitLoss().amount > 0).length;
      return { text: `${trades.length}  ↑${positive}  ↓${trades.length - positive}`, color: undefined };
    }
    const method = widgetEnum(widget, 'COST_METHOD', ['FIFO', 'MOVING_AVERAGE'] as const) as CostMethod;
    const sum = MutableMoney.of(env.ctx.termCurrency);
    for (const t of trades) {
      const v = method === 'FIFO' ? t.getProfitLoss() : t.getProfitLossMovingAverage();
      if (v) sum.add(v);
    }
    const m = sum.toMoney();
    return { text: formatMoney(m, env.ctx.client.baseCurrency), color: m.amount < 0 ? p.negative : p.positive };
  }, [env.ctx, widgetKey(widget, env), p.dark]);
  return (
    <KpiCard
      title={widget.label}
      value={state.value?.text ?? ''}
      color={state.value?.color}
      subtitle={widgetPeriod(widget, env).toString()}
      info={variant === 'HOLDING' ? msg('TooltipAverageHoldingPeriod') : undefined}
      loading={!state.value}
    />
  );
}

export function ExchangeRateWidget({ widget, env }: WidgetProps) {
  const code = cfg(widget, 'EXCHANGE_RATE_SERIES');
  const slash = code ? code.indexOf('/') : -1;
  const base = slash > 0 ? code!.substring(0, slash) : null;
  const term = slash > 0 ? code!.substring(slash + 1) : null;
  const available = env.ctx.factory.getAvailableTimeSeries();
  const series = available.find((t) => t.baseCurrency === base && t.termCurrency === term) ?? env.ctx.factory.getTimeSeries('EUR', 'USD');
  const date = widgetInterval(widget, env).end;
  const rate = series.lookupRate(date);
  return (
    <KpiCard
      title={widget.label}
      value={`${series.baseCurrency}/${series.termCurrency} ${rate ? formatNumber(rate.value.toNumber(), 4) : '-'}`}
      subtitle={rate ? `Kurs vom ${formatDate(rate.date)}` : undefined}
    />
  );
}

export function CurrentDateWidget({ widget }: WidgetProps) {
  return (
    <WidgetCard>
      <T variant="headline">
        {widget.label} {formatDateLong(today())}
      </T>
    </WidgetCard>
  );
}

const MAX_TIME_TO_FIRE_YEARS = 50;
const EPSILON_MONTHS = 0.01;

/** FIREWidget#calculateTimeToFIRE */
export function calculateTimeToFIRE(currentValue: number, fireNumber: number, monthlySavings: number, annualReturn: number): number {
  if (currentValue >= fireNumber) return 0;
  if (monthlySavings < 0) return Number.POSITIVE_INFINITY;
  const monthlyReturn = Math.pow(1.0 + annualReturn, 1.0 / 12.0) - 1.0;
  if (monthlySavings === 0) {
    if (currentValue <= 0 || monthlyReturn <= 0) return Number.POSITIVE_INFINITY;
    return Math.log(fireNumber / currentValue) / Math.log(1 + monthlyReturn) / 12.0;
  }
  if (monthlyReturn <= 0) return (fireNumber - currentValue) / (monthlySavings * 12);
  let low = 0;
  let high = MAX_TIME_TO_FIRE_YEARS * 12.0;
  while (high - low > EPSILON_MONTHS) {
    const mid = (low + high) / 2.0;
    const power = Math.pow(1 + monthlyReturn, mid);
    const fv = currentValue * power + monthlySavings * ((power - 1) / monthlyReturn);
    if (fv < fireNumber) low = mid;
    else high = mid;
  }
  return (low + high) / 2.0 / 12.0;
}

/** parses a localized amount ("1.500.000,00" or "1’500’000.00") into cents */
export function parseAmount(text: string): number | null {
  let s = text.replace(/[\s’'%]/g, '').trim();
  if (s.length === 0) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const decimalSep = lastComma > lastDot ? ',' : '.';
  const groupSep = decimalSep === ',' ? '.' : ',';
  // a single dot followed by exactly three digits is a group separator in German notation
  if (decimalSep === '.' && lastComma < 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  s = s.split(groupSep).join('').replace(decimalSep, '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function FIREWidget({ widget, env, update }: WidgetProps) {
  const p = usePalette();
  const currency = env.ctx.client.baseCurrency;
  const fireNumber = parseLong(cfg(widget, 'FIRE_NUMBER'));
  const monthlySavings = parseLong(cfg(widget, 'FIRE_MONTHLY_SAVINGS'));
  const returnsStr = cfg(widget, 'FIRE_RETURNS');
  const returns = returnsStr !== undefined && returnsStr !== '' && !Number.isNaN(Number(returnsStr)) ? Number(returnsStr) : null;
  const ds = widgetDataSeries(widget, env);
  const state = useComputed(() => {
    const now = today();
    const index = env.ctx.calculate(ds, Interval.of(plusYears(now, -1), now));
    const currentValue = index.totals.length > 0 ? index.totals[index.totals.length - 1] : null;
    const twror = returns ?? NaN;
    let timeToFire = NaN;
    let targetDate: LocalDate | null = null;
    if (fireNumber !== null && currentValue !== null && monthlySavings !== null && !Number.isNaN(twror)) {
      timeToFire = calculateTimeToFIRE(currentValue, fireNumber, monthlySavings, twror);
      if (timeToFire > 0 && timeToFire < MAX_TIME_TO_FIRE_YEARS - EPSILON_MONTHS / 12.0) targetDate = now + Math.round(timeToFire * 365.25);
    }
    return { currentValue, timeToFire, targetDate };
  }, [env.ctx, widgetKey(widget, env)]);
  const unset = 'Tippen zum Setzen';
  const r = state.value;
  let timeText = '-';
  let dateText = '-';
  let timeColor: string | undefined;
  if (r && fireNumber !== null && !Number.isNaN(r.timeToFire)) {
    if (r.timeToFire >= MAX_TIME_TO_FIRE_YEARS - EPSILON_MONTHS / 12.0) timeText = `${msg('LabelMetricYearsFormatter', MAX_TIME_TO_FIRE_YEARS)}+`;
    else if (r.timeToFire > 0 && r.timeToFire < 100) {
      timeText = msg('LabelMetricYearsFormatter', formatNumber(r.timeToFire, 0, 1));
      dateText = r.targetDate !== null ? formatDate(r.targetDate) : '-';
    } else if (r.timeToFire === 0) {
      timeText = msg('LabelFIREAchieved');
      dateText = 'Heute';
      timeColor = p.positive;
    }
  }
  return (
    <WidgetCard title={widget.label}>
      <WidgetBody state={state}>
        {(v) => (
          <View style={{ gap: 6, marginTop: 4 }}>
            <FireRow label={msg('LabelFIRECurrentNetWorth')} value={v.currentValue !== null ? formatMoneyShort(money(currency, v.currentValue), currency) : '-'} />
            <EditableFireRow
              label={msg('LabelFIRENumber')}
              value={fireNumber !== null ? formatMoneyShort(money(currency, fireNumber), currency) : unset}
              initial={fireNumber !== null ? formatNumber(fireNumber / 100, 2) : '1500000'}
              onCommit={(t) => {
                const a = parseAmount(t);
                if (a !== null) update({ FIRE_NUMBER: String(a) });
              }}
            />
            <EditableFireRow
              label={msg('LabelFIREMonthlySavings')}
              value={monthlySavings !== null ? formatMoneyShort(money(currency, monthlySavings), currency) : unset}
              color={monthlySavings !== null ? (monthlySavings < 0 ? p.negative : p.positive) : undefined}
              initial={monthlySavings !== null ? formatNumber(monthlySavings / 100, 2) : '5000'}
              onCommit={(t) => {
                const a = parseAmount(t);
                if (a !== null) update({ FIRE_MONTHLY_SAVINGS: String(a) });
              }}
            />
            <EditableFireRow
              label={msg('LabelFIREReturns')}
              value={returns !== null ? formatPercent(returns) : unset}
              color={returns !== null ? (returns < 0 ? p.negative : p.positive) : undefined}
              initial={formatNumber((returns ?? 0.07) * 100, 2)}
              onCommit={(t) => {
                const a = parseAmount(t);
                if (a !== null) update({ FIRE_RETURNS: String(a / 100 / 100) });
              }}
            />
            <FireRow label={msg('LabelFIRETimeToFIRE')} value={timeText} color={timeColor} />
            <FireRow label={msg('LabelFIRETargetDate')} value={dateText} color={timeColor} />
          </View>
        )}
      </WidgetBody>
    </WidgetCard>
  );
}

function parseLong(v: string | undefined): number | null {
  if (v === undefined || v === '' || !/^-?\d+$/.test(v)) return null;
  return Number.parseInt(v, 10);
}

function FireRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.fireRow}>
      <T variant="caption" secondary style={{ flex: 1 }}>
        {label}
      </T>
      <T numeric weight="600" color={color}>
        {value}
      </T>
    </View>
  );
}

function EditableFireRow({ label, value, color, initial, onCommit }: { label: string; value: string; color?: string; initial: string; onCommit: (text: string) => void }) {
  const p = usePalette();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial);
  if (editing)
    return (
      <View style={styles.fireRow}>
        <T variant="caption" secondary style={{ flex: 1 }}>
          {label}
        </T>
        <TextInput
          autoFocus
          value={text}
          onChangeText={setText}
          keyboardType="numbers-and-punctuation"
          onSubmitEditing={() => {
            onCommit(text);
            setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          style={[styles.input, { color: p.text, backgroundColor: p.inputBackground }]}
        />
      </View>
    );
  return (
    <Pressable
      onPress={() => {
        setText(initial);
        setEditing(true);
      }}
      style={styles.fireRow}
    >
      <T variant="caption" secondary style={{ flex: 1 }}>
        {label}
      </T>
      <T numeric weight="600" color={color ?? p.accent}>
        {value}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fireRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, minHeight: 28 },
  input: { minWidth: 120, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.s, textAlign: 'right' },
});

