// DataSeries, DataSeriesSet and DataSeriesCache (name.abuchen.portfolio.ui.views.dataseries)

import { Account, Classification, Client, Portfolio, Security, Taxonomy } from '../core/model';
import { CurrencyConverter } from '../core/money/exchange';
import { ClientClassificationFilter, ClientSecurityFilter, PortfolioClientFilter, WithoutTaxesFilter } from '../core/snapshot/filters';
import { PerformanceIndex, performanceIndexForClient } from '../core/snapshot/performanceIndex';
import { performanceIndexForSecurity } from '../core/snapshot/securityIndex';
import { Interval } from '../core/util/interval';
import { ClientFilterItem } from './clientFilters';

export type ClientDataSeries =
  | 'TOTALS'
  | 'TRANSFERALS'
  | 'TRANSFERALS_ACCUMULATED'
  | 'INVESTED_CAPITAL'
  | 'ABSOLUTE_INVESTED_CAPITAL'
  | 'ABSOLUTE_DELTA'
  | 'ABSOLUTE_DELTA_ALL_RECORDS'
  | 'DIVIDENDS'
  | 'DIVIDENDS_ACCUMULATED'
  | 'INTEREST'
  | 'INTEREST_ACCUMULATED'
  | 'INTEREST_CHARGE'
  | 'INTEREST_CHARGE_ACCUMULATED'
  | 'EARNINGS'
  | 'EARNINGS_ACCUMULATED'
  | 'FEES'
  | 'FEES_ACCUMULATED'
  | 'TAXES'
  | 'TAXES_ACCUMULATED'
  | 'DELTA_PERCENTAGE';

export const CLIENT_DATA_SERIES_LABELS: Record<ClientDataSeries, string> = {
  TOTALS: 'Gesamtsumme',
  TRANSFERALS: 'Einlagen/Entnahmen',
  TRANSFERALS_ACCUMULATED: 'Kumulierte Einlagen/Entnahmen',
  INVESTED_CAPITAL: 'Investiertes Kapital',
  ABSOLUTE_INVESTED_CAPITAL: 'Absolut investiertes Kapital',
  ABSOLUTE_DELTA: 'Delta',
  ABSOLUTE_DELTA_ALL_RECORDS: 'Absolutes Delta',
  DIVIDENDS: 'Dividenden',
  DIVIDENDS_ACCUMULATED: 'Kumulierte Dividenden',
  INTEREST: 'Zinsen',
  INTEREST_ACCUMULATED: 'Kumulierte Zinsen',
  INTEREST_CHARGE: 'Zinsbelastung',
  INTEREST_CHARGE_ACCUMULATED: 'Kumulierte Zinsbelastung',
  EARNINGS: 'Erträge',
  EARNINGS_ACCUMULATED: 'Kumulierte Erträge',
  FEES: 'Gebühren',
  FEES_ACCUMULATED: 'Kumulierte Gebühren',
  TAXES: 'Steuern',
  TAXES_ACCUMULATED: 'Kumulierte Steuern',
  DELTA_PERCENTAGE: 'täglich',
};

const CLIENT_DATA_SERIES_ORDER = Object.keys(CLIENT_DATA_SERIES_LABELS) as ClientDataSeries[];

export type DataSeriesType =
  | 'CLIENT'
  | 'CLIENT_PRETAX'
  | 'SECURITY'
  | 'SECURITY_BENCHMARK'
  | 'ACCOUNT'
  | 'ACCOUNT_PRETAX'
  | 'PORTFOLIO'
  | 'DERIVED_DATA_SERIES'
  | 'PORTFOLIO_PRETAX'
  | 'PORTFOLIO_PLUS_ACCOUNT'
  | 'PORTFOLIO_PLUS_ACCOUNT_PRETAX'
  | 'CLASSIFICATION'
  | 'CLIENT_FILTER'
  | 'CLIENT_FILTER_PRETAX';

