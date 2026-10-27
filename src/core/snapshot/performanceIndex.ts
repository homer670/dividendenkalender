// PerformanceIndex, ClientIndex, ClientSnapshotIterator

import {
  AccountTransaction,
  Client,
  compareByDate,
  isCredit,
  isPurchase,
  PortfolioTransaction,
  Security,
} from '../model';
import { LocalDate, today } from '../util/dates';
import { Interval } from '../util/interval';
import { money } from '../money/money';
import { convertMoney, CurrencyConverter, SameDayRateConverter } from '../money/exchange';
import { grossPricePerShare, marketValue } from './clientSnapshot';
import { Drawdown, Volatility } from '../math/risk';
import { getDefaultCalendar } from '../util/tradeCalendar';
import type { ClientPerformanceSnapshot } from './clientPerformanceSnapshot';

class PriceCursor {
  private index = 0;
  constructor(private readonly security: Security) {}

  getSecurityPrice(date: LocalDate) {
    const prices = this.security.prices;
    const size = prices.length;
    if (size === 0 || !(prices[size - 1].date > date)) return this.security.getSecurityPrice(date);
    if (this.index >= size || (this.index > 0 && prices[this.index].date > date)) this.index = indexOf(prices, date);
    while (this.index + 1 < size && !(prices[this.index + 1].date > date)) this.index++;
    return prices[this.index];
  }
}

function indexOf(prices: { date: LocalDate }[], date: LocalDate): number {
  let low = 0;
  let high = prices.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const d = prices[mid].date;
    if (d < date) low = mid + 1;
    else if (d > date) high = mid - 1;
    else return mid;
  }
  const answer = -(low + 1);
  if (answer === -1) return 0;
  return -answer - 2;
}

/** ClientSnapshotIterator: calculates the valuation of a client day by day */
export class ClientSnapshotIterator {
  private readonly converter: CurrencyConverter;
  private readonly accounts: { currency: string; transactions: AccountTransaction[]; index: number; funds: number }[];
  private readonly securities = new Map<
    Security,
    { security: Security; prices: PriceCursor; shares: number; transactions: PortfolioTransaction[] }
  >();
  private readonly portfolioTransactions: PortfolioTransaction[];
  private portfolioTransactionIndex = 0;

  constructor(client: Client, converter: CurrencyConverter) {
    this.converter = new SameDayRateConverter(converter);
    this.portfolioTransactions = client.portfolios.flatMap((p) => p.transactions).sort(compareByDate);
    this.accounts = client.accounts.map((a) => ({
      currency: a.currencyCode,
      transactions: a.transactions.slice().sort(compareByDate),
      index: 0,
      funds: 0,
    }));
  }

  nextValuation(date: LocalDate): number {
    // account transactions
    for (const account of this.accounts) {
      while (account.index < account.transactions.length) {
        const tx = account.transactions[account.index];
        if (!(tx.date > date)) {
          if (isCredit(tx.type)) account.funds += tx.amount;
          else account.funds -= tx.amount;
          account.index++;
        } else break;
      }
    }
    // portfolio transactions
    while (this.portfolioTransactionIndex < this.portfolioTransactions.length) {
      const tx = this.portfolioTransactions[this.portfolioTransactionIndex];
      if (!(tx.date > date)) {
        const security = tx.security!;
        let s = this.securities.get(security);
        if (!s) {
          s = { security, prices: new PriceCursor(security), shares: 0, transactions: [] };
          this.securities.set(security, s);
        }
        s.transactions.push(tx);
        if (isPurchase(tx.type)) s.shares += tx.shares;
        else s.shares -= tx.shares;
        this.portfolioTransactionIndex++;
      } else break;
    }

    let valuation = 0;
    const term = this.converter.termCurrency;
    for (const position of this.accounts) {
      if (position.funds === 0) continue;
      if (term === position.currency) valuation += position.funds;
      else valuation += convertMoney(this.converter, date, money(position.currency, position.funds)).amount;
    }
    for (const position of this.securities.values()) {
      if (position.shares === 0) continue;
      let price = position.prices.getSecurityPrice(date);
      if (price.value === 0) {
        const last = position.transactions[position.transactions.length - 1];
        price = { date: last.date, value: grossPricePerShare(last, this.converter.with(position.security.currencyCode)) };
      }
      const value = marketValue(position.shares, price.value);
      if (term === position.security.currencyCode) valuation += value;
      else valuation += convertMoney(this.converter, date, money(position.security.currencyCode, value)).amount;
    }
    return valuation;
  }
}

