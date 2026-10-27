// ClientPerformanceSnapshot and ClientIRRYield

import {
  AccountTransaction,
  Client,
  compareByDate,
  PortfolioTransaction,
  Security,
  Transaction,
  TransactionOwner,
} from '../model';
import { Money, money, MutableMoney, Values } from '../money/money';
import { convertMoney, CurrencyConverter } from '../money/exchange';
import { Interval } from '../util/interval';
import { LocalDate } from '../util/dates';
import { ClientSnapshot, compareText } from './clientSnapshot';
import { calculateIRR } from '../math/irr';
import { CapitalGainsRecord, CostMethod, SecurityPerformanceRecord, SecurityPerformanceSnapshot, unitSumConverted } from './securityPerformance';
import { PerformanceIndex } from './performanceIndex';
import { formatDateDE } from './reportingPeriod';

export type CategoryType =
  | 'INITIAL_VALUE'
  | 'CAPITAL_GAINS'
  | 'REALIZED_CAPITAL_GAINS'
  | 'EARNINGS'
  | 'FEES'
  | 'TAXES'
  | 'CURRENCY_GAINS'
  | 'TRANSFERS'
  | 'FINAL_VALUE';

export const CATEGORY_TYPES: CategoryType[] = [
  'INITIAL_VALUE',
  'CAPITAL_GAINS',
  'REALIZED_CAPITAL_GAINS',
  'EARNINGS',
  'FEES',
  'TAXES',
  'CURRENCY_GAINS',
  'TRANSFERS',
  'FINAL_VALUE',
];

export interface PerformancePosition {
  label: string;
  security: Security | null;
  value: Money;
  forexGain: Money | null;
}

export interface PerformanceCategory {
  type: CategoryType;
  label: string;
  sign: string;
  valuation: Money;
  positions: PerformancePosition[];
}

export interface TransactionPair {
  owner: TransactionOwner;
  transaction: Transaction;
}

export class ClientIRRYield {
  static create(client: Client, snapshotStart: ClientSnapshot, snapshotEnd: ClientSnapshot): number {
    const interval = Interval.of(snapshotStart.date, snapshotEnd.date);
    const transactions: Transaction[] = [];
    for (const account of client.accounts)
      for (const t of account.transactions) {
        if (!interval.contains(t.date)) continue;
        if (t.type === 'DEPOSIT' || t.type === 'REMOVAL' || t.type === 'TRANSFER_IN' || t.type === 'TRANSFER_OUT')
          transactions.push(t);
      }
    for (const portfolio of client.portfolios)
      for (const t of portfolio.transactions) {
        if (!interval.contains(t.date)) continue;
        if (t.type === 'TRANSFER_IN' || t.type === 'TRANSFER_OUT' || t.type === 'DELIVERY_INBOUND' || t.type === 'DELIVERY_OUTBOUND')
          transactions.push(t);
      }
    transactions.sort(compareByDate);

    const dates: LocalDate[] = [];
    const values: number[] = [];
    const converter = snapshotStart.converter;
    if (snapshotStart.getMonetaryAssets().amount !== 0) {
      dates.push(interval.start);
      values.push(-snapshotStart.getMonetaryAssets().amount / Values.Amount.divider);
    }
    for (const t of transactions) {
      dates.push(t.date);
      let amount = convertMoney(converter, t.date, t.getMonetaryAmount()).amount;
      if (t instanceof AccountTransaction) {
        if (t.type === 'DEPOSIT' || t.type === 'TRANSFER_IN') amount = -amount;
      } else if (t instanceof PortfolioTransaction) {
        if (t.type === 'DELIVERY_INBOUND' || t.type === 'TRANSFER_IN') amount = -amount;
      }
      values.push(amount / Values.Amount.divider);
    }
    if (snapshotEnd.getMonetaryAssets().amount !== 0) {
      dates.push(interval.end);
      values.push(snapshotEnd.getMonetaryAssets().amount / Values.Amount.divider);
    }
    return values.length > 0 ? calculateIRR(dates, values) : 0;
  }
}

export class ClientPerformanceSnapshot {
  readonly snapshotStart: ClientSnapshot;
  readonly snapshotEnd: ClientSnapshot;
  private readonly categories = new Map<CategoryType, PerformanceCategory>();
  readonly earnings: TransactionPair[] = [];
  readonly fees: TransactionPair[] = [];
  readonly taxes: TransactionPair[] = [];
  private irr = 0;
  securityPerformance: SecurityPerformanceSnapshot | null = null;

