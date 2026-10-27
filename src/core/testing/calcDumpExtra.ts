// Mirrors oracle/Extra.java

import { Client, Portfolio, Account } from '../model';
import { Money } from '../money/money';
import { CurrencyConverter } from '../money/exchange';
import { PerformanceIndex, performanceIndexForClient } from '../snapshot/performanceIndex';
import { Interval } from '../util/interval';
import { CATEGORY_TYPES, ClientPerformanceSnapshot } from '../snapshot/clientPerformanceSnapshot';
import { CapitalGainsRecord, CostMethod, SecurityPerformanceRecord, SecurityPerformanceSnapshot, TaxesAndFees } from '../snapshot/securityPerformance';
import { ClientClassificationFilter, ClientFilter, PortfolioClientFilter, WithoutTaxesFilter } from '../snapshot/filters';
import { formatISODate, formatISODateTime } from '../util/dates';
import { Trade, TradeCollector, TradeCollectorException, TradeGrouping, TradeTotals } from '../snapshot/trades';
import { calculatePayments, PaymentsMode } from '../snapshot/payments';
import { ReportingPeriod } from '../snapshot/reportingPeriod';
import { aggregate, AggregationPeriod, AllTimeHigh, performanceIndexForSecurity } from '../snapshot/securityIndex';
import { RELATIVE_TO } from './calcDump';

function m(v: Money | null): string | null {
  return v === null ? null : `${v.currencyCode} ${v.amount}`;
}

function d(v: number): number | string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
  return v;
}

function performance(s: ClientPerformanceSnapshot): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const type of CATEGORY_TYPES) {
    const c = s.getCategoryByType(type);
    r[type] = {
      valuation: m(c.valuation),
      positions: c.positions.map((p) => `${p.label}|${m(p.value)}|${m(p.forexGain)}`),
    };
  }
  r.irr = d(s.getPerformanceIRR());
  r.absoluteDelta = m(s.getAbsoluteDelta());
  r.taxRate = d(s.getPortfolioTaxRate());
  r.feeRate = d(s.getPortfolioFeeRate());
  r.earnings = s.earnings.length;
  r.fees = s.fees.length;
  r.taxes = s.taxes.length;
  return r;
}

function cg(r: CapitalGainsRecord): string {
  return `${m(r.capitalGains)}|${m(r.forexCapitalGains)}`;
}

function record(r: SecurityPerformanceRecord): Record<string, unknown> {
  const o: Record<string, unknown> = {
    irr: d(r.getIrr()),
    ttwror: d(r.getTrueTimeWeightedRateOfReturn()),
    ttwrorPa: d(r.getTrueTimeWeightedRateOfReturnAnnualized()),
    maxDD: d(r.getDrawdown().getMaxDrawdown()),
    volatility: d(r.getVolatility().getStandardDeviation()),
    delta: m(r.getDelta()),
    deltaPercent: d(r.getDeltaPercent()),
    marketValue: m(r.getMarketValue()),
    openingValue: m(r.getOpeningValue()),
    quote: r.getQuote().amount,
    quoteTerm: `${r.getQuoteInTermCurrency().currencyCode} ${r.getQuoteInTermCurrency().amount}`,
  };
  const methods: CostMethod[] = ['FIFO', 'MOVING_AVERAGE'];
  const tfs: TaxesAndFees[] = ['INCLUDED', 'NOT_INCLUDED'];
  for (const cm of methods) {
    for (const tf of tfs) {
      o[`cost-${cm}-${tf}`] = m(r.getCost(cm, tf));
      o[`costPerShare-${cm}-${tf}`] = r.getCostPerSharesHeld(cm, tf).amount;
      o[`realized-${cm}-${tf}`] = cg(r.getRealizedCapitalGains(cm, tf));
      o[`unrealized-${cm}-${tf}`] = cg(r.getUnrealizedCapitalGains(cm, tf));
    }
    o[`gainsOnHoldings-${cm}`] = m(r.getCapitalGainsOnHoldings(cm));
    o[`gainsOnHoldingsPercent-${cm}`] = d(r.getCapitalGainsOnHoldingsPercent(cm));
    o[`totalRateOfReturnDiv-${cm}`] = d(r.getTotalRateOfReturnDiv(cm));
  }
  o.fees = m(r.getFees());
  o.taxes = m(r.getTaxes());
  o.sharesHeld = r.getSharesHeld();
  o.dividends = m(r.getSumOfDividends());
  o.dividendCount = r.getDividendEventCount();
  const last = r.getLastDividendPayment();
  o.lastDividend = last === null ? null : formatISODate(last);
  o.periodicity = r.getPeriodicity();
  o.rateOfReturnPerYear = d(r.getRateOfReturnPerYear());
  return o;
}