export class PerformanceIndex {
  dates: LocalDate[] = [];
  totals: number[] = [];
  inboundTransferals: number[] = [];
  outboundTransferals: number[] = [];
  taxes: number[] = [];
  dividends: number[] = [];
  fees: number[] = [];
  interest: number[] = [];
  interestCharge: number[] = [];
  buys: number[] = [];
  sells: number[] = [];
  accumulated: number[] = [];
  delta: number[] = [];
  private drawdown: Drawdown | null = null;
  private volatility: Volatility | null = null;
  private performanceSnapshotFifo: ClientPerformanceSnapshot | null = null;
  private performanceSnapshotMovingAverage: ClientPerformanceSnapshot | null = null;
  warnings: string[] = [];

  constructor(
    readonly client: Client,
    readonly converter: CurrencyConverter,
    readonly reportInterval: Interval,
  ) {}

  /** factory for snapshots - set by clientPerformanceSnapshot.ts to avoid circular imports */
  static snapshotFactory: ((client: Client, converter: CurrencyConverter, interval: Interval, fifo: boolean) => ClientPerformanceSnapshot) | null = null;

  get currency(): string {
    return this.converter.termCurrency;
  }

  getActualInterval(): Interval {
    return Interval.of(this.dates[0], this.dates[this.dates.length - 1]);
  }

  getFirstHoldingInterval(): Interval {
    for (let ii = 0; ii < this.totals.length; ii++) {
      if (this.totals[ii] !== 0)
        return Interval.of(ii > 0 ? this.dates[ii - 1] : this.dates[ii], this.dates[this.dates.length - 1]);
    }
    const last = this.dates[this.dates.length - 1];
    return Interval.of(last, last);
  }

  getFinalAccumulatedPercentage(): number {
    return this.accumulated.length > 0 ? this.accumulated[this.accumulated.length - 1] : 0;
  }

  getFinalAccumulatedAnnualizedPercentage(): number {
    const p = this.getFinalAccumulatedPercentage();
    const days = this.getActualInterval().getDays();
    return Math.pow(1 + p, 365 / days) - 1;
  }

  getTransferals(): number[] {
    return this.inboundTransferals.map((v, i) => v - this.outboundTransferals[i]);
  }

  getDrawdown(): Drawdown {
    if (this.drawdown === null) {
      let startAt = 0;
      for (; startAt < this.totals.length; startAt++) if (this.totals[startAt] !== 0) break;
      if (startAt === this.totals.length) startAt = this.totals.length - 1;
      this.drawdown = new Drawdown(this.accumulated, this.dates, startAt);
    }
    return this.drawdown;
  }

  filterReturnsForVolatilityCalculation(): (index: number) => boolean {
    const calendar = getDefaultCalendar();
    return (index) =>
      index > 0 && this.totals[index] !== 0 && this.totals[index - 1] !== 0 && !calendar.isHoliday(this.dates[index]);
  }

  getVolatility(): Volatility {
    if (this.volatility === null) this.volatility = new Volatility(this.delta, this.filterReturnsForVolatilityCalculation());
    return this.volatility;
  }

  getClientPerformanceSnapshot(useFifo = true): ClientPerformanceSnapshot {
    const factory = PerformanceIndex.snapshotFactory;
    if (!factory) throw new Error('ClientPerformanceSnapshot not available');
    if (useFifo) {
      if (this.performanceSnapshotFifo === null)
        this.performanceSnapshotFifo = factory(this.client, this.converter, this.reportInterval, true);
      return this.performanceSnapshotFifo;
    }
    if (this.performanceSnapshotMovingAverage === null)
      this.performanceSnapshotMovingAverage = factory(this.client, this.converter, this.reportInterval, false);
    return this.performanceSnapshotMovingAverage;
  }

  getPerformanceIRR(): number {
    return this.getClientPerformanceSnapshot().getPerformanceIRR();
  }

