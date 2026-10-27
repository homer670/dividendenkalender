// name.abuchen.portfolio.math.Risk

import { LocalDate } from '../util/dates';
import { Interval } from '../util/interval';

export class Drawdown {
  maxDD = 0;
  maxDDDuration: Interval;
  intervalMaxDD: Interval;
  recoveryTime: Interval;
  drawdownDataSerie: number[];

  constructor(values: number[], dates: LocalDate[], startAt: number) {
    if (values.length !== dates.length) throw new Error('Values and dates mismatch');
    if (startAt >= values.length) throw new Error('Unable to start at ' + startAt);
    let peak = values[startAt] + 1;
    let bottom = values[startAt] + 1;
    let lastPeakDate = dates[startAt];
    let lastBottomDate = dates[startAt];
    this.intervalMaxDD = Interval.of(lastPeakDate, lastPeakDate);
    this.maxDDDuration = Interval.of(lastPeakDate, lastPeakDate);
    this.recoveryTime = Interval.of(lastBottomDate, lastPeakDate);
    let currentDrawdownDuration: Interval | null = null;
    let currentRecoveryTime: Interval | null = null;
    this.drawdownDataSerie = new Array(values.length).fill(0);
    for (let ii = startAt; ii < values.length; ii++) {
      const value = values[ii] + 1;
      currentDrawdownDuration = Interval.of(lastPeakDate, dates[ii]);
      currentRecoveryTime = Interval.of(lastBottomDate, dates[ii]);
      if (value > peak) {
        peak = value;
        lastPeakDate = dates[ii];
        this.drawdownDataSerie[ii] = 0;
        if (currentRecoveryTime.isLongerThan(this.recoveryTime)) this.recoveryTime = currentRecoveryTime;
        lastBottomDate = dates[ii];
        bottom = value;
      } else {
        const drawdown = (peak - value) / peak;
        this.drawdownDataSerie[ii] = -drawdown;
        if (drawdown > this.maxDD) {
          this.maxDD = drawdown;
          this.intervalMaxDD = Interval.of(lastPeakDate, dates[ii]);
        }
        if (value < bottom) {
          bottom = value;
          lastBottomDate = dates[ii];
        }
      }
      if (currentDrawdownDuration !== null && currentDrawdownDuration.isLongerThan(this.maxDDDuration))
        this.maxDDDuration = currentDrawdownDuration;
    }
    if (currentRecoveryTime !== null && currentRecoveryTime.isLongerThan(this.recoveryTime))
      this.recoveryTime = currentRecoveryTime;
  }

  getMaxDrawdown(): number {
    return this.maxDD;
  }
  getIntervalOfMaxDrawdown(): Interval {
    return this.intervalMaxDD;
  }
  getMaxDrawdownDuration(): Interval {
    return this.maxDDDuration;
  }
  getLongestRecoveryTime(): Interval {
    return this.recoveryTime;
  }
  getMaxDrawdownSerie(): number[] {
    return this.drawdownDataSerie;
  }
}

export class Volatility {
  readonly stdDeviation: number;
  readonly semiDeviation: number;

  constructor(returns: number[], filter: (index: number) => boolean) {
    let tempStandard = 0;
    let tempSemi = 0;
    let count = 0;
    const averageLogReturn = Volatility.logAverage(returns, filter);
    for (let ii = 0; ii < returns.length; ii++) {
      if (!filter(ii)) continue;
      const logReturn = Math.log(1 + returns[ii]);
      const add = Math.pow(logReturn - averageLogReturn, 2);
      tempStandard += add;
      count++;
      if (logReturn < averageLogReturn) tempSemi += add;
    }
    if (count <= 1) {
      this.stdDeviation = 0;
      this.semiDeviation = 0;
    } else {
      this.stdDeviation = Math.sqrt((tempStandard / (count - 1)) * count);
      this.semiDeviation = Math.sqrt((tempSemi / (count - 1)) * count);
    }
  }

  private static logAverage(returns: number[], filter: (index: number) => boolean): number {
    let sum = 0;
    let count = 0;
    for (let ii = 0; ii < returns.length; ii++) {
      if (!filter(ii)) continue;
      sum += Math.log(1 + returns[ii]);
      count++;
    }
    return count === 0 ? 0 : sum / count;
  }

  getStandardDeviation(): number {
    return this.stdDeviation;
  }
  getSemiDeviation(): number {
    return this.semiDeviation;
  }
  getExpectedSemiDeviation(): number {
    return this.stdDeviation / Math.sqrt(2);
  }
  getNormalizedSemiDeviationComparison(): string {
    const e = this.getExpectedSemiDeviation();
    if (e > this.semiDeviation) return '>';
    if (e < this.semiDeviation) return '<';
    return '=';
  }
}
