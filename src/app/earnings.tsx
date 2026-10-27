import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Switch, View } from 'react-native';

import { money } from '@/core/money/money';
import { calculatePayments, defaultStartYear, PAYMENTS_MODE_LABELS, PaymentsMode } from '@/core/snapshot/payments';
import { today, toYMD, year as yearOf } from '@/core/util/dates';
import { Security } from '@/core/model';
import { useSettings } from '@/state/settings';
import { Card, Chips, ListCard, Row, Screen, Segmented, T } from '@/ui/components/basic';
import { Kpi, Pending } from '@/ui/components/common';
import { FilterButton } from '@/ui/components/pickers';
import { OptionSheet } from '@/ui/components/Sheet';
import { TransactionRow } from '@/ui/components/transactions';
import { BarChart } from '@/ui/charts/BarChart';
import { CATEGORICAL_DARK, CATEGORICAL_LIGHT } from '@/ui/charts/scale';
import { formatAxis, formatMoney, monthName } from '@/ui/format';
import { useClientFilter, useComputed, useContextOrNull } from '@/ui/hooks';
import { spacing, usePalette } from '@/ui/theme';

type View_ = 'months' | 'years' | 'securities' | 'transactions';

const MODES: PaymentsMode[] = ['DIVIDENDS', 'INTEREST', 'EARNINGS', 'TAXES', 'FEES', 'TRADES', 'ALL', 'SAVING'];

export default function EarningsScreen() {
  const ctx = useContextOrNull();
  if (!ctx) return null;
  return <Earnings />;
}

