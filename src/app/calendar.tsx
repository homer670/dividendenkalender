import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AccountTransaction } from '@/core/model';
import { convertMoney } from '@/core/money/exchange';
import { money } from '@/core/money/money';
import { marketValue, PortfolioSnapshot } from '@/core/snapshot/clientSnapshot';
import { ofYMD, plusMonths, toYMD, today, yearMonthKey } from '@/core/util/dates';
import { Card, Chips, ListCard, Row, Screen, SectionHeader, Segmented, T } from '@/ui/components/basic';
import { Kpi } from '@/ui/components/common';
import { FilterButton } from '@/ui/components/pickers';
import { BarChart } from '@/ui/charts/BarChart';
import { CATEGORICAL_DARK, CATEGORICAL_LIGHT } from '@/ui/charts/scale';
import { DATE_TYPE_LABELS, DateType, dividendItems, indicator, securitiesFor } from '@/ui/calc/dividends';
import { formatAxis, formatDate, formatMoney, monthName } from '@/ui/format';
import { useClientFilter, useContextOrNull } from '@/ui/hooks';
import { spacing, usePalette } from '@/ui/theme';

type Mode = 'upcoming' | 'history';

export default function CalendarScreen() {
  const ctx = useContextOrNull();
  if (!ctx) return null;
  return <Calendar />;
}

