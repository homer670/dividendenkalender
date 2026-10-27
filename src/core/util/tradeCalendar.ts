// name.abuchen.portfolio.util.TradeCalendar - the "default" calendar used for
// trading day calculations (volatility, reporting periods)

import { dayOfWeek, LocalDate, ofYMD, year as yearOf } from './dates';

function easterSunday(y: number): LocalDate {
  // anonymous Gregorian algorithm
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ofYMD(y, month, day);
}

type HolidayRule = (year: number) => LocalDate;

export class TradeCalendar {
  private readonly cache = new Map<number, Set<LocalDate>>();

  constructor(
    readonly code: string,
    private readonly rules: HolidayRule[],
  ) {}

  isWeekend(d: LocalDate): boolean {
    const dow = dayOfWeek(d);
    return dow === 6 || dow === 7;
  }

  isHoliday(d: LocalDate): boolean {
    if (this.isWeekend(d)) return true;
    const y = yearOf(d);
    let set = this.cache.get(y);
    if (!set) {
      set = new Set(this.rules.map((r) => r(y)));
      this.cache.set(y, set);
    }
    return set.has(d);
  }

  getNextNonHoliday(d: LocalDate): LocalDate {
    while (this.isHoliday(d)) d++;
    return d;
  }
}

const fixed =
  (month: number, day: number): HolidayRule =>
  (y) =>
    ofYMD(y, month, day);
const easter =
  (days: number): HolidayRule =>
  (y) =>
    easterSunday(y) + days;

export const DEFAULT_CALENDAR = new TradeCalendar('default', [
  fixed(1, 1),
  easter(-2),
  easter(1),
  fixed(5, 1),
  fixed(12, 24),
  fixed(12, 25),
  fixed(12, 26),
]);

export const MINIMAL_CALENDAR = new TradeCalendar('minimum', [fixed(1, 1), easter(-2), fixed(5, 1), fixed(12, 25)]);

export function getDefaultCalendar(): TradeCalendar {
  return DEFAULT_CALENDAR;
}

/** Dates#tradingDaysBetween */
export function tradingDaysBetween(start: LocalDate, end: LocalDate): number {
  if (start > end) [start, end] = [end, start];
  const calendar = getDefaultCalendar();
  let days = 0;
  while (start < end) {
    if (!calendar.isHoliday(end)) days++;
    end--;
  }
  return days;
}
