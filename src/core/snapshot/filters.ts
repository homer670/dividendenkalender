// Client filters (name.abuchen.portfolio.snapshot.filter.*)

import Decimal from 'decimal.js';
import {
  Account,
  AccountTransaction,
  AccountTransactionType,
  AccountTransferEntry,
  Assignment,
  BuySellEntry,
  Classification,
  Client,
  InvestmentVehicle,
  isDebit,
  ONE_HUNDRED_PERCENT,
  Portfolio,
  PortfolioTransaction,
  PortfolioTransactionType,
  PortfolioTransferEntry,
  Security,
  Transaction,
  TransactionOwner,
  Unit,
} from '../model';
import { D, DMC, HALF_EVEN, toLong } from '../util/decimal';
import { LocalDateTime } from '../util/dates';

export interface ClientFilter {
  filter(client: Client): Client;
}

export const NO_FILTER: ClientFilter = { filter: (c) => c };

const HUNDRED = new D(ONE_HUNDRED_PERCENT);

function isHundred(weight: Decimal): boolean {
  // BigDecimal#equals also compares the scale; the numerical results are identical anyway
  return weight.eq(HUNDRED);
}

/** ClientFilterHelper.value(long, BigDecimal) */
export function weightedValue(value: number, weight: Decimal): number {
  if (isHundred(weight)) return value;
  return toLong(new D(new DMC(new D(new DMC(value).mul(weight))).div(HUNDRED)), HALF_EVEN);
}

/** ClientFilterHelper.value(Unit, BigDecimal) */
export function weightedUnit(unit: Unit, weight: Decimal): Unit {
  if (isHundred(weight)) return unit;
  return unit.split(new DMC(weight).div(HUNDRED).toNumber());
}

// ------------------------------------------------------------------
// read-only copies

function readOnlyClient(source: Client): Client {
  const c = new Client();
  c.source = source;
  c.baseCurrency = source.baseCurrency;
  c.version = source.version;
  return c;
}

function readOnlyAccount(source: Account): Account {
  const a = new Account(source.uuid);
  a.source = source;
  a.name = source.name;
  a.currencyCode = source.currencyCode;
  a.note = source.note;
  a.attributes = source.attributes;
  a.isRetired = source.isRetired;
  return a;
}

function readOnlyPortfolio(source: Portfolio): Portfolio {
  const p = new Portfolio(source.uuid);
  p.source = source;
  p.name = source.name;
  p.note = source.note;
  p.attributes = source.attributes;
  p.isRetired = source.isRetired;
  return p;
}

function newAccountTx(
  dateTime: LocalDateTime,
  currencyCode: string,
  amount: number,
  security: Security | null,
  type: AccountTransactionType,
): AccountTransaction {
  const t = new AccountTransaction(undefined, type);
  t.dateTime = dateTime;
  t.currencyCode = currencyCode;
  t.amount = amount;
  t.security = security;
  return t;
}

function newBuySell(portfolio: Portfolio, account: Account): BuySellEntry {
  return new BuySellEntry(portfolio, new PortfolioTransaction(), account, new AccountTransaction());
}

function setBuySell(
  copy: BuySellEntry,
  t: PortfolioTransaction,
  shares: number,
  amount: number,
): void {
  const pt = copy.portfolioTransaction;
  const at = copy.accountTransaction;
  for (const x of [pt, at]) {
    x.dateTime = t.dateTime;
    x.currencyCode = t.currencyCode;
    x.security = t.security;
    x.note = t.note;
    x.amount = amount;
  }
  pt.type = t.type;
  at.type = t.type as AccountTransactionType; // BUY or SELL
  pt.shares = shares;
}

function newTransferEntry(source: Portfolio, target: Portfolio): PortfolioTransferEntry {
  return new PortfolioTransferEntry(source, new PortfolioTransaction(), target, new PortfolioTransaction());
}

function newAccountTransferEntry(source: Account, target: Account): AccountTransferEntry {
  return new AccountTransferEntry(source, new AccountTransaction(), target, new AccountTransaction());
}

/** ClientFilterHelper.recreateTransfer(PortfolioTransferEntry, source, target[, weight]) */
function recreatePortfolioTransfer(
  entry: PortfolioTransferEntry,
  source: Portfolio,
  target: Portfolio,
  weight: Decimal = HUNDRED,
): void {
  const t = entry.transactionFrom;
  const copy = newTransferEntry(source, target);
  for (const x of [copy.transactionFrom, copy.transactionTo]) {
    x.dateTime = t.dateTime;
    x.currencyCode = t.currencyCode;
    x.security = t.security;
    x.note = t.note;
    x.shares = weightedValue(t.shares, weight);
    x.amount = weightedValue(t.amount, weight);
  }
  source.addTransaction(copy.transactionFrom);
  target.addTransaction(copy.transactionTo);
}

function recreatePortfolioTransferWeighted(
  entry: PortfolioTransferEntry,
  source: Portfolio,
  target: Portfolio,
  sourceWeight: number,
  targetWeight: number,
): void {
  const common = Math.min(sourceWeight, targetWeight);
  recreatePortfolioTransfer(entry, source, target, new D(common));
  const t = entry.transactionFrom;
  if (sourceWeight > common) source.addTransaction(excessDelivery(t, 'DELIVERY_OUTBOUND', sourceWeight - common));
  if (targetWeight > common) target.addTransaction(excessDelivery(t, 'DELIVERY_INBOUND', targetWeight - common));
}

function excessDelivery(t: PortfolioTransaction, type: PortfolioTransactionType, weight: number): PortfolioTransaction {
  const w = new D(weight);
  const delivery = new PortfolioTransaction(undefined, type);
  delivery.dateTime = t.dateTime;
  delivery.currencyCode = t.currencyCode;
  delivery.security = t.security;
  delivery.note = t.note;
  delivery.shares = weightedValue(t.shares, w);
  delivery.amount = weightedValue(t.amount, w);
  for (const u of t.units) delivery.addUnit(weightedUnit(u, w));
  return delivery;
}

