import React from 'react';

import { money } from '@/core/money/money';
import { toLocalDate } from '@/core/util/dates';
import { Card, EmptyState, ListCard, Row, Screen } from '@/ui/components/basic';
import { formatDate, formatMoney } from '@/ui/format';
import { useContextOrNull } from '@/ui/hooks';

const TYPE_LABELS: Record<string, string> = {
  PURCHASE_OR_DELIVERY: 'Kauf / Einlieferung',
  DEPOSIT: 'Einlage',
  REMOVAL: 'Entnahme',
  INTEREST: 'Zinsen',
};

function intervalLabel(interval: number): string {
  if (interval > 100) return interval - 100 === 1 ? 'wöchentlich' : `alle ${interval - 100} Wochen`;
  if (interval === 1) return 'monatlich';
  if (interval === 3) return 'quartalsweise';
  if (interval === 6) return 'halbjährlich';
  if (interval === 12) return 'jährlich';
  return `alle ${interval} Monate`;
}

export default function PlansScreen() {
  const ctx = useContextOrNull();
  if (!ctx) return null;
  const plans = ctx.client.plans;
  if (plans.length === 0)
    return (
      <Screen>
        <Card>
          <EmptyState icon="repeat-outline" title="Keine Sparpläne" />
        </Card>
      </Screen>
    );
  return (
    <Screen>
      <ListCard>
        {plans.map((plan, i) => {
          const currency = plan.account?.currencyCode ?? plan.security?.currencyCode ?? ctx.client.baseCurrency;
          const last = plan.transactions.length > 0 ? Math.max(...plan.transactions.map((t) => t.date)) : null;
          return (
            <Row
              key={i}
              title={plan.name}
              subtitle={[
                TYPE_LABELS[plan.type] ?? plan.type,
                plan.security?.name ?? plan.account?.name,
                intervalLabel(plan.interval),
                `ab ${formatDate(toLocalDate(plan.start))}`,
                last !== null ? `zuletzt ${formatDate(last)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              value={formatMoney(money(currency, plan.amount))}
              detail={`${plan.transactions.length} Ausführungen`}
            />
          );
        })}
      </ListCard>
    </Screen>
  );
}
