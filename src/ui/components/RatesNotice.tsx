// Warning if foreign currencies are used but no exchange rates of the ECB are available

import React from 'react';

import { usePortfolio } from '../../state/portfolio';
import { useContextOrNull } from '../hooks';
import { Notice } from './basic';

export function RatesNotice() {
  const ctx = useContextOrNull();
  const ecb = usePortfolio((s) => s.ecb.length);
  const error = usePortfolio((s) => s.ratesError);
  if (!ctx || ecb > 0) return null;
  const base = ctx.client.baseCurrency;
  const needsRates =
    ctx.client.securities.some((s) => s.currencyCode && s.currencyCode !== base) || ctx.client.accounts.some((a) => a.currencyCode !== base);
  if (!needsRates) return null;
  return (
    <Notice
      kind="warning"
      text={`Wechselkurse der EZB fehlen${error ? ` (${error})` : ''}. Fremdwährungen werden bis zum Download mit Kurs 1 umgerechnet – die Werte sind noch nicht korrekt.`}
    />
  );
}
