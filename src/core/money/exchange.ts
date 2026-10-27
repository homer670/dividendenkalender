// Exchange rates and currency conversion (name.abuchen.portfolio.money.*)

import Decimal from 'decimal.js';
import { D, divScale, HALF_DOWN, toLong } from '../util/decimal';
import { LocalDate, LocalDateTime, ofYMD, toLocalDate, today } from '../util/dates';
import { Money, money, Quote, quote, Values } from './money';
import { CURRENCY_CODES } from './currencies';
import type { Client, Security } from '../model';

export interface ExchangeRate {
  readonly date: LocalDate;
  readonly value: Decimal;
}

export function inverseRate(rate: Decimal): Decimal {
  return divScale(1, rate, 10, HALF_DOWN);
}

export interface ExchangeRateTimeSeries {
  readonly baseCurrency: string;
  readonly termCurrency: string;
  readonly providerName: string;
  getRates(): ExchangeRate[];
  lookupRate(date: LocalDate): ExchangeRate | null;
  getWeight(): number;
  getLabel(): string;
  getComposition(): ExchangeRateTimeSeries[];
}

function binarySearchRate(rates: ExchangeRate[], date: LocalDate): number {
  let low = 0;
  let high = rates.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const d = rates[mid].date;
    if (d < date) low = mid + 1;
    else if (d > date) high = mid - 1;
    else return mid;
  }
  return -(low + 1);
}

/** ExchangeRateTimeSeriesImpl */
export class ExchangeRateTimeSeriesImpl implements ExchangeRateTimeSeries {
  private rates: ExchangeRate[] = [];

  constructor(
    readonly providerName: string,
    readonly baseCurrency: string,
    readonly termCurrency: string,
    rates?: ExchangeRate[],
  ) {
    if (rates) this.rates = rates.slice().sort((a, b) => a.date - b.date);
  }

  addRate(rate: ExchangeRate): void {
    const index = binarySearchRate(this.rates, rate.date);
    if (index < 0) this.rates.splice(~index, 0, rate);
    else this.rates[index] = rate;
  }

  getRates(): ExchangeRate[] {
    return this.rates.slice();
  }

  getLatest(): ExchangeRate | null {
    return this.rates.length === 0 ? null : this.rates[this.rates.length - 1];
  }

  lookupRate(date: LocalDate): ExchangeRate | null {
    const rates = this.rates;
    if (rates.length === 0) return null;
    const index = binarySearchRate(rates, date);
    if (index >= 0) return rates[index];
    if (index === -1) return rates[0];
    return rates[-index - 2];
  }

  getWeight(): number {
    return 2;
  }

  getLabel(): string {
    return `${this.baseCurrency}/${this.termCurrency}`;
  }

  getComposition(): ExchangeRateTimeSeries[] {
    return [];
  }
}

export class FixedExchangeRateTimeSeries implements ExchangeRateTimeSeries {
  constructor(
    readonly providerName: string,
    private readonly weight: number,
    private readonly rate: Decimal,
    readonly baseCurrency: string,
    readonly termCurrency: string,
    private readonly seriesStart: LocalDate = ofYMD(2000, 1, 1),
  ) {}
  getRates(): ExchangeRate[] {
    return [
      { date: this.seriesStart, value: this.rate },
      { date: today(), value: this.rate },
    ];
  }
  lookupRate(date: LocalDate): ExchangeRate | null {
    return { date, value: this.rate };
  }
  getWeight(): number {
    return this.weight;
  }
  getLabel(): string {
    return `${this.baseCurrency}/${this.termCurrency}`;
  }
  getComposition(): ExchangeRateTimeSeries[] {
    return [];
  }
}

export class InverseExchangeRateTimeSeries implements ExchangeRateTimeSeries {
  constructor(private readonly source: ExchangeRateTimeSeries) {}
  get baseCurrency(): string {
    return this.source.termCurrency;
  }
  get termCurrency(): string {
    return this.source.baseCurrency;
  }
  get providerName(): string {
    return 'Inverser Kurs: ' + this.source.providerName;
  }
  getRates(): ExchangeRate[] {
    return this.source.getRates().map((r) => ({ date: r.date, value: inverseRate(r.value) }));
  }
  lookupRate(date: LocalDate): ExchangeRate | null {
    const answer = this.source.lookupRate(date);
    if (answer === null) return null;
    return { date: answer.date, value: divScale(1, answer.value, 10, HALF_DOWN) };
  }
  getWeight(): number {
    return 2 + this.source.getWeight();
  }
  getLabel(): string {
    return `${this.baseCurrency}/${this.termCurrency}`;
  }
  getComposition(): ExchangeRateTimeSeries[] {
    return [this.source];
  }
}

