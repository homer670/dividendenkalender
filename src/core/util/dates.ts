// LocalDate is represented as epoch day (days since 1970-01-01),
// LocalDateTime as epoch seconds (in "local" time, i.e. without time zone),
// matching java.time.LocalDate#toEpochDay and the UTC based protobuf encoding.

export type LocalDate = number;
export type LocalDateTime = number;

export const SECONDS_PER_DAY = 86400;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function lengthOfMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/** java.time.LocalDate.of(y, m, d).toEpochDay() */
export function ofYMD(year: number, month: number, day: number): LocalDate {
  let total = 0;
  const y = year;
  const m = month;
  total += 365 * y;
  if (y >= 0) {
    total += Math.floor((y + 3) / 4) - Math.floor((y + 99) / 100) + Math.floor((y + 399) / 400);
  } else {
    total -= Math.trunc(y / -4) - Math.trunc(y / -100) + Math.trunc(y / -400);
  }
  total += Math.floor((367 * m - 362) / 12);
  total += day - 1;
  if (m > 2) {
    total--;
    if (!isLeapYear(year)) total--;
  }
  return total - 719528; // DAYS_0000_TO_1970
}

export interface YMD {
  year: number;
  month: number;
  day: number;
}

/** java.time.LocalDate.ofEpochDay */
export function toYMD(epochDay: LocalDate): YMD {
  let zeroDay = epochDay + 719528;
  zeroDay -= 60;
  let adjust = 0;
  if (zeroDay < 0) {
    const adjustCycles = Math.trunc((zeroDay + 1) / 146097) - 1;
    adjust = adjustCycles * 400;
    zeroDay += -adjustCycles * 146097;
  }
  let yearEst = Math.trunc((400 * zeroDay + 591) / 146097);
  let doyEst = zeroDay - (365 * yearEst + Math.trunc(yearEst / 4) - Math.trunc(yearEst / 100) + Math.trunc(yearEst / 400));
  if (doyEst < 0) {
    yearEst--;
    doyEst = zeroDay - (365 * yearEst + Math.trunc(yearEst / 4) - Math.trunc(yearEst / 100) + Math.trunc(yearEst / 400));
  }
  yearEst += adjust;
  const marchDoy0 = doyEst;
  const marchMonth0 = Math.trunc((marchDoy0 * 5 + 2) / 153);
  const month = ((marchMonth0 + 2) % 12) + 1;
  const dom = marchDoy0 - Math.trunc((marchMonth0 * 306 + 5) / 10) + 1;
  yearEst += Math.trunc(marchMonth0 / 10);
  return { year: yearEst, month, day: dom };
}

export function year(d: LocalDate): number {
  return toYMD(d).year;
}

export function month(d: LocalDate): number {
  return toYMD(d).month;
}

export function dayOfMonth(d: LocalDate): number {
  return toYMD(d).day;
}