  constructor(
    readonly client: Client,
    readonly converter: CurrencyConverter,
    readonly period: Interval,
    readonly useFifo = true,
  ) {
    this.snapshotStart = ClientSnapshot.create(client, converter, period.start);
    this.snapshotEnd = ClientSnapshot.create(client, converter, period.end);
    this.calculate();
  }

  getCategories(): PerformanceCategory[] {
    return CATEGORY_TYPES.map((t) => this.categories.get(t)!);
  }

  getCategoryByType(type: CategoryType): PerformanceCategory {
    return this.categories.get(type)!;
  }

  getValue(...types: CategoryType[]): Money {
    let sum = 0;
    for (const t of types) sum += this.categories.get(t)!.valuation.amount;
    return money(this.converter.termCurrency, sum);
  }

  getPerformanceIRR(): number {
    return this.irr;
  }

  getAbsoluteDelta(): Money {
    const delta = MutableMoney.of(this.converter.termCurrency);
    for (const t of CATEGORY_TYPES) {
      const c = this.categories.get(t)!;
      switch (t) {
        case 'CAPITAL_GAINS':
        case 'REALIZED_CAPITAL_GAINS':
        case 'EARNINGS':
        case 'CURRENCY_GAINS':
          delta.add(c.valuation);
          break;
        case 'FEES':
        case 'TAXES':
          delta.subtract(c.valuation);
          break;
        default:
          break;
      }
    }
    return delta.toMoney();
  }

  getPortfolioTaxRate(): number {
    const numerator = this.getValue('TAXES').amount;
    const denominator = this.getValue('CAPITAL_GAINS', 'REALIZED_CAPITAL_GAINS', 'EARNINGS').amount - this.getValue('FEES').amount;
    if (denominator === 0) return Number.POSITIVE_INFINITY;
    if (numerator < 0 || denominator < 0) return NaN;
    return numerator / denominator;
  }

  getPortfolioFeeRate(): number {
    const numerator = this.getValue('FEES').amount;
    const denominator = this.getValue('CAPITAL_GAINS', 'REALIZED_CAPITAL_GAINS', 'EARNINGS').amount;
    if (denominator === 0) return Number.POSITIVE_INFINITY;
    if (numerator < 0 || denominator < 0) return NaN;
    return numerator / denominator;
  }

  private calculate(): void {
    const term = this.converter.termCurrency;
    const zero = money(term, 0);
    const put = (type: CategoryType, label: string, sign: string, valuation: Money) =>
      this.categories.set(type, { type, label, sign, valuation, positions: [] });
    put('INITIAL_VALUE', `Anfangswert (${formatDateDE(this.snapshotStart.date)})`, '', this.snapshotStart.getMonetaryAssets());
    put('CAPITAL_GAINS', 'Kurserfolge', '+', zero);
    put('REALIZED_CAPITAL_GAINS', 'Realisierte Kurserfolge', '+', zero);
    put('EARNINGS', 'Erträge', '+', zero);
    put('FEES', 'Gebühren', '-', zero);
    put('TAXES', 'Steuern', '-', zero);
    put('CURRENCY_GAINS', 'Cash Fremdwährungsgewinne', '+', zero);
    put('TRANSFERS', 'Performanceneutrale Bewegungen', '+', zero);
    put('FINAL_VALUE', `Endwert (${formatDateDE(this.snapshotEnd.date)})`, '=', this.snapshotEnd.getMonetaryAssets());

    this.irr = ClientIRRYield.create(this.client, this.snapshotStart, this.snapshotEnd);

    const securityPerformance = SecurityPerformanceSnapshot.create(
      this.client,
      this.converter,
      this.period,
      this.snapshotStart,
      this.snapshotEnd,
    );
    this.securityPerformance = securityPerformance;
    const method: CostMethod = this.useFifo ? 'FIFO' : 'MOVING_AVERAGE';
    this.addCapitalGains(this.categories.get('REALIZED_CAPITAL_GAINS')!, securityPerformance, (r) => r.getRealizedCapitalGains(method));
    this.addCapitalGains(this.categories.get('CAPITAL_GAINS')!, securityPerformance, (r) => r.getUnrealizedCapitalGains(method));
    this.addEarnings();
    this.addCurrencyGains();
  }

