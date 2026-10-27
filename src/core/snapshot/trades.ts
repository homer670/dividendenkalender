// name.abuchen.portfolio.snapshot.trades.* and math.Apportionment

import {
  Account,
  AccountTransaction,
  BuySellEntry,
  Client,
  compareByDate,
  isPurchase,
  Portfolio,
  PortfolioTransaction,
  PortfolioTransferEntry,
  Security,
  Transaction,
  TransactionOwner,
} from '../model';
import { LocalDate, LocalDateTime, SECONDS_PER_DAY, today, toLocalDate } from '../util/dates';
import { Interval } from '../util/interval';
import { Money, money, moneyMultiplyAndRound, Values } from '../money/money';
import { convertMoney, CurrencyConverter } from '../money/exchange';
import { D, HALF_DOWN, javaRound, toLong } from '../util/decimal';
import { calculateIRR, javaSummingDouble } from '../math/irr';
import { grossValueConverted, marketValue } from './clientSnapshot';
import { getSecurityTransactions } from './filters';
import { monetaryAmountConverted, SecurityPerformanceSnapshot } from './securityPerformance';

export const LOCAL_DATE_MIN: LocalDate = -100_000_000;

export interface TransactionPair<T extends Transaction = Transaction> {
  owner: TransactionOwner;
  transaction: T;
}

/** TradeCollector.ByDateAndType */
export function compareByDateAndType(t1: TransactionPair, t2: TransactionPair): number {
  const dt1 = t1.transaction.dateTime;
  const dt2 = t2.transaction.dateTime;
  const d1 = toLocalDate(dt1);
  const d2 = toLocalDate(dt2);
  if (d1 !== d2) return dt1 < dt2 ? -1 : dt1 > dt2 ? 1 : 0;
  const hasTime1 = Math.floor((dt1 - d1 * SECONDS_PER_DAY) / 60) !== 0;
  const hasTime2 = Math.floor((dt2 - d2 * SECONDS_PER_DAY) / 60) !== 0;
  if (hasTime1 && hasTime2) return dt1 < dt2 ? -1 : dt1 > dt2 ? 1 : 0;
  return sortOrder(t1) - sortOrder(t2);
}

