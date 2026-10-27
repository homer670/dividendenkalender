// Subset of ClientFactory#upgradeModel relevant for files of version >= 51

import { Client, Transaction, Unit } from '../model';
import { money, Money } from '../money/money';
import { divMC, HALF_EVEN, javaRound, toLong } from '../util/decimal';
import Decimal from 'decimal.js';

export const CURRENT_VERSION = 70;
export const MINIMUM_SUPPORTED_VERSION = 51;

export class UnsupportedVersionError extends Error {}

/** Transaction.Unit#isWithinRoundingTolerance */
export function isWithinRoundingTolerance(amount: Money, forex: Money, exchangeRate: Decimal): boolean {
  let upper = javaRound(exchangeRate.add('0.003').mul(forex.amount).toNumber());
  let lower = javaRound(exchangeRate.add('-0.003').mul(forex.amount).toNumber());
  if (lower > upper) [lower, upper] = [upper, lower];
  if (amount.amount < lower || amount.amount > upper) {
    upper = toLong(divMC(amount.amount + 1, exchangeRate), HALF_EVEN);
    lower = toLong(divMC(amount.amount - 1, exchangeRate), HALF_EVEN);
    if (lower > upper) [lower, upper] = [upper, lower];
    if (forex.amount < lower || forex.amount > upper) return false;
  }
  return true;
}

function fixGrossValueUnit(tx: Transaction): void {
  const grossValueUnit = tx.getUnit('GROSS_VALUE');
  if (!grossValueUnit || !grossValueUnit.forex || !grossValueUnit.exchangeRate) return;
  const calculated = tx.getGrossValue();
  if (grossValueUnit.amount.currencyCode === calculated.currencyCode && grossValueUnit.amount.amount === calculated.amount)
    return;
  const replace = (u: Unit) => {
    tx.units.splice(tx.units.indexOf(grossValueUnit), 1);
    tx.units.push(u);
  };
  if (isWithinRoundingTolerance(calculated, grossValueUnit.forex, grossValueUnit.exchangeRate)) {
    replace(new Unit('GROSS_VALUE', calculated, grossValueUnit.forex, grossValueUnit.exchangeRate));
    return;
  }
  const updatedForex = money(
    grossValueUnit.forex.currencyCode,
    toLong(divMC(calculated.amount, grossValueUnit.exchangeRate), HALF_EVEN),
  );
  // note: PP removes the unit *before* constructing the new unit. If the
  // validity check of the constructor fails, the unit stays removed.
  tx.units.splice(tx.units.indexOf(grossValueUnit), 1);
  if (isWithinRoundingTolerance(calculated, updatedForex, grossValueUnit.exchangeRate))
    tx.units.push(new Unit('GROSS_VALUE', calculated, updatedForex, grossValueUnit.exchangeRate));
}

export function upgradeModel(client: Client): void {
  const version = client.version;
  if (version > CURRENT_VERSION)
    throw new UnsupportedVersionError(
      `Die Datei wurde mit einer neueren Version von Portfolio Performance gespeichert (Version ${version}).`,
    );
  if (version < MINIMUM_SUPPORTED_VERSION)
    throw new UnsupportedVersionError(
      `Die Datei hat ein altes Format (Version ${version}). Bitte einmal mit einer aktuellen Desktop-Version von Portfolio Performance öffnen und speichern.`,
    );

  if (version <= 53) {
    const pattern = /^((.*) \| )?([^ ]*\.(pdf|csv))$/i;
    for (const { transaction: tx } of client.getAllTransactions()) {
      const note = tx.note?.trim();
      if (!note) continue;
      const m = pattern.exec(note);
      if (m) {
        tx.note = m[2] ? m[2].trim() : null;
        tx.source = m[3].trim();
      }
    }
  }

  if (version <= 55) {
    for (const p of client.portfolios) for (const tx of p.transactions) fixGrossValueUnit(tx);
    for (const a of client.accounts) for (const tx of a.transactions) fixGrossValueUnit(tx);
  }

  if (version <= 56) {
    for (const s of client.securities) s.properties = s.properties.filter((p) => p && p.type !== 'MARKET');
  }

  if (version <= 57) {
    const all = new Set(client.securities);
    for (const w of client.watchlists) {
      for (const s of w.securities.slice()) {
        if (all.has(s)) continue;
        const used = client.getAllTransactions().some(({ transaction }) => transaction.security === s);
        if (used) {
          client.securities.push(s);
          all.add(s);
        } else {
          w.securities.splice(w.securities.indexOf(s), 1);
        }
      }
    }
  }

  if (version <= 58) {
    const set = client.settings.configurationSets.get('StatementOfAssetsHistoryView-PICKER');
    if (set) for (const c of set) if (c.data) c.data = c.data.replace('Client-taxes;', 'Client-taxes_accumulated;');
  }

  if (version <= 60) {
    for (const plan of client.plans) {
      if (plan.portfolio !== null) plan.type = 'PURCHASE_OR_DELIVERY';
      else {
        plan.type = plan.amount >= 0 ? 'DEPOSIT' : 'REMOVAL';
        plan.amount = Math.abs(plan.amount);
      }
    }
  }

  if (version <= 61) {
    for (const s of client.securities)
      s.properties = s.properties.filter(
        (p) => !(p.type === 'FEED' && (p.name === 'PORTFOLIO-REPORT-MARKETS' || p.name === 'PORTFOLIO-REPORT-MARKET')),
      );
  }

  if (version <= 64) {
    for (const d of client.dashboards) if (!d.id) d.id = `dashboard-${Math.random().toString(36).slice(2)}`;
  }

  if (version <= 66) {
    // the logo attribute name got translated: rename to 'Logo' if no 'Logo' attribute exists
    const hasLogo = client.settings.attributeTypes.some((t) => t.name === 'Logo' && t.converterClass.endsWith('ImageConverter'));
    if (!hasLogo) {
      const translated = client.settings.attributeTypes.find(
        (t) => t.converterClass.endsWith('ImageConverter') && (t.name === 'Logo' || t.name === 'Symbol'),
      );
      if (translated) translated.name = 'Logo';
    }
  }

  if (version <= 67) {
    for (const t of client.taxonomies) t.source = null;
  }

  // dashboards without ids (should not happen) get one to identify them
  for (const d of client.dashboards) if (!d.id) d.id = `dashboard-${Math.random().toString(36).slice(2)}`;

  client.version = CURRENT_VERSION;
}
