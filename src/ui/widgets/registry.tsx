// WidgetFactory: all widget types of the Portfolio Performance dashboard

import React from 'react';

import { DataSeries } from '../../state/dataSeries';
import { COLOR_SCHEMA_LABELS } from '../charts/colorSchema';
import { msg } from '../i18n';
import { ActivityWidget, ACTIVITY_CHART_TYPES, ACTIVITY_FILTERS, ChartWidget, ClientDataSeriesChartWidget, CLIENT_DATA_SERIES_ASPECTS, DrawdownChartWidget, HoldingsChartWidget, RebalancingChartWidget, TaxonomyChartWidget } from './charts';
import { CollapsibleSectionWidget, DescriptionWidget, HeadingWidget, VerticalSpacerWidget, WebsiteWidget } from './common';
import { DATE_TYPES, DividendListWidget, EarningsByTaxonomyChartWidget, EarningsChartWidget, EarningsListWidget, EXPANSION_SETTINGS, SECURITY_FILTERS, SHOW_EVENTS_STARTING } from './earnings';
import { Config } from './env';
import {
  COLOR_SCHEMAS,
  CostHeatmapWidget,
  EARNING_TYPES,
  EarningsHeatmapWidget,
  EXCESS_RETURN_OPERATORS,
  GROSS_NET,
  HEATMAP_ORNAMENTS,
  InvestmentHeatmapWidget,
  INVESTMENT_TYPES,
  MonthlyPNTransfersWidget,
  PerformanceHeatmapWidget,
  YearlyPerformanceHeatmapWidget,
} from './heatmaps';
import { IndicatorWidget, INDICATORS } from './indicators';
import { CALCULATION_LAYOUTS, CalculationWidget, DATE_CHECKS, EVENT_TYPES, EVENT_TYPE_LABELS, EventListWidget, FollowUpWidget, LimitExceededWidget, SORT_DIRECTIONS, TopContributorsReturnWidget, TopContributorsWidget } from './lists';
import {
  CurrentDateWidget,
  ExchangeRateWidget,
  FIREWidget,
  MaxDrawdownDurationWidget,
  RatioWidget,
  TaxOrFeeRateWidget,
  TradesWidget,
  WidgetProps,
} from './special';

export type ConfigSpec =
  | { kind: 'period'; pastAndFuture?: boolean }
  | { kind: 'dataSeries'; key: 'DATA_SERIES' | 'SECONDARY_DATA_SERIES'; label: string; benchmarks: boolean; allowEmpty?: boolean; predicate?: (ds: DataSeries) => boolean }
  | { kind: 'multiDataSeries' }
  | { kind: 'clientFilter' }
  | { kind: 'enum'; key: string; label: string; options: { value: string; label: string }[]; multiple?: boolean }
  | { kind: 'bool'; key: string; label: string; defaultValue: boolean }
  | { kind: 'count' }
  | { kind: 'height' }
  | { kind: 'taxonomy' }
  | { kind: 'startYear'; offset: number }
  | { kind: 'attribute'; valueType: string }
  | { kind: 'exchangeRate' }
  | { kind: 'chartConfig'; useCase: 'PERFORMANCE' | 'STATEMENT_OF_ASSETS' }
  | { kind: 'url' }
  | { kind: 'spacerHeight' }
  | { kind: 'fire' };

export interface WidgetSpec {
  type: string;
  label: string;
  group: string;
  /** indicator widgets are shown two per row */
  compact?: boolean;
  /** widgets that span the full width without a card frame */
  bare?: boolean;
  defaultConfig?: Config;
  configs: ConfigSpec[];
  render: (props: WidgetProps) => React.ReactElement;
}

const G = {
  common: 'Allgemein',
  assets: 'Vermögensaufstellung',
  performance: 'Performance',
  risk: 'Risikokennzahlen',
  earnings: 'Erträge',
  trades: 'Trades',
};

const opt = (values: readonly string[], labels: Record<string, string>) => values.map((v) => ({ value: v, label: labels[v] ?? v }));