export interface DerivedDataSeries {
  base: DataSeries;
  aspect: ClientDataSeries;
}

export type DataSeriesInstance = ClientDataSeries | Security | Account | Portfolio | Classification | ClientFilterItem | DerivedDataSeries;

/** special color token that is resolved to the text color of the theme (PP uses black) */
export const COLOR_TEXT = 'text';

export interface DataSeries {
  type: DataSeriesType;
  instance: DataSeriesInstance;
  label: string;
  color: string;
  uuid: string;
  group: Taxonomy | DataSeries | null;
  isBenchmark: boolean;
  isLineChart: boolean;
  showArea: boolean;
}

const UUID_PREFIX: Record<DataSeriesType, string> = {
  CLIENT: 'Client-',
  CLIENT_PRETAX: 'Client-PreTax-',
  SECURITY: 'Security',
  SECURITY_BENCHMARK: '[b]Security',
  ACCOUNT: 'Account',
  ACCOUNT_PRETAX: 'Account-PreTax',
  PORTFOLIO: 'Portfolio',
  DERIVED_DATA_SERIES: 'Derived-',
  PORTFOLIO_PRETAX: 'Portfolio-PreTax',
  PORTFOLIO_PLUS_ACCOUNT: '[+]Portfolio',
  PORTFOLIO_PLUS_ACCOUNT_PRETAX: '[+]Portfolio-PreTax',
  CLASSIFICATION: 'Classification',
  CLIENT_FILTER: 'ClientFilter',
  CLIENT_FILTER_PRETAX: 'ClientFilter-PreTax',
};

function instanceId(type: DataSeriesType, instance: DataSeriesInstance): string {
  switch (type) {
    case 'CLIENT':
    case 'CLIENT_PRETAX':
      return (instance as ClientDataSeries).toLowerCase();
    case 'CLASSIFICATION':
      return (instance as Classification).id;
    case 'CLIENT_FILTER':
    case 'CLIENT_FILTER_PRETAX':
      return (instance as ClientFilterItem).id;
    case 'DERIVED_DATA_SERIES': {
      const d = instance as DerivedDataSeries;
      return `${d.aspect}-${d.base.uuid}`;
    }
    default:
      return (instance as Security | Account | Portfolio).uuid;
  }
}

function makeSeries(
  type: DataSeriesType,
  instance: DataSeriesInstance,
  label: string,
  color: string,
  options: Partial<Pick<DataSeries, 'group' | 'isBenchmark' | 'isLineChart' | 'showArea'>> = {},
): DataSeries {
  return {
    type,
    instance,
    label,
    color,
    uuid: UUID_PREFIX[type] + instanceId(type, instance),
    group: options.group ?? null,
    isBenchmark: options.isBenchmark ?? false,
    isLineChart: options.isLineChart ?? true,
    showArea: options.showArea ?? false,
  };
}

/** ColorWheel: HSB colors around the circle */
export class ColorWheel {
  private index = 0;
  constructor(private readonly size: number) {}
  next(): string {
    const step = 360 / this.size;
    const hue = (262.3 + step * (this.index++ % this.size)) % 360;
    return hsbToHex(hue, 0.464, 0.886);
  }
}

export function hsbToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export type UseCase = 'STATEMENT_OF_ASSETS' | 'PERFORMANCE' | 'RETURN_VOLATILITY';

const C = {
  totals: COLOR_TEXT,
  investedCapital: '#EBC934',
  transferals: '#505050',
  transferalsAccumulated: '#E6C700',
  taxes: '#D13B3B',
  absoluteDelta: '#2F5FD0',
  dividends: '#8B008B',
  interest: '#2E7D32',
  earnings: '#2E7D32',
  fees: '#909090',
  performancePositive: '#2E7D32',
};

export class DataSeriesSet {
  readonly availableSeries: DataSeries[] = [];
  readonly availableDerivedSeries: DataSeries[] = [];

