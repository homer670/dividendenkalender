// List of securities with latest price and change

import { router } from 'expo-router';
import React from 'react';

import { Security } from '../../core/model';
import { compareText } from '../../core/snapshot/clientSnapshot';
import { today } from '../../core/util/dates';
import { formatDate, formatPercentWithSign, formatQuote } from '../format';
import { ListCard, Row } from './basic';

export function SecurityRow({ security }: { security: Security }) {
  const now = today();
  const price = security.getSecurityPrice(now);
  const two = security.getLatestTwoSecurityPrices(now);
  const change = two && two[1].value !== 0 ? two[0].value / two[1].value - 1 : null;
  return (
    <Row
      title={security.name}
      subtitle={[security.isin ?? security.tickerSymbol ?? security.wkn, price.value ? formatDate(price.date) : null].filter(Boolean).join(' · ')}
      value={price.value ? formatQuote(price.value, security.currencyCode) : '–'}
      detail={change !== null ? formatPercentWithSign(change) : undefined}
      detailSigned={change}
      onPress={() => router.push({ pathname: '/security/[id]', params: { id: security.uuid } })}
    />
  );
}

export function SecurityList({ securities, header }: { securities: Security[]; header?: string }) {
  const sorted = securities.slice().sort((a, b) => compareText(a.name, b.name));
  return (
    <ListCard header={header}>
      {sorted.map((s) => (
        <SecurityRow key={s.uuid} security={s} />
      ))}
    </ListCard>
  );
}