function indexSummary(index: PerformanceIndex): Record<string, unknown> {
  return {
    totals: index.totals,
    inbound: index.inboundTransferals,
    outbound: index.outboundTransferals,
    accumulated: index.accumulated,
    ttwror: index.getFinalAccumulatedPercentage(),
    maxDD: index.getDrawdown().getMaxDrawdown(),
    volatility: index.getVolatility().getStandardDeviation(),
    irr: d(index.getPerformanceIRR()),
  };
}

export function addIndexExtras(
  o: Record<string, unknown>,
  client: Client,
  converter: CurrencyConverter,
  interval: Interval,
  index: PerformanceIndex,
): void {
  o.performanceFifo = performance(index.getClientPerformanceSnapshot(true));
  o.performanceMovingAverage = performance(index.getClientPerformanceSnapshot(false));

  const snapshot = SecurityPerformanceSnapshot.create(client, converter, interval);
  const records: Record<string, unknown> = {};
  for (const r of snapshot.records.slice().sort((a, b) => (a.security.uuid < b.security.uuid ? -1 : 1)))
    records[r.security.uuid] = record(r);
  o.securities = records;

  const period = o.period as string;
  if (!['L1Y0', 'Y2020', 'Y2023', 'S2017-12-01', 'F2024-06-01_2026-01-01'].includes(period)) return;

  const portfolios = client.portfolios;
  const accounts = client.accounts;
  const filters: [string, ClientFilter][] = [];
  for (const p of portfolios) {
    filters.push([`P:${p.name}`, new PortfolioClientFilter([p], [])]);
    filters.push([`PA:${p.name}`, new PortfolioClientFilter([p], [p.referenceAccount!])]);
  }
  for (const a of accounts) filters.push([`A:${a.name}`, new PortfolioClientFilter([], [a])]);
  filters.push(['P0+P1', new PortfolioClientFilter([portfolios[0], portfolios[1]], [])]);
  filters.push(['P0+A1', new PortfolioClientFilter([portfolios[0]], [accounts[1]])]);
  const weights = new Map<Portfolio | Account, number>([
    [portfolios[0], 5000],
    [accounts[0], 2500],
  ]);
  filters.push(['weighted', new PortfolioClientFilter([portfolios[0], portfolios[1]], [accounts[0], accounts[2]], weights)]);
  filters.push(['withoutTaxes', new WithoutTaxesFilter()]);
  for (const t of client.taxonomies) for (const c of t.root.children) filters.push([`C:${c.id}`, new ClientClassificationFilter(c)]);
  filters.push(['C:root', new ClientClassificationFilter(client.taxonomies[0].root)]);

  const filtered: Record<string, unknown> = {};
  for (const [key, filter] of filters) {
    const fc = filter.filter(client);
    const fi = performanceIndexForClient(fc, converter, interval);
    const fm = indexSummary(fi);
    fm.performance = performance(fi.getClientPerformanceSnapshot());
    filtered[key] = fm;
  }
  o.filtered = filtered;
}

function trade(t: Trade): unknown[] {
  return [
    [t.security.uuid, t.portfolio.unwrap().uuid, formatISODateTime(t.start), t.end === null ? 'open' : formatISODateTime(t.end), t.shares].join('|'),
    m(t.entryValue),
    m(t.entryValueWithoutTaxesAndFees),
    m(t.exitValue),
    m(t.exitValueWithoutTaxesAndFees),
    m(t.getProfitLoss()),
    m(t.getProfitLossWithoutTaxesAndFees()),
    m(t.getProfitLossMovingAverage()),
    m(t.getProfitLossMovingAverageWithoutTaxesAndFees()),
    t.holdingPeriod,
    d(t.irr),
    d(t.getReturn()),
    d(t.getReturnMovingAverage()),
    t.transactions.length,
    t.isLong(),
  ];
}

