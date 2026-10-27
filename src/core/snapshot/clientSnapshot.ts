// AccountSnapshot, PortfolioSnapshot, SecurityPosition, ClientSnapshot,
// AssetPosition, AssetCategory, GroupByTaxonomy

import {
  Account,
  Classification,
  Client,
  compareByDate,
  InvestmentVehicle,
  isDebit,
  ONE_HUNDRED_PERCENT,
  Portfolio,
  PortfolioTransaction,
  Security,
  SecurityPrice,
  Taxonomy,
  UNASSIGNED_ID,
  Assignment,
} from '../model';
import { atEndOfDay, LocalDate } from '../util/dates';
import { Money, money, MutableMoney, Values } from '../money/money';
import { convertMoney, CurrencyConverter } from '../money/exchange';
import { D, DMC, HALF_DOWN, HALF_EVEN, HALF_UP, toLong } from '../util/decimal';

/** shares (8 digits) * price (8 digits) -> money (2 digits), as in SecurityPosition#calculateValue */
export function marketValue(shares: number, price: number): number {
  if (shares === 0 || price === 0) return 0;
  const product = new D(new DMC(new D(shares).div(1e8)).mul(price));
  return toLong(product.div(1e6), HALF_UP);
}

export class AccountSnapshot {
  private constructor(
    readonly account: Account,
    readonly date: LocalDate,
    readonly converter: CurrencyConverter,
    private readonly funds: Money,
  ) {}

  static create(account: Account, converter: CurrencyConverter, date: LocalDate): AccountSnapshot {
    let funds = 0;
    const reference = atEndOfDay(date);
    for (const t of account.transactions) {
      if (!(t.dateTime > reference)) {
        if (isDebit(t.type)) funds -= t.amount;
        else funds += t.amount;
      }
    }
    return new AccountSnapshot(account, date, converter, money(account.currencyCode, funds));
  }

  getFunds(): Money {
    return convertMoney(this.converter, this.date, this.funds);
  }

  getUnconvertedFunds(): Money {
    return this.funds;
  }
}

export class SecurityPosition {
  constructor(
    readonly investment: InvestmentVehicle,
    readonly converter: CurrencyConverter,
    readonly price: SecurityPrice,
    readonly shares: number,
    readonly transactions: PortfolioTransaction[],
  ) {}

  static ofTransactions(
    security: Security,
    converter: CurrencyConverter,
    price: SecurityPrice,
    transactions: PortfolioTransaction[],
  ): SecurityPosition {
    let shares = 0;
    for (const t of transactions) {
      switch (t.type) {
        case 'BUY':
        case 'TRANSFER_IN':
        case 'DELIVERY_INBOUND':
          shares += t.shares;
          break;
        default:
          shares -= t.shares;
      }
    }
    return new SecurityPosition(security, converter.with(security.currencyCode), price, shares, transactions.slice());
  }

  static ofAccount(snapshot: AccountSnapshot): SecurityPosition {
    const account = snapshot.account;
    return new SecurityPosition(
      account,
      snapshot.converter.with(account.currencyCode),
      { date: snapshot.date, value: snapshot.getUnconvertedFunds().amount * Values.Quote.factorToMoney },
      Values.Share.factor,
      [],
    );
  }

  getSecurity(): Security | null {
    return this.investment instanceof Security ? this.investment : null;
  }

  calculateValue(): Money {
    return money(this.investment.currencyCode, marketValue(this.shares, this.price.value));
  }

  /** SecurityPosition#split */
  static split(position: SecurityPosition, weight: number): SecurityPosition {
    const bdWeight = weight;
    const split = (v: number) =>
      toLong(new D(new DMC(new D(new DMC(v).mul(bdWeight))).div(ONE_HUNDRED_PERCENT)), HALF_DOWN);
    const splitTransactions = position.transactions.map((t) => {
      const t2 = new PortfolioTransaction(undefined, t.type);
      t2.dateTime = t.dateTime;
      t2.security = t.security;
      t2.currencyCode = t.currencyCode;
      t2.amount = split(t.amount);
      t2.shares = split(t.shares);
      for (const u of t.units) t2.units.push(u.split(weight / ONE_HUNDRED_PERCENT));
      return t2;
    });
    return new SecurityPosition(position.investment, position.converter, position.price, split(position.shares), splitTransactions);
  }
}

