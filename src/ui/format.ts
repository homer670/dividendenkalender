// Number and date formatting in the style of Portfolio Performance (Values.*)

import { Money } from '../core/money/money';
import { formatISODate, LocalDate, toYMD } from '../core/util/dates';

export type NumberLocale = 'de-DE' | 'de-CH';

let locale: NumberLocale = 'de-DE';
let discreet = false;

export function setNumberLocale(l: NumberLocale): void {
  locale = l;
}

export function getNumberLocale(): NumberLocale {
  return locale;
}

/** Diskreter Modus: Beträge werden ausgeblendet (DiscreetMode) */
export function setDiscreetMode(d: boolean): void {
  discreet = d;
}

export function isDiscreetMode(): boolean {
  return discreet;
}

const HIDDEN = '***';

function separators(): { group: string; decimal: string } {
  return locale === 'de-CH' ? { group: '’', decimal: '.' } : { group: '.', decimal: ',' };
}

/** formats a number with the given number of fraction digits (HALF_EVEN like java.util.Formatter) */
export function formatNumber(value: number, minFraction: number, maxFraction = minFraction, grouping = true): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '-' : value > 0 ? '∞' : '-∞';
  const negative = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  // toFixed uses round-half-away-from-zero on the decimal representation which matches
  // String.format for all practical purposes
  let fixed = abs.toFixed(maxFraction);
  if (maxFraction > minFraction) {
    // strip optional zeros
    let [intPart, frac = ''] = fixed.split('.');
    while (frac.length > minFraction && frac.endsWith('0')) frac = frac.slice(0, -1);
    fixed = frac.length > 0 ? `${intPart}.${frac}` : intPart;
  }
  const [intPart, frac] = fixed.split('.');
  const { group, decimal } = separators();
  let grouped = intPart;
  if (grouping && intPart.length > 3) {
    grouped = '';
    for (let i = 0; i < intPart.length; i++) {
      if (i > 0 && (intPart.length - i) % 3 === 0) grouped += group;
      grouped += intPart[i];
    }
  }
  const isZero = /^[0.]*$/.test(fixed);
  return `${negative && !isZero ? '-' : ''}${grouped}${frac !== undefined ? decimal + frac : ''}`;
}

/** Values.Amount: amount in cents */
export function formatAmount(amount: number): string {
  if (discreet) return HIDDEN;
  return formatNumber(amount / 100, 2);
}

/** Values.Money: "EUR 1.234,56" - currency is omitted if it equals skipCurrency */
export function formatMoney(m: Money | null | undefined, skipCurrency?: string): string {
  if (!m) return '';
  if (skipCurrency !== undefined && skipCurrency === m.currencyCode) {
    return discreet ? HIDDEN : formatNumber(m.amount / 100, 2);
  }
  return discreet ? `${m.currencyCode} ${HIDDEN}` : `${m.currencyCode} ${formatNumber(m.amount / 100, 2)}`;
}

/** Values.MoneyShort */
export function formatMoneyShort(m: Money, skipCurrency?: string): string {
  const n = discreet ? HIDDEN : formatNumber(m.amount / 100, 0);
  return skipCurrency === m.currencyCode ? n : `${m.currencyCode} ${n}`;
}

/** Values.Quote: "#,##0.00######" */
export function formatQuote(value: number, currencyCode?: string | null, skipCurrency?: string): string {
  const n = formatNumber(value / 1e8, 2, 8);
  if (!currencyCode || currencyCode === skipCurrency) return n;
  return `${currencyCode} ${n}`;
}

/** Values.Share: "#,##0.########" */
export function formatShares(shares: number): string {
  if (discreet) return HIDDEN;
  return formatNumber(shares / 1e8, 0, 8);
}

/** Values.Percent2: "12,34%" */
export function formatPercent(value: number, digits = 2): string {
  if (Number.isNaN(value)) return '-';
  return `${formatNumber(value * 100, digits)}%`;
}

/** Values.PercentWithSign */
export function formatPercentWithSign(value: number): string {
  if (Number.isNaN(value)) return '-';
  const s = formatNumber(value * 100, 2);
  return `${value > 0 ? '+' : ''}${s}%`;
}

/** Values.AnnualizedPercent2 */
export function formatPercentAnnualized(value: number): string {
  return `${formatPercent(value)} p.a.`;
}

/** Values.PercentPlain */
export function formatPercentPlain(value: number): string {
  if (Number.isNaN(value)) return '-';
  return formatNumber(value, 2);
}

/** Values.Thousands: 1,2k / 3,4m */
export function formatThousands(value: number): string {
  if (value > -1000 && value < 1000) return formatNumber(value, 0, 3);
  if (value > -1000000 && value < 1000000) return formatNumber(value / 1000, 0, 3) + 'k';
  return formatNumber(value / 1000000, 0, 3) + 'm';
}

/** Kompakte Darstellung für Achsenbeschriftungen */
export function formatAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return formatNumber(value / 1e6, 0, 1) + ' Mio.';
  if (abs >= 1e4) return formatNumber(value / 1e3, 0, 1) + 'k';
  return formatNumber(value, 0, 2);
}

const MONTHS_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function monthName(month: number, short = false): string {
  return (short ? MONTHS_SHORT : MONTHS)[month - 1];
}

/** Values.Date (FormatStyle.MEDIUM, German): 27.10.2026 */
export function formatDate(d: LocalDate | null | undefined): string {
  if (d === null || d === undefined) return '';
  const iso = formatISODate(d);
  return `${iso.substring(8, 10)}.${iso.substring(5, 7)}.${iso.substring(0, 4)}`;
}

/** FormatStyle.LONG: 27. Oktober 2026 */
export function formatDateLong(d: LocalDate | null | undefined): string {
  if (d === null || d === undefined) return '';
  const { year, month, day } = toYMD(d);
  return `${day}. ${MONTHS[month - 1]} ${year}`;
}

export function formatDateTime(dt: number): string {
  const d = Math.floor(dt / 86400);
  const sod = dt - d * 86400;
  if (sod === 0) return formatDate(d);
  const hh = Math.floor(sod / 3600);
  const mm = Math.floor((sod % 3600) / 60);
  return `${formatDate(d)}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatMonthYear(d: LocalDate): string {
  const { year, month } = toYMD(d);
  return `${MONTHS_SHORT[month - 1]} ${year}`;
}

export function formatDays(days: number): string {
  return `${formatNumber(days, 0)} ${days === 1 ? 'Tag' : 'Tage'}`;
}

export function detectNumberLocale(): NumberLocale {
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    if (/-(CH|LI)\b/i.test(l)) return 'de-CH';
  } catch {
    // ignore
  }
  return 'de-DE';
}