export function addClientExtras(root: Record<string, unknown>, client: Client, converter: CurrencyConverter): void {
  for (const grouping of ['COMBINED', 'PER_LOT'] as TradeGrouping[]) {
    const collector = new TradeCollector(client, converter, grouping);
    const trades: Trade[] = [];
    const lines: unknown[][] = [];
    const errors: string[] = [];
    for (const s of client.securities) {
      try {
        const list = collector.collect(s);
        trades.push(...list);
        for (const t of list) lines.push(trade(t));
      } catch (e) {
        if (!(e instanceof TradeCollectorException)) throw e;
        errors.push(s.uuid);
      }
    }
    const totals = new TradeTotals(trades, converter);
    lines.sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : (a[0] as string) > (b[0] as string) ? 1 : 0));
    root[`trades-${grouping}`] = {
      trades: lines,
      errors,
      totals: [
        totals.tradeCount,
        totals.totalShares,
        m(totals.totalEntryValue),
        m(totals.totalEntryValueMovingAverage),
        m(totals.totalExitValue),
        m(totals.totalProfitLoss),
        m(totals.totalProfitLossWithoutTaxesAndFees),
        m(totals.totalProfitLossMovingAverage),
        m(totals.totalProfitLossMovingAverageWithoutTaxesAndFees),
        totals.averageHoldingPeriod,
        d(totals.averageIRR),
        d(totals.averageReturn),
        d(totals.getAverageReturnMovingAverage()),
      ],
    };
  }

  const payments: Record<string, unknown> = {};
  const modes: PaymentsMode[] = ['DIVIDENDS', 'INTEREST', 'EARNINGS', 'TAXES', 'FEES', 'TRADES', 'ALL', 'SAVING'];
  for (const mode of modes) {
    for (const gross of [true, false]) {
      for (const cm of ['FIFO', 'MOVING_AVERAGE'] as CostMethod[]) {
        const includesTrades = mode === 'TRADES' || mode === 'ALL';
        if (cm === 'MOVING_AVERAGE' && !includesTrades) continue;
        if (!gross && mode !== 'DIVIDENDS' && mode !== 'EARNINGS') continue;
        const r = calculatePayments(client, client, converter, {
          startYear: 2019,
          mode,
          useGrossValue: gross,
          useConsolidateRetired: true,
          costMethod: cm,
        });
        const lines: Record<string, string> = {};
        for (const line of r.lines) {
          let b = String(line.sum);
          for (let ii = 0; ii < r.noOfMonths; ii++)
            if (line.values[ii] !== 0) b += `,${ii}=${line.values[ii]}/${line.numTransactions[ii]}`;
          lines[line.vehicle!.uuid] = b;
        }
        payments[`${mode}-${gross}-${cm}`] = {
          months: r.noOfMonths,
          sum: r.sum.sum,
          values: r.sum.values,
          counts: r.sum.numTransactions,
          retired: r.sumRetired.sum,
          lines: sortKeys(lines),
          transactions: r.transactions.length,
        };
      }
    }
  }
  root.payments = payments;

  const benchmarks: Record<string, unknown> = {};
  for (const code of ['L1Y0', 'L3Y0', 'Y2021', 'S2017-12-01']) {
    const interval = ReportingPeriod.from(code).toInterval(RELATIVE_TO);
    const clientIndex = performanceIndexForClient(client, converter, interval);
    const bm: Record<string, unknown> = {};
    for (const s of client.securities) {
      const si = performanceIndexForSecurity(clientIndex, s);
      const ath = new AllTimeHigh(s, interval);
      bm[s.uuid] = {
        dates: `${formatISODate(si.dates[0])}..${formatISODate(si.dates[si.dates.length - 1])}`,
        totals: si.totals,
        accumulated: si.accumulated,
        irr: d(si.getPerformanceIRR()),
        ath: [
          ath.value,
          ath.date === null ? null : formatISODate(ath.date),
          ath.low,
          ath.lowDate === null ? null : formatISODate(ath.lowDate),
          ath.distance === null ? null : d(ath.distance),
          ath.relLowDistance === null ? null : d(ath.relLowDistance),
        ],
      };
    }
    for (const period of ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as AggregationPeriod[]) {
      const ai = aggregate(clientIndex, period);
      bm[`aggregation-${period}`] = {
        dates: ai.dates.map(formatISODate),
        accumulated: ai.accumulated,
        delta: ai.delta,
        inbound: ai.inboundTransferals,
        outbound: ai.outboundTransferals,
        totals: ai.totals,
      };
    }
    benchmarks[code] = bm;
  }
  root.benchmarks = benchmarks;
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  const r: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) r[k] = o[k];
  return r;
}
