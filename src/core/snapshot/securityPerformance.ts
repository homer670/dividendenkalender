// name.abuchen.portfolio.snapshot.security.* (LazySecurityPerformanceSnapshot & calculations)

import {
  AccountTransaction,
  Client,
  isPurchase,
  Portfolio,
  PortfolioTransaction,
  Security,
  SecurityPrice,
  Transaction,
  TransactionOwner,
  UnitType,
} from '../model';
import { atStartOfDay, LocalDate, LocalDateTime, SECONDS_PER_DAY, toLocalDate, year as yearOf } from '../util/dates';
import { Interval } from '../util/interval';
import { Money, money, MutableMoney, Quote, quote, Values } from '../money/money';
import { convertMoney, convertQuote, CurrencyConverter } from '../money/exchange';
import { ClientSnapshot, PortfolioSnapshot, SecurityPosition, compareText, grossValueConverted } from './clientSnapshot';
import { D, DMC, HALF_DOWN, HALF_EVEN, HALF_UP, divScale, javaRound, toLong } from '../util/decimal';
import { calculateIRR } from '../math/irr';
import { ClientSecurityFilter } from './filters';
import { performanceIndexForClient, PerformanceIndex } from './performanceIndex';

export type CostMethod = 'FIFO' | 'MOVING_AVERAGE';
export type TaxesAndFees = 'INCLUDED' | 'NOT_INCLUDED';

// ------------------------------------------------------------------
// helper: Transaction#getUnitSum(Type, CurrencyConverter)

export function unitSumConverted(t: Transaction, type: UnitType, converter: CurrencyConverter): Money {
  const term = converter.termCurrency;
  let sum = 0;
  for (const u of t.units) {
    if (u.type !== type) continue;
    if (term === u.amount.currencyCode) sum += u.amount.amount;
    else if (u.forex !== null && term === u.forex.currencyCode) sum += u.forex.amount;
    else sum += convertMoney(converter, t.date, u.amount).amount;
  }
  return money(term, sum);
}

/** PortfolioTransaction#getMonetaryAmount(CurrencyConverter) */
export function monetaryAmountConverted(t: PortfolioTransaction, converter: CurrencyConverter): Money {
  if (t.currencyCode === converter.termCurrency) return t.getMonetaryAmount();
  if (t.security && t.security.currencyCode === converter.termCurrency) {
    const gv = t.getUnit('GROSS_VALUE');
    const exchangeRate = gv && gv.exchangeRate ? gv.exchangeRate : converter.getRate(t.date, t.currencyCode).value;
    const inverse = divScale(1, exchangeRate, 10, HALF_DOWN);
    return money(converter.termCurrency, toLong(inverse.mul(t.amount), HALF_DOWN));
  }
  return convertMoney(converter, t.date, t.getMonetaryAmount());
}

// ------------------------------------------------------------------
// line items

export type LineItem = TransactionItem | DividendPayment | ValuationAtStart | ValuationAtEnd;

export class TransactionItem {
  readonly kind: 'tx' | 'dividend' = 'tx';
  constructor(
    readonly owner: TransactionOwner,
    readonly transaction: Transaction,
  ) {}
  get dateTime(): LocalDateTime {
    return this.transaction.dateTime;
  }
  getValue(): Money {
    return this.transaction.getMonetaryAmount();
  }
  getOrderingHint(): number {
    return Math.floor(this.transaction.updatedAt ?? 0);
  }
}

export class DividendPayment extends TransactionItem {
  override readonly kind = 'dividend' as const;
  totalShares = 0;
  fifoCost: Money | null = null;
  movingAverageCost: Money | null = null;

  getGrossValueAmount(): number {
    return this.transaction.amount + this.transaction.getUnitSum('TAX').amount;
  }
  getGrossValue(): Money {
    return money(this.transaction.currencyCode, this.getGrossValueAmount());
  }
  /** amount fraction (5 digits) per share */
  getDividendPerShare(): number {
    return amountFractionPerShare(this.getGrossValueAmount(), this.transaction.shares);
  }
  getPersonalDividendYield(): number {
    if (this.fifoCost === null || this.fifoCost.amount <= 0) return 0;
    let cost = this.fifoCost.amount;
    if (this.transaction.shares > 0) cost = this.fifoCost.amount * (this.transaction.shares / this.totalShares);
    return this.getGrossValueAmount() / cost;
  }
  getPersonalDividendYieldMovingAverage(): number {
    if (this.movingAverageCost === null || this.movingAverageCost.amount <= 0) return 0;
    let cost = this.movingAverageCost.amount;
    if (this.transaction.shares > 0) cost = this.movingAverageCost.amount * (this.transaction.shares / this.totalShares);
    return this.getGrossValueAmount() / cost;
  }
}

export function amountFractionPerShare(amount: number, shares: number): number {
  if (shares === 0) return 0;
  // movePointLeft(2).movePointRight(5).movePointRight(8) == * 10^11
  return toLong(new D(new DMC(new D(amount).mul(1e11)).div(shares)), HALF_EVEN);
}

export class ValuationAtStart {
  readonly kind = 'start' as const;
  constructor(
    readonly owner: Portfolio,
    readonly position: SecurityPosition,
    readonly dateTime: LocalDateTime,
  ) {}
  getValue(): Money {
    return this.position.calculateValue();
  }
  getOrderingHint(): number {
    return 0;
  }
}