  constructor(
    client: Client,
    filterItems: ClientFilterItem[],
    readonly useCase: UseCase,
  ) {
    const wheel = new ColorWheel(30);
    switch (useCase) {
      case 'STATEMENT_OF_ASSETS':
        this.buildStatementOfAssets();
        break;
      case 'PERFORMANCE':
        this.buildPerformance(client, filterItems, wheel);
        break;
      case 'RETURN_VOLATILITY':
        this.buildReturnVolatility(client, filterItems, wheel);
        break;
    }
    this.buildCommon(client, filterItems, wheel);
    if (useCase === 'STATEMENT_OF_ASSETS') this.buildDerived(wheel);
  }

  lookup(uuid: string | null | undefined): DataSeries | null {
    if (!uuid) return null;
    return this.availableSeries.find((d) => d.uuid === uuid) ?? this.availableDerivedSeries.find((d) => d.uuid === uuid) ?? null;
  }

  /** the default data series (entire portfolio) */
  defaultSeries(): DataSeries {
    return this.availableSeries.find((d) => d.type === 'CLIENT')!;
  }

  private buildStatementOfAssets(): void {
    const add = (aspect: ClientDataSeries, color: string, o: { bar?: boolean; area?: boolean } = {}) =>
      this.availableSeries.push(
        makeSeries('CLIENT', aspect, CLIENT_DATA_SERIES_LABELS[aspect], color, { isLineChart: !o.bar, showArea: !!o.area }),
      );
    add('TOTALS', C.totals);
    add('TRANSFERALS', C.transferals, { bar: true });
    add('TRANSFERALS_ACCUMULATED', C.transferalsAccumulated, { area: true });
    add('INVESTED_CAPITAL', C.investedCapital, { area: true });
    add('ABSOLUTE_INVESTED_CAPITAL', C.investedCapital, { area: true });
    add('ABSOLUTE_DELTA', C.absoluteDelta);
    add('ABSOLUTE_DELTA_ALL_RECORDS', C.absoluteDelta);
    add('TAXES', C.taxes, { bar: true });
    add('TAXES_ACCUMULATED', C.taxes);
    add('DIVIDENDS', C.dividends, { bar: true });
    add('DIVIDENDS_ACCUMULATED', C.dividends);
    add('INTEREST', C.interest, { bar: true });
    add('INTEREST_ACCUMULATED', C.interest);
    add('INTEREST_CHARGE', C.interest, { bar: true });
    add('INTEREST_CHARGE_ACCUMULATED', C.interest);
    add('EARNINGS', C.earnings, { bar: true });
    add('EARNINGS_ACCUMULATED', C.earnings);
    add('FEES', C.fees, { bar: true });
    add('FEES_ACCUMULATED', C.fees);
  }

  private buildPerformance(client: Client, filterItems: ClientFilterItem[], wheel: ColorWheel): void {
    this.availableSeries.push(makeSeries('CLIENT', 'TOTALS', 'Gesamtportfolio', C.totals));
    this.availableSeries.push(makeSeries('CLIENT', 'DELTA_PERCENTAGE', 'täglich', C.performancePositive, { isLineChart: false }));
    for (const security of client.securities)
      this.availableSeries.push(makeSeries('SECURITY_BENCHMARK', security, security.name, wheel.next(), { isBenchmark: true }));
    this.buildPreTax(client, filterItems, wheel);
  }

  private buildReturnVolatility(client: Client, filterItems: ClientFilterItem[], wheel: ColorWheel): void {
    this.availableSeries.push(makeSeries('CLIENT', 'TOTALS', 'Gesamtportfolio', C.totals));
    for (const security of client.securities)
      this.availableSeries.push(makeSeries('SECURITY_BENCHMARK', security, security.name, wheel.next(), { isBenchmark: true }));
    this.buildPreTax(client, filterItems, wheel);
  }

