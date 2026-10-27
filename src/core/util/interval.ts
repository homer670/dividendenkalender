import { LocalDate, LocalDateTime, toLocalDate, year, yearMonthKey } from './dates';

/** name.abuchen.portfolio.util.Interval - note: start is exclusive in #contains */
export class Interval {
  private constructor(
    readonly start: LocalDate,
    readonly end: LocalDate,
  ) {}

  static of(start: LocalDate, end: LocalDate): Interval {
    return new Interval(start, end);
  }

  getStart(): LocalDate {
    return this.start;
  }

  getEnd(): LocalDate {
    return this.end;
  }

  getDays(): number {
    return this.end - this.start;
  }

  isLongerThan(other: Interval): boolean {
    return this.getDays() > other.getDays();
  }

  /** start is exclusive, end is inclusive */
  contains(d: LocalDate): boolean {
    return d > this.start && d <= this.end;
  }

  containsDateTime(dt: LocalDateTime): boolean {
    return this.contains(toLocalDate(dt));
  }

  intersects(other: Interval): boolean {
    return other.start < this.end && other.end > this.start;
  }

  /** Years touched by the interval (first day not in range is skipped) */
  getYears(): number[] {
    const answer: number[] = [];
    let last: number | null = null;
    for (let d = this.start + 1; d <= this.end; d++) {
      const y = year(d);
      if (y !== last) {
        answer.push(y);
        last = y;
      }
    }
    return answer;
  }

  /** Year months (yyyymm) touched by the interval */
  getYearMonths(): number[] {
    const answer: number[] = [];
    let last: number | null = null;
    for (let d = this.start + 1; d <= this.end; d++) {
      const ym = yearMonthKey(d);
      if (ym !== last) {
        answer.push(ym);
        last = ym;
      }
    }
    return answer;
  }

  equals(other: Interval): boolean {
    return this.start === other.start && this.end === other.end;
  }

  toString(): string {
    return `${this.start}-${this.end}`;
  }
}
