// name.abuchen.portfolio.math.IRR

import { LocalDate } from '../util/dates';

/** Collectors.summingDouble (compensated Kahan summation as implemented in JDK 21) */
export function javaSummingDouble(values: number[]): number {
  let sum = 0;
  let c = 0;
  let simpleSum = 0;
  for (const value of values) {
    simpleSum += value;
    const tmp = value - c;
    const velvel = sum + tmp;
    c = velvel - sum - tmp;
    sum = velvel;
  }
  const tmp = sum - c;
  if (Number.isNaN(tmp) && !Number.isFinite(simpleSum) && !Number.isNaN(simpleSum)) return simpleSum;
  return tmp;
}

function signum(x: number): number {
  if (Number.isNaN(x)) return NaN;
  return x > 0 ? 1 : x < 0 ? -1 : x; // keeps -0 / +0 like Math.signum
}

function sameSign(a: number, b: number): boolean {
  // Math.signum(a) == Math.signum(b) in Java: NaN never equal, -0 == +0
  const sa = signum(a);
  const sb = signum(b);
  return sa === sb; // NaN !== NaN, -0 === 0
}

function npvFactory(dates: LocalDate[], values: number[]): (rate: number) => number {
  if (dates.length !== values.length) throw new Error('dates and values must have equal size.');
  if (dates.length === 0) throw new Error('at least one data point must be provided');
  const days = dates.map((d) => Math.abs(d - dates[0]));
  return (rate: number) => {
    let answer = 0;
    for (let ii = 0; ii < days.length; ii++) answer += values[ii] / Math.pow(rate, days[ii] / 365.0);
    return answer;
  };
}

function halving(f: (x: number) => number, left: number, right: number, fLeft: number, fRight: number): number {
  for (;;) {
    if (sameSign(fLeft, fRight)) throw new Error('Endpoints of interval must have different sign in f');
    const center = (left + right) / 2;
    if (right - left < 0.001) return center;
    const fCenter = f(center);
    if (fCenter === 0) return center;
    else if (sameSign(fCenter, fRight)) {
      right = center;
      fRight = fCenter;
    } else {
      left = center;
      fLeft = fCenter;
    }
  }
}

function newtonSeek(f: (x: number) => number, fd: (x: number) => number, x0: number): number {
  const stop = 0.00001;
  let delta = 1;
  let xi = x0;
  for (let ii = 0; delta > stop && ii < 500; ii++) {
    const fxi = f(xi);
    const fdxi = fd(xi);
    const xi1 = xi - fxi / fdxi;
    delta = Math.abs(xi1 - xi);
    xi = xi1;
  }
  return xi;
}

export function calculateIRR(dates: LocalDate[], values: number[]): number {
  const npv = npvFactory(dates, values);
  const derivative = (x: number) => {
    const delta = Math.abs(x) / 1e6;
    const left = npv(x - delta);
    const right = npv(x + delta);
    return (right - left) / (2 * delta);
  };
  const fLeft = values[values.length - 1];
  const fRight = javaSummingDouble(values);
  let guess: number;
  if (sameSign(fLeft, fRight)) guess = 1.05;
  else guess = halving(npv, 0, 1, fLeft, fRight);
  const x = newtonSeek(npv, derivative, guess);
  // If the cash flows have no internal rate of return, Newton's method
  // iterates chaotically and the result depends on the last bits of Math.pow.
  // Portfolio Performance then shows an arbitrary number (or NaN). We return
  // NaN if the result is not a root of the NPV function.
  if (Number.isFinite(x)) {
    // distance to the root according to the linearization (= next Newton step)
    const step = Math.abs(npv(x) / derivative(x));
    if (!(step < 1e-3)) return NaN;
  }
  return x - 1;
}