export class ChainedExchangeRateTimeSeries implements ExchangeRateTimeSeries {
  constructor(private readonly series: ExchangeRateTimeSeries[]) {
    if (series.length === 0) throw new Error('empty chain');
  }
  get baseCurrency(): string {
    return this.series[0].baseCurrency;
  }
  get termCurrency(): string {
    return this.series[this.series.length - 1].termCurrency;
  }
  get providerName(): string {
    return '';
  }
  getRates(): ExchangeRate[] {
    throw new Error('UnsupportedOperation');
  }
  lookupRate(date: LocalDate): ExchangeRate | null {
    let value: Decimal = new D(1);
    for (const s of this.series) {
      const answer = s.lookupRate(date);
      if (answer === null) return null;
      value = value.mul(answer.value);
    }
    return { date, value };
  }
  getWeight(): number {
    let weight = 1;
    for (const s of this.series) weight += s.getWeight();
    return weight;
  }
  getLabel(): string {
    return `${this.baseCurrency}/${this.termCurrency}`;
  }
  getComposition(): ExchangeRateTimeSeries[] {
    return this.series.slice();
  }
}

export class EmptyExchangeRateTimeSeries implements ExchangeRateTimeSeries {
  readonly providerName = '';
  constructor(
    readonly baseCurrency: string,
    readonly termCurrency: string,
  ) {}
  getRates(): ExchangeRate[] {
    return [];
  }
  lookupRate(): ExchangeRate | null {
    return null;
  }
  getWeight(): number {
    return 0;
  }
  getLabel(): string {
    return `${this.baseCurrency}/${this.termCurrency}`;
  }
  getComposition(): ExchangeRateTimeSeries[] {
    return [];
  }
}

/** Series based on a security with a target currency (SecurityBasedExchangeRateProvider) */
export class SecurityBasedExchangeRate implements ExchangeRateTimeSeries {
  readonly providerName = 'Wertpapier';
  constructor(private readonly security: Security) {}
  get baseCurrency(): string {
    return this.security.currencyCode;
  }
  get termCurrency(): string {
    return this.security.targetCurrencyCode!;
  }
  getRates(): ExchangeRate[] {
    return this.security.getPricesIncludingLatest().map((p) => ({
      date: p.date,
      value: new D(String(p.value / Values.Quote.divider)),
    }));
  }
  lookupRate(date: LocalDate): ExchangeRate | null {
    const price = this.security.getSecurityPrice(date);
    if (price && price.value !== 0) return { date: price.date, value: new D(String(price.value / Values.Quote.divider)) };
    return null;
  }
  getWeight(): number {
    return 1;
  }
  getLabel(): string {
    return `${this.baseCurrency}/${this.termCurrency} (${this.security.name})`;
  }
  getComposition(): ExchangeRateTimeSeries[] {
    return [];
  }
}

export interface ExchangeRateProvider {
  readonly name: string;
  getAvailableTimeSeries(client: Client | null): ExchangeRateTimeSeries[];
}

export class FixedExchangeRateProvider implements ExchangeRateProvider {
  readonly name = '-';
  private cache: ExchangeRateTimeSeries[] | null = null;
  getAvailableTimeSeries(): ExchangeRateTimeSeries[] {
    if (this.cache) return this.cache;
    const d1999 = ofYMD(1999, 1, 1);
    const n = this.name;
    const s = (rate: string, base: string, term: string, start?: LocalDate) =>
      new FixedExchangeRateTimeSeries(n, 2, new D(rate), base, term, start ?? ofYMD(2000, 1, 1));
    this.cache = [
      s('13.7603', 'EUR', 'ATS', d1999),
      s('40.3399', 'EUR', 'BEF', d1999),
      s('1.95583', 'EUR', 'DEM', d1999),
      s('166.386', 'EUR', 'ESP', d1999),
      s('5.94573', 'EUR', 'FIM', d1999),
      s('6.55957', 'EUR', 'FRF', d1999),
      s('340.75', 'EUR', 'GRD', ofYMD(2000, 6, 20)),
      s('0.787564', 'EUR', 'IEP', d1999),
      s('1936.27', 'EUR', 'ITL', d1999),
      s('40.3399', 'EUR', 'LUF', d1999),
      s('2.20371', 'EUR', 'NLG', d1999),
      s('200.482', 'EUR', 'PTE', d1999),
      s('3.6725', 'USD', 'AED', ofYMD(1997, 11, 1)),
      s('0.01', 'GBX', 'GBP'),
      s('0.01', 'ILA', 'ILS'),
      s('0.01', 'ZAC', 'ZAR'),
    ];
    return this.cache;
  }
}