  calculateAbsoluteInvestedCapital(): number[] {
    const term = this.converter.termCurrency;
    const conv = (currency: string, amount: number, date: LocalDate) =>
      currency === term ? amount : convertMoney(this.converter, date, money(currency, amount)).amount;
    let startValue = 0;
    const intervalStart = this.getActualInterval().start;
    for (const account of this.client.accounts)
      for (const t of account.transactions) {
        if ((t.type === 'DEPOSIT' || t.type === 'REMOVAL') && !(t.date > intervalStart))
          startValue += (t.type === 'DEPOSIT' ? 1 : -1) * conv(t.currencyCode, t.amount, t.date);
      }
    for (const portfolio of this.client.portfolios)
      for (const t of portfolio.transactions) {
        if ((t.type === 'DELIVERY_INBOUND' || t.type === 'DELIVERY_OUTBOUND') && !(t.date > intervalStart))
          startValue += (t.type === 'DELIVERY_INBOUND' ? 1 : -1) * conv(t.currencyCode, t.amount, t.date);
      }
    return this.calculateInvestedCapitalFrom(startValue);
  }

  calculateInvestedCapital(): number[] {
    return this.calculateInvestedCapitalFrom(this.totals[0]);
  }

  private calculateInvestedCapitalFrom(startValue: number): number[] {
    const investedCapital = new Array<number>(this.inboundTransferals.length);
    investedCapital[0] = startValue;
    let current = startValue;
    for (let ii = 1; ii < investedCapital.length; ii++)
      current = investedCapital[ii] = current + this.inboundTransferals[ii] - this.outboundTransferals[ii];
    return investedCapital;
  }

  calculateAbsoluteDelta(): number[] {
    return this.calculateInvestedCapitalDelta(this.calculateAbsoluteInvestedCapital());
  }

  calculateDelta(): number[] {
    return this.calculateInvestedCapitalDelta(this.calculateInvestedCapital());
  }

  private calculateInvestedCapitalDelta(investedCapital: number[]): number[] {
    return investedCapital.map((v, i) => this.totals[i] - v);
  }

  getFirstDataPoint(): LocalDate | null {
    for (let ii = 0; ii < this.totals.length; ii++) if (this.totals[ii] !== 0) return this.dates[ii];
    return null;
  }

  /** PerformanceIndex#getPerformance(Interval) */
  getPerformance(interval: Interval): number {
    const startIndex = binarySearch(this.dates, interval.start);
    const endIndex = binarySearch(this.dates, interval.end);
    if (startIndex < 0 && startIndex === endIndex) return 0;
    if (Math.abs(startIndex) > Math.abs(endIndex)) return 0;
    const startValue = this.accumulated[startIndex >= 0 ? startIndex : 0];
    const endValue = this.accumulated[endIndex >= 0 ? endIndex : this.dates.length - 1];
    return (endValue + 1) / (startValue + 1) - 1;
  }

  /** index of the given date (or -1) */
  indexOf(date: LocalDate): number {
    if (this.dates.length === 0) return -1;
    const i = date - this.dates[0];
    return i >= 0 && i < this.dates.length ? i : -1;
  }
}

export function binarySearch(dates: LocalDate[], key: LocalDate): number {
  let low = 0;
  let high = dates.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const v = dates[mid];
    if (v < key) low = mid + 1;
    else if (v > key) high = mid - 1;
    else return mid;
  }
  return -(low + 1);
}

/** ClientIndex: daily valuation and true time-weighted rate of return */
export class ClientIndex extends PerformanceIndex {
  calculate(): void {
    let interval = this.reportInterval;
    const now = today();
    if (interval.end > now) {
      let start = interval.start;
      const end = now;
      if (start > end) start = end;
      interval = Interval.of(start, end);
    }
    const size = Math.max(1, interval.getDays() + 1);
    const zeros = () => new Array<number>(size).fill(0);
    this.dates = new Array<LocalDate>(size);
    this.totals = zeros();
    this.delta = zeros();
    this.accumulated = zeros();
    this.inboundTransferals = zeros();
    this.outboundTransferals = zeros();
    this.taxes = zeros();
    this.dividends = zeros();
    this.interest = zeros();
    this.interestCharge = zeros();
    this.buys = zeros();
    this.sells = zeros();
    this.fees = zeros();

    this.collectTransferalsAndTaxes(interval);

    const snapshot = new ClientSnapshotIterator(this.client, this.converter);
    this.dates[0] = interval.start;
    this.delta[0] = 0;
    this.accumulated[0] = 0;
    let valuation = (this.totals[0] = snapshot.nextValuation(this.dates[0]));

    let index = 1;
    let date = interval.start + 1;
    while (date <= interval.end) {
      this.dates[index] = date;
      const thisValuation = (this.totals[index] = snapshot.nextValuation(date));
      if (valuation + this.inboundTransferals[index] === 0) {
        this.delta[index] = 0;
        const thisDelta = thisValuation - this.inboundTransferals[index] + this.outboundTransferals[index] - valuation;
        if (thisDelta !== 0) this.warnings.push(`Delta ohne Vermögen: ${thisDelta / 100} am Tag ${date}`);
      } else {
        this.delta[index] =
          (thisValuation + this.outboundTransferals[index]) / (valuation + this.inboundTransferals[index]) - 1;
      }
      this.accumulated[index] = (this.accumulated[index - 1] + 1) * (this.delta[index] + 1) - 1;
      date++;
      valuation = thisValuation;
      index++;
    }
  }