/** ClientFilterHelper.recreateTransfer(AccountTransferEntry, source, target) */
function recreateAccountTransfer(entry: AccountTransferEntry, source: Account, target: Account): void {
  const t = entry.transactionFrom;
  const copy = newAccountTransferEntry(source, target);
  copy.transactionFrom.dateTime = t.dateTime;
  copy.transactionTo.dateTime = t.dateTime;
  copy.transactionFrom.note = t.note;
  copy.transactionTo.note = t.note;
  copy.transactionFrom.currencyCode = t.currencyCode;
  copy.transactionFrom.amount = t.amount;
  copy.transactionFrom.units.push(...t.units);
  const tt = entry.transactionTo;
  copy.transactionTo.currencyCode = tt.currencyCode;
  copy.transactionTo.amount = tt.amount;
  source.addTransaction(copy.transactionFrom);
  target.addTransaction(copy.transactionTo);
}

function recreateAccountTransferWeighted(
  entry: AccountTransferEntry,
  sourceAccount: Account,
  targetAccount: Account,
  sourceWeight: number,
  targetWeight: number,
): void {
  if (sourceWeight === targetWeight && sourceWeight === ONE_HUNDRED_PERCENT) {
    recreateAccountTransfer(entry, sourceAccount, targetAccount);
    return;
  }
  const common = Math.min(sourceWeight, targetWeight);
  const commonWeight = new D(common);
  const source = entry.transactionFrom;
  const target = entry.transactionTo;
  const copy = newAccountTransferEntry(sourceAccount, targetAccount);
  copy.transactionFrom.dateTime = source.dateTime;
  copy.transactionTo.dateTime = source.dateTime;
  copy.transactionFrom.note = source.note;
  copy.transactionTo.note = source.note;
  copy.transactionFrom.currencyCode = source.currencyCode;
  copy.transactionTo.currencyCode = target.currencyCode;
  copy.transactionFrom.amount = weightedValue(source.amount, commonWeight);
  copy.transactionTo.amount = weightedValue(target.amount, commonWeight);
  sourceAccount.addTransaction(copy.transactionFrom);
  targetAccount.addTransaction(copy.transactionTo);
  if (sourceWeight > common)
    sourceAccount.addTransaction(
      newAccountTx(source.dateTime, source.currencyCode, weightedValue(source.amount, new D(sourceWeight - common)), null, 'REMOVAL'),
    );
  if (targetWeight > common)
    targetAccount.addTransaction(
      newAccountTx(target.dateTime, target.currencyCode, weightedValue(target.amount, new D(targetWeight - common)), null, 'DEPOSIT'),
    );
}

// ------------------------------------------------------------------
// PortfolioClientFilter

export class PortfolioClientFilter implements ClientFilter {
  readonly portfolios: Portfolio[];
  readonly accounts: Account[];
  private readonly element2weight = new Map<Portfolio | Account, number>();

  constructor(portfolios: Portfolio[], accounts: Account[], weights?: Map<Portfolio | Account, number>) {
    this.portfolios = portfolios.slice();
    this.accounts = accounts.slice();
    if (weights) {
      const members = new Set<unknown>([...this.portfolios, ...this.accounts]);
      for (const [k, w] of weights) {
        if (w == null || !members.has(k)) continue;
        if (w < 1 || w >= ONE_HUNDRED_PERCENT) continue;
        this.element2weight.set(k, w);
      }
    }
  }

  getWeight(element: Portfolio | Account): number {
    return this.element2weight.get(element) ?? ONE_HUNDRED_PERCENT;
  }

  private getWeightBD(element: Portfolio | Account): Decimal {
    return new D(this.getWeight(element));
  }

  filter(client: Client): Client {
    const pseudoClient = readOnlyClient(client);
    const account2pseudo = new Map<Account, Account>();
    const computeReadOnlyAccount = (a: Account) => {
      const pa = readOnlyAccount(a);
      pseudoClient.accounts.push(pa);
      return pa;
    };
    for (const a of this.accounts) account2pseudo.set(a, computeReadOnlyAccount(a));
    const portfolio2pseudo = new Map<Portfolio, Portfolio>();
    for (const p of this.portfolios) {
      let pseudoAccount = account2pseudo.get(p.referenceAccount!);
      if (!pseudoAccount) {
        pseudoAccount = computeReadOnlyAccount(p.referenceAccount!);
        account2pseudo.set(p.referenceAccount!, pseudoAccount);
      }
      const pseudoPortfolio = readOnlyPortfolio(p);
      pseudoPortfolio.referenceAccount = pseudoAccount;
      pseudoClient.portfolios.push(pseudoPortfolio);
      portfolio2pseudo.set(p, pseudoPortfolio);
    }

    const usedSecurities = new Set<Security>();
    const securityWeightIndex = new Map<Account, Map<Security, number>>();
    const processedSecurityTx = new Set<AccountTransaction>();

    for (const portfolio of this.portfolios) {
      this.adaptPortfolioTransactions(portfolio, portfolio2pseudo, account2pseudo, usedSecurities, securityWeightIndex);
      if (!this.accounts.includes(portfolio.referenceAccount!))
        this.collectSecurityRelevantTx(portfolio, account2pseudo.get(portfolio.referenceAccount!)!, usedSecurities, processedSecurityTx);
    }
    for (const account of this.accounts)
      this.adaptAccountTransactions(account, account2pseudo, usedSecurities, securityWeightIndex);
    for (const s of usedSecurities) if (s) pseudoClient.securities.push(s);
    return pseudoClient;
  }

