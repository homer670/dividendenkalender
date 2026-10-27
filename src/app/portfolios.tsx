import { router } from 'expo-router';
import React, { useMemo } from 'react';

import { compareText, PortfolioSnapshot } from '@/core/snapshot/clientSnapshot';
import { today } from '@/core/util/dates';
import { ListCard, Row, Screen } from '@/ui/components/basic';
import { formatMoney } from '@/ui/format';
import { useContextOrNull } from '@/ui/hooks';

export default function PortfoliosScreen() {
  const ctx = useContextOrNull();
  const rows = useMemo(() => {
    if (!ctx) return [];
    const now = today();
    return ctx.client.portfolios
      .slice()
      .sort((a, b) => Number(a.isRetired) - Number(b.isRetired) || compareText(a.name, b.name))
      .map((p) => ({ portfolio: p, snapshot: PortfolioSnapshot.create(p, ctx.converter, now) }));
  }, [ctx]);
  if (!ctx) return null;
  return (
    <Screen>
      <ListCard>
        {rows.map(({ portfolio, snapshot }) => (
          <Row
            key={portfolio.uuid}
            title={portfolio.name}
            subtitle={`${snapshot.positions.length} Positionen${portfolio.isRetired ? ' · inaktiv' : ''}${
              portfolio.referenceAccount ? ` · ${portfolio.referenceAccount.name}` : ''
            }`}
            value={formatMoney(snapshot.getValue())}
            onPress={() => router.push({ pathname: '/portfolio/[id]', params: { id: portfolio.uuid } })}
          />
        ))}
      </ListCard>
    </Screen>
  );
}