export class PortfolioSnapshot {
  private constructor(
    readonly portfolio: Portfolio,
    readonly converter: CurrencyConverter,
    readonly date: LocalDate,
    readonly positions: SecurityPosition[],
  ) {}

  static create(portfolio: Portfolio, converter: CurrencyConverter, date: LocalDate): PortfolioSnapshot {
    // group by security preserving the first-seen order (HashMap order is not relevant for the values)
    const bySecurity = new Map<Security, PortfolioTransaction[]>();
    for (const t of portfolio.transactions) {
      if (t.date > date) continue;
      const s = t.security!;
      let list = bySecurity.get(s);
      if (!list) bySecurity.set(s, (list = []));
      list.push(t);
    }
    const positions: SecurityPosition[] = [];
    for (const [security, txs] of bySecurity) {
      let price = security.getSecurityPrice(date);
      if (price.value === 0) {
        // fallback to the price of the last transaction
        const last = txs.slice().sort(compareByDate)[txs.length - 1];
        if (last)
          price = {
            date: last.date,
            value: grossPricePerShare(last, converter.with(security.currencyCode)),
          };
      }
      const p = SecurityPosition.ofTransactions(security, converter, price, txs);
      if (p.shares !== 0) positions.push(p);
    }
    return new PortfolioSnapshot(portfolio, converter, date, positions);
  }

  static merge(snapshots: PortfolioSnapshot[], converter: CurrencyConverter): PortfolioSnapshot {
    if (snapshots.length === 0) throw new Error('PortfolioSnapshots to be merged must not be empty');
    const portfolio = new Portfolio('joint');
    portfolio.name = 'Gesamtdepot';
    const referenceAccount = new Account('joint-account');
    referenceAccount.name = 'Gesamtdepot';
    referenceAccount.currencyCode = converter.termCurrency;
    portfolio.referenceAccount = referenceAccount;
    for (const s of snapshots) portfolio.transactions.push(...s.portfolio.transactions);
    return PortfolioSnapshot.create(portfolio, snapshots[0].converter, snapshots[0].date);
  }

  getValue(): Money {
    let sum = 0;
    for (const p of this.positions) sum += convertMoney(this.converter, this.date, p.calculateValue()).amount;
    return money(this.converter.termCurrency, sum);
  }

  getPositionsBySecurity(): Map<Security, SecurityPosition> {
    const m = new Map<Security, SecurityPosition>();
    for (const p of this.positions) m.set(p.getSecurity()!, p);
    return m;
  }
}

/** PortfolioTransaction#getGrossPricePerShare(CurrencyConverter) */
export function grossPricePerShare(t: PortfolioTransaction, converter: CurrencyConverter): number {
  if (t.shares === 0) return 0;
  if (converter.termCurrency === t.currencyCode) return t.getGrossPricePerShare().amount;
  const gross = grossValueConverted(t, converter).amount;
  return toLong(new D(new DMC(new D(gross).mul(1e6).mul(1e8)).div(t.shares)), HALF_EVEN);
}

/** PortfolioTransaction#getGrossValue(CurrencyConverter) */
export function grossValueConverted(t: PortfolioTransaction, converter: CurrencyConverter): Money {
  if (t.currencyCode === converter.termCurrency) return t.getGrossValue();
  if (t.security && t.security.currencyCode === converter.termCurrency) {
    const gv = t.getUnit('GROSS_VALUE');
    if (gv && gv.forex) return money(converter.termCurrency, gv.forex.amount);
  }
  return convertMoney(converter, t.date, t.getGrossValue());
}

