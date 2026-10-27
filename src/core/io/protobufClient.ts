// Reads the binary (protobuf) file format of Portfolio Performance
// (see name.abuchen.portfolio.model.ProtobufWriter and client.proto)

import Decimal from 'decimal.js';
import { ProtoReader } from './protoReader';
import { D } from '../util/decimal';
import { LocalDateTime, SECONDS_PER_DAY } from '../util/dates';
import { money } from '../money/money';
import {
  Account,
  AccountTransaction,
  AccountTransferEntry,
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
  Taxonomy,
  Transaction,
  Unit,
  UnitType,
  Assignment,
} from '../model';
import { convertAttributeFromProto } from './attributes';
import { upgradeModel } from './upgrade';

export const PROTOBUF_SIGNATURE = [0x50, 0x50, 0x50, 0x42, 0x56, 0x31]; // PPPBV1

// ---------------------------------------------------------------------
// generic value types

export type PAnyValue =
  | { kind: 'null' }
  | { kind: 'string'; value: string }
  | { kind: 'int32'; value: number }
  | { kind: 'int64'; value: number }
  | { kind: 'double'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'map'; value: PKeyValue[] }
  | { kind: 'none' };

export interface PKeyValue {
  key: string;
  value: PAnyValue;
}

function readAnyValue(r: ProtoReader): PAnyValue {
  let v: PAnyValue = { kind: 'none' };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        rr.int64();
        v = { kind: 'null' };
        break;
      case 2:
        v = { kind: 'string', value: rr.string() };
        break;
      case 3:
        v = { kind: 'int32', value: rr.int32() };
        break;
      case 4:
        v = { kind: 'int64', value: rr.int64() };
        break;
      case 5:
        v = { kind: 'double', value: rr.double() };
        break;
      case 6:
        v = { kind: 'bool', value: rr.bool() };
        break;
      case 7:
        v = { kind: 'map', value: readMap(rr.message()) };
        break;
      default:
        rr.skip(wt);
    }
  });
  return v;
}

function readKeyValue(r: ProtoReader): PKeyValue {
  let key = '';
  let value: PAnyValue = { kind: 'none' };
  r.forEach((f, wt, rr) => {
    if (f === 1) key = rr.string();
    else if (f === 2) value = readAnyValue(rr.message());
    else rr.skip(wt);
  });
  return { key, value };
}

function readMap(r: ProtoReader): PKeyValue[] {
  const entries: PKeyValue[] = [];
  r.forEach((f, wt, rr) => {
    if (f === 1) entries.push(readKeyValue(rr.message()));
    else rr.skip(wt);
  });
  return entries;
}

/** map<string, string> entry */
function readStringMapEntry(r: ProtoReader): [string, string] {
  let key = '';
  let value = '';
  r.forEach((f, wt, rr) => {
    if (f === 1) key = rr.string();
    else if (f === 2) value = rr.string();
    else rr.skip(wt);
  });
  return [key, value];
}

/** google.protobuf.Timestamp -> epoch seconds */
function readTimestamp(r: ProtoReader): number {
  let seconds = 0;
  r.forEach((f, wt, rr) => {
    if (f === 1) seconds = rr.int64();
    else rr.skip(wt);
  });
  return seconds;
}

function readLocalDateTime(r: ProtoReader): LocalDateTime {
  let epochDay = 0;
  let secondOfDay = 0;
  r.forEach((f, wt, rr) => {
    if (f === 1) epochDay = rr.int64();
    else if (f === 2) secondOfDay = rr.int32();
    else rr.skip(wt);
  });
  return epochDay * SECONDS_PER_DAY + secondOfDay;
}

/** PDecimalValue -> BigDecimal(new BigInteger(bytes), scale, new MathContext(precision)) */
function readDecimal(r: ProtoReader): Decimal {
  let scale = 0;
  let precision = 0;
  let bytes: Uint8Array = new Uint8Array(0);
  r.forEach((f, wt, rr) => {
    if (f === 1) scale = rr.uint32();
    else if (f === 2) precision = rr.uint32();
    else if (f === 3) bytes = rr.bytes().slice();
    else rr.skip(wt);
  });
  let unscaled = new D(0);
  if (bytes.length > 0) {
    // two's complement big endian
    let big = 0n;
    for (const b of bytes) big = (big << 8n) | BigInt(b);
    if (bytes[0] & 0x80) big -= 1n << BigInt(bytes.length * 8);
    unscaled = new D(big.toString());
  }
  let value = scale === 0 ? unscaled : unscaled.div(new D(10).pow(scale));
  if (precision > 0) value = value.toSignificantDigits(precision, Decimal.ROUND_HALF_UP);
  return value;
}

// ---------------------------------------------------------------------
// raw messages

