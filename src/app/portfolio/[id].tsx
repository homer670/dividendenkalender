import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';

import { Portfolio } from '@/core/model';
import { convertMoney } from '@/core/money/exchange';
import { money } from '@/core/money/money';
import { compareText, PortfolioSnapshot } from '@/core/snapshot/clientSnapshot';
import { today } from '@/core/util/dates';
import { COLOR_TEXT } from '@/state/dataSeries';
import { Card, EmptyState, KeyValue, ListCard, Row, Screen, T } from '@/ui/components/basic';
import { Pending } from '@/ui/components/common';
import { PeriodChips } from '@/ui/components/pickers';
import { collectTransactions, TransactionRow } from '@/ui/components/transactions';
import { LineChart } from '@/ui/charts/LineChart';
import { formatAxis, formatDate, formatMoney, formatPercent, formatPercentAnnualized, formatQuote, formatShares } from '@/ui/format';
import { useComputed, useContextOrNull, usePeriod } from '@/ui/hooks';

export default function PortfolioScreen() {
  const ctx = useContextOrNull();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!ctx) return null;
  const portfolio = ctx.client.portfolios.find((p) => p.uuid === id);
  if (!portfolio)
    return (
      <Screen>
        <EmptyState title="Depot nicht gefunden" />
      </Screen>
    );
  return <PortfolioDetail portfolio={portfolio} />;
}

function PortfolioDetail({ portfolio }: { portfolio: Portfolio }) {
  const ctx = useContextOrNull()!;
  const period = usePeriod('portfolio', ctx);
  const now = today();
  const term = ctx.termCurrency;
  const snapshot = useMemo(() => PortfolioSnapshot.create(portfolio, ctx.converter, now), [ctx, portfolio, now]);
  const positions = snapshot.positions.slice().sort((a, b) => compareText(a.investment.name, b.investment.name));
  const transactions = useMemo(
    () => collectTransactions(ctx.client).filter((e) => e.owner === portfolio),
    [ctx, portfolio],
  );
  const perf = useComputed(() => {
    const series = ctx.dataSeriesSet('STATEMENT_OF_ASSETS').availableSeries.find((s) => s.type === 'PORTFOLIO' && s.instance === portfolio);
    return series ? ctx.calculate(series, period.interval) : null;
  }, [ctx, portfolio, period.interval.start, period.interval.end]);

  return (
    <>
      <Stack.Screen options={{ title: portfolio.name }} />
      <Screen>
        <Card style={{ gap: 4 }}>
          <T variant="caption" secondary>
            Wert am {formatDate(now)}
          </T>
          <T variant="kpi">{formatMoney(snapshot.getValue())}</T>
          {portfolio.referenceAccount ? (
            <T variant="caption" secondary>
              Referenzkonto: {portfolio.referenceAccount.name}
            </T>
          ) : null}
        </Card>
        <PeriodChips periods={period.periods} selected={period.period} onSelect={period.setPeriod} />
        <Card>
          <Pending state={perf}>
            {(index) =>
              index ? (
                <>
                  <LineChart
                    series={[{ key: 'v', label: portfolio.name, color: COLOR_TEXT, area: true, dates: index.dates, values: index.totals.map((v) => v / 100) }]}
                    formatValue={(v) => formatMoney(money(term, Math.round(v * 100)))}
                    formatAxis={formatAxis}
                  />
                  <KeyValue label="TTWROR" value={formatPercent(index.getFinalAccumulatedPercentage())} signed={index.getFinalAccumulatedPercentage()} />
                  <KeyValue label="IZF" value={formatPercentAnnualized(index.getPerformanceIRR())} signed={index.getPerformanceIRR()} />
                </>
              ) : (
                <T secondary>Keine Daten</T>
              )
            }
          </Pending>
        </Card>
        {positions.length > 0 ? (
          <ListCard header="Bestand">
            {positions.map((pos) => {
              const value = convertMoney(ctx.converter, now, pos.calculateValue());
              return (
                <Row
                  key={pos.investment.uuid}
                  title={pos.investment.name}
                  subtitle={`${formatShares(pos.shares)} × ${formatQuote(pos.price.value, pos.investment.currencyCode, term)}`}
                  value={formatMoney(value, term)}
                  detail={formatPercent(snapshot.getValue().amount ? value.amount / snapshot.getValue().amount : 0)}
                  onPress={() => router.push({ pathname: '/security/[id]', params: { id: pos.investment.uuid } })}
                />
              );
            })}
          </ListCard>
        ) : null}
        {transactions.length > 0 ? (
          <ListCard header={`Buchungen (${transactions.length})`}>
            {transactions.slice(0, 500).map((e) => (
              <TransactionRow key={e.transaction.uuid} entry={e} showOwner={false} />
            ))}
          </ListCard>
        ) : null}
      </Screen>
    </>
  );
}
