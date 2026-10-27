// Data model mirroring name.abuchen.portfolio.model (read-only use case)

import Decimal from 'decimal.js';
import { LocalDate, LocalDateTime, toLocalDate } from './util/dates';
import { Money, money, Quote, quote, Values } from './money/money';
import { D, divMC, HALF_EVEN, javaRound, toLong } from './util/decimal';

export type UnitType = 'GROSS_VALUE' | 'TAX' | 'FEE';

export class Unit {
  constructor(
    readonly type: UnitType,
    readonly amount: Money,
    readonly forex: Money | null = null,
    readonly exchangeRate: Decimal | null = null,
  ) {}

  /** Unit#split(double weight) */
  split(weight: number): Unit {
    const newAmount = money(this.amount.currencyCode, javaRound(this.amount.amount * weight));
    if (this.forex === null) return new Unit(this.type, newAmount);
    const newForex = money(this.forex.currencyCode, javaRound(this.forex.amount * weight));
    return new Unit(this.type, newAmount, newForex, this.exchangeRate);
  }

  piece(newAmount: number, newForexAmount: number): Unit {
    const amountOfPiece = money(this.amount.currencyCode, newAmount);
    if (this.forex === null) return new Unit(this.type, amountOfPiece);
    return new Unit(this.type, amountOfPiece, money(this.forex.currencyCode, newForexAmount), this.exchangeRate);
  }
}

export type AccountTransactionType =
  | 'DEPOSIT'
  | 'REMOVAL'
  | 'INTEREST'
  | 'INTEREST_CHARGE'
  | 'DIVIDENDS'
  | 'FEES'
  | 'FEES_REFUND'
  | 'TAXES'
  | 'TAX_REFUND'
  | 'BUY'
  | 'SELL'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';

/** enum ordinal order is used by Transaction.BY_DATE */
export const ACCOUNT_TYPE_ORDINAL: Record<AccountTransactionType, number> = {
  DEPOSIT: 0,
  REMOVAL: 1,
  INTEREST: 2,
  INTEREST_CHARGE: 3,
  DIVIDENDS: 4,
  FEES: 5,
  FEES_REFUND: 6,
  TAXES: 7,
  TAX_REFUND: 8,
  BUY: 9,
  SELL: 10,
  TRANSFER_IN: 11,
  TRANSFER_OUT: 12,
};

const ACCOUNT_DEBIT: Record<AccountTransactionType, boolean> = {
  DEPOSIT: false,
  REMOVAL: true,
  INTEREST: false,
  INTEREST_CHARGE: true,
  DIVIDENDS: false,
  FEES: true,
  FEES_REFUND: false,
  TAXES: true,
  TAX_REFUND: false,
  BUY: true,
  SELL: false,
  TRANSFER_IN: false,
  TRANSFER_OUT: true,
};

export function isDebit(type: AccountTransactionType): boolean {
  return ACCOUNT_DEBIT[type];
}

export function isCredit(type: AccountTransactionType): boolean {
  return !ACCOUNT_DEBIT[type];
}

export type PortfolioTransactionType =
  | 'BUY'
  | 'SELL'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'DELIVERY_INBOUND'
  | 'DELIVERY_OUTBOUND';

export function isPurchase(type: PortfolioTransactionType): boolean {
  return type === 'BUY' || type === 'TRANSFER_IN' || type === 'DELIVERY_INBOUND';
}

export function isLiquidation(type: PortfolioTransactionType): boolean {
  return !isPurchase(type);
}

let hashCounter = 1;

export abstract class Transaction {
  uuid: string;
  dateTime: LocalDateTime = 0;
  currencyCode = 'EUR';
  amount = 0;
  security: Security | null = null;
  crossEntry: CrossEntry | null = null;
  shares = 0;
  note: string | null = null;
  source: string | null = null;
  units: Unit[] = [];
  updatedAt: number | null = null;
  /** stand-in for Object#hashCode used as last tie breaker when sorting */
  readonly hash: number = hashCounter++;

  constructor(uuid?: string) {
    this.uuid = uuid ?? randomUUID();
  }

  get date(): LocalDate {
    return toLocalDate(this.dateTime);
  }

  getMonetaryAmount(): Money {
    return money(this.currencyCode, this.amount);
  }

  getUnit(type: UnitType): Unit | undefined {
    return this.units.find((u) => u.type === type);
  }

  /** Transaction#getUnitSum(type...) */
  getUnitSum(...types: UnitType[]): Money {
    let sum = 0;
    for (const u of this.units) if (types.includes(u.type)) sum += u.amount.amount;
    return money(this.currencyCode, sum);
  }