interface PHistoricalPrice {
  date: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

function readPrice(r: ProtoReader): PHistoricalPrice {
  const p: PHistoricalPrice = { date: 0, close: 0, high: 0, low: 0, volume: 0 };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        p.date = rr.int64();
        break;
      case 2:
        p.close = rr.int64();
        break;
      case 3:
        p.high = rr.int64();
        break;
      case 4:
        p.low = rr.int64();
        break;
      case 5:
        p.volume = rr.int64();
        break;
      default:
        rr.skip(wt);
    }
  });
  return p;
}

interface PSecurityEvent {
  type: number;
  date: number;
  details: string;
  data: PAnyValue[];
  source: string;
}

function readSecurityEvent(r: ProtoReader): PSecurityEvent {
  const e: PSecurityEvent = { type: 0, date: 0, details: '', data: [], source: '' };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        e.type = rr.int32();
        break;
      case 2:
        e.date = rr.int64();
        break;
      case 3:
        e.details = rr.string();
        break;
      case 4:
        e.data.push(readAnyValue(rr.message()));
        break;
      case 5:
        e.source = rr.string();
        break;
      default:
        rr.skip(wt);
    }
  });
  return e;
}

interface PSecurity {
  uuid: string;
  onlineId?: string;
  name: string;
  currencyCode?: string;
  targetCurrencyCode?: string;
  note?: string;
  isin?: string;
  tickerSymbol?: string;
  wkn?: string;
  calendar?: string;
  feed?: string;
  feedURL?: string;
  prices: PHistoricalPrice[];
  latestFeed?: string;
  latestFeedURL?: string;
  latest?: PHistoricalPrice;
  attributes: PKeyValue[];
  events: PSecurityEvent[];
  properties: PKeyValue[];
  isRetired: boolean;
  updatedAt?: number;
}

function readSecurity(r: ProtoReader): PSecurity {
  const s: PSecurity = { uuid: '', name: '', prices: [], attributes: [], events: [], properties: [], isRetired: false };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        s.uuid = rr.string();
        break;
      case 2:
        s.onlineId = rr.string();
        break;
      case 3:
        s.name = rr.string();
        break;
      case 4:
        s.currencyCode = rr.string();
        break;
      case 5:
        s.targetCurrencyCode = rr.string();
        break;
      case 6:
        s.note = rr.string();
        break;
      case 7:
        s.isin = rr.string();
        break;
      case 8:
        s.tickerSymbol = rr.string();
        break;
      case 9:
        s.wkn = rr.string();
        break;
      case 10:
        s.calendar = rr.string();
        break;
      case 11:
        s.feed = rr.string();
        break;
      case 12:
        s.feedURL = rr.string();
        break;
      case 13:
        s.prices.push(readPrice(rr.message()));
        break;
      case 14:
        s.latestFeed = rr.string();
        break;
      case 15:
        s.latestFeedURL = rr.string();
        break;
      case 16:
        s.latest = readPrice(rr.message());
        break;
      case 17:
        s.attributes.push(readKeyValue(rr.message()));
        break;
      case 18:
        s.events.push(readSecurityEvent(rr.message()));
        break;
      case 19:
        s.properties.push(readKeyValue(rr.message()));
        break;
      case 20:
        s.isRetired = rr.bool();
        break;
      case 21:
        s.updatedAt = readTimestamp(rr.message());
        break;
      default:
        rr.skip(wt);
    }
  });
  return s;
}

interface PAccount {
  uuid: string;
  name: string;
  currencyCode: string;
  note?: string;
  isRetired: boolean;
  attributes: PKeyValue[];
  updatedAt?: number;
}

function readAccount(r: ProtoReader): PAccount {
  const a: PAccount = { uuid: '', name: '', currencyCode: '', isRetired: false, attributes: [] };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        a.uuid = rr.string();
        break;
      case 2:
        a.name = rr.string();
        break;
      case 3:
        a.currencyCode = rr.string();
        break;
      case 4:
        a.note = rr.string();
        break;
      case 5:
        a.isRetired = rr.bool();
        break;
      case 6:
        a.attributes.push(readKeyValue(rr.message()));
        break;
      case 7:
        a.updatedAt = readTimestamp(rr.message());
        break;
      default:
        rr.skip(wt);
    }
  });
  return a;
}

interface PPortfolio {
  uuid: string;
  name: string;
  note?: string;
  isRetired: boolean;
  referenceAccount?: string;
  attributes: PKeyValue[];
  updatedAt?: number;
}

function readPortfolio(r: ProtoReader): PPortfolio {
  const p: PPortfolio = { uuid: '', name: '', isRetired: false, attributes: [] };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        p.uuid = rr.string();
        break;
      case 2:
        p.name = rr.string();
        break;
      case 3:
        p.note = rr.string();
        break;
      case 4:
        p.isRetired = rr.bool();
        break;
      case 5:
        p.referenceAccount = rr.string();
        break;
      case 6:
        p.attributes.push(readKeyValue(rr.message()));
        break;
      case 7:
        p.updatedAt = readTimestamp(rr.message());
        break;
      default:
        rr.skip(wt);
    }
  });
  return p;
}