export class ValuationAtEnd {
  readonly kind = 'end' as const;
  constructor(
    readonly owner: Portfolio,
    readonly position: SecurityPosition,
    readonly dateTime: LocalDateTime,
  ) {}
  getValue(): Money {
    return this.position.calculateValue();
  }
  getOrderingHint(): number {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function lineItemOf(owner: TransactionOwner, t: Transaction): TransactionItem {
  return t instanceof AccountTransaction && t.type === 'DIVIDENDS' ? new DividendPayment(owner, t) : new TransactionItem(owner, t);
}

function typeOrder(item: LineItem): number {
  if (item.kind === 'start') return -1;
  if (item.kind === 'end') return 1;
  return 0;
}

function sortOrder(item: LineItem): number {
  if (item.kind === 'start' || item.kind === 'end') return 2;
  const tx = item.transaction;
  if (tx instanceof PortfolioTransaction) {
    if (tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT') return 2;
    return isPurchase(tx.type) ? 1 : 3;
  }
  const at = tx as AccountTransaction;
  if (at.type === 'TRANSFER_IN' || at.type === 'TRANSFER_OUT') return 2;
  const debit = ['REMOVAL', 'INTEREST_CHARGE', 'FEES', 'TAXES', 'BUY', 'TRANSFER_OUT'].includes(at.type);
  return debit ? 1 : 3;
}

/** CalculationLineItemComparator */
export function compareLineItems(t1: LineItem, t2: LineItem): number {
  const compare = typeOrder(t1) - typeOrder(t2);
  if (compare !== 0) return compare;
  const dt1 = t1.dateTime;
  const dt2 = t2.dateTime;
  const d1 = toLocalDate(dt1);
  const d2 = toLocalDate(dt2);
  if (d1 !== d2) return dt1 < dt2 ? -1 : dt1 > dt2 ? 1 : 0;
  // hour or minute set (seconds are ignored as in PP)
  const sod1 = dt1 - d1 * SECONDS_PER_DAY;
  const sod2 = dt2 - d2 * SECONDS_PER_DAY;
  const hasTime1 = Math.floor(sod1 / 60) !== 0;
  const hasTime2 = Math.floor(sod2 / 60) !== 0;
  if (hasTime1 && hasTime2) return dt1 < dt2 ? -1 : dt1 > dt2 ? 1 : 0;
  return sortOrder(t1) - sortOrder(t2);
}

// ------------------------------------------------------------------
// calculations

interface CalculationContext {
  converter: CurrencyConverter;
  security: Security;
  termCurrency: string;
}

abstract class Calculation {
  protected ctx!: CalculationContext;
  prepare(): void {}
  finish(_items: LineItem[]): void {}
  visitStart(_t: ValuationAtStart): void {}
  visitEnd(_t: ValuationAtEnd): void {}
  visitDividend(_t: DividendPayment): void {}
  visitPortfolioTx(_item: TransactionItem, _t: PortfolioTransaction): void {}
  visitAccountTx(_item: TransactionItem, _t: AccountTransaction): void {}

  perform(converter: CurrencyConverter, security: Security, items: LineItem[]): this {
    this.ctx = { converter, security, termCurrency: converter.termCurrency };
    this.prepare();
    for (const item of items) {
      if (item.kind === 'start') this.visitStart(item);
      else if (item.kind === 'end') this.visitEnd(item);
      else if (item instanceof DividendPayment) this.visitDividend(item);
      else if (item.transaction instanceof PortfolioTransaction) this.visitPortfolioTx(item, item.transaction);
      else this.visitAccountTx(item, item.transaction as AccountTransaction);
    }
    this.finish(items);
    return this;
  }
}

class SharesHeldCalculation extends Calculation {
  sharesHeld = 0;
  override visitStart(item: ValuationAtStart): void {
    this.sharesHeld += item.position.shares;
  }
  override visitPortfolioTx(_item: TransactionItem, t: PortfolioTransaction): void {
    switch (t.type) {
      case 'BUY':
      case 'DELIVERY_INBOUND':
        this.sharesHeld += t.shares;
        break;
      case 'SELL':
      case 'DELIVERY_OUTBOUND':
        this.sharesHeld -= t.shares;
        break;
      default:
        break;
    }
  }
}

class DeltaCalculation extends Calculation {
  delta!: MutableMoney;
  cost!: MutableMoney;
  override prepare(): void {
    this.delta = MutableMoney.of(this.ctx.termCurrency);
    this.cost = MutableMoney.of(this.ctx.termCurrency);
  }
  private conv(m: Money, dt: LocalDateTime): Money {
    return convertMoney(this.ctx.converter, toLocalDate(dt), m);
  }
  override visitStart(t: ValuationAtStart): void {
    const amount = this.conv(t.getValue(), t.dateTime);
    this.delta.subtract(amount);
    this.cost.add(amount);
  }
  override visitEnd(t: ValuationAtEnd): void {
    this.delta.add(this.conv(t.getValue(), t.dateTime));
  }
  override visitDividend(t: DividendPayment): void {
    this.delta.add(this.conv(t.getValue(), t.dateTime));
  }
  override visitAccountTx(_item: TransactionItem, t: AccountTransaction): void {
    switch (t.type) {
      case 'TAXES':
      case 'FEES':
        this.delta.subtract(this.conv(t.getMonetaryAmount(), t.dateTime));
        break;
      case 'TAX_REFUND':
      case 'FEES_REFUND':
        this.delta.add(this.conv(t.getMonetaryAmount(), t.dateTime));
        break;
      default:
        throw new Error('unsupported type ' + t.type);
    }
  }
  override visitPortfolioTx(_item: TransactionItem, t: PortfolioTransaction): void {
    switch (t.type) {
      case 'BUY':
      case 'DELIVERY_INBOUND': {
        const amount = this.conv(t.getMonetaryAmount(), t.dateTime);
        this.delta.subtract(amount);
        this.cost.add(amount);
        break;
      }
      case 'SELL':
      case 'DELIVERY_OUTBOUND':
        this.delta.add(this.conv(t.getMonetaryAmount(), t.dateTime));
        break;
      default:
        break;
    }
  }
  getDeltaPercent(): number {
    if (this.delta.amount === 0 && this.cost.amount === 0) return 0;
    return this.delta.amount / this.cost.amount;
  }
}

class IRRCalculation extends Calculation {
  dates: LocalDate[] = [];
  values: number[] = [];
  private conv(m: Money, dt: LocalDateTime): Money {
    return convertMoney(this.ctx.converter, toLocalDate(dt), m);
  }
  override visitStart(t: ValuationAtStart): void {
    this.dates.push(toLocalDate(t.dateTime));
    this.values.push(-this.conv(t.getValue(), t.dateTime).amount / Values.Amount.divider);
  }
  override visitEnd(t: ValuationAtEnd): void {
    this.dates.push(toLocalDate(t.dateTime));
    this.values.push(this.conv(t.getValue(), t.dateTime).amount / Values.Amount.divider);
  }
  override visitDividend(t: DividendPayment): void {
    this.dates.push(toLocalDate(t.dateTime));
    const taxes = unitSumConverted(t.transaction, 'TAX', this.ctx.converter).amount;
    const amount = this.conv(t.getValue(), t.dateTime).amount;
    this.values.push((amount + taxes) / Values.Amount.divider);
  }
  override visitAccountTx(_item: TransactionItem, t: AccountTransaction): void {
    switch (t.type) {
      case 'FEES':
        this.dates.push(t.date);
        this.values.push(-this.conv(t.getMonetaryAmount(), t.dateTime).amount / Values.Amount.divider);
        break;
      case 'FEES_REFUND':
        this.dates.push(t.date);
        this.values.push(this.conv(t.getMonetaryAmount(), t.dateTime).amount / Values.Amount.divider);
        break;
      default:
        break;
    }
  }
  override visitPortfolioTx(_item: TransactionItem, t: PortfolioTransaction): void {
    this.dates.push(t.date);
    const taxes = unitSumConverted(t, 'TAX', this.ctx.converter).amount;
    const amount = monetaryAmountConverted(t, this.ctx.converter).amount;
    switch (t.type) {
      case 'BUY':
      case 'DELIVERY_INBOUND':
      case 'TRANSFER_IN':
        this.values.push((-amount + taxes) / Values.Amount.divider);
        break;
      default:
        this.values.push((amount + taxes) / Values.Amount.divider);
    }
  }
  getIRR(): number {
    if (this.dates.length === 0) return NaN;
    return calculateIRR(this.dates, this.values);
  }
}

interface CostLineItem {
  owner: TransactionOwner;
  shares: number;
  grossAmount: number;
  netAmount: number;
  originalShares: number;
}

export interface CostCalculationResult {
  sharesHeld: number;
  fifoCost: Money;
  netFifoCost: Money;
  movingAverageCost: Money;
  netMovingAverageCost: Money;
  fees: Money;
  taxes: Money;
  /** remaining FIFO lots (for the purchase value per lot view) */
  lots: { owner: TransactionOwner; shares: number; grossAmount: number; netAmount: number }[];
}

class CostCalculation extends Calculation {
  private fifo: CostLineItem[] = [];
  private movingRelativeCost = 0;
  private movingRelativeNetCost = 0;
  private heldShares = 0;
  private fees = 0;
  private taxes = 0;

  override visitStart(item: ValuationAtStart): void {
    const valuation = item.getValue();
    const amount = convertMoney(this.ctx.converter, toLocalDate(item.dateTime), valuation).amount;
    this.fifo.push({ owner: item.owner, shares: item.position.shares, grossAmount: amount, netAmount: amount, originalShares: item.position.shares });
    this.movingRelativeCost += amount;
    this.movingRelativeNetCost += amount;
    this.heldShares += item.position.shares;
  }

  override visitPortfolioTx(item: TransactionItem, t: PortfolioTransaction): void {
    const converter = this.ctx.converter;
    this.fees += unitSumConverted(t, 'FEE', converter).amount;
    this.taxes += unitSumConverted(t, 'TAX', converter).amount;
    switch (t.type) {
      case 'BUY':
      case 'DELIVERY_INBOUND': {
        const grossAmount = monetaryAmountConverted(t, converter).amount;
        const netAmount = grossValueConverted(t, converter).amount;
        this.fifo.push({ owner: item.owner, shares: t.shares, grossAmount, netAmount, originalShares: t.shares });
        this.movingRelativeCost += grossAmount;
        this.movingRelativeNetCost += netAmount;
        this.heldShares += t.shares;
        break;
      }
      case 'SELL':
      case 'DELIVERY_OUTBOUND': {
        let sold = t.shares;
        const remaining = this.heldShares - sold;
        if (remaining <= 0) {
          this.movingRelativeCost = 0;
          this.movingRelativeNetCost = 0;
          this.heldShares = 0;
        } else {
          this.movingRelativeCost = javaRound((this.movingRelativeCost / this.heldShares) * remaining);
          this.movingRelativeNetCost = javaRound((this.movingRelativeNetCost / this.heldShares) * remaining);
          this.heldShares = remaining;
        }
        for (const entry of this.fifo) {
          if (sold <= 0) break;
          if (entry.owner !== item.owner) continue;
          if (entry.shares === 0) continue;
          const n = Math.min(sold, entry.shares);
          entry.grossAmount -= javaRound((n / entry.shares) * entry.grossAmount);
          entry.netAmount -= javaRound((n / entry.shares) * entry.netAmount);
          entry.shares -= n;
          sold -= n;
        }
        break;
      }
      case 'TRANSFER_IN': {
        let moved = t.shares;
        const source = t.crossEntry!.getCrossOwner(t);
        for (const entry of this.fifo.slice()) {
          if (moved <= 0) break;
          if (entry.owner !== source) continue;
          if (entry.shares === 0) continue;
          const n = Math.min(moved, entry.shares);
          if (n === entry.shares) {
            entry.owner = item.owner;
          } else {
            const transferredGrossAmount = javaRound((n / entry.shares) * entry.grossAmount);
            const transferredNetAmount = javaRound((n / entry.shares) * entry.netAmount);
            const transfer: CostLineItem = {
              owner: item.owner,
              shares: n,
              grossAmount: transferredGrossAmount,
              netAmount: transferredNetAmount,
              originalShares: n,
            };
            entry.grossAmount -= transferredGrossAmount;
            entry.netAmount -= transferredNetAmount;
            entry.shares -= n;
            this.fifo.splice(this.fifo.indexOf(entry) + 1, 0, transfer);
          }
          moved -= n;
        }
        break;
      }
      default:
        break;
    }
  }

  override visitAccountTx(_item: TransactionItem, t: AccountTransaction): void {
    const c = (m: Money) => convertMoney(this.ctx.converter, t.date, m).amount;
    switch (t.type) {
      case 'TAXES':
        this.taxes += c(t.getMonetaryAmount());
        break;
      case 'TAX_REFUND':
        this.taxes -= c(t.getMonetaryAmount());
        break;
      case 'FEES':
        this.fees += c(t.getMonetaryAmount());
        break;
      case 'FEES_REFUND':
        this.fees -= c(t.getMonetaryAmount());
        break;
      default:
        break;
    }
  }

  override visitDividend(t: DividendPayment): void {
    this.fees += unitSumConverted(t.transaction, 'FEE', this.ctx.converter).amount;
    this.taxes += unitSumConverted(t.transaction, 'TAX', this.ctx.converter).amount;
    t.fifoCost = this.getCost('FIFO', 'INCLUDED');
    t.movingAverageCost = this.getCost('MOVING_AVERAGE', 'INCLUDED');
    t.totalShares = this.getSharesHeld();
  }

  private getSharesHeld(): number {
    let shares = 0;
    for (const e of this.fifo) shares += e.shares;
    return shares;
  }

  getCost(method: CostMethod, taxesAndFees: TaxesAndFees): Money {
    const term = this.ctx.termCurrency;
    if (method === 'FIFO') {
      let cost = 0;
      for (const e of this.fifo) cost += taxesAndFees === 'INCLUDED' ? e.grossAmount : e.netAmount;
      return money(term, cost);
    }
    return money(term, taxesAndFees === 'INCLUDED' ? this.movingRelativeCost : this.movingRelativeNetCost);
  }

  getResult(): CostCalculationResult {
    const term = this.ctx.termCurrency;
    return {
      sharesHeld: this.getSharesHeld(),
      fifoCost: this.getCost('FIFO', 'INCLUDED'),
      netFifoCost: this.getCost('FIFO', 'NOT_INCLUDED'),
      movingAverageCost: this.getCost('MOVING_AVERAGE', 'INCLUDED'),
      netMovingAverageCost: this.getCost('MOVING_AVERAGE', 'NOT_INCLUDED'),
      fees: money(term, this.fees),
      taxes: money(term, this.taxes),
      lots: this.fifo
        .filter((e) => e.shares > 0)
        .map((e) => ({ owner: e.owner, shares: e.shares, grossAmount: e.grossAmount, netAmount: e.netAmount })),
    };
  }
}

export type Periodicity = 'UNKNOWN' | 'NONE' | 'INDEFINITE' | 'ANNUAL' | 'SEMIANNUAL' | 'QUARTERLY' | 'MONTHLY' | 'IRREGULAR';

export interface DividendCalculationResult {
  sum: Money;
  lastDividendPayment: LocalDate | null;
  numOfEvents: number;
  periodicity: Periodicity;
  rateOfReturnPerYear: number;
}

class DividendCalculation extends Calculation {
  private payments: { amount: Money; date: LocalDate; year: number; rateOfReturn: number }[] = [];
  private periodicity: Periodicity = 'NONE';
  private sum!: MutableMoney;
  private rateOfReturnPerYear = 0;

  override prepare(): void {
    this.sum = MutableMoney.of(this.ctx.termCurrency);
  }

  override visitDividend(t: DividendPayment): void {
    const amount = convertMoney(this.ctx.converter, toLocalDate(t.dateTime), t.getGrossValue());
    const date = toLocalDate(t.dateTime);
    let rr = NaN;
    const security = this.ctx.security;
    if (security !== null) {
      const mac = t.movingAverageCost;
      if (mac !== null && mac.amount !== 0) rr = amount.amount / mac.amount;
      if (rr === 0) {
        const p = security.getSecurityPrice(date);
        if (p.value !== 0) {
          const sharePriceAmount = (p.value / Values.Quote.factor) * 100000;
          rr = t.getDividendPerShare() / sharePriceAmount;
        }
      }
    }
    this.payments.push({ amount, date, year: yearOf(date), rateOfReturn: rr });
  }

  override finish(): void {
    const payments = this.payments;
    if (payments.length === 0) {
      this.periodicity = 'NONE';
      return;
    }
    this.periodicity = 'UNKNOWN';
    payments.sort((r, l) => r.date - l.date);
    const firstPayment = payments[0].date;
    const lastPayment = payments[payments.length - 1].date;
    let significantCount = 0;
    let insignificantYears = 0;
    let sumRateOfReturn = 0;
    for (const p of payments) {
      this.sum.add(p.amount);
      sumRateOfReturn += p.rateOfReturn;
    }
    let years = 0;
    for (let y = yearOf(firstPayment); y <= yearOf(lastPayment); y++) {
      years++;
      let countPerYear = 0;
      let sumPerYear = 0;
      let lastDate: LocalDate | null = null;
      for (const p of payments)
        if (p.year === y) {
          countPerYear++;
          sumPerYear += p.amount.amount;
        }
      if (countPerYear === 0) {
        insignificantYears++;
        continue;
      }
      const expectedAmount = sumPerYear / countPerYear;
      for (const p of payments) {
        if (p.year === y) {
          const significance = p.amount.amount / expectedAmount;
          if (significance > 0.3) {
            if (lastDate === null || p.date !== lastDate) significantCount++;
          }
          lastDate = p.date;
        }
      }
    }
    this.rateOfReturnPerYear = sumRateOfReturn / years;
    if (significantCount > 0) {
      const days = Math.abs(lastPayment - firstPayment) - insignificantYears * 365;
      const daysBetweenPayments = javaRound(days / (significantCount - 1));
      if (daysBetweenPayments < 430) {
        if (daysBetweenPayments > 270) this.periodicity = 'ANNUAL';
        else if (daysBetweenPayments > 130) this.periodicity = 'SEMIANNUAL';
        else if (daysBetweenPayments > 60) this.periodicity = 'QUARTERLY';
        else if (daysBetweenPayments > 20) this.periodicity = 'MONTHLY';
      }
    }
  }

  getResult(): DividendCalculationResult {
    return {
      sum: this.sum.toMoney(),
      lastDividendPayment: this.payments.length === 0 ? null : this.payments[this.payments.length - 1].date,
      numOfEvents: this.payments.length,
      periodicity: this.periodicity,
      rateOfReturnPerYear: this.rateOfReturnPerYear,
    };
  }
}

export class CapitalGainsRecord {
  capitalGains: Money;
  forexCapitalGains: Money;
  constructor(
    readonly security: Security,
    termCurrency: string,
  ) {
    this.capitalGains = money(termCurrency, 0);
    this.forexCapitalGains = money(termCurrency, 0);
  }
  addCapitalGains(m: Money): void {
    this.capitalGains = money(this.capitalGains.currencyCode, this.capitalGains.amount + m.amount);
  }
  addForexCapitalGains(m: Money): void {
    this.forexCapitalGains = money(this.forexCapitalGains.currencyCode, this.forexCapitalGains.amount + m.amount);
  }
}

abstract class AbstractCapitalGainsCalculation extends Calculation {
  realized!: CapitalGainsRecord;
  unrealized!: CapitalGainsRecord;
  override prepare(): void {
    this.realized = new CapitalGainsRecord(this.ctx.security, this.ctx.termCurrency);
    this.unrealized = new CapitalGainsRecord(this.ctx.security, this.ctx.termCurrency);
  }
}

interface GainsLineItem {
  shares: number;
  date: LocalDate;
  value: number;
  valueForex: number;
  originalShares: number;
  source: LineItem | null;
}

function sourceOwner(item: LineItem | null): TransactionOwner | null {
  return item === null ? null : item.owner;
}

class CapitalGainsCalculation extends AbstractCapitalGainsCalculation {
  private fifo: GainsLineItem[] = [];
  constructor(private readonly taxesAndFees: TaxesAndFees) {
    super();
  }

  override visitStart(valuation: ValuationAtStart): void {
    const valueForex = valuation.getValue();
    const converted = convertMoney(this.ctx.converter, toLocalDate(valuation.dateTime), valueForex);
    this.fifo.push({
      shares: valuation.position.shares,
      date: toLocalDate(valuation.dateTime),
      value: converted.amount,
      valueForex: valueForex.amount,
      originalShares: valuation.position.shares,
      source: valuation,
    });
  }

  override visitPortfolioTx(transactionItem: TransactionItem, t: PortfolioTransaction): void {
    const converter = this.ctx.converter;
    const termCurrency = this.ctx.termCurrency;
    const securityCurrency = t.security!.currencyCode;
    const included = this.taxesAndFees === 'INCLUDED';
    const termBasis = included ? monetaryAmountConverted(t, converter) : grossValueConverted(t, converter);
    const forexConverter = converter.with(securityCurrency);
    const forexBasis = included ? monetaryAmountConverted(t, forexConverter) : grossValueConverted(t, forexConverter);

    switch (t.type) {
      case 'BUY':
      case 'DELIVERY_INBOUND':
        this.fifo.push({
          shares: t.shares,
          date: t.date,
          value: termBasis.amount,
          valueForex: forexBasis.amount,
          originalShares: t.shares,
          source: transactionItem,
        });
        break;
      case 'SELL':
      case 'DELIVERY_OUTBOUND': {
        const value = termBasis.amount;
        const valueForex = forexBasis.amount;
        let sold = t.shares;
        for (const item of this.fifo) {
          if (item.shares === 0) continue;
          if (sourceOwner(item.source) !== transactionItem.owner) continue;
          if (sold <= 0) break;
          const soldShares = Math.min(sold, item.shares);
          const start = javaRound((soldShares / item.shares) * item.value);
          const startForex = javaRound((soldShares / item.shares) * item.valueForex);
          const end = javaRound((soldShares / t.shares) * value);
          let forexGain = 0;
          if (termCurrency !== securityCurrency && valueForex !== 0) {
            const exchangeRate = new D(new DMC(value).div(valueForex));
            const relievedForexInTerm = toLong(new D(startForex).mul(exchangeRate), HALF_DOWN);
            forexGain = relievedForexInTerm - start;
          }
          this.realized.addCapitalGains(money(termCurrency, end - start));
          this.realized.addForexCapitalGains(money(termCurrency, forexGain));
          item.shares -= soldShares;
          item.value -= start;
          item.valueForex -= startForex;
          sold -= soldShares;
        }
        break;
      }
      case 'TRANSFER_IN': {
        let moved = t.shares;
        const source = t.crossEntry!.getCrossOwner(t);
        for (const entry of this.fifo.slice()) {
          if (moved <= 0) break;
          if (sourceOwner(entry.source) !== source) continue;
          if (entry.shares === 0) continue;
          const n = Math.min(moved, entry.shares);
          const transferredValue = javaRound((n / entry.shares) * entry.value);
          const transferredValueForex = javaRound((n / entry.shares) * entry.valueForex);
          const transfer: GainsLineItem = {
            shares: n,
            date: t.date,
            value: transferredValue,
            valueForex: transferredValueForex,
            originalShares: n,
            source: transactionItem,
          };
          if (n === entry.shares) {
            this.fifo.splice(this.fifo.indexOf(entry) + 1, 0, transfer);
            this.fifo.splice(this.fifo.indexOf(entry), 1);
          } else {
            entry.value -= transferredValue;
            entry.valueForex -= transferredValueForex;
            entry.shares -= n;
            this.fifo.splice(this.fifo.indexOf(entry) + 1, 0, transfer);
          }
          moved -= n;
        }
        break;
      }
      default:
        break;
    }
  }

  override finish(lineItems: LineItem[]): void {
    const converter = this.ctx.converter;
    const termCurrency = this.ctx.termCurrency;
    const securityCurrency = this.ctx.security.currencyCode;
    const valuationsAtEnd = lineItems.filter((i): i is ValuationAtEnd => i.kind === 'end');
    if (valuationsAtEnd.length === 0) return;
    this.squashForexValuationsAtStart();
    let start = 0;
    let startForex = 0;
    for (const item of this.fifo) {
      start += item.value;
      startForex += item.valueForex;
    }
    const valuationAtEndDate = valuationsAtEnd[0].dateTime;
    let endValueAmount = 0;
    for (const item of valuationsAtEnd) endValueAmount += item.position.calculateValue().amount;
    const endValue = money(securityCurrency, endValueAmount);
    const convertedEndValue = convertMoney(converter, toLocalDate(valuationAtEndDate), endValue);
    const end = convertedEndValue.amount;
    const endForex = endValue.amount;
    let forexGain = 0;
    if (termCurrency !== securityCurrency && endForex !== 0) {
      const exchangeRate = new D(new DMC(end).div(endForex));
      const forexInTerm = toLong(new D(startForex).mul(exchangeRate), HALF_DOWN);
      forexGain = forexInTerm - start;
    }
    this.unrealized.addCapitalGains(money(termCurrency, end - start));
    this.unrealized.addForexCapitalGains(money(termCurrency, forexGain));
    this.fifo = [];
  }

  private squashForexValuationsAtStart(): void {
    if (this.ctx.security.currencyCode === this.ctx.termCurrency) return;
    const itemsToSquash = this.fifo.filter((item) => item.source !== null && item.source.kind === 'start' && item.shares === item.originalShares);
    if (itemsToSquash.length < 2) return;
    const first = itemsToSquash[0].source as ValuationAtStart;
    const valuationAtStartDate = first.dateTime;
    let shares = 0;
    let valueAmount = 0;
    for (const item of itemsToSquash) {
      shares += item.shares;
      valueAmount += (item.source as ValuationAtStart).position.calculateValue().amount;
    }
    const value = money(this.ctx.security.currencyCode, valueAmount);
    const converted = convertMoney(this.ctx.converter, toLocalDate(valuationAtStartDate), value);
    const replacement: GainsLineItem = {
      shares,
      date: toLocalDate(valuationAtStartDate),
      value: converted.amount,
      valueForex: value.amount,
      originalShares: shares,
      source: null,
    };
    this.fifo = this.fifo.filter((i) => !itemsToSquash.includes(i));
    this.fifo.unshift(replacement);
  }
}

/** BigDecimal.valueOf(double).setScale(10, HALF_UP) */
function rateFromDouble(v: number): D {
  return new D(String(v)).toDecimalPlaces(10, HALF_UP);
}

class CapitalGainsCalculationMovingAverage extends AbstractCapitalGainsCalculation {
  private heldShares = 0;
  private movingAverageCost = 0;
  private movingAverageCostForex = 0;
  constructor(private readonly taxesAndFees: TaxesAndFees) {
    super();
  }
  override visitStart(valuation: ValuationAtStart): void {
    const value = valuation.getValue();
    const converted = convertMoney(this.ctx.converter, toLocalDate(valuation.dateTime), value);
    this.movingAverageCost += converted.amount;
    this.movingAverageCostForex += value.amount;
    this.heldShares += valuation.position.shares;
  }
  override visitPortfolioTx(_item: TransactionItem, t: PortfolioTransaction): void {
    const converter = this.ctx.converter;
    const termCurrency = this.ctx.termCurrency;
    const securityCurrency = this.ctx.security.currencyCode;
    const included = this.taxesAndFees === 'INCLUDED';
    const forexConverter = converter.with(securityCurrency);
    const forexBasis = (included ? monetaryAmountConverted(t, forexConverter) : grossValueConverted(t, forexConverter)).amount;
    const termBasis = (included ? monetaryAmountConverted(t, converter) : grossValueConverted(t, converter)).amount;
    switch (t.type) {
      case 'BUY':
      case 'DELIVERY_INBOUND':
        this.movingAverageCost += termBasis;
        this.movingAverageCostForex += forexBasis;
        this.heldShares += t.shares;
        break;
      case 'SELL':
      case 'DELIVERY_OUTBOUND': {
        const sold = t.shares;
        const remaining = this.heldShares - sold;
        if (remaining < 0) {
          this.movingAverageCost = 0;
          this.movingAverageCostForex = 0;
          this.heldShares = 0;
        } else {
          const averageCosts = javaRound((this.movingAverageCost / this.heldShares) * sold);
          const averageCostsForex = javaRound((this.movingAverageCostForex / this.heldShares) * sold);
          const gain = termBasis - averageCosts;
          let gainForex = 0;
          if (termCurrency !== securityCurrency && forexBasis !== 0) {
            const exchangeRate = rateFromDouble(termBasis / forexBasis);
            gainForex = toLong(new D(averageCostsForex).mul(exchangeRate).sub(averageCosts), HALF_DOWN);
          }
          this.realized.addCapitalGains(money(termCurrency, gain));
          this.realized.addForexCapitalGains(money(termCurrency, gainForex));
          this.movingAverageCost -= averageCosts;
          this.movingAverageCostForex -= averageCostsForex;
          this.heldShares = remaining;
        }
        break;
      }
      default:
        break;
    }
  }
  override finish(lineItems: LineItem[]): void {
    const termCurrency = this.ctx.termCurrency;
    const securityCurrency = this.ctx.security.currencyCode;
    const valuationsAtEnd = lineItems.filter((i): i is ValuationAtEnd => i.kind === 'end');
    if (valuationsAtEnd.length === 0) return;
    const valuationAtEndDate = valuationsAtEnd[0].dateTime;
    let endValueAmount = 0;
    for (const item of valuationsAtEnd) endValueAmount += item.position.calculateValue().amount;
    const endValue = money(securityCurrency, endValueAmount);
    const converted = convertMoney(this.ctx.converter, toLocalDate(valuationAtEndDate), endValue);
    const endAmount = converted.amount;
    const endAmountForex = endValue.amount;
    const gain = endAmount - this.movingAverageCost;
    let gainForex = 0;
    if (termCurrency !== securityCurrency && endAmountForex !== 0) {
      const exchangeRate = rateFromDouble(endAmount / endAmountForex);
      gainForex = toLong(new D(this.movingAverageCostForex).mul(exchangeRate).sub(this.movingAverageCost), HALF_DOWN);
    }
    this.unrealized.addCapitalGains(money(termCurrency, gain));
    this.unrealized.addForexCapitalGains(money(termCurrency, gainForex));
  }
}

// ------------------------------------------------------------------
// record

function lazy<T>(fn: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
}

export class SecurityPerformanceRecord {
  readonly lineItems: LineItem[] = [];

  constructor(
    readonly client: Client,
    readonly security: Security,
    readonly converter: CurrencyConverter,
    readonly interval: Interval,
  ) {}

  get securityName(): string {
    return this.security.name;
  }

  private readonly irrValue = lazy(() => new IRRCalculation().perform(this.converter, this.security, this.lineItems).getIRR());
  private readonly performanceIndex = lazy(() =>
    performanceIndexForClient(new ClientSecurityFilter(this.security).filter(this.client), this.converter, this.interval),
  );
  private readonly deltaCalculation = lazy(() => new DeltaCalculation().perform(this.converter, this.security, this.lineItems));
  private readonly costCalculation = lazy(() => new CostCalculation().perform(this.converter, this.security, this.lineItems).getResult());
  private readonly sharesHeldValue = lazy(() => new SharesHeldCalculation().perform(this.converter, this.security, this.lineItems).sharesHeld);
  private readonly dividendCalculation = lazy(() => {
    this.costCalculation();
    return new DividendCalculation().perform(this.converter, this.security, this.lineItems).getResult();
  });
  private readonly capitalGains = lazy(() => new CapitalGainsCalculation('NOT_INCLUDED').perform(this.converter, this.security, this.lineItems));
  private readonly capitalGainsMovingAvg = lazy(() =>
    new CapitalGainsCalculationMovingAverage('NOT_INCLUDED').perform(this.converter, this.security, this.lineItems),
  );
  private readonly capitalGainsWithCharges = lazy(() => new CapitalGainsCalculation('INCLUDED').perform(this.converter, this.security, this.lineItems));
  private readonly capitalGainsMovingAvgWithCharges = lazy(() =>
    new CapitalGainsCalculationMovingAverage('INCLUDED').perform(this.converter, this.security, this.lineItems),
  );

  private readonly marketValueValue = lazy(() => {
    let sum = 0;
    for (const i of this.lineItems) if (i.kind === 'end') sum += i.getValue().amount;
    return convertMoney(this.converter, this.interval.end, money(this.security.currencyCode, sum));
  });
  private readonly openingValueValue = lazy(() => {
    let sum = 0;
    for (const i of this.lineItems) if (i.kind === 'start') sum += i.getValue().amount;
    return convertMoney(this.converter, this.interval.start, money(this.security.currencyCode, sum));
  });
  private readonly quoteValue = lazy(() => this.security.getSecurityPrice(this.interval.end));

  getIrr(): number {
    return this.irrValue();
  }
  getPerformanceIndex(): PerformanceIndex {
    return this.performanceIndex();
  }
  getTrueTimeWeightedRateOfReturn(): number {
    return this.performanceIndex().getFinalAccumulatedPercentage();
  }
  getTrueTimeWeightedRateOfReturnAnnualized(): number {
    return this.performanceIndex().getFinalAccumulatedAnnualizedPercentage();
  }
  getDelta(): Money {
    return this.deltaCalculation().delta.toMoney();
  }
  getDeltaPercent(): number {
    return this.deltaCalculation().getDeltaPercent();
  }
  getMarketValue(): Money {
    return this.marketValueValue();
  }
  getOpeningValue(): Money {
    return this.openingValueValue();
  }
  getQuote(): Quote {
    return quote(this.security.currencyCode, this.quoteValue().value);
  }
  getLatestSecurityPrice(): SecurityPrice {
    return this.quoteValue();
  }
  getQuoteInTermCurrency(): Quote {
    const price = this.quoteValue();
    return convertQuote(this.converter, price.date, quote(this.security.currencyCode, price.value));
  }
  getCost(costMethod: CostMethod, taxesAndFees: TaxesAndFees = 'INCLUDED'): Money {
    const c = this.costCalculation();
    if (costMethod === 'FIFO') return taxesAndFees === 'INCLUDED' ? c.fifoCost : c.netFifoCost;
    return taxesAndFees === 'INCLUDED' ? c.movingAverageCost : c.netMovingAverageCost;
  }
  getCostCalculation(): CostCalculationResult {
    return this.costCalculation();
  }
  getCapitalGainsOnHoldings(costMethod: CostMethod): Money {
    const mv = this.getMarketValue();
    return money(mv.currencyCode, mv.amount - this.getCost(costMethod, 'INCLUDED').amount);
  }
  getCapitalGainsOnHoldingsPercent(costMethod: CostMethod): number {
    const mv = this.getMarketValue();
    const cost = this.getCost(costMethod, 'INCLUDED');
    if (mv.amount === 0 && cost.amount === 0) return 0;
    return mv.amount / cost.amount - 1;
  }
  getFees(): Money {
    return this.costCalculation().fees;
  }
  getTaxes(): Money {
    return this.costCalculation().taxes;
  }
  getSharesHeld(): number {
    return this.sharesHeldValue();
  }
  getCostPerSharesHeld(costMethod: CostMethod, taxesAndFees: TaxesAndFees = 'INCLUDED'): Quote {
    const shares = this.costCalculation().sharesHeld;
    const cost = this.getCost(costMethod, taxesAndFees);
    return quote(cost.currencyCode, javaRound((cost.amount / shares) * Values.Share.factor * Values.Quote.factorToMoney));
  }
  getSumOfDividends(): Money {
    return this.dividendCalculation().sum;
  }
  getDividendEventCount(): number {
    return this.dividendCalculation().numOfEvents;
  }
  getLastDividendPayment(): LocalDate | null {
    return this.dividendCalculation().lastDividendPayment;
  }
  getPeriodicity(): Periodicity {
    return this.dividendCalculation().periodicity;
  }
  getRateOfReturnPerYear(): number {
    return this.dividendCalculation().rateOfReturnPerYear;
  }
  getTotalRateOfReturnDiv(costMethod: CostMethod): number {
    const costs = this.costCalculation();
    const cost = this.getCost(costMethod, 'INCLUDED');
    return costs.sharesHeld > 0 ? this.dividendCalculation().sum.amount / cost.amount : 0;
  }
  getRealizedCapitalGains(costMethod: CostMethod, taxesAndFees: TaxesAndFees = 'NOT_INCLUDED'): CapitalGainsRecord {
    if (costMethod === 'FIFO')
      return taxesAndFees === 'INCLUDED' ? this.capitalGainsWithCharges().realized : this.capitalGains().realized;
    return taxesAndFees === 'INCLUDED' ? this.capitalGainsMovingAvgWithCharges().realized : this.capitalGainsMovingAvg().realized;
  }
  getUnrealizedCapitalGains(costMethod: CostMethod, taxesAndFees: TaxesAndFees = 'NOT_INCLUDED'): CapitalGainsRecord {
    if (costMethod === 'FIFO')
      return taxesAndFees === 'INCLUDED' ? this.capitalGainsWithCharges().unrealized : this.capitalGains().unrealized;
    return taxesAndFees === 'INCLUDED' ? this.capitalGainsMovingAvgWithCharges().unrealized : this.capitalGainsMovingAvg().unrealized;
  }
  getDrawdown() {
    return this.performanceIndex().getDrawdown();
  }
  getVolatility() {
    return this.performanceIndex().getVolatility();
  }
}

// ------------------------------------------------------------------
// snapshot builder

export class SecurityPerformanceSnapshot {
  constructor(readonly records: SecurityPerformanceRecord[]) {}

  getRecord(security: Security): SecurityPerformanceRecord | undefined {
    return this.records.find((r) => r.security === security);
  }

  static create(
    client: Client,
    converter: CurrencyConverter,
    interval: Interval,
    valuationAtStart?: ClientSnapshot,
    valuationAtEnd?: ClientSnapshot,
  ): SecurityPerformanceSnapshot {
    const records = new Map<Security, SecurityPerformanceRecord>();
    for (const s of client.securities) records.set(s, new SecurityPerformanceRecord(client, s, converter, interval));
    const get = (s: Security) => {
      let r = records.get(s);
      if (!r) {
        r = new SecurityPerformanceRecord(client, s, converter, interval);
        records.set(s, r);
      }
      return r;
    };

    for (const account of client.accounts) {
      for (const t of account.transactions) {
        if (t.security === null) continue;
        if (!interval.contains(t.date)) continue;
        switch (t.type) {
          case 'DIVIDENDS':
          case 'INTEREST':
          case 'TAXES':
          case 'TAX_REFUND':
          case 'FEES':
          case 'FEES_REFUND':
            get(t.security).lineItems.push(lineItemOf(account, t));
            break;
          case 'BUY':
          case 'SELL':
            break;
          default:
            throw new Error('unexpected transaction with security: ' + t.type);
        }
      }
    }
    for (const portfolio of client.portfolios) {
      for (const t of portfolio.transactions) if (interval.contains(t.date)) get(t.security!).lineItems.push(lineItemOf(portfolio, t));
    }

    if (valuationAtStart && valuationAtEnd) {
      for (const snapshot of valuationAtStart.portfolios)
        for (const position of snapshot.positions)
          get(position.getSecurity()!).lineItems.push(new ValuationAtStart(snapshot.portfolio, position, atStartOfDay(interval.start)));
      for (const snapshot of valuationAtEnd.portfolios)
        for (const position of snapshot.positions)
          get(position.getSecurity()!).lineItems.push(new ValuationAtEnd(snapshot.portfolio, position, atStartOfDay(interval.end)));
    } else {
      for (const portfolio of client.portfolios) {
        let snapshot = PortfolioSnapshot.create(portfolio, converter, interval.start);
        for (const position of snapshot.positions)
          get(position.getSecurity()!).lineItems.push(new ValuationAtStart(portfolio, position, atStartOfDay(interval.start)));
        snapshot = PortfolioSnapshot.create(portfolio, converter, interval.end);
        for (const position of snapshot.positions)
          get(position.getSecurity()!).lineItems.push(new ValuationAtEnd(portfolio, position, atStartOfDay(interval.end)));
      }
    }

    const answer: SecurityPerformanceRecord[] = [];
    for (const r of records.values()) {
      if (r.lineItems.length === 0) continue;
      stableSort(r.lineItems, compareLineItems);
      answer.push(r);
    }
    return new SecurityPerformanceSnapshot(answer);
  }
}

/** Collections.sort is a stable merge sort; Array#sort is stable in modern engines too */
function stableSort<T>(list: T[], cmp: (a: T, b: T) => number): void {
  list.sort(cmp);
}

export function sortRecordsByName(records: SecurityPerformanceRecord[]): SecurityPerformanceRecord[] {
  return records.slice().sort((a, b) => compareText(a.securityName, b.securityName));
}