const periodC: ConfigSpec = { kind: 'period' };
const dsC = (benchmarks: boolean, predicate?: (ds: DataSeries) => boolean): ConfigSpec => ({ kind: 'dataSeries', key: 'DATA_SERIES', label: 'Datenreihe', benchmarks, predicate });
const filterC: ConfigSpec = { kind: 'clientFilter' };
const heightC: ConfigSpec = { kind: 'height' };
const coloredC = (defaultValue: boolean): ConfigSpec => ({ kind: 'bool', key: 'FLAG_COLORED_VALUE', label: 'Wert einfärben', defaultValue });
const costMethodC: ConfigSpec = {
  kind: 'enum',
  key: 'COST_METHOD',
  label: 'Berechnung der Kurserfolge',
  options: [
    { value: 'FIFO', label: 'FIFO' },
    { value: 'MOVING_AVERAGE', label: 'Gleitender Durchschnitt' },
  ],
};
const earningTypeC: ConfigSpec = {
  kind: 'enum',
  key: 'EARNING_TYPE',
  label: 'Erträge',
  options: opt(EARNING_TYPES, { EARNINGS: 'Dividenden + Zinsen', DIVIDENDS: 'Dividenden', INTEREST: 'Zinsen' }),
};
const grossNetC: ConfigSpec = { kind: 'enum', key: 'NET_GROSS', label: 'Brutto/Netto', options: opt(GROSS_NET, { NET: 'Netto', GROSS: 'Brutto' }) };
const averageC: ConfigSpec = { kind: 'enum', key: 'LAYOUT', label: 'Durchschnitt', options: [{ value: 'AVERAGE', label: msg('HeatmapOrnamentAverage') }], multiple: true };
const colorSchemaC: ConfigSpec = { kind: 'enum', key: 'COLOR_SCHEMA', label: 'Farbschema', options: opt(COLOR_SCHEMAS, COLOR_SCHEMA_LABELS) };
const ornamentC: ConfigSpec = {
  kind: 'enum',
  key: 'LAYOUT',
  label: msg('LabelHeatmapOrnament'),
  options: opt(HEATMAP_ORNAMENTS, { SUM: msg('HeatmapOrnamentSum'), GEOMETRIC_MEAN: msg('HeatmapOrnamentGeometricMean'), STANDARD_DEVIATION: msg('HeatmapOrnamentStandardDeviation') }),
  multiple: true,
};

function indicator(type: string, label: string, group: string): WidgetSpec {
  const def = INDICATORS[type];
  const configs: ConfigSpec[] = [dsC(def.supportsBenchmarks !== false, def.predicate), periodC];
  if (def.colored !== false) configs.push(coloredC(true));
  return { type, label, group, compact: true, configs, render: (p) => <IndicatorWidget {...p} def={def} /> };
}