  private addCapitalGains(
    category: PerformanceCategory,
    securityPerformance: SecurityPerformanceSnapshot,
    mapper: (r: SecurityPerformanceRecord) => CapitalGainsRecord,
  ): void {
    category.positions = securityPerformance.records
      .slice()
      .sort((p1, p2) => compareText(p1.securityName, p2.securityName))
      .map(mapper)
      .filter((g) => g.capitalGains.amount !== 0 || g.forexCapitalGains.amount !== 0)
      .map((g) => ({ label: g.security.name, security: g.security, value: g.capitalGains, forexGain: g.forexCapitalGains }));
    let sum = 0;
    for (const p of category.positions) sum += p.value.amount;
    category.valuation = money(this.converter.termCurrency, sum);
  }

  private addEarnings(): void {
    const term = this.converter.termCurrency;
    const mEarnings = MutableMoney.of(term);
    const mFees = MutableMoney.of(term);
    const mTaxes = MutableMoney.of(term);
    const mDeposits = MutableMoney.of(term);
    const mRemovals = MutableMoney.of(term);
    const earningsBySecurity = new Map<Security | null, MutableMoney>();
    const feesBySecurity = new Map<Security | null, MutableMoney>();
    const taxesBySecurity = new Map<Security | null, MutableMoney>();
    const bucket = (map: Map<Security | null, MutableMoney>, s: Security | null) => {
      let m = map.get(s);
      if (!m) map.set(s, (m = MutableMoney.of(term)));
      return m;
    };
    const conv = (m: Money, d: LocalDate) => convertMoney(this.converter, d, m);

    for (const account of this.client.accounts) {
      for (const t of account.transactions) {
        if (!this.period.contains(t.date)) continue;
        const value = conv(t.getMonetaryAmount(), t.date);
        switch (t.type) {
          case 'DIVIDENDS':
          case 'INTEREST': {
            const earned = conv(t.getGrossValue(), t.date);
            mEarnings.add(earned);
            this.earnings.push({ owner: account, transaction: t });
            bucket(earningsBySecurity, t.security).add(earned);
            const fee = conv(unitSumConverted(t, 'FEE', this.converter), t.date);
            if (fee.amount !== 0) {
              mFees.add(fee);
              this.fees.push({ owner: account, transaction: t });
              bucket(feesBySecurity, t.security).add(fee);
            }
            const tax = conv(unitSumConverted(t, 'TAX', this.converter), t.date);
            if (tax.amount !== 0) {
              mTaxes.add(tax);
              this.taxes.push({ owner: account, transaction: t });
              bucket(taxesBySecurity, t.security).add(tax);
            }
            break;
          }
          case 'INTEREST_CHARGE':
            mEarnings.subtract(value);
            this.earnings.push({ owner: account, transaction: t });
            bucket(earningsBySecurity, null).subtract(value);
            break;
          case 'DEPOSIT':
            mDeposits.add(value);
            break;
          case 'REMOVAL':
            mRemovals.add(value);
            break;
          case 'FEES':
            mFees.add(value);
            this.fees.push({ owner: account, transaction: t });
            bucket(feesBySecurity, t.security).add(value);
            break;
          case 'FEES_REFUND':
            mFees.subtract(value);
            this.fees.push({ owner: account, transaction: t });
            bucket(feesBySecurity, t.security).subtract(value);
            break;
          case 'TAXES':
            mTaxes.add(value);
            this.taxes.push({ owner: account, transaction: t });
            bucket(taxesBySecurity, t.security).add(value);
            break;
          case 'TAX_REFUND':
            mTaxes.subtract(value);
            this.taxes.push({ owner: account, transaction: t });
            bucket(taxesBySecurity, t.security).subtract(value);
            break;
          default:
            break;
        }
      }
    }

    for (const portfolio of this.client.portfolios) {
      for (const t of portfolio.transactions) {
        if (!this.period.contains(t.date)) continue;
        let unit = unitSumConverted(t, 'FEE', this.converter);
        if (unit.amount !== 0) {
          mFees.add(unit);
          this.fees.push({ owner: portfolio, transaction: t });
          bucket(feesBySecurity, t.security).add(unit);
        }
        unit = unitSumConverted(t, 'TAX', this.converter);
        if (unit.amount !== 0) {
          mTaxes.add(unit);
          this.taxes.push({ owner: portfolio, transaction: t });
          bucket(taxesBySecurity, t.security).add(unit);
        }
        if (t.type === 'DELIVERY_INBOUND') mDeposits.add(conv(t.getMonetaryAmount(), t.date));
        else if (t.type === 'DELIVERY_OUTBOUND') mRemovals.add(conv(t.getMonetaryAmount(), t.date));
      }
    }

    const asPositions = (map: Map<Security | null, MutableMoney>, otherLabel: string): PerformancePosition[] =>
      [...map.entries()]
        .filter(([, v]) => !v.isZero())
        .map(([s, v]) => ({ label: s === null ? otherLabel : s.name, security: s, value: v.toMoney(), forexGain: null }))
        .sort((p1, p2) => {
          if (p1.security === null) return p2.security === null ? 0 : 1;
          if (p2.security === null) return -1;
          return compareText(p1.label, p2.label);
        });

    const earnings = this.categories.get('EARNINGS')!;
    earnings.valuation = mEarnings.toMoney();
    earnings.positions = asPositions(earningsBySecurity, 'Zinsen');
    const fees = this.categories.get('FEES')!;
    fees.valuation = mFees.toMoney();
    fees.positions = asPositions(feesBySecurity, 'Sonstige');
    const taxes = this.categories.get('TAXES')!;
    taxes.valuation = mTaxes.toMoney();
    taxes.positions = asPositions(taxesBySecurity, 'Sonstige');
    const transfers = this.categories.get('TRANSFERS')!;
    transfers.valuation = money(term, mDeposits.amount - mRemovals.amount);
    transfers.positions.push({ label: 'Einlagen / Einlieferungen', security: null, value: mDeposits.toMoney(), forexGain: null });
    transfers.positions.push({ label: 'Entnahmen / Auslieferungen', security: null, value: mRemovals.toMoney(), forexGain: null });
  }