  private adaptPortfolioTransactions(
    portfolio: Portfolio,
    portfolio2pseudo: Map<Portfolio, Portfolio>,
    account2pseudo: Map<Account, Account>,
    usedSecurities: Set<Security>,
    securityWeightIndex: Map<Account, Map<Security, number>>,
  ): void {
    const pseudoPortfolio = portfolio2pseudo.get(portfolio)!;
    const portfolioWeight = this.getWeightBD(portfolio);
    const referenceAccount = portfolio.referenceAccount;
    let perSecurity: Map<Security, number> | null = null;
    if (referenceAccount) {
      perSecurity = securityWeightIndex.get(referenceAccount) ?? null;
      if (!perSecurity) securityWeightIndex.set(referenceAccount, (perSecurity = new Map()));
    }
    for (const t of portfolio.transactions) {
      const security = t.security!;
      usedSecurities.add(security);
      if (perSecurity && security)
        perSecurity.set(security, Math.max(perSecurity.get(security) ?? Number.MIN_SAFE_INTEGER, this.getWeight(portfolio)));
      const crossOwner = t.crossEntry ? t.crossEntry.getCrossOwner(t) : null;
      switch (t.type) {
        case 'BUY':
        case 'SELL':
          if (crossOwner instanceof Account && this.accounts.includes(crossOwner))
            this.recreateBuySell(t.crossEntry as BuySellEntry, pseudoPortfolio, account2pseudo.get(crossOwner)!, portfolio, crossOwner);
          else
            pseudoPortfolio.addTransaction(
              convertPortfolioTx(t, t.type === 'BUY' ? 'DELIVERY_INBOUND' : 'DELIVERY_OUTBOUND', portfolioWeight),
            );
          break;
        case 'TRANSFER_IN':
          if (crossOwner instanceof Portfolio && this.portfolios.includes(crossOwner))
            recreatePortfolioTransferWeighted(
              t.crossEntry as PortfolioTransferEntry,
              portfolio2pseudo.get(crossOwner)!,
              pseudoPortfolio,
              this.getWeight(crossOwner),
              this.getWeight(portfolio),
            );
          else pseudoPortfolio.addTransaction(convertPortfolioTx(t, 'DELIVERY_INBOUND', portfolioWeight));
          break;
        case 'TRANSFER_OUT':
          if (!(crossOwner instanceof Portfolio && this.portfolios.includes(crossOwner)))
            pseudoPortfolio.addTransaction(convertPortfolioTx(t, 'DELIVERY_OUTBOUND', portfolioWeight));
          break;
        case 'DELIVERY_INBOUND':
        case 'DELIVERY_OUTBOUND':
          pseudoPortfolio.addTransaction(isHundred(portfolioWeight) ? t : convertPortfolioTx(t, t.type, portfolioWeight));
          break;
      }
    }
  }

  private recreateBuySell(
    buySell: BuySellEntry,
    readOnlyP: Portfolio,
    readOnlyA: Account,
    portfolio: Portfolio,
    account: Account,
  ): void {
    const t = buySell.portfolioTransaction;
    const portfolioWeight = this.getWeightBD(portfolio);
    const accountWeight = this.getWeightBD(account);
    if (portfolioWeight.eq(accountWeight)) {
      const copy = newBuySell(readOnlyP, readOnlyA);
      setBuySell(copy, t, weightedValue(t.shares, portfolioWeight), weightedValue(t.amount, portfolioWeight));
      for (const u of t.units) copy.portfolioTransaction.addUnit(weightedUnit(u, portfolioWeight));
      readOnlyP.addTransaction(copy.portfolioTransaction);
      readOnlyA.addTransaction(copy.accountTransaction);
      return;
    }
    const securityAmount = weightedValue(t.amount, portfolioWeight);
    const accountAmount = weightedValue(t.amount, accountWeight);
    const commonAmount = Math.min(securityAmount, accountAmount);
    const commonWeight =
      securityAmount === 0
        ? portfolioWeight
        : new D(new DMC(new D(new DMC(commonAmount).div(securityAmount))).mul(portfolioWeight));
    const copy = newBuySell(readOnlyP, readOnlyA);
    setBuySell(copy, t, weightedValue(t.shares, commonWeight), commonAmount);
    for (const u of t.units) copy.portfolioTransaction.addUnit(weightedUnit(u, commonWeight));
    readOnlyP.addTransaction(copy.portfolioTransaction);
    readOnlyA.addTransaction(copy.accountTransaction);
    if (accountAmount - commonAmount > 0)
      readOnlyA.addTransaction(
        newAccountTx(t.dateTime, t.currencyCode, accountAmount - commonAmount, null, t.type === 'BUY' ? 'REMOVAL' : 'DEPOSIT'),
      );
    if (securityAmount - commonAmount > 0) {
      const rest = portfolioWeight.sub(commonWeight);
      const tp = new PortfolioTransaction(undefined, t.type === 'BUY' ? 'DELIVERY_INBOUND' : 'DELIVERY_OUTBOUND');
      tp.dateTime = t.dateTime;
      tp.currencyCode = t.currencyCode;
      tp.security = t.security;
      tp.note = t.note;
      tp.shares = weightedValue(t.shares, rest);
      tp.amount = securityAmount - commonAmount;
      for (const u of t.units) tp.addUnit(weightedUnit(u, rest));
      readOnlyP.addTransaction(tp);
    }
  }

  private collectSecurityRelevantTx(
    portfolio: Portfolio,
    pseudoAccount: Account,
    usedSecurities: Set<Security>,
    processed: Set<AccountTransaction>,
  ): void {
    if (!portfolio.referenceAccount) return;
    const portfolioWeight = this.getWeightBD(portfolio);
    for (const t of portfolio.referenceAccount.transactions) {
      if (t.security === null || !usedSecurities.has(t.security)) continue;
      switch (t.type) {
        case 'TAX_REFUND':
        case 'FEES_REFUND':
        case 'DIVIDENDS':
          if (!processed.has(t)) {
            pseudoAccount.addTransaction(scaledAccountTx(t, portfolioWeight));
            pseudoAccount.addTransaction(
              newAccountTx(t.dateTime, t.currencyCode, weightedValue(t.amount, portfolioWeight), null, 'REMOVAL'),
            );
            processed.add(t);
          }
          break;
        case 'TAXES':
        case 'FEES':
          if (!processed.has(t)) {
            pseudoAccount.addTransaction(scaledAccountTx(t, portfolioWeight));
            pseudoAccount.addTransaction(
              newAccountTx(t.dateTime, t.currencyCode, weightedValue(t.amount, portfolioWeight), null, 'DEPOSIT'),
            );
            processed.add(t);
          }
          break;
        default:
          break;
      }
    }
  }