export class AssetPosition {
  private readonly valuation: Money;
  constructor(
    readonly position: SecurityPosition,
    private readonly converter: CurrencyConverter,
    private readonly date: LocalDate,
    private readonly totalAssets: Money,
  ) {
    this.valuation = position.calculateValue();
  }
  getValuation(): Money {
    return convertMoney(this.converter, this.date, this.valuation);
  }
  getShare(): number {
    return this.getValuation().amount / this.totalAssets.amount;
  }
  getDescription(): string {
    return this.position.investment.name;
  }
  getSecurity(): Security | null {
    return this.position.getSecurity();
  }
  get investmentVehicle(): InvestmentVehicle {
    return this.position.investment;
  }
}

export class AssetCategory {
  readonly positions: AssetPosition[] = [];
  private readonly valuation: MutableMoney;
  constructor(
    readonly classification: Classification,
    private readonly converter: CurrencyConverter,
    private readonly date: LocalDate,
    private readonly totalAssets: Money,
  ) {
    this.valuation = MutableMoney.of(converter.termCurrency);
  }
  getValuation(): Money {
    return this.valuation.toMoney();
  }
  getShare(): number {
    return this.valuation.amount / this.totalAssets.amount;
  }
  addPosition(p: AssetPosition): void {
    this.positions.push(p);
    this.valuation.add(convertMoney(this.converter, this.date, p.getValuation()));
  }
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('de') : null;
export function compareText(a: string, b: string): number {
  return collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0;
}

export class GroupByTaxonomy {
  readonly categories: AssetCategory[] = [];

  private constructor(
    readonly taxonomy: Taxonomy | null,
    readonly converter: CurrencyConverter,
    readonly date: LocalDate,
    readonly valuation: Money,
  ) {}

  static ofClientSnapshot(taxonomy: Taxonomy | null, snapshot: ClientSnapshot): GroupByTaxonomy {
    const g = new GroupByTaxonomy(taxonomy, snapshot.converter, snapshot.date, snapshot.getMonetaryAssets());
    const items = new Map<InvestmentVehicle, { position: SecurityPosition; weight: number }>();
    for (const account of snapshot.accounts) {
      if (account.getFunds().amount === 0) continue;
      items.set(account.account, { position: SecurityPosition.ofAccount(account), weight: 0 });
    }
    for (const pos of snapshot.getJointPortfolio().positions)
      items.set(pos.getSecurity()!, { position: pos, weight: 0 });
    g.doGrouping(items);
    return g;
  }

  static ofPortfolioSnapshot(taxonomy: Taxonomy | null, snapshot: PortfolioSnapshot): GroupByTaxonomy {
    const g = new GroupByTaxonomy(taxonomy, snapshot.converter, snapshot.date, snapshot.getValue());
    const items = new Map<InvestmentVehicle, { position: SecurityPosition; weight: number }>();
    for (const pos of snapshot.positions) items.set(pos.getSecurity()!, { position: pos, weight: 0 });
    g.doGrouping(items);
    return g;
  }

