// ClientFilterMenu (name.abuchen.portfolio.ui.util.ClientFilterMenu)

import { Account, Client, ONE_HUNDRED_PERCENT, Portfolio } from '../core/model';
import { ClientFilter, NO_FILTER, PortfolioClientFilter } from '../core/snapshot/filters';

export interface ClientFilterItem {
  id: string;
  label: string;
  uuids: string;
  filter: ClientFilter;
  custom: boolean;
}

export const CLIENT_FILTER_DEFINITIONS = 'client-filter-definitions';

function parseWeight(value: string): number | null {
  const v = value.trim();
  if (!/^[+-]?\d+$/.test(v)) return null;
  const weight = Number.parseInt(v, 10);
  if (weight < 1 || weight > ONE_HUNDRED_PERCENT) return null;
  return weight;
}

export function buildCustomItem(client: Client, id: string, name: string, uuids: string | null): ClientFilterItem | null {
  if (!uuids) return null;
  const tokens = uuids.split(',');
  const uuid2object = new Map<string, Portfolio | Account>();
  for (const p of client.portfolios) uuid2object.set(p.uuid, p);
  for (const a of client.accounts) uuid2object.set(a.uuid, a);
  const elements: (Portfolio | Account)[] = [];
  const weights = new Map<Portfolio | Account, number>();
  for (const token of tokens) {
    let uuid = token;
    let weight: number | null = null;
    const sep = token.indexOf(':');
    if (sep >= 0) {
      uuid = token.substring(0, sep);
      weight = parseWeight(token.substring(sep + 1));
    }
    const element = uuid2object.get(uuid);
    if (!element) continue;
    elements.push(element);
    if (weight !== null) weights.set(element, weight);
  }
  if (elements.length === 0) return null;
  const portfolios = elements.filter((e): e is Portfolio => e.kind === 'portfolio');
  const accounts = elements.filter((e): e is Account => e.kind === 'account');
  const label = name.length > 0 ? name : elements.map((e) => e.name).join(', ');
  return { id, label, uuids, filter: new PortfolioClientFilter(portfolios, accounts, weights), custom: true };
}

export function buildClientFilterItems(client: Client): ClientFilterItem[] {
  const items: ClientFilterItem[] = [{ id: '', label: 'Gesamtportfolio', uuids: '', filter: NO_FILTER, custom: false }];
  for (const portfolio of client.getActivePortfolios()) {
    items.push({
      id: portfolio.uuid,
      label: portfolio.name,
      uuids: portfolio.uuid,
      filter: new PortfolioClientFilter([portfolio], []),
      custom: false,
    });
    const ref = portfolio.referenceAccount;
    if (ref) {
      items.push({
        id: `${portfolio.uuid},${ref.uuid}`,
        label: `${portfolio.name} + ${ref.name}`,
        uuids: `${portfolio.uuid},${ref.uuid}`,
        filter: new PortfolioClientFilter([portfolio], [ref]),
        custom: false,
      });
    }
  }
  for (const conf of client.settings.configurationSets.get(CLIENT_FILTER_DEFINITIONS) ?? []) {
    const item = buildCustomItem(client, conf.uuid, conf.name ?? '', conf.data);
    if (item) items.push(item);
  }
  return items;
}
