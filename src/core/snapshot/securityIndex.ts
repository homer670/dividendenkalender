// SecurityIndex (benchmark), Aggregation, AllTimeHigh

import { Security, SecurityPrice } from '../model';
import { CurrencyConverter, convertMoney } from '../money/exchange';
import { money, Values } from '../money/money';
import { calculateIRR } from '../math/irr';
import { dayOfWeek, LocalDate, ofYMD, plusMonths, plusYears, toYMD, firstDayOfMonth } from '../util/dates';
import { Interval } from '../util/interval';
import { PerformanceIndex } from './performanceIndex';

export class SecurityIndex extends PerformanceIndex {
  constructor(
    private readonly clientIndex: PerformanceIndex,
    private readonly security: Security,
  ) {
    super(clientIndex.client, clientIndex.converter, clientIndex.reportInterval);
  }

  calculate(): void {
    let prices: SecurityPrice[] = this.security.prices;
    if (prices.length === 0) return this.initEmpty();
    prices = this.security.getPricesIncludingLatest();
    const actualInterval = this.clientIndex.getActualInterval();
    const firstPricePoint = prices[0].date;
    if (firstPricePoint > actualInterval.end) return this.initEmpty();
    let startDate = this.clientIndex.getFirstDataPoint() ?? actualInterval.end;
    if (startDate > actualInterval.start) startDate = startDate - 1;
    if (firstPricePoint > startDate) startDate = firstPricePoint;
    let endDate = actualInterval.end;
    const lastPricePoint = prices[prices.length - 1].date;
    if (lastPricePoint < endDate) endDate = lastPricePoint;
    const size = endDate - startDate + 1;
    if (size <= 0) return this.initEmpty();
    const converter: CurrencyConverter | null =
      this.security.currencyCode != null && this.security.currencyCode !== this.clientIndex.converter.termCurrency
        ? this.clientIndex.converter
        : null;
    this.dates = new Array(size);
    this.delta = new Array(size).fill(0);
    this.accumulated = new Array(size).fill(0);
    this.inboundTransferals = new Array(size).fill(0);
    this.outboundTransferals = new Array(size).fill(0);
    this.totals = new Array(size).fill(0);
    const adjustment = this.clientIndex.accumulated[Math.abs(startDate - actualInterval.start)];
    this.dates[0] = startDate;
    this.delta[0] = 0;
    this.accumulated[0] = adjustment;
    let valuation = (this.totals[0] = this.convert(converter, startDate));
    let index = 1;
    for (let date = startDate + 1; date <= endDate; date++) {
      this.dates[index] = date;
      const thisValuation = (this.totals[index] = this.convert(converter, date));
      const thisDelta = thisValuation - valuation;
      this.delta[index] = thisDelta / valuation;
      this.accumulated[index] = (this.accumulated[index - 1] + 1 - adjustment) * (this.delta[index] + 1) - 1 + adjustment;
      valuation = thisValuation;
      index++;
    }
  }

  private convert(converter: CurrencyConverter | null, date: LocalDate): number {
    const price = this.security.getSecurityPrice(date);
    if (converter === null) return price.value;
    return convertMoney(converter, date, money(this.security.currencyCode, price.value)).amount;
  }

  private initEmpty(): void {
    const startDate = this.clientIndex.getFirstDataPoint() ?? this.clientIndex.getActualInterval().start;
    this.dates = [startDate];
    this.delta = [0];
    this.accumulated = [0];
    this.inboundTransferals = [0];
    this.outboundTransferals = [0];
    this.totals = [0];
  }

  override getPerformanceIRR(): number {
    const prices = this.security.getPricesIncludingLatest();
    if (prices.length === 0) return 0;
    let start = this.reportInterval.start;
    const end = this.reportInterval.end;
    if (prices[0].date > end) return 0;
    if (prices[0].date > start) start = prices[0].date;
    const currency = this.security.currencyCode == null ? this.client.baseCurrency : this.security.currencyCode;
    const dates = [start, end];
    const values = [
      -convertMoney(this.converter, start, money(currency, this.security.getSecurityPrice(start).value)).amount / Values.Amount.divider,
      convertMoney(this.converter, end, money(currency, this.security.getSecurityPrice(end).value)).amount / Values.Amount.divider,
    ];
    return calculateIRR(dates, values);
  }
}

export function performanceIndexForSecurity(clientIndex: PerformanceIndex, security: Security): PerformanceIndex {
  const index = new SecurityIndex(clientIndex, security);
  index.calculate();
  return index;
}

export type AggregationPeriod = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

function startDateFor(period: AggregationPeriod, d: LocalDate): LocalDate {
  switch (period) {
    case 'WEEKLY':
      // WeekFields.of(Locale.GERMANY).dayOfWeek() == 1 is Monday
      return d - (dayOfWeek(d) - 1);
    case 'MONTHLY':
      return firstDayOfMonth(d);
    case 'QUARTERLY': {
      const ymd = toYMD(d);
      return ofYMD(ymd.year, Math.floor((ymd.month - 1) / 3) * 3 + 1, 1);
    }
    case 'YEARLY':
      return ofYMD(toYMD(d).year, 1, 1);
  }
}

function plusPeriod(period: AggregationPeriod, d: LocalDate): LocalDate {
  switch (period) {
    case 'WEEKLY':
      return d + 7;
    case 'MONTHLY':
      return plusMonths(d, 1);
    case 'QUARTERLY':
      return plusMonths(d, 3);
    case 'YEARLY':
      return plusYears(d, 1);
  }
}

/** Aggregation#aggregate */
export function aggregate(index: PerformanceIndex, period: AggregationPeriod): PerformanceIndex {
  const { dates, accumulated, delta, inboundTransferals, outboundTransferals, totals } = index;
  let start = plusPeriod(period, startDateFor(period, dates[0]));
  let kill = start - 1;
  const answer = new PerformanceIndex(index.client, index.converter, index.reportInterval);
  let d = 0;
  let inT = 0;
  let outT = 0;
  for (let ii = 0; ii < dates.length; ii++) {
    const current = dates[ii];
    d = (d + 1) * (delta[ii] + 1) - 1;
    inT += inboundTransferals[ii];
    outT += outboundTransferals[ii];
    if (current === kill || ii === dates.length - 1) {
      answer.dates.push(current);
      answer.accumulated.push(accumulated[ii]);
      answer.delta.push(d);
      answer.inboundTransferals.push(inT);
      answer.outboundTransferals.push(outT);
      answer.totals.push(totals[ii]);
      d = 0;
      inT = 0;
      outT = 0;
      start = plusPeriod(period, start);
      kill = start - 1;
    }
  }
  return answer;
}

export class AllTimeHigh {
  value: number | null = null;
  low: number | null = null;
  date: LocalDate | null = null;
  lowDate: LocalDate | null = null;
  distance: number | null = null;
  relLowDistance: number | null = null;

  constructor(security: Security | null, interval: Interval) {
    if (!security) return;
    let max: SecurityPrice | null = null;
    let min: SecurityPrice | null = null;
    for (const p of security.getPricesIncludingLatest()) {
      if (!interval.contains(p.date)) continue;
      // Stream#max and Stream#min keep the first of equal elements
      if (max === null || p.value > max.value) max = p;
      if (min === null || p.value < min.value) min = p;
    }
    if (max === null || min === null) return;
    const latest = security.getSecurityPrice(interval.end);
    this.value = max.value;
    this.date = max.date;
    this.low = min.value;
    this.lowDate = min.date;
    this.distance = (latest.value - max.value) / max.value;
    this.relLowDistance = (latest.value - min.value) / (max.value - min.value);
  }
}
