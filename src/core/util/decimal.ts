// Helpers that mirror the semantics of java.math.BigDecimal as used by
// Portfolio Performance. Plain arithmetic is exact (very high precision),
// operations with Values.MC are rounded to 10 significant digits HALF_UP.

import Decimal from 'decimal.js';

/** "Exact" arithmetic (BigDecimal without MathContext). */
export const D = Decimal.clone({ precision: 120, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });
export type D = Decimal;

/** Arithmetic with Values.MC = new MathContext(10, RoundingMode.HALF_UP). */
export const DMC = Decimal.clone({ precision: 10, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });

export const HALF_UP = Decimal.ROUND_HALF_UP;
export const HALF_DOWN = Decimal.ROUND_HALF_DOWN;
export const HALF_EVEN = Decimal.ROUND_HALF_EVEN;
export const DOWN = Decimal.ROUND_DOWN;
export const UP = Decimal.ROUND_UP;
export const FLOOR = Decimal.ROUND_FLOOR;
export const CEIL = Decimal.ROUND_CEIL;

export type DecimalLike = Decimal | number | string;

export function dec(v: DecimalLike): Decimal {
  return v instanceof D ? (v as Decimal) : new D(v as Decimal.Value);
}

/** Equivalent of BigDecimal.valueOf(double): uses the shortest representation. */
export function decOfDouble(v: number): Decimal {
  return new D(String(v));
}

/** a.multiply(b, Values.MC) */
export function mulMC(a: DecimalLike, b: DecimalLike): Decimal {
  return new D(new DMC(a as Decimal.Value).mul(b as Decimal.Value));
}

/** a.divide(b, Values.MC) */
export function divMC(a: DecimalLike, b: DecimalLike): Decimal {
  return new D(new DMC(a as Decimal.Value).div(b as Decimal.Value));
}

/** a.divide(b, scale, rounding) */
export function divScale(a: DecimalLike, b: DecimalLike, scale: number, rounding: Decimal.Rounding): Decimal {
  // exact division with enough digits, then round to the given scale.
  // With 120 significant digits, double rounding cannot occur for the
  // magnitudes used in PP (amounts < 1e18, scale <= 10)
  const exact = dec(a).div(b as Decimal.Value);
  return exact.toDecimalPlaces(scale, rounding);
}

/** a.setScale(scale, rounding) */
export function setScale(a: Decimal, scale: number, rounding: Decimal.Rounding): Decimal {
  return a.toDecimalPlaces(scale, rounding);
}

/** setScale(0, rounding).longValue() */
export function toLong(a: Decimal, rounding: Decimal.Rounding): number {
  return a.toDecimalPlaces(0, rounding).toNumber();
}

/** BigDecimal.longValue() (truncation) */
export function longValue(a: Decimal): number {
  return a.toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
}

const LONG_MAX = 9223372036854775807;
const LONG_MIN = -9223372036854775808;

/**
 * Java Math.round(double): closest long, ties towards positive infinity (same
 * as JS Math.round), but NaN becomes 0 and values are clamped to the long range.
 */
export function javaRound(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x >= LONG_MAX) return LONG_MAX;
  if (x <= LONG_MIN) return LONG_MIN;
  return Math.round(x) + 0; // + 0 normalizes -0
}

/** Java (long) cast of a double: truncation towards zero */
export function javaLong(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.trunc(x);
}

export const ZERO = new D(0);
export const ONE = new D(1);
