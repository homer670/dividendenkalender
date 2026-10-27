import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { View } from 'react-native';

import { quote } from '@/core/money/money';
import { convertQuote } from '@/core/money/exchange';
import { AllTimeHigh } from '@/core/snapshot/securityIndex';
import { SecurityPerformanceSnapshot } from '@/core/snapshot/securityPerformance';
import { today } from '@/core/util/dates';
import { useSettings } from '@/state/settings';
import { COLOR_TEXT } from '@/state/dataSeries';
import { Card, EmptyState, KeyValue, ListCard, Screen, SectionHeader, T } from '@/ui/components/basic';
import { Kpi, Pending } from '@/ui/components/common';
import { PeriodChips } from '@/ui/components/pickers';
import { collectTransactions, TransactionRow } from '@/ui/components/transactions';
import { LineChart } from '@/ui/charts/LineChart';
import { allTimeRecords } from '@/ui/calc/statement';
import { formatDate, formatMoney, formatPercent, formatPercentAnnualized, formatQuote, formatShares } from '@/ui/format';
import { useComputed, useContextOrNull, usePeriod } from '@/ui/hooks';
import { spacing } from '@/ui/theme';
import { PERIODICITY_LABELS } from '@/ui/labels';


export default function SecurityScreen() {
  const ctx = useContextOrNull();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!ctx) return null;
  const security = ctx.client.securities.find((s) => s.uuid === id);
  if (!security)
    return (
      <Screen>
        <EmptyState title="Wertpapier nicht gefunden" />
      </Screen>
    );
  return <SecurityDetail id={security.uuid} />;
}