  addUnit(unit: Unit): void {
    if (unit.amount.currencyCode !== this.currencyCode)
      throw new Error(
        `Unit currency mismatch: ${unit.type} ${unit.amount.currencyCode} <> ${this.currencyCode}`,
      );
    this.units.push(unit);
  }

  abstract getGrossValue(): Money;
}

export class AccountTransaction extends Transaction {
  type: AccountTransactionType = 'DEPOSIT';
  exDate: LocalDateTime | null = null;

  constructor(uuid?: string, type?: AccountTransactionType) {
    super(uuid);
    if (type) this.type = type;
  }

  getGrossValueAmount(): number {
    const taxAndFees = this.getUnitSum('FEE', 'TAX').amount;
    return this.amount + (isCredit(this.type) ? taxAndFees : -taxAndFees);
  }

  getGrossValue(): Money {
    return money(this.currencyCode, this.getGrossValueAmount());
  }
}

export class PortfolioTransaction extends Transaction {
  type: PortfolioTransactionType = 'BUY';

  constructor(uuid?: string, type?: PortfolioTransactionType) {
    super(uuid);
    if (type) this.type = type;
  }

  getGrossValueAmount(): number {
    const taxAndFees = this.getUnitSum('FEE', 'TAX').amount;
    return isPurchase(this.type) ? this.amount - taxAndFees : this.amount + taxAndFees;
  }

  getGrossValue(): Money {
    return money(this.currencyCode, this.getGrossValueAmount());
  }

  /** getGrossPricePerShare() */
  getGrossPricePerShare(): Quote {
    if (this.shares === 0) return quote(this.currencyCode, 0);
    const grossPrice = toLong(
      divMC(new D(this.getGrossValueAmount()).mul(1e6).mul(1e8), this.shares),
      HALF_EVEN,
    );
    return quote(this.currencyCode, grossPrice);
  }
}

export function getSecurityCurrency(t: Transaction): string {
  if (!t.security) throw new Error('transaction without security');
  return t.security.currencyCode;
}

export interface CrossEntry {
  readonly kind: 'buysell' | 'account-transfer' | 'portfolio-transfer';
  getCrossTransaction(t: Transaction): Transaction;
  getCrossOwner(t: Transaction): TransactionOwner;
  getOwner(t: Transaction): TransactionOwner;
}

export class BuySellEntry implements CrossEntry {
  readonly kind = 'buysell' as const;
  constructor(
    public portfolio: Portfolio,
    public portfolioTransaction: PortfolioTransaction,
    public account: Account,
    public accountTransaction: AccountTransaction,
  ) {
    portfolioTransaction.crossEntry = this;
    accountTransaction.crossEntry = this;
  }
  getCrossTransaction(t: Transaction): Transaction {
    if (t === this.portfolioTransaction) return this.accountTransaction;
    if (t === this.accountTransaction) return this.portfolioTransaction;
    throw new Error('unable to get cross transaction');
  }
  getCrossOwner(t: Transaction): TransactionOwner {
    if (t === this.portfolioTransaction) return this.account;
    if (t === this.accountTransaction) return this.portfolio;
    throw new Error('unable to get cross owner');
  }
  getOwner(t: Transaction): TransactionOwner {
    if (t === this.portfolioTransaction) return this.portfolio;
    if (t === this.accountTransaction) return this.account;
    throw new Error('unable to get owner');
  }
}

export class AccountTransferEntry implements CrossEntry {
  readonly kind = 'account-transfer' as const;
  constructor(
    public accountFrom: Account,
    public transactionFrom: AccountTransaction,
    public accountTo: Account,
    public transactionTo: AccountTransaction,
  ) {
    transactionFrom.type = 'TRANSFER_OUT';
    transactionFrom.crossEntry = this;
    transactionTo.type = 'TRANSFER_IN';
    transactionTo.crossEntry = this;
  }
  getCrossTransaction(t: Transaction): Transaction {
    if (t === this.transactionFrom) return this.transactionTo;
    if (t === this.transactionTo) return this.transactionFrom;
    throw new Error('unable to get cross transaction');
  }
  getCrossOwner(t: Transaction): TransactionOwner {
    if (t === this.transactionFrom) return this.accountTo;
    if (t === this.transactionTo) return this.accountFrom;
    throw new Error('unable to get cross owner');
  }
  getOwner(t: Transaction): TransactionOwner {
    if (t === this.transactionFrom) return this.accountFrom;
    if (t === this.transactionTo) return this.accountTo;
    throw new Error('unable to get owner');
  }
}

