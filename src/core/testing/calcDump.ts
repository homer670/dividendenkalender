// Mirrors oracle/CalcDump.java

import { Client, Taxonomy } from '../model';
import { CurrencyConverter } from '../money/exchange';
import { ClientSnapshot } from '../snapshot/clientSnapshot';
import { performanceIndexForClient } from '../snapshot/performanceIndex';
import { ReportingPeriod } from '../snapshot/reportingPeriod';
import { formatISODate, LocalDate, ofYMD, parseDate } from '../util/dates';
import { Interval } from '../util/interval';
import { addClientExtras, addIndexExtras } from './calcDumpExtra';

export const SNAPSHOT_DATES = ['2018-01-01', '2018-06-30', '2019-12-31', '2021-03-15', '2022-02-02', '2023-07-01', '2024-12-31', '2025-06-30', '2026-01-01'];

export const PERIODS = ['L1Y0', 'L3Y0', 'L0Y6', 'Y2019', 'Y2020', 'Y2021', 'Y2022', 'Y2023', 'Y2024', 'S2017-12-01', 'F2019-03-01_2020-03-01', 'F2024-06-01_2026-01-01', 'D30', 'T20', 'Z', 'B', 'C', 'A', 'P', 'E', 'Q', 'W', 'L2Y3'];

export const RELATIVE_TO: LocalDate = ofYMD(2025, 6, 30);

function interval(i: Interval) {
  return { start: formatISODate(i.start), end: formatISODate(i.end) };
}

export function dumpCalc(client: Client, converter: CurrencyConverter): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const snapshots: unknown[] = [];
  for (const ds of SNAPSHOT_DATES) {
    const date = parseDate(ds);
    const snapshot = ClientSnapshot.create(client, converter, date);
    const m: Record<string, unknown> = { date: ds, assets: snapshot.getMonetaryAssets().amount };
    m.accounts = snapshot.accounts.map((a) => `${a.account.uuid}:${a.getFunds().amount}:${a.getUnconvertedFunds().amount}`);
    m.portfolios = snapshot.portfolios.map((p) => {
      const positions: Record<string, string> = {};
      for (const pos of p.positions)
        positions[pos.getSecurity()!.uuid] =
          `${pos.shares}:${formatISODate(pos.price.date)}=${pos.price.value}:${pos.calculateValue().amount}`;
      return { uuid: p.portfolio.uuid, value: p.getValue().amount, positions: sortKeys(positions) };
    });
    const joint: Record<string, string> = {};
    for (const pos of snapshot.getJointPortfolio().positions)
      joint[pos.getSecurity()!.uuid] = `${pos.shares}:${pos.calculateValue().amount}`;
    m.joint = sortKeys(joint);
    m.jointValue = snapshot.getJointPortfolio().getValue().amount;
    const taxonomies: (Taxonomy | null)[] = [...client.taxonomies, null];
    m.groupByTaxonomy = taxonomies.map((t) =>
      snapshot.groupByTaxonomy(t).categories.map((c) => {
        const positions: Record<string, number> = {};
        for (const p of c.positions) positions[p.investmentVehicle.uuid] = p.getValuation().amount;
        return { id: c.classification.id, valuation: c.getValuation().amount, positions: sortKeys(positions) };
      }),
    );
    snapshots.push(m);
  }
  root.snapshots = snapshots;

  const indices: unknown[] = [];
  for (const code of PERIODS) {
    const period = ReportingPeriod.from(code);
    const iv = period.toInterval(RELATIVE_TO);
    const index = performanceIndexForClient(client, converter, iv);
    const dd = index.getDrawdown();
    const v = index.getVolatility();
    const m: Record<string, unknown> = {
      period: code,
      interval: interval(iv),
      actualInterval: interval(index.getActualInterval()),
      firstHolding: interval(index.getFirstHoldingInterval()),
      totals: index.totals,
      inbound: index.inboundTransferals,
      outbound: index.outboundTransferals,
      taxes: index.taxes,
      dividends: index.dividends,
      fees: index.fees,
      interest: index.interest,
      interestCharge: index.interestCharge,
      buys: index.buys,
      sells: index.sells,
      delta: index.delta,
      accumulated: index.accumulated,
      ttwror: index.getFinalAccumulatedPercentage(),
      ttwrorPa: index.getFinalAccumulatedAnnualizedPercentage(),
      maxDD: dd.getMaxDrawdown(),
      maxDDInterval: interval(dd.getIntervalOfMaxDrawdown()),
      maxDDDuration: interval(dd.getMaxDrawdownDuration()),
      recovery: interval(dd.getLongestRecoveryTime()),
      ddSerie: dd.getMaxDrawdownSerie(),
      volatility: v.getStandardDeviation(),
      semiDeviation: v.getSemiDeviation(),
      investedCapital: index.calculateInvestedCapital(),
      absoluteInvestedCapital: index.calculateAbsoluteInvestedCapital(),
      absoluteDelta: index.calculateAbsoluteDelta(),
      calcDelta: index.calculateDelta(),
      firstDataPoint: index.getFirstDataPoint() === null ? null : formatISODate(index.getFirstDataPoint()!),
      performanceLast90: index.getPerformance(Interval.of(iv.end - 90, iv.end)),
      warnings: index.warnings.length,
    };
    addIndexExtras(m, client, converter, iv, index);
    indices.push(m);
  }
  root.indices = indices;
  addClientExtras(root, client, converter);
  return root;
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  const r: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) r[k] = o[k];
  return r;
}