function Calendar() {
  const ctx = useContextOrNull()!;
  const p = usePalette();
  const filter = useClientFilter('calendar', ctx);
  const [mode, setMode] = useState<Mode>('upcoming');
  const [dateType, setDateType] = useState<DateType>('ALL_DATES');
  const now = today();
  const term = ctx.termCurrency;

  // shares held per security (for the estimated payment)
  const held = useMemo(() => {
    const m = new Map<string, number>();
    for (const portfolio of filter.client.portfolios)
      for (const pos of PortfolioSnapshot.create(portfolio, ctx.converter, now).positions)
        m.set(pos.investment.uuid, (m.get(pos.investment.uuid) ?? 0) + pos.shares);
    return m;
  }, [ctx, filter.client, now]);

  const upcoming = useMemo(
    () => dividendItems(securitiesFor('OWNED', ctx.client, filter.client, ctx.converter, now), dateType, now),
    [ctx, filter.client, dateType, now],
  );

  // received dividends per month (last 24 months + current)
  const received = useMemo(() => {
    const list: { t: AccountTransaction; value: number }[] = [];
    for (const a of filter.client.accounts)
      for (const t of a.transactions)
        if (t.type === 'DIVIDENDS') list.push({ t, value: convertMoney(ctx.converter, t.date, t.getMonetaryAmount()).amount });
    list.sort((x, y) => y.t.dateTime - x.t.dateTime);
    return list;
  }, [ctx, filter.client]);

  const { year: cy } = toYMD(now);
  const colors = p.dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  const byMonth = (y: number) =>
    Array.from({ length: 12 }, (_, m) => {
      const key = y * 100 + m + 1;
      return received.filter((r) => yearMonthKey(r.t.date) === key).reduce((s, r) => s + r.value, 0) / 100;
    });
  const expectedByMonth = Array.from({ length: 12 }, (_, m) => {
    const from = ofYMD(cy, m + 1, 1);
    const to = plusMonths(from, 1);
    let sum = 0;
    for (const item of upcoming) {
      if (!item.types.has('PAYMENT_DATE') || item.date < from || item.date >= to || !item.event.amount) continue;
      const shares = held.get(item.security.uuid) ?? 0;
      const amount = money(item.event.amount.currencyCode, marketValue(shares, item.event.amount.amount * 1e6));
      sum += convertMoney(ctx.converter, now, amount).amount;
    }
    return sum / 100;
  });
  const thisYear = byMonth(cy).reduce((a, b) => a + b, 0);
  const expected = expectedByMonth.reduce((a, b) => a + b, 0);

  let lastMonth = -1;
  return (
    <Screen>
      <FilterButton items={filter.items} selected={filter.item} onSelect={filter.setFilter} />
      <Card style={{ gap: spacing.m }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
          <Kpi label={`Erhalten ${cy}`} value={formatMoney(money(term, Math.round(thisYear * 100)), term)} />
          <Kpi label={`Angekündigt ${cy} (geschätzt)`} value={formatMoney(money(term, Math.round(expected * 100)), term)} />
        </View>
        <BarChart
          labels={Array.from({ length: 12 }, (_, i) => monthName(i + 1, true))}
          series={[
            { label: `Erhalten ${cy}`, color: colors[0], values: byMonth(cy) },
            { label: 'Angekündigt', color: colors[3], values: expectedByMonth },
            { label: `${cy - 1}`, color: colors[2], values: byMonth(cy - 1) },
          ]}
          formatValue={(v) => formatMoney(money(term, Math.round(v * 100)), term)}
          formatAxis={formatAxis}
          minBarWidth={4}
        />
      </Card>
      <Segmented
        items={[
          { key: 'upcoming', label: 'Angekündigt' },
          { key: 'history', label: 'Erhalten' },
        ]}
        selected={mode}
        onSelect={setMode}
      />
      {mode === 'upcoming' ? (
        <>
          <Chips
            items={(Object.keys(DATE_TYPE_LABELS) as DateType[]).map((k) => ({ key: k, label: DATE_TYPE_LABELS[k] }))}
            selected={dateType}
            onSelect={setDateType}
          />
          {upcoming.length === 0 ? (
            <Card>
              <T secondary>
                Keine angekündigten Dividenden für Wertpapiere im Bestand. Termine werden in Portfolio Performance (Desktop) über die
                Dividenden-Ereignisse der Wertpapiere gepflegt.
              </T>
            </Card>
          ) : (
            upcoming.map((item, i) => {
              const shares = held.get(item.security.uuid) ?? 0;
              const est =
                item.event.amount && shares
                  ? money(item.event.amount.currencyCode, marketValue(shares, item.event.amount.amount * 1e6))
                  : null;
              return (
                <View key={i}>
                  {item.hasNewDate ? <SectionHeader title={formatDate(item.date)} /> : null}
                  <ListCard>
                    <Row
                      title={item.security.name}
                      subtitle={`${indicator(item)} ${item.types.has('EX_DIVIDEND_DATE') ? 'Ex-Tag' : ''}${item.types.size === 2 ? ' / ' : ''}${
                        item.types.has('PAYMENT_DATE') ? 'Zahltag' : ''
                      }`}
                      value={item.event.amount ? `${formatMoney(item.event.amount, term)} je Stück` : ''}
                      detail={est ? `≈ ${formatMoney(convertMoney(ctx.converter, now, est), term)}` : undefined}
                      onPress={() => router.push({ pathname: '/security/[id]', params: { id: item.security.uuid } })}
                    />
                  </ListCard>
                </View>
              );
            })
          )}
        </>
      ) : (
        received.slice(0, 300).map(({ t, value }) => {
          const key = yearMonthKey(t.date);
          const header = key !== lastMonth;
          lastMonth = key;
          const { year, month } = toYMD(t.date);
          return (
            <View key={t.uuid}>
              {header ? <SectionHeader title={`${monthName(month)} ${year}`} /> : null}
              <ListCard>
                <Row
                  title={t.security?.name ?? 'Dividende'}
                  subtitle={formatDate(t.date)}
                  value={formatMoney(money(term, value), term)}
                  valueSigned={value}
                  detail={t.currencyCode !== term ? formatMoney(t.getMonetaryAmount()) : undefined}
                  onPress={t.security ? () => router.push({ pathname: '/security/[id]', params: { id: t.security!.uuid } }) : undefined}
                />
              </ListCard>
            </View>
          );
        })
      )}
    </Screen>
  );
}