export class PortfolioTransferEntry implements CrossEntry {
  readonly kind = 'portfolio-transfer' as const;
  constructor(
    public portfolioFrom: Portfolio,
    public transactionFrom: PortfolioTransaction,
    public portfolioTo: Portfolio,
    public transactionTo: PortfolioTransaction,
  ) {
    transactionFrom.type = 'TRANSFER_OUT';
    transactionFrom.crossEntry = this;
    transactionTo.type = 'TRANSFER_IN';
    transactionTo.crossEntry = this;
  }
  getCrossTransaction(t: Transaction): Transaction {
    if (t === this.transactionFrom) return this.transactionTo;
    if (t === this.transactionTo) return this.transactionFrom;
    throw new Error('unable to get cross transaction');
  }
  getCrossOwner(t: Transaction): TransactionOwner {
    if (t === this.transactionFrom) return this.portfolioTo;
    if (t === this.transactionTo) return this.portfolioFrom;
    throw new Error('unable to get cross owner');
  }
  getOwner(t: Transaction): TransactionOwner {
    if (t === this.transactionFrom) return this.portfolioFrom;
    if (t === this.transactionTo) return this.portfolioTo;
    throw new Error('unable to get owner');
  }
}

export interface SecurityPrice {
  readonly date: LocalDate;
  readonly value: number;
}

export interface LatestSecurityPrice extends SecurityPrice {
  readonly high: number;
  readonly low: number;
  readonly volume: number;
}

export type SecurityEventType = 'STOCK_SPLIT' | 'NOTE' | 'DIVIDEND_PAYMENT';

export interface SecurityEvent {
  type: SecurityEventType;
  date: LocalDate | null;
  details: string | null;
  source: string | null;
  /** only for DIVIDEND_PAYMENT */
  paymentDate?: LocalDate | null;
  amount?: Money | null;
}

export type AttributeValue = string | number | boolean | null | Record<string, unknown> | LimitPrice;

export interface LimitPrice {
  relationalOperator: string;
  value: number;
}

export interface Attributable {
  attributes: Map<string, AttributeValue>;
}

export interface InvestmentVehicle {
  readonly uuid: string;
  name: string;
  currencyCode: string;
  note: string | null;
  isRetired: boolean;
}

export type SecurityPropertyType = 'MARKET' | 'FEED' | 'DATA_SOURCE';

export interface SecurityProperty {
  type: string;
  name: string;
  value: string | null;
}

export class Security implements InvestmentVehicle, Attributable {
  onlineId: string | null = null;
  name = '';
  currencyCode = 'EUR';
  targetCurrencyCode: string | null = null;
  note: string | null = null;
  isin: string | null = null;
  tickerSymbol: string | null = null;
  wkn: string | null = null;
  calendar: string | null = null;
  feed: string | null = null;
  feedURL: string | null = null;
  /** sorted by date */
  prices: SecurityPrice[] = [];
  latestFeed: string | null = null;
  latestFeedURL: string | null = null;
  latest: LatestSecurityPrice | null = null;
  attributes = new Map<string, AttributeValue>();
  events: SecurityEvent[] = [];
  properties: SecurityProperty[] = [];
  isRetired = false;
  updatedAt: number | null = null;

  constructor(readonly uuid: string = randomUUID()) {}

  isExchangeRate(): boolean {
    return this.targetCurrencyCode !== null;
  }

  getExternalIdentifier(): string {
    if (this.isin) return this.isin;
    if (this.tickerSymbol) {
      const p = this.tickerSymbol.indexOf('.');
      return p >= 0 ? this.tickerSymbol.substring(0, p) : this.tickerSymbol;
    }
    if (this.wkn) return this.wkn;
    return this.name;
  }

  /** Security#getPricesIncludingLatest */
  getPricesIncludingLatest(): SecurityPrice[] {
    const copy = this.prices.slice();
    if (this.latest === null) return copy;
    const index = binarySearchByDate(copy, this.latest.date);
    if (index >= 0) return copy;
    copy.splice(~index, 0, this.latest);
    return copy;
  }