export class SecurityBasedExchangeRateProvider implements ExchangeRateProvider {
  readonly name = 'Wertpapiere';
  getAvailableTimeSeries(client: Client | null): ExchangeRateTimeSeries[] {
    if (!client) return [];
    return client.securities.filter((s) => s.isExchangeRate()).map((s) => new SecurityBasedExchangeRate(s));
  }
}

/** Provider for a list of EUR based series (ECB reference rates) */
export class StaticExchangeRateProvider implements ExchangeRateProvider {
  constructor(
    readonly name: string,
    private readonly series: ExchangeRateTimeSeries[],
  ) {}
  getAvailableTimeSeries(): ExchangeRateTimeSeries[] {
    return this.series;
  }
}

const CURRENCY_SET = new Set(CURRENCY_CODES);

/** ExchangeRateProviderFactory incl. shortest path search */
export class ExchangeRateProviderFactory {
  private readonly cache = new Map<string, ExchangeRateTimeSeries>();

  constructor(
    private readonly client: Client | null,
    private readonly providers: ExchangeRateProvider[],
  ) {}

  getAvailableTimeSeries(): ExchangeRateTimeSeries[] {
    const series: ExchangeRateTimeSeries[] = [];
    for (const p of this.providers) series.push(...p.getAvailableTimeSeries(this.client));
    return series;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getTimeSeries(baseCurrency: string, termCurrency: string): ExchangeRateTimeSeries {
    const key = baseCurrency + '/' + termCurrency;
    let s = this.cache.get(key);
    if (!s) {
      s = this.computeTimeSeries(baseCurrency, termCurrency);
      this.cache.set(key, s);
    }
    return s;
  }

  private computeTimeSeries(baseCurrency: string, termCurrency: string): ExchangeRateTimeSeries {
    const path = this.findShortestPath(baseCurrency, termCurrency);
    if (path.length === 0) return new EmptyExchangeRateTimeSeries(baseCurrency, termCurrency);
    if (path.length === 1) return path[0];
    return new ChainedExchangeRateTimeSeries(path);
  }

  private findShortestPath(baseCurrency: string, termCurrency: string): ExchangeRateTimeSeries[] {
    if (!CURRENCY_SET.has(baseCurrency)) return [];
    const timeSeries: ExchangeRateTimeSeries[] = [];
    for (const ts of this.getAvailableTimeSeries()) {
      timeSeries.push(ts);
      timeSeries.push(new InverseExchangeRateTimeSeries(ts));
    }
    const byBase = new Map<string, ExchangeRateTimeSeries[]>();
    for (const ts of timeSeries) {
      let list = byBase.get(ts.baseCurrency);
      if (!list) byBase.set(ts.baseCurrency, (list = []));
      list.push(ts);
    }
    const distance = new Map<string, number>([[baseCurrency, 0]]);
    const predecessors = new Map<string, ExchangeRateTimeSeries>();
    const visited = new Set<string>();
    const unvisited = new Set<string>(CURRENCY_CODES);
    const dist = (c: string) => distance.get(c) ?? Number.MAX_SAFE_INTEGER;

    while (unvisited.size > 0) {
      let node: string | null = null;
      let best = Number.MAX_SAFE_INTEGER + 1;
      for (const c of unvisited) {
        const d = dist(c);
        if (d < best) {
          best = d;
          node = c;
        }
      }
      if (node === null) break;
      unvisited.delete(node);
      visited.add(node);
      if (dist(node) === Number.MAX_SAFE_INTEGER) break; // all remaining nodes are unreachable
      for (const neighbor of byBase.get(node) ?? []) {
        if (visited.has(neighbor.termCurrency)) continue;
        const alternative = dist(node) + neighbor.getWeight();
        if (alternative < dist(neighbor.termCurrency)) {
          distance.set(neighbor.termCurrency, alternative);
          predecessors.set(neighbor.termCurrency, neighbor);
        }
      }
    }

    const answer: ExchangeRateTimeSeries[] = [];
    let current = predecessors.get(termCurrency);
    const guard = new Set<ExchangeRateTimeSeries>();
    while (current && !guard.has(current)) {
      guard.add(current);
      answer.unshift(current);
      current = predecessors.get(current.baseCurrency);
    }
    return answer;
  }
}

const ONE = new D(1);

export interface CurrencyConverter {
  readonly termCurrency: string;
  getRate(date: LocalDate, currencyCode: string): ExchangeRate;
  with(currencyCode: string): CurrencyConverter;
}

export class CurrencyConverterImpl implements CurrencyConverter {
  constructor(
    readonly factory: ExchangeRateProviderFactory,
    readonly termCurrency: string,
  ) {}