function sortOrder(pair: TransactionPair): number {
  const tx = pair.transaction;
  if (tx instanceof PortfolioTransaction) {
    if (tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT') return 2;
    return isPurchase(tx.type) ? 1 : 3;
  }
  const at = tx as AccountTransaction;
  if (at.type === 'TRANSFER_IN' || at.type === 'TRANSFER_OUT') return 2;
  return ['REMOVAL', 'INTEREST_CHARGE', 'FEES', 'TAXES', 'BUY', 'TRANSFER_OUT'].includes(at.type) ? 1 : 3;
}

/** Apportionment.distribute (largest remainder method) */
export function distribute(total: number, weights: number[]): number[] {
  if (weights.length === 0) throw new Error('no weights given');
  let sumOfWeights = 0n;
  for (const w of weights) {
    if (w < 0) throw new Error('negative weight ' + w);
    sumOfWeights += BigInt(w);
  }
  if (sumOfWeights === 0n) throw new Error('weights must not all be zero');
  const bigTotal = BigInt(total);
  const answer: number[] = new Array(weights.length);
  const remainders: bigint[] = new Array(weights.length);
  let distributed = 0;
  for (let ii = 0; ii < weights.length; ii++) {
    const product = bigTotal * BigInt(weights[ii]);
    let quotient = product / sumOfWeights;
    let remainder = product % sumOfWeights;
    if (remainder < 0n) {
      quotient -= 1n;
      remainder += sumOfWeights;
    }
    answer[ii] = Number(quotient);
    remainders[ii] = remainder;
    distributed += answer[ii];
  }
  const leftover = total - distributed;
  if (leftover > 0) {
    const order = weights.map((_, i) => i);
    order.sort((a, b) => {
      const byRemainder = remainders[b] > remainders[a] ? 1 : remainders[b] < remainders[a] ? -1 : 0;
      return byRemainder !== 0 ? byRemainder : a - b;
    });
    for (let ii = 0; ii < leftover; ii++) answer[order[ii]]++;
  }
  return answer;
}

export class TradeCollectorException extends Error {}

export type TradeGrouping = 'COMBINED' | 'PER_LOT';

interface CollateralLot {
  shares: number;
  amount: number;
}

function releaseCollateral(lots: CollateralLot[], sharesToCover: number): number {
  let released = 0;
  let remainingShares = sharesToCover;
  while (remainingShares > 0 && lots.length > 0) {
    const lot = lots[0];
    if (remainingShares >= lot.shares) {
      released += lot.amount;
      remainingShares -= lot.shares;
      lots.shift();
    } else if (lot.shares > 0) {
      const fraction = remainingShares / lot.shares;
      const partialAmount = lot.amount * fraction;
      released += partialAmount;
      lot.amount -= partialAmount;
      lot.shares -= remainingShares;
      remainingShares = 0;
    } else {
      lots.shift();
    }
  }
  return released;
}

type SnapshotCache = Map<string, SecurityPerformanceSnapshot>;

export class Trade {
  start: LocalDateTime = 0;
  end: LocalDateTime | null = null;
  realClosingTransaction: PortfolioTransaction | null = null;
  transactions: TransactionPair<PortfolioTransaction>[] = [];
  entryValue!: Money;
  entryValueWithoutTaxesAndFees!: Money;
  exitValue!: Money;
  exitValueWithoutTaxesAndFees!: Money;
  holdingPeriod = 0;
  irr = 0;
  private entryValueMovingAverageFn: () => Money | null = () => null;
  private entryValueMovingAverageWithoutTaxesAndFeesFn: () => Money | null = () => null;

  constructor(
    readonly security: Security,
    readonly portfolio: Portfolio,
    readonly shares: number,
  ) {}

  isLong(): boolean {
    return isPurchase(this.transactions[0].transaction.type);
  }

  calculate(client: Client, converter: CurrencyConverter, cache: SnapshotCache): void {
    const isLong = this.isLong();
    const term = converter.termCurrency;
    const sum = (filter: (t: PortfolioTransaction) => boolean, f: (t: PortfolioTransaction) => Money) => {
      let s = 0;
      for (const p of this.transactions) if (filter(p.transaction)) s += f(p.transaction).amount;
      return money(term, s);
    };
    this.entryValue = sum((t) => isPurchase(t.type) === isLong, (t) => monetaryAmountConverted(t, converter));
    this.entryValueWithoutTaxesAndFees = sum((t) => isPurchase(t.type) === isLong, (t) => grossValueConverted(t, converter));
    if (this.end !== null) {
      const end = this.end;
      this.exitValue = sum((t) => !isPurchase(t.type) === isLong, (t) => monetaryAmountConverted(t, converter));
      this.exitValueWithoutTaxesAndFees = sum((t) => !isPurchase(t.type) === isLong, (t) => grossValueConverted(t, converter));
      let s = 0;
      for (const p of this.transactions)
        if (isPurchase(p.transaction.type) === isLong) s += p.transaction.shares * Math.abs(toLocalDate(end) - p.transaction.date);
      this.holdingPeriod = javaRound(s / this.shares);
    } else {
      const now = today();
      const mv = marketValue(this.shares, this.security.getSecurityPrice(now).value);
      this.exitValue = convertMoney(converter, now, money(this.security.currencyCode, mv));
      this.exitValueWithoutTaxesAndFees = this.exitValue;
      let s = 0;
      for (const p of this.transactions)
        if (isPurchase(p.transaction.type) === isLong) s += p.transaction.shares * Math.abs(now - p.transaction.date);
      this.holdingPeriod = javaRound(s / this.shares);
    }
    this.transactions.sort((a, b) => compareByDate(a.transaction, b.transaction));
    this.start = this.transactions[0].transaction.dateTime;
    this.calculateIRR(converter);
    let maDone = false;
    let ma: Money | null = null;
    this.entryValueMovingAverageFn = () => {
      if (!maDone) {
        ma = this.getMovingAverageCost(client, converter, cache, 'INCLUDED');
        maDone = true;
      }
      return ma;
    };
    let maNetDone = false;
    let maNet: Money | null = null;
    this.entryValueMovingAverageWithoutTaxesAndFeesFn = () => {
      if (!maNetDone) {
        maNet = this.getMovingAverageCost(client, converter, cache, 'NOT_INCLUDED');
        maNetDone = true;
      }
      return maNet;
    };
  }

  private calculateIRR(converter: CurrencyConverter): void {
    const dates: LocalDate[] = [];
    const values: number[] = [];
    let totalCollateral = 0;
    let remainingCollateral = 0;
    const lots: CollateralLot[] = [];
    const isLong = this.isLong();
    for (const p of this.transactions) {
      const t = p.transaction;
      dates.push(t.date);
      let amount = monetaryAmountConverted(t, converter).amount / Values.Amount.divider;
      if (isPurchase(t.type) === isLong) {
        if (!isLong) {
          lots.push({ shares: t.shares, amount });
          totalCollateral += amount;
          remainingCollateral += amount;
        }
        amount = -amount;
      } else if (!isLong) {
        const released = releaseCollateral(lots, t.shares);
        remainingCollateral = Math.max(0, remainingCollateral - released);
        amount = released - amount;
      }
      values.push(amount);
    }
    if (this.end === null) {
      dates.push(today());
      let amount = this.exitValue.amount / Values.Amount.divider;
      if (!isLong) amount = remainingCollateral - amount;
      values.push(amount);
    }
    if (!isLong) {
      dates.push(this.end === null ? today() : toLocalDate(this.end));
      values.push(totalCollateral);
    }
    this.irr = calculateIRR(dates, values);
  }

  private getMovingAverageCost(
    client: Client,
    converter: CurrencyConverter,
    cache: SnapshotCache,
    taxesAndFees: 'INCLUDED' | 'NOT_INCLUDED',
  ): Money | null {
    if (!this.isLong()) return null;
    const closing = this.realClosingTransaction;
    const interval = Interval.of(LOCAL_DATE_MIN, closing !== null ? closing.date : today());
    const key = `${this.security.uuid}|${closing ? closing.uuid + ':' + closing.hash : 'open'}|${converter.termCurrency}|${interval.start}|${interval.end}`;
    let snapshot = cache.get(key);
    if (!snapshot) {
      const filteredClient = closing !== null ? transactionFilter(this.security, closing, client) : client;
      snapshot = SecurityPerformanceSnapshot.create(filteredClient, converter, interval);
      cache.set(key, snapshot);
    }
    const r = snapshot.getRecord(this.security);
    if (!r) return null;
    const totalCosts = r.getCost('MOVING_AVERAGE', taxesAndFees);
    const totalShares = r.getSharesHeld();
    if (totalShares <= 0) return money(totalCosts.currencyCode, 0);
    const cost = toLong(new D(String(this.shares / totalShares)).mul(totalCosts.amount), HALF_DOWN);
    return money(totalCosts.currencyCode, cost);
  }

  getEnd(): LocalDateTime | null {
    return this.end;
  }
  isClosed(): boolean {
    return this.end !== null;
  }
  getClosingTransaction(): TransactionPair<PortfolioTransaction> | null {
    return this.isClosed() ? this.transactions[this.transactions.length - 1] : null;
  }
  getLastTransaction(): TransactionPair<PortfolioTransaction> {
    return this.transactions[this.transactions.length - 1];
  }
  getEntryValueMovingAverage(): Money | null {
    return this.entryValueMovingAverageFn();
  }
  getEntryValueMovingAverageWithoutTaxesAndFees(): Money | null {
    return this.entryValueMovingAverageWithoutTaxesAndFeesFn();
  }
  getProfitLoss(): Money {
    return this.isLong()
      ? money(this.exitValue.currencyCode, this.exitValue.amount - this.entryValue.amount)
      : money(this.entryValue.currencyCode, this.entryValue.amount - this.exitValue.amount);
  }
  getProfitLossWithoutTaxesAndFees(): Money {
    return this.isLong()
      ? money(this.exitValue.currencyCode, this.exitValueWithoutTaxesAndFees.amount - this.entryValueWithoutTaxesAndFees.amount)
      : money(this.entryValue.currencyCode, this.entryValueWithoutTaxesAndFees.amount - this.exitValueWithoutTaxesAndFees.amount);
  }
  getProfitLossMovingAverage(): Money | null {
    const entry = this.getEntryValueMovingAverage();
    return entry !== null ? money(this.exitValue.currencyCode, this.exitValue.amount - entry.amount) : null;
  }
  getProfitLossMovingAverageWithoutTaxesAndFees(): Money | null {
    const entry = this.getEntryValueMovingAverageWithoutTaxesAndFees();
    return entry !== null ? money(this.exitValue.currencyCode, this.exitValueWithoutTaxesAndFees.amount - entry.amount) : null;
  }
  getReturn(): number {
    return this.isLong() ? this.exitValue.amount / this.entryValue.amount - 1 : 1 - this.exitValue.amount / this.entryValue.amount;
  }
  getReturnMovingAverage(): number {
    const entry = this.getEntryValueMovingAverage();
    if (entry === null) return NaN;
    return this.exitValue.amount / entry.amount - 1;
  }
  isLoss(): boolean {
    return this.getProfitLoss().amount < 0;
  }
  isGrossLoss(): boolean {
    return this.getProfitLossWithoutTaxesAndFees().amount < 0;
  }
}

/** ClientTransactionFilter: all portfolio transactions of the security before the given transaction */
function transactionFilter(security: Security, transaction: PortfolioTransaction, client: Client): Client {
  let txs = getSecurityTransactions(security, client);
  txs.sort(compareByDateAndType);
  let index = -1;
  for (let ii = 0; ii < txs.length; ii++)
    if (txs[ii].transaction === transaction) {
      index = ii;
      break;
    }
  if (index > 0) txs = txs.slice(0, index);
  const pseudoClient = new Client();
  pseudoClient.source = client;
  pseudoClient.baseCurrency = client.baseCurrency;
  pseudoClient.securities.push(security);
  const account = new Account();
  const portfolio = new Portfolio();
  pseudoClient.accounts.push(account);
  portfolio.referenceAccount = account;
  pseudoClient.portfolios.push(portfolio);
  for (const tx of txs) {
    const t = tx.transaction;
    if (t instanceof PortfolioTransaction && t.type !== 'TRANSFER_IN' && t.type !== 'TRANSFER_OUT') portfolio.addTransaction(t);
  }
  return pseudoClient;
}

export class TradeCollector {
  private readonly cache: SnapshotCache;
  constructor(
    private readonly client: Client,
    private readonly converter: CurrencyConverter,
    private readonly grouping: TradeGrouping = 'COMBINED',
    cache?: SnapshotCache,
  ) {
    this.cache = cache ?? new Map();
  }

  collect(security: Security): Trade[] {
    const transactions = getSecurityTransactions(security, this.client);
    transactions.sort(compareByDateAndType);
    const trades: Trade[] = [];
    const openTransactions = new Map<Portfolio, TransactionPair<PortfolioTransaction>[]>();

    for (const txp of transactions) {
      if (!(txp.transaction instanceof PortfolioTransaction)) continue;
      const pair = txp as TransactionPair<PortfolioTransaction>;
      const portfolio = txp.owner as Portfolio;
      const t = pair.transaction;
      let openList = openTransactions.get(portfolio);
      if (!openList) openTransactions.set(portfolio, (openList = []));
      switch (t.type) {
        case 'BUY':
        case 'DELIVERY_INBOUND':
        case 'SELL':
        case 'DELIVERY_OUTBOUND':
          if (openList.length === 0 || isPurchase(openList[0].transaction.type) === isPurchase(t.type)) openList.push(pair);
          else trades.push(...this.createNewTrades(openTransactions, pair));
          break;
        case 'TRANSFER_IN':
          this.moveOpenTransaction(openTransactions, pair);
          break;
        case 'TRANSFER_OUT':
          break;
      }
    }

    for (const [portfolio, position] of openTransactions) {
      if (position.length === 0) continue;
      if (this.grouping === 'PER_LOT') {
        for (const lot of position) {
          const newTrade = new Trade(security, portfolio, lot.transaction.shares);
          newTrade.start = lot.transaction.dateTime;
          newTrade.transactions.push(lot);
          trades.push(newTrade);
        }
      } else {
        let shares = 0;
        for (const p of position) shares += p.transaction.shares;
        const newTrade = new Trade(security, portfolio, shares);
        newTrade.start = position[0].transaction.dateTime;
        newTrade.transactions.push(...position);
        trades.push(newTrade);
      }
    }
    for (const t of trades) t.calculate(this.client, this.converter, this.cache);
    return trades;
  }

  private createNewTrades(
    openTransactions: Map<Portfolio, TransactionPair<PortfolioTransaction>[]>,
    pair: TransactionPair<PortfolioTransaction>,
  ): Trade[] {
    const open = openTransactions.get(pair.owner as Portfolio);
    if (!open || open.length === 0) throw new TradeCollectorException(`Kein Bestand für Verkauf: ${pair.transaction.security?.name}`);
    let sharesToDistribute = pair.transaction.shares;
    open.sort(compareByDateAndType);
    const consumed: TransactionPair<PortfolioTransaction>[] = [];
    for (const candidate of open.slice()) {
      if (sharesToDistribute === 0) break;
      if (sharesToDistribute >= candidate.transaction.shares) {
        consumed.push(candidate);
        open.splice(open.indexOf(candidate), 1);
        sharesToDistribute -= candidate.transaction.shares;
      } else {
        const owner = pair.owner as Portfolio;
        const lotShares = candidate.transaction.shares;
        const pieces = this.split(candidate, [owner, owner], [sharesToDistribute, lotShares - sharesToDistribute]);
        consumed.push(pieces[0]);
        open[open.indexOf(candidate)] = pieces[1];
        sharesToDistribute = 0;
      }
    }
    if (sharesToDistribute > 0)
      throw new TradeCollectorException(`Fehlender Bestand für Verkauf: ${pair.transaction.security?.name}`);
    if (this.grouping === 'PER_LOT' && consumed.length > 0) return this.createTradePerLot(pair, consumed);
    return [this.createCombinedTrade(pair, consumed)];
  }

  private createCombinedTrade(pair: TransactionPair<PortfolioTransaction>, consumed: TransactionPair<PortfolioTransaction>[]): Trade {
    const newTrade = new Trade(pair.transaction.security!, pair.owner as Portfolio, pair.transaction.shares);
    if (consumed.length > 0) newTrade.start = consumed[0].transaction.dateTime;
    newTrade.transactions.push(...consumed, pair);
    newTrade.end = pair.transaction.dateTime;
    newTrade.realClosingTransaction = pair.transaction;
    return newTrade;
  }

  private createTradePerLot(pair: TransactionPair<PortfolioTransaction>, consumed: TransactionPair<PortfolioTransaction>[]): Trade[] {
    const closingPieces =
      consumed.length === 1
        ? null
        : this.split(
            pair,
            consumed.map(() => pair.owner as Portfolio),
            consumed.map((lot) => lot.transaction.shares),
          );
    return consumed.map((lot, ii) => {
      const newTrade = new Trade(pair.transaction.security!, pair.owner as Portfolio, lot.transaction.shares);
      newTrade.start = lot.transaction.dateTime;
      newTrade.transactions.push(lot, closingPieces === null ? pair : closingPieces[ii]);
      newTrade.end = pair.transaction.dateTime;
      newTrade.realClosingTransaction = pair.transaction;
      return newTrade;
    });
  }

  private moveOpenTransaction(
    openTransactions: Map<Portfolio, TransactionPair<PortfolioTransaction>[]>,
    pair: TransactionPair<PortfolioTransaction>,
  ): void {
    const transfer = pair.transaction.crossEntry as PortfolioTransferEntry;
    const outbound = transfer.getOwner(transfer.transactionFrom) as Portfolio;
    const inbound = transfer.getOwner(transfer.transactionTo) as Portfolio;
    let target = openTransactions.get(inbound);
    if (!target) openTransactions.set(inbound, (target = []));
    const positions = openTransactions.get(outbound);
    if (!positions || positions.length === 0)
      throw new TradeCollectorException(`Kein Bestand für Umbuchung: ${pair.transaction.security?.name}`);
    let sharesToTransfer = pair.transaction.shares;
    positions.sort(compareByDateAndType);
    for (const candidate of positions.slice()) {
      if (sharesToTransfer === 0) break;
      if (sharesToTransfer >= candidate.transaction.shares) {
        positions.splice(positions.indexOf(candidate), 1);
        target.push(candidate);
        sharesToTransfer -= candidate.transaction.shares;
      } else {
        const lotShares = candidate.transaction.shares;
        const pieces = this.split(candidate, [inbound, outbound], [sharesToTransfer, lotShares - sharesToTransfer]);
        target.push(pieces[0]);
        positions[positions.indexOf(candidate)] = pieces[1];
        sharesToTransfer = 0;
      }
    }
    if (sharesToTransfer > 0)
      throw new TradeCollectorException(`Fehlender Bestand für Umbuchung: ${pair.transaction.security?.name}`);
  }

  private split(
    candidate: TransactionPair<PortfolioTransaction>,
    newOwners: Portfolio[],
    weights: number[],
  ): TransactionPair<PortfolioTransaction>[] {
    const t = candidate.transaction;
    const amounts = distribute(t.amount, weights);
    const units = t.units;
    const unitAmounts = units.map((u) => distribute(u.amount.amount, weights));
    const unitForexAmounts = units.map((u) => (u.forex !== null ? distribute(u.forex.amount, weights) : weights.map(() => 0)));
    const answer: TransactionPair<PortfolioTransaction>[] = [];
    for (let ii = 0; ii < weights.length; ii++) {
      let piece: TransactionPair<PortfolioTransaction>;
      if (t.crossEntry instanceof BuySellEntry) {
        const entry = t.crossEntry;
        const pt = new PortfolioTransaction(undefined, t.type);
        const at = new AccountTransaction(undefined, t.type as AccountTransaction['type']);
        const copy = new BuySellEntry(newOwners[ii], pt, entry.account, at);
        for (const x of [pt, at]) {
          x.dateTime = t.dateTime;
          x.currencyCode = t.currencyCode;
          x.security = t.security;
          x.note = t.note;
          x.amount = amounts[ii];
        }
        pt.shares = weights[ii];
        void copy;
        // note: PP uses the portfolio of the original entry as owner of the piece
        piece = { owner: entry.portfolio, transaction: pt };
      } else {
        const nt = new PortfolioTransaction(undefined, t.type);
        nt.dateTime = t.dateTime;
        nt.security = t.security;
        nt.currencyCode = t.currencyCode;
        nt.note = t.note;
        nt.shares = weights[ii];
        nt.amount = amounts[ii];
        piece = { owner: candidate.owner, transaction: nt };
      }
      for (let jj = 0; jj < units.length; jj++) piece.transaction.addUnit(units[jj].piece(unitAmounts[jj][ii], unitForexAmounts[jj][ii]));
      answer.push(piece);
    }
    return answer;
  }
}

// ------------------------------------------------------------------
// TradeCategory / TradeTotals (aggregate over all trades)

export class TradeTotals {
  readonly totalShares: number;
  readonly totalEntryValue: Money;
  readonly totalEntryValueMovingAverage: Money;
  readonly totalExitValue: Money;
  readonly totalProfitLoss: Money;
  readonly totalProfitLossWithoutTaxesAndFees: Money;
  readonly totalProfitLossMovingAverage: Money;
  readonly totalProfitLossMovingAverageWithoutTaxesAndFees: Money;
  readonly averageIRR: number;
  readonly averageReturn: number;
  readonly averageHoldingPeriod: number;
  readonly winRate: number;
  readonly tradeCount: number;
  readonly winningTradesCount: number;
  readonly losingTradesCount: number;

  constructor(
    readonly trades: Trade[],
    private readonly converter: CurrencyConverter,
  ) {
    const term = converter.termCurrency;
    const distinct = [...new Set(trades)];
    this.tradeCount = distinct.length;
    let shares = 0;
    for (const t of trades) shares += t.shares;
    this.totalShares = shares;
    const now = today();
    const sumBy = (extract: (t: Trade) => Money | null, date: (t: Trade) => LocalDate, weighted: boolean) => {
      let s = 0;
      for (const t of weighted ? distinct : trades) {
        const v = extract(t);
        if (v === null) continue;
        const c = convertMoney(this.converter, date(t), v);
        s += weighted ? moneyMultiplyAndRound(c, 1.0).amount : c.amount;
      }
      return money(term, s);
    };
    const endDate = (t: Trade) => (t.end !== null ? toLocalDate(t.end) : now);
    const startDate = (t: Trade) => toLocalDate(t.start);
    this.totalEntryValue = sumBy((t) => t.entryValue, startDate, false);
    this.totalEntryValueMovingAverage = sumBy((t) => t.getEntryValueMovingAverage(), startDate, false);
    this.totalExitValue = sumBy((t) => t.exitValue, endDate, false);
    this.totalProfitLossMovingAverage = sumBy((t) => t.getProfitLossMovingAverage(), endDate, false);
    this.totalProfitLossMovingAverageWithoutTaxesAndFees = sumBy((t) => t.getProfitLossMovingAverageWithoutTaxesAndFees(), endDate, false);
    // aggregate category (weight 1.0 for every distinct trade)
    this.totalProfitLoss = sumBy((t) => t.getProfitLoss(), endDate, true);
    this.totalProfitLossWithoutTaxesAndFees = sumBy((t) => t.getProfitLossWithoutTaxesAndFees(), endDate, true);
    const categoryEntry = sumBy((t) => t.entryValue, startDate, true);
    this.averageReturn = categoryEntry.amount !== 0 ? this.totalProfitLoss.amount / categoryEntry.amount : 0;
    const totalWeight = distinct.length;
    this.averageHoldingPeriod = totalWeight === 0 ? 0 : javaRound(javaSummingDouble(distinct.map((t) => t.holdingPeriod * 1.0)) / totalWeight);
    this.winRate = totalWeight === 0 ? 0 : javaSummingDouble(distinct.filter((t) => !t.isLoss()).map(() => 1.0)) / totalWeight;
    this.winningTradesCount = distinct.filter((t) => !t.isLoss()).length;
    this.losingTradesCount = distinct.filter((t) => t.isLoss()).length;
    this.averageIRR = totalWeight === 0 ? 0 : categoryIRR(distinct, converter);
  }

  getAverageReturnMovingAverage(): number {
    if (this.totalEntryValueMovingAverage.amount === 0) return 0;
    return this.totalProfitLossMovingAverage.amount / this.totalEntryValueMovingAverage.amount;
  }
}

function categoryIRR(trades: Trade[], converter: CurrencyConverter): number {
  const cashflows: { date: LocalDate; amount: number; order: number }[] = [];
  let sequence = 0;
  for (const trade of trades) {
    const weight = 1.0;
    const isLong = trade.isLong();
    const lots: CollateralLot[] = [];
    let totalCollateral = 0;
    let remainingCollateral = 0;
    for (const p of trade.transactions) {
      const t = p.transaction;
      let amount = (convertMoney(converter, t.date, t.getMonetaryAmount()).amount / Values.Amount.divider) * weight;
      if (isPurchase(t.type) === isLong) {
        if (!isLong) {
          lots.push({ shares: t.shares, amount });
          totalCollateral += amount;
          remainingCollateral += amount;
        }
        amount = -amount;
      } else if (!isLong) {
        const released = releaseCollateral(lots, t.shares);
        remainingCollateral = Math.max(0, remainingCollateral - released);
        amount = released - amount;
      }
      cashflows.push({ date: t.date, amount, order: sequence++ });
    }
    if (!trade.isClosed()) {
      const date = today();
      let amount = (convertMoney(converter, date, trade.exitValue).amount / Values.Amount.divider) * weight;
      if (!isLong) amount = remainingCollateral - amount;
      cashflows.push({ date, amount, order: sequence++ });
    }
    if (!isLong) cashflows.push({ date: trade.isClosed() ? toLocalDate(trade.end!) : today(), amount: totalCollateral, order: sequence++ });
  }
  if (cashflows.length === 0) return 0;
  cashflows.sort((a, b) => (a.date !== b.date ? a.date - b.date : a.order - b.order));
  const irr = calculateIRR(
    cashflows.map((c) => c.date),
    cashflows.map((c) => c.amount),
  );
  return Number.isFinite(irr) ? irr : 0;
}

/** collect the trades of all securities (errors of single securities are ignored as in PP) */
export function collectAllTrades(client: Client, converter: CurrencyConverter, securities: Security[], grouping: TradeGrouping = 'COMBINED'): { trades: Trade[]; errors: string[] } {
  const collector = new TradeCollector(client, converter, grouping);
  const trades: Trade[] = [];
  const errors: string[] = [];
  for (const s of securities) {
    try {
      trades.push(...collector.collect(s));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { trades, errors };
}

