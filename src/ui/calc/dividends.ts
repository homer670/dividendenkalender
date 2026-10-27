// DividendListWidget logic: ex-dates and payment dates of dividend events

import { Client, Security, SecurityEvent } from '../../core/model';
import { CurrencyConverter } from '../../core/money/exchange';
import { ClientSnapshot, compareText } from '../../core/snapshot/clientSnapshot';
import { LocalDate, plusMonths } from '../../core/util/dates';

export type DateType = 'ALL_DATES' | 'EX_DIVIDEND_DATE' | 'PAYMENT_DATE';
export type SecurityFilter = 'ALL' | 'ACTIVE' | 'OWNED';
export type ShowEventsStarting = 'TODAY' | 'ONE_WEEK_AGO' | 'ONE_MONTH_AGO' | 'THREE_MONTHS_AGO';

export const DATE_TYPE_LABELS: Record<DateType, string> = {
  ALL_DATES: '◇◆ Alle',
  EX_DIVIDEND_DATE: '◇ Ex-Tag',
  PAYMENT_DATE: '◆ Zahltag',
};
export const SECURITY_FILTER_LABELS: Record<SecurityFilter, string> = {
  ALL: 'Alle Wertpapiere',
  ACTIVE: 'Aktive Wertpapiere',
  OWNED: 'Wertpapiere im Bestand',
};
export const SHOW_EVENTS_STARTING_LABELS: Record<ShowEventsStarting, string> = {
  TODAY: 'Heute',
  ONE_WEEK_AGO: 'vor 1 Woche',
  ONE_MONTH_AGO: 'vor 1 Monat',
  THREE_MONTHS_AGO: 'vor 3 Monaten',
};

export function startDate(s: ShowEventsStarting, now: LocalDate): LocalDate {
  switch (s) {
    case 'TODAY':
      return now;
    case 'ONE_WEEK_AGO':
      return now - 7;
    case 'ONE_MONTH_AGO':
      return plusMonths(now, -1);
    case 'THREE_MONTHS_AGO':
      return plusMonths(now, -3);
  }
}

export interface DividendItem {
  security: Security;
  date: LocalDate;
  event: SecurityEvent;
  types: Set<'EX_DIVIDEND_DATE' | 'PAYMENT_DATE'>;
  hasNewDate: boolean;
}

export function securitiesFor(filter: SecurityFilter, client: Client, filteredClient: Client, converter: CurrencyConverter, now: LocalDate): Security[] {
  switch (filter) {
    case 'ALL':
      return client.securities;
    case 'ACTIVE':
      return client.securities.filter((s) => !s.isRetired);
    case 'OWNED':
      return ClientSnapshot.create(filteredClient, converter, now)
        .getJointPortfolio()
        .positions.map((p) => p.getSecurity()!);
  }
}

export function dividendItems(securities: Security[], dateType: DateType, fromDate: LocalDate): DividendItem[] {
  const items: DividendItem[] = [];
  const create = (security: Security, event: SecurityEvent, typeToAdd: 'EX_DIVIDEND_DATE' | 'PAYMENT_DATE'): DividendItem | null => {
    if (dateType !== typeToAdd && dateType !== 'ALL_DATES') return null;
    const date = typeToAdd === 'EX_DIVIDEND_DATE' ? event.date : (event.paymentDate ?? null);
    if (date === null || date < fromDate) return null;
    return { security, date, event, types: new Set([typeToAdd]), hasNewDate: false };
  };
  for (const security of securities) {
    for (const event of security.events) {
      if (event.type !== 'DIVIDEND_PAYMENT') continue;
      const ex = create(security, event, 'EX_DIVIDEND_DATE');
      if (ex) items.push(ex);
      const pay = create(security, event, 'PAYMENT_DATE');
      if (pay) {
        if (ex && ex.date === pay.date) ex.types.add('PAYMENT_DATE');
        else items.push(pay);
      }
    }
  }
  items.sort((l, r) => l.date - r.date || compareText(l.security.name, r.security.name));
  let previous: LocalDate | null = null;
  for (const item of items) {
    if (previous === null || item.date !== previous) {
      item.hasNewDate = true;
      previous = item.date;
    }
  }
  return items;
}

export function indicator(item: DividendItem): string {
  return `${item.types.has('EX_DIVIDEND_DATE') ? '◇' : ''}${item.types.has('PAYMENT_DATE') ? '◆' : ''}`;
}