  private adaptAccountTransactions(
    account: Account,
    account2pseudo: Map<Account, Account>,
    usedSecurities: Set<Security>,
    securityWeightIndex: Map<Account, Map<Security, number>>,
  ): void {
    const pseudoAccount = account2pseudo.get(account)!;
    const accountWeight = this.getWeightBD(account);
    for (const t of account.transactions) {
      const crossOwner = t.crossEntry ? t.crossEntry.getCrossOwner(t) : null;
      switch (t.type) {
        case 'BUY':
          if (!(crossOwner instanceof Portfolio && this.portfolios.includes(crossOwner)))
            pseudoAccount.addTransaction(convertAccountTx(t, 'REMOVAL', accountWeight));
          break;
        case 'SELL':
          if (!(crossOwner instanceof Portfolio && this.portfolios.includes(crossOwner)))
            pseudoAccount.addTransaction(convertAccountTx(t, 'DEPOSIT', accountWeight));
          break;
        case 'TRANSFER_IN':
          if (crossOwner instanceof Account && this.accounts.includes(crossOwner))
            recreateAccountTransferWeighted(
              t.crossEntry as AccountTransferEntry,
              account2pseudo.get(crossOwner)!,
              pseudoAccount,
              this.getWeight(crossOwner),
              this.getWeight(account),
            );
          else pseudoAccount.addTransaction(convertAccountTx(t, 'DEPOSIT', accountWeight));
          break;
        case 'TRANSFER_OUT':
          if (!(crossOwner instanceof Account && this.accounts.includes(crossOwner)))
            pseudoAccount.addTransaction(convertAccountTx(t, 'REMOVAL', accountWeight));
          break;
        case 'DIVIDENDS':
        case 'TAX_REFUND':
        case 'FEES_REFUND':
          this.addSecurityRelatedAccountTx(account, pseudoAccount, t, usedSecurities, accountWeight, 'DEPOSIT', securityWeightIndex);
          break;
        case 'TAXES':
        case 'FEES':
          this.addSecurityRelatedAccountTx(account, pseudoAccount, t, usedSecurities, accountWeight, 'REMOVAL', securityWeightIndex);
          break;
        case 'DEPOSIT':
        case 'REMOVAL':
        case 'INTEREST':
        case 'INTEREST_CHARGE':
          pseudoAccount.addTransaction(scaledAccountTx(t, accountWeight));
          break;
      }
    }
  }

  private addSecurityRelatedAccountTx(
    account: Account,
    pseudoAccount: Account,
    t: AccountTransaction,
    usedSecurities: Set<Security>,
    accountWeight: Decimal,
    fallbackType: AccountTransactionType,
    securityWeightIndex: Map<Account, Map<Security, number>>,
  ): void {
    const security = t.security;
    if (security === null) {
      pseudoAccount.addTransaction(scaledAccountTx(t, accountWeight));
      return;
    }
    if (!usedSecurities.has(security)) {
      pseudoAccount.addTransaction(convertAccountTx(t, fallbackType, accountWeight));
      return;
    }
    const perSecurity = securityWeightIndex.get(account);
    const w = perSecurity?.get(security) ?? this.getWeight(account);
    const securityWeight = new D(w);
    pseudoAccount.addTransaction(scaledAccountTx(t, securityWeight));
    const securityAmount = weightedValue(t.amount, securityWeight);
    const accountAmount = weightedValue(t.amount, accountWeight);
    const delta = accountAmount - securityAmount;
    if (delta !== 0) {
      const deltaType: AccountTransactionType = delta > 0 !== isDebit(t.type) ? 'DEPOSIT' : 'REMOVAL';
      pseudoAccount.addTransaction(newAccountTx(t.dateTime, t.currencyCode, Math.abs(delta), null, deltaType));
    }
  }
}

function scaledAccountTx(t: AccountTransaction, weight: Decimal): AccountTransaction {
  if (isHundred(weight)) return t;
  const clone = new AccountTransaction(undefined, t.type);
  clone.dateTime = t.dateTime;
  clone.currencyCode = t.currencyCode;
  clone.security = t.security;
  clone.note = t.note;
  clone.amount = weightedValue(t.amount, weight);
  clone.shares = weightedValue(t.shares, weight);
  for (const u of t.units) clone.addUnit(weightedUnit(u, weight));
  return clone;
}

function convertPortfolioTx(t: PortfolioTransaction, type: PortfolioTransactionType, weight: Decimal): PortfolioTransaction {
  const clone = new PortfolioTransaction(undefined, type);
  clone.dateTime = t.dateTime;
  clone.currencyCode = t.currencyCode;
  clone.security = t.security;
  clone.note = t.note;
  clone.amount = weightedValue(t.amount, weight);
  clone.shares = weightedValue(t.shares, weight);
  for (const u of t.units) clone.addUnit(weightedUnit(u, weight));
  return clone;
}

function convertAccountTx(t: AccountTransaction, type: AccountTransactionType, weight: Decimal): AccountTransaction {
  const clone = new AccountTransaction(undefined, type);
  clone.dateTime = t.dateTime;
  clone.currencyCode = t.currencyCode;
  clone.security = null;
  clone.note = t.note;
  clone.amount = weightedValue(t.amount, weight);
  clone.shares = weightedValue(t.shares, weight);
  return clone;
}

// ------------------------------------------------------------------
// ClientSecurityFilter

/** Security#getTransactions(Client) */
export function getSecurityTransactions(
  security: Security,
  client: Client,
): { owner: TransactionOwner; transaction: Transaction }[] {
  const answer: { owner: TransactionOwner; transaction: Transaction }[] = [];
  for (const account of client.accounts)
    for (const t of account.transactions)
      if (
        t.security === security &&
        (t.type === 'INTEREST' ||
          t.type === 'DIVIDENDS' ||
          t.type === 'TAXES' ||
          t.type === 'TAX_REFUND' ||
          t.type === 'FEES' ||
          t.type === 'FEES_REFUND')
      )
        answer.push({ owner: account, transaction: t });
  for (const portfolio of client.portfolios)
    for (const t of portfolio.transactions) if (t.security === security) answer.push({ owner: portfolio, transaction: t });
  return answer;
}

export class ClientSecurityFilter implements ClientFilter {
  private readonly securities: Security[];
  constructor(...securities: Security[]) {
    this.securities = securities;
  }