/** ISO day of week: 1 = Monday ... 7 = Sunday */
export function dayOfWeek(d: LocalDate): number {
  const dow0 = (((d + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday
  return dow0 + 1;
}

export function dayOfYear(d: LocalDate): number {
  return d - ofYMD(year(d), 1, 1) + 1;
}

export function plusDays(d: LocalDate, days: number): LocalDate {
  return d + days;
}

/** java.time.LocalDate#plusMonths (clamps the day of month) */
export function plusMonths(d: LocalDate, months: number): LocalDate {
  if (months === 0) return d;
  const { year: y, month: m, day } = toYMD(d);
  const monthCount = y * 12 + (m - 1);
  const calc = monthCount + months;
  const newYear = Math.floor(calc / 12);
  const newMonth = calc - newYear * 12 + 1;
  return ofYMD(newYear, newMonth, Math.min(day, lengthOfMonth(newYear, newMonth)));
}

export function plusYears(d: LocalDate, years: number): LocalDate {
  if (years === 0) return d;
  const { year: y, month: m, day } = toYMD(d);
  const ny = y + years;
  return ofYMD(ny, m, Math.min(day, lengthOfMonth(ny, m)));
}

export function plusWeeks(d: LocalDate, weeks: number): LocalDate {
  return d + weeks * 7;
}

export function withDayOfMonth(d: LocalDate, day: number): LocalDate {
  const { year: y, month: m } = toYMD(d);
  return ofYMD(y, m, day);
}

export function withDayOfYear(d: LocalDate, doy: number): LocalDate {
  return ofYMD(year(d), 1, 1) + doy - 1;
}

export function lastDayOfMonth(d: LocalDate): LocalDate {
  const { year: y, month: m } = toYMD(d);
  return ofYMD(y, m, lengthOfMonth(y, m));
}

export function firstDayOfMonth(d: LocalDate): LocalDate {
  return withDayOfMonth(d, 1);
}

export function lastDayOfYear(d: LocalDate): LocalDate {
  return ofYMD(year(d), 12, 31);
}

export function firstDayOfYear(d: LocalDate): LocalDate {
  return ofYMD(year(d), 1, 1);
}

export function lengthOfYear(y: number): number {
  return isLeapYear(y) ? 366 : 365;
}

/** Parses yyyy-MM-dd */
export function parseDate(s: string): LocalDate {
  const m = /^(-?\d{4,})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid date: ${s}`);
  return ofYMD(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
}

/** Parses yyyy-MM-ddTHH:mm[:ss[.SSS]] (java.time.LocalDateTime#parse) or a date only */
export function parseDateTime(s: string): LocalDateTime {
  const t = s.trim();
  const m = /^(-?\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(t);
  if (!m) throw new Error(`Invalid date time: ${s}`);
  const day = ofYMD(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  const hh = m[4] ? parseInt(m[4], 10) : 0;
  const mm = m[5] ? parseInt(m[5], 10) : 0;
  const ss = m[6] ? parseInt(m[6], 10) : 0;
  return day * SECONDS_PER_DAY + hh * 3600 + mm * 60 + ss;
}

export function pad(n: number, width = 2): string {
  const s = String(Math.abs(n));
  return (n < 0 ? '-' : '') + (s.length >= width ? s : '0'.repeat(width - s.length) + s);
}

export function formatISODate(d: LocalDate): string {
  const { year: y, month: m, day } = toYMD(d);
  return `${pad(y, 4)}-${pad(m)}-${pad(day)}`;
}

export function formatISODateTime(dt: LocalDateTime): string {
  const d = toLocalDate(dt);
  const sod = dt - d * SECONDS_PER_DAY;
  const hh = Math.floor(sod / 3600);
  const mm = Math.floor((sod % 3600) / 60);
  const ss = sod % 60;
  return `${formatISODate(d)}T${pad(hh)}:${pad(mm)}${ss ? ':' + pad(ss) : ''}`;
}

export function toLocalDate(dt: LocalDateTime): LocalDate {
  return Math.floor(dt / SECONDS_PER_DAY);
}

export function atStartOfDay(d: LocalDate): LocalDateTime {
  return d * SECONDS_PER_DAY;
}

/** date.atTime(LocalTime.MAX) - represented as last second of the day (nanos are irrelevant for comparisons) */
export function atEndOfDay(d: LocalDate): LocalDateTime {
  return d * SECONDS_PER_DAY + SECONDS_PER_DAY - 1;
}

/** Overridable "now" so that calculations are reproducible in tests */
let fixedToday: LocalDate | null = null;

export function setToday(d: LocalDate | null): void {
  fixedToday = d;
}

export function today(): LocalDate {
  if (fixedToday !== null) return fixedToday;
  const now = new Date();
  return ofYMD(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** ChronoUnit.DAYS.between */
export function daysBetween(start: LocalDate, end: LocalDate): number {
  return end - start;
}

/** ChronoUnit.MONTHS.between */
export function monthsBetween(start: LocalDate, end: LocalDate): number {
  const a = toYMD(start);
  const b = toYMD(end);
  const packed1 = (a.year * 12 + a.month - 1) * 32 + a.day;
  const packed2 = (b.year * 12 + b.month - 1) * 32 + b.day;
  return Math.trunc((packed2 - packed1) / 32);
}

/** ChronoUnit.YEARS.between */
export function yearsBetween(start: LocalDate, end: LocalDate): number {
  return Math.trunc(monthsBetween(start, end) / 12);
}

/** java.time.Period.between(start, end) */
export function periodBetween(start: LocalDate, end: LocalDate): { years: number; months: number; days: number } {
  const a = toYMD(start);
  const b = toYMD(end);
  let totalMonths = b.year * 12 + b.month - (a.year * 12 + a.month);
  let days = b.day - a.day;
  if (totalMonths > 0 && days < 0) {
    totalMonths--;
    const calcDate = plusMonths(start, totalMonths);
    days = end - calcDate;
  } else if (totalMonths < 0 && days > 0) {
    totalMonths++;
    days -= lengthOfMonth(b.year, b.month);
  }
  const years = Math.trunc(totalMonths / 12);
  const months = totalMonths % 12;
  return { years, months: months + 0, days };
}

/** Year-month key, e.g. 202403 */
export function yearMonthKey(d: LocalDate): number {
  const { year: y, month: m } = toYMD(d);
  return y * 100 + m;
}
