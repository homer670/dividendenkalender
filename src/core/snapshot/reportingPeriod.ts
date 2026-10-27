// name.abuchen.portfolio.snapshot.ReportingPeriod

import {
  dayOfWeek,
  formatISODate,
  LocalDate,
  month as monthOf,
  ofYMD,
  parseDate,
  plusMonths,
  plusYears,
  lastDayOfMonth,
  firstDayOfMonth,
  today,
  year as yearOf,
} from '../util/dates';
import { Interval } from '../util/interval';
import { getDefaultCalendar } from '../util/tradeCalendar';
import type { Transaction } from '../model';

/** first day of week (ISO): Monday for German/Swiss locales */
let firstDayOfWeek = 1;

export function setFirstDayOfWeek(dow: number): void {
  firstDayOfWeek = dow;
}

function previousOrSame(d: LocalDate, dow: number): LocalDate {
  const diff = (dayOfWeek(d) - dow + 7) % 7;
  return d - diff;
}

function firstDayOfQuarter(d: LocalDate): LocalDate {
  const m = monthOf(d);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return ofYMD(yearOf(d), qm, 1);
}

export abstract class ReportingPeriod {
  abstract readonly code: string;
  abstract toInterval(relativeTo: LocalDate): Interval;
  abstract toString(): string;

  containsTransaction(relativeTo: LocalDate): (t: Transaction) => boolean {
    const interval = this.toInterval(relativeTo);
    return (t) => t.date > interval.start && t.date <= interval.end;
  }

  getCode(): string {
    return this.code;
  }

  equals(other: ReportingPeriod): boolean {
    return this.code === other.code;
  }

  static from(code: string): ReportingPeriod {
    const p = ReportingPeriod.tryFrom(code);
    if (!p) throw new Error('Invalid reporting period: ' + code);
    return p;
  }