  filter(client: Client): Client {
    const pseudoClient = readOnlyClient(client);
    const account2readonly = new Map<Account, Account>();
    const portfolio2readonly = new Map<Portfolio, Portfolio>();
    const transformAccount = (a: Account) => {
      let r = account2readonly.get(a);
      if (!r) {
        r = readOnlyAccount(a);
        account2readonly.set(a, r);
        pseudoClient.accounts.push(r);
      }
      return r;
    };
    const transformPortfolio = (p: Portfolio) => {
      let r = portfolio2readonly.get(p);
      if (!r) {
        r = readOnlyPortfolio(p);
        // order as in Java: account is transformed before the portfolio is added
        r.referenceAccount = transformAccount(p.referenceAccount!);
        portfolio2readonly.set(p, r);
        pseudoClient.portfolios.push(r);
      }
      return r;
    };
    for (const security of this.securities) {
      pseudoClient.securities.push(security);
      for (const pair of getSecurityTransactions(security, client)) {
        const t = pair.transaction;
        if (t instanceof PortfolioTransaction) {
          const owner = pair.owner as Portfolio;
          switch (t.type) {
            case 'BUY':
            case 'DELIVERY_INBOUND':
              transformPortfolio(owner).addTransaction(toDelivery(t, 'DELIVERY_INBOUND'));
              break;
            case 'SELL':
            case 'DELIVERY_OUTBOUND':
              transformPortfolio(owner).addTransaction(toDelivery(t, 'DELIVERY_OUTBOUND'));
              break;
            case 'TRANSFER_IN': {
              const entry = t.crossEntry as PortfolioTransferEntry;
              const source = transformPortfolio(entry.portfolioFrom);
              const target = transformPortfolio(entry.portfolioTo);
              recreatePortfolioTransfer(entry, source, target);
              break;
            }
            case 'TRANSFER_OUT':
              break;
          }
        } else if (t instanceof AccountTransaction) {
          const owner = pair.owner as Account;
          switch (t.type) {
            case 'DIVIDENDS': {
              const taxes = t.getUnitSum('TAX').amount;
              const copy = newAccountTx(t.dateTime, t.currencyCode, t.amount + taxes, t.security, t.type);
              copy.note = t.note;
              for (const u of t.units) if (u.type !== 'TAX') copy.addUnit(u);
              transformAccount(owner).addTransaction(copy);
              transformAccount(owner).addTransaction(newAccountTx(t.dateTime, t.currencyCode, t.amount + taxes, null, 'REMOVAL'));
              break;
            }
            case 'FEES':
              transformAccount(owner).addTransaction(t);
              transformAccount(owner).addTransaction(newAccountTx(t.dateTime, t.currencyCode, t.amount, null, 'DEPOSIT'));
              break;
            case 'FEES_REFUND':
              transformAccount(owner).addTransaction(t);
              transformAccount(owner).addTransaction(newAccountTx(t.dateTime, t.currencyCode, t.amount, null, 'REMOVAL'));
              break;
            case 'TAXES':
            case 'TAX_REFUND':
              break;
            default:
              throw new Error('unsupported type ' + t.type);
          }
        }
      }
    }
    return pseudoClient;
  }
}

function toDelivery(t: PortfolioTransaction, targetType: PortfolioTransactionType): PortfolioTransaction {
  const pseudo = new PortfolioTransaction(undefined, targetType);
  pseudo.dateTime = t.dateTime;
  pseudo.currencyCode = t.currencyCode;
  pseudo.security = t.security;
  pseudo.note = t.note;
  pseudo.shares = t.shares;
  const taxes = t.getUnitSum('TAX').amount;
  pseudo.amount = targetType === 'DELIVERY_INBOUND' ? t.amount - taxes : t.amount + taxes;
  for (const u of t.units) if (u.type !== 'TAX') pseudo.addUnit(u);
  return pseudo;
}

// ------------------------------------------------------------------
// ClientClassificationFilter

export class ClientClassificationFilter implements ClientFilter {
  constructor(private readonly classification: Classification) {}

