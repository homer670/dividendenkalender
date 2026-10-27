// PaymentsViewModel (name.abuchen.portfolio.ui.views.payments) - earnings per month

import {
  Account,
  AccountTransaction,
  AccountTransactionType,
  Client,
  compareByDate,
  InvestmentVehicle,
  isDebit,
  isLiquidation,
  Portfolio,
  PortfolioTransaction,
  Transaction,
  TransactionOwner,
} from '../model';
import { LocalDate, ofYMD, toYMD, today, year as yearOf } from '../util/dates';
import { Interval } from '../util/interval';
import { convertMoney, CurrencyConverter } from '../money/exchange';
import { collectAllTrades } from './trades';
import { CostMethod } from './securityPerformance';

export type PaymentsMode = 'DIVIDENDS' | 'INTEREST' | 'EARNINGS' | 'TAXES' | 'FEES' | 'TRADES' | 'ALL' | 'SAVING';

const MODE_TYPES: Record<PaymentsMode, AccountTransactionType[]> = {
  DIVIDENDS: ['DIVIDENDS'],
  INTEREST: ['INTEREST', 'INTEREST_CHARGE'],
  EARNINGS: ['DIVIDENDS', 'INTEREST', 'INTEREST_CHARGE'],
  TAXES: ['DIVIDENDS', 'INTEREST', 'INTEREST_CHARGE', 'TAXES', 'TAX_REFUND'],
  FEES: ['DIVIDENDS', 'INTEREST', 'INTEREST_CHARGE', 'FEES', 'FEES_REFUND'],
  TRADES: [],
  ALL: ['DIVIDENDS', 'INTEREST', 'INTEREST_CHARGE', 'TAXES', 'TAX_REFUND', 'FEES', 'FEES_REFUND'],
  SAVING: ['DEPOSIT', 'REMOVAL'],
};

export const PAYMENTS_MODE_LABELS: Record<PaymentsMode, string> = {
  DIVIDENDS: 'Dividenden',
  INTEREST: 'Zinsen',
  EARNINGS: 'Erträge',
  TAXES: 'Steuern',
  FEES: 'Gebühren',
  TRADES: 'Gewinn/Verlust aus Trades',
  ALL: '∑',
  SAVING: 'Sparen',
};

export class PaymentsLine {
  values: number[];
  numTransactions: number[];
  sum = 0;
  constructor(
    readonly vehicle: InvestmentVehicle | null,
    readonly consolidateRetired: boolean,
    length: number,
  ) {
    this.values = new Array(length).fill(0);
    this.numTransactions = new Array(length).fill(0);
  }
}

export interface PaymentsConfig {
  startYear: number;
  mode: PaymentsMode;
  useGrossValue: boolean;
  useConsolidateRetired: boolean;
  costMethod: CostMethod;
}

export interface PaymentsResult {
  startYear: number;
  noOfMonths: number;
  lines: PaymentsLine[];
  sum: PaymentsLine;
  sumRetired: PaymentsLine;
  transactions: { owner: TransactionOwner; transaction: Transaction }[];
}

