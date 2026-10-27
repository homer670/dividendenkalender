// Widget configuration helpers (ReportingPeriodConfig, DataSeriesConfig, ClientFilterConfig, EnumBasedConfig, ...)

import { Dashboard, DashboardWidget, Taxonomy } from '../../core/model';
import { ReportingPeriod } from '../../core/snapshot/reportingPeriod';
import { today, year } from '../../core/util/dates';
import { Interval } from '../../core/util/interval';
import { CalcContext } from '../../state/calc';
import { ClientFilterItem } from '../../state/clientFilters';
import { DataSeries, DataSeriesSet } from '../../state/dataSeries';

export interface DashboardEnv {
  ctx: CalcContext;
  dashboard: Dashboard;
  /** default reporting period of the dashboard */
  defaultPeriod: ReportingPeriod;
  /** number of dashboard columns (used by PP to choose formats) */
  columns: number;
}

export type Config = Record<string, string>;

export function cfg(widget: DashboardWidget, key: string): string | undefined {
  const v = widget.configuration[key];
  return v === undefined || v === null ? undefined : String(v);
}

/** ReportingPeriodConfig#getReportingPeriod */
export function widgetPeriod(widget: DashboardWidget, env: DashboardEnv): ReportingPeriod {
  const code = cfg(widget, 'REPORTING_PERIOD');
  const p = code ? ReportingPeriod.tryFrom(code) : null;
  return p ?? env.defaultPeriod;
}

export function widgetInterval(widget: DashboardWidget, env: DashboardEnv): Interval {
  return widgetPeriod(widget, env).toInterval(today());
}

/** the data series set used by DashboardData (use case RETURN_VOLATILITY) */
export function dashboardSeriesSet(env: DashboardEnv): DataSeriesSet {
  return env.ctx.dataSeriesSet('RETURN_VOLATILITY');
}

/** DataSeriesConfig: configured data series or the entire portfolio */
export function widgetDataSeries(widget: DashboardWidget, env: DashboardEnv, key = 'DATA_SERIES'): DataSeries {
  const set = dashboardSeriesSet(env);
  return set.lookup(cfg(widget, key)) ?? set.defaultSeries();
}

/** DataSeriesConfig with supportsEmptyDataSeries */
export function widgetOptionalDataSeries(widget: DashboardWidget, env: DashboardEnv, key: string): DataSeries | null {
  return dashboardSeriesSet(env).lookup(cfg(widget, key));
}

/** ClientFilterConfig */
export function widgetFilter(widget: DashboardWidget, env: DashboardEnv): ClientFilterItem {
  const id = cfg(widget, 'CLIENT_FILTER');
  return env.ctx.filterItems.find((i) => i.id === id) ?? env.ctx.filterItems[0];
}

/** EnumBasedConfig with Policy.EXACTLY_ONE */
export function widgetEnum<E extends string>(widget: DashboardWidget, key: string, values: readonly E[]): E {
  const set = widgetEnumSet(widget, key, values);
  return set.length > 0 ? set[0] : values[0];
}

/** EnumBasedConfig with Policy.MULTIPLE (stored as comma separated list) */
export function widgetEnumSet<E extends string>(widget: DashboardWidget, key: string, values: readonly E[]): E[] {
  const code = cfg(widget, key);
  if (!code) return [];
  const codes = code.split(',');
  // invalid values abort the parsing as in PP (IllegalArgumentException)
  const out: E[] = [];
  for (const c of codes) {
    if (!(values as readonly string[]).includes(c)) break;
    if (!out.includes(c as E)) out.push(c as E);
  }
  // EnumSet iterates in declaration order
  return values.filter((v) => out.includes(v));
}

export function widgetBool(widget: DashboardWidget, key: string, defaultValue: boolean): boolean {
  const code = cfg(widget, key);
  return code !== undefined ? code.toLowerCase() === 'true' : defaultValue;
}

/** CountConfig */
export function widgetCount(widget: DashboardWidget): number {
  const code = cfg(widget, 'COUNT');
  if (!code) return 3;
  const n = Number.parseInt(code, 10);
  return Number.isFinite(n) ? n : 3;
}

export const HEIGHTS = { SMALLER: 70, NORMAL: 140, BIGGER: 210, TWOX: 280, THREEX: 420, FOURX: 560, FIVEX: 700 } as const;
export type HeightKey = keyof typeof HEIGHTS;
export const HEIGHT_LABELS: Record<HeightKey, string> = {
  SMALLER: 'Klein',
  NORMAL: 'Normal',
  BIGGER: 'Groß',
  TWOX: '2X',
  THREEX: '3X',
  FOURX: '4X',
  FIVEX: '5X',
};

/** ChartHeightConfig (pixel height on the desktop; on mobile at least 160) */
export function widgetChartHeight(widget: DashboardWidget): number {
  const code = cfg(widget, 'HEIGHT') as HeightKey | undefined;
  const px = code && code in HEIGHTS ? HEIGHTS[code] : HEIGHTS.NORMAL;
  return Math.max(160, Math.round(px * 1.25));
}

/** TaxonomyConfig: configured taxonomy or the first one */
export function widgetTaxonomy(widget: DashboardWidget, env: DashboardEnv): Taxonomy | null {
  const id = cfg(widget, 'TAXONOMY');
  const taxonomies = env.ctx.client.taxonomies;
  return (id ? taxonomies.find((t) => t.id === id) : undefined) ?? taxonomies[0] ?? null;
}

/** StartYearConfig */
export function widgetStartYear(widget: DashboardWidget, defaultYearOffset: number): number {
  const now = year(today());
  const code = cfg(widget, 'START_YEAR');
  let y = code !== undefined ? Number.parseInt(code, 10) : NaN;
  if (!Number.isFinite(y) || y < 1900 || y > now) y = now - defaultYearOffset;
  return y;
}

/** stable key for memoization of widget calculations */
export function widgetKey(widget: DashboardWidget, env: DashboardEnv): string {
  return `${widget.type}|${JSON.stringify(widget.configuration)}|${env.defaultPeriod.getCode()}|${env.columns}`;
}