  filter(client: Client): Client {
    const pseudoClient = readOnlyClient(client);
    const account2readonly = new Map<Account, Account>();
    const portfolio2readonly = new Map<Portfolio, Portfolio>();
    const categorizedAccounts = new Set<Account>();
    const categorizedSecurities = new Set<Security>();
    const vehicle2weight = new Map<InvestmentVehicle, Decimal>();
    this.classification.accept({
      visitAssignment: (_c: Classification, assignment: Assignment) => {
        const vehicle = assignment.investmentVehicle;
        vehicle2weight.set(vehicle, (vehicle2weight.get(vehicle) ?? new D(0)).add(assignment.weight));
        if (vehicle instanceof Account) categorizedAccounts.add(vehicle);
        else if (vehicle instanceof Security && vehicle.currencyCode != null) categorizedSecurities.add(vehicle);
      },
    });
    const isCatSecurity = (s: Security | null) => s !== null && categorizedSecurities.has(s);
    const isCatAccount = (a: Account) => categorizedAccounts.has(a.unwrap());
    const getWeight = (v: InvestmentVehicle): Decimal =>
      vehicle2weight.get(v instanceof Account ? v.unwrap() : v) ?? new D(0);

    for (const account of client.accounts) {
      const pseudo = readOnlyAccount(account);
      pseudoClient.accounts.push(pseudo);
      account2readonly.set(account, pseudo);
    }
    for (const portfolio of client.portfolios) {
      const pseudo = readOnlyPortfolio(portfolio);
      pseudo.referenceAccount = account2readonly.get(portfolio.referenceAccount!) ?? null;
      pseudoClient.portfolios.push(pseudo);
      portfolio2readonly.set(portfolio, pseudo);
    }
    const ro = (a: Account) => account2readonly.get(a)!;
    const rp = (p: Portfolio) => portfolio2readonly.get(p)!;

    // portfolio transactions
    for (const portfolio of client.portfolios) {
      for (const t of portfolio.transactions) {
        if (!isCatSecurity(t.security)) continue;
        switch (t.type) {
          case 'BUY':
          case 'SELL': {
            const account = t.crossEntry!.getCrossOwner(t) as Account;
            if (!isCatAccount(account))
              addDeliveryT(rp(portfolio), t, t.type === 'BUY' ? 'DELIVERY_INBOUND' : 'DELIVERY_OUTBOUND', getWeight(t.security!));
            else this.addBuySellT(rp(portfolio), ro(account), t, getWeight(t.security!), getWeight(account));
            break;
          }
          case 'DELIVERY_INBOUND':
          case 'DELIVERY_OUTBOUND':
            addDeliveryT(rp(portfolio), t, t.type, getWeight(t.security!));
            break;
          case 'TRANSFER_OUT':
            break;
          case 'TRANSFER_IN': {
            const entry = t.crossEntry as PortfolioTransferEntry;
            recreatePortfolioTransfer(entry, rp(entry.portfolioFrom), rp(entry.portfolioTo), getWeight(t.security!));
            break;
          }
        }
      }
    }

    // account transactions
    for (const account of client.accounts) {
      if (isCatAccount(account)) {
        const accountWeight = getWeight(account);
        const pseudo = ro(account);
        for (const t of account.transactions) {
          const amount = weightedValue(t.amount, accountWeight);
          switch (t.type) {
            case 'SELL':
              if (!isCatSecurity(t.security)) pseudo.addTransaction(copyWithNote(t, amount, 'DEPOSIT'));
              break;
            case 'BUY':
              if (!isCatSecurity(t.security)) pseudo.addTransaction(copyWithNote(t, amount, 'REMOVAL'));
              break;
            case 'DIVIDENDS':
              if (!isCatSecurity(t.security)) pseudo.addTransaction(copyWithNote(t, amount, 'DEPOSIT'));
              else addSecurityRelatedAccountT(pseudo, t, accountWeight, getWeight(t.security!));
              break;
            case 'FEES_REFUND':
              if (t.security !== null && isCatSecurity(t.security))
                addSecurityRelatedAccountT(pseudo, t, accountWeight, getWeight(t.security));
              else if (t.security !== null) pseudo.addTransaction(copyWithNote(t, amount, 'DEPOSIT'));
              else pseudo.addTransaction(copyWithNote(t, amount, t.type));
              break;
            case 'FEES':
              if (t.security !== null && isCatSecurity(t.security))
                addSecurityRelatedAccountT(pseudo, t, accountWeight, getWeight(t.security));
              else if (t.security !== null) pseudo.addTransaction(copyWithNote(t, amount, 'REMOVAL'));
              else pseudo.addTransaction(copyWithNote(t, amount, t.type));
              break;
            case 'TRANSFER_IN': {
              const other = t.crossEntry!.getCrossOwner(t) as Account;
              if (!isCatAccount(other)) pseudo.addTransaction(copyWithNote(t, amount, 'DEPOSIT'));
              else this.addTransferT(t, account, other, ro, getWeight);
              break;
            }
            case 'TRANSFER_OUT': {
              const other = t.crossEntry!.getCrossOwner(t) as Account;
              if (!isCatAccount(other)) pseudo.addTransaction(copyWithNote(t, amount, 'REMOVAL'));
              break;
            }
            case 'TAX_REFUND':
              pseudo.addTransaction(copyWithNote(t, amount, 'DEPOSIT'));
              break;
            case 'TAXES':
              pseudo.addTransaction(copyWithNote(t, amount, 'REMOVAL'));
              break;
            case 'DEPOSIT':
            case 'REMOVAL':
            case 'INTEREST':
            case 'INTEREST_CHARGE': {
              const taxes = weightedValue(t.getUnitSum('TAX').amount, accountWeight);
              pseudo.addTransaction(copyWithNote(t, amount + taxes, t.type));
              if (taxes !== 0) pseudo.addTransaction(newAccountTx(t.dateTime, t.currencyCode, taxes, null, 'REMOVAL'));
              break;
            }
          }
        }
      } else {
        const pseudo = ro(account);
        for (const t of account.transactions) {
          if (t.security === null || !isCatSecurity(t.security)) continue;
          const weight = getWeight(t.security);
          switch (t.type) {
            case 'DIVIDENDS': {
              const taxes = weightedValue(t.getUnitSum('TAX').amount, weight);
              const amount = weightedValue(t.amount, weight);
              const copy = newAccountTx(t.dateTime, t.currencyCode, amount + taxes, t.security, t.type);
              copy.note = t.note;
              for (const u of t.units) if (u.type !== 'TAX') copy.addUnit(weightedUnit(u, weight));
              pseudo.addTransaction(copy);
              pseudo.addTransaction(newAccountTx(t.dateTime, t.currencyCode, amount + taxes, null, 'REMOVAL'));
              break;
            }
            case 'FEES': {
              const feeCopy = newAccountTx(t.dateTime, t.currencyCode, weightedValue(t.amount, weight), t.security, t.type);
              feeCopy.note = t.note;
              pseudo.addTransaction(feeCopy);
              pseudo.addTransaction(newAccountTx(t.dateTime, t.currencyCode, weightedValue(t.amount, weight), null, 'DEPOSIT'));
              break;
            }
            case 'FEES_REFUND': {
              const refundCopy = newAccountTx(t.dateTime, t.currencyCode, weightedValue(t.amount, weight), t.security, t.type);
              refundCopy.note = t.note;
              pseudo.addTransaction(refundCopy);
              pseudo.addTransaction(newAccountTx(t.dateTime, t.currencyCode, weightedValue(t.amount, weight), null, 'REMOVAL'));
              break;
            }
            default:
              break;
          }
        }
      }
    }
    for (const s of categorizedSecurities) pseudoClient.securities.push(s);
    return pseudoClient;
  }