interface PTransactionUnit {
  type: number;
  amount: number;
  currencyCode: string;
  fxAmount?: number;
  fxCurrencyCode?: string;
  fxRateToBase?: Decimal;
}

function readUnit(r: ProtoReader): PTransactionUnit {
  const u: PTransactionUnit = { type: 0, amount: 0, currencyCode: '' };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        u.type = rr.int32();
        break;
      case 2:
        u.amount = rr.int64();
        break;
      case 3:
        u.currencyCode = rr.string();
        break;
      case 4:
        u.fxAmount = rr.int64();
        break;
      case 5:
        u.fxCurrencyCode = rr.string();
        break;
      case 6:
        u.fxRateToBase = readDecimal(rr.message());
        break;
      default:
        rr.skip(wt);
    }
  });
  return u;
}

interface PTransaction {
  uuid: string;
  type: number;
  account?: string;
  portfolio?: string;
  otherAccount?: string;
  otherPortfolio?: string;
  otherUuid?: string;
  otherUpdatedAt?: number;
  date: number;
  currencyCode: string;
  amount: number;
  shares?: number;
  note?: string;
  security?: string;
  units: PTransactionUnit[];
  updatedAt?: number;
  source?: string;
  exDate?: LocalDateTime;
}

function readTransaction(r: ProtoReader): PTransaction {
  const t: PTransaction = { uuid: '', type: 0, date: 0, currencyCode: '', amount: 0, units: [] };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        t.uuid = rr.string();
        break;
      case 2:
        t.type = rr.int32();
        break;
      case 3:
        t.account = rr.string();
        break;
      case 4:
        t.portfolio = rr.string();
        break;
      case 5:
        t.otherAccount = rr.string();
        break;
      case 6:
        t.otherPortfolio = rr.string();
        break;
      case 7:
        t.otherUuid = rr.string();
        break;
      case 8:
        t.otherUpdatedAt = readTimestamp(rr.message());
        break;
      case 9:
        t.date = readTimestamp(rr.message());
        break;
      case 10:
        t.currencyCode = rr.string();
        break;
      case 11:
        t.amount = rr.int64();
        break;
      case 12:
        t.shares = rr.int64();
        break;
      case 13:
        t.note = rr.string();
        break;
      case 14:
        t.security = rr.string();
        break;
      case 15:
        t.units.push(readUnit(rr.message()));
        break;
      case 16:
        t.updatedAt = readTimestamp(rr.message());
        break;
      case 17:
        t.source = rr.string();
        break;
      case 18:
        t.exDate = readLocalDateTime(rr.message());
        break;
      default:
        rr.skip(wt);
    }
  });
  return t;
}

interface PInvestmentPlan {
  name: string;
  note?: string;
  security?: string;
  portfolio?: string;
  account?: string;
  attributes: PKeyValue[];
  autoGenerate: boolean;
  date: number;
  interval: number;
  amount: number;
  fees: number;
  transactions: string[];
  taxes: number;
  type: number;
}

function readPlan(r: ProtoReader): PInvestmentPlan {
  const p: PInvestmentPlan = {
    name: '',
    attributes: [],
    autoGenerate: false,
    date: 0,
    interval: 0,
    amount: 0,
    fees: 0,
    transactions: [],
    taxes: 0,
    type: 0,
  };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        p.name = rr.string();
        break;
      case 2:
        p.note = rr.string();
        break;
      case 3:
        p.security = rr.string();
        break;
      case 4:
        p.portfolio = rr.string();
        break;
      case 5:
        p.account = rr.string();
        break;
      case 6:
        p.attributes.push(readKeyValue(rr.message()));
        break;
      case 7:
        p.autoGenerate = rr.bool();
        break;
      case 8:
        p.date = rr.int64();
        break;
      case 9:
        p.interval = rr.int32();
        break;
      case 10:
        p.amount = rr.int64();
        break;
      case 11:
        p.fees = rr.int64();
        break;
      case 12:
        p.transactions.push(rr.string());
        break;
      case 13:
        p.taxes = rr.int64();
        break;
      case 14:
        p.type = rr.int32();
        break;
      default:
        rr.skip(wt);
    }
  });
  return p;
}

interface PWatchlist {
  name: string;
  securities: string[];
}

function readWatchlist(r: ProtoReader): PWatchlist {
  const w: PWatchlist = { name: '', securities: [] };
  r.forEach((f, wt, rr) => {
    if (f === 1) w.name = rr.string();
    else if (f === 2) w.securities.push(rr.string());
    else rr.skip(wt);
  });
  return w;
}

interface PAssignment {
  investmentVehicle: string;
  weight: number;
  rank: number;
  data: PKeyValue[];
}

interface PClassification {
  id: string;
  parentId?: string;
  name: string;
  note?: string;
  color: string;
  weight: number;
  rank: number;
  data: PKeyValue[];
  assignments: PAssignment[];
}

interface PTaxonomy {
  id: string;
  name: string;
  source?: string;
  dimensions: string[];
  classifications: PClassification[];
}