  /** Security#getSecurityPrice */
  getSecurityPrice(requestedDate: LocalDate): SecurityPrice {
    const prices = this.prices;
    const lastHistoric = prices.length === 0 ? null : prices[prices.length - 1];
    const latest = this.latest;
    if (
      latest !== null &&
      (lastHistoric === null || (!(requestedDate < latest.date) && !(latest.date < lastHistoric.date)))
    )
      return latest;
    if (lastHistoric === null) return { date: requestedDate, value: 0 };
    if (!(lastHistoric.date > requestedDate)) return lastHistoric;
    const index = binarySearchByDate(prices, requestedDate);
    if (index >= 0) return prices[index];
    if (index === -1) return prices[0];
    return prices[-index - 2];
  }

  /** Security#getLatestTwoSecurityPrices (with explicit "now") */
  getLatestTwoSecurityPrices(now: LocalDate): [SecurityPrice, SecurityPrice] | null {
    const prices = this.prices;
    if (prices.length === 0) return null;
    let newest: SecurityPrice | null = null;
    let previous: SecurityPrice | null = null;
    for (let index = prices.length - 1; index >= 0 && previous === null; index--) {
      const price = prices[index];
      if (price.date > now) continue;
      if (newest === null) newest = price;
      else previous = price;
    }
    const latestPrice = this.latest;
    if (latestPrice !== null && !(latestPrice.date > now) && binarySearchByDate(prices, latestPrice.date) < 0) {
      if (newest === null || latestPrice.date > newest.date) {
        previous = newest;
        newest = latestPrice;
      } else if (previous === null || latestPrice.date > previous.date) {
        previous = latestPrice;
      }
    }
    return newest !== null && previous !== null ? [newest, previous] : null;
  }

  getLatestNPricesOfDate(dateOfLastPrice: LocalDate, numberOfPrices: number): SecurityPrice[] {
    const allPrices = this.getPricesIncludingLatest();
    let index = binarySearchByDate(allPrices, dateOfLastPrice);
    if (index < 0) index = -index - 2;
    if (index >= allPrices.length) index = allPrices.length - 1;
    let fromIndex = index - numberOfPrices + 1;
    if (fromIndex < 0) fromIndex = 0;
    return allPrices.slice(fromIndex, index + 1);
  }

  getPropertyValue(type: string, name: string): string | null {
    const p = this.properties.find((x) => x.type === type && x.name === name);
    return p ? p.value : null;
  }
}

/** Collections.binarySearch on a list sorted by date */
export function binarySearchByDate(list: readonly { date: LocalDate }[], date: LocalDate): number {
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const d = list[mid].date;
    if (d < date) low = mid + 1;
    else if (d > date) high = mid - 1;
    else return mid;
  }
  return -(low + 1);
}

export type TransactionOwner = Account | Portfolio;

export class Account implements InvestmentVehicle, Attributable {
  name = '';
  currencyCode = 'EUR';
  note: string | null = null;
  isRetired = false;
  transactions: AccountTransaction[] = [];
  attributes = new Map<string, AttributeValue>();
  updatedAt: number | null = null;
  readonly kind = 'account' as const;
  /** set for read-only copies created by client filters (ReadOnlyAccount) */
  source: Account | null = null;

  constructor(readonly uuid: string = randomUUID()) {}

  /** ReadOnlyAccount#unwrap */
  unwrap(): Account {
    return this.source ? this.source.unwrap() : this;
  }

  addTransaction(t: AccountTransaction): void {
    if (t.currencyCode !== this.currencyCode)
      throw new Error(
        `Unable to add transaction ${t.uuid} to account '${this.name}': ${this.currencyCode} <> ${t.currencyCode}`,
      );
    this.transactions.push(t);
  }
}

export class Portfolio implements Attributable {
  name = '';
  note: string | null = null;
  isRetired = false;
  referenceAccount: Account | null = null;
  transactions: PortfolioTransaction[] = [];
  attributes = new Map<string, AttributeValue>();
  updatedAt: number | null = null;
  readonly kind = 'portfolio' as const;
  /** set for read-only copies created by client filters (ReadOnlyPortfolio) */
  source: Portfolio | null = null;

  constructor(readonly uuid: string = randomUUID()) {}

  /** ReadOnlyPortfolio#unwrap */
  unwrap(): Portfolio {
    return this.source ? this.source.unwrap() : this;
  }

  addTransaction(t: PortfolioTransaction): void {
    this.transactions.push(t);
  }
}

export const ONE_HUNDRED_PERCENT = 100 * Values.Weight.factor; // 10000
export const UNASSIGNED_ID = '$unassigned$';
export const VIRTUAL_ROOT = '$virtualroot$';