  private addBuySellT(
    pseudoPortfolio: Portfolio,
    pseudoAccount: Account,
    t: PortfolioTransaction,
    securityWeight: Decimal,
    accountWeight: Decimal,
  ): void {
    const taxes = weightedValue(t.getUnitSum('TAX').amount, securityWeight);
    let securityAmount = weightedValue(t.amount, securityWeight);
    securityAmount = t.type === 'BUY' ? securityAmount - taxes : securityAmount + taxes;
    const accountAmount = weightedValue(t.amount, accountWeight);
    const commonAmount = Math.min(securityAmount, accountAmount);
    const commonWeight =
      securityAmount === 0
        ? securityWeight
        : new D(new DMC(new D(new DMC(commonAmount).div(securityAmount))).mul(securityWeight));
    const copy = newBuySell(pseudoPortfolio, pseudoAccount);
    setBuySell(copy, t, weightedValue(t.shares, commonWeight), commonAmount);
    for (const u of t.units) if (u.type !== 'TAX') copy.portfolioTransaction.addUnit(weightedUnit(u, commonWeight));
    pseudoPortfolio.addTransaction(copy.portfolioTransaction);
    pseudoAccount.addTransaction(copy.accountTransaction);
    if (accountAmount - commonAmount > 0)
      pseudoAccount.addTransaction(
        newAccountTx(t.dateTime, t.currencyCode, accountAmount - commonAmount, null, t.type === 'BUY' ? 'REMOVAL' : 'DEPOSIT'),
      );
    if (securityAmount - commonAmount > 0) {
      const rest = securityWeight.sub(commonWeight);
      const tp = new PortfolioTransaction(undefined, t.type === 'BUY' ? 'DELIVERY_INBOUND' : 'DELIVERY_OUTBOUND');
      tp.dateTime = t.dateTime;
      tp.currencyCode = t.currencyCode;
      tp.security = t.security;
      tp.note = t.note;
      tp.shares = weightedValue(t.shares, rest);
      tp.amount = securityAmount - commonAmount;
      for (const u of t.units) if (u.type !== 'TAX') tp.addUnit(weightedUnit(u, rest));
      pseudoPortfolio.addTransaction(tp);
    }
  }

  private addTransferT(
    t: AccountTransaction,
    inboundAccount: Account,
    outboundAccount: Account,
    ro: (a: Account) => Account,
    getWeight: (v: InvestmentVehicle) => Decimal,
  ): void {
    const inboundWeight = getWeight(inboundAccount);
    const outboundWeight = getWeight(outboundAccount);
    const entry = t.crossEntry as AccountTransferEntry;
    if (inboundWeight.eq(outboundWeight) && isHundred(inboundWeight)) {
      ro(inboundAccount).addTransaction(t);
      ro(outboundAccount).addTransaction(entry.getCrossTransaction(t) as AccountTransaction);
    } else if (inboundWeight.eq(outboundWeight)) {
      const copy = createTransferEntry(entry, inboundWeight);
      ro(inboundAccount).addTransaction(copy.transactionTo);
      ro(outboundAccount).addTransaction(copy.transactionFrom);
    } else if (inboundWeight.lt(outboundWeight)) {
      const copy = createTransferEntry(entry, inboundWeight);
      ro(inboundAccount).addTransaction(copy.transactionTo);
      ro(outboundAccount).addTransaction(copy.transactionFrom);
      const ot = entry.getCrossTransaction(t) as AccountTransaction;
      ro(outboundAccount).addTransaction(
        newAccountTx(ot.dateTime, ot.currencyCode, weightedValue(ot.amount, outboundWeight.sub(inboundWeight)), null, 'REMOVAL'),
      );
    } else {
      const copy = createTransferEntry(entry, outboundWeight);
      ro(inboundAccount).addTransaction(copy.transactionTo);
      ro(outboundAccount).addTransaction(copy.transactionFrom);
      ro(inboundAccount).addTransaction(
        newAccountTx(t.dateTime, t.currencyCode, weightedValue(t.amount, inboundWeight.sub(outboundWeight)), null, 'DEPOSIT'),
      );
    }
  }
}

function createTransferEntry(entry: AccountTransferEntry, weight: Decimal): AccountTransferEntry {
  // AccountTransferEntry() without accounts
  const from = new AccountTransaction();
  const to = new AccountTransaction();
  const copy = new AccountTransferEntry(null as unknown as Account, from, null as unknown as Account, to);
  from.dateTime = entry.transactionFrom.dateTime;
  to.dateTime = entry.transactionFrom.dateTime;
  from.note = entry.transactionFrom.note;
  to.note = entry.transactionFrom.note;
  from.currencyCode = entry.transactionFrom.currencyCode;
  to.currencyCode = entry.transactionTo.currencyCode;
  from.amount = weightedValue(entry.transactionFrom.amount, weight);
  to.amount = weightedValue(entry.transactionTo.amount, weight);
  return copy;
}

function addDeliveryT(pseudoPortfolio: Portfolio, t: PortfolioTransaction, targetType: PortfolioTransactionType, weight: Decimal): void {
  const copy = new PortfolioTransaction(undefined, targetType);
  copy.dateTime = t.dateTime;
  copy.currencyCode = t.currencyCode;
  copy.security = t.security;
  copy.note = t.note;
  copy.shares = weightedValue(t.shares, weight);
  const taxes = weightedValue(t.getUnitSum('TAX').amount, weight);
  const amount = weightedValue(t.amount, weight);
  copy.amount = targetType === 'DELIVERY_INBOUND' ? amount - taxes : amount + taxes;
  for (const u of t.units) if (u.type !== 'TAX') copy.addUnit(weightedUnit(u, weight));
  pseudoPortfolio.addTransaction(copy);
}

function copyWithNote(source: AccountTransaction, amount: number, type: AccountTransactionType): AccountTransaction {
  const copy = newAccountTx(source.dateTime, source.currencyCode, amount, null, type);
  copy.note = source.note;
  return copy;
}

function addSecurityRelatedAccountT(pseudoAccount: Account, t: AccountTransaction, accountWeight: Decimal, securityWeight: Decimal): void {
  const taxes = weightedValue(t.getUnitSum('TAX').amount, securityWeight);
  const amount = weightedValue(t.amount, securityWeight);
  const copy = newAccountTx(t.dateTime, t.currencyCode, amount + taxes, t.security, t.type);
  copy.note = t.note;
  for (const u of t.units) if (u.type !== 'TAX') copy.addUnit(weightedUnit(u, securityWeight));
  pseudoAccount.addTransaction(copy);
  const accountAmount = weightedValue(t.amount, accountWeight);
  const delta = accountAmount - amount - taxes;
  if (delta !== 0) {
    const deltaType: AccountTransactionType = delta > 0 !== isDebit(t.type) ? 'DEPOSIT' : 'REMOVAL';
    pseudoAccount.addTransaction(newAccountTx(t.dateTime, t.currencyCode, Math.abs(delta), null, deltaType));
  }
}

