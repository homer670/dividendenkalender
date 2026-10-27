// Reads the XML file format (XStream serialization) of Portfolio Performance.
// Supports both reference modes: XPATH_RELATIVE_REFERENCES and ID_REFERENCES.

import { child, childText, parseXml, XmlElement } from './xmlDom';
import { D } from '../util/decimal';
import { parseDate, parseDateTime } from '../util/dates';
import { money } from '../money/money';
import {
  Account,
  AccountTransaction,
  AccountTransferEntry,
  Assignment,
  AttributeType,
  AttributeValue,
  BuySellEntry,
  Classification,
  Client,
  Dashboard,
  InvestmentPlan,
  InvestmentPlanType,
  Portfolio,
  PortfolioTransaction,
  PortfolioTransferEntry,
  Security,
  SecurityEvent,
  SecurityEventType,
  Taxonomy,
  Transaction,
  Unit,
  UnitType,
  InvestmentVehicle,
} from '../model';
import type { LoadWarning } from './protobufClient';
import { upgradeModel } from './upgrade';

interface PendingCrossEntry {
  kind: 'buysell' | 'account-transfer' | 'portfolio-transfer';
  el: XmlElement;
}

class XStreamReader {
  private readonly ids = new Map<string, XmlElement>();
  private readonly memo = new Map<XmlElement, unknown>();
  private readonly pendingCrossEntries = new Map<XmlElement, PendingCrossEntry>();
  readonly client = new Client();

  constructor(
    private readonly root: XmlElement,
    private readonly warnings: LoadWarning[],
  ) {
    if (root.attrs && root.attrs.id !== undefined) this.indexIds(root);
  }

  private indexIds(el: XmlElement): void {
    const stack = [el];
    while (stack.length > 0) {
      const e = stack.pop()!;
      if (e.attrs && e.attrs.id !== undefined && e.attrs.reference === undefined) this.ids.set(e.attrs.id, e);
      for (const c of e.children) stack.push(c);
    }
  }

