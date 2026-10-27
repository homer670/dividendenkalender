// Mirrors oracle/Extra.java

import { Client, Portfolio, Account } from '../model';
import { Money } from '../money/money';
import { CurrencyConverter } from '../money/exchange';
import { PerformanceIndex, performanceIndexForClient } from '../snapshot/performanceIndex';
import { Interval } from '../util/interval';
import { CATEGORY_TYPES, ClientPerformanceSnapshot } from '../snapshot/clientPerformanceSnapshot';
import { CapitalGainsRecord, CostMethod, SecurityPerformanceRecord, SecurityPerformanceSnapshot, TaxesAndFees } from '../snapshot/securityPerformance';
import { ClientClassificationFilter, ClientFilter, PortfolioClientFilter, WithoutTaxesFilter } from '../snapshot/filters';
import { formatISODate } from '../util/dates';

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

export function addClientExtras(_root: Record<string, unknown>, _client: Client, _converter: CurrencyConverter): void {}
