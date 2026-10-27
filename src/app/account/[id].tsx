import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { View } from 'react-native';

import { Account, AccountTransaction, compareByDate, isDebit } from '@/core/model';
import { money } from '@/core/money/money';
import { today } from '@/core/util/dates';
import { AccountSnapshot } from '@/core/snapshot/clientSnapshot';
import { Card, EmptyState, ListCard, Row, Screen, T } from '@/ui/components/basic';
import { Pending } from '@/ui/components/common';
import { PeriodChips } from '@/ui/components/pickers';
import { ACCOUNT_TYPE_LABELS } from '@/ui/components/transactions';
import { LineChart } from '@/ui/charts/LineChart';
import { formatAxis, formatDate, formatMoney } from '@/ui/format';
import { useComputed, useContextOrNull, usePeriod } from '@/ui/hooks';
import { spacing } from '@/ui/theme';
import { COLOR_TEXT } from '@/state/dataSeries';

export default function AccountScreen() {
  const ctx = useContextOrNull();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!ctx) return null;
  const account = ctx.client.accounts.find((a) => a.uuid === id);
  if (!account)
    return (
      <Screen>
        <EmptyState title="Konto nicht gefunden" />
      </Screen>
    );
  return <AccountDetail account={account} />;
}

function AccountDetail({ account }: { account: Account }) {
  const ctx = useContextOrNull()!;
  const period = usePeriod('account', ctx);
  const now = today();
  const balance = AccountSnapshot.create(account, ctx.converter, now).getUnconvertedFunds();
  const rows = useMemo(() => {
    const sorted = account.transactions.slice().sort(compareByDate);
    let running = 0;
    const out: { t: AccountTransaction; balance: number }[] = [];
    for (const t of sorted) {
      running += isDebit(t.type) ? -t.amount : t.amount;
      out.push({ t, balance: running });
    }
    return out.reverse();
  }, [account]);
  const chart = useComputed(() => {
    const series = ctx.dataSeriesSet('STATEMENT_OF_ASSETS').availableSeries.find((s) => s.type === 'ACCOUNT' && s.instance === account);
    if (!series) return null;
    return ctx.calculate(series, period.interval);
  }, [ctx, account, period.interval.start, period.interval.end]);
  const cur = account.currencyCode;

  return (
    <>
      <Stack.Screen options={{ title: account.name }} />
      <Screen>
        <Card style={{ gap: 4 }}>
          <T variant="caption" secondary>
            Saldo am {formatDate(now)}
          </T>
          <T variant="kpi" signed={balance.amount < 0 ? -1 : undefined}>
            {formatMoney(balance)}
          </T>
          {account.isRetired ? (
            <T variant="caption" secondary>
              Inaktives Konto
            </T>
          ) : null}
        </Card>
        <PeriodChips periods={period.periods} selected={period.period} onSelect={period.setPeriod} />
        <Card>
          <Pending state={chart}>
            {(index) =>
              index ? (
                <LineChart
                  series={[{ key: 'b', label: account.name, color: COLOR_TEXT, area: true, dates: index.dates, values: index.totals.map((v) => v / 100) }]}
                  formatValue={(v) => formatMoney(money(ctx.termCurrency, Math.round(v * 100)))}
                  formatAxis={formatAxis}
                />
              ) : (
                <T secondary>Keine Daten</T>
              )
            }
          </Pending>
        </Card>
        {rows.length === 0 ? (
          <Card>
            <EmptyState icon="wallet-outline" title="Keine Buchungen" />
          </Card>
        ) : (
          <ListCard header={`Buchungen (${rows.length})`}>
            {rows.slice(0, 500).map(({ t, balance: b }) => {
              const sign = isDebit(t.type) ? -1 : 1;
              const cross = t.crossEntry ? t.crossEntry.getCrossOwner(t) : null;
              return (
                <Row
                  key={t.uuid}
                  title={t.security ? t.security.name : ACCOUNT_TYPE_LABELS[t.type]}
                  subtitle={[formatDate(t.date), t.security ? ACCOUNT_TYPE_LABELS[t.type] : null, cross ? cross.name : null, t.note]
                    .filter(Boolean)
                    .join(' · ')}
                  value={formatMoney(money(cur, sign * t.amount), cur)}
                  valueSigned={sign * t.amount}
                  detail={`Saldo ${formatMoney(money(cur, b), cur)}`}
                  onPress={t.security ? () => router.push({ pathname: '/security/[id]', params: { id: t.security!.uuid } }) : undefined}
                  chevron={false}
                />
              );
            })}
          </ListCard>
        )}
        <View style={{ height: spacing.s }} />
      </Screen>
    </>
  );
}