function Earnings() {
  const ctx = useContextOrNull()!;
  const p = usePalette();
  const settings = useSettings();
  const filter = useClientFilter('earnings', ctx);
  const [mode, setMode] = useState<PaymentsMode>('EARNINGS');
  const [gross, setGross] = useState(false);
  const [view, setView] = useState<View_>('months');
  const currentYear = yearOf(today());
  const firstYear = useMemo(() => defaultStartYear(ctx.client), [ctx]);
  const minYear = useMemo(() => {
    let min = currentYear;
    for (const { transaction } of ctx.client.getAllTransactions()) min = Math.min(min, yearOf(transaction.date));
    return min;
  }, [ctx, currentYear]);
  const [startYear, setStartYear] = useState(firstYear);
  const [yearOpen, setYearOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const state = useComputed(
    () =>
      calculatePayments(ctx.client, filter.client, ctx.converter, {
        startYear,
        mode,
        useGrossValue: gross,
        useConsolidateRetired: false,
        costMethod: settings.costMethod,
      }),
    [ctx, filter.client, startYear, mode, gross, settings.costMethod],
  );
  const term = ctx.termCurrency;
  const fm = (v: number) => formatMoney(money(term, Math.round(v)), term);
  const colors = p.dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  const years: number[] = [];
  for (let y = startYear; y <= currentYear; y++) years.push(y);

  return (
    <Screen>
      <Chips items={MODES.map((m) => ({ key: m, label: PAYMENTS_MODE_LABELS[m] }))} selected={mode} onSelect={setMode} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m, flexWrap: 'wrap' }}>
        <FilterButton items={filter.items} selected={filter.item} onSelect={filter.setFilter} />
        <T variant="caption" color={p.accent} onPress={() => setYearOpen(true)}>
          ab {startYear}
        </T>
        {mode === 'DIVIDENDS' || mode === 'INTEREST' || mode === 'EARNINGS' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <T variant="caption" secondary>
              Brutto
            </T>
            <Switch value={gross} onValueChange={setGross} />
          </View>
        ) : null}
      </View>
      <Segmented
        items={[
          { key: 'months', label: 'Monate' },
          { key: 'years', label: 'Jahre' },
          { key: 'securities', label: 'Positionen' },
          { key: 'transactions', label: 'Buchungen' },
        ]}
        selected={view}
        onSelect={setView}
      />
      <Pending state={state}>
        {(r) => {
          const yearSum = (y: number) => {
            let s = 0;
            for (let m = 0; m < 12; m++) s += r.sum.values[(y - r.startYear) * 12 + m] ?? 0;
            return s;
          };
          const thisYear = yearSum(currentYear);
          const lastYear = currentYear - 1 >= r.startYear ? yearSum(currentYear - 1) : null;
          const lines = r.lines
            .map((l) => {
              let v = 0;
              for (let m = 0; m < 12; m++) v += l.values[(selectedYear - r.startYear) * 12 + m] ?? 0;
              return { line: l, value: v };
            })
            .filter((x) => x.value !== 0)
            .sort((a, b) => b.value - a.value);
          const shownYears = years.slice(-5);
          return (
            <>
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
                  <Kpi label={`Summe ${currentYear}`} value={fm(thisYear)} signed={mode === 'TAXES' || mode === 'FEES' ? undefined : thisYear} />
                  {lastYear !== null ? <Kpi label={`Summe ${currentYear - 1}`} value={fm(lastYear)} /> : null}
                  <Kpi label={`Gesamt seit ${r.startYear}`} value={fm(r.sum.sum)} />
                  <Kpi label="Ø pro Monat (lfd. Jahr)" value={fm(thisYear / toYMD(today()).month)} />
                </View>
              </Card>
              {view === 'months' ? (
                <Card>
                  <BarChart
                    labels={Array.from({ length: 12 }, (_, i) => monthName(i + 1, true))}
                    series={shownYears.map((y, i) => ({
                      label: String(y),
                      color: colors[i % colors.length],
                      values: Array.from({ length: 12 }, (_, m) => (r.sum.values[(y - r.startYear) * 12 + m] ?? 0) / 100),
                    }))}
                    formatValue={(v) => fm(v * 100)}
                    formatAxis={formatAxis}
                    minBarWidth={4}
                  />
                </Card>
              ) : null}
              {view === 'years' ? (
                <Card>
                  <BarChart
                    labels={years.map(String)}
                    series={[{ label: PAYMENTS_MODE_LABELS[mode], color: colors[0], values: years.map((y) => yearSum(y) / 100) }]}
                    formatValue={(v) => fm(v * 100)}
                    formatAxis={formatAxis}
                  />
                </Card>
              ) : null}
              {view === 'securities' ? (
                <>
                  <Chips items={years.slice().reverse().map((y) => ({ key: String(y), label: String(y) }))} selected={String(selectedYear)} onSelect={(y) => setSelectedYear(Number(y))} />
                  {lines.length === 0 ? (
                    <T secondary>Keine Werte im Jahr {selectedYear}.</T>
                  ) : (
                    <ListCard>
                      {lines.map(({ line, value }) => (
                        <Row
                          key={line.vehicle?.uuid ?? 'x'}
                          title={line.vehicle?.name ?? ''}
                          value={fm(value)}
                          valueSigned={value}
                          onPress={
                            line.vehicle instanceof Security
                              ? () => router.push({ pathname: '/security/[id]', params: { id: line.vehicle!.uuid } })
                              : undefined
                          }
                        />
                      ))}
                    </ListCard>
                  )}
                </>
              ) : null}
              {view === 'transactions' ? (
                r.transactions.length === 0 ? (
                  <T secondary>Keine Buchungen.</T>
                ) : (
                  <ListCard>
                    {r.transactions
                      .slice()
                      .reverse()
                      .slice(0, 400)
                      .map((e) => (
                        <TransactionRow key={e.transaction.uuid} entry={e} />
                      ))}
                  </ListCard>
                )
              ) : null}
            </>
          );
        }}
      </Pending>
      <OptionSheet
        visible={yearOpen}
        onClose={() => setYearOpen(false)}
        title="Startjahr"
        options={Array.from({ length: currentYear - minYear + 1 }, (_, i) => {
          const y = currentYear - i;
          return { key: y, label: String(y) };
        })}
        selected={startYear}
        onSelect={(y) => setStartYear(Number(y))}
      />
    </Screen>
  );
}
