// Canonical representation of the model - mirrors oracle/ModelDump.java,
// used to compare the readers against Portfolio Performance itself.

import {
  AccountTransaction,
  AttributeValue,
  Classification,
  Client,
  Portfolio,
  PortfolioTransaction,
  Transaction,
} from '../model';
import { formatISODate, formatISODateTime, toLocalDate } from '../util/dates';

function attr(v: AttributeValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'relationalOperator' in v) return { op: v.relationalOperator, value: v.value };
  return v;
}

function tx(t: Transaction): Record<string, unknown> {
  const m: Record<string, unknown> = {
    uuid: t.uuid,
    type: (t as AccountTransaction | PortfolioTransaction).type,
    date: formatISODateTime(t.dateTime),
    currency: t.currencyCode,
    amount: t.amount,
    shares: t.shares,
    security: t.security ? t.security.uuid : null,
    note: t.note,
    source: t.source,
  };
  if (t instanceof AccountTransaction && t.exDate !== null) m.exDate = formatISODateTime(t.exDate);
  m.units = t.units.map((u) => {
    const um: Record<string, unknown> = {
      type: u.type,
      amount: `${u.amount.currencyCode} ${u.amount.amount}`,
    };
    if (u.forex) {
      um.forex = `${u.forex.currencyCode} ${u.forex.amount}`;
      um.rate = u.exchangeRate!.toFixed();
    }
    return um;
  });
  if (t.crossEntry) {
    m.cross = t.crossEntry.getCrossTransaction(t).uuid;
    m.crossOwner = t.crossEntry.getCrossOwner(t).uuid;
  }
  return m;
}

function classification(c: Classification): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    weight: c.weight,
    rank: c.rank,
    note: c.note,
    assignments: c.assignments.map((a) => `${a.investmentVehicle.uuid}:${a.weight}:${a.rank}`),
    children: c.children.map(classification),
  };
}

function sorted<T>(obj: Record<string, T>): Record<string, T> {
  const answer: Record<string, T> = {};
  for (const k of Object.keys(obj).sort()) answer[k] = obj[k];
  return answer;
}

export function dumpModel(client: Client): Record<string, unknown> {
  return {
    version: client.version,
    baseCurrency: client.baseCurrency,
    securities: client.securities.map((s) => {
      const m: Record<string, unknown> = {
        uuid: s.uuid,
        name: s.name,
        currency: s.currencyCode,
        target: s.targetCurrencyCode,
        isin: s.isin,
        ticker: s.tickerSymbol,
        wkn: s.wkn,
        note: s.note,
        feed: s.feed,
        retired: s.isRetired,
      };
      let sum = 0;
      for (const p of s.prices) sum = ((sum * 31) % 1000000007) + p.date * 7 + (p.value % 1000003);
      m.prices = s.prices.length;
      m.priceChecksum = sum;
      if (s.prices.length > 0) {
        const f = s.prices[0];
        const l = s.prices[s.prices.length - 1];
        m.firstPrice = `${formatISODate(f.date)}=${f.value}`;
        m.lastPrice = `${formatISODate(l.date)}=${l.value}`;
      }
      if (s.latest)
        m.latest = `${formatISODate(s.latest.date)}=${s.latest.value}/${s.latest.high}/${s.latest.low}/${s.latest.volume}`;
      m.events = s.events.map((e) => {
        let str = `${e.type}|${e.date === null ? 'null' : formatISODate(e.date)}|${e.details}|${e.source}`;
        if (e.type === 'DIVIDEND_PAYMENT')
          str += `|${e.paymentDate == null ? 'null' : formatISODate(e.paymentDate)}|${e.amount?.currencyCode} ${e.amount?.amount}`;
        return str;
      });
      const attributes: Record<string, unknown> = {};
      for (const [k, v] of s.attributes) attributes[k] = attr(v);
      m.attributes = sorted(attributes);
      return m;
    }),
    accounts: client.accounts.map((a) => ({
      uuid: a.uuid,
      name: a.name,
      currency: a.currencyCode,
      retired: a.isRetired,
      transactions: a.transactions.map(tx),
    })),
    portfolios: client.portfolios.map((p: Portfolio) => ({
      uuid: p.uuid,
      name: p.name,
      retired: p.isRetired,
      referenceAccount: p.referenceAccount ? p.referenceAccount.uuid : null,
      transactions: p.transactions.map(tx),
    })),
    taxonomies: client.taxonomies.map((t) => ({ id: t.id, name: t.name, root: classification(t.root) })),
    watchlists: client.watchlists.map((w) => `${w.name}:${w.securities.map((s) => s.uuid).join(',')}`),
    plans: client.plans.map((p) => ({
      name: p.name,
      security: p.security ? p.security.uuid : null,
      portfolio: p.portfolio ? p.portfolio.uuid : null,
      account: p.account ? p.account.uuid : null,
      start: formatISODate(toLocalDate(p.start)),
      interval: p.interval,
      amount: p.amount,
      fees: p.fees,
      taxes: p.taxes,
      type: p.type,
      transactions: p.transactions.map((t) => t.uuid),
    })),
    dashboards: client.dashboards.map((d) => ({
      id: d.id,
      name: d.name,
      configuration: sorted(d.configuration),
      columns: d.columns.map((c) => ({
        weight: c.weight,
        widgets: c.widgets.map((w) => ({ type: w.type, label: w.label, configuration: sorted(w.configuration) })),
      })),
    })),
    properties: sorted(Object.fromEntries(client.properties)),
    attributeTypes: client.settings.attributeTypes.map(
      (t) => `${t.id}|${t.name}|${t.target}|${t.converterClass}`,
    ),
  };
}