  private addValue(array: number[], currencyCode: string, value: number, interval: Interval, time: LocalDate): void {
    if (value === 0) return;
    const ii = Math.abs(time - interval.start);
    if (currencyCode !== this.converter.termCurrency)
      array[ii] += convertMoney(this.converter, time, money(currencyCode, value)).amount;
    else array[ii] += value;
  }

  private collectTransferalsAndTaxes(interval: Interval): void {
    for (const account of this.client.accounts) {
      for (const t of account.transactions) {
        const d = t.date;
        if (d < interval.start || d > interval.end) continue;
        switch (t.type) {
          case 'DEPOSIT':
            this.addValue(this.inboundTransferals, t.currencyCode, t.amount, interval, d);
            break;
          case 'REMOVAL':
            this.addValue(this.outboundTransferals, t.currencyCode, t.amount, interval, d);
            break;
          case 'TAXES':
            this.addValue(this.taxes, t.currencyCode, t.amount, interval, d);
            break;
          case 'TAX_REFUND':
            this.addValue(this.taxes, t.currencyCode, -t.amount, interval, d);
            break;
          case 'DIVIDENDS':
            this.addValue(this.taxes, t.currencyCode, t.getUnitSum('TAX').amount, interval, d);
            this.addValue(this.dividends, t.currencyCode, t.amount, interval, d);
            this.addValue(this.fees, t.currencyCode, t.getUnitSum('FEE').amount, interval, d);
            break;
          case 'INTEREST':
            this.addValue(this.taxes, t.currencyCode, t.getUnitSum('TAX').amount, interval, d);
            this.addValue(this.interest, t.currencyCode, t.amount, interval, d);
            break;
          case 'INTEREST_CHARGE':
            this.addValue(this.interest, t.currencyCode, -t.amount, interval, d);
            this.addValue(this.interestCharge, t.currencyCode, t.amount, interval, d);
            break;
          case 'FEES':
            this.addValue(this.fees, t.currencyCode, t.amount, interval, d);
            break;
          case 'FEES_REFUND':
            this.addValue(this.fees, t.currencyCode, -t.amount, interval, d);
            break;
          default:
            break;
        }
      }
    }
    for (const portfolio of this.client.portfolios) {
      for (const t of portfolio.transactions) {
        const d = t.date;
        if (d < interval.start || d > interval.end) continue;
        this.addValue(this.taxes, t.currencyCode, t.getUnitSum('TAX').amount, interval, d);
        this.addValue(this.fees, t.currencyCode, t.getUnitSum('FEE').amount, interval, d);
        switch (t.type) {
          case 'DELIVERY_INBOUND':
            this.addValue(this.inboundTransferals, t.currencyCode, t.amount, interval, d);
            break;
          case 'DELIVERY_OUTBOUND':
            this.addValue(this.outboundTransferals, t.currencyCode, t.amount, interval, d);
            break;
          case 'BUY':
            this.addValue(this.buys, t.currencyCode, t.amount, interval, d);
            break;
          case 'SELL':
            this.addValue(this.sells, t.currencyCode, t.amount, interval, d);
            break;
          default:
            break;
        }
      }
    }
  }
}

export function performanceIndexForClient(client: Client, converter: CurrencyConverter, reportInterval: Interval): PerformanceIndex {
  const index = new ClientIndex(client, converter, reportInterval);
  index.calculate();
  return index;
}