export class Assignment {
  rank = 0;
  data: Map<string, unknown> | null = null;
  constructor(
    public investmentVehicle: InvestmentVehicle,
    public weight: number = ONE_HUNDRED_PERCENT,
  ) {}
}

export class Classification {
  parent: Classification | null = null;
  children: Classification[] = [];
  assignments: Assignment[] = [];
  note: string | null = null;
  weight = ONE_HUNDRED_PERCENT;
  rank = 0;
  data: Map<string, unknown> | null = null;

  constructor(
    public id: string,
    public name: string,
    public color: string = '#999999',
  ) {}

  getKey(): string {
    const v = this.data?.get('portfolioClassificationKey');
    return v == null ? '' : String(v);
  }

  getChildrenWeight(): number {
    let sum = 0;
    for (const c of this.children) sum += c.weight;
    return sum;
  }

  getPathToRoot(): Classification[] {
    const path: Classification[] = [];
    let item: Classification | null = this;
    while (item !== null) {
      path.unshift(item);
      item = item.parent;
    }
    return path;
  }

  getPathName(includeParent: boolean): string {
    const path = this.getPathToRoot();
    if (!includeParent && path.length > 1) path.shift();
    return path.map((c) => c.name).join(' » ');
  }

  /** Classification#accept: visit node, children sorted by rank, then assignments */
  accept(visitor: TaxonomyVisitor): void {
    visitor.visitClassification?.(this);
    const sorted = this.children.slice().sort((r, l) => r.rank - l.rank);
    for (const child of sorted) child.accept(visitor);
    for (const assignment of this.assignments.slice()) visitor.visitAssignment?.(this, assignment);
  }

  /** depth first, sorted by rank (Classification#getTreeElements) */
  getTreeElements(): Classification[] {
    const answer: Classification[] = [];
    const stack: Classification[] = this.children.slice().sort((r, l) => r.rank - l.rank);
    while (stack.length > 0) {
      const c = stack.shift()!;
      answer.push(c);
      const list = c.children.slice().sort((r, l) => r.rank - l.rank);
      stack.unshift(...list);
    }
    return answer;
  }

  flattenAssignments(): Classification {
    const result = new Classification(this.id, this.name, this.color);
    result.rank = this.rank;
    result.weight = this.weight;
    result.data = this.data ? new Map(this.data) : null;
    const stack: Classification[] = [this];
    while (stack.length > 0) {
      const c = stack.shift()!;
      stack.push(...c.children);
      for (const assignment of c.assignments) {
        if (assignment.weight === ONE_HUNDRED_PERCENT) {
          result.assignments.push(assignment);
        } else {
          const existing = result.assignments.find((a) => a.investmentVehicle === assignment.investmentVehicle);
          if (existing) {
            const merged = new Assignment(assignment.investmentVehicle, existing.weight + assignment.weight);
            result.assignments.splice(result.assignments.indexOf(existing), 1);
            result.assignments.push(merged);
          } else {
            result.assignments.push(assignment);
          }
        }
      }
    }
    return result;
  }
}

export interface TaxonomyVisitor {
  visitClassification?(c: Classification): void;
  visitAssignment?(c: Classification, a: Assignment): void;
}

export class Taxonomy {
  source: string | null = null;
  dimensions: string[] = [];
  root!: Classification;

  constructor(
    public id: string,
    public name: string,
  ) {}

  foreach(visitor: TaxonomyVisitor): void {
    this.root.accept(visitor);
  }

  getClassificationById(id: string | null): Classification | null {
    if (id == null) return null;
    const stack = this.root.children.slice();
    while (stack.length > 0) {
      const c = stack.shift()!;
      if (c.id === id) return c;
      stack.push(...c.children);
    }
    return null;
  }

  getAllClassifications(): Classification[] {
    const answer: Classification[] = [];
    this.foreach({ visitClassification: (c) => answer.push(c) });
    return answer;
  }

  getClassifications(vehicle: InvestmentVehicle): Classification[] {
    const answer: Classification[] = [];
    this.foreach({
      visitAssignment: (c, a) => {
        if (a.investmentVehicle === vehicle) answer.push(c);
      },
    });
    return answer;
  }

  getHeight(): number {
    const h = (c: Classification): number => 1 + c.children.reduce((m, x) => Math.max(m, h(x)), 0);
    return h(this.root);
  }

  isUsedForRebalancing(vehicle: InvestmentVehicle): boolean {
    const v = this.root.data?.get('rebalancing-included:' + vehicle.uuid);
    return typeof v === 'boolean' ? v : true;
  }
}