function readAssignment(r: ProtoReader): PAssignment {
  const a: PAssignment = { investmentVehicle: '', weight: 0, rank: 0, data: [] };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        a.investmentVehicle = rr.string();
        break;
      case 2:
        a.weight = rr.int32();
        break;
      case 3:
        a.rank = rr.int32();
        break;
      case 4:
        a.data.push(readKeyValue(rr.message()));
        break;
      default:
        rr.skip(wt);
    }
  });
  return a;
}

function readClassification(r: ProtoReader): PClassification {
  const c: PClassification = { id: '', name: '', color: '', weight: 0, rank: 0, data: [], assignments: [] };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        c.id = rr.string();
        break;
      case 2:
        c.parentId = rr.string();
        break;
      case 3:
        c.name = rr.string();
        break;
      case 4:
        c.note = rr.string();
        break;
      case 5:
        c.color = rr.string();
        break;
      case 6:
        c.weight = rr.int32();
        break;
      case 7:
        c.rank = rr.int32();
        break;
      case 8:
        c.data.push(readKeyValue(rr.message()));
        break;
      case 9:
        c.assignments.push(readAssignment(rr.message()));
        break;
      default:
        rr.skip(wt);
    }
  });
  return c;
}

function readTaxonomy(r: ProtoReader): PTaxonomy {
  const t: PTaxonomy = { id: '', name: '', dimensions: [], classifications: [] };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        t.id = rr.string();
        break;
      case 2:
        t.name = rr.string();
        break;
      case 3:
        t.source = rr.string();
        break;
      case 4:
        t.dimensions.push(rr.string());
        break;
      case 5:
        t.classifications.push(readClassification(rr.message()));
        break;
      default:
        rr.skip(wt);
    }
  });
  return t;
}

function readDashboard(r: ProtoReader): Dashboard {
  const d: Dashboard = { id: '', name: '', configuration: {}, columns: [] };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        d.name = rr.string();
        break;
      case 2: {
        const [k, v] = readStringMapEntry(rr.message());
        d.configuration[k] = v;
        break;
      }
      case 3: {
        const column = { weight: 0, widgets: [] as Dashboard['columns'][number]['widgets'] };
        rr.message().forEach((cf, cwt, cr) => {
          if (cf === 1) column.weight = cr.int32();
          else if (cf === 2) {
            const widget = { type: '', label: '', configuration: {} as Record<string, string> };
            cr.message().forEach((wf, wwt, wr) => {
              if (wf === 1) widget.type = wr.string();
              else if (wf === 2) widget.label = wr.string();
              else if (wf === 3) {
                const [k, v] = readStringMapEntry(wr.message());
                widget.configuration[k] = v;
              } else wr.skip(wwt);
            });
            column.widgets.push(widget);
          } else cr.skip(cwt);
        });
        d.columns.push(column);
        break;
      }
      case 4:
        d.id = rr.string();
        break;
      default:
        rr.skip(wt);
    }
  });
  return d;
}

interface PSettingsRaw {
  bookmarks: { label: string; pattern: string }[];
  attributeTypes: AttributeType[];
  configurationSets: { key: string; uuid: string; name: string; data: string }[];
}

function readSettings(r: ProtoReader): PSettingsRaw {
  const s: PSettingsRaw = { bookmarks: [], attributeTypes: [], configurationSets: [] };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1: {
        const b = { label: '', pattern: '' };
        rr.message().forEach((bf, bwt, br) => {
          if (bf === 1) b.label = br.string();
          else if (bf === 2) b.pattern = br.string();
          else br.skip(bwt);
        });
        s.bookmarks.push(b);
        break;
      }
      case 2: {
        const a: AttributeType = {
          id: '',
          name: '',
          columnLabel: '',
          source: null,
          target: '',
          type: '',
          converterClass: '',
          properties: new Map(),
        };
        rr.message().forEach((af, awt, ar) => {
          switch (af) {
            case 1:
              a.id = ar.string();
              break;
            case 2:
              a.name = ar.string();
              break;
            case 3:
              a.columnLabel = ar.string();
              break;
            case 4:
              a.source = ar.string();
              break;
            case 5:
              a.target = ar.string();
              break;
            case 6:
              a.type = ar.string();
              break;
            case 7:
              a.converterClass = ar.string();
              break;
            case 8:
              for (const kv of readMap(ar.message())) {
                const v = kv.value;
                a.properties.set(kv.key, v.kind === 'string' || v.kind === 'bool' ? v.value : null);
              }
              break;
            default:
              ar.skip(awt);
          }
        });
        s.attributeTypes.push(a);
        break;
      }
      case 3: {
        const c = { key: '', uuid: '', name: '', data: '' };
        rr.message().forEach((cf, cwt, cr) => {
          if (cf === 1) c.key = cr.string();
          else if (cf === 2) c.uuid = cr.string();
          else if (cf === 3) c.name = cr.string();
          else if (cf === 4) c.data = cr.string();
          else cr.skip(cwt);
        });
        s.configurationSets.push(c);
        break;
      }
      default:
        rr.skip(wt);
    }
  });
  return s;
}

