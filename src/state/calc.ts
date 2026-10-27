// Calculation context shared by all views (DashboardData, ClientInput)

import { Client } from '../core/model';
import {
  CurrencyConverter,
  CurrencyConverterImpl,
  ExchangeRateProviderFactory,
  ExchangeRateTimeSeries,
  FixedExchangeRateProvider,
  SecurityBasedExchangeRateProvider,
  StaticExchangeRateProvider,
} from '../core/money/exchange';
import '../core/snapshot/clientPerformanceSnapshot';
import { LastX, ReportingPeriod } from '../core/snapshot/reportingPeriod';
import { buildClientFilterItems, ClientFilterItem } from './clientFilters';
import { DataSeries, DataSeriesCache, DataSeriesSet, UseCase } from './dataSeries';
import { Interval } from '../core/util/interval';
import { PerformanceIndex } from '../core/snapshot/performanceIndex';

export const REPORTING_PERIODS_SET = 'reporting-periods';

export class CalcContext {
  readonly factory: ExchangeRateProviderFactory;
  readonly converter: CurrencyConverter;
  readonly filterItems: ClientFilterItem[];
  readonly dataSeriesCache: DataSeriesCache;
  private readonly sets = new Map<UseCase, DataSeriesSet>();
  private readonly memo = new Map<string, unknown>();
  private readonly filteredClients = new Map<string, Client>();
  private readonly filteredCaches = new Map<string, DataSeriesCache>();

  constructor(
    readonly client: Client,
    ecbSeries: ExchangeRateTimeSeries[],
  ) {
    this.factory = new ExchangeRateProviderFactory(client, [
      new StaticExchangeRateProvider('Europäische Zentralbank', ecbSeries),
      new FixedExchangeRateProvider(),
      new SecurityBasedExchangeRateProvider(),
    ]);
    this.converter = new CurrencyConverterImpl(this.factory, client.baseCurrency);
    this.filterItems = buildClientFilterItems(client);
    this.dataSeriesCache = new DataSeriesCache(client, this.converter);
  }

  get termCurrency(): string {
    return this.converter.termCurrency;
  }

  dataSeriesSet(useCase: UseCase): DataSeriesSet {
    let set = this.sets.get(useCase);
    if (!set) this.sets.set(useCase, (set = new DataSeriesSet(this.client, this.filterItems, useCase)));
    return set;
  }

  calculate(series: DataSeries, interval: Interval): PerformanceIndex {
    return this.dataSeriesCache.lookup(series, interval);
  }

  /** generic cache for expensive calculations of the current file */
  cached<T>(key: string, fn: () => T): T {
    if (this.memo.has(key)) return this.memo.get(key) as T;
    const value = fn();
    this.memo.set(key, value);
    return value;
  }

  filterItem(id: string | null | undefined): ClientFilterItem {
    return this.filterItems.find((i) => i.id === (id ?? '')) ?? this.filterItems[0];
  }

  /** the client after applying the given client filter */
  filteredClient(filterId: string | null | undefined): Client {
    const item = this.filterItem(filterId);
    if (item.id === '') return this.client;
    let c = this.filteredClients.get(item.id);
    if (!c) this.filteredClients.set(item.id, (c = item.filter.filter(this.client)));
    return c;
  }

  /** a data series cache for the filtered client (used by views with a client filter) */
  filteredCache(filterId: string | null | undefined): DataSeriesCache {
    const item = this.filterItem(filterId);
    if (item.id === '') return this.dataSeriesCache;
    let c = this.filteredCaches.get(item.id);
    if (!c) this.filteredCaches.set(item.id, (c = new DataSeriesCache(this.filteredClient(item.id), this.converter)));
    return c;
  }

  /** ReportingPeriods: configured in the file or L1Y0, L2Y0, L3Y0 */
  reportingPeriods(): ReportingPeriod[] {
    return this.cached('reportingPeriods', () => {
      const periods: ReportingPeriod[] = [];
      for (const c of this.client.settings.configurationSets.get(REPORTING_PERIODS_SET) ?? []) {
        const p = ReportingPeriod.tryFrom(c.data);
        if (p && !periods.some((x) => x.equals(p))) periods.push(p);
      }
      if (periods.length === 0) for (let i = 1; i <= 3; i++) periods.push(new LastX(i, 0));
      return periods;
    });
  }
}
