import { router } from 'expo-router';
import React, { useMemo } from 'react';

import { AccountSnapshot, compareText } from '@/core/snapshot/clientSnapshot';
import { today } from '@/core/util/dates';
import { money } from '@/core/money/money';
import { Card, KeyValue, ListCard, Row, Screen } from '@/ui/components/basic';
import { formatMoney } from '@/ui/format';
import { useContextOrNull } from '@/ui/hooks';

export default function AccountsScreen() {
  const ctx = useContextOrNull();
  const rows = useMemo(() => {
    if (!ctx) return [];
    const now = today();
    return ctx.client.accounts
      .slice()
      .sort((a, b) => Number(a.isRetired) - Number(b.isRetired) || compareText(a.name, b.name))
      .map((a) => ({ account: a, snapshot: AccountSnapshot.create(a, ctx.converter, now) }));
  }, [ctx]);
  if (!ctx) return null;
  const total = rows.reduce((s, r) => s + r.snapshot.getFunds().amount, 0);
  const term = ctx.termCurrency;
  return (
    <Screen>
      <Card>
        <KeyValue label="Summe aller Konten" value={formatMoney(money(term, total))} />
      </Card>
      <ListCard>
        {rows.map(({ account, snapshot }) => (
          <Row
            key={account.uuid}
            title={account.name}
            subtitle={`${account.currencyCode}${account.isRetired ? ' · inaktiv' : ''} · ${account.transactions.length} Buchungen`}
            value={formatMoney(snapshot.getUnconvertedFunds())}
            valueSigned={snapshot.getUnconvertedFunds().amount < 0 ? -1 : undefined}
            detail={account.currencyCode !== term ? formatMoney(snapshot.getFunds()) : undefined}
            onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.uuid } })}
          />
        ))}
      </ListCard>
    </Screen>
  );
}