interface PClientRaw {
  version: number;
  securities: PSecurity[];
  accounts: PAccount[];
  portfolios: PPortfolio[];
  transactions: PTransaction[];
  plans: PInvestmentPlan[];
  watchlists: PWatchlist[];
  taxonomies: PTaxonomy[];
  dashboards: Dashboard[];
  properties: [string, string][];
  settings: PSettingsRaw;
  baseCurrency: string;
}

function readClient(r: ProtoReader): PClientRaw {
  const c: PClientRaw = {
    version: 0,
    securities: [],
    accounts: [],
    portfolios: [],
    transactions: [],
    plans: [],
    watchlists: [],
    taxonomies: [],
    dashboards: [],
    properties: [],
    settings: { bookmarks: [], attributeTypes: [], configurationSets: [] },
    baseCurrency: '',
  };
  r.forEach((f, wt, rr) => {
    switch (f) {
      case 1:
        c.version = rr.int32();
        break;
      case 2:
        c.securities.push(readSecurity(rr.message()));
        break;
      case 3:
        c.accounts.push(readAccount(rr.message()));
        break;
      case 4:
        c.portfolios.push(readPortfolio(rr.message()));
        break;
      case 5:
        c.transactions.push(readTransaction(rr.message()));
        break;
      case 6:
        c.plans.push(readPlan(rr.message()));
        break;
      case 7:
        c.watchlists.push(readWatchlist(rr.message()));
        break;
      case 8:
        c.taxonomies.push(readTaxonomy(rr.message()));
        break;
      case 9:
        c.dashboards.push(readDashboard(rr.message()));
        break;
      case 10:
        c.properties.push(readStringMapEntry(rr.message()));
        break;
      case 11:
        c.settings = readSettings(rr.message());
        break;
      case 12:
        c.baseCurrency = rr.string();
        break;
      default:
        rr.skip(wt);
    }
  });
  return c;
}

// ---------------------------------------------------------------------
// conversion into the model

function fromAttributes(list: PKeyValue[], client: Client, target: Map<string, AttributeValue>): void {
  for (const entry of list) {
    const type = client.settings.attributeTypes.find((a) => a.id === entry.key);
    if (!type) continue;
    target.set(type.id, convertAttributeFromProto(type, entry.value));
  }
}

function fromKeyValueData(list: PKeyValue[]): Map<string, unknown> | null {
  if (list.length === 0) return null;
  const data = new Map<string, unknown>();
  for (const kv of list) {
    const v = kv.value;
    let value: unknown = null;
    if (v.kind === 'string' || v.kind === 'bool' || v.kind === 'int32') value = v.value;
    data.set(kv.key, value);
  }
  return data;
}

const UNIT_TYPES: UnitType[] = ['GROSS_VALUE', 'TAX', 'FEE'];

function loadUnits(newTransaction: PTransaction, t: Transaction): void {
  for (const u of newTransaction.units) {
    const type = UNIT_TYPES[u.type];
    if (!type) throw new Error('unsupported unit type ' + u.type);
    const amount = money(u.currencyCode, u.amount);
    if (u.fxAmount !== undefined) {
      const forex = money(u.fxCurrencyCode ?? '', u.fxAmount);
      t.addUnit(new Unit(type, amount, forex, u.fxRateToBase ?? new D(0)));
    } else {
      if (type === 'GROSS_VALUE') throw new Error('Gross value without forex');
      t.addUnit(new Unit(type, amount));
    }
  }
}

function loadCommon(
  p: PTransaction,
  t: Transaction,
  securities: Map<string, Security>,
  requiresSecurity: boolean,
): void {
  t.dateTime = p.date;
  t.currencyCode = p.currencyCode;
  t.amount = p.amount;
  if (p.note !== undefined) t.note = p.note;
  if (p.source !== undefined) t.source = p.source;
  t.shares = p.shares ?? 0;
  if (requiresSecurity && p.security === undefined) throw new Error('transaction requires security');
  if (p.security !== undefined) t.security = securities.get(p.security) ?? null;
  loadUnits(p, t);
  t.updatedAt = p.updatedAt ?? null;
}

const ACCOUNT_SIMPLE_TYPES: Record<number, AccountTransaction['type']> = {
  6: 'DEPOSIT',
  7: 'REMOVAL',
  9: 'INTEREST',
  10: 'INTEREST_CHARGE',
  11: 'TAXES',
  12: 'TAX_REFUND',
  13: 'FEES',
  14: 'FEES_REFUND',
};

const PLAN_TYPES: InvestmentPlanType[] = ['PURCHASE_OR_DELIVERY', 'DEPOSIT', 'REMOVAL', 'INTEREST'];

export interface LoadWarning {
  message: string;
}