export interface DashboardWidget {
  type: string;
  label: string;
  configuration: Record<string, string>;
}

export interface DashboardColumn {
  weight: number;
  widgets: DashboardWidget[];
}

export interface Dashboard {
  id: string;
  name: string;
  configuration: Record<string, string>;
  columns: DashboardColumn[];
}

export interface Watchlist {
  name: string;
  securities: Security[];
}

export type InvestmentPlanType = 'PURCHASE_OR_DELIVERY' | 'DEPOSIT' | 'REMOVAL' | 'INTEREST';

export interface InvestmentPlan {
  name: string;
  note: string | null;
  security: Security | null;
  portfolio: Portfolio | null;
  account: Account | null;
  attributes: Map<string, AttributeValue>;
  autoGenerate: boolean;
  start: LocalDateTime;
  interval: number;
  amount: number;
  fees: number;
  taxes: number;
  type: InvestmentPlanType;
  transactions: Transaction[];
}

export interface AttributeType {
  id: string;
  name: string;
  columnLabel: string;
  source: string | null;
  /** fully qualified java class name of the target, e.g. name.abuchen.portfolio.model.Security */
  target: string;
  /** fully qualified java class name of the value type */
  type: string;
  converterClass: string;
  properties: Map<string, unknown>;
}

export interface Bookmark {
  label: string;
  pattern: string;
}

export interface ConfigurationSetEntry {
  uuid: string;
  name: string;
  data: string;
}

export class ClientSettings {
  bookmarks: Bookmark[] = [];
  attributeTypes: AttributeType[] = [];
  configurationSets = new Map<string, ConfigurationSetEntry[]>();

  getConfigurationSet(key: string): ConfigurationSetEntry[] {
    let set = this.configurationSets.get(key);
    if (!set) {
      set = [];
      this.configurationSets.set(key, set);
    }
    return set;
  }
}

export class Client {
  version = 0;
  baseCurrency = 'EUR';
  securities: Security[] = [];
  accounts: Account[] = [];
  portfolios: Portfolio[] = [];
  plans: InvestmentPlan[] = [];
  watchlists: Watchlist[] = [];
  taxonomies: Taxonomy[] = [];
  dashboards: Dashboard[] = [];
  properties = new Map<string, string>();
  settings = new ClientSettings();
  /** information about how the file was loaded */
  fileFormat: { encrypted: boolean; binary: boolean; compressed: boolean } = {
    encrypted: false,
    binary: false,
    compressed: false,
  };

  /** set for pseudo clients created by client filters (ReadOnlyClient) */
  source: Client | null = null;

  unwrap(): Client {
    return this.source ? this.source.unwrap() : this;
  }

  getActiveSecurities(): Security[] {
    return this.securities.filter((s) => !s.isRetired);
  }

  getActiveAccounts(): Account[] {
    return this.accounts.filter((a) => !a.isRetired);
  }

  getActivePortfolios(): Portfolio[] {
    return this.portfolios.filter((p) => !p.isRetired);
  }

  getAllTransactions(): { owner: TransactionOwner; transaction: Transaction }[] {
    const answer: { owner: TransactionOwner; transaction: Transaction }[] = [];
    for (const a of this.accounts) for (const t of a.transactions) answer.push({ owner: a, transaction: t });
    for (const p of this.portfolios) for (const t of p.transactions) answer.push({ owner: p, transaction: t });
    return answer;
  }

  getTaxonomy(id: string): Taxonomy | undefined {
    return this.taxonomies.find((t) => t.id === id);
  }

  getProperty(key: string): string | undefined {
    return this.properties.get(key);
  }
}

/** Transaction.BY_DATE comparator */
export function compareByDate(t1: Transaction, t2: Transaction): number {
  if (t1.dateTime !== t2.dateTime) return t1.dateTime < t2.dateTime ? -1 : 1;
  if (t1.amount !== t2.amount) return t1.amount < t2.amount ? -1 : 1;
  if (t1 instanceof AccountTransaction && t2 instanceof AccountTransaction) {
    const c = ACCOUNT_TYPE_ORDINAL[t1.type] - ACCOUNT_TYPE_ORDINAL[t2.type];
    if (c !== 0) return c;
  }
  return t1.hash - t2.hash;
}

export function sortByDate<T extends Transaction>(list: T[]): T[] {
  list.sort(compareByDate);
  return list;
}

export function randomUUID(): string {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += hex[8 + ((Math.random() * 4) | 0)];
    else s += hex[(Math.random() * 16) | 0];
  }
  return s;
}