// ------------------------------------------------------------------
// WithoutTaxesFilter

export class WithoutTaxesFilter implements ClientFilter {
  filter(client: Client): Client {
    const pseudoClient = readOnlyClient(client);
    pseudoClient.securities.push(...client.securities);
    const account2pseudo = new Map<Account, Account>();
    for (const a of client.accounts) {
      const pa = readOnlyAccount(a);
      pseudoClient.accounts.push(pa);
      account2pseudo.set(a, pa);
    }
    const portfolio2pseudo = new Map<Portfolio, Portfolio>();
    for (const p of client.portfolios) {
      const pp = readOnlyPortfolio(p);
      pp.referenceAccount = account2pseudo.get(p.referenceAccount!) ?? null;
      pseudoClient.portfolios.push(pp);
      portfolio2pseudo.set(p, pp);
    }
    for (const portfolio of client.portfolios) {
      const pseudoPortfolio = portfolio2pseudo.get(portfolio)!;
      for (const t of portfolio.transactions) {
        switch (t.type) {
          case 'BUY':
          case 'SELL': {
            const readOnlyA = account2pseudo.get(t.crossEntry!.getCrossOwner(t) as Account)!;
            const isBuy = t.type === 'BUY';
            const taxes = t.getUnitSum('TAX');
            const copy = newBuySell(pseudoPortfolio, readOnlyA);
            setBuySell(copy, t, t.shares, isBuy ? t.amount - taxes.amount : t.amount + taxes.amount);
            for (const u of t.units) if (u.type !== 'TAX') copy.portfolioTransaction.addUnit(u);
            pseudoPortfolio.addTransaction(copy.portfolioTransaction);
            readOnlyA.addTransaction(copy.accountTransaction);
            const at = new AccountTransaction(undefined, 'REMOVAL');
            at.dateTime = t.dateTime;
            at.currencyCode = taxes.currencyCode;
            at.amount = taxes.amount;
            readOnlyA.addTransaction(at);
            break;
          }
          case 'DELIVERY_INBOUND':
          case 'DELIVERY_OUTBOUND': {
            const isInbound = t.type === 'DELIVERY_INBOUND';
            const taxes = t.getUnitSum('TAX');
            const copy = new PortfolioTransaction(undefined, t.type);
            copy.dateTime = t.dateTime;
            copy.currencyCode = t.currencyCode;
            copy.security = t.security;
            copy.note = t.note;
            copy.shares = t.shares;
            copy.amount = isInbound ? t.amount - taxes.amount : t.amount + taxes.amount;
            for (const u of t.units) if (u.type !== 'TAX') copy.addUnit(u);
            pseudoPortfolio.addTransaction(copy);
            break;
          }
          case 'TRANSFER_IN':
            recreatePortfolioTransfer(
              t.crossEntry as PortfolioTransferEntry,
              portfolio2pseudo.get(t.crossEntry!.getCrossOwner(t) as Portfolio)!,
              pseudoPortfolio,
            );
            break;
          case 'TRANSFER_OUT':
            break;
        }
      }
    }
    for (const account of client.accounts) {
      const pseudoAccount = account2pseudo.get(account)!;
      for (const t of account.transactions) {
        switch (t.type) {
          case 'TAX_REFUND':
          case 'TAXES': {
            const clone = new AccountTransaction(undefined, t.type === 'TAX_REFUND' ? 'DEPOSIT' : 'REMOVAL');
            clone.dateTime = t.dateTime;
            clone.currencyCode = t.currencyCode;
            clone.security = null;
            clone.note = t.note;
            clone.amount = t.amount;
            clone.shares = t.shares;
            pseudoAccount.addTransaction(clone);
            break;
          }
          case 'DIVIDENDS':
          case 'INTEREST': {
            const taxes = t.getUnitSum('TAX');
            if (taxes.amount === 0) {
              pseudoAccount.addTransaction(t);
              break;
            }
            const copy = new AccountTransaction(undefined, t.type);
            copy.dateTime = t.dateTime;
            copy.currencyCode = t.currencyCode;
            copy.amount = t.amount + taxes.amount;
            copy.note = t.note;
            copy.shares = t.shares;
            copy.security = t.security;
            for (const u of t.units) if (u.type !== 'TAX') copy.addUnit(u);
            pseudoAccount.addTransaction(copy);
            const removal = new AccountTransaction(undefined, 'REMOVAL');
            removal.dateTime = t.dateTime;
            removal.currencyCode = taxes.currencyCode;
            removal.amount = taxes.amount;
            pseudoAccount.addTransaction(removal);
            break;
          }
          case 'BUY':
          case 'SELL':
          case 'TRANSFER_OUT':
            break;
          case 'TRANSFER_IN':
            recreateAccountTransfer(
              t.crossEntry as AccountTransferEntry,
              account2pseudo.get(t.crossEntry!.getCrossOwner(t) as Account)!,
              pseudoAccount,
            );
            break;
          default:
            pseudoAccount.addTransaction(t);
        }
      }
    }
    return pseudoClient;
  }
}

/** composition of filters (as used by the UI: client filter + without taxes) */
export function chainFilters(...filters: ClientFilter[]): ClientFilter {
  return { filter: (c) => filters.reduce((acc, f) => f.filter(acc), c) };
}

export function emptyFilter(): ClientFilter {
  return {
    filter: (client) => {
      const pseudoClient = readOnlyClient(client);
      const account = new Account();
      const portfolio = new Portfolio();
      portfolio.referenceAccount = account;
      const pa = readOnlyAccount(account);
      pseudoClient.accounts.push(pa);
      const pp = readOnlyPortfolio(portfolio);
      pp.referenceAccount = pa;
      pseudoClient.portfolios.push(pp);
      return pseudoClient;
    },
  };
}