  getRate(date: LocalDate, currencyCode: string): ExchangeRate {
    if (this.termCurrency === currencyCode) return { date, value: ONE };
    const series = this.factory.getTimeSeries(currencyCode, this.termCurrency);
    return series.lookupRate(date) ?? { date: today(), value: ONE };
  }

  with(currencyCode: string): CurrencyConverter {
    if (currencyCode === this.termCurrency) return this;
    return new CurrencyConverterImpl(this.factory, currencyCode);
  }
}

/** CurrencyConverter#convert(LocalDate, Money) */
export function convertMoney(converter: CurrencyConverter, date: LocalDate, amount: Money): Money {
  const termCurrency = converter.termCurrency;
  if (termCurrency === amount.currencyCode) return amount;
  if (amount.amount === 0) return money(termCurrency, 0);
  const rate = converter.getRate(date, amount.currencyCode);
  return money(termCurrency, toLong(rate.value.mul(amount.amount), HALF_DOWN));
}

export function convertMoneyAt(converter: CurrencyConverter, dateTime: LocalDateTime, amount: Money): Money {
  return convertMoney(converter, toLocalDate(dateTime), amount);
}

export function convertQuote(converter: CurrencyConverter, date: LocalDate, q: Quote): Quote {
  const termCurrency = converter.termCurrency;
  if (termCurrency === q.currencyCode) return q;
  if (q.amount === 0) return quote(termCurrency, 0);
  const rate = converter.getRate(date, q.currencyCode);
  return quote(termCurrency, toLong(rate.value.mul(q.amount), HALF_DOWN));
}

/** ClientSnapshotIterator.SameDayRateConverter */
export class SameDayRateConverter implements CurrencyConverter {
  private readonly rates = new Map<string, ExchangeRate>();
  private date: LocalDate | null = null;
  constructor(private readonly delegate: CurrencyConverter) {}
  get termCurrency(): string {
    return this.delegate.termCurrency;
  }
  getRate(requestedDate: LocalDate, currencyCode: string): ExchangeRate {
    if (requestedDate !== this.date) {
      this.rates.clear();
      this.date = requestedDate;
    }
    let rate = this.rates.get(currencyCode);
    if (!rate) {
      rate = this.delegate.getRate(requestedDate, currencyCode);
      this.rates.set(currencyCode, rate);
    }
    return rate;
  }
  with(currencyCode: string): CurrencyConverter {
    return this.delegate.with(currencyCode);
  }
}

/** Parse the ECB "eurofxref-hist.csv" file into EUR based series */
export function parseECBHistoryCSV(csv: string): ExchangeRateTimeSeries[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  const columns: { index: number; series: ExchangeRateTimeSeriesImpl; rates: ExchangeRate[] }[] = [];
  for (let i = 1; i < header.length; i++) {
    const code = header[i];
    if (!/^[A-Z]{3}$/.test(code)) continue;
    columns.push({ index: i, series: new ExchangeRateTimeSeriesImpl('EZB', 'EUR', code), rates: [] });
  }
  for (let li = 1; li < lines.length; li++) {
    const cells = lines[li].split(',');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cells[0].trim());
    if (!m) continue;
    const date = ofYMD(+m[1], +m[2], +m[3]);
    for (const c of columns) {
      const v = (cells[c.index] ?? '').trim();
      if (!v || v === 'N/A') continue;
      c.rates.push({ date, value: new D(v) });
    }
  }
  return columns
    .filter((c) => c.rates.length > 0)
    .map((c) => new ExchangeRateTimeSeriesImpl('EZB', 'EUR', c.series.termCurrency, c.rates));
}