const SPECS: WidgetSpec[] = [
  { type: 'HEADING', label: 'Überschrift', group: G.common, bare: true, configs: [], render: (p) => <HeadingWidget {...p} /> },
  { type: 'DESCRIPTION', label: 'Beschreibung', group: G.common, configs: [], render: (p) => <DescriptionWidget {...p} /> },
  indicator('TOTAL_SUM', 'Gesamtsumme', G.assets),
  indicator('TTWROR', 'True Time-Weighted Rate of Return (kumulativ)', G.performance),
  indicator('TTWROR_ANNUALIZED', 'True Time-Weighted Rate of Return (annualisiert)', G.performance),
  indicator('IRR', 'Interner Zinsfuß (IZF)', G.performance),
  indicator('ABSOLUTE_CHANGE', 'Absolute Veränderung', G.assets),
  indicator('DELTA', 'Delta (im Berichtszeitraum)', G.assets),
  indicator('ABSOLUTE_DELTA', 'Delta (seit der ersten Buchung)', G.assets),
  indicator('SAVINGS', 'Performanceneutrale Bewegungen', G.assets),
  {
    type: 'MONTHLY_PN_TRANSFERS',
    label: 'Monatliche performanceneutrale Bewegungen',
    group: G.assets,
    configs: [periodC, filterC, averageC],
    render: (p) => <MonthlyPNTransfersWidget {...p} />,
  },
  indicator('INVESTED_CAPITAL', 'Investiertes Kapital (im Berichtszeitraum)', G.assets),
  { type: 'FIRE', label: 'FIRE-Berechnung', group: G.assets, configs: [{ kind: 'fire' }, dsC(false)], render: (p) => <FIREWidget {...p} /> },
  indicator('ABSOLUTE_INVESTED_CAPITAL', 'Investiertes Kapital (seit der ersten Buchung)', G.assets),
  {
    type: 'RATIO',
    label: 'Verhältnis',
    group: G.assets,
    compact: true,
    configs: [dsC(false), { kind: 'dataSeries', key: 'SECONDARY_DATA_SERIES', label: 'Basis-Datenreihe', benchmarks: false }, periodC, coloredC(false)],
    render: (p) => <RatioWidget {...p} />,
  },
  indicator('MAXDRAWDOWN', 'Maximaler Drawdown', G.risk),
  indicator('CURRENT_DRAWDOWN', 'Aktueller Drawdown', G.risk),
  { type: 'MAXDRAWDOWNDURATION', label: 'Maximale Drawdown Duration', group: G.risk, compact: true, configs: [dsC(true), periodC], render: (p) => <MaxDrawdownDurationWidget {...p} /> },
  { type: 'DRAWDOWN_CHART', label: 'Drawdown-Diagramm', group: G.risk, configs: [dsC(true), periodC, heightC], render: (p) => <DrawdownChartWidget {...p} /> },
  indicator('VOLATILITY', 'Volatilität', G.risk),
  indicator('SHARPE_RATIO', 'Sharpe ratio', G.risk),
  indicator('SEMIVOLATILITY', 'Semivolatilität', G.risk),
  {
    type: 'CALCULATION',
    label: 'Performance-Berechnung',
    group: G.performance,
    configs: [
      periodC,
      dsC(false),
      { kind: 'enum', key: 'LAYOUT', label: 'Layout', options: opt(CALCULATION_LAYOUTS, { FULL: msg('LabelLayoutFull'), REDUCED: msg('LabelLayoutReduced'), RELEVANT: msg('LabelLayoutRelevant') }) },
      costMethodC,
    ],
    render: (p) => <CalculationWidget {...p} />,
  },
  {
    type: 'PERFORMANCE_TOP_CONTRIBUTORS',
    label: 'Top Contributors (Wert)',
    group: G.performance,
    defaultConfig: { LAYOUT: 'ONLY_SECURITIES' },
    configs: [periodC, dsC(false), { kind: 'enum', key: 'LAYOUT', label: 'Layout', options: [{ value: 'ONLY_SECURITIES', label: 'Nur Wertpapiere' }], multiple: true }, { kind: 'count' }],
    render: (p) => <TopContributorsWidget {...p} />,
  },
  {
    type: 'PERFORMANCE_TOP_CONTRIBUTORS_RETURN',
    label: 'Top Performer (TTWROR)',
    group: G.performance,
    configs: [periodC, dsC(false), { kind: 'count' }],
    render: (p) => <TopContributorsReturnWidget {...p} />,
  },
  {
    type: 'CHART',
    label: 'Performance-Diagramm',
    group: G.performance,
    configs: [
      { kind: 'chartConfig', useCase: 'PERFORMANCE' },
      { kind: 'enum', key: 'AGGREGATION', label: 'Aggregation', options: [{ value: '', label: 'täglich' }, ...opt(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'], { WEEKLY: 'wöchentlich', MONTHLY: 'monatlich', QUARTERLY: 'quartalsweise', YEARLY: 'jährlich' })] },
      periodC,
      heightC,
    ],
    render: (p) => <ChartWidget {...p} useCase="PERFORMANCE" />,
  },
  {
    type: 'ASSET_CHART',
    label: 'Vermögensaufstellung - Diagramm',
    group: G.assets,
    configs: [{ kind: 'chartConfig', useCase: 'STATEMENT_OF_ASSETS' }, periodC, heightC],
    render: (p) => <ChartWidget {...p} useCase="STATEMENT_OF_ASSETS" />,
  },
  { type: 'HOLDINGS_CHART', label: 'Vermögensaufstellung - Bestand', group: G.assets, configs: [filterC, heightC], render: (p) => <HoldingsChartWidget {...p} /> },
  {
    type: 'CLIENT_DATA_SERIES_CHART',
    label: 'Vermögensaufstellung - Abgeleitete Datenreihen',
    group: G.assets,
    configs: [
      dsC(false),
      { kind: 'enum', key: 'CLIENT_DATA_SERIES', label: 'Aspekt', options: CLIENT_DATA_SERIES_ASPECTS.map((a) => ({ value: a, label: aspectLabel(a) })), multiple: true },
      periodC,
      heightC,
    ],
    render: (p) => <ClientDataSeriesChartWidget {...p} />,
  },
  {
    type: 'TAXONOMY_CHART',
    label: 'Klassifizierungen',
    group: G.assets,
    configs: [
      filterC,
      { kind: 'taxonomy' },
      { kind: 'bool', key: 'FLAG_INCLUDE_UNASSIGNED', label: 'Ohne Klassifizierung einbeziehen', defaultValue: true },
      { kind: 'bool', key: 'FLAG_INCLUDE_SECURITIES', label: 'Wertpapiere anzeigen', defaultValue: true },
      heightC,
    ],
    render: (p) => <TaxonomyChartWidget {...p} />,
  },
  {
    type: 'HEATMAP',
    label: 'Monatsrenditen in einer Heatmap',
    group: G.performance,
    configs: [
      periodC,
      colorSchemaC,
      ornamentC,
      dsC(true),
      { kind: 'dataSeries', key: 'SECONDARY_DATA_SERIES', label: 'Vergleichsdatenreihe (Überrendite)', benchmarks: true, allowEmpty: true },
      { kind: 'enum', key: 'CALCULATION_METHOD', label: msg('LabelExcessReturnOperator'), options: opt(EXCESS_RETURN_OPERATORS, { ALPHA: msg('LabelExcessReturnOperatorAlpha'), RELATIVE: msg('LabelExcessReturnOperatorRelative') }) },
    ],
    render: (p) => <PerformanceHeatmapWidget {...p} />,
  },
  {
    type: 'HEATMAP_YEARLY',
    label: 'Jahresrenditen in einer Heatmap',
    group: G.performance,
    configs: [periodC, colorSchemaC, ornamentC, { kind: 'multiDataSeries' }],
    render: (p) => <YearlyPerformanceHeatmapWidget {...p} />,
  },
  {
    type: 'EARNINGS',
    label: 'Übersicht der Transaktionen',
    group: G.earnings,
    defaultConfig: { LAYOUT: 'EXPAND_CURRENT_MONTH' },
    configs: [
      filterC,
      earningTypeC,
      grossNetC,
      { kind: 'enum', key: 'LAYOUT', label: 'Aufklappen', options: opt(EXPANSION_SETTINGS, { EXPAND_ALL: 'Alle aufklappen', EXPAND_CURRENT_MONTH: 'Aktuellen Monat aufklappen', COLLAPSE_ALL: 'Alle zuklappen' }) },
    ],
    render: (p) => <EarningsListWidget {...p} />,
  },
  { type: 'HEATMAP_EARNINGS', label: 'Monatliche Erträge', group: G.earnings, configs: [periodC, filterC, earningTypeC, grossNetC, averageC], render: (p) => <EarningsHeatmapWidget {...p} /> },
  {
    type: 'DIVIDEND_EVENT_LIST',
    label: 'Anstehende Dividenden',
    group: G.earnings,
    configs: [
      { kind: 'enum', key: 'DATE_TYPE_FILTER', label: 'Datum', options: opt(DATE_TYPES, { ALL_DATES: '◇◆ Alle', EX_DIVIDEND_DATE: '◇ Ex-Tag', PAYMENT_DATE: '◆ Zahltag' }) },
      { kind: 'enum', key: 'SECURITY_FILTER', label: 'Wertpapiere', options: opt(SECURITY_FILTERS, { ALL: 'Alle Wertpapiere', ACTIVE: 'Aktive Wertpapiere', OWNED: 'Wertpapiere im Bestand' }) },
      filterC,
      { kind: 'enum', key: 'START_YEAR', label: 'Ereignisse anzeigen ab', options: opt(SHOW_EVENTS_STARTING, { TODAY: 'Heute', ONE_WEEK_AGO: 'vor 1 Woche', ONE_MONTH_AGO: 'vor 1 Monat', THREE_MONTHS_AGO: 'vor 3 Monaten' }) },
    ],
    render: (p) => <DividendListWidget {...p} />,
  },
  { type: 'EARNINGS_PER_YEAR_CHART', label: 'Erträge pro Jahr', group: G.earnings, configs: [{ kind: 'startYear', offset: 10 }, filterC, earningTypeC, grossNetC, heightC], render: (p) => <EarningsChartWidget {...p} kind="YEAR" /> },
  { type: 'EARNINGS_PER_QUARTER_CHART', label: 'Erträge pro Quartal', group: G.earnings, configs: [{ kind: 'startYear', offset: 4 }, filterC, earningTypeC, grossNetC, heightC], render: (p) => <EarningsChartWidget {...p} kind="QUARTER" /> },
  { type: 'EARNINGS_PER_MONTH_CHART', label: 'Erträge pro Monat', group: G.earnings, configs: [{ kind: 'startYear', offset: 4 }, filterC, earningTypeC, grossNetC, heightC], render: (p) => <EarningsChartWidget {...p} kind="MONTH" /> },
  {
    type: 'EARNINGS_BY_TAXONOMY',
    label: 'Erträge nach Klassifikation',
    group: G.earnings,
    configs: [{ kind: 'taxonomy' }, periodC, filterC, earningTypeC, grossNetC, heightC],
    render: (p) => <EarningsByTaxonomyChartWidget {...p} />,
  },
  { type: 'TRADES_BASIC_STATISTICS', label: 'Anzahl Trades (mit Gewinn/mit Verlust)', group: G.trades, compact: true, configs: [filterC, periodC, { kind: 'bool', key: 'FLAG_USE_SECURITY_CURRENCY', label: 'Wertpapierwährung verwenden', defaultValue: false }], render: (p) => <TradesWidget {...p} variant="BASIC" /> },
  { type: 'TRADES_PROFIT_LOSS', label: 'Trades Gewinn/Verlust', group: G.trades, compact: true, configs: [filterC, periodC, costMethodC], render: (p) => <TradesWidget {...p} variant="PROFIT_LOSS" /> },
  {
    type: 'TRADES_AVERAGE_HOLDING_PERIOD',
    label: 'Mittlere Haltedauer',
    group: G.trades,
    compact: true,
    configs: [filterC, periodC, { kind: 'enum', key: 'METRIC', label: 'Einheit', options: [{ value: 'DAY', label: 'Tage' }, { value: 'YEAR', label: 'Jahre' }] }],
    render: (p) => <TradesWidget {...p} variant="HOLDING" />,
  },
  indicator('TRADES_TURNOVER_RATIO', 'Portfolio Turnover Rate', G.trades),
  {
    type: 'HEATMAP_INVESTMENTS',
    label: 'Monatliche Investitionen',
    group: G.trades,
    configs: [
      periodC,
      filterC,
      { kind: 'enum', key: 'EARNING_TYPE', label: 'Investitionen', options: opt(INVESTMENT_TYPES, { INVESTMENTS_MINUS_REVENUE: 'Investitionen abzüglich Verkäufe', INVESTMENTS: 'Investitionen (ohne Verkäufe)' }) },
      { kind: 'enum', key: 'NET_GROSS', label: 'Brutto/Netto', options: opt(GROSS_NET, { NET: 'Nach Steuern und Gebühren', GROSS: 'Vor Steuern und Gebühren' }) },
      averageC,
    ],
    render: (p) => <InvestmentHeatmapWidget {...p} />,
  },
  { type: 'HEATMAP_TAXES', label: 'Monatliche Steuern', group: G.trades, configs: [periodC, filterC, averageC], render: (p) => <CostHeatmapWidget {...p} mode="TAXES" /> },
  { type: 'HEATMAP_FEES', label: 'Monatliche Gebühren', group: G.trades, configs: [periodC, filterC, averageC], render: (p) => <CostHeatmapWidget {...p} mode="FEES" /> },
  { type: 'PORTFOLIO_TAX_RATE', label: 'Portfolio-Steuerquote', group: G.performance, compact: true, configs: [dsC(false), periodC], render: (p) => <TaxOrFeeRateWidget {...p} kind="TAXES" /> },
  { type: 'PORTFOLIO_FEE_RATE', label: 'Portfolio-Gebührenquote', group: G.performance, compact: true, configs: [dsC(false), periodC], render: (p) => <TaxOrFeeRateWidget {...p} kind="FEES" /> },
  { type: 'CURRENT_DATE', label: 'Aktuelles Datum', group: G.common, configs: [], render: (p) => <CurrentDateWidget {...p} /> },
  { type: 'COLLAPSIBLE_SECTION', label: 'Klappbarer Abschnitt', group: G.common, bare: true, configs: [], render: (p) => <CollapsibleSectionWidget {...p} collapsed={false} onToggle={() => undefined} /> },
  { type: 'EXCHANGE_RATE', label: 'Wechselkurs', group: G.common, compact: true, configs: [{ kind: 'exchangeRate' }, periodC], render: (p) => <ExchangeRateWidget {...p} /> },
  {
    type: 'ACTIVITY_CHART',
    label: 'Handelsaktivität',
    group: G.common,
    configs: [
      periodC,
      filterC,
      { kind: 'enum', key: 'AGGREGATION', label: 'Diagrammtyp', options: opt(ACTIVITY_CHART_TYPES, { COUNT: 'Anzahl', SUM: 'Summe', COUNT_BY_YEAR: 'Anzahl pro Jahr', SUM_BY_YEAR: 'Summe pro Jahr' }) },
      {
        kind: 'enum',
        key: 'TRANSACTION_FILTER',
        label: 'Buchungen',
        options: opt(ACTIVITY_FILTERS, {
          ALL_TRANSACTIONS: 'Alle Buchungen',
          BUYS_ONLY: 'Nur Käufe',
          SELLS_ONLY: 'Nur Verkäufe',
          ALL_INBOUND: 'Alle Zugänge',
          ALL_OUTBOUND: 'Alle Abgänge',
        }),
      },
      heightC,
    ],
    render: (p) => <ActivityWidget {...p} />,
  },
  { type: 'LIMIT_EXCEEDED', label: 'Wertpapiere: Limit überschritten', group: G.common, configs: [{ kind: 'attribute', valueType: 'name.abuchen.portfolio.model.LimitPrice' }], render: (p) => <LimitExceededWidget {...p} /> },
  {
    type: 'FOLLOW_UP',
    label: 'Wertpapiere: Termin erreicht',
    group: G.common,
    configs: [
      { kind: 'attribute', valueType: 'java.time.LocalDate' },
      { kind: 'enum', key: 'REPORTING_PERIOD', label: 'Datum', options: opt(DATE_CHECKS, { PAST: 'Datum liegt in der Vergangenheit', FUTURE: 'Datum liegt in der Zukunft' }) },
      { kind: 'enum', key: 'SORT_DIRECTION', label: 'Sortierung', options: opt(SORT_DIRECTIONS, { ASCENDING: 'Aufsteigend nach Datum', DESCENDING: 'Absteigend nach Datum' }) },
    ],
    render: (p) => <FollowUpWidget {...p} />,
  },
  {
    type: 'EVENT_LIST',
    label: 'Wertpapiere: Ereignisse',
    group: G.common,
    configs: [
      { kind: 'period', pastAndFuture: true },
      { kind: 'enum', key: 'EVENT_TYPE', label: 'Ereignistyp', options: opt(EVENT_TYPES, EVENT_TYPE_LABELS), multiple: true },
      { kind: 'enum', key: 'SORT_DIRECTION', label: 'Sortierung', options: opt(SORT_DIRECTIONS, { ASCENDING: 'Aufsteigend nach Datum', DESCENDING: 'Absteigend nach Datum' }) },
    ],
    render: (p) => <EventListWidget {...p} />,
  },
  indicator('LATEST_SECURITY_PRICE', 'Wertpapier: letzter Kurs', G.common),
  indicator('DISTANCE_TO_ATH', 'Wertpapier: Abstand vom ATH', G.common),
  { type: 'WEBSITE', label: 'Website', group: G.common, configs: [{ kind: 'url' }], render: (p) => <WebsiteWidget {...p} /> },
  {
    type: 'REBALANCING_TARGET_CHART',
    label: 'Klassifizierungen: SOLL-Wert',
    group: G.assets,
    configs: [filterC, { kind: 'taxonomy' }, heightC],
    render: (p) => <TaxonomyChartWidget {...p} target />,
  },
  {
    type: 'REBALANCING_CHART',
    label: 'Ist-Zuweisung vs. Soll-Zuweisung',
    group: G.assets,
    configs: [filterC, { kind: 'taxonomy' }, { kind: 'bool', key: 'FLAG_INCLUDE_UNASSIGNED', label: 'Ohne Klassifizierung einbeziehen', defaultValue: true }, heightC],
    render: (p) => <RebalancingChartWidget {...p} />,
  },
  { type: 'VERTICAL_SPACEER', label: 'Vertikaler Abstandshalter', group: G.common, bare: true, configs: [{ kind: 'spacerHeight' }], render: (p) => <VerticalSpacerWidget {...p} /> },
  indicator('ALL_TIME_HIGH', 'Allzeit-Höchststand', G.assets),
];

function aspectLabel(a: string): string {
  const labels: Record<string, string> = {
    TOTALS: 'Gesamtsumme',
    TRANSFERALS: 'Einlagen/Entnahmen',
    TRANSFERALS_ACCUMULATED: 'Kumulierte Einlagen/Entnahmen',
    INVESTED_CAPITAL: 'Investiertes Kapital',
    ABSOLUTE_INVESTED_CAPITAL: 'Absolut investiertes Kapital',
    ABSOLUTE_DELTA: 'Delta',
    ABSOLUTE_DELTA_ALL_RECORDS: 'Absolutes Delta',
    DIVIDENDS: 'Dividenden',
    DIVIDENDS_ACCUMULATED: 'Kumulierte Dividenden',
    INTEREST: 'Zinsen',
    INTEREST_ACCUMULATED: 'Kumulierte Zinsen',
    INTEREST_CHARGE: 'Zinsbelastung',
    INTEREST_CHARGE_ACCUMULATED: 'Kumulierte Zinsbelastung',
    EARNINGS: 'Erträge',
    EARNINGS_ACCUMULATED: 'Kumulierte Erträge',
    FEES: 'Gebühren',
    FEES_ACCUMULATED: 'Kumulierte Gebühren',
    TAXES: 'Steuern',
    TAXES_ACCUMULATED: 'Kumulierte Steuern',
  };
  return labels[a] ?? a;
}

export const WIDGETS: Map<string, WidgetSpec> = new Map(SPECS.map((s) => [s.type, s]));
export const WIDGET_LIST: WidgetSpec[] = SPECS;
export const WIDGET_GROUPS = [G.common, G.assets, G.performance, G.risk, G.earnings, G.trades];

export function widgetSpec(type: string): WidgetSpec | undefined {
  return WIDGETS.get(type);
}

/** WidgetFactory#constructWidget */
export function newWidget(type: string): { type: string; label: string; configuration: Config } {
  const spec = WIDGETS.get(type)!;
  return { type, label: spec.label, configuration: { ...(spec.defaultConfig ?? {}) } };
}