/** PaymentsViewModel#calculate */
export function calculatePayments(
  client: Client,
  filteredClient: Client,
  converterIn: CurrencyConverter,
  config: PaymentsConfig,
): PaymentsResult {
  const converter = converterIn.with(client.baseCurrency);
  const { startYear, mode, useGrossValue, useConsolidateRetired, costMethod } = config;
  const now = today();
  const nowYMD = toYMD(now);
  if (startYear > nowYMD.year) throw new Error(`start year ${startYear} is after ${nowYMD.year}`);
  const noOfMonths = (nowYMD.year - startYear) * 12 + nowYMD.month;
  const interval = Interval.of(ofYMD(startYear - 1, 12, 31), now);
  const inInterval = (t: Transaction) => interval.contains(t.date);

  const transactions = new Map<Transaction, { owner: TransactionOwner; transaction: Transaction }>();
  const vehicle2line = new Map<InvestmentVehicle, PaymentsLine>();
  const sum = new PaymentsLine(null, false, noOfMonths);
  const sumRetired = new PaymentsLine(null, useConsolidateRetired, noOfMonths);
  const indexOf = (d: LocalDate) => {
    const ymd = toYMD(d);
    return (ymd.year - startYear) * 12 + ymd.month - 1;
  };
  const book = (vehicle: InvestmentVehicle, index: number, value: number, countTx: boolean) => {
    if (useConsolidateRetired && vehicle.isRetired) {
      sumRetired.values[index] += value;
      sumRetired.sum += value;
      if (countTx) sumRetired.numTransactions[index] += 1;
    } else {
      let line = vehicle2line.get(vehicle);
      if (!line) vehicle2line.set(vehicle, (line = new PaymentsLine(vehicle, false, noOfMonths)));
      line.values[index] += value;
      line.sum += value;
      if (countTx) line.numTransactions[index] += 1;
    }
    sum.values[index] += value;
    sum.sum += value;
    if (countTx) sum.numTransactions[index] += 1;
  };

  if (mode === 'TRADES' || mode === 'ALL') {
    const { trades } = collectAllTrades(filteredClient, converter, client.securities);
    for (const trade of trades) {
      const end = trade.getEnd();
      if (end === null || !interval.containsDateTime(end)) continue;
      const profitLoss = costMethod === 'FIFO' ? trade.getProfitLossWithoutTaxesAndFees() : trade.getProfitLossMovingAverageWithoutTaxesAndFees();
      if (profitLoss === null) continue;
      const value = profitLoss.amount;
      if (value !== 0) {
        book(trade.security, indexOf(Math.floor(end / 86400)), value, true);
        const closing = trade.getClosingTransaction();
        if (closing) transactions.set(closing.transaction, closing);
      }
    }
  }

  if (mode === 'SAVING' || mode === 'TAXES' || mode === 'FEES' || mode === 'ALL') {
    for (const portfolio of filteredClient.portfolios) {
      for (const transaction of portfolio.transactions) {
        if (!inInterval(transaction)) continue;
        let value = 0;
        if (mode === 'TAXES' || mode === 'ALL')
          value -= convertMoney(converter, transaction.date, transaction.getUnitSum('TAX')).amount;
        if (mode === 'FEES' || mode === 'ALL')
          value -= convertMoney(converter, transaction.date, transaction.getUnitSum('FEE')).amount;
        if (mode === 'SAVING') {
          if (transaction.type === 'DELIVERY_INBOUND' || transaction.type === 'DELIVERY_OUTBOUND')
            value = convertMoney(converter, transaction.date, transaction.getMonetaryAmount()).amount;
          if (isLiquidation(transaction.type)) value *= -1;
        }
        if (value !== 0) {
          const isClosedTrade = transactions.has(transaction);
          transactions.set(transaction, { owner: portfolio, transaction });
          book(transaction.security!, indexOf(transaction.date), value, mode !== 'ALL' || !isClosedTrade);
        }
      }
    }
  }

  const types = MODE_TYPES[mode];
  for (const account of filteredClient.accounts) {
    for (const transaction of account.transactions) {
      if (!types.includes(transaction.type)) continue;
      if (!inInterval(transaction)) continue;
      let value = 0;
      const conv = (m: { currencyCode: string; amount: number }) => convertMoney(converter, transaction.date, m).amount;
      switch (mode) {
        case 'TAXES':
          if (transaction.type === 'TAXES' || transaction.type === 'TAX_REFUND') {
            value = conv(transaction.getMonetaryAmount());
            if (isDebit(transaction.type)) value *= -1;
          } else value -= conv(transaction.getUnitSum('TAX'));
          break;
        case 'FEES':
          if (transaction.type === 'FEES' || transaction.type === 'FEES_REFUND') {
            value = conv(transaction.getMonetaryAmount());
            if (isDebit(transaction.type)) value *= -1;
          } else value -= conv(transaction.getUnitSum('FEE'));
          break;
        case 'TRADES':
          break;
        case 'ALL':
          value = conv(transaction.getMonetaryAmount());
          if (isDebit(transaction.type)) value *= -1;
          break;
        default:
          value = conv(useGrossValue ? transaction.getGrossValue() : transaction.getMonetaryAmount());
          if (isDebit(transaction.type)) value *= -1;
      }
      if (value !== 0) {
        transactions.set(transaction, { owner: account, transaction });
        const vehicle: InvestmentVehicle = transaction.security !== null ? transaction.security : account;
        book(vehicle, indexOf(transaction.date), value, true);
      }
    }
  }

  return {
    startYear,
    noOfMonths,
    lines: [...vehicle2line.values()],
    sum,
    sumRetired,
    transactions: [...transactions.values()].sort((a, b) => compareByDate(a.transaction, b.transaction)),
  };
}

/** default start year as in PP (the year of the first transaction, but at most 10 years) */
export function defaultStartYear(client: Client): number {
  let first: LocalDate | null = null;
  for (const a of client.accounts) for (const t of a.transactions) if (first === null || t.date < first) first = t.date;
  for (const p of client.portfolios) for (const t of p.transactions) if (first === null || t.date < first) first = t.date;
  const nowYear = yearOf(today());
  if (first === null) return nowYear;
  return Math.max(yearOf(first), nowYear - 10);
}

export type { Account, Portfolio, AccountTransaction, PortfolioTransaction };
