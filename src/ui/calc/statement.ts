// Statement of assets (Vermögensaufstellung) with purchase value and gains per position

import { Client, InvestmentVehicle, Security, Taxonomy } from '../../core/model';
import { CurrencyConverter } from '../../core/money/exchange';
import { Money, money } from '../../core/money/money';
import { ClientSnapshot, GroupByTaxonomy } from '../../core/snapshot/clientSnapshot';
import { CostMethod, SecurityPerformanceRecord, SecurityPerformanceSnapshot } from '../../core/snapshot/securityPerformance';
import { LOCAL_DATE_MIN } from '../../core/snapshot/trades';
import { LocalDate } from '../../core/util/dates';
import { Interval } from '../../core/util/interval';

export interface StatementPosition {
  key: string;
  vehicle: InvestmentVehicle;
  security: Security | null;
  name: string;
  shares: number;
  /** price in security currency */
  price: number;
  priceDate: LocalDate;
  currency: string;
  marketValue: Money;
  share: number;
  purchaseValue: Money | null;
  gain: Money | null;
  gainPercent: number | null;
  /** change since the previous price */
  dayChange: number | null;
  dayChangeAmount: Money | null;
}

export interface StatementCategory {
  id: string;
  name: string;
  color: string;
  valuation: Money;
  share: number;
  positions: StatementPosition[];
}

export interface Statement {
  date: LocalDate;
  total: Money;
  categories: StatementCategory[];
  purchaseValue: Money;
  gain: Money;
  dayChangeAmount: Money;
}

/** all time security performance (purchase value, gains) as of the given date */
export function allTimeRecords(client: Client, converter: CurrencyConverter, date: LocalDate): SecurityPerformanceSnapshot {
  return SecurityPerformanceSnapshot.create(client, converter, Interval.of(LOCAL_DATE_MIN, date));
}

export function buildStatement(
  client: Client,
  converter: CurrencyConverter,
  taxonomy: Taxonomy | null,
  date: LocalDate,
  costMethod: CostMethod,
  records: SecurityPerformanceSnapshot,
): Statement {
  const term = converter.termCurrency;
  const snapshot = ClientSnapshot.create(client, converter, date);
  const grouping: GroupByTaxonomy = snapshot.groupByTaxonomy(taxonomy);
  const total = snapshot.getMonetaryAssets();
  const recordOf = new Map<Security, SecurityPerformanceRecord>();
  for (const r of records.records) recordOf.set(r.security, r);
  let purchaseSum = 0;
  let gainSum = 0;
  let daySum = 0;
  const categories: StatementCategory[] = grouping.categories.map((c) => {
    const positions = c.positions.map((ap, i): StatementPosition => {
      const security = ap.getSecurity();
      const value = ap.getValuation();
      let purchaseValue: Money | null = null;
      let gain: Money | null = null;
      let gainPercent: number | null = null;
      let dayChange: number | null = null;
      let dayChangeAmount: Money | null = null;
      if (security) {
        const record = recordOf.get(security);
        const held = record ? record.getSharesHeld() : 0;
        if (record && held !== 0) {
          const fraction = ap.position.shares / held;
          const cost = record.getCost(costMethod, 'INCLUDED');
          purchaseValue = money(term, Math.round(cost.amount * fraction));
          gain = money(term, value.amount - purchaseValue.amount);
          gainPercent = purchaseValue.amount !== 0 ? value.amount / purchaseValue.amount - 1 : null;
          purchaseSum += purchaseValue.amount;
          gainSum += gain.amount;
        }
        const two = security.getLatestTwoSecurityPrices(date);
        if (two && two[1].value !== 0) {
          dayChange = two[0].value / two[1].value - 1;
          dayChangeAmount = money(term, Math.round(value.amount - value.amount / (1 + dayChange)));
          daySum += dayChangeAmount.amount;
        }
      }
      return {
        key: `${ap.investmentVehicle.uuid}:${i}`,
        vehicle: ap.investmentVehicle,
        security,
        name: ap.getDescription(),
        shares: ap.position.shares,
        price: ap.position.price.value,
        priceDate: ap.position.price.date,
        currency: ap.investmentVehicle.currencyCode,
        marketValue: value,
        share: total.amount !== 0 ? value.amount / total.amount : 0,
        purchaseValue,
        gain,
        gainPercent,
        dayChange,
        dayChangeAmount,
      };
    });
    return {
      id: c.classification.id,
      name: c.classification.name,
      color: c.classification.color,
      valuation: c.getValuation(),
      share: total.amount !== 0 ? c.getValuation().amount / total.amount : 0,
      positions,
    };
  });
  return {
    date,
    total,
    categories,
    purchaseValue: money(term, purchaseSum),
    gain: money(term, gainSum),
    dayChangeAmount: money(term, daySum),
  };
}