export function hasProtobufSignature(data: Uint8Array): boolean {
  if (data.length < PROTOBUF_SIGNATURE.length) return false;
  for (let i = 0; i < PROTOBUF_SIGNATURE.length; i++) if (data[i] !== PROTOBUF_SIGNATURE[i]) return false;
  return true;
}

/** ProtobufWriter#load */
export function loadProtobufClient(data: Uint8Array, warnings: LoadWarning[] = []): Client {
  if (!hasProtobufSignature(data)) throw new Error('Keine Portfolio Performance Datei (Signatur fehlt)');
  const raw = readClient(new ProtoReader(data, PROTOBUF_SIGNATURE.length));

  const client = new Client();
  client.version = raw.version;
  if (raw.baseCurrency) client.baseCurrency = raw.baseCurrency;

  // settings first: needed for attributes
  client.settings.bookmarks = raw.settings.bookmarks;
  client.settings.attributeTypes = raw.settings.attributeTypes;
  for (const c of raw.settings.configurationSets)
    client.settings.getConfigurationSet(c.key).push({ uuid: c.uuid, name: c.name, data: c.data });

  const securities = new Map<string, Security>();
  const accounts = new Map<string, Account>();
  const portfolios = new Map<string, Portfolio>();

  for (const ps of raw.securities) {
    const s = new Security(ps.uuid);
    s.onlineId = ps.onlineId ?? null;
    s.name = ps.name;
    s.currencyCode = (ps.currencyCode ?? null) as string;
    s.targetCurrencyCode = ps.targetCurrencyCode ?? null;
    s.note = ps.note ?? null;
    s.isin = ps.isin ?? null;
    s.tickerSymbol = ps.tickerSymbol ?? null;
    s.wkn = ps.wkn ?? null;
    s.calendar = ps.calendar ?? null;
    s.feed = ps.feed ?? null;
    s.feedURL = ps.feedURL ?? null;
    s.prices = ps.prices.map((p) => ({ date: p.date, value: p.close }));
    s.latestFeed = ps.latestFeed ?? null;
    s.latestFeedURL = ps.latestFeedURL ?? null;
    if (ps.latest)
      s.latest = {
        date: ps.latest.date,
        value: ps.latest.close,
        high: ps.latest.high,
        low: ps.latest.low,
        volume: ps.latest.volume,
      };
    fromAttributes(ps.attributes, client, s.attributes);
    for (const pe of ps.events) {
      let event: SecurityEvent;
      switch (pe.type) {
        case 0:
          event = { type: 'STOCK_SPLIT', date: null, details: null, source: null };
          break;
        case 1:
          event = { type: 'NOTE', date: null, details: null, source: null };
          break;
        case 2: {
          const d0 = pe.data[0];
          const d1 = pe.data[1];
          const d2 = pe.data[2];
          const d3 = pe.data[3];
          event = {
            type: 'DIVIDEND_PAYMENT',
            date: null,
            details: null,
            source: d3 && d3.kind === 'string' ? d3.value : null,
            paymentDate: d0 && d0.kind === 'int64' ? d0.value : 0,
            amount:
              d1 && d1.kind === 'string' && d1.value
                ? money(d1.value, d2 && d2.kind === 'int64' ? d2.value : 0)
                : null,
          };
          break;
        }
        default:
          throw new Error('unsupported security event type ' + pe.type);
      }
      event.date = pe.date;
      event.details = pe.details;
      if (pe.source) event.source = pe.source;
      s.events.push(event);
    }
    for (const prop of ps.properties) {
      if (prop.value.kind !== 'map') continue;
      for (const entry of prop.value.value)
        s.properties.push({
          type: prop.key,
          name: entry.key,
          value: entry.value.kind === 'string' ? entry.value.value : null,
        });
    }
    s.isRetired = ps.isRetired;
    s.updatedAt = ps.updatedAt ?? null;
    client.securities.push(s);
    securities.set(s.uuid, s);
  }

  for (const pa of raw.accounts) {
    const a = new Account(pa.uuid);
    a.name = pa.name;
    a.currencyCode = pa.currencyCode;
    a.note = pa.note ?? null;
    a.isRetired = pa.isRetired;
    fromAttributes(pa.attributes, client, a.attributes);
    a.updatedAt = pa.updatedAt ?? null;
    client.accounts.push(a);
    accounts.set(a.uuid, a);
  }

  for (const pp of raw.portfolios) {
    const p = new Portfolio(pp.uuid);
    p.name = pp.name;
    p.note = pp.note ?? null;
    p.isRetired = pp.isRetired;
    if (pp.referenceAccount !== undefined) p.referenceAccount = accounts.get(pp.referenceAccount) ?? null;
    fromAttributes(pp.attributes, client, p.attributes);
    p.updatedAt = pp.updatedAt ?? null;
    client.portfolios.push(p);
    portfolios.set(p.uuid, p);
  }

  for (const pt of raw.transactions) {
    switch (pt.type) {
      case 0: // PURCHASE
      case 1: {
        // SALE
        const portfolio = portfolios.get(pt.portfolio ?? '');
        const account = accounts.get(pt.account ?? '');
        if (pt.otherUuid === undefined) throw new Error('buy/sell without otherUuid');
        const portfolioTx = new PortfolioTransaction(pt.uuid);
        const accountTx = new AccountTransaction(pt.otherUuid);
        if (!portfolio || !account) {
          warnings.push({ message: `Buchung ${pt.uuid} verweist auf unbekanntes Konto/Depot` });
          break;
        }
        new BuySellEntry(portfolio, portfolioTx, account, accountTx);
        portfolioTx.type = pt.type === 0 ? 'BUY' : 'SELL';
        accountTx.type = pt.type === 0 ? 'BUY' : 'SELL';
        for (const t of [portfolioTx, accountTx]) {
          t.dateTime = pt.date;
          t.currencyCode = pt.currencyCode;
          t.amount = pt.amount;
          if (pt.note !== undefined) t.note = pt.note;
          if (pt.source !== undefined) t.source = pt.source;
        }
        portfolioTx.shares = pt.shares ?? 0;
        if (pt.security === undefined) throw new Error('buy/sell without security');
        const security = securities.get(pt.security) ?? null;
        portfolioTx.security = security;
        accountTx.security = security;
        loadUnits(pt, portfolioTx);
        portfolioTx.updatedAt = pt.updatedAt ?? null;
        accountTx.updatedAt = pt.otherUpdatedAt ?? null;
        try {
          account.addTransaction(accountTx);
          portfolio.addTransaction(portfolioTx);
        } catch (e) {
          warnings.push({ message: String((e as Error).message) });
        }
        break;
      }
      case 4: {
        // SECURITY_TRANSFER
        const source = portfolios.get(pt.portfolio ?? '');
        const target = portfolios.get(pt.otherPortfolio ?? '');
        if (pt.otherUuid === undefined) throw new Error('transfer without otherUuid');
        if (!source || !target) {
          warnings.push({ message: `Umbuchung ${pt.uuid} verweist auf unbekanntes Depot` });
          break;
        }
        const sourceTx = new PortfolioTransaction(pt.uuid);
        const targetTx = new PortfolioTransaction(pt.otherUuid);
        new PortfolioTransferEntry(source, sourceTx, target, targetTx);
        for (const t of [sourceTx, targetTx]) {
          t.dateTime = pt.date;
          t.currencyCode = pt.currencyCode;
          t.amount = pt.amount;
          if (pt.note !== undefined) t.note = pt.note;
          if (pt.source !== undefined) t.source = pt.source;
          t.shares = pt.shares ?? 0;
        }
        if (pt.security === undefined) throw new Error('transfer without security');
        const security = securities.get(pt.security) ?? null;
        sourceTx.security = security;
        targetTx.security = security;
        loadUnits(pt, sourceTx);
        sourceTx.updatedAt = pt.updatedAt ?? null;
        targetTx.updatedAt = pt.otherUpdatedAt ?? null;
        source.addTransaction(sourceTx);
        target.addTransaction(targetTx);
        break;
      }
      case 2: // INBOUND_DELIVERY
      case 3: {
        // OUTBOUND_DELIVERY
        const t = new PortfolioTransaction(pt.uuid, pt.type === 2 ? 'DELIVERY_INBOUND' : 'DELIVERY_OUTBOUND');
        loadCommon(pt, t, securities, true);
        const p = portfolios.get(pt.portfolio ?? '');
        if (!p) {
          warnings.push({ message: `Einlieferung ${pt.uuid} verweist auf unbekanntes Depot` });
          break;
        }
        p.addTransaction(t);
        break;
      }
      case 5: {
        // CASH_TRANSFER
        const sourceAccount = accounts.get(pt.account ?? '');
        const targetAccount = accounts.get(pt.otherAccount ?? '');
        if (pt.otherUuid === undefined) throw new Error('cash transfer without otherUuid');
        if (!sourceAccount || !targetAccount) {
          warnings.push({ message: `Umbuchung ${pt.uuid} verweist auf unbekanntes Konto` });
          break;
        }
        const sourceTx = new AccountTransaction(pt.uuid);
        const targetTx = new AccountTransaction(pt.otherUuid);
        new AccountTransferEntry(sourceAccount, sourceTx, targetAccount, targetTx);
        for (const t of [sourceTx, targetTx]) {
          t.dateTime = pt.date;
          t.currencyCode = pt.currencyCode;
          t.amount = pt.amount;
          if (pt.note !== undefined) t.note = pt.note;
          if (pt.source !== undefined) t.source = pt.source;
        }
        loadUnits(pt, sourceTx);
        const gross = sourceTx.getUnit('GROSS_VALUE');
        if (gross && gross.forex) {
          targetTx.currencyCode = gross.forex.currencyCode;
          targetTx.amount = gross.forex.amount;
        }
        sourceTx.updatedAt = pt.updatedAt ?? null;
        targetTx.updatedAt = pt.otherUpdatedAt ?? null;
        // insert(): check both currencies first to avoid partially added transfer
        if (sourceAccount.currencyCode !== sourceTx.currencyCode || targetAccount.currencyCode !== targetTx.currencyCode) {
          warnings.push({ message: `Umbuchung ${pt.uuid}: Währung passt nicht zum Konto` });
          break;
        }
        sourceAccount.addTransaction(sourceTx);
        targetAccount.addTransaction(targetTx);
        break;
      }
      case 8: {
        // DIVIDEND
        const t = new AccountTransaction(pt.uuid, 'DIVIDENDS');
        if (pt.exDate !== undefined) t.exDate = pt.exDate;
        loadCommon(pt, t, securities, false);
        if (t.security === null) t.type = 'INTEREST';
        addToAccount(accounts, pt, t, warnings);
        break;
      }
      default: {
        const type = ACCOUNT_SIMPLE_TYPES[pt.type];
        if (!type) throw new Error('unsupported transaction type ' + pt.type);
        const t = new AccountTransaction(pt.uuid, type);
        loadCommon(pt, t, securities, false);
        addToAccount(accounts, pt, t, warnings);
      }
    }
  }

  for (const [k, v] of raw.properties) client.properties.set(k, v);

  // taxonomies
  for (const ptx of raw.taxonomies) {
    const taxonomy = new Taxonomy(ptx.id, ptx.name);
    taxonomy.source = ptx.source ?? null;
    taxonomy.dimensions = ptx.dimensions.slice();
    const byId = new Map<string, Classification>();
    for (const pc of ptx.classifications) {
      const c = new Classification(pc.id, pc.name, pc.color);
      c.note = pc.note ?? null;
      c.weight = pc.weight;
      c.rank = pc.rank;
      c.data = fromKeyValueData(pc.data);
      for (const pa of pc.assignments) {
        const vehicle = securities.get(pa.investmentVehicle) ?? accounts.get(pa.investmentVehicle);
        if (!vehicle) throw new Error('unknown investment vehicle ' + pa.investmentVehicle);
        const a = new Assignment(vehicle, pa.weight);
        a.rank = pa.rank;
        a.data = fromKeyValueData(pa.data);
        c.assignments.push(a);
      }
      if (pc.parentId === undefined) {
        taxonomy.root = c;
      } else {
        const parent = byId.get(pc.parentId);
        if (!parent) throw new Error('unknown parent classification ' + pc.parentId);
        c.parent = parent;
        parent.children.push(c);
      }
      byId.set(c.id, c);
    }
    if (taxonomy.root) client.taxonomies.push(taxonomy);
  }

  client.dashboards = raw.dashboards;

  for (const pw of raw.watchlists) {
    const list: Security[] = [];
    for (const uuid of pw.securities) {
      const s = securities.get(uuid);
      if (!s) throw new Error('unknown security in watchlist ' + uuid);
      list.push(s);
    }
    client.watchlists.push({ name: pw.name, securities: list });
  }

  if (raw.plans.length > 0) {
    const uuid2transaction = new Map<string, Transaction>();
    for (const a of client.accounts) for (const t of a.transactions) uuid2transaction.set(t.uuid, t);
    for (const p of client.portfolios) for (const t of p.transactions) uuid2transaction.set(t.uuid, t);
    for (const pp of raw.plans) {
      const plan: InvestmentPlan = {
        name: pp.name,
        note: pp.note ?? null,
        security: pp.security !== undefined ? (securities.get(pp.security) ?? null) : null,
        portfolio: pp.portfolio !== undefined ? (portfolios.get(pp.portfolio) ?? null) : null,
        account: pp.account !== undefined ? (accounts.get(pp.account) ?? null) : null,
        attributes: new Map(),
        autoGenerate: pp.autoGenerate,
        start: pp.date * SECONDS_PER_DAY,
        interval: pp.interval,
        amount: pp.amount,
        fees: pp.fees,
        taxes: pp.taxes,
        type: PLAN_TYPES[pp.type] ?? 'PURCHASE_OR_DELIVERY',
        transactions: [],
      };
      fromAttributes(pp.attributes, client, plan.attributes);
      for (const uuid of pp.transactions) {
        const t = uuid2transaction.get(uuid);
        if (!t) throw new Error('unknown transaction in plan ' + uuid);
        plan.transactions.push(t);
      }
      client.plans.push(plan);
    }
  }

  client.fileFormat.binary = true;
  upgradeModel(client);
  return client;
}

function addToAccount(
  accounts: Map<string, Account>,
  pt: PTransaction,
  t: AccountTransaction,
  warnings: LoadWarning[],
): void {
  const a = accounts.get(pt.account ?? '');
  if (!a) {
    warnings.push({ message: `Buchung ${pt.uuid} verweist auf unbekanntes Konto` });
    return;
  }
  a.addTransaction(t);
}