  private buildPreTax(client: Client, filterItems: ClientFilterItem[], wheel: ColorWheel): void {
    this.availableSeries.push(makeSeries('CLIENT_PRETAX', 'TOTALS', 'Gesamtportfolio (vor Steuern)', wheel.next()));
    for (const p of client.portfolios) this.availableSeries.push(makeSeries('PORTFOLIO_PRETAX', p, `${p.name} (vor Steuern)`, wheel.next()));
    for (const p of client.portfolios)
      this.availableSeries.push(
        makeSeries('PORTFOLIO_PLUS_ACCOUNT_PRETAX', p, `${p.name} + ${p.referenceAccount?.name ?? ''} (vor Steuern)`, wheel.next()),
      );
    for (const a of client.accounts) this.availableSeries.push(makeSeries('ACCOUNT_PRETAX', a, `${a.name} (vor Steuern)`, wheel.next()));
    this.addCustomFilters(filterItems, true, wheel);
  }

  private addCustomFilters(filterItems: ClientFilterItem[], preTax: boolean, wheel: ColorWheel): void {
    for (const item of filterItems.filter((i) => i.custom))
      this.availableSeries.push(
        makeSeries(preTax ? 'CLIENT_FILTER_PRETAX' : 'CLIENT_FILTER', item, preTax ? `${item.label} (vor Steuern)` : item.label, wheel.next()),
      );
  }

  private buildCommon(client: Client, filterItems: ClientFilterItem[], wheel: ColorWheel): void {
    for (const security of client.securities) {
      if (security.currencyCode == null) continue;
      this.availableSeries.push(makeSeries('SECURITY', security, security.name, wheel.next()));
    }
    for (const p of client.portfolios) this.availableSeries.push(makeSeries('PORTFOLIO', p, p.name, wheel.next()));
    for (const p of client.portfolios)
      this.availableSeries.push(makeSeries('PORTFOLIO_PLUS_ACCOUNT', p, `${p.name} + ${p.referenceAccount?.name ?? ''}`, wheel.next()));
    this.addCustomFilters(filterItems, false, wheel);
    for (const a of client.accounts) this.availableSeries.push(makeSeries('ACCOUNT', a, a.name, wheel.next()));
    for (const taxonomy of client.taxonomies) {
      taxonomy.foreach({
        visitClassification: (c) => {
          if (c.parent === null) return;
          this.availableSeries.push(makeSeries('CLASSIFICATION', c, c.name, c.color || '#999999', { group: taxonomy }));
        },
      });
    }
  }

  private buildDerived(wheel: ColorWheel): void {
    const interestTypes = new Set<ClientDataSeries>(['INTEREST', 'INTEREST_ACCUMULATED', 'INTEREST_CHARGE', 'INTEREST_CHARGE_ACCUMULATED']);
    const barTypes = new Set<ClientDataSeries>(['DIVIDENDS', 'EARNINGS', 'FEES', 'INTEREST', 'INTEREST_CHARGE', 'TAXES', 'TRANSFERALS']);
    const areaTypes = new Set<ClientDataSeries>(['ABSOLUTE_INVESTED_CAPITAL', 'INVESTED_CAPITAL', 'TRANSFERALS_ACCUMULATED']);
    for (const base of this.availableSeries) {
      if (base.type === 'CLIENT') continue;
      for (const aspect of CLIENT_DATA_SERIES_ORDER) {
        if (aspect === 'TOTALS' || aspect === 'DELTA_PERCENTAGE') continue;
        if ((base.type === 'SECURITY' || base.type === 'PORTFOLIO') && interestTypes.has(aspect)) continue;
        this.availableDerivedSeries.push(
          makeSeries('DERIVED_DATA_SERIES', { base, aspect }, `${CLIENT_DATA_SERIES_LABELS[aspect]}: ${base.label}`, wheel.next(), {
            group: base.group,
            isLineChart: !barTypes.has(aspect),
            showArea: areaTypes.has(aspect),
          }),
        );
      }
    }
  }
}