function SecurityDetail({ id }: { id: string }) {
  const ctx = useContextOrNull()!;
  const security = ctx.client.securities.find((s) => s.uuid === id)!;
  const settings = useSettings();
  const period = usePeriod('security', ctx);
  const term = ctx.termCurrency;
  const now = today();

  const transactions = useMemo(
    () => collectTransactions(ctx.client).filter((e) => e.transaction.security === security),
    [ctx, security],
  );

  const state = useComputed(() => {
    const allTime = ctx.cached(`allTime::${now}`, () => allTimeRecords(ctx.client, ctx.converter, now)).getRecord(security) ?? null;
    const inPeriod = SecurityPerformanceSnapshot.create(ctx.client, ctx.converter, period.interval).getRecord(security) ?? null;
    const prices = security.getPricesIncludingLatest().filter((p) => p.date > period.interval.start && p.date <= period.interval.end);
    const ath = new AllTimeHigh(security, period.interval);
    return { allTime, inPeriod, prices, ath };
  }, [ctx, security, period.interval.start, period.interval.end]);

  const latest = security.getSecurityPrice(now);
  const two = security.getLatestTwoSecurityPrices(now);
  const change = two && two[1].value !== 0 ? two[0].value / two[1].value - 1 : null;
  const cur = security.currencyCode;
  const upcoming = security.events
    .filter((e) => e.type === 'DIVIDEND_PAYMENT' && e.paymentDate != null && e.paymentDate >= now)
    .sort((a, b) => (a.paymentDate ?? 0) - (b.paymentDate ?? 0));
  const notes = security.events.filter((e) => e.type !== 'DIVIDEND_PAYMENT').slice(-10).reverse();

  return (
    <>
      <Stack.Screen options={{ title: security.name }} />
      <Screen>
        <View style={{ gap: 2 }}>
          <T variant="title">{security.name}</T>
          <T variant="caption" secondary>
            {[security.isin, security.wkn, security.tickerSymbol, cur].filter(Boolean).join(' · ')}
          </T>
        </View>
        <Card style={{ gap: spacing.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.s, flexWrap: 'wrap' }}>
            <T variant="kpi">{formatQuote(latest.value, cur)}</T>
            {change !== null ? (
              <T signed={change} weight="600">
                {change > 0 ? '+' : ''}
                {formatPercent(change)}
              </T>
            ) : null}
          </View>
          <T variant="caption" secondary>
            Kurs vom {formatDate(latest.date)}
            {cur && cur !== term && latest.value
              ? ` · ${formatQuote(convertQuote(ctx.converter, latest.date, quote(cur, latest.value)).amount, term)}`
              : ''}
          </T>
        </Card>
        <PeriodChips periods={period.periods} selected={period.period} onSelect={period.setPeriod} />
        <Pending state={state}>
          {(r) => (
            <>
              <Card style={{ gap: spacing.s }}>
                <LineChart
                  series={[
                    {
                      key: 'price',
                      label: security.name,
                      color: COLOR_TEXT,
                      area: true,
                      dates: r.prices.map((x) => x.date),
                      values: r.prices.map((x) => x.value / 1e8),
                    },
                  ]}
                  height={200}
                  formatValue={(v) => formatQuote(Math.round(v * 1e8), cur)}
                  formatAxis={(v) => formatQuote(Math.round(v * 1e8))}
                />
                {r.ath.value !== null ? (
                  <View>
                    <KeyValue label={`Höchstkurs im Zeitraum (${formatDate(r.ath.date)})`} value={formatQuote(r.ath.value, cur)} />
                    <KeyValue label="Abstand zum Höchstkurs" value={formatPercent(r.ath.distance ?? 0)} signed={r.ath.distance} />
                    <KeyValue label={`Tiefstkurs im Zeitraum (${formatDate(r.ath.lowDate)})`} value={formatQuote(r.ath.low ?? 0, cur)} />
                  </View>
                ) : null}
              </Card>
              {r.allTime && r.allTime.getSharesHeld() !== 0 ? (
                <View>
                  <SectionHeader title="Bestand" />
                  <Card>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
                      <Kpi label="Stück" value={formatShares(r.allTime.getSharesHeld())} />
                      <Kpi label="Marktwert" value={formatMoney(r.allTime.getMarketValue(), term)} />
                      <Kpi label="Einstandswert" value={formatMoney(r.allTime.getCost(settings.costMethod), term)} />
                      <Kpi label="Einstandskurs" value={formatQuote(r.allTime.getCostPerSharesHeld(settings.costMethod).amount, term)} />
                      <Kpi
                        label="Kursgewinn"
                        value={formatMoney(r.allTime.getCapitalGainsOnHoldings(settings.costMethod), term)}
                        signed={r.allTime.getCapitalGainsOnHoldings(settings.costMethod).amount}
                        sub={formatPercent(r.allTime.getCapitalGainsOnHoldingsPercent(settings.costMethod))}
                      />
                      <Kpi label="Summe Dividenden" value={formatMoney(r.allTime.getSumOfDividends(), term)} />
                    </View>
                  </Card>
                </View>
              ) : null}
              {r.inPeriod ? (
                <View>
                  <SectionHeader title={`Performance · ${period.period.toString()}`} />
                  <Card>
                    <KeyValue label="Interner Zinsfuß (IZF)" value={formatPercentAnnualized(r.inPeriod.getIrr())} signed={r.inPeriod.getIrr()} />
                    <KeyValue
                      label="TTWROR"
                      value={formatPercent(r.inPeriod.getTrueTimeWeightedRateOfReturn())}
                      signed={r.inPeriod.getTrueTimeWeightedRateOfReturn()}
                    />
                    <KeyValue label="TTWROR p.a." value={formatPercent(r.inPeriod.getTrueTimeWeightedRateOfReturnAnnualized())} />
                    <KeyValue label="Delta" value={formatMoney(r.inPeriod.getDelta(), term)} signed={r.inPeriod.getDelta().amount} />
                    <KeyValue label="Delta in %" value={formatPercent(r.inPeriod.getDeltaPercent())} signed={r.inPeriod.getDeltaPercent()} />
                    <KeyValue label="Dividenden" value={formatMoney(r.inPeriod.getSumOfDividends(), term)} />
                    <KeyValue label="Ausschüttungsrhythmus" value={PERIODICITY_LABELS[r.inPeriod.getPeriodicity()] ?? '-'} />
                    <KeyValue label="Dividendenrendite (Ø p.a.)" value={formatPercent(r.inPeriod.getRateOfReturnPerYear())} />
                    <KeyValue label="Gebühren" value={formatMoney(r.inPeriod.getFees(), term)} />
                    <KeyValue label="Steuern" value={formatMoney(r.inPeriod.getTaxes(), term)} />
                    <KeyValue label="Max. Drawdown" value={formatPercent(r.inPeriod.getDrawdown().getMaxDrawdown())} />
                    <KeyValue label="Volatilität" value={formatPercent(r.inPeriod.getVolatility().getStandardDeviation())} />
                  </Card>
                </View>
              ) : null}
            </>
          )}
        </Pending>
        {upcoming.length > 0 ? (
          <ListCard header="Angekündigte Dividenden">
            {upcoming.map((e, i) => (
              <View key={i} style={{ padding: spacing.l, gap: 2 }}>
                <KeyValue label={`Zahltag ${formatDate(e.paymentDate)}`} value={e.amount ? formatMoney(e.amount) : ''} />
                {e.date ? <KeyValue label="Ex-Tag" value={formatDate(e.date)} /> : null}
              </View>
            ))}
          </ListCard>
        ) : null}
        {transactions.length > 0 ? (
          <ListCard header="Buchungen">
            {transactions.map((e) => (
              <TransactionRow key={e.transaction.uuid} entry={e} />
            ))}
          </ListCard>
        ) : null}
        {notes.length > 0 ? (
          <ListCard header="Ereignisse">
            {notes.map((e, i) => (
              <View key={i} style={{ padding: spacing.l }}>
                <T variant="caption" secondary>
                  {formatDate(e.date)} · {e.type === 'STOCK_SPLIT' ? 'Aktiensplit' : 'Notiz'}
                </T>
                <T>{e.details ?? ''}</T>
              </View>
            ))}
          </ListCard>
        ) : null}
        {security.note ? (
          <Card>
            <T variant="caption" secondary>
              Notiz
            </T>
            <T>{security.note}</T>
          </Card>
        ) : null}
      </Screen>
    </>
  );
}