  /** resolves XStream references */
  deref(el: XmlElement): XmlElement {
    const ref = el.attrs?.reference;
    if (ref === undefined) return el;
    if (this.ids.size > 0) {
      const target = this.ids.get(ref);
      if (!target) throw new Error(`XML: unknown reference id ${ref}`);
      return target;
    }
    let node: XmlElement | null = ref.startsWith('/') ? null : el;
    const segments = ref.split('/');
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg === '') {
        if (i === 0) {
          // absolute path: start at document
          node = { name: '#document', attrs: null, children: [this.root], text: '', parent: null };
        }
        continue;
      }
      if (seg === '.') continue;
      if (node === null) throw new Error(`XML: invalid reference ${ref}`);
      if (seg === '..') {
        node = node.parent;
        continue;
      }
      const m = /^(.*?)(?:\[(\d+)\])?$/.exec(seg)!;
      const name = m[1];
      let index = m[2] ? parseInt(m[2], 10) : 1;
      let found: XmlElement | null = null;
      for (const c of node.children) {
        if (c.name === name && --index === 0) {
          found = c;
          break;
        }
      }
      if (!found) throw new Error(`XML: unresolved reference ${ref}`);
      node = found;
    }
    if (node === null) throw new Error(`XML: unresolved reference ${ref}`);
    return node;
  }

  private memoize<T>(el: XmlElement, create: () => T, fill: (obj: T, el: XmlElement) => void): T {
    const target = this.deref(el);
    const existing = this.memo.get(target);
    if (existing !== undefined) return existing as T;
    const obj = create();
    this.memo.set(target, obj);
    fill(obj, target);
    return obj;
  }

  // ------------------------------------------------------------------
  // primitives

  private str(el: XmlElement, name: string): string | null {
    const c = child(el, name);
    return c ? this.deref(c).text : null;
  }

  private long(el: XmlElement, name: string, def = 0): number {
    const s = childText(el, name);
    return s === undefined || s === '' ? def : parseInt(s, 10);
  }

  private bool(el: XmlElement, name: string): boolean {
    return childText(el, name) === 'true';
  }

  // ------------------------------------------------------------------

  readClient(): Client {
    const el = this.root;
    if (el.name !== 'client') throw new Error('Keine Portfolio Performance Datei (Element <client> fehlt)');
    const client = this.client;
    client.version = this.long(el, 'version');
    const base = childText(el, 'baseCurrency');
    if (base) client.baseCurrency = base;

    // settings first: needed for attribute conversion
    const settings = child(el, 'settings');
    if (settings) this.readSettings(settings);

    const securities = child(el, 'securities');
    if (securities) for (const s of securities.children) client.securities.push(this.readSecurity(s));

    const watchlists = child(el, 'watchlists');
    if (watchlists)
      for (const w of watchlists.children) {
        const list: Security[] = [];
        const ws = child(w, 'securities');
        if (ws) for (const s of ws.children) list.push(this.readSecurity(s));
        client.watchlists.push({ name: childText(w, 'name') ?? '', securities: list });
      }

    const accounts = child(el, 'accounts');
    if (accounts) for (const a of accounts.children) client.accounts.push(this.readAccount(a));

    const portfolios = child(el, 'portfolios');
    if (portfolios) for (const p of portfolios.children) client.portfolios.push(this.readPortfolio(p));

    const plans = child(el, 'plans');
    if (plans) for (const p of plans.children) client.plans.push(this.readPlan(p));

    const taxonomies = child(el, 'taxonomies');
    if (taxonomies) for (const t of taxonomies.children) client.taxonomies.push(this.readTaxonomy(t));

    const dashboards = child(el, 'dashboards');
    if (dashboards) for (const d of dashboards.children) client.dashboards.push(this.readDashboard(d));

    const properties = child(el, 'properties');
    if (properties)
      for (const e of properties.children) {
        const [k, v] = e.children;
        if (k && v) client.properties.set(this.deref(k).text, this.deref(v).text);
      }

    this.resolveCrossEntries();
    return client;
  }

  private readSettings(el: XmlElement): void {
    const settings = this.client.settings;
    const bookmarks = child(el, 'bookmarks');
    if (bookmarks)
      for (const b of bookmarks.children) {
        const bb = this.deref(b);
        settings.bookmarks.push({ label: childText(bb, 'label') ?? '', pattern: childText(bb, 'pattern') ?? '' });
      }
    const attributeTypes = child(el, 'attributeTypes');
    if (attributeTypes)
      for (const a of attributeTypes.children) {
        const aa = this.deref(a);
        const type: AttributeType = {
          id: childText(aa, 'id') ?? '',
          name: childText(aa, 'name') ?? '',
          columnLabel: childText(aa, 'columnLabel') ?? '',
          source: childText(aa, 'source') ?? null,
          target: childText(aa, 'target') ?? '',
          type: childText(aa, 'type') ?? '',
          converterClass: childText(aa, 'converterClass') ?? '',
          properties: new Map(),
        };
        const props = child(aa, 'properties');
        if (props)
          for (const e of props.children) {
            const [k, v] = e.children;
            if (k && v) type.properties.set(this.deref(k).text, this.readTypedValue(v));
          }
        settings.attributeTypes.push(type);
      }
    const configurationSets = child(el, 'configurationSets');
    if (configurationSets)
      for (const e of configurationSets.children) {
        const [k, v] = e.children;
        if (!k || !v) continue;
        const key = this.deref(k).text;
        const set = settings.getConfigurationSet(key);
        const configurations = child(this.deref(v), 'configurations');
        if (configurations)
          for (const c of configurations.children) {
            const cc = this.deref(c);
            set.push({ uuid: childText(cc, 'uuid') ?? '', name: childText(cc, 'name') ?? '', data: childText(cc, 'data') ?? '' });
          }
      }
  }

  /** value of a java.lang.Object field (element name is the type alias) */
  private readTypedValue(el: XmlElement): AttributeValue {
    const e = this.deref(el);
    switch (e.name) {
      case 'null':
        return null;
      case 'string':
        return e.text;
      case 'long':
      case 'int':
      case 'short':
        return parseInt(e.text, 10);
      case 'double':
      case 'float':
        return parseFloat(e.text);
      case 'boolean':
        return e.text === 'true';
      case 'local-date':
        return parseDate(e.text);
      case 'limitPrice': {
        const op = childText(e, 'operator') ?? 'GREATER_OR_EQUAL';
        const ops: Record<string, string> = {
          GREATER_OR_EQUAL: '>=',
          SMALLER_OR_EQUAL: '<=',
          GREATER: '>',
          SMALLER: '<',
        };
        return { relationalOperator: ops[op] ?? '>=', value: this.long(e, 'value') };
      }
      case 'money': {
        return {
          currencyCode: e.attrs?.currency ?? '',
          amount: parseInt(e.attrs?.amount ?? '0', 10),
        } as unknown as AttributeValue;
      }
      default:
        return e.text;
    }
  }

  private readAttributes(el: XmlElement, target: Map<string, AttributeValue>): void {
    const attributes = child(el, 'attributes');
    if (!attributes) return;
    const map = child(this.deref(attributes), 'map');
    if (!map) return;
    for (const entry of map.children) {
      const [k, v] = entry.children;
      if (!k || !v) continue;
      target.set(this.deref(k).text, this.readTypedValue(v));
    }
  }

  private readDataMap(el: XmlElement | undefined): Map<string, unknown> | null {
    if (!el) return null;
    const d = this.deref(el);
    if (d.children.length === 0) return null;
    const data = new Map<string, unknown>();
    for (const entry of d.children) {
      const [k, v] = entry.children;
      if (!k || !v) continue;
      data.set(this.deref(k).text, this.readTypedValue(v));
    }
    return data;
  }

  readSecurity(el: XmlElement): Security {
    return this.memoize(
      el,
      () => new Security(childText(this.deref(el), 'uuid') ?? undefined),
      (s, e) => {
        s.onlineId = this.str(e, 'onlineId');
        s.name = this.str(e, 'name') ?? '';
        s.currencyCode = this.str(e, 'currencyCode') as string;
        s.targetCurrencyCode = this.str(e, 'targetCurrencyCode');
        s.note = this.str(e, 'note');
        s.isin = this.str(e, 'isin');
        s.tickerSymbol = this.str(e, 'tickerSymbol');
        s.wkn = this.str(e, 'wkn');
        s.calendar = this.str(e, 'calendar');
        s.feed = this.str(e, 'feed');
        s.feedURL = this.str(e, 'feedURL');
        s.latestFeed = this.str(e, 'latestFeed');
        s.latestFeedURL = this.str(e, 'latestFeedURL');
        const prices = child(e, 'prices');
        if (prices) {
          const list = this.deref(prices).children.map((p) => ({
            date: parseDate(p.attrs?.t ?? ''),
            value: parseInt(p.attrs?.v ?? '0', 10),
          }));
          list.sort((a, b) => a.date - b.date);
          s.prices = list;
        }
        const latest = child(e, 'latest');
        if (latest) {
          const l = this.deref(latest);
          s.latest = {
            date: l.attrs?.t ? parseDate(l.attrs.t) : 0,
            value: parseInt(l.attrs?.v ?? '0', 10),
            high: this.long(l, 'high'),
            low: this.long(l, 'low'),
            volume: this.long(l, 'volume'),
          };
        }
        this.readAttributes(e, s.attributes);
        const events = child(e, 'events');
        if (events)
          for (const ev of events.children) {
            const ee = this.deref(ev);
            const type = (childText(ee, 'type') ?? 'NOTE') as SecurityEventType;
            const date = childText(ee, 'date');
            const event: SecurityEvent = {
              type: ee.name === 'dividendEvent' ? 'DIVIDEND_PAYMENT' : type,
              date: date ? parseDate(date) : null,
              details: childText(ee, 'details') ?? null,
              source: childText(ee, 'source') ?? null,
            };
            if (ee.name === 'dividendEvent') {
              const pd = childText(ee, 'paymentDate');
              event.paymentDate = pd ? parseDate(pd) : null;
              const amount = child(ee, 'amount');
              event.amount = amount?.attrs
                ? money(amount.attrs.currency, parseInt(amount.attrs.amount ?? '0', 10))
                : null;
            }
            s.events.push(event);
          }
        for (const c of e.children) {
          if (c.name !== 'property') continue;
          const p = this.deref(c);
          s.properties.push({ type: p.attrs?.type ?? '', name: p.attrs?.name ?? '', value: p.text });
        }
        s.isRetired = this.bool(e, 'isRetired');
        const updatedAt = childText(e, 'updatedAt');
        s.updatedAt = updatedAt ? Date.parse(updatedAt) / 1000 : null;
      },
    );
  }

  readAccount(el: XmlElement): Account {
    return this.memoize(
      el,
      () => new Account(childText(this.deref(el), 'uuid') ?? undefined),
      (a, e) => {
        a.name = this.str(e, 'name') ?? '';
        a.currencyCode = this.str(e, 'currencyCode') ?? 'EUR';
        a.note = this.str(e, 'note');
        a.isRetired = this.bool(e, 'isRetired');
        this.readAttributes(e, a.attributes);
        const txs = child(e, 'transactions');
        if (txs) for (const t of this.deref(txs).children) a.transactions.push(this.readAccountTransaction(t));
        const updatedAt = childText(e, 'updatedAt');
        a.updatedAt = updatedAt ? Date.parse(updatedAt) / 1000 : null;
      },
    );
  }

  readPortfolio(el: XmlElement): Portfolio {
    return this.memoize(
      el,
      () => new Portfolio(childText(this.deref(el), 'uuid') ?? undefined),
      (p, e) => {
        p.name = this.str(e, 'name') ?? '';
        p.note = this.str(e, 'note');
        p.isRetired = this.bool(e, 'isRetired');
        const ref = child(e, 'referenceAccount');
        if (ref) p.referenceAccount = this.readAccount(ref);
        this.readAttributes(e, p.attributes);
        const txs = child(e, 'transactions');
        if (txs) for (const t of this.deref(txs).children) p.transactions.push(this.readPortfolioTransaction(t));
        const updatedAt = childText(e, 'updatedAt');
        p.updatedAt = updatedAt ? Date.parse(updatedAt) / 1000 : null;
      },
    );
  }

  private readTransactionCommon(t: Transaction, e: XmlElement): void {
    const date = childText(e, 'date');
    if (date) t.dateTime = parseDateTime(date);
    t.currencyCode = this.str(e, 'currencyCode') ?? 'EUR';
    t.amount = this.long(e, 'amount');
    const sec = child(e, 'security');
    if (sec) t.security = this.readSecurity(sec);
    t.shares = this.long(e, 'shares');
    t.note = this.str(e, 'note');
    t.source = this.str(e, 'source');
    const units = child(e, 'units');
    if (units)
      for (const u of this.deref(units).children) {
        const uu = this.deref(u);
        const type = (uu.attrs?.type ?? 'FEE') as UnitType;
        const amount = child(uu, 'amount');
        const forex = child(uu, 'forex');
        const rate = childText(uu, 'exchangeRate');
        const m = money(amount?.attrs?.currency ?? t.currencyCode, parseInt(amount?.attrs?.amount ?? '0', 10));
        if (forex && forex.attrs) {
          const fx = money(forex.attrs.currency, parseInt(forex.attrs.amount ?? '0', 10));
          t.units.push(new Unit(type, m, fx, rate ? new D(rate) : new D(0)));
        } else {
          t.units.push(new Unit(type, m));
        }
      }
    const updatedAt = childText(e, 'updatedAt');
    t.updatedAt = updatedAt ? Date.parse(updatedAt) / 1000 : null;
    const ce = child(e, 'crossEntry');
    if (ce) {
      const target = this.deref(ce);
      let pending = this.pendingCrossEntries.get(target);
      if (!pending) {
        const cls = target.attrs?.class ?? ce.attrs?.class ?? 'buysell';
        pending = { kind: cls as PendingCrossEntry['kind'], el: target };
        this.pendingCrossEntries.set(target, pending);
        // make sure all objects referenced by the cross entry are read
        for (const c of target.children) {
          switch (c.name) {
            case 'portfolio':
            case 'portfolioFrom':
            case 'portfolioTo':
              this.readPortfolio(c);
              break;
            case 'account':
            case 'accountFrom':
            case 'accountTo':
              this.readAccount(c);
              break;
            case 'portfolioTransaction':
              this.readPortfolioTransaction(c);
              break;
            case 'accountTransaction':
              this.readAccountTransaction(c);
              break;
            case 'transactionFrom':
            case 'transactionTo':
              if (pending.kind === 'portfolio-transfer') this.readPortfolioTransaction(c);
              else this.readAccountTransaction(c);
              break;
            default:
              break;
          }
        }
      }
    }
  }

  readAccountTransaction(el: XmlElement): AccountTransaction {
    return this.memoize(
      el,
      () => new AccountTransaction(childText(this.deref(el), 'uuid') ?? undefined),
      (t, e) => {
        t.type = (childText(e, 'type') ?? 'DEPOSIT') as AccountTransaction['type'];
        const exDate = childText(e, 'exDate');
        if (exDate) t.exDate = parseDateTime(exDate);
        this.readTransactionCommon(t, e);
      },
    );
  }

  readPortfolioTransaction(el: XmlElement): PortfolioTransaction {
    return this.memoize(
      el,
      () => new PortfolioTransaction(childText(this.deref(el), 'uuid') ?? undefined),
      (t, e) => {
        t.type = (childText(e, 'type') ?? 'BUY') as PortfolioTransaction['type'];
        this.readTransactionCommon(t, e);
      },
    );
  }

  private resolveCrossEntries(): void {
    for (const pending of this.pendingCrossEntries.values()) {
      const e = pending.el;
      const get = (name: string): XmlElement | undefined => child(e, name);
      try {
        switch (pending.kind) {
          case 'buysell': {
            const p = get('portfolio');
            const pt = get('portfolioTransaction');
            const a = get('account');
            const at = get('accountTransaction');
            if (!p || !pt || !a || !at) throw new Error('incomplete buysell entry');
            new BuySellEntry(
              this.readPortfolio(p),
              this.readPortfolioTransaction(pt),
              this.readAccount(a),
              this.readAccountTransaction(at),
            );
            break;
          }
          case 'account-transfer': {
            const af = get('accountFrom');
            const tf = get('transactionFrom');
            const at = get('accountTo');
            const tt = get('transactionTo');
            if (!af || !tf || !at || !tt) throw new Error('incomplete account transfer');
            const from = this.readAccountTransaction(tf);
            const to = this.readAccountTransaction(tt);
            new AccountTransferEntry(this.readAccount(af), from, this.readAccount(at), to);
            break;
          }
          case 'portfolio-transfer': {
            const pf = get('portfolioFrom');
            const tf = get('transactionFrom');
            const pt = get('portfolioTo');
            const tt = get('transactionTo');
            if (!pf || !tf || !pt || !tt) throw new Error('incomplete portfolio transfer');
            new PortfolioTransferEntry(
              this.readPortfolio(pf),
              this.readPortfolioTransaction(tf),
              this.readPortfolio(pt),
              this.readPortfolioTransaction(tt),
            );
            break;
          }
        }
      } catch (err) {
        this.warnings.push({ message: `Querverweis konnte nicht gelesen werden: ${(err as Error).message}` });
      }
    }
  }

  private readPlan(el: XmlElement): InvestmentPlan {
    const e = this.deref(el);
    const sec = child(e, 'security');
    const port = child(e, 'portfolio');
    const acc = child(e, 'account');
    const start = childText(e, 'start');
    const plan: InvestmentPlan = {
      name: childText(e, 'name') ?? '',
      note: childText(e, 'note') ?? null,
      security: sec ? this.readSecurity(sec) : null,
      portfolio: port ? this.readPortfolio(port) : null,
      account: acc ? this.readAccount(acc) : null,
      attributes: new Map(),
      autoGenerate: this.bool(e, 'autoGenerate'),
      start: start ? parseDateTime(start) : 0,
      interval: this.long(e, 'interval', 1),
      amount: this.long(e, 'amount'),
      fees: this.long(e, 'fees'),
      taxes: this.long(e, 'taxes'),
      type: (childText(e, 'type') ?? 'PURCHASE_OR_DELIVERY') as InvestmentPlanType,
      transactions: [],
    };
    this.readAttributes(e, plan.attributes);
    const txs = child(e, 'transactions');
    if (txs)
      for (const t of this.deref(txs).children) {
        const tt = this.deref(t);
        plan.transactions.push(
          tt.name === 'portfolio-transaction' ? this.readPortfolioTransaction(t) : this.readAccountTransaction(t),
        );
      }
    return plan;
  }

  private readClassification(el: XmlElement): Classification {
    return this.memoize(
      el,
      () => {
        const e = this.deref(el);
        return new Classification(childText(e, 'id') ?? '', childText(e, 'name') ?? '', childText(e, 'color') ?? '#999999');
      },
      (c, e) => {
        c.note = childText(e, 'description') ?? null;
        const parent = child(e, 'parent');
        if (parent) c.parent = this.readClassification(parent);
        const children = child(e, 'children');
        if (children) for (const ch of this.deref(children).children) c.children.push(this.readClassification(ch));
        const assignments = child(e, 'assignments');
        if (assignments)
          for (const a of this.deref(assignments).children) {
            const aa = this.deref(a);
            const iv = child(aa, 'investmentVehicle');
            if (!iv) continue;
            const target = this.deref(iv);
            const cls = iv.attrs?.class ?? target.attrs?.class ?? target.name;
            const vehicle: InvestmentVehicle = cls === 'account' ? this.readAccount(iv) : this.readSecurity(iv);
            const assignment = new Assignment(vehicle, this.long(aa, 'weight'));
            assignment.rank = this.long(aa, 'rank');
            assignment.data = this.readDataMap(child(aa, 'data'));
            c.assignments.push(assignment);
          }
        c.weight = this.long(e, 'weight');
        c.rank = this.long(e, 'rank');
        c.data = this.readDataMap(child(e, 'data'));
      },
    );
  }

  private readTaxonomy(el: XmlElement): Taxonomy {
    const e = this.deref(el);
    const t = new Taxonomy(childText(e, 'id') ?? '', childText(e, 'name') ?? '');
    t.source = childText(e, 'source') ?? null;
    const dims = child(e, 'dimensions');
    if (dims) t.dimensions = this.deref(dims).children.map((d) => this.deref(d).text);
    const root = child(e, 'root');
    if (root) t.root = this.readClassification(root);
    else t.root = new Classification('root', t.name);
    return t;
  }

  private readStringMap(el: XmlElement | undefined): Record<string, string> {
    const answer: Record<string, string> = {};
    if (!el) return answer;
    for (const entry of this.deref(el).children) {
      const [k, v] = entry.children;
      if (k && v) answer[this.deref(k).text] = this.deref(v).text;
    }
    return answer;
  }

  private readDashboard(el: XmlElement): Dashboard {
    const e = this.deref(el);
    const d: Dashboard = {
      id: childText(e, 'id') ?? '',
      name: e.attrs?.name ?? childText(e, 'name') ?? '',
      configuration: this.readStringMap(child(e, 'configuration')),
      columns: [],
    };
    const columns = child(e, 'columns');
    if (columns)
      for (const c of this.deref(columns).children) {
        const cc = this.deref(c);
        const column = { weight: this.long(cc, 'weight', 1), widgets: [] as Dashboard['columns'][number]['widgets'] };
        const widgets = child(cc, 'widgets');
        if (widgets)
          for (const w of this.deref(widgets).children) {
            const ww = this.deref(w);
            column.widgets.push({
              type: ww.attrs?.type ?? childText(ww, 'type') ?? '',
              label: childText(ww, 'label') ?? '',
              configuration: this.readStringMap(child(ww, 'configuration')),
            });
          }
        d.columns.push(column);
      }
    return d;
  }
}

export function loadXmlClient(xml: string, warnings: LoadWarning[] = []): Client {
  const root = parseXml(xml);
  const reader = new XStreamReader(root, warnings);
  const client = reader.readClient();
  upgradeModel(client);
  return client;
}

// exported for tests
export { XStreamReader };