const CLIENT_SERIES: DataSeries = makeSeries('CLIENT', 'TOTALS', 'Gesamtportfolio', COLOR_TEXT);

/** DataSeriesCache: one PerformanceIndex per data series and interval */
export class DataSeriesCache {
  private readonly cache = new Map<string, PerformanceIndex>();
  private withoutTaxes: Client | null = null;

  constructor(
    private readonly client: Client,
    private readonly converter: CurrencyConverter,
  ) {}

  lookup(series: DataSeries, interval: Interval): PerformanceIndex {
    const uuid = series.type === 'CLIENT' ? '$client$' : series.uuid;
    const key = `${uuid}|${interval.start}|${interval.end}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = this.calculate(series, interval);
    this.cache.set(key, result);
    return result;
  }

  private pretaxClient(): Client {
    if (!this.withoutTaxes) this.withoutTaxes = new WithoutTaxesFilter().filter(this.client);
    return this.withoutTaxes;
  }

  private calculate(series: DataSeries, interval: Interval): PerformanceIndex {
    const client = this.client;
    const converter = this.converter;
    const forClient = (c: Client) => performanceIndexForClient(c, converter, interval);
    switch (series.type) {
      case 'CLIENT':
        return forClient(client);
      case 'CLIENT_PRETAX':
        return forClient(this.pretaxClient());
      case 'SECURITY':
        return forClient(new ClientSecurityFilter(series.instance as Security).filter(client));
      case 'SECURITY_BENCHMARK':
        return performanceIndexForSecurity(this.lookup(CLIENT_SERIES, interval), series.instance as Security);
      case 'PORTFOLIO':
        return forClient(new PortfolioClientFilter([series.instance as Portfolio], []).filter(client));
      case 'PORTFOLIO_PRETAX': {
        const filtered = this.pretaxClient();
        const portfolio = filtered.portfolios.find((p) => p.source === series.instance);
        if (!portfolio) throw new Error('portfolio not found');
        return forClient(new PortfolioClientFilter([portfolio], []).filter(filtered));
      }
      case 'PORTFOLIO_PLUS_ACCOUNT': {
        const p = series.instance as Portfolio;
        return forClient(new PortfolioClientFilter([p], p.referenceAccount ? [p.referenceAccount] : []).filter(client));
      }
      case 'PORTFOLIO_PLUS_ACCOUNT_PRETAX': {
        // as in PP: the portfolio of the pre-tax client is used to filter the original client
        const filtered = this.pretaxClient();
        const portfolio = filtered.portfolios.find((p) => p.source === series.instance);
        if (!portfolio) throw new Error('portfolio not found');
        return forClient(
          new PortfolioClientFilter([portfolio], portfolio.referenceAccount ? [portfolio.referenceAccount] : []).filter(client),
        );
      }
      case 'ACCOUNT':
        return forClient(new PortfolioClientFilter([], [series.instance as Account]).filter(client));
      case 'ACCOUNT_PRETAX': {
        const filtered = this.pretaxClient();
        const account = filtered.accounts.find((a) => a.source === series.instance);
        if (!account) throw new Error('account not found');
        return forClient(new PortfolioClientFilter([], [account]).filter(client));
      }
      case 'CLASSIFICATION':
        return forClient(new ClientClassificationFilter(series.instance as Classification).filter(client));
      case 'CLIENT_FILTER':
        return forClient((series.instance as ClientFilterItem).filter.filter(client));
      case 'CLIENT_FILTER_PRETAX':
        return forClient(new WithoutTaxesFilter().filter((series.instance as ClientFilterItem).filter.filter(client)));
      case 'DERIVED_DATA_SERIES':
        return this.lookup((series.instance as DerivedDataSeries).base, interval);
    }
  }
}

function accumulate(values: number[]): number[] {
  const out = new Array<number>(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) out[i] = sum += values[i];
  return out;
}

/** StatementOfAssetsSeriesBuilder: values (in cents) of a data series */
export function statementOfAssetsValues(series: DataSeries, index: PerformanceIndex): number[] {
  if (series.type !== 'CLIENT' && series.type !== 'DERIVED_DATA_SERIES') return index.totals;
  const aspect = series.type === 'DERIVED_DATA_SERIES' ? (series.instance as DerivedDataSeries).aspect : (series.instance as ClientDataSeries);
  const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
  switch (aspect) {
    case 'TOTALS':
      return index.totals;
    case 'TRANSFERALS':
      return index.getTransferals();
    case 'TRANSFERALS_ACCUMULATED':
      return accumulate(index.getTransferals());
    case 'INVESTED_CAPITAL':
      return index.calculateInvestedCapital();
    case 'ABSOLUTE_INVESTED_CAPITAL':
      return index.calculateAbsoluteInvestedCapital();
    case 'ABSOLUTE_DELTA':
      return index.calculateDelta();
    case 'ABSOLUTE_DELTA_ALL_RECORDS':
      return index.calculateAbsoluteDelta();
    case 'TAXES':
      return index.taxes;
    case 'TAXES_ACCUMULATED':
      return accumulate(index.taxes);
    case 'DIVIDENDS':
      return index.dividends;
    case 'DIVIDENDS_ACCUMULATED':
      return accumulate(index.dividends);
    case 'INTEREST':
      return index.interest;
    case 'INTEREST_ACCUMULATED':
      return accumulate(index.interest);
    case 'INTEREST_CHARGE':
      return index.interestCharge;
    case 'INTEREST_CHARGE_ACCUMULATED':
      return accumulate(index.interestCharge);
    case 'EARNINGS':
      return add(index.dividends, index.interest);
    case 'EARNINGS_ACCUMULATED':
      return accumulate(add(index.dividends, index.interest));
    case 'FEES':
      return index.fees;
    case 'FEES_ACCUMULATED':
      return accumulate(index.fees);
    case 'DELTA_PERCENTAGE':
      return index.delta;
  }
}

export interface ConfiguredDataSeries extends DataSeries {
  visible: boolean;
  dashed: boolean;
}

/** DataSeriesSerializer#fromString: "uuid;color;lineStyle;showArea;lineWidth;visible;colorNegative,..." */
export function parseDataSeriesList(set: DataSeriesSet, config: string | null | undefined): ConfiguredDataSeries[] {
  const result: ConfiguredDataSeries[] = [];
  if (config && config.trim().length > 0) {
    const uuid2series = new Map<string, DataSeries>();
    for (const s of set.availableSeries) uuid2series.set(s.uuid, s);
    for (const s of set.availableDerivedSeries) uuid2series.set(s.uuid, s);
    for (const item of config.split(',')) {
      const data = item.split(';');
      const s = uuid2series.get(data[0]);
      if (!s) continue;
      const copy: ConfiguredDataSeries = { ...s, visible: true, dashed: false };
      if (data.length >= 4) {
        // black (the PP default for totals) follows the text color of the theme
        if (/^#[0-9a-fA-F]{6}$/.test(data[1]) && data[1].toLowerCase() !== '#000000') copy.color = data[1];
        copy.dashed = data[2] !== undefined && data[2] !== 'SOLID';
        copy.showArea = data[3] === 'true';
      }
      if (data.length >= 6) copy.visible = data[5] === 'true';
      result.push(copy);
    }
  }
  if (result.length === 0)
    for (const s of set.availableSeries)
      if (s.type === 'CLIENT' && (s.instance === 'TOTALS' || s.instance === 'TRANSFERALS')) result.push({ ...s, visible: true, dashed: false });
  return result;
}

export function serializeDataSeriesList(series: DataSeries[]): string {
  return series.map((s) => `${s.uuid};${s.color.startsWith('#') ? s.color : '#000000'};SOLID;${s.showArea};2;true;${s.color.startsWith('#') ? s.color : '#000000'}`).join(',');
}
