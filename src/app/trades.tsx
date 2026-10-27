import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { collectAllTrades, Trade, TradeTotals } from '@/core/snapshot/trades';
import { toLocalDate } from '@/core/util/dates';
import { useSettings } from '@/state/settings';
import { Card, ListCard, Notice, Row, Screen, Segmented, T } from '@/ui/components/basic';
import { Kpi, Pending } from '@/ui/components/common';
import { FilterButton, PeriodChips } from '@/ui/components/pickers';
import { formatDate, formatDays, formatMoney, formatPercent, formatPercentAnnualized, formatShares } from '@/ui/format';
import { useClientFilter, useComputed, useContextOrNull, usePeriod } from '@/ui/hooks';
import { spacing } from '@/ui/theme';

type Mode = 'closed' | 'open' | 'all';

export default function TradesScreen() {
  const ctx = useContextOrNull();
  if (!ctx) return null;
  return <Trades />;
}

function Trades() {
  const ctx = useContextOrNull()!;
  const settings = useSettings();
  const filter = useClientFilter('trades', ctx);
  const period = usePeriod('trades', ctx);
  const [mode, setMode] = useState<Mode>('closed');
  const fifo = settings.costMethod === 'FIFO';
  const state = useComputed(
    () => ctx.cached(`trades:${filter.item.id}`, () => collectAllTrades(filter.client, ctx.converter, ctx.client.securities)),
    [ctx, filter.client],
  );
  const term = ctx.termCurrency;
  return (
    <Screen>
      <PeriodChips periods={period.periods} selected={period.period} onSelect={period.setPeriod} />
      <FilterButton items={filter.items} selected={filter.item} onSelect={filter.setFilter} />
      <Segmented
        items={[
          { key: 'closed', label: 'Abgeschlossen' },
          { key: 'open', label: 'Offen' },
          { key: 'all', label: 'Alle' },
        ]}
        selected={mode}
        onSelect={setMode}
      />
      <Pending state={state}>
        {({ trades, errors }) => {
          const inPeriod = (t: Trade) => (t.end === null ? true : period.interval.contains(toLocalDate(t.end)));
          const list = trades
            .filter((t) => (mode === 'closed' ? t.isClosed() : mode === 'open' ? !t.isClosed() : true))
            .filter(inPeriod)
            .sort((a, b) => (b.end ?? Number.MAX_SAFE_INTEGER) - (a.end ?? Number.MAX_SAFE_INTEGER) || b.start - a.start);
          const totals = new TradeTotals(list, ctx.converter);
          const pl = fifo ? totals.totalProfitLoss : totals.totalProfitLossMovingAverage;
          return (
            <>
              {errors.length > 0 ? <Notice kind="warning" text={errors.slice(0, 3).join('\n')} /> : null}
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
                  <Kpi label="Anzahl Trades" value={String(totals.tradeCount)} sub={`${totals.winningTradesCount} Gewinner · ${totals.losingTradesCount} Verlierer`} />
                  <Kpi label="Gewinn/Verlust" value={formatMoney(pl, term)} signed={pl.amount} />
                  <Kpi label="Trefferquote" value={formatPercent(totals.winRate)} />
                  <Kpi label="Ø Rendite" value={formatPercent(fifo ? totals.averageReturn : totals.getAverageReturnMovingAverage())} />
                  <Kpi label="Ø IZF" value={formatPercentAnnualized(totals.averageIRR)} />
                  <Kpi label="Ø Haltedauer" value={formatDays(totals.averageHoldingPeriod)} />
                </View>
              </Card>
              {list.length === 0 ? (
                <T secondary>Keine Trades.</T>
              ) : (
                <ListCard>
                  {list.slice(0, 400).map((t, i) => {
                    const profit = fifo ? t.getProfitLoss() : (t.getProfitLossMovingAverage() ?? t.getProfitLoss());
                    const ret = fifo ? t.getReturn() : t.getReturnMovingAverage();
                    return (
                      <Row
                        key={i}
                        title={t.security.name}
                        subtitle={`${formatDate(toLocalDate(t.start))} – ${t.end !== null ? formatDate(toLocalDate(t.end)) : 'offen'} · ${formatShares(t.shares)} Stk. · ${formatDays(t.holdingPeriod)}`}
                        value={formatMoney(profit, term)}
                        valueSigned={profit.amount}
                        detail={`${formatPercent(ret)} · IZF ${formatPercent(t.irr)}`}
                        detailSigned={ret}
                        onPress={() => router.push({ pathname: '/security/[id]', params: { id: t.security.uuid } })}
                      />
                    );
                  })}
                </ListCard>
              )}
            </>
          );
        }}
      </Pending>
    </Screen>
  );
}