  private addCurrencyGains(): void {
    const term = this.converter.termCurrency;
    const currency2money = new Map<string, MutableMoney>();
    const get = (c: string) => {
      let m = currency2money.get(c);
      if (!m) currency2money.set(c, (m = MutableMoney.of(term)));
      return m;
    };
    const conv = (m: Money, d: LocalDate) => convertMoney(this.converter, d, m);
    for (const snapshot of this.snapshotStart.accounts) {
      if (term === snapshot.account.currencyCode) continue;
      const value = get(snapshot.account.currencyCode);
      value.subtract(snapshot.getFunds());
      for (const t of snapshot.account.transactions) {
        if (!this.period.contains(t.date)) continue;
        switch (t.type) {
          case 'DIVIDENDS':
          case 'INTEREST':
          case 'DEPOSIT':
          case 'TAX_REFUND':
          case 'SELL':
          case 'FEES_REFUND':
            value.subtract(conv(t.getMonetaryAmount(), t.date));
            break;
          case 'REMOVAL':
          case 'FEES':
          case 'INTEREST_CHARGE':
          case 'TAXES':
          case 'BUY':
            value.add(conv(t.getMonetaryAmount(), t.date));
            break;
          case 'TRANSFER_IN':
            value.subtract(this.determineTransferAmount(t));
            break;
          case 'TRANSFER_OUT':
            value.add(this.determineTransferAmount(t));
            break;
        }
      }
    }
    for (const snapshot of this.snapshotEnd.accounts) {
      if (term === snapshot.account.currencyCode) continue;
      get(snapshot.account.currencyCode).add(snapshot.getFunds());
    }
    const currencyGains = this.categories.get('CURRENCY_GAINS')!;
    for (const [currency, m] of currency2money) {
      currencyGains.valuation = money(term, currencyGains.valuation.amount + m.amount);
      currencyGains.positions.push({ label: currency, security: null, value: m.toMoney(), forexGain: null });
    }
    currencyGains.positions.sort((p1, p2) => (p1.label < p2.label ? -1 : p1.label > p2.label ? 1 : 0));
  }

  private determineTransferAmount(t: AccountTransaction): Money {
    const term = this.converter.termCurrency;
    if (term === t.currencyCode) return t.getMonetaryAmount();
    const other = t.crossEntry!.getCrossTransaction(t);
    if (term === other.currencyCode) return other.getMonetaryAmount();
    const m = MutableMoney.of(term);
    m.add(convertMoney(this.converter, t.date, t.getMonetaryAmount()));
    m.add(convertMoney(this.converter, t.date, other.getMonetaryAmount()));
    return m.divide(2).toMoney();
  }
}

PerformanceIndex.snapshotFactory = (client, converter, interval, fifo) =>
  new ClientPerformanceSnapshot(client, converter, interval, fifo);