  static tryFrom(code: string): ReportingPeriod | null {
    if (!code) return null;
    const type = code.charAt(0);
    const rest = code.substring(1);
    try {
      switch (type) {
        case 'D':
          return new LastXDays(parseInt(rest, 10));
        case 'T':
          return new LastXTradingDays(parseInt(rest, 10));
        case 'L': {
          const y = rest.indexOf('Y');
          return new LastX(parseInt(rest.substring(0, y), 10), parseInt(rest.substring(y + 1), 10));
        }
        case 'P':
          return new PreviousDay();
        case 'E':
          return new PreviousTradingDay();
        case 'A':
          return new PreviousWeek();
        case 'B':
          return new PreviousMonth();
        case 'C':
          return new PreviousQuarter();
        case 'Z':
          return new PreviousYear();
        case 'W':
          return new CurrentWeek();
        case 'M':
          return new CurrentMonth();
        case 'Q':
          return new CurrentQuarter();
        case 'X':
          return new YearToDate();
        case 'S':
          return new SinceX(parseDate(rest));
        case 'F': {
          const i = rest.indexOf('_');
          return new FromXtoY(parseDate(rest.substring(0, i)), parseDate(rest.substring(i + 1)));
        }
        case 'Y':
          return new YearX(parseInt(rest, 10));
        case 'G':
          return new Past();
        case 'H':
          return new Future();
        default:
          break;
      }
    } catch {
      return null;
    }
    // backward compatible: "3Y"
    if (code.charAt(code.length - 1) === 'Y') {
      const years = parseInt(code.substring(0, code.length - 1), 10);
      if (Number.isFinite(years)) return new LastX(years, 0);
    }
    return null;
  }
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export class LastX extends ReportingPeriod {
  constructor(
    readonly years: number,
    readonly months: number,
  ) {
    super();
  }
  get code(): string {
    return `L${this.years}Y${this.months}`;
  }
  toInterval(relativeTo: LocalDate): Interval {
    return Interval.of(plusMonths(plusYears(relativeTo, -this.years), -this.months), relativeTo);
  }
  toString(): string {
    const parts: string[] = [];
    if (this.years !== 0) parts.push(plural(this.years, 'Jahr', 'Jahre'));
    if (this.months !== 0) parts.push(plural(this.months, 'Monat', 'Monate'));
    return parts.join(', ');
  }
}

export class LastXDays extends ReportingPeriod {
  constructor(readonly days: number) {
    super();
  }
  get code(): string {
    return `D${this.days}`;
  }
  toInterval(relativeTo: LocalDate): Interval {
    return Interval.of(relativeTo - this.days, relativeTo);
  }
  toString(): string {
    return `Letzte ${this.days} Tage`;
  }
}

export class LastXTradingDays extends ReportingPeriod {
  constructor(readonly tradingDays: number) {
    super();
  }
  get code(): string {
    return `T${this.tradingDays}`;
  }
  static tradingDaysUntil(referenceDate: LocalDate, tradingDays: number): LocalDate {
    const calendar = getDefaultCalendar();
    let date = referenceDate;
    let daysToGo = tradingDays;
    while (daysToGo > 0) {
      if (!calendar.isHoliday(date)) daysToGo--;
      date--;
    }
    while (calendar.isHoliday(date)) date--;
    return date;
  }
  toInterval(relativeTo: LocalDate): Interval {
    return Interval.of(LastXTradingDays.tradingDaysUntil(relativeTo, this.tradingDays), relativeTo);
  }
  toString(): string {
    return `Letzte ${this.tradingDays} Handelstage`;
  }
}

export class FromXtoY extends ReportingPeriod {
  constructor(
    readonly startDate: LocalDate,
    readonly endDate: LocalDate,
  ) {
    super();
  }
  get code(): string {
    return `F${formatISODate(this.startDate)}_${formatISODate(this.endDate)}`;
  }
  toInterval(): Interval {
    return Interval.of(this.startDate, this.endDate);
  }
  toString(): string {
    return `${formatDateDE(this.startDate)} – ${formatDateDE(this.endDate)}`;
  }
}

export class SinceX extends ReportingPeriod {
  constructor(readonly startDate: LocalDate) {
    super();
  }
  get code(): string {
    return `S${formatISODate(this.startDate)}`;
  }
  toInterval(relativeTo: LocalDate): Interval {
    if (this.startDate < relativeTo) return Interval.of(this.startDate, relativeTo);
    return Interval.of(this.startDate, this.startDate);
  }
  toString(): string {
    return `Seit ${formatDateDE(this.startDate)}`;
  }
}

export class YearX extends ReportingPeriod {
  constructor(readonly year: number) {
    super();
  }
  get code(): string {
    return `Y${this.year}`;
  }
  toInterval(): Interval {
    return Interval.of(ofYMD(this.year - 1, 12, 31), ofYMD(this.year, 12, 31));
  }
  toString(): string {
    return String(this.year);
  }
}

export class CurrentWeek extends ReportingPeriod {
  readonly code = 'W';
  toInterval(relativeTo: LocalDate): Interval {
    const firstDay = previousOrSame(relativeTo, firstDayOfWeek) - 1;
    return Interval.of(firstDay, firstDay + 7);
  }
  toString(): string {
    return 'Aktuelle Woche';
  }
}

export class CurrentMonth extends ReportingPeriod {
  readonly code = 'M';
  toInterval(relativeTo: LocalDate): Interval {
    // note: PP uses LocalDate.now() here, not relativeTo
    const startDate = firstDayOfMonth(today()) - 1;
    if (startDate < relativeTo) return Interval.of(startDate, relativeTo);
    return Interval.of(startDate, startDate);
  }
  toString(): string {
    return 'Aktueller Monat';
  }
}

export class CurrentQuarter extends ReportingPeriod {
  readonly code = 'Q';
  toInterval(relativeTo: LocalDate): Interval {
    const first = firstDayOfQuarter(relativeTo);
    const last = lastDayOfMonth(plusMonths(first, 2));
    return Interval.of(first - 1, last);
  }
  toString(): string {
    return 'Aktuelles Quartal';
  }
}

export class YearToDate extends ReportingPeriod {
  readonly code = 'X';
  toInterval(relativeTo: LocalDate): Interval {
    // note: PP uses LocalDate.now() here, not relativeTo
    const startDate = ofYMD(yearOf(today()), 1, 1) - 1;
    if (startDate < relativeTo) return Interval.of(startDate, relativeTo);
    return Interval.of(startDate, startDate);
  }
  toString(): string {
    return 'Laufendes Jahr';
  }
}

export class PreviousDay extends ReportingPeriod {
  readonly code = 'P';
  toInterval(relativeTo: LocalDate): Interval {
    return Interval.of(relativeTo - 2, relativeTo - 1);
  }
  toString(): string {
    return 'Vortag';
  }
}

export class PreviousTradingDay extends ReportingPeriod {
  readonly code = 'E';
  toInterval(relativeTo: LocalDate): Interval {
    const calendar = getDefaultCalendar();
    let tradingDay = relativeTo - 1;
    while (calendar.isHoliday(tradingDay)) tradingDay--;
    return Interval.of(tradingDay - 1, tradingDay);
  }
  toString(): string {
    return 'Vorheriger Handelstag';
  }
}

export class PreviousWeek extends ReportingPeriod {
  readonly code = 'A';
  toInterval(relativeTo: LocalDate): Interval {
    const firstDay = previousOrSame(relativeTo - 7, firstDayOfWeek) - 1;
    return Interval.of(firstDay, firstDay + 7);
  }
  toString(): string {
    return 'Vorwoche';
  }
}

export class PreviousMonth extends ReportingPeriod {
  readonly code = 'B';
  toInterval(relativeTo: LocalDate): Interval {
    const prev = plusMonths(relativeTo, -1);
    return Interval.of(firstDayOfMonth(prev) - 1, lastDayOfMonth(prev));
  }
  toString(): string {
    return 'Vormonat';
  }
}

export class PreviousQuarter extends ReportingPeriod {
  readonly code = 'C';
  toInterval(relativeTo: LocalDate): Interval {
    const firstOfLast = plusMonths(firstDayOfQuarter(relativeTo), -3);
    const lastOfLast = lastDayOfMonth(plusMonths(firstOfLast, 2));
    return Interval.of(firstOfLast - 1, lastOfLast);
  }
  toString(): string {
    return 'Vorquartal';
  }
}

export class PreviousYear extends ReportingPeriod {
  readonly code = 'Z';
  toInterval(relativeTo: LocalDate): Interval {
    const y = yearOf(relativeTo) - 1;
    return Interval.of(ofYMD(y, 1, 1) - 1, ofYMD(y, 12, 31));
  }
  toString(): string {
    return 'Vorjahr';
  }
}

export class Past extends ReportingPeriod {
  readonly code = 'G';
  toInterval(relativeTo: LocalDate): Interval {
    return Interval.of(plusYears(relativeTo, -100), relativeTo - 1);
  }
  toString(): string {
    return 'Vergangenheit';
  }
}

export class Future extends ReportingPeriod {
  readonly code = 'H';
  toInterval(relativeTo: LocalDate): Interval {
    return Interval.of(relativeTo - 1, plusYears(relativeTo, 100));
  }
  toString(): string {
    return 'Zukunft';
  }
}

export function formatDateDE(d: LocalDate): string {
  const iso = formatISODate(d);
  return `${iso.substring(8, 10)}.${iso.substring(5, 7)}.${iso.substring(0, 4)}`;
}