/** deep comparison with tolerance for floating point numbers; returns list of differences */
export function compareDeep(expected: unknown, actual: unknown, path = '$', diffs: string[] = [], max = 50): string[] {
  if (diffs.length >= max) return diffs;
  // IRR without solution: Newton iterates chaotically, PP shows an arbitrary value or NaN
  if (/irr$/i.test(path) && (expected === 'NaN' || actual === 'NaN')) {
    if (expected !== actual && actual === 'NaN' && typeof process !== 'undefined' && process.env?.REPORT_IRR_NAN)
      diffs.push(`${path}: TS reports no IRR but PP has ${expected}`);
    return diffs;
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Number.isInteger(expected) && Number.isInteger(actual) && Math.abs(expected) > 1e-300) {
      if (expected !== actual) diffs.push(`${path}: expected ${expected} but was ${actual}`);
    } else {
      const tol = Math.max(1e-12, Math.abs(expected) * 1e-9);
      if (!(Math.abs(expected - actual) <= tol) && !(Number.isNaN(expected) && Number.isNaN(actual)))
        diffs.push(`${path}: expected ${expected} but was ${actual}`);
    }
    return diffs;
  }
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    // gson serializes NaN/Infinity as such
    if (expected !== actual && !(typeof expected === 'string' && String(actual) === expected))
      diffs.push(`${path}: expected ${JSON.stringify(expected)} but was ${JSON.stringify(actual)}`);
    return diffs;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      diffs.push(`${path}: expected array`);
      return diffs;
    }
    if (expected.length !== actual.length) diffs.push(`${path}: expected length ${expected.length} but was ${actual.length}`);
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n && diffs.length < max; i++) compareDeep(expected[i], actual[i], `${path}[${i}]`, diffs, max);
    return diffs;
  }
  const e = expected as Record<string, unknown>;
  const a = actual as Record<string, unknown>;
  for (const k of Object.keys(e)) {
    if (!(k in a)) {
      diffs.push(`${path}.${k}: missing`);
      continue;
    }
    compareDeep(e[k], a[k], `${path}.${k}`, diffs, max);
  }
  for (const k of Object.keys(a)) if (!(k in e)) diffs.push(`${path}.${k}: unexpected`);
  return diffs;
}
