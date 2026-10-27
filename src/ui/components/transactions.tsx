// Transaction lists (Buchungen)

import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import {
  AccountTransaction,
  AccountTransactionType,
  Client,
  compareByDate,
  isDebit,
  PortfolioTransaction,
  PortfolioTransactionType,
  Transaction,
  TransactionOwner,
} from '../../core/model';
import { toYMD, yearMonthKey } from '../../core/util/dates';
import { formatDate, formatMoney, formatShares, monthName } from '../format';
import { Row, T } from './basic';

export const ACCOUNT_TYPE_LABELS: Record<AccountTransactionType, string> = {
  DEPOSIT: 'Einlage',
  REMOVAL: 'Entnahme',
  INTEREST: 'Zinsen',
  INTEREST_CHARGE: 'Zinsbelastung',
  DIVIDENDS: 'Dividende',
  FEES: 'Gebühren',
  FEES_REFUND: 'Gebührenerstattung',
  TAXES: 'Steuern',
  TAX_REFUND: 'Steuerrückerstattung',
  BUY: 'Kauf',
  SELL: 'Verkauf',
  TRANSFER_IN: 'Umbuchung (Eingang)',
  TRANSFER_OUT: 'Umbuchung (Ausgang)',
};

export const PORTFOLIO_TYPE_LABELS: Record<PortfolioTransactionType, string> = {
  BUY: 'Kauf',
  SELL: 'Verkauf',
  TRANSFER_IN: 'Umbuchung (Eingang)',
  TRANSFER_OUT: 'Umbuchung (Ausgang)',
  DELIVERY_INBOUND: 'Einlieferung',
  DELIVERY_OUTBOUND: 'Auslieferung',
};

export interface TxEntry {
  owner: TransactionOwner;
  transaction: Transaction;
}

export type TxCategory = 'all' | 'trades' | 'dividends' | 'interest' | 'cash' | 'costs' | 'transfers';

export const TX_CATEGORIES: { key: TxCategory; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'trades', label: 'Käufe & Verkäufe' },
  { key: 'dividends', label: 'Dividenden' },
  { key: 'interest', label: 'Zinsen' },
  { key: 'cash', label: 'Einlagen & Entnahmen' },
  { key: 'costs', label: 'Gebühren & Steuern' },
  { key: 'transfers', label: 'Umbuchungen' },
];

export function txCategory(t: Transaction): TxCategory {
  const type = (t as AccountTransaction | PortfolioTransaction).type;
  switch (type) {
    case 'BUY':
    case 'SELL':
    case 'DELIVERY_INBOUND':
    case 'DELIVERY_OUTBOUND':
      return 'trades';
    case 'DIVIDENDS':
      return 'dividends';
    case 'INTEREST':
    case 'INTEREST_CHARGE':
      return 'interest';
    case 'DEPOSIT':
    case 'REMOVAL':
      return 'cash';
    case 'FEES':
    case 'FEES_REFUND':
    case 'TAXES':
    case 'TAX_REFUND':
      return 'costs';
    default:
      return 'transfers';
  }
}

export function txLabel(entry: TxEntry): string {
  const t = entry.transaction;
  return t instanceof AccountTransaction ? ACCOUNT_TYPE_LABELS[t.type] : PORTFOLIO_TYPE_LABELS[(t as PortfolioTransaction).type];
}

/** sign of the transaction from the perspective of the owner (+1 inflow, -1 outflow, 0 neutral) */
export function txSign(t: Transaction): number {
  if (t instanceof AccountTransaction) return isDebit(t.type) ? -1 : 1;
  return 0;
}

/**
 * All transactions without duplicates: buy/sell are shown once (portfolio side), transfers once (outbound side).
 */
export function collectTransactions(client: Client): TxEntry[] {
  const out: TxEntry[] = [];
  for (const a of client.accounts)
    for (const t of a.transactions) {
      if ((t.type === 'BUY' || t.type === 'SELL') && t.crossEntry) continue;
      if (t.type === 'TRANSFER_IN' && t.crossEntry) continue;
      out.push({ owner: a, transaction: t });
    }
  for (const p of client.portfolios)
    for (const t of p.transactions) {
      if (t.type === 'TRANSFER_IN' && t.crossEntry) continue;
      out.push({ owner: p, transaction: t });
    }
  out.sort((x, y) => compareByDate(y.transaction, x.transaction));
  return out;
}

export function ownerLine(entry: TxEntry): string {
  const t = entry.transaction;
  if (t.crossEntry) {
    const cross = t.crossEntry.getCrossOwner(t);
    if (t.crossEntry.kind === 'buysell') return `${entry.owner.name} · ${cross.name}`;
    return `${entry.owner.name} → ${cross.name}`;
  }
  return entry.owner.name;
}

export function TransactionRow({ entry, showOwner = true }: { entry: TxEntry; showOwner?: boolean }) {
  const t = entry.transaction;
  const sign = txSign(t);
  const title = t.security ? t.security.name : txLabel(entry);
  const parts = [formatDate(t.date), t.security ? txLabel(entry) : null, t.shares !== 0 ? `${formatShares(t.shares)} Stk.` : null];
  if (showOwner) parts.push(ownerLine(entry));
  const amount = sign < 0 ? -t.amount : t.amount;
  return (
    <Row
      title={title}
      subtitle={parts.filter(Boolean).join(' · ')}
      value={formatMoney({ currencyCode: t.currencyCode, amount })}
      valueSigned={sign === 0 ? undefined : amount}
      detail={t.note ? t.note : undefined}
      onPress={t.security ? () => router.push({ pathname: '/security/[id]', params: { id: t.security!.uuid } }) : undefined}
      chevron={false}
    />
  );
}

export function MonthHeader({ title }: { title: string }) {
  return (
    <View style={{ paddingHorizontal: 4, paddingTop: 12, paddingBottom: 4 }}>
      <T variant="label" secondary>
        {title}
      </T>
    </View>
  );
}

function monthTitle(d: number): string {
  const { year, month } = toYMD(d);
  return `${monthName(month)} ${year}`;
}

export function groupByMonth(entries: TxEntry[]): { key: number; title: string; data: TxEntry[] }[] {
  const out: { key: number; title: string; data: TxEntry[] }[] = [];
  for (const e of entries) {
    const k = yearMonthKey(e.transaction.date);
    let last = out[out.length - 1];
    if (!last || last.key !== k) {
      last = { key: k, title: monthTitle(e.transaction.date), data: [] };
      out.push(last);
    }
    last.data.push(e);
  }
  return out;
}