  private doGrouping(items: Map<InvestmentVehicle, { position: SecurityPosition; weight: number }>): void {
    if (this.taxonomy) {
      for (const classification of this.taxonomy.root.children) {
        const vehicle2item = new Map<InvestmentVehicle, { position: SecurityPosition; weight: number }>();
        classification.accept({
          visitAssignment: (_c: Classification, assignment: Assignment) => {
            const item = items.get(assignment.investmentVehicle);
            if (item) {
              item.weight += assignment.weight;
              let own = vehicle2item.get(assignment.investmentVehicle);
              if (!own) vehicle2item.set(assignment.investmentVehicle, (own = { position: item.position, weight: 0 }));
              own.weight += assignment.weight;
            }
          },
        });
        if (vehicle2item.size > 0) {
          const category = new AssetCategory(classification, this.converter, this.date, this.valuation);
          this.categories.push(category);
          for (const item of vehicle2item.values()) {
            let position = item.position;
            if (item.weight !== ONE_HUNDRED_PERCENT) position = SecurityPosition.split(position, item.weight);
            category.addPosition(new AssetPosition(position, this.converter, this.date, this.valuation));
          }
          category.positions.sort((a, b) => compareText(a.getDescription(), b.getDescription()));
        }
      }
      // stable sort by rank (Collections.sort is stable)
      this.categories.sort((r, l) => r.classification.rank - l.classification.rank);
    }

    const unassigned = new AssetCategory(
      new Classification(UNASSIGNED_ID, 'Ohne Klassifizierung', '#cccccc'),
      this.converter,
      this.date,
      this.valuation,
    );
    for (const item of items.values()) {
      if (item.weight < ONE_HUNDRED_PERCENT) {
        let position = item.position;
        if (item.weight !== 0) position = SecurityPosition.split(position, ONE_HUNDRED_PERCENT - item.weight);
        unassigned.addPosition(new AssetPosition(position, this.converter, this.date, this.valuation));
      }
    }
    if (unassigned.positions.length > 0) this.categories.push(unassigned);
  }

  byClassification(c: Classification): AssetCategory | undefined {
    return this.categories.find((x) => x.classification === c);
  }
}

export class ClientSnapshot {
  readonly accounts: AccountSnapshot[] = [];
  readonly portfolios: PortfolioSnapshot[] = [];
  private jointPortfolio: PortfolioSnapshot | null = null;
  private assets: Money | null = null;

  private constructor(
    readonly converter: CurrencyConverter,
    readonly date: LocalDate,
  ) {}

  static create(client: Client, converter: CurrencyConverter, date: LocalDate): ClientSnapshot {
    const snapshot = new ClientSnapshot(converter, date);
    for (const account of client.accounts) snapshot.accounts.push(AccountSnapshot.create(account, converter, date));
    for (const portfolio of client.portfolios)
      snapshot.portfolios.push(PortfolioSnapshot.create(portfolio, converter, date));
    return snapshot;
  }

  get currencyCode(): string {
    return this.converter.termCurrency;
  }

  getJointPortfolio(): PortfolioSnapshot {
    if (this.jointPortfolio === null) {
      if (this.portfolios.length === 0) {
        const portfolio = new Portfolio('joint');
        portfolio.name = 'Gesamtdepot';
        this.jointPortfolio = PortfolioSnapshot.create(portfolio, this.converter, this.date);
      } else if (this.portfolios.length === 1) {
        this.jointPortfolio = this.portfolios[0];
      } else {
        this.jointPortfolio = PortfolioSnapshot.merge(this.portfolios, this.converter);
      }
    }
    return this.jointPortfolio;
  }

  getMonetaryAssets(): Money {
    if (this.assets === null) {
      const sum = MutableMoney.of(this.currencyCode);
      for (const a of this.accounts) sum.add(a.getFunds());
      sum.add(this.getJointPortfolio().getValue());
      this.assets = sum.toMoney();
    }
    return this.assets;
  }

  groupByTaxonomy(taxonomy: Taxonomy | null): GroupByTaxonomy {
    return GroupByTaxonomy.ofClientSnapshot(taxonomy, this);
  }

  getAssetPositions(): AssetPosition[] {
    const answer: AssetPosition[] = [];
    const monetaryAssets = this.getMonetaryAssets();
    for (const p of this.getJointPortfolio().positions)
      answer.push(new AssetPosition(p, this.converter, this.date, monetaryAssets));
    for (const a of this.accounts)
      answer.push(new AssetPosition(SecurityPosition.ofAccount(a), this.converter, this.date, monetaryAssets));
    return answer;
  }

  getPositionsByVehicle(): Map<InvestmentVehicle, AssetPosition> {
    const m = new Map<InvestmentVehicle, AssetPosition>();
    for (const p of this.getAssetPositions()) m.set(p.investmentVehicle, p);
    return m;
  }
}
